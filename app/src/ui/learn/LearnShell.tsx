/**
 * Learn mode: the prose column (ui.md SS3, SS3.4).
 *
 * The shell puts this in the stage and the live workbench in the rail beside
 * it, so the same deployment is on screen twice -- once in words, once drawn.
 * Nine lessons: the six chapters of the published document, ported by copy, and
 * the three topology lessons the new engine made possible.
 *
 * Everything here is a real link. The lesson list, the previous/next pair and
 * the per-step anchors all carry an `href` of the form `#/learn/<lesson>/<step>`
 * (route.ts), so a lesson step can be sent to somebody, opened in a new tab and
 * bookmarked -- and so the reading position survives with no script at all.
 *
 * `LearnWorkbenchHeader` at the foot of this file is the other half of the
 * mode: the row the shell puts at the head of the workbench, which is the only
 * part of Learn that lives in the right column.
 */

import { useEffect } from 'preact/hooks';
import { LESSONS, lessonById } from '@/content';
import { lessonId, lessonStep, mode } from '@/state/view';
import { applyLearnRoute, lessonHref, openStepInMode } from './route';
import { Lesson } from './Lesson';

import '@/styles/learn.css';

function LessonList({ current }: { current: string | null }) {
  return (
    <nav class="learn-list" aria-label="Lessons">
      <ol class="learn-ol">
        {LESSONS.map((l, i) => (
          <li key={l.id} class={l.id === current ? 'is-current' : undefined}>
            <a
              href={lessonHref(l.id)}
              aria-current={l.id === current ? 'page' : undefined}
            >
              <span class="learn-n">{String(i + 1).padStart(2, '0')}</span>
              <span class="learn-title">{l.title}</span>
              <span class="learn-steps">
                {l.steps.length} step{l.steps.length === 1 ? '' : 's'}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Intro() {
  return (
    <header class="learn-intro">
      <p class="eyebrow">Learn</p>
      <h2 class="learn-h">Nine lessons, one workbench</h2>
      <p class="prose">
        Each lesson is prose on this side and a live configuration on the other. A step that
        can be demonstrated carries a &ldquo;Show me&rdquo; button: it loads the lesson&rsquo;s
        configuration, applies exactly the properties and events that step is about, and leaves
        everything else at its default &mdash; so a step shows the same thing however you
        reached it. &ldquo;Open in the detailed timeline&rdquo; and &ldquo;Open in Topology&rdquo; &mdash; under the
        step, or at the head of the workbench beside it &mdash; take the same document to the
        run in full, or to the drawing you can change.
      </p>
      <p class="caption">
        The first six lessons are the chapters of the published document, carried over
        sentence by sentence. The last four cover shapes the earlier page could not draw:
        far sync, cascading standbys, several observers with several failover targets, and
        RAC databases in both roles.
      </p>
    </header>
  );
}

/**
 * The head of Learn's workbench -- the right column, above the drawing.
 *
 * Two things were only findable by reading: which step the drawing under it is
 * set up for, and the way out of Learn with that document. The step's own
 * "Open in the detailed timeline" sits in the prose column, several screens down in a long
 * lesson, so the reader looking at the drawing had no way out of it in sight.
 * This row puts both above the fold, and adds Topology, because "now let me
 * change it" is the other thing a reader wants from a drawing.
 *
 * It is the same function the prose button calls (`openStepInMode`), not a
 * second implementation of it. With no lesson open there is no step to set up,
 * so the buttons only switch mode -- and the row says that is what the drawing
 * is, rather than naming a step that is not there.
 *
 * Neither button is gray on the narrow viewer, and that is deliberate. The
 * read-only gate (`canEdit`) is about the controls that *change* a
 * configuration -- the inspector, the canvas, the action bar -- which a phone
 * has no room for. Following a lesson step is not one of them: the step's own
 * "Show me" and "Open in the detailed timeline" in the prose column are ungated at every
 * width, and so is arriving on `#/learn/<lesson>/<step>` from a link. Graying
 * these two would refuse the reader an address they can reach by scrolling
 * down the same page, which is a refusal that restricts nothing.
 *
 * The shell renders this at the top of the workbench in both layouts: beside
 * the prose on a wide screen, under it once the rail has become the dock.
 */
export function LearnWorkbenchHeader() {
  const id = lessonId.value;
  const lesson = id === null ? undefined : lessonById(id);
  const index = lessonStep.value;
  const step = lesson?.steps[index];

  const open = (target: 'break' | 'build') => (): void => {
    if (lesson !== undefined && step !== undefined) openStepInMode(lesson, index, target);
    else mode.value = target;
  };

  return (
    <header class="lwh">
      <p class="lwh-what">
        {step === undefined || lesson === undefined ? (
          <>
            <span class="eyebrow">Workbench</span>
            <span class="lwh-t">No lesson open &mdash; the current document</span>
          </>
        ) : (
          <>
            <span class="eyebrow">
              Step {index + 1}/{lesson.steps.length}
            </span>
            <span class="lwh-t" title={step.title}>{step.title}</span>
          </>
        )}
      </p>
      <span class="lwh-go">
        <button type="button" class="btn" onClick={open('break')}>
          Open in the detailed timeline
        </button>
        {' '}
        <button type="button" class="btn" onClick={open('build')}>
          Open in Topology
        </button>
      </span>
    </header>
  );
}

export function LearnShell() {
  const current = lessonId.value;
  const lesson = current === null ? undefined : lessonById(current);

  /* A cold load through `#/learn/<lesson>/<step>` is applied at boot
     (main.tsx). This is the same route read once more on mount, for the case
     where the shell arrives in Learn mode without one -- following the link
     rather than second-guessing it. */
  useEffect(() => {
    if (lessonId.value === null && typeof location !== 'undefined') {
      applyLearnRoute(location.hash, 'live');
    }
  }, []);

  if (!lesson) {
    return (
      <div class="learn">
        <Intro />
        <LessonList current={null} />
        {current === null ? null : (
          <p class="empty">
            <span class="empty-k">Not found</span>
            No lesson is called <span class="mono">{current}</span> here. The ten above are
            all of them.
          </p>
        )}
      </div>
    );
  }

  return (
    <div class="learn">
      <LessonList current={lesson.id} />
      <Lesson lesson={lesson} />
      <p class="learn-back">
        <a
          href="#/learn"
          onClick={(e) => {
            e.preventDefault();
            lessonId.value = null;
            lessonStep.value = 0;
          }}
        >
          All lessons
        </a>
      </p>
    </div>
  );
}
