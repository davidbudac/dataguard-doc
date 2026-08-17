/**
 * Content invariants.
 *
 * The words are the deliverable here, so the tests are about the words: every
 * lesson teaches something (two steps at least), every claim chip resolves to a
 * citation the engine holds, and none of the phrasings the accuracy rules
 * forbid has crept back in.
 */

import { describe, expect, it } from 'vitest';
import { isCitationId, type CitationId } from '@/engine';
import { LESSONS, LESSON_BY_ID, lessonById } from '@/content/lessons';
import { Fact } from '@/content/facts-ui';
import { FOOTNOTES } from '@/content/footnotes';
import { REF_TABLES } from '@/content/reference';
import { stepSetsUp } from '@/ui/learn/apply';
import { text, vnodes } from './walk';

/** Everything a reader can see, from every lesson, table and footnote. */
const allText = [
  ...LESSONS.map((l) => [
    l.title,
    ...l.steps.map((s) => `${s.title} ${s.note ?? ''} ${text(s.prose)}`),
  ].join(' ')),
  ...REF_TABLES.map((t) => `${t.title} ${text(t.rows)} ${text(t.columns)}`),
  ...FOOTNOTES.map((f) => text(f.body)),
].join('\n');

const factNodes = LESSONS.flatMap((l) =>
  l.steps.flatMap((s) => vnodes(s.prose).filter((n) => n.type === Fact)),
).concat(FOOTNOTES.flatMap((f) => vnodes(f.body).filter((n) => n.type === Fact)));

describe('lessons', () => {
  it('has the nine lessons, in reading order', () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      'failover-clocks', 'transport-layer', 'application-view', 'configuration',
      'sync-transport', 'reference', 'far-sync', 'cascading', 'multi-observer',
    ]);
  });

  it('gives every lesson a unique id, a title and a preset', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LESSONS) {
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.presetId.length).toBeGreaterThan(0);
      expect(LESSON_BY_ID[l.id]).toBe(l);
      expect(lessonById(l.id)).toBe(l);
    }
    expect(lessonById('nope')).toBeUndefined();
  });

  it('gives every lesson at least two steps, each with a title and prose', () => {
    for (const l of LESSONS) {
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(2);
      for (const s of l.steps) {
        expect(s.title.length, `${l.id}/${s.title}`).toBeGreaterThan(0);
        expect(s.prose, `${l.id}/${s.title}`).toBeTruthy();
        expect(text(s.prose).trim().length, `${l.id}/${s.title}`).toBeGreaterThan(40);
      }
    }
  });

  it('names step titles uniquely inside a lesson', () => {
    for (const l of LESSONS) {
      const titles = l.steps.map((s) => s.title);
      expect(new Set(titles).size, l.id).toBe(titles.length);
    }
  });

  /**
   * A step that tells the reader to do something has to be able to do it.
   *
   * "Show me" is disabled on a step with no `apply`, and a disabled button
   * under a sentence that says "cut that link on the canvas and watch" is the
   * page failing to keep its own promise. The detector is the imperative
   * opening a sentence -- Cut, Kill, Crash, Watch, Inject, Show, Move, Drag,
   * Turn, Take, Stop -- because that, and not the mere presence of the word,
   * is what makes a sentence an instruction. The exceptions below are the
   * steps whose action is not the workbench's to perform, each with the
   * reason; anything else that reads as an instruction must set itself up.
   */
  it('gives every step that tells the reader to do something the setup to do it', () => {
    const IMPERATIVE = /(^|[.!?;:\u2014]\s+|\)\s+|\u201c)(Cut|Kill|Crash|Watch|Inject|Show|Move|Drag|Turn|Take|Stop|Break|Pull)\b/;
    /** step key -> why the workbench cannot be the one that does it */
    const ELSEWHERE: Record<string, string> = {
      'sync-transport/6': 'the figure caption is about an AWR report, not this drawing',
      'sync-transport/8': 'reading log file sync as a histogram happens in AWR',
    };
    for (const l of LESSONS) {
      l.steps.forEach((s, i) => {
        const key = `${l.id}/${i}`;
        const says = IMPERATIVE.test(text(s.prose).replace(/\s+/g, ' '))
          || IMPERATIVE.test(s.note ?? '');
        if (!says || ELSEWHERE[key] !== undefined) return;
        expect(stepSetsUp(s), `${key} (${s.title}) tells the reader to act with nothing to apply`)
          .toBe(true);
      });
    }
  });

  it('applies events at a non-negative time and patches with a rooted path', () => {
    for (const l of LESSONS) {
      for (const s of l.steps) {
        for (const e of s.apply?.events ?? []) {
          expect(e.at, `${l.id}/${s.title}`).toBeGreaterThanOrEqual(0);
          expect(typeof e.kind).toBe('string');
        }
        for (const p of s.apply?.patches ?? []) {
          expect(p.path.startsWith('/'), `${l.id}/${s.title} ${p.path}`).toBe(true);
          expect(['add', 'remove', 'replace']).toContain(p.op);
        }
      }
    }
  });
});

describe('<Fact> chips', () => {
  it('are used at all, in the new lessons especially', () => {
    expect(factNodes.length).toBeGreaterThan(20);
    for (const id of ['far-sync', 'cascading', 'multi-observer'] as const) {
      const lesson = LESSON_BY_ID[id];
      const used = lesson.steps.flatMap((s) => vnodes(s.prose).filter((n) => n.type === Fact));
      expect(used.length, id).toBeGreaterThanOrEqual(5);
    }
  });

  it('resolve every id to an engine citation', () => {
    for (const node of factNodes) {
      const raw = (node.props as unknown as { id: CitationId | CitationId[] }).id;
      const ids = Array.isArray(raw) ? raw : [raw];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(isCitationId(id), String(id)).toBe(true);
    }
  });

  it('carry a note wherever the basis is not "documented"', () => {
    for (const node of factNodes) {
      const p = node.props as unknown as { basis?: string; note?: string };
      if (p.basis !== undefined && p.basis !== 'documented') {
        expect(p.note, `${p.basis} chip without a note`).toBeTruthy();
      }
    }
    /* A conflict cites both sides. */
    for (const node of factNodes) {
      const p = node.props as unknown as { basis?: string; id: CitationId | CitationId[] };
      if (p.basis === 'conflict') {
        expect(Array.isArray(p.id) ? p.id.length : 1).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('forbidden phrasings', () => {
  const FORBIDDEN: [string, string][] = [
    ['FILE=', 'START OBSERVER takes FILE IS, never FILE='],
    ['first viable', 'FastStartFailoverTarget is an order, not a viability walk'],
    ['30 remote destinations', 'the documented figure is "up to 30 terminal destinations"'],
    ['TAF or Application Continuity resumes', 'the two are different promises'],
    ['defaults identical in 26ai', 'the 26ai ObserverPing* defaults are contradicted upstream'],
    ['log file parallel write proves', 'that event is never the evidence for max-not-sum'],
  ];

  for (const [phrase, why] of FORBIDDEN) {
    it(`never says "${phrase}" -- ${why}`, () => {
      expect(allText.includes(phrase)).toBe(false);
    });
  }

  it('says PRIMARY UNOBSERVED only about the target standby', () => {
    const idx = allText.indexOf('PRIMARY UNOBSERVED');
    expect(idx).toBeGreaterThan(-1);
    expect(allText.slice(Math.max(0, idx - 200), idx)).toContain('target');
  });
});
