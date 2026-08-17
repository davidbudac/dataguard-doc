/**
 * The two pieces of the timeline that are arithmetic rather than markup -- the
 * brace path (ported from the fragment) and the transport's step helpers --
 * and the one piece of its markup that is a keyboard contract: the playhead's
 * focus stop.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { bracePath } from '@/ui/timeline/Brace';
import { nextChange, prevChange } from '@/ui/timeline/Playhead';
import { SPEEDS, WHY } from '@/ui/timeline/Transport';

describe('bracePath', () => {
  it('puts the tips exactly on the interval it measures', () => {
    const d = bracePath(100, 300, 40, 1);
    expect(d.startsWith('M100,40')).toBe(true);
    /* the last horizontal run stops one curl radius short of x1, then curls */
    expect(d).toContain('H295');
  });

  it('degrades to a bracket with a stem below 22 px of span', () => {
    const d = bracePath(100, 110, 40, 1);
    expect(d).toBe('M100,40 V45 H110 V40 M105,45 V50');
    expect(d).not.toContain('q');
  });

  it('opens upwards when asked to', () => {
    expect(bracePath(100, 110, 40, -1)).toBe('M100,40 V35 H110 V40 M105,35 V30');
  });
});

describe('state stepping', () => {
  const changes = [0, 12.5, 30, 45];

  it('steps to the next change, strictly after now', () => {
    expect(nextChange(changes, -5)).toBe(0);
    expect(nextChange(changes, 0)).toBe(12.5);
    expect(nextChange(changes, 44.9)).toBe(45);
    expect(nextChange(changes, 45)).toBeNull();
  });

  it('steps to the previous change, strictly before now', () => {
    expect(prevChange(changes, 60)).toBe(45);
    expect(prevChange(changes, 30)).toBe(12.5);
    expect(prevChange(changes, 0)).toBeNull();
  });

  it('offers 1x among its speeds and a reason for every gray state', () => {
    expect(SPEEDS).toContain(1);
    for (const why of Object.values(WHY)) expect(why.length).toBeGreaterThan(0);
  });
});

/**
 * The playhead is an SVG <g role="slider">, so its focus attribute has to be
 * spelled the way SVG spells it. A camel-cased `tabIndex` on an element
 * outside the HTML namespace is a literal attribute, not the focus one, and a
 * slider that cannot take focus is a slider the keyboard cannot move.
 */
describe('the playhead is focusable', () => {
  it('carries a lower-case tabindex', async () => {
    const { h, render } = await import('preact');
    const { Playhead } = await import('@/ui/timeline/Playhead');
    const { buildTimeline } = await import('@/ui/timeline/build');
    const { simulate } = await import('@/engine');
    const { classicDoc } = await import('@/state/doc');
    const doc = classicDoc().topology;
    const model = buildTimeline(simulate(doc, []), doc, { width: 900 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.appendChild(svg);
    render(h(Playhead, { model, tNow: 0, onSeek: () => undefined }), svg as unknown as HTMLElement);
    expect(svg.querySelector('[tabIndex]')).toBeNull();
    expect(svg.querySelector('[tabindex]')).not.toBeNull();
  });
});
