/**
 * Property tests for the simulation kernel -- engine design SS8.2.
 *
 * The corpus is a hand-rolled generator: the published 1+1+1 deployment across
 * every scenario, placement, mode and edition, plus the hand-built far sync,
 * multi-target, RAC, maximum protection and two-observer documents. The
 * properties below have to hold for every one of them.
 */

import { describe, expect, it } from 'vitest';
import { CITATION_IDS } from '../src/engine/citations';
import type { CitationId } from '../src/engine/citations';
import { classicTopology } from '../src/engine/compat/classic';
import type { ClassicMode, ClassicObserverLoc, ClassicScenario } from '../src/engine/compat/classic';
import { hostId, memberId, observerId, siteId } from '../src/engine/ids';
import type { MemberId } from '../src/engine/ids';
import {
  applyNetEvent, buildReachability, initialNetState, memberAlive, memberReachableFromHost,
  membersReachable,
} from '../src/engine/net/graph';
import type { NetState } from '../src/engine/net/graph';
import { resolveRedoGraph } from '../src/engine/redo/resolve';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import type { EngineTrace } from '../src/engine/sim/simulate';
import type { Claim, Finding } from '../src/engine/types/claims';
import type { TimedEvent } from '../src/engine/types/events';
import type { Member, TopologyDoc } from '../src/engine/types/topology';
import { isFarSync } from '../src/engine/types/topology';
import type { Lane, Segment } from '../src/engine/types/trace';
import { farSyncDoc, maxProtDoc, multiObserverDoc, multiTargetDoc, racDoc } from './topologies';

interface Case { name: string; doc: TopologyDoc; events: TimedEvent[] }

function corpus(): Case[] {
  const out: Case[] = [];
  const scenarios: ClassicScenario[] = ['crash', 'isolated', 'partition', 'dc2down', 'observer-lost', 'switchover'];
  const locs: ClassicObserverLoc[] = ['none', 'dc1', 'dc2', 'dc3'];
  const modes: ClassicMode[] = ['maxavail', 'maxperf'];
  let n = 0;
  for (const scenario of scenarios) {
    for (const observerLoc of locs) {
      for (const mode of modes) {
        for (const version of ['19c', '26ai'] as const) {
          /* The two booleans walk a fixed cycle rather than a random draw, so
             the corpus is the same list on every run. */
          const pmyShutdown = n % 2 === 0;
          const pingSet = n % 3 === 0;
          const standbyLag = [0, 10, 45, 80][n % 4] as number;
          n++;
          const doc = classicTopology({
            scenario, observerLoc, mode, version, pmyShutdown, pingSet, standbyLag,
            lagPolicy: n % 5 === 0 ? 'bounded' : 'zero',
          });
          out.push({
            name: `classic ${scenario}/${observerLoc}/${mode}/${version}`,
            doc, events: doc.events,
          });
        }
      }
    }
  }

  const fsDown: TimedEvent[] = [{ at: 10, kind: 'host.down', host: hostId('dc1-fs01') }];
  out.push({ name: 'far sync, maxavail, far sync host down', doc: farSyncDoc(), events: fsDown });
  out.push({ name: 'far sync, maxperf, far sync host down', doc: farSyncDoc('MAXPERFORMANCE'), events: fsDown });
  out.push({
    name: 'far sync, primary crash',
    doc: farSyncDoc(),
    events: [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }],
  });
  out.push({
    name: 'multi-target, dc2 down and the primary with it',
    doc: multiTargetDoc(),
    events: [
      { at: 0, kind: 'site.down', site: siteId('dc2') },
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
    ],
  });
  out.push({
    name: 'multi-target, dc2 down and the primary after it',
    doc: multiTargetDoc(),
    events: [
      { at: 0, kind: 'site.down', site: siteId('dc2') },
      { at: 10, kind: 'host.down', host: hostId('dc1-prm01') },
    ],
  });
  /* The outages at different times: the standby first, then the observer;
     the observer first, then the standby; and a standby that comes back. */
  const cut = (at: number, link: string): TimedEvent =>
    ({ at, kind: 'link.cut', link: link as never });
  out.push({
    name: 'classic, standby cut off, then the observer, then the primary crashes',
    doc: classicTopology({ observerLoc: 'dc3' }),
    events: [cut(0, 'dc1-dc2'), cut(100, 'dc1-dc3'), { at: 200, kind: 'host.down', host: hostId('dc1-prm01') }],
  });
  out.push({
    name: 'classic, observer stopped, then the standby cut off',
    doc: classicTopology({ observerLoc: 'dc3' }),
    events: [{ at: 0, kind: 'observer.stop', observer: observerId('obs01') }, cut(50, 'dc1-dc2')],
  });
  out.push({
    name: 'classic maxperf, standby cut off, the lag grows past the limit, crash',
    doc: classicTopology({ observerLoc: 'dc3', mode: 'maxperf', logXptMode: 'async', standbyLag: 10 }),
    events: [cut(0, 'dc1-dc2'), { at: 100, kind: 'host.down', host: hostId('dc1-prm01') }],
  });
  out.push({
    name: 'classic, standby down and back, crash',
    doc: classicTopology({ observerLoc: 'dc3' }),
    events: [
      { at: 0, kind: 'host.down', host: hostId('dc2-sby01') },
      { at: 50, kind: 'host.up', host: hostId('dc2-sby01') },
      { at: 60, kind: 'host.down', host: hostId('dc1-prm01') },
    ],
  });
  out.push({
    name: 'classic, crash, failover, the former primary returns, the new primary dies',
    doc: classicTopology({ observerLoc: 'dc3' }),
    events: [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 100, kind: 'host.up', host: hostId('dc1-prm01') },
      { at: 200, kind: 'host.down', host: hostId('dc2-sby01') },
    ],
  });
  out.push({
    name: 'RAC, one instance down',
    doc: racDoc(),
    events: [{ at: 0, kind: 'instance.down', member: memberId('prm01'), instance: 'prm011' }],
  });
  out.push({
    name: 'maximum protection, standby site down',
    doc: maxProtDoc(),
    events: [{ at: 0, kind: 'site.down', site: siteId('dc2') }],
  });
  out.push({
    name: 'maximum protection, primary crash',
    doc: maxProtDoc(),
    events: [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }],
  });
  out.push({
    name: 'two observers, the master stops',
    doc: multiObserverDoc(),
    events: [{ at: 10, kind: 'observer.stop', observer: observerId('obs01') }],
  });
  out.push({
    name: 'two observers, both stop',
    doc: multiObserverDoc(),
    events: [
      { at: 10, kind: 'observer.stop', observer: observerId('obs01') },
      { at: 20, kind: 'observer.stop', observer: observerId('obs02') },
    ],
  });
  return out;
}

const CASES = corpus();
const TRACES: { c: Case; trace: EngineTrace }[] = CASES.map((c) => ({ c, trace: simulate(c.doc, c.events) }));

/** The network as it stands once every event at or before `t` has landed. */
function netAt(doc: TopologyDoc, events: readonly TimedEvent[], t: number): NetState {
  let net = initialNetState(doc);
  for (const e of events) {
    if (e.at > t) continue;
    switch (e.kind) {
      case 'host.down': case 'host.up': case 'site.down': case 'site.up':
      case 'link.cut': case 'link.heal': case 'partition':
      case 'member.down': case 'member.up':
        net = applyNetEvent(net, e);
        break;
      case 'instance.down': {
        const m = doc.members.find((x) => x.id === e.member);
        const inst = m?.instances.find((i) => i.name === e.instance);
        if (inst) net = applyNetEvent(net, { kind: 'host.down', host: inst.host });
        break;
      }
      default:
        break;
    }
  }
  return net;
}

describe('SS8.2 properties', () => {
  it('the corpus is big enough to be worth calling one', () => {
    expect(CASES.length).toBeGreaterThan(100);
  });

  it('no failover without a running master observer', () => {
    for (const { c, trace } of TRACES) {
      if (trace.facts.initiateAt === null) continue;
      expect(c.doc.config.fsfo.state, c.name).toBe('enabled');
      const snap = stateAt(trace, trace.facts.initiateAt);
      const running = Object.values(snap.observers).filter((s) => s !== 'stopped');
      expect(running.length, `${c.name}: an observer has to be running to order a failover`)
        .toBeGreaterThan(0);
      expect(trace.decisions.some((d) => d.id === 'FSFO.OBSERVER_REACHES_TARGET' && d.taken), c.name)
        .toBe(true);
    }
  });

  it('a far sync instance is never open, never primary and never a target', () => {
    const OPEN = ['open-rw', 'open-ro', 'mounted-apply', 'mounted-noapply', 'converting', 'reinstating'];
    for (const { c, trace } of TRACES) {
      const farSyncs = c.doc.members.filter(isFarSync).map((m) => m.id as string);
      if (farSyncs.length === 0) continue;
      expect(farSyncs.includes(trace.facts.newPrimary as string), c.name).toBe(false);
      expect(farSyncs.includes(trace.facts.target as string), c.name).toBe(false);
      expect(farSyncs.includes(c.doc.config.fsfo.target.kind === 'list'
        ? String(c.doc.config.fsfo.target.members[0]) : ''), c.name).toBe(false);
      for (const lane of trace.lanes) {
        if (!farSyncs.includes(lane.subject.id)) continue;
        for (const seg of lane.segments) {
          expect(OPEN.includes(seg.state as string), `${c.name}: ${lane.subject.id} ${seg.state}`)
            .toBe(false);
        }
      }
    }
  });

  it('maximum availability never shuts the primary down for want of an acknowledgement', () => {
    for (const { c, trace } of TRACES) {
      if (c.doc.config.protectionMode !== 'MAXAVAILABILITY') continue;
      expect(trace.facts.abortReason, c.name).not.toBe('maxprotection');
    }
  });

  it('maximum protection with no synchronous acknowledgement left aborts the primary', () => {
    for (const { c, trace } of TRACES) {
      if (c.doc.config.protectionMode !== 'MAXPROTECTION') continue;
      const acks = trace.epochs[trace.epochs.length - 1]?.redo.edges
        .filter((e) => e.active && e.up && (e.xpt === 'SYNC' || e.xpt === 'FASTSYNC')) ?? [];
      if (acks.length > 0) continue;
      const primary = trace.epochs[0]?.primary as MemberId;
      const end = trace.facts.perMember[primary]?.endState;
      /* A primary that is already gone has nothing left to shut down. */
      if (end === 'down') continue;
      expect(end, c.name).toBe('aborted');
    }
  });

  /* Fact check SIM-02: the property used to be "stalled whenever it reaches
     neither". Oracle stalls a primary only while a change of state is left to
     confirm, so the target has to have been ready and the configuration
     observed when the primary lost the two of them. Every case this property
     walks loses them at t = 0 or not at all, so "ready" is the target as
     configured. */
  it('the primary stalls only when it reaches neither the master observer nor any target, with a change of state left to confirm', () => {
    for (const { c, trace } of TRACES) {
      if (c.events.some((e) => e.at > 0)) continue;
      const net = netAt(c.doc, c.events, 0);
      const reach = buildReachability(c.doc, net);
      const primary = c.doc.members.find((m) => m.id === trace.epochs[0]?.primary) as Member;
      const alive = !!primary && memberAlive(c.doc, net, primary);
      const observerHosts = c.doc.observers
        .filter((o) => o.running)
        .map((o) => o.host);
      const obsSees = alive && observerHosts.some((h) => memberReachableFromHost(c.doc, net, primary, h, reach));
      const targets = c.doc.config.fsfo.target.kind === 'list' ? c.doc.config.fsfo.target.members : [];
      const targetSees = alive && targets.some((id) => {
        const m = c.doc.members.find((x) => x.id === id);
        return !!m && memberAlive(c.doc, net, m) && membersReachable(c.doc, net, primary, m, reach);
      });
      const armed = c.doc.config.fsfo.state === 'enabled';
      const first = c.doc.members.find((m) => m.id === targets[0]);
      const steady = resolveRedoGraph(c.doc, { primary: primary.id });
      const gatedOnLag = c.doc.config.protectionMode === 'MAXPERFORMANCE'
        || (c.doc.config.edition === '26ai' && c.doc.config.fsfo.lagLimitSeconds > 0);
      const ready = !!first && first.kind === 'database' && (gatedOnLag
        ? first.applyLagSeconds <= c.doc.config.fsfo.lagLimitSeconds
        : steady.members[first.id]?.synchronized.value === true);
      const expected = armed && alive && !obsSees && !targetSees && ready;
      expect(trace.facts.conditions.stalled, c.name).toBe(expected);
      if (armed && alive && !obsSees && !targetSees && !ready) {
        expect(trace.facts.abortAt, c.name).toBe(null);
        expect(trace.facts.initiateAt, c.name).toBe(null);
        expect(trace.decisions.some((d) => d.id === 'PRIMARY.NO_STALL'), c.name).toBe(true);
      }
    }
  });

  it('lanes are contiguous, start at zero and end open', () => {
    for (const { c, trace } of TRACES) {
      for (const lane of trace.lanes) {
        const segs = lane.segments as Segment[];
        expect(segs.length, `${c.name}: ${lane.subject.id}`).toBeGreaterThan(0);
        expect(segs[0]?.t0, `${c.name}: ${lane.subject.id} starts at 0`).toBe(0);
        for (let i = 0; i < segs.length - 1; i++) {
          const a = segs[i] as Segment;
          const b = segs[i + 1] as Segment;
          expect(a.t1, `${c.name}: ${lane.subject.id} segment ${i} ends where the next begins`)
            .toBe(b.t0);
          expect(b.t0 > a.t0, `${c.name}: ${lane.subject.id} moves forward`).toBe(true);
          expect(a.state, `${c.name}: ${lane.subject.id} coalesced`).not.toBe(b.state);
        }
        expect(segs[segs.length - 1]?.t1, `${c.name}: ${lane.subject.id} ends open`).toBe(null);
      }
    }
  });

  it('stateAt agrees with the lanes and lands in the right epoch', () => {
    const at = (lane: Lane, t: number): string | undefined => {
      let state: string | undefined;
      for (const s of lane.segments) {
        if (s.t0 <= t && (s.t1 === null || t < s.t1)) state = s.state as string;
      }
      return state;
    };
    for (const { c, trace } of TRACES) {
      for (const t of [0, 1, 7.5, 30, 55, 120]) {
        const snap = stateAt(trace, t);
        expect(snap.epoch.t0 <= t || t < 0, `${c.name} @${t}`).toBe(true);
        if (snap.epoch.t1 !== null) expect(t < snap.epoch.t1 || t >= snap.epoch.t0, `${c.name} @${t}`).toBe(true);
        for (const lane of trace.lanes) {
          if (lane.subject.kind === 'link') continue;   // the snapshot carries members and observers
          const want = at(lane, t);
          if (want === undefined) continue;
          const got = lane.subject.kind === 'member'
            ? snap.members[lane.subject.id as MemberId]
            : snap.observers[lane.subject.id as never];
          expect(got, `${c.name} @${t} ${lane.subject.id}`).toBe(want);
        }
      }
    }
  });

  it('simulating twice gives exactly the same trace', () => {
    for (const { c } of TRACES) {
      const a = simulate(c.doc, c.events);
      const b = simulate(c.doc, c.events);
      expect(JSON.stringify(a), c.name).toBe(JSON.stringify(b));
    }
  });

  it('every non-documented claim carries a note and an existing citation', () => {
    const ids = new Set<string>(CITATION_IDS);
    const checkCite = (cite: readonly CitationId[], where: string): void => {
      for (const id of cite) expect(ids.has(id), `${where}: unknown citation ${id}`).toBe(true);
    };
    const checkClaim = (claim: Claim<unknown>, where: string): void => {
      checkCite(claim.cite, where);
      if (claim.basis === 'documented') {
        expect(claim.cite.length, `${where}: a documented claim needs a citation`).toBeGreaterThan(0);
        return;
      }
      expect((claim.note ?? '').length, `${where}: a ${claim.basis} claim needs a note`).toBeGreaterThan(0);
      expect(claim.cite.length, `${where}: a ${claim.basis} claim needs a citation`).toBeGreaterThan(0);
      if (claim.basis === 'conflict') {
        expect(claim.cite.length, `${where}: a conflict cites both sides`).toBeGreaterThan(1);
      }
    };
    const checkFinding = (f: Finding, where: string): void => {
      checkCite(f.cite, `${where} ${f.id}`);
      expect(f.cite.length, `${where} ${f.id}: every finding cites something`).toBeGreaterThan(0);
      if (f.basis !== 'documented') {
        expect((f.note ?? '').length, `${where} ${f.id}: a ${f.basis} finding needs a note`)
          .toBeGreaterThan(0);
      }
    };

    for (const { c, trace } of TRACES) {
      for (const f of trace.findings) checkFinding(f, c.name);
      for (const d of trace.decisions) checkClaim(d.claim, `${c.name} decision ${d.id}`);
      checkClaim(trace.facts.protectionLevel, `${c.name} protection level`);
      for (const [id, pm] of Object.entries(trace.facts.perMember)) {
        if (pm.rpoSeconds) checkClaim(pm.rpoSeconds, `${c.name} ${id} rpo`);
        if (pm.rtoSeconds) checkClaim(pm.rtoSeconds, `${c.name} ${id} rto`);
      }
      for (const e of trace.epochs) {
        checkClaim(e.protectionLevel, `${c.name} epoch ${e.t0} level`);
        for (const f of e.redo.findings) checkFinding(f, `${c.name} epoch ${e.t0}`);
        for (const [id, r] of Object.entries(e.redo.members)) {
          checkClaim(r.synchronized, `${c.name} epoch ${e.t0} ${id} synchronized`);
          checkClaim(r.countsTowardProtectionAck, `${c.name} epoch ${e.t0} ${id} ack`);
        }
      }
    }
  });

  it('the epoch loop stays bounded and every epoch is ordered', () => {
    for (const { c, trace } of TRACES) {
      expect(trace.epochs.length, c.name).toBeLessThan(512);
      for (let i = 0; i < trace.epochs.length - 1; i++) {
        const a = trace.epochs[i];
        const b = trace.epochs[i + 1];
        expect(a?.t1, `${c.name} epoch ${i}`).toBe(b?.t0);
        expect((b?.t0 ?? 0) > (a?.t0 ?? 0), `${c.name} epoch ${i} moves forward`).toBe(true);
      }
      expect(trace.epochs[trace.epochs.length - 1]?.t1, c.name).toBe(null);
    }
  });
});
