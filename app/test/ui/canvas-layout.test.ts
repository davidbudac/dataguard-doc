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
import { hostId } from '@/engine';
import { layoutTopology, nodeKey, SITE_MIN } from '@/ui/canvas/layout';
import { resizedBox } from '@/ui/canvas/TopoCanvas';
import type { Geometry, NodeBox } from '@/ui/canvas/layout';
import { overlaps } from '@/ui/canvas/measure';
import {
  allFixtures, cascadeFixture, cascadeSameSiteFixture, classic, coHostedMembersFixture,
  coHostedObserverFixture, coHostedObserversFixture, farSyncFixture, graphOf,
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
    expect(box(node(geo, 'obs01'))).toEqual([426, 0, 194, 52]);
    expect(box(node(geo, 'sby01'))).toEqual([848, 80, 184, 72]);
    expect(geo.sites.map((s) => [s.id as string, s.x, s.y, s.w, s.h])).toEqual([
      ['dc1', 0, 66, 212, 118],
      ['dc3', 412, -14, 222, 98],
      ['dc2', 834, 66, 212, 118],
    ]);
    expect(geo.viewBox).toEqual({ x: -10, y: -24, w: 1066, h: 224 });
  });

  it('grows the primary site upward when the observer runs there', () => {
    const geo = geometryOf(classic('dc1'));
    expect(node(geo, 'obs01').col).toBe(0);
    expect(node(geo, 'prm01').col).toBe(0);
    expect(node(geo, 'sby01').col).toBe(1);
    const dc1 = geo.sites.find((s) => (s.id as string) === 'dc1');
    const dc2 = geo.sites.find((s) => (s.id as string) === 'dc2');
    expect(dc1?.h).toBeGreaterThan(dc2?.h ?? 0);
    expect(box(node(geo, 'obs01'))).toEqual([14, 0, 194, 52]);
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
    expect(node(geo, 'prm01').lines.host).toBe('an-extremely-lon…');
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

  it('moves a data centre as a group: one offset per member, and the panel follows them', () => {
    const doc = classic('dc3');
    const base = geometryOf(doc);
    /* A drag on dc1's own panel writes the same delta under every member and
       observer standing in it -- `prm01` here -- not under the site's own
       id: the site rect is a derived bounding box of its cards, so moving
       every card by the same offset already carries the box with them. */
    const moved = layoutTopology(doc, graphOf(doc), { overrides: { prm01: { dx: 40, dy: 24 } } });
    const before = node(base, 'prm01');
    const after = node(moved, 'prm01');
    expect(after.x - before.x).toBe(40);
    expect(after.y - before.y).toBe(24);
    const dc1Before = base.sites.find((s) => (s.id as string) === 'dc1')!;
    const dc1After = moved.sites.find((s) => (s.id as string) === 'dc1')!;
    expect(dc1After.x - dc1Before.x).toBe(40);
    expect(dc1After.y - dc1Before.y).toBe(24);
    /* Nothing that stands in another data centre moves. */
    expect(box(node(moved, 'sby01'))).toEqual(box(node(base, 'sby01')));
    const dc2Before = base.sites.find((s) => (s.id as string) === 'dc2')!;
    const dc2After = moved.sites.find((s) => (s.id as string) === 'dc2')!;
    expect([dc2After.x, dc2After.y, dc2After.w, dc2After.h])
      .toEqual([dc2Before.x, dc2Before.y, dc2Before.w, dc2Before.h]);
  });

  it('reads a site-keyed offset only for the empty panel it was written for', () => {
    const doc = classic('none');
    const base = geometryOf(doc);
    /* dc3 is empty in this placement (`classic('none')` deploys no observer),
       so it is the one site a group drag can only carry by its own id -- no
       member of its own to write the offset under. */
    const moved = layoutTopology(doc, graphOf(doc), { overrides: { dc3: { dx: 16, dy: -8 } } });
    const before = base.sites.find((s) => (s.id as string) === 'dc3')!;
    const after = moved.sites.find((s) => (s.id as string) === 'dc3')!;
    expect(after.x - before.x).toBe(16);
    expect(after.y - before.y).toBe(-8);
    /* An occupied site's own id is never read: only its members' keys are. */
    const occupied = layoutTopology(doc, graphOf(doc), { overrides: { dc1: { dx: 100, dy: 100 } } });
    const dc1Before = base.sites.find((s) => (s.id as string) === 'dc1')!;
    const dc1Occupied = occupied.sites.find((s) => (s.id as string) === 'dc1')!;
    expect([dc1Occupied.x, dc1Occupied.y]).toEqual([dc1Before.x, dc1Before.y]);
  });
});

describe('layoutTopology: a data centre with a size of its own', () => {
  const siteOf = (geo: Geometry, id: string) => geo.sites.find((s) => (s.id as string) === id)!;

  it('reports the natural box as the anchor and the cards\' extent as the fit', () => {
    const doc = classic('dc3');
    const geo = geometryOf(doc);
    const dc2 = siteOf(geo, 'dc2');
    expect(dc2.sized).toBe(false);
    expect(dc2.anchor).toEqual({ x: dc2.x, y: dc2.y });
    expect([dc2.fit.x, dc2.fit.y, dc2.fit.w, dc2.fit.h]).toEqual([dc2.x, dc2.y, dc2.w, dc2.h]);
  });

  it('draws a sized box at its anchor plus the offset, at the stored size', () => {
    const doc = classic('dc3');
    const base = siteOf(geometryOf(doc), 'dc2');
    const geo = layoutTopology(doc, graphOf(doc), {
      overrides: { dc2: { dx: -20, dy: -30, w: base.w + 100, h: base.h + 80 } },
    });
    const dc2 = siteOf(geo, 'dc2');
    expect(dc2.sized).toBe(true);
    expect([dc2.x, dc2.y, dc2.w, dc2.h]).toEqual([base.x - 20, base.y - 30, base.w + 100, base.h + 80]);
    /* The cards do not move, and the label follows the box's bottom edge. */
    expect(box(node(geo, 'sby01'))).toEqual(box(node(geometryOf(doc), 'sby01')));
    expect(dc2.labelY).toBe(dc2.y + dc2.h - 5);
    expect(geo.viewBox.w).toBeGreaterThan(geometryOf(doc).viewBox.w);
  });

  it('is never smaller than the cards it holds, whatever the stored size says', () => {
    const doc = classic('dc3');
    const base = siteOf(geometryOf(doc), 'dc2');
    const geo = layoutTopology(doc, graphOf(doc), { overrides: { dc2: { dx: 40, dy: 40, w: 16, h: 16 } } });
    const dc2 = siteOf(geo, 'dc2');
    expect([dc2.x, dc2.y, dc2.w, dc2.h]).toEqual([base.x, base.y, base.w, base.h]);
  });

  it('grows to take a card moved past its stored edge', () => {
    const doc = classic('dc3');
    const base = siteOf(geometryOf(doc), 'dc2');
    const geo = layoutTopology(doc, graphOf(doc), {
      overrides: { dc2: { dx: 0, dy: 0, w: base.w, h: base.h }, sby01: { dx: 80, dy: 0 } },
    });
    const dc2 = siteOf(geo, 'dc2');
    expect(dc2.x).toBe(base.x);
    expect(dc2.x + dc2.w).toBe(base.x + base.w + 80);
    for (const n of geo.nodes.filter((x) => (x.site as string) === 'dc2')) {
      expect(n.x).toBeGreaterThanOrEqual(dc2.x);
      expect(n.x + n.w).toBeLessThanOrEqual(dc2.x + dc2.w);
    }
  });

  it('gives an empty panel the stored box, but not below the minimum', () => {
    const doc = classic('none');
    const base = siteOf(geometryOf(doc), 'dc3');
    const sized = siteOf(layoutTopology(doc, graphOf(doc), {
      overrides: { dc3: { dx: 8, dy: 8, w: 300, h: 200 } },
    }), 'dc3');
    expect([sized.x, sized.y, sized.w, sized.h]).toEqual([base.x + 8, base.y + 8, 300, 200]);
    const tiny = siteOf(layoutTopology(doc, graphOf(doc), {
      overrides: { dc3: { dx: 0, dy: 0, w: 10, h: 10 } },
    }), 'dc3');
    expect([tiny.w, tiny.h]).toEqual([SITE_MIN.w, SITE_MIN.h]);
  });

  it('reads an override with only one of the two sizes as the plain offset it always was', () => {
    const doc = classic('dc3');
    const base = siteOf(geometryOf(doc), 'dc1');
    const geo = layoutTopology(doc, graphOf(doc), { overrides: { dc1: { dx: 100, dy: 100, w: 500 } } });
    const dc1 = siteOf(geo, 'dc1');
    expect([dc1.x, dc1.y, dc1.w, dc1.h, dc1.sized]).toEqual([base.x, base.y, base.w, base.h, false]);
  });
});

describe('resizedBox: a handle dragged', () => {
  const from = {
    start: { x: 100, y: 100, w: 200, h: 120 },
    fit: { x: 110, y: 110, w: 150, h: 90 },
    anchor: { x: 100, y: 100 },
    empty: false,
  };
  const all = { l: true, r: true, t: true, b: true };

  it('moves the dragged edges by the snapped delta', () => {
    expect(resizedBox(from, { l: false, r: true, t: false, b: true }, 37, 22))
      .toEqual({ dx: 0, dy: 0, w: 240, h: 144 });
    expect(resizedBox(from, { l: true, r: false, t: true, b: false }, -16, -8))
      .toEqual({ dx: -16, dy: -8, w: 216, h: 128 });
  });

  it('stops at the cards inside', () => {
    expect(resizedBox(from, { l: true, r: false, t: true, b: false }, 200, 200))
      .toEqual({ dx: 10, dy: 10, w: 190, h: 110 });
    /* Every edge at once: the far ones move, the near ones stop at the cards. */
    expect(resizedBox(from, all, 200, 200)).toEqual({ dx: 10, dy: 10, w: 390, h: 310 });
    const inward = resizedBox(from, { l: false, r: true, t: false, b: true }, -300, -300);
    expect(inward).toEqual({ dx: 0, dy: 0, w: 160, h: 100 });
  });

  it('stops an empty panel at the minimum size only', () => {
    const empty = { ...from, empty: true };
    expect(resizedBox(empty, { l: false, r: true, t: false, b: true }, -400, -400))
      .toEqual({ dx: 0, dy: 0, w: SITE_MIN.w, h: SITE_MIN.h });
  });
});

describe('layoutTopology: chassis stacks -- cards sharing a host', () => {
  it('leaves an item alone on its host exactly as today: its own card, its own host line', () => {
    const doc = coHostedObserverFixture();
    const geo = geometryOf(doc);
    const sby = node(geo, 'sby01');
    expect(sby.stackKey).toBeUndefined();
    expect(sby.lines.host).toBe('dc2-sby01');
    expect(geo.stacks.some((s) => s.memberKeys.includes('sby01'))).toBe(false);
  });

  it('snaps a member and an observer sharing a host into one touching stack', () => {
    const doc = coHostedObserverFixture();
    const geo = geometryOf(doc);
    const prm = node(geo, 'prm01');
    const obs = node(geo, 'obs01');
    expect(prm.stackKey).toBe('stack:dc1-prm01');
    expect(obs.stackKey).toBe('stack:dc1-prm01');
    /* The header carries the host once; the blades no longer repeat it. */
    expect(prm.lines.host).toBeUndefined();
    expect(prm.lines.sub).toBe('Primary');
    expect(obs.lines.host).toBe('Observer');
    /* Same x, same width: one column, not two. */
    expect(prm.x).toBe(obs.x);
    expect(prm.w).toBe(obs.w);
    /* Touching: the observer's blade starts exactly where the primary's ends. */
    expect(obs.y).toBe(prm.y + prm.h);
    const stack = geo.stacks.find((s) => s.key === 'stack:dc1-prm01')!;
    expect(stack).toBeDefined();
    expect(stack.memberKeys).toEqual(['prm01', 'obs01']);
    expect(stack.label).toContain('dc1-prm01');
    /* The header sits directly above the top blade, with its own band height. */
    expect(stack.y).toBe(prm.y - stack.headerH);
    expect(stack.x).toBe(prm.x);
    expect(stack.w).toBe(prm.w);
    expect(stack.h).toBe(stack.headerH + prm.h + obs.h);
    /* The site box clears the header band, not just the blades. */
    const dc1 = geo.sites.find((s) => (s.id as string) === 'dc1')!;
    expect(dc1.y).toBeLessThanOrEqual(stack.y);
  });

  it('snaps two members with no observer sharing a host into one stack, and none of it overlaps another card', () => {
    const doc = coHostedMembersFixture();
    const geo = geometryOf(doc);
    const sby01 = node(geo, 'sby01');
    const sby02 = node(geo, 'sby02');
    expect(sby01.stackKey).toBe(sby02.stackKey);
    expect(sby01.stackKey).toBeDefined();
    expect(sby01.x).toBe(sby02.x);
    const [top, bottom] = sby01.y < sby02.y ? [sby01, sby02] : [sby02, sby01];
    expect(bottom.y).toBe(top.y + top.h);
    for (const other of geo.nodes) {
      if (other.key === 'sby01' || other.key === 'sby02') continue;
      expect(overlaps(sby01, other)).toBe(false);
      expect(overlaps(sby02, other)).toBe(false);
    }
  });

  it('snaps two observers with no member on their host into their own stack, in the observer band', () => {
    const doc = coHostedObserversFixture();
    const geo = geometryOf(doc);
    const obs01 = node(geo, 'obs01');
    const obs02 = node(geo, 'obs02');
    expect(obs01.stackKey).toBe(obs02.stackKey);
    expect(obs01.kind).toBe('observer');
    expect(obs01.x).toBe(obs02.x);
    const [top, bottom] = obs01.y < obs02.y ? [obs01, obs02] : [obs02, obs01];
    expect(bottom.y).toBe(top.y + top.h);
  });

  it('dissolves and re-forms a stack as the document\'s own hosts change, with no other state', () => {
    const doc = coHostedObserverFixture();
    const stacked = layoutTopology(doc, graphOf(doc));
    expect(node(stacked, 'prm01').stackKey).toBeDefined();

    /* Give the observer a host of its own: nothing shares it any more, so it
       reverts to an ordinary card, unstacked. */
    const dissolved: typeof doc = {
      ...doc,
      hosts: [...doc.hosts, { ...doc.hosts[0]!, id: hostId('dc1-obs01'), name: 'dc1-obs01' }],
      observers: doc.observers.map((o) => (o.id === 'obs01' ? { ...o, host: hostId('dc1-obs01') } : o)),
    };
    const apart = layoutTopology(dissolved, graphOf(dissolved));
    expect(node(apart, 'prm01').stackKey).toBeUndefined();
    expect(node(apart, 'obs01').stackKey).toBeUndefined();
    expect(node(apart, 'prm01').lines.host).toBe('dc1-prm01');

    /* Move it back onto the primary's host: the stack re-forms, purely from
       the document -- no layout state of its own to carry across the move. */
    const rejoined = layoutTopology(doc, graphOf(doc));
    expect(node(rejoined, 'prm01').stackKey).toBe(node(stacked, 'prm01').stackKey);
  });

  it('carries every blade under one drag offset written on the pressed card, and the stack still touches', () => {
    const doc = coHostedObserverFixture();
    /* The drawing writes one offset per key it carries (`TopoCanvas.carried`
       resolves every blade of a pressed card's stack); the layout only has to
       stay internally consistent once both offsets land in one edit. */
    const moved = layoutTopology(doc, graphOf(doc), {
      overrides: { prm01: { dx: 24, dy: 16 }, obs01: { dx: 24, dy: 16 } },
    });
    const prm = node(moved, 'prm01');
    const obs = node(moved, 'obs01');
    expect(prm.moved).toBe(true);
    expect(obs.moved).toBe(true);
    expect(prm.x).toBe(obs.x);
    expect(obs.y).toBe(prm.y + prm.h);
  });
});
