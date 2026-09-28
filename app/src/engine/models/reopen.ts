/**
 * What happens after redo transport has already given up on a destination --
 * engine design SS6, ported from the published fragment's REOPEN block. The
 * primary is open the whole time; only the destination is closed.
 *
 * REOPEN gates eligibility and the log switch supplies the trigger: redo
 * transport attempts to reopen failed destinations at log switch time, when
 * the time of the last error plus the REOPEN interval is less than the current
 * time. Retries are drawn here at exact REOPEN multiples, which is an
 * idealization -- see footnote 4.
 *
 * MAX_FAILURE counts the consecutive attempts to REESTABLISH communication,
 * and the two editions count them differently (ED-04). 19c: the initial
 * error at t = 0 is not one of them, so MaxFailure retries run before the
 * destination is disabled -- no further access until it is manually
 * reenabled, and the network healing does not bring it back. 26ai's usage
 * notes count the initial failure too, so MaxFailure = 1 disables the
 * destination immediately (no retry at all) and MaxFailure = n gives n - 1
 * retries; `retryLimit` in `sim/dests.ts` is the same arithmetic. Either way
 * the network healing does not bring it back. The one documented exception is
 * a 12.2+ GROUP/PRIORITY destination, which re-enters service when it is
 * found accessible -- that is what `inPriorityGroup` draws.
 */

import { assertCitesAllowed } from '../citations';
import type { CitationId } from '../citations';
import { BOUNDS, lagLimitOf } from '../defaults';
import type { Edition, MemberId, Seconds } from '../ids';
import { defaultDestProps } from '../serialize/schema';
import type { Claim } from '../types/claims';
import { documented, model } from '../types/claims';
import type { ProtectionMode, TopologyDoc } from '../types/topology';
import { destProps, findMember } from '../types/topology';
import type { Lane, Trace } from '../types/trace';
import { reopenAxis } from './axis';

export interface ReopenInput {
  /** ReopenSecs / REOPEN, in seconds. */
  reopenSeconds: Seconds;
  /** MaxFailure / MAX_FAILURE; 0 is unlimited. */
  maxFailure: number;
  /** How long the destination stays unreachable. */
  outageSeconds: Seconds;
  redoRateMBs: number;
  mode: ProtectionMode;
  lagLimitSeconds: Seconds;
  edition?: Edition;
  lagGraceTimeSeconds?: Seconds;
  thresholdSeconds?: Seconds;
  /**
   * False = no observer deployed, so nothing is armed and the LAGGING stall
   * and grace outputs stay null. Default true.
   */
  fsfoEnabled?: boolean;
  /**
   * The destination is part of a RedoRoutes priority group (or a
   * LOG_ARCHIVE_DEST_n GROUP), so reaching MaxFailure does not disable it
   * permanently -- documented from 12.2.
   */
  inPriorityGroup?: boolean;
}

export interface ReopenAttempt {
  t: Seconds;
  ok: boolean;
}

export interface ReopenClaims {
  reopenGates: Claim<string>;
  maxFailure: Claim<string>;
  retries: Claim<string>;
  catchup: Claim<string>;
  lagGate: Claim<string>;
  /** Only when the destination is in a priority group. */
  priorityGroup?: Claim<string>;
  /** Only where the LAGGING request has something to say. */
  lagGrace?: Claim<string>;
}

export interface ReopenModel {
  reopen: Seconds;
  maxFailure: number;
  /**
   * Failed reopen attempts that end the destination, edition-adjusted --
   * MaxFailure under 19c, MaxFailure - 1 under 26ai (ED-04); null when
   * MaxFailure is 0 (no limit). Read this for "how many retries", never
   * `maxFailure` directly.
   */
  retryLimit: number | null;
  outage: Seconds;
  rate: number;
  mode: ProtectionMode;
  edition: Edition;
  attempts: ReopenAttempt[];
  failedRetries: number;
  /** The initial error counts here. */
  failures: number;
  /** Draw the run aggregated. */
  dense: boolean;
  capped: boolean;
  disabledAt: Seconds | null;
  /** True when MaxFailure was reached but the destination re-enters service. */
  reentersWhenAccessible: boolean;
  reconnectAt: Seconds | null;
  catchupSecs: Seconds | null;
  resyncAt: Seconds | null;
  peakExposureSecs: Seconds;
  peakExposureMB: number;
  fsfoLostAt: Seconds;
  fsfoBackAt: Seconds | null;
  lagGated: boolean;
  lagGraceArmed: boolean;
  lagGraceTime: Seconds;
  lagStallAt: Seconds | null;
  lagStallMax: Seconds | null;
  horizon: Seconds;
  preRoll: Seconds;
  tickStep: Seconds;
  claims: ReopenClaims;
}

/* ---------------- claims ---------------- */

const REOPEN_GATES = documented<string>(
  'REOPEN gates eligibility; the log switch supplies the trigger',
  ['DEST.REOPEN'],
);

/* MAX_FAILURE counts consecutive attempts, but the two editions count them
   differently (ED-04): 19c keeps the 12.1 reading -- the initial error is
   not one of them, disabled until manually reenabled. 26ai's usage notes
   count the initial failure too, so MAX_FAILURE=1 is no retry at all and
   MAX_FAILURE=n gives n-1 retries; sim/dests.ts's retryLimit is the same
   arithmetic, kept in step here. */
const MAX_FAILURE_19C_CITES: CitationId[] = ['DEST.MAX_FAILURE', 'DEST.MAX_FAILURE_DISABLED_19C'];
assertCitesAllowed('MAX_FAILURE_SEMANTICS', MAX_FAILURE_19C_CITES);

const MAX_FAILURE_19C = documented<string>(
  'MAX_FAILURE counts consecutive attempts to reestablish the destination; at the limit it is disabled until it is manually reenabled',
  MAX_FAILURE_19C_CITES,
);

const MAX_FAILURE_26AI_CITES: CitationId[] = ['DEST.MAX_FAILURE', 'DEST.MAX_FAILURE_26AI'];
assertCitesAllowed('MAX_FAILURE_SEMANTICS', MAX_FAILURE_26AI_CITES);

const MAX_FAILURE_26AI = documented<string>(
  'MAX_FAILURE counts the initial failure too: MAX_FAILURE=1 makes no reactivation attempt at all, and above 1 reactivation stops once the count is reached',
  MAX_FAILURE_26AI_CITES,
);

const PRIORITY_GROUP_CITES: CitationId[] = ['DEST.GROUP_PRIORITY_REENTER'];
assertCitesAllowed('MAX_FAILURE_SEMANTICS', PRIORITY_GROUP_CITES);

const PRIORITY_GROUP = documented<string>(
  'a destination in a group re-enters service when it is found accessible',
  PRIORITY_GROUP_CITES,
);

const RETRIES = model<string>(
  'retries drawn at exact REOPEN multiples',
  'An idealization (footnote 4): the real trigger is the next log switch after the last error plus REOPEN, so the attempts fall on redo activity, not on a metronome.',
);

const CATCHUP = model<string>(
  'the gap drains at five times the generation rate',
  'Illustrative (footnote 4): the backlog shrinks at a net four times, and the apply lag is assumed near zero at t = 0 and to grow one second per second while nothing arrives.',
);

const LAG_GATE_CITES: CitationId[] = ['FSFO.LAGLIMIT_MAXAVAIL_26AI'];
assertCitesAllowed('LAG_LIMIT_MODE', LAG_GATE_CITES);

const LAG_GATE_BOUNDED = documented<string>(
  'the lag limit is the readiness gate, so fast-start failover survives until the lag crosses it',
  LAG_GATE_CITES,
);

/* The explicit sentence is maximum AVAILABILITY's. Maximum protection has no
   equivalent one, and its consequence is the opposite, so the two never share
   a claim here. */
const LAG_GATE_ZERO = documented<string>(
  'without acknowledgement from at least one synchronized standby the primary operates as if it were in maximum performance mode',
  ['MAXAVAIL.AT_LEAST_ONE'],
);

const LAG_GATE_MAXPROT = documented<string>(
  'maximum protection shuts the primary database down rather than allowing it to continue',
  ['MAXPROT.SHUTS_PRIMARY'],
);

const LAG_GRACE = documented<string>(
  'FastStartFailoverLagGraceTime is maximum performance mode behavior, and is defined only while fast-start failover is enabled',
  ['FSFO.LAGGRACETIME'],
);

/* ---------------- the model ---------------- */

/** Hard cap on drawn attempts. */
const MAXA = 500;

export function computeReopen(r: ReopenInput): ReopenModel {
  const reopen = Math.max(1, r.reopenSeconds || 0);
  const maxFailure = Math.max(0, r.maxFailure || 0);
  const outage = Math.max(0, r.outageSeconds || 0);
  const rate = Math.max(0, r.redoRateMBs || 0);
  const mode = r.mode;
  const edition: Edition = r.edition === '26ai' ? '26ai' : '19c';
  const inGroup = r.inPriorityGroup === true;

  /* Failed reopen attempts that end the destination: 19c counts them after
     the initial error, so it is MaxFailure itself; 26ai counts the initial
     failure too, so it is one fewer -- MAX_FAILURE=1 is no retry at all
     (sim/dests.ts's retryLimit, kept in step here). */
  const limit = maxFailure > 0 ? (edition === '26ai' ? maxFailure - 1 : maxFailure) : null;

  /* t = 0 is the error that closed the destination. It is the "last error"
     the interval is measured from, and it is not a reestablish attempt. */
  const attempts: ReopenAttempt[] = [{ t: 0, ok: false }];
  let failedRetries = 0;
  let reconnectAt: Seconds | null = null;
  let disabledAt: Seconds | null = null;
  let reenters = false;
  let capped = true;
  if (limit === 0 && !inGroup) {
    /* 26ai, MAX_FAILURE=1: "no attempts are made to reactivate this archive
       destination when it fails" -- disabled at the initial failure, before
       any retry is drawn. */
    disabledAt = 0;
    capped = false;
  } else {
    for (let k = 1; k <= MAXA; k++) {
      const t = k * reopen;
      if (t >= outage) {                             // the network has healed
        attempts.push({ t, ok: true });
        reconnectAt = t; capped = false; break;
      }
      attempts.push({ t, ok: false });
      failedRetries++;
      if (limit !== null && failedRetries >= limit) {
        /* The documented 12.2+ exception: a destination in a group is not
           disabled until someone reenables it -- it re-enters service the
           moment it is found accessible, so the ladder keeps running. */
        if (inGroup) { reenters = true; continue; }
        disabledAt = t; capped = false; break;
      }
    }
  }

  const failures = 1 + failedRetries;              // the initial error counts here
  const dense = failedRetries > 12 || capped;      // draw the run aggregated

  /* Illustrative catch-up: the gap drains at 5x the generation rate, so the
     backlog shrinks at a net 4x -- footnote 4. */
  const catchupSecs = reconnectAt === null ? null : reconnectAt / 4;
  const resyncAt = reconnectAt === null || catchupSecs === null ? null : reconnectAt + catchupSecs;

  /* Apply lag is assumed near 0 at t = 0 and grows one second per second
     while nothing arrives -- footnote 4. MaxAvailability needs the standby
     synchronized, and it is unsynchronized the instant the link breaks --
     unless this is 26ai and its FastStartFailoverLagLimit is non-zero, in
     which case the lag limit is what disarms it, exactly as in
     MaxPerformance. */
  const lagLimit = Math.max(0, r.lagLimitSeconds || 0);
  const availBounded = edition === '26ai' && mode === 'MAXAVAILABILITY' && lagLimit > 0;
  const lagGatedR = mode === 'MAXPERFORMANCE' || availBounded;
  const fsfoLostAt = lagGatedR ? lagLimit : 0;
  const fsfoBackAt = resyncAt;                     // null when disabled

  /* 26ai, MaxPerformance: entering the LAGGING state needs the primary's
     request granted -- by the observer or the target standby. A grace time
     asks that far ahead of the crossing, so the answer is already in hand and
     nothing pauses; with none, the primary asks at the crossing and pauses
     there until it is answered or one FastStartFailoverThreshold has gone by.
     The threshold is the bound the broker gives, not a measured duration, and
     both are null under 19c. Oracle defines the LAGGING request and its grace
     time only while fast-start failover is enabled: with no observer deployed
     nothing is armed, so nothing asks permission and nothing stalls. */
  const v26 = edition === '26ai';
  const fsfoOn = r.fsfoEnabled !== false;
  const lagGrace = Math.max(0, r.lagGraceTimeSeconds || 0);
  const maxperf = mode === 'MAXPERFORMANCE';
  const lagGraceArmed = fsfoOn && v26 && maxperf && lagGrace >= 5;
  const lagStallAt = (fsfoOn && v26 && maxperf && !lagGraceArmed) ? fsfoLostAt : null;
  const lagStallMax = lagStallAt === null ? null : Math.max(0, r.thresholdSeconds || 0);

  const marks: number[] = [reopen, outage, fsfoLostAt];
  if (lagStallAt !== null && lagStallMax !== null) marks.push(lagStallAt + lagStallMax);
  if (resyncAt !== null) marks.push(resyncAt);
  if (disabledAt !== null) marks.push(disabledAt, outage * 1.25);
  const axis = reopenAxis(Math.max(...marks));

  /* Exposure stops growing when redo flows again; otherwise it is still
     growing at the right edge of the drawing. */
  const peakExposureSecs = reconnectAt !== null ? reconnectAt : axis.horizon;

  const claims: ReopenClaims = {
    reopenGates: REOPEN_GATES,
    maxFailure: edition === '26ai' ? MAX_FAILURE_26AI : MAX_FAILURE_19C,
    retries: RETRIES, catchup: CATCHUP,
    lagGate: lagGatedR ? LAG_GATE_BOUNDED
      : mode === 'MAXPROTECTION' ? LAG_GATE_MAXPROT : LAG_GATE_ZERO,
  };
  if (inGroup) claims.priorityGroup = PRIORITY_GROUP;
  if (v26 && maxperf) claims.lagGrace = LAG_GRACE;

  return {
    reopen, maxFailure, retryLimit: limit, outage, rate, mode, edition,
    attempts, failedRetries, failures, dense, capped,
    disabledAt, reentersWhenAccessible: reenters, reconnectAt,
    catchupSecs, resyncAt,
    peakExposureSecs, peakExposureMB: rate * peakExposureSecs,
    fsfoLostAt, fsfoBackAt, lagGated: lagGatedR,
    lagGraceArmed, lagGraceTime: lagGrace, lagStallAt, lagStallMax,
    horizon: axis.horizon, preRoll: axis.preRoll, tickStep: axis.tickStep,
    claims,
  };
}

/* ---------------- inputs from a document ---------------- */

export interface ReopenFromOptions {
  /** Overrides the outage the trace shows -- the panel's own slider. */
  outageSeconds?: Seconds;
  trace?: Trace;
  inPriorityGroup?: boolean;
}

/**
 * The destination's own attributes, the configuration's mode and edition, and
 * the outage the trace shows -- with the slider free to override it.
 */
export function reopenInputFrom(
  doc: TopologyDoc, from: MemberId, to: MemberId, opts: ReopenFromOptions = {},
): ReopenInput {
  const sender = findMember(doc, from);
  const props = sender ? destProps(sender, to) : undefined;
  const fsfo = doc.config.fsfo;
  const outage = opts.outageSeconds
    ?? (opts.trace ? outageFromTrace(opts.trace, to) : null)
    ?? BOUNDS.outageSeconds.default;
  /* The broker default for MaxFailure is 1 inside a RedoRoutes priority
     group, 0 otherwise (PROP19, B26/maxfailure.html) -- defaultDestProps
     is where that default lives, so an unset destination reads the right
     one instead of always falling back to the flat, no-group default. */
  const defaults = defaultDestProps({ inGroup: opts.inPriorityGroup === true });
  return {
    reopenSeconds: props?.reopenSeconds ?? defaults.reopenSeconds,
    maxFailure: props?.maxFailure ?? defaults.maxFailure,
    outageSeconds: outage,
    redoRateMBs: doc.environment.redoRateMBs,
    mode: doc.config.protectionMode,
    lagLimitSeconds: lagLimitOf(doc),
    edition: doc.config.edition,
    lagGraceTimeSeconds: fsfo.lagGraceTimeSeconds,
    thresholdSeconds: fsfo.thresholdSeconds,
    fsfoEnabled: fsfo.state !== 'disabled' && doc.observers.length > 0,
    ...(opts.inPriorityGroup === undefined ? {} : { inPriorityGroup: opts.inPriorityGroup }),
  };
}

/** States in which the destination is receiving nothing. */
const CLOSED = new Set<string>(['down', 'unreachable', 'disabled', 'forwarding-stalled']);

/**
 * How long the destination is out, read off its lane: the first closed band
 * that ends. A band with no end is not an outage this panel can draw -- the
 * caller's slider supplies one instead.
 */
export function outageFromTrace(trace: Trace, member: MemberId): Seconds | null {
  const lane: Lane | undefined = trace.lanes.find(
    (l) => l.subject.kind === 'member' && l.subject.id === (member as string),
  );
  if (!lane) return null;
  for (const s of lane.segments) {
    if (!CLOSED.has(s.state)) continue;
    if (s.t1 === null) return null;
    return Math.max(0, s.t1 - s.t0);
  }
  return null;
}
