/**
 * Adding an event from a lane of the full timeline (the docked Detailed timeline below
 * 1024 px, and the timeline popped out of Topology): the `+` beside the playhead,
 * the grouped menu it opens, and the double-click that opens the same menu at
 * the pointer.
 *
 * jsdom lays nothing out, so where the button sits and whether the menu clears
 * the dock is the browser pass; what is pinned here is which lanes get a button,
 * what it says and follows, what the menu lists and what a row does (one event,
 * one undo entry, the playhead where it was), what closes the menu and where the
 * focus goes, and where none of it is drawn.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { simulate } from '@/engine';
import { classicDoc } from '@/state/doc';
import { resetHistory, undoStack } from '@/state/history';
import { topology } from '@/state/derived';
import { findingsOpen, healthyRun, mode, playing, railCollapsed, selection, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, healthyScenario, templates } from '@/ui/break/events';
import { Timeline } from '@/ui/timeline/Timeline';

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

const adds = (r: ParentNode): SVGGElement[] => [...r.querySelectorAll<SVGGElement>('.tl-lane-add')];
const addFor = (r: ParentNode, lane: string): SVGGElement => {
  const g = adds(r).find((x) => x.getAttribute('data-lane') === lane);
  if (!g) throw new Error(`no + on ${lane}`);
  return g;
};
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('.ln-menu.is-fixed');
const rowsOf = (m: HTMLElement): HTMLButtonElement[] => [...m.querySelectorAll<HTMLButtonElement>('.cv-mi-btn')];
const rowLike = (m: HTMLElement, re: RegExp): HTMLButtonElement => {
  const b = rowsOf(m).find((x) => re.test(x.textContent ?? '') && !x.disabled);
  if (!b) throw new Error(`no enabled row like ${re}`);
  return b;
};
const applicationLanes = (r: ParentNode): string[] =>
  [...r.querySelectorAll('.tl-lane')].filter((g) => g.querySelector('.t-lane-app') !== null)
    .map((g) => g.getAttribute('data-lane') as string);
const events = () => topology.value.events;

/** jsdom has no `onpointerdown`, so Preact would listen under a capitalised name: use the real one. */
const nativePointerEvents = (): void => {
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']) {
    for (const proto of [SVGElement.prototype, HTMLElement.prototype]) {
      Object.defineProperty(proto, `on${name}`, { value: null, configurable: true, writable: true });
    }
  }
};

beforeEach(() => {
  nativePointerEvents();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  /* The docked layout draws the full timeline (`TimelineBody`) in its dock. */
  viewport.value = 'compact';
  mode.value = 'break';
  railCollapsed.value = false;
  findingsOpen.value = false;
  healthyRun.value = false;
  playing.value = false;
  selection.value = [];
  tNow.value = 0;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('the + on a lane', () => {
  it('is on the primary, the standby and the observer, and on no lane of the application', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    const lanes = adds(r).map((g) => g.getAttribute('data-lane'));
    expect(lanes).toEqual(expect.arrayContaining(['prm01', 'sby01', 'obs01']));
    const app = applicationLanes(r);
    expect(app.length).toBeGreaterThan(0);
    for (const id of app) expect(lanes).not.toContain(id);
    /* One each, and each one a button that opens a menu. */
    expect(new Set(lanes).size).toBe(lanes.length);
    for (const g of adds(r)) {
      expect(g.getAttribute('role')).toBe('button');
      expect(g.getAttribute('tabindex')).toBe('0');
      expect(g.getAttribute('aria-haspopup')).toBe('menu');
      expect(g.getAttribute('aria-expanded')).toBe('false');
      expect(g.querySelector('title')?.textContent).toBe(g.getAttribute('aria-label'));
    }
  });

  it('names its lane and the playhead time, and follows the playhead', async () => {
    crashAt(0);
    tNow.value = 0;
    const r = mount();
    await tick();
    expect(addFor(r, 'prm01').getAttribute('aria-label')).toBe('Add an event to prm01 at t = 0 s');
    expect(addFor(r, 'sby01').getAttribute('aria-label')).toBe('Add an event to sby01 at t = 0 s');
    tNow.value = 12.5;
    await tick();
    expect(addFor(r, 'prm01').getAttribute('aria-label')).toBe('Add an event to prm01 at t = 12.5 s');
    expect(addFor(r, 'obs01').getAttribute('aria-label')).toBe('Add an event to obs01 at t = 12.5 s');
  });

  it('sits above the playhead in the drawing, so it is drawn after it', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    const svg = r.querySelector('.tl-svg') as SVGSVGElement;
    const all = [...svg.querySelectorAll('*')];
    expect(all.indexOf(svg.querySelector('.tl-playhead')!)).toBeLessThan(all.indexOf(adds(svg)[0]!));
  });

  it('is shown for the lane under the pointer, and hidden for the others', async () => {
    crashAt(0);
    const r = mount();
    await tick();
    expect(adds(r).some((g) => g.classList.contains('is-shown'))).toBe(false);
    const bg = r.querySelector('.tl-svg [data-lane="sby01"] .lane-bg') as Element;
    await act(() => { bg.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); });
    await tick();
    expect(addFor(r, 'sby01').classList.contains('is-shown')).toBe(true);
    expect(addFor(r, 'prm01').classList.contains('is-shown')).toBe(false);
    /* The button is on its own lane's data-lane, so pointing at it keeps it shown. */
    await act(() => { addFor(r, 'sby01').dispatchEvent(new MouseEvent('pointermove', { bubbles: true })); });
    await tick();
    expect(addFor(r, 'sby01').classList.contains('is-shown')).toBe(true);
    const plot = r.querySelector('.tl-plot') as Element;
    await act(() => { plot.dispatchEvent(new MouseEvent('pointerleave')); });
    await tick();
    expect(adds(r).some((g) => g.classList.contains('is-shown'))).toBe(false);
  });

  it('does not seek when it is pressed, though the same press on the lane does', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const svg = r.querySelector('.tl-svg') as SVGSVGElement;
    const w = Number(svg.getAttribute('width'));
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: 300, right: w, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const down = (el: Element): void => {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 420, clientY: 60 }));
    };
    down(svg.querySelector('[data-lane="prm01"] .lane-bg')!);
    await tick();
    expect(tNow.value).not.toBe(5);
    tNow.value = 5;
    await tick();
    down(addFor(r, 'prm01'));
    await tick();
    expect(tNow.value).toBe(5);
  });
});

describe('its menu', () => {
  it('opens on a click, with the lane in the header and the playhead time, the canvas menu\'s rows', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const b = addFor(r, 'prm01');
    expect(menu()).toBeNull();
    click(b);
    await tick();
    const m = menu();
    expect(m).not.toBeNull();
    expect(m!.querySelector('.cv-bar-subj')?.textContent).toBe('prm01 · at t = 5 s');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(b.classList.contains('is-shown')).toBe(true);
    expect(rowsOf(m!).length).toBeGreaterThan(0);
    /* Outside the dock: in a node of the body's own. */
    expect(m!.closest('.tl-add-portal')?.parentElement).toBe(document.body);
    expect(r.contains(m)).toBe(false);
    /* The way back, since the host is down at 5 s. */
    expect(rowsOf(m!).some((x) => /Restore the host/.test(x.textContent ?? '') && !x.disabled)).toBe(true);
  });

  it('opens on Enter and on Space, and a second press closes it', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const b = addFor(r, 'sby01');
    key(b, 'Enter');
    await tick();
    expect(menu()?.querySelector('.cv-bar-subj')?.textContent).toContain('sby01');
    click(b);
    await tick();
    expect(menu()).toBeNull();
    key(b, ' ');
    await tick();
    expect(menu()).not.toBeNull();
  });

  it('adds exactly one event, at the playhead, for that subject, as one undo entry, and leaves the playhead', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const before = events().length;
    const undoBefore = undoStack.value.length;
    click(addFor(r, 'sby01'));
    await tick();
    rowLike(menu()!, /^Crash /).click();
    await tick();
    expect(events()).toHaveLength(before + 1);
    const added = events().find((e) => e.at === 5)!;
    expect(added).toMatchObject({ at: 5, kind: 'host.down' });
    expect(String((added as { host: unknown }).host)).toMatch(/sby01/);
    expect(undoStack.value).toHaveLength(undoBefore + 1);
    expect(tNow.value).toBe(5);
    /* A row pressed injects and the menu has done its job. */
    expect(menu()).toBeNull();
  });

  it('closes on Escape and returns the focus to its button', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const b = addFor(r, 'prm01');
    click(b);
    await tick();
    expect(menu()).not.toBeNull();
    key(window, 'Escape');
    await tick();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a press elsewhere, and adds nothing', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const before = events().length;
    click(addFor(r, 'prm01'));
    await tick();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await tick();
    expect(menu()).toBeNull();
    expect(events()).toHaveLength(before);
  });

  it('closes when the dock scrolls or the window resizes, not when its own list scrolls', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    click(addFor(r, 'prm01'));
    await tick();
    menu()!.querySelector('.ln-menu-body')!.dispatchEvent(new Event('scroll'));
    await tick();
    expect(menu()).not.toBeNull();
    (r.querySelector('.tl-plot') as Element).dispatchEvent(new Event('scroll'));
    await tick();
    expect(menu()).toBeNull();
    click(addFor(r, 'prm01'));
    await tick();
    expect(menu()).not.toBeNull();
    window.dispatchEvent(new Event('resize'));
    await tick();
    expect(menu()).toBeNull();
  });

  it('follows the playhead while it is open: the header and the rows are at the new time', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    click(addFor(r, 'prm01'));
    await tick();
    tNow.value = 20;
    await tick();
    expect(menu()?.querySelector('.cv-bar-subj')?.textContent).toBe('prm01 · at t = 20 s');
  });
});

describe('a double-click on a lane', () => {
  it('opens the same menu for that lane, at the playhead time', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    expect(menu()).toBeNull();
    const bg = r.querySelector('.tl-svg [data-lane="obs01"] .lane-bg') as Element;
    bg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 300, clientY: 80 }));
    await tick();
    expect(menu()?.querySelector('.cv-bar-subj')?.textContent).toBe('obs01 · at t = 5 s');
  });

  it('does nothing on a lane whose subject offers nothing (the application) or in the gutter', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const svg = r.querySelector('.tl-svg') as SVGSVGElement;
    const w = Number(svg.getAttribute('width'));
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: 300, right: w, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const app = applicationLanes(r)[0]!;
    svg.querySelector(`[data-lane="${app}"] .lane-bg`)!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 400, clientY: 80 }));
    await tick();
    expect(menu()).toBeNull();
    svg.querySelector('[data-lane="prm01"] .lane-bg')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 10, clientY: 80 }));
    await tick();
    expect(menu()).toBeNull();
  });

  it('injects a row at the playhead as well', async () => {
    crashAt(0);
    tNow.value = 5;
    const r = mount();
    await tick();
    const before = events().length;
    (r.querySelector('.tl-svg [data-lane="sby01"] .lane-bg') as Element)
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 300, clientY: 80 }));
    await tick();
    rowLike(menu()!, /^Crash /).click();
    await tick();
    expect(events()).toHaveLength(before + 1);
    expect(tNow.value).toBe(5);
  });
});

describe('the healthy run', () => {
  it('offers the button, and the first event can be added from it', async () => {
    applyTemplate(healthyScenario(topology.value));
    expect(healthyRun.value).toBe(true);
    expect(events()).toHaveLength(0);
    const r = mount();
    await tick();
    const b = addFor(r, 'prm01');
    expect(b.getAttribute('aria-label')).toBe('Add an event to prm01 at t = 0 s');
    click(b);
    await tick();
    expect(menu()?.querySelector('.cv-bar-subj')?.textContent).toBe('prm01 · at t = 0 s');
    rowLike(menu()!, /^Crash /).click();
    await tick();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ at: 0, kind: 'host.down' });
    expect(healthyRun.value).toBe(false);
  });
});

describe('where it is not drawn', () => {
  const draw = (extra: Record<string, unknown>): HTMLElement => {
    crashAt(0);
    const doc = topology.value;
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(Timeline, { trace: simulate(doc, doc.events), doc, width: 900, tNow: 5, ...extra } as never), host);
    return host;
  };

  it('is drawn by the timeline when it is asked for', () => {
    const host = draw({ laneEvents: true });
    expect(adds(host).map((g) => g.getAttribute('data-lane'))).toEqual(expect.arrayContaining(['prm01', 'sby01', 'obs01']));
  });

  it('is not drawn without the prop', () => {
    expect(adds(draw({}))).toHaveLength(0);
  });

  it('is not drawn at the export scale', () => {
    expect(adds(draw({ laneEvents: true, pinnedScale: true }))).toHaveLength(0);
  });

  it('is not drawn in Learn', async () => {
    crashAt(0);
    mode.value = 'learn';
    const r = mount();
    await tick();
    expect(r.querySelector('.tl-svg')).not.toBeNull();
    expect(adds(r)).toHaveLength(0);
  });

  it('is not drawn in the read-only narrow viewer', async () => {
    crashAt(0);
    viewport.value = 'narrow';
    const r = mount();
    await tick();
    expect(r.querySelector('.tl-svg')).not.toBeNull();
    expect(adds(r)).toHaveLength(0);
  });
});
