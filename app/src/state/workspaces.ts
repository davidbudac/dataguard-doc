/**
 * Named local copies, and the drafts that opening something else replaced.
 *
 *   `dg-workspaces-v1`  the reader's named copies: document + edition
 *   `dg-recovery-v1`    the last 30 working documents that opening a preset,
 *                       a lesson, a file or a saved copy replaced
 *
 * Both hold the codec's wire form and are read back through the same
 * validating decoder an imported file goes through: a record that does not
 * decode cleanly is refused, never opened. A named catalogue that cannot be
 * read is left untouched -- nothing is written over it until the reader has
 * had the chance to export -- while the recovery list is a cache and simply
 * drops what it cannot read.
 *
 * Opening a preset used to reset the history: the draft on screen was gone.
 * `replaceWorkingDocument` is now the one path every "open" takes; it keeps
 * the outgoing draft in the recovery list and makes the replacement one
 * undoable step (history.ts `replaceDoc`), so Undo gets it back in this visit
 * and Saved configurations gets it back after a reload.
 */
import { batch, signal } from '@preact/signals';
import type { Edition } from '@/engine';
import { parseJsonText, toWire } from './codec';
import type { Doc } from './doc';
import { doc, withMeta } from './doc';
import { replaceDoc } from './history';
import { isPristinePreset, presetId } from './url';
import { edition, selection, tNow, toast } from './view';
import { activeWorkspaceId } from './workspace-id';
export { activeWorkspaceId } from './workspace-id';

export const WORKSPACES_KEY = 'dg-workspaces-v1';
export const RECOVERY_KEY = 'dg-recovery-v1';
export const RECOVERY_LIMIT = 30;

export interface Workspace {
  id: string;
  name: string;
  edition: Edition;
  updatedAt: number;
  document: Doc;
}

export const workspaces = signal<readonly Workspace[]>([]);
export const recoveries = signal<readonly Workspace[]>([]);
export const workspaceError = signal<string | null>(null);
/** The dialog (ui/workspaces/Workspaces.tsx); view state. */
export const workspacesOpen = signal(false);
/** A malformed catalogue is kept untouched until the reader clears it explicitly. */
const catalogueReadable = signal(true);

const NO_STORAGE = 'Local storage is unavailable in this browser.';

/** The browser's storage, or null outside one (a test, a server). */
function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage ?? null;
}

function mustStore(): Storage {
  const s = storage();
  if (s === null) throw new Error(NO_STORAGE);
  return s;
}

function validSnapshot(raw: unknown): Workspace | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(v.id)
    || typeof v.name !== 'string' || v.name.trim().length < 1 || v.name.length > 128
    || (v.edition !== '19c' && v.edition !== '26ai')
    || typeof v.updatedAt !== 'number' || !Number.isFinite(v.updatedAt)
    || typeof v.document !== 'object' || v.document === null) return null;
  const parsed = parseJsonText(JSON.stringify(v.document));
  if (!parsed.doc || parsed.issues.some((i) => i.severity === 'error' || i.severity === 'repaired')
    || parsed.dropped.length > 0) return null;
  return { id: v.id, name: v.name, edition: v.edition, updatedAt: v.updatedAt, document: parsed.doc };
}

function encode(v: Workspace): object {
  return { id: v.id, name: v.name, edition: v.edition, updatedAt: v.updatedAt, document: toWire(v.document) };
}

function fail(e: unknown): false {
  workspaceError.value = e instanceof Error ? e.message : 'Local storage could not be used.';
  return false;
}

/** The stored recovery list, dropping what does not decode (it is a cache). */
function storedRecoveries(s: Storage): Workspace[] {
  try {
    const raw = s.getItem(RECOVERY_KEY);
    const decoded = raw === null ? [] : JSON.parse(raw) as unknown;
    const list = decoded === null ? [] : Array.isArray(decoded) ? decoded : [decoded];
    return list.map(validSnapshot).filter((v): v is Workspace => v !== null);
  } catch {
    return [];
  }
}

/** Read when the dialog opens. Corrupt records are refused, never applied. */
export function refreshWorkspaces(): boolean {
  try {
    const s = mustStore();
    const saved = s.getItem(WORKSPACES_KEY);
    const raw = saved === null ? [] : JSON.parse(saved) as unknown;
    if (!Array.isArray(raw)) throw new Error('Saved configurations are damaged. Export your current document before clearing site data.');
    const entries = raw.map(validSnapshot);
    if (entries.some((v) => v === null) || new Set(entries.map((v) => v?.id)).size !== entries.length) {
      throw new Error('Saved configurations contain invalid data. Export your current document before clearing site data.');
    }
    batch(() => {
      workspaces.value = entries as Workspace[];
      recoveries.value = storedRecoveries(s);
      workspaceError.value = null;
      catalogueReadable.value = true;
    });
    return true;
  } catch (e) {
    const s = storage();
    batch(() => {
      workspaces.value = [];
      recoveries.value = s === null ? [] : storedRecoveries(s);
      activeWorkspaceId.value = null;
      catalogueReadable.value = false;
    });
    return fail(e);
  }
}

function writeEntries(entries: readonly Workspace[]): boolean {
  if (!catalogueReadable.value) return fail(new Error('Saved configurations could not be read. Export your current document before clearing site data.'));
  try {
    mustStore().setItem(WORKSPACES_KEY, JSON.stringify(entries.map(encode)));
    workspaces.value = entries;
    workspaceError.value = null;
    return true;
  } catch (e) { return fail(e); }
}

/* An identifier, not a secret, and not engine code: the clock and the
   random source are the UI's to read. */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanName(name: string): string | null {
  const n = name.trim().slice(0, 128);
  return n.length > 0 ? n : null;
}

/** Save the document into the copy it was opened from, or as a new named copy. */
export function saveWorkspace(name: string, duplicate = false): boolean {
  const clean = cleanName(name);
  if (clean === null) return fail(new Error('Enter a name for this configuration.'));
  const id = duplicate ? null : activeWorkspaceId.value;
  const existing = workspaces.value.find((v) => v.id === id);
  const next: Workspace = {
    id: existing?.id ?? newId(), name: clean, edition: edition.value,
    updatedAt: Date.now(), document: withMeta(doc.value, { name: clean }),
  };
  const entries = existing
    ? workspaces.value.map((v) => (v.id === existing.id ? next : v))
    : [next, ...workspaces.value];
  if (!writeEntries(entries)) return false;
  activeWorkspaceId.value = next.id;
  return true;
}

export function renameWorkspace(id: string, name: string): boolean {
  const clean = cleanName(name);
  if (clean === null) return fail(new Error('Enter a name for this configuration.'));
  const target = workspaces.value.find((v) => v.id === id);
  if (!target) return fail(new Error('That saved configuration is no longer available.'));
  return writeEntries(workspaces.value.map((v) => v.id === id
    ? { ...v, name: clean, updatedAt: Date.now(), document: withMeta(v.document, { name: clean }) }
    : v));
}

export function deleteWorkspace(id: string): boolean {
  if (!workspaces.value.some((v) => v.id === id)) return fail(new Error('That saved configuration is no longer available.'));
  if (!writeEntries(workspaces.value.filter((v) => v.id !== id))) return false;
  if (activeWorkspaceId.value === id) activeWorkspaceId.value = null;
  return true;
}

/**
 * Whether a stored draft is the document on screen. The stored side has been
 * through the decoder, which does not keep key order, so the live side goes
 * through it too before the two wire forms are compared.
 */
function sameDoc(stored: Doc, live: Doc): boolean {
  if (stored === live) return true;
  const decoded = parseJsonText(JSON.stringify(toWire(live))).doc;
  return decoded !== null && JSON.stringify(toWire(stored)) === JSON.stringify(toWire(decoded));
}

/**
 * Keep the document on screen in the recovery list before something replaces
 * it. Nothing to keep when it is an untouched preset (the picker has it) or
 * the draft kept last. Outside a browser there is nowhere to keep it and
 * nobody to tell; in a browser that refuses, the reader is told, and the
 * replacement is still undoable in memory. False only for that last case:
 * the caller's own message would talk over the warning.
 */
export function keepRecovery(): boolean {
  const s = storage();
  if (s === null) return true;
  if (isPristinePreset(doc.value, presetId.value)) return true;
  try {
    const stored = storedRecoveries(s);
    const latest = stored[0];
    if (latest !== undefined && sameDoc(latest.document, doc.value)) {
      recoveries.value = stored;
      return true;
    }
    const current: Workspace = {
      id: newId(), name: doc.value.meta.name.trim() || 'Previous configuration',
      edition: edition.value, updatedAt: Date.now(), document: doc.value,
    };
    const next = [current, ...stored].slice(0, RECOVERY_LIMIT);
    s.setItem(RECOVERY_KEY, JSON.stringify(next.map(encode)));
    recoveries.value = next;
    return true;
  } catch (e) {
    fail(e);
    toast.value = { kind: 'warn', text: `Could not keep a recovery copy: ${workspaceError.value ?? 'storage failed'}. Undo is available.` };
    return false;
  }
}

/** One path for opening presets, lessons, files, saved copies and recovered drafts. */
export function replaceWorkingDocument(label: string, next: Doc, nextPreset: string | null,
  nextEdition: Edition = edition.value, nextWorkspaceId: string | null = null): boolean {
  if (doc.value === next) return true;
  const kept = keepRecovery();
  replaceDoc(label, next, { preset: nextPreset, workspace: nextWorkspaceId, edition: nextEdition });
  batch(() => {
    selection.value = [];
    tNow.value = 0;
  });
  return kept;
}

/** Open a named copy by id, or a recovered draft as `recovery:<id>`. */
export function openWorkspace(id: string): boolean {
  const recovered = id.startsWith('recovery:');
  const item = recovered
    ? recoveries.value.find((v) => v.id === id.slice('recovery:'.length))
    : workspaces.value.find((v) => v.id === id);
  if (!item) return fail(new Error('That saved configuration is no longer available.'));
  replaceWorkingDocument(`Open ${item.name}`, item.document, null, item.edition, recovered ? null : id);
  return true;
}
