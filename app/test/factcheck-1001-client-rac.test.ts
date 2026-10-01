/**
 * Fact check 2026-10-01, the application's client model and RAC.
 *
 * One `describe` per finding id, the Oracle sentence in a comment. The probes
 * for SIM-30 and SIM-31 live in `fact-check/probes.probe.ts`; these are the
 * regression tests that keep them fixed.
 */

import { describe, expect, it } from 'vitest';
import {
  CLASSIC_IDS, citation, claimWellFormed, classicTopology, computeApps, generateDgmgrl,
  hostId, memberId, simulate, splitBrainOf, validate, withApplication,
} from '@/engine';
import type {
  AppModel, ClientDescriptor, DatabaseMember, EngineTrace, TimedEvent, TopologyDoc,
} from '@/engine';
import { buildJdbc } from '@/engine/generate/jdbc';
import { buildTns } from '@/engine/generate/tnsnames';
import { PRESETS } from '@/presets';
import { CLIENT_TIMING_FIELDS } from '@/ui/inspector/client-timing';
import { THRESHOLD_NOTE } from '@/ui/inspector/notes';
import { LESSON_BY_ID } from '@/content/lessons';
import { clientParameters } from '@/content/reference/client-parameters';
import { Fact } from '@/content/facts-ui';
import { text, vnodes } from './content/walk';
import { renderPlain } from '../src/engine/generate/lines';

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
const M = memberId;

const dbOf = (d: TopologyDoc, id: string): DatabaseMember =>
  d.members.find((m) => (m.id as string) === id) as DatabaseMember;

const down = (at: number, member: string, instance: string): TimedEvent =>
  ({ at, kind: 'instance.down', member: M(member), instance });

const appOf = (doc: TopologyDoc, events: TimedEvent[]): AppModel => {
  const [ap] = computeApps(simulate(doc, events), doc);
  expect(ap).toBeDefined();
  return ap as AppModel;
};

const decision = (t: EngineTrace, id: string) => (t.decisions ?? []).find((d) => d.id === id);

/** The Fact ids a lesson step's prose carries, flattened. */
const factIds = (lesson: string, step: string): string[] => {
  const s = LESSON_BY_ID[lesson as 'rac']?.steps.find((x) => x.title === step);
  expect(s, `${lesson} / ${step}`).toBeDefined();
  return vnodes(s?.prose).filter((n) => n.type === Fact)
    .flatMap((n) => (Array.isArray(n.props['id']) ? n.props['id'] as string[] : [n.props['id'] as string]));
};

describe('SIM-30: a RAC primary loses an instance and the sessions on it end', () => {
  // "Any sessions active when the instance or service stops are terminated and the
  //  application user is immediately notified."
  // "If TAF is not configured, then the client only receives an error if the instance
  //  it is connected to fails."
  const racDoc = () => preset('rac-primary').doc();

  it('draws the loss, the refusal on the stopped instance and the reconnect to the survivor', () => {
    const doc = racDoc();
    const ap = appOf(doc, [down(0, 'prm01', 'prm011')]);
    expect(ap.noEvent).toBe(false);
    expect(ap.lostAt).toBe(0);
    expect(ap.instanceLoss).toEqual({ member: M('prm01'), instance: 'prm011', to: 'prm012' });
    const dials = ap.attempts[0]?.dials ?? [];
    expect(dials.map((d) => d.kind)).toEqual(['refuse', 'establish']);
    expect(ap.tConn).toBeCloseTo(0.5, 6);
  });

  it('is a loss that happens when the instance stops, at any time in the run', () => {
    const ap = appOf(racDoc(), [down(40, 'prm01', 'prm011')]);
    expect(ap.lostAt).toBe(40);
    expect(ap.instanceLoss?.instance).toBe('prm011');
    expect(ap.tConn).toBeCloseTo(40.5, 6);
  });

  it('labels what Oracle says documented and where the sessions sat as this page\'s model', () => {
    const ap = appOf(racDoc(), [down(0, 'prm01', 'prm011')]);
    const loss = ap.claims.instanceLoss!;
    expect(loss.basis).toBe('documented');
    expect(loss.cite).toEqual(expect.arrayContaining([
      'RAC.SESSIONS_TERMINATED', 'RAC.FAN_IN_FLIGHT', 'RAC.TAF_ERROR_ONLY', 'CLIENT.VIP_NEXT_ADDRESS',
    ]));
    expect(claimWellFormed(loss)).toBe(true);
    const spread = ap.claims.sessionSpread!;
    expect(spread.basis).toBe('model');
    expect(spread.note).toMatch(/not how an application's sessions are spread/);
    expect(claimWellFormed(spread)).toBe(true);
  });

  it('an instance further down the list, with LOAD_BALANCE off, touches no session', () => {
    const ap = appOf(racDoc(), [down(0, 'prm01', 'prm012')]);
    expect(ap.instanceLoss).toBeNull();
    expect(ap.noEvent).toBe(true);
    expect(ap.noEventKind).toBe('continues');
  });

  it('with LOAD_BALANCE on, the sessions sit on every listed instance, so any of them takes some', () => {
    const doc = racDoc();
    const app = doc.applications![0]!;
    const withBalance: TopologyDoc = {
      ...doc,
      client: { ...doc.client, loadBalance: true },
      applications: [{ ...app }],
    };
    const ap = appOf(withBalance, [down(0, 'prm01', 'prm012')]);
    expect(ap.instanceLoss?.instance).toBe('prm012');
    expect(ap.claims.sessionSpread?.value).toMatch(/spread over every instance/);
  });

  it('a later loss of the whole database is the outage the ladder starts from, as before', () => {
    const doc = racDoc();
    const ap = appOf(doc, [down(0, 'prm01', 'prm011'), down(5, 'prm01', 'prm012')]);
    expect(ap.instanceLoss).toBeNull();
    expect(ap.lostAt).toBe(5);
    expect(ap.startAt).toBe(5);
  });

  it('a descriptor that lists only the stopped instance sees the database stop serving, and has nowhere to land', () => {
    const doc = racDoc();
    const client: ClientDescriptor = {
      ...doc.client,
      addresses: doc.client.addresses.filter((a) => (a.host as string) !== 'dc1-node2'),
    };
    const ap = appOf({ ...doc, client }, [down(0, 'prm01', 'prm011')]);
    /* From this descriptor the database stopped serving: the ordinary outage, not an instance loss. */
    expect(ap.instanceLoss).toBeNull();
    expect(ap.tConn).toBeNull();
    expect(ap.gaveUp).not.toBeNull();
  });

  it('leaves a single-instance primary crash exactly as it was', () => {
    const doc = classicTopology({ observerLoc: 'dc3' });
    const ap = appOf(withApplication(doc), [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(ap.instanceLoss).toBeNull();
    expect(ap.lostAt).toBe(0);
  });
});

describe('SIM-31: "no fast-start failover clock starts" is this page\'s model', () => {
  // "Fast-start failover will not occur unless all instances comprising the Oracle RAC
  //  primary database are perceived to have failed."
  // "If you have an Oracle RAC primary database, consider specifying a higher value to
  //  minimize the possibility of a false failover in the event of an instance failure."
  it('the degraded-primary decision is a model, citing the sentences it rests on', () => {
    const p = preset('rac-primary');
    const d = decision(simulate(p.doc(), p.events()), 'RAC.PRIMARY_DEGRADED');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.cite).toEqual(expect.arrayContaining([
      'RAC.PRIMARY_AVAILABLE', 'RAC.LAST_INSTANCE_FSFO', 'RAC.PERCEIVED_FAILED', 'RAC.THRESHOLD_ADVICE',
    ]));
    expect(d?.claim.note).toMatch(/Neither sentence mentions a clock/);
    expect(claimWellFormed(d!.claim)).toBe(true);
  });

  it('carries the catalogue entries the report quotes, word for word', () => {
    expect(citation('RAC.PERCEIVED_FAILED').quote).toBe(
      'Fast-start failover will not occur unless all instances comprising the Oracle RAC primary database are perceived to have failed.');
    expect(citation('RAC.THRESHOLD_ADVICE').quote).toBe(
      'If you have an Oracle RAC primary database, consider specifying a higher value to minimize the possibility of a false failover in the event of an instance failure.');
    expect(citation('RAC.THRESHOLD_MISCOUNT').quote).toBe('Oracle RAC miscount + reconfiguration time + 30 seconds');
  });

  it('counts the threshold from the last instance lost, and says that is an inference', () => {
    const p = preset('rac-primary');
    const t = simulate(p.doc(), [down(0, 'prm01', 'prm011'), down(100, 'prm01', 'prm012')]);
    expect(t.facts.initiateAt).toBe(130);
    const d = decision(t, 'RAC.CLOCK_FROM_LAST_INSTANCE');
    expect(d?.at).toBe(100);
    expect(d?.claim.basis).toBe('inferred');
    expect(claimWellFormed(d!.claim)).toBe(true);
  });

  it('records no such inference while an instance still runs, or when all go at once', () => {
    const p = preset('rac-primary');
    expect(decision(simulate(p.doc(), p.events()), 'RAC.CLOCK_FROM_LAST_INSTANCE')).toBeUndefined();
    const together = simulate(p.doc(), [down(0, 'prm01', 'prm011'), down(0, 'prm01', 'prm012')]);
    expect(decision(together, 'RAC.CLOCK_FROM_LAST_INSTANCE')).toBeUndefined();
  });

  it('the preset and the lesson no longer say no clock starts as Oracle\'s word', () => {
    expect(preset('rac-primary').summary).not.toMatch(/no clock ever starts/);
    expect(preset('rac-primary').summary).toMatch(/modelling notes belong to this preset/);
    const prose = text(LESSON_BY_ID['rac'].steps.find((s) => s.title === 'Losing one primary instance')?.prose);
    expect(prose).not.toMatch(/Only when/);
    expect(factIds('rac', 'Losing one primary instance')).toEqual(expect.arrayContaining([
      'RAC.PERCEIVED_FAILED', 'RAC.THRESHOLD_ADVICE',
    ]));
  });
});

describe('SIM-32: FAILOVER=off tries one address', () => {
  // "When you set the parameter to off, no, or false, Oracle Net tries one protocol address."
  it('dials only the first address of the list, every traversal', () => {
    const doc = preset('classic').doc();
    const off: TopologyDoc = { ...doc, client: { ...doc.client, failover: false, retryCount: 2 } };
    const ap = appOf(off, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(ap.attempts).toHaveLength(3);
    for (const at of ap.attempts) expect(at.dials).toHaveLength(1);
    expect(ap.tConn).toBeNull();
    expect(ap.claims.failoverOff?.basis).toBe('model');
    expect(ap.claims.failoverOff?.cite).toContain('CLIENT.FAILOVER_OFF');
  });

  it('is untouched with FAILOVER on', () => {
    const doc = preset('classic').doc();
    const ap = appOf(doc, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(ap.claims.failoverOff).toBeUndefined();
    expect(ap.attempts[0]?.dials.length).toBeGreaterThan(1);
  });
});

describe('SIM-33: one primary instance cut off while the others reach the standby', () => {
  // "If any instance of an Oracle RAC primary database loses connectivity with a standby
  //  database, all other primary database instances stop sending redo to the standby
  //  database for the number of seconds specified on the LOG_ARCHIVE_DEST_n REOPEN attribute..."
  it('says that nothing is drawn about it, as a model', () => {
    const doc = preset('rac-primary').doc();
    /* node2 moves to the observer's site, so cutting dc1's two links isolates node1 alone. */
    const moved: TopologyDoc = {
      ...doc,
      hosts: doc.hosts.map((h) => ((h.id as string) === 'dc1-node2' ? { ...h, site: doc.hosts.find((x) => (x.id as string) === 'dc3-obs01')!.site } : h)),
    };
    const cuts: TimedEvent[] = moved.links
      .filter((l) => (l.ends as unknown as string[]).some((e) => e === 'dc1'))
      .map((l) => ({ at: 0, kind: 'link.cut' as const, link: l.id }));
    expect(cuts.length).toBeGreaterThan(0);
    const d = decision(simulate(moved, cuts), 'RAC.INSTANCE_CUT_OFF');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.cite).toEqual(expect.arrayContaining(['RAC.SOURCE_INSTANCE_LOSS_REOPEN', 'RAC.SOURCE_INSTANCE_LOSS_SYNC']));
    expect(d?.claim.note).toMatch(/draws neither the pause in redo nor the instance shutdown/);
    expect(claimWellFormed(d!.claim)).toBe(true);
  });

  it('records nothing for a healthy cluster', () => {
    const p = preset('rac-primary');
    expect(decision(simulate(p.doc(), p.events()), 'RAC.INSTANCE_CUT_OFF')).toBeUndefined();
  });
});

describe('SIM-34: a switchover ends the old primary\'s sessions with no draining drawn', () => {
  // "The WAIT option specifies that you want to wait for sessions to drain before
  //  proceeding with the switchover."
  it('discloses the missing draining as a model', () => {
    const doc = preset('classic').doc();
    const ap = appOf(doc, [{ at: 0, kind: 'cmd.switchover', to: CLASSIC_IDS.standby }]);
    expect(ap.switchover).toBe(true);
    expect(ap.claims.drain?.basis).toBe('model');
    expect(ap.claims.drain?.cite).toEqual(expect.arrayContaining(['SWITCHOVER.WAIT_DRAIN', 'SWITCHOVER.DRAIN_TIMEOUT_26AI']));
    expect(citation('SWITCHOVER.WAIT_DRAIN').quote).toBe(
      'The WAIT option specifies that you want to wait for sessions to drain before proceeding with the switchover.');
  });

  it('says nothing of draining where nothing is switched over', () => {
    const ap = appOf(preset('classic').doc(), [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(ap.claims.drain).toBeUndefined();
  });
});

describe('SIM-35 and TXT-38: a STALLED primary accepting logons is this page\'s model', () => {
  // "the primary stalls (no new transactions are able to commit)" -- nothing about logons.
  it('labels the listener answering as a model', () => {
    const doc = withApplication(classicTopology({ observerLoc: 'dc3', pmyShutdown: false }));
    const ap = appOf(doc, [
      { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 },
      { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc3 },
    ]);
    expect(ap.claims.stalledLogons?.basis).toBe('model');
    expect(ap.claims.stalledLogons?.note).toMatch(/says nothing about logons/);
    expect(claimWellFormed(ap.claims.stalledLogons!)).toBe(true);
  });

  it('is not raised where nothing stalls', () => {
    const ap = appOf(preset('classic').doc(), [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(ap.claims.stalledLogons).toBeUndefined();
  });
});

describe('TXT-16: the SCAN form on an application\'s descriptor is a deduction', () => {
  // sbydb D.1.3.2: "that address list should contain connection data for each standby database instance"
  it('labels it inferred, citing both sentences', () => {
    const file = buildTns(preset('rac-primary').doc());
    const claim = (file.claims ?? []).find((c) => /application's descriptor takes the same SCAN form/.test(c.value));
    expect(claim?.basis).toBe('inferred');
    expect(claim?.cite).toEqual(expect.arrayContaining(['RAC.SCAN_ALIASES', 'RAC.ADDRESS_LIST_EACH_INSTANCE']));
    expect(citation('RAC.ADDRESS_LIST_EACH_INSTANCE').quote).toMatch(/each standby database instance\.$/);
  });
});

describe('TXT-17 and TXT-84: the sentences under "Moving apply by hand" are the ones that say them', () => {
  // "Once the apply instance is selected and, as long as the apply instance is still running,
  //  the broker disregards the value of the PreferredApplyInstance property even if you change it."
  it('cites the disregard sentence for itself and the EDIT command for the command', () => {
    const ids = factIds('rac', 'Moving apply by hand');
    expect(ids).toEqual(expect.arrayContaining(['RAC.PREFERRED_DISREGARDED', 'RAC.SET_APPLY_INSTANCE', 'RAC.SET_STATE_UPDATES_PREFERRED']));
    expect(citation('RAC.PREFERRED_DISREGARDED').quote).toMatch(/disregards the value of the PreferredApplyInstance property even if you change it\.$/);
    expect(citation('RAC.SET_APPLY_INSTANCE').quote).toMatch(/^DGMGRL> EDIT DATABASE/);
  });
});

/** A RAC standby of three instances, apply on the first, PreferredApplyInstance sby012. */
function threeInstanceStandby(): TopologyDoc {
  const doc = preset('rac-standby').doc();
  const sby = dbOf(doc, 'sby01');
  const site = doc.hosts.find((h) => h.id === sby.instances[0]!.host)!.site;
  const third = { id: hostId('dc2-node3'), name: 'dc2-node3', site, listenerPort: 1521, cluster: 'rac2' };
  return {
    ...doc,
    hosts: [...doc.hosts, third],
    members: doc.members.map((m) => (m.id === sby.id
      ? { ...sby, preferredApplyInstance: 'sby012', instances: [...sby.instances, { name: 'sby013', host: third.id }] }
      : m)),
  };
}

describe('TXT-18: SET STATE updates PreferredApplyInstance', () => {
  // "The SET STATE command will update the PreferredApplyInstance property to the new apply
  //  instance value, and then move log apply services to the new instance."
  it('a later apply instance failover prefers the instance the command named, not the authored one', () => {
    const doc = threeInstanceStandby();
    const t = simulate(doc, [
      { at: 5, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'sby013' },
      down(10, 'sby01', 'sby013'),
    ]);
    const move = decision(t, 'RAC.SET_APPLY_INSTANCE');
    expect(move?.claim.value).toMatch(/updates PreferredApplyInstance to sby013/);
    expect(move?.claim.cite).toContain('RAC.SET_STATE_UPDATES_PREFERRED');
    const fail = (t.decisions ?? []).find((d) => d.id === 'RAC.APPLY_INSTANCE_FAILOVER');
    /* sby013 is the preference now and is down; the authored sby012 is not what the broker holds. */
    expect(fail?.claim.value).not.toMatch(/running PreferredApplyInstance/);
    expect(fail?.claim.value).toMatch(/restarts apply on sby011/);
    expect(fail?.claim.basis).toBe('model');
  });

  it('without the command the authored preference still decides', () => {
    const doc = threeInstanceStandby();
    const authored: TopologyDoc = {
      ...doc, members: doc.members.map((m) => ((m.id as string) === 'sby01' ? { ...(m as DatabaseMember), preferredApplyInstance: 'sby013' } : m)),
    };
    /* sby013 holds apply, stops (apply goes to sby011), comes back, and sby011 stops: the preference is running again. */
    const t = simulate(authored, [
      down(10, 'sby01', 'sby013'),
      { at: 20, kind: 'instance.up', member: M('sby01'), instance: 'sby013' },
      down(30, 'sby01', 'sby011'),
    ]);
    const fails = (t.decisions ?? []).filter((d) => d.id === 'RAC.APPLY_INSTANCE_FAILOVER');
    expect(fails).toHaveLength(2);
    expect(fails[1]?.claim.value).toMatch(/restarts apply on sby013/);
    expect(fails[1]?.claim.value).toMatch(/running PreferredApplyInstance/);
  });
});

describe('TXT-19: each RAC apply sentence is cited for what it says', () => {
  it('the primary\'s note cites the switchover-preparation sentence, an empty property the "randomly picks" one', () => {
    const base = preset('rac-standby').doc();
    const named: TopologyDoc = {
      ...base, members: base.members.map((m) => ((m.id as string) === 'prm01' ? { ...(m as DatabaseMember), preferredApplyInstance: 'prm011' } : m)),
    };
    const lines = generateDgmgrl(named);
    const cited = lines.lines.flatMap((l) => (l.cite ?? []));
    expect(cited).toEqual(expect.arrayContaining(['RAC.PREFERRED_FOR_SWITCHOVER']));
    const empty = generateDgmgrl({
      ...base,
      members: base.members.map((m) => {
        if ((m.id as string) !== 'sby01') return m;
        const { preferredApplyInstance: _drop, ...rest } = m as DatabaseMember;
        return rest as DatabaseMember;
      }),
    });
    expect(empty.lines.flatMap((l) => (l.cite ?? []))).toContain('RAC.APPLY_INSTANCE_RANDOM');
    expect(citation('RAC.APPLY_INSTANCE_RANDOM').quote).toMatch(/the broker randomly picks an apply instance\.$/);
  });

  it('a snapshot standby\'s finding cites the "not applicable" sentence', () => {
    const doc = preset('rac-standby').doc();
    const snap: TopologyDoc = {
      ...doc,
      members: doc.members.map((m) => ((m.id as string) === 'sby01' ? { ...(m as DatabaseMember), role: 'snapshot' as const } : m)),
    };
    const f = validate(snap).find((x) => x.id === 'RAC.PREFERRED_APPLY_UNUSED');
    expect(f?.cite).toContain('RAC.APPLY_NOT_FOR_SNAPSHOT');
    expect(f?.cite).not.toContain('RAC.APPLY_INSTANCE_SELECTION');
  });

  it('the apply-instance-after-role-change model cites the "randomly picks" sentence', () => {
    const t = simulate(threeInstanceStandby(), [{ at: 0, kind: 'cmd.switchover', to: M('sby01') }]);
    const d = (t.decisions ?? []).find((x) => x.id === 'RAC.APPLY_AFTER_ROLE_CHANGE');
    expect(d).toBeDefined();
    if (d?.claim.basis === 'model') expect(d.claim.cite).not.toContain('RAC.APPLY_INSTANCE_SELECTION');
  });
});

describe('TXT-21: the RAC claims no longer say more than their sentences', () => {
  // "If the last instance of the primary database fails, and fast-start failover is enabled,
  //  the broker can continue to provide high availability by automatically failing over..."
  it('the shared-host finding says what its sentence does and what is arithmetic', () => {
    const doc = preset('rac-primary').doc();
    const prm = dbOf(doc, 'prm01');
    const shared: TopologyDoc = {
      ...doc,
      members: doc.members.map((m) => (m.id === prm.id
        ? { ...prm, instances: prm.instances.map((i) => ({ ...i, host: prm.instances[0]!.host })) } : m)),
    };
    const f = validate(shared).find((x) => x.id === 'RAC.INSTANCES_SHARE_HOST');
    expect(f?.basis).toBe('model');
    expect(f?.note).toMatch(/RAC\.PRIMARY_AVAILABLE is the sentence that makes one running instance enough/);
  });
});

describe('TXT-71: the RAC claims\' own sentences are in the catalogue', () => {
  // "(This feature requires the standby database to have a license for the Oracle Active Data Guard option.)"
  it('holds the multi-instance Redo Apply license sentence, 19c only', () => {
    const c = citation('RAC.MULTI_INSTANCE_APPLY_LICENSE');
    expect(c.edition).toBe('19c');
    expect(c.quote).toBe('(This feature requires the standby database to have a license for the Oracle Active Data Guard option.)');
  });
});

describe('TXT-72: a refused address is instant because the listener says so, and the ladder is per node', () => {
  // "the listener on the standby will answer immediately that the service is not there,
  //  prompting the client to connect to the other ADDRESS_LIST."
  it('REFUSAL cites that sentence beside ORA-12514; the single-IP model discloses the per-node ladder', () => {
    const ap = appOf(preset('classic').doc(), [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
    expect(ap.claims.refusal.basis).toBe('documented');
    expect(ap.claims.refusal.cite).toEqual(expect.arrayContaining(['ORA.12514', 'CLIENT.LISTENER_ANSWERS_IMMEDIATELY']));
    expect(ap.claims.singleIp.basis).toBe('model');
    expect(ap.claims.singleIp.cite).toContain('CLIENT.SCAN_EXPANDED');
    expect(ap.claims.singleIp.note).toMatch(/one address per node/);
    expect(citation('CLIENT.SCAN_EXPANDED').quote).toMatch(/each IP in the SCAN address is expanded internally into a separate ADDRESS string\.$/);
  });
});

describe('TXT-73: WITH APPLY INSTANCE on a primary is ignored, not refused', () => {
  // "If the target state is not APPLY-ON or if the database is currently in the primary role,
  //  the WITH APPLY INSTANCE clause is ignored even if it is specified."
  it('says the clause is ignored because the database is the primary', () => {
    const doc = preset('rac-standby').doc();
    const t = simulate(doc, [{ at: 5, kind: 'cmd.setApplyInstance', member: M('prm01'), instance: 'prm012' }]);
    const d = decision(t, 'RAC.SET_APPLY_INSTANCE');
    expect(d?.taken).toBe(false);
    expect(d?.claim.value).toMatch(/clause is ignored on prm01: it is the primary/);
    expect(d?.claim.cite).toContain('RAC.WITH_APPLY_INSTANCE_IGNORED');
    const f = t.findings.find((x) => x.id === 'RAC.SET_APPLY_INSTANCE');
    expect(f?.message).toMatch(/is the primary/);
    expect(f?.message).not.toMatch(/not a running instance of a RAC standby|is not one/);
  });

  it('still reports a stopped instance of a standby as it did', () => {
    const doc = preset('rac-standby').doc();
    const t = simulate(doc, [down(1, 'sby01', 'sby012'), { at: 5, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'sby012' }]);
    const f = t.findings.find((x) => x.id === 'RAC.SET_APPLY_INSTANCE');
    expect(f?.message).toMatch(/sby012 is not one/);
  });
});

describe('TXT-75: the RAC apply gap is recorded in a manual failover and a switchover too', () => {
  // The apply lag grows while no instance applies (ApplyInstanceTimeout 30, apply instance down).
  const gapped = (): TopologyDoc => {
    const doc = preset('rac-standby').doc();
    return { ...doc, members: doc.members.map((m) => ((m.id as string) === 'sby01' ? { ...(m as DatabaseMember), applyInstanceTimeoutSeconds: 30 } : m)) };
  };

  it('a manual failover to the standby records the gap decision', () => {
    const t = simulate(gapped(), [down(0, 'sby01', 'sby011'), { at: 20, kind: 'cmd.failover', to: M('sby01') }, { at: 20, kind: 'host.down', host: hostId('dc1-node1') }]);
    expect(decision(t, 'RAC.APPLY_GAP_IN_FAILOVER')).toBeDefined();
  });

  it('a switchover to the standby records it', () => {
    const t = simulate(gapped(), [down(0, 'sby01', 'sby011'), { at: 20, kind: 'cmd.switchover', to: M('sby01') }]);
    const d = decision(t, 'RAC.APPLY_GAP_IN_FAILOVER');
    expect(d?.claim.basis).toBe('model');
    expect(d?.at).toBe(20);
  });

  it('records nothing when apply never stopped', () => {
    const t = simulate(gapped(), [{ at: 20, kind: 'cmd.switchover', to: M('sby01') }]);
    expect(decision(t, 'RAC.APPLY_GAP_IN_FAILOVER')).toBeUndefined();
  });
});

describe('TXT-85: the threshold note keeps the RAC advice', () => {
  // "If you have an Oracle RAC primary database, consider specifying a higher value to
  //  minimize the possibility of a false failover in the event of an instance failure."
  it('says it, word for word', () => {
    expect(THRESHOLD_NOTE).toContain(citation('RAC.THRESHOLD_ADVICE').quote);
  });
});

describe('ED-13: ApplyInstances offers what the property takes', () => {
  // "Valid values 0 to 16, ALL"; Role "Standby", Standby type "Physical standby"
  it('is cleared of values the member can no longer take when instances are removed', async () => {
    const { resetHistory } = await import('@/state/history');
    const { classicDoc, doc } = await import('@/state/doc');
    const { patchDatabase, addInstance, removeInstance } = await import('@/ui/inspector/edits');
    resetHistory(classicDoc());
    const id = M('sby01');
    addInstance(id);
    addInstance(id);
    patchDatabase(id, 'Set ApplyInstances', (m) => ({ ...m, applyInstances: 3 }));
    const get = () => doc.value.topology.members.find((m) => m.id === id) as DatabaseMember;
    expect(get().instances).toHaveLength(3);
    removeInstance(id, 2);
    expect(get().applyInstances).toBe(2);
    removeInstance(id, 1);
    expect(get().applyInstances).toBeUndefined();
  });
});

describe('TXT-87: the split-brain reading cites the HA guide\'s definition and discloses stale reads', () => {
  // "The term ‘split brain’ describes a scenario where there are two copies of the same
  //  database open read-write, each operating independently of the other."
  // "A value of TRUE helps to ensure that an isolated primary database cannot satisfy user queries."
  it('no longer says Oracle does not use the term', () => {
    const doc = classicTopology({ observerLoc: 'dc3', pmyShutdown: false });
    const t = simulate(doc, [
      { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 },
      { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc3 },
    ]);
    const sb = splitBrainOf(t)!;
    expect(sb.split.basis).toBe('model');
    expect(sb.split.note).not.toMatch(/Oracle does not use the term/);
    expect(sb.split.cite).toEqual(expect.arrayContaining(['SPLIT_BRAIN.DEFINITION', 'FSFO.PMY_SHUTDOWN_NO_STALE_QUERIES']));
    expect(sb.split.note).toMatch(/Stale reads are not counted either/);
    expect(citation('SPLIT_BRAIN.DEFINITION').quote).toContain('two copies of the same database open read-write');
    expect(claimWellFormed(sb.split)).toBe(true);
  });
});

describe('ED-14, TXT-70, GEN-26, GEN-27, TXT-30: the JDBC thin defaults are split by edition', () => {
  // "Starting from Oracle AI Database Release 26ai, the default value of the
  //  TRANSPORT_CONNECT_TIMEOUT parameter is 20 seconds."
  // "...the default value of this parameter is 1 second." (RETRY_DELAY)
  const tct = CLIENT_TIMING_FIELDS.find((f) => f.name === 'TRANSPORT_CONNECT_TIMEOUT')!;
  const rd = CLIENT_TIMING_FIELDS.find((f) => f.name === 'RETRY_DELAY')!;

  it('the inspector notes name 20 s and 1 s under 26ai only', () => {
    expect(tct.note('26ai')).toMatch(/20 seconds/);
    expect(tct.note('19c')).not.toMatch(/20 seconds/);
    expect(tct.note('19c')).toMatch(/print no default/);
    expect(rd.note('26ai')).toMatch(/1 second from 26ai/);
    expect(rd.note('19c')).not.toMatch(/1 second/);
  });

  it('holds both 26ai sentences, word for word, on the JDBC page', () => {
    expect(citation('CLIENT.JDBC_TCT_26AI').quote).toBe(
      'Starting from Oracle AI Database Release 26ai, the default value of the TRANSPORT_CONNECT_TIMEOUT parameter is 20 seconds.');
    expect(citation('CLIENT.JDBC_TCT_26AI').url).toMatch(/\/26\/jjdbc\/data-sources-and-URLs\.html$/);
    expect(citation('CLIENT.JDBC_RETRY_DELAY_26AI').note).not.toMatch(/earlier drivers default RETRY_DELAY to no delay/);
  });

  it('the reference table puts the thin defaults beside Oracle Net\'s', () => {
    const cells = (key: string) => text(clientParameters.rows.find((r) => r.key === key)!.cells);
    expect(cells('tct')).toMatch(/60 s/);
    expect(cells('tct')).toMatch(/JDBC thin 20 s from 26ai/);
    expect(cells('rd')).toMatch(/JDBC thin 1 s from 26ai/);
  });

  it('the JDBC card names the thin default under 26ai and says none is printed under 19c', () => {
    const d26 = classicTopology({ transportLag: 0 });
    const d19: TopologyDoc = { ...d26, config: { ...d26.config, edition: '19c' } };
    const t26 = renderPlain(buildJdbc({ ...d26, config: { ...d26.config, edition: '26ai' } }));
    const t19 = renderPlain(buildJdbc(d19));
    expect(t26).toMatch(/from 26ai the thin driver's own default is 20 seconds/);
    expect(t19).toMatch(/19c JDBC pages print no thin default/);
    expect((buildJdbc({ ...d26, config: { ...d26.config, edition: '26ai' } }).claims ?? []).some((c) => c.cite.includes('CLIENT.JDBC_TCT_26AI'))).toBe(true);
    expect((buildJdbc(d19).claims ?? []).some((c) => c.basis === 'model' && /19c JDBC pages print no default/.test(c.value))).toBe(true);
  });

  it('the tnsnames card calls the unprinted defaults a drawing, not a default', () => {
    const file = buildTns(classicTopology({ transportLag: 0 }));
    const text2 = renderPlain(file);
    expect(text2).toContain('CONNECT_TIMEOUT (no printed default; drawn as no cap)');
    expect(text2).not.toMatch(/RETRY_DELAY \(immediate\)|\(no cap\)/);
    const claim = (file.claims ?? []).find((c) => /no printed default/.test(c.value));
    expect(claim?.basis).toBe('model');
  });

  it('the JDBC URL writes bare numbers: the page lists units only for RETRY_DELAY', () => {
    const url = renderPlain(buildJdbc(classicTopology({ tct: 3, ct: 90, rc: 30, rd: 3, transportLag: 0 })));
    expect(url).toContain('(TRANSPORT_CONNECT_TIMEOUT=3)(CONNECT_TIMEOUT=90)');
    expect(url).not.toMatch(/\d(sec|s)\)/);
    expect(citation('CLIENT.JDBC_URL_BARE').quote).toBe('(connect_timeout=60)(transport_connect_timeout=30)');
  });
});
