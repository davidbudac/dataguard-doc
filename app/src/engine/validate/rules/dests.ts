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
import type { DestProps, Member, XptMode } from '../../types/topology';
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

/**
 * The transports a sender's destination to `to` uses: what its RedoRoutes
 * spell, or the receiver's LogXptMode where no rule names the pair.
 */
const transportsTo = (ctx: ValidateContext, from: Member, to: MemberId): XptMode[] => {
  const declared = ctx.declaredDests(from).filter((d) => d.to.id === to).map((d) => d.xpt);
  if (declared.length > 0) return declared;
  const receiver = ctx.member(to);
  return receiver === undefined ? [] : [receiver.logXptMode];
};

/**
 * NetTimeout: 30 s default, 1 s minimum, 8 to 10 s recommended. NET_TIMEOUT
 * "Requires attributes: SYNC" and conflicts with ASYNC ("If you specify the
 * ASYNC attribute, redo transport services ignores it; no error is
 * returned" -- DEST.NET_TIMEOUT_ASYNC_IGNORED), so an ASYNC destination is
 * never told its value is low.
 */
export const netTimeoutLow: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const e of entries(ctx)) {
    if (e.props.netTimeoutSeconds >= 8) continue;
    const xpts = transportsTo(ctx, e.from, e.to);
    if (xpts.length > 0 && xpts.every((x) => x === 'ASYNC')) continue;
    const i = ctx.indexOf(e.from.id);
    out.push(mk('DEST.NETTIMEOUT_LOW', {
      subject: memberSubject(e.from),
      message: `NetTimeout on ${q(e.from.name)} for the destination ${q(nameOf(ctx, e.to))} is ${e.props.netTimeoutSeconds} s. 8 to 10 seconds or more is recommended; the minimum is 1 s. NET_TIMEOUT bounds how long LGWR waits for the standby's SYNC acknowledgement. It is not a failover clock.`,
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
      message: `ReopenSecs on ${q(e.from.name)} for the destination ${q(nameOf(ctx, e.to))} is 0. REOPEN accepts 0 or more and defaults to 300 s. The interval only gates eligibility: redo transport retries a failed destination at log switch time, once the last error plus REOPEN is earlier than now, for every error and not only connection failures.`,
      cite: ['DEST.REOPEN'],
      note: 'The documentation does not say what REOPEN = 0 means (a retry at every log switch, or something else), so the workbench models no behaviour for it. The published simulator floors its slider at 30 s for the same reason.',
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
      message: `MaxFailure on ${q(e.from.name)} for the destination ${q(nameOf(ctx, e.to))} is ${e.props.maxFailure}. MAX_FAILURE counts consecutive attempts to reestablish the destination at log switches. At the limit the destination is disabled and gets no further access until it is manually reenabled, and is then treated as if REOPEN had not been specified. Network healing does not bring it back. The one documented exception: from 12.2, a GROUP or PRIORITY destination re-enters service when it is found accessible.`,
      cite: [...MAX_FAILURE_CITES, 'DEST.GROUP_PRIORITY_REENTER'],
      note: 'Whether a successful reopen resets the counter is not documented. "Consecutive" implies it, and the workbench goes no further: it does not reset the counter in its model, and labels that choice rather than presenting it as behaviour.',
    }));
  }
  return out;
};

/**
 * Neither is deprecated in 19c (the 19c deprecation list names nine
 * initialization-parameter-backed properties and not these two); the info
 * points at where the value lands and whose reference governs it. The
 * deprecation-list sentence is a 19c page's, so a 26ai document is not told it:
 * it gets the pointer alone, cited to the page that says the properties
 * correspond to LOG_ARCHIVE_DEST_n attributes, and the message says that the
 * 26ai release-changes page was not read for a list of its own (VAL-20).
 */
export const deprecatedProperties: Rule = (ctx): Finding[] => {
  const edition = ctx.doc.config.edition;
  const d = BROKER_DEFAULTS[edition];
  const out: Finding[] = [];
  for (const e of entries(ctx)) {
    const changed = [
      e.props.reopenSeconds !== d.reopenSeconds ? `ReopenSecs = ${e.props.reopenSeconds}` : null,
      e.props.maxFailure !== d.maxFailure ? `MaxFailure = ${e.props.maxFailure}` : null,
    ].filter((s): s is string => s !== null);
    if (changed.length === 0) continue;
    const where = `The broker writes them into the REOPEN and MAX_FAILURE attributes of the sending member's LOG_ARCHIVE_DEST_n, and that attribute reference governs their semantics. EDIT DATABASE ${q(e.from.name)} SET PARAMETER reaches the same attributes.`;
    out.push(mk('DEST.DEPRECATED_19C', {
      subject: memberSubject(e.from),
      message: edition === '19c'
        ? `Non-default ${changed.join(' and ')} on ${q(e.from.name)} for the destination ${q(nameOf(ctx, e.to))}. ReopenSecs and MaxFailure remain documented broker properties in 19c and are not on the 19c deprecation list. ${where}`
        : `Non-default ${changed.join(' and ')} on ${q(e.from.name)} for the destination ${q(nameOf(ctx, e.to))}. ReopenSecs and MaxFailure are broker properties that correspond to attributes of LOG_ARCHIVE_DEST_n. ${where} The 19c deprecation list does not name them, and this page did not read a deprecation list for 26ai.`,
      cite: edition === '19c' ? ['DEST.DEPRECATED_19C'] : ['DEST.BROKER_OWNED_PROPERTIES'],
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
      message: `RedoRoutes on ${q(m.name)} names ${n} destinations, more than LOG_ARCHIVE_DEST_n (1 to 31) can hold. The generated configuration numbers a member's remote destinations from LOG_ARCHIVE_DEST_2 upward, so ${n} do not fit. Destinations 1 to 10 accept LOCATION or SERVICE, 11 to 31 accept SERVICE only, and non-real-time cascading is available on destinations 1 to 10 only.`,
      cite: ['DEST.RANGE_1_31', 'CASCADE.PHYSICAL_ONLY'],
    }));
  }
  return out;
};

/**
 * "Destinations LOG_ARCHIVE_DEST_11 through LOG_ARCHIVE_DEST_31 do not support
 * the SYNC ... attributes." The 10th remote destination of a member lands in
 * LOG_ARCHIVE_DEST_11, because this page numbers a member's remote
 * destinations from LOG_ARCHIVE_DEST_2 upward (generate/initora.ts: one slot
 * per destination in rule order, an ALT taking the slot after its main). The
 * numbering is the page's convention, the restriction is Oracle's; so the
 * finding is inferred, and a warning.
 */
export const syncAboveTen: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    const dests = ctx.declaredDests(m);
    const byRule = new Map<number, typeof dests>();
    for (const d of dests) byRule.set(d.ruleIndex, [...byRule.get(d.ruleIndex) ?? [], d]);
    const hits = new Map<string, { n: number; xpt: XptMode }>();
    for (const list of byRule.values()) {
      let n = 2;
      for (const d of list) {
        const slot = n++;
        if (slot >= 11 && d.xpt !== 'ASYNC') hits.set(d.to.id as string, { n: slot, xpt: d.xpt });
        if (d.dest.alt !== undefined && !d.fromAll) {
          const altSlot = n++;
          const altXpt = d.dest.alt.xpt ?? ctx.member(d.dest.alt.target)?.logXptMode ?? 'ASYNC';
          if (altSlot >= 11 && altXpt !== 'ASYNC') hits.set(d.dest.alt.target as string, { n: altSlot, xpt: altXpt });
        }
      }
    }
    for (const [to, h] of hits) {
      out.push(mk('DEST.SYNC_ABOVE_10', {
        subject: memberSubject(m),
        message: `RedoRoutes on ${q(m.name)} ships to ${q(nameOf(ctx, to as MemberId))} over ${h.xpt} as its destination number ${h.n - 1}, which this page writes as LOG_ARCHIVE_DEST_${h.n}. Destinations LOG_ARCHIVE_DEST_11 through LOG_ARCHIVE_DEST_31 do not support the SYNC attribute. Keep this destination among the first nine, or ship it over ASYNC.`,
        cite: ['DEST.RANGE_1_31'],
        note: 'The restriction is Oracle\'s; the destination number is this page\'s convention. The workbench numbers a member\'s remote destinations from LOG_ARCHIVE_DEST_2 upward in the order the active rule lists them, and the broker\'s own numbering is not documented, so this is a deduction from the two.',
      }));
    }
  }
  return out;
};

/**
 * ORA-16654: several edits are blocked while fast-start failover is enabled.
 *
 * Three sentences qualify the list: a downgrade from maximum protection to
 * maximum availability is allowed when fast-start failover was enabled in
 * maximum protection mode; a standby can be disabled only when it is not the
 * target; and FORCE on DISABLE FAST_START FAILOVER is for a disconnected
 * network, not for a missing observer. (Oracle's ORA-16654 cause list also
 * names RedoRoutes; no sentence the catalogue carries says how, so it is not
 * paraphrased here.)
 */
export const fsfoBlocksEdits: Rule = (ctx): Finding[] => {
  if (!ctx.fsfoOn) return [];
  return [mk('EDIT.FSFO_ENABLED_BLOCKS', {
    subject: configSubject(),
    message: 'Fast-start failover is enabled. The broker refuses these edits with ORA-16654: a change to LogXptMode on the primary or the target standby, a change to the protection mode, and a change to FastStartFailoverTarget unless the new value still contains the current fast-start failover target. An exception to the protection mode rule: a downgrade to maximum availability mode is allowed when fast-start failover has been enabled in maximum protection mode. A standby database can be disabled only if it is not the target standby database for fast-start failover. Run DISABLE FAST_START FAILOVER; first. Add FORCE when the network between the primary and target standby databases is disconnected or when the database the command is received on has no connection with the primary database: DISABLE FAST_START FAILOVER FORCE;',
    cite: ['ORA.16654', 'MODE.DOWNGRADE_AFTER_FSFO_MAXPROT', 'FSFO.DISABLE_STANDBY_NOT_TARGET', 'FSFO.DISABLE_FORCE_USE'],
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
      message: `${q(m.name)} is named by FastStartFailoverTarget, so REMOVE DATABASE ${q(m.name)}; fails with ORA-16867 until the property no longer names it. The broker sets the reciprocal value on the target automatically and verifies targets when fast-start failover is enabled.`,
      cite: ['ORA.16867', 'FSFO.TARGET_VERIFIED_ON_ENABLE'],
      ora: 'ORA-16867',
    }));
  }
  return out;
};

export const destRules: Rule[] = [
  netTimeoutLow, reopenZero, maxFailureReset, deprecatedProperties, destinationRange, syncAboveTen,
  fsfoBlocksEdits, removeTargetBlocked,
];
