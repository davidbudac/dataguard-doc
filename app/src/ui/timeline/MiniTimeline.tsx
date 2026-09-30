/**
 * The small timeline under Topology's drawing: the run at a glance.
 *
 * Topology is where a reader draws a configuration, breaks it and sees what
 * happens; this is the "what happens", one thin bar per member and observer
 * on the clock the Detailed timeline draws, with the transport, the run's
 * headline sentence and the ways on -- `Clear`, the Detailed timeline itself at
 * the same playhead, and the full timeline in a window of its own, so the
 * drawing can stay in this one.
 *
 * It draws from the same model the big timeline does (`useRunTimeline`, so
 * the axis, the segments' phases and their tooltips are the engine's own) and
 * takes only what a glance needs from it: the lanes of kinds `member` and
 * `observer` (no link lanes, no application lanes, no braces, no milestone
 * sentences), the injected events as numbered marks on the axis, and a few
 * ticks. It edits nothing on the run itself -- its only writes are the
 * playhead and `Clear` -- so it is shown to a read-only viewer too, who can
 * play a shared link's run.
 *
 * No inline style anywhere (`style-src 'self'`): every position is an SVG
 * presentation attribute, every look a class of `timeline.css`'s `.tl-svg`
 * block (the bars and the marks) or of `mini-timeline.css` (the rest).
 */

import { useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Trace } from '@/engine';
import { topology, trace } from '@/state/derived';
import { appLanesShown, canEdit, mode, MODE_LABEL, playing, speed, tNow, viewport } from '@/state/view';
import { clearEvents } from '../break/events';
import { PopoutButton, popped } from '../common/popout';
import { useHostWindow } from '../common/dom';
import { useWidth } from '../common/use-width';
import { elideTo, fmt, spoken } from './build';
import type { TimelineLane } from './build';
import { nextChange, prevChange } from './Playhead';
import { usePlayback } from './playback';
import { useRunTimeline } from './run';
import { Transport } from './Transport';
import '@/styles/timeline.css';
import '@/styles/mini-timeline.css';

/** The lane names' column, from the plot's left edge back to the svg's. */
const GUTTER = 92;
/** One lane: its pitch, and the bar in it. */
const ROW = 16;
const BAR = 9;
/** Above the first lane, between the last and the axis, and the tick labels under it. */
const TOP = 6;
const AXIS_GAP = 10;
const LABEL_DY = 17;
/** Ticks drawn at most: a glance wants a few, not the big axis's every step. */
const MAX_TICKS = 5;
const MARK_R = 6;
const NAME_FS = 10.5;

/** The lanes a glance wants: a database or far sync instance, an observer. */
export const glanceLanes = (lanes: readonly TimelineLane[]): TimelineLane[] =>
  lanes.filter((l) => l.kind === 'member' || l.kind === 'observer');

/** At most `MAX_TICKS` of the axis's ticks, evenly thinned, the first kept. */
function thin<T>(ticks: readonly T[]): T[] {
  const stride = Math.max(1, Math.ceil(ticks.length / MAX_TICKS));
  return ticks.filter((_, i) => i % stride === 0);
}

function MiniRun({ t }: { t: Trace }) {
  const [ref, measured] = useWidth();
  const doc = topology.value;
  const editable = canEdit(viewport.value);
  const now = tNow.value;
  const isPlaying = playing.value;
  const view = useHostWindow();
  /* The application's lanes are not drawn here (`glanceLanes`), but its story
     still sets the axis' horizon when the Detailed timeline shows it: the same
     flag `restPlayhead` and the readout read, so the playhead a scenario rests
     on is on this axis and every clock on the page agrees about the end. */
  const { model } = useRunTimeline({
    trace: t, doc, width: measured, appView: appLanesShown.value, density: 'compact', links: 'never',
    gutter: GUTTER,
  });
  const { scale } = model;
  const lanes = glanceLanes(model.lanes);
  const axisY = TOP + lanes.length * ROW + AXIS_GAP;
  const height = axisY + LABEL_DY + 6;
  const at = scale.clampT(now);
  const px = Math.round(scale.x(at) * 10) / 10;
  const canSeek = !model.empty;

  const togglePlay = (): void => { playing.value = !playing.value; };
  const seekTo = (v: number): void => { tNow.value = v; };
  /* The window the full timeline was popped out into drives the playhead
     while it is there: two loops writing one playhead would each toggle
     `playing` at the end of the axis, and the second toggle would restart it. */
  usePlayback({
    view, playing: isPlaying, speed: speed.value, tNow: now, t0: scale.t0, t1: scale.t1,
    enabled: canSeek && popped.value.timeline === undefined, onSeek: seekTo, onEnd: togglePlay,
  });

  /* A press anywhere on the plot moves the playhead there, and a drag keeps
     scrubbing -- the big timeline's gesture. Seeking stops the run: playback
     owns the playhead while it plays (playback.ts). */
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

  return (
    <section class="mtl" aria-label="Timeline of the run">
      <div class="mtl-head">
        {model.empty ? null : (
          <Transport
            model={model} tNow={now} playing={isPlaying} speed={speed.value} speedControl="select"
            onSeek={seekTo} onPlayToggle={togglePlay} onSpeed={(s) => { speed.value = s; }}
          />
        )}
        <p class="mtl-cap" title={model.caption.text}>{model.caption.text}</p>
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
      <div class="mtl-plot" ref={ref}>
        <svg
          class={`tl-svg mtl-svg${canSeek ? ' is-seekable' : ''}`}
          width={model.width}
          height={height}
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

          {lanes.map((lane, i) => {
            const y = TOP + i * ROW + (ROW - BAR) / 2;
            return (
              <g key={lane.key} class="mtl-lane" data-lane={lane.id} data-kind={lane.kind}>
                <title>{`${lane.name} — ${lane.sub}`}</title>
                <text class="t-lane t-mono mtl-name" x={2} y={y + BAR - 0.5}>
                  {elideTo(lane.name, scale.plotL - 8, NAME_FS, true)}
                </text>
                <rect class="lane-bg" x={scale.plotL} y={y} width={Math.max(0, scale.plotW)} height={BAR} rx={2} />
                {lane.segments.map((sg) => (sg.w <= 0.5 ? null : (
                  <g key={sg.key} class="tl-seg" data-tip={sg.title}>
                    <title>{sg.title}</title>
                    <rect
                      class={`bar ${sg.phase}${sg.open ? ' is-open' : ''}`}
                      x={sg.x} y={y} width={sg.w} height={BAR}
                    />
                  </g>
                )))}
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
        </svg>
      </div>
    </section>
  );
}

/**
 * The small timeline, while there is a run to show (`trace` is not null).
 * Absent otherwise: with nothing injected there is nothing to glance at.
 */
export function MiniTimeline() {
  const t = trace.value;
  return t === null ? null : <MiniRun t={t} />;
}
