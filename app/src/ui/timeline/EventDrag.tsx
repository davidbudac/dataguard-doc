/** A single injected event: preview against a frozen axis, commit once on drop. */
import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { eventTimeBounds, snapEventTime } from '../break/event-order';
import type { TimelineMarker, TimelineModel } from './build';
import { fmt } from './build';

export interface EventDragProps {
  marker: TimelineMarker;
  model: TimelineModel;
  doc: TopologyDoc;
  onMove: (index: number, at: number, expected: TimedEvent) => number | null | void;
  onStart?: () => void;
  children: ComponentChildren;
}

export function EventDrag({ marker, model, doc, onMove, onStart, children }: EventDragProps) {
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
  return (
    <g
      class={`tl-event-drag${preview === null ? '' : ' is-dragging'}`}
      data-event-index={index}
      role="slider"
      tabindex={0}
      aria-label={`Event ${index + 1}: ${marker.label}`}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={at}
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
      <rect class="tl-event-hit" x={marker.nx - 11} y={marker.labelY - TL.iconDy - 11} width={22} height={TL.iconDy - TL.badgeDy + 20} rx={5} />
      {children}
      {preview === null ? null : (
        <text class="tl-event-time t-mono" x={marker.nx} y={marker.labelY - TL.iconDy - 14} text-anchor="middle">
          {`${fmt(at)} s`}
        </text>
      )}
    </g>
  );
}
