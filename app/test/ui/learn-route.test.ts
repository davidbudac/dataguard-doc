/**
 * `#/learn/<lesson>/<step>` is an address, and addresses are a public contract.
 *
 * Reading it is what makes a link to a step land on that step, with the
 * workbench set up for it; writing it is what makes the lesson list, the
 * previous/next pair and the per-step anchors real links.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from '@/content';
import { classicDoc, doc } from '@/state/doc';
import { canUndo, resetHistory } from '@/state/history';
import { lessonId, lessonStep, mode, tNow } from '@/state/view';
import { presetId } from '@/state/url';
import {
  applyLearnRoute, learnHref, lessonHref, neighbours, openLessonStep, parseLearnRoute,
} from '@/ui/learn/route';
import { stepTopology } from '@/ui/learn/apply';

beforeEach(() => {
  resetHistory(classicDoc());
  mode.value = 'build';
  lessonId.value = null;
  lessonStep.value = 0;
  tNow.value = 0;
  presetId.value = null;
});

describe('learn route', () => {
  it('reads a lesson and a step', () => {
    const r = parseLearnRoute('#/learn/failover-clocks/2');
    expect(r?.lesson.id).toBe('failover-clocks');
    expect(r?.step).toBe(2);
  });

  it('reads a lesson on its own as its first step', () => {
    expect(parseLearnRoute('#/learn/reference')?.step).toBe(0);
    expect(parseLearnRoute('#/learn/reference/')?.lesson.id).toBe('reference');
  });

  it('accepts the hash with or without its "#"', () => {
    expect(parseLearnRoute('/learn/cascading/1')?.lesson.id).toBe('cascading');
  });

  it('clamps a step past the end onto the last one', () => {
    const lesson = lessonById('configuration');
    expect(lesson).toBeDefined();
    const r = parseLearnRoute('#/learn/configuration/99');
    expect(r?.step).toBe((lesson?.steps.length ?? 1) - 1);
  });

  it('is not a route when it is not one', () => {
    for (const hash of ['', '#t=abcd', '#cfg=1', '#/learn/', '#/learn/nope/1', '#ch-clocks']) {
      expect(parseLearnRoute(hash), hash).toBeNull();
    }
  });

  it('round trips every lesson through its own href', () => {
    for (const lesson of LESSONS) {
      expect(parseLearnRoute(lessonHref(lesson.id))?.lesson.id).toBe(lesson.id);
      const last = lesson.steps.length - 1;
      const r = parseLearnRoute(learnHref(lesson.id, last));
      expect(r?.step, lesson.id).toBe(last);
    }
  });

  it('opening a step sets the view and the workbench together', () => {
    const lesson = lessonById('failover-clocks');
    expect(lesson).toBeDefined();
    if (!lesson) return;
    tNow.value = 42;
    openLessonStep(lesson, 2, 'live');
    expect(mode.value).toBe('learn');
    expect(lessonId.value).toBe('failover-clocks');
    expect(lessonStep.value).toBe(2);
    /* The playhead goes back to the start: the step's events are at t = 0. */
    expect(tNow.value).toBe(0);
    expect(doc.value.topology).toEqual(stepTopology(lesson, 2));
    expect(presetId.value).toBe('classic');
  });

  it('is undoable when followed, and is the baseline when it is the link you arrived on', () => {
    const lesson = lessonById('transport-layer');
    expect(lesson).toBeDefined();
    if (!lesson) return;

    openLessonStep(lesson, 1, 'live');
    expect(canUndo.value).toBe(true);

    resetHistory(classicDoc());
    openLessonStep(lesson, 1, 'boot');
    expect(canUndo.value).toBe(false);
    expect(doc.value.topology).toEqual(stepTopology(lesson, 1));
  });

  it('applies a hash route and reports what it applied', () => {
    const applied = applyLearnRoute('#/learn/far-sync/1', 'boot');
    expect(applied?.lesson.id).toBe('far-sync');
    expect(lessonId.value).toBe('far-sync');
    expect(applyLearnRoute('#t=nothing-to-do-with-lessons')).toBeNull();
  });

  it('knows the reading order', () => {
    expect(neighbours('failover-clocks').prev).toBeNull();
    expect(neighbours('failover-clocks').next?.id).toBe('transport-layer');
    expect(neighbours(LESSONS[LESSONS.length - 1]?.id ?? '').next).toBeNull();
    expect(neighbours('not-a-lesson')).toEqual({ prev: null, next: null });
  });
});
