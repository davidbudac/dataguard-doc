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

import { useMemo, useState } from 'preact/hooks';
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
import type { ExplanationStep } from './explain';
import { appModelsFor, axisSpan } from '../timeline/build';

/** A view preference; a different run does not silently open a long list. */
export const explanationOpen = signal(false);

const fmt = (at: number): string => (Number.isInteger(at) ? String(at) : at.toFixed(2));

function inspectSetting(section: 'Fast-start failover' | 'PrimaryDatabaseCandidates'): void {
  revealSections([section]);
  selection.value = [];
  mode.value = 'break';
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
  const steps = useMemo(() => {
    if (!open) return [];
    const recorded = buildExplanation(doc, trace);
    const applicationSteps: ExplanationStep[] = appModelsFor(trace, doc).flatMap((app) => {
      if (app.application === null || app.tConn === null || app.noEvent) return [];
      return [{ key: `app-connected:${app.application.id}`, at: app.tConn,
        title: `${app.application.name} reconnects`,
        detail: `The modelled connect string reaches a serving database at t = ${fmt(app.tConn)} s.`,
        subjects: [app.application.id],
        claim: { value: 'Modelled application reconnect', basis: 'model',
          cite: [...new Set([...app.claims.nominal.cite, ...app.claims.retry.cite, ...app.claims.timeouts.cite])],
          note: app.claims.nominal.note ?? app.claims.nominal.value },
      }];
    });
    return [...recorded, ...applicationSteps].sort((a, b) => a.at - b.at);
  }, [open, doc, trace]);
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = steps.findIndex((step) => step.key === chosen && step.at === tNow.value);
  const seek = (index: number): void => {
    const step = steps[index];
    if (!step) return;
    setChosen(step.key);
    playing.value = false;
    tNow.value = Math.min(step.at, axisSpan(trace, doc.events, doc).t1);
    selection.value = step.subjects;
    if (viewport.value !== 'wide') inspectorOpen.value = false;
  };
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
          <div class="explain-navigation" role="group" aria-label="Explanation playback">
            <button type="button" class="btn" aria-label="Previous explanation step" disabled={selected <= 0}
              title={selected <= 0 ? 'Select a later step to go back' : 'Previous explanation step'} onClick={() => seek(selected - 1)}>← Previous</button>
            <span>{selected < 0 ? `${steps.length} steps` : `${selected + 1} / ${steps.length}`}</span>
            <button type="button" class="btn" aria-label="Next explanation step" disabled={steps.length === 0 || selected === steps.length - 1}
              title={selected === steps.length - 1 ? 'Last explanation step' : 'Next explanation step'} onClick={() => seek(selected + 1)}>Next →</button>
          </div>
          <ol class="run-explain-list">
            {steps.map((step, index) => (
              <li key={step.key} class={`run-explain-step${index === selected ? " is-current" : ""}`}>
                <button
                  type="button"
                  class="run-explain-seek"
                  aria-label={`Go to t = ${fmt(step.at)} s: ${step.title}. ${step.detail}`}
                  aria-current={index === selected ? 'step' : undefined}
                  onClick={() => seek(index)}
                >
                  <span class="explain-step-number" aria-hidden="true">{index + 1}</span>
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
