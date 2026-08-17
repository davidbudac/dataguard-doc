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
import { documented, model } from '../types/claims';
import type { MemberId, Seconds } from '../ids';
import type { TopologyDoc } from '../types/topology';
import { isDatabase } from '../types/topology';
import type { SwitchoverFacts } from './kernel';

/** Broker verifies both databases before it starts. Nominal, footnote 3. */
export const SW_VERIFY: Seconds = NOMINAL.switchoverVerifySeconds;
/** The primary converts to a standby; its sessions end here. Nominal, footnote 3. */
export const SW_CONVERT: Seconds = NOMINAL.switchoverConvertSeconds;

export const nominalBandsClaim = (): Claim<[Seconds, Seconds]> =>
  model<[Seconds, Seconds]>([SW_VERIFY, SW_CONVERT],
    "The broker's own step list carries no durations: how long the checks and the conversion take is environment-dependent, exactly like the role change. The 1 s verify and 2 s convert bands are nominal drawing constants, not documented numbers.",
    ['SWITCHOVER.SESSIONS_END', 'SWITCHOVER.FORMER_PRIMARY_RESTARTS']);

/**
 * With fast-start failover enabled the broker permits a switchover only to the
 * pre-specified target standby, and only while that standby is synchronized
 * (maximum availability) or inside FastStartFailoverLagLimit (maximum
 * performance). Past the limit in maximum performance it REFUSES the command:
 * a refused SWITCHOVER, never a forbidden failover.
 *
 * The gate is fast-start failover's own, so it cannot fire where nothing was
 * ever armed: no observer deployed, fast-start failover disabled, or enabled
 * OBSERVE ONLY, where a switchover -- and a failover to a bystander -- stays
 * documented as allowed.
 */
export interface SwitchoverGateInput {
  fsfoEnabled: boolean;
  maxPerformance: boolean;
  gateLag: Seconds;
  lagLimit: Seconds;
  /** The member named by the command is one of the FastStartFailoverTarget candidates. */
  isTarget: boolean;
  /** What the target was worth the last time redo reached it (maximum availability). */
  synchronized: boolean;
}

export type SwitchoverRefusal = 'not-target' | 'not-synchronized' | 'past-lag-limit';

export function switchoverGate(
  input: SwitchoverGateInput,
): { blocked: boolean; reason: SwitchoverRefusal | null; claim: Claim<boolean> } {
  const { fsfoEnabled, maxPerformance, gateLag, lagLimit, isTarget, synchronized } = input;
  if (!fsfoEnabled) {
    return {
      blocked: false, reason: null,
      claim: documented(false,
        ['SWITCHOVER.FSFO_GATE', 'FSFO.STATUS_DISABLED', 'OBS.OBSERVE_ONLY'],
        "The target and lag-limit refusals are fast-start failover's own gates, so they cannot fire where nothing is armed: no observer deployed, fast-start failover disabled, or enabled OBSERVE ONLY -- in which the observer never fails over, and a switchover, or a failover to a bystander, is documented as still allowed. Nothing refuses the command; the swap just spends longer catching up."),
    };
  }
  const reason: SwitchoverRefusal | null = !isTarget ? 'not-target'
    : maxPerformance ? (gateLag > lagLimit ? 'past-lag-limit' : null)
      : (synchronized ? null : 'not-synchronized');
  const text = reason === 'not-target'
    ? 'Fast-start failover is enabled, and the broker permits a switchover only to the pre-specified target standby: this member is not one of the FastStartFailoverTarget candidates.'
    : maxPerformance
      ? `Fast-start failover is enabled, so the broker permits the switchover only while the target is inside FastStartFailoverLagLimit: ${gateLag} s against ${lagLimit} s.`
      : synchronized
        ? 'Fast-start failover is enabled and the target is synchronized. An apply lag does not block maximum availability -- synchronized is about redo received, so the lag only lengthens the catch-up.'
        : 'Fast-start failover is enabled and the target is not synchronized: in maximum availability the broker permits the switchover only while the pre-specified target standby is synchronized. Redo it has not received is what blocks it; an apply lag alone would not.';
  return { blocked: reason !== null, reason, claim: documented(reason !== null, ['SWITCHOVER.FSFO_GATE'], text) };
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

export function switchoverRefused(at: Seconds, to: MemberId): SwitchoverFacts {
  return {
    at, to, tDown: null, tConvertEnd: null, tOpen: null, downtime: null,
    tRestartDraw: null, blocked: true, applyRemaining: 0,
  };
}

export const switchoverLossClaim = (): Claim<number> =>
  documented(0, ['SWITCHOVER.ZERO_LOSS'],
    'A switchover is zero data loss in every protection mode: the roles swap only once the standby has everything. No failover clock runs at all -- the threshold, the ObserverPing properties and FastStartFailoverPmyShutdown are spectators, and fast-start failover stays enabled across the swap.');

/** Terminal recovery, the role change and the open. */
export const executionClaim = (roleTransition: Seconds): Claim<Seconds> =>
  model(roleTransition,
    'EXEC.ENV_DEPENDENT: failover execution -- terminal recovery, the role change and the open -- is environment-dependent, not parameter-driven. The seconds drawn here are the workbench\'s own input, never a documented duration.',
    ['SWITCHOVER.FORMER_PRIMARY_RESTARTS']);

/* ---------------- bystanders ---------------- */

export function bystanders(doc: TopologyDoc, newPrimary: MemberId): MemberId[] {
  return doc.members
    .filter((m) => isDatabase(m) && m.id !== newPrimary && m.role !== 'primary')
    .map((m) => m.id);
}

export const bystanderClaim = (follow: 'ALL' | 'NONE'): Claim<'ALL' | 'NONE'> =>
  documented(follow, ['BYSTANDERS.DEFAULT_ALL'],
    follow === 'ALL'
      ? 'BystandersFollowRoleChange is ALL, the default: the bystander standbys follow the role change and are viability-checked on a complete failover.'
      : 'BystandersFollowRoleChange is NONE, so the bystanders do not follow the role change and are left out of the new configuration.');

/* ---------------- manual failover ---------------- */

/**
 * "You can perform a manual failover even if fast-start failover is enabled"
 * holds only where the target is the FastStartFailoverTarget standby, that
 * standby is synchronized (maximum availability/protection) or within the lag
 * limit (maximum performance), and "the observer is started and communicating
 * with the target standby database", with the primary shut down first. An
 * unobserved configuration fails the third condition: DISABLE FAST_START
 * FAILOVER FORCE first.
 */
export function manualFailoverFindings(
  doc: TopologyDoc, target: MemberId, opts: {
    fsfoEnabled: boolean; isFsfoTarget: boolean; ready: boolean; observerTalksToTarget: boolean;
    cascaded: boolean;
  },
): Finding[] {
  const out: Finding[] = [];
  if (opts.fsfoEnabled && !opts.observerTalksToTarget) {
    out.push({
      id: 'FSFO.MANUAL_FAILOVER_UNOBSERVED', severity: 'error', basis: 'documented',
      cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'ORA.16658'],
      subject: { kind: 'member', id: target as string },
      message: 'A manual failover with fast-start failover enabled needs the observer started and communicating with the target standby: DISABLE FAST_START FAILOVER FORCE first.',
      ora: 'ORA-16658',
    });
  }
  if (opts.fsfoEnabled && !opts.isFsfoTarget) {
    out.push({
      id: 'FSFO.MANUAL_FAILOVER_NOT_TARGET', severity: 'error', basis: 'documented',
      cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS'],
      subject: { kind: 'member', id: target as string },
      message: 'With fast-start failover enabled a manual failover is permitted only to the FastStartFailoverTarget standby.',
    });
  }
  if (opts.fsfoEnabled && !opts.ready) {
    out.push({
      id: 'FSFO.MANUAL_FAILOVER_NOT_READY', severity: 'error', basis: 'documented',
      cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS'],
      subject: { kind: 'member', id: target as string },
      message: 'With fast-start failover enabled the target must be synchronized (maximum availability or protection) or inside the lag limit (maximum performance) for a manual failover.',
    });
  }
  if (opts.cascaded) {
    out.push({
      id: 'CASCADE.MANUAL_FAILOVER_TERMINAL', severity: 'warning', basis: 'documented',
      cite: ['CASCADE.MANUAL_FAILOVER_UNSENT', 'FSFO.TARGET_DIRECT_REDO'],
      subject: { kind: 'member', id: target as string },
      message: 'Manual failover to a terminal standby is documented and legal, but no attempt is made to transmit any unsent redo from the cascader to the terminal standby.',
    });
  }
  void doc;
  return out;
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
  if (f && isDatabase(f) && !f.staticServices) missing.push(`${f.name} has no static service names`);
  if (!doc.config.fsfo.autoReinstate) missing.push('FastStartFailoverAutoReinstate is FALSE');
  if (missing.length > 0) {
    out.push({
      id: 'REINSTATE.PRECONDITIONS', severity: 'warning', basis: 'documented',
      cite: ['FSFO.AUTO_REINSTATE'],
      subject: { kind: 'member', id: former as string },
      message: `Automatic reinstatement of ${former} is not available here: ${missing.join('; ')}. It reinstates only after an observer-initiated failover caused by a primary crash or isolation, and needs Flashback Database on both databases, the former primary started and mounted, the master observer able to reach it, and static service names without Clusterware or Oracle Restart.`,
    });
  }
  return out;
}

export const reinstateBandClaim = (): Claim<null> =>
  model(null,
    'REINSTATE.DURATION_ENV: how long a reinstatement takes is environment-dependent -- the flashback and the redo the former primary has to replay -- so the band is drawn with no end.',
    ['FSFO.AUTO_REINSTATE']);
