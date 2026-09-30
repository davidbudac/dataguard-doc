/**
 * Dragging the end of a clock to change its setting: which clocks have a grip
 * and where (`tuneHandles`), the grip's slider semantics, one undo entry for a
 * whole drag, the axis held while it lasts, and no grip where nothing may be
 * tuned (Learn's plain timeline, the export scale, a read-only view).
 *
 * jsdom lays nothing out: how a grip sits on its band, and whether it is quiet
 * enough at rest, are the browser pass.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { BOUNDS, simulate, sortEvents } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { classic } from '@/presets';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory, undo, undoLabel, undoStack } from '@/state/history';
import { topology } from '@/state/derived';
import { breakTimeline, appLanesShown, mode, railCollapsed, selection, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { resetSections } from '@/ui/inspector/sections';
import { buildTimeline } from '@/ui/timeline/build';
import { tunedScenario, tuneDragging } from '@/ui/timeline/run';
import { Timeline } from '@/ui/timeline/Timeline';
import { applyTune } from '@/ui/timeline/tune';
import type { Tune } from '@/ui/timeline/tune';
import { tuneHandles } from '@/ui/timeline/tune-handles';

const memory = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => { memory.clear(); },
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
} as unknown as Storage;
Object.defineProperty(window, 'localStorage', { configurable: true, value: fakeStorage });

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

const crashDoc = (): TopologyDoc => {
  const base = classic.doc();
  const t = templates(base, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  return { ...base, events: sortEvents(t.events) };
};

let root: HTMLElement | null = null;
const mount = (): HTMLElement => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};
/**
 * The preset's own classic deployment, crashed at t = 0. Its standby's two bars are exactly the
 * threshold's and the role transition's clocks; the application's default document (`classicDoc`,
 * with an apply lag of its own) draws the standby as one bar to the promotion, so no lane is a clock there.
 */
const load = (): void => { resetHistory(makeDoc(crashDoc())); };
const crash = (): void => {
  const t = templates(topology.value, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  applyTemplate(t);
};

beforeEach(() => {
  /* jsdom lacks pointer events on the elements the grips are; let Preact use the native names. */
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    for (const proto of [SVGElement.prototype, HTMLElement.prototype]) {
      Object.defineProperty(proto, `on${name}`, { value: null, configurable: true });
    }
  }
  document.body.innerHTML = '';
  memory.clear();
  resetHistory(classicDoc());
  resetSections();
  viewport.value = 'wide';
  mode.value = 'break';
  breakTimeline.value = 'config';
  railCollapsed.value = false;
  selection.value = [];
  tunedScenario.value = null;
  tuneDragging.value = false;
  appLanesShown.value = false;
  tNow.value = 0;
});

afterEach(() => {
  if (root) act(() => render(null, root!));
  root = null;
  tuneDragging.value = false;
});

/* ---------------- helpers ---------------- */

const grips = (r: ParentNode, tune?: string, where?: 'brace' | 'lane'): SVGGElement[] =>
  [...r.querySelectorAll<SVGGElement>(`.tl-tune${where ? `.is-${where}` : ''}${tune ? `[data-tune="${tune}"]` : ''}`)];

/** Pointer capture is a browser feature; give the element the three calls the grip makes. */
const capturing = (el: Element): void => {
  const e = el as Element & Record<string, unknown>;
  e.setPointerCapture = vi.fn();
  e.hasPointerCapture = () => true;
  e.releasePointerCapture = vi.fn();
};
const pointer = (el: Element, type: string, x: number, extra: MouseEventInit = {}): void => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, button: 0, ...extra });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  act(() => { el.dispatchEvent(e); });
};
const key = (el: Element, k: string, shiftKey = false): void => {
  act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })); });
};

/** Pixels per second, read off the drawn axis: the ticks are where the seconds are. */
const pxPerSecond = (r: ParentNode): number => {
  const ticks = [...r.querySelectorAll<SVGTextElement>('.tl-svg .t-tick')]
    .filter((t) => (t.textContent ?? '') !== '')
    .map((t) => ({ label: Number(t.textContent), x: Number(t.getAttribute('x')) }))
    .filter((t) => Number.isFinite(t.label));
  const a = ticks[0]!;
  const b = ticks.find((t) => t.label !== a.label)!;
  return (b.x - a.x) / (b.label - a.label);
};
const axis = (r: ParentNode): string =>
  [...r.querySelectorAll('.tl-svg .t-tick')].map((t) => t.textContent).join(',');
const threshold = (): number => topology.value.config.fsfo.thresholdSeconds;

/* ---------------- the handles ---------------- */

describe('tuneHandles', () => {
  const d = crashDoc();
  const tr = simulate(d, d.events);
  const model = buildTimeline(tr, d, { width: 900 });

  it('gives the threshold and the role transition a handle each, at the end of their braces', () => {
    const hs = tuneHandles(d, tr, model);
    expect(hs.map((x) => x.key)).toEqual(['threshold', 'role']);
    for (const hd of hs) {
      const b = model.braces.find((x) => x.key === hd.key)!;
      expect(hd.x).toBe(b.x1);
      expect(hd.braceY).toBe(b.y);
    }
    expect(hs[0]!.tune).toMatchObject({ id: 'threshold', value: 30 });
    expect(hs[1]!.tune).toMatchObject({ id: 'roleTransition', value: 15 });
    expect(hs[0]!.title).toBe('Drag to change FastStartFailoverThreshold. Arrow keys: 1 s; Shift: 5 s. Allowed: 6–120 s.');
  });

  it('attaches both to the standby\'s lane: its two bars are exactly those clocks', () => {
    /* The observer's own lane is one bar from the crash to the promotion (0-45 s), so it is no clock of either. */
    const hs = tuneHandles(d, tr, model);
    expect(hs.map((x) => x.laneKey)).toEqual(['member:sby01', 'member:sby01']);
    const lane = model.lanes.find((l) => l.key === 'member:sby01')!;
    const b = model.braces.find((x) => x.key === 'threshold')!;
    expect(lane.segments.some((s) => Math.abs(s.t0 - b.a) <= 0.05 && Math.abs(s.t1 - b.b) <= 0.05)).toBe(true);
  });

  it('has no lane once a longer run\'s bars are cut at the held axis (the hook keeps it for the drag)', () => {
    const base = classic.doc();
    const long = { ...base, config: { ...base.config, fsfo: { ...base.config.fsfo, thresholdSeconds: 70 } } };
    const ld = { ...long, events: sortEvents(templates(long, 0).find((x) => x.id === 'crash')!.events) };
    const ltr = simulate(ld, ld.events);
    const held = buildTimeline(ltr, ld, { width: 900, app: false, axis: { t0: -10, t1: 63.25 } });
    expect(tuneHandles(ld, ltr, held).find((x) => x.key === 'threshold')?.laneKey).toBeNull();
    const own = buildTimeline(ltr, ld, { width: 900, app: false });
    expect(tuneHandles(ld, ltr, own).find((x) => x.key === 'threshold')?.laneKey).toBe('member:sby01');
  });

  it('has no handle for a brace that is not one setting, and none for an application lane', () => {
    const sw = { ...classic.doc(), events: sortEvents(templates(classic.doc(), 0).find((x) => x.id === 'switchover')!.events) };
    const str = simulate(sw, sw.events);
    const smodel = buildTimeline(str, sw, { width: 900 });
    const keys = tuneHandles(sw, str, smodel).map((x) => x.key);
    expect(keys).toContain('sw-role');
    expect(keys).not.toContain('sw-verify');
    for (const hd of tuneHandles(sw, str, smodel)) expect(hd.laneKey?.startsWith('application:') ?? false).toBe(false);
  });
});

/* ---------------- in the full timeline: docked below 1024 px, or popped out ---------------- */

describe('the grips in the full timeline', () => {
  /* The docked layout draws the full timeline (`TimelineBody`) with its grips. */
  beforeEach(() => { viewport.value = 'compact'; });

  it('are sliders named for the setting, on the brace and on the lane, with the bound and the value', async () => {
    load();
    const r = mount();
    await tick();
    const th = grips(r, 'threshold');
    expect(th.map((g) => g.classList.contains('is-brace') ? 'brace' : 'lane').sort()).toEqual(['brace', 'lane']);
    for (const g of th) {
      expect(g.getAttribute('role')).toBe('slider');
      expect(g.getAttribute('tabindex')).toBe('0');
      expect(g.getAttribute('aria-label')).toBe('FastStartFailoverThreshold');
      expect(g.getAttribute('aria-valuemin')).toBe(String(BOUNDS.thresholdSeconds.min));
      expect(g.getAttribute('aria-valuemax')).toBe(String(BOUNDS.thresholdSeconds.max));
      expect(g.getAttribute('aria-valuenow')).toBe('30');
      expect(g.getAttribute('aria-valuetext')).toBe('30 seconds');
      expect(g.querySelector('title')?.textContent)
        .toBe('Drag to change FastStartFailoverThreshold. Arrow keys: 1 s; Shift: 5 s. Allowed: 6–120 s.');
    }
    expect(grips(r, 'roleTransition')).toHaveLength(2);
  });

  it('has only a brace grip where no lane\'s band is the clock (the default document\'s standby is one bar)', async () => {
    crash();
    const r = mount();
    await tick();
    expect(grips(r, undefined, 'lane')).toHaveLength(0);
    expect(grips(r, 'threshold', 'brace')).toHaveLength(1);
  });

  it('names the standby in the apply lag\'s label', async () => {
    const lagged = (): void => {
      resetHistory(classicDoc());
      const d = topology.value;
      const m = d.members.find((x) => x.id === 'sby01')!;
      applyTune({ id: 'applyLag', bound: 'applyLagSeconds', value: 0, member: m.id, name: 'Apply lag', mono: false }, 10);
      crash();
    };
    lagged();
    const r = mount();
    await tick();
    const g = grips(r, 'applyLag');
    expect(g.length).toBeGreaterThan(0);
    expect(g[0]!.getAttribute('aria-label')).toBe('Apply lag of sby01');
  });

  it.each(['brace', 'lane'] as const)('a drag on the %s grip raises the threshold live, as one undo entry, on a held axis', async (where) => {
    load();
    const r = mount();
    await tick();
    tNow.value = 10;
    await tick();
    const grip = grips(r, 'threshold', where)[0]!;
    capturing(grip);
    const pps = pxPerSecond(r);
    const before = axis(r);
    expect(threshold()).toBe(30);
    const undoBefore = undoStack.value.length;

    pointer(grip, 'pointerdown', 300);
    expect(tuneDragging.value).toBe(true);
    /* Several moves in a row: each recomputes the run, and the same element must take the next one. */
    let expected = 30;
    for (const dx of [pps * 2, pps * 5, pps * 9, pps * 40]) {
      pointer(grip, 'pointermove', 300 + dx);
      await tick();
      expected = Math.min(BOUNDS.thresholdSeconds.max, 30 + Math.round(dx / pps));
      expect(threshold()).toBe(expected);
      expect(grips(r, 'threshold', where)[0]).toBe(grip);
      expect(grip.classList.contains('is-dragging')).toBe(true);
      expect(grip.querySelector('.tl-event-time')?.textContent).toBe(`${expected} s`);
      expect(axis(r)).toBe(before);
      expect(tuneDragging.value).toBe(true);
    }
    expect(expected).toBe(70);
    pointer(grip, 'pointerup', 300 + pps * 40);
    await tick();
    expect(tuneDragging.value).toBe(false);
    expect(grip.classList.contains('is-dragging')).toBe(false);
    expect(grip.querySelector('.tl-event-time')).toBeNull();
    expect(threshold()).toBe(70);
    /* Pressing the grip did not seek. */
    expect(tNow.value).toBe(10);
    expect(undoStack.value.length).toBe(undoBefore + 1);
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 70 s');
    undo();
    expect(threshold()).toBe(30);
  });

  it('drags left to lower the setting, clamps at the floor, and lets the axis go on cancel', async () => {
    load();
    const r = mount();
    await tick();
    const grip = grips(r, 'threshold', 'brace')[0]!;
    capturing(grip);
    const pps = pxPerSecond(r);
    pointer(grip, 'pointerdown', 500);
    pointer(grip, 'pointermove', 500 - pps * 100);
    await tick();
    expect(threshold()).toBe(BOUNDS.thresholdSeconds.min);
    pointer(grip, 'pointermove', 500 + pps * 500);
    await tick();
    expect(threshold()).toBe(BOUNDS.thresholdSeconds.max);
    pointer(grip, 'pointercancel', 500);
    expect(tuneDragging.value).toBe(false);
  });

  it('does not call the setter for a move that lands on the same value', async () => {
    load();
    const r = mount();
    await tick();
    const grip = grips(r, 'threshold', 'brace')[0]!;
    capturing(grip);
    const pps = pxPerSecond(r);
    pointer(grip, 'pointerdown', 400);
    pointer(grip, 'pointermove', 400 + pps * 0.3);
    pointer(grip, 'pointerup', 400 + pps * 0.3);
    await tick();
    expect(undoStack.value.length).toBe(0);
    expect(threshold()).toBe(30);
  });

  it('ignores a press of another button', async () => {
    load();
    const r = mount();
    await tick();
    const grip = grips(r, 'threshold', 'brace')[0]!;
    capturing(grip);
    pointer(grip, 'pointerdown', 400, { button: 2 });
    expect(tuneDragging.value).toBe(false);
  });

  it('is undone by a grip removed mid-drag: the axis is not held for good', async () => {
    load();
    const r = mount();
    await tick();
    const grip = grips(r, 'threshold', 'brace')[0]!;
    capturing(grip);
    pointer(grip, 'pointerdown', 400);
    expect(tuneDragging.value).toBe(true);
    act(() => render(null, root!));
    expect(tuneDragging.value).toBe(false);
  });

  it('steps with the arrow keys, five with Shift, and jumps to the bounds with Home and End', async () => {
    load();
    const r = mount();
    await tick();
    const grip = (): SVGGElement => grips(r, 'threshold', 'brace')[0]!;
    key(grip(), 'ArrowRight');
    await tick();
    expect(threshold()).toBe(31);
    key(grip(), 'ArrowRight', true);
    await tick();
    expect(threshold()).toBe(36);
    key(grip(), 'ArrowLeft');
    await tick();
    expect(threshold()).toBe(35);
    key(grip(), 'ArrowDown', true);
    await tick();
    expect(threshold()).toBe(30);
    key(grip(), 'ArrowUp');
    await tick();
    expect(threshold()).toBe(31);
    key(grip(), 'Home');
    await tick();
    expect(threshold()).toBe(BOUNDS.thresholdSeconds.min);
    key(grip(), 'ArrowLeft');
    await tick();
    expect(threshold()).toBe(BOUNDS.thresholdSeconds.min);
    key(grip(), 'End');
    await tick();
    expect(threshold()).toBe(BOUNDS.thresholdSeconds.max);
    expect(tuneDragging.value).toBe(false);
    /* A burst of keys is one undo entry, like a drag. */
    expect(undoStack.value.length).toBe(1);
    key(grip(), 'a');
    expect(threshold()).toBe(BOUNDS.thresholdSeconds.max);
  });

  it('takes the role transition and the same grip on the lane, from the keyboard', async () => {
    load();
    const r = mount();
    await tick();
    key(grips(r, 'roleTransition', 'lane')[0]!, 'ArrowRight', true);
    await tick();
    expect(topology.value.environment.roleTransitionSeconds).toBe(20);
    expect(undoLabel.value).toBe('Set the role transition to 20 s');
  });
});

/* ---------------- where there are none ---------------- */

describe('no grips', () => {
  const props = (over: Record<string, unknown> = {}) => {
    const d = crashDoc();
    return { doc: d, trace: simulate(d, d.events), width: 900, tNow: 0, ...over };
  };
  const draw = (over: Record<string, unknown>): HTMLElement => {
    root = document.createElement('div');
    document.body.appendChild(root);
    act(() => render(h(Timeline, props(over) as never), root!));
    return root;
  };
  const onTune = (): ((t: Tune, v: number) => void) => vi.fn();

  it('are drawn by the timeline where a tune handler is given', () => {
    const r = draw({ onTune: onTune() });
    expect(grips(r)).toHaveLength(4);
  });

  it('are not drawn without a handler (Learn, a read-only view)', () => {
    expect(grips(draw({}))).toHaveLength(0);
  });

  it('are not drawn at the export scale', () => {
    expect(grips(draw({ onTune: onTune(), pinnedScale: true }))).toHaveLength(0);
  });

  it('are not drawn in a read-only viewer', async () => {
    crash();
    viewport.value = 'narrow';
    const r = mount();
    await tick();
    expect(grips(r)).toHaveLength(0);
  });

  it('call the handler with the tune and the clamped value, and the tuning is the caller\'s', () => {
    const f = vi.fn();
    const r = draw({ onTune: f });
    const g = grips(r, 'threshold', 'brace')[0]!;
    key(g, 'End');
    expect(f).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'threshold', value: 30 }), BOUNDS.thresholdSeconds.max);
  });
});

/* ---------------- in the Detailed timeline's lanes ---------------- */

describe('the grips in the lanes', () => {
  it('are on the braces and on the standby\'s row, and drag the same setting', async () => {
    load();
    const r = mount();
    await tick();
    expect(grips(r, 'threshold', 'brace')).toHaveLength(1);
    expect(grips(r, 'threshold', 'lane')).toHaveLength(1);
    expect(grips(r, 'roleTransition')).toHaveLength(2);
    const grip = grips(r, 'threshold', 'lane')[0]!;
    capturing(grip);
    const pps = pxPerSecond(r);
    pointer(grip, 'pointerdown', 300);
    pointer(grip, 'pointermove', 300 + pps * 4);
    await tick();
    pointer(grip, 'pointermove', 300 + pps * 6);
    await tick();
    pointer(grip, 'pointerup', 300 + pps * 6);
    await tick();
    expect(threshold()).toBe(36);
    expect(undoStack.value.length).toBe(1);
    expect(tuneDragging.value).toBe(false);
  });

  it('are not there in a read-only view', async () => {
    load();
    viewport.value = 'narrow';
    const r = mount();
    await tick();
    expect(grips(r)).toHaveLength(0);
  });
});
