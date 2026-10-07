/** Scenario templates share the engine-backed shelf and existing refusals.
 * A template stays pressed while the event list matches its scheduled events. */

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

/** `label` is the key at the left of the row, `Scenarios` unless a caller words it otherwise. */
export function ScenarioRow({ label = 'Scenarios' }: { label?: string } = {}) {
  if (!canEdit(viewport.value)) return null;
  const doc = topology.value;
  const list = events.value;
  const healthy = healthyRun.value;
  return (
    <div class="dock-scn" role="group" aria-label="One-click scenarios">
      <span class="dock-scn-k">{label}</span>
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
