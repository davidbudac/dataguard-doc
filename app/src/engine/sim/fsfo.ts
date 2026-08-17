/**
 * The fast-start failover decision kernel -- engine design SS4.
 *
 * Every rule in here is one of the verified ones, and where the documentation
 * stops the value carries a model label instead:
 *
 *  - failover needs BOTH the master observer and the target standby to have
 *    lost the primary (ObserverOverride is FALSE, the broker default, and this
 *    engine models the default only),
 *  - the master observer has to reach the target to order anything at all,
 *  - the readiness gate is "synchronized" in maximum availability and maximum
 *    protection, and the lag limit in maximum performance -- and, from 26ai,
 *    in a maximum availability configuration whose lag limit is non-zero,
 *  - the primary's own stall clock always runs on the threshold, even when the
 *    ping properties replace the threshold for the observer's detection.
 */

import { NOMINAL } from '../defaults';
import type { Claim } from '../types/claims';
import { documented, inferred, model } from '../types/claims';
import { assertCitesAllowed } from '../citations';
import type { CitationId } from '../citations';
import type { HostId, MemberId, ObserverId, Seconds } from '../ids';
import type { Member, TopologyDoc } from '../types/topology';
import { isDatabase } from '../types/topology';
import type { SimState } from './kernel';

/* ---------------- properties and their arithmetic ---------------- */

/**
 * FastStartFailoverLagType is documented as maximum-performance-mode
 * behaviour, and it did not follow the lag limit into maximum availability
 * when 26ai gave the limit a role there. Anything else therefore reads APPLY.
 */
export function effectiveLagType(doc: TopologyDoc): 'APPLY' | 'TRANSPORT' {
  const is26 = doc.config.edition === '26ai';
  const maxperf = doc.config.protectionMode === 'MAXPERFORMANCE';
  return is26 && maxperf && doc.config.fsfo.lagType === 'TRANSPORT' ? 'TRANSPORT' : 'APPLY';
}

/**
 * Is FastStartFailoverLagLimit the readiness gate here?
 *
 * Maximum performance always. Maximum availability only from 26ai and only
 * with a non-zero limit: zero is the broker default there and is the 19c rule
 * spelled as a number -- the standby must have received everything.
 *
 * Source: the 26ai fast-start failover chapter's "Fast-start Failover
 * Protection Modes" section. Never that chapter's Task 3 and never the
 * property page's closing line, both of which still carry the stale
 * "maximum performance mode only" sentence; `assertCitesAllowed` is what
 * keeps either of them from creeping into this claim.
 */
const LAG_GATE_CITES: CitationId[] = ['FSFO.LAGLIMIT_MAXAVAIL_26AI'];
assertCitesAllowed('LAG_LIMIT_MODE', LAG_GATE_CITES);

export function lagGated(doc: TopologyDoc): boolean {
  const mode = doc.config.protectionMode;
  if (mode === 'MAXPERFORMANCE') return true;
  return doc.config.edition === '26ai'
    && mode === 'MAXAVAILABILITY'
    && doc.config.fsfo.lagLimitSeconds > 0;
}

export const pingPropertiesSet = (doc: TopologyDoc): boolean =>
  doc.config.fsfo.pingIntervalMs !== null && doc.config.fsfo.pingRetry !== null;

/**
 * Detection. The documented part is that the threshold is ignored for the
 * observer's detection once BOTH ping properties are explicitly set, and that
 * detection "can be reduced to nearly 1 second". No arithmetic appears
 * anywhere in the documentation, so interval x (retry + 1) -- the first failed
 * ping plus its retries -- is this page's model of that sentence.
 */
export function detectClaim(doc: TopologyDoc): Claim<Seconds> {
  const f = doc.config.fsfo;
  if (f.pingIntervalMs !== null && f.pingRetry !== null) {
    return model(
      (f.pingIntervalMs * (f.pingRetry + 1)) / 1000,
      'FSFO.PING_ARITHMETIC: ObserverPingInterval x (ObserverPingRetry + 1) -- the first failed ping plus its retries. The documentation states only that the threshold is ignored once both properties are set and that detection can be reduced to nearly 1 second; the arithmetic is this page\'s model and is never a quoted figure.',
      ['FSFO.PING_PROPS_21C', 'FSFO.PING_NEARLY_ONE_SECOND'],
    );
  }
  return model(
    NOMINAL.firstPingSeconds,
    'The first failed ping, effectively immediate. A nominal drawing constant, not a documented number.',
    ['FSFO.PING_PROPS_21C'],
  );
}

/** How long after losing the primary the master observer initiates. */
export function initiateDelayClaim(doc: TopologyDoc): Claim<Seconds> {
  if (pingPropertiesSet(doc)) {
    const d = detectClaim(doc);
    return model(
      d.value,
      `The ping properties are both set, so the threshold is ignored for the observer's detection. ${d.note ?? ''}`.trim(),
      ['FSFO.PING_PROPS_21C', 'FSFO.PING_NEARLY_ONE_SECOND'],
    );
  }
  return documented(
    doc.config.fsfo.thresholdSeconds,
    ['FSFO.THRESHOLD', 'FSFO.BOTH_MUST_HAVE_LOST'],
  );
}

/* ---------------- lag ---------------- */

/**
 * The lag the readiness check gates on. Under TRANSPORT it is the redo the
 * standby has not yet received, clamped to the apply lag because applied redo
 * must have arrived first; otherwise it is the apply lag.
 */
export function gateLagSeconds(doc: TopologyDoc, m: Member, state?: SimState): Seconds {
  const apply = applyLagOf(m, state);
  if (effectiveLagType(doc) !== 'TRANSPORT') return apply;
  return Math.max(0, Math.min(transportLagOf(m, state), apply));
}

export function applyLagOf(m: Member, state?: SimState): Seconds {
  const override = state?.applyLag[m.id as string];
  if (override !== undefined) return override;
  return isDatabase(m) ? m.applyLagSeconds : 0;
}

export function transportLagOf(m: Member, state?: SimState): Seconds {
  const override = state?.transportLag[m.id as string];
  if (override !== undefined) return override;
  return m.transportLagSeconds;
}

/* ---------------- the readiness gate ---------------- */

export interface Readiness {
  passes: boolean;
  claim: Claim<boolean>;
  gateLag: Seconds;
}

/**
 * The standby's readiness check. `latchedSync` is what the target was worth
 * the last time redo actually reached it: synchronized is a statement about
 * redo received, so a link that has just been cut does not un-synchronize the
 * redo the standby already holds.
 */
export function readinessGate(
  doc: TopologyDoc, target: Member, latchedSync: boolean, state?: SimState,
): Readiness {
  const gateLag = gateLagSeconds(doc, target, state);
  if (lagGated(doc)) {
    const limit = doc.config.fsfo.lagLimitSeconds;
    const passes = gateLag <= limit;
    return {
      passes,
      gateLag,
      claim: documented(passes, LAG_GATE_CITES.concat(['FSFO.LAGTYPE']),
        `${effectiveLagType(doc)} lag ${gateLag} s against a FastStartFailoverLagLimit of ${limit} s: failover is possible any time the lag is at or below the limit.`),
    };
  }
  return {
    passes: latchedSync,
    gateLag,
    claim: documented(latchedSync, ['FSFO.BOTH_MUST_HAVE_LOST', 'MAXAVAIL.AT_LEAST_ONE', 'XPT.TABLE_4_2'],
      latchedSync
        ? 'The target standby is synchronized, which is what maximum availability and maximum protection ask of it.'
        : 'The target standby is not synchronized, and in maximum availability or maximum protection mode that is the readiness check fast-start failover has to pass.'),
  };
}

/* ---------------- observers ---------------- */

export const observerHostUp = (
  doc: TopologyDoc, id: ObserverId, hostAlive: (h: HostId) => boolean,
): boolean => {
  const o = doc.observers.find((x) => x.id === id);
  return !!o && hostAlive(o.host);
};

/**
 * Which observer is coordinating. Only the master observer can coordinate
 * fast-start failover; PreferredObserverHosts, where it is set, decides which
 * hosts may observe at all and in what order (lower priority number wins).
 */
export function pickMaster(
  doc: TopologyDoc, state: SimState, hostAlive: (h: HostId) => boolean,
): ObserverId | null {
  const eligible = doc.observers.filter((o) => {
    const s = state.observers[o.id];
    return !!s && s.running && hostAlive(o.host) && preferredRank(doc, o.host) !== null;
  });
  if (eligible.length === 0) return null;
  if (state.masterOverride) {
    const forced = eligible.find((o) => o.id === state.masterOverride);
    if (forced) return forced.id;
  }
  const scored = eligible
    .map((o, i) => ({
      o, i,
      rank: preferredRank(doc, o.host) ?? 8,
      declared: (state.observers[o.id]?.role ?? o.role) === 'master' ? 0 : 1,
    }))
    .sort((a, b) => a.rank - b.rank || a.declared - b.declared || a.i - b.i);
  return scored[0]?.o.id ?? null;
}

/**
 * PreferredObserverHosts: "Only observers running on hosts specified ... will
 * observe databases and become the master observer"; host:priority, 1 to 8,
 * lower is higher priority, default Null. Null means every host qualifies.
 */
export function preferredRank(doc: TopologyDoc, host: HostId): number | null {
  const list = doc.config.fsfo.preferredObserverHosts;
  if (!list || list.length === 0) return 8;
  const hit = list.find((p) => p.host === host);
  return hit ? hit.priority : null;
}

export const preferredHostsClaim = (doc: TopologyDoc): Claim<boolean> => {
  const set = (doc.config.fsfo.preferredObserverHosts ?? []).length > 0;
  return {
    value: set,
    basis: 'documented',
    cite: ['OBS.PREFERRED_HOSTS'],
    note: 'PreferredObserverHosts is documented on the 19c broker properties page (and again on the 26ai property page).',
  };
};

/**
 * The nomination rule, with the precondition it is always quoted with: if the
 * primary and target standby databases stay connected but the connection to
 * the master observer is lost, the broker TRIES to nominate a backup observer
 * as the new master. It is an attempt under that precondition, never a
 * guarantee, and never extends to a failure that separates the primary from
 * the target standby.
 */
export function nominationClaim(precondition: boolean, attempted: boolean): Claim<boolean> {
  if (!precondition) {
    return documented(false, ['OBS.NOMINATION_PRECONDITION', 'FSFO.PRIMARY_UNOBSERVED'],
      'The primary and the target standby are not both connected, so the documented nomination case does not apply: the configuration is reported unobserved instead.');
  }
  return model(attempted,
    'NOMINATION.PRECONDITION: the precondition is documented and so is the attempt -- "the broker tries to nominate a backup observer as the new master observer". How long the attempt takes, and whether it succeeds, is not documented; this engine nominates at the instant the master is lost and says so.',
    ['OBS.NOMINATION_PRECONDITION', 'OBS.NOMINATION_12_2']);
}

/* ---------------- targets ---------------- */

/**
 * The candidate list, in the order the property lists them -- "The broker
 * selects a target based on the order in which they are specified". Never
 * "the first viable one in the list".
 */
export function candidateTargets(doc: TopologyDoc): MemberId[] {
  const t = doc.config.fsfo.target;
  const legal = (m: Member): boolean =>
    isDatabase(m) && m.enabled && (m.role === 'physical' || m.role === 'logical');
  if (t.kind === 'list') {
    return t.members.filter((id) => {
      const m = doc.members.find((x) => x.id === id);
      return !!m && legal(m);
    });
  }
  return doc.members.filter(legal).map((m) => m.id);
}

export interface TargetChoice {
  target: MemberId | null;
  skipped: MemberId[];
  claim: Claim<string>;
}

/**
 * Walk the candidate list in order and take the first candidate the observer
 * can reach that has also lost the primary. A candidate that fails the
 * readiness gate is skipped only while another candidate passes it: with none
 * left the broker still has a target, and what refuses the failover is the
 * gate rather than the absence of a standby.
 */
export function selectTarget(
  candidates: readonly MemberId[],
  usable: (id: MemberId) => boolean,
  gatePasses: (id: MemberId) => boolean,
  policy: 'skip-to-next' | 'active-target-only',
): TargetChoice {
  const list = policy === 'active-target-only' ? candidates.slice(0, 1) : candidates;
  const skipped: MemberId[] = [];
  let fallback: MemberId | null = null;
  for (const id of list) {
    if (!usable(id)) { skipped.push(id); continue; }
    if (!gatePasses(id)) { if (fallback === null) fallback = id; skipped.push(id); continue; }
    return { target: id, skipped, claim: choiceClaim(id, skipped, false) };
  }
  if (fallback !== null) {
    return { target: fallback, skipped: skipped.filter((s) => s !== fallback), claim: choiceClaim(fallback, skipped, true) };
  }
  return {
    target: null,
    skipped,
    claim: model('No candidate target is usable.',
      'FSFO.TARGET_SELECTION: the broker selects a target based on the order in which the candidates are specified, and it automatically changes the target if the designated one develops a problem. Which candidate it lands on in a given failure, and at what instant, is not documented -- this engine walks the list in order and says so.',
      ['FSFO.TARGET_ORDER', 'FSFO.TARGET_AUTO_CHANGE']),
  };
}

const choiceClaim = (id: MemberId, skipped: readonly MemberId[], gateFailed: boolean): Claim<string> =>
  model(id as string,
    `FSFO.TARGET_SELECTION: the candidates are walked in the order the FastStartFailoverTarget property lists them${skipped.length > 0 ? `, past ${skipped.join(', ')}` : ''}${gateFailed ? '; no candidate passes the readiness gate, so the target stands and the gate is what refuses the failover' : ''}. Oracle documents the order and the automatic change of target, not which candidate a given failure lands on, so this walk is this page's model -- never "the first viable one in the list".`,
    ['FSFO.TARGET_ORDER', 'FSFO.TARGET_AUTO_CHANGE']);

/* ---------------- the far sync exclusions ---------------- */

export const targetKindClaim = (m: Member): Claim<boolean> =>
  documented(isDatabase(m) && (m.role === 'physical' || m.role === 'logical'),
    ['FSFO.TARGET_KIND', 'FSFO.TARGET_NOT_FARSYNC'],
    'FastStartFailoverTarget can only be set to the name of a physical or logical standby: not a snapshot standby, not a far sync instance, not a Zero Data Loss Recovery Appliance.');

/** The prerequisite the cascaded terminal standby fails. */
export const directRedoClaim = (depth: number, viaFarSync: boolean): Claim<boolean> => {
  if (viaFarSync) {
    return documented(true, ['FSFO.TARGET_DIRECT_REDO', 'FSFO.FARSYNC_XPT'],
      'The target standby must receive redo directly from the primary database; receiving it from a far sync instance is the sanctioned exception.');
  }
  return inferred(depth <= 1, ['FSFO.TARGET_DIRECT_REDO', 'CASCADE.TERMINAL_INDIRECT'],
    'A terminal standby receives primary redo indirectly from a cascading standby, and the fast-start failover prerequisite asks for redo received directly from the primary. There is no literal prohibition -- this is the deduction from those two sentences.');
};
