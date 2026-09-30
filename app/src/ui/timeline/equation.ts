/**
 * The run's headline as a sum, for the two outcomes that are one.
 *
 * A failover is open at t = threshold + command in flight + terminal recovery
 * + role change; a switchover's read-write downtime is conversion + catch-up +
 * role change. The braces the timeline draws are those terms, so the headline
 * can say it as an equation whose terms are the braces' lengths -- and the
 * terms that ARE a setting (`tuneForBrace`) are numbers the reader can edit.
 *
 * Pure: braces and facts in, terms out. It never shows an equation that does
 * not add up: where the braces' lengths and the total disagree by more than a
 * rounding, the remainder is a term of its own ("other") when it is positive,
 * and the whole equation is dropped -- the sentence stays -- when it is not.
 */

import type { TopologyDoc, Trace } from '@/engine';
import { fmt } from './build';
import type { BraceInput, Facts } from './build';
import { tuneForBrace } from './tune';
import type { Tune } from './tune';

export interface EquationTerm {
  /** The brace's key; `start` and `other` for the two terms that are not a brace. */
  key: string;
  seconds: number;
  /** Set in mono where it is an Oracle property name. */
  label: string;
  mono: boolean;
  /** The setting this term is, when its length IS that setting's value; else the term is text. */
  tune: Tune | null;
  /** The brace's own name and reading, for the tooltip. */
  title: string;
}

export interface Equation {
  /** What the terms add up to, as the headline says it: `New primary open read-write at t = 45 s`. */
  lead: string;
  terms: EquationTerm[];
}

/** How closely the terms must add up to the total. */
const SAME = 0.05;

/** The short word for each brace, from the words the captions already use. */
const LABEL: Record<string, { label: string; mono: boolean }> = {
  threshold: { label: 'FastStartFailoverThreshold', mono: true },
  detect: { label: 'ping detection', mono: false },
  nethop: { label: 'command in flight', mono: false },
  recovery: { label: 'terminal recovery', mono: false },
  role: { label: 'role change + open', mono: false },
  'sw-convert': { label: 'conversion', mono: false },
  'sw-catchup': { label: 'catch-up', mono: false },
  'sw-role': { label: 'role change + open', mono: false },
};

function term(
  doc: TopologyDoc, trace: Trace, b: BraceInput,
): EquationTerm {
  const words = LABEL[b.key] ?? { label: b.name, mono: b.mono };
  return {
    key: b.key,
    seconds: b.b - b.a,
    label: words.label,
    mono: words.mono,
    tune: tuneForBrace(doc, trace, b),
    title: `${b.name} — ${b.val}`,
  };
}

const plain = (key: string, label: string, seconds: number, title: string): EquationTerm => ({
  key, seconds, label, mono: false, tune: null, title,
});

/** Close the gap between the terms and the total with a term of its own, or give up. */
function balanced(terms: EquationTerm[], total: number): EquationTerm[] | null {
  const gap = total - terms.reduce((n, t) => n + t.seconds, 0);
  if (Math.abs(gap) <= SAME) return terms;
  if (gap < 0) return null;
  return [...terms, plain('other', 'other', gap, 'Time the run spends between these steps')];
}

export function equationOf(
  doc: TopologyDoc, trace: Trace, braces: readonly BraceInput[],
): Equation | null {
  const f = trace.facts as Facts;
  const pick = (...keys: string[]): BraceInput[] =>
    keys.flatMap((k) => braces.filter((b) => b.key === k).slice(0, 1));

  if (f.outcome === 'failover') {
    if (f.blocked || f.tOpen === null) return null;
    const bars = [...pick('detect', 'threshold').slice(0, 1), ...pick('nethop', 'recovery', 'role')];
    const first = bars[0];
    if (first === undefined) return null;
    const terms = bars.map((b) => term(doc, trace, b));
    /* The clock is measured from the first event, and the first term may
       start later than that: say where it started, or the sum is short. */
    const start = first.a;
    const all = start > SAME
      ? [plain('start', 'clock starts', start, `The first clock starts at t = ${fmt(start)} s`), ...terms]
      : terms;
    const done = balanced(all, f.tOpen);
    return done === null ? null : { lead: `New primary open read-write at t = ${fmt(f.tOpen)} s`, terms: done };
  }

  if (f.outcome === 'switchover') {
    const sw = f.switchover;
    if (!sw || sw.blocked || sw.downtime === null) return null;
    const bars = pick('sw-convert', 'sw-catchup', 'sw-role');
    if (bars.length === 0) return null;
    /* The downtime is measured from the moment the primary goes down, which is
       where the first of these begins: no "clock starts" term. */
    const done = balanced(bars.map((b) => term(doc, trace, b)), sw.downtime);
    return done === null ? null : { lead: `Read-write downtime ≈ ${fmt(sw.downtime)} s`, terms: done };
  }

  return null;
}
