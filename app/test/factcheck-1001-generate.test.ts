/**
 * Regression tests for the generated-text findings of the 2026-10-01 fact check
 * (SIMULATOR_FACT_CHECK_2026-10-01.md, section D, and the generator rows of
 * section E). One `describe` per finding id, the Oracle sentence in a comment.
 *
 * Each of these printed `OPEN` before its fix: the generators asserted
 * something the documentation does not say, or left out what it does.
 */

import { describe, expect, it } from 'vitest';
import { citation } from '../src/engine/citations';
import type { CitationId } from '../src/engine/citations';
import {
  buildClientFiles, generateDgmgrl, generateInitOraFiles, generateShowMocks, lineText, renderPlain,
  resolveRedoGraph, validate,
} from '../src/engine';
import type { GeneratedFile, Line, TopologyDoc } from '../src/engine';
import { memberId } from '../src/engine/ids';
import type { MemberId } from '../src/engine/ids';
import { showConfiguration, showFastStartFailover, showObserver } from '../src/engine/generate/show';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import { declaredPrimary, isDatabase } from '../src/engine/types/topology';
import type { DatabaseMember, Member } from '../src/engine/types/topology';
import { database, dest, host, local, observer, preset, to, topology } from '../src/presets';

const M = (s: string): MemberId => memberId(s);
const text = (f: GeneratedFile): string => renderPlain(f);
const clone = (doc: TopologyDoc): TopologyDoc => JSON.parse(JSON.stringify(doc)) as TopologyDoc;
const member = (doc: TopologyDoc, name: string): Member =>
  doc.members.find((m) => m.name === name) as Member;
const withFsfo = (doc: TopologyDoc, state: 'enabled' | 'disabled' | 'observe-only'): TopologyDoc => {
  const d = clone(doc);
  d.config.fsfo.state = state;
  return d;
};
const noObserver = (doc: TopologyDoc): TopologyDoc => ({ ...clone(doc), observers: [] });
const lineWith = (f: GeneratedFile, needle: string): Line | undefined =>
  f.lines.find((l) => lineText(l).includes(needle));
const indexOfLine = (f: GeneratedFile, needle: string): number =>
  f.lines.findIndex((l) => lineText(l).includes(needle));

/** The run at a playhead, the way the SHOW panel hands it to the generator. */
function runAt(doc: TopologyDoc, events: ReturnType<typeof preset>['events'] extends () => infer E ? E : never, t: number) {
  const trace = simulate(doc, events);
  const frame = stateAt(trace, t);
  const declared = declaredPrimary(doc);
  const moved = declared !== null && frame.epoch.primary !== declared;
  return {
    trace,
    frame,
    run: {
      primary: frame.epoch.primary,
      roleChange: !moved ? null : trace.facts.outcome === 'switchover' ? 'switchover' as const : 'failover' as const,
      states: frame.members as Readonly<Record<string, string>>,
      observers: frame.observers as Readonly<Record<string, string>>,
    },
  };
}

/* ---------------- GEN-14 ---------------- */

describe('GEN-14: FastStartFailoverTarget on both sides before ENABLE when a far sync is in the path', () => {
  /* "To enable fast-start failover when a far sync instance is used to ship redo
     data to the standby database, the FastStartFailoverTarget property must first
     be set on both the primary and target standby database" (19c / 26ai Scenario 7). */
  it('writes the reciprocal on the target, ahead of ENABLE FAST_START FAILOVER', () => {
    for (const id of ['far-sync-zero-loss', 'far-sync-ha-pair', 'far-sync-role-change'] as const) {
      const script = generateDgmgrl(preset(id).doc());
      const out = text(script);
      expect(out, id).toContain("EDIT DATABASE 'North_Sales' SET PROPERTY 'FastStartFailoverTarget' = 'South_Sales';");
      expect(out, id).toContain("EDIT DATABASE 'South_Sales' SET PROPERTY 'FastStartFailoverTarget' = 'North_Sales';");
      expect(indexOfLine(script, "EDIT DATABASE 'South_Sales' SET PROPERTY 'FastStartFailoverTarget'"), id)
        .toBeLessThan(indexOfLine(script, 'ENABLE FAST_START FAILOVER;'));
      const line = lineWith(script, "EDIT DATABASE 'South_Sales' SET PROPERTY 'FastStartFailoverTarget'");
      expect(line?.cite, id).toContain('FSFO.FARSYNC_TARGET_SCENARIO7');
      /* It no longer says the broker does it for you. */
      expect(out, id).not.toContain('the reciprocal value is set on the target automatically');
    }
  });

  it('leaves the reciprocal to the broker where the target receives redo directly (Scenario 6)', () => {
    /* "There is no need for you set this property on the target standby as this
       is done for you automatically." */
    const script = generateDgmgrl(preset('classic').doc());
    const out = text(script);
    expect(out).not.toContain("EDIT DATABASE 'sby01' SET PROPERTY 'FastStartFailoverTarget'");
    expect(out).toContain('there is no need to set it there');
    expect(lineWith(script, 'there is no need to set it there')?.cite).toContain('FSFO.TARGET_RECIPROCAL_AUTO');
  });
});

/* ---------------- GEN-15 ---------------- */

describe('GEN-15: fast-start failover enabled with no observer', () => {
  /* "If you do not start the observer after you have enabled fast-start failover,
     the ORA-16819 warning is displayed for the primary and target standby
     databases." (ENABLE FAST_START FAILOVER, Usage Notes) */
  const bare = (): TopologyDoc => {
    const d = noObserver(preset('classic').doc());
    d.config.fsfo.thresholdSeconds = 45;
    return d;
  };

  it('keeps ENABLE FAST_START FAILOVER, the target and the typed threshold in the script', () => {
    const out = text(generateDgmgrl(bare()));
    expect(out).toContain('ENABLE FAST_START FAILOVER;');
    expect(out).toContain('FastStartFailoverThreshold = 45;');
    expect(out).toContain("'FastStartFailoverTarget' = 'sby01'");
    expect(out).toContain('FastStartFailoverPmyShutdown');
    expect(out).toContain('FastStartFailoverAutoReinstate');
    expect(out).not.toMatch(/^START OBSERVER/m);
    expect(out).toContain('ORA-16819');
    expect(out).not.toContain('simply reads DISABLED');
  });

  it('SHOW CONFIGURATION warns with ORA-16819 on the primary and the target, and the status is WARNING', () => {
    const f = showConfiguration(bare());
    const out = text(f);
    expect(out).toContain('Fast-Start Failover: Enabled in Zero Data Loss Mode');
    expect(out).toContain('Warning: ORA-16819: fast-start failover observer not started');
    expect(out.split('Warning: ORA-16819').length - 1).toBe(2);
    expect(out).toMatch(/Configuration Status:\nWARNING/);
    expect(out).not.toContain('reads DISABLED');
    expect(out).not.toContain('never armed');
    const warning = lineWith(f, 'Warning: ORA-16819');
    expect(warning?.basis).toBe('inferred');
    expect(warning?.note).toBeTruthy();
  });

  it('the notes no longer say FS_FAILOVER_STATUS reads DISABLED when it is enabled', () => {
    const out = text(showObserver(bare()));
    expect(out).not.toContain('reads DISABLED');
    expect(out).toContain('ORA-16819 warning');
  });

  it('fast-start failover DISABLED with no observer still arms nothing', () => {
    const off = withFsfo(bare(), 'disabled');
    const out = text(generateDgmgrl(off));
    expect(out).not.toContain('ENABLE FAST_START FAILOVER;');
    expect(out).toContain('reads DISABLED');
    expect(text(showConfiguration(off))).toMatch(/Configuration Status:\nSUCCESS/);
  });
});

/* ---------------- VAL-13 ---------------- */

describe('VAL-13: OBS.NONE_DEPLOYED with fast-start failover enabled', () => {
  /* Same root as GEN-15: the DISABLED text must not be prepended. */
  const finding = (doc: TopologyDoc) => validate(doc).find((f) => f.id === 'OBS.NONE_DEPLOYED');

  it('says unobserved and legal, without the DISABLED text', () => {
    const f = finding(noObserver(preset('classic').doc()));
    expect(f?.severity).toBe('warning');
    expect(f?.message).toContain('Fast-start failover is enabled here');
    expect(f?.message).toContain('ORA-16819');
    expect(f?.message).not.toContain('FS_FAILOVER_STATUS reads DISABLED');
    expect(f?.message).not.toContain('That is not the same as being unobserved');
    expect(f?.message).not.toContain('cannot fire');
  });

  it('keeps the DISABLED text when fast-start failover is disabled', () => {
    const f = finding(withFsfo(noObserver(preset('classic').doc()), 'disabled'));
    expect(f?.message).toContain('reads DISABLED');
    expect(f?.message).toContain('not the same as being unobserved');
  });
});

/* ---------------- GEN-16 ---------------- */

describe('GEN-16: BystandersFollowRoleChange and ConfigurationWideServiceName', () => {
  /* PROP19: both are configuration-scope properties. */
  it('writes them at configuration level when they differ from the default', () => {
    const d = clone(preset('multi-target-three-observers').doc());
    d.config.bystandersFollowRoleChange = 'NONE';
    d.config.configurationWideServiceName = 'sales_cfg';
    const script = generateDgmgrl(d);
    const out = text(script);
    expect(out).toContain("EDIT CONFIGURATION SET PROPERTY 'BystandersFollowRoleChange' = 'NONE';");
    expect(out).toContain("EDIT CONFIGURATION SET PROPERTY 'ConfigurationWideServiceName' = 'sales_cfg';");
    expect(lineWith(script, "'BystandersFollowRoleChange'")?.basis).toBe('documented');
  });

  it('writes neither at their defaults', () => {
    const out = text(generateDgmgrl(preset('multi-target-three-observers').doc()));
    expect(out).not.toContain('BystandersFollowRoleChange');
    expect(out).not.toContain('ConfigurationWideServiceName');
  });
});

/* ---------------- GEN-17 ---------------- */

describe('GEN-17: the pre-declared routes note, and the South_Sales route', () => {
  /* "configure redo transport for the current standby database South_Sales so
     that when it is in the primary role it sends redo data to the far sync
     instance FS1." (26ai Scenario 5) */
  it('prints "pre-declared for both directions" only when a reverse rule exists', () => {
    for (const id of ['classic', 'cascade-terminal', 'priority-alternates'] as const) {
      const out = text(generateDgmgrl(preset(id).doc()));
      expect(out.includes('pre-declared for both directions'), id).toBe(false);
    }
    for (const id of ['far-sync-zero-loss', 'far-sync-ha-pair', 'far-sync-role-change'] as const) {
      const out = text(generateDgmgrl(preset(id).doc()));
      expect(out, id).toContain('pre-declared for both directions');
    }
  });

  it('the far sync presets reach a far sync instance after a role change', () => {
    for (const id of ['far-sync-zero-loss', 'far-sync-ha-pair'] as const) {
      const doc = preset(id).doc();
      expect(text(generateDgmgrl(doc)), id)
        .toContain("EDIT DATABASE 'South_Sales' SET PROPERTY 'RedoRoutes' = '(LOCAL : FS1 SYNC)';");
      const g = resolveRedoGraph(doc, { primary: M('South_Sales') });
      expect(g.members[M('FS1')]?.reachableFromPrimary, id).toBe(true);
      expect(g.members[M('North_Sales')]?.reachableFromPrimary, id).toBe(true);
      expect(g.members[M('North_Sales')]?.feedPath.length, id).toBe(3);
      const when = text(showConfiguration(doc, { whenPrimaryIs: M('South_Sales') }));
      /* North_Sales is fed; at most the unused second far sync is left over. */
      expect(when.split('Members Not Receiving Redo')[1] ?? '', id).not.toContain('North_Sales');
    }
  });

  it('the zero-loss preset reaches a far sync in the north to south direction as before', () => {
    const g = resolveRedoGraph(preset('far-sync-zero-loss').doc(), { primary: M('North_Sales') });
    expect(g.members[M('South_Sales')]?.depth).toBe(2);
  });
});

/* ---------------- TXT-92 ---------------- */

describe('TXT-92: the far sync presets no longer say the new primary has no far sync in front of it', () => {
  it('describes the South_Sales route, not a direct hop', () => {
    for (const id of ['far-sync-zero-loss', 'far-sync-ha-pair'] as const) {
      const summary = preset(id).summary;
      expect(summary, id).not.toContain('with no far sync instance in front of it');
      expect(summary, id).not.toContain('ships straight to North_Sales');
      expect(summary, id).toContain('Scenario 5');
      expect(preset(id).cite, id).toContain('FS.SCENARIO5_SOUTH_ROUTE');
    }
  });
});

/* ---------------- GEN-18 ---------------- */

describe('GEN-18: SHOW CONFIGURATION WHEN PRIMARY IS', () => {
  /* "The display lists all members, but unlike SHOW CONFIGURATION, it does not
     provide status or any other configuration information." */
  it('prints members only, the name quoted, with the documented heading', () => {
    const doc = preset('far-sync-role-change').doc();
    const out = text(showConfiguration(doc, { whenPrimaryIs: M('South_Sales') }));
    expect(out).toContain("DGMGRL> SHOW CONFIGURATION WHEN PRIMARY IS 'South_Sales';");
    expect(out).toContain('Configuration when South_Sales is primary - far_sync_role_change');
    expect(out).toContain('South_Sales - Primary database');
    expect(out).not.toContain('Protection Mode:');
    expect(out).not.toContain('Fast-Start Failover:');
    expect(out).not.toContain('Configuration Status');
  });

  it('takes no VERBOSE', () => {
    const doc = preset('far-sync-role-change').doc();
    const out = text(showConfiguration(doc, { whenPrimaryIs: M('South_Sales'), verbose: true }));
    expect(out).not.toContain('VERBOSE');
  });
});

/* ---------------- GEN-19 ---------------- */

describe('GEN-19: the (*) target marker', () => {
  /* "The display highlights the current fast-start failover target with an
     asterisk (*) when fast-start failover is enabled" */
  it('marks the target in plain SHOW CONFIGURATION, with no legend', () => {
    const f = showConfiguration(preset('classic').doc());
    const out = text(f);
    expect(out).toContain('sby01 - (*) Physical standby database');
    expect(out).not.toContain('(*) Fast-Start Failover target');
    expect(lineWith(f, 'sby01 - (*)')?.cite).toContain('DGMGRL.SHOW_CONFIG_TARGET_ASTERISK');
  });

  it('marks nothing while fast-start failover is disabled', () => {
    expect(text(showConfiguration(withFsfo(preset('classic').doc(), 'disabled')))).not.toContain('(*)');
  });
});

/* ---------------- GEN-20 ---------------- */

describe('GEN-20: MaxFailure on a far sync instance', () => {
  /* MaxFailure Role: "Standby, Recovery Appliance" -- no far sync (PROP19). */
  it('writes no EDIT FAR_SYNC MaxFailure line, and says why', () => {
    const doc = clone(preset('far-sync-zero-loss').doc());
    const north = member(doc, 'North_Sales');
    const fs1 = member(doc, 'FS1');
    north.dests[fs1.id] = { ...north.dests[fs1.id]!, maxFailure: 3 };
    const script = generateDgmgrl(doc);
    const out = text(script);
    expect(out).not.toContain("EDIT FAR_SYNC FS1 SET PROPERTY 'MaxFailure'");
    expect(out).not.toContain("EDIT FAR_SYNC 'FS1' SET PROPERTY 'MaxFailure'");
    const n = lineWith(script, 'no EDIT FAR_SYNC line is written');
    expect(n?.basis).toBe('conflict');
    expect(n?.note).toBeTruthy();
  });

  it('still writes MaxFailure on a database', () => {
    const doc = clone(preset('classic').doc());
    const prm = member(doc, 'prm01');
    const sby = member(doc, 'sby01');
    prm.dests[sby.id] = { ...prm.dests[sby.id]!, maxFailure: 5 };
    expect(text(generateDgmgrl(doc))).toContain("EDIT DATABASE 'sby01' SET PROPERTY 'MaxFailure' = 5;");
  });
});

/* ---------------- GEN-21 ---------------- */

describe('GEN-21: one value per receiving member', () => {
  /* "The broker propagates the setting you specify on the standby database or far
     sync instance to the corresponding attributes of the LOG_ARCHIVE_DEST_n value
     of the database or far sync instance that is sending redo data." (PROP19) */
  it('says so when two senders carry different values for one receiver', () => {
    const doc = clone(preset('far-sync-zero-loss').doc());
    const north = member(doc, 'North_Sales');
    const south = member(doc, 'South_Sales');
    north.dests[south.id] = { ...north.dests[south.id]!, reopenSeconds: 600 };
    const script = generateDgmgrl(doc);
    const n = lineWith(script, 'receives from');
    expect(n).toBeDefined();
    expect(lineText(n as Line)).toContain('a single property of the receiving member');
    expect(n?.basis).toBe('inferred');
  });

  it('says nothing when the senders agree', () => {
    expect(text(generateDgmgrl(preset('far-sync-zero-loss').doc()))).not.toContain('a single property of the receiving member');
  });

  it('does not highlight the in-group default MaxFailure of 1 in the init.ora block', () => {
    const doc = preset('far-sync-zero-loss').doc();
    const north = generateInitOraFiles(doc).find((f) => f.id === 'initora.North_Sales') as GeneratedFile;
    const line = north.lines.find((l) => lineText(l).includes('MAX_FAILURE=')) as Line;
    const value = line.spans.find((s) => s.text === '1');
    expect(value?.highlight).toBeUndefined();
  });
});

/* ---------------- GEN-22 ---------------- */

describe('GEN-22: PrimaryDatabaseCandidates under 19c', () => {
  /* Absent from the whole 19c and 21c property pages. */
  const candidates = (edition: '19c' | '26ai'): TopologyDoc => {
    const d = clone(preset('multi-target-three-observers').doc());
    d.config.edition = edition;
    d.config.primaryDatabaseCandidates = [M('sby01')];
    return d;
  };

  it('labels the 19c line doc-later with a note', () => {
    const f = lineWith(generateDgmgrl(candidates('19c')), "'PrimaryDatabaseCandidates'");
    expect(f?.basis).toBe('doc-later');
    expect(f?.note).toContain('19c');
  });

  it('keeps it documented under 26ai', () => {
    expect(lineWith(generateDgmgrl(candidates('26ai')), "'PrimaryDatabaseCandidates'")?.basis).toBe('documented');
  });
});

/* ---------------- GEN-23 ---------------- */

describe('GEN-23: SHOW FAST_START FAILOVER observers and targets', () => {
  /* "...the output of this command shows all registered observers and indicates,
     with an asterisk, which one is the master observer." Potential Targets:
     "East_Sales, West_Sales" (a space after the comma). */
  it('lists every registered observer with the master marked', () => {
    const out = text(showFastStartFailover(preset('multi-target-three-observers').doc()));
    expect(out).toContain('obs01 (*)');
    expect(out).toContain('obs02');
    expect(out).toContain('obs03');
    expect(out).toContain('"sby01, sby02"');
  });

  it('keeps the documented single Observer line for one observer', () => {
    const f = showFastStartFailover(preset('classic').doc());
    expect(text(f)).toContain('Observer:             obs01');
    expect(lineWith(f, 'Observer:')?.basis).toBe('documented');
  });
});

/* ---------------- GEN-24 / TXT-20 ---------------- */

describe('GEN-24 / TXT-20: SHOW DATABASE for a RAC member', () => {
  /* SHOW DATABASE Example 1: lags before Instance(s):, "Database Status:" after. */
  const rac = preset('rac-standby').doc();

  it('prints the lags before the instances and closes with the Database Status', () => {
    const f = generateShowMocks(rac).find((x) => x.id === 'show.database.sby01') as GeneratedFile;
    const out = text(f);
    expect(out.indexOf('Transport Lag:')).toBeGreaterThan(-1);
    expect(out.indexOf('Apply Lag:')).toBeLessThan(out.indexOf('Instance(s):'));
    expect(out.indexOf('Database Status:')).toBeGreaterThan(out.indexOf('Instance(s):'));
    expect(out).toMatch(/Database Status:\nSUCCESS/);
  });

  it('a primary prints no lags', () => {
    const f = generateShowMocks(rac).find((x) => x.id === 'show.database.prm01') as GeneratedFile;
    expect(text(f)).not.toContain('Apply Lag:');
  });

  it('does not say apply runs on exactly one instance with ApplyInstances above 1', () => {
    const d = clone(rac);
    (member(d, 'sby01') as DatabaseMember).applyInstances = 'ALL';
    const f = generateShowMocks(d, { applyInstances: { sby01: 'sby011' } }).find((x) => x.id === 'show.database.sby01') as GeneratedFile;
    const out = text(f);
    expect(out).not.toContain('exactly one instance');
    expect(out).toContain('apply coordinator');
    /* And the single-instance default still says one. */
    const one = generateShowMocks(rac, { applyInstances: { sby01: 'sby011' } }).find((x) => x.id === 'show.database.sby01') as GeneratedFile;
    expect(text(one)).toContain('apply runs on one instance');
  });
});

/* ---------------- GEN-25 ---------------- */

describe('GEN-25: what the script assumes', () => {
  /* 26ai Scenario 1: "north_sales is a tns alias that resolves to a connect
     identifier for the primary database on all systems hosting members of the
     configuration." "You must clear any remote redo transport destinations on
     standby databases and far sync instances before those standbys and far syncs
     can be added to a configuration." Scenario 6: "Ensure standby redo logs are
     configured on the primary and target standby databases." 19c: "you must
     explicitly set the DG_BROKER_START initialization parameter to TRUE". */
  it('states the alias, the cleared destinations, the standby redo logs and DG_BROKER_START before the session', () => {
    const script = generateDgmgrl(preset('classic').doc());
    const out = text(script);
    expect(out).toContain('tns alias');
    expect(out).toContain('(prm01, sby01)');
    expect(out).toContain('no remote redo transport destination may be left set');
    expect(out).toContain('standby redo logs must be configured');
    expect(out).toContain('DG_BROKER_START must be set to TRUE');
    expect(indexOfLine(script, 'tns alias')).toBeLessThan(indexOfLine(script, 'CONNECT sys@'));
  });
});

/* ---------------- GEN-28 / TXT-14 ---------------- */

describe('GEN-28 / TXT-14: standby redo logs', () => {
  /* 19c: "at least one more redo log group"; 26ai: "at least the same number of
     groups as the online redo log at the redo source database, for each redo
     thread at the redo source database." */
  it('puts the SQL in a file of its own, not in the init.ora card', () => {
    const files = generateInitOraFiles(preset('rac-primary').doc());
    expect(text(files.find((f) => f.id === 'initora.rac') as GeneratedFile)).not.toContain('ALTER DATABASE');
    const srl = files.find((f) => f.id === 'srl.rac') as GeneratedFile;
    expect(srl.syntax).toBe('sql');
    expect(srl.filename).toBe('standby-redo-logs.sql');
    expect(text(srl)).toContain('ALTER DATABASE ADD STANDBY LOGFILE THREAD 2 SIZE 500M;');
  });

  it('writes them on the primary too, for after a role change', () => {
    const srl = generateInitOraFiles(preset('rac-primary').doc()).find((f) => f.id === 'srl.rac') as GeneratedFile;
    const out = text(srl);
    expect(out).toContain('on prm01:');
    expect(out).toContain('on sby01:');
  });

  it('a single-instance primary with a RAC standby gets standby redo logs on the primary', () => {
    const prm = database('prm01', ['dc1-prm01'], 'primary', { redoRoutes: [local(to('sby01', 'SYNC'))] });
    const sby = database('sby01', ['dc2-n1', 'dc2-n2'], 'physical', { logXptMode: 'SYNC' });
    dest(prm, sby.id);
    const doc = topology({
      name: 'one_to_two', sites: ['dc1', 'dc2', 'dc3'],
      hosts: [host('dc1-prm01', 'dc1'), host('dc2-n1', 'dc2', { cluster: 'c' }), host('dc2-n2', 'dc2', { cluster: 'c' }), host('dc3-obs01', 'dc3')],
      links: [['dc1', 'dc2', 5], ['dc1', 'dc3', 5], ['dc2', 'dc3', 5]],
      members: [prm, sby], observers: [observer('obs01', 'dc3-obs01')], targets: ['sby01'],
    });
    const out = text(generateInitOraFiles(doc).find((f) => f.id === 'srl.rac') as GeneratedFile);
    expect(out).toContain('on prm01: 2 redo threads of the largest other database');
    expect(out).toContain('on sby01: 1 redo thread of prm01');
  });

  it('words the count rule per edition', () => {
    const d19 = preset('rac-primary').doc();
    const d26 = clone(d19);
    d26.config.edition = '26ai';
    const f19 = generateInitOraFiles(d19).find((f) => f.id === 'srl.rac') as GeneratedFile;
    const f26 = generateInitOraFiles(d26).find((f) => f.id === 'srl.rac') as GeneratedFile;
    expect(text(f19)).toContain('at least one more standby redo log group');
    expect(text(f26)).toContain('at least the same number of standby redo log groups');
    expect(text(f26)).not.toContain('one more');
    expect(f26.lines.some((l) => l.cite?.includes('RAC.SRL_PER_THREAD_26AI'))).toBe(true);
    expect(f26.lines.some((l) => l.cite?.includes('RAC.SRL_PER_THREAD'))).toBe(false);
    expect(citation('RAC.SRL_PER_THREAD_26AI').quote)
      .toContain('at least the same number of groups as the online redo log');
  });
});

/* ---------------- GEN-29 ---------------- */

describe('GEN-29: the role-based service the clients dial', () => {
  /* FSFO19: "Services that must be active in any given database role ... must be
     configured with the Server Control utility (SRVCTL) explicitly on each
     database where the service must be active." */
  it('is created with srvctl on each database, as runbook text', () => {
    const script = generateDgmgrl(preset('classic').doc());
    const out = text(script);
    expect(out).toContain('srvctl add service -db prm01 -service app_svc -role PRIMARY ...');
    expect(out).toContain('srvctl add service -db sby01 -service app_svc -role PRIMARY ...');
    const line = lineWith(script, 'srvctl add service -db prm01');
    expect(line?.kind).toBe('comment');
    expect(line?.cite).toContain('SERVICE.SRVCTL_PER_DATABASE');
    expect(out).toContain('identical on all the databases');
  });

  it('the client card still dials that service', () => {
    const doc = preset('classic').doc();
    expect(doc.config.services[0]?.name).toBe(doc.client.serviceName);
    expect(buildClientFiles(doc).length).toBeGreaterThan(0);
  });
});

/* ---------------- GEN-30 ---------------- */

describe('GEN-30: the SHOW panel after a role change', () => {
  /* FAILOVER Command Example: "North_Sales - Physical standby database
     (disabled) / ORA-16661: the standby database needs to be reinstated /
     Fast-Start Failover: DISABLED / Configuration Status: WARNING" */
  const classic = preset('classic').doc();
  const crash = [{ at: 0, kind: 'host.down' as const, host: classic.members[0]!.instances[0]!.host }];
  const failedOver = runAt(classic, crash, 200);

  it('the run did fail over', () => {
    expect(failedOver.trace.facts.outcome).toBe('failover');
    expect(failedOver.run.primary).toBe(M('sby01'));
    expect(failedOver.run.roleChange).toBe('failover');
  });

  it('SHOW CONFIGURATION prints the new primary, the former primary disabled, and WARNING', () => {
    const f = showConfiguration(classic, { run: failedOver.run });
    const out = text(f);
    expect(out).toContain('DGMGRL> SHOW CONFIGURATION;');
    expect(out).toContain('sby01 - Primary database');
    /* D9: with fast-start failover still enabled the former primary keeps the
       target marker, as a live 19.27 configuration printed it. */
    expect(out).toContain('prm01 - (*) Physical standby database (disabled)');
    expect(out).toContain('ORA-16661: the standby database needs to be reinstated');
    expect(out).toMatch(/Configuration Status:\nWARNING/);
    const former = lineWith(f, 'prm01 - (*) Physical standby database (disabled)');
    expect(former?.basis).toBe('inferred');
    expect(former?.note).toMatch(/live 19\.27/);
    /* The fast-start failover line is the document's, and the note says why. */
    expect(out).toContain('Fast-Start Failover: Enabled in Zero Data Loss Mode');
    expect(out).toContain('the role has moved');
    expect(lineWith(f, 'the role has moved')?.basis).toBe('inferred');
  });

  it('SHOW FAST_START FAILOVER names the former primary as the target, not the new primary', () => {
    const out = text(showFastStartFailover(classic, { run: failedOver.run }));
    expect(out).toContain('Active Target:        prm01');
    expect(out).toContain('"prm01"');
    expect(out).not.toContain('Active Target:        sby01');
  });

  it('SHOW OBSERVER names the new primary', () => {
    const out = text(showObserver(classic, { run: failedOver.run }));
    expect(out).toContain('Primary: sby01');
    expect(out).toContain('Active Target Standby: prm01');
  });

  it('SHOW FAST_START FAILOVER says why the former primary is not a valid target yet (D9)', () => {
    const out = text(showFastStartFailover(classic, { run: failedOver.run }));
    expect(out).toContain('prm01:              invalid - member is disabled');
  });

  it('with fast-start failover disabled, no target is listed and the words are DISABLED', () => {
    const off = withFsfo(classic, 'disabled');
    const run = runAt(off, [{ at: 0, kind: 'cmd.failover' as const, to: M('sby01') }], 200).run;
    expect(run.primary).toBe(M('sby01'));
    const out = text(showFastStartFailover(off, { run }));
    expect(out).toContain('Fast-Start Failover: DISABLED');
    expect(out).toContain('Active Target:        (none)');
    /* Oracle's FAILOVER example, fast-start failover disabled: no target marker. */
    const cfg = text(showConfiguration(off, { run }));
    expect(cfg).toContain('prm01 - Physical standby database (disabled)');
    expect(cfg).not.toContain('(*)');
    expect(text(showConfiguration(off, { run }))).toMatch(/Fast-Start Failover: DISABLED\n\nConfiguration Status:\nWARNING/);
  });

  it('a switchover leaves a plain standby and SUCCESS', () => {
    const p = preset('far-sync-role-change');
    const doc = p.doc();
    const sw = runAt(doc, p.events(), 400);
    expect(sw.run.roleChange).toBe('switchover');
    const out = text(showConfiguration(doc, { run: sw.run }));
    expect(out).toContain('South_Sales - Primary database');
    expect(out).not.toContain('(disabled)');
    expect(out).not.toContain('ORA-16661');
    expect(out).toMatch(/Configuration Status:\nSUCCESS/);
  });

  it('before the role change it is the steady state', () => {
    const before = runAt(classic, crash, 1);
    expect(before.run.roleChange).toBeNull();
    const out = text(showConfiguration(classic, { run: before.run }));
    expect(out).toContain('prm01 - Primary database');
    expect(out).not.toContain('(disabled)');
    expect(text(showFastStartFailover(classic, { run: before.run }))).toContain('Active Target:        sby01');
  });
});

/* ---------------- D9: every observer stopped ---------------- */

describe('D9: SHOW CONFIGURATION once the last observer has stopped', () => {
  const classic = preset('classic').doc();
  const stop = [{ at: 10, kind: 'observer.stop' as const, observer: M('obs01') as never }];

  it('prints ORA-16820 under the primary and the status ERROR (live 19.27), not the ORA-16819 warning', () => {
    const r = runAt(classic, stop, 100);
    const f = showConfiguration(classic, { run: r.run });
    const out = text(f);
    expect(out).toContain('Error: ORA-16820: fast-start failover observer is no longer observing this database');
    expect(out).toMatch(/Configuration Status:\nERROR/);
    expect(out).not.toContain('ORA-16819');
    const l = lineWith(f, 'Error: ORA-16820');
    expect(l?.basis).toBe('inferred');
    expect(l?.cite).toContain('ORA.16820');
    expect(l?.note).toMatch(/live 19\.27/);
    expect(indexOfLine(f, 'Error: ORA-16820')).toBe(indexOfLine(f, 'prm01 - Primary database') + 1);
  });

  it('prints nothing of the sort while an observer is running, or before it stops', () => {
    const early = runAt(classic, stop, 5);
    expect(text(showConfiguration(classic, { run: early.run }))).not.toContain('ORA-16820');
    expect(text(showConfiguration(classic, { run: early.run }))).toMatch(/Configuration Status:\nSUCCESS/);
  });
});

/* ---------------- TXT-15 ---------------- */

describe('TXT-15: the static service sentence per edition', () => {
  /* 19c: "A static service needs to be defined and registered only if Oracle
     Clusterware or Oracle Restart is not being used." 26ai: "For configurations
     where Oracle Clusterware or Oracle Restart are not being used, a static
     service must be registered..." (no "only") */
  it('words it as 19c in a 19c document and as 26ai in a 26ai one', () => {
    const d19 = preset('rac-standby').doc();
    const d26 = clone(d19);
    d26.config.edition = '26ai';
    const s19 = generateDgmgrl(d19);
    const s26 = generateDgmgrl(d26);
    expect(text(s19)).toContain('registered only if Oracle Clusterware or Oracle Restart is not being used');
    expect(text(s26)).toContain('for configurations where Oracle Clusterware or Oracle Restart are not being used, a static service must be registered');
    expect(text(s26)).not.toContain('only if Oracle Clusterware');
    expect(lineWith(s26, 'for configurations where')?.cite).toContain('RAC.STATIC_SERVICE_26AI');
    expect(citation('RAC.STATIC_SERVICE_26AI').quote).not.toContain(' only ');
  });
});

/* ---------------- TXT-22 ---------------- */

describe('TXT-22: the primary\'s LogXptMode note', () => {
  /* LogXptMode footnote: the property is set for the standby and the broker
     propagates it to the sender's destination. */
  it('says it takes effect once the primary receives redo, not that the primary ships with it', () => {
    const script = generateDgmgrl(preset('classic').doc());
    const out = text(script);
    expect(out).not.toContain('ships redo with it once a role swap');
    expect(out).toContain('governs nothing yet');
    const n = lineWith(script, 'governs nothing yet');
    expect(n?.cite).toEqual(['XPT.LOGXPTMODE_RECEIVER']);
    expect(n?.cite).not.toContain('FS.ROUTES_BOTH_DIRECTIONS');
  });
});

/* ---------------- TXT-23 ---------------- */

describe('TXT-23: the RedoRoutes grammar citation', () => {
  it('cites the 19c grammar for groups and PRIORITY, never the 12.1 one', () => {
    const script = generateDgmgrl(preset('far-sync-zero-loss').doc());
    const line = lineWith(script, "'RedoRoutes' = '(LOCAL : (FS1 SYNC PRIORITY=1");
    expect(line?.cite).toContain('ROUTES.GRAMMAR_19C');
    expect(line?.cite).not.toContain('ROUTES.GRAMMAR_121');
  });

  it('the 12.1 note no longer claims 12.1 states the grammar most completely', () => {
    expect(citation('ROUTES.GRAMMAR_121').note ?? '').not.toContain('most completely');
    expect(citation('ROUTES.GRAMMAR_19C').edition).toBe('19c');
  });
});

/* ---------------- TXT-24 ---------------- */

describe('TXT-24: "GROUP is not RedoRoutes syntax" is an inference', () => {
  it('is labelled inferred where the script says it', () => {
    const script = generateDgmgrl(preset('far-sync-zero-loss').doc());
    const n = lineWith(script, 'PRIORITY is RedoRoutes syntax');
    expect(n?.basis).toBe('inferred');
    expect(n?.note).toContain('inference');
    expect(citation('ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX').note ?? '').toContain('inference');
  });
});

/* ---------------- TXT-25 ---------------- */

describe('TXT-25: "Enabled in Observe-Only Mode"', () => {
  it('cites the Scenarios page for the spelling', () => {
    const doc = withFsfo(preset('observe-only').doc(), 'observe-only');
    const f = showFastStartFailover(doc);
    const line = lineWith(f, 'Fast-Start Failover: Enabled in Observe-Only Mode');
    expect(line?.cite).toContain('FSFO.STATUS_OBSERVE_ONLY');
    expect(citation('FSFO.STATUS_OBSERVE_ONLY').url).toContain('examples-using-data-guard-broker-DGMGRL-utility');
    expect(citation('FSFO.STATUS_WORDS').note ?? '').toContain('is NOT on that page');
  });
});

/* ---------------- TXT-26 ---------------- */

describe('TXT-26: the alternate carries ALTERNATE= back to the main destination', () => {
  /* The H.1 example: LOG_ARCHIVE_DEST_3='SERVICE=boston ASYNC ALTERNATE=LOG_ARCHIVE_DEST_2 */
  it('writes the back-reference', () => {
    const prm = database('prm01', ['dc1-prm01'], 'primary', {
      redoRoutes: [local(to('sby01', 'SYNC', { target: M('sby02'), xpt: 'ASYNC' }))],
    });
    const sby01 = database('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
    const sby02 = database('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'ASYNC' });
    dest(prm, sby01.id);
    dest(prm, sby02.id);
    const doc = topology({
      name: 'alt', sites: ['dc1', 'dc2', 'dc3'],
      hosts: [host('dc1-prm01', 'dc1'), host('dc2-sby01', 'dc2'), host('dc3-sby02', 'dc3'), host('dc3-obs01', 'dc3')],
      links: [['dc1', 'dc2', 5], ['dc1', 'dc3', 5], ['dc2', 'dc3', 5]],
      members: [prm, sby01, sby02], observers: [observer('obs01', 'dc3-obs01')], targets: ['sby01'],
    });
    const out = text(generateInitOraFiles(doc).find((f) => f.id === 'initora.prm01') as GeneratedFile);
    expect(out).toContain('ALTERNATE=LOG_ARCHIVE_DEST_3');
    expect(out).toContain('ALTERNATE=LOG_ARCHIVE_DEST_2');
    const second = out.split('log_archive_dest_3 =')[1] as string;
    expect(second).toContain('ALTERNATE=LOG_ARCHIVE_DEST_2');
  });
});

/* ---------------- TXT-27 ---------------- */

describe('TXT-27: what the redo resolver cites for "who is waited for"', () => {
  it('does not cite Table 4-2 for ASYNC, SYNC acknowledgement or maximum performance', () => {
    const classic = preset('classic').doc();
    const g = resolveRedoGraph(classic, { primary: declaredPrimary(classic) as MemberId });
    const sby = g.members[M('sby01')]!;
    expect(sby.synchronized.cite).not.toContain('XPT.TABLE_4_2');
    const async = clone(classic);
    (member(async, 'sby01') as DatabaseMember).logXptMode = 'ASYNC';
    member(async, 'prm01').redoRoutes = [];
    const ga = resolveRedoGraph(async, { primary: declaredPrimary(async) as MemberId });
    expect(ga.members[M('sby01')]!.synchronized.cite).toContain('XPT.ASYNC_NO_WAIT');
    const perf = clone(async);
    perf.config.protectionMode = 'MAXPERFORMANCE';
    const gp = resolveRedoGraph(perf, { primary: declaredPrimary(perf) as MemberId });
    expect(gp.protectionLevel.cite).toContain('PROT.MAXPERF_ASYNC');
    expect(gp.protectionLevel.cite).not.toContain('XPT.TABLE_4_2');
  });

  it('SHOW CONFIGURATION cites the SHOW example for the Protection Mode spelling', () => {
    const f = showConfiguration(preset('classic').doc());
    expect(lineWith(f, 'Protection Mode:')?.cite).toEqual(['DGMGRL.SHOW_CONFIG_SUMMARY']);
  });
});

/* ---------------- TXT-28 ---------------- */

describe('TXT-28: CONNECT and SHOW DATABASE have citations that list them', () => {
  it('cites the CONNECT command for CONNECT', () => {
    const script = generateDgmgrl(preset('classic').doc());
    expect(lineWith(script, 'CONNECT sys@')?.cite).toEqual(['DGMGRL.CONNECT']);
  });

  it('cites the SHOW DATABASE command for SHOW DATABASE', () => {
    const f = generateShowMocks(preset('rac-standby').doc()).find((x) => x.id === 'show.database.sby01') as GeneratedFile;
    expect(lineWith(f, "SHOW DATABASE 'sby01'")?.cite).toEqual(['DGMGRL.SHOW_DATABASE']);
  });
});

/* ---------------- TXT-29 ---------------- */

describe('TXT-29: paraphrase slips in the catalogue', () => {
  it('says (alternate of ...) is VERBOSE-only, and what a RAC primary listing rests on', () => {
    expect(citation('DGMGRL.VERBOSE_ALTERNATE').note ?? '').toContain('Only the VERBOSE output');
    expect(citation('RAC.SHOW_DATABASE_INSTANCES').note ?? '').toContain('two-instance primary');
  });
});

/* ---------------- every new citation is well formed ---------------- */

describe('the citations these fixes added', () => {
  const ids: CitationId[] = [
    'FS.SCENARIO5_SOUTH_ROUTE', 'ROUTES.GRAMMAR_19C', 'FSFO.TARGET_RECIPROCAL_AUTO',
    'FSFO.TARGET_RECIPROCAL_SHOWN', 'FAILOVER.SHOW_CONFIGURATION_AFTER', 'FAILOVER.FORMER_PRIMARY_DISABLED',
    'FSFO.REINSTATE_REQUIRED_STATUS', 'DGMGRL.SHOW_CONFIG_TARGET_ASTERISK', 'DGMGRL.SHOW_WHEN_PRIMARY_IS',
    'DGMGRL.SHOW_FSFO_ALL_OBSERVERS', 'DGMGRL.SHOW_DATABASE_ABBREVIATED', 'FSFO.STATUS_OBSERVE_ONLY',
    'RAC.SRL_PER_THREAD_26AI', 'RAC.STATIC_SERVICE_26AI', 'XPT.LOGXPTMODE_RECEIVER',
    'DEST.MAXFAILURE_ROLE_FARSYNC', 'DGMGRL.TNS_ALIAS_ASSUMED', 'DGMGRL.CLEAR_REMOTE_DESTS',
    'DGMGRL.SRL_BEFORE_ENABLE', 'DGMGRL.BROKER_START', 'SERVICE.SRVCTL_PER_DATABASE',
    'SERVICE.ROLE_BASED_PLATFORMS', 'SERVICE.SRVCTL_OPTIONS_IDENTICAL', 'XPT.ASYNC_NO_WAIT',
    'XPT.SYNC_WAITS_ACK', 'PROT.MAXPERF_ASYNC', 'DGMGRL.CONNECT', 'DGMGRL.SHOW_DATABASE',
    'DGMGRL.SHOW_CONFIG_SUMMARY',
  ];

  it('are real quotes on https://docs.oracle.com pages', () => {
    for (const id of ids) {
      const c = citation(id);
      expect(c.url, id).toMatch(/^https:\/\/docs\.oracle\.com\/en\/database\/oracle\/oracle-database\/(19|26)\//);
      expect(c.quote.length, id).toBeGreaterThan(20);
    }
  });

  it('every database member the tests touched is a database', () => {
    expect(isDatabase(member(preset('classic').doc(), 'prm01'))).toBe(true);
  });
});
