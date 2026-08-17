/**
 * Adversarial review of the engine against engine.md, facts.md and the
 * accuracy rules in AGENTS.md. Each block below pins one defect the review
 * found: it fails against the engine as it was, and passes against the fix.
 */

import { describe, expect, it } from 'vitest';
import { hostId, memberId, observerId, siteId } from '../src/engine/ids';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import { resolveRedoGraph } from '../src/engine/redo/resolve';
import { validate } from '../src/engine/validate';
import { manyDestinationsDoc } from '../src/engine/validate/__tests__/fixtures';
import { build, db, dest, multiObserverDoc, multiTargetDoc, observer } from './topologies';

const decision = (t: ReturnType<typeof simulate>, id: string) =>
  t.decisions.find((d) => d.id === id);

describe('the nomination rule is never extended past its precondition', () => {
  it('a master observer that dies with the primary is not replaced: the configuration is unobserved and nothing fails over', () => {
    /* Master in dc3, backup in dc4. The primary and the master go together, so
       "the primary and target standby databases stay connected" is false --
       that is not the documented nomination case, and the backup must not
       quietly become master and order a failover. */
    const doc = multiObserverDoc();
    const trace = simulate(doc, [
      { at: 0, kind: 'site.down', site: siteId('dc1') },
      { at: 0, kind: 'host.down', host: hostId('dc3-obs01') },
    ]);
    expect(trace.facts.initiateAt).toBe(null);
    expect(trace.facts.newPrimary).toBe(null);
    expect(decision(trace, 'NOMINATION.NEW_MASTER')).toBeUndefined();
    const pre = decision(trace, 'NOMINATION.PRECONDITION');
    expect(pre?.taken).toBe(false);
    expect(pre?.claim.basis).toBe('documented');
    expect(trace.facts.observers[observerId('obs02')]?.endState).not.toBe('master');
  });

  it('a master lost while the primary is cut off from the target is not replaced either', () => {
    const doc = multiObserverDoc();
    const trace = simulate(doc, [
      { at: 0, kind: 'link.cut', link: doc.links.find((l) => l.id === 'dc1-dc2')!.id },
      { at: 0, kind: 'host.down', host: hostId('dc3-obs01') },
    ]);
    expect(decision(trace, 'NOMINATION.NEW_MASTER')).toBeUndefined();
    expect(trace.facts.initiateAt).toBe(null);
  });

  it('once the precondition holds again the backup is nominated, and the claim says it is a model', () => {
    const doc = multiObserverDoc();
    const trace = simulate(doc, [
      { at: 0, kind: 'link.cut', link: doc.links.find((l) => l.id === 'dc1-dc2')!.id },
      { at: 0, kind: 'host.down', host: hostId('dc3-obs01') },
      { at: 5, kind: 'link.heal', link: doc.links.find((l) => l.id === 'dc1-dc2')!.id },
    ]);
    const d = decision(trace, 'NOMINATION.NEW_MASTER');
    expect(d?.at).toBe(5);
    expect(d?.claim.basis).toBe('model');
    expect(trace.facts.observers[observerId('obs02')]?.becameMasterAt).toBe(5);
  });

  it('SET MASTEROBSERVER TO is the manual override and needs no precondition', () => {
    const doc = multiObserverDoc();
    const trace = simulate(doc, [
      { at: 0, kind: 'cmd.setMasterObserver', observer: observerId('obs02') },
    ]);
    expect(trace.facts.observers[observerId('obs02')]?.endState).toBe('master');
  });
});

describe('no observer deployed is not "unobserved" and arms nothing', () => {
  const noObserver = (fsfo: 'enabled' | 'disabled', mode: 'MAXAVAILABILITY' | 'MAXPERFORMANCE' = 'MAXAVAILABILITY') => {
    const prm = db('prm01', ['dc1-prm01'], 'primary');
    const sby = db('sby01', ['dc2-sby01'], 'physical', { applyLagSeconds: 40 });
    dest(prm, sby.id);
    return build({
      mode, fsfo,
      sites: ['dc1', 'dc2'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2']],
      members: [prm, sby], observers: [], targets: [sby.id],
    });
  };

  it('losing the standby site with no observer deployed stalls nothing and reports nothing unobserved', () => {
    const trace = simulate(noObserver('enabled'), [{ at: 0, kind: 'site.down', site: siteId('dc2') }]);
    expect(trace.facts.conditions.stalled).toBe(false);
    expect(trace.facts.abortAt).toBe(null);
    expect(trace.findings.some((f) => f.id === 'OBS.UNOBSERVED')).toBe(false);
    expect(decision(trace, 'OBS.MASTER_LOST')).toBeUndefined();
    expect(trace.facts.outcome).toBe('continues');
  });

  it('the maximum performance switchover refusal is fast-start failover\'s own gate, so it cannot fire here', () => {
    const doc = noObserver('enabled', 'MAXPERFORMANCE');
    doc.config.fsfo.lagLimitSeconds = 30; /* apply lag 40 > 30 */
    const trace = simulate(doc, [{ at: 0, kind: 'cmd.switchover', to: memberId('sby01') }]);
    expect(trace.facts.blocked).toBe(false);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
  });

  it('a manual FAILOVER TO needs no observer while nothing is armed', () => {
    const trace = simulate(noObserver('enabled'), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: memberId('sby01') },
    ]);
    expect(trace.findings.some((f) => f.id === 'FSFO.MANUAL_FAILOVER_UNOBSERVED')).toBe(false);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
  });
});

describe('a commit hang needs a synchronous destination to hang on', () => {
  it('maximum availability over ASYNC alone (26ai) starts open, not in a NET_TIMEOUT hang', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary', { logXptMode: 'ASYNC' });
    const sby = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'ASYNC' });
    dest(prm, sby.id);
    const doc = build({
      edition: '26ai',
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm, sby], observers: [observer('obs01', 'dc3-obs01')], targets: [sby.id],
    });
    const trace = simulate(doc, []);
    expect(stateAt(trace, 0).members[memberId('prm01')]).toBe('open-rw');
    expect(stateAt(trace, 10).members[memberId('prm01')]).toBe('open-rw');
    expect(decision(trace, 'PROT.COMMIT_HANG')).toBeUndefined();
    /* The documented degradation still shows: no synchronized standby acknowledges. */
    expect(decision(trace, 'PROT.MAXAVAIL_DEGRADED')?.taken).toBe(true);
  });
});

describe('FastStartFailoverAutoReinstate covers observer-initiated failovers only', () => {
  it('a manual FAILOVER TO draws no reinstate band', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary', { flashbackOn: true, staticServices: true });
    const sby = db('sby01', ['dc2-sby01'], 'physical', { flashbackOn: true, staticServices: true });
    dest(prm, sby.id);
    const doc = build({
      fsfo: 'disabled',
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm, sby], observers: [observer('obs01', 'dc3-obs01')], targets: [sby.id],
    });
    doc.config.fsfo.autoReinstate = true;
    const trace = simulate(doc, [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: memberId('sby01') },
    ]);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
    expect(decision(trace, 'REINSTATE.OPEN_BAND')).toBeUndefined();
    expect(trace.findings.some((f) => f.id === 'REINSTATE.PRECONDITIONS')).toBe(false);
    for (const lane of trace.lanes) {
      if (lane.subject.id !== 'prm01') continue;
      expect(lane.segments.some((s) => s.state === 'reinstating')).toBe(false);
    }
  });

  it('an observer-initiated failover after a crash still reinstates', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary', { flashbackOn: true, staticServices: true });
    const sby = db('sby01', ['dc2-sby01'], 'physical', { flashbackOn: true, staticServices: true });
    dest(prm, sby.id);
    const doc = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm, sby], observers: [observer('obs01', 'dc3-obs01')], targets: [sby.id],
    });
    doc.config.fsfo.autoReinstate = true;
    const trace = simulate(doc, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
    expect(decision(trace, 'REINSTATE.OPEN_BAND')?.taken).toBe(true);
  });
});

describe('the switchover gate with fast-start failover enabled', () => {
  it('permits a switchover only to the pre-specified target standby', () => {
    const doc = multiTargetDoc();
    doc.config.fsfo.target = { kind: 'list', members: [memberId('sby01')] };
    const trace = simulate(doc, [{ at: 0, kind: 'cmd.switchover', to: memberId('sby02') }]);
    expect(trace.facts.blocked).toBe(true);
    expect(trace.facts.newPrimary).toBe(null);
    const f = trace.findings.find((x) => x.id === 'SWITCHOVER.REFUSED');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('pre-specified target');
  });

  it('in maximum availability an unsynchronized target is refused, a lag is not', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary');
    /* Ten minutes of apply lag AND a transport-lag input: under SYNC the
       commit waited for the acknowledgement, so the standby has the redo and
       the lag only lengthens the catch-up. Neither number is a refusal. */
    const lagging = db('sby01', ['dc2-sby01'], 'physical', {
      applyLagSeconds: 600, transportLagSeconds: 45,
    });
    dest(prm, lagging.id);
    const ok = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm, lagging], observers: [observer('obs01', 'dc3-obs01')], targets: [lagging.id],
    });
    expect(simulate(ok, [{ at: 0, kind: 'cmd.switchover', to: memberId('sby01') }]).facts.blocked).toBe(false);

    /* ASYNC is what leaves a maximum availability target unsynchronized: the
       primary never waits for it, so redo it has not received is a state this
       transport really can be in. */
    const prm2 = db('prm01', ['dc1-prm01'], 'primary');
    const behind = db('sby01', ['dc2-sby01'], 'physical', {
      logXptMode: 'ASYNC', applyLagSeconds: 10, transportLagSeconds: 5,
    });
    dest(prm2, behind.id);
    const bad = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm2, behind], observers: [observer('obs01', 'dc3-obs01')], targets: [behind.id],
    });
    const trace = simulate(bad, [{ at: 0, kind: 'cmd.switchover', to: memberId('sby01') }]);
    expect(trace.facts.blocked).toBe(true);
    expect(trace.findings.find((x) => x.id === 'SWITCHOVER.REFUSED')?.message).toContain('synchronized');
  });
});

describe('the RTO claim cites the transition it belongs to', () => {
  it('a fast-start failover never cites the switchover restart sentence', () => {
    const trace = simulate(multiTargetDoc(), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
    ]);
    const rto = trace.facts.perMember[memberId('sby01')]?.rtoSeconds;
    expect(rto?.basis).toBe('model');
    /* "the new primary database does not need to be restarted" is about a
       switchover's former primary and says nothing about a failover. */
    expect(rto?.cite).not.toContain('SWITCHOVER.FORMER_PRIMARY_RESTARTS');
    expect(rto?.cite).toContain('FSFO.THRESHOLD');
    expect(rto?.note ?? '').toContain('environment-dependent');
  });

  it('a switchover cites the step list and the restart sentence', () => {
    const trace = simulate(multiTargetDoc(), [
      { at: 0, kind: 'cmd.switchover', to: memberId('sby01') },
    ]);
    const rto = trace.facts.perMember[memberId('sby01')]?.rtoSeconds;
    expect(rto?.cite).toContain('SWITCHOVER.FORMER_PRIMARY_RESTARTS');
    expect(rto?.cite).toContain('SWITCHOVER.SESSIONS_END');
  });

  it('a manual failover cites its own conditions', () => {
    const trace = simulate(multiTargetDoc(), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: memberId('sby01') },
    ]);
    const rto = trace.facts.perMember[memberId('sby01')]?.rtoSeconds;
    expect(rto?.cite).toContain('FSFO.MANUAL_FAILOVER_CONDITIONS');
    expect(rto?.cite).not.toContain('SWITCHOVER.FORMER_PRIMARY_RESTARTS');
  });
});

describe('observe-only allows what the documentation says it allows', () => {
  /* Two standbys, sby01 the named target and sby02 a bystander. */
  const observeOnly = () => {
    const doc = multiTargetDoc();
    doc.config.fsfo.state = 'observe-only';
    doc.config.fsfo.target = { kind: 'list', members: [memberId('sby01')] };
    return doc;
  };

  it('permits a switchover to a bystander, which fast-start failover would refuse', () => {
    /* Enabled, the broker permits a switchover only to the pre-specified
       target standby. Observe-only initiates no fast-start failover, and a
       switchover -- and a failover to a bystander -- stays allowed. */
    const armed = observeOnly();
    armed.config.fsfo.state = 'enabled';
    expect(simulate(armed, [{ at: 0, kind: 'cmd.switchover', to: memberId('sby02') }])
      .facts.blocked).toBe(true);

    const trace = simulate(observeOnly(), [{ at: 0, kind: 'cmd.switchover', to: memberId('sby02') }]);
    expect(trace.facts.blocked).toBe(false);
    expect(trace.facts.newPrimary).toBe(memberId('sby02'));
    expect(trace.findings.find((x) => x.id === 'SWITCHOVER.REFUSED')).toBeUndefined();
    expect(decision(trace, 'SWITCHOVER.GATE')?.taken).toBe(true);
  });

  it('permits a manual failover to a bystander with no fast-start failover condition raised', () => {
    const trace = simulate(observeOnly(), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: memberId('sby02') },
    ]);
    expect(trace.facts.newPrimary).toBe(memberId('sby02'));
    for (const id of ['FSFO.MANUAL_FAILOVER_NOT_TARGET', 'FSFO.MANUAL_FAILOVER_UNOBSERVED',
      'FSFO.MANUAL_FAILOVER_NOT_READY']) {
      expect(trace.findings.find((x) => x.id === id), id).toBeUndefined();
    }
  });
});

describe('PrimaryDatabaseCandidates is a fast-start-failover-disabled fence', () => {
  const fenced = (fsfo: 'enabled' | 'disabled') => {
    const doc = multiTargetDoc();
    doc.config.fsfo.state = fsfo;
    doc.config.primaryDatabaseCandidates = [memberId('prm01'), memberId('sby01')];
    return doc;
  };

  it('while disabled it refuses FAILOVER TO a member outside the list with ORA-16529', () => {
    const trace = simulate(fenced('disabled'), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: memberId('sby02') },
    ]);
    expect(trace.facts.newPrimary).toBe(null);
    const f = trace.findings.find((x) => x.id === 'ROLE.PRIMARY_DB_CANDIDATES');
    expect(f?.ora).toBe('ORA-16529');
    expect(f?.basis).toBe('doc-later');
  });

  it('a member on the list is promoted', () => {
    const trace = simulate(fenced('disabled'), [
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 5, kind: 'cmd.failover', to: memberId('sby01') },
    ]);
    expect(trace.facts.newPrimary).toBe(memberId('sby01'));
  });
});

describe('FastStartFailoverLagType is maximum performance behaviour in the resolver too', () => {
  it('26ai bounded maximum availability with TRANSPORT set still gates on the apply lag', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary');
    const sby = db('sby01', ['dc2-sby01'], 'physical', { applyLagSeconds: 10, transportLagSeconds: 2 });
    dest(prm, sby.id);
    const doc = build({
      edition: '26ai',
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm, sby], observers: [observer('obs01', 'dc3-obs01')], targets: [sby.id],
    });
    doc.config.fsfo.lagLimitSeconds = 5;
    doc.config.fsfo.lagType = 'TRANSPORT';
    const g = resolveRedoGraph(doc, { primary: memberId('prm01') });
    expect(g.members[memberId('sby01')]?.synchronized.value).toBe(false);
    expect(g.members[memberId('sby01')]?.synchronized.note).toContain('APPLY');
  });
});

describe('wording traps', () => {
  it('DEST.RANGE never derives a "30 remote destinations" figure', () => {
    const f = validate(manyDestinationsDoc(31)).find((x) => x.id === 'DEST.RANGE');
    expect(f).toBeDefined();
    expect(f?.message).not.toMatch(/30 (remote )?destinations/);
    expect(f?.message).not.toContain('beyond it');
  });
});

describe('the target standby must itself have lost the primary for the threshold', () => {
  it('a candidate that lost the primary later than the observer is not promoted at the observer\'s deadline', () => {
    /* Observer and sby02 in dc3 lose the primary at 0; sby01 (first in the
       list) loses it only at 10. At 30 the observer's threshold is up, but
       ObserverOverride is FALSE: sby01 has lost the primary for 20 s only, so
       the walk lands on sby02, and sby01 would qualify at 40 at the earliest. */
    const doc = multiTargetDoc();
    const trace = simulate(doc, [
      { at: 0, kind: 'link.cut', link: doc.links.find((l) => l.id === 'dc1-dc3')!.id },
      { at: 10, kind: 'link.cut', link: doc.links.find((l) => l.id === 'dc1-dc2')!.id },
    ]);
    expect(trace.facts.initiateAt).toBe(30);
    expect(trace.facts.target).toBe(memberId('sby02'));
    expect(trace.facts.newPrimary).toBe(memberId('sby02'));
  });

  it('with a single candidate the later loss delays the initiation', () => {
    const doc = multiTargetDoc();
    doc.config.fsfo.target = { kind: 'list', members: [memberId('sby01')] };
    const trace = simulate(doc, [
      { at: 0, kind: 'link.cut', link: doc.links.find((l) => l.id === 'dc1-dc3')!.id },
      { at: 10, kind: 'link.cut', link: doc.links.find((l) => l.id === 'dc1-dc2')!.id },
    ]);
    expect(trace.facts.initiateAt).toBe(40);
  });
});

describe('the threshold clock belongs to a running master observer', () => {
  it('an observer started after the crash counts from the moment it takes over', () => {
    const doc = multiObserverDoc();
    const trace = simulate(doc, [
      { at: 0, kind: 'observer.stop', observer: observerId('obs01') },
      { at: 0, kind: 'observer.stop', observer: observerId('obs02') },
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 20, kind: 'observer.start', observer: observerId('obs01') },
    ]);
    expect(trace.facts.initiateAt).toBe(50);
  });
});

describe('SET MASTEROBSERVER is a command, not a nomination', () => {
  it('moves the role without the nomination claim', () => {
    const doc = multiObserverDoc();
    const trace = simulate(doc, [{ at: 5, kind: 'cmd.setMasterObserver', observer: observerId('obs02') }]);
    expect(decision(trace, 'NOMINATION.NEW_MASTER')).toBeUndefined();
    const d = decision(trace, 'OBS.SET_MASTEROBSERVER');
    expect(d?.at).toBe(5);
    expect(d?.claim.basis).toBe('documented');
    expect(trace.facts.observers[observerId('obs02')]?.endState).toBe('master');
    expect(trace.facts.observers[observerId('obs01')]?.endState).toBe('backup');
  });
});
