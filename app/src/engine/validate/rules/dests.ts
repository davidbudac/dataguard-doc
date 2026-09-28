/**
 * Destination-attribute rules and the two edits the broker refuses with an
 * ORA number.
 *
 * MAX_FAILURE semantics are cited to the LOG_ARCHIVE_DEST_n attributes page
 * and never to the 19c broker properties page, whose MaxFailure row states
 * only the count and its default, not the log-switch / manual-reenable rules.
 */

import type { CitationId } from '../../citations';
import { assertCitesAllowed } from '../../citations';
import type { MemberId } from '../../ids';
import { BROKER_DEFAULTS } from '../../defaults';
import type { Finding } from '../../types/claims';
import type { DestProps, Member } from '../../types/topology';
import type { Rule, ValidateContext } from '../context';
import { configSubject, memberSubject, mk, q } from '../context';

const MAX_FAILURE_CITES: CitationId[] = ['DEST.MAX_FAILURE'];
assertCitesAllowed('MAX_FAILURE_SEMANTICS', MAX_FAILURE_CITES);

interface DestEntry { from: Member; to: MemberId; props: DestProps }

const entries = (ctx: ValidateContext): DestEntry[] => {
  const out: DestEntry[] = [];
  for (const m of ctx.doc.members) {
    for (const [to, props] of Object.entries(m.dests)) {
      out.push({ from: m, to: to as MemberId, props });
    }
  }
  return out;
};

const nameOf = (ctx: ValidateContext, id: MemberId): string =>
  ctx.member(id)?.name ?? (id as string);

/** NetTimeout: 30 s default, 1 s minimum, 8 to 10 s recommended. */
export const netTimeoutLow: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const e of entries(ctx)) {
    if (e.props.netTimeoutSeconds >= 8) continue;
    const i = ctx.indexOf(e.from.id);
    out.push(mk('DEST.NETTIMEOUT_LOW', {
      subject: memberSubject(e.from),
      message: `NetTimeout for the destination ${q(nameOf(ctx, e.to))} on ${q(e.from.name)} is ${e.props.netTimeoutSeconds} s. The minimum is 1 s and a value of 8 to 10 seconds or more is recommended: NET_TIMEOUT bounds how long LGWR waits for the standby's SYNC acknowledgement, and it is never a failover clock.`,
      cite: ['DEST.NET_TIMEOUT'],
      ...(i >= 0 ? {
        fix: {
          label: `Set NetTimeout for ${nameOf(ctx, e.to)} to 10 s`,
          patch: [{ op: 'replace', path: `/members/${i}/dests/${e.to as string}/netTimeoutSeconds`, value: 10 }],
        },
      } : {}),
    }));
  }
  return out;
};

/** The meaning of REOPEN = 0 is not documented. */
export const reopenZero: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const e of entries(ctx)) {
    if (e.props.reopenSeconds !== 0) continue;
    out.push(mk('DEST.REOPEN_ZERO', {
      subject: memberSubject(e.from),
      message: `ReopenSecs for the destination ${q(nameOf(ctx, e.to))} on ${q(e.from.name)} is 0. REOPEN accepts values of 0 or more and defaults to 300 s, and the interval only gates eligibility: redo transport retries a failed destination at log switch time, once the last error plus REOPEN is earlier than now, for all errors and not only connection failures.`,
      cite: ['DEST.REOPEN'],
      note: 'What REOPEN = 0 means -- retry at every log switch, or something else -- is not documented, so this engine refuses to guess and says so rather than modelling a behaviour. The published simulator floors its slider at 30 s for the same reason.',
    }));
  }
  return out;
};

/** Whether a successful reopen resets the consecutive-failure counter is not documented. */
export const maxFailureReset: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const e of entries(ctx)) {
    if (e.props.maxFailure <= 0) continue;
    out.push(mk('DEST.MAXFAILURE_RESET_UNDOC', {
      subject: memberSubject(e.from),
      message: `MaxFailure for the destination ${q(nameOf(ctx, e.to))} on ${q(e.from.name)} is ${e.props.maxFailure}. MAX_FAILURE counts consecutive attempts to reestablish the destination at log switches; at the limit the destination is disabled with no further access until it is manually reenabled, and is then treated as if REOPEN had not been specified. Network healing does not bring it back. From 12.2 a GROUP or PRIORITY destination re-enters service when it is found accessible -- the one documented exception.`,
      cite: [...MAX_FAILURE_CITES, 'DEST.GROUP_PRIORITY_REENTER'],
      note: 'Whether a successful reopen resets the counter is not documented. "Consecutive" implies it, and this engine goes no further than saying so: the counter is not reset in the model, and that choice is labelled rather than presented as behaviour.',
    }));
  }
  return out;
};

/**
 * Neither is deprecated in 19c (the 19c deprecation list names nine
 * initialization-parameter-backed properties and not these two); the info
 * points at where the value lands and whose reference governs it.
 */
export const deprecatedProperties: Rule = (ctx): Finding[] => {
  const d = BROKER_DEFAULTS[ctx.doc.config.edition];
  const out: Finding[] = [];
  for (const e of entries(ctx)) {
    const changed = [
      e.props.reopenSeconds !== d.reopenSeconds ? `ReopenSecs = ${e.props.reopenSeconds}` : null,
      e.props.maxFailure !== d.maxFailure ? `MaxFailure = ${e.props.maxFailure}` : null,
    ].filter((s): s is string => s !== null);
    if (changed.length === 0) continue;
    out.push(mk('DEST.DEPRECATED_19C', {
      subject: memberSubject(e.from),
      message: `${changed.join(' and ')} is set for the destination ${q(nameOf(ctx, e.to))} on ${q(e.from.name)}. Both remain documented broker properties in 19c -- neither is on the 19c deprecation list -- and the broker writes them into the REOPEN and MAX_FAILURE attributes of the sending member's LOG_ARCHIVE_DEST_n, whose attribute reference governs the semantics; EDIT DATABASE ${q(e.from.name)} SET PARAMETER reaches the same attributes.`,
      cite: ['DEST.DEPRECATED_19C'],
    }));
  }
  return out;
};

/** LOG_ARCHIVE_DEST_n runs 1 to 31, and non-real-time cascading only 1 to 10. */
export const destinationRange: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    const n = new Set(ctx.declaredDests(m).map((x) => x.to.id as string)).size;
    if (n <= 30) continue;
    out.push(mk('DEST.RANGE', {
      subject: memberSubject(m),
      message: `RedoRoutes on ${q(m.name)} names ${n} destinations. LOG_ARCHIVE_DEST_n runs from 1 to 31, and this page's generator numbers a member's remote destinations from LOG_ARCHIVE_DEST_2 upward, so ${n} of them do not fit. Destinations 1 to 10 accept LOCATION or SERVICE and 11 to 31 accept SERVICE only, and non-real-time cascading is available on destinations 1 to 10 only.`,
      cite: ['DEST.RANGE_1_31', 'CASCADE.PHYSICAL_ONLY'],
    }));
  }
  return out;
};

/** ORA-16654: several edits are blocked while fast-start failover is enabled. */
export const fsfoBlocksEdits: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  return [mk('EDIT.FSFO_ENABLED_BLOCKS', {
    subject: configSubject(),
    message: 'Fast-start failover is enabled, so the broker refuses a change to LogXptMode on the primary or the target standby and a change to the protection mode, with ORA-16654 -- and a change to FastStartFailoverTarget unless the new property value still contains the current fast-start failover target. DISABLE FAST_START FAILOVER; first, or DISABLE FAST_START FAILOVER FORCE; where the configuration is unobserved.',
    cite: ['ORA.16654'],
    ora: 'ORA-16654',
  })];
};

/** ORA-16867: a member named by FastStartFailoverTarget cannot be removed. */
export const removeTargetBlocked: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const id of ctx.rawTargets) {
    const m = ctx.member(id);
    if (!m) continue;
    out.push(mk('EDIT.REMOVE_TARGET', {
      subject: memberSubject(m),
      message: `${q(m.name)} is named by FastStartFailoverTarget, so REMOVE DATABASE ${q(m.name)}; fails with ORA-16867 until the property no longer names it. The reciprocal value is set on the target automatically, and targets are verified when fast-start failover is enabled.`,
      cite: ['ORA.16867', 'FSFO.TARGET_VERIFIED_ON_ENABLE'],
      ora: 'ORA-16867',
    }));
  }
  return out;
};

export const destRules: Rule[] = [
  netTimeoutLow, reopenZero, maxFailureReset, deprecatedProperties, destinationRange,
  fsfoBlocksEdits, removeTargetBlocked,
];
