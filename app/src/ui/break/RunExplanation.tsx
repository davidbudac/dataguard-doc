/**
 * "Why this result?" -- the run's recorded decisions, readable beside its
 * events and seekable on the timeline (docs/tasks/ui-followups.md 7.2).
 *
 * A fold on the Break rail, under the event list, in the rail's own idiom
 * (inspector.css): folded by default, because a different run must not open
 * a long list on its own. Every step is assembled from the events and the
 * engine's trace (`explain.ts`) and keeps the basis and the citations of the
 * claim behind it; a step that is this page's reading of the trace says so.
 * Pressing one moves the playhead to it and selects what it is about.
 */

import { signal } from '@preact/signals';
import { citation } from '@/engine';
import type { EngineTrace, TopologyDoc } from '@/engine';
import { inspectorOpen, mode, panelTab, playing, selection, tNow, viewport } from '@/state/view';
import { revealRail } from '@/state/persist';
import { Fact } from '../common/Chip';
import { revealSections } from '../inspector/sections';
import { Caret } from '../inspector/controls';
import { printing } from '../print';
import { buildExplanation } from './explain';

/** A view preference; a different run does not silently open a long list. */
export const explanationOpen = signal(false);

const fmt = (at: number): string => (Number.isInteger(at) ? String(at) : at.toFixed(2));

function inspectSetting(section: 'Fast-start failover' | 'PrimaryDatabaseCandidates'): void {
  revealSections([section]);
  selection.value = [];
  mode.value = 'build';
  revealRail();
}

/**
 * Open the fold and bring it into view -- the readout's "Why this result?".
 * The rail may be mounting (the click came from Learn, or the drawer was
 * shut), so the scroll waits for that render.
 */
export function showExplanation(): void {
  explanationOpen.value = true;
  mode.value = 'break';
  revealRail();
  setTimeout(() => {
    if (typeof document === 'undefined') return;
    const toggle = document.querySelector<HTMLButtonElement>('.run-explain-toggle');
    toggle?.scrollIntoView?.({ block: 'nearest' });
    if (viewport.value === 'wide') toggle?.focus({ preventScroll: true });
  }, 0);
}

const RELATED = [
  ['app', 'Application impact'],
  ['commit', 'Commit cost'],
  ['reopen', 'Transport retries'],
] as const;

export function RunExplanation({ doc, trace }: { doc: TopologyDoc; trace: EngineTrace }) {
  const open = explanationOpen.value || printing.value;
  const steps = open ? buildExplanation(doc, trace) : [];
  return (
    <section class={`grp grp-fold run-explain${open ? ' is-open' : ''}`}>
      <header class="grp-hd">
        <button
          type="button"
          class="grp-tog run-explain-toggle"
          aria-expanded={open}
          aria-controls="run-explanation-steps"
          onClick={() => { explanationOpen.value = !explanationOpen.value; }}
        >
          <Caret open={open} />
          <span class="eyebrow">Why this result?</span>
        </button>
      </header>
      {open ? (
        <div id="run-explanation-steps" class="run-explain-body">
          <p class="run-explain-note">
            Each step is from this modelled run. Select one to move the playhead there and
            highlight what it is about.
          </p>
          <ol class="run-explain-list">
            {steps.map((step) => (
              <li key={step.key} class="run-explain-step">
                <button
                  type="button"
                  class="run-explain-seek"
                  aria-label={`Go to t = ${fmt(step.at)} s: ${step.title}. ${step.detail}`}
                  onClick={() => {
                    playing.value = false;
                    tNow.value = Math.min(step.at, trace.axis.horizon);
                    selection.value = step.subjects;
                    if (viewport.value !== 'wide') inspectorOpen.value = false;
                  }}
                >
                  <span class="run-explain-time mono">{fmt(step.at)} s</span>
                  <span class="run-explain-copy">
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </span>
                </button>
                {step.claim ? (
                  <div class="run-explain-source">
                    <Fact basis={step.claim.basis} />
                    {step.claim.note ? <span>{step.claim.note}</span> : null}
                    {step.claim.cite.map((id) => (
                      <a
                        key={id}
                        class="mono"
                        href={citation(id).url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={citation(id).quote}
                      >
                        {id}
                      </a>
                    ))}
                  </div>
                ) : null}
                {step.setting ? (
                  <button
                    type="button"
                    class="btn run-explain-settings"
                    onClick={() => inspectSetting(step.setting!)}
                  >
                    Inspect {step.setting === 'Fast-start failover' ? 'failover settings' : 'PrimaryDatabaseCandidates'}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <div class="run-explain-related" aria-label="Related views">
            {RELATED.map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                class="btn"
                onClick={() => {
                  panelTab.value = tab;
                  mode.value = 'configure';
                }}
              >
                {label} →
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
