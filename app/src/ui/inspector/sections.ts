/**
 * Which of the configuration's long sections are open, for this session only.
 *
 * The empty Build rail used to be one 4,000 px scroll: the buttons that add a
 * standby sat below the fold, under a summary table and a configuration form
 * whose fast-start-failover group alone is taller than the window. Folding the
 * five property groups puts the whole configuration back on one screen.
 *
 * Three rules hold here.
 *
 *  - **A closed section is genuinely absent**, not painted out of view: the
 *    fold renders no children at all (ui.md SS8, "nothing hidden by CSS alone").
 *  - **This is view state, not document state.** It never reaches the Document,
 *    so it is not undoable, not serialized and not in the URL -- a permalink
 *    describes a configuration, not which drawers the sender had open.
 *  - **A section holding an error opens itself.** A fold that hides the very
 *    property `validate()` is complaining about would be the page hiding its
 *    own answer. It opens once, when the error appears; the reader can close
 *    it again, and the toggle is never a button that does nothing. Clicking a
 *    finding in the validation panel opens its section too, at every severity:
 *    a row that takes the reader to a rail without the property it names is a
 *    button that does not go where it points.
 */

import { signal } from '@preact/signals';
import type { Finding } from '@/engine';

/** The five foldable groups of `ConfigForm`, in the order they are rendered. */
export const SECTION_IDS = [
  'Configuration',
  'PrimaryDatabaseCandidates',
  'Fast-start failover',
  'PreferredObserverHosts',
  'Environment',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/**
 * The other folds, which are not `ConfigForm`'s five.
 *
 * They live in the same open set, so a reader who opens the destinations on
 * one member finds them open on the next: which drawers are open is a habit,
 * not a property of a card. Both start closed -- the summary is what the rail
 * *was* before this pass and the destinations are the tallest group in the
 * application (four properties per destination).
 */
export const SUMMARY_ID = 'Configuration summary';
export const INSTANCES_ID = 'Instances';
export const DESTS_ID = 'Destinations';
/** Break's six scenarios, on the rail and on the floating palette alike. Folded to start. */
export const SCENARIOS_ID = 'One-click scenarios';

/** Configuration is the one that opens with the rail; the rest are folded. */
export const DEFAULT_OPEN: SectionId = 'Configuration';

export const openSections = signal<ReadonlySet<string>>(new Set<string>([DEFAULT_OPEN]));

/**
 * The folds that open by themselves in some state (`Fold`'s `defaultOpen`) and
 * that the reader has shut. Without it a default-open fold could not be closed:
 * "not in the open set" would mean "shut" and "never asked" at once. A fold
 * that never opens by default never appears here.
 */
export const shutSections = signal<ReadonlySet<string>>(new Set<string>());

/**
 * Is this fold open? A fold the reader has toggled answers to the reader; one
 * they have not answers to its own default (`defaultOpen`, false for most).
 */
export const isSectionOpen = (id: string, defaultOpen = false): boolean =>
  openSections.value.has(id) || (defaultOpen && !shutSections.value.has(id));

/** Flip a fold. `defaultOpen` is the one the fold was drawn with, so the flip is of what is on screen. */
export function toggleSection(id: string, defaultOpen = false): void {
  const open = isSectionOpen(id, defaultOpen);
  const opened = new Set(openSections.value);
  const shut = new Set(shutSections.value);
  if (open) { opened.delete(id); if (defaultOpen) shut.add(id); }
  else { opened.add(id); shut.delete(id); }
  openSections.value = opened;
  shutSections.value = shut;
}

/** Open these without closing anything; a no-op when they are open already. */
export function revealSections(wanted: Iterable<string>): void {
  const ids = [...wanted];
  const cur = openSections.value;
  const next = new Set(cur);
  for (const id of ids) next.add(id);
  if (next.size !== cur.size) openSections.value = next;
  const shut = shutSections.value;
  if (ids.some((id) => shut.has(id))) {
    const left = new Set(shut);
    for (const id of ids) left.delete(id);
    shutSections.value = left;
  }
}

/**
 * The flagged set the folds were last opened for.
 *
 * Module-level, not component state: `ConfigForm` is rendered only while
 * nothing is selected, so every click on a card unmounts it and clearing the
 * selection mounts a fresh one -- and a remount is not a new error. Keyed on
 * the last value rather than a set of honoured keys, so an error that clears
 * and returns ('X' then '' then 'X') is a genuine second appearance and opens
 * its section again, while a bare remount does not.
 */
let lastFlaggedKey = '';

/** `revealSections`, but once per appearance of the flagged set. */
export function revealForFlagged(key: string, ids: Iterable<string>): void {
  if (key === lastFlaggedKey) return;
  lastFlaggedKey = key;
  revealSections(ids);
}

/** Back to the state a fresh session starts in. Used by the tests. */
export function resetSections(): void {
  openSections.value = new Set<string>([DEFAULT_OPEN]);
  shutSections.value = new Set<string>();
  lastFlaggedKey = '';
}

/**
 * Which fold a rule's finding belongs in.
 *
 * Only the rules whose subject is a property this form actually edits are
 * mapped: a member's own trouble is reported on the member, and the issue
 * panel selects it, so there is no fold to open for it.
 */
const SECTION_OF_RULE: readonly (readonly [string, SectionId])[] = [
  ['MODE.', 'Configuration'],
  ['OBS.PREFERRED_HOSTS', 'PreferredObserverHosts'],
  ['FSFO.', 'Fast-start failover'],
  ['REINSTATE.', 'Fast-start failover'],
];

export function sectionOfRule(id: string): SectionId | null {
  for (const [prefix, section] of SECTION_OF_RULE) if (id.startsWith(prefix)) return section;
  return null;
}

/** The sections an error is asking the reader to look at. Errors only. */
export function sectionsWithErrors(findings: readonly Finding[]): SectionId[] {
  const out: SectionId[] = [];
  for (const f of findings) {
    if (f.severity !== 'error') continue;
    const s = sectionOfRule(f.id as string);
    if (s !== null && !out.includes(s)) out.push(s);
  }
  return out;
}
