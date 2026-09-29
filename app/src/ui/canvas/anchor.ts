/**
 * Where the action bar hangs, in the drawing's own units.
 *
 * Two pure functions, and they are pure for the reason the layout module is:
 * the placement is the part that is easy to get wrong in a way nobody notices
 * until a reader on a 1280 screen loses half a menu, so it is arithmetic a
 * test can walk rather than something only a browser can tell you.
 *
 * The one constraint that decides the whole shape of this: **the stage clips
 * silently.** `.app-stage` is `overflow: auto`, and ink that leaves the
 * viewBox is simply not painted -- no scrollbar appears, nothing indicates
 * there was more. So the bar is placed *inside* the viewBox and the viewBox is
 * never grown to hold it: unioning the bar into it would re-scale the whole
 * drawing every time a menu opened, which is a page that moves under the
 * reader's hand.
 *
 * The footprint handed in here is already in user units -- the bar is drawn
 * inside a `scale(1/k)` group so its text stays 12 px on screen whatever the
 * drawing is scaled to, and that makes its footprint in *user* units the CSS
 * size divided by k, which is larger, not smaller, when the drawing is shrunk.
 * Placing against the CSS size was the first bug here.
 */

import type { Geometry } from './layout';
import { siteLabelRect } from './layout';
import type { Rect } from './measure';
import type { RoutedLink } from './routing';
import { linkKey } from './LinkPath';

/** The gap between the anchor and the bar, in user units. */
export const BAR_GAP = 6;

/**
 * The rectangle the bar hangs off, or `null` when the key names nothing on
 * the drawing.
 *
 * A member or an observer anchors on its card, a data centre on its *name
 * band* rather than on the whole panel (a bar under a 118 px tall rectangle
 * reads as belonging to the drawing, not to the site), and a link on the pill
 * that names it -- which is the half of a link that is a control.
 */
export function anchorFor(
  key: string, geo: Geometry, routed: readonly RoutedLink[],
): Rect | null {
  const node = geo.byKey[key];
  if (node) return { x: node.x, y: node.y, w: node.w, h: node.h };
  const site = geo.sites.find((s) => (s.id as string) === key);
  if (site) return siteLabelRect(site);
  const link = routed.find((l) => linkKey(l) === key);
  if (link) return { ...link.pill };
  return null;
}

/**
 * The scale the bar actually compensates for.
 *
 * Ideally the drawing's own -- `1/k` up, so 12 px text stays 12 px. But six
 * rows come to about 200 CSS px and the shortest drawing here is 224 user
 * units tall, so at k = 0.8 a fully compensated bar is taller than the whole
 * view and the stage cuts the bottom off it *silently*. Where that would
 * happen the compensation is reduced to the largest one that still fits: the
 * text ends up a little smaller than 12 px, which is a legible bar, rather
 * than a bar with its last row and its refusal below the fold.
 *
 * Never below `k`: the bar is never drawn *smaller* than the drawing it sits
 * on, only less magnified than it would like to be.
 */
export function fittedScale(
  size: { w: number; h: number }, view: { w: number; h: number }, k: number,
): number {
  return Math.max(k, size.h / view.h, size.w / view.w);
}

export interface BarPlacement {
  x: number;
  y: number;
  /** True when it had to go above the anchor to stay inside the view. */
  flipped: boolean;
  /** True when neither below nor above fit and it went beside the anchor. */
  beside?: boolean;
}

/**
 * Where the bar may be painted: the viewBox, grown by the free ground the wrap
 * leaves around the drawing -- or shrunk, where that ground is negative.
 *
 * The svg paints its overflow (`.topo-svg { overflow: visible }`) and the wrap
 * centres a drawing that is smaller than its room, so a small configuration
 * sits in a band of empty stage. Clamping the bar to the viewBox alone put it
 * *on* the drawing -- over the card beside the one it was about -- while that
 * ground stood empty. `margin` is that ground in user units, measured by
 * `CanvasSlot` against the part of the wrap nothing floats over
 * (`unobscured`, `marginAround`). A negative side means the visible ground
 * stops *inside* the viewBox: a zoomed drawing scrolled under the rail, or a
 * corner of the drawing under the zoom pill.
 *
 * A room with no area left (a drawing scrolled almost out of sight) is not a
 * room: the viewBox is the honest bound again.
 */
export function barRoom(
  view: { x: number; y: number; w: number; h: number },
  margin: { t: number; r: number; b: number; l: number },
): { x: number; y: number; w: number; h: number } {
  const room = {
    x: view.x - margin.l,
    y: view.y - margin.t,
    w: view.w + margin.l + margin.r,
    h: view.h + margin.t + margin.b,
  };
  return room.w > 0 && room.h > 0 ? room : view;
}

/**
 * The part of `room` that none of `chrome` covers, in whatever unit both are
 * in (the caller's are CSS pixels, from `getBoundingClientRect`).
 *
 * In the floating layout the wrap is the whole window and the top bar, the
 * palette, the rail, the zoom pill and the timeline dock float *over* it. The
 * wrap's padding already keeps the drawing clear of them, so `room` is its
 * content box; this carves out whatever still reaches into it (the zoom pill
 * does, by a few pixels). Each piece of chrome that overlaps is cut off along
 * the side that keeps the most area -- a card at the right edge takes the
 * right-hand strip, a band along the bottom takes the bottom -- so the answer
 * is always one rectangle, which is what `placeBar` places inside.
 */
export function unobscured(room: Rect, chrome: readonly Rect[]): Rect {
  let r = room;
  for (const c of chrome) {
    if (overlap(r, c) === 0) continue;
    const pieces: Rect[] = [
      { x: r.x, y: r.y, w: r.w, h: c.y - r.y },
      { x: r.x, y: c.y + c.h, w: r.w, h: r.y + r.h - (c.y + c.h) },
      { x: r.x, y: r.y, w: c.x - r.x, h: r.h },
      { x: c.x + c.w, y: r.y, w: r.x + r.w - (c.x + c.w), h: r.h },
    ];
    let best: Rect = { x: r.x, y: r.y, w: 0, h: 0 };
    for (const p of pieces) {
      if (p.w > 0 && p.h > 0 && p.w * p.h > best.w * best.h) best = p;
    }
    r = best;
  }
  return r;
}

/**
 * The free ground around the painted drawing, per side, in user units.
 *
 * `svg` is where the drawing is painted and `free` the ground the bar may
 * use, both in CSS pixels; `u` is user units per CSS pixel. Positive ground
 * keeps `inset` pixels clear of the free area's edge, so the bar never sits
 * flush against the chrome; ground that is already negative (the free area
 * ends inside the drawing) is kept as it is -- it is the drawing that is
 * covered there, and the bar may not go there either.
 */
export function marginAround(
  svg: Rect, free: Rect, u: number, inset = 8,
): { t: number; r: number; b: number; l: number } {
  const side = (px: number): number => Math.round((px >= inset ? px - inset : Math.min(0, px)) * u);
  return {
    t: side(svg.y - free.y),
    r: side(free.x + free.w - (svg.x + svg.w)),
    b: side(free.y + free.h - (svg.y + svg.h)),
    l: side(svg.x - free.x),
  };
}

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * Below the anchor, above it, then beside it -- the first of those that fits
 * the room *and* covers none of `obstacles` (the other cards and captions).
 * When every candidate covers something, the one that covers least; when none
 * fits at all, pinned at the top left of the room.
 *
 * Each side is tried twice, left-aligned with the anchor and right-aligned
 * with it, because a card at the right of the drawing has the bar's width to
 * its left and not to its right. The clamp is `max(room, min(x, far edge))`
 * in that order, so a footprint larger than the room pins to its top left
 * corner rather than jumping to the far edge. `test/ui/canvas-presets.test.ts`
 * walks every preset at every frame to keep the bar inside.
 */
export function placeBar(
  anchor: Rect,
  size: { w: number; h: number },
  view: { x: number; y: number; w: number; h: number },
  obstacles: readonly Rect[] = [],
): BarPlacement {
  const bottom = view.y + view.h;
  const clampX = (x: number): number => Math.max(view.x, Math.min(x, view.x + view.w - size.w));
  const clampY = (y: number): number => Math.max(view.y, Math.min(y, bottom - size.h));
  /* Slid back inside the room, too, for an anchor scrolled partly out of
     it (a zoomed drawing): the bar stays on the ground that can be seen. */
  const below = Math.max(anchor.y + anchor.h + BAR_GAP, view.y);
  const above = Math.min(anchor.y - BAR_GAP - size.h, bottom - size.h);
  const right = anchor.x + anchor.w + BAR_GAP;
  const left = anchor.x - BAR_GAP - size.w;
  const alignL = clampX(anchor.x);
  const alignR = clampX(anchor.x + anchor.w - size.w);
  const candidates: BarPlacement[] = [];
  if (below + size.h <= bottom) {
    candidates.push({ x: alignL, y: below, flipped: false }, { x: alignR, y: below, flipped: false });
  }
  if (above >= view.y) {
    candidates.push({ x: alignL, y: above, flipped: true }, { x: alignR, y: above, flipped: true });
  }
  /* Beside, slid back inside the room when the anchor itself is partly out
     of it -- a card at the right edge of a drawing the rail covers the end
     of has its "left of it" run past the room's right edge. */
  const rightIn = Math.max(right, view.x);
  const leftIn = Math.min(left, view.x + view.w - size.w);
  if (rightIn + size.w <= view.x + view.w) {
    candidates.push({ x: rightIn, y: clampY(anchor.y), flipped: false, beside: true });
  }
  if (leftIn >= view.x) {
    candidates.push({ x: leftIn, y: clampY(anchor.y), flipped: false, beside: true });
  }
  if (candidates.length === 0) return { x: clampX(anchor.x), y: clampY(above), flipped: true };
  const cost = (c: BarPlacement): number => {
    const box = { x: c.x, y: c.y, w: size.w, h: size.h };
    return obstacles.reduce((sum, o) => sum + overlap(box, o), 0);
  };
  let best = candidates[0] as BarPlacement;
  let bestCost = cost(best);
  for (const c of candidates) {
    if (bestCost === 0) break;
    const k = cost(c);
    if (k < bestCost) { best = c; bestCost = k; }
  }
  return best;
}

/** The shortest a scrolling menu is cut to before it goes beside the anchor instead. */
export const MENU_MIN_H = 150;

/**
 * How tall Break's context menu may be, in CSS pixels, before it scrolls --
 * or `null` when its natural height fits as it is.
 *
 * The menu shows every row, so on a card with many it can be taller than the
 * ground below or above the card. Cut to the taller of those two when that
 * leaves a usable list (`MENU_MIN_H`): a menu that hangs under the card it is
 * about and scrolls reads as that card's, and `placeBar` then finds the side
 * it was cut for. Where neither side leaves that much, the whole height of
 * the room is the cap and it goes beside the card.
 *
 * `room` and `anchor` are in user units; `k` is the scale the bar is drawn
 * at, so `h * k` is the room's height in CSS pixels. Floored, so the capped
 * box divided back by `k` never exceeds the room it was cut from.
 */
export function menuCap(
  anchor: Rect,
  room: { x: number; y: number; w: number; h: number },
  k: number,
  natural: number,
  min = MENU_MIN_H,
): number | null {
  const below = room.y + room.h - (anchor.y + anchor.h + BAR_GAP);
  const above = anchor.y - BAR_GAP - room.y;
  const vertical = Math.floor(Math.max(below, above, 0) * k);
  if (natural <= vertical) return null;
  if (vertical >= min) return vertical;
  const whole = Math.floor(room.h * k);
  return natural <= whole ? null : whole;
}
