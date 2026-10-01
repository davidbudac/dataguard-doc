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
 *    ping properties replace the threshold for the observer's detection,
 *  - fast-start failover goes to the CURRENT target only; the broker changes
 *    the target while the primary is there to change it.
 */

import { lagLimitOf, NOMINAL } from '../defaults';
import { initialNetState } from '../net/graph';
import { resolveRedoGraph } from '../redo/resolve';
import type { Claim, Finding } from '../types/claims';
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
    && lagLimitOf(doc) > 0;
}

export const pingPropertiesSet = (doc: TopologyDoc): boolean =>
  doc.config.fsfo.pingIntervalMs !== null && doc.config.fsfo.pingRetry !== null;

/**
 * Do the two ping properties take effect in this document?
 *
 * ObserverPingInterval and ObserverPingRetry do not exist in 19c: neither
 * name appears in the 19c property reference, the 19c fast-start failover
 * chapter or the 19c command reference, nor in the 19.27 binaries, and the
 * first edition that documents them is 21c. A 19c document that carries them
 * therefore detects on FastStartFailoverThreshold like any other 19c
 * configuration, and the run says why.
 *
 * `legacyPingUnder19c` is the published page's reading -- it offers both
 * properties under 19c -- and only the compatibility adapter asks for it.
 */
export const pingInEffect = (doc: TopologyDoc, legacyPingUnder19c = false): boolean =>
  pingPropertiesSet(doc) && (doc.config.edition !== '19c' || legacyPingUnder19c);

/** The finding a 19c document raises when it sets properties 19c does not have. */
export const pingNotIn19c = (doc: TopologyDoc): Finding => ({
  id: 'FSFO.PING_NOT_IN_19C', severity: 'warning', basis: 'doc-later',
  cite: ['FSFO.PING_PROPS_21C', 'FSFO.THRESHOLD'],
  subject: { kind: 'config' },
  message: `ObserverPingInterval and ObserverPingRetry are not available in Oracle Database 19c, so this run ignores them: the observer detects the loss of the primary on FastStartFailoverThreshold (${doc.config.fsfo.thresholdSeconds} s).`,
  note: 'Neither property is on the 19c property reference, in the 19c fast-start failover chapter or in the 19c command reference, and neither name is in the 19.27 binaries; the first edition that documents them is 21c. Switch the edition to 26ai to see the ping model.',
});

/**
 * Detection. The documented part is that the threshold is ignored for the
 * observer's detection once BOTH ping properties are explicitly set, and that
 * detection "can be reduced to nearly 1 second". No arithmetic appears
 * anywhere in the documentation, so interval x (retry + 1) -- the first failed
 * ping plus its retries -- is this page's model of that sentence.
 */
export function detectClaim(doc: TopologyDoc, ping: boolean = pingPropertiesSet(doc)): Claim<Seconds> {
  const f = doc.config.fsfo;
  if (ping && f.pingIntervalMs !== null && f.pingRetry !== null) {
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
export function initiateDelayClaim(
  doc: TopologyDoc, ping: boolean = pingPropertiesSet(doc),
): Claim<Seconds> {
  if (ping) {
    const d = detectClaim(doc, ping);
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
  const base = override !== undefined ? override : isDatabase(m) ? m.applyLagSeconds : 0;
  return base + applyGapOf(m, state);
}

/**
 * A RAC standby whose apply instance failed applies nothing until apply moves
 * (`rac.ts`), so its apply lag grows one second per second of the gap. Once
 * apply resumes the backlog is drawn as cleared at once: the catch-up rate is
 * environment-dependent (RAC.APPLY_GAP_LAG, a model).
 */
export function applyGapOf(m: Member, state?: SimState): Seconds {
  const since = state?.applyLostSince[m.id as string];
  if (state === undefined || since === null || since === undefined) return 0;
  return Math.max(0, state.now - since);
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
 * The standby's readiness check, asked at the time the primary failed.
 *
 * `ready` is the recorded state: SYNCHRONIZED or TARGET UNDER LAG LIMIT. It is
 * a latch only while nothing new is committed -- a primary that is dead,
 * stalled or hanging on the commit generates no redo the standby could be
 * missing, so a link that has just been cut does not un-synchronize the redo
 * the standby already holds. From the instant the primary carries on without
 * the standby the state is UNSYNCHRONIZED or TARGET OVER LAG LIMIT, and a
 * fast-start failover "cannot occur".
 *
 * `unsentSeconds` is how long the primary generated redo this standby never
 * received. Where the lag limit is the gate it is what the lag has grown by.
 */
export function readinessGate(
  doc: TopologyDoc, target: Member, ready: boolean, state?: SimState, unsentSeconds: Seconds = 0,
): Readiness {
  const gateLag = gateLagSeconds(doc, target, state) + unsentSeconds;
  if (lagGated(doc)) {
    const limit = lagLimitOf(doc);
    const passes = ready && gateLag <= limit;
    const grown = unsentSeconds > 0
      ? ` The lag is the configured ${gateLagSeconds(doc, target, state)} s plus the ${unsentSeconds} s the primary generated redo this standby did not receive -- drawn second for second, which is this page's model.`
      : '';
    return {
      passes,
      gateLag,
      claim: documented(passes, LAG_GATE_CITES.concat(['FSFO.LAGTYPE', 'FSFO.CANNOT_OVER_LAG_LIMIT']),
        `${effectiveLagType(doc)} lag ${gateLag} s against a FastStartFailoverLagLimit of ${limit} s: failover is possible any time the lag is at or below the limit, and cannot occur if the target lags by more than the limit at the time the primary database failed.${grown}`),
    };
  }
  const cites: CitationId[] =
    ['FSFO.CANNOT_NOT_SYNCHRONIZED', 'FSFO.BOTH_MUST_HAVE_LOST', 'MAXAVAIL.AT_LEAST_ONE', 'XPT.TABLE_4_2'];
  const text = ready
    ? 'The target standby is synchronized, which is what maximum availability and maximum protection ask of it.'
    : 'The target standby was not synchronized with the primary database at the time the primary database failed, and in maximum availability or maximum protection mode fast-start failover cannot occur then.';
  /* The check is only as well founded as the SYNCHRONIZED state it reads. Where
     the redo graph itself labels that state (a target fed across a far sync
     hop is this page's model: how SYNCHRONIZED is computed there is not
     documented), the gate says so too instead of presenting a documented pass
     (SIM-27). */
  const fed = state === undefined ? undefined : resolveRedoGraph(doc, {
    primary: state.primary, net: initialNetState(doc),
  }).members[target.id]?.synchronized;
  if (fed !== undefined && fed.basis !== 'documented' && fed.note !== undefined) {
    const note = `${text} How SYNCHRONIZED is read for this target is not a documented fact: ${fed.note}`;
    const merged = [...new Set<CitationId>([...cites, ...fed.cite])];
    return {
      passes: ready,
      gateLag,
      claim: fed.basis === 'inferred' ? inferred(ready, merged, note)
        : model(ready, note, merged),
    };
  }
  return { passes: ready, gateLag, claim: documented(ready, cites, text) };
}

/**
 * The recorded state changes from ready to not ready. That it has to be
 * recorded -- by the observer or by the target standby -- before the primary
 * may carry on is documented; WHEN the recording lands is not.
 */
export function notReadyClaim(
  doc: TopologyDoc, target: MemberId, by: 'observer' | 'target' | 'unobserved' | 'disabled',
): Claim<string> {
  const state = lagGated(doc) ? 'TARGET OVER LAG LIMIT' : 'UNSYNCHRONIZED';
  const who = by === 'observer' ? 'The master observer records'
    : by === 'target' ? 'The target standby records'
      : by === 'unobserved' ? 'The configuration is unobserved, so nothing has to be confirmed: the primary carries on and'
        : 'Fast-start failover is not enabled, so nothing has to be confirmed: the primary carries on and';
  const tail = by === 'observer' || by === 'target'
    ? ` that fast-start failover cannot happen, and the primary continues without ${target as string}: the state is ${state}.`
    : ` ${target as string} no longer has all of its redo.`;
  return model(`${who}${tail}`,
    lagGated(doc)
      ? 'FSFO.NOT_READY_TIMING: that the change has to be recorded before the primary continues is documented; when the lag crosses the limit is not. This page grows the lag by one second for every second the primary generates redo the target does not receive, starting from the lag as configured.'
      : 'FSFO.NOT_READY_TIMING: that the change has to be recorded before the primary continues is documented; when the recording lands is not. This page draws it where the commit hang ends -- one NET_TIMEOUT after the acknowledgement stopped -- which is the instant the primary starts committing without the target.',
    ['FSFO.GUARANTEE_STALL', 'FSFO.STATUS_STALLED', 'DEST.NET_TIMEOUT']);
}

/**
 * Redo reaches the target again. The documentation restores the ability to
 * fail over "once the target standby database has received all missing redo
 * data" and says nothing about how long that takes, because it depends on how
 * much redo is missing and how fast it ships. This page draws it as immediate.
 */
export const resyncClaim = (target: MemberId, unsent: Seconds): Claim<string> =>
  model(`Redo reaches ${target as string} again and it is drawn as synchronized at once.`,
    `FSFO.RESYNC_INSTANT: "the ability to automatically failover is restored once the target standby database has received all missing redo data". How long receiving it takes is environment-dependent -- here ${unsent} s of redo generation had not been received -- and is not modelled: this page draws the resynchronization as immediate, so a failure shortly after the link returns looks better here than it would be.`,
    ['FSFO.RESYNC_RESTORES']);

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
 * The automatic change of target: "If the designated fast-start failover
 * target develops a problem and cannot be the target of a failover, then the
 * broker automatically changes the fast-start failover target to one of the
 * other candidate targets."
 *
 * It is the broker at the PRIMARY that changes the target, so this walk runs
 * while the primary is alive and reaches another candidate, and never once the
 * primary is gone: "Data Guard Broker cannot failover to second fast-start
 * failover target if both the primary and first fast-start failover targets
 * are down" (26ai; the 19c chapter is silent).
 *
 * The candidates are walked in the order the property lists them. A candidate
 * that fails `gatePasses` is skipped only while another candidate passes it.
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
      'FSFO.TARGET_SELECTION: the broker selects a target based on the order in which the candidates are specified, and it automatically changes the target if the designated one develops a problem. Which candidate it lands on, and at what instant, is not documented -- this engine walks the list in order while the primary is there to make the change, and says so.',
      ['FSFO.TARGET_ORDER', 'FSFO.TARGET_AUTO_CHANGE']),
  };
}

const choiceClaim = (id: MemberId, skipped: readonly MemberId[], gateFailed: boolean): Claim<string> =>
  model(id as string,
    `FSFO.TARGET_SELECTION: the candidates are walked in the order the FastStartFailoverTarget property lists them${skipped.length > 0 ? `, past ${skipped.join(', ')}` : ''}${gateFailed ? '; no candidate passes the readiness gate, so the target stands and the gate is what refuses the failover' : ''}. Oracle documents the order and the automatic change of target -- made while the primary is there to make it -- not which candidate the change lands on or how long it takes, so this walk and its instant are this page's model -- never "the first viable one in the list".`,
    ['FSFO.TARGET_ORDER', 'FSFO.TARGET_AUTO_CHANGE']);

/**
 * The primary and the first target are both gone. Documented for 26ai; the
 * 19c chapter does not carry the sentence, so under 19c the same outcome is
 * labelled as documented later.
 */
export function noSecondTarget(
  doc: TopologyDoc, active: MemberId, other: MemberId,
): { claim: Claim<string>; finding: Finding } {
  const is26 = doc.config.edition === '26ai';
  const text = `No fast-start failover: the target ${active as string} is down together with the primary, and the broker cannot fail over to the second target ${other as string}. The target changes only while the primary is there to change it.`;
  const note = is26
    ? 'Restrictions When Fast-Start Failover is Enabled, 26ai.'
    : 'FSFO.NO_SECOND_TARGET: the sentence is on the 26ai page. The 19c chapter documents the automatic change of target and is silent on this case, so under 19c the restriction is applied as documented in a later edition rather than as a 19c fact.';
  const cite: CitationId[] = ['FSFO.NO_SECOND_TARGET_26AI', 'FSFO.TARGET_AUTO_CHANGE'];
  return {
    claim: is26
      ? { value: text, basis: 'documented', cite, note }
      : { value: text, basis: 'doc-later', cite, note },
    finding: {
      id: 'FSFO.NO_SECOND_TARGET', severity: 'error', basis: is26 ? 'documented' : 'doc-later', cite,
      subject: { kind: 'member', id: active as string },
      message: text,
      note,
    },
  };
}

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
