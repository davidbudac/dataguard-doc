/**
 * Lanes' placement rules that are arithmetic: which rail lane a connector runs
 * in, and where a link's pill goes when several want the same gap.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasLink } from '@/ui/canvas/routing';
import { assignLanes, MORE_W, planPills } from '@/ui/break/lanes-layout';

const link = (id: string, from: string, to: string, extra: Partial<CanvasLink> = {}): CanvasLink => ({
  id, kind: 'redo', from, to, active: true, up: true, cut: false, down: false, caption: id,
  model: false, arrow: false, title: `${id} title`, ...extra,
});

const rows = (...ids: string[]): Map<string, number> => new Map(ids.map((id, i) => [id, i]));

describe('the rail', () => {
  it('reserves the lanes the links need and no more', () => {
    const idx = rows('a', 'b', 'c', 'd');
    expect(assignLanes([], idx, 5)).toEqual({ placed: [], lanes: 0 });
    /* Two links that do not overlap share one lane. */
    expect(assignLanes([link('x', 'a', 'b'), link('y', 'c', 'd')], idx, 5).lanes).toBe(1);
    /* Two that overlap need two. */
    expect(assignLanes([link('x', 'a', 'c'), link('y', 'b', 'd')], idx, 5).lanes).toBe(2);
    /* Links to a card that is not on a row are not placed. */
    expect(assignLanes([link('x', 'a', 'zz')], idx, 5).placed).toEqual([]);
  });

  it('never grows past the cap: the rest share the last lane', () => {
    const idx = rows('a', 'b', 'c', 'd', 'e', 'f');
    const many = ['b', 'c', 'd', 'e', 'f'].map((to, i) => link(`l${i}`, 'a', to));
    const { placed, lanes } = assignLanes(many, idx, 3);
    expect(lanes).toBe(3);
    expect(Math.max(...placed.map((p) => p.lane))).toBe(2);
  });
});

describe('the pills', () => {
  const text = (l: CanvasLink): string => l.caption;
  const w = (t: string): number => t.length * 6 + 10;

  it('puts every pill in a gap its connector spans', () => {
    const idx = rows('a', 'b', 'c', 'd');
    const { placed } = assignLanes([link('x', 'a', 'd'), link('y', 'b', 'c')], idx, 5);
    for (const plan of planPills(placed, 220, text, w)) {
      const p = placed.find((q) => q.link.id === plan.key) as (typeof placed)[number];
      expect(plan.gap).toBeGreaterThanOrEqual(p.ra);
      expect(plan.gap).toBeLessThan(p.rb);
    }
  });

  it('fans links between the same two rows out over the gaps between them', () => {
    const idx = rows('a', 'b', 'c', 'd');
    const same = ['p', 'q', 'r'].map((id) => link(id, 'a', 'd'));
    const gaps = planPills(assignLanes(same, idx, 5).placed, 220, text, w).map((p) => p.gap);
    expect(new Set(gaps).size).toBe(3);
  });

  it('never lets two pills in a gap overlap, and stays inside the width', () => {
    const idx = rows('a', 'b');
    const many = Array.from({ length: 6 }, (_, i) => link(`link${i}`, 'a', 'b'));
    const plans = planPills(assignLanes(many, idx, 5).placed, 220, text, w).sort((p, q) => p.x - q.x);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i]!.x).toBeGreaterThanOrEqual(plans[i - 1]!.x + plans[i - 1]!.w);
    }
    const last = plans[plans.length - 1]!;
    expect(last.x + last.w).toBeLessThanOrEqual(220);
  });

  it('folds what does not fit into one +N that keeps every link', () => {
    const idx = rows('a', 'b');
    const many = Array.from({ length: 8 }, (_, i) => link(`link${i}`, 'a', 'b', { title: `full text ${i}` }));
    const plans = planPills(assignLanes(many, idx, 5).placed, 220, text, w);
    const more = plans.filter((p) => p.more);
    expect(more).toHaveLength(1);
    expect(more[0]!.text).toBe(`+${more[0]!.links.length}`);
    expect(more[0]!.w).toBe(MORE_W);
    /* Nothing dropped: the pills and the fold together are all the links. */
    const all = plans.flatMap((p) => p.links.map((l) => l.id)).sort();
    expect(all).toEqual(many.map((l) => l.id).sort());
    expect(more[0]!.links.length).toBeGreaterThan(0);
  });

  it('does not fold when everything fits', () => {
    const idx = rows('a', 'b', 'c');
    const { placed } = assignLanes([link('x', 'a', 'b'), link('y', 'b', 'c')], idx, 5);
    expect(planPills(placed, 220, text, w).some((p) => p.more)).toBe(false);
  });
});
