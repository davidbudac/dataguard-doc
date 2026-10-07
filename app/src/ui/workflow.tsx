/** The three tasks share one document; changing steps never changes it. */
import { batch } from '@preact/signals';
import { topology, trace } from '@/state/derived';
import { healthyRun, mode, playing, tNow } from '@/state/view';
import type { Mode } from '@/state/view';
import { leaveIntro } from './intro/route';
import { lastInterestingT } from './timeline/build';
import { OutcomeChange } from './break/OutcomeChange';
import '@/styles/workflow.css';

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
  return <><div class="workflow-bar">
    <div class="workflow-purpose">
      <strong>Step {WORKFLOW.indexOf(m) + 1} of 3</strong>
      <span>{m === 'build' ? 'Draw the topology and set its starting configuration.'
        : m === 'scenario' ? 'Schedule what happens and when; the drawing shows the failures as scheduled. The response comes next.'
          : 'Inspect the response. Settings changes rerun this scenario from the beginning.'}</span>
    </div>
    <div class="workflow-actions">
      {m !== 'build' ? <button class="btn is-quiet" onClick={() => goToStep(m === 'break' ? 'scenario' : 'build')}>
        {m === 'break' ? '← Edit scenario' : '← Topology'}
      </button> : null}
      {m !== 'break' ? <button class="btn workflow-next" onClick={() => goToStep(m === 'build' ? 'scenario' : 'break')}>
        {m === 'build' ? 'Define scenario →' : 'See outcome →'}
      </button> : null}
    </div>
  </div>{m === 'break' ? <OutcomeChange /> : null}</>;
}
