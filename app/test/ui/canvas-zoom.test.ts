/**
 * Zoom and pan: looking closer at the drawing without changing it.
 *
 * The whole of the contract, and every clause of it is something that was
 * quietly easy to get wrong:
 *
 *  - **Zoom is the rendered size, never the viewBox.** Every coordinate on the
 *    drawing, every layout golden and the arithmetic that keeps the action bar
 *    inside the view are all in user units, so a zoom that touched the viewBox
 *    would move all three. It multiplies the `width`/`height` attributes and
 *    stops.
 *  - **It is a ladder with ends, and the ends say so.** A grey control states
 *    its reason on every surface of this page; a zoom button is not exempt
 *    just because the convention elsewhere is to go silently dead.
 *  - **Zoom is view state.** It is not in the document, so it is not in the
 *    undo stack, the share link or storage -- this file only asserts the first
 *    half, that the signal lives outside `Doc`, by never touching either.
 *  - **A pan is not a click.** The ground between the cards is where a reader
 *    clicks to mean "never mind"; dragging it scrolls the stage instead, and
 *    the press that did not move has to still mean what it always meant.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import type { TopologyDoc } from '@/engine';
import { TopoCanvas } from '@/ui/canvas/TopoCanvas';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { mode, selection, toast, viewport } from '@/state/view';
import { menuOpen } from '@/ui/canvas/EventMenu';
import { closeBar } from '@/ui/canvas/bar';
import {
  canZoom, fitZoom, WHY_MAX, WHY_MIN, ZOOM_STEPS, zoom, zoomBy, zoomIndex, zoomLabel,
} from '@/ui/canvas/zoom';
import { classic, graphOf } from './canvas-fixtures';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/* Long enough for preact to flush the effects it defers past the paint. */
const painted = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

const mounted: HTMLElement[] = [];
const unmountAll = (): void => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
};

const mountApp = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  return root;
};

interface CanvasProps {
  zoomFactor?: number;
  onZoomStep?: (dir: 1 | -1) => void;
  onClear?: () => void;
}

/**
 * The drawing inside a stage that scrolls, which is what it is mounted in for
 * real: `.app-stage` is the element a pan writes to, and a `TopoCanvas` with
 * no such ancestor deliberately does not pan at all.
 */
const mountCanvas = (
  doc: TopologyDoc, props: CanvasProps = {}, withStage = true,
): { root: HTMLElement; stage: HTMLElement; wrap: HTMLElement } => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  const stage = document.createElement('div');
  if (withStage) stage.className = 'app-stage';
  root.appendChild(stage);
  render(h(TopoCanvas, { doc, graph: graphOf(doc), ...props }), stage);
  const wrap = stage.querySelector('.tp-wrap');
  if (!(wrap instanceof HTMLElement)) throw new Error('no wrap');
  return { root, stage, wrap };
};

const svgOf = (root: ParentNode): SVGSVGElement => {
  const el = root.querySelector('.topo-svg');
  if (!(el instanceof SVGElement)) throw new Error('no drawing');
  return el as SVGSVGElement;
};

const attr = (svg: SVGSVGElement, name: string): number => Number(svg.getAttribute(name));

/**
 * A pointer event the way this environment can carry one.
 *
 * Two jsdom facts, and both of them bite silently. There is no `PointerEvent`,
 * so a `MouseEvent` stands in -- harmless, because the handlers read only
 * `clientX`, `clientY` and `button`. And there is no `onpointerdown` property
 * on an element either, which is what preact tests to decide the listener's
 * name: with the property missing it falls back to the unlowercased
 * `PointerDown`, so a plain `pointerdown` dispatched here reaches nothing at
 * all and every assertion below it passes for the wrong reason. This asks the
 * element the same question preact asked.
 */
const pointer = (el: Element, kind: 'Down' | 'Move' | 'Up', x: number, y: number): void => {
  const lower = `pointer${kind.toLowerCase()}`;
  const type = `on${lower}` in el ? lower : `Pointer${kind}`;
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
  }));
};

const wheel = (el: Element, deltaY: number, init: WheelEventInit = {}): WheelEvent => {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...init });
  el.dispatchEvent(ev);
  return ev;
};

/** The zoom strip's buttons, by their accessible name. */
const zoomBtn = (root: ParentNode, name: string): HTMLButtonElement => {
  const el = [...root.querySelectorAll('.cv-zoom button')]
    .find((b) => b.getAttribute('aria-label') === name);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`no ${name} button`);
  return el;
};

beforeEach(() => {
  unmountAll();
  selection.value = [];
  toast.value = null;
  menuOpen.value = false;
  mode.value = 'build';
  viewport.value = 'wide';
  closeBar();
  fitZoom();
  resetHistory(classicDoc());
});

/* ---------------- the ladder ---------------- */

describe('the zoom ladder has rungs and two ends', () => {
  it('starts at 1:1 and steps one rung at a time', () => {
    expect(zoom.value).toBe(1);
    zoomBy(1);
    expect(zoom.value).toBe(1.2);
    zoomBy(1);
    expect(zoom.value).toBe(1.4);
    zoomBy(-1);
    expect(zoom.value).toBe(1.2);
  });

  it('clamps at both ends rather than walking off them', () => {
    for (let i = 0; i < 10; i += 1) zoomBy(1);
    expect(zoom.value).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    expect(canZoom(1)).toBe(false);
    expect(canZoom(-1)).toBe(true);
    for (let i = 0; i < 20; i += 1) zoomBy(-1);
    expect(zoom.value).toBe(ZOOM_STEPS[0]);
    expect(canZoom(-1)).toBe(false);
    expect(canZoom(1)).toBe(true);
  });

  it('Fit is the way back to the drawing\'s own size', () => {
    zoomBy(-1);
    zoomBy(-1);
    expect(zoom.value).not.toBe(1);
    fitZoom();
    expect(zoom.value).toBe(1);
  });

  it('reads the nearest rung, so nothing can get stuck between two', () => {
    zoom.value = 0.9;
    expect(zoomIndex()).toBe(ZOOM_STEPS.indexOf(0.8));
    zoomBy(1);
    expect(zoom.value).toBe(1);
  });

  it('prints the rung as a percentage', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(0.65)).toBe('65%');
  });
});

/* ---------------- the rendered size, and only that ---------------- */

describe('zoom is the rendered size and never the viewBox', () => {
  const doc = classic('dc3');

  it('multiplies width and height, leaving the viewBox alone', () => {
    const one = svgOf(mountCanvas(doc).root);
    const box = one.getAttribute('viewBox');
    const w = attr(one, 'width');
    const h = attr(one, 'height');
    unmountAll();

    const big = svgOf(mountCanvas(doc, { zoomFactor: 1.4 }).root);
    expect(big.getAttribute('viewBox')).toBe(box);
    expect(attr(big, 'width')).toBe(Math.round(w * 1.4));
    expect(attr(big, 'height')).toBe(Math.round(h * 1.4));
    unmountAll();

    const small = svgOf(mountCanvas(doc, { zoomFactor: 0.5 }).root);
    expect(small.getAttribute('viewBox')).toBe(box);
    expect(attr(small, 'width')).toBe(Math.round(w * 0.5));
  });

  it('releases the fit cap only when it is not at 1:1', () => {
    const wrap = (root: ParentNode): Element => {
      const el = root.querySelector('.tp-wrap');
      if (el === null) throw new Error('no wrap');
      return el;
    };
    expect(wrap(mountCanvas(doc).root).classList.contains('is-zoomed')).toBe(false);
    unmountAll();
    const zoomed = wrap(mountCanvas(doc, { zoomFactor: 1.2 }).root);
    expect(zoomed.classList.contains('is-zoomed')).toBe(true);
    /* Grab is a promise that dragging moves something, so it is offered only
       where the drawing has outgrown its room. */
    expect(zoomed.classList.contains('is-pannable')).toBe(true);
    unmountAll();
    const shrunk = wrap(mountCanvas(doc, { zoomFactor: 0.5 }).root);
    expect(shrunk.classList.contains('is-zoomed')).toBe(true);
    expect(shrunk.classList.contains('is-pannable')).toBe(false);
  });
});

/* ---------------- the strip ---------------- */

describe('the zoom strip drives the drawing', () => {
  it('+, - and Fit change the rendered size and nothing else', async () => {
    const root = mountApp();
    await painted();
    const before = svgOf(root);
    const box = before.getAttribute('viewBox');
    const w = attr(before, 'width');

    zoomBtn(root, 'Zoom in').click();
    await tick();
    expect(attr(svgOf(root), 'width')).toBe(Math.round(w * 1.2));
    expect(svgOf(root).getAttribute('viewBox')).toBe(box);
    expect(root.querySelector('.cv-zoom-pct')?.textContent).toBe('120%');

    zoomBtn(root, 'Zoom out').click();
    zoomBtn(root, 'Zoom out').click();
    await tick();
    expect(attr(svgOf(root), 'width')).toBe(Math.round(w * 0.8));
    expect(svgOf(root).getAttribute('viewBox')).toBe(box);

    zoomBtn(root, 'Fit to page').click();
    await tick();
    expect(attr(svgOf(root), 'width')).toBe(w);
    expect(root.querySelector('.cv-zoom-pct')?.textContent).toBe('100%');
  });

  it('never writes the zoom into the document', async () => {
    const root = mountApp();
    await painted();
    const before = JSON.stringify(docSignal.value);
    zoomBtn(root, 'Zoom in').click();
    await tick();
    expect(JSON.stringify(docSignal.value)).toBe(before);
  });

  it('says why the end of the ladder is grey, at both ends', async () => {
    const root = mountApp();
    await painted();
    /* The reason rides on the grey button itself (its title), not in a pill
       beside it -- a one-glyph toolbar button with a sentence under it doubled
       the strip's height. */
    const reasons = (): string[] =>
      [...root.querySelectorAll<HTMLButtonElement>('.cv-zoom button')]
        /* `Tidy` rides in the same strip and is grey for a reason of its own. */
        .filter((b) => b.disabled && b.getAttribute('aria-label') !== 'Tidy the drawing')
        .map((b) => b.title);

    expect(reasons()).toEqual([]);
    for (let i = 0; i < 4; i += 1) { zoomBtn(root, 'Zoom in').click(); await tick(); }
    expect(zoomBtn(root, 'Zoom in').disabled).toBe(true);
    expect(zoomBtn(root, 'Zoom out').disabled).toBe(false);
    expect(reasons()).toEqual([WHY_MAX]);

    for (let i = 0; i < 8; i += 1) { zoomBtn(root, 'Zoom out').click(); await tick(); }
    expect(zoomBtn(root, 'Zoom out').disabled).toBe(true);
    expect(zoomBtn(root, 'Zoom in').disabled).toBe(false);
    expect(reasons()).toEqual([WHY_MIN]);
  });

  it('is a toolbar with one tab stop and live arrow keys', async () => {
    const root = mountApp();
    await painted();
    const strip = root.querySelector('.cv-zoom');
    expect(strip?.getAttribute('role')).toBe('toolbar');
    const stops = [...root.querySelectorAll('.cv-zoom button')]
      .filter((b) => b.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);

    zoomBtn(root, 'Zoom out').focus();
    strip?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true,
    }));
    await tick();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Zoom in');
  });

  it('is offered in Build and Break, and in neither Configure nor Learn', async () => {
    const root = mountApp();
    await painted();
    expect(root.querySelector('.cv-zoom')).not.toBeNull();
    for (const m of ['break', 'configure', 'learn'] as const) {
      mode.value = m;
      await painted();
      const there = root.querySelector('.cv-zoom') !== null;
      expect(there, m).toBe(m === 'break');
    }
  });
});

/* ---------------- the wheel ---------------- */

describe('the wheel zooms only with the browser\'s own modifier', () => {
  const doc = classic('dc3');

  it('ctrl (or cmd) and the wheel steps the ladder', () => {
    const onZoomStep = vi.fn();
    const svg = svgOf(mountCanvas(doc, { onZoomStep }).root);
    const up = wheel(svg, -120, { ctrlKey: true });
    expect(onZoomStep).toHaveBeenCalledWith(1);
    expect(up.defaultPrevented).toBe(true);
    wheel(svg, 120, { metaKey: true });
    expect(onZoomStep).toHaveBeenLastCalledWith(-1);
  });

  it('leaves a plain wheel to the stage, which is how the rest is reached', () => {
    const onZoomStep = vi.fn();
    const svg = svgOf(mountCanvas(doc, { onZoomStep }).root);
    const ev = wheel(svg, -120);
    expect(onZoomStep).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('is wired to the ladder by the slot', async () => {
    const root = mountApp();
    await painted();
    wheel(svgOf(root), -120, { ctrlKey: true });
    await tick();
    expect(zoom.value).toBe(1.2);
  });
});

/* ---------------- the pan ---------------- */

describe('dragging the ground scrolls the drawing', () => {
  const doc = classic('dc3');

  it('scrolls the wrap, not the stage: the strips above it stay put', async () => {
    const { root, stage, wrap } = mountCanvas(doc, { zoomFactor: 1.4 });
    wrap.scrollLeft = 100;
    wrap.scrollTop = 60;
    const svg = svgOf(root);
    pointer(svg, 'Down', 400, 300);
    /* Under the threshold: still a click, so nothing has moved. */
    pointer(svg, 'Move', 402, 301);
    expect(wrap.scrollLeft).toBe(100);
    /* The paper follows the pointer, so the scroll goes the other way. */
    pointer(svg, 'Move', 370, 280);
    expect(wrap.scrollLeft).toBe(130);
    expect(wrap.scrollTop).toBe(80);
    /* The stage is untouched, which is the whole reason the wrap owns the
       scroll: the zoom control is the wrap's sibling in the stage's flow, and
       a stage that scrolled would carry it off the screen. */
    expect(stage.scrollLeft).toBe(0);
    /* The scroll is written straight to the element, so it is there on the
       move; the grabbing cursor is a class, so it lands on the next render. */
    await tick();
    expect(svg.classList.contains('is-pan')).toBe(true);
    pointer(svg, 'Up', 370, 280);
    await tick();
    expect(svg.classList.contains('is-pan')).toBe(false);
  });

  it('falls back to the stage at 1:1, where the wrap does not scroll', () => {
    /* A drawing can be taller than a short stage with no zoom at all, and the
       press on the ground has always been able to reach it. */
    const { root, stage, wrap } = mountCanvas(doc);
    const svg = svgOf(root);
    pointer(svg, 'Down', 400, 300);
    pointer(svg, 'Move', 340, 280);
    expect(stage.scrollLeft).toBe(60);
    expect(stage.scrollTop).toBe(20);
    expect(wrap.scrollLeft).toBe(0);
  });

  it('does not start on a card: that press is a drag of the card', () => {
    const { root, wrap } = mountCanvas(doc, { zoomFactor: 1.4 });
    wrap.scrollLeft = 40;
    const card = root.querySelector('[data-node]');
    if (card === null) throw new Error('no card');
    pointer(card, 'Down', 400, 300);
    pointer(svgOf(root), 'Move', 340, 300);
    expect(wrap.scrollLeft).toBe(40);
  });

  it('bails silently where nothing above it scrolls', () => {
    /* Learn: the drawing is in the rail, at 1:1, so neither the wrap nor a
       stage is there to write to. */
    const { root } = mountCanvas(doc, {}, false);
    const svg = svgOf(root);
    pointer(svg, 'Down', 400, 300);
    expect(() => pointer(svg, 'Move', 340, 300)).not.toThrow();
    expect(svg.classList.contains('is-pan')).toBe(false);
  });

  it('a press on the ground that did not pan still means "never mind"', () => {
    const onClear = vi.fn();
    const { root, wrap } = mountCanvas(doc, { zoomFactor: 1.4, onClear });
    const svg = svgOf(root);
    pointer(svg, 'Down', 400, 300);
    pointer(svg, 'Move', 401, 300);
    pointer(svg, 'Up', 401, 300);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(wrap.scrollLeft).toBe(0);
  });

  it('a pan that moved is not that press: it clears nothing', () => {
    const onClear = vi.fn();
    const { root } = mountCanvas(doc, { zoomFactor: 1.4, onClear });
    const svg = svgOf(root);
    pointer(svg, 'Down', 400, 300);
    pointer(svg, 'Move', 340, 300);
    pointer(svg, 'Up', 340, 300);
    expect(onClear).not.toHaveBeenCalled();
  });
});
