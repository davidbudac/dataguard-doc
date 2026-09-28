/**
 * Document builders for the presets.
 *
 * Nothing here is engine machinery: every helper writes the same plain JSON a
 * user would produce in the editor, so a preset is a document like any other.
 * The helpers exist so that twelve presets do not repeat twelve copies of the
 * same site/host/link boilerplate.
 */

import {
  defaultClient, defaultConfiguration, defaultDestProps, defaultEnvironment,
  hostId, linkId, memberId, observerId, siteId,
} from '../engine';
import type {
  DatabaseMember, DbRole, DestGroup, DestProps, Edition, EnvironmentParams, FarSyncMember,
  FsfoConfig, Host, Link, Member, MemberId, Observer, ProtectionMode, RedoRouteRule,
  RouteAlternate, RouteDest, RoutePriority, ServiceDef, Site, TimedEvent, TopologyDoc, XptMode,
} from '../engine';

/* ---------------- sites, hosts, links ---------------- */

export const site = (id: string, name?: string): Site => ({
  id: siteId(id),
  name: name ?? id.toUpperCase(),
});

export interface HostOpts {
  /** Set on RAC nodes. An observer may never run on a database server or cluster. */
  cluster?: string;
  port?: number;
}

export function host(id: string, inSite: string, opts: HostOpts = {}): Host {
  const h: Host = {
    id: hostId(id), name: id, site: siteId(inSite), listenerPort: opts.port ?? 1521,
  };
  if (opts.cluster !== undefined) h.cluster = opts.cluster;
  return h;
}

/** A site-scope link: it expands to every host pair across the two sites. */
export const siteLink = (a: string, b: string, rttMs: number): Link => ({
  id: linkId(`${a}-${b}`), scope: 'site', ends: [siteId(a), siteId(b)], rttMs, up: true,
});

/** A host-scope link, for two hosts inside one site that can be cut separately. */
export const hostLink = (a: string, b: string, rttMs: number): Link => ({
  id: linkId(`${a}-${b}`), scope: 'host', ends: [hostId(a), hostId(b)], rttMs, up: true,
});

/* ---------------- members ---------------- */

export interface DbOpts extends Partial<Omit<DatabaseMember, 'id' | 'kind' | 'instances' | 'role'>> {
  hosts?: string[];
}

/**
 * A database member. One host is a single instance, more than one is RAC; a
 * standby starts mounted with redo apply running, which is what the broker
 * leaves behind after a `CREATE CONFIGURATION`.
 */
export function database(
  id: string, hosts: string[], role: DbRole, over: DbOpts = {},
): DatabaseMember {
  const standby = role !== 'primary';
  const { hosts: _ignored, ...rest } = over;
  return {
    id: memberId(id),
    kind: 'database',
    name: id,
    instances: hosts.map((h, i) => ({
      name: hosts.length > 1 ? `${id}${i + 1}` : id, host: hostId(h),
    })),
    connectIdentifier: id,
    enabled: true,
    dests: {},
    redoRoutes: [],
    logXptMode: 'ASYNC',
    role,
    flashbackOn: true,
    applyLagSeconds: 0,
    transportLagSeconds: 0,
    applyRunning: standby && role !== 'snapshot',
    realTimeApply: standby && role !== 'snapshot',
    openMode: role === 'primary' ? 'read-write' : role === 'snapshot' ? 'read-write' : 'mount',
    staticServices: true,
    ...rest,
  };
}

/** A far sync instance: no role, no apply lag, no open mode, no broker state. */
export function farSync(
  id: string, onHost: string, over: Partial<Omit<FarSyncMember, 'id' | 'kind'>> = {},
): FarSyncMember {
  return {
    id: memberId(id),
    kind: 'farsync',
    name: id,
    instances: [{ name: id, host: hostId(onHost) }],
    connectIdentifier: id,
    enabled: true,
    dests: {},
    redoRoutes: [],
    logXptMode: 'SYNC',
    transportLagSeconds: 0,
    ...over,
  };
}

export function observer(
  id: string, onHost: string, role: 'master' | 'backup' = 'master',
): Observer {
  return {
    id: observerId(id),
    name: id,
    host: hostId(onHost),
    role,
    /* START OBSERVER ... FILE IS -- never FILE=. */
    fileIs: `/u01/app/oracle/dg/${id}.dat`,
    logfileIs: `/u01/app/oracle/dg/${id}.log`,
    running: true,
  };
}

/** Give `from` a destination entry for `to` (NetTimeout, ReopenSecs, MaxFailure). */
export function dest(from: Member, to: MemberId, over: Partial<DestProps> = {}): void {
  from.dests[to] = { ...defaultDestProps(), ...over };
}

/* ---------------- RedoRoutes ---------------- */

export function to(target: string, xpt?: XptMode, alt?: RouteAlternate): RouteDest {
  const d: RouteDest = { target: memberId(target) };
  if (xpt) d.xpt = xpt;
  if (alt) d.alt = alt;
  return d;
}

export function alternate(target: string, xpt?: XptMode, fallback = true): RouteAlternate {
  const a: RouteAlternate = { target: memberId(target) };
  if (xpt) a.xpt = xpt;
  a.fallback = fallback;
  return a;
}

/** A parenthesised destination group with an explicit PRIORITY=n, n = 1..8. */
export const group = (priority: RoutePriority, ...dests: RouteDest[]): DestGroup => ({
  priority, dests, explicitGroup: true,
});

/** `(LOCAL : ...)` -- active while this member is the primary. */
export const local = (...dests: RouteDest[]): RedoRouteRule => ({
  source: 'LOCAL', groups: [{ dests }],
});

/** `(LOCAL : (a PRIORITY=1), (b PRIORITY=2))`. */
export const localGroups = (...groups: DestGroup[]): RedoRouteRule => ({
  source: 'LOCAL', groups,
});

/** `(source : ...)` -- active while `source` is the primary. */
export const when = (source: string | string[], ...dests: RouteDest[]): RedoRouteRule => ({
  source: (Array.isArray(source) ? source : [source]).map(memberId),
  groups: [{ dests }],
});

export const whenGroups = (source: string | string[], ...groups: DestGroup[]): RedoRouteRule => ({
  source: (Array.isArray(source) ? source : [source]).map(memberId),
  groups,
});

/* ---------------- the document ---------------- */

export interface TopologySpec {
  name: string;
  edition?: Edition;
  mode?: ProtectionMode;
  sites: string[];
  hosts: Host[];
  /** [siteA, siteB, round-trip ms] per site link. */
  links: [string, string, number][];
  hostLinks?: [string, string, number][];
  members: Member[];
  observers?: Observer[];
  fsfo?: Partial<FsfoConfig>;
  /** FastStartFailoverTarget, in the order the property lists them. */
  targets?: string[];
  /** Hosts the client's ADDRESS_LIST names; defaults to every database host. */
  clientHosts?: string[];
  serviceName?: string;
  environment?: Partial<EnvironmentParams>;
  events?: TimedEvent[];
}

export function topology(spec: TopologySpec): TopologyDoc {
  const edition = spec.edition ?? '19c';
  const config = defaultConfiguration(edition);
  config.name = spec.name;
  config.protectionMode = spec.mode ?? 'MAXAVAILABILITY';

  const targets = (spec.targets ?? []).map(memberId);
  config.fsfo = {
    ...config.fsfo,
    state: targets.length > 0 ? 'enabled' : 'disabled',
    target: { kind: 'list', members: targets },
    ...spec.fsfo,
  };

  const serviceName = spec.serviceName ?? 'app_svc';
  const dbMembers = spec.members.filter((m): m is DatabaseMember => m.kind === 'database');
  const service: ServiceDef = {
    name: serviceName, role: 'PRIMARY', members: dbMembers.map((m) => m.id),
  };
  config.services = [service];

  const client = defaultClient();
  client.serviceName = serviceName;
  const clientHosts = spec.clientHosts
    ?? dbMembers.filter((m) => m.role === 'primary' || targets.includes(m.id))
      .flatMap((m) => m.instances.map((i) => i.host as string));
  client.addresses = clientHosts.map((h) => {
    const found = spec.hosts.find((x) => (x.id as string) === h);
    return { host: hostId(h), port: found?.listenerPort ?? 1521 };
  });

  const links: Link[] = spec.links.map(([a, b, rtt]) => siteLink(a, b, rtt));
  for (const [a, b, rtt] of spec.hostLinks ?? []) links.push(hostLink(a, b, rtt));

  return {
    app: 'dg-topology',
    schema: 2,
    label: spec.name,
    sites: spec.sites.map((s) => site(s)),
    hosts: spec.hosts,
    links,
    members: spec.members,
    observers: spec.observers ?? [],
    config,
    client,
    environment: { ...defaultEnvironment(), ...spec.environment },
    events: spec.events ?? [],
  };
}

/* ---------------- events ---------------- */

export const hostDown = (at: number, h: string): TimedEvent =>
  ({ at, kind: 'host.down', host: hostId(h) });
export const hostUp = (at: number, h: string): TimedEvent =>
  ({ at, kind: 'host.up', host: hostId(h) });
export const siteDown = (at: number, s: string): TimedEvent =>
  ({ at, kind: 'site.down', site: siteId(s) });
export const linkCut = (at: number, a: string, b: string): TimedEvent =>
  ({ at, kind: 'link.cut', link: linkId(`${a}-${b}`) });
export const instanceDown = (at: number, m: string, instance: string): TimedEvent =>
  ({ at, kind: 'instance.down', member: memberId(m), instance });
export const switchoverTo = (at: number, m: string): TimedEvent =>
  ({ at, kind: 'cmd.switchover', to: memberId(m) });
export const failoverTo = (at: number, m: string): TimedEvent =>
  ({ at, kind: 'cmd.failover', to: memberId(m) });
export const observerStop = (at: number, o: string): TimedEvent =>
  ({ at, kind: 'observer.stop', observer: observerId(o) });
