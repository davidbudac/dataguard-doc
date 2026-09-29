/**
 * Break's action table as a grouped menu: what the canvas's context menu and
 * Lanes' "More" popover both list.
 *
 * It lived in `CanvasSlot`; it is here so the two surfaces call one function
 * and cannot order or label the same rows differently.
 */

import type { TopologyDoc } from '@/engine';
import type { BarAction, BarSection } from '../canvas/ActionBar';
import {
  ACTION_GROUP_LABEL, ACTION_GROUPS, actionGroup, actionIcon, actionsFor, nothingToRestore,
  restoreQuietLine, runAction,
} from './events';
import type { EventAction, RunOptions } from './events';

/**
 * Break's table as the canvas's context menu, dropped restores and all.
 *
 * The same three calls `EventMenu` makes for the same selection at the same
 * moment -- `actionsFor`, `nothingToRestore`, `restoreQuietLine` -- so every
 * label, every refusal and the one sentence standing in for the dropped
 * restores are the table's and cannot drift from the rail beside it. What
 * this adds is order only:
 *
 *  - grouped by the kind of event each row injects (`actionGroup`), under the
 *    group's small label, each row led by its glyph (`actionIcon`);
 *  - inside a group the rows that can be pressed first, the refused ones
 *    after; and the groups with something to press before the groups with
 *    nothing, so what can be done now is at the top of the menu;
 *  - the restore sentence closes the Restore group, where the rows it stands
 *    for would have been; and a property rides last in a group of its own,
 *    labelled as a setting for the whole run, as the rail labels it.
 */
export function breakBar(
  d: TopologyDoc, keys: readonly string[], at: number, opts: RunOptions = {},
): { actions: BarAction[]; quiet: string | null; sections: BarSection[] } {
  const all = actionsFor(d, keys, at);
  const events = all.filter((a) => a.property !== true);
  const properties = all.filter((a) => a.property === true);
  const offered = [...events.filter((a) => !nothingToRestore(a)), ...properties];
  const quiet = restoreQuietLine(d, keys, at, events);
  const isOn = (a: EventAction): boolean => a.enabled.state === 'on';
  const row = (a: EventAction): BarAction => ({
    id: a.id, label: a.label, enabled: a.enabled, icon: actionIcon(a), run: () => runAction(a, opts),
  });
  const groups: BarSection[] = ACTION_GROUPS.map((g) => {
    const rows = offered.filter((a) => actionGroup(a) === g);
    return {
      id: g,
      label: ACTION_GROUP_LABEL[g],
      actions: [...rows.filter(isOn), ...rows.filter((a) => !isOn(a))].map(row),
      quiet: g === 'restore' ? quiet : null,
    };
  }).filter((sec) => sec.actions.length > 0 || (sec.quiet ?? null) !== null);
  const live = (sec: BarSection): boolean => sec.actions.some((a) => a.enabled.state === 'on');
  const eventGroups = groups.filter((sec) => sec.id !== 'setting');
  const sections = [
    ...eventGroups.filter(live),
    ...eventGroups.filter((sec) => !live(sec)),
    ...groups.filter((sec) => sec.id === 'setting'),
  ];
  return { actions: sections.flatMap((sec) => sec.actions), quiet, sections };
}
