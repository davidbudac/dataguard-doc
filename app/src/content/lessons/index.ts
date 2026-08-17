import type { Lesson, LessonId } from '../types';
import { failoverClocks } from './failover-clocks';
import { transportLayer } from './transport-layer';
import { applicationView } from './application-view';
import { configuration } from './configuration';
import { syncTransport } from './sync-transport';
import { reference } from './reference';
import { farSync } from './far-sync';
import { cascading } from './cascading';
import { multiObserver } from './multi-observer';

export {
  failoverClocks, transportLayer, applicationView, configuration, syncTransport, reference,
  farSync, cascading, multiObserver,
};

/** Reading order: the six ported chapters, then the three topology lessons. */
export const LESSONS: Lesson[] = [
  failoverClocks, transportLayer, applicationView, configuration, syncTransport, reference,
  farSync, cascading, multiObserver,
];

export const LESSON_BY_ID: Record<LessonId, Lesson> = LESSONS.reduce(
  (acc, l) => ({ ...acc, [l.id]: l }),
  {} as Record<LessonId, Lesson>,
);

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
