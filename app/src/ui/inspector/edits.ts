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
  activeRule, applicationClient, applicationId, applicationsOf, CLIENT_TIMING_DEFAULTS, CLIENT_TIMING_TUNED, declaredPrimary, defaultDestProps, expandAll, hostId, isParenthesised, LAG_LIMIT_UNSET_STORED, linkId, memberId, observerId, primarySite,
  findApplication, siteId, withApplication,
} from '@/engine';
import type {
  Application, ClientDescriptor, ClientTiming, DatabaseMember, DestGroup, DestProps, FarSyncMember, Host, Instance, Link, Member, MemberId,
  Observer, RedoRouteRule, RouteDest, Site, TimedEvent, TopologyDoc, XptMode,
} from '@/engine';
import type { HostId, LinkId, ObserverId, SiteId } from '@/engine';
import { doc, withTopology } from '@/state/doc';
import type { Doc } from '@/state/doc';
import { edit } from '@/state/history';
import { select, toast } from '@/state/view';
import type { WhyState } from '../common/WhyPill';
import { off, ON, WHY } from './why';
import { siteForNewFarSync, siteForNewObserver, siteForNewStandby } from '../build/placement';

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

/**
 * One labelled edit of a connect descriptor: the one `appId` dials -- its own,
 * else the document's shared one, which every application without a descriptor
 * of its own dials too -- or the shared one when no application is named.
 */
export function patchClient(
  label: string, fn: (c: ClientDescriptor) => ClientDescriptor, key?: string, appId?: string,
): void {
  const app = appId === undefined ? undefined : findApplication(doc.value.topology, appId);
  const own = app?.client !== undefined;
  mutate(label, (t) => withClientPatched(t, own ? appId : undefined, fn),
    key === undefined ? undefined : own ? `${key}:${appId}` : key);
}

/** The document with one descriptor patched: application `appId`'s own, or the shared one. */
function withClientPatched(
  t: TopologyDoc, appId: string | undefined, fn: (c: ClientDescriptor) => ClientDescriptor,
): TopologyDoc {
  if (appId === undefined) return { ...t, client: fn(t.client) };
  return {
    ...t,
    applications: applicationsOf(t).map((a) => (
      (a.id as string) === appId && a.client !== undefined ? { ...a, client: fn(a.client) } : a)),
  };
}

/**
 * Give an application a connect string of its own (a copy of the shared one,
 * addresses included, to start from), or take it back to the shared one.
 * Going back discards what it had of its own: the shared string is dialled.
 */
export function setOwnClient(appId: string, own: boolean): void {
  const t = doc.value.topology;
  const app = findApplication(t, appId);
  if (app === undefined || (app.client !== undefined) === own) return;
  mutate(
    own ? `Give ${appId} a connect string of its own` : `Have ${appId} use the shared connect string`,
    (cur) => ({
      ...cur,
      applications: applicationsOf(cur).map((a) => {
        if ((a.id as string) !== appId) return a;
        if (!own) {
          const { client: _dropped, ...rest } = a;
          return rest;
        }
        return { ...a, client: { ...cur.client, addresses: cur.client.addresses.map((x) => ({ ...x })) } };
      }),
    }),
  );
}

/** True when the descriptor already carries exactly this timing. */
export const clientHasTiming = (c: ClientDescriptor, p: ClientTiming): boolean =>
  c.transportConnectTimeoutSeconds === p.transportConnectTimeoutSeconds
  && (c.connectTimeoutSeconds ?? null) === p.connectTimeoutSeconds
  && c.retryCount === p.retryCount
  && c.retryDelaySeconds === p.retryDelaySeconds;

/**
 * Set the four connect-string timing parameters to the defaults or to the tuned
 * shape, as one undoable edit. FAILOVER, LOAD_BALANCE, the address list and the
 * dead-host answer are left as they are. Nothing happens when the descriptor
 * already holds the set, so the click leaves no empty step on the undo stack.
 * With `appId`, the descriptor that application dials: its own, else the shared
 * one (which the applications without one of their own all dial).
 */
export function applyClientTiming(which: 'defaults' | 'tuned', appId?: string): void {
  const p = which === 'tuned' ? CLIENT_TIMING_TUNED : CLIENT_TIMING_DEFAULTS;
  const app = appId === undefined ? undefined : findApplication(doc.value.topology, appId);
  const own = app?.client !== undefined;
  const label = which === 'tuned' ? 'Tune the connect string' : 'Set the connect string timing to its defaults';
  mutate(
    app === undefined ? label : `${label} of ${app.name}`,
    (t) => {
      const cur = own ? applicationClient(t, app as Application) : t.client;
      return clientHasTiming(cur, p)
        ? t : withClientPatched(t, own ? appId : undefined, (x) => ({ ...x, ...p }));
    },
  );
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
 * Where a new database belongs when the reader named no place: an empty data
 * centre, else beside the standbys already drawn -- never the observer's data
 * centre while another will do (`build/placement.ts`).
 */
const siteForNewMember = (t: TopologyDoc): SiteId | null => siteForNewStandby(t);

/** The data centre a caller named, when this document actually has it. */
const placeIn = (t: TopologyDoc, where: SiteId | undefined): SiteId | null =>
  (where !== undefined && t.sites.some((s) => s.id === where) ? where : null);

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

/**
 * Add a physical standby on a host of its own, and give the primary a
 * destination to it.
 *
 * `where` is the data centre the reader asked for -- "Add a standby here", on
 * a selected site -- and it wins over the automatic placement, because a
 * reader who names a place and gets another one has been ignored. Omitted, the
 * placement is `siteForNewMember`'s, which is what the palette has always
 * done. A data centre this document does not have is not one to put anything
 * in, so it falls back rather than writing a dangling host.
 */
/**
 * The transport a new standby arrives with: the one broker Table 4-2 gives
 * for the configuration's protection mode -- SYNC for maximum protection and
 * maximum availability, ASYNC for maximum performance. A fixed ASYNC made
 * every standby added to a MAXAVAILABILITY drawing an error the moment it
 * landed, which is the page contradicting itself rather than teaching
 * anything. The reader can still pick another in the rail or the bar.
 */
export function transportForMode(mode: TopologyDoc['config']['protectionMode']): XptMode {
  return mode === 'MAXPERFORMANCE' ? 'ASYNC' : 'SYNC';
}

export function addDatabase(where?: SiteId): MemberId | null {
  const t = doc.value.topology;
  const site = placeIn(t, where) ?? siteForNewMember(t);
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
      dests: {}, redoRoutes: [], logXptMode: transportForMode(cur.config.protectionMode),
      role: 'physical', flashbackOn: false,
      applyLagSeconds: 0, transportLagSeconds: 0,
      applyRunning: true, realTimeApply: true,
      openMode: 'mount', staticServices: false,
    };
    const primary = withH.members.find((m) => m.kind === 'database' && m.role === 'primary');
    /* The primary ships to it: on the default `(LOCAL : ALL)` it already does,
       and a primary with RedoRoutes of its own gets the new standby in its
       active rule -- a standby added to the drawing and reached by nothing is
       the question "why is it not connected?" asked every time. */
    const members = [...withH.members, member].map((m) =>
      (primary && m.id === primary.id
        ? {
          ...m,
          dests: { ...m.dests, [id]: defaultDestProps() },
          redoRoutes: routesWith(m, primary.id, { target: id }),
        }
        : m));
    /* The shared ADDRESS_LIST sees every standby: the new one joins it. An
       application with a connect string of its own keeps the list its owner wrote. */
    const client = {
      ...withH.client,
      addresses: [...withH.client.addresses, { host: hostId(hname), port: withH.hosts.at(-1)?.listenerPort ?? 1521 }],
    };
    return { ...withH, members, client };
  });
  select(id as string);
  return id;
}

/**
 * Where the application goes when no data centre is named: beside the
 * primary, which is where it stands to start with.
 */
export const siteForApplication = (t: TopologyDoc): SiteId | null => primarySite(t);

/**
 * Add one more application, on a host of its own; there is no limit. Its
 * name is the next free `appNN`. It dials the shared connect string until it
 * is given one of its own, and an empty shared ADDRESS_LIST is filled with the
 * primary and every standby database.
 */
export function addApplication(where?: SiteId): string | null {
  const t = doc.value.topology;
  const next = withApplication(t, placeIn(t, where) ?? siteForApplication(t) ?? undefined);
  const name = next.applications?.at(-1)?.id as string | undefined;
  if (name === undefined || next === t) return null;
  mutate(`Add the application ${name}`, (cur) => withApplication(cur, next.hosts.at(-1)?.site, name));
  select(name);
  return name;
}

/** Remove one application and the host it stood on; the shared descriptor, and the others, stay. */
export function removeApplication(id: string): void {
  edit(`Remove the application ${id}`, (d) => {
    const app = findApplication(d.topology, id);
    if (app === undefined) return d;
    const rest = applicationsOf(d.topology).filter((a) => a.id !== app.id);
    const { applications: _all, ...bare } = d.topology;
    let next: TopologyDoc = rest.length > 0 ? { ...bare, applications: rest } : bare;
    if (!hostShared(next, app.host, app.id as string)) next = withoutHost(next, app.host);
    return dropLayout(withTopology(d, next), [app.id as string]);
  });
}

/** Rename one application; nothing else in the document names it. */
export function renameApplication(id: string, raw: string): void {
  const name = raw.trim();
  const t = doc.value.topology;
  const app = findApplication(t, id);
  if (app === undefined || name === '' || name === (app.id as string)) return;
  if (takenIds(t).has(name)) {
    toast.value = { kind: 'warn', text: `${app.id as string} keeps its name: ${WHY.idTaken}` };
    return;
  }
  edit(`Rename the application ${app.id as string} to ${name}`, (d) => {
    const cur = findApplication(d.topology, id);
    if (cur === undefined) return d;
    const next: TopologyDoc = {
      ...d.topology,
      applications: applicationsOf(d.topology).map((a) => (
        a.id === cur.id ? { ...a, id: applicationId(name), name } : a)),
    };
    const moved = d.layout[cur.id as string];
    if (moved === undefined) return withTopology(d, next);
    const layout = { ...d.layout };
    delete layout[cur.id as string];
    layout[name] = moved;
    return { ...withTopology(d, next), layout };
  });
  select(name);
}

/**
 * Put a database on an application's ADDRESS_LIST or take it off: every
 * instance's host, in the order the member lists them, after the addresses
 * already there. It is the descriptor the application dials that changes --
 * its own, else the shared one, and then for everyone who dials that one.
 */
export function setAddressListed(appId: string, id: MemberId, listed: boolean): void {
  const t = doc.value.topology;
  const m = t.members.find((x) => x.id === id);
  const app = findApplication(t, appId);
  if (!m || app === undefined) return;
  const hosts = hostsOf(m);
  const shared = app.client === undefined;
  patchClient(
    `${listed ? 'Add' : 'Remove'} ${id as string} ${listed ? 'to' : 'from'} ${shared ? 'the shared' : `${appId}'s`} ADDRESS_LIST`,
    (c) => {
      const rest = c.addresses.filter((a) => !hosts.includes(a.host));
      if (!listed) return { ...c, addresses: rest };
      const have = new Set(c.addresses.map((a) => a.host));
      return {
        ...c,
        addresses: [
          ...c.addresses,
          ...hosts.filter((h) => !have.has(h)).map((h) => ({
            host: h, port: t.hosts.find((x) => x.id === h)?.listenerPort ?? 1521,
          })),
        ],
      };
    },
    undefined, appId,
  );
}

/** Add a far sync instance: no role, no apply, no open mode. */
export function addFarSync(where?: SiteId): MemberId | null {
  const t = doc.value.topology;
  const site = placeIn(t, where) ?? siteForNewFarSync(t) ?? t.sites.at(-1)?.id ?? null;
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
export function addObserver(where?: SiteId): ObserverId | null {
  const t = doc.value.topology;
  const site = placeIn(t, where) ?? siteForNewObserver(t);
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

/**
 * Every id in this document, in one set.
 *
 * Ids are one namespace here, exactly as they are on the canvas and in the
 * inspector: a member, an observer, a link and a site cannot share a name, or
 * a selection key resolves to two subjects and `remove` takes both.
 */
function takenIds(t: TopologyDoc): Set<string> {
  return new Set<string>([
    ...t.sites.map((s) => s.id as string),
    ...t.hosts.map((h) => h.id as string),
    ...t.members.map((m) => m.id as string),
    ...t.observers.map((o) => o.id as string),
    ...t.links.map((l) => l.id as string),
    ...applicationsOf(t).map((a) => a.id as string),
  ]);
}

/** Add a data centre, and a site link from it to every data centre already there. */
export function addSite(): SiteId | null {
  const t = doc.value.topology;
  /* Sites are named `dc1`, not `dc01`, so `nextName`'s two-digit form is not
     the house style here -- and its zero cannot merely be stripped: beside
     `dc1,dc2,dc3` the free two-digit name is `dc01`, which strips back to the
     taken `dc1`. That minted a duplicate site id on every press, a self-link
     `dc1-dc1`, and a card that could be neither selected nor removed on its
     own. Scan for a name that is free in the whole namespace instead. */
  const taken = takenIds(t);
  /* `dc1..dc(n+1)` is one more name than the namespace holds, so one of them is
     always free -- the loop needs no bail-out and cannot mint a second `dc1`. */
  let name = '';
  for (let i = 1; name === '' && i <= taken.size + 1; i++) {
    if (!taken.has(`dc${i}`)) name = `dc${i}`;
  }
  const id = siteId(name);
  /* The id is `dc4`; the name on the drawing is `DC 4`, the way the presets
     name theirs -- a panel labelled `dc4` beside `DC 1` reads as a typo. */
  const label = `DC ${name.slice(2)}`;
  mutate(`Add the site ${label}`, (cur) => {
    /* `name` is free, so `dcA-<name>` is a new link id in all but one case: a
       document loaded from a share link may already carry a link literally
       named that while having no such site. A second link with the same id
       would be the same defect one level down, so that pair simply keeps the
       link it has. */
    const links: Link[] = cur.sites
      .filter((s) => !cur.links.some((l) => (l.id as string) === `${s.id as string}-${name}`))
      .map((s) => ({
        id: linkId(`${s.id as string}-${name}`),
        scope: 'site' as const,
        ends: [s.id, id] as [SiteId, SiteId],
        rttMs: 0,
        up: true,
      }));
    return {
      ...cur,
      sites: [...cur.sites, { id, name: label } as Site],
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

/**
 * Add an instance to a member -- one more instance is what makes it RAC. The
 * new instance gets a node of its own in the same data centre, and every node
 * of the member joins one cluster: the first host's cluster where it has one,
 * `<member>-crs` where the member was a single instance until now. The name
 * is what the observer-placement rule reads -- an observer is never deployed
 * on the database's cluster either.
 */
export function addInstance(id: MemberId): void {
  mutate(`Add an instance to ${id as string}`, (t) => {
    const m = t.members.find((member) => member.id === id);
    const firstHost = t.hosts.find((h) => h.id === m?.instances[0]?.host);
    if (!m || !firstHost) return t;
    let n = m.instances.length + 1;
    while (m.instances.some((i) => i.name === `${m.name}${n}`)) n++;
    const name = `${m.name}${n}`;
    const hostname = uniqueHost(t, `${firstHost.site as string}-${name}`);
    const next = withHost(t, hostname, firstHost.site);
    const cluster = firstHost.cluster ?? `${m.name}-crs`;
    const nodes = new Set<string>([...m.instances.map((i) => i.host as string), hostname]);
    return {
      ...next,
      hosts: next.hosts.map((h) => (nodes.has(h.id as string) && h.cluster === undefined
        ? { ...h, cluster } : h)),
      members: next.members.map((member) => member.id === id
        ? { ...member, instances: [...member.instances, { name, host: hostId(hostname) }] }
        : member),
    };
  });
}

/** PreferredApplyInstance follows an instance that is renamed, and goes with one removed. */
function followPreferred(m: Member, from: string, to: string | null): Member {
  if (m.kind !== 'database' || m.preferredApplyInstance !== from) return m;
  const { preferredApplyInstance: _drop, ...rest } = m;
  return to === null ? rest : { ...rest, preferredApplyInstance: to };
}

/**
 * ApplyInstances names how many instances run Redo Apply, so it cannot exceed
 * the instances the member has: a smaller cluster takes the count down with it,
 * and a single instance has nothing left to set.
 */
function clampApplyInstances(m: Member): Member {
  if (m.kind !== 'database' || typeof m.applyInstances !== 'number') return m;
  if (m.applyInstances <= m.instances.length) return m;
  const { applyInstances: _drop, ...rest } = m;
  return m.instances.length >= 2 ? { ...rest, applyInstances: m.instances.length } : rest;
}

export function removeInstance(id: MemberId, index: number): void {
  patchMember(id, `Remove an instance from ${id as string}`, (m) => {
    const gone = m.instances[index]?.name;
    const next = clampApplyInstances({ ...m, instances: m.instances.filter((_, i) => i !== index) });
    return gone === undefined ? next : followPreferred(next, gone, null);
  });
}

export function patchInstance(
  id: MemberId, index: number, fn: (i: Instance) => Instance, label: string, key?: string,
): void {
  patchMember(id, label, (m) => {
    const before = m.instances[index];
    const after = before === undefined ? undefined : fn(before);
    const next = {
      ...m,
      instances: m.instances.map((inst, i) => (i === index && after !== undefined ? after : inst)),
    };
    return before !== undefined && after !== undefined && before.name !== after.name
      ? followPreferred(next, before.name, after.name)
      : next;
  }, key);
}

/** A site link between two data centres, when there is not one already. */
export function addLink(a: SiteId, b: SiteId): LinkId | null {
  const t = doc.value.topology;
  /* Both ends have to be data centres this document actually has. The palette
     refuses before it gets here, but a link with a dangling end is in every
     derived computation, the share link and the Export the moment it is
     written, so no caller gets to put one there. */
  if (!t.sites.some((s) => s.id === a) || !t.sites.some((s) => s.id === b)) return null;
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

/** A host and every reference to it: its host links, client addresses (shared and own) and events. */
function withoutHost(t: TopologyDoc, id: HostId): TopologyDoc {
  /* An application stands on a host: without it there is no application. */
  const { applications, ...rest } = t;
  const kept = (applications ?? []).filter((a) => a.host !== id).map((a) => (a.client === undefined
    ? a
    : { ...a, client: { ...a.client, addresses: a.client.addresses.filter((x) => x.host !== id) } }));
  return {
    ...rest,
    ...(kept.length > 0 ? { applications: kept } : {}),
    hosts: t.hosts.filter((h) => h.id !== id),
    links: t.links.filter((l) => !(l.scope === 'host' && (l.ends as [HostId, HostId]).includes(id))),
    client: { ...t.client, addresses: t.client.addresses.filter((a) => a.host !== id) },
    events: t.events.filter((e) => !eventMentionsHost(e, id)),
  };
}

export function removeHost(id: HostId): void {
  mutate(`Remove the host ${id as string}`, (t) => withoutHost(t, id));
}

/** The hosts something stands on: a member instance, an observer or an application. */
export function hostsInUse(t: TopologyDoc): Set<string> {
  const used = new Set<string>();
  for (const m of t.members) for (const i of m.instances) used.add(i.host as string);
  for (const o of t.observers) used.add(o.host as string);
  for (const a of applicationsOf(t)) used.add(a.host as string);
  return used;
}

/** Whether anything stands in a site -- on one of its hosts. A host nothing stands on is not "in use". */
export function siteInUse(t: TopologyDoc, id: SiteId): boolean {
  const used = hostsInUse(t);
  return t.hosts.some((h) => h.site === id && used.has(h.id as string));
}

/**
 * A site goes with the hosts in it: the canvas draws only what stands on a
 * host, so a bare host is invisible and a site that looks empty must be
 * removable. Each host leaves through `withoutHost`, in the same edit.
 */
export function removeSite(id: SiteId): void {
  edit(`Remove the site ${id as string}`, (d) => {
    let t = d.topology;
    for (const h of t.hosts.filter((x) => x.site === id)) t = withoutHost(t, h.id);
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
/**
 * Whether `raw` may be the name of the member, observer or data centre `key`.
 *
 * One answer for the rail's field and for the one on the drawing: the rail
 * says a refusal in a toast after the fact, the drawing says it under the
 * field while it is still open, and both are this sentence. An empty or an
 * unchanged name is not refused -- it is simply not a rename.
 */
export function renameVerdict(t: TopologyDoc, key: string, raw: string): WhyState {
  const name = raw.trim();
  if (name === '' || name === key) return ON;
  if (t.members.some((m) => (m.id as string) === key)) {
    return t.members.some((m) => (m.id as string) === name) ? off(WHY.nameTaken) : ON;
  }
  if (t.observers.some((o) => (o.id as string) === key)) {
    return t.observers.some((o) => (o.id as string) === name) ? off(WHY.observerNameTaken) : ON;
  }
  if (findApplication(t, key) !== undefined) {
    return takenIds(t).has(name) ? off(WHY.idTaken) : ON;
  }
  return ON;
}

/** A data centre's name is a label: its id, and every reference to it, stays. */
export function renameSite(id: SiteId, raw: string): void {
  const name = raw.trim();
  if (name === '') return;
  mutate(`Rename ${id as string}`, (t) => ({
    ...t,
    sites: t.sites.map((s) => (s.id === id ? { ...s, name } : s)),
  }));
}

/**
 * Put hand-placed cards back where the layout draws them: the named ones, or
 * every one when none is named. One edit, so one undo brings them all back.
 */
export function tidyLayout(keys: readonly string[]): void {
  edit(keys.length === 0 ? 'Tidy the drawing' : `Tidy ${keys.join(', ')}`, (d) => {
    const drop = keys.length === 0 ? Object.keys(d.layout) : keys.filter((k) => k in d.layout);
    return drop.length === 0 ? d : dropLayout(d, drop);
  });
}

export function renameMember(id: MemberId, raw: string): void {
  const name = raw.trim();
  const t = doc.value.topology;
  if (name === '' || name === (id as string)) return;
  /* A refusal is said, not swallowed: the field snaps back to the old name,
     and a reader who typed a taken one should hear why. */
  if (t.members.some((m) => (m.id as string) === name)) {
    toast.value = { kind: 'warn', text: `${id as string} keeps its name: ${WHY.nameTaken}` };
    return;
  }
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

/* ---------------- the drawing's own gestures ---------------- */

/** The hosts a member runs on, once each, in instance order. */
const hostsOf = (m: Member): HostId[] => {
  const out: HostId[] = [];
  for (const i of m.instances) if (!out.includes(i.host)) out.push(i.host);
  return out;
};

/** True when anything other than `except` stands on this host. */
function hostShared(t: TopologyDoc, host: HostId, except: string): boolean {
  return t.members.some((m) => (m.id as string) !== except && m.instances.some((i) => i.host === host))
    || t.observers.some((o) => (o.id as string) !== except && o.host === host)
    || applicationsOf(t).some((a) => (a.id as string) !== except && a.host === host);
}

/**
 * Move a member or an observer to another data centre -- the card dragged
 * from one site panel into another.
 *
 * A card lives where its hosts live, so this moves hosts: the mover gets a
 * host of its own in the new place, named the way every host here is named
 * (`<site>-<name>`), with the old host's port and cluster name; the old host
 * goes if nothing else stands on it, taking its host links, client addresses
 * and events with it the way Remove does, and stays put if something else
 * does -- taking a shared host along would silently move the other thing
 * too. Every instance of a RAC member moves together: a cluster does not
 * straddle two data centres. The drag offset is dropped at the same time, so
 * the card lands where the new column puts it rather than floating over the
 * old one.
 *
 * One undo: the drag that carried the card there coalesces into this entry
 * under the same key, so "Undo" puts the card back where it was picked up.
 */
export function moveToSite(key: string, site: SiteId): void {
  const t = doc.value.topology;
  const target = t.sites.find((s) => s.id === site);
  if (!target) return;
  const member = t.members.find((m) => (m.id as string) === key);
  const observer = member ? undefined : t.observers.find((o) => (o.id as string) === key);
  const app = !member && !observer ? findApplication(t, key) : undefined;
  if (!member && !observer && !app) return;
  const siteOf = (h: HostId): SiteId | undefined => t.hosts.find((x) => x.id === h)?.site;
  const hosts = member ? hostsOf(member) : observer ? [observer.host] : app ? [app.host] : [];
  if (hosts.length === 0 || hosts.every((h) => siteOf(h) === site)) return;
  const name = member ? member.name : observer?.name ?? app?.name ?? key;

  edit(`Move ${key} to ${target.name}`, (d) => {
    let cur = d.topology;
    const remap = new Map<HostId, HostId>();
    for (const h of hosts) {
      if (siteOf(h) === site) continue;
      const old = cur.hosts.find((x) => x.id === h);
      const hname = uniqueHost(cur, `${site as string}-${name}`);
      cur = withHost(cur, hname, site);
      if (old !== undefined) {
        cur = {
          ...cur,
          hosts: cur.hosts.map((x) => (x.id === hostId(hname)
            ? { ...x, listenerPort: old.listenerPort, ...(old.cluster === undefined ? {} : { cluster: old.cluster }) }
            : x)),
        };
      }
      remap.set(h, hostId(hname));
    }
    const moved = (h: HostId): HostId => remap.get(h) ?? h;
    cur = {
      ...cur,
      members: cur.members.map((m) => (m.id === member?.id
        ? { ...m, instances: m.instances.map((i) => ({ ...i, host: moved(i.host) })) }
        : m)),
      observers: cur.observers.map((o) => (o.id === observer?.id ? { ...o, host: moved(o.host) } : o)),
      ...(app !== undefined && cur.applications !== undefined
        ? {
          applications: cur.applications.map((a) => (a.id === app.id ? { ...a, host: moved(a.host) } : a)),
        }
        : {}),
      /* An address follows the database it names to its new host, so a
         standby moved to another data centre stays on the ADDRESS_LIST --
         the shared one, and every application's own. */
      client: {
        ...cur.client,
        addresses: cur.client.addresses.map((a) => ({ ...a, host: moved(a.host) })),
      },
    };
    if (cur.applications?.some((a) => a.client !== undefined)) {
      cur = {
        ...cur,
        applications: cur.applications.map((a) => (a.client === undefined
          ? a
          : { ...a, client: { ...a.client, addresses: a.client.addresses.map((x) => ({ ...x, host: moved(x.host) })) } })),
      };
    }
    /* The hosts left behind, when nothing else stands on them. */
    for (const h of remap.keys()) {
      if (hostShared(cur, h, key)) continue;
      cur = withoutHost(cur, h);
    }
    return dropLayout(withTopology(d, cur), [key]);
  }, `drag:${key}`);
}

/**
 * Merge a member or an observer into another host's chassis stack -- the
 * card dropped on another host's card, or on the stack standing on it.
 *
 * Unlike `moveToSite`, the mover takes the *existing* host rather than a new
 * one of its own: taking the same host is what folds it into that host's
 * stack, and (a host belonging to one site) is what carries it cross-site
 * too, replacing `moveToSite`'s new-host behaviour for this one drop. A RAC
 * member has more than one host and no single one the drop could mean, so
 * it is left alone -- the canvas only offers this drop for a single-instance
 * card, but this checks again rather than trust it. The old host goes if
 * nothing else stands on it, the same as `moveToSite`; the drag's own offset
 * is dropped so the card snaps into the new stack rather than floating over
 * it.
 *
 * One undo: coalesced under the same `drag:${key}` the drag itself writes
 * under, so the drag and the merge undo as the one gesture they were.
 */
export function mergeIntoHost(key: string, targetHost: HostId): void {
  const t = doc.value.topology;
  const target = t.hosts.find((h) => h.id === targetHost);
  if (!target) return;
  const member = t.members.find((m) => (m.id as string) === key);
  const observer = member ? undefined : t.observers.find((o) => (o.id as string) === key);
  if (!member && !observer) return;
  if (member && member.instances.length !== 1) return;
  const oldHost = member ? member.instances[0]?.host : observer?.host;
  if (oldHost === undefined || oldHost === targetHost) return;

  edit(`Move ${key} onto ${target.name}`, (d) => {
    let cur = d.topology;
    cur = {
      ...cur,
      members: cur.members.map((m) => (m.id === member?.id
        ? { ...m, instances: m.instances.map((i) => ({ ...i, host: targetHost })) }
        : m)),
      observers: cur.observers.map((o) => (o.id === observer?.id ? { ...o, host: targetHost } : o)),
    };
    if (!hostShared(cur, oldHost as HostId, key)) cur = withoutHost(cur, oldHost as HostId);
    return dropLayout(withTopology(d, cur), [key]);
  }, `drag:${key}`);
}

/**
 * One member's RedoRoutes with `dest` added: to the rule active for
 * `primary` when there is one, as a new rule otherwise -- `(LOCAL : to)` at
 * the primary, `(ANY : to)` anywhere else, the cascading form that survives
 * a role change. Unchanged when the active rule already names the target or
 * ALL. Pure, so both the palette and the drawn line can use it.
 */
function routesWith(m: Member, primary: MemberId, dest: RouteDest): RedoRouteRule[] {
  const act = activeRule(m, primary);
  const names = (g: DestGroup): boolean =>
    g.dests.some((dd) => dd.target === 'ALL' || dd.target === dest.target);
  if (act && act.rule.groups.some(names)) return m.redoRoutes;
  if (act && m.redoRoutes.length > 0) {
    /* Joined to the first unparenthesised entry, so that it ships: added to a
       parenthesised group it would only stand by, since a group has one
       active redo path. */
    return m.redoRoutes.map((r, i) => {
      if (i !== act.index) return r;
      const open = r.groups.findIndex((g) => !isParenthesised(g));
      return {
        ...r,
        groups: open < 0
          ? [...r.groups, { dests: [dest] }]
          : r.groups.map((g, gi) => (gi !== open ? g : { ...g, dests: [...g.dests, dest] })),
      };
    });
  }
  const source: RedoRouteRule['source'] = m.id === primary ? 'LOCAL' : 'ANY';
  return [...m.redoRoutes, { source, groups: [{ dests: [dest] }] }];
}

/**
 * Ship redo from one member to another -- a line drawn from a card to a card.
 *
 * It edits RedoRoutes, because that is what decides who ships to whom: the
 * rule active for the current primary gets the target added to its first
 * group, and a member with no active rule gets one -- `(LOCAL : to)` at the
 * primary, `(ANY : to)` anywhere else, which is the cascading form that
 * survives a role change. A primary on the default `(LOCAL : ALL)` already
 * ships to every member, so that drag is a sentence rather than an edit. The
 * destination's own properties are minted at their defaults so the
 * inspector's destination table has a row to show.
 */
export function shipRedo(from: MemberId, to: MemberId): void {
  const t = doc.value.topology;
  const sender = t.members.find((m) => m.id === from);
  const receiver = t.members.find((m) => m.id === to);
  if (!sender || !receiver || from === to) return;
  const primary = t.members.find((m) => m.kind === 'database' && m.role === 'primary');
  if (!primary) return;
  if (receiver.kind === 'database' && receiver.role === 'primary') {
    toast.value = { kind: 'warn', text: `${to as string} is the primary: redo starts there, nothing ships to it.` };
    return;
  }
  if (receiver.kind === 'database' && receiver.role === 'snapshot') {
    toast.value = { kind: 'warn', text: `${to as string} is a snapshot standby: it receives redo but applies none until it is converted back.` };
  }
  /* A cascaded destination names ASYNC: the attribute has to be explicit for
     real-time cascading (ROUTES.CASCADE_RT_ASYNC), and every cascaded leg in
     Oracle's worked examples is written that way -- `(North_Sales :
     South_Sales ASYNC)` on a far sync. Falling back to the receiver's
     LogXptMode stopped being harmless once a new standby arrives as SYNC in
     maximum availability (`transportForMode`). */
  const dest: RouteDest = sender.id === primary.id
    ? { target: to }
    : { target: to, xpt: 'ASYNC' };
  const routes = routesWith(sender, primary.id, dest);
  if (routes === sender.redoRoutes) {
    toast.value = {
      kind: 'info',
      text: sender.redoRoutes.length === 0
        ? `${from as string} already ships to ${to as string}: its RedoRoutes are the default (LOCAL : ALL).`
        : `${from as string} already ships to ${to as string}.`,
    };
    return;
  }
  patchMember(from, `Ship redo from ${from as string} to ${to as string}`, (m) => ({
    ...m,
    redoRoutes: routes,
    dests: to in m.dests ? m.dests : { ...m.dests, [to]: defaultDestProps() },
  }));
}

/**
 * `from`'s RedoRoutes with `to` taken out of what it ships to now, or `null`
 * when that cannot be written.
 *
 * The mirror of `routesWith`. The rule active for the declared primary loses
 * every mention of `to`: a named destination, an alternate standing behind
 * one, and `ALL`, which is expanded into the members it names today minus
 * `to` (keeping the attributes written on it). A group left empty goes, and a
 * rule left without groups goes -- after which the next rule active for the
 * primary is asked the same question, since it may name `to` as well. A NULL
 * property is `(LOCAL : ALL)` at a database and is expanded the same way; if
 * nothing would be left, the answer is `null`: an empty RedoRoutes is that
 * default again, which ships to `to`. Pure over the document.
 */
export function routesWithout(t: TopologyDoc, from: MemberId, to: MemberId): RedoRouteRule[] | null {
  const sender = t.members.find((m) => m.id === from);
  const primary = declaredPrimary(t);
  if (!sender || primary === null) return null;
  const everyone = expandAll(t, from, primary);
  const names = (r: RedoRouteRule): boolean => r.groups.some((g) => g.dests.some((d) =>
    d.target === to || d.alt?.target === to || (d.target === 'ALL' && everyone.includes(to))));
  const strip = (r: RedoRouteRule): RedoRouteRule | null => {
    const groups = r.groups
      .map((g) => {
        const dests: RouteDest[] = [];
        const add = (d: RouteDest): void => {
          if (!dests.some((x) => x.target === d.target)) dests.push(d);
        };
        for (const d of g.dests) {
          if (d.target === to) continue;
          if (d.target === 'ALL') {
            if (!everyone.includes(to)) { add(d); continue; }
            const { alt: _alt, ...attrs } = d;
            for (const id of everyone) if (id !== to) add({ ...attrs, target: id });
            continue;
          }
          if (d.alt?.target === to) {
            const { alt: _gone, ...rest } = d;
            add(rest);
            continue;
          }
          add(d);
        }
        return { ...g, dests };
      })
      .filter((g) => g.dests.length > 0);
    return groups.length === 0 ? null : { ...r, groups };
  };
  let m: Member = sender;
  /* Each round removes one rule's worth; a rule can only be removed once. */
  for (let round = 0; round <= sender.redoRoutes.length + 1; round++) {
    const act = activeRule(m, primary);
    if (!act || !names(act.rule)) return round === 0 ? null : m.redoRoutes;
    const onDefault = m.redoRoutes.length === 0 && !m.routesObserved;
    const rules = onDefault ? [act.rule] : m.redoRoutes;
    const kept = strip(act.rule);
    if (kept === null && onDefault) return null;
    m = { ...m, redoRoutes: rules.flatMap((r, i) => (i !== act.index ? [r] : kept === null ? [] : [kept])) };
    /* Emptied by this round: NULL again, which at a primary database ships to `to`. */
    if (m.redoRoutes.length === 0 && m.kind === 'database' && !m.routesObserved) {
      const back = activeRule(m, primary);
      if (back && names(back.rule)) return null;
    }
  }
  return m.redoRoutes;
}

/**
 * Stop shipping redo from one member to another -- Remove on a redo line.
 * One undo; the destination's own properties go with it, the way `shipRedo`
 * mints them.
 */
export function removeRedoRoute(from: MemberId, to: MemberId): void {
  const routes = routesWithout(doc.value.topology, from, to);
  if (routes === null) {
    toast.value = { kind: 'warn', text: `${from as string} keeps shipping to ${to as string}: ${WHY.onlyRedoDest}` };
    return;
  }
  patchMember(from, `Stop shipping redo from ${from as string} to ${to as string}`, (m) => {
    const dests = { ...m.dests };
    delete dests[to];
    return { ...m, redoRoutes: routes, dests };
  });
}

/** Take a member out of an explicit FastStartFailoverTarget list. */
export function removeFsfoTarget(id: MemberId): void {
  const target = doc.value.topology.config.fsfo.target;
  if (target.kind !== 'list' || !target.members.includes(id)) return;
  patchFsfo(`Remove ${id as string} from FastStartFailoverTarget`, (f) => ({
    ...f, target: { kind: 'list', members: target.members.filter((m) => m !== id) },
  }));
}

/**
 * What a line drawn from `from` to `to` would do, and whether it may.
 *
 * One table for the three meanings a drawn line has -- redo between members,
 * a failover target between a member and an observer, a new standby in a
 * data centre -- so the label under the pointer while the line is being
 * drawn, the refusal on the card it hovers, and the edit the drop runs are
 * the same sentence. `to` is a card key or a site id. Pure over the document.
 */
export function connectVerdict(
  t: TopologyDoc, from: string, to: string,
): { label: string; enabled: WhyState } {
  const member = (k: string): Member | undefined => t.members.find((m) => (m.id as string) === k);
  const observer = (k: string): Observer | undefined => t.observers.find((o) => (o.id as string) === k);
  const site = (k: string): Site | undefined => t.sites.find((x) => (x.id as string) === k);
  const a = member(from); const b = member(to);
  const primary = t.members.find((m) => m.kind === 'database' && m.role === 'primary');
  /* The application and a database, in either direction: an address. */
  const fromApp = findApplication(t, from);
  const toApp = findApplication(t, to);
  const app = fromApp ?? toApp;
  if (app !== undefined) {
    const m = fromApp !== undefined ? b : a;
    if (!m) return { label: 'Connect', enabled: off('An application connects to databases: draw the line to one.') };
    const label = `List ${m.id as string} in ${app.id as string}'s ADDRESS_LIST`;
    if (m.kind === 'farsync') return { label, enabled: off(WHY.farSyncNotAddress) };
    const addresses = applicationClient(t, app).addresses;
    const listed = m.instances.some((i) => addresses.some((x) => x.host === i.host));
    return { label, enabled: listed ? off(`${m.id as string} is on ${app.id as string}'s ADDRESS_LIST already.`) : ON };
  }
  if (a && b) {
    if (b.kind === 'database' && b.role === 'primary') {
      return { label: `Ship redo to ${to}`, enabled: off(`${to} is the primary: redo starts there, nothing ships to it.`) };
    }
    if (primary && routesWith(a, primary.id, { target: b.id }) === a.redoRoutes) {
      return {
        label: `Ship redo to ${to}`,
        enabled: off(a.redoRoutes.length === 0
          ? `${from} already ships to ${to}: its RedoRoutes are the default (LOCAL : ALL).`
          : `${from} already ships to ${to}.`),
      };
    }
    return { label: `Ship redo to ${to}`, enabled: ON };
  }
  const targetOf = (m: Member): { label: string; enabled: WhyState } => {
    const label = `Make ${m.id as string} a fast-start failover target`;
    if (m.kind === 'farsync') return { label, enabled: off(WHY.farSyncNotTarget) };
    if (m.role === 'snapshot') return { label, enabled: off(WHY.snapshotNotTarget) };
    if (m.role === 'primary') return { label, enabled: off(WHY.primaryNotTarget) };
    const target = t.config.fsfo.target;
    if (target.kind === 'ANY') return { label, enabled: off(`FastStartFailoverTarget is ANY, which already includes ${m.id as string}.`) };
    if (target.members.includes(m.id)) return { label, enabled: off(`${m.id as string} is a fast-start failover target already.`) };
    return { label, enabled: ON };
  };
  if (a && observer(to)) return targetOf(a);
  if (observer(from) && b) return targetOf(b);
  if (observer(from) && observer(to)) {
    return { label: 'Connect the observers', enabled: off('Two observers have no link between them: each watches the primary and the failover target.') };
  }
  const s = site(to);
  const sa = site(from);
  if (sa && s) {
    const label = `Link ${sa.name} and ${s.name}`;
    if (sa.id === s.id) return { label, enabled: off('A link runs between two different data centres.') };
    const linked = t.links.some((l) => l.scope === 'site'
      && (l.ends as readonly string[]).includes(from) && (l.ends as readonly string[]).includes(to));
    return { label, enabled: linked ? off('These two data centres are linked already.') : ON };
  }
  if (s && a) {
    return { label: `Add a standby in ${s.name} and ship redo to it`, enabled: ON };
  }
  if (s && observer(from)) {
    return { label: `Connect to ${s.name}`, enabled: off('An observer watches databases, not data centres: drag the card there to move it.') };
  }
  return { label: 'Connect', enabled: off('Nothing to connect here.') };
}

/**
 * Name a standby as a fast-start failover target -- a line drawn between a
 * card and an observer, in either direction. Far sync instances, snapshot
 * standbys and the primary are refused in the words the configuration form
 * uses; a target already named is a sentence, not an edit.
 */
export function addFsfoTarget(id: MemberId): void {
  const t = doc.value.topology;
  const m = t.members.find((x) => x.id === id);
  if (!m) return;
  const refuse = (why: string): void => { toast.value = { kind: 'warn', text: `${id as string} is not made a target: ${why}` }; };
  if (m.kind === 'farsync') { refuse(WHY.farSyncNotTarget); return; }
  if (m.role === 'snapshot') { refuse(WHY.snapshotNotTarget); return; }
  if (m.role === 'primary') { refuse(WHY.primaryNotTarget); return; }
  const target = t.config.fsfo.target;
  if (target.kind === 'ANY') {
    toast.value = { kind: 'info', text: `FastStartFailoverTarget is ANY, which already includes ${id as string}.` };
    return;
  }
  if (target.members.includes(id)) {
    toast.value = { kind: 'info', text: `${id as string} is a fast-start failover target already.` };
    return;
  }
  patchFsfo(`Add ${id as string} to FastStartFailoverTarget`, (f) => ({
    ...f, target: { kind: 'list', members: [...target.members, id] },
  }));
}

export function setLogXptMode(id: MemberId, xpt: XptMode): void {
  patchMember(id, `Set LogXptMode to ${xpt} on ${id as string}`, (m) => ({ ...m, logXptMode: xpt }));
}

/* ---------------- the named settings ----------------
 *
 * The properties the inspector's forms and the timeline's
 * chips, grips and popovers both edit. The undo sentence and the coalesce key are written once, here, so
 * a value typed in the rail and the same value dragged on the timeline are one
 * kind of edit -- and a burst of either folds into one undo step. */

type Config = TopologyDoc['config'];

export function setProtectionMode(v: Config['protectionMode']): void {
  patchConfig(`Set the protection mode to ${v}`, (x) => ({ ...x, protectionMode: v }));
}

export function setFsfoState(v: Config['fsfo']['state']): void {
  patchFsfo(`Set fast-start failover to ${v}`, (x) => ({ ...x, state: v }));
}

export function setFsfoThreshold(v: number): void {
  patchFsfo(
    `Set FastStartFailoverThreshold to ${v} s`, (x) => ({ ...x, thresholdSeconds: v }), 'fsfo:threshold',
  );
}

/** Setting the limit also marks it as set: until then the edition's broker default is what applies. */
export function setFsfoLagLimit(v: number): void {
  patchFsfo(
    `Set FastStartFailoverLagLimit to ${v} s`,
    (x) => ({ ...x, lagLimitSeconds: v, lagLimitSet: true }), 'fsfo:laglimit',
  );
}

/**
 * Back to "not set": the edition's broker default for the mode applies again,
 * 30 s in maximum performance and, under 26ai, 0 in maximum availability. Typing
 * the default in does not do this -- that sets the property to the same number.
 */
export function unsetFsfoLagLimit(): void {
  patchFsfo(
    'Leave FastStartFailoverLagLimit at the broker default',
    (x) => {
      const { lagLimitSet: _drop, ...rest } = x;
      return { ...rest, lagLimitSeconds: LAG_LIMIT_UNSET_STORED };
    },
    'fsfo:laglimit',
  );
}

export function setRoleTransition(v: number): void {
  patchEnvironment(
    `Set the role transition to ${v} s`, (e) => ({ ...e, roleTransitionSeconds: v }), 'env:role',
  );
}

/** A standby's apply lag; the transport lag stays at or under it, because redo cannot be applied before it arrives. */
export function setApplyLag(id: MemberId, v: number): void {
  patchDatabase(
    id, `Set the apply lag on ${id as string}`,
    (m) => ({ ...m, applyLagSeconds: v, transportLagSeconds: Math.min(m.transportLagSeconds, v) }),
    `alag:${id as string}`,
  );
}

/** Rename an observer, carrying the events that name it along. */
export function renameObserver(id: ObserverId, raw: string): void {
  const name = raw.trim();
  const t = doc.value.topology;
  if (name === '' || name === (id as string)) return;
  if (t.observers.some((o) => (o.id as string) === name)) {
    toast.value = { kind: 'warn', text: `${id as string} keeps its name: ${WHY.observerNameTaken}` };
    return;
  }
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
