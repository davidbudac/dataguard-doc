/** Scenario composition reads the scheduled events, never the calculated trace. */
import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { applicationsOf } from '@/engine';
import type { TimedEvent } from '@/engine';
import { topology } from '@/state/derived';
import { canEdit, playing, scrubbing, select, selection, tNow, viewport } from '@/state/view';
import { Action } from '../inspector/controls';
import { WHY } from '../inspector/why';
import { actionsFor, describeEvent, eventGlyph, runAction, setEventTime, snapT } from '../break/events';
import { eventDragBounds, MAX_EVENT_TIME } from '../break/event-order';
import { GlyphIcon } from '../common/glyphs';
import { eventIcon, GLYPH } from '../common/eventIcons';
import { ScenarioRow } from '../break/ScenarioRow';
import { useWidth } from '../common/use-width';
import { goToStep } from '../workflow';

export function ScenarioEditor() {
  const doc = topology.value;
  const editable = canEdit(viewport.value);
  const [actionId, setActionId] = useState('');
  const targets = [
    ...doc.sites.map(s => ({ id: s.id as string, label: `Data centre · ${s.name}` })),
    ...doc.members.flatMap(m => [
      { id: m.id as string, label: `Member · ${m.name}` },
      ...(m.instances.length > 1 ? m.instances.map((i, n) => ({ id: `${m.id}~${n + 1}`, label: `Instance · ${i.name}` })) : []),
    ]),
    ...doc.observers.map(o => ({ id: o.id as string, label: `Observer · ${o.id}` })),
    ...applicationsOf(doc).map(a => ({ id: a.id as string, label: `Application · ${a.id}` })),
    ...doc.links.map(l => ({ id: l.id as string, label: `Link · ${l.ends.join(' ↔ ')}` })),
  ];
  const target = selection.value[0] ?? '';
  const actions = actionsFor(doc, target ? [target] : [], snapT(tNow.value)).filter(a => !a.property);
  const action = actions.find(a => a.id === actionId) ?? actions.find(a => a.enabled.state === 'on') ?? actions[0];
  return <section class="scenario-editor" aria-label="Scenario editor">
    <ScenarioRow label="Start with" />
    <div class="scenario-compose">
      <label>At <input type="number" aria-label="New event time in seconds" min={0} max={MAX_EVENT_TIME} step={0.1}
        value={tNow.value} disabled={!editable} onChange={e => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n)) tNow.value = snapT(Math.max(0, Math.min(MAX_EVENT_TIME, n)));
        }} /> s</label>
      <label class="scenario-target">Target
        <select aria-label="Event target" value={target} disabled={!editable} onChange={e => { select(e.currentTarget.value); setActionId(''); }}>
          <option value="">Select a card or choose…</option>
          {targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <label class="scenario-action">Event
        <select aria-label="Event action" value={action?.id ?? ''} disabled={!editable || !actions.length}
          onChange={e => setActionId(e.currentTarget.value)}>
          {!actions.length ? <option value="">Select a target first</option> : null}
          {actions.map(a => <option key={a.id} value={a.id} disabled={a.enabled.state === 'off'}>
            {a.label}{a.enabled.state === 'off' ? ` — ${a.enabled.why}` : ''}
          </option>)}
        </select>
      </label>
      <Action label="Schedule event" enabled={!editable ? { state: 'off', why: WHY.readOnlyHere }
        : action?.enabled ?? { state: 'off', why: 'Select a target and an event.' }}
        onClick={() => { if (action) runAction(action, { keepPlayhead: true }); }} />
    </div>
    <ScenarioTimeline />
  </section>;
}

type Drag = { index: number; event: TimedEvent; pointer: number; startX: number; startAt: number; perPixel: number; min: number; max: number };

export function ScenarioTimeline() {
  const doc = topology.value;
  const events = doc.events;
  const editable = canEdit(viewport.value);
  const [measure, measured] = useWidth();
  const drag = useRef<Drag | null>(null);
  /* A press on the plot outside a marker moves the drawing's time there and
     keeps moving it while held, like Simulate's timeline; markers stop
     the press, so grabbing one never seeks. */
  const seek = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ index: number; at: number } | null>(null);
  const width = Math.max(660, measured);
  const left = 265;
  const right = width - 65;
  const horizon = Math.min(MAX_EVENT_TIME, Math.max(60, Math.ceil((Math.max(0, ...events.map(e => e.at)) + 20) / 10) * 10));
  const x = (at: number): number => left + at / horizon * (right - left);
  const height = Math.max(1, events.length) * 36 + 54;
  const bounded = (at: number, min: number, max: number): number => snapT(Math.max(min, Math.min(max, at)));
  const playheadT = Math.min(horizon, tNow.value);
  const seekTo = (t: number): void => { tNow.value = bounded(t, 0, horizon); };
  const tAtPointer = (e: JSX.TargetedPointerEvent<SVGSVGElement>): number => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - box.left) * width / box.width;
    return (px - left) / (right - left) * horizon;
  };
  const down = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (!events.length || e.button !== 0 || drag.current) return;
    e.preventDefault();
    playing.value = false;
    seek.current = e.pointerId;
    scrubbing.value = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekTo(tAtPointer(e));
  };
  const endSeek = (e: JSX.TargetedPointerEvent<SVGSVGElement>): boolean => {
    if (seek.current !== e.pointerId) return false;
    seek.current = null;
    scrubbing.value = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    return true;
  };
  const move = (e: JSX.TargetedPointerEvent<SVGSVGElement>): void => {
    if (seek.current === e.pointerId) { seekTo(tAtPointer(e)); return; }
    const d = drag.current;
    if (d?.pointer !== e.pointerId) return;
    setPreview({ index: d.index, at: bounded(d.startAt + (e.clientX - d.startX) * d.perPixel, d.min, d.max) });
  };
  const finish = (e: JSX.TargetedPointerEvent<SVGSVGElement>, cancel = false): void => {
    if (endSeek(e)) return;
    const d = drag.current;
    if (d?.pointer !== e.pointerId) return;
    drag.current = null;
    if (!cancel) setEventTime(d.index, bounded(d.startAt + (e.clientX - d.startX) * d.perPixel, d.min, d.max), d.event);
    setPreview(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return <div class="scenario-timeline" ref={measure}>
    <div class="scenario-timeline-head">
      <strong>Scheduled events</strong>
      {/* The way to step 3, where the schedule is: the step bar's button is a
          screen away from the thing it runs. */}
      <button
        type="button" class="btn workflow-next scenario-run"
        title={events.length ? 'Step 3: inspect the response to this schedule' : 'Nothing scheduled yet: step 3 shows the configuration running as drawn'}
        onClick={() => goToStep('break')}
      >
        {events.length ? 'Simulate →' : 'Simulate steady state →'}
      </button>
    </div>
    <div class="scenario-plot">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Scheduled events timeline"
        class={events.length ? 'is-seekable' : undefined}
        onPointerDown={down} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)}
        onKeyDown={e => { if (e.key === 'Escape' && drag.current) { drag.current = null; setPreview(null); e.stopPropagation(); } }}>
        {Array.from({ length: 7 }, (_, i) => horizon * i / 6).map(at => <g key={at}>
          <line class="scenario-grid" x1={x(at)} x2={x(at)} y1={25} y2={height - 6} />
          <text class="scenario-tick" x={x(at)} y={16} text-anchor="middle">{snapT(at)} s</text>
        </g>)}
        {events.length ? <g class="scenario-playhead" role="slider" tabindex={0} aria-label="Drawing time"
          aria-valuemin={0} aria-valuemax={horizon} aria-valuenow={snapT(tNow.value)} aria-valuetext={`${snapT(tNow.value)} seconds`}
          onKeyDown={e => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            playing.value = false;
            seekTo(e.key === 'Home' ? 0 : e.key === 'End' ? horizon
              : tNow.value + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 1));
          }}>
          <title>The drawing shows the scenario at this time. Click or drag the timeline to move it; arrow keys move by 1 s, Shift by 0.1 s.</title>
          <rect class="scenario-playhead-hit" x={x(playheadT) - 6} y={22} width={12} height={height - 24} />
          <line x1={x(playheadT)} x2={x(playheadT)} y1={22} y2={height - 2} />
          <text x={x(playheadT)} y={height - 2} text-anchor="middle">drawing at {snapT(tNow.value)} s</text>
        </g> : null}
        {!events.length ? <text class="scenario-empty" x={12} y={52}>No scheduled events. Choose a scenario or schedule an event above.</text> : null}
        {events.map((event, index) => {
          const at = preview?.index === index ? preview.at : event.at;
          const y = 44 + index * 36;
          const label = describeEvent(doc, event);
          const bounds = eventDragBounds(doc, index);
          return <g key={index}>
            <title>{label}</title>
            <GlyphIcon name={eventGlyph(doc, event)} class="scenario-label-ico" x={12} y={y - 8} />
            <text class="scenario-label" x={34} y={y + 4}>{label.length > 34 ? label.slice(0, 32) + '…' : label}</text>
            <line class="scenario-track" x1={left} x2={right} y1={y} y2={y} />
            <g class={`scenario-marker${editable ? ' is-editable' : ''}`} role={editable ? 'slider' : 'img'}
              tabindex={editable ? 0 : undefined} aria-label={`Time of ${label}`}
              aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={at} aria-valuetext={`${at} seconds`}
              onPointerDown={e => {
                if (!editable || e.button !== 0) return;
                const svg = e.currentTarget.ownerSVGElement;
                if (!svg) return;
                e.preventDefault(); e.stopPropagation();
                e.currentTarget.focus();
                drag.current = { index, event, pointer: e.pointerId, startX: e.clientX, startAt: event.at,
                  perPixel: horizon / (right - left) * width / svg.getBoundingClientRect().width, ...bounds };
                svg.setPointerCapture?.(e.pointerId);
              }}
              onKeyDown={e => {
                if (!editable || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                e.preventDefault(); e.stopPropagation();
                const next = e.key === 'Home' ? bounds.min : e.key === 'End' ? bounds.max
                  : event.at + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 1);
                setEventTime(index, bounded(next, bounds.min, bounds.max), event);
              }}>
              <rect class="scenario-hit" x={x(at) - 14} y={y - 15} width={28} height={30} rx={5} />
              <circle cx={x(at)} cy={y} r={9} />
              <g class="scenario-marker-ico" transform={`translate(${x(at) - 6},${y - 6}) scale(${12 / 24})`}>
                {GLYPH[eventIcon(event.kind)]}
              </g>
              <text class="scenario-time" x={x(at) + 16} y={y + 4}>{at} s</text>
            </g>
          </g>;
        })}
      </svg>
    </div>
  </div>;
}
