/**
 * The timeline model for one run on screen, and the held axis that goes with it.
 *
 * `Timeline` used to own both. The Detailed timeline's lanes and Topology's small
 * timeline draw in one place and their transport, Fit button and colour key
 * elsewhere (a bar), and the bar must read the model the drawing was built from -- a second
 * `buildTimeline` in the bar would disagree the moment the axis was held (the
 * reader dropped an event and the viewport stayed where it was) or the width
 * changed. So the owner of both calls this once and hands the result to each.
 *
 * Hold the viewport only for the exact document produced by our drop: undo,
 * rail edits and scenario or configuration changes fit automatically.
 *
 * The same rule holds it for a setting tuned from Simulate's own chrome (the
 * setting chips, the grips, a brace's popover): the axis auto-fits to the run, so without
 * a hold every bar would be redrawn at nearly the same width and only the tick
 * labels would move -- the reader could not see a 30 s threshold become 25 s.
 * A tuning edit marks the document it produced (`markTuned`); that document is
 * drawn on the axis the previous one had while the run still fits it, or while
 * a drag is in progress (`tuneDragging`). Undo, a scenario change and an edit
 * made anywhere else are other documents and fit themselves.
 */

import { signal } from '@preact/signals';
import { useMemo, useRef, useState } from 'preact/hooks';
import type { TimedEvent, TopologyDoc, Trace } from '@/engine';
import { sortEvents } from '@/engine';
import { topology } from '@/state/derived';
import { buildTimeline, lastInterestingT } from './build';
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

/** The document a tuning edit produced, as `JSON.stringify` -- the one whose axis is held while it fits. */
export const tunedScenario = signal<string | null>(null);

/** A scrub or a drag of a tuned value is in progress: hold the axis whatever the run does. */
export const tuneDragging = signal(false);

/**
 * Call right after the edit of a tuned setting, in the same batch: the
 * document that edit just produced is the one whose axis stays.
 */
export function markTuned(): void {
  tunedScenario.value = JSON.stringify(topology.value);
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
  /* The axis of the render before, kept by identity while its ends do not move. */
  const lastAxis = useRef<{ t0: number; t1: number } | null>(null);
  const dropHold = heldAxis?.scenario === scenario ? heldAxis : undefined;
  const tunedHere = tunedScenario.value === scenario;
  const dragging = tuneDragging.value;
  const before = lastAxis.current;
  const tuneHold = dropHold === undefined && !pinnedScale && tunedHere && before !== null
    && (dragging || lastInterestingT(trace, sortEvents(doc.events), appView ? doc : undefined) <= before.t1)
    ? before : undefined;
  const axis = dropHold ?? tuneHold;
  const model = useMemo(
    () => buildTimeline(trace, doc, {
      width, pinnedScale, selection, app: appView, density, ...(axis ? { axis } : {}),
      ...(gutter === undefined ? {} : { gutter }), ...(links === undefined ? {} : { links }),
    }),
    [trace, doc, width, pinnedScale, selection, axis, appView, density, gutter, links],
  );
  if (!pinnedScale && (before === null || before.t0 !== model.scale.t0 || before.t1 !== model.scale.t1)) {
    lastAxis.current = { t0: model.scale.t0, t1: model.scale.t1 };
  }
  return {
    model,
    held: axis !== undefined && !pinnedScale,
    fit: () => { setHeldAxis(null); tunedScenario.value = null; },
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
