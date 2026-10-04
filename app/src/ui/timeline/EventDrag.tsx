/** A single injected event: preview against a frozen axis, commit once on drop. */
import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { eventTimeBounds, snapEventTime } from '../break/event-order';
import type { TimelineMarker, TimelineModel } from './build';
import { fmt, spoken } from './build';

export interface EventDragProps {
  marker: TimelineMarker;
  model: TimelineModel;
  doc: TopologyDoc;
  onMove: (index: number, at: number, expected: TimedEvent) => number | null | void;
  onStart?: () => void;
  /**
   * Where the time readout sits while dragging. `above` (the Timeline) is over the pin,
   * centred. Lanes' pins start at the very top of the plot, with no room over them, so there
   * the readout goes `beside` the icon, on whichever side has room inside the plot.
   */
  readout?: 'above' | 'beside';
  children: ComponentChildren;
}

export function EventDrag({ marker, model, doc, onMove, onStart, readout = 'above', children }: EventDragProps) {
  const index = marker.index! - 1;
  const event = doc.events[index]!;
  const bounds = eventTimeBounds(doc, index);
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{
    pointer: number; clientX: number; at: number; pxPerSecond: number;
    min: number; max: number; event: TimedEvent; index: number; next: number;
  } | null>(null);
  const clamp = (at: number, min = bounds.min, max = bounds.max): number =>
    Math.max(min, Math.min(max, snapEventTime(at)));
  const reset = (): void => { drag.current = null; setPreview(null); };
  const move = (e: JSX.TargetedPointerEvent<SVGGElement>): void => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    e.stopPropagation();
    d.next = clamp(d.at + (e.clientX - d.clientX) / d.pxPerSecond, d.min, d.max);
    setPreview(d.next);
  };
  const commit = (el: SVGGElement, i: number, at: number, source: TimedEvent): void => {
    const svg = el.ownerSVGElement;
    const nextIndex = onMove(i, at, source);
    // Sorting changes the index. Keep keyboard focus on the event just moved.
    if (typeof nextIndex === 'number' && nextIndex >= 0) {
      setTimeout(() => svg?.querySelector<SVGGElement>(`[data-event-index="${nextIndex}"]`)?.focus(), 0);
    }
  };
  const at = preview ?? event.at;
  const TL = model.layout;
  const delta = model.scale.x(at) - model.scale.x(event.at);
  const beside = readout === 'beside' ? besideReadout(marker.nx + delta, `${fmt(at)} s`.length, model.width) : 'start';
  return (
    <g
      class={`tl-event-drag${preview === null ? '' : ' is-dragging'}`}
      data-event-index={index}
      role="slider"
      tabindex={0}
      aria-label={`Event ${index + 1}: ${marker.label}`}
      aria-valuemin={spoken(bounds.min)}
      aria-valuemax={spoken(bounds.max)}
      aria-valuenow={spoken(at)}
      aria-valuetext={`${fmt(at)} seconds`}
      transform={`translate(${delta},0)`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const svg = e.currentTarget.ownerSVGElement;
        const width = svg?.getBoundingClientRect().width ?? model.width;
        const pxPerSecond = (model.scale.x(1) - model.scale.x(0)) * (width > 0 ? width / model.width : 1);
        drag.current = {
          pointer: e.pointerId, clientX: e.clientX, at: event.at, pxPerSecond,
          min: bounds.min, max: Math.min(bounds.max, Math.floor(model.scale.t1 * 10) / 10), event, index, next: event.at,
        };
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart?.();
        setPreview(event.at);
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) return;
        move(e);
        reset();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        commit(e.currentTarget, d.index, d.next, d.event);
      }}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reset(); return; }
        if (drag.current) return;
        const step = e.shiftKey ? 0.1 : 1;
        let next: number;
        switch (e.key) {
          case 'ArrowLeft': case 'ArrowDown': next = event.at - step; break;
          case 'ArrowRight': case 'ArrowUp': next = event.at + step; break;
          case 'Home': next = bounds.min; break;
          case 'End': next = bounds.max; break;
          default: return;
        }
        e.preventDefault();
        e.stopPropagation();
        onStart?.();
        commit(e.currentTarget, index, clamp(next), event);
      }}
    >
      <title>{`Drag to change time. Arrow keys: 1 s; Shift: 0.1 s. Allowed: ${bounds.min}–${bounds.max} s; related events stay in order.`}</title>
      {/* Tall enough to take the icon over the badge too: either one grabs the event. */}
      <rect
        class="tl-event-hit" x={marker.nx - (7 * TL.msc + 4)} y={marker.labelY - TL.iconDy - (7 * TL.msc + 4)}
        width={2 * (7 * TL.msc + 4)} height={TL.iconDy - TL.badgeDy + 2 * (7 * TL.msc + 4) - 2} rx={5}
      />
      {children}
      {preview === null ? null : readout === 'above' ? (
        <text class="tl-event-time t-mono" x={marker.nx} y={marker.labelY - TL.iconDy - 14} text-anchor="middle">
          {`${fmt(at)} s`}
        </text>
      ) : (
        <text
          class="tl-event-time t-mono"
          x={marker.nx + (beside === 'start' ? READOUT_GAP : -READOUT_GAP)} y={marker.labelY - TL.iconDy + 4}
          text-anchor={beside}
        >
          {`${fmt(at)} s`}
        </text>
      )}
    </g>
  );
}

/** ~6.7 px a glyph at 11 px mono, plus the halo. */
const GLYPH_W = 6.7;
const READOUT_GAP = 16; // half the icon chip (11) and a little air
const READOUT_EDGE = 4;

/**
 * Which side of a pin at `pinX` (its dragged position) the readout goes on: right of the icon
 * chip (`start`), else left of it (`end`), whichever fits inside the plot's width.
 */
export function besideReadout(pinX: number, chars: number, width: number): 'start' | 'end' {
  const w = chars * GLYPH_W + 6;
  if (pinX + READOUT_GAP + w <= width - READOUT_EDGE) return 'start';
  return pinX - READOUT_GAP - w >= READOUT_EDGE ? 'end' : 'start';
}
