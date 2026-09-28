/**
 * Fact-check probes -- the scenarios behind SIMULATOR_FACT_CHECK_2026-09-28.md.
 *
 * Not part of the suite: the file name does not match `*.test.ts`, so
 * `npm test` never picks it up. Run it on purpose, from `app/`:
 *
 *   npx vitest run --config vitest.factcheck.config.ts
 *
 * Every probe is one document, one event list and one question -- "does the
 * page still show what the report recorded?" -- and the run prints OPEN or
 * CHANGED per finding beside what the trace says now. A probe never fails the
 * run: CHANGED means the behaviour moved, not that it is right, and the row
 * still has to be read against the Oracle sentence it quotes.
 *
 * Adding a feature that touches the engine means adding its probes here, with
 * the sentence the outcome is held to. `docs/agents/fact-check.md` is the
 * procedure this file is one step of.
 */

import { it } from 'vitest';

import { CLASSIC_IDS, classicTopology } from '../../src/engine/compat/classic';
import type { ClassicKnobs } from '../../src/engine/compat/classic';
import { generateDgmgrl } from '../../src/engine/generate/dgmgrl';
import { renderPlain } from '../../src/engine/generate/lines';
import { hostId, linkId, memberId, siteId } from '../../src/engine/ids';
import { formatRedoRoutes, parseRedoRoutes } from '../../src/engine/redo/parse';
import { simulate } from '../../src/engine/sim/simulate';
import type { EngineTrace } from '../../src/engine/sim/simulate';
import type { TimedEvent } from '../../src/engine/types/events';
import type { TopologyDoc } from '../../src/engine/types/topology';
import { validate } from '../../src/engine/validate';
import { preset } from '../../src/presets';
import {
  build, db, dest, farSyncDoc, multiTargetDoc, observer,
} from '../topologies';

/* ---------------- helpers ---------------- */

const PRM = hostId('dc1-prm01');
const SBY = hostId('dc2-sby01');
const DC1_DC2 = CLASSIC_IDS.linkDc1Dc2;
const DC1_DC3 = CLASSIC_IDS.linkDc1Dc3;

const classic = (k: ClassicKnobs = {}): TopologyDoc => classicTopology({ observerLoc: 'dc3', ...k });

const lane = (t: EngineTrace, id: string): string =>
  (t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [])
    .map((s) => `${s.t0}:${s.state}`).join(' | ');

const endState = (t: EngineTrace, id: string): string | undefined => {
  const segs = t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments;
  return segs?.[segs.length - 1]?.state;
};

const promoted = (t: EngineTrace): boolean => !t.facts.blocked && t.facts.newPrimary !== null;

const hasFinding = (t: EngineTrace, id: string): boolean => t.findings.some((f) => f.id === id);

const summary = (t: EngineTrace): string => {
  const f = t.facts;
  const rpo = f.newPrimary ? f.perMember[f.newPrimary]?.rpoSeconds : null;
  return [
    `outcome=${f.outcome}${f.blocked ? ' (blocked)' : ''}`,
    `newPrimary=${f.newPrimary ?? '-'}`,
    `initiate=${f.initiateAt ?? '-'}`,
    `open=${f.tOpen ?? '-'}`,
    `abort=${f.abortAt ?? '-'}`,
    `loss=${rpo ? `${rpo.value} (${rpo.basis})` : '-'}`,
  ].join(' ');
};

interface SimProbe {
  finding: string;
  title: string;
  doc: () => TopologyDoc;
  events: (doc: TopologyDoc) => TimedEvent[];
  /** The sentence the outcome is held to, and where it is. */
  oracle: string;
  /** True while the trace still shows what the report recorded. */
  open: (t: EngineTrace) => boolean;
  lanes?: string[];
}

interface TextProbe {
  finding: string;
  title: string;
  oracle: string;
  run: () => { open: boolean; now: string };
}

/* ---------------- A. simulated outcomes ---------------- */

const SIM: SimProbe[] = [
  {
    finding: 'SIM-01a',
    title: '19c MaxAvailability: standby cut off at 0, primary crash at 100',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 100, kind: 'host.down', host: PRM },
    ],
    oracle: 'FSFO cannot occur if "the target standby database was not synchronized with the primary database at the time the primary database failed" (19c/26ai FSFO chapter)',
    open: promoted,
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-01b',
    title: '19c MaxPerformance, lag 10 <= limit 30: standby cut off at 0, crash at 100',
    doc: () => classic({ mode: 'maxperf', logXptMode: 'async', standbyLag: 10 }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 100, kind: 'host.down', host: PRM },
    ],
    oracle: 'TARGET OVER LAG LIMIT: fast-start failover "Is not possible"; the lag grows while the standby receives nothing',
    open: promoted,
  },
  {
    finding: 'SIM-01c',
    title: '26ai bounded MaxAvailability (limit 30): standby cut off at 0, crash at 100',
    doc: () => classic({ version: '26ai', lagPolicy: 'bounded', lagLimit: 30, standbyLag: 10 }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 100, kind: 'host.down', host: PRM },
    ],
    oracle: '26ai: "failover is possible any time the standby database\'s apply lag is less than or equal to" the limit',
    open: promoted,
  },
  {
    finding: 'SIM-01d',
    title: 'Far sync down at 0, primary crash at 100',
    doc: () => farSyncDoc(),
    events: () => [
      { at: 0, kind: 'host.down', host: hostId('dc1-fs01') },
      { at: 100, kind: 'host.down', host: PRM },
    ],
    oracle: 'as SIM-01a',
    open: promoted,
  },
  {
    finding: 'SIM-02a',
    title: 'Observer stopped at 0, standby link cut at 50',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'observer.stop', observer: CLASSIC_IDS.observer },
      { at: 50, kind: 'link.cut', link: DC1_DC2 },
    ],
    oracle: '"While the configuration is in the unobserved state ... the primary database can continue processing transactions, even if the target standby database fails."',
    open: (t) => t.facts.abortAt !== null || lane(t, 'prm01').includes('stalled'),
    lanes: ['prm01'],
  },
  {
    finding: 'SIM-02b',
    title: 'Standby link cut at 0 (unsynchronized), observer link cut at 100',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 100, kind: 'link.cut', link: DC1_DC3 },
    ],
    oracle: 'HA guide: "an observer or standby outage, or the outage of both at different times, does not impact the availability of the primary database"',
    open: (t) => t.facts.abortAt !== null || t.facts.initiateAt !== null,
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-02c',
    title: '19c MaxPerformance, lag 45 > limit 30, primary isolated',
    doc: () => classic({ mode: 'maxperf', logXptMode: 'async', standbyLag: 45 }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
    ],
    oracle: 'STALLED: shown when "the change to ... the TARGET OVER LAG LIMIT state ... cannot be confirmed" -- here no change is pending',
    open: (t) => t.facts.abortAt !== null,
    lanes: ['prm01'],
  },
  {
    finding: 'SIM-03',
    title: 'Crash at 0, failover, former primary host back at 100',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'host.down', host: PRM },
      { at: 100, kind: 'host.up', host: PRM },
    ],
    oracle: '"It will not be allowed to open in any event if fast-start failover is enabled." (ORA-16649)',
    open: (t) => endState(t, 'prm01') === 'open-rw',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-04a',
    title: 'SWITCHOVER TO a standby whose host is down',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'host.down', host: SBY },
      { at: 5, kind: 'cmd.switchover', to: CLASSIC_IDS.standby },
    ],
    oracle: 'a switchover needs both databases',
    open: promoted,
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-04b',
    title: 'SWITCHOVER with the primary down (no observer)',
    doc: () => classic({ observerLoc: 'none' }),
    events: () => [
      { at: 0, kind: 'host.down', host: PRM },
      { at: 5, kind: 'cmd.switchover', to: CLASSIC_IDS.standby },
    ],
    oracle: 'a switchover needs both databases',
    open: promoted,
  },
  {
    finding: 'SIM-04c',
    title: 'FAILOVER TO a standby whose host is down (no observer)',
    doc: () => classic({ observerLoc: 'none' }),
    events: () => [
      { at: 0, kind: 'host.down', host: PRM },
      { at: 0, kind: 'host.down', host: SBY },
      { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
    ],
    oracle: 'the FAILOVER command is issued connected to the standby that becomes primary',
    open: promoted,
  },
  {
    finding: 'SIM-05',
    title: '26ai multi-target: primary and first candidate lost together',
    doc: () => { const d = multiTargetDoc(); d.config.edition = '26ai'; return d; },
    events: () => [
      { at: 0, kind: 'site.down', site: siteId('dc2') },
      { at: 0, kind: 'host.down', host: PRM },
    ],
    oracle: '26ai: "Data Guard Broker cannot failover to second fast-start failover target if both the primary and first fast-start failover targets are down."',
    open: (t) => promoted(t) && t.facts.newPrimary === memberId('sby02'),
  },
  {
    finding: 'SIM-06',
    title: 'No observer: standby cut off at 0, crash at 100, FAILOVER at 120',
    doc: () => classic({ observerLoc: 'none' }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 100, kind: 'host.down', host: PRM },
      { at: 120, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
    ],
    oracle: '"There may or may not be data loss depending upon whether your primary and target standby databases were synchronized at the time of the primary database failure."',
    open: (t) => promoted(t)
      && t.facts.perMember[CLASSIC_IDS.standby]?.rpoSeconds?.value === 0,
  },
  {
    finding: 'SIM-07',
    title: 'FAILOVER TO the standby while the primary is open (FSFO enabled)',
    doc: () => classic(),
    events: () => [{ at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby }],
    oracle: '"You must ensure that the primary database is shut down prior to performing a manual failover."',
    open: (t) => promoted(t) && endState(t, 'prm01') === 'open-rw' && t.findings.length === 0,
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-08',
    title: 'FSFO enabled, targets [sby01, sby02]: SWITCHOVER TO sby02',
    doc: () => multiTargetDoc(),
    events: () => [{ at: 0, kind: 'cmd.switchover', to: memberId('sby02') }],
    oracle: '"If fast-start failover is enabled, you may switch over only to the fast-start failover target standby database." (ORA-16655)',
    open: promoted,
  },
  {
    finding: 'SIM-09a',
    title: '19c: far-sync-role-change preset, its own switchover',
    doc: () => { const d = preset('far-sync-role-change').doc(); d.config.edition = '19c'; return d; },
    events: () => preset('far-sync-role-change').events(),
    oracle: '"Whether the far sync instances are available or unavailable does not affect switchover."',
    open: (t) => hasFinding(t, 'SWITCHOVER.TO_TERMINAL_UNDOC') || t.facts.blocked,
  },
  {
    finding: 'SIM-09b',
    title: '26ai: far-sync-role-change preset, its own switchover',
    doc: () => { const d = preset('far-sync-role-change').doc(); d.config.edition = '26ai'; return d; },
    events: () => preset('far-sync-role-change').events(),
    oracle: 'as SIM-09a',
    open: (t) => hasFinding(t, 'SWITCHOVER.TO_TERMINAL_UNDOC') || t.facts.blocked,
  },
  {
    finding: 'SIM-10',
    title: 'Switchover at 0, then the new primary crashes at 100',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'cmd.switchover', to: CLASSIC_IDS.standby },
      { at: 100, kind: 'host.down', host: SBY },
    ],
    oracle: 'fast-start failover stays enabled across a role change; the former primary is the new target. Owner decision 2026-09-28: one role change per run stays, and the run must say so (SIM.ONE_ROLE_CHANGE)',
    open: (t) => t.facts.outcome === 'switchover' && endState(t, 'sby01') === 'down'
      && !hasFinding(t, 'SIM.ONE_ROLE_CHANGE'),
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-11',
    title: 'Standby down 0-50, primary crash at 60',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'host.down', host: SBY },
      { at: 50, kind: 'host.up', host: SBY },
      { at: 60, kind: 'host.down', host: PRM },
    ],
    oracle: '"the ability to automatically failover is restored once the target standby database has received all missing redo data" -- drawn as immediate, which is acceptable only while the run labels it as this page\'s model',
    open: (t) => promoted(t) && !t.findings.some((f) => f.id.startsWith('FSFO.RESYNC')),
  },
  {
    finding: 'SIM-13',
    title: 'Far sync and primary share a site; the site goes down',
    doc: () => farSyncDoc(),
    events: () => [{ at: 0, kind: 'site.down', site: siteId('dc1') }],
    oracle: 'synchronized across a far sync hop is this page\'s model; the zero must not read "documented"',
    open: (t) => promoted(t)
      && t.facts.perMember[memberId('sby01')]?.rpoSeconds?.basis === 'documented',
  },
  {
    finding: 'ED-01',
    title: '19c with both ObserverPing properties set: crash',
    doc: () => classic({ version: '19c', pingSet: true }),
    events: () => [{ at: 0, kind: 'host.down', host: PRM }],
    oracle: 'neither property exists in 19c (absent from the 12.2/18c/19c pages and from the 19.27 binaries); the threshold minimum is 6 s',
    open: (t) => t.facts.initiateAt !== null && t.facts.initiateAt < 6,
  },
];

/* ---------------- B. rules and generated text ---------------- */

const twoStandbys = (): TopologyDoc => {
  const prm = db('prm01', ['dc1-prm01'], 'primary');
  const sync = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
  const async = db('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'ASYNC' });
  dest(prm, sync.id);
  dest(prm, async.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc3-obs01', 'dc3']],
    members: [prm, sync, async],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [],
    fsfo: 'disabled',
  });
};

const TEXT: TextProbe[] = [
  {
    finding: 'VAL-01',
    title: 'RedoRoutes round trip of Oracle Example 1',
    oracle: 'grammar: ( db_unique_name_1 [xpt_mode] [PRIORITY=n] [,db_unique_name_n [xpt_mode] [PRIORITY=n]] ) -- priority is per destination',
    run: () => {
      const src = '(LOCAL : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ))';
      const parsed = parseRedoRoutes(src);
      const back = parsed.rules ? formatRedoRoutes(parsed.rules) : '(parse error)';
      return { open: !/FS1[^,)]*PRIORITY=1/.test(back), now: back };
    },
  },
  {
    finding: 'VAL-02',
    title: '19c MaxAvailability, one SYNC and one ASYNC standby, FSFO disabled',
    oracle: '"at least one standby database in the configuration that can support the desired grade of protection"',
    run: () => {
      const hits = validate(twoStandbys()).filter((f) => f.id === 'XPT.TABLE_4_2' && f.severity === 'error');
      return { open: hits.length > 0, now: `${hits.length} XPT.TABLE_4_2 error(s)` };
    },
  },
  {
    finding: 'VAL-04',
    title: 'Two standbys, FSFO disabled, no target named',
    oracle: 'the explicit-target rule is a condition of ENABLING fast-start failover: while it is disabled the rule may inform, never refuse',
    run: () => {
      const hits = validate(twoStandbys()).filter((f) => f.id === 'FSFO.MULTI_TARGET_EXPLICIT');
      const worst = hits.map((f) => f.severity).sort()[0] ?? 'not raised';
      return { open: hits.some((f) => f.severity !== 'info'), now: `FSFO.MULTI_TARGET_EXPLICIT: ${worst}` };
    },
  },
  {
    finding: 'GEN-01',
    title: 'START OBSERVER in the classic preset script',
    oracle: 'START OBSERVER [name] IN BACKGROUND CONNECT IDENTIFIER IS connect-identifier [FILE IS ...] [LOGFILE IS ...]',
    run: () => {
      const text = renderPlain(generateDgmgrl(preset('classic').doc()));
      const line = text.split('\n').find((l) => l.includes('START OBSERVER')) ?? '(none)';
      return { open: !line.includes('CONNECT IDENTIFIER IS'), now: line.trim() };
    },
  },
  {
    finding: 'GEN-03',
    title: 'Protection mode line in the max-protection preset script',
    oracle: '"Upgrading from MAXPERFORMANCE to MAXPROTECTION is not allowed. You must first go to MAXAVAILABILITY"',
    run: () => {
      const text = renderPlain(generateDgmgrl(preset('max-protection').doc()));
      const lines = text.split('\n').filter((l) => l.includes('SET PROTECTION MODE'));
      return {
        open: lines.length === 1 && /MAXPROTECTION/i.test(lines[0] ?? ''),
        now: lines.map((l) => l.trim()).join(' / ') || '(none)',
      };
    },
  },
  {
    finding: 'ED-01b',
    title: 'ObserverPingInterval in a 19c script',
    oracle: 'the property is first documented in 21c',
    run: () => {
      const text = renderPlain(generateDgmgrl(classic({ version: '19c', pingSet: true })));
      const hit = text.includes('ObserverPingInterval');
      return { open: hit, now: hit ? 'emitted under 19c' : 'not emitted' };
    },
  },
];

/* ---------------- the run ---------------- */

it('fact-check probes', () => {
  const out: string[] = ['', 'finding   status   what the page shows now'];
  let open = 0;

  for (const p of SIM) {
    const doc = p.doc();
    const t = simulate(doc, p.events(doc));
    const isOpen = p.open(t);
    if (isOpen) open++;
    out.push('', `${p.finding.padEnd(9)} ${isOpen ? 'OPEN   ' : 'CHANGED'}  ${p.title}`);
    out.push(`          ${summary(t)}`);
    for (const id of p.lanes ?? []) out.push(`          ${id}: ${lane(t, id)}`);
    out.push(`          Oracle: ${p.oracle}`);
  }

  for (const p of TEXT) {
    const r = p.run();
    if (r.open) open++;
    out.push('', `${p.finding.padEnd(9)} ${r.open ? 'OPEN   ' : 'CHANGED'}  ${p.title}`);
    out.push(`          ${r.now}`);
    out.push(`          Oracle: ${p.oracle}`);
  }

  out.push('', `${open} of ${SIM.length + TEXT.length} probes still show what the report recorded.`, '');
  console.log(out.join('\n'));
});

/* `linkId` is what a probe over a hand-built document cuts; kept imported so
   the next probe does not have to go looking for it. */
void linkId;
