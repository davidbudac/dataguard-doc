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
 *
 * The one thing in here that is not the Document is its **provenance**:
 * `presetId`, the preset a document came from. It travels with the snapshot
 * because two edits change both at once -- Reset lands on the classic
 * deployment and drops the id, opening a lesson step lands on the step's
 * topology and takes the lesson's id -- and restoring half of that is a
 * document that *is* a preset while the address bar and the picker say it is
 * not. "Undoing back to the preset drops the fragment again" (`state/url.ts`)
 * is only true if the id comes back with the bytes.
 *
 * The saved copy a document was opened from (`activeWorkspaceId`,
 * state/workspaces.ts) is provenance of the same kind and travels the same
 * way, so Undo after opening a saved copy is back on the draft that was open
 * before -- and a later Save goes to the copy that draft belonged to.
 *
 * The edition is a reading preference, not part of the Document, and an
 * ordinary edit never records it: undoing a card drag must not flip the
 * release the reader chose since. Only a replacement that changed it --
 * opening a saved copy made under the other release (`replaceDoc`) -- stores
 * the edition it replaced, and only that entry gives it back.
 */

import { batch, computed, signal } from '@preact/signals';
import type { Doc } from './doc';
import { doc } from './doc';
import { presetId } from './url';
import { edition } from './view';
import type { Edition } from '@/engine';
import { activeWorkspaceId } from './workspace-id';

/**
 * One reversible step: the label of the edit, the Document before it, and
 * where that Document came from (`?preset=<id>`, or null).
 */
export interface HistoryEntry {
  label: string;
  doc: Doc;
  preset: string | null;
  /** The saved copy `doc` belonged to, or null. */
  workspace: string | null;
  /** Present only when the step changed the edition: the one to go back to. */
  edition?: Edition;
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
  /* Read before `fn` runs, and stored beside the snapshot: a caller that
     changes the provenance does it around the `edit()`, not inside it. */
  const beforePreset = presetId.value;
  const beforeWorkspace = activeWorkspaceId.value;
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
      undoStack.value = [...head, { ...top, label }];
    } else {
      const grown = [...stack, { label, doc: before, preset: beforePreset, workspace: beforeWorkspace }];
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

/** Where the reader is now, in the shape of an entry that would come back here. */
function here(label: string, from: HistoryEntry): HistoryEntry {
  const out: HistoryEntry = {
    label, doc: doc.value, preset: presetId.value, workspace: activeWorkspaceId.value,
  };
  if (from.edition !== undefined) out.edition = edition.value;
  return out;
}

function land(entry: HistoryEntry): void {
  doc.value = entry.doc;
  presetId.value = entry.preset;
  activeWorkspaceId.value = entry.workspace;
  if (entry.edition !== undefined) edition.value = entry.edition;
}

export function undo(): void {
  const stack = undoStack.value;
  const entry = stack.at(-1);
  if (!entry) return;
  batch(() => {
    undoStack.value = stack.slice(0, -1);
    redoStack.value = [...redoStack.value, here(entry.label, entry)];
    land(entry);
  });
  breakCoalescing();
}

export function redo(): void {
  const stack = redoStack.value;
  const entry = stack.at(-1);
  if (!entry) return;
  batch(() => {
    redoStack.value = stack.slice(0, -1);
    undoStack.value = [...undoStack.value, here(entry.label, entry)];
    land(entry);
  });
  breakCoalescing();
}

/**
 * Replace the whole Document as one undoable step, with its provenance: the
 * preset it is, the saved copy it came from and -- when it differs -- the
 * edition it was made under. Opening a preset, a lesson, a file or a saved
 * copy goes through here (state/workspaces.ts `replaceWorkingDocument`), so
 * one Undo puts back the draft that was open before, provenance and all.
 */
export function replaceDoc(
  label: string, next: Doc,
  to: { preset: string | null; workspace: string | null; edition: Edition },
): void {
  const entry: HistoryEntry = {
    label, doc: doc.value, preset: presetId.value, workspace: activeWorkspaceId.value,
  };
  if (to.edition !== edition.value) entry.edition = edition.value;
  batch(() => {
    const grown = [...undoStack.value, entry];
    undoStack.value = grown.length > HISTORY_CAP ? grown.slice(grown.length - HISTORY_CAP) : grown;
    redoStack.value = [];
    land({ label, doc: next, preset: to.preset, workspace: to.workspace, edition: to.edition });
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
 * Replace the Document wholesale and forget the past: what the page boots on
 * (a link, a lesson step it names, a restored session) is a starting point,
 * not an edit. Opening something once the page is running is an edit that
 * keeps the draft it replaced -- `replaceDoc`, via state/workspaces.ts.
 */
export function resetHistory(next?: Doc): void {
  batch(() => {
    undoStack.value = [];
    redoStack.value = [];
    if (next) {
      doc.value = next;
      activeWorkspaceId.value = null;
    }
  });
  breakCoalescing();
}
