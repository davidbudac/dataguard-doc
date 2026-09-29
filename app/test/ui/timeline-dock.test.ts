/**
 * Break's Split layout, the lower region: a bar that the reader drags, and a
 * handle on its top edge that the arrow keys step, a height remembered across
 * reloads, and a full-screen toggle that Escape leaves.
 *
 * jsdom lays nothing out, so the drag itself is pinned in the browser pass
 * (docs/tasks/ui-followups.md 6.1); what is pinned here is the state behind it:
 * the clamp, the storage contract, the keyboard, the reset, the toggle and the
 * order Escape unwinds things in.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { loadTimelineH, setTimelineH, TIMELINE_H_KEY } from '@/state/persist';
import {
  clampTimelineH, findingsOpen, mode, timelineDefaultH, timelineFull, timelineH, timelineMaxH,
  TL_MIN_H, TL_STEP, viewport,
} from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';

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

/* Signals re-render on a microtask, but `useEffect` runs after paint --
   Preact's rAF-or-timeout -- and the Escape listener is installed by one. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

let root: HTMLElement | null = null;
const mount = (): HTMLElement => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

const crash = (): void => {
  const t = templates(topology.value, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  applyTemplate(t);
};

const grip = (r: HTMLElement): HTMLElement | null => r.querySelector<HTMLElement>('.dock-grip');
const fullBtn = (r: HTMLElement): HTMLButtonElement | null =>
  r.querySelector<HTMLButtonElement>('.tl-full-btn');
const key = (el: EventTarget, k: string, init: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  timelineH.value = null;
  timelineFull.value = false;
  findingsOpen.value = false;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('the height, as a number', () => {
  it('caps the region at three fifths of the room under the header, within 220-720 px', () => {
    /* 900 tall, header foot at 96: (900 - 96) * .6. */
    expect(timelineDefaultH(900, 96)).toBe(482);
    expect(timelineDefaultH(500, 96)).toBe(242);
    expect(timelineDefaultH(300, 96)).toBe(220);
    expect(timelineDefaultH(2400, 96)).toBe(720);
    /* Without a measured header, the 80 px the shell assumes. */
    expect(timelineDefaultH(900)).toBe(492);
  });

  it('never leaves the drawing under its minimum, never shrinks past the bar and a few lanes', () => {
    /* 900 tall, header foot at 96: 900 - 96 - 140 (what the drawing keeps). */
    expect(timelineMaxH(900, 96)).toBe(664);
    expect(clampTimelineH(5000, 900, 96)).toBe(664);
    expect(clampTimelineH(3, 900, 96)).toBe(TL_MIN_H);
    expect(clampTimelineH(300.4, 900, 96)).toBe(300);
    /* A window too short for anything keeps the bar and a few lanes anyway. */
    expect(timelineMaxH(100, 96)).toBe(TL_MIN_H);
  });
});

describe('remembered under dg-tl-h', () => {
  it('reads a stored height once, and ignores what is not one', () => {
    memory.set(TIMELINE_H_KEY, '480');
    loadTimelineH();
    expect(timelineH.value).toBe(480);
    for (const junk of ['', 'tall', '12', '-300', 'NaN']) {
      memory.set(TIMELINE_H_KEY, junk);
      loadTimelineH();
      expect(timelineH.value).toBeNull();
    }
    memory.delete(TIMELINE_H_KEY);
    loadTimelineH();
    expect(timelineH.value).toBeNull();
  });

  it('writes at the end of a gesture, not on every move, and forgets on reset', () => {
    setTimelineH(300, false);
    expect(timelineH.value).toBe(300);
    expect(memory.has(TIMELINE_H_KEY)).toBe(false);
    setTimelineH(312.6);
    expect(memory.get(TIMELINE_H_KEY)).toBe('313');
    setTimelineH(null);
    expect(timelineH.value).toBeNull();
    expect(memory.has(TIMELINE_H_KEY)).toBe(false);
  });
});

describe('the panel in Break', () => {
  it('has no handle and no full-screen button in the steady state, nor in Build', async () => {
    const r = mount();
    await tick();
    expect(grip(r)).toBeNull();
    expect(fullBtn(r)).toBeNull();
    crash();
    mode.value = 'build';
    await tick();
    expect(grip(r)).toBeNull();
    expect(fullBtn(r)).toBeNull();
  });

  it('with a run on it: a keyboard separator on the top edge, and a toggle', async () => {
    crash();
    const r = mount();
    await tick();
    const g = grip(r);
    expect(g).not.toBeNull();
    expect(g?.getAttribute('role')).toBe('separator');
    expect(g?.getAttribute('aria-orientation')).toBe('horizontal');
    expect(g?.tabIndex).toBe(0);
    expect(Number(g?.getAttribute('aria-valuemin'))).toBe(TL_MIN_H);
    expect(r.querySelector('.app-dock')?.classList.contains('has-tl')).toBe(true);
    expect(fullBtn(r)?.getAttribute('aria-pressed')).toBe('false');
  });

  it('arrow keys step the height and remember it; Enter and double-click reset', async () => {
    crash();
    const r = mount();
    await tick();
    const g = grip(r) as HTMLElement;
    /* jsdom paints nothing, so the step starts from the default for its
       window (768 tall). */
    const start = timelineDefaultH(window.innerHeight);
    key(g, 'ArrowUp');
    expect(timelineH.value).toBe(start + TL_STEP);
    expect(memory.get(TIMELINE_H_KEY)).toBe(String(start + TL_STEP));
    key(g, 'ArrowDown', { shiftKey: true });
    expect(timelineH.value).toBe(start + TL_STEP - 4 * TL_STEP);
    key(g, 'Home');
    expect(timelineH.value).toBe(TL_MIN_H);
    key(g, 'Enter');
    expect(timelineH.value).toBeNull();
    expect(memory.has(TIMELINE_H_KEY)).toBe(false);
    setTimelineH(400);
    await tick();
    (grip(r) as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(timelineH.value).toBeNull();
  });

  it('writes the height to --tl-h on the root, never as a style attribute inside the app', async () => {
    crash();
    setTimelineH(420);
    const r = mount();
    await tick();
    expect(document.documentElement.style.getPropertyValue('--tl-h')).toBe('420px');
    for (const el of r.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
    setTimelineH(null);
    await tick();
    expect(document.documentElement.style.getPropertyValue('--tl-h')).toBe('');
  });

  it('full screen: toggled by its button, left by Escape, never remembered', async () => {
    crash();
    const r = mount();
    await tick();
    fullBtn(r)?.click();
    await tick();
    expect(timelineFull.value).toBe(true);
    expect(r.querySelector('.app')?.classList.contains('tl-full')).toBe(true);
    expect(fullBtn(r)?.getAttribute('aria-pressed')).toBe('true');
    /* The handle has nothing to resize while the panel fills the window. */
    expect(grip(r)).toBeNull();
    key(document.body, 'Escape');
    await tick();
    expect(timelineFull.value).toBe(false);
    expect(r.querySelector('.app')?.classList.contains('tl-full')).toBe(false);
    expect([...memory.keys()].some((k) => k.includes('full'))).toBe(false);
  });

  it('Escape closes the findings popover first, then full screen', async () => {
    crash();
    const r = mount();
    await tick();
    timelineFull.value = true;
    findingsOpen.value = true;
    await tick();
    key(document.body, 'Escape');
    await tick();
    expect(findingsOpen.value).toBe(false);
    expect(timelineFull.value).toBe(true);
    key(document.body, 'Escape');
    await tick();
    expect(timelineFull.value).toBe(false);
    expect(r.querySelector('.tl-full')).toBeNull();
  });

  it('leaving Break or clearing the run puts the drawing back', async () => {
    crash();
    mount();
    await tick();
    timelineFull.value = true;
    await tick();
    mode.value = 'build';
    await tick();
    expect(timelineFull.value).toBe(false);
  });
});
