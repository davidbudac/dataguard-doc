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
import type { HostId, MemberId, ObserverId, Seconds, SiteId } from '../ids';
import {
  applyNetEvent, buildReachability, hostUp, initialNetState, linkRttMs, liveInstances,
  memberAlive, memberReachableFromHost, membersReachable, netSummary,
} from '../net/graph';
import type { NetState, Reachability } from '../net/graph';
import { resolveRedoGraph } from '../redo/resolve';
import type { Claim, Finding } from '../types/claims';
import { documented, model } from '../types/claims';
import type { FarSyncState, MemberState, ObserverState, TimedEvent } from '../types/events';
import { sortEvents } from '../types/events';
import type { DatabaseMember, Member, TopologyDoc } from '../types/topology';
import { isDatabase, isFarSync, isRac } from '../types/topology';
import type {
  Decision, DerivedFacts, Epoch, InternalDeadline, PerMemberFacts, ProtectionLevel, RedoGraph,
  SimParams, Snapshot, Trace,
} from '../types/trace';
import { buildLanes, EPS, isDue, Queue, snapshotFrom } from './kernel';
import type { Pending, Sample, SimState, SwitchoverFacts } from './kernel';
import {
  applyGapOf, applyLagOf, candidateTargets, detectClaim, effectiveLagType, gateLagSeconds,
  initiateDelayClaim, lagGated, nominationClaim, pickMaster, pingPropertiesSet, preferredRank,
  readinessGate, selectTarget,
} from './fsfo';
import type { Readiness } from './fsfo';
import {
  abortClaim, commitHangClaim, maxAvailDegraded, maxProtectionShutdown, netTimeoutForMode,
  stallClaim, syncAckDatabases, syncAckMembers,
} from './protection';
import {
  alternateLatched, authoredDests, destKey, disableAt, failedAttempts, groupReenters,
  maxFailureDisabled, maxFailureResetUndoc, reopenScheduleModel,
} from './dests';
import type { AuthoredDest } from './dests';
import {
  applyFailoverClaim, applyGapFailoverClaim, applyInstanceTimeout, applyWaitClaim,
  hasApplyInstance, initialApplyInstance, nextApplyInstance, primaryDegradedClaim,
  isMultiInstanceApply, participantLostClaim, roleChangeApplyClaim, setApplyClaim,
} from './rac';
import {
  bystanderClaim, bystanders, executionClaim, manualFailoverFindings, nominalBandsClaim,
  reinstateBandClaim, reinstateFindings, switchoverGate, switchoverLossClaim, switchoverRefused,
  switchoverSchedule,
} from './roles';

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

export type DataLossKind = 'none' | 'bounded' | 'na' | 'manual';

export interface EngineFacts extends DerivedFacts {
  /** The candidate the broker landed on, whether or not it was promoted. */
  target: MemberId | null;
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

  /* The readiness latch starts from the configuration as declared: what the
     standby was worth before anything failed. Synchronized is a statement
     about redo received, so a link that has just been cut does not
     un-synchronize the redo the standby already holds. */
  const baseGraph = resolveRedoGraph(doc, { primary: state.primary, net: initialNetState(doc) });
  for (const m of doc.members) {
    state.lastKnownSync[m.id as string] = baseGraph.members[m.id]?.synchronized.value ?? false;
  }
  /* The opening election is held on the configuration as declared, before
     anything fails: from here on the master is replaced only under the
     documented nomination precondition. */
  electMaster(doc, state, (h) => hostUp(doc, state.net, h), true);

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

    /* 2. the epoch's facts, computed once. */
    let view = computeView(doc, state);

    /* 3. commands are answered against those facts, then the deadlines that
          fall due are fired against them. */
    if (state.pendingSwitchover !== null) { runSwitchover(view, t); view = computeView(doc, state); }
    if (state.pendingFailover !== null) { runManualFailover(view, t); view = computeView(doc, state); }

    const due = q.popDue(t);
    for (const p of due) {
      if (!cause) cause = p.deadline;
      fire(p, view, t);
    }
    if (due.length > 0) view = computeView(doc, state);

    /* 4. the clocks, and the decisions this epoch is where to record. */
    updateClocks(view, t);
    updateDests(view, t);
    updateRac(view, t);
    noteMasterChange(view, t);
    recordEpochDecisions(view, t);

    /* 5. derived clocks are rebuilt from the state every epoch; committed
          schedule points -- a failover's exec and open, a switchover's bands --
          survive until they fire. */
    q.clearDerived();
    scheduleDerived(view, t);
    view = computeView(doc, state);

    /* 6. record. */
    const epoch: Epoch = {
      t0: t, t1: null,
      cause: cause ?? startCause(t),
      net: netSummary(state.net),
      redo: view.graph,
      primary: state.primary,
      protectionLevel: view.graph.protectionLevel,
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

  const finalView = computeView(doc, state);
  const facts = deriveFacts(doc, state, finalView, evts, conditionsByEpoch, epochs, samples);
  const axis = pickAxis(doc, state, finalView);
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
        completeFailover(at);
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
      case 'net.timeout':
        break;
      /* The move itself is made in `updateRac`, against this epoch's network. */
      case 'apply.failover':
        break;
      /* The retry itself is bookkeeping: what it changes is counted in
         `updateDests`, against the epoch this deadline opened. */
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

  function initiate(view: View, at: Seconds): void {
    if (state.phase !== 'normal' || !view.armed || view.obsSeesPrimary) return;

    /* ObserverOverride is FALSE: the candidate must itself have lost the
       primary for the whole window, not merely be out of touch right now. */
    const delay = initiateDelayClaim(doc).value;
    const usable = (id: MemberId): boolean => {
      const lost = state.targetLostPrimarySince[id as string];
      return (view.targetAlive[id as string] ?? false)
        && !(view.targetSeesPrimary[id as string] ?? false)
        && lost !== null && lost !== undefined && lost + delay <= at + EPS
        && (view.obsSeesTarget[id as string] ?? false);
    };
    const choice = selectTarget(view.candidates, usable, (id) => gateFor(id).passes, policy);
    if (choice.target === null) return;

    const target = choice.target;
    const targetMember = doc.members.find((m) => m.id === target);
    if (!targetMember) return;

    decide(at, 'FSFO.BOTH_MUST_HAVE_LOST', true, asString(
      documented(true, ['FSFO.BOTH_MUST_HAVE_LOST', 'FSFO.OBSERVER_OVERRIDE_FALSE'],
        'ObserverOverride is FALSE, the broker default, and this engine models the default only: set TRUE, the observer could initiate once IT had lost the primary even if the standby has a healthy connection to the primary.'),
      `Both the master observer and the target standby have lost the primary for ${pingPropertiesSet(doc) ? 'the ping window (both ObserverPing properties are set, so the threshold is ignored for detection)' : 'the threshold'}.`));
    decide(at, 'FSFO.OBSERVER_REACHES_TARGET', true, asString(
      documented(true, ['OBS.CANNOT_OCCUR_LIST', 'OBS.MASTER_ONLY_COORDINATES'],
        'Only the master observer can coordinate fast-start failover, and fast-start failover cannot occur if the master observer is not running.'),
      `The master observer reaches ${target as string} and can order the failover.`));
    decide(at, 'FSFO.TARGET_SELECTION', true, choice.claim, { kind: 'member', id: target as string });
    if (pingPropertiesSet(doc)) {
      const d = detectClaim(doc);
      decide(at, 'FSFO.PING_ARITHMETIC', true, asString(d,
        `Detection took ${d.value} s: with both ping properties set the threshold is ignored for the observer's detection.`));
    }

    const readiness = gateFor(target);
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
    state.detectSeconds = detectClaim(doc).value;
    state.initiateAt = at;
    state.execStartAt = at + netHop;
    state.tOpenAt = at + netHop + applyRemaining + doc.environment.roleTransitionSeconds;
    state.blocked = !readiness.passes;

    if (!readiness.passes) {
      state.phase = 'blocked';
      addFinding(gateFinding(doc, target, readiness));
      return;
    }

    state.phase = 'failing-over';
    const subject = { kind: 'member' as const, id: target as string };
    q.push({ kind: 'fsfo.exec', at: state.execStartAt, subject }, 'fsfo.exec', false, target);
    q.push({ kind: 'fsfo.open', at: state.tOpenAt, subject }, 'fsfo.open', false, target);
    decide(at, 'EXEC.ENV_DEPENDENT', true, asString(
      executionClaim(doc.environment.roleTransitionSeconds),
      'Terminal recovery, the role change and the open are environment-dependent, not parameter-driven.'));
  }

  function gateFor(id: MemberId): Readiness {
    const m = doc.members.find((x) => x.id === id);
    if (!m) {
      return {
        passes: false, gateLag: 0,
        claim: documented(false, ['FSFO.TARGET_KIND'], 'No such member.'),
      };
    }
    return readinessGate(doc, m, state.lastKnownSync[id as string] ?? false, state);
  }

  function completeFailover(at: Seconds): void {
    const target = state.target;
    if (target === null) return;
    state.formerPrimary = state.primary;
    state.newPrimary = target;
    state.primary = target;
    state.converting = null;
    state.phase = 'failed-over';
    state.tOpenAt = at;
    /* A new primary starts with no acknowledgement behind it (kernel.ts). */
    state.ackArmed = false;
    state.ackLostSince = null;

    const follow = doc.config.bystandersFollowRoleChange;
    decide(at, 'BYSTANDERS.FOLLOW', follow === 'ALL', asString(bystanderClaim(follow)));
    if (follow === 'NONE') {
      for (const b of bystanders(doc, target)) {
        if (b !== state.formerPrimary) state.disabledMembers.push(b);
      }
    }

    /* FastStartFailoverAutoReinstate reinstates only after an observer-initiated
       failover caused by a primary crash or isolation -- never after a manual
       FAILOVER TO, a user-configurable health condition or a
       DBMS_DG.INITIATE_FS_FAILOVER call. */
    const former = state.manualFailoverAt === null ? state.formerPrimary : null;
    if (former !== null) {
      for (const f of reinstateFindings(doc, former, target)) addFinding(f);
      const fm = doc.members.find((m) => m.id === former);
      if (doc.config.fsfo.autoReinstate && fm && isDatabase(fm) && fm.flashbackOn) {
        state.reinstating = former;
        rearmApply(former, at);
        decide(at, 'REINSTATE.OPEN_BAND', true, asString(reinstateBandClaim(),
          `${former as string} is reinstated as the new standby; how long that takes is environment-dependent, so the band is drawn with no end.`));
      }
    }
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

    if (roleFenceRefuses(view, to, 'SWITCHOVER TO', at)) return;

    const gateLag = gateLagSeconds(doc, m, state);
    const gate = switchoverGate({
      fsfoEnabled: view.fsfoEnabled,
      maxPerformance: doc.config.protectionMode === 'MAXPERFORMANCE',
      gateLag,
      lagLimit: doc.config.fsfo.lagLimitSeconds,
      isTarget: view.candidates.includes(to),
      /* Synchronized is about redo RECEIVED, and under SYNC or FASTSYNC the
         commit waits for the acknowledgement: an apply lag never blocks a
         maximum availability switchover, and a transport gap is not a state
         that transport can be in. Where FastStartFailoverLagLimit is the
         readiness gate (26ai bounded maximum availability) the latched flag
         carries the lag inference instead of a transport fact, so the
         transport itself is asked directly -- the lag limit governs fast-start
         failover's readiness, not the broker's switchover gate. */
      synchronized: lagGated(doc)
        ? directSyncFromPrimary(view, to)
        : (state.lastKnownSync[to as string] ?? false),
    });
    const refusal = gate.reason === 'not-target'
      ? 'the broker permits a switchover only to the pre-specified target standby, and this member is not one of the FastStartFailoverTarget candidates'
      : gate.reason === 'not-synchronized'
        ? 'in maximum availability the broker permits it only while the target standby is synchronized, and this one has redo it has not received'
        : `in maximum performance mode the broker permits it only inside FastStartFailoverLagLimit (${gateLag} s against ${doc.config.fsfo.lagLimitSeconds} s)`;
    decide(at, 'SWITCHOVER.GATE', !gate.blocked, asString(gate.claim,
      gate.blocked
        ? `The broker refuses the SWITCHOVER: fast-start failover is enabled and ${refusal}.`
        : 'The broker permits the SWITCHOVER.'), { kind: 'member', id: to as string });

    if (gate.blocked) {
      state.switchover = switchoverRefused(at, to);
      addFinding({
        id: 'SWITCHOVER.REFUSED', severity: 'warning', basis: 'documented',
        cite: gate.reason === 'past-lag-limit'
          ? ['SWITCHOVER.FSFO_GATE', 'FSFO.LAGLIMIT_RECOMMENDATION']
          : ['SWITCHOVER.FSFO_GATE'],
        subject: { kind: 'member', id: to as string },
        message: `The SWITCHOVER is refused: with fast-start failover enabled ${refusal}. Nothing converts and the primary never stops serving.`,
      });
      return;
    }

    const depth = declaredDepth(doc, state.primary, to);
    if (depth >= 2) {
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
    const subject = { kind: 'member' as const, id: to as string };
    const sw = state.switchover;
    if (sw.tDown !== null) q.push({ kind: 'switchover.verify', at: sw.tDown, subject }, 'switchover.verify', false, to);
    if (sw.tConvertEnd !== null) q.push({ kind: 'switchover.convert', at: sw.tConvertEnd, subject }, 'switchover.convert', false, to);
    if (sw.tOpen !== null) q.push({ kind: 'switchover.open', at: sw.tOpen, subject }, 'switchover.open', false, to);
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
    if (state.formerPrimary !== null) rearmApply(state.formerPrimary, at);
    decide(at, 'SWITCHOVER.ZERO_LOSS', true, asString(switchoverLossClaim(),
      'The roles swap only once the standby has everything: zero data loss in every protection mode. The former primary restarts as the new standby, and the new primary does not wait for it.'));
  }

  function runManualFailover(view: View, at: Seconds): void {
    const to = state.pendingFailover;
    state.pendingFailover = null;
    if (to === null) return;
    const m = doc.members.find((x) => x.id === to);
    if (!m || isFarSync(m)) {
      addFinding({
        id: 'FSFO.TARGET_KIND', severity: 'error', basis: 'documented',
        cite: ['FSFO.TARGET_NOT_FARSYNC'], subject: { kind: 'member', id: to as string },
        message: 'A far sync instance is never a failover target: it can never function in the primary role.',
      });
      return;
    }
    if (roleFenceRefuses(view, to, 'FAILOVER TO', at)) return;
    /* Whether this member is fed directly or through another member is a
       property of the configuration as declared, not of the network the moment
       the command is issued -- by then the primary may be gone. */
    const depth = declaredDepth(doc, state.primary, to);
    const isTarget = view.candidates.includes(to);
    const observerTalks = view.master !== null && (view.obsSeesTarget[to as string] ?? false);
    for (const f of manualFailoverFindings(doc, to, {
      fsfoEnabled: view.fsfoEnabled,
      isFsfoTarget: isTarget,
      ready: gateFor(to).passes,
      observerTalksToTarget: observerTalks,
      cascaded: depth >= 2,
    })) addFinding(f);

    state.manualFailoverAt = at;
    state.target = to;
    /* A role change is under way, so no fast-start failover clock runs on top
       of it -- with fast-start failover still enabled the observer would have
       ordered its own, which is the whole point of DISABLE FAST_START FAILOVER
       FORCE in the documented conditions above. */
    state.phase = 'failing-over';
    const applyRemaining = applyLagOf(m, state);
    state.execStartAt = at;
    state.tOpenAt = at + applyRemaining + doc.environment.roleTransitionSeconds;
    const subject = { kind: 'member' as const, id: to as string };
    state.converting = to;
    q.push({ kind: 'fsfo.open', at: state.tOpenAt, subject }, 'fsfo.open', false, to);
    decide(at, 'FSFO.MANUAL_FAILOVER', true, asString(
      documented(true, ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'FSFO.STATUS_DISABLED'],
        'A manual FAILOVER TO needs no observer while fast-start failover is disabled. With fast-start failover enabled it is conditional: the target must be the FastStartFailoverTarget standby, synchronized (maximum availability or protection) or inside the lag limit (maximum performance), with the observer started and communicating with it, and the primary shut down first.'),
      `FAILOVER TO ${to as string}.`), subject);
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
    }

    /* A commit hangs on a synchronous acknowledgement that stopped arriving.
       With no synchronous destination declared at all nothing is waited for
       -- the mode simply operates as if it were maximum performance. */
    const wantsAck = doc.config.protectionMode !== 'MAXPERFORMANCE' && view.syncDeclared;
    /* Only an acknowledgement that was there can go away. A primary that took
       the role with its synchronous destinations already down has none to
       lose, so nothing hangs: it opens read-write at the instant the role
       change completes, which is what the readout and the timeline say. */
    if (view.syncAcks.length > 0) state.ackArmed = true;
    state.ackLostSince = wantsAck && state.ackArmed && view.primaryAlive
      && view.syncAcks.length === 0
      ? state.ackLostSince ?? at
      : null;

    /* Latch what each member is worth while redo is actually reaching it. */
    for (const m of doc.members) {
      const r = view.graph.members[m.id];
      if (r && r.reachableFromPrimary && m.id !== state.primary) {
        state.lastKnownSync[m.id as string] = r.synchronized.value;
      }
    }
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
      if (d.props.maxFailure <= 0 || failures < d.props.maxFailure) continue;
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
        decide(at, 'OBS.SET_MASTEROBSERVER', true, {
          value: `SET MASTEROBSERVER TO ${view.master as string}: the role moved by command.`,
          basis: 'documented', cite: ['OBS.SET_MASTEROBSERVER'],
          note: 'The command is documented; its preconditions are not, so this engine states none and moves the role at the instant of the command.',
        }, { kind: 'observer', id: view.master as string });
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

    if (view.stalled) {
      decide(at, 'PRIMARY.STALL', true, asString(stallClaim(true),
        'The primary can reach neither the observer nor the target standby, so it is STALLED. Losing the observer alone would stall nothing.'));
      if (!doc.config.fsfo.pmyShutdown) {
        decide(at, 'PRIMARY.ABORT', false, asString(
          documented(false, ['FSFO.PMY_SHUTDOWN'],
            'FastStartFailoverPmyShutdown is FALSE, so the stalled primary stays STALLED until an operator intervenes.'),
          'FastStartFailoverPmyShutdown is FALSE: nothing aborts the primary.'));
      }
    }

    if (state.ackLostSince !== null && doc.config.protectionMode !== 'MAXPERFORMANCE') {
      const until = state.ackLostSince + netTimeoutForMode(doc, view.graph);
      decide(at, 'PROT.COMMIT_HANG', true, asString(commitHangClaim(until, view.stalled),
        view.stalled
          ? 'The commit hang spans the whole stall: the fast-start failover stall overrides NET_TIMEOUT\'s drop-and-continue behaviour.'
          : `Commits wait for the synchronous acknowledgement until NET_TIMEOUT expires at ${until} s, and the primary then drops the destination and carries on.`));
    }

    if (doc.config.protectionMode === 'MAXAVAILABILITY') {
      const degraded = maxAvailDegraded(view.syncAcks.length);
      if (degraded.value) {
        decide(at, 'PROT.MAXAVAIL_DEGRADED', true, asString(degraded,
          'Without an acknowledgement from at least one synchronized standby, maximum availability operates as if it were in maximum performance mode. The primary keeps running.'));
      }
    }
  }

  function scheduleDerived(view: View, at: Seconds): void {
    /* The failover clock. */
    if (state.phase === 'normal' && view.armed && state.obsLostPrimarySince !== null) {
      const delay = initiateDelayClaim(doc).value;
      let best: Seconds | null = null;
      for (const id of view.candidates) {
        const lost = state.targetLostPrimarySince[id as string];
        if (lost === null || lost === undefined) continue;
        if (!(view.targetAlive[id as string] ?? false)) continue;
        if (!(view.obsSeesTarget[id as string] ?? false)) continue;
        const when = Math.max(state.obsLostPrimarySince, lost) + delay;
        if (best === null || when < best) best = when;
      }
      if (best !== null) {
        if (best <= at + EPS) initiate(view, at);
        else q.push({ kind: 'fsfo.initiate', at: best }, 'fsfo.initiate', true);
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
    if (doc.config.protectionMode === 'MAXPROTECTION' && state.ackLostSince !== null
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
      if (d.props.maxFailure <= 0) continue;
      const since = state.destDownSince[d.key];
      if (since === null || since === undefined) continue;
      const failures = state.destFailures[d.key] ?? 0;
      if (failures >= d.props.maxFailure) continue;
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
      && doc.config.protectionMode === 'MAXAVAILABILITY') {
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
 * Is this member fed straight from the primary over a live SYNC or FASTSYNC
 * edge? That is the transport half of SYNCHRONIZED -- redo received -- asked
 * of the graph rather than of a latched readiness flag.
 */
function directSyncFromPrimary(view: View, to: MemberId): boolean {
  return view.graph.edges.some((e) => e.from === view.graph.primary && e.to === to
    && e.active && e.up && (e.xpt === 'SYNC' || e.xpt === 'FASTSYNC'));
}

/**
 * How many hops from the primary this member sits in the configuration as
 * declared, with nothing failed: 1 is a direct destination, 2 or more is a
 * cascade, and -1 is a member the routing rules never feed.
 */
function declaredDepth(doc: TopologyDoc, primary: MemberId, to: MemberId): number {
  const declared = resolveRedoGraph(doc, { primary, net: initialNetState(doc) });
  return declared.members[to]?.depth ?? -1;
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
    case 'cmd.setMasterObserver': state.masterOverride = e.observer; break;
    case 'cmd.setApplyInstance': state.pendingApplyMove = { member: e.member, instance: e.instance }; break;
    case 'cmd.disableFsfo': state.fsfoState = 'disabled'; break;
    case 'cmd.switchover': state.pendingSwitchover = e.to; break;
    case 'cmd.failover': state.pendingFailover = e.to; break;
    case 'cmd.reinstate': state.reinstating = e.member; break;
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
 * it is running and reachable. When it is lost, a backup is nominated only
 * under the documented precondition -- "if the primary and target standby
 * databases stay connected but the connection to the master observer is lost,
 * then the broker tries to nominate a backup observer as the new master
 * observer" -- and otherwise the configuration stays unobserved. The rule is
 * never extended to a failure that separates the primary from the target
 * standby, or takes the primary down. SET MASTEROBSERVER TO is the manual
 * override and needs no precondition; a master that comes back keeps the role.
 */
function electMaster(
  doc: TopologyDoc, state: SimState, hostAlive: (h: HostId) => boolean, precondition: boolean,
): ObserverId | null {
  const eligible = (id: ObserverId | null): boolean => {
    if (id === null) return false;
    const o = doc.observers.find((x) => x.id === id);
    const s = state.observers[id as string];
    return !!o && !!s && s.running && hostAlive(o.host) && preferredRankOf(doc, o.host) !== null;
  };
  /* `state.master` remembers the last holder of the role even while it is
     unreachable, so a master that comes back resumes without a nomination. */
  if (state.masterOverride !== null && eligible(state.masterOverride)) {
    state.master = state.masterOverride;
    return state.master;
  }
  if (eligible(state.master)) return state.master;
  const opening = state.master === null;
  if (!opening && !precondition) return null;
  /* The opening election takes the declared master or the best-ranked
     observer; a later one is the documented nomination attempt. */
  const next = pickMaster(doc, state, hostAlive);
  if (next !== null) state.master = next;
  return next;
}

const preferredRankOf = (doc: TopologyDoc, host: HostId): number | null => preferredRank(doc, host);

function computeView(doc: TopologyDoc, state: SimState): View {
  const net = state.net;
  const reach = buildReachability(doc, net);
  /* The two latches the loop carries between epochs: a destination disabled at
     MaxFailure stays disabled until it is manually reenabled, and an alternate
     declared without FALLBACK stays in service once it has taken over. */
  const graph = resolveRedoGraph(doc, {
    primary: state.primary,
    net,
    disabledDests: new Set(state.disabledDests),
    altLatched: new Set(state.altLatched),
  });
  const primary = doc.members.find((m) => m.id === state.primary) as Member;
  const alive = (m: Member): boolean =>
    memberAlive(doc, net, m) && !state.abortedMembers.includes(m.id);
  const primaryAlive = !!primary && alive(primary);

  /* No observer deployed means fast-start failover was never armed -- a third
     state (FS_FAILOVER_STATUS = DISABLED), not "unobserved". Unobserved is
     enabled with the master observer missing. */
  const fsfoEnabled = state.fsfoState === 'enabled' && doc.observers.length > 0;

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

  const master = electMaster(doc, state, (h) => hostUp(doc, net, h), primaryAlive && anyTargetSeesPrimary);
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

  /* Acting primaries: the current one, plus a former primary that was never
     aborted and is still running somewhere nobody can reach. */
  const actorIds: MemberId[] = [state.primary];
  if (state.formerPrimary !== null && state.formerPrimary !== state.primary
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
    const seenByTarget = candidates.some((c) => {
      if (c === id) return false;
      const cm = doc.members.find((x) => x.id === c);
      return !!cm && (targetAlive[c as string] ?? false)
        && membersReachable(doc, net, m, cm, reach);
    });
    actors[id as string] = {
      alive: up,
      observerSees: seenByObserver,
      anyTargetSees: seenByTarget,
      stalled: fsfoEnabled && up && !seenByObserver && !seenByTarget,
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
    if (state.ackLostSince !== null && doc.config.protectionMode !== 'MAXPERFORMANCE'
      && state.ackLostSince + netTimeoutForMode(doc, view.graph) > at + EPS) return 'commit-hang';
    return 'open-rw';
  }

  if (state.formerPrimary === m.id) {
    if (state.reinstating === m.id) return 'reinstating';
    /* After a switchover the former primary IS the database that restarts, as
       the new standby -- the new primary does not wait for it, and how long the
       restart takes is environment-dependent, so the band is left open. */
    if (state.phase === 'switched') return 'mounted-noapply';
    /* Never aborted and still running: the stranded former primary, which is
       exactly the two-primaries window the lag-limit recommendation warns
       about. */
    if (view.actors[m.id as string]?.stalled) return 'stalled';
    return 'open-rw';
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
  const active = state.target;
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
): EngineFacts {
  const outcome = outcomeOf(state, view);
  const gated = lagGated(doc);
  const targetId = state.target ?? state.newPrimary ?? view.candidates[0] ?? null;
  const targetMember = targetId ? doc.members.find((m) => m.id === targetId) : undefined;
  const gateLag = targetMember ? gateLagSeconds(doc, targetMember, state) : null;
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

  const { kind, seconds } = dataLoss(doc, state, outcome, gated, gateLag,
    targetMember ? applyLagOf(targetMember, state) : 0);

  const perMember: Record<MemberId, PerMemberFacts> = {};
  const last = samples[samples.length - 1];
  for (const m of doc.members) {
    const endState = (last?.members[m.id as string] ?? 'down') as MemberState | FarSyncState;
    const isTarget = view.candidates.includes(m.id);
    const alive = memberAlive(doc, state.net, m) && !state.abortedMembers.includes(m.id);
    perMember[m.id] = {
      rpoSeconds: m.id === state.newPrimary ? rpoClaim(kind, seconds) : null,
      rtoSeconds: m.id === state.newPrimary && state.tOpenAt !== null
        ? rtoClaim(state, state.tOpenAt)
        : null,
      endState,
      ifDiedNow: isTarget && alive
        ? (doc.config.protectionMode === 'MAXPERFORMANCE' ? gateLagSeconds(doc, m, state) : 0)
        : null,
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
    detectSeconds: state.initiateAt !== null ? state.detectSeconds : null,
    netHopSeconds: netHopSeconds(doc, view, targetId),
    applyRemainingSeconds: applyRemaining,
    gateLagSeconds: gateLag,
    lagType: effectiveLagType(doc),
    pingSet: pingPropertiesSet(doc),
    dataLossKind: kind,
    dataLossSeconds: seconds,
    ifDiedNow: ifDiedNowOf(doc, outcome, conditions, gateLag),
    observerLost: outcome === 'observer-lost',
    conditions,
    switchover: state.switchover,
    lagStall: lagStallOf(doc, state),
    protectionLevel: view.graph.protectionLevel,
    abortReason: state.abortReason,
    netTimeoutSeconds: netTimeoutForMode(doc, view.graph),
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
  gateLag: Seconds | null, applyLag: Seconds,
): { kind: DataLossKind; seconds: Seconds } {
  if (outcome === 'switchover') return { kind: 'none', seconds: 0 };
  if (outcome === 'failover') {
    if (state.blocked) return { kind: 'na', seconds: 0 };
    if (gated) return { kind: 'bounded', seconds: gateLag ?? 0 };
    return { kind: 'none', seconds: 0 };
  }
  if (outcome === 'manual') {
    /* Nothing bounds a manual failover's loss: FastStartFailoverLagLimit is
       fast-start failover's guarantee, and fast-start failover is not what
       promotes the standby here. */
    return {
      kind: 'manual',
      seconds: doc.config.protectionMode === 'MAXPERFORMANCE' ? applyLag : 0,
    };
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

const rpoClaim = (kind: DataLossKind, seconds: Seconds): Claim<number> => {
  if (kind === 'bounded') {
    return documented(seconds, ['FSFO.LAGLIMIT_MAXAVAIL_26AI', 'FSFO.LAGTYPE'],
      'The failover loses no more than the lag the readiness gate measured, which is what FastStartFailoverLagLimit bounds.');
  }
  if (kind === 'manual') {
    return model(seconds,
      "The standby is promoted with whatever redo it holds, and the loss is drawn 1:1 with the lag -- the workbench's own illustration, not a documented rate.",
      ['MAXAVAIL.AT_LEAST_ONE']);
  }
  return documented(0, ['MAXAVAIL.AT_LEAST_ONE', 'SWITCHOVER.ZERO_LOSS'],
    'The standby was synchronized, so the role change loses nothing.');
};

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
    ? ['FSFO.LAGLIMIT_MAXAVAIL_26AI', 'FSFO.LAGTYPE']
    : ['FSFO.BOTH_MUST_HAVE_LOST', 'MAXAVAIL.AT_LEAST_ONE', 'XPT.TABLE_4_2'];
  return {
    id: 'FSFO.READINESS_GATE', severity: 'warning', basis: 'documented', cite,
    subject: { kind: 'member', id: target as string },
    message: gated
      ? `Fast-start failover is forbidden while the ${effectiveLagType(doc)} lag (${readiness.gateLag} s) is past FastStartFailoverLagLimit (${doc.config.fsfo.lagLimitSeconds} s).`
      : 'Fast-start failover is forbidden while the target standby is not synchronized.',
  };
}

/* ---------------- axis ---------------- */

function pickAxis(doc: TopologyDoc, state: SimState, view: View): Trace['axis'] {
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
      pingSet: pingPropertiesSet(doc),
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
    ackLostSince: null,
    /* The configuration as declared is acknowledging; the first epoch is where
       a destination can start to be missed. */
    ackArmed: true,
    lastKnownSync: {},
    phase: 'normal',
    target: null,
    blocked: false,
    detectSeconds: null,
    initiateAt: null,
    execStartAt: null,
    tOpenAt: null,
    newPrimary: null,
    formerPrimary: null,
    converting: null,
    reinstating: null,
    abortedMembers: [],
    abortAt: null,
    abortReason: null,
    disabledMembers: [],
    disabledDests: [],
    altLatched: [],
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
