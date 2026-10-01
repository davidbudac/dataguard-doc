/**
 * RAC members inside the epoch loop -- facts.md F1-F4, F10.
 *
 * Two documented behaviours and the gaps between them:
 *
 *  - A RAC primary "remains available as long as at least one instance of the
 *    clustered database continues to transport redo data to the standby
 *    databases". The reachability half of that lives in `net/graph.ts`; this
 *    module only words it.
 *  - A RAC standby runs apply on exactly one instance, the apply instance. If
 *    it fails, the broker moves apply to a running instance -- the one
 *    PreferredApplyInstance names when that one is running, otherwise "a
 *    random instance that is currently running" -- after ApplyInstanceTimeout
 *    (broker default 0, "immediate apply instance failover").
 *  - Random is Oracle's word. This engine is deterministic and takes the first
 *    running instance in declared order, and says so wherever it does. How
 *    long the broker takes to *detect* the failure is not documented; it is
 *    drawn as instantaneous.
 *
 * Multi-instance Redo Apply (`ApplyInstances` above 1 or ALL, physical
 * standby) is drawn as the coordinator -- the broker's apply instance -- plus
 * the other running instances up to the number; which ones is this engine's
 * reading ("the database chooses"), and an instance other than the
 * coordinator failing is undocumented and labelled as a model. While no
 * instance applies, the apply lag grows (`fsfo.ts`, `applyGapOf`).
 */

import type { MemberId, Seconds } from '../ids';
import type { Claim } from '../types/claims';
import { documented, inferred, model } from '../types/claims';
import type { DatabaseMember, Instance, Member } from '../types/topology';
import { isDatabase, isRac } from '../types/topology';

/**
 * Does this member run apply on an apply instance? A RAC physical or logical
 * standby with apply switched on. A snapshot standby applies nothing, and the
 * section of the broker guide says so: "not applicable to snapshot standby
 * databases or far sync instances".
 */
export function hasApplyInstance(m: Member): m is DatabaseMember {
  return isDatabase(m) && isRac(m)
    && (m.role === 'physical' || m.role === 'logical') && m.applyRunning;
}

/**
 * The member as the broker holds it after a SET STATE ... WITH APPLY INSTANCE:
 * "The SET STATE command will update the PreferredApplyInstance property to
 * the new apply instance value", so a later apply instance failover prefers
 * the instance the command named, not the one the document was authored with.
 */
export function withPreferred(m: DatabaseMember, set: string | undefined): DatabaseMember {
  return set === undefined ? m : { ...m, preferredApplyInstance: set };
}

/** PreferredApplyInstance, when it names an instance this member has. */
export function preferredInstance(m: DatabaseMember): string | null {
  const p = m.preferredApplyInstance;
  return p !== undefined && m.instances.some((i) => i.name === p) ? p : null;
}

/**
 * The apply instance a configuration starts with: the preferred one, or --
 * where the broker "randomly picks" -- the first in declared order.
 */
export function initialApplyInstance(m: DatabaseMember): string | null {
  return preferredInstance(m) ?? m.instances[0]?.name ?? null;
}

/** Where apply goes after a failure, among the instances still running. */
export function nextApplyInstance(m: DatabaseMember, running: readonly Instance[]): string | null {
  const preferred = preferredInstance(m);
  if (preferred !== null && running.some((i) => i.name === preferred)) return preferred;
  return running[0]?.name ?? null;
}

/**
 * Multi-instance Redo Apply (facts.md F10): with ApplyInstances at ALL or
 * above 1 on a physical standby, Redo Apply runs on several running
 * instances, one of them the coordinator -- the apply instance. "The database
 * chooses the instances on which to perform Redo Apply", so which ones is this
 * engine's reading: the coordinator first, then the running instances in
 * declared order, up to the number.
 */
export function applyParticipants(
  m: DatabaseMember, coordinator: string | null, running: readonly string[],
): string[] {
  if (coordinator === null || !running.includes(coordinator)) return [];
  if (!isMultiInstanceApply(m)) return [coordinator];
  const n = m.applyInstances;
  const cap = n === 'ALL' ? running.length : Math.min(n as number, running.length);
  return [coordinator, ...running.filter((r) => r !== coordinator)].slice(0, cap);
}

export const isMultiInstanceApply = (m: DatabaseMember): boolean =>
  m.role === 'physical' && (m.applyInstances === 'ALL'
    || (typeof m.applyInstances === 'number' && m.applyInstances > 1));

/** An instance taking part in multi-instance Redo Apply, not the coordinator, stopped. */
export function participantLostClaim(m: DatabaseMember, lost: string, coordinator: string): Claim<string> {
  return model(
    `${lost} stopped; Redo Apply on ${m.name} carries on, coordinated by ${coordinator}.`,
    'RAC.MIRA_PARTICIPANT: the broker documents what happens when the apply coordinator fails (apply instance failover) and that its periodic health checks engage instances that have started, by stopping and restarting recovery. What happens when an instance other than the coordinator fails is not documented; this engine keeps apply running on the rest and re-engages the instance as soon as it starts.',
    ['RAC.MULTI_INSTANCE_APPLY', 'RAC.APPLY_INSTANCES_PROPERTY'],
  );
}

export const applyInstanceTimeout = (m: DatabaseMember): Seconds =>
  Math.max(0, m.applyInstanceTimeoutSeconds ?? 0);

/* ---------------- claims ---------------- */

const FIRST_RUNNING_NOTE = 'RAC.APPLY_INSTANCE_ORDER: with no running PreferredApplyInstance the broker picks "a random instance that is currently running". This engine is deterministic and takes the first running instance in the order the instances are declared.';

const DETECT_NOTE = 'How long the broker takes to detect that the apply instance failed is not documented; this engine draws detection as instantaneous, so the move happens ApplyInstanceTimeout after the instance stops.';

/** Apply moved from a failed instance to a running one. */
export function applyFailoverClaim(
  m: DatabaseMember, from: string, to: string, timeout: Seconds,
): Claim<string> {
  const byPreference = preferredInstance(m) === to;
  const text = `The apply instance ${from} of ${m.name} failed; the broker restarts apply on ${to}`
    + (timeout > 0 ? `, after ApplyInstanceTimeout (${timeout} s).` : ' at once -- ApplyInstanceTimeout is 0.')
    + (byPreference ? ' It is the running PreferredApplyInstance.' : '');
  const cite: Parameters<typeof documented>[1] = [
    'RAC.APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_FAILOVER', 'RAC.APPLY_INSTANCE_SELECTION',
    'RAC.APPLY_INSTANCE_TIMEOUT',
  ];
  return byPreference
    ? model(text, DETECT_NOTE, cite)
    : model(text, `${FIRST_RUNNING_NOTE} ${DETECT_NOTE}`, cite);
}

const GAP_NOTE = 'RAC.APPLY_GAP_LAG: while no instance applies, the apply lag grows one second per second; once apply resumes this engine draws the backlog as cleared at once, because the catch-up rate is environment-dependent.';

/** The apply instance failed and the broker is waiting out ApplyInstanceTimeout. */
export function applyWaitClaim(m: DatabaseMember, from: string, until: Seconds): Claim<string> {
  return model(
    `The apply instance ${from} of ${m.name} failed; apply stops until ApplyInstanceTimeout expires at ${until} s, and the apply lag grows meanwhile.`,
    `${DETECT_NOTE} ${GAP_NOTE}`,
    ['RAC.APPLY_INSTANCE_TIMEOUT', 'RAC.APPLY_INSTANCE_FAILOVER'],
  );
}

/** A failover began while the target had no instance applying. */
export function applyGapFailoverClaim(m: DatabaseMember, gap: Seconds): Claim<string> {
  return model(
    `${m.name} has had no instance applying for ${gap} s, so it has ${gap} s more redo to apply before it can open.`,
    GAP_NOTE,
    ['RAC.APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_TIMEOUT'],
  );
}

/**
 * A RAC database that has just left the primary role becomes a standby: apply
 * starts on PreferredApplyInstance, which may be set on a primary "in
 * preparation for a switchover", or else on an instance the broker picks.
 */
export function roleChangeApplyClaim(m: DatabaseMember, to: string): Claim<string> {
  const text = `${m.name} is a standby now; apply will start on ${to}.`;
  return preferredInstance(m) === to
    ? documented(text, ['RAC.PREFERRED_FOR_SWITCHOVER', 'RAC.PREFERRED_APPLY_INSTANCE'])
    : model(text,
      'RAC.APPLY_INSTANCE_ORDER: PreferredApplyInstance names no running instance, so the broker picks the apply instance; this engine draws the first running instance.',
      ['RAC.APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_RANDOM']);
}

/**
 * EDIT DATABASE ... SET STATE='APPLY-ON' WITH APPLY INSTANCE=...
 *
 * On a primary the clause is "ignored even if it is specified", so the command
 * is not refused and nothing moves; against an instance that is not running,
 * or a member that is not a RAC standby with apply, nothing moves either.
 */
export function setApplyClaim(
  member: MemberId, instance: string, ok: boolean, onPrimary = false,
): Claim<string> {
  if (onPrimary) {
    return documented(
      `The WITH APPLY INSTANCE clause is ignored on ${member as string}: it is the primary, so ${instance} is not made an apply instance.`,
      ['RAC.WITH_APPLY_INSTANCE_IGNORED'],
    );
  }
  return documented(
    ok
      ? `Apply moves to ${instance} on ${member as string} by command, and the command updates PreferredApplyInstance to ${instance}.`
      : `Apply cannot move to ${instance} on ${member as string}: it is not a running instance of a RAC standby.`,
    ok ? ['RAC.SET_APPLY_INSTANCE', 'RAC.SET_STATE_UPDATES_PREFERRED', 'RAC.APPLY_INSTANCE']
      : ['RAC.SET_APPLY_INSTANCE', 'RAC.APPLY_INSTANCE'],
    ok ? 'The run keeps its own copy of the property: the document\'s PreferredApplyInstance field is left as authored, and a later apply instance failover in this run prefers the instance the command named.' : undefined,
  );
}

/**
 * A RAC primary lost some, not all, of its instances.
 *
 * Oracle says the primary "remains available" while one instance transports
 * redo, and that fast-start failover "will not occur unless all instances ...
 * are perceived to have failed". Neither says a threshold clock does not run:
 * the chapter starts the interval "when the observer first loses its
 * connection to the primary database" and advises a higher threshold on RAC
 * "to minimize the possibility of a false failover in the event of an instance
 * failure". Drawing no clock while any instance runs is this page's model.
 */
export function primaryDegradedClaim(
  primary: MemberId, down: readonly string[], running: readonly string[],
): Claim<string> {
  return model(
    `${primary as string} lost ${down.join(', ')}; ${running.join(', ')} ${running.length === 1 ? 'is' : 'are'} still running, so the primary stays available and this page starts no fast-start failover clock.`,
    'RAC.PRIMARY_DEGRADED: the broker guide says the primary "remains available as long as at least one instance of the clustered database continues to transport redo data to the standby databases" and that "Fast-start failover will not occur unless all instances comprising the Oracle RAC primary database are perceived to have failed". Neither sentence mentions a clock. The chapter starts the threshold interval "when the observer first loses its connection to the primary database" and advises a higher FastStartFailoverThreshold on a RAC primary "to minimize the possibility of a false failover in the event of an instance failure" -- so a failover that follows an instance loss is something Oracle worries about, not something it rules out. This page draws no clock while any instance runs. Which instance was shipping which redo thread, and how a surviving instance covers a failed one\'s thread, is not modelled.',
    ['RAC.PRIMARY_AVAILABLE', 'RAC.LAST_INSTANCE_FSFO', 'RAC.PERCEIVED_FAILED', 'RAC.THRESHOLD_ADVICE'],
  );
}

/**
 * The last instance of a RAC primary stopped after others had been lost
 * earlier: the clock counts from now, not from the first loss. That reading is
 * a deduction from two sentences, and Oracle states no such rule.
 */
export function lastInstanceClockClaim(primary: MemberId, at: Seconds): Claim<string> {
  return inferred(
    `The last instance of ${primary as string} stopped at ${at} s, so the fast-start failover threshold counts from here, not from the first instance lost.`,
    ['RAC.PERCEIVED_FAILED', 'RAC.LAST_INSTANCE_FSFO'],
    'RAC.CLOCK_FROM_LAST_INSTANCE: Oracle says fast-start failover "will not occur unless all instances comprising the Oracle RAC primary database are perceived to have failed" and that the interval starts "when the observer first loses its connection to the primary database". Reading the two together, the primary counts as lost when its last instance is, and the clock starts then. Oracle states no such rule for instances lost one after another, nor the threshold advice for RAC ("miscount + reconfiguration time + 30" seconds, RAC.THRESHOLD_MISCOUNT), so this is a deduction.',
  );
}

/**
 * Some running instances of a RAC primary cannot reach any standby while
 * others can. The drawing treats the member as one unit -- reachable while any
 * instance is -- so nothing follows from it; say so, because Oracle describes
 * what the cluster would do.
 */
export function instanceCutOffClaim(
  primary: MemberId, cut: readonly string[], reaching: readonly string[],
): Claim<string> {
  return model(
    `${cut.join(', ')} of ${primary as string} cannot reach a standby while ${reaching.join(', ')} can; nothing is drawn about it.`,
    'RAC.INSTANCE_CUT_OFF: Appendix D.2.2 of Data Guard Concepts and Administration says that "If any instance of an Oracle RAC primary database loses connectivity with a standby database, all other primary database instances stop sending redo to the standby database for the number of seconds specified on the LOG_ARCHIVE_DEST_n REOPEN attribute, after which all primary database instances attempt to reconnect", and in maximum protection that "If a lost destination is the last participating SYNC destination, then the instance loses connectivity and is shut down". This page draws neither the pause in redo nor the instance shutdown: it reads the primary as reachable while any one instance is, in every protection mode, and a real cluster would likely evict a node that lost its peers first.',
    ['RAC.SOURCE_INSTANCE_LOSS_REOPEN', 'RAC.SOURCE_INSTANCE_LOSS_SYNC', 'RAC.PRIMARY_AVAILABLE'],
  );
}
