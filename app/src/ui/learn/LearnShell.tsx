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
 */

import { useEffect } from 'preact/hooks';
import { LESSONS, lessonById } from '@/content';
import { lessonId, lessonStep } from '@/state/view';
import { applyLearnRoute, lessonHref } from './route';
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
              <span class="learn-steps mono">
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
        reached it. &ldquo;Open in Break&rdquo; takes the same document to the timeline.
      </p>
      <p class="caption">
        The first six lessons are the chapters of the published document, carried over
        sentence by sentence. The last three cover shapes the earlier page could not draw:
        far sync, cascading standbys, and several observers with several failover targets.
      </p>
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
            No lesson is called <span class="mono">{current}</span> here. The nine above are
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
