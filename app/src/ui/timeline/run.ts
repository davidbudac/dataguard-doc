/**
 * The timeline model for one run on screen, and the held axis that goes with it.
 *
 * `Timeline` used to own both. Break's Split layout draws the timeline in one
 * place and its transport, its Fit button and its colour key in the bar above
 * it, and the bar must read the model the drawing was built from -- a second
 * `buildTimeline` in the bar would disagree the moment the axis was held (the
 * reader dropped an event and the viewport stayed where it was) or the width
 * changed. So the owner of both calls this once and hands the result to each.
 *
 * Hold the viewport only for the exact document produced by our drop: undo,
 * rail edits and scenario or configuration changes fit automatically.
 */

import { useMemo, useState } from 'preact/hooks';
import type { TimedEvent, TopologyDoc, Trace } from '@/engine';
import { sortEvents } from '@/engine';
import { buildTimeline } from './build';
import type { Density, TimelineModel, TimelineView } from './build';

export interface RunTimelineInput {
  trace: Trace;
  doc: TopologyDoc;
  /** Measured plot width in CSS pixels. */
  width: number;
  /** Export mode: the static figures' scale. */
  pinnedScale?: boolean;
  selection?: string | null;
  /** Whether the application's lanes are drawn; they are unless this is false. */
  appView?: boolean;
  density?: Density;
  /** Where the plot starts, for a layout that draws its own column left of it (Lanes). */
  gutter?: number;
  /** Which network links get a lane; `auto` unless a layout draws them itself. */
  links?: TimelineView['links'];
}

export interface RunTimeline {
  model: TimelineModel;
  /** An event was dropped and the axis stayed where it was; `fit` lets go of it. */
  held: boolean;
  fit: () => void;
  /**
   * An event drag landed (`result` is the event's new index, as `onMoveEvent`
   * answers it): keep the axis where it was, for the document that drop makes.
   */
  dropped: (index: number, at: number, expected: TimedEvent, result: unknown) => void;
}

export function useRunTimeline(input: RunTimelineInput): RunTimeline {
  const {
    trace, doc, width, pinnedScale = false, selection = null, appView = true, density = 'full', gutter, links,
  } = input;
  const scenario = useMemo(() => JSON.stringify(doc), [doc]);
  const [heldAxis, setHeldAxis] = useState<{
    scenario: string; t0: number; t1: number;
  } | null>(null);
  const axis = heldAxis?.scenario === scenario ? heldAxis : undefined;
  const model = useMemo(
    () => buildTimeline(trace, doc, {
      width, pinnedScale, selection, app: appView, density, ...(axis ? { axis } : {}),
      ...(gutter === undefined ? {} : { gutter }), ...(links === undefined ? {} : { links }),
    }),
    [trace, doc, width, pinnedScale, selection, axis, appView, density, gutter, links],
  );
  return {
    model,
    held: axis !== undefined && !pinnedScale,
    fit: () => setHeldAxis(null),
    dropped: (index, at, expected, result) => {
      if (typeof result !== 'number' || result < 0 || at === expected.at) return;
      const next = { ...doc, events: sortEvents(doc.events.map((event, i) =>
        i === index ? { ...event, at } : event)) };
      setHeldAxis(at >= model.scale.t0 && at <= model.scale.t1
        ? { scenario: JSON.stringify(next), t0: model.scale.t0, t1: model.scale.t1 }
        : null);
    },
  };
}
