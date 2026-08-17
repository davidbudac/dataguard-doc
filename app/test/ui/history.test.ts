/**
 * Undo is a stack of Document snapshots, and one gesture is one undo.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  canRedo, canUndo, COALESCE_MS, edit, HISTORY_CAP, redo, redoLabel, resetHistory, undo,
  undoLabel, undoStack, breakCoalescing,
} from '@/state/history';
import { classicDoc, doc, withLayout, withMeta } from '@/state/doc';
import { presetId } from '@/state/url';

beforeEach(() => {
  resetHistory(classicDoc());
  presetId.value = null;
});

describe('history', () => {
  it('records one entry per edit, with the label', () => {
    edit('Rename the configuration', (d) => withMeta(d, { name: 'one' }), undefined, 0);
    edit('Rename the configuration', (d) => withMeta(d, { name: 'two' }), undefined, 5000);
    expect(undoStack.value.length).toBe(2);
    expect(undoLabel.value).toBe('Rename the configuration');
    expect(doc.value.meta.name).toBe('two');
  });

  it('does not record an edit that changes nothing', () => {
    edit('No-op', (d) => d, undefined, 0);
    expect(canUndo.value).toBe(false);
  });

  it('coalesces a gesture that shares a key inside the window', () => {
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 8, dy: 0 }), 'drag:prm01', 1000);
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 16, dy: 0 }), 'drag:prm01', 1200);
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 24, dy: 0 }), 'drag:prm01', 1600);
    expect(undoStack.value.length).toBe(1);
    expect(doc.value.layout['prm01']).toEqual({ dx: 24, dy: 0 });
    undo();
    /* One undo takes the whole drag back to where it started. */
    expect(doc.value.layout['prm01']).toBeUndefined();
  });

  it('starts a new entry once the window has passed', () => {
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 8, dy: 0 }), 'drag:prm01', 1000);
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 16, dy: 0 }), 'drag:prm01',
      1000 + COALESCE_MS + 1);
    expect(undoStack.value.length).toBe(2);
  });

  it('does not coalesce across different keys, or without one', () => {
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 8, dy: 0 }), 'drag:prm01', 0);
    edit('Move sby01', (d) => withLayout(d, 'sby01', { dx: 8, dy: 0 }), 'drag:sby01', 100);
    edit('Rename', (d) => withMeta(d, { name: 'x' }), undefined, 150);
    edit('Rename', (d) => withMeta(d, { name: 'y' }), undefined, 160);
    expect(undoStack.value.length).toBe(4);
  });

  it('ends the gesture when the pointer goes up', () => {
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 8, dy: 0 }), 'drag:prm01', 0);
    breakCoalescing();
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 16, dy: 0 }), 'drag:prm01', 100);
    expect(undoStack.value.length).toBe(2);
  });

  it('redoes what it undid, and forgets the future on a new edit', () => {
    edit('First', (d) => withMeta(d, { name: 'first' }), undefined, 0);
    edit('Second', (d) => withMeta(d, { name: 'second' }), undefined, 5000);
    undo();
    expect(doc.value.meta.name).toBe('first');
    expect(canRedo.value).toBe(true);
    expect(redoLabel.value).toBe('Second');
    redo();
    expect(doc.value.meta.name).toBe('second');
    undo();
    edit('Third', (d) => withMeta(d, { name: 'third' }), undefined, 9000);
    expect(canRedo.value).toBe(false);
  });

  it('never coalesces onto an entry an undo has just moved past', () => {
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 8, dy: 0 }), 'drag:prm01', 0);
    undo();
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 16, dy: 0 }), 'drag:prm01', 100);
    expect(undoStack.value.length).toBe(1);
    expect(doc.value.layout['prm01']).toEqual({ dx: 16, dy: 0 });
  });

  it('caps the stack and drops the oldest entry', () => {
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      edit(`Edit ${i}`, (d) => withMeta(d, { name: `n${i}` }), undefined, i * 5000);
    }
    expect(undoStack.value.length).toBe(HISTORY_CAP);
  });

  it('forgets everything when the Document is replaced wholesale', () => {
    edit('First', (d) => withMeta(d, { name: 'first' }), undefined, 0);
    resetHistory(classicDoc());
    expect(canUndo.value).toBe(false);
    expect(canRedo.value).toBe(false);
  });
});

/*
 * Where a Document came from travels with it. Two callers change the document
 * and its provenance in one gesture -- Reset, and opening a lesson step -- and
 * an undo that restores half of that leaves a document that *is* a preset
 * while the picker and the address bar say it is not.
 */
describe('provenance', () => {
  it('snapshots the preset the edit started from', () => {
    presetId.value = 'classic';
    edit('Rename', (d) => withMeta(d, { name: 'mine' }), undefined, 0);
    expect(undoStack.value.at(-1)?.preset).toBe('classic');
  });

  it('restores it on undo and takes it away again on redo', () => {
    presetId.value = 'classic';
    edit('Reset', (d) => withMeta(d, { name: 'reset' }), undefined, 0);
    /* The caller drops the id after the edit, the way Reset does. */
    presetId.value = null;

    undo();
    expect(doc.value.meta.name).not.toBe('reset');
    expect(presetId.value).toBe('classic');

    redo();
    expect(doc.value.meta.name).toBe('reset');
    expect(presetId.value).toBeNull();
  });

  it('keeps the whole gesture on the id it started from when edits coalesce', () => {
    presetId.value = 'classic';
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 8, dy: 0 }), 'drag:prm01', 1000);
    presetId.value = null;
    edit('Move prm01', (d) => withLayout(d, 'prm01', { dx: 16, dy: 0 }), 'drag:prm01', 1200);
    expect(undoStack.value.length).toBe(1);
    undo();
    expect(presetId.value).toBe('classic');
  });
});
