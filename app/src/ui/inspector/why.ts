/**
 * One WHY table (ui.md SS0.3, SS8 invariant one).
 *
 * Every grey control in this application takes its reason from here, so the
 * page can never say two different things about the same restriction, and a
 * reason can be read once and recognised everywhere it appears.
 *
 * Two kinds of entry, and the difference matters:
 *
 *  - **Documented restrictions.** FASTSYNC is maximum availability only;
 *    `FastStartFailoverLagType` and `FastStartFailoverLagGraceTime` stay
 *    documented as maximum-performance behaviour whatever the lag limit is
 *    doing elsewhere; a far sync instance has no role, no apply and no open
 *    mode; `FastStartFailoverTarget` takes a physical or logical standby.
 *  - **Edition gates.** `PreferredObserverHosts` and 26ai's bounded maximum
 *    availability are later-edition behaviour: the control is grey under 19c
 *    and says which edition states it, never that the property is invalid.
 *
 * Nothing here invents a restriction. Where the broker would merely complain --
 * an ASYNC destination under maximum protection, an observer on a database
 * server -- the control stays live and `validate()` reports the finding, so
 * the reader can build the mistake and read what Oracle says about it.
 */

import type { TopologyDoc, XptMode } from '@/engine';
import type { SegmentedOption } from '../common/Segmented';
import type { WhyState } from '../common/WhyPill';

export const ON: WhyState = { state: 'on' };

export const off = (why: string): WhyState => ({ state: 'off', why });

/** Gray when `condition` holds, with the reason spelled out. */
export const gateOff = (condition: boolean, why: string): WhyState =>
  (condition ? { state: 'off', why } : ON);

export const WHY = {
  /* ---- edition gates ---- */
  needs26ai:
    'A later edition states this: switch the release to 26ai to set it here.',
  lagLimitMaxAvail19c:
    'Under 19c FastStartFailoverLagLimit is a maximum performance property, and 19c\'s own fast-start failover chapter and property page disagree about whether it reaches maximum availability at all. The maximum availability role is a 21c feature; 26ai gives that role its own default of 0.',
  pingPropsNotIn19c:
    'ObserverPingInterval and ObserverPingRetry do not exist in 19c: absent from the 12.2, 18c and 19c property pages and from a live 19.27 system. Documented from 21c.',
  docLater26aiObservedIn1927:
    'Documented from 26ai; observed in the property list of a 19.27 system, which Oracle\'s 19c documentation does not mention.',

  /* ---- documented restrictions ---- */
  fastsyncMode:
    'FASTSYNC is maximum availability only (12.1+).',
  lagTypeMode:
    'FastStartFailoverLagType is documented as maximum performance mode behaviour.',
  lagGraceMode:
    'FastStartFailoverLagGraceTime is documented as maximum performance mode behaviour.',
  lagGraceNoFsfo:
    'FastStartFailoverLagGraceTime is defined only while fast-start failover is enabled.',
  netTimeoutAsync:
    'NET_TIMEOUT bounds the wait for a SYNC acknowledgement, so an ASYNC destination is not given one.',
  farSyncNoRole:
    'A far sync instance has no role, no apply and no open mode.',
  farSyncNotAddress:
    'A far sync instance cannot be opened for access, so no connect string names it.',
  farSyncNotTarget:
    'FastStartFailoverTarget takes a physical or logical standby; a far sync instance cannot be one.',
  snapshotNotTarget:
    'FastStartFailoverTarget takes a physical or logical standby; a snapshot standby cannot be one.',
  primaryNotTarget:
    'The primary is not a failover target of itself.',
  primaryNoApply:
    'A primary applies no redo of its own.',
  snapshotNoApply:
    'A snapshot standby database does not apply the redo data that it receives, and it has no apply state to start or stop.',
  alreadyPrimary:
    'It holds the primary role already.',
  alreadyMaster:
    'It is the master observer already.',
  pingUnset:
    'The two ObserverPing properties are not set, so the threshold governs detection.',

  /* ---- structural ---- */
  lastMember:
    'A configuration needs at least one database.',
  primaryMember:
    'This member holds the primary role: give the role to another database first.',
  lastInstance:
    'A member runs at least one instance.',
  siteInUse:
    'A database, an observer or an application still stands in this site: move or remove it first.',
  hostInUse:
    'This host still runs a database instance, an observer or an application.',
  noObserverDeployed:
    'No observer is deployed, so there is none to lose. Deploying no observer is not the same as being unobserved.',
  nothingDown:
    'Nothing has taken it down, so there is nothing to restore.',
  alreadyDown:
    'It is already down at this point on the clock.',
  noTarget:
    'No physical or logical standby is configured to move the role to.',
  switchoverTargetDown:
    'SWITCHOVER needs the target standby up: it is down at this point on the clock.',
  switchoverSnapshot:
    'A snapshot standby database cannot be the target of a switchover: convert it back to a physical standby first. A manual failover to it is allowed.',
  switchoverLogicalMaxProt:
    'Switchover to a logical standby database is disallowed when the configuration is operating in maximum protection mode.',
  switchoverPrimaryDown:
    'SWITCHOVER needs the primary up: it is down at this point on the clock.',
  failoverTargetDown:
    'FAILOVER needs the target standby up: it is down at this point on the clock.',
  notFormerPrimary:
    'REINSTATE DATABASE is for a former primary the run left needing reinstatement; the run does not show this one as that.',
  onlyRedoDest:
    'It is the only destination its sender ships to, and an empty RedoRoutes is (LOCAL : ALL), which ships to it again: disable the standby (Enabled, in its properties) or remove it instead.',
  pingFollowsObserver:
    'Every running observer connects to the primary: this line goes when the observer does.',
  targetIsAny:
    'FastStartFailoverTarget is ANY, so the observer checks every physical and logical standby: name the targets in the configuration to leave one out.',
  /**
   * The two ends of a range this page models, said without the numbers: the
   * range itself lives in the engine's `BOUNDS`, and a sentence here carrying
   * `0 ms` or `100 ms` of its own is a second place to change it.
   */
  rttAtFloor:
    'The round trip is at the floor of the range this page models.',
  rttAtCeiling:
    'The round trip is at the ceiling of the range this page models.',
  /**
   * The reason is spelled out once, on the stage card the shell draws above
   * the drawing (App.tsx). Everywhere else says only that it is read-only:
   * three copies of the same sentence on one phone screen is not three times
   * as honest, it is noise.
   */
  readOnlyHere:
    'Read-only here.',
  readOnlyView:
    'This is a read-only view here.',
  nameTaken:
    'Another member already carries that db_unique_name.',
  observerNameTaken:
    'Another observer already carries that name.',
  idTaken:
    'Something else in this configuration already carries that name.',
} as const;

export type WhyKey = keyof typeof WHY;

/**
 * Whether `FastStartFailoverLagLimit` can be set, and if not, why.
 *
 * 19c: a maximum performance property, and 19c disagrees with itself about
 * whether it reaches maximum availability at all -- this page follows the
 * observed 19.27 behaviour (not evaluated there) over the chapter's "must be
 * zero" sentence. 26ai: maximum availability has the role too, where 0 is the
 * broker default and means zero data loss; that role is a 21c feature, not a
 * 26ai one. The rail's form and Simulate's tune strip both read this.
 */
export function lagLimitGate(doc: TopologyDoc): WhyState {
  const ed = doc.config.edition;
  const mode = doc.config.protectionMode;
  return mode === 'MAXPERFORMANCE'
    ? ON
    : ((ed === '26ai' && mode === 'MAXAVAILABILITY') ? ON : off(ed === '26ai' ? WHY.lagTypeMode : WHY.lagLimitMaxAvail19c));
}

/** `LogXptMode`'s three values; FASTSYNC is offered under maximum availability only. */
export function logXptOptions(doc: TopologyDoc): SegmentedOption<XptMode>[] {
  return [
    { value: 'SYNC', label: 'SYNC' },
    {
      value: 'FASTSYNC',
      label: 'FASTSYNC',
      enabled: doc.config.protectionMode === 'MAXAVAILABILITY' ? ON : off(WHY.fastsyncMode),
    },
    { value: 'ASYNC', label: 'ASYNC' },
  ];
}
