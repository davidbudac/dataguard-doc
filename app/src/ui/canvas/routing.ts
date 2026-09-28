/**
 * Orthogonal link routing for the topology canvas -- ui design SS4.
 *
 * Pure and deterministic. Every link is tried against a short ladder of route
 * templates (straight, one corridor bend, the lane above everything, the lane
 * below everything) and takes the first that crosses no card; channels inside
 * a corridor are handed out in a fixed order, so two runs of the router emit
 * identical paths. Pills are placed at the midpoint of the longest segment and
 * swept out of collisions by a fixed sequence of offsets, never by a search
 * that depends on iteration order.
 */

import type { Member, RedoGraph, Snapshot, TopologyDoc, XptMode } from '@/engine';
import {
  applyParticipants, hasApplyInstance, initialApplyInstance, instanceKey, isDatabase, isRac, linkRttMs,
} from '@/engine';
import type { Geometry, NodeBox } from './layout';
import { nodeKey, siteLabelRect } from './layout';
import type { Pt, Rect } from './measure';
import { channelOffset, overlaps, PILL_H, pillWidth, r1, segmentHitsRect } from './measure';

export type LinkKind = 'redo' | 'ping' | 'check';

export interface CanvasLink {
  id: string;
  kind: LinkKind;
  /** Node keys, not raw ids. */
  from: string;
  to: string;
  xpt?: XptMode;
  active: boolean;
  up: boolean;
  /** A severed network, both ends alive. */
  cut: boolean;
  /** An end is gone. */
  down: boolean;
  caption: string;
  value?: string;
  /** The document link this drawing rides, when there is one. */
  docLink?: string;
  /** The pill carries the "this page's model" chip. */
  model: boolean;
  arrow: boolean;
  title: string;
}

export interface RoutedLink extends CanvasLink {
  points: Pt[];
  d: string;
  pill: Rect;
  /** Two slashes across a severed link, as the published drawing cuts one. */
  slashes: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface RoutingResult {
  links: RoutedLink[];
  bounds: Rect | null;
}

const CORNER = 7;

/* ---------------- what to draw ---------------- */

const memberById = (doc: TopologyDoc, id: string): Member | undefined =>
  doc.members.find((m) => (m.id as string) === id);

const hostSiteDown = (frame: Snapshot | null | undefined, doc: TopologyDoc, host: string): boolean => {
  if (!frame) return false;
  const net = frame.epoch.net;
  if (net.downHosts.some((h) => (h as string) === host)) return true;
  const site = doc.hosts.find((h) => (h.id as string) === host)?.site;
  return site !== undefined && net.downSites.some((s) => (s as string) === (site as string));
};

/** An instance is gone when its host or site is, or when it was stopped itself. */
const instanceDown = (
  frame: Snapshot | null | undefined, doc: TopologyDoc, m: Member, name: string, host: string,
): boolean => hostSiteDown(frame, doc, host)
  || (frame?.epoch.net.downInstances ?? []).includes(instanceKey(m.id, name));

const memberDown = (doc: TopologyDoc, frame: Snapshot | null | undefined, m: Member): boolean => {
  if (frame) {
    const st = frame.members[m.id];
    if (st === 'down' || st === 'aborted') return true;
  }
  return m.instances.length > 0
    && m.instances.every((i) => instanceDown(frame, doc, m, i.name, i.host as string));
};

const rttBetween = (doc: TopologyDoc, a: Member | undefined, b: Member | undefined): number => {
  const ha = a?.instances[0]?.host;
  const hb = b?.instances[0]?.host;
  if (!ha || !hb) return 0;
  return linkRttMs(doc, ha, hb);
};

const xptWord = (x: XptMode): string => `redo (${x})`;

/**
 * The FSFO targets a readiness check runs against: the declared list, or every
 * physical and logical standby when the property is ANY.
 */
export function readinessTargets(doc: TopologyDoc): string[] {
  const t = doc.config.fsfo.target;
  if (t.kind === 'list') return t.members.map((m) => m as string);
  return doc.members
    .filter((m) => isDatabase(m) && (m.role === 'physical' || m.role === 'logical'))
    .map((m) => m.id as string);
}


/**
 * The document link two members' hosts talk over: a host-scope link between
 * exactly those two hosts, otherwise the site link between their data centres.
 * It is what a click on the drawn line selects, because that is the object
 * with a round trip and an up flag on it.
 */
export function docLinkBetween(
  doc: TopologyDoc, hostA: string | undefined, hostB: string | undefined,
): string | undefined {
  if (!hostA || !hostB || hostA === hostB) return undefined;
  const pair = (a: string, b: string, ends: readonly [string, string]): boolean =>
    (ends[0] === a && ends[1] === b) || (ends[0] === b && ends[1] === a);
  for (const l of doc.links) {
    if (l.scope !== 'host') continue;
    if (pair(hostA, hostB, [l.ends[0] as string, l.ends[1] as string])) return l.id as string;
  }
  const sa = doc.hosts.find((h) => (h.id as string) === hostA)?.site as string | undefined;
  const sb = doc.hosts.find((h) => (h.id as string) === hostB)?.site as string | undefined;
  if (!sa || !sb || sa === sb) return undefined;
  for (const l of doc.links) {
    if (l.scope !== 'site') continue;
    if (pair(sa, sb, [l.ends[0] as string, l.ends[1] as string])) return l.id as string;
  }
  return undefined;
}

/**
 * One link per drawn relationship: every redo edge the resolver produced
 * (inactive ones included, because a destination that is standing down is
 * still part of the configuration), plus each observer's connection to the
 * primary and its readiness check to every fast-start failover target.
 */
export function buildLinks(
  doc: TopologyDoc, graph: RedoGraph, geo: Geometry, frame?: Snapshot | null,
): CanvasLink[] {
  const out: CanvasLink[] = [];
  const seen = new Map<string, number>();

  const has = (key: string): boolean => geo.byKey[key] !== undefined;

  /* The declared destinations, plus any destination of the primary this
     instant is actually shipping to that the declaration has never heard of:
     an alternate materialises when the destination it stands behind fails, and
     from that instant it is the line carrying the redo. Nothing else is added
     -- a destination standing down, or a redo path that belongs to a member
     the role change has made primary, would be a second drawing on a layout
     built for the configuration as declared. */
  const extra = frame
    ? frame.epoch.redo.edges.filter((x) => x.from === graph.primary && x.active && x.up
      && !graph.edges.some((d) => d.from === x.from && d.to === x.to))
    : [];
  for (const e of [...graph.edges, ...extra].sort(edgeOrder)) {
    const fromKey = nodeKey('member', e.from as string);
    const toKey = nodeKey('member', e.to as string);
    if (!has(fromKey) || !has(toKey)) continue;
    const dedupe = `${e.from as string}>${e.to as string}`;
    const prior = seen.get(dedupe);
    if (prior !== undefined) {
      const kept = out[prior];
      if (kept && kept.active) continue;
      if (!e.active) continue;
      out.splice(prior, 1, redoLink(doc, graph, e, frame, fromKey, toKey));
      continue;
    }
    seen.set(dedupe, out.length);
    out.push(redoLink(doc, graph, e, frame, fromKey, toKey));
  }

  const primary = memberById(doc, graph.primary as string);
  const targets = readinessTargets(doc);
  const fsfoOn = doc.config.fsfo.state !== 'disabled';

  for (const o of doc.observers) {
    const okey = nodeKey('observer', o.id as string);
    if (!has(okey)) continue;
    const stopped = frame
      ? frame.observers[o.id] === 'stopped'
      : !o.running;
    const oDown = hostSiteDown(frame, doc, o.host as string);

    if (primary) {
      const pkey = nodeKey('member', primary.id as string);
      const pmyDown = memberDown(doc, frame, primary);
      const gone = oDown || stopped;
      const pmyHost = primary.instances[0]?.host as string | undefined;
      const rtt = linkRttMs(doc, o.host, primary.instances[0]?.host ?? o.host);
      const dl = docLinkBetween(doc, o.host as string, pmyHost);
      out.push({
        id: `ping:${o.id as string}:${primary.id as string}`,
        ...(dl === undefined ? {} : { docLink: dl }),
        kind: 'ping',
        from: okey,
        to: pkey,
        active: !gone,
        up: !gone && !pmyDown,
        cut: false,
        down: gone || pmyDown,
        caption: gone ? 'no observer to ping' : 'ping',
        ...(gone ? {} : { value: `${rtt} ms` }),
        model: false,
        arrow: false,
        title: gone
          ? `${o.name} is not running, so nothing pings ${primary.name}.`
          : `${o.name} connects to the primary ${primary.name}; round trip ${rtt} ms.`,
      });
    }

    if (!fsfoOn) continue;
    for (const t of targets) {
      const tm = memberById(doc, t);
      const tkey = nodeKey('member', t);
      if (!tm || !has(tkey)) continue;
      const gone = oDown || stopped;
      const tDown = memberDown(doc, frame, tm);
      const rtt = linkRttMs(doc, o.host, tm.instances[0]?.host ?? o.host);
      const dl = docLinkBetween(doc, o.host as string, tm.instances[0]?.host as string | undefined);
      out.push({
        id: `check:${o.id as string}:${t}`,
        ...(dl === undefined ? {} : { docLink: dl }),
        kind: 'check',
        from: okey,
        to: tkey,
        active: !gone,
        up: !gone && !tDown,
        cut: false,
        down: gone || tDown,
        caption: gone ? 'no readiness check' : 'readiness check',
        ...(gone ? {} : { value: `${rtt} ms` }),
        model: false,
        arrow: false,
        title: gone
          ? `${o.name} is not running, so no readiness check reaches ${tm.name}.`
          : `${o.name} checks whether ${tm.name} is ready to take over; round trip ${rtt} ms.`,
      });
    }
  }

  return out;
}

const edgeOrder = (a: RedoGraph['edges'][number], b: RedoGraph['edges'][number]): number => {
  const k1 = `${a.from as string}>${a.to as string}`;
  const k2 = `${b.from as string}>${b.to as string}`;
  if (k1 !== k2) return k1 < k2 ? -1 : 1;
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.groupPriority - b.groupPriority;
};

/**
 * The same edge as this instant has it.
 *
 * The *set* of lines the canvas draws is the configuration's -- the resolver's
 * graph for the declared primary -- so a line does not appear and vanish as
 * the run plays. Which of them is carrying redo belongs to the epoch, though:
 * the alternate destination that took over when the far sync host died is
 * active and up in the frame's own graph while the declared one still has it
 * standing down behind `ALT`. So the flags come from the frame whenever the
 * frame's graph has the same edge, and from the declaration when it does not.
 */
function edgeAt(
  e: RedoGraph['edges'][number], frame: Snapshot | null | undefined,
): RedoGraph['edges'][number] {
  const live = frame?.epoch.redo.edges.filter((x) => x.from === e.from && x.to === e.to) ?? [];
  return live.find((x) => x.active) ?? live[0] ?? e;
}

function redoLink(
  doc: TopologyDoc, graph: RedoGraph, declared: RedoGraph['edges'][number],
  frame: Snapshot | null | undefined, fromKey: string, toKey: string,
): CanvasLink {
  const e = edgeAt(declared, frame);
  const from = memberById(doc, e.from as string);
  const to = memberById(doc, e.to as string);
  const down = (!!from && memberDown(doc, frame, from)) || (!!to && memberDown(doc, frame, to));
  const cut = !e.up && !down;
  const rtt = rttBetween(doc, from, to);
  const dl = docLinkBetween(
    doc, from?.instances[0]?.host as string | undefined, to?.instances[0]?.host as string | undefined,
  );

  if (!e.active) {
    const parts: string[] = [];
    if (e.inactiveReason === 'alternate-standby') parts.push('ALT');
    if (e.inactiveReason === 'lower-priority-group') parts.push(`PRIORITY ${e.groupPriority}`);
    if (e.inactiveReason === 'max-failure-disabled') parts.push('MaxFailure reached');
    if (parts.length === 0) parts.push('not shipping');
    const modelled = e.inactiveReason === 'alternate-standby'
      || e.inactiveReason === 'lower-priority-group';
    return {
      id: `redo:${e.from as string}:${e.to as string}`,
      kind: 'redo',
      from: fromKey,
      to: toKey,
      ...(dl === undefined ? {} : { docLink: dl }),
      xpt: e.xpt,
      active: false,
      up: e.up,
      cut,
      down,
      caption: parts.join(' · '),
      value: e.xpt,
      model: modelled,
      arrow: true,
      title: `${from?.name ?? e.from as string} declares ${to?.name ?? e.to as string} as a destination, but is not shipping to it now.`,
    };
  }

  const value = down ? 'down' : cut ? 'cut' : `${rtt} ms RTT`;
  return {
    id: `redo:${e.from as string}:${e.to as string}`,
    kind: 'redo',
    from: fromKey,
    to: toKey,
    ...(dl === undefined ? {} : { docLink: dl }),
    xpt: e.xpt,
    active: true,
    up: e.up,
    cut,
    down,
    caption: xptWord(e.xpt),
    value,
    model: false,
    arrow: true,
    title: `${from?.name ?? e.from as string} ships redo to ${to?.name ?? e.to as string} over ${e.xpt}${down ? ', but an end is down' : cut ? ', but the network between them is severed' : `; round trip ${rtt} ms`}.`,
  };
}

/* ---------------- geometry ---------------- */

interface Candidate {
  points: Pt[];
  corridor: string | null;
  /** How a channel index moves this route. */
  shift: (pts: Pt[], off: number) => Pt[];
}

const shiftX = (idx: number[]) => (pts: Pt[], off: number): Pt[] =>
  pts.map((p, i) => (idx.includes(i) ? { x: p.x + off, y: p.y } : p));
const shiftY = (idx: number[]) => (pts: Pt[], off: number): Pt[] =>
  pts.map((p, i) => (idx.includes(i) ? { x: p.x, y: p.y + off } : p));

const centreX = (n: NodeBox): number => n.x + n.w / 2;
const centreY = (n: NodeBox): number => n.y + n.h / 2;

/**
 * The free space the layout leaves between two site columns. A route that
 * cannot go straight drops down this corridor and comes at its destination
 * from the side, rather than dropping onto the card's top edge through
 * whatever else that column stacks above it (ui.md SS4).
 */
function corridorRoute(a: NodeBox, b: NodeBox, geo: Geometry): Candidate | null {
  if (a.col === b.col) return null;
  const ay = centreY(a); const by = centreY(b);
  if (Math.abs(ay - by) < 0.5) return null;
  const left = b.col < a.col ? b.col : b.col - 1;
  const colL = geo.columns[left];
  const colR = geo.columns[left + 1];
  if (!colL || !colR) return null;
  const x = (colL.x + colL.w + colR.x) / 2;
  const exitA = b.col < a.col ? a.x : a.x + a.w;
  const entryB = b.col < a.col ? b.x + b.w : b.x;
  return {
    points: [{ x: exitA, y: ay }, { x, y: ay }, { x, y: by }, { x: entryB, y: by }],
    corridor: `gap:${left}`,
    shift: shiftX([1, 2]),
  };
}

function candidatesFor(
  a: NodeBox, b: NodeBox, geo: Geometry, kind: LinkKind,
): Candidate[] {
  const out: Candidate[] = [];
  const ay = centreY(a); const by = centreY(b);
  const ax = centreX(a); const bx = centreX(b);

  if (kind === 'ping' || kind === 'check') {
    /* The observer band sits above the member band, so an observer link comes
       down onto the top edge of the card it watches -- unless the two are
       co-hosted, in which case they are two blades of one chassis stack with
       nothing between them: no straight run has room for a pill (the same
       reason a member-to-member hop takes the same detour, above), so the
       line goes round the side of the column instead. */
    const sameStack = a.stackKey !== undefined && a.stackKey === b.stackKey;
    if (a.col === b.col && !sameStack) {
      out.push({
        points: Math.abs(ax - bx) < 0.5
          ? [{ x: ax, y: a.y + a.h }, { x: bx, y: b.y }]
          : [{ x: ax, y: a.y + a.h }, { x: ax, y: (a.y + a.h + b.y) / 2 },
            { x: bx, y: (a.y + a.h + b.y) / 2 }, { x: bx, y: b.y }],
        corridor: `v:${a.col}:${a.row}`,
        shift: shiftY([1, 2]),
      });
    } else if (a.col === b.col) {
      const col = geo.columns[a.col];
      const rightmost = a.col === geo.columns.length - 1;
      const sideX = col
        ? (rightmost ? col.x - 14 : col.x + col.w + 14)
        : (rightmost ? a.x - 14 : a.x + a.w + 14);
      const exitA = rightmost ? { x: a.x, y: ay } : { x: a.x + a.w, y: ay };
      const exitB = rightmost ? { x: b.x, y: by } : { x: b.x + b.w, y: by };
      out.push({
        points: [exitA, { x: sideX, y: ay }, { x: sideX, y: by }, exitB],
        corridor: `side:${a.col}`,
        shift: shiftX([1, 2]),
      });
    } else {
      const side = b.col > a.col ? a.x + a.w : a.x;
      out.push({
        points: [{ x: side, y: ay }, { x: bx, y: ay }, { x: bx, y: b.y }],
        corridor: `drop:${b.key}`,
        shift: shiftX([1, 2]),
      });
      /* The straight run above is at observer height, so it walks through any
         observer standing between the two columns; the corridor beside the
         destination's column is the way past it. */
      const gap = corridorRoute(a, b, geo);
      if (gap) out.push(gap);
    }
    /* Two observers in one band row cannot both leave sideways, so the second
       one drops into the gap between the bands and crosses there. */
    out.push({
      points: [
        { x: ax, y: a.y + a.h }, { x: ax, y: geo.bandLaneY },
        { x: bx, y: geo.bandLaneY }, { x: bx, y: b.y },
      ],
      corridor: 'band',
      shift: shiftY([1, 2]),
    });
    out.push({
      points: [
        { x: ax, y: a.y }, { x: ax, y: geo.overLaneY },
        { x: bx, y: geo.overLaneY }, { x: bx, y: b.y },
      ],
      corridor: 'over',
      shift: shiftY([1, 2]),
    });
    return out;
  }

  if (a.col === b.col) {
    const top = ay < by ? a : b;
    const bot = ay < by ? b : a;
    const forward = top === a;
    const p0 = forward ? { x: ax, y: a.y + a.h } : { x: ax, y: a.y };
    const p1 = forward ? { x: bx, y: b.y } : { x: bx, y: b.y + b.h };
    const gap = bot.y - (top.y + top.h);
    const midY = forward
      ? (a.y + a.h + b.y) / 2
      : (b.y + b.h + a.y) / 2;
    /* Two stacked cards leave 18 px between them -- no room for a pill, so a
       short hop goes around the side of the column instead of between them. */
    if (gap >= 40) {
      out.push({
        points: Math.abs(ax - bx) < 0.5
          ? [p0, p1]
          : [p0, { x: p0.x, y: midY }, { x: p1.x, y: midY }, p1],
        corridor: `v:${a.col}:${Math.min(top.row, bot.row)}`,
        shift: shiftY([1, 2]),
      });
    }
    const col = geo.columns[a.col];
    const rightmost = a.col === geo.columns.length - 1;
    const sideX = col
      ? (rightmost ? col.x - 14 : col.x + col.w + 14)
      : (rightmost ? a.x - 14 : a.x + a.w + 14);
    const exitA = rightmost ? { x: a.x, y: ay } : { x: a.x + a.w, y: ay };
    const exitB = rightmost ? { x: b.x, y: by } : { x: b.x + b.w, y: by };
    out.push({
      points: [exitA, { x: sideX, y: ay }, { x: sideX, y: by }, exitB],
      corridor: `side:${a.col}`,
      shift: shiftX([1, 2]),
    });
  } else if (b.col > a.col) {
    /* Turn in the corridor immediately after the source column: a link that
       spans two columns still leaves its own site straight away. */
    const colA = geo.columns[a.col];
    const colNext = geo.columns[a.col + 1] ?? geo.columns[b.col];
    const gapX = colA && colNext
      ? (colA.x + colA.w + colNext.x) / 2
      : (a.x + a.w + b.x) / 2;
    const p0 = { x: a.x + a.w, y: ay };
    const p1 = { x: b.x, y: by };
    out.push({
      points: Math.abs(ay - by) < 0.5
        ? [p0, p1]
        : [p0, { x: gapX, y: ay }, { x: gapX, y: by }, p1],
      corridor: `h:${a.col}:${b.col}`,
      shift: shiftX([1, 2]),
    });
    const gap = corridorRoute(a, b, geo);
    if (gap) out.push(gap);
  }

  /* The lane under every site rect: backwards edges, and edges that would
     otherwise cross a card in a column they only pass through. */
  out.push({
    points: [
      { x: ax, y: a.y + a.h }, { x: ax, y: geo.underLaneY },
      { x: bx, y: geo.underLaneY }, { x: bx, y: b.y + b.h },
    ],
    corridor: 'under',
    shift: shiftY([1, 2]),
  });
  out.push({
    points: [
      { x: ax, y: a.y }, { x: ax, y: geo.overLaneY },
      { x: bx, y: geo.overLaneY }, { x: bx, y: b.y },
    ],
    corridor: 'over',
    shift: shiftY([1, 2]),
  });
  return out;
}

const laneStep = (corridor: string): number =>
  corridor === 'over' || corridor === 'under' ? 14
    : corridor.startsWith('gap:') ? 24 : 12;

const laneOffset = (corridor: string, index: number): number => {
  if (corridor === 'under') return index * 14;
  if (corridor === 'over') return -index * 14;
  /* The band gap is 28 px tall; three channels fit inside it. */
  if (corridor === 'band') return -index * 8;
  return channelOffset(index, laneStep(corridor));
};

function crossesACard(points: readonly Pt[], cards: readonly NodeBox[], a: NodeBox, b: NodeBox): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i]; const q = points[i + 1];
    if (!p || !q) continue;
    for (const c of cards) {
      if (c.key === a.key || c.key === b.key) continue;
      if (segmentHitsRect(p, q, c, 1)) return true;
    }
  }
  return false;
}

/** Rounded orthogonal path: every corner is one 7 px arc, as the strip draws them. */
export function orthPath(points: readonly Pt[], radius = CORNER): string {
  if (points.length === 0) return '';
  const first = points[0] as Pt;
  if (points.length === 1) return `M${r1(first.x)},${r1(first.y)}`;
  let d = `M${r1(first.x)},${r1(first.y)}`;
  for (let i = 1; i < points.length; i++) {
    const cur = points[i] as Pt;
    const prev = points[i - 1] as Pt;
    const next = points[i + 1];
    if (!next) {
      d += ` L${r1(cur.x)},${r1(cur.y)}`;
      continue;
    }
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.max(0, Math.min(radius, inLen / 2, outLen / 2));
    if (r === 0) {
      d += ` L${r1(cur.x)},${r1(cur.y)}`;
      continue;
    }
    const ax = cur.x - Math.sign(cur.x - prev.x) * r;
    const ay = cur.y - Math.sign(cur.y - prev.y) * r;
    const bx = cur.x + Math.sign(next.x - cur.x) * r;
    const by = cur.y + Math.sign(next.y - cur.y) * r;
    d += ` L${r1(ax)},${r1(ay)} Q${r1(cur.x)},${r1(cur.y)} ${r1(bx)},${r1(by)}`;
  }
  return d;
}

/** Every straight run of a route, longest first: the pill rides one of them. */
function pillSegments(points: readonly Pt[]): { a: Pt; b: Pt }[] {
  const segs: { a: Pt; b: Pt; len: number; i: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i]; const q = points[i + 1];
    if (!p || !q) continue;
    segs.push({ a: p, b: q, len: Math.hypot(q.x - p.x, q.y - p.y), i });
  }
  segs.sort((x, y) => y.len - x.len || x.i - y.i);
  return segs.map(({ a, b }) => ({ a, b }));
}

/** The longest segment: where the pill sits when nothing is in the way. */
function pillSegment(points: readonly Pt[]): { a: Pt; b: Pt } {
  return pillSegments(points)[0]
    ?? { a: points[0] ?? { x: 0, y: 0 }, b: points[1] ?? points[0] ?? { x: 0, y: 0 } };
}

const SLIDES = [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40];

/**
 * How far along a segment the sweep may push the pill: forty pixels, or half
 * the segment when the segment is longer than that. A long corridor run is
 * exactly where a label wants to travel -- it is the free space between two
 * site rectangles -- and forty pixels is not enough to reach it from the
 * middle of a run that spans the whole drawing.
 */
function slidesFor(len: number): number[] {
  const max = Math.max(40, Math.floor(len / 2 / 8) * 8);
  const out: number[] = [0];
  for (let d = 8; d <= max; d += 8) out.push(d, -d);
  return out;
}

/**
 * Corridor-aware pill placement.
 *
 * A caption belongs in the free space the layout already leaves between two
 * site columns, or on the vertical run inside it -- not over a card, not over
 * another caption, and not inside a site rectangle it says nothing about. So
 * the sweep runs twice: once with the site rectangles treated as obstacles,
 * which is what pushes readiness-check and ping captions out into the
 * corridor, and once without them, because a hop between two cards stacked in
 * one data centre has nowhere else to go. Both passes are fixed enumerations,
 * so two runs of the router place the pill identically.
 */
function placePill(
  points: readonly Pt[], w: number,
  cards: readonly NodeBox[], placedPills: readonly Rect[], sites: readonly Rect[],
  otherLines: readonly { a: Pt; b: Pt }[] = [],
  labels: readonly Rect[] = [],
): Rect {
  const segs = pillSegments(points);
  const rectOn = (seg: { a: Pt; b: Pt }, slide: number, off: number): Rect => {
    const horizontal = Math.abs(seg.b.y - seg.a.y) < Math.abs(seg.b.x - seg.a.x);
    const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
    const dx = horizontal ? slide : off;
    const dy = horizontal ? off : slide;
    return {
      x: Math.round(mid.x - w / 2 + dx), y: Math.round(mid.y - PILL_H / 2 + dy), w, h: PILL_H,
    };
  };
  const clearOfCards = (r: Rect): boolean => !cards.some((c) => overlaps(r, c, 2))
    && !placedPills.some((p) => overlaps(r, p, 2))
    && !labels.some((l) => overlaps(r, l, 2));
  const clearOfSites = (r: Rect): boolean => !sites.some((s) => overlaps(r, s, 0));
  const clearOfLines = (r: Rect): boolean =>
    !otherLines.some((l) => segmentHitsRect(l.a, l.b, r, -2));

  /* Pass one: the corridor, and out of everyone else's way. Longest run
     first, then out along it. The second rung drops the other links' lines,
     because a caption under a line that crosses it still reads -- a caption
     inside a site rectangle it says nothing about does not. */
  for (const strict of [true, false]) {
    for (const seg of segs) {
      const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      if (len < 24) continue;
      for (const slide of slidesFor(len)) {
        const r = rectOn(seg, slide, 0);
        if (!clearOfCards(r) || !clearOfSites(r)) continue;
        if (strict && !clearOfLines(r)) continue;
        return r;
      }
    }
  }

  /* Pass two: inside a site rectangle is allowed; over a card is not. */
  const best = pillSegment(points);
  const bestLen = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y);
  for (const off of [0, 14, -14, 28, -28]) {
    for (const slide of slidesFor(bestLen)) {
      const r = rectOn(best, slide, off);
      if (clearOfCards(r)) return r;
    }
  }

  /* A short segment between two stacked cards has no room along it at all, so
     the last resort is to step the pill clear of whatever it is sitting on --
     computed from the obstacle, not guessed, so the sweep stays deterministic. */
  const horizontal = Math.abs(best.b.y - best.a.y) < Math.abs(best.b.x - best.a.x);
  const mid = { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
  const home = rectOn(best, 0, 0);
  const obstacles: Rect[] = [
    ...cards.filter((c) => overlaps(home, c, 2)),
    ...placedPills.filter((p) => overlaps(home, p, 2)),
    ...labels.filter((l) => overlaps(home, l, 2)),
  ];
  const clearances: number[] = [];
  for (const o of obstacles) {
    if (horizontal) {
      clearances.push(o.y - 3 - PILL_H / 2 - mid.y, o.y + o.h + 3 + PILL_H / 2 - mid.y);
    } else {
      clearances.push(o.x - 3 - w / 2 - mid.x, o.x + o.w + 3 + w / 2 - mid.x);
    }
  }
  clearances.sort((p, q) => Math.abs(p) - Math.abs(q) || p - q);
  for (const off of clearances) {
    for (const slide of SLIDES) {
      const r = rectOn(best, slide, off);
      if (clearOfCards(r)) return r;
    }
  }
  return home;
}

/** Two slashes across a severed link, just before its pill. */
function slashesFor(seg: { a: Pt; b: Pt }, pill: Rect): RoutedLink['slashes'] {
  const horizontal = Math.abs(seg.b.y - seg.a.y) < Math.abs(seg.b.x - seg.a.x);
  if (horizontal) {
    const y = (seg.a.y + seg.b.y) / 2;
    const x = pill.x - 26;
    return [
      { x1: x, y1: y + 8, x2: x + 10, y2: y - 8 },
      { x1: x + 10, y1: y + 8, x2: x + 20, y2: y - 8 },
    ];
  }
  const x = (seg.a.x + seg.b.x) / 2;
  const y = pill.y - 26;
  return [
    { x1: x - 8, y1: y, x2: x + 8, y2: y + 10 },
    { x1: x - 8, y1: y + 10, x2: x + 8, y2: y + 20 },
  ];
}

/** Extra pill width for the "this page's model" chip riding beside it. */
export const MODEL_CHIP_W = 42;

export function routeLinks(links: readonly CanvasLink[], geo: Geometry): RoutingResult {
  const cards = geo.nodes;
  const used = new Map<string, Set<number>>();
  const bounds: Rect[] = [];

  const ordered = [...links].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  /* ---- phase one: every route, so channels are handed out in id order ---- */
  const paths: { link: CanvasLink; points: Pt[] }[] = [];
  for (const link of ordered) {
    const a = geo.byKey[link.from];
    const b = geo.byKey[link.to];
    if (!a || !b) continue;
    const cands = candidatesFor(a, b, geo, link.kind);

    let chosen: Pt[] | null = null;
    let chosenCorridor: string | null = null;
    let chosenIndex = 0;
    for (const cand of cands) {
      const corridor = cand.corridor;
      /* A straight run has no corner to move, so it is take it or leave it. */
      const straight = cand.points.length === 2;
      const taken = corridor === null ? new Set<number>() : (used.get(corridor) ?? new Set<number>());
      for (let k = 0; k < (straight ? 1 : 8); k++) {
        if (!straight && taken.has(k)) continue;
        const pts = straight || corridor === null
          ? cand.points
          : cand.shift(cand.points, laneOffset(corridor, k));
        if (crossesACard(pts, cards, a, b)) continue;
        chosen = pts;
        chosenCorridor = straight ? null : corridor;
        chosenIndex = k;
        break;
      }
      if (chosen) break;
    }
    if (!chosen) {
      const fallback = cands[cands.length - 1] ?? cands[0];
      const corridor = fallback?.corridor ?? null;
      const taken = corridor === null ? new Set<number>() : (used.get(corridor) ?? new Set<number>());
      let k = 0;
      while (taken.has(k) && k < 32) k++;
      chosen = fallback ? fallback.shift(fallback.points, laneOffset(corridor ?? 'over', k)) : [];
      chosenCorridor = corridor;
      chosenIndex = k;
    }
    if (chosenCorridor !== null && chosen.length > 2) {
      const set = used.get(chosenCorridor) ?? new Set<number>();
      set.add(chosenIndex);
      used.set(chosenCorridor, set);
    }
    paths.push({ link, points: chosen });
  }

  /* ---- phase two: the captions, once every line is known ---- */
  const segmentsOf = (pts: readonly Pt[]): { a: Pt; b: Pt }[] => {
    const out: { a: Pt; b: Pt }[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]; const q = pts[i + 1];
      if (p && q) out.push({ a: p, b: q });
    }
    return out;
  };

  const pills: Rect[] = [];
  const labels = geo.sites.map(siteLabelRect);
  const out: RoutedLink[] = [];
  for (let i = 0; i < paths.length; i++) {
    const entry = paths[i];
    if (!entry) continue;
    const { link, points: chosen } = entry;
    const others = paths.flatMap((p, j) => (j === i ? [] : segmentsOf(p.points)));
    const seg = pillSegment(chosen);
    const w = pillWidth(link.caption, link.value) + (link.model ? MODEL_CHIP_W : 0);
    const pill = placePill(chosen, w, cards, pills, geo.sites, others, labels);
    pills.push(pill);
    const routed: RoutedLink = {
      ...link,
      points: chosen,
      d: orthPath(chosen),
      pill,
      slashes: link.cut ? slashesFor(seg, pill) : [],
    };
    out.push(routed);
    bounds.push(pill);
    for (const p of chosen) bounds.push({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  let box: Rect | null = null;
  if (bounds.length > 0) {
    const x0 = Math.min(...bounds.map((r) => r.x));
    const y0 = Math.min(...bounds.map((r) => r.y));
    const x1 = Math.max(...bounds.map((r) => r.x + r.w));
    const y1 = Math.max(...bounds.map((r) => r.y + r.h));
    box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return { links: out, bounds: box };
}

export function routeTopology(
  doc: TopologyDoc, graph: RedoGraph, geo: Geometry, frame?: Snapshot | null,
): RoutingResult {
  return routeLinks(buildLinks(doc, graph, geo, frame), geo);
}

/** The viewBox has to hold the lanes the router used, not just the site rects. */
export function unionViewBox(view: Geometry['viewBox'], bounds: Rect | null): Geometry['viewBox'] {
  if (!bounds) return view;
  const x0 = Math.min(view.x, bounds.x - 10);
  const y0 = Math.min(view.y, bounds.y - 10);
  const x1 = Math.max(view.x + view.w, bounds.x + bounds.w + 10);
  const y1 = Math.max(view.y + view.h, bounds.y + bounds.h + 10);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ---------------- how a frame reads onto a card ---------------- */

export type Phase = 'neutral' | 'serving' | 'applying' | 'waiting' | 'observer' | 'idle';

export interface CardFrame {
  downInstances?: string[];
  /**
   * A RAC standby: the instance running apply. In Build mode it is the one
   * the configuration starts with; under a frame, the one running apply at
   * that instant -- absent while no instance is.
   */
  applyInstance?: string;
  /** Multi-instance Redo Apply: every instance running apply, coordinator first. */
  applyParticipants?: string[];
  phase: Phase;
  /** Hatched fill and a red border: this component is gone. */
  down: boolean;
  /** Two red strokes across the name line: the host itself crashed. */
  crashed: boolean;
  /** A red border with no cross: it is up, and it is not getting anywhere. */
  stalled: boolean;
  /** Alive, but not every instance is. */
  degraded: boolean;
  /** Nothing feeds it: drawn dashed, the way the layout ranks it. */
  unreachable: boolean;
}

export const NEUTRAL_FRAME: CardFrame = {
  phase: 'neutral', down: false, crashed: false, stalled: false,
  degraded: false, unreachable: false,
};

export type ChipTone = 'violet' | 'slate' | 'ink';

export interface CardChip {
  text: string;
  tone: ChipTone;
  title: string;
}

const MEMBER_PHASE: Record<string, Phase> = {
  'open-rw': 'serving',
  'open-ro': 'serving',
  'mounted-apply': 'applying',
  'mounted-noapply': 'idle',
  stalled: 'waiting',
  'commit-hang': 'waiting',
  converting: 'waiting',
  reinstating: 'waiting',
  disabled: 'idle',
  unreachable: 'waiting',
  receiving: 'applying',
  'forwarding-stalled': 'waiting',
};

const OBSERVER_PHASE: Record<string, Phase> = {
  master: 'observer',
  nominating: 'observer',
  backup: 'idle',
  'observe-only': 'idle',
  stopped: 'idle',
  'lost-primary': 'waiting',
  'lost-target': 'waiting',
};

/**
 * Build mode leaves every card monochrome; a colour appears only once the
 * caller passes a state from the trace, and red only where something is down.
 */
export function cardFrameFor(
  doc: TopologyDoc, node: NodeBox, frame?: Snapshot | null,
): CardFrame {
  if (node.kind === 'observer') {
    const o = doc.observers.find((x) => (x.id as string) === node.id);
    if (!o) return NEUTRAL_FRAME;
    const hostDown = hostSiteDown(frame, doc, o.host as string);
    const st = frame ? frame.observers[o.id] : undefined;
    return {
      phase: !frame ? 'neutral' : hostDown ? 'neutral' : OBSERVER_PHASE[st ?? ''] ?? 'idle',
      down: hostDown,
      crashed: hostDown,
      stalled: false,
      degraded: false,
      unreachable: false,
    };
  }
  const m = memberById(doc, node.id);
  if (!m) return NEUTRAL_FRAME;
  const hosts = m.instances.map((i) => i.host as string);
  const downHosts = hosts.filter((h) => hostSiteDown(frame, doc, h)).length;
  const allDown = hosts.length > 0 && downHosts === hosts.length;
  const downNames = m.instances
    .filter((i) => instanceDown(frame, doc, m, i.name, i.host as string)).map((i) => i.name);
  const st = frame ? frame.members[m.id] : undefined;
  const down = allDown || st === 'down' || st === 'aborted';
  const applyingNow = st === 'mounted-apply' || st === 'open-ro';
  const apply = !hasApplyInstance(m) ? undefined
    : frame ? (applyingNow ? frame.applyInstances?.[m.id] : undefined)
      : initialApplyInstance(m) ?? undefined;
  /* "No active redo route reaches this member from the primary" is a fact
     about the instant once there is one: the alternate that has taken over
     reaches its destination, and a card left dashed under a line that is
     carrying redo contradicts the line beside it. */
  const live = frame?.epoch.redo.members[m.id];
  return {
    phase: !frame || down ? 'neutral' : MEMBER_PHASE[st ?? ''] ?? 'idle',
    down,
    crashed: allDown,
    stalled: st === 'stalled',
    degraded: downNames.length > 0 && !down,
    ...(isRac(m)
      ? { downInstances: down ? m.instances.map((i) => i.name) : downNames }
      : {}),
    ...(apply === undefined || down ? {} : {
      applyInstance: apply,
      applyParticipants: isDatabase(m)
        ? applyParticipants(m, apply, m.instances.map((i) => i.name).filter((n) => !downNames.includes(n)))
        : [apply],
    }),
    unreachable: live ? !live.reachableFromPrimary : node.unreachable,
  };
}

/** A site hatches only when the site itself is gone. */
export function siteIsDown(doc: TopologyDoc, site: string, frame?: Snapshot | null): boolean {
  if (!frame) return false;
  if (frame.epoch.net.downSites.some((s) => (s as string) === site)) return true;
  const hosts = doc.hosts.filter((h) => (h.site as string) === site);
  return hosts.length > 0 && hosts.every((h) => hostSiteDown(frame, doc, h.id as string));
}

/**
 * The chips a card wears. A RAC chip counts instances; a MASTER chip appears
 * only while fast-start failover is enabled, because with it disabled no
 * observer is called the master observer.
 */
export function chipsFor(doc: TopologyDoc, node: NodeBox): CardChip[] {
  const chips: CardChip[] = [];
  if (node.kind === 'observer') {
    const o = doc.observers.find((x) => (x.id as string) === node.id);
    if (!o) return chips;
    const state = doc.config.fsfo.state;
    if (state === 'observe-only') {
      chips.push({
        text: 'OBSERVE ONLY',
        tone: 'slate',
        title: 'Fast-start failover is enabled in observe-only mode: the observer reports what it would have done and never fails over.',
      });
    } else if (state === 'enabled' && o.role === 'master') {
      chips.push({
        text: 'MASTER',
        tone: 'violet',
        title: 'Only the master observer can coordinate fast-start failover.',
      });
    }
    return chips;
  }
  const m = memberById(doc, node.id);
  if (m && m.instances.length > 1) {
    chips.push({
      text: `RAC ${m.instances.length}`,
      tone: 'ink',
      title: `${m.name} runs ${m.instances.length} instances; it stays reachable while any one of their hosts is up.`,
    });
  }
  return chips;
}
