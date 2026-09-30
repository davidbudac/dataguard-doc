/**
 * How large the drawing is drawn -- a view of the document, never part of it.
 *
 * Zoom is deliberately *not* in the document: it is not undoable, it is not in
 * the share link and it is not in local storage. Two readers opening the same
 * link see the same configuration at whatever size each of them can read, and
 * an undo after a zoom takes back the last edit rather than the last look.
 *
 * A ladder rather than a continuous factor. Six rungs the drawing is legible
 * at, so `+` and `-` always land somewhere with crisp hairlines and readable
 * 10-13 px labels instead of on an arbitrary 1.0733; and so the two ends are
 * ends, which is what lets a button at one of them say why it is grey.
 */

import { signal } from '@preact/signals';

/** The rungs, ascending. 1 is the drawing at its own size, and the home rung. */
export const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.2, 1.4] as const;

/** The rung `Fit` returns to: the drawing at 1:1 against its own viewBox. */
export const FIT_ZOOM = 1;

/**
 * Why `-` and `+` go grey at the ends of the ladder.
 *
 * A zoom button that quietly stops responding at the last rung is the same
 * silence this page refuses everywhere else, so the ends say so out loud --
 * short, because the reader can see the percentage beside them.
 */
export const WHY_MIN = 'As small as the ladder goes.';
export const WHY_MAX = 'As large as the ladder goes.';

/** The current rung. View state: no history, no URL, no storage. */
export const zoom = signal<number>(FIT_ZOOM);

/**
 * Whether the drawing is sized by its room rather than by the reader.
 *
 * Where a layout gives the drawing a region of its own (Break's Split, whose
 * region the reader resizes) the home size is the true one: 1:1, card text at
 * its normal size, and if that is more than the region holds the drawing is
 * clipped and pannable -- centred on its content to start with -- rather than
 * shrunk until the percentage on the strip is a lie. `Fit` is the one thing
 * that hands the size to the room: true from the reader's press of it, the
 * drawing is then scaled to lie wholly inside the region (below 1:1 if that is
 * what it takes, above it up to `AUTO_MAX` where there is room to spare), and
 * `zoom` is the factor it lands on -- not a rung, which is why `zoomIndex`
 * takes the nearest. False from the start and again on entering the layout;
 * false from the first `+`, `-` or wheel step, so a reader who has zoomed or
 * panned is never fought by a resize.
 */
export const zoomAuto = signal<boolean>(false);

/** How far `Fit` scales a drawing up: the top rung, never more. */
export const AUTO_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1] as number;
/**
 * How far `Fit` scales a drawing down. Below the ladder's own floor, because
 * the widest preset in a narrow region needs it, but not to a speck.
 */
export const AUTO_MIN = 0.35;

/**
 * The factor that makes a drawing of `view` lie inside `room` -- the whole of
 * it, whether that is above or below 1 -- but never above `AUTO_MAX`, so a
 * two-node drawing in a big region is not blown up to a poster, and never below
 * `AUTO_MIN`. Floored to a hundredth so the rounded pixel size cannot poke a
 * pixel past the room. With no room to measure (jsdom, a hidden stage) it is
 * 1:1, the honest default.
 */
export function autoFactor(view: { w: number; h: number }, room: { w: number; h: number }): number {
  if (!(view.w > 0) || !(view.h > 0) || !(room.w > 0) || !(room.h > 0)) return FIT_ZOOM;
  const f = Math.floor(Math.min(room.w / view.w, room.h / view.h) * 100) / 100;
  return Math.min(AUTO_MAX, Math.max(AUTO_MIN, f));
}

/**
 * Which rung a factor is on.
 *
 * Nearest rather than exact: nothing outside this module should be able to
 * put the signal between two rungs, but if something does, the next press
 * still moves one rung rather than doing nothing.
 */
export function zoomIndex(factor: number = zoom.peek()): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
    const d = Math.abs((ZOOM_STEPS[i] as number) - factor);
    if (d < Math.abs((ZOOM_STEPS[best] as number) - factor)) best = i;
  }
  return best;
}

/** True when a press in that direction has a rung to move to. */
export function canZoom(dir: 1 | -1): boolean {
  const at = zoomIndex();
  return dir === 1 ? at < ZOOM_STEPS.length - 1 : at > 0;
}

/** One rung up (`1`) or down (`-1`); at the end of the ladder, nothing. */
export function zoomBy(dir: 1 | -1): void {
  const next = zoomIndex() + dir;
  const step = ZOOM_STEPS[next];
  if (step === undefined) return;
  zoomAuto.value = false;
  if (zoom.peek() !== step) zoom.value = step;
}

/**
 * `Fit`. Where the layout gives the drawing a region of its own this hands the
 * size to that region (`zoomAuto`) and the canvas writes the factor the whole
 * drawing needs to lie inside it; elsewhere it is back to 1:1, which is the
 * stage's own cap.
 */
export function fitZoom(): void {
  zoomAuto.value = true;
  if (zoom.peek() !== FIT_ZOOM) zoom.value = FIT_ZOOM;
}

/** The rung as the strip prints it: `100%`, `65%`. */
export const zoomLabel = (factor: number = zoom.value): string =>
  `${Math.round(factor * 100)}%`;
