/**
 * Topology's small timeline folds to its heading (ui/timeline/MiniTimeline.tsx):
 * a "Timeline" button with aria-expanded, open by default, remembered under
 * `dg-topology-timeline-v1`. Folded, the run is not drawn and the heading is
 * the way back; the rest of the dock stays. jsdom lays nothing out.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { loadMiniTimelineOpen, MINI_TIMELINE_KEY, setMiniTimelineOpen } from '@/state/persist';
import { edition, healthyRun, miniTimelineOpen, mode, playing, selection, tNow, viewport } from '@/state/view';
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
const button = (r: ParentNode, text: string): HTMLButtonElement | null =>
  [...r.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
const fold = (r: ParentNode): HTMLButtonElement | null => r.querySelector('.mtl-fold');
const crash = async (r: HTMLElement): Promise<void> => {
  const t = shelf(topology.value, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash scenario');
  click(button(r.querySelector('.dock-scn')!, t.label));
  await tick();
};

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
  miniTimelineOpen.value = true;
  closeBar();
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('Topology\'s small timeline fold', () => {
  it('is open by default, with a Timeline button that says so', async () => {
    const r = await mount();
    await crash(r);
    const b = fold(r)!;
    expect(b.textContent).toContain('Timeline');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(b.getAttribute('aria-controls')).toBe('mtl-plot');
    expect(r.querySelector('#mtl-plot .mtl-svg')).not.toBeNull();
  });

  it('folds to the heading and opens again; the rest of the dock stays', async () => {
    const r = await mount();
    await crash(r);
    click(fold(r));
    await tick();
    expect(r.querySelector('.mtl-svg')).toBeNull();
    expect(r.querySelector('.mtl.is-folded')).not.toBeNull();
    expect(fold(r)?.getAttribute('aria-expanded')).toBe('false');
    expect(r.querySelector('.dock-break .dock-scn-k')?.textContent).toBe('Break');
    expect(r.querySelector('.dock-status')).not.toBeNull();
    click(fold(r));
    await tick();
    expect(r.querySelector('.mtl-svg')).not.toBeNull();
    expect(fold(r)?.getAttribute('aria-expanded')).toBe('true');
  });

  it('pauses a run that is playing when it folds', async () => {
    const r = await mount();
    await crash(r);
    playing.value = true;
    click(fold(r));
    await tick();
    expect(playing.value).toBe(false);
  });

  it('is not there without a run', async () => {
    const r = await mount();
    expect(fold(r)).toBeNull();
  });

  it('leaves the Detailed timeline alone', async () => {
    const r = await mount();
    await crash(r);
    mode.value = 'break';
    await tick();
    expect(fold(r)).toBeNull();
  });
});

describe('the preference', () => {
  it('is open until told otherwise', () => {
    loadMiniTimelineOpen();
    expect(miniTimelineOpen.value).toBe(true);
  });

  it('is remembered under dg-topology-timeline-v1, and a reload reads it back', async () => {
    const r = await mount();
    await crash(r);
    click(fold(r));
    await tick();
    expect(MINI_TIMELINE_KEY).toBe('dg-topology-timeline-v1');
    expect(memory.get(MINI_TIMELINE_KEY)).toBe('0');
    miniTimelineOpen.value = true;
    loadMiniTimelineOpen();
    expect(miniTimelineOpen.value).toBe(false);
    setMiniTimelineOpen(true);
    expect(memory.get(MINI_TIMELINE_KEY)).toBe('1');
    miniTimelineOpen.value = false;
    loadMiniTimelineOpen();
    expect(miniTimelineOpen.value).toBe(true);
  });

  it('reads anything but 0 as open', () => {
    for (const junk of ['', '1', 'false', 'no', 'null']) {
      miniTimelineOpen.value = false;
      memory.set(MINI_TIMELINE_KEY, junk);
      loadMiniTimelineOpen();
      expect(miniTimelineOpen.value, junk).toBe(true);
    }
  });

  it('survives storage that throws', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
      expect(() => loadMiniTimelineOpen()).not.toThrow();
      expect(() => setMiniTimelineOpen(false)).not.toThrow();
      expect(miniTimelineOpen.value).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});
