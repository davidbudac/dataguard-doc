/**
 * Reachability as a graph problem -- engine design SS1.2.
 *
 * Hosts are the nodes. Two hosts in the same site are mutually reachable
 * unless a host-scope link between them is explicitly down; a site link
 * expands to every host pair across the two sites. `reachable(a, b)` is then a
 * union-find over the up edges among the up hosts, which replaces the six
 * hand-written booleans the published simulator carried.
 */

import type { HostId, LinkId, MemberId, SiteId } from '../ids';
import type { Instance, Member, TopologyDoc } from '../types/topology';
import type { NetStateSummary } from '../types/trace';

export interface NetState {
  downHosts: ReadonlySet<HostId>;
  downSites: ReadonlySet<SiteId>;
  downLinks: ReadonlySet<LinkId>;
  /**
   * An explicit partition: an edge survives only between hosts in the same
   * group. Hosts named in no group share one implicit extra group, so a
   * partition of two named halves does not silently strand a third host.
   */
  partitions: HostId[][] | null;
  /** Members taken down without their host going down. */
  downMembers: ReadonlySet<MemberId>;
  /**
   * RAC instances stopped without their host going down, keyed by
   * `instanceKey`. The host, its listener and anything else on it stay up.
   */
  downInstances: ReadonlySet<string>;
}

/** `prm01/prm011`: an instance name is unique only inside its member. */
export const instanceKey = (member: MemberId | string, instance: string): string =>
  `${member as string}/${instance}`;

export function emptyNetState(): NetState {
  return {
    downHosts: new Set(),
    downSites: new Set(),
    downLinks: new Set(),
    partitions: null,
    downMembers: new Set(),
    downInstances: new Set(),
  };
}

/** The state a document starts in: links carry their own `up` flag. */
export function initialNetState(doc: TopologyDoc): NetState {
  const downLinks = new Set<LinkId>();
  for (const l of doc.links) if (!l.up) downLinks.add(l.id);
  return { ...emptyNetState(), downLinks };
}

export function netSummary(net: NetState): NetStateSummary {
  return {
    downHosts: [...net.downHosts].sort(),
    downSites: [...net.downSites].sort(),
    downLinks: [...net.downLinks].sort(),
    partitioned: net.partitions !== null,
    downInstances: [...net.downInstances].sort(),
    ...(net.partitions !== null ? { groups: net.partitions.map((g) => [...g]) } : {}),
  };
}

/** The network an epoch recorded, as the state reachability is asked of. */
export function netFromSummary(s: NetStateSummary): NetState {
  return {
    downHosts: new Set(s.downHosts),
    downSites: new Set(s.downSites),
    downLinks: new Set(s.downLinks),
    partitions: s.groups ? s.groups.map((g) => [...g]) : null,
    downMembers: new Set(),
    downInstances: new Set(s.downInstances),
  };
}

/* ---------------- host liveness ---------------- */

/** A host is down when it is down itself or its whole site is. */
export function hostUp(doc: TopologyDoc, net: NetState, host: HostId): boolean {
  if (net.downHosts.has(host)) return false;
  const h = doc.hosts.find((x) => x.id === host);
  if (!h) return false;
  return !net.downSites.has(h.site);
}

export const upHosts = (doc: TopologyDoc, net: NetState): HostId[] =>
  doc.hosts.filter((h) => hostUp(doc, net, h.id)).map((h) => h.id);

/* ---------------- edges ---------------- */

const groupIndex = (partitions: HostId[][] | null, host: HostId): number => {
  if (!partitions) return 0;
  for (let i = 0; i < partitions.length; i++) {
    const g = partitions[i];
    if (g && g.includes(host)) return i;
  }
  return partitions.length; // the implicit group of everything unnamed
};

/**
 * Every host pair that can exchange packets right now, before the partition
 * filter. Intra-site adjacency is implicit; cross-site adjacency exists only
 * through a link.
 */
export function expandLinks(doc: TopologyDoc, net: NetState): Array<[HostId, HostId]> {
  const live = upHosts(doc, net);
  const liveSet = new Set<HostId>(live);
  const siteOf = new Map<HostId, SiteId>();
  for (const h of doc.hosts) siteOf.set(h.id, h.site);

  /* Host-scope links that are down cut that one pair, nothing else. */
  const cutPairs = new Set<string>();
  for (const l of doc.links) {
    if (l.scope !== 'host' || !net.downLinks.has(l.id)) continue;
    const [a, b] = l.ends as [HostId, HostId];
    cutPairs.add(pairKey(a, b));
  }

  const edges: Array<[HostId, HostId]> = [];
  const seen = new Set<string>();
  const add = (a: HostId, b: HostId): void => {
    if (a === b) return;
    const k = pairKey(a, b);
    if (seen.has(k)) return;
    seen.add(k);
    edges.push([a, b]);
  };

  /* Implicit intra-site mesh. */
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i] as HostId;
      const b = live[j] as HostId;
      if (siteOf.get(a) !== siteOf.get(b)) continue;
      if (cutPairs.has(pairKey(a, b))) continue;
      add(a, b);
    }
  }

  /* Declared links. */
  for (const l of doc.links) {
    if (net.downLinks.has(l.id)) continue;
    if (l.scope === 'host') {
      const [a, b] = l.ends as [HostId, HostId];
      if (liveSet.has(a) && liveSet.has(b)) add(a, b);
      continue;
    }
    const [sa, sb] = l.ends as [SiteId, SiteId];
    const ha = live.filter((h) => siteOf.get(h) === sa);
    const hb = live.filter((h) => siteOf.get(h) === sb);
    for (const a of ha) for (const b of hb) add(a, b);
  }

  if (!net.partitions) return edges;
  return edges.filter(
    ([a, b]) => groupIndex(net.partitions, a) === groupIndex(net.partitions, b),
  );
}

const pairKey = (a: HostId, b: HostId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ---------------- union-find ---------------- */

export interface ReachabilityOptions {
  /**
   * Whether a host forwards traffic on behalf of others.
   *
   * Default false, and deliberately so: databases, far sync instances and
   * observers are not routers, and a site link is a point-to-point circuit.
   * A severed DC1-to-DC2 link therefore stays severed even though both sites
   * still reach a third site -- which is exactly what the verified placement
   * matrix asserts, and what makes a partition arbitrable from the third site
   * rather than invisible. Hosts inside one site are still mutually reachable,
   * because that is a LAN, not a transit path.
   *
   * Set true to read the graph as its full transitive closure instead.
   */
  transit?: boolean;
}

export interface Reachability {
  /** Connected component under the full closure; null when the host is down. */
  component(host: HostId): number | null;
  reachable(a: HostId, b: HostId): boolean;
  /** Every up host this host can reach, sorted. */
  peers(host: HostId): HostId[];
}

export function buildReachability(
  doc: TopologyDoc, net: NetState, opts: ReachabilityOptions = {},
): Reachability {
  const live = upHosts(doc, net);
  const index = new Map<HostId, number>();
  live.forEach((h, i) => index.set(h, i));
  const parent = live.map((_, i) => i);

  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    let c = i;
    while (parent[c] !== c) {
      const next = parent[c] as number;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (i: number, j: number): void => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  const adjacency = new Map<HostId, Set<HostId>>();
  for (const h of live) adjacency.set(h, new Set());
  for (const [a, b] of expandLinks(doc, net)) {
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined || ib === undefined) continue;
    union(ia, ib);
  }
  const transit = opts.transit === true;

  const component = (host: HostId): number | null => {
    const i = index.get(host);
    return i === undefined ? null : find(i);
  };

  const up = (h: HostId): boolean => index.has(h);

  return {
    component,
    reachable(a, b) {
      if (!up(a) || !up(b)) return false;
      if (a === b) return true;
      if (transit) return component(a) === component(b);
      return adjacency.get(a)?.has(b) === true;
    },
    peers(host) {
      if (!up(host)) return [];
      if (transit) {
        const c = component(host);
        return live.filter((h) => component(h) === c).sort();
      }
      return [...(adjacency.get(host) ?? [])].sort();
    },
  };
}

/** One-shot convenience; build a Reachability when asking repeatedly. */
export function reachable(
  doc: TopologyDoc, net: NetState, a: HostId, b: HostId,
  opts: ReachabilityOptions = {},
): boolean {
  return buildReachability(doc, net, opts).reachable(a, b);
}

/* ---------------- members ---------------- */

/**
 * RAC: a member is reachable if any instance is running on a host that is up
 * and reachable. Some instances gone is degraded, not down -- "the primary
 * database remains available as long as at least one instance of the
 * clustered database continues to transport redo data to the standby
 * databases" -- and which instance ships which redo thread is out of scope.
 */
export function liveInstances(
  doc: TopologyDoc, net: NetState, m: Member,
): Instance[] {
  if (net.downMembers.has(m.id)) return [];
  return m.instances.filter(
    (i) => !net.downInstances.has(instanceKey(m.id, i.name)) && hostUp(doc, net, i.host),
  );
}

/**
 * Every instance not running at a recorded epoch, as `member/instance`: one
 * stopped on its own, or one on a host or in a site that is down. What the
 * SHOW DATABASE mock and anything else reading a frame calls "not running".
 */
export function stoppedInstances(doc: TopologyDoc, net: NetStateSummary): string[] {
  const out: string[] = [];
  for (const m of doc.members) {
    for (const i of m.instances) {
      const key = instanceKey(m.id, i.name);
      const site = doc.hosts.find((h) => h.id === i.host)?.site;
      if (net.downInstances.includes(key) || net.downHosts.includes(i.host)
        || (site !== undefined && net.downSites.includes(site))) out.push(key);
    }
  }
  return out;
}

export function liveInstanceHosts(
  doc: TopologyDoc, net: NetState, m: Member,
): HostId[] {
  return liveInstances(doc, net, m).map((i) => i.host);
}

export function memberAlive(doc: TopologyDoc, net: NetState, m: Member): boolean {
  return liveInstanceHosts(doc, net, m).length > 0;
}

/** Degraded: alive, but not every instance is. */
export function memberDegraded(doc: TopologyDoc, net: NetState, m: Member): boolean {
  const live = liveInstanceHosts(doc, net, m).length;
  return live > 0 && live < m.instances.length;
}

export function memberReachableFromHost(
  doc: TopologyDoc, net: NetState, m: Member, from: HostId, r?: Reachability,
): boolean {
  const reach = r ?? buildReachability(doc, net);
  return liveInstanceHosts(doc, net, m).some((h) => reach.reachable(from, h));
}

export function membersReachable(
  doc: TopologyDoc, net: NetState, a: Member, b: Member, r?: Reachability,
): boolean {
  const reach = r ?? buildReachability(doc, net);
  const ha = liveInstanceHosts(doc, net, a);
  const hb = liveInstanceHosts(doc, net, b);
  return ha.some((x) => hb.some((y) => reach.reachable(x, y)));
}

/* ---------------- applying events ---------------- */

/** Fold one topology event into a new NetState; never mutates its input. */
export function applyNetEvent(
  net: NetState,
  e:
    | { kind: 'host.down'; host: HostId } | { kind: 'host.up'; host: HostId }
    | { kind: 'site.down'; site: SiteId } | { kind: 'site.up'; site: SiteId }
    | { kind: 'link.cut'; link: LinkId } | { kind: 'link.heal'; link: LinkId }
    | { kind: 'partition'; groups: HostId[][] }
    | { kind: 'member.down'; member: MemberId } | { kind: 'member.up'; member: MemberId }
    | { kind: 'instance.down'; member: MemberId; instance: string }
    | { kind: 'instance.up'; member: MemberId; instance: string },
): NetState {
  const next: NetState = {
    downHosts: new Set(net.downHosts),
    downSites: new Set(net.downSites),
    downLinks: new Set(net.downLinks),
    partitions: net.partitions,
    downMembers: new Set(net.downMembers),
    downInstances: new Set(net.downInstances),
  };
  switch (e.kind) {
    case 'host.down': (next.downHosts as Set<HostId>).add(e.host); break;
    case 'host.up': (next.downHosts as Set<HostId>).delete(e.host); break;
    case 'site.down': (next.downSites as Set<SiteId>).add(e.site); break;
    case 'site.up': (next.downSites as Set<SiteId>).delete(e.site); break;
    case 'link.cut': (next.downLinks as Set<LinkId>).add(e.link); break;
    case 'link.heal': (next.downLinks as Set<LinkId>).delete(e.link); break;
    case 'partition': next.partitions = e.groups.map((g) => [...g]); break;
    case 'member.down': (next.downMembers as Set<MemberId>).add(e.member); break;
    case 'member.up': (next.downMembers as Set<MemberId>).delete(e.member); break;
    case 'instance.down': (next.downInstances as Set<string>).add(instanceKey(e.member, e.instance)); break;
    case 'instance.up': (next.downInstances as Set<string>).delete(instanceKey(e.member, e.instance)); break;
  }
  return next;
}

/** Round-trip latency between two hosts along the link that joins them. */
export function linkRttMs(doc: TopologyDoc, a: HostId, b: HostId): number {
  const ha = doc.hosts.find((h) => h.id === a);
  const hb = doc.hosts.find((h) => h.id === b);
  if (!ha || !hb) return 0;
  if (ha.site === hb.site) {
    const direct = doc.links.find(
      (l) => l.scope === 'host' && samePair(l.ends as [HostId, HostId], a, b),
    );
    return direct ? direct.rttMs : 0;
  }
  const direct = doc.links.find(
    (l) => l.scope === 'host' && samePair(l.ends as [HostId, HostId], a, b),
  );
  if (direct) return direct.rttMs;
  const site = doc.links.find(
    (l) => l.scope === 'site' && samePair(l.ends as [SiteId, SiteId], ha.site, hb.site),
  );
  return site ? site.rttMs : 0;
}

const samePair = <T>(ends: [T, T], a: T, b: T): boolean =>
  (ends[0] === a && ends[1] === b) || (ends[0] === b && ends[1] === a);
