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
import { inspectorOpen, mode, railCollapsed, selection, viewport } from '@/state/view';
import { topology } from '@/state/derived';
import { applyTemplate, templates } from '@/ui/break/events';

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

  it('draws no event menu in the Detailed timeline, in the rail column or on the stage, folded or open', async () => {
    mode.value = 'break';
    selection.value = ['sby01'];
    const root = mount();
    await tick();
    expect(root.querySelector('.app-rail')?.className).toContain('is-shut');
    expect(root.querySelector('.evmenu')).toBeNull();
    setRailCollapsed(false);
    await tick();
    expect(root.querySelector('.app-rail .rail-body')).not.toBeNull();
    expect(root.querySelector('.evmenu')).toBeNull();
    expect(root.querySelector('.app')?.className).not.toContain('has-evm');
  });

  it('draws no event menu over Lanes at 1440 either, with a selection and the rail open', async () => {
    mode.value = 'break';
    selection.value = ['sby01'];
    const root = mount();
    await tick();
    setRailCollapsed(false);
    await tick();
    expect(root.querySelector('.ln-cardwrap')).not.toBeNull();
    expect(root.querySelector('.app-rail .rail-body')).not.toBeNull();
    expect(root.querySelector('.evmenu')).toBeNull();
    expect(root.textContent).not.toContain('Inject at');
  });

  it('floats nothing over Lanes at a width with no rail column, and its drawer holds the event list alone', async () => {
    mode.value = 'break';
    viewport.value = 'medium';
    const root = mount();
    await tick();
    expect(root.querySelector('.ln-cardwrap')).not.toBeNull();
    expect(root.querySelector('.evmenu')).toBeNull();
    selection.value = ['sby01'];
    await tick();
    expect(root.querySelector('.evmenu')).toBeNull();
    /* The top bar's Events button is the way to the list: a drawer the reader can close. */
    inspectorOpen.value = true;
    await tick();
    expect(document.querySelector('.evmenu')).toBeNull();
    expect(document.querySelector('.sheet')?.textContent).toContain('Events');
    inspectorOpen.value = false;
    await tick();
    expect(document.querySelector('.sheet')).toBeNull();
  });

  it('carries the event list in its drawer at 1024, and closes by button, Esc and outside press', async () => {
    mode.value = 'break';
    viewport.value = 'medium';
    const crash = templates(topology.value, 0).find((x) => x.id === 'crash');
    applyTemplate(crash!);
    const root = mount();
    await tick();
    const events = (): HTMLButtonElement =>
      [...document.querySelectorAll<HTMLButtonElement>('.topbar button')].find((b) => b.textContent?.trim() === 'Events')!;
    const settle = async (): Promise<void> => {
      await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
      await tick();
      await tick();
    };
    /* Closed, the Lanes bar is the reader's whole top edge: no sheet, no scrim. */
    expect(document.querySelector('.sheet')).toBeNull();
    expect(root.querySelector('.ln-bar')).not.toBeNull();
    expect(events().getAttribute('aria-expanded')).not.toBe('true');

    events().click();
    await settle();
    const sheet = document.querySelector('.sheet') as HTMLElement;
    expect(sheet.getAttribute('role')).toBe('dialog');
    /* No menu of events to add here: the drawer opens on the list, and Remove there removes. */
    expect(sheet.querySelector('.evmenu')).toBeNull();
    expect(sheet.textContent).not.toContain('Inject at');
    expect(sheet.textContent).toContain('Events (1)');
    const remove = [...sheet.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remove')!;
    remove.click();
    await tick();
    expect(topology.value.events).toHaveLength(0);
    expect(sheet.textContent).toContain('No events yet');

    /* Three ways out, each leaving the bar reachable. */
    const close = [...sheet.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close')!;
    close.click();
    await settle();
    expect(document.querySelector('.sheet')).toBeNull();
    events().click();
    await settle();
    expect(document.querySelector('.sheet')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('.sheet')).toBeNull();
    events().click();
    await settle();
    (document.querySelector('.scrim') as HTMLElement).click();
    await settle();
    expect(document.querySelector('.sheet')).toBeNull();
    expect(root.querySelector('.ln-bar')).not.toBeNull();
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
