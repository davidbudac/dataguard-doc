/**
 * Role transitions -- the planned switchover, the manual failover, what
 * happens to the bystanders, and the reinstate band (engine design SS4).
 *
 * The durations here are the two nominal drawing constants the published page
 * carries in footnote 3 plus the environment-dependent bands. Failover
 * execution -- terminal recovery, the role change, the open -- is
 * environment-dependent and not parameter-driven, and every band that draws it
 * says so.
 */

import { NOMINAL } from '../defaults';
import type { Claim, Finding } from '../types/claims';
import { conflict, documented, model } from '../types/claims';
import type { CitationId } from '../citations';
import type { MemberId, Seconds } from '../ids';
import type { TopologyDoc } from '../types/topology';
import type { DbRole, Member } from '../types/topology';
import { isDatabase, isRac } from '../types/topology';
import { activeRule } from '../redo/resolve';
import type { SwitchoverFacts } from './kernel';

/** Broker verifies both databases before it starts. Nominal, footnote 3. */
export const SW_VERIFY: Seconds = NOMINAL.switchoverVerifySeconds;
/** The primary converts to a standby; its sessions end here. Nominal, footnote 3. */
export const SW_CONVERT: Seconds = NOMINAL.switchoverConvertSeconds;

/**
 * Converting a snapshot standby back to a physical standby ahead of a manual
 * failover: the flashback to the restore point and the restart as a mounted
 * physical standby. Oracle gives the sequence and no duration, so this is a
 * nominal drawing constant of this page, not a documented number.
 */
export const SNAPSHOT_CONVERT: Seconds = 5;

export const nominalBandsClaim = (): Claim<[Seconds, Seconds]> =>
  model<[Seconds, Seconds]>([SW_VERIFY, SW_CONVERT],
    "The broker's own step list carries no durations: how long the checks and the conversion take is environment-dependent, exactly like the role change. The 1 s verify and 2 s convert bands are nominal drawing constants, not documented numbers.",
    ['SWITCHOVER.SESSIONS_END', 'SWITCHOVER.FORMER_PRIMARY_RESTARTS']);

/**
 * With fast-start failover enabled the broker permits a switchover only to the
 * CURRENT fast-start failover target -- not to any candidate the property
 * lists; anything else is ORA-16655 -- and only while that standby is
 * synchronized (maximum availability) or inside FastStartFailoverLagLimit
 * (maximum performance). Past the limit in maximum performance it REFUSES the
 * command: a refused SWITCHOVER, never a forbidden failover.
 *
 * The gate is fast-start failover's own, so it cannot fire where fast-start
 * failover is disabled or enabled OBSERVE ONLY, where a switchover -- and a
 * failover to a bystander -- stays documented as allowed.
 *
 * Before any of that, a switchover needs both databases: the broker verifies
 * the primary and the target, and "the primary and standby must be able to
 * communicate directly with each other". A far sync instance between them
 * changes nothing about that, available or not.
 */
export interface SwitchoverGateInput {
  fsfoEnabled: boolean;
  maxPerformance: boolean;
  gateLag: Seconds;
  lagLimit: Seconds;
  /** The member named by the command is the current fast-start failover target. */
  isTarget: boolean;
  /** The target has all of the primary's redo (maximum availability). */
  synchronized: boolean;
  /** The primary is running. */
  primaryUp: boolean;
  /** The member named by the command is running. */
  targetUp: boolean;
  /** The two reach each other directly. */
  connected: boolean;
  /** The role the member named by the command holds. */
  targetRole: DbRole;
  /** The configured protection mode is maximum protection. */
  maxProtection: boolean;
}

export type SwitchoverRefusal =
  | 'snapshot-target' | 'logical-maxprotection'
  | 'primary-down' | 'target-down' | 'not-connected'
  | 'not-target' | 'not-synchronized' | 'past-lag-limit';

export function switchoverGate(
  input: SwitchoverGateInput,
): { blocked: boolean; reason: SwitchoverRefusal | null; claim: Claim<boolean> } {
  const { fsfoEnabled, maxPerformance, gateLag, lagLimit, isTarget, synchronized } = input;
  /* The two restrictions that belong to the kind of standby the command names,
     whatever the state of anything else. */
  if (input.targetRole === 'snapshot') {
    return {
      blocked: true, reason: 'snapshot-target',
      claim: documented(true, ['SWITCHOVER.SNAPSHOT_NOT_TARGET', 'SWITCHOVER.SNAPSHOT_CONVERT_FIRST'],
        'A snapshot standby database cannot be the target of a switchover: it has to be converted back to a physical standby database first. (A manual failover to one is a different command, and legal while fast-start failover is disabled.)'),
    };
  }
  if (input.targetRole === 'logical' && input.maxProtection) {
    return {
      blocked: true, reason: 'logical-maxprotection',
      claim: documented(true, ['SWITCHOVER.LOGICAL_MAXPROT'],
        'Switchover to a logical standby database is disallowed when the configuration is operating in maximum protection mode.'),
    };
  }
  const needs: SwitchoverRefusal | null = !input.primaryUp ? 'primary-down'
    : !input.targetUp ? 'target-down'
      : !input.connected ? 'not-connected' : null;
  if (needs !== null) {
    return {
      blocked: true, reason: needs,
      claim: documented(true, ['SWITCHOVER.FARSYNC_NO_EFFECT', 'SWITCHOVER.FORMER_PRIMARY_RESTARTS'],
        needs === 'primary-down'
          ? 'A switchover is a planned role reversal between two running databases, and the primary is down: there is nothing to switch over from. What is left is a failover.'
          : needs === 'target-down'
            ? 'A switchover is a planned role reversal between two running databases, and the standby named by the command is down.'
            : 'During a switchover the primary and the standby must be able to communicate directly with each other, and these two cannot.'),
    };
  }
  if (!fsfoEnabled) {
    return {
      blocked: false, reason: null,
      claim: documented(false,
        ['SWITCHOVER.FSFO_GATE', 'FSFO.STATUS_DISABLED', 'OBS.OBSERVE_ONLY'],
        "The target and lag-limit refusals are fast-start failover's own gates, so they cannot fire where it is not enabled: fast-start failover disabled, or enabled OBSERVE ONLY -- in which the observer never fails over, and a switchover, or a failover to a bystander, is documented as still allowed. Nothing refuses the command; the swap just spends longer catching up."),
    };
  }
  const reason: SwitchoverRefusal | null = !isTarget ? 'not-target'
    : maxPerformance ? (gateLag > lagLimit ? 'past-lag-limit' : null)
      : (synchronized ? null : 'not-synchronized');
  const text = reason === 'not-target'
    ? 'Fast-start failover is enabled, and the broker permits a switchover only to the pre-specified target standby: this member is not the current fast-start failover target (ORA-16655).'
    : maxPerformance
      ? `Fast-start failover is enabled, so the broker permits the switchover only while the target is inside FastStartFailoverLagLimit: ${gateLag} s against ${lagLimit} s.`
      : synchronized
        ? 'Fast-start failover is enabled and the target is synchronized. An apply lag does not block maximum availability -- synchronized is about redo received, so the lag only lengthens the catch-up.'
        : 'Fast-start failover is enabled and the target is not synchronized: in maximum availability the broker permits the switchover only while the pre-specified target standby is synchronized. Redo it has not received is what blocks it; an apply lag alone would not.';
  const cite: CitationId[] = reason === 'not-target'
    ? ['SWITCHOVER.FSFO_GATE', 'SWITCHOVER.FSFO_TARGET_ONLY', 'ORA.16655']
    : ['SWITCHOVER.FSFO_GATE'];
  return { blocked: reason !== null, reason, claim: documented(reason !== null, cite, text) };
}

/**
 * The bands of a permitted switchover, measured from the command.
 *
 * The former primary restarts as the new standby in parallel: "the new primary
 * database does not need to be restarted", and it does not wait for the old
 * one, so that band is drawn past the open with no endpoint of its own.
 */
export function switchoverSchedule(
  at: Seconds, to: MemberId, applyRemaining: Seconds, roleTransition: Seconds,
): SwitchoverFacts {
  const tDown = at + SW_VERIFY;
  const tConvertEnd = tDown + SW_CONVERT;
  const tOpen = tConvertEnd + applyRemaining + roleTransition;
  return {
    at, to, tDown, tConvertEnd, tOpen,
    downtime: tOpen - tDown,
    tRestartDraw: tOpen + Math.max(2, tOpen * 0.08),
    blocked: false,
    applyRemaining,
  };
}

export function switchoverRefused(
  at: Seconds, to: MemberId, refusal?: SwitchoverRefusal | null,
): SwitchoverFacts {
  const facts: SwitchoverFacts = {
    at, to, tDown: null, tConvertEnd: null, tOpen: null, downtime: null,
    tRestartDraw: null, blocked: true, applyRemaining: 0,
  };
  if (refusal) facts.refusal = refusal;
  return facts;
}

export const switchoverLossClaim = (): Claim<number> =>
  documented(0, ['SWITCHOVER.ZERO_LOSS'],
    'A switchover is zero data loss in every protection mode: the roles swap only once the standby has everything. No failover clock runs at all -- the threshold, the ObserverPing properties and FastStartFailoverPmyShutdown are spectators.');

/** Terminal recovery, the role change and the open. */
export const executionClaim = (roleTransition: Seconds): Claim<Seconds> =>
  model(roleTransition,
    'EXEC.ENV_DEPENDENT: failover execution -- terminal recovery, the role change and the open -- is environment-dependent, not parameter-driven. The seconds drawn here are the workbench\'s own input, never a documented duration.',
    ['SWITCHOVER.FORMER_PRIMARY_RESTARTS']);

/* ---------------- logical standby as the new primary ---------------- */

/**
 * The members a role change to a logical standby leaves behind: "All physical
 * and snapshot standby databases will be disabled and must be re-created from
 * a copy of the new primary database". After a failover the original primary
 * goes with them. Other logical standbys are not named, so they stay with the
 * ordinary bystander rules.
 */
export function disabledByLogicalRole(
  doc: TopologyDoc, newPrimary: MemberId, former: MemberId | null, failover: boolean,
): MemberId[] {
  const out: MemberId[] = [];
  for (const m of doc.members) {
    if (!isDatabase(m) || m.id === newPrimary) continue;
    if (m.role === 'physical' || m.role === 'snapshot' || (failover && m.id === former)) out.push(m.id);
  }
  return out;
}

export const logicalRoleClaim = (failover: boolean, count: number): Claim<string> =>
  documented(
    `${count} member${count === 1 ? ' is' : 's are'} disabled and must be re-created from a copy of the new primary.`,
    [failover ? 'FAILOVER.LOGICAL_DISABLES_OTHERS' : 'SWITCHOVER.LOGICAL_DISABLES_OTHERS'],
    failover
      ? 'The failover target is a logical standby database: the original primary database and all physical and snapshot standby databases in the configuration will be disabled. They do not follow the new primary, whatever BystandersFollowRoleChange says.'
      : 'The switchover target is a logical standby database: all physical and snapshot standby databases will be disabled and must be re-created from a copy of the new primary database. They do not follow the new primary.');

/* ---------------- redo a standby has not applied ---------------- */

/**
 * Redo a standby holds but has not applied, beyond its apply lag: a standby
 * whose apply is stopped for the run, or a snapshot standby (which applies
 * nothing it receives), has piled up everything the primary generated while it
 * ran in this run. Drawn 1:1, as this page draws every apply lag. Zero for a
 * standby that is applying.
 */
export function unappliedBacklog(m: Member, ranFor: Seconds): Seconds {
  if (!isDatabase(m) || m.role === 'primary') return 0;
  if (m.role === 'snapshot') return ranFor;
  return m.applyRunning ? 0 : ranFor;
}

/**
 * "Waits for the target standby database to finish applying any unapplied redo
 * data before stopping Redo Apply" is the documented step. How much redo is
 * outstanding when apply was stopped, and how long applying it takes, is this
 * page's arithmetic.
 */
export const unappliedWaitClaim = (target: MemberId, backlog: Seconds): Claim<string> =>
  model(
    `${target as string} has apply stopped, so the failover first waits for the ${backlog} s of redo the primary generated in this run to be applied.`,
    'FAILOVER.APPLY_WAIT_SIZE: that the broker waits for the target to finish applying unapplied redo is documented. How much is outstanding when apply was stopped for the run, and how long applying it takes, is this page\'s model: the primary\'s running time, applied 1:1 as every apply lag on this page is.',
    ['FAILOVER.WAITS_FOR_APPLY']);

/* ---------------- manual failover to a snapshot standby ---------------- */

const SNAPSHOT_FAILOVER_CONFLICT =
  'The documentation disagrees with itself and does not say so. The role-transitions concepts page says "A snapshot standby cannot be the target of a role transition."; the broker commands page says a snapshot standby "can be the target of a manual failover if fast-start failover is disabled". This page follows the broker, which describes the procedure, and draws the failover.';

/** That a manual failover to a snapshot standby is allowed at all is a conflict between two pages. */
export const snapshotFailoverAllowedClaim = (target: MemberId): Claim<string> =>
  conflict(
    `FAILOVER TO ${target as string} is accepted although ${target as string} is a snapshot standby.`,
    ['FAILOVER.SNAPSHOT_MANUAL_ALLOWED', 'ROLES.SNAPSHOT_NO_ROLE_TRANSITION', 'SWITCHOVER.SNAPSHOT_NOT_TARGET'],
    SNAPSHOT_FAILOVER_CONFLICT);

/** What the broker does first: documented. */
export const snapshotConvertApplyClaim = (target: MemberId): Claim<string> =>
  documented(
    `For a failover to a snapshot standby, the broker first converts ${target as string} back to a physical standby and then starts Redo Apply to apply all the accumulated redo.`,
    ['FAILOVER.SNAPSHOT_CONVERT_APPLY']);

/** How long: this page's. */
export const snapshotConvertBandClaim = (
  target: MemberId, convert: Seconds, apply: Seconds, immediate: boolean,
): Claim<string> =>
  model(
    immediate
      ? `${target as string} converts back to a physical standby (${convert} s drawn); an IMMEDIATE failover applies none of the accumulated redo.`
      : `${target as string} converts back to a physical standby (${convert} s drawn), then applies the accumulated redo (${apply} s drawn), before the role change begins.`,
    'FAILOVER.SNAPSHOT_BAND: the sequence -- convert, then apply the accumulated redo -- is documented; the durations are not. The convert is a nominal drawing constant, and the redo to apply is the primary\'s running time in this run plus the configured apply lag, applied 1:1 as every apply lag on this page is. An IMMEDIATE failover is drawn with the convert and no apply; the documentation states the sequence for the complete failover only.',
    ['FAILOVER.SNAPSHOT_CONVERT_APPLY']);

export const snapshotFailoverFinding = (target: MemberId): Finding => ({
  id: 'FAILOVER.SNAPSHOT_CONVERTS', severity: 'info', basis: 'conflict',
  cite: ['FAILOVER.SNAPSHOT_MANUAL_ALLOWED', 'ROLES.SNAPSHOT_NO_ROLE_TRANSITION', 'FAILOVER.SNAPSHOT_CONVERT_APPLY'],
  subject: { kind: 'member', id: target as string },
  message: `${target as string} is a snapshot standby. A manual failover to it is allowed while fast-start failover is disabled, and the broker first converts it back to a physical standby and starts Redo Apply on the accumulated redo, so it opens later than a physical standby would.`,
  note: SNAPSHOT_FAILOVER_CONFLICT,
});

/* ---------------- bystanders ---------------- */

export function bystanders(doc: TopologyDoc, newPrimary: MemberId): MemberId[] {
  return doc.members
    .filter((m) => isDatabase(m) && m.id !== newPrimary && m.role !== 'primary')
    .map((m) => m.id);
}

export const bystanderClaim = (follow: 'ALL' | 'NONE'): Claim<'ALL' | 'NONE'> =>
  follow === 'ALL'
    ? documented(follow, ['BYSTANDERS.DEFAULT_ALL', 'BYSTANDERS.ALL_AHEAD_DISABLED'],
      'BystandersFollowRoleChange is ALL, the default: during the failover the broker determines whether each bystander standby is ahead of or behind the failover target. One that is behind simply gets its redo transport from the new primary; one that is ahead is disabled with a status of ORA-16661 and must be reinstated after the failover completes.')
    : documented(follow, ['BYSTANDERS.DEFAULT_ALL', 'BYSTANDERS.NONE_DISABLED'],
      'BystandersFollowRoleChange is NONE: the broker does not evaluate the bystander standbys as part of the failover. They are marked as disabled with a status of ORA-16661 so that they can be evaluated later, and the broker completes the failover as soon as possible.');

/**
 * A member whose RedoRoutes is not NULL but has no rule whose source is the new
 * primary. The rule is inactive -- "A redo routing rule is active if its redo
 * source field specifies the current primary database" -- but what the member
 * does instead is on no page: the NULL default is documented, a non-NULL
 * property with no rule for the new primary is not. This engine ships nothing
 * from it (it does not fall back to the default), and says that is its reading.
 */
export function noRuleForNewPrimary(
  doc: TopologyDoc, newPrimary: MemberId, memberIds: readonly MemberId[],
): Finding[] {
  const out: Finding[] = [];
  for (const id of memberIds) {
    const m = doc.members.find((x) => x.id === id);
    if (!m || !m.enabled || !isDatabase(m)) continue;
    if (m.redoRoutes.length === 0 || activeRule(m, newPrimary) !== undefined) continue;
    const role = id === newPrimary ? 'the new primary' : 'a bystander';
    out.push({
      id: 'ROUTES.NO_RULE_FOR_NEW_PRIMARY', severity: 'info', basis: 'model',
      cite: ['ROUTES.RULE_ACTIVE', 'ROUTES.DEFAULT_NULL'],
      subject: { kind: 'member', id: id as string },
      message: `${m.name}, ${role}, has a RedoRoutes property but no rule whose source is ${newPrimary as string}, so none of its rules is active and this run ships nothing from it.`,
      note: `ROUTES.NO_RULE_FOR_NEW_PRIMARY: "A redo routing rule is active if its redo source field specifies the current primary database" says the rules for the old primary are inactive. What a member with a non-NULL RedoRoutes and no rule for the new primary does instead is not documented (the NULL default is "(LOCAL : ALL) at a primary database", and this property is not NULL). This engine draws it shipping nothing -- not falling back to the default -- which is this page's reading; a member that is meant to ship after a role change needs a rule for that direction pre-declared.`,
    });
  }
  return out;
}

/**
 * A bystander that holds redo the new primary never received. That the broker
 * disables it is documented; which bystander is ahead is read here off the
 * redo each member is missing, which is this page's arithmetic.
 */
export const bystanderAhead = (
  bystander: MemberId, target: MemberId, behindBystander: Seconds, behindTarget: Seconds,
): { claim: Claim<string>; finding: Finding } => {
  const text = `${bystander as string} is ahead of ${target as string}: it is missing ${behindBystander} s of the primary's redo where the new primary was missing ${behindTarget} s. The broker disables it with a status of ORA-16661, and it must be reinstated after the failover completes.`;
  const note = 'BYSTANDERS.AHEAD: that a bystander ahead of the failover target is disabled is documented. Which one is ahead is this page\'s arithmetic over the transport lag as configured and the time the primary ran without each member.';
  const cite: CitationId[] = ['BYSTANDERS.ALL_AHEAD_DISABLED', 'ORA.16661'];
  return {
    claim: model(text, note, cite),
    finding: {
      id: 'BYSTANDERS.AHEAD_DISABLED', severity: 'warning', basis: 'model', cite,
      subject: { kind: 'member', id: bystander as string },
      message: text, note, ora: 'ORA-16661',
    },
  };
};

/* ---------------- manual failover ---------------- */

/**
 * "You can perform a manual failover even if fast-start failover is enabled"
 * holds only where the target is the CURRENT fast-start failover target, that
 * standby is synchronized (maximum availability/protection) or within the lag
 * limit (maximum performance), and "the observer is started and communicating
 * with the target standby database", with the primary shut down first. An
 * unobserved configuration fails the third condition: DISABLE FAST_START
 * FAILOVER FORCE first. An IMMEDIATE failover is not available at all while
 * fast-start failover is enabled.
 *
 * `refused` is what the broker does about it: a command that fails one of the
 * fast-start failover conditions, or names a standby that is not running, is
 * not executed and nothing changes role. A primary that is still open is
 * different -- the broker cannot see to it that the operator shut it down --
 * so that one is an error the run carries while the failover is drawn.
 */
export interface ManualFailoverInput {
  fsfoEnabled: boolean;
  /** The member named is the current fast-start failover target. */
  isFsfoTarget: boolean;
  ready: boolean;
  observerTalksToTarget: boolean;
  cascaded: boolean;
  immediate: boolean;
  targetUp: boolean;
  /** The primary is still running when the command is issued. */
  primaryUp: boolean;
}

export function manualFailoverFindings(
  doc: TopologyDoc, target: MemberId, opts: ManualFailoverInput,
): { findings: Finding[]; refused: boolean } {
  const out: Finding[] = [];
  let refused = false;
  const subject = { kind: 'member' as const, id: target as string };
  if (!opts.targetUp) {
    refused = true;
    out.push({
      id: 'FAILOVER.TARGET_DOWN', severity: 'error', basis: 'model',
      cite: ['FAILOVER.PRIMARY_SHUT_DOWN', 'FSFO.MANUAL_FAILOVER_CONDITIONS'], subject,
      message: `FAILOVER TO ${target as string} is refused: ${target as string} is not running, and a failover is carried out on the standby that becomes the primary. Nothing changes role.`,
      note: 'FAILOVER.TARGET_DOWN: the FAILOVER command is issued while connected to the standby that is to become the primary, so a standby that is down cannot be failed over to. The documentation states the procedure, not this refusal in so many words.',
    });
  }
  if (opts.fsfoEnabled && opts.immediate) {
    refused = true;
    out.push({
      id: 'FAILOVER.IMMEDIATE_WITH_FSFO', severity: 'error', basis: 'documented',
      cite: ['FAILOVER.NO_IMMEDIATE_WITH_FSFO'], subject,
      message: 'FAILOVER ... IMMEDIATE is refused: you cannot perform an immediate manual failover when fast-start failover is enabled.',
    });
  }
  if (opts.fsfoEnabled && !opts.observerTalksToTarget) {
    refused = true;
    out.push({
      id: 'FSFO.MANUAL_FAILOVER_UNOBSERVED', severity: 'error', basis: 'documented',
      cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'ORA.16658'], subject,
      message: 'A manual failover with fast-start failover enabled needs the observer started and communicating with the target standby: DISABLE FAST_START FAILOVER FORCE first.',
      ora: 'ORA-16658',
    });
  }
  if (opts.fsfoEnabled && !opts.isFsfoTarget) {
    refused = true;
    out.push({
      id: 'FSFO.MANUAL_FAILOVER_NOT_TARGET', severity: 'error', basis: 'documented',
      cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'FAILOVER.CURRENT_TARGET_ONLY', 'ORA.16655'], subject,
      message: 'With fast-start failover enabled a manual failover can only be performed to the current fast-start failover target standby, and this member is not it.',
      ora: 'ORA-16655',
    });
  }
  if (opts.fsfoEnabled && !opts.ready) {
    refused = true;
    out.push({
      id: 'FSFO.MANUAL_FAILOVER_NOT_READY', severity: 'error', basis: 'documented',
      cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'FAILOVER.NO_IMMEDIATE_WITH_FSFO'], subject,
      message: 'With fast-start failover enabled the target must be synchronized (maximum availability or protection) or inside the lag limit (maximum performance) for a manual failover.',
    });
  }
  if (opts.primaryUp) {
    out.push({
      id: 'FAILOVER.PRIMARY_STILL_OPEN', severity: 'error', basis: 'documented',
      cite: opts.fsfoEnabled
        ? ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'FAILOVER.PRIMARY_SHUT_DOWN']
        : ['FAILOVER.PRIMARY_SHUT_DOWN'],
      subject,
      message: opts.fsfoEnabled
        ? 'The primary database is still running. "You must ensure that the primary database is shut down prior to performing a manual failover."'
        : 'The primary database is still running. "Before beginning a failover, first determine that there is no possibility of recovering the primary database in a timely manner, and ensure that the primary database is shut down." Until it is, two databases are open as the primary.',
    });
  }
  if (opts.cascaded) {
    out.push({
      id: 'CASCADE.MANUAL_FAILOVER_TERMINAL', severity: 'warning', basis: 'documented',
      cite: ['CASCADE.MANUAL_FAILOVER_UNSENT', 'FSFO.TARGET_DIRECT_REDO'], subject,
      message: 'Manual failover to a terminal standby is documented and legal, but no attempt is made to transmit any unsent redo from the cascader to the terminal standby.',
    });
  }
  void doc;
  return { findings: out, refused };
}

/**
 * What a manual failover loses. Nothing bounds it: "There may or may not be
 * data loss depending upon whether your primary and target standby databases
 * were synchronized at the time of the primary database failure." The number
 * is this page's arithmetic and is never a documented figure.
 */
export function manualLossClaim(
  seconds: Seconds, parts: { ranWithout: Seconds; lag: Seconds; lagIs: 'transport' | 'apply' | 'none' },
): Claim<number> {
  const lagText = parts.lagIs === 'none' ? ''
    : parts.lagIs === 'apply'
      ? ` plus the ${parts.lag} s apply lag, drawn 1:1 as the published page draws it`
      : ` plus the ${parts.lag} s of redo the transport had not delivered`;
  return model(seconds,
    `FAILOVER.LOSS_MODEL: a manual failover promotes the standby with whatever redo it holds, and nothing bounds what is lost. The number is the ${parts.ranWithout} s the primary generated redo this standby never received${lagText} -- the workbench's own arithmetic, not a documented figure.${seconds === 0 ? ' Zero here means the standby was synchronized when the primary failed, not that a manual failover is lossless.' : ''}`,
    ['FAILOVER.LOSS_DEPENDS']);
}

/* ---------------- reinstate ---------------- */

/**
 * FastStartFailoverAutoReinstate is narrower than "the old primary returns":
 * it reinstates only after an observer-initiated failover caused by a primary
 * crash or isolation, and needs Flashback Database on both databases, the
 * former primary started and mounted, the master observer able to reach it,
 * and static service names without Clusterware or Oracle Restart. How long it
 * takes is environment-dependent, so the band is open.
 */
export function reinstateFindings(
  doc: TopologyDoc, former: MemberId, newPrimary: MemberId,
): Finding[] {
  const out: Finding[] = [];
  const f = doc.members.find((m) => m.id === former);
  const n = doc.members.find((m) => m.id === newPrimary);
  const missing: string[] = [];
  if (f && isDatabase(f) && !f.flashbackOn) missing.push(`Flashback Database is off on ${f.name}`);
  if (n && isDatabase(n) && !n.flashbackOn) missing.push(`Flashback Database is off on ${n.name}`);
  /* Static service names are needed only without Oracle Clusterware or Oracle
     Restart, and a RAC database runs under Clusterware. */
  if (f && isDatabase(f) && !f.staticServices && !isRac(f)) missing.push(`${f.name} has no static service names`);
  if (!doc.config.fsfo.autoReinstate) missing.push('FastStartFailoverAutoReinstate is FALSE');
  if (missing.length > 0) {
    out.push({
      id: 'REINSTATE.PRECONDITIONS', severity: 'warning', basis: 'documented',
      cite: ['FSFO.AUTO_REINSTATE', 'RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE', 'RAC.CLUSTERWARE_REQUIRED'],
      subject: { kind: 'member', id: former as string },
      message: `Automatic reinstatement of ${former} is not available here: ${missing.join('; ')}. It reinstates only after an observer-initiated failover caused by a primary crash or isolation, and needs Flashback Database on both databases, the former primary started and mounted, the master observer able to reach it, and static service names without Clusterware or Oracle Restart.`,
    });
  }
  return out;
}

/**
 * REINSTATE DATABASE, the command. It is for a database a failover left
 * behind, it needs Flashback Database to have been enabled on that database
 * before the failover, and the database has to be up and in contact with the
 * new primary. Where one of those is missing nothing is reinstated, so no
 * band is drawn.
 */
export function reinstateCommandFindings(
  doc: TopologyDoc, member: MemberId, opts: {
    needsReinstate: boolean; up: boolean; reachesPrimary: boolean; newPrimary: MemberId | null;
  },
): Finding[] {
  const m = doc.members.find((x) => x.id === member);
  const n = opts.newPrimary ? doc.members.find((x) => x.id === opts.newPrimary) : undefined;
  const subject = { kind: 'member' as const, id: member as string };
  if (!opts.needsReinstate) {
    return [{
      id: 'REINSTATE.NOTHING_TO_REINSTATE', severity: 'warning', basis: 'documented',
      cite: ['REINSTATE.NEEDS_FLASHBACK', 'FSFO.AUTO_REINSTATE'], subject,
      message: `REINSTATE DATABASE ${member as string} does nothing here: reinstatement is supported only after a failover, for a database the failover left needing it.`,
    }];
  }
  const missing: string[] = [];
  if (m && isDatabase(m) && !m.flashbackOn) missing.push(`Flashback Database was not enabled on ${m.name} before the failover`);
  if (n && isDatabase(n) && !n.flashbackOn) missing.push(`Flashback Database is off on ${n.name}`);
  if (!opts.up) missing.push(`${m?.name ?? (member as string)} is not started and mounted`);
  else if (!opts.reachesPrimary) missing.push(`${m?.name ?? (member as string)} and the new primary have no network connectivity`);
  if (missing.length === 0) return [];
  return [{
    id: 'REINSTATE.COMMAND_PRECONDITIONS', severity: 'error', basis: 'documented',
    cite: ['REINSTATE.NEEDS_FLASHBACK', 'FSFO.FORMER_PRIMARY_NOT_OPEN'], subject,
    message: `REINSTATE DATABASE ${member as string} cannot succeed: ${missing.join('; ')}. For the REINSTATE command to succeed, Flashback Database must have been enabled on the database prior to the failover, and the database to be reinstated and the new primary database must have network connectivity. Without it the database has to be re-created from a copy of the new primary.`,
  }];
}

export const reinstateBandClaim = (): Claim<null> =>
  model(null,
    'REINSTATE.DURATION_ENV: how long a reinstatement takes is environment-dependent -- the flashback and the redo the former primary has to replay -- so the band is drawn with no end.',
    ['FSFO.AUTO_REINSTATE']);
