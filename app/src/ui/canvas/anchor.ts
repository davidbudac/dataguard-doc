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
 * Below the anchor, above it when below would fall out of the view, and
 * always clamped into the view on both axes.
 *
 * The clamp is `max(view, min(x, far edge))` in that order, so a footprint
 * larger than the view pins to its top left corner rather than jumping to the
 * far edge -- the failure is then visible at the edge the reader is looking
 * at instead of off screen entirely. Nothing in the workbench reaches that
 * case: the bar caps at six rows, and `test/ui/canvas-presets.test.ts` walks
 * every preset at every frame to keep it that way.
 */
export function placeBar(
  anchor: Rect, size: { w: number; h: number }, view: { x: number; y: number; w: number; h: number },
): BarPlacement {
  const bottom = view.y + view.h;
  const clampX = (x: number): number => Math.max(view.x, Math.min(x, view.x + view.w - size.w));
  const clampY = (y: number): number => Math.max(view.y, Math.min(y, bottom - size.h));
  const below = anchor.y + anchor.h + BAR_GAP;
  if (below + size.h <= bottom) {
    return { x: clampX(anchor.x), y: below, flipped: false };
  }
  const above = anchor.y - BAR_GAP - size.h;
  if (above >= view.y) {
    return { x: clampX(anchor.x), y: above, flipped: true };
  }
  /* Neither fits without covering the anchor -- a short view and a tall bar.
     Beside it, then: the right of the anchor, or its left, whichever has the
     room, with the top edges aligned and clamped. Only when neither side has
     the width does the bar fall back to covering -- pinned at the top left of
     the view, where the collision is at least in front of the reader. */
  const right = anchor.x + anchor.w + BAR_GAP;
  if (right + size.w <= view.x + view.w) {
    return { x: right, y: clampY(anchor.y), flipped: false, beside: true };
  }
  const left = anchor.x - BAR_GAP - size.w;
  if (left >= view.x) {
    return { x: left, y: clampY(anchor.y), flipped: false, beside: true };
  }
  return { x: clampX(anchor.x), y: clampY(above), flipped: true };
}
