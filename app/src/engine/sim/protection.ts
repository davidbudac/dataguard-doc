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
 * A primary is STALLED when it can reach NEITHER the observer NOR the target
 * standby. Losing the observer alone stalls nothing.
 */
export const stallClaim = (stalled: boolean): Claim<boolean> =>
  documented(stalled, ['OBS.LOSS_ALONE_STALLS_NOTHING', 'FSFO.PMY_SHUTDOWN'],
    'The primary stalls only when it can reach neither the observer nor the target standby; reaching either one is enough to keep committing.');

/**
 * FastStartFailoverPmyShutdown, default TRUE: a primary stalled longer than
 * the threshold, unable to reach observer or target standby, aborts itself.
 * The stall clock always runs on the threshold, even where the ping properties
 * have replaced it for the observer's detection.
 */
export const abortClaim = (at: Seconds, thresholdSeconds: Seconds): Claim<Seconds> =>
  documented(at, ['FSFO.PMY_SHUTDOWN', 'FSFO.THRESHOLD'],
    `FastStartFailoverPmyShutdown is TRUE, so the stalled primary aborts itself one FastStartFailoverThreshold (${thresholdSeconds} s) after the stall began. The ping properties never move this clock -- the quirk applies to the observer's detection only.`);

/**
 * In an ordinary transport failure NET_TIMEOUT bounds the commit hang and the
 * primary drops the destination and carries on. In a fast-start failover stall
 * it does not: the stall overrides that behaviour, and at the default settings
 * NET_TIMEOUT and the threshold both run 30 s from the failure and expire
 * together.
 */
export const commitHangClaim = (untilSeconds: Seconds, stalled: boolean): Claim<Seconds> =>
  documented(untilSeconds, ['DEST.NET_TIMEOUT', 'OBS.LOSS_ALONE_STALLS_NOTHING'],
    stalled
      ? 'The commit hang spans the whole stall: in full isolation the fast-start failover stall overrides NET_TIMEOUT\'s drop-and-continue behaviour.'
      : 'NET_TIMEOUT bounds how long LGWR waits for the standby\'s SYNC acknowledgement before the destination is dropped and the primary carries on. It is never a failover clock.');

export const modeName = (m: ProtectionMode): string =>
  m === 'MAXPROTECTION' ? 'maximum protection'
    : m === 'MAXAVAILABILITY' ? 'maximum availability' : 'maximum performance';
