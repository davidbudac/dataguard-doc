/**
 * Deep links into a lesson: `#/learn/<lesson>/<step>` (ui.md SS1, SS3.4).
 *
 * The published document links at chapters, and the reading list links at
 * paragraphs; a lesson step is the same kind of address, so it gets a real one.
 * Two rules keep it honest:
 *
 *  - **The step index is the one `?step=` carries** -- zero based, one meaning
 *    of "step" across the whole contract, not two.
 *  - **The route is read, not written.** The address bar is owned by
 *    `state/url.ts`, which parks the compressed document in the fragment
 *    (`#t=`) and the reading position in the query (`?lesson=&step=`). A
 *    `#/learn/...` link is therefore an *entry* form: it is accepted on load
 *    and on a hash change, applied, and then replaced by the canonical URL on
 *    the next flush. That is why the anchors below are real `href`s -- they
 *    survive a middle click and a copy -- while nothing here calls
 *    `replaceState` itself.
 *
 * Arriving through such a link also sets the workbench up for that step, the
 * way clicking "Show me" would: a link to a step that showed the wrong
 * document would be a link to nothing.
 */

import { LESSONS, lessonById } from '@/content';
import type { Lesson } from '@/content';
import { doc, withTopology } from '@/state/doc';
import { edit, resetHistory } from '@/state/history';
import { presetId } from '@/state/url';
import { lessonId, lessonStep, mode, tNow } from '@/state/view';
import { presetIdFor, stepTopology } from './apply';

export interface LearnRoute {
  lesson: Lesson;
  /** Clamped into the lesson: a link to step 99 opens the last step. */
  step: number;
}

const LEARN_RE = /^#?\/learn\/([A-Za-z0-9-]+)(?:\/(\d+))?\/?$/;

/** Parse a `#/learn/<lesson>/<step>` hash. Null when the hash is not one. */
export function parseLearnRoute(hash: string): LearnRoute | null {
  const m = LEARN_RE.exec(hash);
  if (!m) return null;
  const lesson = lessonById(m[1] as string);
  if (!lesson) return null;
  const raw = m[2] === undefined ? 0 : Number(m[2]);
  const step = Math.max(0, Math.min(lesson.steps.length - 1, Math.trunc(raw)));
  return { lesson, step };
}

/** The address of one step, for an `href`. */
export const learnHref = (lesson: string, step = 0): string => `#/learn/${lesson}/${step}`;

/** The address of a lesson's first step. */
export const lessonHref = (lesson: string): string => learnHref(lesson, 0);

/**
 * Put the view and the workbench on one lesson step.
 *
 * `how` says where the call came from: on boot the step's document *is* the
 * document the link carries, so it becomes the baseline and the undo stack
 * starts empty; later, following a link is an edit like any other, and one
 * press of Undo puts the reader's own configuration back.
 */
export function openLessonStep(lesson: Lesson, step: number, how: 'boot' | 'live' = 'live'): void {
  mode.value = 'learn';
  lessonId.value = lesson.id;
  lessonStep.value = step;
  tNow.value = 0;

  const topology = stepTopology(lesson, step);
  if (topology === null) return;
  const pid = presetIdFor(lesson);
  if (how === 'boot') {
    resetHistory(withTopology(doc.value, topology));
  } else {
    edit(
      `Open ${lesson.title}, step ${step + 1}`,
      (d) => withTopology(d, topology),
      `lesson:${lesson.id}`,
    );
  }
  presetId.value = pid;
}

/** Apply the route in `hash`, if it is one. Returns what it applied. */
export function applyLearnRoute(hash: string, how: 'boot' | 'live' = 'live'): LearnRoute | null {
  const route = parseLearnRoute(hash);
  if (route === null) return null;
  openLessonStep(route.lesson, route.step, how);
  return route;
}

/**
 * Follow `#/learn/...` links pressed while the page is open.
 *
 * `replaceState` does not fire `hashchange`, so the canonical URL that
 * `state/url.ts` writes never re-enters here -- only a link the reader
 * actually followed does. Returns a teardown, for tests.
 */
export function startLearnRouting(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onHash = (): void => { applyLearnRoute(location.hash, 'live'); };
  window.addEventListener('hashchange', onHash);
  return () => window.removeEventListener('hashchange', onHash);
}

/** Reading order, for the previous/next links at the foot of a lesson. */
export function neighbours(id: string): { prev: Lesson | null; next: Lesson | null } {
  const i = LESSONS.findIndex((l) => l.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: LESSONS[i - 1] ?? null, next: LESSONS[i + 1] ?? null };
}
