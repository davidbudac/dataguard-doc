/**
 * The application's card, as a document starts with it.
 *
 * Pure, like everything beside it: a document in, a document out. The card
 * stands on a host of its own in the primary's data centre -- which is where
 * it is to start with, and the reader moves it from there -- and an empty
 * ADDRESS_LIST is filled with the primary and every standby database, so the
 * connect string still finds the service once the role has moved.
 */

import { applicationId, hostId } from './ids';
import type { SiteId } from './ids';
import type { DatabaseMember, Host, TopologyDoc } from './types/topology';

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

/**
 * The document with an application on it. Unchanged when it has one already,
 * or when there is no data centre to stand it in.
 */
export function withApplication(doc: TopologyDoc, where?: SiteId, name = 'app01'): TopologyDoc {
  if (doc.application !== undefined) return doc;
  const site = where !== undefined && doc.sites.some((s) => s.id === where) ? where : primarySite(doc);
  if (site === null) return doc;
  const ids = new Set<string>([
    ...doc.sites.map((s) => s.id as string), ...doc.members.map((m) => m.id as string),
    ...doc.observers.map((o) => o.id as string), ...doc.links.map((l) => l.id as string),
  ]);
  const id = free(ids, name);
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
    application: { id: applicationId(id), name: id, host: host.id },
    environment,
    events,
  };
}
