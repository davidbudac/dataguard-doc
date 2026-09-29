/* PROTOTYPE — Break layout variant A (throwaway, see branch prototype/break-layout-a) */

/**
 * Variant A: the topology canvas and the timeline are one view.
 *
 * A column of compact node cards on the left, grouped under their data centre;
 * each card's row continues to the right as that member's timeline lane. The
 * application's lanes sit under the members. Everything the drawing knows is
 * reused: `buildTimeline` decides the bands, the markers and the scale, the
 * playhead, the event drag and the transport are the timeline's own, the card
 * frames and the link states are the canvas's own. This file only lays them
 * out on one set of rows.
 *
 * The model's lane `y` values are not used: the rows are re-stacked here (data
 * centre headers between them), and the markers that hang off a lane are moved
 * by however far their lane moved.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { errors, frame, geometry, issues, readout, redoGraph, topology, trace, warnings } from '@/state/derived';
import { appLanesShown, clearSelection, playing, select, selection, speed, tNow } from '@/state/view';
import { buildTimeline, fmt, TL } from '../timeline/build';
import type { TimelineLane, TimelineMarker, TimelineModel } from '../timeline/build';
import { Defs, Lane, Marker } from '../timeline/Timeline';
import { Playhead } from '../timeline/Playhead';
import { EventDrag } from '../timeline/EventDrag';
import { Transport } from '../timeline/Transport';
import { usePlayback } from '../timeline/playback';
import { Tooltip, tipFromEvent } from '../timeline/Tooltip';
import type { TooltipState } from '../timeline/Tooltip';
import { useHostWindow } from '../common/dom';
import { setEventTime } from './events';
import { buildLinks, cardFrameFor, cardRoleFor, chipsFor, NEUTRAL_FRAME, siteIsDown } from '../canvas/routing';
import type { CanvasLink } from '../canvas/routing';
import type { NodeBox } from '../canvas/layout';
import { approxW, elide } from '../canvas/measure';
import '@/styles/proto-a.css';

/* ---------------- geometry ---------------- */

const CW = 186; // a card's width
const RH = TL.laneH; // a row's height, so the model's marker offsets still hold
const GAP = 12; // between two rows of one data centre: room for a link pill
const HDR = 18; // a data centre's header band
const TOP = 88; // where the first header starts: ticks and the event chips are above
const LABEL_EXTRA = 16; // room above a row for a marker's sentence
const ZONE_LABEL_Y = 78; // the event labels' baseline (the model has 108)
const RAIL_STEP = 9;
const MAX_RAIL = 5;

interface Row {
  key: string; // the model lane key, or `node:<id>` where there is no lane
  id: string;
  node: NodeBox | null;
  lane: TimelineLane | null;
  y: number;
  kind: 'member' | 'observer' | 'application';
}

interface Layout {
  rows: Row[];
  headers: { site: string; name: string; y: number; down: boolean }[];
  appRow: Row | null;
  appLanes: { lane: TimelineLane; y: number }[];
  appHeadY: number | null;
  bottom: number;
}

/* ---------------- small hooks ---------------- */

function useMeasure(): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(900);
  const ro = useRef<ResizeObserver | null>(null);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [(el) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    setWidth(el.clientWidth);
    const o = new ResizeObserver(() => setWidth(el.clientWidth));
    o.observe(el);
    ro.current = o;
  }, width];
}

function Dropdown({ label, tone, title, children }: {
  label: JSX.Element | string; tone?: string; title?: string; children: JSX.Element | JSX.Element[] | null;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent): void => {
      if (host.current && e.target instanceof Node && !host.current.contains(e.target)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div class="pa-dd" ref={host}>
      <button
        type="button" class={`pa-dd-b${tone ? ` t-${tone}` : ''}`} aria-expanded={open} title={title}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open ? <div class="pa-dd-pop">{children}</div> : null}
    </div>
  );
}

/* ---------------- the card ---------------- */

const PHASE_CLASS: Record<string, string> = {
  neutral: '', serving: 'is-tl', applying: 'is-bl', waiting: 'is-am', observer: 'is-vi', idle: 'is-sl',
};

function letterFor(node: NodeBox | null, role: string | null): string {
  if (node?.kind === 'observer') return 'O';
  if (node?.kind === 'application') return 'A';
  if (role === 'primary') return 'P';
  if (role === 'former-primary') return 'F';
  if (role === 'standby') return 'S';
  return node?.glyph === 'farsync' ? 'FS' : '·';
}

function Card({ x, y, row, t, selected, dim, hot, onPick, onHover }: {
  x: number; y: number; row: Row; t: number; selected: boolean; dim: boolean; hot: boolean;
  onPick: (id: string, additive: boolean) => void;
  onHover: (id: string | null) => void;
}) {
  const doc = topology.value;
  const snap = frame.value;
  const node = row.node;
  const fr = node ? cardFrameFor(doc, node, snap) : NEUTRAL_FRAME;
  const role = node ? cardRoleFor(doc, node, snap) : null;
  const chip = node ? chipsFor(doc, node)[0] : undefined;
  const seg = row.lane
    ? row.lane.segments.find((s) => t >= s.t0 - 1e-9 && t <= s.t1 + 1e-9) ?? null
    : null;
  let roleText = node?.lines.sub ?? node?.lines.host ?? '';
  if (role === 'primary') roleText = 'Primary';
  else if (role === 'former-primary') roleText = 'Former primary';
  else if (role === 'standby' && roleText === 'Primary') roleText = 'Standby';
  if (row.kind === 'application') {
    roleText = fr.down ? 'down' : fr.stalled ? 'no service reachable' : fr.phase === 'serving' ? 'service reachable' : 'Application';
  }
  const state = seg?.labels[seg.labels.length - 1] ?? '';
  const sub = elide(state === '' ? roleText : `${roleText} · ${state}`, chip ? 22 : 27);
  const h = RH;
  const cls = ['pa-card', fr.down ? 'is-down' : PHASE_CLASS[fr.phase] ?? '',
    fr.stalled && !fr.down ? 'is-stalled' : '', fr.unreachable ? 'is-unreached' : '',
    fr.degraded ? 'is-degraded' : '', selected ? 'is-sel' : '', hot ? 'is-hot' : ''].filter(Boolean).join(' ');
  const bdg = `pa-bdg${role ? ` is-${role}` : ''}${row.kind === 'observer' ? ' is-obs' : ''}${fr.down ? ' is-down' : ''}`;
  const name = node?.lines.name ?? row.id;
  return (
    <g
      class={`pa-node${dim ? ' is-dim' : ''}`}
      data-node={row.id}
      role="button"
      tabindex={0}
      aria-pressed={selected}
      aria-label={`${name}, ${roleText}${state ? `, ${state}` : ''}`}
      onClick={(e) => onPick(row.id, e.shiftKey || e.metaKey || e.ctrlKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(row.id, e.shiftKey); }
      }}
      onPointerEnter={() => onHover(row.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(row.id)}
      onBlur={() => onHover(null)}
    >
      <title>{node?.hostFull ? `${name} — ${node.hostFull}` : name}</title>
      {fr.down ? <rect class="pa-hatch" x={x} y={y} width={CW} height={h} rx={5} fill="url(#tlHatch)" /> : null}
      <rect class={cls} x={x} y={y} width={CW} height={h} rx={5} />
      <rect class={bdg} x={x + 8} y={y + (h - 22) / 2} width={22} height={22} rx={6} />
      <text class="pa-bdg-t" x={x + 19} y={y + h / 2 + 4} text-anchor="middle">{letterFor(node, role)}</text>
      <text class="pa-name" x={x + 38} y={y + 16}>{elide(name, 14)}</text>
      <text class="pa-sub" x={x + 38} y={y + 29}>{sub}</text>
      {chip ? (
        <g class={`pa-chip is-${chip.tone}`}>
          <title>{chip.title}</title>
          <text x={x + CW - 8 - (fr.crashed ? 18 : 0)} y={y + 15} text-anchor="end">{chip.text}</text>
        </g>
      ) : null}
      {fr.crashed ? (
        <g class="pa-x" aria-hidden="true">
          <line x1={x + CW - 22} y1={y + 6} x2={x + CW - 10} y2={y + 18} />
          <line x1={x + CW - 10} y1={y + 6} x2={x + CW - 22} y2={y + 18} />
        </g>
      ) : null}
    </g>
  );
}

/* ---------------- the links, as connectors in the card column ---------------- */

interface Placed {
  link: CanvasLink;
  lane: number;
  ra: number;
  rb: number;
}

function pillText(l: CanvasLink): string {
  const word = l.kind === 'redo' ? (l.xpt ?? 'redo') : l.kind === 'check' ? 'check' : l.caption;
  const mark = l.cut || l.down ? ' ✕' : l.active && l.up ? ' ✓' : '';
  return `${word}${mark}`;
}

function assignLanes(links: CanvasLink[], index: Map<string, number>, lanes: number): Placed[] {
  const spans = links.flatMap((link) => {
    const a = index.get(link.from);
    const b = index.get(link.to);
    if (a === undefined || b === undefined || a === b) return [];
    return [{ link, ra: Math.min(a, b), rb: Math.max(a, b) }];
  }).sort((p, q) => p.ra - q.ra || (q.rb - q.ra) - (p.rb - p.ra));
  const taken: { ra: number; rb: number }[][] = Array.from({ length: lanes }, () => []);
  return spans.map((s) => {
    let lane = taken.findIndex((ivs) => ivs.every((iv) => s.rb < iv.ra || s.ra > iv.rb));
    if (lane < 0) lane = lanes - 1;
    taken[lane]?.push({ ra: s.ra, rb: s.rb });
    return { ...s, lane };
  });
}

function Links({ placed, rows, cardX, related, hoverId }: {
  placed: Placed[]; rows: Row[]; cardX: number; related: Set<string> | null; hoverId: string | null;
}) {
  const cy = (i: number): number => (rows[i]?.y ?? 0) + RH / 2;
  /* One gap holds one pill row; several pills in a gap stack leftwards from the card's right edge. */
  const used = new Map<number, number>();
  const pills = placed.map((p) => {
    const mid = (cy(p.ra) + cy(p.rb)) / 2;
    let gap = p.ra;
    let best = Infinity;
    for (let k = p.ra; k < p.rb; k++) {
      const gy = ((rows[k]?.y ?? 0) + RH + (rows[k + 1]?.y ?? 0)) / 2;
      if (Math.abs(gy - mid) < best) { best = Math.abs(gy - mid); gap = k; }
    }
    const text = pillText(p.link);
    const w = Math.round(approxW(text, 9) + 10);
    const right = cardX + CW - (used.get(gap) ?? 0);
    used.set(gap, (used.get(gap) ?? 0) + w + 3);
    const gy = ((rows[gap]?.y ?? 0) + RH + (rows[gap + 1]?.y ?? 0)) / 2;
    return { p, text, w, x: right - w, y: gy, show: right - w > cardX + 34 };
  });
  return (
    <g class="pa-links">
      {placed.map((p) => {
        const x = 8 + p.lane * RAIL_STEP;
        const involved = hoverId !== null && (p.link.from === hoverId || p.link.to === hoverId);
        const faint = related !== null && !involved;
        const st = p.link.cut || p.link.down ? 'is-down' : p.link.active && p.link.up ? 'is-up' : 'is-off';
        return (
          <g key={p.link.id} class={`pa-lk ${st}${involved ? ' is-hot' : ''}${faint ? ' is-faint' : ''}`} data-tip={p.link.title}>
            <line x1={x} y1={cy(p.ra)} x2={x} y2={cy(p.rb)} />
            <line x1={x} y1={cy(p.ra)} x2={cardX} y2={cy(p.ra)} />
            <line x1={x} y1={cy(p.rb)} x2={cardX} y2={cy(p.rb)} />
            <circle cx={x} cy={cy(p.ra)} r={2.2} />
            <circle cx={x} cy={cy(p.rb)} r={2.2} />
          </g>
        );
      })}
      {pills.filter((q) => q.show).map(({ p, text, w, x, y }) => {
        const involved = hoverId !== null && (p.link.from === hoverId || p.link.to === hoverId);
        const faint = related !== null && !involved;
        const st = p.link.cut || p.link.down ? 'is-down' : p.link.active && p.link.up ? 'is-up' : 'is-off';
        return (
          <g key={p.link.id} class={`pa-pill ${st}${involved ? ' is-hot' : ''}${faint ? ' is-faint' : ''}`} data-tip={p.link.title}>
            <rect x={x} y={y - 6} width={w} height={12} rx={6} />
            <text x={x + w / 2} y={y + 3} text-anchor="middle">{text}</text>
          </g>
        );
      })}
    </g>
  );
}

/* ---------------- the view ---------------- */

const REL_TONE: Record<string, string> = { error: 'rd', warning: 'am' };

export function ProtoFusedView() {
  const [ref, measured] = useMeasure();
  const width = Math.max(measured, 720);
  const doc = topology.value;
  const geo = geometry.value;
  const graph = redoGraph.value;
  const snap = frame.value;
  const tr = trace.value;
  const t = tNow.value;
  const sel = selection.value;
  const isPlaying = playing.value;
  const view = useHostWindow();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);

  /* ---- the links: their structure fixes the width of the connector rail ---- */
  const structure = useMemo(
    () => (geo && graph ? buildLinks(doc, graph, geo, null) : []),
    [doc, geo, graph],
  );
  const railLanes = Math.max(1, Math.min(MAX_RAIL, structure.length === 0 ? 1 : Math.ceil(structure.length / 2)));
  const cardX = 10 + railLanes * RAIL_STEP + 4;
  const plotL = cardX + CW + 10;

  const app = appLanesShown.value;
  const model = useMemo(
    () => (tr ? buildTimeline(tr, doc, { width, selection: null, app, links: 'never', gutter: plotL }) : null),
    [tr, doc, width, app, plotL],
  );

  /* ---- rows: data centres in topology order, members in lane order ---- */
  const layout = useMemo<Layout>(() => {
    const empty: Layout = { rows: [], headers: [], appRow: null, appLanes: [], appHeadY: null, bottom: TOP };
    if (!geo) return empty;
    const laneOf = (id: string): TimelineLane | null =>
      model?.lanes.find((l) => l.kind !== 'application' && l.kind !== 'link' && l.id === id) ?? null;
    const order = (l: TimelineLane | null, n: NodeBox): number =>
      l && model ? model.lanes.indexOf(l) : 1000 + n.row * 10 + n.col;
    const nodes = geo.nodes.filter((n) => n.kind !== 'application');
    const sites = (geo.columns.length > 0 ? geo.columns.map((c) => c.site as string) : doc.sites.map((s) => s.id as string));
    const groups = sites.map((site) => ({
      site,
      rows: nodes.filter((n) => (n.site as string) === site)
        .map((n) => ({ n, l: laneOf(n.id) }))
        .sort((a, b) => order(a.l, a.n) - order(b.l, b.n))
        .map<Row>(({ n, l }) => ({
          key: l?.key ?? `node:${n.id}`, id: n.id, node: n, lane: l, y: 0,
          kind: n.kind === 'observer' ? 'observer' : 'member',
        })),
    })).filter((g) => g.rows.length > 0);
    const flat = groups.flatMap((g) => g.rows);

    /* A marker's sentence sits in the gap above its lane (below, for the abort). */
    const above = new Set<string>();
    for (const m of model?.markers ?? []) {
      if (m.kind === 'event' || m.laneKey === null) continue;
      if (m.kind === 'abort') {
        const i = flat.findIndex((r) => r.key === m.laneKey);
        const next = flat[i + 1];
        if (i >= 0 && next) above.add(next.key);
      } else above.add(m.laneKey);
    }

    let y = TOP;
    const headers: Layout['headers'] = [];
    groups.forEach((g, gi) => {
      if (gi > 0) y += 6;
      const s = doc.sites.find((x) => (x.id as string) === g.site);
      headers.push({ site: g.site, name: s?.name ?? g.site, y, down: siteIsDown(doc, g.site, snap) });
      y += HDR;
      g.rows.forEach((r, i) => {
        y += i === 0 ? 2 : GAP + (above.has(r.key) ? LABEL_EXTRA : 0);
        r.y = y;
        y += RH;
      });
    });

    let appRow: Row | null = null;
    let appHeadY: number | null = null;
    const appLanes: Layout['appLanes'] = [];
    const appNode = geo.nodes.find((n) => n.kind === 'application') ?? null;
    if (appNode) {
      y += 12;
      appHeadY = y;
      appRow = { key: `node:${appNode.id}`, id: appNode.id, node: appNode, lane: null, y, kind: 'application' };
      y += RH;
      for (const lane of model?.lanes.filter((l) => l.kind === 'application') ?? []) {
        y += GAP + (above.has(lane.key) ? LABEL_EXTRA : 0);
        appLanes.push({ lane, y });
        y += RH;
      }
    }
    return { rows: flat, headers, appRow, appLanes, appHeadY, bottom: y + 8 };
  }, [geo, doc, model, snap]);

  const { rows, headers, appRow, appLanes, bottom } = layout;
  const allRows = appRow ? [...rows, appRow] : rows;

  /* ---- markers, moved with their rows ---- */
  const shifted = useMemo<TimelineMarker[]>(() => {
    if (!model) return [];
    const yOf = new Map<string, number>();
    for (const r of rows) yOf.set(r.key, r.y);
    for (const a of appLanes) yOf.set(a.lane.key, a.y);
    const laneY = new Map(model.lanes.map((l) => [l.key, l.y]));
    const primary = rows.find((r) => r.lane?.group === 'primary') ?? rows[0];
    return model.markers.map((m) => {
      if (m.kind === 'event') {
        const partition = m.glyph === 'partition';
        const py = primary?.y ?? TOP;
        return {
          ...m,
          labelY: ZONE_LABEL_Y,
          y0: partition ? TOP : py - 4,
          y1: partition ? bottom : py + RH + 4,
        };
      }
      const mine = m.laneKey === null ? undefined : yOf.get(m.laneKey);
      const theirs = m.laneKey === null ? undefined : laneY.get(m.laneKey);
      if (mine === undefined || theirs === undefined) return m;
      const d = mine - theirs;
      return { ...m, y0: m.y0 + d, y1: m.y1 + d, labelY: m.labelY + d };
    });
  }, [model, rows, appLanes, bottom]);

  const shiftedModel = useMemo<TimelineModel | null>(
    () => (model ? { ...model, markers: shifted, laneTop: 28, lanesBottom: bottom, axisY: bottom } : null),
    [model, shifted, bottom],
  );

  /* ---- playback, and seeking by pressing on the plot ---- */
  usePlayback({
    view, playing: isPlaying, speed: speed.value, tNow: t,
    t0: model?.scale.t0 ?? 0, t1: model?.scale.t1 ?? 0,
    enabled: model !== null && !model.empty,
    onSeek: (v) => { tNow.value = v; },
    onEnd: () => { playing.value = !playing.value; },
  });
  const seek = useRef<{ pointer: number } | null>(null);
  const seeked = useRef(false);
  const tAt = (e: JSX.TargetedPointerEvent<SVGSVGElement>, strict: boolean): number | null => {
    if (!model) return null;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return null;
    const x = (e.clientX - box.left) * (model.width / box.width);
    if (strict && (x < model.scale.plotL - 4 || x > model.scale.plotR + 4)) return null;
    return Math.round(model.scale.clampT(model.scale.tAt(x)) * 10) / 10;
  };
  const onDown = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    seeked.current = false;
    if (e.button !== 0) return;
    const v = tAt(e, true);
    if (v === null) return;
    e.preventDefault();
    if (isPlaying) playing.value = false;
    seek.current = { pointer: e.pointerId };
    seeked.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    tNow.value = v;
  };
  const onMove = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (seek.current?.pointer !== e.pointerId) return;
    const v = tAt(e, false);
    if (v !== null) tNow.value = v;
  };
  const onUp = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (seek.current?.pointer !== e.pointerId) return;
    seek.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const selectLane = (id: string | null): void => {
    if (seeked.current) { seeked.current = false; return; }
    if (id === null) clearSelection(); else select(id);
  };
  const onPick = (id: string, additive: boolean): void => { select(id, additive); };

  /* ---- the links at this instant ---- */
  const rowIndex = useMemo(() => new Map(allRows.map((r, i) => [r.id, i])), [allRows]);
  const links = useMemo(
    () => (geo && graph ? buildLinks(doc, graph, geo, snap) : []),
    [doc, geo, graph, snap],
  );
  const placed = useMemo(() => assignLanes(links, rowIndex, railLanes), [links, rowIndex, railLanes]);
  const related = useMemo<Set<string> | null>(() => {
    if (hoverId === null) return null;
    const s = new Set<string>([hoverId]);
    for (const l of links) {
      if (l.from === hoverId) s.add(l.to);
      if (l.to === hoverId) s.add(l.from);
    }
    return s;
  }, [hoverId, links]);

  const onPlotMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const text = tipFromEvent(e.target);
    if (text === null) { if (tip !== null) setTip(null); return; }
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  /* ---- the compact bar ---- */
  const chips = readout.value.filter((c) => ['outcome', 'app', 'observer'].includes(c.id));
  const loud = [...errors.value, ...warnings.value];
  const notes = issues.value.length - loud.length;

  const plotR = model?.scale.plotR ?? width - TL.padR;
  const dim = (id: string): boolean => related !== null && !related.has(id);
  const laneSelected = (id: string): boolean => sel.includes(id);

  return (
    <section class="pa-view float-card" aria-label="Break: topology and timeline">
      <header class="pa-bar">
        {shiftedModel && !shiftedModel.empty ? (
          <Transport
            model={shiftedModel}
            tNow={t}
            playing={isPlaying}
            speed={speed.value}
            onSeek={(v) => { tNow.value = v; }}
            onPlayToggle={() => { playing.value = !playing.value; }}
            onSpeed={(s) => { speed.value = s; }}
          />
        ) : (
          <span class="pa-note">No events yet. Pick a scenario in the rail, or select a card and inject an event.</span>
        )}
        <span class="pa-spacer" />
        {tr ? (
          <div class="pa-ro" role="group" aria-label="Run">
            {chips.map((c, i) => (
              <span key={c.id} class={`pa-ro-c t-${c.tone}`} title={c.sub}>
                {i > 0 ? <span class="pa-dot" aria-hidden="true">·</span> : null}
                <i>{c.k}</i> <b>{c.v}{c.unit ? ` ${c.unit}` : ''}</b>
              </span>
            ))}
          </div>
        ) : null}
        {loud.length > 0 ? (
          <Dropdown
            tone={errors.value.length > 0 ? 'rd' : 'am'}
            title="Validation findings"
            label={<>⚠ {loud.length}</>}
          >
            {[
              ...loud.map((f) => (
                <p key={`${f.id}:${f.subject.id ?? ''}`} class={`pa-find t-${REL_TONE[f.severity] ?? 'sl'}`}>
                  <b>{f.severity}</b> {f.message}
                </p>
              )),
              ...(notes > 0 ? [<p key="notes" class="pa-find t-sl">{notes} more note{notes === 1 ? '' : 's'}</p>] : []),
            ]}
          </Dropdown>
        ) : null}
        {model ? (
          <Dropdown label="Key" title="What the colours mean">
            {model.legend.map((l) => <p key={l.swatch} class="pa-key"><i class={l.swatch} />{l.label}</p>)}
          </Dropdown>
        ) : null}
        {doc.application !== undefined ? (
          <button
            type="button" class="pa-tog" aria-pressed={app}
            title="The application's lanes under the members"
            onClick={() => { appLanesShown.value = !app; }}
          >
            App view
          </button>
        ) : null}
      </header>

      <div class="pa-body" ref={ref}>
        {geo === null ? (
          <p class="pa-note pa-pad">Nothing to draw: the configuration has no valid redo graph.</p>
        ) : (
          <div class="tl-plot pa-plot" onPointerMove={onPlotMove} onPointerLeave={() => setTip(null)}>
            <svg
              class={`tl-svg pa-svg${model ? ' is-seekable' : ''}`}
              width={width}
              height={bottom}
              viewBox={`0 0 ${width} ${bottom}`}
              role="group"
              aria-label="Members and their timelines"
              onPointerDown={model ? onDown : undefined}
              onPointerMove={model ? onMove : undefined}
              onPointerUp={model ? onUp : undefined}
              onPointerCancel={model ? onUp : undefined}
            >
              <Defs />

              {model ? (
                <>
                  {model.preZone.w > 0 ? (
                    <rect class="prezone" x={model.preZone.x} y={TOP} width={model.preZone.w} height={bottom - TOP} />
                  ) : null}
                  {model.ticks.map((tk) => (
                    <line key={`g${tk.t}`} class="gridline" x1={tk.x} y1={20} x2={tk.x} y2={bottom} />
                  ))}
                  {model.ticks.map((tk) => (
                    <text key={`t${tk.t}`} class="t-tick t-mono" x={tk.x} y={13} text-anchor="middle">{tk.label}</text>
                  ))}
                  <text class="t-tick" x={cardX + CW} y={13} text-anchor="end">seconds</text>
                  {model.preZone.label ? (
                    <text class="t-tick" x={model.scale.plotL + 6} y={TOP + 12}>{model.preZone.label}</text>
                  ) : null}
                </>
              ) : (
                <text class="pa-empty-t" x={plotL + 24} y={TOP + 40}>
                  Steady state. Nothing has been injected, so there are no lanes yet.
                </text>
              )}

              {headers.map((h) => (
                <g key={h.site} class={`pa-dc${h.down ? ' is-down' : ''}`}>
                  <rect x={cardX} y={h.y} width={CW} height={HDR - 2} rx={4} />
                  <text x={cardX + 8} y={h.y + 11}>{h.name}{h.down ? ' — down' : ''}</text>
                  <line x1={cardX + CW + 6} y1={h.y + 8} x2={plotR} y2={h.y + 8} />
                </g>
              ))}

              {rows.map((r) => (
                <g key={r.key} class={`pa-row${dim(r.id) ? ' is-dim' : ''}${related?.has(r.id) && r.id !== hoverId ? ' is-rel' : ''}`}>
                  {r.lane ? (
                    <Lane
                      lane={{ ...r.lane, y: r.y }}
                      model={model as TimelineModel}
                      selected={laneSelected(r.id)}
                      onSelect={selectLane}
                    />
                  ) : null}
                </g>
              ))}

              {appRow ? (
                <g class={`pa-row pa-approw${dim(appRow.id) ? ' is-dim' : ''}`}>
                  {model?.appSection ? (
                    <g class="tl-app-head" data-tip={model.appSection.basis}>
                      <text class="t-top" x={plotL + 6} y={appRow.y + 23}>
                        {model.appSection.title}
                        <tspan
                          class={model.appSection.tone === 'ink' ? 't-app-note' : `t-app-note ${model.appSection.tone}`}
                          dx="8"
                        >
                          {model.appSection.note}
                        </tspan>
                      </text>
                      <text class="t-tick" x={plotR} y={appRow.y + 23} text-anchor="end">this page&rsquo;s model</text>
                    </g>
                  ) : null}
                </g>
              ) : null}
              {appLanes.map(({ lane, y }) => (
                <g key={lane.key} class={`pa-row${dim(lane.id) ? ' is-dim' : ''}`}>
                  <Lane lane={{ ...lane, y }} model={model as TimelineModel} selected={laneSelected(lane.id)} onSelect={selectLane} />
                  <text class="pa-alab" x={cardX + CW - 8} y={y + 17} text-anchor="end">{lane.name}</text>
                  <text class="pa-asub" x={cardX + CW - 8} y={y + 30} text-anchor="end">{elide(lane.sub, 30)}</text>
                </g>
              ))}

              <Links placed={placed} rows={allRows} cardX={cardX} related={related} hoverId={hoverId} />

              {allRows.map((r) => (
                <Card
                  key={`c${r.key}`}
                  x={cardX} y={r.y} row={r} t={t}
                  selected={sel.includes(r.id)}
                  dim={dim(r.id)}
                  hot={related?.has(r.id) === true}
                  onPick={onPick}
                  onHover={setHoverId}
                />
              ))}

              {shiftedModel ? (
                <>
                  {shifted.filter((m) => m.kind !== 'event').map((m) => <Marker key={m.key} marker={m} />)}
                  <Playhead
                    model={shiftedModel}
                    tNow={t}
                    playing={isPlaying}
                    onSeek={(v) => { tNow.value = v; }}
                    onTogglePlay={() => { playing.value = !playing.value; }}
                  />
                  {/* Above the playhead, so grabbing an event cannot seek instead. */}
                  {shifted.filter((m) => m.kind === 'event').map((m) => (
                    <EventDrag
                      key={m.key} marker={m} model={shiftedModel} doc={doc} onMove={setEventTime}
                      onStart={() => { setTip(null); if (isPlaying) playing.value = false; }}
                    >
                      <Marker marker={m} />
                    </EventDrag>
                  ))}
                </>
              ) : null}
            </svg>
            <Tooltip tip={tip} />
          </div>
        )}
      </div>
      <span class="sr">t = {fmt(t)} s</span>
    </section>
  );
}
