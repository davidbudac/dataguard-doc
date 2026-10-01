/** A short reading of one run, assembled only from its events and engine trace. */

import type { Claim, EngineTrace, Finding, TimedEvent, TopologyDoc } from '@/engine';
import { sortEvents } from '@/engine';
import { describeEvent } from './events';

export interface ExplanationStep {
  key: string;
  at: number;
  title: string;
  detail: string;
  subjects: string[];
  claim?: Claim<string> | Finding;
  setting?: 'Fast-start failover' | 'PrimaryDatabaseCandidates';
}

/**
 * One title per decision id the engine can record (`decide`/`decideAt` in
 * `engine/sim/*.ts`). A run's own reading of the decision -- `decision.claim.value`,
 * already worded for a reader -- is the detail; this is only ever the noun
 * phrase over it. An id missing here would still be in `trace.decisions`, but
 * `buildExplanation` would never turn it into a step: this table is what makes
 * an id "explained" at all, and the coverage test below holds it to that.
 */
const DECISION_TITLE: Record<string, string> = {
  'BYSTANDERS.AHEAD': 'Bystander ahead of the new primary',
  'BYSTANDERS.FOLLOW': 'Bystanders follow the new primary',
  'EXEC.ENV_DEPENDENT': 'Role transition',
  'FSFO.BOTH_MUST_HAVE_LOST': 'Failure confirmed',
  'FSFO.DISABLE_FAST_START_FAILOVER': 'Disable fast-start failover',
  'FSFO.DISABLE_FORCE_PRIMARY_RUNS': 'Primary runs on after FORCE',
  'FSFO.MANUAL_FAILOVER': 'Manual failover',
  'FSFO.NO_SECOND_TARGET': 'No second target',
  'FSFO.NOT_POSSIBLE': 'Failover not possible',
  'FSFO.NOT_READY': 'Target not ready',
  'FSFO.OBSERVE_ONLY': 'Observe only',
  'FSFO.OBSERVE_ONLY_SCOPE': 'Observe-only scope',
  'FSFO.OBSERVER_REACHES_TARGET': 'Observer reaches target',
  'FSFO.PING_ARITHMETIC': 'Ping detection time',
  'FSFO.READINESS_GATE': 'Standby readiness',
  'FSFO.RESYNC': 'Target resynchronized',
  'FSFO.TARGET_CHANGE': 'Active target changed',
  'FSFO.TARGET_SELECTION': 'Target selected',
  'NOMINATION.NEW_MASTER': 'Backup observer nominated',
  'NOMINATION.PRECONDITION': 'Observer nomination check',
  'OBS.MASTER_LOST': 'Observer unavailable',
  'OBS.OBSERVED_AGAIN': 'Observer reconnects',
  'OBS.SET_MASTEROBSERVER': 'Master observer set',
  'OBS.STOP_OBSERVER': 'Stop observer refused',
  'OBS.UNOBSERVED': 'Configuration unobserved',
  'PRIMARY.ABORT': 'Primary shuts down',
  'PRIMARY.NO_STALL': 'Primary keeps running',
  'PRIMARY.REOPEN': 'Primary reopens',
  'PRIMARY.STALL': 'Primary stalled',
  'PROT.COMMIT_HANG': 'Commits wait',
  'PROT.MAXAVAIL_DEGRADED': 'Protection degraded',
  'PROT.MAXPROT_SHUTDOWN': 'Primary shut down',
  'PROT.MODE_AFTER_FAILOVER': 'Protection mode after failover',
  'REINSTATE.COMMAND': 'Reinstatement',
  'REINSTATE.OPEN_BAND': 'Reinstated automatically',
  'ROLE.PRIMARY_DB_CANDIDATES': 'Candidate check',
  'SIM.ONE_ROLE_CHANGE': 'One role change per run',
  'SWITCHOVER.CONVERT': 'Primary converts to standby',
  'SWITCHOVER.GATE': 'Switchover check',
  'SWITCHOVER.ZERO_LOSS': 'Roles changed',
};

/** Every decision id above is common enough to show: the two tables agree by construction. */
const COMMON_DECISIONS = new Set(Object.keys(DECISION_TITLE));

/**
 * Findings the engine can raise with nothing recorded in `trace.decisions` of
 * the same id -- `addFinding` on its own, no companion `decide` -- so without
 * an entry here the reader never sees them at all: the readiness gate, a
 * refused switchover and the candidate check already fold their finding's
 * message into a decision above (see `buildExplanation`'s `refusal` lookup),
 * and stay out of this table so they are not shown twice.
 */
const FINDING_TITLE: Record<string, string> = {
  'BYSTANDERS.AHEAD_DISABLED': 'Bystander disabled',
  'CASCADE.MANUAL_FAILOVER_TERMINAL': 'Cascaded redo not sent',
  'DEST.GROUP_PRIORITY_REENTER': 'Destination re-enters its group',
  'DEST.MAX_FAILURE_DISABLED': 'Destination disabled after failures',
  'DEST.MAXFAILURE_RESET_UNDOC': 'Failure count reset',
  'DEST.REOPEN_SCHEDULE_MODEL': 'Destination reopen schedule',
  'FAILOVER.FORMER_PRIMARY_MOUNTED': 'Former primary mounted',
  'FAILOVER.FORMER_PRIMARY_OPEN': 'Former primary still open',
  'FAILOVER.PRIMARY_STILL_OPEN': 'Primary still open',
  'FSFO.DISABLE_FORCE_TWO_PRIMARIES': 'Two primaries after FORCE',
  'FSFO.FORMER_PRIMARY_NOT_OPEN': 'Former primary not open',
  'FSFO.PING_NOT_IN_19C': 'Ping properties not in 19c',
  'FSFO.RESYNC_INSTANT': 'Resync timing note',
  'FSFO.TARGET_KIND': 'Target kind',
  'MEMBER.FARSYNC_NOT_PRIMARY': 'Far sync cannot be primary',
  'OBS.NOT_STARTED': 'No observer started',
  'OBS.SET_MASTEROBSERVER_REFUSED': 'Master observer change refused',
  'OBS.UNOBSERVED': 'Configuration unobserved',
  'PRIMARY.REOPEN_INSTANT': 'Reopen timing note',
  'REINSTATE.NOTHING_TO_REINSTATE': 'Nothing to reinstate',
  'REINSTATE.PRECONDITIONS': 'Automatic reinstatement unavailable',
  'ROUTES.ALT_LATCHED': 'Alternate destination latched',
  'SIM.EPOCH_CAP': 'Simulation cut short',
  'SWITCHOVER.TO_TERMINAL_UNDOC': 'Switchover to a terminal standby',
};

/**
 * The handful of findings above that describe the configuration as read at
 * the start, rather than something the run arrived at: seeking to them lands
 * on the opening instant instead of the last injected event.
 */
const FINDING_AT_START = new Set([
  'FSFO.PING_NOT_IN_19C', 'FSFO.TARGET_KIND', 'MEMBER.FARSYNC_NOT_PRIMARY',
  'OBS.NOT_STARTED', 'SIM.EPOCH_CAP',
]);

function membersOnHosts(doc: TopologyDoc, hosts: readonly string[]): string[] {
  const ids = new Set(hosts);
  return doc.members.filter((m) => m.instances.some((i) => ids.has(i.host)))
    .map((m) => m.id as string);
}

/** Highlight the members affected by a network event as well as its own object. */
export function eventSubjects(doc: TopologyDoc, event: TimedEvent): string[] {
  switch (event.kind) {
    case 'host.down': case 'host.up':
      return [event.host, ...membersOnHosts(doc, [event.host])];
    case 'site.down': case 'site.up': {
      const hosts = doc.hosts.filter((h) => h.site === event.site).map((h) => h.id);
      return [event.site, ...membersOnHosts(doc, hosts)];
    }
    case 'link.cut': case 'link.heal': {
      const link = doc.links.find((l) => l.id === event.link);
      if (!link) return [event.link];
      const hosts = link.scope === 'host'
        ? [...link.ends]
        : doc.hosts.filter((h) => link.ends.some((end) => end === h.site)).map((h) => h.id);
      return [event.link, ...membersOnHosts(doc, hosts)];
    }
    case 'partition':
      return membersOnHosts(doc, event.groups.flat());
    case 'instance.down': case 'instance.up':
    case 'member.down': case 'member.up': case 'cmd.reinstate': case 'lag.set':
    case 'cmd.setApplyInstance':
      return [event.member];
    case 'observer.stop': case 'observer.start': case 'cmd.setMasterObserver':
      return [event.observer];
    case 'cmd.switchover': case 'cmd.failover':
      return [event.to];
    case 'cmd.disableFsfo': return [];
  }
}

function settingFor(id: string, blocked: boolean): ExplanationStep['setting'] {
  if (!blocked) return undefined;
  if (id === 'ROLE.PRIMARY_DB_CANDIDATES') return 'PrimaryDatabaseCandidates';
  if (id === 'FSFO.READINESS_GATE' || id === 'SWITCHOVER.GATE') return 'Fast-start failover';
  return undefined;
}

const OUTCOME: Record<EngineTrace['facts']['outcome'], string> = {
  failover: 'The target standby became primary.',
  continues: 'The primary kept serving; no role change occurred.',
  'stall-noone': 'The primary stalled and no member became primary.',
  'maxprot-shutdown': 'Maximum protection shut down the primary.',
  manual: 'The primary is unavailable; a manual failover is needed.',
  'observer-lost': 'No master observer could initiate failover.',
  switchover: 'The planned switchover changed the primary.',
};

export function buildExplanation(doc: TopologyDoc, trace: EngineTrace): ExplanationStep[] {
  const steps: ExplanationStep[] = [];
  for (const [index, event] of sortEvents(doc.events).entries()) {
    steps.push({
      key: `event-${index}`, at: event.at, title: 'Injected event',
      detail: describeEvent(doc, event), subjects: eventSubjects(doc, event),
    });
  }

  for (const [index, decision] of trace.decisions.entries()) {
    if (!COMMON_DECISIONS.has(decision.id)) continue;
    const refusal = decision.id === 'FSFO.READINESS_GATE'
      ? trace.findings.find((f) => f.id === 'FSFO.READINESS_GATE')
      : decision.id === 'SWITCHOVER.GATE'
        ? trace.findings.find((f) => f.id === 'SWITCHOVER.REFUSED')
        : decision.id === 'ROLE.PRIMARY_DB_CANDIDATES'
          ? trace.findings.find((f) => f.id === decision.id)
          : undefined;
    steps.push({
      key: `decision-${index}`, at: decision.at,
      title: DECISION_TITLE[decision.id] ?? decision.id,
      detail: refusal?.message ?? decision.claim.value,
      subjects: decision.subject?.id ? [decision.subject.id] : [],
      claim: refusal ?? decision.claim,
      setting: settingFor(decision.id, !decision.taken),
    });
  }

  /* Findings with no decision of the same id -- `addFinding` on its own, so
     nothing above ever turns them into a step. Anchored at the opening
     instant for the handful that describe the configuration as read, and
     otherwise after the last injected event: a finding carries no `at` of its
     own for `buildExplanation` to read. */
  const openAt = 0;
  const afterEvents = Math.max(0, ...doc.events.map((e) => e.at));
  for (const [index, f] of trace.findings.entries()) {
    const title = FINDING_TITLE[f.id];
    if (title === undefined) continue;
    steps.push({
      key: `finding-${index}`,
      at: FINDING_AT_START.has(f.id) ? openAt : afterEvents,
      title,
      detail: f.message,
      subjects: f.subject.id ? [f.subject.id] : [],
      claim: f,
    });
  }

  if (doc.events.length > 0 && trace.facts.outcome === 'continues' && doc.config.fsfo.state === 'enabled'
    && !trace.decisions.some((d) => d.id === 'FSFO.BOTH_MUST_HAVE_LOST')) {
    steps.push({
      key: 'no-initiation',
      at: Math.max(0, ...doc.events.map((e) => e.at)),
      title: 'No failover initiated',
      detail: 'The engine recorded no failover initiation. With ObserverOverride FALSE, both the observer and target standby must lose the primary for the threshold before automatic failover can start.',
      subjects: [],
      claim: {
        value: 'No initiation in this trace', basis: 'model',
        cite: ['FSFO.BOTH_MUST_HAVE_LOST', 'FSFO.OBSERVER_OVERRIDE_FALSE'],
        note: 'This is a reading of the trace for these events, alongside the documented default rule; it does not identify one specific missing prerequisite.',
      },
    });
  }

  if (!trace.facts.blocked && trace.facts.newPrimary && trace.facts.tOpen !== null) {
    const rto = trace.facts.perMember[trace.facts.newPrimary]?.rtoSeconds;
    steps.push({
      key: 'opened', at: trace.facts.tOpen, title: 'New primary open',
      detail: `${trace.facts.newPrimary} opens at t = ${trace.facts.tOpen} s in this model. Recovery and role transition depend on the environment.`,
      subjects: [trace.facts.newPrimary],
      claim: rto ? { ...rto, value: 'Modelled open time' } : {
        value: 'Modelled open time', basis: 'model', cite: [],
        note: 'The simulation uses the configured environment and lag values; this time is not a production guarantee.',
      },
    });
  }

  /*
   * "Run result" closes the list, so its instant has to be at least as late
   * as every step already on it -- an injected event, a decision (a wider
   * `COMMON_DECISIONS` now reaches into ones an internal deadline decides
   * after the last event, e.g. the readiness check a stalled threshold
   * settles at t = 30 s with nothing injected past t = 0) or a standalone
   * finding. Without the `steps.map` term here the fallback below found only
   * the injected events, and a later decision or finding sorted after it.
   */
  const resultAt = Math.max(
    (trace.facts.blocked ? trace.facts.initiateAt : trace.facts.tOpen)
      ?? trace.facts.abortAt
      ?? trace.facts.initiateAt ?? 0,
    ...doc.events.map((e) => e.at),
    ...steps.map((s) => s.at),
  );
  steps.push({
    key: 'result', at: resultAt, title: trace.facts.blocked ? 'Transition blocked' : 'Run result',
    detail: trace.facts.blocked ? 'The role transition was refused; no member changed role.'
      : doc.events.length === 0
        ? 'Nothing was injected, so nothing failed: the primary kept serving, no standby was promoted and no failover was initiated.'
      : trace.facts.outcome === 'manual' && trace.facts.newPrimary
        ? 'The manual failover changed the primary.' : OUTCOME[trace.facts.outcome],
    subjects: trace.facts.newPrimary ? [trace.facts.newPrimary] : [],
    claim: {
      value: 'Simulated outcome', basis: 'model', cite: [],
      note: 'This is the workbench engine’s result for the injected events and settings.',
    },
  });

  return steps.sort((a, b) => a.at - b.at);
}
