/**
 * The action bar on the drawing (ui.md SS4, "Event affordances").
 *
 * Three things are asserted here, and the third is the point of the other two:
 *
 *  - **The placement is arithmetic.** `.app-stage` is `overflow: auto` and
 *    clips whatever leaves the viewBox *silently* -- no scrollbar, no hint
 *    that a menu is half off the drawing -- so the bar is placed inside the
 *    view by a pure function a test can walk, at every scale the drawing
 *    renders at.
 *  - **A refusal survives the trip.** The bar is a third surface over the two
 *    action tables, and the rule those tables exist for is that a grey control
 *    says why it is grey on every one of them.
 *  - **It is the same list the rail and the menu show.** Not a similar list:
 *    the same entries in the same order, and the same sentence standing in for
 *    the restores that were dropped.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import type { TopologyDoc } from '@/engine';
import { ActionBar, barFootprint, MAX_ROWS_BREAK } from '@/ui/canvas/ActionBar';
import type { BarAction } from '@/ui/canvas/ActionBar';
import { anchorFor, barRoom, placeBar } from '@/ui/canvas/anchor';
import { barOpen, closeBar } from '@/ui/canvas/bar';
import { layoutTopology, siteLabelRect } from '@/ui/canvas/layout';
import { routeTopology, unionViewBox } from '@/ui/canvas/routing';
import { linkKey } from '@/ui/canvas/LinkPath';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { menuOpen } from '@/ui/canvas/EventMenu';
import { mode, selection, tNow, toast, viewport } from '@/state/view';
import { actionsFor, nothingToRestore, restoreQuietLine } from '@/ui/break/events';
import { WHY } from '@/ui/inspector/why';
import { classic, graphOf } from './canvas-fixtures';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/* Long enough for preact to flush the effects it defers past the paint. */
const painted = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
const ON = { state: 'on' } as const;
const off = (why: string) => ({ state: 'off', why }) as const;

/**
 * Every tree this file mounted, so it can be taken down again.
 *
 * Emptying `document.body` detaches the nodes and leaves the components alive:
 * a `CanvasSlot` from a finished test is still subscribed to `mode`, still
 * runs its effects when that changes, and closed the bar the *next* test had
 * just opened. Unmounting is what actually ends a test.
 */
const mounted: HTMLElement[] = [];
const unmountAll = (): void => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
};

const act = (id: string, label: string, extra: Partial<BarAction> = {}): BarAction => ({
  id, label, enabled: ON, run: () => {}, ...extra,
});

/* ---------------- placement ---------------- */

describe('the bar keeps off the rest of the drawing', () => {
  it('uses the free ground around a small drawing rather than covering its neighbour', () => {
    /* The classic shape: a 224-unit-tall drawing, the standby at the right,
       the observer to its upper left. Clamped to the viewBox alone the bar
       could only go beside the card -- over the observer. With the empty
       stage below the drawing counted in, it hangs underneath. */
    const view = { x: 0, y: 0, w: 1000, h: 224 };
    const anchor = { x: 800, y: 110, w: 184, h: 72 };
    const observer = { x: 400, y: 20, w: 184, h: 60 };
    const size = { w: 170, h: 180 };
    const tight = placeBar(anchor, size, view, [observer]);
    expect(tight.beside).toBe(true);
    const room = barRoom(view, { t: 150, r: 0, b: 200, l: 0 });
    const roomy = placeBar(anchor, size, room, [observer]);
    expect(roomy).toMatchObject({ y: 110 + 72 + 6, flipped: false });
    expect(roomy.x + size.w).toBeLessThanOrEqual(room.x + room.w);
  });

  it('tries the other alignment, then the other side, before covering a card', () => {
    const view = { x: 0, y: 0, w: 1000, h: 600 };
    const anchor = { x: 300, y: 100, w: 184, h: 72 };
    const size = { w: 240, h: 150 };
    /* A card under the anchor's right end: left-aligned below would cover it,
       right-aligned below clears it. */
    const underRight = { x: 500, y: 190, w: 60, h: 60 };
    const a = placeBar(anchor, size, view, [underRight]);
    expect(a).toMatchObject({ x: 300 + 184 - 240, flipped: false });
    /* A card under the whole anchor: above it, then. */
    const under = { x: 0, y: 190, w: 1000, h: 60 };
    const b = placeBar({ ...anchor, y: 300 }, size, view, [{ ...under, y: 390 }]);
    expect(b.flipped).toBe(true);
  });

  it('covers as little as it can when everywhere covers something', () => {
    const view = { x: 0, y: 0, w: 600, h: 600 };
    const anchor = { x: 200, y: 250, w: 184, h: 72 };
    const size = { w: 200, h: 150 };
    const big = { x: 0, y: 0, w: 600, h: 240 };
    const small = { x: 200, y: 330, w: 20, h: 20 };
    const beside = { x: 390, y: 250, w: 210, h: 150 };
    const at = placeBar(anchor, size, view, [big, small, beside]);
    /* Below covers only the small card; above sits on the big one, the right
       on the third, and the left has no room. */
    expect(at.flipped).toBe(false);
    expect(at.beside).toBeUndefined();
  });

  it('grows the room by the measured margins, and not at all without them', () => {
    const view = { x: -10, y: 5, w: 100, h: 50 };
    expect(barRoom(view, { t: 0, r: 0, b: 0, l: 0 })).toEqual(view);
    expect(barRoom(view, { t: 1, r: 2, b: 3, l: 4 })).toEqual({ x: -14, y: 4, w: 106, h: 54 });
  });
});

describe('the bar is placed inside the view, always', () => {
  const view = { x: 0, y: 0, w: 1000, h: 400 };

  it('hangs under the anchor when there is room below it', () => {
    const at = placeBar({ x: 100, y: 40, w: 184, h: 72 }, { w: 240, h: 150 }, view);
    expect(at).toEqual({ x: 100, y: 118, flipped: false });
  });

  it('flips above the anchor rather than falling out of the bottom', () => {
    const at = placeBar({ x: 100, y: 300, w: 184, h: 72 }, { w: 240, h: 150 }, view);
    expect(at.flipped).toBe(true);
    expect(at.y).toBe(300 - 6 - 150);
    expect(at.y + 150).toBeLessThanOrEqual(view.y + view.h);
  });

  it('clamps at both edges of the view rather than hanging off one', () => {
    const left = placeBar({ x: -40, y: 10, w: 60, h: 20 }, { w: 240, h: 100 }, view);
    expect(left.x).toBe(view.x);
    const right = placeBar({ x: 960, y: 10, w: 60, h: 20 }, { w: 240, h: 100 }, view);
    expect(right.x).toBe(view.x + view.w - 240);
  });

  it('goes beside the anchor when above and below would both cover it', () => {
    /* A short view and a tall bar: a card in the middle of a 224-unit-tall
       drawing has no room under it and none over it. Covering the very card
       the reader clicked hides the thing being acted on, so the bar steps to
       the side instead. */
    const short = { x: 0, y: 0, w: 1000, h: 224 };
    const at = placeBar({ x: 100, y: 80, w: 184, h: 72 }, { w: 240, h: 220 }, short);
    expect(at.beside).toBe(true);
    expect(at.x).toBe(100 + 184 + 6);
    expect(at.y + 220).toBeLessThanOrEqual(short.h);
  });

  it('keeps the compensated footprint inside the view at 0.6 scale', () => {
    /* The bar undoes the drawing's scale so its text stays 12 px, which makes
       its footprint in user units *larger*, not smaller, as the drawing
       shrinks. Placing against the CSS size was the first bug here. */
    const css = { w: 240, h: 150 };
    const k = 0.6;
    const user = { w: css.w / k, h: css.h / k };
    expect(user.w).toBe(400);
    const at = placeBar({ x: 900, y: 330, w: 184, h: 72 }, user, view);
    expect(at.x).toBeGreaterThanOrEqual(view.x);
    expect(at.x + user.w).toBeLessThanOrEqual(view.x + view.w);
    expect(at.y).toBeGreaterThanOrEqual(view.y);
    expect(at.y + user.h).toBeLessThanOrEqual(view.y + view.h);
  });
});

describe('the bar knows what it hangs off', () => {
  const doc = classic('dc3');
  const geo = layoutTopology(doc, graphOf(doc));
  const links = routeTopology(doc, graphOf(doc), geo, null).links;

  it('anchors a card on the card', () => {
    const node = geo.byKey.prm01;
    expect(anchorFor('prm01', geo, links)).toEqual({
      x: node?.x, y: node?.y, w: node?.w, h: node?.h,
    });
  });

  it('anchors a data centre on its name band, not on the whole panel', () => {
    const site = geo.sites.find((s) => (s.id as string) === 'dc1');
    expect(site).toBeDefined();
    expect(anchorFor('dc1', geo, links)).toEqual(siteLabelRect(site!));
  });

  it('anchors a link on the caption that names it', () => {
    const link = links.find((l) => l.kind === 'redo');
    expect(link).toBeDefined();
    expect(anchorFor(linkKey(link!), geo, links)).toEqual({ ...link!.pill });
  });

  it('answers nothing for a key the drawing does not draw', () => {
    expect(anchorFor('nope', geo, links)).toBeNull();
  });
});

/* ---------------- the bar itself ---------------- */

const mountBar = (props: Partial<Parameters<typeof ActionBar>[0]> = {}): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(
    h('svg', null, h(ActionBar, {
      x: 0, y: 0, scale: 1, subject: 'prm01', actions: [], onClose: () => {}, ...props,
    })),
    root,
  );
  return root;
};

describe('the bar renders what the table gave it', () => {
  beforeEach(unmountAll);

  it('draws one real button per action, above everything else', () => {
    const root = mountBar({ actions: [act('edit', 'Edit prm01'), act('remove', 'Remove prm01')] });
    const labels = [...root.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent);
    expect(labels).toEqual(['Edit prm01', 'Remove prm01']);
    /* Last in the drawing, so no caption is painted over it. */
    const svg = root.firstElementChild;
    expect(svg?.lastElementChild?.getAttribute('class')).toBe('tp-actions');
  });

  it('says why a refused row is refused, on the row', () => {
    const root = mountBar({
      actions: [act('remove', 'Remove prm01', { enabled: off(WHY.primaryMember) })],
    });
    const button = root.querySelector('.cv-bar-row button');
    expect(button?.hasAttribute('disabled')).toBe(true);
    expect(root.querySelector('.why')?.textContent).toBe(WHY.primaryMember);
  });

  it('presses the row that is the current value of a property', () => {
    const root = mountBar({
      actions: [act('xpt:SYNC', 'SYNC', { pressed: true }), act('xpt:ASYNC', 'ASYNC', { pressed: false })],
    });
    const pressed = [...root.querySelectorAll('.cv-bar-row button')]
      .map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'false']);
  });

  it('prints the quiet line the table handed it, and nothing of its own', () => {
    const line = 'Nothing to restore — nothing here is down.';
    const root = mountBar({ actions: [act('a', 'A')], quiet: line });
    expect([...root.querySelectorAll('.cv-bar-quiet')].map((p) => p.textContent)).toEqual([line]);
  });

  it('stops at six rows and says where the rest are', () => {
    const many = Array.from({ length: 9 }, (_, i) => act(`a${i}`, `Action ${i}`));
    const root = mountBar({ actions: many });
    expect(root.querySelectorAll('.cv-bar-row')).toHaveLength(6);
    expect(root.querySelector('.cv-bar-quiet')?.textContent)
      .toBe('More in the panel on the right.');
  });

  it('declares a box tall enough for the refusals inside it', () => {
    /* Firefox clips a foreignObject to its declared height whatever overflow
       says, so a refusal that wraps must have been counted. */
    const plain = barFootprint([act('a', 'A')]);
    const refused = barFootprint([act('a', 'A', { enabled: off(WHY.primaryMember) })]);
    expect(refused.h).toBeGreaterThan(plain.h + 20);
    const fo = mountBar({ actions: [act('a', 'A', { enabled: off(WHY.primaryMember) })] })
      .querySelector('foreignObject');
    expect(Number(fo?.getAttribute('height'))).toBe(refused.h);
  });

  it('undoes the scale the drawing is rendering at, so its text is not shrunk', () => {
    const root = mountBar({ scale: 0.5, x: 20, y: 30 });
    const g = root.querySelector('.tp-actions > g');
    expect(g?.getAttribute('transform')).toBe('translate(20,30) scale(2)');
  });

  it('takes the focus only when the gesture asked for it', async () => {
    const actions = [act('edit', 'Edit prm01', { enabled: off(WHY.primaryMember) }), act('go', 'Go')];
    mountBar({ actions });
    expect(document.activeElement?.tagName.toLowerCase()).not.toBe('button');
    document.body.innerHTML = '';
    mountBar({ actions, focusOnOpen: true });
    await painted();
    /* The first *enabled* one: landing the focus on a disabled button is
       landing it nowhere. */
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Go');
  });

  it('closes on Escape without clearing the selection behind it', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    const root = mountBar({ actions: [act('a', 'A')], onClose });
    root.addEventListener('keydown', outer);
    const bar = root.querySelector('.cv-bar');
    bar?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes from the button in its header', () => {
    const onClose = vi.fn();
    const root = mountBar({ actions: [act('a', 'A')], onClose });
    (root.querySelector('.cv-bar-x') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ---------------- the shell wires it to the tables ---------------- */

const mountApp = async (): Promise<HTMLElement> => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  /* Preact flushes effects after the paint, and the shell has several: a test
     that clicks before they have run is testing a half-mounted page. */
  await tick();
  return root;
};

const card = (root: HTMLElement, key: string): SVGGElement => {
  const el = root.querySelector(`[data-node="${key}"]`);
  if (!(el instanceof SVGGElement)) throw new Error(`no card ${key}`);
  return el;
};

const barRows = (root: HTMLElement): string[] =>
  [...root.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent ?? '');

/**
 * A pointer-up, under the name preact actually bound.
 *
 * jsdom implements no pointer events, so `'onpointerup' in element` is false
 * and preact falls back to registering the listener under the camel-cased
 * name it was given. A browser takes the lower-case one. Both are the same
 * gesture; this asks the element which one it answers to.
 */
const pointerUp = (el: Element): void => {
  const name = 'onpointerup' in el ? 'pointerup' : 'PointerUp';
  el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }));
};

const clickCard = async (root: HTMLElement, key: string): Promise<void> => {
  card(root, key).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick();
};

/** The `...` handle on the corner of the selected thing: the pointer's way to the bar. */
const handle = (root: HTMLElement): Element | null => root.querySelector('.tp-more');

/** Select it, then ask for the bar the way a pointer does. */
const askBar = async (root: HTMLElement, key: string): Promise<void> => {
  await clickCard(root, key);
  handle(root)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick();
};

describe('the handle on the selected thing offers what can be done to it', () => {
  beforeEach(() => {
    unmountAll();
    selection.value = [];
    toast.value = null;
    tNow.value = 0;
    menuOpen.value = true;
    mode.value = 'build';
    viewport.value = 'wide';
    closeBar();
    resetHistory(classicDoc());
  });

  it('a click in Build selects and offers nothing until it is asked', async () => {
    const root = await mountApp();
    await clickCard(root, 'sby01');
    expect(selection.value).toEqual(['sby01']);
    expect(barOpen.value).toBeNull();
    expect(root.querySelector('.cv-bar')).toBeNull();
    expect(handle(root)?.getAttribute('data-more')).toBe('sby01');
    expect(handle(root)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('the handle closes the bar it opened, and keeps the selection', async () => {
    const root = await mountApp();
    await askBar(root, 'sby01');
    expect(barOpen.value).toBe('sby01');
    handle(root)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    expect(barOpen.value).toBeNull();
    expect(selection.value).toEqual(['sby01']);
  });

  it('opens the Build table on the card that was clicked, Edit first and Remove last', async () => {
    const root = await mountApp();
    await askBar(root, 'sby01');
    expect(barOpen.value).toBe('sby01');
    const rows = barRows(root);
    expect(rows[0]).toBe('Edit sby01');
    expect(rows.at(-1)).toBe('Remove sby01');
    expect(rows).toContain('Make it the primary');
    expect(root.querySelector('.cv-bar-hd .mono')?.textContent).toBe('sby01');
  });

  it('refuses to remove the primary on the bar, in the words the rail uses', async () => {
    const root = await mountApp();
    await askBar(root, 'prm01');
    const remove = [...root.querySelectorAll('.cv-bar-row')]
      .find((r) => r.querySelector('button')?.textContent === 'Remove prm01');
    expect(remove).toBeDefined();
    expect(remove?.querySelector('button')?.hasAttribute('disabled')).toBe(true);
    expect(remove?.querySelector('.why')?.textContent).toBe(WHY.primaryMember);
    expect(docSignal.value.topology.members.map((m) => m.id as string)).toContain('prm01');
  });

  it('runs the row that is not refused', async () => {
    const root = await mountApp();
    await askBar(root, 'sby01');
    const remove = [...root.querySelectorAll('.cv-bar-row button')]
      .find((b) => b.textContent === 'Remove sby01') as HTMLButtonElement;
    remove.click();
    await tick();
    expect(docSignal.value.topology.members.map((m) => m.id as string)).not.toContain('sby01');
  });

  it('closes when the selection moves to something else', async () => {
    const root = await mountApp();
    await askBar(root, 'sby01');
    expect(barOpen.value).toBe('sby01');
    await clickCard(root, 'prm01');
    expect(barOpen.value).toBeNull();
    expect(handle(root)?.getAttribute('data-more')).toBe('prm01');
  });

  it('closes on a click on the ground between the cards', async () => {
    const root = await mountApp();
    await askBar(root, 'sby01');
    const svg = root.querySelector('.topo-svg');
    pointerUp(svg!);
    await tick();
    expect(barOpen.value).toBeNull();
    expect(selection.value).toEqual([]);
  });

  it('opens with the focus in it when the gesture was the context menu', async () => {
    const root = await mountApp();
    card(root, 'sby01').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await painted();
    expect(barOpen.value).toBe('sby01');
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Edit sby01');
  });

  it('offers the Break table, entry for entry, beside the event menu', async () => {
    mode.value = 'break';
    const root = await mountApp();
    await clickCard(root, 'prm01');
    const doc: TopologyDoc = docSignal.value.topology;
    const all = actionsFor(doc, ['prm01'], 0);
    const events = all.filter((a) => a.property !== true);
    const expected = [
      ...events.filter((a) => !nothingToRestore(a)),
      ...all.filter((a) => a.property === true),
    ].map((a) => a.label);
    /* Break's stage is the short one, so its bar shows the first four rows
       and hands the rest to the rail -- in the table's order, nothing skipped. */
    expect(barRows(root)).toEqual(expected.slice(0, MAX_ROWS_BREAK));
    expect(expected.length).toBeGreaterThan(MAX_ROWS_BREAK);
    /* And the same sentence in place of the restores that were dropped. */
    const quiet = restoreQuietLine(doc, ['prm01'], 0, events);
    expect(quiet).not.toBeNull();
    expect([...root.querySelectorAll('.cv-bar-quiet')].map((p) => p.textContent))
      .toContain(quiet);
    expect([...root.querySelectorAll('.evmenu-quiet')].map((p) => p.textContent))
      .toContain(quiet);
  });

  it('injects the event the row names, at the playhead', async () => {
    mode.value = 'break';
    const root = await mountApp();
    await clickCard(root, 'prm01');
    const crash = [...root.querySelectorAll('.cv-bar-row button')]
      .find((b) => (b.textContent ?? '').startsWith('Crash')) as HTMLButtonElement;
    expect(crash).toBeDefined();
    crash.click();
    await tick();
    expect(docSignal.value.topology.events.map((e) => e.kind)).toContain('host.down');
  });

  it('offers nothing on a drawing nobody may edit', async () => {
    viewport.value = 'narrow';
    const root = await mountApp();
    await clickCard(root, 'sby01');
    expect(root.querySelector('.cv-bar')).toBeNull();
  });
});
