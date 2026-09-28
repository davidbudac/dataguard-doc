/**
 * Compare alternatives -- the View of it (ui/review/ReviewPanel.tsx). The
 * baseline is kept in this browser under `dg-review-baseline-v1`, read back
 * through the validating decoder; the scenario run and the expectations last
 * for this visit. None of it is in the Document or in undo.
 */
import { signal } from '@preact/signals';
import type { ClassicScenario } from '@/engine';
import type { Expectation, ReviewSnapshot, ScenarioResult } from '@/ui/review/model';
import { reviewInputKey } from '@/ui/review/model';
import { doc } from './doc';
import { fromWire, toWire } from './codec';
import { edition, mode, playing, selection, tNow } from './view';
import { replaceWorkingDocument } from './workspaces';

export const reviewOpen = signal(false);
export type ReviewTab = 'compare' | 'scenarios';
export const reviewTab = signal<ReviewTab>('compare');
export const baseline = signal<ReviewSnapshot | null>(null);
export const baselineNotice = signal<string | null>(null);
export const comparisonScenario = signal<ClassicScenario>('crash');
export const suite = signal<{ snapshot: ReviewSnapshot; results: ScenarioResult[] } | null>(null);
export const expectations = signal<Partial<Record<ClassicScenario, Expectation>>>({});
const BASELINE_KEY = 'dg-review-baseline-v1';

export const currentSnapshot = (): ReviewSnapshot => ({ doc: doc.value, edition: edition.value });

export function loadBaseline(): void {
  try {
    const raw = window.localStorage.getItem(BASELINE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid baseline');
    const saved = parsed as Record<string, unknown>;
    const decoded = fromWire(saved['document']);
    if (!decoded.doc || decoded.issues.some((i) => i.severity === 'error' || i.severity === 'repaired')
      || decoded.dropped.length || !['19c', '26ai'].includes(String(saved['edition']))) throw new Error('Invalid baseline');
    baseline.value = { doc: decoded.doc, edition: saved['edition'] as '19c' | '26ai' };
  } catch {
    baselineNotice.value = 'The saved baseline could not be read. Save a new baseline to compare.';
  }
}

export function saveBaseline(): void {
  const snapshot = currentSnapshot();
  // Document edits are immutable; clone as an additional boundary for future callers.
  baseline.value = structuredClone(snapshot);
  baselineNotice.value = null;
  try {
    window.localStorage.setItem(BASELINE_KEY, JSON.stringify({ edition: snapshot.edition, document: toWire(snapshot.doc) }));
    baselineNotice.value = 'Baseline saved on this browser. Changes now compare against it.';
  } catch {
    baselineNotice.value = 'Baseline kept for this session only: browser storage is unavailable.';
  }
}

export function openScenario(snapshot: ReviewSnapshot, result: ScenarioResult): void {
  if (!result.trace || result.unavailable) return;
  const source = reviewInputKey(snapshot) === reviewInputKey(currentSnapshot()) ? doc.value : snapshot.doc;
  replaceWorkingDocument(`Open review scenario: ${result.label}`,
    { ...source, topology: result.topology }, null, snapshot.edition);
  playing.value = false;
  selection.value = [];
  tNow.value = 0;
  mode.value = 'break';
  reviewOpen.value = false;
}
