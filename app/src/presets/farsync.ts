/**
 * The three far sync presets: Examples 5-2, 5-4 and 5-5 of the 19c Concepts
 * and Administration chapter on far sync instances, in document form.
 *
 * All three keep Oracle's names (North_Sales, South_Sales, FS1, FS2) so the
 * generated DGMGRL reads next to the manual's.
 */

import {
  database, dest, farSync, group, host, hostDown, local, localGroups, observer, prio,
  switchoverTo, to, topology, when,
} from './build';
import type { Preset } from './types';
import type { TopologyDoc } from '../engine';

/* Example 5-2: SYNC to a far sync beside the primary, ASYNC onward over the
   distance, and a direct destination to the standby for when the far sync
   dies -- GROUP=1 PRIORITY=1 and PRIORITY=2 there, one parenthesised
   RedoRoutes group here: (LOCAL : (FS1 SYNC PRIORITY=1, South_Sales ASYNC
   PRIORITY=2)). */
function zeroLossDoc(): TopologyDoc {
  /* Both directions are declared, as Oracle's Scenario 5 does: "configure redo
     transport for the current standby database South_Sales so that when it is
     in the primary role it sends redo data to the far sync instance FS1" --
     South_Sales (LOCAL : FS1 SYNC), and FS1 holds a second rule for
     South_Sales as the redo source. Without it, SHOW CONFIGURATION WHEN
     PRIMARY IS South_Sales puts North_Sales under Members Not Receiving Redo.
     North_Sales keeps SYNC as its LogXptMode: the fast-start failover
     prerequisites ask it of the primary as of the target. */
  const north = database('North_Sales', ['dc1-north'], 'primary', {
    redoRoutes: [localGroups(group(
      prio(1, to('FS1', 'SYNC')), prio(2, to('South_Sales', 'ASYNC')),
    ))],
    logXptMode: 'SYNC',
  });
  const fs1 = farSync('FS1', 'dc1-fs1', {
    redoRoutes: [
      when('North_Sales', to('South_Sales', 'ASYNC')),
      when('South_Sales', to('North_Sales', 'ASYNC')),
    ],
  });
  const south = database('South_Sales', ['dc2-south'], 'physical', {
    logXptMode: 'ASYNC',
    redoRoutes: [local(to('FS1', 'SYNC'))],
  });
  /* Inside a RedoRoutes group MaxFailure is 1 unless set, and a member at 0
     "cannot be part of a RedoRoutes group": South_Sales is left at that
     default rather than written down as 0. */
  dest(north, fs1.id, { maxFailure: 1 });
  dest(fs1, south.id);
  /* One MaxFailure per receiving member: FS1 is in the primary's group, so the
     broker default for it is 1 whichever way redo reaches it. */
  dest(south, fs1.id, { maxFailure: 1 });
  dest(fs1, north.id);
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
  short: 'Far sync, zero loss',
  group: 'Far sync',
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
    + 'The primary declares both paths in one parenthesised RedoRoutes group, FS1 at PRIORITY=1 '
    + 'and the standby itself at PRIORITY=2: there is one active redo path for each group, and '
    + 'it is the usable destination with the lower number. The default event kills the far sync '
    + 'host, and the primary ships straight to the standby, which is what the manual prescribes '
    + '-- "This does reduce the protection level because redo transmission is then in ASYNC '
    + 'mode", so maximum availability, without acknowledgement from at least one synchronized '
    + 'standby, operates as if it were in maximum performance mode. When FS1 is back, the '
    + 'primary ships to it again, because priority 1 is higher than priority 2. Both directions '
    + 'are declared, as Oracle\'s Scenario 5 does: "configure redo transport for the current standby '
    + 'database South_Sales so that when it is in the primary role it sends redo data to the far '
    + 'sync instance FS1" -- South_Sales ships SYNC to FS1, and FS1, whose RedoRoutes holds a '
    + 'second rule with South_Sales as the redo source, forwards ASYNC to North_Sales. Without '
    + 'that route SHOW CONFIGURATION WHEN PRIMARY IS South_Sales lists North_Sales under Members '
    + 'Not Receiving Redo. FS1 stands at the North_Sales site, so after a role change the SYNC hop '
    + 'is the long one; the "second far sync near the standby" preset is the one that puts a far '
    + 'sync instance beside each side. With a far sync instance in the path, '
    + 'enabling fast-start failover also needs FastStartFailoverTarget set on both the primary '
    + 'and the target standby first. Two things here '
    + "are this page's model rather than documentation: how SYNCHRONIZED is computed across the "
    + 'far sync hop, and the instant the primary moves from one destination to the other.',
  cite: [
    'FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC', 'FS.NO_DATAFILES', 'FS.DIRECT_LINK_REQUIRED',
    'FSFO.TARGET_KIND', 'FSFO.TARGET_DIRECT_REDO', 'FSFO.FARSYNC_XPT', 'FSFO.FARSYNC_MODES_19C',
    'FSFO.FARSYNC_MODES_26AI',
    'FS.FAILURE_ADD_DEST', 'ROUTES.ONE_PATH_PER_GROUP', 'ROUTES.PRIORITY_EX1',
    'ROUTES.PRIORITY_26AI', 'ROUTES.MAXFAILURE_GROUP_DEFAULT', 'MAXAVAIL.AT_LEAST_ONE',
    'FSFO.TASK3_PRIMARY_XPT_19C', 'FS.ROUTES_BOTH_DIRECTIONS', 'FSFO.FARSYNC_TARGET_SCENARIO7',
    'FS.SCENARIO5_SOUTH_ROUTE',
  ],
  doc: zeroLossDoc,
  events: () => [hostDown(0, 'dc1-fs1')],
};

/* Example 5-4: two far sync instances in front of the same standby at the
   same priority, and the standby itself behind them, all in one group:
   (LOCAL : (FS1 SYNC PRIORITY=1, FS2 SYNC PRIORITY=1, South_Sales ASYNC
   PRIORITY=2)). Losing one far sync keeps the configuration zero data loss. */
function haPairDoc(): TopologyDoc {
  /* As in Example 5-2 both directions are declared (Scenario 5): South_Sales
     ships to FS1 when it is the primary and FS1 forwards ASYNC to
     North_Sales. FS2 is the second path of the North_Sales -> South_Sales
     direction only; no example declares a high-availability pair for the
     reverse one, so none is drawn. */
  const north = database('North_Sales', ['dc1-north'], 'primary', {
    redoRoutes: [localGroups(group(
      prio(1, to('FS1', 'SYNC')), prio(1, to('FS2', 'SYNC')), prio(2, to('South_Sales', 'ASYNC')),
    ))],
    logXptMode: 'SYNC',
  });
  const fs1 = farSync('FS1', 'dc1-fs1', {
    redoRoutes: [
      when('North_Sales', to('South_Sales', 'ASYNC')),
      when('South_Sales', to('North_Sales', 'ASYNC')),
    ],
  });
  const fs2 = farSync('FS2', 'dc1-fs2', {
    redoRoutes: [when('North_Sales', to('South_Sales', 'ASYNC'))],
  });
  const south = database('South_Sales', ['dc2-south'], 'physical', {
    logXptMode: 'ASYNC',
    redoRoutes: [local(to('FS1', 'SYNC'))],
  });
  /* "A member whose MaxFailure property is set to zero cannot be part of a
     RedoRoutes group", so every member of the group carries a non-zero one
     -- South_Sales the broker default inside a group, which is 1. */
  dest(north, fs1.id, { maxFailure: 1 });
  dest(north, fs2.id, { maxFailure: 1 });
  dest(fs1, south.id);
  dest(fs2, south.id);
  dest(south, fs1.id, { maxFailure: 1 });
  dest(fs1, north.id);
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
  short: 'Far sync HA pair',
  group: 'Far sync',
  source: '19c C&A chapter 5, Example 5-4',
  summary:
    'One far sync instance in the redo path is a single point of failure for zero data loss: '
    + 'lose it and the documented remedy is an additional destination straight to the terminal '
    + 'standby, which "does reduce the protection level because redo transmission is then in '
    + 'ASYNC mode". A second far sync instance is the other answer, and the manual combines '
    + "the two: the primary's RedoRoutes holds one parenthesised group with both far sync "
    + 'instances at PRIORITY=1 and the standby at PRIORITY=2 -- PRIORITY=n, n = 1 to 8, belongs '
    + 'to each destination, lower wins, default 1 for a far sync destination and 8 otherwise. '
    + 'There is one active redo path for each group, so the primary ships to one far sync '
    + 'instance at a time; the two "have the same priority and when one takes over for the '
    + 'other it remains the active far sync instance until it fails". Every member of the '
    + 'group carries a non-zero MaxFailure, because "A member whose MaxFailure property is set '
    + 'to zero cannot be part of a RedoRoutes group" (inside a group it defaults to 1). The '
    + 'default event kills the first far sync host, and redo moves to the second one, still '
    + 'SYNC, so committed redo still reaches disk at a far sync instance instead of dropping to '
    + 'the direct ASYNC destination, which takes over only if both far sync instances are '
    + 'lost. The pair protects the North_Sales to South_Sales direction; the other is declared as '
    + 'Oracle\'s Scenario 5 declares it, through one far sync instance: South_Sales ships SYNC to '
    + 'FS1 when it is the primary, and FS1 forwards ASYNC to North_Sales, so a role change reaches '
    + 'a far sync instance instead of leaving North_Sales under Members Not Receiving Redo. No '
    + 'example makes that reverse path a pair too -- the "second far sync near the standby" preset '
    + 'is the one that puts a far sync instance beside each side. What SYNCHRONIZED means for the terminal '
    + "standby across the far sync hop stays this page's model, and so does the instant the "
    + 'primary moves from one destination to the next.',
  cite: [
    'FS.HA_PAIR_SAME_PRIORITY', 'ROUTES.PRIORITY_26AI', 'ROUTES.ONE_PATH_PER_GROUP', 'ROUTES.PRIORITY_EX2_STICKY',
    'ROUTES.PRIORITY_EX1', 'ROUTES.GROUP_MAXFAILURE_ZERO', 'ROUTES.MAXFAILURE_GROUP_DEFAULT',
    'ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX', 'FS.SYNC_TO_FARSYNC', 'FS.ONWARD_ASYNC',
    'FS.FAILURE_ADD_DEST', 'FSFO.FARSYNC_XPT', 'FSFO.TASK3_PRIMARY_XPT_19C',
    'FS.ROUTES_BOTH_DIRECTIONS', 'FS.SCENARIO5_SOUTH_ROUTE',
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
  short: 'Far sync for the role change',
  group: 'Far sync',
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
