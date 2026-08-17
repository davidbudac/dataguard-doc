/**
 * One lesson: its steps in order, the configuration they run on, and the
 * footnotes they cite (ui.md SS3.4, SS6).
 *
 * The lesson head says which document the workbench beside it is drawing --
 * the preset's own paragraph, not a new one -- because a reader who cannot
 * name what is on the canvas cannot read a step that changes it.
 */

import type { Lesson as LessonData } from '@/content';
import { findPreset } from '@/presets';
import { LESSONS } from '@/content';
import { lessonStep } from '@/state/view';
import { presetIdFor } from './apply';
import { LessonStep } from './LessonStep';
import { footnotesFor } from './footnotes';
import { lessonHref, neighbours } from './route';

export function Lesson({ lesson }: { lesson: LessonData }) {
  const pid = presetIdFor(lesson);
  /* `findPreset` answers undefined for an id it does not carry; the head below
     branches on null, so the two absences are collapsed here rather than
     spelled out twice at the point of use. */
  const preset = (pid === null ? null : findPreset(pid)) ?? null;
  const active = lessonStep.value;
  const notes = footnotesFor(lesson);
  const { prev, next } = neighbours(lesson.id);
  const number = LESSONS.findIndex((l) => l.id === lesson.id) + 1;

  return (
    <article class="lesson">
      <header class="lesson-hd">
        <p class="eyebrow">Lesson {number} of {LESSONS.length}</p>
        <h2 class="lesson-t">{lesson.title}</h2>
        {preset === null ? (
          <p class="caption">
            This lesson names the configuration{' '}
            <span class="mono">{lesson.presetId}</span>, which this build does not carry. The
            prose below is complete; the workbench beside it is showing whatever you last had
            open.
          </p>
        ) : (
          <p class="caption lesson-preset">
            <span class="mono">{preset.title}</span> &mdash; {preset.summary}
          </p>
        )}
      </header>

      {lesson.steps.map((step, i) => (
        <LessonStep key={`${lesson.id}-${step.title}`} lesson={lesson} index={i} active={i === active} />
      ))}

      {notes.length === 0 ? null : (
        <div class="ct-footnotes lesson-fn">
          <p class="ct-eyebrow">Footnotes</p>
          {notes.map((f) => (
            <div class="ct-footnote" key={f.n}>
              <span class="ct-fn-n">{f.n}</span>
              {f.body}
            </div>
          ))}
        </div>
      )}

      <nav class="lesson-nav" aria-label="Lessons">
        {prev === null ? <span /> : (
          <a class="lesson-prev" href={lessonHref(prev.id)}>&larr; {prev.title}</a>
        )}
        {next === null ? <span /> : (
          <a class="lesson-next" href={lessonHref(next.id)}>{next.title} &rarr;</a>
        )}
      </nav>
    </article>
  );
}
