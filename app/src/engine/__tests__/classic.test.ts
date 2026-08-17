import { describe, expect, it } from 'vitest';
import {
  CLASSIC_DEFAULTS, CLASSIC_IDS, classicTopology, effectiveScenario, scenarioEvents,
} from '../compat/classic';
import type { ClassicObserverLoc, ClassicScenario } from '../compat/classic';
import { parseTopologyDoc } from '../serialize/schema';
import { hostId } from '../ids';

const SCENARIOS: ClassicScenario[] = ['crash', 'isolated', 'partition', 'dc2down', 'observer-lost', 'switchover'];
const LOCS: ClassicObserverLoc[] = ['none', 'dc1', 'dc2', 'dc3'];

describe('classicTopology', () => {
  it('builds the published 1+1+1 deployment', () => {
    const doc = classicTopology({});
    expect(doc.sites.map((s) => s.id)).toEqual(['dc1', 'dc2', 'dc3']);
    expect(doc.members.map((m) => m.id)).toEqual([CLASSIC_IDS.primary, CLASSIC_IDS.standby]);
    expect(doc.members.every((m) => m.redoRoutes.length === 0)).toBe(true);
    expect(doc.links.map((l) => l.id)).toEqual(['dc1-dc2', 'dc1-dc3', 'dc2-dc3']);
    expect(doc.config.fsfo.target).toEqual({ kind: 'list', members: [CLASSIC_IDS.standby] });
  });

  it('validates for every scenario and placement', () => {
    for (const scenario of SCENARIOS) {
      for (const observerLoc of LOCS) {
        const r = parseTopologyDoc(JSON.parse(JSON.stringify(classicTopology({ scenario, observerLoc }))));
        expect(r.issues, `${scenario}/${observerLoc}`).toEqual([]);
        expect(r.ok).toBe(true);
      }
    }
  });

  it('gives the observer a host of its own in the chosen site, and none when none is deployed', () => {
    for (const loc of ['dc1', 'dc2', 'dc3'] as const) {
      const doc = classicTopology({ observerLoc: loc });
      const host = doc.hosts.find((h) => h.id === hostId(`${loc}-obs01`));
      expect(host?.site, loc).toBe(loc);
      /* Never on a database server or cluster: the observer host is its own. */
      expect(doc.members.some((m) => m.instances.some((i) => i.host === host?.id))).toBe(false);
      expect(doc.config.fsfo.state).toBe('enabled');
    }
    const none = classicTopology({ observerLoc: 'none' });
    expect(none.observers).toEqual([]);
    /* No observer deployed means fast-start failover was never enabled. */
    expect(none.config.fsfo.state).toBe('disabled');
  });

  it('carries the latency onto every site link', () => {
    expect(classicTopology({ latency: 40 }).links.every((l) => l.rttMs === 40)).toBe(true);
  });

  it('clamps the transport lag to the apply lag', () => {
    const doc = classicTopology({ standbyLag: 3, transportLag: 30 });
    expect(doc.members[1]?.transportLagSeconds).toBe(3);
  });

  it('an observer that was never deployed cannot be lost', () => {
    expect(effectiveScenario('observer-lost', 'none')).toBe('crash');
    expect(effectiveScenario('observer-lost', 'dc3')).toBe('observer-lost');
    expect(effectiveScenario('crash', 'none')).toBe('crash');
  });

  it('the defaults table is the published control state', () => {
    expect(CLASSIC_DEFAULTS).toMatchObject({
      scenario: 'crash', observerLoc: 'dc3', mode: 'maxavail', threshold: 30,
      pingSet: false, pingInterval: 100, pingRetry: 10, standbyLag: 10, lagLimit: 30,
      roleTransition: 15, latency: 0, pmyShutdown: true,
      lagType: 'apply', lagGraceTime: 0, lagPolicy: 'zero', transportLag: 2,
    });
  });
});

describe('scenarioEvents', () => {
  const doc = classicTopology({ observerLoc: 'dc3' });

  it('crash takes the primary host down', () => {
    expect(scenarioEvents('crash', doc)).toEqual([{ at: 0, kind: 'host.down', host: 'dc1-prm01' }]);
  });

  it('isolated cuts every link touching the primary site', () => {
    expect(scenarioEvents('isolated', doc)).toEqual([
      { at: 0, kind: 'link.cut', link: 'dc1-dc2' },
      { at: 0, kind: 'link.cut', link: 'dc1-dc3' },
    ]);
  });

  it('partition cuts only the primary-to-standby link', () => {
    expect(scenarioEvents('partition', doc)).toEqual([{ at: 0, kind: 'link.cut', link: 'dc1-dc2' }]);
  });

  it('dc2down takes the whole standby site', () => {
    expect(scenarioEvents('dc2down', doc)).toEqual([{ at: 0, kind: 'site.down', site: 'dc2' }]);
  });

  it('observer-lost takes the observer host, and does nothing where none is deployed', () => {
    expect(scenarioEvents('observer-lost', doc)).toEqual([{ at: 0, kind: 'host.down', host: 'dc3-obs01' }]);
    expect(scenarioEvents('observer-lost', classicTopology({ observerLoc: 'none' }))).toEqual([]);
  });

  it('switchover is a command to the target, not a failure', () => {
    expect(scenarioEvents('switchover', doc)).toEqual([{ at: 0, kind: 'cmd.switchover', to: 'sby01' }]);
  });

  it('the document carries its own scenario events', () => {
    expect(classicTopology({ scenario: 'dc2down' }).events)
      .toEqual([{ at: 0, kind: 'site.down', site: 'dc2' }]);
  });
});
