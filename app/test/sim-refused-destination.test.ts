/**
 * A synchronous standby that is shut down -- SHUTDOWN ABORT, an instance
 * crash -- while its host keeps running refuses the redo transport
 * connection: the primary gets an error at once and drops the destination.
 * NET_TIMEOUT bounds a wait for a reply that never comes, so only a host,
 * site or network failure makes the commit hang for it.
 *
 * `destRefusedClaim` in sim/protection.ts says why this is `inferred`.
 */

import { describe, expect, it } from 'vitest';
import { CLASSIC_IDS, classicTopology } from '../src/engine/compat/classic';
import { hostId, memberId } from '../src/engine/ids';
import { simulate } from '../src/engine/sim/simulate';
import type { EngineTrace } from '../src/engine/sim/simulate';
import type { TimedEvent } from '../src/engine/types/events';
import type { TopologyDoc } from '../src/engine/types/topology';
import { build, db, dest, maxProtDoc, observer } from './topologies';

const sby01 = memberId('sby01');
const SBY_HOST = hostId('dc2-sby01');

const classic = (): TopologyDoc => classicTopology({ observerLoc: 'dc3' });
const abortSby = (at: number): TimedEvent => ({ at, kind: 'member.down', member: sby01 });

const segments = (t: EngineTrace, id: string) =>
  t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [];
const states = (t: EngineTrace, id: string): string[] => segments(t, id).map((s) => s.state as string);
const hang = (t: EngineTrace) => segments(t, 'prm01').find((s) => s.state === 'commit-hang');
const decision = (t: EngineTrace, id: string) => t.decisions.find((d) => d.id === id);

describe('a standby shut down while its host runs: no NET_TIMEOUT commit hang', () => {
  it('maximum availability, SHUTDOWN ABORT of the only standby: the primary carries on at once', () => {
    const t = simulate(classic(), [abortSby(10)]);
    expect(states(t, 'prm01')).not.toContain('commit-hang');
    expect(decision(t, 'PROT.COMMIT_HANG')).toBeUndefined();
    const d = decision(t, 'PROT.DEST_REFUSED');
    expect(d?.at).toBe(10);
    expect(d?.claim.basis).toBe('inferred');
    expect(d?.claim.cite).toContain('DEST.NET_TIMEOUT');
    expect(d?.claim.value).toContain('without waiting out NET_TIMEOUT');
    expect(decision(t, 'PROT.MAXAVAIL_DEGRADED')?.at).toBe(10);
    expect(t.facts.ackWaitSeconds).toBe(0);
  });

  it('the standby is recorded not ready at the shutdown, not one NET_TIMEOUT later', () => {
    const t = simulate(classic(), [abortSby(10)]);
    expect(t.decisions.find((d) => d.id === 'FSFO.NOT_READY')?.at).toBe(10);
  });

  it('SHUTDOWN ABORT of the single instance is the same as of the database', () => {
    const t = simulate(classic(), [{ at: 10, kind: 'instance.down', member: sby01, instance: 'sby01' }]);
    expect(states(t, 'prm01')).not.toContain('commit-hang');
    expect(decision(t, 'PROT.DEST_REFUSED')?.at).toBe(10);
  });

  it('a RAC standby: one instance down loses nothing, the last one down is refused', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary');
    const sby = db('sby01', ['dc2-sby1', 'dc2-sby2'], 'physical');
    dest(prm, sby.id);
    const doc = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby1', 'dc2', 'rac2'], ['dc2-sby2', 'dc2', 'rac2'], ['dc3-obs01', 'dc3']],
      members: [prm, sby],
      observers: [observer('obs01', 'dc3-obs01')],
      targets: [sby.id],
    });
    const t = simulate(doc, [
      { at: 10, kind: 'instance.down', member: sby01, instance: 'sby011' },
      { at: 20, kind: 'instance.down', member: sby01, instance: 'sby012' },
    ]);
    expect(states(t, 'prm01')).not.toContain('commit-hang');
    expect(decision(t, 'PROT.DEST_REFUSED')?.at).toBe(20);
  });

  it('maximum protection, the only standby shut down: the primary shuts down at the refusal', () => {
    const t = simulate(maxProtDoc(), [abortSby(10)]);
    expect(t.facts.abortAt).toBe(10);
    expect(t.facts.abortReason).toBe('maxprotection');
    expect(states(t, 'prm01')).not.toContain('commit-hang');
    expect(decision(t, 'PROT.DEST_REFUSED')?.claim.value).toContain('the primary shuts down');
  });
});

describe('a standby nothing answers for: the commit still hangs for NET_TIMEOUT', () => {
  it('its host down', () => {
    const t = simulate(classic(), [{ at: 10, kind: 'host.down', host: SBY_HOST }]);
    expect(hang(t)).toMatchObject({ t0: 10, t1: 40 });
    expect(decision(t, 'PROT.DEST_REFUSED')).toBeUndefined();
    expect(t.facts.ackWaitSeconds).toBe(30);
  });

  it('the network to it cut', () => {
    const t = simulate(classic(), [{ at: 10, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 }]);
    expect(hang(t)).toMatchObject({ t0: 10, t1: 40 });
  });

  it('shut down and cut off at once: no host answers the primary, so it waits', () => {
    const t = simulate(classic(), [abortSby(10), { at: 10, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 }]);
    expect(hang(t)).toMatchObject({ t0: 10, t1: 40 });
  });

  it('maximum protection: the shutdown is still drawn one NET_TIMEOUT after the host went', () => {
    const t = simulate(maxProtDoc(), [{ at: 10, kind: 'host.down', host: SBY_HOST }]);
    expect(t.facts.abortAt).toBe(20);
  });

  it('a hang ends early when the host comes back without its instance and refuses', () => {
    const t = simulate(classic(), [
      abortSby(10), { at: 10, kind: 'host.down', host: SBY_HOST },
      { at: 20, kind: 'host.up', host: SBY_HOST },
    ]);
    expect(hang(t)).toMatchObject({ t0: 10, t1: 20 });
  });
});
