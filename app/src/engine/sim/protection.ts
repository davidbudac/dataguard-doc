/**
 * Protection modes inside the epoch loop -- engine design SS3.9 and SS4.
 *
 * Three separate rules live here, and they are deliberately not collapsed into
 * one:
 *
 *  - Maximum availability has an explicit sentence: without an acknowledgement
 *    from at least one synchronized standby it "operates as if it were in
 *    maximum performance mode". It never shuts the primary down.
 *  - Maximum protection has the opposite one: it "shuts the primary database
 *    down rather than allowing it to continue". WHEN it does so is not
 *    documented, so the instant this engine draws is a model.
 *  - NET_TIMEOUT bounds how long LGWR waits for a SYNC acknowledgement. It is
 *    never a failover clock, and in a full fast-start failover stall the stall
 *    overrides its drop-and-continue behaviour.
 */

import type { Claim } from '../types/claims';
import { documented, model } from '../types/claims';
import type { CitationId } from '../citations';
import type { MemberId, Seconds } from '../ids';
import type { ProtectionMode, TopologyDoc } from '../types/topology';
import { isDatabase } from '../types/topology';
import type { ProtectionLevel, RedoGraph } from '../types/trace';

/** Members the primary is shipping to synchronously right now, over a live link. */
export function syncAckMembers(graph: RedoGraph): MemberId[] {
  return graph.edges
    .filter((e) => e.from === graph.primary && e.active && e.up
      && (e.xpt === 'SYNC' || e.xpt === 'FASTSYNC'))
    .map((e) => e.to);
}

/** The same set, restricted to databases: what maximum protection rests on. */
export function syncAckDatabases(doc: TopologyDoc, graph: RedoGraph): MemberId[] {
  return syncAckMembers(graph).filter((id) => {
    const m = doc.members.find((x) => x.id === id);
    return !!m && isDatabase(m);
  });
}

export function levelNow(graph: RedoGraph): Claim<ProtectionLevel> {
  return graph.protectionLevel;
}

/**
 * The level a degraded maximum availability configuration is drawn at, with
 * the label it has earned.
 *
 * Oracle's sentence is about behaviour: without an acknowledgement from at
 * least one synchronized standby the primary "operates as if it were in
 * maximum performance mode". What V$DATABASE.PROTECTION_LEVEL -- and with it
 * the broker -- REPORTS meanwhile is a different question, and no page
 * answers it: the reference lists RESYNCHRONIZATION as a value of its own
 * beside MAXIMUM PERFORMANCE and does not say when either shows. So the
 * MAXPERFORMANCE drawn here is this page's reading of "operates as if", and
 * it must not carry a `documented` label.
 */
export function honestLevel(
  level: Claim<ProtectionLevel>, configured: ProtectionMode,
): Claim<ProtectionLevel> {
  if (configured !== 'MAXAVAILABILITY' || level.value !== 'MAXPERFORMANCE') return level;
  const cite = [...new Set<CitationId>([...level.cite, 'MAXAVAIL.AT_LEAST_ONE', 'LEVEL.RESYNCHRONIZATION'])];
  return model<ProtectionLevel>('MAXPERFORMANCE',
    `PROT.DEGRADED_LEVEL: the documented sentence is about behaviour -- without an acknowledgement from at least one synchronized standby, maximum availability "operates as if it were in maximum performance mode". Which value V$DATABASE.PROTECTION_LEVEL shows meanwhile is not stated on any page: the reference lists RESYNCHRONIZATION as a value of its own beside MAXIMUM PERFORMANCE without saying when each applies. MAXPERFORMANCE is this page's reading of "operates as if", not a level the broker is documented to report.${level.note ? ` ${level.note}` : ''}`,
    cite);
}

/**
 * The protection mode the new primary runs in after a failover out of maximum
 * protection. Three documented cases, and they differ:
 *
 *  - fast-start failover: the configuration's mode is preserved, "but the new
 *    primary database is set to maximum availability to allow the instance to
 *    open" (19c and 26ai);
 *  - manual failover with fast-start failover disabled: "it is reset to
 *    maximum performance" (19c and 26ai);
 *  - manual failover with fast-start failover enabled: 19c "preserves the
 *    protection mode that was in effect prior to the failover", 26ai adds
 *    "unless the protection mode was max protection. In this case the broker
 *    sets the protection mode to maximum availability".
 *
 * Every other mode is unchanged by a failover, and a switchover changes none.
 */
export function modeAfterFailover(
  doc: TopologyDoc, how: 'fsfo' | 'manual', fsfoEnabled: boolean,
): Claim<ProtectionMode> | null {
  if (doc.config.protectionMode !== 'MAXPROTECTION') return null;
  if (how === 'fsfo') {
    return documented<ProtectionMode>('MAXAVAILABILITY', ['MODE.AFTER_FSFO_MAXPROT'],
      'The configuration was in maximum protection mode. The broker preserves the configuration protection mode, but the new primary database is set to maximum availability to allow the instance to open; it is elevated again when a standby that supports maximum protection is available.');
  }
  if (!fsfoEnabled) {
    return documented<ProtectionMode>('MAXPERFORMANCE', ['MODE.AFTER_MANUAL_MAXPROT'],
      'The configuration was in maximum protection mode, and after a manual failover it is reset to maximum performance. The protection mode can be upgraded again later.');
  }
  if (doc.config.edition === '26ai') {
    return documented<ProtectionMode>('MAXAVAILABILITY', ['MODE.AFTER_MANUAL_FSFO_26AI'],
      'A manual failover with fast-start failover enabled preserves the protection mode unless it was maximum protection: the broker then sets it to maximum availability and upgrades it later, when a synchronized physical standby database is available.');
  }
  return documented<ProtectionMode>('MAXPROTECTION', ['MODE.AFTER_MANUAL_MAXPROT', 'MODE.AFTER_MANUAL_FSFO_26AI'],
    'A manual failover with fast-start failover enabled: the 19c note says only that the broker preserves the protection mode that was in effect prior to the failover. The 26ai page adds the maximum protection exception; 19c does not carry it.');
}

/**
 * The documented degradation. Maximum availability keeps the primary running;
 * only the level drops.
 */
export const maxAvailDegraded = (acks: number): Claim<boolean> =>
  documented(acks === 0, ['MAXAVAIL.AT_LEAST_ONE'],
    'If the primary does not receive acknowledgement from at least one synchronized standby, then it operates as if it were in maximum performance mode.');

/**
 * Maximum protection with no synchronous acknowledgement left. The shutdown
 * itself is documented; the instant is not, so it is drawn one NET_TIMEOUT
 * after the last acknowledgement and labelled as this page's model.
 */
export function maxProtectionShutdown(
  lastAckAt: Seconds, netTimeoutSeconds: Seconds,
): Claim<Seconds> {
  return model(lastAckAt + netTimeoutSeconds,
    'PROT.MAXPROT_SHUTDOWN_TIMING: maximum protection mode "shuts the primary database down rather than allowing it to continue" -- that much is documented. How long the primary waits first is not, so this engine draws it one NET_TIMEOUT after the last synchronous acknowledgement, which is the documented bound on how long LGWR waits for that acknowledgement. Oracle recommends a minimum of two standby databases so that a single standby failure cannot do this.',
    ['MAXPROT.SHUTS_PRIMARY', 'MAXPROT.TWO_STANDBYS', 'DEST.NET_TIMEOUT']);
}

/** The primary's NetTimeout for one destination; the broker default is 30 s. */
export function netTimeoutOf(doc: TopologyDoc, from: MemberId, to: MemberId): Seconds {
  const m = doc.members.find((x) => x.id === from);
  const d = m?.dests[to];
  return d ? d.netTimeoutSeconds : 30;
}

/** The shortest NetTimeout among the primary's synchronous destinations. */
export function netTimeoutForMode(doc: TopologyDoc, graph: RedoGraph): Seconds {
  const dests = Object.keys(doc.members.find((m) => m.id === graph.primary)?.dests ?? {});
  const values = dests.map((d) => netTimeoutOf(doc, graph.primary, d as MemberId));
  return values.length > 0 ? Math.min(...values) : 30;
}

/**
 * A primary is STALLED when the change to UNSYNCHRONIZED or TARGET OVER LAG
 * LIMIT "cannot be confirmed by either the target standby database or the
 * observer": it has lost the target, and it reaches neither of the two that
 * could record that fast-start failover cannot happen. Losing the observer
 * alone stalls nothing, and neither does losing the two at different times --
 * a configuration that is already unobserved, or a target that is already
 * not ready, leaves nothing to confirm.
 */
export const stallClaim = (stalled: boolean): Claim<boolean> =>
  documented(stalled, ['FSFO.STATUS_STALLED', 'OBS.LOSS_ALONE_STALLS_NOTHING', 'FSFO.PMY_SHUTDOWN'],
    'The primary stalls when it has lost the target standby and neither the target nor the observer can confirm the change of state -- it reaches neither of them; reaching either one is enough to keep committing. An outage of the observer and of the standby at different times stalls nothing.');

/** The primary reaches nobody and keeps running, because nothing is left to confirm. */
export function noStallClaim(why: 'unobserved' | 'not-ready', lagGate: boolean): Claim<string> {
  if (why === 'unobserved') {
    return documented(
      'The primary reaches neither the observer nor the target standby, and it keeps processing transactions: the configuration was already unobserved, so fast-start failover cannot happen and there is nothing to stall for.',
      ['FSFO.UNOBSERVED_CONTINUES', 'OBS.OUTAGE_DIFFERENT_TIMES'],
      'While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails.');
  }
  return documented(
    `The primary reaches neither the observer nor the target standby, and it keeps processing transactions: the target was already ${lagGate ? 'TARGET OVER LAG LIMIT' : 'UNSYNCHRONIZED'}, so no change of state is waiting to be confirmed and fast-start failover is not possible.`,
    ['FSFO.STATUS_STALLED', 'OBS.OUTAGE_DIFFERENT_TIMES', 'FSFO.GUARANTEE_STALL'],
    'STALLED is the state of a primary whose change to UNSYNCHRONIZED or TARGET OVER LAG LIMIT cannot be confirmed. Here it had been recorded before the observer was lost: the outage of the standby and of the observer at different times does not impact the availability of the primary database.');
}

/**
 * FastStartFailoverPmyShutdown, default TRUE: a primary stalled longer than
 * the threshold, unable to reach observer or target standby, shuts down --
 * Oracle's verb ("the primary database will shut down after
 * FastStartFailoverThreshold seconds has elapsed"); the state is `aborted`.
 * The documented part is the rule; the instant is a model (the threshold is
 * counted from the stall's onset, which is this page's placement). The stall
 * clock runs on the threshold even where the ping properties have replaced it
 * for the observer's detection -- that, too, is this page's reading.
 */
export const abortClaim = (at: Seconds, thresholdSeconds: Seconds): Claim<Seconds> =>
  model(at,
    `PRIMARY.ABORT_TIMING: FastStartFailoverPmyShutdown is TRUE, so the stalled primary shuts down once it has been STALLED for longer than FastStartFailoverThreshold (${thresholdSeconds} s) -- that rule is documented ("The primary database shuts down if fast-start failover is enabled and V$DATABASE.FS_FAILOVER_STATUS indicates the primary has been STALLED for longer than FastStartFailoverThreshold seconds"). When the stall begins is this page's: the engine stalls an isolated primary at the instant it loses both the observer and the target standby, with no NET_TIMEOUT hang first, so the instant drawn here rests on that placement.`,
    ['FSFO.PMY_SHUTDOWN', 'FSFO.THRESHOLD']);

/** What ends a commit hang: the destination is dropped, or maximum protection has nothing left to write to. */
export type CommitHangEnd = 'drop' | 'drop-another-remains' | 'shutdown';

export function commitHangText(untilSeconds: Seconds, stalled: boolean, end: CommitHangEnd): string {
  if (stalled) {
    return 'The commit hang spans the whole stall: in full isolation the fast-start failover stall overrides NET_TIMEOUT\'s drop-and-continue behaviour.';
  }
  const wait = `Commits wait for the synchronous acknowledgement until NET_TIMEOUT expires at ${untilSeconds} s`;
  switch (end) {
    case 'shutdown':
      return `${wait}. No synchronized standby is left, and maximum protection does not carry on without one: the primary shuts down rather than continue processing transactions.`;
    case 'drop-another-remains':
      return `${wait}, and the primary then drops that destination and carries on: another synchronized standby still receives its redo, and maximum protection shuts the primary down only when it cannot write to at least one.`;
    default:
      return `${wait}, and the primary then drops the destination and carries on.`;
  }
}

/**
 * In an ordinary transport failure NET_TIMEOUT bounds the commit hang. What
 * follows depends on the mode: the destination is dropped and the primary
 * carries on (maximum availability, or maximum protection while another
 * synchronized standby remains), or maximum protection shuts the primary down.
 * In a fast-start failover stall NET_TIMEOUT does not end the hang: the stall
 * overrides that behaviour, and at the default settings NET_TIMEOUT and the
 * threshold both run 30 s from the failure and expire together.
 */
export const commitHangClaim = (
  untilSeconds: Seconds, stalled: boolean, end: CommitHangEnd = 'drop',
): Claim<Seconds> =>
  documented(untilSeconds,
    end === 'drop' || stalled
      ? ['DEST.NET_TIMEOUT', 'OBS.LOSS_ALONE_STALLS_NOTHING']
      : ['DEST.NET_TIMEOUT', 'OBS.LOSS_ALONE_STALLS_NOTHING', 'MAXPROT.AT_LEAST_ONE_BROKER'],
    commitHangText(untilSeconds, stalled, end));

export const modeName = (m: ProtectionMode): string =>
  m === 'MAXPROTECTION' ? 'maximum protection'
    : m === 'MAXAVAILABILITY' ? 'maximum availability' : 'maximum performance';
