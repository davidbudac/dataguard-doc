/**
 * The timeline panel folds at its handle.
 *
 * What is pinned here: the handle is a real button on the top edge of
 * Topology's floating dock and of the docked timeline slot, a folded panel
 * keeps only the handle (the Break row, the settings, the readings and the
 * small timeline are not in the document), the choice is remembered under
 * `dg-timeline`, paper opens it, the popped-out window has no fold, the dock's
 * measured height reaches the drawing's inset, and the small timeline's own
 * fold is still its own.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import {
  loadTimelineOpen, setMiniTimelineOpen, setTimelineOpen, TIMELINE_KEY, toggleTimeline,
} from '@/state/persist';
import {
  clearSelection, inspectorOpen, miniTimelineOpen, mode, timelineOpen, viewport,
} from '@/state/view';
import { applyTemplate, templates } from '@/ui/break/events';
import { popIn, popOut, popped } from '@/ui/common/popout';
import { printing } from '@/ui/print';

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

const readCss = (rel: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

const mounted: HTMLElement[] = [];
const mountApp = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  return root;
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const handle = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('button.tlp-handle');
const dock = (): HTMLElement | null => document.querySelector<HTMLElement>('.app-dock.float-card');

/** A primary crash at t = 0: there is a run to glance at. */
const withRun = (): void => {
  const t = templates(topology.value, 0).find((x) => x.id === 'crash');
  applyTemplate(t!);
};

beforeEach(() => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
  memory.clear();
  resetHistory(classicDoc());
  clearSelection();
  inspectorOpen.value = false;
  viewport.value = 'wide';
  mode.value = 'build';
  printing.value = false;
  timelineOpen.value = true;
  miniTimelineOpen.value = true;
});

afterEach(() => {
  popIn('timeline');
  popIn('canvas');
  vi.restoreAllMocks();
});

describe('Topology\'s dock handle', () => {
  it('is a real button on the card\'s top edge, open by default, with the word on it', async () => {
    withRun();
    mountApp();
    await tick();
    const btn = handle();
    expect(btn).not.toBeNull();
    expect(btn?.type).toBe('button');
    expect(btn?.getAttribute('aria-expanded')).toBe('true');
    expect(btn?.textContent).toContain('Timeline');
    expect(btn?.textContent).toContain('▾');
    /* It sits on the dock card's top edge: the card's first child, whole width. */
    expect(btn?.parentElement).toBe(dock());
    expect(dock()?.firstElementChild).toBe(btn);
    /* What it controls is there in both states. */
    expect(btn?.getAttribute('aria-controls')).toBe('app-dock');
    expect(document.getElementById('app-dock')).toBe(dock());
    expect(dock()?.querySelector('.dock-break')).not.toBeNull();
    expect(dock()?.querySelector('.dock-status')).not.toBeNull();
    expect(dock()?.querySelector('.mtl')).not.toBeNull();
  });

  it('folds the card to its handle: everything else leaves the document', async () => {
    withRun();
    mountApp();
    await tick();
    handle()?.click();
    await tick();
    expect(timelineOpen.value).toBe(false);
    expect(handle()?.getAttribute('aria-expanded')).toBe('false');
    expect(handle()?.textContent).toContain('▸');
    expect(dock()?.children).toHaveLength(1);
    for (const sel of ['.dock-break', '.sc-row', '.dock-status', '.fnd-chips', '.mtl', '.tl-svg', '.dock-scn']) {
      expect(document.querySelector(sel), sel).toBeNull();
    }
    /* With a run, the bar says in a few words what is behind it. */
    expect(document.querySelector('.tlp-sum')?.textContent).toBe('1 event');
    /* The drawing is still there, with its card. */
    expect(document.querySelector('.topo-svg')).not.toBeNull();
    handle()?.click();
    await tick();
    expect(timelineOpen.value).toBe(true);
    expect(dock()?.querySelector('.dock-break')).not.toBeNull();
    expect(dock()?.querySelector('.mtl')).not.toBeNull();
    expect(document.querySelector('.tlp-sum')).toBeNull();
  });

  it('has nothing to count without a run, and says nothing when folded', async () => {
    mountApp();
    await tick();
    handle()?.click();
    await tick();
    expect(document.querySelector('.tlp-sum')).toBeNull();
    expect(dock()?.children).toHaveLength(1);
  });

  it('leaves the small timeline its own fold, inside the panel', async () => {
    withRun();
    mountApp();
    await tick();
    const inner = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('button.mtl-fold');
    expect(inner()?.getAttribute('aria-expanded')).toBe('true');
    inner()?.click();
    await tick();
    expect(miniTimelineOpen.value).toBe(false);
    /* Only the lanes went: the panel, its handle and the Break row are there. */
    expect(timelineOpen.value).toBe(true);
    expect(handle()?.getAttribute('aria-expanded')).toBe('true');
    expect(dock()?.querySelector('.dock-break')).not.toBeNull();
    expect(inner()?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.mtl-plot')).toBeNull();
    /* And the panel folds over it without touching it. */
    handle()?.click();
    await tick();
    expect(miniTimelineOpen.value).toBe(false);
    setMiniTimelineOpen(true);
  });

  it('is not on the Detailed timeline floating layout, which has no dock', async () => {
    mode.value = 'break';
    mountApp();
    await tick();
    expect(document.querySelector('.app-dock.float-card')).toBeNull();
    expect(handle()).toBeNull();
  });
});

describe('the drawing gets the room', () => {
  /* jsdom has no layout and no ResizeObserver: a fake one stands in, and the
     card's height is whatever the test says it is. */
  it('writes the card\'s measured height into --dock-h, folded or open', async () => {
    const watching: { el: Element; fire: () => void }[] = [];
    class FakeObserver {
      private readonly cb: () => void;
      constructor(cb: () => void) { this.cb = cb; }
      observe(el: Element): void { watching.push({ el, fire: this.cb }); }
      unobserve(): void { /* nothing */ }
      disconnect(): void { /* nothing */ }
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const heights = new Map<Element, number>();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = heights.get(this) ?? 0;
      return { x: 0, y: 0, width: 600, height, top: 0, left: 0, right: 600, bottom: height, toJSON: () => ({}) } as DOMRect;
    });
    withRun();
    mountApp();
    await tick();
    const card = dock()!;
    const watchedByTheCard = (): (() => void)[] => watching.filter((w) => w.el === card).map((w) => w.fire);
    expect(watchedByTheCard().length).toBeGreaterThan(0);

    const root = document.documentElement.style;
    heights.set(card, 188);
    watchedByTheCard().forEach((f) => f());
    expect(root.getPropertyValue('--dock-h')).toBe('188px');

    /* Folded, the card is the handle alone, and the observer says so. */
    handle()?.click();
    await tick();
    heights.set(dock()!, 26);
    watching.filter((w) => w.el === dock()).forEach((w) => w.fire());
    expect(root.getPropertyValue('--dock-h')).toBe('26px');
    rect.mockRestore();
    vi.unstubAllGlobals();
    root.removeProperty('--dock-h');
  });

  it('is what the inset, the zoom pill and the findings popover are measured from', () => {
    const css = readCss('../../src/styles/float.css');
    const rule = (sel: string): string => {
      const at = css.indexOf(sel);
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
    };
    expect(rule('.app.is-float .app-stage>.tp-wrap{')).toContain('var(--dock-h');
    expect(rule('.app.is-float .zoom-pill{')).toContain('var(--dock-h');
    expect(rule('.fnd-pop{')).toContain('var(--dock-h');
  });
});

describe('the docked timeline', () => {
  it('has the same handle on its slot, and folds the slot to it', async () => {
    mode.value = 'break';
    /* Below 1024 the Detailed timeline is the docked layout. */
    viewport.value = 'compact';
    withRun();
    mountApp();
    await tick();
    const btn = handle();
    expect(btn).not.toBeNull();
    expect(btn?.parentElement?.classList.contains('tl-slot')).toBe(true);
    expect(btn?.parentElement?.firstElementChild).toBe(btn);
    expect(btn?.getAttribute('aria-controls')).toBe('tl-slot');
    expect(document.getElementById('tl-slot')).toBe(btn?.parentElement);
    expect(document.querySelector('.tl-slot .tl')).not.toBeNull();
    btn?.click();
    await tick();
    expect(timelineOpen.value).toBe(false);
    expect(handle()?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.tl-slot')?.children).toHaveLength(1);
    expect(document.querySelector('.tl')).toBeNull();
    expect(document.querySelector('.tlp-sum')?.textContent).toBe('1 event');
  });

  it('folds the empty state too, which is the panel as well', async () => {
    mode.value = 'break';
    /* Below 1024 the Detailed timeline is the docked layout. */
    viewport.value = 'compact';
    mountApp();
    await tick();
    expect(document.querySelector('.tl-slot .empty')?.textContent).toContain('No events yet');
    handle()?.click();
    await tick();
    expect(document.querySelector('.tl-slot .empty')).toBeNull();
  });

  it('is Learn\'s workbench too', async () => {
    mode.value = 'learn';
    mountApp();
    await tick();
    expect(handle()?.closest('.app-rail')).not.toBeNull();
    handle()?.click();
    await tick();
    expect(document.querySelector('.app-rail .tl-slot')?.children).toHaveLength(1);
  });

  it('is one fold for every home of the timeline', async () => {
    mountApp();
    await tick();
    handle()?.click();
    await tick();
    mode.value = 'learn';
    await tick();
    expect(handle()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('has no fold in the popped-out window: it is always open there', async () => {
    const doc = document.implementation.createHTMLDocument('');
    const win = {
      document: doc, closed: false, focus: vi.fn(),
      close: vi.fn(() => { win.closed = true; }),
      addEventListener: () => undefined, removeEventListener: () => undefined,
    };
    vi.spyOn(window, 'open').mockImplementation(() => win as unknown as Window);
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    withRun();
    setTimelineOpen(false);
    mountApp();
    await tick();
    popOut('timeline');
    await new Promise((r) => setTimeout(r, 60));
    expect(popped.value.timeline).toBeDefined();
    /* Folded at home, and open in the window, which has no handle at all. */
    expect(doc.querySelector('.po-tl .tl')).not.toBeNull();
    expect(doc.querySelector('.po-tl .tlp-handle')).toBeNull();
    expect(timelineOpen.value).toBe(false);
  });
});

describe('persistence', () => {
  it('remembers a fold under dg-timeline and reads it back', () => {
    expect(TIMELINE_KEY).toBe('dg-timeline');
    toggleTimeline();
    expect(timelineOpen.value).toBe(false);
    expect(memory.get('dg-timeline')).toBe('0');
    timelineOpen.value = true;
    loadTimelineOpen();
    expect(timelineOpen.value).toBe(false);
    setTimelineOpen(true);
    expect(memory.get('dg-timeline')).toBe('1');
    timelineOpen.value = false;
    loadTimelineOpen();
    expect(timelineOpen.value).toBe(true);
  });

  it('is open when nothing is stored, or something else is', () => {
    timelineOpen.value = false;
    loadTimelineOpen();
    expect(timelineOpen.value).toBe(true);
    memory.set(TIMELINE_KEY, 'maybe');
    timelineOpen.value = false;
    loadTimelineOpen();
    expect(timelineOpen.value).toBe(true);
  });

  it('is written by the handle itself, and is not the small timeline\'s key', async () => {
    mountApp();
    await tick();
    handle()?.click();
    expect(memory.get('dg-timeline')).toBe('0');
    expect(memory.has('dg-topology-timeline-v1')).toBe(false);
  });
});

describe('on paper', () => {
  it('opens a folded panel: there is no handle to press on a printout', async () => {
    withRun();
    setTimelineOpen(false);
    printing.value = true;
    mountApp();
    await tick();
    expect(handle()?.getAttribute('aria-expanded')).toBe('true');
    expect(dock()?.querySelector('.dock-break')).not.toBeNull();
    expect(dock()?.querySelector('.mtl')).not.toBeNull();
    expect(document.querySelector('.tlp-sum')).toBeNull();
  });

  it('opens the docked slot too', async () => {
    mode.value = 'break';
    /* Below 1024 the Detailed timeline is the docked layout. */
    viewport.value = 'compact';
    withRun();
    setTimelineOpen(false);
    printing.value = true;
    mountApp();
    await tick();
    expect(document.querySelector('.tl-slot .tl')).not.toBeNull();
  });
});

describe('writes no inline style', () => {
  it('folded or open', async () => {
    withRun();
    mountApp();
    await tick();
    for (const el of document.querySelectorAll('.app-dock, .app-dock *')) expect(el.getAttribute('style')).toBeNull();
    handle()?.click();
    await tick();
    for (const el of document.querySelectorAll('.app-dock, .app-dock *')) expect(el.getAttribute('style')).toBeNull();
  });
});

describe('the handle\'s style', () => {
  const css = readCss('../../src/styles/timeline.css');
  const rule = (sel: string): string =>
    new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('is a full-width, pointer-cursor bar with a hover state and a focus ring', () => {
    const base = rule('.tlp-handle');
    expect(base).toContain('width: 100%');
    expect(base).toContain('cursor: pointer');
    expect(css).toMatch(/\.tlp-handle:hover\s*\{/);
    expect(css).toMatch(/\.tlp-handle:focus-visible\s*\{/);
  });

  it('uses tokens, not colours of its own', () => {
    const panel = css.slice(css.indexOf('the panel\'s handle'), css.indexOf('the drawing (ported)'));
    expect(panel).not.toBe('');
    expect(panel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(panel).not.toMatch(/rgba?\(/);
  });
});
