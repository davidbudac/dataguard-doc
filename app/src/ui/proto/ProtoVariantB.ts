/* PROTOTYPE — Break layout variant B (throwaway, see branch prototype/break-layout-b) */

import { signal } from '@preact/signals';

/**
 * Whether this page load asked for variant B (`?variant=B`). Read once at
 * import: the URL sync drops keys it does not know from the address bar soon
 * after boot, so reading it later would find it gone.
 */
export const variantB: boolean = (() => {
  if (typeof location === 'undefined') return false;
  try {
    return (new URLSearchParams(location.search).get('variant') ?? '').toUpperCase() === 'B';
  } catch {
    return false;
  }
})();

/** The split's timeline-region height in px, in memory only; null = the ~50/50 default (CSS). */
export const protoSplitH = signal<number | null>(null);

/** The legend popover and the drag are both this bar's own; nothing else reads them. */
export const protoLegendOpen = signal<boolean>(false);
