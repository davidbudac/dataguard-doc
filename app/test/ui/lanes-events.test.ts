/** Outcome card states, lane geometry, links and setting controls.
 * @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { frame, geometry, topology } from '@/state/derived';
import { findingsOpen, mode, playing, railCollapsed, selection, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { actionsForKey, runAction, applyTemplate, clearEvents, templates } from '@/ui/break/events';
import { siteOrder } from '@/ui/break/lanes-layout';
import { besideReadout } from '@/ui/timeline/EventDrag';

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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

let root: HTMLElement | null = null;
const mount = (): HTMLElement => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

/** Crash the primary's host at `at`. */
const crashAt = (at: number): void => {
  const t = templates(topology.value, at).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  applyTemplate(t);
};

const click = (el: Element | null): void => {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const key = (el: Element | Window, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  railCollapsed.value = false;
  findingsOpen.value = false;
  playing.value = false;
  selection.value = [];
  tNow.value = 0;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

const node = (r: HTMLElement, name: string): Element => {
  const n = [...r.querySelectorAll('.ln-node')].find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${name},`));
  if (!n) throw new Error(`no card ${name}`);
  return n;
};
const subOf = (r: HTMLElement, name: string): string => node(r, name).querySelector('.ln-sub')?.textContent ?? '';

describe('the state on a card is the state at the playhead, at an event\'s own tick', () => {
  const primary = (): string => topology.value.members.find((m) => m.name === 'dc1-prm01' || m.name === 'prm01')!.id as string;

  it('says Down at the tick a crash lands on, and Open at the tick the restore lands on', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    /* t = 0: the crash is at 0. The lane, the cross and the frame say down, and so does the card. */
    tNow.value = 0;
    await tick();
    expect(frame.value?.members[primary() as never]).toBe('down');
    expect(node(r, 'prm01').getAttribute('aria-label')).toBe('prm01, Primary, Down');
    expect(subOf(r, 'prm01')).toMatch(/Primary · Down/);
    expect(node(r, 'prm01').classList.contains('is-down')).toBe(true);
    expect(node(r, 'prm01').querySelector('.ln-hatch')).not.toBeNull();
    expect(node(r, 'prm01').querySelector('.ln-x')).not.toBeNull();
    /* A restore at 20, and the playhead left where it was aimed. */
    tNow.value = 20;
    await tick();
    runAction(actionsForKey(topology.value, 'prm01', tNow.value).find(a => a.id === 'host.up')!, { keepPlayhead: true });
    await tick();
    expect(tNow.value).toBe(20);
    expect(topology.value.events.map((e) => [e.kind, e.at])).toEqual([['host.down', 0], ['host.up', 20]]);
    /* Just before it, still down; at it, open. */
    tNow.value = 19.9;
    await tick();
    expect(node(r, 'prm01').getAttribute('aria-label')).toBe('prm01, Primary, Down');
    tNow.value = 20;
    await tick();
    expect(frame.value?.members[primary() as never]).toBe('open-rw');
    expect(node(r, 'prm01').getAttribute('aria-label')).toBe('prm01, Primary, Open');
    expect(subOf(r, 'prm01')).toMatch(/^Primary · (Open|Shipping)/);
    expect(node(r, 'prm01').classList.contains('is-down')).toBe(false);
    expect(node(r, 'prm01').querySelector('.ln-hatch')).toBeNull();
    expect(node(r, 'prm01').querySelector('.ln-x')).toBeNull();
  });
});

describe('a card reads in two lines and never loses its state word', () => {


  it('shows the crash as a cross in the badge, in place of the role\'s letter', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    tNow.value = 0;
    await tick();
    const g = node(r, 'prm01');
    expect(g.querySelector('.ln-bdg-t')).toBeNull();
    expect(g.querySelectorAll('.ln-x line')).toHaveLength(2);
    expect(node(r, 'sby01').querySelector('.ln-bdg-t')?.textContent).toBe('S');
  });
});

describe('the application host has a lane of its own', () => {
  it('is a band of the host\'s up and down, from the events, and says what it is', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    const id = node(r, 'app01').getAttribute('data-node');
    const lane = (): Element | null => r.querySelector(`.ln-row .tl-lane[data-lane="${id}"]`);
    expect(lane()).not.toBeNull();
    /* One band, up, through a run that never touches the application's host. */
    expect([...(lane()?.querySelectorAll('.tl-seg') ?? [])].map((x) => x.getAttribute('data-tip'))).toEqual(["app01's host — Host up"]);
    /* Crash that host at 10 s: up, then down from there. */
    tNow.value = 10;
    await tick();
    runAction(actionsForKey(topology.value, 'app01', tNow.value).find(a => a.id === 'host.down')!, { keepPlayhead: true });
    await tick();
    const tips = [...(lane()?.querySelectorAll('.tl-seg') ?? [])].map((x) => x.getAttribute('data-tip'));
    expect(tips).toEqual(["app01's host — Host up", "app01's host — Down — host has crashed"]);
    expect(lane()?.querySelectorAll('.bar.b-hatch')).toHaveLength(1);
    /* The card reads it too. */
    tNow.value = 30;
    await tick();
    expect(subOf(r, 'app01')).toBe('Host down');
    expect(node(r, 'app01').querySelector('.ln-x')).not.toBeNull();
  });
});

describe('the links are named', () => {
  it('give the pill, the connector and the menu one name for the link, with its state at the playhead', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    tNow.value = 20;
    await tick();
    const pills = [...r.querySelectorAll('.ln-pill')];
    const sync = pills.find((p) => (p.textContent ?? '').startsWith('SYNC'));
    expect(sync).toBeDefined();
    expect(sync?.getAttribute('data-tip')).toMatch(/^redo prm01 → sby01, SYNC, down at t = 20 s\./);
    /* The connector says the same. */
    const lk = [...r.querySelectorAll('.ln-lk')].map((l) => l.getAttribute('data-tip'));
    expect(lk.some((t) => /^redo prm01 → sby01, SYNC, down at t = 20 s\./.test(t ?? ''))).toBe(true);
    expect(lk.every((t) => /^(redo|ping|readiness check|connection) \S+ → \S+.*, (up|down|cut|standing down) at t = 20 s\./.test(t ?? ''))).toBe(true);
    /* The pill's menu is headed by the link's name, not by the pill's text. */
    click(sync ?? null);
    await tick();
    expect(selection.value.length).toBe(1);
    expect(r.querySelector('.app-rail .insp')).not.toBeNull();
    expect(mode.value).toBe('break');
  });

  it('colour the pill as the canvas does: red for down, plain for the rest', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    tNow.value = 5;
    await tick();
    const classes = [...r.querySelectorAll('.ln-pill')].map((p) => p.getAttribute('class') ?? '');
    expect(classes.some((c) => c.includes('is-down'))).toBe(true);
    /* The canvas has no green link: an active, up link is plain. */
    expect(classes.filter((c) => c.includes('is-down')).length).toBeLessThan(classes.length);
  });
});

describe('an empty run', () => {


  it('still has an axis, a default minute, and a playhead on it', async () => {
    clearEvents();
    const r = mount();
    await tick();
    const labels = (sel: string): string[] => [...r.querySelectorAll(sel)].map((x) => x.textContent ?? '');
    expect(labels('.ln-svg.is-seekable text.t-tick.t-mono').slice(-8, -1)).toEqual(['0', '10', '20', '30', '40', '50', '60']);
    expect(r.querySelector('.ln-svg.is-seekable line.ax')).not.toBeNull();
    const before = r.querySelector('.ln-steady-ph')?.getAttribute('transform');
    expect(before).toMatch(/^translate\(/);
    expect(r.querySelector('.ln-steady-ph .tl-playhead-t')?.textContent).toBe('t = 0');
    /* Moving the playhead moves it. */
    tNow.value = 30;
    await tick();
    expect(r.querySelector('.ln-steady-ph')?.getAttribute('transform')).not.toBe(before);
    expect(r.querySelector('.ln-steady-ph .tl-playhead-t')?.textContent).toBe('t = 30');
  });
});

describe('the braces', () => {
  it('hang under the axis, below the last lane, as in the timeline, with the outage brace and caption above', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    const svg = r.querySelector('.ln-svg.is-seekable') as SVGElement;
    const height = Number(svg.getAttribute('height'));
    const axis = r.querySelector('.ln-svg line.ax') as SVGLineElement;
    const axisY = Number(axis.getAttribute('y1'));
    const braces = [...r.querySelectorAll('.ln-svg .tl-brace path')];
    expect(braces.length).toBeGreaterThan(0);
    /* Every brace starts under the axis, and the drawing is tall enough to hold them. */
    for (const p of braces) {
      const y = Number(/^M[\d.-]+,([\d.-]+)/.exec(p.getAttribute('d') ?? '')?.[1]);
      expect(y).toBeGreaterThan(axisY);
      expect(y).toBeLessThan(height);
    }
  });
});

describe('the data centres', () => {
  it('are listed in the order the document declares them, not in the drawing\'s column order', async () => {
    const r = mount();
    await tick();
    const declared = topology.value.sites.map((s) => s.name);
    const listed = [...r.querySelectorAll('.ln-dc-body')].map((b) => b.getAttribute('aria-label'));
    expect(listed).toEqual(declared);
    /* The drawing puts the observer-only data centre between the two it joins. */
    const columns = (geometry.value?.columns ?? []).map((c) => c.site as string);
    expect(columns).not.toEqual(topology.value.sites.map((s) => s.id as string));
  });

  it('siteOrder keeps the declared order, drops empty sites and gathers strays after', () => {
    expect(siteOrder(['b', 'a', 'c'], new Set(['a', 'b', 'c']))).toEqual(['b', 'a', 'c']);
    expect(siteOrder(['a', 'b', 'c'], new Set(['c', 'a']))).toEqual(['a', 'c']);
    expect(siteOrder(['a'], new Set(['a', 'z', 'y']))).toEqual(['a', 'y', 'z']);
  });

  it('carry the application inside the one its host is in, and the application\'s view under them all', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    const y = (sel: string): number => Number(r.querySelector(sel)?.getAttribute('y'));
    const app = y('.ln-node[data-node="app01"] rect.ln-card');
    const prm = y('.ln-node[data-node="prm01"] rect.ln-card');
    const dc2 = Number(r.querySelector('.ln-dc[data-site="dc2"] rect')?.getAttribute('y'));
    expect(app).toBeGreaterThan(prm);
    expect(app).toBeLessThan(dc2);
    const head = r.querySelector('.ln-apphead .ln-dc rect');
    expect(Number(head?.getAttribute('y'))).toBeGreaterThan(y('.ln-node[data-node="obs01"] rect.ln-card'));
  });
});

describe('the time readout while an event pin is dragged', () => {
  const grab = (r: HTMLElement, x: number): SVGGElement => {
    const g = r.querySelector('.tl-event-drag') as SVGGElement;
    g.setPointerCapture = vi.fn();
    g.hasPointerCapture = () => true;
    g.releasePointerCapture = vi.fn();
    /* jsdom has no `onpointerdown`, so preact listens for `PointerDown`; ask the element what it did. */
    const fire = (kind: string, cx: number): void => {
      const type = `onpointer${kind}` in g ? `pointer${kind}` : `Pointer${kind[0]!.toUpperCase()}${kind.slice(1)}`;
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      act(() => { g.dispatchEvent(e); });
    };
    fire('down', x);
    fire('move', x + 120);
    return g;
  };

  it('flips to the pin\'s other side at the right edge and stays inside the plot', () => {
    expect(besideReadout(100, 6, 1000)).toBe('start');
    expect(besideReadout(990, 6, 1000)).toBe('end');
    /* Too narrow for either: the right side, the one that reads left to right. */
    expect(besideReadout(20, 6, 60)).toBe('start');
  });
});
