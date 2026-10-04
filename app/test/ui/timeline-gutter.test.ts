/**
 * The timeline's gutter says what kind of thing each lane is: the canvas
 * card's own icon in front of the name, so a database, an observer and the
 * application do not read as peers. The glyphs are the card's (one set,
 * `common/glyphs.tsx`); this pins which lane gets which, in both densities.
 *
 * @vitest-environment jsdom
 */

import { h, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { classicTopology, scenarioEvents, simulate } from '@/engine';
import { presetDoc } from '@/presets';
import type { TopologyDoc } from '@/engine';
import { Timeline } from '@/ui/timeline/Timeline';
import { buildTimeline, elideTo, TL_COMPACT, TL_FULL } from '@/ui/timeline/build';

let root: HTMLElement | null = null;
afterEach(() => { if (root) render(null, root); root?.remove(); root = null; });

function draw(density: 'full' | 'compact'): { doc: TopologyDoc; el: HTMLElement } {
  /* the preset has the application; the bare topology does not */
  const events = scenarioEvents('crash', presetDoc('classic'));
  const doc: TopologyDoc = { ...presetDoc('classic'), events };
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(Timeline, { trace: simulate(doc, events), doc, width: 1000, tNow: 0, density }), root);
  return { doc, el: root };
}

const iconOf = (el: HTMLElement, lane: string): Element | null =>
  el.querySelector(`[data-lane="${lane}"] .tl-lane-ico use`);

describe.each(['compact', 'full'] as const)('the gutter (%s)', (density) => {
  it('gives a database, an observer and the application their own icon', () => {
    const { el } = draw(density);
    expect(iconOf(el, 'prm01')?.getAttribute('href')).toBe('#tl-ico-db');
    expect(iconOf(el, 'sby01')?.getAttribute('href')).toBe('#tl-ico-db');
    expect(iconOf(el, 'obs01')?.getAttribute('href')).toBe('#tl-ico-observer');
    /* the application's icon heads its section */
    expect(el.querySelector('.tl-app-head use')?.getAttribute('href')).toBe('#tl-ico-app');
  });

  it('tints by role as the card does, and marks P, S and the master observer', () => {
    const { el } = draw(density);
    expect(iconOf(el, 'prm01')?.getAttribute('class')).toContain('is-primary');
    expect(iconOf(el, 'sby01')?.getAttribute('class')).toContain('is-standby');
    expect(iconOf(el, 'obs01')?.getAttribute('class')).toContain('is-observer');
    const mark = (lane: string): string | null =>
      el.querySelector(`[data-lane="${lane}"] .tl-ico-mark text`)?.textContent ?? null;
    expect(mark('prm01')).toBe('P');
    expect(mark('sby01')).toBe('S');
    expect(mark('obs01')).toBe('M');
  });

  it("gives each of the application's three lanes the application's icon, in the icon column", () => {
    const { el } = draw(density);
    const rows = [...el.querySelectorAll<SVGGElement>('[data-lane="app01"]')]
      .filter((g) => g.querySelector('.t-lane-app') !== null);
    expect(rows.map((g) => g.querySelector('.t-lane-app')?.textContent)).toEqual(['Service', 'Sessions', 'New connections']);
    const column = (g: Element | null): string | null => g?.getAttribute('transform')?.match(/translate\(([\d.]+),/)?.[1] ?? null;
    const dbIcon = iconOf(el, 'prm01');
    for (const g of rows) {
      const use = g.querySelector('.tl-lane-ico use');
      /* the same glyph and tint as the application's heading and card */
      expect(use?.getAttribute('href')).toBe('#tl-ico-app');
      expect(use?.getAttribute('class')).toContain('is-app');
      /* the same column as the databases' icons, and the name beside it in sans */
      expect(column(use ?? null)).toBe(column(dbIcon));
    }
    const dbName = el.querySelector<SVGTextElement>('[data-lane="prm01"] .t-lane');
    for (const g of rows) {
      expect(g.querySelector('.t-lane-app')?.getAttribute('class')).not.toContain('t-mono');
      expect(g.querySelector('.t-lane-app')?.getAttribute('x')).toBe(dbName?.getAttribute('x'));
    }
    /* the heading keeps its own */
    expect(el.querySelector('.tl-app-head use')?.getAttribute('href')).toBe('#tl-ico-app');
  });

  it("names the application in each of its lanes' tooltips", () => {
    const { el } = draw(density);
    const titles = [...el.querySelectorAll('[data-lane="app01"] .t-lane-app')]
      .map((t) => t.parentElement?.querySelector('title')?.textContent ?? '');
    expect(titles).toHaveLength(3);
    for (const title of titles) expect(title).toContain(' of app01 — ');
  });

  it('keeps every lane a tooltip with the whole description', () => {
    const { el } = draw(density);
    expect(el.querySelector('[data-lane="prm01"] title')?.textContent).toContain('prm01 — ');
  });
});

describe('the gutter columns', () => {
  it('fit the longest lane name and a database name in the room after the icon', () => {
    for (const TL of [TL_COMPACT, TL_FULL]) {
      const room = TL.gutter - TL.gutterPad - TL.nameX - TL.appIndent;
      /* "New connections", set in 11.5 px sans */
      expect(15 * 11.5 * 0.53).toBeLessThanOrEqual(room);
      expect(TL.iconX + TL.iconSize).toBeLessThan(TL.nameX);
    }
  });

  it('cuts a long name with an ellipsis and leaves a short one alone', () => {
    expect(elideTo('prm01', 100, 12, true)).toBe('prm01');
    const cut = elideTo('a_very_long_db_unique_name_indeed', 100, 12, true);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length * 12 * 0.6).toBeLessThanOrEqual(100 + 12);
  });

  it('is what the model says: a far sync instance wears its own glyph and no letter, a cascaded standby its indent', () => {
    const fs = presetDoc('far-sync-zero-loss');
    const far = buildTimeline(simulate(fs, []), fs, { width: 900, density: 'compact' });
    const farLane = far.lanes.find((l) => l.group === 'farsync');
    expect(farLane?.glyph).toBe('farsync');
    expect(farLane?.mark).toBeNull();
    expect(far.lanes.find((l) => l.group === 'primary')?.mark).toBe('P');
    const cs = presetDoc('cascade-terminal');
    const cascade = buildTimeline(simulate(cs, []), cs, { width: 900, density: 'compact' });
    const standbys = cascade.lanes.filter((l) => l.group === 'standby');
    expect(standbys.some((l) => l.indent > 0)).toBe(true);
    for (const l of standbys) expect(l.glyph).toBe('db');
  });
});
