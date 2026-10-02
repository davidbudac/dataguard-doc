/**
 * The sentence under a setting, once.
 *
 * The inspector's forms print these under a control, and the timeline's
 * chips and popovers carry the same words as the control's tooltip: a value edited
 * from either place is described by one sentence, never by two that could
 * drift. Nothing here is a claim the forms did not already make; the accuracy
 * rules for them (AGENTS.md) apply where they are defined, not where they are
 * reused.
 */

import { lagLimitIsSet, lagLimitOf } from '@/engine';
import type { TopologyDoc } from '@/engine';

export const PROTECTION_NOTE =
  'Broker table 4-2 lists the transports each mode takes: SYNC under maximum protection, SYNC or FASTSYNC under maximum availability, and ASYNC as the only mode listed for maximum performance.';

export function fsfoStateNote(state: TopologyDoc['config']['fsfo']['state']): string {
  return state === 'observe-only'
    ? 'ENABLE FAST_START FAILOVER OBSERVE ONLY: the observer watches, records what it would have done, and never fails over.'
    : state === 'disabled'
      ? 'Disabled is not the same as unobserved. With fast-start failover disabled a manual FAILOVER TO is the only thing that promotes a standby, and it needs no observer.'
      : "Failover needs both the observer and the target standby to have lost the primary for the threshold, plus the target standby's readiness check. This page draws ObserverOverride at FALSE, the broker default.";
}

export const THRESHOLD_NOTE =
  "Default 30 s, minimum 6 s. The clock starts when the observer first loses its connection to the primary, and the isolated primary's own stall clock always uses it. “If you have an Oracle RAC primary database, consider specifying a higher value to minimize the possibility of a false failover in the event of an instance failure.” The HA guide's table puts the RAC figure at “Oracle RAC miscount + reconfiguration time + 30 seconds”.";

export function lagLimitNote(doc: TopologyDoc): string {
  const f = doc.config.fsfo;
  const ed = doc.config.edition;
  const avail = doc.config.protectionMode === 'MAXAVAILABILITY';
  const limit = lagLimitOf(doc);
  return (lagLimitIsSet(f) ? '' : 'Not set: the broker default for this edition and mode applies. ')
    + (limit > f.thresholdSeconds
      ? 'Oracle recommends the lag limit at or below the threshold: past it the old primary can keep committing after fast-start failover is initiated, briefly risking two primaries.'
      : ed === '26ai' && avail
        ? '26ai gives maximum availability a lag limit too, with a broker default of 0 -- the standby must have received everything and the failover is zero-loss. Any non-zero value, minimum 5 s, makes it bounded-loss. Oracle\'s own page also says a value must be at least 5, which the default of 0 sits below; the two are not reconciled. The role arrived in 21c; 26ai\'s own contribution is the per-mode default.'
        : ed === '19c' && avail
          ? 'Under 19c this control is greyed because the property page and the fast-start failover chapter disagree about whether it reaches maximum availability at all -- see the why-pill. Default 30 s, minimum 5 s.'
          : 'Default 30 s, minimum 5 s. Failover is permitted while the gated lag stays within it.');
}

export const ROLE_TRANSITION_NOTE =
  "Terminal recovery, the role change and the open are environment-dependent, not parameter-driven. This is the drawing's constant for them.";

export const APPLY_LAG_NOTE =
  'Redo this standby holds but has not applied. It lengthens the catch-up a role change pays; it does not make the standby unsynchronized.';

export const LOG_XPT_NOTE =
  'How this member receives redo. Broker default ASYNC. SYNC maps to SYNC + AFFIRM, FASTSYNC to SYNC + NOAFFIRM, ASYNC to ASYNC + NOAFFIRM: AFFIRM acknowledges received redo after writing it to the standby redo log, NOAFFIRM before that write.';
