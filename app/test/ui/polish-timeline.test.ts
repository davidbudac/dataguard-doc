/**
 * The polish pass on the shared timeline and header: the playhead's time badge
 * keeps clear of every event sentence, chip and number; the axis is spoken
 * rounded; and the restore note in the header carries its whole text as a
 * title. (The Split layout's own parts of this pass -- the drawing scaled to
 * its room, and the divider -- went with the layout.)
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicTopology, simulate } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { hostDown, hostUp } from '@/presets/build';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { restored } from '@/state/persist';
import { mode, tNow, viewport } from '@/state/view';
import { TopBar } from '@/ui/TopBar';
import { DocPicker } from '@/ui/StatusBar';
import { Timeline } from '@/ui/timeline/Timeline';
import { buildTimeline, spoken } from '@/ui/timeline/build';
import type { TimelineModel } from '@/ui/timeline/build';
import { badgePlacement, markerBoxes } from '@/ui/timeline/Playhead';

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

/* jsdom has no pointer events, and Preact only binds `onPointerDown` to the
   lower-case event when the element has an `onpointerdown` property. */
for (const n of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
  if (!(`on${n}` in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, `on${n}`, { value: null, writable: true, configurable: true });
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

let root: HTMLElement | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  tNow.value = 0;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

/* ---------------- 1. the time badge ---------------- */

function crashThenRestore(density: 'full' | 'compact', width: number, at = 20): TimelineModel {
  const base = classicTopology({});
  const events: TimedEvent[] = [hostDown(0, 'dc1-prm01'), hostUp(at, 'dc1-prm01')];
  const doc: TopologyDoc = { ...base, events };
  return buildTimeline(simulate(doc, events), doc, { width, density });
}


describe('the playhead badge', () => {
  it('never lands on an event sentence, chip or number, wherever the playhead is', () => {
    for (const density of ['full', 'compact'] as const) {
      for (const width of [720, 1100, 1600]) {
        const m = crashThenRestore(density, width);
        const boxes = markerBoxes(m);
        expect(boxes.length).toBeGreaterThan(2);
        /* the badge's own size is the layout's: the packed timeline draws it larger */
        const BADGE_W = m.layout.badgeW;
        const BADGE_H = m.layout.badgeH;
        const top = m.laneTop - m.layout.playRise - BADGE_H + 4;
        for (let t = m.scale.t0; t <= m.scale.t1; t += 0.5) {
          const x = m.scale.x(t);
          const dx = badgePlacement(m, x);
          const x0 = x + dx;
          for (const b of boxes) {
            const apart = x0 + BADGE_W <= b.x0 || x0 >= b.x1 || top + BADGE_H <= b.y0 || top >= b.y1;
            expect(apart, `${density} ${width}px t=${t} badge ${x0}..${x0 + BADGE_W} vs ${b.x0}..${b.x1}`).toBe(true);
          }
          /* and inside the drawing */
          expect(x0).toBeGreaterThanOrEqual(0);
          expect(x0 + BADGE_W).toBeLessThanOrEqual(m.width);
        }
      }
    }
  });

  it('stays right of its line when nothing is there, and flips left of an event sentence', () => {
    const m = crashThenRestore('full', 1100);
    expect(badgePlacement(m, m.scale.x(10))).toBe(6);
    /* at the restore, its sentence starts just right of the line */
    expect(badgePlacement(m, m.scale.x(20))).toBeLessThan(0);
  });

  it('has a row of its own in the packed drawing, so it stays right of its line at an event', () => {
    /* The compact timeline sets the badge over the event row, not on it. */
    const m = crashThenRestore('compact', 1100);
    expect(m.layout.playRise).toBeGreaterThan(m.layout.laneTop - m.layout.markY);
    expect(badgePlacement(m, m.scale.x(10))).toBe(6);
    expect(badgePlacement(m, m.scale.x(20))).toBe(6);
  });

  it('is drawn where the model puts it', async () => {
    const base = classicTopology({});
    const events: TimedEvent[] = [hostDown(0, 'dc1-prm01'), hostUp(20, 'dc1-prm01')];
    const doc: TopologyDoc = { ...base, events };
    const trace = simulate(doc, events);
    root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Timeline, { trace, doc, width: 1100, tNow: 20, density: 'compact' }), root);
    await tick();
    const badge = root.querySelector('.tl-playhead-badge') as SVGRectElement;
    const m = buildTimeline(trace, doc, { width: 1100, density: 'compact' });
    expect(Number(badge.getAttribute('x'))).toBe(badgePlacement(m, m.scale.x(20)));
  });
});

/* ---------------- 2. the axis, spoken ---------------- */

describe('the axis as it is spoken', () => {
  it('rounds the extent in the description and the slider values', async () => {
    const m = crashThenRestore('full', 1000, 41.3);
    expect(String(m.scale.t1)).toMatch(/\.\d{6,}/);
    root = document.createElement('div');
    document.body.appendChild(root);
    const base = classicTopology({});
    const events: TimedEvent[] = [hostDown(0, 'dc1-prm01'), hostUp(41.3, 'dc1-prm01')];
    const doc: TopologyDoc = { ...base, events };
    render(h(Timeline, { trace: simulate(doc, events), doc, width: 1000, tNow: 5 }), root);
    await tick();
    const desc = root.querySelector('svg desc')?.textContent ?? '';
    expect(desc).toMatch(/from -?\d+(\.\d{1,2})? to \d+(\.\d{1,2})? seconds/);
    expect(desc).not.toMatch(/\d\.\d{3,}/);
    const slider = root.querySelector('.tl-playhead-g') as Element;
    for (const a of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow']) {
      expect(slider.getAttribute(a), a).not.toMatch(/\.\d{3,}/);
    }
    expect(spoken(69.34499999999998)).toBe(69.34);
  });
});

/* ---------------- 3. the header ---------------- */

describe('the restore note', () => {
  it('ellipsises its text and carries the whole sentence as a title', async () => {
    restored.value = true;
    root = document.createElement('div');
    document.body.appendChild(root);
    render(h(TopBar, { doc: h(DocPicker, {}) }), root);
    await tick();
    const text = root.querySelector('.topbar-brand .doc-restored .doc-restored-t') as HTMLElement;
    expect(text).not.toBeNull();
    expect(text.title).toBe('Restored your last configuration');
    expect(text.textContent?.trim()).toBe('Restored your last configuration');
    /* the way out is a sibling of the text, so the text can give way without it */
    expect(root.querySelector('.doc-restored > .btn')?.textContent).toBe('Start fresh');
    restored.value = false;
  });
});
