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
    severity: 'error', severities: ['error', 'info'], basis: 'inferred',
    summary: 'The target must receive redo directly from the primary; a far sync feed is the sanctioned exception and a cascaded terminal standby fails it (B3). A condition of enabling fast-start failover: with it disabled, at most an info about what enabling would require.',
  },
  'FSFO.MULTI_TARGET_EXPLICIT': {
    severity: 'error', severities: ['error', 'info'], basis: 'documented',
    summary: 'With more than one standby database the property must be set explicitly (C1). A condition of enabling fast-start failover: with it disabled, at most an info about what enabling would require.',
  },
  'FSFO.FARSYNC_XPT': {
    severity: 'error', basis: 'documented',
    summary: 'Far sync SYNC or FASTSYNC, target standby ASYNC (A2).',
  },
  'FSFO.FARSYNC_MODE_19C': {
    severity: 'error', basis: 'conflict',
    summary: '19c: not maximum protection and not maximum performance with fast-start failover; 26ai drops the maximum performance exclusion (A4). Scoped to a far sync feeding the fast-start failover target only.',
  },
  'FSFO.LOGICAL_MAXPROT': {
    severity: 'error', severities: ['error', 'info'], basis: 'documented',
    summary: 'Logical standbys are not supported in maximum protection mode for fast-start failover (E1). A condition of enabling fast-start failover: with it disabled, at most an info about what enabling would require.',
  },
  'FSFO.LAGLIMIT_VS_THRESHOLD': {
    severity: 'warning', basis: 'documented', bases: ['documented', 'doc-later'],
    summary: 'FastStartFailoverLagLimit at or below FastStartFailoverThreshold is the documented recommendation -- on the 26ai property page only, so doc-later under 19c.',
  },
  'FSFO.PING_PROPS_NOT_IN_19C': {
    severity: 'error', basis: 'doc-later',
    summary: 'ObserverPingInterval and ObserverPingRetry do not exist in 19c: absent from the 12.2, 18c and 19c property pages and from a live 19.27 system. Documented from 21c (D1/ED-01).',
  },
  'FSFO.LAGTYPE_GRACETIME_19C': {
    severity: 'warning', basis: 'doc-later',
    summary: 'FastStartFailoverLagType and FastStartFailoverLagGraceTime are documented from 26ai, absent from the 19c and 21c property pages, but present in a live 19.27 system (D1/ED-02).',
  },
  'CFG.PRIMARY_CANDIDATES_19C': {
    severity: 'warning', basis: 'doc-later',
    summary: 'PrimaryDatabaseCandidates is documented from 26ai, absent from the 19c and 21c property pages, but present in a live 19.27 system (D1/ED-02).',
  },
  'FSFO.FARSYNC_TARGET_BOTH_SIDES': {
    severity: 'info', basis: 'documented',
    summary: 'Far sync feeding the fast-start failover target: FastStartFailoverTarget must first be set on both the primary and the target standby database (Scenario 7, VAL-07.7).',
  },
  'FSFO.FLASHBACK_REQUIRED': {
    severity: 'warning', basis: 'documented',
    summary: 'Fast-start failover enabled with Flashback Database off on the primary or a candidate target raises ORA-16827, independent of FastStartFailoverAutoReinstate (VAL-07.1).',
  },
  'MEMBER.SNAPSHOT_NEEDS_FLASHBACK': {
    severity: 'warning', basis: 'documented',
    summary: 'A snapshot standby needs Flashback Database; it cannot be the target of a switchover or fast-start failover, though a manual failover to one is allowed (VAL-07.3).',
  },
  'OBS.NAME_RESERVED': {
    severity: 'error', basis: 'documented',
    summary: 'Observer names are unique in a configuration, and NONAME and ALL are reserved (VAL-07.5, VAL-11).',
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
    severity: 'error', severities: ['error', 'warning', 'info'], basis: 'documented', bases: ['documented', 'conflict'],
    summary: 'At least one standby in the configuration must support the mode (MEM19); an ASYNC bystander beside a SYNC standby is legal. The fast-start failover prerequisites carry a stricter, per-member requirement for the target and the primary only, while fast-start failover is enabled: maximum protection SYNC, maximum availability SYNC or FASTSYNC (26ai\'s prerequisites list add ASYNC there, a conflict with Table 4-2 and the LogXptMode page that 26ai does not name), maximum performance lists ASYNC as the only mode -- never "SYNC is illegal there".',
  },
  'XPT.PRIMARY_LOGXPTMODE': {
    severity: 'error', severities: ['error', 'warning'], basis: 'documented', bases: ['documented', 'conflict'],
    summary: 'With fast-start failover enabled or observe-only in maximum availability or maximum protection, the primary is a standby after a role change: what it would then receive -- its LogXptMode, or a pre-declared RedoRoutes rule (not counted in maximum protection under 26ai, whose prerequisite names that alternative for the other two modes only) -- must meet the prerequisite set for both databases (19c Task 3: SYNC or FASTSYNC, SYNC in maximum protection). A warning under 26ai maximum availability, whose prerequisites list adds ASYNC against Task 3: a conflict.',
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
  'ROUTES.SNAPSHOT_CONVERT_NONNULL': {
    severity: 'warning', basis: 'conflict',
    summary: 'CONVERT DATABASE bars a snapshot standby whose RedoRoutes is non-NULL; the RedoRoutes page bars only one that would send redo onward. Oracle does not reconcile the two.',
  },
  'ROUTES.LOGICAL_LOCAL_ONLY': {
    severity: 'error', basis: 'documented',
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
    severity: 'warning', basis: 'documented',
    summary: 'As a best practice the observer is never deployed at the primary or standby database server -- Oracle documents no refusal, so this is a warning, not an error.',
  },
  'OBS.PRIMARY_SITE': {
    severity: 'warning', basis: 'inferred',
    summary: "The primary's site is on none of the placement hierarchy's three documented rungs -- an inference from reading all three together, not a single quoted sentence.",
  },
  'OBS.NONE_DEPLOYED': {
    severity: 'info', severities: ['info', 'warning'], basis: 'documented',
    summary: 'No observer deployed is legal: enabling fast-start failover with no observer started raises ORA-16819, the configuration is unobserved, and no failover can happen. A warning where the document says fast-start failover is enabled or observe-only; the standing info otherwise.',
  },
  'OBS.MASTER_UNIQUE': {
    severity: 'error', severities: ['error', 'info'], basis: 'documented',
    summary: 'One observer is the master and the others are backup observers; only the master coordinates fast-start failover. With fast-start failover disabled no observer is the master, so the finding is an info about what enabling would need.',
  },
  'OBS.PREFERRED_HOSTS': {
    severity: 'warning', basis: 'documented',
    summary: 'Only observers running on the hosts PreferredObserverHosts names will observe or become master.',
  },
  'RAC.OBSERVER_ON_CLUSTER': {
    severity: 'warning', basis: 'documented',
    summary: 'As a best practice the observer is never deployed on the primary or standby database cluster either -- a warning, same as OBS.ON_DB_HOST.',
  },
  'RAC.PREFERRED_APPLY_UNKNOWN': {
    severity: 'warning', basis: 'documented',
    summary: 'PreferredApplyInstance takes an instance name (SID) or the empty string; it names no instance of this member.',
  },
  'RAC.PREFERRED_APPLY_UNUSED': {
    severity: 'info', basis: 'documented',
    summary: 'PreferredApplyInstance is only used when the database is a standby Oracle RAC database.',
  },
  'RAC.APPLY_INSTANCES_UNUSED': {
    severity: 'info', basis: 'documented',
    summary: 'ApplyInstances is valid only on physical standby databases with more than one instance.',
  },
  'RAC.INSTANCES_SHARE_HOST': {
    severity: 'warning', basis: 'model',
    summary: 'Two instances of one database on one host: this page draws each RAC instance on a node of its own.',
  },
  'REINSTATE.PRECONDITIONS': {
    severity: 'warning', severities: ['warning', 'info'], basis: 'documented',
    summary: 'FastStartFailoverAutoReinstate needs Flashback Database on both databases and static service names, and covers only an observer-initiated failover after a primary crash or isolation. A warning while fast-start failover is enabled; an info while it is disabled or observe-only, when no automatic reinstatement can happen.',
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
  'DEST.SYNC_ABOVE_10': {
    severity: 'warning', basis: 'inferred',
    summary: 'LOG_ARCHIVE_DEST_11 through _31 do not support SYNC; a member\'s 10th remote destination lands in _11 by this page\'s numbering, hence inferred.',
  },
  'EDIT.FSFO_ENABLED_BLOCKS': {
    severity: 'info', basis: 'documented',
    summary: 'While fast-start failover is enabled the broker blocks several edits with ORA-16654; a downgrade from maximum protection to maximum availability is the exception, and FORCE on DISABLE FAST_START FAILOVER is for a disconnected network.',
  },
  'EDIT.REMOVE_TARGET': {
    severity: 'info', basis: 'documented',
    summary: 'A member named by FastStartFailoverTarget cannot be removed (ORA-16867).',
  },
  'MEMBER.PRIMARY_COUNT': {
    severity: 'error', basis: 'documented',
    summary: 'A broker configuration has one primary database: none, or two, is not a configuration (VAL-18).',
  },
  'MEMBER.NAME_DUPLICATE': {
    severity: 'error', basis: 'model',
    summary: 'Two members, or two instances of one database, with the same name cannot be addressed apart; no Oracle sentence states the uniqueness (VAL-18).',
  },
  'MEMBER.STATIC_SERVICE': {
    severity: 'info', basis: 'inferred',
    summary: 'A single-instance database without Oracle Restart needs a static service for DGMGRL to start it, switchover included; the document cannot say whether Oracle Restart is configured (VAL-17).',
  },
  'FSFO.TARGET_DISABLED': {
    severity: 'error', severities: ['error', 'info'], basis: 'documented',
    summary: 'A standby that is the fast-start failover target cannot be disabled: every named target disabled is a state the broker would not let you reach. A condition of enabling fast-start failover: with it disabled, an info (VAL-19).',
  },
  'LIMIT.MEMBERS_253': {
    severity: 'error', basis: 'documented',
    summary: '253 members per configuration, documented on the 19c and 26ai Managing Broker Configurations pages, word for word.',
  },
  'EVENT.REINSTATE': {
    severity: 'warning', severities: ['warning', 'error'], basis: 'documented', bases: ['documented', 'inferred', 'model'],
    summary: 'REINSTATE needs Flashback Database enabled on the database prior to the failover (a warning); it names a database of the configuration, never a far sync instance (an error, inferred or model).',
  },
  'EVENT.SET_APPLY_INSTANCE': {
    severity: 'warning', severities: ['warning', 'info'], basis: 'documented', bases: ['documented', 'model'],
    summary: 'WITH APPLY INSTANCE names an instance of a database of the configuration, and is ignored on a primary.',
  },
  'EVENT.SET_MASTER_OBSERVER': {
    severity: 'info', severities: ['info', 'warning'], basis: 'documented', bases: ['documented', 'model'],
    summary: 'SET MASTEROBSERVER names a deployed observer; with fast-start failover disabled no observer is the master.',
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
