/**
 * Break's two layouts -- Split (the drawing above the timeline, one bar between
 * them) and Lanes (each member's card continuing as its lane) -- and the switch
 * between them: the preference behind it, the switch itself, what Split's bar
 * carries, the rail folding on the way into either, the density of the lanes
 * staying with the layout that asked for it, and Build and Configure staying as
 * they were.
 *
 * jsdom lays nothing out, so how the regions sit is pinned in the browser pass
 * (app/design/ui.md, "Break's two layouts"); what is pinned here is the state,
 * the structure and the contract with storage.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { BREAK_LAYOUT_KEY, loadBreakLayout, RAIL_KEY, setBreakLayout, setRailCollapsed } from '@/state/persist';
import { URL_FIELDS } from '@/state/url';
import {
  breakLayout, BREAK_LAYOUT_SUB, findingsOpen, mode, railCollapsed, timelineFull, timelineH, viewport,
} from '@/state/view';
import { App } from '@/ui/App';
import { revealFindings } from '@/ui/IssuePanel';
import { applyTemplate, templates } from '@/ui/break/events';
import { railSnap } from '@/ui/break/split-rail';
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
const switchButtons = (r: HTMLElement): HTMLButtonElement[] =>
  [...r.querySelectorAll<HTMLButtonElement>('.topbar-group [aria-label="Layout"] button')];
const pick = (r: HTMLElement, word: string): void => {
  const b = switchButtons(r).find((x) => x.textContent === word);
  if (!b) throw new Error(`no ${word} button`);
  b.click();
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  breakLayout.value = 'split';
  railCollapsed.value = false;
  timelineH.value = null;
  timelineFull.value = false;
  findingsOpen.value = false;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('the preference', () => {
  it('is Split until told otherwise', () => {
    loadBreakLayout();
    expect(breakLayout.value).toBe('split');
  });

  it('is remembered under dg-break-layout, and a reload reads it back', () => {
    setBreakLayout('lanes');
    expect(memory.get(BREAK_LAYOUT_KEY)).toBe('lanes');
    breakLayout.value = 'split';
    loadBreakLayout();
    expect(breakLayout.value).toBe('lanes');
    setBreakLayout('split');
    loadBreakLayout();
    expect(breakLayout.value).toBe('split');
  });

  it('reads anything else as Split', () => {
    for (const junk of ['', 'A', 'B', 'current', 'LANES', 'stacked', 'null']) {
      breakLayout.value = 'lanes';
      memory.set(BREAK_LAYOUT_KEY, junk);
      loadBreakLayout();
      expect(breakLayout.value, junk).toBe('split');
    }
  });

  it('survives storage that throws', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('denied'); },
    });
    try {
      breakLayout.value = 'lanes';
      loadBreakLayout();
      expect(breakLayout.value).toBe('split');
      setBreakLayout('lanes');
      expect(breakLayout.value).toBe('lanes');
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });

  it('is a reading preference, not an address: no URL key carries it', () => {
    const keys = URL_FIELDS.map((f) => f.k);
    expect(keys).not.toContain('layout');
    expect(keys).not.toContain('variant');
  });
});

describe('the switch', () => {
  it('is in the top bar in Break, left of the release switch, in both layouts, and nowhere else', async () => {
    const r = mount();
    await tick();
    expect(switchButtons(r).map((b) => b.textContent)).toEqual(['Split', 'Lanes']);
    const group = r.querySelector('.topbar-group') as Element;
    const segs = [...group.querySelectorAll(':scope > .seg')];
    expect(segs.map((x) => x.getAttribute('aria-label'))).toEqual(['Layout', 'Oracle release']);
    expect(r.querySelector('.guide')).toBeNull();
    setBreakLayout('lanes');
    await tick();
    expect(switchButtons(r).map((b) => b.textContent)).toEqual(['Split', 'Lanes']);
    for (const m of ['build', 'configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(r.querySelector('[aria-label="Layout"]'), m).toBeNull();
      expect([...r.querySelectorAll('.topbar-group > .seg')].map((x) => x.getAttribute('aria-label')), m)
        .toEqual(['Oracle release']);
    }
  });

  it('is not offered where Break is not floating (the docked fallback)', async () => {
    viewport.value = 'compact';
    const r = mount();
    await tick();
    expect(app(r).classList.contains('is-float')).toBe(false);
    expect(r.querySelector('[aria-label="Layout"]')).toBeNull();
  });

  it('says what each layout is for, and which one is on', async () => {
    const r = mount();
    await tick();
    const [split, lanes] = switchButtons(r) as [HTMLButtonElement, HTMLButtonElement];
    expect(split.title).toBe(BREAK_LAYOUT_SUB.split);
    expect(lanes.title).toBe(BREAK_LAYOUT_SUB.lanes);
    expect(split.title).toMatch(/diagram and the timeline together/);
    expect(lanes.title).toMatch(/row by row/);
    expect(split.getAttribute('aria-pressed')).toBe('true');
    expect(lanes.getAttribute('aria-pressed')).toBe('false');
    expect(r.querySelector('.topbar-group [role="group"][aria-label="Layout"]')).not.toBeNull();
  });

  it('round-trips Split and Lanes live, in the same page, and remembers the last', async () => {
    crash();
    const r = mount();
    await tick();
    const shell = app(r);
    expect(shell.classList.contains('bl-split')).toBe(true);
    expect(r.querySelector('.sb-bar')).not.toBeNull();
    expect(r.querySelector('.ln-view')).toBeNull();

    pick(r, 'Lanes');
    await tick();
    expect(app(r)).toBe(shell);
    expect(shell.classList.contains('bl-lanes')).toBe(true);
    expect(shell.classList.contains('bl-split')).toBe(false);
    expect(r.querySelector('.ln-view')).not.toBeNull();
    /* Lanes' bar is Split's parts on the view's own top edge, not the dock's. */
    expect(r.querySelector('.app-dock .sb-bar')).toBeNull();
    expect(r.querySelector('.ln-view .sb-bar.ln-bar')).not.toBeNull();
    expect(memory.get(BREAK_LAYOUT_KEY)).toBe('lanes');
    expect(switchButtons(r)[1]?.getAttribute('aria-pressed')).toBe('true');

    pick(r, 'Split');
    await tick();
    expect(app(r)).toBe(shell);
    expect(shell.classList.contains('bl-split')).toBe(true);
    expect(r.querySelector('.sb-bar')).not.toBeNull();
    expect(r.querySelector('.ln-view')).toBeNull();
    expect(memory.get(BREAK_LAYOUT_KEY)).toBe('split');
  });

  it('is a real button pair: reachable by keyboard, pressed by Enter and Space', async () => {
    const r = mount();
    await tick();
    for (const b of switchButtons(r)) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('type')).toBe('button');
      expect(b.tabIndex).toBe(0);
    }
  });
});

describe('Split', () => {
  it('has the bar between the regions, with the transport on it, and no floating banner', async () => {
    crash();
    const r = mount();
    await tick();
    const bar = r.querySelector('.sb-bar');
    expect(bar).not.toBeNull();
    expect(bar?.querySelector('.tl-transport')).not.toBeNull();
    /* The transport is not also under the drawing. */
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

  it('says the run\'s headline as a line of its own, not in the drawing', async () => {
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
    /* Lanes are drawn packed. */
    const bg = r.querySelector('.tl-svg .lane-bg');
    expect(Number(bg?.getAttribute('height'))).toBe(TL_COMPACT.laneH);
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
    /* Not a second Fit button floating over the lanes. */
    expect(r.querySelector('.tl-slot button')).toBeNull();
    fit!.click();
    await tick();
    expect(r.querySelector('.sb-fit')).toBeNull();
  });

  it('has no run to draw in the steady state, and says so', async () => {
    const r = mount();
    await tick();
    expect(r.querySelector('.sb-bar')).not.toBeNull();
    expect(r.querySelector('.sb-bar .tl-transport')).toBeNull();
    expect(r.querySelector('.tl-slot .empty')?.textContent).toMatch(/No events yet/);
    expect(r.querySelector('.app-dock')?.classList.contains('has-tl')).toBe(false);
  });

  it('keeps full screen and the pop-out on the bar', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.sb-bar .tl-full-btn')).not.toBeNull();
    expect(r.querySelector('.sb-bar .po-btn')).not.toBeNull();
    r.querySelector<HTMLButtonElement>('.tl-full-btn')!.click();
    await tick();
    expect(app(r).classList.contains('tl-full')).toBe(true);
    /* Nothing left to resize while it fills the window. */
    expect(r.querySelector('.sb-bar .dock-grip')).toBeNull();
  });

  /* jsdom has no `onpointerdown` on an element, so preact listens for the
     unlowercased name; ask the element the way preact did (canvas-zoom.test.ts). */
  const ptr = (el: Element, kind: 'down' | 'move' | 'up', y: number): void => {
    const lower = `pointer${kind}`;
    const type = `on${lower}` in el ? lower : `Pointer${kind[0]!.toUpperCase()}${kind.slice(1)}`;
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));
  };

  it('is dragged by the bar: up makes the region taller, and the end is what is remembered', async () => {
    crash();
    const r = mount();
    await tick();
    const bar = r.querySelector<HTMLElement>('.sb-bar') as HTMLElement;
    ptr(bar, 'down', 600);
    ptr(bar, 'move', 598);
    /* A press that has not moved is still a click. */
    expect(timelineH.value).toBeNull();
    ptr(bar, 'move', 500);
    const dragged = timelineH.value;
    expect(dragged).not.toBeNull();
    expect(memory.has('dg-tl-h')).toBe(false);
    ptr(bar, 'up', 500);
    expect(memory.get('dg-tl-h')).toBe(String(dragged));
    ptr(bar, 'down', 600);
    ptr(bar, 'move', 640);
    expect(timelineH.value).toBeLessThan(dragged as number);
    ptr(bar, 'up', 640);
    /* Double-click resets it. */
    bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(timelineH.value).toBeNull();
  });

  it('is not dragged by a press on a button of the bar', async () => {
    crash();
    const r = mount();
    await tick();
    const bar = r.querySelector<HTMLElement>('.sb-bar') as HTMLElement;
    const btn = bar.querySelector('button') as HTMLElement;
    ptr(btn, 'down', 600);
    ptr(btn, 'move', 300);
    expect(timelineH.value).toBeNull();
  });
});

describe('Split, narrow', () => {
  const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const realRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  afterEach(() => {
    if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realRO;
  });

  it('folds the speeds into one select and keeps the core readings when the bar is tight', async () => {
    crash();
    const wide = mount();
    await tick();
    expect(wide.querySelectorAll('.sb-bar .tl-tp-speed').length).toBe(5);
    expect(wide.querySelector('.sb-bar .tl-tp-sel')).toBeNull();
    const chipsWide = wide.querySelectorAll('.sb-ro-i').length;
    render(null, wide);
    root = null;
    document.body.innerHTML = '';

    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* measured once, on attach */ }
      disconnect(): void { /* nothing to release */ }
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    const r = mount();
    await tick();
    expect(r.querySelectorAll('.sb-bar .tl-tp-speed').length).toBe(0);
    const sel = r.querySelector<HTMLSelectElement>('.sb-bar .tl-tp-sel');
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toEqual(['0.25', '0.5', '1', '2', '4']);
    expect(r.querySelectorAll('.sb-ro-i').length).toBeLessThanOrEqual(chipsWide);
  });
});

describe('showing the findings', () => {
  it('opens the dropdown on Split\'s bar', async () => {
    crash();
    const r = mount();
    await tick();
    revealFindings();
    await tick();
    expect(findingsOpen.value).toBe(true);
    expect(r.querySelector('.sb-pop-findings .issue')).not.toBeNull();
  });

  it('opens the dropdown on Lanes\' bar too, and leaves the rail as it was', async () => {
    breakLayout.value = 'lanes';
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

describe('the rail, on the way into Split', () => {
  it('folds in memory, leaves dg-rail alone, and comes back with the layout', async () => {
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

  it('folds for Lanes too, and a switch between Lanes and Split never touches it', async () => {
    breakLayout.value = 'lanes';
    const r = mount();
    await tick();
    expect(railCollapsed.value).toBe(true);
    expect(app(r).classList.contains('rail-shut')).toBe(true);
    /* Round trips: one flag for both layouts, so the rail is never unfolded in between. */
    const seen: boolean[] = [];
    const stop = railCollapsed.subscribe((v) => seen.push(v));
    for (const word of ['Split', 'Lanes', 'Split', 'Lanes']) {
      pick(r, word);
      await tick();
      expect(railCollapsed.value, word).toBe(true);
      expect(app(r).classList.contains('rail-shut'), word).toBe(true);
    }
    stop();
    expect(seen.every((v) => v)).toBe(true);
    expect(memory.has(RAIL_KEY)).toBe(false);
    /* Leaving Break hands the rail back as it was. */
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
    breakLayout.value = 'lanes';
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

  it('is the reader\'s once they open it inside Lanes: it stays open across a switch, stored as usual', async () => {
    breakLayout.value = 'lanes';
    const r = mount();
    await tick();
    setRailCollapsed(false);
    await tick();
    expect(memory.get(RAIL_KEY)).toBe('0');
    pick(r, 'Split');
    await tick();
    expect(railCollapsed.value).toBe(false);
    mode.value = 'build';
    await tick();
    expect(railCollapsed.value).toBe(false);
  });

  it('is the reader\'s once they open it inside Split: it stays open, and is stored as usual', async () => {
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

  it('follows the layout on screen through a switch and back', async () => {
    crash();
    const r = mount();
    await tick();
    const laneH = (sel: string): number => Number(r.querySelector(`${sel} .lane-bg`)?.getAttribute('height'));
    expect(laneH('.tl-svg')).toBe(TL_COMPACT.laneH);
    pick(r, 'Lanes');
    await tick();
    expect(laneH('.ln-svg')).toBe(TL_FULL.laneH);
    pick(r, 'Split');
    await tick();
    expect(laneH('.tl-svg')).toBe(TL_COMPACT.laneH);
    pick(r, 'Lanes');
    await tick();
    expect(laneH('.ln-svg')).toBe(TL_FULL.laneH);
  });
});

describe('Build and Configure', () => {
  it('keep the floating dock, its chips and the banner, whichever layout Break is in', async () => {
    for (const layout of ['split', 'lanes'] as const) {
      breakLayout.value = layout;
      mode.value = 'build';
      const r = mount();
      await tick();
      expect(app(r).classList.contains('is-float'), layout).toBe(true);
      expect(app(r).className, layout).not.toMatch(/bl-/);
      expect(r.querySelector('.app-dock .dock-status .readout'), layout).not.toBeNull();
      expect(r.querySelector('.app-dock .fnd-chips'), layout).not.toBeNull();
      expect(r.querySelector('.fnd-toast'), layout).not.toBeNull();
      expect(r.querySelector('.sb-bar'), layout).toBeNull();
      expect(r.querySelector('[aria-label="Layout"]'), layout).toBeNull();
      expect(r.querySelector('.dock-grip'), layout).toBeNull();
      render(null, r);
      document.body.innerHTML = '';
    }
    root = null;
  });

  it('Build\'s chip opens the popover over the canvas', async () => {
    mode.value = 'build';
    const r = mount();
    await tick();
    r.querySelector<HTMLButtonElement>('button.fnd-chip.t-am')!.click();
    await tick();
    expect(r.querySelector('.fnd-pop .issue')).not.toBeNull();
    expect(r.querySelector('.sb-pop')).toBeNull();
  });

  it('Configure is still the docked grid, with no bar', async () => {
    mode.value = 'configure';
    const r = mount();
    await tick();
    expect(app(r).classList.contains('is-float')).toBe(false);
    expect(app(r).className).not.toMatch(/bl-/);
    expect(r.querySelector('.sb-bar')).toBeNull();
    expect(r.querySelector('.app-dock')).not.toBeNull();
  });
});
