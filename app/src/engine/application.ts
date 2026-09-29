/**
 * An application's card, as a document gets it.
 *
 * Pure, like everything beside it: a document in, a document out. A document
 * holds any number of applications, each on a host of its own in the data
 * centre it was added to -- the primary's, to start with; the reader moves it
 * from there -- and an empty shared ADDRESS_LIST is filled with the primary and
 * every standby database, so the connect string still finds the service once
 * the role has moved. A new application dials the shared descriptor until it
 * is given one of its own.
 */

import { applicationId, hostId } from './ids';
import type { SiteId } from './ids';
import type { DatabaseMember, Host, TopologyDoc } from './types/topology';
import { applicationsOf } from './types/topology';

const free = (taken: ReadonlySet<string>, base: string): string => {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-x`;
};

/** The data centre the primary's first instance runs in, else the first one. */
export function primarySite(doc: TopologyDoc): SiteId | null {
  const primary = doc.members.find((m) => m.kind === 'database' && m.role === 'primary');
  const host = doc.hosts.find((h) => h.id === primary?.instances[0]?.host);
  return host?.site ?? doc.sites[0]?.id ?? null;
}

/** `app01`, `app02`, ... -- the first two-digit name nothing in `taken` already has. */
export function nextApplicationName(taken: ReadonlySet<string>): string {
  for (let i = 1; i < 100; i++) {
    const name = `app${String(i).padStart(2, '0')}`;
    if (!taken.has(name)) return name;
  }
  return free(taken, 'app');
}

/**
 * The document with one more application on it, on a host of its own; the
 * document is returned unchanged when there is no data centre to stand it in.
 * Names are unique: without `name` the next free `appNN`, and a `name` that is
 * taken gets a suffix.
 */
export function withApplication(doc: TopologyDoc, where?: SiteId, name?: string): TopologyDoc {
  const site = where !== undefined && doc.sites.some((s) => s.id === where) ? where : primarySite(doc);
  if (site === null) return doc;
  const ids = new Set<string>([
    ...doc.sites.map((s) => s.id as string), ...doc.members.map((m) => m.id as string),
    ...doc.observers.map((o) => o.id as string), ...doc.links.map((l) => l.id as string),
    ...applicationsOf(doc).map((a) => a.id as string),
  ]);
  const id = name === undefined ? nextApplicationName(ids) : free(ids, name);
  const hname = free(new Set(doc.hosts.map((h) => h.id as string)), `${site as string}-${id}`);
  const host: Host = {
    id: hostId(hname), name: hname, site,
    listenerPort: doc.hosts[0]?.listenerPort ?? 1521,
  };
  const dbs = doc.members.filter((m): m is DatabaseMember => m.kind === 'database');
  const addresses = doc.client.addresses.length > 0
    ? doc.client.addresses
    : [...dbs.filter((m) => m.role === 'primary'), ...dbs.filter((m) => m.role !== 'primary')]
      .flatMap((m) => [...new Set(m.instances.map((i) => i.host))].map((h) => ({
        host: h, port: doc.hosts.find((x) => x.id === h)?.listenerPort ?? 1521,
      })));
  const { environment, events, ...head } = doc;
  return {
    ...head,
    hosts: [...doc.hosts, host],
    client: { ...doc.client, addresses },
    applications: [...applicationsOf(doc), { id: applicationId(id), name: id, host: host.id }],
    environment,
    events,
  };
}
