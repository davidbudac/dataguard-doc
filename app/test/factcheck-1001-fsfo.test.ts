/**
 * Regression tests for the role-change findings of the 2026-10-01 fact check
 * (SIMULATOR_FACT_CHECK_2026-10-01.md) and the owner's decisions D5, D6 and D7:
 * SIM-15, D5, SIM-16, SIM-20 and D7 / SIM-24.
 *
 * One block per id. Each takes the reproduction the report gives and holds the
 * run to the Oracle sentence the report quotes -- the sentence is in the
 * citation catalogue, and the test asks for it by id so the two cannot drift.
 *
 * The probes in `fact-check/probes.probe.ts` ask "has the behaviour moved?";
 * these ask "is it right?", and they fail the suite when it is not.
 */

import { describe, expect, it } from 'vitest';
import { citation } from '../src/engine/citations';
import type { CitationId } from '../src/engine/citations';
import { CLASSIC_IDS, classicTopology } from '../src/engine/compat/classic';
import type { ClassicKnobs } from '../src/engine/compat/classic';
import { hostId } from '../src/engine/ids';
import { simulate } from '../src/engine/sim/simulate';
import type { EngineTrace } from '../src/engine/sim/simulate';
import { splitBrainOf } from '../src/engine/sim/split-brain';
import type { TimedEvent } from '../src/engine/types/events';
import type { TopologyDoc } from '../src/engine/types/topology';

/* ---------------- helpers ---------------- */

const PRM = hostId('dc1-prm01');
const SBY = CLASSIC_IDS.standby;
const OBS = CLASSIC_IDS.observer;
const DC1_DC2 = CLASSIC_IDS.linkDc1Dc2;
const DC1_DC3 = CLASSIC_IDS.linkDc1Dc3;
const DC2_DC3 = CLASSIC_IDS.linkDc2Dc3;

const classic = (k: ClassicKnobs = {}): TopologyDoc => classicTopology({ observerLoc: 'dc3', ...k });
const fsfoOff = (d: TopologyDoc): TopologyDoc =>
  ({ ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } });
/** Flashback Database and static service names on every database: what automatic reinstatement needs. */
const reinstatable = (d: TopologyDoc): TopologyDoc => ({
  ...d,
  members: d.members.map((m) => (m.kind === 'database' ? { ...m, flashbackOn: true, staticServices: true } : m)),
});

const cut = (at: number, link: typeof DC1_DC2): TimedEvent => ({ at, kind: 'link.cut', link });
const heal = (at: number, link: typeof DC1_DC2): TimedEvent => ({ at, kind: 'link.heal', link });
const down = (at: number, host: typeof PRM): TimedEvent => ({ at, kind: 'host.down', host });
const up = (at: number, host: typeof PRM): TimedEvent => ({ at, kind: 'host.up', host });
const failover = (at: number): TimedEvent => ({ at, kind: 'cmd.failover', to: SBY });
const stopObserver = (at: number): TimedEvent => ({ at, kind: 'observer.stop', observer: OBS });
const isolate: TimedEvent[] = [cut(0, DC1_DC2), cut(0, DC1_DC3)];

const lane = (t: EngineTrace, id: string): string =>
  (t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [])
    .map((s) => `${s.t0}:${s.state}`).join(' | ');
const states = (t: EngineTrace, id: string): string[] =>
  (t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [])
    .map((s) => s.state as string);
const endState = (t: EngineTrace, id: string): string | undefined => states(t, id).at(-1);
const decisions = (t: EngineTrace, id: string) => t.decisions.filter((d) => d.id === id);
const decision = (t: EngineTrace, id: string) => t.decisions.find((d) => d.id === id);
const finding = (t: EngineTrace, id: string) => t.findings.find((f) => f.id === id);
const quote = (id: CitationId): string => citation(id).quote;

/** Neither a stall nor an abort is recorded against `member`. */
const neverStalledOrAborted = (t: EngineTrace, member: string): boolean =>
  !t.decisions.some((d) => (d.id === 'PRIMARY.STALL' || d.id === 'PRIMARY.ABORT')
    && (d.subject?.id === member || (d.id === 'PRIMARY.STALL' && d.subject === undefined)))
  && !states(t, member).some((s) => s === 'stalled' || s === 'aborted');

/* ---------------- the sentences ---------------- */

describe('the sentences the 2026-10-01 role-change fixes are held to', () => {
  it('are in the catalogue, word for word', () => {
    expect(quote('FSFO.UNOBSERVED_CONTINUES')).toBe(
      'While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails.');
    expect(quote('FSFO.REINSTATED_IS_TARGET')).toBe(
      'The reinstated database acts as the fast-start failover target for the new primary database, making a subsequent fast-start failover possible.');
    expect(quote('FSFO.STALLED_LIKELY_FAILOVER')).toBe(
      'It shuts down or stalls because it is likely a failover has occurred.');
    expect(quote('FSFO.ONE_PRIMARY_GUARANTEE')).toContain(
      'Data Guard fast-start failover always guarantees that only one primary database exists');
    expect(quote('REINSTATE.RESTRICT_OBSERVER_CONNECT')).toBe(
      'The master observer cannot connect to the former primary database');
    expect(quote('REINSTATE.RESTRICT_NEW_PRIMARY_CONNECT')).toBe(
      'The former primary database cannot connect to the new primary database');
    expect(quote('REINSTATE.WHEN_RECONNECTED')).toContain(
      'the master observer will attempt to reinstate the former primary database as a new standby database when a connection to the former primary database is reestablished');
    expect(quote('REINSTATE.PMY_SHUTDOWN_RESTART')).toBe(
      'If the FastStartFailoverPmyShutdown configuration property is set to TRUE, then the former primary database will have been automatically shut down and must be manually restarted before the master observer can attempt to reinstate it.');
    expect(quote('FAILOVER.FORMER_PRIMARY_MOUNTED_26AI')).toBe(
      'Because a role transition occurred while the old primary was offline, Data Guard prevents the database from reopening and leaves it in a mounted state to ensure there is only one database open in the primary role.');
    expect(citation('FAILOVER.FORMER_PRIMARY_MOUNTED_26AI').edition).toBe('26ai');
  });
});

/* ---------------- SIM-15 / D6 ---------------- */

describe('SIM-15 (D6): after a role change the new primary has no target, so losing the observer stalls nothing', () => {
  /* "While the configuration is in the unobserved state, fast-start failover
     cannot happen. Therefore, the primary database can continue processing
     transactions, even if the target standby database fails." And "The
     reinstated database acts as the fast-start failover target for the new
     primary database": until the former primary is back there is no target. */

  const rows: [string, TimedEvent[]][] = [
    ['crash @0 (fast-start failover), observer stopped @200', [down(0, PRM), stopObserver(200)]],
    ['switchover @0, observer stopped @100', [{ at: 0, kind: 'cmd.switchover', to: SBY }, stopObserver(100)]],
    ['crash @0, failover, the new primary loses only the observer (dc2-dc3 cut @200)', [down(0, PRM), cut(200, DC2_DC3)]],
    ['crashed primary, clean manual failover @1, observer stopped @200', [down(0, PRM), failover(1), stopObserver(200)]],
    ['manual failover with the old primary open (SBR-06), observer stopped @300', [failover(0), stopObserver(300)]],
  ];

  for (const [label, events] of rows) {
    it(`${label}: the new primary stays open read-write and is never stalled or aborted`, () => {
      const t = simulate(classic(), events);
      expect(t.facts.newPrimary).toBe(SBY);
      expect(endState(t, 'sby01')).toBe('open-rw');
      expect(neverStalledOrAborted(t, 'sby01')).toBe(true);
      expect(finding(t, 'SIM.ONE_ROLE_CHANGE')?.message ?? '').not.toContain('is down');
      /* Said once, as an inference from the two sentences. */
      const d = decisions(t, 'FSFO.NO_TARGET_AFTER_ROLE_CHANGE');
      expect(d).toHaveLength(1);
      expect(d[0]?.taken).toBe(false);
      expect(d[0]?.subject?.id).toBe('sby01');
      expect(d[0]?.claim.basis).toBe('inferred');
      expect(d[0]?.claim.cite).toEqual(['FSFO.REINSTATED_IS_TARGET', 'FSFO.UNOBSERVED_CONTINUES']);
      expect(d[0]?.claim.note).toMatch(/^FSFO\.NO_TARGET_AFTER_ROLE_CHANGE:/);
    });
  }

  it('the lanes the report recorded as stalled and aborted now read open to the end', () => {
    expect(lane(simulate(classic(), rows[0]![1]), 'sby01')).toBe('0:unreachable | 55:open-rw');
    const sw = simulate(classic(), rows[1]![1]);
    expect(lane(sw, 'sby01')).toBe('0:mounted-apply | 28:open-rw');
    /* The new standby is never "aborted" as a primary. */
    expect(lane(sw, 'prm01')).toBe('0:open-rw | 1:converting | 28:mounted-noapply');
  });

  it('the new primary that loses the observer AND its standbys keeps processing transactions', () => {
    /* sby01's whole data centre cut off after the failover: observer and every
       other member out of reach. Nothing can confirm a change of state, and
       nothing needs to: there is no target to fail over to. */
    const t = simulate(classic(), [down(0, PRM), cut(200, DC1_DC2), cut(200, DC2_DC3)]);
    expect(endState(t, 'sby01')).toBe('open-rw');
    expect(neverStalledOrAborted(t, 'sby01')).toBe(true);
    expect(decisions(t, 'FSFO.NO_TARGET_AFTER_ROLE_CHANGE')).toHaveLength(1);
  });

  it('after a switchover the former primary is a standby: never stalled or aborted as a primary', () => {
    /* Everything cut off after the switchover: the old primary, now the
       standby, is out of reach of everyone, and that is all it is. */
    const t = simulate(classic(), [
      { at: 0, kind: 'cmd.switchover', to: SBY }, cut(100, DC1_DC2), cut(100, DC1_DC3), stopObserver(100),
    ]);
    expect(t.facts.newPrimary).toBe(SBY);
    expect(neverStalledOrAborted(t, 'prm01')).toBe(true);
    expect(neverStalledOrAborted(t, 'sby01')).toBe(true);
    expect(endState(t, 'prm01')).not.toBe('open-rw');
  });

  it('a former primary that crashed and restarts after a failover is started and mounted, not an acting primary', () => {
    const t = simulate(classic(), [down(0, PRM), up(100, PRM), stopObserver(200)]);
    expect(lane(t, 'prm01')).toBe('0:down | 100:mounted-noapply');
    expect(neverStalledOrAborted(t, 'prm01')).toBe(true);
  });

  it('leaves the normal phase alone: an isolated primary still stalls, then aborts', () => {
    const t = simulate(classic(), isolate);
    expect(lane(t, 'prm01')).toBe('0:stalled | 30:aborted');
    expect(decision(t, 'PRIMARY.STALL')?.claim.basis).toBe('documented');
    expect(decisions(t, 'FSFO.NO_TARGET_AFTER_ROLE_CHANGE')).toHaveLength(0);
  });

  it('keeps counting down to the abort of a former primary that was stalled when the role changed', () => {
    const t = simulate(classic({ pmyShutdown: false }), isolate);
    expect(lane(t, 'prm01')).toBe('0:stalled');
    expect(endState(t, 'sby01')).toBe('open-rw');
  });
});

/* ---------------- D5 ---------------- */

describe('D5: the old primary after a manual failover with fast-start failover ENABLED stalls, then follows PmyShutdown', () => {
  /* Nothing documented says what it does. The sentences around it: "Data Guard
     fast-start failover always guarantees that only one primary database
     exists"; the STALLED row ends "It shuts down or stalls because it is
     likely a failover has occurred." So it is drawn stalled from the instant its
     target converts, labelled `model`. */

  it('PmyShutdown TRUE: stalled from the completion instant, aborted one FastStartFailoverThreshold later', () => {
    const t = simulate(classic(), [failover(0)]);
    const open = t.facts.tOpen as number;
    expect(lane(t, 'prm01')).toBe(`0:open-rw | ${open}:stalled | ${open + 30}:aborted`);
    expect(endState(t, 'sby01')).toBe('open-rw');
    expect(t.facts.abortAt).toBe(open + 30);

    const abort = decision(t, 'PRIMARY.ABORT');
    expect(abort?.subject?.id).toBe('prm01');
    expect(abort?.at).toBe(open + 30);

    const stalls = decision(t, 'FAILOVER.FORMER_PRIMARY_STALLS');
    expect(stalls?.at).toBe(open);
    expect(stalls?.subject?.id).toBe('prm01');
    expect(stalls?.claim.basis).toBe('model');
    expect(stalls?.claim.cite).toEqual(expect.arrayContaining([
      'FSFO.ONE_PRIMARY_GUARANTEE', 'FSFO.STALLED_LIKELY_FAILOVER', 'FSFO.PMY_SHUTDOWN']));
    expect(stalls?.claim.note).toMatch(/^FAILOVER\.FORMER_PRIMARY_STALLS:/);
    expect(stalls?.claim.note).toContain('is this page\'s model');
    const f = finding(t, 'FAILOVER.FORMER_PRIMARY_STALLS');
    expect(f?.basis).toBe('model');

    /* The documented error is still raised, and the old primary is no longer "open". */
    expect(finding(t, 'FAILOVER.PRIMARY_STILL_OPEN')?.basis).toBe('documented');
    expect(finding(t, 'FAILOVER.FORMER_PRIMARY_OPEN')).toBeUndefined();

    /* A stalled-then-aborted old primary is not two primaries open read-write. */
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(false);
    expect(sb?.windows).toEqual([]);
    expect(sb?.formerAtOpen).toEqual({ kind: 'stalled', abortsAt: open + 30 });
  });

  it('PmyShutdown FALSE: stalled indefinitely, and still not two primaries open', () => {
    const t = simulate(classic({ pmyShutdown: false }), [failover(0)]);
    const open = t.facts.tOpen as number;
    expect(lane(t, 'prm01')).toBe(`0:open-rw | ${open}:stalled`);
    expect(t.facts.abortAt).toBeNull();
    expect(decisions(t, 'PRIMARY.ABORT')).toHaveLength(0);
    const sb = splitBrainOf(t);
    expect(sb?.split.value).toBe(false);
    expect(sb?.formerAtOpen).toEqual({ kind: 'stalled', abortsAt: null });
  });

  it('control, fast-start failover DISABLED: nothing changes, the old primary stays open and split brain reads yes', () => {
    const t = simulate(fsfoOff(classic()), [failover(0)]);
    expect(lane(t, 'prm01')).toBe('0:open-rw');
    const open = finding(t, 'FAILOVER.FORMER_PRIMARY_OPEN');
    expect(open?.basis).toBe('model');
    expect(open?.note).not.toContain('whether or not fast-start failover is enabled');
    expect(finding(t, 'FAILOVER.FORMER_PRIMARY_STALLS')).toBeUndefined();
    expect(splitBrainOf(t)?.split.value).toBe(true);
  });

  it('an old primary that crashes while stalled is down, and a restart afterwards is started and mounted', () => {
    const t = simulate(classic(), [failover(0), down(40, PRM), up(100, PRM)]);
    expect(lane(t, 'prm01')).toBe('0:open-rw | 25:stalled | 40:down | 100:mounted-noapply');
    const f = finding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN');
    expect(f?.basis).toBe('documented');
  });
});

/* ---------------- SIM-16 ---------------- */

describe('SIM-16: reinstatement only of a former primary that can be reached', () => {
  /* "The master observer cannot connect to the former primary database" / "The
     former primary database cannot connect to the new primary database" -- the
     broker cannot reinstate. "the master observer will attempt to reinstate the
     former primary database as a new standby database when a connection to the
     former primary database is reestablished". */

  it('PmyShutdown FALSE, both links cut and never healed: no reinstating band, and the run says why', () => {
    const t = simulate(reinstatable(classic({ pmyShutdown: false })), isolate);
    expect(t.facts.newPrimary).toBe(SBY);
    expect(lane(t, 'prm01')).toBe('0:stalled');
    expect(decision(t, 'REINSTATE.OPEN_BAND')).toBeUndefined();
    const w = decisions(t, 'REINSTATE.WAITING');
    expect(w).toHaveLength(1);
    expect(w[0]?.taken).toBe(false);
    expect(w[0]?.claim.basis).toBe('documented');
    expect(w[0]?.claim.cite).toEqual(expect.arrayContaining([
      'REINSTATE.RESTRICT_OBSERVER_CONNECT', 'REINSTATE.RESTRICT_NEW_PRIMARY_CONNECT']));
  });

  it('P3, PmyShutdown TRUE: the aborted primary waits for a manual restart, said once and documented', () => {
    const t = simulate(reinstatable(classic()), isolate);
    expect(lane(t, 'prm01')).toBe('0:stalled | 30:aborted');
    expect(decision(t, 'REINSTATE.OPEN_BAND')).toBeUndefined();
    const w = decisions(t, 'REINSTATE.WAITING');
    expect(w).toHaveLength(1);
    expect(w[0]?.claim.basis).toBe('documented');
    expect(w[0]?.claim.cite).toContain('REINSTATE.PMY_SHUTDOWN_RESTART');
    expect(w[0]?.claim.value).toContain('must be restarted by hand');
  });

  it('P3, a crashed former primary that is still down: no band', () => {
    const t = simulate(reinstatable(classic()), [down(0, PRM)]);
    expect(t.facts.newPrimary).toBe(SBY);
    expect(lane(t, 'prm01')).toBe('0:down');
    expect(decision(t, 'REINSTATE.OPEN_BAND')).toBeUndefined();
    expect(decisions(t, 'REINSTATE.WAITING')).toHaveLength(1);
  });

  it('a crashed former primary that comes back is reinstated, from the instant it is reachable both ways', () => {
    const t = simulate(reinstatable(classic()), [down(0, PRM), up(100, PRM)]);
    expect(lane(t, 'prm01')).toBe('0:down | 100:reinstating');
    expect(decision(t, 'REINSTATE.OPEN_BAND')?.at).toBe(100);
    expect(decision(t, 'REINSTATE.OPEN_BAND')?.taken).toBe(true);
  });

  it('a stalled primary whose links heal is reinstated at the reconnect (the preconditions are met)', () => {
    const t = simulate(reinstatable(classic({ pmyShutdown: false })), [...isolate, heal(100, DC1_DC2), heal(100, DC1_DC3)]);
    expect(lane(t, 'prm01')).toBe('0:stalled | 100:reinstating');
    expect(decision(t, 'REINSTATE.OPEN_BAND')?.at).toBe(100);
  });

  it('needs the master observer as well as the new primary: reached by the new primary first, reinstated when the observer is too', () => {
    const t = simulate(reinstatable(classic({ pmyShutdown: false })), [...isolate, heal(100, DC1_DC2), heal(200, DC1_DC3)]);
    expect(lane(t, 'prm01')).toBe('0:stalled | 100:mounted-noapply | 200:reinstating');
    expect(decision(t, 'REINSTATE.OPEN_BAND')?.at).toBe(200);
  });

  it('needs the new primary as well as the observer: the observer alone is not enough', () => {
    const t = simulate(reinstatable(classic({ pmyShutdown: false })), [...isolate, heal(100, DC1_DC3)]);
    expect(states(t, 'prm01')).not.toContain('reinstating');
    expect(decision(t, 'REINSTATE.OPEN_BAND')).toBeUndefined();
  });

  it('REINSTATE DATABASE, the command, still draws the band at once', () => {
    const t = simulate(reinstatable(classic({ pmyShutdown: false })), [
      down(0, PRM), up(60, PRM), { at: 70, kind: 'cmd.reinstate', member: CLASSIC_IDS.primary },
    ]);
    expect(states(t, 'prm01')).toContain('reinstating');
  });
});

/* ---------------- SIM-20 ---------------- */

describe('SIM-20: a stalled primary that reconnects is drawn started and mounted, labelled model', () => {
  /* Oracle documents only a RESTARTED former primary: "the database must be
     started and mounted. It will not be allowed to open in any event if
     fast-start failover is enabled." Nothing says a stalled, still-open
     primary is closed when contact returns. */
  const healAll = [...isolate, heal(100, DC1_DC2), heal(100, DC1_DC3)];

  it('Flashback off: the drawing is kept, the label is model with a note', () => {
    const t = simulate(classic({ pmyShutdown: false }), healAll);
    expect(lane(t, 'prm01')).toBe('0:stalled | 100:mounted-noapply');
    const f = finding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN');
    expect(f?.basis).toBe('model');
    expect(f?.cite).toContain('FSFO.FORMER_PRIMARY_NOT_OPEN');
    expect(f?.note).toContain('never restarted');
    expect(f?.note).toContain('No page says a stalled, still-open primary is closed when contact returns');
    expect(f?.ora).toBe('ORA-16649');
  });

  it('a former primary that was restarted stays documented', () => {
    const t = simulate(classic(), [down(0, PRM), up(100, PRM)]);
    expect(finding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN')?.basis).toBe('documented');
    const crashedThenHealed = simulate(classic({ pmyShutdown: false }), [
      ...isolate, down(10, PRM), up(60, PRM), heal(100, DC1_DC2), heal(100, DC1_DC3),
    ]);
    expect(finding(crashedThenHealed, 'FSFO.FORMER_PRIMARY_NOT_OPEN')?.basis).toBe('documented');
  });
});

/* ---------------- D7 / SIM-24 ---------------- */

describe('D7 / SIM-24: a restarted former primary with fast-start failover DISABLED is mounted', () => {
  const restart = [down(0, PRM), failover(5), up(100, PRM)];

  it('26ai: documented, citing Scenario 11', () => {
    const t = simulate(fsfoOff(classic({ version: '26ai' })), restart);
    expect(lane(t, 'prm01')).toBe('0:down | 100:mounted-noapply');
    const f = finding(t, 'FAILOVER.FORMER_PRIMARY_MOUNTED');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('FAILOVER.FORMER_PRIMARY_MOUNTED_26AI');
    expect(f?.note).toContain('ORA-16649');
    expect(f?.note).toContain('The 19c and 21c Scenario 11 pages say none of this');
  });

  it('19c: still the page\'s model, because the 19c Scenario 11 says none of it', () => {
    const t = simulate(fsfoOff(classic({ version: '19c' })), restart);
    expect(lane(t, 'prm01')).toBe('0:down | 100:mounted-noapply');
    const f = finding(t, 'FAILOVER.FORMER_PRIMARY_MOUNTED');
    expect(f?.basis).toBe('model');
    expect(f?.cite).not.toContain('FAILOVER.FORMER_PRIMARY_MOUNTED_26AI');
    expect(f?.note).toContain('FAILOVER.FORMER_PRIMARY_MOUNTED_26AI');
  });

  it('both editions: "cannot reach the new primary, so it is drawn open" stays a model', () => {
    for (const version of ['19c', '26ai'] as const) {
      const t = simulate(fsfoOff(classic({ version })), [...restart.slice(0, 2), cut(50, DC1_DC2), up(100, PRM)]);
      expect(lane(t, 'prm01'), version).toBe('0:down | 100:open-rw');
      const f = finding(t, 'FAILOVER.FORMER_PRIMARY_MOUNTED');
      expect(f?.basis, version).toBe('model');
      expect(f?.message, version).toContain('drawn open, not mounted');
    }
  });

  it('with fast-start failover enabled the state is the documented ORA-16649 in both editions', () => {
    for (const version of ['19c', '26ai'] as const) {
      const t = simulate(classic({ version }), restart);
      expect(finding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN')?.basis, version).toBe('documented');
    }
  });
});
