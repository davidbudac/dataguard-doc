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

export const memberRules: Rule[] = [farSyncNeverPrimary, memberLimit];
