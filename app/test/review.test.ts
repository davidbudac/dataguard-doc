import { describe, expect, it } from 'vitest';
import { classicDoc, makeDoc } from '@/state/doc';
import { PRESETS } from '@/presets';
import { simulate } from '@/engine';
import {
  assess, commandChanges, commitFor, lossText, openedAt, outcomeText,
  runScenario, runSuite, settingChanges,
} from '@/ui/review/model';
import type { ReviewSnapshot } from '@/ui/review/model';
import { comparisonSection, expectationText } from '@/ui/review/model';
import { buildReport } from '@/ui/export/report-model';

const snapshot = (): ReviewSnapshot => ({ doc: classicDoc(), edition: '19c' });

describe('independent review runs', () => {
  it('does not mutate authored events or the current document', () => {
    const s = snapshot();
    const before = JSON.stringify(s);
    const suite = runSuite(s);
    expect(suite).toHaveLength(6);
    expect(JSON.stringify(s)).toBe(before);
    for (const row of suite) {
      if (!row.unavailable) expect(row.trace).toEqual(simulate(row.topology, row.topology.events, s.doc.params));
    }
    expect(suite.find((r) => r.id === 'crash')?.trace?.facts.outcome).toBe('failover');
    expect(suite.find((r) => r.id === 'observer-lost')?.topology.events.some((e) => e.kind === 'host.down')).toBe(true);
  });

  it('compares threshold changes with the same scenario and independent snapshots', () => {
    const a = snapshot(); const b = structuredClone(a);
    b.doc.topology.config.fsfo.thresholdSeconds = 60;
    const first = runScenario(a, 'crash'); const second = runScenario(b, 'crash');
    expect(openedAt(second.trace)! - openedAt(first.trace)!).toBeCloseTo(30);
    expect(settingChanges(a, b)).toEqual([{ path: 'config.fsfo.thresholdSeconds', before: '30', after: '60' }]);
    expect(commandChanges(a, b).some((c) => c.added.some((line) => line.includes('FastStartFailoverThreshold') && line.includes('60')))).toBe(true);
  });

  it('ignores canvas moves and events but preserves meaningful member and target order changes', () => {
    const a = snapshot(); const b = structuredClone(a);
    b.doc.layout['prm01'] = { dx: 8, dy: 0 };
    b.doc.meta.notes = 'My notes';
    b.doc.topology.events = runScenario(a, 'crash').topology.events;
    expect(settingChanges(a, b)).toEqual([]);
    b.doc.topology.members.reverse();
    expect(settingChanges(a, b)).toEqual([]);
    b.edition = '26ai';
    expect(settingChanges(a, b)).toContainEqual({ path: 'config.edition', before: '"19c"', after: '"26ai"' });
  });

  it('reports unavailable cases and never passes a missing opening or loss bound', () => {
    const s = snapshot(); s.doc.topology.observers = [];
    const suite = runSuite(s);
    const missing = suite.find((r) => r.id === 'observer-lost')!;
    expect(missing.unavailable).toBeTruthy();
    expect(assess(missing, { maxOpenSeconds: 60 })).toBe('Not assessed');
    const crash = suite.find((r) => r.id === 'crash')!;
    expect(assess(crash, { maxOpenSeconds: 60 })).toContain('no new primary');
    expect(assess(crash, { maxLossSeconds: 0 })).toContain('no loss bound');
    expect(lossText(crash.trace)).toContain('no promotion');
  });

  it('compares optional expectations only against complete modelled results', () => {
    const s = snapshot(); const r = runScenario(s, 'crash');
    expect(assess(r, {})).toBe('No expectation set');
    expect(assess(r, { outcome: 'Failover', maxOpenSeconds: 60, maxLossSeconds: 0 })).toBe('Met in this model');
    expect(assess(r, { maxOpenSeconds: 1 })).toBe('Not met');
    s.doc.params.maxEpochs = 1;
    expect(assess(runScenario(s, 'crash'), { outcome: 'Failover' })).toContain('stopped early');
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('runs and reports every scenario for %s', (_id, preset) => {
    for (const edition of ['19c', '26ai'] as const) {
      const s = { doc: makeDoc(preset.doc()), edition };
      expect(runSuite(s)).toHaveLength(6);
      const section = comparisonSection(s, { baseline: s, scenario: 'crash', suite: null, expectations: {} });
      expect(section?.compare?.rows).toHaveLength(4);
      expect(section?.compare?.settings).toEqual([]);
      expect(commitFor(s)?.commitMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('labels completed manual failovers separately from manual action needed', () => {
    const s = snapshot();
    s.doc.topology.config.fsfo.state = 'disabled';
    const target = s.doc.topology.members.find((m) => m.kind === 'database' && m.role === 'physical')!;
    const t = simulate(s.doc.topology, [{ at: 0, kind: 'cmd.failover', to: target.id }]);
    expect(t.facts.newPrimary).not.toBeNull();
    expect(outcomeText(t)).toBe('Manual failover');
  });
});

describe('the comparison in the printable report', () => {
  const none = { baseline: null, scenario: 'crash' as const, suite: null, expectations: {} };

  it('is absent without a baseline or a scenario run', () => {
    expect(comparisonSection(snapshot(), none)).toBeNull();
  });

  it('includes a current scenario run, and leaves out one made against other settings', () => {
    const s = snapshot(); const suite = { snapshot: structuredClone(s), results: runSuite(s) };
    const expectations = { crash: { outcome: 'Failover', maxOpenSeconds: 60 } };
    const fresh = comparisonSection(s, { ...none, suite, expectations });
    expect(fresh?.suite).toHaveLength(6);
    expect(fresh?.suite?.find((r) => r.label === suite.results[0]!.label)?.check).toBe('Met in this model');
    expect(fresh?.suite?.[0]?.expected).toBe('Failover · open by 60 s');
    /* Authored events and canvas moves do not make the run stale. */
    s.doc.topology.events = suite.results[0]!.topology.events;
    s.doc.layout['prm01'] = { dx: 8, dy: 0 };
    expect(comparisonSection(s, { ...none, suite })?.suite).toHaveLength(6);
    s.doc.topology.config.fsfo.thresholdSeconds = 60;
    /* Nothing current to print: no section at all. */
    expect(comparisonSection(s, { ...none, suite })).toBeNull();
    const withBaseline = comparisonSection(s, { ...none, suite, baseline: suite.snapshot });
    expect(withBaseline?.suite).toBeNull();
    expect(withBaseline?.suiteLeftOut).toBe(true);
  });

  it('compares a baseline under one scenario, with the changed settings and commands', () => {
    const a = snapshot(); const b = structuredClone(a);
    b.doc.topology.config.fsfo.thresholdSeconds = 60;
    const c = comparisonSection(b, { ...none, baseline: a })!;
    expect(c.compare?.scenario).toBe(runScenario(a, 'crash').label);
    expect(c.compare?.rows.map((r) => r.k)).toEqual([
      'Outcome', 'New primary opens', 'Modelled data loss', 'Commit latency, steady state',
    ]);
    expect(c.compare?.rows[1]?.baseline).toContain('(model)');
    expect(c.compare?.settings).toEqual([{ path: 'config.fsfo.thresholdSeconds', before: '30', after: '60' }]);
    expect(c.compare?.commands.length).toBeGreaterThan(0);
  });

  it('rides the report model, citing the ObserverOverride assumption it rests on', () => {
    const a = snapshot();
    const c = comparisonSection(a, { ...none, baseline: a });
    const model = buildReport({
      name: 'x', topology: a.doc.topology, findings: [], protectionLevel: null, trace: null,
      runFindings: [], outcome: null, comparison: c,
    });
    expect(model.comparison).toBe(c);
    expect(model.comparisonRefs.length).toBeGreaterThan(0);
    const ids = model.comparisonRefs.map((n) => model.sources[n - 1]?.id);
    expect(ids).toContain('FSFO.OBSERVER_OVERRIDE_FALSE');
    const without = buildReport({
      name: 'x', topology: a.doc.topology, findings: [], protectionLevel: null, trace: null,
      runFindings: [], outcome: null,
    });
    expect(without.comparison).toBeNull();
    expect(without.comparisonRefs).toEqual([]);
  });

  it('writes an empty expectation as a dash', () => {
    expect(expectationText(undefined)).toBe('—');
    expect(expectationText({})).toBe('—');
    expect(expectationText({ maxLossSeconds: 0 })).toBe('loss ≤ 0 s');
  });
});

/* Fact check SIM-06 and SIM-13: the loss column never reads "none" for a loss
   the run knows about, or cannot bound. */
describe('the loss column after the 2026-09-28 fact check', () => {
  it('a manual failover after the primary ran without the standby reads the seconds, and that nothing bounds them', () => {
    const s = snapshot();
    s.doc.topology.config.fsfo.state = 'disabled';
    const topology = s.doc.topology;
    const trace = simulate(topology, [
      { at: 0, kind: 'link.cut', link: 'dc1-dc2' as never },
      { at: 100, kind: 'host.down', host: 'dc1-prm01' as never },
      { at: 120, kind: 'cmd.failover', to: 'sby01' as never },
    ]);
    expect(trace.facts.newPrimary).toBe('sby01');
    expect(lossText(trace)).toBe('70 s of redo never received (model); nothing bounds it');
    expect(lossText(trace)).not.toContain('None');
  });

  it('a far sync instance lost with the primary reads unknown', () => {
    const p = PRESETS.find((x) => x.id === 'far-sync-zero-loss')!;
    const trace = simulate(p.doc(), [{ at: 0, kind: 'site.down', site: 'dc1' as never }]);
    expect(trace.facts.newPrimary).not.toBe(null);
    expect(trace.facts.dataLossKind).toBe('unknown');
    expect(lossText(trace)).toBe('Unknown: not bounded in this model');
  });

  it('never passes a loss expectation on a loss it cannot bound', () => {
    const p = PRESETS.find((x) => x.id === 'far-sync-zero-loss')!;
    const topology = p.doc();
    const trace = simulate(topology, [{ at: 0, kind: 'site.down', site: 'dc1' as never }]);
    const row = {
      id: 'crash' as const, label: 'x', description: 'x', topology, trace, unavailable: null,
    };
    expect(assess(row, { maxLossSeconds: 0 })).toBe('Not assessed: no loss bound');
  });
});
