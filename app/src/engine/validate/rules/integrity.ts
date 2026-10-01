/**
 * Whether the document is a configuration at all: one primary, names that tell
 * the members apart, a fast-start failover target that is switched on, and a
 * static service where nothing else can restart an instance.
 *
 * These used to validate silently. `declaredPrimary` takes the first primary it
 * finds, so a second one, or none, changed nothing the rules could see.
 */

import type { Finding } from '../../types/claims';
import { isRac } from '../../types/topology';
import type { Rule } from '../context';
import { configSubject, memberSubject, mk, q } from '../context';

/**
 * "...up to 253 members, including one primary database..." -- one, not two,
 * and not none. An empty document is a blank canvas, not a configuration
 * without a primary, so it is left alone.
 */
export const primaryCount: Rule = (ctx): Finding[] => {
  if (ctx.doc.members.length === 0) return [];
  const primaries = ctx.databases.filter((m) => m.role === 'primary');
  if (primaries.length === 1) return [];
  const none = primaries.length === 0;
  return [mk('MEMBER.PRIMARY_COUNT', {
    subject: configSubject(),
    message: none
      ? `The configuration has ${ctx.doc.members.length} member${ctx.doc.members.length === 1 ? '' : 's'} and none of them is the primary database. A broker configuration consists of up to 253 members, including one primary database. Nothing here can be simulated until one database is the primary.`
      : `${primaries.length} databases are marked primary (${primaries.map((m) => q(m.name)).join(', ')}). A broker configuration consists of up to 253 members, including one primary database. This page reads the first one as the primary, and the others are not honoured as such.`,
    cite: ['LIMIT.MEMBERS_253'],
  })];
};

/**
 * Two members, or two instances of one database, with the same name cannot be
 * told apart by a command that names them. The page identifies a member by its
 * name (the db_unique_name), and an instance by its name within the database.
 */
export const duplicateNames: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  const seen = new Map<string, string>();
  for (const m of ctx.doc.members) {
    const key = m.name.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      out.push(mk('MEMBER.NAME_DUPLICATE', {
        subject: memberSubject(m),
        message: `The members ${q(first)} and ${q(m.name)} have the same name. A command names a member by its name, so one of them could never be addressed.`,
        cite: ['LIMIT.MEMBERS_253'],
        note: 'The page\'s own check: Oracle\'s pages reviewed carry no sentence that a member name must be unique, though every command and property in them names a member by it. The citation is the page that defines what a configuration\'s members are.',
      }));
    } else {
      seen.set(key, m.name);
    }
    const insts = new Set<string>();
    for (const i of m.instances) {
      if (insts.has(i.name)) {
        out.push(mk('MEMBER.NAME_DUPLICATE', {
          subject: memberSubject(m),
          message: `${q(m.name)} has two instances named ${q(i.name)}. PreferredApplyInstance and SET STATE ... WITH APPLY INSTANCE name an instance of the database by its name, so the two could not be told apart.`,
          cite: ['RAC.SET_APPLY_INSTANCE', 'RAC.PREFERRED_APPLY_INSTANCE'],
          note: 'The page\'s own check: instances are addressed by name within their database in the two places Oracle prints, and no sentence states the uniqueness outright.',
        }));
        break;
      }
      insts.add(i.name);
    }
  }
  return out;
};

/**
 * "...the broker allows the disable operation to proceed only if the standby
 * database is not the target standby database for fast-start failovers." A
 * configuration with fast-start failover on and every named target switched
 * off is one the broker would not let you reach. A condition of enabling, so an
 * info while disabled, as for the other conditions (VAL-04).
 */
export const targetsDisabled: Rule = (ctx): Finding[] => {
  if (ctx.rawTargets.length === 0) return [];
  const named = ctx.rawTargets.map((id) => ctx.member(id)).filter((m) => m !== undefined);
  if (named.length === 0 || named.some((m) => m.enabled)) return [];
  const names = named.map((m) => q(m.name)).join(', ');
  return [mk('FSFO.TARGET_DISABLED', {
    subject: configSubject(),
    ...(ctx.fsfoOn ? {} : { severity: 'info' as const }),
    message: ctx.fsfoOn
      ? `FastStartFailoverTarget names ${names}, and every one of them is disabled. The broker allows the disable operation to proceed only if the standby database is not the target standby database for fast-start failover, so this state cannot be reached while fast-start failover is enabled. No standby here can be promoted automatically.`
      : `FastStartFailoverTarget names ${names}, and every one of them is disabled. Fast-start failover is disabled, so nothing is refused yet, but enabling it needs an enabled target, and a standby that is the target cannot be disabled while it is enabled.`,
    cite: ['FSFO.DISABLE_STANDBY_NOT_TARGET'],
  })];
};

/**
 * "A single-instance database on which Oracle Restart is not configured must
 * have a static service registered with the listener so that the DGMGRL CLI
 * can automatically start the instance when necessary (for example, for the
 * new standby after a switchover)." Not only for reinstatement. The document
 * cannot say whether Oracle Restart is configured, so this is an inference from
 * the sentence, and an info; REINSTATE.PRECONDITIONS already says it for the
 * databases automatic reinstatement involves.
 */
export const staticServiceSingleInstance: Rule = (ctx): Finding[] => {
  const f = ctx.doc.config.fsfo;
  const covered = new Set<string>();
  if (f.autoReinstate && f.state === 'enabled') {
    if (ctx.primary) covered.add(ctx.primary.id as string);
    for (const id of ctx.candidates) covered.add(id as string);
  }
  const out: Finding[] = [];
  for (const m of ctx.databases) {
    if (m.staticServices || isRac(m) || covered.has(m.id as string)) continue;
    out.push(mk('MEMBER.STATIC_SERVICE', {
      subject: memberSubject(m),
      message: `${q(m.name)} is a single-instance database with no static service registered with its listener. A single-instance database on which Oracle Restart is not configured must have a static service registered with the listener so that the DGMGRL CLI can automatically start the instance when necessary, for example for the new standby after a switchover.`,
      cite: ['MEMBER.STATIC_SERVICE_SINGLE_INSTANCE', 'RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE'],
      note: 'A document cannot say that Oracle Restart is configured, so this is the sentence applied to every single-instance database without a static service; where Oracle Restart runs, it does not apply. It is not only about reinstatement: a switchover needs it for the new standby too.',
    }));
  }
  return out;
};

export const integrityRules: Rule[] = [
  primaryCount, duplicateNames, targetsDisabled, staticServiceSingleInstance,
];
