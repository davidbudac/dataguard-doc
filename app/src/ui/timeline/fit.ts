import type { TopologyDoc, Trace } from '@/engine';
import { buildTimeline } from './build';
import type { TimelineModel, TimelineView } from './build';

/** Keep a uniform SVG scale: fonts, markers, braces and lanes grow together.
 * Reflow the time axis to the available width before scaling it. A very tall
 * panel may scroll horizontally rather than squash its text. */
export function fitTimeline(trace: Trace, doc: TopologyDoc, view: TimelineView, height: number): {
  model: TimelineModel; scale: number;
} {
  let model = buildTimeline(trace, doc, view);
  if (height <= 0 || view.pinnedScale) return { model, scale: 1 };
  // Brace packing depends on width; settle it before measuring the final scale.
  for (let i = 0; i < 4; i++) {
    const scale = height / model.height;
    const next = buildTimeline(trace, doc, { ...view, width: Math.max(640, (view.width - 1) / scale) });
    if (next.height === model.height) return { model: next, scale };
    model = next;
  }
  return { model, scale: height / model.height };
}
