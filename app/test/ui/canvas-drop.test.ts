/**
 * Where a dragged card can go (task 1.5): the data centres and hosts that
 * would take it are lit while it is in the air, the ones that cannot are
 * faded, a host that refuses it says why and does not take the drop, and an
 * outline shows where the card will land.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { siteId } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { mode, selection, toast, viewport } from '@/state/view';
import { closeBar } from '@/ui/canvas/bar';
import { fitZoom } from '@/ui/canvas/zoom';
import { addSite } from '@/ui/inspector/edits';
import { landingFor, mergeVerdict, WHY_OBSERVER_ON_DB_HOST } from '@/ui/canvas/drop';
import { layoutTopology } from '@/ui/canvas/layout';
import { graphOf } from './canvas-fixtures';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const topo = (): TopologyDoc => docSignal.value.topology;
const hostOf = (id: string): string =>
  (topo().members.find((m) => (m.id as string) === id)?.instances[0]?.host
    ?? topo().observers.find((o) => (o.id as string) === id)?.host) as string;

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
const clientOf = (root: HTMLElement, x: number, y: number): [number, number] => {
  const vb = root.querySelector('.topo-svg')!.getAttribute('viewBox')!.split(/\s+/).map(Number);
  return [x - vb[0]!, y - vb[1]!];
};
type Box = { x: number; y: number; w: number; h: number };
const boxOf = (el: Element): Box => ({
  x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
  w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')),
});
const cardRect = (root: HTMLElement, id: string): Box =>
  boxOf(root.querySelector(`[data-node="${id}"] rect.tp-card`)!);
const siteClass = (root: HTMLElement, id: string): string =>
  root.querySelector(`[data-node="${id}"] rect.tp-site`)!.getAttribute('class')!;
const nodeClass = (root: HTMLElement, id: string): string =>
  root.querySelector(`.tp-node[data-node="${id}"]`)!.getAttribute('class')!;
const cardClass = (root: HTMLElement, id: string): string =>
  root.querySelector(`.tp-node[data-node="${id}"] rect.tp-card`)!.getAttribute('class')!;

/** Press sby01 and carry it to `to` (drawing units), without letting go. */
const lift = async (root: HTMLElement, to: [number, number]): Promise<Element> => {
  const card = cardRect(root, 'sby01');
  const svg = root.querySelector('.topo-svg')!;
  const start = clientOf(root, card.x + 20, card.y + 20);
  pointer(root.querySelector('[data-node="sby01"]')!, 'Down', ...start);
  pointer(svg, 'Move', ...clientOf(root, ...to));
  await tick();
  return svg;
};

describe('a card in the air', () => {
  it('lights the other data centres and the hosts that would take it, and fades the ones that cannot', async () => {
    const root = await mountApp();
    const card = cardRect(root, 'sby01');
    const svg = await lift(root, [card.x + 20 - 13, card.y + 20 + 5]);
    expect(siteClass(root, 'dc1')).toContain('is-can-drop');
    expect(siteClass(root, 'dc3')).toContain('is-can-drop');
    expect(siteClass(root, 'dc2')).not.toContain('is-can-drop');
    /* The primary's host would take a standby; the observer's would not. */
    expect(cardClass(root, 'prm01')).toContain('is-target-maybe');
    expect(nodeClass(root, 'obs01')).toContain('is-dim');
    /* The outline on the grid under a card that follows the pointer. */
    const ghost = root.querySelector('.tp-ghost')!;
    expect(boxOf(ghost)).toEqual(cardRect(root, 'sby01'));
    expect(root.querySelector('.tp-node[data-node="sby01"]')!.parentElement!.getAttribute('transform'))
      .toBe('translate(3,-3)');
    pointer(svg, 'Up', ...clientOf(root, card.x + 7, card.y + 25));
    await tick();
    expect(root.querySelector('.tp-ghost')).toBeNull();
    expect(root.querySelector('.is-can-drop, .is-target-maybe, .tp-node.is-dim')).toBeNull();
  });

  it('shows the place in the other host\'s stack, and says what the drop does', async () => {
    const root = await mountApp();
    const prm = cardRect(root, 'prm01');
    const svg = await lift(root, [prm.x + prm.w / 2, prm.y + prm.h / 2]);
    expect(cardClass(root, 'prm01')).toContain('is-target');
    expect(root.querySelector('.tp-rubber-tip-tx')?.textContent).toBe('Share host dc1-prm01');
    const ghost = boxOf(root.querySelector('.tp-ghost')!);
    /* Under the primary, in its column. */
    expect(ghost.y).toBeGreaterThan(prm.y);
    expect(Math.abs(ghost.x - prm.x)).toBeLessThan(40);
    pointer(svg, 'Up', ...clientOf(root, prm.x + prm.w / 2, prm.y + prm.h / 2));
    await tick();
    expect(hostOf('sby01')).toBe(hostOf('prm01'));
  });

  it('refuses the observer\'s host, says why, and does not put the standby on it', async () => {
    const root = await mountApp();
    const obs = cardRect(root, 'obs01');
    const svg = await lift(root, [obs.x + obs.w / 2, obs.y + obs.h / 2]);
    expect(cardClass(root, 'obs01')).toContain('is-target-no');
    /* Still over DC 3, so the drop is the move there, and the note says both. */
    expect(root.querySelector('.tp-rubber-tip-tx')?.textContent).toBe('Move to DC 3 — not onto that host');
    pointer(svg, 'Up', ...clientOf(root, obs.x + obs.w / 2, obs.y + obs.h / 2));
    await tick();
    expect(hostOf('sby01')).not.toBe(hostOf('obs01'));
  });

  it('outlines its place inside an empty data centre', async () => {
    addSite();
    const root = await mountApp();
    const panel = boxOf(root.querySelector('[data-node="dc4"] rect.tp-site')!);
    await lift(root, [panel.x + panel.w / 2, panel.y + panel.h / 2]);
    expect(siteClass(root, 'dc4')).toContain('is-drop');
    const ghost = boxOf(root.querySelector('.tp-ghost')!);
    expect(ghost.x).toBeGreaterThanOrEqual(panel.x);
    expect(ghost.x + ghost.w).toBeLessThanOrEqual(panel.x + panel.w);
    expect(ghost.y).toBeGreaterThanOrEqual(panel.y);
  });
});

describe('mergeVerdict', () => {
  it('keeps an observer off a database\'s host and a database off an observer\'s', () => {
    const t = classicDoc().topology;
    expect(mergeVerdict(t, 'obs01', hostOf('prm01'))).toEqual({ state: 'off', why: WHY_OBSERVER_ON_DB_HOST });
    expect(mergeVerdict(t, 'sby01', hostOf('obs01'))).toEqual({ state: 'off', why: WHY_OBSERVER_ON_DB_HOST });
    expect(mergeVerdict(t, 'sby01', hostOf('prm01'))).toEqual({ state: 'on' });
  });
});

describe('landingFor', () => {
  it('is null for a card or a target that is not there', () => {
    const t = classicDoc().topology;
    const graph = graphOf(t);
    const geo = layoutTopology(t, graph);
    expect(landingFor(t, graph, {}, geo, geo.sites, 'nope', { site: 'dc1' })).toBeNull();
    expect(landingFor(t, graph, {}, geo, geo.sites, 'sby01', { site: siteId('nowhere') as string })).toBeNull();
  });
});
