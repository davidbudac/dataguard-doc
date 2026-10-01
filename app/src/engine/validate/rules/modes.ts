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
import type { MemberId } from '../../ids';
import { resolveRedoGraph } from '../../redo/resolve';
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
    message: `The only standby database in the configuration is the snapshot standby ${ctx.standbys.map((m) => q(m.name)).join(', ')}. Maximum protection mode cannot be used when the only standby database is a snapshot standby database.`,
    cite: ['MODE.MAXPROT_SNAPSHOT_ONLY', 'MAXPROT.SHUTS_PRIMARY'],
  })];
};

/** Two standbys are the documented recommendation in maximum protection mode. */
export const maxProtectionOneStandby: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.protectionMode !== 'MAXPROTECTION') return [];
  if (ctx.standbys.length !== 1) return [];
  return [mk('MODE.MAXPROT_ONE_STANDBY', {
    subject: configSubject(),
    message: `The configuration is in MAXPROTECTION with a single standby database (${q(ctx.standbys[0]?.name ?? '')}). Maximum protection shuts the primary database down rather than allowing it to continue, so one standby failure can stop the primary. Oracle recommends a minimum of two standby databases to prevent that.`,
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
    message: `No destination from the primary receives ${wants} while the configuration is in ${mode}. When the protection mode or a standby's redo transport service changes, the broker verifies that at least one standby database in the configuration can support the desired grade of protection. None does here.`,
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
const MAXAVAIL_26AI_CITES: CitationId[] = ['XPT.MAXAVAIL_ASYNC_26AI', 'XPT.TABLE_4_2', 'FSFO.TASK3_MAXAVAIL_26AI'];
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
    /* The command is named only where LogXptMode is what sets the transport. */
    const cmd = (want: string): string => (fixTo(want) ? ` EDIT DATABASE ${name} SET PROPERTY 'LogXptMode' = '${want}';` : '');
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
        message: `${name} is a candidate fast-start failover target and receives ${e.xpt} while the configuration is in MAXPROTECTION. The fast-start failover prerequisites require SYNC for the target standby (and the primary) in maximum protection mode.${cmd('SYNC')}`,
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
          basis: 'conflict',
          message: `${name} is a candidate fast-start failover target and receives ASYNC while the configuration is in MAXAVAILABILITY. Under 26ai the fast-start failover prerequisites allow SYNC, FASTSYNC or ASYNC for a maximum availability target. That conflicts with Table 4-2, the LogXptMode page and the chapter's own Task 3, which still give SYNC or FASTSYNC; 26ai does not name the conflict. ASYNC is accepted here, but zero data loss still wants SYNC or FASTSYNC.`,
          cite: MAXAVAIL_26AI_CITES,
          note: 'Two parts of the 26ai broker guide disagree and neither says so: the Enabling Fast-Start Failover prerequisites list SYNC or FASTSYNC or ASYNC for maximum availability, while Table 4-2, the LogXptMode property page and Task 3 of the same chapter give SYNC or FASTSYNC. The workbench accepts ASYNC (a warning, not an error) and names the disagreement rather than choosing a side.',
        }));
      } else if (!syncish(e.xpt)) {
        out.push(mk('XPT.TABLE_4_2', {
          subject: memberSubject(m),
          message: `${name} is a candidate fast-start failover target and receives ${e.xpt} while the configuration is in MAXAVAILABILITY. The fast-start failover prerequisites require SYNC or FASTSYNC for the target standby (and the primary) in maximum availability mode${is26 ? '. The 26ai prerequisites list also allows ASYNC, but this destination uses none of the three' : ' under 19c'}.${cmd('SYNC')}`,
          cite: [is26 ? 'FSFO.PREREQ_TRANSPORTS_26AI' : 'FSFO.PREREQ_TRANSPORTS_19C'],
          ...(fixTo('SYNC') ? { fix: fixTo('SYNC') } : {}),
        }));
      }
    }
  }
  return out;
};

/**
 * The primary is a standby after a role change, so the fast-start failover
 * prerequisites ask of its own transport what they ask of the target's:
 * 19c Task 3, "set the LogXptMode database property for both the primary and
 * target standby databases to SYNC or FASTSYNC" in maximum availability and
 * SYNC in maximum protection; the prerequisites, "The current primary database
 * must have its LogXptMode property set accordingly", or the RedoRoutes
 * property configures it instead. What the primary would receive is read the
 * way the broker would ship it: the redo graph resolved with each candidate
 * target as the primary -- its LogXptMode, or the transport of a
 * pre-declared rule that names it. Received across a far sync instance, it is
 * the leg into the far sync that carries the guarantee, and maximum
 * protection cannot use a far sync at all. Anything deeper is a cascade, and
 * the cascade rules' concern. 26ai's prerequisites list adds ASYNC for
 * maximum availability, so there it is a warning.
 */
const PRIMARY_XPT_26AI_ASYNC_CITES: CitationId[] = [
  'FSFO.PREREQ_PRIMARY_XPT_26AI', 'FSFO.PREREQ_TRANSPORTS_26AI', 'XPT.MAXAVAIL_ASYNC_26AI',
  'FSFO.TASK3_MAXAVAIL_26AI',
];
assertCitesAllowed('MAXAVAIL_TRANSPORTS', PRIMARY_XPT_26AI_ASYNC_CITES);

export const primaryTransportAfterRoleChange: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  const mode = ctx.doc.config.protectionMode;
  if (mode === 'MAXPERFORMANCE') return [];
  const p = ctx.primary;
  if (!p) return [];
  const is26 = ctx.doc.config.edition === '26ai';
  const out: Finding[] = [];
  for (const id of ctx.candidates) {
    const t = ctx.member(id);
    if (!t || !isDatabase(t) || t.id === p.id) continue;
    const after = resolveRedoGraph(ctx.doc, { primary: t.id, net: ctx.net });
    const rp = after.members[p.id];
    /* 26ai names the RedoRoutes alternative to the primary's LogXptMode for
       maximum availability and maximum performance only ("If using either
       maximum availability or maximum performance mode, use the RedoRoutes
       property ..."): under maximum protection a pre-declared rule is not
       counted, and the primary's own LogXptMode is read. The 19c prerequisite
       names the alternative without that restriction. */
    const routesCount = !(is26 && mode === 'MAXPROTECTION');
    /* No route reaches it once the target is primary: the prerequisite still
       names the primary's own LogXptMode, so that is what is read. */
    const routed = routesCount && !!rp && rp.reachableFromPrimary && rp.feedPath.length >= 2;
    const path = routed ? (rp as { feedPath: MemberId[] }).feedPath : [t.id, p.id];
    const hop = ctx.member(path[1] as MemberId);
    const viaFarSync = path.length === 3 && !!hop && isFarSync(hop);
    if (path.length > 2 && !viaFarSync) continue;
    const leg = routed
      ? after.edges.find((e) => e.from === path[0] && e.to === path[1] && e.active)
      : undefined;
    if (routed && !leg) continue;
    const xpt = leg ? leg.xpt : p.logXptMode;
    const fromOwn = !leg || leg.xptSource === 'dest-logxptmode';

    const ok = mode === 'MAXPROTECTION'
      ? !viaFarSync && xpt === 'SYNC'
      : syncish(xpt);
    if (ok) continue;

    const pn = q(p.name);
    const tn = q(t.name);
    const why = !routed
      ? (routesCount
        ? `${pn} is the primary now, but after a role change to ${tn} it is the standby: no RedoRoutes rule would ship to it then, and its own LogXptMode is ${xpt}.`
        : `${pn} is the primary now, but after a role change to ${tn} it is the standby, and in maximum protection under 26ai the prerequisite is its own LogXptMode, ${xpt}: the RedoRoutes alternative is named for maximum availability and maximum performance only, so a rule that ships to it is not counted.`)
      : `${pn} is the primary now, but after a role change to ${tn} it is the standby, and it would receive ${xpt}${viaFarSync ? ` through the far sync instance ${q((hop as Member).name)}` : ''}, as set by ${fromOwn ? (viaFarSync ? 'the far sync instance\'s LogXptMode' : 'its own LogXptMode') : `the RedoRoutes rule ${tn} holds for it`}.`;
    const fix = (): Finding['fix'] | undefined => {
      const i = ctx.indexOf(p.id);
      if (i < 0 || viaFarSync || !fromOwn) return undefined;
      return {
        label: `Set LogXptMode on ${p.name} to SYNC`,
        patch: [{ op: 'replace', path: `/members/${i}/logXptMode`, value: 'SYNC' }],
      };
    };
    if (mode === 'MAXAVAILABILITY' && is26 && xpt === 'ASYNC') {
      out.push(mk('XPT.PRIMARY_LOGXPTMODE', {
        severity: 'warning',
        basis: 'conflict',
        subject: memberSubject(p),
        message: `${why} Under 26ai the fast-start failover prerequisites list SYNC, FASTSYNC or ASYNC for maximum availability, and the current primary must have its LogXptMode set accordingly, so ASYNC is allowed. Task 3 of the same chapter still says SYNC or FASTSYNC for both databases, and 26ai does not name the disagreement. Once ${pn} is the standby, nothing it receives is synchronous, and zero data loss still wants SYNC or FASTSYNC.`,
        cite: PRIMARY_XPT_26AI_ASYNC_CITES,
        note: 'The 26ai prerequisites list adds ASYNC for maximum availability; Task 3 of the same chapter (and Table 4-2) still give SYNC or FASTSYNC. The workbench warns and names the disagreement rather than choosing a side.',
        ...(fix() ? { fix: fix() } : {}),
      }));
      continue;
    }
    const wants = mode === 'MAXPROTECTION'
      ? `SYNC in maximum protection mode${viaFarSync ? ', where a far sync instance cannot be used to ship redo to a standby' : ''}`
      : 'SYNC or FASTSYNC in maximum availability mode';
    out.push(mk('XPT.PRIMARY_LOGXPTMODE', {
      subject: memberSubject(p),
      message: `${why} The fast-start failover prerequisites require the LogXptMode of both the primary and the target standby to be ${wants}, or the primary's transport to be configured with RedoRoutes. Oracle's own VALIDATE DATABASE example of a standby in this position reads "Switchover to this standby is not possible since there are no other standbys that can support the protection mode".${fix() ? ` EDIT DATABASE ${pn} SET PROPERTY 'LogXptMode' = 'SYNC';` : ''}`,
      cite: is26
        ? ['FSFO.PREREQ_PRIMARY_XPT_26AI', 'FSFO.PREREQ_TRANSPORTS_26AI', 'DGMGRL.VALIDATE_NO_SUPPORTING_STANDBY']
        : ['FSFO.TASK3_PRIMARY_XPT_19C', 'FSFO.PREREQ_TRANSPORTS_19C', 'DGMGRL.VALIDATE_NO_SUPPORTING_STANDBY'],
      ...(fix() ? { fix: fix() } : {}),
    }));
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
      message: `${q(m.name)} receives FASTSYNC while the configuration is in ${ctx.doc.config.protectionMode}. FASTSYNC arrived in 12.1 and is a maximum availability mode transport. It maps to SYNC with NOAFFIRM, which acknowledges received redo before writing it to the standby redo log.`,
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
      message: `The candidate fast-start failover target ${q(id as string)} is fed over FASTSYNC. Fast-start failover cannot be initiated while FASTSYNC is in use and the standby is missing redo data, because FASTSYNC acknowledges the redo before it is written to the standby redo log.`,
      cite: ['XPT.FASTSYNC_FSFO_GAP', 'XPT.AFFIRM_SEMANTICS'],
    }));
  }
  return out;
};

export const modeRules: Rule[] = [
  maxProtectionNeedsSyncDatabase, maxProtectionSnapshotOnly, maxProtectionOneStandby,
  atLeastOneSupportsMode, fsfoTargetTransport, primaryTransportAfterRoleChange,
  maxPerformanceOtherTransportNote,
  fastSyncMaxAvailOnly, fastSyncFsfoGap,
];

