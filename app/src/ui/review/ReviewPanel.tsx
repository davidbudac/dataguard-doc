/**
 * Compare alternatives (docs/tasks/ui-followups.md 7.6): save the
 * configuration as a baseline, change it, and read both under the same named
 * scenario; or run the six common scenarios one by one against it, with
 * optional expectations checked against the model.
 *
 * Opened from the top bar's ⋯ menu as a floating card, like Saved
 * configurations, and mounted by the shell for the same reason (the menu is a
 * <details> that shuts on a press). Nothing here touches the reader's own
 * events: each run is a copy with the scenario in their place, and opening
 * one on the timeline is an undoable replacement that keeps the draft.
 *
 * The comparison prints with the rest of the configuration in the ⋯ → Report
 * as PDF page (ui/export/Report.tsx); there is no second report generator.
 */

import { useMemo, useState } from 'preact/hooks';
import type { ClassicScenario } from '@/engine';
import { doc } from '@/state/doc';
import { edition, toast } from '@/state/view';
import {
  baseline, baselineNotice, comparisonScenario, expectations, loadBaseline,
  openScenario, reviewOpen, reviewTab, saveBaseline, suite,
} from '@/state/review';
import type { ReviewTab } from '@/state/review';
import { Fact } from '../common/Chip';
import { Segmented } from '../common/Segmented';
import { Sheet } from '../common/Sheet';
import { templates } from '../break/events';
import { openReport } from '../export/Report';
import {
  assess, commandChanges, commitFor, configurationFindings, lossText, numberText,
  openText, outcomeText, reviewInputKey, runScenario, runSuite, settingChanges, topologyFor,
} from './model';
import type { Expectation, ReviewSnapshot, ScenarioResult } from './model';
import '@/styles/review.css';

/** ⋯ → Compare alternatives. Storage is read here, not before: a closed
    dialog must not warn about a baseline nobody asked for. */
export function openReview(): void {
  if (baseline.value === null) loadBaseline();
  reviewOpen.value = true;
}

function RunFindings({ result, side }: { result: ScenarioResult; side?: string }) {
  const findings = [...configurationFindings(result.topology), ...(result.trace?.findings ?? [])];
  const loud = findings.filter((f) => f.severity !== 'info').length;
  if (loud === 0) return null;
  return (
    <p class="rv-warn">
      {side ? `${side}: ` : ''}{loud} configuration or run finding{loud === 1 ? '' : 's'}. The
      result holds only for these inputs; open the scenario to inspect them.
    </p>
  );
}

function Assumptions() {
  return (
    <p class="rv-cap">
      <Fact basis="model" /> Each side starts from its declared topology with this scenario at
      t = 0 in place of its own events. ObserverOverride is FALSE. Opening times include
      environment-dependent recovery and role transition; commit latency is the steady state.
      These are modelled outcomes, not production guarantees.
    </p>
  );
}

function Comparison({ current }: { current: ReviewSnapshot }) {
  const base = baseline.value;
  const scenario = comparisonScenario.value;
  const result = useMemo(() => runScenario(current, scenario), [current.doc, current.edition, scenario]);
  const old = useMemo(() => (base ? runScenario(base, scenario) : null), [base, scenario]);
  const changes = useMemo(() => (base ? settingChanges(base, current) : []), [base, current.doc, current.edition]);
  const commands = useMemo(() => (base ? commandChanges(base, current) : []), [base, current.doc, current.edition]);
  const commit = useMemo(() => commitFor(current), [current.doc, current.edition]);
  const oldCommit = useMemo(() => (base ? commitFor(base) : null), [base]);
  const ms = (c: ReturnType<typeof commitFor>): string => (c ? `${numberText(c.commitMs)} ms (model)` : 'Unavailable');

  return (
    <section class="rv-sec" aria-label="Baseline comparison">
      <p class="rv-lede">
        Save this configuration as a baseline, change it, then read both under the same
        scenario. Your drawing and your events stay as they are.
      </p>
      <div class="rv-row">
        <button type="button" class={base ? 'btn' : 'btn is-solid'} onClick={saveBaseline}>
          {base ? 'Replace baseline with current' : 'Save baseline'}
        </button>
        {baselineNotice.value ? <span class="rv-note" role="status">{baselineNotice.value}</span> : null}
      </div>
      {base ? (
        <>
          <label class="rv-field">
            <span>Scenario</span>
            <select
              class="field-in"
              value={scenario}
              onChange={(ev) => { comparisonScenario.value = ev.currentTarget.value as ClassicScenario; }}
            >
              {templates(topologyFor(current), 0).map((t) => <option value={t.id} key={t.id}>{t.label}</option>)}
            </select>
          </label>
          <div class="rv-scroll">
            <table class="rv-tab">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col">Baseline <small>{base.doc.meta.name} · {base.edition}</small></th>
                  <th scope="col">Current <small>{current.doc.meta.name} · {current.edition}</small></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Outcome</th>
                  <td>{old?.unavailable ?? outcomeText(old?.trace ?? null)}</td>
                  <td>{result.unavailable ?? outcomeText(result.trace)}</td>
                </tr>
                <tr>
                  <th scope="row">New primary opens</th>
                  <td>{openText(old?.trace ?? null)}</td>
                  <td>{openText(result.trace)}</td>
                </tr>
                <tr>
                  <th scope="row">Modelled data loss</th>
                  <td>{lossText(old?.trace ?? null)}</td>
                  <td>{lossText(result.trace)}</td>
                </tr>
                <tr>
                  <th scope="row">Commit latency</th>
                  <td>{ms(oldCommit)}</td>
                  <td>{ms(commit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Assumptions />
          {old ? <RunFindings result={old} side="Baseline" /> : null}
          <RunFindings result={result} side="Current" />
          <div class="rv-row">
            <button type="button" class="btn" disabled={!result.trace} onClick={() => openScenario(current, result)}>
              Open current scenario
            </button>
          </div>
          <details class="rv-more">
            <summary>{changes.length} changed setting{changes.length === 1 ? '' : 's'}</summary>
            {changes.length ? (
              <div class="rv-scroll">
                <table class="rv-tab">
                  <thead><tr><th scope="col">Setting</th><th scope="col">Baseline</th><th scope="col">Current</th></tr></thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.path}>
                        <th scope="row"><code>{c.path}</code></th>
                        <td><code>{c.before}</code></td>
                        <td><code>{c.after}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="rv-cap">
                Settings are identical. Names, canvas positions and authored events are not compared.
              </p>
            )}
          </details>
          <details class="rv-more">
            <summary>{commands.length} changed command file{commands.length === 1 ? '' : 's'}</summary>
            <p class="rv-cap">
              Whole command blocks, so address and target order stay visible. The notes and
              citations are in Configure and in the report.
            </p>
            {commands.map((c) => (
              <section key={c.title} class="rv-cmd">
                <h4>{c.title}</h4>
                <div class="rv-cmd-pair">
                  <div><span class="rv-k">Baseline</span><pre>{c.removed.join('\n') || '(No commands)'}</pre></div>
                  <div><span class="rv-k">Current</span><pre>{c.added.join('\n') || '(No commands)'}</pre></div>
                </div>
              </section>
            ))}
          </details>
        </>
      ) : (
        <p class="rv-cap">The baseline is kept in this browser, with its Oracle release.</p>
      )}
    </section>
  );
}

const OUTCOMES = [
  'Failover', 'Primary continues', 'Stalled; no promotion', 'Protection shutdown',
  'Manual action needed', 'Manual failover', 'Observer lost', 'Switchover', 'Blocked',
];

function Expected({ result }: { result: ScenarioResult }) {
  const expected = expectations.value[result.id] ?? {};
  const patch = (p: Partial<Expectation>): void => {
    const next: Expectation = { ...expected, ...p };
    for (const k of Object.keys(next) as (keyof Expectation)[]) if (next[k] === undefined) delete next[k];
    expectations.value = { ...expectations.value, [result.id]: next };
  };
  return (
    <details class="rv-exp">
      <summary>Expected result</summary>
      <label class="rv-field">
        <span>Expected outcome</span>
        <select
          class="field-in"
          aria-label={`Expected outcome: ${result.label}`}
          value={expected.outcome ?? ''}
          onChange={(ev) => patch({ outcome: ev.currentTarget.value || undefined })}
        >
          <option value="">No expectation</option>
          {OUTCOMES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </label>
      {(['maxOpenSeconds', 'maxLossSeconds'] as const).map((key) => (
        <label class="rv-field" key={key}>
          <span>{key === 'maxOpenSeconds' ? 'New primary open by (s from t = 0)' : 'Maximum modelled loss (s of redo)'}</span>
          <input
            class="field-in"
            type="number"
            min="0"
            step="0.1"
            aria-label={`${key === 'maxOpenSeconds' ? 'Opening deadline' : 'Loss limit'}: ${result.label}`}
            value={expected[key] ?? ''}
            onChange={(ev) => {
              const v = ev.currentTarget.value;
              const n = Number(v);
              if (v === '') patch({ [key]: undefined });
              else if (Number.isFinite(n) && n >= 0) patch({ [key]: n });
              else ev.currentTarget.value = String(expected[key] ?? '');
            }}
          />
        </label>
      ))}
    </details>
  );
}

function Scenarios({ current }: { current: ReviewSnapshot }) {
  const run = suite.value;
  const stale = run !== null && reviewInputKey(run.snapshot) !== reviewInputKey(current);
  const [busy, setBusy] = useState(false);
  const runTests = (): void => {
    setBusy(true);
    /* Let the button paint before six synchronous simulations. */
    setTimeout(() => {
      try { suite.value = { snapshot: current, results: runSuite(current) }; } catch {
        toast.value = { kind: 'warn', text: 'The scenarios could not finish for this configuration. Check its validation findings.' };
      } finally { setBusy(false); }
    }, 0);
  };
  return (
    <section class="rv-sec" aria-label="Common failure scenarios">
      <p class="rv-lede">
        Run the six scenarios one by one against this configuration. Each starts at t = 0 and
        replaces the events for that run only.
      </p>
      <div class="rv-row">
        <button type="button" class={run ? 'btn' : 'btn is-solid'} disabled={busy} onClick={runTests}>
          {busy ? 'Running…' : run ? 'Run again' : 'Run common scenarios'}
        </button>
      </div>
      <p class="rv-cap">
        <Fact basis="model" /> Checks compare modelled outcomes with your expectations. An opening
        deadline is about a new primary opening, not client reconnection or a measured recovery
        objective. Expectations last for this visit.
      </p>
      {stale ? (
        <p role="status" class="rv-warn">
          The configuration changed since this run. Run again to refresh. Opening a result restores
          the tested configuration, and Undo brings this one back.
        </p>
      ) : null}
      {run ? (
        <div class="rv-scroll">
          <table class="rv-tab">
            <thead>
              <tr>
                <th scope="col">Scenario</th><th scope="col">Outcome</th><th scope="col">New primary opens</th>
                <th scope="col">Modelled loss</th><th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {run.results.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <button
                      type="button"
                      class="rv-open"
                      disabled={!r.trace}
                      title={r.unavailable ?? 'Open this result on the timeline'}
                      onClick={() => openScenario(run.snapshot, r)}
                    >
                      {r.label}
                    </button>
                    {r.unavailable ? <p class="rv-cap">{r.unavailable}</p> : null}
                  </th>
                  <td>{outcomeText(r.trace)}</td>
                  <td>{openText(r.trace)}</td>
                  <td>{lossText(r.trace)}</td>
                  <td>
                    <span class="rv-check">{assess(r, expectations.value[r.id] ?? {})}</span>
                    <Expected result={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const TABS: { value: ReviewTab; label: string }[] = [
  { value: 'compare', label: 'Baseline' },
  { value: 'scenarios', label: 'Common failures' },
];

function Body() {
  const current = { doc: doc.value, edition: edition.value };
  return (
    <div class="rv-body">
      <div class="rv-tabs">
        <Segmented<ReviewTab>
          label="Compare alternatives"
          value={reviewTab.value}
          options={TABS}
          onChange={(v) => { reviewTab.value = v; }}
        />
      </div>
      {reviewTab.value === 'compare' ? <Comparison current={current} /> : <Scenarios current={current} />}
      <p class="rv-foot">
        ⋯ → Report as PDF prints this comparison and an up-to-date scenario run with the rest of
        the configuration.{' '}
        <button
          type="button"
          class="btn is-quiet"
          onClick={() => { reviewOpen.value = false; void openReport(); }}
        >
          Open the report
        </button>
      </p>
    </div>
  );
}

/** The dialog itself; the shell mounts it once (App.tsx). */
export function ReviewDialog() {
  return (
    <Sheet
      open={reviewOpen.value}
      title="Compare alternatives"
      variant="card"
      class="rv-sheet"
      onClose={() => { reviewOpen.value = false; }}
    >
      <Body />
    </Sheet>
  );
}
