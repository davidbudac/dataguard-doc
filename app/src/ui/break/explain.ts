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

const DECISION_TITLE: Record<string, string> = {
  'FSFO.BOTH_MUST_HAVE_LOST': 'Failure confirmed',
  'FSFO.OBSERVER_REACHES_TARGET': 'Observer reaches target',
  'FSFO.READINESS_GATE': 'Standby readiness',
  'FSFO.OBSERVE_ONLY': 'Observe only',
  'FSFO.MANUAL_FAILOVER': 'Manual failover',
  'OBS.MASTER_LOST': 'Observer unavailable',
  'NOMINATION.NEW_MASTER': 'Backup observer nominated',
  'NOMINATION.PRECONDITION': 'Observer nomination check',
  'PRIMARY.STALL': 'Primary stalled',
  'PRIMARY.ABORT': 'Primary aborted',
  'PROT.MAXPROT_SHUTDOWN': 'Primary shut down',
  'SWITCHOVER.GATE': 'Switchover check',
  'SWITCHOVER.ZERO_LOSS': 'Roles changed',
  'ROLE.PRIMARY_DB_CANDIDATES': 'Candidate check',
  'EXEC.ENV_DEPENDENT': 'Role transition',
};

const COMMON_DECISIONS = new Set([
  'FSFO.BOTH_MUST_HAVE_LOST', 'FSFO.READINESS_GATE', 'FSFO.OBSERVE_ONLY',
  'FSFO.MANUAL_FAILOVER', 'OBS.MASTER_LOST', 'NOMINATION.NEW_MASTER',
  'PRIMARY.STALL', 'PRIMARY.ABORT', 'PROT.MAXPROT_SHUTDOWN',
  'SWITCHOVER.GATE', 'SWITCHOVER.ZERO_LOSS', 'ROLE.PRIMARY_DB_CANDIDATES',
  'EXEC.ENV_DEPENDENT',
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

  if (trace.facts.outcome === 'continues' && doc.config.fsfo.state === 'enabled'
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

  const resultAt = (trace.facts.blocked ? trace.facts.initiateAt : trace.facts.tOpen)
    ?? trace.facts.abortAt
    ?? trace.facts.initiateAt ?? Math.max(0, ...doc.events.map((e) => e.at));
  steps.push({
    key: 'result', at: resultAt, title: trace.facts.blocked ? 'Transition blocked' : 'Run result',
    detail: trace.facts.blocked ? 'The role transition was refused; no member changed role.'
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
