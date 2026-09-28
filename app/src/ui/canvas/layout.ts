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
  /**
   * Two or more cards on one host snap into a chassis stack: one header band
   * naming the host, the blades touching under it with no row gap between
   * them (a divider line stands in for the gap instead).
   */
  stackHeaderH: 18,
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
  instanceHosts?: { name: string; host: string; site: string }[];
  x: number;
  y: number;
  w: number;
  h: number;
  lines: CardLines;
  /** The host line before elision; the aria sentence never elides. */
  hostFull: string;
  /** True when the caller's drag override moved this card. */
  moved: boolean;
  /** Set when 2+ occupants share this card's host: the chassis stack's key
      (`stack:<hostId>`), the same one on every blade of that stack and on
      the matching entry in `Geometry.stacks`. Undefined for a card alone on
      its host, which draws exactly as it always has. */
  stackKey?: string;
}

export interface StackBox extends Rect {
  /** `stack:<hostId>` -- shared with every blade's `NodeBox.stackKey`. */
  key: string;
  hostId: string;
  site: SiteId;
  /** The header band's own height, at the top of this rect. */
  headerH: number;
  /** The host name, fitted to the stack's width. */
  label: string;
  /** Every blade's key, top to bottom -- what a press on the header carries. */
  memberKeys: string[];
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
  /**
   * The smallest box this data centre may be drawn at: its cards and stack
   * headers plus the padding and the name band -- what a resize may not cut
   * into. For an empty panel, the empty panel's own default box.
   */
  fit: Rect;
  /**
   * The origin a stored size is measured from: the top-left corner of the
   * box the layout would draw with no card moved by hand. A sized override's
   * `dx`/`dy` are relative to it, so the box travels with its column when an
   * addition elsewhere moves the columns.
   */
  anchor: { x: number; y: number };
  /** The reader gave it a size of its own (`LayoutOffset.w`/`h`). */
  sized: boolean;
}

/** The minimum a data centre may be resized to when nothing stands in it. */
export const SITE_MIN = { w: 120, h: 64 } as const;

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
  /** One entry per chassis stack on the drawing -- the header band and the
      outer frame around its blades. Empty where nothing is co-hosted. */
  stacks: StackBox[];
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

/**
 * A hand-made offset. Under a data centre's key it may also carry `w`/`h`,
 * the size the reader gave the box (doc.ts `LayoutOverride`).
 */
export interface LayoutOffset { dx: number; dy: number; w?: number; h?: number }

export interface LayoutOptions {
  /** Drag overrides, keyed by node key, snapped to 8 px. */
  overrides?: Readonly<Record<string, LayoutOffset>>;
  /**
   * Cards being carried right now. Their overrides are drawn, but nothing
   * makes way for them (step 7b) until they are let go: a card slid across
   * another must not shove it aside mid-air, or the host the reader is aiming
   * a merge at would jump out from under the pointer.
   */
  transient?: readonly string[];
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

/** Every host belonging to the database, including all RAC nodes. */
export function memberHostLine(doc: TopologyDoc, m: Member): string {
  return [...new Set(m.instances.map((i) => hostName(doc, i.host as string)))].join(', ');
}

/**
 * The card's big title is always the stored name -- a member's or an
 * observer's `id`/`name` stay equal (`renameMember`, `renameObserver`), so
 * the title a reader renamed is the title the card keeps showing. The role
 * word moves to the small line under it, which is where the name used to
 * sit: a card that renders "Primary" no matter what the reader typed is a
 * rename that silently reverted on the drawing while the document kept it.
 */
function memberLines(doc: TopologyDoc, m: Member): CardLines {
  const host = memberHostLine(doc, m);
  const avail = CARD.maxW - CARD.textXDb - CARD.padRight;
  const name = fitLabel([m.name], avail) ?? elide(m.name, 26);
  return m.instances.length > 1
    ? { name, host: roleWord(m), sub: 'Shared database' }
    : { name, host: elide(host), sub: roleWord(m) };
}

/** A member's blade inside a chassis stack: the host line moves to the shared
    header, so the card keeps only its name and role word. */
function stackedMemberLines(m: Member): CardLines {
  const avail = CARD.maxW - CARD.textXDb - CARD.padRight;
  const name = fitLabel([m.name], avail) ?? elide(m.name, 26);
  return { name, sub: roleWord(m) };
}

/** An observer's blade inside a chassis stack: "Observer" stands in for the
    host, which the header already names once for the whole stack. */
function stackedObserverLines(o: Observer): CardLines {
  const avail = CARD.maxW - CARD.textXObs - CARD.padRight;
  const name = fitLabel([o.name], avail) ?? elide(o.name, 24);
  return { name, host: 'Observer' };
}

function observerLines(doc: TopologyDoc, o: Observer): CardLines {
  const host = hostName(doc, o.host as string);
  const avail = CARD.maxW - CARD.textXObs - CARD.padRight;
  const name = fitLabel([o.name], avail) ?? elide(o.name, 24);
  /* An observer card has room for two lines, not three (`CARD.obsH`), so the
     role word rides on the host line beside it rather than on a sub line
     that would need a taller card -- the same fitting the name line above
     went through, falling back to the host alone when even that is tight. */
  const combined = `Observer, ${host}`;
  const roled = fitLabel([combined, host], avail) ?? elide(host);
  return { name, host: roled };
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

  /* ---- 3b. chassis stacks: 2+ occupants sharing a host snap into one ----
     A host belongs to one site, so grouping by host id is grouping within a
     site for free. A single-occupant host never appears in `hostGroups` with
     two or more entries, so it never enters a row below -- its card renders
     exactly as it always has. */
  const hostOfMember = (m: Member): string | undefined => m.instances.length === 1 ? m.instances[0]?.host as string | undefined : undefined;
  const hostGroups = new Map<string, { members: Member[]; observers: Observer[] }>();
  for (const m of doc.members) {
    const h = hostOfMember(m);
    if (h === undefined) continue;
    const g = hostGroups.get(h) ?? { members: [], observers: [] };
    g.members.push(m);
    hostGroups.set(h, g);
  }
  for (const o of doc.observers) {
    const h = o.host as string;
    const g = hostGroups.get(h) ?? { members: [], observers: [] };
    g.observers.push(o);
    hostGroups.set(h, g);
  }
  const groupSize = (h: string | undefined): number => {
    if (h === undefined) return 0;
    const g = hostGroups.get(h);
    return g ? g.members.length + g.observers.length : 0;
  };
  const isStackedMember = (m: Member): boolean => groupSize(hostOfMember(m)) >= 2;
  const isStackedObserver = (o: Observer): boolean => groupSize(o.host as string) >= 2;
  const byName = (a: { name: string }, b: { name: string }): number =>
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const stackKeyOf = (hostId: string): string => `stack:${hostId}`;
  const stackHeaderW = (hostId: string): number =>
    Math.ceil(approxW(hostName(doc, hostId), 10.5, true) + 20);

  interface MemRow { rep: Member; hostId?: string; members: Member[]; observers: Observer[] }
  interface ObsRow { rep: Observer; hostId?: string; observers: Observer[] }

  /** One row per member, folding every co-hosted member and observer after
      the first occurrence into that first member's row. */
  const memRowsOf = (mems: Member[]): MemRow[] => {
    const seen = new Set<string>();
    const rows: MemRow[] = [];
    for (const m of mems) {
      const h = hostOfMember(m);
      if (h !== undefined && groupSize(h) >= 2) {
        if (seen.has(h)) continue;
        seen.add(h);
        const g = hostGroups.get(h) as { members: Member[]; observers: Observer[] };
        rows.push({
          rep: m, hostId: h, members: [...g.members].sort(memberRoleCmp), observers: [...g.observers].sort(byName),
        });
      } else {
        rows.push({ rep: m, members: [m], observers: [] });
      }
    }
    return rows;
  };
  function memberRoleCmp(a: Member, b: Member): number {
    const ra = rank.get(a.id as string) ?? 0; const rb = rank.get(b.id as string) ?? 0;
    if (ra !== rb) return ra - rb;
    const ka = roleKey(a); const kb = roleKey(b);
    if (ka !== kb) return ka - kb;
    return byName(a, b);
  }
  /** One row per observer not already folded into a member's row above --
      an observer alone with another observer on a host with no member still
      snaps into its own chassis stack, in the observer band. */
  const obsRowsOf = (obs: Observer[]): ObsRow[] => {
    const seen = new Set<string>();
    const rows: ObsRow[] = [];
    for (const o of obs) {
      const h = o.host as string;
      const g = hostGroups.get(h);
      if (g && g.members.length > 0) continue;
      if (g && g.members.length + g.observers.length >= 2) {
        if (seen.has(h)) continue;
        seen.add(h);
        rows.push({ rep: o, hostId: h, observers: [...g.observers].sort(byName) });
      } else {
        rows.push({ rep: o, observers: [o] });
      }
    }
    return rows;
  };
  const memRowsByCol = columns.map((c) => memRowsOf(c.mems));
  const obsRowsByCol = columns.map((c) => obsRowsOf(c.obs));

  /* ---- 4. measure ---- */
  const memberCards = new Map<string, { lines: CardLines; w: number; hostFull: string }>();
  for (const m of doc.members) {
    const lines = isStackedMember(m) ? stackedMemberLines(m) : memberLines(doc, m);
    memberCards.set(m.id as string, {
      lines, w: m.instances.length > 1 ? CARD.maxW : measureCardWidth(lines, false), hostFull: memberHostLine(doc, m),
    });
  }
  const observerCards = new Map<string, { lines: CardLines; w: number; hostFull: string }>();
  for (const o of doc.observers) {
    const lines = isStackedObserver(o) ? stackedObserverLines(o) : observerLines(doc, o);
    observerCards.set(o.id as string, {
      lines, w: measureCardWidth(lines, true), hostFull: hostName(doc, o.host as string),
    });
  }

  const memRowWidth = (row: MemRow): number => (row.hostId === undefined
    ? memberCards.get(row.rep.id as string)?.w ?? CARD.minW
    : Math.max(
      stackHeaderW(row.hostId),
      ...row.members.map((m) => memberCards.get(m.id as string)?.w ?? CARD.minW),
      ...row.observers.map((o) => observerCards.get(o.id as string)?.w ?? CARD.minW),
    ));
  const obsRowWidth = (row: ObsRow): number => (row.hostId === undefined
    ? observerCards.get(row.rep.id as string)?.w ?? CARD.minW
    : Math.max(stackHeaderW(row.hostId), ...row.observers.map((o) => observerCards.get(o.id as string)?.w ?? CARD.minW)));
  const memberHeight = (m: Member): number => CARD.dbH + (m.instances.length > 1 ? m.instances.length * CARD.instanceRowH + CARD.instanceBottomPad : 0);
  const memRowHeight = (row: MemRow): number => (row.hostId === undefined
    ? memberHeight(row.rep)
    : LAYOUT.stackHeaderH + row.members.length * CARD.dbH + row.observers.length * CARD.obsH);
  const obsRowHeight = (row: ObsRow): number => (row.hostId === undefined
    ? CARD.obsH
    : LAYOUT.stackHeaderH + row.observers.length * CARD.obsH);

  const colW = columns.map((c, ci) => {
    const widths = [
      ...(memRowsByCol[ci] ?? []).map(memRowWidth),
      ...(obsRowsByCol[ci] ?? []).map(obsRowWidth),
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
  const memGaps: number[][] = memRowsByCol.map((rows) => rows.map((row, i): number => {
    const next = rows[i + 1];
    if (!next) return 0;
    return hop(row.rep, next.rep) ? LAYOUT.hopGap : LAYOUT.rowGap;
  }));
  const obsStackH = obsRowsByCol.map((rows) => (rows.length === 0
    ? 0
    : rows.reduce((acc, r) => acc + obsRowHeight(r), 0) + (rows.length - 1) * LAYOUT.rowGap));
  const memStackH = memRowsByCol.map((rows, ci) => (rows.length === 0
    ? 0
    : rows.reduce((acc, r) => acc + memRowHeight(r), 0) + (memGaps[ci] ?? []).reduce((acc: number, g) => acc + g, 0)));
  const bandH = Math.max(0, ...obsStackH);
  const memberBandTop = bandH === 0 ? 0 : bandH + LAYOUT.bandGap;
  const memberBandH = Math.max(0, ...memStackH);

  /* ---- 6. place ---- */
  const overrides = opts.overrides ?? {};
  const placed: Placed[] = [];
  interface StackDef {
    key: string; hostId: string; site: SiteId; label: string; w: number; memberKeys: string[];
  }
  const stackDefs: StackDef[] = [];
  columns.forEach((c, ci) => {
    const cw = colW[ci] ?? CARD.minW;
    const cx = colX[ci] ?? 0;
    /* Observers bottom-align in the band: a single one always sits directly
       above the member band, whatever another site stacked up there. */
    let oy = bandH - (obsStackH[ci] ?? 0);
    (obsRowsByCol[ci] ?? []).forEach((row, rowIdx) => {
      const w = obsRowWidth(row);
      const x = Math.round(cx + (cw - w) / 2);
      const rowTop = Math.round(oy);
      if (row.hostId === undefined) {
        const o = row.rep;
        const card = observerCards.get(o.id as string);
        placed.push({
          indent: 0,
          node: {
            key: nodeKey('observer', o.id as string),
            id: o.id as string,
            kind: 'observer',
            glyph: 'observer',
            site: c.site,
            col: ci,
            row: rowIdx,
            rank: -1,
            unreachable: false,
            instances: 1,
            x,
            y: rowTop,
            w,
            h: CARD.obsH,
            lines: card?.lines ?? { name: o.name },
            hostFull: card?.hostFull ?? '',
            moved: false,
          },
        });
      } else {
        const skey = stackKeyOf(row.hostId);
        const memberKeys: string[] = [];
        let by = rowTop + LAYOUT.stackHeaderH;
        row.observers.forEach((o) => {
          const card = observerCards.get(o.id as string);
          const key = nodeKey('observer', o.id as string);
          memberKeys.push(key);
          placed.push({
            indent: 0,
            node: {
              key,
              id: o.id as string,
              kind: 'observer',
              glyph: 'observer',
              site: c.site,
              col: ci,
              row: rowIdx,
              rank: -1,
              unreachable: false,
              instances: 1,
              x,
              y: by,
              w,
              h: CARD.obsH,
              lines: card?.lines ?? { name: o.name },
              hostFull: card?.hostFull ?? '',
              moved: false,
              stackKey: skey,
            },
          });
          by += CARD.obsH;
        });
        stackDefs.push({
          key: skey,
          hostId: row.hostId,
          site: c.site,
          label: fitLabel([hostName(doc, row.hostId)], w - 16) ?? elide(hostName(doc, row.hostId), 16),
          w,
          memberKeys,
        });
      }
      oy += obsRowHeight(row) + LAYOUT.rowGap;
    });

    /* Member stacks centre on one line, so the classic primary-to-standby
       redo edge comes out horizontal. */
    let my = memberBandTop + Math.round((memberBandH - (memStackH[ci] ?? 0)) / 2);
    (memRowsByCol[ci] ?? []).forEach((row, rowIdx) => {
      const w = memRowWidth(row);
      const indent = row.hostId === undefined && sameSiteCascade(doc, graph, row.rep, memberSite)
        ? LAYOUT.cascadeIndent : 0;
      const x = Math.round(cx + (cw - w) / 2 + indent);
      const rowTop = Math.round(my);
      if (row.hostId === undefined) {
        const m = row.rep;
        const card = memberCards.get(m.id as string);
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
            row: rowIdx,
            rank: r,
            unreachable: r >= unreachableRank && unreachableRank > 0,
            instances: m.instances.length,
            x,
            y: rowTop,
            w,
            h: memberHeight(m),
            ...(m.instances.length > 1 ? { instanceHosts: m.instances.map((i) => {
              const host = doc.hosts.find((h) => h.id === i.host);
              const site = doc.sites.find((s) => s.id === host?.site);
              return { name: i.name, host: host?.name ?? i.host as string, site: site?.name ?? '' };
            }) } : {}),
            lines: card?.lines ?? { name: m.name },
            hostFull: card?.hostFull ?? '',
            moved: false,
          },
        });
      } else {
        const skey = stackKeyOf(row.hostId);
        const memberKeys: string[] = [];
        let by = rowTop + LAYOUT.stackHeaderH;
        row.members.forEach((m) => {
          const card = memberCards.get(m.id as string);
          const r = rank.get(m.id as string) ?? unreachableRank;
          const key = nodeKey('member', m.id as string);
          memberKeys.push(key);
          placed.push({
            indent: 0,
            node: {
              key,
              id: m.id as string,
              kind: 'member',
              glyph: glyphOf(m),
              site: c.site,
              col: ci,
              row: rowIdx,
              rank: r,
              unreachable: r >= unreachableRank && unreachableRank > 0,
              instances: m.instances.length,
              x,
              y: by,
              w,
              h: CARD.dbH,
              lines: card?.lines ?? { name: m.name },
              hostFull: card?.hostFull ?? '',
              moved: false,
              stackKey: skey,
            },
          });
          by += CARD.dbH;
        });
        row.observers.forEach((o) => {
          const card = observerCards.get(o.id as string);
          const key = nodeKey('observer', o.id as string);
          memberKeys.push(key);
          placed.push({
            indent: 0,
            node: {
              key,
              id: o.id as string,
              kind: 'observer',
              glyph: 'observer',
              site: c.site,
              col: ci,
              row: rowIdx,
              rank: -1,
              unreachable: false,
              instances: 1,
              x,
              y: by,
              w,
              h: CARD.obsH,
              lines: card?.lines ?? { name: o.name },
              hostFull: card?.hostFull ?? '',
              moved: false,
              stackKey: skey,
            },
          });
          by += CARD.obsH;
        });
        stackDefs.push({
          key: skey,
          hostId: row.hostId,
          site: c.site,
          label: fitLabel([hostName(doc, row.hostId)], w - 16) ?? elide(hostName(doc, row.hostId), 16),
          w,
          memberKeys,
        });
      }
      my += memRowHeight(row) + (memGaps[ci]?.[rowIdx] ?? LAYOUT.rowGap);
    });
  });

  /* ---- 7. drag overrides, snapped ---- */
  const nodes = makeWay(opts.transient ?? [], placed.map(({ node }) => {
    const ov = overrides[node.key];
    if (!ov) return node;
    const dx = snap8(ov.dx); const dy = snap8(ov.dy);
    if (dx === 0 && dy === 0) return node;
    return { ...node, x: node.x + dx, y: node.y + dy, moved: true };
  }));

  const byKey: Record<string, NodeBox> = {};
  for (const n of nodes) byKey[n.key] = n;

  /* Stack rects are derived from the blades' own (already overridden) rects,
     never recomputed from the pre-drag geometry -- so a stack dragged as a
     group still reads as one touching chassis wherever the drag left it. */
  const stacks: StackBox[] = stackDefs.map((sd) => {
    const blades = sd.memberKeys.map((k) => byKey[k]).filter((n): n is NodeBox => n !== undefined);
    const x = blades[0]?.x ?? 0;
    const yTop = (blades.length === 0 ? 0 : Math.min(...blades.map((b) => b.y))) - LAYOUT.stackHeaderH;
    const yBottom = blades.length === 0 ? 0 : Math.max(...blades.map((b) => b.y + b.h));
    const w = blades.length === 0 ? sd.w : Math.max(...blades.map((b) => b.w));
    return {
      key: sd.key, hostId: sd.hostId, site: sd.site, headerH: LAYOUT.stackHeaderH, label: sd.label,
      x, y: yTop, w, h: yBottom - yTop, memberKeys: sd.memberKeys,
    };
  });

  /* ---- 8. site rects, recomputed after the overrides moved cards ---- */
  /* The box around a set of cards: their extent, a stack's header above its
     top blade (a blade's own `y` is under the header, so `y - headerH` is the
     stack's top for the top blade and inside the stack for the others), the
     padding, and the name band at the bottom. */
  const boxAround = (list: readonly NodeBox[]): { x0: number; y0: number; x1: number; y1: number } => ({
    x0: Math.min(...list.map((n) => n.x)) - LAYOUT.colPad,
    y0: Math.min(...list.map((n) => (n.stackKey === undefined ? n.y : n.y - LAYOUT.stackHeaderH))) - LAYOUT.colPad,
    x1: Math.max(...list.map((n) => n.x + n.w)) + LAYOUT.colPad,
    y1: Math.max(...list.map((n) => n.y + n.h)) + LAYOUT.colPad + LAYOUT.labelBand,
  });
  const sites: SiteBox[] = [];
  columns.forEach((c, ci) => {
    const own = nodes.filter((n) => (n.site as string) === (c.site as string));
    const ov = overrides[c.site as string];
    const sized = ov !== undefined && typeof ov.w === 'number' && typeof ov.h === 'number'
      && isFinite(ov.w) && isFinite(ov.h);
    let x0: number; let y0: number; let x1: number; let y1: number;
    let anchor: { x: number; y: number };
    let fit: Rect;
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
      anchor = { x: x0, y: y0 };
      fit = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      /* The one place a site-keyed offset is read without a size: an empty
         panel has no member whose own drag would carry it, so a drag on the
         panel itself (`TopoCanvas` `onSitePointerDown`) writes its delta
         under the site's own id instead. */
      if (ov && !sized) {
        const dx = snap8(ov.dx); const dy = snap8(ov.dy);
        x0 += dx; x1 += dx; y0 += dy; y1 += dy;
        fit = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    } else {
      const natural = boxAround(placed
        .map((p) => p.node)
        .filter((n) => (n.site as string) === (c.site as string)));
      anchor = { x: natural.x0, y: natural.y0 };
      ({ x0, y0, x1, y1 } = boxAround(own));
      fit = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    /* A size of its own: the stored box, grown to whatever it has to hold --
       never smaller than its cards, whatever the link or the file says. */
    if (sized) {
      const bx = anchor.x + Math.round(ov.dx);
      const by = anchor.y + Math.round(ov.dy);
      const bw = Math.max(own.length === 0 ? SITE_MIN.w : 0, Math.round(ov.w as number));
      const bh = Math.max(own.length === 0 ? SITE_MIN.h : 0, Math.round(ov.h as number));
      if (own.length === 0) {
        x0 = bx; y0 = by; x1 = bx + bw; y1 = by + bh;
        fit = { x: x0, y: y0, w: SITE_MIN.w, h: SITE_MIN.h };
      } else {
        x0 = Math.min(x0, bx); y0 = Math.min(y0, by);
        x1 = Math.max(x1, bx + bw); y1 = Math.max(y1, by + bh);
      }
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
      fit,
      anchor,
      sized,
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
    stacks,
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

/**
 * Step 7b: a card the layout placed makes way for one the reader placed.
 *
 * The auto-layout never overlaps two of its own cards, but a card moved by
 * hand keeps its offset from a slot the layout may since have given to
 * something new -- a standby added to that data centre, a card dropped into
 * it -- and the newcomer then landed on top of it. Here every unit the layout
 * placed (a card alone, or a chassis stack with every blade) that overlaps a
 * hand-moved card, or a unit already settled above it, slides straight down
 * until it is clear, one row gap below. Hand-moved cards never move, and
 * nothing is written anywhere: the next layout starts from the natural slots
 * again, so a card that no longer collides returns to its own.
 *
 * With nothing moved by hand this returns its input untouched, which keeps
 * every preset's geometry golden exactly where it was.
 */
function makeWay(transient: readonly string[], nodes: NodeBox[]): NodeBox[] {
  if (!nodes.some((n) => n.moved && !transient.includes(n.key))) return nodes;
  const headerOf = (n: NodeBox): number => (n.stackKey === undefined ? 0 : LAYOUT.stackHeaderH);
  const boxOf = (list: readonly NodeBox[]): Rect => {
    const x0 = Math.min(...list.map((n) => n.x));
    const y0 = Math.min(...list.map((n) => n.y - headerOf(n)));
    const x1 = Math.max(...list.map((n) => n.x + n.w));
    const y1 = Math.max(...list.map((n) => n.y + n.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  /* Units: a stack moves as one, unless a blade of it was moved by hand --
     then every blade of it stays where it is, as an obstacle. */
  const units = new Map<string, NodeBox[]>();
  for (const n of nodes) {
    const k = n.stackKey ?? `card:${n.key}`;
    units.set(k, [...(units.get(k) ?? []), n]);
  }
  const fixed: Rect[] = [];
  const auto: { key: string; list: NodeBox[]; box: Rect }[] = [];
  for (const [key, list] of units) {
    /* In the air: neither an obstacle nor pushed. */
    if (list.some((n) => transient.includes(n.key))) continue;
    if (list.some((n) => n.moved)) fixed.push(...list.map((n) => ({ x: n.x, y: n.y - headerOf(n), w: n.w, h: n.h + headerOf(n) })));
    else auto.push({ key, list, box: boxOf(list) });
  }
  /* Top to bottom, left to right: a unit pushed down meets the ones under it
     in the order the reader reads them. */
  auto.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  /* Clear by a hair counts as clear -- a card nudged one grid step towards its
     neighbour must not shove it -- but whatever has to move lands a full row
     gap below what it met. */
  const gap = LAYOUT.rowGap;
  const hair = 4;
  const clash = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w + hair && b.x < a.x + a.w + hair && a.y < b.y + b.h + hair && b.y < a.y + a.h + hair;
  const settled: Rect[] = [...fixed];
  const shift = new Map<string, number>();
  for (const u of auto) {
    let box = u.box;
    for (let guard = 0; guard < 64; guard++) {
      const hit = settled.filter((r) => clash(box, r));
      if (hit.length === 0) break;
      const below = Math.max(...hit.map((r) => r.y + r.h)) + gap;
      box = { ...box, y: below };
    }
    settled.push(box);
    if (box.y !== u.box.y) for (const n of u.list) shift.set(n.key, box.y - u.box.y);
  }
  if (shift.size === 0) return nodes;
  return nodes.map((n) => {
    const dy = shift.get(n.key);
    return dy === undefined ? n : { ...n, y: n.y + dy };
  });
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
