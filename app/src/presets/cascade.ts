/**
 * Cascading redo and priority groups: Examples 4-2 and 4-3 of the 19c broker
 * chapter on managing configuration members.
 */

import {
  database, dest, group, host, hostDown, local, localGroups, observer, prio, to, topology, when,
} from './build';
import type { Preset } from './types';
import type { TopologyDoc } from '../engine';

/* Example 4-2: (LOCAL : Local_Sales SYNC) on the primary and
   (North_Sales : Remote_Sales ASYNC) on the cascading standby. */
function cascadeDoc(): TopologyDoc {
  const north = database('North_Sales', ['dc1-north'], 'primary', {
    redoRoutes: [local(to('Local_Sales', 'SYNC'))],
  });
  const localSby = database('Local_Sales', ['dc2-local'], 'physical', {
    logXptMode: 'SYNC',
    redoRoutes: [when('North_Sales', to('Remote_Sales', 'ASYNC'))],
  });
  const remote = database('Remote_Sales', ['dc3-remote'], 'physical', {
    logXptMode: 'ASYNC',
    applyLagSeconds: 20,
  });
  dest(north, localSby.id);
  dest(localSby, remote.id);
  return topology({
    name: 'cascade_terminal',
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [
      host('dc1-north', 'dc1'), host('dc2-local', 'dc2'),
      host('dc3-remote', 'dc3'), host('dc4-obs01', 'dc4'),
    ],
    links: [
      ['dc1', 'dc2', 2], ['dc1', 'dc3', 60], ['dc1', 'dc4', 5],
      ['dc2', 'dc3', 60], ['dc2', 'dc4', 5], ['dc3', 'dc4', 60],
    ],
    members: [north, localSby, remote],
    observers: [observer('obs01', 'dc4-obs01')],
    targets: ['Local_Sales'],
    events: [hostDown(0, 'dc1-north')],
  });
}

export const cascadeTerminal: Preset = {
  id: 'cascade-terminal',
  title: 'Cascading to a remote terminal standby',
  short: 'Cascade to a terminal standby',
  group: 'Cascading & bystanders',
  source: '19c broker chapter 4, Example 4-2',
  summary:
    'The primary ships SYNC to a standby one metro hop away, and that standby forwards to a '
    + 'terminal standby further out: a terminal destination "receives primary database redo '
    + 'indirectly from a standby database", which takes the second shipment off the primary '
    + 'altogether. The documented restrictions: only physical standby databases can cascade '
    + 'redo, real-time cascading requires a licence for Active Data Guard, and non-real-time '
    + 'cascading is supported on destinations 1 through 10 only. Two more documented facts: '
    + 'real-time cascading needs the ASYNC attribute spelled out on the cascaded destination '
    + '("The ASYNC redo transport attribute must be explicitly specified for a cascaded '
    + 'destination to enable real-time cascading to that destination"), and one cascading '
    + 'standby feeds up to 30 terminal destinations. The terminal standby cannot be the '
    + 'fast-start failover target: '
    + 'the prerequisite is that the target "must receive redo directly from the primary '
    + 'database", and a terminal standby by definition does not -- a deduction from two '
    + 'documented sentences rather than a literal prohibition, which is why the engine labels '
    + 'it inferred. A manual FAILOVER to it is documented and legal, with the documented '
    + 'warning that "no attempt is made to transmit any unsent redo from the cascader to the '
    + 'terminal standby". The default event kills the primary at t = 0, and the failover goes '
    + 'to the cascading standby, the one member that does receive redo directly. Watch what '
    + 'happens to the terminal standby afterwards: the forwarding rule names the old primary '
    + 'as its redo source, and a rule is active only while its source field names the current '
    + 'primary, so the cascade stops. Nothing rewrites on a role change -- routes for the '
    + 'other direction have to be pre-declared, exactly as the far sync examples pre-declare '
    + 'theirs.',
  cite: [
    'CASCADE.TERMINAL_INDIRECT', 'CASCADE.PHYSICAL_ONLY', 'ROUTES.CASCADE_ASYNC_EXPLICIT',
    'CASCADE.THIRTY_TERMINAL', 'FSFO.TARGET_DIRECT_REDO', 'CASCADE.MANUAL_FAILOVER_UNSENT',
    'CASCADE.EXAMPLE_4_2', 'FSFO.THRESHOLD', 'ROUTES.RULE_ACTIVE',
    'FS.ROUTES_BOTH_DIRECTIONS',
  ],
  doc: cascadeDoc,
  events: () => [hostDown(0, 'dc1-north')],
};

/* Example 4-3: one group, a PRIORITY per destination -- (LOCAL : (
   Local_Sales ASYNC PRIORITY=1, Remote_Sales ASYNC PRIORITY=2 )) there -- and
   the stood-down destination that VERBOSE marks "(alternate of Local_Sales)". */
function priorityDoc(): TopologyDoc {
  const north = database('North_Sales', ['dc1-north'], 'primary', {
    redoRoutes: [localGroups(group(
      prio(1, to('Local_Sales', 'SYNC')),
      prio(2, to('Alternate_Sales', 'SYNC')),
    ))],
  });
  const localSby = database('Local_Sales', ['dc2-local'], 'physical', { logXptMode: 'SYNC' });
  const altSby = database('Alternate_Sales', ['dc3-alt'], 'physical', {
    logXptMode: 'SYNC', applyLagSeconds: 5,
  });
  dest(north, localSby.id, { maxFailure: 1 });
  dest(north, altSby.id, { maxFailure: 1 });
  return topology({
    name: 'priority_alternates',
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [
      host('dc1-north', 'dc1'), host('dc2-local', 'dc2'),
      host('dc3-alt', 'dc3'), host('dc4-obs01', 'dc4'),
    ],
    links: [
      ['dc1', 'dc2', 2], ['dc1', 'dc3', 10], ['dc1', 'dc4', 5],
      ['dc2', 'dc3', 10], ['dc2', 'dc4', 5], ['dc3', 'dc4', 10],
    ],
    members: [north, localSby, altSby],
    observers: [observer('obs01', 'dc4-obs01')],
    targets: ['Local_Sales'],
    events: [hostDown(0, 'dc2-local')],
  });
}

export const priorityAlternates: Preset = {
  id: 'priority-alternates',
  title: 'PRIORITY groups and the stood-down destination',
  short: 'PRIORITY alternates',
  group: 'Cascading & bystanders',
  source: '19c broker chapter 4, Example 4-3',
  summary:
    'Two destinations, one at a time. The primary declares both in one parenthesised '
    + 'destination group, each with its own PRIORITY=n, n = 1 to 8, lower number first; there is '
    + 'one active redo path for each group, so the broker ships to the usable destination with '
    + 'the lowest number, and returns to it once it is back. VERBOSE output marks the '
    + 'destination that is standing by as "(alternate of Local_Sales)". Two spelling traps live '
    + 'here: GROUP is a LOG_ARCHIVE_DEST_n attribute and never RedoRoutes syntax, and a member '
    + 'whose MaxFailure property is zero cannot be part of a RedoRoutes group -- inside a group '
    + 'it defaults to 1, which both destinations carry. Since '
    + 'there is more than one standby, FastStartFailoverTarget has to be set explicitly -- and '
    + 'here it names only the destination that is actually receiving redo. The stood-down one '
    + 'receives nothing while it stands by, and the prerequisite for a fast-start '
    + 'failover target is that it "must receive redo directly from the primary database", so '
    + 'naming it as a candidate would fail that check; where a configuration really does want '
    + 'two candidates, the broker "selects a target based on the order in which they are '
    + 'specified" -- the order, never the first viable one in the list. The default event '
    + 'kills the first destination host at t = 0. The primary keeps running and the PRIORITY=2 '
    + 'destination takes the redo, still SYNC, so the configuration keeps an acknowledgement '
    + 'from a synchronized standby and maximum availability does not fall back to behaving '
    + 'like maximum performance mode. Documented too: if the designated fast-start failover '
    + 'target develops a problem the broker changes the target to one of the other candidate '
    + 'targets. Which destination ships is documented; the instant the primary moves to the '
    + "other one, and the instant the target moves, are this page's model.",
  cite: [
    'ROUTES.PRIORITY_19C_EX_4_3', 'ROUTES.PRIORITY_26AI', 'ROUTES.ONE_PATH_PER_GROUP',
    'ROUTES.PRIORITY_EX1', 'DGMGRL.VERBOSE_ALTERNATE',
    'ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX', 'ROUTES.GROUP_MAXFAILURE_ZERO',
    'ROUTES.MAXFAILURE_GROUP_DEFAULT',
    'FSFO.TARGET_MUST_BE_EXPLICIT', 'FSFO.TARGET_ORDER', 'FSFO.TARGET_AUTO_CHANGE',
    'FSFO.TARGET_DIRECT_REDO',
    'MAXAVAIL.AT_LEAST_ONE',
  ],
  doc: priorityDoc,
  events: () => [hostDown(0, 'dc2-local')],
};
