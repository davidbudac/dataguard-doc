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
    'Under 19c FastStartFailoverLagLimit is a maximum performance property. 26ai gives it a maximum availability role.',

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
  farSyncNotTarget:
    'FastStartFailoverTarget takes a physical or logical standby; a far sync instance cannot be one.',
  snapshotNotTarget:
    'FastStartFailoverTarget takes a physical or logical standby; a snapshot standby cannot be one.',
  primaryNotTarget:
    'The primary is not a failover target of itself.',
  primaryNoApply:
    'A primary applies no redo of its own.',
  pingUnset:
    'The two ObserverPing properties are not set, so the threshold governs detection.',

  /* ---- structural ---- */
  lastMember:
    'A configuration needs at least one database.',
  primaryMember:
    'This member holds the primary role: give the role to another database first.',
  lastInstance:
    'A member runs at least one instance.',
  siteHasHosts:
    'This site still has hosts in it: move or remove them first.',
  hostInUse:
    'This host still runs a database instance or an observer.',
  noObserverDeployed:
    'No observer is deployed, so there is none to lose. Deploying no observer is not the same as being unobserved.',
  nothingDown:
    'Nothing has taken it down, so there is nothing to restore.',
  alreadyDown:
    'It is already down at this point on the clock.',
  noTarget:
    'No physical or logical standby is configured to move the role to.',
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
} as const;

export type WhyKey = keyof typeof WHY;
