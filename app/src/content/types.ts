/**
 * Content types -- the shape the Learn shell consumes (ui.md SS6.2).
 *
 * A lesson is prose plus, per step, an optional way to put the workbench into
 * the state the prose is talking about. Nothing here computes anything: the
 * engine owns the domain, the shell owns the state, and this module owns the
 * words.
 */

import type { VNode } from 'preact';
import type { JsonPatch, TimedEvent } from '@/engine';

/** The nine lessons. Stable ids: they ride in `?lesson=` and in share links. */
export type LessonId =
  | 'failover-clocks'
  | 'transport-layer'
  | 'application-view'
  | 'configuration'
  | 'sync-transport'
  | 'reference'
  | 'far-sync'
  | 'cascading'
  | 'multi-observer';

/**
 * What a step does to the workbench beside it.
 *
 * `events` are injected at their own `at`; `patches` are RFC 6902 operations
 * against the engine's `TopologyDoc` -- `/config/protectionMode`,
 * `/members/1/applyLagSeconds` and so on. Member and observer paths use the
 * index they carry in the step's preset, which is why every step names a
 * preset: a lesson never patches a document it did not put there.
 */
export interface StepApply {
  events?: TimedEvent[];
  patches?: JsonPatch;
}

export interface LessonStep {
  title: string;
  prose: VNode;
  apply?: StepApply;
  /** One line under the step, usually why the workbench is set up this way. */
  note?: string;
}

export interface Lesson {
  id: LessonId;
  title: string;
  /**
   * The preset the lesson loads before its first step. Presets are owned by
   * `src/presets`; the ids used here are `classic`, `far-sync`, `cascade` and
   * `multi-observer`.
   */
  presetId: string;
  steps: LessonStep[];
}

/** Sugar for the patch lists above -- `replace` is what a lesson ever needs. */
export const set = (path: string, value: unknown): JsonPatch => [{ op: 'replace', path, value }];
