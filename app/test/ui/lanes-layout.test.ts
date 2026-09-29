/**
 * Lanes' placement rules that are arithmetic: which rail lane a connector runs
 * in, and where a link's pill goes when several want the same gap.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasLink } from '@/ui/canvas/routing';
import type { Epoch } from '@/engine';
import type { TimelineSegment } from '@/ui/timeline/build';
import { assignLanes, cardSub, hostBands, MORE_W, planPills, segmentAt } from '@/ui/break/lanes-layout';

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

describe('the band at a tick', () => {
  const seg = (t0: number, t1: number, label: string): TimelineSegment => ({
    key: label, t0, t1, x: 0, w: 0, state: 'up', phase: 'b-sl', ink: 'f-sl', labels: [label], label, title: label, open: false,
  });
  const bands = [seg(-10, 0, 'before'), seg(0, 20, 'down'), seg(20, 70, 'open')];

  it('belongs to the band that begins at it, not the one that ends there', () => {
    expect(segmentAt(bands, 0)?.key).toBe('down');
    expect(segmentAt(bands, 20)?.key).toBe('open');
    expect(segmentAt(bands, 19.99)?.key).toBe('down');
    expect(segmentAt(bands, 0.0000000001)?.key).toBe('down');
  });

  it('is the first band before the run and the last after it', () => {
    expect(segmentAt(bands, -50)?.key).toBe('before');
    expect(segmentAt(bands, 70)?.key).toBe('open');
    expect(segmentAt(bands, 500)?.key).toBe('open');
    expect(segmentAt([], 3)).toBeNull();
  });
});

describe('a card\'s second line', () => {
  const room = 232 - 38 - 8;
  const states = ['Lagging — no redo is arriving from the primary', 'No redo arriving', 'Lagging'];

  it('keeps the longest state that fits beside the role', () => {
    expect(cardSub('Physical standby', states, room)).toBe('Physical standby · No redo arriving');
    expect(cardSub('Primary', ['Open read-write — shipping redo', 'Shipping redo', 'Open'], room))
      .toBe('Primary · Shipping redo');
  });

  it('gives the host up before the state: the observer\'s role loses its host name first', () => {
    const line = cardSub('Observer, dc3-obs01', ['Reconnect attempts — threshold clock running', 'Reconnect attempts', 'Reconnecting'], room);
    expect(line).toBe('Observer · Reconnect attempts');
  });

  it('never cuts the state: at any width the shortest state word is there', () => {
    for (const w of [40, 80, 120, 160, room]) {
      const line = cardSub('Physical standby, dc2-sby01-with-a-long-host', states, w);
      expect(line, String(w)).toMatch(/ · (Lagging|No redo arriving|Lagging — no redo is arriving from the primary)$/);
    }
  });

  it('is the role alone when there is no state to give', () => {
    expect(cardSub('Application', [], room)).toBe('Application');
  });
});

describe('a host\'s own up and down', () => {
  const epoch = (t0: number, t1: number | null, downHosts: string[], downSites: string[] = []): Epoch =>
    ({ t0, t1, net: { downHosts, downSites, downLinks: [], partitioned: false, downInstances: [] } }) as unknown as Epoch;

  it('reads the epochs: up, down while the host is listed, up again', () => {
    const b = hostBands([epoch(0, 10, []), epoch(10, 30, ['h1']), epoch(30, null, [])], 'h1', 's1', -5, 60);
    expect(b).toEqual([
      { t0: -5, t1: 10, down: null }, { t0: 10, t1: 30, down: 'crashed' }, { t0: 30, t1: 60, down: null },
    ]);
  });

  it('says the whole data centre when it is the site that is listed, and merges neighbours that agree', () => {
    const b = hostBands([epoch(0, 5, []), epoch(5, 8, ['other']), epoch(8, null, [], ['s1'])], 'h1', 's1', 0, 20);
    expect(b).toEqual([{ t0: 0, t1: 8, down: null }, { t0: 8, t1: 20, down: 'site' }]);
  });

  it('is one up band when nothing touches it, and always covers the axis', () => {
    expect(hostBands([], 'h1', undefined, 0, 30)).toEqual([{ t0: 0, t1: 30, down: null }]);
    const b = hostBands([epoch(4, null, [])], 'h1', 's1', -10, 30);
    expect(b[0]?.t0).toBe(-10);
    expect(b[b.length - 1]?.t1).toBe(30);
  });
});
