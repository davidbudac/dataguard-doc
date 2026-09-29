/**
 * The application as a card: where it stands decides what its connect string
 * can reach.
 *
 * `legacy-models.test.ts` pins the published numbers, which are dialled from
 * outside every data centre and belong to a document with no application on
 * it. This file pins the other reading -- the same descriptor, dialled from a
 * host in a data centre that can itself be cut off or lost -- on the classic
 * 1 + 1 + 1, one placement at a time. Every value here is this page's model.
 */

import { describe, expect, it } from 'vitest';
import {
  claimWellFormed, computeApp, computeApps, parseTopologyDoc, scenarioEvents, simulate, siteId,
  withApplication,
} from '@/engine';
import type { AppModel, ClassicScenario, EngineTrace, TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';

const classic = (): TopologyDoc => PRESETS.find((p) => p.id === 'classic')!.doc();

/** The classic preset without its application (and the host it stood on). */
function withoutApp(): TopologyDoc {
  const { applications, ...bare } = classic();
  return { ...bare, hosts: bare.hosts.filter((h) => h.id !== applications?.[0]?.host) };
}

/** The classic preset with its application standing in `site`. */
function placed(site: string): TopologyDoc {
  return withApplication(withoutApp(), siteId(site));
}

/**
 * The view of the document's one application, or -- with none -- the shared
 * descriptor dialled from outside every data centre.
 */
function view(doc: TopologyDoc, trace: EngineTrace): AppModel {
  const [only, ...more] = computeApps(trace, doc);
  expect(more).toHaveLength(0);
  return only ?? computeApp(doc.client, trace, doc);
}

function run(site: string | null, scenario: ClassicScenario): { doc: TopologyDoc; app: AppModel } {
  const doc = site === null ? withoutApp() : placed(site);
  const events = scenarioEvents(scenario, doc);
  return { doc, app: view(doc, simulate(doc, events)) };
}

describe('the application in a document', () => {
  it('stands beside the primary in every preset, on a host of its own', () => {
    for (const p of PRESETS) {
      const doc = p.doc();
      expect(doc.applications, p.id).toHaveLength(1);
      const app = doc.applications?.[0];
      const host = doc.hosts.find((h) => h.id === app?.host);
      const primary = doc.members.find((m) => m.kind === 'database' && m.role === 'primary');
      const primaryHost = doc.hosts.find((h) => h.id === primary?.instances[0]?.host);
      expect(host?.site, p.id).toBe(primaryHost?.site);
      expect(doc.members.some((m) => m.instances.some((i) => i.host === app?.host)), p.id).toBe(false);
      expect(doc.observers.some((o) => o.host === app?.host), p.id).toBe(false);
    }
  });

  it('lists the primary and every standby database, and no far sync instance', () => {
    for (const p of PRESETS) {
      const doc = p.doc();
      const listed = new Set(doc.client.addresses.map((a) => a.host as string));
      for (const m of doc.members) {
        const on = m.instances.some((i) => listed.has(i.host as string));
        expect(on, `${p.id}: ${m.id as string}`).toBe(m.kind === 'database');
      }
      /* The primary first: it is the address that answers in the steady state. */
      const primary = doc.members.find((m) => m.kind === 'database' && m.role === 'primary');
      expect(doc.client.addresses[0]?.host, p.id).toBe(primary?.instances[0]?.host);
    }
  });

  it('survives the file round trip, and a document without one stays without', () => {
    const doc = classic();
    const back = parseTopologyDoc(JSON.parse(JSON.stringify(doc)));
    expect(back.ok).toBe(true);
    expect(back.doc?.applications).toEqual(doc.applications);
    const { applications: _none, ...bare } = doc;
    expect(parseTopologyDoc(JSON.parse(JSON.stringify(bare))).doc?.applications).toBeUndefined();
  });

  it('is dropped, and said to be, when its host is not in the document', () => {
    const doc = classic();
    const raw = JSON.parse(JSON.stringify(doc)) as { applications: { host: string }[] };
    raw.applications[0]!.host = 'nowhere';
    const back = parseTopologyDoc(raw);
    expect(back.ok).toBe(true);
    expect(back.doc?.applications).toBeUndefined();
    expect(back.issues.some((i) => i.path === 'applications[0].host' && i.severity === 'repaired')).toBe(true);
  });

  it('is added where asked, and again where asked: each on a host of its own, each with a name of its own', () => {
    const at3 = withApplication(withoutApp(), siteId('dc3'));
    expect(at3.hosts.find((h) => h.id === at3.applications?.[0]?.host)?.site).toBe('dc3');
    const both = withApplication(at3, siteId('dc2'));
    expect(both.applications?.map((a) => a.id as string)).toEqual(['app01', 'app02']);
    expect(both.hosts.find((h) => h.id === both.applications?.[1]?.host)?.site).toBe('dc2');
    expect(new Set(both.applications?.map((a) => a.host as string)).size).toBe(2);
    /* The first is untouched, and neither has a descriptor of its own. */
    expect(both.applications?.[0]).toEqual(at3.applications?.[0]);
    expect(both.applications?.some((a) => a.client !== undefined)).toBe(false);
  });
});

describe('computeApp: dialled from where the application stands', () => {
  it('says where it dials from, as this page\'s model', () => {
    const { app } = run('dc1', 'crash');
    expect(app.placed).toEqual({ host: 'dc1-app01', site: 'dc1' });
    expect(app.claims.vantage.basis).toBe('model');
    expect(app.claims.vantage.value).toContain('dc1-app01');
    expect(claimWellFormed(app.claims.vantage)).toBe(true);
    /* With no application the published vantage stands. */
    const bare = run(null, 'crash').app;
    expect(bare.placed).toBeNull();
    expect(bare.claims.vantage.value).toBe('the application tier sits outside every site');
  });

  it('a crashed primary costs the same from any data centre that is still linked', () => {
    for (const site of ['dc1', 'dc2', 'dc3']) {
      const { app } = run(site, 'crash');
      expect(app.noEvent, site).toBe(false);
      expect(app.attempts.map((a) => a.dials.map((d) => d.kind)), site).toEqual([['timeout', 'establish']]);
      expect(app.tConn, site).toBeCloseTo(60.3, 9);
      /* The same reconnect the published page draws from outside. */
      expect(app.tConn, site).toBeCloseTo(run(null, 'crash').app.tConn ?? NaN, 9);
    }
  });

  it('beside an isolated primary it keeps the service until the self-abort, and then reaches nobody', () => {
    const { app } = run('dc1', 'isolated');
    /* Inside the cut: the primary is STALLED and still publishes. */
    expect(app.spans[0]).toMatchObject({ t0: 0, appUp: true, serving: 'prm01', servingState: 'stalled' });
    /* The stalled primary aborts one threshold later; the new primary opens
       on the far side of a cut the application is inside. */
    expect(app.startAt).toBe(30);
    expect(app.spans.at(-1)).toMatchObject({ serving: null, published: 'sby01' });
    expect(app.tConn).toBeNull();
    expect(app.attempts[0]?.dials.map((d) => d.kind)).toEqual(['refuse', 'timeout']);
    expect(app.gaveUp).toBeCloseTo(90.2, 9);
  });

  it('outside the cut an isolated primary is a black hole, and the failover is reached', () => {
    for (const site of ['dc2', 'dc3']) {
      const { app } = run(site, 'isolated');
      expect(app.startAt, site).toBe(0);
      expect(app.spans[0], site).toMatchObject({ serving: null, published: 'prm01' });
      expect(app.attempts[0]?.dials.map((d) => d.kind), site).toEqual(['timeout', 'establish']);
      expect(app.tConn, site).toBeCloseTo(60.3, 9);
    }
  });

  it('a severed link between the two database sites strands only the application behind it', () => {
    /* The primary carries on: beside it, and at the third site, nothing moves. */
    expect(run('dc1', 'partition').app.noEventKind).toBe('continues');
    expect(run('dc3', 'partition').app.noEventKind).toBe('continues');
    /* In the standby's data centre the primary is on the far side of the cut. */
    const { app } = run('dc2', 'partition');
    expect(app.noEvent).toBe(false);
    expect(app.spans[0]).toMatchObject({ serving: null, published: 'prm01' });
    expect(app.attempts[0]?.dials.map((d) => d.kind)).toEqual(['timeout', 'refuse']);
    expect(app.tConn).toBeNull();
    expect(app.gaveUp).toBeCloseTo(60.2, 9);
  });

  it('goes down with its data centre: nothing is dialled', () => {
    const { app } = run('dc2', 'dc2down');
    expect(app.noEventKind).toBe('app-down');
    expect(app.appDownAt).toBe(0);
    expect(app.attempts).toEqual([]);
    expect(app.spans[0]).toMatchObject({ appUp: false, serving: null, published: 'prm01' });
    /* The same loss, seen from beside the primary, is nothing at all. */
    expect(run('dc1', 'dc2down').app.noEventKind).toBe('continues');
  });

  it('an address behind a severed link gives no answer, whatever the dead-address switch says', () => {
    const doc = placed('dc2');
    doc.client.deadBehaviour = 'rst';
    const events = [
      ...scenarioEvents('partition', doc),
      { at: 0, kind: 'host.down' as const, host: doc.members[0]!.instances[0]!.host },
    ];
    const app = view(doc, simulate(doc, events));
    expect(app.attempts[0]?.dials[0]?.kind).toBe('timeout');
    /* The same dead host, reachable: the operating system refuses at once. */
    const near = placed('dc3');
    near.client.deadBehaviour = 'rst';
    const crash = scenarioEvents('crash', near);
    expect(view(near, simulate(near, crash)).attempts[0]?.dials[0]?.kind).toBe('rst');
  });

  it('carries the steady state for the pre-roll: the declared primary, reached', () => {
    const { app } = run('dc1', 'crash');
    expect(app.steady).toEqual({
      appUp: true, serving: 'prm01', servingState: 'open-rw', published: 'prm01',
    });
  });

  it('decides nothing: the run is the same with and without the application', () => {
    for (const sc of ['crash', 'isolated', 'partition', 'dc2down', 'switchover'] as ClassicScenario[]) {
      const withApp = placed('dc1');
      const bare = withoutApp();
      const a = simulate(withApp, scenarioEvents(sc, withApp)).facts;
      const b = simulate(bare, scenarioEvents(sc, bare)).facts;
      expect([a.outcome, a.newPrimary, a.tOpen, a.abortAt, a.blocked], sc)
        .toEqual([b.outcome, b.newPrimary, b.tOpen, b.abortAt, b.blocked]);
    }
  });
});
