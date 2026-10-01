/**
 * The epoch kernel -- engine design SS4.
 *
 * The timeline is partitioned into epochs by external events and internal
 * deadlines. Inside one epoch the network, the redo graph and the memberships
 * are constant, so the SS3 facts are computed once per epoch and every pending
 * clock contributes one closed-form deadline; the loop advances to
 * min(next external event, next deadline).
 *
 * This module carries the parts that are pure bookkeeping: the deterministic
 * queue, the mutable simulation state, the sampling that lanes are built from,
 * and `stateAt`. The decisions themselves live in `fsfo.ts`, `protection.ts`
 * and `roles.ts`, and the loop that drives them in `simulate.ts`.
 */

import type { MemberId, ObserverId, Seconds } from '../ids';
import type { FarSyncState, MemberState, ObserverState, TimedEvent } from '../types/events';
import { eventPriority } from '../types/events';
import type {
  Epoch, InternalDeadline, InternalDeadlineKind, Lane, Segment, Snapshot,
} from '../types/trace';
import type { Claim } from '../types/claims';
import type { FsfoState, ProtectionMode } from '../types/topology';
import type { NetState } from '../net/graph';
import type { SwitchoverRefusal } from './roles';

/** Times closer together than this are the same instant. */
export const EPS = 1e-9;

export const isDue = (at: Seconds, t: Seconds): boolean => at <= t + EPS;
export const sameInstant = (a: Seconds, b: Seconds): boolean => Math.abs(a - b) < EPS;

/* ---------------- the deterministic queue ---------------- */

/**
 * Deadlines land after events at the same instant: a command issued at the
 * moment a host dies sees the host dead, and a clock that expires at the
 * instant a link heals sees the healed link.
 */
const DEADLINE_PRIORITY: Record<InternalDeadlineKind, number> = {
  'sim.start': 0,
  'net.timeout': 10,
  'dest.reopen': 11,
  'lag.grace': 12,
  /* Before the failover clock at the same instant: a target that stops being
     ready at the second the observer would initiate is not ready. */
  'fsfo.readiness': 12,
  'observer.master': 12,
  'fsfo.detect': 13,
  'fsfo.initiate': 14,
  'fsfo.exec': 15,
  'fsfo.open': 16,
  'switchover.verify': 17,
  'switchover.convert': 18,
  'switchover.open': 19,
  'apply.failover': 19.5,
  /* Last at its instant on purpose: a primary that aborts at the threshold
     does so after the observer has initiated the failover at the same second. */
  'primary.abort': 20,
};

export interface Pending {
  deadline: InternalDeadline;
  /**
   * Derived clocks are recomputed from the state at every epoch, so they are
   * dropped and rebuilt; committed schedule points (the exec/open of a
   * failover, the bands of a switchover) survive until they fire.
   */
  derived: boolean;
  /** What the loop should do when it fires. */
  action: DeadlineAction;
  member?: MemberId;
  seq: number;
}

export type DeadlineAction =
  | 'fsfo.initiate'
  | 'dest.reopen'
  | 'fsfo.exec'
  | 'fsfo.open'
  | 'abort.stall'
  | 'abort.maxprotection'
  | 'net.timeout'
  | 'fsfo.readiness'
  | 'fsfo.no-second-target'
  | 'observer.master'
  | 'switchover.verify'
  | 'switchover.convert'
  | 'switchover.open'
  | 'apply.failover';

export class Queue {
  private items: Pending[] = [];
  private seq = 0;

  push(
    deadline: InternalDeadline, action: DeadlineAction, derived: boolean, member?: MemberId,
  ): void {
    const p: Pending = { deadline, derived, action, seq: this.seq++ };
    if (member !== undefined) p.member = member;
    this.items.push(p);
  }

  /** Drop every derived clock; the epoch that follows recomputes them. */
  clearDerived(): void {
    this.items = this.items.filter((p) => !p.derived);
  }

  cancel(action: DeadlineAction): void {
    this.items = this.items.filter((p) => p.action !== action);
  }

  /** Everything due at `t`, in (time, priority, sequence) order. */
  popDue(t: Seconds): Pending[] {
    const due = this.items.filter((p) => isDue(p.deadline.at, t));
    this.items = this.items.filter((p) => !isDue(p.deadline.at, t));
    return due.sort(compare);
  }

  /** The next instant anything is scheduled for, or Infinity. */
  nextTime(after: Seconds): Seconds {
    let best = Infinity;
    for (const p of this.items) {
      if (p.deadline.at > after + EPS && p.deadline.at < best) best = p.deadline.at;
    }
    return best;
  }

  /** Everything still pending, in queue order. */
  all(): readonly Pending[] {
    return [...this.items].sort(compare);
  }
}

const compare = (a: Pending, b: Pending): number =>
  a.deadline.at - b.deadline.at
  || (DEADLINE_PRIORITY[a.deadline.kind] ?? 50) - (DEADLINE_PRIORITY[b.deadline.kind] ?? 50)
  || a.seq - b.seq;

/** Events at one instant run in the order `sortEvents` puts them in. */
export const eventOrder = (a: TimedEvent, b: TimedEvent): number =>
  a.at - b.at || eventPriority(a) - eventPriority(b);

/* ---------------- simulation state ---------------- */

export type Phase =
  | 'normal'
  /** The observer has ordered a failover; terminal recovery is running. */
  | 'failing-over'
  | 'failed-over'
  /** The readiness gate refused the failover the observer would have ordered. */
  | 'blocked'
  | 'switching'
  | 'switched';

export interface SwitchoverFacts {
  /** When the command was issued. */
  at: Seconds;
  to: MemberId;
  /** Conversion begins: the primary's sessions end here. */
  tDown: Seconds | null;
  tConvertEnd: Seconds | null;
  tOpen: Seconds | null;
  downtime: Seconds | null;
  /** The former primary restarts as the new standby, in parallel and open-ended. */
  tRestartDraw: Seconds | null;
  blocked: boolean;
  applyRemaining: Seconds;
  /** Why the broker refused the command; present only on a refused switchover. */
  refusal?: SwitchoverRefusal;
}

export interface SimState {
  /** The instant the loop is at: what a lag that grows with time is read against. */
  now: Seconds;
  net: NetState;
  primary: MemberId;
  fsfoState: FsfoState;
  observers: Record<string, { running: boolean; role: 'master' | 'backup' }>;
  /** Explicitly set by SET MASTEROBSERVER; otherwise the kernel picks. */
  masterOverride: ObserverId | null;
  /**
   * The observer coordinating right now. It is sticky: a master is replaced
   * only under the documented nomination precondition (the primary and the
   * target standby stay connected while the connection to the master is
   * lost), by SET MASTEROBSERVER, or when it comes back itself.
   */
  master: ObserverId | null;

  /* clocks */
  obsLostPrimarySince: Seconds | null;
  targetLostPrimarySince: Record<string, Seconds | null>;
  /**
   * Per member, because the clock belongs to the database that is stalled and
   * not to whoever is primary now: a former primary that was cut off keeps
   * stalling -- and keeps counting down to its own abort -- after the standby
   * it could not reach has been opened somewhere else.
   */
  stallSince: Record<string, Seconds | null>;
  /**
   * The first instant, ever, the observer lost the primary -- kept even once
   * it reconnects, unlike `obsLostPrimarySince` above, which tracks only the
   * ongoing loss and clears the moment the observer is back. What the
   * FastStartFailoverThreshold brace draws from (design's own words: "the
   * clock starts when the observer FIRST loses its connection to the
   * primary"), because by the time a trace is done a promoted target usually
   * has the observer watching it again.
   */
  thresholdStartAt: Seconds | null;
  /** The first instant the acting primary's own stall clock started, kept the same way. */
  stallStartAt: Seconds | null;
  /** When the last synchronous acknowledgement went away. */
  ackLostSince: Seconds | null;
  /**
   * Whether there is an acknowledgement for this primary to lose.
   *
   * A commit hang is a destination that *stopped* acknowledging: the primary
   * waits out NET_TIMEOUT before it drops the destination and carries on. A
   * database that takes the primary role with its synchronous destination
   * already gone never had one, and nothing documented says such a primary
   * waits before it opens -- it opens read-write at the instant the role
   * change completes. So the flag is cleared at every role change and set
   * again the moment an acknowledgement is actually seen.
   */
  ackArmed: boolean;

  /* ---- fast-start failover readiness (fact check SIM-01, SIM-02, SIM-11) ---- */

  /**
   * The recorded state per member: true is SYNCHRONIZED (maximum availability
   * and maximum protection) or TARGET UNDER LAG LIMIT (where the lag limit is
   * the gate), false is UNSYNCHRONIZED or TARGET OVER LAG LIMIT.
   *
   * It is a latch only while nothing new is committed -- the primary dead,
   * stalled or hanging on the commit. From the instant the primary carries on
   * without a member, that member is not ready, and a fast-start failover to
   * it "cannot occur".
   */
  fsfoReady: Record<string, boolean>;
  /** When redo stopped reaching each member while the primary was alive. */
  cutOffSince: Record<string, Seconds | null>;
  /**
   * Seconds of redo the primary generated that each member never received:
   * the closed stretches, and the start of the one that is still open.
   */
  unsentAccum: Record<string, Seconds>;
  unsentSince: Record<string, Seconds | null>;
  /** When redo reached a member again after the primary had run without it. */
  resyncedAt: Record<string, Seconds | null>;
  /**
   * The configuration is unobserved, as the primary and the target standby
   * recorded it: the primary lost the master observer while it still reached
   * the target. "While the configuration is in the unobserved state,
   * fast-start failover cannot happen", so the primary does not stall when
   * it then loses the target as well. Cleared when the observer reaches the
   * primary again.
   */
  unobserved: boolean;
  /**
   * The current fast-start failover target. The broker changes it while the
   * primary is there to coordinate the change, and not once the primary is
   * gone.
   */
  activeTarget: MemberId | null;
  /** What the readiness gate measured when the failover was initiated. */
  gateLagAtFailure: Seconds | null;
  /** The observer's clock expired with nothing it could fail over to. */
  noTargetAt: Seconds | null;

  /* role transition bookkeeping */
  phase: Phase;
  target: MemberId | null;
  blocked: boolean;
  detectSeconds: Seconds | null;
  initiateAt: Seconds | null;
  execStartAt: Seconds | null;
  tOpenAt: Seconds | null;
  newPrimary: MemberId | null;
  formerPrimary: MemberId | null;
  /**
   * A manual failover completed while the old primary was still running, and
   * it has not been down since: it is still open read-write beside the new
   * primary, because nothing documented closes it (the shutdown is the
   * operator's, FAILOVER.PRIMARY_SHUT_DOWN). Cleared the moment it goes down
   * or is aborted; a restart after that is a former primary that restarts.
   */
  formerOpen: boolean;
  converting: MemberId | null;
  reinstating: MemberId | null;
  abortedMembers: MemberId[];
  abortAt: Seconds | null;
  abortReason: 'stall' | 'maxprotection' | null;
  /** Members taken out of service by BystandersFollowRoleChange = NONE. */
  disabledMembers: MemberId[];

  /* destinations across epochs (dests.ts) */
  /**
   * Destination keys (`from>to`) disabled at MaxFailure. There is no further
   * access to a destination in here until it is manually reenabled, so nothing
   * in the loop ever removes a key: the network healing does not bring it back.
   */
  disabledDests: string[];
  /**
   * Destination keys whose alternate has taken over for good -- the alternate
   * was declared without FALLBACK.
   */
  altLatched: string[];
  /** The destination each RedoRoutes group is shipping to (`groupKey`), kept among equal priorities. */
  groupChoice: Record<string, MemberId>;
  /** When each destination's last error was, or null while it is carrying redo. */
  destDownSince: Record<string, Seconds | null>;
  /** Consecutive failed attempts to reestablish each destination. */
  destFailures: Record<string, number>;
  switchover: SwitchoverFacts | null;
  /** When a backup observer was nominated master. */
  nominatedAt: Seconds | null;
  /** Lag inputs can be moved by a lag.set event. */
  applyLag: Record<string, Seconds>;
  transportLag: Record<string, Seconds>;
  /**
   * RAC standbys (`rac.ts`): the instance holding the apply role -- or, while
   * it is down, the one that last held it -- and since when it has been down.
   */
  applyInstance: Record<string, string>;
  applyLostSince: Record<string, Seconds | null>;
  manualFailoverAt: Seconds | null;
  /** Commands wait one step: they are answered against the epoch's own facts. */
  pendingSwitchover: MemberId | null;
  /** SET STATE='APPLY-ON' WITH APPLY INSTANCE, answered in `updateRac`. */
  pendingApplyMove: { member: MemberId; instance: string } | null;
  pendingFailover: { to: MemberId; immediate: boolean } | null;
  pendingReinstate: MemberId | null;
  pendingMasterObserver: ObserverId | null;
  /** STOP OBSERVER, answered against the epoch's facts: the broker may refuse it. */
  pendingStopObservers: ObserverId[];
  /** DISABLE FAST_START FAILOVER [FORCE], answered the same way. */
  pendingDisableFsfo: { force: boolean } | null;
  /**
   * The primary that ran DISABLE FAST_START FAILOVER FORCE while cut off from
   * the observer and the target standby. Only it treats fast-start failover as
   * disabled; the observer and the target still have it enabled, so they carry
   * on with a failover it does not know about. Null in every other run.
   */
  forcedOffPrimary: MemberId | null;
  /**
   * The SYNC destinations the primary has seen acknowledging during its tenure
   * (`from>to` keys), the primary they belong to, and how many of them are
   * silent right now -- so a destination that stops answering among several
   * starts a commit hang of its own, and one that was never up does not.
   */
  syncSeen: { primary: MemberId | null; up: string[]; silent: number };
  /** The protection mode the new primary runs in after a role change, where it differs. */
  modeAfterRoleChange: ProtectionMode | null;
  /** What the role change cost, decided where the role change was decided. */
  loss: { kind: 'none' | 'bounded' | 'manual' | 'unknown'; seconds: Seconds; claim: Claim<number> } | null;
  /** The primary was down in the epoch before this one. */
  primaryWasDown: boolean;
}

/* ---------------- samples and lanes ---------------- */

export interface Sample {
  t: Seconds;
  members: Record<string, MemberState | FarSyncState>;
  /** RAC standbys running apply: which instance is doing it. */
  applyInstances?: Record<string, string>;
  observers: Record<string, ObserverState>;
  links: Record<string, 'up' | 'down'>;
  /** Subjects whose band has no documented end (environment-dependent). */
  open: string[];
}

/**
 * Lanes are the samples transposed and coalesced: one segment per run of equal
 * states, contiguous by construction, and the last segment of every lane runs
 * to the horizon with `t1 = null`.
 */
export function buildLanes(samples: readonly Sample[]): Lane[] {
  if (samples.length === 0) return [];
  const first = samples[0] as Sample;
  const lanes: Lane[] = [];

  const ids = (pick: (s: Sample) => Record<string, string>): string[] => {
    const set = new Set<string>();
    for (const s of samples) for (const k of Object.keys(pick(s))) set.add(k);
    return [...set].sort();
  };

  const build = (
    kind: 'member' | 'observer' | 'link', id: string, at: (s: Sample) => string | undefined,
    apply: (s: Sample) => string | undefined = () => undefined,
  ): void => {
    const segments: Segment[] = [];
    for (const s of samples) {
      const state = at(s);
      if (state === undefined) continue;
      const inst = apply(s);
      const last = segments[segments.length - 1];
      /* A RAC standby whose apply moved to another instance is a new segment
         in the same state: the move is the thing to see. */
      if (last && last.state === state && last.applyInstance === inst) continue;
      if (last) last.t1 = s.t;
      const seg: Segment = { t0: s.t, t1: null, state: state as Segment['state'] };
      if (inst !== undefined) seg.applyInstance = inst;
      if (s.open.includes(id)) seg.open = true;
      segments.push(seg);
    }
    if (segments.length > 0) lanes.push({ subject: { kind, id }, segments });
  };

  for (const id of ids((s) => s.members)) {
    build('member', id, (s) => s.members[id], (s) => s.applyInstances?.[id]);
  }
  for (const id of ids((s) => s.observers)) build('observer', id, (s) => s.observers[id]);
  for (const id of ids((s) => s.links)) build('link', id, (s) => s.links[id]);
  void first;
  return lanes;
}

/* ---------------- stateAt ---------------- */

/** Binary search: the epoch whose half-open span contains `t`. */
export function epochAt(epochs: readonly Epoch[], t: Seconds): Epoch | null {
  if (epochs.length === 0) return null;
  let lo = 0;
  let hi = epochs.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = epochs[mid] as Epoch;
    if (e.t0 <= t + EPS) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return epochs[best] as Epoch;
}

export function segmentAt(lane: Lane, t: Seconds): Segment | null {
  let found: Segment | null = null;
  for (const s of lane.segments) {
    if (s.t0 <= t + EPS && (s.t1 === null || t < s.t1 - EPS)) found = s;
  }
  if (found) return found;
  const last = lane.segments[lane.segments.length - 1];
  return last ?? null;
}

export function snapshotFrom(
  epochs: readonly Epoch[], lanes: readonly Lane[], t: Seconds,
): Snapshot | null {
  const epoch = epochAt(epochs, t);
  if (!epoch) return null;
  const members: Record<MemberId, MemberState | FarSyncState> = {};
  const observers: Record<ObserverId, ObserverState> = {};
  const applyInstances: Record<MemberId, string> = {};
  for (const lane of lanes) {
    const seg = segmentAt(lane, t);
    if (!seg) continue;
    if (lane.subject.kind === 'member') {
      members[lane.subject.id as MemberId] = seg.state as MemberState | FarSyncState;
      if (seg.applyInstance !== undefined) applyInstances[lane.subject.id as MemberId] = seg.applyInstance;
    } else if (lane.subject.kind === 'observer') {
      observers[lane.subject.id as ObserverId] = seg.state as ObserverState;
    }
  }
  return Object.keys(applyInstances).length > 0
    ? { t, epoch, members, observers, applyInstances }
    : { t, epoch, members, observers };
}
