import { describe, expect, it } from 'vitest';
import {
  defaultDestProps, defaultFsfo, emptyDoc, isTopologyDoc, parseTopologyDoc, parseTopologyDocOrThrow,
} from '../serialize/schema';
import { formatRedoRoutes } from '../redo/parse';
import { resolveRedoGraph } from '../redo/resolve';
import { BOUNDS, BROKER_DEFAULTS, clamp, defaultLagLimit, pingSet, withinBounds } from '../defaults';
import { classicTopology } from '../compat/classic';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('BOUNDS', () => {
  it('mirrors the published control ranges', () => {
    expect(BOUNDS.thresholdSeconds).toMatchObject({ min: 6, max: 120, step: 1, default: 30 });
    expect(BOUNDS.lagLimitSeconds).toMatchObject({ min: 5, max: 90, default: 30 });
    expect(BOUNDS.pingIntervalMs).toMatchObject({ min: 100, max: 5000, step: 100, default: 100 });
    expect(BOUNDS.pingRetry).toMatchObject({ min: 10, max: 50, default: 10 });
    expect(BOUNDS.applyLagSeconds).toMatchObject({ min: 0, max: 90 });
    expect(BOUNDS.roleTransitionSeconds).toMatchObject({ min: 5, max: 60, default: 15 });
    expect(BOUNDS.latencyMs).toMatchObject({ min: 0, max: 100 });
    expect(BOUNDS.netTimeoutSeconds).toMatchObject({ min: 1, max: 120, default: 30 });
    expect(BOUNDS.transportConnectTimeoutSeconds).toMatchObject({ min: 1, max: 60, default: 60 });
    expect(BOUNDS.connectTimeoutSeconds).toMatchObject({ min: 0, max: 120, default: 0 });
    expect(BOUNDS.retryCount).toMatchObject({ min: 0, max: 100, default: 0 });
    expect(BOUNDS.retryDelaySeconds).toMatchObject({ min: 0, max: 30, default: 0 });
  });

  it('floors ReopenSecs at 30 s because the meaning of 0 is not documented', () => {
    expect(BOUNDS.reopenSeconds.min).toBe(30);
    expect(BOUNDS.reopenSeconds.max).toBe(3600);
    expect(BOUNDS.reopenSeconds.default).toBe(300);
  });

  it('keeps MaxFailure 0 available, since 0 is documented as unlimited', () => {
    expect(BOUNDS.maxFailure).toMatchObject({ min: 0, max: 20, default: 0 });
  });

  it('clamps to the range and snaps to the step', () => {
    expect(clamp('thresholdSeconds', 3)).toBe(6);
    expect(clamp('thresholdSeconds', 1000)).toBe(120);
    expect(clamp('pingIntervalMs', 137)).toBe(100);
    expect(clamp('pingIntervalMs', 151)).toBe(200);
    expect(clamp('reopenSeconds', 307)).toBe(300);
    expect(clamp('thresholdSeconds', 'not a number')).toBe(30);
    expect(clamp('thresholdSeconds', undefined, 45)).toBe(45);
    expect(withinBounds('thresholdSeconds', 6)).toBe(true);
    expect(withinBounds('thresholdSeconds', 5)).toBe(false);
  });
});

describe('broker defaults per edition', () => {
  it('19c carries the ping defaults, cited to 21c because 19c does not list them', () => {
    const d = BROKER_DEFAULTS['19c'];
    expect(d.pingIntervalMs.value).toBe(100);
    expect(d.pingRetry.value).toBe(10);
    /* 19c is silent and a later edition states it: that is doc-later, and it
       carries the note explaining where the number comes from. */
    expect(d.pingIntervalMs.basis).toBe('doc-later');
    expect(d.pingIntervalMs.cite).toContain('FSFO.PING_PROPS_21C');
    expect(d.pingIntervalMs.note).toMatch(/does not list ObserverPingInterval/);
    expect(d.observerCount.value).toBe(3);
  });

  it('the fresh-document lag limit is the mode default for the edition', () => {
    expect(defaultFsfo('19c').lagLimitSeconds).toBe(30);
    expect(defaultFsfo('26ai').lagLimitSeconds).toBe(0);
  });

  it('26ai reads the ping defaults as not set, and names the contradiction', () => {
    const d = BROKER_DEFAULTS['26ai'];
    expect(d.pingIntervalMs.value).toBeNull();
    expect(d.pingRetry.value).toBeNull();
    for (const c of [d.pingIntervalMs, d.pingRetry]) {
      expect(c.basis).toBe('conflict');
      expect(c.cite.length).toBeGreaterThanOrEqual(2);
      expect(c.note).toBeTruthy();
    }
    expect(d.pingIntervalMs.note).toMatch(/never write "defaults identical in 26ai" unqualified/);
    expect(d.observerCount.value).toBe(4);
    expect(d.observerCount.basis).toBe('conflict');
  });

  it('the explicitly-set minimums stay 100 ms and 10 in every edition', () => {
    expect(BOUNDS.pingIntervalMs.min).toBe(100);
    expect(BOUNDS.pingRetry.min).toBe(10);
  });

  it('26ai gives maximum availability its own zero-loss lag limit default', () => {
    expect(defaultLagLimit('19c', 'MAXAVAILABILITY')).toBe(30);
    expect(defaultLagLimit('26ai', 'MAXAVAILABILITY')).toBe(0);
    expect(defaultLagLimit('26ai', 'MAXPERFORMANCE')).toBe(30);
  });

  it('the documented quirk needs BOTH ping properties set', () => {
    expect(pingSet(100, 10)).toBe(true);
    expect(pingSet(100, null)).toBe(false);
    expect(pingSet(null, null)).toBe(false);
  });
});

describe('document validation', () => {
  it('accepts a document it built itself', () => {
    const doc = classicTopology({});
    const r = parseTopologyDoc(clone(doc));
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.doc).toEqual(doc);
    expect(isTopologyDoc(clone(doc))).toBe(true);
  });

  it('rejects anything that is not a schema-2 topology document', () => {
    for (const bad of [null, 42, 'text', {}, { app: 'other', schema: 2 }, { app: 'dg-topology', schema: 1 }]) {
      expect(parseTopologyDoc(bad).ok).toBe(false);
    }
    expect(() => parseTopologyDocOrThrow({})).toThrow(/invalid topology document/);
  });

  it('drops unknown keys instead of carrying them through', () => {
    const raw = clone(classicTopology({})) as unknown as Record<string, unknown>;
    raw['somethingNew'] = { from: 'a future version' };
    (raw['config'] as Record<string, unknown>)['unknownProperty'] = 7;
    const r = parseTopologyDoc(raw);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.doc!)).not.toContain('somethingNew');
    expect(Object.keys(r.doc!.config)).not.toContain('unknownProperty');
  });

  it('clamps numerics against the one bounds table and says it did', () => {
    const raw = clone(classicTopology({})) as unknown as Record<string, unknown>;
    (raw['config'] as { fsfo: Record<string, unknown> }).fsfo['thresholdSeconds'] = 5000;
    const r = parseTopologyDoc(raw);
    expect(r.doc!.config.fsfo.thresholdSeconds).toBe(120);
    expect(r.issues.some((i) => i.severity === 'repaired' && i.path.endsWith('thresholdSeconds'))).toBe(true);
  });

  it('clamps the transport lag to the apply lag: applied redo must have arrived', () => {
    const raw = clone(classicTopology({ standbyLag: 10 })) as unknown as { members: Record<string, unknown>[] };
    raw.members[1]!['transportLagSeconds'] = 40;
    const r = parseTopologyDoc(raw);
    expect(r.doc!.members[1]!.transportLagSeconds).toBe(10);
  });

  it('a dangling reference is an error, not a repair', () => {
    const raw = clone(classicTopology({})) as unknown as { hosts: Record<string, unknown>[] };
    raw.hosts[0]!['site'] = 'nowhere';
    const r = parseTopologyDoc(raw);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.severity === 'error' && /does not exist/.test(i.message))).toBe(true);
  });

  it('refuses two primaries', () => {
    const raw = clone(classicTopology({})) as unknown as { members: Record<string, unknown>[] };
    raw.members[1]!['role'] = 'primary';
    expect(parseTopologyDoc(raw).ok).toBe(false);
  });

  it('drops a fast-start failover target that is not a member', () => {
    const raw = clone(classicTopology({})) as unknown as { config: { fsfo: { target: { members: string[] } } } };
    raw.config.fsfo.target.members = ['ghost01'];
    const r = parseTopologyDoc(raw);
    expect(r.ok).toBe(false);
    expect(r.doc!.config.fsfo.target).toEqual({ kind: 'list', members: [] });
  });

  it('models ObserverOverride = FALSE only, and says so when a document claims otherwise', () => {
    const raw = clone(classicTopology({})) as unknown as { config: Record<string, unknown> };
    raw.config['observerOverride'] = true;
    const r = parseTopologyDoc(raw);
    expect(r.doc!.config.observerOverride).toBe(false);
    expect(r.issues.some((i) => /ObserverOverride = FALSE/.test(i.message))).toBe(true);
  });

  it('raises a non-zero lag limit to the documented 5 s minimum, and leaves 0 alone', () => {
    const raw = clone(classicTopology({})) as unknown as { config: { fsfo: Record<string, unknown> } };
    raw.config.fsfo['lagLimitSeconds'] = 2;
    expect(parseTopologyDoc(raw).doc!.config.fsfo.lagLimitSeconds).toBe(5);
    raw.config.fsfo['lagLimitSeconds'] = 0;
    expect(parseTopologyDoc(raw).doc!.config.fsfo.lagLimitSeconds).toBe(0);
  });

  it('drops an event that names something the document does not have', () => {
    const raw = clone(classicTopology({})) as unknown as { events: unknown[] };
    raw.events = [{ at: 0, kind: 'host.down', host: 'ghost' }, { at: 5, kind: 'nonsense' }];
    const r = parseTopologyDoc(raw);
    expect(r.doc!.events).toEqual([]);
    expect(r.issues.filter((i) => i.path.startsWith('events'))).toHaveLength(2);
  });

  it('an empty document is well formed and fast-start failover starts disabled', () => {
    const doc = emptyDoc();
    expect(parseTopologyDoc(clone(doc)).ok).toBe(true);
    expect(doc.config.fsfo.state).toBe('disabled');
    expect(defaultFsfo('26ai').pingIntervalMs).toBeNull();
  });
});

/* ---------------- RedoRoutes saved with PRIORITY on the group ---------------- */

describe('RedoRoutes written before PRIORITY moved onto the destination', () => {
  /* Until 2026-09-28 a document put PRIORITY on the group and drew exactly
     one group at a time. Such a document must still load, and mean what its
     author saw on screen. */
  const withRoutes = (routes: unknown, memberIndex = 0, kind?: 'farsync'): Record<string, unknown> => {
    const raw = clone(classicTopology()) as unknown as Record<string, unknown>;
    const members = raw['members'] as Array<Record<string, unknown>>;
    const m = members[memberIndex] as Record<string, unknown>;
    m['redoRoutes'] = routes;
    if (kind) m['kind'] = kind;
    /* a second standby to route to */
    const sby = clone(members[1]) as Record<string, unknown>;
    sby['id'] = 'sby02';
    sby['name'] = 'sby02';
    members.push(sby);
    return raw;
  };
  const routesOf = (raw: unknown) => {
    const r = parseTopologyDoc(raw);
    expect(r.doc).not.toBeNull();
    return { rules: r.doc!.members[0]!.redoRoutes, issues: r.issues };
  };

  it('"A, else B" -- two groups at PRIORITY 1 and 2 -- becomes one group, (A PRIORITY=1, B PRIORITY=2)', () => {
    const { rules, issues } = routesOf(withRoutes([{
      source: 'LOCAL',
      groups: [
        { priority: 1, explicitGroup: true, dests: [{ target: 'sby01', xpt: 'SYNC' }] },
        { priority: 2, explicitGroup: true, dests: [{ target: 'sby02', xpt: 'ASYNC' }] },
      ],
    }]));
    expect(formatRedoRoutes(rules)).toBe('(LOCAL : (sby01 SYNC PRIORITY=1, sby02 ASYNC PRIORITY=2))');
    const note = issues.find((i) => i.path === 'members[0].redoRoutes[0].groups');
    expect(note?.severity).toBe('repaired');
    expect(note?.message).toMatch(/ships where the old drawing did/);
  });

  it('keeps what the old drawing showed: the PRIORITY=1 destination ships, the other stands by', () => {
    const { rules } = routesOf(withRoutes([{
      source: 'LOCAL',
      groups: [
        { priority: 2, explicitGroup: true, dests: [{ target: 'sby02' }] },
        { priority: 1, explicitGroup: true, dests: [{ target: 'sby01' }] },
      ],
    }]));
    const doc = parseTopologyDoc(withRoutes(rules)).doc!;
    const g = resolveRedoGraph(doc, { primary: doc.members[0]!.id });
    expect(g.edges.filter((e) => e.active).map((e) => e.to as string)).toEqual(['sby01']);
  });

  it('a group of several destinations that shipped together keeps shipping together, as PRIORITY=8', () => {
    const { rules, issues } = routesOf(withRoutes([{
      source: 'LOCAL',
      groups: [
        { priority: 1, explicitGroup: true, dests: [{ target: 'sby01' }] },
        { priority: 2, explicitGroup: true, dests: [{ target: 'sby02' }, { target: 'prm01' }] },
      ],
    }]));
    expect(formatRedoRoutes(rules)).toBe('(LOCAL : (sby01 PRIORITY=1, sby02 PRIORITY=8, prm01 PRIORITY=8))');
    expect(issues.find((i) => i.path.endsWith('.groups'))?.message).toMatch(/ships where the old drawing did/);
  });

  it('says so when the old drawing cannot be said exactly', () => {
    const { issues } = routesOf(withRoutes([{
      source: 'LOCAL',
      groups: [
        { priority: 1, explicitGroup: true, dests: [{ target: 'sby01' }, { target: 'sby02' }] },
        { priority: 2, explicitGroup: true, dests: [{ target: 'prm01' }] },
      ],
    }]));
    expect(issues.find((i) => i.path.endsWith('.groups'))?.message).toMatch(/fewer destinations/);
  });

  it('a group without PRIORITY took the SENDER default; at a far sync that was 1', () => {
    const { rules } = routesOf(withRoutes([{
      source: ['prm01'],
      groups: [
        { explicitGroup: true, dests: [{ target: 'sby01', xpt: 'ASYNC' }] },
        { priority: 2, explicitGroup: true, dests: [{ target: 'sby02', xpt: 'ASYNC' }] },
      ],
    }], 0, 'farsync'));
    expect(formatRedoRoutes(rules)).toBe('(prm01 : (sby01 ASYNC PRIORITY=1, sby02 ASYNC PRIORITY=2))');
  });

  it('ALL is never inside a group and stays a path of its own', () => {
    const { rules } = routesOf(withRoutes([{
      source: 'LOCAL',
      groups: [
        { priority: 1, explicitGroup: true, dests: [{ target: 'sby01' }] },
        { priority: 2, dests: [{ target: 'ALL' }] },
      ],
    }]));
    expect(formatRedoRoutes(rules)).toBe('(LOCAL : (sby01 PRIORITY=1), ALL)');
  });

  it('the new shape loads as it stands, with no migration note, and round-trips', () => {
    const current = [{
      source: 'LOCAL',
      groups: [{ explicitGroup: true, dests: [{ target: 'sby01', priority: 1 }, { target: 'sby02', priority: 2 }] }],
    }];
    const r = parseTopologyDoc(withRoutes(current));
    expect(r.issues.filter((i) => i.path.includes('redoRoutes'))).toEqual([]);
    const again = parseTopologyDoc(clone(r.doc));
    expect(again.doc!.members[0]!.redoRoutes).toEqual(r.doc!.members[0]!.redoRoutes);
    expect(again.issues.filter((i) => i.path.includes('redoRoutes'))).toEqual([]);
  });

  it('a group with no PRIORITY anywhere is the current shape, untouched', () => {
    const { rules, issues } = routesOf(withRoutes([{
      source: 'LOCAL', groups: [{ dests: [{ target: 'sby01' }, { target: 'sby02' }] }],
    }]));
    expect(formatRedoRoutes(rules)).toBe('(LOCAL : sby01, sby02)');
    expect(issues.filter((i) => i.path.includes('redoRoutes'))).toEqual([]);
  });
});

describe('MaxFailure defaults inside a RedoRoutes group', () => {
  it('is 1 for a destination written in a parenthesised group and 0 otherwise', () => {
    expect(defaultDestProps().maxFailure).toBe(0);
    expect(defaultDestProps({ inGroup: true }).maxFailure).toBe(1);
  });
});
