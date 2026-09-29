/**
 * Every preset, drawn: the goldens of the drawing and the collisions it may
 * never have.
 *
 * `canvas-routing.test.ts` holds the router to its invariants on hand-built
 * fixtures; this file holds it to them on the twelve documents the workbench
 * actually offers, which are the dense ones -- three observers watching two
 * candidate targets, a priority group standing down behind another. Two kinds
 * of assertion, and both matter:
 *
 *  - **Collisions.** No caption over a card, no caption over another caption,
 *    no line through a card it does not end on. A caption that has slid onto
 *    a card is not a caption; it is a smudge over the thing it names.
 *  - **A golden per preset.** The router is deterministic by construction, so
 *    the exact geometry is checkable, and a golden is what turns "the pills
 *    moved" from something a reader notices into something a test says. Rerun
 *    with `UPDATE_GOLDEN=1` after a deliberate change and read the diff.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declaredPrimary, resolveRedoGraph, simulate, stateAt } from '@/engine';
import type { RedoGraph, Snapshot, TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import type { TimedEvent } from '@/engine';
import { layoutTopology, siteLabelRect } from '@/ui/canvas/layout';
import type { Geometry } from '@/ui/canvas/layout';
import { cardFrameFor, routeTopology } from '@/ui/canvas/routing';
import type { RoutedLink } from '@/ui/canvas/routing';
import { overlaps } from '@/ui/canvas/measure';
import type { Rect } from '@/ui/canvas/measure';
import { unionViewBox } from '@/ui/canvas/routing';
import { anchorFor, barRoom, fittedScale, menuCap, placeBar } from '@/ui/canvas/anchor';
import { barFootprint, MENU_W } from '@/ui/canvas/ActionBar';
import { linkKey } from '@/ui/canvas/LinkPath';
import { WHY } from '@/ui/inspector/why';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '__golden__');

function expectGolden(name: string, actual: string): void {
  const path = join(GOLDEN, `${name}.txt`);
  if (!existsSync(GOLDEN)) mkdirSync(GOLDEN, { recursive: true });
  if (!existsSync(path) || process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(path, actual, 'utf8');
    return;
  }
  expect(readFileSync(path, 'utf8'), `golden ${name}`).toBe(actual);
}

interface Drawn { doc: TopologyDoc; graph: RedoGraph; geo: Geometry; links: RoutedLink[] }

function draw(doc: TopologyDoc, frame: Snapshot | null = null): Drawn {
  const primary = declaredPrimary(doc);
  if (primary === null) throw new Error('preset has no primary');
  const graph = resolveRedoGraph(doc, { primary });
  const geo = layoutTopology(doc, graph);
  return { doc, graph, geo, links: routeTopology(doc, graph, geo, frame).links };
}

/**
 * Three instants of the preset's own failure: before it, at the moment the
 * configuration decides something, and at the end of the axis.
 *
 * Break mode is where the captions are widest -- "no observer to ping" and
 * "no readiness check" are frame-only wordings, and an alternate that has
 * taken over adds a line the steady state never draws -- so a drawing that is
 * clean at rest can still be a smudge while the run plays. These are the
 * frames the reader actually stops on.
 */
function framesOf(doc: TopologyDoc, events: readonly TimedEvent[]): { t: number; frame: Snapshot }[] {
  if (events.length === 0) return [];
  const trace = simulate(doc, [...events]);
  const decided = trace.facts.initiateAt ?? trace.facts.abortAt ?? trace.facts.tOpen ?? 0;
  const times = [...new Set([0, decided, trace.axis.horizon])];
  return times.map((t) => ({ t, frame: stateAt(trace, t) }));
}

const n = (v: number): string => String(Math.round(v * 10) / 10);
const box = (r: { x: number; y: number; w: number; h: number }): string =>
  `${n(r.x)},${n(r.y)} ${n(r.w)}x${n(r.h)}`;

/** One preset as text: the cards, the site rectangles, and every routed link. */
function render(d: Drawn): string {
  const lines: string[] = [];
  lines.push('-- sites');
  for (const s of d.geo.sites) lines.push(`${s.id as string}  ${box(s)}`);
  lines.push('-- cards');
  for (const c of d.geo.nodes) lines.push(`${c.key}  col ${c.col} row ${c.row}  ${box(c)}`);
  lines.push('-- links');
  for (const l of d.links) {
    lines.push(`${l.id}  ${l.caption}${l.value === undefined ? '' : ` [${l.value}]`}`);
    lines.push(`  path ${l.points.map((p) => `${n(p.x)},${n(p.y)}`).join(' -> ')}`);
    lines.push(`  pill ${box(l.pill)}`);
  }
  return `${lines.join('\n')}\n`;
}

describe('every preset draws without a collision', () => {
  for (const preset of PRESETS) {
    describe(preset.id, () => {
      it('puts no caption over a card', () => {
        const d = draw(preset.doc());
        for (const l of d.links) {
          for (const c of d.geo.nodes) {
            expect(overlaps(l.pill, c), `pill of ${l.id} over ${c.key}`).toBe(false);
          }
        }
      });

      it('puts no caption over another caption', () => {
        const d = draw(preset.doc());
        for (let i = 0; i < d.links.length; i++) {
          for (let j = i + 1; j < d.links.length; j++) {
            const a = d.links[i]!;
            const b = d.links[j]!;
            expect(overlaps(a.pill, b.pill), `pills ${a.id} and ${b.id}`).toBe(false);
          }
        }
      });

      it('runs no line through a card it does not end on', () => {
        const d = draw(preset.doc());
        for (const l of d.links) {
          for (let i = 0; i + 1 < l.points.length; i++) {
            const a = l.points[i]!;
            const b = l.points[i + 1]!;
            const x0 = Math.min(a.x, b.x); const x1 = Math.max(a.x, b.x);
            const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
            for (const c of d.geo.nodes) {
              if (c.key === l.from || c.key === l.to) continue;
              const hit = x0 < c.x + c.w - 1 && x1 > c.x + 1 && y0 < c.y + c.h - 1 && y1 > c.y + 1;
              expect(hit, `${l.id} crosses ${c.key}`).toBe(false);
            }
          }
        }
      });

      it('keeps every segment orthogonal and every route inside two bends', () => {
        const d = draw(preset.doc());
        for (const l of d.links) {
          expect(l.points.length, `${l.id} bends`).toBeLessThanOrEqual(4);
          for (let i = 0; i + 1 < l.points.length; i++) {
            const a = l.points[i]!;
            const b = l.points[i + 1]!;
            const ortho = Math.abs(a.x - b.x) < 0.001 || Math.abs(a.y - b.y) < 0.001;
            expect(ortho, `${l.id} segment ${i}`).toBe(true);
          }
        }
      });

      it('keeps every caption on the line it names', () => {
        const d = draw(preset.doc());
        for (const l of d.links) {
          const cx = l.pill.x + l.pill.w / 2;
          const cy = l.pill.y + l.pill.h / 2;
          const near = l.points.some((p, i) => {
            const q = l.points[i + 1];
            if (!q) return false;
            const x0 = Math.min(p.x, q.x) - 60; const x1 = Math.max(p.x, q.x) + 60;
            const y0 = Math.min(p.y, q.y) - 60; const y1 = Math.max(p.y, q.y) + 60;
            return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
          });
          expect(near, `pill of ${l.id} drifted off its link`).toBe(true);
        }
      });

      it('draws the same thing twice', () => {
        expect(render(draw(preset.doc()))).toBe(render(draw(preset.doc())));
      });

      it('matches its golden', () => {
        expectGolden(`canvas-${preset.id}`, render(draw(preset.doc())));
      });
    });
  }
});

describe('every preset draws without a collision while its failure plays', () => {
  for (const preset of PRESETS) {
    for (const { t, frame } of framesOf(preset.doc(), preset.events())) {
      describe(`${preset.id} at t = ${t} s`, () => {
        const d = (): Drawn => draw(preset.doc(), frame);

        it('puts no caption over a card', () => {
          const drawn = d();
          for (const l of drawn.links) {
            for (const c of drawn.geo.nodes) {
              expect(overlaps(l.pill, c), `pill of ${l.id} over ${c.key}`).toBe(false);
            }
          }
        });

        it('puts no caption over another caption', () => {
          const drawn = d();
          for (let i = 0; i < drawn.links.length; i++) {
            for (let j = i + 1; j < drawn.links.length; j++) {
              const a = drawn.links[i]!;
              const b = drawn.links[j]!;
              expect(overlaps(a.pill, b.pill), `pills ${a.id} and ${b.id}`).toBe(false);
            }
          }
        });

        /* The label is the only thing that says which data centre this is. */
        it('puts no caption over a site label', () => {
          const drawn = d();
          for (const s of drawn.geo.sites) {
            const lab = siteLabelRect(s);
            for (const c of drawn.geo.nodes) {
              expect(overlaps(lab, c), `label of ${s.id as string} over ${c.key}`).toBe(false);
            }
            for (const l of drawn.links) {
              expect(overlaps(l.pill, lab), `pill of ${l.id} over ${s.id as string}`).toBe(false);
            }
          }
        });

        it('runs no line through a card it does not end on', () => {
          const drawn = d();
          for (const l of drawn.links) {
            for (let i = 0; i + 1 < l.points.length; i++) {
              const a = l.points[i]!;
              const b = l.points[i + 1]!;
              const x0 = Math.min(a.x, b.x); const x1 = Math.max(a.x, b.x);
              const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
              for (const c of drawn.geo.nodes) {
                if (c.key === l.from || c.key === l.to) continue;
                const hit = x0 < c.x + c.w - 1 && x1 > c.x + 1 && y0 < c.y + c.h - 1 && y1 > c.y + 1;
                expect(hit, `${l.id} crosses ${c.key}`).toBe(false);
              }
            }
          }
        });

        it('only same-column hops caption inside a site', () => {
          const drawn = d();
          for (const l of drawn.links) {
            const inside = drawn.geo.sites.filter((s) => overlaps(l.pill, s));
            if (inside.length === 0) continue;
            const from = drawn.geo.byKey[l.from];
            const to = drawn.geo.byKey[l.to];
            expect(
              from?.col === to?.col,
              `pill of ${l.id} sits inside ${inside.map((s) => s.id as string).join(', ')}`,
            ).toBe(true);
          }
        });
      });
    }
  }
});

describe('the dense presets keep their captions out of the site rectangles', () => {
  /* A ping or a readiness check crosses the whole drawing, so its caption has
     somewhere to go: the corridor the layout leaves between two site columns.
     Only a hop between two cards stacked inside one data centre may caption
     itself inside a site rectangle, because that is where its line is. */
  for (const id of ['multi-target-three-observers', 'priority-alternates']) {
    it(`${id}: only same-column hops caption inside a site`, () => {
      const preset = PRESETS.find((p) => p.id === id);
      expect(preset, `preset ${id}`).toBeDefined();
      const d = draw(preset!.doc());
      for (const l of d.links) {
        const inside = d.geo.sites.filter((s) => overlaps(l.pill, s));
        if (inside.length === 0) continue;
        const from = d.geo.byKey[l.from];
        const to = d.geo.byKey[l.to];
        expect(
          from?.col === to?.col,
          `pill of ${l.id} sits inside ${inside.map((s) => s.id as string).join(', ')}`,
        ).toBe(true);
      }
    });
  }
});

/**
 * The action bar, on every preset, at every scale the drawing renders at.
 *
 * `.app-stage` is `overflow: auto` and clips whatever leaves the viewBox with
 * no scrollbar and no other sign that it did, so a bar that hangs off the
 * drawing is a menu whose last row -- which is the destructive one -- simply
 * is not there. It may overlap a card: it is a menu, it is meant to be over
 * something. It may never leave the view.
 */
describe('the action bar stays on the drawing', () => {
  /* The widest thing the bar can be: six rows, one of them refused with a
     sentence that wraps, and a quiet line under them. */
  const worst = barFootprint(
    [
      { id: 'edit', label: 'Edit prm01', enabled: { state: 'on' }, run: () => {} },
      { id: 'a', label: 'SYNC', enabled: { state: 'on' }, run: () => {} },
      { id: 'b', label: 'FASTSYNC', enabled: { state: 'off', why: WHY.fastsyncMode }, run: () => {} },
      { id: 'c', label: 'ASYNC', enabled: { state: 'on' }, run: () => {} },
      { id: 'd', label: 'Make it the primary', enabled: { state: 'on' }, run: () => {} },
      { id: 'remove', label: 'Remove prm01', enabled: { state: 'off', why: WHY.primaryMember }, run: () => {} },
    ],
    'Nothing to restore — nothing here is down.',
  );

  /* 1:1, the 1280 stage, the widest preset, and the floor the measurement is
     clamped to. */
  const SCALES = [1, 0.8, 0.61, 0.5];

  const keysOf = (d: Drawn): string[] => [
    ...d.geo.nodes.map((n) => n.key),
    ...d.geo.sites.map((s) => s.id as string),
    ...d.links.map((l) => linkKey(l)),
  ];

  const check = (d: Drawn, where: string): void => {
    const view = unionViewBox(d.geo.viewBox, routeTopology(d.doc, d.graph, d.geo, null).bounds);
    for (const key of keysOf(d)) {
      const anchor = anchorFor(key, d.geo, d.links);
      expect(anchor, `${where}: ${key} has no anchor`).not.toBeNull();
      for (const k of SCALES) {
        const scale = fittedScale(worst, view, k);
        const size = { w: worst.w / scale, h: worst.h / scale };
        const at = placeBar(anchor as Rect, size, view);
        const inside = at.x >= view.x && at.y >= view.y
          && at.x + size.w <= view.x + view.w
          && at.y + size.h <= view.y + view.h;
        expect(inside, `${where}: ${key} at scale ${k} -> ${at.x},${at.y} ${size.w}x${size.h} outside ${view.x},${view.y} ${view.w}x${view.h}`).toBe(true);
      }
    }
  };

  for (const preset of PRESETS) {
    it(`${preset.id} keeps it inside the view, at rest and while it plays`, () => {
      const doc = preset.doc();
      check(draw(doc), `${preset.id} at rest`);
      for (const { t, frame } of framesOf(doc, preset.events())) {
        check(draw(doc, frame), `${preset.id} at t=${t}`);
      }
    });
  }
});


describe('RAC instance hosts', () => {
  it('does not put the RAC database in a chassis belonging to its first host', () => {
    const doc = PRESETS.find((p) => p.id === 'rac-primary')!.doc();
    const primary = doc.members.find((m) => m.name === 'prm01')!;
    const standby = doc.members.find((m) => m.name === 'sby01')!;
    const changed = {
      ...doc,
      members: doc.members.map((m) => m === standby
        ? { ...m, instances: m.instances.map((i) => ({ ...i, host: primary.instances[0]!.host })) }
        : m),
    };
    const { geo } = draw(changed);
    expect(geo.byKey.prm01!.stackKey).toBeUndefined();
    expect(geo.byKey.prm01!.instanceHosts).toHaveLength(2);
  });

  it('draws both hosts and marks only the failed instance down', () => {
    const preset = PRESETS.find((p) => p.id === 'rac-primary')!;
    const d = draw(preset.doc());
    const node = d.geo.byKey.prm01!;
    expect(node.instanceHosts?.map((i) => [i.name, i.host])).toEqual([
      ['prm011', 'dc1-node1'], ['prm012', 'dc1-node2'],
    ]);
    expect(node.stackKey).toBeUndefined();
    const frame = stateAt(simulate(d.doc, preset.events()), 0);
    const card = cardFrameFor(d.doc, node, frame);
    expect(card.downInstances).toEqual(['prm011']);
    expect(card.down).toBe(false);
    expect(card.degraded).toBe(true);
    /* A primary has no apply instance. */
    expect(card.applyInstance).toBeUndefined();
  });

  it('marks the standby apply instance, and moves the mark when it fails', () => {
    const preset = PRESETS.find((p) => p.id === 'rac-standby')!;
    const d = draw(preset.doc());
    const node = d.geo.byKey.sby01!;
    expect(node.instanceHosts?.map((i) => i.name)).toEqual(['sby011', 'sby012']);
    /* Build mode: the instance the configuration starts on. */
    expect(cardFrameFor(d.doc, node).applyInstance).toBe('sby011');
    const card = cardFrameFor(d.doc, node, stateAt(simulate(d.doc, preset.events()), 0));
    expect(card.downInstances).toEqual(['sby011']);
    expect(card.applyInstance).toBe('sby012');
    expect(card.degraded).toBe(true);
    expect(card.applyParticipants).toEqual(['sby012']);
  });

  it('lists every instance running apply under multi-instance Redo Apply', () => {
    const preset = PRESETS.find((p) => p.id === 'rac-standby')!;
    const doc = preset.doc();
    (doc.members[1] as { applyInstances?: number | 'ALL' }).applyInstances = 'ALL';
    const d = draw(doc);
    const node = d.geo.byKey.sby01!;
    expect(cardFrameFor(d.doc, node).applyParticipants).toEqual(['sby011', 'sby012']);
    const later = cardFrameFor(d.doc, node, stateAt(simulate(d.doc, preset.events()), 1));
    expect(later.applyParticipants).toEqual(['sby012']);
  });
});

/**
 * Break's context menu shows every row, so on a card with many it is taller
 * than the ground it is given -- and in the floating layout the right-hand
 * part of the window is under the rail. With the room cut short on the right
 * (the rail) and a list far taller than any stage, the menu is cut to a scroll
 * (`menuCap`) and placed inside that room, on every preset, at every scale:
 * never under the rail, never off the stage.
 */
describe('the Break menu stays inside a room the rail has cut short', () => {
  const SCALES = [1, 0.8, 0.61, 0.5];
  const natural = 1400;

  for (const preset of PRESETS) {
    it(`${preset.id} keeps a scrolling menu out from under a right-hand rail`, () => {
      const doc = preset.doc();
      const d = draw(doc);
      const view = unionViewBox(d.geo.viewBox, routeTopology(d.doc, d.graph, d.geo, null).bounds);
      /* The ground stops a fifth of the drawing short of its right edge, and
         there is a little above and below it. */
      const room = barRoom(view, { t: 40, r: -Math.round(view.w / 5), b: 60, l: 0 });
      const keys = [
        ...d.geo.nodes.map((n) => n.key),
        ...d.geo.sites.map((st) => st.id as string),
        ...d.links.map((l) => linkKey(l)),
      ];
      for (const key of keys) {
        const anchor = anchorFor(key, d.geo, d.links) as Rect;
        for (const k of SCALES) {
          const cap = menuCap(anchor, room, k, natural);
          const css = { w: MENU_W, h: cap === null ? natural : Math.min(natural, cap) };
          const scale = fittedScale(css, room, k);
          const size = { w: css.w / scale, h: css.h / scale };
          const at = placeBar(anchor, size, room);
          const inside = at.x >= room.x - 1e-6 && at.y >= room.y - 1e-6
            && at.x + size.w <= room.x + room.w + 1e-6
            && at.y + size.h <= room.y + room.h + 1e-6;
          expect(inside, `${preset.id}: ${key} at ${k} -> ${at.x},${at.y} ${size.w}x${size.h} outside ${JSON.stringify(room)}`).toBe(true);
        }
      }
    });
  }
});
