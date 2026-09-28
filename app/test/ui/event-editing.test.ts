/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { hostId, memberId, simulate, sortEvents } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { classic } from '@/presets';
import { doc, makeDoc } from '@/state/doc';
import { resetHistory, undo, redo, undoStack } from '@/state/history';
import { mode, viewport } from '@/state/view';
import { eventTimeBounds, eventTimeRefusal, reorderRefusal } from '@/ui/break/event-order';
import { reorderEvent, setEventTime } from '@/ui/break/events';
import { BreakRail } from '@/ui/break/BreakRail';
import { Timeline } from '@/ui/timeline/Timeline';
import { buildTimeline } from '@/ui/timeline/build';

const crash = (at: number, id = 'dc1-prm01'): TimedEvent => ({ at, kind: 'host.down', host: hostId(id) });
const restore = (at: number): TimedEvent => ({ at, kind: 'host.up', host: hostId('dc1-prm01') });
const configuration = (events: TimedEvent[]): TopologyDoc => ({ ...classic.doc(), events: sortEvents(events) });
let root: HTMLDivElement;
beforeEach(() => {
  // jsdom lacks pointer event properties; let Preact use native lowercase names.
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    Object.defineProperty(SVGElement.prototype, `on${name}`, { value: null, configurable: true });
  }
  root = document.createElement('div');
  document.body.append(root);
  mode.value = 'break';
  viewport.value = 'wide';
});
afterEach(() => { act(() => render(null, root)); root.remove(); });

it('allows independent events to exchange times in one undo step', () => {
  resetHistory(makeDoc(configuration([crash(0), crash(20, 'dc2-sby01')])));
  reorderEvent(1, -1);
  expect(doc.value.topology.events).toEqual([crash(0, 'dc2-sby01'), crash(20)]);
  expect(undoStack.value).toHaveLength(1);
  undo();
  expect(doc.value.topology.events).toEqual([crash(0), crash(20, 'dc2-sby01')]);
  redo();
  expect(doc.value.topology.events[0]).toEqual(crash(0, 'dc2-sby01'));
});

it('keeps repeated failures and recoveries on a host in sequence', () => {
  const d = configuration([crash(0), restore(10), crash(20)]);
  expect(eventTimeBounds(d, 1)).toEqual({ min: 0.1, max: 19.9 });
  expect(eventTimeRefusal(d, 1, 5)).toBeNull();
  expect(reorderRefusal(d, 1, -1)).toContain('related events');
  expect(reorderRefusal(d, 1, 1)).toContain('related events');
  resetHistory(makeDoc(d));
  setEventTime(1, 25);
  expect(doc.value.topology.events).toEqual(d.events);
  expect(undoStack.value).toHaveLength(0);
});

it('keeps containment recovery and role commands in order', () => {
  const d = configuration([
    { at: 0, kind: 'site.down', site: classic.doc().sites[0]!.id },
    restore(10),
    { at: 20, kind: 'cmd.failover', to: memberId('sby01') },
    { at: 40, kind: 'cmd.reinstate', member: memberId('prm01') },
  ]);
  expect(eventTimeBounds(d, 1).min).toBe(0.1);
  expect(reorderRefusal(d, 3, -1)).toContain('related events');
});

it('does not pretend swapping simultaneous events changes their time order', () => {
  const d = configuration([crash(0), crash(0, 'dc2-sby01')]);
  expect(reorderRefusal(d, 0, 1)).toContain('Same time');
  expect(eventTimeRefusal(d, 1, 5)).toBeNull();
});

it('rejects out-of-range edits, no-ops and stale event references without history', () => {
  const d = configuration([crash(10)]);
  resetHistory(makeDoc(d));
  for (const t of [NaN, Infinity, -1, 901, 10]) setEventTime(0, t);
  setEventTime(0, 20, crash(10));
  expect(doc.value.topology.events).toEqual(d.events);
  expect(undoStack.value).toHaveLength(0);
});

it('reorders from the rail and disables a nonsensical recovery swap with a reason', () => {
  resetHistory(makeDoc(configuration([crash(0), crash(10, 'dc2-sby01'), restore(20)])));
  act(() => render(h(BreakRail, {}), root));
  const firstLater = root.querySelector<HTMLButtonElement>('.evt-order button')!;
  expect(firstLater.disabled).toBe(false);
  act(() => firstLater.click());
  expect(doc.value.topology.events[0]).toEqual(crash(0, 'dc2-sby01'));
  const last = root.querySelector('.evt:last-child')!;
  expect(last.querySelector<HTMLButtonElement>('.evt-order button')?.disabled).toBe(true);
  expect(last.textContent).toContain('Keep related events in order');
});

function mountTimeline(events: TimedEvent[], editable = true) {
  const d = configuration(events);
  const onMove = vi.fn();
  act(() => render(h(Timeline, { doc: d, trace: simulate(d, d.events), width: 900, tNow: 0,
    ...(editable ? { onMoveEvent: onMove } : {}) }), root));
  const svg = root.querySelector('svg')!;
  svg.getBoundingClientRect = () => ({ width: 900, left: 0 } as DOMRect);
  const handle = root.querySelector<SVGGElement>('.tl-event-drag')!;
  if (handle) {
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = vi.fn();
  }
  return { d, onMove, handle };
}
function pointer(el: Element, type: string, x: number) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  act(() => { el.dispatchEvent(e); });
}

describe('timeline event gestures', () => {
  it('previews during dragging and commits the original event once on drop', () => {
    const { d, onMove, handle } = mountTimeline([crash(0)]);
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 300);
    expect(onMove).not.toHaveBeenCalled();
    expect(handle.classList.contains('is-dragging')).toBe(true);
    const at = Number(handle.getAttribute('aria-valuenow'));
    expect(at).toBeGreaterThan(0);
    pointer(handle, 'pointerup', 300);
    expect(onMove).toHaveBeenCalledExactlyOnceWith(0, at, d.events[0]);
  });

  it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels on %s', (cancel) => {
    const { onMove, handle } = mountTimeline([crash(0)]);
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointermove', 300);
    if (cancel === 'Escape') act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: cancel, bubbles: true })); });
    else pointer(handle, cancel, 300);
    pointer(handle, 'pointerup', 300);
    expect(onMove).not.toHaveBeenCalled();
    expect(handle.getAttribute('aria-valuenow')).toBe('0');
  });

  it('clamps a drag before its related recovery and supports keyboard precision', () => {
    const { onMove, handle, d } = mountTimeline([crash(0), restore(10)]);
    pointer(handle, 'pointerdown', 200);
    pointer(handle, 'pointerup', 20000);
    expect(onMove).toHaveBeenLastCalledWith(0, 9.9, d.events[0]);
    act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })); });
    expect(onMove).toHaveBeenLastCalledWith(0, 0.1, d.events[0]);
  });

  it('exposes only injected events as editable sliders', () => {
    mountTimeline([crash(0)]);
    expect(root.querySelectorAll('.tl-event-drag')).toHaveLength(1);
    expect(root.querySelectorAll('.tl-event-drag .tl-marker-decision')).toHaveLength(0);
    mountTimeline([crash(0)], false);
    expect(root.querySelector('.tl-event-drag')).toBeNull();
  });
});

// Exercise the real document update and redraw, not just a mocked drop callback.
describe('dragging with a live document', () => {
  function mountLive() {
    resetHistory(makeDoc(configuration([crash(40, 'dc3-obs01')])));
    function Live() {
      const d = doc.value.topology;
      return h(Timeline, { doc: d, trace: simulate(d, d.events), width: 900,
        tNow: 0, onMoveEvent: setEventTime });
    }
    act(() => render(h(Live, {}), root));
    root.querySelector('svg')!.getBoundingClientRect = () => ({ width: 900, left: 0 } as DOMRect);
    const handle = root.querySelector<SVGGElement>('.tl-event-drag')!;
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = vi.fn();
    return handle;
  }

  it('keeps the dropped marker at the preview position when the last event moves', () => {
    const handle = mountLive();
    const before = Number(handle.querySelector('.tl-event-hit')!.getAttribute('x'));
    pointer(handle, 'pointerdown', 600);
    pointer(handle, 'pointermove', 480);
    const at = Number(handle.getAttribute('aria-valuenow'));
    const delta = Number(handle.getAttribute('transform')!.match(/translate\(([^,]+)/)![1]);
    pointer(handle, 'pointerup', 480);
    expect(doc.value.topology.events[0]!.at).toBe(at);
    expect(undoStack.value).toHaveLength(1);
    const after = root.querySelector('.tl-event-drag')!;
    expect(Number(after.querySelector('.tl-event-hit')!.getAttribute('x'))).toBeCloseTo(before + delta, 0);
    expect(after.getAttribute('transform')).toBe('translate(0,0)');
    // Demonstrate the old automatic fit would have put it near its old spot.
    const d = doc.value.topology;
    const auto = buildTimeline(simulate(d, d.events), d, { width: 900 });
    const autoX = auto.markers.find(m => m.kind === 'event')!.nx - 11;
    expect(Math.abs(autoX - (before + delta))).toBeGreaterThan(50);
    act(() => { [...root.querySelectorAll('button')].find(b => b.textContent === 'Fit timeline')!.click(); });
    expect(Number(after.querySelector('.tl-event-hit')!.getAttribute('x'))).toBeCloseTo(autoX, 0);
    act(() => undo());
    expect(doc.value.topology.events[0]!.at).toBe(40);
  });

  it('refits when a different scenario replaces the edited one', () => {
    const handle = mountLive();
    pointer(handle, 'pointerdown', 600);
    pointer(handle, 'pointerup', 480);
    act(() => resetHistory(makeDoc(configuration([crash(100, 'dc3-obs01')]))));
    const d = doc.value.topology;
    const model = buildTimeline(simulate(d, d.events), d, { width: 900 });
    const hit = root.querySelector('.tl-event-hit')!;
    expect(Number(hit.getAttribute('x'))).toBeCloseTo(model.markers.find(m => m.kind === 'event')!.nx - 11, 0);
    expect([...root.querySelectorAll('button')].some(b => b.textContent === 'Fit timeline')).toBe(false);
  });
});

it('preserves the badge grab offset when the playhead is dragged', () => {
  const d = configuration([crash(0)]);
  const seek = vi.fn();
  act(() => render(h(Timeline, { doc: d, trace: simulate(d, d.events), width: 900,
    tNow: 10, onSeek: seek }), root));
  const svg = root.querySelector('svg')!;
  svg.getBoundingClientRect = () => ({ width: 900, left: 0 } as DOMRect);
  expect(root.querySelector('.tl-scrub-hit')).toBeNull();
  const handle = root.querySelector<SVGGElement>('.tl-playhead-g')!;
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  const badge = handle.querySelector('.tl-playhead-badge')!;
  pointer(badge, 'pointerdown', 350);
  pointer(badge, 'pointerup', 350);
  expect(seek).not.toHaveBeenCalled();
  pointer(badge, 'pointerdown', 350);
  pointer(handle, 'pointermove', 400);
  const model = buildTimeline(simulate(d, d.events), d, { width: 900 });
  expect(seek).toHaveBeenLastCalledWith(10 + 50 / model.scale.pxPerSecond);
  pointer(handle, 'pointermove', 350);
  expect(seek).toHaveBeenLastCalledWith(10);
  pointer(handle, 'pointerup', 350);
  seek.mockClear();
  pointer(handle, 'pointermove', 450);
  expect(seek).not.toHaveBeenCalled();
});
