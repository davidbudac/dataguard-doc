/**
 * Every lesson step has to be a document the engine accepts.
 *
 * A lesson is prose plus a way to put the workbench into the state the prose is
 * talking about, so a step that patches a path its preset does not have, or
 * that produces a configuration the broker would refuse, is a broken sentence
 * -- the reader would read one thing and see another.
 *
 * The rule is therefore: a step's document parses, resolves and validates
 * clean, unless the step is *about* a refusal, in which case the finding ids it
 * is allowed to raise are named in EXPECTED below. Naming them is the point: a
 * new error that nobody expected fails the run, and an expected one that
 * stopped happening fails it too.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declaredPrimary, parseTopologyDoc, resolveRedoGraph, validate } from '@/engine';
import { LESSONS } from '@/content';
import {
  applyJsonPatch, baselineTopology, describeEvent, parsePointer, presetIdFor, stepSetsUp,
  stepTopology,
} from '@/ui/learn/apply';

/** Read a JSON pointer out of a value, for the "did it survive" check below. */
const at = (root: unknown, path: string): unknown =>
  parsePointer(path).reduce<unknown>(
    (node, token) => (node === undefined || node === null
      ? undefined
      : (node as Record<string, unknown>)[token]),
    root,
  );

/**
 * Steps whose whole subject is a configuration the broker refuses. The key is
 * `<lesson>/<step index>`; the value is the finding ids that step may raise.
 */
const EXPECTED: Record<string, readonly string[]> = {
  /* "Which protection modes, and where Oracle disagrees with itself": the step
     puts the far-sync configuration into MaxProtection precisely so the
     validation panel names the two rules that refuse it. Its own note says so. */
  'far-sync/3': ['FSFO.FARSYNC_MODE_19C', 'MODE.MAXPROT_NEEDS_SYNC_DB'],
};

const key = (lesson: string, i: number): string => `${lesson}/${i}`;

describe('lesson steps', () => {
  it('resolves a preset for every lesson', () => {
    for (const lesson of LESSONS) {
      expect(presetIdFor(lesson), lesson.id).not.toBeNull();
      expect(baselineTopology(lesson), lesson.id).not.toBeNull();
    }
  });

  it('starts every lesson from a steady state -- no events in the baseline', () => {
    for (const lesson of LESSONS) {
      expect(baselineTopology(lesson)?.events, lesson.id).toEqual([]);
    }
  });

  it('builds a document for every step', () => {
    for (const lesson of LESSONS) {
      for (let i = 0; i < lesson.steps.length; i += 1) {
        const doc = stepTopology(lesson, i);
        expect(doc, key(lesson.id, i)).not.toBeNull();
        /* Parses without repair: the patches produced a document, not a shape. */
        const parsed = parseTopologyDoc(doc);
        expect(
          parsed.issues.filter((s) => s.severity === 'error'),
          key(lesson.id, i),
        ).toEqual([]);
      }
    }
  });

  it('validates clean, except where the step declares what it raises', () => {
    for (const lesson of LESSONS) {
      for (let i = 0; i < lesson.steps.length; i += 1) {
        const doc = stepTopology(lesson, i);
        if (doc === null) continue;
        const primary = declaredPrimary(doc);
        const graph = primary === null ? null : resolveRedoGraph(doc, { primary });
        const findings = [...validate(doc), ...(graph ? graph.findings : [])]
          .filter((f) => f.severity === 'error');
        const allowed = EXPECTED[key(lesson.id, i)] ?? [];
        const unexpected = findings.filter((f) => !allowed.includes(f.id));
        expect(
          unexpected.map((f) => `${f.id}: ${f.message}`),
          key(lesson.id, i),
        ).toEqual([]);
        for (const id of allowed) {
          expect(findings.map((f) => f.id), key(lesson.id, i)).toContain(id);
        }
      }
    }
  });

  it('sets what it says it sets: every patched value survives the parser', () => {
    /* The parser rebuilds the document from the keys it knows, so a misspelled
       property would simply vanish and the step would demonstrate nothing.
       Reading the value back through it is what catches that, and a value the
       engine clamps away as well. */
    for (const lesson of LESSONS) {
      for (let i = 0; i < lesson.steps.length; i += 1) {
        const step = lesson.steps[i];
        const doc = stepTopology(lesson, i);
        if (step === undefined || doc === null) continue;
        const parsed = parseTopologyDoc(doc);
        expect(parsed.doc, key(lesson.id, i)).not.toBeNull();
        for (const op of step.apply?.patches ?? []) {
          if (op.op === 'remove') {
            expect(at(parsed.doc, op.path), `${key(lesson.id, i)} ${op.path}`).toBeUndefined();
          } else {
            expect(at(parsed.doc, op.path), `${key(lesson.id, i)} ${op.path}`).toEqual(op.value);
          }
        }
      }
    }
  });

  it('injects exactly the events the step names, in time order', () => {
    for (const lesson of LESSONS) {
      for (let i = 0; i < lesson.steps.length; i += 1) {
        const step = lesson.steps[i];
        if (step === undefined) continue;
        const doc = stepTopology(lesson, i);
        const want = step.apply?.events ?? [];
        expect(doc?.events.length, key(lesson.id, i)).toBe(want.length);
        const times = doc?.events.map((e) => e.at) ?? [];
        expect([...times].sort((a, b) => a - b), key(lesson.id, i)).toEqual(times);
      }
    }
  });

  it('names every event it injects, in words', () => {
    for (const lesson of LESSONS) {
      const base = baselineTopology(lesson);
      if (base === null) continue;
      for (let i = 0; i < lesson.steps.length; i += 1) {
        const doc = stepTopology(lesson, i);
        for (const e of doc?.events ?? []) {
          const sentence = describeEvent(base, e);
          expect(sentence.length, `${key(lesson.id, i)} ${e.kind}`).toBeGreaterThan(3);
          /* An id leaking into a sentence means a lookup missed. */
          expect(sentence, `${key(lesson.id, i)} ${e.kind}`).not.toMatch(/\bundefined\b/);
        }
      }
    }
  });

  it('is reproducible: the same step is the same document twice', () => {
    for (const lesson of LESSONS) {
      for (let i = 0; i < lesson.steps.length; i += 1) {
        expect(stepTopology(lesson, i), key(lesson.id, i))
          .toEqual(stepTopology(lesson, i));
      }
    }
  });

  it('does not carry one step into the next', () => {
    /* Step 3 of failover-clocks moves the protection mode; the step after it
       must be back at the preset's, because every step starts from the same
       baseline. */
    const lesson = LESSONS[0];
    expect(lesson).toBeDefined();
    if (!lesson) return;
    const modes = lesson.steps.map((_, i) => stepTopology(lesson, i)?.config.protectionMode);
    const baseMode = baselineTopology(lesson)?.config.protectionMode;
    const changed = lesson.steps.map((s) =>
      (s.apply?.patches ?? []).some((p) => p.path === '/config/protectionMode'));
    modes.forEach((m, i) => {
      if (!changed[i]) expect(m, `step ${i}`).toBe(baseMode);
    });
  });

  it('knows which steps have something to set up', () => {
    const sets = LESSONS.flatMap((l) => l.steps.map(stepSetsUp));
    expect(sets.some(Boolean)).toBe(true);
    /* A step with no `apply` has nothing to set up, and the UI says so. */
    const noApply = LESSONS.flatMap((l) => l.steps).filter((s) => s.apply === undefined);
    expect(noApply.every((s) => !stepSetsUp(s))).toBe(true);
  });
});

describe('json patch', () => {
  it('replaces, adds and removes without mutating the input', () => {
    const before = { a: { b: 1 }, list: [1, 2, 3] };
    const after = applyJsonPatch(before, [
      { op: 'replace', path: '/a/b', value: 2 },
      { op: 'add', path: '/list/-', value: 4 },
      { op: 'remove', path: '/list/0' },
    ]);
    expect(after).toEqual({ a: { b: 2 }, list: [2, 3, 4] });
    expect(before).toEqual({ a: { b: 1 }, list: [1, 2, 3] });
  });

  it('refuses a container the document does not have, naming it', () => {
    /* An interior segment is strict: a wrong container is a wrong document. */
    expect(() => applyJsonPatch({ a: { b: 1 } }, [{ op: 'replace', path: '/nope/b', value: 1 }]))
      .toThrow(/nope/);
    expect(() => applyJsonPatch({ list: [1] }, [{ op: 'replace', path: '/list/7', value: 1 }]))
      .toThrow(/list\/7/);
    expect(() => applyJsonPatch({ a: 1 }, [{ op: 'remove', path: '/nope' }]))
      .toThrow(/nope/);
  });

  it('sets an optional property that is absent until set', () => {
    /* `affirm` on a destination is exactly this shape, and every lesson that
       turns AFFIRM on writes `replace`. */
    expect(applyJsonPatch({ dest: {} }, [{ op: 'replace', path: '/dest/affirm', value: 'AFFIRM' }]))
      .toEqual({ dest: { affirm: 'AFFIRM' } });
  });

  it('reads the RFC 6901 escapes', () => {
    const out = applyJsonPatch({ 'a/b': 1, 'c~d': 2 }, [
      { op: 'replace', path: '/a~1b', value: 9 },
      { op: 'replace', path: '/c~0d', value: 8 },
    ]);
    expect(out).toEqual({ 'a/b': 9, 'c~d': 8 });
  });
});


/**
 * The printed page carries the whole document (ui.md SS3). Two rules make that
 * true and neither is visible from a rendered tree, so they are asserted
 * against the stylesheets themselves.
 */
describe('print', () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('collapses the Explain prose for the screen only', () => {
    const learn = read('../../src/styles/learn.css');
    const screenBlock = /@media screen\{[^}]*\.explain-wrap:not\(\.is-open\)>\.explain-body\{display:none\}/;
    expect(learn).toMatch(screenBlock);
  });

  it('opens every Explain on paper, and drops its button', () => {
    const print = read('../../src/styles/print.css');
    expect(print).toContain('.explain-wrap:not(.is-open)>.explain-body{display:block}');
    expect(print).toMatch(/\.explain\{display:none\}/);
    /* The shell stops being a viewport-height grid: rails and dock stack. */
    expect(print).toMatch(/\.app\{display:block;height:auto;overflow:visible[^}]*\}/);
  });
});
