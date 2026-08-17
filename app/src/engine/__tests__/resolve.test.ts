import { describe, expect, it } from 'vitest';
import { hostId, memberId, siteId, linkId } from '../ids';
import type { MemberId } from '../ids';
import { applyNetEvent, initialNetState } from '../net/graph';
import { parseRedoRoutesOrThrow } from '../redo/parse';
import { resolveRedoGraph } from '../redo/resolve';
import { defaultClient, defaultConfiguration, defaultDestProps, defaultEnvironment } from '../serialize/schema';
import type { DatabaseMember, FarSyncMember, Member, TopologyDoc } from '../types/topology';

/* ---------------- a small builder ---------------- */

const db = (
  id: string, site: string, role: DatabaseMember['role'], routes = '', xpt: DatabaseMember['logXptMode'] = 'ASYNC',
): DatabaseMember => ({
  id: memberId(id), kind: 'database', name: id,
  instances: [{ name: id, host: hostId(`${site}-${id}`) }],
  connectIdentifier: id, enabled: true, dests: {},
  redoRoutes: parseRedoRoutesOrThrow(routes),
  logXptMode: xpt,
  role, flashbackOn: false,
  applyLagSeconds: 0, transportLagSeconds: 0,
  applyRunning: role !== 'primary', realTimeApply: true,
  openMode: role === 'primary' ? 'read-write' : 'mount', staticServices: false,
});

const fs = (id: string, site: string, routes = '', xpt: FarSyncMember['logXptMode'] = 'SYNC'): FarSyncMember => ({
  id: memberId(id), kind: 'farsync', name: id,
  instances: [{ name: id, host: hostId(`${site}-${id}`) }],
  connectIdentifier: id, enabled: true, dests: {},
  redoRoutes: parseRedoRoutesOrThrow(routes),
  logXptMode: xpt,
  transportLagSeconds: 0,
});

function build(members: Member[], sites: string[]): TopologyDoc {
  const hosts = members.map((m) => {
    const host = m.instances[0]!.host as string;
    return { id: hostId(host), name: host, site: siteId(host.split('-')[0]!), listenerPort: 1521 };
  });
  const links = [];
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      links.push({
        id: linkId(`${sites[i]}-${sites[j]}`), scope: 'site' as const,
        ends: [siteId(sites[i]!), siteId(sites[j]!)] as [ReturnType<typeof siteId>, ReturnType<typeof siteId>],
        rttMs: 0, up: true,
      });
    }
  }
  for (const m of members) m.dests = { ...m.dests };
  return {
    app: 'dg-topology', schema: 2,
    sites: sites.map((s) => ({ id: siteId(s), name: s })),
    hosts, links, members, observers: [],
    config: defaultConfiguration('19c'),
    client: defaultClient(), environment: defaultEnvironment(), events: [],
  };
}

const PRM = memberId('prm01');
const SBY = memberId('sby01');
const FS1 = memberId('FS1');

/* ---------------- the far sync worked example ---------------- */

function farSyncDoc(): TopologyDoc {
  const prm = db('prm01', 'dc1', 'primary', '(LOCAL : FS1 SYNC)');
  const sby = db('sby01', 'dc2', 'physical', '(LOCAL : FS2 SYNC)', 'ASYNC');
  const fs1 = fs('FS1', 'dc1', '(prm01 : sby01 ASYNC)');
  const fs2 = fs('FS2', 'dc2', '(sby01 : prm01 ASYNC)');
  prm.dests = { [memberId('sby01')]: defaultDestProps(), [memberId('FS1')]: defaultDestProps() };
  const doc = build([prm, sby, fs1, fs2], ['dc1', 'dc2']);
  doc.config.protectionMode = 'MAXAVAILABILITY';
  return doc;
}

describe('far sync: the worked example from the design', () => {
  const doc = farSyncDoc();
  const g = resolveRedoGraph(doc, { primary: PRM });

  it('the primary ships SYNC to the far sync and the far sync forwards ASYNC', () => {
    const toFs = g.edges.find((e) => e.from === PRM && e.to === FS1);
    expect(toFs).toMatchObject({ xpt: 'SYNC', xptSource: 'rule-attribute', role: 'primary-to-farsync', active: true, up: true });
    const onward = g.edges.find((e) => e.from === FS1 && e.to === SBY);
    expect(onward).toMatchObject({ xpt: 'ASYNC', role: 'farsync-onward', active: true, up: true });
  });

  it('the reverse routes are pre-declared and inactive: nothing rewrites on role change', () => {
    expect(g.edges.some((e) => e.from === SBY)).toBe(false);
    expect(g.edges.some((e) => e.from === memberId('FS2'))).toBe(false);
    /* ... and they are what makes the other direction work at once. */
    const reversed = resolveRedoGraph(doc, { primary: SBY });
    expect(reversed.edges.find((e) => e.from === SBY)?.to).toBe(memberId('FS2'));
    expect(reversed.edges.find((e) => e.from === memberId('FS2'))?.to).toBe(PRM);
  });

  it('the target is fed through the far sync, at depth 2', () => {
    const sby = g.members[memberId('sby01')]!;
    expect(sby.reachableFromPrimary).toBe(true);
    expect(sby.depth).toBe(2);
    expect(sby.feedPath).toEqual([PRM, FS1, SBY]);
    expect(sby.effectiveXpt).toBe('ASYNC');
  });

  it('SYNCHRONIZED across the far sync hop is labelled as this page model', () => {
    const sby = g.members[memberId('sby01')]!;
    expect(sby.synchronized.basis).toBe('model');
    expect(sby.synchronized.note).toMatch(/SYNC\.ACROSS_FARSYNC/);
    expect(sby.synchronized.cite.length).toBeGreaterThan(0);
  });

  it('the far sync model reads the primary leg, not the onward one', () => {
    /* SYNC into the far sync: the target is read as synchronized. */
    expect(g.members[memberId('sby01')]!.synchronized.value).toBe(true);
    /* ASYNC into the far sync: nothing on the far side can be synchronized,
       and the label stays a model either way. */
    const async = farSyncDoc();
    async.members[0]!.redoRoutes = parseRedoRoutesOrThrow('(LOCAL : FS1 ASYNC)');
    const g2 = resolveRedoGraph(async, { primary: PRM });
    expect(g2.members[memberId('sby01')]!.synchronized.value).toBe(false);
    expect(g2.members[memberId('sby01')]!.synchronized.basis).toBe('model');
  });

  it('MaxAvailability holds while the far sync acknowledges', () => {
    expect(g.members[memberId('FS1')]!.countsTowardProtectionAck.value).toBe(true);
    expect(g.protectionLevel.value).toBe('MAXAVAILABILITY');
    expect(g.protectionLevel.basis).toBe('documented');
  });

  it('losing the far sync host drops MaxAvailability to maximum performance', () => {
    const net = applyNetEvent(initialNetState(doc), { kind: 'host.down', host: hostId('dc1-FS1') });
    const g2 = resolveRedoGraph(doc, { primary: PRM, net });
    expect(g2.members[memberId('FS1')]!.reachableFromPrimary).toBe(false);
    expect(g2.members[memberId('sby01')]!.reachableFromPrimary).toBe(false);
    expect(g2.protectionLevel.value).toBe('MAXPERFORMANCE');
    expect(g2.protectionLevel.note).toMatch(/at least one synchronized standby/);
  });
});

/* ---------------- the cascade worked example ---------------- */

describe('cascading: broker Example 4-2 in engine terms', () => {
  const prm = db('prm01', 'dc1', 'primary', '(LOCAL : local_sby SYNC)');
  const local = db('local_sby', 'dc1', 'physical', '(prm01 : remote_sby ASYNC)');
  const remote = db('remote_sby', 'dc3', 'physical');
  const doc = build([prm, local, remote], ['dc1', 'dc2', 'dc3']);
  const g = resolveRedoGraph(doc, { primary: PRM });

  it('the cascader is direct, the terminal standby is at depth 2', () => {
    expect(g.members[memberId('local_sby')]!.depth).toBe(1);
    expect(g.members[memberId('remote_sby')]!.depth).toBe(2);
    expect(g.members[memberId('remote_sby')]!.feedPath).toEqual([PRM, memberId('local_sby'), memberId('remote_sby')]);
    expect(g.edges.find((e) => e.to === memberId('remote_sby'))?.role).toBe('cascade');
  });

  it('a cascaded terminal standby counts towards nothing, and says why', () => {
    const t = g.members[memberId('remote_sby')]!;
    expect(t.synchronized.value).toBe(false);
    expect(t.synchronized.basis).toBe('inferred');
    expect(t.synchronized.note).toMatch(/PROT\.CASCADE_NOT_COUNTED/);
    expect(t.countsTowardProtectionAck.value).toBe(false);
  });

  it('the engine says out loud that no cascade depth limit is documented', () => {
    const f = g.findings.find((x) => x.id === 'ROUTES.CASCADE_DEPTH_UNDOC');
    expect(f?.basis).toBe('model');
    expect(f?.note).toBeTruthy();
  });
});

/* ---------------- rules, defaults, groups, alternates ---------------- */

describe('rule activation and defaults', () => {
  it('a NULL property at a primary is (LOCAL : ALL), and skips snapshot standbys', () => {
    const prm = db('prm01', 'dc1', 'primary');
    const sby = db('sby01', 'dc2', 'physical');
    const snap = db('snap01', 'dc3', 'snapshot');
    const doc = build([prm, sby, snap], ['dc1', 'dc2', 'dc3']);
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.edges.map((e) => e.to)).toEqual([SBY]);
    expect(g.members[memberId('snap01')]!.reachableFromPrimary).toBe(false);
  });

  it('an unspecified transport attribute falls back to the destination LogXptMode', () => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : sby01)');
    const sby = db('sby01', 'dc2', 'physical', '', 'FASTSYNC');
    const doc = build([prm, sby], ['dc1', 'dc2']);
    const e = resolveRedoGraph(doc, { primary: PRM }).edges[0];
    expect(e).toMatchObject({ xpt: 'FASTSYNC', xptSource: 'dest-logxptmode' });
  });

  it('a far sync with a NULL property forwards nothing, and the engine labels that a model', () => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : FS1 SYNC)');
    const fs1 = fs('FS1', 'dc1');
    const sby = db('sby01', 'dc2', 'physical');
    const doc = build([prm, fs1, sby], ['dc1', 'dc2']);
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.edges.some((e) => e.from === FS1)).toBe(false);
    const f = g.findings.find((x) => x.id === 'ROUTES.FARSYNC_NULL_DEFAULT');
    expect(f?.basis).toBe('model');
    expect(f?.note).toMatch(/LOCAL cannot be used at a far sync/);
  });

  it('a standby rule sourced at the primary is active now; its LOCAL rule waits', () => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : sby01 SYNC)');
    const sby = db('sby01', 'dc2', 'physical', '(prm01 : term01 ASYNC)(LOCAL : prm01 SYNC)');
    const term = db('term01', 'dc3', 'physical');
    const doc = build([prm, sby, term], ['dc1', 'dc2', 'dc3']);
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.edges.filter((e) => e.from === SBY).map((e) => e.to)).toEqual([memberId('term01')]);
  });

  it('an ANY source carries a model label, because the docs only define LOCAL and names', () => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : sby01 SYNC)');
    const sby = db('sby01', 'dc2', 'physical', '(ANY : term01 ASYNC)');
    const term = db('term01', 'dc3', 'physical');
    const doc = build([prm, sby, term], ['dc1', 'dc2', 'dc3']);
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.findings.find((f) => f.id === 'ROUTES.ANY_SEMANTICS')?.basis).toBe('model');
  });
});

describe('priority groups and alternates', () => {
  const makeDoc = (routes: string): TopologyDoc => {
    const prm = db('prm01', 'dc1', 'primary', routes);
    const a = db('a', 'dc2', 'physical');
    const b = db('b', 'dc3', 'physical');
    return build([prm, a, b], ['dc1', 'dc2', 'dc3']);
  };

  it('the lowest priority group whose destinations are all up wins', () => {
    const doc = makeDoc('(LOCAL : (a SYNC PRIORITY=1), (b ASYNC PRIORITY=2))');
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.edges.find((e) => e.to === memberId('a'))?.active).toBe(true);
    const lower = g.edges.find((e) => e.to === memberId('b'));
    expect(lower?.active).toBe(false);
    expect(lower?.inactiveReason).toBe('lower-priority-group');
    expect(g.findings.find((f) => f.id === 'ROUTES.PRIORITY_ACTIVATION')?.basis).toBe('model');
  });

  it('with the first group down, the next one takes over', () => {
    const doc = makeDoc('(LOCAL : (a SYNC PRIORITY=1), (b ASYNC PRIORITY=2))');
    const net = applyNetEvent(initialNetState(doc), { kind: 'host.down', host: hostId('dc2-a') });
    const g = resolveRedoGraph(doc, { primary: PRM, net });
    expect(g.edges.find((e) => e.to === memberId('b'))?.active).toBe(true);
    expect(g.members[memberId('b')]!.reachableFromPrimary).toBe(true);
  });

  it('an alternate activates when its destination is unreachable, and says it is a model', () => {
    const doc = makeDoc('(LOCAL : a SYNC ALT=(b ASYNC FALLBACK))');
    const net = applyNetEvent(initialNetState(doc), { kind: 'host.down', host: hostId('dc2-a') });
    const g = resolveRedoGraph(doc, { primary: PRM, net });
    const alt = g.edges.find((e) => e.to === memberId('b'));
    expect(alt).toMatchObject({ active: true, xpt: 'ASYNC' });
    const named = g.edges.find((e) => e.to === memberId('a'));
    expect(named?.inactiveReason).toBe('alternate-standby');
    const f = g.findings.find((x) => x.id === 'ROUTES.ALT_ACTIVATION');
    expect(f?.basis).toBe('model');
    expect(f?.note).toMatch(/protection level is reduced/);
  });

  it('a destination disabled at MaxFailure stops carrying redo', () => {
    const doc = makeDoc('(LOCAL : a SYNC)');
    const g = resolveRedoGraph(doc, {
      primary: PRM,
      disabledDests: new Set([`${PRM}>${memberId('a')}`]),
    });
    const e = g.edges.find((x) => x.to === memberId('a'));
    expect(e?.active).toBe(false);
    expect(e?.inactiveReason).toBe('max-failure-disabled');
    expect(g.members[memberId('a')]!.reachableFromPrimary).toBe(false);
  });
});

describe('protection level', () => {
  const twoStandbys = (mode: 'MAXAVAILABILITY' | 'MAXPROTECTION'): TopologyDoc => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : sby01 SYNC, sby02 ASYNC)');
    const sby1 = db('sby01', 'dc2', 'physical');
    const sby2 = db('sby02', 'dc3', 'physical');
    const doc = build([prm, sby1, sby2], ['dc1', 'dc2', 'dc3']);
    doc.config.protectionMode = mode;
    return doc;
  };

  it('one synchronized acknowledgement is what maximum availability asks for', () => {
    const g = resolveRedoGraph(twoStandbys('MAXAVAILABILITY'), { primary: PRM });
    expect(g.members[memberId('sby01')]!.countsTowardProtectionAck.value).toBe(true);
    expect(g.members[memberId('sby02')]!.countsTowardProtectionAck.value).toBe(false);
    expect(g.protectionLevel.value).toBe('MAXAVAILABILITY');
  });

  it('an ASYNC destination never acknowledges, whatever the mode', () => {
    const g = resolveRedoGraph(twoStandbys('MAXPROTECTION'), { primary: PRM });
    expect(g.members[memberId('sby02')]!.countsTowardProtectionAck.value).toBe(false);
    expect(g.members[memberId('sby02')]!.synchronized.value).toBe(false);
  });

  it('a far sync acknowledgement does not hold maximum protection up', () => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : FS1 SYNC)');
    const fs1 = fs('FS1', 'dc1', '(prm01 : sby01 ASYNC)');
    const sby = db('sby01', 'dc2', 'physical');
    const doc = build([prm, fs1, sby], ['dc1', 'dc2']);
    doc.config.protectionMode = 'MAXPROTECTION';
    const g = resolveRedoGraph(doc, { primary: PRM });
    const ack = g.members[memberId('FS1')]!.countsTowardProtectionAck;
    expect(ack.value).toBe(false);
    expect(ack.basis).toBe('inferred');
    expect(g.protectionLevel.note).toMatch(/shuts the primary database down/);
  });

  it('maximum performance is always itself', () => {
    const doc = twoStandbys('MAXAVAILABILITY');
    doc.config.protectionMode = 'MAXPERFORMANCE';
    expect(resolveRedoGraph(doc, { primary: PRM }).protectionLevel.value).toBe('MAXPERFORMANCE');
  });
});

describe('the lag-limit gate stands in for SYNCHRONIZED where there is no such state', () => {
  const doc = (): TopologyDoc => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : sby01 ASYNC)');
    const sby = db('sby01', 'dc2', 'physical');
    sby.applyLagSeconds = 40;
    sby.transportLagSeconds = 40;
    const d = build([prm, sby], ['dc1', 'dc2']);
    d.config.protectionMode = 'MAXPERFORMANCE';
    d.config.fsfo.lagLimitSeconds = 30;
    return d;
  };

  it('reads the lag against the limit, and says why it is not a SYNCHRONIZED reading', () => {
    const over = resolveRedoGraph(doc(), { primary: PRM }).members[memberId('sby01')]!;
    expect(over.synchronized.value).toBe(false);
    expect(over.synchronized.basis).toBe('inferred');
    expect(over.synchronized.note).toMatch(/no SYNCHRONIZED state to report/);

    const d = doc();
    d.members[1]!.transportLagSeconds = 10;
    (d.members[1] as { applyLagSeconds: number }).applyLagSeconds = 10;
    expect(resolveRedoGraph(d, { primary: PRM }).members[memberId('sby01')]!.synchronized.value).toBe(true);
  });

  it('a 26ai maximum availability with a zero limit keeps the synchronized reading', () => {
    const d = doc();
    d.config.edition = '26ai';
    d.config.protectionMode = 'MAXAVAILABILITY';
    d.config.fsfo.lagLimitSeconds = 0;
    const m = resolveRedoGraph(d, { primary: PRM }).members[memberId('sby01')]!;
    expect(m.synchronized.basis).toBe('documented');
  });
});

describe('SHOW CONFIGURATION WHEN PRIMARY IS', () => {
  it('is the same resolver with a different primary', () => {
    const doc = farSyncDoc();
    const asIs = resolveRedoGraph(doc, { primary: PRM });
    const whatIf = resolveRedoGraph(doc, { primary: SBY });
    expect(asIs.primary).toBe(PRM);
    expect(whatIf.primary).toBe(SBY);
    expect(whatIf.members[memberId('prm01')]!.depth).toBe(2);
    expect(whatIf.members[memberId('prm01')]!.feedPath).toEqual([SBY, memberId('FS2'), PRM] as MemberId[]);
  });
});
