/**
 * The scrubber: a vertical rule at `tNow`, a handle to drag it, and the
 * keyboard contract from ui.md SS5 -- arrows 1 s, Shift 0.1 s, Home/End,
 * Space to play or pause, `.` and `,` to step between state changes.
 *
 * It owns no state. `tNow` arrives as a prop and every gesture leaves through
 * `onSeek`, so the shell can keep one signal and this component can re-render
 * on its own without rebuilding the model.
 */

import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { fmt } from './build';
import type { TimelineModel } from './build';

export interface PlayheadProps {
  model: TimelineModel;
  tNow: number;
  playing?: boolean;
  onSeek?: (t: number) => void;
  onTogglePlay?: () => void;
}

/** The next state change strictly after `t`, or null at the end. */
export function nextChange(changes: readonly number[], t: number): number | null {
  for (const c of changes) if (c > t + 1e-6) return c;
  return null;
}

/** The previous state change strictly before `t`, or null at the start. */
export function prevChange(changes: readonly number[], t: number): number | null {
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i] as number;
    if (c < t - 1e-6) return c;
  }
  return null;
}

export function Playhead({ model, tNow, playing = false, onSeek, onTogglePlay }: PlayheadProps) {
  const { scale } = model;
  const t = scale.clampT(tNow);
  const x = Math.round(scale.x(t) * 10) / 10;
  const top = model.laneTop - 12;
  const bottom = model.axisY;
  /* The badge sits to the right of the line unless an event marker's label
     starts there -- t = 0 is where the first injected event is, and its
     numbered label must not disappear under "t = 0" -- in which case it flips
     to the left. */
  const flip = model.markers.some((m) =>
    m.index !== null && m.labelAnchor === 'start' && m.labelX >= x - 8 && m.labelX <= x + 64);

  /* Reaching for the playhead means "let me look at this moment", so it stops
     the run: playback owns the playhead while it is running (see playback.ts)
     and would otherwise overwrite the seek on the next frame. */
  const takeOver = (): void => { if (playing && onTogglePlay) onTogglePlay(); };

  const drag = useRef<{ pointer: number; clientX: number; at: number; pxPerSecond: number; moved: boolean } | null>(null);
  const onPointerDown = (e: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (!onSeek || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const width = el.ownerSVGElement!.getBoundingClientRect().width;
    drag.current = { pointer: e.pointerId, clientX: e.clientX, at: t, moved: false,
      pxPerSecond: scale.pxPerSecond * (width > 0 ? width / model.width : 1) };
    el.focus();
    el.setPointerCapture(e.pointerId);
    takeOver();
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<SVGGElement>): void => {
    const d = drag.current;
    if (!onSeek || !d || d.pointer !== e.pointerId) return;
    e.stopPropagation();
    // Preserve the grab offset, including when dragging by the time badge.
    if (e.clientX !== d.clientX || d.moved) {
      d.moved = true;
      onSeek(scale.clampT(d.at + (e.clientX - d.clientX) / d.pxPerSecond));
    }
  };

  const release = (e: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    const step = e.shiftKey ? 0.1 : 1;
    const go = (v: number | null): void => {
      if (v === null || !onSeek) return;
      e.preventDefault();
      takeOver();
      onSeek(scale.clampT(v));
    };
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': go(t - step); break;
      case 'ArrowRight': case 'ArrowUp': go(t + step); break;
      case 'Home': go(scale.t0); break;
      case 'End': go(scale.t1); break;
      case '.': go(nextChange(model.stateChanges, t)); break;
      case ',': go(prevChange(model.stateChanges, t)); break;
      case ' ': case 'Spacebar':
        if (onTogglePlay) { e.preventDefault(); onTogglePlay(); }
        break;
      default: break;
    }
  };

  return (
    <g class={playing ? 'tl-playhead is-playing' : 'tl-playhead'}>
      <g
        class="tl-playhead-g"
        transform={`translate(${x},0)`}
        role="slider"
        /* Lower case on an SVG element: see NodeCard. */
        tabindex={0}
        aria-label="Time"
        aria-valuemin={scale.t0}
        aria-valuemax={scale.t1}
        aria-valuenow={t}
        aria-valuetext={`t = ${fmt(t)} seconds`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => { onPointerMove(e); release(e); }}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <title>Drag the time marker to scrub. Arrow keys move by 1 s; Shift by 0.1 s.</title>
        <rect class="tl-playhead-hit" x={-8} y={top - 12} width={16} height={Math.max(0, bottom - top + 12)} />
        <line class="tl-playhead-ln" x1={0} y1={top} x2={0} y2={bottom} />
        <path class="tl-playhead-grip" d="M-6,-11 L6,-11 L6,-2 L0,4 L-6,-2 z" transform={`translate(0,${top})`} />
        <rect class="tl-playhead-badge" x={flip ? -60 : 6} y={top - 12} width={54} height={16} rx={2} />
        <text class="tl-playhead-t t-mono" x={flip ? -56 : 10} y={top} >{`t = ${fmt(t)}`}</text>
      </g>
    </g>
  );
}

/** The lane-block height a playhead spans, exported for the shell's budget. */
export const playheadSpan = (model: TimelineModel): number =>
  model.axisY - (model.laneTop - 12) + model.layout.laneGap;
