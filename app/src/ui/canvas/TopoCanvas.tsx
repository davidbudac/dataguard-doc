/**
 * The topology canvas -- ui design SS4.
 *
 * One persistent drawing of the whole configuration: site panels, cards for
 * every member and observer, and the redo, ping and readiness-check links
 * between them. It takes a document, a resolved redo graph and (in Break mode)
 * one snapshot of the trace, and it reports selection, hover and drags back
 * through callbacks -- it reads no signal of its own, so a test can render it
 * with plain values.
 *
 * The drawing and the text are the same object seen twice: every fact on the
 * canvas is also in the generated sentences and the structural table below it,
 * which are in the document rather than behind a CSS rule.
 */

import type { JSX } from 'preact';
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'preact/hooks';
import { findApplication } from '@/engine';
import type { RedoGraph, Snapshot, TopologyDoc } from '@/engine';
import type { Geometry, LayoutOffset, NodeBox, SiteBox, ViewBox } from './layout';
import { layoutTopology, SITE_MIN } from './layout';
import { cardFrameFor, cardRoleFor, carryEnds, chipsFor, routeTopology, siteIsDown, unionViewBox } from './routing';
import { describeTopology, cardLabel, linkLabel, siteLabel } from './aria';
import { anchorFor, barRoom, bodyFor, fittedScale, menuCap, placeBar } from './anchor';
import { InlineName } from './InlineName';
import { siteLabelRect } from './layout';
import { ActionBar, barFootprint, menuFootprint } from './ActionBar';
import { HoverTools, toolsSize } from './HoverTools';
import type { CanvasTool } from './HoverTools';
import type { BarAction, BarSection } from './ActionBar';
import type { WhyState } from '../common/WhyPill';
import { approxW, CARD } from './measure';
import type { Rect } from './measure';
import { parseInstanceKey } from '@/state/instanceKey';
import { NodeCard } from './NodeCard';
import { StackChassis } from './StackChassis';
import { LinkPath, linkKey } from './LinkPath';
import { SiteRect, siteKey } from './SiteRect';
import { landingFor } from './drop';
import { snap8 } from './measure';
import { isElement, useHostWindow } from '../common/dom';
import { GlyphDefs } from '../common/glyphs';
import '@/styles/canvas.css';

export interface TopoCanvasProps {
  doc: TopologyDoc;
  graph: RedoGraph;
  /** Break mode: one instant of the trace. Absent means Build mode, monochrome. */
  frame?: Snapshot | null;
  /** Drag overrides, keyed by node key; the layout snaps them to 8 px. */
  overrides?: Readonly<Record<string, LayoutOffset>>;
  /** Precomputed geometry, when the caller already has it memoised. */
  geometry?: Geometry;
  selection?: readonly string[];
  hovered?: string | null;
  /** False renders a static picture: no focus stops, no pointer handlers. */
  interactive?: boolean;
  /**
   * Why the drawing is read-only, said in place. A canvas that quietly stops
   * responding is the one thing this page may not do.
   */
  readOnlyWhy?: string;
  /** Namespaces the SVG defs so two canvases can share a page. */
  prefix?: string;
  onSelect?: (key: string, additive: boolean) => void;
  onHover?: (key: string | null) => void;
  /**
   * `E` on a focused card, data centre or line: ask for the events on offer for
   * it. Only Break passes it (Build has none to offer); the caller decides where
   * they appear, which is the action bar.
   */
  onEvents?: (key: string) => void;
  /**
   * A card being dragged. `all` is every card the drag carries -- the whole
   * selection when the pressed card is part of one -- so the caller can write
   * them in one edit; `key` and `offset` are the pressed card's own.
   */
  onDrag?: (key: string, offset: LayoutOffset, all: Readonly<Record<string, LayoutOffset>>) => void;
  onDragEnd?: (key: string, offset: LayoutOffset, all: Readonly<Record<string, LayoutOffset>>) => void;
  /**
   * A card let go inside the data centre it came from, where the box would
   * otherwise shrink round it: these data centres keep the box they had when
   * the drag began, as a sized override each (`LayoutOffset.w`/`h`). Called
   * before `onDragEnd`, so the caller can write it into the drag's own edit.
   */
  onHoldSites?: (key: string, boxes: Readonly<Record<string, LayoutOffset>>) => void;
  /**
   * A whole data centre let go past a neighbour's middle: the columns take the
   * new left-to-right `order` (every data centre's id), and `offsets` are the
   * carried cards' overrides with the drag's sideways part taken back out, so
   * the data centre settles into its new slot and its neighbours make room.
   * Called before `onDragEnd` (with those offsets), so the caller can write it
   * into the drag's own edit. Without it, a data centre can only be pushed
   * about within the order the layout gives the columns.
   */
  onReorderSites?: (key: string, order: readonly string[], offsets: Readonly<Record<string, LayoutOffset>>) => void;
  /**
   * A data centre resized from one of its handles (or `Alt`+arrow on it): its
   * new box as a sized override. Passing it draws the handles on a selected
   * data centre. Every call of one gesture is the same edit.
   */
  onResizeSite?: (site: string, box: LayoutOffset) => void;
  /** The resize gesture is over: the next one is a new edit. */
  onResizeEnd?: () => void;
  /**
   * `Alt` and an arrow on a data centre: its bottom right corner, this far.
   * A delta rather than a box, so two presses inside one render add up (the
   * `onNudge` contract).
   */
  onResizeBy?: (site: string, dx: number, dy: number) => void;
  /**
   * `Alt` and an arrow on a card: these cards, this far. A delta rather than
   * the offsets it comes to, so two presses inside one render add up.
   */
  onNudge?: (keys: readonly string[], dx: number, dy: number) => void;
  /**
   * A rectangle dragged over the ground. Passing it makes a drag on the ground
   * with Shift (or Ctrl / Cmd) held a selection, added to what is selected; a
   * plain drag, the middle button and `Space` are the pan.
   */
  onSelectMany?: (keys: readonly string[], additive: boolean) => void;
  /**
   * A card dropped inside another data centre's panel. Passing it makes the
   * panels drop targets; without it a drag is a drag and the card stays in
   * the site it came from, wherever it is let go.
   */
  onMoveToSite?: (key: string, site: string) => void;
  /**
   * A single card (never a whole stack) dropped onto another host's card or
   * chassis stack: reassigns it there, merging it into that host's stack --
   * cross-site too. Passing it makes another host's card and its stack a
   * drop target during a lone card's drag; without it such a drag drops onto
   * the layout the way it always has, `onMoveToSite` included.
   */
  onMergeIntoHost?: (key: string, hostId: string) => void;
  /**
   * Whether a lone card may share `hostId`: asked while it is in the air, so
   * a host that would refuse it is dimmed rather than lit, says why under the
   * pointer, and does not take the drop. Absent means every host may.
   */
  mergeWhat?: (key: string, hostId: string) => WhyState;
  /**
   * A line drawn from one card's port to another card. Passing it draws the
   * ports; the caller decides what a member-to-member or a member-to-observer
   * line means.
   */
  onConnect?: (from: string, to: string) => void;
  /**
   * What the line being drawn would do if dropped here, and whether it may:
   * the label under the pointer while it hovers a card or a panel, and the
   * refusal on the target when it may not. `to` is a card key or a site id.
   */
  connectWhat?: (from: string, to: string) => { label: string; enabled: WhyState };
  onDelete?: (key: string) => void;
  onClear?: () => void;
  /**
   * The action bar, anchored on `key`. Absent means nothing is offered on the
   * drawing; the caller decides what a click opens, this only draws it.
   */
  bar?: {
    key: string;
    actions: readonly BarAction[];
    quiet?: string | null;
    /** Opened by a keyboard-shaped gesture: the bar takes the focus. */
    focus?: boolean;
    /** Where the rows past the bar's cap live, named for this viewport. */
    moreWhere?: string;
    /** The cap on rows, when the caller's stage is shorter than Build's. */
    maxRows?: number;
    /** Break: draw it as the grouped context menu, every row, no cap. */
    sections?: readonly BarSection[];
    /** Break: when its events land, for the menu's header. */
    when?: string;
    /** The header's words for the subject, when not its key. */
    title?: string;
    /** Keep the last row (Remove) visible when the cap drops rows. */
    keepLast?: boolean;
  } | null;
  /**
   * How far below 1:1 the drawing is rendering, measured by the caller.
   *
   * The bar undoes it so its text stays readable at any stage width; nothing
   * else on the drawing needs it, because everything else *is* the drawing.
   */
  scale?: number;
  /**
   * The free ground the wrap leaves around the drawing, in user units, so the
   * bar can hang there rather than over the next card (`barRoom`).
   */
  barMargin?: { t: number; r: number; b: number; l: number };
  /**
   * The icons drawn on whatever the pointer is over (`HoverTools`). Absent
   * means none: Build leaves it out, Break passes its short list.
   */
  tools?: (key: string) => readonly CanvasTool[];
  /** When the icons act ("at t = 20 s"): the playhead, said on each one's title. */
  toolsWhen?: string;
  /**
   * How large the drawing is asked to be drawn, 1 being its own size.
   *
   * It is the rendered `width`/`height` and nothing else: the viewBox is
   * untouched, so every coordinate on the drawing, every golden and every
   * placement arithmetic keeps meaning exactly what it meant. Above 1 the
   * drawing outgrows the stage and the stage scrolls, which is the whole point
   * -- a 12-site configuration at 1:1 has cards the size of a caption.
   */
  zoomFactor?: number;
  /**
   * `zoomFactor` was chosen by the room (`zoom.ts`, `zoomAuto`), not by the
   * reader: the wrap stays centred and does not scroll, since the drawing was
   * made to fit it.
   */
  fitted?: boolean;
  /**
   * The drawing is at its true size in a region of its own (Break's Split
   * before `Fit`): the wrap is the scroll port and centres what is smaller
   * than it, so nothing is capped and 100% means 1:1 on screen.
   */
  trueSize?: boolean;
  /** Whether there is more drawing than region, so a grab has something to move. */
  pannable?: boolean;
  /** The wheel, one rung of the caller's ladder per notch (`WHEEL_NOTCH`). */
  onZoomStep?: (dir: 1 | -1) => void;
  onCloseBar?: () => void;
  /** `Shift+F10`, the context-menu key, or the right button on an entity. */
  onContextMenu?: (key: string) => void;
  /** A double click, or `F2`: the reader wants to rename it, in place. */
  onOpen?: (key: string) => void;
  /**
   * The key that carries the `...` handle -- the pointer's way to the action
   * bar now that a click only selects. Pressing it is `onContextMenu`.
   */
  handle?: string | null;
  /** The name being edited in place, over the card or the data centre it names. */
  rename?: {
    key: string;
    initial: string;
    verdict: (raw: string) => WhyState;
    commit: (raw: string) => void;
    cancel: () => void;
  } | null;
  /** The data centre a palette chip is being dragged over, lit as a drop target. */
  dropHint?: string | null;
  /** Hands the caller a hit test: the data centre under a client point, or null. */
  siteAtRef?: (fn: ((clientX: number, clientY: number) => string | null) | null) => void;
  /** The `<figure>`, for a caller that has to measure the drawing. */
  wrapRef?: (el: HTMLElement | null) => void;
}

/**
 * A pointer held down on the drawing, in one of its two meanings.
 *
 * `card` moves an object and writes an edit; `pan` moves the *view* and writes
 * nothing -- it scrolls the port the drawing sits in. One state machine for
 * both, because the parts that matter are the parts they share: the 4 px
 * threshold that keeps a click a click, and the capture that is taken only
 * once that threshold is crossed.
 */
interface CardDrag {
  kind: 'card';
  key: string;
  /** Every card this drag carries, with the offset each started from. */
  bases: Record<string, LayoutOffset>;
  startX: number;
  startY: number;
  scale: number;
  moved: boolean;
  /** The other data centre the pointer is over, when the caller takes drops. */
  over: string | null;
  /** The other host the pointer is over, when the caller takes a merge. */
  hostOver: string | null;
  /** True only for a lone card's own drag -- a blade pressed by itself, or a
      single card with no stack at all. Never a header drag (2+ blades) or a
      data centre's own drag: only a single card has one meaning for "the
      host under the pointer", so only a single card offers the merge. */
  canMerge: boolean;
}

/** A line being drawn from a card's port: nothing moves until it lands. */
interface LinkDrag {
  kind: 'link';
  from: string;
  startX: number;
  startY: number;
  scale: number;
  moved: boolean;
  /** The card under the pointer, other than the one the line came from. */
  over: string | null;
}

interface PanDrag {
  kind: 'pan';
  startX: number;
  startY: number;
  /** Where the scroll port was scrolled to when the pointer went down. */
  left: number;
  top: number;
  stage: Element;
  moved: boolean;
}

/** A rectangle dragged over the ground: what it covers becomes the selection. */
interface MarqueeDrag {
  kind: 'marquee';
  startX: number;
  startY: number;
  scale: number;
  moved: boolean;
  additive: boolean;
}

/** A data centre's handle being dragged: which edges move, from which box. */
interface ResizeDrag {
  kind: 'resize';
  site: string;
  edges: ResizeEdges;
  /** The box as drawn when the handle was pressed, and what bounds it. */
  start: Rect;
  fit: Rect;
  anchor: { x: number; y: number };
  empty: boolean;
  startX: number;
  startY: number;
  scale: number;
  moved: boolean;
}

export interface ResizeEdges { l: boolean; r: boolean; t: boolean; b: boolean }

type DragState = CardDrag | PanDrag | LinkDrag | MarqueeDrag | ResizeDrag;

/** The eight handles of a data centre's box, by compass point. */
const HANDLES: readonly { id: string; edges: ResizeEdges; cursor: string }[] = [
  { id: 'n', edges: { l: false, r: false, t: true, b: false }, cursor: 'ns' },
  { id: 's', edges: { l: false, r: false, t: false, b: true }, cursor: 'ns' },
  { id: 'w', edges: { l: true, r: false, t: false, b: false }, cursor: 'ew' },
  { id: 'e', edges: { l: false, r: true, t: false, b: false }, cursor: 'ew' },
  { id: 'nw', edges: { l: true, r: false, t: true, b: false }, cursor: 'nwse' },
  { id: 'se', edges: { l: false, r: true, t: false, b: true }, cursor: 'nwse' },
  { id: 'ne', edges: { l: false, r: true, t: true, b: false }, cursor: 'nesw' },
  { id: 'sw', edges: { l: true, r: false, t: false, b: true }, cursor: 'nesw' },
];

/**
 * A data centre's box with some of its edges moved by (dx, dy), in the
 * drawing's units: snapped to the 8 px grid, never smaller than `SITE_MIN`,
 * and never cutting into the cards it holds (`fit`) -- as the sized override
 * `layoutTopology` reads back (`dx`/`dy` from the box's `anchor`).
 */
export function resizedBox(
  from: { start: Rect; fit: Rect; anchor: { x: number; y: number }; empty: boolean },
  edges: ResizeEdges, dx: number, dy: number,
): LayoutOffset {
  const { start, fit } = from;
  let x0 = start.x; let y0 = start.y; let x1 = start.x + start.w; let y1 = start.y + start.h;
  const sx = snap8(dx); const sy = snap8(dy);
  const hold = !from.empty;
  if (edges.l) x0 = Math.min(x0 + sx, x1 - SITE_MIN.w, hold ? fit.x : Infinity);
  if (edges.r) x1 = Math.max(x1 + sx, x0 + SITE_MIN.w, hold ? fit.x + fit.w : -Infinity);
  if (edges.t) y0 = Math.min(y0 + sy, y1 - SITE_MIN.h, hold ? fit.y : Infinity);
  if (edges.b) y1 = Math.max(y1 + sy, y0 + SITE_MIN.h, hold ? fit.y + fit.h : -Infinity);
  return { dx: x0 - from.anchor.x, dy: y0 - from.anchor.y, w: x1 - x0, h: y1 - y0 };
}

const DRAG_THRESHOLD = 4;

/** The entity a pointer or context-menu event landed on, or `null` for ground. */
const keyAt = (target: EventTarget | null): string | null => {
  if (!isElement(target)) return null;
  return target.closest('[data-node]')?.getAttribute('data-node') ?? null;
};

/** True inside the action bar, which is HTML painted into the drawing. */
const insideBar = (target: EventTarget | null): boolean =>
  isElement(target)
  && (target.closest('.tp-actions') !== null || target.closest('.tp-rename') !== null);

/**
 * The element a pan actually scrolls.
 *
 * The wrap, whenever the drawing has been zoomed: `.tp-wrap.is-zoomed` is
 * `overflow: auto` in canvas.css, and the class and that rule are the same
 * fact, so asking for the class is asking whether the wrap is the scroll port.
 * It has to be the wrap rather than the stage, because the strips above the
 * drawing are the wrap's siblings -- scrolling the stage instead would carry
 * the zoom control off the screen with the drawing it zooms.
 *
 * At 1:1 the wrap does not scroll and the stage is the fallback: a drawing can
 * still be taller than a short stage without any zoom at all. In Learn there
 * is neither, and the press stays what it already was -- a click on the ground.
 */
const scrollerFor = (svg: SVGSVGElement): Element | null => {
  const wrap = svg.closest('.tp-wrap');
  if (wrap !== null && wrap.classList.contains('is-zoomed')) return wrap;
  return svg.closest('.app-stage');
};

/** Wheel units that make one rung: a mouse notch is 100-120, a pinch step a few. */
const WHEEL_NOTCH = 50;
/** A pause this long ends a wheel gesture. */
const WHEEL_IDLE_MS = 250;

/** Grab thickness of a handle, and the size of the square drawn on it. */
const HANDLE_HIT = 12;
const HANDLE_DOT = 7;

/** Where a handle can be grabbed: a square on a corner, a strip along an edge. */
function handleHit(r: Rect, e: ResizeEdges): Rect {
  const t = HANDLE_HIT;
  const corner = (e.l || e.r) && (e.t || e.b);
  if (corner) {
    return { x: (e.l ? r.x : r.x + r.w) - t / 2 - 2, y: (e.t ? r.y : r.y + r.h) - t / 2 - 2, w: t + 4, h: t + 4 };
  }
  if (e.t || e.b) return { x: r.x + t, y: (e.t ? r.y : r.y + r.h) - t / 2, w: Math.max(0, r.w - 2 * t), h: t };
  return { x: (e.l ? r.x : r.x + r.w) - t / 2, y: r.y + t, w: t, h: Math.max(0, r.h - 2 * t) };
}

/** The small square drawn on a handle: on the corner, or mid-edge. */
function handleDot(r: Rect, e: ResizeEdges): Rect {
  const cx = e.l ? r.x : e.r ? r.x + r.w : r.x + r.w / 2;
  const cy = e.t ? r.y : e.b ? r.y + r.h : r.y + r.h / 2;
  return { x: cx - HANDLE_DOT / 2, y: cy - HANDLE_DOT / 2, w: HANDLE_DOT, h: HANDLE_DOT };
}

export function TopoCanvas(props: TopoCanvasProps): JSX.Element {
  const {
    doc, graph, frame = null, prefix = 'tp', interactive = true, zoomFactor = 1,
  } = props;
  const overrides = props.overrides ?? {};
  const selection = props.selection ?? [];
  const hovered = props.hovered ?? null;

  const geo = useMemo(
    () => props.geometry ?? layoutTopology(doc, graph, { overrides }),
    [props.geometry, doc, graph, overrides],
  );
  const routed = useMemo(() => routeTopology(doc, graph, geo, frame), [doc, graph, geo, frame]);
  const aria = useMemo(() => describeTopology(doc, graph, frame), [doc, graph, frame]);
  /* What a drag in flight holds still: the viewBox, so the drawing does not
     rescale under the pointer as the thing being dragged changes the bounds,
     and -- for a card's drag -- every data centre's rectangle, so the panel a
     card is carried inside or out of keeps its size until the drop (task 1.2).
     A data centre's own drag leaves `sites` live: its panel is what moves. */
  const [frozen, setFrozen] = useState<{ view: ViewBox; sites: readonly SiteBox[] | null } | null>(null);
  const view = frozen?.view ?? unionViewBox(geo.viewBox, routed.bounds);
  /* The panels as the reader sees them, and so as the drop is aimed at them. */
  const sitesDrawn = frozen?.sites ?? geo.sites;
  /* A card drag in flight, as the drawing shows it (task 1.5): the cards it
     carries, how far short of the pointer the 8 px grid holds them (`rx`,
     `ry` -- the cards follow the pointer, their outline shows the snap), the
     pointer itself for the note beside it, and a host that refuses the card. */
  const [air, setAir] = useState<{
    key: string; keys: readonly string[]; group: boolean; canMerge: boolean;
    rx: number; ry: number; x: number; y: number;
    denied: { host: string; why: string } | null;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  /* Every focusable thing on the drawing, by key: cards, site panels and the
     caption pill of each link. One map, because the ids share one namespace --
     a broker configuration cannot hold a member and a data centre called the
     same thing -- and because the key handlers are the same handlers. */
  const cards = useRef(new Map<string, SVGGElement>());
  const drag = useRef<DragState | null>(null);
  /* Which card in each site is the site's tab stop. It follows the arrows, so
     tabbing away from a site and back again returns to the card the reader
     left, not to the top of the column. */
  const [visited, setVisited] = useState<string | null>(null);
  /* The same, for the links: the whole set of them is *one* tab stop, so Tab
     does not walk twelve captions before it reaches the drawing's other half,
     and the arrows walk them in routed order once the focus is on one. */
  const [visitedLink, setVisitedLink] = useState<string | null>(null);
  /* A live pan, which is a cursor and nothing else -- but a cursor that has to
     survive the pointer leaving the ground it was pressed on, so it is state
     rather than a `:active` rule. */
  const [panning, setPanning] = useState(false);
  /* A card, a data centre or a selection rectangle in flight: the drawing
     turns off anything a browser would do with the same press -- chiefly a
     text selection that would paint every label the pointer crosses. */
  const [moving, setMoving] = useState<string | null>(null);
  /* What the pointer is over, for the hover icons: read off the event target
     rather than the `hovered` prop, because a card inside a data centre hands
     the hover back to nobody when the pointer leaves it for the panel's ground. */
  const [toolKey, setToolKey] = useState<string | null>(null);
  /* A drag in flight, as the drawing shows it: the panel about to take the
     card, or the line from a port to the pointer and the card it is over. State
     rather than a ref, because the drawing has to repaint on every move. */
  const [dropSite, setDropSite] = useState<string | null>(null);
  /* The other host a single-card drag is over, so its card (or its stack's
     frame) can say it will take the card -- `null` off any host, and always
     `null` for a drag that carries more than one card. */
  const [hostDropTarget, setHostDropTarget] = useState<string | null>(null);
  const [rubber, setRubber] = useState<{
    from: string; x: number; y: number; over: string | null;
    what: { label: string; enabled: WhyState } | null;
  } | null>(null);
  /* The bar's real height, once it has been painted: the estimate in
     `barFootprint` places it, the measurement sizes the box so a row the
     estimate did not count is not cut off at the bottom. */
  const [barMeasured, setBarMeasured] = useState<{ key: string; w: number; h: number } | null>(null);
  /* The selection rectangle while it is being dragged, in the drawing's units. */
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /* `Space` held: the next drag on the ground is a pan even where a modifier
     would have started a selection. A ref, because it is read at the press and
     never painted. */
  const spaceHeld = useRef(false);
  /* The wheel's leftovers, and the spot a zoom must keep under the pointer. */
  const wheelAcc = useRef({ sum: 0, at: 0 });
  const zoomAnchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);
  /* The window the drawing is in, which may be a popup (common/popout.tsx). */
  const host = useHostWindow();
  useEffect(() => {
    if (!interactive || !props.onSelectMany || host === null) return undefined;
    const down = (ev: KeyboardEvent): void => { if (ev.key === ' ') spaceHeld.current = true; };
    const up = (ev: KeyboardEvent): void => { if (ev.key === ' ') spaceHeld.current = false; };
    host.addEventListener('keydown', down);
    host.addEventListener('keyup', up);
    return () => {
      host.removeEventListener('keydown', down);
      host.removeEventListener('keyup', up);
    };
  }, [interactive, props.onSelectMany !== undefined, host]);

  /**
   * The pointer in the drawing's own units.
   *
   * Through the screen CTM where there is one, which is exact whatever the
   * stage did to the box; by proportion where there is not (jsdom), which is
   * exact whenever the box keeps the viewBox's aspect -- and it does, because
   * the width and height attributes are the viewBox scaled by one factor.
   */
  const toUser = (clientX: number, clientY: number, scale: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (svg === null) return { x: 0, y: 0 };
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (ctm !== null && typeof DOMPoint === 'function') {
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    const rect = svg.getBoundingClientRect();
    return { x: view.x + (clientX - rect.left) * scale, y: view.y + (clientY - rect.top) * scale };
  };
  const inside = (r: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  /** The other site panel under the point, or null. */
  const siteUnder = (p: { x: number; y: number }, own: string): string | null =>
    sitesDrawn.find((s) => (s.id as string) !== own && inside(s, p))?.id as string | undefined ?? null;
  /** The other card under the point, or null: cards only, never a panel or a caption. */
  const cardUnder = (p: { x: number; y: number }, own: string): string | null =>
    geo.nodes.find((n) => n.key !== own && inside(n, p))?.key ?? null;
  /**
   * The one host a member or an observer stands on -- undefined for a RAC
   * member, which stands on more than one and so has no single host a drop
   * onto it, or a drop of it, could mean without guessing.
   */
  const hostIdOf = (key: string): string | undefined => {
    const member = doc.members.find((m) => (m.id as string) === key);
    if (member) return member.instances.length === 1 ? (member.instances[0]?.host as string | undefined) : undefined;
    const observer = doc.observers.find((o) => (o.id as string) === key);
    if (observer) return observer.host as string;
    return findApplication(doc, key)?.host as string | undefined;
  };
  /**
   * Where a single-card drag on `own` would merge it: a chassis stack whose
   * host differs from its own first (the frame and the header both count,
   * so hovering the band above the blades still offers the drop), another
   * card's host otherwise -- never `own`'s own host, so hovering the stack
   * it already stands in never offers to merge it with itself.
   */
  const mergeTargetUnder = (p: { x: number; y: number }, own: string): string | null => {
    const ownHost = hostIdOf(own);
    if (ownHost === undefined) return null;
    const stack = geo.stacks.find((s) => s.hostId !== ownHost && inside(s, p));
    if (stack) return stack.hostId;
    const card = cardUnder(p, own);
    if (card === null) return null;
    const h = hostIdOf(card);
    return h === undefined || h === ownHost ? null : h;
  };
  /**
   * Where a drawn line may land: another card first, another data centre's
   * panel otherwise. Never the panel the line started in -- the port sits
   * inside it, so a line barely past the drag threshold would already be
   * "over" it, and a slip of the hand would add a standby.
   */
  const linkTargetUnder = (p: { x: number; y: number }, own: string): string | null => {
    /* From a data centre the line is a site link, and only another data
       centre can take the other end of one. */
    if (!geo.byKey[own]) return siteUnder(p, own);
    const card = cardUnder(p, own);
    if (card !== null) return card;
    const ownSite = geo.byKey[own]?.site as string | undefined;
    return geo.sites.find((s) => (s.id as string) !== ownSite && inside(s, p))?.id as string | undefined ?? null;
  };

  /* The palette's chips are HTML outside the drawing, so their drag asks the
     drawing which data centre a client point is over. Re-handed every render:
     it closes over this render's geometry. */
  const siteAtRef = props.siteAtRef;
  useLayoutEffect(() => {
    if (!siteAtRef) return undefined;
    siteAtRef((cx, cy) => {
      const svg = svgRef.current;
      if (svg === null) return null;
      const rect = svg.getBoundingClientRect();
      const scale = rect.width > 0 ? view.w / rect.width : 1;
      const p = toUser(cx, cy, scale);
      return geo.sites.find((st) => inside(st, p))?.id as string | undefined ?? null;
    });
    return () => siteAtRef(null);
  });

  const cardRef = useCallback((key: string, el: SVGGElement | null) => {
    if (el) cards.current.set(key, el);
    else cards.current.delete(key);
  }, []);

  const isSelected = (key: string): boolean => selection.includes(key);
  /** Which instance row of this RAC card is selected (`sby01~2`), if one is. */
  const selectedInstanceOf = (key: string): number | null => {
    for (const k of selection) {
      const at = parseInstanceKey(k);
      if (at !== null && at.member === key) return at.index;
    }
    return null;
  };
  const linkAt = (key: string): number => routed.links.findIndex((l) => linkKey(l) === key);

  /* The tab stop follows the focus, per kind: a card is its site's stop, a
     link is the one stop the whole set of them shares. */
  const remember = (key: string): void => {
    if (geo.byKey[key]) setVisited(key);
    else if (linkAt(key) >= 0) setVisitedLink(key);
  };

  /* A click selects; what the click offers, if anything, is the caller's --
     `onSelect` opens the action bar in Break. */
  const onCardSelect = (key: string, additive: boolean): void => {
    remember(key);
    props.onSelect?.(key, additive);
  };

  /* ---- keyboard: arrows walk one site, Tab steps between them ---- */
  const focusNode = (key: string): void => {
    remember(key);
    cards.current.get(key)?.focus();
  };

  /** Every blade of the chassis stack `key` stands in, itself included -- or
      just `key` alone on a host of its own. */
  const stackMatesOf = (key: string): string[] => {
    const n = geo.byKey[key];
    const sk = n?.stackKey;
    if (sk === undefined) return [key];
    return geo.nodes.filter((x) => x.stackKey === sk).map((x) => x.key);
  };

  /**
   * The cards a gesture on `key` carries: the selected ones when it is one of
   * them, or its whole chassis stack otherwise -- a drag on one blade, or on
   * the header above it, always moves every blade in the stack together, in
   * one edit (`carried` is what both `onCardPointerDown` and the `Alt`-arrow
   * nudge build their `bases`/keys from).
   */
  const carried = (key: string): string[] => {
    if (!selection.includes(key)) return stackMatesOf(key);
    const many = selection.filter((k) => geo.byKey[k] !== undefined);
    if (many.length === 0) return stackMatesOf(key);
    const set = new Set<string>();
    for (const k of many) for (const mate of stackMatesOf(k)) set.add(mate);
    return [...set];
  };

  /**
   * The cards a press on one blade carries: itself alone, so a blade can be
   * pulled out of its stack, unless it stands in a multi-selection of two or
   * more cards -- then the drag is the selection's drag and keeps carrying
   * every stack mate the way `carried` always has. The header keeps carrying
   * the whole stack unconditionally (`onHeaderPointerDown`, below): only a
   * lone blade's own drag has one card and one meaning for "the host under
   * the pointer".
   */
  const carriedByBlade = (key: string): string[] => {
    const many = selection.filter((k) => geo.byKey[k] !== undefined).length > 1;
    return many && selection.includes(key) ? carried(key) : [key];
  };

  const siblings = (node: NodeBox): NodeBox[] => geo.nodes
    .filter((n) => (n.site as string) === (node.site as string))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  /**
   * The keys every focusable thing on the drawing answers.
   *
   * One handler for cards, data centres and captions, because they are one
   * contract: a data centre that could be selected with the mouse and not with
   * `Enter`, or removed from a card and not from its own rectangle, is the
   * drawing telling two stories about one object. The arrows are the part that
   * differs per kind, and they are handled above this.
   */
  const onEntityKey = (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    switch (ev.key) {
      case 'Enter':
      case ' ': {
        ev.preventDefault();
        onCardSelect(key, ev.shiftKey);
        return;
      }
      case 'e':
      case 'E': {
        ev.preventDefault();
        props.onEvents?.(key);
        return;
      }
      case 'Delete':
      case 'Backspace': {
        ev.preventDefault();
        props.onDelete?.(key);
        return;
      }
      case 'Escape': {
        /* The bar first, the selection second: closing a menu and forgetting
           what it was about are two presses, not one. */
        ev.preventDefault();
        if (props.bar) props.onCloseBar?.();
        else props.onClear?.();
        return;
      }
      case 'F2': {
        if (!props.onOpen) return;
        ev.preventDefault();
        props.onOpen(key);
        return;
      }
      case 'F10': {
        if (!ev.shiftKey) return;
        ev.preventDefault();
        props.onContextMenu?.(key);
        return;
      }
      case 'ContextMenu': {
        ev.preventDefault();
        props.onContextMenu?.(key);
        return;
      }
      default:
    }
  };

  const onCardKey = (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    const node = geo.byKey[key];
    /* Not a card: an instance row's key, which answers what every entity does. */
    if (!node) { onEntityKey(key, ev); return; }
    const list = siblings(node);
    const at = list.findIndex((n) => n.key === key);
    /* `Alt` and an arrow moves the card rather than the focus: one 8 px step,
       four of them with `Shift`, for every selected card when this is one. */
    if (ev.altKey && props.onNudge && ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const step = ev.shiftKey ? 32 : 8;
      const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
      const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
      props.onNudge(carried(key), dx, dy);
      return;
    }
    switch (ev.key) {
      case 'ArrowDown':
      case 'ArrowRight': {
        const next = list[Math.min(list.length - 1, at + 1)];
        if (next) { ev.preventDefault(); focusNode(next.key); }
        return;
      }
      case 'ArrowUp':
      case 'ArrowLeft': {
        const prev = list[Math.max(0, at - 1)];
        if (prev) { ev.preventDefault(); focusNode(prev.key); }
        return;
      }
      default:
        onEntityKey(key, ev);
    }
  };

  /**
   * A data centre's keys: `Alt` and an arrow resizes it from its bottom right
   * corner -- one 8 px step, four with `Shift` -- the keyboard's way to what
   * the handles do; everything else is every entity's.
   */
  const onSiteKey = (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    if (ev.altKey && props.onResizeBy && ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      const step = ev.shiftKey ? 32 : 8;
      const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
      const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
      props.onResizeBy(key, dx, dy);
      return;
    }
    onEntityKey(key, ev);
  };

  /** The captions are one stop and a list: the arrows walk them in routed order. */
  const onLinkKey = (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    const at = linkAt(key);
    if (at < 0) { onEntityKey(key, ev); return; }
    switch (ev.key) {
      case 'ArrowDown':
      case 'ArrowRight': {
        const next = routed.links[Math.min(routed.links.length - 1, at + 1)];
        if (next) { ev.preventDefault(); focusNode(linkKey(next)); }
        return;
      }
      case 'ArrowUp':
      case 'ArrowLeft': {
        const prev = routed.links[Math.max(0, at - 1)];
        if (prev) { ev.preventDefault(); focusNode(linkKey(prev)); }
        return;
      }
      default:
        onEntityKey(key, ev);
    }
  };

  /* ---- drag: pointer capture on the svg, deltas in user units ---- */

  /** Common setup for any drag that carries one or more cards: `keys` fixes
      `bases` now, the capture itself waits for the drag threshold
      (`onPointerMove`) so a plain click still reaches the card's own
      `onClick`. `canMerge` is true only when this is a lone blade's own
      drag -- the one case a host under the pointer has one meaning. */
  const beginCardDrag = (
    key: string, keys: readonly string[], canMerge: boolean, ev: JSX.TargetedPointerEvent<SVGGElement>,
  ): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width > 0 ? view.w / rect.width : 1;
    const bases: Record<string, LayoutOffset> = {};
    for (const k of keys) bases[k] = overrides[k] ?? { dx: 0, dy: 0 };
    drag.current = {
      kind: 'card',
      key,
      bases,
      startX: ev.clientX,
      startY: ev.clientY,
      scale,
      moved: false,
      over: null,
      hostOver: null,
      canMerge,
    };
  };

  /** A press on a blade: carries only itself, unless it is part of a
      multi-selection (`carriedByBlade`) -- the one gesture that can pull a
      card out of the stack it shares with others. */
  const onCardPointerDown = (key: string, ev: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (!props.onDrag && !props.onDragEnd) return;
    if (ev.button !== 0) return;
    const node = geo.byKey[key];
    if (!svgRef.current || !node) return;
    /* A press on the card's port starts a line, not a move. */
    if (isElement(ev.target) && ev.target.closest('.tp-port') !== null) return;
    const keys = carriedByBlade(key);
    beginCardDrag(key, keys, keys.length === 1, ev);
  };

  /** A press on the chassis header: always carries the whole stack, the
      gesture `StackChassis` offers over every blade at once. */
  const onHeaderPointerDown = (key: string, ev: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (!props.onDrag && !props.onDragEnd) return;
    if (ev.button !== 0) return;
    const node = geo.byKey[key];
    if (!svgRef.current || !node) return;
    beginCardDrag(key, carried(key), false, ev);
  };

  /**
   * A press on a data centre's own panel: the whole data centre moves as one.
   *
   * Every member and observer standing in it is carried under its own key --
   * `bases` is what `offsetsOf` steps and what `onDrag` writes, so one drag
   * is one edit for the whole group, coalesced under the site's key
   * (`drag:${id}`, `CanvasSlot`'s `onDrag`, generic over what the drag
   * carries). An empty panel has no member to carry the move for, so it
   * carries its own id instead -- the one case `layoutTopology` reads a
   * site-keyed offset, to slide the panel itself (`layout.ts` step 8). An
   * occupied site never writes to its own key: every member already moved by
   * the same delta already drags the derived box with it, and a leftover
   * offset on the site's id would reappear out of nowhere the day its last
   * member left and the panel became the empty case.
   *
   * Never carries `onMoveToSite`: the site's own key has no entry in
   * `geo.byKey` (that map holds only member and observer nodes), so the
   * "which site is the pointer over" check in `onPointerMove`/`endDrag`
   * finds no owning site for it and never fires a drop.
   */
  const onSitePointerDown = (key: string, ev: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (!props.onDrag && !props.onDragEnd) return;
    if (ev.button !== 0) return;
    /* A press on the site's own port starts a line, not a move. */
    if (isElement(ev.target) && ev.target.closest('.tp-port') !== null) return;
    const svg = svgRef.current;
    const site = geo.sites.find((s) => (s.id as string) === key);
    if (!svg || !site) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width > 0 ? view.w / rect.width : 1;
    const members = geo.nodes.filter((n) => (n.site as string) === key).map((n) => n.key);
    /* A box with a size of its own is carried with its cards, under its own key. */
    const keys = members.length === 0 ? [key] : site.sized ? [...members, key] : members;
    const bases: Record<string, LayoutOffset> = {};
    for (const k of keys) bases[k] = overrides[k] ?? { dx: 0, dy: 0 };
    drag.current = {
      kind: 'card',
      key,
      bases,
      startX: ev.clientX,
      startY: ev.clientY,
      scale,
      moved: false,
      over: null,
      hostOver: null,
      canMerge: false,
    };
  };

  /** A press on a card's port: the start of a line to another card. */
  const onPortPointerDown = (key: string, ev: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (!props.onConnect || ev.button !== 0) return;
    const svg = svgRef.current;
    if (!svg || (!geo.byKey[key] && !geo.sites.some((st) => (st.id as string) === key))) return;
    ev.stopPropagation();
    const rect = svg.getBoundingClientRect();
    drag.current = {
      kind: 'link',
      from: key,
      startX: ev.clientX,
      startY: ev.clientY,
      scale: rect.width > 0 ? view.w / rect.width : 1,
      moved: false,
      over: null,
    };
  };

  /**
   * A press on the ground between the cards: the reader is grabbing the paper.
   *
   * Only where there is paper to grab -- a scrolling ancestor, which
   * `scrollerFor` names.
   */
  const onSvgPointerDown = (ev: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if ((ev.button !== 0 && ev.button !== 1) || drag.current !== null) return;
    if (keyAt(ev.target) !== null || insideBar(ev.target)) return;
    const svg = svgRef.current;
    /* Where the caller takes a rectangle, it is a modifier-drag: the plain drag
       is the pan, the way it is on a map. */
    if (props.onSelectMany && ev.button === 0 && !spaceHeld.current && svg !== null
      && (ev.shiftKey || ev.metaKey || ev.ctrlKey)) {
      const rect = svg.getBoundingClientRect();
      drag.current = {
        kind: 'marquee',
        startX: ev.clientX,
        startY: ev.clientY,
        scale: rect.width > 0 ? view.w / rect.width : 1,
        moved: false,
        additive: true,
      };
      return;
    }
    if (ev.button === 1) ev.preventDefault();
    const stage = svg === null ? null : scrollerFor(svg);
    if (stage === null) return;
    drag.current = {
      kind: 'pan',
      startX: ev.clientX,
      startY: ev.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
      stage,
      moved: false,
    };
  };

  /**
   * The moment a press becomes a drag: capture the pointer, and drop any text
   * selection a browser may already have begun from the press (Safari starts
   * one on `mousedown` whatever `user-select` says about the target, once the
   * pointer has crossed into ordinary page text).
   */
  const takeDrag = (ev: JSX.TargetedPointerEvent<SVGSVGElement>, cursor = 'grab'): void => {
    svgRef.current?.setPointerCapture?.(ev.pointerId);
    host?.getSelection?.()?.removeAllRanges();
    setMoving(cursor);
  };

  const onPointerMove = (ev: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      /* Capture on the same terms as a card drag: only once this has become a
         pan, so a plain click on the ground still reaches its own handler. */
      if (!d.moved) { takeDrag(ev); setPanning(true); }
      d.moved = true;
      /* The paper follows the pointer, so the scroll goes the other way. */
      d.stage.scrollLeft = d.left - dx;
      d.stage.scrollTop = d.top - dy;
      return;
    }
    if (d.kind === 'marquee') {
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD) return;
      if (!d.moved) takeDrag(ev);
      d.moved = true;
      setBand(bandOf(d, ev.clientX, ev.clientY));
      return;
    }
    if (d.kind === 'resize') {
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD) return;
      if (!d.moved) {
        const h = HANDLES.find((x) => x.edges.l === d.edges.l && x.edges.r === d.edges.r
          && x.edges.t === d.edges.t && x.edges.b === d.edges.b);
        takeDrag(ev, h?.cursor ?? 'grab');
        setFrozen({ view, sites: null });
      }
      d.moved = true;
      props.onResizeSite?.(d.site, resizedBox(d, d.edges,
        (ev.clientX - d.startX) * d.scale, (ev.clientY - d.startY) * d.scale));
      return;
    }
    if (d.kind === 'link') {
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!d.moved) takeDrag(ev);
      d.moved = true;
      const p = toUser(ev.clientX, ev.clientY, d.scale);
      d.over = linkTargetUnder(p, d.from);
      const what = d.over === null ? null : props.connectWhat?.(d.from, d.over) ?? null;
      setRubber({ from: d.from, x: p.x, y: p.y, over: d.over, what });
      return;
    }
    const dx = (ev.clientX - d.startX) * d.scale;
    const dy = (ev.clientY - d.startY) * d.scale;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      takeDrag(ev);
      const ownPanel = geo.sites.some((st) => (st.id as string) === d.key);
      setFrozen({ view, sites: ownPanel ? null : geo.sites });
    }
    d.moved = true;
    const all = offsetsOf(d, dx, dy);
    props.onDrag?.(d.key, all[d.key] as LayoutOffset, all);
    const p = toUser(ev.clientX, ev.clientY, d.scale);
    const aimed = props.onMergeIntoHost && d.canMerge ? mergeTargetUnder(p, d.key) : null;
    const verdict = aimed === null ? null : props.mergeWhat?.(d.key, aimed) ?? null;
    const denied = aimed !== null && verdict !== null && verdict.state === 'off'
      ? { host: aimed, why: verdict.why } : null;
    const hostOver = denied === null ? aimed : null;
    if (hostOver !== d.hostOver) { d.hostOver = hostOver; setHostDropTarget(hostOver); }
    setAir({
      key: d.key,
      keys: Object.keys(d.bases),
      group: geo.sites.some((st) => (st.id as string) === d.key),
      canMerge: d.canMerge && props.onMergeIntoHost !== undefined,
      rx: dx - snap8(dx),
      ry: dy - snap8(dy),
      x: p.x,
      y: p.y,
      denied,
    });
    if (props.onMoveToSite) {
      /* A host takes the drop first: the site highlight underneath it would
         only repeat what the card or the stack already says. */
      const own = geo.byKey[d.key]?.site as string | undefined;
      const over = hostOver !== null || own === undefined ? null : siteUnder(p, own);
      if (over !== d.over) { d.over = over; setDropSite(over); }
    }
  };

  const offsetsOf = (d: CardDrag, dx: number, dy: number): Record<string, LayoutOffset> => {
    const all: Record<string, LayoutOffset> = {};
    /* The delta is snapped, not the sum: every card's base is already on the
       grid, so for a card the two agree, and a data centre's sized box -- which
       is not on the grid -- keeps its place relative to its cards as it goes. */
    const sx = snap8(dx); const sy = snap8(dy);
    for (const [k, base] of Object.entries(d.bases)) {
      all[k] = { ...base, dx: base.dx + sx, dy: base.dy + sy };
    }
    return all;
  };
  const bandOf = (d: MarqueeDrag, cx: number, cy: number): { x: number; y: number; w: number; h: number } => {
    const a = toUser(d.startX, d.startY, d.scale);
    const b = toUser(cx, cy, d.scale);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  };

  const endDrag = (ev: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    svgRef.current?.releasePointerCapture?.(ev.pointerId);
    if (d.moved) { setMoving(null); setFrozen(null); }
    if (d.kind === 'pan') { if (d.moved) setPanning(false); return; }
    if (d.kind === 'resize') { if (d.moved) props.onResizeEnd?.(); return; }
    if (d.kind === 'marquee') {
      setBand(null);
      if (!d.moved) return;
      /* Whatever the rectangle touches, cards only: a data centre is always
         under it, and a selection of "everything and the room it is in" has
         no action in common. */
      const r = bandOf(d, ev.clientX, ev.clientY);
      const hit = geo.nodes
        .filter((n) => n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y)
        .map((n) => n.key);
      props.onSelectMany?.(hit, d.additive);
      return;
    }
    if (d.kind === 'link') {
      setRubber(null);
      if (!d.moved) return;
      /* Read at the drop, not from the last move: a drop is where the pointer
         is, and a pointer that stops moving still sends the up somewhere. */
      const over = linkTargetUnder(toUser(ev.clientX, ev.clientY, d.scale), d.from);
      if (over !== null) props.onConnect?.(d.from, over);
      return;
    }
    if (!d.moved) return;
    if (d.over !== null) setDropSite(null);
    if (d.hostOver !== null) setHostDropTarget(null);
    setAir(null);
    const dx = (ev.clientX - d.startX) * d.scale;
    const dy = (ev.clientY - d.startY) * d.scale;
    const all = offsetsOf(d, dx, dy);
    /* The merge or the site move, both read fresh at the drop rather than
       from the last move (a pointer that stops moving still sends the up
       somewhere) -- and both *before* `onDragEnd`, which breaks the
       coalescing window (`CanvasSlot`'s `breakCoalescing`): call it first
       and the drop's own edit would land on a fresh coalesce key instead of
       the drag's, and "the drag that carried it there" and the drop would be
       two undos rather than the one every caller's doc comment promises. */
    let dropped = false;
    /* Dropped onto another host: the merge is the caller's edit, and it takes
       the drop before `onMoveToSite` gets a look, the same priority the
       highlight already showed while it was still in the air. */
    if (props.onMergeIntoHost && d.canMerge) {
      const target = mergeTargetUnder(toUser(ev.clientX, ev.clientY, d.scale), d.key);
      const refused = target !== null && props.mergeWhat?.(d.key, target).state === 'off';
      if (target !== null && !refused) { props.onMergeIntoHost(d.key, target); dropped = true; }
    }
    /* Dropped in another data centre: the move is the caller's edit, coalesced
       under the same key the drag itself carries. The pressed card goes
       first -- its key is the one the drag coalesced under. */
    if (!dropped && d.over !== null) {
      const own = geo.byKey[d.key]?.site as string | undefined;
      const over = own === undefined ? null : siteUnder(toUser(ev.clientX, ev.clientY, d.scale), own);
      if (over !== null) {
        for (const k of [d.key, ...Object.keys(d.bases).filter((x) => x !== d.key)]) {
          if ((geo.byKey[k]?.site as string | undefined) !== over) props.onMoveToSite?.(k, over);
        }
      }
    }
    /* A whole data centre let go past the middle of a neighbour: that is a new
       column order, not a push. Left to the push (step 7c), its neighbours
       would slide out ahead of it and keep the old order, and the refitted
       view would put it straight back where it started. */
    if (!dropped && props.onReorderSites && geo.sites.some((st) => (st.id as string) === d.key)) {
      const order = reorderedSites(d, all);
      if (order !== null) {
        const settled: Record<string, LayoutOffset> = {};
        for (const [k, off] of Object.entries(all)) settled[k] = { ...off, dx: d.bases[k]?.dx ?? 0 };
        props.onReorderSites(d.key, order, settled);
        props.onDragEnd?.(d.key, settled[d.key] as LayoutOffset, settled);
        return;
      }
    }
    /* Let go inside the data centre it came from: a box that would now shrink
       round what is left in it keeps the size it had when the drag began, and
       only grows -- to take a card let go past its edge (task 1.2). */
    if (!dropped && d.over === null && props.onHoldSites && frozen?.sites) {
      const held = holdsAfter(frozen.sites, d, all);
      if (Object.keys(held).length > 0) props.onHoldSites(d.key, held);
    }
    props.onDragEnd?.(d.key, all[d.key] as LayoutOffset, all);
  };

  /**
   * The data centres left to right by the middle of each box as the drag
   * leaves them -- the carried one where it was let go, the others where they
   * stood -- or null when that is the order they are already drawn in.
   */
  const reorderedSites = (d: CardDrag, all: Readonly<Record<string, LayoutOffset>>): string[] | null => {
    const after = layoutTopology(doc, graph, {
      overrides: { ...overrides, ...all }, transient: Object.keys(d.bases), transientFrom: d.bases,
    });
    const byCol = [...after.sites].sort((a, b) => a.col - b.col).map((st) => st.id as string);
    const byX = [...after.sites]
      .sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2) || a.col - b.col)
      .map((st) => st.id as string);
    return byX.every((id, i) => id === byCol[i]) ? null : byX;
  };

  /** The data centres a card drag would shrink, with the box each should keep. */
  const holdsAfter = (
    was: readonly SiteBox[], d: CardDrag, all: Readonly<Record<string, LayoutOffset>>,
  ): Record<string, LayoutOffset> => {
    const after = layoutTopology(doc, graph, { overrides: { ...overrides, ...all } });
    const touched = new Set(Object.keys(d.bases)
      .map((k) => geo.byKey[k]?.site as string | undefined)
      .filter((x): x is string => x !== undefined));
    const out: Record<string, LayoutOffset> = {};
    for (const id of touched) {
      const before = was.find((st) => (st.id as string) === id);
      const now = after.sites.find((st) => (st.id as string) === id);
      if (!before || !now) continue;
      const holds = now.x <= before.x && now.y <= before.y
        && now.x + now.w >= before.x + before.w && now.y + now.h >= before.y + before.h;
      if (holds) continue;
      out[id] = { dx: before.x - now.anchor.x, dy: before.y - now.anchor.y, w: before.w, h: before.h };
    }
    return out;
  };

  /** A press on one of a data centre's handles: the start of a resize. */
  const onHandlePointerDown = (
    site: SiteBox, edges: ResizeEdges, ev: JSX.TargetedPointerEvent<SVGGElement>,
  ): void => {
    if (!props.onResizeSite || ev.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    ev.stopPropagation();
    const rect = svg.getBoundingClientRect();
    drag.current = {
      kind: 'resize',
      site: site.id as string,
      edges,
      start: { x: site.x, y: site.y, w: site.w, h: site.h },
      fit: site.fit,
      anchor: site.anchor,
      empty: site.empty,
      startX: ev.clientX,
      startY: ev.clientY,
      scale: rect.width > 0 ? view.w / rect.width : 1,
      moved: false,
    };
  };

  /**
   * The wheel zooms, one rung of the ladder per notch.
   *
   * A mouse notch is 100-120 units and steps at once; a trackpad sends a run
   * of small ones (and a pinch, flagged with Ctrl, smaller still), so the run
   * is summed and a rung is taken each time it crosses `WHEEL_NOTCH`. The sum
   * is dropped after a pause or a change of direction, so momentum does not
   * carry the next gesture over a rung. The point under the pointer is
   * remembered for the layout effect below, which scrolls it back under the
   * pointer once the drawing has its new size.
   */
  const onSvgWheel = (ev: JSX.TargetedWheelEvent<SVGSVGElement>): void => {
    if (!props.onZoomStep) return;
    ev.preventDefault();
    const acc = wheelAcc.current;
    const now = ev.timeStamp;
    const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
    if (now - acc.at > WHEEL_IDLE_MS || Math.sign(dy) !== Math.sign(acc.sum)) acc.sum = 0;
    acc.at = now;
    acc.sum += dy;
    if (Math.abs(acc.sum) < WHEEL_NOTCH) return;
    const dir = acc.sum < 0 ? 1 : -1;
    acc.sum = 0;
    const svg = svgRef.current;
    const box = svg?.getBoundingClientRect();
    zoomAnchor.current = box !== undefined && box.width > 0 && box.height > 0
      ? { fx: (ev.clientX - box.left) / box.width, fy: (ev.clientY - box.top) / box.height, x: ev.clientX, y: ev.clientY }
      : null;
    props.onZoomStep(dir);
  };

  /* After a zoom, put the remembered spot back under the pointer. */
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    zoomAnchor.current = null;
    const svg = svgRef.current;
    if (a === null || svg === null) return;
    const stage = scrollerFor(svg);
    if (stage === null) return;
    const box = svg.getBoundingClientRect();
    stage.scrollLeft += box.left + a.fx * box.width - a.x;
    stage.scrollTop += box.top + a.fy * box.height - a.y;
  }, [zoomFactor]);

  /**
   * A pointer-up that landed on nothing.
   *
   * The ground between the cards is a target too: it is where a reader clicks
   * to mean "never mind". A drag that has just ended is not that click, and
   * neither is a press inside the action bar -- which is HTML inside the
   * drawing, so it bubbles through here on its way to its own button.
   */
  const onSvgPointerUp = (ev: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    const wasCard = d !== null && (d.kind === 'card' || d.kind === 'link' || d.kind === 'resize');
    const panned = d !== null && (d.kind === 'pan' || d.kind === 'marquee') && d.moved;
    endDrag(ev);
    if (wasCard || panned) return;
    if (keyAt(ev.target) !== null || insideBar(ev.target)) return;
    props.onClear?.();
  };

  const onSvgPointerOver = (ev: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (drag.current !== null) return;
    const key = insideBar(ev.target) ? null : keyAt(ev.target);
    if (key !== toolKey) setToolKey(key);
  };

  const onSvgContextMenu = (ev: JSX.TargetedMouseEvent<SVGSVGElement>): void => {
    const key = keyAt(ev.target);
    if (key === null) return;
    ev.preventDefault();
    props.onContextMenu?.(key);
  };

  const onSvgDblClick = (ev: JSX.TargetedMouseEvent<SVGSVGElement>): void => {
    const key = keyAt(ev.target);
    if (key === null) return;
    ev.preventDefault();
    props.onOpen?.(key);
  };

  /* ---- a card in the air: what may take it, and where it will land ---- */
  const airOwnSite = air === null ? null : (geo.byKey[air.key]?.site as string | undefined) ?? null;
  /** Another data centre the carried cards may be dropped into. */
  const canDropIn = (site: string): boolean => air !== null && !air.group
    && props.onMoveToSite !== undefined && airOwnSite !== null && site !== airOwnSite;
  /**
   * How a host other than the carried card's own answers the drag: `maybe`
   * where it would take the card, `no` where the pointer is on one that
   * refuses it, `dim` where it cannot take it at all -- a RAC card, which
   * stands on no single host, or a host that refuses. Only a lone card's drag
   * has a merge to offer, so only it lights anything up.
   */
  const hostHint = (host: string | undefined): 'maybe' | 'no' | 'dim' | null => {
    if (air === null || !air.canMerge) return null;
    const own = hostIdOf(air.key);
    if (host === undefined) return 'dim';
    if (host === own) return null;
    if (air.denied?.host === host) return 'no';
    const v = props.mergeWhat?.(air.key, host);
    return v !== undefined && v.state === 'off' ? 'dim' : 'maybe';
  };
  const cardHint = (key: string): 'maybe' | 'no' | 'dim' | null => (air === null || !air.canMerge
    ? null : hostHint(hostIdOf(key)));
  /* The landing outlines, worked out once per target rather than per move. */
  const airKey = air?.key ?? null;
  const airKeys = air?.keys.join('\u0000') ?? '';
  const airGroup = air?.group ?? false;
  const ghosts = useMemo((): Rect[] => {
    if (airKey === null || airGroup) return [];
    if (hostDropTarget !== null || dropSite !== null) {
      const to = hostDropTarget !== null ? { host: hostDropTarget } : { site: dropSite as string };
      const r = landingFor(doc, graph, overrides, geo, sitesDrawn, airKey, to);
      return r === null ? [] : [r];
    }
    return airKeys.split('\u0000').map((k) => geo.byKey[k]).filter((n): n is NodeBox => n !== undefined);
  }, [airKey, airKeys, airGroup, hostDropTarget, dropSite, doc, graph, overrides, geo, sitesDrawn]);
  /** What the drop would do, said beside the pointer. */
  const airTip = ((): { text: string; refused: boolean } | null => {
    if (air === null) return null;
    const siteName = (id: string): string => doc.sites.find((st) => (st.id as string) === id)?.name ?? id;
    /* Refused by the host under it, but still over another data centre: the
       drop is the move, and the note says both. */
    if (air.denied !== null && dropSite !== null) {
      return { text: `Move to ${siteName(dropSite)} — not onto that host`, refused: false };
    }
    if (air.denied !== null) return { text: air.denied.why, refused: true };
    if (hostDropTarget !== null) {
      return { text: `Share host ${doc.hosts.find((h) => (h.id as string) === hostDropTarget)?.name ?? hostDropTarget}`, refused: false };
    }
    if (dropSite !== null) {
      return { text: `Move to ${siteName(dropSite)}`, refused: false };
    }
    return null;
  })();

  /* ---- one tab stop per site: Tab steps between sites, arrows walk one ---- */
  const tabStops = new Set<string>();
  for (const site of geo.sites) {
    const own = geo.nodes
      .filter((n) => (n.site as string) === (site.id as string))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const stop = own.find((n) => n.key === visited) ?? own[0];
    if (stop) tabStops.add(stop.key);
  }
  /* One stop for every caption on the drawing, not one per caption. */
  const linkStop = Math.max(0, routed.links.findIndex((l) => linkKey(l) === visitedLink));

  /* ---- the action bar: placed here, drawn last ---- */
  const bar = interactive ? props.bar ?? null : null;
  const k = Math.min(1, Math.max(0.5, props.scale ?? 1));
  const barAnchor = bar === null ? null : anchorFor(bar.key, geo, routed.links);
  const barEstimate = bar === null ? null
    : bar.sections !== undefined ? menuFootprint(bar.sections)
      : barFootprint(bar.actions, bar.quiet ?? null, bar.maxRows, bar.keepLast === true);
  /* The larger of the estimate and what was painted: the estimate is what the
     placement can know before the render, the measurement is what the box
     has to be. Never smaller than the estimate, so a measurement that has not
     happened yet (jsdom, the first frame) declares the generous box. */
  const barNatural = barEstimate === null || bar === null ? null : {
    w: barMeasured?.key === bar.key ? Math.max(barEstimate.w, barMeasured.w) : barEstimate.w,
    h: barMeasured?.key === bar.key ? Math.max(barEstimate.h, barMeasured.h) : barEstimate.h,
  };
  const onBarMeasure = (m: { w: number; h: number }): void => {
    if (bar === null) return;
    setBarMeasured((prev) => (
      prev !== null && prev.key === bar.key && prev.w === m.w && prev.h === m.h
        ? prev
        : { key: bar.key, w: m.w, h: m.h }));
  };
  /* In user units, and larger than the CSS size when the drawing is shrunk:
     the bar undoes the drawing's scale, so its footprint on the drawing grows
     as that scale falls. Placing against the CSS size put it off the stage. */
  const room = barRoom(view, props.barMargin ?? { t: 0, r: 0, b: 0, l: 0 });
  /* Break's menu shows every row, so it may be taller than the ground it
     has: then it is cut to that ground and scrolls, rather than shrinking its
     text (`fittedScale`) or running under the chrome. */
  /* A data centre's whole box: the bar stands beside it, not beside its name
     band inside it, over its own cards. */
  const barBody = bar === null || barAnchor === null ? null : bodyFor(bar.key, geo) ?? barAnchor;
  const barCap = bar?.sections === undefined || barAnchor === null || barNatural === null
    ? null
    : menuCap(barAnchor, room, k, barNatural.h, {
      width: barNatural.w, ...(barBody === null ? {} : { body: barBody }),
    });
  const barSize = barNatural === null ? null
    : barCap === null ? barNatural : { w: barNatural.w, h: Math.min(barNatural.h, barCap) };
  const barScale = barSize === null ? k : fittedScale(barSize, room, k);
  /* What the bar should not sit on: every other card and every caption --
     for a data centre, that is its own cards too: the bar is about the box,
     and covering what is in it hides what the menu is about. */
  const barObstacles = bar === null ? [] : [
    ...Object.entries(geo.byKey).filter(([key]) => key !== bar.key).map(([, n]) => n),
    ...routed.links.filter((l) => linkKey(l) !== bar.key).map((l) => l.pill),
  ];
  const barPlace = bar === null || barAnchor === null || barSize === null
    ? null
    : placeBar(
      barAnchor, { w: barSize.w / barScale, h: barSize.h / barScale }, room, barObstacles,
      barBody ?? barAnchor,
    );

  /* The handle: the top right corner of the subject's anchor. */
  const handleKey = interactive ? props.handle ?? null : null;
  const handleRect = handleKey === null || props.rename ? null : anchorFor(handleKey, geo, routed.links);
  const handleAt = handleKey === null || handleRect === null
    ? null
    : geo.byKey[handleKey]
      ? { key: handleKey, x: handleRect.x + handleRect.w, y: handleRect.y }
      /* A name band or a caption is too small to hang a corner off: beside it. */
      : { key: handleKey, x: handleRect.x + handleRect.w + 13, y: handleRect.y + handleRect.h / 2 };

  /* The hover icons: over the top edge of a card, in the top right corner of a
     data centre, over the caption of a line. */
  /* Not on the thing the bar is open for: the bar is the longer answer to the
     same question, and the strip drawn over the card's top edge sat on the
     bar's header whenever the bar went above or beside it. */
  const tools = !interactive || toolKey === null || moving !== null || !props.tools
    || (bar !== null && bar.key === toolKey)
    ? [] : props.tools(toolKey);
  const toolsAt = ((): { x: number; y: number } | null => {
    if (toolKey === null || tools.length === 0) return null;
    const px = toolsSize(tools.length);
    const w = px.w / k;
    const h = px.h / k;
    const node = geo.byKey[toolKey];
    if (node) return { x: node.x + node.w - w - 16, y: node.y - h + 4 };
    const site = sitesDrawn.find((st) => (st.id as string) === toolKey);
    if (site) return { x: site.x + site.w - w - 8, y: site.y + 6 };
    const line = routed.links.find((l) => linkKey(l) === toolKey);
    if (line) return { x: line.pill.x + line.pill.w / 2 - w / 2, y: line.pill.y - h + 2 };
    return null;
  })();

  /* The name field: over the name it edits. */
  const renameBox = ((): { x: number; y: number; w: number } | null => {
    const r = interactive ? props.rename ?? null : null;
    if (r === null) return null;
    const node = geo.byKey[r.key];
    if (node) {
      const tx = node.kind === 'member' ? CARD.textXDb : CARD.textXObs;
      return { x: node.x + tx - 5, y: node.y + 7, w: Math.max(96, node.w - tx - 3) };
    }
    const site = geo.sites.find((st) => (st.id as string) === r.key);
    if (!site) return null;
    const lab = siteLabelRect(site);
    const w = Math.max(120, lab.w + 24);
    return { x: lab.x + lab.w / 2 - w / 2, y: lab.y + lab.h / 2 - 12, w };
  })();

  const closeBar = (): void => {
    props.onCloseBar?.();
    /* Back to the thing the bar was about: a menu that closes and leaves the
       focus on the document body has lost the reader's place. */
    if (bar) cards.current.get(bar.key)?.focus();
  };

  const legend: string[] = [];
  if (!interactive) {
    legend.unshift(props.readOnlyWhy
      ?? 'This drawing is read-only here: nothing on it can be selected or moved.');
  }
  const descId = `${prefix}-desc`;
  const sumId = `${prefix}-sum`;

  /* ---- a card in the air is drawn last, and its lines follow it ---- */
  const isCarried = (key: string): boolean => air !== null && air.keys.includes(key);
  const stackCarried = (keys: readonly string[]): boolean =>
    air !== null && keys.every((k) => air.keys.includes(k));
  /* The lines to a card in the air reach the card where it is drawn -- on the
     pointer -- not the 8 px grid spot it will snap to (task 5.3). */
  const linesDrawn = air === null || (air.rx === 0 && air.ry === 0)
    ? routed.links
    : routed.links.map((l) => {
      const by = { x: air.rx, y: air.ry };
      return carryEnds(l, isCarried(l.from) ? by : null, isCarried(l.to) ? by : null);
    });
  const renderStack = (st: Geometry['stacks'][number]): JSX.Element => (
    <StackChassis
      key={st.key}
      stack={st}
      prefix={prefix}
      byKey={geo.byKey}
      interactive={interactive}
      onHeaderPointerDown={onHeaderPointerDown}
      dropTarget={hostDropTarget !== null && st.hostId === hostDropTarget}
      hint={stackCarried(st.memberKeys) ? null : hostHint(st.hostId)}
    />
  );
  const renderNode = (n: NodeBox): JSX.Element => {
    const carried = isCarried(n.key);
    const hint = carried ? null : cardHint(n.key);
    /* A blade lifted out of its stack on its own leaves the chassis behind,
       so it draws a card's own fill and border while it is in the air. */
    const lifted = carried && n.stackKey !== undefined
      && !geo.stacks.some((st) => st.key === n.stackKey && stackCarried(st.memberKeys));
    const card = (
      <NodeCard
        key={n.key}
        node={n}
        prefix={prefix}
        frame={cardFrameFor(doc, n, frame)}
        databaseRole={cardRoleFor(doc, n, frame)}
        chips={chipsFor(doc, n)}
        label={cardLabel(doc, graph, n, frame)}
        selected={isSelected(n.key)}
        instancesLive={props.onDelete !== undefined}
        selectedInstance={selectedInstanceOf(n.key)}
        hovered={hovered === n.key}
        dragging={drag.current?.kind === 'card' && drag.current.moved && n.key in drag.current.bases}
        target={rubber !== null && rubber.over === n.key
          ? (rubber.what?.enabled.state === 'off' ? 'no' : 'yes')
          : hostDropTarget !== null && hostIdOf(n.key) === hostDropTarget ? 'yes'
            : hint === 'maybe' || hint === 'no' ? hint : null}
        dim={hint === 'dim'}
        port={interactive && props.onConnect !== undefined}
        interactive={interactive}
        tabIndex={tabStops.has(n.key) ? 0 : -1}
        onSelect={onCardSelect}
        onHover={props.onHover}
        onPointerDown={onCardPointerDown}
        onPortPointerDown={onPortPointerDown}
        onKeyDown={onCardKey}
        cardRef={cardRef}
      />
    );
    return lifted ? <g key={n.key} class="tp-lifted">{card}</g> : card;
  };

  if (geo.nodes.length === 0) {
    return (
      <figure class="tp-wrap">
        <p class="tp-empty">
          Nothing to draw: this configuration has no members and no observers yet.
        </p>
      </figure>
    );
  }

  return (
    <figure
      /* `is-zoomed` releases the CSS cap that keeps the drawing inside its
         room; `is-pannable` is the grab cursor, and only where there is
         something to grab -- below 1:1 the drawing fits and dragging it would
         scroll nothing, so the cursor would be a promise the page cannot keep. */
      class={`tp-wrap${props.trueSize === true ? ' is-zoomed is-true'
        : zoomFactor === 1 && props.fitted !== true ? '' : props.fitted === true ? ' is-fitted' : ' is-zoomed'}${
        props.trueSize === true ? (props.pannable === true ? ' is-pannable' : '')
          : zoomFactor > 1 && props.fitted !== true ? ' is-pannable' : ''}`}
      ref={props.wrapRef}
    >
      <svg
        class={`topo-svg${panning ? ' is-pan' : ''}${moving === null ? '' : ` is-dragging cur-${moving}`}${
          interactive && (props.onDrag || props.onDragEnd) ? ' is-movable' : ''}`}
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        width={Math.round(view.w * zoomFactor)}
        height={Math.round(view.h * zoomFactor)}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-labelledby={sumId}
        aria-describedby={descId}
        onPointerDown={interactive ? onSvgPointerDown : undefined}
        onPointerMove={interactive ? onPointerMove : undefined}
        onPointerUp={interactive ? onSvgPointerUp : undefined}
        onPointerCancel={interactive ? endDrag : undefined}
        onPointerOver={interactive && props.tools ? onSvgPointerOver : undefined}
        onPointerLeave={interactive && props.tools ? () => setToolKey(null) : undefined}
        onWheel={interactive && props.onZoomStep ? onSvgWheel : undefined}
        onContextMenu={interactive && props.onContextMenu ? onSvgContextMenu : undefined}
        onDblClick={interactive && props.onOpen ? onSvgDblClick : undefined}
      >
        <defs>
          <pattern
            id={`${prefix}-hatch`} width="8" height="8"
            patternUnits="userSpaceOnUse" patternTransform="rotate(45)"
          >
            <rect width="8" height="8" class="hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="8" class="hatch-ln" />
          </pattern>
          <marker
            id={`${prefix}-ar-s`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"
          >
            <path d="M0,1 L10,5 L0,9 z" class="tp-ahs" />
          </marker>
          <marker
            id={`${prefix}-ar-h`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse"
          >
            <path d="M0.8,1.5 L9,5 L0.8,8.5 z" class="tp-ahh" />
          </marker>
          <marker
            id={`${prefix}-ar-r`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"
          >
            <path d="M0,1 L10,5 L0,9 z" class="tp-ahr" />
          </marker>
          <marker
            id={`${prefix}-ar-a`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"
          >
            <path d="M0,1 L10,5 L0,9 z" class="tp-aha" />
          </marker>
          <GlyphDefs prefix={prefix} />
        </defs>

        <g class="tp-sites">
          {sitesDrawn.map((s) => (
            <SiteRect
              key={s.id as string}
              site={s}
              prefix={prefix}
              down={siteIsDown(doc, s.id as string, frame)}
              selected={isSelected(siteKey(s.id as string))}
              hovered={hovered === siteKey(s.id as string)}
              drop={dropSite === (s.id as string) || props.dropHint === (s.id as string)
                || (rubber !== null && rubber.over === (s.id as string))}
              canDrop={canDropIn(s.id as string)}
              port={interactive && props.onConnect !== undefined && geo.sites.length > 1}
              onPortPointerDown={onPortPointerDown}
              label={siteLabel(doc, { id: s.id as string, name: s.name }, frame)}
              tabIndex={0}
              interactive={interactive}
              onSelect={onCardSelect}
              onHover={props.onHover}
              onKeyDown={onSiteKey}
              onPointerDown={onSitePointerDown}
              nodeRef={cardRef}
            />
          ))}
        </g>

        {/* Lines first, captions after every card: a caption is a label, and a
            label that another link's line is drawn across stops being one. */}
        <g class="tp-links">
          {linesDrawn.map((l) => (
            <LinkPath
              key={l.id}
              link={l}
              prefix={prefix}
              part="line"
              interactive={interactive}
              highlighted={hovered === linkKey(l) || isSelected(linkKey(l))}
              selected={isSelected(linkKey(l))}
              dimmed={hovered !== null && hovered !== linkKey(l)
                && hovered !== l.from && hovered !== l.to}
              onSelect={onCardSelect}
              onHover={props.onHover}
            />
          ))}
        </g>

        <g class="tp-stacks">
          {geo.stacks.filter((st) => !stackCarried(st.memberKeys)).map(renderStack)}
        </g>

        {/* Where the card will land: its outline on the 8 px grid under a card
            that follows the pointer, or its place in the stack or data centre
            the pointer is over. */}
        {ghosts.length === 0 ? null : (
          <g class="tp-ghosts" aria-hidden="true">
            {ghosts.map((r, i) => (
              <rect key={i} class="tp-ghost" x={r.x} y={r.y} width={r.w} height={r.h} rx={5} />
            ))}
          </g>
        )}

        <g class="tp-nodes">
          {geo.nodes.filter((n) => !isCarried(n.key)).map(renderNode)}
        </g>

        {/* The line being drawn from a port, while it is being drawn. */}
        {rubber === null ? null : (() => {
          const card = geo.byKey[rubber.from];
          const site = card ? undefined : geo.sites.find((st) => (st.id as string) === rubber.from);
          const from = card ?? (site ? siteLabelRect(site) : null);
          if (!from) return null;
          /* From whichever edge faces the pointer: a line that starts on the
             far side and crosses its own card reads as a line to that card. */
          const x1 = rubber.x < from.x + from.w / 2 ? from.x : from.x + from.w;
          const y1 = from.y + Math.round(from.h / 2);
          const what = rubber.what;
          const refused = what !== null && what.enabled.state === 'off';
          const tip = what === null ? null : (what.enabled.state === 'off' ? what.enabled.why : what.label);
          /* The label rides beside the pointer: what the drop would do, or
             why it will not. Kept short on the drawing -- a refusal is a
             sentence, and the toast after the drop carries the whole of it. */
          return (
            <g class="tp-rubber" aria-hidden="true">
              <line
                class={`tp-rubber-ln${rubber.over !== null ? (refused ? ' is-no' : ' is-on') : ''}`}
                x1={x1} y1={y1} x2={rubber.x} y2={rubber.y}
              />
              {tip === null ? null : <PointerTip x={rubber.x} y={rubber.y} text={tip} refused={refused} />}
            </g>
          );
        })()}

        <g class="tp-pills">
          {routed.links.map((l, i) => (
            <LinkPath
              key={l.id}
              link={l}
              prefix={prefix}
              part="pill"
              interactive={interactive}
              highlighted={hovered === linkKey(l) || isSelected(linkKey(l))}
              selected={isSelected(linkKey(l))}
              dimmed={hovered !== null && hovered !== linkKey(l)
                && hovered !== l.from && hovered !== l.to}
              label={linkLabel(doc, l)}
              tabIndex={i === linkStop ? 0 : -1}
              onSelect={onCardSelect}
              onHover={props.onHover}
              onKeyDown={onLinkKey}
              nodeRef={cardRef}
            />
          ))}
        </g>

        {toolsAt === null || toolKey === null ? null : (
          <HoverTools
            x={toolsAt.x} y={toolsAt.y} scale={k} subject={toolKey} tools={tools}
            {...(props.toolsWhen === undefined ? {} : { when: props.toolsWhen })}
          />
        )}

        {/* What is in the air, over every caption: a card carried across a
            line's caption covers it, the way the card in the hand would. */}
        {air === null ? null : (
          <g class="tp-carried" transform={`translate(${air.rx},${air.ry})`}>
            {geo.stacks.filter((st) => stackCarried(st.memberKeys)).map(renderStack)}
            {geo.nodes.filter((n) => isCarried(n.key)).map(renderNode)}
          </g>
        )}

        {/* The handles of a selected data centre: over the cards, because the
            edge they sit on is the edge of the box, not of what is inside. */}
        {!interactive || !props.onResizeSite ? null : sitesDrawn
          .filter((st) => isSelected(siteKey(st.id as string)))
          .map((st) => (
            <g key={`rsz-${st.id as string}`} class="tp-resize" data-node={st.id as string} aria-hidden="true">
              {HANDLES.map((hd) => {
                const hit = handleHit(st, hd.edges);
                const dot = handleDot(st, hd.edges);
                return (
                  <g
                    key={hd.id}
                    class={`tp-rsz cur-${hd.cursor}`}
                    onPointerDown={(ev) => onHandlePointerDown(st, hd.edges, ev)}
                  >
                    <title>Drag to resize {st.name} (also: Alt+arrow on the data centre)</title>
                    <rect class="tp-rsz-hit" x={hit.x} y={hit.y} width={hit.w} height={hit.h} />
                    <rect class="tp-rsz-dot" x={dot.x} y={dot.y} width={dot.w} height={dot.h} rx={1.5} />
                  </g>
                );
              })}
            </g>
          ))}

        {/* Over the captions: it is about the drop in hand, not the drawing. */}
        {airTip === null || air === null ? null : (
          <PointerTip x={air.x} y={air.y} text={airTip.text} refused={airTip.refused} />
        )}

        {band === null ? null : (
          <rect class="tp-band" aria-hidden="true" x={band.x} y={band.y} width={band.w} height={band.h} />
        )}

        {/* The way to the action bar for a pointer: one handle, on the corner
            of whatever is selected. It carries the subject's `data-node`, so a
            press on it is a press on the subject -- not on the ground, which
            would clear the selection, and not outside the bar, which would
            close it before this click could. */}
        {/* Not while something is being dragged: it hangs off the live
            geometry, which a drag holds still only in what it draws. */}
        {handleAt === null || !props.onContextMenu || moving !== null ? null : (
          <g
            class={`tp-more${bar !== null ? ' is-open' : ''}`}
            role="button"
            aria-label={`Actions for ${handleAt.key}`}
            aria-expanded={bar !== null}
            data-node={handleAt.key}
            data-more={handleAt.key}
            onPointerDown={(ev) => ev.stopPropagation()}
            onDblClick={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation();
              if (bar !== null) props.onCloseBar?.();
              else props.onContextMenu?.(handleAt.key);
            }}
          >
            <title>Actions (also: right-click, Shift+F10)</title>
            <circle class="tp-more-hit" cx={handleAt.x} cy={handleAt.y} r={12} />
            <circle class="tp-more-dot" cx={handleAt.x} cy={handleAt.y} r={8} />
            <circle class="tp-more-pip" cx={handleAt.x - 3.5} cy={handleAt.y} r={1.1} />
            <circle class="tp-more-pip" cx={handleAt.x} cy={handleAt.y} r={1.1} />
            <circle class="tp-more-pip" cx={handleAt.x + 3.5} cy={handleAt.y} r={1.1} />
          </g>
        )}

        {renameBox === null || !props.rename ? null : (
          <InlineName
            key={props.rename.key}
            x={renameBox.x} y={renameBox.y} w={renameBox.w}
            initial={props.rename.initial}
            verdict={props.rename.verdict}
            onCommit={props.rename.commit}
            onCancel={() => {
              const was = props.rename?.key;
              props.rename?.cancel();
              if (was !== undefined) cards.current.get(was)?.focus();
            }}
          />
        )}

        {/* Last, so it paints over everything: an action bar that a caption
            can cross is a menu with a line through it. */}
        {bar === null || barPlace === null ? null : (
          <ActionBar
            x={barPlace.x}
            y={barPlace.y}
            scale={barScale}
            subject={bar.key}
            actions={bar.actions}
            quiet={bar.quiet ?? null}
            focusOnOpen={bar.focus === true}
            {...(bar.moreWhere !== undefined ? { moreWhere: bar.moreWhere } : {})}
            {...(bar.maxRows !== undefined ? { maxRows: bar.maxRows } : {})}
            {...(bar.sections !== undefined ? { sections: bar.sections } : {})}
            {...(bar.when !== undefined ? { when: bar.when } : {})}
            {...(barCap !== null ? { maxHeight: barCap } : {})}
            {...(bar.title !== undefined ? { title: bar.title } : {})}
            {...(bar.keepLast === true ? { keepLast: true } : {})}
            {...(barSize !== null ? { box: barSize } : {})}
            onMeasure={onBarMeasure}
            onClose={closeBar}
          />
        )}
      </svg>

      <p class="sr" id={sumId}>{aria.summary}</p>
      <div class="sr" id={descId}>
        <p>{aria.sentences.join(' ')}</p>
        <table>
          <caption>Every member and observer in this configuration.</caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Member</th>
              <th scope="col">Role</th>
              <th scope="col">Host</th>
              <th scope="col">Receives redo from</th>
              <th scope="col">Transport</th>
              <th scope="col">Round trip</th>
            </tr>
          </thead>
          <tbody>
            {aria.rows.map((r) => (
              <tr key={`${r.site}/${r.member}`}>
                <td>{r.site}</td>
                <td>{r.member}</td>
                <td>{r.role}</td>
                <td>{r.host}</td>
                <td>{r.receivesFrom}</td>
                <td>{r.transport}</td>
                <td>{r.rtt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {legend.length === 0 ? null : (
        <figcaption class="tp-legend">
          {legend.map((line) => <span class="tp-legend-item" key={line}>{line}</span>)}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * The note beside the pointer during a drag: what the drop would do, or why it
 * will not. Kept short on the drawing -- a refusal is a sentence, and the
 * toast or the rail carries the whole of it.
 */
function PointerTip({ x, y, text, refused }: { x: number; y: number; text: string; refused: boolean }) {
  const shown = text.length > 64 ? `${text.slice(0, 61)}…` : text;
  const w = Math.round(approxW(shown, 10.5, true) + 14);
  return (
    <g class={`tp-rubber-tip${refused ? ' is-no' : ''}`} aria-hidden="true">
      <rect class="tp-rubber-tip-bg" x={x + 12} y={y - 22} width={w} height={18} rx={3} />
      <text class="tp-rubber-tip-tx" x={x + 19} y={y - 9}>{shown}</text>
    </g>
  );
}
