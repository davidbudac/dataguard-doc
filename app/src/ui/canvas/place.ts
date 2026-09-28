/**
 * Where the toolbar over the drawing and the drawing itself meet.
 *
 * A chip dragged off the toolbar is HTML; the data centre it is dropped on is
 * SVG, hit-tested in the drawing's own units. Neither can see into the other,
 * so the three facts they share live here: which chip is in the air, which
 * data centre it is over, and the drawing's answer to "what is under this
 * point". View state, all of it -- a drag in flight is not in the document,
 * the URL or the undo stack.
 *
 * `renaming` is the same kind of fact: the key whose name is being edited on
 * the drawing, which an addition sets so that add, type, `Enter` is one flow.
 */

import { signal } from '@preact/signals';

/** The `AddAction.key` being dragged, or null. */
export const placing = signal<string | null>(null);
/** The data centre under the dragged chip, or null. */
export const placeOver = signal<string | null>(null);
/** The key whose name is being edited in place, or null. */
export const renaming = signal<string | null>(null);
/**
 * The cards a drag on the drawing is carrying right now: the layout draws
 * them where the drag puts them but makes nothing else move out of their way
 * until they land (`layout.ts` step 7b). Empty when nothing is in the air.
 */
export const inFlight = signal<readonly string[]>([]);

let hit: ((clientX: number, clientY: number) => string | null) | null = null;

/** The drawing registers its hit test while it is mounted. */
export function setSiteAt(fn: ((clientX: number, clientY: number) => string | null) | null): void {
  hit = fn;
}

export const siteAt = (clientX: number, clientY: number): string | null => hit?.(clientX, clientY) ?? null;

export function endPlacing(): void {
  if (placing.peek() !== null) placing.value = null;
  if (placeOver.peek() !== null) placeOver.value = null;
}
