/**
 * `buildTimeline` -- the pure model behind the timeline drawing (ui.md SS5).
 *
 * The component in `Timeline.tsx` maps this model to VNodes and does nothing
 * else: every number, every class and every string is decided here, so the
 * drawing is testable without a DOM and the same model can be rendered at a
 * pinned scale for the static figures in `diagrams/`.
 *
 * Three things are ported rather than reinvented, because the published
 * fragment is the accuracy baseline:
 *   - `approxW` / `fitLabel`, the label ladder (fragment lines 3359-3365),
 *   - `packBraces`, the brace row packing (fragment lines 3750-3766),
 *   - the segment, brace and caption wording, copied phrase for phrase from
 *     `simulator/fsfo-simulator.html` so no new claim enters through a redraw.
 */

import {
  computeApp, findHost, findLink, findMember, findObserver, findSite, isDatabase, isFarSync,
  pickTickStep, pingSet, resolveRedoGraph, sortEvents,
} from '@/engine';
import type {
  AnyState, AppModel, DerivedFacts, EngineFacts, Finding, Lane as EngineLane, HostId, LinkId,
  MemberId, Member, ObserverId, Seconds, SiteId, TimedEvent, TopologyDoc, Trace,
} from '@/engine';
import { eventIcon } from '../common/eventIcons';
import { appLanes } from './app-lanes';
import type { EventIconName } from '../common/eventIcons';

/* ---------------- geometry ---------------- */

/**
 * Lane 38 + 10 gap and a 132 px gutter (ui.md SS5). The rest of the ladder is
 * the fragment's `G`, which the shell's `lanes * 48 + 120` height budget is
 * derived from.
 */
export const TL = {
  gutter: 132,
  padR: 30,
  /** The caption baseline above the drawing. */
  topY: 16,
  /** The total-outage brace above the lanes. */
  braceY: 42,
  /**
   * Event marker labels. The row above them carries each injected event's
   * icon over its number badge (`iconDy`), so the lanes start lower than the
   * fragment's 80 to leave that row room.
   */
  markY: 108,
  laneTop: 116,
  /**
   * The number badge's centre, this far above `markY`: high enough that the
   * badge clears the cap height of the label beside it, which starts at the
   * marker's x and so runs under a badge that was shifted right.
   */
  badgeDy: 26,
  /** The icon chip's centre, this far above `markY`. */
  iconDy: 50,
  laneH: 38,
  laneGap: 10,
  /**
   * Extra room in the one lane gap a marker label lands in.
   *
   * "Initiates failover at t = 30 s" belongs beside the observer lane it is
   * about, and a 10 px gap is not a row: an 11 px sentence printed there runs
   * over the band above it. The gap that carries a label is opened by this
   * much and no other gap is, because the dock is already the tallest thing
   * on the page.
   */
  markRow: 16,
  /** Gutter text is right-aligned this far in from the plot edge. */
  gutterPad: 14,
  axisGap: 24,
  braceGap: 34,
  braceRow: 50,
  /** Cascaded standbys sit one indent right of their cascader. */
  indent: 10,
  /** The room over the application's three lanes, for the line that heads them. */
  appHead: 34,
} as const;

/** The static figures' scale: `x(t) = 280 + 10 * t`, domain -14 s .. +80 s. */
export const PINNED = {
  width: 1200,
  pxPerSecond: 10,
  xAtZero: 280,
  t0: -14,
  t1: 80,
  plotL: 140,
  plotR: 1080,
  tickStep: 10,
} as const;

/* ---------------- label fitting (ported) ---------------- */

/** Fragment line 3359, unchanged: no `getComputedTextLength` anywhere. */
export function approxW(s: string, size: number, mono = false): number {
  return String(s).length * size * (mono ? 0.6 : 0.53);
}

/** Fragment lines 3362-3365: first candidate that fits, else null. */
export function fitLabel(cands: readonly string[], w: number): string | null {
  for (const c of cands) if (approxW(c, 11) + 14 <= w) return c;
  return null;
}

/**
 * The gutter subtitle ladder. Same shape as `fitLabel`, but measured at the
 * subtitle's own 10 px and with the tighter padding a right-aligned label in a
 * fixed gutter needs -- measuring it at the bar label's 11 px would throw away
 * forms that fit perfectly well.
 */
export function fitSub(cands: readonly string[], w: number): string | null {
  for (const c of cands) if (approxW(c, 10) + 4 <= w) return c;
  return null;
}

/** Fragment lines 3345-3351: English decimals, at most two places. */
export function fmt(n: number): string {
  if (!isFinite(n)) return '—';
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return Math.round(n * 10) / 10 === r ? r.toFixed(1) : r.toFixed(2);
}

/** A real minus sign, so the negative ticks line up with the positive ones. */
export const signed = (n: number): string => fmt(n).replace(/^-/, '−');

const r1 = (n: number): number => Math.round(n * 10) / 10;

/* ---------------- the model ---------------- */

export type PhaseClass = 'b-tl' | 'b-bl' | 'b-am' | 'b-sl' | 'b-vi' | 'b-hatch';
export type InkClass = 'f-tl' | 'f-bl' | 'f-am' | 'f-sl' | 'f-vi' | 'f-rd';
export type LaneGroup = 'primary' | 'observer' | 'farsync' | 'standby' | 'link' | 'app';

export interface TimelineScale {
  t0: Seconds;
  t1: Seconds;
  plotL: number;
  plotR: number;
  plotW: number;
  pxPerSecond: number;
  /** `x(t) = xAtZero + pxPerSecond * t` -- one linear form, pinned or not. */
  x(t: Seconds): number;
  /** The inverse, for the scrubber. */
  tAt(x: number): Seconds;
  /** Clamp a time into the drawn window. */
  clampT(t: Seconds): Seconds;
}

export interface TimelineSegment {
  key: string;
  t0: Seconds;
  t1: Seconds;
  x: number;
  w: number;
  state: AnyState;
  phase: PhaseClass;
  ink: InkClass;
  /** Longest form first; `label` is the one that fits, `title` the tooltip. */
  labels: string[];
  label: string | null;
  title: string;
  /** An engine band with no documented end (environment-dependent). */
  open: boolean;
}

export interface TimelineLane {
  key: string;
  kind: 'member' | 'observer' | 'link' | 'application';
  id: string;
  group: LaneGroup;
  /** db_unique_name, observer name, link name -- always rendered mono. */
  name: string;
  /** The gutter subtitle, already fitted to the gutter. */
  sub: string;
  indent: number;
  y: number;
  height: number;
  segments: TimelineSegment[];
}

export interface TimelineTick {
  t: Seconds;
  x: number;
  label: string;
}

export type MarkerGlyph = 'cross' | 'diamond' | 'dot' | 'line' | 'partition';

export interface TimelineMarker {
  key: string;
  kind: 'event' | 'decision' | 'open' | 'abort' | 'app';
  glyph: MarkerGlyph;
  t: Seconds;
  x: number;
  /** 1-based injected-event number, null for derived marks. */
  index: number | null;
  tone: InkClass;
  stroke: 'm-rd' | 'm-vi' | 'm-tl' | 'partition';
  label: string;
  /** Longest label that still fits to the right; null when nothing fits. */
  labelAnchor: 'start' | 'end';
  labelX: number;
  labelY: number;
  /**
   * False when the label would sit on top of another injected event's label
   * (two events at one instant): the number and the tooltip still carry it,
   * and the Break rail lists it in full.
   */
  showLabel: boolean;
  /** Where the number badge sits -- shifted right when several events share an x. */
  nx: number;
  /** The injected event's icon, drawn over its badge; null for derived marks. */
  icon: EventIconName | null;
  y0: number;
  y1: number;
  laneKey: string | null;
}

export interface BraceInput {
  key: string;
  a: Seconds;
  b: Seconds;
  tone: 'br-am' | 'br-bl' | 'br-rd' | 'br-sl';
  mono: boolean;
  name: string;
  val: string;
}

export interface TimelineBrace extends BraceInput {
  x0: number;
  x1: number;
  row: number;
  /** Label centre after the row packing slid it inside the drawing. */
  lx: number;
  y: number;
}

export interface LegendEntry {
  swatch: 'lg-tl' | 'lg-bl' | 'lg-am' | 'lg-rd' | 'lg-vi' | 'lg-sl';
  label: string;
}

export interface TimelineCaption {
  text: string;
  tone: 'ink' | InkClass;
  /** Centred over the interval it measures, the way the fragment does it. */
  x: number | null;
  anchor: 'start' | 'middle';
}

export interface TimelineModel {
  width: number;
  height: number;
  scale: TimelineScale;
  lanes: TimelineLane[];
  ticks: TimelineTick[];
  markers: TimelineMarker[];
  braces: TimelineBrace[];
  legend: LegendEntry[];
  caption: TimelineCaption;
  /** The brace above the lanes, drawn when a total outage is measurable. */
  topBrace: { x0: number; x1: number; y: number; tone: 'br-sl' | 'br-rd' } | null;
  /** Distinct state-change times, for the transport's step buttons. */
  stateChanges: Seconds[];
  laneTop: number;
  lanesBottom: number;
  axisY: number;
  braceTop: number;
  /** The pre-failure band, and its label when the band is wide enough. */
  preZone: { x: number; w: number; label: string | null };
  axisLabel: string;
  zeroNote: string | null;
  /** No events injected: the drawing says so rather than showing nothing. */
  empty: boolean;
  /** Link lanes left out because nothing happened on them. */
  quietLinks: number;
  pinned: boolean;
  /**
   * The line that heads the application's lanes: what they are, and the one
   * reading the three of them add up to. Null when the document draws no
   * application, or the view left its lanes out.
   */
  appSection: {
    y: number;
    title: string;
    note: string;
    tone: 'ink' | InkClass;
    /** What the numbers rest on: this page's model, said in the tooltip. */
    basis: string;
  } | null;
}

export interface TimelineView {
  /** Available width in CSS pixels; ignored when `pinnedScale` is set. */
  width: number;
  /** Export mode: reproduce `x(t) = 280 + 10 * t` for the static figures. */
  pinnedScale?: boolean;
  /** Preserve the editing viewport after dropping an event. */
  axis?: { t0: Seconds; t1: Seconds };
  /** Lane id to render as selected. */
  selection?: string | null;
  /**
   * Network links get a lane only when something happened to them
   * ('auto', the default): a link that stayed up all along would otherwise
   * treble the height of the classic 1+1+1 drawing to say nothing. The count
   * of the lanes left out is reported as `quietLinks`, so the omission is
   * stated rather than silent.
   */
  links?: 'auto' | 'always' | 'never';
  /** The application's lanes under the configuration's; drawn unless false. */
  app?: boolean;
}

/* ---------------- scale ---------------- */

/**
 * The nice ladder the pre-roll snaps to. `snapNice` rounds *up* so a 30 s
 * horizon still gets a visible steady-state band, and stops at 300 s so the
 * 900 s horizon does not spend a sixth of its width on nothing happening.
 */
const NICE = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 150, 300];

export function snapNice(v: number): number {
  for (const n of NICE) if (v <= n + 1e-9) return n;
  return NICE[NICE.length - 1] as number;
}

const clampNum = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function makeScale(t0: Seconds, t1: Seconds, plotL: number, plotR: number): TimelineScale {
  const plotW = plotR - plotL;
  const pxPerSecond = plotW / (t1 - t0);
  const xAtZero = plotL - t0 * pxPerSecond;
  return {
    t0, t1, plotL, plotR, plotW, pxPerSecond,
    x: (t) => xAtZero + pxPerSecond * t,
    tAt: (x) => (x - xAtZero) / pxPerSecond,
    clampT: (t) => clampNum(t, t0, t1),
  };
}

/**
 * The last moment worth drawing: an event, a segment edge or a derived clock.
 *
 * Exported because the playhead lands here after an injection (ui/break/events)
 * -- the horizon and the resting place of the playhead have to be the same
 * reading of the run, or the drawing would settle at a moment the axis calls
 * uninteresting.
 */
/**
 * The application's model for a run, computed once per trace: the axis, the
 * readout and the lanes all ask for it, and a scrub asks on every frame.
 */
const appModels = new WeakMap<Trace, { doc: TopologyDoc; model: AppModel }>();

export function appModelFor(trace: Trace, doc: TopologyDoc): AppModel | null {
  if (doc.application === undefined) return null;
  const hit = appModels.get(trace);
  if (hit && hit.doc === doc) return hit.model;
  const model = computeApp(doc.client, trace, doc);
  appModels.set(trace, { doc, model });
  return model;
}

/**
 * When the application's own story ends: the reconnect, or the string giving
 * up. Capped the way the Configure panel caps it, so a retry budget of an hour
 * does not flatten the failover into the first pixel of the axis.
 */
function appEnd(trace: Trace, doc: TopologyDoc | undefined): Seconds | null {
  const ap = doc === undefined ? null : appModelFor(trace, doc);
  if (ap === null || ap.noEvent) return null;
  const end = ap.tConn ?? ap.gaveUp;
  if (end === null) return null;
  return Math.min(end, Math.max(160, (ap.tService ?? 0) + 100));
}

export function lastInterestingT(
  trace: Trace, events: readonly TimedEvent[], doc?: TopologyDoc,
): Seconds {
  let last = appEnd(trace, doc) ?? 0;
  for (const e of events) last = Math.max(last, e.at);
  for (const lane of trace.lanes) {
    for (const s of lane.segments) {
      last = Math.max(last, s.t0);
      if (s.t1 !== null) last = Math.max(last, s.t1);
    }
  }
  const f = trace.facts;
  for (const v of [f.initiateAt, f.execStartAt, f.tOpen, f.abortAt]) {
    if (v !== null && v !== undefined) last = Math.max(last, v);
  }
  return last;
}

/**
 * The two ends of the seconds axis a live run is drawn on: the last
 * interesting moment plus a margin (never shorter than 30 s, never longer
 * than 15 minutes), and a snapped pre-roll before zero.
 *
 * Exported because the axis is not the timeline's private business. Anything
 * that prints or accepts a playhead reading has to clamp to the same two ends,
 * or the page shows two clocks for one instant -- the readout strip said
 * "Drawing at t = 500 s" while the badge on the playhead said "t = 51.75",
 * because only one of them clamped. One formula, one axis.
 */
export function axisSpan(
  trace: Trace, events: readonly TimedEvent[], doc?: TopologyDoc,
): { t0: Seconds; t1: Seconds } {
  const t1 = clampNum(1.15 * lastInterestingT(trace, events, doc), 30, 900);
  return { t0: -snapNice(0.15 * t1), t1 };
}

/** `axisSpan`'s clamp, for anything that only has to hold a reading on the axis. */
export const clampToAxis = (
  t: Seconds, trace: Trace, events: readonly TimedEvent[], doc?: TopologyDoc,
): Seconds => {
  const { t0, t1 } = axisSpan(trace, events, doc);
  return clampNum(t, t0, t1);
};

/* ---------------- lane ordering ---------------- */

type Facts = DerivedFacts & Partial<Omit<EngineFacts, keyof DerivedFacts>>;

interface LaneSeed {
  engine: EngineLane | null;
  kind: 'member' | 'observer' | 'link';
  id: string;
  group: LaneGroup;
  name: string;
  subs: string[];
  indent: number;
  initial: AnyState;
}

function memberSub(doc: TopologyDoc, m: Member, isPrimary: boolean): string[] {
  if (isFarSync(m)) return ['far sync instance', 'far sync'];
  if (isPrimary) return ['production database', 'primary'];
  const target = doc.config.fsfo.target;
  const isTarget = doc.config.fsfo.state !== 'disabled' &&
    (target.kind === 'ANY' || target.members.includes(m.id));
  if (isTarget) return ['failover target', 'target'];
  if (m.role === 'logical') return ['logical standby', 'logical'];
  if (m.role === 'snapshot') return ['snapshot standby', 'snapshot'];
  return ['physical standby', 'standby'];
}

/** Ported from the fragment's `obsSub`: the observer's lane says where it runs. */
function observerSub(doc: TopologyDoc, hostId: HostId): string[] {
  const host = findHost(doc, hostId);
  const name = host?.name ?? String(hostId);
  return [`DGMGRL, ${name}`, name];
}

function initialMemberState(m: Member, isPrimary: boolean): AnyState {
  if (isFarSync(m)) return 'receiving';
  if (!m.enabled) return 'disabled';
  if (isPrimary) return 'open-rw';
  if (!m.applyRunning) return 'mounted-noapply';
  return m.openMode === 'read-only-adg' ? 'open-ro' : 'mounted-apply';
}

function initialObserverState(doc: TopologyDoc, id: ObserverId): AnyState {
  const o = findObserver(doc, id);
  if (!o || !o.running) return 'stopped';
  if (doc.config.fsfo.state === 'observe-only') return 'observe-only';
  return o.role === 'master' ? 'master' : 'backup';
}

/**
 * Lane order (ui.md SS5): primary, then observers (master first, then by name;
 * plain alphabetical when fast-start failover is disabled, because then no
 * observer is the master), then far syncs, then standbys in BFS order over the
 * resolved redo graph, cascaded ones indented.
 */
function orderLanes(
  trace: Trace, doc: TopologyDoc, links: 'auto' | 'always' | 'never',
): { seeds: LaneSeed[]; quietLinks: number } {
  const byKey = new Map<string, EngineLane>();
  for (const l of trace.lanes) byKey.set(`${l.subject.kind}:${l.subject.id}`, l);

  const primaryId = trace.epochs[0]?.primary ?? null;
  const graph = trace.epochs[0]?.redo ??
    (primaryId ? resolveRedoGraph(doc, { primary: primaryId }) : null);
  const depthOf = (id: MemberId): number => {
    const r = graph?.members[id];
    return r && r.depth >= 0 ? r.depth : Number.POSITIVE_INFINITY;
  };

  const seeds: LaneSeed[] = [];
  const push = (
    kind: 'member' | 'observer' | 'link', id: string, group: LaneGroup,
    name: string, subs: string[], indent: number, initial: AnyState,
  ): void => {
    seeds.push({ engine: byKey.get(`${kind}:${id}`) ?? null, kind, id, group, name, subs, indent, initial });
    byKey.delete(`${kind}:${id}`);
  };

  /* 1. the primary */
  const primary = primaryId ? findMember(doc, primaryId) : undefined;
  if (primary) {
    push('member', primary.id as string, 'primary', primary.name,
      memberSub(doc, primary, true), 0, initialMemberState(primary, true));
  }

  /* 2. observers -- master first, unless nothing makes one the master */
  const fsfoOn = doc.config.fsfo.state !== 'disabled';
  const observers = [...doc.observers].sort((a, b) => {
    if (fsfoOn) {
      const am = a.role === 'master' ? 0 : 1;
      const bm = b.role === 'master' ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    return a.name.localeCompare(b.name, 'en');
  });
  for (const o of observers) {
    push('observer', o.id as string, 'observer', o.name,
      observerSub(doc, o.host), 0, initialObserverState(doc, o.id));
  }

  /* 3. far syncs, then 4. standbys in BFS order */
  const rest = doc.members.filter((m) => m.id !== primaryId);
  const cmp = (a: Member, b: Member): number =>
    depthOf(a.id) - depthOf(b.id) || a.name.localeCompare(b.name, 'en');
  for (const m of rest.filter(isFarSync).sort(cmp)) {
    push('member', m.id as string, 'farsync', m.name, memberSub(doc, m, false), 0, 'receiving');
  }
  for (const m of rest.filter((x) => !isFarSync(x)).sort(cmp)) {
    const d = depthOf(m.id);
    const indent = isFinite(d) ? Math.max(0, d - 1) * TL.indent : 0;
    push('member', m.id as string, 'standby', m.name,
      memberSub(doc, m, false), indent, initialMemberState(m, false));
  }

  /* 5. whatever the trace drew that the document does not place: links */
  let quietLinks = 0;
  for (const [, l] of byKey) {
    const id = l.subject.id;
    const quiet = l.segments.length <= 1 && (l.segments[0]?.state ?? 'up') === 'up';
    if (links === 'never' || (links === 'auto' && quiet)) { quietLinks++; continue; }
    const link = l.subject.kind === 'link' ? findLink(doc, id as LinkId) : undefined;
    const ends = link ? linkEnds(doc, link.id) : String(id);
    seeds.push({
      engine: l, kind: l.subject.kind, id, group: 'link',
      name: String(id), subs: [ends, 'network link', 'link'], indent: 0, initial: 'up',
    });
  }
  return { seeds, quietLinks };
}

/* ---------------- state -> look and wording ---------------- */

interface Look {
  phase: PhaseClass;
  ink: InkClass;
  labels: string[];
}

/**
 * Every phrase here is the published fragment's, kept word for word: the
 * drawing may be rebuilt, but nothing it says about Oracle is re-worded.
 */
function look(state: AnyState, group: LaneGroup, ctx: { pingSet: boolean }): Look {
  const primary = group === 'primary';
  switch (state) {
    case 'open-rw':
      return { phase: 'b-tl', ink: 'f-tl', labels: primary
        ? ['Open read-write — shipping redo', 'Shipping redo', 'Open']
        : ['Open read-write — the new primary', 'Open read-write', 'Open'] };
    case 'open-ro':
      return { phase: 'b-bl', ink: 'f-bl', labels: ['Open read-only — applying redo', 'Open read-only', 'Read-only'] };
    case 'mounted-apply':
      return { phase: 'b-bl', ink: 'f-bl', labels: ['Applying redo', 'Applying'] };
    case 'mounted-noapply':
      return { phase: 'b-sl', ink: 'f-sl', labels: ['Mounted — redo apply is stopped', 'Apply stopped', 'Mounted'] };
    case 'stalled':
      return { phase: 'b-hatch', ink: 'f-rd', labels: ['STALLED — redo generation halted', 'STALLED'] };
    case 'commit-hang':
      return { phase: 'b-am', ink: 'f-am', labels: ['Commits wait for an acknowledgement', 'Commits waiting', 'Waiting'] };
    case 'aborted':
      return { phase: 'b-hatch', ink: 'f-rd', labels: ['Aborted — instance shut itself down', 'Aborted'] };
    case 'converting':
      return { phase: 'b-am', ink: 'f-am', labels: primary
        ? ['Converts, restarts as the new standby, then applies from the new primary',
           'Converts, then restarts as the standby', 'Converting']
        : ['Converts to the primary role', 'Role change'] };
    case 'reinstating':
      return { phase: 'b-am', ink: 'f-am', labels: ['Reinstated as a standby', 'Reinstating'] };
    case 'disabled':
      return { phase: 'b-sl', ink: 'f-sl', labels: ['Disabled in the broker configuration', 'Disabled'] };
    case 'unreachable':
      return { phase: 'b-am', ink: 'f-am', labels: primary
        ? ['Open read-write — serving, but unreachable', 'Open, but unreachable', 'Open']
        : ['Lagging — no redo is arriving from the primary', 'No redo arriving', 'Lagging'] };
    case 'receiving':
      return { phase: 'b-bl', ink: 'f-bl', labels: ['Receiving redo and forwarding it', 'Receiving redo', 'Receiving'] };
    case 'forwarding-stalled':
      return { phase: 'b-am', ink: 'f-am', labels: ['Receiving, but forwarding nothing onward', 'Not forwarding', 'Stalled'] };
    case 'master':
      return { phase: 'b-sl', ink: 'f-sl', labels: ['Pinging primary — connection healthy', 'Pinging primary', 'Pinging'] };
    case 'backup':
      return { phase: 'b-sl', ink: 'f-sl', labels: ['Backup observer — registered, not deciding', 'Backup observer', 'Backup'] };
    case 'stopped':
      return { phase: 'b-hatch', ink: 'f-rd', labels: ['Observer stopped — nobody is watching', 'Observer stopped', 'Stopped'] };
    case 'lost-primary':
      return { phase: 'b-am', ink: 'f-am', labels: ctx.pingSet
        ? ['Ping retries — no answer', 'Ping retries', 'Retries']
        : ['Reconnect attempts — threshold clock running', 'Reconnect attempts', 'Reconnecting'] };
    case 'lost-target':
      return { phase: 'b-am', ink: 'f-am', labels: ['Lost contact with the failover target', 'Lost the target', 'Lost target'] };
    case 'nominating':
      return { phase: 'b-vi', ink: 'f-vi', labels: ['Nominating a new master observer', 'Nominating'] };
    case 'observe-only':
      return { phase: 'b-sl', ink: 'f-sl', labels: ['Observe-only — never initiates a failover', 'Observe-only'] };
    case 'up':
      return { phase: 'b-sl', ink: 'f-sl', labels: ['Link up', 'Up'] };
    case 'down':
      if (group === 'primary') return { phase: 'b-hatch', ink: 'f-rd', labels: ['Down — host has crashed', 'Down'] };
      if (group === 'observer') return { phase: 'b-hatch', ink: 'f-rd', labels: ['Host down — nobody is watching', 'Host down', 'Down'] };
      if (group === 'farsync') return { phase: 'b-hatch', ink: 'f-rd', labels: ['Down — nothing is forwarding redo', 'Down'] };
      if (group === 'link') return { phase: 'b-hatch', ink: 'f-rd', labels: ['Link cut', 'Cut'] };
      return { phase: 'b-hatch', ink: 'f-rd', labels: ['Down — nothing is receiving redo here', 'Down'] };
    default:
      return { phase: 'b-sl', ink: 'f-sl', labels: [String(state)] };
  }
}

/* ---------------- events ---------------- */

const hostName = (doc: TopologyDoc, id: HostId): string => findHost(doc, id)?.name ?? String(id);
const siteName = (doc: TopologyDoc, id: SiteId): string => findSite(doc, id)?.name ?? String(id);
const memberName = (doc: TopologyDoc, id: MemberId): string => findMember(doc, id)?.name ?? String(id);
const observerName = (doc: TopologyDoc, id: ObserverId): string => findObserver(doc, id)?.name ?? String(id);

function linkEnds(doc: TopologyDoc, id: LinkId): string {
  const l = findLink(doc, id);
  if (!l) return String(id);
  const [a, b] = l.ends;
  const nm = (e: string): string => l.scope === 'site'
    ? siteName(doc, e as SiteId)
    : hostName(doc, e as HostId);
  return `${nm(a)} and ${nm(b)}`;
}

/** One sentence per injected event, in the page's own vocabulary. */
export function describeEvent(doc: TopologyDoc, e: TimedEvent): string {
  switch (e.kind) {
    case 'host.down': return `Host ${hostName(doc, e.host)} crashes`;
    case 'host.up': return `Host ${hostName(doc, e.host)} comes back`;
    case 'site.down': return `The whole ${siteName(doc, e.site)} site goes down`;
    case 'site.up': return `${siteName(doc, e.site)} comes back`;
    case 'link.cut': return `The link between ${linkEnds(doc, e.link)} fails`;
    case 'link.heal': return `The link between ${linkEnds(doc, e.link)} is restored`;
    case 'partition': return 'Network partition';
    case 'instance.down': return `Instance ${e.instance} of ${memberName(doc, e.member)} goes down`;
    case 'instance.up': return `Instance ${e.instance} of ${memberName(doc, e.member)} comes back`;
    case 'member.down': return `${memberName(doc, e.member)} goes down`;
    case 'member.up': return `${memberName(doc, e.member)} comes back`;
    case 'observer.stop': return `Observer ${observerName(doc, e.observer)} stops`;
    case 'observer.start': return `Observer ${observerName(doc, e.observer)} starts`;
    case 'cmd.switchover': return `SWITCHOVER TO ${memberName(doc, e.to)}`;
    case 'cmd.failover': return `FAILOVER TO ${memberName(doc, e.to)}`;
    case 'cmd.reinstate': return `REINSTATE DATABASE ${memberName(doc, e.member)}`;
    case 'cmd.setMasterObserver': return `SET MASTEROBSERVER TO ${observerName(doc, e.observer)}`;
    case 'cmd.disableFsfo': return 'DISABLE FAST_START FAILOVER';
    case 'lag.set': {
      const parts: string[] = [];
      if (e.applyLag !== undefined) parts.push(`apply lag ${fmt(e.applyLag)} s`);
      if (e.transportLag !== undefined) parts.push(`transport lag ${fmt(e.transportLag)} s`);
      return `${memberName(doc, e.member)}: ${parts.join(', ') || 'lag unchanged'}`;
    }
    default: return 'Event';
  }
}

/* ---------------- brace packing (ported verbatim) ---------------- */

/**
 * Fragment lines 3750-3766, translated but not changed: the label box is the
 * widest of name, value and span; it is slid inside the drawing; and it drops
 * to the first row where it clears every box already there by 10 px.
 */
export function packBraces(
  braces: readonly BraceInput[], scale: TimelineScale, width: number, braceTop: number,
): { braces: TimelineBrace[]; rowCount: number } {
  const rows: { L: number; R: number }[][] = [];
  let rowCount = 0;
  const out: TimelineBrace[] = [];
  for (const br of braces) {
    const x0 = scale.x(br.a);
    const x1 = scale.x(br.b);
    const mid = (x0 + x1) / 2;
    const w = Math.max(approxW(br.name, 11.5, br.mono), approxW(br.val, 11, true), x1 - x0) + 18;
    let L = mid - w / 2;
    let R = mid + w / 2;
    if (L < 6) { const d = 6 - L; L += d; R += d; }
    if (R > width - 6) { const d = R - (width - 6); L -= d; R -= d; }
    let i = 0;
    for (;;) {
      const row = rows[i];
      if (!row || !row.some((o) => !(R < o.L - 10 || L > o.R + 10))) break;
      i++;
    }
    let row = rows[i];
    if (!row) { row = []; rows[i] = row; }
    row.push({ L, R });
    if (i + 1 > rowCount) rowCount = i + 1;
    out.push({ ...br, x0, x1, row: i, lx: (L + R) / 2, y: braceTop + i * TL.braceRow });
  }
  return { braces: out, rowCount };
}

/* ---------------- braces per outcome (ported) ---------------- */

function buildBraces(doc: TopologyDoc, f: Facts): BraceInput[] {
  const braces: BraceInput[] = [];
  const fsfo = doc.config.fsfo;
  const threshold = fsfo.thresholdSeconds;
  const ping = f.pingSet ?? pingSet(fsfo.pingIntervalMs, fsfo.pingRetry);
  const stalled = f.conditions?.stalled ?? false;

  if (f.outcome === 'switchover' && f.switchover && !f.switchover.blocked) {
    const sw = f.switchover;
    const { at, tDown, tConvertEnd, tOpen, applyRemaining } = sw;
    if (tDown !== null) {
      braces.push({
        key: 'sw-verify', a: at, b: tDown, tone: 'br-am', mono: false,
        name: 'Broker verifies both databases',
        val: `${fmt(tDown - at)} s — nominal, not a broker parameter`,
      });
    }
    if (tDown !== null && tConvertEnd !== null) {
      braces.push({
        key: 'sw-convert', a: tDown, b: tConvertEnd, tone: 'br-rd', mono: false,
        name: 'Primary converts to a standby',
        val: `${fmt(tConvertEnd - tDown)} s — nominal; its sessions end here`,
      });
    }
    if (tConvertEnd !== null && applyRemaining > 0) {
      braces.push({
        key: 'sw-catchup', a: tConvertEnd, b: tConvertEnd + applyRemaining, tone: 'br-bl', mono: false,
        name: 'Catch-up ≈ apply lag at the command',
        val: `${fmt(applyRemaining)} s — illustrative estimate, not a broker parameter`,
      });
    }
    if (tConvertEnd !== null && tOpen !== null) {
      braces.push({
        key: 'sw-role', a: tConvertEnd + applyRemaining, b: tOpen, tone: 'br-am', mono: false,
        name: 'Role change + read-write open',
        val: `${fmt(doc.environment.roleTransitionSeconds)} s — environment-dependent, not a broker parameter`,
      });
    }
    return braces;
  }

  if (f.outcome === 'stall-noone') {
    if (f.abortAt !== null) {
      braces.push({
        key: 'stall-threshold', a: 0, b: f.abortAt, tone: 'br-rd', mono: true,
        name: 'FastStartFailoverThreshold',
        val: `${fmt(threshold)} s — primary stall clock, runs independently`,
      });
    }
    return braces;
  }

  /* Maximum protection shutting the primary down is not a stall, and the
     interval under it is NET_TIMEOUT, never FastStartFailoverThreshold: the
     threshold is a fast-start failover clock and nothing here started one. The
     instant itself -- the last acknowledgement plus NET_TIMEOUT -- is this
     page's model, and the brace says so where it is drawn. */
  if (f.outcome === 'maxprot-shutdown') {
    if (f.abortAt !== null) {
      const netTimeout = f.netTimeoutSeconds ?? 30;
      braces.push({
        key: 'maxprot-shutdown', a: Math.max(0, f.abortAt - netTimeout), b: f.abortAt,
        tone: 'br-rd', mono: true,
        name: 'NET_TIMEOUT',
        val: `${fmt(netTimeout)} s after the last SYNC acknowledgement — this page's model of the instant`,
      });
    }
    return braces;
  }

  if (f.outcome !== 'failover' || f.initiateAt === null) return braces;

  if (ping && f.detectSeconds !== null && f.detectSeconds !== undefined) {
    const iv = fsfo.pingIntervalMs ?? 0;
    const rt = (fsfo.pingRetry ?? 0) + 1;
    braces.push({
      key: 'detect', a: 0, b: f.detectSeconds, tone: 'br-am', mono: true,
      name: 'ObserverPingInterval × (ObserverPingRetry + 1)',
      val: `${fmt(iv)} ms × ${rt} = ${fmt(f.detectSeconds)} s — this page's model; Oracle states only "nearly 1 second"`,
    });
  } else {
    braces.push({
      key: 'threshold', a: 0, b: f.initiateAt, tone: 'br-am', mono: true,
      name: 'FastStartFailoverThreshold',
      val: stalled
        ? `${fmt(threshold)} s — observer clock`
        : `${fmt(threshold)} s — observer reconnect window`,
    });
  }

  if (stalled && f.abortAt !== null) {
    braces.push({
      key: 'abort', a: 0, b: f.abortAt, tone: 'br-rd', mono: true,
      name: 'FastStartFailoverThreshold',
      val: `${fmt(threshold)} s — primary stall clock, runs independently`,
    });
  }

  if (!f.blocked && f.execStartAt !== null && f.tOpen !== null) {
    const netHop = f.netHopSeconds ?? f.execStartAt - f.initiateAt;
    const applyRemaining = f.applyRemainingSeconds ??
      Math.max(0, f.tOpen - f.execStartAt - doc.environment.roleTransitionSeconds);
    if (netHop >= 0.2) {
      braces.push({
        key: 'nethop', a: f.initiateAt, b: f.execStartAt, tone: 'br-sl', mono: false,
        name: 'FAILOVER command in flight',
        val: `${fmt(netHop)} s — one-way network latency`,
      });
    }
    if (applyRemaining > 0) {
      braces.push({
        key: 'recovery', a: f.execStartAt, b: f.execStartAt + applyRemaining, tone: 'br-bl', mono: false,
        name: 'Terminal recovery ≈ apply lag at failure time',
        val: `${fmt(applyRemaining)} s — illustrative estimate, not a broker parameter`,
      });
    }
    braces.push({
      key: 'role', a: f.execStartAt + applyRemaining, b: f.tOpen, tone: 'br-am', mono: false,
      name: 'Role change + read-write open',
      val: `${fmt(doc.environment.roleTransitionSeconds)} s — environment-dependent, not a broker parameter`,
    });
  }
  return braces;
}

/* ---------------- caption (branches on the outcome, never on the event) ---- */

/**
 * The reason a blocked SWITCHOVER is refused, read off the trace -- the engine
 * decides it and records it on the switchover facts; nothing is recomputed
 * here, and nothing is guessed from the wording of a finding.
 */
const REFUSAL_CAPTION: Record<string, string> = {
  'primary-down': 'SWITCHOVER refused — the primary is down',
  'target-down': 'SWITCHOVER refused — the target standby is down',
  'not-connected': 'SWITCHOVER refused — the primary and the target standby cannot reach each other',
  'not-target': 'SWITCHOVER refused — this member is not the pre-specified fast-start failover target',
  'not-synchronized': 'SWITCHOVER refused — the target standby is not synchronized',
  'past-lag-limit': 'SWITCHOVER refused — the target standby is outside FastStartFailoverLagLimit',
};

function switchoverRefusalCaption(f: Facts): string {
  const reason = f.switchover?.refusal;
  return (reason !== undefined ? REFUSAL_CAPTION[reason] : undefined) ?? 'SWITCHOVER refused';
}

function buildCaption(
  doc: TopologyDoc, f: Facts, empty: boolean, findings: readonly Finding[] = [],
): TimelineCaption {
  if (empty) {
    return { text: 'Steady state — no events injected', tone: 'f-sl', x: null, anchor: 'start' };
  }
  const ping = f.pingSet ?? pingSet(doc.config.fsfo.pingIntervalMs, doc.config.fsfo.pingRetry);
  switch (f.outcome) {
    case 'failover':
      if (f.blocked || f.tOpen === null) {
        return {
          text: 'No automatic failover — the primary stays down and the standby stays a standby',
          tone: 'f-rd', x: null, anchor: 'start',
        };
      }
      /* The number is tOpen, so the caption says what tOpen is: the instant
         the new primary is open read-write, measured from the first injected
         event. It is not "the total outage" -- what a client sees starts when
         the primary stopped answering and ends when it reconnects, and neither
         end of that is this number. */
      return {
        text: ping
          ? `New primary open read-write at t = ${fmt(f.tOpen)} s — ping detection + failover execution`
          : `New primary open read-write at t = ${fmt(f.tOpen)} s — threshold + failover execution`,
        tone: 'ink', x: null, anchor: 'middle',
      };
    case 'switchover':
      if (!f.switchover || f.switchover.blocked || f.switchover.downtime === null) {
        return {
          text: switchoverRefusalCaption(f),
          tone: 'f-rd', x: null, anchor: 'start',
        };
      }
      return {
        text: `Read-write downtime ≈ conversion + catch-up + role change  =  ${fmt(f.switchover.downtime)} s`,
        tone: 'ink', x: null, anchor: 'middle',
      };
    case 'stall-noone':
      return {
        text: 'No failover is possible — the observer died with the standby',
        tone: 'f-rd', x: null, anchor: 'start',
      };
    case 'maxprot-shutdown':
      return {
        text: 'MaxProtection shut the primary down — no synchronized standby acknowledged',
        tone: 'f-rd', x: null, anchor: 'start',
      };
    case 'observer-lost':
      return {
        text: 'No automatic failover possible while unobserved — primary and standby carry on',
        tone: 'f-am', x: null, anchor: 'start',
      };
    case 'manual':
      return {
        text: 'No fast-start failover is armed — only a manual FAILOVER TO can promote the standby',
        tone: 'f-am', x: null, anchor: 'start',
      };
    case 'continues':
    default: {
      const c = f.conditions;
      if (c && c.standbyGone) {
        return {
          text: 'The primary keeps serving with no standby — nothing is protecting it now',
          tone: 'f-am', x: null, anchor: 'start',
        };
      }
      if (c && !c.pmyReachable) {
        return {
          text: 'The primary keeps serving, but nothing outside its site can reach it',
          tone: 'f-am', x: null, anchor: 'start',
        };
      }
      return {
        text: 'Both databases keep running and no failover is initiated',
        tone: 'f-sl', x: null, anchor: 'start',
      };
    }
  }
}

export const LEGEND: LegendEntry[] = [
  { swatch: 'lg-tl', label: 'Open read-write' },
  { swatch: 'lg-bl', label: 'Applying redo' },
  { swatch: 'lg-am', label: 'Waiting or recovering' },
  { swatch: 'lg-rd', label: 'Down or stalled' },
  { swatch: 'lg-vi', label: 'Observer decision' },
  { swatch: 'lg-sl', label: 'Monitoring' },
];

/* ---------------- the build ---------------- */

export function buildTimeline(trace: Trace, doc: TopologyDoc, view: TimelineView): TimelineModel {
  const f = trace.facts as Facts;
  const events = sortEvents(doc.events ?? []);
  const pinned = view.pinnedScale === true;

  const width = pinned ? PINNED.width : Math.max(360, Math.round(view.width));
  const plotL = pinned ? PINNED.plotL : TL.gutter;
  const plotR = pinned ? PINNED.plotR : Math.max(plotL + 40, width - TL.padR);

  let t0: Seconds;
  let t1: Seconds;
  let tickStep: Seconds;
  if (pinned) {
    t0 = PINNED.t0;
    t1 = PINNED.t1;
    tickStep = PINNED.tickStep;
  } else {
    ({ t0, t1 } = view.axis ?? axisSpan(trace, events, view.app === false ? undefined : doc));
    tickStep = pickTickStep(t1 - t0);
  }
  const scale = pinned
    ? {
      ...makeScale(t0, t1, plotL, plotR),
      pxPerSecond: PINNED.pxPerSecond,
      x: (t: Seconds) => PINNED.xAtZero + PINNED.pxPerSecond * t,
      tAt: (x: number) => (x - PINNED.xAtZero) / PINNED.pxPerSecond,
    }
    : makeScale(t0, t1, plotL, plotR);

  const ping = f.pingSet ?? pingSet(doc.config.fsfo.pingIntervalMs, doc.config.fsfo.pingRetry);

  /* lanes */
  const { seeds, quietLinks } = orderLanes(trace, doc, view.links ?? 'auto');

  /* Which lane gaps have to hold a marker label, decided before the lanes are
     laid out because it is what moves them. A label sits above the lane it
     belongs to -- the observer's when the failover is initiated, the new
     primary's when it opens -- except the self-abort, which sits under the
     primary's and so needs the gap above the lane after it. */
  const openAt = f.outcome === 'switchover' ? f.switchover?.tOpen ?? null : f.tOpen;
  const onAxis = (t: Seconds | null | undefined): boolean =>
    t !== null && t !== undefined && t >= t0 && t <= t1;
  const observerRow = seeds.findIndex((sd) => sd.group === 'observer');
  const primaryRow = seeds.findIndex((sd) => sd.group === 'primary');
  const newPrimaryRow = f.newPrimary === null
    ? -1
    : seeds.findIndex((sd) => sd.kind === 'member' && sd.id === (f.newPrimary as string));
  const labelRows = new Set<number>();
  if (onAxis(f.initiateAt) && f.outcome === 'failover' && observerRow >= 0) {
    labelRows.add(observerRow);
  }
  if (!f.blocked && onAxis(openAt) && newPrimaryRow >= 0) labelRows.add(newPrimaryRow);
  if (onAxis(f.abortAt) && primaryRow >= 0 && primaryRow + 1 < seeds.length) {
    labelRows.add(primaryRow + 1);
  }
  const laneTops: number[] = [];
  {
    let y = TL.laneTop;
    for (let i = 0; i < seeds.length; i++) {
      if (labelRows.has(i)) y += TL.markRow;
      laneTops.push(y);
      y += TL.laneH + TL.laneGap;
    }
  }

  const lanes: TimelineLane[] = seeds.map((seed, i) => {
    const y = laneTops[i] ?? TL.laneTop + i * (TL.laneH + TL.laneGap);
    const raw = seed.engine?.segments ?? [];
    /* The pre-roll is the steady state, and the engine's first band starts at
       the first event: synthesize the band before it from the document rather
       than painting the failure over a time when nothing had happened yet. */
    const bands: { t0: Seconds; t1: Seconds; state: AnyState; open: boolean }[] = [];
    const firstT = raw[0]?.t0 ?? t1;
    if (firstT > t0) bands.push({ t0, t1: Math.min(firstT, t1), state: seed.initial, open: false });
    for (const s of raw) {
      const a = Math.max(t0, s.t0);
      const b = Math.min(t1, s.t1 === null ? t1 : s.t1);
      if (b < a) continue;
      bands.push({ t0: a, t1: b, state: s.state, open: s.open === true });
    }
    if (bands.length === 0) bands.push({ t0, t1, state: seed.initial, open: false });
    const last = bands[bands.length - 1];
    if (last && last.t1 < t1) last.t1 = t1;
    /* Two touching bands in the same state are one band: the synthesized
       steady state and the engine's opening epoch usually agree, and a seam
       drawn between them would read as a change that never happened. */
    const merged: typeof bands = [];
    for (const b of bands) {
      const prev = merged[merged.length - 1];
      if (prev && prev.state === b.state && prev.open === b.open && Math.abs(prev.t1 - b.t0) < 1e-9) {
        prev.t1 = b.t1;
      } else {
        merged.push(b);
      }
    }
    bands.length = 0;
    bands.push(...merged);

    const segments: TimelineSegment[] = [];
    bands.forEach((b, k) => {
      if (b.t1 - b.t0 <= 0 && bands.length > 1) return;
      const lk = look(b.state, seed.group, { pingSet: ping });
      const x = Math.max(scale.plotL, scale.x(b.t0));
      const w = Math.min(scale.plotR, scale.x(b.t1)) - x;
      segments.push({
        key: `${seed.kind}:${seed.id}:${k}`,
        t0: b.t0, t1: b.t1, x: r1(x), w: r1(Math.max(0, w)),
        state: b.state, phase: lk.phase, ink: lk.ink,
        labels: lk.labels,
        label: fitLabel(lk.labels, w),
        title: lk.labels[0] ?? String(b.state),
        open: b.open,
      });
    });

    return {
      key: `${seed.kind}:${seed.id}`,
      kind: seed.kind,
      id: seed.id,
      group: seed.group,
      name: seed.name,
      sub: fitSub(seed.subs, TL.gutter - TL.gutterPad) ?? seed.subs[seed.subs.length - 1] ?? '',
      indent: seed.indent,
      y,
      height: TL.laneH,
      segments,
    };
  });

  /* ---- the application's lanes, under the configuration's ---- */
  const membersBottom = lanes.length > 0
    ? (laneTops[laneTops.length - 1] ?? TL.laneTop) + TL.laneH
    : TL.laneTop + TL.laneH;
  const ap = pinned || view.app === false ? null : appModelFor(trace, doc);
  const section = ap === null || doc.application === undefined ? null : appLanes(ap, doc, t0, t1);
  let appSection: TimelineModel['appSection'] = null;
  /* The lane the reconnect is marked on, and the row its label is given. */
  let connectKey: string | null = null;
  if (section !== null && doc.application !== undefined) {
    const appId = doc.application.id as string;
    appSection = {
      y: membersBottom + TL.appHead - 12,
      title: "The application's view",
      note: section.note,
      tone: section.tone,
      basis: section.basis,
    };
    let y = membersBottom + TL.appHead;
    for (const al of section.lanes) {
      /* The mark's sentence sits over the lane it belongs to. */
      if (al.key === 'connect' && section.marks.some((mk) => mk.t >= t0 && mk.t <= t1)) y += TL.markRow;
      const key = `application:${al.key}`;
      if (al.key === 'connect') connectKey = key;
      lanes.push({
        key,
        kind: 'application',
        id: appId,
        group: 'app',
        name: al.name,
        sub: fitSub(al.subs, TL.gutter - TL.gutterPad) ?? al.subs[al.subs.length - 1] ?? '',
        indent: 0,
        y,
        height: TL.laneH,
        segments: al.bands.map((bd, k) => {
          const x = Math.max(scale.plotL, scale.x(bd.a));
          const w = Math.min(scale.plotR, scale.x(bd.b)) - x;
          return {
            key: `${key}:${k}`,
            t0: bd.a, t1: bd.b, x: r1(x), w: r1(Math.max(0, w)),
            state: bd.state, phase: bd.phase, ink: bd.ink,
            labels: bd.labels,
            label: fitLabel(bd.labels, w),
            title: bd.labels[0] ?? al.name,
            open: false,
          };
        }),
      });
      y += TL.laneH + TL.laneGap;
    }
  }

  const lastLane = lanes[lanes.length - 1];
  const lanesBottom = lastLane ? lastLane.y + lastLane.height : TL.laneTop + TL.laneH;
  const axisY = lanesBottom + TL.axisGap;
  const braceTop = axisY + TL.braceGap;

  /* ticks */
  const ticks: TimelineTick[] = [];
  for (let tk = Math.ceil(t0 / tickStep) * tickStep; tk <= t1 + 1e-9; tk += tickStep) {
    const t = Math.abs(tk) < 1e-9 ? 0 : tk;
    ticks.push({ t, x: r1(scale.x(t)), label: signed(t) });
  }

  /* markers */
  const laneY = new Map(lanes.map((l) => [l.key, l.y]));
  const markers: TimelineMarker[] = [];
  /**
   * Which row each marker's label lives in: the event row above the lanes, or
   * the lane gap the label was given room in. Two labels only ever compete
   * with each other inside one row, which is what lets the pass below be a
   * single deterministic sweep.
   */
  const markerRow = new Map<string, string>();
  const primaryKey = lanes.find((l) => l.group === 'primary')?.key ?? null;
  const observerKey = lanes.find((l) => l.group === 'observer')?.key ?? null;

  events.forEach((e, i) => {
    if (e.at < t0 || e.at > t1) return;
    const x = scale.x(e.at);
    const label = describeEvent(doc, e);
    const partition = e.kind === 'link.cut' || e.kind === 'partition';
    const fits = x + 8 + approxW(label, 11.5) <= scale.plotR;
    markers.push({
      key: `ev-${i}`,
      kind: 'event',
      glyph: partition ? 'partition' : 'cross',
      t: e.at,
      x: r1(x),
      index: i + 1,
      tone: 'f-rd',
      stroke: partition ? 'partition' : 'm-rd',
      label,
      labelAnchor: fits ? 'start' : 'end',
      labelX: r1(fits ? x + 8 : x - 8),
      labelY: TL.markY,
      showLabel: true,
      nx: r1(x),
      icon: eventIcon(e.kind),
      y0: TL.laneTop - 4,
      y1: partition ? lanesBottom + 4 : TL.laneTop + TL.laneH + 4,
      laneKey: partition ? null : primaryKey,
    });
  });

  if (f.initiateAt !== null && f.initiateAt >= t0 && f.initiateAt <= t1 && f.outcome === 'failover') {
    const x = scale.x(f.initiateAt);
    const label = f.blocked
      ? (ping
        ? `Detection ends — failover refused at t = ${fmt(f.initiateAt)} s`
        : `Threshold expires — failover refused at t = ${fmt(f.initiateAt)} s`)
      : `Initiates failover at t = ${fmt(f.initiateAt)} s`;
    const fits = x + 9 + approxW(label, 11.5) <= scale.plotR;
    const y = observerKey ? laneY.get(observerKey) ?? TL.laneTop : TL.laneTop;
    markers.push({
      key: 'decision',
      kind: 'decision',
      glyph: 'diamond',
      t: f.initiateAt,
      x: r1(x),
      index: null,
      tone: f.blocked ? 'f-rd' : 'f-vi',
      stroke: f.blocked ? 'm-rd' : 'm-vi',
      label,
      labelAnchor: fits ? 'start' : 'end',
      labelX: r1(fits ? x + 9 : x - 9),
      labelY: y - 8,
      showLabel: true,
      nx: r1(x),
      icon: null,
      y0: y - 10,
      y1: y + TL.laneH + 4,
      laneKey: observerKey,
    });
    markerRow.set('decision', observerRow >= 0 ? `gap:${observerRow}` : 'top');
  }

  if (f.abortAt !== null && f.abortAt >= t0 && f.abortAt <= t1) {
    const x = scale.x(f.abortAt);
    const cands = [
      `Self-abort at t = ${fmt(f.abortAt)} s  (FastStartFailoverPmyShutdown = TRUE)`,
      `Self-abort at t = ${fmt(f.abortAt)} s`,
      'Self-abort',
    ];
    let label = cands[cands.length - 1] as string;
    let fits = false;
    for (const c of cands) {
      if (x + 8 + approxW(c, 11.5) <= scale.plotR) { label = c; fits = true; break; }
    }
    const y = primaryKey ? laneY.get(primaryKey) ?? TL.laneTop : TL.laneTop;
    markers.push({
      key: 'abort',
      kind: 'abort',
      glyph: 'dot',
      t: f.abortAt,
      x: r1(x),
      index: null,
      tone: 'f-rd',
      stroke: 'm-rd',
      label,
      labelAnchor: fits ? 'start' : 'end',
      labelX: r1(fits ? x + 8 : x - 8),
      labelY: y + TL.laneH + 16,
      showLabel: true,
      nx: r1(x),
      icon: null,
      y0: y + 2,
      y1: y + TL.laneH + 8,
      laneKey: primaryKey,
    });
    markerRow.set('abort', primaryRow >= 0 ? `gap:${primaryRow + 1}` : 'top');
  }

  const newPrimaryKey = f.newPrimary
    ? lanes.find((l) => l.kind === 'member' && l.id === (f.newPrimary as string))?.key ?? null
    : null;
  if (!f.blocked && openAt !== null && openAt >= t0 && openAt <= t1) {
    const x = scale.x(openAt);
    const y = newPrimaryKey ? laneY.get(newPrimaryKey) ?? lanesBottom - TL.laneH : lanesBottom - TL.laneH;
    markers.push({
      key: 'open',
      kind: 'open',
      glyph: 'line',
      t: openAt,
      x: r1(x),
      index: null,
      tone: 'f-tl',
      stroke: 'm-tl',
      label: `Opens read-write at t = ${fmt(openAt)} s`,
      labelAnchor: 'end',
      labelX: r1(x - 8),
      labelY: y - 6,
      showLabel: true,
      nx: r1(x),
      icon: null,
      y0: y + 2,
      y1: y + TL.laneH - 2,
      laneKey: newPrimaryKey,
    });
    markerRow.set('open', newPrimaryRow >= 0 ? `gap:${newPrimaryRow}` : 'top');
  }

  /* The application's two marks: the reconnect, and the string giving up. */
  if (section !== null && connectKey !== null) {
    const y = laneY.get(connectKey) ?? lanesBottom - TL.laneH;
    for (const mk of section.marks) {
      if (mk.t < t0 || mk.t > t1) continue;
      const x = scale.x(mk.t);
      const fits = x + 9 + approxW(mk.label, 11.5) <= scale.plotR;
      const good = mk.key === 'reconnect';
      markers.push({
        key: `app-${mk.key}`,
        kind: 'app',
        glyph: good ? 'diamond' : 'cross',
        t: mk.t,
        x: r1(x),
        index: null,
        tone: mk.tone,
        stroke: good ? 'm-vi' : 'm-rd',
        label: mk.label,
        labelAnchor: fits ? 'start' : 'end',
        labelX: r1(fits ? x + 9 : x - 9),
        labelY: y - 6,
        showLabel: true,
        nx: r1(x),
        icon: null,
        y0: good ? y - 8 : y + 2,
        y1: good ? y + TL.laneH + 4 : y + TL.laneH - 2,
        laneKey: connectKey,
      });
      markerRow.set(`app-${mk.key}`, 'gap:app');
    }
  }

  /* ---- the marker labels, one deterministic sweep per row ----

     Two labels in one row would print on top of each other -- two injected
     events at one instant, or a decision sharing the observer's gap with
     something else. In marker order: a label that collides tries the other
     side of its line, and failing that gives way. Giving way costs nothing
     that is not still said: the badge stays, the tooltip carries the sentence
     and the Break rail lists it in full.

     The badges are placed first, because an event's sentence has to start
     clear of every badge standing at its instant -- ((1))((2)) printed over
     the first word of the label is how two events at t = 0 used to read. */
  {
    const rows = new Map<string, { x0: number; x1: number }[]>();
    /* The "Steady state" caption owns the left end of the event row. */
    rows.set('top', [
      { x0: scale.plotL, x1: scale.plotL + approxW('Steady state', 10.5) + 12 },
    ]);
    const badges: number[] = [];
    /* Rightmost badge edge per instant, in plot coordinates. */
    const badgeRight = new Map<number, number>();
    for (const m of markers) {
      if (m.kind !== 'event') continue;
      let nx = m.x;
      while (badges.some((b) => Math.abs(b - nx) < 15)) nx += 16;
      m.nx = r1(nx);
      badges.push(nx);
      badgeRight.set(m.x, Math.max(badgeRight.get(m.x) ?? -Infinity, nx + 9));
    }

    for (const m of markers) {
      const row = markerRow.get(m.key) ?? 'top';
      const taken = rows.get(row) ?? [];
      const clash = (x0: number, x1: number): boolean =>
        taken.some((r) => x0 < r.x1 + 8 && x1 > r.x0 - 8);
      /* the labels are semi-bold; the ladder's estimate is for regular text */
      const w = approxW(m.label, 11.5) * 1.08;
      const off = Math.max(8, Math.abs(m.labelX - m.x));
      const start = Math.max(m.x + off, badgeRight.get(m.x) ?? -Infinity);
      let x0 = m.labelAnchor === 'start' ? start : m.labelX - w;
      let x1 = x0 + w;
      if (m.labelAnchor === 'start') m.labelX = r1(start);
      if (clash(x0, x1)) {
        const ax0 = m.x - off - w; const ax1 = m.x - off;
        if (ax0 >= scale.plotL && !clash(ax0, ax1)) {
          m.labelAnchor = 'end'; m.labelX = r1(m.x - off); x0 = ax0; x1 = ax1;
        } else {
          m.showLabel = false; x0 = m.x - 8; x1 = m.x + 8;
        }
      }
      taken.push({ x0, x1 });
      rows.set(row, taken);
    }
  }

  /* braces */
  const packed = packBraces(buildBraces(doc, f), scale, width, braceTop);
  const height = packed.braces.length > 0
    ? braceTop + Math.max(1, packed.rowCount) * TL.braceRow + 6
    : axisY + 44;

  /* the outage brace above the lanes */
  let topBrace: TimelineModel['topBrace'] = null;
  if (f.outcome === 'failover' && !f.blocked && f.tOpen !== null) {
    topBrace = { x0: r1(scale.x(0)), x1: r1(scale.x(f.tOpen)), y: TL.braceY, tone: 'br-sl' };
  } else if (f.outcome === 'switchover' && f.switchover && !f.switchover.blocked &&
    f.switchover.tDown !== null && f.switchover.tOpen !== null) {
    topBrace = {
      x0: r1(scale.x(f.switchover.tDown)), x1: r1(scale.x(f.switchover.tOpen)),
      y: TL.braceY, tone: 'br-rd',
    };
  }

  /* the pre-failure band and its label */
  const zeroX = scale.x(0);
  const preW = Math.max(0, zeroX - scale.plotL);
  const ssLab = 'Steady state';
  const preZone = {
    x: r1(scale.plotL),
    w: r1(preW),
    label: preW >= approxW(ssLab, 10.5) + 12 ? ssLab : null,
  };

  /* every distinct state change, for the transport's step buttons */
  const changes = new Set<number>();
  for (const e of events) if (e.at >= t0 && e.at <= t1) changes.add(r1(e.at));
  for (const l of lanes) for (const s of l.segments) {
    if (s.t0 > t0 && s.t0 < t1) changes.add(r1(s.t0));
  }
  const stateChanges = [...changes].sort((a, b) => a - b);

  const empty = events.length === 0;
  const caption = buildCaption(doc, f, empty, trace.findings);
  if (caption.anchor === 'middle') {
    const w = approxW(caption.text, 12);
    const a = f.outcome === 'switchover' && f.switchover?.tDown !== null && f.switchover?.tDown !== undefined
      ? scale.x(f.switchover.tDown)
      : zeroX;
    const b = scale.x(openAt ?? 0);
    caption.x = r1(Math.min(Math.max((a + b) / 2, w / 2 + 6), width - w / 2 - 6));
  } else {
    caption.x = r1(scale.plotL);
  }

  return {
    width,
    height,
    scale,
    lanes,
    ticks,
    markers,
    braces: packed.braces,
    legend: LEGEND,
    caption,
    topBrace,
    stateChanges,
    laneTop: TL.laneTop,
    lanesBottom,
    axisY,
    braceTop,
    preZone,
    axisLabel: 'seconds',
    zeroNote: events.length > 0 && Math.abs((events[0] as TimedEvent).at) < 1e-9
      ? 't = 0 is the first injected event'
      : null,
    empty,
    quietLinks,
    pinned,
    appSection,
  };
}
