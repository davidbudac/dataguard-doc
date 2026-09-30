/**
 * Walking the drawing with the keyboard (ui.md SS4, "Keyboard/aria").
 *
 * The contract, and the whole of it: every card is a button, one card per site
 * is the site's tab stop, the arrows walk the cards of one site, Enter selects,
 * `E` asks for the event menu, Delete removes in Build mode, Escape clears the
 * selection. Everything here goes through real key events on real focused
 * elements, because the bug this file exists to catch is a handler that is
 * never wired -- `E` and Delete were both reachable in `TopoCanvas` and passed
 * by nobody, so pressing them did nothing at all.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { TopoCanvas } from '@/ui/canvas/TopoCanvas';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { mode, modeGuide, selection, toast, viewport } from '@/state/view';
import { barFocus, barKind, barOpen, closeBar } from '@/ui/canvas/bar';
import { classic, graphOf, threeObserverFixture } from './canvas-fixtures';
import type { TopologyDoc } from '@/engine';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Handlers {
  onSelect?: (key: string, additive: boolean) => void;
  onEvents?: (key: string) => void;
  onActions?: (key: string) => void;
  onDelete?: (key: string) => void;
  onClear?: () => void;
}

const mountCanvas = (doc: TopologyDoc, handlers: Handlers = {}): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(TopoCanvas, { doc, graph: graphOf(doc), ...handlers }), root);
  return root;
};

const card = (root: HTMLElement, key: string): SVGGElement => {
  const el = root.querySelector(`[data-node="${key}"]`);
  if (!(el instanceof SVGGElement)) throw new Error(`no card ${key}`);
  return el;
};

/**
 * The focusable half of whatever answers to this key.
 *
 * A link is drawn twice -- the line, then the caption -- and both halves carry
 * the same `data-node`, so `querySelector` finds the line, which is not the
 * control. The control is the one with the role on it.
 */
const control = (root: HTMLElement, key: string): SVGGElement => {
  const el = [...root.querySelectorAll(`[data-node="${key}"]`)]
    .find((n) => n.getAttribute('role') === 'button');
  if (!(el instanceof SVGGElement)) throw new Error(`no control ${key}`);
  return el;
};

/** A real keydown on the focused card, the way the browser delivers it. */
function press(el: SVGGElement, key: string, init: KeyboardEventInit = {}): void {
  (el as unknown as HTMLElement).focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

const focusedKey = (): string | null =>
  document.activeElement?.getAttribute('data-node') ?? null;

beforeEach(() => {
  document.body.innerHTML = '';
  closeBar();
  selection.value = [];
  toast.value = null;
  mode.value = 'build';
  viewport.value = 'wide';
  resetHistory(classicDoc());
});

describe('the canvas is reachable by keyboard', () => {
  it('gives every card the button role and one tab stop per site', () => {
    const root = mountCanvas(threeObserverFixture());
    const cards = [...root.querySelectorAll('.tp-node')]
      .filter((el) => el.getAttribute('data-node') !== null);
    expect(cards.length).toBeGreaterThan(0);
    for (const el of cards) expect(el.getAttribute('role')).toBe('button');
    /* Four sites in that fixture, so four cards are in the tab order and the
       rest are reached with the arrows. */
    const stops = cards.filter((el) => el.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(4);
  });

  it('gives every data centre its own stop, and every caption one between them', () => {
    /* The drawing has three kinds of object and a reader who can only reach
       one of them is reading a third of it. The counts are the contract: a
       site rect is a stop of its own (there are four), and the whole set of
       captions shares one, so Tab does not walk a dozen labels before it
       reaches the other half of the drawing. */
    const root = mountCanvas(threeObserverFixture());
    const sites = [...root.querySelectorAll('.tp-sitewrap')];
    expect(sites).toHaveLength(4);
    for (const el of sites) {
      expect(el.getAttribute('role')).toBe('button');
      expect(el.getAttribute('tabindex')).toBe('0');
      expect(el.getAttribute('aria-label') ?? '').toContain('Data centre');
    }
    const pills = [...root.querySelectorAll('.tp-linkwrap[role="button"]')];
    expect(pills.length).toBeGreaterThan(1);
    expect(pills.filter((el) => el.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('spells the site and caption tabindex the way SVG spells it', () => {
    /* The same regression as the cards': a camel-cased `tabIndex` on an SVG
       <g> is a literal attribute SVG2 has never heard of, and the control
       looks focusable and takes no focus. */
    const root = mountCanvas(classic('dc3'));
    expect(root.querySelector('.tp-sitewrap[tabIndex]')).toBeNull();
    expect(root.querySelector('.tp-linkwrap[tabIndex]')).toBeNull();
    expect(control(root, 'dc1').getAttribute('tabindex')).toBe('0');
  });

  it('walks the captions with the arrows, one roving stop for the set', async () => {
    const root = mountCanvas(classic('dc3'));
    const pills = [...root.querySelectorAll('.tp-linkwrap[role="button"]')];
    const first = pills[0] as SVGGElement;
    const second = pills[1] as SVGGElement;
    press(first, 'ArrowRight');
    expect(focusedKey()).toBe(second.getAttribute('data-node'));
    await tick();
    expect(second.getAttribute('tabindex')).toBe('0');
    expect(first.getAttribute('tabindex')).toBe('-1');
    press(second, 'ArrowLeft');
    expect(focusedKey()).toBe(first.getAttribute('data-node'));
  });

  it('selects a data centre and a caption with Enter, the way it selects a card', () => {
    const onSelect = vi.fn();
    const root = mountCanvas(classic('dc3'), { onSelect });
    press(control(root, 'dc1'), 'Enter');
    expect(onSelect).toHaveBeenLastCalledWith('dc1', false);
    press(control(root, 'dc1-dc2'), ' ');
    expect(onSelect).toHaveBeenLastCalledWith('dc1-dc2', false);
  });

  it('walks the cards of one site with the arrows, and stops at its ends', () => {
    /* dc3 holds two observers in this fixture: one column, two cards. */
    const root = mountCanvas(threeObserverFixture());
    press(card(root, 'obs01'), 'ArrowDown');
    expect(focusedKey()).toBe('obs02');
    press(card(root, 'obs02'), 'ArrowDown');
    expect(focusedKey()).toBe('obs02');
    press(card(root, 'obs02'), 'ArrowUp');
    expect(focusedKey()).toBe('obs01');
  });

  it('does not walk out of the site the focus is in', () => {
    const root = mountCanvas(threeObserverFixture());
    press(card(root, 'prm01'), 'ArrowRight');
    expect(focusedKey()).toBe('prm01');
  });

  it('moves the site tab stop to the card the arrows reached', async () => {
    const root = mountCanvas(threeObserverFixture());
    press(card(root, 'obs01'), 'ArrowDown');
    await tick();
    expect(card(root, 'obs02').getAttribute('tabindex')).toBe('0');
    expect(card(root, 'obs01').getAttribute('tabindex')).toBe('-1');
  });

  it('selects with Enter and with the space bar, and adds with shift', () => {
    const onSelect = vi.fn();
    const root = mountCanvas(classic('dc3'), { onSelect });
    press(card(root, 'prm01'), 'Enter');
    expect(onSelect).toHaveBeenCalledWith('prm01', false);
    press(card(root, 'sby01'), ' ', { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith('sby01', true);
  });

  it('asks for the events on offer with E, in either case', () => {
    const onEvents = vi.fn();
    const root = mountCanvas(classic('dc3'), { onEvents });
    press(card(root, 'prm01'), 'e');
    press(card(root, 'sby01'), 'E');
    expect(onEvents.mock.calls.map((c) => c[0])).toEqual(['prm01', 'sby01']);
  });

  it('asks for Topology\'s action table with A, in either case, on a card, a data centre and a link', () => {
    const onActions = vi.fn();
    const root = mountCanvas(classic('dc3'), { onActions });
    press(card(root, 'prm01'), 'a');
    press(card(root, 'sby01'), 'A');
    press(control(root, 'dc1'), 'a');
    press(control(root, 'dc1-dc2'), 'a');
    expect(onActions.mock.calls.map((c) => c[0])).toEqual(['prm01', 'sby01', 'dc1', 'dc1-dc2']);
  });

  it('leaves Ctrl+A, Cmd+A and Alt+A to their own owners, and does nothing without a table to open', () => {
    const onActions = vi.fn();
    const root = mountCanvas(classic('dc3'), { onActions });
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true, ...init });
      (card(root, 'prm01') as unknown as HTMLElement).focus();
      card(root, 'prm01').dispatchEvent(ev);
      /* Select-all (shortcuts.ts) checks `defaultPrevented`: this must not have claimed it. */
      expect(ev.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(onActions).not.toHaveBeenCalled();
    /* The Detailed timeline's drawing passes no table: the key is not bound there. */
    const bare = mountCanvas(classic('dc3'), {});
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    card(bare, 'prm01').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('removes with Delete and with Backspace, and clears with Escape', () => {
    const onDelete = vi.fn();
    const onClear = vi.fn();
    const root = mountCanvas(classic('dc3'), { onDelete, onClear });
    press(card(root, 'sby01'), 'Delete');
    press(card(root, 'sby01'), 'Backspace');
    expect(onDelete.mock.calls.map((c) => c[0])).toEqual(['sby01', 'sby01']);
    press(card(root, 'sby01'), 'Escape');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('spells tabindex the way SVG spells it, not the way HTML tolerates', () => {
    /* Attribute names are folded to lower case only for HTML elements, so a
       camel-cased `tabIndex` on an SVG <g> is a literal attribute SVG2 has
       never heard of: the cards render, look focusable and take no focus.
       This assertion is the regression, and it is worth its own test. */
    const root = mountCanvas(classic('dc3'));
    expect(root.querySelector('[tabIndex]')).toBeNull();
    expect(root.querySelectorAll('[tabindex]').length).toBeGreaterThan(0);
  });

  it('takes the focus stops away when the drawing is not interactive', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(
      h(TopoCanvas, { doc: classic('dc3'), graph: graphOf(classic('dc3')), interactive: false }),
      root,
    );
    for (const el of root.querySelectorAll('[data-node][role="button"]')) {
      expect(el.getAttribute('tabindex')).toBe('-1');
    }
  });
});

describe('the shell wires those keys to real edits', () => {
  const mountApp = (): HTMLElement => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(App, {}), root);
    return root;
  };

  it('Delete removes the focused standby in Build mode', async () => {
    const root = mountApp();
    expect(docSignal.value.topology.members.map((m) => m.id as string)).toContain('sby01');
    press(card(root, 'sby01'), 'Delete');
    await tick();
    expect(docSignal.value.topology.members.map((m) => m.id as string)).not.toContain('sby01');
  });

  it('Delete refuses the primary out loud rather than silently', async () => {
    const root = mountApp();
    press(card(root, 'prm01'), 'Delete');
    await tick();
    expect(docSignal.value.topology.members.map((m) => m.id as string)).toContain('prm01');
    expect(toast.value?.text ?? '').toContain('This member holds the primary role');
  });

  it('Delete edits nothing in Break mode: that mode breaks, it does not build', async () => {
    mode.value = 'break';
    /* The drawing is on screen in the Detailed timeline only in the docked layout. */
    viewport.value = 'compact';
    const root = mountApp();
    await tick();
    press(card(root, 'sby01'), 'Delete');
    await tick();
    expect(docSignal.value.topology.members.map((m) => m.id as string)).toContain('sby01');
  });

  it('E opens the action bar for the card in Break mode, and not in Build', async () => {
    const built = mountApp();
    await tick();
    press(card(built, 'prm01'), 'E');
    await tick();
    expect(barOpen.value).toBeNull();
    render(null, built);
    built.remove();

    mode.value = 'break';
    /* The drawing is on screen in the Detailed timeline only in the docked layout. */
    viewport.value = 'compact';
    const root = mountApp();
    /* Effects run after the paint: let the change of mode (and the drawings
       earlier tests left mounted, which see it too) settle before the key, or
       one of them closes the bar the key has just opened. */
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    await tick();
    press(card(root, 'prm01'), 'E');
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    await tick();
    expect(selection.value).toEqual(['prm01']);
    expect(barOpen.value).toBe('prm01');
    /* A key is a keyboard-shaped request: the focus goes into the bar. */
    expect(barFocus.value).toBe(true);
  });

  it('A opens Topology\'s table with the focus in it -- edit, properties, remove -- and E the events', async () => {
    const root = mountApp();
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    await tick();
    press(card(root, 'sby01'), 'A');
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    await tick();
    expect(selection.value).toEqual(['sby01']);
    expect(barOpen.value).toBe('sby01');
    expect(barKind.value).toBe('actions');
    expect(barFocus.value).toBe(true);
    const rows = [...root.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent ?? '');
    expect(rows.some((r) => r.startsWith('Edit'))).toBe(true);
    expect(rows.some((r) => r.startsWith('Remove'))).toBe(true);
    expect(root.querySelector('.cv-bar-hd')?.textContent ?? '').not.toContain('at t =');
    /* Escape closes it, the same press that closes the events. */
    press(card(root, 'sby01'), 'Escape');
    await tick();
    expect(barOpen.value).toBeNull();
    /* And E on the same card is the other list. */
    press(card(root, 'sby01'), 'E');
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    await tick();
    expect(barKind.value).toBe('events');
    expect(root.querySelector('.cv-bar-hd')?.textContent ?? '').toContain('at t =');
  });

  it('A is bound in Topology only: not in the docked Detailed timeline', async () => {
    mode.value = 'break';
    viewport.value = 'compact';
    const root = mountApp();
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    await tick();
    press(card(root, 'sby01'), 'A');
    await tick();
    expect(barOpen.value).toBeNull();
    expect(root.querySelector('.cv-bar')).toBeNull();
  });

  it('is in the stage\'s description of Topology, next to the handle it stands in for', () => {
    expect(modeGuide('build', 'wide')).toContain('⋯ (or A on a focused card) opens actions');
    expect(modeGuide('break', 'wide')).not.toContain('A on a focused card');
  });

  /* Pressed on the focused rectangle, not called: a data centre takes focus
     now, so the refusal is reachable the way a reader reaches it -- the
     sentence the rail prints under its Remove button, said out loud rather
     than swallowed. */
  it('Delete refuses a data centre with a database in it, out loud', async () => {
    const root = mountApp();
    press(control(root, 'dc1'), 'Delete');
    await tick();
    expect(docSignal.value.topology.sites.map((s) => s.id as string)).toContain('dc1');
    expect(toast.value?.text).toBe('dc1 stays: A database, an observer or an application still stands in this site: move or remove it first.');
  });

  it('Delete takes a link out from its caption, because nothing refuses that', async () => {
    const root = mountApp();
    press(control(root, 'dc1-dc2'), 'Delete');
    await tick();
    expect(docSignal.value.topology.links.map((l) => l.id as string)).not.toContain('dc1-dc2');
    /* Not a refusal: the way back, offered where the reader is looking. */
    expect(toast.value?.kind).toBe('info');
    expect(toast.value?.action?.label).toBe('Undo');
    toast.value?.action?.run();
    expect(docSignal.value.topology.links.map((l) => l.id as string)).toContain('dc1-dc2');
  });

  it('Escape clears the selection', async () => {
    const root = mountApp();
    selection.value = ['sby01'];
    await tick();
    press(card(root, 'sby01'), 'Escape');
    await tick();
    expect(selection.value).toEqual([]);
  });
});
