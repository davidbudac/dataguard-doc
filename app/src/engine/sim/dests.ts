/**
 * Destinations across epochs: REOPEN, MaxFailure, the alternate latch and
 * the choice inside a RedoRoutes group.
 *
 * The documented rules and the one idealization live here, and the
 * idealization is labelled where it is used rather than hidden inside the
 * arithmetic:
 *
 *  - `REOPEN` gates eligibility and the log switch supplies the trigger: redo
 *    transport retries a failed destination at log switch time, once the last
 *    error plus `REOPEN` is less than now. This engine draws the retries at
 *    exact `ReopenSecs` multiples, which is a model of that sentence (the same
 *    idealization the reopen panel carries, footnote 4).
 *  - `MaxFailure` counts CONSECUTIVE failures, and the two editions count
 *    them differently. 19c keeps the 12.1 notes: the count is of attempts to
 *    REESTABLISH the destination, so the initial error is not one of them, and
 *    at the limit "the destination is disabled and there is no further access
 *    until the destination is manually reenabled". 26ai rewrote the notes:
 *    "If MAX_FAILURE is set to 1, no attempts are made to reactivate this
 *    archive destination when it fails", so the initial failure counts, and at
 *    the limit "no further attempts are made to reactivate the archive
 *    destination". Either way the network healing does not bring it back.
 *    Whether a successful reopen resets the counter is not documented; this
 *    engine resets it and says so.
 *  - The documented exception is a destination in a RedoRoutes group (a
 *    GROUP/PRIORITY destination underneath), which re-enters service when it
 *    is found accessible. Inside a group MaxFailure also defaults to 1, not 0.
 *  - The 12.1 `ALT=( ... FALLBACK)` form: "The optional FALLBACK keyword is
 *    used to specify that redo transport to the non-alternate member should be
 *    resumed if it becomes available"; without it the alternate stays in
 *    service, and if it then fails "no redo will be shipped to the terminal
 *    standby databases serviced by the alternate destination". The latch is
 *    carried here; the FALLBACK return is the resolver's.
 *  - Among destinations of equal priority in a group the primary stays where
 *    it is ("Even after FS1 becomes active again, the primary continues
 *    shipping to FS2"), so the choice each group made is carried from one
 *    epoch to the next.
 */

import type { Edition, MemberId, Seconds } from '../ids';
import type { Finding } from '../types/claims';
import type { DestProps, Member, RouteAlternate, TopologyDoc } from '../types/topology';
import type { RedoGraph } from '../types/trace';
import { destProps } from '../types/topology';
import { defaultDestProps } from '../serialize/schema';
import { isParenthesised } from '../redo/parse';
import { activeRule, destKey, expandAll } from '../redo/resolve';

export { destKey };

/** The destination's own properties, or the broker defaults where it has none. */
const propsOf = (m: Member, to: MemberId, inGroup: boolean): DestProps =>
  destProps(m, to) ?? defaultDestProps({ inGroup });

/**
 * How many failed attempts to reestablish a destination end it, or null when
 * MaxFailure is 0 and they never do. 19c counts attempts after the initial
 * error, so it is MaxFailure; 26ai counts the initial failure too, so it is
 * one fewer -- MAX_FAILURE=1 is no retry at all.
 */
export function retryLimit(props: DestProps, edition: Edition): number | null {
  if (props.maxFailure <= 0) return null;
  return edition === '26ai' ? props.maxFailure - 1 : props.maxFailure;
}

/** One authored destination of the rule that is active for this primary. */
export interface AuthoredDest {
  key: string;
  from: MemberId;
  to: MemberId;
  props: DestProps;
  /** The destination was written in a parenthesised RedoRoutes group. */
  inPriorityGroup: boolean;
  alt?: RouteAlternate;
  edition: Edition;
  /** `retryLimit(props, edition)`: failed reopen attempts that end the destination. */
  retryLimit: number | null;
}

/**
 * Every destination the currently active routing rules name, with the
 * destination properties and the group spelling that decide what MaxFailure
 * does to it. `ALL` destinations are included: they are destinations of the
 * primary like any other.
 */
export function authoredDests(doc: TopologyDoc, primary: MemberId): AuthoredDest[] {
  const out: AuthoredDest[] = [];
  const edition = doc.config.edition;
  for (const m of doc.members) {
    if (!m.enabled) continue;
    const act = activeRule(m, primary);
    if (!act) continue;
    for (const g of act.rule.groups) {
      for (const d of g.dests) {
        const inPriorityGroup = isParenthesised(g) && d.target !== 'ALL';
        const targets: MemberId[] = d.target === 'ALL' ? expandAll(doc, m.id, primary) : [d.target];
        for (const to of targets) {
          const props = propsOf(m, to, inPriorityGroup);
          const e: AuthoredDest = {
            key: destKey(m.id, to), from: m.id, to, props, inPriorityGroup,
            edition, retryLimit: retryLimit(props, edition),
          };
          if (d.target !== 'ALL' && d.alt) e.alt = d.alt;
          out.push(e);
        }
      }
    }
  }
  return out;
}

/**
 * The destination each parenthesised group is shipping to, carried into the
 * next epoch: a group that chose this epoch overrides what it chose before,
 * and one that could not choose (nothing usable) keeps its last choice.
 */
export function carryGroupChoice(
  prev: Readonly<Record<string, MemberId>>, graph: RedoGraph,
): Record<string, MemberId> {
  return { ...prev, ...(graph.groupChoice ?? {}) };
}

/**
 * How many attempts to reestablish the destination have failed by `at`.
 *
 * The initial error is not one of them -- MaxFailure counts the attempts to
 * REESTABLISH -- so the first retry falls one REOPEN interval after the error.
 */
export function failedAttempts(downSince: Seconds, at: Seconds, reopenSeconds: Seconds): number {
  const reopen = Math.max(1, reopenSeconds || 0);
  return Math.max(0, Math.floor((at - downSince + 1e-9) / reopen));
}

/** When the counter reaches MaxFailure, in this engine's retry ladder. */
export function disableAt(
  downSince: Seconds, props: DestProps, edition: Edition = '19c',
): Seconds | null {
  const limit = retryLimit(props, edition);
  if (limit === null) return null;
  return downSince + limit * Math.max(1, props.reopenSeconds || 0);
}

/* ---------------- findings ---------------- */

export const maxFailureDisabled = (
  d: AuthoredDest, at: Seconds, fromName: string, toName: string,
): Finding => (d.edition === '26ai'
  ? {
    id: 'DEST.MAX_FAILURE_DISABLED', severity: 'warning', basis: 'documented',
    cite: ['DEST.MAX_FAILURE_26AI', 'DEST.MAX_FAILURE'],
    subject: { kind: 'member', id: d.to as string },
    message: `${fromName} has given up on the destination to ${toName} at ${at} s: MaxFailure is ${d.props.maxFailure}, and under 26ai the initial failure counts, so ${d.props.maxFailure === 1 ? 'no attempt is made to reactivate it' : `the ${d.props.maxFailure - 1} reactivation attempt${d.props.maxFailure - 1 === 1 ? '' : 's'} after it failed too`}. No further attempts are made to reactivate the destination -- the network healing does not bring it back.`,
  }
  : {
    id: 'DEST.MAX_FAILURE_DISABLED', severity: 'warning', basis: 'documented',
    cite: ['DEST.MAX_FAILURE', 'DEST.MAX_FAILURE_DISABLED_19C'],
    subject: { kind: 'member', id: d.to as string },
    message: `${fromName} has disabled the destination to ${toName} at ${at} s: MaxFailure is ${d.props.maxFailure}, and that many consecutive attempts to reestablish it have failed. There is no further access to the destination until it is manually reenabled -- the network healing does not bring it back, and the destination is then treated as if REOPEN had not been specified.`,
  });

export const groupReenters = (
  d: AuthoredDest, fromName: string, toName: string,
): Finding => ({
  id: 'DEST.GROUP_PRIORITY_REENTER', severity: 'info', basis: 'documented',
  cite: ['DEST.GROUP_PRIORITY_REENTER', 'DEST.MAX_FAILURE'],
  subject: { kind: 'member', id: d.to as string },
  message: `${fromName} has reached MaxFailure on the destination to ${toName}, but the destination is written in a priority group: from 12.2 such a destination re-enters service when it is found accessible instead of staying disabled until it is manually reenabled.`,
});

export const reopenScheduleModel = (): Finding => ({
  id: 'DEST.REOPEN_SCHEDULE_MODEL', severity: 'info', basis: 'model',
  cite: ['DEST.REOPEN', 'DEST.MAX_FAILURE'],
  subject: { kind: 'config' },
  message: 'Retries of a failed destination are drawn at exact ReopenSecs multiples after the error.',
  note: 'REOPEN gates eligibility and the log switch supplies the trigger -- redo transport retries a failed destination at log switch time, once the last error plus REOPEN is less than now -- so the real attempts fall on redo activity rather than on a metronome. Drawing them at exact multiples is this page\'s idealization, and it is what decides the instant a MaxFailure limit is reached here.',
});

export const maxFailureResetUndoc = (
  toName: string, at: Seconds,
): Finding => ({
  id: 'DEST.MAXFAILURE_RESET_UNDOC', severity: 'info', basis: 'model',
  cite: ['DEST.MAX_FAILURE'],
  subject: { kind: 'member', id: toName },
  message: `The destination to ${toName} was reachable again at ${at} s, and this engine started its MaxFailure count over.`,
  note: 'MaxFailure counts CONSECUTIVE attempts, which implies a successful reopen starts the count over -- but the documentation does not say so, so the reset is this engine\'s reading rather than a documented rule.',
});

export const alternateLatched = (
  d: AuthoredDest, fromName: string, toName: string, altName: string,
): Finding => ({
  id: 'ROUTES.ALT_LATCHED', severity: 'info', basis: 'documented',
  cite: ['ROUTES.FALLBACK_121', 'ROUTES.GRAMMAR_121'],
  subject: { kind: 'route', id: d.from as string },
  message: `${fromName} declares the alternate to ${altName} without FALLBACK, so it keeps shipping there even after ${toName} is reachable again -- and if ${altName} fails, no redo is shipped to the members it serves. That is the 12.1 ALT form, which the 12.2, 19c and 26ai grammar no longer carries.`,
});
