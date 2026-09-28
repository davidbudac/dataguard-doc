import { describe, expect, it } from 'vitest';
import { claimWellFormed, classicTopology, hostId, memberId, simulate } from '../src/engine';
import type { TimedEvent } from '../src/engine';
import { PRESETS } from '../src/presets';
import { buildExplanation, eventSubjects } from '../src/ui/break/explain';

const crash: TimedEvent = { at: 0, kind: 'host.down', host: hostId('dc1-prm01') };

describe('run explanation', () => {
  it('follows the recorded crash, decision and opening without losing source labels', () => {
    const doc = { ...classicTopology(), events: [crash] };
    const trace = simulate(doc);
    const steps = buildExplanation(doc, trace);
    expect(steps[0]?.detail).toContain('Crash');
    expect(steps[0]?.subjects).toContain(memberId('prm01'));
    const gate = steps.find((step) => step.title === 'Standby readiness');
    expect(gate?.detail).toBe(trace.decisions.find((d) => d.id === 'FSFO.READINESS_GATE')?.claim.value);
    expect(gate?.claim?.cite.length).toBeGreaterThan(0);
    const opened = steps.find((step) => step.key === 'opened');
    expect(opened?.at).toBe(trace.facts.tOpen);
    expect(opened?.claim?.basis).toBe('model');
    expect(opened?.detail).toContain('depend on the environment');
  });

  it('uses the run finding for the refused readiness check and offers the relevant section', () => {
    const doc = { ...classicTopology({ logXptMode: 'async' }), events: [crash] };
    const trace = simulate(doc);
    const steps = buildExplanation(doc, trace);
    const finding = trace.findings.find((f) => f.id === 'FSFO.READINESS_GATE');
    expect(trace.facts.blocked).toBe(true);
    expect(steps.find((step) => step.title === 'Standby readiness')).toMatchObject({
      detail: finding?.message,
      claim: finding,
      setting: 'Fast-start failover',
    });
    expect(steps.some((step) => step.key === 'opened')).toBe(false);
    expect(steps.at(-1)?.title).toBe('Transition blocked');
  });

  it('highlights the members on both ends of a cut site link', () => {
    const doc = classicTopology();
    const link = doc.links.find((item) => item.scope === 'site');
    expect(link).toBeDefined();
    const subjects = eventSubjects(doc, { at: 0, kind: 'link.cut', link: link!.id });
    expect(subjects).toContain(link!.id);
    expect(subjects).toContain(memberId('prm01'));
    expect(subjects).toContain(memberId('sby01'));
  });

  it('states the documented default rule when the trace records no initiation', () => {
    const base = classicTopology();
    const link = base.links.find((item) => item.scope === 'site' && item.ends.some((end) => end === 'dc2'))!;
    const doc = { ...base, events: [{ at: 0, kind: 'link.cut' as const, link: link.id }] };
    const trace = simulate(doc);
    expect(trace.facts.outcome).toBe('continues');
    const step = buildExplanation(doc, trace).find((item) => item.key === 'no-initiation');
    expect(step?.claim?.basis).toBe('model');
    expect(step?.claim?.cite).toContain('FSFO.OBSERVER_OVERRIDE_FALSE');
  });

  it('keeps every preset trace chronological and preserves claim provenance', () => {
    let multipleEvents = 0;
    for (const preset of PRESETS) {
      const doc = preset.doc();
      if (doc.events.length === 0) continue;
      if (doc.events.length > 1) multipleEvents++;
      const trace = simulate(doc);
      const steps = buildExplanation(doc, trace);
      expect(steps.filter((s) => s.title === 'Injected event'), preset.id).toHaveLength(doc.events.length);
      expect(steps.at(-1)?.key, preset.id).toBe('result');
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i]!.at, preset.id).toBeGreaterThanOrEqual(steps[i - 1]!.at);
      }
      for (const step of steps) {
        if (step.claim) expect(claimWellFormed(step.claim), `${preset.id}: ${step.key}`).toBe(true);
      }
      if (trace.facts.blocked) expect(steps.some((s) => s.key === 'opened'), preset.id).toBe(false);
      if (trace.facts.newPrimary && !trace.facts.blocked) {
        expect(steps.find((s) => s.key === 'opened')?.at, preset.id).toBe(trace.facts.tOpen);
      }
    }
    expect(multipleEvents).toBeGreaterThan(0);
  });

  it('distinguishes a completed manual command from a primary awaiting manual action', () => {
    const base = classicTopology();
    const doc = {
      ...base,
      config: { ...base.config, fsfo: { ...base.config.fsfo, state: 'disabled' as const } },
      events: [crash, { at: 1, kind: 'cmd.failover' as const, to: memberId('sby01') }],
    };
    const trace = simulate(doc);
    expect(trace.facts.outcome).toBe('manual');
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
    expect(buildExplanation(doc, trace).at(-1)?.detail).toBe('The manual failover changed the primary.');
  });
});
