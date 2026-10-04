/**
 * Regression tests for the simulation findings of the 2026-09-28 fact check
 * (SIMULATOR_FACT_CHECK_2026-09-28.md, section A, plus the engine halves of
 * ED-01 and VAL-04).
 *
 * One block per finding. Each takes the reproduction the report gives and
 * holds the run to the Oracle sentence the report quotes -- the sentence is in
 * the citation catalogue, and the test asks for the citation by id so the two
 * cannot drift apart.
 *
 * The probes in `fact-check/probes.probe.ts` ask "has the behaviour moved?";
 * these ask "is it right?", and they fail the suite when it is not.
 */

import { describe, expect, it } from 'vitest';
import { citation } from '../src/engine/citations';
import type { CitationId } from '../src/engine/citations';
import {
  CLASSIC_IDS, classicTopology, legacyComputeFsfo, PUBLISHED_PAGE,
} from '../src/engine/compat/classic';
import type { ClassicKnobs } from '../src/engine/compat/classic';
import { hostId, memberId, observerId, siteId } from '../src/engine/ids';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import type { EngineTrace } from '../src/engine/sim/simulate';
import type { TimedEvent } from '../src/engine/types/events';
import type { TopologyDoc } from '../src/engine/types/topology';
import { preset } from '../src/presets';
import {
  build, cascadeDoc, db, dest, farSyncDoc, maxProtDoc, multiObserverDoc, multiTargetDoc, observer,
} from './topologies';

/* ---------------- helpers ---------------- */

const PRM = hostId('dc1-prm01');
const SBY = hostId('dc2-sby01');
const OBS = hostId('dc3-obs01');
const DC1_DC2 = CLASSIC_IDS.linkDc1Dc2;
const DC1_DC3 = CLASSIC_IDS.linkDc1Dc3;
const prm01 = memberId('prm01');
const sby01 = memberId('sby01');
const sby02 = memberId('sby02');

const classic = (k: ClassicKnobs = {}): TopologyDoc => classicTopology({ observerLoc: 'dc3', ...k });

const cut = (at: number, link: typeof DC1_DC2): TimedEvent => ({ at, kind: 'link.cut', link });
const heal = (at: number, link: typeof DC1_DC2): TimedEvent => ({ at, kind: 'link.heal', link });
const down = (at: number, host: typeof PRM): TimedEvent => ({ at, kind: 'host.down', host });
const up = (at: number, host: typeof PRM): TimedEvent => ({ at, kind: 'host.up', host });

const states = (t: EngineTrace, id: string): string[] =>
  (t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [])
    .map((s) => s.state as string);
const endState = (t: EngineTrace, id: string): string | undefined => states(t, id).at(-1);
const decision = (t: EngineTrace, id: string) => t.decisions.find((d) => d.id === id);
const finding = (t: EngineTrace, id: string) => t.findings.find((f) => f.id === id);
const promoted = (t: EngineTrace): boolean => !t.facts.blocked && t.facts.newPrimary !== null;
const quote = (id: CitationId): string => citation(id).quote;

const withFlashback = (doc: TopologyDoc): TopologyDoc => {
  for (const m of doc.members) {
    if (m.kind === 'database') { m.flashbackOn = true; m.staticServices = true; }
  }
  doc.config.fsfo.autoReinstate = true;
  return doc;
};

/* ---------------- the sentences ---------------- */

describe('the sentences the outcomes are held to', () => {
  it('are in the catalogue, word for word', () => {
    expect(quote('FSFO.GUARANTEE_STALL')).toContain(
      'either the observer or target standby database may allow the primary database to continue redo generation after first recording that a fast-start failover cannot happen');
    expect(quote('FSFO.STATUS_STALLED')).toContain(
      'cannot be confirmed by either the target standby database or the observer');
    expect(quote('FSFO.CANNOT_NOT_SYNCHRONIZED')).toContain(
      'was not synchronized with the primary database at the time the primary database failed');
    expect(quote('FSFO.CANNOT_OVER_LAG_LIMIT')).toContain(
      'FastStartFailoverLagLimit configuration property at the time the primary database failed');
    expect(quote('FSFO.UNOBSERVED_CONTINUES')).toBe(
      'While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails.');
    expect(quote('OBS.OUTAGE_DIFFERENT_TIMES')).toContain('the outage of both at different times');
    expect(quote('FSFO.RESYNC_RESTORES')).toBe(
      'In maximum availability mode, the ability to automatically failover is restored once the target standby database has received all missing redo data.');
    expect(quote('FSFO.FORMER_PRIMARY_NOT_OPEN')).toContain(
      'It will not be allowed to open in any event if fast-start failover is enabled.');
    expect(quote('FSFO.NO_SECOND_TARGET_26AI')).toBe(
      'Data Guard Broker cannot failover to second fast-start failover target if both the primary and first fast-start failover targets are down.');
    expect(citation('FSFO.NO_SECOND_TARGET_26AI').edition).toBe('26ai');
    expect(quote('SWITCHOVER.FARSYNC_NO_EFFECT')).toContain(
      'Whether the far sync instances are available or unavailable does not affect switchover.');
    expect(quote('OBS.NOT_STARTED_16819')).toContain('the ORA-16819 warning is displayed');
  });
});

/* ---------------- SIM-01 ---------------- */

describe('SIM-01: no fast-start failover to a standby the primary ran without', () => {
  it('19c maximum availability: cut off at 0, crash at 100 -- not synchronized at the time of the failure', () => {
    const t = simulate(classic(), [cut(0, DC1_DC2), down(100, PRM)]);
    expect(promoted(t)).toBe(false);
    expect(t.facts.newPrimary).toBe(null);
    expect(t.facts.blocked).toBe(true);
    expect(t.facts.dataLossKind).toBe('na');
    expect(endState(t, 'sby01')).not.toBe('open-rw');

    /* The primary hangs on the commit for one NET_TIMEOUT and then carries on
       without the standby: that instant is where the state is recorded. */
    expect(states(t, 'prm01')).toEqual(['commit-hang', 'open-rw', 'down']);
    const nr = decision(t, 'FSFO.NOT_READY');
    expect(nr?.at).toBe(30);
    expect(nr?.claim.basis).toBe('model');
    expect(nr?.claim.value).toContain('The master observer records');
    expect(nr?.claim.value).toContain('UNSYNCHRONIZED');
    expect(nr?.claim.cite).toContain('FSFO.GUARANTEE_STALL');
    expect(nr?.claim.note).toContain('when the recording lands is not');

    const gate = decision(t, 'FSFO.READINESS_GATE');
    expect(gate?.taken).toBe(false);
    expect(gate?.at).toBe(130);
    const f = finding(t, 'FSFO.READINESS_GATE');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('FSFO.CANNOT_NOT_SYNCHRONIZED');
    expect(f?.message).toContain('was not synchronized with the primary database at the time the primary database failed');
  });

  it('the latch still holds while nothing new is committed: crash inside the commit hang is zero loss', () => {
    const t = simulate(classic(), [cut(0, DC1_DC2), down(20, PRM)]);
    expect(promoted(t)).toBe(true);
    expect(t.facts.initiateAt).toBe(50);
    expect(decision(t, 'FSFO.NOT_READY')).toBeUndefined();
    const rpo = t.facts.perMember[sby01]?.rpoSeconds;
    expect(rpo?.value).toBe(0);
    expect(rpo?.basis).toBe('documented');
  });

  it('maximum performance: the lag grows while the standby receives nothing, and crosses the limit', () => {
    const doc = (): TopologyDoc => classic({ mode: 'maxperf', logXptMode: 'async', standbyLag: 10 });
    const t = simulate(doc(), [cut(0, DC1_DC2), down(100, PRM)]);
    expect(promoted(t)).toBe(false);
    /* 10 s as configured, limit 30 s: over the limit 20 s after the cut. */
    const nr = decision(t, 'FSFO.NOT_READY');
    expect(nr?.at).toBe(20);
    expect(nr?.claim.value).toContain('TARGET OVER LAG LIMIT');
    expect(nr?.claim.basis).toBe('model');
    const f = finding(t, 'FSFO.READINESS_GATE');
    expect(f?.cite).toContain('FSFO.CANNOT_OVER_LAG_LIMIT');

    /* A crash before the lag reaches the limit still fails over, and the loss
       is what the gate measured -- the lag as it had grown, not as configured. */
    const early = simulate(doc(), [cut(0, DC1_DC2), down(10, PRM)]);
    expect(promoted(early)).toBe(true);
    expect(early.facts.dataLossKind).toBe('bounded');
    expect(early.facts.dataLossSeconds).toBe(20);
    expect(early.facts.perMember[sby01]?.rpoSeconds?.value).toBe(20);
    expect(early.facts.gateLagSeconds).toBe(20);
  });

  it('26ai bounded maximum availability: the lag grows once the commit hang is over', () => {
    const doc = classic({ version: '26ai', lagPolicy: 'bounded', lagLimit: 30, standbyLag: 10 });
    const t = simulate(doc, [cut(0, DC1_DC2), down(100, PRM)]);
    expect(promoted(t)).toBe(false);
    /* Nothing is committed during the 30 s hang; 20 s of growth after it. */
    expect(decision(t, 'FSFO.NOT_READY')?.at).toBe(50);
  });

  it('far sync down at 0, crash at 100: the target stopped receiving redo', () => {
    const t = simulate(farSyncDoc(), [down(0, hostId('dc1-fs01')), down(100, PRM)]);
    expect(promoted(t)).toBe(false);
    const nr = decision(t, 'FSFO.NOT_READY');
    expect(nr?.at).toBe(30);
    /* The primary still reaches the observer and, directly, the standby. */
    expect(states(t, 'prm01')).not.toContain('stalled');
  });

  it('the far sync preset, dc1-dc2 cut at 0, crash at 100', () => {
    const doc = preset('far-sync-zero-loss').doc();
    const t = simulate(doc, [cut(0, DC1_DC2), down(100, hostId('dc1-north'))]);
    expect(promoted(t)).toBe(false);
    expect(t.facts.blocked).toBe(true);
    /* The far sync instance beside the primary keeps acknowledging, so the
       primary never waits: the standby falls behind from the cut itself. */
    expect(decision(t, 'FSFO.NOT_READY')?.at).toBe(0);
    expect(states(t, 'North_Sales')).toEqual(['open-rw', 'down']);
  });
});

/* ---------------- SIM-02 ---------------- */

describe('SIM-02: the primary stalls only while a change of state is left to confirm', () => {
  it('a. the observer is lost first: unobserved, so losing the standby next stalls nothing', () => {
    const t = simulate(classic(), [
      { at: 0, kind: 'observer.stop', observer: CLASSIC_IDS.observer }, cut(50, DC1_DC2),
    ]);
    expect(t.facts.abortAt).toBe(null);
    expect(t.facts.initiateAt).toBe(null);
    expect(states(t, 'prm01')).toEqual(['open-rw', 'commit-hang', 'open-rw']);
    expect(endState(t, 'prm01')).toBe('open-rw');
    expect(decision(t, 'OBS.UNOBSERVED')?.at).toBe(0);
    const d = decision(t, 'PRIMARY.NO_STALL');
    expect(d?.at).toBe(50);
    expect(d?.claim.basis).toBe('documented');
    expect(d?.claim.cite).toContain('FSFO.UNOBSERVED_CONTINUES');
    expect(t.decisions.filter((x) => x.id === 'PRIMARY.NO_STALL')).toHaveLength(1);
    expect(t.facts.unobserved).toBe(true);
  });

  it('a. unobserved is a recorded state: a primary that fails while unobserved is not failed over', () => {
    /* The observer cannot reach the primary but reaches the standby, which is
       PRIMARY UNOBSERVED -- "Is not possible" in the status table. */
    const t = simulate(classic(), [cut(0, DC1_DC3), down(100, PRM)]);
    expect(t.facts.initiateAt).toBe(null);
    expect(t.facts.newPrimary).toBe(null);
    expect(t.facts.outcome).toBe('manual');
  });

  it('a. the observer reaching the primary again ends the unobserved state', () => {
    const t = simulate(classic(), [cut(0, DC1_DC3), heal(40, DC1_DC3), down(100, PRM)]);
    expect(decision(t, 'OBS.OBSERVED_AGAIN')?.at).toBe(40);
    expect(promoted(t)).toBe(true);
    expect(t.facts.initiateAt).toBe(130);
  });

  it('b. the standby is lost first and recorded unsynchronized: losing the observer later stalls nothing', () => {
    const t = simulate(classic(), [cut(0, DC1_DC2), cut(100, DC1_DC3)]);
    expect(t.facts.abortAt).toBe(null);
    expect(t.facts.initiateAt).toBe(null);
    expect(t.facts.newPrimary).toBe(null);
    expect(t.facts.outcome).toBe('continues');
    expect(states(t, 'prm01')).toEqual(['commit-hang', 'open-rw']);
    const d = decision(t, 'PRIMARY.NO_STALL');
    expect(d?.at).toBe(100);
    expect(d?.claim.cite).toContain('OBS.OUTAGE_DIFFERENT_TIMES');
    expect(d?.claim.cite).toContain('FSFO.STATUS_STALLED');
    /* The observer's clock runs out at 130 and nothing is initiated. */
    const np = decision(t, 'FSFO.NOT_POSSIBLE');
    expect(np?.at).toBe(130);
    expect(np?.taken).toBe(false);
  });

  it('b. inside the commit hang the standby is still synchronized, so the second outage does stall', () => {
    const t = simulate(classic(), [cut(0, DC1_DC2), cut(10, DC1_DC3)]);
    expect(states(t, 'prm01')).toEqual(['commit-hang', 'stalled', 'aborted']);
    expect(t.facts.abortAt).toBe(40);
    expect(t.facts.initiateAt).toBe(40);
    expect(promoted(t)).toBe(true);
    expect(t.facts.perMember[sby01]?.rpoSeconds?.value).toBe(0);
  });

  it('c. already over the lag limit: an isolated primary has nothing to confirm', () => {
    const doc = classic({ mode: 'maxperf', logXptMode: 'async', standbyLag: 45 });
    const t = simulate(doc, [cut(0, DC1_DC2), cut(0, DC1_DC3)]);
    expect(t.facts.abortAt).toBe(null);
    expect(t.facts.initiateAt).toBe(null);
    expect(t.facts.conditions.stalled).toBe(false);
    expect(states(t, 'prm01')).toEqual(['open-rw']);
    expect(decision(t, 'PRIMARY.NO_STALL')?.claim.value).toContain('TARGET OVER LAG LIMIT');
  });

  it('the documented stall is untouched: observer and standby lost at the same instant', () => {
    const t = simulate(classic(), [cut(0, DC1_DC2), cut(0, DC1_DC3)]);
    expect(t.facts.conditions.stalled).toBe(true);
    expect(t.facts.abortAt).toBe(30);
    expect(t.facts.initiateAt).toBe(30);
    expect(promoted(t)).toBe(true);
    expect(decision(t, 'PRIMARY.STALL')?.claim.cite).toContain('FSFO.STATUS_STALLED');
  });

  it('losing the observer alone, or the standby alone, never stalls', () => {
    for (const events of [[down(0, OBS)], [down(0, SBY)], [cut(0, DC1_DC2)], [cut(0, DC1_DC3)]]) {
      const t = simulate(classic(), events);
      expect(states(t, 'prm01'), JSON.stringify(events)).not.toContain('stalled');
      expect(t.facts.abortAt, JSON.stringify(events)).toBe(null);
    }
  });
});

/* ---------------- VAL-04, engine half ---------------- */

describe('VAL-04: fast-start failover enabled with no observer is unobserved, not disabled', () => {
  const noObserver = (state: 'enabled' | 'disabled'): TopologyDoc => {
    const prm = db('prm01', ['dc1-prm01'], 'primary');
    const sby = db('sby01', ['dc2-sby01'], 'physical');
    dest(prm, sby.id);
    return build({
      fsfo: state, sites: ['dc1', 'dc2'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2']],
      members: [prm, sby], observers: [], targets: [sby.id],
    });
  };

  it('raises the ORA-16819 warning and reads unobserved', () => {
    const t = simulate(noObserver('enabled'), [{ at: 0, kind: 'lag.set', member: sby01, applyLag: 5 }]);
    expect(finding(t, 'OBS.NOT_STARTED')?.ora).toBe('ORA-16819');
    expect(t.facts.unobserved).toBe(true);
    expect(t.facts.outcome).toBe('observer-lost');
  });

  it('an observer that is deployed and not running is the same state', () => {
    const doc = classic();
    doc.observers[0]!.running = false;
    const t = simulate(doc, [down(0, SBY)]);
    expect(finding(t, 'OBS.NOT_STARTED')).toBeDefined();
    expect(states(t, 'prm01')).not.toContain('stalled');
  });

  it('disabled is disabled: no warning, nothing unobserved', () => {
    const t = simulate(noObserver('disabled'), [down(0, SBY)]);
    expect(finding(t, 'OBS.NOT_STARTED')).toBeUndefined();
    expect(t.facts.unobserved).toBe(false);
  });

  it('the published page\'s "no observer" is fast-start failover disabled, so its cells do not move', () => {
    expect(classicTopology({ observerLoc: 'none' }).config.fsfo.state).toBe('disabled');
    expect(legacyComputeFsfo({ observerLoc: 'none', scenario: 'dc2down' }).outcome).toBe('continues');
  });
});

/* ---------------- SIM-03 ---------------- */

describe('SIM-03: a former primary never opens beside the new one', () => {
  it('crash, failover, the host returns: mounted and requiring reinstatement', () => {
    const t = simulate(classic(), [down(0, PRM), up(100, PRM)]);
    expect(promoted(t)).toBe(true);
    expect(states(t, 'prm01')).toEqual(['down', 'mounted-noapply']);
    expect(states(t, 'prm01')).not.toContain('open-rw');
    const f = finding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN');
    expect(f?.basis).toBe('documented');
    expect(f?.ora).toBe('ORA-16649');
    expect(f?.cite).toContain('FSFO.FORMER_PRIMARY_NOT_OPEN');
    expect(f?.message).toContain('REINSTATE REQUIRED');
  });

  it('no redo edge reaches a member that needs reinstating, and it acknowledges nothing', () => {
    const t = simulate(classic(), [down(0, PRM), up(100, PRM)]);
    const last = t.epochs.at(-1)!;
    expect(last.primary).toBe(sby01);
    expect(last.redo.edges.filter((e) => e.to === prm01 && e.active)).toEqual([]);
    expect(last.redo.members[prm01]?.reachableFromPrimary).toBe(false);
    expect(last.protectionLevel.value).not.toBe('MAXAVAILABILITY');
  });

  it('a stalled primary that was never aborted, its links healed after the failover', () => {
    const t = simulate(classic({ pmyShutdown: false }), [
      cut(0, DC1_DC2), cut(0, DC1_DC3), heal(100, DC1_DC2), heal(100, DC1_DC3),
    ]);
    expect(promoted(t)).toBe(true);
    expect(states(t, 'prm01')).toEqual(['stalled', 'mounted-noapply']);
  });

  it('with Flashback Database and auto-reinstate the band is the reinstatement', () => {
    const t = simulate(withFlashback(classic()), [down(0, PRM), up(100, PRM)]);
    expect(states(t, 'prm01')).toEqual(['down', 'reinstating']);
    expect(decision(t, 'REINSTATE.OPEN_BAND')?.taken).toBe(true);
  });

  it('a host that returns while the failover is executing does not open either', () => {
    const t = simulate(classic(), [down(0, PRM), up(40, PRM)]);
    expect(t.facts.initiateAt).toBe(30);
    expect(states(t, 'prm01')).not.toContain('open-rw');
  });

  it('a crashed primary back BEFORE any role change is drawn open at once, and says that is the model', () => {
    const t = simulate(classic(), [down(0, PRM), up(10, PRM)]);
    expect(t.facts.newPrimary).toBe(null);
    expect(states(t, 'prm01')).toEqual(['down', 'open-rw']);
    const d = decision(t, 'PRIMARY.REOPEN');
    expect(d?.at).toBe(10);
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.cite).toContain('OBS.RESTART_NEEDS_PERMISSION');
    expect(finding(t, 'PRIMARY.REOPEN_INSTANT')?.basis).toBe('model');
  });
});

/* ---------------- SIM-04 ---------------- */

describe('SIM-04: a role change needs the members it names', () => {
  const sw = (at: number): TimedEvent => ({ at, kind: 'cmd.switchover', to: CLASSIC_IDS.standby });
  const fo = (at: number): TimedEvent => ({ at, kind: 'cmd.failover', to: CLASSIC_IDS.standby });

  const refusedSwitchover = (t: EngineTrace, text: string): void => {
    expect(t.facts.outcome).toBe('switchover');
    expect(t.facts.blocked).toBe(true);
    expect(t.facts.newPrimary).toBe(null);
    expect(decision(t, 'SWITCHOVER.GATE')?.taken).toBe(false);
    const f = finding(t, 'SWITCHOVER.REFUSED');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain(text);
    expect(states(t, 'sby01')).not.toContain('open-rw');
    expect(states(t, 'sby01')).not.toContain('converting');
    expect(states(t, 'prm01')).not.toContain('converting');
  };

  it('SWITCHOVER TO a standby whose host is down is refused', () => {
    for (const loc of ['dc3', 'none'] as const) {
      refusedSwitchover(simulate(classic({ observerLoc: loc }), [down(0, SBY), sw(5)]), 'sby01 is down');
    }
  });

  it('SWITCHOVER while the two cannot reach each other is refused', () => {
    const t = simulate(classic({ observerLoc: 'none' }), [cut(0, DC1_DC2), sw(5)]);
    refusedSwitchover(t, 'cannot reach each other');
    expect(finding(t, 'SWITCHOVER.REFUSED')?.cite).toContain('SWITCHOVER.FARSYNC_NO_EFFECT');
  });

  it('SWITCHOVER with the primary down is refused', () => {
    refusedSwitchover(simulate(classic({ observerLoc: 'none' }), [down(0, PRM), sw(5)]), 'the primary is down');
  });

  it('FAILOVER TO a standby whose host is down is refused, and the readout reads blocked', () => {
    const t = simulate(classic({ observerLoc: 'none' }), [down(0, PRM), down(0, SBY), fo(5)]);
    expect(t.facts.newPrimary).toBe(null);
    expect(t.facts.blocked).toBe(true);
    expect(decision(t, 'FSFO.MANUAL_FAILOVER')?.taken).toBe(false);
    const f = finding(t, 'FAILOVER.TARGET_DOWN');
    expect(f?.severity).toBe('error');
    expect(f?.basis).toBe('model');
    expect(states(t, 'sby01')).toEqual(['down']);
  });

  it('the same commands against members that are up still go through', () => {
    expect(promoted(simulate(classic(), [sw(5)]))).toBe(true);
    expect(promoted(simulate(classic({ observerLoc: 'none' }), [down(0, PRM), fo(5)]))).toBe(true);
  });
});

/* ---------------- SIM-06 ---------------- */

describe('SIM-06: what a manual failover loses', () => {
  it('no observer: cut off at 0, crash at 100, FAILOVER at 120 -- never "none"', () => {
    const t = simulate(classic({ observerLoc: 'none' }), [
      cut(0, DC1_DC2), down(100, PRM), { at: 120, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
    ]);
    expect(promoted(t)).toBe(true);
    expect(t.facts.dataLossKind).toBe('manual');
    /* 30 s of commit hang, then 70 s of redo the standby never received. */
    expect(t.facts.dataLossSeconds).toBe(70);
    const rpo = t.facts.perMember[sby01]?.rpoSeconds;
    expect(rpo?.value).toBe(70);
    expect(rpo?.basis).toBe('model');
    expect(rpo?.cite).toContain('FAILOVER.LOSS_DEPENDS');
    expect(rpo?.note).toContain('70 s the primary generated redo this standby never received');
  });

  it('after a refused fast-start failover: disable it, fail over by hand, and the loss is what the standby missed', () => {
    const t = simulate(classic(), [
      cut(0, DC1_DC2), down(100, PRM),
      { at: 140, kind: 'cmd.disableFsfo', force: true },
      { at: 150, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
    ]);
    /* Refused at the threshold, because the standby was not synchronized ... */
    expect(decision(t, 'FSFO.READINESS_GATE')?.taken).toBe(false);
    /* ... and promoted by the operator, who takes the loss with it. */
    expect(t.facts.outcome).toBe('manual');
    expect(t.facts.blocked).toBe(false);
    expect(t.facts.newPrimary).toBe(sby01);
    expect(t.facts.dataLossKind).toBe('manual');
    expect(t.facts.perMember[sby01]?.rpoSeconds?.value).toBe(70);
    /* With fast-start failover still enabled the same command is refused. */
    const kept = simulate(classic(), [
      cut(0, DC1_DC2), down(100, PRM), { at: 150, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
    ]);
    expect(finding(kept, 'FSFO.MANUAL_FAILOVER_NOT_READY')).toBeDefined();
    expect(kept.facts.newPrimary).toBe(null);
    expect(kept.facts.blocked).toBe(true);
  });

  it('never labels a manual failover\'s loss documented, zero or not', () => {
    const t = simulate(classic({ observerLoc: 'none' }), [
      down(0, PRM), { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
    ]);
    const rpo = t.facts.perMember[sby01]?.rpoSeconds;
    expect(rpo?.value).toBe(0);
    expect(rpo?.basis).toBe('model');
    expect(rpo?.note).toContain('not that a manual failover is lossless');
  });

  it('maximum performance: the number is redo not received, not the apply lag', () => {
    const doc = classic({ observerLoc: 'none', mode: 'maxperf', logXptMode: 'async', standbyLag: 42, transportLag: 3 });
    const t = simulate(doc, [down(0, PRM), { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }]);
    expect(t.facts.dataLossSeconds).toBe(3);
    /* The published page keeps its own reading, through the adapter's switch. */
    const legacy = simulate(doc, [down(0, PRM)], PUBLISHED_PAGE);
    expect(legacy.facts.dataLossSeconds).toBe(42);
  });
});

/* ---------------- SIM-07 ---------------- */

describe('SIM-07: a manual failover with the primary still open', () => {
  const fo = (immediate?: boolean): TimedEvent => immediate === undefined
    ? { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }
    : { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby, immediate };

  it('raises the documented error, with and without fast-start failover', () => {
    for (const loc of ['dc3', 'none'] as const) {
      const t = simulate(classic({ observerLoc: loc }), [fo()]);
      const f = finding(t, 'FAILOVER.PRIMARY_STILL_OPEN');
      expect(f?.severity, loc).toBe('error');
      expect(f?.basis, loc).toBe('documented');
      expect(f?.cite, loc).toContain('FAILOVER.PRIMARY_SHUT_DOWN');
      expect(f?.message, loc).toContain('ensure that the primary database is shut down');
      expect(endState(t, 'sby01'), loc).toBe('open-rw');
      if (loc === 'none') {
        /* Fast-start failover disabled: nothing documented closes the old
           primary, so it stays open beside the new one: the two are both open
           at the end of the run, and the run says that drawing is its own
           reading. */
        expect(endState(t, 'prm01'), loc).toBe('open-rw');
        const open = finding(t, 'FAILOVER.FORMER_PRIMARY_OPEN');
        expect(open?.basis, loc).toBe('model');
        expect(open?.cite, loc).toEqual(['FAILOVER.PRIMARY_SHUT_DOWN', 'FSFO.MANUAL_FAILOVER_CONDITIONS']);
        expect(open?.note, loc).toMatch(/^FAILOVER\.FORMER_PRIMARY_OPEN:/);
      } else {
        /* Fast-start failover enabled (owner decision D5, 2026-10-01): the old
           primary has lost its target, so it is stalled and then follows
           FastStartFailoverPmyShutdown -- a model, not a documented outcome. */
        expect(endState(t, 'prm01'), loc).toBe('aborted');
        expect(finding(t, 'FAILOVER.FORMER_PRIMARY_OPEN'), loc).toBeUndefined();
        expect(finding(t, 'FAILOVER.FORMER_PRIMARY_STALLS')?.basis, loc).toBe('model');
      }
      expect(finding(t, 'FAILOVER.FORMER_PRIMARY_MOUNTED'), loc).toBeUndefined();
    }
  });

  it('with the primary shut down first the error is not raised', () => {
    const t = simulate(classic(), [down(0, PRM), fo()]);
    expect(finding(t, 'FAILOVER.PRIMARY_STILL_OPEN')).toBeUndefined();
    expect(promoted(t)).toBe(true);
  });

  it('IMMEDIATE is refused while fast-start failover is enabled', () => {
    const t = simulate(classic(), [down(0, PRM), fo(true)]);
    const f = finding(t, 'FAILOVER.IMMEDIATE_WITH_FSFO');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('you cannot perform an immediate manual failover when fast-start failover is enabled');
    expect(decision(t, 'FSFO.MANUAL_FAILOVER')?.taken).toBe(false);
    expect(decision(t, 'FSFO.MANUAL_FAILOVER')?.at).toBe(5);
    /* The command changed nothing; the observer fails over at the threshold. */
    expect(t.facts.initiateAt).toBe(30);
  });

  it('IMMEDIATE with fast-start failover disabled applies none of the redo it holds', () => {
    const t = simulate(classic({ observerLoc: 'none' }), [down(0, PRM), fo(true)]);
    expect(promoted(t)).toBe(true);
    expect(t.facts.tOpen).toBe(5 + 15);
    expect(simulate(classic({ observerLoc: 'none' }), [down(0, PRM), fo(false)]).facts.tOpen).toBe(5 + 10 + 15);
  });
});

/* ---------------- SIM-08 ---------------- */

describe('SIM-08: with fast-start failover enabled, only the current target', () => {
  it('SWITCHOVER TO a candidate that is not the current target is ORA-16655', () => {
    const t = simulate(multiTargetDoc(), [{ at: 0, kind: 'cmd.switchover', to: sby02 }]);
    expect(t.facts.blocked).toBe(true);
    expect(t.facts.newPrimary).toBe(null);
    const f = finding(t, 'SWITCHOVER.REFUSED');
    expect(f?.ora).toBe('ORA-16655');
    expect(f?.cite).toContain('ORA.16655');
    expect(f?.cite).toContain('SWITCHOVER.FSFO_TARGET_ONLY');
    expect(f?.message).toContain('sby02 is not the current fast-start failover target (sby01 is)');
  });

  it('to the current target it goes through', () => {
    expect(promoted(simulate(multiTargetDoc(), [{ at: 0, kind: 'cmd.switchover', to: sby01 }]))).toBe(true);
  });

  it('once the target has changed, the new target is the one', () => {
    const t = simulate(multiTargetDoc(), [
      { at: 0, kind: 'site.down', site: siteId('dc2') },
      { at: 5, kind: 'cmd.switchover', to: sby02 },
    ]);
    expect(decision(t, 'FSFO.TARGET_CHANGE')?.subject?.id).toBe('sby02');
    expect(promoted(t)).toBe(true);
    expect(t.facts.newPrimary).toBe(sby02);
  });

  it('FAILOVER TO a candidate that is not the current target is refused', () => {
    const t = simulate(multiTargetDoc(), [down(0, PRM), { at: 5, kind: 'cmd.failover', to: sby02 }]);
    expect(finding(t, 'FSFO.MANUAL_FAILOVER_NOT_TARGET')?.cite).toContain('FAILOVER.CURRENT_TARGET_ONLY');
    expect(decision(t, 'FSFO.MANUAL_FAILOVER')?.taken).toBe(false);
    expect(t.facts.newPrimary).not.toBe(sby02);
  });

  it('disabled, any standby may be named', () => {
    const doc = multiTargetDoc();
    doc.config.fsfo.state = 'disabled';
    expect(simulate(doc, [{ at: 0, kind: 'cmd.switchover', to: sby02 }]).facts.newPrimary).toBe(sby02);
  });
});

/* ---------------- SIM-09 ---------------- */

describe('SIM-09: a far sync hop is not a cascade', () => {
  for (const edition of ['19c', '26ai'] as const) {
    it(`${edition}: the far-sync-role-change preset's own switchover goes through, unremarked`, () => {
      const p = preset('far-sync-role-change');
      const doc = p.doc();
      doc.config.edition = edition;
      const t = simulate(doc, p.events());
      expect(t.facts.blocked).toBe(false);
      expect(promoted(t)).toBe(true);
      expect(finding(t, 'SWITCHOVER.TO_TERMINAL_UNDOC')).toBeUndefined();
      expect(finding(t, 'SWITCHOVER.REFUSED')).toBeUndefined();
    });

    it(`${edition}: a target fed through a far sync instance switches over`, () => {
      const doc = farSyncDoc();
      doc.config.edition = edition;
      const t = simulate(doc, [{ at: 0, kind: 'cmd.switchover', to: sby01 }]);
      expect(promoted(t)).toBe(true);
      expect(finding(t, 'SWITCHOVER.TO_TERMINAL_UNDOC')).toBeUndefined();
    });
  }

  it('a real cascade still says the documentation does not cover it', () => {
    const doc = cascadeDoc();
    doc.config.fsfo.state = 'disabled';
    const t = simulate(doc, [{ at: 0, kind: 'cmd.switchover', to: memberId('remote_sby') }]);
    expect(finding(t, 'SWITCHOVER.TO_TERMINAL_UNDOC')?.basis).toBe('model');
  });

  it('with fast-start failover disabled the far sync being down does not affect the switchover', () => {
    const doc = farSyncDoc();
    doc.config.fsfo.state = 'disabled';
    const t = simulate(doc, [down(0, hostId('dc1-fs01')), { at: 5, kind: 'cmd.switchover', to: sby01 }]);
    expect(t.facts.blocked).toBe(false);
    expect(promoted(t)).toBe(true);
  });
});

/* ---------------- SIM-10 ---------------- */

describe('SIM-10: one role change per run, and the run says so', () => {
  const expectDisclosed = (t: EngineTrace, at: number): void => {
    const f = finding(t, 'SIM.ONE_ROLE_CHANGE');
    expect(f?.basis).toBe('model');
    expect(f?.severity).toBe('warning');
    expect(f?.cite).toContain('FSFO.REINSTATED_IS_TARGET');
    expect(f?.note).toContain('this page evaluates one role change per run');
    expect(f?.note).toContain('the reinstated database acts as the fast-start failover target for the new primary database');
    expect(f?.message).toContain('not as an Oracle outcome');
    const d = decision(t, 'SIM.ONE_ROLE_CHANGE');
    expect(d?.at).toBe(at);
    expect(d?.taken).toBe(false);
    expect(d?.claim.basis).toBe('model');
  };

  it('switchover, then the new primary crashes', () => {
    const t = simulate(classic(), [
      { at: 0, kind: 'cmd.switchover', to: CLASSIC_IDS.standby }, down(100, SBY),
    ]);
    expect(t.facts.outcome).toBe('switchover');
    expectDisclosed(t, 100);
  });

  it('failover, reinstatement under way, then the new primary crashes', () => {
    const t = simulate(withFlashback(classic()), [down(0, PRM), up(60, PRM), down(200, SBY)]);
    expect(t.facts.newPrimary).toBe(sby01);
    expectDisclosed(t, 200);
    /* Still one role change: nothing was promoted a second time. */
    expect(endState(t, 'prm01')).not.toBe('open-rw');
  });

  it('a second command is not simulated either', () => {
    const t = simulate(classic(), [
      { at: 0, kind: 'cmd.switchover', to: CLASSIC_IDS.standby },
      { at: 100, kind: 'cmd.switchover', to: CLASSIC_IDS.primary },
    ]);
    expectDisclosed(t, 100);
    expect(t.facts.newPrimary).toBe(sby01);
    expect(t.facts.tOpen).toBe(28);
    expect(endState(t, 'sby01')).toBe('open-rw');
  });

  it('a run with one role change and nothing after it raises nothing', () => {
    expect(finding(simulate(classic(), [down(0, PRM)]), 'SIM.ONE_ROLE_CHANGE')).toBeUndefined();
  });
});

/* ---------------- SIM-11 ---------------- */

describe('SIM-11: resynchronization is drawn as immediate, and labelled', () => {
  const t = simulate(classic(), [down(0, SBY), up(50, SBY), down(60, PRM)]);

  it('the standby is not ready while the primary runs without it', () => {
    expect(decision(t, 'FSFO.NOT_READY')?.at).toBe(30);
    const before = simulate(classic(), [down(0, SBY), down(40, PRM), up(45, SBY)]);
    expect(promoted(before)).toBe(false);
  });

  it('says the instant return is this page\'s model, with the 19c sentence', () => {
    const d = decision(t, 'FSFO.RESYNC');
    expect(d?.at).toBe(50);
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.cite).toEqual(['FSFO.RESYNC_RESTORES']);
    expect(d?.claim.note).toContain('the ability to automatically failover is restored once the target standby database has received all missing redo data');
    expect(d?.claim.note).toContain('environment-dependent');
    expect(d?.claim.note).toContain('20 s of redo generation had not been received');
    const f = finding(t, 'FSFO.RESYNC_INSTANT');
    expect(f?.basis).toBe('model');
    expect(f?.severity).toBe('info');
  });

  it('a failover after it carries the model label on its zero', () => {
    expect(promoted(t)).toBe(true);
    const rpo = t.facts.perMember[sby01]?.rpoSeconds;
    expect(rpo?.value).toBe(0);
    expect(rpo?.basis).toBe('model');
    expect(rpo?.cite).toContain('FSFO.RESYNC_RESTORES');
  });
});

/* ---------------- SIM-12 ---------------- */

describe('SIM-12: degraded maximum availability', () => {
  it('reads MAXPERFORMANCE as this page\'s model, and quotes the sentence', () => {
    const t = simulate(classic(), [down(0, SBY)]);
    const level = t.epochs.at(-1)!.protectionLevel;
    expect(level.value).toBe('MAXPERFORMANCE');
    expect(level.basis).toBe('model');
    expect(level.cite).toContain('MAXAVAIL.AT_LEAST_ONE');
    expect(level.cite).toContain('LEVEL.RESYNCHRONIZATION');
    expect(level.note).toContain('operates as if it were in maximum performance mode');
    expect(level.note).toContain('RESYNCHRONIZATION');
    expect(level.note).not.toContain('the broker reports');
    expect(t.facts.protectionLevel.basis).toBe('model');
  });

  it('leaves every level that is not a degradation alone', () => {
    const t = simulate(classic(), [{ at: 0, kind: 'lag.set', member: sby01, applyLag: 5 }]);
    expect(t.epochs[0]!.protectionLevel.value).toBe('MAXAVAILABILITY');
    expect(t.epochs[0]!.protectionLevel.basis).toBe('documented');
    const perf = simulate(classic({ mode: 'maxperf', logXptMode: 'async' }), [down(0, SBY)]);
    expect(perf.epochs.at(-1)!.protectionLevel.basis).toBe('documented');
  });
});

/* ---------------- SIM-13 ---------------- */

describe('SIM-13: zero loss across a far sync hop', () => {
  it('is this page\'s model while the far sync is there to forward', () => {
    const t = simulate(farSyncDoc(), [down(0, PRM)]);
    expect(promoted(t)).toBe(true);
    expect(t.facts.dataLossKind).toBe('none');
    const rpo = t.facts.perMember[sby01]?.rpoSeconds;
    expect(rpo?.value).toBe(0);
    expect(rpo?.basis).toBe('model');
    expect(rpo?.note).toContain('SYNC.ACROSS_FARSYNC');
  });

  it('is not claimed at all when the far sync is lost with the primary', () => {
    const t = simulate(farSyncDoc(), [{ at: 0, kind: 'site.down', site: siteId('dc1') }]);
    expect(promoted(t)).toBe(true);
    expect(t.facts.dataLossKind).toBe('unknown');
    const rpo = t.facts.perMember[sby01]?.rpoSeconds;
    expect(rpo?.basis).toBe('model');
    expect(rpo?.note).toContain('FAILOVER.LOSS_FARSYNC_GONE');
    expect(rpo?.note).toContain('a floor and not a bound');
  });

  it('a direct SYNC standby keeps its documented zero', () => {
    const rpo = simulate(classic(), [down(0, PRM)]).facts.perMember[sby01]?.rpoSeconds;
    expect(rpo?.value).toBe(0);
    expect(rpo?.basis).toBe('documented');
  });
});

/* ---------------- SIM-14 ---------------- */

describe('SIM-14a: nomination when the primary loses its connection to a live master', () => {
  it('nominates a backup the primary still reaches', () => {
    const doc = multiObserverDoc();
    const t = simulate(doc, [cut(5, DC1_DC3)]);
    const d = decision(t, 'NOMINATION.NEW_MASTER');
    expect(d?.at).toBe(5);
    expect(d?.claim.cite).toContain('OBS.NOMINATION_PRECONDITION');
    expect(t.facts.observers[observerId('obs02')]?.endState).toBe('master');
    /* obs01 is alive and well; it is just not the master any more. */
    expect(t.facts.observers[observerId('obs01')]?.endState).toBe('backup');
    expect(t.facts.unobserved).toBe(false);
  });

  it('never when the primary has lost the target standby as well', () => {
    const doc = multiObserverDoc();
    const t = simulate(doc, [cut(5, DC1_DC3), cut(5, DC1_DC2)]);
    expect(decision(t, 'NOMINATION.NEW_MASTER')).toBeUndefined();
    expect(t.facts.observers[observerId('obs02')]?.endState).toBe('backup');
  });

  it('with no backup in reach the configuration is unobserved and the master keeps the role', () => {
    const t = simulate(classic(), [cut(5, DC1_DC3)]);
    expect(decision(t, 'OBS.UNOBSERVED')?.at).toBe(5);
    expect(t.facts.observers[CLASSIC_IDS.observer]?.endState).toBe('lost-primary');
  });
});

describe('SIM-14c: BystandersFollowRoleChange', () => {
  const lagging = (): TopologyDoc => {
    const doc = multiTargetDoc();
    doc.config.protectionMode = 'MAXPERFORMANCE';
    for (const m of doc.members) m.logXptMode = 'ASYNC';
    doc.members[1]!.transportLagSeconds = 4;
    doc.members[2]!.transportLagSeconds = 1;
    return doc;
  };

  it('ALL disables a bystander that is ahead of the new primary, with ORA-16661', () => {
    const t = simulate(lagging(), [down(0, PRM)]);
    expect(t.facts.newPrimary).toBe(sby01);
    expect(endState(t, 'sby02')).toBe('disabled');
    const f = finding(t, 'BYSTANDERS.AHEAD_DISABLED');
    expect(f?.ora).toBe('ORA-16661');
    expect(f?.cite).toContain('BYSTANDERS.ALL_AHEAD_DISABLED');
    /* That it is disabled is documented; which one is ahead is arithmetic. */
    expect(f?.basis).toBe('model');
  });

  it('ALL leaves a bystander that is behind alone', () => {
    const doc = lagging();
    doc.members[2]!.transportLagSeconds = 9;
    const t = simulate(doc, [down(0, PRM)]);
    expect(endState(t, 'sby02')).not.toBe('disabled');
    expect(finding(t, 'BYSTANDERS.AHEAD_DISABLED')).toBeUndefined();
  });

  it('words ALL and NONE the way the property page does', () => {
    const all = decision(simulate(multiTargetDoc(), [down(0, PRM)]), 'BYSTANDERS.FOLLOW');
    expect(all?.claim.note).toContain('ahead of or behind the failover target');
    expect(all?.claim.note).toContain('disabled with a status of ORA-16661');
    const doc = multiTargetDoc();
    doc.config.bystandersFollowRoleChange = 'NONE';
    const none = decision(simulate(doc, [down(0, PRM)]), 'BYSTANDERS.FOLLOW');
    expect(none?.claim.note).toContain('marked as disabled with a status of ORA-16661 so that they can be evaluated later');
    expect(none?.claim.cite).toContain('BYSTANDERS.NONE_DISABLED');
  });
});

describe('SIM-14d: the protection mode after a failover out of maximum protection', () => {
  const levelAfter = (t: EngineTrace) => decision(t, 'PROT.MODE_AFTER_FAILOVER');
  const manual = (edition: '19c' | '26ai', fsfo: 'enabled' | 'disabled'): EngineTrace => {
    const doc = maxProtDoc();
    doc.config.edition = edition;
    doc.config.fsfo.state = fsfo;
    return simulate(doc, [down(0, PRM), { at: 5, kind: 'cmd.failover', to: sby01 }]);
  };

  it('fast-start failover: the new primary is set to maximum availability', () => {
    for (const edition of ['19c', '26ai'] as const) {
      const doc = maxProtDoc();
      doc.config.edition = edition;
      const t = simulate(doc, [down(0, PRM)]);
      const d = levelAfter(t);
      expect(d?.claim.value, edition).toContain('MAXAVAILABILITY');
      expect(d?.claim.basis, edition).toBe('documented');
      expect(d?.claim.cite, edition).toEqual(['MODE.AFTER_FSFO_MAXPROT']);
      /* And it does not shut itself down for want of a standby. */
      expect(endState(t, 'sby01'), edition).toBe('open-rw');
      expect(t.facts.abortAt, edition).toBe(null);
    }
  });

  it('manual, fast-start failover disabled: reset to maximum performance, in both editions', () => {
    for (const edition of ['19c', '26ai'] as const) {
      const t = manual(edition, 'disabled');
      expect(levelAfter(t)?.claim.value, edition).toContain('MAXPERFORMANCE');
      expect(levelAfter(t)?.claim.cite, edition).toEqual(['MODE.AFTER_MANUAL_MAXPROT']);
      expect(t.epochs.at(-1)!.protectionLevel.value, edition).toBe('MAXPERFORMANCE');
      expect(endState(t, 'sby01'), edition).toBe('open-rw');
    }
  });

  it('manual, fast-start failover enabled: 26ai sets maximum availability, 19c only says preserved', () => {
    expect(levelAfter(manual('26ai', 'enabled'))?.claim.value).toContain('MAXAVAILABILITY');
    expect(levelAfter(manual('26ai', 'enabled'))?.claim.cite).toEqual(['MODE.AFTER_MANUAL_FSFO_26AI']);
    expect(levelAfter(manual('19c', 'enabled'))?.claim.value).toContain('MAXPROTECTION');
  });

  it('every other mode is left as it was', () => {
    expect(levelAfter(simulate(classic(), [down(0, PRM)]))).toBeUndefined();
  });
});

describe('SIM-14e: REINSTATE DATABASE', () => {
  const reinstate = (at: number): TimedEvent =>
    ({ at, kind: 'cmd.reinstate', member: CLASSIC_IDS.primary });

  it('without Flashback Database draws no band and raises the precondition', () => {
    const t = simulate(classic(), [down(0, PRM), up(100, PRM), reinstate(110)]);
    expect(states(t, 'prm01')).not.toContain('reinstating');
    expect(endState(t, 'prm01')).toBe('mounted-noapply');
    const f = finding(t, 'REINSTATE.COMMAND_PRECONDITIONS');
    expect(f?.severity).toBe('error');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('REINSTATE.NEEDS_FLASHBACK');
    expect(f?.message).toContain('Flashback Database must have been enabled on the database prior to the failover');
    expect(decision(t, 'REINSTATE.COMMAND')?.taken).toBe(false);
  });

  it('with Flashback Database, after a manual failover, draws the band from the command', () => {
    const doc = withFlashback(classic({ observerLoc: 'none' }));
    const t = simulate(doc, [
      down(0, PRM), { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }, up(100, PRM), reinstate(110),
    ]);
    expect(states(t, 'prm01')).toEqual(['down', 'mounted-noapply', 'reinstating']);
    expect(decision(t, 'REINSTATE.COMMAND')?.at).toBe(110);
    expect(decision(t, 'REINSTATE.COMMAND')?.claim.basis).toBe('model');
  });

  it('needs the database started and in reach of the new primary', () => {
    const t = simulate(withFlashback(classic({ observerLoc: 'none' })), [
      down(0, PRM), { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }, reinstate(110),
    ]);
    expect(finding(t, 'REINSTATE.COMMAND_PRECONDITIONS')?.message).toContain('is not started and mounted');
    expect(states(t, 'prm01')).toEqual(['down']);
  });

  it('on a database no failover left behind it does nothing', () => {
    const t = simulate(withFlashback(classic()), [reinstate(5)]);
    expect(finding(t, 'REINSTATE.NOTHING_TO_REINSTATE')).toBeDefined();
    expect(states(t, 'prm01')).toEqual(['open-rw']);
    const sb = simulate(withFlashback(classic()), [{ at: 5, kind: 'cmd.reinstate', member: CLASSIC_IDS.standby }]);
    expect(states(sb, 'sby01')).not.toContain('reinstating');
  });
});

/* ---------------- ED-01 ---------------- */

describe('ED-01: the ObserverPing properties do not exist in 19c', () => {
  it('a 19c document detects on the threshold and says why', () => {
    const t = simulate(classic({ version: '19c', pingSet: true }), [down(0, PRM)]);
    expect(t.facts.initiateAt).toBe(30);
    expect(t.facts.pingSet).toBe(false);
    expect(decision(t, 'FSFO.PING_ARITHMETIC')).toBeUndefined();
    const f = finding(t, 'FSFO.PING_NOT_IN_19C');
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('doc-later');
    expect(f?.cite).toContain('FSFO.PING_PROPS_21C');
    expect(f?.message).toContain('not available in Oracle Database 19c');
    expect(f?.note).toContain('21c');
  });

  it('a 19c document that does not set them raises nothing', () => {
    expect(finding(simulate(classic(), [down(0, PRM)]), 'FSFO.PING_NOT_IN_19C')).toBeUndefined();
  });

  it('26ai keeps the ping model as it was', () => {
    const t = simulate(classic({ version: '26ai', pingSet: true }), [down(0, PRM)]);
    expect(t.facts.initiateAt).toBeCloseTo(1.1, 9);
    expect(t.facts.pingSet).toBe(true);
    expect(decision(t, 'FSFO.PING_ARITHMETIC')?.claim.basis).toBe('model');
    expect(finding(t, 'FSFO.PING_NOT_IN_19C')).toBeUndefined();
  });

  it('the published page keeps its arithmetic, through the adapter and nowhere else', () => {
    expect(PUBLISHED_PAGE).toEqual({
      legacyPingUnder19c: true, legacyStallWhenNotReady: true, legacyManualLossIsApplyLag: true,
    });
    const m = legacyComputeFsfo({ version: '19c', pingSet: true });
    expect(m.initiate).toBeCloseTo(1.1, 9);
    expect(m.pingSet).toBe(true);
    /* The isolated primary past the lag limit: stalled on the published page. */
    const iso = legacyComputeFsfo({ scenario: 'isolated', mode: 'maxperf', standbyLag: 60, lagLimit: 30 });
    expect(iso.stalled).toBe(true);
    expect(iso.abort).toBe(30);
  });
});

/* A document built by hand, to keep the blocks above honest about topology. */
describe('the same outcomes on a hand-built pair', () => {
  it('cut off, recorded unsynchronized, crash: no failover', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary');
    const sby = db('sby01', ['dc2-sby01'], 'physical');
    dest(prm, sby.id, { netTimeoutSeconds: 10 });
    const doc = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm, sby], observers: [observer('obs01', 'dc3-obs01')], targets: [sby.id],
    });
    const t = simulate(doc, [cut(0, DC1_DC2), down(100, PRM)]);
    /* NetTimeout is 10 s here, so that is where the recording is drawn. */
    expect(decision(t, 'FSFO.NOT_READY')?.at).toBe(10);
    expect(promoted(t)).toBe(false);
    expect(stateAt(t, 200).members[sby01]).not.toBe('open-rw');
  });
});
