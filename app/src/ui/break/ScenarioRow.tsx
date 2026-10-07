/** Scenario templates share the engine-backed shelf and existing refusals.
 * A template stays pressed while the event list matches its scheduled events. */

import type { JSX } from 'preact';
import { sortEvents } from '@/engine';
import { events, topology } from '@/state/derived';
import { canEdit, healthyRun, viewport } from '@/state/view';
import { WhyPill } from '../common/WhyPill';
import { GLYPH } from '../common/eventIcons';
import { applyTemplate, shelf } from './events';
import type { Template } from './events';

/** The picture on each chip: the event glyph of what the scenario does; a tick for the one where nothing fails. */
const ICON: Record<string, JSX.Element> = {
  healthy: <path d="M4.5,12.5 L9.5,17.5 L19.5,7" />,
  crash: GLYPH.crash,
  isolated: GLYPH.isolate,
  partition: GLYPH.cut,
  dc2down: GLYPH.crash,
  'observer-lost': GLYPH.stop,
  switchover: GLYPH.switchover,
};

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
    <div class="dock-scn scn-row" role="group" aria-label="One-click scenarios">
      <span class="dock-scn-k">{label}</span>
      {shelf(doc, 0).map((t) => {
        const off = t.enabled.state === 'off';
        return (
          <span class="ctl-off" key={t.id}>
            <button
              type="button"
              class={`scn-chip${off ? ' is-faded' : ''}`}
              disabled={off}
              title={t.caption}
              aria-pressed={isCurrent(t, list, healthy)}
              onClick={() => applyTemplate(t)}
            >
              <svg class="scn-ico" viewBox="0 0 24 24" aria-hidden="true">{ICON[t.id] ?? GLYPH.crash}</svg>
              <span>{t.label}</span>
            </button>
            <WhyPill why={t.enabled} />
          </span>
        );
      })}
    </div>
  );
}
