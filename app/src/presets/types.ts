/**
 * What a preset is.
 *
 * A preset is a document plus the story it tells: an id, a title, one
 * paragraph of "what this shows" written to the accuracy rules, the citation
 * ids the paragraph rests on, and the event set the workbench replays when the
 * preset is loaded. Presets are the scenario tests -- `test/presets.test.ts`
 * loads every one of them, checks the document parses without repair and
 * checks the redo graph and the simulation say what the paragraph says.
 *
 * `doc()` and `events()` are factories on purpose: a document is a mutable
 * object, and two callers must never share one.
 */

import type { CitationId, TimedEvent, TopologyDoc } from '../engine';

export type PresetId =
  | 'classic'
  | 'far-sync-zero-loss'
  | 'far-sync-ha-pair'
  | 'far-sync-role-change'
  | 'cascade-terminal'
  | 'priority-alternates'
  | 'multi-target-three-observers'
  | 'rac-primary'
  | 'bystanders'
  | 'max-protection'
  | 'observe-only';

export interface Preset {
  id: PresetId;
  title: string;
  /** One paragraph: what this configuration shows. */
  summary: string;
  /** The catalogue ids behind the paragraph. Anything undocumented in it says so in words. */
  cite: readonly CitationId[];
  /** Where the shape comes from, when it is one of Oracle's worked examples. */
  source?: string;
  /** A fresh document every call, with `events()` already in `doc.events`. */
  doc: () => TopologyDoc;
  /** The default event set. */
  events: () => TimedEvent[];
}
