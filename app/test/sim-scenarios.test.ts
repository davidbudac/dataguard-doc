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

describe('multi-target with a dead first candidate (SS4.7)', () => {
  const doc = multiTargetDoc();
  const events: TimedEvent[] = [
    { at: 0, kind: 'site.down', site: siteId('dc2') },
    { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
  ];
  const trace = simulate(doc, events);

  it('walks the candidate list in order and lands on the second one', () => {
    expect(trace.facts.outcome).toBe('failover');
    expect(trace.facts.target).toBe(memberId('sby02'));
    expect(trace.facts.newPrimary).toBe(memberId('sby02'));
    expect(trace.facts.initiateAt).toBe(30);
    /* execStart + the apply lag it still has to replay + the role change. */
    expect(trace.facts.tOpen).toBe(30 + 10 + 15);
  });

  it('says in so many words that the order is the model, not "first viable"', () => {
    const d = trace.decisions.find((x) => x.id === 'FSFO.TARGET_SELECTION');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.note).toContain('order');
    expect(d?.claim.note).toContain('never "the first viable one in the list"');
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

  it('the master observer is described against the target it selected, not the first candidate', () => {
    /* The broker "automatically changes the fast-start failover target to one
       of the other candidate targets": after the retarget the observer's
       target is sby02, and once sby02 is the primary the observer is watching
       it. Reporting "lost the failover target" there is reporting the
       candidate that was skipped. */
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

  it("the 'active-target-only' toggle stops at the first candidate", () => {
    const only = simulate(doc, events, { targetPolicy: 'active-target-only' });
    expect(only.facts.initiateAt).toBe(null);
    expect(only.facts.newPrimary).toBe(null);
    expect(only.facts.outcome).toBe('manual');
  });
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

  it('the protection level drops to maximum performance, and the primary keeps committing', () => {
    const before = trace.epochs[0];
    expect(before?.protectionLevel.value).toBe('MAXAVAILABILITY');
    const after = trace.epochs[trace.epochs.length - 1];
    expect(after?.protectionLevel.value).toBe('MAXPERFORMANCE');
    expect(after?.protectionLevel.basis).toBe('documented');
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
  const doc = cascadeDoc();
  const trace = simulate(doc, [
    { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
    { at: 5, kind: 'cmd.failover', to: memberId('remote_sby') },
  ]);

  it('is legal and documented, and warns about the unsent redo', () => {
    expect(trace.facts.outcome).toBe('manual');
    expect(trace.facts.newPrimary).toBe(memberId('remote_sby'));
    const f = trace.findings.find((x) => x.id === 'CASCADE.MANUAL_FAILOVER_TERMINAL');
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('no attempt is made to transmit any unsent redo');
  });

  it('with fast-start failover enabled it is conditional, and says which condition fails', () => {
    const ids = trace.findings.map((x) => x.id);
    expect(ids).toContain('FSFO.MANUAL_FAILOVER_NOT_TARGET');
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

  it('BystandersFollowRoleChange = NONE leaves the bystander out of the new configuration', () => {
    const doc = multiTargetDoc();
    doc.config.bystandersFollowRoleChange = 'NONE';
    const trace = simulate(doc, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
    const d = trace.decisions.find((x) => x.id === 'BYSTANDERS.FOLLOW');
    expect(d?.taken).toBe(false);
    expect(d?.claim.basis).toBe('documented');
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
       reestablish the destination falls at 300 s -- and the epoch is there. */
    const t = simulate(priorityDoc(), [down(0), up(1000)]);
    expect(t.epochs.map((e) => e.t0)).toEqual([0, 300, 1000]);
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
    const t = simulate(alternateDoc(true), [down(0), up(1000)]);
    const f = t.findings.find((x) => x.id === 'DEST.MAX_FAILURE_DISABLED');
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('manually reenabled');
    /* FALLBACK or not: a disabled destination stays disabled, so the
       alternate is still the one carrying redo after the heal. */
    expect(activeTo(lastGraph(t))).toEqual(['Alternate_Sales']);
    expect(edgeTo(lastGraph(t), 'Local_Sales')?.inactiveReason).toBe('max-failure-disabled');
  });

  it('brings a FALLBACK destination back once it is reachable again', () => {
    /* Healed before the first retry, so nothing was disabled and the only
       question is what the keyword means. */
    const t = simulate(alternateDoc(true), [down(0), up(120)]);
    expect(activeTo(lastGraph(t))).toEqual(['Local_Sales']);
    expect(t.findings.find((x) => x.id === 'ROUTES.ALT_LATCHED')).toBeUndefined();
  });

  it('keeps a non-FALLBACK alternate in service after the heal, and labels the reading', () => {
    const t = simulate(alternateDoc(false), [down(0), up(120)]);
    expect(activeTo(lastGraph(t))).toEqual(['Alternate_Sales']);
    const f = t.findings.find((x) => x.id === 'ROUTES.ALT_LATCHED');
    expect(f?.basis).toBe('model');
    expect(f?.note ?? '').toContain('not stated on any page');
  });

  it('starts the MaxFailure count over when the destination comes back, and says that is a reading', () => {
    /* One failed attempt at 300 s against MaxFailure 2, then a heal: the
       counter starts over, so a second outage gets its own two attempts. */
    const doc = alternateDoc(true);
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
