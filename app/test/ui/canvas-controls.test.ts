/**
 * How the drawing is driven, as opposed to what it draws: a click that only
 * selects, additions dragged to the data centre they belong in, names edited
 * where they are drawn, a rectangle that selects, a selection that moves and
 * goes as one, and the keys every editor has taught.
 *
 * Through the mounted app, with raw pointer and key events -- the hit tests
 * are pure geometry, which is what lets jsdom run them (canvas-gestures.test).
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import type { TopologyDoc } from '@/engine';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal } from '@/state/doc';
import { redoStack, resetHistory, undoLabel, undoStack } from '@/state/history';
import { menuOpen } from '@/ui/canvas/EventMenu';
import { closeBar } from '@/ui/canvas/bar';
import { placeOver, placing, renaming } from '@/ui/canvas/place';
import { fitZoom } from '@/ui/canvas/zoom';
import { WHY_TIDY } from '@/ui/canvas/CanvasSlot';
import { mode, selection, toast, viewport } from '@/state/view';
import { WHY_DROP_ON_SITE } from '@/ui/inspector/adds';
import { removeLink } from '@/ui/inspector/edits';
import { WHY } from '@/ui/inspector/why';
import { linkId } from '@/engine';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const painted = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
const topo = (): TopologyDoc => docSignal.value.topology;
const memberIds = (): string[] => topo().members.map((m) => m.id as string);
const siteOf = (id: string): string | undefined => {
  const host = topo().members.find((m) => (m.id as string) === id)?.instances[0]?.host;
  return topo().hosts.find((x) => x.id === host)?.site as string | undefined;
};

const mounted: HTMLElement[] = [];
const unmountAll = (): void => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
};

beforeEach(() => {
  unmountAll();
  selection.value = [];
  toast.value = null;
  menuOpen.value = false;
  mode.value = 'build';
  viewport.value = 'wide';
  renaming.value = null;
  placing.value = null;
  placeOver.value = null;
  closeBar();
  fitZoom();
  resetHistory(classicDoc());
});

const mountApp = async (): Promise<HTMLElement> => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  await tick();
  return root;
};

const pointer = (
  el: Element, kind: 'Down' | 'Move' | 'Up', x: number, y: number, init: MouseEventInit = {},
): void => {
  const lower = `pointer${kind.toLowerCase()}`;
  const type = `on${lower}` in el ? lower : `Pointer${kind}`;
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init,
  }));
};
const key = (el: EventTarget, k: string, init: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
};
const clientOf = (root: HTMLElement, x: number, y: number): [number, number] => {
  const vb = root.querySelector('.topo-svg')!.getAttribute('viewBox')!.split(/\s+/).map(Number);
  return [x - vb[0]!, y - vb[1]!];
};
const rectOf = (root: HTMLElement, k: string, sel: string): { x: number; y: number; w: number; h: number } => {
  const el = root.querySelector(`[data-node="${k}"] ${sel}`)!;
  return {
    x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
    w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')),
  };
};
const cardEl = (root: HTMLElement, k: string): SVGGElement =>
  root.querySelector(`.tp-node[data-node="${k}"]`)!;
const chip = (root: HTMLElement, label: string): HTMLButtonElement =>
  [...root.querySelectorAll<HTMLButtonElement>('.cv-add button')].find((b) => b.textContent === label)!;
const field = (root: HTMLElement): HTMLInputElement | null => root.querySelector('.cv-rename-in');
const type = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('adding: a press places it for you, a drag puts it where you drop it', () => {
  it('drags "+ Standby" onto a data centre, lights it on the way, and lands it there with its name open', async () => {
    const root = await mountApp();
    const panel = rectOf(root, 'dc3', 'rect.tp-site');
    const at = clientOf(root, panel.x + panel.w / 2, panel.y + panel.h - 6);
    const btn = chip(root, '+ Standby');
    pointer(btn, 'Down', 5, 5);
    pointer(btn, 'Move', ...at);
    await tick();
    expect(placing.value).toBe('database');
    expect(root.querySelector('.cv-ghost')?.textContent).toBe('+ Standby');
    expect(root.querySelector('.tp-site.is-drop')?.parentElement?.getAttribute('data-node')).toBe('dc3');
    pointer(btn, 'Up', ...at);
    await painted();
    expect(placing.value).toBeNull();
    expect(root.querySelector('.tp-site.is-drop')).toBeNull();
    const added = memberIds().find((m) => m !== 'prm01' && m !== 'sby01')!;
    expect(siteOf(added)).toBe('dc3');
    expect(selection.value).toEqual([added]);
    expect(field(root)?.value).toBe(added);
    expect(document.activeElement).toBe(field(root));
  });

  it('says where to drop it when it is let go on nothing, and adds nothing', async () => {
    const root = await mountApp();
    const n = undoStack.value.length;
    const btn = chip(root, '+ Observer');
    pointer(btn, 'Down', 5, 5);
    pointer(btn, 'Move', -500, -500);
    pointer(btn, 'Up', -500, -500);
    await tick();
    expect(undoStack.value.length).toBe(n);
    expect(toast.value?.text).toBe(WHY_DROP_ON_SITE);
  });

  it('a plain press still places it automatically, and opens the name too', async () => {
    const root = await mountApp();
    chip(root, '+ Standby').click();
    await painted();
    expect(memberIds()).toHaveLength(3);
    expect(field(root)).not.toBeNull();
  });

  it('a line from one data centre\'s name to another\'s is the site link between them', async () => {
    removeLink(linkId('dc1-dc2'));
    const root = await mountApp();
    const port = root.querySelector('.tp-sitewrap[data-node="dc1"] .tp-port')!;
    const dot = port.querySelector('.tp-port-dot')!;
    const panel = rectOf(root, 'dc2', 'rect.tp-site');
    const start = clientOf(root, Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')));
    const end = clientOf(root, panel.x + panel.w / 2, panel.y + panel.h - 4);
    const svg = root.querySelector('.topo-svg')!;
    pointer(port, 'Down', ...start);
    pointer(svg, 'Move', ...end);
    await tick();
    expect(root.querySelector('.tp-rubber-tip-tx')?.textContent).toContain('Link');
    pointer(svg, 'Up', ...end);
    await tick();
    const ends = topo().links.filter((l) => l.scope === 'site').map((l) => [...l.ends].sort().join('-'));
    expect(ends).toContain('dc1-dc2');
  });
});

describe('a name is edited where it is drawn', () => {
  it('F2 opens the field on the card, Enter renames, and the selection follows the name', async () => {
    const root = await mountApp();
    key(cardEl(root, 'sby01'), 'F2');
    await painted();
    const input = field(root)!;
    expect(input.value).toBe('sby01');
    type(input, 'lon01');
    key(input, 'Enter');
    await painted();
    expect(memberIds()).toContain('lon01');
    expect(memberIds()).not.toContain('sby01');
    expect(selection.value).toEqual(['lon01']);
    expect(field(root)).toBeNull();
  });

  it('a double click does the same, and Escape leaves the name alone', async () => {
    const root = await mountApp();
    cardEl(root, 'sby01').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await painted();
    const input = field(root)!;
    type(input, 'other');
    key(input, 'Escape');
    await painted();
    expect(field(root)).toBeNull();
    expect(memberIds()).toContain('sby01');
  });

  it('refuses a taken name under the field, in the rail\'s words, and keeps the field open', async () => {
    const root = await mountApp();
    const n = undoStack.value.length;
    key(cardEl(root, 'sby01'), 'F2');
    await painted();
    const input = field(root)!;
    type(input, 'prm01');
    key(input, 'Enter');
    await painted();
    expect(root.querySelector('.cv-rename-why')?.textContent).toBe(WHY.nameTaken);
    expect(field(root)).not.toBeNull();
    expect(toast.value).toBeNull();
    expect(undoStack.value.length).toBe(n);
  });

  it('Delete inside the field deletes a letter, not the card', async () => {
    const root = await mountApp();
    key(cardEl(root, 'sby01'), 'F2');
    await painted();
    key(field(root)!, 'Delete');
    key(field(root)!, 'Backspace');
    await tick();
    expect(memberIds()).toContain('sby01');
  });

  it('renames a data centre by its label, leaving its id alone', async () => {
    const root = await mountApp();
    key(root.querySelector('.tp-sitewrap[data-node="dc2"]')!, 'F2');
    await painted();
    type(field(root)!, 'London');
    key(field(root)!, 'Enter');
    await painted();
    const site = topo().sites.find((s) => (s.id as string) === 'dc2')!;
    expect(site.name).toBe('London');
  });
});

describe('a selection is made, moved and removed as one', () => {
  const dragGround = async (root: HTMLElement, a: [number, number], b: [number, number], init: MouseEventInit = {}): Promise<void> => {
    const svg = root.querySelector('.topo-svg')!;
    pointer(svg, 'Down', ...a, init);
    pointer(svg, 'Move', ...b, init);
    await tick();
  };

  it('a rectangle dragged over the ground selects the cards it touches', async () => {
    const root = await mountApp();
    const p = rectOf(root, 'prm01', 'rect.tp-card');
    const s = rectOf(root, 'sby01', 'rect.tp-card');
    const a = clientOf(root, Math.min(p.x, s.x) - 6, Math.min(p.y, s.y) - 6);
    const b = clientOf(root, Math.max(p.x, s.x) + 20, Math.max(p.y, s.y) + 20);
    await dragGround(root, a, b);
    expect(root.querySelector('.tp-band')).not.toBeNull();
    pointer(root.querySelector('.topo-svg')!, 'Up', ...b);
    await tick();
    expect(root.querySelector('.tp-band')).toBeNull();
    expect([...selection.value].sort()).toEqual(['prm01', 'sby01']);
  });

  it('with Space held, or the middle button, the drag is the pan it used to be', async () => {
    const root = await mountApp();
    await painted();
    await dragGround(root, [0, 0], [300, 300], { button: 1 });
    expect(root.querySelector('.tp-band')).toBeNull();
    pointer(root.querySelector('.topo-svg')!, 'Up', 300, 300);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await dragGround(root, [0, 0], [300, 300]);
    expect(root.querySelector('.tp-band')).toBeNull();
    pointer(root.querySelector('.topo-svg')!, 'Up', 300, 300);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    await dragGround(root, [0, 0], [300, 300]);
    expect(root.querySelector('.tp-band')).not.toBeNull();
  });

  it('is not offered in Break, where the ground is still the paper', async () => {
    mode.value = 'break';
    const root = await mountApp();
    await dragGround(root, [0, 0], [400, 400]);
    expect(root.querySelector('.tp-band')).toBeNull();
  });

  it('Ctrl+A selects every card; Ctrl+Z and Ctrl+Shift+Z walk the history; a field keeps its own keys', async () => {
    const root = await mountApp();
    await painted();
    key(document.body, 'a', { ctrlKey: true });
    expect([...selection.value].sort()).toEqual(
      [...memberIds(), ...topo().observers.map((o) => o.id as string)].sort(),
    );
    chip(root, '+ Data centre').click();
    await painted();
    const sites = topo().sites.length;
    /* The name field is open and focused: Ctrl+Z there is the field's. */
    key(field(root)!, 'z', { ctrlKey: true });
    expect(topo().sites.length).toBe(sites);
    key(field(root)!, 'Escape');
    await tick();
    key(document.body, 'z', { ctrlKey: true });
    expect(topo().sites.length).toBe(sites - 1);
    key(document.body, 'z', { ctrlKey: true, shiftKey: true });
    expect(topo().sites.length).toBe(sites);
    key(document.body, 'z', { metaKey: true });
    key(document.body, 'y', { ctrlKey: true });
    expect(topo().sites.length).toBe(sites);
    expect(redoStack.value.length).toBe(0);
  });

  it('dragging one selected card carries the others, as one undo', async () => {
    const root = await mountApp();
    selection.value = ['prm01', 'sby01'];
    await tick();
    const n = undoStack.value.length;
    const c = rectOf(root, 'sby01', 'rect.tp-card');
    const start = clientOf(root, c.x + 20, c.y + 20);
    const svg = root.querySelector('.topo-svg')!;
    pointer(cardEl(root, 'sby01'), 'Down', ...start);
    pointer(svg, 'Move', start[0] + 16, start[1] + 8);
    await tick();
    pointer(svg, 'Up', start[0] + 16, start[1] + 8);
    await tick();
    expect(docSignal.value.layout).toEqual({ prm01: { dx: 16, dy: 8 }, sby01: { dx: 16, dy: 8 } });
    expect(undoStack.value.length).toBe(n + 1);
    expect(undoLabel.value).toBe('Move 2 cards');
  });

  it('Alt and an arrow nudges the card 8 px, Shift makes it 32, and plain arrows still walk', async () => {
    const root = await mountApp();
    key(cardEl(root, 'sby01'), 'ArrowRight', { altKey: true });
    key(cardEl(root, 'sby01'), 'ArrowUp', { altKey: true, shiftKey: true });
    expect(docSignal.value.layout.sby01).toEqual({ dx: 8, dy: -32 });
    key(cardEl(root, 'sby01'), 'ArrowRight');
    expect(docSignal.value.layout.sby01).toEqual({ dx: 8, dy: -32 });
  });

  it('Tidy is grey with its reason until a card has been moved, then puts it back in one undo', async () => {
    const root = await mountApp();
    const tidy = (): HTMLButtonElement => root.querySelector('.cv-zoom button[aria-label="Tidy the drawing"]')!;
    expect(tidy().disabled).toBe(true);
    expect(tidy().title).toBe(WHY_TIDY);
    key(cardEl(root, 'sby01'), 'ArrowRight', { altKey: true });
    await tick();
    expect(tidy().disabled).toBe(false);
    tidy().click();
    await tick();
    expect(docSignal.value.layout).toEqual({});
    key(document.body, 'z', { ctrlKey: true });
    expect(docSignal.value.layout.sby01).toEqual({ dx: 8, dy: 0 });
  });

  it('Delete removes what may go, names what may not, and offers the way back', async () => {
    const root = await mountApp();
    chip(root, '+ Standby').click();
    await painted();
    key(field(root)!, 'Escape');
    await tick();
    const added = memberIds().find((m) => m !== 'prm01' && m !== 'sby01')!;
    selection.value = ['sby01', added];
    await tick();
    key(cardEl(root, 'sby01'), 'Delete');
    await tick();
    expect(memberIds()).toEqual(['prm01']);
    expect(toast.value?.action?.label).toBe('Undo');
    toast.value?.action?.run();
    expect(memberIds().sort()).toEqual(['prm01', 'sby01', added].sort());

    selection.value = ['prm01', 'sby01'];
    await tick();
    key(cardEl(root, 'sby01'), 'Delete');
    await tick();
    expect(memberIds()).toContain('prm01');
    expect(memberIds()).not.toContain('sby01');
    expect(toast.value?.kind).toBe('warn');
    expect(toast.value?.text).toContain('prm01 stays');
  });
});
