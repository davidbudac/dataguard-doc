/**
 * Fast-start failover rules -- the target property, the far sync
 * prerequisites, the two lag properties and observe-only mode.
 *
 * The wording here is load-bearing. The target list is walked "in the order in
 * which they are specified", never "the first viable one in the list"; the far
 * sync mode exclusion is edition-gated and is a conflict between three pages;
 * and the lag limit's protection-mode question is cited only to the 26ai
 * chapter's "Fast-start Failover Protection Modes" section.
 */

import type { CitationId } from '../../citations';
import { assertCitesAllowed } from '../../citations';
import type { MemberId } from '../../ids';
import { lagLimitOf } from '../../defaults';
import type { Finding } from '../../types/claims';
import type { DatabaseMember, Member } from '../../types/topology';
import { isDatabase, isFarSync } from '../../types/topology';
import type { RedoEdge } from '../../types/trace';
import type { Rule, ValidateContext } from '../context';
import { configSubject, memberSubject, mk, q } from '../context';

/* The far sync leg feeding a target, when there is one. */
function farSyncHop(ctx: ValidateContext, target: MemberId): { fs: Member; toFs: RedoEdge; onward: RedoEdge } | null {
  const g = ctx.graph;
  if (!g) return null;
  const rm = g.members[target];
  if (!rm || rm.feedPath.length < 3) return null;
  const via = rm.feedPath[rm.feedPath.length - 2];
  const prev = rm.feedPath[rm.feedPath.length - 3];
  if (via === undefined || prev === undefined) return null;
  const fs = ctx.member(via);
  if (!fs || !isFarSync(fs)) return null;
  const toFs = g.edges.find((e) => e.from === prev && e.to === via && e.active && e.up);
  const onward = g.edges.find((e) => e.from === via && e.to === target && e.active && e.up);
  if (!toFs || !onward) return null;
  return { fs, toFs, onward };
}

/**
 * "FastStartFailoverTarget ... can only be set to the name of physical or
 * logical standbys. It cannot be set to the name of a snapshot standby
 * database, far sync instance, or Zero Data Loss Recovery Appliance." Targets
 * are verified when fast-start failover is enabled.
 */
export const targetKind: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const id of ctx.rawTargets) {
    const m = ctx.member(id);
    const name = q(id as string);
    if (!m) {
      out.push(mk('FSFO.TARGET_KIND', {
        subject: configSubject(),
        message: `FastStartFailoverTarget names ${name}, which is not a member of this configuration. The property can only be set to the name of a physical or logical standby, and targets are verified when fast-start failover is enabled.`,
        cite: ['FSFO.TARGET_KIND', 'FSFO.TARGET_VERIFIED_ON_ENABLE'],
      }));
      continue;
    }
    if (isFarSync(m)) {
      out.push(mk('FSFO.TARGET_KIND', {
        subject: memberSubject(m),
        message: `FastStartFailoverTarget names the far sync instance ${name}. The target standby cannot be a far-sync instance, although the target can receive redo from one.`,
        cite: ['FSFO.TARGET_KIND', 'FSFO.TARGET_NOT_FARSYNC'],
      }));
      continue;
    }
    if (isDatabase(m) && m.role !== 'physical' && m.role !== 'logical') {
      out.push(mk('FSFO.TARGET_KIND', {
        subject: memberSubject(m),
        message: `FastStartFailoverTarget names ${name}, a ${m.role} database. The property can only be set to the name of a physical or logical standby: not a snapshot standby database, not a far sync instance, not a Zero Data Loss Recovery Appliance.`,
        cite: ['FSFO.TARGET_KIND'],
      }));
    }
  }
  return out;
};

/**
 * "The selected standby database that will be the fast-start failover target
 * must receive redo directly from the primary database." A far sync feed is
 * the sanctioned exception; a cascaded terminal standby is the deduction --
 * there is no literal prohibition, which is why this is inferred.
 */
export const targetDirectRedo: Rule = (ctx): Finding[] => {
  const g = ctx.graph;
  if (!g) return [];
  const out: Finding[] = [];
  for (const id of ctx.candidates) {
    const rm = g.members[id];
    if (!rm) continue;
    if (rm.depth === 1) continue;
    if (farSyncHop(ctx, id)) continue;
    const name = q(id as string);
    const how = rm.depth < 0
      ? `no active redo route reaches it from ${q(g.primary as string)}`
      : `it receives redo through ${rm.feedPath.slice(1, -1).map((x) => q(x as string)).join(', ')}`;
    /* This is a condition of enabling fast-start failover, not of a candidate
       merely being named while it is disabled or observe-only: with it off,
       the page says only what enabling would require. */
    out.push(mk('FSFO.TARGET_DIRECT_REDO', {
      subject: memberSubject(id as string),
      ...(ctx.fsfoOn ? {} : { severity: 'info' as const }),
      message: ctx.fsfoOn
        ? `${name} is a fast-start failover candidate target, but ${how}. The selected standby database that will be the fast-start failover target must receive redo directly from the primary database; receiving it from a far sync instance is the only documented exception.`
        : `${name} is named as a fast-start failover candidate target while fast-start failover is disabled, but ${how}. Enabling fast-start failover would require it to receive redo directly from the primary database; receiving it from a far sync instance is the only documented exception.`,
      cite: ['FSFO.TARGET_DIRECT_REDO', 'CASCADE.TERMINAL_INDIRECT', 'FSFO.TARGET_NOT_FARSYNC'],
      note: 'Oracle states the direct-redo prerequisite and, separately, that a terminal standby receives primary redo indirectly from a cascading standby. There is no sentence forbidding a cascaded target outright -- this finding is the deduction from those two. A manual FAILOVER to a terminal standby stays documented, with the warning that no attempt is made to transmit any unsent redo from the cascader to the terminal standby.',
    }));
  }
  return out;
};

/**
 * With more than one standby database the property must be set explicitly --
 * a condition of enabling fast-start failover, so it fires as an error only
 * while fast-start failover is enabled or observe-only; disabled, it is at
 * most an info about what enabling would need.
 */
export const multiTargetExplicit: Rule = (ctx): Finding[] => {
  if (ctx.standbys.length <= 1) return [];
  if (ctx.targetIsAny || ctx.rawTargets.length > 0) return [];
  return [mk('FSFO.MULTI_TARGET_EXPLICIT', {
    subject: configSubject(),
    ...(ctx.fsfoOn ? {} : { severity: 'info' as const }),
    message: ctx.fsfoOn
      ? `The configuration holds ${ctx.standbys.length} standby databases and FastStartFailoverTarget is not set. With more than one standby database the property must be set explicitly. Multiple candidate targets arrived in 12.2, and the broker selects a target based on the order in which they are specified.`
      : `The configuration holds ${ctx.standbys.length} standby databases and FastStartFailoverTarget is not set. Fast-start failover is disabled, so this is not refused yet -- but enabling it would require the property to be set explicitly, naming candidates in the order the broker should walk them.`,
    cite: ['FSFO.TARGET_MUST_BE_EXPLICIT', 'FSFO.TARGET_ORDER', 'FSFO.MULTI_TARGET_12_2'],
  })];
};

/**
 * "To use a far sync instance with fast-start failover, the far sync instance
 * transport mode must be set to either SYNC or FASTSYNC and the target standby
 * database transport mode must be set to ASYNC."
 */
export const farSyncTransports: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  const out: Finding[] = [];
  for (const id of ctx.candidates) {
    const hop = farSyncHop(ctx, id);
    if (!hop) continue;
    const fsName = q(hop.fs.name);
    if (hop.toFs.xpt !== 'SYNC' && hop.toFs.xpt !== 'FASTSYNC') {
      out.push(mk('FSFO.FARSYNC_XPT', {
        subject: memberSubject(hop.fs),
        message: `${fsName} feeds the fast-start failover target ${q(id as string)} but receives ${hop.toFs.xpt}. To use a far sync instance with fast-start failover, the far sync instance transport mode must be set to either SYNC or FASTSYNC: EDIT FAR_SYNC ${fsName} SET PROPERTY 'LogXptMode' = 'SYNC';`,
        cite: ['FSFO.FARSYNC_XPT', 'FS.SYNC_TO_FARSYNC'],
      }));
    }
    if (hop.onward.xpt !== 'ASYNC') {
      out.push(mk('FSFO.FARSYNC_XPT', {
        subject: memberSubject(id as string),
        message: `The fast-start failover target ${q(id as string)} receives ${hop.onward.xpt} from ${fsName}. The target standby database transport mode must be set to ASYNC; the far sync instance uses ASYNC transport to ship the incoming redo to terminal standbys.`,
        cite: ['FSFO.FARSYNC_XPT', 'FS.ONWARD_ASYNC'],
      }));
    }
  }
  return out;
};

/**
 * The far sync protection-mode exclusion, edition-gated and a conflict of
 * three pages: 19c broker chapter 5 excludes maximum protection AND maximum
 * performance; the 26ai chapter drops the maximum performance half; Concepts
 * and Administration says far sync is "supported in either maximum performance
 * or maximum availability mode" and never mentions maximum protection. No ORA
 * number is documented for the refusal.
 */
export const farSyncModeGate: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  const g = ctx.graph;
  if (!g) return [];
  /* Scoped to a far sync used to send redo to the fast-start failover
     target, never to any far sync merely reachable from the primary --
     one feeding a bystander does not trip this gate. */
  const feedingIds = new Set<string>();
  for (const id of ctx.candidates) {
    const hop = farSyncHop(ctx, id);
    if (hop) feedingIds.add(hop.fs.id as string);
  }
  const feeding = ctx.farSyncs.filter((f) => feedingIds.has(f.id as string));
  if (feeding.length === 0) return [];
  const mode = ctx.doc.config.protectionMode;
  const is26 = ctx.doc.config.edition === '26ai';
  const excluded = mode === 'MAXPROTECTION' || (!is26 && mode === 'MAXPERFORMANCE');
  if (!excluded) return [];
  const names = feeding.map((f) => q(f.name)).join(', ');
  const rule = is26
    ? 'Under 26ai a far-sync instance cannot be used in maximum protection mode.'
    : 'Under 19c a far-sync instance cannot be used in maximum protection mode or maximum performance mode; 26ai drops the maximum performance exclusion.';
  return [mk('FSFO.FARSYNC_MODE_19C', {
    subject: configSubject(),
    message: `Fast-start failover is enabled with ${names} in the redo path and the configuration is in ${mode}. ${rule}`,
    cite: ['FSFO.FARSYNC_MODES_19C', 'FSFO.FARSYNC_MODES_26AI', 'FS.MODES_CA_19C'],
    note: 'Three pages disagree. The 19c broker fast-start failover prerequisites exclude maximum protection and maximum performance; the 26ai chapter states only the maximum protection exclusion; Concepts and Administration says a far sync instance is supported in either maximum performance or maximum availability mode and does not mention maximum protection at all. This engine applies the broker chapter for the edition being drawn. No ORA number is documented for the refusal.',
  })];
};

/**
 * Logical standby databases are not supported in maximum protection mode for
 * FSFO -- a condition of enabling fast-start failover, so it errors only
 * while fast-start failover is enabled or observe-only.
 */
export const logicalMaxProtection: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.protectionMode !== 'MAXPROTECTION') return [];
  const out: Finding[] = [];
  for (const id of ctx.candidates) {
    const m = ctx.member(id);
    if (!m || !isDatabase(m) || m.role !== 'logical') continue;
    out.push(mk('FSFO.LOGICAL_MAXPROT', {
      subject: memberSubject(m),
      ...(ctx.fsfoOn ? {} : { severity: 'info' as const }),
      message: ctx.fsfoOn
        ? `${q(m.name)} is a logical standby named as a fast-start failover candidate target while the configuration is in MAXPROTECTION. Logical standby databases are not supported in maximum protection mode for fast-start failover.`
        : `${q(m.name)} is a logical standby named as a fast-start failover candidate target while the configuration is in MAXPROTECTION, but fast-start failover is disabled. Enabling it would fail: logical standby databases are not supported in maximum protection mode for fast-start failover.`,
      cite: ['FSFO.LOGICAL_MAXPROT', 'FSFO.TARGET_KIND'],
    }));
  }
  return out;
};

/**
 * "It is recommended to set the FastStartFailoverLagLimit lower than or equal
 * to FastStartFailoverThreshold": past it the old primary can keep committing
 * after fast-start failover is initiated, briefly risking two primaries. The
 * recommendation is cited to the property page, which is a valid source for
 * the ranges and the recommendation -- never for which modes the limit applies
 * in.
 */
const LAG_RECOMMENDATION_CITES: CitationId[] = ['FSFO.LAGLIMIT_RECOMMENDATION'];
assertCitesAllowed('LAG_LIMIT_MODE', LAG_RECOMMENDATION_CITES);

export const lagLimitVsThreshold: Rule = (ctx): Finding[] => {
  const f = ctx.doc.config.fsfo;
  const limit = lagLimitOf(ctx.doc);
  if (!ctx.fsfoOn || limit <= f.thresholdSeconds) return [];
  const is19c = ctx.doc.config.edition === '19c';
  /* Only where the limit is in use: maximum performance, and maximum
     availability under 26ai. Under 19c maximum availability it reads
     "(not in use)", and it is never used in maximum protection. */
  const mode = ctx.doc.config.protectionMode;
  const inUse = mode === 'MAXPERFORMANCE' || (mode === 'MAXAVAILABILITY' && !is19c);
  if (!inUse) return [];
  return [mk('FSFO.LAGLIMIT_VS_THRESHOLD', {
    subject: configSubject(),
    ...(is19c ? { basis: 'doc-later' as const } : {}),
    message: `FastStartFailoverLagLimit is ${limit} s against a FastStartFailoverThreshold of ${f.thresholdSeconds} s. Oracle recommends the lag limit at or below the threshold: past it the old primary can keep committing after fast-start failover has been initiated, briefly risking two open primaries.`,
    cite: LAG_RECOMMENDATION_CITES,
    ...(is19c ? { note: 'The recommendation sentence is on the 26ai FastStartFailoverLagLimit property page only; the 19c property page does not carry it, so this reads doc-later under 19c even though the underlying risk -- two open primaries -- does not depend on the edition.' } : {}),
    fix: {
      label: `Set FastStartFailoverLagLimit to ${f.thresholdSeconds} s`,
      patch: [
        { op: 'replace', path: '/config/fsfo/lagLimitSeconds', value: f.thresholdSeconds },
        { op: 'add', path: '/config/fsfo/lagLimitSet', value: true },
      ],
    },
  })];
};

/**
 * FastStartFailoverLagType and FastStartFailoverLagGraceTime stay documented
 * as maximum-performance-mode behaviour whatever the lag limit is doing in
 * maximum availability under 26ai, and both gray out elsewhere.
 */
export const lagTypeMode: Rule = (ctx): Finding[] => {
  const f = ctx.doc.config.fsfo;
  const mode = ctx.doc.config.protectionMode;
  if (mode === 'MAXPERFORMANCE') return [];
  if (f.lagType !== 'TRANSPORT' && f.lagGraceTimeSeconds === 0) return [];
  const set = [
    f.lagType === 'TRANSPORT' ? "FastStartFailoverLagType = 'TRANSPORT'" : null,
    f.lagGraceTimeSeconds > 0 ? `FastStartFailoverLagGraceTime = ${f.lagGraceTimeSeconds}` : null,
  ].filter((s): s is string => s !== null).join(' and ');
  return [mk('FSFO.LAGTYPE_MODE', {
    subject: configSubject(),
    message: `${set} is set while the configuration is in ${mode}. Both properties stay documented as maximum performance mode behaviour whatever FastStartFailoverLagLimit is doing here, and both gray out; FastStartFailoverLagGraceTime is defined only while fast-start failover is enabled, and the LAGGING permission it grants comes from the observer or the target standby.`,
    cite: ['FSFO.LAGTYPE', 'FSFO.LAGGRACETIME'],
  })];
};

/**
 * ObserverPingInterval and ObserverPingRetry do not exist in 19c: absent from
 * the 12.2, 18c and 19c property pages and from a live 19.27 system. A 19c
 * document that sets either anyway (an old preset or an imported file can)
 * is an error, not a quiet no-op.
 */
export const pingPropsNotIn19c: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.edition !== '19c') return [];
  const f = ctx.doc.config.fsfo;
  if (f.pingIntervalMs === null && f.pingRetry === null) return [];
  return [mk('FSFO.PING_PROPS_NOT_IN_19C', {
    subject: configSubject(),
    message: 'ObserverPingInterval and/or ObserverPingRetry is set while the edition is 19c. Neither property exists in 19c: both are absent from the 12.2, 18c and 19c property pages, the fast-start failover chapter and the command reference, and from a live 19.27 system (SHOW CONFIGURATION VERBOSE lists neither; `strings` on the dgmgrl and oracle binaries finds neither name). Both are documented from 21c.',
    cite: ['FSFO.PING_PROPS_21C'],
    note: '19c is silent on these two properties; a later edition (21c) is the first to document them, which is what doc-later means here -- carried as an error because a 19c document setting them is not a legal 19c document, not merely an undocumented default.',
  })];
};

/**
 * FastStartFailoverLagType, FastStartFailoverLagGraceTime and
 * PrimaryDatabaseCandidates are documented from 26ai and absent from the 19c
 * and 21c property pages, yet all three are present in a live 19.27 system
 * (SHOW CONFIGURATION VERBOSE lists FastStartFailoverLagGraceTime = '0',
 * FastStartFailoverLagType = 'APPLY', PrimaryDatabaseCandidates = '';
 * SHOW FAST_START FAILOVER prints Lag Type: and Lag Grace Time:). That
 * reading is an observation, never documentation, so a 19c document that
 * sets one of the three reads doc-later rather than illegal.
 */
export const lagType19cDocLater: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.edition !== '19c') return [];
  const f = ctx.doc.config.fsfo;
  const set = [
    f.lagType === 'TRANSPORT' ? "FastStartFailoverLagType = 'TRANSPORT'" : null,
    f.lagGraceTimeSeconds > 0 ? `FastStartFailoverLagGraceTime = ${f.lagGraceTimeSeconds}` : null,
  ].filter((s): s is string => s !== null);
  if (set.length === 0) return [];
  return [mk('FSFO.LAGTYPE_GRACETIME_19C', {
    subject: configSubject(),
    message: `${set.join(' and ')} is set under 19c. Both properties are documented from 26ai; the 19c and 21c properties references do not mention them. A live 19.27 system carries them regardless (Lag Type: and Lag Grace Time: appear in SHOW FAST_START FAILOVER) -- an observation, never documentation, so this reads doc-later rather than as illegal under 19c.`,
    cite: ['FSFO.LAGTYPE', 'FSFO.LAGGRACETIME'],
    note: 'Observed present in a live 19.27 system\'s property list, which Oracle\'s 19c documentation does not mention.',
  })];
};

/** See lagType19cDocLater: the same 26ai-documented, 19.27-observed shape. */
export const primaryCandidates19cDocLater: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.edition !== '19c') return [];
  const list = ctx.doc.config.primaryDatabaseCandidates ?? [];
  if (list.length === 0) return [];
  return [mk('CFG.PRIMARY_CANDIDATES_19C', {
    subject: configSubject(),
    message: `PrimaryDatabaseCandidates is set under 19c. The property is documented from 26ai; the 19c and 21c properties references do not mention it. A live 19.27 system carries it regardless (SHOW CONFIGURATION VERBOSE lists PrimaryDatabaseCandidates = '') -- an observation, never documentation, so this reads doc-later rather than as illegal under 19c.`,
    cite: ['FSFO.PRIMARY_DB_CANDIDATES'],
    note: 'Observed present in a live 19.27 system\'s property list, which Oracle\'s 19c documentation does not mention.',
  })];
};

/**
 * Far sync feeding the fast-start failover target: the target property must
 * be set on both sides before the far sync route works for fast-start
 * failover (Scenario 7).
 */
export const farSyncTargetBothSides: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const id of ctx.candidates) {
    const hop = farSyncHop(ctx, id);
    if (!hop || seen.has(id as string)) continue;
    seen.add(id as string);
    out.push(mk('FSFO.FARSYNC_TARGET_BOTH_SIDES', {
      subject: memberSubject(id as string),
      message: `${q(id as string)} is the fast-start failover target and receives its redo through the far sync instance ${q(hop.fs.name)}. To enable fast-start failover when a far sync instance is used to ship redo data to the standby database, the FastStartFailoverTarget property must first be set on both the primary and the target standby database.`,
      cite: ['FSFO.FARSYNC_TARGET_SCENARIO7'],
    }));
  }
  return out;
};

/**
 * "The broker detected that the Flashback Database feature was disabled.
 * With Flashback Database disabled, the broker could not reinstate a
 * database that required reinstatement." ORA-16827, raised for the primary
 * or a candidate target with Flashback Database off while fast-start
 * failover is enabled, independent of FastStartFailoverAutoReinstate:
 * reinstatement can be attempted even with it FALSE, by a manual REINSTATE.
 */
export const flashbackRequired: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  const primary = ctx.primary;
  const involved = [primary, ...ctx.candidates.map((id) => ctx.member(id))]
    .filter((m): m is DatabaseMember => !!m && isDatabase(m));
  const missing = involved.filter((m) => !m.flashbackOn);
  if (missing.length === 0) return [];
  const names = missing.map((m) => q(m.name)).join(', ');
  return [mk('FSFO.FLASHBACK_REQUIRED', {
    subject: configSubject(),
    message: `Fast-start failover is enabled and Flashback Database is off on ${names}. The broker could not reinstate a database that required reinstatement with Flashback Database disabled -- ORA-16827 -- whether or not FastStartFailoverAutoReinstate is set.`,
    cite: ['ORA.16827'],
    ora: 'ORA-16827',
  })];
};

/** Observe-only: the observer watches and reports, and never fails over. */
export const observeOnly: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.fsfo.state !== 'observe-only') return [];
  return [mk('FSFO.OBSERVE_ONLY', {
    subject: configSubject(),
    message: 'Fast-start failover is enabled in observe-only mode (ENABLE FAST_START FAILOVER OBSERVE ONLY;). The observer reports "Unable to failover since this observer is in observe-only mode" and never fails over: the primary may open without acknowledgement, and switchover or failover to a bystander stays allowed.',
    cite: ['OBS.OBSERVE_ONLY'],
  })];
};

export const fsfoRules: Rule[] = [
  targetKind, targetDirectRedo, multiTargetExplicit, farSyncTransports, farSyncModeGate,
  logicalMaxProtection, lagLimitVsThreshold, lagTypeMode, pingPropsNotIn19c, lagType19cDocLater,
  primaryCandidates19cDocLater, farSyncTargetBothSides, flashbackRequired, observeOnly,
];

/** Exported for the transport rules, which need the same far sync hop. */
export { farSyncHop };
