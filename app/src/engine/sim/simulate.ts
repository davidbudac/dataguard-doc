/**
 * The simulation itself -- engine design SS4.
 *
 * `simulate` runs an epoch loop over the closed-form kernel: external events
 * and internal deadlines cut the timeline into epochs, the SS3 redo graph is
 * resolved once per epoch, and every pending clock contributes one closed-form
 * deadline. `stateAt` is a binary search over the result.
 *
 * Nothing in here decides a documented fact on its own: the rules come from
 * `fsfo.ts`, `protection.ts` and `roles.ts`, each of which carries the citation
 * or the model label together with the value.
 */

import { failoverAxis, fixedAxis, secondsAxis } from '../models/axis';
import type { CitationId } from '../citations';
import { lagLimitOf } from '../defaults';
import type { HostId, MemberId, ObserverId, Seconds, SiteId } from '../ids';
import {
  applyNetEvent, buildReachability, hostUp, initialNetState, linkRttMs, liveInstances,
  memberAlive, memberReachableFromHost, membersReachable, netSummary,
} from '../net/graph';
import type { NetState, Reachability } from '../net/graph';
import { resolveRedoGraph } from '../redo/resolve';
import type { Claim, Finding } from '../types/claims';
import { documented, inferred, model } from '../types/claims';
import type { FarSyncState, MemberState, ObserverState, TimedEvent } from '../types/events';
import { sortEvents } from '../types/events';
import type { DatabaseMember, Member, ProtectionMode, TopologyDoc } from '../types/topology';
import { isDatabase, isFarSync, isRac } from '../types/topology';
import type {
  Decision, DerivedFacts, Epoch, InternalDeadline, PerMemberFacts, ProtectionLevel, RedoGraph,
  SimParams, Snapshot, Trace,
} from '../types/trace';
import { buildLanes, EPS, isDue, Queue, snapshotFrom } from './kernel';
import type { Pending, Sample, SimState, SwitchoverFacts } from './kernel';
import {
  applyGapOf, applyLagOf, candidateTargets, detectClaim, effectiveLagType, gateLagSeconds,
  initiateDelayClaim, lagGated, nominationClaim, noSecondTarget, notReadyClaim, pickMaster,
  pingInEffect, pingNotIn19c, pingPropertiesSet, preferredRank, readinessGate, resyncClaim,
  selectTarget, transportLagOf,
} from './fsfo';
import type { Readiness } from './fsfo';
import {
  abortClaim, commitHangClaim, honestLevel, maxAvailDegraded, maxProtectionShutdown,
  modeAfterFailover, netTimeoutForMode, netTimeoutOf, noStallClaim, stallClaim, syncAckDatabases,
  syncAckMembers,
} from './protection';
import {
  alternateLatched, authoredDests, carryGroupChoice, destKey, disableAt, failedAttempts, groupReenters,
  maxFailureDisabled, maxFailureResetUndoc, reopenScheduleModel,
} from './dests';
import type { AuthoredDest } from './dests';
import {
  applyFailoverClaim, applyGapFailoverClaim, applyInstanceTimeout, applyWaitClaim,
  hasApplyInstance, initialApplyInstance, nextApplyInstance, primaryDegradedClaim,
  isMultiInstanceApply, participantLostClaim, roleChangeApplyClaim, setApplyClaim,
} from './rac';
import {
  bystanderAhead, bystanderClaim, bystanders, executionClaim, manualFailoverFindings,
  manualLossClaim, nominalBandsClaim, reinstateBandClaim, reinstateCommandFindings,
  reinstateFindings, switchoverGate, switchoverLossClaim, switchoverRefused, switchoverSchedule,
} from './roles';
import type { SwitchoverRefusal } from './roles';

/* ---------------- output types ---------------- */

/** What a growing lag costs in a 26ai maximum performance configuration. */
export interface LagStall {
  /** A grace time of 5 s or more arms the permission in advance. */
  armed: boolean;
  graceTime: Seconds;
  /** The stall never outlives one threshold. */
  maxSeconds: Seconds;
}

/** The reachability facts the drawings read straight off the model. */
export interface Conditions {
  stalled: boolean;
  standbyGone: boolean;
  redoFlowing: boolean;
  pmyReachable: boolean;
}

/**
 * `unknown` is a role change whose loss this run cannot put a bound on: the
 * far sync instance that held the redo went down with the primary.
 */
export type DataLossKind = 'none' | 'bounded' | 'na' | 'manual' | 'unknown';

export interface EngineFacts extends DerivedFacts {
  /** The candidate the broker landed on, whether or not it was promoted. */
  target: MemberId | null;
  /**
   * The current fast-start failover target at the end of the run; null once
   * a role change has completed, where the run stops evaluating it.
   */
  activeTarget: MemberId | null;
  /** The configuration ended the run unobserved. */
  unobserved: boolean;
  detectSeconds: Seconds | null;
  netHopSeconds: Seconds;
  applyRemainingSeconds: Seconds;
  gateLagSeconds: Seconds | null;
  lagType: 'APPLY' | 'TRANSPORT';
  pingSet: boolean;
  dataLossKind: DataLossKind;
  dataLossSeconds: Seconds;
  /** What a failure right now would cost at the chosen target, in seconds. */
  ifDiedNow: Seconds | null;
  observerLost: boolean;
  conditions: Conditions;
  switchover: SwitchoverFacts | null;
  lagStall: LagStall | null;
  protectionLevel: Claim<ProtectionLevel>;
  abortReason: 'stall' | 'maxprotection' | null;
  /**
   * The shortest NetTimeout among the primary's destinations -- what bounds
   * the commit hang, and the interval the maximum protection shutdown instant
   * is drawn from. Never a failover clock.
   */
  netTimeoutSeconds: Seconds;
  /**
   * When the master observer's own FastStartFailoverThreshold clock started:
   * "The clock starts when the observer FIRST loses its connection to the
   * primary database." Null while the observer has never lost the primary.
   * Not the instant fast-start failover initiates at -- with ObserverOverride
   * FALSE that also waits on the target -- only where this clock itself began.
   */
  thresholdStartAt: Seconds | null;
  /**
   * When the acting primary's own stall clock started: the instant it first
   * reached neither the observer nor the target standby, which is independent
   * of the observer's threshold clock above and runs whether or not fast-start
   * failover is even armed. Null where the primary has never stalled.
   */
  stallStartAt: Seconds | null;
}

export interface EngineTrace extends Trace {
  facts: EngineFacts;
}

/* ---------------- the per-epoch view ---------------- */

interface ActorView {
  alive: boolean;
  observerSees: boolean;
  anyTargetSees: boolean;
  stalled: boolean;
  /**
   * It reaches neither the observer nor a target and keeps running all the
   * same, and why: nothing is left to confirm.
   */
  running: 'unobserved' | 'not-ready' | null;
}

/** How each member is fed in the configuration as declared. */
interface Feed {
  /** The member the primary itself ships to on the way here. */
  firstHop: MemberId | null;
  /** The hop out of the primary is SYNC or FASTSYNC. */
  sync: boolean;
  /** NetTimeout of that hop: how long the primary waits before it drops it. */
  netTimeout: Seconds;
  /** Far sync instances between the primary and this member. */
  farSyncs: MemberId[];
  /** Standby databases between the primary and this member: a cascade. */
  cascaders: MemberId[];
}

interface ViewOpts {
  legacyStall: boolean;
}

interface View {
  reach: Reachability;
  graph: RedoGraph;
  primary: Member;
  primaryAlive: boolean;
  /** Fast-start failover is enabled on the configuration. */
  fsfoEnabled: boolean;
  master: ObserverId | null;
  masterHost: HostId | null;
  /** Enabled AND a master observer is running: only the master coordinates. */
  armed: boolean;
  obsSeesPrimary: boolean;
  candidates: MemberId[];
  targetSeesPrimary: Record<string, boolean>;
  obsSeesTarget: Record<string, boolean>;
  targetAlive: Record<string, boolean>;
  anyTargetSeesPrimary: boolean;
  /** Per acting primary: the current one, and any former one still running. */
  actors: Record<string, ActorView>;
  stalled: boolean;
  syncAcks: MemberId[];
  syncAckDbs: MemberId[];
  /** The primary declares at least one SYNC or FASTSYNC destination, up or not. */
  syncDeclared: boolean;
  conditions: Conditions;
}

/* ---------------- simulate ---------------- */

export function simulate(
  doc: TopologyDoc, events?: readonly TimedEvent[], params: SimParams = {},
): EngineTrace {
  const evts = sortEvents(events ?? doc.events ?? []);
  const maxEpochs = params.maxEpochs ?? 512;
  const policy = params.targetPolicy ?? 'skip-to-next';
  /* The three readings the published page keeps (see SimParams). */
  const ping = pingInEffect(doc, params.legacyPingUnder19c === true);
  const viewOpts: ViewOpts = { legacyStall: params.legacyStallWhenNotReady === true };
  const legacyLoss = params.legacyManualLossIsApplyLag === true;

  const state = initialState(doc);
  const decisions: Decision[] = [];
  const findings: Finding[] = [];
  const seenFinding = new Set<string>();
  const seenDecision = new Set<string>();

  const addFinding = (f: Finding): void => {
    const k = `${f.id}|${f.subject.kind}|${f.subject.id ?? ''}`;
    if (seenFinding.has(k)) return;
    seenFinding.add(k);
    findings.push(f);
  };
  /* `once` widens the dedupe key for a decision that can recur for the same
     subject, such as a second apply instance failover. */
  const decide = (
    at: Seconds, id: string, taken: boolean, claim: Claim<string>,
    subject?: Decision['subject'], once?: string,
  ): void => {
    const k = `${id}|${String(taken)}|${subject?.id ?? ''}|${once ?? ''}`;
    if (seenDecision.has(k)) return;
    seenDecision.add(k);
    const d: Decision = { at, id, taken, claim };
    if (subject) d.subject = subject;
    decisions.push(d);
  };
  /* A state that can change more than once in a run -- ready, not ready, ready
     again -- is recorded every time it changes, so the instant is part of what
     makes the decision the same one. */
  const decideAt = (
    at: Seconds, id: string, taken: boolean, claim: Claim<string>,
    subject?: Decision['subject'],
  ): void => {
    const k = `${id}|${String(taken)}|${subject?.id ?? ''}|${at}`;
    if (seenDecision.has(k)) return;
    seenDecision.add(k);
    const d: Decision = { at, id, taken, claim };
    if (subject) d.subject = subject;
    decisions.push(d);
  };

  /* Readiness starts from the configuration as declared: what each standby
     was worth before anything failed. */
  const baseGraph = resolveRedoGraph(doc, { primary: state.primary, net: initialNetState(doc) });
  const feeds: Record<string, Feed> = {};
  for (const m of doc.members) {
    const r = baseGraph.members[m.id];
    feeds[m.id as string] = feedOf(doc, baseGraph, m.id);
    state.fsfoReady[m.id as string] = !!r && r.reachableFromPrimary && worthOf(doc, state, m, r);
  }
  /* The opening election is held on the configuration as declared, before
     anything fails: from here on the master is replaced only under the
     documented nomination precondition. */
  electMaster(doc, state, (h) => hostUp(doc, state.net, h), true, () => true);
  {
    /* The configuration as it stands before the first event: which candidate
       is the target, and whether anybody is observing. Enabled with no
       observer started is a legal state -- ORA-16819 is its warning -- and it
       is unobserved, not disabled. */
    const opening = computeView(doc, state, viewOpts);
    const first = opening.candidates.find((c) => opening.targetAlive[c as string] === true)
      ?? opening.candidates[0] ?? null;
    state.activeTarget = first;
    state.unobserved = opening.fsfoEnabled && opening.primaryAlive
      && !opening.obsSeesPrimary && opening.anyTargetSeesPrimary;
    if (opening.fsfoEnabled && !doc.observers.some((o) => o.running)) {
      addFinding({
        id: 'OBS.NOT_STARTED', severity: 'warning', basis: 'documented',
        cite: ['OBS.NOT_STARTED_16819', 'ORA.16819', 'FSFO.UNOBSERVED_CONTINUES'],
        subject: { kind: 'config' },
        message: 'Fast-start failover is enabled and no observer is started: the ORA-16819 warning is displayed for the primary and target standby databases. The configuration is unobserved -- fast-start failover cannot happen, and the primary keeps processing transactions whatever happens to the target standby.',
        ora: 'ORA-16819',
      });
    }
    if (pingPropertiesSet(doc) && !ping) addFinding(pingNotIn19c(doc));
  }
  const masterSwitches: { at: Seconds; observer: ObserverId }[] = [];
  let lastNoStall: 'unobserved' | 'not-ready' | null = null;

  const q = new Queue();
  const epochs: Epoch[] = [];
  const samples: Sample[] = [];
  const conditionsByEpoch: Conditions[] = [];
  let prevMaster: ObserverId | null = state.master;
  let t = 0;
  let ei = 0;

  for (let guard = 0; ; guard++) {
    if (guard >= maxEpochs) {
      addFinding({
        id: 'SIM.EPOCH_CAP', severity: 'warning', basis: 'model', cite: ['FSFO.THRESHOLD'],
        subject: { kind: 'config' },
        message: `The epoch loop hit its ${maxEpochs}-epoch cap; nothing past ${t} s is drawn.`,
        note: 'The cap is an engine safeguard, not an Oracle limit.',
      });
      /* The trace still ends open rather than pointing at an epoch that was
         never recorded. */
      const lastEpoch = epochs[epochs.length - 1];
      if (lastEpoch) lastEpoch.t1 = null;
      break;
    }

    state.now = t;

    /* 1. every external event at this instant, in queue order. */
    let cause: TimedEvent | InternalDeadline | null = null;
    while (ei < evts.length && isDue((evts[ei] as TimedEvent).at, t)) {
      const e = evts[ei] as TimedEvent;
      applyEvent(doc, state, e);
      if (!cause) cause = e;
      ei++;
    }

    /* The old primary a manual failover left open stays open only until it is
       taken down: a crash or a shutdown ends it, and a restart afterwards is a
       former primary that restarts, not one that stayed. */
    if (state.formerOpen || state.formerActs) {
      const fp = doc.members.find((m) => m.id === state.formerPrimary);
      if (!fp || !memberAlive(doc, state.net, fp) || state.abortedMembers.includes(fp.id)) {
        state.formerOpen = false;
        state.formerActs = false;
      }
    }

    /* 2. the epoch's facts, computed once. */
    let view = computeView(doc, state, viewOpts);

    /* 3. commands are answered against those facts, then the deadlines that
          fall due are fired against them. */
    if (state.pendingMasterObserver !== null) runSetMasterObserver(t);
    if (state.pendingSwitchover !== null) { runSwitchover(view, t); view = computeView(doc, state, viewOpts); }
    if (state.pendingFailover !== null) { runManualFailover(view, t); view = computeView(doc, state, viewOpts); }
    if (state.pendingReinstate !== null) { runReinstate(view, t); view = computeView(doc, state, viewOpts); }

    const due = q.popDue(t);
    for (const p of due) {
      if (!cause) cause = p.deadline;
      fire(p, view, t);
    }
    if (due.length > 0) view = computeView(doc, state, viewOpts);

    /* 4. the clocks, and the decisions this epoch is where to record. */
    updateClocks(view, t);
    trackReinstatement(view, t);
    updateDests(view, t);
    updateRac(view, t);
    noteMasterChange(view, t);
    recordEpochDecisions(view, t);

    /* 5. derived clocks are rebuilt from the state every epoch; committed
          schedule points -- a failover's exec and open, a switchover's bands --
          survive until they fire. */
    q.clearDerived();
    scheduleDerived(view, t);
    view = computeView(doc, state, viewOpts);

    /* 6. record. */
    const epoch: Epoch = {
      t0: t, t1: null,
      cause: cause ?? startCause(t),
      net: netSummary(state.net),
      redo: view.graph,
      primary: state.primary,
      protectionLevel: honestLevel(view.graph.protectionLevel, modeNow(doc, state)),
    };
    for (const f of view.graph.findings) addFinding(f);
    epochs.push(epoch);
    samples.push(sampleOf(doc, state, view, t));
    conditionsByEpoch.push(view.conditions);

    /* 7. advance to the next instant anything happens. */
    const nextEvent = ei < evts.length ? (evts[ei] as TimedEvent).at : Infinity;
    const next = Math.min(nextEvent, q.nextTime(t));
    if (!isFinite(next)) break;
    epoch.t1 = next;
    t = next;
  }

  const finalView = computeView(doc, state, viewOpts);
  const facts = deriveFacts(
    doc, state, finalView, evts, conditionsByEpoch, epochs, samples, { ping, legacyLoss, feeds },
  );
  const axis = pickAxis(doc, state, finalView, ping);
  const lanes = buildLanes(samples);
  return { epochs, lanes, decisions, facts, findings, axis };

  /* ------------------------------------------------------------------
     the closures the loop above is written in terms of
     ------------------------------------------------------------------ */

  function fire(p: Pending, view: View, at: Seconds): void {
    switch (p.action) {
      case 'fsfo.initiate':
        initiate(view, at);
        break;
      case 'fsfo.exec':
        state.converting = state.target;
        break;
      case 'fsfo.open':
        completeFailover(view, at);
        break;
      case 'abort.stall':
        abort(p.member ?? state.primary, at, 'stall',
          asString(abortClaim(at, doc.config.fsfo.thresholdSeconds)));
        break;
      case 'abort.maxprotection': {
        const netTimeout = netTimeoutForMode(doc, view.graph);
        abort(p.member ?? state.primary, at, 'maxprotection',
          asString(maxProtectionShutdown(at - netTimeout, netTimeout)));
        addFinding({
          id: 'PROT.MAXPROT_SHUTDOWN', severity: 'error', basis: 'model',
          cite: ['MAXPROT.SHUTS_PRIMARY', 'MAXPROT.TWO_STANDBYS', 'DEST.NET_TIMEOUT'],
          subject: { kind: 'member', id: (p.member ?? state.primary) as string },
          message: 'Maximum protection mode shuts the primary database down rather than allowing it to continue: no synchronous acknowledgement from a standby database is left.',
          note: 'PROT.MAXPROT_SHUTDOWN_TIMING: the shutdown is documented, the instant is not. This engine draws it one NET_TIMEOUT after the last acknowledgement.',
        });
        break;
      }
      case 'switchover.verify':
        state.converting = state.primary;
        decide(at, 'SWITCHOVER.CONVERT', true, asString(nominalBandsClaim(),
          'The primary converts to a standby, and its sessions are terminated as it converts. The verify and convert bands are nominal drawing constants.'));
        break;
      case 'switchover.convert':
        break;
      case 'switchover.open':
        completeSwitchover(at);
        break;
      case 'observer.master':
        applyMasterSwitches(view, at);
        break;
      /* Bookkeeping: what these change is worked out in `updateClocks`,
         `updateRac` and `scheduleDerived`, against the epoch the deadline
         opened. An apply.failover is the move of a RAC standby's apply. */
      case 'net.timeout':
      case 'fsfo.readiness':
      case 'fsfo.no-second-target':
      case 'apply.failover':
      case 'dest.reopen':
        break;
      default:
        break;
    }
  }

  function abort(
    member: MemberId, at: Seconds, reason: 'stall' | 'maxprotection', claim: Claim<string>,
  ): void {
    if (state.abortedMembers.includes(member)) return;
    state.abortedMembers.push(member);
    state.abortAt = at;
    state.abortReason = reason;
    decide(at, reason === 'stall' ? 'PRIMARY.ABORT' : 'PROT.MAXPROT_SHUTDOWN', true, claim,
      { kind: 'member', id: member as string });
  }

  /** Seconds of redo the primary generated that this member never received. */
  function unsent(id: MemberId, at: Seconds): Seconds {
    const since = state.unsentSince[id as string];
    const open = since === null || since === undefined ? 0 : Math.max(0, at - since);
    return (state.unsentAccum[id as string] ?? 0) + open;
  }

  /**
   * How far behind the primary's redo a member is: what the primary generated
   * without it, plus -- where the primary never waits for it -- what the
   * transport had not delivered. A member fed synchronously has no transport
   * gap: the commit waited for it.
   */
  function behind(id: MemberId, at: Seconds): Seconds {
    const m = doc.members.find((x) => x.id === id);
    const gap = m && !(feeds[id as string]?.sync ?? false) ? transportLagOf(m, state) : 0;
    return unsent(id, at) + gap;
  }

  function initiate(view: View, at: Seconds): void {
    if (state.phase !== 'normal' || !view.armed || view.obsSeesPrimary) return;
    /* "While the configuration is in the unobserved state, fast-start failover
       cannot happen." The state is cleared only when the observer reaches the
       primary again, so a primary that fails while it is unobserved is not
       failed over. */
    if (state.unobserved) return;

    /* Fast-start failover goes to the current target and to no other. */
    const target = state.activeTarget;
    if (target === null) return;
    /* ObserverOverride is FALSE: the target must itself have lost the primary
       for the whole window, not merely be out of touch right now. */
    const delay = initiateDelayClaim(doc, ping).value;
    const lost = state.targetLostPrimarySince[target as string];
    const usable = (view.targetAlive[target as string] ?? false)
      && !(view.targetSeesPrimary[target as string] ?? false)
      && lost !== null && lost !== undefined && lost + delay <= at + EPS
      && (view.obsSeesTarget[target as string] ?? false);
    if (!usable) return;

    const targetMember = doc.members.find((m) => m.id === target);
    if (!targetMember) return;
    const readiness = gateFor(target, at);

    /* The target is not ready and the primary is running: nothing failed, so
       nothing is initiated. The observer knows the state is UNSYNCHRONIZED (or
       TARGET OVER LAG LIMIT) -- it may be the one that recorded it. */
    const serving = view.primaryAlive && !view.stalled;
    if (!readiness.passes && serving) {
      decide(at, 'FSFO.NOT_POSSIBLE', false, asString(readiness.claim,
        `The master observer and ${target as string} have both lost the primary, but ${target as string} is ${lagGated(doc) ? 'TARGET OVER LAG LIMIT' : 'UNSYNCHRONIZED'}: fast-start failover is not possible, nothing is initiated, and the primary keeps running.`),
        { kind: 'member', id: target as string });
      return;
    }

    decide(at, 'FSFO.BOTH_MUST_HAVE_LOST', true, asString(
      documented(true, ['FSFO.BOTH_MUST_HAVE_LOST', 'FSFO.OBSERVER_OVERRIDE_FALSE'],
        'ObserverOverride is FALSE, the broker default, and this engine models the default only: set TRUE, the observer could initiate once IT had lost the primary even if the standby has a healthy connection to the primary.'),
      `Both the master observer and the target standby have lost the primary for ${ping ? 'the ping window (both ObserverPing properties are set, so the threshold is ignored for detection)' : 'the threshold'}.`));
    decide(at, 'FSFO.OBSERVER_REACHES_TARGET', true, asString(
      documented(true, ['OBS.CANNOT_OCCUR_LIST', 'OBS.MASTER_ONLY_COORDINATES'],
        'Only the master observer can coordinate fast-start failover, and fast-start failover cannot occur if the master observer is not running.'),
      `The master observer reaches ${target as string} and can order the failover.`));
    decide(at, 'FSFO.TARGET_SELECTION', true,
      selectTarget([target], () => true, () => true, policy).claim,
      { kind: 'member', id: target as string });
    if (ping) {
      const d = detectClaim(doc, ping);
      decide(at, 'FSFO.PING_ARITHMETIC', true, asString(d,
        `Detection took ${d.value} s: with both ping properties set the threshold is ignored for the observer's detection.`));
    }

    decide(at, 'FSFO.READINESS_GATE', readiness.passes, asString(readiness.claim,
      readiness.passes
        ? `${target as string} passes the readiness check.`
        : `${target as string} fails the readiness check, so no fast-start failover happens.`),
      { kind: 'member', id: target as string });

    const netHop = netHopSeconds(doc, view, target);
    const applyRemaining = applyLagOf(targetMember, state);
    const gap = applyGapOf(targetMember, state);
    if (gap > 0 && isDatabase(targetMember)) {
      decide(at, 'RAC.APPLY_GAP_IN_FAILOVER', true, applyGapFailoverClaim(targetMember, gap),
        { kind: 'member', id: target as string });
    }
    state.target = target;
    state.detectSeconds = detectClaim(doc, ping).value;
    state.initiateAt = at;
    state.execStartAt = at + netHop;
    state.tOpenAt = at + netHop + applyRemaining + doc.environment.roleTransitionSeconds;
    state.blocked = !readiness.passes;
    state.gateLagAtFailure = readiness.gateLag;

    if (!readiness.passes) {
      state.phase = 'blocked';
      addFinding(gateFinding(doc, target, readiness));
      return;
    }

    state.phase = 'failing-over';
    state.loss = failoverLoss(view, target, readiness);
    const after = modeAfterFailover(doc, 'fsfo', true);
    if (after) state.modeAfterRoleChange = after.value;
    const subject = { kind: 'member' as const, id: target as string };
    q.push({ kind: 'fsfo.exec', at: state.execStartAt, subject }, 'fsfo.exec', false, target);
    q.push({ kind: 'fsfo.open', at: state.tOpenAt, subject }, 'fsfo.open', false, target);
    decide(at, 'EXEC.ENV_DEPENDENT', true, asString(
      executionClaim(doc.environment.roleTransitionSeconds),
      'Terminal recovery, the role change and the open are environment-dependent, not parameter-driven.'));
  }

  function gateFor(id: MemberId, at: Seconds): Readiness {
    const m = doc.members.find((x) => x.id === id);
    if (!m) {
      return {
        passes: false, gateLag: 0,
        claim: documented(false, ['FSFO.TARGET_KIND'], 'No such member.'),
      };
    }
    return readinessGate(doc, m, state.fsfoReady[id as string] ?? false, state, unsent(id, at));
  }

  /**
   * What a fast-start failover that passed its readiness check costs.
   *
   * Direct SYNC or FASTSYNC to a synchronized target is the documented zero.
   * Where the lag limit is the gate the loss is bounded by what the gate
   * measured. Across a far sync instance the zero rests on this page's reading
   * of SYNCHRONIZED across the hop, so it is a model; and when the far sync
   * instance is gone together with the primary, the redo it had not yet
   * forwarded is gone with it and no zero is claimed at all.
   */
  function failoverLoss(view: View, target: MemberId, readiness: Readiness): NonNullable<SimState['loss']> {
    const resynced = state.resyncedAt[target as string] ?? null;
    const resyncNote = resynced === null ? ''
      : ` The target had been cut off earlier in this run and is drawn as resynchronized from ${resynced} s on, at once -- that is this page's model, so the figure is too.`;
    if (lagGated(doc)) {
      const claim: Claim<number> = resynced === null
        ? documented(readiness.gateLag, ['FSFO.LAGLIMIT_MAXAVAIL_26AI', 'FSFO.LAGTYPE'],
          'The failover loses no more than the lag the readiness gate measured, which is what FastStartFailoverLagLimit bounds.')
        : model(readiness.gateLag,
          `The failover loses no more than the lag the readiness gate measured, which is what FastStartFailoverLagLimit bounds.${resyncNote}`,
          ['FSFO.LAGLIMIT_MAXAVAIL_26AI', 'FSFO.LAGTYPE', 'FSFO.RESYNC_RESTORES']);
      return { kind: 'bounded', seconds: readiness.gateLag, claim };
    }
    const via = feeds[target as string]?.farSyncs ?? [];
    if (via.length > 0) {
      const lostFarSync = via.find((id) => {
        const fs = doc.members.find((x) => x.id === id);
        const tm = doc.members.find((x) => x.id === target);
        return !fs || !tm || !memberAlive(doc, state.net, fs)
          || !membersReachable(doc, state.net, fs, tm, view.reach);
      });
      if (lostFarSync !== undefined) {
        const tm = doc.members.find((x) => x.id === target);
        const gap = tm ? transportLagOf(tm, state) : 0;
        return {
          kind: 'unknown', seconds: gap,
          claim: model(gap,
            `FAILOVER.LOSS_FARSYNC_GONE: zero data loss across a far sync instance rests on the far sync holding every committed change and forwarding it. ${lostFarSync as string} is not there to forward anything -- it was lost with the primary -- so whatever it had not yet sent over the ASYNC leg is lost with it, and this run cannot say how much. The number shown is the transport lag as configured, a floor and not a bound.`,
            ['FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC', 'FSFO.FARSYNC_XPT']),
        };
      }
      return {
        kind: 'none', seconds: 0,
        claim: model(0,
          `SYNC.ACROSS_FARSYNC: how SYNCHRONIZED is computed across a far sync hop is not documented. The far sync instance received every commit synchronously and is there to forward what the target still lacks, so this page draws the failover as zero data loss -- its reading, not a documented zero.${resyncNote}`,
          ['FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC', 'FSFO.FARSYNC_XPT']),
      };
    }
    if (resynced !== null) {
      return {
        kind: 'none', seconds: 0,
        claim: model(0, `The standby was synchronized when the primary failed.${resyncNote}`,
          ['MAXAVAIL.AT_LEAST_ONE', 'FSFO.RESYNC_RESTORES']),
      };
    }
    return {
      kind: 'none', seconds: 0,
      claim: documented(0, ['MAXAVAIL.AT_LEAST_ONE', 'FSFO.CANNOT_NOT_SYNCHRONIZED'],
        'The standby was synchronized with the primary at the time the primary failed, so the failover loses nothing.'),
    };
  }

  function completeFailover(view: View, at: Seconds): void {
    const target = state.target;
    if (target === null) return;
    const manual = state.manualFailoverAt !== null;
    state.formerPrimary = state.primary;
    /* A manual failover does not close a primary that is still running: the
       shutdown is the operator's (FAILOVER.PRIMARY_SHUT_DOWN), and no page
       says the broker takes it down or mounts it. So with fast-start failover
       disabled it stays open beside the new primary until something takes it
       down -- this page's reading of a gap, drawn as such
       (`formerPrimaryFinding`). With fast-start failover ENABLED the target it
       was running with has just become the primary, so it has lost its target:
       it is drawn stalled from this instant and then follows
       FastStartFailoverPmyShutdown (owner decision D5, a `model`). A
       fast-start failover has its own documented path for the old primary (the
       stall, the abort). */
    const fp = doc.members.find((m) => m.id === state.formerPrimary);
    const fpRuns = !!fp && memberAlive(doc, state.net, fp) && !state.abortedMembers.includes(fp.id);
    state.formerOpen = manual && fpRuns;
    state.formerLostTarget = manual && fpRuns && view.fsfoEnabled;
    /* Still running as a primary: stalled before the role change and nobody has
       reached it since, or the D5 case. A crashed former primary that restarts
       later is a restarted database, not an acting primary. */
    state.formerActs = fpRuns && (state.formerLostTarget
      || (state.stallSince[state.formerPrimary as string] ?? null) !== null);
    state.newPrimary = target;
    state.primary = target;
    state.converting = null;
    state.phase = 'failed-over';
    state.tOpenAt = at;
    /* The new primary has no synchronized fast-start failover target yet (D6):
       the former primary becomes one only once it is reinstated. Until then the
       new primary can stall for no loss of the observer or the standbys. */
    state.activeTarget = null;
    /* A new primary starts with no acknowledgement behind it (kernel.ts). */
    state.ackArmed = false;
    state.ackLostSince = null;

    if (state.modeAfterRoleChange !== null) {
      const after = modeAfterFailover(doc, manual ? 'manual' : 'fsfo', view.fsfoEnabled);
      if (after) {
        decide(at, 'PROT.MODE_AFTER_FAILOVER', true, asString(after,
          `${target as string} opens in ${after.value}.`), { kind: 'member', id: target as string });
      }
    }

    const follow = doc.config.bystandersFollowRoleChange;
    decide(at, 'BYSTANDERS.FOLLOW', follow === 'ALL', asString(bystanderClaim(follow)));
    for (const b of bystanders(doc, target)) {
      if (b === state.formerPrimary) continue;
      if (follow === 'NONE') {
        state.disabledMembers.push(b);
        continue;
      }
      /* ALL: the broker works out who is ahead of the new primary. */
      const bm = doc.members.find((m) => m.id === b);
      if (!bm || !memberAlive(doc, state.net, bm)) continue;
      const mine = behind(b, at);
      const theirs = behind(target, at);
      if (mine + EPS < theirs) {
        const ahead = bystanderAhead(b, target, mine, theirs);
        state.disabledMembers.push(b);
        addFinding(ahead.finding);
        decideAt(at, 'BYSTANDERS.AHEAD', true, ahead.claim, { kind: 'member', id: b as string });
      }
    }

    /* FastStartFailoverAutoReinstate reinstates only after an observer-initiated
       failover caused by a primary crash or isolation -- never after a manual
       FAILOVER TO, a user-configurable health condition or a
       DBMS_DG.INITIATE_FS_FAILOVER call. */
    const former = manual ? null : state.formerPrimary;
    if (former !== null) {
      const missing = reinstateFindings(doc, former, target);
      for (const f of missing) addFinding(f);
      /* Reinstatement is pending, not under way: the band starts when the
         former primary is running and the master observer and the new primary
         both reach it (`trackReinstatement`). */
      if (missing.length === 0) state.reinstatePending = former;
    }
  }

  /**
   * SIM-16. Automatic reinstatement of the former primary starts only when the
   * broker can do it: "the master observer will attempt to reinstate the
   * former primary database as a new standby database when a connection to the
   * former primary database is reestablished", and it cannot while "The master
   * observer cannot connect to the former primary database" or "The former
   * primary database cannot connect to the new primary database". With
   * FastStartFailoverPmyShutdown TRUE the former primary "must be manually
   * restarted before the master observer can attempt to reinstate it" -- and
   * nothing in a run restarts an aborted database.
   */
  function trackReinstatement(view: View, at: Seconds): void {
    const id = state.reinstatePending;
    if (id === null || state.phase !== 'failed-over') return;
    const fp = doc.members.find((m) => m.id === id);
    if (!fp) return;
    const subject = { kind: 'member' as const, id: id as string };
    const name = fp.name;
    const waits = (cause: string, claim: Claim<string>): void => {
      decide(at, 'REINSTATE.WAITING', false, claim, subject, cause);
    };
    if (state.abortedMembers.includes(id)) {
      waits('aborted', documented(
        `${name} shut itself down (FastStartFailoverPmyShutdown is TRUE) and is not reinstated: it must be restarted by hand before the master observer can attempt to reinstate it.`,
        ['REINSTATE.PMY_SHUTDOWN_RESTART', 'FSFO.AUTO_REINSTATE']));
      return;
    }
    if (!memberAlive(doc, state.net, fp)) {
      waits('down', documented(
        `${name} is down, and is not reinstated until it is started and mounted: the master observer attempts the reinstatement when a connection to it is reestablished.`,
        ['REINSTATE.WHEN_RECONNECTED', 'FSFO.AUTO_REINSTATE']));
      return;
    }
    const observerReaches = view.masterHost !== null
      && memberReachableFromHost(doc, state.net, fp, view.masterHost, view.reach);
    const reachesNew = view.primaryAlive && membersReachable(doc, state.net, fp, view.primary, view.reach);
    if (!observerReaches || !reachesNew) {
      const cant = !observerReaches
        ? `the master observer cannot connect to ${name}`
        : `${name} cannot connect to the new primary`;
      waits(!observerReaches ? 'observer' : 'primary', documented(
        `${name} is not reinstated while it is cut off: ${cant}. The broker cannot reinstate the former primary under either condition; the master observer attempts the reinstatement when a connection to it is reestablished.`,
        ['REINSTATE.RESTRICT_OBSERVER_CONNECT', 'REINSTATE.RESTRICT_NEW_PRIMARY_CONNECT', 'REINSTATE.WHEN_RECONNECTED']));
      return;
    }
    state.reinstatePending = null;
    state.reinstating = id;
    rearmApply(id, at);
    decide(at, 'REINSTATE.OPEN_BAND', true, asString(reinstateBandClaim(),
      `${id as string} is reinstated as the new standby; how long that takes is environment-dependent, so the band is drawn with no end.`));
  }

  /**
   * One role change per run. A second one -- a command, or a failure that
   * would have fast-start failover evaluated again -- is not simulated, and
   * the run says so rather than letting the lanes pass for an Oracle outcome.
   */
  function oneRoleChange(at: Seconds, what: string, subject: { kind: 'member'; id: string }): void {
    const note = 'SIM.ONE_ROLE_CHANGE: this page evaluates one role change per run. Oracle does not stop there -- fast-start failover stays enabled across a role change, and "the reinstated database acts as the fast-start failover target for the new primary database, making a subsequent fast-start failover possible" -- so what the lanes show after this instant is where the simulation ends, not what Oracle would do.';
    addFinding({
      id: 'SIM.ONE_ROLE_CHANGE', severity: 'warning', basis: 'model',
      cite: ['FSFO.REINSTATED_IS_TARGET', 'FSFO.AUTO_REINSTATE'],
      subject,
      message: `${what} This run has already completed a role change, and a second one is not simulated: read the lanes after ${at} s as the end of the simulation, not as an Oracle outcome.`,
      note,
    });
    decide(at, 'SIM.ONE_ROLE_CHANGE', false,
      model(`${what} Not simulated: this page evaluates one role change per run.`, note,
        ['FSFO.REINSTATED_IS_TARGET', 'FSFO.AUTO_REINSTATE']), subject);
  }

  function roleChanged(): boolean {
    return state.phase !== 'normal' && state.phase !== 'blocked';
  }

  function runSwitchover(view: View, at: Seconds): void {
    const to = state.pendingSwitchover;
    state.pendingSwitchover = null;
    if (to === null) return;
    const m = doc.members.find((x) => x.id === to);
    if (!m || isFarSync(m)) {
      addFinding({
        id: 'MEMBER.FARSYNC_NOT_PRIMARY', severity: 'error', basis: 'documented',
        cite: ['FS.NO_DATAFILES'], subject: { kind: 'member', id: to as string },
        message: 'A far sync instance can never function in the primary role or be converted to any type of standby database.',
      });
      return;
    }
    if (roleChanged()) {
      oneRoleChange(at, `SWITCHOVER TO ${to as string} was issued at ${at} s.`, { kind: 'member', id: to as string });
      return;
    }

    if (roleFenceRefuses(view, to, 'SWITCHOVER TO', at)) return;

    const gateLag = gateLagSeconds(doc, m, state) + unsent(to, at);
    const targetUp = memberAlive(doc, state.net, m) && !state.abortedMembers.includes(to)
      && !state.disabledMembers.includes(to);
    const gate = switchoverGate({
      fsfoEnabled: view.fsfoEnabled,
      maxPerformance: doc.config.protectionMode === 'MAXPERFORMANCE',
      gateLag,
      lagLimit: lagLimitOf(doc),
      isTarget: state.activeTarget === to,
      /* Synchronized is about redo RECEIVED, and under SYNC or FASTSYNC the
         commit waits for the acknowledgement: an apply lag never blocks a
         maximum availability switchover. Where FastStartFailoverLagLimit is
         the readiness gate (26ai bounded maximum availability) the recorded
         state carries the lag rather than a transport fact, so the transport
         itself is asked -- directly, or across a far sync instance, which is
         not a cascade and does not affect a switchover. */
      synchronized: lagGated(doc)
        ? transportSynchronized(doc, view, to) && unsent(to, at) <= EPS
        : (state.fsfoReady[to as string] ?? false),
      primaryUp: view.primaryAlive && !view.stalled,
      targetUp,
      connected: view.primaryAlive && targetUp
        && membersReachable(doc, state.net, view.primary, m, view.reach),
    });
    const refusal = refusalText(gate.reason, to, gateLag);
    decide(at, 'SWITCHOVER.GATE', !gate.blocked, asString(gate.claim,
      gate.blocked
        ? `The broker refuses the SWITCHOVER: ${refusal}.`
        : 'The broker permits the SWITCHOVER.'), { kind: 'member', id: to as string });

    if (gate.blocked) {
      state.switchover = switchoverRefused(at, to, gate.reason);
      const needs = gate.reason === 'primary-down' || gate.reason === 'target-down'
        || gate.reason === 'not-connected';
      addFinding({
        id: 'SWITCHOVER.REFUSED', severity: needs ? 'error' : 'warning', basis: 'documented',
        cite: needs ? ['SWITCHOVER.FARSYNC_NO_EFFECT', 'SWITCHOVER.FORMER_PRIMARY_RESTARTS']
          : gate.reason === 'past-lag-limit'
            ? ['SWITCHOVER.FSFO_GATE', 'FSFO.LAGLIMIT_RECOMMENDATION']
            : gate.reason === 'not-target'
              ? ['SWITCHOVER.FSFO_GATE', 'SWITCHOVER.FSFO_TARGET_ONLY', 'ORA.16655']
              : ['SWITCHOVER.FSFO_GATE'],
        subject: { kind: 'member', id: to as string },
        message: `The SWITCHOVER is refused: ${refusal}. Nothing converts${gate.reason === 'primary-down' ? '' : ' and the primary never stops serving'}.`,
        ...(gate.reason === 'not-target' ? { ora: 'ORA-16655' } : {}),
      });
      return;
    }

    /* A far sync instance between the two is not a cascade: the procedure "is
       the same", and whether it is available does not affect the switchover.
       Only a standby DATABASE in the feed path makes the target a terminal
       standby, and that switchover the documentation does not cover. */
    if ((feeds[to as string]?.cascaders.length ?? 0) > 0) {
      addFinding({
        id: 'SWITCHOVER.TO_TERMINAL_UNDOC', severity: 'warning', basis: 'model',
        cite: ['CASCADE.TERMINAL_INDIRECT', 'CASCADE.MANUAL_FAILOVER_UNSENT'],
        subject: { kind: 'member', id: to as string },
        message: `${to as string} receives redo indirectly, through another standby.`,
        note: 'SWITCHOVER.TO_TERMINAL_UNDOC: manual failover to a terminal standby is documented; switchover to one is not. This engine draws it, and says the documentation does not cover it.',
      });
    }

    state.switchover = switchoverSchedule(
      at, to, applyLagOf(m, state), doc.environment.roleTransitionSeconds,
    );
    state.phase = 'switching';
    state.loss = { kind: 'none', seconds: 0, claim: switchoverLossClaim() };
    const subject = { kind: 'member' as const, id: to as string };
    const sw = state.switchover;
    if (sw.tDown !== null) q.push({ kind: 'switchover.verify', at: sw.tDown, subject }, 'switchover.verify', false, to);
    if (sw.tConvertEnd !== null) q.push({ kind: 'switchover.convert', at: sw.tConvertEnd, subject }, 'switchover.convert', false, to);
    if (sw.tOpen !== null) q.push({ kind: 'switchover.open', at: sw.tOpen, subject }, 'switchover.open', false, to);
  }

  function refusalText(reason: SwitchoverRefusal | null, to: MemberId, gateLag: Seconds): string {
    switch (reason) {
      case 'primary-down':
        return 'the primary is down, and a switchover is a planned role reversal between two running databases -- what is left is a failover';
      case 'target-down':
        return `${to as string} is down, and a switchover needs both databases running`;
      case 'not-connected':
        return `the primary and ${to as string} cannot reach each other, and during a switchover the primary and standby must be able to communicate directly with each other`;
      case 'not-target':
        return `with fast-start failover enabled the broker permits a switchover only to the pre-specified target standby, and ${to as string} is not the current fast-start failover target${state.activeTarget ? ` (${state.activeTarget as string} is)` : ''} -- ORA-16655`;
      case 'not-synchronized':
        return 'with fast-start failover enabled, in maximum availability the broker permits it only while the target standby is synchronized, and this one has redo it has not received';
      case 'past-lag-limit':
        return `with fast-start failover enabled, in maximum performance mode the broker permits it only inside FastStartFailoverLagLimit (${gateLag} s against ${lagLimitOf(doc)} s)`;
      default:
        return '';
    }
  }

  /**
   * PrimaryDatabaseCandidates is a fast-start-failover-DISABLED fence: while
   * fast-start failover is disabled it restricts SWITCHOVER and FAILOVER to
   * the members it lists and refuses anything else with ORA-16529; once
   * fast-start failover is enabled it adds nothing, because
   * FastStartFailoverTarget already governs the target. The default (empty)
   * restricts nothing.
   */
  function roleFenceRefuses(view: View, to: MemberId, verb: string, at: Seconds): boolean {
    const list = doc.config.primaryDatabaseCandidates ?? [];
    if (view.fsfoEnabled || list.length === 0 || list.includes(to)) return false;
    addFinding({
      id: 'ROLE.PRIMARY_DB_CANDIDATES', severity: 'error', basis: 'doc-later',
      cite: ['FSFO.PRIMARY_DB_CANDIDATES', 'ORA.16529'],
      subject: { kind: 'member', id: to as string },
      message: `${verb} ${to as string} is refused with ORA-16529: fast-start failover is disabled and PrimaryDatabaseCandidates (${list.join(', ')}) does not list it. While fast-start failover is disabled the property restricts SWITCHOVER and FAILOVER to the members it names; once enabled it adds nothing, because FastStartFailoverTarget already governs the target.`,
      ora: 'ORA-16529',
      note: 'PrimaryDatabaseCandidates is documented on the 26ai property page; the 19.26 backport is reported by the Data Guard PM\'s blog series only, not by Oracle\'s release-update documentation, so it is carried as reported rather than documented for 19c.',
    });
    decide(at, 'ROLE.PRIMARY_DB_CANDIDATES', false, {
      value: `${verb} ${to as string} refused: not in PrimaryDatabaseCandidates.`,
      basis: 'doc-later', cite: ['FSFO.PRIMARY_DB_CANDIDATES', 'ORA.16529'],
      note: 'A fast-start-failover-disabled fence, never "a fence around fast-start failover"; documented in 26ai, reported for 19.26.',
    }, { kind: 'member', id: to as string });
    /* Refused is refused: the readout reads "blocked", as it does for a
       switchover the gate turned down. */
    if (verb.startsWith('FAILOVER')) state.blocked = true;
    return true;
  }

  function completeSwitchover(at: Seconds): void {
    const sw = state.switchover;
    if (!sw || sw.blocked) return;
    state.formerPrimary = state.primary;
    state.newPrimary = sw.to;
    state.primary = sw.to;
    state.converting = null;
    state.phase = 'switched';
    state.tOpenAt = at;
    state.ackArmed = false;
    state.ackLostSince = null;
    /* No synchronized fast-start failover target yet (D6): the former primary
       restarts as the new standby, drawn as an open-ended band, and is the
       target only once it is back. It is a standby from now on -- never an
       acting primary, never stalled or aborted as one. */
    state.activeTarget = null;
    state.formerActs = false;
    state.formerOpen = false;
    if (state.formerPrimary !== null) rearmApply(state.formerPrimary, at);
    decide(at, 'SWITCHOVER.ZERO_LOSS', true, asString(switchoverLossClaim(),
      'The roles swap only once the standby has everything: zero data loss in every protection mode. The former primary restarts as the new standby, and the new primary does not wait for it.'));
  }

  function runManualFailover(view: View, at: Seconds): void {
    const cmd = state.pendingFailover;
    state.pendingFailover = null;
    if (cmd === null) return;
    const to = cmd.to;
    const m = doc.members.find((x) => x.id === to);
    if (!m || isFarSync(m)) {
      addFinding({
        id: 'FSFO.TARGET_KIND', severity: 'error', basis: 'documented',
        cite: ['FSFO.TARGET_NOT_FARSYNC'], subject: { kind: 'member', id: to as string },
        message: 'A far sync instance is never a failover target: it can never function in the primary role.',
      });
      return;
    }
    if (roleChanged()) {
      oneRoleChange(at, `FAILOVER TO ${to as string} was issued at ${at} s.`, { kind: 'member', id: to as string });
      return;
    }
    if (roleFenceRefuses(view, to, 'FAILOVER TO', at)) return;
    /* Whether this member is fed directly or through another standby is a
       property of the configuration as declared, not of the network the moment
       the command is issued -- by then the primary may be gone. */
    const cascaded = (feeds[to as string]?.cascaders.length ?? 0) > 0;
    const observerTalks = view.master !== null && (view.obsSeesTarget[to as string] ?? false);
    const targetUp = memberAlive(doc, state.net, m) && !state.abortedMembers.includes(to)
      && !state.disabledMembers.includes(to);
    const checked = manualFailoverFindings(doc, to, {
      fsfoEnabled: view.fsfoEnabled,
      isFsfoTarget: state.activeTarget === to,
      ready: gateFor(to, at).passes,
      observerTalksToTarget: observerTalks,
      cascaded,
      immediate: cmd.immediate,
      targetUp,
      primaryUp: view.primaryAlive,
    });
    for (const f of checked.findings) addFinding(f);

    const subject = { kind: 'member' as const, id: to as string };
    if (checked.refused) {
      state.blocked = true;
      const first = checked.findings[0];
      decide(at, 'FSFO.MANUAL_FAILOVER', false, {
        value: `FAILOVER TO ${to as string} is refused, and nothing changes role. ${first?.message ?? ''}`.trim(),
        basis: first?.basis ?? 'documented',
        cite: first ? [...first.cite] : ['FSFO.MANUAL_FAILOVER_CONDITIONS'],
        ...(first?.note !== undefined ? { note: first.note }
          : first && first.basis !== 'documented' ? { note: first.message } : {}),
      }, subject);
      return;
    }

    state.blocked = false;
    state.manualFailoverAt = at;
    state.target = to;
    state.loss = manualLoss(to, at);
    const after = modeAfterFailover(doc, 'manual', view.fsfoEnabled);
    if (after) state.modeAfterRoleChange = after.value;
    /* A role change is under way, so no fast-start failover clock runs on top
       of it -- with fast-start failover still enabled the observer would have
       ordered its own, which is the whole point of DISABLE FAST_START FAILOVER
       FORCE in the documented conditions above. */
    state.phase = 'failing-over';
    /* An immediate failover applies none of the redo the standby holds. */
    const applyRemaining = cmd.immediate ? 0 : applyLagOf(m, state);
    state.execStartAt = at;
    state.tOpenAt = at + applyRemaining + doc.environment.roleTransitionSeconds;
    state.converting = to;
    q.push({ kind: 'fsfo.open', at: state.tOpenAt, subject }, 'fsfo.open', false, to);
    decide(at, 'FSFO.MANUAL_FAILOVER', true, asString(
      documented(true, ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'FSFO.STATUS_DISABLED'],
        'A manual FAILOVER TO needs no observer while fast-start failover is disabled. With fast-start failover enabled it is conditional: the target must be the current fast-start failover target, synchronized (maximum availability or protection) or inside the lag limit (maximum performance), with the observer started and communicating with it, and the primary shut down first.'),
      `FAILOVER TO ${to as string}.`), subject);
  }

  /**
   * What a manual failover loses: the redo the standby never received. How
   * long the primary ran without it is what this run knows; where the primary
   * never waited for this standby, what the transport had not delivered comes
   * on top.
   */
  function manualLoss(to: MemberId, at: Seconds): NonNullable<SimState['loss']> {
    const m = doc.members.find((x) => x.id === to);
    const ranWithout = unsent(to, at);
    if (legacyLoss) {
      const lag = doc.config.protectionMode === 'MAXPERFORMANCE' && m ? applyLagOf(m, state) : 0;
      const seconds = ranWithout + lag;
      return {
        kind: 'manual', seconds,
        claim: manualLossClaim(seconds, { ranWithout, lag, lagIs: lag > 0 ? 'apply' : 'none' }),
      };
    }
    const waited = feeds[to as string]?.sync ?? false;
    const lag = !waited && m ? transportLagOf(m, state) : 0;
    const seconds = ranWithout + lag;
    return {
      kind: 'manual', seconds,
      claim: manualLossClaim(seconds, { ranWithout, lag, lagIs: waited ? 'none' : 'transport' }),
    };
  }

  /**
   * REINSTATE DATABASE. The band is drawn only where the command can succeed;
   * where it cannot, the precondition that fails is what the run reports.
   */
  function runReinstate(view: View, at: Seconds): void {
    const id = state.pendingReinstate;
    state.pendingReinstate = null;
    if (id === null) return;
    const m = doc.members.find((x) => x.id === id);
    if (!m || !isDatabase(m)) return;
    const failedOver = state.phase === 'failed-over';
    const needs = failedOver
      && (state.formerPrimary === id || state.disabledMembers.includes(id));
    const up = memberAlive(doc, state.net, m) && !state.abortedMembers.includes(id);
    const reaches = up && membersReachable(doc, state.net, view.primary, m, view.reach);
    const problems = reinstateCommandFindings(doc, id, {
      needsReinstate: needs, up, reachesPrimary: reaches, newPrimary: state.newPrimary,
    });
    const subject = { kind: 'member' as const, id: id as string };
    if (problems.length > 0) {
      for (const f of problems) addFinding(f);
      const first = problems[0] as Finding;
      decideAt(at, 'REINSTATE.COMMAND', false, {
        value: first.message, basis: first.basis, cite: [...first.cite],
        ...(first.note !== undefined ? { note: first.note } : {}),
      }, subject);
      return;
    }
    if (state.formerPrimary === id) state.reinstating = id;
    if (state.reinstatePending === id) state.reinstatePending = null;
    state.disabledMembers = state.disabledMembers.filter((x) => x !== id);
    decideAt(at, 'REINSTATE.COMMAND', true, asString(reinstateBandClaim(),
      `REINSTATE DATABASE ${id as string}: Flashback Database is on and the new primary is in reach, so the broker flashes it back and brings it in as a standby. How long that takes is environment-dependent, so the band is drawn with no end.`),
      subject);
  }

  /**
   * SET MASTEROBSERVER TO. "The actual switch does not happen until the next
   * time the primary contacts the target standby, usually within three
   * seconds if fast-start failover is enabled" -- so the role does not move at
   * the instant of the command.
   */
  function runSetMasterObserver(at: Seconds): void {
    const observer = state.pendingMasterObserver;
    state.pendingMasterObserver = null;
    if (observer === null) return;
    const due = at + SET_MASTER_SECONDS;
    masterSwitches.push({ at: due, observer });
    q.push({ kind: 'observer.master', at: due, subject: { kind: 'observer', id: observer as string } },
      'observer.master', false);
  }

  function applyMasterSwitches(view: View, at: Seconds): void {
    for (let i = masterSwitches.length - 1; i >= 0; i--) {
      const sw = masterSwitches[i] as { at: Seconds; observer: ObserverId };
      if (!isDue(sw.at, at)) continue;
      masterSwitches.splice(i, 1);
      const subject = { kind: 'observer' as const, id: sw.observer as string };
      const target = state.activeTarget;
      const problems: string[] = [];
      const o = doc.observers.find((x) => x.id === sw.observer);
      if (!o || !(state.observers[sw.observer as string]?.running ?? false)
        || !hostUp(doc, state.net, o.host)) problems.push(`${sw.observer as string} is not running`);
      if (view.fsfoEnabled) {
        if (target === null || !(view.targetAlive[target as string] ?? false)) {
          problems.push('the target standby is not enabled and running');
        } else if (!(view.targetSeesPrimary[target as string] ?? false)) {
          problems.push('the primary is not in contact with the target standby, so the next fast-start failover ping never comes');
        }
        if (state.phase === 'failing-over' || state.phase === 'switching' || state.converting !== null
          || state.reinstating !== null) {
          problems.push('a role change or a reinstatement is in progress');
        }
      }
      if (problems.length > 0) {
        const message = `SET MASTEROBSERVER TO ${sw.observer as string} does not take effect: ${problems.join('; ')}. For the manual setting to succeed the target standby must be enabled and must not require reinstatement, and no role change, reinstatement or change of fast-start failover target may be in progress.`;
        addFinding({
          id: 'OBS.SET_MASTEROBSERVER_REFUSED', severity: 'warning', basis: 'documented',
          cite: ['OBS.SET_MASTEROBSERVER_CONDITIONS', 'OBS.SET_MASTEROBSERVER'], subject, message,
        });
        decideAt(at, 'OBS.SET_MASTEROBSERVER', false,
          documented(message, ['OBS.SET_MASTEROBSERVER_CONDITIONS', 'OBS.SET_MASTEROBSERVER']), subject);
        continue;
      }
      state.masterOverride = sw.observer;
    }
  }

  function updateClocks(view: View, at: Seconds): void {
    /* The threshold clock starts when the observer first loses its connection
       to the primary. */
    /* The clock is the master observer's: with no master running there is no
       observer to lose the connection, and a backup nominated later starts its
       own count from the moment it takes over. */
    state.obsLostPrimarySince = view.fsfoEnabled && view.master !== null && !view.obsSeesPrimary
      ? state.obsLostPrimarySince ?? at
      : null;
    if (state.thresholdStartAt === null && state.obsLostPrimarySince !== null) {
      state.thresholdStartAt = state.obsLostPrimarySince;
    }

    for (const id of view.candidates) {
      const key = id as string;
      state.targetLostPrimarySince[key] = (view.targetSeesPrimary[key] ?? false)
        ? null
        : state.targetLostPrimarySince[key] ?? at;
    }

    /* One stall clock per acting primary, so a former primary that nobody can
       reach keeps counting down to its own abort after the role change. */
    for (const [id, actor] of Object.entries(view.actors)) {
      state.stallSince[id] = actor.stalled ? state.stallSince[id] ?? at : null;
      if (id === (state.primary as string) && state.stallStartAt === null && state.stallSince[id] !== null) {
        state.stallStartAt = state.stallSince[id];
      }
    }
    /* A database that is no longer an acting primary has no stall clock: a
       former primary that crashed, or that was reached again. */
    for (const id of Object.keys(state.stallSince)) {
      if (!(id in view.actors)) state.stallSince[id] = null;
    }
    /* A former primary reached again is no longer a stalled primary: from here
       it is drawn started and mounted (SIM-20). */
    if (state.formerActs && state.formerPrimary !== null
      && !(view.actors[state.formerPrimary as string]?.stalled ?? false)) {
      state.formerActs = false;
    }
    /* What "restarted" means: it was down or shut down at some epoch. */
    for (const m of doc.members) {
      if (!state.everDown.includes(m.id)
        && (!memberAlive(doc, state.net, m) || state.abortedMembers.includes(m.id))) {
        state.everDown.push(m.id);
      }
    }

    /* A commit hangs on a synchronous acknowledgement that stopped arriving.
       With no synchronous destination declared at all nothing is waited for
       -- the mode simply operates as if it were maximum performance. */
    const wantsAck = modeNow(doc, state) !== 'MAXPERFORMANCE' && view.syncDeclared;
    /* Only an acknowledgement that was there can go away. A primary that took
       the role with its synchronous destinations already down has none to
       lose, so nothing hangs: it opens read-write at the instant the role
       change completes, which is what the readout and the timeline say. */
    if (view.syncAcks.length > 0) state.ackArmed = true;
    state.ackLostSince = wantsAck && state.ackArmed && view.primaryAlive
      && view.syncAcks.length === 0
      ? state.ackLostSince ?? at
      : null;

    if (state.phase === 'normal') {
      trackObserved(view, at);
      retarget(view, at);
      trackReadiness(view, at);
      trackReopen(view, at);
    }
    state.primaryWasDown = !view.primaryAlive;
  }

  /**
   * Unobserved is a recorded state: the primary lost the master observer
   * while it still reached the target standby, and the two of them know it.
   * It ends when the observer reaches the primary again. A primary that loses
   * the observer and the standby at the same instant records nothing -- it
   * reaches nobody to record it with -- and that is the documented stall.
   */
  function trackObserved(view: View, at: Seconds): void {
    if (!view.fsfoEnabled || !view.primaryAlive) return;
    if (view.obsSeesPrimary) {
      if (state.unobserved) {
        state.unobserved = false;
        decideAt(at, 'OBS.OBSERVED_AGAIN', true, documented(
          'The master observer reaches the primary again: the configuration is observed, and fast-start failover is possible once more.',
          ['FSFO.UNOBSERVED_CONTINUES'],
          'The configuration status returns the SUCCESS status after the observer reestablishes its connection to the primary database, which then notifies the target standby database.'));
      }
      return;
    }
    if (view.anyTargetSeesPrimary && !state.unobserved) {
      state.unobserved = true;
      decideAt(at, 'OBS.UNOBSERVED', true, documented(
        'The primary has lost the master observer while it still reaches the target standby: the configuration is unobserved. Fast-start failover cannot happen, and the primary keeps processing transactions even if the target standby fails next.',
        ['FSFO.UNOBSERVED_CONTINUES', 'FSFO.PRIMARY_UNOBSERVED', 'ORA.16820']));
    }
  }

  /**
   * The automatic change of target, made by the broker while the primary is
   * there to make it. The instant is this page's model.
   */
  function retarget(view: View, at: Seconds): void {
    if (!view.fsfoEnabled || policy === 'active-target-only') return;
    if (!view.primaryAlive || view.stalled) return;
    const cur = state.activeTarget;
    const usable = (id: MemberId): boolean => (view.targetAlive[id as string] ?? false)
      && (view.targetSeesPrimary[id as string] ?? false);
    if (cur !== null && usable(cur)) return;
    const choice = selectTarget(
      view.candidates.filter((c) => c !== cur), usable,
      (id) => state.fsfoReady[id as string] ?? false, 'skip-to-next',
    );
    if (choice.target === null) return;
    state.activeTarget = choice.target;
    decideAt(at, 'FSFO.TARGET_CHANGE', true, asString(choice.claim,
      `${cur === null ? 'The target' : (cur as string)} cannot be the target of a failover any more, and the primary is there to make the change: the broker changes the fast-start failover target to ${choice.target as string}.`),
      { kind: 'member', id: choice.target as string });
  }

  /**
   * What each standby is worth, epoch by epoch.
   *
   * While redo reaches a member its state is what the transport makes it.
   * While it does not, the state holds for as long as nothing new is
   * committed -- the primary dead, stalled, or hanging on the commit -- and
   * is lost the instant the primary carries on without the member.
   */
  function trackReadiness(view: View, at: Seconds): void {
    const mode = modeNow(doc, state);
    const hanging = state.ackLostSince !== null && mode !== 'MAXPERFORMANCE'
      && state.ackLostSince + netTimeoutForMode(doc, view.graph) > at + EPS;
    const generating = view.primaryAlive && !view.stalled && !hanging;
    const gated = lagGated(doc);
    const limit = lagLimitOf(doc);

    for (const m of doc.members) {
      if (m.id === state.primary) continue;
      const key = m.id as string;
      const since = state.unsentSince[key];
      if (since !== null && since !== undefined) {
        state.unsentAccum[key] = (state.unsentAccum[key] ?? 0) + Math.max(0, at - since);
        state.unsentSince[key] = null;
      }
      const r = view.graph.members[m.id];
      const receiving = view.primaryAlive && !!r && r.reachableFromPrimary;
      const was = state.fsfoReady[key] ?? false;
      const candidate = view.candidates.includes(m.id);
      const subject = { kind: 'member' as const, id: key };

      if (receiving && r) {
        const missed = state.unsentAccum[key] ?? 0;
        if (missed > 0) {
          state.resyncedAt[key] = at;
          if (candidate) {
            decideAt(at, 'FSFO.RESYNC', true, resyncClaim(m.id, missed), subject);
            addFinding({
              id: 'FSFO.RESYNC_INSTANT', severity: 'info', basis: 'model',
              cite: ['FSFO.RESYNC_RESTORES'], subject,
              message: `${key} is drawn as synchronized again the instant redo reaches it, at ${at} s. In a real configuration the ability to fail over automatically returns only once the target has received all missing redo, which takes as long as the missing redo takes to ship.`,
              note: resyncClaim(m.id, missed).note ?? '',
            });
          }
        }
        state.cutOffSince[key] = null;
        state.unsentAccum[key] = 0;
        state.fsfoReady[key] = worthOf(doc, state, m, r);
        continue;
      }
      if (!view.primaryAlive) continue;

      const cut = state.cutOffSince[key] ?? at;
      state.cutOffSince[key] = cut;
      /* The stretch starts when the primary drops the member, which may lie
         ahead of this epoch: a bystander's count needs no epoch of its own. */
      const drop = cut + dropDelay(key, view);
      if (generating) state.unsentSince[key] = Math.max(at, drop);
      const from = state.unsentSince[key];
      const growing = from !== null && from !== undefined && from <= at + EPS;
      const missed = state.unsentAccum[key] ?? 0;
      let ready = was;
      if (gated) {
        if (isDatabase(m)) {
          const lag = gateLagSeconds(doc, m, state) + missed;
          ready = was && (growing ? lag < limit - EPS : lag <= limit + EPS);
        }
      } else if (growing || missed > 0) {
        ready = false;
      }
      state.fsfoReady[key] = ready;
      if (was && !ready && candidate) {
        const by = !view.fsfoEnabled ? 'disabled'
          : state.unobserved ? 'unobserved'
            : view.obsSeesPrimary ? 'observer' : 'target';
        decideAt(at, 'FSFO.NOT_READY', true, notReadyClaim(doc, m.id, by), subject);
      }
    }
  }

  /**
   * How long after a member is cut off the primary carries on without it.
   *
   * One NET_TIMEOUT where the primary is waiting for it: the hop out of the
   * primary is synchronous and that hop is what broke. Not at all where the
   * primary never waits -- maximum performance, an ASYNC hop -- or where the
   * hop out of the primary is fine and the break is further along, behind a
   * far sync instance that is still acknowledging.
   */
  function dropDelay(key: string, view: View): Seconds {
    const f = feeds[key];
    if (!f || !f.sync || f.firstHop === null || modeNow(doc, state) === 'MAXPERFORMANCE') return 0;
    const hopUp = view.graph.edges.some((e) => e.from === state.primary && e.to === f.firstHop
      && e.active && e.up);
    return hopUp ? 0 : f.netTimeout;
  }

  /**
   * A primary whose host comes back before anything changed role. With
   * fast-start failover enabled it has to be told it may open -- by the
   * observer or by the target -- and how long the restart takes is the
   * environment's; this page draws it open at the instant the host returns.
   */
  function trackReopen(view: View, at: Seconds): void {
    if (!state.primaryWasDown || !view.primaryAlive || at <= EPS) return;
    const note = 'PRIMARY.REOPEN_INSTANT: a restart takes as long as the instance takes to start, mount, recover and open, and none of that is modelled -- the primary is drawn open read-write at the instant its host returns. With fast-start failover enabled it opens only after the observer or the target standby has told it that no failover occurred.';
    decideAt(at, 'PRIMARY.REOPEN', true, model(
      `${state.primary as string} is back before any role change, and is drawn open again at once.`,
      note, ['OBS.RESTART_NEEDS_PERMISSION']),
      { kind: 'member', id: state.primary as string });
    addFinding({
      id: 'PRIMARY.REOPEN_INSTANT', severity: 'info', basis: 'model',
      cite: ['OBS.RESTART_NEEDS_PERMISSION'],
      subject: { kind: 'member', id: state.primary as string },
      message: `${state.primary as string} is drawn open read-write the instant its host returns, at ${at} s.`,
      note,
    });
  }

  /**
   * REOPEN, MaxFailure and the alternate latch, carried across the epochs.
   *
   * The counting is the documented one -- MaxFailure counts CONSECUTIVE
   * attempts to reestablish the destination, and at the limit there is no
   * further access until it is manually reenabled -- and the ladder the
   * attempts fall on is this engine's idealization, which is why the run says
   * so the first time a retry is drawn. A destination written in a priority
   * group is the documented 12.2+ exception: it re-enters service when it is
   * found accessible instead of staying disabled.
   */
  function updateDests(view: View, at: Seconds): void {
    const dests = authoredDests(doc, state.primary);
    const nameOf = (id: MemberId): string =>
      doc.members.find((m) => m.id === id)?.name ?? (id as string);

    for (const d of dests) {
      if (state.disabledDests.includes(d.key)) continue;
      const edge = view.graph.edges.find((e) => e.from === d.from && e.to === d.to);
      if (edge?.up === true) {
        if ((state.destFailures[d.key] ?? 0) > 0) addFinding(maxFailureResetUndoc(nameOf(d.to), at));
        state.destDownSince[d.key] = null;
        state.destFailures[d.key] = 0;
        continue;
      }
      const downSince = state.destDownSince[d.key] ?? at;
      state.destDownSince[d.key] = downSince;
      const failures = failedAttempts(downSince, at, d.props.reopenSeconds);
      if (failures > (state.destFailures[d.key] ?? 0)) addFinding(reopenScheduleModel());
      state.destFailures[d.key] = failures;
      if (d.retryLimit === null || failures < d.retryLimit) continue;
      if (d.inPriorityGroup) {
        addFinding(groupReenters(d, nameOf(d.from), nameOf(d.to)));
        continue;
      }
      state.disabledDests.push(d.key);
      addFinding(maxFailureDisabled(d, at, nameOf(d.from), nameOf(d.to)));
    }

    /* An alternate declared without FALLBACK stays in service once it has
       taken over; with FALLBACK the named destination comes back on its own.
       Which of the two the keyword means is this engine's reading, so the
       latch says so the first time it is taken. */
    for (const d of dests) {
      if (!d.alt || d.alt.fallback === true || state.altLatched.includes(d.key)) continue;
      const superseded = view.graph.edges.some((e) => e.from === d.from && e.to === d.to
        && e.inactiveReason === 'alternate-standby');
      if (!superseded) continue;
      state.altLatched.push(d.key);
      addFinding(alternateLatched(d, nameOf(d.from), nameOf(d.to), nameOf(d.alt.target)));
    }
    state.groupChoice = carryGroupChoice(state.groupChoice, view.graph);
  }

  /**
   * RAC members (facts.md F1-F4). A standby's apply instance moves to a
   * running instance once ApplyInstanceTimeout has passed since it failed; a
   * primary that still has an instance running stays available, and says so.
   */
  function updateRac(view: View, at: Seconds): void {
    /* The primary runs no apply: a standby that has just taken the role drops
       its apply instance, and any gap it was waiting out with it. */
    const pid = state.primary as string;
    if (state.applyInstance[pid] !== undefined) {
      delete state.applyInstance[pid];
      state.applyLostSince[pid] = null;
    }

    const primary = doc.members.find((m) => m.id === state.primary);
    if (primary && isRac(primary) && view.primaryAlive) {
      const running = liveInstances(doc, state.net, primary).map((i) => i.name);
      const down = primary.instances.map((i) => i.name).filter((n) => !running.includes(n));
      if (down.length > 0) {
        decide(at, 'RAC.PRIMARY_DEGRADED', true,
          primaryDegradedClaim(primary.id, down, running),
          { kind: 'member', id: primary.id as string });
      }
    }

    /* Moving apply by hand. The command also rewrites PreferredApplyInstance
       on a real broker; the drawing's document is not the broker's, so the
       engine says so rather than editing it. */
    const move = state.pendingApplyMove;
    state.pendingApplyMove = null;
    if (move !== null) {
      const m = doc.members.find((x) => x.id === move.member);
      const subject = { kind: 'member' as const, id: move.member as string };
      const ok = m !== undefined && tracksApply(state, m)
        && liveInstances(doc, state.net, m).some((i) => i.name === move.instance);
      decide(at, 'RAC.SET_APPLY_INSTANCE', ok, setApplyClaim(move.member, move.instance, ok),
        subject, `${move.instance}@${at}`);
      if (ok) {
        state.applyInstance[move.member as string] = move.instance;
        state.applyLostSince[move.member as string] = null;
      } else {
        addFinding({
          id: 'RAC.SET_APPLY_INSTANCE', severity: 'warning', basis: 'documented',
          cite: ['RAC.SET_APPLY_INSTANCE', 'RAC.APPLY_INSTANCE'],
          subject,
          message: `SET STATE='APPLY-ON' WITH APPLY INSTANCE='${move.instance}' on ${move.member as string} changes nothing here: apply runs on a running instance of a RAC standby, and ${move.instance} is not one.`,
        });
      }
    }

    for (const m of doc.members) {
      if (!tracksApply(state, m)) continue;
      const id = m.id as string;
      const holder = state.applyInstance[id] as string;
      const running = liveInstances(doc, state.net, m);
      /* A former primary on its way back as a standby is not applying yet:
         the instance its apply will start on simply follows the running ones. */
      if (m.id === state.formerPrimary) {
        if (running.some((i) => i.name === holder) || running.length === 0) continue;
        const to = nextApplyInstance(m, running);
        if (to === null) continue;
        state.applyInstance[id] = to;
        decide(at, 'RAC.APPLY_AFTER_ROLE_CHANGE', true, roleChangeApplyClaim(m, to),
          { kind: 'member', id }, `${to}@${at}`);
        continue;
      }
      if (running.some((i) => i.name === holder)) {
        state.applyLostSince[id] = null;
        /* Multi-instance Redo Apply: an instance other than the coordinator
           stopping leaves apply running on the rest (a model). */
        if (isMultiInstanceApply(m)) {
          for (const i of m.instances) {
            if (i.name === holder || running.some((r) => r.name === i.name)) continue;
            decide(at, 'RAC.MIRA_PARTICIPANT_LOST', true, participantLostClaim(m, i.name, holder),
              { kind: 'member', id }, i.name);
          }
        }
        continue;
      }
      const since = state.applyLostSince[id] ?? at;
      state.applyLostSince[id] = since;
      /* With nothing running there is nowhere to move apply; the member is
         down, and the move is made when an instance comes back. */
      if (running.length === 0) continue;
      const timeout = applyInstanceTimeout(m);
      const subject = { kind: 'member' as const, id };
      if (since + timeout > at + EPS) {
        decide(since, 'RAC.APPLY_INSTANCE_WAIT', true,
          applyWaitClaim(m, holder, since + timeout), subject, `${holder}@${since}`);
        continue;
      }
      const to = nextApplyInstance(m, running);
      if (to === null) continue;
      decide(at, 'RAC.APPLY_INSTANCE_FAILOVER', true,
        applyFailoverClaim(m, holder, to, timeout), subject, `${holder}>${to}@${at}`);
      state.applyInstance[id] = to;
      state.applyLostSince[id] = null;
    }
  }

  /**
   * A RAC database leaving the primary role: which instance its apply will
   * start on once it runs as a standby. (`updateRac` drops the apply instance
   * of the member taking the role.)
   */
  function rearmApply(member: MemberId, at: Seconds): void {
    const m = doc.members.find((x) => x.id === member);
    if (!m || !isDatabase(m) || !isRac(m)) return;
    const running = liveInstances(doc, state.net, m);
    const to = nextApplyInstance(m, running.length > 0 ? running : m.instances);
    if (to === null) return;
    state.applyInstance[member as string] = to;
    state.applyLostSince[member as string] = null;
    decide(at, 'RAC.APPLY_AFTER_ROLE_CHANGE', true, roleChangeApplyClaim(m, to),
      { kind: 'member', id: member as string });
  }

  function noteMasterChange(view: View, at: Seconds): void {
    /* `prevMaster` is the last observer that held the role, so a master lost
       for a while and then replaced still registers as a nomination. */
    if (view.master !== null && prevMaster !== null && view.master !== prevMaster) {
      state.nominatedAt = at;
      if (state.masterOverride === view.master) {
        decide(at, 'OBS.SET_MASTEROBSERVER', true, model(
          `SET MASTEROBSERVER TO ${view.master as string}: the role moves ${SET_MASTER_SECONDS} s after the command.`,
          `OBS.SET_MASTEROBSERVER_TIMING: "the actual switch does not happen until the next time the primary contacts the target standby, usually within three seconds if fast-start failover is enabled". This page draws it at ${SET_MASTER_SECONDS} s -- the documented "usually", taken as the instant. The documented conditions held at that ping: the target standby is enabled and does not require reinstatement, and no role change, reinstatement or change of fast-start failover target is in progress.`,
          ['OBS.SET_MASTEROBSERVER_CONDITIONS', 'OBS.SET_MASTEROBSERVER']),
        { kind: 'observer', id: view.master as string });
      } else {
        decide(at, 'NOMINATION.NEW_MASTER', true, asString(
          nominationClaim(true, true),
          `${view.master as string} is the master observer now.`),
          { kind: 'observer', id: view.master as string });
      }
    }
    if (view.master !== null) prevMaster = view.master;
  }

  function recordEpochDecisions(view: View, at: Seconds): void {
    if (view.fsfoEnabled && view.master === null) {
      /* "if the primary and target standby databases stay connected but the
         connection to the master observer is lost" -- a dead primary, or one
         cut off from every target, is outside the documented case. */
      const precondition = view.primaryAlive && view.anyTargetSeesPrimary;
      const backups = doc.observers.filter((o) => state.observers[o.id as string]?.running);
      if (view.primaryAlive) {
        decide(at, 'OBS.MASTER_LOST', true, asString(
          documented(true, ['FSFO.PRIMARY_UNOBSERVED', 'ORA.16820', 'OBS.CANNOT_OCCUR_LIST'],
            'Fast-start failover cannot occur if the master observer is not running. The target standby reads FS_FAILOVER_STATUS = PRIMARY UNOBSERVED and ORA-16820 is the standing health condition; the primary still reports SYNCHRONIZED with FS_FAILOVER_OBSERVER_PRESENT = NO.'),
          'The configuration is unobserved: no master observer is running.'));
      }
      const attempted = precondition && backups.length > 0;
      decide(at, 'NOMINATION.PRECONDITION', attempted, asString(
        nominationClaim(precondition, attempted),
        precondition
          ? (backups.length > 0
            ? 'The primary and the target standby stay connected but the connection to the master observer is lost, so the broker tries to nominate a backup observer as the new master observer.'
            : 'The precondition holds, but no backup observer is registered to nominate.')
          : 'The primary and the target standby are not both connected, so the documented nomination case does not apply: no backup observer becomes master, and the configuration stays unobserved.'));
      if (!attempted) {
        addFinding({
          id: 'OBS.UNOBSERVED', severity: 'warning', basis: 'documented',
          cite: ['FSFO.PRIMARY_UNOBSERVED', 'ORA.16820'],
          subject: { kind: 'config' },
          message: 'Fast-start failover is enabled with no master observer running: the configuration is unobserved -- PRIMARY UNOBSERVED on the target standby, ORA-16820 as the standing health condition -- and no failover can be initiated.',
        });
      }
    }

    if (state.fsfoState === 'observe-only') {
      decide(at, 'FSFO.OBSERVE_ONLY', false, asString(
        documented(false, ['OBS.OBSERVE_ONLY'],
          'In observe-only mode the observer watches and reports but never fails over: "Unable to failover since this observer is in observe-only mode". The primary may open without acknowledgement from the target, and a switchover, or a failover to a bystander, is still allowed.'),
        'Fast-start failover is enabled OBSERVE ONLY, so nothing is ever initiated.'));
      /* What the documentation says about observe-only is the refusal itself,
         that the primary may open without acknowledgement, and that a
         switchover or a failover to a bystander stays allowed. What the rest
         of the machinery does in this mode it does not say, so the engine's
         reading is labelled where it is made rather than left to look
         documented. */
      decide(at, 'FSFO.OBSERVE_ONLY_SCOPE', true, model<string>(
        'Observe-only is drawn as fast-start failover that arms nothing at all.',
        "MODEL.OBSERVE_ONLY_SCOPE: the documented half is the refusal -- \"Unable to failover since this observer is in observe-only mode\" -- that the primary may open without acknowledgement from the target, and that a switchover, or a failover to a bystander, stays allowed. What the rest of the fast-start failover machinery does in this mode is not documented, so this engine draws the whole of it as unarmed: no primary stall and no FastStartFailoverPmyShutdown abort, no readiness gate standing between a role change and its target, and no SWITCHOVER refused on fast-start failover's behalf. Each of those is a fast-start failover mechanism, and observe-only initiates no fast-start failover.",
        ['OBS.OBSERVE_ONLY', 'FSFO.PMY_SHUTDOWN', 'SWITCHOVER.FSFO_GATE']));
    }

    /* Recorded where the stretch begins, not once per epoch of it. */
    const running = state.phase === 'normal'
      ? view.actors[state.primary as string]?.running ?? null : null;
    if (running !== null && running !== lastNoStall) {
      decideAt(at, 'PRIMARY.NO_STALL', false, noStallClaim(running, lagGated(doc)),
        { kind: 'member', id: state.primary as string });
    }
    lastNoStall = running;

    /* SIM-03: a former primary that is up after a failover is mounted and
       needs reinstating; it is never open beside the new primary -- except a
       manual failover's old primary that was still open and has not been down
       since, which stays open with fast-start failover disabled, and is
       stalled, then aborted or stalled for good, with it enabled (D5). */
    if (state.phase === 'failed-over' && state.formerPrimary !== null) {
      const fp = doc.members.find((m) => m.id === state.formerPrimary);
      const stalledFormer = view.actors[state.formerPrimary as string]?.stalled ?? false;
      const up = !!fp && memberAlive(doc, state.net, fp)
        && !state.abortedMembers.includes(fp.id) && !stalledFormer;
      if (fp && up && state.reinstating !== fp.id) {
        addFinding(formerPrimaryFinding(doc, view, fp, state.formerOpen,
          memberStateOf(doc, state, view, fp, at) === 'open-rw', state.primary,
          !state.everDown.includes(fp.id)));
      }
      if (fp && stalledFormer && state.formerLostTarget) {
        const stalls = formerPrimaryStalls(doc, fp, state.primary);
        addFinding(stalls.finding);
        decide(at, 'FAILOVER.FORMER_PRIMARY_STALLS', true, stalls.claim,
          { kind: 'member', id: fp.id as string });
      }
    }

    /* SIM-10: what would need a second role change is where the run ends. */
    if ((state.phase === 'failed-over' || state.phase === 'switched') && state.newPrimary !== null) {
      const lostToObserver = view.fsfoEnabled && view.master !== null && !view.obsSeesPrimary;
      if (!view.primaryAlive || lostToObserver) {
        oneRoleChange(at,
          `The new primary ${state.newPrimary as string} ${view.primaryAlive ? 'is out of the observer\'s reach' : 'is down'} at ${at} s.`,
          { kind: 'member', id: state.newPrimary as string });
      }
      /* D6: the new primary has no synchronized fast-start failover target
         yet, so losing the observer (and the standbys) stalls nothing. Said
         once, where it first matters. */
      if (view.fsfoEnabled && view.primaryAlive && !view.obsSeesPrimary) {
        decide(at, 'FSFO.NO_TARGET_AFTER_ROLE_CHANGE', false, noTargetAfterRoleChangeClaim(
          state.newPrimary as string, state.phase === 'switched'),
          { kind: 'member', id: state.newPrimary as string });
      }
    }

    if (view.stalled) {
      decide(at, 'PRIMARY.STALL', true, asString(stallClaim(true),
        'The primary has lost the target standby and reaches neither it nor the observer, so nobody can confirm the change of state: it is STALLED. Losing the observer alone would stall nothing.'));
      if (!doc.config.fsfo.pmyShutdown) {
        decide(at, 'PRIMARY.ABORT', false, asString(
          documented(false, ['FSFO.PMY_SHUTDOWN'],
            'FastStartFailoverPmyShutdown is FALSE, so the stalled primary stays STALLED until an operator intervenes.'),
          'FastStartFailoverPmyShutdown is FALSE: nothing aborts the primary.'));
      }
    }

    if (state.ackLostSince !== null && modeNow(doc, state) !== 'MAXPERFORMANCE') {
      const until = state.ackLostSince + netTimeoutForMode(doc, view.graph);
      decide(at, 'PROT.COMMIT_HANG', true, asString(commitHangClaim(until, view.stalled),
        view.stalled
          ? 'The commit hang spans the whole stall: the fast-start failover stall overrides NET_TIMEOUT\'s drop-and-continue behaviour.'
          : `Commits wait for the synchronous acknowledgement until NET_TIMEOUT expires at ${until} s, and the primary then drops the destination and carries on.`));
    }

    if (modeNow(doc, state) === 'MAXAVAILABILITY') {
      const degraded = maxAvailDegraded(view.syncAcks.length);
      if (degraded.value) {
        decide(at, 'PROT.MAXAVAIL_DEGRADED', true, asString(degraded,
          'Without an acknowledgement from at least one synchronized standby, maximum availability operates as if it were in maximum performance mode. The primary keeps running.'));
      }
    }
  }

  function scheduleDerived(view: View, at: Seconds): void {
    /* The failover clock. It runs for the current target only, and not at
       all while the configuration is unobserved. */
    if (state.phase === 'normal' && view.armed && !state.unobserved
      && state.obsLostPrimarySince !== null) {
      const delay = initiateDelayClaim(doc, ping).value;
      const clock = (id: MemberId): Seconds | null => {
        const lost = state.targetLostPrimarySince[id as string];
        if (lost === null || lost === undefined) return null;
        if (!(view.targetAlive[id as string] ?? false)) return null;
        if (!(view.obsSeesTarget[id as string] ?? false)) return null;
        return Math.max(state.obsLostPrimarySince as Seconds, lost) + delay;
      };
      const active = state.activeTarget;
      const when = active === null ? null : clock(active);
      if (when !== null) {
        if (when <= at + EPS) initiate(view, at);
        else q.push({ kind: 'fsfo.initiate', at: when }, 'fsfo.initiate', true);
      } else if (active !== null && (!view.primaryAlive || view.stalled)
        && state.noTargetAt === null) {
        /* The target is gone and so is the primary: another candidate may be
           standing there ready, and the broker still cannot fail over to it,
           because the target changes only while the primary is there to
           change it. */
        let other: MemberId | null = null;
        let otherAt: Seconds | null = null;
        for (const id of view.candidates) {
          if (id === active) continue;
          const c = clock(id);
          if (c !== null && (otherAt === null || c < otherAt)) { other = id; otherAt = c; }
        }
        if (other !== null && otherAt !== null) {
          if (otherAt <= at + EPS) {
            state.noTargetAt = at;
            const refusal = noSecondTarget(doc, active, other);
            addFinding(refusal.finding);
            decide(at, 'FSFO.NO_SECOND_TARGET', false, refusal.claim,
              { kind: 'member', id: other as string });
          } else {
            q.push({ kind: 'fsfo.initiate', at: otherAt }, 'fsfo.no-second-target', true);
          }
        }
      }
    }

    /* Where readiness changes next: the instant the primary drops a member it
       has stopped reaching, and -- where the lag limit is the gate -- the
       instant the growing lag reaches the limit. */
    if (state.phase === 'normal' && view.primaryAlive) {
      for (const m of doc.members) {
        if (m.id === state.primary || !isDatabase(m)) continue;
        /* Only a candidate's state is drawn, so only a candidate gets an epoch. */
        if (!view.candidates.includes(m.id)) continue;
        const key = m.id as string;
        const subject = { kind: 'member' as const, id: key };
        const cut = state.cutOffSince[key];
        if (cut === null || cut === undefined) continue;
        if (!(state.fsfoReady[key] ?? false)) continue;
        const drop = cut + dropDelay(key, view);
        if (drop > at + EPS) q.push({ kind: 'fsfo.readiness', at: drop, subject }, 'fsfo.readiness', true);
        const since = state.unsentSince[key];
        if (lagGated(doc) && since !== null && since !== undefined) {
          const room = lagLimitOf(doc) - gateLagSeconds(doc, m, state)
            - (state.unsentAccum[key] ?? 0);
          const cross = since + Math.max(0, room);
          if (cross > at + EPS) q.push({ kind: 'fsfo.readiness', at: cross, subject }, 'fsfo.readiness', true);
        }
      }
    }

    /* Every acting primary's own stall clock, which always runs on the
       threshold even where the ping properties replaced it for the observer. */
    if (doc.config.fsfo.pmyShutdown) {
      for (const [id, since] of Object.entries(state.stallSince)) {
        if (since === null || since === undefined) continue;
        const member = id as MemberId;
        if (state.abortedMembers.includes(member)) continue;
        const abortAt = since + doc.config.fsfo.thresholdSeconds;
        if (abortAt <= at + EPS) {
          abort(member, at, 'stall', asString(abortClaim(at, doc.config.fsfo.thresholdSeconds)));
        } else {
          q.push(
            { kind: 'primary.abort', at: abortAt, subject: { kind: 'member', id } },
            'abort.stall', true, member,
          );
        }
      }
    }

    /* Maximum protection with no synchronous acknowledgement from a database. */
    if (modeNow(doc, state) === 'MAXPROTECTION' && state.ackLostSince !== null
      && view.syncAckDbs.length === 0 && !state.abortedMembers.includes(state.primary)) {
      const shutdown = maxProtectionShutdown(state.ackLostSince, netTimeoutForMode(doc, view.graph));
      if (shutdown.value <= at + EPS) {
        abort(state.primary, at, 'maxprotection', asString(shutdown));
      } else {
        q.push(
          { kind: 'primary.abort', at: shutdown.value, subject: { kind: 'member', id: state.primary as string } },
          'abort.maxprotection', true, state.primary,
        );
      }
    }

    /* The next attempt to reestablish a failed destination. Only a destination
       with a non-zero MaxFailure gets one: with MaxFailure at its default of 0
       the retries are unlimited and none of them changes anything the trace
       draws, so drawing an epoch per REOPEN interval would be noise. */
    for (const d of authoredDests(doc, state.primary)) {
      if (state.disabledDests.includes(d.key)) continue;
      if (d.retryLimit === null) continue;
      const since = state.destDownSince[d.key];
      if (since === null || since === undefined) continue;
      const failures = state.destFailures[d.key] ?? 0;
      if (failures >= d.retryLimit) continue;
      const next = since + (failures + 1) * Math.max(1, d.props.reopenSeconds || 0);
      if (next <= at + EPS) continue;
      q.push(
        { kind: 'dest.reopen', at: next, subject: { kind: 'member', id: d.to as string } },
        'dest.reopen', true,
      );
    }

    /* ApplyInstanceTimeout: the instant a RAC standby's apply moves. */
    for (const m of doc.members) {
      if (!tracksApply(state, m)) continue;
      const since = state.applyLostSince[m.id as string];
      if (since === null || since === undefined) continue;
      if (liveInstances(doc, state.net, m).length === 0) continue;
      const due = since + applyInstanceTimeout(m);
      if (due <= at + EPS) continue;
      q.push(
        { kind: 'apply.failover', at: due, subject: { kind: 'member', id: m.id as string } },
        'apply.failover', true, m.id,
      );
    }

    /* NET_TIMEOUT bounds the commit hang, and is never a failover clock. In a
       full fast-start failover stall the stall overrides it. */
    if (state.ackLostSince !== null && !view.stalled
      && modeNow(doc, state) === 'MAXAVAILABILITY') {
      const until = state.ackLostSince + netTimeoutForMode(doc, view.graph);
      if (until > at + EPS) q.push({ kind: 'net.timeout', at: until }, 'net.timeout', true);
    }
  }

  function sampleOf(d: TopologyDoc, s: SimState, view: View, at: Seconds): Sample {
    const members: Record<string, MemberState | FarSyncState> = {};
    const observers: Record<string, ObserverState> = {};
    const links: Record<string, 'up' | 'down'> = {};
    const open: string[] = [];
    const applyInstances: Record<string, string> = {};
    for (const m of d.members) {
      const st = memberStateOf(d, s, view, m, at);
      members[m.id as string] = st;
      const restarting = s.phase === 'switched' && s.formerPrimary === m.id;
      if (s.reinstating === m.id || restarting) open.push(m.id as string);
      const holder = s.applyInstance[m.id as string];
      if (holder !== undefined && tracksApply(s, m)) {
        /* Applying: the instance doing it, never one that has failed and is
           being waited out. A former primary restarting or being reinstated
           as a standby carries the instance its apply will start on. */
        const lost = s.applyLostSince[m.id as string];
        const applying = (st === 'mounted-apply' || st === 'open-ro') && (lost === null || lost === undefined);
        const returning = s.formerPrimary === m.id && (st === 'mounted-noapply' || st === 'reinstating');
        if (applying || returning) applyInstances[m.id as string] = holder;
      }
    }
    for (const o of d.observers) observers[o.id as string] = observerStateOf(d, s, view, o.id);
    for (const l of d.links) {
      const bothEndsUp = l.scope === 'host'
        ? (l.ends as [HostId, HostId]).every((h) => hostUp(d, s.net, h))
        : (l.ends as [SiteId, SiteId]).every((x) => !s.net.downSites.has(x));
      links[l.id as string] = s.net.downLinks.has(l.id) || !bothEndsUp ? 'down' : 'up';
    }
    return Object.keys(applyInstances).length > 0
      ? { t: at, members, applyInstances, observers, links, open }
      : { t: at, members, observers, links, open };
  }
}

/**
 * The former primary is running after a failover.
 *
 * `stayed`: a manual failover found it open, with fast-start failover
 * disabled, and nothing has taken it down since, so it is still open beside
 * the new primary. Oracle puts the shutdown on the operator
 * (FAILOVER.PRIMARY_SHUT_DOWN, FSFO.MANUAL_FAILOVER_CONDITIONS) and no page
 * says the broker closes or mounts a primary that stayed open, so drawing it
 * open is this page's reading of a gap. (With fast-start failover enabled it
 * is drawn stalled instead: `formerPrimaryStalls`.)
 *
 * Otherwise it restarted, or a fast-start failover left it behind. With
 * fast-start failover enabled the documentation is explicit (ORA-16649) for a
 * database that is *restarted*; one that was stalled and was never restarted
 * but reached again (`neverRestarted`) is drawn the same way as this page's
 * model (SIM-20). With fast-start failover disabled the broker still leaves
 * the database needing reinstatement; under 26ai Scenario 11 spells the
 * mounted state out for a restarted database (D7), under 19c drawing it
 * mounted rather than open is this page's reading -- unless it cannot reach
 * the new primary, where nothing tells it and it comes back open
 * (`drawnOpen`, a model under both editions).
 */
function formerPrimaryFinding(
  doc: TopologyDoc, view: View, fp: Member, stayed: boolean, drawnOpen: boolean,
  newPrimary: MemberId, neverRestarted: boolean,
): Finding {
  const subject = { kind: 'member' as const, id: fp.id as string };
  if (stayed) {
    return {
      id: 'FAILOVER.FORMER_PRIMARY_OPEN', severity: 'warning', basis: 'model',
      cite: ['FAILOVER.PRIMARY_SHUT_DOWN', 'FSFO.MANUAL_FAILOVER_CONDITIONS'], subject,
      message: `${fp.name} was still running and open when the manual failover completed, and it is drawn still open read-write as a primary beside ${newPrimary as string}. Two databases are open as the primary until ${fp.name} is taken down.`,
      note: 'FAILOVER.FORMER_PRIMARY_OPEN: Oracle puts the shutdown of the old primary on the operator -- "ensure that the primary database is shut down" before a failover, "shut down prior to performing a manual failover" with fast-start failover enabled -- and no page says the broker closes or mounts a primary that is still open when a manual failover completes with fast-start failover disabled. ORA-16649 is about a former primary that restarts and is not allowed to open, not one that stayed open. So this page draws it open, whether or not the new primary can reach it, until a crash, a shutdown or the end of the run takes it down. With fast-start failover enabled the old primary has lost its target and is drawn stalled instead (FAILOVER.FORMER_PRIMARY_STALLS). That is this page\'s reading of an undocumented case.',
    };
  }
  if (view.fsfoEnabled) {
    if (neverRestarted) {
      return {
        id: 'FSFO.FORMER_PRIMARY_NOT_OPEN', severity: 'warning', basis: 'model',
        cite: ['FSFO.FORMER_PRIMARY_NOT_OPEN', 'ORA.16649', 'REINSTATE.NEEDS_FLASHBACK'], subject,
        message: `${fp.name} is the former primary and it is reachable again after it stalled: it is drawn started and mounted, requiring reinstatement (REINSTATE REQUIRED), and it will not be allowed to open while fast-start failover is enabled -- ORA-16649 -- and it receives no redo until it has been reinstated.`,
        ora: 'ORA-16649',
        note: 'FSFO.FORMER_PRIMARY_NOT_OPEN: Oracle documents the started-and-mounted state for a former primary that is restarted -- "the database must be started and mounted. It will not be allowed to open in any event if fast-start failover is enabled." This one was never restarted: it stalled with its database open and was reached again. No page says a stalled, still-open primary is closed when contact returns, so this page draws it mounted as its model of that case.',
      };
    }
    return {
      id: 'FSFO.FORMER_PRIMARY_NOT_OPEN', severity: 'warning', basis: 'documented',
      cite: ['FSFO.FORMER_PRIMARY_NOT_OPEN', 'ORA.16649', 'REINSTATE.NEEDS_FLASHBACK'], subject,
      message: `${fp.name} is the former primary and it is running again: it is started and mounted and requires reinstatement (REINSTATE REQUIRED). It will not be allowed to open in any event while fast-start failover is enabled -- ORA-16649 -- and it receives no redo until it has been reinstated.`,
      ora: 'ORA-16649',
    };
  }
  const message = drawnOpen
    ? `${fp.name} is the former primary and it is running again where the new primary cannot reach it, so nothing tells it a failover happened and it is drawn open, not mounted.`
    : `${fp.name} is the former primary and it is running again. After a failover it has to be reinstated or re-created before it can serve as a standby, so it is drawn mounted, not open.`;
  if (doc.config.edition === '26ai' && !drawnOpen) {
    return {
      id: 'FAILOVER.FORMER_PRIMARY_MOUNTED', severity: 'warning', basis: 'documented',
      cite: ['FAILOVER.FORMER_PRIMARY_MOUNTED_26AI', 'REINSTATE.NEEDS_FLASHBACK', 'ORA.16661'], subject,
      message,
      note: 'Scenario 11 of the 26ai broker guide restarts the old primary with fast-start failover disabled and shows ORA-16649: "Because a role transition occurred while the old primary was offline, Data Guard prevents the database from reopening and leaves it in a mounted state to ensure there is only one database open in the primary role." The 19c and 21c Scenario 11 pages say none of this.',
    };
  }
  return {
    id: 'FAILOVER.FORMER_PRIMARY_MOUNTED', severity: 'warning', basis: 'model',
    cite: ['REINSTATE.NEEDS_FLASHBACK', 'ORA.16661'], subject,
    message,
    note: 'FAILOVER.FORMER_PRIMARY_MOUNTED: that the former primary needs reinstating after a failover is documented. What state the broker leaves one that restarts in, with fast-start failover disabled, is not spelled out in 19c the way ORA-16649 spells it out for fast-start failover (the 26ai Scenario 11 page does spell it out: FAILOVER.FORMER_PRIMARY_MOUNTED_26AI), so drawing it mounted is this page\'s reading. It applies to a former primary that went down and came back, never to one a manual failover found still open (FAILOVER.FORMER_PRIMARY_OPEN). Where the new primary cannot reach it, nothing tells it a failover happened and it is drawn open under both editions: how a database learns of a role change it cannot see is not documented.',
  };
}

/**
 * D5: a manual failover with fast-start failover ENABLED, the old primary
 * still running. Its target has just become the primary, so it is stalled from
 * the completion instant, then follows FastStartFailoverPmyShutdown. No page
 * says what such an old primary does, so the stall is this page's model.
 */
function formerPrimaryStalls(
  doc: TopologyDoc, fp: Member, newPrimary: MemberId,
): { finding: Finding; claim: Claim<string> } {
  const subject = { kind: 'member' as const, id: fp.id as string };
  const threshold = doc.config.fsfo.thresholdSeconds;
  const then = doc.config.fsfo.pmyShutdown
    ? `With FastStartFailoverPmyShutdown TRUE it shuts itself down ${threshold} s later (FastStartFailoverThreshold).`
    : 'With FastStartFailoverPmyShutdown FALSE it stays stalled until an operator intervenes.';
  const message = `${fp.name} was still running when the manual failover completed and fast-start failover is enabled: the target it was running with is now the primary ${newPrimary as string}, so ${fp.name} has lost its target and is drawn STALLED from that instant. ${then}`;
  const note = 'FAILOVER.FORMER_PRIMARY_STALLS: nothing documented says what an old primary that is still running does when a manual failover completes with fast-start failover enabled -- Oracle only says to shut it down first ("You must ensure that the primary database is shut down prior to performing a manual failover."). The sentences around it lean one way: "Data Guard fast-start failover always guarantees that only one primary database exists"; the STALLED state is "after loss of connectivity to the target standby database ... cannot be confirmed by either the target standby database or the observer", and "It shuts down or stalls because it is likely a failover has occurred." Once its target has converted, the old primary has no target to confirm anything, which is what STALLED describes; the shutdown that follows is the documented FastStartFailoverPmyShutdown one. Applying all of that to a manual failover is this page\'s model, not a documented outcome. With fast-start failover disabled nothing stalls it and it stays open (FAILOVER.FORMER_PRIMARY_OPEN).';
  const cite: CitationId[] = [
    'FSFO.ONE_PRIMARY_GUARANTEE', 'FSFO.STATUS_STALLED', 'FSFO.STALLED_LIKELY_FAILOVER',
    'FSFO.PMY_SHUTDOWN', 'FSFO.MANUAL_FAILOVER_CONDITIONS',
  ];
  return {
    finding: {
      id: 'FAILOVER.FORMER_PRIMARY_STALLS', severity: 'warning', basis: 'model', cite, subject, message, note,
    },
    claim: model(message, note, cite),
  };
}

/**
 * D6: after a role change the new primary has no synchronized fast-start
 * failover target. An inference from two documented sentences, so `inferred`.
 */
function noTargetAfterRoleChangeClaim(newPrimary: string, switched: boolean): Claim<string> {
  const how = switched
    ? 'the former primary restarts as the new standby'
    : 'the former primary is reinstated';
  return inferred(
    `${newPrimary} has no synchronized fast-start failover target yet: ${how} first, and only then does it act as the target. So fast-start failover is not possible, and the new primary keeps processing transactions without the observer (and without its standbys).`,
    ['FSFO.REINSTATED_IS_TARGET', 'FSFO.UNOBSERVED_CONTINUES'],
    'FSFO.NO_TARGET_AFTER_ROLE_CHANGE: "The reinstated database acts as the fast-start failover target for the new primary database, making a subsequent fast-start failover possible." -- so until the former primary is back there is no target, and "While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails." Joining the two is an inference: no page says in as many words that a new primary without a target never stalls. This page simulates one role change per run and draws the former primary\'s return as an open-ended band, so no target exists for the rest of the run.');
}

/**
 * SET MASTEROBSERVER TO takes effect at the next contact between the primary
 * and the target standby, "usually within three seconds". Three is the
 * documented figure; taking it as the instant is this page's model.
 */
const SET_MASTER_SECONDS: Seconds = 3;

/** The protection mode in force: the configured one, or what a failover left. */
function modeNow(doc: TopologyDoc, state: SimState): ProtectionMode {
  return state.modeAfterRoleChange !== null
    && (state.phase === 'failed-over') ? state.modeAfterRoleChange : doc.config.protectionMode;
}

/**
 * The document the redo graph is resolved from. Two things a run changes that
 * the authored document cannot know: a member a role change left disabled
 * ships and receives nothing until it is reinstated -- the former primary
 * after a failover above all, so the new primary is never drawn as
 * acknowledged by a database that needs reinstating -- and the protection
 * mode a failover out of maximum protection leaves behind.
 */
function graphDoc(doc: TopologyDoc, state: SimState): TopologyDoc {
  const out = new Set<string>(state.disabledMembers as string[]);
  if (state.phase === 'failed-over' && state.formerPrimary !== null) {
    out.add(state.formerPrimary as string);
  }
  const mode = modeNow(doc, state);
  if (out.size === 0 && mode === doc.config.protectionMode) return doc;
  return {
    ...doc,
    config: mode === doc.config.protectionMode ? doc.config : { ...doc.config, protectionMode: mode },
    members: doc.members.map((m) => (out.has(m.id as string) ? { ...m, enabled: false } : m)),
  };
}

/** How a member is fed in the configuration as declared, with nothing failed. */
function feedOf(doc: TopologyDoc, declared: RedoGraph, id: MemberId): Feed {
  const path = declared.members[id]?.feedPath ?? [];
  const first = path.length >= 2 ? path[1] : undefined;
  const hop = first === undefined ? undefined
    : declared.edges.find((e) => e.from === declared.primary && e.to === first && e.active);
  const between = path.slice(1, -1);
  const kindOf = (x: MemberId): Member | undefined => doc.members.find((m) => m.id === x);
  return {
    firstHop: first ?? null,
    sync: !!hop && (hop.xpt === 'SYNC' || hop.xpt === 'FASTSYNC'),
    netTimeout: first === undefined ? 0 : netTimeoutOf(doc, declared.primary, first),
    farSyncs: between.filter((x) => { const m = kindOf(x); return !!m && isFarSync(m); }),
    cascaders: between.filter((x) => { const m = kindOf(x); return !!m && isDatabase(m); }),
  };
}

/**
 * What a member that redo is reaching is worth to fast-start failover: inside
 * the lag limit where the limit is the gate, synchronized everywhere else.
 */
function worthOf(
  doc: TopologyDoc, state: SimState, m: Member, r: RedoGraph['members'][MemberId],
): boolean {
  if (lagGated(doc)) {
    return !isDatabase(m) || gateLagSeconds(doc, m, state) <= lagLimitOf(doc);
  }
  return r.synchronized.value;
}

/**
 * Does this member hold all of the primary's redo as far as the TRANSPORT is
 * concerned -- fed over a live SYNC or FASTSYNC edge straight from the
 * primary, or across a far sync instance whose own leg from the primary is
 * synchronous and which reaches the member? A far sync hop is not a cascade.
 */
function transportSynchronized(doc: TopologyDoc, view: View, to: MemberId): boolean {
  const live = (from: MemberId, dest: MemberId): RedoGraph['edges'][number] | undefined =>
    view.graph.edges.find((e) => e.from === from && e.to === dest && e.active && e.up);
  const isSync = (e: RedoGraph['edges'][number] | undefined): boolean =>
    !!e && (e.xpt === 'SYNC' || e.xpt === 'FASTSYNC');
  if (isSync(live(view.graph.primary, to))) return true;
  const path = view.graph.members[to]?.feedPath ?? [];
  if (path.length < 3) return false;
  const between = path.slice(1, -1);
  const allFarSync = between.every((x) => {
    const m = doc.members.find((y) => y.id === x);
    return !!m && isFarSync(m);
  });
  if (!allFarSync) return false;
  if (!isSync(live(path[0] as MemberId, path[1] as MemberId))) return false;
  return path.slice(1).every((dest, i) => !!live(path[i] as MemberId, dest));
}

/* ---------------- events ---------------- */

function applyEvent(doc: TopologyDoc, state: SimState, e: TimedEvent): void {
  switch (e.kind) {
    case 'host.down': case 'host.up': case 'site.down': case 'site.up':
    case 'link.cut': case 'link.heal': case 'partition':
    case 'member.down': case 'member.up':
      state.net = applyNetEvent(state.net, e);
      break;
    /* An instance stops on a host that stays up: the listener, an observer or
       another member's instance beside it keep running. */
    case 'instance.down': case 'instance.up': {
      const m = doc.members.find((x) => x.id === e.member);
      if (m?.instances.some((i) => i.name === e.instance)) state.net = applyNetEvent(state.net, e);
      break;
    }
    case 'observer.stop': {
      const o = state.observers[e.observer as string];
      if (o) o.running = false;
      break;
    }
    case 'observer.start': {
      const o = state.observers[e.observer as string];
      if (o) o.running = true;
      break;
    }
    /* Commands wait one step: each is answered against the epoch's facts. */
    case 'cmd.setMasterObserver': state.pendingMasterObserver = e.observer; break;
    case 'cmd.setApplyInstance': state.pendingApplyMove = { member: e.member, instance: e.instance }; break;
    case 'cmd.disableFsfo': state.fsfoState = 'disabled'; break;
    case 'cmd.switchover': state.pendingSwitchover = e.to; break;
    case 'cmd.failover':
      state.pendingFailover = { to: e.to, immediate: e.immediate === true };
      break;
    case 'cmd.reinstate': state.pendingReinstate = e.member; break;
    case 'lag.set':
      if (e.applyLag !== undefined) state.applyLag[e.member as string] = e.applyLag;
      if (e.transportLag !== undefined) state.transportLag[e.member as string] = e.transportLag;
      break;
    default:
      break;
  }
}

/* ---------------- the view ---------------- */

/**
 * Which observer coordinates. The role is sticky: the master keeps it while
 * it is running and the primary reaches it. When the connection to it is lost
 * -- the observer stopped, its host down, or the network between the primary
 * and a master that is alive and well -- a backup is nominated only under the
 * documented precondition: "if the primary and target standby databases stay
 * connected but the connection to the master observer is lost, then the
 * broker tries to nominate a backup observer as the new master observer".
 * Otherwise the configuration stays unobserved. The rule is never extended to
 * a failure that separates the primary from the target standby, or takes the
 * primary down. SET MASTEROBSERVER TO is the manual override; a master that
 * comes back keeps the role.
 *
 * `primaryReaches` is asked only where `precondition` holds, which is where
 * the primary is alive.
 */
function electMaster(
  doc: TopologyDoc, state: SimState, hostAlive: (h: HostId) => boolean, precondition: boolean,
  primaryReaches: (h: HostId) => boolean,
): ObserverId | null {
  const hostOf = (id: ObserverId | null): HostId | null =>
    (id === null ? null : doc.observers.find((x) => x.id === id)?.host ?? null);
  const eligible = (id: ObserverId | null): boolean => {
    if (id === null) return false;
    const o = doc.observers.find((x) => x.id === id);
    const s = state.observers[id as string];
    return !!o && !!s && s.running && hostAlive(o.host) && preferredRankOf(doc, o.host) !== null;
  };
  /* The connection the nomination rule is about: lost only where the primary
     is there, still has its target, and cannot reach the observer. */
  const connected = (id: ObserverId | null): boolean => {
    const h = hostOf(id);
    return h !== null && (!precondition || primaryReaches(h));
  };
  /* `state.master` remembers the last holder of the role even while it is
     unreachable, so a master that comes back resumes without a nomination. */
  if (state.masterOverride !== null && eligible(state.masterOverride)
    && connected(state.masterOverride)) {
    state.master = state.masterOverride;
    return state.master;
  }
  if (eligible(state.master) && connected(state.master)) return state.master;
  const opening = state.master === null;
  if (!opening && !precondition) return eligible(state.master) ? state.master : null;
  /* The opening election takes the declared master or the best-ranked
     observer; a later one is the documented nomination attempt, and it can
     only land on an observer the primary reaches. */
  const next = pickMaster(doc, state, (h) => hostAlive(h) && (opening || primaryReaches(h)));
  if (next !== null) {
    if (state.masterOverride !== null && next !== state.masterOverride) state.masterOverride = null;
    state.master = next;
    return next;
  }
  /* Nobody to nominate. A master that is running but out of the primary's
     reach keeps the role: the configuration is unobserved, not leaderless. */
  return eligible(state.master) ? state.master : null;
}

const preferredRankOf = (doc: TopologyDoc, host: HostId): number | null => preferredRank(doc, host);

function computeView(doc: TopologyDoc, state: SimState, opts: ViewOpts): View {
  const net = state.net;
  const reach = buildReachability(doc, net);
  /* The two latches the loop carries between epochs: a destination disabled at
     MaxFailure stays disabled until it is manually reenabled, and an alternate
     declared without FALLBACK stays in service once it has taken over. */
  const graph = resolveRedoGraph(graphDoc(doc, state), {
    primary: state.primary,
    net,
    disabledDests: new Set(state.disabledDests),
    altLatched: new Set(state.altLatched),
    groupChoice: state.groupChoice,
  });
  const primary = doc.members.find((m) => m.id === state.primary) as Member;
  const alive = (m: Member): boolean =>
    memberAlive(doc, net, m) && !state.abortedMembers.includes(m.id);
  const primaryAlive = !!primary && alive(primary);

  /* Enabled is what the configuration says, whether or not an observer was
     ever started: "If you do not start the observer after you have enabled
     fast-start failover, the ORA-16819 warning is displayed". That state is
     enabled and unobserved. DISABLED is fast-start failover disabled. */
  const fsfoEnabled = state.fsfoState === 'enabled';

  const candidates = candidateTargets(doc).filter((id) => id !== state.primary);
  const targetSeesPrimary: Record<string, boolean> = {};
  const targetAlive: Record<string, boolean> = {};
  for (const id of candidates) {
    const m = doc.members.find((x) => x.id === id);
    if (!m) continue;
    const up = alive(m) && !state.disabledMembers.includes(id);
    targetAlive[id as string] = up;
    /* The health-check connection between the primary and the standby, which a
       far sync edge never replaces: "there must still be a direct network
       connection between the primary database and the remote standby database
       ... used to perform health checks and switchover processing tasks." */
    targetSeesPrimary[id as string] = up && primaryAlive
      && membersReachable(doc, net, primary, m, reach);
  }
  const anyTargetSeesPrimary = candidates.some((id) => targetSeesPrimary[id as string] === true);

  const master = electMaster(
    doc, state, (h) => hostUp(doc, net, h), primaryAlive && anyTargetSeesPrimary,
    (h) => primaryAlive && memberReachableFromHost(doc, net, primary, h, reach),
  );
  const masterObserver = master ? doc.observers.find((o) => o.id === master) : undefined;
  const masterHost = masterObserver ? masterObserver.host : null;

  const obsSeesPrimary = !!masterHost && primaryAlive
    && memberReachableFromHost(doc, net, primary, masterHost, reach);

  const obsSeesTarget: Record<string, boolean> = {};
  for (const id of candidates) {
    const m = doc.members.find((x) => x.id === id);
    if (!m) continue;
    obsSeesTarget[id as string] = (targetAlive[id as string] ?? false) && !!masterHost
      && memberReachableFromHost(doc, net, m, masterHost, reach);
  }

  /* Acting primaries: the current one, plus a former primary that is still
     running as a primary after the role change -- stalled somewhere nobody can
     reach, or (D5) stalled because a manual failover took its target. A
     former primary that crashed and restarts, and the former primary of a
     switchover (a standby now), are not acting primaries. */
  const actorIds: MemberId[] = [state.primary];
  if (state.formerActs && state.formerPrimary !== null && state.formerPrimary !== state.primary
    && !state.abortedMembers.includes(state.formerPrimary)) {
    actorIds.push(state.formerPrimary);
  }
  const actors: Record<string, ActorView> = {};
  for (const id of actorIds) {
    const m = doc.members.find((x) => x.id === id);
    if (!m) continue;
    const up = alive(m);
    const seenByObserver = up && !!masterHost
      && memberReachableFromHost(doc, net, m, masterHost, reach);
    /* A former primary's target is the new primary: it is the standby that
       became the primary, so it has dropped out of `candidates`. */
    const seenByNewPrimary = id !== state.primary && primaryAlive
      && membersReachable(doc, net, m, primary, reach);
    const seenByTarget = seenByNewPrimary || candidates.some((c) => {
      if (c === id) return false;
      const cm = doc.members.find((x) => x.id === c);
      return !!cm && (targetAlive[c as string] ?? false)
        && membersReachable(doc, net, m, cm, reach);
    });
    /* It reaches nobody who could confirm a change of state. Whether that
       stalls it depends on whether there is a change to confirm: the recorded
       state has to be one in which fast-start failover is possible --
       observed, and the target ready. A primary that is already stalled stays
       stalled until it reaches somebody, and a former primary is one a
       failover has in fact happened to. After a role change the new primary
       has no synchronized target yet (`activeTarget` is cleared at the role
       change, D6), so `possible` is false and it stalls for nothing. */
    const isolated = fsfoEnabled && up && !seenByObserver && !seenByTarget;
    const already = (state.stallSince[id as string] ?? null) !== null;
    const former = id !== state.primary;
    const active = state.activeTarget;
    const ready = active !== null && (state.fsfoReady[active as string] ?? false);
    const possible = !state.unobserved && ready;
    /* A former primary acts only while it is stalled: cut off, or having lost
       its target (D5) while fast-start failover stays enabled. */
    const stalledNow = former
      ? isolated || (state.formerLostTarget && fsfoEnabled && up)
      : isolated && (already || possible || opts.legacyStall);
    actors[id as string] = {
      alive: up,
      observerSees: seenByObserver,
      anyTargetSees: seenByTarget,
      stalled: stalledNow,
      running: isolated && !stalledNow ? (state.unobserved ? 'unobserved' : 'not-ready') : null,
    };
  }

  const stalled = actors[state.primary as string]?.stalled ?? false;
  const acks = syncAckMembers(graph);
  const ackDbs = syncAckDatabases(doc, graph);
  const syncDeclared = graph.edges.some((e) => e.from === state.primary
    && (e.xpt === 'SYNC' || e.xpt === 'FASTSYNC'));
  const redoFlowing = primaryAlive
    && graph.edges.some((e) => e.from === state.primary && e.active && e.up);
  const standbyGone = candidates.length === 0
    || candidates.every((id) => targetAlive[id as string] !== true);

  return {
    reach, graph, primary, primaryAlive, fsfoEnabled, master, masterHost,
    armed: fsfoEnabled && master !== null,
    obsSeesPrimary, candidates, targetSeesPrimary, obsSeesTarget, targetAlive,
    anyTargetSeesPrimary, actors, stalled, syncAcks: acks, syncAckDbs: ackDbs, syncDeclared,
    conditions: {
      stalled, standbyGone, redoFlowing,
      pmyReachable: primaryReachableFromOutside(doc, net, primary, primaryAlive),
    },
  };
}

/**
 * Does the primary's data centre still have a way out?
 *
 * That is what an isolated primary loses and a partitioned one keeps: a
 * severed link to one peer leaves it serving everyone else, while a primary
 * whose every link is cut is serving a world that cannot reach it. The
 * question is asked of the links rather than of the other members, because the
 * clients are not in the topology -- and where the primary's site has no links
 * at all there is nothing to lose.
 */
function primaryReachableFromOutside(
  doc: TopologyDoc, net: NetState, primary: Member | undefined, alive: boolean,
): boolean {
  if (!primary || !alive) return false;
  const own = doc.hosts.find((h) => h.id === primary.instances[0]?.host)?.site;
  if (own === undefined) return true;
  const ways = doc.links.filter((l) => {
    if (net.downLinks.has(l.id)) return false;
    if (l.scope === 'site') {
      const [a, b] = l.ends as [SiteId, SiteId];
      if (a !== own && b !== own) return false;
      const far = a === own ? b : a;
      return !net.downSites.has(far);
    }
    const [a, b] = l.ends as [HostId, HostId];
    const ha = doc.hosts.find((h) => h.id === a);
    const hb = doc.hosts.find((h) => h.id === b);
    if (!ha || !hb) return false;
    if (ha.site === hb.site) return false;
    const far = ha.site === own ? hb : ha;
    return (ha.site === own || hb.site === own) && hostUp(doc, net, far.id);
  });
  const any = doc.links.some((l) => {
    if (l.scope === 'site') {
      const [a, b] = l.ends as [SiteId, SiteId];
      return a === own || b === own;
    }
    return false;
  });
  return any ? ways.length > 0 : true;
}

/* ---------------- RAC ---------------- */

/**
 * Does the loop track an apply instance for this member right now? A RAC
 * database that is not the primary at this point in the run and has an entry:
 * the declared standbys get one at the start, a former primary when it leaves
 * the role, and the member taking the role loses its own. Keyed on the role in
 * the run, never on the role the document declares.
 */
function tracksApply(state: SimState, m: Member): m is DatabaseMember {
  return isDatabase(m) && isRac(m) && m.id !== state.primary
    && state.applyInstance[m.id as string] !== undefined;
}

/* ---------------- lane states ---------------- */

function memberStateOf(
  doc: TopologyDoc, state: SimState, view: View, m: Member, at: Seconds,
): MemberState | FarSyncState {
  if (state.abortedMembers.includes(m.id)) return 'aborted';
  if (!memberAlive(doc, state.net, m)) return 'down';
  if (state.disabledMembers.includes(m.id)) return 'disabled';

  if (isFarSync(m)) {
    const r = view.graph.members[m.id];
    if (!r || !r.reachableFromPrimary) return 'unreachable';
    const onward = view.graph.edges.filter((e) => e.from === m.id && e.active);
    if (onward.length > 0 && onward.every((e) => !e.up)) return 'forwarding-stalled';
    return 'receiving';
  }

  if (m.id === state.primary) {
    if (state.converting === m.id) return 'converting';
    if (view.stalled) return 'stalled';
    /* A fast-start failover is under way and this is the primary it is
       leaving behind, back on its feet: it has to be told it may open, and
       what it is told is that a failover is in progress. */
    if (state.phase === 'failing-over' && state.initiateAt !== null && state.target !== m.id) {
      return 'mounted-noapply';
    }
    if (state.ackLostSince !== null && modeNow(doc, state) !== 'MAXPERFORMANCE'
      && state.ackLostSince + netTimeoutForMode(doc, view.graph) > at + EPS) return 'commit-hang';
    return 'open-rw';
  }

  if (state.formerPrimary === m.id) {
    if (state.reinstating === m.id) return 'reinstating';
    /* After a switchover the former primary IS the database that restarts, as
       the new standby -- the new primary does not wait for it, and how long the
       restart takes is environment-dependent, so the band is left open. */
    if (state.phase === 'switched') return 'mounted-noapply';
    /* Never aborted and nobody reaches it: still stalled, counting down. */
    if (view.actors[m.id as string]?.stalled) return 'stalled';
    /* A manual failover with the old primary still running and fast-start
       failover disabled leaves it open read-write beside the new one until it
       is taken down. The shutdown is the operator's ("ensure that the primary
       database is shut down", FAILOVER.PRIMARY_SHUT_DOWN) and no page says the
       broker closes or mounts a primary that stayed open, so this is the
       page's reading of a gap. It is true whether or not the new primary can
       reach it. With fast-start failover enabled it has lost its target and is
       drawn stalled, then aborted or stalled for good (above; D5). */
    if (state.formerOpen) return 'open-rw';
    /* Every other former primary is not open beside the new one. With
       fast-start failover enabled "it will not be allowed to open in any
       event" (ORA-16649): started and mounted, requiring reinstatement. With it
       disabled, one that restarts is drawn mounted too -- this page's reading
       -- except where it cannot reach the new primary: nothing tells it, so it
       comes back open. */
    const newPrimary = doc.members.find((x) => x.id === state.primary);
    const told = view.fsfoEnabled || (!!newPrimary
      && membersReachable(doc, state.net, m, newPrimary, view.reach));
    return told ? 'mounted-noapply' : 'open-rw';
  }

  if (state.converting === m.id) return 'converting';
  const r = view.graph.members[m.id];
  if (!r || !r.reachableFromPrimary) return 'unreachable';
  if (m.openMode === 'read-only-adg') return 'open-ro';
  /* A RAC standby waiting out ApplyInstanceTimeout has no instance applying. */
  const lost = state.applyLostSince[m.id as string];
  if (tracksApply(state, m) && lost !== null && lost !== undefined) return 'mounted-noapply';
  return m.applyRunning ? 'mounted-apply' : 'mounted-noapply';
}

function observerStateOf(
  doc: TopologyDoc, state: SimState, view: View, id: ObserverId,
): ObserverState {
  const o = doc.observers.find((x) => x.id === id);
  const s = state.observers[id as string];
  if (!o || !s || !s.running || !hostUp(doc, state.net, o.host)) return 'stopped';
  if (state.fsfoState === 'observe-only') return 'observe-only';
  if (view.master !== id) return 'backup';
  if (!view.obsSeesPrimary) return 'lost-primary';
  /* Against the active target, never against the first candidate. The broker
     "automatically changes the fast-start failover target to one of the other
     candidate targets", so once the selection has been made that member is the
     target -- and once it has been promoted it is the primary the observer is
     pinging, which `obsSeesPrimary` above has already answered for. */
  const active = state.phase === 'normal' ? state.activeTarget : state.target;
  if (active !== null) {
    if (active === state.primary) return 'master';
    return view.obsSeesTarget[active as string] === true ? 'master' : 'lost-target';
  }
  const anyTargetVisible = view.candidates.some((c) => view.obsSeesTarget[c as string] === true);
  if (view.candidates.length > 0 && !anyTargetVisible) return 'lost-target';
  return 'master';
}

/* ---------------- derived facts ---------------- */

function deriveFacts(
  doc: TopologyDoc,
  state: SimState,
  view: View,
  evts: readonly TimedEvent[],
  conditionsByEpoch: readonly Conditions[],
  epochs: readonly Epoch[],
  samples: readonly Sample[],
  ctx: { ping: boolean; legacyLoss: boolean; feeds: Record<string, Feed> },
): EngineFacts {
  const outcome = outcomeOf(state, view);
  const gated = lagGated(doc);
  const targetId = state.target ?? state.newPrimary ?? state.activeTarget
    ?? view.candidates[0] ?? null;
  const targetMember = targetId ? doc.members.find((m) => m.id === targetId) : undefined;
  /* What the gate measured where a failover was initiated; the lag as
     configured everywhere else. */
  const gateLag = state.gateLagAtFailure
    ?? (targetMember ? gateLagSeconds(doc, targetMember, state) : null);
  const endOfRun = (samples[samples.length - 1]?.t ?? 0);
  const missing = (id: MemberId): Seconds => {
    const since = state.unsentSince[id as string];
    const open = since === null || since === undefined ? 0 : Math.max(0, endOfRun - since);
    return (state.unsentAccum[id as string] ?? 0) + open;
  };
  const scheduled = state.initiateAt !== null || state.manualFailoverAt !== null;
  const applyRemaining = state.switchover
    ? state.switchover.applyRemaining
    : (scheduled && targetMember ? applyLagOf(targetMember, state) : 0);

  /* The reachability facts the drawings read are the ones the failure creates:
     the state right after the last external event that could still change
     them, which is where the published model reads them too. */
  const lastEvent = evts.length > 0 ? (evts[evts.length - 1] as TimedEvent).at : 0;
  const focus = Math.min(lastEvent, state.initiateAt ?? Infinity, state.switchover?.at ?? Infinity);
  const conditions = conditionsAt(epochs, conditionsByEpoch, isFinite(focus) ? focus : 0)
    ?? view.conditions;

  const { kind, seconds } = dataLoss(doc, state, outcome, gated, gateLag, {
    applyLag: targetMember ? applyLagOf(targetMember, state) : 0,
    transportLag: targetMember && !(targetId !== null && (ctx.feeds[targetId as string]?.sync ?? false))
      ? transportLagOf(targetMember, state) : 0,
    ranWithout: targetId !== null ? missing(targetId) : 0,
    legacyLoss: ctx.legacyLoss,
  });

  const perMember: Record<MemberId, PerMemberFacts> = {};
  const last = samples[samples.length - 1];
  for (const m of doc.members) {
    const endState = (last?.members[m.id as string] ?? 'down') as MemberState | FarSyncState;
    const isTarget = view.candidates.includes(m.id);
    const alive = memberAlive(doc, state.net, m) && !state.abortedMembers.includes(m.id);
    /* What a failure right now would cost at this member: the lag where the
       primary never waits for it, and on top of that whatever the primary has
       generated without it. */
    const exposure = (doc.config.protectionMode === 'MAXPERFORMANCE'
      ? gateLagSeconds(doc, m, state) : 0) + missing(m.id);
    perMember[m.id] = {
      rpoSeconds: m.id === state.newPrimary && state.loss !== null ? state.loss.claim : null,
      rtoSeconds: m.id === state.newPrimary && state.tOpenAt !== null
        ? rtoClaim(state, state.tOpenAt)
        : null,
      endState,
      ifDiedNow: isTarget && alive ? exposure : null,
    };
  }

  const observers: DerivedFacts['observers'] = {};
  for (const o of doc.observers) {
    const endState = (last?.observers[o.id as string] ?? 'stopped') as ObserverState;
    const entry: { endState: ObserverState; becameMasterAt?: Seconds } = { endState };
    if (state.nominatedAt !== null && view.master === o.id) entry.becameMasterAt = state.nominatedAt;
    observers[o.id] = entry;
  }

  return {
    outcome,
    newPrimary: state.newPrimary,
    initiateAt: state.initiateAt,
    execStartAt: state.execStartAt,
    tOpen: state.switchover ? state.switchover.tOpen : (scheduled ? state.tOpenAt : null),
    abortAt: state.abortAt,
    blocked: state.switchover ? state.switchover.blocked : state.blocked,
    perMember,
    observers,
    target: state.target,
    /* After a role change the target is whatever Oracle makes of the former
       primary, and that is past where this run stops evaluating. */
    activeTarget: state.phase === 'normal' || state.phase === 'blocked'
      ? state.activeTarget : null,
    unobserved: view.fsfoEnabled && state.unobserved,
    detectSeconds: state.initiateAt !== null ? state.detectSeconds : null,
    netHopSeconds: netHopSeconds(doc, view, targetId),
    applyRemainingSeconds: applyRemaining,
    gateLagSeconds: gateLag,
    lagType: effectiveLagType(doc),
    pingSet: ctx.ping,
    dataLossKind: kind,
    dataLossSeconds: seconds,
    ifDiedNow: ifDiedNowOf(doc, outcome, conditions, gateLag),
    observerLost: outcome === 'observer-lost',
    conditions,
    switchover: state.switchover,
    lagStall: lagStallOf(doc, state),
    protectionLevel: honestLevel(view.graph.protectionLevel, modeNow(doc, state)),
    abortReason: state.abortReason,
    netTimeoutSeconds: netTimeoutForMode(doc, view.graph),
    thresholdStartAt: state.thresholdStartAt,
    stallStartAt: state.stallStartAt,
  };
}

function conditionsAt(
  epochs: readonly Epoch[], conds: readonly Conditions[], t: Seconds,
): Conditions | null {
  let found: Conditions | null = null;
  for (let i = 0; i < epochs.length; i++) {
    if ((epochs[i] as Epoch).t0 <= t + EPS) found = conds[i] ?? found;
  }
  return found;
}

/**
 * The outcomes, in the order the published model branches in: a switchover is
 * a planned role reversal and never a failure; a fast-start failover that was
 * initiated is one even where the readiness gate then refused it; a stalled
 * primary is a different story from one that is merely unobserved; and a
 * primary that is gone with nothing armed leaves manual FAILOVER TO.
 *
 * `maxprot-shutdown` is the one outcome the published 1+1+1 model never had:
 * maximum protection shutting the primary down is not a stall. Nothing was
 * unobserved, no threshold ran, and the instant comes from NET_TIMEOUT -- so
 * it must never be drawn as FastStartFailoverThreshold.
 */
function outcomeOf(state: SimState, view: View): EngineFacts['outcome'] {
  if (state.switchover) return 'switchover';
  /* A fast-start failover the readiness check refused, and then an operator's
     FAILOVER TO that went through: the role change that happened is the
     manual one. The two are only ever both set in that order. */
  if (state.initiateAt !== null && state.manualFailoverAt !== null) return 'manual';
  if (state.initiateAt !== null) return 'failover';
  if (state.manualFailoverAt !== null) return 'manual';
  if (state.abortReason === 'maxprotection') return 'maxprot-shutdown';
  if (view.stalled || state.abortReason !== null) return 'stall-noone';
  if (view.fsfoEnabled && view.master === null && view.primaryAlive && view.anyTargetSeesPrimary) {
    return 'observer-lost';
  }
  if (!view.primaryAlive) return 'manual';
  return 'continues';
}

function dataLoss(
  doc: TopologyDoc, state: SimState, outcome: EngineFacts['outcome'], gated: boolean,
  gateLag: Seconds | null,
  lags: { applyLag: Seconds; transportLag: Seconds; ranWithout: Seconds; legacyLoss: boolean },
): { kind: DataLossKind; seconds: Seconds } {
  if (outcome === 'switchover') return { kind: 'none', seconds: 0 };
  if (outcome === 'failover') {
    if (state.blocked) return { kind: 'na', seconds: 0 };
    /* Decided where the failover was decided. */
    if (state.loss !== null) return { kind: state.loss.kind, seconds: state.loss.seconds };
    if (gated) return { kind: 'bounded', seconds: gateLag ?? 0 };
    return { kind: 'none', seconds: 0 };
  }
  if (outcome === 'manual') {
    if (state.loss !== null) return { kind: state.loss.kind, seconds: state.loss.seconds };
    /* Nobody was promoted: this is what a manual failover would find. Nothing
       bounds it -- FastStartFailoverLagLimit is fast-start failover's
       guarantee, and fast-start failover is not what would promote the
       standby here. The published page draws the apply lag as the number in
       maximum performance mode; what is lost is redo the standby never
       received, so everywhere else it is the transport gap plus the time the
       primary ran without it. */
    if (lags.legacyLoss) {
      return {
        kind: 'manual',
        seconds: (doc.config.protectionMode === 'MAXPERFORMANCE' ? lags.applyLag : 0) + lags.ranWithout,
      };
    }
    return { kind: 'manual', seconds: lags.transportLag + lags.ranWithout };
  }
  return { kind: 'none', seconds: 0 };
}

/**
 * When the new primary is open read-write, measured from the first event.
 *
 * Always a model: terminal recovery, the role change and the open are
 * environment-dependent, not parameter-driven. What each transition cites is
 * the documented part of its own arithmetic -- the threshold for a fast-start
 * failover, the conditions for a manual one, the step list for a switchover --
 * and never the switchover's "the new primary database does not need to be
 * restarted", which says nothing about a failover at all.
 */
function rtoClaim(state: SimState, tOpen: Seconds): Claim<Seconds> {
  const shared = "EXEC.ENV_DEPENDENT: terminal recovery, the role change and the open are environment-dependent, not parameter-driven, so this is the workbench's own arithmetic rather than a documented duration.";
  if (state.switchover) {
    return model(tOpen,
      `${shared} The verify and convert bands inside it are the two nominal drawing constants, and the former primary restarts as the new standby in parallel -- the new primary never waits for it.`,
      ['SWITCHOVER.SESSIONS_END', 'SWITCHOVER.FORMER_PRIMARY_RESTARTS']);
  }
  if (state.manualFailoverAt !== null) {
    return model(tOpen,
      `${shared} Nothing in a manual FAILOVER is timed by a broker property: the command is issued, the standby finishes what it holds, changes role and opens.`,
      ['FSFO.MANUAL_FAILOVER_CONDITIONS']);
  }
  return model(tOpen,
    `${shared} The one documented interval inside it is FastStartFailoverThreshold, before the observer initiates anything; everything after that instant is the environment.`,
    ['FSFO.THRESHOLD', 'FSFO.BOTH_MUST_HAVE_LOST']);
}

/**
 * What a failure right now would cost. Maximum performance never waits for the
 * standby, so whatever the standby is behind by is the exposure; the other two
 * modes keep a synchronized standby, so a failure right now costs nothing.
 * With the standby gone there is no target to price at all.
 */
const ifDiedNowOf = (
  doc: TopologyDoc, outcome: EngineFacts['outcome'], conditions: Conditions,
  gateLag: Seconds | null,
): Seconds | null => {
  if (outcome !== 'continues' && outcome !== 'observer-lost') return null;
  if (conditions.standbyGone) return null;
  return doc.config.protectionMode === 'MAXPERFORMANCE' ? (gateLag ?? 0) : 0;
};

/**
 * FastStartFailoverLagGraceTime is defined only while fast-start failover is
 * enabled, and both it and FastStartFailoverLagType stay documented as
 * maximum-performance-mode behaviour whatever the lag limit is doing in
 * maximum availability from 26ai on.
 */
function lagStallOf(doc: TopologyDoc, state: SimState): LagStall | null {
  const applies = doc.config.edition === '26ai'
    && doc.config.protectionMode === 'MAXPERFORMANCE'
    && state.fsfoState !== 'disabled'
    && doc.observers.length > 0;
  if (!applies) return null;
  const grace = Math.max(0, doc.config.fsfo.lagGraceTimeSeconds);
  return { armed: grace >= 5, graceTime: grace, maxSeconds: doc.config.fsfo.thresholdSeconds };
}

/**
 * The one-way network hop the FAILOVER command crosses: master observer to
 * target. Timers are never stretched by latency -- this is the only place it
 * enters the failover clock.
 */
function netHopSeconds(doc: TopologyDoc, view: View, target: MemberId | null): Seconds {
  if (target === null) return 0;
  const targetHost = doc.members.find((x) => x.id === target)?.instances[0]?.host;
  if (!targetHost) return 0;
  const from = view.masterHost ?? view.primary?.instances[0]?.host;
  if (!from) return 0;
  return linkRttMs(doc, from, targetHost) / 2000;
}

function gateFinding(doc: TopologyDoc, target: MemberId, readiness: Readiness): Finding {
  const gated = lagGated(doc);
  const cite: CitationId[] = gated
    ? ['FSFO.CANNOT_OVER_LAG_LIMIT', 'FSFO.LAGLIMIT_MAXAVAIL_26AI', 'FSFO.LAGTYPE']
    : ['FSFO.CANNOT_NOT_SYNCHRONIZED', 'FSFO.BOTH_MUST_HAVE_LOST', 'MAXAVAIL.AT_LEAST_ONE', 'XPT.TABLE_4_2'];
  return {
    id: 'FSFO.READINESS_GATE', severity: 'warning', basis: 'documented', cite,
    subject: { kind: 'member', id: target as string },
    message: gated
      ? `Fast-start failover is forbidden while the ${effectiveLagType(doc)} lag (${readiness.gateLag} s) is past FastStartFailoverLagLimit (${lagLimitOf(doc)} s): it cannot occur if ${target as string} lags by more than the limit at the time the primary database failed.`
      : `Fast-start failover is forbidden while the target standby is not synchronized: it cannot occur if ${target as string} was not synchronized with the primary database at the time the primary database failed.`,
  };
}

/* ---------------- axis ---------------- */

function pickAxis(doc: TopologyDoc, state: SimState, view: View, ping: boolean): Trace['axis'] {
  if (state.switchover) {
    if (state.switchover.blocked || state.switchover.tRestartDraw === null) return fixedAxis(60);
    return secondsAxis(state.switchover.tRestartDraw);
  }
  if (state.initiateAt !== null) {
    return failoverAxis({
      initiate: state.initiateAt,
      tOpen: state.tOpenAt,
      blocked: state.blocked,
      threshold: doc.config.fsfo.thresholdSeconds,
      pingSet: ping,
      abort: state.abortAt,
    });
  }
  if (state.abortAt !== null) return secondsAxis(state.abortAt);
  if (view.stalled) return secondsAxis(60);
  return fixedAxis(60);
}

/* ---------------- state ---------------- */

function initialState(doc: TopologyDoc): SimState {
  const observers: SimState['observers'] = {};
  for (const o of doc.observers) observers[o.id as string] = { running: o.running, role: o.role };
  const primary = doc.members.find((m) => isDatabase(m) && m.role === 'primary');
  const applyInstance: SimState['applyInstance'] = {};
  for (const m of doc.members) {
    if (!hasApplyInstance(m)) continue;
    const first = initialApplyInstance(m);
    if (first !== null) applyInstance[m.id as string] = first;
  }
  return {
    now: 0,
    net: initialNetState(doc),
    primary: primary?.id ?? (doc.members[0]?.id as MemberId),
    fsfoState: doc.config.fsfo.state,
    observers,
    masterOverride: null,
    master: null,
    obsLostPrimarySince: null,
    targetLostPrimarySince: {},
    stallSince: {},
    thresholdStartAt: null,
    stallStartAt: null,
    ackLostSince: null,
    /* The configuration as declared is acknowledging; the first epoch is where
       a destination can start to be missed. */
    ackArmed: true,
    fsfoReady: {},
    cutOffSince: {},
    unsentAccum: {},
    unsentSince: {},
    resyncedAt: {},
    unobserved: false,
    activeTarget: null,
    gateLagAtFailure: null,
    noTargetAt: null,
    phase: 'normal',
    target: null,
    blocked: false,
    detectSeconds: null,
    initiateAt: null,
    execStartAt: null,
    tOpenAt: null,
    newPrimary: null,
    formerPrimary: null,
    formerOpen: false,
    formerActs: false,
    formerLostTarget: false,
    everDown: [],
    reinstatePending: null,
    converting: null,
    reinstating: null,
    abortedMembers: [],
    abortAt: null,
    abortReason: null,
    disabledMembers: [],
    disabledDests: [],
    altLatched: [],
    groupChoice: {},
    destDownSince: {},
    destFailures: {},
    switchover: null,
    nominatedAt: null,
    applyLag: {},
    transportLag: {},
    applyInstance,
    applyLostSince: {},
    manualFailoverAt: null,
    pendingSwitchover: null,
    pendingApplyMove: null,
    pendingFailover: null,
    pendingReinstate: null,
    pendingMasterObserver: null,
    modeAfterRoleChange: null,
    loss: null,
    primaryWasDown: false,
  };
}

const startCause = (at: Seconds): InternalDeadline => ({
  kind: 'sim.start', at, label: 'initial state',
});

const asString = <T>(c: Claim<T>, text?: string): Claim<string> => {
  const value = text ?? String(c.value);
  return c.note === undefined
    ? { value, basis: c.basis, cite: [...c.cite] }
    : { value, basis: c.basis, cite: [...c.cite], note: c.note };
};

/* ---------------- stateAt ---------------- */

/** `stateAt(trace, t)` -- a binary search over the epochs, then over the lanes. */
export function stateAt(trace: Trace, t: Seconds): Snapshot {
  const snap = snapshotFrom(trace.epochs, trace.lanes, t);
  if (!snap) throw new Error('the trace has no epochs');
  return snap;
}
