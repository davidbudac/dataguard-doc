/**
 * Observer rules -- how many, where, which one is master, and the two
 * assumptions this engine states rather than models.
 *
 * Two distinctions the wording has to keep: no observer deployed is not the
 * same as unobserved, and the primary's site is not on the documented
 * placement hierarchy at all.
 */

import type { Edition } from '../../ids';
import type { Finding } from '../../types/claims';
import type { DatabaseMember } from '../../types/topology';
import { isDatabase, isRac } from '../../types/topology';
import type { Rule } from '../context';
import { configSubject, mk, q } from '../context';

const observerLimit = (e: Edition): number => (e === '26ai' ? 4 : 3);

/**
 * 19c registers "up to three observers ... One is the master observer and the
 * others are backup observers". The 26ai fast-start failover chapter says
 * four while the 26ai SHOW OBSERVER page still says three -- carried as a
 * conflict, not resolved.
 */
export const observerCount: Rule = (ctx): Finding[] => {
  const edition = ctx.doc.config.edition;
  const limit = observerLimit(edition);
  const n = ctx.doc.observers.length;
  if (n <= limit) return [];
  return [mk('OBS.COUNT', {
    subject: configSubject(),
    message: `${n} observers are deployed. ${edition === '26ai' ? 'The 26ai fast-start failover chapter registers up to four observers' : '19c registers up to three observers'}, one of them the master observer and the others backup observers.`,
    cite: ['OBS.THREE_19C', 'OBS.FOUR_26AI', 'OBS.THREE_26AI_SHOW'],
    note: 'The number is edition-specific and 26ai disagrees with itself: its fast-start failover chapter says four, its SHOW OBSERVER page still says three, and which release moved three to four is unsettled. This engine reads four for 26ai and three for 19c, and never carries one edition\'s number across to the other.',
  })];
};

/** The observer is never deployed at the primary or standby database server. */
export const observerOnDatabaseHost: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const o of ctx.doc.observers) {
    if (!ctx.dbHosts.has(o.host)) continue;
    out.push(mk('OBS.ON_DB_HOST', {
      subject: { kind: 'observer', id: o.id as string },
      message: `The observer ${q(o.name)} runs on ${q(o.host as string)}, a host of a database in this configuration. The observer should never be deployed at the primary database server or cluster, or on the standby database server or cluster.`,
      cite: ['OBS.PLACEMENT_NEVER_ON_DB_HOST'],
    }));
  }
  return out;
};

/** Nor on the cluster: a RAC node beside the database is the same failure domain. */
export const observerOnDatabaseCluster: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const o of ctx.doc.observers) {
    if (ctx.dbHosts.has(o.host)) continue;
    const host = ctx.doc.hosts.find((h) => h.id === o.host);
    const cluster = host?.cluster;
    if (cluster === undefined || !ctx.dbClusters.has(cluster)) continue;
    out.push(mk('RAC.OBSERVER_ON_CLUSTER', {
      subject: { kind: 'observer', id: o.id as string },
      message: `The observer ${q(o.name)} runs on ${q(o.host as string)}, a node of cluster ${q(cluster)}, which also runs a database of this configuration. The observer should never be deployed at the primary database server or cluster, or on the standby database server or cluster.`,
      cite: ['OBS.PLACEMENT_NEVER_ON_DB_HOST'],
    }));
  }
  return out;
};

/** The primary's site is not on the documented placement hierarchy. */
export const observerInPrimarySite: Rule = (ctx): Finding[] => {
  const primary = ctx.primary;
  if (!primary) return [];
  const primarySites = new Set(primary.instances.map((i) => ctx.siteOf(i.host)));
  const out: Finding[] = [];
  for (const o of ctx.doc.observers) {
    const site = ctx.siteOf(o.host);
    if (site === undefined || !primarySites.has(site)) continue;
    out.push(mk('OBS.PRIMARY_SITE', {
      subject: { kind: 'observer', id: o.id as string },
      message: `The observer ${q(o.name)} runs in ${q(site as string)}, the primary's site. The documented hierarchy has three rungs: a third site or third data center first, so that the primary, observer, and standby have isolated power, server, storage, and network infrastructure; failing that, wherever the observer uses the same path to connect to the production database as is used by the application tier; failing that, the standby's data center on a separate host. The primary's site is on none of them -- a site failure takes the observer with the primary, and an observer on one side of a cut cannot arbitrate it. It is defensible only where the application tier is local to the primary.`,
      cite: ['OBS.PLACEMENT_THIRD_SITE', 'OBS.PLACEMENT_APP_PATH', 'OBS.PLACEMENT_STANDBY_DC'],
    }));
  }
  return out;
};

/**
 * No observer deployed is a third state, not "unobserved".
 *
 * And where the document says fast-start failover is enabled while carrying no
 * observer at all, it is saying two things that cannot both be true: nothing
 * arms fast-start failover but an observer, so the run reads the document as
 * not armed -- FS_FAILOVER_STATUS = DISABLED -- and says so here rather than
 * drawing clocks the deployment would never start.
 */
export const noObserverDeployed: Rule = (ctx): Finding[] => {
  if (ctx.doc.observers.length > 0) return [];
  const claimsEnabled = ctx.doc.config.fsfo.state !== 'disabled';
  const base = 'No observer is deployed. That is not the same as being unobserved: V$DATABASE.FS_FAILOVER_STATUS reads DISABLED, the FastStartFailover* properties can be set and nothing arms them, and a manual FAILOVER TO is the only thing that promotes a standby. Unobserved means fast-start failover is enabled and the master observer is missing -- PRIMARY UNOBSERVED on the target standby, ORA-16820 as the standing health condition, and "The master observer is not running" among the documented reasons fast-start failover cannot occur. One corollary: the maximum performance switchover refusal past FastStartFailoverLagLimit is fast-start failover\'s own gate, so it cannot fire with no observer deployed.';
  const inconsistent = ` This document also carries fsfo.state = ${ctx.doc.config.fsfo.state}, which no observer can be running to serve: the simulation reads the configuration as not armed -- FS_FAILOVER_STATUS = DISABLED -- so no fast-start failover clock starts, no readiness check gates anything and no command is refused on fast-start failover's behalf. Deploy an observer, or set the state to disabled, so that the document says one thing.`;
  return [mk('OBS.NONE_DEPLOYED', {
    subject: configSubject(),
    ...(claimsEnabled ? { severity: 'warning' as const } : {}),
    message: claimsEnabled ? base + inconsistent : base,
    cite: ['FSFO.STATUS_DISABLED', 'FSFO.PRIMARY_UNOBSERVED', 'OBS.CANNOT_OCCUR_LIST'],
  })];
};

/** One master observer; only the master coordinates fast-start failover. */
export const masterObserverUnique: Rule = (ctx): Finding[] => {
  const masters = ctx.doc.observers.filter((o) => o.role === 'master');
  if (masters.length <= 1) return [];
  return [mk('OBS.MASTER_UNIQUE', {
    subject: configSubject(),
    message: `${masters.length} observers are marked master (${masters.map((o) => q(o.name)).join(', ')}). One observer is the master observer and the others are backup observers; only the master observer can coordinate fast-start failover. Use SET MASTEROBSERVER TO name; to move the role.`,
    cite: ['OBS.THREE_19C', 'OBS.MASTER_ONLY_COORDINATES', 'OBS.SET_MASTEROBSERVER'],
  })];
};

/** PreferredObserverHosts fences which hosts may observe at all. */
export const preferredObserverHosts: Rule = (ctx): Finding[] => {
  const list = ctx.doc.config.fsfo.preferredObserverHosts ?? [];
  if (list.length === 0) return [];
  const allowed = new Set(list.map((p) => p.host));
  const excluded = ctx.doc.observers.filter((o) => !allowed.has(o.host));
  if (excluded.length === 0) return [];
  return [mk('OBS.PREFERRED_HOSTS', {
    subject: configSubject(),
    message: `PreferredObserverHosts does not name ${excluded.map((o) => q(o.host as string)).join(', ')}, where ${excluded.map((o) => q(o.name)).join(', ')} ${excluded.length === 1 ? 'runs' : 'run'}. Only observers running on hosts specified in the property will observe databases and become the master observer; the priority runs 1 to 8, lower wins, and the default is 8.`,
    cite: ['OBS.PREFERRED_HOSTS'],
    note: 'PreferredObserverHosts is documented on the 19c broker properties page and again on the 26ai property page; a change to it does not affect the location of the master observer until the next role change.',
  })];
};

/**
 * FastStartFailoverAutoReinstate is narrower than "the old primary returns",
 * and its preconditions are properties of the databases rather than of the
 * failover.
 */
export const reinstatePreconditions: Rule = (ctx): Finding[] => {
  if (!ctx.doc.config.fsfo.autoReinstate) return [];
  const primary = ctx.primary;
  const involved = [primary, ...ctx.candidates.map((id) => ctx.member(id))]
    .filter((m): m is DatabaseMember => !!m && isDatabase(m));
  /* "If you are not using Oracle Clusterware or Oracle Restart, then you must
     create static service names" -- a RAC database runs under Clusterware. */
  const needsStatic = (m: DatabaseMember): boolean => !m.staticServices && !isRac(m);
  const missing = involved.filter((m) => !m.flashbackOn || needsStatic(m));
  if (missing.length === 0) return [];
  const detail = missing.map((m) => {
    const gaps = [
      m.flashbackOn ? null : 'Flashback Database is off',
      needsStatic(m) ? 'no static service name is registered' : null,
    ].filter((s): s is string => s !== null).join(' and ');
    return `${q(m.name)} (${gaps})`;
  }).join(', ');
  return [mk('REINSTATE.PRECONDITIONS', {
    subject: configSubject(),
    message: `FastStartFailoverAutoReinstate is TRUE but ${detail}. Automatic reinstatement needs Flashback Database on both databases, the former primary started and mounted -- a manual restart where FastStartFailoverPmyShutdown aborted it -- the master observer able to reach it, and static service names without Clusterware or Oracle Restart. It reinstates only after an observer-initiated failover caused by a primary crash or isolation, never after a user-configurable health condition or a DBMS_DG.INITIATE_FS_FAILOVER call.`,
    cite: ['FSFO.AUTO_REINSTATE', 'FSFO.PMY_SHUTDOWN', 'RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE', 'RAC.CLUSTERWARE_REQUIRED'],
  })];
};

/** The assumption every outcome in this engine rests on. */
export const observerOverrideAssumption: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  return [mk('MODEL.OBSERVER_OVERRIDE', {
    subject: configSubject(),
    message: 'This configuration is drawn with ObserverOverride at FALSE, the broker default: fast-start failover needs both the observer and the target standby to have lost the primary for the threshold.',
    cite: ['FSFO.OBSERVER_OVERRIDE_FALSE', 'FSFO.BOTH_MUST_HAVE_LOST'],
    note: 'The engine models the default only. With ObserverOverride TRUE an automatic failover may occur when the observer has lost connectivity to the primary "even if the standby has a healthy connection to the primary", and several of the outcomes drawn here as continues would become failovers. The standby\'s veto is never unconditional.',
  })];
};

export const observerRules: Rule[] = [
  observerCount, observerOnDatabaseHost, observerOnDatabaseCluster, observerInPrimarySite,
  noObserverDeployed, masterObserverUnique, preferredObserverHosts, reinstatePreconditions,
  observerOverrideAssumption,
];
