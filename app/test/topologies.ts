/**
 * Hand-built deployments for the simulation tests.
 *
 * These are the fact sheet's worked examples in document form: the far sync
 * pair from Example 5-2, a multi-target configuration, a RAC primary, a
 * maximum protection configuration and a two-observer one. Nothing here is a
 * fixture of the engine -- every one of them is a document a user could build
 * in the editor.
 */

import { hostId, linkId, memberId, observerId, siteId } from '../src/engine/ids';
import type { Edition, HostId, MemberId, SiteId } from '../src/engine/ids';
import {
  defaultClient, defaultConfiguration, defaultDestProps, defaultEnvironment,
} from '../src/engine/serialize/schema';
import type {
  DatabaseMember, FarSyncMember, Host, Link, Member, Observer, ProtectionMode, Site, TopologyDoc,
} from '../src/engine/types/topology';

const site = (id: string): Site => ({ id: siteId(id), name: id.toUpperCase() });
const host = (id: string, s: string, cluster?: string): Host => cluster === undefined
  ? { id: hostId(id), name: id, site: siteId(s), listenerPort: 1521 }
  : { id: hostId(id), name: id, site: siteId(s), cluster, listenerPort: 1521 };
const siteLink = (a: string, b: string, rttMs = 0): Link => ({
  id: linkId(`${a}-${b}`), scope: 'site', ends: [siteId(a), siteId(b)], rttMs, up: true,
});

export const db = (
  id: string, hosts: string[], role: DatabaseMember['role'], over: Partial<DatabaseMember> = {},
): DatabaseMember => ({
  id: memberId(id), kind: 'database', name: id,
  instances: hosts.map((h, i) => ({ name: `${id}${hosts.length > 1 ? i + 1 : ''}`, host: hostId(h) })),
  connectIdentifier: id, enabled: true, dests: {}, redoRoutes: [], logXptMode: 'SYNC',
  role, flashbackOn: false, applyLagSeconds: role === 'primary' ? 0 : 10,
  transportLagSeconds: 0, applyRunning: role !== 'primary', realTimeApply: role !== 'primary',
  openMode: role === 'primary' ? 'read-write' : 'mount', staticServices: false,
  ...over,
});

export const farSync = (id: string, h: string, over: Partial<FarSyncMember> = {}): FarSyncMember => ({
  id: memberId(id), kind: 'farsync', name: id,
  instances: [{ name: id, host: hostId(h) }],
  connectIdentifier: id, enabled: true, dests: {}, redoRoutes: [], logXptMode: 'SYNC',
  transportLagSeconds: 0,
  ...over,
});

export const observer = (id: string, h: string, role: 'master' | 'backup' = 'master'): Observer => ({
  id: observerId(id), name: id, host: hostId(h), role, running: true,
});

interface BuildOpts {
  edition?: Edition;
  mode?: ProtectionMode;
  sites: string[];
  hosts: [string, string, string?][];
  members: Member[];
  observers?: Observer[];
  targets: MemberId[];
  fsfo?: 'enabled' | 'disabled' | 'observe-only';
  rttMs?: number;
}

export function build(o: BuildOpts): TopologyDoc {
  const sites = o.sites.map(site);
  const hosts = o.hosts.map(([h, s, c]) => host(h, s, c));
  const links: Link[] = [];
  for (let i = 0; i < o.sites.length; i++) {
    for (let j = i + 1; j < o.sites.length; j++) {
      links.push(siteLink(o.sites[i] as string, o.sites[j] as string, o.rttMs ?? 0));
    }
  }
  const config = defaultConfiguration(o.edition ?? '19c');
  config.protectionMode = o.mode ?? 'MAXAVAILABILITY';
  config.fsfo = {
    ...config.fsfo,
    state: o.fsfo ?? 'enabled',
    target: { kind: 'list', members: o.targets },
  };
  const client = defaultClient();
  client.addresses = hosts.slice(0, 2).map((h) => ({ host: h.id, port: 1521 }));
  return {
    app: 'dg-topology', schema: 2,
    sites, hosts, links,
    members: o.members,
    observers: o.observers ?? [],
    config, client,
    environment: defaultEnvironment(),
    events: [],
  };
}

export const dest = (from: Member, to: MemberId, over: Partial<ReturnType<typeof defaultDestProps>> = {}): void => {
  from.dests[to] = { ...defaultDestProps(), ...over };
};

/* ---------------- the worked examples ---------------- */

/**
 * Example 5-2 in document form: the primary ships SYNC to a far sync instance
 * beside it, which forwards ASYNC to the terminal standby. The routes are
 * pre-declared in both directions -- nothing rewrites on a role change.
 */
export function farSyncDoc(mode: ProtectionMode = 'MAXAVAILABILITY'): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [{ source: 'LOCAL', groups: [{ dests: [{ target: memberId('fs1'), xpt: 'SYNC' }] }] }],
  });
  const fs1 = farSync('fs1', 'dc1-fs01', {
    redoRoutes: [{
      source: [memberId('prm01')],
      groups: [{ dests: [{ target: memberId('sby01'), xpt: 'ASYNC' }] }],
    }],
  });
  const sby = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'ASYNC' });
  dest(prm, fs1.id);
  dest(fs1, sby.id);
  const doc = build({
    mode,
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc1-fs01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
    members: [prm, fs1, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby.id],
  });
  return doc;
}

/**
 * A cascade: the primary ships SYNC to a standby beside it, which forwards
 * ASYNC to a terminal standby further away. Example 4-2 in document form.
 */
export function cascadeDoc(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [{ source: 'LOCAL', groups: [{ dests: [{ target: memberId('sby01'), xpt: 'SYNC' }] }] }],
  });
  const sby = db('sby01', ['dc2-sby01'], 'physical', {
    redoRoutes: [{
      source: [memberId('prm01')],
      groups: [{ dests: [{ target: memberId('remote_sby'), xpt: 'ASYNC' }] }],
    }],
  });
  const remote = db('remote_sby', ['dc3-rsby'], 'physical', { logXptMode: 'ASYNC' });
  dest(prm, sby.id);
  dest(sby, remote.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-rsby', 'dc3'], ['dc3-obs01', 'dc3']],
    members: [prm, sby, remote],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby.id],
  });
}

/** Two candidate targets, the first of them in the data centre that dies. */
export function multiTargetDoc(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary');
  const sby01 = db('sby01', ['dc2-sby01'], 'physical');
  const sby02 = db('sby02', ['dc3-sby02'], 'physical');
  dest(prm, sby01.id);
  dest(prm, sby02.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc3-obs01', 'dc3']],
    members: [prm, sby01, sby02],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby01.id, sby02.id],
  });
}

/** A two-instance RAC primary: losing one instance is degraded, not down. */
export function racDoc(): TopologyDoc {
  const prm = db('prm01', ['dc1-node1', 'dc1-node2'], 'primary');
  const sby = db('sby01', ['dc2-sby01'], 'physical');
  dest(prm, sby.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-node1', 'dc1', 'rac1'], ['dc1-node2', 'dc1', 'rac1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
    members: [prm, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby.id],
  });
}

/** Maximum protection with a single synchronous standby. */
export function maxProtDoc(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary');
  const sby = db('sby01', ['dc2-sby01'], 'physical');
  dest(prm, sby.id, { netTimeoutSeconds: 10 });
  return build({
    mode: 'MAXPROTECTION',
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
    members: [prm, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby.id],
  });
}

/** A master observer and a backup, on hosts of their own in two data centres. */
export function multiObserverDoc(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary');
  const sby = db('sby01', ['dc2-sby01'], 'physical');
  dest(prm, sby.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3'], ['dc4-obs02', 'dc4']],
    members: [prm, sby],
    observers: [observer('obs01', 'dc3-obs01', 'master'), observer('obs02', 'dc4-obs02', 'backup')],
    targets: [sby.id],
  });
}

export const hostOf = (id: string): HostId => hostId(id);
export const siteOf = (id: string): SiteId => siteId(id);
export const memberOf = (id: string): MemberId => memberId(id);
