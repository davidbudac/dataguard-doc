/**
 * Member-level rules: what a far sync instance can never be, and the one
 * documented size limit on a configuration.
 */

import type { Finding } from '../../types/claims';
import type { MemberId } from '../../ids';
import { isFarSync } from '../../types/topology';
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
    message: `The configuration has ${n} members. Oracle Data Guard broker enables you to create a broker configuration consisting of up to 253 members, including one primary database and a combination of standby databases, far sync instances, and Zero Data Loss Recovery Appliances.`,
    cite: [is26 ? 'LIMIT.MEMBERS_253_26AI' : 'LIMIT.MEMBERS_253'],
  })];
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
      message: `${q(m.name)} is a snapshot standby with Flashback Database off. Converting a physical standby database to a snapshot standby database requires Flashback Database to be enabled; a snapshot standby cannot be the target of a switchover or a fast-start failover operation, though a manual failover to one is allowed.`,
      cite: ['MEMBER.SNAPSHOT_CONVERT_NEEDS_FLASHBACK', 'FSFO.SNAPSHOT_NOT_TARGET'],
    }));
  }
  return out;
};

export const memberRules: Rule[] = [farSyncNeverPrimary, memberLimit, snapshotNeedsFlashback];
