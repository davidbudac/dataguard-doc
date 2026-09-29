/**
 * Observer rules -- how many, where, which one is master, and the two
 * assumptions the engine states rather than models.
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
  const is26 = edition === '26ai';
  return [mk('OBS.COUNT', {
    subject: configSubject(),
    message: `${n} observers are deployed, but ${is26 ? 'the 26ai fast-start failover chapter registers up to four observers' : '19c registers up to three observers'}: one master observer and the rest backup observers.`,
    cite: is26 ? ['OBS.FOUR_26AI', 'OBS.THREE_26AI_SHOW'] : ['OBS.THREE_19C', 'ORA.16647'],
    note: is26
      ? 'The 26ai fast-start failover chapter says four, matching the settled 21c-and-later limit (ORA-16647); its own SHOW OBSERVER page still says three. That is a 26ai self-contradiction, which the workbench names rather than resolves.'
      : 'The 19c fast-start failover chapter says three; the 19c command reference\'s START OBSERVER section and ORA-16647 both say four, a 19c self-contradiction. The move to four is settled at 21c (ORA-16647: "For Oracle Database releases 12.2 through 19c, a maximum of three observers can be started. For Oracle Database release 21c and later, a maximum of 4 observers can be started."). The workbench reads three for 19c, the fast-start failover chapter\'s number.',
  })];
};

/** The observer is never deployed at the primary or standby database server. */
export const observerOnDatabaseHost: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const o of ctx.doc.observers) {
    if (!ctx.dbHosts.has(o.host)) continue;
    out.push(mk('OBS.ON_DB_HOST', {
      subject: { kind: 'observer', id: o.id as string },
      message: `The observer ${q(o.name)} runs on ${q(o.host as string)}, which also hosts a database of this configuration. The observer should never be deployed at the primary database server or cluster, or on the standby database server or cluster.`,
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
      message: `The observer ${q(o.name)} runs on ${q(o.host as string)}, a node of the cluster ${q(cluster)}, which also runs a database of this configuration. The observer should never be deployed at the primary database server or cluster, or on the standby database server or cluster.`,
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
      message: `The observer ${q(o.name)} runs in ${q(site as string)}, the primary's site. The documented placement hierarchy has three rungs, and the primary's site is on none of them. First, a third site or third data center, so that the primary, observer, and standby have isolated power, server, storage, and network infrastructure. Failing that, wherever the observer uses the same path to connect to the production database as is used by the application tier; the guide's own caveat is that when the application tier is local to the production database, the observer belongs at either the standby location or a third data center instead. Failing that, the standby's data center on a separate host. A site failure takes the observer down with the primary, and an observer on one side of a network cut cannot arbitrate it.`,
      cite: ['OBS.PLACEMENT_THIRD_SITE', 'OBS.PLACEMENT_APP_PATH', 'OBS.PLACEMENT_STANDBY_DC'],
      basis: 'inferred',
      note: 'A deduction from the three documented rungs read together, not a sentence that names the primary\'s site: none of the three rungs is the primary\'s own site, in any circumstance the guide describes.',
    }));
  }
  return out;
};

/**
 * No observer deployed is a third state, not "unobserved" -- and legal:
 * "If you do not start the observer after you have enabled fast-start
 * failover, the ORA-16819 warning is displayed for the primary and target
 * standby databases." Enabling fast-start failover with no observer running
 * is a documented, supported configuration; it just cannot fail over.
 */
export const noObserverDeployed: Rule = (ctx): Finding[] => {
  if (ctx.doc.observers.length > 0) return [];
  const claimsEnabled = ctx.doc.config.fsfo.state !== 'disabled';
  const base = 'No observer is deployed. That is not the same as being unobserved. V$DATABASE.FS_FAILOVER_STATUS reads DISABLED, the FastStartFailover* properties can be set but nothing arms them, and a manual FAILOVER TO is the only thing that promotes a standby. Unobserved means fast-start failover is enabled and the master observer is missing: PRIMARY UNOBSERVED on the target standby, ORA-16820 as the standing health condition, and "The master observer is not running" among the documented reasons fast-start failover cannot occur. Corollary: the maximum performance switchover refusal past FastStartFailoverLagLimit is fast-start failover\'s own gate, so it cannot fire with no observer deployed.';
  const enabled = ` This document also carries fsfo.state = ${ctx.doc.config.fsfo.state}. That is legal: enabling fast-start failover with no observer started is a documented, supported configuration. The broker displays ORA-16819 (fast-start failover observer not started) for the primary and target standby databases, and fast-start failover could not happen in the case of a primary database failure. The configuration is unobserved and no failover can happen until an observer is started.`;
  return [mk('OBS.NONE_DEPLOYED', {
    subject: configSubject(),
    ...(claimsEnabled ? { severity: 'warning' as const } : {}),
    message: claimsEnabled ? base + enabled : base,
    cite: claimsEnabled
      ? ['FSFO.STATUS_DISABLED', 'FSFO.PRIMARY_UNOBSERVED', 'OBS.CANNOT_OCCUR_LIST', 'ORA.16819']
      : ['FSFO.STATUS_DISABLED', 'FSFO.PRIMARY_UNOBSERVED', 'OBS.CANNOT_OCCUR_LIST'],
    ...(claimsEnabled ? { ora: 'ORA-16819' } : {}),
  })];
};

/**
 * "No two observers on the same Data Guard Broker configuration can have the
 * same name." "The string \"NONAME\" cannot be used as an observer name."
 * Observer names are case-insensitive.
 */
export const observerNamesReserved: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  const seen = new Map<string, string>();
  for (const o of ctx.doc.observers) {
    const name = o.name;
    const lower = name.toLowerCase();
    if (lower === 'noname') {
      out.push(mk('OBS.NAME_RESERVED', {
        subject: { kind: 'observer', id: o.id as string },
        message: `The observer named ${q(name)} uses the reserved name. The string "NONAME" cannot be used as an observer name.`,
        cite: ['OBS.NAME_NONAME_RESERVED'],
      }));
    }
    const dup = seen.get(lower);
    if (dup !== undefined) {
      out.push(mk('OBS.NAME_RESERVED', {
        subject: { kind: 'observer', id: o.id as string },
        message: `The observers ${q(name)} and ${q(dup)} have the same name. No two observers on the same Data Guard broker configuration can have the same name, and observer names are case-insensitive.`,
        cite: ['OBS.NAME_UNIQUE'],
      }));
    } else {
      seen.set(lower, name);
    }
  }
  return out;
};

/** One master observer; only the master coordinates fast-start failover. */
export const masterObserverUnique: Rule = (ctx): Finding[] => {
  const masters = ctx.doc.observers.filter((o) => o.role === 'master');
  if (masters.length <= 1) return [];
  return [mk('OBS.MASTER_UNIQUE', {
    subject: configSubject(),
    message: `${masters.length} observers are marked master (${masters.map((o) => q(o.name)).join(', ')}). One observer is the master observer and the others are backup observers, and only the master observer can coordinate fast-start failover. To move the role, run SET MASTEROBSERVER TO name;`,
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
  const is26 = ctx.doc.config.edition === '26ai';
  return [mk('OBS.PREFERRED_HOSTS', {
    subject: configSubject(),
    message: `PreferredObserverHosts does not name ${excluded.map((o) => q(o.host as string)).join(', ')}, where ${excluded.map((o) => q(o.name)).join(', ')} ${excluded.length === 1 ? 'runs' : 'run'}. Only observers running on hosts specified in the property will observe databases and become the master observer. Priority runs from 1 to 8, lower wins, and the default is 8. The property scope is Database in both editions.`,
    cite: is26 ? ['OBS.PREFERRED_HOSTS', 'OBS.PREFERRED_HOSTS_26AI'] : ['OBS.PREFERRED_HOSTS'],
    note: is26
      ? 'Documented since 12.2 (present on the 12.2, 18c and 19c property pages too, and in a live 19.27 system, so the workbench does not disable this control under 19c). Under 26ai the master observer changes automatically to an observer running on a higher priority host.'
      : 'Documented since 12.2 (present on the 12.2 and 18c property pages too, and in a live 19.27 system, so the workbench does not disable this control under 19c). Under 19c a change to it does not affect the location of the master observer until the next role change; 26ai changes it automatically instead.',
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
    message: `FastStartFailoverAutoReinstate is TRUE, but ${detail}. Automatic reinstatement needs Flashback Database on both databases, the former primary started and mounted (a manual restart where FastStartFailoverPmyShutdown aborted it), the master observer able to reach it, and static service names without Clusterware or Oracle Restart. It reinstates only after an observer-initiated failover caused by a primary crash or isolation, never after a user-configurable health condition or a DBMS_DG.INITIATE_FS_FAILOVER call.`,
    cite: ['FSFO.AUTO_REINSTATE', 'FSFO.PMY_SHUTDOWN', 'RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE', 'RAC.CLUSTERWARE_REQUIRED'],
  })];
};

/** The assumption every outcome in the engine rests on. */
export const observerOverrideAssumption: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  return [mk('MODEL.OBSERVER_OVERRIDE', {
    subject: configSubject(),
    message: 'ObserverOverride is assumed to be FALSE, the broker default. With it, fast-start failover needs both the observer and the target standby to have lost the primary for the threshold.',
    cite: ['FSFO.OBSERVER_OVERRIDE_FALSE', 'FSFO.BOTH_MUST_HAVE_LOST'],
    note: 'The workbench models the default only. With ObserverOverride TRUE an automatic failover may occur when the observer has lost connectivity to the primary "even if the standby has a healthy connection to the primary", and several outcomes shown here as continues would become failovers. The standby\'s veto is never unconditional.',
  })];
};

export const observerRules: Rule[] = [
  observerCount, observerOnDatabaseHost, observerOnDatabaseCluster, observerInPrimarySite,
  noObserverDeployed, masterObserverUnique, observerNamesReserved, preferredObserverHosts,
  reinstatePreconditions, observerOverrideAssumption,
];
