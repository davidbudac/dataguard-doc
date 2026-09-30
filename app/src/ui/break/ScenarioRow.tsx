/**
 * The scenarios as Topology's dock carries them: one wrapping row of compact
 * buttons under the readings, above the small timeline.
 *
 * The same shelf as the rail's (`shelf` in events.ts), the same refusals
 * (`WhyState`, and the read-only reason for a viewer who cannot edit) and the
 * same press (`applyTemplate`); each button's `title` is the scenario's own
 * sentence. It was a palette at the left edge under the tools until the run's
 * small timeline took the bottom: a seven-button column and the tools did not
 * fit a 900 px window once the dock was 240 px tall.
 *
 * Shown wherever editing is allowed, with a run or without one. A scenario is
 * pressed while the event list is exactly its events -- what `applyTemplate`
 * leaves, until the reader adds, moves or removes something.
 */

import { sortEvents } from '@/engine';
import { events, topology } from '@/state/derived';
import { canEdit, healthyRun, viewport } from '@/state/view';
import { Action } from '../inspector/controls';
import { applyTemplate, shelf } from './events';
import type { Template } from './events';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Whether the run on screen is this scenario's: its events, and for the healthy one the request for a run. */
const isCurrent = (t: Template, list: unknown, healthy: boolean): boolean =>
  t.enabled.state === 'on'
  && (t.id === 'healthy'
    ? healthy && (list as readonly unknown[]).length === 0
    : t.events.length > 0 && same(list, sortEvents(t.events)));

export function ScenarioRow() {
  if (!canEdit(viewport.value)) return null;
  const doc = topology.value;
  const list = events.value;
  const healthy = healthyRun.value;
  return (
    <div class="dock-scn" role="group" aria-label="One-click scenarios">
      <span class="dock-scn-k">Scenarios</span>
      {shelf(doc, 0).map((t) => (
        <Action
          key={t.id}
          label={t.label}
          title={t.caption}
          enabled={t.enabled}
          pressed={isCurrent(t, list, healthy)}
          onClick={() => applyTemplate(t)}
        />
      ))}
    </div>
  );
}
