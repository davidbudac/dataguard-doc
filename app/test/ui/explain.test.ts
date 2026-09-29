/**
 * Coverage for "Why this result?" (`ui/break/explain.ts`): every decision and
 * finding id a fact-check-shaped run can produce has to turn into a titled
 * step, or the reader silently loses part of the run's own reasoning.
 *
 * This does not re-run `sim-fact-check.test.ts` -- it builds the same shapes
 * of deployment and the same injected events (the classic six templates, the
 * multi-observer/multi-target/max-protection fixtures, manual commands) and
 * reads `trace.decisions` / `trace.findings` off the result, the way
 * `buildExplanation` does. New ids the engine starts emitting show up here as
 * a step rendered with the bare id for its title -- `buildExplanation` falls
 * back to `decision.id` for an untitled decision -- and the last test in this
 * file names exactly which one.
 */

import { describe, expect, it } from 'vitest';
import {
  classicTopology, CLASSIC_IDS, hostId, scenarioEvents, simulate,
} from '@/engine';
import type { ClassicScenario, EngineTrace, TimedEvent, TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import { buildExplanation } from '@/ui/break/explain';
import {
  maxProtDoc, memberOf, multiObserverDoc, multiTargetDoc,
} from '../topologies';

const PRM = hostId('dc1-prm01');
const SBY = hostId('dc2-sby01');
const DC1_DC2 = CLASSIC_IDS.linkDc1Dc2;
const DC1_DC3 = CLASSIC_IDS.linkDc1Dc3;

const cut = (at: number, link: typeof DC1_DC2): TimedEvent => ({ at, kind: 'link.cut', link });
const heal = (at: number, link: typeof DC1_DC2): TimedEvent => ({ at, kind: 'link.heal', link });
const down = (at: number, host: typeof PRM): TimedEvent => ({ at, kind: 'host.down', host });
const up = (at: number, host: typeof PRM): TimedEvent => ({ at, kind: 'host.up', host });
const classic = (over: Parameters<typeof classicTopology>[0] = {}): TopologyDoc =>
  classicTopology({ observerLoc: 'dc3', ...over });
const withFlashback = (doc: TopologyDoc): TopologyDoc => {
  for (const m of doc.members) {
    if (m.kind === 'database') { m.flashbackOn = true; m.staticServices = true; }
  }
  doc.config.fsfo.autoReinstate = true;
  return doc;
};

const CLASSIC_SCENARIOS: readonly ClassicScenario[] = [
  'crash', 'isolated', 'partition', 'dc2down', 'observer-lost', 'switchover',
];

interface Case { label: string; doc: TopologyDoc; trace: EngineTrace }

/** Every run this file exercises. */
function runs(): Case[] {
  const out: Case[] = [];
  const push = (label: string, doc: TopologyDoc, events: TimedEvent[]): void => {
    out.push({ label, doc, trace: simulate(doc, events) });
  };

  /* The six templates against the classic deployment and every preset that
     has one: fast-start failover, manual-failover and switchover branches. */
  for (const scenario of CLASSIC_SCENARIOS) {
    push(`classic:${scenario}`, classic(), scenarioEvents(scenario, classic()));
  }
  for (const p of PRESETS) {
    const doc = p.doc();
    push(`preset:${p.id}`, doc, p.events());
    for (const scenario of CLASSIC_SCENARIOS) {
      const sEvents = scenarioEvents(scenario, doc);
      if (sEvents.length > 0) push(`preset:${p.id}:${scenario}`, doc, sEvents);
    }
  }

  /* The fact-check shapes a template does not reach on its own. */
  push('sim03:reopens-before-role-change', classic(), [down(0, PRM), up(10, PRM)]);
  push('sim03:former-primary-not-open', classic(), [down(0, PRM), up(100, PRM)]);
  push('sim03:stalled-not-aborted', classic({ pmyShutdown: false }), [
    cut(0, DC1_DC2), cut(0, DC1_DC3), heal(100, DC1_DC2), heal(100, DC1_DC3),
  ]);
  push('sim03:reinstated-automatically', withFlashback(classic()), [down(0, PRM), up(100, PRM)]);
  push('sim04:switchover-target-down', classic({ observerLoc: 'none' }),
    [down(0, SBY), { at: 5, kind: 'cmd.switchover', to: CLASSIC_IDS.standby }]);
  push('sim04:failover-target-down', classic({ observerLoc: 'none' }),
    [down(0, PRM), down(0, SBY), { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }]);
  push('sim07:manual-failover-primary-open', classic(), [{ at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }]);
  push('sim07:manual-failover-primary-open-fsfo-off', classic({ observerLoc: 'none' }),
    [{ at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }]);
  push('sim07:manual-failover-open-then-restarts', classic({ observerLoc: 'none' }),
    [{ at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }, down(60, PRM), up(100, PRM)]);
  push('sim07:manual-failover-immediate-with-fsfo', classic(),
    [down(0, PRM), { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby, immediate: true }]);
  push('sim08:multi-target-not-current', multiTargetDoc(),
    [{ at: 0, kind: 'cmd.switchover', to: memberOf('sby02') }]);
  push('sim10:one-role-change', classic(), [down(0, PRM), up(200, PRM), down(400, SBY)]);
  push('sim11:resync', classic({ pmyShutdown: false }), [cut(0, DC1_DC2), heal(100, DC1_DC2)]);
  push('sim14a:nomination', multiObserverDoc(), [cut(5, DC1_DC3)]);
  push('sim14a:unobserved-no-backup', classic(), [cut(5, DC1_DC3)]);
  push('sim14c:bystanders', multiTargetDoc(), [down(0, PRM)]);
  push('sim14d:mode-after-failover', maxProtDoc(), [down(0, PRM)]);
  push('sim14e:reinstate-no-flashback', classic(),
    [down(0, PRM), up(100, PRM), { at: 110, kind: 'cmd.reinstate', member: CLASSIC_IDS.primary }]);
  push('sim14e:reinstate-nothing-to-reinstate', withFlashback(classic()),
    [{ at: 5, kind: 'cmd.reinstate', member: CLASSIC_IDS.primary }]);
  push('val04:unobserved', classic({ observerLoc: 'none' }), [cut(0, DC1_DC2)]);
  push('ed01:ping-19c', classic({ version: '19c', pingSet: true }), [down(0, PRM)]);

  return out;
}

const ID_LIKE = /^[A-Z][A-Z0-9]*(\.[A-Z][A-Z0-9_]*)+$/;

describe('every decision and finding a fact-check-shaped run can produce has an entry in explain.ts', () => {
  const cases = runs();

  it('collected a broad spread of runs', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it('titles every step -- none renders as a bare engine id', () => {
    const untitled = new Map<string, string[]>();
    for (const { label, doc, trace } of cases) {
      for (const step of buildExplanation(doc, trace)) {
        if (ID_LIKE.test(step.title)) {
          const at = untitled.get(step.title) ?? [];
          at.push(label);
          untitled.set(step.title, at);
        }
      }
    }
    const report = [...untitled.entries()].map(([id, labels]) => `${id} (from ${labels.join(', ')})`);
    expect(report, 'ids with no title in explain.ts').toEqual([]);
  });
});

describe('a manual failover that leaves the old primary open', () => {
  const t = simulate(classic({ observerLoc: 'none' }), [{ at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }]);
  const doc = classic({ observerLoc: 'none' });

  it('is a step of its own, worded as this page\'s reading and citing the operator\'s shutdown', () => {
    const step = buildExplanation({ ...doc, events: [{ at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }] }, t)
      .find((s) => s.title === 'Former primary still open');
    expect(step?.detail).toContain('prm01 was still running and open when the manual failover completed');
    expect(step?.detail).toContain('Two databases are open as the primary');
    expect(step?.claim).toMatchObject({ basis: 'model', cite: ['FAILOVER.PRIMARY_SHUT_DOWN', 'FSFO.MANUAL_FAILOVER_CONDITIONS'] });
    expect(step?.subjects).toEqual(['prm01']);
  });
});
