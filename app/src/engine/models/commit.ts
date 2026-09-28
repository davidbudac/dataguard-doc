/**
 * The anatomy of one commit, in milliseconds -- engine design SS6, ported from
 * the published fragment's COMMITMODEL block and generalised from one
 * destination to the primary's N direct legs.
 *
 * LogXptMode maps to a pair of destination attributes:
 *   SYNC     = SYNC  + AFFIRM    the destination acknowledges only after it
 *                                wrote the redo to the standby redo log
 *   FASTSYNC = SYNC  + NOAFFIRM  it acknowledges on receipt, before that write
 *   ASYNC    = ASYNC + NOAFFIRM  the transaction never waits for it
 *
 * The documented SYNC commit path starts the remote write before LGWR issues
 * the local online-redo-log write and only then waits for the remote write to
 * complete. The two therefore overlap, and a commit costs the longer of them
 * -- max(localWrite, ackPath) -- not their sum. Oracle never calls this
 * "parallel"; the step ordering is the whole evidence, and the `log file
 * parallel write` wait event is not evidence at all.
 *
 * A far sync leg TERMINATES the commit: with SYNC into the far sync instance
 * "all committed redo resides on disk at the far sync instance", and the
 * onward hop to the terminal standby is ASYNC and outside the transaction.
 */

import { assertCitesAllowed } from '../citations';
import type { CitationId } from '../citations';
import type { Edition, MemberId, Millis } from '../ids';
import type { Claim } from '../types/claims';
import { documented, model } from '../types/claims';
import type { MemberKind, ProtectionMode, XptMode } from '../types/topology';
import type { CommitAxisSpec } from './axis';
import { commitAxis } from './axis';

/** One destination the primary ships to directly. */
export interface CommitLeg {
  to: MemberId;
  /** A far sync leg ends the commit; the onward ASYNC hop is not a leg. */
  kind: MemberKind;
  xpt: XptMode;
  rttMs: Millis;
  /** The standby (or far sync) redo log write AFFIRM waits for. */
  destWriteMs: Millis;
}

export interface CommitLegResult extends CommitLeg {
  oneWayMs: Millis;
  /** What the commit waits for on this leg, end to end; null under ASYNC. */
  ackPathMs: Millis | null;
  ackAtMs: Millis | null;
  /** When the destination's own redo log write finishes. */
  srlDoneMs: Millis;
  /** ASYNC only: when the redo reaches the destination anyway. */
  shipDoneMs: Millis | null;
  /** The transaction does not wait for this destination. */
  exposed: boolean;
  /** The commit waits on this leg. */
  waits: boolean;
  /** SYNC minus FASTSYNC at these settings, on this leg. */
  syncFastsyncDeltaMs: Millis;
  /** The commit ends here: a far sync leg is the end of the commit's story. */
  terminatesCommit: boolean;
}

/** How a commit with more than one SYNC leg waits -- a model toggle. */
export type CommitWaitPolicy = 'all' | 'first-ack';

export interface CommitInput {
  edition?: Edition;
  mode: ProtectionMode;
  localWriteMs: Millis;
  legs: CommitLeg[];
  /** Default 'all'. */
  waitPolicy?: CommitWaitPolicy;
}

export interface CommitClaims {
  maxNotSum: Claim<string>;
  affirm: Claim<string>;
  /** Only when a far sync leg is present. */
  farSync?: Claim<string>;
  /** Only when more than one leg is waited on. */
  multiSync?: Claim<string>;
  /** Only when ASYNC meets MaxAvailability. */
  modeNote?: Claim<string>;
}

export interface CommitModel {
  edition: Edition;
  mode: ProtectionMode;
  localWriteMs: Millis;
  legs: CommitLegResult[];
  waitPolicy: CommitWaitPolicy;
  /** The leg the commit actually waits for, under this policy. */
  governing: CommitLegResult | null;
  /** The governing leg's ack path; null when nothing is waited on. */
  ackPathMs: Millis | null;
  ackAtMs: Millis | null;
  commitMs: Millis;
  standbyWaitMs: Millis;
  syncFastsyncDeltaMs: Millis;
  /** Nothing was waited on: the commit returns before the redo is anywhere else. */
  exposed: boolean;
  modeConflict: boolean;
  modeAllowed26: boolean;
  horizonMs: Millis;
  preRollMs: Millis;
  tickStepMs: Millis;
  claims: CommitClaims;
}

/* ---------------- claims ---------------- */

const MAX_NOT_SUM_CITES: CitationId[] = ['COMMIT.THIRTEEN_STEPS'];
assertCitesAllowed('COMMIT_MAX_NOT_SUM', MAX_NOT_SUM_CITES);

const MAX_NOT_SUM = documented<string>(
  'a commit costs max(local write, remote ack path), never their sum',
  MAX_NOT_SUM_CITES,
);

const AFFIRM = documented<string>(
  'AFFIRM acknowledges received redo AFTER writing it to the standby redo log; NOAFFIRM before that write',
  ['XPT.LOGXPTMODE_VALUES', 'XPT.AFFIRM_SEMANTICS'],
);

const FAR_SYNC = documented<string>(
  'the far sync hop terminates the commit, and the hop onward to the target standby is ASYNC',
  ['FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC', 'FSFO.FARSYNC_XPT'],
);

const MULTI_SYNC_ALL_CITES: CitationId[] = ['XPT.DATA_GUARD_SYNC_LATENCY'];
assertCitesAllowed('COMMIT_MAX_NOT_SUM', MULTI_SYNC_ALL_CITES);

const MULTI_SYNC_ALL = documented<string>(
  'the commit waits for every synchronous leg',
  MULTI_SYNC_ALL_CITES,
  "DATA_GUARD_SYNC_LATENCY defaults to 0, which is documented to mean the LGWR waits up to NET_TIMEOUT for each SYNC standby destination in turn -- this page's default.",
);

const MULTI_SYNC_FIRST = model<string>(
  'the commit waits for the first acknowledgement',
  "A non-zero DATA_GUARD_SYNC_LATENCY (XPT.DATA_GUARD_SYNC_LATENCY) bounds how much longer the LGWR waits past the first acknowledgement, rather than returning at it; this toggle's immediate return at the first ack is this page's simplification of that documented behaviour.",
  MULTI_SYNC_ALL_CITES,
);

const MODE_CONFLICT = documented<string>(
  'broker Table 4-2 lists SYNC and FASTSYNC for maximum availability',
  ['XPT.TABLE_4_2'],
);

const MODE_ALLOWED_26_CITES: CitationId[] = ['XPT.MAXAVAIL_ASYNC_26AI'];
assertCitesAllowed('MAXAVAIL_TRANSPORTS', MODE_ALLOWED_26_CITES);

const MODE_ALLOWED_26 = documented<string>(
  '26ai lists SYNC or FASTSYNC or ASYNC for a maximum availability target',
  MODE_ALLOWED_26_CITES,
);

/* ---------------- the model ---------------- */

const nonNeg = (n: number | undefined): number => Math.max(0, n ?? 0);

export function computeCommit(input: CommitInput): CommitModel {
  const edition: Edition = input.edition === '26ai' ? '26ai' : '19c';
  const lw = nonNeg(input.localWriteMs);
  const waitPolicy: CommitWaitPolicy = input.waitPolicy === 'first-ack' ? 'first-ack' : 'all';

  const legs: CommitLegResult[] = input.legs.map((leg) => {
    const rtt = nonNeg(leg.rttMs);
    const dw = nonNeg(leg.destWriteMs);
    const oneWay = rtt / 2;

    /* What the commit waits for on the destination side, end to end. */
    const ackPathMs = leg.xpt === 'SYNC' ? oneWay + dw + oneWay
      : leg.xpt === 'FASTSYNC' ? oneWay + oneWay
        : null;
    const shipDoneMs = leg.xpt === 'ASYNC' ? lw + oneWay : null;
    const srlDoneMs = shipDoneMs === null ? oneWay + dw : shipDoneMs + dw;

    /* SYNC minus FASTSYNC at these settings, by formula rather than recursion:
       max(lw, rtt + dw) - max(lw, rtt). It equals the destination redo log
       write only while the round trip is the bottleneck. */
    const syncFastsyncDeltaMs = Math.max(lw, rtt + dw) - Math.max(lw, rtt);

    return {
      ...leg, rttMs: rtt, destWriteMs: dw, oneWayMs: oneWay,
      ackPathMs, ackAtMs: ackPathMs, srlDoneMs, shipDoneMs,
      exposed: leg.xpt === 'ASYNC', waits: ackPathMs !== null,
      syncFastsyncDeltaMs,
      terminatesCommit: leg.kind === 'farsync' && ackPathMs !== null,
    };
  });

  const waited = legs.filter((l) => l.waits);
  let governing: CommitLegResult | null = null;
  for (const l of waited) {
    if (governing === null) { governing = l; continue; }
    const g = governing.ackPathMs as number;
    const c = l.ackPathMs as number;
    if (waitPolicy === 'all' ? c > g : c < g) governing = l;
  }

  const ackPathMs = governing === null ? null : governing.ackPathMs;
  const commitMs = ackPathMs === null ? lw : Math.max(lw, ackPathMs);
  const standbyWaitMs = Math.max(0, commitMs - lw);
  const syncFastsyncDeltaMs = (governing ?? legs[0])?.syncFastsyncDeltaMs ?? 0;

  /* ASYNC to the terminal standby is what the far sync prerequisite REQUIRES
     -- "the far sync instance transport mode must be set to either SYNC or
     FASTSYNC and the target standby database transport mode must be set to
     ASYNC" -- so a commit carried by a synchronous far sync leg is never a
     mode conflict on account of the hop behind it. */
  const syncFarSync = legs.some((l) => l.kind === 'farsync' && l.waits);
  const asyncToDatabase = !syncFarSync
    && legs.some((l) => l.kind === 'database' && l.xpt === 'ASYNC');
  /* "the broker verifies that there is at least one standby database in the
     configuration that can support the desired grade of protection"
     (MODE.AT_LEAST_ONE_SUPPORTS) -- a configuration-level check, so an ASYNC
     leg beside a SYNC or FASTSYNC one is never the mismatch by itself. */
  const hasQualifyingLeg = syncFarSync
    || legs.some((l) => l.kind === 'database' && (l.xpt === 'SYNC' || l.xpt === 'FASTSYNC'));
  const maxavail = input.mode === 'MAXAVAILABILITY';
  const modeConflict = asyncToDatabase && !hasQualifyingLeg && maxavail && edition !== '26ai';
  const modeAllowed26 = asyncToDatabase && maxavail && edition === '26ai';

  /* Axis. Guard the all-zero case so the ticks still have somewhere to go. */
  const marks: number[] = [lw, commitMs];
  for (const l of legs) {
    marks.push(l.srlDoneMs);
    if (l.ackAtMs !== null) marks.push(l.ackAtMs);
    if (l.shipDoneMs !== null) marks.push(l.shipDoneMs);
  }
  const axis: CommitAxisSpec = commitAxis(Math.max(...marks, 0));

  const claims: CommitClaims = { maxNotSum: MAX_NOT_SUM, affirm: AFFIRM };
  if (legs.some((l) => l.kind === 'farsync')) claims.farSync = FAR_SYNC;
  if (waited.length > 1) claims.multiSync = waitPolicy === 'all' ? MULTI_SYNC_ALL : MULTI_SYNC_FIRST;
  if (modeConflict) claims.modeNote = MODE_CONFLICT;
  else if (modeAllowed26) claims.modeNote = MODE_ALLOWED_26;

  return {
    edition, mode: input.mode, localWriteMs: lw, legs, waitPolicy, governing,
    ackPathMs, ackAtMs: ackPathMs, commitMs, standbyWaitMs, syncFastsyncDeltaMs,
    exposed: waited.length === 0,
    modeConflict, modeAllowed26,
    horizonMs: axis.horizonMs, preRollMs: axis.preRollMs, tickStepMs: axis.tickStepMs,
    claims,
  };
}
