/**
 * Compare alternatives (docs/tasks/ui-followups.md 7.6): a baseline against
 * the configuration on screen, under the same named scenario, and the six
 * scenarios run one by one against the configuration.
 *
 * Each run starts from the snapshot's declared topology with the scenario's
 * events at t = 0 in place of its authored ones, so the reader's own events
 * are never touched. Every number is this page's model: outcomes and times
 * are the simulator's, ObserverOverride is FALSE throughout, and the words
 * say so ("(model)", "in this model") wherever a value is shown.
 *
 * Pure: it reads only the snapshots it is given, so the report
 * (`comparisonSection`) and the dialog show the same thing.
 */

import {
  buildClientFiles, computeCommit, declaredPrimary, generateDgmgrl,
  generateInitOraFiles, lineText, resolveRedoGraph, simulate, sortFindings, validate,
} from '@/engine';
import type { ClassicScenario, EngineTrace, GeneratedFile, TopologyDoc } from '@/engine';
import type { Doc } from '@/state/doc';
import type { ComparisonSection } from '../export/report-model';
import { templates } from '../break/events';
import { directCommitLegs } from '../panels/commit-model';

export interface ReviewSnapshot { doc: Doc; edition: '19c' | '26ai' }
export interface ScenarioResult {
  id: ClassicScenario;
  label: string;
  description: string;
  topology: TopologyDoc;
  trace: EngineTrace | null;
  unavailable: string | null;
}

export const topologyFor = (s: ReviewSnapshot): TopologyDoc => ({
  ...s.doc.topology, config: { ...s.doc.topology.config, edition: s.edition },
});

/** Suite scenarios replace authored events; canvas positions and notes do not affect them. */
export const reviewInputKey = (s: ReviewSnapshot): string => JSON.stringify({
  topology: { ...topologyFor(s), events: [] }, params: s.doc.params,
});

/** Each template starts from the declared configuration, with its own event list. */
export function runSuite(snapshot: ReviewSnapshot): ScenarioResult[] {
  const topology = { ...topologyFor(snapshot), events: [] };
  return templates(topology, 0).map((t) => runScenario(snapshot, t.id));
}

export function runScenario(snapshot: ReviewSnapshot, id: ClassicScenario): ScenarioResult {
  const topology = { ...topologyFor(snapshot), events: [] };
  const t = templates(topology, 0).find((t) => t.id === id)!;
  const configured = { ...topology, events: t.events };
  const unavailable = t.enabled.state === 'off' ? t.enabled.why
    : t.events.length === 0 ? 'No event can be generated for this topology.' : null;
  return {
    id, label: t.label, description: t.caption, topology: configured, unavailable,
    trace: unavailable === null ? simulate(configured, t.events, snapshot.doc.params) : null,
  };
}

export const numberText = (n: number): string => Number(n.toFixed(2)).toString();
export function outcomeText(t: EngineTrace | null): string {
  if (!t) return 'Not run';
  if (t.facts.blocked) return 'Blocked';
  if (t.facts.outcome === 'manual' && t.facts.newPrimary !== null) return 'Manual failover';
  const words = {
    failover: 'Failover', continues: 'Primary continues', 'stall-noone': 'Stalled; no promotion',
    'maxprot-shutdown': 'Protection shutdown', manual: 'Manual action needed',
    'observer-lost': 'Observer lost', switchover: 'Switchover',
  };
  return words[t.facts.outcome];
}
export const openedAt = (t: EngineTrace | null): number | null =>
  t && !t.facts.blocked && t.facts.newPrimary !== null ? t.facts.tOpen : null;
export const openText = (t: EngineTrace | null): string => {
  const at = openedAt(t);
  return at === null ? 'No new primary opens' : `t = ${numberText(at)} s (model)`;
};
export function lossText(t: EngineTrace | null): string {
  if (!t || t.facts.blocked) return 'Not assessed';
  if (t.facts.newPrimary === null) return 'Not applicable: no promotion';
  switch (t.facts.dataLossKind) {
    case 'none': return 'None in this model';
    case 'bounded': return `≤ ${numberText(t.facts.dataLossSeconds)} s of redo (model)`;
    case 'manual': return t.facts.dataLossSeconds > 0
      ? `${numberText(t.facts.dataLossSeconds)} s of redo never received (model); nothing bounds it`
      : 'Depends on manual action';
    /* The far sync instance that held the redo went down with the primary. */
    case 'unknown': return 'Unknown: not bounded in this model';
    case 'na': return 'Not applicable';
  }
}

export function commitFor(s: ReviewSnapshot) {
  const t = topologyFor(s);
  if (declaredPrimary(t) === null) return null;
  return computeCommit({
    edition: s.edition, mode: t.config.protectionMode,
    localWriteMs: t.environment.localWriteMs, legs: directCommitLegs(t),
    waitPolicy: s.doc.params.commitWaitPolicy ?? 'all',
  });
}

export function configurationFindings(t: TopologyDoc) {
  const primary = declaredPrimary(t);
  return sortFindings([...validate(t), ...(primary ? resolveRedoGraph(t, { primary }).findings : [])]);
}
export function generatedFiles(s: ReviewSnapshot): GeneratedFile[] {
  const t = topologyFor(s);
  return [generateDgmgrl(t, { findings: configurationFindings(t) }),
    ...generateInitOraFiles(t), ...buildClientFiles(t)];
}

export interface SettingChange { path: string; before: string; after: string }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const shown = (v: unknown): string => v === undefined ? '(absent)' : JSON.stringify(v);
/** Compare settings by stable IDs; ignore presentation, notes and injected events. */
export function settingChanges(a: ReviewSnapshot, b: ReviewSnapshot): SettingChange[] {
  const changes: SettingChange[] = [];
  const walk = (old: unknown, next: unknown, path: string): void => {
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    if (record(old) && record(next)) {
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        walk(old[key], next[key], path ? `${path}.${key}` : key);
      }
    } else if (Array.isArray(old) && Array.isArray(next)
      && [...old, ...next].every((x) => record(x) && typeof x['id'] === 'string')) {
      const ids = new Set([...old, ...next].map((x) => x.id as string));
      for (const id of ids) walk(old.find((x) => x.id === id), next.find((x) => x.id === id), `${path}[${id}]`);
    } else changes.push({ path, before: shown(old), after: shown(next) });
  };
  const settings = (s: ReviewSnapshot) => {
    const { events: _events, label: _label, ...topology } = topologyFor(s);
    return { ...topology, simulation: s.doc.params };
  };
  walk(settings(a), settings(b), '');
  return changes;
}

export interface FileChange { title: string; removed: string[]; added: string[] }
/** Ordered sequences matter (address and target order); show whole changed command blocks. */
export function commandChanges(a: ReviewSnapshot, b: ReviewSnapshot): FileChange[] {
  const before = generatedFiles(a);
  const after = generatedFiles(b);
  const commands = (f?: GeneratedFile) => f?.lines.filter((l) => l.kind === 'cmd').map(lineText) ?? [];
  return [...new Set([...before, ...after].map((f) => f.id))].flatMap((id) => {
    const old = before.find((f) => f.id === id);
    const next = after.find((f) => f.id === id);
    const removed = commands(old); const added = commands(next);
    if (JSON.stringify(removed) === JSON.stringify(added)) return [];
    return [{ title: next?.title ?? old!.title, removed, added }];
  });
}

export interface Expectation { outcome?: string; maxOpenSeconds?: number; maxLossSeconds?: number }
export function assess(r: ScenarioResult, expected: Expectation): string {
  const t = r.trace;
  if (r.unavailable || !t) return 'Not assessed';
  if (t.findings.some((f) => f.id === 'SIM.EPOCH_CAP')) return 'Not assessed: simulation stopped early';
  const checks: boolean[] = [];
  if (expected.outcome) checks.push(outcomeText(t) === expected.outcome);
  if (expected.maxOpenSeconds !== undefined) {
    const at = openedAt(t);
    if (at === null) return 'Not met: no new primary opens';
    checks.push(at <= expected.maxOpenSeconds);
  }
  if (expected.maxLossSeconds !== undefined) {
    if (t.facts.blocked || t.facts.newPrimary === null || !['none', 'bounded'].includes(t.facts.dataLossKind)) return 'Not assessed: no loss bound';
    checks.push(t.facts.dataLossKind === 'none' || t.facts.dataLossSeconds <= expected.maxLossSeconds);
  }
  return checks.length === 0 ? 'No expectation set' : checks.every(Boolean) ? 'Met in this model' : 'Not met';
}

/** "Failover · open by 60 s · loss ≤ 0 s", or a dash when nothing is expected. */
export function expectationText(e: Expectation | undefined): string {
  if (!e) return '—';
  const parts = [
    e.outcome,
    e.maxOpenSeconds === undefined ? undefined : `open by ${numberText(e.maxOpenSeconds)} s`,
    e.maxLossSeconds === undefined ? undefined : `loss ≤ ${numberText(e.maxLossSeconds)} s`,
  ].filter((x): x is string => x !== undefined);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

export interface ComparisonInput {
  baseline: ReviewSnapshot | null;
  scenario: ClassicScenario;
  suite: { snapshot: ReviewSnapshot; results: ScenarioResult[] } | null;
  expectations: Partial<Record<ClassicScenario, Expectation>>;
}

/**
 * What the printable report says about the comparison: present when there is
 * a baseline or a scenario run that still matches the configuration. A run
 * made against different settings is left out rather than printed beside
 * a configuration it did not test.
 */
export function comparisonSection(current: ReviewSnapshot, input: ComparisonInput): ComparisonSection | null {
  const fresh = input.suite !== null && reviewInputKey(input.suite.snapshot) === reviewInputKey(current);
  if (input.baseline === null && !fresh) return null;
  let compare: ComparisonSection['compare'] = null;
  if (input.baseline !== null) {
    const base = input.baseline;
    const a = runScenario(base, input.scenario);
    const b = runScenario(current, input.scenario);
    const ca = commitFor(base);
    const cb = commitFor(current);
    const ms = (c: ReturnType<typeof commitFor>): string => (c ? `${numberText(c.commitMs)} ms (model)` : 'Unavailable');
    compare = {
      baseline: { name: base.doc.meta.name || base.doc.topology.config.name, edition: base.edition },
      current: { name: current.doc.meta.name || current.doc.topology.config.name, edition: current.edition },
      scenario: b.label,
      rows: [
        { k: 'Outcome', baseline: a.unavailable ?? outcomeText(a.trace), current: b.unavailable ?? outcomeText(b.trace) },
        { k: 'New primary opens', baseline: openText(a.trace), current: openText(b.trace) },
        { k: 'Modelled data loss', baseline: lossText(a.trace), current: lossText(b.trace) },
        { k: 'Commit latency, steady state', baseline: ms(ca), current: ms(cb) },
      ],
      settings: settingChanges(base, current),
      commands: commandChanges(base, current),
    };
  }
  const suite = fresh && input.suite !== null
    ? input.suite.results.map((r) => ({
      label: r.label,
      outcome: r.unavailable ?? outcomeText(r.trace),
      open: openText(r.trace),
      loss: lossText(r.trace),
      expected: expectationText(input.expectations[r.id]),
      check: assess(r, input.expectations[r.id] ?? {}),
    }))
    : null;
  return { compare, suite, suiteLeftOut: input.suite !== null && !fresh };
}
