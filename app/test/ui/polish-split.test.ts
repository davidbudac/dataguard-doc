/**
 * The polish pass on Split and the shared timeline and header: the playhead's
 * time badge keeps clear of every event sentence, chip and number; the axis is
 * spoken rounded; the restore note in the header carries its whole text as a
 * title; Split's drawing is scaled up to its room until the reader zooms, and
 * `Fit` gives it back; and a press on the bar followed by a release somewhere
 * else, with no move between, still resizes the region.
 *
 * jsdom lays nothing out, so the room is stubbed (a client box on the wrap) and
 * the pixel results are pinned in the browser pass (ui.md, "Break's two
 * layouts").
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
import { geometry, topology } from '@/state/derived';
import { restored } from '@/state/persist';
import { breakLayout, mode, timelineDefaultH, timelineFull, timelineH, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { TopBar } from '@/ui/TopBar';
import { DocPicker } from '@/ui/StatusBar';
import { applyTemplate, templates } from '@/ui/break/events';
import { AUTO_MAX, AUTO_MIN, autoFactor, fitZoom, FIT_ZOOM, zoom, zoomAuto, zoomBy } from '@/ui/canvas/zoom';
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
const mountApp = (): HTMLElement => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  breakLayout.value = 'split';
  timelineH.value = null;
  timelineFull.value = false;
  tNow.value = 0;
  zoom.value = FIT_ZOOM;
  zoomAuto.value = false;
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

/* ---------------- 5. the drawing fits its room ---------------- */

describe('the drawing in Split', () => {
  it('Fit scales the whole drawing into the room: up to the top rung, and below 1:1 when it must', () => {
    const view = { w: 800, h: 300 };
    expect(autoFactor(view, { w: 1000, h: 330 })).toBe(1.1);
    expect(autoFactor(view, { w: 1200, h: 1000 })).toBe(AUTO_MAX);
    /* a room smaller than the drawing: the real factor, not 1 */
    expect(autoFactor(view, { w: 400, h: 300 })).toBe(0.5);
    expect(autoFactor(view, { w: 100, h: 100 })).toBe(AUTO_MIN);
    /* nothing to measure: the true size */
    expect(autoFactor(view, { w: 0, h: 0 })).toBe(FIT_ZOOM);
    /* floored, so the rounded size cannot poke a pixel out of the room */
    expect(autoFactor({ w: 999, h: 100 }, { w: 1200, h: 1000 })).toBe(1.2);
  });

  /** Give the wrap a room, as a browser would, and let the canvas notice. */
  const room = async (w: number, hh: number): Promise<void> => {
    const wrap = document.querySelector('.tp-wrap') as HTMLElement;
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: w });
    Object.defineProperty(wrap, 'clientHeight', { configurable: true, value: hh });
    tNow.value = tNow.value + 0.5;
    await tick();
  };
  const crash = (): void => {
    const t = templates(topology.value, 0).find((x) => x.id === 'crash');
    if (!t) throw new Error('no crash template');
    applyTemplate(t);
  };
  const wrapClasses = (): DOMTokenList => (document.querySelector('.tp-wrap') as HTMLElement).classList;

  it('opens at a true 1:1, whatever the room, and never caps the drawing to it', async () => {
    crash();
    mountApp();
    await tick();
    expect(zoom.value).toBe(FIT_ZOOM);
    expect(zoomAuto.value).toBe(false);
    for (const [w, hh] of [[2400, 1400], [900, 200]] as const) {
      await room(w, hh);
      /* a small region does not shrink it, and a large one does not grow it */
      expect(zoom.value).toBe(FIT_ZOOM);
      /* the wrap is the scroll port that centres it -- the CSS cap that scaled it
         down behind a "100%" is off */
      expect(wrapClasses().contains('is-zoomed')).toBe(true);
      expect(wrapClasses().contains('is-true')).toBe(true);
      expect(wrapClasses().contains('is-fitted')).toBe(false);
      expect(document.querySelector('.cv-zoom-pct')?.textContent).toBe('100%');
    }
  });

  it('is a drawing to pan only where there is more of it than room', async () => {
    crash();
    mountApp();
    await tick();
    const svg = document.querySelector('.topo-svg') as SVGSVGElement;
    const box = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
    svg.getBoundingClientRect = () => ({ width: box[2], height: box[3], x: 0, y: 0, top: 0, left: 0, right: box[2], bottom: box[3], toJSON: () => ({}) }) as DOMRect;
    await room((box[2] as number) * 2, (box[3] as number) * 2);
    expect(wrapClasses().contains('is-pannable')).toBe(false);
    await room((box[2] as number) / 2, (box[3] as number) / 2);
    expect(wrapClasses().contains('is-pannable')).toBe(true);
    /* and it starts on the middle of the drawing, not its top-left corner */
    const wrap = document.querySelector('.tp-wrap') as HTMLElement;
    expect(wrap.scrollLeft).toBe(Math.round((box[2] as number) / 4));
    expect(wrap.scrollTop).toBe(Math.round((box[3] as number) / 4));
  });

  it('Fit hands the size to the room -- below 1:1 if that is what it takes, and it says so', async () => {
    crash();
    mountApp();
    await tick();
    const box = (document.querySelector('.topo-svg')?.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
    await room(Math.round((box[2] as number) * 0.6), Math.round((box[3] as number) * 2));
    expect(zoom.value).toBe(FIT_ZOOM);
    fitZoom();
    await room(Math.round((box[2] as number) * 0.6), Math.round((box[3] as number) * 2));
    expect(zoomAuto.value).toBe(true);
    expect(zoom.value).toBeLessThan(FIT_ZOOM);
    expect(zoom.value).toBeGreaterThanOrEqual(0.59);
    expect(wrapClasses().contains('is-fitted')).toBe(true);
    expect(document.querySelector('.cv-zoom-pct')?.textContent).toBe(`${Math.round(zoom.value * 100)}%`);
  });

  it('Fit scales up to the top rung in a large room; a zoom takes the size back from the room', async () => {
    crash();
    mountApp();
    await tick();
    fitZoom();
    await room(2400, 1400);
    expect(zoom.value).toBe(AUTO_MAX);
    expect(document.querySelector('.cv-zoom-pct')?.textContent).toBe('140%');
    /* the reader zooms out: a rung, and the room stops deciding */
    zoomBy(-1);
    await tick();
    expect(zoomAuto.value).toBe(false);
    const chosen = zoom.value;
    expect(chosen).toBeLessThan(AUTO_MAX);
    await room(2600, 1500);
    expect(zoom.value).toBe(chosen);
    expect(wrapClasses().contains('is-zoomed')).toBe(true);
  });

  it('follows the room after Fit, when the window or the divider changes it', async () => {
    crash();
    mountApp();
    await tick();
    fitZoom();
    const box = (document.querySelector('.topo-svg')?.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
    await room(Math.round((box[2] as number) * 1.2), Math.round((box[3] as number) * 1.2));
    expect(zoom.value).toBeGreaterThan(FIT_ZOOM);
    await room(1000, 200);
    expect(zoom.value).toBeLessThan(FIT_ZOOM);
  });

  it('is Split only: Build draws the drawing at its own size', async () => {
    crash();
    mode.value = 'build';
    mountApp();
    await tick();
    await room(2400, 1400);
    expect(zoom.value).toBe(FIT_ZOOM);
    expect(wrapClasses().contains('is-fitted')).toBe(false);
    expect(wrapClasses().contains('is-true')).toBe(false);
  });

  it('starts over at 1:1 every time Split is entered, and gives Fit back at its own size when it is left', async () => {
    crash();
    mode.value = 'build';
    mountApp();
    await tick();
    zoomBy(1);
    await tick();
    expect(zoom.value).toBeGreaterThan(FIT_ZOOM);
    mode.value = 'break';
    await tick();
    expect(zoom.value).toBe(FIT_ZOOM);
    expect(zoomAuto.value).toBe(false);
    fitZoom();
    await room(2400, 1400);
    expect(zoom.value).toBe(AUTO_MAX);
    mode.value = 'build';
    await tick();
    expect(zoom.value).toBe(FIT_ZOOM);
  });
});

/* ---------------- 6. the divider ---------------- */

function pointer(type: string, y: number, id = 1): Event {
  const init = { bubbles: true, cancelable: true, button: 0, clientY: y, clientX: 300, pointerId: id };
  if (typeof PointerEvent === 'function') return new PointerEvent(type, init);
  return Object.assign(new MouseEvent(type, init), { pointerId: id });
}

describe('the divider', () => {
  const crash = (): void => {
    const t = templates(topology.value, 0).find((x) => x.id === 'crash');
    if (!t) throw new Error('no crash template');
    applyTemplate(t);
  };

  it('resizes on a press and a release far away with no move between', async () => {
    crash();
    const r = mountApp();
    await tick();
    const bar = r.querySelector('.sb-bar') as HTMLElement;
    const start = timelineDefaultH(window.innerHeight, 80, geometry.value?.viewBox.h);
    bar.dispatchEvent(pointer('pointerdown', 500));
    bar.dispatchEvent(pointer('pointerup', 400));
    expect(timelineH.value).not.toBeNull();
    expect(timelineH.value).toBeGreaterThan(start);
  });

  it('leaves a press that never crossed the slop alone: a click stays a click', async () => {
    crash();
    const r = mountApp();
    await tick();
    const bar = r.querySelector('.sb-bar') as HTMLElement;
    bar.dispatchEvent(pointer('pointerdown', 500));
    bar.dispatchEvent(pointer('pointerup', 502));
    expect(timelineH.value).toBeNull();
  });

  it('does not start on a control in the bar', async () => {
    crash();
    const r = mountApp();
    await tick();
    const btn = r.querySelector('.sb-bar button') as HTMLElement;
    btn.dispatchEvent(pointer('pointerdown', 500));
    (r.querySelector('.sb-bar') as HTMLElement).dispatchEvent(pointer('pointerup', 300));
    expect(timelineH.value).toBeNull();
  });

  it('a drag with moves still works, and a cancel keeps what was dragged to', async () => {
    crash();
    const r = mountApp();
    await tick();
    const bar = r.querySelector('.sb-bar') as HTMLElement;
    bar.dispatchEvent(pointer('pointerdown', 500));
    /* Down first, so the height is short of the window's ceiling (the default region is tall
       enough now that a drag up from it reaches the ceiling at once), then up again. */
    bar.dispatchEvent(pointer('pointermove', 540));
    const mid = timelineH.value;
    expect(mid).not.toBeNull();
    bar.dispatchEvent(pointer('pointermove', 520));
    expect(timelineH.value as number).toBeGreaterThan(mid as number);
    bar.dispatchEvent(pointer('pointercancel', 520));
    expect(bar.classList.contains('is-dragging')).toBe(false);
    expect(memory.get('dg-tl-h')).toBe(String(timelineH.value));
  });

  it('is the whole bar: a drag cursor on it, and the keyboard separator steps and jumps', async () => {
    crash();
    const r = mountApp();
    await tick();
    const grip = r.querySelector('.sb-bar .dock-grip') as HTMLElement;
    expect(grip.getAttribute('role')).toBe('separator');
    const key = (k: string): void => { grip.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
    const start = timelineDefaultH(window.innerHeight, 80, geometry.value?.viewBox.h);
    key('ArrowUp');
    expect(timelineH.value as number).toBeGreaterThan(start);
    const up = timelineH.value as number;
    key('ArrowDown');
    expect(timelineH.value as number).toBeLessThan(up);
    key('End');
    const max = timelineH.value as number;
    key('Home');
    expect(timelineH.value as number).toBeLessThan(max);
  });
});
