/**
 * What a lesson step does to the workbench (ui.md SS3.4, SS6 "DEMOS ->
 * lesson.steps[].apply").
 *
 * The published page's demo buttons were reproducible because every one of
 * them applied its knobs on top of a reset baseline, never on top of whatever
 * the reader had already changed. The same contract here, spelled out:
 *
 *   baseline  = the lesson's preset, with its default events removed
 *   step doc  = baseline + the step's patches + the step's events
 *
 * So step 3 of a lesson is the same document whether the reader arrived at it
 * from step 2, from a deep link, or after twenty minutes of poking at the
 * inspector. A step never patches a document it did not put there -- which is
 * also why every lesson names a preset (content/types.ts).
 *
 * Everything here is pure: no signals, no DOM. `LessonStep.tsx` is what turns
 * the returned document into an undoable edit.
 */

import { sortEvents } from '@/engine';
import type { JsonPatch, JsonPatchOp, TimedEvent, TopologyDoc } from '@/engine';
import type { Lesson, LessonStep } from '@/content';
import { findPreset, presetDoc } from '@/presets';
import type { PresetId } from '@/presets';

/* ---------------- presets ---------------- */

/**
 * Three lessons name the family rather than the exact document -- `far-sync`,
 * `cascade`, `multi-observer` -- because the family is what the lesson is
 * about. Each one resolves to the plainest member of that family, which is the
 * one the prose walks through.
 */
const PRESET_ALIAS: Record<string, PresetId> = {
  'far-sync': 'far-sync-zero-loss',
  cascade: 'cascade-terminal',
  'multi-observer': 'multi-target-three-observers',
};

/**
 * The preset a lesson starts from, or null when this build does not carry it.
 * Null is a rendered sentence, never a thrown error: a lesson whose preset is
 * missing still reads, it just cannot set the workbench up.
 */
export function presetIdFor(lesson: Lesson): PresetId | null {
  const alias = PRESET_ALIAS[lesson.presetId];
  if (alias !== undefined) return alias;
  return findPreset(lesson.presetId)?.id ?? null;
}

/* ---------------- RFC 6902, the three operations a lesson uses ---------------- */

/** `~1` is `/` and `~0` is `~`, in that order (RFC 6901 SS4). */
const unescapeToken = (t: string): string => t.replace(/~1/g, '/').replace(/~0/g, '~');

export function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new Error(`json pointer must start with "/": ${path}`);
  return path.slice(1).split('/').map(unescapeToken);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Apply one operation, cloning only the containers along the path. Anything
 * the pointer cannot reach throws with the pointer in the message: a lesson
 * that patches a path its preset does not have is a bug in the content, and
 * `test/ui/learn-steps.test.ts` is where it surfaces.
 */
function applyOp(root: unknown, op: JsonPatchOp): unknown {
  const tokens = parsePointer(op.path);
  if (tokens.length === 0) {
    if (op.op === 'replace' || op.op === 'add') return op.value;
    throw new Error('cannot remove the whole document');
  }

  const step = (node: unknown, depth: number): unknown => {
    const token = tokens[depth] as string;
    const last = depth === tokens.length - 1;

    if (Array.isArray(node)) {
      const next = [...node];
      const index = token === '-' ? next.length : Number(token);
      if (!Number.isInteger(index) || index < 0 || index > next.length) {
        throw new Error(`no array index "${token}" in ${op.path}`);
      }
      if (!last) {
        if (index >= next.length) throw new Error(`no array index "${token}" in ${op.path}`);
        next[index] = step(next[index], depth + 1);
        return next;
      }
      if (op.op === 'remove') { next.splice(index, 1); return next; }
      if (op.op === 'add') { next.splice(index, 0, op.value); return next; }
      if (index >= next.length) throw new Error(`no array index "${token}" in ${op.path}`);
      next[index] = op.value;
      return next;
    }

    if (!isRecord(node)) throw new Error(`"${op.path}" runs through a value, not an object`);
    const next: Record<string, unknown> = { ...node };
    if (!last) {
      if (!(token in next)) throw new Error(`no key "${token}" in ${op.path}`);
      next[token] = step(next[token], depth + 1);
      return next;
    }
    if (op.op === 'remove') {
      if (!(token in next)) throw new Error(`no key "${token}" in ${op.path}`);
      delete next[token];
      return next;
    }
    /* `replace` on an absent key is allowed here, unlike in RFC 6902 proper:
       several properties on the document are genuinely optional and absent
       until set -- `affirm` on a destination is the one the lessons use -- and
       "set AFFIRM" is exactly what a step means by replacing it. A leaf key
       that is simply misspelled is caught a level up instead: the parser drops
       what it does not know, and `test/ui/learn-steps.test.ts` asserts that
       every patched value is still there after the document is parsed. Every
       *interior* segment is still strict, because a wrong container is a wrong
       document, not an unset property. */
    next[token] = op.value;
    return next;
  };

  return step(root, 0);
}

export function applyJsonPatch<T>(value: T, patch: JsonPatch): T {
  return patch.reduce<unknown>((acc, op) => applyOp(acc, op), value) as T;
}

/* ---------------- the documents a lesson hands the workbench ---------------- */

/**
 * The lesson's clean baseline: its preset with no events in it. The presets
 * carry a default event set (they are the scenario tests as well), and a
 * lesson that has not asked for a failure yet must open in a steady state.
 */
export function baselineTopology(lesson: Lesson): TopologyDoc | null {
  const id = presetIdFor(lesson);
  if (id === null) return null;
  return { ...presetDoc(id), events: [] };
}

/** The document a step describes: baseline, patched, with its events injected. */
export function stepTopology(lesson: Lesson, index: number): TopologyDoc | null {
  const base = baselineTopology(lesson);
  if (base === null) return null;
  const step = lesson.steps[index];
  if (step === undefined) return base;
  const patched = step.apply?.patches ? applyJsonPatch(base, step.apply.patches) : base;
  const events: readonly TimedEvent[] = step.apply?.events ?? [];
  return { ...patched, events: sortEvents(events) };
}

/** True when the step has something to set up, which is what "Show me" needs. */
export const stepSetsUp = (step: LessonStep): boolean =>
  (step.apply?.events?.length ?? 0) > 0 || (step.apply?.patches?.length ?? 0) > 0;

/* ---------------- saying, in words, what a step changes ---------------- */

const nameOf = (doc: TopologyDoc, id: string): string => {
  const member = doc.members.find((m) => m.id === id);
  if (member) return member.name;
  const observer = doc.observers.find((o) => o.id === id);
  if (observer) return observer.name;
  const host = doc.hosts.find((h) => h.id === id);
  if (host) return host.name;
  const site = doc.sites.find((s) => s.id === id);
  if (site) return site.name;
  return id;
};

/** "DC 1 and DC 2" -- the two ends of a link, named rather than keyed. */
const linkEnds = (doc: TopologyDoc, id: string): string => {
  const link = doc.links.find((l) => l.id === id);
  if (!link) return id;
  return `${nameOf(doc, link.ends[0])} and ${nameOf(doc, link.ends[1])}`;
};

/**
 * One line per event, in the reader's words rather than the engine's. The
 * phrasing describes what happens to the deployment, never what the outcome
 * will be -- the outcome is the timeline's to say, and it branches.
 */
export function describeEvent(doc: TopologyDoc, e: TimedEvent): string {
  const n = (id: string): string => nameOf(doc, id);
  switch (e.kind) {
    case 'host.down': return `the host ${n(e.host)} goes down`;
    case 'host.up': return `the host ${n(e.host)} comes back`;
    case 'site.down': return `everything in ${n(e.site)} goes down`;
    case 'site.up': return `${n(e.site)} comes back`;
    case 'link.cut': return `the network between ${linkEnds(doc, e.link)} is cut`;
    case 'link.heal': return `the network between ${linkEnds(doc, e.link)} is restored`;
    case 'partition': return `the network splits into ${e.groups.length} groups`;
    case 'instance.down': return `instance ${e.instance} of ${n(e.member)} shuts down`;
    case 'instance.up': return `instance ${e.instance} of ${n(e.member)} starts`;
    case 'member.down': return `${n(e.member)} goes down`;
    case 'member.up': return `${n(e.member)} comes back`;
    case 'observer.stop': return `the observer ${n(e.observer)} stops`;
    case 'observer.start': return `the observer ${n(e.observer)} starts`;
    case 'cmd.switchover': return `SWITCHOVER TO ${n(e.to)}`;
    case 'cmd.failover': return `FAILOVER TO ${n(e.to)}${e.immediate === true ? ' IMMEDIATE' : ''}`;
    case 'cmd.reinstate': return `REINSTATE DATABASE ${n(e.member)}`;
    case 'cmd.setMasterObserver': return `SET MASTEROBSERVER TO ${n(e.observer)}`;
    case 'cmd.disableFsfo':
      return `DISABLE FAST_START FAILOVER${e.force === true ? ' FORCE' : ''}`;
    case 'lag.set': return `${n(e.member)} is given the lag the step needs`;
  }
}

/** `/config/fsfo/thresholdSeconds` -> `config · fsfo · thresholdSeconds`. */
export const readPointer = (path: string): string => parsePointer(path).join(' · ');

export interface StepChange {
  /** 'set' / 'add' / 'remove', in the reader's words. */
  verb: string;
  where: string;
  value: string;
}

const showValue = (v: unknown): string => {
  if (v === null) return 'not set';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};

export function describePatch(patch: JsonPatch): StepChange[] {
  return patch.map((op) => ({
    verb: op.op === 'replace' ? 'set' : op.op === 'add' ? 'add' : 'remove',
    where: readPointer(op.path),
    value: op.op === 'remove' ? '' : showValue(op.value),
  }));
}
