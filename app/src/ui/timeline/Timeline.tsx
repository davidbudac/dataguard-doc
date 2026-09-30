/**
 * The timeline drawing.
 *
 * This component maps `buildTimeline`'s model to VNodes and does nothing else:
 * no arithmetic, no wording, no domain state. Everything dynamic is expressed
 * as an SVG presentation attribute or a class, because the page ships under
 * `style-src 'self'` and carries no inline style anywhere (ui.md SS1).
 */

import { useRef, useState } from 'preact/hooks';
import { GLYPH } from '../common/eventIcons';
import type { JSX } from 'preact';
import type { TimedEvent, TopologyDoc, Trace } from '@/engine';
import { fmt, gridSpans } from './build';
import type { Density, Layout, TimelineLane, TimelineMarker, TimelineModel } from './build';
import { useRunTimeline } from './run';
import type { RunTimeline } from './run';
import { Brace, TopBrace } from './Brace';
import { EventDrag } from './EventDrag';
import { Playhead } from './Playhead';
import { usePlayback } from './playback';
import { useHostWindow } from '../common/dom';
import { Transport } from './Transport';
import { Tooltip, tipFromEvent } from './Tooltip';
import type { TooltipState } from './Tooltip';
import '@/styles/timeline.css';

export interface TimelineProps {
  trace: Trace;
  doc: TopologyDoc;
  /** Measured plot width in CSS pixels. */
  width: number;
  tNow: number;
  playing?: boolean;
  speed?: number;
  onSeek?: (t: number) => void;
  onMoveEvent?: (index: number, at: number, expected: TimedEvent) => number | null | void;
  onPlayToggle?: () => void;
  onSpeed?: (speed: number) => void;
  selection?: string | null;
  onSelect?: (id: string | null) => void;
  /** Export mode: draw at the static figures' scale, no transport. */
  pinnedScale?: boolean;
  /** The transport bar is the shell's business; lessons draw without it. */
  showTransport?: boolean;
  /** Whether the application's lanes are drawn; they are unless this is false. */
  appView?: boolean;
  /** Present where the reader may fold the application's lanes away. */
  onAppView?: (shown: boolean) => void;
  /** How tightly the lanes are packed (`TL_COMPACT` in build.ts); `full` unless asked. */
  density?: Density;
  /**
   * Draw the run's headline sentence as a line of its own above the plot,
   * truncated with the whole of it as the tooltip, instead of as the drawing's
   * first text row. Split says it there and gives the drawing the row back.
   */
  headline?: boolean;
  /** The colour key and its buttons under the plot; on unless a bar carries them. */
  legend?: boolean;
}

/** What the Application's view button does, said once for every place that offers it. */
export const APP_VIEW_TIP = 'The same run as the application sees it: where the service is, what the sessions see, and the connect string at work.';

/* ---------------- pieces ---------------- */

export function Defs() {
  return (
    <defs>
      <pattern
        id="tlHatch" width="8" height="8"
        patternUnits="userSpaceOnUse" patternTransform="rotate(45)"
      >
        <rect width="8" height="8" class="hatch-bg" />
        <line x1="0" y1="0" x2="0" y2="8" class="hatch-ln" />
      </pattern>
      <marker
        id="tlAv" viewBox="0 0 10 10" refX="9" refY="5"
        markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"
      >
        <path d="M0,1 L10,5 L0,9 z" class="f-vi" />
      </marker>
    </defs>
  );
}

/**
 * One lane. `both` (the default) draws the ground, the bars and the name in
 * one group. The timeline draws it in two passes instead: `bg` puts every
 * lane's ground down before the gridlines, so the ticks read through the gaps
 * and margins of the lanes rather than being painted over by them, and `fg`
 * draws the bars and the name above them. Each pass carries the lane's click,
 * so a press on either selects it.
 */
export function Lane({ lane, model, selected, onSelect, layer = 'both' }: {
  lane: TimelineLane;
  model: TimelineModel;
  selected: boolean;
  onSelect?: ((id: string | null) => void) | undefined;
  layer?: 'bg' | 'fg' | 'both';
}) {
  const { scale } = model;
  const TL = model.layout;
  const bgRect = (
    <rect
      class="lane-bg"
      x={scale.plotL}
      y={lane.y}
      width={Math.max(0, scale.plotW)}
      height={lane.height}
      rx={2}
    />
  );
  if (layer === 'bg') {
    return (
      <g
        class={selected ? 'tl-lane is-selected' : 'tl-lane'}
        data-lane={lane.id}
        onClick={onSelect ? () => onSelect(selected ? null : lane.id) : undefined}
      >
        {bgRect}
      </g>
    );
  }
  return (
    <g
      class={selected ? 'tl-lane is-selected' : 'tl-lane'}
      data-lane={lane.id}
      onClick={onSelect ? () => onSelect(selected ? null : lane.id) : undefined}
    >
      {layer === 'both' ? bgRect : null}
      <text
        class="t-lane t-mono"
        x={scale.plotL - TL.gutterPad - lane.indent}
        y={lane.y + TL.nameDy}
        text-anchor="end"
      >
        {lane.name}
      </text>
      {TL.subDy > 0 ? (
        <text
          class="t-sub"
          x={scale.plotL - TL.gutterPad - lane.indent}
          y={lane.y + TL.subDy}
          text-anchor="end"
        >
          {lane.sub}
        </text>
      ) : <title>{`${lane.name} — ${lane.sub}`}</title>}
      {lane.segments.map((sg) => (
        sg.w <= 0.5 ? null : (
          <g key={sg.key} class="tl-seg" data-tip={sg.title}>
            <rect
              class={`bar ${sg.phase}${sg.open ? ' is-open' : ''}`}
              x={sg.x}
              y={lane.y + TL.barDy}
              width={sg.w}
              height={lane.height - TL.barPad}
            />
            {sg.label === null ? null : (
              <text
                class={`t-bar ${sg.ink}`}
                x={sg.lx}
                y={lane.y + TL.barTextDy}
                text-anchor="middle"
              >
                {sg.label}
              </text>
            )}
          </g>
        )
      ))}
    </g>
  );
}

export function Marker({ marker, layout: TL, spans }: {
  marker: TimelineMarker;
  layout: Layout;
  /** Where a line that crosses every lane may be drawn (`gridSpans`); one run if absent. */
  spans?: [number, number][];
}) {
  const m = marker;
  const cy = (m.y0 + m.y1) / 2;
  return (
    <g class={`tl-marker tl-marker-${m.kind}`} data-tip={m.label}>
      {m.glyph === 'partition' ? (
        <g>
          {(spans ?? [[m.y0, m.y1]]).map(([a, b]) => [Math.max(a, m.y0), Math.min(b, m.y1)] as const)
            .filter(([a, b]) => b > a).map(([a, b]) => (
              <line key={a} class="partition" x1={m.x} y1={a} x2={m.x} y2={b} />
            ))}
        </g>
      ) : null}
      {m.glyph === 'cross' ? (
        <g class={m.stroke}>
          <line class={m.stroke} x1={m.x - 7} y1={cy - 7} x2={m.x + 7} y2={cy + 7} stroke-width="2.5" />
          <line class={m.stroke} x1={m.x + 7} y1={cy - 7} x2={m.x - 7} y2={cy + 7} stroke-width="2.5" />
        </g>
      ) : null}
      {m.glyph === 'diamond' ? (
        <g>
          <line class={m.stroke} x1={m.x} y1={m.y0} x2={m.x} y2={m.y1} stroke-width="2" />
          <path class={m.tone} d={`M${m.x},${m.y0 + TL.laneH / 2 + (TL.inlineNum === 1 ? 4 : 8)} l6,6 l-6,6 l-6,-6 z`} />
        </g>
      ) : null}
      {m.glyph === 'dot' ? (
        <g>
          <line class={m.stroke} x1={m.x} y1={m.y0} x2={m.x} y2={m.y1} stroke-width="2" />
          <circle class={m.tone} cx={m.x} cy={cy} r={4} />
        </g>
      ) : null}
      {m.glyph === 'line' ? (
        <line class={m.stroke} x1={m.x} y1={m.y0} x2={m.x} y2={m.y1} stroke-width="2" />
      ) : null}
      {m.index === null || m.icon === null || TL.chip === 0 ? null : (
        /* What the event did, as the icon the canvas offered for it: one
           chip over the number, joined to it by a short stem. */
        <g class="tl-marker-ico" aria-hidden="true">
          <line class="tl-marker-stem" x1={m.nx} y1={m.labelY - TL.iconDy + 9} x2={m.nx} y2={m.labelY - TL.badgeDy - 7} />
          <rect class="tl-marker-chip" x={m.nx - 9} y={m.labelY - TL.iconDy - 9} width={18} height={18} rx={4} />
          <g transform={`translate(${m.nx - 6.5},${m.labelY - TL.iconDy - 6.5}) scale(${13 / 24})`}>
            {GLYPH[m.icon]}
          </g>
        </g>
      )}
      {m.index === null ? null : (
        <g class="tl-marker-n">
          <circle class="tl-marker-nb" cx={m.nx} cy={m.labelY - TL.badgeDy} r={7} />
          <text class="tl-marker-nt t-mono" x={m.nx} y={m.labelY - TL.badgeDy + 3} text-anchor="middle">
            {m.index}
          </text>
        </g>
      )}
      {m.showLabel ? (
        <text
          class={`t-mark ${m.tone}`}
          x={m.labelX}
          y={m.labelY}
          text-anchor={m.labelAnchor === 'end' ? 'end' : undefined}
        >
          {m.label}
        </text>
      ) : (
        <title>{m.label}</title>
      )}
    </g>
  );
}

/* ---------------- the component ---------------- */

/**
 * The timeline with its own model. Break's Split layout owns the model itself
 * (`useRunTimeline`), because its bar reads it too, and draws `TimelineBody`.
 */
export function Timeline(props: TimelineProps) {
  const run = useRunTimeline({
    trace: props.trace, doc: props.doc, width: props.width,
    ...(props.pinnedScale === undefined ? {} : { pinnedScale: props.pinnedScale }),
    ...(props.selection === undefined ? {} : { selection: props.selection }),
    ...(props.appView === undefined ? {} : { appView: props.appView }),
    ...(props.density === undefined ? {} : { density: props.density }),
  });
  return <TimelineBody {...props} run={run} />;
}

export function TimelineBody(props: TimelineProps & { run: RunTimeline }) {
  const {
    doc, tNow, playing = false, speed = 1, run,
    onSeek, onMoveEvent, onPlayToggle, onSpeed, selection = null, onSelect,
    pinnedScale = false, showTransport = true, appView = true, onAppView,
    headline = false, legend = true,
  } = props;
  const { model } = run;
  const TL = model.layout;
  const moveEvent = (index: number, at: number, expected: TimedEvent) => {
    const result = onMoveEvent?.(index, at, expected);
    run.dropped(index, at, expected, result);
    return result;
  };
  const [tip, setTip] = useState<TooltipState | null>(null);

  /* ▶ moves the playhead. The loop lives in the UI layer -- the engine has no
     clock (CLAUDE.md) -- and leaves through the same `onSeek` a drag uses, so
     there is one way for the playhead to move and playback is a timer on it.
     Nothing to play in the steady state or at the export scale. */
  const view = useHostWindow();
  usePlayback({
    view,
    playing,
    speed,
    tNow,
    t0: model.scale.t0,
    t1: model.scale.t1,
    enabled: !pinnedScale && !model.empty && onSeek !== undefined && onPlayToggle !== undefined,
    ...(onSeek ? { onSeek } : {}),
    ...(onPlayToggle ? { onEnd: onPlayToggle } : {}),
  });

  /* A press anywhere on the plot moves the playhead there, and a drag from it
     keeps scrubbing. The playhead's own handle and the event markers stop the
     press before it reaches here, so grabbing either still does what it did.
     A press that seeks is not also a click on the lane under it: toggling a
     lane's highlight on every seek would make the timeline flicker. */
  const seek = useRef<{ pointer: number } | null>(null);
  const seeked = useRef(false);
  const tAtPointer = (e: JSX.TargetedPointerEvent<SVGSVGElement>): number | null => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return null;
    const x = (e.clientX - box.left) * (model.width / box.width);
    if (x < model.scale.plotL - 4 || x > model.scale.plotR + 4) return null;
    return Math.round(model.scale.clampT(model.scale.tAt(x)) * 10) / 10;
  };
  const canSeek = onSeek !== undefined && !pinnedScale && !model.empty;
  const onPlotDown = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    seeked.current = false;
    if (!canSeek || e.button !== 0) return;
    const t = tAtPointer(e);
    if (t === null) return;
    e.preventDefault();
    if (playing) onPlayToggle?.();
    seek.current = { pointer: e.pointerId };
    seeked.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSeek(t);
  };
  const onPlotMove = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (seek.current?.pointer !== e.pointerId || !onSeek) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const x = (e.clientX - box.left) * (model.width / box.width);
    onSeek(Math.round(model.scale.clampT(model.scale.tAt(x)) * 10) / 10);
  };
  const onPlotUp = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (seek.current?.pointer !== e.pointerId) return;
    seek.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const selectLane = onSelect === undefined ? undefined : (id: string | null): void => {
    if (seeked.current) { seeked.current = false; return; }
    onSelect(id);
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const text = tipFromEvent(e.target);
    if (text === null) { if (tip !== null) setTip(null); return; }
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const summaryId = 'tl-summary';
  const summary = model.empty
    ? 'Timeline in steady state: no events have been injected, so every lane holds the state the configuration starts in.'
    : `Timeline with ${model.lanes.length} lanes on a seconds axis, from ${fmt(model.scale.t0)} to ${fmt(model.scale.t1)} seconds. ${model.caption.text}.`;

  return (
    <section class={model.empty ? 'tl is-empty' : 'tl'} aria-label="Timeline">
      {headline ? (
        <p class={`tl-headline${model.caption.tone === 'ink' ? '' : ` ${model.caption.tone}`}`} title={model.caption.text}>
          {model.caption.text}
        </p>
      ) : null}
      <div class="tl-plot" onPointerMove={onPointerMove} onPointerLeave={() => setTip(null)}>
        <svg
          class={canSeek ? 'tl-svg is-seekable' : 'tl-svg'}
          width={model.width}
          height={model.height}
          viewBox={`0 0 ${model.width} ${model.height}`}
          role="group"
          aria-describedby={summaryId}
          onPointerDown={canSeek ? onPlotDown : undefined}
          onPointerMove={canSeek ? onPlotMove : undefined}
          onPointerUp={canSeek ? onPlotUp : undefined}
          onPointerCancel={canSeek ? onPlotUp : undefined}
        >
          <desc id={summaryId}>{summary}</desc>
          <Defs />

          {/* the caption, above everything, branching on the outcome */}
          {headline ? null : (
            <text
              class={model.caption.tone === 'ink' ? 't-top' : `t-top ${model.caption.tone}`}
              x={model.caption.x ?? model.scale.plotL}
              y={TL.topY}
              text-anchor={model.caption.anchor === 'middle' ? 'middle' : undefined}
            >
              {model.caption.text}
            </text>
          )}
          {model.topBrace ? <TopBrace {...model.topBrace} /> : null}

          {/* the pre-failure band */}
          {model.preZone.w > 0 ? (
            <rect
              class="prezone"
              x={model.preZone.x}
              y={model.laneTop}
              width={model.preZone.w}
              height={model.lanesBottom - model.laneTop}
            />
          ) : null}
          {model.preZone.label ? (
            <text class="t-tick" x={model.scale.plotL + 6} y={TL.preY}>
              {model.preZone.label}
            </text>
          ) : null}

          {/* grid and axis */}
          {model.lanes.map((lane) => (
            <Lane
              key={`bg-${lane.key}`}
              layer="bg"
              lane={lane}
              model={model}
              selected={selection !== null && selection === lane.id}
              onSelect={selectLane}
            />
          ))}
          {model.ticks.flatMap((tk) => gridSpans(model).map(([y0, y1]) => (
            <line key={`g${tk.t}-${y0}`} class="gridline" x1={tk.x} y1={y0} x2={tk.x} y2={y1} />
          )))}
          {model.lanes.map((lane) => (
            <Lane
              key={lane.key}
              layer="fg"
              lane={lane}
              model={model}
              selected={selection !== null && selection === lane.id}
              onSelect={selectLane}
            />
          ))}
          {model.appSections.map((sec) => (
            /* The line that heads one application's three lanes, and the one
               reading they add up to -- this page's model, said in its tip. */
            <g class="tl-app-head" key={sec.id} data-tip={sec.basis}>
              <line
                class="tl-app-rule" x1={model.scale.plotL} y1={sec.y - TL.appRuleDy}
                x2={model.scale.plotR} y2={sec.y - TL.appRuleDy}
              />
              <text class="t-top t-app-title" x={model.scale.plotL} y={sec.y}>
                {sec.title}
                <tspan
                  class={sec.tone === 'ink' ? 't-app-note' : `t-app-note ${sec.tone}`}
                  dx="8"
                >
                  {sec.note}
                </tspan>
              </text>
              <text class="t-tick" x={model.scale.plotR} y={sec.y} text-anchor="end">
                this page&rsquo;s model
              </text>
            </g>
          ))}
          {model.ticks.map((tk) => (
            <text key={`t${tk.t}`} class="t-tick t-mono" x={tk.x} y={model.axisY + 16} text-anchor="middle">
              {tk.label}
            </text>
          ))}
          <line class="ax" x1={model.scale.plotL} y1={model.axisY} x2={model.scale.plotR} y2={model.axisY} />
          <text class="t-tick t-mono" x={model.scale.plotR} y={model.axisY + 30} text-anchor="end">
            {model.axisLabel}
          </text>
          {model.zeroNote ? (
            <text class="t-tick" x={model.scale.plotL} y={model.axisY + 30}>{model.zeroNote}</text>
          ) : null}

          {model.markers.filter((m) => !onMoveEvent || pinnedScale || m.kind !== 'event')
            .map((m) => <Marker key={m.key} marker={m} layout={TL} spans={gridSpans(model, model.laneTop - 4)} />)}
          {model.braces.map((b) => <Brace key={b.key} brace={b} />)}

          {pinnedScale ? null : (
            <Playhead
              model={model}
              tNow={tNow}
              playing={playing}
              clearHeads
              {...(onSeek ? { onSeek } : {})}
              {...(onPlayToggle ? { onTogglePlay: onPlayToggle } : {})}
            />
          )}
          {/* Above the playhead, so grabbing an event cannot seek instead. */}
          {!onMoveEvent || pinnedScale ? null : model.markers.filter((m) => m.kind === 'event').map((m) => (
            <EventDrag key={m.key} marker={m} model={model} doc={doc} onMove={moveEvent}
              onStart={() => { setTip(null); if (playing) onPlayToggle?.(); }}>
              <Marker marker={m} layout={TL} spans={gridSpans(model, model.laneTop - 4)} />
            </EventDrag>
          ))}
        </svg>
        <Tooltip tip={tip} />
      </div>

      {model.quietLinks > 0 ? (
        <p class="tl-note">
          {model.quietLinks === 1
            ? '1 network link stayed up throughout and has no lane.'
            : `${model.quietLinks} network links stayed up throughout and have no lanes.`}
        </p>
      ) : null}

      {/* The colour key reads once and then stays read, so it scrolls with the
          drawing it explains. Pinning it cost a second row of the sticky band
          -- 32 px of a 226 px dock at 1280x720, every scroll position -- and
          the transport is what has to stay reachable. */}
      {legend ? (
        <div class="legend tl-legend">
          {run.held && !pinnedScale ? <button type="button" class="btn" onClick={run.fit}>Fit timeline</button> : null}
          {onAppView && (doc.applications?.length ?? 0) > 0 && !pinnedScale ? (
            <button
              type="button" class="btn" aria-pressed={appView}
              title={APP_VIEW_TIP}
              onClick={() => onAppView(!appView)}
            >
              {(doc.applications?.length ?? 0) > 1 ? 'Applications’ views' : 'Application’s view'}
            </button>
          ) : null}
          {model.legend.map((l) => (
            <span key={l.swatch}><i class={l.swatch} />{l.label}</span>
          ))}
        </div>
      ) : null}

      {/* The foot of the drawing: the controls, and nothing else. It is the
          timeline's last flow child, so `position: sticky` inside `.tl` pins it
          to the bottom of whichever box is scrolling -- the bottom dock in
          Break, the rail in Learn -- while the lanes and the braces scroll
          behind it. A twelve-lane run is taller than the dock, and a transport
          nobody ever sees is a page that looks like a static picture
          (timeline.css, `.tl-foot`). No transport, no band: an empty hairline
          strip pinned to the bottom says nothing. */}
      {showTransport && !pinnedScale && onSeek && onPlayToggle && onSpeed ? (
        <div class="tl-foot">
          <Transport
            model={model}
            tNow={tNow}
            playing={playing}
            speed={speed}
            onSeek={onSeek}
            onPlayToggle={onPlayToggle}
            onSpeed={onSpeed}
          />
        </div>
      ) : null}

      {/* The same drawing as a table, for anyone reading it with a screen
          reader. It is a duplicate, not a substitute: nothing here is content
          the drawing does not also carry.

          `.sr` goes on the wrapping <div>, never on the <table>: a table's used
          width can never fall below its min-content width, so `.sr` on the
          table itself left a ~1080 px box inside the dock, gave the dock a
          horizontal scrollbar at 1280x720 and -- because `position: sticky`
          pins on one axis only -- carried the sticky foot sideways out of view
          with it. A block box honours `width: 1px` and its `overflow: hidden`
          really does clip. Same shape as TopoCanvas's a11y table. */}
      <div class="sr">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr><th scope="col">Lane</th><th scope="col">Role</th><th scope="col">From</th><th scope="col">To</th><th scope="col">State</th></tr>
          </thead>
          <tbody>
            {model.lanes.flatMap((lane) => lane.segments.map((sg) => (
              <tr key={sg.key}>
                <td>{lane.name}</td>
                <td>{lane.sub}</td>
                <td>{sg.t0}</td>
                <td>{sg.t1}</td>
                <td>{sg.title}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default Timeline;
