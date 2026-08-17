/**
 * Axis arithmetic, ported verbatim from the published fragment's MODEL,
 * COMMITMODEL and REOPENMODEL blocks. The ladders and the horizon rounding are
 * drawing decisions, not Oracle facts, and `site/test.mjs` pins them.
 */

import type { Millis, Seconds } from '../ids';

/** Seconds axis: the failover, switchover and connect-string drawings. */
export function pickTickStep(span: number): Seconds {
  const steps = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
  for (const s of steps) { if (span / s <= 9) return s; }
  return steps[steps.length - 1] as number;
}

/** Millisecond axis: readable from a 0 ms round trip up to 100 ms. */
export function cmTickStep(span: number): Millis {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const s of steps) { if (span / s <= 9) return s; }
  return steps[steps.length - 1] as number;
}

/** Minutes-scale axis: the reopen panel. */
export function rpTickStep(span: number): Seconds {
  const steps = [15, 30, 60, 120, 300, 600];
  for (const s of steps) { if (span / s <= 9) return s; }
  return steps[steps.length - 1] as number;
}

export interface AxisSpec {
  horizon: Seconds;
  preRoll: Seconds;
  tickStep: Seconds;
}

/** The seconds axis: `raw = end * 1.12 + max(2, end * 0.06)`, rounded up to a tick. */
export function secondsAxis(end: number): AxisSpec {
  const raw = end * 1.12 + Math.max(2, end * 0.06);
  const tickStep = pickTickStep(raw);
  const horizon = Math.max(tickStep, Math.ceil(raw / tickStep) * tickStep);
  return { horizon, preRoll: preRollFor(horizon), tickStep };
}

/** The fixed 60 s axis every "nothing happens" branch draws. */
export function fixedAxis(seconds = 60): AxisSpec {
  const tickStep = pickTickStep(seconds);
  const horizon = Math.max(tickStep, Math.ceil(seconds / tickStep) * tickStep);
  return { horizon, preRoll: preRollFor(horizon), tickStep };
}

export const preRollFor = (horizon: Seconds): Seconds =>
  Math.max(2, Math.min(10, Math.round(horizon * 0.2)));

export interface CommitAxisSpec {
  horizonMs: Millis;
  preRollMs: Millis;
  tickStepMs: Millis;
}

/** The commit axis: `raw = max(4, end * 1.18)`, and a 8% pre-roll. */
export function commitAxis(endMs: number): CommitAxisSpec {
  const raw = Math.max(4, endMs * 1.18);
  const tickStepMs = cmTickStep(raw);
  const horizonMs = Math.max(tickStepMs, Math.ceil(raw / tickStepMs) * tickStepMs);
  return { horizonMs, preRollMs: Math.max(1, Math.round(horizonMs * 0.08)), tickStepMs };
}

/** The reopen axis: a 15 s floor on the margin and a quarter-minute pre-roll grid. */
export function reopenAxis(end: number): AxisSpec {
  const raw = end * 1.12 + Math.max(15, end * 0.06);
  const tickStep = rpTickStep(raw);
  const horizon = Math.max(tickStep, Math.ceil(raw / tickStep) * tickStep);
  const preRoll = Math.min(180, Math.max(15, Math.round((horizon * 0.12) / 15) * 15));
  return { horizon, preRoll, tickStep };
}

/**
 * The failover horizon: whatever is actually drawn, plus a margin. Marks are
 * the initiate clock, the open (or the blocked stub), the threshold when the
 * ping properties are not set, and the abort when there is one.
 */
export function failoverAxis(marks: {
  initiate: Seconds;
  tOpen: Seconds | null;
  blocked: boolean;
  threshold: Seconds;
  pingSet: boolean;
  abort: Seconds | null;
}): AxisSpec {
  const ends: number[] = [marks.initiate];
  ends.push(marks.blocked || marks.tOpen === null
    ? marks.initiate * 1.5 + 6
    : marks.tOpen);
  if (!marks.pingSet) ends.push(marks.threshold);
  if (marks.abort !== null) ends.push(marks.abort);
  return secondsAxis(Math.max(...ends));
}
