/* PROTOTYPE — Break layout variant B (throwaway, see branch prototype/break-layout-b) */

import { signal } from '@preact/signals';

/** The split's timeline-region height in px, in memory only; null = the ~50/50 default (CSS). */
export const protoSplitH = signal<number | null>(null);

/** The legend popover and the drag are both this bar's own; nothing else reads them. */
export const protoLegendOpen = signal<boolean>(false);
