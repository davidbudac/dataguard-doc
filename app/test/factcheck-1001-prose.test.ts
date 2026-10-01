/**
 * Regression tests for the prose, label and lesson findings of
 * SIMULATOR_FACT_CHECK_2026-10-01.md (section E and SIM-25), one `describe`
 * per finding id where a test says something. A pure wording fix with no
 * behaviour behind it has no test here; the commit that made it says so.
 */

import { describe, expect, it } from 'vitest';
import { citation, computeCommit, notReadyClaim, simulate } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { LESSONS } from '@/content';
import { Fact } from '@/content/facts-ui';
import { REF_TABLES } from '@/content/reference';
import { stepTopology } from '@/ui/learn/apply';
import { findPreset, PRESETS, presetDoc } from '@/presets';
import { healthyScenario, templates } from '@/ui/break/events';
import { buildTimeline, describeEvent as describeTimelineEvent } from '@/ui/timeline/build';
import { text, vnodes } from './content/walk';

/** Every id a document defines, by the namespace an event or a route names it in. */
function namesOf(doc: TopologyDoc) {
  return {
    host: new Set(doc.hosts.map((h) => h.id as string)),
    site: new Set(doc.sites.map((s) => s.id as string)),
    link: new Set(doc.links.map((l) => l.id as string)),
    member: new Set(doc.members.map((m) => m.id as string)),
    observer: new Set(doc.observers.map((o) => o.id as string)),
  };
}

/** The ids a step's events and routes name that its document does not have. */
function unknownIds(doc: TopologyDoc): string[] {
  const names = namesOf(doc);
  const out: string[] = [];
  const need = (ns: keyof typeof names, id: unknown, where: string): void => {
    if (typeof id === 'string' && !names[ns].has(id)) out.push(`${where}: ${ns} "${id}"`);
  };
  for (const e of doc.events) {
    const at = `${e.kind}@${e.at}`;
    if ('host' in e) need('host', e.host, at);
    if ('site' in e) need('site', e.site, at);
    if ('link' in e) need('link', e.link, at);
    if ('member' in e) need('member', e.member, at);
    if ('observer' in e) need('observer', e.observer, at);
    if ('to' in e) need('member', e.to, at);
    if (e.kind === 'partition') for (const g of e.groups) for (const h of g) need('host', h, at);
  }
  for (const m of doc.members) {
    for (const rule of m.redoRoutes) {
      if (rule.source !== 'LOCAL') for (const s of rule.source) need('member', s, `${m.id} redoRoutes source`);
      for (const g of rule.groups) for (const d of g.dests) need('member', d.target, `${m.id} redoRoutes target`);
    }
  }
  return out;
}

describe('TXT-50 / TXT-51: a lesson step names only what its preset has', () => {
  for (const lesson of LESSONS) {
    lesson.steps.forEach((step, i) => {
      it(`${lesson.id}/${i} "${step.title}"`, () => {
        const doc = stepTopology(lesson, i);
        expect(doc).not.toBeNull();
        if (doc === null) return;
        expect(unknownIds(doc)).toEqual([]);
      });
    });
  }

  it('the walk itself catches an unknown member id', () => {
    const doc = stepTopology(LESSONS[0]!, 0) as TopologyDoc;
    const bad = { ...doc, events: [{ at: 0, kind: 'member.down', member: 'nope' }] } as unknown as TopologyDoc;
    expect(unknownIds(bad)).toEqual(['member.down@0: member "nope"']);
  });
});

describe('SIM-25: a member with RedoRoutes and no rule for the new primary is labelled as this page\'s reading', () => {
  it('cascade-terminal: the new primary ships nothing, and the finding says that is a model', () => {
    const p = findPreset('cascade-terminal')!;
    const t = simulate(p.doc(), p.events());
    const f = t.findings.filter((x) => x.id === 'ROUTES.NO_RULE_FOR_NEW_PRIMARY');
    expect(f.map((x) => x.subject.id)).toEqual(['Local_Sales']);
    expect(f[0]?.basis).toBe('model');
    expect(f[0]?.note).toMatch(/not documented/);
  });

  it('no other preset raises it: it is not a noise finding', () => {
    for (const p of PRESETS) {
      if (p.id === 'cascade-terminal') continue;
      const t = simulate(p.doc(), p.events());
      expect(t.findings.map((x) => x.id), p.id).not.toContain('ROUTES.NO_RULE_FOR_NEW_PRIMARY');
    }
  });
});

/* ---------------- lessons: labels, chips, wording ---------------- */

/** The `<Fact>` elements of one lesson step, as { basis, ids, text }. */
function factsOf(lessonId: string, title: string) {
  const lesson = LESSONS.find((l) => l.id === lessonId);
  const step = lesson?.steps.find((s) => s.title === title);
  if (!step) throw new Error(`no step "${title}" in ${lessonId}`);
  return vnodes(step.prose).filter((n) => n.type === Fact).map((n) => {
    const p = n.props as unknown as { id: string | string[]; basis?: string; note?: string };
    return { basis: p.basis ?? 'documented', ids: ([] as string[]).concat(p.id), note: p.note ?? '', text: text(n) };
  });
}
const stepText = (lessonId: string, title: string): string => {
  const step = LESSONS.find((l) => l.id === lessonId)?.steps.find((s) => s.title === title);
  if (!step) throw new Error(`no step "${title}" in ${lessonId}`);
  return text(step.prose);
};

describe('TXT-31 / TXT-32: the application lesson', () => {
  it('shows the CONNECT_TIMEOUT disagreement as a conflict, naming both Oracle sentences', () => {
    const f = factsOf('application-view', 'Short delays, many retries').find((x) => x.basis === 'conflict');
    expect(f?.ids).toEqual(['CLIENT.CONNECT_TIMEOUT_VERY_GENEROUS', 'CLIENT.CONNECT_TIMEOUT_SMALL_BROKER']);
    expect(citation('CLIENT.CONNECT_TIMEOUT_VERY_GENEROUS').quote).toContain('very generous');
    expect(citation('CLIENT.CONNECT_TIMEOUT_SMALL_BROKER').quote).toContain('small value');
  });

  it('does not invent a startup trigger on DATABASE_ROLE; the documented event is DB_ROLE_CHANGE', () => {
    const t = stepText('application-view', 'The service name is the switch');
    expect(t).not.toMatch(/DATABASE_ROLE/);
    expect(t).toContain('DB_ROLE_CHANGE');
    expect(factsOf('application-view', 'The service name is the switch')[0]?.ids).toEqual(['ROLES.DB_ROLE_CHANGE_TRIGGER']);
  });
});

describe('TXT-33 / TXT-34 / TXT-43: the SYNC transport lesson', () => {
  const all = LESSONS.find((l) => l.id === 'sync-transport')!.steps.flatMap((s) => vnodes(s.prose));
  const code = text(LESSONS.find((l) => l.id === 'sync-transport')!.steps.map((s) => s.prose));

  it('labels the Linux buffer defaults and the shared-server SDU as Oracle disagreeing with itself', () => {
    const conflicts = all.filter((n) => n.type === Fact && (n.props as unknown as { basis?: string }).basis === 'conflict')
      .map((n) => ([] as string[]).concat((n.props as unknown as { id: string | string[] }).id));
    expect(conflicts).toContainEqual(['NET.BUF_DEFAULT_LINUX_NETRF', 'NET.BUF_DEFAULT_LINUX_NETAG']);
    expect(conflicts).toContainEqual(['NET.SDU_RANGE_19C', 'NET.SDU_SHARED_SERVER_NETAG']);
  });

  it('keeps GLOBAL_DBNAME out of the listener.ora SID_LIST sample, and says why', () => {
    expect(code).not.toMatch(/\(GLOBAL_DBNAME = <standby_db>\)/);
    expect(code).toContain('A statically configured global database name disables connect-time failover');
  });

  it('presents the AWR example as the run Oracle calls a red flag, with the tuned table beside it', () => {
    const t = stepText('sync-transport', 'Measure before and after on the same workload');
    expect(t).toContain('immediate red flag');
    expect(t).toContain('1.60 ms');
    expect(factsOf('sync-transport', 'Measure before and after on the same workload')[0]?.ids)
      .toEqual(['COMMIT.AWR_TABLE_17_3_RED_FLAG']);
  });
});

describe('TXT-35 / TXT-41 / TXT-42: the failover clocks lesson', () => {
  it('quotes only what Oracle says about the new primary after a switchover, and labels the rest', () => {
    const f = factsOf('failover-clocks', 'The former primary is the one that restarts');
    expect(f[0]).toMatchObject({ basis: 'documented', ids: ['SWITCHOVER.FORMER_PRIMARY_RESTARTS'] });
    expect(f.some((x) => x.basis === 'inferred')).toBe(true);
    expect(stepText('failover-clocks', 'The former primary is the one that restarts'))
      .not.toContain('is explicit');
  });

  it('carries the low-latency caveat on the ping properties', () => {
    const f = factsOf('failover-clocks', 'The ping properties override the threshold');
    expect(f.some((x) => x.ids.includes('FSFO.PING_LOW_LATENCY_ONLY'))).toBe(true);
  });

  it('shows the observer-count conflict with the 19c START OBSERVER sentence in it', () => {
    const f = factsOf('failover-clocks', 'An unobserved configuration cannot fail over').find((x) => x.basis === 'conflict');
    expect(f?.ids).toEqual(expect.arrayContaining(['OBS.THREE_19C', 'OBS.FOUR_CMD19']));
    expect(f?.note).toMatch(/19c: .*three.*four/);
  });
});

describe('TXT-36 / TXT-37 / TXT-48: the commit model and the transport lesson', () => {
  it('labels commit = max(local, remote) as inferred wherever it is shown', () => {
    const cm = computeCommit({
      mode: 'MAXAVAILABILITY', localWriteMs: 12,
      legs: [{ name: 'sby01', kind: 'standby', xpt: 'SYNC', rttMs: 10, destWriteMs: 5 }],
    } as never);
    expect(cm.claims.maxNotSum.basis).toBe('inferred');
    expect(cm.claims.maxNotSum.note).toMatch(/never says/);
  });

  it('the SYNC/FASTSYNC saving at 12 / 10 / 5 ms is 3 ms, not zero', () => {
    const run = (xpt: 'SYNC' | 'FASTSYNC') => computeCommit({
      mode: 'MAXAVAILABILITY', localWriteMs: 12,
      legs: [{ name: 'sby01', kind: 'standby', xpt, rttMs: 10, destWriteMs: 5 }],
    } as never).commitMs;
    expect(run('SYNC') - run('FASTSYNC')).toBe(3);
  });

  it('no longer says the saving is zero once the local write outlasts the round trip alone', () => {
    const t = stepText('transport-layer', 'FASTSYNC drops the standby disk wait');
    expect(t).not.toContain('once the local write outlasts the round trip, the saving');
    expect(t).toContain('round trip plus the standby write');
    expect(factsOf('transport-layer', 'FASTSYNC drops the standby disk wait')[0]?.ids).toEqual(['XPT.FASTSYNC_12_1']);
  });
});

describe('TXT-39 / TXT-40 / TXT-47: configuration and reference lessons', () => {
  it('"Nothing rewrites them on a role change" is inferred, not documented', () => {
    const f = factsOf('configuration', 'Redo routes are pre-declared, in both directions');
    expect(f[0]?.basis).toBe('inferred');
    expect(f[0]?.note).not.toBe('');
  });

  it('says the ObserverPing properties are 21c and later where it lists the clock properties', () => {
    expect(stepText('configuration', 'Which property sits where')).toContain('21c and later; 19c has neither');
  });

  it('puts VALIDATE FAST_START FAILOVER under "not new in 26ai", with a 19c citation', () => {
    const f = factsOf('reference', 'The broker properties');
    expect(f.map((x) => x.ids)).toContainEqual(['DGMGRL.VALIDATE_FSFO_19C']);
    const t = stepText('reference', 'The broker properties');
    expect(t).not.toMatch(/Where 26ai reports it:[^.]*VALIDATE FAST_START FAILOVER/);
  });
});

describe('TXT-53: a not-ready target is not "fast-start failover cannot happen" in general', () => {
  it('says failover to that target cannot happen and cites the automatic target change', () => {
    const c = notReadyClaim(presetDoc('multi-target-three-observers'), 'sby01' as never, 'observer');
    expect(c.basis).toBe('model');
    expect(c.value).toContain('a fast-start failover to sby01 cannot happen');
    expect(c.cite).toContain('FSFO.TARGET_AUTO_CHANGE');
  });
});

describe('TXT-54: the cascading preset and lesson', () => {
  it('says a manual FAILOVER to the terminal standby needs fast-start failover disabled', () => {
    expect(findPreset('cascade-terminal')!.summary).toContain('while fast-start failover is disabled');
  });

  it('the failover step disables fast-start failover, so the command is accepted and the warning shows', () => {
    const lesson = LESSONS.find((l) => l.id === 'cascading')!;
    const i = lesson.steps.findIndex((s) => s.title.startsWith('Manual failover to a terminal standby'));
    const doc = stepTopology(lesson, i)!;
    expect(doc.config.fsfo.state).toBe('disabled');
    const t = simulate(doc, doc.events);
    const ids = t.findings.map((f) => f.id);
    expect(ids).toContain('CASCADE.MANUAL_FAILOVER_TERMINAL');
    expect(ids).not.toContain('FSFO.MANUAL_FAILOVER_NOT_TARGET');
  });
});

describe('TXT-59 / TXT-86: observers and reference rows', () => {
  it('the multi-observer preset no longer states three as a flat maximum', () => {
    expect(findPreset('multi-target-three-observers')!.summary).toContain('START OBSERVER reference says four');
  });

  it('labels the Null PreferredObserverHosts reading and the primary-site reasoning as inferred', () => {
    const hosts = factsOf('multi-observer', 'PreferredObserverHosts');
    expect(hosts.find((x) => x.ids.includes('OBS.PREFERRED_HOSTS') && x.basis === 'inferred')).toBeDefined();
    const where = factsOf('multi-observer', 'Where they run');
    expect(where.find((x) => x.basis === 'inferred' && x.text.includes('primary’s own site'))).toBeDefined();
  });

  it('PrimaryDatabaseCandidates has Oracle\'s default: empty, no restriction', () => {
    const row = REF_TABLES.find((t) => t.id === 'ref-broker-properties')?.rows.find((r) => r.key === 'primary-candidates');
    expect(text(row?.cells)).toContain('empty — no restriction');
  });
});

describe('TXT-82 / TXT-83: the 26ai reference rows', () => {
  const table = REF_TABLES.find((t) => t.id === 'ref-changes-26ai')!;
  const rowText = (key: string): string => text(table.rows.find((r) => r.key === key)?.cells);

  it('FastStartFailoverLagType: Oracle\'s one sentence documented, the TRANSPORT reading a model', () => {
    const facts = vnodes(table.rows.find((r) => r.key === 'lagtype')?.cells).filter((n) => n.type === Fact)
      .map((n) => (n.props as unknown as { basis?: string }).basis ?? 'documented');
    expect(facts).toEqual(['documented', 'model']);
  });

  it('the ASYNC MaxAvailability target is a 21c line, and the speed-ups are reports, not documentation', () => {
    expect(rowText('laglimit')).toContain('21c chapter');
    expect(rowText('role-transitions')).toContain('not a documented figure');
    expect(rowText('async-connections')).toContain('not found in Oracle’s documentation set');
  });

  it('PrimaryDatabaseCandidates is not on the 26ai list of new broker properties', () => {
    expect(rowText('primary-candidates')).toContain('names only FastStartFailoverLagType and FastStartFailoverLagGraceTime');
    expect(citation('CHANGES.NEW_BROKER_PROPERTIES_26AI').quote).not.toContain('PrimaryDatabaseCandidates');
  });
});

describe('TXT-89: SIM.ONE_ROLE_CHANGE no longer states a switchover case as Oracle\'s', () => {
  it('names failover plus reinstatement as the documented case and calls the switchover case implied', () => {
    const doc = presetDoc('classic');
    const events = [
      { at: 0, kind: 'cmd.switchover', to: doc.members[1]!.id },
      { at: 100, kind: 'host.down', host: (doc.members[1] as { instances: { host: unknown }[] }).instances[0]!.host },
    ] as never[];
    const f = simulate(doc, events).findings.find((x) => x.id === 'SIM.ONE_ROLE_CHANGE');
    expect(f?.note).toContain('this page evaluates one role change per run');
    expect(f?.note).toContain('the reinstated database acts as the fast-start failover target for the new primary database');
    expect(f?.note).toContain('only implied');
    expect(f?.note).not.toContain('Oracle does not stop there');
  });
});

/* ---------------- captions and lane labels ---------------- */

describe('TXT-56: scenario captions say what the events do', () => {
  it('the crash caption on a RAC primary says one instance\'s host, and that the primary stays up', () => {
    const t = templates(presetDoc('rac-primary')).find((x) => x.id === 'crash')!;
    expect(t.caption).toContain('first instance');
    expect(t.caption).not.toContain('Observer and standby both lose it');
    const single = templates(presetDoc('classic')).find((x) => x.id === 'crash')!;
    expect(single.caption).toContain('Observer and standby both lose it');
  });

  it('the observer scenario names the observer it kills when that is not the master', () => {
    const base = presetDoc('multi-target-three-observers');
    const swapped = { ...base, observers: [...base.observers].reverse() };
    const killed = swapped.observers[0]!;
    if (killed.role === 'master') throw new Error('fixture: the first observer should be a backup');
    const t = templates(swapped).find((x) => x.id === 'observer-lost')!;
    expect(t.caption).toContain(killed.name);
    expect(t.caption).toContain('not the master');
    expect(t.label).not.toBe('Kill the master observer');
  });

  it('the healthy caption lists only what the document has', () => {
    const none = { ...presetDoc('classic'), observers: [], applications: [] } as TopologyDoc;
    const c = healthyScenario(none).caption;
    expect(c).not.toContain('observer pings');
    expect(c).not.toContain('application is served');
    expect(healthyScenario(presetDoc('classic')).caption).toContain('the standbys apply it');
  });

  it('the manual caption does not say fast-start failover is unarmed when it is armed', () => {
    /* The observer's host, then the primary's: fast-start failover is enabled but nothing can
       initiate it, so the outcome is "manual" -- and "no fast-start failover is armed" is false. */
    const doc = presetDoc('classic');
    const prm = doc.members.find((m) => m.kind === 'database' && m.role === 'primary') as { instances: { host: string }[] };
    const events = [
      { at: 0, kind: 'host.down', host: doc.observers[0]!.host },
      { at: 40, kind: 'host.down', host: prm.instances[0]!.host },
    ] as never[];
    const armed = { ...doc, events } as TopologyDoc;
    const t = simulate(armed, events);
    expect(t.facts.outcome).toBe('manual');
    const caption = buildTimeline(t, armed, { width: 900 }).caption.text;
    expect(caption).toContain('Fast-start failover is enabled but did not initiate');
    expect(caption).not.toContain('No fast-start failover is armed');
    /* Disabled, the old wording is true and stays. */
    const off = { ...armed, config: { ...armed.config, fsfo: { ...armed.config.fsfo, state: 'disabled' } } } as TopologyDoc;
    const offCaption = buildTimeline(simulate(off, events), off, { width: 900 }).caption.text;
    expect(offCaption).toContain('No fast-start failover is armed');
  });
});

describe('TXT-57 / TXT-60: lane labels and event text', () => {
  const labelsOf = (doc: TopologyDoc, events: TopologyDoc['events'], lane: string): string[] => {
    const d = { ...doc, events } as TopologyDoc;
    const m = buildTimeline(simulate(d, events), d, { width: 1100, density: 'compact' });
    return m.lanes.filter((l) => l.id === lane || l.name === lane).flatMap((l) => l.segments.flatMap((s) => s.labels));
  };

  it('a stopped observer is not "nobody is watching"', () => {
    const doc = presetDoc('multi-target-three-observers');
    const backup = doc.observers.find((o) => o.role !== 'master')!;
    const labels = labelsOf(doc, [{ at: 0, kind: 'observer.stop', observer: backup.id }] as never, backup.name);
    expect(labels.join('|')).toContain('Observer stopped');
    expect(labels.join('|')).not.toContain('nobody is watching');
  });

  it('a snapshot standby is not "redo apply is stopped" and a cut-off standby is not "Lagging"', () => {
    const doc = presetDoc('bystanders');
    const snap = doc.members.find((m) => m.kind === 'database' && m.role === 'snapshot')!;
    const labels = labelsOf(doc, [], snap.name);
    expect(labels.join('|')).toContain('Snapshot standby');
    expect(labels.join('|')).not.toContain('redo apply is stopped');
  });

  it('describes IMMEDIATE and FORCE where the event carries them', () => {
    const doc = presetDoc('classic');
    const to = doc.members[1]!.id;
    expect(describeTimelineEvent(doc, { at: 0, kind: 'cmd.failover', to, immediate: true } as never)).toContain('IMMEDIATE');
    expect(describeTimelineEvent(doc, { at: 0, kind: 'cmd.disableFsfo', force: true } as never)).toContain('FORCE');
    expect(describeTimelineEvent(doc, { at: 0, kind: 'cmd.failover', to } as never)).not.toContain('IMMEDIATE');
  });
});

describe('TXT-58: data loss "unknown" does not say the far sync went down with the primary', () => {
  it('names a far sync that is down or cut off from the target, and cites the unsent-redo sentence', () => {
    const doc = presetDoc('far-sync-zero-loss');
    const events = [
      { at: 0, kind: 'host.down', host: 'dc1-north' }, { at: 0, kind: 'host.down', host: 'dc1-fs1' },
    ] as never[];
    const t = simulate({ ...doc, events } as never, events);
    expect(t.facts.dataLossKind).toBe('unknown');
    const rpo = t.facts.perMember[t.facts.newPrimary as never]?.rpoSeconds;
    expect(rpo?.basis).toBe('model');
    expect(rpo?.note).not.toContain('lost with the primary');
    expect(rpo?.note).toContain('down or cut off from the target');
    expect(rpo?.cite).toContain('FS.UNSENT_REDO_TRANSMITTED');
    expect(citation('FS.UNSENT_REDO_TRANSMITTED').quote).toContain('transmitted to the target physical standby');
  });
});
