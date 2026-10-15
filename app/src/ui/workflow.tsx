/** The three tasks share one document; changing steps never changes it. */
import { batch } from '@preact/signals';
import { redoGraph, topology, trace } from '@/state/derived';
import { healthyRun, mode, playing, tNow } from '@/state/view';
import type { Mode } from '@/state/view';
import { leaveIntro } from './intro/route';
import { lastInterestingT } from './timeline/build';
import { OutcomeChange } from './break/OutcomeChange';
import type { WhyState } from './common/WhyPill';
import '@/styles/workflow.css';

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

/**
 * What stands under the top bar for the three steps: only Simulate's notice
 * of an outcome that changed since the last edit. The band that used to be
 * here -- "Step 1 of 3 · Draw the topology ..." with Define scenario → at its
 * end -- said what the numbered steps in the bar already say and cost every
 * screen 50 px of height the drawing and the lanes needed more. Its gate is on
 * the steps now (TopBar.tsx); its tally (members, events) went with it -- the
 * dock and the Events rail show the same counts where they are drawn.
 */
export function WorkflowBar() {
  return mode.value === 'break' ? <OutcomeChange /> : null;
}
