/**
 * Layout goldens and the invariants that hold whatever is drawn.
 *
 * The classic 1+1+1 is pinned coordinate by coordinate: it is the drawing the
 * published page ships, and it must not drift silently. Everything else is
 * asserted as a property -- no two cards overlap, the ranks read left to
 * right, a cascade sits below what feeds it -- because those are what the
 * auto-layout actually promises.
 */

import { describe, expect, it } from 'vitest';
import { layoutTopology, nodeKey } from '@/ui/canvas/layout';
import type { Geometry, NodeBox } from '@/ui/canvas/layout';
import { overlaps } from '@/ui/canvas/measure';
import {
  allFixtures, cascadeFixture, cascadeSameSiteFixture, classic, farSyncFixture, graphOf,
  threeObserverFixture,
} from './canvas-fixtures';

const geometryOf = (doc: Parameters<typeof graphOf>[0]): Geometry =>
  layoutTopology(doc, graphOf(doc));

const box = (n: NodeBox): number[] => [n.x, n.y, n.w, n.h];
const node = (geo: Geometry, key: string): NodeBox => {
  const n = geo.byKey[key];
  if (!n) throw new Error(`no node ${key}`);
  return n;
};

describe('layoutTopology: the classic 1+1+1', () => {
  it('draws the observer in the third site between the two databases', () => {
    const geo = geometryOf(classic('dc3'));
    expect(geo.nodes.map((n) => n.key)).toEqual(['prm01', 'obs01', 'sby01']);
    expect(box(node(geo, 'prm01'))).toEqual([14, 80, 184, 72]);
    expect(box(node(geo, 'obs01'))).toEqual([426, 0, 184, 52]);
    expect(box(node(geo, 'sby01'))).toEqual([838, 80, 184, 72]);
    expect(geo.sites.map((s) => [s.id as string, s.x, s.y, s.w, s.h])).toEqual([
      ['dc1', 0, 66, 212, 118],
      ['dc3', 412, -14, 212, 98],
      ['dc2', 824, 66, 212, 118],
    ]);
    expect(geo.viewBox).toEqual({ x: -10, y: -24, w: 1056, h: 224 });
  });

  it('grows the primary site upward when the observer runs there', () => {
    const geo = geometryOf(classic('dc1'));
    expect(node(geo, 'obs01').col).toBe(0);
    expect(node(geo, 'prm01').col).toBe(0);
    expect(node(geo, 'sby01').col).toBe(1);
    const dc1 = geo.sites.find((s) => (s.id as string) === 'dc1');
    const dc2 = geo.sites.find((s) => (s.id as string) === 'dc2');
    expect(dc1?.h).toBeGreaterThan(dc2?.h ?? 0);
    expect(box(node(geo, 'obs01'))).toEqual([14, 0, 184, 52]);
  });

  it('mirrors onto the standby site', () => {
    const geo = geometryOf(classic('dc2'));
    expect(node(geo, 'obs01').col).toBe(1);
    expect(node(geo, 'sby01').col).toBe(1);
    expect(node(geo, 'obs01').y).toBeLessThan(node(geo, 'sby01').y);
  });

  it('draws no observer band when none is deployed, and the empty third site as an empty panel', () => {
    const geo = geometryOf(classic('none'));
    expect(geo.nodes.map((n) => n.key)).toEqual(['prm01', 'sby01']);
    expect(geo.sites.map((s) => [s.id as string, s.empty])).toEqual([['dc1', false], ['dc2', false], ['dc3', true]]);
    expect(node(geo, 'prm01').y).toBe(0);
    /* The empty panel is last and moves nothing: the two occupied columns
       sit where they sit without it. */
    const without = geometryOf({ ...classic('none'), sites: classic('none').sites.filter((s) => (s.id as string) !== 'dc3') });
    expect(without.sites.map((s) => [s.x, s.y, s.w, s.h])).toEqual(geo.sites.slice(0, 2).map((s) => [s.x, s.y, s.w, s.h]));
    const dc3 = geo.sites[2]!;
    expect(dc3.x).toBeGreaterThan(geo.sites[1]!.x + geo.sites[1]!.w);
    expect(dc3.h).toBeGreaterThanOrEqual(72);
  });

  it('keeps the redo edge horizontal in all four placements', () => {
    for (const loc of ['none', 'dc1', 'dc2', 'dc3'] as const) {
      const geo = geometryOf(classic(loc));
      const p = node(geo, 'prm01');
      const s = node(geo, 'sby01');
      expect(p.y + p.h / 2).toBe(s.y + s.h / 2);
      expect(p.col).toBeLessThan(s.col);
    }
  });
});

describe('layoutTopology: rank, sites and rows', () => {
  it('stacks the far sync under the primary in its own data centre', () => {
    const geo = geometryOf(farSyncFixture());
    expect(node(geo, 'prm01').col).toBe(0);
    expect(node(geo, 'fs1').col).toBe(0);
    expect(node(geo, 'fs1').rank).toBe(1);
    expect(node(geo, 'sby01').rank).toBe(2);
    expect(node(geo, 'fs1').y).toBeGreaterThan(node(geo, 'prm01').y);
    expect(node(geo, 'fs1').glyph).toBe('farsync');
    expect(node(geo, 'sby01').col).toBeGreaterThan(node(geo, 'fs1').col);
  });

  it('ranks a cascade one column deeper than the standby that feeds it', () => {
    const geo = geometryOf(cascadeFixture());
    expect(node(geo, 'sby01').rank).toBe(1);
    expect(node(geo, 'sby02').rank).toBe(2);
    expect(node(geo, 'prm01').col).toBeLessThan(node(geo, 'sby01').col);
    expect(node(geo, 'sby01').col).toBeLessThan(node(geo, 'sby02').col);
  });

  it('indents a cascade that shares its cascader site, in the row below it', () => {
    const geo = geometryOf(cascadeSameSiteFixture());
    const feeder = node(geo, 'sby01');
    const term = node(geo, 'sby02');
    expect(term.col).toBe(feeder.col);
    expect(term.row).toBe(feeder.row + 1);
    expect(term.y).toBeGreaterThan(feeder.y);
    expect(term.x - feeder.x).toBe(24);
  });

  it('stacks several observers, and keeps the band above the members', () => {
    const geo = geometryOf(threeObserverFixture());
    const obs = geo.nodes.filter((n) => n.kind === 'observer');
    expect(obs.map((n) => n.key)).toEqual(['obs01', 'obs02', 'obs03']);
    const members = geo.nodes.filter((n) => n.kind === 'member');
    for (const o of obs) {
      for (const m of members) expect(o.y + o.h).toBeLessThanOrEqual(m.y);
    }
    const dc3 = obs.filter((o) => (o.site as string) === 'dc3');
    expect(dc3).toHaveLength(2);
    expect(dc3[1]!.y).toBeGreaterThan(dc3[0]!.y + dc3[0]!.h - 1);
  });

  it('parks a member no route reaches past the deepest rank', () => {
    const doc = classic('dc3');
    const orphan = {
      ...doc,
      members: doc.members.map((m) => (m.id as string) === 'prm01'
        ? { ...m, redoRoutes: [{ source: 'LOCAL' as const, groups: [{ dests: [] }] }] }
        : m),
    };
    const geo = geometryOf(orphan);
    expect(node(geo, 'sby01').unreachable).toBe(true);
    expect(node(geo, 'sby01').rank).toBe(geo.unreachableRank);
  });
});

describe('layoutTopology: invariants', () => {
  it('never overlaps two cards', () => {
    for (const { name, doc } of allFixtures()) {
      const geo = geometryOf(doc);
      for (let i = 0; i < geo.nodes.length; i++) {
        for (let j = i + 1; j < geo.nodes.length; j++) {
          const a = geo.nodes[i]!;
          const b = geo.nodes[j]!;
          expect(overlaps(a, b), `${name}: ${a.key} over ${b.key}`).toBe(false);
        }
      }
    }
  });

  it('holds every card inside the viewBox', () => {
    for (const { name, doc } of allFixtures()) {
      const geo = geometryOf(doc);
      for (const n of geo.nodes) {
        expect(n.x >= geo.viewBox.x, `${name}: ${n.key}`).toBe(true);
        expect(n.y >= geo.viewBox.y, `${name}: ${n.key}`).toBe(true);
        expect(n.x + n.w <= geo.viewBox.x + geo.viewBox.w, `${name}: ${n.key}`).toBe(true);
        expect(n.y + n.h <= geo.viewBox.y + geo.viewBox.h, `${name}: ${n.key}`).toBe(true);
      }
    }
  });

  it('holds every card inside its own site panel', () => {
    for (const { name, doc } of allFixtures()) {
      const geo = geometryOf(doc);
      for (const n of geo.nodes) {
        const site = geo.sites.find((s) => (s.id as string) === (n.site as string));
        expect(site, `${name}: ${n.key} has no site`).toBeDefined();
        expect(n.x >= site!.x && n.x + n.w <= site!.x + site!.w).toBe(true);
        expect(n.y >= site!.y && n.y + n.h <= site!.y + site!.h).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    for (const { doc } of allFixtures()) {
      const a = JSON.stringify(geometryOf(doc));
      const b = JSON.stringify(geometryOf(doc));
      expect(a).toBe(b);
    }
  });

  it('clamps card width into the design range', () => {
    const wide = classic('dc3', { hostPrimary: 'an-extremely-long-database-host-name-01' });
    const geo = geometryOf(wide);
    for (const n of geo.nodes) {
      expect(n.w).toBeGreaterThanOrEqual(184);
      expect(n.w).toBeLessThanOrEqual(260);
    }
    expect(node(geo, 'prm01').lines.host).toBe('an-extremely-long-…');
  });
});

describe('layoutTopology: drag overrides', () => {
  it('snaps an override to the 8 px grid and recomputes the site panel', () => {
    const doc = classic('dc3');
    const base = geometryOf(doc);
    const moved = layoutTopology(doc, graphOf(doc), {
      overrides: { [nodeKey('member', 'prm01')]: { dx: 13, dy: -19 } },
    });
    const before = node(base, 'prm01');
    const after = node(moved, 'prm01');
    expect(after.x - before.x).toBe(16);
    expect(after.y - before.y).toBe(-16);
    expect(after.moved).toBe(true);
    const dc1 = moved.sites.find((s) => (s.id as string) === 'dc1');
    expect(dc1!.x).toBe(after.x - 14);
    expect(dc1!.y).toBe(after.y - 14);
  });

  it('leaves the untouched cards where they were', () => {
    const doc = classic('dc3');
    const base = geometryOf(doc);
    const moved = layoutTopology(doc, graphOf(doc), { overrides: { prm01: { dx: 40, dy: 0 } } });
    expect(box(node(moved, 'sby01'))).toEqual(box(node(base, 'sby01')));
    expect(node(moved, 'sby01').moved).toBe(false);
  });
});
