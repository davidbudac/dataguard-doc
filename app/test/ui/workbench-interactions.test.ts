/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { printing } from '@/ui/print';
import { App } from '@/ui/App';
import { classicDoc, doc } from '@/state/doc';
import { canUndo, resetHistory, undoStack } from '@/state/history';
import { topology } from '@/state/derived';
import {
  commandOpen, inspectorOpen, introPage, mode, selection,
  timelineH, toast, viewport,
} from '@/state/view';
import { canvasPan, handTool } from '@/ui/canvas/pan';
import { fitZoom } from '@/ui/canvas/zoom';
import { commands, filterCommands, runCommand } from '@/ui/commands';
import { onGlobalKey } from '@/ui/shortcuts';
import { openInspectorFor } from '@/ui/build/actions';
import { applyTemplate, templates } from '@/ui/break/events';

let root: HTMLElement;
const tick = (): Promise<void> => new Promise(r => setTimeout(r, 65));
const mount = async (): Promise<void> => {
  root = document.createElement('div'); document.body.append(root);
  render(h(App, {}), root); await tick();
};
const key = (at: EventTarget, value: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init });
  at.dispatchEvent(event); return event;
};
const globalKey = (value: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: value, cancelable: true, ...init });
  onGlobalKey(event); return event;
};
const pointer = (el: Element, kind: 'Down' | 'Move' | 'Up' | 'Cancel', x: number, y: number, init: MouseEventInit = {}): void => {
  const lower = `pointer${kind.toLowerCase()}`;
  el.dispatchEvent(new MouseEvent(`on${lower}` in el ? lower : `Pointer${kind}`, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init,
  }));
};
beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  mode.value = 'build'; viewport.value = 'wide'; selection.value = [];
  inspectorOpen.value = false; commandOpen.value = false;
  introPage.value = false; timelineH.value = null; toast.value = null;
  handTool.value = false; printing.value = false; fitZoom();
});
afterEach(() => { if (root) render(null, root); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('visible folded inspector', () => {
  it('keeps a named, operable header while removing the forms, and expands again', async () => {
    await mount();
    root.querySelector<HTMLButtonElement>('.rail-strip')!.click(); await tick();
    root.querySelector<HTMLButtonElement>('.rail-tog')!.click(); await tick();
    const toggle = root.querySelector<HTMLButtonElement>('.rail-strip')!;
    expect(toggle.textContent).toContain('Inspector');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('#rail-content')).toBeNull();
    expect(root.querySelector('.app-rail')).not.toBeNull();
    toggle.click(); await tick();
    expect(root.querySelector('#rail-content .insp')).not.toBeNull();
  });
  it('keeps a launcher beside a closed drawer and gives focus back when closing', async () => {
    viewport.value = 'medium'; await mount();
    const launcher = [...root.querySelectorAll<HTMLButtonElement>('.statusbar button')].find(b=>b.textContent==='Inspector')!;
    expect(launcher.textContent).toBe('Inspector');
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    launcher.focus(); launcher.click(); await tick();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    key(document.activeElement!, 'Escape'); await tick();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });
  it('Edit expands a folded wide inspector on the requested object', async () => {
    await mount();
    openInspectorFor('sby01'); await tick();
    expect(root.querySelector('.rail-strip')).toBeNull();
    expect(selection.value).toEqual(['sby01']);
    expect(root.querySelector('#rail-content')?.textContent).toContain('sby01');
  });
});

describe('printing folded panels', () => {
  it('expands the rail for print and returns to the folded preference afterward', async () => {
    await mount();
    expect(root.querySelector('#rail-content')).toBeNull();
    printing.value = true; await tick();
    expect(root.querySelector('#rail-content')).not.toBeNull();
    expect(inspectorOpen.value).toBe(false);
    printing.value = false; await tick();
    expect(root.querySelector('#rail-content')).toBeNull();
  });
});

describe('panning the fitted canvas', () => {
  it('moves in either direction without scrolling, clearing selection or editing the document', async () => {
    await mount(); selection.value = ['prm01']; await tick();
    const before = JSON.stringify(doc.value);
    const wrap = root.querySelector('.tp-wrap')!;
    const svg = root.querySelector('.topo-svg')!;
    const box = svg.getAttribute('viewBox');
    pointer(wrap, 'Down', 200, 200);
    pointer(svg, 'Move', 202, 201);
    expect(canvasPan.value).toEqual({ x: 0, y: 0 });
    pointer(svg, 'Move', 240, 170); await tick();
    pointer(svg, 'Up', 240, 170); await tick();
    expect(canvasPan.value).toEqual({ x: 40, y: -30 });
    expect(svg.getAttribute('viewBox')).not.toBe(box);
    expect(selection.value).toEqual(['prm01']);
    expect(JSON.stringify(doc.value)).toBe(before);
    expect(canUndo.value).toBe(false);
    fitZoom(); await tick();
    expect(svg.getAttribute('viewBox')).toBe(box);
  });
  it('the Hand tool pans a card instead of moving the member', async () => {
    handTool.value = true; await mount();
    const card = root.querySelector('.tp-node[data-node="prm01"]')!;
    const svg = root.querySelector('.topo-svg')!;
    pointer(card, 'Down', 100, 100); pointer(svg, 'Move', 180, 120); await tick();
    pointer(svg, 'Up', 180, 120); await tick();
    expect(canvasPan.value).toEqual({ x: 80, y: 20 });
    expect(doc.value.layout).toEqual({});
  });
  it('holding Space pans over a card, releasing it restores card dragging', async () => {
    await mount();
    const card = root.querySelector('.tp-node[data-node="prm01"]')!;
    const svg = root.querySelector('.topo-svg')!;
    key(document.body, ' ');
    pointer(card, 'Down', 100, 100); pointer(svg, 'Move', 140, 120); await tick();
    pointer(svg, 'Up', 140, 120); await tick();
    expect(canvasPan.value).toEqual({ x: 40, y: 20 });
    expect(doc.value.layout).toEqual({});
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    fitZoom(); await tick();
    pointer(card, 'Down', 100, 100); pointer(svg, 'Move', 116, 108); await tick();
    pointer(svg, 'Up', 116, 108); await tick();
    expect(doc.value.layout.prm01).toEqual({ dx: 16, dy: 8 });
  });
});

describe('commands and hotkeys', () => {
  it('opens with Cmd+K from a text field, searches and executes with Enter', async () => {
    await mount();
    const opener = root.querySelector<HTMLButtonElement>('[aria-label="Command palette"]')!;
    opener.focus(); key(opener, 'k', { metaKey: true }); await tick();
    const input = root.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!;
    expect(document.activeElement).toBe(input);
    input.value = 'open configure'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(root.querySelector('[role="option"]')?.textContent).toContain('Open Generated settings');
    key(input, 'Enter'); await tick();
    expect(commandOpen.value).toBe(false);
    expect(mode.value).toBe('configure');
    expect(document.activeElement).toBe(opener);
  });
  it('offers filtered results, arrow navigation, disabled reasons and an empty state', async () => {
    await mount(); commandOpen.value = true; await tick();
    const input = root.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!;
    key(input, 'ArrowDown'); await tick();
    expect(input.getAttribute('aria-activedescendant')).toBe('command-1');
    input.value = 'undo'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(root.querySelector('[role="option"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('[role="option"]')?.textContent).toContain('Nothing to undo');
    key(input, 'Enter'); await tick(); expect(commandOpen.value).toBe(true);
    input.value = 'no-such-action'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    expect(root.querySelector('.command-empty')?.textContent).toContain('No matching');
    key(input, 'Escape'); await tick(); expect(commandOpen.value).toBe(false);
  });
  it('does not hijack input editing, IME composition or keys in another modal', async () => {
    await mount();
    const input = root.querySelector<HTMLInputElement>('input')!;
    key(input, '2'); expect(mode.value).toBe('build');
    key(input, 'z', { ctrlKey: true }); expect(undoStack.value).toHaveLength(0);
    const event = globalKey('2', { isComposing: true }); expect(event.defaultPrevented).toBe(false);
    commandOpen.value = true; await tick();
    const search = root.querySelector<HTMLInputElement>('[aria-label="Search commands"]')!;
    key(search, '3'); expect(mode.value).toBe('build');
    key(search, 'k', { ctrlKey: true }); await tick(); expect(commandOpen.value).toBe(false);
  });
  it('covers mode navigation, panels, presets, additions and guarded removal', () => {
    expect(filterCommands(commands(), 'configuration json').some(c => c.id === 'export')).toBe(true);
    expect(new Set(commands().map(c => c.id)).size).toBe(commands().length);
    globalKey('4'); expect(mode.value).toBe('configure');
    runCommand('panel:commit'); expect(mode.value).toBe('configure');
    globalKey('1'); globalKey('B', { shiftKey: true });
    expect(topology.value.members).toHaveLength(3);
    const n = topology.value.members.length;
    globalKey('z', { ctrlKey: true }); expect(topology.value.members).toHaveLength(n - 1);
    globalKey('z', { metaKey: true, shiftKey: true }); expect(topology.value.members).toHaveLength(n);
    selection.value = ['prm01']; globalKey('Delete');
    expect(topology.value.members.some(m => m.id as string === 'prm01')).toBe(true);
    expect(toast.value?.text).toContain('stays');
    runCommand('preset:far-sync-zero-loss');
    expect(topology.value.members.some(m => m.kind === 'farsync')).toBe(true);
  });
  it('keeps read-only document actions disabled while allowing navigation and the palette', () => {
    viewport.value = 'narrow'; globalKey('B', { shiftKey: true });
    expect(topology.value.members).toHaveLength(2);
    globalKey('2'); expect(mode.value).toBe('scenario');
    globalKey('k', { ctrlKey: true }); expect(commandOpen.value).toBe(true);
  });

});
