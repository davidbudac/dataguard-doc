/**
 * The small timeline under Topology's drawing: the run, and the control for its
 * clocks.
 *
 * Topology is where a reader draws a configuration, breaks it, turns a knob and
 * sees the outcome move. This is the "turn a knob, see it move": the run on the
 * clock the Detailed timeline draws -- one thin bar per member, observer and
 * application lane, no link lanes -- with the transport and the ways on
 * (`Clear`, the Detailed timeline itself at the same playhead, the full timeline
 * in a window of its own), the rows taller so each bar has room above it for
 * what governs it:
 *
 *   - every clock that IS a setting (`tuneHandles`) is a labelled bracket over
 *     the bar of the lane it belongs to, with its name, its value and its unit
 *     on the label and a grip at its right end. Drag the grip and the setting
 *     changes live, the run recomputes and the axis holds (run.ts); press the
 *     label and its number becomes a box (`TuneNumber`), Escape or leaving it
 *     closes it. Where a lane's band is that very clock the bar carries the grip
 *     too, as the Detailed timeline's does.
 *   - the application's lanes are drawn, and on its connect string's lane a
 *     `retry window` bracket: the stretch from the first dial to the last that
 *     failed. It is one setting's clock only as far as the connect string makes
 *     it (see `appWindows`), so its grip drags the field that sets it, and its
 *     number -- the window, which no field is -- is not a box.
 *   - the two readings the dock's readout line gives up -- "New primary open" and
 *     each application's reconnect -- are white outcome badges on the bars at
 *     their instant, and the model's decision marks are pins, simpler than the
 *     big timeline's milestones. There is no caption sentence: the readings and
 *     the badges say it.
 *
 * It draws from the model `useRunTimeline` builds, so the axis, the phases and
 * their tooltips are the engine's own. Everything it writes goes through the
 * inspector's named setters (`applyTune`, `editClientTiming`, wrapped in
 * `tuned`), so undo works and the axis holds while a run is tuned. The grips and
 * the boxes are drawn for a reader who can edit; a read-only viewer still gets
 * the brackets and can play the run.
 *
 * No inline style anywhere (`style-src 'self'`): every position is an SVG
 * presentation attribute, every look a class of `timeline.css`'s `.tl-svg`
 * block or of `mini-timeline.css`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { applicationClient, applicationsOf, BOUNDS } from '@/engine';
import type { ClientDescriptor, TopologyDoc, Trace } from '@/engine';
import { topology, trace } from '@/state/derived';
import { canEdit, miniTimelineOpen, mode, MODE_LABEL, playing, speed, tNow, viewport } from '@/state/view';
import { toggleMiniTimeline } from '@/state/persist';
import { clearEvents } from '../break/events';
import { PopoutButton, popped } from '../common/popout';
import { useHostWindow } from '../common/dom';
import { usePlotSize } from './use-plot-size';
import { CLIENT_TIMING_FIELDS, editClientTiming } from '../inspector/client-timing';
import type { ClientTimingField } from '../inspector/client-timing';
import { bracePath } from './Brace';
import { appModelsFor, elideTo, fmt, spoken } from './build';
import type { TimelineBrace, TimelineLane, TimelineModel } from './build';
import { nextChange, prevChange } from './Playhead';
import { usePlayback } from './playback';
import { useRunTimeline } from './run';
import { Transport } from './Transport';
import { applyTune, promotedDatabase, tuned } from './tune';
import type { Tune, TuneId } from './tune';
import { useTuneHandles } from './tune-handles';
import type { TuneHandle } from './tune-handles';
import { TuneDrag } from './TuneDrag';
import { TuneNumber } from './TuneNumber';
import '@/styles/timeline.css';
import '@/styles/mini-timeline.css';

/** The lane names' column, from the plot's left edge back to the svg's: room for `New connections`. */
const GUTTER = 108;
/** A lane with something above its bar: its pitch, the bar's height and where the bar sits in it. */
const ROW = 34;
const BAR = 10;
const BAR_DY = 20;
/** A lane with nothing above its bar is a thinner row; the white badges (18 px) still fit. */
const FLAT = 20;
const FLAT_DY = 5;
/** Above the first lane, between the last and the axis, and the tick labels under it. */
const TOP = 8;
const AXIS_GAP = 10;
const LABEL_DY = 17;
/** Ticks drawn at most: a glance wants a few, not the big axis's every step. */
const MAX_TICKS = 5;
const MARK_R = 6;
const NAME_FS = 10.5;
/** Where things sit over a bar, from the bar's top: the bracket's tips, the label's baseline. */
const BRACE_DY = -4;
const LABEL_DY_BAR = -12;
/** The label's room: the gap kept between two, and how wide a character runs (10 px text). */
const LABEL_GAP = 6;
const CHAR_W = 5.3;
const BADGE_H = 18;

/** The lanes the small timeline draws: every one the model has but the links, which it leaves to the drawing above. */
export const glanceLanes = (lanes: readonly TimelineLane[]): TimelineLane[] =>
  lanes.filter((l) => l.kind !== 'link');

/** One thinned tick list: at most `MAX_TICKS`, evenly spaced, the first kept. */
function thin<T>(ticks: readonly T[]): T[] {
  const stride = Math.max(1, Math.ceil(ticks.length / MAX_TICKS));
  return ticks.filter((_, i) => i % stride === 0);
}

/** What a lane is named in the brace's own short words. */
const SHORT: Record<TuneId, string> = {
  threshold: 'threshold',
  roleTransition: 'role transition',
  applyLag: 'apply lag',
  clientTiming: 'retry window',
};

/** One bracket over a bar: the clock, what it is called and, where it is a setting, the grip. */
interface Span {
  key: string;
  laneKey: string;
  x0: number;
  x1: number;
  tone: TimelineBrace['tone'];
  name: string;
  /** The number on the label, in `unit`. */
  value: number;
  unit: string;
  /** The grip, where the clock is a setting; the drawing the grip measures itself on. */
  handle: TuneHandle | null;
  model: TimelineModel;
  onTune: (t: Tune, v: number) => void;
  /** Where the label's number is a box that edits the setting; false where it is a reading. */
  editable: boolean;
  tip: string;
}

/** The connect string's waits as one bracket, and the field that moves it. */
interface AppWindow {
  key: string;
  laneKey: string;
  a: number;
  b: number;
  appId: string;
  client: ClientDescriptor;
  /** The field the grip drags; null where no one field moves the window exactly. */
  field: ClientTimingField | null;
  /** Seconds the window moves for one second of the field. */
  k: number;
}

const FIELD = (name: string): ClientTimingField => {
  const f = CLIENT_TIMING_FIELDS.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no connect-string field ${name}`);
  return f;
};

/**
 * Each application's waits, from its model: the stretch from its first dial to
 * the last that did not connect. That length is a sum the connect string makes,
 * so a grip can only be honest where one field moves it by a known number of
 * seconds for each of its own:
 *
 *   - when the string retries and waits between traversals, RETRY_DELAY, which
 *     the window holds once per gap;
 *   - else, when addresses time out, TRANSPORT_CONNECT_TIMEOUT (CONNECT_TIMEOUT
 *     where that is set and is the smaller of the two), once per timed-out dial.
 *
 * `k` is that count, so the grip drags at `k` times the axis' rate and the
 * bracket's end stays under the pointer. Anything else (refusals only) is drawn
 * as a bracket with no grip.
 */
function appWindows(doc: TopologyDoc, t: Trace, model: TimelineModel): AppWindow[] {
  const out: AppWindow[] = [];
  const apps = applicationsOf(doc);
  for (const ap of appModelsFor(t, doc)) {
    const app = apps.find((x) => x.id === ap.application?.id);
    if (app === undefined || ap.noEvent) continue;
    const lane = model.lanes.find((l) => l.key === `application:${app.id}:connect`);
    const first = ap.attempts[0];
    if (lane === undefined || first === undefined) continue;
    const client = applicationClient(doc, app);
    const dials = ap.attempts.flatMap((x) => x.dials);
    const failed = dials.filter((d) => d.kind !== 'establish');
    if (failed.length === 0) continue;
    const a = first.start;
    const b = Math.max(...failed.map((d) => d.end));
    if (!(b - a > 0.05)) continue;
    const gaps = ap.attempts.length - 1;
    const timeouts = dials.filter((d) => d.kind === 'timeout').length;
    const capped = client.connectTimeoutSeconds !== null && client.connectTimeoutSeconds > 0
      && client.connectTimeoutSeconds < client.transportConnectTimeoutSeconds;
    let field: ClientTimingField | null = null;
    let k = 0;
    if (gaps > 0 && client.retryCount > 0) { field = FIELD('RETRY_DELAY'); k = gaps; }
    else if (timeouts > 0) { field = FIELD(capped ? 'CONNECT_TIMEOUT' : 'TRANSPORT_CONNECT_TIMEOUT'); k = timeouts; }
    out.push({ key: `app:${app.id}`, laneKey: lane.key, a, b, appId: app.id as string, client, field, k });
  }
  return out;
}

/** The drawing with its seconds stretched by `k`: a grip that moves one second of a field moves the clock `k`. */
const stretched = (m: TimelineModel, k: number): TimelineModel => (k === 1 ? m : {
  ...m,
  scale: { ...m.scale, x: (t: number) => m.scale.x(0) + k * (m.scale.x(t) - m.scale.x(0)) },
});

/** A white badge on a bar: its text, and where it sits so that it never leaves the plot. */
interface Badge {
  key: string;
  laneKey: string;
  x: number;
  text: string;
  tip: string;
}

/** What a label asks for over a bar: its wanted left edge, and the forms it can take, longest first. */
interface LabelAsk {
  key: string;
  left: number;
  forms: { w: number; text: string }[];
}
interface LabelAt { left: number; form: number }

/**
 * Place the labels of one lane left to right. Each keeps its centre when it can;
 * one that would touch the one before slides right, then shortens to its number,
 * and one that still cannot be placed is left off (its tooltip and its grip say
 * the rest). Nothing leaves the plot.
 */
function packLabels(asks: readonly LabelAsk[], plotL: number, plotR: number): Map<string, LabelAt> {
  const out = new Map<string, LabelAt>();
  let edge = -Infinity;
  for (const ask of [...asks].sort((p, q) => p.left - q.left)) {
    for (let f = 0; f < ask.forms.length; f++) {
      const w = (ask.forms[f] as { w: number }).w;
      const want = f === 0 ? ask.left : ask.left + ((ask.forms[0] as { w: number }).w - w) / 2;
      const left = Math.min(Math.max(want, edge + LABEL_GAP, plotL), plotR - w);
      if (left >= edge + LABEL_GAP - 0.5 && left >= plotL - 0.5) {
        out.set(ask.key, { left, form: f });
        edge = left + w;
        break;
      }
    }
  }
  return out;
}

function MiniRun({ t, fitHeight }: { t: Trace; fitHeight: boolean }) {
  const [ref, plotSize] = usePlotSize(fitHeight);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const measured = plotSize.width;
  const estimate = fitHeight && plotSize.height > 0 && naturalHeight > 0 ? plotSize.height / naturalHeight : 1;
  const doc = topology.value;
  const editable = canEdit(viewport.value);
  const now = tNow.value;
  const isPlaying = playing.value;
  const view = useHostWindow();
  /* The application's lanes are in the model, and its story sets the axis' horizon. */
  const { model } = useRunTimeline({
    trace: t, doc, width: (measured - (fitHeight ? 1 : 0)) / estimate, appView: true, density: 'compact', links: 'never', gutter: GUTTER,
  });
  const { scale } = model;
  const handles = useTuneHandles(true, doc, t, model);
  const [editing, setEditing] = useState<string | null>(null);

  const lanes = glanceLanes(model.lanes);
  const laneById = (key: string | null): TimelineLane | undefined =>
    key === null ? undefined : lanes.find((l) => l.key === key);
  const apps = applicationsOf(doc);

  /* ---- where each setting's clock is drawn: the lane its band is, else the lane it is about ---- */
  const master = lanes.find((l) => l.kind === 'observer' && l.mark === 'M') ?? lanes.find((l) => l.kind === 'observer');
  const promoted = promotedDatabase(doc, t);
  const promotedLane = promoted === null ? undefined
    : lanes.find((l) => l.kind === 'member' && l.id === (promoted.id as string));
  const homeOf = (hd: TuneHandle): TimelineLane | undefined => {
    const own = laneById(hd.laneKey);
    if (own !== undefined) return own;
    return hd.tune.id === 'threshold' ? master : promotedLane;
  };

  const spans: Span[] = [];
  for (const hd of handles) {
    const brace = model.braces.find((b) => b.key === hd.key);
    const home = homeOf(hd);
    if (brace === undefined || home === undefined) continue;
    const unit = BOUNDS[hd.tune.bound].unit;
    spans.push({
      key: hd.key, laneKey: home.key,
      x0: Math.max(scale.plotL, brace.x0), x1: Math.min(scale.plotR, hd.x),
      tone: brace.tone, name: SHORT[hd.tune.id], value: hd.tune.value, unit, handle: hd, model,
      onTune: applyTune, editable, tip: hd.title,
    });
  }
  for (const w of appWindows(doc, t, model)) {
    const { field } = w;
    const app = apps.find((x) => (x.id as string) === w.appId);
    const tune: Tune | null = field === null ? null : {
      id: 'clientTiming', bound: field.bound, value: field.value(w.client), name: field.name, mono: true,
    };
    const tip = field === null
      ? `The connect string's waits, from its first dial to the last that failed${app === undefined ? '' : ` (${app.name})`}.`
      : `${w.k === 1 ? '' : `${w.k} × `}${field.name}, from the first dial to the last that failed. `
        + `Drag to change ${field.name}: the window moves ${w.k} s for each second of it. ${field.note(doc.config.edition)}`;
    const b = BOUNDS[field?.bound ?? 'retryCount'];
    spans.push({
      key: w.key, laneKey: w.laneKey,
      x0: Math.max(scale.plotL, scale.x(w.a)), x1: Math.min(scale.plotR, scale.x(w.b)),
      tone: 'br-am', name: SHORT.clientTiming, value: w.b - w.a, unit: 's',
      handle: tune === null || field === null ? null : {
        key: w.key, tune, x: scale.x(w.b), braceY: 0, laneKey: null,
        title: `${tip} Arrow keys: 1 ${b.unit}; Shift: 5 ${b.unit}. Allowed: ${b.min}–${b.max} ${b.unit}.`,
      },
      model: stretched(model, Math.max(1, w.k)),
      onTune: (_t, v) => { if (field !== null) tuned(() => editClientTiming(field, v, w.appId)); },
      /* The number on this label is the window, which no field is: only the grip edits. */
      editable: false, tip,
    });
  }

  /* ---- the pins: decisions and aborts; the open and the reconnect are badges ---- */
  const laneKeys = new Set(lanes.map((l) => l.key));
  const pins = model.markers.filter((m) => m.kind !== 'event' && m.kind !== 'open' && m.kind !== 'app'
    && m.laneKey !== null && laneKeys.has(m.laneKey));

  /* ---- the badges: the two readings the readout line leaves to the drawing ---- */
  const badges: Badge[] = [];
  const f = t.facts;
  if (!f.blocked && f.newPrimary !== null && f.tOpen !== null && promotedLane !== undefined) {
    badges.push({
      key: 'open', laneKey: promotedLane.key, x: scale.x(f.tOpen), text: `open ${fmt(f.tOpen)} s`,
      tip: `New primary open at t = ${fmt(f.tOpen)} s`,
    });
  }
  for (const ap of appModelsFor(t, doc)) {
    if (ap.tConn === null || ap.application === null) continue;
    const lane = laneById(`application:${ap.application.id}:connect`);
    if (lane === undefined) continue;
    badges.push({
      key: `conn:${ap.application.id}`, laneKey: lane.key, x: scale.x(ap.tConn), text: `reconnects ${fmt(ap.tConn)} s`,
      tip: `${ap.application.name} reconnects at t = ${fmt(ap.tConn)} s`,
    });
  }

  /* ---- the rows: a lane with something over its bar is tall, the others are thin ---- */
  const tall = new Set<string>([...spans.map((s) => s.laneKey), ...pins.map((m) => m.laneKey as string)]);
  let cursor = TOP;
  const rows = lanes.map((lane) => {
    const full = tall.has(lane.key);
    const top = cursor;
    const h = full ? ROW : FLAT;
    cursor += h;
    return { lane, top, h, barY: top + (full ? BAR_DY : FLAT_DY) };
  });
  const rowOf = (key: string | null): (typeof rows)[number] | undefined => rows.find((r) => r.lane.key === key);
  const axisY = cursor + AXIS_GAP;
  const height = axisY + LABEL_DY + 6;
  useLayoutEffect(() => { setNaturalHeight(height); }, [height]);
  const chartScale = fitHeight && plotSize.height > 0 ? plotSize.height / height : 1;
  const at = scale.clampT(now);
  const px = Math.round(scale.x(at) * 10) / 10;
  const canSeek = !model.empty;

  /* ---- the labels over the bars, packed lane by lane ---- */
  const asks = new Map<string, LabelAsk[]>();
  const tw = (s: string): number => s.length * CHAR_W + 2;
  const put = (laneKey: string, ask: LabelAsk): void => { asks.set(laneKey, [...(asks.get(laneKey) ?? []), ask]); };
  for (const s of spans) {
    const num = `${fmt(s.value)} ${s.unit}`;
    const full = `${s.name} ${num}`;
    put(s.laneKey, {
      key: s.key, left: (s.x0 + s.x1) / 2 - tw(full) / 2,
      forms: [{ w: tw(full), text: full }, { w: tw(num), text: num }],
    });
  }
  for (const m of pins) {
    put(m.laneKey as string, { key: m.key, left: m.x + 7, forms: [{ w: tw(m.label), text: m.label }] });
  }
  const placed = new Map<string, LabelAt>();
  for (const list of asks.values()) {
    for (const [k, v] of packLabels(list, scale.plotL, scale.plotR)) placed.set(k, v);
  }

  const togglePlay = (): void => { playing.value = !playing.value; };
  const seekTo = (v: number): void => { tNow.value = v; };
  const pause = (): void => { if (isPlaying) playing.value = false; };
  /* The window the full timeline was popped out into drives the playhead
     while it is there: two loops writing one playhead would each toggle
     `playing` at the end of the axis, and the second toggle would restart it. */
  usePlayback({
    view, playing: isPlaying, speed: speed.value, tNow: now, t0: scale.t0, t1: scale.t1,
    enabled: canSeek && popped.value.timeline === undefined, onSeek: seekTo, onEnd: togglePlay,
  });

  /* A press anywhere on the plot moves the playhead there, and a drag keeps
     scrubbing -- the big timeline's gesture. Seeking stops the run: playback
     owns the playhead while it plays (playback.ts). A grip, a label and a badge
     are not the plot: they stop the press before it gets here. */
  const drag = useRef<number | null>(null);
  const tAt = (e: JSX.TargetedPointerEvent<SVGSVGElement>): number | null => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return null;
    const x = (e.clientX - box.left) * (model.width / box.width);
    return Math.round(scale.clampT(scale.tAt(x)) * 10) / 10;
  };
  const inPlot = (e: JSX.TargetedPointerEvent<SVGSVGElement>): boolean => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return false;
    const x = (e.clientX - box.left) * (model.width / box.width);
    return x >= scale.plotL - 4 && x <= scale.plotR + 4;
  };
  const onDown = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (!canSeek || e.button !== 0 || !inPlot(e)) return;
    const v = tAt(e);
    if (v === null) return;
    e.preventDefault();
    if (isPlaying) togglePlay();
    drag.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekTo(v);
  };
  const onMove = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (drag.current !== e.pointerId) return;
    const v = tAt(e);
    if (v !== null) seekTo(v);
  };
  const onUp = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (drag.current !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  /* The keyboard contract of the big playhead, minus what needs a badge. */
  const onKey = (e: JSX.TargetedKeyboardEvent<SVGGElement>): void => {
    const step = e.shiftKey ? 0.1 : 1;
    const go = (v: number | null): void => {
      if (v === null) return;
      e.preventDefault();
      if (isPlaying) togglePlay();
      seekTo(scale.clampT(Math.round(v * 10) / 10));
    };
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': go(at - step); break;
      case 'ArrowRight': case 'ArrowUp': go(at + step); break;
      case 'Home': go(scale.t0); break;
      case 'End': go(scale.t1); break;
      case '.': go(nextChange(model.stateChanges, at)); break;
      case ',': go(prevChange(model.stateChanges, at)); break;
      case ' ': case 'Spacebar': e.preventDefault(); togglePlay(); break;
      default: break;
    }
  };

  const events = model.markers.filter((m) => m.kind === 'event' && m.index !== null);
  const summary = `Timeline of the run, ${lanes.length} lane${lanes.length === 1 ? '' : 's'} on a seconds axis from ${fmt(scale.t0)} to ${fmt(scale.t1)} seconds. ${model.caption.text}.`;
  const descId = 'mtl-desc';
  const ownName = (lane: TimelineLane): string =>
    lane.kind === 'application' && apps.length > 1 && lane.owner !== null ? `${lane.owner} · ${lane.name}` : lane.name;

  return (
    <section class="mtl" aria-label="Timeline of the run">
      <div class="mtl-head">
        <FoldButton open />
        {model.empty ? null : (
          <Transport
            model={model} tNow={now} playing={isPlaying} speed={speed.value} speedControl="select"
            onSeek={seekTo} onPlayToggle={togglePlay} onSpeed={(s) => { speed.value = s; }}
          />
        )}
        <span class="mtl-acts">
          {editable ? (
            <button
              type="button" class="btn is-quiet mtl-clear"
              title="Take every injected event away and go back to the drawing at rest"
              onClick={() => clearEvents()}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button" class="btn mtl-detail"
            title="The same run in full, at the same playhead: every lane, clock and setting"
            onClick={() => { mode.value = 'break'; }}
          >
            {MODE_LABEL.break}
          </button>
          {/* The full timeline in a window of its own -- the drawing stays here. */}
          <PopoutButton kind="timeline" />
        </span>
      </div>
      <div class="mtl-plot" id={PLOT_ID} ref={ref}>
        <svg
          class={`tl-svg mtl-svg${canSeek ? ' is-seekable' : ''}`}
          width={model.width * chartScale}
          height={height * chartScale}
          viewBox={`0 0 ${model.width} ${height}`}
          role="group"
          aria-describedby={descId}
          onPointerDown={canSeek ? onDown : undefined}
          onPointerMove={canSeek ? onMove : undefined}
          onPointerUp={canSeek ? onUp : undefined}
          onPointerCancel={canSeek ? onUp : undefined}
        >
          <desc id={descId}>{summary}</desc>
          <defs>
            <pattern id="mtlHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" class="hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="6" class="hatch-ln" />
            </pattern>
          </defs>

          {rows.map(({ lane, barY }) => (
            <g key={lane.key} class="mtl-lane" data-lane={lane.id} data-kind={lane.kind}>
              <title>{`${lane.owner === null ? '' : `${lane.owner} · `}${lane.name} — ${lane.sub}`}</title>
              <text class="t-lane t-mono mtl-name" x={2} y={barY + BAR - 0.5}>
                {elideTo(ownName(lane), scale.plotL - 8, NAME_FS, true)}
              </text>
              <rect class="lane-bg" x={scale.plotL} y={barY} width={Math.max(0, scale.plotW)} height={BAR} rx={2} />
              {lane.segments.map((sg) => (sg.w <= 0.5 ? null : (
                <g key={sg.key} class="tl-seg" data-tip={sg.title}>
                  <title>{sg.title}</title>
                  <rect
                    class={`bar ${sg.phase}${sg.open ? ' is-open' : ''}`}
                    x={sg.x} y={barY} width={sg.w} height={BAR}
                  />
                </g>
              )))}
            </g>
          ))}

          {/* The brackets, and the pins' stems: under the badges, the playhead and the grips. */}
          {spans.map((s) => {
            const row = rowOf(s.laneKey);
            return row === undefined ? null : (
              <path key={s.key} class={`brace mtl-brace ${s.tone}`} d={bracePath(s.x0, s.x1, row.barY + BRACE_DY, -1)} />
            );
          })}
          {pins.map((m) => {
            const row = rowOf(m.laneKey);
            return row === undefined ? null : (
              <g key={m.key} class="mtl-pin" data-tip={m.label}>
                <title>{m.label}</title>
                <line class="mtl-pin-ln" x1={m.x} y1={row.barY - 3} x2={m.x} y2={row.barY + BAR + 1} />
                <circle class="mtl-pin-hd" cx={m.x} cy={row.barY - 8} r={2.5} />
              </g>
            );
          })}

          {badges.map((b) => {
            const row = rowOf(b.laneKey);
            if (row === undefined) return null;
            const w = b.text.length * 5.9 + 14;
            /* Right of the instant, and left of it where that would leave the plot. */
            const left = b.x + 5 + w <= scale.plotR ? b.x + 5 : Math.max(scale.plotL, b.x - 5 - w);
            return (
              <g key={b.key} class="mtl-badge" data-tip={b.tip}>
                <title>{b.tip}</title>
                <rect class="mtl-badge-bg" x={left} y={row.barY + BAR / 2 - BADGE_H / 2} width={w} height={BADGE_H} rx={9} />
                <text class="mtl-badge-t t-mono" x={left + w / 2} y={row.barY + BAR / 2 + 3.4} text-anchor="middle">{b.text}</text>
              </g>
            );
          })}

          {thin(model.ticks).map((tk) => (
            <text key={`t${tk.t}`} class="t-tick t-mono" x={tk.x} y={axisY + LABEL_DY} text-anchor="middle">
              {tk.label}
            </text>
          ))}
          <line class="ax" x1={scale.plotL} y1={axisY} x2={scale.plotR} y2={axisY} />

          {events.map((m) => (
            <g key={m.key} class="mtl-mark" data-tip={m.label}>
              <title>{m.label}</title>
              <circle class="tl-marker-nb" cx={m.nx} cy={axisY} r={MARK_R} />
              <text class="tl-marker-nt t-mono" x={m.nx} y={axisY + 3.2} text-anchor="middle">{m.index}</text>
            </g>
          ))}

          <g
            class={isPlaying ? 'mtl-playhead is-playing' : 'mtl-playhead'}
            transform={`translate(${px},0)`}
            role="slider"
            /* Lower case on an SVG element: see NodeCard. */
            tabindex={0}
            aria-label="Time"
            aria-valuemin={spoken(scale.t0)}
            aria-valuemax={spoken(scale.t1)}
            aria-valuenow={spoken(at)}
            aria-valuetext={`t = ${fmt(at)} seconds`}
            onKeyDown={onKey}
          >
            <title>{`t = ${fmt(at)} s. Drag on the plot to scrub; arrow keys move by 1 s, Shift by 0.1 s.`}</title>
            <rect class="mtl-playhead-hit" x={-7} y={0} width={14} height={axisY + MARK_R + 2} />
            <line class="mtl-playhead-ln" x1={0} y1={TOP - 3} x2={0} y2={axisY} />
            <path class="mtl-playhead-grip" d={`M-4.5,${TOP - 6} L4.5,${TOP - 6} L0,${TOP + 1} z`} />
          </g>

          {/* The labels over the brackets and the pins, above the playhead so a press on one is not a seek. */}
          {pins.map((m) => {
            const row = rowOf(m.laneKey);
            const at3 = placed.get(m.key);
            return row === undefined || at3 === undefined ? null : (
              <text key={`${m.key}:t`} class="mtl-pin-t" x={at3.left} y={row.barY + LABEL_DY_BAR}>{m.label}</text>
            );
          })}
          {spans.map((s) => {
            const row = rowOf(s.laneKey);
            const at3 = placed.get(s.key);
            if (row === undefined || at3 === undefined) return null;
            const y = row.barY + LABEL_DY_BAR;
            const shown = at3.form === 0;
            const num = fmt(s.value);
            const fullW = tw(`${s.name} ${num} ${s.unit}`);
            const can = s.editable && s.handle !== null;
            if (can && editing === s.key && s.handle !== null) {
              return (
                <LabelEdit
                  key={`${s.key}:edit`} x={at3.left - 3} y={y - 14} w={fullW + 34}
                  name={s.name} unit={s.unit} tune={s.handle.tune} onClose={() => setEditing(null)}
                />
              );
            }
            const open = (): void => { if (can) { pause(); setEditing(s.key); } };
            return (
              <g
                key={`${s.key}:label`}
                class={can ? 'mtl-lab is-edit' : 'mtl-lab'}
                role={can ? 'button' : undefined}
                tabindex={can ? 0 : undefined}
                aria-label={can ? `Edit ${s.name}, ${num} ${s.unit}` : undefined}
                onPointerDown={(e) => { e.stopPropagation(); }}
                onClick={open}
                onKeyDown={(e) => { if (can && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
              >
                <title>{can ? `${s.tip} Press the number to type it.` : s.tip}</title>
                <rect class="mtl-lab-hit" x={at3.left - 2} y={y - 9} width={(shown ? fullW : tw(`${num} ${s.unit}`)) + 4} height={13} rx={3} />
                <text class="mtl-bl" x={at3.left} y={y}>
                  {shown ? <tspan class="mtl-bn">{s.name}{' '}</tspan> : null}
                  <tspan class="mtl-bv">{num}</tspan>
                  <tspan class="mtl-bu">{' '}{s.unit}</tspan>
                </text>
              </g>
            );
          })}

          {/* The grips, last: a grip is grabbed before the playhead's hit area or the plot. */}
          {editable ? spans.map((s) => {
            const row = rowOf(s.laneKey);
            if (s.handle === null || row === undefined) return null;
            const hd = s.handle;
            const lane = hd.laneKey === null ? undefined : rowOf(hd.laneKey);
            return (
              <g key={s.key}>
                <TuneDrag
                  key={`${s.key}:brace`} handle={hd} where="brace" x={hd.x} y={row.barY - 18} h={14}
                  model={s.model} onTune={s.onTune} onStart={pause}
                />
                {lane === undefined ? null : (
                  <TuneDrag
                    key={`${s.key}:lane`} handle={hd} where="lane" x={hd.x} y={lane.barY - 2} h={BAR + 4}
                    model={s.model} onTune={s.onTune} onStart={pause}
                  />
                )}
              </g>
            );
          }) : null}
        </svg>
      </div>
    </section>
  );
}

/**
 * The label's number as a box, in place: `TuneNumber` edits on every keystroke,
 * so the run follows what is typed. Enter and Escape close it (Enter by leaving
 * the box, which is what commits what is typed), and so does leaving it any
 * other way.
 */
function LabelEdit({ x, y, w, name, unit, tune, onClose }: {
  x: number; y: number; w: number; name: string; unit: string; tune: Tune; onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = host.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, []);
  return (
    <foreignObject class="mtl-edit" x={x} y={y} width={w} height={20} onPointerDown={(e) => { e.stopPropagation(); }}>
      <div
        class="mtl-edit-in" ref={host}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          else if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); }
        }}
        onFocusOut={onClose}
      >
        <span class="mtl-edit-k">{name}</span>
        <TuneNumber
          class="mtl-num" bound={tune.bound} value={tune.value} label={name}
          onValue={(v) => applyTune(tune, v)}
        />
        <span class="mtl-edit-u">{unit}</span>
      </div>
    </foreignObject>
  );
}

/** The plot's id: what the fold button's `aria-controls` names. */
const PLOT_ID = 'mtl-plot';

/**
 * The fold: the heading of the small timeline and the one control that opens
 * and closes it (`miniTimelineOpen`, remembered by persist.ts). A button with
 * `aria-expanded`, so Enter and Space work and a screen reader says what it is.
 * Folding pauses a run that is playing -- the playback clock lives in `MiniRun`,
 * which is not mounted while folded, and a "playing" flag with nothing driving
 * it would be a lie.
 */
function FoldButton({ open }: { open: boolean }) {
  return (
    <button
      type="button"
      class="mtl-fold"
      aria-expanded={open}
      aria-controls={PLOT_ID}
      title={open ? 'Fold the timeline away to give the room back' : 'Show the timeline'}
      onClick={() => {
        if (open) playing.value = false;
        toggleMiniTimeline();
      }}
    >
      <span class="notes-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      Timeline
    </button>
  );
}

/**
 * The small timeline, while there is a run to show (`trace` is not null).
 * Absent otherwise: with nothing injected there is nothing to glance at. Folded,
 * it is the heading alone -- the way back -- and the run is not drawn.
 */
export function MiniTimeline({ fitHeight = false }: { fitHeight?: boolean } = {}) {
  const t = trace.value;
  if (t === null) return null;
  if (miniTimelineOpen.value) return <MiniRun t={t} fitHeight={fitHeight} />;
  return (
    <section class="mtl is-folded" aria-label="Timeline of the run">
      <div class="mtl-head"><FoldButton open={false} /></div>
    </section>
  );
}
