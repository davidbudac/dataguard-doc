/**
 * Golden files for the configuration generators -- engine design SS7, SS8.4.
 *
 * Five topologies, each rendered to one golden text file: the classic 1+1+1
 * workbench, the far sync pair of Example 5-2, the cascade of Example 4-2, the
 * PRIORITY alternates of Example 4-3, and a multi-target configuration watched
 * by three observers.
 *
 * Beside the goldens the tests pin the traps the fact sheet lists:
 *   - `FILE IS`, and never `FILE=`,
 *   - `GROUP` never inside a RedoRoutes string,
 *   - the target list is an *order*, never "the first viable one in the list",
 *   - every line that is not `documented` carries a note and resolvable cites.
 *
 * Regenerate with UPDATE_GOLDEN=1 npx vitest run test/generate.test.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isCitationId } from '../src/engine/citations';
import { classicTopology } from '../src/engine/compat/classic';
import { generateDgmgrl } from '../src/engine/generate/dgmgrl';
import { generateInitOra, generateInitOraFiles } from '../src/engine/generate/initora';
import { generateShowMocks, showConfiguration, showFastStartFailover } from '../src/engine/generate/show';
import type { GeneratedFile, Line } from '../src/engine/generate/lines';
import { lineText, renderPlain } from '../src/engine/generate/lines';
import { hostId, memberId, observerId } from '../src/engine/ids';
import type { MemberId } from '../src/engine/ids';
import { isDatabase } from '../src/engine/types/topology';
import type { Observer, TopologyDoc } from '../src/engine/types/topology';
import {
  build, cascadeDoc, db, dest, farSync, farSyncDoc, multiTargetDoc, observer,
} from './topologies';

/* ---------------- the golden-file harness ---------------- */

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), '__golden__');

function expectGolden(name: string, actual: string): void {
  const path = join(GOLDEN, `${name}.txt`);
  if (!existsSync(GOLDEN)) mkdirSync(GOLDEN, { recursive: true });
  if (!existsSync(path) || process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(path, actual, 'utf8');
    return;
  }
  expect(readFileSync(path, 'utf8'), `golden ${name}`).toBe(actual);
}

const renderAll = (files: readonly GeneratedFile[]): string =>
  `${files.map((f) => `===== ${f.id} -- ${f.title} =====\n\n${renderPlain(f)}`).join('\n\n')}\n`;

/* ---------------- the five topologies ---------------- */

/** Observers in these documents write their files where DGMGRL is told to. */
function withObserverFiles(doc: TopologyDoc): TopologyDoc {
  const observers: Observer[] = doc.observers.map((o) => ({
    ...o,
    fileIs: `/u01/app/oracle/dg/${o.name}/fsfo.dat`,
    logfileIs: `/u01/app/oracle/dg/${o.name}/observer.log`,
    connectIdentifier: doc.members.find((m) => isDatabase(m) && m.role === 'primary')?.connectIdentifier ?? 'prm01',
  }));
  return { ...doc, observers };
}

/** The published 1+1+1 workbench: one primary, one standby, one observer. */
const classicDoc = (): TopologyDoc => withObserverFiles(classicTopology({ logXptMode: 'sync' }));

/** Example 5-2: primary -> far sync (SYNC) -> terminal standby (ASYNC). */
const farSync52 = (): TopologyDoc => withObserverFiles(farSyncDoc());

/** Example 4-2: primary -> local standby (SYNC) -> remote standby (ASYNC). */
const cascade42 = (): TopologyDoc => withObserverFiles(cascadeDoc());

/**
 * Example 4-3 in document form: one destination group on the primary, the
 * second destination a lower priority, so VERBOSE marks it `(alternate of ...)`.
 */
function priority43(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [{
      source: 'LOCAL',
      groups: [{
        explicitGroup: true,
        dests: [
          { target: memberId('sby01'), xpt: 'SYNC', priority: 1 },
          { target: memberId('sby02'), xpt: 'ASYNC', priority: 2 },
        ],
      }],
    }],
  });
  const sby01 = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
  const sby02 = db('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'ASYNC' });
  dest(prm, sby01.id, { maxFailure: 3 });
  dest(prm, sby02.id, { maxFailure: 3 });
  return withObserverFiles(build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc3-obs01', 'dc3']],
    members: [prm, sby01, sby02],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby01.id],
  }));
}

/** Two candidate targets and the three observers 19c registers. */
function multiTargetThreeObservers(): TopologyDoc {
  const doc = multiTargetDoc();
  const observers: Observer[] = [
    { id: observerId('obs01'), name: 'obs01', host: hostId('dc3-obs01'), role: 'master', running: true },
    { id: observerId('obs02'), name: 'obs02', host: hostId('dc4-obs02'), role: 'backup', running: true },
    { id: observerId('obs03'), name: 'obs03', host: hostId('dc5-obs03'), role: 'backup', running: true },
  ];
  const hosts = [
    ...doc.hosts,
    { id: hostId('dc4-obs02'), name: 'dc4-obs02', site: doc.sites[1]?.id ?? doc.hosts[0]!.site, listenerPort: 1521 },
    { id: hostId('dc5-obs03'), name: 'dc5-obs03', site: doc.sites[2]?.id ?? doc.hosts[0]!.site, listenerPort: 1521 },
  ];
  return withObserverFiles({ ...doc, hosts, observers });
}

/** A far sync with a second far sync pre-declared for the reverse direction. */
function farSyncPair(): TopologyDoc {
  const doc = farSync52();
  const fs2 = farSync('fs2', 'dc2-fs02', {
    redoRoutes: [{
      source: [memberId('sby01')],
      groups: [{ dests: [{ target: memberId('prm01'), xpt: 'ASYNC' }] }],
    }],
  });
  const members = doc.members.map((m) => (m.id === memberId('sby01')
    ? {
      ...m,
      redoRoutes: [{
        source: 'LOCAL' as const,
        groups: [{ dests: [{ target: fs2.id, xpt: 'SYNC' as const }] }],
      }],
    }
    : m));
  return {
    ...doc,
    hosts: [...doc.hosts, { id: hostId('dc2-fs02'), name: 'dc2-fs02', site: doc.sites[1]!.id, listenerPort: 1521 }],
    members: [...members, fs2],
  };
}

const cases: Array<[string, () => TopologyDoc]> = [
  ['classic-1-1-1', classicDoc],
  ['far-sync-5-2', farSync52],
  ['cascade-4-2', cascade42],
  ['priority-4-3', priority43],
  ['multi-target-3-observers', multiTargetThreeObservers],
];

const allFiles = (doc: TopologyDoc): GeneratedFile[] => [
  generateDgmgrl(doc),
  ...generateInitOraFiles(doc),
  ...generateShowMocks(doc, { verbose: true }),
];

/* ---------------- the goldens ---------------- */

describe('generated configuration, pinned', () => {
  for (const [name, make] of cases) {
    it(`${name} renders its golden files`, () => {
      expectGolden(name, renderAll(allFiles(make())));
    });
  }

  it('a far sync pair pre-declares the reverse route', () => {
    const text = renderPlain(generateDgmgrl(farSyncPair()));
    expect(text).toContain("ADD FAR_SYNC fs2 AS CONNECT IDENTIFIER IS fs2;");
    expect(text).toContain("EDIT FAR_SYNC 'fs2' SET PROPERTY 'RedoRoutes' = '(sby01 : prm01 ASYNC)';");
    expect(text).toContain("EDIT DATABASE 'sby01' SET PROPERTY 'RedoRoutes' = '(LOCAL : fs2 SYNC)';");
    expect(text).toContain('nothing rewrites on a role change');
  });
});

/* ---------------- the traps ---------------- */

const commandsOf = (f: GeneratedFile): Line[] => f.lines.filter((l) => l.kind === 'cmd');
const textOf = (f: GeneratedFile): string => renderPlain(f);

describe('the traps the fact sheet lists', () => {
  for (const [name, make] of cases) {
    it(`${name}: START OBSERVER spells FILE IS, never FILE=, IN BACKGROUND right after the name, CONNECT IDENTIFIER IS mandatory`, () => {
      const doc = make();
      const script = generateDgmgrl(doc);
      const text = textOf(script);
      expect(text).toContain('FILE IS');
      expect(text).not.toContain('FILE=');
      for (const o of doc.observers) {
        expect(text).toContain(`START OBSERVER ${o.name} IN BACKGROUND CONNECT IDENTIFIER IS`);
        expect(text).toContain('FILE IS');
      }
    });

    it(`${name}: GROUP never appears inside a RedoRoutes string`, () => {
      const doc = make();
      for (const line of commandsOf(generateDgmgrl(doc))) {
        const text = lineText(line);
        if (!text.includes('RedoRoutes')) continue;
        const value = text.slice(text.indexOf('=') + 1);
        expect(value, text).not.toContain('GROUP');
      }
    });

    it(`${name}: every line that is not documented carries a note`, () => {
      for (const f of allFiles(make())) {
        for (const line of f.lines) {
          if (line.basis === undefined || line.basis === 'documented') continue;
          expect(line.note, `${f.id}: ${lineText(line)}`).toBeTruthy();
        }
      }
    });

    it(`${name}: every citation on a generated line resolves`, () => {
      for (const f of allFiles(make())) {
        for (const line of f.lines) {
          for (const id of line.cite ?? []) {
            expect(isCitationId(id), `${f.id}: ${id}`).toBe(true);
          }
        }
      }
    });
  }

  it('a multi-target list is an order, never "the first viable one"', () => {
    const text = textOf(generateDgmgrl(multiTargetThreeObservers()));
    expect(text).toContain("'FastStartFailoverTarget' = 'sby01,sby02'");
    expect(text).toContain('the order in which they are specified');
    expect(text.toLowerCase()).not.toContain('first viable');
  });

  it('SET MASTEROBSERVER TO is emitted once, for the master', () => {
    const text = textOf(generateDgmgrl(multiTargetThreeObservers()));
    const hits = text.split('\n').filter((l) => l.startsWith('SET MASTEROBSERVER TO'));
    expect(hits).toEqual(['SET MASTEROBSERVER TO obs01;']);
  });

  it('starts one observer per deployed observer, in background', () => {
    const text = textOf(generateDgmgrl(multiTargetThreeObservers()));
    expect(text.split('\n').filter((l) => l.startsWith('START OBSERVER')).length).toBe(3);
  });
});

/* ---------------- the DGMGRL script's documented order ---------------- */

describe('the DGMGRL script', () => {
  const order = (text: string, ...needles: string[]): void => {
    let at = -1;
    for (const n of needles) {
      const i = text.indexOf(n);
      expect(i, n).toBeGreaterThan(-1);
      expect(i, `${n} out of order`).toBeGreaterThan(at);
      at = i;
    }
  };

  it('builds a far sync configuration in the documented order', () => {
    const text = textOf(generateDgmgrl(farSync52()));
    order(text,
      'CREATE CONFIGURATION',
      'ADD DATABASE',
      'ADD FAR_SYNC',
      "SET PROPERTY 'LogXptMode'",
      "SET PROPERTY 'RedoRoutes'",
      "SET PROPERTY 'NetTimeout'",
      'ENABLE FAR_SYNC',
      'ENABLE CONFIGURATION;',
      'EDIT CONFIGURATION SET PROTECTION MODE AS',
      'FastStartFailoverThreshold',
      "'FastStartFailoverTarget'",
      'ENABLE FAST_START FAILOVER;',
      'START OBSERVER');
  });

  it('writes the far sync transport rule when fast-start failover is armed', () => {
    const text = textOf(generateDgmgrl(farSync52()));
    expect(text).toContain('far sync transport mode must be SYNC or FASTSYNC and the target standby transport mode must be ASYNC');
  });

  it('never arms fast-start failover with no observer deployed', () => {
    const doc = { ...classicDoc(), observers: [] };
    const script = generateDgmgrl(doc);
    const text = textOf(script);
    expect(commandsOf(script).map(lineText).filter((l) => l.startsWith('ENABLE FAST_START FAILOVER'))).toEqual([]);
    expect(text).toContain('nothing arms them without ENABLE FAST_START FAILOVER and a running observer');
    expect(text).toContain('FS_FAILOVER_STATUS simply reads DISABLED');
    expect(text).toContain("FAILOVER TO 'sby01';");
  });

  it('FAILOVER TO is commented runbook text, never an executable script line (GEN-05)', () => {
    const doc = { ...classicDoc(), observers: [] };
    const script = generateDgmgrl(doc);
    expect(commandsOf(script).map(lineText).some((l) => l.startsWith('FAILOVER TO'))).toBe(false);
    const text = textOf(script);
    expect(text).toContain("-- FAILOVER TO 'sby01';");
    expect(text).toContain('verify that you are connected to the standby database that will become the new primary');
  });

  it('a new configuration stages through MAXAVAILABILITY on the way to MAXPROTECTION (GEN-03)', () => {
    const doc = classicDoc();
    const maxProt: TopologyDoc = { ...doc, config: { ...doc.config, protectionMode: 'MAXPROTECTION' } };
    const text = textOf(generateDgmgrl(maxProt));
    order(
      text,
      'EDIT CONFIGURATION SET PROTECTION MODE AS MAXAVAILABILITY;',
      'EDIT CONFIGURATION SET PROTECTION MODE AS MAXPROTECTION;',
    );
    expect(text).toContain('cannot go straight to maximum protection');

    const maxAvail = textOf(generateDgmgrl(doc));
    expect(maxAvail).not.toContain('MAXAVAILABILITY;\nEDIT CONFIGURATION SET PROTECTION MODE AS MAXPROTECTION');
  });

  it('sets ObserverReconnect and cites the property\'s own page, not ObserverConfigFile (TXT-12)', () => {
    const base = classicDoc();
    const doc: TopologyDoc = {
      ...base,
      config: { ...base.config, fsfo: { ...base.config.fsfo, observerReconnectSeconds: 60 } },
    };
    const script = generateDgmgrl(doc);
    const line = commandsOf(script).find((l) => lineText(l).includes('ObserverReconnect'));
    expect(line).toBeDefined();
    expect(line?.cite).toEqual(['OBS.OBSERVER_RECONNECT']);
    expect(line?.cite).not.toContain('OBS.OBSERVER_ORA');
  });

  it('SET MASTEROBSERVER TO states the documented preconditions (SIM-14b)', () => {
    const text = textOf(generateDgmgrl(multiTargetThreeObservers()));
    expect(text).toContain('does not happen at the instant this command is issued');
    expect(text).toContain('usually within three seconds if fast-start failover is enabled');
    expect(text).not.toContain('its preconditions are not');
  });

  it('PreferredObserverHosts is EDIT DATABASE, database-scoped, and repeated when both directions are pre-declared (ED-05)', () => {
    const base = classicDoc();
    const oneWay: TopologyDoc = {
      ...base,
      config: {
        ...base.config,
        fsfo: { ...base.config.fsfo, preferredObserverHosts: [{ host: hostId('dc3-obs01'), priority: 1 }] },
      },
    };
    const oneWayText = textOf(generateDgmgrl(oneWay));
    expect(oneWayText).toContain("EDIT DATABASE 'prm01' SET PROPERTY 'PreferredObserverHosts' = 'dc3-obs01:1';");
    expect(oneWayText).not.toContain('EDIT CONFIGURATION SET PROPERTY PreferredObserverHosts');
    expect(oneWayText).not.toContain("EDIT DATABASE 'sby01' SET PROPERTY 'PreferredObserverHosts'");

    const sby01 = oneWay.members.find((m) => m.id === memberId('sby01')) as typeof oneWay.members[number];
    const bothWays: TopologyDoc = {
      ...oneWay,
      members: oneWay.members.map((m) => (m.id === sby01.id
        ? { ...m, redoRoutes: [{ source: 'LOCAL' as const, groups: [{ dests: [{ target: memberId('prm01') }] }] }] }
        : m)),
    };
    const bothWaysText = textOf(generateDgmgrl(bothWays));
    expect(bothWaysText).toContain("EDIT DATABASE 'prm01' SET PROPERTY 'PreferredObserverHosts' = 'dc3-obs01:1';");
    expect(bothWaysText).toContain("EDIT DATABASE 'sby01' SET PROPERTY 'PreferredObserverHosts' = 'dc3-obs01:1';");
  });

  it('ReopenSecs is set with EDIT DATABASE when it differs from the broker default (GEN-06)', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary', {
      redoRoutes: [{ source: 'LOCAL', groups: [{ dests: [{ target: memberId('sby01') }] }] }],
    });
    const sby01 = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
    dest(prm, sby01.id, { reopenSeconds: 120 });
    const doc = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      members: [prm, sby01],
      observers: [observer('obs01', 'dc3-obs01')],
      targets: [sby01.id],
    });
    const text = textOf(generateDgmgrl(doc));
    expect(text).toContain("EDIT DATABASE 'sby01' SET PROPERTY 'ReopenSecs' = 120;");
  });

  it('spells OBSERVE ONLY when the configuration is observe-only', () => {
    const base = classicDoc();
    const doc: TopologyDoc = {
      ...base,
      config: { ...base.config, fsfo: { ...base.config.fsfo, state: 'observe-only' } },
    };
    const text = textOf(generateDgmgrl(doc));
    expect(text).toContain('ENABLE FAST_START FAILOVER OBSERVE ONLY;');
    expect(text).toContain('observe-only mode');
  });

  it('appends whatever validate had to say, verbatim', () => {
    const text = textOf(generateDgmgrl(classicDoc(), {
      findings: [{
        id: 'FSFO.LAGLIMIT_VS_THRESHOLD',
        severity: 'warning',
        basis: 'documented',
        cite: ['FSFO.LAGLIMIT_RECOMMENDATION'],
        subject: { kind: 'config' },
        message: 'the lag limit is above the threshold',
      }],
    }));
    expect(text).toContain('warning: FSFO.LAGLIMIT_VS_THRESHOLD -- the lag limit is above the threshold');
  });
});

/* ---------------- LOG_ARCHIVE_DEST_n ---------------- */

describe('the LOG_ARCHIVE_DEST_n block', () => {
  it('numbers destinations from 2 upward and states the ranges', () => {
    const text = renderPlain(generateInitOra(multiTargetThreeObservers()));
    expect(text).toContain('log_archive_dest_2 =');
    expect(text).toContain('log_archive_dest_3 =');
    expect(text).not.toContain('log_archive_dest_1 =');
    expect(text).toContain('# LOG_ARCHIVE_DEST_n takes n = 1..31; 1-10 accept LOCATION or SERVICE,');
    expect(text).toContain('# 11-31 SERVICE only');
  });

  it('omits NET_TIMEOUT under ASYNC and spells it out otherwise', () => {
    const async = renderPlain(generateInitOra(cascade42(), { member: memberId('sby01') }));
    expect(async).toContain('ASYNC NOAFFIRM');
    expect(async).not.toContain('NET_TIMEOUT=');
    expect(async).toContain('NET_TIMEOUT left out under ASYNC');

    const sync = renderPlain(generateInitOra(cascade42()));
    expect(sync).toContain('SYNC AFFIRM NET_TIMEOUT=30');
  });

  it('maps FASTSYNC to SYNC NOAFFIRM and SYNC to SYNC AFFIRM', () => {
    const base = farSync52();
    const text = renderPlain(generateInitOra(base));
    expect(text).toContain('SYNC AFFIRM');
    const fast: TopologyDoc = {
      ...base,
      members: base.members.map((m) => (m.id === memberId('fs1')
        ? { ...m, logXptMode: 'FASTSYNC' as const } : m)),
    };
    const fastText = renderPlain(generateInitOra({
      ...fast,
      members: fast.members.map((m) => (m.id === memberId('prm01')
        ? {
          ...m,
          redoRoutes: [{ source: 'LOCAL' as const, groups: [{ dests: [{ target: memberId('fs1') }] }] }],
        }
        : m)),
    }));
    expect(fastText).toContain('SYNC NOAFFIRM');
  });

  it('is the only place GROUP and PRIORITY appear, and labels the mapping a model', () => {
    const doc = priority43();
    const initora = renderPlain(generateInitOra(doc));
    expect(initora).toContain('GROUP=1 PRIORITY=1');
    expect(initora).toContain('GROUP=1 PRIORITY=2');
    expect(initora).toContain('never RedoRoutes syntax');
    const script = renderPlain(generateDgmgrl(doc));
    /* Example 4-3's shape: one group, a PRIORITY per destination. */
    expect(script).toContain("'RedoRoutes' = '(LOCAL : (sby01 SYNC PRIORITY=1, sby02 ASYNC PRIORITY=2))';");
  });

  it('writes ALTERNATE= for an alternate destination', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary', {
      redoRoutes: [{
        source: 'LOCAL',
        groups: [{
          dests: [{
            target: memberId('sby01'),
            xpt: 'SYNC',
            alt: { target: memberId('sby02'), xpt: 'ASYNC', fallback: true },
          }],
        }],
      }],
    });
    const sby01 = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
    const sby02 = db('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'ASYNC' });
    dest(prm, sby01.id, { maxFailure: 2 });
    dest(prm, sby02.id, { maxFailure: 2 });
    const doc = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc3-obs01', 'dc3']],
      members: [prm, sby01, sby02],
      observers: [observer('obs01', 'dc3-obs01')],
      targets: [sby01.id],
    });
    const text = renderPlain(generateInitOra(doc));
    expect(text).toContain('ALTERNATE=LOG_ARCHIVE_DEST_3');
    expect(text).toContain('# the alternate for log_archive_dest_2, with FALLBACK');
    expect(renderPlain(generateDgmgrl(doc)))
      .toContain("'RedoRoutes' = '(LOCAL : sby01 SYNC ALT=(sby02 ASYNC FALLBACK))';");
  });

  it('an alternate gets its own LOG_ARCHIVE_DEST_STATE_n, matching Oracle\'s worked example (GEN-07)', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary', {
      redoRoutes: [{
        source: 'LOCAL',
        groups: [{
          dests: [{
            target: memberId('sby01'),
            xpt: 'SYNC',
            alt: { target: memberId('sby02'), xpt: 'ASYNC', fallback: true },
          }],
        }],
      }],
    });
    const sby01 = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
    const sby02 = db('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'ASYNC' });
    const doc = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc3-obs01', 'dc3']],
      members: [prm, sby01, sby02],
      observers: [observer('obs01', 'dc3-obs01')],
      targets: [sby01.id],
    });
    const text = renderPlain(generateInitOra(doc));
    const at = (needle: string): number => text.indexOf(needle);
    expect(at("log_archive_dest_state_2 = 'ENABLE'")).toBeGreaterThan(-1);
    expect(at("log_archive_dest_state_3 = 'ALTERNATE'")).toBeGreaterThan(-1);
    expect(at("log_archive_dest_state_2 = 'ENABLE'")).toBeLessThan(at('log_archive_dest_2 ='));
    expect(at("log_archive_dest_state_3 = 'ALTERNATE'")).toBeLessThan(at('log_archive_dest_3 ='));
    expect(text).toContain('maintained only for backwards compatibility');
  });
});

/* ---------------- the SHOW mocks ---------------- */

describe('the SHOW mocks', () => {
  it('say they are rendered from the model', () => {
    for (const f of generateShowMocks(classicDoc())) {
      expect(renderPlain(f)).toContain("rendered from this page's model of DGMGRL output");
    }
  });

  it('draw a cascade by indentation, with (receiving current redo)', () => {
    const text = renderPlain(showConfiguration(cascade42()));
    const lines = text.split('\n');
    const prm = lines.find((l) => l.includes('prm01 -')) as string;
    const sby = lines.find((l) => l.includes('sby01 -')) as string;
    const remote = lines.find((l) => l.includes('remote_sby -')) as string;
    expect(prm).toBe('  prm01 - Primary database');
    expect(sby).toBe('    sby01 - Physical standby database');
    expect(remote).toBe('      remote_sby - Physical standby database (receiving current redo)');
  });

  it('the far sync line is documented, not this page\'s model (GEN-13)', () => {
    const file = showConfiguration(farSync52());
    const text = renderPlain(file);
    expect(text).toContain('fs1 - Far sync instance');
    expect(text).not.toContain('fs1 - Far sync instance   (model)');
    const line = file.lines.find((l) => lineText(l).includes('Far sync instance'));
    expect(line?.basis).toBe('documented');
    expect(line?.cite).toContain('DGMGRL.FARSYNC_LINE_DOCUMENTED');
  });

  it('mark the lower-priority destination (alternate of ...) in VERBOSE only', () => {
    const doc = priority43();
    expect(renderPlain(showConfiguration(doc, { verbose: true })))
      .toContain('sby02 - Physical standby database (alternate of sby01)');
    expect(renderPlain(showConfiguration(doc))).not.toContain('(alternate of');
  });

  it('resolve another primary for WHEN PRIMARY IS', () => {
    const doc = farSync52();
    const text = renderPlain(showConfiguration(doc, { whenPrimaryIs: memberId('sby01') as MemberId }));
    expect(text).toContain('DGMGRL> SHOW CONFIGURATION WHEN PRIMARY IS sby01;');
    expect(text).toContain('sby01 - Primary database');
    expect(text).toContain('prm01 - Physical standby database');
  });

  it('list Active Target, Potential Targets and a per-target valid flag', () => {
    const text = renderPlain(generateShowMocks(multiTargetThreeObservers())[1] as GeneratedFile);
    expect(text).toContain('Active Target:        sby01');
    expect(text).toContain('Potential Targets:    "sby01,sby02"');
    expect(text).toContain('sby01:              valid   (model)');
    expect(text).toContain('Observer Override:    FALSE');
  });

  it('name every observer, master first, and carry the edition count', () => {
    const text = renderPlain(generateShowMocks(multiTargetThreeObservers())[2] as GeneratedFile);
    const heads = text.split('\n').filter((l) => l.startsWith('Observer "'));
    expect(heads).toEqual([
      'Observer "obs01" - Master',
      'Observer "obs02" - Backup',
      'Observer "obs03" - Backup',
    ]);
    expect(text).toContain('19c registers up to three observers, one of them master');
  });

  it('drop the master/backup distinction when fast-start failover is disabled', () => {
    const base = multiTargetThreeObservers();
    const doc: TopologyDoc = {
      ...base,
      config: { ...base.config, fsfo: { ...base.config.fsfo, state: 'disabled' } },
    };
    const text = renderPlain(generateShowMocks(doc)[2] as GeneratedFile);
    expect(text).toContain('Observer "obs01"');
    expect(text).not.toContain(' - Master');
    expect(text).toContain('all observers have the same functionality');
  });

  it('say that no observer deployed is not the same as unobserved', () => {
    const doc = { ...classicDoc(), observers: [] };
    const text = renderPlain(generateShowMocks(doc)[2] as GeneratedFile);
    expect(text).toContain('not the same as unobserved');
  });

  it('names V$FAST_START_FAILOVER_CONFIG, not V$DATABASE, once the document is 26ai (ED-06)', () => {
    const doc = { ...classicDoc(), observers: [], config: { ...classicDoc().config, edition: '26ai' as const } };
    const text = renderPlain(generateShowMocks(doc)[2] as GeneratedFile);
    expect(text).toContain('V$FAST_START_FAILOVER_CONFIG');
    expect(text).not.toContain('V$DATABASE.FS_FAILOVER_STATUS');
  });

  describe('the Fast-Start Failover: status word (GEN-09)', () => {
    it('MaxProtection is zero data loss', () => {
      const base = classicDoc();
      const doc: TopologyDoc = { ...base, config: { ...base.config, protectionMode: 'MAXPROTECTION' } };
      expect(renderPlain(showFastStartFailover(doc))).toContain('Fast-Start Failover: Enabled in Zero Data Loss Mode');
    });

    it('19c MaxAvailability is zero data loss', () => {
      expect(renderPlain(showFastStartFailover(classicDoc()))).toContain('Fast-Start Failover: Enabled in Zero Data Loss Mode');
    });

    it('MaxPerformance is potential data loss', () => {
      const base = classicDoc();
      const doc: TopologyDoc = { ...base, config: { ...base.config, protectionMode: 'MAXPERFORMANCE' } };
      expect(renderPlain(showFastStartFailover(doc))).toContain('Fast-Start Failover: Enabled in Potential Data Loss Mode');
    });

    it('26ai MaxAvailability with a non-zero lag limit is potential data loss', () => {
      const base = classicDoc();
      const doc: TopologyDoc = {
        ...base,
        config: {
          ...base.config, edition: '26ai',
          fsfo: { ...base.config.fsfo, lagLimitSeconds: 10 },
        },
      };
      expect(renderPlain(showFastStartFailover(doc))).toContain('Fast-Start Failover: Enabled in Potential Data Loss Mode');
    });

    it('disabled prints DISABLED, in capitals', () => {
      const base = classicDoc();
      const doc: TopologyDoc = { ...base, config: { ...base.config, fsfo: { ...base.config.fsfo, state: 'disabled' } } };
      expect(renderPlain(showFastStartFailover(doc))).toContain('Fast-Start Failover: DISABLED');
    });
  });

  it('marks the (*) fast-start failover target and the legend under it, VERBOSE only (GEN-12)', () => {
    const doc = multiTargetThreeObservers();
    const verbose = renderPlain(showConfiguration(doc, { verbose: true }));
    expect(verbose).toContain('sby01 - (*) Physical standby database');
    expect(verbose).toContain('(*) Fast-Start Failover target');
    const plain = renderPlain(showConfiguration(doc));
    expect(plain).not.toContain('(*)');
  });

  it('draws a member no active route reaches under "Members Not Receiving Redo:" (GEN-12)', () => {
    const prm = db('prm01', ['dc1-prm01'], 'primary', {
      redoRoutes: [{ source: 'LOCAL', groups: [{ dests: [{ target: memberId('sby01') }] }] }],
    });
    const sby01 = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
    const sby02 = db('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'SYNC' });
    const doc = build({
      sites: ['dc1', 'dc2', 'dc3'],
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc3-obs01', 'dc3']],
      members: [prm, sby01, sby02],
      observers: [observer('obs01', 'dc3-obs01')],
      targets: [sby01.id],
    });
    const text = renderPlain(showConfiguration(doc));
    expect(text).toContain('Members Not Receiving Redo:');
    const lines = text.split('\n');
    const headingAt = lines.findIndex((l) => l.includes('Members Not Receiving Redo:'));
    const sby02At = lines.findIndex((l) => l.includes('sby02 -'));
    expect(sby02At).toBeGreaterThan(headingAt);
  });

  it('prints Ping Interval / Ping Retry after Threshold under 26ai only (ED-06)', () => {
    const base = classicDoc();
    const doc19c: TopologyDoc = {
      ...base,
      config: { ...base.config, fsfo: { ...base.config.fsfo, pingIntervalMs: 100, pingRetry: 10 } },
    };
    expect(renderPlain(showFastStartFailover(doc19c))).not.toContain('Ping Interval');

    const doc26ai: TopologyDoc = { ...doc19c, config: { ...doc19c.config, edition: '26ai' } };
    const text = renderPlain(showFastStartFailover(doc26ai));
    expect(text).toContain('Ping Interval:');
    expect(text).toContain('Ping Retry:');
  });

  it('prints the Configurable Failover Conditions block (GEN-11)', () => {
    const text = renderPlain(showFastStartFailover(classicDoc()));
    expect(text).toContain('Configurable Failover Conditions');
    expect(text).toContain('Health Conditions:');
    expect(text).toContain('Corrupted Controlfile   YES');
    expect(text).toContain('Inaccessible Logfile    NO');
    expect(text).toContain('Oracle Error Conditions:');
  });

  it('Observer Reconnect and Potential Targets print even at the default / for a single target (GEN-11)', () => {
    const text = renderPlain(showFastStartFailover(classicDoc()));
    expect(text).toContain('Observer Reconnect:   (none)');
    expect(text).toContain('Potential Targets:');
  });

  it('prints "(not in use)" for an ungated lag limit, not "(not evaluated in this mode)" (GEN-10)', () => {
    const text = renderPlain(showFastStartFailover(classicDoc()));
    expect(text).toContain('(not in use)');
    expect(text).not.toContain('not evaluated in this mode');
  });
});

describe('FastStartFailoverLagLimit follows the broker default until it is set (ED-03)', () => {
  /** The classic document with the property not set, read under `edition` and `mode`. */
  const unset = (edition: '19c' | '26ai', mode: TopologyDoc['config']['protectionMode']): TopologyDoc => {
    const base = classicDoc();
    const { lagLimitSet: _dropped, ...fsfo } = base.config.fsfo;
    return {
      ...base,
      config: { ...base.config, edition, protectionMode: mode, fsfo: { ...fsfo, lagLimitSeconds: 30 } },
    };
  };
  const setTo = (doc: TopologyDoc, v: number): TopologyDoc => ({
    ...doc,
    config: { ...doc.config, fsfo: { ...doc.config.fsfo, lagLimitSeconds: v, lagLimitSet: true } },
  });
  const SET = 'EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagLimit';
  const lagLines = (doc: TopologyDoc): Line[] =>
    generateDgmgrl(doc).lines.filter((l) => lineText(l).includes('FastStartFailoverLagLimit'));

  it('emits no SET PROPERTY for a limit that was never set, in any edition or mode', () => {
    for (const edition of ['19c', '26ai'] as const) {
      for (const mode of ['MAXPERFORMANCE', 'MAXAVAILABILITY', 'MAXPROTECTION'] as const) {
        const text = renderPlain(generateDgmgrl(unset(edition, mode)));
        expect(text, `${edition} ${mode}`).not.toContain(SET);
      }
    }
  });

  it('names the default in force instead', () => {
    expect(renderPlain(generateDgmgrl(unset('26ai', 'MAXAVAILABILITY'))))
      .toContain('FastStartFailoverLagLimit is not set -- the 26ai broker default in maximum availability mode is 0 seconds');
    expect(renderPlain(generateDgmgrl(unset('26ai', 'MAXAVAILABILITY')))).toContain('ZERO DATA LOSS');
    expect(renderPlain(generateDgmgrl(unset('19c', 'MAXPERFORMANCE'))))
      .toContain('FastStartFailoverLagLimit is not set -- the broker default in maximum performance mode is 30 seconds');
    expect(renderPlain(generateDgmgrl(unset('26ai', 'MAXPROTECTION'))))
      .toContain('FastStartFailoverLagLimit is not used in maximum protection mode');
  });

  it('emits the command for a limit that was set, and the bounded-loss note under 26ai', () => {
    const doc = setTo(unset('26ai', 'MAXAVAILABILITY'), 10);
    const text = renderPlain(generateDgmgrl(doc));
    expect(text).toContain(`${SET} = 10;`);
    expect(text).toContain('POTENTIAL DATA LOSS');
    expect(renderPlain(generateDgmgrl(setTo(unset('19c', 'MAXPERFORMANCE'), 30)))).toContain(`${SET} = 30;`);
  });

  it('carries the 19c maximum availability disagreement as a conflict, in Oracle\'s spelling', () => {
    for (const doc of [unset('19c', 'MAXAVAILABILITY'), setTo(unset('19c', 'MAXAVAILABILITY'), 45)]) {
      const notes = lagLines(doc).filter((l) => l.kind === 'note');
      const c = notes.find((l) => l.basis === 'conflict');
      expect(c).toBeDefined();
      expect(c?.cite).toEqual(['FSFO.LAGLIMIT_ZERO_MAXAVAIL_19C', 'FSFO.LAGLIMIT_MAXPERF_ONLY_19C']);
      expect(lineText(c as Line)).toContain('"(not in use)"');
      expect(c?.note ?? '').not.toBe('');
    }
    const all = [
      ...['19c', '26ai'].flatMap((e) => ['MAXPERFORMANCE', 'MAXAVAILABILITY', 'MAXPROTECTION']
        .map((m) => unset(e as '19c' | '26ai', m as TopologyDoc['config']['protectionMode']))),
    ];
    for (const doc of all) expect(renderPlain(generateDgmgrl(doc))).not.toContain('not evaluated');
  });

  it('SHOW FAST_START FAILOVER prints the limit in force: 26ai zero-loss prints 0 bare, 19c prints 30 (not in use)', () => {
    const v26 = renderPlain(showFastStartFailover(unset('26ai', 'MAXAVAILABILITY')));
    expect(v26).toContain('Fast-Start Failover: Enabled in Zero Data Loss Mode');
    expect(v26).toMatch(/Lag Limit: +0 seconds\n/);
    const v19 = renderPlain(showFastStartFailover(unset('19c', 'MAXAVAILABILITY')));
    expect(v19).toContain('Fast-Start Failover: Enabled in Zero Data Loss Mode');
    expect(v19).toMatch(/Lag Limit: +30 seconds \(not in use\)/);
    const bounded = renderPlain(showFastStartFailover(setTo(unset('26ai', 'MAXAVAILABILITY'), 10)));
    expect(bounded).toContain('Fast-Start Failover: Enabled in Potential Data Loss Mode');
    expect(bounded).toMatch(/Lag Limit: +10 seconds\n/);
  });
});
