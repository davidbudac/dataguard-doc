/**
 * The header, the guidance line and the intro card -- the three things the
 * polish pass added because the page did not say how to use it.
 *
 * What is pinned here is what regressed the reading: the chips that shouted
 * NOTHING TO UNDO YET at a reader who had not yet done anything, the card that
 * has to appear exactly once, and the guidance line that has to change with
 * the mode rather than sitting there as decoration.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { TopBar } from '@/ui/TopBar';
import { Guidance } from '@/ui/Guidance';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { INTRO_KEY, dismissIntro, introDismissed, loadIntro } from '@/state/persist';
import { MODE_GUIDE, introOpen, mode, viewport } from '@/state/view';

/**
 * A Storage this environment does not otherwise have: what jsdom hands back
 * here is a bare object with no methods, so persistence has nothing to write
 * to. Small, in memory, and cleared between tests.
 */
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

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  introOpen.value = false;
  loadIntro();
});

describe('the header', () => {
  it('says nothing about having nothing to undo', () => {
    const root = mount(TopBar);
    const text = (root.textContent ?? '').toUpperCase();
    expect(text).not.toContain('NOTHING TO UNDO');
    expect(text).not.toContain('NOTHING UNDONE');
    /* The reason did not vanish, it moved: a disabled control still says why,
       in the one place a disabled control can say it without shouting. */
    const undo = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
    expect(undo?.disabled).toBe(true);
    expect(undo?.getAttribute('title')).toBe('Nothing to undo yet');
  });

  it('names the mode in hand under the mode buttons', async () => {
    const root = mount(TopBar);
    expect(root.textContent).toContain('Build — draw the configuration');
    mode.value = 'break';
    await tick();
    expect(root.textContent).toContain('Break — inject failures and watch the clocks');
  });

  it('carries a ? that reopens the card once it has been dismissed', async () => {
    dismissIntro();
    const root = mount(Guidance);
    await tick();
    expect(root.querySelector('.intro')).toBeNull();
    introOpen.value = true;
    await tick();
    expect(root.querySelector('.intro')).not.toBeNull();
  });
});

describe('the guidance line', () => {
  it('says what to do first, and changes with the mode', async () => {
    const root = mount(Guidance);
    expect(root.querySelector('.guide-line')?.textContent).toBe(MODE_GUIDE.build);
    for (const m of ['break', 'configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(root.querySelector('.guide-line')?.textContent).toBe(MODE_GUIDE[m]);
    }
  });
});

describe('the intro card', () => {
  it('shows on the first visit and names all three working modes', () => {
    const root = mount(Guidance);
    const intro = root.querySelector('.intro');
    expect(intro).not.toBeNull();
    const text = intro?.textContent ?? '';
    for (const word of ['Build', 'Break', 'Configure', 'Learn']) {
      expect(text).toContain(word);
    }
  });

  it('goes away when it is dismissed, and stays away across a reload', async () => {
    const root = mount(Guidance);
    const got = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Got it');
    expect(got).toBeDefined();
    got?.click();
    await tick();
    expect(root.querySelector('.intro')).toBeNull();
    expect(memory.get(INTRO_KEY)).toBe('1');

    /* A reload is `loadIntro()` reading the key again from a clean signal. */
    introDismissed.value = false;
    loadIntro();
    expect(introDismissed.value).toBe(true);
    const second = mount(Guidance);
    expect(second.querySelector('.intro')).toBeNull();
  });

  it('is in the shell on the first visit, and only there', async () => {
    const root = mount(App);
    await tick();
    expect(root.querySelectorAll('.intro').length).toBe(1);
  });
});
