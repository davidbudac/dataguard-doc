/**
 * The preset registry.
 *
 * Eleven documents, each one a worked example from the fact sheet or a shape
 * the workbench has to be able to draw. They are the scenario tests as well as
 * the starting points offered in the UI: `test/presets.test.ts` loads every
 * one, parses it, resolves its redo graph and runs its default event set.
 */

import { classic, observeOnly } from './classic';
import { farSyncHaPair, farSyncRoleChange, farSyncZeroLoss } from './farsync';
import { cascadeTerminal, priorityAlternates } from './cascade';
import {
  bystanders, maxProtection, multiTargetThreeObservers, racPrimary,
} from './multi';
import type { Preset, PresetId } from './types';
import type { TimedEvent, TopologyDoc } from '../engine';

export type { Preset, PresetId } from './types';
export * from './build';
export {
  bystanders, cascadeTerminal, classic, farSyncHaPair, farSyncRoleChange, farSyncZeroLoss,
  maxProtection, multiTargetThreeObservers, observeOnly, priorityAlternates, racPrimary,
};

/** Registry order is the order the UI offers them: simplest first. */
export const PRESETS: readonly Preset[] = [
  classic,
  observeOnly,
  farSyncZeroLoss,
  farSyncHaPair,
  farSyncRoleChange,
  cascadeTerminal,
  priorityAlternates,
  multiTargetThreeObservers,
  racPrimary,
  bystanders,
  maxProtection,
];

export const PRESET_IDS: readonly PresetId[] = PRESETS.map((p) => p.id);

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** The preset by id, or a thrown error: callers own the id. */
export function preset(id: PresetId): Preset {
  const p = findPreset(id);
  if (!p) throw new Error(`unknown preset: ${id}`);
  return p;
}

/** A fresh document, with the preset's default events already in it. */
export const presetDoc = (id: PresetId): TopologyDoc => preset(id).doc();

/** The preset's default event set. */
export const presetEvents = (id: PresetId): TimedEvent[] => preset(id).events();
