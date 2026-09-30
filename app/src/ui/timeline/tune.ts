/**
 * From a clock drawn on the timeline to the setting that is that clock.
 *
 * A brace over the lanes measures an interval, and for a few of them the
 * interval *is* one setting: the threshold brace is FastStartFailoverThreshold
 * seconds long, the role brace is the role transition constant, the terminal
 * recovery brace is the standby's apply lag. Those are tunable in place --
 * from the number in the settings, and from the brace's own handle -- and this
 * module is the whole of that mapping, so every place that offers it agrees on
 * which clock is which setting.
 *
 * A brace whose span is not its setting's value is not tunable, and says so by
 * having no tune: the run shortened the interval (a catch-up capped by the
 * command's own time, a threshold that started before the failure), and a drag
 * that moved the setting one for one would then move the brace by something
 * else. A clock is only tunable where its length IS the setting.
 *
 * The edits go through the inspector's named setters, so the undo sentence and
 * the coalesce key are the ones the rail's forms produce, and every edit made
 * here marks the document it produced (`markTuned`, run.ts) so the axis holds.
 */

import { batch } from '@preact/signals';
import { clamp, isDatabase } from '@/engine';
import type { BoundKey, DatabaseMember, MemberId, TopologyDoc, Trace } from '@/engine';
import { setApplyLag, setFsfoThreshold, setRoleTransition } from '../inspector/edits';
import { markTuned } from './run';

/* `clientTiming` is a connect-string field (ui/inspector/client-timing.ts) that the
   small timeline offers a grip for; `applyTune` knows the first three only. */
export type TuneId = 'threshold' | 'roleTransition' | 'applyLag' | 'clientTiming';

export interface Tune {
  id: TuneId;
  bound: BoundKey;
  /** The setting's current value, in the bound's unit (seconds for all three today). */
  value: number;
  /** The standby whose apply lag this is; present for `applyLag` only. */
  member?: MemberId;
  /** The setting's name as the inspector spells it. */
  name: string;
  /** An Oracle property name (set in mono) rather than this page's words. */
  mono: boolean;
}

/** How closely a brace's length must match its setting for the two to be one clock. */
const SAME = 0.05;

/** The standby the run promoted, when it is a database the document holds. */
export function promotedDatabase(doc: TopologyDoc, trace: Trace | null): DatabaseMember | null {
  const id = trace?.facts.newPrimary ?? null;
  if (id === null) return null;
  const m = doc.members.find((x) => x.id === id);
  return m !== undefined && isDatabase(m) ? m : null;
}

/**
 * The standby the strip tunes: the one the run promoted, else the first of
 * `FastStartFailoverTarget` when that is a list, else the first physical or
 * logical standby. Null where there is none. Never a primary: it applies no
 * redo, and its apply lag is a setting the rail greys.
 */
export function tunedStandby(doc: TopologyDoc, trace: Trace | null): DatabaseMember | null {
  const promoted = promotedDatabase(doc, trace);
  if (promoted !== null && promoted.role !== 'primary') return promoted;
  const target = doc.config.fsfo.target;
  if (target.kind === 'list') {
    for (const id of target.members) {
      const m = doc.members.find((x) => x.id === id);
      if (m !== undefined && isDatabase(m) && m.role !== 'primary') return m;
    }
  }
  return doc.members.filter(isDatabase).find((m) => m.role === 'physical' || m.role === 'logical') ?? null;
}

const thresholdTune = (doc: TopologyDoc): Tune => ({
  id: 'threshold', bound: 'thresholdSeconds', value: doc.config.fsfo.thresholdSeconds,
  name: 'FastStartFailoverThreshold', mono: true,
});

const roleTune = (doc: TopologyDoc): Tune => ({
  id: 'roleTransition', bound: 'roleTransitionSeconds', value: doc.environment.roleTransitionSeconds,
  name: 'Role transition', mono: false,
});

function applyLagTune(doc: TopologyDoc, trace: Trace): Tune | null {
  const m = promotedDatabase(doc, trace);
  if (m === null) return null;
  return {
    id: 'applyLag', bound: 'applyLagSeconds', value: m.applyLagSeconds, member: m.id,
    name: 'Apply lag', mono: false,
  };
}

/** The setting a brace measures, or null when the brace is not one setting or its span is not that setting's value. */
export function tuneForBrace(
  doc: TopologyDoc, trace: Trace, brace: { key: string; a: number; b: number },
): Tune | null {
  let tune: Tune | null;
  switch (brace.key) {
    case 'threshold':
    case 'abort':
    case 'stall-threshold':
      tune = thresholdTune(doc);
      break;
    case 'role':
    case 'sw-role':
      tune = roleTune(doc);
      break;
    case 'recovery':
    case 'sw-catchup':
      tune = applyLagTune(doc, trace);
      break;
    default:
      tune = null;
  }
  if (tune === null) return null;
  return Math.abs((brace.b - brace.a) - tune.value) <= SAME ? tune : null;
}

/**
 * Any edit made from Simulate's own chrome, marked as a tuning edit: the
 * document it produced keeps the axis the run was on while the run still fits
 * it (run.ts). The setter and the mark share one batch, so nothing draws in
 * between and refits.
 */
export function tuned(edit: () => void): void {
  batch(() => { edit(); markTuned(); });
}

/**
 * Set the setting a clock is: clamped to its bound, through the inspector's
 * named setter, and marked as tuned.
 */
export function applyTune(t: Tune, value: number): void {
  const v = clamp(t.bound, value);
  tuned(() => {
    if (t.id === 'threshold') setFsfoThreshold(v);
    else if (t.id === 'roleTransition') setRoleTransition(v);
    else if (t.member !== undefined) setApplyLag(t.member, v);
  });
}
