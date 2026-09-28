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
  it('a NULL property at a primary is (LOCAL : ALL), and ALL includes snapshot standbys', () => {
    /* "The ALL keyword is an alias for all possible destinations in the
       configuration", and a snapshot standby "receives and archives redo data
       from a primary database" like a physical or logical one. */
    const prm = db('prm01', 'dc1', 'primary');
    const sby = db('sby01', 'dc2', 'physical');
    const snap = db('snap01', 'dc3', 'snapshot');
    const doc = build([prm, sby, snap], ['dc1', 'dc2', 'dc3']);
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.edges.map((e) => e.to)).toEqual([SBY, memberId('snap01')]);
    expect(g.members[memberId('snap01')]!.reachableFromPrimary).toBe(true);
  });

  it('a primary whose only standby is a snapshot standby still ships to it', () => {
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : ALL)');
    const snap = db('snap01', 'dc2', 'snapshot');
    const g = resolveRedoGraph(build([prm, snap], ['dc1', 'dc2']), { primary: PRM });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ to: memberId('snap01'), active: true, up: true });
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

  it('an ANY source names any database, so the rule is active whoever is primary', () => {
    /* "The ANY keyword is an alias for any database in the configuration." */
    const prm = db('prm01', 'dc1', 'primary', '(LOCAL : sby01 SYNC)');
    const sby = db('sby01', 'dc2', 'physical', '(ANY : term01 ASYNC)');
    const term = db('term01', 'dc3', 'physical');
    const doc = build([prm, sby, term], ['dc1', 'dc2', 'dc3']);
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.edges.filter((e) => e.from === SBY).map((e) => e.to)).toEqual([memberId('term01')]);
    const f = g.findings.find((x) => x.id === 'ROUTES.ANY_SEMANTICS');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('ROUTES.ANY_ALIAS');
    /* ... including when the member holding the rule is the primary itself. */
    const own = resolveRedoGraph(doc, { primary: SBY });
    expect(own.edges.find((e) => e.from === SBY && e.to === memberId('term01'))?.active).toBe(true);
  });
});

describe('priority groups and alternates', () => {
  const makeDoc = (routes: string): TopologyDoc => {
    const prm = db('prm01', 'dc1', 'primary', routes);
    const a = db('a', 'dc2', 'physical');
    const b = db('b', 'dc3', 'physical');
    return build([prm, a, b], ['dc1', 'dc2', 'dc3']);
  };

  it('two unparenthesised destinations are two groups, and both ship', () => {
    const g = resolveRedoGraph(makeDoc('(LOCAL : a SYNC, b ASYNC)'), { primary: PRM });
    expect(g.edges.every((e) => e.active)).toBe(true);
  });

  it('two groups of one are two paths: (a PRIORITY=1), (b PRIORITY=2) ships to both', () => {
    /* "The general rule is that there is one active redo path for each group." */
    const g = resolveRedoGraph(makeDoc('(LOCAL : (a SYNC PRIORITY=1), (b ASYNC PRIORITY=2))'), { primary: PRM });
    expect(g.edges.find((e) => e.to === memberId('a'))?.active).toBe(true);
    expect(g.edges.find((e) => e.to === memberId('b'))?.active).toBe(true);
  });

  it('inside one group the lowest PRIORITY number ships and the other stands by', () => {
    const doc = makeDoc('(LOCAL : (a SYNC PRIORITY=1, b ASYNC PRIORITY=2))');
    const g = resolveRedoGraph(doc, { primary: PRM });
    expect(g.edges.find((e) => e.to === memberId('a'))).toMatchObject({ active: true, priority: 1 });
    const lower = g.edges.find((e) => e.to === memberId('b'));
    expect(lower).toMatchObject({ active: false, priority: 2, inactiveReason: 'group-standby' });
    expect(g.findings.find((f) => f.id === 'ROUTES.GROUP_SELECTION')?.basis).toBe('documented');
    expect(g.findings.find((f) => f.id === 'ROUTES.GROUP_SWITCH_INSTANT')?.basis).toBe('model');
    expect(g.findings.some((f) => f.id === 'ROUTES.PRIORITY_ACTIVATION')).toBe(false);
  });

  it('with the PRIORITY=1 destination down, the PRIORITY=2 one takes over', () => {
    const doc = makeDoc('(LOCAL : (a SYNC PRIORITY=1, b ASYNC PRIORITY=2))');
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

/* ---------------- Oracle's Examples 1-4, as behaviour ---------------- */

describe('the Redo Routing Rules examples', () => {
  /* PRI, SB1 and SB2 are databases, FS1 and FS2 far sync instances. */
  const doc = (priRoutes: string, extra: Member[] = []): TopologyDoc => build([
    db('PRI', 'dc1', 'primary', priRoutes),
    fs('FS1', 'dc1', '(PRI : SB1)'),
    fs('FS2', 'dc1', '(PRI : SB1)'),
    db('SB1', 'dc2', 'physical'),
    ...extra,
  ], ['dc1', 'dc2', 'dc3']);
  const PRI = memberId('PRI');
  const down = (d: TopologyDoc, ...hosts: string[]) =>
    hosts.reduce((n, h) => applyNetEvent(n, { kind: 'host.down', host: hostId(h) }), initialNetState(d));
  const shipsTo = (g: ReturnType<typeof resolveRedoGraph>): string[] =>
    g.edges.filter((e) => e.from === PRI && e.active).map((e) => e.to as string).sort();

  it('Example 1: FS1 while it is available, SB1 while it is not, FS1 again when it is back', () => {
    const d = doc('(local : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ) )');
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI }))).toEqual(['FS1']);
    const g = resolveRedoGraph(d, { primary: PRI, net: down(d, 'dc1-FS1') });
    expect(shipsTo(g)).toEqual(['SB1']);
    /* Back: priority 1 is higher than priority 2, whatever was chosen before. */
    const back = resolveRedoGraph(d, { primary: PRI, ...(g.groupChoice ? { groupChoice: g.groupChoice } : {}) });
    expect(shipsTo(back)).toEqual(['FS1']);
  });

  it('Example 2: equal priorities are sticky -- FS2 keeps the redo after FS1 returns', () => {
    const d = doc('(local : ( FS1 PRIORITY=1, FS2 PRIORITY=1 ) )');
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI }))).toEqual(['FS1']);
    const failed = resolveRedoGraph(d, { primary: PRI, net: down(d, 'dc1-FS1') });
    expect(shipsTo(failed)).toEqual(['FS2']);
    expect(Object.values(failed.groupChoice ?? {})).toEqual([memberId('FS2')]);
    const back = resolveRedoGraph(d, { primary: PRI, groupChoice: failed.groupChoice ?? {} });
    expect(shipsTo(back)).toEqual(['FS2']);
    /* "If FS2 fails, then the primary ships to FS1." */
    const fs2Gone = resolveRedoGraph(d, {
      primary: PRI, net: down(d, 'dc1-FS2'), groupChoice: failed.groupChoice ?? {},
    });
    expect(shipsTo(fs2Gone)).toEqual(['FS1']);
  });

  it('far sync destinations default to PRIORITY=1, so an unannotated pair is a pair of equals', () => {
    const d = doc('(LOCAL : (FS1, FS2))');
    const g = resolveRedoGraph(d, { primary: PRI });
    expect(shipsTo(g)).toEqual(['FS1']);
    expect(g.edges.find((e) => e.to === memberId('FS2'))?.priority).toBe(1);
  });

  it('Example 3: one active path per group, two groups at once', () => {
    const d = doc('(local : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ), ( FS2 PRIORITY=1, SB2 PRIORITY=2 ) )',
      [db('SB2', 'dc3', 'physical')]);
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI }))).toEqual(['FS1', 'FS2']);
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI, net: down(d, 'dc1-FS1') }))).toEqual(['FS2', 'SB1']);
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI, net: down(d, 'dc1-FS2') }))).toEqual(['FS1', 'SB2']);
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI, net: down(d, 'dc1-FS1', 'dc1-FS2') })))
      .toEqual(['SB1', 'SB2']);
  });

  it('Example 4: when PRIORITY=8 is the best on offer, every PRIORITY=8 destination ships', () => {
    const d = doc('(local : ( FS1 PRIORITY=1, SB1 PRIORITY=8, SB2 PRIORITY=8 ) )',
      [db('SB2', 'dc3', 'physical')]);
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI }))).toEqual(['FS1']);
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI, net: down(d, 'dc1-FS1') }))).toEqual(['SB1', 'SB2']);
  });

  it('databases default to PRIORITY=8, so an unannotated group of databases ships to all of them', () => {
    const d = doc('(LOCAL : (SB1, SB2))', [db('SB2', 'dc3', 'physical')]);
    expect(shipsTo(resolveRedoGraph(d, { primary: PRI }))).toEqual(['SB1', 'SB2']);
  });
});

describe('the 12.1 ALT form and FALLBACK', () => {
  const makeDoc = (routes: string): TopologyDoc => build([
    db('prm01', 'dc1', 'primary', routes), db('a', 'dc2', 'physical'), db('b', 'dc3', 'physical'),
  ], ['dc1', 'dc2', 'dc3']);
  const key = `${PRM}>${memberId('a')}`;

  it('with FALLBACK the named destination is resumed once it is available, even from MaxFailure', () => {
    const g = resolveRedoGraph(makeDoc('(LOCAL : a SYNC ALT=(b ASYNC FALLBACK))'), {
      primary: PRM, disabledDests: new Set([key]),
    });
    expect(g.edges.find((e) => e.to === memberId('a'))).toMatchObject({ active: true, up: true });
    expect(g.edges.some((e) => e.to === memberId('b'))).toBe(false);
  });

  it('without FALLBACK a disabled named destination stays out and the alternate carries on', () => {
    const g = resolveRedoGraph(makeDoc('(LOCAL : a SYNC ALT=(b ASYNC))'), {
      primary: PRM, disabledDests: new Set([key]),
    });
    expect(g.edges.find((e) => e.to === memberId('b'))?.active).toBe(true);
    expect(g.edges.find((e) => e.to === memberId('a'))?.inactiveReason).toBe('max-failure-disabled');
  });

  it('latched without FALLBACK: if the alternate then fails, nothing ships to either', () => {
    const doc = makeDoc('(LOCAL : a SYNC ALT=(b ASYNC))');
    const net = applyNetEvent(initialNetState(doc), { kind: 'host.down', host: hostId('dc3-b') });
    const g = resolveRedoGraph(doc, { primary: PRM, net, altLatched: new Set([key]) });
    expect(g.members[memberId('a')]!.reachableFromPrimary).toBe(false);
    expect(g.members[memberId('b')]!.reachableFromPrimary).toBe(false);
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
