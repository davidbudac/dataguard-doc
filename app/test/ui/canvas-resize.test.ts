/**
 * A data centre's box: it holds still while a card is carried in or out of
 * it, keeps its size when the card is let go inside it, and can be resized
 * from its handles -- persisted, undoable, never smaller than its cards
 * (tasks 1.2 and 1.3 in docs/tasks/ui-followups.md).
 *
 * Asserted through the mounted app, with the same pure hit-test the other
 * gesture tests lean on: jsdom gives the svg a zero rect, so the canvas maps a
 * client point to `view.x + clientX`.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal } from '@/state/doc';
import { resetHistory, undo, undoLabel } from '@/state/history';
import { mode, selection, toast, viewport } from '@/state/view';
import { closeBar } from '@/ui/canvas/bar';
import { fitZoom } from '@/ui/canvas/zoom';
import { LAYOUT } from '@/ui/canvas/layout';
import { siteId } from '@/engine';
import { addDatabase, tidyLayout } from '@/ui/inspector/edits';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mounted: HTMLElement[] = [];
beforeEach(() => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
  selection.value = [];
  toast.value = null;
  mode.value = 'build';
  viewport.value = 'wide';
  closeBar();
  fitZoom();
  resetHistory(classicDoc());
});

const mountApp = async (): Promise<HTMLElement> => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  await tick();
  return root;
};

const pointer = (el: Element, kind: 'Down' | 'Move' | 'Up', x: number, y: number): void => {
  const lower = `pointer${kind.toLowerCase()}`;
  const type = `on${lower}` in el ? lower : `Pointer${kind}`;
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
  }));
};

const viewBoxOf = (root: HTMLElement): number[] =>
  root.querySelector('.topo-svg')!.getAttribute('viewBox')!.split(/\s+/).map(Number);

const clientOf = (root: HTMLElement, x: number, y: number): [number, number] => {
  const vb = viewBoxOf(root);
  return [x - vb[0]!, y - vb[1]!];
};

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (el: Element): Box => ({
  x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
  w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')),
});
const siteRect = (root: HTMLElement, id: string): Box =>
  boxOf(root.querySelector(`[data-node="${id}"] rect.tp-site`)!);
const cardRect = (root: HTMLElement, id: string): Box =>
  boxOf(root.querySelector(`[data-node="${id}"] rect.tp-card`)!);

describe('a card in the air (5.3)', () => {
  it('is drawn over every caption, and the lines to it reach it where it is drawn', async () => {
    const root = await mountApp();
    const card = cardRect(root, 'sby01');
    const svg = root.querySelector('.topo-svg')!;
    const start = clientOf(root, card.x + 20, card.y + 20);
    pointer(root.querySelector('[data-node="sby01"]')!, 'Down', ...start);
    /* 123 and 61: off the 8 px grid, so the card rides short of its snap. */
    pointer(svg, 'Move', start[0] + 123, start[1] + 61);
    await tick();
    const carried = root.querySelector('.tp-carried')!;
    expect(carried).not.toBeNull();
    expect(carried.querySelector('[data-node="sby01"]')).not.toBeNull();
    const pills = root.querySelector('.tp-pills')!;
    expect(pills.compareDocumentPosition(carried) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const [rx, ry] = carried.getAttribute('transform')!.match(/-?[\d.]+/g)!.map(Number);
    expect(rx).not.toBe(0);
    /* The redo line ends on the card's left edge as drawn: snapped box + remainder. */
    const drawn = cardRect(root, 'sby01');
    const redo = [...root.querySelectorAll('.tp-links path.tp-link')]
      .map((p) => p.getAttribute('d')!)
      .find((d) => d.startsWith('M') && d.includes(`${Math.round((drawn.x + rx!) * 10) / 10},`));
    expect(redo).toBeDefined();
    const end = redo!.trim().split(/\s+/).pop()!.replace(/^L/, '').split(',').map(Number);
    expect(end[0]).toBeCloseTo(drawn.x + rx!, 1);
    expect(end[1]).toBeCloseTo(drawn.y + drawn.h / 2 + ry!, 1);
    pointer(svg, 'Up', start[0] + 123, start[1] + 61);
    await tick();
    expect(root.querySelector('.tp-carried')).toBeNull();
  });
});

describe('a card carried inside its data centre', () => {
  it('leaves the box where and how large it was while the card is in the air', async () => {
    const root = await mountApp();
    const before = siteRect(root, 'dc2');
    const vb = viewBoxOf(root);
    const card = cardRect(root, 'sby01');
    const svg = root.querySelector('.topo-svg')!;
    const start = clientOf(root, card.x + 20, card.y + 20);
    pointer(root.querySelector('[data-node="sby01"]')!, 'Down', ...start);
    pointer(svg, 'Move', start[0] + 120, start[1] + 64);
    await tick();
    /* The card has moved; the box and the drawing's frame have not. */
    expect(cardRect(root, 'sby01').x).toBeGreaterThan(card.x);
    expect(siteRect(root, 'dc2')).toEqual(before);
    expect(viewBoxOf(root)).toEqual(vb);
    expect(root.querySelector('.topo-svg.is-dragging')).not.toBeNull();
    pointer(svg, 'Up', start[0] + 120, start[1] + 64);
    await tick();
    expect(root.querySelector('.topo-svg.is-dragging')).toBeNull();
  });

  it('keeps the box\'s size when the card is let go inside it, in the drag\'s own undo', async () => {
    const root = await mountApp();
    const before = siteRect(root, 'dc2');
    const card = cardRect(root, 'sby01');
    const svg = root.querySelector('.topo-svg')!;
    const start = clientOf(root, card.x + 20, card.y + 20);
    pointer(root.querySelector('[data-node="sby01"]')!, 'Down', ...start);
    /* Up and left inside the box: fitted to the card, it would have moved
       and shrunk on the other two sides. */
    pointer(svg, 'Move', start[0] - 8, start[1] - 8);
    pointer(svg, 'Move', start[0] - 8, start[1] - 8);
    await tick();
    pointer(svg, 'Up', start[0] - 8, start[1] - 8);
    await tick();
    const after = siteRect(root, 'dc2');
    expect(after.x + after.w).toBeGreaterThanOrEqual(before.x + before.w);
    expect(after.y + after.h).toBeGreaterThanOrEqual(before.y + before.h);
    expect(after.x).toBeLessThanOrEqual(before.x);
    const held = docSignal.value.layout['dc2'];
    expect(held?.w).toBeDefined();
    expect(undoLabel.value).toBe('Move the sby01 card');
    undo();
    expect(docSignal.value.layout).toEqual({});
  });

  it('writes no size when the move only grows the box', async () => {
    /* A second standby under sby01: dragging it straight down leaves the
       box's top, left and right where sby01 holds them -- it only grows. */
    addDatabase(siteId('dc2'));
    const root = await mountApp();
    const card = cardRect(root, 'sby02');
    const svg = root.querySelector('.topo-svg')!;
    const start = clientOf(root, card.x + 20, card.y + 20);
    pointer(root.querySelector('[data-node="sby02"]')!, 'Down', ...start);
    pointer(svg, 'Move', start[0], start[1] + 40);
    await tick();
    pointer(svg, 'Up', start[0], start[1] + 40);
    await tick();
    expect(docSignal.value.layout['dc2']).toBeUndefined();
    expect(docSignal.value.layout['sby02']).toEqual({ dx: 0, dy: 40 });
  });
});

describe('resizing a data centre from its handles', () => {
  const handle = (root: HTMLElement, site: string, cursor: string, n = 0): Element =>
    root.querySelectorAll(`.tp-resize[data-node="${site}"] .tp-rsz.cur-${cursor}`)[n]!;

  it('draws handles only on a selected data centre', async () => {
    let root = await mountApp();
    expect(root.querySelector('.tp-resize')).toBeNull();
    selection.value = ['dc2'];
    await tick();
    root = mounted[0]!;
    expect(root.querySelectorAll('.tp-resize[data-node="dc2"] .tp-rsz')).toHaveLength(8);
  });

  it('grows the box from a corner, persists it as a sized override, and undoes in one step', async () => {
    selection.value = ['dc2'];
    const root = await mountApp();
    const before = siteRect(root, 'dc2');
    const se = handle(root, 'dc2', 'nwse', 1);
    const svg = root.querySelector('.topo-svg')!;
    const start = clientOf(root, before.x + before.w, before.y + before.h);
    pointer(se, 'Down', ...start);
    pointer(svg, 'Move', start[0] + 30, start[1] + 10);
    pointer(svg, 'Move', start[0] + 64, start[1] + 40);
    await tick();
    pointer(svg, 'Up', start[0] + 64, start[1] + 40);
    await tick();
    const after = siteRect(root, 'dc2');
    expect([after.x, after.y, after.w, after.h]).toEqual([before.x, before.y, before.w + 64, before.h + 40]);
    expect(docSignal.value.layout['dc2']).toEqual({ dx: 0, dy: 0, w: before.w + 64, h: before.h + 40 });
    expect(undoLabel.value).toBe('Resize the DC 2 data centre');
    /* Still selected: a resize is not a click on the ground. */
    expect(selection.value).toEqual(['dc2']);
    undo();
    expect(docSignal.value.layout).toEqual({});
  });

  it('will not cut into the cards it holds', async () => {
    selection.value = ['dc2'];
    const root = await mountApp();
    const before = siteRect(root, 'dc2');
    const nw = handle(root, 'dc2', 'nwse', 0);
    const svg = root.querySelector('.topo-svg')!;
    const start = clientOf(root, before.x, before.y);
    pointer(nw, 'Down', ...start);
    pointer(svg, 'Move', start[0] + 200, start[1] + 200);
    await tick();
    pointer(svg, 'Up', start[0] + 200, start[1] + 200);
    await tick();
    /* The corner stops at the cards, held at the tighter padding a resize
       is allowed: the layout's own box is drawn roomier than that. */
    const slack = LAYOUT.colPad - LAYOUT.fitPad;
    expect(siteRect(root, 'dc2')).toEqual({
      x: before.x + slack, y: before.y + slack, w: before.w - slack, h: before.h - slack,
    });
  });

  it('resizes from the keyboard too: Alt and an arrow on the data centre', async () => {
    const root = await mountApp();
    const before = siteRect(root, 'dc2');
    const g = root.querySelector('[data-node="dc2"].tp-sitewrap')!;
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, shiftKey: true, bubbles: true }));
    await tick();
    const after = siteRect(root, 'dc2');
    expect([after.w, after.h]).toEqual([before.w + 8, before.h + 32]);
  });

  it('is carried with its cards when the data centre is dragged, and reset by Tidy', async () => {
    selection.value = ['dc2'];
    const root = await mountApp();
    const before = siteRect(root, 'dc2');
    const svg = root.querySelector('.topo-svg')!;
    const se = handle(root, 'dc2', 'nwse', 1);
    const corner = clientOf(root, before.x + before.w, before.y + before.h);
    pointer(se, 'Down', ...corner);
    pointer(svg, 'Move', corner[0] + 48, corner[1] + 48);
    await tick();
    pointer(svg, 'Up', corner[0] + 48, corner[1] + 48);
    await tick();
    const grown = siteRect(root, 'dc2');
    /* Now drag the panel itself, from its empty lower right. */
    const from = clientOf(root, grown.x + grown.w - 10, grown.y + grown.h - 30);
    pointer(root.querySelector('[data-node="dc2"].tp-sitewrap')!, 'Down', ...from);
    pointer(svg, 'Move', from[0] + 32, from[1] + 16);
    await tick();
    pointer(svg, 'Up', from[0] + 32, from[1] + 16);
    await tick();
    const moved = siteRect(root, 'dc2');
    expect([moved.x - grown.x, moved.y - grown.y, moved.w, moved.h]).toEqual([32, 16, grown.w, grown.h]);
    tidyLayout([]);
    await tick();
    expect(docSignal.value.layout).toEqual({});
    expect(siteRect(root, 'dc2')).toEqual(before);
  });
});
