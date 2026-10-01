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
 * The 2026-10-01 review's probes follow the 2026-09-28 ones, in a section of their own.
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
import type { HostId, MemberId, ObserverId } from '../../src/engine/ids';
import { formatRedoRoutes, parseRedoRoutes } from '../../src/engine/redo/parse';
import { withApplication } from '../../src/engine/application';
import { computeApps } from '../../src/engine/models/app';
import { simulate } from '../../src/engine/sim/simulate';
import type { EngineTrace } from '../../src/engine/sim/simulate';
import { splitBrainOf } from '../../src/engine/sim/split-brain';
import type { TimedEvent } from '../../src/engine/types/events';
import type { DatabaseMember, TopologyDoc } from '../../src/engine/types/topology';
import { applicationsOf } from '../../src/engine/types/topology';
import { validate } from '../../src/engine/validate';
import { farSync as farSyncLesson } from '../../src/content/lessons/far-sync';
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

const segments = (t: EngineTrace, id: string): { t0: number; state: string }[] =>
  t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [];

/** Every database of `d` with `over` applied; far syncs are left alone. */
const withDatabases = (d: TopologyDoc, over: Partial<DatabaseMember>): TopologyDoc => ({
  ...d,
  members: d.members.map((m) => (m.kind === 'database' ? { ...m, ...over } : m)),
});

const withFsfoOff = (d: TopologyDoc): TopologyDoc =>
  ({ ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } });

/** The host of the first standby in document order. */
const firstStandbyHost = (d: TopologyDoc): HostId => {
  const m = d.members.find((x) => x.kind === 'database' && x.role !== 'primary');
  return (m as DatabaseMember).instances[0]?.host as HostId;
};

const logicalOf = (d: TopologyDoc): MemberId =>
  (d.members.find((m) => m.kind === 'database' && m.role === 'logical') as DatabaseMember).id;

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
  /* ---- the Split brain reading (readout chip `split`, engine/sim/split-brain.ts) ----
     Oracle never says "split brain": the reading is two lanes open read-write
     at once, this page's model. Each probe records what the reading answers and
     the sentence a reviewer holds that answer to. */
  {
    finding: 'SBR-01',
    title: 'Primary isolated at 0, PmyShutdown TRUE: split brain no, the primary aborts before the standby opens',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
    ],
    oracle: '"The primary database shuts down if fast-start failover is enabled and V$DATABASE.FS_FAILOVER_STATUS indicates the primary has been STALLED for longer than FastStartFailoverThreshold seconds." (19c property page)',
    open: (t) => promoted(t) && splitBrainOf(t)?.split.value === false
      && splitBrainOf(t)?.formerAtOpen?.kind === 'aborted',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SBR-02',
    title: 'The same, PmyShutdown FALSE: the old primary stays STALLED beside the new one, and the reading says no',
    doc: () => classic({ pmyShutdown: false }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
    ],
    oracle: '"If the configured data loss guarantee cannot be upheld, redo generation on the primary database will be stalled." A stalled primary is not counted as open; whether Oracle would call two databases up, one stalled, a split brain is not stated (19c and 26ai FSFO chapter)',
    open: (t) => promoted(t) && splitBrainOf(t)?.split.value === false
      && splitBrainOf(t)?.formerAtOpen?.kind === 'stalled',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SBR-03',
    title: 'Fast-start failover off, primary cut off and running, manual failover at 5: split brain yes, to the end of the run',
    doc: () => {
      const d = classic();
      return { ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } };
    },
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
      { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
    ],
    oracle: '"Before beginning a failover, first determine that there is no possibility of recovering the primary database in a timely manner, and ensure that the primary database is shut down." (19c and 26ai, Performing a Manual Failover Operation) -- the run raises FAILOVER.PRIMARY_STILL_OPEN and draws the old primary open',
    open: (t) => splitBrainOf(t)?.split.value === true && hasFinding(t, 'FAILOVER.PRIMARY_STILL_OPEN'),
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SBR-04',
    title: 'Fast-start failover off, primary still running and reachable, manual failover at 0: split brain yes, the old primary stays open (owner decision, 2026-09-29)',
    doc: () => {
      const d = classic();
      return { ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } };
    },
    events: () => [{ at: 0, kind: 'cmd.failover', to: CLASSIC_IDS.standby }],
    oracle: 'the same sentence as SBR-03, and FAILOVER.PRIMARY_STILL_OPEN\'s "Until it is, two databases are open as the primary". Nothing documented has the broker close or mount a primary that is still open when a manual failover completes (ORA-16649 is about a former primary that restarts), so the old primary is drawn open, whether or not the new primary can reach it -- FAILOVER.FORMER_PRIMARY_OPEN, this page\'s reading, model. Until 2026-09-29 it was drawn mounted (FAILOVER.FORMER_PRIMARY_MOUNTED) and the two contradicted each other',
    open: (t) => splitBrainOf(t)?.split.value === true && hasFinding(t, 'FAILOVER.PRIMARY_STILL_OPEN')
      && hasFinding(t, 'FAILOVER.FORMER_PRIMARY_OPEN') && !hasFinding(t, 'FAILOVER.FORMER_PRIMARY_MOUNTED'),
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SBR-05',
    title: 'SBR-01 under 26ai',
    doc: () => classic({ version: '26ai' }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
    ],
    oracle: 'as SBR-01 -- the abort is one threshold after the stall began in both editions',
    open: (t) => promoted(t) && splitBrainOf(t)?.split.value === false
      && splitBrainOf(t)?.formerAtOpen?.kind === 'aborted',
  },
  {
    finding: 'SBR-06',
    title: 'SBR-04 with fast-start failover ENABLED, observer on the target: manual failover at 0, split brain yes',
    doc: () => classic(),
    events: () => [{ at: 0, kind: 'cmd.failover', to: CLASSIC_IDS.standby }],
    oracle: '"You must ensure that the primary database is shut down prior to performing a manual failover." (FSFO.MANUAL_FAILOVER_CONDITIONS) -- the shutdown is the operator\'s, and nothing documented closes the old primary otherwise, so it is drawn open with fast-start failover enabled too (owner decision, 2026-09-29)',
    open: (t) => splitBrainOf(t)?.split.value === true && endState(t, 'prm01') === 'open-rw',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SBR-07',
    title: 'SBR-04, then the old primary crashes at 60: the window closes there',
    doc: () => {
      const d = classic();
      return { ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } };
    },
    events: () => [
      { at: 0, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
      { at: 60, kind: 'host.down', host: PRM },
    ],
    oracle: 'the old primary stays open "until something takes it down" is this page\'s reading (FAILOVER.FORMER_PRIMARY_OPEN); a crash is Oracle-neutral and ends it',
    open: (t) => splitBrainOf(t)?.windows[0]?.to === 60 && endState(t, 'prm01') === 'down',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SBR-08',
    title: 'A former primary that goes down and restarts: mounted with fast-start failover off (model), ORA-16649 with it on',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'host.down', host: PRM },
      { at: 5, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
      { at: 100, kind: 'host.up', host: PRM },
    ],
    oracle: '"It will not be allowed to open in any event if fast-start failover is enabled." (ORA-16649) -- about a former primary that restarts; with fast-start failover disabled what state it is left in is not spelled out, and mounted is this page\'s reading (FAILOVER.FORMER_PRIMARY_MOUNTED)',
    open: (t) => endState(t, 'prm01') === 'mounted-noapply' && hasFinding(t, 'FSFO.FORMER_PRIMARY_NOT_OPEN')
      && splitBrainOf(t)?.split.value === false,
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'HEALTHY-01',
    title: '"Everything is working": the classic configuration with no event injected',
    doc: () => classic(),
    events: () => [],
    oracle: 'no page describes a failover without a failure: an automatic failover needs a loss to start it (the rule this page models as FSFO.BOTH_MUST_HAVE_LOST, held to the FSFO chapter), so with nothing injected none starts. The healthy run is this page\'s model of a configuration nothing disturbs -- outcome `continues`, no promotion, no data at risk, no split brain -- and every chip it draws is labelled `model`',
    open: (t) => t.facts.outcome === 'continues' && !promoted(t) && t.facts.abortAt === null
      && endState(t, 'prm01') === 'open-rw' && endState(t, 'sby01') === 'mounted-apply'
      && splitBrainOf(t) === null && t.facts.dataLossKind === 'none',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'ED-01',
    title: '19c with both ObserverPing properties set: crash',
    doc: () => classic({ version: '19c', pingSet: true }),
    events: () => [{ at: 0, kind: 'host.down', host: PRM }],
    oracle: 'neither property exists in 19c (absent from the 12.2/18c/19c pages and from the 19.27 binaries); the threshold minimum is 6 s',
    open: (t) => t.facts.initiateAt !== null && t.facts.initiateAt < 6,
  },

  /* ---- 2026-10-01 review ---- */
  {
    finding: 'SIM-15a',
    title: 'After a fast-start failover, losing the observer stalls and aborts the new primary',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'host.down', host: PRM },
      { at: 200, kind: 'observer.stop', observer: CLASSIC_IDS.observer },
    ],
    oracle: '"While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails." (19c and 26ai FSFO chapter)',
    open: (t) => segments(t, 'sby01').some((s) => s.t0 >= 200 && (s.state === 'stalled' || s.state === 'aborted')),
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-15b',
    title: 'After a switchover, losing the observer aborts the new primary and the new standby',
    doc: () => classic(),
    events: () => [
      { at: 0, kind: 'cmd.switchover', to: CLASSIC_IDS.standby },
      { at: 100, kind: 'observer.stop', observer: CLASSIC_IDS.observer },
    ],
    oracle: '"While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails." (19c and 26ai FSFO chapter); FastStartFailoverPmyShutdown shuts down the primary database, never a standby',
    open: (t) => endState(t, 'sby01') === 'aborted' || endState(t, 'prm01') === 'aborted',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-16',
    title: 'PmyShutdown FALSE, both links cut and never healed: reinstatement starts while the former primary is still cut off',
    doc: () => {
      const d = classic({ pmyShutdown: false });
      return withDatabases(d, { flashbackOn: true, staticServices: true });
    },
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
    ],
    oracle: 'Restrictions on reinstatement: "The master observer cannot connect to the former primary database" / "The former primary database cannot connect to the new primary database" (19c and 26ai FSFO chapter)',
    open: (t) => segments(t, 'prm01').some((s) => s.state === 'reinstating'),
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-17',
    title: 'SWITCHOVER TO a snapshot standby (fast-start failover disabled)',
    doc: () => {
      const d = multiTargetDoc();
      return {
        ...d,
        members: d.members.map((m, i) => (i === 1 && m.kind === 'database'
          ? { ...m, role: 'snapshot' as const, flashbackOn: true } : m)),
        config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } },
      };
    },
    events: (d) => [{ at: 0, kind: 'cmd.switchover', to: (d.members[1] as { id: MemberId }).id }],
    oracle: '"A snapshot standby database cannot be the target of a switchover or a fast-start failover." (19c broker commands, CONVERT DATABASE)',
    open: (t) => !t.facts.blocked && t.facts.newPrimary === memberId('sby01'),
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-18',
    title: 'MaxProtection, two SYNC standbys: one of them lost at 0',
    doc: () => preset('max-protection').doc(),
    events: (d) => [{ at: 0, kind: 'host.down', host: firstStandbyHost(d) }],
    oracle: '"The default value is 0, which means that the LGWR will wait up to the number of seconds specified by the NET_TIMEOUT attribute of the LOG_ARCHIVE_DEST_n parameter for each SYNC standby destination." (19c and 26ai Reference, DATA_GUARD_SYNC_LATENCY)',
    open: (t) => !segments(t, 'prm01').some((s) => s.state === 'commit-hang'),
    lanes: ['prm01'],
  },
  {
    finding: 'SIM-19',
    title: 'PmyShutdown FALSE, primary isolated: DISABLE FAST_START FAILOVER FORCE at 10',
    doc: () => classic({ pmyShutdown: false }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
      { at: 10, kind: 'cmd.disableFsfo', force: true },
    ],
    oracle: '"Disabling fast-start failover with the FORCE option on a primary database that is disconnected from the observer and the target standby database does not prevent the observer from initiating a fast-start failover to the target standby database." (26ai DISABLE FAST_START FAILOVER; the 19c FSFO chapter carries the same caution)',
    open: (t) => t.facts.newPrimary === null && endState(t, 'prm01') === 'open-rw',
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-20',
    title: 'PmyShutdown FALSE, primary stalled by the cut, both links heal at 100: the stalled primary is drawn mounted, labelled documented',
    doc: () => classic({ pmyShutdown: false }),
    events: () => [
      { at: 0, kind: 'link.cut', link: DC1_DC2 },
      { at: 0, kind: 'link.cut', link: DC1_DC3 },
      { at: 100, kind: 'link.heal', link: DC1_DC2 },
      { at: 100, kind: 'link.heal', link: DC1_DC3 },
    ],
    oracle: 'Oracle documents only a former primary that is restarted: "the database must be started and mounted. It will not be allowed to open in any event if fast-start failover is enabled." Nothing says a stalled, still-open primary is closed when contact returns',
    open: (t) => segments(t, 'prm01').some((s) => s.t0 === 100 && s.state === 'mounted-noapply')
      && t.findings.some((f) => f.id === 'FSFO.FORMER_PRIMARY_NOT_OPEN' && f.basis === 'documented'),
    lanes: ['prm01', 'sby01'],
  },
  {
    finding: 'SIM-21',
    title: 'Bystanders preset, fast-start failover disabled: SWITCHOVER TO the logical standby',
    doc: () => withFsfoOff(preset('bystanders').doc()),
    events: (d) => [{ at: 0, kind: 'cmd.switchover', to: logicalOf(d) }],
    oracle: '"All physical and snapshot standby databases will be disabled and must be re-created from a copy of the new primary database after a switchover to a logical standby database." (19c FSFO chapter; 26ai SWITCHOVER)',
    open: (t) => t.facts.outcome === 'switchover' && endState(t, 'sby01') === 'mounted-apply',
    lanes: ['prm01', 'sby01', 'lsby01', 'snp01'],
  },
  {
    finding: 'VAL-07',
    title: 'Bystanders preset in MaxProtection, fast-start failover disabled: SWITCHOVER TO the logical standby',
    doc: () => {
      const d = withFsfoOff(preset('bystanders').doc());
      return { ...d, config: { ...d.config, protectionMode: 'MAXPROTECTION' } };
    },
    events: (d) => [{ at: 0, kind: 'cmd.switchover', to: logicalOf(d) }],
    oracle: '"Switchover to a logical standby database is disallowed when the configuration is operating in maximum protection mode." (19c FSFO chapter; 26ai SWITCHOVER)',
    open: (t) => !t.facts.blocked && t.facts.newPrimary === memberId('lsby01'),
    lanes: ['prm01', 'lsby01'],
  },
  {
    finding: 'SIM-22',
    title: 'Three observers: STOP OBSERVER on the master while the backups run',
    doc: () => preset('multi-target-three-observers').doc(),
    events: (d) => [{ at: 0, kind: 'observer.stop', observer: (d.observers.find((o) => o.role === 'master') as { id: ObserverId }).id }],
    oracle: '"The STOP OBSERVER command fails if there are two or more registered observers and you attempt to stop only the master." (19c broker commands; 26ai STOP OBSERVER)',
    open: (t) => !t.findings.some((f) => /STOP|REFUS/i.test(f.id))
      && (t.decisions ?? []).some((d) => d.id === 'NOMINATION.NEW_MASTER'),
  },
  {
    finding: 'TXT-52',
    title: 'MaxProtection preset, its own events: the commit-hang decision says the primary "drops the destination and carries on" in the run that shuts it down',
    doc: () => preset('max-protection').doc(),
    events: () => preset('max-protection').events(),
    oracle: '"To ensure that data loss cannot occur, the primary database will shut down, rather than continue processing transactions, if it cannot write its redo stream to at least one synchronized standby database." (19c members chapter)',
    /* Since the fix a commit hang is a decision of its own each time (the first standby lost
       carries on, the last one lost shuts the primary down), so the question is about the
       hang that ends in the shutdown, not about whether any hang says "carries on". */
    open: (t) => {
      const ds = t.decisions ?? [];
      const shutdown = ds.find((d) => d.id === 'PROT.MAXPROT_SHUTDOWN');
      const hang = shutdown === undefined ? undefined
        : ds.filter((d) => d.id === 'PROT.COMMIT_HANG' && d.at <= shutdown.at).pop();
      return hang !== undefined && String(hang.claim.value).includes('carries on');
    },
    lanes: ['prm01'],
  },
  {
    finding: 'SIM-31',
    title: 'RAC primary preset, its own events: "no fast-start failover clock starts" is labelled documented',
    doc: () => preset('rac-primary').doc(),
    events: () => preset('rac-primary').events(),
    oracle: '"Fast-start failover will not occur unless all instances comprising the Oracle RAC primary database are perceived to have failed." and "If you have an Oracle RAC primary database, consider specifying a higher value to minimize the possibility of a false failover in the event of an instance failure." (19c and 26ai FSFO chapter) -- neither cited sentence (RAC.PRIMARY_AVAILABLE, RAC.LAST_INSTANCE_FSFO) says anything about a clock',
    open: (t) => (t.decisions ?? []).some((d) => d.id === 'RAC.PRIMARY_DEGRADED' && d.claim.basis === 'documented'
      && String(d.claim.value).includes('no fast-start failover clock starts')),
    lanes: ['prm01'],
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
    finding: 'APP-01',
    title: 'Two applications, one run: each dials the descriptor it has, from where it stands',
    oracle: '"If a connection attempt fails across all ADDRESS_LISTS, then additional attempts to connect beginning with the first ADDRESS_LIST will be made RETRY_COUNT times" (19c HA guide, Oracle Net TNS string parameters) -- per connect string, so a string with RETRY_COUNT 2 has a budget of three traversals and one with none of one',
    run: () => {
      /* Both apps stand in DC2, the standby's data centre; the primary's host crashes at 0.
         app02 has a string of its own with RETRY_COUNT 2; app01 dials the shared one. */
      const base = withApplication(withApplication(classic(), siteId('dc2')), siteId('dc2'));
      const doc: TopologyDoc = {
        ...base,
        applications: applicationsOf(base).map((a, i) => (i === 1
          ? { ...a, client: { ...base.client, retryCount: 2, retryDelaySeconds: 5 } }
          : a)),
      };
      const t = simulate(doc, [{ at: 0, kind: 'host.down', host: PRM }]);
      const [shared, own] = computeApps(t, doc);
      const traversals = (m: NonNullable<typeof shared>): number => m.attempts.length;
      return {
        open: shared !== undefined && own !== undefined
          && traversals(shared) === 1 && shared.application?.id === 'app01'
          && own.application?.id === 'app02' && own.worst > shared.worst,
        now: [shared, own].map((m) => `${m?.application?.id ?? '-'}: attempts=${m ? traversals(m) : '-'} tConn=${m?.tConn ?? '-'} worst=${m?.worst ?? '-'}`).join(' / '),
      };
    },
  },
  {
    finding: 'APP-02',
    title: 'SBR-07 from the application\'s side: the old primary the sessions are on crashes at 60 while the new primary is already publishing',
    oracle: 'nothing documented has two open primaries both publish a role-based service, so the overlap, the sessions staying on the database they are on and the new connection landing on the first address that publishes are this page\'s model (APP.TWO_PUBLISHERS, on FAILOVER.FORMER_PRIMARY_OPEN). The part that is documented is that the string moves on at all: FAILOVER is "Default on for the DESCRIPTION_LIST, DESCRIPTION, and ADDRESS_LIST parameters" (19c Net Services Reference, CLIENT.RETRY_AND_FAILOVER), which is how one traversal gets past the dead address 1 to the new primary at address 2',
    run: () => {
      const base = withApplication(classic(), siteId('dc1'));
      const doc: TopologyDoc = { ...base, config: { ...base.config, fsfo: { ...base.config.fsfo, state: 'disabled' } } };
      const t = simulate(doc, [
        { at: 0, kind: 'cmd.failover', to: CLASSIC_IDS.standby },
        { at: 60, kind: 'host.down', host: PRM },
      ]);
      const [ap] = computeApps(t, doc);
      const spans = (ap?.spans ?? []).map((x) => `[${x.t0}..${x.t1 ?? 'end'}) ${x.publishers.map((q) => `${q.member}${q.reached ? '' : '(unreached)'}`).join('+') || 'none'}`);
      return {
        open: ap !== undefined && ap.lostAt === 60 && ap.sessionsOn === 'prm01' && ap.servedAtLoss === 'sby01'
          && ap.tService === 60 && ap.tConn !== null && ap.claims.overlap?.basis === 'model',
        now: `lostAt=${ap?.lostAt ?? '-'} sessionsOn=${ap?.sessionsOn ?? '-'} servedAtLoss=${ap?.servedAtLoss ?? '-'} tService=${ap?.tService ?? '-'} tConn=${ap?.tConn ?? '-'} publishers: ${spans.join(' ')}`,
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
  /* ---- 2026-10-01 review ---- */
  {
    finding: 'TXT-50',
    title: 'Far sync lesson, step "When the far sync fails": the member id its event names, against the preset the lesson runs on',
    oracle: 'the step note says the far sync goes away and the protection level drops; with an unknown id the run shows neither',
    run: () => {
      const step = farSyncLesson.steps.find((x) => x.title === 'When the far sync fails');
      const named = step?.apply?.events?.flatMap((e) => ('member' in e ? [e.member as string] : [])) ?? [];
      const ids = preset('far-sync-zero-loss').doc().members.map((m) => m.id as string);
      return {
        open: named.length > 0 && named.some((id) => !ids.includes(id)),
        now: `step names ${named.join(', ') || '(none)'}; preset members: ${ids.join(', ')}`,
      };
    },
  },
  {
    finding: 'SIM-30',
    title: 'RAC primary, one instance down at 0, an application on it: the sessions on that instance are drawn as untouched',
    oracle: '"Any sessions active when the instance or service stops are terminated and the application user is immediately notified." / "If TAF is not configured, then the client only receives an error if the instance it is connected to fails." (19c RAC Administration, Application Continuity and Workload Management; 26ai the same)',
    run: () => {
      const base = withApplication(preset('rac-primary').doc(), siteId('dc1'));
      const primary = base.members.find((m) => m.kind === 'database' && m.role === 'primary') as DatabaseMember;
      const instance = primary.instances[0]?.name as string;
      const t = simulate(base, [{ at: 0, kind: 'instance.down', member: primary.id, instance }]);
      const [ap] = computeApps(t, base);
      return {
        open: ap !== undefined && ap.lostAt === null && ap.noEvent,
        now: `instance.down ${primary.id}/${instance}: lostAt=${ap?.lostAt ?? 'null'} sessionsOn=${ap?.sessionsOn ?? '-'} noEvent=${ap?.noEvent ?? '-'} noEventKind=${ap?.noEventKind ?? '-'}`,
      };
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
