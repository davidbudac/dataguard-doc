/**
 * RAC members -- facts.md F1-F4.
 *
 * An instance stops on a host that stays up; a RAC primary stays available
 * while one instance runs; a RAC standby runs apply on one instance and the
 * broker moves it when that instance fails -- to the running
 * PreferredApplyInstance, or else (this engine's reading of "random") the
 * first running instance, after ApplyInstanceTimeout.
 */

import { describe, expect, it } from 'vitest';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import { hostId, memberId, observerId } from '../src/engine/ids';
import type { TimedEvent } from '../src/engine/types/events';
import type { DatabaseMember, Lane, TopologyDoc } from '../src/engine';
import {
  buildTns, claimWellFormed, generateDgmgrl, generateInitOraFiles, generateShowMocks,
  parseTopologyDoc, renderPlain, serviceAddresses, stoppedInstances, validate,
} from '../src/engine';
import { reinstateFindings } from '../src/engine/sim/roles';
import { computeApp } from '../src/engine/models/app';
import { database, dest, host, local, observer, preset, to, topology } from '../src/presets';

const M = memberId;
const down = (at: number, m: string, instance: string): TimedEvent =>
  ({ at, kind: 'instance.down', member: M(m), instance });
const up = (at: number, m: string, instance: string): TimedEvent =>
  ({ at, kind: 'instance.up', member: M(m), instance });

const laneOf = (lanes: readonly Lane[], id: string): Lane =>
  lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)!;

/** A single-instance primary shipping to a three-instance RAC standby. */
function threeNodeStandby(over: Partial<DatabaseMember> = {}): TopologyDoc {
  const prm = database('prm01', ['dc1-prm01'], 'primary', { redoRoutes: [local(to('sby01', 'SYNC'))] });
  const sby = database('sby01', ['dc2-node1', 'dc2-node2', 'dc2-node3'], 'physical', {
    logXptMode: 'SYNC', ...over,
  });
  dest(prm, sby.id);
  return topology({
    name: 'rac3',
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [
      host('dc1-prm01', 'dc1'),
      host('dc2-node1', 'dc2', { cluster: 'rac2' }),
      host('dc2-node2', 'dc2', { cluster: 'rac2' }),
      host('dc2-node3', 'dc2', { cluster: 'rac2' }),
      host('dc3-obs01', 'dc3'),
    ],
    links: [['dc1', 'dc2', 5], ['dc1', 'dc3', 5], ['dc2', 'dc3', 5]],
    members: [prm, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: ['sby01'],
  });
}

describe('an instance stops on a host that stays up', () => {
  const p = preset('rac-primary');

  it('records the instance, not the host, as down', () => {
    const t = simulate(p.doc(), p.events());
    const net = stateAt(t, 1).epoch.net;
    expect(net.downHosts).toEqual([]);
    expect(net.downInstances).toEqual(['prm01/prm011']);
  });

  it('leaves an observer on the same host running', () => {
    const doc = p.doc();
    doc.observers = [{ ...doc.observers[0]!, host: hostId('dc1-node1') }];
    const t = simulate(doc, [down(0, 'prm01', 'prm011')]);
    expect(stateAt(t, 5).observers[observerId('obs01')]).not.toBe('stopped');
  });

  it('does not bring a crashed host back when the instance is started', () => {
    const t = simulate(p.doc(), [
      { at: 0, kind: 'host.down', host: hostId('dc1-node1') },
      up(5, 'prm01', 'prm011'),
    ]);
    expect(stateAt(t, 10).epoch.net.downHosts).toEqual(['dc1-node1']);
  });

  it('the primary says it stays available, and that the drawing starts no clock, as a model', () => {
    /* FC 10-01 SIM-31: the cited sentences say nothing about a clock, so the
       claim is this page's model; it still cites the availability sentence. */
    const t = simulate(p.doc(), p.events());
    const d = t.decisions.find((x) => x.id === 'RAC.PRIMARY_DEGRADED');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.cite).toContain('RAC.PRIMARY_AVAILABLE');
    expect(claimWellFormed(d!.claim)).toBe(true);
  });

  it('a client dialling a stopped instance is refused, not left to time out', () => {
    /* Both instances stopped, so the service goes away and the ladder is
       drawn: the listeners on the two nodes still answer, and refuse. */
    const doc = p.doc();
    const t = simulate(doc, [...p.events(), down(5, 'prm01', 'prm012')]);
    const app = computeApp({ ...doc.client, addresses: serviceAddresses(doc) }, t, doc, { application: doc.applications![0]! });
    expect(app.startAt).toBe(5);
    const kinds = app.addresses.filter((a) => (a.member as string) === 'prm01').map((a) => a.kind);
    expect(kinds).toEqual(['refuse', 'refuse']);
  });
});

describe('the rac-standby preset: the apply instance fails', () => {
  const p = preset('rac-standby');
  const trace = simulate(p.doc(), p.events());

  it('moves apply to the other instance at once and changes nothing else', () => {
    expect(trace.facts.outcome).toBe('continues');
    expect(trace.facts.initiateAt).toBe(null);
    expect(stateAt(trace, 0).applyInstances?.[M('sby01')]).toBe('sby012');
    expect(stateAt(trace, 30).members[M('sby01')]).toBe('mounted-apply');
    expect(stateAt(trace, 30).epoch.protectionLevel.value).toBe('MAXAVAILABILITY');
  });

  it('says so in a decision that cites the apply instance failover', () => {
    const d = trace.decisions.find((x) => x.id === 'RAC.APPLY_INSTANCE_FAILOVER');
    expect(d?.at).toBe(0);
    expect(d?.claim.value).toContain('sby012');
    expect(d?.claim.cite).toEqual(expect.arrayContaining([
      'RAC.APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_FAILOVER', 'RAC.APPLY_INSTANCE_TIMEOUT',
    ]));
    /* Detection is not documented, so the move is the page's model. */
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.note).toMatch(/detect/);
  });

  it('starts on the PreferredApplyInstance with nothing failed', () => {
    const quiet = simulate(p.doc(), []);
    expect(stateAt(quiet, 0).applyInstances?.[M('sby01')]).toBe('sby011');
  });

  it('carries the property into the DGMGRL script', () => {
    const text = generateDgmgrl(p.doc()).lines
      .map((l) => l.spans.map((s) => s.text).join('')).join('\n');
    expect(text).toContain("EDIT DATABASE 'sby01' SET PROPERTY 'PreferredApplyInstance' = 'sby011';");
    expect(text).not.toContain('ApplyInstanceTimeout\' =');
  });
});

describe('apply instance failover on a three-node standby', () => {
  it('waits out ApplyInstanceTimeout with apply stopped, then moves', () => {
    const doc = threeNodeStandby({ applyInstanceTimeoutSeconds: 30 });
    const t = simulate(doc, [down(10, 'sby01', 'sby011')]);
    expect(stateAt(t, 5).members[M('sby01')]).toBe('mounted-apply');
    expect(stateAt(t, 20).members[M('sby01')]).toBe('mounted-noapply');
    expect(stateAt(t, 20).applyInstances?.[M('sby01')]).toBeUndefined();
    expect(stateAt(t, 41).members[M('sby01')]).toBe('mounted-apply');
    expect(stateAt(t, 41).applyInstances?.[M('sby01')]).toBe('sby012');
    expect(t.decisions.find((x) => x.id === 'RAC.APPLY_INSTANCE_FAILOVER')?.at).toBe(40);
    expect(t.decisions.some((x) => x.id === 'RAC.APPLY_INSTANCE_WAIT')).toBe(true);
  });

  it('returns to the running PreferredApplyInstance, and otherwise the first running one', () => {
    const doc = threeNodeStandby({ preferredApplyInstance: 'sby013' });
    const t = simulate(doc, [down(0, 'sby01', 'sby013'), down(10, 'sby01', 'sby011')]);
    expect(stateAt(t, 0).applyInstances?.[M('sby01')]).toBe('sby011');
    expect(stateAt(t, 15).applyInstances?.[M('sby01')]).toBe('sby012');
  });

  it('keeps apply where it is when the preferred instance comes back', () => {
    /* "as long as the apply instance is still running, the broker disregards
       the value of the PreferredApplyInstance property" */
    const doc = threeNodeStandby({ preferredApplyInstance: 'sby013' });
    const t = simulate(doc, [down(0, 'sby01', 'sby013'), up(10, 'sby01', 'sby013')]);
    expect(stateAt(t, 20).applyInstances?.[M('sby01')]).toBe('sby011');
  });

  it('draws one lane segment per apply instance', () => {
    const doc = threeNodeStandby();
    const t = simulate(doc, [down(10, 'sby01', 'sby011'), down(20, 'sby01', 'sby012')]);
    const segs = laneOf(t.lanes, 'sby01').segments;
    expect(segs.map((s) => s.applyInstance)).toEqual(['sby011', 'sby012', 'sby013']);
    expect(segs.every((s) => s.state === 'mounted-apply')).toBe(true);
    const moves = t.decisions.filter((x) => x.id === 'RAC.APPLY_INSTANCE_FAILOVER');
    expect(moves.map((x) => x.at)).toEqual([10, 20]);
  });

  it('is down with every instance gone, and applies again when one starts', () => {
    const doc = threeNodeStandby();
    const t = simulate(doc, [
      down(0, 'sby01', 'sby011'), down(0, 'sby01', 'sby012'), down(0, 'sby01', 'sby013'),
      up(30, 'sby01', 'sby012'),
    ]);
    expect(stateAt(t, 10).members[M('sby01')]).toBe('down');
    expect(stateAt(t, 40).members[M('sby01')]).toBe('mounted-apply');
    expect(stateAt(t, 40).applyInstances?.[M('sby01')]).toBe('sby012');
  });

  it('leaves a single-instance standby and a snapshot standby out of it', () => {
    const doc = threeNodeStandby();
    const sby = doc.members.find((m) => m.id === M('sby01')) as DatabaseMember;
    sby.role = 'snapshot';
    sby.applyRunning = false;
    const t = simulate(doc, [down(0, 'sby01', 'sby011')]);
    expect(stateAt(t, 5).applyInstances).toBeUndefined();
    const plain = simulate(preset('classic').doc(), []);
    expect(stateAt(plain, 0).applyInstances).toBeUndefined();
  });
});

describe('the two properties in a document', () => {
  it('round-trip through the parser, and stay absent at their defaults', () => {
    const doc = threeNodeStandby({ preferredApplyInstance: 'sby012', applyInstanceTimeoutSeconds: 30 });
    const r = parseTopologyDoc(JSON.parse(JSON.stringify(doc)));
    expect(r.ok).toBe(true);
    const sby = r.doc!.members.find((m) => m.id === M('sby01')) as DatabaseMember;
    expect(sby.preferredApplyInstance).toBe('sby012');
    expect(sby.applyInstanceTimeoutSeconds).toBe(30);
    const plain = parseTopologyDoc(JSON.parse(JSON.stringify(threeNodeStandby())));
    const p = plain.doc!.members.find((m) => m.id === M('sby01')) as DatabaseMember;
    expect('preferredApplyInstance' in p).toBe(false);
    expect('applyInstanceTimeoutSeconds' in p).toBe(false);
  });

  it('validates without a finding when the preference names an instance', () => {
    const ids = validate(threeNodeStandby({ preferredApplyInstance: 'sby012' })).map((f) => f.id);
    expect(ids.filter((id) => id.startsWith('RAC.'))).toEqual([]);
  });
});

/* ---------------- role changes, the reinstate precondition, the apply gap ---------------- */

const text = (f: { lines: { spans: { text: string }[] }[] }): string =>
  f.lines.map((l) => l.spans.map((x) => x.text).join('')).join('\n');

describe('a RAC primary that leaves the role', () => {
  it('names the instance its apply will start on after a switchover, from PreferredApplyInstance', () => {
    const doc = preset('rac-standby').doc();
    (doc.members[0] as DatabaseMember).preferredApplyInstance = 'prm012';
    const t = simulate(doc, [{ at: 0, kind: 'cmd.switchover', to: M('sby01') }]);
    const d = t.decisions.find((x) => x.id === 'RAC.APPLY_AFTER_ROLE_CHANGE');
    expect(d?.claim.basis).toBe('documented');
    expect(d?.claim.cite).toContain('RAC.PREFERRED_FOR_SWITCHOVER');
    expect(d?.claim.value).toContain('prm012');
    const after = laneOf(t.lanes, 'prm01').segments.at(-1)!;
    expect(after.applyInstance).toBe('prm012');
    /* The new primary no longer carries an apply instance. */
    expect(stateAt(t, 60).applyInstances?.[M('sby01')]).toBeUndefined();
  });

  it('says it is the page picking when there is no preference', () => {
    const t = simulate(preset('rac-standby').doc(), [{ at: 0, kind: 'cmd.switchover', to: M('sby01') }]);
    const d = t.decisions.find((x) => x.id === 'RAC.APPLY_AFTER_ROLE_CHANGE');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.value).toContain('prm011');
  });
});

describe('static service names are not asked of a RAC database', () => {
  it('stays quiet about static services on a clustered former primary', () => {
    const doc = preset('rac-standby').doc();
    for (const m of doc.members) (m as DatabaseMember).staticServices = false;
    doc.config.fsfo.autoReinstate = true;
    expect(validate(doc).some((f) => f.id === 'REINSTATE.PRECONDITIONS')).toBe(false);
    expect(reinstateFindings(doc, M('prm01'), M('sby01'))).toEqual([]);
  });

  it('still asks it of a single instance', () => {
    const doc = threeNodeStandby();
    for (const m of doc.members) (m as DatabaseMember).staticServices = false;
    doc.config.fsfo.autoReinstate = true;
    const f = validate(doc).find((x) => x.id === 'REINSTATE.PRECONDITIONS');
    expect(f?.message).toContain("'prm01' (no static service name is registered)");
    expect(f?.message).not.toContain("'sby01' (no static");
  });
});

describe('the apply lag grows while no instance applies', () => {
  it('adds the gap to what the target has to apply before it opens', () => {
    const doc = threeNodeStandby({ applyInstanceTimeoutSeconds: 60 });
    const t = simulate(doc, [
      down(0, 'sby01', 'sby011'),
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(t.facts.initiateAt).toBe(30);
    const gap = t.decisions.find((x) => x.id === 'RAC.APPLY_GAP_IN_FAILOVER');
    expect(gap?.claim.basis).toBe('model');
    expect(gap?.claim.value).toContain('30 s');
    /* initiate + the network hop + 30 s of unapplied redo + the role change. */
    expect(t.facts.tOpen).toBeCloseTo(30 + 0.0025 + 30 + 15, 3);
  });

  it('adds nothing once apply has moved', () => {
    const doc = threeNodeStandby();
    const t = simulate(doc, [
      down(0, 'sby01', 'sby011'),
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(t.decisions.some((x) => x.id === 'RAC.APPLY_GAP_IN_FAILOVER')).toBe(false);
    expect(t.facts.tOpen).toBeCloseTo(30 + 0.0025 + 15, 3);
  });
});

describe('moving apply by hand', () => {
  it('moves apply to a running instance', () => {
    const t = simulate(threeNodeStandby(), [
      { at: 5, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'sby013' },
    ]);
    expect(stateAt(t, 1).applyInstances?.[M('sby01')]).toBe('sby011');
    expect(stateAt(t, 10).applyInstances?.[M('sby01')]).toBe('sby013');
    const d = t.decisions.find((x) => x.id === 'RAC.SET_APPLY_INSTANCE');
    expect(d?.taken).toBe(true);
    expect(d?.claim.cite).toContain('RAC.SET_APPLY_INSTANCE');
  });

  it('refuses an instance that is not running, and says so', () => {
    const t = simulate(threeNodeStandby(), [
      down(0, 'sby01', 'sby013'),
      { at: 5, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'sby013' },
    ]);
    expect(stateAt(t, 10).applyInstances?.[M('sby01')]).toBe('sby011');
    expect(t.findings.some((f) => f.id === 'RAC.SET_APPLY_INSTANCE')).toBe(true);
  });

  it('survives the parser', () => {
    const doc = threeNodeStandby();
    doc.events = [{ at: 5, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'sby012' }];
    const r = parseTopologyDoc(JSON.parse(JSON.stringify(doc)));
    expect(r.doc?.events).toEqual(doc.events);
  });
});

describe('multi-instance Redo Apply', () => {
  it('keeps apply on the coordinator when another instance stops, and labels that a model', () => {
    const doc = threeNodeStandby({ applyInstances: 'ALL' });
    const t = simulate(doc, [down(0, 'sby01', 'sby012')]);
    expect(stateAt(t, 5).applyInstances?.[M('sby01')]).toBe('sby011');
    const d = t.decisions.find((x) => x.id === 'RAC.MIRA_PARTICIPANT_LOST');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.note).toMatch(/not documented/);
  });

  it('is written into the DGMGRL script and round-trips', () => {
    const doc = threeNodeStandby({ applyInstances: 'ALL' });
    expect(text(generateDgmgrl(doc))).toContain("EDIT DATABASE 'sby01' SET PROPERTY 'ApplyInstances' = ALL;");
    const r = parseTopologyDoc(JSON.parse(JSON.stringify(doc)));
    expect((r.doc!.members[1] as DatabaseMember).applyInstances).toBe('ALL');
  });
});

describe('what the Configure tab writes for RAC', () => {
  const doc = preset('rac-standby').doc();

  it('SHOW DATABASE marks the apply instance', () => {
    const files = generateShowMocks(doc, { applyInstances: { sby01: 'sby012' } });
    const sby = files.find((f) => f.id === 'show.database.sby01')!;
    const plain = renderPlain(sby);
    expect(plain).toContain('Role:               PHYSICAL STANDBY');
    expect(plain).toMatch(/sby012\s+\(apply instance\)/);
    expect(plain).not.toMatch(/sby011\s+\(apply instance\)/);
    expect(files.some((f) => f.id === 'show.database.prm01')).toBe(true);
    expect(generateShowMocks(preset('classic').doc())).toHaveLength(3);
  });

  it('writes per-instance parameters and standby redo logs for every thread', () => {
    const rac = generateInitOraFiles(doc).find((f) => f.id === 'initora.rac')!;
    const plain = renderPlain(rac);
    expect(plain).toContain('prm011.instance_number=1');
    expect(plain).toContain('prm012.instance_number=2');
    expect(plain).toContain('ALTER DATABASE ADD STANDBY LOGFILE THREAD 2 SIZE 500M;');
    expect(plain).toContain('%t');
    expect(generateInitOraFiles(preset('classic').doc()).some((f) => f.id === 'initora.rac')).toBe(false);
  });

  it('offers the SCAN form of the connect string', () => {
    const plain = renderPlain(buildTns(doc));
    expect(plain).toContain('HOST = rac1-scan');
    expect(plain).toContain('HOST = rac2-scan');
    expect(renderPlain(buildTns(preset('classic').doc()))).not.toContain('-scan');
  });

  it('says a RAC database needs no static service, in the DGMGRL script', () => {
    expect(text(generateDgmgrl(doc))).toContain('prm01 is RAC and runs under Oracle Clusterware, so it needs no static service');
  });
});

/* ---------------- review regressions ---------------- */

describe('the apply instance follows the role in the run, not the declared one', () => {
  it('drops the apply instance of a standby that becomes primary mid-gap', () => {
    const doc = preset('rac-standby').doc();
    (doc.members[1] as DatabaseMember).applyInstanceTimeoutSeconds = 600;
    const t = simulate(doc, [
      down(0, 'sby01', 'sby011'),
      { at: 5, kind: 'host.down', host: hostId('dc1-node1') },
      { at: 5, kind: 'host.down', host: hostId('dc1-node2') },
    ]);
    expect(t.facts.outcome).toBe('failover');
    expect(t.epochs.some((e) => e.cause.kind === 'apply.failover')).toBe(false);
    expect(stateAt(t, 700).applyInstances?.[M('sby01')]).toBeUndefined();
  });

  it('moves where a former primary will apply when that instance stops', () => {
    const t = simulate(preset('rac-standby').doc(), [
      { at: 0, kind: 'cmd.switchover', to: M('sby01') },
      down(200, 'prm01', 'prm011'),
    ]);
    expect(stateAt(t, 100).applyInstances?.[M('prm01')]).toBe('prm011');
    expect(stateAt(t, 250).applyInstances?.[M('prm01')]).toBe('prm012');
  });

  it('names no apply instance on an Active Data Guard standby while the timeout runs', () => {
    const doc = preset('rac-standby').doc();
    const sby = doc.members[1] as DatabaseMember;
    sby.openMode = 'read-only-adg';
    sby.applyInstanceTimeoutSeconds = 30;
    const t = simulate(doc, [down(0, 'sby01', 'sby011')]);
    expect(stateAt(t, 10).members[M('sby01')]).toBe('open-ro');
    expect(stateAt(t, 10).applyInstances?.[M('sby01')]).toBeUndefined();
    expect(stateAt(t, 40).applyInstances?.[M('sby01')]).toBe('sby012');
  });
});

describe('the Configure tab, after review', () => {
  it('counts an instance on a crashed host as not running', () => {
    const doc = preset('rac-standby').doc();
    const t = simulate(doc, [{ at: 0, kind: 'host.down', host: hostId('dc2-node1') }]);
    expect(stoppedInstances(doc, stateAt(t, 1).epoch.net)).toEqual(['sby01/sby011']);
  });

  it('never defines the alias twice, and keeps its tokens in the SCAN form', () => {
    const doc = preset('rac-standby').doc();
    doc.client.retryCount = 3;
    const plain = renderPlain(buildTns(doc));
    const live = plain.split('\n').filter((l) => /^\S+ =$/.test(l));
    expect(live).toHaveLength(1);
    const scan = plain.split('\n').filter((l) => l.includes('-scan'));
    expect(scan.length).toBeGreaterThan(0);
    expect(plain.split('\n').filter((l) => l.includes('RETRY_COUNT'))).toHaveLength(2);
  });

  it('writes ApplyInstances only where it means something, and says what it means', () => {
    const doc = threeNodeStandby({ applyInstances: 'ALL' });
    expect(text(generateDgmgrl(doc))).toContain('one of them the coordinator');
    (doc.members[1] as DatabaseMember).role = 'logical';
    expect(text(generateDgmgrl(doc))).not.toContain("'ApplyInstances'");
  });
});
