/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { openReview, ReviewDialog } from '@/ui/review/ReviewPanel';
import { classicDoc, doc } from '@/state/doc';
import { edit, resetHistory, undo } from '@/state/history';
import { baseline, baselineNotice, comparisonScenario, expectations, reviewOpen, reviewTab, suite } from '@/state/review';
import { edition, mode, toast } from '@/state/view';

let root: HTMLDivElement;
const storage = new Map<string, string>();
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
function button(name: string): HTMLButtonElement {
  const el = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  expect(el, name).toBeTruthy(); return el!;
}
const click = async (name: string) => { await act(() => button(name).click()); await flush(); };

beforeEach(() => {
  storage.clear();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  baseline.value = null; baselineNotice.value = null;
  suite.value = null; expectations.value = {}; comparisonScenario.value = 'crash';
  reviewOpen.value = false; reviewTab.value = 'compare'; edition.value = '19c'; mode.value = 'build'; toast.value = null;
  resetHistory(classicDoc());
  root = document.createElement('div'); document.body.append(root);
  /* The ⋯ menu's item, standing in for it: a button that opens the dialog. */
  act(() => render(h('div', {},
    h('button', { type: 'button', onClick: () => openReview() }, 'Compare alternatives'),
    h(ReviewDialog, {})), root));
});
afterEach(() => { act(() => render(null, root)); root.remove(); });

describe('Review workflows', () => {
  it('saves a baseline, compares an edit, and opens the selected scenario undoably', async () => {
    await click('Compare alternatives'); await click('Save baseline');
    await act(() => edit('Change threshold', (d) => ({ ...d, topology: { ...d.topology, config: { ...d.topology.config, fsfo: { ...d.topology.config.fsfo, thresholdSeconds: 60 } } } })));
    await flush();
    expect(root.textContent).toContain('t = 55 s');
    expect(root.textContent).toContain('t = 85 s');
    expect(root.textContent).toContain('1 changed setting');
    expect(baseline.value?.doc.topology.config.fsfo.thresholdSeconds).toBe(30);
    await click('Open current scenario');
    expect(mode.value).toBe('break');
    expect(doc.value.topology.events.length).toBeGreaterThan(0);
    expect(reviewOpen.value).toBe(false);
    await act(() => undo());
    expect(doc.value.topology.events).toHaveLength(0);
    expect(doc.value.topology.config.fsfo.thresholdSeconds).toBe(60);
  });

  it('marks stored scenario results stale after an edit and opens the tested snapshot', async () => {
    await click('Compare alternatives'); await click('Common failures'); await click('Run common scenarios');
    expect(suite.value?.results).toHaveLength(6);
    expect(doc.value.topology.events).toHaveLength(0);
    await act(() => edit('Change threshold', (d) => ({ ...d, topology: { ...d.topology, config: { ...d.topology.config, fsfo: { ...d.topology.config.fsfo, thresholdSeconds: 60 } } } })));
    await flush();
    expect(root.textContent).toContain('The configuration changed since this run');
    await click('Crash the primary host');
    expect(doc.value.topology.config.fsfo.thresholdSeconds).toBe(30);
    await act(() => undo());
    expect(doc.value.topology.config.fsfo.thresholdSeconds).toBe(60);
  });

  it('keeps focus in the dialog and returns it to Review on Escape', async () => {
    button('Compare alternatives').focus();
    await click('Compare alternatives');
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    const close = button('Close'); close.focus();
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(button('Open the report'));
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    expect(document.activeElement).toBe(close);
    await act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await flush();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('Compare alternatives'));
  });

  it('does not create a warning or read storage until the dialog is opened', async () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('Denied'); } });
    await flush();
    expect(toast.value).toBeNull();
    await click('Compare alternatives');
    expect(root.textContent).toContain('could not be read');
    await click('Save baseline');
    expect(root.textContent).toContain('session only');
    expect(root.querySelector('[style]')).toBeNull();
  });
});
