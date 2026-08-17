import { describe, expect, it } from 'vitest';
import { CLASSIC_IDS, classicTopology, scenarioEvents } from '../compat/classic';
import type { ClassicObserverLoc, ClassicScenario } from '../compat/classic';
import { applyNetEvent, buildReachability, hostUp, initialNetState, memberAlive, membersReachable, netSummary } from '../net/graph';
import type { NetState } from '../net/graph';
import { hostId, siteId } from '../ids';
import type { HostId } from '../ids';
import type { TopologyDoc } from '../types/topology';

function netAfter(doc: TopologyDoc, events = doc.events): NetState {
  let net = initialNetState(doc);
  for (const e of events) {
    switch (e.kind) {
      case 'host.down': case 'host.up': case 'site.down': case 'site.up':
      case 'link.cut': case 'link.heal': case 'partition':
      case 'member.down': case 'member.up':
        net = applyNetEvent(net, e);
        break;
      default:
        break;
    }
  }
  return net;
}

/**
 * The three views the published model hand-wrote as booleans, now read off the
 * graph: does the observer see the primary, does the standby see the primary,
 * does the observer reach the standby.
 */
function views(scenario: ClassicScenario, observerLoc: ClassicObserverLoc): {
  obsSeesPmy: boolean; sbySeesPmy: boolean; obsSeesSby: boolean; sbyAlive: boolean;
} {
  const doc = classicTopology({ scenario, observerLoc });
  const net = netAfter(doc, scenarioEvents(scenario, doc));
  const reach = buildReachability(doc, net);
  const primary = doc.members.find((m) => m.id === CLASSIC_IDS.primary)!;
  const standby = doc.members.find((m) => m.id === CLASSIC_IDS.standby)!;
  const obsHost = doc.observers[0]?.host;
  const obsAlive = obsHost !== undefined && hostUp(doc, net, obsHost);
  const pmyAlive = memberAlive(doc, net, primary);
  const sbyAlive = memberAlive(doc, net, standby);
  const seesFromObserver = (target: typeof primary): boolean =>
    obsAlive && obsHost !== undefined
      && target.instances.some((i) => reach.reachable(obsHost, i.host));
  return {
    obsSeesPmy: pmyAlive && seesFromObserver(primary),
    sbySeesPmy: pmyAlive && sbyAlive && membersReachable(doc, net, primary, standby, reach),
    obsSeesSby: sbyAlive && seesFromObserver(standby),
    sbyAlive,
  };
}

describe('reachability on the classic 1+1+1, all four observer placements', () => {
  it('crash: nobody sees a primary that is gone, and the observer still reaches the standby', () => {
    for (const loc of ['dc1', 'dc2', 'dc3'] as const) {
      const v = views('crash', loc);
      expect(v.obsSeesPmy, loc).toBe(false);
      expect(v.sbySeesPmy, loc).toBe(false);
      expect(v.obsSeesSby, loc).toBe(true);
    }
  });

  it('isolated: only a primary-site observer still answers, and it cannot reach the standby', () => {
    expect(views('isolated', 'dc1')).toMatchObject({ obsSeesPmy: true, sbySeesPmy: false, obsSeesSby: false });
    expect(views('isolated', 'dc2')).toMatchObject({ obsSeesPmy: false, sbySeesPmy: false, obsSeesSby: true });
    expect(views('isolated', 'dc3')).toMatchObject({ obsSeesPmy: false, sbySeesPmy: false, obsSeesSby: true });
  });

  it('partition: a third-site observer arbitrates, a standby-site observer sees a false failure', () => {
    expect(views('partition', 'dc1')).toMatchObject({ obsSeesPmy: true, sbySeesPmy: false, obsSeesSby: false });
    expect(views('partition', 'dc2')).toMatchObject({ obsSeesPmy: false, sbySeesPmy: false, obsSeesSby: true });
    expect(views('partition', 'dc3')).toMatchObject({ obsSeesPmy: true, sbySeesPmy: false, obsSeesSby: true });
  });

  it('dc2down: the standby is gone, and a standby-site observer goes with it', () => {
    for (const loc of ['dc1', 'dc3'] as const) {
      const v = views('dc2down', loc);
      expect(v.sbyAlive, loc).toBe(false);
      expect(v.obsSeesPmy, loc).toBe(true);
      expect(v.obsSeesSby, loc).toBe(false);
    }
    const v2 = views('dc2down', 'dc2');
    expect(v2.sbyAlive).toBe(false);
    expect(v2.obsSeesPmy).toBe(false);   // the observer host went down with the site
    expect(v2.obsSeesSby).toBe(false);
  });

  it('observer-lost: the primary and the standby still see each other', () => {
    for (const loc of ['dc1', 'dc2', 'dc3'] as const) {
      const v = views('observer-lost', loc);
      expect(v.sbySeesPmy, loc).toBe(true);
      expect(v.obsSeesPmy, loc).toBe(false);
      expect(v.obsSeesSby, loc).toBe(false);
    }
  });

  it('with no observer deployed there is no observer host at all', () => {
    const doc = classicTopology({ observerLoc: 'none' });
    expect(doc.observers).toHaveLength(0);
    expect(doc.hosts).toHaveLength(2);
  });
});

describe('graph mechanics', () => {
  const doc = classicTopology({});

  it('a site link joins every host pair across the two sites', () => {
    const net = initialNetState(doc);
    const reach = buildReachability(doc, net);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc2-sby01'))).toBe(true);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc3-obs01'))).toBe(true);
  });

  it('a severed link stays severed even though both ends reach a third site', () => {
    /* Databases and observers are not routers, and a site link is a
       point-to-point circuit: no transit. That is what makes a partition
       arbitrable from the third site. */
    const net = applyNetEvent(initialNetState(doc), { kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 });
    const reach = buildReachability(doc, net);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc2-sby01'))).toBe(false);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc3-obs01'))).toBe(true);
    expect(reach.reachable(hostId('dc2-sby01'), hostId('dc3-obs01'))).toBe(true);
    /* ... and the transitive reading is available for callers that want it. */
    const closure = buildReachability(doc, net, { transit: true });
    expect(closure.reachable(hostId('dc1-prm01'), hostId('dc2-sby01'))).toBe(true);
  });

  it('a down host is unreachable, including from itself', () => {
    const net = applyNetEvent(initialNetState(doc), { kind: 'host.down', host: hostId('dc1-prm01') });
    const reach = buildReachability(doc, net);
    expect(hostUp(doc, net, hostId('dc1-prm01'))).toBe(false);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc1-prm01'))).toBe(false);
    expect(reach.component(hostId('dc1-prm01'))).toBeNull();
  });

  it('a down site takes its hosts with it', () => {
    const net = applyNetEvent(initialNetState(doc), { kind: 'site.down', site: siteId('dc2') });
    expect(hostUp(doc, net, hostId('dc2-sby01'))).toBe(false);
    expect(netSummary(net).downSites).toEqual(['dc2']);
  });

  it('hosts inside one site are mutually reachable without a declared link', () => {
    const two = classicTopology({ observerLoc: 'dc1' });
    const net = initialNetState(two);
    const reach = buildReachability(two, net);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc1-obs01'))).toBe(true);
  });

  it('an explicit partition splits the graph by group membership', () => {
    const groups: HostId[][] = [[hostId('dc1-prm01')], [hostId('dc2-sby01'), hostId('dc3-obs01')]];
    const net = applyNetEvent(initialNetState(doc), { kind: 'partition', groups });
    const reach = buildReachability(doc, net);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc2-sby01'))).toBe(false);
    expect(reach.reachable(hostId('dc1-prm01'), hostId('dc3-obs01'))).toBe(false);
    expect(reach.reachable(hostId('dc2-sby01'), hostId('dc3-obs01'))).toBe(true);
    expect(netSummary(net).partitioned).toBe(true);
  });

  it('applyNetEvent never mutates the state it was handed', () => {
    const before = initialNetState(doc);
    const after = applyNetEvent(before, { kind: 'host.down', host: hostId('dc1-prm01') });
    expect(before.downHosts.size).toBe(0);
    expect(after.downHosts.size).toBe(1);
  });
});
