/**
 * Regression tests for the 2026-10-01 fact check: validation rules, routing
 * labels, defaults and ranges. One `describe` per finding id, with the Oracle
 * sentence the fix rests on in a comment above it. The report is
 * SIMULATOR_FACT_CHECK_2026-10-01.md.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import {
  BOUNDS, clamp, clampLagLimit, configurationWideServiceNameProblem, lagLimitAllowsZero,
  lagLimitIsSet, lagLimitOf, memberId, observerId, parseRedoRoutes, parseTopologyDoc, resolveRedoGraph,
  validate,
} from '@/engine';
import type { DatabaseMember, TopologyDoc } from '@/engine';
import { observer } from './topologies';
import { LESSON_BY_ID } from '@/content/lessons';
import { text } from './content/walk';
import { classicDoc, doc, makeDoc } from '@/state/doc';
import { presetDoc } from '@/presets';
import { resetHistory } from '@/state/history';
import {
  clearSelection, edition, hintsOn, lessonId, lessonStep, mode, notesOpen, selection, toast, viewport,
} from '@/state/view';
import { Inspector } from '@/ui/inspector/Inspector';
import { resetSections } from '@/ui/inspector/sections';
import { lagLimitGate } from '@/ui/inspector/why';
import { readinessGate } from '@/engine/sim/fsfo';
import {
  baseDoc, database, dbOf, farSyncDoc, M, manyDestinationsDoc, memberOf, rule, twoStandbyDoc,
} from '@/engine/validate/__tests__/fixtures';

/* ---------------- a DOM to mount the rail in ---------------- */

const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, String(v)); },
    removeItem: (k: string) => { memory.delete(k); },
    clear: () => { memory.clear(); },
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  } as unknown as Storage,
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mountInspector = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(Inspector as never, {}), root);
  return root;
};

/** Open a fold if it is shut ('Configuration' opens by itself). */
const unfold = async (root: HTMLElement, title: string): Promise<void> => {
  const tog = [...root.querySelectorAll<HTMLButtonElement>('button.grp-tog')]
    .find((b) => b.querySelector('.eyebrow')?.textContent === title);
  if (tog?.getAttribute('aria-expanded') !== 'true') tog?.click();
  await tick();
};

const input = (root: HTMLElement, label: string): HTMLInputElement =>
  root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) as HTMLInputElement;

const change = async (el: HTMLInputElement, value: string): Promise<void> => {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
};

const button = (root: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  edition.value = '19c';
  notesOpen.value = false;
  toast.value = null;
  lessonId.value = null;
  lessonStep.value = 0;
  resetSections();
  hintsOn.value = false;
  clearSelection();
});

const ids = (d: TopologyDoc): string[] => validate(d).map((f) => f.id);
const find = (d: TopologyDoc, id: string) => validate(d).find((f) => f.id === id);

/* ---------------- rules ---------------- */

describe('VAL-10: EDIT.FSFO_ENABLED_BLOCKS carries the exception, the disable rule and FORCE\'s real use', () => {
  /* "An exception to this is that a downgrade to maximum availability mode is
     allowed when fast-start failover has been enabled in maximum protection
     mode." / "Use DISABLE FAST_START FAILOVER with the FORCE option when the
     network between the primary and target standby databases is disconnected
     or when the database upon which the command is received does not have a
     connection with the primary database." */
  it('names the downgrade exception and does not tie FORCE to "unobserved"', () => {
    const f = find(baseDoc(), 'EDIT.FSFO_ENABLED_BLOCKS');
    expect(f?.message).toContain('a downgrade to maximum availability mode is allowed when fast-start failover has been enabled in maximum protection mode');
    expect(f?.message).toContain('the network between the primary and target standby databases is disconnected');
    expect(f?.message).not.toContain('unobserved');
    expect(f?.message).toContain('only if it is not the target standby database');
    expect(f?.cite).toEqual(expect.arrayContaining([
      'ORA.16654', 'MODE.DOWNGRADE_AFTER_FSFO_MAXPROT', 'FSFO.DISABLE_FORCE_USE', 'FSFO.DISABLE_STANDBY_NOT_TARGET',
    ]));
  });
});

describe('VAL-11: ALL is reserved as an observer name too', () => {
  /* "The strings "NONAME" and "ALL" cannot be used as an observer name." */
  const withName = (name: string): TopologyDoc => {
    const d = baseDoc();
    d.observers = [{ ...observer('obs01', 'dc3-obs01'), name }];
    return d;
  };

  it('flags ALL, in any case, as it does NONAME', () => {
    for (const name of ['ALL', 'all', 'NONAME', 'noname']) {
      const f = find(withName(name), 'OBS.NAME_RESERVED');
      expect(f?.severity, name).toBe('error');
      expect(f?.cite, name).toContain('OBS.NAME_RESERVED_STRINGS');
    }
    expect(ids(withName('obs01'))).not.toContain('OBS.NAME_RESERVED');
    expect(ids(withName('ALLOWED'))).not.toContain('OBS.NAME_RESERVED');
  });
});

describe('VAL-12: the master and reinstatement findings wait for fast-start failover', () => {
  /* "When fast-start failover is disabled, no observer is called the master
     observer; all observers have the same functionality." */
  const twoMasters = (fsfo: 'enabled' | 'disabled' | 'observe-only'): TopologyDoc => {
    const d = baseDoc({
      fsfo,
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3'], ['dc3-obs02', 'dc3']],
      observers: [observer('obs01', 'dc3-obs01', 'master'), observer('obs02', 'dc3-obs02', 'master')],
    });
    return d;
  };

  it('OBS.MASTER_UNIQUE is an error while enabled and an info while disabled', () => {
    expect(find(twoMasters('enabled'), 'OBS.MASTER_UNIQUE')?.severity).toBe('error');
    const off = find(twoMasters('disabled'), 'OBS.MASTER_UNIQUE');
    expect(off?.severity).toBe('info');
    expect(off?.message).toContain('no observer is called the master observer');
    expect(off?.cite).toContain('OBS.NO_MASTER_WHEN_DISABLED');
  });

  it('REINSTATE.PRECONDITIONS is a warning only while fast-start failover is enabled', () => {
    const gaps = (fsfo: 'enabled' | 'disabled' | 'observe-only'): TopologyDoc => {
      const d = baseDoc({ fsfo });
      dbOf(d, 'sby01').flashbackOn = false;
      return d;
    };
    expect(find(gaps('enabled'), 'REINSTATE.PRECONDITIONS')?.severity).toBe('warning');
    expect(find(gaps('disabled'), 'REINSTATE.PRECONDITIONS')?.severity).toBe('info');
    expect(find(gaps('observe-only'), 'REINSTATE.PRECONDITIONS')?.severity).toBe('info');
  });
});

describe('VAL-14: the snapshot standby line is drawn in two places, and the rules say so', () => {
  /* "A physical standby database cannot be converted to a snapshot standby
     database if its RedoRoutes configurable property is set to non-NULL
     value." (CONVERT DATABASE) against "The RedoRoutes property cannot be
     configured such that ... the snapshot standby would send redo data to
     another member." (RedoRoutes) */
  const snapshot = (routes: ReturnType<typeof rule>[]): TopologyDoc => {
    const d = baseDoc({ fsfo: 'disabled' });
    const s = dbOf(d, 'sby01');
    s.role = 'snapshot';
    s.redoRoutes = routes;
    return d;
  };

  it('a LOCAL rule on a snapshot standby is a conflict between the two pages, not an error', () => {
    const f = find(snapshot([rule('LOCAL', [{ target: 'ALL' }])]), 'ROUTES.SNAPSHOT_CONVERT_NONNULL');
    expect(f?.basis).toBe('conflict');
    expect(f?.cite).toEqual(expect.arrayContaining(['ROUTES.SNAPSHOT_FORBIDDEN', 'CONVERT.SNAPSHOT_REDOROUTES_NONNULL']));
    expect(ids(snapshot([rule('LOCAL', [{ target: 'ALL' }])])).filter((i) => i === 'ROUTES.SNAPSHOT_FORBIDDEN')).toEqual([]);
    expect(ids(snapshot([]))).not.toContain('ROUTES.SNAPSHOT_CONVERT_NONNULL');
  });

  it('a snapshot standby that forwards redo is still the error, and now cites the CONVERT page too', () => {
    const d = twoStandbyDoc({ targets: [M('sby01')] });
    const s = dbOf(d, 'sby02');
    s.role = 'snapshot';
    s.redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
    const f = find(d, 'ROUTES.SNAPSHOT_FORBIDDEN');
    expect(f?.severity).toBe('error');
    expect(f?.cite).toContain('CONVERT.SNAPSHOT_REDOROUTES_NONNULL');
  });

  it('the logical standby restriction is an error like the snapshot one, from adjacent bullets', () => {
    const d = twoStandbyDoc({ secondRole: 'logical', targets: [M('sby01')] });
    dbOf(d, 'sby02').redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
    expect(find(d, 'ROUTES.LOGICAL_LOCAL_ONLY')?.severity).toBe('error');
  });
});

describe('VAL-15: NetTimeout is not criticised on an ASYNC destination', () => {
  /* NET_TIMEOUT "Requires attributes: SYNC"; "Conflicts with attributes: ASYNC
     (If you specify the ASYNC attribute, redo transport services ignores it;
     no error is returned.)" */
  it('fires on a SYNC destination and stays quiet on an ASYNC one', () => {
    const d = baseDoc();
    memberOf(d, 'prm01').dests[M('sby01')] = { netTimeoutSeconds: 2, reopenSeconds: 300, maxFailure: 0 };
    expect(ids(d)).toContain('DEST.NETTIMEOUT_LOW');
    dbOf(d, 'sby01').logXptMode = 'ASYNC';
    expect(ids(d)).not.toContain('DEST.NETTIMEOUT_LOW');
    dbOf(d, 'sby01').logXptMode = 'SYNC';
    dbOf(d, 'prm01').redoRoutes = [rule('LOCAL', [{ target: M('sby01'), xpt: 'ASYNC' }])];
    expect(ids(d)).not.toContain('DEST.NETTIMEOUT_LOW');
  });
});

describe('VAL-16: what 26ai counts for the primary in maximum protection, and the conflict it carries', () => {
  /* 26ai: "If using either maximum availability or maximum performance mode,
     use the RedoRoutes property to configure the redo transport mode for the
     target standby and the database currently in the primary role." -- the
     alternative to LogXptMode is named for those two modes only. */
  const reverseSync = (edition: '19c' | '26ai', mode: 'MAXPROTECTION' | 'MAXAVAILABILITY'): TopologyDoc => {
    const d = baseDoc({ edition, mode });
    dbOf(d, 'prm01').logXptMode = 'ASYNC';
    memberOf(d, 'sby01').redoRoutes = [rule('LOCAL', [{ target: M('prm01'), xpt: 'SYNC' }])];
    return d;
  };

  it('a reverse SYNC rule satisfies the primary under 19c maximum protection, not under 26ai', () => {
    expect(ids(reverseSync('19c', 'MAXPROTECTION'))).not.toContain('XPT.PRIMARY_LOGXPTMODE');
    const f = find(reverseSync('26ai', 'MAXPROTECTION'), 'XPT.PRIMARY_LOGXPTMODE');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('the RedoRoutes alternative is named for maximum availability and maximum performance only');
  });

  it('under 26ai maximum availability the rule still counts', () => {
    expect(ids(reverseSync('26ai', 'MAXAVAILABILITY'))).not.toContain('XPT.PRIMARY_LOGXPTMODE');
  });

  /* 26ai prerequisites: "Maximum availability -- SYNC or FASTSYNC or ASYNC";
     26ai Task 3: "In maximum availability mode, set the LogXptMode database
     property for both the primary and target standby databases to SYNC or
     FASTSYNC." */
  it('the 26ai maximum availability ASYNC warnings are conflicts, with both sides cited', () => {
    const d = baseDoc({ edition: '26ai', mode: 'MAXAVAILABILITY' });
    dbOf(d, 'sby01').logXptMode = 'ASYNC';
    dbOf(d, 'prm01').logXptMode = 'ASYNC';
    for (const id of ['XPT.TABLE_4_2', 'XPT.PRIMARY_LOGXPTMODE']) {
      const f = validate(d).find((x) => x.id === id && x.severity === 'warning');
      expect(f?.basis, id).toBe('conflict');
      expect(f?.cite, id).toContain('FSFO.TASK3_MAXAVAIL_26AI');
      expect(f?.cite, id).toContain('XPT.MAXAVAIL_ASYNC_26AI');
      expect(f?.note, id).toBeTruthy();
    }
  });
});

describe('VAL-17: a static service for a single-instance database is not only about reinstatement', () => {
  /* "A single-instance database on which Oracle Restart is not configured must
     have a static service registered with the listener so that the DGMGRL CLI
     can automatically start the instance when necessary (for example, for the
     new standby after a switchover)." */
  it('says so for a database automatic reinstatement does not cover, and not for a RAC one', () => {
    const d = baseDoc({ fsfo: 'disabled' });
    dbOf(d, 'sby01').staticServices = false;
    const f = find(d, 'MEMBER.STATIC_SERVICE');
    expect(f?.severity).toBe('info');
    expect(f?.basis).toBe('inferred');
    expect(f?.note).toMatch(/Oracle Restart/);
    expect(f?.message).toContain('for example for the new standby after a switchover');
    const rac = baseDoc({ fsfo: 'disabled' });
    dbOf(rac, 'sby01').staticServices = false;
    dbOf(rac, 'sby01').instances.push({ name: 'sby012', host: dbOf(rac, 'sby01').instances[0]!.host });
    expect(ids(rac)).not.toContain('MEMBER.STATIC_SERVICE');
  });

  it('leaves the databases REINSTATE.PRECONDITIONS already names to that rule', () => {
    const d = baseDoc();
    dbOf(d, 'sby01').staticServices = false;
    expect(ids(d)).toContain('REINSTATE.PRECONDITIONS');
    expect(ids(d)).not.toContain('MEMBER.STATIC_SERVICE');
  });
});

describe('VAL-18: one primary, and names that tell members apart', () => {
  /* "...up to 253 members, including one primary database..." */
  it('flags two primaries, and none, and a blank canvas is neither', () => {
    const two = baseDoc();
    dbOf(two, 'sby01').role = 'primary';
    expect(find(two, 'MEMBER.PRIMARY_COUNT')?.severity).toBe('error');
    const none = baseDoc();
    dbOf(none, 'prm01').role = 'physical';
    expect(find(none, 'MEMBER.PRIMARY_COUNT')?.message).toContain('none of them is the primary');
    const blank = baseDoc();
    blank.members = [];
    expect(ids(blank)).not.toContain('MEMBER.PRIMARY_COUNT');
  });

  it('flags a member name used twice, and an instance name used twice in one database', () => {
    const dup = baseDoc({ extra: [database('sby02', ['dc2-sby01'], 'physical', { name: 'SBY01' })] });
    expect(find(dup, 'MEMBER.NAME_DUPLICATE')?.basis).toBe('model');
    const inst = baseDoc();
    dbOf(inst, 'sby01').instances = [
      { name: 'sby011', host: dbOf(inst, 'sby01').instances[0]!.host },
      { name: 'sby011', host: dbOf(inst, 'sby01').instances[0]!.host },
    ];
    expect(ids(inst)).toContain('MEMBER.NAME_DUPLICATE');
    expect(ids(baseDoc())).not.toContain('MEMBER.NAME_DUPLICATE');
  });
});

describe('VAL-19: a fast-start failover target that is switched off', () => {
  /* "...the broker allows the disable operation to proceed only if the standby
     database is not the target standby database for fast-start failovers." */
  it('is an error with fast-start failover on, an info while it is off', () => {
    const d = baseDoc();
    dbOf(d, 'sby01').enabled = false;
    expect(find(d, 'FSFO.TARGET_DISABLED')?.severity).toBe('error');
    d.config.fsfo.state = 'disabled';
    expect(find(d, 'FSFO.TARGET_DISABLED')?.severity).toBe('info');
  });

  it('is quiet while any named target is enabled', () => {
    const d = twoStandbyDoc({ targets: [M('sby01'), M('sby02')] });
    dbOf(d, 'sby01').enabled = false;
    expect(ids(d)).not.toContain('FSFO.TARGET_DISABLED');
  });
});

describe('VAL-20: a 26ai document is not handed the 19c deprecation sentence', () => {
  it('says what the 19c list says only under 19c', () => {
    const mk = (ed: '19c' | '26ai'): TopologyDoc => {
      const d = baseDoc({ edition: ed });
      memberOf(d, 'prm01').dests[M('sby01')] = { netTimeoutSeconds: 30, reopenSeconds: 120, maxFailure: 3 };
      return d;
    };
    const f19 = find(mk('19c'), 'DEST.DEPRECATED_19C');
    const f26 = find(mk('26ai'), 'DEST.DEPRECATED_19C');
    expect(f19?.message).toContain('not on the 19c deprecation list');
    expect(f19?.cite).toEqual(['DEST.DEPRECATED_19C']);
    expect(f26?.message).not.toContain('remain documented broker properties in 19c');
    expect(f26?.cite).toEqual(['DEST.BROKER_OWNED_PROPERTIES']);
    expect(f26?.basis).toBe('documented');
  });
});

/* ---------------- restrictions that had no rule ---------------- */

describe('destinations 11 to 31 do not support SYNC', () => {
  /* "Destinations LOG_ARCHIVE_DEST_11 through LOG_ARCHIVE_DEST_31 do not
     support the SYNC, ARCH, LOCATION, MANDATORY, or ALTERNATE attributes..." */
  it('the tenth remote destination, written LOG_ARCHIVE_DEST_11, may not be SYNC', () => {
    const f = find(manyDestinationsDoc(10), 'DEST.SYNC_ABOVE_10');
    expect(f?.basis).toBe('inferred');
    expect(f?.message).toContain('LOG_ARCHIVE_DEST_11');
    expect(ids(manyDestinationsDoc(9))).not.toContain('DEST.SYNC_ABOVE_10');
  });
});

describe('REINSTATE, SET MASTEROBSERVER and WITH APPLY INSTANCE are checked', () => {
  /* "For the REINSTATE command to succeed, Flashback Database must have been
     enabled on the database prior to the failover" */
  it('REINSTATE of a database with Flashback Database off is a warning; of a far sync instance an error', () => {
    const d = baseDoc();
    dbOf(d, 'sby01').flashbackOn = false;
    d.events = [{ at: 5, kind: 'cmd.reinstate', member: M('sby01') }];
    expect(find(d, 'EVENT.REINSTATE')?.severity).toBe('warning');
    const fs = farSyncDoc();
    fs.events = [{ at: 5, kind: 'cmd.reinstate', member: M('fs1') }];
    expect(find(fs, 'EVENT.REINSTATE')?.severity).toBe('error');
    const ok = baseDoc();
    ok.events = [{ at: 5, kind: 'cmd.reinstate', member: M('sby01') }];
    expect(ids(ok)).not.toContain('EVENT.REINSTATE');
  });

  /* "If the target state is not APPLY-ON or if the database is currently in
     the primary role, the WITH APPLY INSTANCE clause is ignored even if it is
     specified." */
  it('WITH APPLY INSTANCE on the primary is ignored, on a missing instance a warning', () => {
    const d = baseDoc();
    d.events = [{ at: 5, kind: 'cmd.setApplyInstance', member: M('prm01'), instance: 'prm01' }];
    expect(find(d, 'EVENT.SET_APPLY_INSTANCE')?.severity).toBe('info');
    d.events = [{ at: 5, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'nope' }];
    expect(find(d, 'EVENT.SET_APPLY_INSTANCE')?.severity).toBe('warning');
    d.events = [{ at: 5, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'sby01' }];
    expect(ids(d)).not.toContain('EVENT.SET_APPLY_INSTANCE');
  });

  /* "When fast-start failover is disabled, no observer is called the master
     observer" */
  it('SET MASTEROBSERVER with fast-start failover disabled moves nothing', () => {
    const d = baseDoc({ fsfo: 'disabled' });
    d.events = [{ at: 5, kind: 'cmd.setMasterObserver', observer: observerId('obs01') }];
    expect(find(d, 'EVENT.SET_MASTER_OBSERVER')?.severity).toBe('info');
    d.events = [{ at: 5, kind: 'cmd.setMasterObserver', observer: observerId('ghost') }];
    expect(find(d, 'EVENT.SET_MASTER_OBSERVER')?.severity).toBe('warning');
  });
});

describe('the RedoRoutes parser does not accept ALL mixed with groups', () => {
  /* destlist := 'ALL' [xpt] | group [',' group]* -- ALL is a list of its own */
  it('rejects ALL beside another destination or inside a group, accepts ALL alone', () => {
    expect(parseRedoRoutes('(LOCAL : ALL ASYNC)').ok).toBe(true);
    expect(parseRedoRoutes('(LOCAL : ALL, sby01)').ok).toBe(false);
    expect(parseRedoRoutes('(LOCAL : sby01, ALL)').ok).toBe(false);
    expect(parseRedoRoutes('(LOCAL : (ALL PRIORITY=1))').ok).toBe(false);
    expect(parseRedoRoutes('(LOCAL : (sby01 PRIORITY=1, sby02 PRIORITY=2))').ok).toBe(true);
  });
});

/* ---------------- routing labels ---------------- */

describe('SIM-27: a far-sync-fed target\'s readiness wears the label of what it reads', () => {
  /* MEM19: "at least one standby database that receives redo via the SYNC
     transport, either directly or through a far sync instance" */
  it('the readiness gate is this page\'s model when SYNCHRONIZED is read across a far sync hop', () => {
    const d = farSyncDoc();
    const state = {
      primary: memberId('prm01'), applyLag: {}, transportLag: {}, applyLostSince: {}, now: 0,
    } as never;
    const g = readinessGate(d, d.members.find((m) => m.id === memberId('sby01'))!, true, state);
    expect(g.passes).toBe(true);
    expect(g.claim.basis).toBe('model');
    expect(g.claim.note).toContain('SYNC.ACROSS_FARSYNC');
    /* ... and a directly fed target stays documented. */
    const direct = baseDoc();
    const gd = readinessGate(direct, direct.members.find((m) => m.id === memberId('sby01'))!, true, state);
    expect(gd.claim.basis).toBe('documented');
  });

  it('a far-sync-only MaxAvailability level cites the sentence that names the far sync path', () => {
    for (const edition of ['19c', '26ai'] as const) {
      const d = farSyncDoc({ edition, mode: 'MAXAVAILABILITY' });
      const level = resolveRedoGraph(d, { primary: memberId('prm01') }).protectionLevel;
      expect(level.value, edition).toBe('MAXAVAILABILITY');
      expect(level.cite, edition).toContain('MAXAVAIL.AT_LEAST_ONE_FARSYNC');
      expect(level.cite, edition).not.toContain('MAXAVAIL.AT_LEAST_ONE');
    }
    const direct = resolveRedoGraph(baseDoc(), { primary: memberId('prm01') }).protectionLevel;
    expect(direct.cite).toEqual(['MAXAVAIL.AT_LEAST_ONE']);
  });
});

/* ---------------- defaults and ranges ---------------- */

describe('ED-08: ConfigurationWideServiceName defaults to the primary database name', () => {
  /* "The default service name of this configuration-wide service is
     primarydbname_CFG, where the primary database name is appended with a
     suffix of _CFG." */
  it('the placeholder says <primary database name>_CFG, not the configuration name', async () => {
    const root = mountInspector();
    await tick();
    await unfold(root, 'Configuration');
    const box = input(root, 'ConfigurationWideServiceName');
    expect(box.placeholder).toContain('<primary database name>_CFG');
    expect(box.placeholder).not.toContain(doc.value.topology.config.name);
  });
});

describe('ED-09: the 26ai MaxAvailability lag limit can come back to 0', () => {
  /* "If the value is zero, the standby must have received all the redo data
     the primary has generated in order for automatic failover to occur."
     Default "Maximum availability mode: 0 seconds"; and "Must be greater
     than, or equal to, 5" -- Oracle's own conflict. */
  it('0 is allowed only where it is the broker default', () => {
    expect(lagLimitAllowsZero('26ai', 'MAXAVAILABILITY')).toBe(true);
    expect(lagLimitAllowsZero('26ai', 'MAXPERFORMANCE')).toBe(false);
    expect(lagLimitAllowsZero('19c', 'MAXAVAILABILITY')).toBe(false);
    expect(clampLagLimit('26ai', 'MAXAVAILABILITY', '0')).toBe(0);
    expect(clampLagLimit('26ai', 'MAXAVAILABILITY', 1)).toBe(0);
    expect(clampLagLimit('26ai', 'MAXAVAILABILITY', 3)).toBe(5);
    expect(clampLagLimit('26ai', 'MAXAVAILABILITY', 45)).toBe(45);
    expect(clampLagLimit('26ai', 'MAXPERFORMANCE', 0)).toBe(5);
    expect(clampLagLimit('19c', 'MAXAVAILABILITY', 0)).toBe(5);
  });

  it('the rail takes 0, and "back to the broker default" returns to not set', async () => {
    resetHistory(makeDoc(presetDoc('classic')));
    edition.value = '26ai';
    const root = mountInspector();
    await tick();
    await unfold(root, 'Fast-start failover');
    const box = input(root, 'FastStartFailoverLagLimit');
    expect(box.min).toBe('0');
    expect(box.value).toBe('0');
    await change(box, '10');
    expect(doc.value.topology.config.fsfo.lagLimitSet).toBe(true);
    expect(input(root, 'FastStartFailoverLagLimit').value).toBe('10');
    await change(input(root, 'FastStartFailoverLagLimit'), '0');
    expect(doc.value.topology.config.fsfo.lagLimitSeconds).toBe(0);
    expect(doc.value.topology.config.fsfo.lagLimitSet).toBe(true);
    await change(input(root, 'FastStartFailoverLagLimit'), '10');
    button(root, 'Back to the broker default (0)')?.click();
    await tick();
    expect(lagLimitIsSet(doc.value.topology.config.fsfo)).toBe(false);
    /* The reading edition is laid over the document: 26ai maximum availability. */
    expect(lagLimitOf({ config: { ...doc.value.topology.config, edition: '26ai' } })).toBe(0);
  });

  it('shows the disagreement as Oracle\'s, labelled a conflict', async () => {
    resetHistory(makeDoc(presetDoc('classic')));
    edition.value = '26ai';
    hintsOn.value = true;
    const root = mountInspector();
    await tick();
    await unfold(root, 'Fast-start failover');
    const chips = [...root.querySelectorAll('.fact.b-conflict')].map((e) => e.getAttribute('title'));
    expect(chips).toContain('FSFO.LAGLIMIT_RANGES');
    expect(root.textContent).toContain('Oracle does not reconcile the two');
  });
});

describe('TXT-46: the 26ai lag limit caption no longer contradicts itself', () => {
  it('reads default 0 and "at least 5" as Oracle\'s own disagreement', () => {
    const steps = LESSON_BY_ID['reference']!.steps;
    const caption = steps.map((s) => text(s.prose)).join(' ');
    expect(caption).toContain('which that default of 0 sits below; Oracle does not reconcile the two');
    expect(caption).not.toContain('30 s default and 5 s minimum still');
  });
});

describe('ED-10: ConfigurationWideServiceName takes an alphanumeric first character and 30 characters', () => {
  /* "The first character must be an alphanumeric character. There is a
     30–character maximum." */
  it('names the problem', () => {
    expect(configurationWideServiceNameProblem('north_cfg')).toBeNull();
    expect(configurationWideServiceNameProblem('')).toBeNull();
    expect(configurationWideServiceNameProblem('_cfg')).toMatch(/alphanumeric/);
    expect(configurationWideServiceNameProblem('a'.repeat(30))).toBeNull();
    expect(configurationWideServiceNameProblem('a'.repeat(31))).toMatch(/30-character maximum/);
  });

  it('a document that carries a bad one is told', () => {
    const d = baseDoc();
    d.config.configurationWideServiceName = '9'.repeat(31);
    expect(find(d, 'CFG.SERVICE_NAME_FORMAT')?.severity).toBe('error');
    d.config.configurationWideServiceName = '9'.repeat(30);
    expect(ids(d)).not.toContain('CFG.SERVICE_NAME_FORMAT');
  });

  it('the form refuses a bad name, says why, and keeps the document', async () => {
    const root = mountInspector();
    await tick();
    await unfold(root, 'Configuration');
    await change(input(root, 'ConfigurationWideServiceName'), '_cfg');
    expect(doc.value.topology.config.configurationWideServiceName).toBeUndefined();
    expect(root.querySelector('.field-note.is-warn')?.textContent).toMatch(/alphanumeric/);
    await change(input(root, 'ConfigurationWideServiceName'), 'north_cfg');
    expect(doc.value.topology.config.configurationWideServiceName).toBe('north_cfg');
  });
});

describe('ED-11: PreferredObserverHosts is disclosed as one list', () => {
  /* "Scope Database" (PROP19) */
  it('the form says Oracle sets it per database and this page keeps one list', async () => {
    hintsOn.value = true;
    const root = mountInspector();
    await tick();
    await unfold(root, 'PreferredObserverHosts');
    expect(root.textContent).toContain('Oracle sets the property on each database separately');
    expect([...root.querySelectorAll('.fact.b-model')].length).toBeGreaterThan(0);
  });
});

describe('ED-12: the ranges allow what Oracle documents', () => {
  /* "If you need more time to complete a Data Guard switchover, then change
     RETRY_COUNT greater than 100." / threshold ">= 6", lag limit ">= 5" */
  it('keeps Oracle\'s floors and lifts the ceilings', () => {
    expect(BOUNDS.thresholdSeconds.min).toBe(6);
    expect(BOUNDS.lagLimitSeconds.min).toBe(5);
    expect(clamp('thresholdSeconds', 300)).toBe(300);
    expect(clamp('lagLimitSeconds', 300)).toBe(300);
    expect(clamp('retryCount', 150)).toBe(150);
    expect(clamp('transportConnectTimeoutSeconds', 90)).toBe(90);
    expect(clamp('netTimeoutSeconds', 600)).toBe(600);
  });

  it('ApplyInstanceTimeout stores a typed 7 as 7', () => {
    expect(clamp('applyInstanceTimeoutSeconds', 7)).toBe(7);
    expect(BOUNDS.applyInstanceTimeoutSeconds.step).toBe(1);
    const d = presetDoc('rac-standby');
    const standby = d.members.find((m) => m.kind === 'database' && m.role === 'physical') as DatabaseMember;
    standby.applyInstanceTimeoutSeconds = 7;
    const back = parseTopologyDoc(JSON.parse(JSON.stringify(d)));
    const kept = back.doc?.members.find((m) => m.id === standby.id) as DatabaseMember;
    expect(kept.applyInstanceTimeoutSeconds).toBe(7);
    expect(back.issues.filter((i) => i.severity === 'repaired')).toEqual([]);
  });
});

describe('TXT-80: the lag limit is greyed in maximum protection for the right reason', () => {
  /* "The FastStartFailoverLagLimit property is not used in maximum protection
     mode." (26ai property page; 19c agrees by omission) */
  it('gives the maximum protection sentence, not the lag type wording', () => {
    for (const ed of ['19c', '26ai'] as const) {
      const d = baseDoc({ edition: ed, mode: 'MAXPROTECTION' });
      const gate = lagLimitGate(d);
      expect(gate.state, ed).toBe('off');
      const why = gate.state === 'off' ? gate.why : '';
      expect(why, ed).toContain('The FastStartFailoverLagLimit property is not used in maximum protection mode.');
      expect(why, ed).not.toContain('maximum performance mode behaviour');
    }
    expect(lagLimitGate(baseDoc({ edition: '26ai', mode: 'MAXAVAILABILITY' })).state).toBe('on');
    expect(lagLimitGate(baseDoc({ edition: '19c', mode: 'MAXPERFORMANCE' })).state).toBe('on');
    expect(lagLimitGate(baseDoc({ edition: '19c', mode: 'MAXAVAILABILITY' })).state).toBe('off');
  });
});
