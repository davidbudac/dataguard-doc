/**
 * One grip on the end of a clock: drag it to change the setting that clock is.
 *
 * The sibling of `EventDrag` (the same pointer capture, the same px-per-second,
 * the same slider semantics) with one difference in kind: an event's drag
 * previews and commits once on drop, while a setting changes on every step --
 * the run recomputes as the grip moves, and the axis is held for the whole
 * gesture (`tuneDragging`, run.ts) so the bar that gets longer is seen getting
 * longer. The edits share the inspector's coalesce key, so the drag is one undo
 * entry however many steps it took.
 *
 * The element must keep its identity across the re-renders those edits cause,
 * or the browser drops the pointer capture mid-drag: callers key it on the
 * brace's own key, never on the value.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { BOUNDS, clamp } from '@/engine';
import type { TimelineModel } from './build';
import { fmt, spoken } from './build';
import { tuneDragging } from './run';
import type { Tune } from './tune';
import { tuneLabel } from './tune-handles';
import type { TuneHandle } from './tune-handles';

export interface TuneDragProps {
  handle: TuneHandle;
  /** The clock's end, in the drawing's x. */
  x: number;
  /** The top of the grip, and its height. */
  y: number;
  h: number;
  model: TimelineModel;
  onTune: (t: Tune, value: number) => void;
  /** A gesture began: pause playback, clear the tooltip. */
  onStart?: () => void;
  /** Which of a handle's two grips this is; only a class hook for the stylesheet. */
  where: 'brace' | 'lane';
}

/** Half the width of the invisible target around the grip. */
const HIT = 7;
/** The readout is centred over the grip unless that would leave the drawing. */
const READOUT_EDGE = 26;

export function TuneDrag({ handle, x: clockEnd, y, h, model, onTune, onStart, where }: TuneDragProps) {
  const { tune } = handle;
  /* A clock that runs past the held axis ends off the drawing; its grip waits at the edge. */
  const x = Math.min(clockEnd, model.scale.plotR);
  const b = BOUNDS[tune.bound];
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; clientX: number; from: number; last: number; pxPerSecond: number } | null>(null);
  const finish = (): void => {
    drag.current = null;
    tuneDragging.value = false;
    setDragging(false);
  };
  /* Leaving mid-drag (the brace went away under it, the view was left) must not
     leave the axis held for good. */
  useEffect(() => () => { if (drag.current !== null) { drag.current = null; tuneDragging.value = false; } }, []);

  const down = (e: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (e.button !== 0) return;
    /* A press on the plot seeks; this one is not a seek. */
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const width = el.ownerSVGElement?.getBoundingClientRect().width ?? model.width;
    const pxPerSecond = (model.scale.x(1) - model.scale.x(0)) * (width > 0 ? width / model.width : 1);
    if (!(pxPerSecond > 0)) return;
    drag.current = { pointer: e.pointerId, clientX: e.clientX, from: tune.value, last: tune.value, pxPerSecond };
    tuneDragging.value = true;
    el.focus();
    el.setPointerCapture?.(e.pointerId);
    onStart?.();
    setDragging(true);
  };
  const move = (e: JSX.TargetedPointerEvent<SVGGElement>): void => {
    const d = drag.current;
    if (d === null || d.pointer !== e.pointerId) return;
    e.stopPropagation();
    const v = clamp(tune.bound, d.from + (e.clientX - d.clientX) / d.pxPerSecond);
    if (v === d.last) return;
    d.last = v;
    onTune(tune, v);
  };
  const up = (e: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (drag.current?.pointer !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    finish();
  };
  const key = (e: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    if (drag.current !== null) return;
    const step = e.shiftKey ? b.step * 5 : b.step;
    let next: number;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': next = tune.value - step; break;
      case 'ArrowRight': case 'ArrowUp': next = tune.value + step; break;
      case 'Home': next = b.min; break;
      case 'End': next = b.max; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    onStart?.();
    const v = clamp(tune.bound, next);
    if (v !== tune.value) onTune(tune, v);
  };

  const anchor = x < READOUT_EDGE ? 'start' : x > model.width - READOUT_EDGE ? 'end' : 'middle';
  return (
    <g
      class={`tl-tune is-${where}${dragging ? ' is-dragging' : ''}`}
      data-tune={tune.id}
      role="slider"
      tabindex={0}
      aria-label={tuneLabel(tune)}
      aria-valuemin={b.min}
      aria-valuemax={b.max}
      aria-valuenow={spoken(tune.value)}
      aria-valuetext={`${fmt(tune.value)} seconds`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={finish}
      onKeyDown={key}
    >
      <title>{handle.title}</title>
      <rect class="tl-tune-hit" x={x - HIT} y={y} width={2 * HIT} height={h} rx={4} />
      <rect class="tl-tune-grip" x={x - 2} y={y + 2} width={4} height={Math.max(2, h - 4)} rx={2} />
      {dragging ? (
        <text class="tl-event-time t-mono" x={x} y={y - 4} text-anchor={anchor}>{`${fmt(tune.value)} s`}</text>
      ) : null}
    </g>
  );
}
