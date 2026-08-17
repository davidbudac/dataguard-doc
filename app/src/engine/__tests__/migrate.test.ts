import { describe, expect, it } from 'vitest';
import {
  isLegacyV1, knobsToLegacyQuery, legacyQueryToKnobs, legacyToKnobs, LEGACY_URL_FIELDS,
  migrate, migrateLegacyQuery, migrateV1, parseQuery,
} from '../serialize/migrate';
import { CLASSIC_DEFAULTS, classicTopology } from '../compat/classic';
import { parseTopologyDoc } from '../serialize/schema';
import { hostId, memberId } from '../ids';

/** A configuration exactly as the published simulator writes it. */
const LEGACY = {
  v: 1,
  deployment: {
    name: 'Prague pair', dbPrimary: 'prg01', dbStandby: 'brn01',
    hostPrimary: 'prg-db01', hostStandby: 'brn-db01', hostObserver: 'ost-obs01',
    service: 'sales_svc', port: 1522,
    dc1: 'Prague', dc2: 'Brno', dc3: 'Ostrava',
    subPrimary: 'production', subStandby: 'failover target',
  },
  params: {
    mode: 'maxperf', threshold: 45, pingSet: true, pingInterval: 200, pingRetry: 12,
    lagLimit: 20, pmyShutdown: false, lagType: 'transport', lagGraceTime: 10,
    lagPolicy: 'bounded', logXptMode: 'fastsync', netTimeout: 10,
    reopen: 600, maxFailure: 3, tct: 3, ct: 90, rc: 30, rd: 3,
  },
  sim: {
    scenario: 'partition', observerLoc: 'dc2', standbyLag: 40, transportLag: 5,
    roleTransition: 20, latency: 40, localWrite: 3, sbWrite: 4,
    outage: 900, rate: 12, dead: 'rst',
  },
};

describe('the legacy v1 configuration', () => {
  it('is recognised by its version key alone', () => {
    expect(isLegacyV1(LEGACY)).toBe(true);
    expect(isLegacyV1({ app: 'dg-topology', schema: 2 })).toBe(false);
    expect(isLegacyV1(null)).toBe(false);
  });

  it('migrates to a valid schema-2 document', () => {
    const doc = migrateV1(LEGACY);
    const r = parseTopologyDoc(doc);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(doc.app).toBe('dg-topology');
    expect(doc.schema).toBe(2);
  });

  it('carries the deployment identity across', () => {
    const doc = migrateV1(LEGACY);
    expect(doc.config.name).toBe('Prague pair');
    expect(doc.members.map((m) => m.id)).toEqual([memberId('prg01'), memberId('brn01')]);
    expect(doc.hosts.map((h) => h.id)).toContain(hostId('prg-db01'));
    expect(doc.hosts.find((h) => h.id === hostId('ost-obs01'))?.site).toBe('dc2');
    expect(doc.sites.map((s) => s.name)).toEqual(['Prague', 'Brno', 'Ostrava']);
    expect(doc.client.serviceName).toBe('sales_svc');
    expect(doc.hosts.every((h) => h.listenerPort === 1522)).toBe(true);
  });

  it('carries the broker properties across, and the ping pair only when both are set', () => {
    const doc = migrateV1(LEGACY);
    expect(doc.config.protectionMode).toBe('MAXPERFORMANCE');
    expect(doc.config.fsfo.thresholdSeconds).toBe(45);
    expect(doc.config.fsfo.pingIntervalMs).toBe(200);
    expect(doc.config.fsfo.pingRetry).toBe(12);
    expect(doc.config.fsfo.lagType).toBe('TRANSPORT');
    expect(doc.config.fsfo.pmyShutdown).toBe(false);
    expect(doc.members[0]?.dests[memberId('brn01')]).toMatchObject({
      netTimeoutSeconds: 10, reopenSeconds: 600, maxFailure: 3,
    });

    const unset = migrateV1({ ...LEGACY, params: { ...LEGACY.params, pingSet: false } });
    expect(unset.config.fsfo.pingIntervalMs).toBeNull();
    expect(unset.config.fsfo.pingRetry).toBeNull();
  });

  it('carries the simulated conditions and the client descriptor across', () => {
    const doc = migrateV1(LEGACY);
    const standby = doc.members[1]!;
    expect(standby.kind).toBe('database');
    expect((standby as { applyLagSeconds: number }).applyLagSeconds).toBe(40);
    expect(standby.transportLagSeconds).toBe(5);
    expect(doc.environment.roleTransitionSeconds).toBe(20);
    expect(doc.links.every((l) => l.rttMs === 40)).toBe(true);
    expect(doc.client).toMatchObject({
      transportConnectTimeoutSeconds: 3, connectTimeoutSeconds: 90,
      retryCount: 30, retryDelaySeconds: 3, deadBehaviour: 'rst',
    });
  });

  it('turns the scenario into events', () => {
    const doc = migrateV1(LEGACY);
    expect(doc.events).toEqual([{ at: 0, kind: 'link.cut', link: 'dc1-dc2' }]);
  });

  it('an empty or partial file lands on the defaults, never on a guess', () => {
    const doc = migrateV1({ v: 1 });
    expect(doc.config.fsfo.thresholdSeconds).toBe(30);
    expect(doc.observers[0]?.host).toBe(hostId('dc3-obs01'));   // the third site
    expect(doc.members.map((m) => m.id)).toEqual([memberId('prm01'), memberId('sby01')]);
    expect(migrateV1({ v: 1, params: { mode: 'nonsense' } }).config.protectionMode)
      .toBe('MAXAVAILABILITY');
  });

  it('clamps out-of-range numbers instead of trusting them', () => {
    const k = legacyToKnobs({
      v: 1, params: { threshold: 5000, pingRetry: -3 }, sim: { standbyLag: 1e9 },
    });
    expect(k.threshold).toBe(120);
    expect(k.pingRetry).toBe(10);
    expect(k.standbyLag).toBe(90);
  });

  it('an observer that was never deployed cannot be lost: that pairing is the plain crash', () => {
    const doc = migrateV1({ v: 1, sim: { scenario: 'observer-lost', observerLoc: 'none' } });
    expect(doc.observers).toHaveLength(0);
    expect(doc.config.fsfo.state).toBe('disabled');
    expect(doc.events).toEqual([{ at: 0, kind: 'host.down', host: 'dc1-prm01' }]);
  });

  it('26ai maximum availability reads the zero-loss default unless the file says bounded', () => {
    const zero = migrateV1({ v: 1, params: { mode: 'maxavail', lagLimit: 30 }, sim: {} });
    expect(zero.config.fsfo.lagLimitSeconds).toBe(30);        // 19c: unchanged
    const doc26 = classicTopology({ ...legacyToKnobs({ v: 1, params: { mode: 'maxavail' } }), version: '26ai' });
    expect(doc26.config.fsfo.lagLimitSeconds).toBe(0);
    const bounded = classicTopology({
      ...legacyToKnobs({ v: 1, params: { mode: 'maxavail', lagPolicy: 'bounded', lagLimit: 20 } }),
      version: '26ai',
    });
    expect(bounded.config.fsfo.lagLimitSeconds).toBe(20);
  });
});

describe('the legacy share-link query', () => {
  it('splits a query string without touching a host global', () => {
    expect(parseQuery('?sc=iso&ol=dc2&th=45')).toEqual({ sc: 'iso', ol: 'dc2', th: '45' });
    expect(parseQuery('')).toEqual({});
  });

  it('maps every documented key', () => {
    expect(LEGACY_URL_FIELDS.map((f) => f.k)).toEqual([
      'sc', 'ol', 'pm', 'th', 'ps', 'pi', 'pr', 'lag', 'll', 'rt', 'lat', 'sd',
      'lt', 'tla', 'lgt', 'lp', 'xpt', 'lw', 'sbw', 'rs', 'mf', 'og', 'rr',
      'tct', 'ct', 'rc', 'rd', 'da',
    ]);
  });

  it('reads the tokens the page wrote', () => {
    const k = legacyQueryToKnobs('?sc=iso&ol=dc1&pm=perf&th=45&ps=1&lag=40&da=rst');
    expect(k).toMatchObject({
      scenario: 'isolated', observerLoc: 'dc1', mode: 'maxperf',
      threshold: 45, pingSet: true, standbyLag: 40, dead: 'rst',
    });
  });

  it('ignores garbage rather than guessing at it', () => {
    const k = legacyQueryToKnobs('?sc=nonsense&th=abc&ps=maybe&utm_source=twitter');
    expect(k.scenario).toBe(CLASSIC_DEFAULTS.scenario);
    expect(k.threshold).toBe(CLASSIC_DEFAULTS.threshold);
    expect(k.pingSet).toBe(CLASSIC_DEFAULTS.pingSet);
  });

  it('clamps a re-ranged slider instead of ignoring the link', () => {
    expect(legacyQueryToKnobs('?th=999').threshold).toBe(120);
    expect(legacyQueryToKnobs('?pi=137').pingInterval).toBe(100);   // snapped to the 100 ms grid
  });

  it('applies the observer coercion after the scenario, as the rail does', () => {
    expect(legacyQueryToKnobs('?sc=obs&ol=none').scenario).toBe('crash');
    expect(legacyQueryToKnobs('?sc=obs&ol=dc3').scenario).toBe('observer-lost');
  });

  it('round-trips through the query writer, non-defaults only', () => {
    const q = knobsToLegacyQuery({ scenario: 'isolated', observerLoc: 'dc2', threshold: 45, pingSet: true });
    expect(q).toBe('sc=iso&ol=dc2&th=45&ps=1');
    expect(legacyQueryToKnobs(q)).toMatchObject({
      scenario: 'isolated', observerLoc: 'dc2', threshold: 45, pingSet: true,
    });
    expect(knobsToLegacyQuery({})).toBe('');
  });

  it('builds a document straight from a link', () => {
    const doc = migrateLegacyQuery('?sc=dc2d&ol=dc2');
    expect(doc.events).toEqual([{ at: 0, kind: 'site.down', site: 'dc2' }]);
    expect(doc.observers[0]?.host).toBe(hostId('dc2-obs01'));
  });
});

describe('the migration chain', () => {
  it('takes a schema-2 document as it stands', () => {
    const doc = classicTopology({});
    const r = migrate(JSON.parse(JSON.stringify(doc)) as unknown);
    expect(r.from).toBe('schema-2');
    expect(r.ok).toBe(true);
    expect(r.doc).toEqual(doc);
  });

  it('routes a v1 object through migrateV1 and a string through the query reader', () => {
    expect(migrate(LEGACY).from).toBe('legacy-v1');
    expect(migrate('?sc=iso').from).toBe('legacy-query');
  });

  it('refuses to guess at anything else', () => {
    const r = migrate({ hello: 'world' });
    expect(r.from).toBe('unknown');
    expect(r.ok).toBe(false);
    expect(r.doc).toBeNull();
  });

  it('a migrated document survives a JSON round trip unchanged', () => {
    const doc = migrateV1(LEGACY);
    const again = migrate(JSON.parse(JSON.stringify(doc)) as unknown);
    expect(again.ok).toBe(true);
    expect(again.doc).toEqual(doc);
  });
});
