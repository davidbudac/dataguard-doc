/**
 * Split brain, read off a trace: were two members open read-write at the same
 * moment? (engine/sim/split-brain.ts)
 *
 * The reading is this page's model -- Oracle does not use the term -- so what
 * is pinned here is the question it puts to the drawing: two lanes in
 * `open-rw` over a stretch with a length. A stalled primary is not one, and a
 * manual failover that finds the old primary still running and open does not
 * close it (Oracle puts the shutdown on the operator): it is open beside the
 * new primary, reachable or not and with fast-start failover on or off, until
 * something takes it down. A former primary that goes down and restarts is not
 * that one: it is mounted (ORA-16649 where fast-start failover armed it).
 */

import { describe, expect, it } from 'vitest';
import {
  CLASSIC_IDS, citation, claimWellFormed, classicTopology, computeApp, hostId, simulate, splitBrainOf,
} from '../src/engine';
import type { EngineTrace, TimedEvent, TopologyDoc } from '../src/engine';

const PRM = CLASSIC_IDS.primary;
const SBY = CLASSIC_IDS.standby;

const isolate: TimedEvent[] = [
  { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 },
  { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc3 },
];

const fsfoOff = (): TopologyDoc => {
  const d = classicTopology({ observerLoc: 'dc3' });
  return { ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } };
};

const run = (doc: TopologyDoc, events: TimedEvent[]): EngineTrace => simulate(doc, events);

const lane = (t: EngineTrace, id: string): string[] =>
  (t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? []).map((x) => x.state as string);
const finding = (t: EngineTrace, id: string) => t.findings.find((f) => f.id === id);

/** A copy of a trace whose former primary's lane is replaced, to reach states the classic runs do not. */
const withLane = (t: EngineTrace, segments: { t0: number; t1: number | null; state: string }[]): EngineTrace => ({
  ...t,
  lanes: t.lanes.map((l) => (l.subject.kind === 'member' && l.subject.id === PRM
    ? { ...l, segments: segments as typeof l.segments } : l)),
});

describe('where the answer is no', () => {
  it('a crashed primary is down when the new one opens', () => {
    const t = run(classicTopology({ observerLoc: 'dc3' }), [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(false);
    expect(sb?.windows).toEqual([]);
    expect(sb?.formerAtOpen).toEqual({ kind: 'down' });
    expect(sb?.newPrimary).toBe(SBY);
    expect(sb?.former).toBe(PRM);
    expect(sb?.openAt).toBe(t.facts.tOpen);
  });

  it('an isolated primary aborts before the new one opens', () => {
    const t = run(classicTopology({ observerLoc: 'dc3' }), isolate);
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(false);
    expect(t.facts.abortAt).toBe(30);
    expect(sb?.formerAtOpen).toEqual({ kind: 'aborted', at: 30 });
    expect((sb?.openAt ?? 0) > 30).toBe(true);
  });

  it('is the same under MaxPerformance and with the observer on the standby\'s side', () => {
    for (const k of [{ mode: 'maxperf', logXptMode: 'async' }, { observerLoc: 'dc2' }] as const) {
      const sb = splitBrainOf(run(classicTopology({ observerLoc: 'dc3', ...k }), isolate));
      expect(sb?.split.value, JSON.stringify(k)).toBe(false);
      expect(sb?.formerAtOpen?.kind, JSON.stringify(k)).toBe('aborted');
    }
  });

  it('a primary that is stalled for good, because nothing shuts it down, is not open', () => {
    const t = run(classicTopology({ observerLoc: 'dc3', pmyShutdown: false }), isolate);
    expect(t.facts.abortAt).toBeNull();
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(false);
    expect(sb?.formerAtOpen).toEqual({ kind: 'stalled', abortsAt: null });
  });

  it('a stall that outlives the open says when it ends', () => {
    /* No classic run stalls past the open at the default settings; the lane is
       written by hand, the way the engine would draw it with a longer threshold. */
    const t = run(classicTopology({ observerLoc: 'dc3' }), isolate);
    const open = t.facts.tOpen as number;
    const made = withLane(t, [
      { t0: 0, t1: open + 5, state: 'stalled' },
      { t0: open + 5, t1: null, state: 'aborted' },
    ]);
    const sb = splitBrainOf(made);
    expect(sb?.split.value).toBe(false);
    expect(sb?.formerAtOpen).toEqual({ kind: 'stalled', abortsAt: open + 5 });
  });

  it('a former primary that was down when the new one opened, and restarts, is mounted, not open', () => {
    for (const doc of [fsfoOff(), classicTopology({ observerLoc: 'dc3' })]) {
      const t = run(doc, [
        { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
        { at: 5, kind: 'cmd.failover', to: SBY },
        { at: 100, kind: 'host.up', host: hostId('dc1-prm01') },
      ]);
      expect(lane(t, PRM)).toEqual(['down', 'mounted-noapply']);
      const sb = splitBrainOf(t);
      expect(sb?.split.value).toBe(false);
      expect(sb?.formerAtOpen).toEqual({ kind: 'down' });
    }
  });

  it('a manual failover with fast-start failover armed aborts the isolated primary first', () => {
    const d = classicTopology({ observerLoc: 'dc3' });
    const sb = splitBrainOf(run(d, [...isolate, { at: 5, kind: 'cmd.failover', to: SBY }]));
    expect(sb?.split.value).toBe(false);
    expect(sb?.formerAtOpen?.kind).toBe('aborted');
  });

  it('a manual failover after a crash has nothing open beside it', () => {
    const sb = splitBrainOf(run(fsfoOff(), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: SBY },
    ]));
    expect(sb?.split.value).toBe(false);
    expect(sb?.formerAtOpen).toEqual({ kind: 'down' });
  });
});

describe('where the answer is yes', () => {
  /* Fast-start failover off, the primary cut off from everyone and still
     running, then an operator fails over to the standby. Nothing can tell the
     old primary, and nothing stops it. */
  const t = run(fsfoOff(), [...isolate, { at: 5, kind: 'cmd.failover', to: SBY }]);

  it('names the stretch both were open, from the instant the new primary opens', () => {
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(true);
    expect(sb?.windows).toEqual([{ from: t.facts.tOpen, to: null, members: [SBY, PRM] }]);
    expect(sb?.formerAtOpen).toBeNull();
  });

  it('agrees with the lanes it was read from', () => {
    const open = (id: string) => t.lanes.find((l) => l.subject.id === id)?.segments.filter((s) => s.state === 'open-rw');
    expect(open('prm01')?.at(-1)).toMatchObject({ t0: t.facts.tOpen, t1: null });
    expect(open('sby01')?.at(-1)).toMatchObject({ t0: t.facts.tOpen, t1: null });
  });

  it('closes the stretch where the old primary stops being open', () => {
    const open = t.facts.tOpen as number;
    const made = withLane(t, [
      { t0: 0, t1: open + 12, state: 'open-rw' },
      { t0: open + 12, t1: null, state: 'aborted' },
    ]);
    const sb = splitBrainOf(made);
    expect(sb?.split.value).toBe(true);
    expect(sb?.windows).toEqual([{ from: open, to: open + 12, members: [SBY, PRM] }]);
  });

  it('is not fooled by two states that only touch: the old one closing as the new one opens', () => {
    const open = t.facts.tOpen as number;
    const made = withLane(t, [
      { t0: 0, t1: open, state: 'open-rw' },
      { t0: open, t1: null, state: 'mounted-noapply' },
    ]);
    expect(splitBrainOf(made)?.split.value).toBe(false);
  });
});

describe('a manual failover with the old primary still running and reachable', () => {
  const manual = [{ at: 0, kind: 'cmd.failover', to: SBY } as TimedEvent];
  const enabled = (): TopologyDoc => classicTopology({ observerLoc: 'dc3' });

  for (const [label, doc] of [['fast-start failover disabled', fsfoOff], ['fast-start failover enabled', enabled]] as const) {
    it(`draws the old primary open beside the new one, and reads yes, ${label}`, () => {
      const t = run(doc(), manual);
      expect(t.facts.outcome).toBe('manual');
      expect(lane(t, PRM)).toEqual(['open-rw']);
      expect(lane(t, SBY)).toEqual(['converting', 'open-rw']);
      const sb = splitBrainOf(t);
      expect(sb?.split.value).toBe(true);
      expect(sb?.windows).toEqual([{ from: t.facts.tOpen, to: null, members: [SBY, PRM] }]);
      expect(sb?.formerAtOpen).toBeNull();
    });

    it(`says so as this page's reading, citing the operator's shutdown, ${label}`, () => {
      const t = run(doc(), manual);
      const f = finding(t, 'FAILOVER.FORMER_PRIMARY_OPEN');
      expect(f?.basis).toBe('model');
      expect(f?.cite).toEqual(['FAILOVER.PRIMARY_SHUT_DOWN', 'FSFO.MANUAL_FAILOVER_CONDITIONS']);
      expect(f?.note).toMatch(/^FAILOVER\.FORMER_PRIMARY_OPEN:/);
      expect(f?.note).toContain('ORA-16649');
      /* Neither of the two mounted readings applies to a primary that stayed open. */
      expect(finding(t, 'FAILOVER.FORMER_PRIMARY_MOUNTED')).toBeUndefined();
      expect(finding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN')).toBeUndefined();
      /* And the documented error is still raised beside it. */
      expect(finding(t, 'FAILOVER.PRIMARY_STILL_OPEN')?.basis).toBe('documented');
    });
  }

  it('is the same wherever the new primary can reach it or not', () => {
    const reachable = run(fsfoOff(), manual);
    const cutOff = run(fsfoOff(), [...isolate, { at: 5, kind: 'cmd.failover', to: SBY }]);
    expect(lane(reachable, PRM).at(-1)).toBe('open-rw');
    expect(lane(cutOff, PRM).at(-1)).toBe('open-rw');
    expect(splitBrainOf(reachable)?.split.value).toBe(true);
    expect(splitBrainOf(cutOff)?.split.value).toBe(true);
  });

  it('draws the old primary\'s redo no more: it is not fed by the new primary, and it acknowledges nothing', () => {
    const t = run(fsfoOff(), manual);
    const last = t.epochs.at(-1)!;
    expect(last.primary).toBe(SBY);
    expect(last.redo.edges.filter((e) => e.to === PRM && e.active)).toEqual([]);
  });

  describe('closes the window where something takes the old primary down', () => {
    const prm = hostId('dc1-prm01');

    it('a crash', () => {
      for (const doc of [fsfoOff(), enabled()]) {
        const t = run(doc, [...manual, { at: 60, kind: 'host.down', host: prm }]);
        const sb = splitBrainOf(t);
        expect(sb?.split.value).toBe(true);
        expect(sb?.windows).toEqual([{ from: t.facts.tOpen, to: 60, members: [SBY, PRM] }]);
        expect(lane(t, PRM)).toEqual(['open-rw', 'down']);
      }
    });

    it('a shutdown of the member', () => {
      const t = run(fsfoOff(), [...manual, { at: 45, kind: 'member.down', member: PRM }]);
      expect(splitBrainOf(t)?.windows).toEqual([{ from: t.facts.tOpen, to: 45, members: [SBY, PRM] }]);
      expect(lane(t, PRM)).toEqual(['open-rw', 'down']);
    });

    it('a stall that fast-start failover aborts, when the old primary is cut off', () => {
      const t = run(enabled(), [...isolate, { at: 5, kind: 'cmd.failover', to: SBY }]);
      expect(t.facts.abortAt).toBe(30);
      expect(lane(t, PRM)).toEqual(['stalled', 'aborted']);
      const sb = splitBrainOf(t);
      expect(sb?.split.value).toBe(false);
      expect(sb?.formerAtOpen).toEqual({ kind: 'aborted', at: 30 });
    });
  });

  describe('a former primary that restarts after going down is not the one that stayed', () => {
    const prm = hostId('dc1-prm01');
    const crashThenRestart = [...manual, { at: 60, kind: 'host.down', host: prm } as TimedEvent,
      { at: 100, kind: 'host.up', host: prm } as TimedEvent];

    it('with fast-start failover disabled it comes back mounted, as this page\'s reading', () => {
      const t = run(fsfoOff(), crashThenRestart);
      expect(lane(t, PRM)).toEqual(['open-rw', 'down', 'mounted-noapply']);
      const mounted = finding(t, 'FAILOVER.FORMER_PRIMARY_MOUNTED');
      expect(mounted?.basis).toBe('model');
      expect(mounted?.note).toContain('never to one a manual failover found still open');
      expect(mounted?.message).toContain('drawn mounted, not open');
      /* The window it was open still stands, and ends at the crash. */
      expect(splitBrainOf(t)?.windows).toEqual([{ from: t.facts.tOpen, to: 60, members: [SBY, PRM] }]);
    });

    it('with fast-start failover enabled it is not allowed to open: ORA-16649, documented', () => {
      const t = run(enabled(), crashThenRestart);
      expect(lane(t, PRM)).toEqual(['open-rw', 'down', 'mounted-noapply']);
      const f = finding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN');
      expect(f?.basis).toBe('documented');
      expect(f?.ora).toBe('ORA-16649');
    });

    it('one that was already down when the failover ran is mounted when it returns, and split brain reads no', () => {
      for (const [doc, id] of [[fsfoOff(), 'FAILOVER.FORMER_PRIMARY_MOUNTED'], [enabled(), 'FSFO.FORMER_PRIMARY_NOT_OPEN']] as const) {
        const t = run(doc, [
          { at: 0, kind: 'host.down', host: prm }, { at: 5, kind: 'cmd.failover', to: SBY },
          { at: 100, kind: 'host.up', host: prm },
        ]);
        expect(lane(t, PRM)).toEqual(['down', 'mounted-noapply']);
        expect(finding(t, id)).toBeDefined();
        expect(finding(t, 'FAILOVER.FORMER_PRIMARY_OPEN')).toBeUndefined();
        expect(splitBrainOf(t)?.split.value).toBe(false);
      }
    });
  });
});

describe('the application\'s view of an old primary that stayed open', () => {
  /* The role-based service is published by a database open read-write, so the
     old primary keeps publishing it for as long as it is open, beside the new
     primary once that opens. The sessions stay where they are; a new
     connection lands on the first address that publishes. */
  const doc = fsfoOff();
  const manual: TimedEvent = { at: 0, kind: 'cmd.failover', to: SBY };
  const crash = (at: number): TimedEvent => ({ at, kind: 'host.down', host: hostId('dc1-prm01') });
  const dead = (d: TopologyDoc, deadBehaviour: 'drop' | 'rst'): TopologyDoc =>
    ({ ...d, client: { ...d.client, deadBehaviour } });

  it('lists both publishers, in the order of the address list, once the new primary opens', () => {
    const t = run(doc, [manual]);
    const app = computeApp(doc.client, t, doc);
    expect(doc.client.addresses.map((a) => a.host)).toEqual([hostId('dc1-prm01'), hostId('dc2-sby01')]);
    expect(app.noEvent).toBe(true);
    expect(app.noEventKind).toBe('continues');
    expect(app.spans.map((x) => [x.t0, x.serving, x.published, x.publishers.map((p) => [p.member, p.state, p.reached])])).toEqual([
      [0, PRM, PRM, [[PRM, 'open-rw', true]]],
      [t.facts.tOpen, PRM, PRM, [[PRM, 'open-rw', true], [SBY, 'open-rw', true]]],
    ]);
    expect(app.steady.publishers).toEqual([{ member: PRM, state: 'open-rw', reached: true }]);
    expect(app.sessionsOn).toBe(PRM);
    expect(app.lostAt).toBeNull();
    expect(app.servedAtLoss).toBeNull();
  });

  it('says so in a model claim that cites nothing, only while two publish', () => {
    const both = computeApp(doc.client, run(doc, [manual]), doc);
    const c = both.claims.overlap;
    expect(c?.basis).toBe('model');
    expect(c?.cite).toEqual([]);
    expect(c?.note).toMatch(/^APP\.TWO_PUBLISHERS:/);
    expect(c?.note).toContain('FAILOVER.FORMER_PRIMARY_OPEN');
    expect(claimWellFormed(c!)).toBe(true);
    const plain = computeApp(doc.client, run(doc, [crash(60)]), doc);
    expect(plain.claims.overlap).toBeUndefined();
  });

  it('moves the service to the new primary when the old one goes down', () => {
    const app = computeApp(doc.client, run(doc, [manual, crash(60)]), doc);
    expect(app.spans.map((x) => [x.t0, x.serving])).toEqual([[0, PRM], [25, PRM], [60, SBY]]);
    expect(app.spans.at(-1)?.servingState).toBe('open-rw');
    expect(app.spans.at(-1)?.publishers.map((p) => p.member)).toEqual([SBY]);
  });

  it('loses the sessions when the old primary goes down during the overlap, though the service stays published', () => {
    const app = computeApp(doc.client, run(doc, [manual, crash(60)]), doc);
    expect(app.noEvent).toBe(false);
    expect(app.lostAt).toBe(60);
    expect(app.sessionsOn).toBe(PRM);
    expect(app.servedAtLoss).toBe(SBY);
    expect(app.startAt).toBe(60);
    expect(app.tService).toBe(60);
    /* One attempt: address 1 is the dead old primary, the default drops the
       packets, and address 2 is the new primary, already publishing. */
    expect(app.attempts).toHaveLength(1);
    const dials = app.attempts[0]!.dials;
    const cost = Math.min(doc.client.transportConnectTimeoutSeconds, doc.client.connectTimeoutSeconds ?? Infinity);
    expect(doc.client.deadBehaviour).toBe('drop');
    expect(dials[0]).toMatchObject({ index: 0, host: hostId('dc1-prm01'), kind: 'timeout', at: 60, cost });
    expect(dials.at(-1)).toMatchObject({ host: hostId('dc2-sby01'), kind: 'establish' });
    expect(app.tConn).toBeCloseTo(60 + cost + app.estab, 9);
    expect(app.claims.overlap).toBeDefined();
  });

  it('an OS that refuses the dead address costs 0.15 s, not a timeout', () => {
    const d = dead(doc, 'rst');
    const app = computeApp(d.client, run(d, [manual, crash(60)]), d);
    expect(app.attempts[0]!.dials[0]).toMatchObject({ kind: 'rst', cost: app.rst });
    expect(app.tConn).toBeCloseTo(60 + app.rst + app.estab, 9);
  });

  it('a member.down of the old primary is the same loss, with its host still answering', () => {
    const app = computeApp(doc.client, run(doc, [manual, { at: 45, kind: 'member.down', member: PRM }]), doc);
    expect(app.lostAt).toBe(45);
    expect(app.sessionsOn).toBe(PRM);
    expect(app.servedAtLoss).toBe(SBY);
    expect(app.startAt).toBe(45);
    expect(app.tService).toBe(45);
    /* The host is up and its listener has no such service: ORA-12514, then the new primary. */
    expect(app.attempts[0]!.dials[0]).toMatchObject({ index: 0, kind: 'refuse', cost: app.refuse });
    expect(app.attempts[0]!.dials.at(-1)).toMatchObject({ host: hostId('dc2-sby01'), kind: 'establish' });
    expect(app.tConn).toBeCloseTo(45 + app.refuse + app.estab, 9);
  });

  it('a plain primary crash, with no manual failover, is still the service going away', () => {
    const en = classicTopology({ observerLoc: 'dc3' });
    const app = computeApp(en.client, run(en, [crash(60)]), en);
    expect(app.lostAt).toBe(60);
    expect(app.sessionsOn).toBe(PRM);
    expect(app.servedAtLoss).toBeNull();
    expect(app.startAt).toBe(60);
    /* Unchanged by the redefinition: pinned from the model before it. */
    expect(app.tService).toBe(115);
    expect(app.tConn).toBeCloseTo(120.3, 9);
    expect(app.claims.overlap).toBeUndefined();
  });

  it('a run in which nothing goes wrong has sessions on the primary and no loss', () => {
    const app = computeApp(doc.client, run(doc, [{ at: 0, kind: 'observer.stop', observer: CLASSIC_IDS.observer }]), doc);
    expect(app.lostAt).toBeNull();
    expect(app.sessionsOn).toBe(PRM);
    expect(app.servedAtLoss).toBeNull();
  });
});

describe('where the question does not arise', () => {
  it('a switchover, however clean, is not asked', () => {
    const t = run(classicTopology({ observerLoc: 'dc3' }), [{ at: 0, kind: 'cmd.switchover', to: SBY }]);
    expect(t.facts.outcome).toBe('switchover');
    expect(splitBrainOf(t)).toBeNull();
  });

  it('a switchover never leaves the old primary open, with fast-start failover on or off', () => {
    for (const doc of [fsfoOff(), classicTopology({ observerLoc: 'dc3' })]) {
      const t = run(doc, [{ at: 0, kind: 'cmd.switchover', to: SBY }]);
      expect(splitBrainOf(t)).toBeNull();
      expect(lane(t, PRM)).toEqual(['open-rw', 'converting', 'mounted-noapply']);
      expect(finding(t, 'FAILOVER.FORMER_PRIMARY_OPEN')).toBeUndefined();
    }
  });

  it('a run in which nothing moves is not asked', () => {
    const t = run(classicTopology({ observerLoc: 'dc3' }), [{ at: 0, kind: 'observer.stop', observer: CLASSIC_IDS.observer }]);
    expect(t.facts.newPrimary).toBeNull();
    expect(splitBrainOf(t)).toBeNull();
  });

  it('a failover the readiness check refused is not asked', () => {
    const t = run(classicTopology({ observerLoc: 'dc3' }), [
      { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 },
      { at: 100, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    expect(t.facts.blocked || t.facts.newPrimary === null).toBe(true);
    expect(splitBrainOf(t)).toBeNull();
  });

  it('a manual failover nobody was promoted by is not asked', () => {
    const t = run(fsfoOff(), [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(t.facts.newPrimary).toBeNull();
    expect(splitBrainOf(t)).toBeNull();
  });
});

describe('the claim', () => {
  const claims = [
    splitBrainOf(run(classicTopology({ observerLoc: 'dc3' }), isolate)),
    splitBrainOf(run(fsfoOff(), [...isolate, { at: 5, kind: 'cmd.failover', to: SBY }])),
    splitBrainOf(run(fsfoOff(), [{ at: 0, kind: 'cmd.failover', to: SBY }])),
    splitBrainOf(run(classicTopology({ observerLoc: 'dc3' }), [{ at: 0, kind: 'cmd.failover', to: SBY }])),
  ];

  it('is this page\'s model, with the note that says so, whichever way it reads', () => {
    for (const sb of claims) {
      expect(sb?.split.basis).toBe('model');
      expect(sb?.split.note).toMatch(/^SPLIT_BRAIN\.READING:/);
      expect(claimWellFormed(sb!.split)).toBe(true);
    }
  });

  it('says the old primary is left open because the shutdown is the operator\'s, and that this is its reading', () => {
    for (const sb of claims) {
      expect(sb!.split.note).toContain('FAILOVER.FORMER_PRIMARY_OPEN');
      expect(sb!.split.note).toContain('FAILOVER.PRIMARY_SHUT_DOWN');
      expect(sb!.split.note).not.toContain('FAILOVER.FORMER_PRIMARY_MOUNTED');
      expect(sb!.split.cite).toContain('FSFO.MANUAL_FAILOVER_CONDITIONS');
    }
  });

  it('rests on citations that exist, one of them the HA guide\'s own definition of the term', () => {
    /* FC 10-01 TXT-87: this test used to say no citation names the term, on the premise that
       Oracle does not use it. The HA guide does, and defines it; the claim cites that sentence,
       and every other citation it carries still stays out of the business of naming it. */
    for (const sb of claims) {
      expect(sb!.split.cite.length).toBeGreaterThan(0);
      expect(sb!.split.cite).toContain('SPLIT_BRAIN.DEFINITION');
      for (const id of sb!.split.cite) {
        if (id === 'SPLIT_BRAIN.DEFINITION') continue;
        expect(citation(id).quote.toLowerCase()).not.toContain('split brain');
      }
    }
  });
});
