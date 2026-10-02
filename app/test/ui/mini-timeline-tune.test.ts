/**
 * The timeline is the control (ui/timeline/MiniTimeline.tsx, break/PlayDock.tsx):
 * in Topology a crash leaves the small timeline with a badge for the new
 * primary's opening, braces that are settings with a grip each, a grip that
 * changes the setting and moves the badge, and labels whose numbers can be
 * typed. jsdom lays nothing out; how it sits is the browser pass.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { edition, healthyRun, mode, playing, selection, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { shelf } from '@/ui/break/events';
import { closeBar } from '@/ui/canvas/bar';

const memory = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => { memory.clear(); },
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
} as unknown as Storage;
Object.defineProperty(window, 'localStorage', { configurable: true, value: fakeStorage });

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

let root: HTMLElement | null = null;
const mount = async (): Promise<HTMLElement> => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  await tick();
  return root;
};

const click = (el: Element | null): void => {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const key = (el: Element, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};
const button = (r: ParentNode, text: string): HTMLButtonElement | null =>
  [...r.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
const choose = (el: HTMLSelectElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const pressScenario = async (r: HTMLElement, id: string): Promise<void> => {
  const t = shelf(topology.value, 0).find((x) => x.id === id);
  if (!t) throw new Error(`no scenario ${id}`);
  click(button(r.querySelector('.dock-scn')!, t.label));
  await tick();
};
/** The badge's own words (its `<title>` is text too, so the `<text>` is asked for). */
const badge = (r: ParentNode, start: string): Element | undefined =>
  [...r.querySelectorAll('.mtl-badge .mtl-badge-t')].find((b) => b.textContent?.trim().startsWith(start));

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  edition.value = '19c';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  playing.value = false;
  healthyRun.value = false;
  selection.value = [];
  tNow.value = 0;
  closeBar();
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('Topology\'s dock: the timeline is the control', () => {
  it('has no settings form: the scenarios are the Break row, with the three settings as chips', async () => {
    const r = await mount();
    expect(r.querySelector('.dock-break .dock-scn-k')?.textContent).toBe('Break');
    expect(r.querySelectorAll('.dock-break .sc-row select')).toHaveLength(3);
    expect(r.querySelector('.dock-break .sc-all')?.textContent).toBe('All settings →');
    expect(r.querySelector('.tune-strip')).toBeNull();
    expect(r.querySelector('.sb-tune')).toBeNull();
  });

  it('edits the protection mode from its chip', async () => {
    const r = await mount();
    choose(r.querySelector('.dock-break select[aria-label="Protection mode"]') as HTMLSelectElement, 'MAXPERFORMANCE');
    await tick();
    expect(topology.value.config.protectionMode).toBe('MAXPERFORMANCE');
  });

  it('draws the badges, the braces and the grips after a crash, and the readout leaves the two times to them', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    expect(badge(r, 'open')).toBeDefined();
    expect(badge(r, 'reconnects')).toBeDefined();
    const labels = [...r.querySelectorAll('.mtl-bl')].map((l) => l.textContent ?? '');
    expect(labels.some((l) => l.includes('threshold'))).toBe(true);
    expect(labels.some((l) => l.includes('retry window'))).toBe(true);
    expect(r.querySelectorAll('.mtl-svg [role="slider"].tl-tune').length).toBeGreaterThan(0);
    const line = r.querySelector('.dock-status .sb-ro')?.textContent ?? '';
    expect(line).not.toContain('New primary open');
    expect(line).not.toContain('Application reconnects');
    expect(line).toContain('Data loss');
  });

  it('puts the application on the small timeline', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    const kinds = [...r.querySelectorAll('.mtl-svg .mtl-lane')].map((g) => g.getAttribute('data-kind'));
    expect(kinds).toContain('application');
    expect(kinds).toContain('observer');
  });

  it('changes the threshold from its grip, and the badge moves with it', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    const before = badge(r, 'open')?.textContent ?? '';
    const t0 = topology.value.config.fsfo.thresholdSeconds;
    const grip = r.querySelector('.mtl-svg .tl-tune.is-brace[data-tune="threshold"]');
    if (!grip) throw new Error('no threshold grip');
    key(grip, 'ArrowRight');
    await tick();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(t0 + 1);
    const after = badge(r, 'open')?.textContent ?? '';
    expect(after).not.toBe('');
    expect(after).not.toBe(before);
  });

  it('types the number on a label', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    const label = [...r.querySelectorAll('.mtl-lab.is-edit')].find((g) => g.textContent?.includes('threshold'));
    if (!label) throw new Error('no editable threshold label');
    click(label);
    await tick();
    const input = r.querySelector<HTMLInputElement>('.mtl-edit input');
    if (!input) throw new Error('no number box');
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(20);
    key(input, 'Escape');
    await tick();
    expect(r.querySelector('.mtl-edit')).toBeNull();
  });

  it('drags the connect string\'s timeout from the retry window\'s grip, and the window follows', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    const before = topology.value.applications?.[0]?.client?.transportConnectTimeoutSeconds
      ?? topology.value.client.transportConnectTimeoutSeconds;
    const grip = r.querySelector('.mtl-svg .tl-tune.is-brace[data-tune="clientTiming"]');
    if (!grip) throw new Error('no retry window grip');
    /* The default 60 s is the field's ceiling, so the step is down. */
    key(grip, 'ArrowLeft');
    await tick();
    const d = topology.value;
    const after = d.applications?.[0]?.client?.transportConnectTimeoutSeconds ?? d.client.transportConnectTimeoutSeconds;
    expect(after).toBe(before - 1);
    const window = [...r.querySelectorAll('.mtl-bl')].map((l) => l.textContent ?? '').find((l) => l.includes('retry window'));
    expect(window).toBe('retry window 59 s');
  });

  it('words the retry window grip\'s note for the edition, as the inspector does', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    const tip = (): string => r.querySelector('.mtl-svg .tl-tune.is-brace[data-tune="clientTiming"] title')?.textContent ?? '';
    expect(tip()).toMatch(/Default 60 s in tnsnames\.ora/);
    expect(tip()).not.toMatch(/from 26ai/);
    edition.value = '26ai';
    await tick();
    expect(tip()).toMatch(/from 26ai/);
  });

  it('draws no grip and no box for a reader who cannot edit, but the brackets stay', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    viewport.value = 'narrow';
    await tick();
    expect(r.querySelectorAll('.mtl-svg .tl-tune')).toHaveLength(0);
    expect(r.querySelector('.mtl-lab.is-edit')).toBeNull();
    expect([...r.querySelectorAll('.mtl-bl')].some((l) => l.textContent?.includes('threshold'))).toBe(true);
  });
});
