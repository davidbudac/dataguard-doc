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
import type { FsfoState } from '../types/topology';
import type { NetState } from '../net/graph';

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
  'fsfo.detect': 13,
  'fsfo.initiate': 14,
  'fsfo.exec': 15,
  'fsfo.open': 16,
  'switchover.verify': 17,
  'switchover.convert': 18,
  'switchover.open': 19,
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
  | 'switchover.verify'
  | 'switchover.convert'
  | 'switchover.open';

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
}

export interface SimState {
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

  /* latched readiness: what the target was worth the last time it was fed */
  lastKnownSync: Record<string, boolean>;

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
  manualFailoverAt: Seconds | null;
  /** Commands wait one step: they are answered against the epoch's own facts. */
  pendingSwitchover: MemberId | null;
  pendingFailover: MemberId | null;
}

/* ---------------- samples and lanes ---------------- */

export interface Sample {
  t: Seconds;
  members: Record<string, MemberState | FarSyncState>;
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
  ): void => {
    const segments: Segment[] = [];
    for (const s of samples) {
      const state = at(s);
      if (state === undefined) continue;
      const last = segments[segments.length - 1];
      if (last && last.state === state) continue;
      if (last) last.t1 = s.t;
      const seg: Segment = { t0: s.t, t1: null, state: state as Segment['state'] };
      if (s.open.includes(id)) seg.open = true;
      segments.push(seg);
    }
    if (segments.length > 0) lanes.push({ subject: { kind, id }, segments });
  };

  for (const id of ids((s) => s.members)) build('member', id, (s) => s.members[id]);
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
  for (const lane of lanes) {
    const seg = segmentAt(lane, t);
    if (!seg) continue;
    if (lane.subject.kind === 'member') {
      members[lane.subject.id as MemberId] = seg.state as MemberState | FarSyncState;
    } else if (lane.subject.kind === 'observer') {
      observers[lane.subject.id as ObserverId] = seg.state as ObserverState;
    }
  }
  return { t, epoch, members, observers };
}
