/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { classicDoc, doc, withMeta } from '@/state/doc';
import { edit, resetHistory, undo } from '@/state/history';
import { edition, toast } from '@/state/view';
import { presetId } from '@/state/url';
import {
  activeWorkspaceId, deleteWorkspace, openWorkspace, recoveries,
  refreshWorkspaces, renameWorkspace, replaceWorkingDocument, saveWorkspace,
  WORKSPACES_KEY, RECOVERY_KEY, workspaceError, workspaces, workspacesOpen,
} from '@/state/workspaces';
import { findPreset } from '@/presets';
import { makeDoc } from '@/state/doc';
import { h, render } from 'preact';
import { openWorkspaces, WorkspacesDialog } from '@/ui/workspaces/Workspaces';
import { loadPreset } from '@/ui/intro/route';
import { openLessonStep } from '@/ui/learn/route';
import { LESSONS } from '@/content';

const stored = new Map<string, string>();
let storageBlocked = false;
const fakeStorage = {
  getItem: (key: string): string | null => stored.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    if (storageBlocked) throw new Error('Storage blocked');
    stored.set(key, value);
  },
  removeItem: (key: string): void => { stored.delete(key); },
  clear: (): void => { stored.clear(); },
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: fakeStorage });

beforeEach(() => {
  stored.clear();
  storageBlocked = false;
  refreshWorkspaces();
  resetHistory(classicDoc());
  edition.value = '19c';
  presetId.value = null;
  activeWorkspaceId.value = null;
  workspaces.value = [];
  recoveries.value = [];
  workspaceError.value = null;
  workspacesOpen.value = false;
  toast.value = null;
});

describe('named local configurations', () => {
  it('saves and opens a validated document with its edition, and Undo returns to the working copy', () => {
    expect(saveWorkspace('Production design')).toBe(true);
    const id = activeWorkspaceId.value;
    expect(id).toBeTruthy();
    expect(workspaces.value[0]?.name).toBe('Production design');
    edit('Change draft', (d) => withMeta(d, { name: 'Draft after save' }));
    edition.value = '26ai';
    expect(openWorkspace(id as string)).toBe(true);
    expect(doc.value.meta.name).toBe('Production design');
    expect(edition.value).toBe('19c');
    expect(recoveries.value[0]?.document.meta.name).toBe('Draft after save');
    expect(window.localStorage.getItem(RECOVERY_KEY)).toContain('Draft after save');
    undo();
    expect(doc.value.meta.name).toBe('Draft after save');
    expect(edition.value).toBe('26ai');
    expect(activeWorkspaceId.value).toBe(id);
    expect(refreshWorkspaces()).toBe(true);
    expect(workspaces.value[0]?.document.meta.name).toBe('Production design');
  });

  it('duplicates independently, renames, and deletes only the selected saved copy', () => {
    saveWorkspace('Original');
    const original = activeWorkspaceId.value as string;
    saveWorkspace('Copy of Original', true);
    const copy = activeWorkspaceId.value as string;
    expect(copy).not.toBe(original);
    expect(workspaces.value).toHaveLength(2);
    expect(renameWorkspace(copy, 'Alternative')).toBe(true);
    expect(workspaces.value.find((v) => v.id === copy)?.name).toBe('Alternative');
    expect(deleteWorkspace(copy)).toBe(true);
    expect(activeWorkspaceId.value).toBeNull();
    expect(workspaces.value.map((v) => v.id)).toEqual([original]);
  });

  it('rejects malformed stored documents rather than opening them', () => {
    saveWorkspace('Valid');
    const raw = JSON.parse(window.localStorage.getItem(WORKSPACES_KEY) as string) as Array<Record<string, unknown>>;
    raw[0]!.document = { nonsense: true };
    window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(raw));
    workspaces.value = [];
    expect(refreshWorkspaces()).toBe(false);
    expect(workspaceError.value).toContain('invalid data');
    expect(openWorkspace(raw[0]!.id as string)).toBe(false);
  });

  it('reports failed writes without claiming the copy was saved', () => {
    storageBlocked = true;
    expect(saveWorkspace('Cannot save')).toBe(false);
    expect(workspaces.value).toHaveLength(0);
    expect(activeWorkspaceId.value).toBeNull();
    expect(workspaceError.value).toBe('Storage blocked');
  });
});

describe('exploring presets and examples', () => {
  it('keeps the previous document and its preset identity before replacing it', () => {
    const old = findPreset('classic')!;
    resetHistory(makeDoc(old.doc()));
    presetId.value = old.id;
    edit('Personal note', (d) => withMeta(d, { notes: 'my work' }));
    const next = findPreset('far-sync-zero-loss')!;
    replaceWorkingDocument('Open far sync', makeDoc(next.doc()), next.id);
    expect(recoveries.value[0]?.document.meta.notes).toBe('my work');
    expect(presetId.value).toBe(next.id);
    undo();
    expect(doc.value.meta.notes).toBe('my work');
    expect(presetId.value).toBe(old.id);
  });

  it('preserves work when the Introduction opens a preset and Learn opens a step', () => {
    edit('Personal note', (d) => withMeta(d, { notes: 'a topology worth keeping' }));
    loadPreset('far-sync-zero-loss');
    expect(recoveries.value[0]?.document.meta.notes).toBe('a topology worth keeping');
    undo();
    expect(doc.value.meta.notes).toBe('a topology worth keeping');
    openLessonStep(LESSONS[0]!, 0, 'live');
    expect(recoveries.value[0]?.document.meta.notes).toBe('a topology worth keeping');
    undo();
    expect(doc.value.meta.notes).toBe('a topology worth keeping');
  });

  it('keeps the original draft after several examples and a reload', () => {
    edit('Personal note', (d) => withMeta(d, { notes: 'original draft' }));
    loadPreset('far-sync-zero-loss');
    loadPreset('max-protection');
    openLessonStep(LESSONS[0]!, 0, 'live');
    /* The untouched presets in between are not kept: the picker has them. */
    expect(recoveries.value).toHaveLength(1);
    expect(recoveries.value.some((v) => v.document.meta.notes === 'original draft')).toBe(true);
    expect(refreshWorkspaces()).toBe(true);
    const original = recoveries.value.find((v) => v.document.meta.notes === 'original draft')!;
    expect(openWorkspace(`recovery:${original.id}`)).toBe(true);
    expect(doc.value.meta.notes).toBe('original draft');
  });

  it('keeps an edited preset, not an untouched one, and never the same draft twice', () => {
    loadPreset('classic');
    loadPreset('far-sync-zero-loss');
    expect(recoveries.value).toHaveLength(1);
    expect(recoveries.value[0]?.document.meta.notes).not.toBe('x');
    edit('Personal note', (d) => withMeta(d, { notes: 'x' }));
    loadPreset('max-protection');
    expect(recoveries.value).toHaveLength(2);
    expect(recoveries.value[0]?.document.meta.notes).toBe('x');
    undo();
    replaceWorkingDocument('Open again', classicDoc(), null);
    expect(recoveries.value).toHaveLength(2);
  });

  it('reads the stored drafts before adding one, so a reload does not lose them', () => {
    edit('Personal note', (d) => withMeta(d, { notes: 'from an earlier visit' }));
    loadPreset('far-sync-zero-loss');
    /* A new visit: nothing read yet. */
    recoveries.value = [];
    edit('Another', (d) => withMeta(d, { notes: 'this visit' }));
    loadPreset('max-protection');
    expect(recoveries.value.map((v) => v.document.meta.notes)).toEqual(['this visit', 'from an earlier visit']);
  });

  it('restores the edition only when opening a copy changed it, and Undo gives it back', () => {
    edition.value = '26ai';
    saveWorkspace('Made under 26ai');
    const id = activeWorkspaceId.value as string;
    edition.value = '19c';
    edit('Draft', (d) => withMeta(d, { notes: 'draft' }));
    openWorkspace(id);
    expect(edition.value).toBe('26ai');
    undo();
    expect(edition.value).toBe('19c');
    expect(activeWorkspaceId.value).toBe(id);
    /* An ordinary edit never records the edition: switching the release and
       undoing a later edit leaves the reader's release alone. */
    edit('Another', (d) => withMeta(d, { notes: 'more' }));
    edition.value = '26ai';
    undo();
    expect(edition.value).toBe('26ai');
  });

  it('leaves Undo available when recovery storage is unavailable and tells the user', () => {
    storageBlocked = true;
    edit('Personal note', (d) => withMeta(d, { notes: 'my work' }));
    replaceWorkingDocument('Open example', classicDoc(), null);
    expect(toast.value?.text).toContain('Undo is available');
    undo();
    expect(doc.value.meta.notes).toBe('my work');
  });
});

describe('workspace dialog', () => {
  it('offers save, duplicate, open, recovery, and an accessible storage error', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(WorkspacesDialog, {}), root);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    openWorkspaces();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Saved configurations');
    expect(root.textContent).toContain('Save current');
    expect(root.textContent).toContain('Duplicate current');
    (Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Save current') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.textContent).toContain('Named configurations');
    expect(workspaces.value).toHaveLength(1);
    storageBlocked = true;
    (Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Duplicate current') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Storage blocked');
    expect(workspaces.value).toHaveLength(1);
    render(null, root);
    root.remove();
  });
});
