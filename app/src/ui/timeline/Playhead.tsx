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
import { fmt, TL } from './build';
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

  const seekFromClient = (el: SVGGraphicsElement, clientX: number): void => {
    if (!onSeek) return;
    const svg = el.ownerSVGElement ?? (el as unknown as SVGSVGElement);
    const box = svg.getBoundingClientRect();
    const ratio = box.width > 0 ? model.width / box.width : 1;
    onSeek(scale.clampT(scale.tAt((clientX - box.left) * ratio)));
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<SVGRectElement>): void => {
    if (!onSeek) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    takeOver();
    seekFromClient(el, e.clientX);
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<SVGRectElement>): void => {
    if (!onSeek) return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekFromClient(e.currentTarget, e.clientX);
  };

  const onPointerUp = (e: JSX.TargetedPointerEvent<SVGRectElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
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
      {/* the drag surface: invisible, but a real target the whole lane block wide */}
      <rect
        class="tl-scrub-hit"
        x={scale.plotL}
        y={top}
        width={Math.max(0, scale.plotW)}
        height={Math.max(0, bottom - top)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
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
      >
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
  model.axisY - (model.laneTop - 12) + TL.laneGap;
