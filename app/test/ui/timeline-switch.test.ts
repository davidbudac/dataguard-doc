/**
 * Simulate's two timelines -- Configuration and Application -- the switch
 * between them, and the connect-string strip the Application one carries.
 *
 * What is pinned: the preference and its storage, that the switch exists only
 * for a drawing with an application, that it swaps the view in each of the
 * three places Simulate draws a timeline (Split's bar, Lanes' bar, the docked
 * slot), that Defaults and Tuned write the four parameters as one undoable
 * edit, that an edit redraws the figure, and that the Config panel still draws
 * the same figure. jsdom lays nothing out; where the switch sits on screen is
 * the browser pass (app/design/ui.md).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { applicationClient, applicationsOf, CLIENT_TIMING_DEFAULTS, CLIENT_TIMING_TUNED, withApplication } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory, undo, undoStack } from '@/state/history';
import { topology } from '@/state/derived';
import { BREAK_TIMELINE_KEY, loadBreakTimeline, setBreakTimeline } from '@/state/persist';
import { URL_FIELDS } from '@/state/url';
import {
  breakApp, breakLayout, breakTimeline, clearSelection, findingsOpen, mode, panelTab, railCollapsed, timelineFull, timelineH, viewport,
} from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { applyClientTiming, patchClient, setOwnClient } from '@/ui/inspector/edits';

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

const crash = (): void => {
  const t = templates(topology.value, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  applyTemplate(t);
};

const client = () => topology.value.client;
const sw = (r: ParentNode): HTMLElement | null => r.querySelector('.seg[aria-label="Timeline"]');
const press = (r: ParentNode, word: string): void => {
  const b = [...(sw(r)?.querySelectorAll('button') ?? [])].find((x) => x.textContent === word);
  if (!b) throw new Error(`no ${word} button`);
  b.click();
};
const pressed = (r: ParentNode): string | undefined =>
  [...(sw(r)?.querySelectorAll('button') ?? [])].find((x) => x.getAttribute('aria-pressed') === 'true')?.textContent ?? undefined;
const button = (r: ParentNode, word: string): HTMLButtonElement => {
  const b = [...r.querySelectorAll('button')].find((x) => x.textContent === word);
  if (!b) throw new Error(`no ${word} button`);
  return b as HTMLButtonElement;
};

const withoutApplication = (): void => {
  const { applications: _none, ...bare } = classicDoc().topology as TopologyDoc;
  resetHistory(makeDoc(bare));
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  breakLayout.value = 'split';
  breakTimeline.value = 'config';
  breakApp.value = null;
  clearSelection();
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
  it('is the configuration timeline until told otherwise', () => {
    loadBreakTimeline();
    expect(breakTimeline.value).toBe('config');
  });

  it('is remembered under dg-break-timeline, and a reload reads it back', () => {
    setBreakTimeline('app');
    expect(memory.get(BREAK_TIMELINE_KEY)).toBe('app');
    breakTimeline.value = 'config';
    loadBreakTimeline();
    expect(breakTimeline.value).toBe('app');
    setBreakTimeline('config');
    loadBreakTimeline();
    expect(breakTimeline.value).toBe('config');
  });

  it('reads anything else as the configuration timeline', () => {
    for (const junk of ['', 'APP', 'application', 'lanes', 'null']) {
      breakTimeline.value = 'app';
      memory.set(BREAK_TIMELINE_KEY, junk);
      loadBreakTimeline();
      expect(breakTimeline.value, junk).toBe('config');
    }
  });

  it('is a reading preference, not an address: no URL key carries it', () => {
    expect(URL_FIELDS.map((f) => f.k)).not.toContain('tl');
  });
});

describe('the switch', () => {
  it('is hidden with no application, and the configuration timeline shows whatever is stored', async () => {
    withoutApplication();
    expect(applicationsOf(topology.value)).toHaveLength(0);
    breakTimeline.value = 'app';
    crash();
    const r = mount();
    await tick();
    expect(sw(r)).toBeNull();
    expect(r.querySelector('.app-tl')).toBeNull();
    expect(r.querySelector('section.tl')).not.toBeNull();
  });

  it('is offered in Simulate only', async () => {
    crash();
    const r = mount();
    await tick();
    expect(sw(r)).not.toBeNull();
    for (const m of ['build', 'configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(sw(r), m).toBeNull();
    }
  });

  it('is two pressed-state buttons, Configuration first, and says which is on', async () => {
    crash();
    const r = mount();
    await tick();
    expect([...sw(r)!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Configuration', 'Application']);
    expect(pressed(r)).toBe('Configuration');
    press(r, 'Application');
    await tick();
    expect(pressed(r)).toBe('Application');
  });

  it('swaps the view in the Split layout, with the switch on the bar', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.sb-bar .seg[aria-label="Timeline"]')).not.toBeNull();
    expect(r.querySelector('section.tl')).not.toBeNull();
    expect(r.querySelector('.app-tl')).toBeNull();
    press(r, 'Application');
    await tick();
    expect(breakTimeline.value).toBe('app');
    expect(memory.get(BREAK_TIMELINE_KEY)).toBe('app');
    expect(r.querySelector('section.tl')).toBeNull();
    expect(r.querySelector('.app-tl .app-tl-strip')).not.toBeNull();
    expect(r.querySelector('.app-tl-fig svg')).not.toBeNull();
    /* The configuration's transport is not the application's. */
    expect(r.querySelector('.sb-bar .tl-transport')).toBeNull();
    press(r, 'Configuration');
    await tick();
    expect(r.querySelector('section.tl')).not.toBeNull();
    expect(r.querySelector('.app-tl')).toBeNull();
    expect(r.querySelector('.sb-bar .tl-transport')).not.toBeNull();
  });

  it('is on the bar with no run yet, and Application shows the steady-state note', async () => {
    const r = mount();
    await tick();
    expect(r.querySelector('.sb-bar .seg[aria-label="Timeline"]')).not.toBeNull();
    press(r, 'Application');
    await tick();
    expect(r.querySelector('.app-tl-strip')).not.toBeNull();
    expect(r.querySelector('.app-tl-fig .empty')?.textContent).toMatch(/Inject an event/);
    expect(r.querySelector('.app-tl-fig svg')).toBeNull();
  });

  it('swaps the view in the Lanes layout, where the stage is the lanes', async () => {
    breakLayout.value = 'lanes';
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.ln-view .ln-bar .seg[aria-label="Timeline"]')).not.toBeNull();
    expect(r.querySelector('.ln-view svg[aria-label="Members and their timelines"]')).not.toBeNull();
    press(r, 'Application');
    await tick();
    expect(r.querySelector('.ln-view svg[aria-label="Members and their timelines"]')).toBeNull();
    expect(r.querySelector('.ln-view .ln-app .app-tl-fig svg')).not.toBeNull();
    press(r, 'Configuration');
    await tick();
    expect(r.querySelector('.ln-view svg[aria-label="Members and their timelines"]')).not.toBeNull();
    expect(r.querySelector('.ln-app')).toBeNull();
  });

  it('swaps the view in the docked timeline, where it has a row of its own', async () => {
    viewport.value = 'compact';
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.app')?.classList.contains('is-float')).toBe(false);
    expect(r.querySelector('.tl-slot > .tl-view-row .seg[aria-label="Timeline"]')).not.toBeNull();
    expect(r.querySelector('.tl-slot section.tl')).not.toBeNull();
    press(r, 'Application');
    await tick();
    expect(r.querySelector('.tl-slot section.tl')).toBeNull();
    expect(r.querySelector('.tl-slot .app-tl-fig svg')).not.toBeNull();
    /* The row stays, so the way back is where the way in was. */
    expect(pressed(r)).toBe('Application');
    press(r, 'Configuration');
    await tick();
    expect(r.querySelector('.tl-slot section.tl')).not.toBeNull();
  });

  it('keeps the configuration timeline\'s own Application\'s view toggle where it was', async () => {
    viewport.value = 'compact';
    crash();
    const r = mount();
    await tick();
    const toggles = [...r.querySelectorAll('.tl-legend button')].filter((b) => /Application/.test(b.textContent ?? ''));
    expect(toggles).toHaveLength(1);
  });
});

describe('Defaults and Tuned', () => {
  const start = () => { patchClient('Set RETRY_COUNT to 7', (c) => ({ ...c, retryCount: 7 })); };

  it('the engine holds the presets, with the parameters\' own defaults for Defaults', () => {
    expect(CLIENT_TIMING_DEFAULTS).toEqual({
      transportConnectTimeoutSeconds: 60, connectTimeoutSeconds: null, retryCount: 0, retryDelaySeconds: 0,
    });
    expect(CLIENT_TIMING_TUNED).toEqual({
      transportConnectTimeoutSeconds: 3, connectTimeoutSeconds: 90, retryCount: 30, retryDelaySeconds: 3,
    });
  });

  it('Tuned writes the four parameters in one edit, and one undo puts them back', () => {
    start();
    const before = client();
    const depth = undoStack.value.length;
    applyClientTiming('tuned');
    expect(undoStack.value.length).toBe(depth + 1);
    expect(client()).toMatchObject(CLIENT_TIMING_TUNED);
    /* Nothing else about the descriptor moves. */
    expect(client().serviceName).toBe(before.serviceName);
    expect(client().addresses).toEqual(before.addresses);
    expect(client().failover).toBe(before.failover);
    expect(client().deadBehaviour).toBe(before.deadBehaviour);
    undo();
    expect(client()).toEqual(before);
  });

  it('Defaults resets them in one edit, CONNECT_TIMEOUT back to not set', () => {
    applyClientTiming('tuned');
    const depth = undoStack.value.length;
    applyClientTiming('defaults');
    expect(undoStack.value.length).toBe(depth + 1);
    expect(client()).toMatchObject(CLIENT_TIMING_DEFAULTS);
    expect(client().connectTimeoutSeconds).toBeNull();
    undo();
    expect(client()).toMatchObject(CLIENT_TIMING_TUNED);
  });

  it('a click that changes nothing leaves no step on the undo stack', () => {
    applyClientTiming('tuned');
    const depth = undoStack.value.length;
    applyClientTiming('tuned');
    expect(undoStack.value.length).toBe(depth);
  });

  it('are on the application strip, pressed while the string holds that set', async () => {
    crash();
    breakTimeline.value = 'app';
    const r = mount();
    await tick();
    const strip = r.querySelector('.app-tl-strip') as HTMLElement;
    expect(button(strip, 'Defaults').getAttribute('aria-pressed')).toBe('true');
    expect(button(strip, 'Tuned').getAttribute('aria-pressed')).toBe('false');
    const depth = undoStack.value.length;
    button(strip, 'Tuned').click();
    await tick();
    expect(undoStack.value.length).toBe(depth + 1);
    expect(client()).toMatchObject(CLIENT_TIMING_TUNED);
    expect(button(strip, 'Tuned').getAttribute('aria-pressed')).toBe('true');
    expect(button(strip, 'Defaults').getAttribute('aria-pressed')).toBe('false');
  });

  it('are in the rail\'s Connect string group too, and do the same', async () => {
    mode.value = 'build';
    const r = mount();
    const application = applicationsOf(topology.value)[0];
    expect(application).toBeDefined();
    const { select } = await import('@/state/view');
    select(application!.id as string);
    await tick();
    const rail = r.querySelector('.insp') as HTMLElement;
    const presets = rail.querySelector('.client-presets') as HTMLElement;
    expect(presets).not.toBeNull();
    button(presets, 'Tuned').click();
    await tick();
    expect(client()).toMatchObject(CLIENT_TIMING_TUNED);
    button(presets, 'Defaults').click();
    await tick();
    expect(client()).toMatchObject(CLIENT_TIMING_DEFAULTS);
  });

  it('are disabled where editing is not allowed', async () => {
    crash();
    breakTimeline.value = 'app';
    viewport.value = 'narrow';
    const r = mount();
    await tick();
    const strip = r.querySelector('.app-tl-strip') as HTMLElement;
    expect(button(strip, 'Defaults').disabled).toBe(true);
    expect(button(strip, 'Tuned').disabled).toBe(true);
    expect([...strip.querySelectorAll<HTMLInputElement>('input')].every((i) => i.disabled)).toBe(true);
  });
});

describe('the strip and the figure', () => {
  it('carries the four timing controls, and an edit redraws the figure', async () => {
    crash();
    breakTimeline.value = 'app';
    const r = mount();
    await tick();
    const strip = r.querySelector('.app-tl-strip') as HTMLElement;
    const names = [...strip.querySelectorAll('input')].map((i) => i.getAttribute('aria-label'));
    expect(names).toEqual(['TRANSPORT_CONNECT_TIMEOUT', 'CONNECT_TIMEOUT', 'RETRY_COUNT', 'RETRY_DELAY']);
    const fig = (): string => (r.querySelector('.app-tl-fig') as HTMLElement).innerHTML;
    const before = fig();
    patchClient('Set TRANSPORT_CONNECT_TIMEOUT to 5 s', (c) => ({ ...c, transportConnectTimeoutSeconds: 5 }));
    await tick();
    expect(fig()).not.toBe(before);
    const tct = strip.querySelector('input[aria-label="TRANSPORT_CONNECT_TIMEOUT"]') as HTMLInputElement;
    expect(tct.value).toBe('5');
  });
});

describe('the Config panel', () => {
  it('still draws the application view, from the same component', async () => {
    crash();
    mode.value = 'configure';
    panelTab.value = 'app';
    const r = mount();
    await tick();
    const panel = r.querySelector('[aria-label="Application view"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.panel-hd .eyebrow')?.textContent).toBe("The application's view");
    expect(panel.querySelector('.panel-body svg')).not.toBeNull();
    /* The connect-string strip belongs to Simulate, not to the panel. */
    expect(panel.querySelector('.app-tl-strip')).toBeNull();
  });

  it('says to inject an event in Simulate mode while there is no run', async () => {
    mode.value = 'configure';
    panelTab.value = 'app';
    const r = mount();
    await tick();
    expect(r.querySelector('[aria-label="Application view"] .empty')?.textContent).toMatch(/Inject an event in Simulate mode/);
  });
});

describe('several applications', () => {
  const two = (): { a: string; b: string } => {
    resetHistory(makeDoc(withApplication(classicDoc().topology as TopologyDoc)));
    const [a, b] = applicationsOf(topology.value).map((x) => x.id as string);
    if (!a || !b) throw new Error('expected two applications');
    setOwnClient(b, true);
    return { a, b };
  };
  const picker = (r: ParentNode): HTMLSelectElement | null =>
    r.querySelector('.app-tl-strip select[aria-label="Application"]');
  const change = async (sel: HTMLSelectElement, v: string): Promise<void> => {
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  };
  const own = (id: string) => applicationClient(topology.value, applicationsOf(topology.value).find((x) => x.id === id)!);

  it('offers the picker only with two or more applications', async () => {
    crash();
    breakTimeline.value = 'app';
    let r = mount();
    await tick();
    expect(applicationsOf(topology.value)).toHaveLength(1);
    expect(r.querySelector('.app-tl-strip')).not.toBeNull();
    expect(picker(r)).toBeNull();
    render(null, r);
    document.body.innerHTML = '';
    two();
    crash();
    r = mount();
    await tick();
    const p = picker(r);
    expect(p).not.toBeNull();
    expect([...p!.options].map((o) => o.textContent)).toEqual(applicationsOf(topology.value).map((x) => x.name));
  });

  it('draws the first application, and choosing another switches the figure to it', async () => {
    const { a, b } = two();
    patchClient('Shorten b', (c) => ({ ...c, transportConnectTimeoutSeconds: 5 }), undefined, b);
    crash();
    breakTimeline.value = 'app';
    const r = mount();
    await tick();
    const p = picker(r)!;
    expect(p.value).toBe(a);
    const figs = (): number => r.querySelectorAll('.app-tl-fig .app-fig').length;
    expect(figs()).toBe(1);
    const first = (r.querySelector('.app-tl-fig') as HTMLElement).innerHTML;
    await change(p, b);
    expect(picker(r)!.value).toBe(b);
    expect(figs()).toBe(1);
    expect((r.querySelector('.app-tl-fig') as HTMLElement).innerHTML).not.toBe(first);
  });

  it('follows an application selected on the canvas', async () => {
    const { b } = two();
    crash();
    breakTimeline.value = 'app';
    const { select } = await import('@/state/view');
    select(b);
    const r = mount();
    await tick();
    expect(picker(r)!.value).toBe(b);
  });

  it('presets edit only the chosen application, as one undo step', async () => {
    const { a, b } = two();
    crash();
    breakTimeline.value = 'app';
    const r = mount();
    await tick();
    await change(picker(r)!, b);
    const sharedBefore = { ...client() };
    const ownBefore = { ...own(b) };
    const depth = undoStack.value.length;
    const strip = r.querySelector('.app-tl-strip') as HTMLElement;
    button(strip, 'Tuned').click();
    await tick();
    expect(undoStack.value.length).toBe(depth + 1);
    expect(own(b)).toMatchObject(CLIENT_TIMING_TUNED);
    expect(own(a)).toEqual(sharedBefore);
    expect(client()).toEqual(sharedBefore);
    undo();
    expect(own(b)).toEqual(ownBefore);
    expect(own(a)).toEqual(sharedBefore);
  });

  it('a first application on the shared string edits the shared string, and only that', async () => {
    const { a, b } = two();
    crash();
    breakTimeline.value = 'app';
    const r = mount();
    await tick();
    const ownBefore = { ...own(b) };
    button(r.querySelector('.app-tl-strip') as HTMLElement, 'Tuned').click();
    await tick();
    expect(own(a)).toMatchObject(CLIENT_TIMING_TUNED);
    expect(client()).toMatchObject(CLIENT_TIMING_TUNED);
    expect(own(b)).toEqual(ownBefore);
  });
});
