/**
 * Undo/redo over immutable Document snapshots (ui.md SS2).
 *
 * Every mutation of the Document goes through `edit()`, which is also where
 * the user-facing label comes from: "Undo: set LogXptMode to FASTSYNC on
 * stby01" is more use than "Undo". A gesture that fires many times -- a
 * slider drag, a card drag -- passes a `coalesceKey`, and consecutive edits
 * sharing that key within 700 ms fold into the entry already on the stack, so
 * one drag is one undo.
 *
 * View state is never in here. Layout drags and event injection are, because
 * both ride the share link and the file.
 */

import { batch, computed, signal } from '@preact/signals';
import type { Doc } from './doc';
import { doc } from './doc';

/** One reversible step: the label of the edit, and the Document before it. */
export interface HistoryEntry {
  label: string;
  doc: Doc;
}

/** Consecutive edits with the same coalesce key fold together inside this. */
export const COALESCE_MS = 700;
/** Snapshots are cheap (structural sharing) but not free. */
export const HISTORY_CAP = 100;

export const undoStack = signal<readonly HistoryEntry[]>([]);
export const redoStack = signal<readonly HistoryEntry[]>([]);

export const canUndo = computed(() => undoStack.value.length > 0);
export const canRedo = computed(() => redoStack.value.length > 0);
export const undoLabel = computed(() => undoStack.value.at(-1)?.label ?? null);
export const redoLabel = computed(() => redoStack.value.at(-1)?.label ?? null);

let lastKey: string | null = null;
let lastAt = 0;

const nowMs = (): number => (typeof performance === 'object' ? performance.now() : Date.now());

/**
 * Apply `fn` to the Document under one undo entry.
 *
 * `at` exists so tests can drive the coalescing window without a fake clock;
 * production callers leave it out.
 */
export function edit(
  label: string, fn: (d: Doc) => Doc, coalesceKey?: string, at?: number,
): void {
  const before = doc.value;
  const next = fn(before);
  /* An edit that changes nothing is not an edit -- it must not cost an undo. */
  if (next === before) return;

  const t = at ?? nowMs();
  const stack = undoStack.value;
  const foldable = coalesceKey !== undefined
    && coalesceKey === lastKey
    && t - lastAt <= COALESCE_MS
    && stack.length > 0;

  batch(() => {
    if (foldable) {
      /* Keep the older snapshot -- it is the state the whole gesture started
         from -- and take the newer label, which describes where it ended. */
      const head = stack.slice(0, -1);
      const top = stack[stack.length - 1] as HistoryEntry;
      undoStack.value = [...head, { label, doc: top.doc }];
    } else {
      const grown = [...stack, { label, doc: before }];
      undoStack.value = grown.length > HISTORY_CAP
        ? grown.slice(grown.length - HISTORY_CAP)
        : grown;
    }
    redoStack.value = [];
    doc.value = next;
  });

  lastKey = coalesceKey ?? null;
  lastAt = t;
}

export function undo(): void {
  const stack = undoStack.value;
  const entry = stack.at(-1);
  if (!entry) return;
  batch(() => {
    undoStack.value = stack.slice(0, -1);
    redoStack.value = [...redoStack.value, { label: entry.label, doc: doc.value }];
    doc.value = entry.doc;
  });
  breakCoalescing();
}

export function redo(): void {
  const stack = redoStack.value;
  const entry = stack.at(-1);
  if (!entry) return;
  batch(() => {
    redoStack.value = stack.slice(0, -1);
    undoStack.value = [...undoStack.value, { label: entry.label, doc: doc.value }];
    doc.value = entry.doc;
  });
  breakCoalescing();
}

/**
 * End the current gesture, so the next edit starts a fresh entry even if it
 * carries the same key. Pointer-up handlers call this.
 */
export function breakCoalescing(): void {
  lastKey = null;
  lastAt = 0;
}

/**
 * Replace the Document wholesale and forget the past: a preset, a lesson step,
 * an import or a restored session is a new starting point, not an edit.
 */
export function resetHistory(next?: Doc): void {
  batch(() => {
    undoStack.value = [];
    redoStack.value = [];
    if (next) doc.value = next;
  });
  breakCoalescing();
}
