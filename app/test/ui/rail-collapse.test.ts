/**
 * The side rail folds to a strip and back: the toggle says what it does to
 * assistive technology, the folded rail renders none of its contents, the
 * choice survives a reload, and the gestures that mean "show me this in the
 * inspector" unfold it.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { onGlobalKey } from '@/ui/shortcuts';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import {
  loadRailCollapsed, RAIL_KEY, revealRail, setRailCollapsed, toggleRail,
} from '@/state/persist';
import { breakLayout, inspectorOpen, mode, railCollapsed, selection, viewport } from '@/state/view';

/* jsdom hands back a bare object with no methods here (hints.test.ts). */
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

const mounted: HTMLElement[] = [];
const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  mounted.push(root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const press = (key: string, init: KeyboardEventInit = {}): void => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(ev, 'target', { value: document.body });
  onGlobalKey(ev);
};

beforeEach(() => {
  document.body.innerHTML = '';
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  selection.value = [];
  inspectorOpen.value = false;
  railCollapsed.value = false;
  breakLayout.value = 'split';
});

afterEach(() => {
  while (mounted.length > 0) render(null, mounted.pop() as HTMLElement);
  railCollapsed.value = false;
});

describe('the side rail folds', () => {
  it('has a labelled toggle that controls the rail and says it is open', () => {
    const root = mount();
    const rail = root.querySelector('.app-rail');
    expect(rail?.id).toBe('app-rail');
    const tog = root.querySelector<HTMLButtonElement>('.rail-tog');
    expect(tog).not.toBeNull();
    expect(tog?.getAttribute('aria-expanded')).toBe('true');
    expect(tog?.getAttribute('aria-controls')).toBe('app-rail');
    expect(tog?.getAttribute('aria-label')).toContain('Collapse');
    expect(root.querySelector('.rail-bar .rail-name')?.textContent).toBe('Inspector');
  });

  it('folded, renders the strip and none of the rail\'s contents', async () => {
    const root = mount();
    root.querySelector<HTMLButtonElement>('.rail-tog')?.click();
    await tick();
    expect(railCollapsed.value).toBe(true);
    expect(root.querySelector('.app')?.className).toContain('rail-shut');
    const rail = root.querySelector('.app-rail');
    expect(rail?.className).toContain('is-shut');
    expect(rail?.querySelector('.insp')).toBeNull();
    const strip = rail?.querySelector<HTMLButtonElement>('.rail-strip');
    expect(strip?.getAttribute('aria-expanded')).toBe('false');
    expect(strip?.getAttribute('aria-controls')).toBe('app-rail');
    strip?.click();
    await tick();
    expect(railCollapsed.value).toBe(false);
    expect(root.querySelector('.app-rail .insp')).not.toBeNull();
  });

  it('names what is behind the strip', async () => {
    selection.value = ['sby01'];
    setRailCollapsed(true);
    const root = mount();
    await tick();
    expect(root.querySelector('.rail-strip')?.getAttribute('aria-label')).toBe('Expand the Inspector panel (sby01)');
  });

  it('is remembered, and a reload reads it back', () => {
    setRailCollapsed(true);
    expect(window.localStorage.getItem(RAIL_KEY)).toBe('1');
    railCollapsed.value = false;
    loadRailCollapsed();
    expect(railCollapsed.value).toBe(true);
    setRailCollapsed(false);
    loadRailCollapsed();
    expect(railCollapsed.value).toBe(false);
  });

  it('puts Break\'s event menu on the stage while the rail is folded', async () => {
    mode.value = 'break';
    /* Lanes leaves the rail as it was; Split folds it on the way in (split-layout.test.ts). */
    breakLayout.value = 'lanes';
    const root = mount();
    await tick();
    expect(root.querySelector('.app-rail .evmenu')).not.toBeNull();
    setRailCollapsed(true);
    await tick();
    expect(root.querySelector('.app-rail .evmenu')).toBeNull();
    expect(root.querySelector('.app-stage > .evmenu')).not.toBeNull();
  });

  it('does not fold Learn\'s workbench', async () => {
    mode.value = 'learn';
    setRailCollapsed(true);
    const root = mount();
    await tick();
    expect(root.querySelector('.rail-strip')).toBeNull();
    expect(root.querySelector('.rail-tog')).toBeNull();
    expect(root.querySelector('.app')?.className).not.toContain('rail-shut');
  });

  it('unfolds for a gesture that asks for the inspector', () => {
    setRailCollapsed(true);
    revealRail();
    expect(railCollapsed.value).toBe(false);
    /* Below 1280 the rail is a drawer: the same gesture opens it instead. */
    viewport.value = 'medium';
    revealRail();
    expect(inspectorOpen.value).toBe(true);
  });

  it('toggles on ], and opens the drawer on ] where the rail is one', () => {
    press(']');
    expect(railCollapsed.value).toBe(true);
    press(']');
    expect(railCollapsed.value).toBe(false);
    /* A modified bracket is someone else's shortcut. */
    press(']', { metaKey: true });
    expect(railCollapsed.value).toBe(false);
    viewport.value = 'medium';
    toggleRail();
    expect(inspectorOpen.value).toBe(true);
  });

  it('carries no inline style in either state', async () => {
    const root = mount();
    for (const el of root.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
    setRailCollapsed(true);
    await tick();
    for (const el of root.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
  });
});
