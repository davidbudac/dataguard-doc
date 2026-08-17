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
import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import type { RedoGraph, Snapshot, TopologyDoc } from '@/engine';
import type { Geometry, LayoutOffset, NodeBox } from './layout';
import { layoutTopology } from './layout';
import { cardFrameFor, chipsFor, routeTopology, siteIsDown, unionViewBox } from './routing';
import { describeTopology, cardLabel } from './aria';
import { NodeCard } from './NodeCard';
import { LinkPath, linkKey } from './LinkPath';
import { SiteRect, siteKey } from './SiteRect';
import { snap8 } from './measure';
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
   * The event menu. Passing it turns a click on a card into "select it and
   * offer what can be done to it"; `E` opens it from the keyboard. Callers
   * that have no menu (Build mode) leave it out and a click only selects.
   */
  onEventMenu?: (key: string, at: { x: number; y: number }) => void;
  onDrag?: (key: string, offset: LayoutOffset) => void;
  onDragEnd?: (key: string, offset: LayoutOffset) => void;
  onDelete?: (key: string) => void;
  onClear?: () => void;
}

interface DragState {
  key: string;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  scale: number;
  moved: boolean;
}

const DRAG_THRESHOLD = 4;

export function TopoCanvas(props: TopoCanvasProps): JSX.Element {
  const {
    doc, graph, frame = null, prefix = 'tp', interactive = true,
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
  const view = unionViewBox(geo.viewBox, routed.bounds);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const cards = useRef(new Map<string, SVGGElement>());
  const drag = useRef<DragState | null>(null);
  /* Which card in each site is the site's tab stop. It follows the arrows, so
     tabbing away from a site and back again returns to the card the reader
     left, not to the top of the column. */
  const [visited, setVisited] = useState<string | null>(null);

  const cardRef = useCallback((key: string, el: SVGGElement | null) => {
    if (el) cards.current.set(key, el);
    else cards.current.delete(key);
  }, []);

  const isSelected = (key: string): boolean => selection.includes(key);

  /* A click always selects. Where the caller has an event menu, the same click
     offers it, anchored under the card it belongs to. */
  const onCardSelect = (key: string, additive: boolean): void => {
    setVisited(key);
    props.onSelect?.(key, additive);
    if (!props.onEventMenu || additive) return;
    const box = cards.current.get(key)?.getBoundingClientRect();
    props.onEventMenu(key, box
      ? { x: box.left + box.width / 2, y: box.top + box.height }
      : { x: 0, y: 0 });
  };

  /* ---- keyboard: arrows walk one site, Tab steps between them ---- */
  const focusNode = (key: string): void => {
    setVisited(key);
    cards.current.get(key)?.focus();
  };

  const siblings = (node: NodeBox): NodeBox[] => geo.nodes
    .filter((n) => (n.site as string) === (node.site as string))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const onCardKey = (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    const node = geo.byKey[key];
    if (!node) return;
    const list = siblings(node);
    const at = list.findIndex((n) => n.key === key);
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
      case 'Enter':
      case ' ': {
        ev.preventDefault();
        onCardSelect(key, ev.shiftKey);
        return;
      }
      case 'e':
      case 'E': {
        ev.preventDefault();
        const box = cards.current.get(key)?.getBoundingClientRect();
        props.onEventMenu?.(key, box
          ? { x: box.left + box.width / 2, y: box.top + box.height }
          : { x: 0, y: 0 });
        return;
      }
      case 'Delete':
      case 'Backspace': {
        ev.preventDefault();
        props.onDelete?.(key);
        return;
      }
      case 'Escape': {
        ev.preventDefault();
        props.onClear?.();
        return;
      }
      default:
    }
  };

  /* ---- drag: pointer capture on the svg, deltas in user units ---- */
  const onCardPointerDown = (key: string, ev: JSX.TargetedPointerEvent<SVGGElement>): void => {
    if (!props.onDrag && !props.onDragEnd) return;
    if (ev.button !== 0) return;
    const svg = svgRef.current;
    const node = geo.byKey[key];
    if (!svg || !node) return;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width > 0 ? view.w / rect.width : 1;
    const base = overrides[key] ?? { dx: 0, dy: 0 };
    drag.current = {
      key,
      startX: ev.clientX,
      startY: ev.clientY,
      baseX: base.dx,
      baseY: base.dy,
      scale,
      moved: false,
    };
    svg.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = (ev.clientX - d.startX) * d.scale;
    const dy = (ev.clientY - d.startY) * d.scale;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    props.onDrag?.(d.key, { dx: snap8(d.baseX + dx), dy: snap8(d.baseY + dy) });
  };

  const endDrag = (ev: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    svgRef.current?.releasePointerCapture?.(ev.pointerId);
    if (!d.moved) return;
    const dx = (ev.clientX - d.startX) * d.scale;
    const dy = (ev.clientY - d.startY) * d.scale;
    props.onDragEnd?.(d.key, { dx: snap8(d.baseX + dx), dy: snap8(d.baseY + dy) });
  };

  /* ---- one tab stop per site: Tab steps between sites, arrows walk one ---- */
  const tabStops = new Set<string>();
  for (const site of geo.sites) {
    const own = geo.nodes
      .filter((n) => (n.site as string) === (site.id as string))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const stop = own.find((n) => n.key === visited) ?? own[0];
    if (stop) tabStops.add(stop.key);
  }

  const legend = legendLines(doc, geo, routed.links.some((l) => !l.active));
  if (!interactive) {
    legend.unshift(props.readOnlyWhy
      ?? 'This drawing is read-only here: nothing on it can be selected or moved.');
  }
  const descId = `${prefix}-desc`;
  const sumId = `${prefix}-sum`;

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
    <figure class="tp-wrap">
      <svg
        class="topo-svg"
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        width={view.w}
        height={view.h}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-labelledby={sumId}
        aria-describedby={descId}
        onPointerMove={interactive ? onPointerMove : undefined}
        onPointerUp={interactive ? endDrag : undefined}
        onPointerCancel={interactive ? endDrag : undefined}
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
          <g id={`${prefix}-ico-db`} fill="none" stroke-width="1.8" stroke-linecap="round">
            <ellipse cx="12" cy="6" rx="8" ry="3.2" />
            <path d="M4,6 V18 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2 V6" />
            <path d="M4,12 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2" />
          </g>
          <g id={`${prefix}-ico-farsync`} fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="10" cy="6" rx="7" ry="2.8" />
            <path d="M3,6 V15" />
            <path d="M17,6 V15" />
            <path d="M14,11 L19,15.5 L14,20" />
          </g>
          <g id={`${prefix}-ico-snapshot`} fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <ellipse cx="12" cy="6" rx="8" ry="3.2" />
            <path d="M4,6 V18 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2 V6" />
            <path d="M7.5,13.5 L10.8,16.8 L16.5,11" />
          </g>
          <g id={`${prefix}-ico-observer`} fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5,12 C5.5,6.8 8.6,4.6 12,4.6 s6.5,2.2 9.5,7.4 C18.5,17.2 15.4,19.4 12,19.4 s-6.5,-2.2 -9.5,-7.4 Z" />
            <circle cx="12" cy="12" r="3.1" />
          </g>
        </defs>

        <g class="tp-sites">
          {geo.sites.map((s) => (
            <SiteRect
              key={s.id as string}
              site={s}
              prefix={prefix}
              down={siteIsDown(doc, s.id as string, frame)}
              selected={isSelected(siteKey(s.id as string))}
              interactive={interactive}
              onSelect={props.onSelect}
            />
          ))}
        </g>

        {/* Lines first, captions after every card: a caption is a label, and a
            label that another link's line is drawn across stops being one. */}
        <g class="tp-links">
          {routed.links.map((l) => (
            <LinkPath
              key={l.id}
              link={l}
              prefix={prefix}
              part="line"
              interactive={interactive}
              highlighted={hovered === linkKey(l) || isSelected(linkKey(l))}
              dimmed={hovered !== null && hovered !== linkKey(l)
                && hovered !== l.from && hovered !== l.to}
              onSelect={props.onSelect}
              onHover={props.onHover}
            />
          ))}
        </g>

        <g class="tp-nodes">
          {geo.nodes.map((n) => (
            <NodeCard
              key={n.key}
              node={n}
              prefix={prefix}
              frame={cardFrameFor(doc, n, frame)}
              chips={chipsFor(doc, n)}
              label={cardLabel(doc, graph, n, frame)}
              selected={isSelected(n.key)}
              hovered={hovered === n.key}
              dragging={drag.current?.key === n.key}
              interactive={interactive}
              tabIndex={tabStops.has(n.key) ? 0 : -1}
              onSelect={onCardSelect}
              onHover={props.onHover}
              onPointerDown={onCardPointerDown}
              onKeyDown={onCardKey}
              cardRef={cardRef}
            />
          ))}
        </g>

        <g class="tp-pills">
          {routed.links.map((l) => (
            <LinkPath
              key={l.id}
              link={l}
              prefix={prefix}
              part="pill"
              interactive={interactive}
              highlighted={hovered === linkKey(l) || isSelected(linkKey(l))}
              dimmed={hovered !== null && hovered !== linkKey(l)
                && hovered !== l.from && hovered !== l.to}
              onSelect={props.onSelect}
              onHover={props.onHover}
            />
          ))}
        </g>
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

/** Said once, under the drawing: what an absent chip and a faded line mean. */
export function legendLines(
  doc: TopologyDoc, geo: Geometry, anyInactive: boolean,
): string[] {
  const out: string[] = [];
  if (doc.members.some((m) => m.instances.length > 1)) {
    out.push('A card with no RAC chip is a single-instance database.');
  }
  if (doc.observers.length > 0 && doc.config.fsfo.state === 'disabled') {
    out.push('Fast-start failover is disabled, so no observer is called the master observer; all observers have the same functionality.');
  }
  if (geo.nodes.some((n) => n.unreachable)) {
    out.push('A dashed card is a member no active redo route reaches from the primary.');
  }
  if (anyInactive) {
    out.push('A faded line is a destination this configuration declares but is not shipping to now.');
  }
  return out;
}
