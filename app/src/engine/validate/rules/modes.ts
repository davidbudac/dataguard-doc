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
 * Broker Table 4-2 / MEM19: "the broker verifies that there is at least one
 * standby database in the configuration that can support the desired grade
 * of protection" -- a configuration-level check across every destination
 * from the primary. An ASYNC bystander beside a SYNC standby is legal in
 * every edition: one SYNC standby is enough for MAXPROTECTION or
 * MAXAVAILABILITY, whatever every other destination is doing. MAXPERFORMANCE
 * asks nothing here -- every transport mode supports it.
 */
export const atLeastOneSupportsMode: Rule = (ctx): Finding[] => {
  const mode = ctx.doc.config.protectionMode;
  if (mode === 'MAXPERFORMANCE') return [];
  const edges = ctx.primaryEdges();
  if (edges.length === 0) return [];
  const is26 = ctx.doc.config.edition === '26ai';
  /* 26ai: "Starting with Oracle Database Release 21c, you can upgrade the
     protection mode to maximum availability even if the primary does not
     have any SYNC standbys" -- ASYNC counts under 26ai's own prerequisites. */
  const supports = (xpt: string): boolean =>
    (mode === 'MAXPROTECTION' ? xpt === 'SYNC' : syncish(xpt) || (is26 && xpt === 'ASYNC'));
  if (edges.some((e) => supports(e.xpt))) return [];
  const wants = mode === 'MAXPROTECTION' ? 'SYNC' : is26 ? 'SYNC, FASTSYNC or ASYNC' : 'SYNC or FASTSYNC';
  return [mk('XPT.TABLE_4_2', {
    subject: configSubject(),
    message: `No destination from the primary receives ${wants} while the configuration is in ${mode}. When the protection mode or a standby's redo transport service changes, the broker verifies that there is at least one standby database in the configuration that can support the desired grade of protection; none does here.`,
    cite: is26 && mode === 'MAXAVAILABILITY'
      ? ['MODE.AT_LEAST_ONE_SUPPORTS', 'XPT.LOGXPTMODE_VALUES', 'MODE.UPGRADE_WITHOUT_SYNC_26AI']
      : ['MODE.AT_LEAST_ONE_SUPPORTS', 'XPT.LOGXPTMODE_VALUES'],
  })];
};

/**
 * The fast-start failover prerequisites' per-member transport list is
 * stricter than MEM19's "at least one" and scoped to the target and the
 * primary only, and only while fast-start failover is enabled or
 * observe-only: 19c "Maximum protection -- SYNC, Maximum availability --
 * SYNC or FASTSYNC, Maximum performance -- ASYNC"; 26ai's maximum
 * availability row adds ASYNC, a conflict with Table 4-2 that 26ai does not
 * name. A far sync feed is farSyncTransports' concern, not this rule's.
 */
const MAXAVAIL_26AI_CITES: CitationId[] = ['XPT.MAXAVAIL_ASYNC_26AI', 'XPT.TABLE_4_2'];
assertCitesAllowed('MAXAVAIL_TRANSPORTS', MAXAVAIL_26AI_CITES);

export const fsfoTargetTransport: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  const g = ctx.graph;
  if (!g) return [];
  const mode = ctx.doc.config.protectionMode;
  const is26 = ctx.doc.config.edition === '26ai';
  const out: Finding[] = [];
  for (const id of ctx.candidates) {
    const rm = g.members[id];
    if (!rm || rm.depth !== 1) continue; /* far sync / cascaded: other rules */
    const e = ctx.primaryEdges().find((x) => x.to === id);
    if (!e) continue;
    const m = ctx.member(id);
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
      out.push(mk('XPT.TABLE_4_2', {
        subject: memberSubject(m),
        message: `${name} is a fast-start failover candidate target and receives ${e.xpt} while the configuration is in MAXPROTECTION. The fast-start failover prerequisites require SYNC for the target standby (and the primary) in maximum protection mode.`,
        cite: [is26 ? 'FSFO.PREREQ_TRANSPORTS_26AI' : 'FSFO.PREREQ_TRANSPORTS_19C'],
        ...(fixTo('SYNC') ? { fix: fixTo('SYNC') } : {}),
      }));
      continue;
    }
    if (mode === 'MAXAVAILABILITY') {
      if (is26 && e.xpt === 'ASYNC') {
        out.push(mk('XPT.TABLE_4_2', {
          severity: 'warning',
          subject: memberSubject(m),
          message: `${name} is a fast-start failover candidate target and receives ASYNC while the configuration is in MAXAVAILABILITY. Under 26ai the fast-start failover prerequisites allow SYNC, FASTSYNC or ASYNC for a maximum availability target -- a conflict with Table 4-2 and the LogXptMode page, which still give SYNC or FASTSYNC and which 26ai does not name -- but zero data loss still wants SYNC or FASTSYNC.`,
          cite: MAXAVAIL_26AI_CITES,
        }));
      } else if (!syncish(e.xpt)) {
        out.push(mk('XPT.TABLE_4_2', {
          subject: memberSubject(m),
          message: `${name} is a fast-start failover candidate target and receives ${e.xpt} while the configuration is in MAXAVAILABILITY. The fast-start failover prerequisites require SYNC or FASTSYNC for the target standby (and the primary) in maximum availability mode${is26 ? ' -- 26ai\'s own prerequisites list also allows ASYNC, which this destination does not use either' : ' under 19c'}.`,
          cite: [is26 ? 'FSFO.PREREQ_TRANSPORTS_26AI' : 'FSFO.PREREQ_TRANSPORTS_19C'],
          ...(fixTo('SYNC') ? { fix: fixTo('SYNC') } : {}),
        }));
      }
    }
  }
  return out;
};

/** ASYNC is the only mode Table 4-2 lists for maximum performance; it never says the others are illegal there. */
export const maxPerformanceOtherTransportNote: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  if (ctx.doc.config.protectionMode !== 'MAXPERFORMANCE') return [];
  for (const e of ctx.primaryEdges()) {
    if (e.xpt === 'ASYNC') continue;
    const m = ctx.member(e.to);
    if (!m) continue;
    out.push(mk('XPT.TABLE_4_2', {
      severity: 'info',
      subject: memberSubject(m),
      message: `${q(m.name)} receives ${e.xpt} in MAXPERFORMANCE. ASYNC is the only transport mode broker Table 4-2 lists for maximum performance; the table does not say the others cannot be used there. Under ${e.xpt} the primary waits for this destination on commit, which is what maximum performance otherwise avoids.`,
      cite: ['XPT.TABLE_4_2'],
    }));
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
  atLeastOneSupportsMode, fsfoTargetTransport, maxPerformanceOtherTransportNote,
  fastSyncMaxAvailOnly, fastSyncFsfoGap,
];

