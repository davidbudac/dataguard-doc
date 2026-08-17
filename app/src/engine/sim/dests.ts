/**
 * Destinations across epochs: REOPEN, MaxFailure and the alternate latch.
 *
 * Three documented rules and one idealization live here, and the idealization
 * is labelled where it is used rather than hidden inside the arithmetic:
 *
 *  - `REOPEN` gates eligibility and the log switch supplies the trigger: redo
 *    transport retries a failed destination at log switch time, once the last
 *    error plus `REOPEN` is less than now. This engine draws the retries at
 *    exact `ReopenSecs` multiples, which is a model of that sentence (the same
 *    idealization the reopen panel carries, footnote 4).
 *  - `MaxFailure` counts CONSECUTIVE attempts to reestablish the destination.
 *    At the limit the destination is disabled with no further access until it
 *    is MANUALLY reenabled -- the network healing does not bring it back.
 *    Whether a successful reopen resets the counter is not documented; this
 *    engine resets it and says so.
 *  - The one documented exception is a 12.2+ GROUP/PRIORITY destination, which
 *    re-enters service when it is found accessible.
 *
 * The alternate's FALLBACK keyword is documented as grammar (12.1 broker
 * chapter 4). What the two spellings do afterwards -- the named destination
 * coming back with FALLBACK, the alternate staying in service without it -- is
 * not a sentence anywhere that was verified, so it is this engine's reading and
 * every run that takes it says so.
 */

import type { MemberId, Seconds } from '../ids';
import type { Finding } from '../types/claims';
import type { DestProps, Member, RouteAlternate, TopologyDoc } from '../types/topology';
import { destProps } from '../types/topology';
import { defaultDestProps } from '../serialize/schema';
import { activeRule, destKey } from '../redo/resolve';

export { destKey };

/** The destination's own properties, or the broker defaults where it has none. */
const propsOf = (m: Member, to: MemberId): DestProps => destProps(m, to) ?? defaultDestProps();

/** One authored destination of the rule that is active for this primary. */
export interface AuthoredDest {
  key: string;
  from: MemberId;
  to: MemberId;
  props: DestProps;
  /** The destination was written in a parenthesised PRIORITY group. */
  inPriorityGroup: boolean;
  alt?: RouteAlternate;
}

/**
 * Every destination the currently active routing rules name, with the
 * destination properties and the group spelling that decide what MaxFailure
 * does to it. `ALL` destinations are included: they are destinations of the
 * primary like any other.
 */
export function authoredDests(doc: TopologyDoc, primary: MemberId): AuthoredDest[] {
  const out: AuthoredDest[] = [];
  for (const m of doc.members) {
    if (!m.enabled) continue;
    const act = activeRule(m, primary);
    if (!act) continue;
    for (const g of act.rule.groups) {
      const inPriorityGroup = g.explicitGroup === true || g.priority !== undefined;
      for (const d of g.dests) {
        const targets: MemberId[] = d.target === 'ALL'
          ? doc.members.filter((x) => x.enabled && x.id !== m.id && x.id !== primary).map((x) => x.id)
          : [d.target];
        for (const to of targets) {
          const e: AuthoredDest = {
            key: destKey(m.id, to), from: m.id, to, props: propsOf(m, to), inPriorityGroup,
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
export function disableAt(downSince: Seconds, props: DestProps): Seconds | null {
  if (props.maxFailure <= 0) return null;
  return downSince + props.maxFailure * Math.max(1, props.reopenSeconds || 0);
}

/* ---------------- findings ---------------- */

export const maxFailureDisabled = (
  d: AuthoredDest, at: Seconds, fromName: string, toName: string,
): Finding => ({
  id: 'DEST.MAX_FAILURE_DISABLED', severity: 'warning', basis: 'documented',
  cite: ['DEST.MAX_FAILURE'],
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
  id: 'ROUTES.ALT_LATCHED', severity: 'info', basis: 'model',
  cite: ['ROUTES.GRAMMAR_121', 'ROUTES.ALT_MAXFAILURE'],
  subject: { kind: 'route', id: d.from as string },
  message: `${fromName} declares the alternate to ${altName} without FALLBACK, so this run keeps shipping there even after ${toName} is reachable again.`,
  note: 'The grammar is documented -- ALT=(name [xpt] [FALLBACK]) -- and the keyword is what tells the two spellings apart. What each one does afterwards is not stated on any page that was verified, so this engine reads FALLBACK as "the named destination returns once it is usable again" and its absence as "the alternate stays in service until someone changes it", and says so wherever it acts on it.',
});
