/**
 * Playback: the ▶ button used to change its own glyph and nothing else.
 *
 * `playing` had three consumers -- the button's label, a dash-array on the
 * playhead and a rule that kept `t` out of the share link -- and not one of
 * them advanced `tNow`, so a reader who pressed ▶ watched a static picture
 * with a Pause button on it. These tests hold the loop that fixes it: that it
 * advances by `dt * speed`, that it stops on the end of the axis instead of
 * running forever against a clamp, and that ▶ pressed at the end restarts.
 *
 * The frame clock is a stub. `usePlayback` resolves `requestAnimationFrame`
 * per run rather than at module load precisely so a test can install one, and
 * falls back to a 16 ms timer where the global does not exist at all.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { nextT, usePlayback } from '@/ui/timeline/playback';
import type { PlaybackProps } from '@/ui/timeline/playback';

/* ---------------- a frame clock we drive by hand ---------------- */

interface Clock {
  /** Run every frame that is currently queued, at wall-clock `ts` ms. */
  flush: (ts: number) => void;
  pending: () => number;
}

let clock: Clock;
let host: HTMLElement;
const realRaf = globalThis.requestAnimationFrame;
const realCaf = globalThis.cancelAnimationFrame;

function installClock(): Clock {
  const queued = new Map<number, (ts: number) => void>();
  let id = 0;
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame =
    (cb: (ts: number) => void): number => { id += 1; queued.set(id, cb); return id; };
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame =
    (n: number): void => { queued.delete(n); };
  return {
    pending: () => queued.size,
    flush: (ts) => {
      const batch = [...queued.entries()];
      queued.clear();
      for (const [, cb] of batch) cb(ts);
    },
  };
}

const Probe = (p: PlaybackProps) => { usePlayback(p); return null; };

const mount = (p: PlaybackProps): void => {
  render(h(Probe, p), host);
};

const base = (over: Partial<PlaybackProps> = {}): PlaybackProps => ({
  playing: true, speed: 1, tNow: 0, t0: 0, t1: 10, enabled: true, ...over,
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  clock = installClock();
});

afterEach(() => {
  render(null, host);
  host.remove();
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = realRaf;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = realCaf;
});

/* ---------------- the arithmetic ---------------- */

describe('nextT', () => {
  it('advances by dt * speed', () => {
    expect(nextT(0, 0.5, 1, 0, 60)).toBeCloseTo(0.5, 9);
    expect(nextT(0, 0.5, 4, 0, 60)).toBeCloseTo(2, 9);
    expect(nextT(0, 0.5, 0.25, 0, 60)).toBeCloseTo(0.125, 9);
  });

  it('never leaves the axis', () => {
    expect(nextT(59, 10, 4, -9, 60)).toBe(60);
    expect(nextT(-5, 1, -100, -9, 60)).toBe(-9);
  });
});

/* ---------------- the loop ---------------- */

describe('usePlayback', () => {
  it('does nothing at all while paused', () => {
    const onSeek = vi.fn();
    mount(base({ playing: false, onSeek }));
    expect(clock.pending()).toBe(0);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('does nothing when there is no run to play', () => {
    const onSeek = vi.fn();
    mount(base({ enabled: false, onSeek }));
    expect(clock.pending()).toBe(0);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('advances tNow by dt * speed once it has two frames to measure', () => {
    const onSeek = vi.fn();
    mount(base({ onSeek }));
    /* The first frame is the one that starts the clock: nothing to measure
       against yet, so nothing moves. */
    clock.flush(1000);
    expect(onSeek).not.toHaveBeenCalled();
    clock.flush(1500);
    expect(onSeek).toHaveBeenLastCalledWith(0.5);
    clock.flush(1750);
    expect(onSeek).toHaveBeenLastCalledWith(0.75);
  });

  it('scales by the speed picker', () => {
    const onSeek = vi.fn();
    mount(base({ speed: 4, onSeek }));
    clock.flush(0);
    clock.flush(500);
    expect(onSeek).toHaveBeenLastCalledWith(2);
  });

  it('starts from wherever the playhead already is', () => {
    const onSeek = vi.fn();
    mount(base({ tNow: 6, onSeek }));
    clock.flush(0);
    clock.flush(1000);
    expect(onSeek).toHaveBeenLastCalledWith(7);
  });

  it('lands exactly on the end of the axis and stops there', () => {
    const onSeek = vi.fn();
    const onEnd = vi.fn();
    mount(base({ tNow: 9.5, onSeek, onEnd }));
    clock.flush(0);
    clock.flush(2000);
    expect(onSeek).toHaveBeenLastCalledWith(10);
    expect(onEnd).toHaveBeenCalledTimes(1);
    /* Stopped means stopped: no frame is left queued to run past the end. */
    expect(clock.pending()).toBe(0);
    clock.flush(3000);
    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it('restarts from the start of the axis when ▶ is pressed at the end', () => {
    const onSeek = vi.fn();
    const onEnd = vi.fn();
    mount(base({ tNow: 10, t0: -2, onSeek, onEnd }));
    /* Before any frame at all: the rewind is what pressing ▶ means here. */
    expect(onSeek).toHaveBeenNthCalledWith(1, -2);
    expect(onEnd).not.toHaveBeenCalled();
    clock.flush(0);
    clock.flush(1000);
    expect(onSeek).toHaveBeenLastCalledWith(-1);
  });

  it('does not rewind when ▶ is pressed anywhere else', () => {
    const onSeek = vi.fn();
    mount(base({ tNow: 3, onSeek }));
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('cancels the frame when playback is paused', () => {
    const onSeek = vi.fn();
    mount(base({ onSeek }));
    clock.flush(0);
    expect(clock.pending()).toBe(1);
    mount(base({ playing: false, onSeek }));
    expect(clock.pending()).toBe(0);
    clock.flush(1000);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('cancels the frame on unmount', () => {
    const onSeek = vi.fn();
    mount(base({ onSeek }));
    clock.flush(0);
    render(null, host);
    expect(clock.pending()).toBe(0);
    clock.flush(1000);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('keeps running across the re-render every frame causes', () => {
    const onSeek = vi.fn();
    mount(base({ onSeek }));
    clock.flush(0);
    clock.flush(1000);
    /* The parent re-renders with the new tNow; the loop must not be torn down
       and restarted, or `dt` would reset to zero every single frame. */
    mount(base({ tNow: 1, onSeek }));
    clock.flush(2000);
    expect(onSeek).toHaveBeenLastCalledWith(2);
  });

  it('falls back to a timer where requestAnimationFrame does not exist', async () => {
    const g = globalThis as unknown as { requestAnimationFrame: unknown; cancelAnimationFrame: unknown };
    g.requestAnimationFrame = undefined;
    g.cancelAnimationFrame = undefined;
    const onSeek = vi.fn();
    mount(base({ onSeek }));
    await new Promise((r) => setTimeout(r, 60));
    expect(onSeek).toHaveBeenCalled();
    expect((onSeek.mock.calls.at(-1) as [number])[0]).toBeGreaterThan(0);
  });
});

/**
 * And the whole of it through the component the reader actually presses ▶ on,
 * because the loop existing is not the same as the timeline running it.
 */
describe('the timeline drives the loop', () => {
  interface Mounted { t0: number; t1: number; toggles: number }

  const mountTimeline = async (
    playing: boolean, tNow: number, onSeek: (t: number) => void,
  ): Promise<Mounted> => {
    const { Timeline } = await import('@/ui/timeline/Timeline');
    const { buildTimeline } = await import('@/ui/timeline/build');
    const { simulate } = await import('@/engine');
    const { classicDoc } = await import('@/state/doc');
    const bare = classicDoc().topology;
    const events = [{ at: 0, kind: 'host.down' as const, host: bare.hosts[0]!.id }];
    /* `model.empty` reads the document's events, and an empty model has
       nothing to play. */
    const doc = { ...bare, events };
    const trace = simulate(doc, events);
    const out: Mounted = { ...buildTimeline(trace, doc, { width: 900 }).scale, toggles: 0 };
    render(
      h(Timeline, {
        trace, doc, width: 900, tNow, playing, speed: 2,
        onSeek, onPlayToggle: () => { out.toggles += 1; }, onSpeed: () => undefined,
      }),
      host,
    );
    return out;
  };

  it('moves the playhead while ▶ is pressed', async () => {
    const onSeek = vi.fn();
    await mountTimeline(true, 0, onSeek);
    clock.flush(0);
    clock.flush(1000);
    expect(onSeek).toHaveBeenLastCalledWith(2);
  });

  it('moves nothing at all while it is paused', async () => {
    const onSeek = vi.fn();
    await mountTimeline(false, 0, onSeek);
    clock.flush(0);
    clock.flush(1000);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('stops itself at the end of the axis, so ▶ turns back into ▶', async () => {
    const onSeek = vi.fn();
    const m = await mountTimeline(true, 0, onSeek);
    clock.flush(0);
    clock.flush(1_000_000);
    expect(onSeek).toHaveBeenLastCalledWith(m.t1);
    expect(m.toggles).toBe(1);
  });

  it('rewinds to the start of the axis when ▶ is pressed at the end', async () => {
    const onSeek = vi.fn();
    const m = await mountTimeline(true, 0, onSeek);
    render(null, host);
    onSeek.mockClear();
    const m2 = await mountTimeline(true, m.t1, onSeek);
    expect(onSeek).toHaveBeenNthCalledWith(1, m2.t0);
    expect(m2.toggles).toBe(0);
  });
});
