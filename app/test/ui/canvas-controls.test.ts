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
import { addDatabase, removeLink } from '@/ui/inspector/edits';
import { WHY } from '@/ui/inspector/why';
import { hostId, linkId, siteId } from '@/engine';

/**
 * The layout's card offsets alone. A card let go inside its own data centre
 * also writes that data centre's kept box (a sized override, task 1.2), which
 * is a fact about the box and not about where the cards went.
 */
const cardLayout = (): Record<string, { dx: number; dy: number }> => Object.fromEntries(
  Object.entries(docSignal.value.layout).filter(([, v]) => v.w === undefined),
);

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
const siteEl = (root: HTMLElement, k: string): SVGGElement =>
  root.querySelector(`.tp-sitewrap[data-node="${k}"]`)!;
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

describe('a data centre is dragged as a group', () => {
  it('carries every member and observer standing in it, as one undo, and leaves the other data centres where they are', async () => {
    const root = await mountApp();
    const n = undoStack.value.length;
    const panel = rectOf(root, 'dc1', 'rect.tp-site');
    const start = clientOf(root, panel.x + panel.w / 2, panel.y + 10);
    const svg = root.querySelector('.topo-svg')!;
    pointer(siteEl(root, 'dc1'), 'Down', ...start);
    pointer(svg, 'Move', start[0] + 24, start[1] + 16);
    await tick();
    pointer(svg, 'Up', start[0] + 24, start[1] + 16);
    await painted();
    /* dc1 holds only prm01: that offset moves, and nothing that stands in
       another data centre does. */
    expect(docSignal.value.layout).toEqual({ prm01: { dx: 24, dy: 16 } });
    expect(siteOf('prm01')).toBe('dc1');
    expect(undoStack.value.length).toBe(n + 1);
    expect(undoLabel.value).toBe('Move the DC 1 data centre');
  });

  it('does not drop its own members on themselves', async () => {
    /* A drag that never leaves dc1's own panel must not read as a card
       dropped into another data centre -- `onMoveToSite` would otherwise
       fire for a card that never actually crossed a boundary. */
    const root = await mountApp();
    const panel = rectOf(root, 'dc1', 'rect.tp-site');
    const start = clientOf(root, panel.x + panel.w / 2, panel.y + 10);
    const svg = root.querySelector('.topo-svg')!;
    pointer(siteEl(root, 'dc1'), 'Down', ...start);
    pointer(svg, 'Move', start[0] + 10, start[1] + 10);
    await tick();
    pointer(svg, 'Up', start[0] + 10, start[1] + 10);
    await painted();
    expect(siteOf('prm01')).toBe('dc1');
    expect(memberIds()).toEqual(['prm01', 'sby01']);
  });

  it('drags an empty panel too, keyed by the data centre\'s own id', async () => {
    const root = await mountApp();
    chip(root, '+ Data centre').click();
    await painted();
    const added = topo().sites.map((s) => s.id as string).find((id) => id !== 'dc1' && id !== 'dc2' && id !== 'dc3')!;
    expect(added).toBeDefined();
    const panel = rectOf(root, added, 'rect.tp-site');
    const start = clientOf(root, panel.x + panel.w / 2, panel.y + panel.h / 2);
    const svg = root.querySelector('.topo-svg')!;
    pointer(siteEl(root, added), 'Down', ...start);
    pointer(svg, 'Move', start[0] + 8, start[1] + 24);
    await tick();
    pointer(svg, 'Up', start[0] + 8, start[1] + 24);
    await painted();
    expect(docSignal.value.layout[added]).toEqual({ dx: 8, dy: 24 });
  });

  it('still selects with a click, and still opens the rename field on a double click', async () => {
    const root = await mountApp();
    siteEl(root, 'dc1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    expect(selection.value).toEqual(['dc1']);
    siteEl(root, 'dc1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await painted();
    expect(field(root)?.value).toBe('DC 1');
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
    expect(cardLayout()).toEqual({ prm01: { dx: 16, dy: 8 }, sby01: { dx: 16, dy: 8 } });
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
    const tidy = (): HTMLButtonElement => root.querySelector('button[aria-label="Tidy the drawing"]')!;
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

describe('a chassis stack is dragged as a group', () => {
  /* An observer standing on the primary's own host: `layoutTopology` snaps
     the two into one touching stack, with a shared header band above them. */
  const coHostObserverWithPrimary = (): void => {
    const before = docSignal.value;
    const host = before.topology.members.find((m) => (m.id as string) === 'prm01')!.instances[0]!.host;
    resetHistory({
      ...before,
      topology: {
        ...before.topology,
        observers: before.topology.observers.map((o) => ((o.id as string) === 'obs01' ? { ...o, host } : o)),
      },
    });
  };

  it('carries only the pressed blade, leaving its stack mate where it is', async () => {
    coHostObserverWithPrimary();
    const root = await mountApp();
    const n = undoStack.value.length;
    const c = rectOf(root, 'prm01', 'rect.tp-card');
    const start = clientOf(root, c.x + 20, c.y + 20);
    const svg = root.querySelector('.topo-svg')!;
    pointer(cardEl(root, 'prm01'), 'Down', ...start);
    pointer(svg, 'Move', start[0] + 16, start[1] + 8);
    await tick();
    pointer(svg, 'Up', start[0] + 16, start[1] + 8);
    await tick();
    expect(cardLayout()).toEqual({ prm01: { dx: 16, dy: 8 } });
    expect(undoStack.value.length).toBe(n + 1);
  });

  it('carries every stack mate again once both blades are selected', async () => {
    coHostObserverWithPrimary();
    const root = await mountApp();
    selection.value = ['prm01', 'obs01'];
    await tick();
    const n = undoStack.value.length;
    const c = rectOf(root, 'prm01', 'rect.tp-card');
    const start = clientOf(root, c.x + 20, c.y + 20);
    const svg = root.querySelector('.topo-svg')!;
    pointer(cardEl(root, 'prm01'), 'Down', ...start);
    pointer(svg, 'Move', start[0] + 16, start[1] + 8);
    await tick();
    pointer(svg, 'Up', start[0] + 16, start[1] + 8);
    await tick();
    expect(cardLayout()).toEqual({ prm01: { dx: 16, dy: 8 }, obs01: { dx: 16, dy: 8 } });
    expect(undoStack.value.length).toBe(n + 1);
  });

  it('carries every blade the same way when the shared header band is pressed', async () => {
    coHostObserverWithPrimary();
    const root = await mountApp();
    const n = undoStack.value.length;
    const frame = root.querySelector('.tp-stack-frame')!;
    const fx = Number(frame.getAttribute('x'));
    const fy = Number(frame.getAttribute('y'));
    const fw = Number(frame.getAttribute('width'));
    const start = clientOf(root, fx + fw / 2, fy + 6);
    const svg = root.querySelector('.topo-svg')!;
    const header = root.querySelector('.tp-stack-hd')!;
    pointer(header, 'Down', ...start);
    pointer(svg, 'Move', start[0] + 24, start[1] - 8);
    await tick();
    pointer(svg, 'Up', start[0] + 24, start[1] - 8);
    await tick();
    expect(cardLayout()).toEqual({ prm01: { dx: 24, dy: -8 }, obs01: { dx: 24, dy: -8 } });
    expect(undoStack.value.length).toBe(n + 1);
  });

  it('still selects only the one card a click landed on', async () => {
    coHostObserverWithPrimary();
    const root = await mountApp();
    cardEl(root, 'obs01').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    expect(selection.value).toEqual(['obs01']);
  });
});

describe('a single card is dropped onto another host', () => {
  /* An observer standing on the primary's own host, same as the group above:
     one blade to pull out of a stack, one to drop it on. */
  const coHostObserverWithPrimary = (): void => {
    const before = docSignal.value;
    const host = before.topology.members.find((m) => (m.id as string) === 'prm01')!.instances[0]!.host;
    resetHistory({
      ...before,
      topology: {
        ...before.topology,
        observers: before.topology.observers.map((o) => ((o.id as string) === 'obs01' ? { ...o, host } : o)),
      },
    });
  };

  /* `prm01` grows a second instance on a host of its own, and the observer
     moves beside it on a third -- a RAC primary with a same-site neighbour
     that is not standing on either of its hosts, so a drop on it is neither
     a merge nor a cross-site move. */
  const makeRacWithNeighbor = (): void => {
    const before = docSignal.value;
    const prm = before.topology.members.find((m) => (m.id as string) === 'prm01')!;
    const site = before.topology.hosts.find((h) => h.id === prm.instances[0]!.host)!.site;
    const prm2 = { id: hostId('dc1-prm02'), name: 'dc1-prm02', site, listenerPort: 1521 };
    const obsHost = { id: hostId('dc1-obs01'), name: 'dc1-obs01', site, listenerPort: 1521 };
    resetHistory({
      ...before,
      topology: {
        ...before.topology,
        hosts: [...before.topology.hosts, prm2, obsHost],
        members: before.topology.members.map((m) => ((m.id as string) === 'prm01'
          ? { ...m, instances: [...m.instances, { name: 'prm02', host: prm2.id }] }
          : m)),
        observers: before.topology.observers.map((o) => ({ ...o, host: obsHost.id })),
      },
    });
  };

  const dragOnto = async (
    root: HTMLElement, from: string, target: { x: number; y: number; w: number; h: number },
  ): Promise<void> => {
    const c = rectOf(root, from, 'rect.tp-card');
    const start = clientOf(root, c.x + c.w / 2, c.y + c.h / 2);
    const end = clientOf(root, target.x + target.w / 2, target.y + target.h / 2);
    const svg = root.querySelector('.topo-svg')!;
    pointer(cardEl(root, from), 'Down', ...start);
    pointer(svg, 'Move', ...end);
    await tick();
    pointer(svg, 'Up', ...end);
    await tick();
  };

  it('merges a standalone card onto another card\'s host, cross-site, in one undo', async () => {
    const root = await mountApp();
    const n = undoStack.value.length;
    const targetHost = topo().members.find((m) => (m.id as string) === 'prm01')!.instances[0]!.host;
    const oldHost = topo().members.find((m) => (m.id as string) === 'sby01')!.instances[0]!.host;
    await dragOnto(root, 'sby01', rectOf(root, 'prm01', 'rect.tp-card'));
    expect(topo().members.find((m) => (m.id as string) === 'sby01')!.instances[0]!.host).toBe(targetHost);
    expect(siteOf('sby01')).toBe('dc1');
    expect(topo().hosts.some((h) => h.id === oldHost)).toBe(false);
    expect(docSignal.value.layout.sby01).toBeUndefined();
    expect(undoStack.value.length).toBe(n + 1);
  });

  it('moves a blade dropped on another host between stacks, keeping the old host while it is still shared', async () => {
    /* A second standby on the primary's host: a stack of two databases. */
    addDatabase(siteId('dc1'));
    const prmHost = topo().members.find((m) => (m.id as string) === 'prm01')!.instances[0]!.host;
    const before = docSignal.value;
    resetHistory({
      ...before,
      topology: {
        ...before.topology,
        members: before.topology.members.map((m) => ((m.id as string) === 'sby02'
          ? { ...m, instances: m.instances.map((i) => ({ ...i, host: prmHost })) }
          : m)),
      },
    });
    const root = await mountApp();
    const sbyHost = topo().members.find((m) => (m.id as string) === 'sby01')!.instances[0]!.host;
    await dragOnto(root, 'sby02', rectOf(root, 'sby01', 'rect.tp-card'));
    expect(topo().members.find((m) => (m.id as string) === 'sby02')!.instances[0]!.host).toBe(sbyHost);
    /* `prm01` still stands on the old host, so it is not removed. */
    expect(topo().hosts.some((h) => h.id === prmHost)).toBe(true);
    expect(topo().members.find((m) => (m.id as string) === 'prm01')!.instances[0]!.host).toBe(prmHost);
  });

  it('will not put an observer on a database\'s host: the host refuses and the drop is only the move', async () => {
    coHostObserverWithPrimary();
    const root = await mountApp();
    const sbyHost = topo().members.find((m) => (m.id as string) === 'sby01')!.instances[0]!.host;
    await dragOnto(root, 'obs01', rectOf(root, 'sby01', 'rect.tp-card'));
    const obs = topo().observers.find((o) => (o.id as string) === 'obs01')!;
    expect(obs.host).not.toBe(sbyHost);
    /* Let go over DC 2, so it moves there -- on a host of its own. */
    expect(topo().hosts.find((x) => x.id === obs.host)?.site as string).toBe('dc2');
  });

  it('highlights the target card while a merge is in reach, in place of the site highlight', async () => {
    const root = await mountApp();
    const targetRect = rectOf(root, 'prm01', 'rect.tp-card');
    const c = rectOf(root, 'sby01', 'rect.tp-card');
    const start = clientOf(root, c.x + c.w / 2, c.y + c.h / 2);
    const over = clientOf(root, targetRect.x + targetRect.w / 2, targetRect.y + targetRect.h / 2);
    const svg = root.querySelector('.topo-svg')!;
    pointer(cardEl(root, 'sby01'), 'Down', ...start);
    pointer(svg, 'Move', ...over);
    await tick();
    expect(root.querySelector('[data-node="prm01"] rect.tp-card')?.getAttribute('class')).toContain('is-target');
    expect(root.querySelector('.tp-site.is-drop')).toBeNull();
    pointer(svg, 'Up', ...over);
    await tick();
  });

  it('changes nothing but the layout when dropped on open ground in its own data centre', async () => {
    const root = await mountApp();
    const c = rectOf(root, 'prm01', 'rect.tp-card');
    const start = clientOf(root, c.x + 6, c.y + 6);
    const svg = root.querySelector('.topo-svg')!;
    pointer(cardEl(root, 'prm01'), 'Down', ...start);
    pointer(svg, 'Move', start[0] + 16, start[1] + 8);
    await tick();
    pointer(svg, 'Up', start[0] + 16, start[1] + 8);
    await tick();
    expect(siteOf('prm01')).toBe('dc1');
    expect(cardLayout()).toEqual({ prm01: { dx: 16, dy: 8 } });
  });

  it('does not merge a RAC member, even dropped squarely on another card in its own data centre', async () => {
    makeRacWithNeighbor();
    const root = await mountApp();
    const hostsBefore = topo().members.find((m) => (m.id as string) === 'prm01')!.instances.map((i) => i.host);
    await dragOnto(root, 'prm01', rectOf(root, 'obs01', 'rect.tp-card'));
    const prm = topo().members.find((m) => (m.id as string) === 'prm01')!;
    expect(prm.instances.map((i) => i.host)).toEqual(hostsBefore);
    expect(topo().observers.find((o) => (o.id as string) === 'obs01')!.host).toBe(hostId('dc1-obs01'));
    expect(docSignal.value.layout.prm01).toBeDefined();
  });
});
