/**
 * Split brain, read off a trace: were two members open read-write at the same
 * moment? (engine/sim/split-brain.ts)
 *
 * The reading is this page's model -- Oracle does not use the term -- so what
 * is pinned here is the question it puts to the drawing: two lanes in
 * `open-rw` over a stretch with a length. A stalled primary is not one, a
 * former primary the new one can reach is mounted, and one nothing can tell
 * (a manual failover with fast-start failover off, the old primary running
 * where the new one cannot reach it) is open beside it.
 */

import { describe, expect, it } from 'vitest';
import {
  CLASSIC_IDS, citation, claimWellFormed, classicTopology, hostId, simulate, splitBrainOf,
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

  it('a former primary the new one can reach is mounted, not open', () => {
    const t = run(fsfoOff(), [{ at: 0, kind: 'cmd.failover', to: SBY }]);
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(false);
    expect(sb?.formerAtOpen).toEqual({ kind: 'closed', state: 'mounted-noapply' });
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

describe('where the question does not arise', () => {
  it('a switchover, however clean, is not asked', () => {
    const t = run(classicTopology({ observerLoc: 'dc3' }), [{ at: 0, kind: 'cmd.switchover', to: SBY }]);
    expect(t.facts.outcome).toBe('switchover');
    expect(splitBrainOf(t)).toBeNull();
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
  ];

  it('is this page\'s model, with the note that says so, whichever way it reads', () => {
    for (const sb of claims) {
      expect(sb?.split.basis).toBe('model');
      expect(sb?.split.note).toMatch(/^SPLIT_BRAIN\.READING:/);
      expect(claimWellFormed(sb!.split)).toBe(true);
    }
  });

  it('rests on citations that exist, none of them claiming Oracle names the term', () => {
    for (const sb of claims) {
      expect(sb!.split.cite.length).toBeGreaterThan(0);
      for (const id of sb!.split.cite) expect(citation(id).quote.toLowerCase()).not.toContain('split brain');
    }
  });
});
