/**
 * Link routing: determinism, orthogonality, and pills that land on nothing.
 *
 * The router is allowed to choose a different template for a link -- that is
 * what keeps a line off a card -- but two runs over the same document must
 * choose the same one, and no pill may cover a card or another pill.
 */

import { describe, expect, it } from 'vitest';
import { layoutTopology } from '@/ui/canvas/layout';
import type { Geometry } from '@/ui/canvas/layout';
import { buildLinks, cardRoleFor, orthPath, routeTopology } from '@/ui/canvas/routing';
import type { RoutedLink } from '@/ui/canvas/routing';
import { overlaps } from '@/ui/canvas/measure';
import type { TopologyDoc } from '@/engine';
import {
  allFixtures, cascadeFixture, classic, farSyncFixture, graphOf, priorityFixture,
  threeObserverFixture,
} from './canvas-fixtures';
import { simulate, stateAt } from '@/engine';
import { classic as classicPreset, farSyncZeroLoss } from '@/presets';

const routeOf = (doc: TopologyDoc): { geo: Geometry; links: RoutedLink[] } => {
  const geo = layoutTopology(doc, graphOf(doc));
  return { geo, links: routeTopology(doc, graphOf(doc), geo).links };
};

const byId = (links: readonly RoutedLink[], id: string): RoutedLink => {
  const l = links.find((x) => x.id === id);
  if (!l) throw new Error(`no link ${id}: have ${links.map((x) => x.id).join(', ')}`);
  return l;
};

describe('routing: what gets drawn', () => {
  it('draws the redo edge, the ping and the readiness check of the classic strip', () => {
    const { links } = routeOf(classic('dc3'));
    expect(links.map((l) => l.id)).toEqual([
      'check:obs01:sby01', 'ping:obs01:prm01', 'redo:prm01:sby01',
    ]);
    const redo = byId(links, 'redo:prm01:sby01');
    expect(redo.caption).toBe('redo (SYNC)');
    expect(redo.value).toBe('0 ms RTT');
    expect(redo.arrow).toBe(true);
    expect(redo.d).toBe('M198,116 L848,116');
    expect(byId(links, 'ping:obs01:prm01').arrow).toBe(false);
  });

  it('names the transport the resolver chose', () => {
    const { links } = routeOf(classic('dc3', { logXptMode: 'fastsync' }));
    expect(byId(links, 'redo:prm01:sby01').caption).toBe('redo (FASTSYNC)');
    const asyncRun = routeOf(classic('dc3', { logXptMode: 'async' }));
    expect(byId(asyncRun.links, 'redo:prm01:sby01').caption).toBe('redo (ASYNC)');
  });

  it('trades the round trip for the failure word on a severed link', () => {
    const doc = classic('dc3');
    const cut: TopologyDoc = {
      ...doc,
      links: doc.links.map((l) => ((l.id as string) === 'dc1-dc2' ? { ...l, up: false } : l)),
    };
    const { links } = routeOf(cut);
    const redo = byId(links, 'redo:prm01:sby01');
    expect(redo.cut).toBe(true);
    expect(redo.value).toBe('cut');
    expect(redo.slashes).toHaveLength(2);
  });

  it('keeps a standing-down destination on the drawing, and labels the model', () => {
    const { links } = routeOf(priorityFixture());
    const standby = byId(links, 'redo:prm01:sby02');
    expect(standby.active).toBe(false);
    expect(standby.caption).toBe('PRIORITY 2');
    expect(standby.value).toBe('SYNC');
    expect(standby.model).toBe(true);
    expect(byId(links, 'redo:prm01:sby01').active).toBe(true);
    expect(byId(links, 'redo:prm01:sby01').model).toBe(false);
  });

  it('draws the far sync hop and the onward leg as two links', () => {
    const { links } = routeOf(farSyncFixture());
    expect(byId(links, 'redo:prm01:fs1').caption).toBe('redo (SYNC)');
    expect(byId(links, 'redo:fs1:sby01').caption).toBe('redo (ASYNC)');
  });

  it('gives every observer a ping and a readiness check', () => {
    const { links } = routeOf(threeObserverFixture());
    for (const o of ['obs01', 'obs02', 'obs03']) {
      expect(links.some((l) => l.id === `ping:${o}:prm01`)).toBe(true);
      expect(links.some((l) => l.id === `check:${o}:sby01`)).toBe(true);
    }
  });

  it('drops the readiness check when fast-start failover is disabled', () => {
    const doc = classic('dc3');
    const off: TopologyDoc = {
      ...doc,
      config: { ...doc.config, fsfo: { ...doc.config.fsfo, state: 'disabled' } },
    };
    const { links } = routeOf(off);
    expect(links.some((l) => l.kind === 'check')).toBe(false);
    expect(links.some((l) => l.kind === 'ping')).toBe(true);
  });

  it('says what is missing when the observer is not running', () => {
    const doc = classic('dc3');
    const stopped: TopologyDoc = {
      ...doc,
      observers: doc.observers.map((o) => ({ ...o, running: false })),
    };
    const { links } = routeOf(stopped);
    expect(byId(links, 'ping:obs01:prm01').caption).toBe('no observer to ping');
    expect(byId(links, 'check:obs01:sby01').caption).toBe('no readiness check');
    expect(byId(links, 'ping:obs01:prm01').value).toBeUndefined();
  });

  it('selects the document link the drawing rides', () => {
    const { links } = routeOf(classic('dc3'));
    expect(byId(links, 'redo:prm01:sby01').docLink).toBe('dc1-dc2');
    expect(byId(links, 'ping:obs01:prm01').docLink).toBe('dc1-dc3');
  });
});

describe('routing: geometry', () => {
  it('emits only orthogonal segments', () => {
    for (const { name, doc } of allFixtures()) {
      for (const l of routeOf(doc).links) {
        for (let i = 0; i + 1 < l.points.length; i++) {
          const a = l.points[i]!;
          const b = l.points[i + 1]!;
          const ortho = Math.abs(a.x - b.x) < 0.001 || Math.abs(a.y - b.y) < 0.001;
          expect(ortho, `${name}: ${l.id} segment ${i}`).toBe(true);
        }
        expect(l.points.length, `${name}: ${l.id} bends`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('never lets a line cross a card it does not end on', () => {
    for (const { name, doc } of allFixtures()) {
      const { geo, links } = routeOf(doc);
      for (const l of links) {
        for (let i = 0; i + 1 < l.points.length; i++) {
          const a = l.points[i]!;
          const b = l.points[i + 1]!;
          const x0 = Math.min(a.x, b.x); const x1 = Math.max(a.x, b.x);
          const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
          for (const c of geo.nodes) {
            if (c.key === l.from || c.key === l.to) continue;
            const hit = x0 < c.x + c.w - 1 && x1 > c.x + 1 && y0 < c.y + c.h - 1 && y1 > c.y + 1;
            expect(hit, `${name}: ${l.id} crosses ${c.key}`).toBe(false);
          }
        }
      }
    }
  });

  it('never covers a card or another pill with a pill', () => {
    for (const { name, doc } of allFixtures()) {
      const { geo, links } = routeOf(doc);
      for (const l of links) {
        for (const c of geo.nodes) {
          expect(overlaps(l.pill, c), `${name}: pill of ${l.id} over ${c.key}`).toBe(false);
        }
      }
      for (let i = 0; i < links.length; i++) {
        for (let j = i + 1; j < links.length; j++) {
          const a = links[i]!;
          const b = links[j]!;
          expect(overlaps(a.pill, b.pill), `${name}: pills ${a.id} and ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('is deterministic', () => {
    for (const { doc } of allFixtures()) {
      const first = routeOf(doc).links.map((l) => [l.id, l.d, l.pill]);
      const second = routeOf(doc).links.map((l) => [l.id, l.d, l.pill]);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('allocates a channel per link when two share a corridor', () => {
    const { links } = routeOf(cascadeFixture());
    const ds = links.map((l) => l.d);
    expect(new Set(ds).size).toBe(ds.length);
  });

  it('rounds every corner once', () => {
    const d = orthPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }]);
    expect(d).toBe('M0,0 L43,0 Q50,0 50,7 L50,40');
  });

  it('keeps the pill on the link it names', () => {
    for (const { name, doc } of allFixtures()) {
      for (const l of routeOf(doc).links) {
        const cx = l.pill.x + l.pill.w / 2;
        const cy = l.pill.y + l.pill.h / 2;
        const near = l.points.some((p, i) => {
          const q = l.points[i + 1];
          if (!q) return false;
          const x0 = Math.min(p.x, q.x) - 60; const x1 = Math.max(p.x, q.x) + 60;
          const y0 = Math.min(p.y, q.y) - 60; const y1 = Math.max(p.y, q.y) + 60;
          return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
        });
        expect(near, `${name}: pill of ${l.id} drifted`).toBe(true);
      }
    }
  });
});

describe('routing: a frame is what the line says, not the declaration', () => {
  /* Example 5-2 with the far sync host gone. The alternate destination the
     primary declares behind FS1 is carrying the redo from the moment FS1 dies
     -- the primary lane says "shipping redo" again -- and the drawing has to
     agree: the line to South_Sales is the live one, with its round trip, and
     the ALT pill moves onto the destination that is standing down. */
  const preset = farSyncZeroLoss.doc();
  const trace = simulate(preset, farSyncZeroLoss.events());
  const graph = graphOf(preset);
  const geo = layoutTopology(preset, graph);
  const at = (t: number): RoutedLink[] =>
    routeTopology(preset, graph, geo, stateAt(trace, t)).links;

  it('draws the alternate active and up once it has taken over', () => {
    const alt = byId(at(40), 'redo:North_Sales:South_Sales');
    expect(alt.active).toBe(true);
    expect(alt.up).toBe(true);
    expect(alt.down).toBe(false);
    expect(alt.cut).toBe(false);
    expect(alt.caption).toBe('redo (ASYNC)');
    expect(alt.value).toBe('40 ms RTT');
  });

  it('moves the ALT pill onto the destination that is standing down', () => {
    const declared = byId(at(40), 'redo:North_Sales:FS1');
    expect(declared.active).toBe(false);
    expect(declared.caption).toBe('ALT');
    expect(declared.model).toBe(true);
  });

  it('draws only the declared destinations while every one of them is up', () => {
    const quiet = simulate(preset, []);
    const links = routeTopology(preset, graph, geo, stateAt(quiet, 0)).links;
    expect(links.map((l) => l.id)).toEqual([
      'check:obs01:South_Sales', 'ping:obs01:North_Sales',
      'redo:FS1:South_Sales', 'redo:North_Sales:FS1',
    ]);
  });
});

describe('routing: link inventory', () => {
  it('builds one link per redo edge plus the observer connections', () => {
    const doc = threeObserverFixture();
    const geo = layoutTopology(doc, graphOf(doc));
    const links = buildLinks(doc, graphOf(doc), geo);
    expect(links.filter((l) => l.kind === 'redo')).toHaveLength(1);
    expect(links.filter((l) => l.kind === 'ping')).toHaveLength(3);
    expect(links.filter((l) => l.kind === 'check')).toHaveLength(3);
  });
});

describe('database role badges', () => {
  it('distinguishes databases from far sync and observers, and follows failover', () => {
    const fsDoc = farSyncZeroLoss.doc();
    for (const node of layoutTopology(fsDoc, graphOf(fsDoc)).nodes) {
      if (node.glyph === 'farsync' || node.kind === 'observer') expect(cardRoleFor(fsDoc, node)).toBeNull();
    }
    const doc = classicPreset.doc();
    const geo = layoutTopology(doc, graphOf(doc));
    const trace = simulate(doc, classicPreset.events());
    const before = stateAt(trace, -1);
    const after = stateAt(trace, 900);
    expect(after.epoch.primary).not.toBe(before.epoch.primary);
    for (const node of geo.nodes) {
      const member = doc.members.find((m) => m.id === node.id);
      if (!member || member.kind !== 'database') {
        expect(cardRoleFor(doc, node, after)).toBeNull();
      } else {
        expect(cardRoleFor(doc, node)).toBe(member.role === 'primary' ? 'primary' : 'standby');
        expect(cardRoleFor(doc, node, before)).toBe(member.id === before.epoch.primary ? 'primary' : 'standby');
        expect(cardRoleFor(doc, node, after)).toBe(member.id === after.epoch.primary ? 'primary' : member.role === 'primary' ? 'former-primary' : 'standby');
      }
    }
  });
});

it('marks the old primary as standby after a completed switchover', () => {
  const doc = classicPreset.doc();
  const target = doc.members.find((m) => m.kind === 'database' && m.role === 'physical')!;
  const trace = simulate(doc, [{ at: 0, kind: 'cmd.switchover', to: target.id }]);
  const frame = stateAt(trace, 900);
  expect(frame.epoch.primary).toBe(target.id);
  for (const node of layoutTopology(doc, graphOf(doc)).nodes) {
    if (node.kind === 'member') expect(cardRoleFor(doc, node, frame)).toBe(node.id === target.id ? 'primary' : 'standby');
  }
});
