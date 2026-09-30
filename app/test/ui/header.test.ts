/**
 * The header, the guidance line and the intro -- the chrome the polish pass
 * added because the page did not say how to use it, and then had to cut back
 * because it had grown to 250 px above a 260 px drawing.
 *
 * What is pinned here is what regressed the reading: the chips that shouted
 * NOTHING TO UNDO YET at a reader who had not yet done anything; the mode
 * sentence and the guidance line, which said the same thing on two lines and
 * are one line now; the first-visit strip, which has to appear exactly once
 * and has to go by itself once the reader is working; and the keyboard map,
 * which is the only place the shortcuts are written down.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { TopBar } from '@/ui/TopBar';
import { Guidance } from '@/ui/Guidance';
import { classicDoc } from '@/state/doc';
import { edit, resetHistory } from '@/state/history';
import { INTRO_KEY, dismissIntro, introDismissed, loadHints, loadIntro } from '@/state/persist';
import {
  MODE_SUB, hintsOn, introOpen, mode, modeGuide, railWhere, splitGuide, viewport,
} from '@/state/view';
import type { Viewport } from '@/state/view';

const VIEWPORTS: readonly Viewport[] = ['wide', 'medium', 'compact', 'narrow'];

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

/**
 * Mounted trees, so the next test can unmount them.
 *
 * Emptying `document.body` hides a tree; it does not unmount it, and an
 * unmounted-in-name-only Guidance keeps the effect that watches for the
 * reader's first gesture. One test's `resetHistory` would then be read as the
 * previous test's first edit.
 */
const mounted: HTMLElement[] = [];

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  mounted.push(root);
  return root;
};

const unmountAll = (): void => {
  while (mounted.length > 0) render(null, mounted.pop() as HTMLElement);
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Preact runs effects after paint: a frame, then a task behind it. The
 * auto-dismiss watcher is installed in one of those effects, so a test that
 * fires its gesture on a bare `setTimeout(0)` fires it before there is
 * anything listening.
 */
async function paint(): Promise<void> {
  await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
  await tick();
  await tick();
}

beforeEach(() => {
  unmountAll();
  document.body.innerHTML = '';
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  introOpen.value = false;
  loadIntro();
  /* Hints are off unless a test says otherwise: that is what a first visit
     reads, and the guidance line is one clause long there. */
  loadHints();
});

describe('the header', () => {
  it('says nothing about having nothing to undo', () => {
    const root = mount(TopBar);
    const text = (root.textContent ?? '').toUpperCase();
    expect(text).not.toContain('NOTHING TO UNDO');
    expect(text).not.toContain('NOTHING UNDONE');
    /* The reason did not vanish, it moved: a disabled control still says why,
       in the one place a disabled control can say it without shouting. */
    const undo = [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Undo');
    expect(undo?.disabled).toBe(true);
    expect(undo?.getAttribute('title')).toBe('Nothing to undo yet');
  });

  /* The sentence did not vanish with the subtitle band -- it is what each
     mode button says when the pointer rests on it. */
  it('says what each mode is for on the button itself, not on a line of its own', () => {
    const root = mount(TopBar);
    const build = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Topology');
    expect(build?.getAttribute('title')).toBe(MODE_SUB.build);
    const configure = [...root.querySelectorAll('button')]
      .find((b) => b.textContent === 'Config');
    /* Configure reads as "settings" and is generated output: the tooltip and
       the guidance line both have to say so. */
    expect(configure?.getAttribute('title')).toBe(MODE_SUB.configure);
    expect(MODE_SUB.configure).toContain('generated from the drawing');
    /* And no `title` names a screen edge: one string serves every viewport,
       and where the inspector sits depends on how much of the shell fits. */
    for (const sub of Object.values(MODE_SUB)) {
      expect(sub).not.toContain('on the right');
      expect(sub).not.toContain('drawer');
    }
    /* And the second line is gone: no band under the modes. */
    expect(root.querySelector('.topbar-sub')).toBeNull();
    expect(root.textContent).not.toContain('draw the configuration');
    /* The two re-cut modes wear their new words; the ids are what they were. */
    const words = [...root.querySelectorAll('.topbar-modes button')].map((b) => b.textContent);
    expect(words).toEqual(['Topology', 'Detailed timeline', 'Config', 'Learn']);
  });

  it('carries a ? that reopens the whole explanation once it has been dismissed', async () => {
    dismissIntro();
    const root = mount(Guidance);
    await tick();
    expect(root.querySelector('.intro')).toBeNull();
    expect(root.querySelector('.intro-strip')).toBeNull();
    introOpen.value = true;
    await tick();
    expect(root.querySelector('.intro')).not.toBeNull();
  });

  /* A control that opens something says whether it is open, and pressing it
     again closes it: a ? that only ever opens leaves the reader hunting for
     the way out of a card they opened by accident. */
  it('says whether the explanation is open, and shuts it on a second press', async () => {
    const bar = mount(TopBar);
    const guide = mount(Guidance);
    const help = (): HTMLButtonElement => [...bar.querySelectorAll('button')]
      .find((b) => b.textContent === '?') as HTMLButtonElement;
    expect(help().getAttribute('aria-expanded')).toBe('false');

    help().click();
    await tick();
    expect(introOpen.value).toBe(true);
    expect(help().getAttribute('aria-expanded')).toBe('true');
    expect(guide.querySelector('.intro')).not.toBeNull();

    help().click();
    await tick();
    expect(introOpen.value).toBe(false);
    expect(help().getAttribute('aria-expanded')).toBe('false');
    expect(guide.querySelector('.intro')).toBeNull();
  });

  /* Opening an explanation and shutting it again is not the same as having
     been shown the Introduction, which is what `dg-intro-v1` now records
     (ui.md SS3e): the page is still owed on the next visit. */
  it('does not call the page understood because the ? was closed again', async () => {
    const bar = mount(TopBar);
    mount(Guidance);
    const help = (): HTMLButtonElement => [...bar.querySelectorAll('button')]
      .find((b) => b.textContent === '?') as HTMLButtonElement;
    help().click();
    await tick();
    help().click();
    await tick();
    expect(memory.get(INTRO_KEY)).toBeUndefined();
    expect(introDismissed.value).toBe(false);
  });

  /* The card is the short form; the page is the long one, and the card is one
     of the two places that offer it (the other is the brand corner). */
  it('offers the Introduction from the card, as a real link', async () => {
    introOpen.value = true;
    const root = mount(Guidance);
    await tick();
    const link = [...root.querySelectorAll('a')]
      .find((a) => (a.textContent ?? '').includes('introduction'));
    expect(link?.getAttribute('href')).toBe('?intro=1');
  });
});

describe('the guidance line', () => {
  it('is one line: the mode word, then what to do first', async () => {
    mode.value = 'configure';
    const root = mount(Guidance);
    const line = (): string => root.querySelector('.guide-line')?.textContent ?? '';
    /* One clause by default -- the gesture. The sentence behind it is
       explanation and waits for `Hints`. */
    expect(line()).toBe(`Config · ${splitGuide('configure', 'wide').lead}`);
    mode.value = 'learn';
    await tick();
    expect(line()).toContain(splitGuide('learn', 'wide').lead);
  });

  /* Build went the way Break did: the line is not drawn, its clause is the mode
     button's title and the stage's description, and the band's height is the
     drawing's. */
  it('is absent in Build, and its text is kept where a reader can still get it', async () => {
    mode.value = 'build';
    const root = mount(Guidance);
    await tick();
    expect(root.querySelector('.guide-line')).toBeNull();
    expect(root.querySelector('.guide')).toBeNull();
    expect(MODE_SUB.build).toContain('click to edit, drag to move, + to add');
    introOpen.value = true;
    await tick();
    expect(root.querySelector('.guide .intro')).not.toBeNull();
    introOpen.value = false;
  });

  it('describes the stage in Build and Break, and in no other mode', async () => {
    const shell = mount(App);
    const stage = (): string | null => shell.querySelector('main.app-stage')?.getAttribute('aria-description') ?? null;
    expect(shell.querySelector('.guide-line')).toBeNull();
    expect(stage()).toBe(modeGuide('build', 'wide'));
    expect(stage()).toContain('Click to edit');
    mode.value = 'break';
    await tick();
    expect(stage()).toBe(modeGuide('break', 'wide'));
    mode.value = 'configure';
    await tick();
    expect(stage()).toBeNull();
    expect(shell.querySelector('.guide-line')).not.toBeNull();
  });

  /* Break's gestures moved to the mode button's title and the stage's
     description; the band's height went to the drawing. */
  it('is absent in Break, and its text is kept where a reader can still get it', async () => {
    mode.value = 'break';
    const root = mount(Guidance);
    await tick();
    expect(root.querySelector('.guide-line')).toBeNull();
    expect(root.querySelector('.guide')).toBeNull();
    expect(MODE_SUB.break).toContain('the run in full');
    expect(MODE_SUB.break).toContain('drag a numbered marker');
    introOpen.value = true;
    await tick();
    expect(root.querySelector('.guide .intro')).not.toBeNull();
    introOpen.value = false;
  });

  it('gives the whole sentence back with hints on, and takes it away again', async () => {
    mode.value = 'configure';
    const root = mount(Guidance);
    const line = (): string => root.querySelector('.guide-line')?.textContent ?? '';
    const { lead, rest } = splitGuide('configure', 'wide');
    expect(rest).not.toBe('');
    expect(line()).not.toContain(rest);

    hintsOn.value = true;
    await tick();
    expect(line()).toBe(`Config · ${lead} ${rest}`);
    /* The second half is the second half of `modeGuide`, promoted to its own
       sentence -- nothing is dropped on the way. */
    expect(modeGuide('configure', 'wide')).toContain('Settings are in the panel on the right');
    expect(line()).toContain('Settings are in');

    hintsOn.value = false;
    await tick();
    expect(line()).toBe(`Config · ${lead}`);
  });

  /* The cut is made at a clause boundary, and Configure's first sentence names
     its own output rather than being trimmed to four words. */
  it('leads with a whole clause in every mode', () => {
    for (const m of ['build', 'break', 'configure', 'learn'] as const) {
      const { lead, rest } = splitGuide(m, 'wide');
      expect(lead.endsWith('.'), m).toBe(true);
      expect(modeGuide(m, 'wide').startsWith(lead.slice(0, -1)), m).toBe(true);
      expect(rest.endsWith(' '), m).toBe(false);
    }
    expect(splitGuide('configure', 'wide').lead)
      .toBe('Generated from the drawing — DGMGRL, init parameters, connect strings.');
    expect(splitGuide('learn', 'wide').rest).toBe('');
  });

  it('says where the + buttons and the settings actually are', () => {
    expect(modeGuide('build', 'wide')).toContain('the full properties are in the panel on the right');
    expect(modeGuide('configure', 'wide')).toContain('Generated from the drawing');
    expect(modeGuide('configure', 'wide')).toContain('Settings are in the panel on the right');
  });

  /* The inspector is a grid column only while the viewport is `wide`; below
     that it is a drawer opened from the status bar's Inspector button. A line
     that named the right edge at every width pointed two of the four classes
     at nothing. */
  it('names the inspector where it actually is, at every viewport', () => {
    expect(railWhere('wide')).toBe('the panel on the right');
    for (const v of VIEWPORTS) {
      const build = modeGuide('build', v);
      const configure = modeGuide('configure', v);
      expect(build, v).toContain(railWhere(v));
      expect(configure, v).toContain(`Settings are in ${railWhere(v)}.`);
      if (v === 'wide') continue;
      /* Below `wide` nothing may claim there is a panel on the right ... */
      expect(build, v).not.toContain('panel on the right');
      expect(configure, v).not.toContain('panel on the right');
      /* ... and the sentence has to say how to get at the drawer instead. */
      expect(railWhere(v), v).toContain('Inspector button');
    }
  });

  it('follows the window across a breakpoint', async () => {
    mode.value = 'configure';
    /* The clause that names the inspector is the second half of Configure's
       line, so this is a test about the half hints bring back. */
    hintsOn.value = true;
    const root = mount(Guidance);
    const line = (): string => root.querySelector('.guide-line')?.textContent ?? '';
    expect(line()).toContain('the panel on the right');
    viewport.value = 'compact';
    await tick();
    expect(line()).not.toContain('the panel on the right');
    expect(line()).toContain('Inspector button');
  });
});

describe('what writes dg-intro-v1', () => {
  /* The key used to mean "the first-visit strip has been dismissed". It now
     means "this reader has been shown the Introduction" (ui.md SS3e), and the
     strip itself is gone: the page replaced it. */
  it('no longer renders a strip anywhere', async () => {
    const guide = mount(Guidance);
    await paint();
    expect(guide.querySelector('.intro-strip')).toBeNull();
    const shell = mount(App);
    await tick();
    expect(shell.querySelector('.intro-strip')).toBeNull();
  });

  it('is written by the first edit, so a reader already working is not sent back', async () => {
    mount(Guidance);
    await paint();
    edit('rename', (d) => ({ ...d, meta: { ...d.meta, name: 'renamed' } }));
    await paint();
    expect(memory.get(INTRO_KEY)).toBe('1');
  });

  it('is written by the first change of mode', async () => {
    mount(Guidance);
    await paint();
    mode.value = 'break';
    await paint();
    expect(memory.get(INTRO_KEY)).toBe('1');
  });

  it('is not written by a render, or by reading the guidance', async () => {
    mount(Guidance);
    await paint();
    await paint();
    expect(memory.get(INTRO_KEY)).toBeUndefined();
  });

  it('survives a reload: `loadIntro` reads it back', async () => {
    mount(Guidance);
    await paint();
    dismissIntro();
    introDismissed.value = false;
    loadIntro();
    expect(introDismissed.value).toBe(true);
  });
});

describe('the keyboard map', () => {
  /* The shortcuts exist; nothing on the page announced them. Every key listed
     here is bound in `canvas/TopoCanvas.tsx`, `timeline/Playhead.tsx` or
     `common/Sheet.tsx` -- the card must never list one that is not. */
  it('is in the full explanation the ? opens', async () => {
    introOpen.value = true;
    const root = mount(Guidance);
    await tick();
    const keys = root.querySelector('.intro-keys');
    expect(keys).not.toBeNull();
    const text = keys?.textContent ?? '';
    for (const k of ['E', 'A', 'Delete', 'Esc', 'Space', 'Home', '↑ ↓ ← →']) {
      expect(text).toContain(k);
    }
    /* Two columns, and the key half is mono: it is something typed. */
    const first = keys?.querySelector('.keys-row dt');
    expect(first?.className).toContain('mono');
    expect(keys?.querySelectorAll('.keys-row dd').length)
      .toBe(keys?.querySelectorAll('.keys-row dt').length);
  });

  /* A key bound in one mode says which one, or the reader presses it in the
     mode the page opens in and nothing happens. `onEvents` is spread onto
     the canvas only in Topology and the Detailed timeline, exactly as
     `onDelete` is only in Topology. */
  it('says which mode a mode-gated key belongs to', async () => {
    introOpen.value = true;
    const root = mount(Guidance);
    await tick();
    const said = new Map<string, string>();
    for (const row of root.querySelectorAll('.keys-row')) {
      said.set(row.querySelector('dt')?.textContent ?? '', row.querySelector('dd')?.textContent ?? '');
    }
    expect(said.get('E')).toContain('(Topology)');
    expect(said.get('A')).toContain('(Topology)');
    expect(said.get('Delete')).toContain('(Topology)');
  });

  it('is behind the ?, not printed under the header', () => {
    const root = mount(Guidance);
    expect(root.querySelector('.intro-keys')).toBeNull();
  });
});
