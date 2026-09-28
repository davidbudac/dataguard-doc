/**
 * The worked examples of engine design SS3 and SS4, as scenarios.
 *
 * Each one exercises a branch the 24-cell matrix cannot reach: more than one
 * candidate target, a RAC primary, a far sync instance between the primary and
 * its standby, and a master observer that dies while the primary and the
 * target standby stay connected.
 */

import { describe, expect, it } from 'vitest';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import { hostId, memberId, observerId, siteId } from '../src/engine/ids';
import type { TimedEvent } from '../src/engine/types/events';
import type { RedoGraph, TopologyDoc } from '../src/engine';
import { preset } from '../src/presets';
import {
  cascadeDoc, farSyncDoc, maxProtDoc, multiObserverDoc, multiTargetDoc, racDoc,
} from './topologies';

/* Fact check SIM-05. The first candidate is lost FIRST, while the primary is
   there to change the target; the primary fails later. That is the sequence
   Oracle documents. The assertions this block replaced took the second data
   centre and the primary down at the same instant and expected a failover to
   the second candidate, which 26ai documents as impossible. */
describe('multi-target: the first candidate is lost, then the primary (SS4.7)', () => {
  const doc = multiTargetDoc();
  const events: TimedEvent[] = [
    { at: 0, kind: 'site.down', site: siteId('dc2') },
    { at: 10, kind: 'host.down', host: hostId('dc1-prm01') },
  ];
  const trace = simulate(doc, events);

  it('changes the target while the primary is alive, and fails over to it later', () => {
    const change = trace.decisions.find((x) => x.id === 'FSFO.TARGET_CHANGE');
    expect(change?.at).toBe(0);
    expect(change?.subject?.id).toBe('sby02');
    expect(change?.claim.cite).toContain('FSFO.TARGET_AUTO_CHANGE');
    expect(trace.facts.outcome).toBe('failover');
    expect(trace.facts.target).toBe(memberId('sby02'));
    expect(trace.facts.newPrimary).toBe(memberId('sby02'));
    /* The observer and sby02 both lost the primary at 10 s. */
    expect(trace.facts.initiateAt).toBe(40);
    /* execStart + the apply lag it still has to replay + the role change. */
    expect(trace.facts.tOpen).toBe(40 + 10 + 15);
  });

  it('says in so many words that the change and its instant are the model, not "first viable"', () => {
    for (const id of ['FSFO.TARGET_CHANGE', 'FSFO.TARGET_SELECTION']) {
      const d = trace.decisions.find((x) => x.id === id);
      expect(d?.claim.basis, id).toBe('model');
      expect(d?.claim.note, id).toContain('order');
      expect(d?.claim.note, id).toContain('never "the first viable one in the list"');
    }
  });

  it("the new primary's own routing rules are what feed the configuration afterwards", () => {
    const last = trace.epochs[trace.epochs.length - 1];
    expect(last?.primary).toBe(memberId('sby02'));
    expect(last?.redo.primary).toBe(memberId('sby02'));
  });

  it('the dead candidate never becomes the target', () => {
    expect(stateAt(trace, 60).members[memberId('sby01')]).toBe('down');
  });

  /* The three-observer preset is the same shape with the observers the
     documentation allows, and it is what the workbench draws. */
  const threeObs = simulate(preset('multi-target-three-observers').doc(),
    preset('multi-target-three-observers').events());

  it('the master observer is described against the current target, not the first candidate', () => {
    /* The broker "automatically changes the fast-start failover target to one
       of the other candidate targets": after the change the observer's target
       is sby02, and once sby02 is the primary the observer is watching it.
       Reporting "lost the failover target" there is reporting the candidate
       that was replaced. */
    expect(threeObs.facts.newPrimary).toBe(memberId('sby02'));
    expect(threeObs.facts.observers[observerId('obs01')]?.endState).toBe('master');
    const lane = threeObs.lanes.find((l) => l.subject.id === 'obs01');
    expect(lane?.segments.some((sg) => sg.state === 'lost-target')).toBe(false);
    expect(lane?.segments[lane.segments.length - 1]?.state).toBe('master');
  });

  it('the new primary opens read-write at tOpen: nothing hangs on a destination that was already down', () => {
    /* A commit hang is an acknowledgement that stopped arriving. sby02 takes
       the role with both of its synchronous destinations already gone, so
       there is none to lose and no NET_TIMEOUT band belongs in front of the
       open -- the readout's "new primary open" instant and the timeline are
       the same number. */
    const tOpen = threeObs.facts.tOpen as number;
    const lane = threeObs.lanes.find((l) => l.subject.id === 'sby02');
    const open = lane?.segments.find((sg) => sg.state === 'open-rw');
    expect(open?.t0).toBe(tOpen);
    expect(lane?.segments.some((sg) => sg.state === 'commit-hang')).toBe(false);
    expect(stateAt(threeObs, tOpen + 0.1).members[memberId('sby02')]).toBe('open-rw');
    expect(threeObs.facts.perMember[memberId('sby02')]?.endState).toBe('open-rw');
  });

  it("the 'active-target-only' toggle never changes the target", () => {
    const only = simulate(doc, events, { targetPolicy: 'active-target-only' });
    expect(only.decisions.find((x) => x.id === 'FSFO.TARGET_CHANGE')).toBeUndefined();
    expect(only.facts.initiateAt).toBe(null);
    expect(only.facts.newPrimary).toBe(null);
    expect(only.facts.outcome).toBe('manual');
  });
});

describe('multi-target: the primary and the first target are lost together (SIM-05)', () => {
  const events: TimedEvent[] = [
    { at: 0, kind: 'site.down', site: siteId('dc2') },
    { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
  ];

  for (const edition of ['19c', '26ai'] as const) {
    it(`${edition}: no fast-start failover to the second target`, () => {
      const doc = multiTargetDoc();
      doc.config.edition = edition;
      const trace = simulate(doc, events);
      expect(trace.facts.initiateAt).toBe(null);
      expect(trace.facts.newPrimary).toBe(null);
      expect(trace.facts.outcome).toBe('manual');
      expect(trace.decisions.find((x) => x.id === 'FSFO.TARGET_CHANGE')).toBeUndefined();
      expect(stateAt(trace, 120).members[memberId('sby02')]).not.toBe('open-rw');

      const f = trace.findings.find((x) => x.id === 'FSFO.NO_SECOND_TARGET');
      expect(f?.cite).toContain('FSFO.NO_SECOND_TARGET_26AI');
      expect(f?.message).toContain('cannot fail over to the second target');
      /* Documented on the 26ai page; the 19c chapter is silent. */
      expect(f?.basis).toBe(edition === '26ai' ? 'documented' : 'doc-later');
      if (edition === '19c') expect(f?.note).toContain('19c chapter');
      const d = trace.decisions.find((x) => x.id === 'FSFO.NO_SECOND_TARGET');
      expect(d?.taken).toBe(false);
      /* Where the observer's clock would have expired. */
      expect(d?.at).toBe(30);
    });
  }
});

describe('RAC instance failure (SS4.8)', () => {
  const doc = racDoc();
  const trace = simulate(doc, [{ at: 0, kind: 'instance.down', member: memberId('prm01'), instance: 'prm011' }]);

  it('one instance of two is degraded, not down: the configuration continues', () => {
    expect(trace.facts.outcome).toBe('continues');
    expect(trace.facts.initiateAt).toBe(null);
    expect(trace.facts.abortAt).toBe(null);
    expect(stateAt(trace, 30).members[memberId('prm01')]).toBe('open-rw');
  });

  it('losing every instance is the crash', () => {
    const both = simulate(doc, [
      { at: 0, kind: 'instance.down', member: memberId('prm01'), instance: 'prm011' },
      { at: 5, kind: 'instance.down', member: memberId('prm01'), instance: 'prm012' },
    ]);
    expect(both.facts.outcome).toBe('failover');
    expect(both.facts.initiateAt).toBe(35);
  });
});

describe('far sync host down under MaxAvailability (SS3.2)', () => {
  const doc = farSyncDoc('MAXAVAILABILITY');
  const trace = simulate(doc, [{ at: 10, kind: 'host.down', host: hostId('dc1-fs01') }]);

  it('the primary operates as if in maximum performance, and keeps committing', () => {
    const before = trace.epochs[0];
    expect(before?.protectionLevel.value).toBe('MAXAVAILABILITY');
    expect(before?.protectionLevel.basis).toBe('documented');
    const after = trace.epochs[trace.epochs.length - 1];
    expect(after?.protectionLevel.value).toBe('MAXPERFORMANCE');
    /* Fact check SIM-12: replaces `basis === 'documented'`. The documented
       sentence is about behaviour ("operates as if"); which value
       PROTECTION_LEVEL shows is not stated, and RESYNCHRONIZATION is listed
       as a value of its own. */
    expect(after?.protectionLevel.basis).toBe('model');
    expect(after?.protectionLevel.cite).toContain('LEVEL.RESYNCHRONIZATION');
    expect(after?.protectionLevel.note).toContain('operates as if it were in maximum performance mode');
    expect(after?.protectionLevel.note).toContain('at least one synchronized standby');
    expect(trace.facts.outcome).toBe('continues');
    expect(stateAt(trace, 60).members[memberId('prm01')]).not.toBe('aborted');
  });

  it('fast-start failover cannot fire: the standby never lost the primary', () => {
    expect(trace.facts.initiateAt).toBe(null);
    /* The direct network connection between the primary and the remote standby
       is what a far sync edge never replaces, and it is still up. */
    expect(trace.facts.conditions.stalled).toBe(false);
  });

  it('the far sync instance is never open, never primary and never a target', () => {
    const fs = memberId('fs1');
    expect(trace.facts.newPrimary).not.toBe(fs);
    expect(trace.facts.target).not.toBe(fs);
    for (let t = 0; t <= 60; t += 5) {
      expect(['receiving', 'forwarding-stalled', 'unreachable', 'down'])
        .toContain(stateAt(trace, t).members[fs]);
    }
  });
});

describe('observer master lost with the primary and target connected', () => {
  const doc = multiObserverDoc();
  const trace = simulate(doc, [{ at: 10, kind: 'observer.stop', observer: observerId('obs01') }]);

  it('the broker tries to nominate a backup observer as the new master', () => {
    const d = trace.decisions.find((x) => x.id === 'NOMINATION.NEW_MASTER');
    expect(d?.taken).toBe(true);
    expect(d?.at).toBe(10);
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.note).toContain('tries to nominate a backup observer');
    expect(trace.facts.observers[observerId('obs02')]?.becameMasterAt).toBe(10);
    expect(trace.facts.observers[observerId('obs02')]?.endState).toBe('master');
    expect(trace.facts.outcome).toBe('continues');
  });

  it('with every observer stopped the configuration is unobserved, not nominating', () => {
    const gone = simulate(doc, [
      { at: 10, kind: 'observer.stop', observer: observerId('obs01') },
      { at: 20, kind: 'observer.stop', observer: observerId('obs02') },
    ]);
    expect(gone.facts.outcome).toBe('observer-lost');
    const d = gone.decisions.find((x) => x.id === 'NOMINATION.PRECONDITION');
    expect(d?.taken).toBe(false);
    expect(gone.findings.some((f) => f.id === 'OBS.UNOBSERVED')).toBe(true);
  });

  it('the nomination rule is never extended past its precondition', () => {
    /* The primary is separated from the target standby AND the observers are
       gone: that is not the documented nomination case, and the configuration
       is reported unobserved rather than nominating. */
    const cut = simulate(doc, [
      { at: 0, kind: 'observer.stop', observer: observerId('obs01') },
      { at: 0, kind: 'observer.stop', observer: observerId('obs02') },
      { at: 0, kind: 'site.down', site: siteId('dc2') },
    ]);
    const d = cut.decisions.find((x) => x.id === 'NOMINATION.PRECONDITION');
    expect(d?.taken).toBe(false);
    expect(d?.claim.basis).toBe('documented');
    expect(d?.claim.note).toContain('not both connected');
  });
});

describe('manual failover to a terminal standby', () => {
  const events: TimedEvent[] = [
    { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
    { at: 5, kind: 'cmd.failover', to: memberId('remote_sby') },
  ];

  it('is legal and documented with fast-start failover disabled, and warns about the unsent redo', () => {
    const doc = cascadeDoc();
    doc.config.fsfo.state = 'disabled';
    const trace = simulate(doc, events);
    expect(trace.facts.outcome).toBe('manual');
    expect(trace.facts.newPrimary).toBe(memberId('remote_sby'));
    const f = trace.findings.find((x) => x.id === 'CASCADE.MANUAL_FAILOVER_TERMINAL');
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('no attempt is made to transmit any unsent redo');
  });

  it('with fast-start failover enabled it is refused: the terminal standby is not the current target', () => {
    /* Fact check SIM-08: this replaces an assertion that the failover went
       ahead beside the error. "The failover can only be performed to the
       current target standby database." */
    const trace = simulate(cascadeDoc(), events);
    const f = trace.findings.find((x) => x.id === 'FSFO.MANUAL_FAILOVER_NOT_TARGET');
    expect(f?.severity).toBe('error');
    expect(f?.cite).toContain('FAILOVER.CURRENT_TARGET_ONLY');
    expect(f?.ora).toBe('ORA-16655');
    const d = trace.decisions.find((x) => x.id === 'FSFO.MANUAL_FAILOVER');
    expect(d?.taken).toBe(false);
    expect(d?.at).toBe(5);
    /* Nothing changes role at the command. Fast-start failover is still
       enabled, so at the threshold the observer fails over to the target. */
    expect(stateAt(trace, 29).members[memberId('remote_sby')]).not.toBe('converting');
    expect(trace.facts.outcome).toBe('failover');
    expect(trace.facts.initiateAt).toBe(30);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
    for (let t = 0; t <= 120; t += 10) {
      expect(stateAt(trace, t).members[memberId('remote_sby')]).not.toBe('open-rw');
    }
  });
});

describe('observe-only and the bystanders', () => {
  it('an observe-only configuration never fails over', () => {
    const doc = multiTargetDoc();
    doc.config.fsfo.state = 'observe-only';
    const trace = simulate(doc, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(trace.facts.initiateAt).toBe(null);
    expect(trace.facts.outcome).toBe('manual');
    const d = trace.decisions.find((x) => x.id === 'FSFO.OBSERVE_ONLY');
    expect(d?.taken).toBe(false);
    expect(d?.claim.note).toContain('observe-only mode');
    expect(stateAt(trace, 30).observers[observerId('obs01')]).toBe('observe-only');
  });

  it('BystandersFollowRoleChange = NONE marks the bystander disabled, to be evaluated later', () => {
    const doc = multiTargetDoc();
    doc.config.bystandersFollowRoleChange = 'NONE';
    const trace = simulate(doc, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
    const d = trace.decisions.find((x) => x.id === 'BYSTANDERS.FOLLOW');
    expect(d?.taken).toBe(false);
    expect(d?.claim.basis).toBe('documented');
    expect(d?.claim.note).toContain('marked as disabled with a status of ORA-16661 so that they can be evaluated later');
    expect(d?.claim.note).not.toContain('left out of the new configuration');
    expect(trace.facts.perMember[memberId('sby02')]?.endState).toBe('disabled');
    /* The default is ALL, and then the bystander simply follows. */
    const all = simulate(multiTargetDoc(), [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(all.decisions.find((x) => x.id === 'BYSTANDERS.FOLLOW')?.taken).toBe(true);
    expect(all.facts.perMember[memberId('sby02')]?.endState).not.toBe('disabled');
  });
});

describe('maximum protection shuts the primary down', () => {
  const doc = maxProtDoc();
  const trace = simulate(doc, [{ at: 0, kind: 'site.down', site: siteId('dc2') }]);

  it('aborts one NET_TIMEOUT after the last acknowledgement, and says the instant is a model', () => {
    expect(trace.facts.abortReason).toBe('maxprotection');
    expect(trace.facts.abortAt).toBe(10);
    const f = trace.findings.find((x) => x.id === 'PROT.MAXPROT_SHUTDOWN');
    expect(f?.basis).toBe('model');
    expect(f?.note).toContain('the instant is not');
    expect(stateAt(trace, 20).members[memberId('prm01')]).toBe('aborted');
  });
});

/* ---------------- REOPEN, MaxFailure and the alternate latch ---------------- */

const LOCAL_SALES = memberId('Local_Sales');
const ALT_SALES = memberId('Alternate_Sales');

const lastGraph = (t: ReturnType<typeof simulate>): RedoGraph =>
  (t.epochs[t.epochs.length - 1] as { redo: RedoGraph }).redo;

const activeTo = (g: RedoGraph): string[] =>
  g.edges.filter((e) => e.active && e.up).map((e) => e.to as string);

const edgeTo = (g: RedoGraph, to: string) => g.edges.find((e) => (e.to as string) === to);

/**
 * The PRIORITY-groups preset (broker Example 4-3), whose two destinations both
 * carry a non-zero MaxFailure -- as they must, because "A member whose
 * MaxFailure property is set to zero cannot be part of a RedoRoutes group".
 */
const priorityDoc = (): TopologyDoc => preset('priority-alternates').doc();

/** The same two members in the 12.1 ALT spelling, with and without FALLBACK. */
function alternateDoc(fallback: boolean): TopologyDoc {
  const doc = priorityDoc();
  const prm = doc.members[0];
  if (!prm) throw new Error('no primary in the preset');
  prm.redoRoutes = [{
    source: 'LOCAL',
    groups: [{
      dests: [{
        target: LOCAL_SALES, xpt: 'SYNC',
        alt: { target: ALT_SALES, xpt: 'SYNC', fallback },
      }],
    }],
  }];
  return doc;
}

const down = (at: number): TimedEvent => ({ at, kind: 'host.down', host: hostId('dc2-local') });
const up = (at: number): TimedEvent => ({ at, kind: 'host.up', host: hostId('dc2-local') });

describe('a destination that fails past MaxFailure (Example 4-3 and the ALT spelling)', () => {
  it('moves the redo to the standing-by group the moment the destination is gone', () => {
    const t = simulate(priorityDoc(), [down(0)]);
    expect(activeTo(lastGraph(t))).toEqual(['Alternate_Sales']);
    expect(edgeTo(lastGraph(t), 'Local_Sales')?.up).toBe(false);
  });

  it('counts the retries at REOPEN and says the ladder is an idealization', () => {
    /* ReopenSecs is 300 s and MaxFailure is 1, so the first attempt to
       reestablish the destination falls at 300 s -- and the epoch is there.
       The one at 30 s is the target's: Local_Sales is the fast-start failover
       target, and one NET_TIMEOUT after it stopped answering the primary
       carries on without it, which is where it stops being ready. */
    const t = simulate(priorityDoc(), [down(0), up(1000)]);
    expect(t.epochs.map((e) => e.t0)).toEqual([0, 30, 300, 1000]);
    expect(t.decisions.find((x) => x.id === 'FSFO.NOT_READY')?.at).toBe(30);
    const f = t.findings.find((x) => x.id === 'DEST.REOPEN_SCHEDULE_MODEL');
    expect(f?.basis).toBe('model');
    expect(f?.note ?? '').toContain('log switch');
  });

  it('does not disable a destination written in a priority group: it re-enters when accessible', () => {
    /* The one documented exception to "no further access until it is manually
       reenabled" -- 12.2+ GROUP/PRIORITY destinations. */
    const t = simulate(priorityDoc(), [down(0), up(1000)]);
    const f = t.findings.find((x) => x.id === 'DEST.GROUP_PRIORITY_REENTER');
    expect(f?.basis).toBe('documented');
    expect(t.findings.find((x) => x.id === 'DEST.MAX_FAILURE_DISABLED')).toBeUndefined();
    expect(activeTo(lastGraph(t))).toEqual(['Local_Sales']);
    expect(edgeTo(lastGraph(t), 'Local_Sales')?.inactiveReason).toBeUndefined();
  });

  it('disables an ungrouped destination at MaxFailure, and the healing does not bring it back', () => {
    const t = simulate(alternateDoc(false), [down(0), up(1000)]);
    const f = t.findings.find((x) => x.id === 'DEST.MAX_FAILURE_DISABLED');
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('manually reenabled');
    /* Without FALLBACK the disabled destination stays disabled, so the
       alternate is still the one carrying redo after the heal. */
    expect(activeTo(lastGraph(t))).toEqual(['Alternate_Sales']);
    expect(edgeTo(lastGraph(t), 'Local_Sales')?.inactiveReason).toBe('max-failure-disabled');
  });

  it('with FALLBACK resumes the named destination once it is available, even after MaxFailure', () => {
    /* 12.1: "The optional FALLBACK keyword is used to specify that redo
       transport to the non-alternate member should be resumed if it becomes
       available." */
    const t = simulate(alternateDoc(true), [down(0), up(1000)]);
    expect(t.findings.find((x) => x.id === 'DEST.MAX_FAILURE_DISABLED')).toBeDefined();
    expect(activeTo(lastGraph(t))).toEqual(['Local_Sales']);
    expect(edgeTo(lastGraph(t), 'Local_Sales')?.inactiveReason).toBeUndefined();
  });

  it('brings a FALLBACK destination back once it is reachable again', () => {
    /* Healed before the first retry, so nothing was disabled and the only
       question is what the keyword means. */
    const t = simulate(alternateDoc(true), [down(0), up(120)]);
    expect(activeTo(lastGraph(t))).toEqual(['Local_Sales']);
    expect(t.findings.find((x) => x.id === 'ROUTES.ALT_LATCHED')).toBeUndefined();
  });

  it('keeps a non-FALLBACK alternate in service after the heal, as 12.1 documents', () => {
    const t = simulate(alternateDoc(false), [down(0), up(120)]);
    expect(activeTo(lastGraph(t))).toEqual(['Alternate_Sales']);
    const f = t.findings.find((x) => x.id === 'ROUTES.ALT_LATCHED');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('ROUTES.FALLBACK_121');
    expect(f?.message).toContain('12.1');
  });

  it('counts MaxFailure the 26ai way under 26ai: the initial failure counts, so 1 is no retry', () => {
    const doc19 = alternateDoc(false);
    const t19 = simulate(doc19, [down(0), up(1000)]);
    const at19 = t19.findings.find((x) => x.id === 'DEST.MAX_FAILURE_DISABLED');
    expect(at19?.message).toContain('at 300 s');
    expect(at19?.cite).toContain('DEST.MAX_FAILURE_DISABLED_19C');

    const doc26 = alternateDoc(false);
    doc26.config.edition = '26ai';
    const t26 = simulate(doc26, [down(0), up(1000)]);
    const at26 = t26.findings.find((x) => x.id === 'DEST.MAX_FAILURE_DISABLED');
    expect(at26?.message).toContain('at 0 s');
    expect(at26?.message).toContain('No further attempts are made to reactivate');
    expect(at26?.message).not.toContain('manually reenabled');
    expect(at26?.cite).toContain('DEST.MAX_FAILURE_26AI');
    expect(t26.epochs.map((e) => e.t0)).not.toContain(300);
  });

  it('26ai MaxFailure 2 is one retry after the initial failure', () => {
    const doc = alternateDoc(false);
    doc.config.edition = '26ai';
    const prm = doc.members[0];
    if (prm) prm.dests[LOCAL_SALES] = { ...prm.dests[LOCAL_SALES]!, maxFailure: 2 };
    const t = simulate(doc, [down(0), up(1000)]);
    expect(t.findings.find((x) => x.id === 'DEST.MAX_FAILURE_DISABLED')?.message).toContain('at 300 s');
  });

  it('starts the MaxFailure count over when the destination comes back, and says that is a reading', () => {
    /* One failed attempt at 300 s against MaxFailure 2, then a heal: the
       counter starts over, so a second outage gets its own two attempts.
       (Without FALLBACK, so that the disabled destination stays disabled.) */
    const doc = alternateDoc(false);
    const prm = doc.members[0];
    if (prm) prm.dests[LOCAL_SALES] = { ...prm.dests[LOCAL_SALES]!, maxFailure: 2 };
    const t = simulate(doc, [down(0), up(400), down(500), up(2000)]);
    const reset = t.findings.find((x) => x.id === 'DEST.MAXFAILURE_RESET_UNDOC');
    expect(reset?.basis).toBe('model');
    expect(reset?.note ?? '').toContain('does not say so');
    /* 500 + 2 * 300: the second outage's own two attempts. */
    expect(t.epochs.map((e) => e.t0)).toContain(1100);
    expect(edgeTo(lastGraph(t), 'Local_Sales')?.inactiveReason).toBe('max-failure-disabled');
  });
});

describe('equal priorities inside a group are sticky (Example 2, far sync HA pair)', () => {
  const fsDown = (at: number): TimedEvent => ({ at, kind: 'host.down', host: hostId('dc1-fs1') });
  const fsUp = (at: number): TimedEvent => ({ at, kind: 'host.up', host: hostId('dc1-fs1') });
  const fromPrimary = (g: RedoGraph): string[] =>
    g.edges.filter((e) => (e.from as string) === 'North_Sales' && e.active && e.up).map((e) => e.to as string);

  it('stays with FS2 after FS1 comes back, because the two have the same priority', () => {
    const doc = preset('far-sync-ha-pair').doc();
    const t = simulate(doc, [fsDown(0), fsUp(600)]);
    expect(fromPrimary(lastGraph(t))).toEqual(['FS2']);
    expect(edgeTo(lastGraph(t), 'FS1')?.inactiveReason).toBe('group-standby');
  });

  it('returns to a lower PRIORITY number as soon as it is back (Example 1, far sync zero loss)', () => {
    const doc = preset('far-sync-zero-loss').doc();
    const t = simulate(doc, [fsDown(0), fsUp(600)]);
    expect(fromPrimary(lastGraph(t))).toEqual(['FS1']);
  });
});
