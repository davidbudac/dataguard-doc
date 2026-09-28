/**
 * The two 1 + 1 + 1 presets: the published workbench's configuration, and the
 * same configuration with fast-start failover enabled in observe-only mode.
 */

import { database, dest, host, hostDown, local, observer, to, topology } from './build';
import type { Preset } from './types';
import { memberId } from '../engine';
import type { TopologyDoc } from '../engine';

const HOSTS = [
  host('dc1-prm01', 'dc1'),
  host('dc2-sby01', 'dc2'),
  /* The observer gets a host of its own: Oracle's rule is that it is never
     deployed at the primary or standby database server or cluster. */
  host('dc3-obs01', 'dc3'),
];

const LINKS: [string, string, number][] = [
  ['dc1', 'dc2', 5], ['dc1', 'dc3', 5], ['dc2', 'dc3', 5],
];

function classicDoc(fsfoState: 'enabled' | 'observe-only'): TopologyDoc {
  /* The primary carries the transport it needs as the standby: after a role
     change the new primary ships to it at its own LogXptMode. */
  const prm = database('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [local(to('sby01', 'SYNC'))],
    logXptMode: 'SYNC',
  });
  const sby = database('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'SYNC' });
  dest(prm, sby.id);
  return topology({
    name: 'classic',
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: HOSTS,
    links: LINKS,
    members: [prm, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: ['sby01'],
    fsfo: { state: fsfoState },
    events: [hostDown(0, 'dc1-prm01')],
  });
}

export const classic: Preset = {
  id: 'classic',
  title: 'Primary, standby, observer at a third site',
  short: '1+1+1 with observer',
  group: 'Classic',
  source: '19c HA guide, Optimizing Automatic Failover in Common Scenarios',
  summary:
    'One primary, one physical standby in a second data centre, and one observer on a host of '
    + 'its own in a third -- the placement Oracle puts first, "at a third site or third data '
    + 'center so that the primary, observer, and standby have isolated power, server, storage, '
    + 'and network infrastructure", and never at the primary or standby database server or '
    + 'cluster. The primary ships SYNC, which is what maximum availability mode takes, so the '
    + 'standby is synchronized and the readiness check passes -- broker Table 4-2 lists SYNC '
    + 'and FASTSYNC for maximum availability mode. The primary carries SYNC as its own '
    + 'LogXptMode too, because after a role change it is the standby: the fast-start failover '
    + 'prerequisites "set the LogXptMode database property for both the primary and target '
    + 'standby databases to SYNC or FASTSYNC". The default event kills the '
    + "primary's host at t = 0: the observer and the target standby both lose the primary, and "
    + 'with ObserverOverride at its default FALSE a fast-start failover needs both of them to '
    + 'have lost it, so the observer initiates one FastStartFailoverThreshold (default 30 s) '
    + 'later. What follows -- terminal recovery, the role change and the open -- is '
    + 'environment-dependent, not parameter-driven, and the bands drawn for it are nominal.',
  cite: [
    'OBS.PLACEMENT_THIRD_SITE', 'OBS.PLACEMENT_NEVER_ON_DB_HOST', 'XPT.TABLE_4_2',
    'FSFO.TASK3_PRIMARY_XPT_19C',
    'MAXAVAIL.AT_LEAST_ONE', 'FSFO.THRESHOLD', 'FSFO.BOTH_MUST_HAVE_LOST',
    'FSFO.OBSERVER_OVERRIDE_FALSE', 'OBS.MASTER_ONLY_COORDINATES',
  ],
  doc: () => classicDoc('enabled'),
  events: () => [hostDown(0, 'dc1-prm01')],
};

export const observeOnly: Preset = {
  id: 'observe-only',
  title: 'Observe-only: the observer that never fails over',
  short: 'Observe-only observer',
  group: 'Classic',
  source: '19c broker, ENABLE FAST_START FAILOVER OBSERVE ONLY',
  summary:
    'The same configuration with ENABLE FAST_START FAILOVER OBSERVE ONLY. The observer watches '
    + 'and reports, and the one thing it will not do is promote anybody: "Unable to failover '
    + 'since this observer is in observe-only mode". The default event kills the primary at '
    + 't = 0 and nothing is promoted -- the standby waits, and only a manual FAILOVER moves the '
    + 'role. In observe-only mode that manual failover is not held to the conditions an '
    + 'enabled configuration imposes: "Manual failover to the fast-start failover target can '
    + 'be performed without receiving an acknowledgement from the observer", and "Manual '
    + 'failover can be performed even if the pre-condition checks are not met" -- the '
    + 'configuration UNSYNC or LAGGING or unobserved, the target invalid, a reinstatement or a '
    + 'master observer switch in progress. "You can switch over or manual failover to a '
    + 'bystander database." What such a failover loses is whatever the target had not received. '
    + 'The rest of the fast-start failover machinery in this mode is not documented, and this '
    + "page's model draws it unarmed: no primary stall, no readiness gate. This is the preset to "
    + 'compare against "classic": the same failure, and no promotion at the end of it.',
  cite: [
    'OBS.OBSERVE_ONLY', 'OBS.OBSERVE_ONLY_NO_ACK', 'OBS.OBSERVE_ONLY_NO_PRECHECKS',
    'OBS.OBSERVE_ONLY_BYSTANDER', 'OBS.MASTER_ONLY_COORDINATES',
  ],
  doc: () => classicDoc('observe-only'),
  events: () => [hostDown(0, 'dc1-prm01')],
};

export const CLASSIC_PRIMARY = memberId('prm01');
export const CLASSIC_STANDBY = memberId('sby01');
