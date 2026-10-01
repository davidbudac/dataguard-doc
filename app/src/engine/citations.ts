/**
 * Citation catalogue -- URL plus the sentence the claim rests on.
 *
 * Seeded from `app/design/facts.md` (the verified fact sheet) and from the
 * accuracy rules in the repository's AGENTS.md, "Accuracy rules
 * (non-negotiable)". Every Claim and
 * every Finding the engine produces points at ids in here, so "documented"
 * always resolves to something a reader can open.
 *
 * Three conventions:
 *  - `quote` is the sentence the fact sheet carries. Where the fact sheet
 *    restates the source rather than quoting it, `paraphrase: true` says so.
 *  - `verified: 'cross-edition'` marks a fact stated most completely (or only)
 *    in an edition other than the one the engine is drawing -- the precedent
 *    AGENTS.md sets for the 21c ObserverPing* pages and the 12.1 HABPT
 *    observer-placement hierarchy.
 *  - `forbiddenFor` marks a source AGENTS.md rules OUT for a named fact. Those
 *    entries exist only so the engine can assert it never cites them there;
 *    `assertCitesAllowed` is the guard and a test walks every catalogue entry.
 */

export type DocEdition = '12.1' | '12.2' | '19c' | '21c' | '26ai';
export type CitationVerification = 'primary' | 'cross-edition';

export interface Citation {
  /** Canonical docs.oracle.com URL (or the error-help page for an ORA-). */
  url: string;
  /** The sentence the claim rests on. */
  quote: string;
  /** Which edition's page this is. */
  edition: DocEdition;
  verified: CitationVerification;
  /** True when `quote` restates the page in the fact sheet's words. */
  paraphrase?: boolean;
  note?: string;
  /** Facts (see FORBIDDEN_FACTS) this source must never be cited for. */
  forbiddenFor?: readonly string[];
}

/* ---- page URLs, named once ---- */
const U = {
  farSync19: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/creating-oracle-data-guard-far-sync-instance.html',
  bkr19Members: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/managing-oracle-data-guard-broker-configuration-members.html',
  bkr19Switch: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html',
  bkr19Props: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-properties.html',
  bkr19Cmds: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-commands.html',
  bkr19Scenarios: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/examples-using-data-guard-broker-DGMGRL-utility.html',
  bkr19Concepts: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-concepts.html',
  bkr19Install: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-installation-requirements.html',
  sbyRac: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/configuring-data-guard-standby-databases-in-oracle-RAC.html',
  racIntro: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/racad/introduction-to-oracle-rac.html',
  racInstances: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/racad/administering-database-instances-and-cluster-databases.html',
  refInstanceNumber: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/INSTANCE_NUMBER.html',
  haDeployDg: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/configure-and-deploy-oracle-data-guard.html',
  haLevel1: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/configuring-level-1-basic-application-high-availability.html',
  bkr121Props: 'https://docs.oracle.com/database/121/DGBKR/dbresource.htm',
  bkr121Changes: 'https://docs.oracle.com/database/121/DGBKR/release_changes.htm',
  bkr122Changes: 'https://docs.oracle.com/en/database/oracle/oracle-database/12.2/dgbkr/release-changes.html',
  bkr19Changes: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/release-changes.html',
  bkr26Fsfo: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html',
  bkr26Concepts: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/oracle-data-guard-broker-concepts.html',
  bkr26ShowObserver: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/show-observer.html',
  bkr26Routes: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/redo-routing-rules.html',
  bkr26RoutesProp: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/redoroutes.html',
  bkr21Switch: 'https://docs.oracle.com/en/database/oracle/oracle-database/21/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html',
  bkr26LagLimit: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlaglimit.html',
  bkr26LagType: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlagtype.html',
  bkr26LagGrace: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlaggracetime.html',
  bkr26PingInterval: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/observerpinginterval.html',
  bkr26PingRetry: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/observerpingretry.html',
  bkr26Preferred: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/preferredobserverhosts.html',
  bkr26Candidates: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/primarydatabasecandidates.html',
  bkr21Props: 'https://docs.oracle.com/en/database/oracle/oracle-database/21/dgbkr/oracle-data-guard-broker-properties.html',
  sbyModes: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/oracle-data-guard-protection-modes.html',
  sbyTransport: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/oracle-data-guard-redo-transport-services.html',
  sbyRoles: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/managing-oracle-data-guard-role-transitions.html',
  sbyDestAttrs: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html',
  refDestN: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/LOG_ARCHIVE_DEST_n.html',
  refSyncLatency19: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/DATA_GUARD_SYNC_LATENCY.html',
  refSyncLatency26: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DATA_GUARD_SYNC_LATENCY.html',
  refVDatabase: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DATABASE.html',
  refVDatabase26: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-DATABASE.html',
  haOptimize: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/optimizing-automatic-failover-common-scenarios-minimize-downtime1.html',
  haRedoTuning: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/redo-transport-troubleshooting-and-tuning.html',
  haTns: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/oracle-net-tns-string-parameters.html',
  haConnEstimates: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/connection-time-estimates-data-guard-switchover-or-failover.html',
  netrfTns: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/netrf/local-naming-parameters-in-tns-ora-file.html',
  netag19Optimize: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/netag/optimizing-performance.html',
  netrfSqlnet19: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/netrf/parameters-for-the-sqlnet.ora.html',
  netrfSqlnet26: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/netrf/parameters-for-the-sqlnet.ora.html',
  haConfigDeploy: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/configure-and-deploy-oracle-data-guard.html',
  jdbc19: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/jajdb/oracle/jdbc/OracleConnection.html',
  jdbc26: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/jajdb/oracle/jdbc/OracleConnection.html',
  habpt121: 'https://docs.oracle.com/database/121/HABPT/config_dg.htm',
  ora12514: 'https://docs.oracle.com/en/error-help/db/ora-12514/',
  ora16529: 'https://docs.oracle.com/en/error-help/db/ora-16529/',
  ora16649: 'https://docs.oracle.com/en/error-help/db/ora-16649/',
  ora16654: 'https://docs.oracle.com/en/error-help/db/ora-16654/',
  ora16655: 'https://docs.oracle.com/en/error-help/db/ora-16655/',
  ora16661: 'https://docs.oracle.com/en/error-help/db/ora-16661/',
  ora16819: 'https://docs.oracle.com/en/error-help/db/ora-16819/',
  bkr26Manual: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/manual-failover1.html',
  ora16658: 'https://docs.oracle.com/en/error-help/db/ora-16658/',
  ora16820: 'https://docs.oracle.com/en/error-help/db/ora-16820/',
  ora16867: 'https://docs.oracle.com/en/error-help/db/ora-16867/',
  ora16827: 'https://docs.oracle.com/en/error-help/db/ora-16827/',
  ora16647: 'https://docs.oracle.com/en/error-help/db/ora-16647/',
  bkr19Configs: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/managing-oracle-data-guard-broker-configurations.html',
  bkr26Configs: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/managing-oracle-data-guard-broker-configurations.html',
  bkr26Modes: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/managing-data-protection-modes.html',
  bkr19Roles: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/managing-oracle-data-guard-role-transitions.html',
  sbyAlternate19: 'https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/using-ALTERNATE-attribute-to-configure-alternate-destinations.html',
  jdbc26Urls: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/jjdbc/data-sources-and-URLs.html',
} as const;

/**
 * Facts for which AGENTS.md rules a source out. Keys are referenced from
 * `Citation.forbiddenFor` and from `assertCitesAllowed`.
 */
export const FORBIDDEN_FACTS = {
  LAG_LIMIT_MODE:
    'Which protection modes FastStartFailoverLagLimit applies in (the MaxAvailability role arrived in 21c; 26ai gives that role its own default of 0). 19c disagrees with itself about whether the property reaches MaxAvailability at all.',
  MAXAVAIL_TRANSPORTS:
    'Which redo transport modes a MaxAvailability target may use under 26ai.',
  MAX_FAILURE_SEMANTICS:
    'What MaxFailure / MAX_FAILURE counts and what reaching the limit does.',
  COMMIT_MAX_NOT_SUM:
    'Why a SYNC commit costs max(local write, remote ack path) rather than their sum.',
} as const;

export type ForbiddenFact = keyof typeof FORBIDDEN_FACTS;

export const CITATIONS = {
  /* ---------------- A. Far sync ---------------- */
  'FS.MANAGES_CONTROLFILE': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'A far sync instance manages a control file, receives redo into standby redo logs (SRLs), and archives those SRLs to local archived redo logs, but that is where the similarity with standbys ends.',
  },
  'FS.NO_DATAFILES': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'does not have user data files, cannot be opened for access, cannot run redo apply, and can never function in the primary role or be converted to any type of standby database.',
  },
  'FS.NO_BROKER_STATE': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'Far sync instances are also not included in this table because they do not have states; they only receive redo and forward it to a standby database.',
    note: 'Broker chapter 4, the note under the table of member states.',
  },
  'FS.ADG_LICENCE': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'Far sync instances are part of the Oracle Active Data Guard Far Sync feature, which requires an Oracle Active Data Guard license.',
  },
  'FS.SRL_NOT_SHARED': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'Standby redo log files used at the far sync instance cannot be shared with other databases.',
  },
  'FS.DIRECT_LINK_REQUIRED': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'there must still be a direct network connection between the primary database and the remote standby database ... used to perform health checks and switchover processing tasks.',
  },
  'FS.SYNC_TO_FARSYNC': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'all committed redo resides on disk at the far sync instance',
  },
  'FS.ONWARD_ASYNC': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'uses ASYNC transport to ship the incoming redo to terminal standbys',
  },
  'FS.UNSENT_REDO_TRANSMITTED': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Any unsent redo data residing on the far sync instance is transmitted to the target physical standby prior to converting the physical standby into a primary database.',
    note: 'Complete Failovers in Configurations Using Far Sync Instances, in the broker switchover and failover chapter (identical on the 26ai manual failover page). It says what happens to redo left on the far sync instance; it does not say what happens when the far sync instance is down.',
  },
  'FS.MODES_CA_19C': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'supported in either maximum performance or maximum availability mode',
  },
  'FS.MAXPROT_BROKER_19C': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'If a far sync instance is the only configuration member receiving redo in synchronous mode from the primary database',
    note: 'The condition under which maximum protection mode cannot be used.',
  },
  'FS.FAILURE_ADD_DEST': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'If the far sync instance fails, then redo should be shipped directly to the terminal standby by adding an additional log archive destination to the primary database, chicago. This does reduce the protection level because redo transmission is then in ASYNC mode instead of SYNC mode.',
  },
  'FS.HA_PAIR_SAME_PRIORITY': {
    url: U.farSync19, edition: '19c', verified: 'primary',
    quote: 'In this case though, the two far sync instances have the same priority and when one takes over for the other it remains the active far sync instance until it fails. To ensure that redo continues to be shipped to the terminal standby database in the event that both far sync instances fail, the terminal standby database is configured as before with PRIORITY=2.',
    note: 'Far Sync Instance High Availability, before Example 5-4 (chicagoFS and chicagoFS1 at GROUP=1 PRIORITY=1, boston at PRIORITY=2).',
  },
  'FS.ROUTES_BOTH_DIRECTIONS': {
    url: U.bkr19Members, edition: '19c', verified: 'primary', paraphrase: true,
    quote: "ADD FAR_SYNC FS2 AS CONNECT IDENTIFIER IS FS2.example.com; EDIT FAR_SYNC 'FS2' SET PROPERTY 'RedoRoutes' = '(South_Sales : North_Sales ASYNC)'; ENABLE FAR_SYNC FS2; EDIT DATABASE 'South_Sales' SET PROPERTY 'RedoRoutes' = '(LOCAL : FS2 SYNC)';",
    note: "Four consecutive DGMGRL prompts from the second-far-sync example, spliced together with their own output lines ('Far Sync FS2 added', 'Enabled.') dropped -- marked paraphrase because the splice, not the wording, is this page's doing. Routes are pre-declared for both directions; nothing rewrites on role change.",
  },
  'DGMGRL.FAR_SYNC_COMMANDS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'ADD FAR_SYNC name AS CONNECT IDENTIFIER IS ci; ENABLE FAR_SYNC; EDIT FAR_SYNC ... SET PROPERTY|SET PARAMETER|RENAME TO; VALIDATE FAR_SYNC [WHEN PRIMARY IS]; SHOW CONFIGURATION WHEN PRIMARY IS name',
    note: "A digest of the Format lines: 'ADD FAR_SYNC chicago AS CONNECT IDENTIFIER IS chicago.example.com;', 'EDIT FAR_SYNC far_sync_instance_name SET PROPERTY property_name = value;', 'EDIT FAR_SYNC far_sync_instance_name SET PARAMETER parameter_name = value | initialization parameter options;', 'EDIT FAR_SYNC far_sync_instance_name RENAME TO new_far_sync_instance_name;', 'VALIDATE FAR_SYNC [VERBOSE] far_sync_instance_name [WHEN PRIMARY IS database-name];', 'SHOW CONFIGURATION WHEN PRIMARY IS database-name;'.",
  },
  'DGMGRL.VERBOSE_ALTERNATE': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: '(alternate of Local_Sales)',
    note: 'SHOW CONFIGURATION VERBOSE output in Example 4-3 marks an alternate destination this way.',
  },

  /* ---------------- A5. RedoRoutes ---------------- */
  'ROUTES.GRAMMAR_121': {
    url: U.bkr121Props, edition: '12.1', verified: 'cross-edition',
    quote: '(redo source : redo destination); source LOCAL|ANY|name[,name]; dest ALL [attr] | name [attr][,name [attr]]; attr ASYNC|SYNC|FASTSYNC; alternate ALT=(name [xpt] [FALLBACK]).',
    paraphrase: true,
    note: 'The grammar is stated most completely in the 12.1 broker chapter 4.',
  },
  'ROUTES.INTRODUCED_121': {
    url: U.bkr121Changes, edition: '12.1', verified: 'cross-edition',
    quote: 'A new configurable property, RedoRoutes, supports redo cascading and far sync instances.',
    note: "Listed under Changes in Oracle Database 12c Release 1 (12.1.0.1). The 12.1.0.2 section adds: 'You can now use the RedoRoutes property to specify an alternate destination to ship redo data to if the first destination fails.'",
  },
  'ROUTES.LOCAL_NOT_AT_FARSYNC': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The LOCAL keyword is an alias for the local database name. This keyword cannot be used at a far sync instance.',
    note: 'The 19c broker properties page (Redo Routing Rules) carries the full grammar; the 12.1 chapter 4 adds only the ALT/FALLBACK form.',
  },
  'ROUTES.SOURCE_ONCE': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'A database cannot be specified as a redo source in more than one redo routing rule defined at a given database, either explicitly or implicitly through use of the LOCAL keyword.',
  },
  'ROUTES.UNSPECIFIED_ATTR': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'If the redo transport attribute is not specified, then the transport mode used will be the one specified by the LogXptMode property for the redo destination.',
  },
  'ROUTES.DEFAULT_NULL': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The RedoRoutes property has a default value of NULL, which is treated as (LOCAL : ALL) at a primary database.',
  },
  'ROUTES.RULE_ACTIVE': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'A redo routing rule is active if its redo source field specifies the current primary database.',
  },
  'ROUTES.CASCADE_ASYNC_EXPLICIT': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The ASYNC redo transport attribute must be explicitly specified for a cascaded destination to enable real-time cascading to that destination.',
  },
  'ROUTES.SNAPSHOT_FORBIDDEN': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The RedoRoutes property cannot be configured such that when a physical standby database is converted to a snapshot standby, the snapshot standby would send redo data to another member.',
  },
  'ROUTES.LOGICAL_LOCAL_ONLY': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The RedoRoutes property can be set for a logical standby database only if the redo source field is set to LOCAL.',
    note: 'The same sentence is on the 26ai redo-routing-rules page. The restriction is on the redo SOURCE field; the 12.1 page wrote "redo destination field" (and, beside it, "cannot be set on a logical or snapshot standby database"), which 19c and 26ai no longer say.',
  },
  'ROUTES.ALT_MAXFAILURE': {
    url: U.bkr121Props, edition: '12.1', verified: 'cross-edition',
    quote: 'The non-alternate member must have a non-zero value for its MaxFailure configurable property in order for an alternate to be specified.',
    note: "The 12.1 usage notes, the only edition carrying the ALT form: '[ALT=(alternate db_unique_name [ASYNC | SYNC | FASTSYNC] [FALLBACK])]'.",
  },
  'ROUTES.PRIORITY_26AI': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The optional [PRIORITY=n] can have n =1 ~ 8. The default value for far sync members is 1 and the default value for non-far sync members is 8.',
    note: 'The 19c broker properties page (Redo Routing Rules) already carries the parenthesised destination-group grammar with PRIORITY; the 26ai redo-routing-rules page repeats it word for word. Neither has the 12.1 ALT/FALLBACK form.',
  },
  'ROUTES.PRIORITY_19C_EX_4_3': {
    url: U.bkr19Members, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'Example 4-3 already uses the PRIORITY form, with (alternate of Local_Sales) in the SHOW CONFIGURATION output.',
  },
  'ROUTES.GROUP_MAXFAILURE_ZERO': {
    url: U.bkr26RoutesProp, edition: '26ai', verified: 'primary',
    note: 'A note on the 26ai RedoRoutes property page (redoroutes.html), not on the Redo Routing Rules page; the 19c properties page does not carry it.',
    quote: 'A member whose MaxFailure property is set to zero cannot be part of a RedoRoutes group',
  },
  'ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'GROUP is a LOG_ARCHIVE_DEST_n attribute, not RedoRoutes syntax.',
  },
  'ROUTES.CANONICAL_PAIR': {
    url: U.bkr19Members, edition: '19c', verified: 'primary', paraphrase: true,
    note: "The 19c broker chapter 4 far sync example (Managing Far Sync Instances): two consecutive DGMGRL prompts, spliced together with the output line between them dropped -- marked paraphrase because the splice, not the wording, is this page's doing.",
    quote: "EDIT DATABASE 'North_Sales' SET PROPERTY 'RedoRoutes' = '(LOCAL : FS1 SYNC)'; EDIT FAR_SYNC 'FS1' SET PROPERTY 'RedoRoutes' = '(North_Sales : South_Sales ASYNC)';",
  },

  'ROUTES.ONE_PATH_PER_GROUP': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The general rule is that there is one active redo path for each group.',
    note: 'Redo Routing Rules, Example 3 (two groups: the primary ships to one member of each). The 26ai redo-routing-rules page repeats it word for word.',
  },
  'ROUTES.PRIORITY_EX1': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'If FS1 is available, then the primary ships to FS1 which has PRIORITY=1. If FS1 is unavailable, then the primary ships to SB1 which has PRIORITY=2. When FS1 becomes active again, the primary will ship to it again because priority 1 is higher than priority 2.',
    note: "Redo Routing Rules, Example 1, for PRI's (local : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ) ). Identical on the 26ai redo-routing-rules page.",
  },
  'ROUTES.PRIORITY_EX2_STICKY': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'Even after FS1 becomes active again, the primary continues shipping to FS2 because FS1 and FS2 have the same priority. If FS2 fails, then the primary ships to FS1.',
    note: 'Redo Routing Rules, Example 2, for (local : ( FS1 PRIORITY=1, FS2 PRIORITY=1 ) ): among equal priorities the choice is sticky. Identical on the 26ai page.',
  },
  'ROUTES.PRIORITY_8': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'Setting PRIORITY=8 has special meaning. If a primary ships redo to a destination with PRIORITY=8, then it must ship to every PRIORITY=8 destination.',
    note: 'Redo Routing Rules, Example 4. Identical on the 26ai page.',
  },
  'ROUTES.ALL_ALIAS': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The ALL keyword is an alias for all possible destinations in the configuration.',
  },
  'ROUTES.ANY_ALIAS': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The ANY keyword is an alias for any database in the configuration.',
  },
  'ROUTES.SNAPSHOT_RECEIVES_REDO': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'Like a physical or logical standby database, a snapshot standby database receives and archives redo data from a primary database.',
    note: 'Why ALL includes a snapshot standby: only a snapshot standby forwarding redo is restricted (ROUTES.SNAPSHOT_FORBIDDEN).',
  },
  'ROUTES.FALLBACK_121': {
    url: U.bkr121Props, edition: '12.1', verified: 'cross-edition',
    quote: 'The optional FALLBACK keyword is used to specify that redo transport to the non-alternate member should be resumed if it becomes available. Oracle recommends that you use the FALLBACK keyword. If you omit it and the ALTERNATE redo destination subsequently fails, no redo will be shipped to the terminal standby databases serviced by the alternate destination.',
    note: "The 12.1 broker chapter 4 (Advanced Redo Transport Settings). Its Example 4-3 adds: 'If it is not set and the connection to Remote_Sales fails, then redo will not be sent to either Local_Sales or Remote_Sales even if Local_Sales becomes operational again.' The ALT/FALLBACK form is absent from the 12.2, 19c and 26ai grammar, where 19c Example 4-3 writes the same remote alternate with PRIORITY.",
  },
  'ROUTES.MAXFAILURE_GROUP_DEFAULT': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'If the standby database is part of a group as specified with the broker RedoRoutes property, then the default value 1. Otherwise, the default value is 0.',
    note: 'The MaxFailure property row, Broker default. The 26ai maxfailure.html page carries the same sentence. A default, not the semantics of the count: those live on the sbydb LOG_ARCHIVE_DEST_n attributes page.',
  },

  /* ---------------- A6 / C1. Fast-start failover targets ---------------- */
  'FSFO.TARGET_NOT_FARSYNC': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'the target standby cannot be a far-sync instance. However the target can receive redo from a far sync instance.',
  },
  'FSFO.TARGET_KIND': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'can only be set to the name of physical or logical standbys. It cannot be set to the name of a snapshot standby database, far sync instance, or Zero Data Loss Recovery Appliance.',
  },
  'FSFO.TARGET_DIRECT_REDO': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'The selected standby database that will be the fast-start failover target must receive redo directly from the primary database',
  },
  'FSFO.FARSYNC_XPT': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'To use a far sync instance with fast-start failover, the far sync instance transport mode must be set to either SYNC or FASTSYNC and the target standby database transport mode must be set to ASYNC.',
  },
  'FSFO.FARSYNC_MODES_19C': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'A far-sync instance cannot be used in maximum protection mode or maximum performance mode.',
  },
  'FSFO.FARSYNC_MODES_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'A far-sync instance cannot be used in maximum protection mode.',
    note: 'The maximum performance exclusion is dropped in 26ai.',
  },
  'FSFO.MULTI_TARGET_12_2': {
    url: U.bkr122Changes, edition: '12.2', verified: 'cross-edition',
    quote: 'To increase high availability, you can now set multiple fast-start failover targets and the broker automatically selects which one to use.',
  },
  'FSFO.TARGET_ORDER': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'the broker selects one based on the order in which they are specified in the property definition',
    note: 'Word it as "order"; never as "first viable in list order".',
  },
  'FSFO.TARGET_AUTO_CHANGE': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If the designated fast-start failover target develops a problem and cannot be the target of a failover, then the broker automatically changes the fast-start failover target to one of the other candidate targets.',
    note: 'The fast-start failover overview in broker chapter 5 (the sentence is not on the properties page).',
  },
  'FSFO.TARGET_MUST_BE_EXPLICIT': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If there is more than one standby database in the configuration, you must explicitly set the FastStartFailoverTarget property on the primary database to name one or more candidate target standby databases.',
    note: 'Enabling Fast-Start Failover Task 2.',
  },
  'FSFO.TARGET_VERIFIED_ON_ENABLE': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'Targets are verified when fast-start failover is enabled',
  },
  'FSFO.LOGICAL_MAXPROT': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'Logical standby databases are not supported in maximum protection mode for fast-start failover.',
    note: "The table 'which standby types are supported in which protection modes when fast-start failover is enabled': Maximum Protection -- Physical Standbys Supported? Yes; Logical Standbys Supported? No; Far Sync Instances Supported to Send Redo? No.",
  },

  /* ---------------- B. Cascading ---------------- */
  'CASCADE.TERMINAL_INDIRECT': {
    url: U.sbyTransport, edition: '19c', verified: 'primary',
    quote: 'receives primary database redo indirectly from a standby database',
  },
  'CASCADE.THIRTY_TERMINAL': {
    url: U.sbyTransport, edition: '19c', verified: 'primary',
    quote: 'up to 30 terminal destinations',
    note: 'Never write "30 remote destinations".',
  },
  'CASCADE.PHYSICAL_ONLY': {
    url: U.sbyTransport, edition: '19c', verified: 'primary',
    quote: 'Cascading has the following restrictions: Only physical standby databases can cascade redo. Real-time cascading requires a license for the Oracle Active Data Guard option. Non-real-time cascading is supported on destinations 1 through 10 only.',
  },
  'CASCADE.SYNC_NON_REALTIME': {
    url: U.sbyTransport, edition: '19c', verified: 'primary',
    quote: 'If you specify ASYNC transport mode on destinations 1 through 10, then redo is shipped in real-time. If you do not specify a transport mode or you specify SYNC on destinations 1 through 10, then redo is shipped in non-real-time. Destinations 11 through 31 operate only in ASYNC (real-time) transport mode.',
    note: "Section 7.3.1, the cascading standby's own LOG_ARCHIVE_DEST_n. SYNC from a cascader is documented -- as non-real-time cascading -- never 'undocumented'.",
  },
  'CASCADE.MANUAL_FAILOVER_UNSENT': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'In a complete failover, it is also possible to failover to a standby database (terminal standby) that gets redo from another standby database (cascader). In such a case, no attempt is made to transmit any unsent redo from the cascader to the terminal standby.',
    note: 'Complete Failovers in Configurations Using Cascaded Standbys, broker chapter 5 (not the Concepts and Administration transport chapter).',
  },
  'CASCADE.EXAMPLE_4_2': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: '(receiving current redo)',
    note: 'Example 4-2 shows the cascade by indentation and this marker.',
  },

  /* ---------------- C. Multiple standbys, protection modes ---------------- */
  'BYSTANDERS.DEFAULT_ALL': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The BystandersFollowRoleChange configuration property establishes whether bystander standby databases are evaluated during failover (value = ALL) or after failover (value = NONE).',
    note: 'The property table gives the broker default as ALL.',
  },
  'MAXPROT.SHUTS_PRIMARY': {
    url: U.sbyModes, edition: '19c', verified: 'primary',
    quote: 'shuts the primary database down rather than allowing it to continue',
  },
  'MAXPROT.TWO_STANDBYS': {
    url: U.sbyModes, edition: '19c', verified: 'primary',
    quote: 'Oracle recommends that a minimum of two standby databases be used ... to prevent a single standby database failure from causing the primary database to shut down',
  },
  'MAXAVAIL.AT_LEAST_ONE': {
    url: U.sbyModes, edition: '19c', verified: 'primary',
    quote: 'If the primary does not receive acknowledgement from at least one synchronized standby, then it operates as if it were in maximum performance mode',
    note: 'The Concepts and Administration protection-modes page words MaxAvailability this way; its MaxProtection paragraph says only that the primary "shuts the primary database down rather than allowing it to continue". The 19c broker chapter 4 does add "if it cannot write its redo stream to at least one synchronized standby database" for MaxProtection, so the "any one SYNC ack suffices" reading is a documented broker statement there, not this page\'s inference.',
  },
  'MAXAVAIL.AT_LEAST_ONE_FARSYNC': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'at least one standby database that receives redo via the SYNC transport, either directly or through a far sync instance',
    note: 'The 19c broker chapter 4, Setting the Protection Mode: the sentence that names a far sync instance on the SYNC path to a standby. Cite this, not MAXAVAIL.AT_LEAST_ONE, where the redo reaches the standby through a far sync instance.',
  },
  'MAXAVAIL.FARSYNC_ACK_26AI': {
    url: U.bkr26Modes, edition: '26ai', verified: 'primary',
    quote: 'Transactions do not commit until all redo data needed to recover those transactions has been written to the online redo log and to the standby redo log on at least one synchronized standby database or far sync instance.',
    note: 'Managing Data Protection Modes, Maximum Availability. The 19c broker page (chapter 4) reads "at least one synchronized standby database" with no far sync instance, so under 19c a far sync acknowledgement in maximum availability stays this page\'s inference.',
  },
  'MAXPROT.AT_LEAST_ONE_BROKER': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'To ensure that data loss cannot occur, the primary database will shut down, rather than continue processing transactions, if it cannot write its redo stream to at least one synchronized standby database.',
    note: 'The 19c broker chapter 4 (members page), Maximum Protection. This is the documented "at least one synchronized standby" wording for MaxProtection -- the Concepts and Administration protection-modes page spells that phrase out for MaxAvailability only, so cite this page for MaxProtection, never that one. Same section: "If only one standby database is supporting maximum protection mode, Oracle Data Guard broker will disallow the shutdown of the apply instance."',
  },
  'MODE.MAXPROT_SNAPSHOT_ONLY': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'Maximum protection mode cannot be used in the following situations: If the only standby database in a configuration is a snapshot standby If a far sync instance is the only configuration member receiving redo in synchronous mode from the primary database',
    note: 'The note under Setting the Protection Mode Task 1, flattened.',
  },

  /* ---------------- D. Observers ---------------- */
  'OBS.THREE_19C': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'There can be up to three observers for a single Data Guard configuration. One is the master observer and the others are backup observers.',
    note: 'The "three" is 19c-specific; do not carry it across editions.',
  },
  'OBS.FOUR_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'There can be up to four observers for a single Data Guard configuration.',
    note: 'The 21c broker switchover/failover chapter already says four (verified 2026-08-17), so the move from three is a 21c change; 19c says three.',
  },
  'OBS.THREE_26AI_SHOW': {
    url: U.bkr26ShowObserver, edition: '26ai', verified: 'primary',
    quote: 'It shows this information for all the observers (up to 3) in this single configuration.',
    note: 'The 26ai self-contradiction on observer count; cite both sides.',
  },
  'OBS.FOUR_CMD19': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'You can register up to four observers to monitor a single Data Guard broker configuration.',
    note: "The 19c command reference's own START OBSERVER page, against the 19c switchover/failover chapter's three (OBS.THREE_19C) and the 19c tab of ORA-16647 ('a maximum of three observers can be started'). A second, 19c-internal version of the 26ai OBS.FOUR_26AI / OBS.THREE_26AI_SHOW conflict, not documented as resolved either.",
  },
  'OBS.MASTER_ONLY_COORDINATES': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Only the master observer can coordinate fast-start failover with Data Guard broker. All other registered observers are considered to be backup observers.',
  },
  'OBS.NO_MASTER_WHEN_DISABLED': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'When fast-start failover is disabled, no observer is called the master observer; all observers have the same functionality.',
  },
  'OBS.NOMINATION_PRECONDITION': {
    url: U.bkr19Scenarios, edition: '19c', verified: 'primary',
    quote: 'If the primary and target standby databases stay connected but the connection to the master observer is lost, then the broker tries to nominate a backup observer as the new master observer.',
    note: 'Never state the rule without its precondition, and never extend it to a failure that separates primary from target.',
  },
  'OBS.NOMINATION_12_2': {
    url: U.bkr122Changes, edition: '12.2', verified: 'cross-edition',
    quote: 'You can now start observers on multiple hosts to manage a single Data Guard broker configuration. If one observer fails, then a backup observer automatically takes its place so that the configuration is never in an unobserved state.',
    note: 'The release note overstates the guarantee ("never in an unobserved state"); the precondition wording of OBS.NOMINATION_PRECONDITION wins.',
  },
  'OBS.START_FILE_IS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'START OBSERVER [observer-name] IN BACKGROUND CONNECT IDENTIFIER IS connect-identifier [FILE IS observer-file] [LOGFILE IS log-file] [TRACE_LEVEL IS USER | SUPPORT];',
    note: 'FILE IS, never FILE=. The foreground form is START OBSERVER [<observer_name>] [FILE IS <observer_file>] [LOGFILE IS <observer_log_file>] [TRACE_LEVEL IS { USER | SUPPORT }]; -- CONNECT IDENTIFIER IS belongs to the IN BACKGROUND form only, where it is mandatory ("You must provide a connect identifier"). Broker chapter 5: "This is the preferred method for starting an observer." The DGMGRL -logfile option "is deprecated as of Oracle Database 12c Release 2 (12.2.0.1)".',
  },
  'OBS.SHOW_OBSERVER_FIELDS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'The SHOW OBSERVER command displays the observer name, the host name where the observer is running, whether the observer is the master observer, and the last time the observer pinged the primary and standby.',
    note: 'The 19c broker commands reference documents SHOW OBSERVER with the same example output as 26ai (Observer "name" - Master/Backup, Host Name, Last Ping to Primary, Last Ping to Target). Its example also opens with a header this prose sentence does not mention: "Configuration - DRSolution", "Primary: North_Sales", "Active Target Standby: South_Sales".',
  },
  'OBS.SET_MASTEROBSERVER': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'SET MASTEROBSERVER TO observer_name',
    note: "The Format line of the 19c command reference. 'The SET MASTEROBSERVER TO command lets you manually change which observer is recognized as the master observer.' Its Usage Notes DO document the preconditions (re-verified 2026-08-17): 'When this command is issued, the actual switch does not happen until the next time the primary contacts the target standby, usually within three seconds if fast-start failover is enabled.' and 'For the manual setting to succeed, the following conditions must be met during the next fast-start failover ping: The target standby is enabled and does not require reinstatement. There is no role change, reinstating, or fast-start failover target switch in progress'. An earlier revision of the fact sheet (D5) recorded the preconditions as undocumented; that was wrong.",
  },
  'OBS.STOP_MASTER_REFUSED': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'The STOP OBSERVER command fails if there are two or more registered observers and you attempt to stop only the master.',
    note: 'STOP OBSERVER, Usage Notes; the 26ai page (dgbkr/stop-observer.html) carries the same sentence. "Registered" is read here as every observer the configuration lists, running or not. A crashed observer host is not this command: it is how a master is lost and a backup nominated.',
  },
  'OBS.STOP_NEEDS_CONNECTION': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'If fast-start failover is enabled when you issue the STOP OBSERVER command, then the primary and standby databases must be connected and communicating with each other.',
    note: 'STOP OBSERVER, Usage Notes, which continues: "Otherwise the following error is returned: ... ORA-16636 fast-start failover target standby in error state, cannot stop observer". The 26ai page (dgbkr/stop-observer.html) carries the same text.',
  },
  'OBS.OBSERVER_ORA': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'The default value of the property ObserverConfigFile is observer.ora. You can specify an absolute path for the observer configuration file. If you specify only a file name, the default path is the DG_ADMIN directory.',
    note: "Formats on the same page: 'START OBSERVING [cfg_group_name];', 'STOP OBSERVING', 'SET MASTEROBSERVERHOSTS {FOR cfg_group_name} TO host-name;'. Configuration groups arrived in 12.2.",
  },
  'OBS.OBSERVE_ONLY': {
    url: U.bkr19Scenarios, edition: '19c', verified: 'primary',
    quote: 'Unable to failover since this observer is in observe-only mode',
    note: 'ENABLE FAST_START FAILOVER OBSERVE ONLY; the primary may open without acknowledgement and switchover or failover to a bystander stays allowed.',
  },
  'OBS.OBSERVE_ONLY_NO_ACK': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Manual failover to the fast-start failover target can be performed without receiving an acknowledgement from the observer.',
    note: 'Observe-only mode, in the fast-start failover chapter; the same sentence is on the 26ai page.',
  },
  'OBS.OBSERVE_ONLY_NO_PRECHECKS': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Manual failover can be performed even if the pre-condition checks are not met. This includes the following: broker configuration is in UNSYNC or LAGGING state or unobserved state, failover target is invalid, reinstatement is in progress, or a master observer switch is in progress.',
    note: 'Observe-only mode; the same sentences are on the 26ai page. The enabled-mode manual failover conditions (FSFO.MANUAL_FAILOVER_CONDITIONS) do not apply.',
  },
  'OBS.OBSERVE_ONLY_BYSTANDER': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'You can switch over or manual failover to a bystander database.',
    note: 'Observe-only mode; the same sentence is on the 26ai page.',
  },
  'OBS.PREFERRED_HOSTS': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'Only observers running on hosts specified in the PreferredObserverHosts will observe databases and become the master observer which will initiate a failover in case of loss of the primary database.',
    note: 'The 19c broker properties page documents the property (verified 2026-08-17, and on the 12.2 and 18c pages too): host_name:priority, priority 1 to 8, lower is higher, default 8, broker default Null, Scope Database. A change "does not affect the location of the master observer until the next role change" under 19c; 26ai (OBS.PREFERRED_HOSTS_26AI) changes the master observer automatically instead. Present since 12.2 -- never grey this control under 19c.',
  },
  'OBS.PREFERRED_HOSTS_26AI': {
    url: U.bkr26Preferred, edition: '26ai', verified: 'primary',
    quote: 'The master observer will be changed automatically to an observer running on a higher priority host.',
    note: '26ai PreferredObserverHosts property page, replacing the 19c sentence that a change does not take effect until the next role change. Scope Database, same as 19c.',
  },
  'OBS.PLACEMENT_THIRD_SITE': {
    url: U.haOptimize, edition: '19c', verified: 'primary',
    quote: 'ideally ... at a third site or third data center so that the primary, observer, and standby have isolated power, server, storage, and network infrastructure',
  },
  'OBS.PLACEMENT_APP_PATH': {
    url: U.haOptimize, edition: '19c', verified: 'primary',
    quote: 'have the observer use the same path to connect to the production database as is used by the application tier',
    note: 'With the application tier local to the production database the guide sends the observer to the standby location or a third data center instead.',
  },
  'OBS.PLACEMENT_NEVER_ON_DB_HOST': {
    url: U.haOptimize, edition: '19c', verified: 'primary',
    quote: 'the observer should never be deployed at the primary database server or cluster, or on the standby database server or cluster',
  },
  /* ---- RAC members (facts.md F1-F4, fetched 2026-09-28) ---- */
  'RAC.PRIMARY_AVAILABLE': {
    url: U.bkr19Concepts, edition: '19c', verified: 'primary',
    quote: 'From an Oracle Data Guard perspective, the primary database remains available as long as at least one instance of the clustered database continues to transport redo data to the standby databases.',
  },
  'RAC.LAST_INSTANCE_FSFO': {
    url: U.bkr19Concepts, edition: '19c', verified: 'primary',
    quote: 'If the last instance of the primary database fails, and fast-start failover is enabled, the broker can continue to provide high availability by automatically failing over to a pre-determined standby database.',
  },
  'RAC.TRANSPORT_ALL_INSTANCES': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'If this is an Oracle RAC database, all instances open in read/write mode will have redo transport services running.',
    note: 'Table 4-1, the TRANSPORT-ON state of a primary database.',
  },
  'RAC.APPLY_INSTANCE': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'If the standby database is an Oracle RAC database, the broker starts Redo Apply on exactly one standby instance, called the apply instance. If this instance fails, the broker automatically chooses another instance that is either mounted or open read-only. This new instance then becomes the apply instance.',
    note: 'Table 4-1, the APPLY-ON state of a physical standby. For a logical standby the same table says SQL Apply runs on one instance, and a failed one is replaced by another open instance.',
  },
  'RAC.APPLY_INSTANCE_FAILOVER': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'If the apply instance fails, then the broker automatically restarts SQL Apply, or the Redo Apply coordinator, as appropriate, on a different instance. This is called apply instance failover',
  },
  'RAC.APPLY_INSTANCE_SELECTION': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'if the PreferredApplyInstance property indicates an instance that is currently running, select it as the new apply instance; otherwise pick a random instance that is currently running to be the new apply instance.',
    note: 'With no preference the broker "randomly picks an apply instance" to begin with, too. Random is Oracle\'s word: a drawing that picks the first running instance is drawing its own model of it.',
  },
  'RAC.PREFERRED_APPLY_INSTANCE': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The PreferredApplyInstance configurable property indicates that a particular instance is the preferred choice for serving log apply services. It is only used when the database is a standby Oracle RAC database. The value could be an empty string (default) which means the broker chooses the apply instance.',
  },
  'RAC.APPLY_INSTANCE_TIMEOUT': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The ApplyInstanceTimeout configurable property specifies the number of seconds the broker waits after detecting the current apply instance failed before initiating the apply instance failover.',
    note: 'Broker default 0, which "results in immediate apply instance failover". How long the detection itself takes is not documented.',
  },
  'RAC.PREFERRED_FOR_SWITCHOVER': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'The broker starts log apply services on that instance if no apply instance is yet selected in the Oracle RAC standby database. This could be the case before you enable the standby database for the first time, or if the apply instance just failed and the broker is about to do an apply instance failover, or if the Oracle RAC database is currently the primary and you want to specify its apply instance in preparation for a switchover.',
    note: '"That instance" is the one PreferredApplyInstance names (Selecting the Apply Instance, the first method).',
  },
  'RAC.CLUSTERWARE_REQUIRED': {
    url: U.racIntro, edition: '19c', verified: 'primary',
    quote: 'Oracle Clusterware is a required component for using Oracle RAC that provides the infrastructure necessary to run Oracle RAC.',
  },
  'MEMBER.STATIC_SERVICE_SINGLE_INSTANCE': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'A single-instance database on which Oracle Restart is not configured must have a static service registered with the listener so that the DGMGRL CLI can automatically start the instance when necessary (for example, for the new standby after a switchover).',
    note: 'Not limited to reinstatement: a switchover needs it for the new standby too. Oracle Restart cannot be stated in a document, so the rule that uses this is an inference.',
  },
  'RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE': {
    url: U.bkr19Install, edition: '19c', verified: 'primary',
    quote: 'A static service needs to be defined and registered only if Oracle Clusterware or Oracle Restart is not being used.',
    note: 'Same page: "To enable DGMGRL to restart instances during the course of broker operations, a static service must be registered with the local listener of each instance." and "By default, the broker assumes a static service name of db_unique_name_DGMGRL.db_domain". StaticConnectIdentifier is an instance-specific property.',
  },
  'RAC.SRL_PER_THREAD': {
    url: U.sbyTransport, edition: '19c', verified: 'primary',
    quote: 'The standby redo log must have at least one more redo log group than the redo log at the redo source database, for each redo thread at the redo source database.',
    note: 'Same section: for an Oracle RAC redo source, query V$LOG for the threads "and specify the corresponding thread numbers when adding redo log groups to the standby redo log" -- ALTER DATABASE ADD STANDBY LOGFILE THREAD 1 SIZE 500M; -- and "Each standby redo log file must be at least as large as the largest redo log file in the redo log of the redo source database." racad: "Each instance must have at least two groups of redo log files."',
  },
  'RAC.SRL_SHARED': {
    url: U.sbyRac, edition: '19c', verified: 'primary',
    quote: 'The redo log files in the standby redo log must reside in a location that can be accessed by all of the standby database instances, such as on a cluster file system or Oracle ASM instance.',
  },
  'RAC.SAME_DEST_EVERY_INSTANCE': {
    url: U.sbyRac, edition: '19c', verified: 'primary',
    quote: 'Use the same LOG_ARCHIVE_DEST_n parameter on each primary database instance to send redo data to a given standby database.',
    note: 'A best practice, worded as one. The same appendix: "The thread parameters %t or %T are mandatory for Oracle RAC to uniquely identify the archived redo log files with the LOG_ARCHIVE_FORMAT parameter."',
  },
  'RAC.SPFILE_SID_PREFIX': {
    url: U.racInstances, edition: '19c', verified: 'primary',
    quote: 'The value before the period (.) in an SPFILE entry identifies the instance to which the particular parameter value belongs. When an asterisk (*) precedes the period, the value is applied to all instances that do not have a subsequent, individual value listed in the SPFILE.',
  },
  'RAC.INSTANCE_NUMBER': {
    url: U.refInstanceNumber, edition: '19c', verified: 'primary',
    quote: 'You must set this parameter for every instance, and all instances must have different values.',
    note: 'THREAD likewise must differ across instances when specified, and "has been superseded by the INSTANCE_NAME and INSTANCE_NUMBER parameters".',
  },
  'RAC.SCAN_ALIASES': {
    url: U.haDeployDg, edition: '19c', verified: 'primary',
    quote: 'For Oracle RAC configurations, the aliases should connect using the SCAN name.',
    note: 'The MAA level 1 page gives the client form: two ADDRESS_LISTs, HOST=clu_site1-scan and HOST=clu_site2-scan. The haovw pages under /19/ are maintained and updated in place, not frozen at 19c.',
  },
  'RAC.SHOW_DATABASE_INSTANCES': {
    url: U.bkr19Members, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'SHOW DATABASE lists Instance(s): with "(apply instance)" after the instance running apply on a RAC standby (south_sales1 (apply instance), south_sales2); a RAC primary lists its instances too.',
  },
  'RAC.MULTI_INSTANCE_APPLY': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'Redo Apply can run on all instances of an Oracle RAC database at the same time, but only one of the instances is the apply coordinator and that is the instance that the broker considers to be the apply instance.',
    note: 'The ApplyInstances property (0-16 or ALL, default 0: "recovery will be started in single instance mode") sets how many. C&A D.1.1: ALL "causes redo apply to run on all instances in an Oracle RAC standby database that are in an open or mounted state at the time recovery is started", and "The database chooses the instances on which to perform Redo Apply; you cannot specify particular instances." What happens when an instance other than the coordinator fails is not documented.',
  },
  'RAC.APPLY_INSTANCES_PROPERTY': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The ApplyInstances property lets you specify how many physical standby instances run Redo Apply.',
    note: 'Valid values 0 to 16 or ALL; 0 and 1 start recovery in single instance mode; >1 means no more than that many instances; ALL means every currently active instance. Broker default 0.',
  },
  'RAC.SET_APPLY_INSTANCE': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: "DGMGRL> EDIT DATABASE 'South_Sales' SET STATE='APPLY-ON' WITH APPLY INSTANCE='south_sales2';",
    note: 'Once the apply instance is selected and still running, the broker disregards a change to PreferredApplyInstance; this command is how the running apply instance is moved. SHOW DATABASE lists the instances with "(apply instance)" after the one running apply.',
  },
  'RAC.SET_APPLY_INSTANCE_IGNORED': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'If the target state is not APPLY-ON or if the database is currently in the primary role, the WITH APPLY INSTANCE clause is ignored even if it is specified.',
    note: 'EDIT DATABASE ... SET STATE, Usage Notes.',
  },
  'OBS.PLACEMENT_STANDBY_DC': {
    url: U.habpt121, edition: '12.1', verified: 'cross-edition',
    quote: 'locate the observer in the standby data center on a separate host and isolate the observer as much as possible from failures affecting the standby database',
    note: 'The third rung of the hierarchy, stated most completely in 12.1 HABPT 8.5.2.3.',
  },
  'OBS.LOSS_ALONE_STALLS_NOTHING': {
    url: U.haOptimize, edition: '19c', verified: 'primary',
    quote: 'If the primary database becomes network isolated from the standby and observer at the same time, the primary stalls (no new transactions are able to commit) until it can again make contact with either observer or standby.',
    note: 'So losing the observer alone stalls nothing.',
  },
  'OBS.CANNOT_OCCUR_LIST': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'The master observer is not running',
    note: 'One entry (the fourth of ten) in the list headed "Fast-start failover cannot occur if:"; the list opens with "Fast-start failover is no longer enabled".',
  },
  'ORA.16819': {
    url: U.ora16819, edition: '19c', verified: 'primary',
    quote: 'ORA-16819 fast-start failover observer not started Cause The observer for fast-start failover was not started. As a result, fast-start failover could not happen in the case of a primary database failure.',
    note: "Action: 'Start the fast-start failover observer by using, for example, the DGMGRL START OBSERVER command.' Enabling fast-start failover with no observer started is legal -- it is this warning, not a refusal.",
  },
  'ORA.16647': {
    url: U.ora16647, edition: '26ai', verified: 'primary',
    quote: 'For Oracle Database releases earlier than 12.2, only a single observer can be started. For Oracle Database releases 12.2 through 19c, a maximum of three observers can be started. For Oracle Database release 21c and later, a maximum of 4 observers can be started.',
    note: "The move from three to four is settled: 21c. Carried on the 26ai tab of the error-help page only -- the 21c and 19c tabs of the same page still read '12.2 and later, a maximum of three', which is itself a documentation conflict distinct from OBS.THREE_26AI_SHOW.",
  },
  'OBS.NAME_UNIQUE': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'No two observers on the same Data Guard Broker configuration can have the same name.',
  },
  'OBS.NAME_NONAME_RESERVED': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'The string "NONAME" cannot be used as an observer name.',
    note: 'The 19c fast-start failover chapter names NONAME alone; the START OBSERVER command page also reserves ALL (OBS.NAME_RESERVED_STRINGS).',
  },
  'OBS.NAME_RESERVED_STRINGS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'The strings "NONAME" and "ALL" cannot be used as an observer name.',
    note: 'START OBSERVER, Usage Notes; the 26ai START OBSERVER page (start-observer.html) says the same.',
  },

  /* ---------------- FSFO clocks and properties ---------------- */
  'FSFO.THRESHOLD': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The time interval starts when the observer first loses connection with the primary database. If the observer is unable to regain a connection to the primary database within the specified time, then the observer initiates a fast-start failover to the target standby database.',
    note: "The property table: 'Integral number of seconds. Must be greater than, or equal to, 6.'; 'Broker default 30 seconds'.",
  },
  'FSFO.BOTH_MUST_HAVE_LOST': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Fast-start failover occurs if both the observer and the target standby database lose connection to the primary database for the period of time specified by the FastStartFailoverThreshold configuration property.',
    note: "Task 4. This is ObserverOverride = FALSE, the broker default. The readiness check is the 'Fast-start failover cannot occur if:' list (OBS.CANNOT_OCCUR_LIST).",
  },
  'FSFO.OBSERVER_OVERRIDE_FALSE': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'even if the standby has a healthy connection to the primary',
    note: 'ObserverOverride defaults to FALSE; TRUE is what makes the quoted behaviour possible. The engine models the default only.',
  },
  'FSFO.PING_PROPS_21C': {
    url: U.bkr21Props, edition: '21c', verified: 'cross-edition',
    quote: 'The FastStartFailoverThreshold property is ignored when the ObserverPingRetry and ObserverPingInterval properties are set.',
    note: "The 19c properties reference does not list the two properties, so cite 21c or later. 21c broker defaults: ObserverPingInterval '100 milliseconds' (valid values >= 100), ObserverPingRetry 10 ('The minimum value of ObserverRetryCount is 10' -- sic).",
  },
  'FSFO.PING_NEARLY_ONE_SECOND': {
    url: U.bkr21Props, edition: '21c', verified: 'cross-edition',
    quote: 'can be reduced to nearly 1 second',
    note: "The only figure the documentation gives. pingInterval x (pingRetry + 1) is this page's model of that sentence, never a quoted formula.",
  },
  'FSFO.PING_DEFAULTS_26AI_ZERO': {
    url: U.bkr26PingInterval, edition: '26ai', verified: 'primary',
    quote: 'Broker default 0 milliseconds',
    note: 'The 26ai ObserverPingInterval property page; the ObserverPingRetry page likewise gives Broker default 0. Read as not set, detection governed by the threshold.',
  },
  'FSFO.PING_DEFAULTS_26AI_TABLE': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'Valid values are >= 100. Default value is 100 miliseconds.',
    note: "The Task 5 table of the 26ai fast-start failover chapter (sic 'miliseconds'); its ObserverPingRetry row reads 'Valid values are >= 10. Default value is 10 miliseconds.' Upstream contradiction with the property pages; never write \"defaults identical in 26ai\" unqualified.",
  },
  'FSFO.PING_RETRY_26AI': {
    url: U.bkr26PingRetry, edition: '26ai', verified: 'primary',
    quote: 'The minimum value of ObserverPingRetry is 10. Therefore, the detection time can be reduced to nearly 1 second.',
    note: 'The 26ai property page gives Broker default 0 (not set); the explicitly-set minimum stays 10.',
  },
  'FSFO.PING_LOW_LATENCY_ONLY': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'Setting the ObserverPingInterval and ObserverPingRetry properties must be used only in low latency environments.',
    note: 'The Note after the sentence "Set both these properties to achieve a primary failure detection time of 1 second." in the Task 5 text of the 26ai chapter; identical in the 21c chapter. The 19c chapter has neither property.',
  },
  'FSFO.LAGLIMIT_RANGES': {
    url: U.bkr26LagLimit, edition: '26ai', verified: 'primary',
    quote: 'Broker default Maximum performance mode: 30 seconds Maximum availability mode: 0 seconds',
    note: "The property table, flattened; 'Valid value Must be greater than, or equal to, 5.' Valid for the value ranges and the at-or-below-threshold recommendation only.",
    forbiddenFor: ['LAG_LIMIT_MODE'],
  },
  'FSFO.LAGLIMIT_RECOMMENDATION': {
    url: U.bkr26LagLimit, edition: '26ai', verified: 'primary',
    quote: 'It is recommended to set the FastStartFailoverLagLimit lower than or equal to FastStartFailoverThreshold',
    note: 'A larger limit lets the old primary keep committing after fast-start failover is initiated, briefly risking two primaries.',
  },
  'FSFO.LAGLIMIT_MAXAVAIL_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'Maximum availability mode Provides an automatic failover environment that is guaranteed to either lose no data (when the FastStartFailoverLagLimit configuration property is set to zero) or lose no more than the amount of data (in seconds) specified by the FastStartFailoverLagLimit configuration property.',
    note: 'The Fast-start Failover Protection Modes section, the operative section for the mode question. The 5 s minimum for a non-zero value is on the property page (FSFO.LAGLIMIT_RANGES).',
  },
  'FSFO.LAGLIMIT_STALE_TASK3': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'The FastStartFailoverLagLimit configuration property is only used by the broker when enabling fast-start failover for configurations operating in maximum performance mode.',
    note: "Task 3 of the 26ai fast-start failover chapter. STALE: it also still says maximum availability takes SYNC or FASTSYNC, against the prerequisites list's SYNC or FASTSYNC or ASYNC.",
    forbiddenFor: ['LAG_LIMIT_MODE', 'MAXAVAIL_TRANSPORTS'],
  },
  'FSFO.LAGLIMIT_ZERO_MAXAVAIL_19C': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'For zero data loss in maximum availability mode, the FastStartFailoverLagLimit property must be set to zero.',
    note: "The 19c fast-start failover chapter, against the same edition's own property page (FSFO.LAGLIMIT_MAXPERF_ONLY_19C). A live 19.27 system in MaxAvailability prints 'Lag Limit: 30 seconds (not in use)' -- an observation, not documentation, matching neither sentence outright but closer to the property page's silence on MaxAvailability. This page follows the observed behaviour: the lag limit is not evaluated in MaxAvailability under 19c. The role the property plays in MaxAvailability is a 21c feature (21c change list and 21c chapter); the per-mode default of 0 is 26ai only.",
    forbiddenFor: ['LAG_LIMIT_MODE'],
  },
  'FSFO.LAGLIMIT_MAXPERF_ONLY_19C': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'This property is used when fast-start failover is enabled and the configuration is operating in maximum performance mode.',
    note: 'The 19c FastStartFailoverLagLimit property page closing line, against the same edition\'s own fast-start failover chapter (FSFO.LAGLIMIT_ZERO_MAXAVAIL_19C). Valid value >= 5, broker default 30.',
    forbiddenFor: ['LAG_LIMIT_MODE'],
  },
  'FSFO.LAGLIMIT_STALE_PROPERTY_CLOSING_LINE': {
    url: U.bkr26LagLimit, edition: '26ai', verified: 'primary',
    quote: 'This property is used when fast-start failover is enabled and the configuration is operating in maximum performance mode.',
    note: "STALE: the property page's closing line, contradicted by the same release's Fast-start Failover Protection Modes section.",
    forbiddenFor: ['LAG_LIMIT_MODE'],
  },
  'FSFO.LAGLIMIT_DEFAULT_19C': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'Integral number of seconds. Must be greater than, or equal to, 5. Broker default 30 seconds',
    note: "The 19c FastStartFailoverLagLimit property table, flattened (Valid value / Broker default). One default for every mode -- the per-mode default is 26ai's (FSFO.LAGLIMIT_RANGES). Valid for the value and the default only, never for which modes the property applies in.",
  },
  'FSFO.LAGLIMIT_NOT_MAXPROT_26AI': {
    url: U.bkr26LagLimit, edition: '26ai', verified: 'primary',
    quote: 'The FastStartFailoverLagLimit property is not used in maximum protection mode.',
    note: 'The 26ai property page, beside the valid value. The 19c pages agree by omission: neither the property page (maximum performance) nor the fast-start failover chapter (maximum availability) gives it a maximum protection role.',
  },
  'FSFO.LAGTYPE': {
    url: U.bkr26LagType, edition: '26ai', verified: 'primary',
    quote: 'The FastStartFailoverLagType configuration property specifies the type of lag (apply lag or transport lag) the user wishes to use to specify their data loss threshold.',
    note: "Broker default APPLY; valid values 'APPLY or TRANSPORT'; 'This property is used when fast-start failover is enabled and the configuration is operating in maximum performance mode.' It did not follow the lag limit into maximum availability mode.",
  },
  'FSFO.LAGGRACETIME': {
    url: U.bkr26LagGrace, edition: '26ai', verified: 'primary',
    quote: 'If the primary has been granted permission to move to the lagging state (by the observer or target standby) before the lag limit is reached, the primary will not stall. If the lag limit is reached, the primary will stall until either permission is granted or the fast-start failover threshold (specified by the FastStartFailoverThreshold property) has expired. This property is used when fast-start failover is enabled and the configuration is operating in maximum performance mode.',
    note: "Broker default 0; 'The lowest possible value is 5 seconds. A default value of 0 indicates that no lag limit grace period is in effect.' The LAGGING permission is granted by the observer or the target standby -- never the observer alone.",
  },
  'FSFO.PMY_SHUTDOWN': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The primary database shuts down if fast-start failover is enabled and V$DATABASE.FS_FAILOVER_STATUS indicates the primary has been STALLED for longer than FastStartFailoverThreshold seconds.',
    note: 'Broker default TRUE.',
  },
  'FSFO.AUTO_REINSTATE': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If a fast-start failover was initiated because the primary database had crashed or lost connectivity with the master observer and target standby database, then the master observer automatically attempts to reinstate the former primary database as a standby database, if the FastStartFailoverAutoReinstate configuration property is set to TRUE.',
    note: "Also on the page: 'To allow the master observer to automatically reinstate the former primary database, the database must be started and mounted.'; 'For the REINSTATE command to succeed, Flashback Database must have been enabled on the database prior to the failover'; 'If you are not using Oracle Clusterware or Oracle Restart, then you must create static service names so that the observer can automatically restart a database as part of reinstatement.' The property page adds: 'The broker never automatically reinstates the former primary database if a fast-start failover was initiated because a user configuration condition was detected or was requested by an application calling the DBMS_DG.INITIATE_FS_FAILOVER function.'",
  },
  'FSFO.MANUAL_FAILOVER_CONDITIONS': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'For manual failover, the observer is started and communicating with the target standby database. You must ensure that the primary database is shut down prior to performing a manual failover.',
    note: "Performing Manual Role Changes When Fast-Start Failover Is Enabled: 'If fast-start failover is enabled you can still perform a switchover or a manual failover as long as certain conditions are met. The conditions are as follows: The role change is directed to the same standby database that was specified for the FastStartFailoverTarget database property on the primary database. The target standby database is synchronized with the primary database if it is a configuration operating in maximum availability or maximum protection mode, or the target standby database is within the lag limit if it is a configuration operating in maximum performance mode.' -- and then the quoted third condition.",
  },
  'FSFO.DISABLE_NEEDS_CONNECTIONS': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Disabling fast-start failover without the FORCE option can succeed only if the database on which the command is issued has a network connection with the primary database and if the primary database and target standby database have a network connection.',
    note: 'Disabling Fast-Start Failover, in the 19c chapter and in the 26ai fast-start failover chapter. This page\'s DISABLE FAST_START FAILOVER event names no issuing database, so the engine treats the primary as the issuer.',
  },
  'FSFO.DISABLE_FORCE_NO_PREVENT': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'Disabling fast-start failover with the FORCE option on a primary database that is disconnected from the observer and the target standby database does not prevent the observer from initiating a fast-start failover to the target standby database.',
    note: 'DISABLE FAST_START FAILOVER, Usage Notes; the 26ai page (dgbkr/disable-fast_start-failover.html) carries the same sentence.',
  },
  'FSFO.DISABLE_TWO_PRIMARIES': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'This action may result in two databases in the configuration simultaneously assuming the primary database role.',
    note: 'Disabling Fast-Start Failover: said of the FORCE option on a primary that cannot reach the observer and the target standby.',
  },
  'ORA.16827': {
    url: U.ora16827, edition: '19c', verified: 'primary',
    quote: 'ORA-16827 Flashback Database is disabled Cause The broker detected that the Flashback Database feature was disabled. With Flashback Database disabled, the broker could not reinstate a database that required reinstatement.',
    note: "Action: 'reenable Flashback Database with the ALTER DATABASE FLASHBACK DATABASE ON command.' A warning, independent of FastStartFailoverAutoReinstate: raised for Flashback Database being off on the primary or the target while fast-start failover is enabled, not only after a failover is attempted.",
  },
  'FSFO.FARSYNC_TARGET_SCENARIO7': {
    url: U.bkr19Scenarios, edition: '19c', verified: 'primary',
    quote: 'To enable fast-start failover when a far sync instance is used to ship redo data to the standby database, the FastStartFailoverTarget property must first be set on both the primary and target standby database',
    note: 'Scenario 7: Enabling Fast-Start Failover When a Far Sync Instance Is In Use.',
  },
  'MEMBER.SNAPSHOT_NO_APPLY': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'unlike a physical or logical standby database, a snapshot standby database does not apply the redo data that it receives',
  },
  'MEMBER.SNAPSHOT_NO_STATES': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'Snapshot standby databases are not listed in this table because they do not have states; they only receive redo data.',
    note: 'The table of standby database states (APPLY-ON, APPLY-OFF, ...): a snapshot standby has no apply state to start or stop.',
  },
  'MEMBER.SNAPSHOT_CONVERT_NEEDS_FLASHBACK': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'To convert a physical standby database to a snapshot standby database you must have Flashback Database enabled.',
  },
  'FSFO.SNAPSHOT_NOT_TARGET': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'A snapshot standby cannot be the target of a switchover or fast-start failover operation. You can, however, perform a manual failover to a snapshot standby.',
  },
  'SWITCHOVER.SNAPSHOT_NOT_TARGET': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'A snapshot standby database cannot be the target of a switchover or a fast-start failover.',
    note: 'CONVERT DATABASE, Usage Notes; identical on the 26ai CONVERT DATABASE page.',
  },
  'SWITCHOVER.SNAPSHOT_CONVERT_FIRST': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'You cannot perform a switchover to a snapshot standby database unless you first convert it back to a physical standby database.',
  },
  'FAILOVER.SNAPSHOT_CONVERT_APPLY': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'the broker first converts the database back to a physical standby and then starts Redo Apply to apply all the accumulated redo',
    note: 'Manual failover to a snapshot standby; the 26ai manual failover page carries the same sentence.',
  },
  'ROLES.SNAPSHOT_NO_ROLE_TRANSITION': {
    url: U.sbyRoles, edition: '19c', verified: 'primary',
    quote: 'A snapshot standby cannot be the target of a role transition.',
    note: 'Role Transitions concepts. It conflicts with the broker commands page (FAILOVER.SNAPSHOT_MANUAL_ALLOWED), which allows a manual failover to one; the documentation does not reconcile the two.',
  },
  'FAILOVER.SNAPSHOT_MANUAL_ALLOWED': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'can be the target of a manual failover if fast-start failover is disabled',
    note: 'CONVERT DATABASE, Usage Notes, the clause that follows the switchover and fast-start failover restriction (SWITCHOVER.SNAPSHOT_NOT_TARGET). It conflicts with ROLES.SNAPSHOT_NO_ROLE_TRANSITION.',
  },
  'CONVERT.SNAPSHOT_REDOROUTES_NONNULL': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'A physical standby database cannot be converted to a snapshot standby database if its RedoRoutes configurable property is set to non-NULL value.',
    note: 'CONVERT DATABASE, Usage Notes (26ai: convert-database.html). Stricter than the RedoRoutes property page, which only bars a snapshot standby that would send redo onward (ROUTES.SNAPSHOT_FORBIDDEN); Oracle does not name the difference.',
  },
  'FSFO.PRIMARY_UNOBSERVED': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'PRIMARY UNOBSERVED Displays only on the target standby database when it is SYNCHRONIZED with or is TARGET UNDER LAG LIMIT of the primary database, has connectivity to the observer, but the primary database does not have a connection to the observer.',
    note: "Table 5-1, FS_FAILOVER_STATUS Column of the V$DATABASE View. The worked example when 'the network between the primary database and the observer has failed': Primary -- FS_FAILOVER_STATUS SYNCHRONIZED, FS_FAILOVER_OBSERVER_PRESENT NO; Standby -- PRIMARY UNOBSERVED, YES.",
  },
  'FSFO.STATUS_DISABLED': {
    url: U.refVDatabase, edition: '19c', verified: 'primary',
    quote: 'If the value of this column is DISABLED, then the values for the FS_FAILOVER_CURRENT_TARGET, FS_FAILOVER_THRESHOLD, FS_FAILOVER_OBSERVER_PRESENT, and FS_FAILOVER_OBSERVER_HOST columns in this table are not meaningful.',
    note: "The FS_FAILOVER_STATUS column note; broker Table 5-1 reads 'DISABLED Fast-start failover is disabled.' No observer deployed means fast-start failover was never enabled, so the status is DISABLED -- a third state, not 'unobserved'.",
  },
  'FSFO.FS_FAILOVER_COLUMNS_DEPRECATED_26AI': {
    url: U.refVDatabase26, edition: '26ai', verified: 'primary',
    quote: 'Oracle AI Database 26ai introduces the V$FAST_START_FAILOVER_CONFIG view, which contains configuration details about Oracle Data Guard fast-start failover. As a result, the FS_FAILOVER_* columns in the V$DATABASE view are deprecated.',
    note: "Footnote on the 26ai V$DATABASE reference page. Named columns still work under 26ai; the page just points at V$FAST_START_FAILOVER_CONFIG as the current source. 19c has no such view or footnote.",
  },
  'FSFO.PRIMARY_DB_CANDIDATES': {
    url: U.bkr26Candidates, edition: '26ai', verified: 'cross-edition',
    quote: 'This property is a list of DB_UNIQUE_NAMEs of the databases to which Data Guard broker will allow switchover and failover when FSFO is disabled. Note that, when FSFO is enabled, thisproperty does not add any new restrictions since Data Guard Broker already has a property FastStartFailoverTarget that lists which databases can be new primary databases.',
    note: "Sic 'thisproperty'. Broker default: 'Thedefault value is an empty string that means no restriction.' 'If the value provided does not contain the primary database, broker will add the primary database automatically'.",
  },

  /* ---- Readiness, the stall and role changes (fact check 2026-09-28, SIM-01 to SIM-14) ---- */
  'FSFO.GUARANTEE_STALL': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Once fast-start failover is enabled, the broker will ensure that fast-start failover is only possible when the configured data loss guarantee can be upheld. If the configured data loss guarantee cannot be upheld, redo generation on the primary database will be stalled. In maximum availability and maximum performance modes, to avoid a prolonged stall, either the observer or target standby database may allow the primary database to continue redo generation after first recording that a fast-start failover cannot happen.',
    note: 'Fast-start failover overview; the same paragraph is in the 26ai chapter. When the recording lands is not stated.',
  },
  'FSFO.STATUS_STALLED': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Displays on the primary database after loss of connectivity to the target standby database and the change to the UNSYNCHRONIZED state (maximum availability mode) or to the TARGET OVER LAG LIMIT state (maximum performance mode) cannot be confirmed by either the target standby database or the observer.',
    note: "Table 5-1, FS_FAILOVER_STATUS = STALLED (26ai Table 6-2, same sentence). The same table gives UNSYNCHRONIZED, TARGET OVER LAG LIMIT and PRIMARY UNOBSERVED as states in which fast-start failover 'Is not possible'.",
  },
  'FSFO.CANNOT_NOT_SYNCHRONIZED': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If the protection mode is maximum availability or maximum protection and the target standby database was not synchronized with the primary database at the time the primary database failed',
    note: 'One entry in the list headed "Fast-start failover cannot occur if:"; identical in the 26ai chapter.',
  },
  'FSFO.CANNOT_OVER_LAG_LIMIT': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If the protection mode is maximum performance and the apply point of the target standby database lags the redo generation point of the primary database by more than the amount specified by the FastStartFailoverLagLimit configuration property at the time the primary database failed',
    note: 'One entry in the list headed "Fast-start failover cannot occur if:"; identical in the 26ai chapter.',
  },
  'FSFO.UNOBSERVED_CONTINUES': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails.',
    note: 'Identical in the 26ai chapter, which continues: "The configuration status returns the SUCCESS status after the observer reestablishes its connection to the primary database, which then notifies the target standby database."',
  },
  'OBS.OUTAGE_DIFFERENT_TIMES': {
    url: U.haOptimize, edition: '19c', verified: 'primary',
    quote: 'This is how we ensure that an observer or standby outage, or the outage of both at different times, does not impact the availability of the primary database in an FSFO configuration.',
    note: 'The sentences before it: "If both the primary and standby have lost contact with the observer they fall into an UNOBSERVED state. If the primary has lost contact with the standby it falls into an UNSYNCHRONIZED state."',
  },
  'OBS.RESTART_NEEDS_PERMISSION': {
    url: U.haOptimize, edition: '19c', verified: 'primary',
    quote: 'If the primary aborts because the FSFO threshold is exceeded, then when the primary is restarted, it must receive permission from the observer or its original standby before it is able to open. When it makes contact, it is told that either a failover occurred while it was away, and it is automatically converted into a standby database or, if no failover occurred, it is allowed to open.',
  },
  'FSFO.RESYNC_RESTORES': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'In maximum availability mode, the ability to automatically failover is restored once the target standby database has received all missing redo data.',
    note: "The paragraph continues with the lag-limit modes: 'the ability to automatically failover is restored once the target standby database's redo applied point is no longer lagging the primary database's redo generation point by more than the value specified by the FastStartFailoverLagLimit configuration property.' How long either takes is not stated.",
  },
  'FSFO.FORMER_PRIMARY_NOT_OPEN': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'To allow the master observer to automatically reinstate the former primary database, the database must be started and mounted. It will not be allowed to open in any event if fast-start failover is enabled.',
    note: 'Identical in the 26ai chapter. The error is ORA-16649.',
  },
  'FSFO.REINSTATED_IS_TARGET': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'The reinstated database acts as the fast-start failover target for the new primary database, making a subsequent fast-start failover possible.',
    note: 'Identical in the 26ai chapter.',
  },
  'REINSTATE.NEEDS_FLASHBACK': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'For the REINSTATE command to succeed, Flashback Database must have been enabled on the database prior to the failover and there must be sufficient flashback logs on that database. In addition, the database to be reinstated and the new primary database must have network connectivity.',
    note: "Also: 'Reinstatement is supported only after failover in a broker configuration. It also requires Flashback Database to be enabled on both the primary and target standby databases.'",
  },
  'FAILOVER.PRIMARY_SHUT_DOWN': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Before beginning a failover, first determine that there is no possibility of recovering the primary database in a timely manner, and ensure that the primary database is shut down.',
    note: 'Performing a Manual Failover Operation; identical on the 26ai manual failover page.',
  },
  'FAILOVER.LOSS_DEPENDS': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'There may or may not be data loss depending upon whether your primary and target standby databases were synchronized at the time of the primary database failure.',
    note: 'Manual Failover; identical on the 26ai manual failover page.',
  },
  'FAILOVER.CURRENT_TARGET_ONLY': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'The failover can only be performed to the current target standby database.',
    note: 'The note "If you perform a manual failover when fast-start failover is enabled"; identical on the 26ai manual failover page.',
  },
  'FAILOVER.NO_IMMEDIATE_WITH_FSFO': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'If fast-start failover is enabled, you can perform a complete manual failover only to the fast-start failover target standby database and only if the fast-start failover target standby database is synchronized with, or within the lag limit of, the primary database, and only when the observer is started. You cannot perform an immediate manual failover when fast-start failover is enabled.',
    note: 'FAILOVER, Usage Notes; identical on the 26ai FAILOVER page.',
  },
  'FAILOVER.WAITS_FOR_APPLY': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Waits for the target standby database to finish applying any unapplied redo data before stopping Redo Apply',
    note: 'The steps of a complete manual failover. How long the wait is depends on the redo outstanding and is environment-dependent.',
  },
  'SWITCHOVER.FSFO_TARGET_ONLY': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'If fast-start failover is enabled, you may switch over only to the fast-start failover target standby database.',
    note: 'SWITCHOVER, Usage Notes. The error is ORA-16655.',
  },
  'SWITCHOVER.FARSYNC_NO_EFFECT': {
    url: U.sbyRoles, edition: '19c', verified: 'primary',
    quote: 'If there is a far sync instance (or a combination of preferred and alternate far sync instances) connecting the primary and standby databases, then the procedure to switchover to the standby is the same as described in this topic. Whether the far sync instances are available or unavailable does not affect switchover. During switchover, the primary and standby must be able to communicate directly with each other and perform the switchover role transition steps oblivious of the far sync instances.',
  },
  'FSFO.NO_SECOND_TARGET_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'Data Guard Broker cannot failover to second fast-start failover target if both the primary and first fast-start failover targets are down.',
    note: 'Restrictions When Fast-Start Failover is Enabled. The 19c chapter does not carry the sentence and says nothing either way.',
  },
  'OBS.NOT_STARTED_16819': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'If you do not start the observer after you have enabled fast-start failover, the ORA-16819 warning is displayed for the primary and target standby databases.',
    note: 'ENABLE FAST_START FAILOVER, Usage Notes. Enabled with no observer started is a legal state, and it is unobserved, not disabled.',
  },
  'OBS.SET_MASTEROBSERVER_CONDITIONS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'When this command is issued, the actual switch does not happen until the next time the primary contacts the target standby, usually within three seconds if fast-start failover is enabled.',
    note: "SET MASTEROBSERVER TO, Usage Notes, which go on: 'For the manual setting to succeed, the following conditions must be met during the next fast-start failover ping: The target standby is enabled and does not require reinstatement. There is no role change, reinstating, or fast-start failover target switch in progress'.",
  },
  'BYSTANDERS.ALL_AHEAD_DISABLED': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'If the bystander standbys are ahead, they will be disabled with a status of ORA-16661 as part of the failover operation. The bystander standbys must be reinstated after failover completes.',
    note: "BystandersFollowRoleChange, ALL: 'During the failover process, the broker determines whether the bystander standby databases are ahead of or behind the failover target standby'. 'If the bystander standbys are behind, then the broker simply sets up the redo transport configuration from the soon-to-be-new-primary to these standbys and completes the failover process.'",
  },
  'BYSTANDERS.NONE_DISABLED': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'During the failover process, the broker does NOT evaluate the status of the bystander standbys as part of the failover operation. They are marked as disabled with a status of ORA-16661 so that they can be evaluated later.',
    note: 'BystandersFollowRoleChange, NONE.',
  },
  'MODE.AFTER_FSFO_MAXPROT': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'If fast-start failover occurs, the broker preserves the protection mode that was in effect just prior to the fast-start failover. If the protection mode was maximum protection, then the configuration protection mode is preserved, but the new primary database is set to maximum availability to allow the instance to open.',
    note: 'Identical on the 26ai protection modes page.',
  },
  'MODE.AFTER_MANUAL_MAXPROT': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If the protection mode was at maximum protection, it is reset to maximum performance.',
    note: "Performing a Manual Failover Task 3; identical on the 26ai manual failover page. With fast-start failover enabled the 19c note reads 'The broker preserves the protection mode that was in effect prior to the failover.'",
  },
  'MODE.AFTER_MANUAL_FSFO_26AI': {
    url: U.bkr26Manual, edition: '26ai', verified: 'primary',
    quote: 'The broker preserves the protection mode that was in effect prior to the failover, unless the protection mode was max protection. In this case the broker sets the protection mode to maximum availability and will later upgrade the protection mode maximum protection mode when a synchronized physical standby database is available.',
    note: 'The note "If you perform a manual failover when fast-start failover is enabled" (sic, "the protection mode maximum protection mode"). The 19c note stops after the first clause.',
  },
  'LEVEL.RESYNCHRONIZATION': {
    url: U.refVDatabase, edition: '19c', verified: 'primary',
    quote: 'RESYNCHRONIZATION - Database is running in resynchronization mode',
    note: 'V$DATABASE.PROTECTION_LEVEL lists four values -- MAXIMUM PROTECTION, MAXIMUM AVAILABILITY, RESYNCHRONIZATION, MAXIMUM PERFORMANCE. No page states when RESYNCHRONIZATION is the one shown.',
  },

  /* ---------------- Switchover ---------------- */
  'SWITCHOVER.ZERO_LOSS': {
    url: U.sbyRoles, edition: '19c', verified: 'primary',
    quote: 'Switchover Allows the primary database to switch roles with one of its standby databases. There is no data loss during a switchover.',
    note: 'The sentence is unqualified: no protection mode is named, so never qualify a switchover by mode.',
  },
  'SWITCHOVER.FSFO_GATE': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If fast-start failover is enabled, then a switchover can be performed only to the pre-specified target standby database and only if the standby database is synchronized with the primary database or is within the configured lag limit, for the max availability and max performance modes respectively.',
    note: 'Past the limit in maximum performance the command is refused -- a refused SWITCHOVER, never a forbidden failover.',
  },
  'SWITCHOVER.FORMER_PRIMARY_RESTARTS': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'The original primary database will be restarted as a part of the switchover operation. Note that the new primary database does not need to be restarted.',
    note: 'The former primary is the database that restarts, as the new standby. The sentence says only that the new primary need not be restarted; that it also does not wait for the old one is this page\'s drawing, not a sentence.',
  },
  'SWITCHOVER.SESSIONS_END': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'The original primary database will be restarted as a part of the switchover operation.',
    note: "The restart is what ends the sessions on the former primary; the pre-12c 'COMMIT TO SWITCHOVER ... WITH SESSION SHUTDOWN' syntax is no longer on the 19c pages and is not quoted. The DGMGRL SWITCHOVER command's WAIT option 'specifies that you want to wait for sessions to drain before proceeding with the switchover' (command reference). Duration is environment-dependent.",
  },
  'ROLES.DB_ROLE_CHANGE_TRIGGER': {
    url: U.sbyRoles, edition: '19c', verified: 'primary',
    quote: 'The DB_ROLE_CHANGE system event can be used to fire a trigger that performs a set of actions whenever a role transition occurs.',
    note: 'Role Transition Triggers, Data Guard Concepts and Administration. The broker chapter also names it for moving a network name to the new primary: "Create a trigger based on the DB_ROLE_CHANGE system event that changes the network address associated with the network name to the network address of the new primary database after a failover." Identical on the 26ai page.',
  },

  'SWITCHOVER.LOGICAL_DISABLES_OTHERS': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'All physical and snapshot standby databases will be disabled and must be re-created from a copy of the new primary database after a switchover to a logical standby database.',
    note: 'Identical on the 26ai SWITCHOVER page.',
  },
  'FAILOVER.LOGICAL_DISABLES_OTHERS': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'If the failover target is a logical standby database, the original primary database and all physical and snapshot standby databases in the configuration will be disabled.',
    note: 'Identical on the 26ai manual failover page.',
  },
  'SWITCHOVER.LOGICAL_MAXPROT': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Switchover to a logical standby database is disallowed when the configuration is operating in maximum protection mode.',
    note: 'Identical on the 26ai SWITCHOVER page.',
  },

  /* ---------------- Transport modes ---------------- */
  'XPT.LOGXPTMODE_VALUES': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'SYNC Configures redo transport services for this configuration member using the SYNC and AFFIRM attributes of the LOG_ARCHIVE_DEST_n initialization parameter.',
    note: "The LogXptMode row: 'ASYNC Configures redo transport services ... using the ASYNC and NOAFFIRM attributes'; 'FASTSYNC Configures redo transport services ... using the SYNC and NOAFFIRM attributes'; 'Valid values SYNC, ASYNC, or FASTSYNC'; 'Broker default ASYNC'.",
  },
  'XPT.AFFIRM_SEMANTICS': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary',
    quote: 'AFFIRM -- specifies that a redo transport destination acknowledges received redo data after writing it to the standby redo log. NOAFFIRM -- specifies that a redo transport destination acknowledges received redo data before writing it to the standby redo log.',
    note: "Also there: 'If neither the AFFIRM nor the NOAFFIRM attribute is specified, then the default is AFFIRM when the SYNC attribute is specified and NOAFFIRM when the ASYNC attribute is specified.' and 'Specification of the AFFIRM attribute without the SYNC attribute is deprecated'.",
  },
  'XPT.TABLE_4_2': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'Table 4-2 Oracle Data Guard Protection Modes and Requirements Protection Mode Redo Transport Standby Redo Log Files Needed? Usable with Fast-Start Failover? MAXPROTECTION SYNC Yes Yes MAXAVAILABILITY SYNC, FASTSYNC Yes Yes MAXPERFORMANCE ASYNC Yes Yes',
    note: 'The table flattened. ASYNC is the only mode LISTED under maximum performance -- never write that SYNC is illegal there. 26ai Table 4-2 reads the same, and 26ai LogXptMode still gives SYNC or FASTSYNC for maximum availability: ASYNC is added only by the fast-start failover prerequisites list (XPT.MAXAVAIL_ASYNC_26AI), never by this table -- the two disagree and 26ai does not name the conflict.',
  },
  'XPT.MAXAVAIL_ASYNC_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'Maximum availability -- SYNC or FASTSYNC or ASYNC',
    note: 'The LogXptMode line of the 26ai prerequisites list. Zero data loss still wants SYNC or FASTSYNC.',
  },
  'XPT.MAXAVAIL_ASYNC_21C': {
    url: U.bkr21Switch, edition: '21c', verified: 'cross-edition',
    quote: 'Maximum availability -- SYNC or FASTSYNC or ASYNC',
    note: "The LogXptMode line of the 21c fast-start failover prerequisites list, which also reads 'Maximum performance -- SYNC or FASTSYNC or ASYNC'. The 19c chapter has no ASYNC on the maximum availability line, so the line moved in 21c, not in 26ai.",
  },
  'CHANGES.NEW_BROKER_PROPERTIES_26AI': {
    url: U.bkr26Concepts, edition: '26ai', verified: 'primary',
    quote: 'New Broker properties: - FastStartFailoverLagType - FastStartFailoverLagGraceTime',
    note: "The list under 'Changes in Oracle AI Database Release 26ai for Oracle Data Guard Broker' (list flattened). PrimaryDatabaseCandidates is not on it, although it has its own 26ai property page.",
  },
  'MODE.AT_LEAST_ONE_SUPPORTS': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'At the time when you change the protection mode or reset the redo transport service of a standby database, the broker verifies that there is at least one standby database in the configuration that can support the desired grade of protection. If not, then the broker does not change the protection mode and returns an error.',
    note: 'Also on the 26ai managing-data-protection-modes page, the same sentence. A configuration-level check across every destination from the primary: an ASYNC bystander beside a SYNC standby is legal in every edition. The fast-start failover prerequisites carry a stricter, per-member requirement for the target and the primary only -- FSFO.PREREQ_TRANSPORTS_19C / FSFO.PREREQ_TRANSPORTS_26AI -- and only while fast-start failover is enabled.',
  },
  'FSFO.PREREQ_TRANSPORTS_19C': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Ensure that the standby database you choose to be the target of fast-start failover has its LogXptMode property set as follows, depending on the protection mode: Maximum protection — SYNC Maximum availability — SYNC or FASTSYNC Maximum performance — ASYNC The current primary database must have its LogXptMode property set accordingly',
    note: 'Enabling Fast-Start Failover Task 3. Scoped to the fast-start failover target standby and the primary only, never every destination in the configuration -- that is Table 4-2 and MODE.AT_LEAST_ONE_SUPPORTS.',
  },
  'MODE.UPGRADE_WITHOUT_SYNC_26AI': {
    url: U.bkr26Modes, edition: '26ai', verified: 'primary',
    quote: 'Starting with Oracle Database Release 21c, you can upgrade the protection mode to maximum availability even if the primary does not have any SYNC standbys.',
    note: 'Managing Data Protection Modes, Upgrading or Downgrading the Current Protection Mode -- a 21c change, on the 26ai page.',
  },
  'FSFO.PREREQ_TRANSPORTS_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'Ensure that the standby database you choose to be the target of fast-start failover has its LogXptMode property set as follows, depending on the protection mode: Maximum protection — SYNC Maximum availability — SYNC or FASTSYNC or ASYNC Maximum performance — ASYNC',
    note: '26ai Enabling Fast-Start Failover prerequisites. The maximum availability row adds ASYNC against 19c and against 26ai Table 4-2 itself (XPT.TABLE_4_2).',
  },
  'FSFO.TASK3_PRIMARY_XPT_19C': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'In maximum availability mode, set the LogXptMode database property for both the primary and target standby databases to SYNC or FASTSYNC. In maximum protection mode, set the LogXptMode database property to SYNC (note that in maximum protection mode, a far sync instance cannot be used to ship redo to a standby).',
    note: "Enabling Fast-Start Failover, Task 3. The primary's own LogXptMode is what it receives once it is the standby. The prerequisites list beside it: 'The current primary database must have its LogXptMode property set accordingly and must have standby redo logs configured. Alternatively, use the RedoRoutes property to configure the redo transport mode for the target standby and the database currently in the primary role.'",
  },
  'FSFO.PREREQ_PRIMARY_XPT_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'The current primary database must have its LogXptMode property set accordingly and must have standby redo logs configured.',
    note: "The 26ai Enabling Fast-Start Failover prerequisites, directly under the per-mode LogXptMode list (FSFO.PREREQ_TRANSPORTS_26AI), whose maximum availability row reads SYNC or FASTSYNC or ASYNC. Next sentence: 'If using either maximum availability or maximum performance mode, use the RedoRoutes property to configure the redo transport mode for the target standby and the database currently in the primary role.' The 26ai Task 3 still says SYNC or FASTSYNC for both databases -- stale (FSFO.LAGLIMIT_STALE_TASK3).",
  },
  'FSFO.TASK3_MAXAVAIL_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary',
    quote: 'In maximum availability mode, set the LogXptMode database property for both the primary and target standby databases to SYNC or FASTSYNC.',
    note: 'Task 3 of the 26ai Enabling Fast-Start Failover chapter: one side of a conflict with the prerequisites list beside it (FSFO.PREREQ_TRANSPORTS_26AI, XPT.MAXAVAIL_ASYNC_26AI), which adds ASYNC. Cite it as that side only, never as the rule.',
  },
  'DGMGRL.VALIDATE_NO_SUPPORTING_STANDBY': {
    url: U.bkr19Scenarios, edition: '19c', verified: 'primary',
    quote: 'Error: Switchover to this standby is not possible since there are no other standbys that can support the protection mode',
    note: "Scenario 3, Example: Validate the Physical Standby Database -- VALIDATE DATABASE 'South_Sales' in MaxAvailability, 'Ready for Switchover: No'. The standby is fine; what is missing is a database to support the protection mode once it is the primary.",
  },
  'DGMGRL.VALIDATE_FSFO_19C': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'The VALIDATE FAST_START FAILOVER command enables you to validate a fast-start failover configuration.',
    note: 'The command is in the 19c command reference, so it is not new in 26ai.',
  },
  'XPT.FASTSYNC_12_1': {
    url: U.bkr121Changes, edition: '12.1', verified: 'cross-edition',
    quote: 'A new high performance redo transport mode, FASTSYNC, supports the maximum availability data protection modes.',
    note: "The 12.1.0.1 change list, the only edition carrying the notice -- the same precedent as the 21c ObserverPing* pages. The 'maximum availability only' half is on the 19c LogXptMode row: 'This mode is only available in maximum availability protection mode.'",
  },
  'XPT.FASTSYNC_FSFO_GAP': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'Because FASTSYNC transport mode uses the NOAFFIRM attribute of the LOG_ARCHIVE_DEST_n parameter, data loss is possible. This means that a fast-start failover cannot be initiated when FASTSYNC is used and the standby is missing redo data.',
    note: 'Footnote 1 of Table 4-2 in broker chapter 4 (not the fast-start failover chapter).',
  },

  /* ---------------- Commit path ---------------- */
  'COMMIT.THIRTEEN_STEPS': {
    url: U.haRedoTuning, edition: '19c', verified: 'primary',
    quote: 'After preprocessing, if there is a SYNC standby, LGWR starts the remote write ("SYNC remote write" starts). LGWR issues local write ("log file parallel write"). If there is a SYNC standby, LGWR waits for the remote write to complete.',
    note: 'Steps 5, 6 and 7 of the thirteen-step list under Assessing Performance in a Synchronous Redo Transport Environment. The step ordering is the whole evidence for max(local, remote) -- Oracle never calls it "parallel".',
  },
  'COMMIT.AWR_TABLE_17_3_RED_FLAG': {
    url: U.haRedoTuning, edition: '19c', verified: 'primary',
    quote: "This is an immediate red flag given that the primary and standby were using the same hardware, and the SYNC remote write average time should be similar to the primary's log file parallel write average time.",
    note: "The text after Table 17-3 (log file sync 0.68 ms to 4.60 ms, TPS -20.3%): Oracle reads its own example as a misconfiguration, then moves the standby redo logs to a single member on a fast disk group, and Table 17-4 shows log file sync 0.67 ms to 1.60 ms and TPS -3.3%.",
  },
  'COMMIT.LOG_FILE_PARALLEL_WRITE_STALE': {
    url: U.haRedoTuning, edition: '19c', verified: 'primary',
    quote: 'log file parallel write',
    note: 'STALE as evidence: that wait event is about multiplexed online redo members, not about the local/remote overlap.',
    forbiddenFor: ['COMMIT_MAX_NOT_SUM'],
  },

  /* ---------------- Destination attributes ---------------- */
  'DEST.NET_TIMEOUT': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary',
    quote: 'The NET_TIMEOUT attribute specifies the number of seconds that the LGWR background process blocks waiting for a redo transport destination to acknowledge redo data sent to it. If an acknowledgement is not received within NET_TIMEOUT seconds, an error is logged and the redo transport session to that destination is terminated.',
    note: "Valid values 1 to 1200, default value 30 seconds; footnote: 'Although a minimum value of 1 second is allowed, Oracle recommends a minimum value of 8 to 10 seconds'; requires SYNC, and under ASYNC 'redo transport services ignores it; no error is returned'. This is the LOG_ARCHIVE_DEST_n attribute; the broker property of the same value is NetTimeout (BROKER.NET_TIMEOUT_PROPERTY), whose own page states a wider range. It is never a failover clock.",
  },
  'DEST.NET_TIMEOUT_ASYNC_IGNORED': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary',
    quote: 'If you specify the ASYNC attribute, redo transport services ignores it; no error is returned.',
    note: 'NET_TIMEOUT, the "Conflicts with attributes: ASYNC" row; the same row says it requires the SYNC attribute. An ASYNC destination is not given a NET_TIMEOUT wait, so a low value there is inert, not wrong.',
  },
  'BROKER.NET_TIMEOUT_PROPERTY': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The NetTimeout configurable property specifies the number of seconds the LGWR waits for Oracle Net Services to respond to a LGWR request.',
    note: "Valid values 0 to 1200, broker default 30 -- a wider floor than the NET_TIMEOUT attribute page's 1 to 1200 (DEST.NET_TIMEOUT); Oracle does not reconcile the two ranges.",
  },
  'DEST.REOPEN': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary',
    quote: 'Redo transport services attempt to reopen failed destinations at log switch time. Redo transport services check if the time of the last error plus the REOPEN interval is less than the current time. If it is, redo transport services attempt to reopen the destination. REOPEN applies to all errors, not just connection failures.',
    note: 'Valid values >=0 seconds, default value 300 seconds; broker property ReopenSecs. The meaning of 0 is not documented.',
  },
  'XPT.DATA_GUARD_SYNC_LATENCY': {
    url: U.refSyncLatency19, edition: '19c', verified: 'primary',
    quote: 'The default value is 0, which means that the LGWR will wait up to the number of seconds specified by the NET_TIMEOUT attribute of the LOG_ARCHIVE_DEST_n parameter for each SYNC standby destination.',
    note: "DATA_GUARD_SYNC_LATENCY: 'controls how many seconds the Log Writer (LGWR) process waits beyond the response of the first in a series of Oracle Data Guard SYNC redo transport mode connections.' At its default (0) a commit waits for every SYNC destination, up to NET_TIMEOUT each -- the documented default is this page's 'all' policy. A non-zero value bounds how much longer LGWR waits past the first acknowledgement before giving up on the stragglers, which is what the 'first-ack' toggle approximates; the property does not make the commit return the instant the first ack lands, only shortens how long it keeps waiting for the rest. Identical wording on the 26ai page (refSyncLatency26).",
  },
  'DEST.MAX_FAILURE': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary',
    quote: 'The MAX_FAILURE attribute controls the consecutive number of times at a log switch that redo transport services attempts to reestablish communication and transmit redo data to a failed destination before the primary database gives up on the destination.',
    note: "Also there: 'For default group destinations the default value is 0. For non-default log archive destination group destinations, the default value is 1.'; 'By default, there are an unlimited number of archival attempts'; 'Once the specified number of consecutive attempts at log switch is exceeded, the destination is treated as if the REOPEN attribute was not specified.'; 'Once the failure count for the destination reaches the specified MAX_FAILURE attribute value, the only way to reuse the destination is to set the LOG_ARCHIVE_DEST_n parameter.' Whether a successful reopen resets the counter is not documented.",
  },
  'DEST.MAXFAILURE_BROKER_PAGE_STALE': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The MaxFailure configurable property specifies the maximum number of contiguous archiving failures before the redo transport services stop trying to transport archived redo log files to the standby database.',
    note: 'NOT FOR SEMANTICS: the broker row states only the count and its default; the consecutive-at-log-switch, disabled-until-manually-reenabled and treated-as-if-REOPEN-were-not-specified semantics live on the sbydb LOG_ARCHIVE_DEST_n attributes page, so cite that page. (An earlier note here recorded the row as reading "Corresponds to: VALID_FOR"; on 2026-08-17 the 12.2, 18c, 19c, 21c and 26ai pages all read "MAX_FAILURE attribute for the LOG_ARCHIVE_DEST_n initialization parameter", so that defect is not reproducible.)',
    forbiddenFor: ['MAX_FAILURE_SEMANTICS'],
  },
  'DEST.GROUP_PRIORITY_REENTER': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary',
    quote: 'For redo destinations that use the new GROUP and PRIORITY attributes, if the error count reaches the value specified for the MAX_FAILURE attribute, then the destination enters the ERROR state where it remains until it is found to be accessible.',
    note: 'Usage Notes for MAX_FAILURE in Oracle Database 12c Release 2 (12.2). The one documented exception to the manual-reenable rule.',
  },
  'DEST.MAX_FAILURE_DISABLED_19C': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary',
    quote: 'For log archive destinations not configured as a preferred alternate, if the error count reaches the value specified for the MAX_FAILURE attribute, then the destination is disabled and there is no further access until the destination is manually reenabled.',
    note: 'Usage Notes for MAX_FAILURE in Oracle Database 12c Release 1 (12.1), which the 19c page keeps, together with the 12.2 exception for GROUP and PRIORITY destinations (DEST.GROUP_PRIORITY_REENTER).',
  },
  'DEST.MAX_FAILURE_26AI': {
    url: 'https://docs.oracle.com/en/database/oracle/oracle-database/26/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html',
    edition: '26ai', verified: 'primary',
    quote: 'If MAX_FAILURE is set to 1, no attempts are made to reactivate this archive destination when it fails. If MAX_FAILURE > 1, reactivation attempts are made until the number of consecutive failures is equal to the value of MAX_FAILURE. After this number is reached, no further attempts are made to reactivate the archive destination. If MAX_FAILURE is 0, reactivation attempts are continuous.',
    note: "Usage Notes for MAX_FAILURE, 'Standalone archive destination, with no alternate location set' -- three list items, joined here. The initial failure counts: MAX_FAILURE=1 is no retry at all, 2 is one retry. The 26ai page also says 'All archive destinations in the group must have MAX_FAILURE attribute set to a non-zero value.' The 19c page keeps the older wording (DEST.MAX_FAILURE_DISABLED_19C).",
  },
  'DEST.DEPRECATED_19C': {
    url: U.bkr19Changes, edition: '19c', verified: 'primary',
    quote: 'The following properties that are associated with database initialization parameters are deprecated in this release and may be desupported in a future release: ArchiveLagTarget, DataGuardSyncLatency, LogArchiveMaxProcesses, LogArchiveMinSucceedDest, LogArchiveTrace, StandbyFileManagement, DbFileNameConvert, LogArchiveFormat, LogFileNameConvert.',
    note: 'Neither ReopenSecs nor MaxFailure is on that list (verified 2026-08-17 against the 19c release-changes page and the 19c properties page, whose ReopenSecs and MaxFailure rows carry no deprecation note and read "Corresponds to: REOPEN / MAX_FAILURE attribute ... of the database or far sync instance that is sending redo data"). The id keeps its historical name; the fact it now carries is that the two are documented, non-deprecated broker properties whose values the broker writes into REOPEN and MAX_FAILURE, and that EDIT DATABASE ... SET PARAMETER is a second route to the same attributes.',
  },
  'DEST.RANGE_1_31': {
    url: U.refDestN, edition: '19c', verified: 'primary',
    quote: 'Destinations LOG_ARCHIVE_DEST_11 through LOG_ARCHIVE_DEST_31 do not support the SYNC, ARCH, LOCATION, MANDATORY, or ALTERNATE attributes, and cannot be specified as the target of the ALTERNATE attribute.',
    note: "The parameter is LOG_ARCHIVE_DEST_[1-31]; the sbydb attributes page: 'LOG_ARCHIVE_DEST_1 through LOG_ARCHIVE_DEST_10 destinations can contain either a LOCATION attribute or a SERVICE attribute. LOG_ARCHIVE_DEST_11 through LOG_ARCHIVE_DEST_31 destinations can only contain a SERVICE attribute.'",
  },
  'XPT.TRANSPORT_DISCONNECTED_THRESHOLD': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The TransportDisconnectedThreshold configurable property can be used to generate a warning status for a logical, physical, or snapshot standby, or a far sync instance when the last communication from the primary database exceeds the property value.',
    note: 'Never a failover clock.',
  },

  /* ---------------- Client descriptor ---------------- */
  'CLIENT.TIMEOUTS': {
    url: U.netrfTns, edition: '19c', verified: 'primary',
    quote: 'The default value is 60 sec. In case, no unit is mentioned, the default unit is sec. It accepts different timeouts with or without space between the value and the unit. TRANSPORT_CONNECT_TIMEOUT=10 ms or TRANSPORT_CONNECT_TIMEOUT=10ms The timeout interval is applicable for each ADDRESS in an ADDRESS_LIST description, and each IP address that a host name is mapped.',
    note: "CONNECT_TIMEOUT on the same page: 'The timeout interval specified by CONNECT_TIMEOUT is a superset of the TCP connect timeout interval.' -- no default value is stated for it. The HA guide's example connect string uses CONNECT_TIMEOUT=90.",
  },
  'CLIENT.RETRY_AND_FAILOVER': {
    url: U.netrfTns, edition: '19c', verified: 'primary',
    quote: 'FAILOVER ... Default on for the DESCRIPTION_LIST, DESCRIPTION, and ADDRESS_LIST parameters ... LOAD_BALANCE ... Default on under DESCRIPTION_LIST off under DESCRIPTION, ADDRESS_LIST, and ADDRESS',
    note: "RETRY_COUNT: 'To specify the number of times an ADDRESS list is traversed before the connection attempt is terminated.' -- the HA guide (oracle-net-tns-string-parameters) words it as extra traversals: 'If a connection attempt fails across all ADDRESS_LISTS, then additional attempts to connect beginning with the first ADDRESS_LIST will be made RETRY_COUNT times.' Neither page prints a default for RETRY_COUNT or RETRY_DELAY; 'no extra traversal unless set' is this page's reading.",
  },
  'CLIENT.SWITCHOVER_BUDGET_100X3': {
    url: U.haConnEstimates, edition: '19c', verified: 'primary',
    quote: 'Data Guard Switchover: RETRY_COUNT X RETRY_DELAY = 100 x 3 sec = 300 sec.',
    note: "Connection Time Estimates During Data Guard Switchover or Failover (19c HA Overview). Same page: 'Increase RETRY_COUNT if your system might take longer than 300 sec to complete a switchover or failover.'",
  },
  'CLIENT.CONNECT_TIMEOUT_VERY_GENEROUS': {
    url: U.haTns, edition: '19c', verified: 'primary',
    quote: 'The value of 90 seconds in the example connect string is very generous and might need to be shortened in some cases.',
    note: "Oracle Net TNS String Parameters (19c HA Overview), CONNECT_TIMEOUT. The same paragraph: 'Oracle recommends the value for CONNECT_TIMEOUT be large enough to account for the value of TRANSPORT_CONNECT_TIMEOUT, in addition to potential delays that may occur when connecting to busy listeners and hosts.' The broker guide says the opposite direction (CLIENT.CONNECT_TIMEOUT_SMALL_BROKER).",
  },
  'CLIENT.CONNECT_TIMEOUT_SMALL_BROKER': {
    url: U.bkr19Switch, edition: '19c', verified: 'primary',
    quote: 'Set the CONNECT_TIMEOUT parameter to a small value to minimize the delay experienced if a network address is not available.',
    note: "Configuring connect-time failover in the broker fast-start failover chapter (identical on the 21c page); its example descriptor uses (CONNECT_TIMEOUT=5). Followed by 'Increase the value of this parameter if resource contention causes connection timeouts to occur during normal operation.' Against the HA guide's 90 s (CLIENT.CONNECT_TIMEOUT_VERY_GENEROUS).",
  },
  'CLIENT.JDBC_19C': {
    url: U.jdbc19, edition: '19c', verified: 'primary',
    quote: 'The connect timeout controls how much time is allowed to connect the socket to the database. Successfully connecting the socket doesn\'t necessarily mean that the database service is up but it means that the listener is accepting connections. This value is in seconds. Default value is "0" (no timeout). This affects only the thin driver.',
    note: 'CONNECTION_PROPERTY_THIN_NET_CONNECT_TIMEOUT (oracle.net.CONNECT_TIMEOUT) on the 19c OracleConnection page; the constant-values page gives CONNECTION_PROPERTY_THIN_NET_CONNECT_TIMEOUT_DEFAULT = "0".',
  },
  'CLIENT.JDBC_CURRENT': {
    url: U.jdbc26, edition: '26ai', verified: 'primary',
    quote: 'This value is assumed in seconds if set in the URL with no explicit units and in milliseconds if set in the connection\'s properties. Starting in 23.6, the default value was changed from "0" (no timeout) to "20000" (20 seconds). This affects only the thin driver.',
    note: 'The 26ai OracleConnection page now names the release that changed the default (23.6); the 19c page does not.',
  },

  /* ---------------- Session data unit ---------------- */
  'NET.SDU_HA_MAX_65535': {
    url: U.haConfigDeploy, edition: '19c', verified: 'primary',
    quote: 'Oracle testing has shown that setting the SDU parameter to its maximum value of 65535 improves performance of synchronous transport.',
    note: "'Set SDU Size to 65535 for Synchronous Transport Only', in the HA overview's configure-and-deploy chapter. Calls 65535 the maximum value, which DEFAULT_SDU_SIZE's own range (NET.SDU_RANGE_19C) contradicts -- Oracle does not reconcile the two.",
  },
  'NET.SDU_RANGE_19C': {
    url: U.netrfSqlnet19, edition: '19c', verified: 'primary',
    quote: 'Default 8192 bytes (8 KB) Value 512 to 2097152 bytes',
    note: 'DEFAULT_SDU_SIZE on the 19c sqlnet.ora parameters page: one default (8192) for both client and server, range 512 to 2097152 bytes -- so 65535 is neither required (SYNC runs at the default) nor the ceiling (2097152 is higher), and the HA guide calling it "the maximum value" (NET.SDU_HA_MAX_65535) is the contradiction.',
  },
  'NET.DEFAULT_SDU_26AI': {
    url: U.netrfSqlnet26, edition: '26ai', verified: 'primary',
    quote: 'For clients: 8192 bytes (8 KB) For servers: 65536 bytes (64KB)',
    note: 'DEFAULT_SDU_SIZE on the 26ai sqlnet.ora parameters page splits the default by role; the 19c page (NET.SDU_RANGE_19C) gives one flat default, 8192, for both. Range unchanged: 512 to 2097152 bytes.',
  },
  'NET.SDU_SHARED_SERVER_NETAG': {
    url: U.netag19Optimize, edition: '19c', verified: 'primary',
    quote: 'The default SDU size for the client and a dedicated server is 8192 bytes. The default SDU size for a shared server is 65535 bytes.',
    note: "Configuring Session Data Unit, Net Services Administrator's Guide. The 19c Net Reference prints one default, 8192, for DEFAULT_SDU_SIZE (NET.SDU_RANGE_19C); the 26ai Net Reference splits it 8192 / 65536 (NET.DEFAULT_SDU_26AI).",
  },
  'NET.BUF_DEFAULT_LINUX_NETRF': {
    url: U.netrfTns, edition: '19c', verified: 'primary',
    quote: 'The default for the Linux 2.6 operating system is 87380 bytes.',
    note: "RECV_BUF_SIZE on the 19c Net Reference; SEND_BUF_SIZE on the same page: 'The default for the Linux 2.6 operating system is 16 KB.' Against the Net Services Administrator's Guide (NET.BUF_DEFAULT_LINUX_NETAG).",
  },
  'NET.BUF_DEFAULT_LINUX_NETAG': {
    url: U.netag19Optimize, edition: '19c', verified: 'primary',
    quote: 'The following are the defaults for the Linux operating system: - SEND_BUF_SIZE: 131,072 bytes (128k) - RECV_BUF_SIZE: 174,700 bytes',
    note: "Configuring I/O Buffer Space, Net Services Administrator's Guide (list flattened). Against the Net Reference's Linux 2.6 figures, 16 KB send and 87380 bytes receive (NET.BUF_DEFAULT_LINUX_NETRF).",
  },
  'NET.GLOBAL_DBNAME_DISABLES_FAILOVER': {
    url: U.netrfTns, edition: '19c', verified: 'primary',
    quote: 'Do not set the GLOBAL_DBNAME parameter in the SID_LIST_listener_name section of the listener.ora. A statically configured global database name disables connect-time failover.',
    note: 'The Note under the FAILOVER parameter of the Net Reference tnsnames.ora page; identical on the 26ai page. The broker still wants a static service where Clusterware or Oracle Restart is not used (RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE), which is a different listener entry from the SDU one a lesson sample shows.',
  },

  /* ---------------- Errors and limits ---------------- */
  'ORA.12514': {
    url: U.ora12514, edition: '26ai', verified: 'primary',
    quote: "The connection request received by the listener specified a service name (usually for a database service) that either has not been dynamically registered with the listener or that has not been statically configured in the listener's listener.ora configuration file.",
    note: "The Cause on the 26ai tab of the error-help page (message text in the current release: 'Cannot connect to database. Service service_name is not registered with the listener at host_port.'). The 21c and 19c tabs carry older wording: 'TNS:listener does not currently know of service requested in connect descriptor.' What a role-based service costs a client dialling the wrong database: an instant refusal, not a timeout, on either wording.",
  },
  'ORA.16529': {
    url: U.ora16529, edition: '26ai', verified: 'cross-edition',
    quote: 'ORA-16529 Switchover and failover operations are restricted to databases specified in the PrimaryDatabaseCandidates configuration property.',
    note: "Cause: 'An attempt is being made to switchover or failover to a database that is not specified in the PrimaryDatabaseCandidates configuration property.' The error-help page lists this text under Release 26ai only; the 26ai PrimaryDatabaseCandidates property page prints the same message.",
  },
  'ORA.16654': {
    url: U.ora16654, edition: '26ai', verified: 'primary',
    quote: 'ORA-16654 fast-start failover is enabled Cause The attempted command was not allowed while fast-start failover was enabled. This occurred because: The FastStartFailoverTarget property may not be modified. The LogXptMode property for either the primary database or the fast-start failover target standby database may not be modified. The protection mode of the configuration may not be modified.',
    note: "The Cause list continues with DISABLE/REMOVE of the configuration or the target, FAILOVER IMMEDIATE and DG_BROKER_START. This is the 26ai tab; the 21c and 19c tabs read 'The attempted command was not allowed while fast-start failover was enabled:' (no 'This occurred because') and \"The configuration's protection mode may not be modified\" for the third bullet -- the same three restrictions, worded slightly differently. FastStartFailoverTarget itself is refused only unless the new value still contains the current target (EDIT.FSFO_ENABLED_BLOCKS).",
  },
  'MODE.DOWNGRADE_AFTER_FSFO_MAXPROT': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'An exception to this is that a downgrade to maximum availability mode is allowed when fast-start failover has been enabled in maximum protection mode.',
    note: 'The exception to the rule that the protection mode cannot be changed while fast-start failover is enabled (ORA-16654). The 26ai managing-data-protection-modes page carries it too.',
  },
  'FSFO.DISABLE_FORCE_USE': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'Use DISABLE FAST_START FAILOVER with the FORCE option when the network between the primary and target standby databases is disconnected or when the database upon which the command is received does not have a connection with the primary database.',
    note: 'DISABLE FAST_START FAILOVER, Usage Notes. FORCE is for a disconnected network, not for a missing observer.',
  },
  'FSFO.DISABLE_STANDBY_NOT_TARGET': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'the broker allows the disable operation to proceed only if the standby database is not the target standby database for fast-start failovers.',
    note: 'The broker members page, on disabling a standby database. The start of the sentence is elided here.',
  },
  'ORA.16658': {
    url: U.ora16658, edition: '26ai', verified: 'primary',
    quote: 'ORA-16658 unobserved fast-start failover configuration Cause The fast-start failover configuration was currently unobserved and so failover was not possible.',
    note: "Raised only when a failover is attempted while unobserved -- never interchangeable with ORA-16820. Action: 'If the primary is not available and failover must be performed, then disable fast-start failover to perform a failover in the absence of the observer process.' This is the 26ai tab; the 21c and 19c tabs read 'was currently unobserved therefore failover was disallowed', same meaning.",
  },
  'ORA.16820': {
    url: U.ora16820, edition: '19c', verified: 'primary',
    quote: 'ORA-16820 fast-start failover observer is no longer observing this database Cause A previously started observer was no longer actively observing this database. A significant amount of time elapsed since this database last heard from the observer.',
    note: 'The standing health condition while unobserved.',
  },
  'ORA.16649': {
    url: U.ora16649, edition: '19c', verified: 'primary',
    quote: 'ORA-16649 Data Guard prevented this database from opening. Cause The primary database could not be opened because one of the following reasons. A fast-start failover has occurred, and there was another primary. Data Guard had detected a possible fast-start failover but could not contact the observer or target standby to verify.',
    note: 'The broker guide prints the older message text: "ORA-16649: possible failover to another database prevents this database from being opened".',
  },
  'ORA.16655': {
    url: U.ora16655, edition: '19c', verified: 'primary',
    quote: 'ORA-16655 The specified standby database is not the current fast-start failover target standby database. Cause The attempted command was not allowed because fast-start failover was enabled for this Data Guard broker configuration and the standby database specified in the command was not the current fast-start failover target standby database associated with the current primary database.',
  },
  'ORA.16661': {
    url: U.ora16661, edition: '19c', verified: 'primary',
    quote: 'ORA-16661 The standby database must be reinstated. Cause A role change operation caused this database or pluggable database to require reinstatement.',
  },
  'ORA.16867': {
    url: U.ora16867, edition: '19c', verified: 'primary',
    quote: 'ORA-16867 cannot remove a database that is specified in a FastStartFailoverTarget configuration property Cause An attempt was made to remove a database that was specified in the FastStartFailoverTarget configuration property of another database.',
  },
  'LIMIT.MEMBERS_253': {
    url: U.bkr19Configs, edition: '19c', verified: 'primary',
    quote: 'Oracle Data Guard broker enables you to create a broker configuration consisting of up to 253 members, including one primary database and a combination of standby databases, far sync instances, and Zero Data Loss Recovery Appliances.',
    note: 'Managing Oracle Data Guard Broker Configurations, restated word for word on the 26ai page at the same path. The 12.1.0.2 change note (ROUTES-adjacent history) first introduced the number; it is documented, current text in both 19c and 26ai, not doc-later.',
  },
  'LIMIT.MEMBERS_253_26AI': {
    url: U.bkr26Configs, edition: '26ai', verified: 'primary',
    quote: 'Oracle Data Guard broker enables you to create a broker configuration consisting of up to 253 members, including one primary database and a combination of standby databases, far sync instances, and Zero Data Loss Recovery Appliances.',
  },
  'CFG.DEFAULT_PROTECTION_MODE': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'The default protection mode for the configuration is MAXPERFORMANCE.',
    note: 'CREATE CONFIGURATION, Usage Notes. Oracle\'s own broker default -- never this workbench\'s own starting mode, which is a product choice (MAXAVAILABILITY) kept in a separate constant.',
  },
  'CFG.WIDE_SERVICE_NAME': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The default service name of this configuration-wide service is primarydbname_CFG, where the primary database name is appended with a suffix of _CFG. The service name does not change after a role transition.',
    note: 'Introduced in 12.2 (broker release changes) and documented on the 19c broker properties page (verified 2026-08-17).',
  },
  'CFG.WIDE_SERVICE_NAME_FORMAT': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The first character must be an alphanumeric character. There is a 30–character maximum.',
    note: 'ConfigurationWideServiceName, valid values. The 26ai property page (configurationwideservicename.html) carries the same text.',
  },

  /* ---------------- Generated scripts and mock SHOW output (SS7) ---------------- */
  'DGMGRL.BROKER_COMMANDS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'CREATE CONFIGURATION name AS PRIMARY DATABASE IS db CONNECT IDENTIFIER IS ci; ADD DATABASE db AS CONNECT IDENTIFIER IS ci; ENABLE CONFIGURATION; EDIT CONFIGURATION SET PROTECTION MODE AS mode; EDIT DATABASE db SET PROPERTY p = v; ENABLE FAST_START FAILOVER [OBSERVE ONLY]; SHOW CONFIGURATION [VERBOSE].',
    note: 'The same broker commands reference the fact sheet quotes for the far sync subset (A8); the generated script takes the rest of its syntax from it.',
  },
  'DGMGRL.SHOW_FSFO_FIELDS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'Fast-Start Failover: Enabled in Zero Data Loss Mode Protection Mode: MaxAvailability Lag Limit: 0 seconds Threshold: 180 seconds Active Target: South_Sales Potential Targets: "South_Sales" South_Sales valid Observer: (none) Shutdown Primary: TRUE Auto-reinstate: TRUE Observer Reconnect: (none) Observer Override: FALSE',
    note: "The SHOW FAST_START FAILOVER example output under ENABLE FAST_START FAILOVER, flattened. The fields are documented; the exact column headings and spacing of the mock are this page's model.",
  },
  'DEST.ATTRIBUTE_SPELLINGS': {
    url: U.sbyDestAttrs, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'LOG_ARCHIVE_DEST_n attributes are spelled SERVICE=, SYNC/ASYNC, AFFIRM/NOAFFIRM, NET_TIMEOUT=, REOPEN=, MAX_FAILURE=, ALTERNATE=, GROUP=, PRIORITY=, VALID_FOR=(...) and DB_UNIQUE_NAME=.',
    note: 'ALTERNATE, GROUP and PRIORITY belong to the parameter, never to a RedoRoutes string.',
  },

  /* ---------------- Fact check 2026-09-28: generator findings ---------------- */
  'OBS.OBSERVER_RECONNECT': {
    url: U.bkr19Props, edition: '19c', verified: 'primary',
    quote: 'The ObserverReconnect configuration property specifies how often the observer establishes a new connection to the primary database. When this property is set to the default value of 0, the observer creates and maintains a connection to the primary database, but it does not periodically create a new connection to the primary database.',
    note: 'TXT-12: this property, not ObserverConfigFile/observer.ora (OBS.OBSERVER_ORA), is what the ObserverReconnect line rests on.',
  },
  'DGMGRL.MAXPROT_STAGED': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'Upgrading from MAXPERFORMANCE to MAXPROTECTION is not allowed. You must first go to MAXAVAILABILITY and then to MAXPROTECTION.',
    note: "Usage Notes for EDIT CONFIGURATION SET PROTECTION MODE. The default protection mode for a new configuration is MAXPERFORMANCE (same page), so a document asking for MAXPROTECTION needs both steps.",
  },
  'DGMGRL.COMMENT_SYNTAX': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'Comment lines are permitted in the script, but they must be terminated with a semi-colon. For example the following comments would be allowed in a script: REM Hello World; -- Hello Again!; The double dash must be followed by a space character before the comment text.',
    note: "GEN-04: DGMGRL does have a comment syntax -- REM and -- (double dash, space, text, terminating semicolon). This is the @ (at sign) command's Usage Notes, about scripts run with @.",
  },
  'DGMGRL.FAILOVER_CONNECT_STANDBY': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'Before you issue the FAILOVER command, verify that you are connected to the standby database that will become the new primary database. If necessary, issue a CONNECT command to connect to the standby database to which you want to failover.',
    note: 'FAILOVER command Usage Notes. GEN-05: this is why FAILOVER TO never belongs in the build script as an executable line -- it runs from a session connected to the target, after the primary has actually failed.',
  },
  'DEST.BROKER_OWNED_PROPERTIES': {
    url: U.bkr19Members, edition: '19c', verified: 'primary',
    quote: 'The properties used are: Binding, MaxFailure, NetTimeout, RedoCompression, and ReopenSecs. These properties correspond to attributes on the LOG_ARCHIVE_DEST_n initialization parameter.',
    note: "GEN-06: 'Other Redo Transport Settings', Managing the Members of a Broker Configuration. The broker owns these; EDIT DATABASE ... SET PROPERTY is how a script sets them, not a hand-edited init.ora line.",
  },
  'ROUTES.ALT_BACKWARDS_COMPAT': {
    url: U.sbyAlternate19, edition: '19c', verified: 'primary',
    quote: 'As of Oracle Database 12c Release 2 (12.2), the preferred method for creating alternate log archive destinations for remote standby databases and far sync instances that take over if the active destination fails is to use the GROUP and PRIORITY attributes. ... use of the ALTERNATE attribute for remote log archive destinations (SERVICE=...) is maintained only for backwards compatibility.',
    note: 'GEN-07: local LOCATION= destinations still use ALTERNATE for high availability; only the SERVICE= (remote) case is superseded by GROUP/PRIORITY.',
  },
  'DEST.ALTERNATE_STATE_EXAMPLE': {
    url: U.sbyAlternate19, edition: '19c', verified: 'primary', paraphrase: true,
    quote: "H.1 Configuring an Alternate Destination sets LOG_ARCHIVE_DEST_STATE_2='ENABLE' beside LOG_ARCHIVE_DEST_2 (the main destination, ALTERNATE=LOG_ARCHIVE_DEST_3) and LOG_ARCHIVE_DEST_STATE_3='ALTERNATE' beside LOG_ARCHIVE_DEST_3 (the alternate, ALTERNATE=LOG_ARCHIVE_DEST_2).",
    note: "GEN-07: marked paraphrase because this restates the worked example's two LOG_ARCHIVE_DEST_STATE_n lines rather than quoting the whole code block verbatim (TXT-13).",
  },
  'OBS.PREFERRED_HOSTS_EXAMPLE_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary', paraphrase: true,
    quote: "Specifying Preferred Observers Based on Current Primary: EDIT DATABASE North_Sales SET PROPERTY PreferredObserverHosts='ob1-host:1,ob2-host:2'; EDIT DATABASE South_Sales SET PROPERTY PreferredObserverHosts='ob3-host:1,ob4-host:2';",
    note: "ED-05: the page's own example has mismatched quoting (a stray double quote before the opening single quote); this catalogue entry straightens it, since the generated script must emit valid DGMGRL. Sets PreferredObserverHosts on whichever database is named -- both the current primary and whichever standby might become primary, exactly as North_Sales and South_Sales both get their own EDIT DATABASE line here.",
  },
  'FSFO.FS_FAILOVER_CONFIG_26AI': {
    url: U.refVDatabase26, edition: '26ai', verified: 'primary',
    quote: 'the FS_FAILOVER_* columns in the V$DATABASE view are deprecated. Instead, use the corresponding columns in V$FAST_START_FAILOVER_CONFIG.',
    note: 'ED-06: V$DATABASE.FS_FAILOVER_STATUS etc. stay correct for 19c; a 26ai document should name V$FAST_START_FAILOVER_CONFIG instead.',
  },
  'CLIENT.JDBC_RETRY_DELAY_26AI': {
    url: U.jdbc26Urls, edition: '26ai', verified: 'primary',
    quote: 'The RETRY_DELAY connection attribute specifies the delay between connection retries in seconds by default. Starting from Oracle AI Database Release 26ai, the default value of this parameter is 1 second.',
    note: 'ED-06: earlier drivers default RETRY_DELAY to no delay; 26ai changes the default to 1 second, so a 26ai URL with RETRY_DELAY=0 is a value the operator chose, not the driver default, and is worth spelling out.',
  },
  'FSFO.STATUS_WORDS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'Fast-Start Failover: Enabled in Zero Data Loss Mode / Fast-Start Failover: Enabled in Potential Data Loss Mode / Fast-Start Failover: Enabled in Observe-Only Mode / Fast-Start Failover: DISABLED',
    note: "GEN-09: four spellings spliced from separate examples on the same page (ENABLE FAST_START FAILOVER Example 1, VALIDATE FAST_START FAILOVER's MaxPerformance example, the observe-only scenario, and the plain SHOW CONFIGURATION examples). DISABLED is the only one printed in capitals.",
  },
  'DGMGRL.SHOW_FSFO_CONDITIONS': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'Configurable Failover Conditions Health Conditions: Corrupted Controlfile YES Corrupted Dictionary YES Inaccessible Logfile NO Stuck Archiver NO Datafile Write Errors YES Oracle Error Conditions: (none)',
    note: 'GEN-11: the closing block of SHOW FAST_START FAILOVER Example 2, flattened. These are the broker default health conditions; the engine does not model ENABLE/DISABLE FAST_START FAILOVER CONDITION, so the mock always shows the defaults.',
  },
  'DGMGRL.SHOW_FSFO_FIELDS_26AI': {
    url: U.bkr26Fsfo, edition: '26ai', verified: 'primary', paraphrase: true,
    quote: 'Fast-Start Failover: Enabled in Zero Data Loss Mode Protection Mode: MaxAvailability Lag Limit: 0 seconds Threshold: 30 seconds Ping Interval: 3000 milliseconds Ping Retry: 0 Active Target: South_Sales Potential Targets: "South_Sales" South_Sales valid Observer: observer1 Shutdown Primary: TRUE Auto-reinstate: TRUE Observer Reconnect: (none) Observer Override: FALSE',
    note: "ED-06: the 26ai fast-start failover chapter's own SHOW FAST_START FAILOVER example, flattened; it adds Ping Interval and Ping Retry between Threshold and Active Target and otherwise matches the 19c example (DGMGRL.SHOW_FSFO_FIELDS).",
  },
  'DGMGRL.MEMBERS_NOT_RECEIVING_REDO': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary', paraphrase: true,
    quote: 'SHOW CONFIGURATION: North_Sales - Primary database / North_FS - Far Sync / South_Sales - Physical standby database / Members Not Receiving Redo: / South_FS - Far Sync',
    note: "GEN-12: from the role-change example (South_Sales becomes primary, so North_FS no longer receives redo while South_FS does). The heading's exact spelling is 'Members Not Receiving Redo:'.",
  },
  'DGMGRL.VERBOSE_TARGET_MARKER': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary', paraphrase: true,
    quote: "SHOW CONFIGURATION VERBOSE: South_Sales- (*) Physical standby database / (*) Fast-Start Failover target",
    note: 'GEN-12: Example 2, the fast-start failover target line in VERBOSE output. The legend line follows immediately under the marked member.',
  },
  'DGMGRL.FARSYNC_LINE_DOCUMENTED': {
    url: U.bkr19Cmds, edition: '19c', verified: 'primary',
    quote: 'FS- Far sync instance',
    note: "GEN-13: from the same VERBOSE example as DGMGRL.VERBOSE_TARGET_MARKER ('North_Sales - Primary database / FS- Far sync instance / South_Sales- (*) Physical standby database'); the far sync role word is documented, not this page's model.",
  },
} as const satisfies Record<string, Citation>;

export type CitationId = Extract<keyof typeof CITATIONS, string>;

export const CITATION_IDS = Object.keys(CITATIONS) as CitationId[];

export function citation(id: CitationId): Citation {
  const c: Citation | undefined = CITATIONS[id];
  if (!c) throw new Error(`unknown citation id: ${String(id)}`);
  return c;
}

export const isCitationId = (v: unknown): v is CitationId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(CITATIONS, v);

/**
 * Guard used wherever the engine states one of the facts AGENTS.md fences:
 * throws if a caller tried to support it with a source the rules forbid.
 */
export function assertCitesAllowed(fact: ForbiddenFact, cites: readonly CitationId[]): void {
  for (const id of cites) {
    const c = citation(id);
    if (c.forbiddenFor?.includes(fact)) {
      throw new Error(
        `citation ${id} is forbidden for ${fact}: ${c.note ?? 'see AGENTS.md accuracy rules'}`,
      );
    }
  }
}
