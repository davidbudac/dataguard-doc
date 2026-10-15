/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { edition, mode, selection, viewport } from '@/state/view';
import { topology } from '@/state/derived';
import { connectionLayer } from '@/ui/canvas/layers';
import { CanvasSlot } from '@/ui/canvas/CanvasSlot';
import { Num } from '@/ui/inspector/controls';
import { setApplyLag } from '@/ui/inspector/edits';
import { memberId } from '@/engine';
import { comparisonModels, ComparisonTimeline } from '@/ui/review/ComparisonTimeline';
import { runScenario } from '@/ui/review/model';
import type { ReviewSnapshot } from '@/ui/review/model';
import { printing } from '@/ui/print';

let root: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
beforeEach(() => {
  resetHistory(classicDoc()); edition.value = '19c'; viewport.value = 'wide'; mode.value = 'build';
  selection.value = []; connectionLayer.value = 'all'; printing.value = false;
  root = document.createElement('div'); document.body.append(root);
});
afterEach(() => { act(() => render(null, root)); root.remove(); printing.value = false; });

describe('Connection layers', () => {
  it('filters lines and keyboard captions together without changing the document', async () => {
    const original = JSON.stringify(doc.value);
    act(() => render(h(CanvasSlot, { interactive: true }), root)); await flush();
    const all = root.querySelectorAll('.tp-links > g').length;
    expect(all).toBeGreaterThan(2);
    const graph = root.querySelector('.topo-svg')!.getAttribute('viewBox');
    const choose = async (name: string) => {
      await act(() => [...root.querySelectorAll<HTMLButtonElement>('.connection-layers button')].find((b) => b.textContent === name)!.click());
      await flush();
    };
    await choose('Redo');
    expect(root.querySelectorAll('.tp-links > g')).toHaveLength(1);
    expect(root.querySelectorAll('.tp-pills > g')).toHaveLength(1);
    expect(root.querySelector('.tp-pills [tabindex="0"]')).not.toBeNull();
    expect(root.querySelector('.layer-notice')?.textContent).toContain('hidden');
    expect(root.querySelector('.topo-svg')!.getAttribute('viewBox')).toBe(graph);
    await choose('Observer');
    expect(root.querySelectorAll('.tp-links > g')).toHaveLength(2);
    await choose('All');
    expect(root.querySelectorAll('.tp-links > g')).toHaveLength(all);
    expect(JSON.stringify(doc.value)).toBe(original);
  });

  it('prints all connections even when the viewing layer is filtered', async () => {
    connectionLayer.value = 'redo';
    act(() => render(h(CanvasSlot, { interactive: true }), root)); await flush();
    expect(root.querySelectorAll('.tp-links > g')).toHaveLength(1);
    await act(() => { printing.value = true; }); await flush();
    expect(root.querySelectorAll('.tp-links > g').length).toBeGreaterThan(2);
  });

  it('emphasizes selected connections without relying on hover', async () => {
    selection.value = ['sby01'];
    act(() => render(h(CanvasSlot, { interactive: true }), root)); await flush();
    expect(root.querySelector('.tp-links .is-dim')).not.toBeNull();
    expect(root.querySelector('.tp-links .tp-linkwrap:not(.is-dim)')).not.toBeNull();
  });
});

describe('Precise values', () => {
  it('commits a typed slider value as one undoable edit and refuses empty input', async () => {
    function Control() {
      const standby = topology.value.members.find((m) => m.id === 'sby01')!;
      return h(Num, { name: 'Apply lag', prose: true, bound: 'applyLagSeconds',
        value: 'applyLagSeconds' in standby ? standby.applyLagSeconds : 0,
        onChange: (v: number) => setApplyLag(memberId('sby01'), v) });
    }
    act(() => render(h(Control, {}), root)); await flush();
    const before = JSON.stringify(doc.value);
    const input = root.querySelector<HTMLInputElement>('.num-entry')!;
    await act(() => { input.value = '17'; input.dispatchEvent(new Event('change', { bubbles: true })); }); await flush();
    expect(root.querySelector<HTMLInputElement>('input[type=range]')!.value).toBe('17');
    await act(() => { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(input.value).toBe('17');
    await act(() => undo()); await flush();
    expect(JSON.stringify(doc.value)).toBe(before);
    expect(root.querySelector('.num-default')).toBeNull(); // a condition has no broker default
  });
});

describe('Comparison time scale', () => {
  const runs = () => {
    const base: ReviewSnapshot = { doc: classicDoc(), edition: '19c' };
    const current = structuredClone(base);
    current.doc.topology.config.fsfo.thresholdSeconds = 90;
    return { base, current, before: runScenario(base, 'crash'), after: runScenario(current, 'crash') };
  };
  it('uses the same pixels per second and preserves both runs’ actual opening times', () => {
    const { before, after } = runs();
    const models = comparisonModels(before, after)!;
    expect(models[0].scale.t1).toBe(models[1].scale.t1);
    expect(models[0].scale.x(30)).toBe(models[1].scale.x(30));
    expect(models[0].scale.pxPerSecond).toBe(models[1].scale.pxPerSecond);
    expect(after.trace!.facts.tOpen! - before.trace!.facts.tOpen!).toBe(60);
    expect(models[1].scale.t1).toBeGreaterThan(after.trace!.facts.tOpen!);
  });
  it('scrubs both alternatives together without changing authored events', async () => {
    const { before, after } = runs(); const original = JSON.stringify(doc.value);
    act(() => render(h(ComparisonTimeline, { before, after }), root)); await flush();
    const input = root.querySelector<HTMLInputElement>('input[type=range]')!;
    await act(() => { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); }); await flush();
    expect(root.textContent).toContain('Baseline at 40 s');
    expect(root.textContent).toContain('Current at 40 s');
    expect(JSON.stringify(doc.value)).toBe(original);
  });
  it('refuses an unavailable run instead of drawing an invented timeline', () => {
    const { before, after } = runs();
    expect(comparisonModels(before, { ...after, trace: null, unavailable: 'No target' })).toBeNull();
  });
});
