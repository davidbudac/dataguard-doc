/**
 * The timeline drawing.
 *
 * This component maps `buildTimeline`'s model to VNodes and does nothing else:
 * no arithmetic, no wording, no domain state. Everything dynamic is expressed
 * as an SVG presentation attribute or a class, because the page ships under
 * `style-src 'self'` and carries no inline style anywhere (ui.md SS1).
 */

import { useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { TopologyDoc, Trace } from '@/engine';
import { buildTimeline, TL } from './build';
import type { TimelineLane, TimelineMarker, TimelineModel } from './build';
import { Brace, TopBrace } from './Brace';
import { Playhead } from './Playhead';
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
  onPlayToggle?: () => void;
  onSpeed?: (speed: number) => void;
  selection?: string | null;
  onSelect?: (id: string | null) => void;
  /** Export mode: draw at the static figures' scale, no transport. */
  pinnedScale?: boolean;
  /** The transport bar is the shell's business; lessons draw without it. */
  showTransport?: boolean;
}

/* ---------------- pieces ---------------- */

function Defs() {
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

function Lane({ lane, model, selected, onSelect }: {
  lane: TimelineLane;
  model: TimelineModel;
  selected: boolean;
  onSelect?: (id: string | null) => void;
}) {
  const { scale } = model;
  return (
    <g
      class={selected ? 'tl-lane is-selected' : 'tl-lane'}
      data-lane={lane.id}
      onClick={onSelect ? () => onSelect(selected ? null : lane.id) : undefined}
    >
      <rect
        class="lane-bg"
        x={scale.plotL}
        y={lane.y}
        width={Math.max(0, scale.plotW)}
        height={lane.height}
        rx={2}
      />
      <text
        class="t-lane t-mono"
        x={scale.plotL - TL.gutterPad - lane.indent}
        y={lane.y + 17}
        text-anchor="end"
      >
        {lane.name}
      </text>
      <text
        class="t-sub"
        x={scale.plotL - TL.gutterPad - lane.indent}
        y={lane.y + 30}
        text-anchor="end"
      >
        {lane.sub}
      </text>
      {lane.segments.map((sg) => (
        sg.w <= 0.5 ? null : (
          <g key={sg.key} class="tl-seg" data-tip={sg.title}>
            <rect
              class={`bar ${sg.phase}${sg.open ? ' is-open' : ''}`}
              x={sg.x}
              y={lane.y + 5}
              width={sg.w}
              height={lane.height - 10}
            />
            {sg.label === null ? null : (
              <text
                class={`t-bar ${sg.ink}`}
                x={sg.x + sg.w / 2}
                y={lane.y + 24}
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

function Marker({ marker }: { marker: TimelineMarker }) {
  const m = marker;
  const cy = (m.y0 + m.y1) / 2;
  return (
    <g class={`tl-marker tl-marker-${m.kind}`} data-tip={m.label}>
      {m.glyph === 'partition' ? (
        <line class="partition" x1={m.x} y1={m.y0} x2={m.x} y2={m.y1} />
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
          <path class={m.tone} d={`M${m.x},${m.y0 + 27} l6,6 l-6,6 l-6,-6 z`} />
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
      {m.index === null ? null : (
        <g class="tl-marker-n">
          <circle class="tl-marker-nb" cx={m.nx} cy={m.labelY - 13} r={7} />
          <text class="tl-marker-nt t-mono" x={m.nx} y={m.labelY - 10} text-anchor="middle">
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

export function Timeline(props: TimelineProps) {
  const {
    trace, doc, width, tNow, playing = false, speed = 1,
    onSeek, onPlayToggle, onSpeed, selection = null, onSelect,
    pinnedScale = false, showTransport = true,
  } = props;

  const model = useMemo(
    () => buildTimeline(trace, doc, { width, pinnedScale, selection }),
    [trace, doc, width, pinnedScale, selection],
  );
  const [tip, setTip] = useState<TooltipState | null>(null);

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const text = tipFromEvent(e.target);
    if (text === null) { if (tip !== null) setTip(null); return; }
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ text, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const summaryId = 'tl-summary';
  const summary = model.empty
    ? 'Timeline in steady state: no events have been injected, so every lane holds the state the configuration starts in.'
    : `Timeline with ${model.lanes.length} lanes on a seconds axis, from ${model.scale.t0} to ${model.scale.t1} seconds. ${model.caption.text}.`;

  return (
    <section class={model.empty ? 'tl is-empty' : 'tl'} aria-label="Timeline">
      <div class="tl-plot" onPointerMove={onPointerMove} onPointerLeave={() => setTip(null)}>
        <svg
          class="tl-svg"
          width={model.width}
          height={model.height}
          viewBox={`0 0 ${model.width} ${model.height}`}
          role="group"
          aria-describedby={summaryId}
        >
          <desc id={summaryId}>{summary}</desc>
          <Defs />

          {/* the caption, above everything, branching on the outcome */}
          <text
            class={model.caption.tone === 'ink' ? 't-top' : `t-top ${model.caption.tone}`}
            x={model.caption.x ?? model.scale.plotL}
            y={TL.topY}
            text-anchor={model.caption.anchor === 'middle' ? 'middle' : undefined}
          >
            {model.caption.text}
          </text>
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
            <text class="t-tick" x={model.scale.plotL + 6} y={TL.markY}>
              {model.preZone.label}
            </text>
          ) : null}

          {/* grid and axis */}
          {model.ticks.map((tk) => (
            <line key={`g${tk.t}`} class="gridline" x1={tk.x} y1={model.laneTop} x2={tk.x} y2={model.axisY} />
          ))}
          {model.lanes.map((lane) => (
            <Lane
              key={lane.key}
              lane={lane}
              model={model}
              selected={selection !== null && selection === lane.id}
              onSelect={onSelect}
            />
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

          {model.markers.map((m) => <Marker key={m.key} marker={m} />)}
          {model.braces.map((b) => <Brace key={b.key} brace={b} />)}

          {pinnedScale ? null : (
            <Playhead
              model={model}
              tNow={tNow}
              playing={playing}
              {...(onSeek ? { onSeek } : {})}
              {...(onPlayToggle ? { onTogglePlay: onPlayToggle } : {})}
            />
          )}
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

      <div class="legend tl-legend">
        {model.legend.map((l) => (
          <span key={l.swatch}><i class={l.swatch} />{l.label}</span>
        ))}
      </div>

      {showTransport && !pinnedScale && onSeek && onPlayToggle && onSpeed ? (
        <Transport
          model={model}
          tNow={tNow}
          playing={playing}
          speed={speed}
          onSeek={onSeek}
          onPlayToggle={onPlayToggle}
          onSpeed={onSpeed}
        />
      ) : null}

      {/* The same drawing as a table, for anyone reading it with a screen
          reader. It is a duplicate, not a substitute: nothing here is content
          the drawing does not also carry. */}
      <table class="sr">
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
    </section>
  );
}

export default Timeline;
