/**
 * Protection-mode rules (MODE.*) and the transport table (XPT.*).
 *
 * Two spellings matter here. The "at least one synchronized standby" sentence
 * belongs to maximum availability and to nothing else. And broker Table 4-2
 * lists ASYNC as the only transport mode for maximum performance -- it never
 * says SYNC is illegal there, so that branch is an informational note.
 */

import type { CitationId } from '../../citations';
import { assertCitesAllowed } from '../../citations';
import type { Finding } from '../../types/claims';
import type { Member } from '../../types/topology';
import { isDatabase, isFarSync } from '../../types/topology';
import type { Rule } from '../context';
import { configSubject, memberSubject, mk, q } from '../context';

const syncish = (x: string): boolean => x === 'SYNC' || x === 'FASTSYNC';

/**
 * "If a far sync instance is the only configuration member receiving redo in
 * synchronous mode from the primary database", maximum protection cannot be
 * used.
 */
export const maxProtectionNeedsSyncDatabase: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.protectionMode !== 'MAXPROTECTION') return [];
  const edges = ctx.primaryEdges().filter((e) => syncish(e.xpt));
  if (edges.length === 0) return [];
  const receivers = edges
    .map((e) => ctx.member(e.to))
    .filter((m): m is Member => m !== undefined);
  if (receivers.some((m) => isDatabase(m))) return [];
  const fs = receivers.filter(isFarSync);
  if (fs.length === 0) return [];
  return [mk('MODE.MAXPROT_NEEDS_SYNC_DB', {
    subject: configSubject(),
    message: `${fs.map((m) => q(m.name)).join(', ')} is the only configuration member receiving redo in synchronous mode from ${q(ctx.primary?.name ?? 'the primary')}. Maximum protection mode cannot be used in that shape: a far sync instance holds the redo, but no standby database acknowledges the commit.`,
    cite: ['FS.MAXPROT_BROKER_19C', 'MAXPROT.SHUTS_PRIMARY'],
  })];
};

/** Maximum protection cannot be used if the only standby is a snapshot standby. */
export const maxProtectionSnapshotOnly: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.protectionMode !== 'MAXPROTECTION') return [];
  if (ctx.standbys.length === 0) return [];
  if (!ctx.standbys.every((m) => m.role === 'snapshot')) return [];
  return [mk('MODE.MAXPROT_SNAPSHOT_ONLY', {
    subject: configSubject(),
    message: `The only standby database in the configuration is the snapshot standby ${ctx.standbys.map((m) => q(m.name)).join(', ')}. Maximum protection mode cannot be used if the only standby database is a snapshot standby database.`,
    cite: ['MODE.MAXPROT_SNAPSHOT_ONLY', 'MAXPROT.SHUTS_PRIMARY'],
  })];
};

/** Two standbys are the documented recommendation in maximum protection mode. */
export const maxProtectionOneStandby: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.protectionMode !== 'MAXPROTECTION') return [];
  if (ctx.standbys.length !== 1) return [];
  return [mk('MODE.MAXPROT_ONE_STANDBY', {
    subject: configSubject(),
    message: `MAXPROTECTION with a single standby database (${q(ctx.standbys[0]?.name ?? '')}). Maximum protection shuts the primary database down rather than allowing it to continue, and Oracle recommends that a minimum of two standby databases be used so that a single standby database failure cannot do that.`,
    cite: ['MAXPROT.TWO_STANDBYS', 'MAXPROT.SHUTS_PRIMARY'],
  })];
};

/**
 * Broker Table 4-2. The 26ai maximum availability row is the one place the
 * documentation argues with itself: the prerequisites list gives SYNC or
 * FASTSYNC or ASYNC while Task 3 of the same chapter still says SYNC or
 * FASTSYNC -- and Task 3 is a source AGENTS.md rules out for this question.
 */
const MAXAVAIL_26AI_CITES: CitationId[] = ['XPT.MAXAVAIL_ASYNC_26AI', 'XPT.TABLE_4_2'];
assertCitesAllowed('MAXAVAIL_TRANSPORTS', MAXAVAIL_26AI_CITES);

export const transportTable: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  const mode = ctx.doc.config.protectionMode;
  const is26 = ctx.doc.config.edition === '26ai';
  for (const e of ctx.primaryEdges()) {
    const m = ctx.member(e.to);
    if (!m) continue;
    const name = q(m.name);
    const fixTo = (want: string): Finding['fix'] | undefined => {
      const i = ctx.indexOf(m.id);
      if (i < 0 || e.xptSource !== 'dest-logxptmode') return undefined;
      return {
        label: `Set LogXptMode on ${m.name} to ${want}`,
        patch: [{ op: 'replace', path: `/members/${i}/logXptMode`, value: want }],
      };
    };
    if (mode === 'MAXPROTECTION' && e.xpt !== 'SYNC') {
      const fix = fixTo('SYNC');
      out.push(mk('XPT.TABLE_4_2', {
        subject: memberSubject(m),
        message: `${name} receives ${e.xpt} while the configuration is in MAXPROTECTION. Broker Table 4-2 gives SYNC as the transport for maximum protection mode.`,
        cite: ['XPT.TABLE_4_2', 'XPT.LOGXPTMODE_VALUES'],
        ...(fix ? { fix } : {}),
      }));
      continue;
    }
    if (mode === 'MAXAVAILABILITY' && e.xpt === 'ASYNC') {
      if (is26) {
        out.push(mk('XPT.TABLE_4_2', {
          severity: 'warning',
          subject: memberSubject(m),
          message: `${name} receives ASYNC in MAXAVAILABILITY. Under 26ai the fast-start failover prerequisites list SYNC or FASTSYNC or ASYNC for a maximum availability target, so this is allowed rather than a mode conflict -- but zero data loss still wants SYNC or FASTSYNC.`,
          cite: MAXAVAIL_26AI_CITES,
        }));
      } else {
        const fix = fixTo('SYNC');
        out.push(mk('XPT.TABLE_4_2', {
          subject: memberSubject(m),
          message: `${name} receives ASYNC while the configuration is in MAXAVAILABILITY. Broker Table 4-2 gives SYNC or FASTSYNC for maximum availability mode under 19c.`,
          cite: ['XPT.TABLE_4_2', 'XPT.LOGXPTMODE_VALUES'],
          ...(fix ? { fix } : {}),
        }));
      }
      continue;
    }
    if (mode === 'MAXPERFORMANCE' && e.xpt !== 'ASYNC') {
      out.push(mk('XPT.TABLE_4_2', {
        severity: 'info',
        subject: memberSubject(m),
        message: `${name} receives ${e.xpt} in MAXPERFORMANCE. ASYNC is the only transport mode broker Table 4-2 lists for maximum performance; the table does not say the others cannot be used there. Under ${e.xpt} the primary waits for this destination on commit, which is what maximum performance otherwise avoids.`,
        cite: ['XPT.TABLE_4_2'],
      }));
    }
  }
  return out;
};

/** FASTSYNC is 12.1+ and maximum availability mode only. */
export const fastSyncMaxAvailOnly: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.protectionMode === 'MAXAVAILABILITY') return [];
  const out: Finding[] = [];
  for (const e of ctx.primaryEdges()) {
    if (e.xpt !== 'FASTSYNC') continue;
    const m = ctx.member(e.to);
    if (!m) continue;
    out.push(mk('XPT.FASTSYNC_MAXAVAIL_ONLY', {
      subject: memberSubject(m),
      message: `${q(m.name)} receives FASTSYNC while the configuration is in ${ctx.doc.config.protectionMode}. FASTSYNC arrived in 12.1 and is a maximum availability mode transport; it maps to SYNC with NOAFFIRM, which acknowledges received redo before writing it to the standby redo log.`,
      cite: ['XPT.FASTSYNC_12_1', 'XPT.AFFIRM_SEMANTICS'],
    }));
  }
  return out;
};

/** FSFO cannot be initiated when FASTSYNC is in use and the standby is missing redo. */
export const fastSyncFsfoGap: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  const g = ctx.graph;
  if (!g) return [];
  const out: Finding[] = [];
  for (const id of ctx.candidates) {
    const rm = g.members[id];
    if (!rm) continue;
    const path = rm.feedPath;
    const usesFastSync = path.some((to, i) => i > 0 && g.edges.some(
      (e) => e.from === path[i - 1] && e.to === to && e.active && e.xpt === 'FASTSYNC',
    ));
    if (!usesFastSync) continue;
    out.push(mk('XPT.FASTSYNC_FSFO_GAP', {
      subject: memberSubject(id as string),
      message: `The fast-start failover candidate target ${q(id as string)} is fed over FASTSYNC. Fast-start failover cannot be initiated while FASTSYNC is in use and the standby is missing redo data: FASTSYNC acknowledges the redo before it is written to the standby redo log.`,
      cite: ['XPT.FASTSYNC_FSFO_GAP', 'XPT.AFFIRM_SEMANTICS'],
    }));
  }
  return out;
};

export const modeRules: Rule[] = [
  maxProtectionNeedsSyncDatabase, maxProtectionSnapshotOnly, maxProtectionOneStandby,
  transportTable, fastSyncMaxAvailOnly, fastSyncFsfoGap,
];

