/**
 * The content module: every word the Learn section renders.
 *
 * Prose is ported by copy from the published simulator, or written from
 * `design/facts.md` with its citations attached -- never rewritten from memory.
 * The stylesheet is imported here so a consumer gets the prose styling by
 * importing the content, and so `content.css` is the only stylesheet this
 * module owns.
 */

import './content.css';

export type { Lesson, LessonId, LessonStep, StepApply } from './types';
export { set } from './types';
export { Fact, Cite, M } from './facts-ui';
export type { FactProps } from './facts-ui';
export { FOOTNOTES, Fn, Footnotes } from './footnotes';
export type { Footnote } from './footnotes';
export { Caption, Code, Dim, Eyebrow, Figure, Hl, Note, P } from './prose';
export { CommitNestingFigure } from './figures/CommitNestingFigure';
export { NetTimeoutFigure } from './figures/NetTimeoutFigure';
export * from './reference';
export {
  LESSONS, LESSON_BY_ID, lessonById,
  applicationView, cascading, configuration, failoverClocks, farSync, multiObserver, reference,
  syncTransport, transportLayer,
} from './lessons';
