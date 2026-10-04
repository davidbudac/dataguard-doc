/**
 * Topology's and Config's rail is not in the document until the reader selects
 * something or asks for it, and the name in its header is the field that
 * renames the subject.
 *
 * What is pinned here: the rail that is not there (and the drawing that takes
 * its column), the ways it arrives, the control that sends it away, the
 * gesture that must not move the drawing under the pointer, the header that
 * carries the name, and the call sites that send a reader to a property while
 * nothing is selected. Break's strip fold is test/ui/rail-collapse.test.ts.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { Inspector } from '@/ui/inspector/Inspector';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { revealRail, setRailCollapsed, toggleRail } from '@/state/persist';
import {
  clearSelection, focusField, hintsOn, inspectorOpen, mode, railCollapsed, RAIL_HOLD_MS, railHeld,
  releaseRail, selection, viewport,
} from '@/state/view';
import { onGlobalKey } from '@/ui/shortcuts';
import { openInspectorFor } from '@/ui/build/actions';
import { allSettings } from '@/ui/break/SettingChips';
import { renaming } from '@/ui/canvas/place';
import { isSectionOpen, resetSections } from '@/ui/inspector/sections';

const mounted: HTMLElement[] = [];
const mountApp = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  return root;
};
const mountInspector = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(Inspector as never, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const rail = (): Element | null => document.querySelector('.app-rail');
const app = (): Element | null => document.querySelector('.app');
/** The top bar's Inspector button. */
const barButton = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('.topbar button.inspector-tog');
/** The rail bar's close. */
const close = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('button[aria-label="Close the Inspector panel"]');

const type = async (input: HTMLInputElement, value: string): Promise<void> => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
};

const press = (key: string): void => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'target', { value: document.body });
  onGlobalKey(ev);
};

const clickCard = (key: string): void => {
  document.querySelector(`[data-node="${key}"]`)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

beforeEach(() => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
  releaseRail();
  resetHistory(classicDoc());
  resetSections();
  clearSelection();
  inspectorOpen.value = false;
  hintsOn.value = false;
  focusField.value = null;
  renaming.value = null;
  railCollapsed.value = false;
  viewport.value = 'wide';
  mode.value = 'build';
});

afterEach(() => {
  releaseRail();
  railCollapsed.value = false;
});

describe('the rail at wide, in Topology and Config', () => {
  it('is absent with nothing selected, and the drawing takes its column', async () => {
    for (const m of ['build', 'configure'] as const) {
      mode.value = m;
      mountApp();
      await tick();
      expect(rail(), m).toBeNull();
      expect(document.querySelector('.rail-strip'), m).toBeNull();
      expect(app()?.classList.contains('no-rail'), m).toBe(true);
      expect(document.querySelector('.app-stage'), m).not.toBeNull();
      expect(document.querySelector('.app-dock'), m).not.toBeNull();
      mounted.splice(0).forEach((r) => render(null, r));
      document.body.innerHTML = '';
    }
  });

  it('gives the room back in both layouts: the grid has one column, the float inset is the margin', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/rail.css'), 'utf8');
    expect(css).toMatch(/\.app\.no-rail\{grid-template-columns:minmax\(0,1fr\);grid-template-areas:"head" "stage" "dock"\}/);
    expect(css).toMatch(/\.app\.is-float\.no-rail\{--rail-space:var\(--float-m\)\}/);
  });

  it('arrives with a selection, and goes when the selection does', async () => {
    mountApp();
    await tick();
    expect(rail()).toBeNull();
    selection.value = ['sby01'];
    await tick();
    expect(rail()).not.toBeNull();
    expect(rail()?.id).toBe('app-rail');
    expect(rail()?.querySelector('.insp')).not.toBeNull();
    expect(app()?.classList.contains('no-rail')).toBe(false);
    /* A click on empty canvas, or Escape, clears it. */
    selection.value = [];
    await tick();
    expect(rail()).toBeNull();
    expect(app()?.classList.contains('no-rail')).toBe(true);
  });

  it('stays after the selection goes when the reader opened it, and then shows the configuration', async () => {
    inspectorOpen.value = true;
    mountApp();
    await tick();
    expect(rail()).not.toBeNull();
    expect(rail()?.querySelector('.insp-hd .insp-kind')?.textContent).toBe('Configuration');
    selection.value = ['sby01'];
    await tick();
    selection.value = [];
    await tick();
    expect(rail()).not.toBeNull();
  });

  it('is in Config too, with the same rules', async () => {
    mode.value = 'configure';
    mountApp();
    await tick();
    expect(rail()).toBeNull();
    selection.value = ['prm01'];
    await tick();
    expect(rail()).not.toBeNull();
  });

  it('leaves Break and Learn their own rails, selected or not, folded or not', async () => {
    for (const m of ['break', 'learn'] as const) {
      mode.value = m;
      mountApp();
      await tick();
      expect(rail(), `${m}, nothing selected`).not.toBeNull();
      expect(rail()?.querySelector('.insp-hd'), m).toBeNull();
      expect(app()?.classList.contains('no-rail'), m).toBe(false);
      mounted.splice(0).forEach((r) => render(null, r));
      document.body.innerHTML = '';
    }
  });

  it('ignores the strip state: it is for Break\'s rail alone', async () => {
    setRailCollapsed(true);
    selection.value = ['sby01'];
    const r = mountApp();
    await tick();
    expect(rail()).not.toBeNull();
    expect(rail()?.classList.contains('is-shut')).toBe(false);
    expect(app()?.classList.contains('rail-shut')).toBe(false);
    expect(r.querySelector('.rail-strip')).toBeNull();
    expect(rail()?.querySelector('.insp-hd')).not.toBeNull();
  });

  it('is still the Sheet below wide, opened by its own switch', async () => {
    viewport.value = 'medium';
    selection.value = ['sby01'];
    mountApp();
    await tick();
    expect(rail()).toBeNull();
    expect(document.querySelector('.sheet')).toBeNull();
    expect(app()?.classList.contains('no-rail')).toBe(false);
    inspectorOpen.value = true;
    await tick();
    expect(document.querySelector('.sheet .insp')).not.toBeNull();
  });
});

describe('the ways in with nothing selected', () => {
  it('revealRail opens the configuration; toggleRail and ] toggle it', async () => {
    mountApp();
    await tick();
    revealRail();
    await tick();
    expect(inspectorOpen.value).toBe(true);
    expect(rail()).not.toBeNull();
    toggleRail();
    await tick();
    expect(inspectorOpen.value).toBe(false);
    expect(rail()).toBeNull();
    press(']');
    await tick();
    expect(inspectorOpen.value).toBe(true);
    expect(rail()?.querySelector('input[aria-label="Configuration name"]')).not.toBeNull();
    press(']');
    await tick();
    expect(rail()).toBeNull();
  });

  it('toggling shut with a selection drops the selection, or nothing would happen', async () => {
    mountApp();
    selection.value = ['sby01'];
    await tick();
    expect(rail()).not.toBeNull();
    toggleRail();
    await tick();
    expect(selection.value).toEqual([]);
    expect(inspectorOpen.value).toBe(false);
    expect(rail()).toBeNull();
  });

  it('revealRail leaves the explicit flag alone when a selection has brought the rail', () => {
    selection.value = ['sby01'];
    revealRail();
    expect(inspectorOpen.value).toBe(false);
    openInspectorFor('prm01');
    expect(selection.value).toEqual(['prm01']);
    expect(inspectorOpen.value).toBe(false);
  });

  it('drives the drawer below wide, and Break\'s strip, as it did', () => {
    viewport.value = 'medium';
    toggleRail();
    expect(inspectorOpen.value).toBe(true);
    toggleRail();
    expect(inspectorOpen.value).toBe(false);
    viewport.value = 'wide';
    mode.value = 'break';
    toggleRail();
    expect(railCollapsed.value).toBe(true);
    revealRail();
    expect(railCollapsed.value).toBe(false);
    expect(inspectorOpen.value).toBe(false);
  });

  it('puts `All settings` on the configuration with the fast-start failover fold open', async () => {
    mode.value = 'break';
    mountApp();
    await tick();
    allSettings();
    await tick();
    expect(mode.value).toBe('build');
    expect(selection.value).toEqual([]);
    expect(rail()).not.toBeNull();
    expect(isSectionOpen('Fast-start failover')).toBe(true);
    expect(rail()?.querySelector('input[aria-label="FastStartFailoverThreshold"]')).not.toBeNull();
  });

  it('opens from the top bar button, which says which way it is pointing', async () => {
    mountApp();
    await tick();
    const btn = barButton();
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('Inspector');
    expect(btn?.getAttribute('aria-expanded')).toBe('false');
    expect(btn?.querySelector('svg.rail-ico')).not.toBeNull();
    btn?.click();
    await tick();
    expect(inspectorOpen.value).toBe(true);
    expect(barButton()?.getAttribute('aria-expanded')).toBe('true');
    expect(rail()?.querySelector('.insp-hd input[aria-label="Configuration name"]')).not.toBeNull();
    barButton()?.click();
    await tick();
    expect(rail()).toBeNull();
    expect(barButton()?.getAttribute('aria-expanded')).toBe('false');
    mode.value = 'configure';
    await tick();
    expect(barButton()).not.toBeNull();
  });

  it('reads as expanded while a selection has the rail up, and closes it', async () => {
    mountApp();
    selection.value = ['sby01'];
    await tick();
    expect(barButton()?.getAttribute('aria-expanded')).toBe('true');
    barButton()?.click();
    await tick();
    expect(rail()).toBeNull();
    expect(selection.value).toEqual([]);
  });

  it('is not in the bar in Break or Learn, below wide, or over the Introduction', async () => {
    for (const m of ['break', 'learn'] as const) {
      mode.value = m;
      mountApp();
      await tick();
      expect(barButton(), m).toBeNull();
      mounted.splice(0).forEach((r) => render(null, r));
      document.body.innerHTML = '';
    }
    mode.value = 'build';
    viewport.value = 'medium';
    mountApp();
    await tick();
    expect(barButton()).toBeNull();
    /* The drawer's own button is in the document row. */
    expect([...document.querySelectorAll<HTMLButtonElement>('.statusbar .btn')]
      .some((b) => b.textContent === 'Inspector')).toBe(true);
  });
});

describe('the close button', () => {
  it('is the rail bar\'s, labelled, with the ] hint, and clears the selection and the explicit open', async () => {
    mountApp();
    selection.value = ['sby01'];
    inspectorOpen.value = true;
    await tick();
    const btn = close();
    expect(btn).not.toBeNull();
    expect(btn?.closest('.rail-bar')).not.toBeNull();
    expect(btn?.title).toBe('Close the Inspector panel (])');
    expect(btn?.hasAttribute('aria-expanded')).toBe(false);
    btn?.click();
    await tick();
    expect(selection.value).toEqual([]);
    expect(inspectorOpen.value).toBe(false);
    expect(rail()).toBeNull();
  });

  it('closes the configuration that was opened with nothing selected', async () => {
    mountApp();
    inspectorOpen.value = true;
    await tick();
    close()?.click();
    await tick();
    expect(inspectorOpen.value).toBe(false);
    expect(rail()).toBeNull();
  });

  it('is the only way out inside the rail: the header has no second close', async () => {
    selection.value = ['sby01'];
    const root = mountInspector();
    await tick();
    const labels = [...root.querySelectorAll<HTMLButtonElement>('.insp-hd .btn')].map((b) => b.textContent);
    expect(labels).toEqual(['Hints', 'Remove']);
    expect(root.querySelector('.insp-hd')?.textContent).not.toContain('Clear');
  });

  it('is Collapse, with aria-expanded, on Break\'s Events rail', async () => {
    mode.value = 'break';
    mountApp();
    await tick();
    setRailCollapsed(false);
    await tick();
    const tog = document.querySelector<HTMLButtonElement>('.rail-bar .rail-tog');
    expect(tog?.getAttribute('aria-label')).toBe('Collapse the Events panel');
    expect(tog?.getAttribute('aria-expanded')).toBe('true');
    expect(close()).toBeNull();
  });
});

describe('the gesture the rail must not break', () => {
  it('selects on the click, never on the press, so a drag cannot bring the rail mid-gesture', async () => {
    mountApp();
    await tick();
    const card = document.querySelector('[data-node="sby01"]')!;
    card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    await tick();
    expect(selection.value).toEqual([]);
    expect(rail()).toBeNull();
    clickCard('sby01');
    await tick();
    expect(selection.value).toEqual(['sby01']);
  });

  it('holds the rail for a moment after the first selection, then brings it', async () => {
    mountApp();
    await tick();
    clickCard('sby01');
    await tick();
    /* The rail moves the drawing: it waits out the second click of a
       double-click. */
    expect(selection.value).toEqual(['sby01']);
    expect(railHeld.value).toBe(true);
    expect(rail()).toBeNull();
    await wait(RAIL_HOLD_MS + 60);
    expect(railHeld.value).toBe(false);
    expect(rail()).not.toBeNull();
  });

  it('keeps the drawing still through a double-click rename, and brings the rail when the name is done', async () => {
    mountApp();
    await tick();
    clickCard('sby01');
    document.querySelector('.topo-svg')!
      .querySelector('[data-node="sby01"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await tick();
    expect(renaming.value).toBe('sby01');
    expect(document.querySelector('input.cv-rename-in')).not.toBeNull();
    /* Long past the hold, and still no rail under the field being typed in. */
    await wait(RAIL_HOLD_MS + 60);
    expect(rail()).toBeNull();
    renaming.value = null;
    await tick();
    expect(rail()).not.toBeNull();
  });

  it('does not hold a rail the reader asked for, or one with a selection already', async () => {
    mountApp();
    inspectorOpen.value = true;
    await tick();
    clickCard('sby01');
    await tick();
    expect(railHeld.value).toBe(false);
    expect(rail()).not.toBeNull();
    releaseRail();
    selection.value = [];
    inspectorOpen.value = false;
    await tick();
    selection.value = ['prm01'];
    clickCard('sby01');
    await tick();
    expect(railHeld.value).toBe(false);
  });

  it('lets a gesture that asks for the rail by name have it at once', async () => {
    mountApp();
    await tick();
    clickCard('sby01');
    await tick();
    expect(rail()).toBeNull();
    openInspectorFor('sby01');
    await tick();
    expect(railHeld.value).toBe(false);
    expect(rail()).not.toBeNull();
  });
});

describe('the name in the header', () => {
  it('renames the configuration, and an empty name is not a rename', async () => {
    const root = mountInspector();
    await tick();
    expect(root.querySelector('.insp-hd .insp-kind')?.textContent).toBe('Configuration');
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Configuration name"]')!;
    expect(input.value).toBe(doc.value.topology.config.name);
    await type(input, '  Orders DR  ');
    expect(doc.value.topology.config.name).toBe('Orders DR');
    await type(root.querySelector<HTMLInputElement>('input[aria-label="Configuration name"]')!, '   ');
    expect(doc.value.topology.config.name).toBe('Orders DR');
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Configuration name"]')?.value).toBe('Orders DR');
  });

  it('renames a member -- its db_unique_name, which the kind line says -- and follows it', async () => {
    selection.value = ['sby01'];
    const root = mountInspector();
    await tick();
    expect(root.querySelector('.insp-hd .insp-kind')?.textContent).toContain('db_unique_name');
    const input = root.querySelector<HTMLInputElement>('input[aria-label="db_unique_name"]')!;
    expect(input.value).toBe('sby01');
    expect(root.querySelectorAll('input[aria-label="db_unique_name"]')).toHaveLength(1);
    await type(input, 'sbyx');
    const ids = doc.value.topology.members.map((m) => m.id as string);
    expect(ids).toContain('sbyx');
    expect(ids).not.toContain('sby01');
    expect(selection.value).toEqual(['sbyx']);
    expect(root.querySelector<HTMLInputElement>('input[aria-label="db_unique_name"]')?.value).toBe('sbyx');
  });

  it('refuses a taken member name: the document is untouched and the field snaps back', async () => {
    selection.value = ['sby01'];
    const root = mountInspector();
    await tick();
    const before = doc.value;
    await type(root.querySelector<HTMLInputElement>('input[aria-label="db_unique_name"]')!, 'prm01');
    expect(doc.value).toBe(before);
    expect(root.querySelector<HTMLInputElement>('input[aria-label="db_unique_name"]')?.value).toBe('sby01');
  });

  it('renames an observer, and refuses a taken name the same way', async () => {
    selection.value = ['obs01'];
    const root = mountInspector();
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Observer name"]')!;
    expect(input.value).toBe('obs01');
    const observers = doc.value.topology.observers;
    const before = doc.value;
    /* Taken: a second observer is needed to collide with. */
    if (observers.length > 1) {
      await type(input, observers.find((o) => (o.id as string) !== 'obs01')!.id as string);
      expect(doc.value).toBe(before);
      expect(root.querySelector<HTMLInputElement>('input[aria-label="Observer name"]')?.value).toBe('obs01');
    }
    await type(root.querySelector<HTMLInputElement>('input[aria-label="Observer name"]')!, 'watch01');
    expect(doc.value.topology.observers.map((o) => o.id as string)).toContain('watch01');
    expect(selection.value).toEqual(['watch01']);
  });

  it('renames a data centre, which is a label and keeps its id', async () => {
    selection.value = ['dc2'];
    const root = mountInspector();
    await tick();
    expect(root.querySelector('.insp-hd .insp-kind')?.textContent).toBe('Data centre');
    await type(root.querySelector<HTMLInputElement>('input[aria-label="Data centre name"]')!, 'Brno');
    expect(doc.value.topology.sites.find((s) => (s.id as string) === 'dc2')?.name).toBe('Brno');
    expect(selection.value).toEqual(['dc2']);
  });

  it('renames an application, which has a name of its own', async () => {
    const app0 = doc.value.topology.applications?.[0];
    expect(app0).toBeDefined();
    const id = app0!.id as string;
    selection.value = [id];
    const root = mountInspector();
    await tick();
    expect(root.querySelector('.insp-hd .insp-kind')?.textContent).toBe('Application');
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Application name"]')!;
    expect(input.value).toBe(id);
    await type(input, 'orders-app');
    expect(doc.value.topology.applications?.map((a) => a.id as string)).toContain('orders-app');
    expect(root.querySelectorAll('.insp-name')).toHaveLength(1);
  });

  it('gives a link its ends as plain text, with nothing to rename', async () => {
    selection.value = ['dc1-dc2'];
    const root = mountInspector();
    await tick();
    expect(root.querySelector('.insp-hd .insp-kind')?.textContent).toBe('Site link');
    expect(root.querySelector('.insp-hd .insp-title')).not.toBeNull();
    expect(root.querySelector('.insp-hd input')).toBeNull();
  });

  it('is the only name field: the rows it replaced are gone from every form', async () => {
    const appId = doc.value.topology.applications![0]!.id as string;
    for (const key of ['sby01', 'obs01', 'dc2', appId]) {
      selection.value = [key];
      const root = mountInspector();
      await tick();
      expect(root.querySelectorAll('.insp-name'), key).toHaveLength(1);
      const rows = [...root.querySelectorAll('.field-name')].map((e) => e.textContent);
      expect(rows, key).not.toContain('Name');
      expect(rows, key).not.toContain('db_unique_name');
      mounted.splice(0).forEach((r) => render(null, r));
      document.body.innerHTML = '';
    }
    clearSelection();
    const root = mountInspector();
    await tick();
    expect(root.querySelectorAll('.insp-name')).toHaveLength(1);
    expect([...root.querySelectorAll('.field-name')].map((e) => e.textContent)).not.toContain('Name');
  });

  it('takes the caret with the text selected when the drawing asks, once', async () => {
    focusField.value = 'name:sby01';
    selection.value = ['sby01'];
    const root = mountInspector();
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="db_unique_name"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('sby01'.length);
    expect(focusField.value).toBeNull();
  });

  it('says what a rename does only with the hints on', async () => {
    selection.value = ['sby01'];
    const root = mountInspector();
    await tick();
    expect(root.querySelector('.insp-note')).toBeNull();
    hintsOn.value = true;
    await tick();
    expect(root.querySelector('.insp-note')?.textContent).toContain('rewrites every reference');
  });

  it('is a real labelled input that gives the typed name up on Escape', async () => {
    selection.value = ['sby01'];
    const root = mountInspector();
    await tick();
    const input = root.querySelector<HTMLInputElement>('input[aria-label="db_unique_name"]')!;
    expect(input.type).toBe('text');
    input.value = 'half-typed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.value).toBe('sby01');
    expect(doc.value.topology.members.map((m) => m.id as string)).toContain('sby01');
  });
});

describe('one line at the rail\'s width', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/inspector.css'), 'utf8');

  it('never wraps a closed fold: its title stays whole and its hint is cut with an ellipsis', () => {
    const hint = /\.grp-sum\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(hint).toContain('white-space:nowrap');
    expect(hint).toContain('min-width:0');
    expect(hint).toContain('text-overflow:ellipsis');
    expect(/\.insp \.grp-tog \.eyebrow\{([^}]*)\}/.exec(css)?.[1] ?? '').toContain('white-space:nowrap');
  });

  it('carries a closed fold\'s whole hint in its title', async () => {
    const root = mountInspector();
    await tick();
    const sums = [...root.querySelectorAll<HTMLElement>('button.grp-tog .grp-sum')];
    expect(sums.length).toBeGreaterThan(0);
    for (const s of sums) expect(s.title).toBe(s.textContent);
  });

  it('has no divider under a closed fold', () => {
    expect(css).toMatch(/\.grp-fold:not\(\.is-open\)\{border-bottom:0\}/);
  });
});
