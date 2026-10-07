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

import { scenarioEvents, stateAt } from '@/engine';
import type { ClassicScenario, DatabaseMember, HostId, TimedEvent, TopologyDoc } from '@/engine';
import { findApplication, hasApplyInstance, isDatabase } from '@/engine';
import { withEvents } from '@/state/doc';
import { topology, trace } from '@/state/derived';
import { edit } from '@/state/history';
import { appLanesShown, healthyRun, mode, playing, tNow, toast } from '@/state/view';
import { lastInterestingT } from '@/ui/timeline/build';
import type { WhyState } from '../common/WhyPill';
import type { CanvasTool, ToolIconName } from '../canvas/HoverTools';
import { eventIcon } from '../common/eventIcons';
import { off, ON, WHY } from '../inspector/why';

import { eventTimeRefusal, reorderRefusal, snapEventTime } from './event-order';

/* ---------------- names ---------------- */

const hostName = (doc: TopologyDoc, id: HostId): string =>
  doc.hosts.find((h) => h.id === id)?.name ?? (id as string);

const siteName = (doc: TopologyDoc, id: string): string =>
  doc.sites.find((s) => (s.id as string) === id)?.name ?? id;

const siteOfHost = (doc: TopologyDoc, id: HostId): string | undefined =>
  doc.hosts.find((h) => h.id === id)?.site as string | undefined;

/* ---------------- what is down at t ---------------- */

type Thing = { kind: 'host'; id: string } | { kind: 'site'; id: string }
  | { kind: 'member'; id: string } | { kind: 'link'; id: string }
  | { kind: 'observer'; id: string } | { kind: 'instance'; member: string; id: string };

/**
 * The state an object is in at `t`, read off the injected events alone: the
 * last event before `t` that names it wins, and its own flag in the document
 * is where it starts. This is the rail's own reading, not the simulator's --
 * it decides which actions to offer, never what the configuration does.
 *
 * On its own it is not enough to decide what is down, because it only ever
 * sees the events that *name* a thing: see `isDownAt` below.
 */
function literalDownAt(doc: TopologyDoc, thing: Thing, t: number): boolean {
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

/** The index of the latest `link.cut` on this link at or before `t`, unless a heal after it put it back. */
function lastCutIndex(doc: TopologyDoc, link: string, t: number): number | null {
  let idx: number | null = null;
  doc.events.forEach((e, i) => {
    if (e.at > t) return;
    if (e.kind === 'link.cut' && (e.link as string) === link) idx = i;
    if (e.kind === 'link.heal' && (e.link as string) === link) idx = null;
  });
  return idx;
}

/** The index of the first `link.cut` on this link after `t`, or null. */
function nextCutIndex(doc: TopologyDoc, link: string, t: number): number | null {
  const i = doc.events.findIndex((e) => e.at > t && e.kind === 'link.cut' && (e.link as string) === link);
  return i < 0 ? null : i;
}

/**
 * Whether a thing is down at `t`, containment included.
 *
 * The literal reading above asks only which events name the object, and that
 * is not what the reader is looking at. Crash `dc1-prm01` and the simulator
 * has `prm01` down -- the canvas draws the card hatched red with a cross --
 * while a reading of the event kinds alone still calls the database up. The
 * menu then dropped "Start prm01" into the silent group and printed "nothing
 * else here is down" one line under a card drawn down.
 *
 * So the containment folds in, downward from the outside: a data centre holds
 * its hosts, a host holds the instances and the observer running on it, and a
 * member is down once every instance of it is. Sites and links have nothing
 * above them, so for those the literal reading is the whole of it.
 */
export function isDownAt(doc: TopologyDoc, thing: Thing, t: number): boolean {
  if (literalDownAt(doc, thing, t)) return true;
  switch (thing.kind) {
    case 'host': {
      const site = siteOfHost(doc, thing.id as HostId);
      return site !== undefined && isDownAt(doc, { kind: 'site', id: site }, t);
    }
    case 'instance': {
      const host = doc.members.find((m) => (m.id as string) === thing.member)
        ?.instances.find((i) => i.name === thing.id)?.host;
      return host !== undefined && isDownAt(doc, { kind: 'host', id: host as string }, t);
    }
    case 'member': {
      const m = doc.members.find((x) => (x.id as string) === thing.id);
      if (m === undefined || m.instances.length === 0) return false;
      return m.instances.every(
        (i) => isDownAt(doc, { kind: 'instance', member: thing.id, id: i.name }, t),
      );
    }
    case 'observer': {
      const host = doc.observers.find((o) => (o.id as string) === thing.id)?.host;
      return host !== undefined && isDownAt(doc, { kind: 'host', id: host as string }, t);
    }
    default: return false;
  }
}

/**
 * Whether the object a key names, or anything inside it, is down at `t`.
 *
 * The quiet line under the menu is a statement about the *selection*, and the
 * menu's own list cannot answer it. `actionsFor` intersects, keeping the first
 * *blocked* subject's reason, so one cut link selected beside a whole one
 * collapses `link.heal` to "nothing has taken it down" -- true of the pair,
 * false of the drawing. And a data centre offers only its own two actions, so
 * a crashed host inside it leaves nothing on the list to notice. Both printed
 * "nothing here is down" over a drawing that showed something down.
 */
export function anythingDownUnder(doc: TopologyDoc, key: string, t: number): boolean {
  if (doc.sites.some((s) => (s.id as string) === key)) {
    if (isDownAt(doc, { kind: 'site', id: key }, t)) return true;
    const hosts = doc.hosts.filter((h) => (h.site as string) === key);
    const inSite = (h: HostId): boolean => hosts.some((x) => x.id === h);
    return hosts.some((h) => isDownAt(doc, { kind: 'host', id: h.id as string }, t))
      || doc.observers.some((o) => inSite(o.host)
        && isDownAt(doc, { kind: 'observer', id: o.id as string }, t))
      || doc.members.some((m) => m.instances.some((i) => inSite(i.host)
        && isDownAt(doc, { kind: 'instance', member: m.id as string, id: i.name }, t)));
  }
  const member = doc.members.find((m) => (m.id as string) === key);
  if (member) {
    return isDownAt(doc, { kind: 'member', id: key }, t)
      || member.instances.some(
        (i) => isDownAt(doc, { kind: 'instance', member: key, id: i.name }, t),
      );
  }
  if (doc.observers.some((o) => (o.id as string) === key)) {
    return isDownAt(doc, { kind: 'observer', id: key }, t);
  }
  const application = findApplication(doc, key);
  if (application !== undefined) {
    return isDownAt(doc, { kind: 'host', id: application.host as string }, t);
  }
  if (doc.links.some((l) => (l.id as string) === key)) {
    return isDownAt(doc, { kind: 'link', id: key }, t);
  }
  return false;
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
  /**
   * The glyph, when the event kind does not picture it: isolating a data
   * centre is `link.cut` events and a property has none (`actionIcon`).
   */
  icon?: ToolIconName;
}

/**
 * The container still holding this host down, named, or `null`.
 *
 * The simulator keeps down hosts, down sites and down members in separate
 * sets, so `host.up` on a host inside a downed data centre injects an event
 * that changes not one pixel of the drawing. The restore stays on the list --
 * the host really is down, and dropping the restore of something that is down
 * is exactly the lie item 10 set out to stop -- and says which one to bring
 * back first instead of firing into nothing.
 */
const heldBySite = (doc: TopologyDoc, host: HostId, at: number): string | null => {
  const s = siteOfHost(doc, host);
  return s !== undefined && isDownAt(doc, { kind: 'site', id: s }, at)
    ? `${siteName(doc, s)} is down: bring the whole data centre back first.`
    : null;
};

/** The same, one level in: nothing starts on a host that is not there. */
const heldByHost = (doc: TopologyDoc, host: HostId, at: number): string | null =>
  (isDownAt(doc, { kind: 'host', id: host as string }, at)
    ? `${hostName(doc, host)} is down: restore the host first.`
    : null);

/**
 * A database the broker itself shut down: FastStartFailoverPmyShutdown on a
 * stalled primary, or maximum protection with no standby left to acknowledge.
 * No injected event names it, so the literal reading calls it up -- but the
 * run has it aborted, and the drawing shows it so.
 */
export const ABORTED_BY_BROKER =
  'The broker has already shut it down at this point on the clock.';
export const NO_RESTART_AFTER_ABORT =
  'The broker shut it down. Restarting a database the broker shut down is not modelled on this page.';

/** The run's own state for a member at `at`, when the trace is this document's. */
const simMemberState = (doc: TopologyDoc, key: string, at: number): string | undefined => {
  const t = trace.value;
  if (t === null || doc !== topology.value) return undefined;
  return (stateAt(t, at).members as Record<string, string>)[key];
};

/**
 * Whether the run shows this member, at `at`, as the primary a role change
 * has already replaced -- read off the trace's own facts (`newPrimary`) and
 * its own per-instant state (`simMemberState`), never recomputed here.
 * REINSTATE DATABASE is offered on the strength of this alone: a database
 * that is still the primary in the drawing at this instant, still holds the
 * role for the whole run, or never held it, is not what a reinstatement is
 * for.
 */
const isFormerPrimary = (doc: TopologyDoc, member: DatabaseMember, at: number): boolean => {
  const t = trace.value;
  if (t === null || doc !== topology.value) return false;
  if (member.role !== 'primary' || t.facts.newPrimary === null || t.facts.newPrimary === member.id) return false;
  return simMemberState(doc, member.id as string, at) !== 'open-rw';
};

/** Every action the one selected object offers at `at`. */
export function actionsForKey(doc: TopologyDoc, key: string, at: number): EventAction[] {
  const out: EventAction[] = [];
  const member = doc.members.find((m) => (m.id as string) === key);
  const observer = doc.observers.find((o) => (o.id as string) === key);
  const link = doc.links.find((l) => (l.id as string) === key);
  const site = doc.sites.find((s) => (s.id as string) === key);
  const primary = doc.members.find((m) => isDatabase(m) && m.role === 'primary');

  if (member) {
    /* Aborted by the broker and not by any event: shutting it down again is
       nothing, and starting it is outside what the run models. */
    const aborted = simMemberState(doc, key, at) === 'aborted';
    const hosts = member.instances.map((i) => i.host);
    const first = hosts[0];
    const allDown = hosts.length > 0 && hosts.every((h) => isDownAt(doc, { kind: 'host', id: h as string }, at));
    const anyDown = hosts.some((h) => isDownAt(doc, { kind: 'host', id: h as string }, at));
    const hostHeld = hosts.map((h) => heldBySite(doc, h, at)).find((r) => r !== null) ?? null;
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
      enabled: hostHeld !== null ? off(hostHeld) : (anyDown ? ON : off(WHY.nothingDown)),
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
          enabled: down ? off(WHY.alreadyDown) : aborted ? off(ABORTED_BY_BROKER) : ON,
          events: [{ at, kind: 'instance.down', member: member.id, instance: inst.name }],
        });
        const held = heldByHost(doc, inst.host, at);
        out.push({
          id: `instance.up:${inst.name}`,
          label: `Start the instance ${inst.name}`,
          plural: 'Start the instance',
          enabled: held !== null ? off(held) : down ? ON
            : aborted ? off(NO_RESTART_AFTER_ABORT) : off(WHY.nothingDown),
          events: [{ at, kind: 'instance.up', member: member.id, instance: inst.name }],
        });
      }
      /* A RAC standby: move apply by hand, the documented
         SET STATE='APPLY-ON' WITH APPLY INSTANCE. */
      if (hasApplyInstance(member)) {
        for (const inst of member.instances) {
          const down = isDownAt(doc, { kind: 'instance', member: key, id: inst.name }, at);
          out.push({
            id: `cmd.setApplyInstance:${inst.name}`,
            label: `Move apply to ${inst.name}`,
            plural: 'Move apply to the instance',
            enabled: down ? off('The instance is down: apply runs only on a running instance.') : ON,
            events: [{ at, kind: 'cmd.setApplyInstance', member: member.id, instance: inst.name }],
          });
        }
      }
    } else {
      const down = isDownAt(doc, { kind: 'member', id: key }, at);
      const held = first === undefined ? null : heldByHost(doc, first, at);
      out.push({
        id: 'member.down',
        label: `SHUTDOWN ABORT ${key}`,
        plural: 'SHUTDOWN ABORT the database',
        enabled: down ? off(WHY.alreadyDown) : aborted ? off(ABORTED_BY_BROKER) : ON,
        events: [{ at, kind: 'member.down', member: member.id }],
      });
      out.push({
        id: 'member.up',
        label: `Start ${key}`,
        plural: 'Start the database',
        enabled: held !== null ? off(held) : down ? ON
          : aborted ? off(NO_RESTART_AFTER_ABORT) : off(WHY.nothingDown),
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
      /* The engine refuses SWITCHOVER TO a down target, and refuses it while
         the primary is down -- the broker verifies both databases before it
         converts either. FAILOVER TO refuses only a down target: the primary
         being down is exactly the case a failover is for. Neither check here
         is the engine's connectivity gate (the two being unable to reach each
         other): that reading is not one of this file's own helpers, so the
         menu still offers the command and the run itself refuses it. */
      const targetDown = isDownAt(doc, { kind: 'member', id: key }, at);
      const primaryDown = primary !== undefined
        && isDownAt(doc, { kind: 'member', id: primary.id as string }, at);
      out.push({
        id: 'cmd.switchover',
        label: `SWITCHOVER TO ${key}`,
        plural: 'Switch over',
        enabled: !primary ? off(WHY.noTarget)
          : member.role === 'snapshot' ? off(WHY.switchoverSnapshot)
            : member.role === 'logical' && doc.config.protectionMode === 'MAXPROTECTION'
              ? off(WHY.switchoverLogicalMaxProt)
              : targetDown ? off(WHY.switchoverTargetDown)
                : primaryDown ? off(WHY.switchoverPrimaryDown) : ON,
        events: [{ at, kind: 'cmd.switchover', to: member.id }],
      });
      out.push({
        id: 'cmd.failover',
        label: `FAILOVER TO ${key}`,
        plural: 'Fail over',
        enabled: !primary ? off(WHY.noTarget)
          : targetDown ? off(WHY.failoverTargetDown) : ON,
        events: [{ at, kind: 'cmd.failover', to: member.id }],
      });
    }
    if (isDatabase(member)) {
      out.push({
        id: 'cmd.reinstate',
        label: `REINSTATE DATABASE ${key}`,
        plural: 'Reinstate',
        enabled: isFormerPrimary(doc, member, at) ? ON : off(WHY.notFormerPrimary),
        events: [{ at, kind: 'cmd.reinstate', member: member.id }],
      });
      const running = member.applyRunning;
      /* Redo Apply on a physical standby, SQL Apply on a logical one. */
      const applyName = member.role === 'logical' ? 'SQL Apply' : 'redo apply';
      out.push({
        id: 'apply.toggle',
        label: running ? `Stop ${applyName} on ${key}` : `Start ${applyName} on ${key}`,
        plural: `Toggle ${applyName}`,
        enabled: member.role === 'primary' ? off(WHY.primaryNoApply)
          : member.role === 'snapshot' ? off(WHY.snapshotNoApply) : ON,
        events: [],
        property: true,
        icon: running ? 'stop' : 'start',
        run: () => edit(
          `${running ? 'Stop' : 'Start'} ${applyName} on ${key}`,
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

  /* The application is its host: crashing the host is the one thing that
     happens to it, and it decides nothing about what the configuration does. */
  const app = findApplication(doc, key);
  if (app) {
    const hDown = isDownAt(doc, { kind: 'host', id: app.host as string }, at);
    const hostHeld = heldBySite(doc, app.host, at);
    out.push({
      id: 'host.down',
      label: `Crash ${hostName(doc, app.host)}`,
      plural: 'Crash the hosts',
      enabled: hDown ? off(WHY.alreadyDown) : ON,
      events: [{ at, kind: 'host.down', host: app.host }],
    });
    out.push({
      id: 'host.up',
      label: `Restore ${hostName(doc, app.host)}`,
      plural: 'Restore the hosts',
      enabled: hostHeld !== null ? off(hostHeld) : (hDown ? ON : off(WHY.nothingDown)),
      events: [{ at, kind: 'host.up', host: app.host }],
    });
  }

  if (observer) {
    const stopped = isDownAt(doc, { kind: 'observer', id: key }, at);
    const held = heldByHost(doc, observer.host, at);
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
      /* One reason per class, from the WHY table: this is a restore like the
         other five, and a bespoke "It is running already." kept it out of the
         group the menu says the reason once for -- so a grey restore was drawn
         directly above the line whose whole job is to stand in for it. */
      enabled: held !== null ? off(held) : (stopped ? ON : off(WHY.nothingDown)),
      events: [{ at, kind: 'observer.start', observer: observer.id }],
    });
    if (observer.running === false) {
      out.push({
        id: 'observer.markRunning',
        label: `Mark ${key} running in the configuration`,
        plural: 'Mark the observers running',
        enabled: ON,
        events: [],
        property: true,
        icon: 'start',
        run: () => edit(`Mark ${key} running`, (d) => ({
          ...d,
          topology: {
            ...d.topology,
            observers: d.topology.observers.map((o) => (o.id === observer.id ? { ...o, running: true } : o)),
          },
        })),
      });
    }
    const hDown = isDownAt(doc, { kind: 'host', id: observer.host as string }, at);
    const hostHeld = heldBySite(doc, observer.host, at);
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
      enabled: hostHeld !== null ? off(hostHeld) : (hDown ? ON : off(WHY.nothingDown)),
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
    /* What is holding it down, named -- because "Restore" means three
       different things and the reader cannot tell them apart on the drawing:
       an injected cut at this very instant is simply taken back; a cut
       earlier on the clock gets a heal here *and* the offer to take the cut
       back wherever it is; a link marked down in the configuration (Build's
       "Mark it down", `up: false`) is healed here as an event, and the row
       under it says where the mark lives and offers to lift it. */
    const cutIdx = lastCutIndex(doc, link.id as string, at);
    const cutAt = cutIdx === null ? null : doc.events[cutIdx]?.at ?? null;
    if (cut && cutAt !== null && cutAt === at) {
      out.push({
        id: 'link.heal',
        label: `Restore ${key}`,
        plural: 'Restore the links',
        enabled: ON,
        events: [],
        run: () => removeEventAt(cutIdx as number),
      });
    } else {
      out.push({
        id: 'link.heal',
        label: `Restore ${key}`,
        plural: 'Restore the links',
        enabled: cut ? ON : off(WHY.nothingDown),
        events: [{ at, kind: 'link.heal', link: link.id }],
      });
    }
    if (cut && cutAt !== null && cutAt !== at) {
      out.push({
        id: 'link.uncut',
        label: `Take back the cut at t = ${cutAt} s`,
        plural: 'Take back the cuts',
        enabled: ON,
        events: [],
        run: () => removeEventAt(cutIdx as number),
      });
    }
    /* Cut later on the clock than the playhead: not down *here*, but the
       reader scrubbing back to before their own cut still wants a way out
       that is not the rail's event list. */
    const laterCut = !cut ? nextCutIndex(doc, link.id as string, at) : null;
    if (laterCut !== null) {
      out.push({
        id: 'link.uncut',
        label: `Take back the cut at t = ${doc.events[laterCut]?.at ?? 0} s`,
        plural: 'Take back the cuts',
        enabled: ON,
        events: [],
        run: () => removeEventAt(laterCut),
      });
    }
    if (link.up === false) {
      out.push({
        id: 'link.markUp',
        label: `Mark ${key} up in the configuration`,
        plural: 'Mark the links up',
        enabled: ON,
        events: [],
        property: true,
        icon: 'heal',
        run: () => edit(`Mark ${key} up`, (d) => ({
          ...d,
          topology: {
            ...d.topology,
            links: d.topology.links.map((l) => (l.id === link.id ? { ...l, up: true } : l)),
          },
        })),
      });
    }
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
    /* Isolating is the classic "isolated" scenario aimed at this data centre:
       every site link that touches it is cut, and the data centre itself keeps
       running. Reconnecting heals whichever of those links are down now. */
    const own = doc.links.filter((l) => l.scope === 'site' && (l.ends as readonly string[]).includes(key));
    const open = own.filter((l) => !isDownAt(doc, { kind: 'link', id: l.id as string }, at));
    const shut = own.filter((l) => isDownAt(doc, { kind: 'link', id: l.id as string }, at));
    out.push({
      id: 'site.isolate',
      label: `Isolate ${site.name}`,
      plural: 'Isolate the sites',
      enabled: own.length === 0
        ? off('No link leaves this data centre, so there is nothing to cut.')
        : open.length === 0 ? off(WHY.alreadyDown) : ON,
      events: open.map((l) => ({ at, kind: 'link.cut', link: l.id }) as TimedEvent),
      icon: 'isolate',
    });
    out.push({
      id: 'site.reconnect',
      label: `Reconnect ${site.name}`,
      plural: 'Reconnect the sites',
      enabled: shut.length === 0 ? off(WHY.nothingDown) : ON,
      events: shut.map((l) => ({ at, kind: 'link.heal', link: l.id }) as TimedEvent),
      icon: 'reconnect',
    });
  }

  return out;
}

/* ---------------- the icons on hover ---------------- */

type HoverTool = CanvasTool;
type ToolIcon = ToolIconName;

/**
 * The few actions worth an icon on the thing under the pointer, in Break.
 *
 * Read off `actionsForKey` rather than beside it, so an icon and the menu row
 * it abbreviates share one label and one refusal. Each pair of opposites is one
 * slot: the way down while the thing is up, the way back once it is down --
 * grey with its reason as its title when that way back is refused.
 */
export function hoverTools(doc: TopologyDoc, key: string, at: number, opts: RunOptions = {}): CanvasTool[] {
  const all = actionsForKey(doc, key, at);
  const find = (id: string): EventAction | undefined => all.find((a) => a.id === id);
  const tool = (a: EventAction, icon: ToolIcon): HoverTool => ({
    id: a.id, icon, label: a.label, enabled: a.enabled, run: () => runAction(a, opts),
  });
  const pair = (downId: string, downIcon: ToolIcon, upId: string, upIcon: ToolIcon): HoverTool | null => {
    const d = find(downId);
    const u = find(upId);
    /* Down already: the slot is the way back, even when that is refused --
       "restore the site first" says more than "it is already down". */
    const isDown = d !== undefined && d.enabled.state === 'off'
      && (d.enabled.why === WHY.alreadyDown || d.enabled.why === ABORTED_BY_BROKER);
    if (u && (isDown || (u.enabled.state === 'on' && (!d || d.enabled.state === 'off')))) return tool(u, upIcon);
    if (d) return tool(d, downIcon);
    return u ? tool(u, upIcon) : null;
  };
  /* A RAC database has no member-wide shutdown in the table, only one per
     instance: its icon folds them into one entry, one undo. */
  const perInstance = (prefix: 'instance.down' | 'instance.up', label: string, why: WhyState): EventAction | undefined => {
    const each = all.filter((a) => a.id.startsWith(`${prefix}:`));
    if (each.length === 0) return undefined;
    const live = each.filter((a) => a.enabled.state === 'on');
    return {
      id: prefix,
      label,
      plural: label,
      enabled: live.length > 0 ? ON : (each[0]?.enabled ?? why),
      events: live.flatMap((a) => a.events),
    };
  };

  const out: (HoverTool | null)[] = [];
  const member = doc.members.find((m) => (m.id as string) === key);
  if (member) {
    const rac = perInstance('instance.down', `SHUTDOWN ABORT every instance of ${key}`, off(WHY.alreadyDown));
    if (rac) {
      const up = perInstance('instance.up', `Start every instance of ${key}`, off(WHY.nothingDown));
      all.push(rac, ...(up ? [up] : []));
      out.push(pair('instance.down', 'shutdown', 'instance.up', 'startup'));
    } else {
      out.push(pair('member.down', 'shutdown', 'member.up', 'startup'));
    }
    out.push(pair('host.down', 'crash', 'host.up', 'restore'));
  } else if (doc.observers.some((o) => (o.id as string) === key)) {
    out.push(pair('observer.stop', 'stop', 'observer.start', 'start'));
    out.push(pair('host.down', 'crash', 'host.up', 'restore'));
  } else if (findApplication(doc, key) !== undefined) {
    out.push(pair('host.down', 'crash', 'host.up', 'restore'));
  } else if (doc.links.some((l) => (l.id as string) === key)) {
    out.push(pair('link.cut', 'cut', 'link.heal', 'heal'));
  } else if (doc.sites.some((st) => (st.id as string) === key)) {
    out.push(pair('site.down', 'crash', 'site.up', 'restore'));
    out.push(pair('site.isolate', 'isolate', 'site.reconnect', 'reconnect'));
  }
  return out.filter((t): t is HoverTool => t !== null);
}

/**
 * The actions that put something back. They are the one group whose whole
 * point is that it is usually refused, so the menu treats them together rather
 * than pinning the same refusal to each of them in turn.
 *
 * Keyed off the ids the table above hands out, with the instance actions'
 * `:name` suffix taken off first.
 */
const RESTORE_IDS: readonly string[] = [
  'host.up', 'member.up', 'instance.up', 'site.up', 'site.reconnect', 'link.heal', 'observer.start',
];

export const isRestore = (a: EventAction): boolean =>
  RESTORE_IDS.includes(a.id.split(':')[0] as string);

/**
 * A restore that has nothing to restore. The test is the reason, not the
 * action id, so a new restore added to the table joins this group by saying
 * the same thing rather than by being listed here twice.
 */
export const nothingToRestore = (a: EventAction): boolean =>
  a.enabled.state === 'off' && a.enabled.why === WHY.nothingDown;

/**
 * The one line that stands where a column of identical refusals used to be,
 * or `null` when nothing was dropped and there is nothing to stand in for.
 *
 * Four readings, and the branches are the whole point: with something still
 * down it may not say "nothing here is down", and the fact of what is down is
 * read off the *subjects* (`anythingDownUnder`), never off the list -- the
 * list is an intersection that keeps the first blocked subject's reason, and
 * reading it made the sentence contradict the drawing beside it.
 *
 * It lives here rather than in the menu because the menu is no longer the only
 * surface that offers these actions: a bar on the canvas that dropped the same
 * entries and wrote its own sentence would be a second place for this to go
 * wrong.
 */
export function restoreQuietLine(
  doc: TopologyDoc, keys: readonly string[], at: number, actions: readonly EventAction[],
): string | null {
  const events = actions.filter((a) => a.property !== true);
  const dropped = events.filter(nothingToRestore).length;
  if (dropped === 0) return null;
  /* With the host down and the site up, "nothing here is down" would be a lie:
     the branch is on whether *any* restore survived the drop. */
  if (events.some((a) => isRestore(a) && a.enabled.state === 'on')) {
    return 'The other restores are not listed — nothing else here is down.';
  }
  if (!keys.some((k) => anythingDownUnder(doc, k, at))) {
    return 'Nothing to restore — nothing here is down.';
  }
  return keys.length > 1
    ? 'Restoring is not offered for all of these at once — only part of this selection is down. Select the one that is down.'
    : 'This one is up — what is down sits inside it and carries its own restore. Select it on the drawing.';
}

/* ---------------- the groups a menu sorts them into ---------------- */

/**
 * The event kind an action injects, or the one it stands for when it injects
 * none: taking a cut back or healing at the very instant of the cut edits the
 * list rather than adding to it, and isolating a data centre whose links are
 * all down already has nothing left to cut. `null` for a property.
 */
const ID_KIND: Readonly<Record<string, TimedEvent['kind']>> = {
  'link.heal': 'link.heal',
  'link.uncut': 'link.heal',
  'site.isolate': 'link.cut',
  'site.reconnect': 'link.heal',
};

export function actionKind(a: EventAction): TimedEvent['kind'] | null {
  if (a.property === true) return null;
  return a.events[0]?.kind ?? ID_KIND[a.id.split(':')[0] as string] ?? null;
}

/** The groups the canvas's context menu sorts the table into, in order. */
export type ActionGroup = 'fail' | 'restore' | 'role' | 'broker' | 'setting';

export const ACTION_GROUPS: readonly ActionGroup[] = ['fail', 'restore', 'role', 'broker', 'setting'];

export const ACTION_GROUP_LABEL: Readonly<Record<ActionGroup, string>> = {
  fail: 'Fail',
  restore: 'Restore',
  role: 'Role change',
  broker: 'Broker',
  setting: 'Setting · the whole run',
};

/**
 * Which group an action falls in, read off the kind of event it injects --
 * never off its label, so a new entry in the table lands in the right group
 * by injecting the right thing.
 */
export function actionGroup(a: EventAction): ActionGroup {
  if (a.property === true) return 'setting';
  if (isRestore(a)) return 'restore';
  switch (actionKind(a)) {
    case 'host.up': case 'site.up': case 'member.up': case 'instance.up':
    case 'link.heal': case 'observer.start':
      return 'restore';
    case 'cmd.switchover': case 'cmd.failover': case 'cmd.reinstate':
      return 'role';
    case 'cmd.setMasterObserver': case 'cmd.setApplyInstance': case 'cmd.disableFsfo':
      return 'broker';
    default:
      return 'fail';
  }
}

/** The glyph a menu row carries: the timeline's icon for the same event. */
export function actionIcon(a: EventAction): ToolIconName {
  if (a.icon !== undefined) return a.icon;
  const kind = actionKind(a);
  return kind === null ? 'lag' : eventIcon(kind);
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
      ...(a.icon ? { icon: a.icon } : {}),
    });
  }
  return out;
}

/** Events land on a tenth of a second: the axis is read to that, not finer. */
export const snapT = (t: number): number => Math.round(t * 10) / 10;

/**
 * Move the playhead to the end of what there is to see.
 *
 * The default playhead sat at t = 0 after an injection, so the drawing showed
 * the instant before anything had happened while the readout beside it
 * reported the whole run -- two clocks, neither of them named. Landing on
 * `lastInterestingT` (the same reading the axis takes for its horizon) shows
 * the result, and scrubbing back is then the exploration rather than the only
 * way to see anything at all.
 *
 * The injection time is never read from here: an action already carries `at`
 * on every event it will add, decided before this runs.
 */
export function restPlayhead(): void {
  if (mode.value === 'scenario') {
    playing.value = false;
    tNow.value = Math.max(0, ...topology.value.events.map(e => e.at));
    return;
  }
  const t = trace.value;
  if (t === null) { tNow.value = 0; return; }
  const end = lastInterestingT(t, topology.value.events, appLanesShown.value ? topology.value : undefined);
  tNow.value = Math.max(0, snapT(end));
}

export interface RunOptions {
  /**
   * Leave the playhead where the reader put it. The default moves it to the
   * end of the run so the drawing shows the result; Lanes shows the whole run
   * at once and aims its buttons at the playhead, so it must not move under a
   * reader who is composing at t = 10 s.
   */
  keepPlayhead?: boolean;
  /** Scenario composition offers timed actions only. */
  eventsOnly?: boolean;
}

/** Inject an action's events under one undo entry. */
export function runAction(action: EventAction, opts: RunOptions = {}): void {
  if (action.enabled.state === 'off') return;
  /* A property holds from the first frame, so there is no new moment to move
     the playhead to. */
  if (action.property === true) { action.run?.(); return; }
  /* An action on the event list itself -- taking a cut back -- edits the
     list rather than adding to it, and leaves the playhead where it is. */
  if (action.events.length === 0) { action.run?.(); return; }
  healthyRun.value = false;
  edit(action.label, (d) => withEvents(d, [...d.topology.events, ...action.events]));
  if (opts.keepPlayhead !== true) restPlayhead();
}

/* ---------------- the six templates ---------------- */

/** One of the six that inject a failure, so `id` is one of the engine's own scenarios. */
export type FailureTemplate = Template & { id: ClassicScenario };

export interface Template {
  id: ClassicScenario | 'healthy';
  label: string;
  caption: string;
  enabled: WhyState;
  events: TimedEvent[];
}

/**
 * The six scenarios the published workbench carries, as one-click templates.
 *
 * The events come from the engine's own `scenarioEvents`, which is what the
 * 24-cell regression matrix runs on -- so a template here reproduces the
 * outcome the published page draws for the same deployment, rather than an
 * approximation of it.
 */
export function templates(doc: TopologyDoc, at = 0): FailureTemplate[] {
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
  /* The scenario's events kill the first-listed observer's host
     (`scenarioEvents`), which is the master unless the document lists a backup
     first: the caption names the one that actually dies. */
  const killed = doc.observers[0];
  const killedIsMaster = killed !== undefined && killed.role === 'master';

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
      caption: primary && primary.instances.length > 1
        ? 'The host of the primary’s first instance dies outright. The other instances keep running, so the primary stays up.'
        : 'The primary host dies outright. Observer and standby both lose it at the same instant.',
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
      label: doc.observers.length > 1 && !killedIsMaster ? `Kill observer ${killed?.name ?? ''}`.trim() : 'Kill the master observer',
      caption: doc.observers.length > 1
        ? (killedIsMaster
          ? 'The master observer’s host dies. The primary still reaches the standby, so it keeps serving; with both databases still connected, the broker tries to nominate a backup observer as the new master.'
          : `The host of ${killed?.name ?? 'the first-listed observer'}, which is not the master, dies. The master observer keeps running, so fast-start failover stays armed and the primary keeps serving.`)
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
  /* The healthy scenario is the one whose event list is empty: it clears
     whatever was injected and asks for the run of what is left. Every other
     template puts that request away, because its events make the run. */
  healthyRun.value = t.id === 'healthy';
  edit(`Apply the scenario: ${t.label}`, (d) => withEvents(d, t.events));
  restPlayhead();
}

/**
 * The scenario in which nothing fails. It is not one of the failure templates
 * (`templates`): there is no event to inject, the review suite has nothing to
 * compare it against, and the walkthrough never asks for it. The shelf puts it
 * first, and the run it asks for is the engine's own, over no events.
 */
/**
 * What "runs as drawn" means for this document: only what it actually has.
 * A standby with apply stopped, a snapshot standby, a far sync instance, a
 * disabled or observer-less configuration and a document with no application
 * are not described as applying, pinging or serving.
 */
function healthyCaption(doc: TopologyDoc): string {
  const standbys = doc.members.filter(isDatabase).filter((m) => m.role !== 'primary');
  const applying = standbys.filter((m) => m.applyRunning && m.role !== 'snapshot');
  const parts = ['the primary is open read-write and shipping redo'];
  if (applying.length > 0) {
    parts.push(applying.length === standbys.length ? 'the standbys apply it' : 'the standbys with redo apply running apply it');
  }
  if (doc.config.fsfo.state !== 'disabled' && doc.observers.some((o) => o.running)) {
    parts.push('the observer pings');
  }
  if ((doc.applications ?? []).length > 0) parts.push('the application is served');
  const list = parts.length === 1 ? parts[0]
    : parts.length === 2 ? `${parts[0]} and ${parts[1]}`
      : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `Nothing fails. The configuration runs as drawn: ${list}.`;
}

export function healthyScenario(doc: TopologyDoc): Template {
  const primary = doc.members.find((m) => isDatabase(m) && m.role === 'primary');
  return {
    id: 'healthy',
    label: 'Everything is working',
    caption: healthyCaption(doc),
    enabled: primary ? ON : off('No member holds the primary role.'),
    events: [],
  };
}

/** What the scenario shelf offers, in order: the healthy run first, then the six failures. */
export const shelf = (doc: TopologyDoc, at = 0): Template[] => [healthyScenario(doc), ...templates(doc, at)];

export function clearEvents(): void {
  healthyRun.value = false;
  edit('Clear the injected events', (d) => withEvents(d, []));
  /* Nothing is left to be at the end of: the playhead goes back to the start
     rather than resting on a clock reading that no longer means anything. */
  restPlayhead();
}

export function removeEventAt(index: number): void {
  healthyRun.value = false;
  edit('Remove an injected event', (d) => withEvents(
    d, d.topology.events.filter((_, i) => i !== index),
  ));
}

export function setEventTime(index: number, at: number, expected?: TimedEvent): number | null {
  const current = topology.value;
  if (expected && current.events[index] !== expected) return null;
  at = snapEventTime(at);
  const why = eventTimeRefusal(current, index, at);
  if (why) { toast.value = { kind: 'warn', text: why }; return null; }
  if (current.events[index]?.at === at) return index;
  playing.value = false;
  const moved = { ...current.events[index]!, at };
  edit(`Move an injected event to t = ${at} s`, (d) => withEvents(
    d, d.topology.events.map((e, i) => (i === index ? moved : e)),
  ));
  return topology.value.events.indexOf(moved);
}

export function reorderEvent(index: number, direction: -1 | 1): void {
  const current = topology.value;
  const why = reorderRefusal(current, index, direction);
  if (why) { toast.value = { kind: 'warn', text: why }; return; }
  playing.value = false;
  const at = current.events[index]!.at;
  const neighborAt = current.events[index + direction]!.at;
  edit('Reorder injected events', (d) => withEvents(d, d.topology.events.map((e, i) =>
    i === index ? { ...e, at: neighborAt } : i === index + direction ? { ...e, at } : e)));
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
    case 'cmd.reinstate': return `REINSTATE DATABASE ${e.member as string}`;
    case 'cmd.setMasterObserver': return `SET MASTEROBSERVER TO ${e.observer as string}`;
    case 'cmd.setApplyInstance': return `Move apply on ${e.member as string} to ${e.instance}`;
    case 'cmd.disableFsfo':
      return `DISABLE FAST_START FAILOVER${e.force === true ? ' FORCE' : ''}`;
    case 'lag.set': return `Set the lag on ${e.member as string}`;
  }
}
