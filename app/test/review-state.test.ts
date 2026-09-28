/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { classicDoc, doc, withMeta } from '@/state/doc';
import { edit, resetHistory, undo } from '@/state/history';
import { baseline, baselineNotice, loadBaseline, openScenario, reviewOpen, saveBaseline } from '@/state/review';
import { edition, mode } from '@/state/view';
import { recoveries, refreshWorkspaces } from '@/state/workspaces';
import { runScenario } from '@/ui/review/model';

const stored = new Map<string, string>();
let blocked = false;
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { if (blocked) throw new Error('Storage blocked'); stored.set(key, value); },
  removeItem: (key: string) => { stored.delete(key); },
  clear: () => stored.clear(),
} });

beforeEach(() => {
  stored.clear(); blocked = false;
  resetHistory(classicDoc());
  refreshWorkspaces();
  baseline.value = null;
  baselineNotice.value = null;
  reviewOpen.value = false;
  edition.value = '19c';
  mode.value = 'build';
});

describe('browser baseline', () => {
  it('rejects malformed JSON and malformed topology without replacing the document', () => {
    stored.set('dg-review-baseline-v1', '{bad');
    loadBaseline();
    expect(baseline.value).toBeNull();
    expect(baselineNotice.value).toContain('could not be read');
    stored.set('dg-review-baseline-v1', JSON.stringify({ edition: '19c', document: { nonsense: true } }));
    baselineNotice.value = null;
    loadBaseline();
    expect(baseline.value).toBeNull();
    expect(baselineNotice.value).toContain('could not be read');
    expect(doc.value.meta.name).toBe(classicDoc().meta.name);
  });

  it('keeps a session baseline when writing to browser storage fails', () => {
    blocked = true;
    saveBaseline();
    expect(baseline.value?.edition).toBe('19c');
    expect(baselineNotice.value).toContain('session only');
    expect(stored.size).toBe(0);
  });

  it('restores a saved baseline through the validated document codec', () => {
    saveBaseline();
    baseline.value = null;
    loadBaseline();
    expect(baseline.peek()?.doc.topology.members.length).toBe(doc.value.topology.members.length);
    expect(baseline.peek()?.edition).toBe('19c');
  });
});

describe('opening a tested scenario', () => {
  it('restores the tested snapshot and edition, with recovery and Undo for the current draft', () => {
    const tested = { doc: classicDoc(), edition: '19c' as const };
    const result = runScenario(tested, 'crash');
    edit('Draft note', (d) => withMeta(d, { notes: 'retain this draft' }));
    edition.value = '26ai';
    reviewOpen.value = true;
    openScenario(tested, result);
    expect(mode.value).toBe('break');
    expect(reviewOpen.value).toBe(false);
    expect(edition.value).toBe('19c');
    expect(doc.value.topology.events).toEqual(result.topology.events);
    expect(recoveries.value[0]?.document.meta.notes).toBe('retain this draft');
    undo();
    expect(doc.value.meta.notes).toBe('retain this draft');
    expect(edition.value).toBe('26ai');
  });

  it('does not replace the document for an unavailable scenario', () => {
    const tested = { doc: classicDoc(), edition: '19c' as const };
    tested.doc.topology.observers = [];
    const result = runScenario(tested, 'observer-lost');
    const before = doc.value;
    openScenario(tested, result);
    expect(doc.value).toBe(before);
    expect(mode.value).toBe('build');
  });
});
