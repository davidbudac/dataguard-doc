/**
 * The Detailed timeline's run summary: the band of cards under the bar,
 * and the fold that stands where the terse line stands.
 *
 * Folded to start with -- the bar is what it always was, with a "Summary"
 * button beside the line. The button and a click on the line unfold it; a
 * click on a button inside the line ("Why?") does not. Unfolded, the line gives
 * way to a spacer, the button reads "Summary" with the other chevron, and the
 * cards sit between the bar and the rows. With
 * no run there is neither. The state is remembered under `dg-summary`.
 *
 * Also here: the Split brain chip as the cards and the readout carry it.
 *
 * jsdom lays nothing out, so how the cards wrap is pinned in the browser pass
 * (app/design/ui.md, "Break's two layouts"); what is pinned here is the state,
 * the structure and the contract with storage.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { CLASSIC_IDS, classicTopology, hostId } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { readout, readoutFor, trace, topology } from '@/state/derived';
import { loadSummaryOpen, setSummaryOpen, SUMMARY_KEY } from '@/state/persist';
import {
  findingsOpen, mode, railCollapsed, summaryOpen, viewport,
} from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { explanationOpen } from '@/ui/break/RunExplanation';
import { SUMMARY_ID } from '@/ui/break/SummaryBand';

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
const mount = async (): Promise<HTMLElement> => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  await tick();
  return root;
};

const crash = (): void => {
  const t = templates(topology.value, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  applyTemplate(t);
};

const CLASSIC = classicTopology({ observerLoc: 'dc3' });
const SBY = CLASSIC_IDS.standby;
const isolate: TimedEvent[] = [
  { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 },
  { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc3 },
];
const stopObserver: TimedEvent[] = [{ at: 0, kind: 'observer.stop', observer: CLASSIC_IDS.observer }];

const load = (d: TopologyDoc, events: TimedEvent[]): void => {
  resetHistory(makeDoc({ ...d, events }));
};
const fsfoOff = (): TopologyDoc => ({ ...CLASSIC, config: { ...CLASSIC.config, fsfo: { ...CLASSIC.config.fsfo, state: 'disabled' } } });

const band = (r: HTMLElement): HTMLElement | null => r.querySelector('.rs-band');
const toggle = (r: HTMLElement): HTMLButtonElement | null => r.querySelector('.rs-tog');
const line = (r: HTMLElement): HTMLElement | null => r.querySelector('.sb-bar .sb-ro');
const cards = (r: HTMLElement): HTMLElement[] => [...r.querySelectorAll<HTMLElement>('.rs-band .rs-card')];
const card = (r: HTMLElement, id: string): HTMLElement | null => r.querySelector(`.rs-band .rs-card[data-chip="${id}"]`);
const chips = (): string[] => readout.value.filter((c) => c.id !== 'findings').map((c) => c.k);

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  railCollapsed.value = false;
  findingsOpen.value = false;
  explanationOpen.value = false;
  summaryOpen.value = false;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('the preference', () => {
  it('is folded until told otherwise', () => {
    loadSummaryOpen();
    expect(summaryOpen.value).toBe(false);
  });

  it('is remembered under dg-summary, and a reload reads it back', () => {
    setSummaryOpen(true);
    expect(memory.get(SUMMARY_KEY)).toBe('1');
    expect(SUMMARY_KEY).toBe('dg-summary');
    summaryOpen.value = false;
    loadSummaryOpen();
    expect(summaryOpen.value).toBe(true);
    setSummaryOpen(false);
    expect(memory.get(SUMMARY_KEY)).toBe('0');
    summaryOpen.value = true;
    loadSummaryOpen();
    expect(summaryOpen.value).toBe(false);
  });

  it('reads anything but 1 as folded', () => {
    for (const junk of ['', '0', 'true', 'yes', 'open', 'null']) {
      summaryOpen.value = true;
      memory.set(SUMMARY_KEY, junk);
      loadSummaryOpen();
      expect(summaryOpen.value, junk).toBe(false);
    }
  });

  it('survives storage that throws', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    try {
      summaryOpen.value = true;
      loadSummaryOpen();
      expect(summaryOpen.value).toBe(false);
      setSummaryOpen(true);
      expect(summaryOpen.value).toBe(true);
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('in the Detailed timeline', () => {
  const barSel = '.ln-bar';
  const belowSel = '.ln-body';

  describe('folded, which is where a new reader starts', () => {
    it('shows the terse line as it was, with a Summary button beside it and no band', async () => {
      crash();
      const r = await mount();
      expect(band(r)).toBeNull();
      expect(line(r)?.textContent).toMatch(/New primary open/);
      expect(r.querySelector(`${barSel} .ln-vd-v`)?.textContent).toBe('failover');
      expect(r.querySelector(`${barSel} .sb-why`)).not.toBeNull();
      const t = toggle(r);
      expect(t).not.toBeNull();
      expect(t?.getAttribute('aria-expanded')).toBe('false');
      expect(t?.getAttribute('aria-controls')).toBe(SUMMARY_ID);
      expect(t?.textContent).toBe('Summary ▾');
      /* The button is in the bar, and the line is in the same place it was: before the findings chip. */
      expect(t?.closest(barSel)).not.toBeNull();
      expect(r.querySelector(`${barSel} .rs-host .rs-hit .sb-ro`)).not.toBeNull();
    });
  });

  describe('unfolding', () => {
    it('the button does it, and the button undoes it', async () => {
      crash();
      const r = await mount();
      toggle(r)!.click();
      await tick();
      expect(band(r)).not.toBeNull();
      expect(summaryOpen.value).toBe(true);
      expect(toggle(r)?.getAttribute('aria-expanded')).toBe('true');
      expect(toggle(r)?.textContent).toBe('▴ Summary');
      expect(band(r)?.id).toBe(SUMMARY_ID);
      expect(band(r)?.getAttribute('aria-label')).toBe('Run summary');
      toggle(r)!.click();
      await tick();
      expect(band(r)).toBeNull();
      expect(summaryOpen.value).toBe(false);
      expect(line(r)).not.toBeNull();
    });

    it('a click on the terse line does it too', async () => {
      crash();
      const r = await mount();
      line(r)!.click();
      await tick();
      expect(band(r)).not.toBeNull();
      expect(summaryOpen.value).toBe(true);
    });

    it('a click on one of the line\'s readings does it too', async () => {
      crash();
      const r = await mount();
      r.querySelector<HTMLElement>('.sb-ro .sb-ro-v')!.click();
      await tick();
      expect(band(r)).not.toBeNull();
    });

    it('a click on Why? inside the line opens the explanation and leaves the band folded', async () => {
      crash();
      const r = await mount();
      r.querySelector<HTMLButtonElement>(`${barSel} .sb-why`)!.click();
      await tick();
      expect(explanationOpen.value).toBe(true);
      expect(band(r)).toBeNull();
      expect(summaryOpen.value).toBe(false);
      expect(memory.has(SUMMARY_KEY)).toBe(false);
    });

    it('leaves a room for the bar\'s other controls: the line gives way to a spacer', async () => {
      crash();
      const r = await mount();
      const before = [...r.querySelectorAll(`${barSel} > *`)].map((el) => el.className);
      toggle(r)!.click();
      await tick();
      expect(line(r)).toBeNull();
      expect(r.querySelector(`${barSel} .rs-fill`)).not.toBeNull();
      /* The verdict and its Why? stay: the band repeats the readings, not the headline. */
      expect(r.querySelector(`${barSel} .sb-why`)).not.toBeNull();
      const after = [...r.querySelectorAll(`${barSel} > *`)].map((el) => el.className);
      expect(after).toEqual(before);
      expect(r.querySelector(`${barSel} .sb-chip`)).not.toBeNull();
    });
  });

  describe('the band', () => {
    it('sits directly under the bar and above the timeline', async () => {
      crash();
      setSummaryOpen(true);
      const r = await mount();
      const b = band(r) as HTMLElement;
      const bar = r.querySelector(barSel) as HTMLElement;
      const below = r.querySelector(belowSel) as HTMLElement;
      expect(bar.nextElementSibling).toBe(b);
      /* The bar and the band share a head, and the lanes' body follows it at once: there is
         no settings column or row between them. (The band hangs under the bar over the body,
         lanes.css `.ln-head`, rather than pushing it down.) */
      expect(bar.parentElement).toBe(b.parentElement);
      expect(b.parentElement?.className).toBe('ln-head');
      expect(b.parentElement?.nextElementSibling).toBe(below);
    });

    it('carries the terse line\'s readings, and only those: the readout without the findings chip', async () => {
      crash();
      setSummaryOpen(true);
      const r = await mount();
      expect(cards(r).map((c) => c.querySelector('.rs-k')?.textContent)).toEqual(chips());
      expect(cards(r).map((c) => c.dataset.chip)).not.toContain('findings');
      expect(cards(r).length).toBeGreaterThan(3);
    });

    it('shows every card whole: the eyebrow, the value with its unit, and the sentence', async () => {
      crash();
      setSummaryOpen(true);
      const r = await mount();
      for (const c of readout.value.filter((x) => x.id !== 'findings')) {
        const el = card(r, c.id) as HTMLElement;
        expect(el, c.id).not.toBeNull();
        expect(el.querySelector('.rs-k')?.textContent).toBe(c.k);
        expect(el.querySelector('.rs-v')?.textContent).toBe(c.v);
        expect(el.querySelector('.rs-u')?.textContent ?? '').toBe(c.unit ?? '');
        expect(el.querySelector('.rs-sub')?.textContent).toBe(c.sub);
        expect(el.classList.contains(`t-${c.tone}`), c.id).toBe(true);
      }
    });

    it('marks the model\'s readings, and only those, the way the rest of the page does', async () => {
      crash();
      setSummaryOpen(true);
      const r = await mount();
      for (const c of readout.value.filter((x) => x.id !== 'findings')) {
        const marker = card(r, c.id)?.querySelector('.fact');
        if (c.basis !== undefined && c.basis !== 'documented') {
          expect(marker, c.id).not.toBeNull();
          expect(marker?.classList.contains(`b-${c.basis}`)).toBe(true);
          expect(marker?.textContent).toBe(c.basis === 'model' ? 'this page\'s model' : marker?.textContent);
        } else {
          expect(marker, c.id).toBeNull();
        }
      }
      expect(r.querySelectorAll('.rs-band .fact.b-model').length).toBeGreaterThan(0);
    });

    it('has Why? on the outcome card, and only there; it opens the explanation', async () => {
      crash();
      setSummaryOpen(true);
      const r = await mount();
      const whys = [...r.querySelectorAll<HTMLButtonElement>('.rs-band .rs-why')];
      expect(whys.length).toBe(1);
      expect(card(r, 'outcome')?.contains(whys[0]!)).toBe(true);
      whys[0]!.click();
      await tick();
      expect(explanationOpen.value).toBe(true);
    });

    it('follows the run: another event, another set of cards', async () => {
      crash();
      setSummaryOpen(true);
      const r = await mount();
      const before = cards(r).map((c) => c.dataset.chip);
      load(CLASSIC, stopObserver);
      await tick();
      expect(card(r, 'outcome')?.querySelector('.rs-v')?.textContent).toBe('no observer');
      expect(cards(r).map((c) => c.dataset.chip)).not.toEqual(before);
    });
  });

  describe('with no run', () => {
    it('is the bar and the line as before: no button, no band, even if it was left unfolded', async () => {
      setSummaryOpen(true);
      const r = await mount();
      expect(trace.value).toBeNull();
      expect(band(r)).toBeNull();
      expect(toggle(r)).toBeNull();
      expect(r.querySelector('.rs-hit')).toBeNull();
      expect(r.querySelector(`${barSel} .sb-ro`)).not.toBeNull();
    });

    it('is back, unfolded as it was left, when a run appears', async () => {
      setSummaryOpen(true);
      const r = await mount();
      expect(band(r)).toBeNull();
      crash();
      await tick();
      expect(band(r)).not.toBeNull();
      expect(toggle(r)?.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('remembered', () => {
    it('writes dg-summary when it is unfolded and folded, and a remount reads it back', async () => {
      crash();
      const r = await mount();
      toggle(r)!.click();
      await tick();
      expect(memory.get(SUMMARY_KEY)).toBe('1');
      render(null, r);
      root = null;
      document.body.innerHTML = '';
      summaryOpen.value = false;
      loadSummaryOpen();
      const again = await mount();
      expect(band(again)).not.toBeNull();
      toggle(again)!.click();
      await tick();
      expect(memory.get(SUMMARY_KEY)).toBe('0');
      expect(band(again)).toBeNull();
    });
  });
});

/* ---------------- the Split brain reading, as the cards and the readout carry it ---------------- */

const failoverAfterIsolation = (): TimedEvent[] => [...isolate, { at: 5, kind: 'cmd.failover', to: SBY }];

describe('the Split brain reading', () => {
  const chip = (steady = false) => readoutFor(steady).find((c) => c.id === 'split');

  it('is a no, in the healthy colour, where the old primary aborts before the new one opens', () => {
    load(CLASSIC, isolate);
    const c = chip();
    expect(c).toMatchObject({ k: 'Split brain', v: 'no', tone: 'tl', basis: 'model' });
    expect(c?.sub).toMatch(/^prm01 aborts at 30 s, before sby01 opens at \d+(\.\d)? s\.$/);
  });

  it('is a no where the old primary is down', () => {
    load(CLASSIC, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(chip()).toMatchObject({ v: 'no', tone: 'tl' });
    expect(chip()?.sub).toMatch(/^prm01 is down when sby01 opens at \d+ s, so only one database is ever open read-write\.$/);
  });

  it('is a no, and says so, where the old primary is STALLED and nothing shuts it down', () => {
    load(classicTopology({ observerLoc: 'dc3', pmyShutdown: false }), isolate);
    expect(chip()).toMatchObject({ v: 'no', tone: 'tl' });
    expect(chip()?.sub).toMatch(/^prm01 is STALLED when sby01 opens at \d+ s, and nothing shuts it down/);
  });

  it('is a no where the old primary was down and restarts mounted', () => {
    load(fsfoOff(), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: SBY },
      { at: 100, kind: 'host.up', host: hostId('dc1-prm01') },
    ]);
    expect(chip()).toMatchObject({ v: 'no', tone: 'tl' });
    expect(chip()?.sub).toMatch(/^prm01 is down when sby01 opens at \d+ s/);
  });

  it('is a yes, naming the window, where the old primary is still open and the new one can reach it', () => {
    load(fsfoOff(), [{ at: 0, kind: 'cmd.failover', to: SBY }]);
    expect(chip()).toMatchObject({ v: 'yes', tone: 'rd', basis: 'model' });
    expect(chip()?.sub).toMatch(/^prm01 and sby01 are both open read-write from \d+ s to the end of the run: prm01 is still open when sby01 opens at \d+ s/);
  });

  it('is a no where fast-start failover is enabled: the old primary has lost its target and stalls, then shuts down (owner decision D5)', () => {
    load(CLASSIC, [{ at: 0, kind: 'cmd.failover', to: SBY }]);
    expect(chip()).toMatchObject({ v: 'no', tone: 'tl', basis: 'model' });
    expect(chip()?.sub).toMatch(/^prm01 is STALLED when sby01 opens at \d+ s and cannot commit; it shuts itself down at \d+ s\.$/);
  });

  it('closes the window where the old primary is taken down later', () => {
    load(fsfoOff(), [
      { at: 0, kind: 'cmd.failover', to: SBY },
      { at: 60, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(chip()).toMatchObject({ v: 'yes', tone: 'rd' });
    expect(chip()?.sub).toMatch(/^prm01 and sby01 are both open read-write from \d+ s to 60 s: prm01 is still open when sby01 opens at \d+ s/);
  });

  it('is a yes, in red, naming the window both were open, where nothing can tell the old primary', () => {
    load(fsfoOff(), failoverAfterIsolation());
    const c = chip();
    expect(c).toMatchObject({ k: 'Split brain', v: 'yes', tone: 'rd', basis: 'model' });
    expect(c?.sub).toMatch(/^prm01 and sby01 are both open read-write from 30 s to the end of the run: prm01 is still open when sby01 opens at 30 s/);
    expect(c?.cite?.length).toBeGreaterThan(0);
  });

  it('branches on what is drawn, never on the event: the same failover is a no where the old primary is armed', () => {
    load(CLASSIC, failoverAfterIsolation());
    expect(chip()?.v).toBe('no');
  });

  it('is absent where nothing fails over', () => {
    load(CLASSIC, stopObserver);
    expect(trace.value?.facts.newPrimary).toBeNull();
    expect(chip()).toBeUndefined();
  });

  it('is absent from a switchover, from a refused failover and from the steady state', () => {
    load(CLASSIC, [{ at: 0, kind: 'cmd.switchover', to: SBY }]);
    expect(chip()).toBeUndefined();
    load(fsfoOff(), [{ at: 0, kind: 'cmd.switchover', to: SBY }]);
    expect(chip()).toBeUndefined();
    load(CLASSIC, [
      { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 },
      { at: 100, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(chip()).toBeUndefined();
    load(CLASSIC, isolate);
    expect(chip(true)).toBeUndefined();
    resetHistory(classicDoc());
    expect(readoutFor(true).find((c) => c.id === 'split')).toBeUndefined();
  });

  it('comes after the primary\'s shutdown and before the observer, and the findings chip stays last', () => {
    load(CLASSIC, isolate);
    const ids = readoutFor(false).map((c) => c.id);
    expect(ids.indexOf('split')).toBe(ids.indexOf('abort') + 1);
    expect(ids.indexOf('split')).toBeLessThan(ids.indexOf('observer'));
    expect(ids.at(-1)).toBe('findings');
  });

  it('is a card in the band, red for a yes and with the model\'s marker', async () => {
    load(fsfoOff(), failoverAfterIsolation());
    setSummaryOpen(true);
    const r = await mount();
    const el = card(r, 'split') as HTMLElement;
    expect(el.querySelector('.rs-k')?.textContent).toBe('Split brain');
    expect(el.querySelector('.rs-v')?.textContent).toBe('yes');
    expect(el.classList.contains('t-rd')).toBe(true);
    expect(el.querySelector('.fact.b-model')).not.toBeNull();
    expect(el.querySelector('.rs-sub')?.textContent).toContain('both open read-write');
  });
});
