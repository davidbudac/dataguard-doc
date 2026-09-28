/**
 * Derived-output types: the effective redo graph (engine design SS3) and the
 * simulation trace (SS4).
 *
 * Nothing in here is authored by a user -- every value is produced by the
 * engine, which is why so many of them are Claims rather than bare numbers.
 */

import type { HostId, LinkId, MemberId, ObserverId, Seconds, SiteId } from '../ids';
import type { Claim, Finding } from './claims';
import type { AnyState, FarSyncState, MemberState, ObserverState, TimedEvent } from './events';
import type { ProtectionMode, XptMode } from './topology';

/* ---------------- SS3 effective redo graph ---------------- */

export type EdgeRole = 'primary-direct' | 'primary-to-farsync' | 'farsync-onward' | 'cascade';

export type EdgeInactiveReason =
  | 'lower-priority-group'
  | 'alternate-standby'
  | 'destination-down'
  | 'max-failure-disabled'
  | 'source-not-primary'
  | 'member-disabled';

export interface RedoEdge {
  from: MemberId;
  to: MemberId;
  xpt: XptMode;
  xptSource: 'rule-attribute' | 'dest-logxptmode';
  ruleIndex: number;
  groupPriority: number;
  role: EdgeRole;
  /** Chosen by the routing rules (priority group, alternate state). */
  active: boolean;
  inactiveReason?: EdgeInactiveReason;
  /** The network under it carries traffic right now. */
  up: boolean;
}

export interface ResolvedMember {
  id: MemberId;
  reachableFromPrimary: boolean;
  /** Hops from the primary; 0 is the primary itself, -1 when unreached. */
  depth: number;
  /** Primary first, this member last. */
  feedPath: MemberId[];
  effectiveXpt: XptMode | null;
  synchronized: Claim<boolean>;
  countsTowardProtectionAck: Claim<boolean>;
}

export type ProtectionLevel = ProtectionMode | 'RESYNCHRONIZATION';

export interface RedoGraph {
  primary: MemberId;
  edges: RedoEdge[];
  members: Record<MemberId, ResolvedMember>;
  protectionLevel: Claim<ProtectionLevel>;
  findings: Finding[];
}

/* ---------------- SS4 trace ---------------- */

export type InternalDeadlineKind =
  /** The opening epoch: the state a trace starts in, before anything happens. */
  | 'sim.start'
  | 'fsfo.detect'
  | 'fsfo.initiate'
  | 'fsfo.exec'
  | 'fsfo.open'
  | 'primary.abort'
  | 'net.timeout'
  | 'dest.reopen'
  | 'lag.grace'
  /** The recorded readiness of a target changes (SYNCHRONIZED <-> UNSYNCHRONIZED, UNDER <-> OVER LAG LIMIT). */
  | 'fsfo.readiness'
  /** SET MASTEROBSERVER takes effect at the next contact between the primary and the target. */
  | 'observer.master'
  | 'switchover.verify'
  | 'switchover.convert'
  | 'switchover.open';

export interface InternalDeadline {
  kind: InternalDeadlineKind;
  at: Seconds;
  subject?: { kind: 'member' | 'observer' | 'link' | 'config'; id?: string };
  label?: string;
}

export interface NetStateSummary {
  downHosts: HostId[];
  downSites: SiteId[];
  downLinks: LinkId[];
  partitioned: boolean;
  /** The groups of an explicit partition, so reachability can be asked again. */
  groups?: HostId[][];
}

export interface Epoch {
  t0: Seconds;
  /** null on the last epoch: it runs to the horizon. */
  t1: Seconds | null;
  cause: TimedEvent | InternalDeadline;
  net: NetStateSummary;
  redo: RedoGraph;
  primary: MemberId;
  protectionLevel: Claim<ProtectionLevel>;
}

export interface Segment {
  t0: Seconds;
  t1: Seconds | null;
  state: AnyState;
  label?: string;
  /** An open band with no documented end (environment-dependent). */
  open?: boolean;
}

export interface Lane {
  subject: { kind: 'member' | 'observer' | 'link'; id: string };
  segments: Segment[];
}

/** One branch of the decision kernel, with the claim that justifies it. */
export interface Decision {
  at: Seconds;
  id: string;
  taken: boolean;
  claim: Claim<string>;
  subject?: { kind: 'member' | 'observer' | 'link' | 'config'; id?: string };
}

export type Outcome =
  | 'failover'
  | 'continues'
  | 'stall-noone'
  /**
   * Maximum protection shut the primary down: no synchronous acknowledgement
   * from a standby database is left. A different story from a stall -- nobody
   * lost the observer, and the threshold never entered it.
   */
  | 'maxprot-shutdown'
  | 'manual'
  | 'observer-lost'
  | 'switchover';

export interface PerMemberFacts {
  rpoSeconds: Claim<number> | null;
  rtoSeconds: Claim<number> | null;
  endState: MemberState | FarSyncState;
  /** What a failure right now would cost, in seconds of redo. */
  ifDiedNow: Seconds | null;
}

export interface DerivedFacts {
  outcome: Outcome;
  newPrimary: MemberId | null;
  initiateAt: Seconds | null;
  execStartAt: Seconds | null;
  tOpen: Seconds | null;
  abortAt: Seconds | null;
  blocked: boolean;
  perMember: Record<MemberId, PerMemberFacts>;
  observers: Record<ObserverId, { endState: ObserverState; becameMasterAt?: Seconds }>;
}

export interface Axis {
  horizon: Seconds;
  preRoll: Seconds;
  tickStep: Seconds;
}

export interface Trace {
  epochs: Epoch[];
  lanes: Lane[];
  decisions: Decision[];
  facts: DerivedFacts;
  findings: Finding[];
  axis: Axis;
}

export interface Snapshot {
  t: Seconds;
  epoch: Epoch;
  members: Record<MemberId, MemberState | FarSyncState>;
  observers: Record<ObserverId, ObserverState>;
}

export interface SimParams {
  /** Order of candidate targets, or only the active one (design SS4). */
  targetPolicy?: 'skip-to-next' | 'active-target-only';
  /** How a multi-SYNC commit waits (design SS6). */
  commitWaitPolicy?: 'all' | 'first-ack';
  /** Cap on epochs before the loop gives up and reports a Finding. */
  maxEpochs?: number;
  /** Fixed horizon, when the caller wants one rather than the adaptive axis. */
  horizon?: Seconds;

  /*
   * The three switches below exist for one caller: `engine/compat/classic.ts`,
   * which reproduces the frozen published page (`simulator/`, served at
   * /dataguard/legacy/) number for number. That page's model predates the
   * 2026-09-28 fact check and the workbench no longer shares three of its
   * readings, so the adapter asks for them by name. Nothing else sets them:
   * the share-link codec does not read them and no control offers them.
   */

  /**
   * ED-01. ObserverPingInterval and ObserverPingRetry do not exist in 19c
   * (absent from the 19c documentation and from the 19.27 binaries; first
   * documented in 21c), so a 19c document detects on the threshold. The
   * published page offers the two properties under 19c and draws the ping
   * arithmetic there; TRUE keeps that arithmetic.
   */
  legacyPingUnder19c?: boolean;
  /**
   * SIM-02. Oracle stalls a primary only when the change to UNSYNCHRONIZED or
   * TARGET OVER LAG LIMIT cannot be confirmed; a primary whose target was
   * already not ready has nothing to confirm and keeps running. The published
   * page stalls every primary that reaches neither the observer nor the
   * target; TRUE keeps that.
   */
  legacyStallWhenNotReady?: boolean;
  /**
   * SIM-06. What a manual failover loses is redo the standby never received.
   * The published page draws the apply lag as that number in maximum
   * performance mode; TRUE keeps it.
   */
  legacyManualLossIsApplyLag?: boolean;
}
