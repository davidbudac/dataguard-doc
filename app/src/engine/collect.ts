/** Read-only collector format; strict framing prevents accepting partial SQL output. */
import { emptyDoc, parseTopologyDoc } from './serialize/schema';
import { defaultLagLimit } from './defaults';
import { utf8Encode } from './serialize/url';
import { hostId, linkId, memberId, observerId, siteId } from './ids';
import type { Edition } from './ids';
import type { DbRole, Member, TopologyDoc, XptMode } from './types/topology';

type Row = Record<string, unknown>;
export interface CollectedTopology {
  topology: TopologyDoc;
  notes: string[];
}
interface Snapshot { rows: Row[]; db: Row; name: string }

const ROLES: Readonly<Record<string, DbRole>> = {
  PRIMARY: 'primary',
  'PHYSICAL STANDBY': 'physical',
  'LOGICAL STANDBY': 'logical',
  'SNAPSHOT STANDBY': 'snapshot',
};
const PROTECTION_MODES = {
  'MAXIMUM AVAILABILITY': 'MAXAVAILABILITY',
  'MAXIMUM PERFORMANCE': 'MAXPERFORMANCE',
  'MAXIMUM PROTECTION': 'MAXPROTECTION',
} as const;
export const COLLECTION_LIMIT = 2_000_000;
export const COLLECTION_NOTE = 'Imported SQL snapshot — review assumptions';
const str = (r: Row, k: string): string => typeof r[k] === 'string' ? r[k].trim() : '';
const required = (r: Row, k: string): string => {
  const v = str(r, k);
  if (!v) throw new Error(`Collector record is missing ${k}.`);
  return v;
};
const key = (s: string): string => s.toUpperCase();
const number = (r: Row, k: string): number => {
  const v = r[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`Invalid ${k} in collector output.`);
  return v;
};

function blocks(text: string): Row[][] {
  if (text.length > COLLECTION_LIMIT || utf8Encode(text).length > COLLECTION_LIMIT) throw new Error('Collector output exceeds 2 MB.');
  const result: Row[][] = [];
  let current: Row[] | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(ORA-|SP2-|TNS-|ERROR\b)/.test(line)) throw new Error('The collector reported an Oracle/client error. Fix it and collect again.');
    if (line === 'DGTOPO_BEGIN_V1') {
      if (current) throw new Error('An earlier collector block is incomplete.');
      current = [];
    } else if (line === 'DGTOPO_END_V1') {
      if (!current) throw new Error('Collector end marker without a beginning.');
      result.push(current); current = null;
    } else if (current) {
      let r: unknown;
      try { r = JSON.parse(line); } catch { throw new Error('Invalid collector JSON. Use unwrapped SQL*Plus/SQLcl script output.'); }
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Invalid collector record.');
      const row = r as Row;
      if (!['database', 'instance', 'member', 'destination', 'lag'].includes(str(row, 'type'))) throw new Error('Unsupported collector record type.');
      current.push(row);
      if (current.length > 10000) throw new Error('Too many collector records.');
    } else if (line.startsWith('{') || line.startsWith('DGTOPO_')) {
      throw new Error('Missing markers or unsupported collector version.');
    }
    // SQL*Plus banners and spool commands outside framed blocks are harmless.
  }
  if (current) throw new Error('Incomplete collector block: the end marker is missing.');
  if (!result.length) throw new Error('Paste output from dataguard-topology.sql, including its BEGIN and END markers.');
  if (result.length > 64) throw new Error('At most 64 member snapshots can be imported.');
  return result;
}

function readSnapshots(text: string): Snapshot[] {
  return blocks(text).map((rows) => {
    const dbs = rows.filter(r => r.type === 'database');
    if (dbs.length !== 1) throw new Error('Each collector block must contain exactly one database record.');
    const db = dbs[0]!;
    const name = required(db, 'name');
    if (['__proto__', 'constructor', 'prototype'].includes(name.toLowerCase())) throw new Error('Unsupported member identifier.');
    if (!['YES', 'NO'].includes(required(db, 'cdb'))) throw new Error(`${name}: invalid CDB flag.`);
    if (str(db, 'cdb') === 'YES' && str(db, 'container') !== 'CDB$ROOT') {
      throw new Error(`${name}: collect from CDB$ROOT, not a PDB.`);
    }
    return { rows, db, name };
  });
}

export function importCollectedTopology(text: string, edition: Edition = '19c'): CollectedTopology {
  const snapshots = readSnapshots(text);
  const byName = new Map(snapshots.map(s => [key(s.name), s]));
  if (byName.size !== snapshots.length) throw new Error('Duplicate member snapshots. Keep one complete, recent block per DB_UNIQUE_NAME.');
  const primary = snapshots.filter(s => str(s.db, 'role') === 'PRIMARY');
  if (primary.length !== 1) throw new Error('Collect exactly one primary and its members together; multiple primaries or a missing primary cannot be imported.');
  const p = primary[0]!;
  const missing = new Set<string>();
  for (const s of snapshots) for (const r of s.rows) {
    const name = r.type === 'member' ? str(r, 'name') : r.type === 'destination' ? str(r, 'target') : '';
    if (name && !['NONE', 'UNKNOWN'].includes(key(name)) && !byName.has(key(name))) missing.add(name);
  }
  if (missing.size) throw new Error(`Also run the SQL collector on these members and paste their blocks: ${[...missing].join(', ')}.`);
  // All snapshots must belong to the primary's advertised configuration.
  const known = new Set(p.rows.filter(r => r.type === 'member').map(r => key(str(r, 'name'))));
  known.add(key(p.name));
  for (const s of snapshots) if (!known.has(key(s.name))) throw new Error(`${s.name} is not in the primary's collected configuration.`);

  const topology = emptyDoc(edition);
  topology.label = `Imported ${p.name}`;
  topology.config.name = p.name;
  const protection = str(p.db, 'protection');
  if (!Object.hasOwn(PROTECTION_MODES, protection)) throw new Error(`Cannot map protection mode ${protection}; collect from a running primary.`);
  topology.config.protectionMode = PROTECTION_MODES[protection as keyof typeof PROTECTION_MODES];
  topology.config.fsfo.lagLimitSeconds = defaultLagLimit(edition, topology.config.protectionMode);
  const notes = [
    'Current topology only, not a complete broker configuration or a health check. Collect all members close together, with no role transition in progress.',
    'Sites are provisional host groups, not discovered data centres. Links assume connectivity and 0 ms RTT; listener ports use 1521. Review placement, connectivity and ports.',
    'Broker RedoRoutes, future role routes, priorities/alternates, backup observers, full FSFO target list, lag policy, ping settings, ObserverOverride and other broker properties were not collected. Uncollected settings use simulator defaults; ObserverOverride is assumed FALSE.',
    'Apply-running/real-time-apply, static services, client services/connect strings, I/O times, redo rate and role-transition time were not collected and use simulation placeholders. Do not deploy generated configuration without review.',
  ];
  const hostMap = new Map<string, ReturnType<typeof hostId>>();
  const addHost = (name: string) => {
    const existing = hostMap.get(key(name));
    if (existing) return existing;
    const id = hostId(`import-h${hostMap.size + 1}`);
    const site = siteId(`import-s${hostMap.size + 1}`);
    topology.sites.push({ id: site, name: `Site unknown · ${name}` });
    topology.hosts.push({ id, name, site, listenerPort: 1521 });
    hostMap.set(key(name), id);
    return id;
  };
  const idFor = (name: string) => {
    const found = byName.get(key(name));
    if (!found) throw new Error(`Unknown member ${name}.`);
    return memberId(found.name);
  };
  for (const s of snapshots) {
    const instances = s.rows.filter(r => r.type === 'instance').map(r => ({ name: required(r, 'name'), host: addHost(required(r, 'host')) }));
    if (!instances.length) throw new Error(`${s.name}: missing instance records.`);
    if (new Set(instances.map(i => key(i.name))).size !== instances.length) throw new Error(`${s.name}: duplicate instance records.`);
    notes.push(`${s.name}: collected ${required(s.db, 'collectedAt')}; Oracle ${s.rows.filter(r => r.type === 'instance').map(r => required(r, 'version')).join(', ')}. Reading edition: ${edition}.`);
    const role = required(s.db, 'role');
    if (role !== 'FAR SYNC' && !Object.hasOwn(ROLES, role)) throw new Error(`Unsupported member role ${role}.`);
    const base = { id: idFor(s.name), name: s.name, instances, connectIdentifier: s.name, enabled: true, dests: {}, redoRoutes: [], routesObserved: true as const, logXptMode: 'ASYNC' as const };
    const member: Member = role === 'FAR SYNC' ? { ...base, kind: 'farsync', transportLagSeconds: 0 } : {
      ...base, kind: 'database', role: ROLES[role]!, flashbackOn: str(s.db, 'flashback') === 'YES',
      applyLagSeconds: role === 'PRIMARY' ? 0 : readLag(s, 'apply lag', notes),
      transportLagSeconds: role === 'PRIMARY' ? 0 : readLag(s, 'transport lag', notes),
      applyRunning: true, realTimeApply: true, staticServices: false,
      openMode: str(s.db, 'openMode') === 'READ WRITE' ? 'read-write' : str(s.db, 'openMode').startsWith('READ ONLY') ? 'read-only-adg' : 'mount',
    };
    topology.members.push(member);
  }
  for (const s of snapshots) {
    const sender = topology.members.find(m => m.id === idFor(s.name))!;
    const seen = new Map<string, string>();
    for (const r of s.rows.filter(r => r.type === 'destination')) {
      const name = required(r, 'target');
      const target = idFor(name);
      if (target === sender.id) throw new Error(`${s.name}: remote destination points to itself.`);
      const signature = JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !['instance', 'destId'].includes(k)).sort()));
      if (seen.has(key(name))) {
        if (seen.get(key(name)) !== signature) throw new Error(`${s.name} → ${name}: differing destinations/RAC settings cannot be represented by one edge.`);
        continue;
      }
      seen.set(key(name), signature);
      if (str(r, 'status') !== 'VALID' || str(r, 'validNow') !== 'YES') {
        notes.push(`${s.name} → ${name}: omitted from current routes (${str(r, 'status')}, ${str(r, 'validNow')}).`);
        continue;
      }
      // V$ARCHIVE_DEST reports ALTERNATE as the string NONE when none is set.
      const alternate = str(r, 'alternate');
      if (alternate && key(alternate) !== 'NONE') notes.push(`${s.name} → ${name}: current route retained; alternate ${alternate} is not reconstructed.`);
      const transmit = required(r, 'transmit');
      if (!['SYNCHRONOUS', 'PARALLELSYNC', 'ASYNCHRONOUS'].includes(transmit)) throw new Error(`Unsupported transmit mode ${transmit}.`);
      const affirm = required(r, 'affirm');
      if (!['YES', 'NO'].includes(affirm)) throw new Error(`Unsupported AFFIRM value ${affirm}.`);
      const xpt: XptMode = transmit === 'ASYNCHRONOUS' ? 'ASYNC' : affirm === 'YES' ? 'SYNC' : 'FASTSYNC';
      sender.dests[target] = { netTimeoutSeconds: number(r, 'netTimeout'), reopenSeconds: number(r, 'reopen'), maxFailure: number(r, 'maxFailure'), affirm: affirm === 'YES' ? 'AFFIRM' : 'NOAFFIRM' };
      if (!sender.redoRoutes.length) sender.redoRoutes.push({ source: [idFor(p.name)], groups: [{ dests: [] }] });
      sender.redoRoutes[0]!.groups[0]!.dests.push({ target, xpt });
      topology.members.find(m => m.id === target)!.logXptMode = xpt;
    }
  }
  const fsfo = required(p.db, 'fsfo');
  if (!['DISABLED', 'OBSERVE-ONLY', 'ZERO DATA LOSS', 'POTENTIAL DATA LOSS'].includes(fsfo)) throw new Error(`Unsupported FSFO mode ${fsfo}.`);
  topology.config.fsfo.state = fsfo === 'DISABLED' ? 'disabled' : fsfo === 'OBSERVE-ONLY' ? 'observe-only' : 'enabled';
  if (fsfo !== 'DISABLED') {
    topology.config.fsfo.thresholdSeconds = number(p.db, 'threshold');
    const target = str(p.db, 'target');
    if (target) topology.config.fsfo.target = { kind: 'list', members: [idFor(target)] };
    const observerHost = str(p.db, 'observerHost');
    if (observerHost) topology.observers.push({ id: observerId('import-observer'), name: 'Master observer (name unknown)', host: addHost(observerHost), role: 'master', running: str(p.db, 'observerPresent') === 'YES' });
    notes.push('Only the current FSFO target and master observer host are represented. Observer presence is local to the primary; it does not prove process state or reachability from the standby.');
  }
  // Connectivity is an explicit drawing assumption, separate from observed redo edges.
  for (let i = 0; i < topology.sites.length; i++) for (let j = i + 1; j < topology.sites.length; j++) {
    topology.links.push({ id: linkId(`import-l${i}-${j}`), ends: [topology.sites[i]!.id, topology.sites[j]!.id], scope: 'site', rttMs: 0, up: true });
  }
  const parsed = parseTopologyDoc(topology);
  if (!parsed.doc) throw new Error(parsed.issues.map(i => `${i.path}: ${i.message}`).join('; '));
  for (const issue of parsed.issues) notes.push(`Simulator adjustment: ${issue.path}: ${issue.message}`);
  notes.push('Lag readings may be stale; the collector output retains timeComputed and datumTime. Review the raw output.');
  return { topology: parsed.doc, notes: [...new Set(notes)] };
}

/** A malformed or unavailable interval is an explicit placeholder, never a measured zero. */
function readLag(snapshot: Snapshot, name: string, notes: string[]): number {
  const row = snapshot.rows.find(r => r.type === 'lag' && r.name === name);
  const value = row ? str(row, 'value') : '';
  const match = /^\+?(\d+) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
  if (match) {
    const [, days, hours, minutes, seconds, fraction] = match;
    const total = Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60
      + Number(seconds) + Number(`0.${fraction ?? '0'}`);
    if (Number(hours) < 24 && Number(minutes) < 60 && Number(seconds) < 60 && Number.isFinite(total)) {
      return total;
    }
  }
  notes.push(`${snapshot.name}: ${name} unavailable: using 0 s, not a measured zero.`);
  return 0;
}
