/**
 * Every change the inspector makes to the Document, in one place.
 *
 * Two rules hold throughout. First, an edit is a pure function of the
 * Document: it is handed to `edit()` with the sentence the undo menu will
 * show, so "Undo: set LogXptMode to FASTSYNC on stby01" is what the reader
 * gets rather than "Undo". Second, a removal takes its references with it --
 * a member that is deleted is also gone from every `dests` map, every
 * RedoRoutes rule, `FastStartFailoverTarget`, `PrimaryDatabaseCandidates`,
 * the services, the injected events and the drag overrides -- so the document
 * that comes out the other side is one the engine can still parse.
 */

import {
  defaultDestProps, hostId, linkId, memberId, observerId, siteId,
} from '@/engine';
import type {
  DatabaseMember, DestProps, FarSyncMember, Host, Instance, Link, Member, MemberId, Observer,
  RedoRouteRule, Site, TimedEvent, TopologyDoc, XptMode,
} from '@/engine';
import type { HostId, LinkId, ObserverId, SiteId } from '@/engine';
import { doc, withTopology } from '@/state/doc';
import type { Doc } from '@/state/doc';
import { edit } from '@/state/history';
import { select } from '@/state/view';

/* ---------------- the two primitives ---------------- */

/** One labelled edit of the topology. `key` coalesces a gesture into one undo. */
export function mutate(
  label: string, fn: (t: TopologyDoc) => TopologyDoc, key?: string,
): void {
  edit(label, (d) => {
    const next = fn(d.topology);
    return next === d.topology ? d : withTopology(d, next);
  }, key);
}

/** One labelled edit of a single member. */
export function patchMember(
  id: MemberId, label: string, fn: (m: Member) => Member, key?: string,
): void {
  mutate(label, (t) => ({
    ...t,
    members: t.members.map((m) => (m.id === id ? fn(m) : m)),
  }), key);
}

export function patchDatabase(
  id: MemberId, label: string, fn: (m: DatabaseMember) => DatabaseMember, key?: string,
): void {
  patchMember(id, label, (m) => (m.kind === 'database' ? fn(m) : m), key);
}

export function patchObserver(
  id: ObserverId, label: string, fn: (o: Observer) => Observer, key?: string,
): void {
  mutate(label, (t) => ({
    ...t,
    observers: t.observers.map((o) => (o.id === id ? fn(o) : o)),
  }), key);
}

export function patchLink(
  id: LinkId, label: string, fn: (l: Link) => Link, key?: string,
): void {
  mutate(label, (t) => ({
    ...t,
    links: t.links.map((l) => (l.id === id ? fn(l) : l)),
  }), key);
}

export function patchConfig(
  label: string, fn: (c: TopologyDoc['config']) => TopologyDoc['config'], key?: string,
): void {
  mutate(label, (t) => ({ ...t, config: fn(t.config) }), key);
}

export function patchFsfo(
  label: string, fn: (f: TopologyDoc['config']['fsfo']) => TopologyDoc['config']['fsfo'],
  key?: string,
): void {
  patchConfig(label, (c) => ({ ...c, fsfo: fn(c.fsfo) }), key);
}

export function patchEnvironment(
  label: string, fn: (e: TopologyDoc['environment']) => TopologyDoc['environment'], key?: string,
): void {
  mutate(label, (t) => ({ ...t, environment: fn(t.environment) }), key);
}

/** Destination properties as they stand, defaults included, never undefined. */
export const destPropsOf = (m: Member, to: MemberId): DestProps =>
  m.dests[to] ?? defaultDestProps();

export function patchDest(
  from: MemberId, to: MemberId, label: string, fn: (d: DestProps) => DestProps, key?: string,
): void {
  patchMember(from, label, (m) => ({
    ...m,
    dests: { ...m.dests, [to]: fn(destPropsOf(m, to)) },
  }), key);
}

/* ---------------- names ---------------- */

/** `sby01`, `sby02`, ... -- the first two-digit name the configuration is free of. */
export function nextName(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; i < 100; i++) {
    const name = `${prefix}${String(i).padStart(2, '0')}`;
    if (!used.has(name)) return name;
  }
  return `${prefix}${Date.now()}`;
}

const memberNames = (t: TopologyDoc): string[] => t.members.map((m) => m.id as string);
const hostNames = (t: TopologyDoc): string[] => t.hosts.map((h) => h.id as string);

/* ---------------- adding ---------------- */

/**
 * Where a new database belongs: a data centre that has no database in it yet
 * -- so a second database lands opposite the first, which is the deployment
 * anyone drawing Data Guard means -- and the last site otherwise.
 */
function siteForNewMember(t: TopologyDoc): SiteId | null {
  const siteOf = new Map<string, string>();
  for (const h of t.hosts) siteOf.set(h.id as string, h.site as string);
  const occupied = new Set<string>();
  for (const m of t.members) {
    for (const i of m.instances) {
      const s = siteOf.get(i.host as string);
      if (s) occupied.add(s);
    }
  }
  const free = t.sites.find((s) => !occupied.has(s.id as string));
  return free?.id ?? t.sites.at(-1)?.id ?? null;
}

/** `dc2-sby01`, or `dc2-sby01-2` where that name is taken. */
function uniqueHost(t: TopologyDoc, base: string): string {
  const taken = new Set(hostNames(t));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}

function withHost(t: TopologyDoc, name: string, site: SiteId): TopologyDoc {
  const host: Host = {
    id: hostId(name), name, site,
    listenerPort: t.hosts[0]?.listenerPort ?? 1521,
  };
  return { ...t, hosts: [...t.hosts, host] };
}

/** Add a physical standby on a host of its own, and give the primary a destination to it. */
export function addDatabase(): MemberId | null {
  const t = doc.value.topology;
  const site = siteForNewMember(t);
  if (site === null) return null;
  const name = nextName('sby', memberNames(t));
  const hname = uniqueHost(t, `${site as string}-${name}`);
  const id = memberId(name);
  mutate(`Add the standby ${name}`, (cur) => {
    const withH = withHost(cur, hname, site);
    const member: DatabaseMember = {
      id, kind: 'database', name,
      instances: [{ name, host: hostId(hname) }],
      connectIdentifier: name, enabled: true,
      dests: {}, redoRoutes: [], logXptMode: 'ASYNC',
      role: 'physical', flashbackOn: false,
      applyLagSeconds: 0, transportLagSeconds: 0,
      applyRunning: true, realTimeApply: true,
      openMode: 'mount', staticServices: false,
    };
    const primary = withH.members.find((m) => m.kind === 'database' && m.role === 'primary');
    const members = [...withH.members, member].map((m) =>
      (primary && m.id === primary.id
        ? { ...m, dests: { ...m.dests, [id]: defaultDestProps() } }
        : m));
    return { ...withH, members };
  });
  select(id as string);
  return id;
}

/** Add a far sync instance: no role, no apply, no open mode. */
export function addFarSync(): MemberId | null {
  const t = doc.value.topology;
  const site = siteForNewMember(t) ?? t.sites.at(-1)?.id ?? null;
  if (site === null) return null;
  const name = nextName('fs', memberNames(t));
  const hname = uniqueHost(t, `${site as string}-${name}`);
  const id = memberId(name);
  mutate(`Add the far sync instance ${name}`, (cur) => {
    const withH = withHost(cur, hname, site);
    const member: FarSyncMember = {
      id, kind: 'farsync', name,
      instances: [{ name, host: hostId(hname) }],
      connectIdentifier: name, enabled: true,
      dests: {}, redoRoutes: [], logXptMode: 'SYNC',
      transportLagSeconds: 0,
    };
    return { ...withH, members: [...withH.members, member] };
  });
  select(id as string);
  return id;
}

/**
 * Add an observer on a host of its own. Oracle's rule is that an observer is
 * never deployed on a database server or cluster, so this never reuses one.
 */
export function addObserver(): ObserverId | null {
  const t = doc.value.topology;
  const dbSites = new Set<string>();
  const siteOf = new Map<string, string>();
  for (const h of t.hosts) siteOf.set(h.id as string, h.site as string);
  for (const m of t.members) {
    for (const i of m.instances) {
      const s = siteOf.get(i.host as string);
      if (s) dbSites.add(s);
    }
  }
  const site = t.sites.find((s) => !dbSites.has(s.id as string))?.id ?? t.sites.at(-1)?.id ?? null;
  if (site === null) return null;
  const name = nextName('obs', t.observers.map((o) => o.id as string));
  const id = observerId(name);
  const hasMaster = t.observers.some((o) => o.role === 'master');
  mutate(`Add the observer ${name}`, (cur) => {
    const hname = nextName(`${site as string}-obs`, hostNames(cur));
    const withH = withHost(cur, hname, site);
    const observer: Observer = {
      id, name, host: hostId(hname),
      role: hasMaster ? 'backup' : 'master', running: true,
    };
    return { ...withH, observers: [...withH.observers, observer] };
  });
  select(id as string);
  return id;
}

/** Add a data centre, and a site link from it to every data centre already there. */
export function addSite(): SiteId | null {
  const t = doc.value.topology;
  const name = nextName('dc', t.sites.map((s) => s.id as string)).replace(/^dc0/, 'dc');
  const id = siteId(name);
  mutate(`Add the site ${name}`, (cur) => {
    const links: Link[] = cur.sites.map((s) => ({
      id: linkId(`${s.id as string}-${name}`),
      scope: 'site' as const,
      ends: [s.id, id] as [SiteId, SiteId],
      rttMs: 0,
      up: true,
    }));
    return {
      ...cur,
      sites: [...cur.sites, { id, name } as Site],
      links: [...cur.links, ...links],
    };
  });
  select(id as string);
  return id;
}

export function addHost(site: SiteId): HostId | null {
  const t = doc.value.topology;
  const name = nextName(`${site as string}-h`, hostNames(t));
  mutate(`Add the host ${name}`, (cur) => withHost(cur, name, site));
  return hostId(name);
}

/** Add an instance to a member -- one more instance is what makes it RAC. */
export function addInstance(id: MemberId): void {
  patchMember(id, `Add an instance to ${id as string}`, (m) => {
    const n = m.instances.length + 1;
    const name = `${m.name}${n}`;
    const host = m.instances[0]?.host ?? hostId('');
    const inst: Instance = { name, host };
    return { ...m, instances: [...m.instances, inst] };
  });
}

export function removeInstance(id: MemberId, index: number): void {
  patchMember(id, `Remove an instance from ${id as string}`, (m) => ({
    ...m,
    instances: m.instances.filter((_, i) => i !== index),
  }));
}

export function patchInstance(
  id: MemberId, index: number, fn: (i: Instance) => Instance, label: string, key?: string,
): void {
  patchMember(id, label, (m) => ({
    ...m,
    instances: m.instances.map((inst, i) => (i === index ? fn(inst) : inst)),
  }), key);
}

/** A site link between two data centres, when there is not one already. */
export function addLink(a: SiteId, b: SiteId): LinkId | null {
  const t = doc.value.topology;
  const exists = t.links.some((l) => l.scope === 'site'
    && (l.ends as [SiteId, SiteId]).includes(a) && (l.ends as [SiteId, SiteId]).includes(b));
  if (exists || a === b) return null;
  const id = linkId(`${a as string}-${b as string}`);
  mutate(`Add the link ${a as string} to ${b as string}`, (cur) => ({
    ...cur,
    links: [...cur.links, { id, scope: 'site', ends: [a, b] as [SiteId, SiteId], rttMs: 0, up: true }],
  }));
  select(id as string);
  return id;
}

/* ---------------- removing ---------------- */

const dropLayout = (d: Doc, ids: readonly string[]): Doc => {
  if (!ids.some((id) => id in d.layout)) return d;
  const layout = { ...d.layout };
  for (const id of ids) delete layout[id];
  return { ...d, layout };
};

/** Strip one member out of every rule that names it; a rule left empty goes. */
function pruneRoutes(rules: readonly RedoRouteRule[], gone: MemberId): RedoRouteRule[] {
  const out: RedoRouteRule[] = [];
  for (const r of rules) {
    const source = Array.isArray(r.source) ? r.source.filter((s) => s !== gone) : r.source;
    if (Array.isArray(source) && source.length === 0) continue;
    const groups = r.groups
      .map((g) => ({
        ...g,
        dests: g.dests
          .filter((dst) => dst.target !== gone)
          .map((dst) => (dst.alt && dst.alt.target === gone ? { ...dst, alt: undefined } : dst)),
      }))
      .filter((g) => g.dests.length > 0);
    if (groups.length === 0) continue;
    out.push({ ...r, source, groups });
  }
  return out;
}

const eventMentionsMember = (e: TimedEvent, id: MemberId): boolean =>
  ('member' in e && e.member === id) || ('to' in e && e.to === id);

const eventMentionsHost = (e: TimedEvent, id: HostId): boolean =>
  ('host' in e && e.host === id)
  || (e.kind === 'partition' && e.groups.some((g) => g.includes(id)));

export function removeMember(id: MemberId): void {
  edit(`Remove ${id as string}`, (d) => {
    const t = d.topology;
    const members = t.members
      .filter((m) => m.id !== id)
      .map((m) => {
        const dests = { ...m.dests };
        delete dests[id];
        return { ...m, dests, redoRoutes: pruneRoutes(m.redoRoutes, id) };
      });
    const fsfoTarget = t.config.fsfo.target;
    const target = fsfoTarget.kind === 'list'
      ? { kind: 'list' as const, members: fsfoTarget.members.filter((m) => m !== id) }
      : fsfoTarget;
    const config = {
      ...t.config,
      fsfo: { ...t.config.fsfo, target },
      services: t.config.services.map((s) => ({ ...s, members: s.members.filter((m) => m !== id) })),
      ...(t.config.primaryDatabaseCandidates
        ? { primaryDatabaseCandidates: t.config.primaryDatabaseCandidates.filter((m) => m !== id) }
        : {}),
    };
    const next: TopologyDoc = {
      ...t, members, config,
      events: t.events.filter((e) => !eventMentionsMember(e, id)),
    };
    return dropLayout(withTopology(d, next), [id as string]);
  });
}

export function removeObserver(id: ObserverId): void {
  edit(`Remove the observer ${id as string}`, (d) => {
    const t = d.topology;
    const observers = t.observers.filter((o) => o.id !== id);
    /* The master is not optional while observers are deployed: the oldest
       remaining one takes the role, the way SET MASTEROBSERVER would. */
    const hasMaster = observers.some((o) => o.role === 'master');
    const promoted = !hasMaster && observers.length > 0
      ? observers.map((o, i) => (i === 0 ? { ...o, role: 'master' as const } : o))
      : observers;
    const next: TopologyDoc = {
      ...t,
      observers: promoted,
      events: t.events.filter((e) => !('observer' in e && e.observer === id)),
    };
    return dropLayout(withTopology(d, next), [id as string]);
  });
}

export function removeHost(id: HostId): void {
  mutate(`Remove the host ${id as string}`, (t) => ({
    ...t,
    hosts: t.hosts.filter((h) => h.id !== id),
    links: t.links.filter((l) => !(l.scope === 'host' && (l.ends as [HostId, HostId]).includes(id))),
    client: { ...t.client, addresses: t.client.addresses.filter((a) => a.host !== id) },
    events: t.events.filter((e) => !eventMentionsHost(e, id)),
  }));
}

export function removeSite(id: SiteId): void {
  edit(`Remove the site ${id as string}`, (d) => {
    const t = d.topology;
    const next: TopologyDoc = {
      ...t,
      sites: t.sites.filter((s) => s.id !== id),
      links: t.links.filter((l) => !(l.scope === 'site' && (l.ends as [SiteId, SiteId]).includes(id))),
      events: t.events.filter((e) => !('site' in e && e.site === id)),
    };
    return dropLayout(withTopology(d, next), [id as string]);
  });
}

export function removeLink(id: LinkId): void {
  mutate(`Remove the link ${id as string}`, (t) => ({
    ...t,
    links: t.links.filter((l) => l.id !== id),
    events: t.events.filter((e) => !('link' in e && e.link === id)),
  }));
}

/* ---------------- identity and roles ---------------- */

/**
 * A member's db_unique_name is its identity: renaming it rewrites every
 * reference in the document in the same edit, so the configuration is never
 * momentarily inconsistent.
 */
export function renameMember(id: MemberId, raw: string): void {
  const name = raw.trim();
  const t = doc.value.topology;
  if (name === '' || name === (id as string)) return;
  if (t.members.some((m) => (m.id as string) === name)) return;
  const to = memberId(name);
  const swap = (m: MemberId): MemberId => (m === id ? to : m);
  edit(`Rename ${id as string} to ${name}`, (d) => {
    const cur = d.topology;
    const members = cur.members.map((m) => {
      const dests: Record<string, DestProps> = {};
      for (const [k, v] of Object.entries(m.dests)) dests[k === (id as string) ? name : k] = v;
      const redoRoutes = m.redoRoutes.map((r) => ({
        ...r,
        source: Array.isArray(r.source) ? r.source.map(swap) : r.source,
        groups: r.groups.map((g) => ({
          ...g,
          dests: g.dests.map((dst) => ({
            ...dst,
            target: dst.target === 'ALL' ? 'ALL' as const : swap(dst.target),
            ...(dst.alt ? { alt: { ...dst.alt, target: swap(dst.alt.target) } } : {}),
          })),
        })),
      }));
      const base = { ...m, dests: dests as Member['dests'], redoRoutes };
      return m.id === id ? { ...base, id: to, name } : base;
    });
    const fsfo = cur.config.fsfo;
    const config = {
      ...cur.config,
      fsfo: {
        ...fsfo,
        target: fsfo.target.kind === 'list'
          ? { kind: 'list' as const, members: fsfo.target.members.map(swap) }
          : fsfo.target,
      },
      services: cur.config.services.map((s) => ({ ...s, members: s.members.map(swap) })),
      ...(cur.config.primaryDatabaseCandidates
        ? { primaryDatabaseCandidates: cur.config.primaryDatabaseCandidates.map(swap) }
        : {}),
    };
    const events = cur.events.map((e) => {
      if ('member' in e && e.member === id) return { ...e, member: to };
      if ('to' in e && e.to === id) return { ...e, to };
      return e;
    });
    const next: TopologyDoc = { ...cur, members, config, events };
    const moved = d.layout[id as string];
    const layout = moved === undefined
      ? d.layout
      : (() => {
          const l = { ...d.layout };
          delete l[id as string];
          l[name] = moved;
          return l;
        })();
    return { ...withTopology(d, next), layout };
  });
  select(name);
}

/**
 * A configuration has exactly one primary, so giving the role to a database
 * takes it from the one that holds it -- in one edit, because a document with
 * two primaries or none is not a configuration the engine can resolve.
 */
export function setPrimary(id: MemberId): void {
  mutate(`Make ${id as string} the primary`, (t) => ({
    ...t,
    members: t.members.map((m) => {
      if (m.kind !== 'database') return m;
      if (m.id === id) return { ...m, role: 'primary', openMode: 'read-write', applyRunning: false };
      if (m.role === 'primary') return { ...m, role: 'physical', openMode: 'mount', applyRunning: true };
      return m;
    }),
  }));
}

/** Rewrite one member's RedoRoutes property. */
export function setRedoRoutes(id: MemberId, rules: readonly RedoRouteRule[], label: string): void {
  patchMember(id, label, (m) => ({ ...m, redoRoutes: [...rules] }));
}

export function setLogXptMode(id: MemberId, xpt: XptMode): void {
  patchMember(id, `Set LogXptMode to ${xpt} on ${id as string}`, (m) => ({ ...m, logXptMode: xpt }));
}

/** Rename an observer, carrying the events that name it along. */
export function renameObserver(id: ObserverId, raw: string): void {
  const name = raw.trim();
  const t = doc.value.topology;
  if (name === '' || name === (id as string)) return;
  if (t.observers.some((o) => (o.id as string) === name)) return;
  const to = observerId(name);
  edit(`Rename the observer ${id as string} to ${name}`, (d) => {
    const cur = d.topology;
    const next: TopologyDoc = {
      ...cur,
      observers: cur.observers.map((o) => (o.id === id ? { ...o, id: to, name } : o)),
      events: cur.events.map((e) => ('observer' in e && e.observer === id ? { ...e, observer: to } : e)),
    };
    const moved = d.layout[id as string];
    const layout = moved === undefined ? d.layout : { ...d.layout, [name]: moved };
    if (moved !== undefined) delete layout[id as string];
    return { ...withTopology(d, next), layout };
  });
  select(name);
}

/**
 * Exactly one master, the way `SET MASTEROBSERVER TO` leaves it. Only the
 * master coordinates fast-start failover; with fast-start failover disabled
 * every observer has the same functionality, which is why the drawing only
 * chips the master while it is enabled.
 */
export function setMasterObserver(id: ObserverId): void {
  mutate(`Make ${id as string} the master observer`, (t) => ({
    ...t,
    observers: t.observers.map((o) => ({ ...o, role: o.id === id ? 'master' : 'backup' })),
  }));
}
