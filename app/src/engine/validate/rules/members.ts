/**
 * Member-level rules: what a far sync instance can never be, and the one
 * documented size limit on a configuration.
 */

import type { Finding } from '../../types/claims';
import type { MemberId } from '../../ids';
import { isDatabase, isFarSync, isRac } from '../../types/topology';
import type { Rule } from '../context';
import { memberSubject, mk, q } from '../context';

/**
 * A far sync instance "can never function in the primary role or be converted
 * to any type of standby database", so it can neither be listed among the
 * members the broker may make primary nor be named by a role-transition
 * command. (FastStartFailoverTarget is the other way in, and FSFO.TARGET_KIND
 * is the rule that guards it.)
 */
export const farSyncNeverPrimary: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const flag = (id: MemberId, message: string): void => {
    const m = ctx.member(id);
    if (!m || !isFarSync(m)) return;
    if (seen.has(m.id as string)) return;
    seen.add(m.id as string);
    out.push(mk('MEMBER.FARSYNC_NOT_PRIMARY', {
      subject: memberSubject(m),
      message,
      cite: ['FS.NO_DATAFILES', 'FS.MANAGES_CONTROLFILE'],
    }));
  };

  for (const id of ctx.doc.config.primaryDatabaseCandidates ?? []) {
    flag(id, `PrimaryDatabaseCandidates lists the far sync instance ${q(id as string)}. A far sync instance has no user data files, cannot be opened for access, cannot run redo apply, and can never function in the primary role or be converted to any type of standby database, so the broker can never make it primary.`);
  }
  for (const e of ctx.doc.events) {
    if (e.kind !== 'cmd.switchover' && e.kind !== 'cmd.failover') continue;
    const verb = e.kind === 'cmd.switchover' ? 'SWITCHOVER TO' : 'FAILOVER TO';
    flag(e.to, `${verb} ${q(e.to as string)} names a far sync instance. A far sync instance can never function in the primary role or be converted to any type of standby database.`);
  }
  return out;
};

/**
 * 253 members per configuration is documented in the 12.1 broker properties
 * page and is not restated in 19c or 26ai -- a cross-edition citation, and
 * doc-later rather than documented for this edition.
 */
export const memberLimit: Rule = (ctx): Finding[] => {
  const n = ctx.doc.members.length;
  if (n <= 253) return [];
  return [mk('LIMIT.MEMBERS_253', {
    subject: { kind: 'config' },
    message: `The configuration has ${n} members. A broker configuration is documented to hold up to 253 members.`,
    cite: ['LIMIT.MEMBERS_253'],
    note: 'The 253-member limit appears on the 12.1 broker properties page and is not restated in 19c or 26ai. It is carried as a cross-edition citation -- the same precedent as the 21c ObserverPing* pages -- and never presented as a sentence of the edition being drawn.',
  })];
};

/**
 * PreferredApplyInstance "indicates that a particular instance is the
 * preferred choice for serving log apply services. It is only used when the
 * database is a standby Oracle RAC database." Its valid values are an
 * instance name or the empty string. A RAC primary may carry one on purpose --
 * the broker guide names setting it "in preparation for a switchover" -- so
 * only a single-instance or snapshot database is told the value is unused.
 */
export const preferredApplyInstance: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    if (!isDatabase(m) || m.preferredApplyInstance === undefined) continue;
    const name = m.preferredApplyInstance;
    if (!m.instances.some((i) => i.name === name)) {
      out.push(mk('RAC.PREFERRED_APPLY_UNKNOWN', {
        subject: memberSubject(m),
        message: `PreferredApplyInstance on ${q(m.name)} is ${q(name)}, which is not one of its instances (${m.instances.map((i) => i.name).join(', ')}). The property takes the instance name (SID) or the empty string, where the broker chooses the apply instance.`,
        cite: ['RAC.PREFERRED_APPLY_INSTANCE'],
      }));
      continue;
    }
    if (!isRac(m) || m.role === 'snapshot') {
      out.push(mk('RAC.PREFERRED_APPLY_UNUSED', {
        subject: memberSubject(m),
        message: `PreferredApplyInstance is set on ${q(m.name)}, ${m.role === 'snapshot' ? 'a snapshot standby' : 'a single-instance database'}. The property is only used when the database is a standby Oracle RAC database, and apply instance selection does not apply to snapshot standby databases.`,
        cite: ['RAC.PREFERRED_APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_SELECTION'],
      }));
    }
  }
  return out;
};

/** ApplyInstances is "valid only on physical standby databases". */
export const applyInstancesUnused: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    if (!isDatabase(m) || m.applyInstances === undefined) continue;
    const physicalRac = (m.role === 'physical' || m.role === 'primary') && isRac(m);
    if (physicalRac) continue;
    out.push(mk('RAC.APPLY_INSTANCES_UNUSED', {
      subject: memberSubject(m),
      message: `ApplyInstances is ${m.applyInstances} on ${q(m.name)}, ${!isRac(m) ? 'a single-instance database' : `a ${m.role} standby`}. The property lets you specify how many physical standby instances run Redo Apply, so it does nothing here.`,
      cite: ['RAC.APPLY_INSTANCES_PROPERTY', 'RAC.MULTI_INSTANCE_APPLY'],
    }));
  }
  return out;
};

/** Each RAC instance of one database on a node of its own. */
export const instancesShareHost: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    const byHost = new Map<string, string[]>();
    for (const i of m.instances) byHost.set(i.host as string, [...byHost.get(i.host as string) ?? [], i.name]);
    for (const [host, names] of byHost) {
      if (names.length < 2) continue;
      out.push(mk('RAC.INSTANCES_SHARE_HOST', {
        subject: memberSubject(m),
        message: `${names.join(' and ')} of ${q(m.name)} both run on ${q(host)}. Crash that host and every one of them goes with it, so the cluster is no more available than one instance.`,
        cite: ['RAC.PRIMARY_AVAILABLE'],
        note: 'RAC.ONE_INSTANCE_PER_NODE: this page draws each instance of a RAC database on a node of its own, which is how a cluster survives a node failure. It is not quoting a documented prohibition.',
      }));
    }
  }
  return out;
};

export const memberRules: Rule[] = [
  farSyncNeverPrimary, memberLimit, preferredApplyInstance, applyInstancesUnused, instancesShareHost,
];
