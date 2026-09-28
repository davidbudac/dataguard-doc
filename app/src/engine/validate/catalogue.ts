/**
 * The rule catalogue -- engine design SS2, one entry per listed rule id.
 *
 * The catalogue is data rather than prose so that two things can be checked
 * mechanically: that every rule the design lists is implemented, and that every
 * Finding the engine emits carries the severity and the basis the design gives
 * it. `severity` and `basis` are orthogonal -- an error can be a model, a
 * warning can be documented -- and a rule whose severity or basis depends on
 * the edition or on the protection mode declares every value it may take.
 */

import type { Basis, Severity } from '../types/claims';

export interface RuleSpec {
  /** The value the rule emits unless it names another. */
  severity: Severity;
  /** Every severity this rule may emit; defaults to [severity]. */
  severities?: readonly Severity[];
  basis: Basis;
  /** Every basis this rule may emit; defaults to [basis]. */
  bases?: readonly Basis[];
  /** The catalogue line from the design, kept next to the code that runs it. */
  summary: string;
  /** True when the rule can only fire under 26ai (the 19c-invariance test). */
  edition26aiOnly?: true;
}

export const RULE_CATALOGUE = {
  'MEMBER.FARSYNC_NOT_PRIMARY': {
    severity: 'error', basis: 'documented',
    summary: 'A far sync instance can never be primary, nor be converted to any type of standby database (A1).',
  },
  'FSFO.TARGET_KIND': {
    severity: 'error', basis: 'documented',
    summary: 'FastStartFailoverTarget takes physical or logical standbys only: not a snapshot standby, a far sync instance or a ZDLRA (A6/C1).',
  },
  'FSFO.TARGET_DIRECT_REDO': {
    severity: 'error', basis: 'inferred',
    summary: 'The target must receive redo directly from the primary; a far sync feed is the sanctioned exception and a cascaded terminal standby fails it (B3).',
  },
  'FSFO.MULTI_TARGET_EXPLICIT': {
    severity: 'error', basis: 'documented',
    summary: 'With more than one standby database the property must be set explicitly (C1).',
  },
  'FSFO.FARSYNC_XPT': {
    severity: 'error', basis: 'documented',
    summary: 'Far sync SYNC or FASTSYNC, target standby ASYNC (A2).',
  },
  'FSFO.FARSYNC_MODE_19C': {
    severity: 'error', basis: 'conflict',
    summary: '19c: not maximum protection and not maximum performance with fast-start failover; 26ai drops the maximum performance exclusion (A4).',
  },
  'FSFO.LOGICAL_MAXPROT': {
    severity: 'error', basis: 'documented',
    summary: 'Logical standbys are not supported in maximum protection mode for fast-start failover (E1).',
  },
  'FSFO.LAGLIMIT_VS_THRESHOLD': {
    severity: 'warning', basis: 'documented',
    summary: 'FastStartFailoverLagLimit at or below FastStartFailoverThreshold is the documented recommendation.',
  },
  'FSFO.LAGTYPE_MODE': {
    severity: 'info', basis: 'documented',
    summary: 'FastStartFailoverLagType and FastStartFailoverLagGraceTime stay maximum performance mode behaviour.',
  },
  'FSFO.OBSERVE_ONLY': {
    severity: 'info', basis: 'documented',
    summary: 'Observe-only never fails over.',
  },
  'MODE.MAXPROT_NEEDS_SYNC_DB': {
    severity: 'error', basis: 'documented',
    summary: 'A far sync instance alone receiving redo synchronously is not enough for maximum protection (A4).',
  },
  'MODE.MAXPROT_SNAPSHOT_ONLY': {
    severity: 'error', basis: 'documented',
    summary: 'Maximum protection cannot be used if the only standby database is a snapshot standby.',
  },
  'MODE.MAXPROT_ONE_STANDBY': {
    severity: 'warning', basis: 'documented',
    summary: 'Oracle recommends a minimum of two standby databases in maximum protection mode (C3).',
  },
  'XPT.TABLE_4_2': {
    severity: 'error', severities: ['error', 'warning', 'info'], basis: 'documented',
    summary: 'Broker Table 4-2: maximum protection SYNC; maximum availability SYNC or FASTSYNC (26ai lists ASYNC too); maximum performance lists ASYNC as the only mode -- never "SYNC is illegal there".',
  },
  'XPT.FASTSYNC_MAXAVAIL_ONLY': {
    severity: 'error', basis: 'documented',
    summary: 'FASTSYNC is 12.1+ and maximum availability mode only.',
  },
  'XPT.FASTSYNC_FSFO_GAP': {
    severity: 'info', basis: 'documented',
    summary: 'Fast-start failover cannot be initiated when FASTSYNC is in use and the standby is missing redo data.',
  },
  'ROUTES.SOURCE_UNIQUE': {
    severity: 'error', basis: 'documented',
    summary: 'A database may be a redo source in only one rule per member, LOCAL counting as the local database (A5).',
  },
  'ROUTES.LOCAL_AT_FARSYNC': {
    severity: 'error', basis: 'documented',
    summary: 'LOCAL cannot be used at a far sync instance (A5).',
  },
  'ROUTES.SNAPSHOT_FORBIDDEN': {
    severity: 'error', basis: 'documented',
    summary: 'RedoRoutes cannot be configured so that a snapshot standby would send redo to another member; receiving is not restricted (A5).',
  },
  'ROUTES.LOGICAL_LOCAL_ONLY': {
    severity: 'warning', basis: 'documented',
    summary: 'RedoRoutes can be set for a logical standby only if the redo source field is LOCAL (A5, 19c and 26ai).',
  },
  'ROUTES.ALT_NEEDS_MAXFAILURE': {
    severity: 'error', basis: 'inferred',
    summary: '12.1: an alternate requires a non-zero MaxFailure property on the non-alternate member; carried over, since only 12.1 documents ALT (A5).',
  },
  'ROUTES.GROUP_NEEDS_MAXFAILURE': {
    severity: 'error', basis: 'documented', edition26aiOnly: true,
    summary: '26ai: a member whose MaxFailure property is set to zero cannot be part of a RedoRoutes group (the property defaults to 1 there).',
  },
  'ROUTES.ALT_12_1_ONLY': {
    severity: 'warning', basis: 'documented',
    summary: 'ALT=( ... FALLBACK) is 12.1 grammar; the 12.2, 19c and 26ai grammar writes PRIORITY per destination instead.',
  },
  'ROUTES.CASCADE_PHYSICAL_ONLY': {
    severity: 'error', basis: 'documented',
    summary: 'Only physical standby databases cascade redo (B2).',
  },
  'ROUTES.CASCADE_RT_ASYNC': {
    severity: 'warning', basis: 'documented',
    summary: 'The ASYNC attribute must be explicitly specified for a cascaded destination to enable real-time cascading (A5/B2).',
  },
  'ROUTES.CASCADE_FANOUT_30': {
    severity: 'error', basis: 'documented',
    summary: 'A cascading standby supports up to 30 terminal destinations (B2) -- never "30 remote destinations" (E2).',
  },
  'ROUTES.CASCADE_SYNC_UNDOC': {
    severity: 'warning', basis: 'model',
    summary: 'SYNC (or no attribute) from a cascader to its terminal standby is documented as non-real-time cascading; this engine does not model it.',
  },
  'ROUTES.FARSYNC_ONWARD_SYNC_UNDOC': {
    severity: 'warning', basis: 'model',
    summary: 'The far sync onward hop is documented as ASYNC; SYNC onward is undocumented, never "forbidden" (A3).',
  },
  'ROUTES.CYCLE': {
    severity: 'error', basis: 'model',
    summary: 'The routing rules feed a member from itself; Oracle documents no cycle rule.',
  },
  'NET.DIRECT_LINK_REQUIRED': {
    severity: 'warning', basis: 'documented',
    summary: 'A far sync edge does not replace the direct primary-to-standby network connection (A1).',
  },
  'OBS.COUNT': {
    severity: 'error', basis: 'conflict',
    summary: '19c registers up to three observers; the 26ai fast-start failover chapter says four and its SHOW OBSERVER page still says three (D1).',
  },
  'OBS.ON_DB_HOST': {
    severity: 'error', basis: 'documented',
    summary: 'The observer is never deployed at the primary or standby database server.',
  },
  'OBS.PRIMARY_SITE': {
    severity: 'warning', basis: 'documented',
    summary: "The primary's site is not on the documented placement hierarchy.",
  },
  'OBS.NONE_DEPLOYED': {
    severity: 'info', severities: ['info', 'warning'], basis: 'documented',
    summary: 'No observer deployed is not the same as unobserved: FS_FAILOVER_STATUS reads DISABLED. A warning where the document also says fast-start failover is enabled -- the two cannot both be true, and the engine reads the observers.',
  },
  'OBS.MASTER_UNIQUE': {
    severity: 'error', basis: 'documented',
    summary: 'One observer is the master and the others are backup observers; only the master coordinates fast-start failover.',
  },
  'OBS.PREFERRED_HOSTS': {
    severity: 'warning', basis: 'documented',
    summary: 'Only observers running on the hosts PreferredObserverHosts names will observe or become master.',
  },
  'RAC.OBSERVER_ON_CLUSTER': {
    severity: 'error', basis: 'documented',
    summary: 'The observer is never deployed on the primary or standby database cluster either.',
  },
  'REINSTATE.PRECONDITIONS': {
    severity: 'warning', basis: 'documented',
    summary: 'FastStartFailoverAutoReinstate needs Flashback Database on both databases and static service names, and covers only an observer-initiated failover after a primary crash or isolation.',
  },
  'DEST.NETTIMEOUT_LOW': {
    severity: 'warning', basis: 'documented',
    summary: 'NetTimeout has a 1 s minimum and a documented 8-10 s recommendation.',
  },
  'DEST.REOPEN_ZERO': {
    severity: 'warning', basis: 'model',
    summary: 'The meaning of REOPEN = 0 is not documented.',
  },
  'DEST.MAXFAILURE_RESET_UNDOC': {
    severity: 'info', basis: 'model',
    summary: 'Whether a successful reopen resets the consecutive-failure counter is not documented.',
  },
  'DEST.DEPRECATED_19C': {
    severity: 'info', basis: 'documented',
    summary: 'ReopenSecs and MaxFailure are documented, non-deprecated 19c broker properties written into REOPEN and MAX_FAILURE.',
  },
  'DEST.RANGE': {
    severity: 'warning', basis: 'documented',
    summary: 'LOG_ARCHIVE_DEST_n runs 1 to 31, and non-real-time cascading is limited to destinations 1 to 10.',
  },
  'EDIT.FSFO_ENABLED_BLOCKS': {
    severity: 'info', basis: 'documented',
    summary: 'While fast-start failover is enabled the broker blocks several edits with ORA-16654.',
  },
  'EDIT.REMOVE_TARGET': {
    severity: 'info', basis: 'documented',
    summary: 'A member named by FastStartFailoverTarget cannot be removed (ORA-16867).',
  },
  'LIMIT.MEMBERS_253': {
    severity: 'info', basis: 'doc-later',
    summary: '253 members per configuration, documented in 12.1 only.',
  },
  'MODEL.OBSERVER_OVERRIDE': {
    severity: 'info', basis: 'model',
    summary: 'ObserverOverride is FALSE, the broker default, and this engine models the default only.',
  },
} as const satisfies Record<string, RuleSpec>;

export type RuleId = Extract<keyof typeof RULE_CATALOGUE, string>;

export const RULE_IDS = Object.keys(RULE_CATALOGUE) as RuleId[];

export const ruleSpec = (id: RuleId): RuleSpec => RULE_CATALOGUE[id];

export const allowedSeverities = (id: RuleId): readonly Severity[] => {
  const s = ruleSpec(id);
  return s.severities ?? [s.severity];
};

export const allowedBases = (id: RuleId): readonly Basis[] => {
  const s = ruleSpec(id);
  return s.bases ?? [s.basis];
};

/** Rules that can only fire under 26ai; the 19c-invariance test walks these. */
export const RULES_26AI_ONLY: RuleId[] = RULE_IDS.filter((id) => ruleSpec(id).edition26aiOnly === true);
