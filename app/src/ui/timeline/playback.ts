/**
 * Playback: the one thing on this page that moves by itself.
 *
 * The transport has always drawn a ▶ button, `playing` has always flipped its
 * glyph, and Space has always been bound to it -- but nothing ever advanced
 * `tNow`, so the button changed its own label and the drawing stayed exactly
 * where it was. A play button that does nothing is worse than no play button:
 * the reader concludes the frozen picture is the whole answer. This module is
 * the missing half.
 *
 * It lives in the UI layer on purpose. The engine is pure -- no clock, no
 * `Math.random`, no DOM (CLAUDE.md) -- so "what time is it now" cannot come
 * from it. `usePlayback` reads the frame clock, does the arithmetic, and hands
 * the result back through the same `onSeek` a drag or an arrow key uses, so
 * playback is not a second way to move the playhead; it is the first one,
 * driven by a timer.
 *
 * Two decisions the button's behaviour rests on, written down because both are
 * choices rather than consequences:
 *
 *   1. **The end stops.** When the playhead reaches the end of the axis the
 *      run is over: the playhead lands exactly on `t1` and `playing` goes
 *      false, so the glyph returns to ▶. A button that stayed "Pause" at the
 *      end would be the same lie in a smaller form.
 *   2. **▶ at the end restarts from the start of the axis.** The alternative
 *      -- doing nothing -- is indistinguishable from the bug this fixes, and a
 *      run that has just finished is precisely when a reader wants to watch it
 *      again. `↺ Back to the start` stays the way to rewind without playing.
 *
 * While it is running, playback owns the playhead: it keeps its own position
 * and writes it out every frame, rather than reading `tNow` back in. It has
 * to. `tNow` is a signal a render behind the frame that wrote it, so a loop
 * that fed itself from the prop would either stall or stutter. The consequence
 * is that a seek during playback would be overwritten one frame later, so
 * `Playhead` pauses first: grabbing the scrubber or pressing an arrow key
 * while the run is playing stops it, which is what reaching for the playhead
 * means anyway.
 *
 * Reduced motion is deliberately *not* a gate here. `prefers-reduced-motion`
 * suppresses motion the page starts on its own; this motion starts because the
 * reader pressed a button, and it is already pausable, stoppable and scrubbable
 * (WCAG 2.2.2). The CSS transitions that *are* incidental are gated, in
 * `timeline.css`.
 */

import { useLayoutEffect, useRef } from 'preact/hooks';

/** Half a millisecond, in seconds: below this two playhead readings are one. */
const EPS = 5e-4;

export interface PlaybackProps {
  playing: boolean;
  /** Seconds of run per second of wall clock. */
  speed: number;
  tNow: number;
  t0: number;
  t1: number;
  /** False when there is nothing to play: steady state, or the export scale. */
  enabled: boolean;
  onSeek?: (t: number) => void;
  /** Called once, when the playhead lands on the end of the axis. */
  onEnd?: () => void;
}

interface Frames {
  request: (cb: (ts: number) => void) => number;
  cancel: (id: number) => void;
}

/**
 * `requestAnimationFrame` where it exists, a 16 ms timer where it does not --
 * jsdom, a print worker, anything headless. Resolved per run rather than at
 * module load so a test can install a stub and get it.
 */
function frames(): Frames {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (ts: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const raf = g.requestAnimationFrame;
  const caf = g.cancelAnimationFrame;
  if (typeof raf === 'function' && typeof caf === 'function') {
    return { request: (cb) => raf(cb), cancel: (id) => caf(id) };
  }
  return {
    request: (cb) => setTimeout(() => cb(now()), 16) as unknown as number,
    cancel: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  };
}

/** The frame clock, in milliseconds. */
function now(): number {
  const p = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

/**
 * Where the playhead lands after `dtSeconds` of wall clock at `speed`, clamped
 * to the axis. Exported because it is the whole of the arithmetic and the
 * cheapest thing to pin in a test.
 */
export const nextT = (
  cur: number, dtSeconds: number, speed: number, t0: number, t1: number,
): number => Math.min(t1, Math.max(t0, cur + dtSeconds * speed));

/**
 * Advance `tNow` while `playing`. Returns nothing: every effect it has leaves
 * through `onSeek` and `onEnd`.
 */
export function usePlayback(props: PlaybackProps): void {
  /* `onSeek` and `onEnd` are fresh closures on every render, and the playhead
     moves every frame, so a loop that depended on them would be torn down and
     rebuilt sixty times a second. They go through a ref; only the five values
     that change what a frame *means* are dependencies. */
  const live = useRef<PlaybackProps>(props);
  live.current = props;

  const { playing, speed, t0, t1, enabled } = props;

  /* A layout effect, not a passive one: the loop must start and stop on the
     commit that flipped `playing`, and preact defers passive effects behind a
     frame of its own, which would make the first frame's `dt` the wait for
     preact rather than the wait for the screen. */
  useLayoutEffect(() => {
    if (!playing || !enabled || speed <= 0 || !(t1 > t0)) return undefined;

    const { request, cancel } = frames();
    let id = 0;
    let last: number | null = null;
    let stopped = false;

    /* Decision 2: ▶ at the end restarts rather than doing nothing. */
    let pos = Math.min(t1, Math.max(t0, live.current.tNow));
    if (pos >= t1 - EPS) { pos = t0; live.current.onSeek?.(t0); }

    const frame = (ts: number): void => {
      if (stopped) return;
      if (last === null) { last = ts; id = request(frame); return; }
      const dt = Math.max(0, (ts - last) / 1000);
      last = ts;

      pos = nextT(pos, dt, speed, t0, t1);
      live.current.onSeek?.(pos);

      /* Decision 1: the end of the axis is the end of the run. */
      if (pos >= t1 - EPS) { stopped = true; live.current.onEnd?.(); return; }
      id = request(frame);
    };

    id = request(frame);
    return () => { stopped = true; cancel(id); };
  }, [playing, speed, t0, t1, enabled]);
}
