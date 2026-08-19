/**
 * Auto-layout for the topology canvas -- ui design SS4.
 *
 * Pure and deterministic: the same document and the same resolved redo graph
 * always produce byte-identical geometry, which is what lets the layout be a
 * golden file rather than a screenshot.
 *
 * The shape of the drawing is the shape of the redo: rank comes from a BFS
 * over the resolved graph (the primary is rank 0, whatever it feeds is one
 * deeper), columns are sites ordered by the shallowest rank they hold, and
 * rows inside a site follow rank and then role. Nothing here reads the DOM.
 */

import type {
  Member, Observer, RedoGraph, SiteId, TopologyDoc,
} from '@/engine';
import { isDatabase, isFarSync } from '@/engine';
import type { CardLines, Rect } from './measure';
import { approxW, CARD, elide, fitLabel, measureCardWidth, snap8 } from './measure';

export const LAYOUT = {
  /** Site rect padding; twice this is the "max card + 28" column box. */
  colPad: 14,
  /** Free space between two column boxes -- the corridor links and pills ride. */
  corridor: 200,
  /** Before an empty panel, which no link reaches: room to see it is a panel, no more. */
  emptyGap: 40,
  /** Between two rows in one column. */
  rowGap: 18,
  /** Between two stacked members that ship redo to each other: room for the
      vertical hop and its pill (the router needs 40 px; the pill is 20 tall). */
  hopGap: 46,
  /** Between the observer band and the member band. */
  bandGap: 28,
  /** The site rect's bottom label band. */
  labelBand: 18,
  /** A cascaded standby is indented under its cascader when they share a site. */
  cascadeIndent: 24,
  padTop: 10,
  padBottom: 16,
  padSide: 10,
} as const;

export type NodeKind = 'member' | 'observer';
export type Glyph = 'db' | 'farsync' | 'snapshot' | 'observer';

export interface NodeBox {
  /**
   * The member's, observer's or site's own id. The timeline, the inspector and
   * the generated configuration lines all select by id, and the drawing has to
   * speak the same vocabulary for a selection to cross between them; a broker
   * configuration has one namespace of names, so the ids do not collide.
   */
  key: string;
  id: string;
  kind: NodeKind;
  glyph: Glyph;
  site: SiteId;
  col: number;
  row: number;
  /** Hops from the primary; -1 for the observer band, `unreachableRank` when nothing feeds it. */
  rank: number;
  unreachable: boolean;
  /** More than one instance is RAC. */
  instances: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: CardLines;
  /** The host line before elision; the aria sentence never elides. */
  hostFull: string;
  /** True when the caller's drag override moved this card. */
  moved: boolean;
}

export interface SiteBox extends Rect {
  id: SiteId;
  name: string;
  label: string;
  labelX: number;
  labelY: number;
  col: number;
  /** Nothing stands in it yet: drawn as an empty panel a card can be dropped into. */
  empty: boolean;
}

/**
 * The site's name band: the rectangle its label actually occupies.
 *
 * The label is centred on `labelX` and sits on the baseline `labelY` at 10 px
 * with a .12em letter spacing (canvas.css), so its width is the character
 * ladder plus that spacing. A caption that lands on it hides the only thing
 * that says which data centre the reader is looking at, so the router treats
 * it as an obstacle the way it treats a card.
 */
export function siteLabelRect(s: SiteBox): Rect {
  const w = Math.round(approxW(s.label, 10) + s.label.length * 1.2 + 8);
  return { x: Math.round(s.labelX - w / 2), y: Math.round(s.labelY) - 11, w, h: 15 };
}

export interface ViewBox { x: number; y: number; w: number; h: number }

export interface Geometry {
  nodes: NodeBox[];
  byKey: Record<string, NodeBox>;
  sites: SiteBox[];
  columns: { site: SiteId; x: number; w: number }[];
  viewBox: ViewBox;
  /** Above every card: the lane observer links use when they cannot go direct. */
  overLaneY: number;
  /**
   * Between the observer band and the member band: where an observer link runs
   * when a straight hop would cross another observer's card.
   */
  bandLaneY: number;
  /** Below every site rect: the lane backwards and column-skipping edges use. */
  underLaneY: number;
  maxRank: number;
  unreachableRank: number;
}

export interface LayoutOffset { dx: number; dy: number }

export interface LayoutOptions {
  /** Drag overrides, keyed by node key, snapped to 8 px. */
  overrides?: Readonly<Record<string, LayoutOffset>>;
}

/** The key a node is selected, hovered and dragged by: its own id. */
export const nodeKey = (_kind: NodeKind, id: string): string => id;

const ROLE_ORDER: Record<string, number> = {
  primary: 0, farsync: 1, physical: 2, logical: 3, snapshot: 4,
};

export function roleWord(m: Member): string {
  if (isFarSync(m)) return 'Far sync';
  switch (m.role) {
    case 'primary': return 'Primary';
    case 'physical': return 'Physical standby';
    case 'logical': return 'Logical standby';
    case 'snapshot': return 'Snapshot standby';
  }
}

function roleKey(m: Member): number {
  if (isFarSync(m)) return ROLE_ORDER.farsync as number;
  return ROLE_ORDER[m.role] ?? 9;
}

export function glyphOf(m: Member): Glyph {
  if (isFarSync(m)) return 'farsync';
  if (isDatabase(m) && m.role === 'snapshot') return 'snapshot';
  return 'db';
}

const hostName = (doc: TopologyDoc, id: string): string =>
  doc.hosts.find((h) => (h.id as string) === id)?.name ?? id;

/** The host line of a member card: the first instance, RAC or not. */
export function memberHostLine(doc: TopologyDoc, m: Member): string {
  const first = m.instances[0];
  return first ? hostName(doc, first.host as string) : '';
}

function memberLines(doc: TopologyDoc, m: Member): CardLines {
  const host = memberHostLine(doc, m);
  return { name: roleWord(m), host: elide(host), sub: m.name };
}

function observerLines(doc: TopologyDoc, o: Observer): CardLines {
  const host = hostName(doc, o.host as string);
  const both = `${o.name}, ${host}`;
  const line = fitLabel([both, host], CARD.maxW - CARD.textXObs - CARD.padRight) ?? elide(host);
  return { name: 'Observer', host: elide(line, 24) };
}

interface Placed {
  node: NodeBox;
  indent: number;
}

/**
 * Rank: the BFS depth the resolver already computed. A member nothing feeds
 * sits one column past the deepest reachable one, so "no redo reaches this"
 * reads as a place on the drawing rather than as a missing line.
 */
function ranksOf(doc: TopologyDoc, graph: RedoGraph): {
  rank: Map<string, number>; maxRank: number; unreachableRank: number;
} {
  const rank = new Map<string, number>();
  let maxDepth = 0;
  for (const m of doc.members) {
    const d = graph.members[m.id]?.depth ?? -1;
    if (d >= 0) maxDepth = Math.max(maxDepth, d);
  }
  const unreachableRank = maxDepth + 1;
  for (const m of doc.members) {
    const d = graph.members[m.id]?.depth ?? -1;
    rank.set(m.id as string, d >= 0 ? d : unreachableRank);
  }
  return { rank, maxRank: maxDepth, unreachableRank };
}

/** The member that feeds this one, from the resolved feed path. */
function feederOf(graph: RedoGraph, id: string): string | null {
  const rm = Object.values(graph.members).find((r) => (r.id as string) === id);
  if (!rm || rm.feedPath.length < 2) return null;
  const prev = rm.feedPath[rm.feedPath.length - 2];
  return prev === undefined ? null : (prev as string);
}

export function layoutTopology(
  doc: TopologyDoc, graph: RedoGraph, opts: LayoutOptions = {},
): Geometry {
  const { rank, maxRank, unreachableRank } = ranksOf(doc, graph);
  const siteIndex = new Map<string, number>();
  doc.sites.forEach((s, i) => siteIndex.set(s.id as string, i));
  const siteOfHost = new Map<string, string>();
  for (const h of doc.hosts) siteOfHost.set(h.id as string, h.site as string);

  const memberSite = (m: Member): string => {
    const first = m.instances[0];
    return (first && siteOfHost.get(first.host as string)) ?? (doc.sites[0]?.id as string) ?? '';
  };

  /* ---- 1. group nodes by site ---- */
  const membersBySite = new Map<string, Member[]>();
  for (const m of doc.members) {
    const s = memberSite(m);
    const list = membersBySite.get(s) ?? [];
    list.push(m);
    membersBySite.set(s, list);
  }
  const observersBySite = new Map<string, Observer[]>();
  for (const o of doc.observers) {
    const s = siteOfHost.get(o.host as string) ?? '';
    const list = observersBySite.get(s) ?? [];
    list.push(o);
    observersBySite.set(s, list);
  }

  /* ---- 2. column order: sites by the shallowest rank they hold ---- */
  const occupied = (s: string): boolean =>
    (membersBySite.get(s)?.length ?? 0) + (observersBySite.get(s)?.length ?? 0) > 0;
  const siteIds = doc.sites.map((s) => s.id as string).filter(occupied);
  /* A data centre with nothing in it yet is still drawn -- as an empty panel
     past the last occupied column, so "Add a data centre" puts something on
     the drawing and a card can be dragged into it. Last, so it moves nothing
     that was already placed. */
  const emptySites = doc.sites.map((s) => s.id as string).filter((s) => !occupied(s));

  const columnKey = (s: string): number => {
    const ms = membersBySite.get(s) ?? [];
    if (ms.length === 0) return 0.5; /* observers only: the third site sits between */
    return Math.min(...ms.map((m) => rank.get(m.id as string) ?? unreachableRank));
  };
  const ordered = [
    ...[...siteIds].sort((a, b) => {
      const ka = columnKey(a); const kb = columnKey(b);
      if (ka !== kb) return ka - kb;
      return (siteIndex.get(a) ?? 0) - (siteIndex.get(b) ?? 0);
    }),
    ...emptySites,
  ];

  /* ---- 3. rows inside a column ---- */
  const columns = ordered.map((s, col) => {
    const obs = [...(observersBySite.get(s) ?? [])];
    const mems = [...(membersBySite.get(s) ?? [])].sort((a, b) => {
      const ra = rank.get(a.id as string) ?? 0; const rb = rank.get(b.id as string) ?? 0;
      if (ra !== rb) return ra - rb;
      const ka = roleKey(a); const kb = roleKey(b);
      if (ka !== kb) return ka - kb;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return { site: s as SiteId, col, obs, mems };
  });

  /* ---- 4. measure ---- */
  const memberCards = new Map<string, { lines: CardLines; w: number; hostFull: string }>();
  for (const m of doc.members) {
    const lines = memberLines(doc, m);
    memberCards.set(m.id as string, {
      lines, w: measureCardWidth(lines, false), hostFull: memberHostLine(doc, m),
    });
  }
  const observerCards = new Map<string, { lines: CardLines; w: number; hostFull: string }>();
  for (const o of doc.observers) {
    const lines = observerLines(doc, o);
    observerCards.set(o.id as string, {
      lines, w: measureCardWidth(lines, true), hostFull: hostName(doc, o.host as string),
    });
  }

  const colW = columns.map((c) => {
    const widths = [
      ...c.mems.map((m) => memberCards.get(m.id as string)?.w ?? CARD.minW),
      ...c.obs.map((o) => observerCards.get(o.id as string)?.w ?? CARD.minW),
    ];
    const indent = c.mems.some((m) => sameSiteCascade(doc, graph, m, memberSite))
      ? LAYOUT.cascadeIndent : 0;
    return Math.max(CARD.minW, ...widths) + indent + LAYOUT.colPad * 2;
  });

  const colX: number[] = [];
  let cursor = 0;
  for (let i = 0; i < columns.length; i++) {
    colX.push(cursor);
    const nextEmpty = (columns[i + 1]?.mems.length ?? 1) + (columns[i + 1]?.obs.length ?? 1) === 0;
    cursor += (colW[i] ?? 0) + (nextEmpty ? LAYOUT.emptyGap : LAYOUT.corridor);
  }

  /* ---- 5. bands ---- */
  /* Two stacked cards that ship redo to each other (a far sync beside its
     primary, a same-site cascade) get a taller gap, so the hop between them
     runs straight down the column with its pill in the gap instead of looping
     out round the side of the site and sharing a segment with the next link. */
  const hop = (a: Member, b: Member): boolean => graph.edges.some((e) =>
    ((e.from as string) === (a.id as string) && (e.to as string) === (b.id as string))
    || ((e.from as string) === (b.id as string) && (e.to as string) === (a.id as string)));
  const memGaps: number[][] = columns.map((c) => c.mems.map((m, i): number => {
    const next = c.mems[i + 1];
    if (!next) return 0;
    return hop(m, next) ? LAYOUT.hopGap : LAYOUT.rowGap;
  }));
  const obsStackH = columns.map((c) =>
    c.obs.length === 0 ? 0 : c.obs.length * CARD.obsH + (c.obs.length - 1) * LAYOUT.rowGap);
  const memStackH = columns.map((c, ci) =>
    c.mems.length === 0
      ? 0
      : c.mems.length * CARD.dbH + (memGaps[ci] ?? []).reduce((acc: number, g) => acc + g, 0));
  const bandH = Math.max(0, ...obsStackH);
  const memberBandTop = bandH === 0 ? 0 : bandH + LAYOUT.bandGap;
  const memberBandH = Math.max(0, ...memStackH);

  /* ---- 6. place ---- */
  const overrides = opts.overrides ?? {};
  const placed: Placed[] = [];
  columns.forEach((c, ci) => {
    const cw = colW[ci] ?? CARD.minW;
    const cx = colX[ci] ?? 0;
    /* Observers bottom-align in the band: a single one always sits directly
       above the member band, whatever another site stacked up there. */
    let oy = bandH - (obsStackH[ci] ?? 0);
    c.obs.forEach((o, row) => {
      const card = observerCards.get(o.id as string);
      const w = card?.w ?? CARD.minW;
      placed.push({
        indent: 0,
        node: {
          key: nodeKey('observer', o.id as string),
          id: o.id as string,
          kind: 'observer',
          glyph: 'observer',
          site: c.site,
          col: ci,
          row,
          rank: -1,
          unreachable: false,
          instances: 1,
          x: Math.round(cx + (cw - w) / 2),
          y: Math.round(oy),
          w,
          h: CARD.obsH,
          lines: card?.lines ?? { name: 'Observer' },
          hostFull: card?.hostFull ?? '',
          moved: false,
        },
      });
      oy += CARD.obsH + LAYOUT.rowGap;
    });

    /* Member stacks centre on one line, so the classic primary-to-standby
       redo edge comes out horizontal. */
    let my = memberBandTop + Math.round((memberBandH - (memStackH[ci] ?? 0)) / 2);
    c.mems.forEach((m, row) => {
      const card = memberCards.get(m.id as string);
      const w = card?.w ?? CARD.minW;
      const indent = sameSiteCascade(doc, graph, m, memberSite) ? LAYOUT.cascadeIndent : 0;
      const r = rank.get(m.id as string) ?? unreachableRank;
      placed.push({
        indent,
        node: {
          key: nodeKey('member', m.id as string),
          id: m.id as string,
          kind: 'member',
          glyph: glyphOf(m),
          site: c.site,
          col: ci,
          row,
          rank: r,
          unreachable: r >= unreachableRank && unreachableRank > 0,
          instances: m.instances.length,
          x: Math.round(cx + (cw - w) / 2 + indent),
          y: Math.round(my),
          w,
          h: CARD.dbH,
          lines: card?.lines ?? { name: roleWord(m) },
          hostFull: card?.hostFull ?? '',
          moved: false,
        },
      });
      my += CARD.dbH + (memGaps[ci]?.[row] ?? LAYOUT.rowGap);
    });
  });

  /* ---- 7. drag overrides, snapped ---- */
  const nodes = placed.map(({ node }) => {
    const ov = overrides[node.key];
    if (!ov) return node;
    const dx = snap8(ov.dx); const dy = snap8(ov.dy);
    if (dx === 0 && dy === 0) return node;
    return { ...node, x: node.x + dx, y: node.y + dy, moved: true };
  });

  const byKey: Record<string, NodeBox> = {};
  for (const n of nodes) byKey[n.key] = n;

  /* ---- 8. site rects, recomputed after the overrides moved cards ---- */
  const sites: SiteBox[] = [];
  columns.forEach((c, ci) => {
    const own = nodes.filter((n) => (n.site as string) === (c.site as string));
    let x0: number; let y0: number; let x1: number; let y1: number;
    if (own.length === 0) {
      /* The empty panel: one column wide, the member band tall -- or one card
         tall when there is no member band to match. */
      const cx = colX[ci] ?? 0;
      const cw = colW[ci] ?? CARD.minW + LAYOUT.colPad * 2;
      const top = memberBandTop;
      const tall = Math.max(memberBandH, CARD.dbH);
      x0 = cx; x1 = cx + cw;
      y0 = top - LAYOUT.colPad;
      y1 = top + tall + LAYOUT.colPad + LAYOUT.labelBand;
    } else {
      x0 = Math.min(...own.map((n) => n.x)) - LAYOUT.colPad;
      y0 = Math.min(...own.map((n) => n.y)) - LAYOUT.colPad;
      x1 = Math.max(...own.map((n) => n.x + n.w)) + LAYOUT.colPad;
      y1 = Math.max(...own.map((n) => n.y + n.h)) + LAYOUT.colPad + LAYOUT.labelBand;
    }
    const site = doc.sites.find((s) => (s.id as string) === (c.site as string));
    const name = site?.name ?? (c.site as string);
    sites.push({
      id: c.site,
      name,
      label: fitLabel([name], x1 - x0 - 40) ?? name,
      x: x0, y: y0, w: x1 - x0, h: y1 - y0,
      labelX: Math.round(x0 + (x1 - x0) / 2),
      labelY: y1 - 5,
      col: ci,
      empty: own.length === 0,
    });
  });

  const boxes: Rect[] = sites.length > 0 ? sites : nodes;
  const vx0 = boxes.length === 0 ? 0 : Math.min(...boxes.map((b) => b.x));
  const vy0 = boxes.length === 0 ? 0 : Math.min(...boxes.map((b) => b.y));
  const vx1 = boxes.length === 0 ? 200 : Math.max(...boxes.map((b) => b.x + b.w));
  const vy1 = boxes.length === 0 ? 120 : Math.max(...boxes.map((b) => b.y + b.h));

  return {
    nodes,
    byKey,
    sites,
    columns: columns.map((c, i) => ({ site: c.site, x: colX[i] ?? 0, w: colW[i] ?? 0 })),
    viewBox: {
      x: vx0 - LAYOUT.padSide,
      y: vy0 - LAYOUT.padTop,
      w: (vx1 + LAYOUT.padSide) - (vx0 - LAYOUT.padSide),
      h: (vy1 + LAYOUT.padBottom) - (vy0 - LAYOUT.padTop),
    },
    overLaneY: vy0 - LAYOUT.padTop + 2,
    bandLaneY: bandH === 0 ? vy0 - LAYOUT.padTop + 2 : memberBandTop - 10,
    underLaneY: vy1 + 4,
    maxRank,
    unreachableRank,
  };
}

/** A cascaded member whose feeder shares its site is indented under it. */
function sameSiteCascade(
  doc: TopologyDoc, graph: RedoGraph, m: Member, siteOf: (m: Member) => string,
): boolean {
  const feeder = feederOf(graph, m.id as string);
  if (feeder === null || feeder === (graph.primary as string)) return false;
  const fm = doc.members.find((x) => (x.id as string) === feeder);
  if (!fm) return false;
  return siteOf(fm) === siteOf(m);
}

/** Centre of a card, the anchor every port is measured from. */
export const centreOf = (n: NodeBox): { x: number; y: number } => ({
  x: n.x + n.w / 2, y: n.y + n.h / 2,
});
