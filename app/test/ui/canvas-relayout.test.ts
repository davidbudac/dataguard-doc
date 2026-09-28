/**
 * Adding to a drawing (task 1.6): the new standby, far sync instance or
 * observer goes into a sensible data centre, lands clear of every other card
 * -- hand-moved ones included -- and the lines to it do not run through the
 * cards already there.
 *
 * Driven through the real edits (`addDatabase`, `addFarSync`, `addObserver`),
 * because what they choose is the point; asserted on the pure layout and
 * router, because a collision is a question about geometry.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { declaredPrimary, resolveRedoGraph } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import { doc as docSignal, makeDoc, withLayout } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { layoutTopology } from '@/ui/canvas/layout';
import type { Geometry, LayoutOffset, NodeBox } from '@/ui/canvas/layout';
import { overlaps, segmentHitsRect } from '@/ui/canvas/measure';
import { routeTopology } from '@/ui/canvas/routing';
import { siteForNewFarSync, siteForNewObserver, siteForNewStandby } from '@/ui/build/placement';
import { addDatabase, addFarSync, addObserver, addSite } from '@/ui/inspector/edits';

const topo = (): TopologyDoc => docSignal.value.topology;
const siteOf = (t: TopologyDoc, key: string): string => {
  const m = t.members.find((x) => (x.id as string) === key);
  const host = m ? m.instances[0]?.host : t.observers.find((o) => (o.id as string) === key)?.host;
  return t.hosts.find((h) => h.id === host)?.site as string;
};
const draw = (t: TopologyDoc, overrides: Readonly<Record<string, LayoutOffset>> = {}, transient: string[] = []) => {
  const primary = declaredPrimary(t);
  if (primary === null) throw new Error('no primary');
  const graph = resolveRedoGraph(t, { primary });
  const geo = layoutTopology(t, graph, { overrides, transient });
  return { geo, links: routeTopology(t, graph, geo).links };
};
const cardClashes = (geo: Geometry): string[] => {
  const out: string[] = [];
  const ns = geo.nodes;
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i] as NodeBox; const b = ns[j] as NodeBox;
      if (overlaps(a, b)) out.push(`${a.key}/${b.key}`);
    }
  }
  return out;
};

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
const load = (id: string): void => resetHistory(makeDoc(preset(id).doc()));

beforeEach(() => load('classic'));

describe('where an addition goes when no data centre is named', () => {
  it('puts a standby beside the standby already drawn, not into the observer\'s data centre', () => {
    expect(siteForNewStandby(topo())).toBe('dc2');
    const id = addDatabase()!;
    expect(siteOf(topo(), id as string)).toBe('dc2');
  });

  it('fills an empty data centre first, so "+ Data centre" then "+ Standby" lands there', () => {
    const dc = addSite()!;
    expect(siteForNewStandby(topo())).toBe(dc);
  });

  it('keeps standbys out of an observer-only data centre in the three-observer preset too', () => {
    load('multi-target-three-observers');
    const observerOnly = topo().sites.map((s) => s.id as string)
      .filter((s) => !topo().members.some((m) => siteOf(topo(), m.id as string) === s));
    const id = addDatabase()!;
    expect(observerOnly).not.toContain(siteOf(topo(), id as string));
  });

  it('puts a far sync instance beside the primary', () => {
    expect(siteForNewFarSync(topo())).toBe('dc1');
    const id = addFarSync()!;
    expect(siteOf(topo(), id as string)).toBe('dc1');
  });

  it('puts an observer with the observers, on a host of its own', () => {
    expect(siteForNewObserver(topo())).toBe('dc3');
    const id = addObserver()!;
    expect(siteOf(topo(), id as string)).toBe('dc3');
  });
});

describe('a card the layout placed makes way for one moved by hand', () => {
  it('slides a new standby below a hand-moved card that sits in its slot', () => {
    addDatabase();
    const natural = draw(topo()).geo;
    const sby01 = natural.byKey['sby01']!;
    const sby02 = natural.byKey['sby02']!;
    /* sby01 moved down by hand onto the slot sby02 was just given. */
    const dy = sby02.y - sby01.y + 8;
    const { geo } = draw(topo(), { sby01: { dx: 0, dy } });
    expect(cardClashes(geo)).toEqual([]);
    expect(geo.byKey['sby02']!.y).toBeGreaterThanOrEqual(geo.byKey['sby01']!.y + geo.byKey['sby01']!.h);
    expect(geo.byKey['sby02']!.moved).toBe(false);
  });

  it('leaves everything alone while the card is still in the air', () => {
    addDatabase();
    const natural = draw(topo()).geo;
    const dy = natural.byKey['sby02']!.y - natural.byKey['sby01']!.y;
    const { geo } = draw(topo(), { sby01: { dx: 0, dy } }, ['sby01']);
    expect(geo.byKey['sby02']!.y).toBe(natural.byKey['sby02']!.y);
  });

  it('moves nothing when nothing overlaps', () => {
    addDatabase();
    const natural = draw(topo()).geo;
    const { geo } = draw(topo(), { prm01: { dx: -40, dy: 0 } });
    for (const n of geo.nodes.filter((x) => x.key !== 'prm01')) {
      expect([n.x, n.y]).toEqual([natural.byKey[n.key]!.x, natural.byKey[n.key]!.y]);
    }
  });
});

describe('adding to every preset', () => {
  for (const p of PRESETS) {
    it(`${p.id}: two standbys, a far sync and an observer land clear, and no line runs through a card`, () => {
      load(p.id);
      addDatabase();
      addDatabase();
      addFarSync();
      addObserver();
      const { geo, links } = draw(topo());
      expect(cardClashes(geo)).toEqual([]);
      const through: string[] = [];
      for (const l of links) {
        for (let i = 0; i + 1 < l.points.length; i++) {
          for (const c of geo.nodes) {
            if (c.key === l.from || c.key === l.to) continue;
            if (segmentHitsRect(l.points[i]!, l.points[i + 1]!, c, 1)) through.push(`${l.id}>${c.key}`);
          }
        }
      }
      expect(through).toEqual([]);
    });
  }

  it('keeps a hand-moved layout clear too', () => {
    const d = withLayout(docSignal.value, 'sby01', { dx: 0, dy: 96 });
    resetHistory(d);
    addDatabase();
    const { geo } = draw(topo(), docSignal.value.layout);
    expect(cardClashes(geo)).toEqual([]);
  });
});
