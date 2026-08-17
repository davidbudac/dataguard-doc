/**
 * Presets with more than two members or more than one observer: multi-target
 * fast-start failover, a RAC primary, snapshot and logical bystanders, and
 * maximum protection with two synchronous standbys.
 */

import {
  database, dest, host, hostDown, instanceDown, local, observer, siteDown, to, topology,
} from './build';
import type { Preset } from './types';
import type { TopologyDoc } from '../engine';

/* Two candidate targets and three observers -- the 19c maximum. */
function multiTargetDoc(): TopologyDoc {
  const prm = database('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [local(to('sby01', 'SYNC'), to('sby02', 'SYNC'))],
  });
  const sby01 = database('sby01', ['dc2-sby01'], 'physical', {
    logXptMode: 'SYNC', applyLagSeconds: 5,
  });
  const sby02 = database('sby02', ['dc3-sby02'], 'physical', {
    logXptMode: 'SYNC', applyLagSeconds: 10,
  });
  dest(prm, sby01.id);
  dest(prm, sby02.id);
  return topology({
    name: 'multi_target',
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [
      host('dc1-prm01', 'dc1'), host('dc2-sby01', 'dc2'), host('dc3-sby02', 'dc3'),
      host('dc4-obs01', 'dc4'), host('dc2-obs02', 'dc2'), host('dc3-obs03', 'dc3'),
    ],
    links: [
      ['dc1', 'dc2', 10], ['dc1', 'dc3', 10], ['dc1', 'dc4', 10],
      ['dc2', 'dc3', 10], ['dc2', 'dc4', 10], ['dc3', 'dc4', 10],
    ],
    members: [prm, sby01, sby02],
    observers: [
      observer('obs01', 'dc4-obs01', 'master'),
      observer('obs02', 'dc2-obs02', 'backup'),
      observer('obs03', 'dc3-obs03', 'backup'),
    ],
    targets: ['sby01', 'sby02'],
    events: [siteDown(0, 'dc2'), hostDown(0, 'dc1-prm01')],
  });
}

export const multiTargetThreeObservers: Preset = {
  id: 'multi-target-three-observers',
  title: 'Two candidate targets, three observers',
  short: 'Two targets, three observers',
  group: 'Multiple targets',
  source: '19c broker chapter 5, multiple fast-start failover targets (12.2+)',
  summary:
    'Fast-start failover with more than one candidate target, which arrived in 12.2. With more '
    + 'than one standby in the configuration FastStartFailoverTarget must be set explicitly, '
    + 'and it names the candidates in order: "The broker selects a target based on the order '
    + 'in which they are specified", and "If the designated fast-start failover target develops '
    + 'a problem ... the broker automatically changes the fast-start failover target to one of '
    + 'the other candidate targets". Targets are verified when fast-start failover is enabled. '
    + 'Three observers are registered, the 19c maximum -- one master, the others backups, and '
    + 'only the master observer can coordinate fast-start failover; if the primary and target '
    + 'standby stay connected but the connection to the master observer is lost, the broker '
    + 'tries to nominate a backup observer as the new master, a documented attempt under that '
    + 'precondition rather than a guarantee. The default event takes the whole second data '
    + "centre down and the primary's host with it: the first candidate is gone, so the "
    + 'promotion goes to the second one. Walking the list in order and skipping a candidate '
    + "that cannot be reached is this page's model, not a documented algorithm -- never read "
    + 'it as "the first viable one in the list". The 19c count of three observers is '
    + '19c-specific and is not carried across editions.',
  cite: [
    'FSFO.MULTI_TARGET_12_2', 'FSFO.TARGET_MUST_BE_EXPLICIT', 'FSFO.TARGET_ORDER',
    'FSFO.TARGET_AUTO_CHANGE', 'FSFO.TARGET_VERIFIED_ON_ENABLE', 'OBS.THREE_19C',
    'OBS.MASTER_ONLY_COORDINATES', 'OBS.NOMINATION_PRECONDITION', 'FSFO.THRESHOLD',
    'FSFO.BOTH_MUST_HAVE_LOST', 'OBS.PLACEMENT_NEVER_ON_DB_HOST',
  ],
  doc: multiTargetDoc,
  events: () => [siteDown(0, 'dc2'), hostDown(0, 'dc1-prm01')],
};

/* A two-instance RAC primary. */
function racDoc(): TopologyDoc {
  const prm = database('prm01', ['dc1-node1', 'dc1-node2'], 'primary', {
    redoRoutes: [local(to('sby01', 'SYNC'))],
  });
  const sby = database('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
  dest(prm, sby.id);
  return topology({
    name: 'rac_primary',
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [
      host('dc1-node1', 'dc1', { cluster: 'rac1' }),
      host('dc1-node2', 'dc1', { cluster: 'rac1' }),
      host('dc2-sby01', 'dc2'), host('dc3-obs01', 'dc3'),
    ],
    links: [['dc1', 'dc2', 5], ['dc1', 'dc3', 5], ['dc2', 'dc3', 5]],
    members: [prm, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: ['sby01'],
    events: [instanceDown(0, 'prm01', 'prm011')],
  });
}

export const racPrimary: Preset = {
  id: 'rac-primary',
  title: 'A RAC primary losing one instance',
  short: 'RAC primary',
  group: 'RAC',
  summary:
    'The primary is a two-instance cluster; the observer, as always, runs on a host of its own, '
    + 'because it "should never be deployed at the primary database server or cluster, or on '
    + 'the standby database server or cluster". The default event stops one instance at t = 0. '
    + 'Nothing else happens: the observer and the target standby both still reach the surviving '
    + 'instance, and fast-start failover needs both of them to have lost the primary for '
    + 'FastStartFailoverThreshold before it initiates anything, so no clock ever starts. Two '
    + "modelling notes belong to this preset rather than to Oracle: the engine treats a member "
    + 'as reachable while any one of its instance hosts is up -- degraded, not down -- and '
    + 'instance-level LGWR and NSS ownership is out of scope, so which instance was shipping '
    + 'redo makes no difference here. Kill the second instance too and the configuration '
    + 'becomes the ordinary primary crash.',
  cite: [
    'OBS.PLACEMENT_NEVER_ON_DB_HOST', 'FSFO.BOTH_MUST_HAVE_LOST', 'FSFO.THRESHOLD',
    'FSFO.OBSERVER_OVERRIDE_FALSE',
  ],
  doc: racDoc,
  events: () => [instanceDown(0, 'prm01', 'prm011')],
};

/* A physical target with a logical and a snapshot standby as bystanders. */
function bystanderDoc(): TopologyDoc {
  const prm = database('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [local(to('sby01', 'SYNC'), to('lsby01', 'ASYNC'), to('snp01', 'ASYNC'))],
  });
  const sby = database('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
  const lsby = database('lsby01', ['dc3-lsby01'], 'logical', {
    logXptMode: 'ASYNC', applyLagSeconds: 20,
  });
  const snap = database('snp01', ['dc3-snp01'], 'snapshot', { logXptMode: 'ASYNC' });
  dest(prm, sby.id);
  dest(prm, lsby.id);
  dest(prm, snap.id);
  return topology({
    name: 'bystanders',
    /* 26ai, because the bystanders take ASYNC while the configuration is in
       maximum availability mode: broker Table 4-2 lists SYNC or FASTSYNC for
       that mode, and the 26ai prerequisites add ASYNC to the list. */
    edition: '26ai',
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [
      host('dc1-prm01', 'dc1'), host('dc2-sby01', 'dc2'),
      host('dc3-lsby01', 'dc3'), host('dc3-snp01', 'dc3'), host('dc4-obs01', 'dc4'),
    ],
    links: [
      ['dc1', 'dc2', 5], ['dc1', 'dc3', 20], ['dc1', 'dc4', 5],
      ['dc2', 'dc3', 20], ['dc2', 'dc4', 5], ['dc3', 'dc4', 20],
    ],
    members: [prm, sby, lsby, snap],
    observers: [observer('obs01', 'dc4-obs01')],
    targets: ['sby01'],
    events: [hostDown(0, 'dc1-prm01')],
  });
}

export const bystanders: Preset = {
  id: 'bystanders',
  title: 'Snapshot and logical standbys as bystanders',
  short: 'Snapshot & logical bystanders',
  group: 'Cascading & bystanders',
  summary:
    'One physical standby is the fast-start failover target; a logical standby and a snapshot '
    + 'standby sit beside it as bystanders. FastStartFailoverTarget "can only be set to the '
    + 'name of physical or logical standbys. It cannot be set to the name of a snapshot standby '
    + 'database, far sync instance, or Zero Data Loss Recovery Appliance", so the logical '
    + 'standby here could be a candidate and the snapshot standby could not. RedoRoutes cannot '
    + 'be set on a snapshot standby at all, and on a logical standby the page allows only a '
    + 'LOCAL destination while contradicting itself elsewhere, so the engine reports that one '
    + 'as a conflict rather than picking a side. Maximum protection mode has its own bans: it '
    + 'cannot be used when the only standby is a snapshot standby, and logical standbys are '
    + 'not supported in it for fast-start failover. The two bystanders take ASYNC while the '
    + 'configuration is in maximum availability mode, which is why the preset is drawn under '
    + '26ai: broker Table 4-2 gives SYNC or FASTSYNC for that mode and the 26ai fast-start '
    + 'failover prerequisites add ASYNC, so the same document is a mode conflict under 19c and '
    + 'an allowance under 26ai. The default event kills the primary at '
    + 't = 0, the target is promoted, and the bystanders follow, because '
    + 'BystandersFollowRoleChange defaults to ALL and their viability is checked on a complete '
    + 'failover. How the observer treats members that are not the target is not documented -- '
    + 'it is documented as pinging the primary and the target standby -- so anything this page '
    + 'draws for the bystanders during the failover is its model. One inference shows up in '
    + "the redo graph afterwards: the new primary's RedoRoutes property is NULL, which is "
    + '(LOCAL : ALL) at a primary, and the engine reads ALL as every other enabled member '
    + 'except snapshot standbys -- a deduction from the grammar, not a sentence of its own, '
    + 'so the snapshot standby ends the run with nothing feeding it.',
  cite: [
    'FSFO.TARGET_KIND', 'ROUTES.SNAPSHOT_FORBIDDEN', 'ROUTES.LOGICAL_LOCAL_ONLY',
    'MODE.MAXPROT_SNAPSHOT_ONLY', 'FSFO.LOGICAL_MAXPROT', 'BYSTANDERS.DEFAULT_ALL',
    'FSFO.THRESHOLD', 'FSFO.BOTH_MUST_HAVE_LOST', 'ROUTES.DEFAULT_NULL',
    'XPT.TABLE_4_2', 'XPT.MAXAVAIL_ASYNC_26AI',
  ],
  doc: bystanderDoc,
  events: () => [hostDown(0, 'dc1-prm01')],
};

/* Maximum protection with two SYNC standbys, and both of them dying. */
function maxProtectionDoc(): TopologyDoc {
  const prm = database('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [local(to('sby01', 'SYNC'), to('sby02', 'SYNC'))],
  });
  const sby01 = database('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
  const sby02 = database('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'SYNC' });
  /* NET_TIMEOUT is shortened from its 30 s default to pull the transport clock
     away from the fast-start failover threshold; the minimum is 1 s and 8 to
     10 s is the recommendation. */
  dest(prm, sby01.id, { netTimeoutSeconds: 10 });
  dest(prm, sby02.id, { netTimeoutSeconds: 10 });
  return topology({
    name: 'max_protection',
    mode: 'MAXPROTECTION',
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [
      host('dc1-prm01', 'dc1'), host('dc2-sby01', 'dc2'),
      host('dc3-sby02', 'dc3'), host('dc4-obs01', 'dc4'),
    ],
    links: [
      ['dc1', 'dc2', 5], ['dc1', 'dc3', 5], ['dc1', 'dc4', 5],
      ['dc2', 'dc3', 5], ['dc2', 'dc4', 5], ['dc3', 'dc4', 5],
    ],
    members: [prm, sby01, sby02],
    observers: [observer('obs01', 'dc4-obs01')],
    targets: ['sby01', 'sby02'],
    events: [siteDown(0, 'dc2'), siteDown(60, 'dc3')],
  });
}

export const maxProtection: Preset = {
  id: 'max-protection',
  title: 'Maximum protection with two synchronous standbys',
  short: 'MAXPROTECTION, two SYNC standbys',
  group: 'Protection modes',
  summary:
    'Maximum protection is the mode that "shuts the primary database down rather than allowing '
    + 'it to continue" when it can no longer be certain a standby has the redo, which is '
    + 'exactly why "Oracle recommends that a minimum of two standby databases be used ... to '
    + 'prevent a single standby database failure from causing the primary database to shut '
    + 'down". Both standbys take SYNC, the only transport broker Table 4-2 lists for this mode, '
    + 'and both destinations shorten NET_TIMEOUT from its 30 s default to 10 s -- a transport '
    + 'attribute bounding how long LGWR waits for the acknowledgement, minimum 1 s, 8 to 10 s '
    + 'recommended, and never a failover clock. The default events take the second data centre '
    + 'down at t = 0 and the third at t = 60 s. Through the first the primary keeps committing, '
    + 'because the other standby is still acknowledging; through the second it has nobody left '
    + 'and shuts itself down. "Any one SYNC acknowledgement suffices" is documented in the '
    + 'broker guide\'s wording -- the primary "will shut down, rather than continue processing '
    + 'transactions, if it cannot write its redo stream to at least one synchronized standby '
    + 'database" (broker chapter 4; the Concepts and Administration protection-modes page '
    + 'spells "at least one" out for maximum availability only) -- while one label belongs on '
    + 'the drawing: the instant of the shutdown -- the last acknowledgement plus NET_TIMEOUT -- '
    + 'is this page\'s model. Maximum protection also cannot be used when the only standby is a snapshot '
    + 'standby, or when a far sync instance is the only member receiving redo synchronously '
    + 'from the primary.',
  cite: [
    'MAXPROT.SHUTS_PRIMARY', 'MAXPROT.AT_LEAST_ONE_BROKER', 'MAXPROT.TWO_STANDBYS', 'XPT.TABLE_4_2',
    'DEST.NET_TIMEOUT', 'MAXAVAIL.AT_LEAST_ONE', 'MODE.MAXPROT_SNAPSHOT_ONLY', 'FS.MAXPROT_BROKER_19C',
  ],
  doc: maxProtectionDoc,
  events: () => [siteDown(0, 'dc2'), siteDown(60, 'dc3')],
};
