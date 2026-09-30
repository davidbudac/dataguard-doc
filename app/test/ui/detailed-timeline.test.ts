/**
 * The Detailed timeline is the lanes -- each member's card continuing as its
 * lane, one bar over them -- and nothing else: no drawing of the topology, no
 * layout switch in the top bar, no preference behind one. What is pinned here
 * is what that view carries (the bar, the findings, the colour key, the
 * headline, the axis fit), the rail folding on the way in, the density of the
 * lanes staying with the model that asked for it, the docked fallback below
 * 1024 px, and Topology and Config staying as they were.
 *
 * jsdom lays nothing out, so how the regions sit is pinned in the browser pass
 * (app/design/ui.md); what is pinned here is the state, the structure and the
 * contract with storage.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { RAIL_KEY, setRailCollapsed } from '@/state/persist';
import { URL_FIELDS } from '@/state/url';
import { breakTimeline, findingsOpen, mode, railCollapsed, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { revealFindings } from '@/ui/IssuePanel';
import { applyTemplate, templates } from '@/ui/break/events';
import { railSnap } from '@/ui/break/rail-fold';
import { buildTimeline, TL_COMPACT, TL_FULL } from '@/ui/timeline/build';
import { trace } from '@/state/derived';

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

/* Signals re-render on a microtask; `useEffect` runs after paint. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

let root: HTMLElement | null = null;
const mount = (): HTMLElement => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

const crash = (): void => {
  const t = templates(topology.value, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  applyTemplate(t);
};

const app = (r: HTMLElement): Element => r.querySelector('.app') as Element;

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  railCollapsed.value = false;
  findingsOpen.value = false;
  breakTimeline.value = 'config';
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('the top bar', () => {
  it('has no layout switch in any mode: the release switch is alone in the group', async () => {
    const r = mount();
    await tick();
    for (const m of ['build', 'break', 'configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(r.querySelector('[aria-label="Layout"]'), m).toBeNull();
      expect([...r.querySelectorAll('.topbar-group > .seg')].map((x) => x.getAttribute('aria-label')), m)
        .toEqual(['Oracle release']);
    }
    expect(r.querySelector('.topbar')?.textContent ?? '').not.toMatch(/\bSplit\b/);
  });

  it('does not read or write a layout preference, and no URL key carries one', async () => {
    memory.set('dg-break-layout', 'split');
    memory.set('dg-tl-h', '480');
    const r = mount();
    await tick();
    expect(app(r).classList.contains('bl-lanes')).toBe(true);
    expect(app(r).className).not.toMatch(/bl-split|tl-full/);
    /* Nothing of either is written back, and nothing reaches the page's style. */
    expect(memory.get('dg-break-layout')).toBe('split');
    expect(memory.get('dg-tl-h')).toBe('480');
    expect(document.documentElement.style.getPropertyValue('--tl-h')).toBe('');
    const keys = URL_FIELDS.map((f) => f.k);
    expect(keys).not.toContain('layout');
    expect(keys).not.toContain('variant');
  });
});

describe('the words', () => {
  /** Every sentence a reader can be shown or told by a screen reader: text, titles, labels, descriptions. */
  const said = (r: HTMLElement): string[] => [
    r.textContent ?? '',
    ...[...r.querySelectorAll('[aria-label], [title], [aria-description]')].flatMap((el) => [
      el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '', el.getAttribute('aria-description') ?? '',
    ]),
    ...[...r.querySelectorAll('title')].map((el) => el.textContent ?? ''),
  ];

  it('never call the modes by their old names, in either of them, with a run on screen', async () => {
    crash();
    const r = mount();
    for (const m of ['break', 'build'] as const) {
      mode.value = m;
      await tick();
      for (const line of said(r)) {
        expect(line, m).not.toMatch(/\bSimulate\b/);
        expect(line, m).not.toMatch(/\bBuild(?:'s)? (?:inspector|mode|dock)\b/);
      }
    }
  });

  it('name the Detailed timeline on its sections, and say where an event is added from', async () => {
    const r = mount();
    await tick();
    expect(r.querySelector('.ln-view')?.getAttribute('aria-label')).toBe('Detailed timeline: members and their timelines');
    /* Its rail: the events, and where a first one comes from. */
    setRailCollapsed(false);
    await tick();
    expect(r.querySelector('.app-rail .empty p')?.textContent).toBe('Pick a scenario below, or add an event from a card.');
    expect(r.querySelector('.tune-all')?.getAttribute('title')).toBe("Every setting, in Topology's inspector");
    /* Its Application timeline. */
    const b = [...r.querySelectorAll<HTMLButtonElement>('.seg[aria-label="Timeline"] button')].find((x) => x.textContent === 'Application');
    b?.click();
    await tick();
    expect(r.querySelector('.ln-view')?.getAttribute('aria-label')).toBe('Detailed timeline: application');
  });

  it('docked, the rail and the timeline slot say what the drawing beside them offers', async () => {
    viewport.value = 'compact';
    const r = mount();
    await tick();
    expect(r.querySelector('.tl-slot .empty p')?.textContent).toBe('No events yet. Pick a scenario, or add an event from a card on the drawing.');
  });
});

describe('where it floats', () => {
  it('is the lanes, on a shell that never changes, with no drawing of the topology and no dock', async () => {
    crash();
    const r = mount();
    await tick();
    const shell = app(r);
    expect(shell.classList.contains('is-float')).toBe(true);
    expect(shell.classList.contains('bl-lanes')).toBe(true);
    expect(r.querySelector('.ln-view')).not.toBeNull();
    expect(r.querySelector('.topo-svg')).toBeNull();
    expect(r.querySelector('.app-dock')).toBeNull();
    expect(r.querySelector('.palette')).toBeNull();
    expect(r.querySelector('.dock-scn')).toBeNull();
    expect(r.querySelector('.dock-grip')).toBeNull();
    expect(r.querySelector('.tl-full-btn')).toBeNull();
    /* Its bar is the view's own top edge. */
    expect(r.querySelector('.ln-view .sb-bar.ln-bar')).not.toBeNull();
  });

  it('has the bar over the lanes, with the transport on it and no floating banner', async () => {
    crash();
    const r = mount();
    await tick();
    const bar = r.querySelector('.sb-bar');
    expect(bar).not.toBeNull();
    expect(bar?.querySelector('.tl-transport')).not.toBeNull();
    expect(r.querySelectorAll('.tl-transport').length).toBe(1);
    expect(r.querySelector('.tl-foot')).toBeNull();
    expect(r.querySelector('.fnd-toast')).toBeNull();
    expect(r.querySelector('.fnd-pop')).toBeNull();
    expect(r.querySelector('.fnd-chips')).toBeNull();
    /* The readings are one line, and Why? is on it. */
    expect(bar?.querySelector('.sb-ro')?.textContent).toMatch(/Outcome/);
    expect(bar?.querySelector('.sb-why')).not.toBeNull();
  });

  it('opens the findings from the count on the bar, and closes them again', async () => {
    crash();
    const r = mount();
    await tick();
    const chip = r.querySelector<HTMLButtonElement>('.sb-chip') as HTMLButtonElement;
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(r.querySelector('.sb-pop-findings')).toBeNull();
    chip.click();
    await tick();
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(r.querySelector('.sb-pop-findings .issue')).not.toBeNull();
    expect(r.querySelector('#sb-findings')?.getAttribute('aria-label')).toBe('Validation findings');
    chip.click();
    await tick();
    expect(r.querySelector('.sb-pop-findings')).toBeNull();
  });

  it('opens the colour key and the Application\'s view from the (i)', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.tl-legend')).toBeNull();
    r.querySelector<HTMLButtonElement>('.sb-ico')!.click();
    await tick();
    const key = r.querySelector('.sb-pop-key');
    expect(key?.querySelectorAll('i').length).toBeGreaterThan(3);
    expect(key?.querySelector('.sb-app-btn')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('says the run\'s headline as a line of its own, not in the lanes', async () => {
    crash();
    const r = mount();
    await tick();
    const line = r.querySelector('.tl-headline');
    expect(line).not.toBeNull();
    /* A failover's headline is the equation (timeline/RunHeadline.tsx): the sentence is its
       tooltip, and the equation opens with the same lead. */
    const sentence = line?.getAttribute('title') ?? '';
    expect(line?.textContent?.startsWith(sentence.split(' — ')[0]!)).toBe(true);
    expect([...r.querySelectorAll('.tl-svg .t-top')].some((t) => t.textContent === sentence)).toBe(false);
    /* The lanes are drawn at the full scale. */
    const bg = r.querySelector('.ln-svg .lane-bg');
    expect(Number(bg?.getAttribute('height'))).toBe(TL_FULL.laneH);
  });

  it('draws the timeline the bar is driving: dropping an event keeps the axis, and the bar can fit it', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.sb-fit')).toBeNull();
    const ev = r.querySelector<SVGGElement>('.tl-event-drag');
    expect(ev).not.toBeNull();
    ev!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await tick();
    const fit = r.querySelector<HTMLButtonElement>('.sb-bar .sb-fit');
    expect(fit).not.toBeNull();
    fit!.click();
    await tick();
    expect(r.querySelector('.sb-fit')).toBeNull();
  });

  it('has no run to draw in the steady state: the bar without a transport, and the cards to start from', async () => {
    const r = mount();
    await tick();
    expect(r.querySelector('.sb-bar')).not.toBeNull();
    expect(r.querySelector('.sb-bar .tl-transport')).toBeNull();
    expect(r.querySelector('.ln-empty')).not.toBeNull();
    expect(r.querySelector('.ln-tool')).not.toBeNull();
  });

  it('has no pop-out or full-screen button: the full timeline is popped out of Topology', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.ln-view .po-btn')).toBeNull();
    expect(r.querySelector('.ln-view .tl-full-btn')).toBeNull();
  });
});

describe('where it floats, narrow', () => {
  const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const realRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  afterEach(() => {
    if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realRO;
  });

  /* jsdom measures nothing: the observer is a stub and every element is `w` wide. */
  const measured = (w: number): void => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* measured once, on attach */ }
      disconnect(): void { /* nothing to release */ }
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w });
  };

  it('folds the speeds into one select and keeps the core readings when the bar is tight', async () => {
    crash();
    measured(1400);
    const wide = mount();
    await tick();
    expect(wide.querySelectorAll('.sb-bar .tl-tp-speed').length).toBe(5);
    expect(wide.querySelector('.sb-bar .tl-tp-sel')).toBeNull();
    const chipsWide = wide.querySelectorAll('.sb-ro-i').length;
    render(null, wide);
    root = null;
    document.body.innerHTML = '';

    measured(800);
    const r = mount();
    await tick();
    expect(r.querySelectorAll('.sb-bar .tl-tp-speed').length).toBe(0);
    const sel = r.querySelector<HTMLSelectElement>('.sb-bar .tl-tp-sel');
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toEqual(['0.25', '0.5', '1', '2', '4']);
    expect(r.querySelectorAll('.sb-ro-i').length).toBeLessThanOrEqual(chipsWide);
  });
});

describe('the docked fallback', () => {
  it('below 1024 px keeps the drawing and the timeline stacked, with no lanes view', async () => {
    viewport.value = 'compact';
    crash();
    const r = mount();
    await tick();
    expect(app(r).classList.contains('is-float')).toBe(false);
    expect(app(r).classList.contains('bl-lanes')).toBe(false);
    expect(r.querySelector('.ln-view')).toBeNull();
    expect(r.querySelector('.app-stage .topo-svg')).not.toBeNull();
    expect(r.querySelector('.app-dock .tl-slot .tl')).not.toBeNull();
    expect(r.querySelector('[aria-label="Layout"]')).toBeNull();
  });
});

describe('showing the findings', () => {
  it('opens the dropdown on the lanes\' bar, and leaves the rail as it was', async () => {
    railCollapsed.value = true;
    crash();
    const r = mount();
    await tick();
    revealFindings();
    await tick();
    expect(findingsOpen.value).toBe(true);
    expect(railCollapsed.value).toBe(true);
    expect(r.querySelector('.ln-view .sb-pop-findings .issue')).not.toBeNull();
  });
});

describe('the rail, on the way into the lanes', () => {
  it('folds in memory, leaves dg-rail alone, and comes back with the mode', async () => {
    mode.value = 'build';
    const r = mount();
    await tick();
    expect(railCollapsed.value).toBe(false);
    mode.value = 'break';
    await tick();
    expect(railCollapsed.value).toBe(true);
    expect(app(r).classList.contains('rail-shut')).toBe(true);
    expect(memory.has(RAIL_KEY)).toBe(false);
    mode.value = 'build';
    await tick();
    expect(railCollapsed.value).toBe(false);
    expect(memory.has(RAIL_KEY)).toBe(false);
  });

  it('lets the width snap for a fold nobody asked for, and glide for the reader\'s own', async () => {
    mode.value = 'build';
    railSnap.value = false; // a fold in an earlier test may still be letting go
    const r = mount();
    await tick();
    expect(app(r).classList.contains('rail-snap')).toBe(false);
    mode.value = 'break';
    await tick();
    expect(railCollapsed.value).toBe(true);
    expect(app(r).classList.contains('rail-snap')).toBe(true);
    /* It lets go again shortly after, so the reader's own fold animates. */
    await new Promise((res) => setTimeout(res, 400));
    expect(app(r).classList.contains('rail-snap')).toBe(false);
    setRailCollapsed(false);
    await tick();
    expect(app(r).classList.contains('rail-snap')).toBe(false);
  });

  it('is the reader\'s once they open it: it stays open, and is stored as usual', async () => {
    mode.value = 'build';
    mount();
    await tick();
    mode.value = 'break';
    await tick();
    setRailCollapsed(false);
    await tick();
    expect(memory.get(RAIL_KEY)).toBe('0');
    mode.value = 'build';
    await tick();
    expect(railCollapsed.value).toBe(false);
  });

  it('keeps a fold the reader chose beforehand', async () => {
    setRailCollapsed(true);
    mode.value = 'build';
    mount();
    await tick();
    mode.value = 'break';
    await tick();
    mode.value = 'build';
    await tick();
    expect(railCollapsed.value).toBe(true);
    expect(memory.get(RAIL_KEY)).toBe('1');
  });
});

describe('the density of the lanes', () => {
  it('belongs to the model that asked for it: no shared layout to leak', () => {
    crash();
    const t = trace.value!;
    const doc = topology.value;
    const compact = buildTimeline(t, doc, { width: 900, density: 'compact' });
    const full = buildTimeline(t, doc, { width: 900 });
    const again = buildTimeline(t, doc, { width: 900, density: 'compact' });
    expect(compact.layout).toBe(TL_COMPACT);
    expect(full.layout).toBe(TL_FULL);
    expect(full.lanes[0]?.height).toBe(TL_FULL.laneH);
    expect(compact.lanes[0]?.height).toBe(TL_COMPACT.laneH);
    expect(again.lanes.map((l) => l.y)).toEqual(compact.lanes.map((l) => l.y));
    /* The static figures are always at the full scale. */
    expect(buildTimeline(t, doc, { width: 900, pinnedScale: true, density: 'compact' }).layout).toBe(TL_FULL);
  });
});

describe('Topology and Config', () => {
  it('Topology keeps the floating dock, its chips and the banner, with the drawing and no bar', async () => {
    mode.value = 'build';
    const r = mount();
    await tick();
    expect(app(r).classList.contains('is-float')).toBe(true);
    expect(app(r).className).not.toMatch(/bl-/);
    expect(r.querySelector('.app-dock .dock-status .readout')).not.toBeNull();
    expect(r.querySelector('.app-dock .fnd-chips')).not.toBeNull();
    expect(r.querySelector('.fnd-toast')).not.toBeNull();
    expect(r.querySelector('.topo-svg')).not.toBeNull();
    expect(r.querySelector('.sb-bar')).toBeNull();
    expect(r.querySelector('.dock-grip')).toBeNull();
  });

  it('Topology\'s chip opens the popover over the canvas', async () => {
    mode.value = 'build';
    const r = mount();
    await tick();
    r.querySelector<HTMLButtonElement>('button.fnd-chip.t-am')!.click();
    await tick();
    expect(r.querySelector('.fnd-pop .issue')).not.toBeNull();
    expect(r.querySelector('.sb-pop')).toBeNull();
  });

  it('Config is still the docked grid, with no bar', async () => {
    mode.value = 'configure';
    const r = mount();
    await tick();
    expect(app(r).classList.contains('is-float')).toBe(false);
    expect(app(r).className).not.toMatch(/bl-/);
    expect(r.querySelector('.sb-bar')).toBeNull();
    expect(r.querySelector('.app-dock')).not.toBeNull();
  });
});
