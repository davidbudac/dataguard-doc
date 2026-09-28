/**
 * Runtime validation of a TopologyDoc -- hand rolled, no schema library.
 *
 * The parser is deliberately forgiving in one direction only: unknown keys are
 * dropped, missing keys take their default and numerics are clamped against the
 * one BOUNDS table, each of which is reported as a `repaired` issue. Anything
 * that would change the meaning of the document -- a member pointing at a host
 * that does not exist, a fast-start failover target that is not a member --
 * is an `error`.
 */

import { BOUNDS, BROKER_DEFAULTS, clamp, defaultLagLimit } from '../defaults';
import type { BoundKey } from '../defaults';
import { applicationId, hostId, memberId, observerId, siteId, linkId } from '../ids';
import type { Edition, HostId, LinkId, MemberId, ObserverId, SiteId } from '../ids';
import type { TimedEvent } from '../types/events';
import type {
  Application, ClientDescriptor, Configuration, DatabaseMember, DbRole, DestGroup, DestProps,
  EnvironmentParams, FarSyncMember, FsfoConfig, Host, Instance, Link, Member, Observer,
  OpenMode, ProtectionMode, RedoRouteRule, RoutePriority, RouteDest, ServiceDef, Site,
  TopologyDoc, XptMode,
} from '../types/topology';

export type IssueSeverity = 'error' | 'repaired';

export interface SchemaIssue {
  path: string;
  message: string;
  severity: IssueSeverity;
}

export interface ParseResult {
  ok: boolean;
  doc: TopologyDoc | null;
  issues: SchemaIssue[];
}

/* ---------------- primitives ---------------- */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const XPT_MODES: XptMode[] = ['SYNC', 'FASTSYNC', 'ASYNC'];
const DB_ROLES: DbRole[] = ['primary', 'physical', 'logical', 'snapshot'];
const OPEN_MODES: OpenMode[] = ['mount', 'read-only-adg', 'read-write'];
const MODES: ProtectionMode[] = ['MAXPROTECTION', 'MAXAVAILABILITY', 'MAXPERFORMANCE'];

class Ctx {
  readonly issues: SchemaIssue[] = [];

  repaired(path: string, message: string): void {
    this.issues.push({ path, message, severity: 'repaired' });
  }

  error(path: string, message: string): void {
    this.issues.push({ path, message, severity: 'error' });
  }

  str(v: unknown, path: string, dflt: string, maxLen = 128): string {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return dflt;
      if (t.length > maxLen) {
        this.repaired(path, `truncated to ${maxLen} characters`);
        return t.slice(0, maxLen);
      }
      return t;
    }
    if (v !== undefined) this.repaired(path, 'not a string; using the default');
    return dflt;
  }

  bool(v: unknown, path: string, dflt: boolean): boolean {
    if (typeof v === 'boolean') return v;
    if (v !== undefined) this.repaired(path, 'not a boolean; using the default');
    return dflt;
  }

  bounded(v: unknown, path: string, key: BoundKey, dflt?: number): number {
    const b = BOUNDS[key];
    const fallback = dflt === undefined ? b.default : dflt;
    const n = typeof v === 'number' ? v : v === undefined ? undefined : Number(v);
    if (n === undefined || !isFinite(n)) {
      if (v !== undefined) this.repaired(path, `not a number; using ${fallback}`);
      return clamp(key, fallback, fallback);
    }
    const c = clamp(key, n, fallback);
    if (c !== n) this.repaired(path, `clamped from ${n} to ${c} (${b.min}..${b.max} step ${b.step})`);
    return c;
  }

  num(v: unknown, path: string, dflt: number, min = -Infinity, max = Infinity): number {
    const n = typeof v === 'number' ? v : v === undefined ? undefined : Number(v);
    if (n === undefined || !isFinite(n)) {
      if (v !== undefined) this.repaired(path, `not a number; using ${dflt}`);
      return dflt;
    }
    const c = Math.min(max, Math.max(min, n));
    if (c !== n) this.repaired(path, `clamped from ${n} to ${c}`);
    return c;
  }

  oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[], dflt: T): T {
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    if (v !== undefined) this.repaired(path, `not one of ${allowed.join(', ')}; using ${dflt}`);
    return dflt;
  }
}

/* ---------------- defaults ---------------- */

export function defaultFsfo(edition: Edition = '19c'): FsfoConfig {
  const d = BROKER_DEFAULTS[edition];
  return {
    state: 'disabled',
    target: { kind: 'list', members: [] },
    thresholdSeconds: d.thresholdSeconds,
    /* 26ai gives maximum availability its own default of 0 -- zero data loss;
       under 19c the limit is a maximum performance property at 30 s. */
    lagLimitSeconds: defaultLagLimit(edition, d.protectionMode),
    lagType: d.lagType,
    lagGraceTimeSeconds: d.lagGraceTimeSeconds,
    pingIntervalMs: null,
    pingRetry: null,
    pmyShutdown: d.pmyShutdown,
    autoReinstate: d.autoReinstate,
  };
}

export function defaultConfiguration(edition: Edition = '19c'): Configuration {
  const d = BROKER_DEFAULTS[edition];
  return {
    name: 'dg_config',
    edition,
    protectionMode: d.protectionMode,
    bystandersFollowRoleChange: d.bystandersFollowRoleChange,
    fsfo: defaultFsfo(edition),
    services: [],
    observerOverride: false,
  };
}

export function defaultClient(): ClientDescriptor {
  return {
    serviceName: 'app_svc',
    addresses: [],
    transportConnectTimeoutSeconds: BOUNDS.transportConnectTimeoutSeconds.default,
    connectTimeoutSeconds: null,
    retryCount: BOUNDS.retryCount.default,
    retryDelaySeconds: BOUNDS.retryDelaySeconds.default,
    failover: true,
    loadBalance: false,
    deadBehaviour: 'drop',
  };
}

export function defaultEnvironment(): EnvironmentParams {
  return {
    roleTransitionSeconds: BOUNDS.roleTransitionSeconds.default,
    localWriteMs: BOUNDS.localWriteMs.default,
    standbyWriteMs: BOUNDS.standbyWriteMs.default,
    redoRateMBs: BOUNDS.redoRateMBs.default,
  };
}

/**
 * MaxFailure's broker default inside a RedoRoutes group: "If the standby
 * database is part of a group as specified with the broker RedoRoutes
 * property, then the default value 1. Otherwise, the default value is 0."
 * (19c and 26ai property pages alike.)
 */
export const MAX_FAILURE_IN_GROUP_DEFAULT = 1;

/**
 * The broker defaults for a destination that has no properties of its own.
 * `inGroup` is true when the destination is written inside a parenthesised
 * RedoRoutes group, where MaxFailure defaults to 1 instead of 0.
 */
export function defaultDestProps(opts: { inGroup?: boolean } = {}): DestProps {
  return {
    netTimeoutSeconds: BOUNDS.netTimeoutSeconds.default,
    reopenSeconds: BOUNDS.reopenSeconds.default,
    maxFailure: opts.inGroup === true ? MAX_FAILURE_IN_GROUP_DEFAULT : BOUNDS.maxFailure.default,
  };
}

/** A well-formed but empty document -- the starting point for a new topology. */
export function emptyDoc(edition: Edition = '19c'): TopologyDoc {
  return {
    app: 'dg-topology',
    schema: 2,
    sites: [],
    hosts: [],
    links: [],
    members: [],
    observers: [],
    config: defaultConfiguration(edition),
    client: defaultClient(),
    environment: defaultEnvironment(),
    events: [],
  };
}

/* ---------------- parsing ---------------- */

export function parseTopologyDoc(raw: unknown): ParseResult {
  const c = new Ctx();
  if (!isObj(raw)) {
    c.error('', 'not an object');
    return { ok: false, doc: null, issues: c.issues };
  }
  if (raw['app'] !== 'dg-topology') {
    c.error('app', "expected 'dg-topology'");
    return { ok: false, doc: null, issues: c.issues };
  }
  if (raw['schema'] !== 2) {
    c.error('schema', `expected schema 2, got ${JSON.stringify(raw['schema'])}`);
    return { ok: false, doc: null, issues: c.issues };
  }

  const edition = c.oneOf<Edition>(
    isObj(raw['config']) ? raw['config']['edition'] : undefined, 'config.edition',
    ['19c', '26ai'], '19c');

  const sites = parseSites(c, raw['sites']);
  const siteIds = new Set<string>(sites.map((s) => s.id as string));
  const hosts = parseHosts(c, raw['hosts'], siteIds);
  const hostIds = new Set<string>(hosts.map((h) => h.id as string));
  const links = parseLinks(c, raw['links'], siteIds, hostIds);
  const members = parseMembers(c, raw['members'], hostIds);
  const memberIds = new Set<string>(members.map((m) => m.id as string));
  const observers = parseObservers(c, raw['observers'], hostIds);
  const config = parseConfiguration(c, raw['config'], edition, memberIds, hostIds);
  const client = parseClient(c, raw['client'], hostIds);
  const application = parseApplication(c, raw['application'], hostIds);
  const environment = parseEnvironment(c, raw['environment']);
  const events = parseEvents(c, raw['events'], { hostIds, siteIds, memberIds, links, observers });

  /* Cross-references that only make sense once everything exists. */
  for (const m of members) {
    for (const key of Object.keys(m.dests)) {
      if (!memberIds.has(key)) {
        c.repaired(`members.${m.id}.dests.${key}`, 'destination is not a member; dropped');
        delete m.dests[memberId(key)];
      }
    }
  }

  const doc: TopologyDoc = {
    app: 'dg-topology',
    schema: 2,
    sites, hosts, links, members, observers, config, client,
    ...(application ? { application } : {}),
    environment, events,
  };
  const savedAt = typeof raw['savedAt'] === 'string' ? raw['savedAt'] : undefined;
  if (savedAt) doc.savedAt = savedAt;
  const label = typeof raw['label'] === 'string' ? raw['label'].trim().slice(0, 128) : undefined;
  if (label) doc.label = label;

  const ok = !c.issues.some((i) => i.severity === 'error');
  return { ok, doc, issues: c.issues };
}

export function isTopologyDoc(raw: unknown): raw is TopologyDoc {
  return parseTopologyDoc(raw).ok;
}

/** Parse and throw on the first hard error -- for callers that own the input. */
export function parseTopologyDocOrThrow(raw: unknown): TopologyDoc {
  const r = parseTopologyDoc(raw);
  if (!r.ok || !r.doc) {
    const e = r.issues.find((i) => i.severity === 'error');
    throw new Error(`invalid topology document: ${e ? `${e.path}: ${e.message}` : 'unknown error'}`);
  }
  return r.doc;
}

/* ---------------- section parsers ---------------- */

function parseSites(c: Ctx, raw: unknown): Site[] {
  const out: Site[] = [];
  const seen = new Set<string>();
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`sites[${i}]`, 'not an object; dropped'); return; }
    const id = c.str(v['id'], `sites[${i}].id`, '', 64);
    if (!id) { c.repaired(`sites[${i}].id`, 'missing; dropped'); return; }
    if (seen.has(id)) { c.repaired(`sites[${i}].id`, `duplicate ${id}; dropped`); return; }
    seen.add(id);
    out.push({ id: siteId(id), name: c.str(v['name'], `sites[${i}].name`, id, 64) });
  });
  return out;
}

function parseHosts(c: Ctx, raw: unknown, siteIds: ReadonlySet<string>): Host[] {
  const out: Host[] = [];
  const seen = new Set<string>();
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`hosts[${i}]`, 'not an object; dropped'); return; }
    const id = c.str(v['id'], `hosts[${i}].id`, '', 64);
    if (!id) { c.repaired(`hosts[${i}].id`, 'missing; dropped'); return; }
    if (seen.has(id)) { c.repaired(`hosts[${i}].id`, `duplicate ${id}; dropped`); return; }
    const site = c.str(v['site'], `hosts[${i}].site`, '', 64);
    if (!siteIds.has(site)) {
      c.error(`hosts[${i}].site`, `host ${id} names site ${site || '(none)'}, which does not exist`);
      return;
    }
    seen.add(id);
    const host: Host = {
      id: hostId(id),
      name: c.str(v['name'], `hosts[${i}].name`, id, 64),
      site: siteId(site),
      listenerPort: c.bounded(v['listenerPort'], `hosts[${i}].listenerPort`, 'listenerPort'),
    };
    const cluster = typeof v['cluster'] === 'string' ? v['cluster'].trim() : '';
    if (cluster) host.cluster = cluster.slice(0, 64);
    out.push(host);
  });
  return out;
}

function parseLinks(
  c: Ctx, raw: unknown, siteIds: ReadonlySet<string>, hostIds: ReadonlySet<string>,
): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>();
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`links[${i}]`, 'not an object; dropped'); return; }
    const id = c.str(v['id'], `links[${i}].id`, '', 64);
    if (!id) { c.repaired(`links[${i}].id`, 'missing; dropped'); return; }
    if (seen.has(id)) { c.repaired(`links[${i}].id`, `duplicate ${id}; dropped`); return; }
    const scope = c.oneOf(v['scope'], `links[${i}].scope`, ['site', 'host'] as const, 'site');
    const ends = asArray(v['ends']);
    const a = typeof ends[0] === 'string' ? ends[0] : '';
    const b = typeof ends[1] === 'string' ? ends[1] : '';
    const pool = scope === 'site' ? siteIds : hostIds;
    if (!pool.has(a) || !pool.has(b)) {
      c.error(`links[${i}].ends`, `link ${id} joins ${a || '(none)'} and ${b || '(none)'}, which are not both ${scope}s`);
      return;
    }
    if (a === b) { c.error(`links[${i}].ends`, `link ${id} joins ${a} to itself`); return; }
    seen.add(id);
    const link: Link = {
      id: linkId(id),
      scope,
      ends: (scope === 'site'
        ? [siteId(a), siteId(b)]
        : [hostId(a), hostId(b)]) as [SiteId, SiteId] | [HostId, HostId],
      rttMs: c.bounded(v['rttMs'], `links[${i}].rttMs`, 'latencyMs', 0),
      up: c.bool(v['up'], `links[${i}].up`, true),
    };
    if (typeof v['bandwidthMbit'] === 'number' && isFinite(v['bandwidthMbit'])) {
      link.bandwidthMbit = Math.max(0, v['bandwidthMbit']);
    }
    out.push(link);
  });
  return out;
}

function parseInstances(
  c: Ctx, raw: unknown, path: string, hostIds: ReadonlySet<string>, fallbackName: string,
): Instance[] {
  const out: Instance[] = [];
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`${path}[${i}]`, 'not an object; dropped'); return; }
    const host = c.str(v['host'], `${path}[${i}].host`, '', 64);
    if (!hostIds.has(host)) {
      c.error(`${path}[${i}].host`, `instance host ${host || '(none)'} does not exist`);
      return;
    }
    out.push({
      name: c.str(v['name'], `${path}[${i}].name`, `${fallbackName}${i + 1}`, 64),
      host: hostId(host),
    });
  });
  return out;
}

function parseRoutePriority(c: Ctx, v: unknown, path: string): RoutePriority | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 8) {
    c.repaired(path, 'PRIORITY must be an integer 1..8; dropped');
    return undefined;
  }
  return n as RoutePriority;
}

/** A group as it was read, before the old PRIORITY-on-the-group shape is migrated. */
interface RawGroup {
  dests: RouteDest[];
  explicitGroup: boolean;
  /** The pre-2026-09-28 shape put PRIORITY on the group. */
  groupPriority?: RoutePriority;
}

function parseRedoRoutes(
  c: Ctx, raw: unknown, path: string, senderIsFarSync: boolean,
): RedoRouteRule[] {
  const out: RedoRouteRule[] = [];
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`${path}[${i}]`, 'not an object; dropped'); return; }
    const src = v['source'];
    let source: RedoRouteRule['source'];
    if (src === 'LOCAL' || src === 'ANY') source = src;
    else if (Array.isArray(src)) {
      source = src.filter((s): s is string => typeof s === 'string').map(memberId);
      if (source.length === 0) { c.repaired(`${path}[${i}].source`, 'empty source; dropped'); return; }
    } else { c.repaired(`${path}[${i}].source`, 'missing; dropped'); return; }

    const raws: RawGroup[] = [];
    asArray(v['groups']).forEach((gv, gi) => {
      if (!isObj(gv)) { c.repaired(`${path}[${i}].groups[${gi}]`, 'not an object; dropped'); return; }
      const dests: RouteDest[] = [];
      asArray(gv['dests']).forEach((dv, di) => {
        const dpath = `${path}[${i}].groups[${gi}].dests[${di}]`;
        if (!isObj(dv)) { c.repaired(dpath, 'not an object; dropped'); return; }
        const target = typeof dv['target'] === 'string' ? dv['target'] : '';
        if (!target) { c.repaired(`${dpath}.target`, 'missing; dropped'); return; }
        const d: RouteDest = {
          target: target.toUpperCase() === 'ALL' ? 'ALL' : memberId(target),
        };
        if (typeof dv['xpt'] === 'string' && (XPT_MODES as string[]).includes(dv['xpt'])) {
          d.xpt = dv['xpt'] as XptMode;
        }
        const dp = parseRoutePriority(c, dv['priority'], `${dpath}.priority`);
        if (dp !== undefined) d.priority = dp;
        const alt = dv['alt'];
        if (isObj(alt) && typeof alt['target'] === 'string') {
          d.alt = { target: memberId(alt['target']) };
          if (typeof alt['xpt'] === 'string' && (XPT_MODES as string[]).includes(alt['xpt'])) {
            d.alt.xpt = alt['xpt'] as XptMode;
          }
          if (alt['fallback'] === true) d.alt.fallback = true;
        }
        dests.push(d);
      });
      if (dests.length === 0) return;
      const rg: RawGroup = { dests, explicitGroup: gv['explicitGroup'] === true };
      const p = parseRoutePriority(c, gv['priority'], `${path}[${i}].groups[${gi}].priority`);
      if (p !== undefined) rg.groupPriority = p;
      raws.push(rg);
    });
    if (raws.length === 0) { c.repaired(`${path}[${i}].groups`, 'no destinations; rule dropped'); return; }
    const groups = raws.some((g) => g.groupPriority !== undefined)
      ? migrateGroupPriority(c, raws, `${path}[${i}].groups`, senderIsFarSync)
      : raws.map((g) => (g.explicitGroup ? { dests: g.dests, explicitGroup: true } : { dests: g.dests }));
    out.push({ source, groups });
  });
  return out;
}

/**
 * Documents, share links and workspaces saved before 2026-09-28 put PRIORITY
 * on a parenthesised group and drew exactly one group at a time: the lowest
 * priority number (the SENDER's kind deciding the default), with every
 * destination in it shipping. Oracle's grammar puts PRIORITY on a destination
 * and has one active path per group, so the rule migrates to what its author
 * saw on screen:
 *
 *  - several groups, one active at a time, become ONE group whose destinations
 *    carry their old group's priority: `(A PRIORITY=1), (B PRIORITY=2)` was
 *    drawn "A, else B" and becomes `(A PRIORITY=1, B PRIORITY=2)`;
 *  - a group of several destinations shipped to all of them, which the new
 *    grammar says with PRIORITY=8 -- possible where that group was the last
 *    resort (or the only group); elsewhere it cannot be said exactly, and the
 *    migration reports it;
 *  - ALL is never inside a group and stays a path of its own.
 */
function migrateGroupPriority(
  c: Ctx, raws: readonly RawGroup[], path: string, senderIsFarSync: boolean,
): DestGroup[] {
  const senderDefault: RoutePriority = senderIsFarSync ? 1 : 8;
  const withAll = raws.filter((g) => g.dests.some((d) => d.target === 'ALL'));
  const named = raws.filter((g) => !withAll.includes(g));
  const prio = (g: RawGroup): RoutePriority => g.groupPriority ?? senderDefault;
  const last = named.length > 0 ? Math.max(...named.map(prio)) : 8;
  const lastCount = named.filter((g) => prio(g) === last).length;
  let exact = true;
  const dests: RouteDest[] = [];
  for (const g of named) {
    const several = g.dests.length > 1;
    const allAtOnce = several && (named.length === 1 || (prio(g) === last && lastCount === 1));
    if (several && !allAtOnce) exact = false;
    const p: RoutePriority = allAtOnce ? 8 : prio(g);
    for (const d of g.dests) dests.push({ ...d, priority: p });
  }
  const tied = new Set<number>();
  for (const g of named) {
    /* Two old groups at 8 took turns; two destinations at 8 ship together. */
    if (tied.has(prio(g)) && prio(g) === 8) exact = false;
    tied.add(prio(g));
  }
  const out: DestGroup[] = [];
  if (dests.length > 0) out.push({ dests, explicitGroup: true });
  for (const g of withAll) {
    out.push({ dests: g.dests.map(({ priority: _p, ...d }) => d) });
  }
  c.repaired(path, exact
    ? 'PRIORITY was saved on the group (the pre-2026-09-28 reading); migrated to one group with PRIORITY on each destination, which ships where the old drawing did'
    : 'PRIORITY was saved on the group (the pre-2026-09-28 reading); migrated to one group with PRIORITY on each destination, but the old drawing shipped to every destination of a group at once and RedoRoutes ships to one per group, so this rule now ships to fewer destinations than it was drawn with');
  return out;
}

function parseDests(c: Ctx, raw: unknown, path: string): Record<MemberId, DestProps> {
  const out: Record<MemberId, DestProps> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v)) { c.repaired(`${path}.${k}`, 'not an object; dropped'); continue; }
    const d: DestProps = {
      netTimeoutSeconds: c.bounded(v['netTimeoutSeconds'], `${path}.${k}.netTimeoutSeconds`, 'netTimeoutSeconds'),
      reopenSeconds: c.bounded(v['reopenSeconds'], `${path}.${k}.reopenSeconds`, 'reopenSeconds'),
      maxFailure: c.bounded(v['maxFailure'], `${path}.${k}.maxFailure`, 'maxFailure'),
    };
    if (v['affirm'] === 'AFFIRM' || v['affirm'] === 'NOAFFIRM') d.affirm = v['affirm'];
    out[memberId(k)] = d;
  }
  return out;
}

function parseMembers(c: Ctx, raw: unknown, hostIds: ReadonlySet<string>): Member[] {
  const out: Member[] = [];
  const seen = new Set<string>();
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`members[${i}]`, 'not an object; dropped'); return; }
    const id = c.str(v['id'], `members[${i}].id`, '', 64);
    if (!id) { c.repaired(`members[${i}].id`, 'missing; dropped'); return; }
    if (seen.has(id)) { c.repaired(`members[${i}].id`, `duplicate ${id}; dropped`); return; }
    seen.add(id);
    const kind = c.oneOf(v['kind'], `members[${i}].kind`, ['database', 'farsync'] as const, 'database');
    const name = c.str(v['name'], `members[${i}].name`, id, 64);
    const base = {
      id: memberId(id),
      name,
      instances: parseInstances(c, v['instances'], `members[${i}].instances`, hostIds, id),
      connectIdentifier: c.str(v['connectIdentifier'], `members[${i}].connectIdentifier`, name, 256),
      enabled: c.bool(v['enabled'], `members[${i}].enabled`, true),
      dests: parseDests(c, v['dests'], `members[${i}].dests`),
      redoRoutes: parseRedoRoutes(c, v['redoRoutes'], `members[${i}].redoRoutes`, kind === 'farsync'),
      ...(v['routesObserved'] === true ? { routesObserved: true as const } : {}),
      logXptMode: c.oneOf(v['logXptMode'], `members[${i}].logXptMode`, XPT_MODES, 'ASYNC'),
    };
    if (base.instances.length === 0) {
      c.error(`members[${i}].instances`, `member ${id} has no instance on any known host`);
      return;
    }
    if (kind === 'farsync') {
      const fs: FarSyncMember = {
        ...base,
        kind: 'farsync',
        transportLagSeconds: c.bounded(v['transportLagSeconds'], `members[${i}].transportLagSeconds`, 'transportLagSeconds', 0),
      };
      out.push(fs);
      return;
    }
    const applyLag = c.bounded(v['applyLagSeconds'], `members[${i}].applyLagSeconds`, 'applyLagSeconds', 0);
    let transportLag = c.bounded(v['transportLagSeconds'], `members[${i}].transportLagSeconds`, 'transportLagSeconds', 0);
    if (transportLag > applyLag) {
      /* Applied redo must have arrived first, so the transport lag can never
         exceed the apply lag. */
      c.repaired(`members[${i}].transportLagSeconds`, `clamped to the apply lag (${applyLag} s)`);
      transportLag = applyLag;
    }
    const db: DatabaseMember = {
      ...base,
      kind: 'database',
      role: c.oneOf(v['role'], `members[${i}].role`, DB_ROLES, 'physical'),
      flashbackOn: c.bool(v['flashbackOn'], `members[${i}].flashbackOn`, false),
      applyLagSeconds: applyLag,
      transportLagSeconds: transportLag,
      applyRunning: c.bool(v['applyRunning'], `members[${i}].applyRunning`, true),
      realTimeApply: c.bool(v['realTimeApply'], `members[${i}].realTimeApply`, true),
      openMode: c.oneOf(v['openMode'], `members[${i}].openMode`, OPEN_MODES, 'mount'),
      staticServices: c.bool(v['staticServices'], `members[${i}].staticServices`, false),
    };
    out.push(db);
  });

  const primaries = out.filter((m) => m.kind === 'database' && m.role === 'primary');
  if (primaries.length > 1) {
    c.error('members', `${primaries.length} members carry the primary role; exactly one may`);
  }
  return out;
}

function parseObservers(c: Ctx, raw: unknown, hostIds: ReadonlySet<string>): Observer[] {
  const out: Observer[] = [];
  const seen = new Set<string>();
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`observers[${i}]`, 'not an object; dropped'); return; }
    const id = c.str(v['id'], `observers[${i}].id`, '', 64);
    if (!id) { c.repaired(`observers[${i}].id`, 'missing; dropped'); return; }
    if (seen.has(id)) { c.repaired(`observers[${i}].id`, `duplicate ${id}; dropped`); return; }
    const host = c.str(v['host'], `observers[${i}].host`, '', 64);
    if (!hostIds.has(host)) {
      c.error(`observers[${i}].host`, `observer ${id} names host ${host || '(none)'}, which does not exist`);
      return;
    }
    seen.add(id);
    const o: Observer = {
      id: observerId(id),
      name: c.str(v['name'], `observers[${i}].name`, id, 64),
      host: hostId(host),
      role: c.oneOf(v['role'], `observers[${i}].role`, ['master', 'backup'] as const, 'master'),
      running: c.bool(v['running'], `observers[${i}].running`, true),
    };
    /* START OBSERVER ... FILE IS f LOGFILE IS l -- never FILE=. */
    const fileIs = typeof v['fileIs'] === 'string' ? v['fileIs'].trim() : '';
    if (fileIs) o.fileIs = fileIs.slice(0, 256);
    const logfileIs = typeof v['logfileIs'] === 'string' ? v['logfileIs'].trim() : '';
    if (logfileIs) o.logfileIs = logfileIs.slice(0, 256);
    const ci = typeof v['connectIdentifier'] === 'string' ? v['connectIdentifier'].trim() : '';
    if (ci) o.connectIdentifier = ci.slice(0, 256);
    out.push(o);
  });
  return out;
}

function parseFsfo(
  c: Ctx, raw: unknown, edition: Edition, memberIds: ReadonlySet<string>, hostIds: ReadonlySet<string>,
): FsfoConfig {
  const d = defaultFsfo(edition);
  if (!isObj(raw)) return d;
  const targetRaw = raw['target'];
  let target = d.target;
  if (isObj(targetRaw)) {
    if (targetRaw['kind'] === 'ANY') target = { kind: 'ANY' };
    else {
      const list = asArray(targetRaw['members'])
        .filter((m): m is string => typeof m === 'string');
      const kept: MemberId[] = [];
      for (const m of list) {
        if (!memberIds.has(m)) {
          c.error('config.fsfo.target.members', `${m} is not a member of this configuration`);
          continue;
        }
        kept.push(memberId(m));
      }
      target = { kind: 'list', members: kept };
    }
  }

  const pingIntervalRaw = raw['pingIntervalMs'];
  const pingRetryRaw = raw['pingRetry'];
  const pingIntervalMs = pingIntervalRaw === null || pingIntervalRaw === undefined
    ? null : c.bounded(pingIntervalRaw, 'config.fsfo.pingIntervalMs', 'pingIntervalMs');
  const pingRetry = pingRetryRaw === null || pingRetryRaw === undefined
    ? null : c.bounded(pingRetryRaw, 'config.fsfo.pingRetry', 'pingRetry');

  const out: FsfoConfig = {
    state: c.oneOf(raw['state'], 'config.fsfo.state', ['disabled', 'enabled', 'observe-only'] as const, d.state),
    target,
    thresholdSeconds: c.bounded(raw['thresholdSeconds'], 'config.fsfo.thresholdSeconds', 'thresholdSeconds'),
    lagLimitSeconds: c.num(raw['lagLimitSeconds'], 'config.fsfo.lagLimitSeconds', d.lagLimitSeconds, 0, BOUNDS.lagLimitSeconds.max),
    lagType: c.oneOf(raw['lagType'], 'config.fsfo.lagType', ['APPLY', 'TRANSPORT'] as const, d.lagType),
    lagGraceTimeSeconds: c.bounded(raw['lagGraceTimeSeconds'], 'config.fsfo.lagGraceTimeSeconds', 'lagGraceTimeSeconds'),
    pingIntervalMs,
    pingRetry,
    pmyShutdown: c.bool(raw['pmyShutdown'], 'config.fsfo.pmyShutdown', d.pmyShutdown),
    autoReinstate: c.bool(raw['autoReinstate'], 'config.fsfo.autoReinstate', d.autoReinstate),
  };
  /* A non-zero lag limit below the documented 5 s minimum is not a legal
     setting; 0 is the 26ai maximum availability default and stays. */
  if (out.lagLimitSeconds > 0 && out.lagLimitSeconds < BOUNDS.lagLimitSeconds.min) {
    c.repaired('config.fsfo.lagLimitSeconds', `raised to the documented ${BOUNDS.lagLimitSeconds.min} s minimum`);
    out.lagLimitSeconds = BOUNDS.lagLimitSeconds.min;
  }
  if (typeof raw['observerReconnectSeconds'] === 'number') {
    out.observerReconnectSeconds = Math.max(0, raw['observerReconnectSeconds']);
  }
  if (typeof raw['observerConnectIdentifier'] === 'string') {
    out.observerConnectIdentifier = raw['observerConnectIdentifier'].trim().slice(0, 256);
  }
  const poh = asArray(raw['preferredObserverHosts']);
  if (poh.length > 0) {
    const kept: FsfoConfig['preferredObserverHosts'] = [];
    poh.forEach((v, i) => {
      if (!isObj(v)) return;
      const h = typeof v['host'] === 'string' ? v['host'] : '';
      if (!hostIds.has(h)) {
        c.repaired(`config.fsfo.preferredObserverHosts[${i}].host`, `${h || '(none)'} is not a host; dropped`);
        return;
      }
      const p = parseRoutePriority(c, v['priority'], `config.fsfo.preferredObserverHosts[${i}].priority`) ?? 8;
      kept.push({ host: hostId(h), priority: p });
    });
    if (kept.length > 0) out.preferredObserverHosts = kept;
  }
  return out;
}

function parseServices(c: Ctx, raw: unknown, memberIds: ReadonlySet<string>): ServiceDef[] {
  const out: ServiceDef[] = [];
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`config.services[${i}]`, 'not an object; dropped'); return; }
    const name = c.str(v['name'], `config.services[${i}].name`, '', 64);
    if (!name) return;
    const members = asArray(v['members'])
      .filter((m): m is string => typeof m === 'string' && memberIds.has(m))
      .map(memberId);
    out.push({
      name,
      role: c.oneOf(v['role'], `config.services[${i}].role`,
        ['PRIMARY', 'PHYSICAL_STANDBY', 'SNAPSHOT_STANDBY'] as const, 'PRIMARY'),
      members,
    });
  });
  return out;
}

function parseConfiguration(
  c: Ctx, raw: unknown, edition: Edition,
  memberIds: ReadonlySet<string>, hostIds: ReadonlySet<string>,
): Configuration {
  const d = defaultConfiguration(edition);
  if (!isObj(raw)) return d;
  const out: Configuration = {
    name: c.str(raw['name'], 'config.name', d.name, 64),
    edition,
    protectionMode: c.oneOf(raw['protectionMode'], 'config.protectionMode', MODES, d.protectionMode),
    bystandersFollowRoleChange: c.oneOf(raw['bystandersFollowRoleChange'],
      'config.bystandersFollowRoleChange', ['ALL', 'NONE'] as const, d.bystandersFollowRoleChange),
    fsfo: parseFsfo(c, raw['fsfo'], edition, memberIds, hostIds),
    services: parseServices(c, raw['services'], memberIds),
    /* v1 models ObserverOverride = FALSE, the broker default, and says so
       wherever an outcome is asserted. */
    observerOverride: false,
  };
  if (raw['observerOverride'] === true) {
    c.repaired('config.observerOverride',
      'this engine models ObserverOverride = FALSE, the broker default, only');
  }
  const cwsn = typeof raw['configurationWideServiceName'] === 'string'
    ? raw['configurationWideServiceName'].trim() : '';
  if (cwsn) out.configurationWideServiceName = cwsn.slice(0, 128);
  const pdc = asArray(raw['primaryDatabaseCandidates'])
    .filter((m): m is string => typeof m === 'string' && memberIds.has(m))
    .map(memberId);
  if (pdc.length > 0) out.primaryDatabaseCandidates = pdc;
  return out;
}

function parseClient(c: Ctx, raw: unknown, hostIds: ReadonlySet<string>): ClientDescriptor {
  const d = defaultClient();
  if (!isObj(raw)) return d;
  const addresses: ClientDescriptor['addresses'] = [];
  asArray(raw['addresses']).forEach((v, i) => {
    if (!isObj(v)) return;
    const h = typeof v['host'] === 'string' ? v['host'] : '';
    if (!hostIds.has(h)) {
      c.repaired(`client.addresses[${i}].host`, `${h || '(none)'} is not a host; dropped`);
      return;
    }
    addresses.push({
      host: hostId(h),
      port: c.bounded(v['port'], `client.addresses[${i}].port`, 'listenerPort'),
    });
  });
  const ctRaw = raw['connectTimeoutSeconds'];
  return {
    serviceName: c.str(raw['serviceName'], 'client.serviceName', d.serviceName, 128),
    addresses,
    transportConnectTimeoutSeconds: c.bounded(raw['transportConnectTimeoutSeconds'],
      'client.transportConnectTimeoutSeconds', 'transportConnectTimeoutSeconds'),
    connectTimeoutSeconds: ctRaw === null || ctRaw === undefined
      ? null
      : c.bounded(ctRaw, 'client.connectTimeoutSeconds', 'connectTimeoutSeconds'),
    retryCount: c.bounded(raw['retryCount'], 'client.retryCount', 'retryCount'),
    retryDelaySeconds: c.bounded(raw['retryDelaySeconds'], 'client.retryDelaySeconds', 'retryDelaySeconds'),
    failover: c.bool(raw['failover'], 'client.failover', d.failover),
    loadBalance: c.bool(raw['loadBalance'], 'client.loadBalance', d.loadBalance),
    deadBehaviour: c.oneOf(raw['deadBehaviour'], 'client.deadBehaviour', ['drop', 'rst'] as const, d.deadBehaviour),
  };
}

/**
 * The application card. Absent stays absent: a document written before the
 * card existed keeps dialling from outside every data centre, which is what
 * its numbers were computed for.
 */
function parseApplication(
  c: Ctx, raw: unknown, hostIds: ReadonlySet<string>,
): Application | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) { c.repaired('application', 'not an object; dropped'); return undefined; }
  const id = c.str(raw['id'], 'application.id', '', 64);
  if (!id) { c.repaired('application.id', 'missing; dropped'); return undefined; }
  const host = c.str(raw['host'], 'application.host', '', 64);
  if (!hostIds.has(host)) {
    c.repaired('application.host', `${host || '(none)'} is not a host; the application was dropped`);
    return undefined;
  }
  return {
    id: applicationId(id),
    name: c.str(raw['name'], 'application.name', id, 64),
    host: hostId(host),
  };
}

function parseEnvironment(c: Ctx, raw: unknown): EnvironmentParams {
  const d = defaultEnvironment();
  if (!isObj(raw)) return d;
  return {
    roleTransitionSeconds: c.bounded(raw['roleTransitionSeconds'], 'environment.roleTransitionSeconds', 'roleTransitionSeconds'),
    localWriteMs: c.bounded(raw['localWriteMs'], 'environment.localWriteMs', 'localWriteMs'),
    standbyWriteMs: c.bounded(raw['standbyWriteMs'], 'environment.standbyWriteMs', 'standbyWriteMs'),
    redoRateMBs: c.bounded(raw['redoRateMBs'], 'environment.redoRateMBs', 'redoRateMBs'),
  };
}

interface EventRefs {
  hostIds: ReadonlySet<string>;
  siteIds: ReadonlySet<string>;
  memberIds: ReadonlySet<string>;
  links: readonly Link[];
  observers: readonly Observer[];
}

function parseEvents(c: Ctx, raw: unknown, refs: EventRefs): TimedEvent[] {
  const out: TimedEvent[] = [];
  const linkIds = new Set<string>(refs.links.map((l) => l.id as string));
  const observerIds = new Set<string>(refs.observers.map((o) => o.id as string));
  asArray(raw).forEach((v, i) => {
    if (!isObj(v)) { c.repaired(`events[${i}]`, 'not an object; dropped'); return; }
    const at = c.num(v['at'], `events[${i}].at`, 0, 0, 86400);
    const kind = typeof v['kind'] === 'string' ? v['kind'] : '';
    const s = (k: string): string => (typeof v[k] === 'string' ? (v[k] as string) : '');
    const drop = (why: string): void => { c.repaired(`events[${i}]`, why); };
    switch (kind) {
      case 'host.down': case 'host.up': {
        if (!refs.hostIds.has(s('host'))) { drop(`unknown host ${s('host')}; dropped`); return; }
        out.push({ at, kind, host: hostId(s('host')) });
        return;
      }
      case 'site.down': case 'site.up': {
        if (!refs.siteIds.has(s('site'))) { drop(`unknown site ${s('site')}; dropped`); return; }
        out.push({ at, kind, site: siteId(s('site')) });
        return;
      }
      case 'link.cut': case 'link.heal': {
        if (!linkIds.has(s('link'))) { drop(`unknown link ${s('link')}; dropped`); return; }
        out.push({ at, kind, link: linkId(s('link')) });
        return;
      }
      case 'partition': {
        const groups = asArray(v['groups'])
          .map((g) => asArray(g).filter((h): h is string => typeof h === 'string' && refs.hostIds.has(h)).map(hostId))
          .filter((g) => g.length > 0);
        if (groups.length < 2) { drop('a partition needs at least two groups; dropped'); return; }
        out.push({ at, kind: 'partition', groups });
        return;
      }
      case 'instance.down': case 'instance.up': {
        if (!refs.memberIds.has(s('member'))) { drop(`unknown member ${s('member')}; dropped`); return; }
        out.push({ at, kind, member: memberId(s('member')), instance: s('instance') });
        return;
      }
      case 'member.down': case 'member.up': case 'cmd.reinstate': {
        if (!refs.memberIds.has(s('member'))) { drop(`unknown member ${s('member')}; dropped`); return; }
        out.push({ at, kind, member: memberId(s('member')) });
        return;
      }
      case 'observer.stop': case 'observer.start': case 'cmd.setMasterObserver': {
        if (!observerIds.has(s('observer'))) { drop(`unknown observer ${s('observer')}; dropped`); return; }
        out.push({ at, kind, observer: observerId(s('observer')) });
        return;
      }
      case 'cmd.switchover': {
        if (!refs.memberIds.has(s('to'))) { drop(`unknown member ${s('to')}; dropped`); return; }
        out.push({ at, kind: 'cmd.switchover', to: memberId(s('to')) });
        return;
      }
      case 'cmd.failover': {
        if (!refs.memberIds.has(s('to'))) { drop(`unknown member ${s('to')}; dropped`); return; }
        out.push(v['immediate'] === true
          ? { at, kind: 'cmd.failover', to: memberId(s('to')), immediate: true }
          : { at, kind: 'cmd.failover', to: memberId(s('to')) });
        return;
      }
      case 'cmd.disableFsfo': {
        out.push(v['force'] === true
          ? { at, kind: 'cmd.disableFsfo', force: true }
          : { at, kind: 'cmd.disableFsfo' });
        return;
      }
      case 'lag.set': {
        if (!refs.memberIds.has(s('member'))) { drop(`unknown member ${s('member')}; dropped`); return; }
        const e: TimedEvent = { at, kind: 'lag.set', member: memberId(s('member')) };
        if (typeof v['applyLag'] === 'number') {
          (e as { applyLag?: number }).applyLag = clamp('applyLagSeconds', v['applyLag']);
        }
        if (typeof v['transportLag'] === 'number') {
          (e as { transportLag?: number }).transportLag = clamp('transportLagSeconds', v['transportLag']);
        }
        out.push(e);
        return;
      }
      default:
        drop(`unknown event kind ${JSON.stringify(kind)}; dropped`);
    }
  });
  return out;
}
