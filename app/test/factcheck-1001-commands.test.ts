/**
 * Fact check 2026-10-01, the commands Oracle refuses and the SYNC waits:
 * SIM-22 (STOP OBSERVER), SIM-19 (DISABLE FAST_START FAILOVER), SIM-18 (one SYNC
 * destination lost among several), TXT-52 (the MaxProtection commit-hang text),
 * TXT-90 (the abort claim) and TXT-55 (the multi-observer lesson).
 */

import { describe, expect, it } from 'vitest';
import { CLASSIC_IDS, classicTopology } from '../src/engine/compat/classic';
import { hostId, observerId } from '../src/engine/ids';
import type { HostId } from '../src/engine/ids';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import type { EngineTrace } from '../src/engine/sim/simulate';
import { splitBrainOf } from '../src/engine/sim/split-brain';
import type { TimedEvent } from '../src/engine/types/events';
import type { TopologyDoc } from '../src/engine/types/topology';
import { isDatabase } from '../src/engine/types/topology';
import { multiObserver } from '../src/content/lessons/multi-observer';
import { preset } from '../src/presets';

const D12 = CLASSIC_IDS.linkDc1Dc2;
const D13 = CLASSIC_IDS.linkDc1Dc3;

const classic = (pmyShutdown = true): TopologyDoc => classicTopology({ observerLoc: 'dc3', pmyShutdown });

const lane = (t: EngineTrace, id: string): string =>
  (t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [])
    .map((s) => `${s.t0}:${s.state}`).join(' | ');

const decision = (t: EngineTrace, id: string) => t.decisions.find((d) => d.id === id);
const finding = (t: EngineTrace, id: string) => t.findings.find((f) => f.id === id);

const standbyHostsOf = (doc: TopologyDoc): HostId[] =>
  doc.members.filter((m) => isDatabase(m) && m.role !== 'primary').map((m) => m.instances[0]?.host as HostId);

const isolate: TimedEvent[] = [
  { at: 0, kind: 'link.cut', link: D12 },
  { at: 0, kind: 'link.cut', link: D13 },
];

/* "STOP OBSERVER ... The STOP OBSERVER command fails if there are two or more
   registered observers and you attempt to stop only the master." (CMD19,
   B26/stop-observer.html) */
describe('SIM-22: STOP OBSERVER on the master of several is refused', () => {
  const doc = preset('multi-target-three-observers').doc();
  const trace = simulate(doc, [{ at: 0, kind: 'observer.stop', observer: observerId('obs01') }]);

  it('the observer keeps running, nothing is nominated, and the refusal is a documented finding', () => {
    const f = finding(trace, 'OBS.STOP_MASTER_REFUSED');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('OBS.STOP_MASTER_REFUSED');
    const d = decision(trace, 'OBS.STOP_OBSERVER');
    expect(d?.taken).toBe(false);
    expect(d?.claim.basis).toBe('documented');
    expect(decision(trace, 'NOMINATION.NEW_MASTER')).toBeUndefined();
    expect(trace.facts.observers[observerId('obs01')]?.endState).toBe('master');
  });

  it('stopping a backup is accepted', () => {
    const t = simulate(doc, [{ at: 0, kind: 'observer.stop', observer: observerId('obs02') }]);
    expect(finding(t, 'OBS.STOP_MASTER_REFUSED')).toBeUndefined();
    expect(finding(t, 'OBS.STOP_NEEDS_CONNECTION')).toBeUndefined();
    expect(stateAt(t, 5).observers[observerId('obs02')]).toBe('stopped');
  });

  it('a crashed observer host still loses the master and nominates a backup', () => {
    const t = simulate(doc, [{ at: 0, kind: 'host.down', host: hostId('dc4-obs01') }]);
    expect(decision(t, 'NOMINATION.NEW_MASTER')?.taken).toBe(true);
  });

  it('the only observer of a configuration can still be stopped while the databases are connected', () => {
    const t = simulate(classic(), [{ at: 0, kind: 'observer.stop', observer: observerId('obs01') }]);
    expect(finding(t, 'OBS.STOP_MASTER_REFUSED')).toBeUndefined();
    expect(t.facts.outcome).toBe('observer-lost');
  });
});

/* "If fast-start failover is enabled when you issue the STOP OBSERVER command,
   then the primary and standby databases must be connected and communicating
   with each other. Otherwise the following error is returned: ... ORA-16636
   fast-start failover target standby in error state, cannot stop observer"
   (CMD19, B26/stop-observer.html) */
describe('SIM-22: STOP OBSERVER with the primary cut off from its standby is refused (ORA-16636)', () => {
  const stopAfterCut: TimedEvent[] = [
    { at: 0, kind: 'link.cut', link: D12 },
    { at: 5, kind: 'observer.stop', observer: observerId('obs01') },
  ];

  it('is refused while fast-start failover is enabled, and the observer keeps running', () => {
    const t = simulate(classic(false), stopAfterCut);
    const f = finding(t, 'OBS.STOP_NEEDS_CONNECTION');
    expect(f?.ora).toBe('ORA-16636');
    expect(f?.basis).toBe('documented');
    expect(decision(t, 'OBS.STOP_OBSERVER')?.at).toBe(5);
    expect(stateAt(t, 10).observers[observerId('obs01')]).not.toBe('stopped');
  });

  it('is accepted once fast-start failover is disabled', () => {
    const t = simulate(classic(false), [
      { at: 0, kind: 'link.cut', link: D12 },
      { at: 2, kind: 'cmd.disableFsfo', force: true },
      { at: 5, kind: 'observer.stop', observer: observerId('obs01') },
    ]);
    expect(finding(t, 'OBS.STOP_NEEDS_CONNECTION')).toBeUndefined();
    expect(stateAt(t, 10).observers[observerId('obs01')]).toBe('stopped');
  });
});

/* "Disabling fast-start failover without the FORCE option can succeed only if
   the database on which the command is issued has a network connection with
   the primary database and if the primary database and target standby database
   have a network connection." (FSFO19, FSFO26) */
describe('SIM-19: DISABLE FAST_START FAILOVER without FORCE needs the connections', () => {
  it('is refused with the primary isolated: fast-start failover stays enabled and the observer fails over', () => {
    const t = simulate(classic(false), [...isolate, { at: 10, kind: 'cmd.disableFsfo' }]);
    const f = finding(t, 'FSFO.DISABLE_REFUSED');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('FSFO.DISABLE_NEEDS_CONNECTIONS');
    expect(decision(t, 'FSFO.DISABLE_FAST_START_FAILOVER')?.taken).toBe(false);
    expect(t.facts.outcome).toBe('failover');
    expect(t.facts.newPrimary).toBe('sby01');
    expect(lane(t, 'prm01')).toBe('0:stalled');
  });

  it('is refused with the primary down: no database has a connection with it', () => {
    const t = simulate(classic(false), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.disableFsfo' },
    ]);
    expect(finding(t, 'FSFO.DISABLE_REFUSED')?.message).toContain('the primary is down');
    expect(t.facts.outcome).toBe('failover');
  });

  it('succeeds while the primary and the target are connected', () => {
    const t = simulate(classic(false), [
      { at: 10, kind: 'cmd.disableFsfo' },
      { at: 20, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(finding(t, 'FSFO.DISABLE_REFUSED')).toBeUndefined();
    expect(t.facts.outcome).toBe('manual');
    expect(t.facts.newPrimary).toBeNull();
  });
});

/* "Disabling fast-start failover with the FORCE option on a primary database
   that is disconnected from the observer and the target standby database does
   not prevent the observer from initiating a fast-start failover to the target
   standby database." (CMD19; B26/disable-fast_start-failover.html) and "This
   action may result in two databases in the configuration simultaneously
   assuming the primary database role." (FSFO19) */
describe('SIM-19: DISABLE FAST_START FAILOVER FORCE on an isolated primary does not stop the failover', () => {
  const forced: TimedEvent[] = [...isolate, { at: 10, kind: 'cmd.disableFsfo', force: true }];

  it('the primary stops stalling but the observer still fails over: two primaries', () => {
    const t = simulate(classic(false), forced);
    expect(lane(t, 'prm01')).toBe('0:stalled | 10:commit-hang | 30:open-rw');
    expect(t.facts.outcome).toBe('failover');
    expect(t.facts.newPrimary).toBe('sby01');
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(true);
    expect(sb?.windows[0]?.members).toEqual(['sby01', 'prm01']);
  });

  it('labels the documented sentences documented and the primary\'s timing a model', () => {
    const t = simulate(classic(false), forced);
    expect(decision(t, 'FSFO.DISABLE_FAST_START_FAILOVER')?.claim.basis).toBe('documented');
    expect(decision(t, 'FSFO.DISABLE_FORCE_PRIMARY_RUNS')?.claim.basis).toBe('model');
    expect(finding(t, 'FSFO.DISABLE_FORCE_ISOLATED')?.basis).toBe('documented');
    expect(finding(t, 'FSFO.DISABLE_FORCE_TWO_PRIMARIES')?.basis).toBe('model');
  });

  it('with FastStartFailoverPmyShutdown TRUE the disabled primary is not shut down either', () => {
    const t = simulate(classic(true), forced);
    expect(t.facts.abortAt).toBeNull();
    expect(lane(t, 'prm01')).toBe('0:stalled | 10:commit-hang | 30:open-rw');
  });

  it('on a primary that still reaches the target it simply disables fast-start failover', () => {
    const t = simulate(classic(false), [
      { at: 10, kind: 'cmd.disableFsfo', force: true },
      { at: 20, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(finding(t, 'FSFO.DISABLE_FORCE_ISOLATED')).toBeUndefined();
    expect(t.facts.outcome).toBe('manual');
  });
});

/* "The default value is 0, which means that the LGWR will wait up to the number
   of seconds specified by the NET_TIMEOUT attribute of the LOG_ARCHIVE_DEST_n
   parameter for each SYNC standby destination." (refrn DATA_GUARD_SYNC_LATENCY,
   19c and 26ai) */
describe('SIM-18: one SYNC destination silent among several hangs the commit', () => {
  const mp = preset('max-protection').doc();
  const standbyHosts = standbyHostsOf(mp);

  it('maximum protection: the first standby lost hangs the commit for NET_TIMEOUT, then the primary carries on', () => {
    const t = simulate(mp, [{ at: 0, kind: 'host.down', host: standbyHosts[0] as HostId }]);
    expect(lane(t, 'prm01')).toBe('0:commit-hang | 10:open-rw');
    expect(t.facts.outcome).not.toBe('maxprot-shutdown');
  });

  it('maximum availability does the same', () => {
    const ma = { ...mp, config: { ...mp.config, protectionMode: 'MAXAVAILABILITY' as const } };
    const t = simulate(ma, [{ at: 0, kind: 'host.down', host: standbyHosts[0] as HostId }]);
    expect(lane(t, 'prm01')).toBe('0:commit-hang | 10:open-rw');
  });

  it('the second standby lost later is a wait of its own, and in maximum protection it ends in the shutdown', () => {
    const t = simulate(mp, [
      { at: 0, kind: 'host.down', host: standbyHosts[0] as HostId },
      { at: 100, kind: 'host.down', host: standbyHosts[1] as HostId },
    ]);
    expect(lane(t, 'prm01')).toBe('0:commit-hang | 10:open-rw | 100:commit-hang | 110:aborted');
    expect(t.facts.outcome).toBe('maxprot-shutdown');
  });

  it('maximum performance waits for nobody', () => {
    const perf = { ...mp, config: { ...mp.config, protectionMode: 'MAXPERFORMANCE' as const } };
    const t = simulate(perf, [{ at: 0, kind: 'host.down', host: standbyHosts[0] as HostId }]);
    expect(lane(t, 'prm01')).toBe('0:open-rw');
  });
});

/* "To ensure that data loss cannot occur, the primary database will shut down,
   rather than continue processing transactions, if it cannot write its redo
   stream to at least one synchronized standby database." (MEM19) */
describe('TXT-52: the MaxProtection commit-hang text says what ends the hang', () => {
  const t = simulate(preset('max-protection').doc(), preset('max-protection').events());
  const hangs = t.decisions.filter((d) => d.id === 'PROT.COMMIT_HANG');

  it('the first standby lost carries on only because another synchronized standby remains', () => {
    const first = hangs[0];
    expect(String(first?.claim.value)).toContain('carries on');
    expect(String(first?.claim.value)).toContain('another synchronized standby still receives its redo');
    expect(first?.claim.cite).toContain('MAXPROT.AT_LEAST_ONE_BROKER');
  });

  it('the hang that ends in the shutdown does not say the primary carries on', () => {
    const last = hangs[hangs.length - 1];
    expect(hangs.length).toBe(2);
    expect(String(last?.claim.value)).not.toContain('carries on');
    expect(String(last?.claim.value)).toContain('shuts down');
    expect(decision(t, 'PROT.MAXPROT_SHUTDOWN')).toBeDefined();
  });

  it('maximum availability still drops the destination and carries on', () => {
    const mp = preset('max-protection').doc();
    const ma = { ...mp, config: { ...mp.config, protectionMode: 'MAXAVAILABILITY' as const } };
    const sby = standbyHostsOf(mp);
    const r = simulate(ma, [
      { at: 0, kind: 'host.down', host: sby[0] as HostId },
      { at: 100, kind: 'host.down', host: sby[1] as HostId },
    ]);
    for (const d of r.decisions.filter((x) => x.id === 'PROT.COMMIT_HANG')) {
      expect(String(d.claim.value)).toContain('drops the destination and carries on');
    }
  });
});

describe('TXT-90: the abort claim does not call the stall onset documented', () => {
  const t = simulate(classic(true), isolate);
  const d = decision(t, 'PRIMARY.ABORT');

  it('is a model whose note separates the documented rule from the placed onset', () => {
    expect(t.facts.abortAt).toBe(30);
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.note).toContain('PRIMARY.ABORT_TIMING');
    expect(d?.claim.note).toContain('the stalled primary shuts down');
    expect(d?.claim.note).toContain('no NET_TIMEOUT hang first');
  });

  it('no longer says anything about the ping properties and this clock', () => {
    expect(d?.claim.note).not.toContain('ping properties never move');
  });
});

describe('TXT-55: the multi-observer lesson reaches its nomination without STOP OBSERVER', () => {
  const step = multiObserver.steps.find((s) => s.title.startsWith('Nomination has a precondition'));

  it('its step crashes the master observer\'s host and the run still nominates', () => {
    const events = step?.apply?.events ?? [];
    expect(events.some((e) => e.kind === 'observer.stop')).toBe(false);
    const t = simulate(preset('multi-target-three-observers').doc(), events);
    expect(decision(t, 'NOMINATION.NEW_MASTER')?.taken).toBe(true);
    expect(finding(t, 'OBS.STOP_MASTER_REFUSED')).toBeUndefined();
  });
});
