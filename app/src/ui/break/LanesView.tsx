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
import { Fragment } from 'preact';
import type { JSX } from 'preact';
import type { CanvasTool } from '../canvas/HoverTools';
import { frame, geometry, redoGraph, topology, trace } from '@/state/derived';
import {
  appLanesShown, canEdit, clearSelection, mode, playing, select, selection, speed, tNow, viewport,
} from '@/state/view';
import { applicationsOf } from '@/engine';
import type { Application, Trace, TopologyDoc } from '@/engine';
import { buildTimeline, fmt, TL_FULL } from '../timeline/build';
import type {
  AppSectionHead, TimelineCaption, TimelineLane, TimelineMarker, TimelineModel, TimelineSegment,
} from '../timeline/build';
import { Defs, Lane, Marker } from '../timeline/Timeline';
import { Brace, TopBrace } from '../timeline/Brace';
import { equationOf } from '../timeline/equation';
import { RunHeadline } from '../timeline/RunHeadline';
import { applyTune } from '../timeline/tune';
import { Playhead } from '../timeline/Playhead';
import { EventDrag } from '../timeline/EventDrag';
import { TuneDrag } from '../timeline/TuneDrag';
import { useTuneHandles } from '../timeline/tune-handles';
import { Transport } from '../timeline/Transport';
import { usePlayback } from '../timeline/playback';
import { useRunTimeline } from '../timeline/run';
import type { RunTimeline } from '../timeline/run';
import { Tooltip, tipFromEvent } from '../timeline/Tooltip';
import type { TooltipState } from '../timeline/Tooltip';
import { useHostWindow } from '../common/dom';
import { popped } from '../common/popout';
import { useWidth } from '../common/use-width';
import { hoverTools, setEventTime, snapT } from './events';
import { buildLinks, cardFrameFor, cardRoleFor, chipsFor, NEUTRAL_FRAME, siteIsDown } from '../canvas/routing';
import type { CanvasLink } from '../canvas/routing';
import type { NodeBox } from '../canvas/layout';
import { approxW, elide, fitLabel } from '../canvas/measure';
import { FindingsMenu, KeyMenu, TerseReadout, TIGHT_W } from './RunBar';
import { ReadoutFold, SummaryBand } from './SummaryBand';
import { EventStrip, EV, MoreMenu, stripWidth } from './lanes-events';
import type { MenuTarget } from './lanes-events';
import { AppTimeline, appTimelineOn, TimelineSwitch } from './TimelineView';
import { SETTINGS_COLUMN_MIN_W, TuneStrip, TuneToggle, tuneLayoutFor } from './TuneStrip';
import { assignLanes, cardSub, hostBands, planPills, segmentAt, siteOrder } from './lanes-layout';
import type { Placed, PillPlan } from './lanes-layout';

/* ---------------- geometry ---------------- */

const CW = 232; // a card's width: room for the name, the state and the event buttons
const RH = TL_FULL.laneH; // a row's height, so the model's marker offsets still hold
const GAP = 20; // between two rows of one data centre: a row of link pills, and a marker's sentence
const HDR = 20; // a data centre's header band
const DC_GAP = 20; // between one data centre's last row and the next header: a pill row too
const APP_GAP = 6; // between the application's own lanes: no pills there
const APP_LABEL = 14; // extra room above an application lane whose marker carries a sentence
const HEAD_H = 26; // the sticky strip's clock: the tick labels, the outage brace, the caption over the cards
const PIN_L = 54; // the event pins' sentence baseline; the pin stacks above it, the playhead grip under it
const PIN_ICON_DY = 35; // the icon chip's centre, above PIN_L
const PIN_BADGE_DY = 17; // the number badge's centre, above PIN_L
const TOP_RUN = PIN_L + 12; // where the first header starts under a run
const TOP_EMPTY = 26; // and with no run: room for the playhead's flag
const AXIS_GAP = 20; // from the last lane to the axis the braces hang under
const RAIL_STEP = 9;
const MAX_RAIL = 5;
const PILL_PAD = 6; // from the card's left edge to the first pill
const PILL_H = 15;
const PILL_FS = 10.5;
/** The axis of a run that does not exist yet: where the playhead is, and a scale to read it on. */
const STEADY_T0 = 0;
const STEADY_T1 = 60;
const STEADY_STEP = 10;
const STEADY_SENTENCE = 'Steady state. Nothing has been injected yet. Pick an event on a card to start.';
const STEADY_CAPTION: TimelineCaption = { text: STEADY_SENTENCE, tone: 'ink', x: null, anchor: 'start' };

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
  appHeads: { y: number; section: AppSectionHead }[];
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

/**
 * One card: the badge, the name and the event buttons on the first line, what
 * it is and what it is doing at the playhead on the second, across the card's
 * whole width. Everything that says how it is at `t` -- the words, the frame's
 * colour and hatch, the cross, the accessible name -- is read at the same `t`:
 * the frame from the snapshot the drawing reads, the state from the band that
 * begins at it (`segmentAt`), so they cannot disagree at an event's own tick.
 */
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
  const seg = lane ? segmentAt(lane.segments, t) : null;
  let roleText = node?.lines.sub ?? node?.lines.host ?? '';
  if (role === 'primary') roleText = 'Primary';
  else if (role === 'former-primary') roleText = 'Former primary';
  else if (role === 'standby' && roleText === 'Primary') roleText = 'Standby';
  /* The application's second line is the frame's own reading; its lane is the host's up and down. */
  if (row.kind === 'application') {
    roleText = fr.down ? 'Host down' : fr.stalled ? 'No service reachable' : fr.phase === 'serving' ? 'Service reachable' : 'Application';
  }
  const states = row.kind === 'application' || !seg ? [] : seg.labels;
  const state = states[states.length - 1] ?? '';
  const sub = cardSub(roleText, states, CW - 38 - 8);
  const h = RH;
  const cls = ['ln-card', fr.down ? 'is-down' : PHASE_CLASS[fr.phase] ?? '',
    fr.stalled && !fr.down ? 'is-stalled' : '', fr.unreachable ? 'is-unreached' : '',
    fr.degraded ? 'is-degraded' : '', selected ? 'is-sel' : '', hot ? 'is-hot' : ''].filter(Boolean).join(' ');
  const bdg = `ln-bdg${role ? ` is-${role}` : ''}${row.kind === 'observer' ? ' is-obs' : ''}${fr.down ? ' is-down' : ''}`;
  const name = elide(node?.lines.name ?? row.id, 16);
  /* The chip rides after the name when the name leaves room for it before the buttons. */
  const stripL = x + CW - 5 - stripWidth(tools.length);
  const chipX = x + 38 + approxW(name, 12.5, true) + 8;
  const showChip = chip !== undefined && chipX + approxW(chip.text, 9) + chip.text.length * 0.3 <= stripL - 4;
  return (
    <g
      class={`ln-cardwrap${dim ? ' is-dim' : ''}`}
      onPointerEnter={() => onHover(row.id)}
      onPointerLeave={() => onHover(null)}
      onFocusIn={() => onHover(row.id)}
      onFocusOut={() => onHover(null)}
    >
      <g
        class={fr.down ? 'ln-node is-down' : 'ln-node'}
        data-node={row.id}
        role="button"
        tabindex={0}
        aria-pressed={selected}
        aria-label={`${node?.lines.name ?? row.id}, ${roleText}${state ? `, ${state}` : ''}`}
        onClick={(e) => onPick(row.id, e.shiftKey || e.metaKey || e.ctrlKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(row.id, e.shiftKey); }
        }}
      >
        <title>{node?.hostFull ? `${node.lines.name} — ${node.hostFull}` : node?.lines.name ?? row.id}</title>
        {fr.down ? <rect class="ln-hatch" x={x} y={y} width={CW} height={h} rx={5} fill="url(#tlHatch)" /> : null}
        <rect class={cls} x={x} y={y} width={CW} height={h} rx={5} />
        <rect class={bdg} x={x + 8} y={y + (h - 22) / 2} width={22} height={22} rx={6} />
        {fr.crashed ? (
          /* A crashed host is a cross in the badge, where the role's letter was. */
          <g class="ln-x" aria-hidden="true">
            <line x1={x + 14.5} y1={y + h / 2 - 4.5} x2={x + 23.5} y2={y + h / 2 + 4.5} />
            <line x1={x + 23.5} y1={y + h / 2 - 4.5} x2={x + 14.5} y2={y + h / 2 + 4.5} />
          </g>
        ) : (
          <text class="ln-bdg-t" x={x + 19} y={y + h / 2 + 4} text-anchor="middle">{letterFor(node, role)}</text>
        )}
        <text class="ln-name" x={x + 38} y={y + 16}>{name}</text>
        <text class="ln-sub" x={x + 38} y={y + 31}>{sub}</text>
        {showChip && chip ? (
          <g class={`ln-chip is-${chip.tone}`}>
            <title>{chip.title}</title>
            <text x={chipX} y={y + 15}>{chip.text}</text>
          </g>
        ) : null}
      </g>
      <EventStrip
        right={x + CW - 5} y={y + 3} name={node?.lines.name ?? row.id} tools={tools} moreOpen={moreOpen} onMore={onMore}
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

const pillWidth = (text: string): number => Math.round(approxW(text, PILL_FS) + 12);

/** The canvas's link states, and no others: down or cut is red, standing down is muted, the rest is plain. */
const linkState = (l: CanvasLink): string => (l.cut || l.down ? 'is-down' : !l.active ? 'is-off' : 'is-up');

const KIND_WORD: Record<CanvasLink['kind'], string> = {
  redo: 'redo', ping: 'ping', check: 'readiness check', connect: 'connection',
};

/** What a link is called: "redo prm01 → sby01, SYNC". The menu's header and the tooltips start from it. */
function linkName(l: CanvasLink, nameOf: (key: string) => string): string {
  return `${KIND_WORD[l.kind]} ${nameOf(l.from)} → ${nameOf(l.to)}${l.kind === 'redo' && l.xpt ? `, ${l.xpt}` : ''}`;
}

/** ... and what it is doing at the playhead: "redo prm01 → sby01, SYNC, down at t = 20 s". */
function linkSaid(l: CanvasLink, t: number, nameOf: (key: string) => string): string {
  const st = l.cut ? 'cut' : l.down ? 'down' : !l.active ? 'standing down' : 'up';
  return `${linkName(l, nameOf)}, ${st} at t = ${fmt(t)} s`;
}

function Links({ placed, pills, rows, gapY, cardX, related, hoverId, openKey, tipOf, nameOf, onOpen }: {
  placed: Placed[]; pills: PillPlan[]; rows: Row[]; gapY: number[]; cardX: number;
  related: Set<string> | null; hoverId: string | null; openKey: string | null;
  tipOf: (l: CanvasLink) => string; nameOf: (key: string) => string;
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
          <g key={p.link.id} class={`ln-lk ${linkState(p.link)}${involved ? ' is-hot' : ''}${faint ? ' is-faint' : ''}`} data-tip={tipOf(p.link)}>
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
        const tip = plan.links.map(tipOf).join(' · ');
        const x = cardX + PILL_PAD + plan.x;
        const y = gapY[plan.gap] ?? 0;
        return (
          <g
            key={plan.key}
            class={`ln-pill ${st}${acts ? ' is-act' : ''}${openKey === plan.key ? ' is-open' : ''}${involved ? ' is-hot' : ''}${faint ? ' is-faint' : ''}`}
            data-tip={tip}
            role={acts ? 'button' : undefined}
            tabindex={acts ? 0 : undefined}
            aria-label={acts ? `${plan.more ? `${plan.links.length} more links: ${plan.links.map((l) => linkName(l, nameOf)).join(', ')}` : tip}, events` : undefined}
            aria-haspopup={acts ? 'menu' : undefined}
            aria-expanded={acts ? openKey === plan.key : undefined}
            onClick={acts ? (e) => onOpen(plan, e.currentTarget) : undefined}
            onKeyDown={acts ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(plan, e.currentTarget); }
            } : undefined}
          >
            <rect x={x} y={y - PILL_H / 2} width={plan.w} height={PILL_H} rx={PILL_H / 2} />
            <text x={x + plan.w / 2} y={y + 3.7} text-anchor="middle">{plan.text}</text>
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
  section: AppSectionHead; x: number; right: number; y: number;
}) {
  const room = right - x - approxW(section.title, 12) - 16;
  const showModel = room > approxW(section.note, 11) + 110;
  const budget = Math.max(0, room - (showModel ? 110 : 0));
  const note = approxW(section.note, 11) <= budget ? section.note : elide(section.note, Math.max(4, Math.floor(budget / 5.4)));
  return (
    <g class="tl-app-head" data-tip={note === section.note ? section.basis : `${section.note} — ${section.basis}`}>
      <text class="t-top t-app-title" x={x} y={y}>
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

function LanesMembers() {
  const [measure, measured] = useWidth(900);
  const doc = topology.value;
  const tr = trace.value;
  const skeleton = useSkeleton(tr, doc);
  const railLanes = skeleton?.railLanes ?? 0;
  const cardX = 10 + railLanes * RAIL_STEP + (railLanes > 0 ? 4 : 0);
  const fr: Frame = { width: Math.max(measured, 720), measure, skeleton, cardX, plotL: cardX + CW + 10 };
  return tr ? <RunLanes tr={tr} fr={fr} /> : <Lanes run={null} fr={fr} />;
}

/**
 * The stage while Simulate's Application timeline is selected: the same bar
 * (readout, findings and the switch), and the application's detail view where
 * the members' rows were. The rows, and the run they are built from, are not
 * drawn -- nothing here reads the playhead.
 */
function LanesApp() {
  return (
    <section class="ln-view float-card" aria-label="Simulate: application timeline">
      <LanesBar run={null} />
      <div class="ln-body ln-app">
        <AppTimeline />
      </div>
    </section>
  );
}

/** Lanes' stage: the members' rows, or -- when the reader chose it -- the application's timeline. */
export function LanesView() {
  return appTimelineOn() ? <LanesApp /> : <LanesMembers />;
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
  const appTl = appTimelineOn();
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
      <ReadoutFold><TerseReadout run={trace.value !== null} /></ReadoutFold>
      <TimelineSwitch />
      <TuneToggle />
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
        (doc.applications?.length ?? 0) === 0 || appTl ? null : (
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

/**
 * The scale of a run that does not exist yet: nothing to fit an axis to, so the
 * first minute, which is where a first event is usually put. It exists so the
 * playhead has somewhere to be, and the buttons somewhere to be aimed.
 */
function steadyScale(plotL: number, plotR: number): TimelineModel['scale'] {
  const plotW = Math.max(1, plotR - plotL);
  const pxPerSecond = plotW / (STEADY_T1 - STEADY_T0);
  const x0 = plotL - STEADY_T0 * pxPerSecond;
  return {
    t0: STEADY_T0, t1: STEADY_T1, plotL, plotR, plotW, pxPerSecond,
    x: (v) => x0 + pxPerSecond * v,
    tAt: (px) => (px - x0) / pxPerSecond,
    clampT: (v) => Math.max(STEADY_T0, Math.min(STEADY_T1, v)),
  };
}

/** One application host's own up and down as a lane's bands, in the timeline's own vocabulary. */
function hostLaneFor(
  tr: Trace, doc: TopologyDoc, model: TimelineModel, a: Application,
): TimelineLane {  const site = doc.hosts.find((h) => (h.id as string) === (a.host as string))?.site as string | undefined;
  const sc = model.scale;
  const segments = hostBands(tr.epochs, a.host as string, site, sc.t0, sc.t1).map<TimelineSegment>((b, i) => {
    const labels = b.down === null ? ['Host up', 'Up']
      : b.down === 'crashed' ? ['Down — host has crashed', 'Down']
        : ['Down — the whole data centre is down', 'Down'];
    const x = Math.max(sc.plotL, sc.x(b.t0));
    const w = Math.min(sc.plotR, sc.x(b.t1)) - x;
    return {
      key: `apphost:${i}`, t0: b.t0, t1: b.t1, x: Math.round(x * 10) / 10, w: Math.round(Math.max(0, w) * 10) / 10,
      state: b.down === null ? 'up' : 'down',
      phase: b.down === null ? 'b-sl' : 'b-hatch', ink: b.down === null ? 'f-sl' : 'f-rd',
      labels, label: fitLabel(labels, w), lx: Math.round((x + w / 2) * 10) / 10, title: `${a.name}'s host — ${labels[0]}`, open: false,
    };
  });
  return {
    key: `application-host:${a.id as string}`, kind: 'application', id: a.id as string, group: 'app',
    name: a.name, sub: 'the host\'s own up and down, from the events', indent: 0, y: 0, height: TL_FULL.laneH, glyph: null, owner: null, mark: null, segments,
  };
}

function Lanes({ run, fr }: { run: RunTimeline | null; fr: Frame }) {
  const { width, cardX, plotL, skeleton } = fr;
  const model = run?.model ?? null;
  const doc = topology.value;
  const geo = geometry.value;
  const snap = frame.value;
  const tr = trace.value;
  const t = tNow.value;
  const at = snapT(t);
  const sel = selection.value;
  const isPlaying = playing.value;
  const view = useHostWindow();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLElement | null>(null);
  /* The settings are a column beside the lanes when the section has the room, else a row above
     them. Decided by the section's width, never the body's: the column takes width from the body,
     so a decision made on the body would flip itself. Until it is measured the column is assumed. */
  const [measureSection, sectionW] = useWidth(SETTINGS_COLUMN_MIN_W);
  const settings = tuneLayoutFor(sectionW);

  const plotR = model?.scale.plotR ?? width - TL_FULL.padR;
  const scale = useMemo(() => model?.scale ?? steadyScale(plotL, plotR), [model, plotL, plotR]);
  const ticks = useMemo(() => {
    if (model) return model.ticks;
    const out: { t: number; x: number; label: string }[] = [];
    for (let v = STEADY_T0; v <= STEADY_T1 + 1e-9; v += STEADY_STEP) out.push({ t: v, x: scale.x(v), label: String(v) });
    return out;
  }, [model, scale]);
  /* Each application's card shows its own host's up and down: one lane apiece. */
  const hostLanes = useMemo(() => {
    const out = new Map<string, TimelineLane>();
    if (model && tr) for (const a of applicationsOf(doc)) out.set(a.id as string, hostLaneFor(tr, doc, model, a));
    return out;
  }, [model, tr, doc]);

  /* ---- rows and their heights ---- */
  const layout = useMemo<Layout>(() => {
    const sk = skeleton;
    const top = model ? TOP_RUN : TOP_EMPTY;
    const empty: Layout = { top, rows: [], headers: [], appHeads: [], appLanes: [], gapY: [], bottom: top };
    if (!sk) return empty;

    /* A marker's sentence sits in the gap above its lane. Between the members
       the gap is already tall enough for one (and for a pill); the application's
       own lanes have no pills, so they are packed and open up only for a sentence. */
    const above = new Set<string>();
    for (const m of model?.markers ?? []) {
      if (m.kind === 'event' || m.kind === 'abort' || m.laneKey === null) continue;
      above.add(m.laneKey);
    }

    let y = top;
    const rows: Row[] = [];
    const headers: Layout['headers'] = [];
    sk.groups.forEach((g, gi) => {
      if (gi > 0) y += DC_GAP;
      headers.push({ site: g.site, name: g.name, y, down: siteIsDown(doc, g.site, snap) });
      y += HDR;
      g.rows.forEach((r, i) => {
        y += i === 0 ? 2 : GAP;
        rows.push({ ...r, y });
        y += RH;
      });
    });
    const gapY = rows.slice(0, -1).map((r, k) => {
      const next = rows[k + 1] as Row;
      return r.site === next.site ? (r.y + RH + next.y) / 2 : r.y + RH + DC_GAP / 2;
    });

    const appHeads: Layout['appHeads'] = [];
    const appLanes: Layout['appLanes'] = [];
    for (const section of model?.appSections ?? []) {
      const lanes = model?.lanes.filter((l) => l.kind === 'application' && l.id === section.id) ?? [];
      if (lanes.length === 0) continue;
      y += DC_GAP;
      appHeads.push({ y, section });
      y += HDR;
      lanes.forEach((lane, i) => {
        y += (i === 0 ? 2 : APP_GAP) + (above.has(lane.key) ? APP_LABEL : 0);
        appLanes.push({ lane, y });
        y += RH;
      });
    }
    return { top, rows, headers, appHeads, appLanes, gapY, bottom: y + 4 };
  }, [skeleton, doc, model, snap]);
  const { top, rows, headers, appHeads, appLanes, gapY, bottom } = layout;

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
        return { ...m, labelY: PIN_L, y0: partition ? top : py - 4, y1: partition ? bottom : py + RH + 4 };
      }
      const mine = m.laneKey === null ? undefined : yOf.get(m.laneKey);
      const theirs = m.laneKey === null ? undefined : laneY.get(m.laneKey);
      if (mine === undefined || theirs === undefined) return m;
      const d = mine - theirs;
      return { ...m, y0: m.y0 + d, y1: m.y1 + d, labelY: m.labelY + d };
    });
  }, [model, rows, appLanes, bottom, top]);
  const braceDy = model ? axisY - model.axisY : 0;
  /* The model leaves ten pixels under its last brace row for its own frame; the view has none. */
  const height = axisY + (model ? model.height - model.axisY - 10 : 40);

  /* The pins stack tighter than the timeline's own (icon over number over the
     playhead's grip), because here they are a band over the rows, not a row of
     their own; the markers and the event drag read the density from the model. */
  const shiftedModel = useMemo<TimelineModel | null>(
    () => (model
      ? { ...model, markers: shifted, laneTop: top + 4, lanesBottom: bottom, axisY, layout: { ...model.layout, iconDy: PIN_ICON_DY, badgeDy: PIN_BADGE_DY } }
      : null),
    [model, shifted, bottom, axisY, top],
  );

  /* ---- playback, and seeking by pressing on the plot ---- */
  usePlayback({
    view, playing: isPlaying, speed: speed.value, tNow: t,
    t0: model?.scale.t0 ?? 0, t1: model?.scale.t1 ?? 0,
    /* Not while the timeline is popped out into a window of its own: that
       window drives the playhead (one loop, or the end would toggle twice). */
    enabled: model !== null && !model.empty && popped.value.timeline === undefined,
    onSeek: (v) => { tNow.value = v; },
    onEnd: () => { playing.value = !playing.value; },
  });
  const seek = useRef<{ pointer: number } | null>(null);
  const seeked = useRef(false);
  const tAt = (e: JSX.TargetedPointerEvent<SVGSVGElement>, strict: boolean): number | null => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return null;
    const x = (e.clientX - box.left) * (width / box.width);
    if (strict && (x < scale.plotL - 4 || x > scale.plotR + 4)) return null;
    return Math.round(scale.clampT(scale.tAt(x)) * 10) / 10;
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
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const nameOf = (key: string): string => { const r = byId.get(key); return r ? nameOfRow(r) : key; };

  /* ---- the links at this instant ---- */
  const links = useMemo(() => {
    const graph = redoGraph.value;
    return geo && graph ? buildLinks(doc, graph, geo, snap) : [];
  }, [doc, geo, snap]);
  const placed = useMemo<Placed[]>(() => {
    const byLink = new Map(links.map((l) => [l.id, l]));
    return (skeleton?.placed ?? []).map((p) => ({ ...p, link: byLink.get(p.link.id) ?? p.link }));
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
  const tipOf = (l: CanvasLink): string => `${linkSaid(l, at, nameOf)}. ${l.title}`;
  const onPill = (plan: PillPlan, trigger: SVGGElement): void => {
    const subjects = plan.links.flatMap((l) => (l.docLink === undefined ? [] : [{ key: l.docLink, title: linkName(l, nameOf) }]));
    if (subjects.length > 0) openMenu(plan.key, subjects, trigger);
  };

  const onPlotMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const text = tipFromEvent(e.target);
    if (text === null) { if (tip !== null) setTip(null); return; }
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const dim = (id: string): boolean => related !== null && !related.has(id);
  const laneSelected = (id: string): boolean => sel.includes(id);
  const laneOf = (r: Row): TimelineLane | null => {
    if (r.kind === 'application') return hostLanes.get(r.id) ?? null;
    return r.laneKey === null ? null : model?.lanes.find((l) => l.key === r.laneKey) ?? null;
  };
  const caption = model?.caption;
  /* The same gate as the event drag's on the shell (shell-props.ts): tuning is Simulate's, on a screen that edits. */
  const tunable = mode.value === 'break' && canEdit(viewport.value);
  const steadyX = scale.x(scale.clampT(t));
  /* The ends of the clocks that are one setting each: a grip on the brace and, where a lane's band is that clock, on the lane. */
  const handles = useTuneHandles(tunable && tr !== null && model !== null, doc, tr as Trace, model as TimelineModel);

  return (
    <section class="ln-view float-card" aria-label="Simulate: topology and timeline" ref={(el) => { section.current = el; measureSection(el); }}>
      <LanesBar run={run} />
      <SummaryBand />
      {settings === 'row' ? <TuneStrip /> : null}

      <div class="ln-main">
        {settings === 'column' ? <TuneStrip layout="column" /> : null}
      <div
        class="ln-body"
        ref={(el) => { body.current = el; fr.measure(el); }}
      >
        {geo === null ? (
          <p class="ln-note ln-pad">Nothing to draw: the configuration has no valid redo graph.</p>
        ) : (
          <>
            {/* What holds still while the rows scroll: the run in a sentence, then the
                clock -- its ticks, the outage over them and what the buttons are aimed at. */}
            <div class="ln-head">
              <RunHeadline
                caption={caption ?? STEADY_CAPTION}
                equation={tunable && tr && model ? equationOf(doc, tr, model.braces) : null}
                {...(tunable ? { onTune: applyTune } : {})}
              />
              <svg class="tl-svg ln-svg ln-ticks" width={width} height={HEAD_H} viewBox={`0 0 ${width} ${HEAD_H}`} role="group" aria-label="The clock">
                <g class="ln-when">
                  <title>The event buttons act at the playhead. Move the playhead to add an event later.</title>
                  <text class="ln-when-t" x={cardX} y={11}>Events at t = {fmt(at)} s</text>
                  <text class="ln-when-s" x={cardX} y={22}>the buttons act at the playhead</text>
                </g>
                {ticks.map((tk) => (
                  <text key={`t${tk.t}`} class="t-tick t-mono" x={tk.x} y={10} text-anchor="middle">{tk.label}</text>
                ))}
                {model?.topBrace ? <TopBrace {...model.topBrace} y={HEAD_H - 2} /> : null}
              </svg>
            </div>
            <div class="tl-plot ln-plot" onPointerMove={onPlotMove} onPointerLeave={() => setTip(null)}>
              <svg
                class="tl-svg ln-svg is-seekable"
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                role="group"
                aria-label="Members and their timelines"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                <Defs />

                {model && model.preZone.w > 0 ? (
                  <rect class="prezone" x={model.preZone.x} y={top} width={model.preZone.w} height={bottom - top} />
                ) : null}
                {ticks.map((tk) => (
                  <line key={`g${tk.t}`} class="gridline" x1={tk.x} y1={top} x2={tk.x} y2={axisY} />
                ))}
                {model?.preZone.label ? (
                  <text class="t-tick" x={model.scale.plotL + 6} y={top + 19}>{model.preZone.label}</text>
                ) : null}
                {model ? null : (
                  <g class="ln-empty">
                    {rows.map((r) => (
                      <rect key={`e${r.key}`} class="ln-track" x={plotL} y={r.y} width={Math.max(0, plotR - plotL)} height={RH} rx={3} />
                    ))}
                  </g>
                )}

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
                        <text x={cardX + 8} y={h.y + 13}>{h.name}{h.down ? ' — down' : ''}</text>
                      </g>
                      <line x1={cardX + CW + 6} y1={h.y + 8} x2={plotR} y2={h.y + 8} />
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
                      {lane && model ? (
                        <Lane
                          lane={{ ...lane, y: r.y }}
                          model={model}
                          selected={laneSelected(r.id)}
                          onSelect={selectLane}
                        />
                      ) : null}
                    </g>
                  );
                })}

                {appHeads.map(({ y, section }) => (
                  <g class="ln-apphead" key={`apphead:${section.id}`}>
                    <g class="ln-dc">
                      <rect x={cardX} y={y} width={CW} height={HDR - 2} rx={4} />
                      <text x={cardX + 8} y={y + 13}>
                        {appHeads.length > 1 ? elide(section.title, 26) : 'Application’s view'}
                      </text>
                    </g>
                    <AppHead section={section} x={plotL + 6} right={plotR} y={y + 13} />
                  </g>
                ))}
                {appLanes.map(({ lane, y }) => (
                  <g key={lane.key} class={`ln-row${dim(lane.id) ? ' is-dim' : ''}`}>
                    <Lane lane={{ ...lane, y }} model={model as TimelineModel} selected={laneSelected(lane.id)} onSelect={selectLane} />
                    <text class="ln-alab" x={cardX + CW - 8} y={y + 17} text-anchor="end">{lane.name}</text>
                    <text class="ln-asub" x={cardX + CW - 8} y={y + 30} text-anchor="end">{elide(lane.sub, 34)}</text>
                  </g>
                ))}

                {ticks.map((tk) => (
                  <text key={`b${tk.t}`} class="t-tick t-mono" x={tk.x} y={axisY + 15} text-anchor="middle">{tk.label}</text>
                ))}
                <line class="ax" x1={scale.plotL} y1={axisY} x2={scale.plotR} y2={axisY} />
                <text class="t-tick t-mono" x={scale.plotR} y={axisY + 28} text-anchor="end">{model ? model.axisLabel : 'seconds'}</text>
                {model?.zeroNote ? (
                  <text class="t-tick" x={model.scale.plotL} y={axisY + 28}>{model.zeroNote}</text>
                ) : null}
                {model ? model.braces.map((b) => <Brace key={b.key} brace={{ ...b, y: b.y + braceDy }} />) : null}

                <Links
                  placed={placed} pills={pills} rows={rows} gapY={gapY} cardX={cardX}
                  related={related} hoverId={hoverId} openKey={menuKey} tipOf={tipOf} nameOf={nameOf} onOpen={onPill}
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
                        key={m.key} marker={m} model={shiftedModel} doc={doc} readout="beside"
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
                    {handles.map((hd) => {
                      const row = hd.laneKey === null ? undefined : rows.find((r) => r.laneKey === hd.laneKey);
                      const own = row === undefined ? undefined : shiftedModel.lanes.find((l) => l.key === hd.laneKey);
                      const start = () => { setTip(null); if (isPlaying) playing.value = false; };
                      return (
                        <Fragment key={hd.key}>
                          <TuneDrag key={`${hd.key}:brace`} handle={hd} where="brace" x={hd.x} y={hd.braceY + braceDy - 6} h={14}
                            model={shiftedModel} onTune={applyTune} onStart={start} />
                          {row === undefined || own === undefined ? null : (
                            <TuneDrag key={`${hd.key}:lane`} handle={hd} where="lane" x={hd.x}
                              y={row.y + shiftedModel.layout.barDy} h={own.height - shiftedModel.layout.barPad}
                              model={shiftedModel} onTune={applyTune} onStart={start} />
                          )}
                        </Fragment>
                      );
                    })}
                  </>
                ) : (
                  /* No run: the playhead is a rule at the clock's reading, seeked by pressing the plot. */
                  <g class="tl-playhead ln-steady-ph" transform={`translate(${steadyX},0)`}>
                    <line class="tl-playhead-ln" x1={0} y1={top - 10} x2={0} y2={axisY} />
                    <path class="tl-playhead-grip" d="M-6,-11 L6,-11 L6,-2 L0,4 L-6,-2 z" transform={`translate(0,${top - 10})`} />
                    <rect class="tl-playhead-badge" x={6} y={top - 22} width={54} height={16} rx={2} />
                    <text class="tl-playhead-t t-mono" x={10} y={top - 10}>{`t = ${fmt(scale.clampT(t))}`}</text>
                  </g>
                )}
              </svg>
              <Tooltip tip={tip} />
            </div>
          </>
        )}
      </div>
      </div>
      {menu === null ? null : (
        <MoreMenu key={menuKey ?? ''} target={menu} doc={doc} t={t} view={section.current} onClose={closeMenu} />
      )}
      <span class="sr">t = {fmt(t)} s</span>
    </section>
  );
}
