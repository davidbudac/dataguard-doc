/**
 * What can be done to a running configuration, as data.
 *
 * The canvas menu and the Break rail both read this table, so a click on a
 * card and a click in the rail can never offer two different vocabularies.
 * Three rules hold:
 *
 *  - **Events are timed, properties are not.** Crashing a host is an event at
 *    a moment on the clock; stopping redo apply is a property of the standby.
 *    Both are offered, in separate lists, and the list says which is which.
 *  - **An action that cannot fire says why.** Restoring something nothing has
 *    taken down, killing an observer that is not deployed, switching over with
 *    no standby to switch to: each is grey with its reason attached.
 *  - **Multi-select is the intersection.** Actions are keyed by a stable id,
 *    so selecting three cards offers exactly what all three can do.
 */

import { scenarioEvents } from '@/engine';
import type { ClassicScenario, HostId, TimedEvent, TopologyDoc } from '@/engine';
import { isDatabase } from '@/engine';
import { withEvents } from '@/state/doc';
import { edit } from '@/state/history';
import type { WhyState } from '../common/WhyPill';
import { off, ON, WHY } from '../inspector/why';

/* ---------------- what is down at t ---------------- */

type Thing = { kind: 'host'; id: string } | { kind: 'site'; id: string }
  | { kind: 'member'; id: string } | { kind: 'link'; id: string }
  | { kind: 'observer'; id: string } | { kind: 'instance'; member: string; id: string };

/**
 * The state an object is in at `t`, read off the injected events alone: the
 * last event before `t` that names it wins, and its own flag in the document
 * is where it starts. This is the rail's own reading, not the simulator's --
 * it decides which actions to offer, never what the configuration does.
 */
export function isDownAt(doc: TopologyDoc, thing: Thing, t: number): boolean {
  let down = false;
  if (thing.kind === 'link') {
    down = doc.links.find((l) => (l.id as string) === thing.id)?.up === false;
  }
  if (thing.kind === 'observer') {
    down = doc.observers.find((o) => (o.id as string) === thing.id)?.running === false;
  }
  for (const e of doc.events) {
    if (e.at > t) break;
    switch (e.kind) {
      case 'host.down': if (thing.kind === 'host' && (e.host as string) === thing.id) down = true; break;
      case 'host.up': if (thing.kind === 'host' && (e.host as string) === thing.id) down = false; break;
      case 'site.down': if (thing.kind === 'site' && (e.site as string) === thing.id) down = true; break;
      case 'site.up': if (thing.kind === 'site' && (e.site as string) === thing.id) down = false; break;
      case 'link.cut': if (thing.kind === 'link' && (e.link as string) === thing.id) down = true; break;
      case 'link.heal': if (thing.kind === 'link' && (e.link as string) === thing.id) down = false; break;
      case 'member.down': if (thing.kind === 'member' && (e.member as string) === thing.id) down = true; break;
      case 'member.up': if (thing.kind === 'member' && (e.member as string) === thing.id) down = false; break;
      case 'observer.stop': if (thing.kind === 'observer' && (e.observer as string) === thing.id) down = true; break;
      case 'observer.start': if (thing.kind === 'observer' && (e.observer as string) === thing.id) down = false; break;
      case 'instance.down':
        if (thing.kind === 'instance' && (e.member as string) === thing.member && e.instance === thing.id) down = true;
        break;
      case 'instance.up':
        if (thing.kind === 'instance' && (e.member as string) === thing.member && e.instance === thing.id) down = false;
        break;
      default: break;
    }
  }
  return down;
}

/* ---------------- the action table ---------------- */

export interface EventAction {
  /** Stable across subjects, so a multiple selection can be intersected. */
  id: string;
  label: string;
  /** The label to use when the action is applied to several subjects at once. */
  plural: string;
  enabled: WhyState;
  events: TimedEvent[];
  /** True for a property change: it takes effect everywhere, not at `at`. */
  property?: boolean;
  run?: () => void;
}

const hostName = (doc: TopologyDoc, id: HostId): string =>
  doc.hosts.find((h) => h.id === id)?.name ?? (id as string);

const siteOfHost = (doc: TopologyDoc, id: HostId): string | undefined =>
  doc.hosts.find((h) => h.id === id)?.site as string | undefined;

/** Every action the one selected object offers at `at`. */
export function actionsForKey(doc: TopologyDoc, key: string, at: number): EventAction[] {
  const out: EventAction[] = [];
  const member = doc.members.find((m) => (m.id as string) === key);
  const observer = doc.observers.find((o) => (o.id as string) === key);
  const link = doc.links.find((l) => (l.id as string) === key);
  const site = doc.sites.find((s) => (s.id as string) === key);
  const primary = doc.members.find((m) => isDatabase(m) && m.role === 'primary');

  if (member) {
    const hosts = member.instances.map((i) => i.host);
    const first = hosts[0];
    const allDown = hosts.length > 0 && hosts.every((h) => isDownAt(doc, { kind: 'host', id: h as string }, at));
    const anyDown = hosts.some((h) => isDownAt(doc, { kind: 'host', id: h as string }, at));
    out.push({
      id: 'host.down',
      label: hosts.length > 1
        ? `Crash all ${hosts.length} hosts of ${key}`
        : `Crash ${first === undefined ? 'the host' : hostName(doc, first)}`,
      plural: 'Crash the hosts',
      enabled: allDown ? off(WHY.alreadyDown) : ON,
      events: hosts
        .filter((h) => !isDownAt(doc, { kind: 'host', id: h as string }, at))
        .map((h) => ({ at, kind: 'host.down', host: h })),
    });
    out.push({
      id: 'host.up',
      label: hosts.length > 1 ? `Restore the hosts of ${key}` : 'Restore the host',
      plural: 'Restore the hosts',
      enabled: anyDown ? ON : off(WHY.nothingDown),
      events: hosts
        .filter((h) => isDownAt(doc, { kind: 'host', id: h as string }, at))
        .map((h) => ({ at, kind: 'host.up', host: h })),
    });
    if (member.instances.length > 1) {
      for (const inst of member.instances) {
        const down = isDownAt(doc, { kind: 'instance', member: key, id: inst.name }, at);
        out.push({
          id: `instance.down:${inst.name}`,
          label: `SHUTDOWN ABORT the instance ${inst.name}`,
          plural: 'SHUTDOWN ABORT the instance',
          enabled: down ? off(WHY.alreadyDown) : ON,
          events: [{ at, kind: 'instance.down', member: member.id, instance: inst.name }],
        });
        out.push({
          id: `instance.up:${inst.name}`,
          label: `Start the instance ${inst.name}`,
          plural: 'Start the instance',
          enabled: down ? ON : off(WHY.nothingDown),
          events: [{ at, kind: 'instance.up', member: member.id, instance: inst.name }],
        });
      }
    } else {
      const down = isDownAt(doc, { kind: 'member', id: key }, at);
      out.push({
        id: 'member.down',
        label: `SHUTDOWN ABORT ${key}`,
        plural: 'SHUTDOWN ABORT the database',
        enabled: down ? off(WHY.alreadyDown) : ON,
        events: [{ at, kind: 'member.down', member: member.id }],
      });
      out.push({
        id: 'member.up',
        label: `Start ${key}`,
        plural: 'Start the database',
        enabled: down ? ON : off(WHY.nothingDown),
        events: [{ at, kind: 'member.up', member: member.id }],
      });
    }
    const s = first === undefined ? undefined : siteOfHost(doc, first);
    if (s !== undefined) {
      const sDown = isDownAt(doc, { kind: 'site', id: s }, at);
      out.push({
        id: 'site.down',
        label: `Take the whole of ${s} down`,
        plural: 'Take the sites down',
        enabled: sDown ? off(WHY.alreadyDown) : ON,
        events: [{ at, kind: 'site.down', site: doc.sites.find((x) => (x.id as string) === s)!.id }],
      });
      out.push({
        id: 'site.up',
        label: `Bring ${s} back`,
        plural: 'Bring the sites back',
        enabled: sDown ? ON : off(WHY.nothingDown),
        events: [{ at, kind: 'site.up', site: doc.sites.find((x) => (x.id as string) === s)!.id }],
      });
    }
    if (isDatabase(member) && member.role !== 'primary') {
      out.push({
        id: 'cmd.switchover',
        label: `SWITCHOVER TO ${key}`,
        plural: 'Switch over',
        enabled: primary ? ON : off(WHY.noTarget),
        events: [{ at, kind: 'cmd.switchover', to: member.id }],
      });
      out.push({
        id: 'cmd.failover',
        label: `FAILOVER TO ${key}`,
        plural: 'Fail over',
        enabled: primary ? ON : off(WHY.noTarget),
        events: [{ at, kind: 'cmd.failover', to: member.id }],
      });
    }
    if (isDatabase(member)) {
      out.push({
        id: 'cmd.reinstate',
        label: `REINSTATE ${key}`,
        plural: 'Reinstate',
        enabled: ON,
        events: [{ at, kind: 'cmd.reinstate', member: member.id }],
      });
      const running = member.applyRunning;
      out.push({
        id: 'apply.toggle',
        label: running ? `Stop redo apply on ${key}` : `Start redo apply on ${key}`,
        plural: 'Toggle redo apply',
        enabled: member.role === 'primary' ? off(WHY.primaryNoApply) : ON,
        events: [],
        property: true,
        run: () => edit(
          `${running ? 'Stop' : 'Start'} redo apply on ${key}`,
          (d) => ({
            ...d,
            topology: {
              ...d.topology,
              members: d.topology.members.map((m) => (m.id === member.id && m.kind === 'database'
                ? { ...m, applyRunning: !running }
                : m)),
            },
          }),
        ),
      });
    }
  }

  if (observer) {
    const stopped = isDownAt(doc, { kind: 'observer', id: key }, at);
    out.push({
      id: 'observer.stop',
      label: `Stop the observer ${key}`,
      plural: 'Stop the observers',
      enabled: stopped ? off(WHY.alreadyDown) : ON,
      events: [{ at, kind: 'observer.stop', observer: observer.id }],
    });
    out.push({
      id: 'observer.start',
      label: `Start the observer ${key}`,
      plural: 'Start the observers',
      enabled: stopped ? ON : off('It is running already.'),
      events: [{ at, kind: 'observer.start', observer: observer.id }],
    });
    const hDown = isDownAt(doc, { kind: 'host', id: observer.host as string }, at);
    out.push({
      id: 'host.down',
      label: `Crash ${hostName(doc, observer.host)}`,
      plural: 'Crash the hosts',
      enabled: hDown ? off(WHY.alreadyDown) : ON,
      events: [{ at, kind: 'host.down', host: observer.host }],
    });
    out.push({
      id: 'host.up',
      label: `Restore ${hostName(doc, observer.host)}`,
      plural: 'Restore the hosts',
      enabled: hDown ? ON : off(WHY.nothingDown),
      events: [{ at, kind: 'host.up', host: observer.host }],
    });
    out.push({
      id: 'cmd.setMasterObserver',
      label: `SET MASTEROBSERVER TO ${key}`,
      plural: 'Set the master observer',
      enabled: observer.role === 'master' ? off('It is the master observer already.') : ON,
      events: [{ at, kind: 'cmd.setMasterObserver', observer: observer.id }],
    });
  }

  if (link) {
    const cut = isDownAt(doc, { kind: 'link', id: key }, at);
    out.push({
      id: 'link.cut',
      label: `Cut ${key}`,
      plural: 'Cut the links',
      enabled: cut ? off(WHY.alreadyDown) : ON,
      events: [{ at, kind: 'link.cut', link: link.id }],
    });
    out.push({
      id: 'link.heal',
      label: `Restore ${key}`,
      plural: 'Restore the links',
      enabled: cut ? ON : off(WHY.nothingDown),
      events: [{ at, kind: 'link.heal', link: link.id }],
    });
  }

  if (site) {
    const down = isDownAt(doc, { kind: 'site', id: key }, at);
    out.push({
      id: 'site.down',
      label: `Take ${site.name} down`,
      plural: 'Take the sites down',
      enabled: down ? off(WHY.alreadyDown) : ON,
      events: [{ at, kind: 'site.down', site: site.id }],
    });
    out.push({
      id: 'site.up',
      label: `Bring ${site.name} back`,
      plural: 'Bring the sites back',
      enabled: down ? ON : off(WHY.nothingDown),
      events: [{ at, kind: 'site.up', site: site.id }],
    });
  }

  return out;
}

/**
 * The actions a whole selection offers: the intersection by id, with the
 * events of every subject folded into one entry, so one click is one undo.
 */
export function actionsFor(doc: TopologyDoc, keys: readonly string[], at: number): EventAction[] {
  if (keys.length === 0) return [];
  const per = keys.map((k) => actionsForKey(doc, k, at));
  const first = per[0];
  if (first === undefined) return [];
  if (per.length === 1) return first;
  const out: EventAction[] = [];
  for (const a of first) {
    const mates = per.slice(1).map((list) => list.find((x) => x.id === a.id));
    if (mates.some((m) => m === undefined)) continue;
    const all = [a, ...(mates as EventAction[])];
    const blocked = all.find((x) => x.enabled.state === 'off');
    out.push({
      id: a.id,
      label: `${a.plural} (${keys.length})`,
      plural: a.plural,
      enabled: blocked ? blocked.enabled : ON,
      events: all.flatMap((x) => x.events),
      ...(a.property ? { property: true } : {}),
    });
  }
  return out;
}

/** Inject an action's events under one undo entry. */
export function runAction(action: EventAction): void {
  if (action.enabled.state === 'off') return;
  if (action.property === true) { action.run?.(); return; }
  if (action.events.length === 0) return;
  edit(action.label, (d) => withEvents(d, [...d.topology.events, ...action.events]));
}

/* ---------------- the six templates ---------------- */

export interface Template {
  id: ClassicScenario;
  label: string;
  caption: string;
  enabled: WhyState;
  events: TimedEvent[];
}

const siteName = (doc: TopologyDoc, id: string): string =>
  doc.sites.find((s) => (s.id as string) === id)?.name ?? id;

/**
 * The six scenarios the published workbench carries, as one-click templates.
 *
 * The events come from the engine's own `scenarioEvents`, which is what the
 * 24-cell regression matrix runs on -- so a template here reproduces the
 * outcome the published page draws for the same deployment, rather than an
 * approximation of it.
 */
export function templates(doc: TopologyDoc, at = 0): Template[] {
  const primary = doc.members.find((m) => isDatabase(m) && m.role === 'primary');
  const target = doc.config.fsfo.target;
  const targetId = target.kind === 'list' ? target.members[0] : undefined;
  const standby = doc.members.find(
    (m) => isDatabase(m) && (m.role === 'physical' || m.role === 'logical'),
  );
  const primarySite = primary?.instances[0] ? siteOfHost(doc, primary.instances[0].host) : undefined;
  const targetMember = doc.members.find((m) => m.id === (targetId ?? standby?.id));
  const targetSite = targetMember?.instances[0]
    ? siteOfHost(doc, targetMember.instances[0].host)
    : undefined;
  const master = doc.observers.find((o) => o.role === 'master') ?? doc.observers[0];

  const shift = (evts: TimedEvent[]): TimedEvent[] => evts.map((e) => ({ ...e, at }));
  const mk = (id: ClassicScenario): TimedEvent[] => shift(scenarioEvents(id, doc));

  const noPrimary = off('No member holds the primary role.');
  const linkBetween = primarySite !== undefined && targetSite !== undefined
    && doc.links.some((l) => l.scope === 'site'
      && (l.ends as [string, string]).includes(primarySite)
      && (l.ends as [string, string]).includes(targetSite));

  return [
    {
      id: 'crash',
      label: 'Crash the primary host',
      caption: 'The primary host dies outright. Observer and standby both lose it at the same instant.',
      enabled: primary ? ON : noPrimary,
      events: mk('crash'),
    },
    {
      id: 'isolated',
      label: 'Isolate the primary site',
      caption: 'A network partition cuts the primary off from both the observer and the standby. The primary is still running.',
      enabled: primary
        ? (mk('isolated').length > 0 ? ON : off('No site link touches the primary’s data centre.'))
        : noPrimary,
      events: mk('isolated'),
    },
    {
      id: 'partition',
      label: primarySite !== undefined && targetSite !== undefined
        ? `Cut ${siteName(doc, primarySite)} to ${siteName(doc, targetSite)}`
        : 'Cut the link between the database sites',
      caption: 'Only the link between the two database sites fails. Both databases are still running, and everything else in both sites is healthy.',
      enabled: linkBetween ? ON : off('The two database sites have no link between them to cut.'),
      events: mk('partition'),
    },
    {
      id: 'dc2down',
      label: 'Lose the standby site',
      caption: 'The whole standby site is lost -- the standby database and every other host in it.',
      enabled: targetSite === undefined ? off(WHY.noTarget) : ON,
      events: mk('dc2down'),
    },
    {
      id: 'observer-lost',
      label: 'Kill the master observer',
      caption: doc.observers.length > 1
        ? 'The master observer’s host dies. The primary still reaches the standby, so it keeps serving; with both databases still connected, the broker tries to nominate a backup observer as the new master.'
        : 'The configuration’s only observer host dies. The primary still reaches the standby, so it keeps serving -- but nothing can fail over.',
      enabled: master === undefined ? off(WHY.noObserverDeployed) : ON,
      events: mk('observer-lost'),
    },
    {
      id: 'switchover',
      label: 'Switch over',
      caption: 'A planned role reversal: the DBA issues SWITCHOVER TO the target standby. Both hosts stay up, and zero data loss is guaranteed.',
      enabled: targetMember === undefined ? off(WHY.noTarget) : ON,
      events: mk('switchover'),
    },
  ];
}

/** A template replaces the event list: a scenario is reproducible or it is nothing. */
export function applyTemplate(t: Template): void {
  if (t.enabled.state === 'off') return;
  edit(`Apply the scenario: ${t.label}`, (d) => withEvents(d, t.events));
}

export function clearEvents(): void {
  edit('Clear the injected events', (d) => withEvents(d, []));
}

export function removeEventAt(index: number): void {
  edit('Remove an injected event', (d) => withEvents(
    d, d.topology.events.filter((_, i) => i !== index),
  ));
}

export function setEventTime(index: number, at: number): void {
  edit(`Move an injected event to t = ${at} s`, (d) => withEvents(
    d, d.topology.events.map((e, i) => (i === index ? { ...e, at } : e)),
  ), `event-at:${index}`);
}

/* ---------------- words ---------------- */

/** One sentence for one injected event, in the vocabulary of the menu. */
export function describeEvent(doc: TopologyDoc, e: TimedEvent): string {
  switch (e.kind) {
    case 'host.down': return `Crash ${hostName(doc, e.host)}`;
    case 'host.up': return `Restore ${hostName(doc, e.host)}`;
    case 'site.down': return `Take ${siteName(doc, e.site as string)} down`;
    case 'site.up': return `Bring ${siteName(doc, e.site as string)} back`;
    case 'link.cut': return `Cut ${e.link as string}`;
    case 'link.heal': return `Restore ${e.link as string}`;
    case 'partition': return `Partition into ${e.groups.length} groups`;
    case 'instance.down': return `SHUTDOWN ABORT the instance ${e.instance}`;
    case 'instance.up': return `Start the instance ${e.instance}`;
    case 'member.down': return `SHUTDOWN ABORT ${e.member as string}`;
    case 'member.up': return `Start ${e.member as string}`;
    case 'observer.stop': return `Stop the observer ${e.observer as string}`;
    case 'observer.start': return `Start the observer ${e.observer as string}`;
    case 'cmd.switchover': return `SWITCHOVER TO ${e.to as string}`;
    case 'cmd.failover': return `FAILOVER TO ${e.to as string}${e.immediate === true ? ' IMMEDIATE' : ''}`;
    case 'cmd.reinstate': return `REINSTATE ${e.member as string}`;
    case 'cmd.setMasterObserver': return `SET MASTEROBSERVER TO ${e.observer as string}`;
    case 'cmd.disableFsfo':
      return `DISABLE FAST_START FAILOVER${e.force === true ? ' FORCE' : ''}`;
    case 'lag.set': return `Set the lag on ${e.member as string}`;
  }
}
