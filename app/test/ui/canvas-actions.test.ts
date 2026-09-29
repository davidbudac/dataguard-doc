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
import { ActionBar, barFootprint, MAX_ROWS, menuFootprint } from '@/ui/canvas/ActionBar';
import type { BarAction, BarSection } from '@/ui/canvas/ActionBar';
import {
  anchorFor, barRoom, bodyFor, marginAround, MENU_MIN_H, menuCap, placeBar, unobscured,
} from '@/ui/canvas/anchor';
import { barOpen, closeBar } from '@/ui/canvas/bar';
import { layoutTopology, siteLabelRect } from '@/ui/canvas/layout';
import { routeTopology, unionViewBox } from '@/ui/canvas/routing';
import { linkKey } from '@/ui/canvas/LinkPath';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { menuOpen } from '@/ui/canvas/EventMenu';
import { mode, selection, tNow, toast, viewport } from '@/state/view';
import {
  ACTION_GROUP_LABEL, actionGroup, actionsFor, nothingToRestore, restoreQuietLine,
} from '@/ui/break/events';
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

describe('the bar keeps out from under the floating chrome', () => {
  /* The report: 1440 x 900, Break, the standby at the right-hand edge. The
     wrap is the whole window and the event rail floats over its right-hand
     side from x = 1087; the wrap's padding is what keeps the drawing clear
     of it. Measured from the wrap's border box, the free ground ran on under
     the rail, and the bar placed beside the card was painted beneath it. */
  const wrapBorder = { x: 0, y: 0, w: 1440, h: 900 };
  /* The content box: the top bar, the palette, the rail, the dock taken off. */
  const content = { x: 120, y: 98, w: 1440 - 120 - 371, h: 900 - 98 - 150 };
  const rail = { x: 1087, y: 80, w: 341, h: 640 };
  const pill = { x: 860, y: 740, w: 220, h: 34 };
  const dock = { x: 12, y: 776, w: 1416, h: 112 };

  it('carves every piece of chrome out of the ground, keeping the larger side', () => {
    const free = unobscured(wrapBorder, [rail, dock]);
    expect(free.x + free.w).toBeLessThanOrEqual(rail.x);
    expect(free.y + free.h).toBeLessThanOrEqual(dock.y);
    /* The content box already clears the rail; the pill still reaches into
       its bottom edge, and a thin strip is cheaper than a wide one. */
    const clear = unobscured(content, [rail, pill, dock]);
    expect(clear).toEqual({ ...content, h: pill.y - content.y });
  });

  it('leaves the ground alone where nothing floats over it', () => {
    expect(unobscured(content, [{ x: 0, y: 0, w: 50, h: 50 }])).toEqual(content);
  });

  it('never places the bar under a right-hand rail, even beside a card at the edge', () => {
    /* The drawing at 1:1, centred in the content box; the standby's card
       at its right-hand end. */
    const svg = { x: 200, y: 330, w: 800, h: 224 };
    const view = { x: 0, y: 0, w: 800, h: 224 };
    const u = 1;
    const anchor = { x: 610, y: 100, w: 184, h: 72 };
    /* Tall enough that neither under nor over the card fits: it goes beside. */
    const size = { w: 243, h: 420 };
    const free = unobscured(content, [rail, pill, dock]);
    const room = barRoom(view, marginAround(svg, free, u));
    const at = placeBar(anchor, size, room);
    /* Back into page pixels: the bar's right edge is left of the rail. */
    const right = svg.x + (at.x + size.w) / u;
    expect(at.beside).toBe(true);
    expect(right).toBeLessThanOrEqual(rail.x);
    /* And measured the old way, from the border box, the same bar went
       beside the card and ran under the rail -- the bug as reported. */
    const old = barRoom(view, marginAround(svg, wrapBorder, u));
    const was = placeBar(anchor, size, old);
    expect(svg.x + (was.x + size.w) / u).toBeGreaterThan(rail.x);
  });

  it('shrinks the room inside the drawing where the visible ground stops short of it', () => {
    /* Zoomed: the drawing is larger than the ground and scrolled under the
       rail; the room is the part of the viewBox that can be seen. */
    const svg = { x: 0, y: 0, w: 2000, h: 1000 };
    const free = { x: 120, y: 98, w: 900, h: 600 };
    const m = marginAround(svg, free, 0.5);
    expect(m).toEqual({ t: -49, r: -490, b: -151, l: -60 });
    const room = barRoom({ x: 0, y: 0, w: 1000, h: 500 }, m);
    expect(room).toEqual({ x: 60, y: 49, w: 450, h: 300 });
  });

  it('keeps the bar inside the room for a card the rail half covers', () => {
    const room = { x: 0, y: 0, w: 900, h: 240 };
    const anchor = { x: 820, y: 84, w: 184, h: 72 };
    const size = { w: 264, h: 230 };
    const at = placeBar(anchor, size, room);
    expect(at.x).toBeGreaterThanOrEqual(room.x);
    expect(at.x + size.w).toBeLessThanOrEqual(room.x + room.w);
    expect(at.y).toBeGreaterThanOrEqual(room.y);
    expect(at.y + size.h).toBeLessThanOrEqual(room.y + room.h);
  });

  it('falls back to the viewBox when no ground is left at all', () => {
    const view = { x: 0, y: 0, w: 100, h: 100 };
    expect(barRoom(view, { t: -60, r: 0, b: -60, l: 0 })).toEqual(view);
  });
});

describe('a menu taller than its room scrolls rather than running under the chrome', () => {
  const room = { x: 0, y: 0, w: 1000, h: 500 };
  const anchor = { x: 400, y: 60, w: 184, h: 72 };

  it('is not cut when it fits under the card', () => {
    expect(menuCap(anchor, room, 1, 200)).toBeNull();
  });

  it('is cut to the ground under the card, where that leaves a usable list', () => {
    const cap = menuCap(anchor, room, 1, 900);
    expect(cap).toBe(500 - (60 + 72 + 6));
    expect(placeBar(anchor, { w: 264, h: cap as number }, room).flipped).toBe(false);
  });

  it('is cut in CSS pixels, so it still fits at the drawing\'s scale', () => {
    const cap = menuCap(anchor, room, 0.6, 900) as number;
    expect(cap / 0.6).toBeLessThanOrEqual(500 - (60 + 72 + 6));
  });

  it('goes beside, whole, rather than scroll under the card when the ground beside holds it', () => {
    /* sby01 at the right of the drawing: 300 px under it, 600 px of empty
       ground to its left. Cut to a 300 px scroll under the card was the old
       answer; the whole list beside it is the better one. */
    const wide = { x: 0, y: 0, w: 1000, h: 520 };
    const sby = { x: 800, y: 140, w: 184, h: 72 };
    const natural = 450;
    expect(menuCap(sby, wide, 1, natural)).toBe(520 - (140 + 72 + 6));
    const cap = menuCap(sby, wide, 1, natural, { width: 264 });
    expect(cap).toBeNull();
    const at = placeBar(sby, { w: 264, h: natural }, wide);
    expect(at.beside).toBe(true);
    expect(at.x + 264).toBeLessThanOrEqual(sby.x);
    expect(at.y + natural).toBeLessThanOrEqual(wide.y + wide.h);
  });

  it('when no side holds it whole, scrolls on the side with the most room', () => {
    const wide = { x: 0, y: 0, w: 1000, h: 520 };
    const sby = { x: 800, y: 140, w: 184, h: 72 };
    /* Taller than the whole room: cut to the room's height, beside. */
    const cap = menuCap(sby, wide, 1, 900, { width: 264 });
    expect(cap).toBe(520);
    const at = placeBar(sby, { w: 264, h: cap as number }, wide);
    expect(at.beside).toBe(true);
    /* No ground beside it wide enough: cut to the ground under the card. */
    const narrow = { x: 700, y: 0, w: 300, h: 520 };
    expect(menuCap(sby, narrow, 1, 450, { width: 264 })).toBe(520 - (140 + 72 + 6));
  });

  it('goes beside the card, cut to the whole room, when neither side is enough', () => {
    const short = { x: 0, y: 0, w: 1000, h: 240 };
    const mid = { x: 100, y: 84, w: 184, h: 72 };
    const cap = menuCap(mid, short, 1, 900);
    expect(cap).toBe(240);
    expect(MENU_MIN_H).toBeGreaterThan(84);
  });
});

describe('a data centre\'s menu keeps off the cards inside it', () => {
  it('stands beside the box, not beside its name band over its own cards', () => {
    /* DC 1 with two cards in it, free ground to its right. The name band is
       the anchor; beside the band is still inside the box. */
    const box = { x: 0, y: 0, w: 420, h: 300 };
    const band = { x: 150, y: 6, w: 120, h: 20 };
    const cards = [{ x: 20, y: 60, w: 184, h: 72 }, { x: 220, y: 60, w: 184, h: 72 }];
    const room = { x: 0, y: 0, w: 900, h: 320 };
    const size = { w: 264, h: 280 };
    const old = placeBar(band, size, room, cards);
    const covered = (p: { x: number; y: number }): boolean => cards.some((c) =>
      p.x < c.x + c.w && p.x + size.w > c.x && p.y < c.y + c.h && p.y + size.h > c.y);
    expect(covered(old)).toBe(true);
    const at = placeBar(band, size, room, cards, box);
    expect(at.beside).toBe(true);
    expect(at.x).toBe(box.x + box.w + 6);
    expect(covered(at)).toBe(false);
  });

  it('counts every card in the data centre as an obstacle on the real drawing', () => {
    const doc = classic('dc3');
    const geo = layoutTopology(doc, graphOf(doc));
    const links = routeTopology(doc, graphOf(doc), geo, null).links;
    const view = unionViewBox(geo.viewBox, routeTopology(doc, graphOf(doc), geo, null).bounds);
    const site = geo.sites[0]!;
    const key = site.id as string;
    const anchor = anchorFor(key, geo, links)!;
    const body = bodyFor(key, geo)!;
    expect(body).toEqual({ x: site.x, y: site.y, w: site.w, h: site.h });
    expect(bodyFor('prm01', geo)).toBeNull();
    /* The obstacle list TopoCanvas builds for a site key: every card and
       every caption, the site's own cards included. */
    const obstacles = [
      ...Object.entries(geo.byKey).filter(([k]) => k !== key).map(([, n]) => n),
      ...links.map((l) => l.pill),
    ];
    const own = geo.nodes.filter((n) => (n.site as string) === key);
    expect(own.length).toBeGreaterThan(0);
    for (const n of own) expect(obstacles).toContain(geo.byKey[n.key]);
    /* A short room (the dock open) with free ground to the left of the
       drawing: the menu goes there, over nothing. */
    const room = barRoom(view, { t: 0, r: 0, b: 0, l: 400 });
    const size = { w: 264, h: Math.min(view.h, 200) };
    const at = placeBar(anchor, size, room, obstacles, body);
    const box = { x: at.x, y: at.y, w: size.w, h: size.h };
    for (const o of obstacles) {
      const hit = box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y;
      expect(hit, `covers ${JSON.stringify(o)}`).toBe(false);
    }
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

  it('stops at seven rows and says where the rest are', () => {
    const many = Array.from({ length: 9 }, (_, i) => act(`a${i}`, `Action ${i}`));
    const root = mountBar({ actions: many });
    expect(root.querySelectorAll('.cv-bar-row')).toHaveLength(MAX_ROWS);
    expect(MAX_ROWS).toBe(7);
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

describe('Break draws the bar as a grouped menu', () => {
  beforeEach(unmountAll);

  const sections: BarSection[] = [
    {
      id: 'fail', label: 'Fail', actions: [
        act('host.down', 'Crash sby01-host', { icon: 'crash' }),
        act('member.down', 'SHUTDOWN ABORT sby01', { icon: 'shutdown' }),
      ],
    },
    {
      id: 'role', label: 'Role change', actions: [
        act('cmd.switchover', 'SWITCHOVER TO sby01', { icon: 'switchover' }),
        act('cmd.reinstate', 'REINSTATE DATABASE sby01', {
          icon: 'reinstate', enabled: off(WHY.notFormerPrimary),
        }),
      ],
    },
    { id: 'restore', label: 'Restore', actions: [], quiet: 'Nothing to restore — nothing here is down.' },
  ];
  const all = sections.flatMap((sec) => sec.actions);

  it('shows every row, grouped, each led by its glyph', () => {
    const many = Array.from({ length: 12 }, (_, i) => act(`a${i}`, `Action ${i}`, { icon: 'crash' }));
    const root = mountBar({ actions: many, sections: [{ id: 'fail', label: 'Fail', actions: many }] });
    expect(root.querySelectorAll('.cv-mi')).toHaveLength(12);
    expect(root.querySelectorAll('.cv-mi svg.cv-mi-ico')).toHaveLength(12);
    expect(root.textContent).not.toContain('More in');
    expect(root.querySelector('.cv-menu-lbl')?.textContent).toBe('Fail');
  });

  it('keeps a refusal as visible text under its dimmed row', () => {
    const root = mountBar({ actions: all, sections });
    const row = [...root.querySelectorAll('.cv-mi')].find((r) => r.classList.contains('is-off'));
    expect(row?.querySelector('button')?.hasAttribute('disabled')).toBe(true);
    expect(row?.querySelector('.why')?.textContent).toBe(WHY.notFormerPrimary);
    expect([...root.querySelectorAll('.cv-bar-quiet')].map((p) => p.textContent))
      .toEqual(['Nothing to restore — nothing here is down.']);
  });

  it('names its subject and the moment in the header', () => {
    const root = mountBar({ subject: 'sby01', actions: all, sections, when: 'at t = 12.3 s' });
    expect(root.querySelector('.cv-bar-hd')?.textContent).toContain('sby01 · at t = 12.3 s');
  });

  it('declares its whole natural height, or the cap it scrolls inside', () => {
    const natural = menuFootprint(sections);
    const free = mountBar({ actions: all, sections }).querySelector('foreignObject');
    expect(Number(free?.getAttribute('height'))).toBe(natural.h);
    unmountAll();
    const root = mountBar({ actions: all, sections, maxHeight: 90 });
    expect(Number(root.querySelector('foreignObject')?.getAttribute('height'))).toBe(90);
    const el = root.querySelector('.cv-bar') as HTMLElement;
    expect(el.style.getPropertyValue('max-height')).toBe('88px');
    expect(el.getAttribute('style')).not.toBeNull();
  });

  it('counts a refusal in the height, so Firefox does not clip it', () => {
    const plain = menuFootprint([{ id: 'x', label: 'X', actions: [act('a', 'A')] }]);
    const refused = menuFootprint([{ id: 'x', label: 'X', actions: [act('a', 'A', { enabled: off(WHY.primaryMember) })] }]);
    expect(refused.h).toBeGreaterThan(plain.h + 14);
  });

  it('walks its rows with the arrows, skipping the refused ones', () => {
    const outer = vi.fn();
    const root = mountBar({ actions: all, sections });
    root.addEventListener('keydown', outer);
    const buttons = [...root.querySelectorAll('.cv-mi-btn')] as HTMLButtonElement[];
    const live = buttons.filter((b) => !b.disabled);
    const key = (k: string): void => {
      (document.activeElement ?? root.querySelector('.cv-bar'))!
        .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    };
    live[0]!.focus();
    key('ArrowDown');
    expect(document.activeElement).toBe(live[1]);
    key('ArrowDown');
    expect(document.activeElement).toBe(live[2]);
    /* The refused REINSTATE is skipped: round to the top. */
    key('ArrowDown');
    expect(document.activeElement).toBe(live[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(live.at(-1));
    key('Home');
    expect(document.activeElement).toBe(live[0]);
    key('End');
    expect(document.activeElement).toBe(live.at(-1));
    /* The drawing's own arrows never saw them. */
    expect(outer).not.toHaveBeenCalled();
  });

  it('still closes on Escape and still takes the focus when asked', async () => {
    const onClose = vi.fn();
    mountBar({ actions: all, sections, onClose, focusOnOpen: true });
    await painted();
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Crash sby01-host');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
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

  it('offers the whole Break table, entry for entry, beside the event menu', async () => {
    mode.value = 'break';
    const root = await mountApp();
    await clickCard(root, 'prm01');
    const doc: TopologyDoc = docSignal.value.topology;
    const all = actionsFor(doc, ['prm01'], 0);
    const events = all.filter((a) => a.property !== true);
    const offered = [
      ...events.filter((a) => !nothingToRestore(a)),
      ...all.filter((a) => a.property === true),
    ];
    /* Every row, nothing capped and nothing handed to the rail. */
    expect([...barRows(root)].sort()).toEqual(offered.map((a) => a.label).sort());
    expect(root.querySelector('.cv-bar')?.textContent).not.toContain('More in');
    /* Each row under its group's label, and each refused row keeps its
       reason as visible text under it, in the table's own words. */
    for (const a of offered) {
      const row = [...root.querySelectorAll('.cv-mi')]
        .find((r) => r.querySelector('button')?.textContent === a.label);
      expect(row, a.label).toBeDefined();
      const sec = row?.closest('.cv-menu-sec');
      expect(sec?.querySelector('.cv-menu-lbl')?.textContent).toBe(ACTION_GROUP_LABEL[actionGroup(a)]);
      if (a.enabled.state === 'off') {
        expect(row?.querySelector('button')?.hasAttribute('disabled')).toBe(true);
        expect(row?.querySelector('.why')?.textContent).toBe(a.enabled.why);
      }
      /* The event's glyph leads the row. */
      expect(row?.querySelector('svg.cv-mi-ico')).not.toBeNull();
    }
    /* Inside a group, what can be pressed comes before what cannot. */
    for (const sec of root.querySelectorAll('.cv-menu-sec')) {
      const off = [...sec.querySelectorAll('.cv-mi')].map((r) => r.classList.contains('is-off'));
      expect(off).toEqual([...off].sort((a, b) => Number(a) - Number(b)));
    }
    /* The setting rides last, in a group of its own. */
    const labels = [...root.querySelectorAll('.cv-menu-lbl')].map((p) => p.textContent);
    if (offered.some((a) => a.property === true)) expect(labels.at(-1)).toBe(ACTION_GROUP_LABEL.setting);
    /* And the same sentence in place of the restores that were dropped, in
       the Restore group where they would have been. */
    const quiet = restoreQuietLine(doc, ['prm01'], 0, events);
    expect(quiet).not.toBeNull();
    const quietEl = [...root.querySelectorAll('.cv-bar-quiet')].find((p) => p.textContent === quiet);
    expect(quietEl?.closest('.cv-menu-sec')?.querySelector('.cv-menu-lbl')?.textContent)
      .toBe(ACTION_GROUP_LABEL.restore);
    expect([...root.querySelectorAll('.evmenu-quiet')].map((p) => p.textContent))
      .toContain(quiet);
  });

  it('says in its header when the events land, off the playhead the rail reads', async () => {
    mode.value = 'break';
    tNow.value = 12.34;
    const root = await mountApp();
    await clickCard(root, 'sby01');
    expect(root.querySelector('.cv-bar-hd .mono')?.textContent).toBe('sby01');
    expect(root.querySelector('.cv-bar-when')?.textContent).toBe(' · at t = 12.3 s');
  });

  it('takes the quick icons off the card whose menu is open', async () => {
    mode.value = 'break';
    const root = await mountApp();
    const over = (el: Element): void => {
      const name = 'onpointerover' in el ? 'pointerover' : 'PointerOver';
      el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }));
    };
    over(card(root, 'sby01'));
    await tick();
    expect(root.querySelector('[data-tools="sby01"]')).not.toBeNull();
    await clickCard(root, 'sby01');
    over(card(root, 'sby01'));
    await tick();
    expect(barOpen.value).toBe('sby01');
    expect(root.querySelector('[data-tools="sby01"]')).toBeNull();
    /* Another card still offers its own. */
    over(card(root, 'prm01'));
    await tick();
    expect(root.querySelector('[data-tools="prm01"]')).not.toBeNull();
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

describe('RAC on the bar and in the Break menu', () => {
  it('offers + Instance on a database card and keeps Remove on the bar', async () => {
    const { buildActionsForKey } = await import('@/ui/build/actions');
    const doc = classicDoc().topology;
    const ids = buildActionsForKey(doc, 'sby01').map((a) => a.id);
    expect(ids).toContain('instance:add');
    expect(ids.indexOf('instance:add')).toBeLessThan(ids.indexOf('remove'));
    expect(ids.indexOf('remove')).toBeLessThan(MAX_ROWS);
    /* A far sync card has no + Instance. */
    const { PRESETS } = await import('@/presets');
    const fs = PRESETS.find((p) => p.id === 'far-sync-zero-loss')!.doc();
    const fsId = fs.members.find((m) => m.kind === 'farsync')!.id as string;
    expect(buildActionsForKey(fs, fsId).map((a) => a.id)).not.toContain('instance:add');
  });

  it('offers "Move apply to" on a RAC standby, refused on a stopped instance', async () => {
    const { PRESETS } = await import('@/presets');
    const doc = PRESETS.find((p) => p.id === 'rac-standby')!.doc();
    const acts = actionsFor(doc, ['sby01'], 1);
    const to11 = acts.find((a) => a.id === 'cmd.setApplyInstance:sby011');
    const to12 = acts.find((a) => a.id === 'cmd.setApplyInstance:sby012');
    expect(to12?.enabled.state).toBe('on');
    /* The preset stops sby011 at t = 0. */
    expect(to11?.enabled.state).toBe('off');
    /* The primary is not offered it. */
    expect(actionsFor(doc, ['prm01'], 1).some((a) => a.id.startsWith('cmd.setApplyInstance'))).toBe(false);
  });
});
