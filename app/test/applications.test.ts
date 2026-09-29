/**
 * A configuration holds any number of applications, each dialling the
 * descriptor it has: its own, else the document's shared one.
 *
 * The engine's half of the feature: the model, the reader (including a
 * document written when there could be only one), the share link, and the
 * simulation's view per application. The drawing, the edits and the timeline
 * are `test/ui/applications-many.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  applicationClient, applicationsOf, buildClientFiles, computeApp, computeApps, findApplication,
  hasOwnClient, parseTopologyDoc, renderPlain, scenarioEvents, simulate, siteId, withApplication,
} from '@/engine';
import type { AppModel, ClassicScenario, EngineTrace, TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import { decodeFragment, encodeDocPlain, toJsonText, parseJsonText } from '@/state/codec';
import { makeDoc } from '@/state/doc';

const classic = (): TopologyDoc => PRESETS.find((p) => p.id === 'classic')!.doc();

/** The classic 1 + 1 + 1 with two applications: `app01` in DC1, `app02` in DC2. */
function two(): TopologyDoc {
  const base = classic();
  return withApplication(base, siteId('dc2'));
}

const view = (doc: TopologyDoc, trace: EngineTrace, id: string): AppModel => {
  const models = computeApps(trace, doc);
  const found = models.find((m) => m.application?.id === id);
  if (found === undefined) throw new Error(`no view for ${id}`);
  return found;
};

describe('the model: any number of applications', () => {
  it('a preset draws one, and a second is added on a host of its own with the next free name', () => {
    const doc = two();
    expect(applicationsOf(doc).map((a) => a.id as string)).toEqual(['app01', 'app02']);
    const [a, b] = applicationsOf(doc);
    expect(a?.host).not.toBe(b?.host);
    expect(doc.hosts.find((h) => h.id === b?.host)?.site).toBe('dc2');
    /* A third: the name is unique, never `app02` again. */
    const three = withApplication(doc, siteId('dc3'));
    expect(applicationsOf(three).map((x) => x.id as string)).toEqual(['app01', 'app02', 'app03']);
    /* A name that is taken is suffixed, not duplicated. */
    const clash = withApplication(three, siteId('dc1'), 'app02');
    expect(new Set(applicationsOf(clash).map((x) => x.id as string)).size).toBe(4);
  });

  it('hands each application the descriptor it dials: its own, else the shared one', () => {
    const doc = two();
    const a = applicationsOf(doc)[0]!;
    const b = applicationsOf(doc)[1]!;
    expect(applicationClient(doc, a)).toBe(doc.client);
    const own = { ...doc.client, serviceName: 'billing_svc', retryCount: 3 };
    const owning: TopologyDoc = {
      ...doc,
      applications: applicationsOf(doc).map((x) => (x.id === b.id ? { ...x, client: own } : x)),
    };
    expect(applicationClient(owning, findApplication(owning, 'app01')!)).toBe(owning.client);
    expect(applicationClient(owning, findApplication(owning, 'app02')!)).toBe(own);
    expect(hasOwnClient(findApplication(owning, 'app02')!)).toBe(true);
    expect(hasOwnClient(findApplication(owning, 'app01')!)).toBe(false);
  });
});

describe('the simulation: one view per application', () => {
  const scenario = (doc: TopologyDoc, s: ClassicScenario): EngineTrace =>
    simulate(doc, scenarioEvents(s, doc));

  it('two vantage hosts, one run, two outcomes: a partition strands only the application behind it', () => {
    const doc = two();
    const trace = scenario(doc, 'partition');
    const models = computeApps(trace, doc);
    expect(models.map((m) => m.application?.id)).toEqual(['app01', 'app02']);
    /* app01 stands beside the primary: nothing moves for it. */
    expect(view(doc, trace, 'app01').noEventKind).toBe('continues');
    /* app02 stands in the standby's data centre, on the far side of the cut. */
    const far = view(doc, trace, 'app02');
    expect(far.noEvent).toBe(false);
    expect(far.spans[0]).toMatchObject({ serving: null, published: 'prm01' });
    expect(far.placed?.site).toBe('dc2');
  });

  it('an application with its own descriptor dials that one, from its own vantage', () => {
    const base = two();
    /* app02 keeps the shared string; app01 takes one that retries and asks for another service. */
    const doc: TopologyDoc = {
      ...base,
      applications: applicationsOf(base).map((a) => (a.id === 'app01'
        ? { ...a, client: { ...base.client, serviceName: 'billing_svc', retryCount: 2, retryDelaySeconds: 5 } }
        : a)),
    };
    const trace = scenario(doc, 'crash');
    const ownView = view(doc, trace, 'app01');
    const sharedView = view(doc, trace, 'app02');
    /* Same crash, two strings: the retrying one has more attempts to make, the shared one one. */
    expect(sharedView.attempts.length).toBe(1);
    expect(ownView.worst).toBeGreaterThan(sharedView.worst);
    expect(ownView.placed?.site).toBe('dc1');
    expect(sharedView.placed?.site).toBe('dc2');
    /* The address list dialled is each descriptor's, not the first application's. */
    expect(ownView.addresses.map((x) => x.host)).toEqual(doc.applications![0]!.client!.addresses.map((x) => x.host));
  });

  it('computeApp asks for an application by name and never assumes the first', () => {
    const doc = two();
    const trace = scenario(doc, 'dc2down');
    const [a, b] = applicationsOf(doc);
    const first = computeApp(doc.client, trace, doc, { application: a! });
    const second = computeApp(doc.client, trace, doc, { application: b! });
    expect(first.application?.id).toBe('app01');
    expect(second.application?.id).toBe('app02');
    /* DC2 is down: app02 goes with its data centre, app01 does not. */
    expect(second.noEventKind).toBe('app-down');
    expect(first.noEventKind).not.toBe('app-down');
    /* And with none named, the descriptor is dialled from outside every site. */
    expect(computeApp(doc.client, trace, doc).application).toBeNull();
  });

  it('a host down is per application: only its own application goes down', () => {
    const doc = two();
    const events = [{ at: 0, kind: 'host.down' as const, host: applicationsOf(doc)[1]!.host }];
    const trace = simulate(doc, events);
    expect(view(doc, trace, 'app02').appDownAt).toBe(0);
    expect(view(doc, trace, 'app01').appDownAt).toBeNull();
  });
});

describe('the reader: a document written when there could be only one', () => {
  const json = (doc: TopologyDoc): Record<string, unknown> => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

  it('turns the single `application` field into a one-element list', () => {
    const doc = classic();
    const raw = json(doc);
    const legacy = (raw['applications'] as unknown[])[0];
    delete raw['applications'];
    raw['application'] = legacy;
    const back = parseTopologyDoc(raw);
    expect(back.ok).toBe(true);
    expect(back.doc?.applications).toEqual(doc.applications);
    expect(back.doc).not.toHaveProperty('application');
    /* Written again, it is the new spelling and the same schema number. */
    const again = JSON.parse(JSON.stringify(back.doc)) as Record<string, unknown>;
    expect(again['applications']).toHaveLength(1);
    expect(again).not.toHaveProperty('application');
    expect(again['schema']).toBe(2);
  });

  it('prefers the list when a file carries both, and drops a duplicate name', () => {
    const doc = two();
    const raw = json(doc);
    raw['application'] = { id: 'old', name: 'old', host: (doc.applications![0]!.host as string) };
    expect(parseTopologyDoc(raw).doc?.applications?.map((a) => a.id as string)).toEqual(['app01', 'app02']);
    (raw['applications'] as { id: string }[])[1]!.id = 'app01';
    const dup = parseTopologyDoc(raw);
    expect(dup.doc?.applications).toHaveLength(1);
    expect(dup.issues.some((i) => i.path === 'applications[1].id' && i.severity === 'repaired')).toBe(true);
  });

  it('keeps an application\'s own descriptor and repairs an address that is not a host', () => {
    const base = two();
    const doc: TopologyDoc = {
      ...base,
      applications: applicationsOf(base).map((a) => (a.id === 'app02'
        ? { ...a, client: { ...base.client, serviceName: 'own_svc', addresses: [...base.client.addresses] } }
        : a)),
    };
    const raw = json(doc);
    (raw['applications'] as { client: { addresses: { host: string; port: number }[] } }[])[1]!
      .client.addresses.push({ host: 'nowhere', port: 1521 });
    const back = parseTopologyDoc(raw);
    expect(back.ok).toBe(true);
    const app02 = findApplication(back.doc!, 'app02')!;
    expect(app02.client?.serviceName).toBe('own_svc');
    expect(app02.client?.addresses).toHaveLength(base.client.addresses.length);
    expect(back.issues.some((i) => i.path === 'applications[1].client.addresses[2].host')).toBe(true);
    expect(findApplication(back.doc!, 'app01')?.client).toBeUndefined();
  });

  it('an old document with no application at all still reads with none', () => {
    const raw = json(classic());
    delete raw['applications'];
    expect(parseTopologyDoc(raw).doc?.applications).toBeUndefined();
  });
});

describe('the share link and the file', () => {
  const withOwn = (): TopologyDoc => {
    const base = two();
    return {
      ...base,
      applications: applicationsOf(base).map((a) => (a.id === 'app02'
        ? { ...a, client: { ...base.client, serviceName: 'own_svc', retryCount: 4, addresses: [base.client.addresses[1]!] } }
        : a)),
    };
  };

  it('round trips two applications, one with a connect string of its own, through the fragment', async () => {
    const topology = withOwn();
    const d = makeDoc(topology);
    const { fragment } = encodeDocPlain(d);
    const back = await decodeFragment(`#${fragment}`);
    expect(back?.doc?.topology.applications).toEqual(topology.applications);
    expect(back?.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('round trips through the file, and the file spells it `applications`', () => {
    const topology = withOwn();
    const text = toJsonText(makeDoc(topology));
    expect(text).toContain('"applications"');
    expect(text).not.toContain('"application":');
    const back = parseJsonText(text);
    expect(back.doc?.topology.applications).toEqual(topology.applications);
  });

  it('reads a share link written with the single field', async () => {
    const topology = classic();
    const wire = JSON.parse(toJsonText(makeDoc(topology))) as Record<string, unknown>;
    wire['application'] = (wire['applications'] as unknown[])[0];
    delete wire['applications'];
    const back = parseJsonText(JSON.stringify(wire));
    expect(back.doc?.topology.applications).toEqual(topology.applications);
  });
});

describe('the generated connect strings', () => {
  it('the shared pair always, and a pair of its own for each application that has one', () => {
    const base = two();
    expect(buildClientFiles(base).map((f) => f.id)).toEqual(['tnsnames', 'jdbc']);
    const doc: TopologyDoc = {
      ...base,
      applications: applicationsOf(base).map((a) => (a.id === 'app02'
        ? { ...a, client: { ...base.client, serviceName: 'own_svc', retryCount: 4 } }
        : a)),
    };
    const files = buildClientFiles(doc);
    expect(files.map((f) => f.id)).toEqual(['tnsnames', 'jdbc', 'tnsnames:app02', 'jdbc:app02']);
    const text = (id: string): string => renderPlain(files.find((f) => f.id === id)!);
    expect(text('tnsnames:app02')).toContain('own_svc');
    expect(text('tnsnames:app02')).toContain('RETRY_COUNT = 4');
    expect(text('tnsnames')).toContain('app_svc');
    expect(text('tnsnames')).not.toContain('RETRY_COUNT = ');
  });
});
