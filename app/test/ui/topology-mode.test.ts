/**
 * Topology: the first two modes re-cut. `build` is Topology -- the editable
 * drawing plus the scenarios, the break icons on the cards and a small timeline
 * under it while there is a run -- and `break` is the Detailed timeline. The
 * ids are what they were; the words and the address are new, and every old
 * spelling of the address still opens the right mode.
 *
 * jsdom lays nothing out, so where things sit is pinned in the browser pass
 * (app/design/ui.md); what is pinned here is what is in the document, what a
 * press does and what the run shows.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { runShown, topology, trace } from '@/state/derived';
import { MODES, MODE_LABEL, healthyRun, mode, playing, selection, tNow, viewport } from '@/state/view';
import { parseUrlQuery, serializeUrlQuery, URL_DEFAULTS } from '@/state/url';
import { App } from '@/ui/App';
import { applyTemplate, shelf, templates } from '@/ui/break/events';
import { barKind, barOpen, closeBar } from '@/ui/canvas/bar';
import { glanceLanes } from '@/ui/timeline/MiniTimeline';

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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

let root: HTMLElement | null = null;
const mount = async (): Promise<HTMLElement> => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  await tick();
  return root;
};

/** Preact binds `onpointerX` under the camel-cased name where jsdom has no pointer events. */
const fire = (el: Element, name: 'pointerdown' | 'pointerover', init: MouseEventInit = {}): void => {
  const camel = name === 'pointerdown' ? 'PointerDown' : 'PointerOver';
  el.dispatchEvent(new MouseEvent(`on${name}` in el ? name : camel, { bubbles: true, cancelable: true, ...init }));
};
const click = (el: Element | null): void => {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
};
const card = (r: HTMLElement, id: string): SVGGElement => {
  const el = r.querySelector(`[data-node="${id}"]`);
  if (!(el instanceof SVGGElement)) throw new Error(`no card ${id}`);
  return el;
};
const button = (r: ParentNode, text: string): HTMLButtonElement | null =>
  [...r.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null;
const scenario = (id: string) => {
  const t = shelf(topology.value, 0).find((x) => x.id === id);
  if (!t) throw new Error(`no scenario ${id}`);
  return t;
};
/** Press a scenario on the palette, opening the shelf first if it is folded. */
const pressScenario = async (r: HTMLElement, id: string): Promise<void> => {
  if (r.querySelector('.pal-scn .pal-scn-list') === null) {
    click(r.querySelector('.pal-scn .pal-tog'));
    await tick();
  }
  click(button(r.querySelector('.pal-scn')!, scenario(id).label));
  await tick();
};
const mini = (r: ParentNode): Element | null => r.querySelector('.mtl');
const tinted = (r: ParentNode): number => r.querySelectorAll('.tp-card.is-tl, .tp-card.is-bl, .tp-card.is-am, .tp-card.is-vi, .tp-card.is-sl, .tp-card.is-down').length;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  playing.value = false;
  healthyRun.value = false;
  selection.value = [];
  tNow.value = 0;
  closeBar();
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('the names and the address', () => {
  it('words the two re-cut modes, and keeps their ids', () => {
    expect(MODES).toEqual(['build', 'break', 'configure', 'learn']);
    expect(MODE_LABEL.build).toBe('Topology');
    expect(MODE_LABEL.break).toBe('Detailed timeline');
    expect(MODE_LABEL.configure).toBe('Config');
  });

  it('writes topology-free and timeline addresses, and reads every older spelling', () => {
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'break' })).toBe('mode=timeline');
    /* Topology is the page's default, so it is the absence of a key. */
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'build' })).toBe('');
    for (const [raw, id] of [
      ['topology', 'build'], ['build', 'build'],
      ['timeline', 'break'], ['simulate', 'break'], ['break', 'break'],
    ] as const) {
      expect(parseUrlQuery(`?mode=${raw}`).state.mode, raw).toBe(id);
      expect(parseUrlQuery(`?mode=${raw}`).unknown, raw).toEqual([]);
    }
    const back = parseUrlQuery(`?${serializeUrlQuery({ ...URL_DEFAULTS, mode: 'break' })}`).state;
    expect(back.mode).toBe('break');
  });

  it('shows the words on the mode buttons', async () => {
    const r = await mount();
    expect([...r.querySelectorAll('.topbar-modes button')].map((b) => b.textContent))
      .toEqual(['Topology', 'Detailed timeline', 'Config', 'Learn']);
  });
});

describe('Topology with no run is Build as it always was', () => {
  it('draws monochrome cards, the steady-state readout and no small timeline', async () => {
    const r = await mount();
    expect(trace.value).toBeNull();
    expect(runShown()).toBe(false);
    expect(tinted(r)).toBe(0);
    expect(mini(r)).toBeNull();
    const readout = r.querySelector('.readout')?.textContent ?? '';
    expect(readout).toContain('Protection level');
    expect(readout).not.toContain('Drawing at');
    expect(readout).not.toContain('Outcome');
  });

  it('carries the scenarios on the left with the tools, in one column', async () => {
    const r = await mount();
    const stack = r.querySelector('.pal-stack');
    expect(stack).not.toBeNull();
    expect(stack?.querySelector('nav.pal-add')).not.toBeNull();
    expect(stack?.querySelector('nav.pal-scn')).not.toBeNull();
    /* One scenarios palette, not a second one from the shell. */
    expect(r.querySelectorAll('.pal-scn')).toHaveLength(1);
  });

  it('offers no scenarios to a viewer who cannot edit', async () => {
    viewport.value = 'narrow';
    const r = await mount();
    expect(r.querySelector('.pal-scn')).toBeNull();
    expect(r.querySelector('.pal-stack')).toBeNull();
  });
});

describe('a scenario from the palette makes the run', () => {
  it('shows the small timeline, tints the cards and reads the run', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    expect(trace.value).not.toBeNull();
    expect(runShown()).toBe(true);
    expect(mini(r)).not.toBeNull();
    /* One thin bar row per database, far sync and observer; none for the
       application and none for a link. */
    const lanes = [...r.querySelectorAll('.mtl-lane')];
    expect(lanes.map((l) => l.getAttribute('data-lane'))).toEqual(['prm01', 'obs01', 'sby01']);
    expect(lanes.map((l) => l.getAttribute('data-kind'))).toEqual(['member', 'observer', 'member']);
    expect(r.querySelector('.mtl [data-lane="app01"]')).toBeNull();
    for (const l of lanes) expect(l.querySelectorAll('.bar').length).toBeGreaterThan(0);
    /* Its bars carry the timeline's own phase classes, and a tooltip each. */
    const seg = r.querySelector('.mtl .tl-seg');
    expect(seg?.querySelector('.bar')?.getAttribute('class')).toMatch(/\bb-(tl|bl|am|sl|vi|hatch)\b/);
    expect(seg?.getAttribute('data-tip')).toBeTruthy();
    expect(seg?.querySelector('title')?.textContent).toBe(seg?.getAttribute('data-tip'));
    /* The injected event is a numbered mark on the axis. */
    expect(r.querySelectorAll('.mtl .mtl-mark')).toHaveLength(doc.value.topology.events.length);
    expect(r.querySelector('.mtl .mtl-mark text')?.textContent).toBe('1');
    /* The drawing is tinted by its state at the playhead, the readout reads the run. */
    expect(tinted(r)).toBeGreaterThan(0);
    const readout = r.querySelector('.readout')?.textContent ?? '';
    expect(readout).toContain('Drawing at');
    expect(readout).toContain('Outcome');
    /* The headline is the plain sentence, not the editable equation. */
    expect(r.querySelector('.mtl-cap')?.textContent).toBeTruthy();
    expect(r.querySelector('.mtl input.tl-tp-in')).not.toBeNull();
    expect(r.querySelector('.mtl .tl-eq')).toBeNull();
  });

  it('leaves the playhead at the end of the run', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    expect(tNow.value).toBeGreaterThan(0);
    expect(r.querySelector('.mtl-playhead')?.getAttribute('aria-valuenow')).toBe(String(tNow.value));
  });

  it('is there for the healthy run, with a bar per lane and no transport to play', async () => {
    const r = await mount();
    await pressScenario(r, 'healthy');
    expect(healthyRun.value).toBe(true);
    expect(mini(r)).not.toBeNull();
    expect(r.querySelectorAll('.mtl-lane')).toHaveLength(3);
    expect(r.querySelector('.mtl .tl-transport')).toBeNull();
    expect(r.querySelector('.mtl-cap')?.textContent).toContain('Everything is working');
  });

  it('is put away by Clear, which takes the run with it', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    click(button(r.querySelector('.mtl')!, 'Clear'));
    await tick();
    expect(doc.value.topology.events).toEqual([]);
    expect(trace.value).toBeNull();
    expect(mini(r)).toBeNull();
    expect(tinted(r)).toBe(0);
    expect(r.querySelector('.readout')?.textContent).toContain('Protection level');
  });

  it('leads to the Detailed timeline at the same playhead', async () => {
    const r = await mount();
    await pressScenario(r, 'crash');
    tNow.value = 12.3;
    await tick();
    click(button(r.querySelector('.mtl')!, 'Detailed timeline'));
    await tick();
    expect(mode.value).toBe('break');
    expect(tNow.value).toBe(12.3);
    expect(doc.value.topology.events.length).toBeGreaterThan(0);
  });
});

describe('the mini timeline is only Topology\'s', () => {
  const withRun = async (): Promise<HTMLElement> => {
    applyTemplate(templates(topology.value, 0).find((x) => x.id === 'crash')!);
    return mount();
  };

  it('is absent in Config, in Learn and in the Detailed timeline', async () => {
    const r = await withRun();
    expect(mini(r)).not.toBeNull();
    for (const m of ['configure', 'learn', 'break'] as const) {
      mode.value = m;
      await tick();
      expect(mini(r), m).toBeNull();
    }
    mode.value = 'build';
    await tick();
    expect(mini(r)).not.toBeNull();
  });

  it('shows to a read-only viewer who has a run to play, without Clear', async () => {
    viewport.value = 'narrow';
    const r = await withRun();
    expect(mini(r)).not.toBeNull();
    expect(button(r.querySelector('.mtl')!, 'Clear')).toBeNull();
    expect(button(r.querySelector('.mtl')!, 'Detailed timeline')).not.toBeNull();
  });

  it('sits above the findings in the docked layout', async () => {
    viewport.value = 'compact';
    const r = await withRun();
    const dock = r.querySelector('.app-dock');
    expect(dock?.querySelector('.mtl')).not.toBeNull();
    const kids = [...(dock?.children ?? [])].map((c) => c.className);
    const at = kids.findIndex((c) => c.includes('mtl'));
    const issues = kids.findIndex((c) => c.includes('issues'));
    expect(at).toBeGreaterThanOrEqual(0);
    if (issues >= 0) expect(at).toBeLessThan(issues);
  });

  it('keeps to the databases and observers, whatever lanes the run has', () => {
    const lane = (kind: string) => ({ kind }) as never;
    expect(glanceLanes([lane('member'), lane('link'), lane('application'), lane('observer')])
      .map((l) => l.kind)).toEqual(['member', 'observer']);
  });
});

describe('playing and seeking the small timeline', () => {
  const withRun = async (): Promise<HTMLElement> => {
    applyTemplate(templates(topology.value, 0).find((x) => x.id === 'crash')!);
    return mount();
  };

  it('seeks where the plot is pressed, and stops a run that is playing', async () => {
    const r = await withRun();
    const svg = r.querySelector('.mtl-svg') as SVGSVGElement;
    const w = Number(svg.getAttribute('width'));
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: w, bottom: 60, width: w, height: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    playing.value = true;
    await tick();
    fire(svg, 'pointerdown', { clientX: w * 0.3, button: 0 });
    await tick();
    const early = tNow.value;
    expect(playing.value).toBe(false);
    fire(svg, 'pointerdown', { clientX: w * 0.8, button: 0 });
    await tick();
    expect(tNow.value).toBeGreaterThan(early);
    expect(r.querySelector('.mtl-playhead')?.getAttribute('aria-valuenow')).toBe(String(tNow.value));
  });

  it('answers the arrow keys on the playhead, one second and (with Shift) a tenth', async () => {
    const r = await withRun();
    tNow.value = 10;
    await tick();
    const head = r.querySelector('.mtl-playhead') as Element;
    expect(head.getAttribute('role')).toBe('slider');
    expect(head.hasAttribute('tabindex')).toBe(true);
    key(head, 'ArrowRight');
    await tick();
    expect(tNow.value).toBe(11);
    key(head, 'ArrowLeft', { shiftKey: true });
    await tick();
    expect(tNow.value).toBe(10.9);
  });

  it('plays from the transport', async () => {
    const r = await withRun();
    tNow.value = 0;
    await tick();
    const play = r.querySelector('.mtl button[aria-label="Play"]') as HTMLButtonElement;
    expect(play).not.toBeNull();
    click(play);
    await tick();
    expect(playing.value).toBe(true);
    expect(r.querySelector('.mtl button[aria-label="Pause"]')).not.toBeNull();
    playing.value = false;
  });
});

describe('what a card does in Topology', () => {
  it('selects on a click and does not open the event menu', async () => {
    const r = await mount();
    click(card(r, 'sby01'));
    await tick();
    expect(selection.value).toEqual(['sby01']);
    expect(barOpen.value).toBeNull();
    expect(r.querySelector('.cv-bar')).toBeNull();
    expect(r.querySelector('.tp-more')?.getAttribute('data-more')).toBe('sby01');
  });

  it('lists the events, at the playhead, on the right button', async () => {
    tNow.value = 12;
    const r = await mount();
    card(r, 'sby01').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await tick();
    expect(barOpen.value).toBe('sby01');
    expect(barKind.value).toBe('events');
    expect(r.querySelector('.cv-bar-when')?.textContent).toBe(' · at t = 12 s');
    expect(r.querySelector('.cv-menu-lbl')).not.toBeNull();
    expect([...r.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent)).not.toContain('Edit sby01');
  });

  it('lists the same events on E', async () => {
    tNow.value = 4;
    const r = await mount();
    key(card(r, 'prm01'), 'e');
    await tick();
    expect(barOpen.value).toBe('prm01');
    expect(barKind.value).toBe('events');
    expect(r.querySelector('.cv-bar-when')?.textContent).toBe(' · at t = 4 s');
  });

  it('opens Build\'s own table from the handle, and Delete still removes', async () => {
    const r = await mount();
    click(card(r, 'sby01'));
    await tick();
    click(r.querySelector('.tp-more'));
    await tick();
    expect(barKind.value).toBe('actions');
    const rows = [...r.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent);
    expect(rows[0]).toBe('Edit sby01');
    expect(rows.at(-1)).toBe('Remove sby01');
    closeBar();
    await tick();
    key(card(r, 'sby01'), 'Delete');
    await tick();
    expect(doc.value.topology.members.map((m) => m.id as string)).not.toContain('sby01');
  });

  it('switches a press on the handle to Build\'s table while the events are listed', async () => {
    const r = await mount();
    card(r, 'sby01').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await tick();
    expect(barKind.value).toBe('events');
    click(r.querySelector('.tp-more'));
    await tick();
    expect(barKind.value).toBe('actions');
    expect(barOpen.value).toBe('sby01');
    click(r.querySelector('.tp-more'));
    await tick();
    expect(barOpen.value).toBeNull();
  });

  it('injects an event from the icon on the card, and leaves the reader at the result', async () => {
    const r = await mount();
    fire(card(r, 'prm01'), 'pointerover');
    await tick();
    const strip = r.querySelector('[data-tools="prm01"]');
    expect(strip).not.toBeNull();
    const icons = [...(strip?.querySelectorAll('.tp-tool') ?? [])];
    expect(icons.length).toBeGreaterThan(0);
    /* A press on an icon is not a press on the card: it starts no drag and
       leaves the selection alone. */
    const before = JSON.stringify(doc.value.layout);
    fire(icons[0] as Element, 'pointerdown', { button: 0 });
    click(icons[0] as Element);
    await tick();
    expect(JSON.stringify(doc.value.layout)).toBe(before);
    expect(doc.value.topology.events.length).toBeGreaterThan(0);
    expect(trace.value).not.toBeNull();
    expect(mini(r)).not.toBeNull();
    expect(tNow.value).toBeGreaterThan(0);
  });
});
