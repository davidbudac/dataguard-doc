/**
 * One test per rule that trips it, and one that does not.
 *
 * The "silent" document in each pair is a near miss wherever there is one --
 * NetTimeout at 8 s rather than 5, thirty terminal destinations rather than
 * thirty-one, a far sync feeding the target rather than a cascading standby --
 * so the pair pins the boundary and not just the two extremes.
 */

import { describe, expect, it } from 'vitest';
import { validate } from '..';
import { RULE_IDS } from '../catalogue';
import type { RuleId } from '../catalogue';
import type { Finding } from '../../types/claims';
import type { TopologyDoc } from '../../types/topology';
import { memberId } from '../../ids';
import { build, farSync, observer } from '../../../../test/topologies';
import {
  baseDoc, cascadeDoc, cutLink, database, dbOf, farSyncDoc, M, manyDestinationsDoc,
  manyMembersDoc, memberOf, rule, setDest, twoStandbyDoc,
} from './fixtures';

const ids = (fs: Finding[]): string[] => fs.map((f) => f.id);
const idsFor = (doc: TopologyDoc): string[] => ids(validate(doc));

interface Case {
  id: RuleId;
  fires: string;
  quiet: string;
  trigger: () => TopologyDoc;
  silent: () => TopologyDoc;
}

const withRoutes = (doc: TopologyDoc, id: string, routes: ReturnType<typeof rule>[]): TopologyDoc => {
  memberOf(doc, id).redoRoutes = routes;
  return doc;
};

const observerHosts = (n: number): [string, string, string?][] => [
  ['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'],
  ...Array.from({ length: n }, (_, i) => [`dc3-obs0${i + 1}`, 'dc3'] as [string, string]),
];

const observers = (n: number, role: 'master' | 'backup' = 'backup'): TopologyDoc['observers'] =>
  Array.from({ length: n }, (_, i) => observer(`obs0${i + 1}`, `dc3-obs0${i + 1}`, i === 0 ? 'master' : role));

const altRoutes = () => [rule('LOCAL', [{
  target: M('sby01'), xpt: 'SYNC' as const,
  alt: { target: M('sby02'), xpt: 'ASYNC' as const, fallback: true },
}])];

const priorityRoutes = () => [{
  source: 'LOCAL' as const,
  groups: [{
    dests: [
      { target: M('sby01'), xpt: 'SYNC' as const, priority: 1 as const },
      { target: M('sby02'), xpt: 'ASYNC' as const, priority: 2 as const },
    ],
    explicitGroup: true,
  }],
}];

/** A RAC cluster with a third node the observer would sit on. */
function racClusterDoc(observerOnCluster: boolean): TopologyDoc {
  const prm = database('prm01', ['dc1-node1', 'dc1-node2'], 'primary');
  const sby = database('sby01', ['dc2-sby01'], 'physical');
  prm.dests[memberId('sby01')] = { netTimeoutSeconds: 30, reopenSeconds: 300, maxFailure: 0 };
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [
      ['dc1-node1', 'dc1', 'rac1'], ['dc1-node2', 'dc1', 'rac1'], ['dc1-node3', 'dc1', 'rac1'],
      ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3'],
    ],
    members: [prm, sby],
    observers: [observer('obs01', observerOnCluster ? 'dc1-node3' : 'dc3-obs01')],
    targets: [sby.id],
  });
}

const CASES: Case[] = [
  {
    id: 'MEMBER.FARSYNC_NOT_PRIMARY',
    fires: 'PrimaryDatabaseCandidates lists a far sync instance',
    quiet: 'the candidate list holds databases only',
    trigger: () => {
      const d = farSyncDoc();
      d.config.primaryDatabaseCandidates = [M('prm01'), M('fs1')];
      return d;
    },
    silent: () => {
      const d = farSyncDoc();
      d.config.primaryDatabaseCandidates = [M('prm01'), M('sby01')];
      return d;
    },
  },
  {
    id: 'FSFO.TARGET_KIND',
    fires: 'FastStartFailoverTarget names the far sync instance',
    quiet: 'it names the physical standby',
    trigger: () => {
      const d = farSyncDoc();
      d.config.fsfo.target = { kind: 'list', members: [M('fs1')] };
      return d;
    },
    silent: () => farSyncDoc(),
  },
  {
    id: 'FSFO.TARGET_DIRECT_REDO',
    fires: 'the target is a cascaded terminal standby',
    quiet: 'the target receives its redo from a far sync instance',
    trigger: () => cascadeDoc({ targets: [M('term1')] }),
    silent: () => farSyncDoc(),
  },
  {
    id: 'FSFO.MULTI_TARGET_EXPLICIT',
    fires: 'two standbys and no FastStartFailoverTarget',
    quiet: 'two standbys with the property set',
    trigger: () => twoStandbyDoc({ targets: [] }),
    silent: () => twoStandbyDoc(),
  },
  {
    id: 'FSFO.FARSYNC_XPT',
    fires: 'the far sync instance receives ASYNC',
    quiet: 'SYNC into the far sync and ASYNC onward',
    trigger: () => farSyncDoc({ toFarSync: 'ASYNC' }),
    silent: () => farSyncDoc(),
  },
  {
    id: 'FSFO.FARSYNC_MODE_19C',
    fires: '19c, maximum performance, far sync in the redo path',
    quiet: 'the same configuration in maximum availability',
    trigger: () => farSyncDoc({ edition: '19c', mode: 'MAXPERFORMANCE' }),
    silent: () => farSyncDoc({ edition: '19c', mode: 'MAXAVAILABILITY' }),
  },
  {
    id: 'FSFO.LOGICAL_MAXPROT',
    fires: 'a logical standby is a candidate target in maximum protection',
    quiet: 'the same logical target in maximum availability',
    trigger: () => twoStandbyDoc({ mode: 'MAXPROTECTION', secondRole: 'logical', targets: [M('sby02')] }),
    silent: () => twoStandbyDoc({ mode: 'MAXAVAILABILITY', secondRole: 'logical', targets: [M('sby02')] }),
  },
  {
    id: 'FSFO.LAGLIMIT_VS_THRESHOLD',
    fires: 'the lag limit is above the threshold',
    quiet: 'the lag limit equals the threshold',
    trigger: () => {
      const d = baseDoc();
      d.config.fsfo.lagLimitSeconds = 45;
      return d;
    },
    silent: () => {
      const d = baseDoc();
      d.config.fsfo.lagLimitSeconds = d.config.fsfo.thresholdSeconds;
      return d;
    },
  },
  {
    id: 'FSFO.LAGTYPE_MODE',
    fires: 'FastStartFailoverLagType is TRANSPORT outside maximum performance',
    quiet: 'the same property in maximum performance',
    trigger: () => {
      const d = baseDoc();
      d.config.fsfo.lagType = 'TRANSPORT';
      return d;
    },
    silent: () => {
      const d = baseDoc({ mode: 'MAXPERFORMANCE' });
      d.config.fsfo.lagType = 'TRANSPORT';
      return d;
    },
  },
  {
    id: 'FSFO.OBSERVE_ONLY',
    fires: 'fast-start failover is enabled in observe-only mode',
    quiet: 'it is enabled normally',
    trigger: () => baseDoc({ fsfo: 'observe-only' }),
    silent: () => baseDoc(),
  },
  {
    id: 'MODE.MAXPROT_NEEDS_SYNC_DB',
    fires: 'only a far sync instance receives redo synchronously',
    quiet: 'a standby database receives SYNC',
    trigger: () => farSyncDoc({ mode: 'MAXPROTECTION' }),
    silent: () => baseDoc({ mode: 'MAXPROTECTION' }),
  },
  {
    id: 'MODE.MAXPROT_SNAPSHOT_ONLY',
    fires: 'the only standby is a snapshot standby',
    quiet: 'it is a physical standby',
    trigger: () => {
      const d = baseDoc({ mode: 'MAXPROTECTION', fsfo: 'disabled' });
      dbOf(d, 'sby01').role = 'snapshot';
      return d;
    },
    silent: () => baseDoc({ mode: 'MAXPROTECTION', fsfo: 'disabled' }),
  },
  {
    id: 'MODE.MAXPROT_ONE_STANDBY',
    fires: 'maximum protection with a single standby',
    quiet: 'maximum protection with two',
    trigger: () => baseDoc({ mode: 'MAXPROTECTION' }),
    silent: () => twoStandbyDoc({ mode: 'MAXPROTECTION' }),
  },
  {
    id: 'XPT.TABLE_4_2',
    fires: 'ASYNC into a maximum protection configuration',
    quiet: 'SYNC into it',
    trigger: () => {
      const d = baseDoc({ mode: 'MAXPROTECTION' });
      dbOf(d, 'sby01').logXptMode = 'ASYNC';
      return d;
    },
    silent: () => baseDoc({ mode: 'MAXPROTECTION' }),
  },
  {
    id: 'XPT.FASTSYNC_MAXAVAIL_ONLY',
    fires: 'FASTSYNC in maximum performance',
    quiet: 'FASTSYNC in maximum availability',
    trigger: () => {
      const d = baseDoc({ mode: 'MAXPERFORMANCE' });
      dbOf(d, 'sby01').logXptMode = 'FASTSYNC';
      return d;
    },
    silent: () => {
      const d = baseDoc({ mode: 'MAXAVAILABILITY' });
      dbOf(d, 'sby01').logXptMode = 'FASTSYNC';
      return d;
    },
  },
  {
    id: 'XPT.FASTSYNC_FSFO_GAP',
    fires: 'the fast-start failover target is fed over FASTSYNC',
    quiet: 'fast-start failover is disabled',
    trigger: () => {
      const d = baseDoc();
      dbOf(d, 'sby01').logXptMode = 'FASTSYNC';
      return d;
    },
    silent: () => {
      const d = baseDoc({ fsfo: 'disabled' });
      dbOf(d, 'sby01').logXptMode = 'FASTSYNC';
      return d;
    },
  },
  {
    id: 'ROUTES.SOURCE_UNIQUE',
    fires: 'a rule sourced at LOCAL and one naming the member itself -- LOCAL is the local database',
    quiet: 'the second rule names a different source',
    trigger: () => withRoutes(baseDoc(), 'prm01', [
      rule('LOCAL', [{ target: M('sby01'), xpt: 'SYNC' }]),
      rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }]),
    ]),
    silent: () => withRoutes(baseDoc(), 'prm01', [
      rule('LOCAL', [{ target: M('sby01'), xpt: 'SYNC' }]),
      rule([M('sby01')], [{ target: M('sby01'), xpt: 'ASYNC' }]),
    ]),
  },
  {
    id: 'ROUTES.LOCAL_AT_FARSYNC',
    fires: 'a far sync instance carries a LOCAL rule',
    quiet: 'it names the primary as the source',
    trigger: () => withRoutes(farSyncDoc(), 'fs1', [rule('LOCAL', [{ target: M('sby01'), xpt: 'ASYNC' }])]),
    silent: () => farSyncDoc(),
  },
  {
    id: 'ROUTES.SNAPSHOT_FORBIDDEN',
    fires: 'a snapshot standby carries a rule that would forward redo to another member',
    quiet: 'the snapshot standby carries only a LOCAL rule, which sends nothing while it is a standby',
    trigger: () => {
      const d = twoStandbyDoc({ targets: [M('sby01')] });
      const sby = dbOf(d, 'sby02');
      sby.role = 'snapshot';
      sby.redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
      return d;
    },
    silent: () => {
      const d = baseDoc({ fsfo: 'disabled' });
      const sby = dbOf(d, 'sby01');
      sby.role = 'snapshot';
      sby.redoRoutes = [rule('LOCAL', [{ target: 'ALL' }])];
      return d;
    },
  },
  {
    id: 'ROUTES.LOGICAL_LOCAL_ONLY',
    fires: 'a logical standby carries a rule whose source is not LOCAL',
    quiet: 'its only rule is a LOCAL one',
    trigger: () => {
      const d = twoStandbyDoc({ secondRole: 'logical', targets: [M('sby01')] });
      dbOf(d, 'sby02').redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
      return d;
    },
    silent: () => {
      const d = twoStandbyDoc({ secondRole: 'logical', targets: [M('sby01')] });
      dbOf(d, 'sby02').redoRoutes = [rule('LOCAL', [{ target: 'ALL' }])];
      return d;
    },
  },
  {
    id: 'ROUTES.ALT_NEEDS_MAXFAILURE',
    fires: 'an alternate destination with MaxFailure at 0',
    quiet: 'the same alternate with MaxFailure at 2',
    trigger: () => withRoutes(twoStandbyDoc(), 'prm01', altRoutes()),
    silent: () => {
      const d = withRoutes(twoStandbyDoc(), 'prm01', altRoutes());
      setDest(d, 'prm01', 'sby01', { maxFailure: 2 });
      return d;
    },
  },
  {
    id: 'ROUTES.GROUP_NEEDS_MAXFAILURE',
    fires: '26ai, a PRIORITY group holding a member whose MaxFailure is set to 0',
    quiet: 'the same group with MaxFailure at 2',
    trigger: () => {
      const d = twoStandbyDoc();
      d.config.edition = '26ai';
      memberOf(d, 'prm01').redoRoutes = priorityRoutes();
      setDest(d, 'prm01', 'sby01', { maxFailure: 0 });
      return d;
    },
    silent: () => {
      const d = twoStandbyDoc();
      d.config.edition = '26ai';
      memberOf(d, 'prm01').redoRoutes = priorityRoutes();
      setDest(d, 'prm01', 'sby01', { maxFailure: 2 });
      setDest(d, 'prm01', 'sby02', { maxFailure: 2 });
      return d;
    },
  },
  {
    id: 'ROUTES.ALT_12_1_ONLY',
    fires: 'an ALT destination, under 19c as under 26ai',
    quiet: 'the same remote alternate written with PRIORITY',
    trigger: () => withRoutes(twoStandbyDoc(), 'prm01', altRoutes()),
    silent: () => {
      const d = twoStandbyDoc();
      memberOf(d, 'prm01').redoRoutes = priorityRoutes();
      setDest(d, 'prm01', 'sby01', { maxFailure: 1 });
      setDest(d, 'prm01', 'sby02', { maxFailure: 1 });
      return d;
    },
  },
  {
    id: 'ROUTES.CASCADE_PHYSICAL_ONLY',
    fires: 'a logical standby forwards redo onward',
    quiet: 'a physical standby cascades',
    trigger: () => cascadeDoc({ cascaderRole: 'logical' }),
    silent: () => cascadeDoc(),
  },
  {
    id: 'ROUTES.CASCADE_RT_ASYNC',
    fires: 'the cascaded destination carries no transport attribute',
    quiet: 'ASYNC is spelled out',
    trigger: () => cascadeDoc({ onward: 'none' }),
    silent: () => cascadeDoc(),
  },
  {
    id: 'ROUTES.CASCADE_FANOUT_30',
    fires: 'thirty-one terminal destinations',
    quiet: 'thirty of them',
    trigger: () => cascadeDoc({ terminals: 31 }),
    silent: () => cascadeDoc({ terminals: 30 }),
  },
  {
    id: 'ROUTES.CASCADE_SYNC_UNDOC',
    fires: 'the cascader ships SYNC to its terminal standby',
    quiet: 'it ships ASYNC',
    trigger: () => cascadeDoc({ onward: 'SYNC' }),
    silent: () => cascadeDoc(),
  },
  {
    id: 'ROUTES.FARSYNC_ONWARD_SYNC_UNDOC',
    fires: 'the far sync instance forwards over SYNC',
    quiet: 'it forwards over ASYNC',
    trigger: () => farSyncDoc({ onward: 'SYNC' }),
    silent: () => farSyncDoc(),
  },
  {
    id: 'ROUTES.CYCLE',
    fires: 'two standbys forward to each other',
    quiet: 'the routes form a tree',
    trigger: () => {
      const d = twoStandbyDoc();
      memberOf(d, 'prm01').redoRoutes = [rule('LOCAL', [{ target: M('sby01'), xpt: 'SYNC' }])];
      memberOf(d, 'sby01').redoRoutes = [rule([M('prm01')], [{ target: M('sby02'), xpt: 'ASYNC' }])];
      memberOf(d, 'sby02').redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
      return d;
    },
    silent: () => twoStandbyDoc(),
  },
  {
    id: 'NET.DIRECT_LINK_REQUIRED',
    fires: 'the primary-to-standby link is gone and only the far sync path remains',
    quiet: 'the direct link is up',
    trigger: () => farSyncDoc({ cutDirect: true }),
    silent: () => farSyncDoc(),
  },
  {
    id: 'OBS.COUNT',
    fires: 'four observers under 19c',
    quiet: 'four observers under 26ai',
    trigger: () => baseDoc({ hosts: observerHosts(4), observers: observers(4) }),
    silent: () => baseDoc({ edition: '26ai', hosts: observerHosts(4), observers: observers(4) }),
  },
  {
    id: 'OBS.ON_DB_HOST',
    fires: 'the observer runs on the standby host',
    quiet: 'it runs on a host of its own',
    trigger: () => baseDoc({ observers: [observer('obs01', 'dc2-sby01')] }),
    silent: () => baseDoc(),
  },
  {
    id: 'OBS.PRIMARY_SITE',
    fires: "the observer runs in the primary's site",
    quiet: 'it runs in a third data centre',
    trigger: () => baseDoc({
      hosts: [['dc1-prm01', 'dc1'], ['dc1-obs01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      observers: [observer('obs01', 'dc1-obs01')],
    }),
    silent: () => baseDoc(),
  },
  {
    id: 'OBS.NONE_DEPLOYED',
    fires: 'no observer is deployed',
    quiet: 'one is',
    trigger: () => baseDoc({ observers: [] }),
    silent: () => baseDoc(),
  },
  {
    id: 'OBS.MASTER_UNIQUE',
    fires: 'two observers are marked master',
    quiet: 'one master and one backup',
    trigger: () => baseDoc({ hosts: observerHosts(2), observers: observers(2, 'master') }),
    silent: () => baseDoc({ hosts: observerHosts(2), observers: observers(2, 'backup') }),
  },
  {
    id: 'OBS.PREFERRED_HOSTS',
    fires: 'PreferredObserverHosts leaves a deployed observer out',
    quiet: 'it names every observer host',
    trigger: () => {
      const d = baseDoc({ hosts: observerHosts(2), observers: observers(2) });
      d.config.fsfo.preferredObserverHosts = [{ host: d.hosts[2]!.id, priority: 1 }];
      return d;
    },
    silent: () => {
      const d = baseDoc({ hosts: observerHosts(2), observers: observers(2) });
      d.config.fsfo.preferredObserverHosts = [
        { host: d.hosts[2]!.id, priority: 1 }, { host: d.hosts[3]!.id, priority: 2 },
      ];
      return d;
    },
  },
  {
    id: 'RAC.OBSERVER_ON_CLUSTER',
    fires: 'the observer runs on a third node of the database cluster',
    quiet: 'it runs outside the cluster',
    trigger: () => racClusterDoc(true),
    silent: () => racClusterDoc(false),
  },
  {
    id: 'REINSTATE.PRECONDITIONS',
    fires: 'FastStartFailoverAutoReinstate is on with Flashback Database off',
    quiet: 'both databases meet the preconditions',
    trigger: () => {
      const d = baseDoc();
      dbOf(d, 'sby01').flashbackOn = false;
      return d;
    },
    silent: () => baseDoc(),
  },
  {
    id: 'DEST.NETTIMEOUT_LOW',
    fires: 'NetTimeout at 5 s',
    quiet: 'NetTimeout at 8 s',
    trigger: () => {
      const d = baseDoc();
      setDest(d, 'prm01', 'sby01', { netTimeoutSeconds: 5 });
      return d;
    },
    silent: () => {
      const d = baseDoc();
      setDest(d, 'prm01', 'sby01', { netTimeoutSeconds: 8 });
      return d;
    },
  },
  {
    id: 'DEST.REOPEN_ZERO',
    fires: 'ReopenSecs at 0',
    quiet: 'ReopenSecs at its 300 s default',
    trigger: () => {
      const d = baseDoc();
      setDest(d, 'prm01', 'sby01', { reopenSeconds: 0 });
      return d;
    },
    silent: () => baseDoc(),
  },
  {
    id: 'DEST.MAXFAILURE_RESET_UNDOC',
    fires: 'MaxFailure is bounded',
    quiet: 'MaxFailure is 0, the unlimited default',
    trigger: () => {
      const d = baseDoc();
      setDest(d, 'prm01', 'sby01', { maxFailure: 3 });
      return d;
    },
    silent: () => baseDoc(),
  },
  {
    id: 'DEST.DEPRECATED_19C',
    fires: 'ReopenSecs is set away from the broker default',
    quiet: 'both properties are left at their defaults',
    trigger: () => {
      const d = baseDoc();
      setDest(d, 'prm01', 'sby01', { reopenSeconds: 600 });
      return d;
    },
    silent: () => baseDoc(),
  },
  {
    id: 'DEST.RANGE',
    fires: 'thirty-one destinations on one member',
    quiet: 'thirty of them',
    trigger: () => manyDestinationsDoc(31),
    silent: () => manyDestinationsDoc(30),
  },
  {
    id: 'EDIT.FSFO_ENABLED_BLOCKS',
    fires: 'fast-start failover is enabled',
    quiet: 'it is disabled',
    trigger: () => baseDoc(),
    silent: () => baseDoc({ fsfo: 'disabled' }),
  },
  {
    id: 'EDIT.REMOVE_TARGET',
    fires: 'a member is named by FastStartFailoverTarget',
    quiet: 'the property names nobody',
    trigger: () => baseDoc(),
    silent: () => baseDoc({ targets: [] }),
  },
  {
    id: 'LIMIT.MEMBERS_253',
    fires: 'the configuration holds more than 253 members',
    quiet: 'it holds a hundred',
    trigger: () => manyMembersDoc(253),
    silent: () => manyMembersDoc(98),
  },
  {
    id: 'MODEL.OBSERVER_OVERRIDE',
    fires: 'fast-start failover is enabled, so the assumption is load-bearing',
    quiet: 'fast-start failover is disabled',
    trigger: () => baseDoc(),
    silent: () => baseDoc({ fsfo: 'disabled' }),
  },
  {
    id: 'FSFO.PING_PROPS_NOT_IN_19C',
    fires: 'ObserverPingInterval/Retry are set under 19c',
    quiet: 'they are left unset',
    trigger: () => {
      const d = baseDoc({ edition: '19c' });
      d.config.fsfo.pingIntervalMs = 100;
      d.config.fsfo.pingRetry = 10;
      return d;
    },
    silent: () => baseDoc({ edition: '19c' }),
  },
  {
    id: 'FSFO.LAGTYPE_GRACETIME_19C',
    fires: 'FastStartFailoverLagType is TRANSPORT under 19c',
    quiet: 'it is left at APPLY',
    trigger: () => {
      const d = baseDoc({ edition: '19c' });
      d.config.fsfo.lagType = 'TRANSPORT';
      return d;
    },
    silent: () => baseDoc({ edition: '19c' }),
  },
  {
    id: 'CFG.PRIMARY_CANDIDATES_19C',
    fires: 'PrimaryDatabaseCandidates is set under 19c',
    quiet: 'it is left empty',
    trigger: () => {
      const d = baseDoc({ edition: '19c' });
      d.config.primaryDatabaseCandidates = [M('prm01')];
      return d;
    },
    silent: () => baseDoc({ edition: '19c' }),
  },
  {
    id: 'FSFO.FARSYNC_TARGET_BOTH_SIDES',
    fires: 'the fast-start failover target is fed through a far sync instance',
    quiet: 'fast-start failover is disabled',
    trigger: () => farSyncDoc(),
    silent: () => farSyncDoc({ fsfo: 'disabled' }),
  },
  {
    id: 'FSFO.FLASHBACK_REQUIRED',
    fires: 'fast-start failover is enabled with Flashback Database off on the target',
    quiet: 'Flashback Database is on',
    trigger: () => {
      const d = baseDoc();
      dbOf(d, 'sby01').flashbackOn = false;
      return d;
    },
    silent: () => baseDoc(),
  },
  {
    id: 'MEMBER.SNAPSHOT_NEEDS_FLASHBACK',
    fires: 'a snapshot standby has Flashback Database off',
    quiet: 'Flashback Database is on',
    trigger: () => {
      const d = baseDoc({ fsfo: 'disabled' });
      const sby = dbOf(d, 'sby01');
      sby.role = 'snapshot';
      sby.flashbackOn = false;
      return d;
    },
    silent: () => {
      const d = baseDoc({ fsfo: 'disabled' });
      dbOf(d, 'sby01').role = 'snapshot';
      return d;
    },
  },
  {
    id: 'OBS.NAME_RESERVED',
    fires: 'two observers share a name',
    quiet: 'their names differ',
    trigger: () => baseDoc({
      hosts: observerHosts(2),
      observers: [observer('obs01', 'dc3-obs01', 'master'), observer('obs01', 'dc3-obs02')],
    }),
    silent: () => baseDoc({ hosts: observerHosts(2), observers: observers(2) }),
  },
];

describe('the rule catalogue is covered', () => {
  it('has a pair of tests for every rule the design lists', () => {
    const covered = new Set(CASES.map((c) => c.id));
    for (const id of RULE_IDS) expect([...covered], id).toContain(id);
    expect(covered.size).toBe(RULE_IDS.length);
  });

  it('emits nothing outside the catalogue', () => {
    const known = new Set<string>(RULE_IDS);
    for (const c of CASES) {
      for (const id of idsFor(c.trigger())) expect(known, id).toContain(id);
      for (const id of idsFor(c.silent())) expect(known, id).toContain(id);
    }
  });
});

for (const c of CASES) {
  describe(c.id, () => {
    it(`fires when ${c.fires}`, () => {
      expect(idsFor(c.trigger())).toContain(c.id);
    });
    it(`stays quiet when ${c.quiet}`, () => {
      expect(idsFor(c.silent())).not.toContain(c.id);
    });
  });
}

describe('the clean configuration', () => {
  it('reports only the three notes a healthy enabled configuration carries', () => {
    expect(idsFor(baseDoc()).sort()).toEqual([
      'EDIT.FSFO_ENABLED_BLOCKS', 'EDIT.REMOVE_TARGET', 'MODEL.OBSERVER_OVERRIDE',
    ]);
  });

  it('reports only the target note with fast-start failover disabled', () => {
    /* ORA-16867 does not wait for the observer: the property still names the
       member, so REMOVE DATABASE still fails. */
    expect(idsFor(baseDoc({ fsfo: 'disabled' }))).toEqual(['EDIT.REMOVE_TARGET']);
  });

  it('reports nothing at all once the target property is empty too', () => {
    expect(idsFor(baseDoc({ fsfo: 'disabled', targets: [] }))).toEqual([]);
  });

  it('is deterministic and sorted by severity, then subject, then id', () => {
    const doc = twoStandbyDoc({ mode: 'MAXPROTECTION', targets: [] });
    const a = validate(doc);
    const b = validate(doc);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const rank = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < a.length; i++) {
      expect(rank[a[i]!.severity]).toBeGreaterThanOrEqual(rank[a[i - 1]!.severity]);
    }
  });
});

describe('a document that says fast-start failover is enabled with no observer', () => {
  const find = (doc: ReturnType<typeof baseDoc>) =>
    validate(doc).find((f) => f.id === 'OBS.NONE_DEPLOYED');

  it('warns, and says the configuration is unobserved with ORA-16819, never "cannot both be true"', () => {
    /* Enabling fast-start failover with no observer started is legal and
       documented (ORA-16819), not an inconsistency the document is caught
       in -- VAL-04. */
    const f = find(baseDoc({ observers: [] }));
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('fsfo.state = enabled');
    expect(f?.message).toContain('ORA-16819');
    expect(f?.message).toContain('is unobserved and no failover can happen');
    expect(f?.ora).toBe('ORA-16819');
    expect(f?.cite).toContain('ORA.16819');
    /* Never "unobserved": that is the state with fast-start failover enabled
       and the master observer missing. */
    expect(f?.message).toContain('That is not the same as being unobserved');
    expect(f?.message).not.toContain('cannot both be true');
  });

  it('warns for observe-only too, which arms nothing either', () => {
    const f = find(baseDoc({ observers: [], fsfo: 'observe-only' }));
    expect(f?.severity).toBe('warning');
    expect(f?.message).toContain('fsfo.state = observe-only');
  });

  it('is only the standing note where the document says disabled', () => {
    const f = find(baseDoc({ observers: [], fsfo: 'disabled' }));
    expect(f?.severity).toBe('info');
    expect(f?.message).not.toContain('fsfo.state');
  });
});

describe('the three conditions of enabling fast-start failover (VAL-04)', () => {
  it('FSFO.MULTI_TARGET_EXPLICIT is info while disabled, error while enabled', () => {
    const enabledDoc = twoStandbyDoc({ targets: [] });
    const enabled = validate(enabledDoc).find((f) => f.id === 'FSFO.MULTI_TARGET_EXPLICIT');
    const disabledDoc = twoStandbyDoc({ targets: [] });
    disabledDoc.config.fsfo.state = 'disabled';
    const disabled = validate(disabledDoc).find((f) => f.id === 'FSFO.MULTI_TARGET_EXPLICIT');
    expect(enabled?.severity).toBe('error');
    expect(disabled?.severity).toBe('info');
    expect(disabled?.message).toContain('enabling it would require');
  });

  it('FSFO.LOGICAL_MAXPROT is info while disabled, error while enabled', () => {
    const base = { mode: 'MAXPROTECTION' as const, secondRole: 'logical' as const, targets: [M('sby02')] };
    const enabled = validate(twoStandbyDoc(base)).find((f) => f.id === 'FSFO.LOGICAL_MAXPROT');
    const disabledDoc = twoStandbyDoc(base);
    disabledDoc.config.fsfo.state = 'disabled';
    const disabled = validate(disabledDoc).find((f) => f.id === 'FSFO.LOGICAL_MAXPROT');
    expect(enabled?.severity).toBe('error');
    expect(disabled?.severity).toBe('info');
    expect(disabled?.message).toContain('Enabling it would fail');
  });

  it('FSFO.TARGET_DIRECT_REDO is info while disabled, error while enabled', () => {
    /* cascadeDoc has no fsfo option; the paired CASES entry above already
       checks the enabled (default) severity, so this checks the disabled
       branch directly against the rule. */
    const enabled = validate(cascadeDoc({ targets: [M('term1')] }))
      .find((f) => f.id === 'FSFO.TARGET_DIRECT_REDO');
    const doc = cascadeDoc({ targets: [M('term1')] });
    doc.config.fsfo.state = 'disabled';
    const disabled = validate(doc).find((f) => f.id === 'FSFO.TARGET_DIRECT_REDO');
    expect(enabled?.severity).toBe('error');
    expect(disabled?.severity).toBe('info');
    expect(disabled?.message).toContain('Enabling fast-start failover would require');
  });
});

describe('a far sync instance that is not in the redo path', () => {
  it('does not drag the mode gate in', () => {
    const d = baseDoc({
      extra: [farSync('fs1', 'dc3-obs01')],
      mode: 'MAXPERFORMANCE',
    });
    cutLink(d, 'dc1-dc3');
    expect(idsFor(d)).not.toContain('FSFO.FARSYNC_MODE_19C');
  });
});

describe('RedoRoutes rules, read the way Oracle writes them', () => {
  const find = (doc: TopologyDoc, id: string): Finding | undefined => validate(doc).find((f) => f.id === id);

  it('SOURCE_UNIQUE counts LOCAL as naming the local database', () => {
    const f = find(withRoutes(baseDoc(), 'prm01', [
      rule('LOCAL', [{ target: M('sby01'), xpt: 'SYNC' }]),
      rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }]),
    ]), 'ROUTES.SOURCE_UNIQUE');
    expect(f?.message).toContain('LOCAL is prm01 itself');
    expect(f?.cite).toEqual(['ROUTES.SOURCE_ONCE']);
  });

  it('SNAPSHOT_FORBIDDEN: a snapshot standby may receive redo, and may carry a LOCAL rule', () => {
    const d = baseDoc({ fsfo: 'disabled' });
    dbOf(d, 'sby01').role = 'snapshot';
    dbOf(d, 'sby01').redoRoutes = [rule('LOCAL', [{ target: M('prm01') }])];
    expect(find(d, 'ROUTES.SNAPSHOT_FORBIDDEN')).toBeUndefined();
  });

  it('LOGICAL_LOCAL_ONLY is plain documentation about the source field', () => {
    const d = twoStandbyDoc({ secondRole: 'logical', targets: [M('sby01')] });
    dbOf(d, 'sby02').redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
    const f = find(d, 'ROUTES.LOGICAL_LOCAL_ONLY');
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toContain('redo source field');
    expect(f?.note).toBeUndefined();
  });

  it('ALT_NEEDS_MAXFAILURE rests on 12.1 and names the MaxFailure property of the non-alternate member', () => {
    const d = withRoutes(twoStandbyDoc(), 'prm01', altRoutes());
    const f = find(d, 'ROUTES.ALT_NEEDS_MAXFAILURE');
    expect(f?.basis).toBe('inferred');
    expect(f?.note).toMatch(/12\.1/);
    expect(f?.message).toContain("EDIT DATABASE 'sby01' SET PROPERTY 'MaxFailure' = 1;");
    expect(f?.message).not.toContain('LOG_ARCHIVE_DEST_n');
    expect(f?.fix?.patch).toEqual([{ op: 'replace', path: '/members/0/dests/sby01/maxFailure', value: 1 }]);
  });

  it('GROUP_NEEDS_MAXFAILURE stays quiet on an untouched group: MaxFailure defaults to 1 there', () => {
    const d = twoStandbyDoc();
    d.config.edition = '26ai';
    const prm = memberOf(d, 'prm01');
    prm.redoRoutes = priorityRoutes();
    prm.dests = {};
    expect(find(d, 'ROUTES.GROUP_NEEDS_MAXFAILURE')).toBeUndefined();
    /* Set to 0 by hand, it fires -- documented under 26ai. */
    prm.dests[M('sby02')] = { netTimeoutSeconds: 30, reopenSeconds: 300, maxFailure: 0 };
    const f = find(d, 'ROUTES.GROUP_NEEDS_MAXFAILURE');
    expect(f?.basis).toBe('documented');
    expect(f?.cite).toContain('ROUTES.MAXFAILURE_GROUP_DEFAULT');
  });

  it('ALT_12_1_ONLY applies under 19c as under 26ai, and offers the PRIORITY spelling', () => {
    for (const edition of ['19c', '26ai'] as const) {
      const d = withRoutes(twoStandbyDoc(), 'prm01', altRoutes());
      d.config.edition = edition;
      const f = find(d, 'ROUTES.ALT_12_1_ONLY');
      expect(f?.severity, edition).toBe('warning');
      expect(f?.basis, edition).toBe('documented');
      expect(f?.message, edition).toContain('(LOCAL : (sby01 SYNC PRIORITY=1, sby02 ASYNC PRIORITY=2))');
    }
  });
});
