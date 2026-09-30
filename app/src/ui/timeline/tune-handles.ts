/**
 * Where a clock's end can be grabbed.
 *
 * `tuneForBrace` (tune.ts) says which braces are a setting; this says where on
 * the drawing each of those settings can be dragged from: at the brace's end
 * (`x`), and, when one lane's band IS that clock, on that lane too (`laneKey`)
 * -- the master observer's counting bar for the threshold, the standby's
 * role-change bar for the role transition. Pure: it reads the model and draws
 * nothing, so both layouts place the same grips from the same list.
 */

import { useMemo, useRef } from 'preact/hooks';
import { BOUNDS } from '@/engine';
import type { TopologyDoc, Trace } from '@/engine';
import type { TimelineModel } from './build';
import { tuneDragging } from './run';
import { tuneForBrace } from './tune';
import type { Tune } from './tune';

export interface TuneHandle {
  /** The brace's key; stable across the re-renders an edit causes. */
  key: string;
  tune: Tune;
  /** The clock's end, in the drawing's x. */
  x: number;
  /** The brace's own y (the top of its curl). */
  braceY: number;
  /** The lane whose band IS this clock, if one is. */
  laneKey: string | null;
  /** The grip's tooltip. */
  title: string;
}

/** How closely a band's ends must match the brace's for the band to be the clock. */
const SAME = 0.05;

/** The setting's name as the grip's slider says it: an apply lag names its standby. */
export const tuneLabel = (tune: Tune): string =>
  tune.member === undefined ? tune.name : `${tune.name} of ${tune.member}`;

/** What hovering the grip says: the gesture, the keys and the range. */
const tuneTitle = (tune: Tune): string => {
  const b = BOUNDS[tune.bound];
  return `Drag to change ${tuneLabel(tune)}. Arrow keys: 1 ${b.unit}; Shift: 5 ${b.unit}. Allowed: ${b.min}–${b.max} ${b.unit}.`;
};

export function tuneHandles(doc: TopologyDoc, trace: Trace, model: TimelineModel): TuneHandle[] {
  const out: TuneHandle[] = [];
  const seen = new Set<string>();
  for (const b of model.braces) {
    const tune = tuneForBrace(doc, trace, b);
    if (tune === null) continue;
    const id = `${tune.id}:${tune.member ?? ''}:${Math.round(b.x1 * 100)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const lane = model.lanes.find((l) => l.kind !== 'application'
      && l.segments.some((s) => Math.abs(s.t0 - b.a) <= SAME && Math.abs(s.t1 - b.b) <= SAME));
    out.push({ key: b.key, tune, x: b.x1, braceY: b.y, laneKey: lane?.key ?? null, title: tuneTitle(tune) });
  }
  return out;
}

/**
 * The handles for the drawing on screen, or none where nothing may be tuned. A
 * run that a drag has made longer than the held axis has its bars cut at the
 * axis's end, and a cut bar is no longer exactly the clock: `tuneHandles` then
 * says there is no lane, and the lane's grip would leave mid-drag and take the
 * pointer capture with it. So while a drag lasts a handle keeps the lane it had
 * when the drag began; the moment it ends the strict answer is back.
 */
export function useTuneHandles(
  enabled: boolean, doc: TopologyDoc, trace: Trace, model: TimelineModel,
): TuneHandle[] {
  const kept = useRef(new Map<string, string>());
  const base = useMemo(() => (enabled ? tuneHandles(doc, trace, model) : []), [enabled, doc, trace, model]);
  const dragging = tuneDragging.value;
  if (!dragging) kept.current.clear();
  return base.map((hd) => {
    if (hd.laneKey !== null) {
      if (dragging) kept.current.set(hd.key, hd.laneKey);
      return hd;
    }
    const lane = dragging ? kept.current.get(hd.key) : undefined;
    return lane === undefined ? hd : { ...hd, laneKey: lane };
  });
}
