/**
 * The run's headline, above the lanes.
 *
 * For most outcomes it is a sentence, and stays one. For the two that are a
 * sum -- a failover's open time and a switchover's downtime -- it is the
 * equation (`equationOf`): `New primary open read-write at t = 45 s = 30 s
 * FastStartFailoverThreshold + 15 s role change + open`, where every term that
 * is a setting is a number box. Type in it, arrow it, or press its label and
 * drag sideways to scrub it; the timeline under it follows, on the axis it
 * already had (run.ts), so the bar that shrinks is seen shrinking.
 *
 * Where nothing can be edited -- Learn, a printed page, the narrow read-only
 * viewer -- there is no `onTune`, and the sentence is drawn exactly as before.
 * The headline is one sticky line whose height is budgeted, so the boxes are
 * sized to sit inside it without changing it (split.css, `.tl-eq`).
 */

import { Fragment } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { BOUNDS, clamp } from '@/engine';
import { fmt } from './build';
import type { TimelineCaption } from './build';
import type { Equation, EquationTerm } from './equation';
import { tuneDragging } from './run';
import type { Tune } from './tune';
import { TuneNumber } from './TuneNumber';

export interface RunHeadlineProps {
  caption: TimelineCaption;
  equation: Equation | null;
  /** Present where the reader may tune; without it the sentence is all there is. */
  onTune?: (t: Tune, value: number) => void;
}

/** One step of the setting per this many pixels of sideways drag. */
const PX_PER_STEP = 6;

/** The label of an editable term: press and drag sideways to scrub the value. */
function Scrub({ tune, onTune, children }: {
  tune: Tune; onTune: (t: Tune, v: number) => void; children: string;
}) {
  const drag = useRef<{ pointer: number; x: number; from: number; last: number } | null>(null);
  const b = BOUNDS[tune.bound];
  const end = (): void => { drag.current = null; tuneDragging.value = false; };
  /* Leaving mid-drag (the run changed shape under it, the view was left) must
     not leave the axis held for good. */
  useEffect(() => end, []);
  const down = (e: JSX.TargetedPointerEvent<HTMLSpanElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointer: e.pointerId, x: e.clientX, from: tune.value, last: tune.value };
    tuneDragging.value = true;
  };
  const move = (e: JSX.TargetedPointerEvent<HTMLSpanElement>): void => {
    const d = drag.current;
    if (d === null || d.pointer !== e.pointerId) return;
    e.stopPropagation();
    const steps = Math.trunc((e.clientX - d.x) / PX_PER_STEP);
    const v = clamp(tune.bound, d.from + steps * b.step);
    if (v === d.last) return;
    d.last = v;
    onTune(tune, v);
  };
  const up = (e: JSX.TargetedPointerEvent<HTMLSpanElement>): void => {
    if (drag.current?.pointer !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    end();
  };
  return (
    <span
      class={`tl-eq-l is-scrub${tune.mono ? ' mono' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={end}
    >
      {children}
    </span>
  );
}

function Term({ term, onTune }: { term: EquationTerm; onTune: (t: Tune, v: number) => void }) {
  const tune = term.tune;
  if (term.key === 'start') {
    return <span class="tl-eq-t" title={term.title}>t = {fmt(term.seconds)} s</span>;
  }
  if (tune === null) {
    return (
      <span class="tl-eq-t" title={term.title}>
        {fmt(term.seconds)} s <span class={term.mono ? 'tl-eq-l mono' : 'tl-eq-l'}>{term.label}</span>
      </span>
    );
  }
  const b = BOUNDS[tune.bound];
  return (
    <span class="tl-eq-t is-edit" title={`${term.title}\nAllowed: ${b.min}–${b.max} s.`}>
      <TuneNumber
        class="tl-eq-in"
        bound={tune.bound}
        value={tune.value}
        label={tune.name}
        onValue={(v) => onTune(tune, v)}
      />
      {' s '}
      <Scrub tune={tune} onTune={onTune}>{term.label}</Scrub>
    </span>
  );
}

export function RunHeadline({ caption, equation, onTune }: RunHeadlineProps) {
  const tone = caption.tone === 'ink' ? '' : ` ${caption.tone}`;
  if (equation === null || onTune === undefined) {
    return <p class={`tl-headline${tone}`} title={caption.text}>{caption.text}</p>;
  }
  return (
    <p class={`tl-headline tl-eq${tone}`} title={caption.text}>
      <span class="tl-eq-lead">{equation.lead}</span>
      <span class="tl-eq-op"> = </span>
      {equation.terms.map((t, i) => (
        <Fragment key={t.key}>
          {i === 0 ? null : <span class="tl-eq-op"> + </span>}
          <Term term={t} onTune={onTune} />
        </Fragment>
      ))}
    </p>
  );
}
