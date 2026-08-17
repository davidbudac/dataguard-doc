/**
 * The three far sync presets: Examples 5-2, 5-4 and 5-5 of the 19c Concepts
 * and Administration chapter on far sync instances, in document form.
 *
 * All three keep Oracle's names (North_Sales, South_Sales, FS1, FS2) so the
 * generated DGMGRL reads next to the manual's.
 */

import {
  alternate, database, dest, farSync, group, host, hostDown, local, localGroups, observer,
  switchoverTo, to, topology, when,
} from './build';
import type { Preset } from './types';
import type { TopologyDoc } from '../engine';

/* Example 5-2: SYNC to a far sync beside the primary, ASYNC onward over the
   distance, and an alternate direct destination for when the far sync dies. */
function zeroLossDoc(): TopologyDoc {
  const north = database('North_Sales', ['dc1-north'], 'primary', {
    redoRoutes: [local(to('FS1', 'SYNC', alternate('South_Sales', 'ASYNC')))],
  });
  const fs1 = farSync('FS1', 'dc1-fs1', {
    redoRoutes: [when('North_Sales', to('South_Sales', 'ASYNC'))],
  });
  const south = database('South_Sales', ['dc2-south'], 'physical', { logXptMode: 'ASYNC' });
  /* The alternate form needs a non-zero MaxFailure on the non-alternate member. */
  dest(north, fs1.id, { maxFailure: 1 });
  dest(north, south.id);
  dest(fs1, south.id);
  return topology({
    name: 'far_sync_zero_loss',
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [
      host('dc1-north', 'dc1'), host('dc1-fs1', 'dc1'),
      host('dc2-south', 'dc2'), host('dc3-obs01', 'dc3'),
    ],
    links: [['dc1', 'dc2', 40], ['dc1', 'dc3', 20], ['dc2', 'dc3', 20]],
    members: [north, fs1, south],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: ['South_Sales'],
    events: [hostDown(0, 'dc1-fs1')],
  });
}

export const farSyncZeroLoss: Preset = {
  id: 'far-sync-zero-loss',
  title: 'Zero data loss over distance with a far sync instance',
  source: '19c C&A chapter 5, Example 5-2',
  summary:
    'The primary ships SYNC to a far sync instance beside it, so that "all committed redo '
    + 'resides on disk at the far sync instance", and the far sync "uses ASYNC transport to '
    + 'ship the incoming redo to terminal standbys" over the distance: the commit pays the '
    + 'short hop, not the long one. The far sync instance has no user data files, cannot be '
    + 'opened, cannot run redo apply and can never be primary, so the fast-start failover '
    + 'target is the standby -- FastStartFailoverTarget "can only be set to the name of '
    + 'physical or logical standbys" -- and the far sync is the sanctioned exception to the '
    + 'prerequisite that the target "must receive redo directly from the primary database". '
    + 'With a far sync in the path the far sync transport must be SYNC or FASTSYNC and the '
    + "target standby's ASYNC, and under 19c that configuration cannot be in maximum "
    + 'protection or maximum performance mode -- 26ai drops the maximum performance half of '
    + 'that and excludes maximum protection only. A direct network connection between primary '
    + 'and remote standby is still required, for health checks and switchover processing. '
    + 'The default event kills the far sync host: the alternate destination declared on the '
    + 'primary takes over and ships straight to the standby, which is what the manual '
    + 'prescribes -- "This does reduce the protection level because redo transmission is then '
    + 'in ASYNC mode", so maximum availability, without acknowledgement from at least one '
    + 'synchronized standby, operates as if it were in maximum performance mode. Two things '
    + "here are this page's model rather than documentation: how SYNCHRONIZED is computed "
    + 'across the far sync hop, and the instant the broker swaps to the alternate.',
  cite: [
    'FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC', 'FS.NO_DATAFILES', 'FS.DIRECT_LINK_REQUIRED',
    'FSFO.TARGET_KIND', 'FSFO.TARGET_DIRECT_REDO', 'FSFO.FARSYNC_XPT', 'FSFO.FARSYNC_MODES_19C',
    'FSFO.FARSYNC_MODES_26AI',
    'FS.FAILURE_ADD_DEST', 'ROUTES.ALT_MAXFAILURE', 'ROUTES.GRAMMAR_121', 'MAXAVAIL.AT_LEAST_ONE',
  ],
  doc: zeroLossDoc,
  events: () => [hostDown(0, 'dc1-fs1')],
};

/* Example 5-4: two far sync instances in front of the same standby, in
   priority groups, so losing one keeps the configuration zero data loss. */
function haPairDoc(): TopologyDoc {
  const north = database('North_Sales', ['dc1-north'], 'primary', {
    redoRoutes: [localGroups(group(1, to('FS1', 'SYNC')), group(2, to('FS2', 'SYNC')))],
  });
  const fs1 = farSync('FS1', 'dc1-fs1', {
    redoRoutes: [when('North_Sales', to('South_Sales', 'ASYNC'))],
  });
  const fs2 = farSync('FS2', 'dc1-fs2', {
    redoRoutes: [when('North_Sales', to('South_Sales', 'ASYNC'))],
  });
  const south = database('South_Sales', ['dc2-south'], 'physical', { logXptMode: 'ASYNC' });
  /* "A member whose MaxFailure property is set to zero cannot be part of a
     RedoRoutes group", so both far sync instances carry a non-zero one. */
  dest(north, fs1.id, { maxFailure: 1 });
  dest(north, fs2.id, { maxFailure: 1 });
  dest(fs1, south.id);
  dest(fs2, south.id);
  return topology({
    name: 'far_sync_ha_pair',
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [
      host('dc1-north', 'dc1'), host('dc1-fs1', 'dc1'), host('dc1-fs2', 'dc1'),
      host('dc2-south', 'dc2'), host('dc3-obs01', 'dc3'),
    ],
    links: [['dc1', 'dc2', 40], ['dc1', 'dc3', 20], ['dc2', 'dc3', 20]],
    members: [north, fs1, fs2, south],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: ['South_Sales'],
    events: [hostDown(0, 'dc1-fs1')],
  });
}

export const farSyncHaPair: Preset = {
  id: 'far-sync-ha-pair',
  title: 'A high-availability far sync pair',
  source: '19c C&A chapter 5, Example 5-4',
  summary:
    'One far sync instance in the redo path is a single point of failure for zero data loss: '
    + 'lose it and the documented remedy is an additional destination straight to the terminal '
    + 'standby, which "does reduce the protection level because redo transmission is then in '
    + 'ASYNC mode". A second far sync instance is the other answer. Both are declared in the '
    + "primary's RedoRoutes in destination groups -- PRIORITY=n, n = 1 to 8, lower wins, "
    + 'default 1 for far sync members and 8 otherwise -- and each one carries a non-zero '
    + 'MaxFailure, because "A member whose MaxFailure property is set to zero cannot be part '
    + 'of a RedoRoutes group". The default event kills the first far sync host, and redo moves '
    + 'to the second one, still SYNC, so committed redo still reaches disk at a far sync '
    + 'instance instead of dropping to a direct ASYNC destination; what SYNCHRONIZED means for '
    + "the terminal standby across that hop stays this page's model. Which group the broker "
    + "activates when a group "
    + "is only partly up is not documented, so the activation rule here is this page's model: "
    + 'the lowest priority number whose destinations are all up, otherwise the lowest with at '
    + 'least one up.',
  cite: [
    'ROUTES.PRIORITY_26AI', 'ROUTES.PRIORITY_19C_EX_4_3', 'ROUTES.GROUP_MAXFAILURE_ZERO',
    'ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX', 'FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC',
    'FS.FAILURE_ADD_DEST', 'FSFO.FARSYNC_XPT',
  ],
  doc: haPairDoc,
  events: () => [hostDown(0, 'dc1-fs1')],
};

/* Example 5-5: a second far sync near the standby, so the configuration is
   ready for the role change before it happens. */
function roleChangeDoc(): TopologyDoc {
  const north = database('North_Sales', ['dc1-north'], 'primary', {
    redoRoutes: [local(to('FS1', 'SYNC'))],
    logXptMode: 'ASYNC',
  });
  const fs1 = farSync('FS1', 'dc1-fs1', {
    redoRoutes: [when('North_Sales', to('South_Sales', 'ASYNC'))],
  });
  const south = database('South_Sales', ['dc2-south'], 'physical', {
    redoRoutes: [local(to('FS2', 'SYNC'))],
    logXptMode: 'ASYNC',
  });
  const fs2 = farSync('FS2', 'dc2-fs2', {
    redoRoutes: [when('South_Sales', to('North_Sales', 'ASYNC'))],
  });
  dest(north, fs1.id);
  dest(fs1, south.id);
  dest(south, fs2.id);
  dest(fs2, north.id);
  return topology({
    name: 'far_sync_role_change',
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [
      host('dc1-north', 'dc1'), host('dc1-fs1', 'dc1'),
      host('dc2-south', 'dc2'), host('dc2-fs2', 'dc2'),
      host('dc3-obs01', 'dc3'),
    ],
    links: [['dc1', 'dc2', 40], ['dc1', 'dc3', 20], ['dc2', 'dc3', 20]],
    members: [north, fs1, south, fs2],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: ['South_Sales'],
    events: [switchoverTo(0, 'South_Sales')],
  });
}

export const farSyncRoleChange: Preset = {
  id: 'far-sync-role-change',
  title: 'A second far sync near the standby, for the role change',
  source: '19c C&A chapter 5, Example 5-5',
  summary:
    'A far sync instance beside the primary buys zero data loss in one direction only: after a '
    + 'role change the new primary is at the other site, with no far sync of its own. The '
    + 'manual answers with a second far sync instance near the standby and both directions '
    + "declared in advance -- EDIT FAR_SYNC 'FS2' SET PROPERTY 'RedoRoutes' = '(South_Sales : "
    + "North_Sales ASYNC)' alongside EDIT DATABASE 'South_Sales' SET PROPERTY 'RedoRoutes' = "
    + "'(LOCAL : FS2 SYNC)'. Nothing rewrites on a role change: a rule is active when its redo "
    + 'source field names the current primary, so the reverse rules simply sit inactive until '
    + 'they are not. The default event issues SWITCHOVER TO South_Sales at t = 0. A switchover '
    + 'is zero data loss in every protection mode; with fast-start failover enabled the broker '
    + 'permits it only to the pre-specified target standby, and only while that standby is '
    + 'synchronized (maximum availability) or inside FastStartFailoverLagLimit (maximum '
    + 'performance, where past the limit the broker refuses the SWITCHOVER). The former '
    + 'primary is the database that restarts, '
    + 'as the new standby, and sessions on it are terminated as it converts; how long the whole '
    + 'thing takes is environment-dependent, so the bands drawn for it are nominal.',
  cite: [
    'FS.ROUTES_BOTH_DIRECTIONS', 'ROUTES.RULE_ACTIVE', 'SWITCHOVER.ZERO_LOSS',
    'SWITCHOVER.FSFO_GATE', 'SWITCHOVER.FORMER_PRIMARY_RESTARTS', 'SWITCHOVER.SESSIONS_END',
    'FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC', 'DGMGRL.FAR_SYNC_COMMANDS',
  ],
  doc: roleChangeDoc,
  events: () => [switchoverTo(0, 'South_Sales')],
};
