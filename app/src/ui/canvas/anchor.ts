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
 * leaves around the drawing.
 *
 * The svg paints its overflow (`.topo-svg { overflow: visible }`) and the wrap
 * centres a drawing that is smaller than its room, so a small configuration
 * sits in a band of empty stage. Clamping the bar to the viewBox alone put it
 * *on* the drawing -- over the card beside the one it was about -- while that
 * ground stood empty. `margin` is that ground in user units, measured by
 * `CanvasSlot` (zero where there is no layout, and while zoomed, where the wrap
 * is a scroll port and the viewBox is the honest bound again).
 */
export function barRoom(
  view: { x: number; y: number; w: number; h: number },
  margin: { t: number; r: number; b: number; l: number },
): { x: number; y: number; w: number; h: number } {
  return {
    x: view.x - margin.l,
    y: view.y - margin.t,
    w: view.w + margin.l + margin.r,
    h: view.h + margin.t + margin.b,
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
  const below = anchor.y + anchor.h + BAR_GAP;
  const above = anchor.y - BAR_GAP - size.h;
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
  if (right + size.w <= view.x + view.w) {
    candidates.push({ x: right, y: clampY(anchor.y), flipped: false, beside: true });
  }
  if (left >= view.x) {
    candidates.push({ x: left, y: clampY(anchor.y), flipped: false, beside: true });
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
