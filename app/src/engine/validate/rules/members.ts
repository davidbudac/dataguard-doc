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
    flag(id, `PrimaryDatabaseCandidates lists the far sync instance ${q(id as string)}. A far sync instance has no user data files, cannot be opened for access, cannot run redo apply, and can never function in the primary role or be converted to any type of standby database, so the broker can never make it primary. Remove it from the list.`);
  }
  for (const e of ctx.doc.events) {
    if (e.kind !== 'cmd.switchover' && e.kind !== 'cmd.failover') continue;
    const verb = e.kind === 'cmd.switchover' ? 'SWITCHOVER TO' : 'FAILOVER TO';
    flag(e.to, `${verb} ${q(e.to as string)} names a far sync instance, which can never function in the primary role or be converted to any type of standby database.`);
  }
  return out;
};

/**
 * 253 members per configuration is documented word for word on both the 19c
 * and 26ai Managing Broker Configurations pages -- documented for the
 * edition being drawn, not a cross-edition citation, and an error: the
 * broker does not accept a 254th member.
 */
export const memberLimit: Rule = (ctx): Finding[] => {
  const n = ctx.doc.members.length;
  if (n <= 253) return [];
  const is26 = ctx.doc.config.edition === '26ai';
  return [mk('LIMIT.MEMBERS_253', {
    subject: { kind: 'config' },
    message: `The configuration has ${n} members. The broker supports at most 253 members per configuration: one primary database plus any combination of standby databases, far sync instances and Zero Data Loss Recovery Appliances.`,
    cite: [is26 ? 'LIMIT.MEMBERS_253_26AI' : 'LIMIT.MEMBERS_253'],
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
        message: `PreferredApplyInstance on ${q(m.name)} is ${q(name)}, which is not one of its instances (${m.instances.map((i) => i.name).join(', ')}). The property takes an instance name (SID) or the empty string, which leaves the choice of apply instance to the broker.`,
        cite: ['RAC.PREFERRED_APPLY_INSTANCE'],
      }));
      continue;
    }
    if (!isRac(m) || m.role === 'snapshot') {
      out.push(mk('RAC.PREFERRED_APPLY_UNUSED', {
        subject: memberSubject(m),
        message: `PreferredApplyInstance is set on ${q(m.name)}, ${m.role === 'snapshot' ? 'a snapshot standby' : 'a single-instance database'}. The property is used only when the database is a standby Oracle RAC database, and apply instance selection does not apply to snapshot standby databases.`,
        cite: ['RAC.PREFERRED_APPLY_INSTANCE', 'RAC.APPLY_NOT_FOR_SNAPSHOT'],
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
      message: `ApplyInstances is ${m.applyInstances} on ${q(m.name)}, ${!isRac(m) ? 'a single-instance database' : `a ${m.role} standby`}. The property sets how many physical standby instances run Redo Apply, so it has no effect here.`,
      cite: ['RAC.APPLY_INSTANCES_PROPERTY', 'RAC.MULTI_INSTANCE_APPLY'],
    }));
  }
  return out;
};

/**
 * "To convert a physical standby database to a snapshot standby database you
 * must have Flashback Database enabled." A snapshot standby cannot be the
 * target of a switchover or fast-start failover operation; manual failover
 * to one stays allowed (FSFO.SNAPSHOT_NOT_TARGET already covers the target
 * side via FSFO.TARGET_KIND).
 */
export const snapshotNeedsFlashback: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.standbys) {
    if (m.role !== 'snapshot' || m.flashbackOn) continue;
    out.push(mk('MEMBER.SNAPSHOT_NEEDS_FLASHBACK', {
      subject: memberSubject(m),
      message: `${q(m.name)} is a snapshot standby with Flashback Database off. Converting a physical standby database to a snapshot standby database requires Flashback Database to be enabled. A snapshot standby cannot be the target of a switchover or a fast-start failover operation, though a manual failover to one is allowed.`,
      cite: ['MEMBER.SNAPSHOT_CONVERT_NEEDS_FLASHBACK', 'FSFO.SNAPSHOT_NOT_TARGET'],
    }));
  }
  return out;
};

/**
 * Two commands the broker refuses by the kind of standby they name. "A
 * snapshot standby database cannot be the target of a switchover" -- it must
 * be converted back to a physical standby first (a manual failover to one is
 * a different command and stays legal) -- and "Switchover to a logical
 * standby database is disallowed when the configuration is operating in
 * maximum protection mode."
 */
export const switchoverKindRefused: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const maxProtection = ctx.doc.config.protectionMode === 'MAXPROTECTION';
  for (const e of ctx.doc.events) {
    if (e.kind !== 'cmd.switchover') continue;
    const m = ctx.member(e.to);
    if (!m || !isDatabase(m)) continue;
    if (m.role === 'snapshot' && !seen.has(`s|${m.id as string}`)) {
      seen.add(`s|${m.id as string}`);
      out.push(mk('ROLE.SWITCHOVER_SNAPSHOT', {
        subject: memberSubject(m),
        message: `SWITCHOVER TO ${q(m.name)} is refused: ${q(m.name)} is a snapshot standby, and a snapshot standby cannot be the target of a switchover. Convert it back to a physical standby database first; a manual failover to it is the command that is allowed.`,
        cite: ['SWITCHOVER.SNAPSHOT_NOT_TARGET', 'SWITCHOVER.SNAPSHOT_CONVERT_FIRST'],
      }));
    }
    if (m.role === 'logical' && maxProtection && !seen.has(`l|${m.id as string}`)) {
      seen.add(`l|${m.id as string}`);
      out.push(mk('ROLE.SWITCHOVER_LOGICAL_MAXPROT', {
        subject: memberSubject(m),
        message: `SWITCHOVER TO ${q(m.name)} is refused: ${q(m.name)} is a logical standby, and a switchover to a logical standby database is disallowed while the configuration operates in maximum protection mode.`,
        cite: ['SWITCHOVER.LOGICAL_MAXPROT'],
      }));
    }
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
        message: `Instances ${names.join(' and ')} of ${q(m.name)} both run on ${q(host)}. A crash of that host takes every one of them down, so the cluster is no more available than a single instance.`,
        cite: ['RAC.PRIMARY_AVAILABLE'],
        note: 'RAC.ONE_INSTANCE_PER_NODE: the workbench draws each instance of a RAC database on a node of its own, which is how a cluster survives a node failure. This is a design convention, not a quoted Oracle prohibition; RAC.PRIMARY_AVAILABLE is the sentence that makes one running instance enough, and that a crash of the shared host takes every instance on it follows from the hosts as drawn.',
      }));
    }
  }
  return out;
};

export const memberRules: Rule[] = [
  farSyncNeverPrimary, memberLimit, snapshotNeedsFlashback, switchoverKindRefused,
  preferredApplyInstance, applyInstancesUnused, instancesShareHost,
];
