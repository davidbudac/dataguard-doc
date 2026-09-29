/**
 * The Lanes layout: the topology canvas and the timeline are one view.
 *
 * A column of compact node cards on the left, grouped under their data centre;
 * each card's row continues to the right as that member's timeline lane. The
 * application's lanes sit under the members. Everything the drawing knows is
 * reused: `buildTimeline` decides the bands, the markers, the braces and the
 * scale, the playhead, the event drag and the transport are the timeline's
 * own, the card frames and the link states are the canvas's own. This file
 * lays them out on one set of rows.
 *
 * It is also where a reader *starts* a run. Each card carries its event buttons
 * (`lanes-events.tsx`), aimed at the playhead and changing with it, so the
 * empty view is not an instruction to go and find a menu: it is the cards, and
 * the buttons on them.
 *
 * The model's lane `y` values are not used: the rows are re-stacked here (data
 * centre headers between them), and the markers and braces that hang off a lane
 * or under the axis are moved by however far theirs moved.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { CanvasTool } from '../canvas/HoverTools';
import { frame, geometry, redoGraph, topology, trace } from '@/state/derived';
import {
  appLanesShown, clearSelection, playing, select, selection, speed, tNow,
} from '@/state/view';
import type { Trace, TopologyDoc } from '@/engine';
import { buildTimeline, fmt, TL_FULL } from '../timeline/build';
import type { TimelineLane, TimelineMarker, TimelineModel } from '../timeline/build';
import { Defs, Lane, Marker } from '../timeline/Timeline';
import { Brace, TopBrace } from '../timeline/Brace';
import { Playhead } from '../timeline/Playhead';
import { EventDrag } from '../timeline/EventDrag';
import { Transport } from '../timeline/Transport';
import { usePlayback } from '../timeline/playback';
import { useRunTimeline } from '../timeline/run';
import type { RunTimeline } from '../timeline/run';
import { Tooltip, tipFromEvent } from '../timeline/Tooltip';
import type { TooltipState } from '../timeline/Tooltip';
import { useHostWindow } from '../common/dom';
import { useWidth } from '../common/use-width';
import { hoverTools, setEventTime } from './events';
import { buildLinks, cardFrameFor, cardRoleFor, chipsFor, NEUTRAL_FRAME, siteIsDown } from '../canvas/routing';
import type { CanvasLink } from '../canvas/routing';
import type { NodeBox } from '../canvas/layout';
import { approxW, elide } from '../canvas/measure';
import { snapT } from '../canvas/EventMenu';
import { FindingsMenu, KeyMenu, TerseReadout, TIGHT_W } from './SplitBar';
import { EventStrip, EV, MoreMenu, stripWidth } from './lanes-events';
import type { MenuTarget } from './lanes-events';
import { assignLanes, planPills, siteOrder } from './lanes-layout';
import type { Placed, PillPlan } from './lanes-layout';

/* ---------------- geometry ---------------- */

const CW = 232; // a card's width: room for the name, the state and the event buttons
const RH = TL_FULL.laneH; // a row's height, so the model's marker offsets still hold
const GAP = 14; // between two rows of one data centre: room for a row of link pills
const HDR = 22; // a data centre's header band
const DC_GAP = 16; // between one data centre's last row and the next header: a pill row too
const TOP_RUN = 118; // where the first header starts under a run: caption, brace, chips, sentences above
const TOP_EMPTY = 66; // and with no run: only the "events at t" caption above
const LABEL_EXTRA = 16; // room above a row for a marker's sentence
const AXIS_GAP = 24; // from the last lane to the axis the braces hang under
const RAIL_STEP = 9;
const MAX_RAIL = 5;
const PILL_PAD = 6; // from the card's left edge to the first pill
const PILL_H = 12;

interface Row {
  key: string; // the model lane key, or `node:<id>` where there is no lane
  id: string;
  site: string;
  node: NodeBox | null;
  laneKey: string | null;
  kind: 'member' | 'observer' | 'application';
  y: number;
}

interface Group { site: string; name: string; rows: Row[] }

/** Who is on the page and in what order, before anything knows a height. */
interface Skeleton {
  groups: Group[];
  flat: Row[];
  rowIndex: Map<string, number>;
  /** Every link the layout can draw, with the rail lane and rows each one joins. */
  placed: Placed[];
  railLanes: number;
}

interface Layout {
  top: number;
  rows: Row[];
  headers: { site: string; name: string; y: number; down: boolean }[];
  appHead: { y: number } | null;
  appLanes: { lane: TimelineLane; y: number }[];
  /** The middle of each gap between two rows: where a pill sits. */
  gapY: number[];
  bottom: number;
}

/* ---------------- who is where ---------------- */

/**
 * The data centres in declared order (`siteOrder`), each with its members and
 * observers in the timeline's lane order and the application, when the
 * document has one, last in the data centre its host is in -- where the canvas
 * draws it.
 *
 * The order is read off a throwaway model so it is known before the width is:
 * the rail's width depends on how many connector lanes the rows need, and the
 * real model's plot depends on the rail. A model's lane order does not depend
 * on its width.
 */
function useSkeleton(tr: Trace | null, doc: TopologyDoc): Skeleton | null {
  const geo = geometry.value;
  const graph = redoGraph.value;
  const order = useMemo(
    () => (tr ? buildTimeline(tr, doc, { width: 800, gutter: 200, links: 'never', app: false, selection: null }) : null),
    [tr, doc],
  );
  return useMemo(() => {
    if (!geo || !graph) return null;
    const laneOf = (id: string): TimelineLane | null =>
      order?.lanes.find((l) => l.kind !== 'application' && l.kind !== 'link' && l.id === id) ?? null;
    const rank = (l: TimelineLane | null, n: NodeBox): number => {
      if (n.kind === 'application') return 1e6;
      return l && order ? order.lanes.indexOf(l) : 1000 + n.row * 10 + n.col;
    };
    const bySite = new Map<string, NodeBox[]>();
    for (const n of geo.nodes) {
      const s = n.site as string;
      bySite.set(s, [...(bySite.get(s) ?? []), n]);
    }
    const nameOf = (s: string): string => doc.sites.find((x) => (x.id as string) === s)?.name ?? s;
    const groups: Group[] = siteOrder(doc.sites.map((s) => s.id as string), new Set(bySite.keys())).map((site) => ({
      site,
      name: nameOf(site),
      rows: (bySite.get(site) ?? [])
        .map((n) => ({ n, l: laneOf(n.id) }))
        .sort((a, b) => rank(a.l, a.n) - rank(b.l, b.n))
        .map<Row>(({ n, l }) => ({
          key: l?.key ?? `node:${n.id}`, id: n.id, site, node: n, laneKey: l?.key ?? null, y: 0,
          kind: n.kind === 'application' ? 'application' : n.kind === 'observer' ? 'observer' : 'member',
        })),
    })).filter((g) => g.rows.length > 0);
    const flat = groups.flatMap((g) => g.rows);
    const rowIndex = new Map(flat.map((r, i) => [r.id, i]));
    const { placed, lanes } = assignLanes(buildLinks(doc, graph, geo, null), rowIndex, MAX_RAIL);
    return { groups, flat, rowIndex, placed, railLanes: lanes };
  }, [geo, graph, doc, order]);
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

function Card({ x, y, row, lane, t, selected, dim, hot, tools, moreOpen, onPick, onHover, onMore }: {
  x: number; y: number; row: Row; lane: TimelineLane | null; t: number; selected: boolean; dim: boolean; hot: boolean;
  tools: readonly CanvasTool[]; moreOpen: boolean;
  onPick: (id: string, additive: boolean) => void;
  onHover: (id: string | null) => void;
  onMore: (trigger: SVGGElement) => void;
}) {
  const doc = topology.value;
  const snap = frame.value;
  const node = row.node;
  const fr = node ? cardFrameFor(doc, node, snap) : NEUTRAL_FRAME;
  const role = node ? cardRoleFor(doc, node, snap) : null;
  const chip = node ? chipsFor(doc, node)[0] : undefined;
  const seg = lane
    ? lane.segments.find((s) => t >= s.t0 - 1e-9 && t <= s.t1 + 1e-9) ?? null
    : null;
  let roleText = node?.lines.sub ?? node?.lines.host ?? '';
  if (role === 'primary') roleText = 'Primary';
  else if (role === 'former-primary') roleText = 'Former primary';
  else if (role === 'standby' && roleText === 'Primary') roleText = 'Standby';
  if (row.kind === 'application') {
    roleText = fr.down ? 'down' : fr.stalled ? 'no service reachable' : fr.phase === 'serving' ? 'service reachable' : 'Application';
  }
  const state = seg?.labels[seg.labels.length - 1] ?? '';
  const stripW = stripWidth(tools.length) + 8;
  const sub = elide(state === '' ? roleText : `${roleText} · ${state}`, Math.max(14, Math.floor((CW - 46 - stripW) / 5.1)));
  const h = RH;
  const cls = ['ln-card', fr.down ? 'is-down' : PHASE_CLASS[fr.phase] ?? '',
    fr.stalled && !fr.down ? 'is-stalled' : '', fr.unreachable ? 'is-unreached' : '',
    fr.degraded ? 'is-degraded' : '', selected ? 'is-sel' : '', hot ? 'is-hot' : ''].filter(Boolean).join(' ');
  const bdg = `ln-bdg${role ? ` is-${role}` : ''}${row.kind === 'observer' ? ' is-obs' : ''}${fr.down ? ' is-down' : ''}`;
  const name = node?.lines.name ?? row.id;
  return (
    <g
      class={`ln-cardwrap${dim ? ' is-dim' : ''}`}
      onPointerEnter={() => onHover(row.id)}
      onPointerLeave={() => onHover(null)}
      onFocusIn={() => onHover(row.id)}
      onFocusOut={() => onHover(null)}
    >
      <g
        class="ln-node"
        data-node={row.id}
        role="button"
        tabindex={0}
        aria-pressed={selected}
        aria-label={`${name}, ${roleText}${state ? `, ${state}` : ''}`}
        onClick={(e) => onPick(row.id, e.shiftKey || e.metaKey || e.ctrlKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(row.id, e.shiftKey); }
        }}
      >
        <title>{node?.hostFull ? `${name} — ${node.hostFull}` : name}</title>
        {fr.down ? <rect class="ln-hatch" x={x} y={y} width={CW} height={h} rx={5} fill="url(#tlHatch)" /> : null}
        <rect class={cls} x={x} y={y} width={CW} height={h} rx={5} />
        <rect class={bdg} x={x + 8} y={y + (h - 22) / 2} width={22} height={22} rx={6} />
        <text class="ln-bdg-t" x={x + 19} y={y + h / 2 + 4} text-anchor="middle">{letterFor(node, role)}</text>
        <text class="ln-name" x={x + 38} y={y + 16}>{elide(name, 16)}</text>
        <text class="ln-sub" x={x + 38} y={y + 30}>{sub}</text>
        {chip ? (
          <g class={`ln-chip is-${chip.tone}`}>
            <title>{chip.title}</title>
            <text x={x + CW - 8 - (fr.crashed ? 18 : 0)} y={y + 15} text-anchor="end">{chip.text}</text>
          </g>
        ) : null}
        {fr.crashed ? (
          <g class="ln-x" aria-hidden="true">
            <line x1={x + CW - 22} y1={y + 6} x2={x + CW - 10} y2={y + 18} />
            <line x1={x + CW - 10} y1={y + 6} x2={x + CW - 22} y2={y + 18} />
          </g>
        ) : null}
      </g>
      <EventStrip
        right={x + CW - 5} y={y + h - EV - 3} name={name} tools={tools} moreOpen={moreOpen} onMore={onMore}
      />
    </g>
  );
}

/* ---------------- the links, as connectors in the card column ---------------- */

function pillText(l: CanvasLink): string {
  const word = l.kind === 'redo' ? (l.xpt ?? 'redo') : l.kind === 'check' ? 'check' : l.caption;
  const mark = l.cut || l.down ? ' ✕' : l.active && l.up ? ' ✓' : '';
  return `${word}${mark}`;
}

const pillWidth = (text: string): number => Math.round(approxW(text, 9) + 10);
const linkState = (l: CanvasLink): string => (l.cut || l.down ? 'is-down' : l.active && l.up ? 'is-up' : 'is-off');

function Links({ placed, pills, rows, gapY, cardX, related, hoverId, openKey, onOpen }: {
  placed: Placed[]; pills: PillPlan[]; rows: Row[]; gapY: number[]; cardX: number;
  related: Set<string> | null; hoverId: string | null; openKey: string | null;
  onOpen: (plan: PillPlan, trigger: SVGGElement) => void;
}) {
  const cy = (i: number): number => (rows[i]?.y ?? 0) + RH / 2;
  return (
    <g class="ln-links">
      {placed.map((p) => {
        const x = 8 + p.lane * RAIL_STEP;
        const involved = hoverId !== null && (p.link.from === hoverId || p.link.to === hoverId);
        const faint = related !== null && !involved;
        return (
          <g key={p.link.id} class={`ln-lk ${linkState(p.link)}${involved ? ' is-hot' : ''}${faint ? ' is-faint' : ''}`} data-tip={p.link.title}>
            <line class="ln-lk-hit" x1={x} y1={cy(p.ra)} x2={x} y2={cy(p.rb)} />
            <line x1={x} y1={cy(p.ra)} x2={x} y2={cy(p.rb)} />
            <line x1={x} y1={cy(p.ra)} x2={cardX} y2={cy(p.ra)} />
            <line x1={x} y1={cy(p.rb)} x2={cardX} y2={cy(p.rb)} />
            <circle cx={x} cy={cy(p.ra)} r={2.2} />
            <circle cx={x} cy={cy(p.rb)} r={2.2} />
          </g>
        );
      })}
      {pills.map((plan) => {
        const involved = hoverId !== null && plan.links.some((l) => l.from === hoverId || l.to === hoverId);
        const faint = related !== null && !involved;
        const first = plan.links[0];
        const acts = plan.links.some((l) => l.docLink !== undefined);
        const st = plan.more ? 'is-more' : first ? linkState(first) : 'is-off';
        const tip = plan.links.map((l) => l.title).join(' · ');
        const x = cardX + PILL_PAD + plan.x;
        const y = gapY[plan.gap] ?? 0;
        return (
          <g
            key={plan.key}
            class={`ln-pill ${st}${acts ? ' is-act' : ''}${openKey === plan.key ? ' is-open' : ''}${involved ? ' is-hot' : ''}${faint ? ' is-faint' : ''}`}
            data-tip={tip}
            role={acts ? 'button' : undefined}
            tabindex={acts ? 0 : undefined}
            aria-label={acts ? `${plan.more ? `${plan.links.length} more links` : tip}, events` : undefined}
            aria-haspopup={acts ? 'menu' : undefined}
            aria-expanded={acts ? openKey === plan.key : undefined}
            onClick={acts ? (e) => onOpen(plan, e.currentTarget) : undefined}
            onKeyDown={acts ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(plan, e.currentTarget); }
            } : undefined}
          >
            <rect x={x} y={y - PILL_H / 2} width={plan.w} height={PILL_H} rx={PILL_H / 2} />
            <text x={x + plan.w / 2} y={y + 3} text-anchor="middle">{plan.text}</text>
          </g>
        );
      })}
    </g>
  );
}

/* ---------------- the view ---------------- */

/**
 * The line that heads the application's lanes: what they are, the one reading
 * they add up to, and "this page's model" at the far end. On a narrow plot the
 * reading is cut to what fits (the tooltip has all of it) and the far label
 * gives way first, rather than the two printing over each other.
 */
function AppHead({ section, x, right, y }: {
  section: NonNullable<TimelineModel['appSection']>; x: number; right: number; y: number;
}) {
  const room = right - x - approxW(section.title, 12) - 16;
  const showModel = room > approxW(section.note, 11) + 110;
  const budget = Math.max(0, room - (showModel ? 110 : 0));
  const note = approxW(section.note, 11) <= budget ? section.note : elide(section.note, Math.max(4, Math.floor(budget / 5.4)));
  return (
    <g class="tl-app-head" data-tip={note === section.note ? section.basis : `${section.note} — ${section.basis}`}>
      <text class="t-top" x={x} y={y}>
        {section.title}
        <tspan class={section.tone === 'ink' ? 't-app-note' : `t-app-note ${section.tone}`} dx="8">{note}</tspan>
      </text>
      {showModel ? <text class="t-tick" x={right} y={y} text-anchor="end">this page&rsquo;s model</text> : null}
    </g>
  );
}

interface Frame {
  width: number;
  measure: (el: HTMLElement | null) => void;
  skeleton: Skeleton | null;
  cardX: number;
  plotL: number;
}

export function LanesView() {
  const [measure, measured] = useWidth(900);
  const doc = topology.value;
  const tr = trace.value;
  const skeleton = useSkeleton(tr, doc);
  const railLanes = skeleton?.railLanes ?? 0;
  const cardX = 10 + railLanes * RAIL_STEP + (railLanes > 0 ? 4 : 0);
  const fr: Frame = { width: Math.max(measured, 720), measure, skeleton, cardX, plotL: cardX + CW + 10 };
  return tr ? <RunLanes tr={tr} fr={fr} /> : <Lanes run={null} fr={fr} />;
}

/** The held axis lives in the hook, so the bar and the drawing read one model. */
function RunLanes({ tr, fr }: { tr: Trace; fr: Frame }) {
  const app = appLanesShown.value;
  const run = useRunTimeline({
    trace: tr, doc: topology.value, width: fr.width, selection: null, appView: app,
    density: 'full', gutter: fr.plotL, links: 'never',
  });
  return <Lanes run={run} fr={fr} />;
}

function LanesBar({ run }: { run: RunTimeline | null }) {
  const [ref, width] = useWidth(1000);
  const tight = width < TIGHT_W;
  const doc = topology.value;
  const app = appLanesShown.value;
  const t = tNow.value;
  return (
    <header class="sb-bar ln-bar" ref={ref} role="group" aria-label="Timeline controls">
      {run !== null && !run.model.empty ? (
        <Transport
          model={run.model}
          tNow={t}
          playing={playing.value}
          speed={speed.value}
          speedControl={tight ? 'select' : 'buttons'}
          onSeek={(v) => { tNow.value = v; }}
          onPlayToggle={() => { playing.value = !playing.value; }}
          onSpeed={(s) => { speed.value = s; }}
        />
      ) : null}
      <TerseReadout run={trace.value !== null} tight={tight} />
      {run?.held ? (
        <button
          type="button" class="btn sb-fit"
          title="An event was moved and the axis stayed where it was: fit it to the run again"
          onClick={run.fit}
        >
          Fit timeline
        </button>
      ) : null}
      <FindingsMenu />
      {run === null ? (
        doc.application === undefined ? null : (
          <button
            type="button" class="btn sb-app-btn" aria-pressed={app}
            title="The application's lanes under the members"
            onClick={() => { appLanesShown.value = !app; }}
          >
            App view
          </button>
        )
      ) : <KeyMenu run={run} />}
    </header>
  );
}

function Lanes({ run, fr }: { run: RunTimeline | null; fr: Frame }) {
  const { width, cardX, plotL, skeleton } = fr;
  const model = run?.model ?? null;
  const doc = topology.value;
  const geo = geometry.value;
  const snap = frame.value;
  const t = tNow.value;
  const at = snapT(t);
  const sel = selection.value;
  const isPlaying = playing.value;
  const app = appLanesShown.value;
  const view = useHostWindow();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLElement | null>(null);

  /* ---- rows and their heights ---- */
  const layout = useMemo<Layout>(() => {
    const sk = skeleton;
    const top = model ? TOP_RUN : TOP_EMPTY;
    const empty: Layout = { top, rows: [], headers: [], appHead: null, appLanes: [], gapY: [], bottom: top };
    if (!sk) return empty;

    /* A marker's sentence sits in the gap above its lane (below, for the abort). */
    const above = new Set<string>();
    for (const m of model?.markers ?? []) {
      if (m.kind === 'event' || m.laneKey === null) continue;
      if (m.kind === 'abort') {
        const i = sk.flat.findIndex((r) => r.key === m.laneKey);
        const next = sk.flat[i + 1];
        if (i >= 0 && next) above.add(next.key);
      } else above.add(m.laneKey);
    }

    let y = top;
    const rows: Row[] = [];
    const headers: Layout['headers'] = [];
    sk.groups.forEach((g, gi) => {
      if (gi > 0) y += DC_GAP;
      headers.push({ site: g.site, name: g.name, y, down: siteIsDown(doc, g.site, snap) });
      y += HDR;
      g.rows.forEach((r, i) => {
        y += i === 0 ? 3 : GAP + (above.has(r.key) ? LABEL_EXTRA : 0);
        rows.push({ ...r, y });
        y += RH;
      });
    });
    const gapY = rows.slice(0, -1).map((r, k) => {
      const next = rows[k + 1] as Row;
      return r.site === next.site ? (r.y + RH + next.y) / 2 : r.y + RH + DC_GAP / 2;
    });

    let appHead: Layout['appHead'] = null;
    const appLanes: Layout['appLanes'] = [];
    const lanes = model?.lanes.filter((l) => l.kind === 'application') ?? [];
    if (model?.appSection && lanes.length > 0) {
      y += DC_GAP;
      appHead = { y };
      y += HDR;
      lanes.forEach((lane, i) => {
        y += i === 0 ? 3 : GAP + (above.has(lane.key) ? LABEL_EXTRA : 0);
        appLanes.push({ lane, y });
        y += RH;
      });
    }
    return { top, rows, headers, appHead, appLanes, gapY, bottom: y + 8 };
  }, [skeleton, doc, model, snap]);
  const { top, rows, headers, appHead, appLanes, gapY, bottom } = layout;

  /* ---- what hangs off a row moves with it; what hangs under the axis moves with the axis ---- */
  const axisY = bottom + AXIS_GAP;
  const shifted = useMemo<TimelineMarker[]>(() => {
    if (!model) return [];
    const yOf = new Map<string, number>();
    for (const r of rows) if (r.laneKey !== null) yOf.set(r.laneKey, r.y);
    for (const a of appLanes) yOf.set(a.lane.key, a.y);
    const laneY = new Map(model.lanes.map((l) => [l.key, l.y]));
    const primaryKey = model.lanes.find((l) => l.group === 'primary')?.key ?? null;
    const py = (primaryKey === null ? undefined : yOf.get(primaryKey)) ?? rows[0]?.y ?? top;
    return model.markers.map((m) => {
      if (m.kind === 'event') {
        const partition = m.glyph === 'partition';
        return { ...m, y0: partition ? top : py - 4, y1: partition ? bottom : py + RH + 4 };
      }
      const mine = m.laneKey === null ? undefined : yOf.get(m.laneKey);
      const theirs = m.laneKey === null ? undefined : laneY.get(m.laneKey);
      if (mine === undefined || theirs === undefined) return m;
      const d = mine - theirs;
      return { ...m, y0: m.y0 + d, y1: m.y1 + d, labelY: m.labelY + d };
    });
  }, [model, rows, appLanes, bottom, top]);
  const braceDy = model ? axisY - model.axisY : 0;
  const height = model ? axisY + (model.height - model.axisY) : bottom;

  const shiftedModel = useMemo<TimelineModel | null>(
    () => (model ? { ...model, markers: shifted, laneTop: top - 2, lanesBottom: bottom, axisY } : null),
    [model, shifted, bottom, axisY, top],
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

  /* ---- the event buttons, at the playhead ---- */
  const keys = useMemo(
    () => [...rows.map((r) => r.id), ...headers.map((h) => h.site)],
    [rows, headers],
  );
  const tools = useMemo(() => {
    const out = new Map<string, CanvasTool[]>();
    for (const k of keys) out.set(k, hoverTools(doc, k, at, { keepPlayhead: true }));
    return out;
  }, [doc, at, keys]);
  const toolsOf = (k: string): CanvasTool[] => tools.get(k) ?? [];

  const openMenu = (key: string, subjects: MenuTarget['subjects'], trigger: Element): void => {
    const r = trigger.getBoundingClientRect();
    if (menu?.trigger === trigger) { setMenu(null); setMenuKey(null); return; }
    setMenuKey(key);
    setMenu({ subjects, anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, trigger });
  };
  const closeMenu = (restore: boolean): void => {
    const trigger = menu?.trigger;
    setMenu(null);
    setMenuKey(null);
    if (restore && trigger instanceof Element && 'focus' in trigger) (trigger as HTMLElement).focus();
  };
  /* The menu is placed beside what opened it; scrolling the rows away from it would leave it hanging. */
  useEffect(() => {
    const el = body.current;
    if (menu === null || el === null) return undefined;
    const away = (): void => { setMenu(null); setMenuKey(null); };
    el.addEventListener('scroll', away);
    return () => el.removeEventListener('scroll', away);
  }, [menu]);
  const nameOfRow = (r: Row): string => r.node?.lines.name ?? r.id;

  /* ---- the links at this instant ---- */
  const links = useMemo(() => {
    const graph = redoGraph.value;
    return geo && graph ? buildLinks(doc, graph, geo, snap) : [];
  }, [doc, geo, snap]);
  const placed = useMemo<Placed[]>(() => {
    const byId = new Map(links.map((l) => [l.id, l]));
    return (skeleton?.placed ?? []).map((p) => ({ ...p, link: byId.get(p.link.id) ?? p.link }));
  }, [skeleton, links]);
  const pills = useMemo(
    () => planPills(placed, CW - PILL_PAD * 2, pillText, pillWidth),
    [placed],
  );
  const related = useMemo<Set<string> | null>(() => {
    if (hoverId === null) return null;
    const s = new Set<string>([hoverId]);
    for (const l of links) {
      if (l.from === hoverId) s.add(l.to);
      if (l.to === hoverId) s.add(l.from);
    }
    return s;
  }, [hoverId, links]);
  const onPill = (plan: PillPlan, trigger: SVGGElement): void => {
    const subjects = plan.links.flatMap((l) => (l.docLink === undefined ? [] : [{ key: l.docLink, title: pillText(l) }]));
    if (subjects.length > 0) openMenu(plan.key, subjects, trigger);
  };

  const onPlotMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const text = tipFromEvent(e.target);
    if (text === null) { if (tip !== null) setTip(null); return; }
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const plotR = model?.scale.plotR ?? width - TL_FULL.padR;
  const dim = (id: string): boolean => related !== null && !related.has(id);
  const laneSelected = (id: string): boolean => sel.includes(id);
  const laneOf = (r: Row): TimelineLane | null =>
    r.laneKey === null ? null : model?.lanes.find((l) => l.key === r.laneKey) ?? null;
  const caption = model?.caption;

  return (
    <section class="ln-view float-card" aria-label="Break: topology and timeline" ref={section}>
      <LanesBar run={run} />

      <div
        class="ln-body"
        ref={(el) => { body.current = el; fr.measure(el); }}
      >
        {geo === null ? (
          <p class="ln-note ln-pad">Nothing to draw: the configuration has no valid redo graph.</p>
        ) : (
          <div class="tl-plot ln-plot" onPointerMove={onPlotMove} onPointerLeave={() => setTip(null)}>
            <svg
              class={`tl-svg ln-svg${model ? ' is-seekable' : ''}`}
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
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
                    <rect class="prezone" x={model.preZone.x} y={top} width={model.preZone.w} height={bottom - top} />
                  ) : null}
                  {model.ticks.map((tk) => (
                    <line key={`g${tk.t}`} class="gridline" x1={tk.x} y1={20} x2={tk.x} y2={axisY} />
                  ))}
                  {model.ticks.map((tk) => (
                    <text key={`t${tk.t}`} class="t-tick t-mono" x={tk.x} y={13} text-anchor="middle">{tk.label}</text>
                  ))}
                  <text class="t-tick" x={cardX} y={13}>seconds</text>
                  {model.preZone.label ? (
                    <text class="t-tick" x={model.scale.plotL + 6} y={top + 12}>{model.preZone.label}</text>
                  ) : null}
                  {caption ? (
                    <text
                      class={caption.tone === 'ink' ? 't-top' : `t-top ${caption.tone}`}
                      x={caption.x ?? model.scale.plotL} y={30}
                      text-anchor={caption.anchor === 'middle' ? 'middle' : undefined}
                    >
                      {caption.text}
                    </text>
                  ) : null}
                  {model.topBrace ? <TopBrace {...model.topBrace} /> : null}
                </>
              ) : (
                <g class="ln-empty">
                  {rows.map((r) => (
                    <rect key={`e${r.key}`} class="ln-track" x={plotL} y={r.y} width={Math.max(0, plotR - plotL)} height={RH} rx={3} />
                  ))}
                  <text class="ln-empty-t" x={plotL + 4} y={top - 24}>Steady state. Nothing has been injected yet.</text>
                  <text class="ln-empty-h" x={plotL + 4} y={top - 8}>Pick an event on a card to start.</text>
                </g>
              )}

              {/* what the buttons are aimed at */}
              <g class="ln-when" data-tip="The event buttons act at the playhead. Move the playhead to add an event later.">
                <text class="ln-when-t" x={cardX} y={top - 22}>Events at t = {fmt(at)} s</text>
                <text class="ln-when-s" x={cardX} y={top - 9}>the buttons act at the playhead</text>
              </g>

              {headers.map((h) => {
                const stripR = cardX + CW - 4;
                const dcTools = toolsOf(h.site);
                return (
                  <g key={h.site} class={`ln-dc${h.down ? ' is-down' : ''}${sel.includes(h.site) ? ' is-sel' : ''}`} data-site={h.site}>
                    <g
                      class="ln-dc-body"
                      role="button"
                      tabindex={0}
                      aria-pressed={sel.includes(h.site)}
                      aria-label={`${h.name}${h.down ? ', down' : ''}`}
                      onClick={(e) => onPick(h.site, e.shiftKey || e.metaKey || e.ctrlKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(h.site, e.shiftKey); }
                      }}
                    >
                      <rect x={cardX} y={h.y} width={CW} height={HDR - 2} rx={4} />
                      <text x={cardX + 8} y={h.y + 14}>{h.name}{h.down ? ' — down' : ''}</text>
                    </g>
                    <line x1={cardX + CW + 6} y1={h.y + 9} x2={plotR} y2={h.y + 9} />
                    <EventStrip
                      right={stripR} y={h.y + (HDR - 2 - EV) / 2} name={h.name} tools={dcTools}
                      moreOpen={menuKey === `site:${h.site}`}
                      onMore={(el) => openMenu(`site:${h.site}`, [{ key: h.site, title: h.name }], el)}
                    />
                  </g>
                );
              })}

              {rows.map((r) => {
                const lane = laneOf(r);
                return (
                  <g key={r.key} class={`ln-row${dim(r.id) ? ' is-dim' : ''}${related?.has(r.id) && r.id !== hoverId ? ' is-rel' : ''}`}>
                    {lane ? (
                      <Lane
                        lane={{ ...lane, y: r.y }}
                        model={model as TimelineModel}
                        selected={laneSelected(r.id)}
                        onSelect={selectLane}
                      />
                    ) : null}
                  </g>
                );
              })}

              {appHead && model?.appSection ? (
                <g class="ln-apphead">
                  <g class="ln-dc">
                    <rect x={cardX} y={appHead.y} width={CW} height={HDR - 2} rx={4} />
                    <text x={cardX + 8} y={appHead.y + 14}>Application&rsquo;s view</text>
                  </g>
                  <AppHead section={model.appSection} x={plotL + 6} right={plotR} y={appHead.y + 14} />
                </g>
              ) : null}
              {appLanes.map(({ lane, y }) => (
                <g key={lane.key} class={`ln-row${dim(lane.id) ? ' is-dim' : ''}`}>
                  <Lane lane={{ ...lane, y }} model={model as TimelineModel} selected={laneSelected(lane.id)} onSelect={selectLane} />
                  <text class="ln-alab" x={cardX + CW - 8} y={y + 17} text-anchor="end">{lane.name}</text>
                  <text class="ln-asub" x={cardX + CW - 8} y={y + 30} text-anchor="end">{elide(lane.sub, 34)}</text>
                </g>
              ))}

              {model ? (
                <>
                  {model.ticks.map((tk) => (
                    <text key={`b${tk.t}`} class="t-tick t-mono" x={tk.x} y={axisY + 16} text-anchor="middle">{tk.label}</text>
                  ))}
                  <line class="ax" x1={model.scale.plotL} y1={axisY} x2={model.scale.plotR} y2={axisY} />
                  <text class="t-tick t-mono" x={model.scale.plotR} y={axisY + 30} text-anchor="end">{model.axisLabel}</text>
                  {model.zeroNote ? (
                    <text class="t-tick" x={model.scale.plotL} y={axisY + 30}>{model.zeroNote}</text>
                  ) : null}
                  {model.braces.map((b) => <Brace key={b.key} brace={{ ...b, y: b.y + braceDy }} />)}
                </>
              ) : null}

              <Links
                placed={placed} pills={pills} rows={rows} gapY={gapY} cardX={cardX}
                related={related} hoverId={hoverId} openKey={menuKey} onOpen={onPill}
              />

              {rows.map((r) => (
                <Card
                  key={`c${r.key}`}
                  x={cardX} y={r.y} row={r} lane={laneOf(r)} t={t}
                  selected={sel.includes(r.id)}
                  dim={dim(r.id)}
                  hot={related?.has(r.id) === true}
                  tools={toolsOf(r.id)}
                  moreOpen={menuKey === r.id}
                  onPick={onPick}
                  onHover={setHoverId}
                  onMore={(el) => openMenu(r.id, [{ key: r.id, title: nameOfRow(r) }], el)}
                />
              ))}

              {shiftedModel ? (
                <>
                  {shifted.filter((m) => m.kind !== 'event').map((m) => <Marker key={m.key} marker={m} layout={shiftedModel.layout} />)}
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
                      key={m.key} marker={m} model={shiftedModel} doc={doc}
                      onMove={(index, when, expected) => {
                        const result = setEventTime(index, when, expected);
                        run?.dropped(index, when, expected, result);
                        return result;
                      }}
                      onStart={() => { setTip(null); if (isPlaying) playing.value = false; }}
                    >
                      <Marker marker={m} layout={shiftedModel.layout} />
                    </EventDrag>
                  ))}
                </>
              ) : null}
            </svg>
            <Tooltip tip={tip} />
          </div>
        )}
      </div>
      {menu === null ? null : (
        <MoreMenu key={menuKey ?? ''} target={menu} doc={doc} t={t} view={section.current} onClose={closeMenu} />
      )}
      <span class="sr">t = {fmt(t)} s</span>
    </section>
  );
}
