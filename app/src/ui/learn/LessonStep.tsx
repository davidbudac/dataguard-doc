/**
 * One step of a lesson: the prose, and the button that puts the workbench
 * beside it into the state the prose is talking about (ui.md SS3.4).
 *
 * The published page's demo buttons are the ancestor -- `DEMOS` in the legacy
 * fragment, one entry per note card, each one labelled "Show me ..." and each
 * one applying its knobs over a reset baseline. Two things are new:
 *
 *  - **"Open in Break"** takes the same document and switches to the mode that
 *    draws the clocks, which is what the legacy button's `jump()` did.
 *  - **The step says what it set up**, in an Explain block: the preset it
 *    started from, every property it changed and every event it injected. A
 *    reader who cannot see what the button did cannot trust what the workbench
 *    then shows.
 *
 * A step with nothing to set up keeps the button and says why it is gray
 * (invariant one), rather than dropping it and leaving a ragged column.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { Lesson } from '@/content';
import { WhyPill } from '@/ui/common/WhyPill';
import type { WhyState } from '@/ui/common/WhyPill';
import { findPreset } from '@/presets';
import {
  baselineTopology, describeEvent, describePatch, presetIdFor, stepSetsUp,
} from './apply';
import { openLessonStep, openStepInMode, learnHref } from './route';
import { Explain } from './Explain';

export interface LessonStepProps {
  lesson: Lesson;
  index: number;
  /** The step the workbench is currently set up for. */
  active: boolean;
}

export const stepDomId = (lesson: string, index: number): string => `step-${lesson}-${index}`;

export function LessonStep({ lesson, index, active }: LessonStepProps) {
  const step = lesson.steps[index];
  if (step === undefined) return null;

  const pid = presetIdFor(lesson);
  const preset = pid === null ? null : findPreset(pid);
  const sets = stepSetsUp(step);

  /* Every gray control says why, and the reason is the true one: either the
     lesson names a preset this build does not carry, or the step genuinely has
     nothing to set up and the workbench already shows what it describes. */
  const why: WhyState = pid === null
    ? { state: 'off', why: `no preset "${lesson.presetId}" in this build` }
    : sets
      ? { state: 'on' }
      : { state: 'off', why: 'nothing to set up: this step changes no property and injects no event' };
  const off = why.state === 'off';

  /* A link to a step is an address: arriving on it brings the step into view
     (a deep link into step 9 of 14 must not open on step 1). `nearest`, so
     pressing "Show me" on a step already on screen does not jerk the column. */
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const show = (): void => { openLessonStep(lesson, index, 'live'); };
  const openInTimeline = (): void => { openStepInMode(lesson, index, 'break'); };

  const base = baselineTopology(lesson);
  const changes = step.apply?.patches ? describePatch(step.apply.patches) : [];
  const events = step.apply?.events ?? [];

  return (
    <section
      ref={ref}
      class={`ls${active ? ' is-active' : ''}`}
      id={stepDomId(lesson.id, index)}
      aria-current={active ? 'step' : undefined}
    >
      <p class="ls-hd">
        <span class="eyebrow">Step {index + 1} of {lesson.steps.length}</span>
        <a class="ls-anchor" href={learnHref(lesson.id, index)} title="A link to this step">
          link
        </a>
      </p>
      <h3 class="ls-t">{step.title}</h3>

      <div class="prose ls-prose">{step.prose}</div>

      {step.note === undefined ? null : <p class="caption ls-note">{step.note}</p>}

      <div class="ls-actions">
        <span class="ctl-off">
          <span class={off ? 'is-faded' : undefined}>
            <button type="button" class="btn is-primary" disabled={off} onClick={show}>
              Show me
            </button>
            {' '}
            <button type="button" class="btn" disabled={off} onClick={openInTimeline}>
              Open in Outcome
            </button>
          </span>
          <WhyPill why={why} />
        </span>
      </div>

      {!sets || base === null ? null : (
        <Explain label="What this sets up">
          <div class="ls-setup">
            <p class="caption">
              Starts from{' '}
              <span class="mono">{preset?.title ?? lesson.presetId}</span>{' '}
              with no events in it, then:
            </p>
            <ul class="ls-setup-list">
              {changes.map((c) => (
                <li key={`${c.where}=${c.value}`}>
                  <span class="mono">{c.verb} {c.where}</span>
                  {c.value === '' ? null : <> to <span class="mono">{c.value}</span></>}
                </li>
              ))}
              {events.map((e, i) => (
                <li key={`${e.kind}-${i}`}>
                  <span class="mono">t = {e.at} s</span> &mdash; {describeEvent(base, e)}
                </li>
              ))}
            </ul>
            <p class="caption">
              Every step starts from that same baseline, so a step shows the same thing
              however you reached it.
            </p>
          </div>
        </Explain>
      )}
    </section>
  );
}
