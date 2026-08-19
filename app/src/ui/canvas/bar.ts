/**
 * Whether the drawing is offering anything, and about what.
 *
 * One signal, holding the key the action bar is anchored to. It is deliberately
 * *not* the selection: a reader can have three cards selected and no bar open,
 * and the bar has to know which of the three it is hanging under. Everything
 * that could make the anchor wrong closes it rather than moving it -- a
 * selection that no longer contains the key, a mode change, `Escape`, a click
 * on the ground between the cards -- because a bar left hanging under a card
 * that is no longer the subject is a menu offering actions about something
 * else.
 *
 * `barFocus` is the *intent* the bar was opened with, not a state of it: a
 * plain click leaves the focus on the drawing (the reader is already looking
 * at what they clicked), while the context menu -- `Shift+F10`, or the right
 * button -- is a keyboard-shaped request and moves the focus into the bar.
 */

import { signal } from '@preact/signals';

/** The key the bar is anchored to, or `null` when nothing is offered. */
export const barOpen = signal<string | null>(null);

/** True when the bar was opened by a gesture that asks for the focus. */
export const barFocus = signal<boolean>(false);

export function openBar(key: string, focus = false): void {
  barOpen.value = key;
  barFocus.value = focus;
}

export function closeBar(): void {
  if (barOpen.peek() !== null) barOpen.value = null;
  if (barFocus.peek()) barFocus.value = false;
}
