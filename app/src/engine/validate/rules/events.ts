/**
 * Checks on the commands a scenario issues: REINSTATE, SET MASTEROBSERVER and
 * EDIT DATABASE ... SET STATE ... WITH APPLY INSTANCE.
 *
 * The switchover and failover commands are checked elsewhere
 * (members.ts); these three used to be accepted without a look. Each rule asks
 * only what the documentation lets it ask: the command names something that
 * exists, and the sentences Oracle prints about the command are not walked
 * past. What the simulation then does with the command is not decided here.
 */

import type { Finding } from '../../types/claims';
import { isDatabase, isFarSync } from '../../types/topology';
import type { Rule } from '../context';
import { configSubject, memberSubject, mk, q } from '../context';

/**
 * REINSTATE names a database that must have had Flashback Database on:
 * "For the REINSTATE command to succeed, Flashback Database must have been
 * enabled on the database prior to the failover". A far sync instance has no
 * role to be reinstated into.
 */
export const reinstateCommand: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const e of ctx.doc.events) {
    if (e.kind !== 'cmd.reinstate') continue;
    const m = ctx.member(e.member);
    const name = q(e.member as string);
    if (!m) {
      out.push(mk('EVENT.REINSTATE', {
        subject: configSubject(),
        severity: 'error',
        basis: 'model',
        message: `REINSTATE DATABASE ${name}; at ${e.at} s names a member that is not in this configuration, so there is nothing to reinstate.`,
        cite: ['REINSTATE.NEEDS_FLASHBACK'],
        note: 'No Oracle sentence is needed for a command that names nothing: this is the page\'s check on its own scenario.',
      }));
      continue;
    }
    if (isFarSync(m)) {
      out.push(mk('EVENT.REINSTATE', {
        subject: memberSubject(m),
        severity: 'error',
        basis: 'inferred',
        message: `REINSTATE DATABASE ${name}; at ${e.at} s names the far sync instance ${name}. REINSTATE returns a former primary database to the configuration as a standby, and a far sync instance can never function in the primary role or be converted to any type of standby database, so it never needs to be, and cannot be, reinstated.`,
        cite: ['FS.NO_DATAFILES', 'REINSTATE.NEEDS_FLASHBACK'],
        note: 'A deduction from two sentences: a far sync instance is never a primary (FS.NO_DATAFILES), and reinstatement is what a former primary goes through. No sentence says REINSTATE refuses a far sync instance by name.',
      }));
      continue;
    }
    if (isDatabase(m) && !m.flashbackOn) {
      out.push(mk('EVENT.REINSTATE', {
        subject: memberSubject(m),
        message: `REINSTATE DATABASE ${name}; at ${e.at} s names a database with Flashback Database off. For the REINSTATE command to succeed, Flashback Database must have been enabled on the database prior to the failover and there must be sufficient flashback logs on that database.`,
        cite: ['REINSTATE.NEEDS_FLASHBACK'],
      }));
    }
  }
  return out;
};

/**
 * EDIT DATABASE ... SET STATE='APPLY-ON' WITH APPLY INSTANCE=... names an
 * instance of a RAC standby. "If the target state is not APPLY-ON or if the
 * database is currently in the primary role, the WITH APPLY INSTANCE clause is
 * ignored even if it is specified."
 */
export const setApplyInstanceCommand: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const e of ctx.doc.events) {
    if (e.kind !== 'cmd.setApplyInstance') continue;
    const m = ctx.member(e.member);
    const name = q(e.member as string);
    if (!m || !isDatabase(m)) {
      out.push(mk('EVENT.SET_APPLY_INSTANCE', {
        subject: configSubject(),
        severity: 'warning',
        basis: 'model',
        message: `SET STATE='APPLY-ON' WITH APPLY INSTANCE=${q(e.instance)} at ${e.at} s names ${name}, which is not a database of this configuration. Only a database runs apply, so there is no apply instance to move.`,
        cite: ['RAC.SET_APPLY_INSTANCE'],
        note: 'The page\'s check on its own scenario: a far sync instance runs no apply, and an unknown name is nothing at all.',
      }));
      continue;
    }
    if (!m.instances.some((i) => i.name === e.instance)) {
      out.push(mk('EVENT.SET_APPLY_INSTANCE', {
        subject: memberSubject(m),
        severity: 'warning',
        basis: 'model',
        message: `SET STATE='APPLY-ON' WITH APPLY INSTANCE=${q(e.instance)} at ${e.at} s names an instance that ${name} does not have (its instances: ${m.instances.map((i) => i.name).join(', ')}).`,
        cite: ['RAC.SET_APPLY_INSTANCE'],
        note: 'Oracle prints the command with a real instance name and does not say what an unknown one does; the page treats it as a mistake in the scenario rather than modelling a refusal.',
      }));
      continue;
    }
    /* Only the declared role is known here; a role change earlier in the
       scenario can have made the member a standby, so stay quiet then. */
    const roleChanged = ctx.doc.events.some(
      (x) => (x.kind === 'cmd.switchover' || x.kind === 'cmd.failover') && x.at <= e.at,
    );
    if (m.role === 'primary' && !roleChanged) {
      out.push(mk('EVENT.SET_APPLY_INSTANCE', {
        subject: memberSubject(m),
        severity: 'info',
        message: `SET STATE='APPLY-ON' WITH APPLY INSTANCE=${q(e.instance)} at ${e.at} s names ${name}, which is the primary and nothing in the scenario has changed that before this point. If the database is currently in the primary role, the WITH APPLY INSTANCE clause is ignored even if it is specified.`,
        cite: ['RAC.WITH_APPLY_INSTANCE_IGNORED'],
      }));
    }
  }
  return out;
};

/**
 * SET MASTEROBSERVER TO names an observer of the configuration. "When
 * fast-start failover is disabled, no observer is called the master observer;
 * all observers have the same functionality", so with it disabled the command
 * moves nothing.
 */
export const setMasterObserverCommand: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const e of ctx.doc.events) {
    if (e.kind !== 'cmd.setMasterObserver') continue;
    const o = ctx.doc.observers.find((x) => x.id === e.observer);
    const name = q(e.observer as string);
    if (!o) {
      out.push(mk('EVENT.SET_MASTER_OBSERVER', {
        subject: configSubject(),
        severity: 'warning',
        basis: 'model',
        message: `SET MASTEROBSERVER TO ${name}; at ${e.at} s names an observer that is not deployed in this configuration, so no observer can become the master.`,
        cite: ['OBS.SET_MASTEROBSERVER'],
        note: 'The page\'s check on its own scenario: the command can only name an observer that exists.',
      }));
      continue;
    }
    if (!ctx.fsfoOn) {
      out.push(mk('EVENT.SET_MASTER_OBSERVER', {
        subject: { kind: 'observer', id: o.id as string },
        severity: 'info',
        message: `SET MASTEROBSERVER TO ${name}; at ${e.at} s is issued while fast-start failover is disabled. When fast-start failover is disabled, no observer is called the master observer; all observers have the same functionality, so there is no master to move.`,
        cite: ['OBS.NO_MASTER_WHEN_DISABLED', 'OBS.SET_MASTEROBSERVER_CONDITIONS'],
      }));
    }
  }
  return out;
};

export const eventRules: Rule[] = [
  reinstateCommand, setApplyInstanceCommand, setMasterObserverCommand,
];
