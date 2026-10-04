import { signal } from '@preact/signals';

/** Drawing units, outside the document and its undo history. */
export const canvasPan = signal({ x: 0, y: 0 });
export const handTool = signal(false);
export function resetPan(): void { canvasPan.value = { x: 0, y: 0 }; }
