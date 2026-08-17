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
  const prm = database('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [local(to('sby01', 'SYNC'))],
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
    + 'and FASTSYNC for maximum availability mode. The default event kills the '
    + "primary's host at t = 0: the observer and the target standby both lose the primary, and "
    + 'with ObserverOverride at its default FALSE a fast-start failover needs both of them to '
    + 'have lost it, so the observer initiates one FastStartFailoverThreshold (default 30 s) '
    + 'later. What follows -- terminal recovery, the role change and the open -- is '
    + 'environment-dependent, not parameter-driven, and the bands drawn for it are nominal.',
  cite: [
    'OBS.PLACEMENT_THIRD_SITE', 'OBS.PLACEMENT_NEVER_ON_DB_HOST', 'XPT.TABLE_4_2',
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
    + 'since this observer is in observe-only mode". In this mode the primary may open without '
    + 'acknowledgement from the target, and a switchover or a failover to a bystander stays '
    + 'allowed. The default event kills the primary at t = 0 and nothing is promoted -- the '
    + 'standby waits, and only a manual FAILOVER moves the role. That manual failover is '
    + 'conditional while fast-start failover is enabled: the target must be the '
    + 'FastStartFailoverTarget standby, synchronized in maximum availability or maximum '
    + 'protection mode (within FastStartFailoverLagLimit in maximum performance mode), with the '
    + 'observer started and communicating with the target standby and the primary shut down '
    + 'first. This is the preset to compare against "classic": same failure, same clocks '
    + 'running, no promotion at the end of them.',
  cite: [
    'OBS.OBSERVE_ONLY', 'FSFO.MANUAL_FAILOVER_CONDITIONS', 'FSFO.THRESHOLD',
    'OBS.MASTER_ONLY_COORDINATES',
  ],
  doc: () => classicDoc('observe-only'),
  events: () => [hostDown(0, 'dc1-prm01')],
};

export const CLASSIC_PRIMARY = memberId('prm01');
export const CLASSIC_STANDBY = memberId('sby01');
