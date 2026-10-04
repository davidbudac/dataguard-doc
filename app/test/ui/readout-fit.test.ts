/**
 * The Break bar's terse line never clips a value: it fits by leaving whole
 * readings out, least important first, and by shortening the labels before it
 * would give up an essential. The decision is a pure function of measured
 * widths (readout-fit.ts); jsdom lays nothing out, so the render tests stub the
 * bar's width and each element's offsetWidth, and the pixel result is pinned in
 * the browser pass (ui.md, "Break's two layouts").
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { readout, topology } from '@/state/derived';
import { mode, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { chipsThatFit } from '@/ui/break/readout-fit';
import type { FitItem } from '@/ui/break/readout-fit';

const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, String(v)); },
    removeItem: (k: string) => { memory.delete(k); },
    clear: () => { memory.clear(); },
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  } as unknown as Storage,
});

const item = (id: string, rank: number, core: boolean, long: number, short = long): FitItem =>
  ({ id, rank, core, long, short });

/* Outcome, Application, Observer are the essentials; the rest go in the order
   loss, open, abort. Widths are made up: what is tested is the decision. */
const ITEMS: FitItem[] = [
  item('outcome', 0, true, 150),
  item('open', 6, false, 130),
  item('loss', 8, false, 100),
  item('app', 2, true, 190, 120),
  item('observer', 3, true, 110),
];
const SEP = 16;
const total = (...w: number[]): number => w.reduce((a, b) => a + b, 0) + (w.length - 1) * SEP;

describe('chipsThatFit', () => {
  it('keeps everything, in the order given, when it all fits', () => {
    const r = chipsThatFit(ITEMS, total(150, 130, 100, 190, 110), SEP);
    expect(r).toEqual({ ids: ['outcome', 'open', 'loss', 'app', 'observer'], short: false });
  });

  it('drops Data loss first, then New primary open', () => {
    expect(chipsThatFit(ITEMS, total(150, 130, 190, 110), SEP).ids).toEqual(['outcome', 'open', 'app', 'observer']);
    const r = chipsThatFit(ITEMS, total(150, 190, 110), SEP);
    expect(r.ids).toEqual(['outcome', 'app', 'observer']);
    expect(r.short).toBe(false);
  });

  it('shortens labels before it gives up an essential', () => {
    const r = chipsThatFit(ITEMS, total(150, 120, 110), SEP);
    expect(r).toEqual({ ids: ['outcome', 'app', 'observer'], short: true });
  });

  it('drops the least important essential only when the short labels do not fit either', () => {
    const r = chipsThatFit(ITEMS, total(150, 120), SEP);
    expect(r).toEqual({ ids: ['outcome', 'app'], short: true });
  });

  it('never drops the most important reading, however little room there is', () => {
    expect(chipsThatFit(ITEMS, 10, SEP)).toEqual({ ids: ['outcome'], short: true });
  });

  it('does not shorten labels while a non-essential is still on the line', () => {
    const r = chipsThatFit(ITEMS, total(150, 130, 120, 110) + 1, SEP);
    expect(r.short).toBe(false);
    expect(r.ids).not.toContain('open');
  });

  it('constrains nothing when no room was measured', () => {
    expect(chipsThatFit(ITEMS, 0, SEP).ids).toHaveLength(5);
    expect(chipsThatFit(ITEMS, -5, SEP).short).toBe(false);
    expect(chipsThatFit([], 100, SEP).ids).toEqual([]);
  });

  it('is monotone: a narrower line never shows a reading a wider one left out', () => {
    let prev = new Set(ITEMS.map((i) => i.id));
    for (let w = total(150, 130, 100, 190, 110); w >= 0; w -= 7) {
      const now = new Set(chipsThatFit(ITEMS, w, SEP).ids);
      for (const id of now) expect(prev.has(id), `${id} at ${w}`).toBe(true);
      prev = now;
    }
  });
});

describe('the terse line, rendered', () => {
  const realClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const realOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const realRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  let root: HTMLElement | null = null;
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

  /** Every element is `client` px wide, and text is 7 px a character. */
  const stub = (client: number): void => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* measured once, on attach */ }
      disconnect(): void { /* nothing to release */ }
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => client });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) { return (this.textContent ?? '').length * 7; },
    });
  };
  const mount = async (): Promise<HTMLElement> => {
    root = document.createElement('div');
    document.body.appendChild(root);
    render(h(App, {}), root);
    await tick();
    return root;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    memory.clear();
    resetHistory(classicDoc());
    viewport.value = 'wide';
    mode.value = 'break';
  });
  afterEach(() => {
    if (root) render(null, root);
    root = null;
    if (realClient) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realClient);
    if (realOffset) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffset);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realRO;
  });

  const crash = (): void => {
    const t = templates(topology.value, 0).find((x) => x.id === 'crash');
    if (!t) throw new Error('no crash template');
    applyTemplate(t);
  };

  const shown = (r: HTMLElement): string[] =>
    [...r.querySelectorAll<HTMLElement>('.sb-ro .sb-ro-i')].map((el) => el.querySelector('.sb-ro-k')!.textContent ?? '');
  const values = (r: HTMLElement): string[] =>
    [...r.querySelectorAll<HTMLElement>('.sb-ro .sb-ro-i .sb-ro-v')].map((el) => el.textContent ?? '');

  it('shows every reading on a wide line', async () => {
    crash();
    stub(1400);
    const r = await mount();
    const all = readout.value.filter((c) => c.id !== 'findings');
    expect(all.length).toBeGreaterThan(3);
    expect(shown(r)).toEqual(all.map((c) => c.k));
    expect(r.querySelector('.sb-ro')?.getAttribute('title')).toBeNull();
  });

  it('leaves low-priority readings out whole on a narrow line, and clips no value', async () => {
    crash();
    stub(1400);
    const wide = await mount();
    const allKeys = shown(wide);
    const allValues = values(wide);
    render(null, wide);
    root = null;
    document.body.innerHTML = '';

    stub(430);
    const r = await mount();
    const keys = shown(r);
    expect(keys).toContain('Outcome');
    expect(keys).not.toContain('Data loss');
    expect(keys).not.toContain('New primary open');
    expect(keys.length).toBeLessThan(allKeys.length);
    /* Every value drawn is a whole one: it is exactly a full reading's value. */
    for (const v of values(r)) expect(allValues).toContain(v);
    /* Nothing is left to the browser to cut. */
    for (const el of r.querySelectorAll('.sb-ro .sb-ro-i')) {
      expect(el.getAttribute('style')).toBeNull();
    }
    /* The readings left out are a hover away. */
    const title = r.querySelector('.sb-ro')?.getAttribute('title') ?? '';
    expect(title).toContain('Data loss:');
    expect(title).toContain('New primary open:');
    expect(title).toContain('Outcome:');
  });

  it('gives up Split brain before anything else, and never lets it stand in for an essential', async () => {
    crash();
    const keysAt = async (w: number): Promise<string[]> => {
      stub(w);
      const r = await mount();
      const keys = shown(r);
      render(null, r);
      root = null;
      document.body.innerHTML = '';
      return keys;
    };
    const all = await keysAt(1400);
    expect(all).toContain('Split brain');
    /* The widest line that leaves something out, found by halving: the first reading to go is Split brain, and only it. */
    let lo = 300;
    let hi = 1400;
    while (hi - lo > 12) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await keysAt(mid)).length < all.length) lo = mid; else hi = mid;
    }
    expect(await keysAt(hi)).toEqual(all);
    expect(await keysAt(lo)).toEqual(all.filter((k) => k !== 'Split brain'));
  }, 20000);

  it('shortens labels, never values, when only the essentials are left', async () => {
    crash();
    stub(1400);
    const wide = await mount();
    const allValues = values(wide);
    render(null, wide);
    root = null;
    document.body.innerHTML = '';

    stub(470);
    const r = await mount();
    for (const v of values(r)) expect(allValues).toContain(v);
    /* The three essentials, the application's label short, and every value whole. */
    expect(shown(r)).toEqual(['Outcome', 'App reconnects', 'Observer']);
  });
});
