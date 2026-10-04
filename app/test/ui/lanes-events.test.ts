/**
 * Lanes' event buttons: the compact icons on every card, data centre header and
 * link pill, aimed at the playhead and changing with it; the More menu with the
 * whole grouped list; the empty run that is started from them; and the rest of
 * what Lanes draws (the held axis, the braces, the data centres' order, the
 * application inside its data centre).
 *
 * jsdom lays nothing out, so where things sit is pinned in the browser pass
 * (app/design/ui.md, "Break's two layouts"); what is pinned here is which
 * buttons there are, what they say, what a press does and what closes a menu.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { frame, geometry, topology } from '@/state/derived';
import { findingsOpen, mode, playing, railCollapsed, selection, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, clearEvents, templates } from '@/ui/break/events';
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

const strip = (r: HTMLElement, name: string): Element | null => r.querySelector(`.ln-cardwrap [data-ev-for="${name}"]`);
const strip_ = strip;
const tools = (r: HTMLElement, name: string): Element[] => [...(strip(r, name)?.querySelectorAll('.ln-tool:not(.ln-more)') ?? [])];
const toolIds = (r: HTMLElement, name: string): string[] => tools(r, name).map((g) => g.getAttribute('data-tool') as string);
const tool = (r: HTMLElement, name: string, id: string): Element | null =>
  strip(r, name)?.querySelector(`[data-tool="${id}"]`) ?? null;

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

describe('the buttons on the cards', () => {
  it('sit on every card, and on every data centre header, with a name and a More button', async () => {
    const r = mount();
    await tick();
    const cards = [...r.querySelectorAll('.ln-cardwrap .ln-ev')].map((g) => g.getAttribute('data-ev-for'));
    expect(cards).toEqual(['prm01', 'app01', 'sby01', 'obs01']);
    const heads = [...r.querySelectorAll('.ln-dc .ln-ev')].map((g) => g.getAttribute('data-ev-for'));
    expect(heads).toEqual(['DC 1', 'DC 2', 'DC 3']);
    for (const g of r.querySelectorAll('.ln-ev')) {
      expect(g.getAttribute('role')).toBe('toolbar');
      expect(g.getAttribute('aria-label')).toMatch(/^Events for /);
      expect(g.querySelector('.ln-more')?.getAttribute('aria-label')).toMatch(/^More events for /);
    }
    /* A database and its host, the application's host, a data centre and its links. */
    expect(toolIds(r, 'prm01')).toEqual(['member.down', 'host.down']);
    expect(toolIds(r, 'app01')).toEqual(['host.down']);
    expect(toolIds(r, 'obs01')).toEqual(['observer.stop', 'host.down']);
    const dc = [...r.querySelectorAll('.ln-dc [data-ev-for="DC 2"] .ln-tool:not(.ln-more)')].map((g) => g.getAttribute('data-tool'));
    expect(dc).toEqual(['site.down', 'site.isolate']);
  });

  it('name themselves with the action, and are always there, not only under the pointer', async () => {
    clearEvents();
    const r = mount();
    await tick();
    const labels = tools(r, 'prm01').map((g) => g.getAttribute('aria-label'));
    expect(labels).toEqual(['SHUTDOWN ABORT prm01', 'Crash dc1-prm01']);
    for (const g of tools(r, 'prm01')) expect(g.querySelector('title')?.textContent).toBe(g.getAttribute('aria-label'));
    expect(tools(r, 'prm01').every((g) => g.getAttribute('aria-disabled') === 'false')).toBe(true);
  });

  it('follow the playhead: a crash at 10 s is the way down before it and the way back after', async () => {
    crashAt(10);
    const r = mount();
    await tick();
    tNow.value = 5;
    await tick();
    expect(toolIds(r, 'prm01')).toEqual(['member.down', 'host.down']);

    tNow.value = 40;
    await tick();
    expect(toolIds(r, 'prm01')).toEqual(['member.up', 'host.up']);
    expect(tool(r, 'prm01', 'host.up')?.getAttribute('aria-label')).toBe('Restore the host');
    /* The way back is the one that stands out. */
    expect(tool(r, 'prm01', 'host.up')?.classList.contains('is-mend')).toBe(true);

    tNow.value = 3;
    await tick();
    expect(toolIds(r, 'prm01')).toEqual(['member.down', 'host.down']);
  });

  it('keep the same element in a slot as it turns from the way down to the way back', async () => {
    crashAt(10);
    const r = mount();
    await tick();
    tNow.value = 5;
    await tick();
    const slot = tools(r, 'prm01')[1];
    expect(slot?.getAttribute('data-tool')).toBe('host.down');
    tNow.value = 40;
    await tick();
    /* So a keyboard reader who pressed it is still on it, reading what it is now. */
    expect(tools(r, 'prm01')[1]).toBe(slot);
    expect(slot?.getAttribute('data-tool')).toBe('host.up');
  });

  it('follow it for a data centre too, and refuse what the clock cannot allow', async () => {
    const t = templates(topology.value, 10).find((x) => x.id === 'dc2down');
    applyTemplate(t!);
    const r = mount();
    await tick();
    tNow.value = 5;
    await tick();
    const dc2 = (): string[] => [...r.querySelectorAll('.ln-dc [data-ev-for="DC 2"] .ln-tool:not(.ln-more)')]
      .map((g) => g.getAttribute('data-tool') as string);
    expect(dc2()[0]).toBe('site.down');
    tNow.value = 30;
    await tick();
    expect(dc2()[0]).toBe('site.up');
    expect(r.querySelector('.ln-dc.is-down')).not.toBeNull();
  });

  it('are grey with the reason as their title when the moment refuses them', async () => {
    crashAt(10);
    const r = mount();
    await tick();
    tNow.value = 40;
    await tick();
    const startup = tool(r, 'prm01', 'member.up') as Element;
    expect(startup.classList.contains('is-off')).toBe(true);
    expect(startup.getAttribute('aria-disabled')).toBe('true');
    expect(startup.getAttribute('aria-label')).toMatch(/ — .*down.*restore the host first/i);
    expect(startup.querySelector('title')?.textContent).toBe(startup.getAttribute('aria-label'));
    const before = topology.value.events.length;
    click(startup);
    await tick();
    expect(topology.value.events.length).toBe(before);
    /* A grey control is out of the tab order and the arrows; the live ones are in it. */
    expect(startup.getAttribute('tabindex')).toBe('-1');

    /* And a switchover is refused while the primary is down at this point on the clock. */
    click(strip(r, 'sby01')?.querySelector('.ln-more') ?? null);
    await tick();
    const row = [...r.querySelectorAll('.ln-menu .cv-mi')].find((m) => /SWITCHOVER/.test(m.textContent ?? ''));
    expect(row?.classList.contains('is-off')).toBe(true);
    expect(row?.querySelector('.why')?.textContent?.length).toBeGreaterThan(0);
  });

  it('inject at the playhead and leave it where it is, and the marker is there at once', async () => {
    clearEvents();
    const r = mount();
    await tick();
    tNow.value = 12.34;
    await tick();
    click(tool(r, 'prm01', 'host.down'));
    await tick();
    const events = topology.value.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'host.down', at: 12.3 });
    expect(tNow.value).toBe(12.34);
    /* The run exists now: lanes, a marker for the event, and no hint. */
    expect(r.querySelectorAll('.ln-svg .tl-event-drag')).toHaveLength(1);
    expect(r.querySelectorAll('.ln-svg .tl-lane').length).toBeGreaterThan(0);
    /* No second clock: the transport's own time field is the one the buttons are aimed at. */
    expect(r.querySelector('.evmenu')).toBeNull();
    expect((r.querySelector('.tl-transport input[aria-label="Time in seconds"]') as HTMLInputElement).value)
      .toMatch(/^12\.[03]/);
    /* And the slot that was the way down is now the way back. */
    expect(toolIds(r, 'prm01')).toEqual(['member.up', 'host.up']);
  });

  it('press with Enter and Space as well, and walk the strip with the arrows', async () => {
    clearEvents();
    const r = mount();
    await tick();
    const first = tool(r, 'prm01', 'member.down') as SVGElement;
    expect(first.getAttribute('tabindex')).toBe('0');
    const second = tool(r, 'prm01', 'host.down') as SVGElement;
    expect(second.getAttribute('tabindex')).toBe('-1');
    key(strip(r, 'prm01') as Element, 'ArrowRight');
    await tick();
    expect(tool(r, 'prm01', 'host.down')?.getAttribute('tabindex')).toBe('0');
    key(tool(r, 'prm01', 'host.down') as Element, 'Enter');
    await tick();
    expect(topology.value.events.map((e) => e.kind)).toEqual(['host.down']);
  });

  it('clicking the card is still selecting it, and pressing a button is not', async () => {
    clearEvents();
    const r = mount();
    await tick();
    click(r.querySelector('.ln-node[data-node="prm01"]'));
    await tick();
    expect(selection.value).toEqual(['prm01']);
    selection.value = [];
    await tick();
    click(tool(r, 'sby01', 'host.down'));
    await tick();
    expect(selection.value).toEqual([]);
  });
});

describe('the More menu', () => {
  it('lists the whole grouped table for the card, at the playhead, and closes on Escape', async () => {
    clearEvents();
    const r = mount();
    await tick();
    tNow.value = 7;
    await tick();
    const more = strip(r, 'sby01')?.querySelector('.ln-more') as Element;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    click(more);
    await tick();
    const menu = r.querySelector('.ln-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(menu.querySelector('.cv-bar-subj')?.textContent).toContain('sby01');
    expect(menu.querySelector('.cv-bar-subj')?.textContent).toContain('at t = 7 s');
    const groups = [...menu.querySelectorAll('.cv-menu-lbl')].map((p) => p.textContent);
    expect(groups.slice(0, 2)).toEqual(['Fail', 'Role change']);
    expect(groups).toContain('Restore');
    const rows = [...menu.querySelectorAll('.cv-mi-btn')].map((b) => b.textContent);
    expect(rows).toContain('Crash dc2-sby01');
    expect(rows.some((t) => /SWITCHOVER TO sby01/.test(t ?? ''))).toBe(true);
    /* The focus moved into it, on a row that can be pressed. */
    expect(document.activeElement?.classList.contains('cv-mi-btn')).toBe(true);

    /* Arrows walk the rows. */
    const first = document.activeElement;
    key(menu, 'ArrowDown');
    expect(document.activeElement).not.toBe(first);

    key(window, 'Escape');
    await tick();
    expect(r.querySelector('.ln-menu')).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
    /* Escape closed the menu and forgot nothing else. */
    expect(selection.value).toEqual([]);
  });

  it('closes on a press outside it, and a second press on its opener', async () => {
    clearEvents();
    const r = mount();
    await tick();
    const more = strip(r, 'prm01')?.querySelector('.ln-more') as Element;
    click(more);
    await tick();
    expect(r.querySelector('.ln-menu')).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await tick();
    expect(r.querySelector('.ln-menu')).toBeNull();

    click(more);
    await tick();
    expect(r.querySelector('.ln-menu')).not.toBeNull();
    click(more);
    await tick();
    expect(r.querySelector('.ln-menu')).toBeNull();
  });

  it('presses a row: the event lands at the playhead and the menu has done its job', async () => {
    clearEvents();
    const r = mount();
    await tick();
    tNow.value = 20;
    await tick();
    click(strip(r, 'sby01')?.querySelector('.ln-more') ?? null);
    await tick();
    const row = [...r.querySelectorAll('.ln-menu .cv-mi-btn')].find((b) => /^SWITCHOVER TO/.test(b.textContent ?? ''));
    click(row ?? null);
    await tick();
    expect(topology.value.events).toHaveLength(1);
    expect(topology.value.events[0]).toMatchObject({ kind: 'cmd.switchover', at: 20 });
    expect(tNow.value).toBe(20);
    expect(r.querySelector('.ln-menu')).toBeNull();
  });

  it('belongs to a data centre too', async () => {
    clearEvents();
    const r = mount();
    await tick();
    click(r.querySelector('.ln-dc [data-ev-for="DC 2"] .ln-more'));
    await tick();
    expect(r.querySelector('.ln-menu .cv-bar-subj')?.textContent).toContain('DC 2');
    const rows = [...r.querySelectorAll('.ln-menu .cv-mi-btn')].map((b) => b.textContent);
    expect(rows).toEqual(['Take DC 2 down', 'Isolate DC 2']);
  });
});

describe('the links', () => {
  it('give their cut to the pill, as a menu, at the playhead', async () => {
    clearEvents();
    const r = mount();
    await tick();
    tNow.value = 15;
    await tick();
    const pills = [...r.querySelectorAll('.ln-pill.is-act')];
    expect(pills.length).toBeGreaterThan(0);
    for (const p of pills) {
      expect(p.getAttribute('role')).toBe('button');
      expect(p.getAttribute('aria-haspopup')).toBe('menu');
    }
    click(pills[0] as Element);
    await tick();
    const rows = [...r.querySelectorAll('.ln-menu .cv-mi-btn')];
    const cut = rows.find((b) => /^Cut /.test(b.textContent ?? ''));
    expect(cut).toBeDefined();
    click(cut ?? null);
    await tick();
    expect(topology.value.events).toHaveLength(1);
    expect(topology.value.events[0]).toMatchObject({ kind: 'link.cut', at: 15 });
    /* The pill now reads cut, and its menu offers the way back. */
    click(r.querySelector('.ln-pill.is-act.is-down'));
    await tick();
    expect([...r.querySelectorAll('.ln-menu .cv-mi-btn:not(:disabled)')]
      .some((b) => /^(Reconnect|Restore|Heal|Take|Bring)/i.test(b.textContent ?? ''))).toBe(true);
  });
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
    click(tool(r, 'prm01', 'host.up'));
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
  it('has the buttons on the name\'s line and the whole width for role and state', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    tNow.value = 12;
    await tick();
    for (const name of ['prm01', 'app01', 'sby01', 'obs01']) {
      const g = node(r, name);
      const strip = strip_(r, name);
      const sub = g.querySelector('.ln-sub') as SVGTextElement;
      expect(sub.textContent ?? '', name).not.toMatch(/…/);
      /* the buttons sit level with the name, not with the second line */
      const y = Number(strip?.querySelector('.ln-tool')?.getAttribute('transform')?.match(/,([\d.]+)\)/)?.[1]);
      expect(y, name).toBeLessThan(Number(sub.getAttribute('y')) - 10);
    }
    /* Members and the observer carry the state at t in the text and in the accessible name. */
    expect(subOf(r, 'sby01')).toMatch(/^Physical standby · /);
    expect(subOf(r, 'obs01')).toMatch(/^Observer.* · /);
    expect(node(r, 'sby01').getAttribute('aria-label')).toMatch(/^sby01, Physical standby, \S/);
    expect(node(r, 'obs01').getAttribute('aria-label')).toMatch(/, Reconnect|, Pinging/);
  });

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
    click(tool(r, 'app01', 'host.down'));
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
    expect(r.querySelector('.ln-menu .cv-bar-subj .mono')?.textContent).toBe('redo prm01 → sby01, SYNC');
    expect(r.querySelector('.ln-menu .cv-bar-when')?.textContent).toMatch(/at t = 20 s/);
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
  it('shows the cards with their buttons and the tracks', async () => {
    clearEvents();
    const r = mount();
    await tick();
    expect(r.querySelectorAll('.ln-cardwrap')).toHaveLength(4);
    expect(r.querySelectorAll('.ln-cardwrap .ln-tool:not(.ln-more)').length).toBeGreaterThanOrEqual(7);
    expect(r.querySelectorAll('.ln-track')).toHaveLength(4);
    /* Nothing to seek or play, but the bar still carries the findings. */
    expect(r.querySelector('.ln-bar .tl-transport')).toBeNull();
    expect(r.querySelector('.ln-bar .sb-chip')).not.toBeNull();
  });

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

describe('the axis', () => {
  const slider = (r: HTMLElement): Element => r.querySelector('.ln-svg .tl-event-drag') as Element;

  it('is held where it was when an event is moved, and Fit lets go of it', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    expect(r.querySelector('.ln-bar .sb-fit')).toBeNull();
    const ticks = (): string => [...r.querySelectorAll('.ln-svg text.t-tick.t-mono')].map((x) => x.textContent).join(',');
    const before = ticks();
    key(slider(r), 'ArrowRight');
    await tick();
    expect(topology.value.events[0]?.at).toBe(1);
    const fit = r.querySelector('.ln-bar .sb-fit') as HTMLButtonElement | null;
    expect(fit).not.toBeNull();
    expect(ticks()).toBe(before);
    fit!.click();
    await tick();
    expect(r.querySelector('.ln-bar .sb-fit')).toBeNull();
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

  it('in Lanes sits beside the pin, in the plot and clear of the sticky head, not above it', async () => {
    crashAt(10);
    const r = mount();
    await tick();
    const g = grab(r, 300);
    await tick();
    const t = g.querySelector('.tl-event-time') as SVGTextElement;
    expect(t).not.toBeNull();
    expect(t.textContent).toMatch(/^\d+(\.\d)? s$/);
    /* jsdom lays nothing out, so where it sits is read off the attributes: inside
       the plot's svg, and its top no higher than the svg's own top edge. */
    expect(t.closest('.ln-plot')).not.toBeNull();
    expect(Number(t.getAttribute('y')) - 11).toBeGreaterThanOrEqual(0);
    expect(['start', 'end']).toContain(t.getAttribute('text-anchor'));
  });

  it('in the full timeline (docked, or popped out) keeps to the old place: centred over the pin', async () => {
    viewport.value = 'compact';
    crashAt(10);
    const r = mount();
    await tick();
    const g = grab(r, 300);
    await tick();
    const t = g.querySelector('.tl-event-time') as SVGTextElement;
    expect(t.getAttribute('text-anchor')).toBe('middle');
  });

  it('flips to the pin\'s other side at the right edge and stays inside the plot', () => {
    expect(besideReadout(100, 6, 1000)).toBe('start');
    expect(besideReadout(990, 6, 1000)).toBe('end');
    /* Too narrow for either: the right side, the one that reads left to right. */
    expect(besideReadout(20, 6, 60)).toBe('start');
  });
});
