/** The three tasks share one document; changing steps never changes it. */
import { batch } from '@preact/signals';
import { applicationsOf } from '@/engine';
import { errors, redoGraph, topology, trace, warnings } from '@/state/derived';
import { healthyRun, mode, playing, tNow } from '@/state/view';
import type { Mode } from '@/state/view';
import { leaveIntro } from './intro/route';
import { lastInterestingT } from './timeline/build';
import { OutcomeChange } from './break/OutcomeChange';
import { plural } from './Findings';
import { WhyPill } from './common/WhyPill';
import type { WhyState } from './common/WhyPill';
import '@/styles/workflow.css';

/**
 * What the step holds right now, in a few words beside its purpose: Topology
 * counts what is drawn and what is wrong with it, Scenario counts what is
 * scheduled. The Outcome's own bar carries its verdict, so it adds nothing.
 */
export function stepSummary(m: Mode): string | null {
  const t = topology.value;
  if (m === 'build') {
    const parts = [plural(t.members.length, 'member'), plural(t.observers.length, 'observer')];
    const apps = applicationsOf(t).length;
    if (apps > 0) parts.push(plural(apps, 'application'));
    const e = errors.value.length;
    const w = warnings.value.length;
    if (e > 0) parts.push(plural(e, 'error'));
    if (w > 0) parts.push(plural(w, 'warning'));
    return parts.join(' · ');
  }
  if (m === 'scenario') {
    const n = t.events.length;
    if (n === 0) return 'nothing scheduled';
    const last = Math.max(...t.events.map((e) => e.at));
    return `${plural(n, 'event')} · last at ${last} s`;
  }
  return null;
}

/** Whether the next step can be taken, and if not, why: a run needs a primary. */
export function nextStepEnabled(m: Mode): WhyState {
  if (m === 'build' && redoGraph.value === null) return { state: 'off', why: 'No database holds the primary role.' };
  return { state: 'on' };
}

export const WORKFLOW = ['build', 'scenario', 'break'] as const;

export function goToStep(next: Mode): void {
  batch(() => {
    playing.value = false;
    if (next === 'scenario' && mode.value !== 'scenario') {
      tNow.value = Math.max(0, ...topology.value.events.map(e => e.at));
    }
    if (next === 'break' && mode.value !== 'break') {
      if (topology.value.events.length === 0) healthyRun.value = true;
      const run = trace.value;
      if (run) tNow.value = Math.max(0, lastInterestingT(run, topology.value.events, topology.value));
    }
    mode.value = next;
    leaveIntro();
  });
}

export function WorkflowBar() {
  const m = mode.value;
  if (m === 'configure' || m === 'learn') return null;
  const sum = stepSummary(m);
  const next = nextStepEnabled(m);
  return <><div class="workflow-bar">
    <div class="workflow-purpose">
      <strong>Step {WORKFLOW.indexOf(m) + 1} of 3</strong>
      <span>{m === 'build' ? 'Draw the topology and set its starting configuration.'
        : m === 'scenario' ? 'Schedule what happens and when; the drawing shows the failures as scheduled. The response comes next.'
          : 'Inspect the response. Settings changes rerun this scenario from the beginning.'}</span>
      {sum === null ? null : (
        <span class={`workflow-sum${errors.value.length > 0 && m === 'build' ? ' is-error' : ''}`} role="status">{sum}</span>
      )}
    </div>
    <div class="workflow-actions">
      {m !== 'build' ? <button class="btn is-quiet" onClick={() => goToStep(m === 'break' ? 'scenario' : 'build')}>
        {m === 'break' ? '← Edit scenario' : '← Topology'}
      </button> : null}
      {m !== 'break' ? <span class="ctl-off">
        <button class={`btn workflow-next${next.state === 'off' ? ' is-faded' : ''}`} disabled={next.state === 'off'}
          title={next.state === 'off' ? next.why : undefined}
          onClick={() => goToStep(m === 'build' ? 'scenario' : 'break')}>
          {m === 'build' ? 'Define scenario →' : 'Simulate →'}
        </button>
        <WhyPill why={next} />
      </span> : null}
    </div>
  </div>{m === 'break' ? <OutcomeChange /> : null}</>;
}
