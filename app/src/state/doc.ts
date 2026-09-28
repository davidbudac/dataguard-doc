/**
 * The Document -- what a share link, a file and undo contain (ui.md SS2).
 *
 * The View (view.ts) is what a reload may forget; everything in here survives
 * one. Two deliberate deviations from the sketch in ui.md, both to keep a
 * single source of truth:
 *
 *  - **Events live inside `topology`.** The engine's `TopologyDoc` already owns
 *    `events`, and the simulator takes the document, not a pair. A second copy
 *    on `Doc` would be one more thing to keep in step, so `Doc` has none and
 *    `docEvents()` reads through. `derived.ts` exposes them as a signal.
 *  - **Edition is not in the Document.** It is a reading preference, like the
 *    theme, so it lives in `view.ts` and `derived.ts` stamps it onto
 *    `config.edition` before anything is resolved or simulated.
 *
 * Every value here is immutable: an edit produces a new `Doc`, which is what
 * makes undo a stack of snapshots rather than a stack of inverse operations.
 */

import { signal } from '@preact/signals';
import { classicTopology, sortEvents } from '@/engine';
import type { Edition, MemberId, SimParams, TimedEvent, TopologyDoc } from '@/engine';

/** A drag override for one card, in canvas units, snapped to the 8 px grid. */
export interface LayoutOverride {
  dx: number;
  dy: number;
}

export interface DocMeta {
  /** Used for the export file name and the window title. */
  name: string;
  notes: string;
}

export interface Doc {
  meta: DocMeta;
  topology: TopologyDoc;
  params: SimParams;
  /** Keyed by member id, observer id or site id -- whatever the canvas drags. */
  layout: Record<string, LayoutOverride>;
}

/** Drag overrides snap to this grid, so two hand-placed cards still line up. */
export const LAYOUT_SNAP = 8;

export const snapToGrid = (v: number): number =>
  Math.round(v / LAYOUT_SNAP) * LAYOUT_SNAP;

export function makeDoc(topology: TopologyDoc, patch: Partial<Doc> = {}): Doc {
  return {
    meta: { name: topology.label ?? 'Data Guard configuration', notes: '', ...patch.meta },
    topology,
    params: { ...patch.params },
    layout: { ...patch.layout },
  };
}

/**
 * The classic 1+1+1 deployment the published workbench draws: a primary in
 * DC 1, its target standby in DC 2, an observer on a host of its own in DC 3.
 * This is the preset every reset and every failed restore lands on.
 */
export function classicDoc(edition: Edition = '19c'): Doc {
  /* Without events: `classicTopology` carries the published page's default
     scenario (a primary crash), and a document the reader has not broken yet
     must open in its steady state. Break mode injects them, and a legacy share
     link brings its own -- both go through the migration path, not this one. */
  return makeDoc({ ...classicTopology({ version: edition }), events: [] });
}

export const doc = signal<Doc>(classicDoc());

/* ---------------- pure helpers ---------------- */

export const docEvents = (d: Doc): readonly TimedEvent[] => d.topology.events;

export function withTopology(d: Doc, topology: TopologyDoc): Doc {
  return { ...d, topology };
}

export function withEvents(d: Doc, events: readonly TimedEvent[]): Doc {
  return { ...d, topology: { ...d.topology, events: sortEvents(events) } };
}

export function withEvent(d: Doc, event: TimedEvent): Doc {
  return withEvents(d, [...d.topology.events, event]);
}

/** Remove one event by its index in the sorted list. */
export function withoutEventAt(d: Doc, index: number): Doc {
  return withEvents(d, d.topology.events.filter((_, i) => i !== index));
}

export function withLayout(d: Doc, id: string, over: LayoutOverride | null): Doc {
  const layout = { ...d.layout };
  if (over === null) delete layout[id];
  else layout[id] = { dx: snapToGrid(over.dx), dy: snapToGrid(over.dy) };
  return { ...d, layout };
}

export function withMeta(d: Doc, meta: Partial<DocMeta>): Doc {
  return { ...d, meta: { ...d.meta, ...meta } };
}

export function withParams(d: Doc, params: Partial<SimParams>): Doc {
  return { ...d, params: { ...d.params, ...params } };
}

/** Replace one member, leaving everything else identical. */
export function withMember(
  d: Doc, id: MemberId, fn: (m: TopologyDoc['members'][number]) => TopologyDoc['members'][number],
): Doc {
  return withTopology(d, {
    ...d.topology,
    members: d.topology.members.map((m) => (m.id === id ? fn(m) : m)),
  });
}

/**
 * The stem every exported file shares -- the `.dgtopo.json`, the diagram's
 * `.png` -- safe on every platform.
 */
export function exportStem(d: Doc): string {
  const base = d.meta.name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base === '' ? 'topology' : base.slice(0, 64);
}

/** A file name that is safe on every platform, for the export path. */
export function exportFileName(d: Doc): string {
  return `${exportStem(d)}.dgtopo.json`;
}
