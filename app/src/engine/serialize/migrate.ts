/**
 * Migration chain -- engine design SS1.7.
 *
 * Two legacy shapes come in: the published simulator's stored/exported
 * configuration (`{ v: 1, deployment, params, sim }`, localStorage key
 * `dg-fsfo-cfg-v1`) and its share-link query string, whose keys are the FIELDS
 * table below. Both land on the same `ClassicKnobs`, which `classicTopology`
 * turns into a schema-2 document.
 *
 * Everything numeric is clamped against the one BOUNDS table, unknown keys are
 * dropped and unknown radio tokens fall back to their default -- the published
 * page's own rule was "garbage is ignored, never guessed at".
 */

import { clamp } from '../defaults';
import type { BoundKey } from '../defaults';
import type { TopologyDoc } from '../types/topology';
import type { ClassicKnobs, ClassicMode, ClassicObserverLoc, ClassicScenario } from '../compat/classic';
import { CLASSIC_DEFAULTS, classicTopology, effectiveScenario } from '../compat/classic';
import { parseTopologyDoc } from './schema';
import type { ParseResult } from './schema';

/* ---------------- the legacy v1 configuration ---------------- */

export interface LegacyDeploymentV1 {
  name?: string;
  dbPrimary?: string; dbStandby?: string;
  hostPrimary?: string; hostStandby?: string; hostObserver?: string;
  service?: string; port?: number;
  dc1?: string; dc2?: string; dc3?: string;
  subPrimary?: string; subStandby?: string;
}

export interface LegacyParamsV1 {
  mode?: string; threshold?: number; pingSet?: boolean;
  pingInterval?: number; pingRetry?: number;
  lagLimit?: number; pmyShutdown?: boolean;
  lagType?: string; lagGraceTime?: number; lagPolicy?: string;
  logXptMode?: string; netTimeout?: number;
  reopen?: number; maxFailure?: number;
  tct?: number; ct?: number; rc?: number; rd?: number;
}

export interface LegacySimV1 {
  scenario?: string; observerLoc?: string;
  standbyLag?: number; transportLag?: number;
  roleTransition?: number; latency?: number;
  localWrite?: number; sbWrite?: number;
  outage?: number; rate?: number; dead?: string;
}

export interface LegacyConfigV1 {
  v: 1;
  deployment?: LegacyDeploymentV1;
  params?: LegacyParamsV1;
  sim?: LegacySimV1;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function isLegacyV1(raw: unknown): raw is LegacyConfigV1 {
  return isObj(raw) && raw['v'] === 1;
}

const SCENARIOS: ClassicScenario[] = ['crash', 'isolated', 'partition', 'dc2down', 'observer-lost', 'switchover'];
const LOCS: ClassicObserverLoc[] = ['none', 'dc1', 'dc2', 'dc3'];

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;

const text = (v: unknown, dflt: string, maxLen = 64): string => {
  if (typeof v !== 'string') return dflt;
  const t = v.trim();
  return t === '' ? dflt : t.slice(0, maxLen);
};

const bounded = (v: unknown, key: BoundKey, dflt: number): number =>
  v === undefined || v === null ? dflt : clamp(key, v, dflt);

/** The legacy config's whitelisted keys, clamped, as the classic knob object. */
export function legacyToKnobs(raw: unknown): ClassicKnobs {
  const cfg = isLegacyV1(raw) ? raw : ({ v: 1 } as LegacyConfigV1);
  const d = cfg.deployment ?? {};
  const p = cfg.params ?? {};
  const s = cfg.sim ?? {};
  const D = CLASSIC_DEFAULTS;

  const scenario = pick<ClassicScenario>(s.scenario, SCENARIOS, D.scenario);
  const observerLoc = pick<ClassicObserverLoc>(s.observerLoc, LOCS, D.observerLoc);

  const port = (() => {
    const n = typeof d.port === 'number' ? d.port : parseInt(String(d.port ?? ''), 10);
    return !isFinite(n) || n < 1 || n > 65535 ? D.port : Math.round(n);
  })();

  return {
    /* An older file carrying no placement lands on the third site, and the one
       pair the controls refuse to offer is refused here too. */
    scenario: effectiveScenario(scenario, observerLoc),
    observerLoc,
    mode: pick<ClassicMode>(p.mode, ['maxavail', 'maxperf'], D.mode),
    threshold: bounded(p.threshold, 'thresholdSeconds', D.threshold),
    pingSet: typeof p.pingSet === 'boolean' ? p.pingSet : D.pingSet,
    pingInterval: bounded(p.pingInterval, 'pingIntervalMs', D.pingInterval),
    pingRetry: bounded(p.pingRetry, 'pingRetry', D.pingRetry),
    lagLimit: bounded(p.lagLimit, 'lagLimitSeconds', D.lagLimit),
    pmyShutdown: typeof p.pmyShutdown === 'boolean' ? p.pmyShutdown : D.pmyShutdown,
    lagType: p.lagType === 'transport' ? 'transport' : 'apply',
    lagGraceTime: bounded(p.lagGraceTime, 'lagGraceTimeSeconds', D.lagGraceTime),
    /* A file written before this control existed carries no policy at all and
       lands on zero data loss, which is what the page always drew. */
    lagPolicy: p.lagPolicy === 'bounded' ? 'bounded' : 'zero',
    logXptMode: pick(p.logXptMode, ['sync', 'fastsync', 'async'] as const, D.logXptMode),
    netTimeout: bounded(p.netTimeout, 'netTimeoutSeconds', D.netTimeout),
    reopen: bounded(p.reopen, 'reopenSeconds', D.reopen),
    maxFailure: bounded(p.maxFailure, 'maxFailure', D.maxFailure),
    tct: bounded(p.tct, 'transportConnectTimeoutSeconds', D.tct),
    ct: bounded(p.ct, 'connectTimeoutSeconds', D.ct),
    rc: bounded(p.rc, 'retryCount', D.rc),
    rd: bounded(p.rd, 'retryDelaySeconds', D.rd),

    standbyLag: bounded(s.standbyLag, 'applyLagSeconds', D.standbyLag),
    transportLag: bounded(s.transportLag, 'transportLagSeconds', D.transportLag),
    roleTransition: bounded(s.roleTransition, 'roleTransitionSeconds', D.roleTransition),
    latency: bounded(s.latency, 'latencyMs', D.latency),
    localWrite: bounded(s.localWrite, 'localWriteMs', D.localWrite),
    sbWrite: bounded(s.sbWrite, 'standbyWriteMs', D.sbWrite),
    outage: bounded(s.outage, 'outageSeconds', D.outage),
    rate: bounded(s.rate, 'redoRateMBs', D.rate),
    dead: s.dead === 'rst' ? 'rst' : 'drop',

    name: text(d.name, D.name, 64),
    dbPrimary: text(d.dbPrimary, D.dbPrimary),
    dbStandby: text(d.dbStandby, D.dbStandby),
    hostPrimary: text(d.hostPrimary, D.hostPrimary),
    hostStandby: text(d.hostStandby, D.hostStandby),
    hostObserver: text(d.hostObserver, D.hostObserver),
    service: text(d.service, D.service),
    port,
    dc1: text(d.dc1, D.dc1),
    dc2: text(d.dc2, D.dc2),
    dc3: text(d.dc3, D.dc3),
  };
}

/** The v1 configuration as a schema-2 document. */
export function migrateV1(raw: unknown): TopologyDoc {
  return classicTopology(legacyToKnobs(raw));
}

/* ---------------- the legacy share-link query ---------------- */

interface LegacyRangeField {
  k: string;
  t: 'range';
  bound: BoundKey;
  to: (knobs: MutableKnobs, v: number) => void;
}
interface LegacyCheckField {
  k: string;
  t: 'check';
  to: (knobs: MutableKnobs, v: boolean) => void;
}
interface LegacyRadioField {
  k: string;
  t: 'radio';
  map: Record<string, string>;
  to: (knobs: MutableKnobs, token: string) => void;
}
type LegacyField = LegacyRangeField | LegacyCheckField | LegacyRadioField;

type MutableKnobs = Record<string, unknown>;

/**
 * The published page's FIELDS table, key for key. The URL keys are a public
 * contract -- they are hand-assigned and decoupled from element ids so an id
 * rename cannot break shared links -- so this table is copied, never rederived.
 * There is deliberately no key for the commit round trip (a second face of
 * `lat`) and none for the release, which the page carries as `ver`.
 */
export const LEGACY_URL_FIELDS: LegacyField[] = [
  { k: 'sc', t: 'radio', map: { crash: 'crash', iso: 'isolated', part: 'partition', dc2d: 'dc2down', obs: 'observer-lost', sw: 'switchover' }, to: (n, v) => { n['scenario'] = v; } },
  /* 'ol' is applied after 'sc', so a link naming both an impossible pair lands
     on the coercion the rail performs. */
  { k: 'ol', t: 'radio', map: { none: 'none', dc1: 'dc1', dc2: 'dc2', dc3: 'dc3' }, to: (n, v) => { n['observerLoc'] = v; } },
  { k: 'pm', t: 'radio', map: { avail: 'maxavail', perf: 'maxperf' }, to: (n, v) => { n['mode'] = v; } },
  { k: 'th', t: 'range', bound: 'thresholdSeconds', to: (n, v) => { n['threshold'] = v; } },
  { k: 'ps', t: 'check', to: (n, v) => { n['pingSet'] = v; } },
  { k: 'pi', t: 'range', bound: 'pingIntervalMs', to: (n, v) => { n['pingInterval'] = v; } },
  { k: 'pr', t: 'range', bound: 'pingRetry', to: (n, v) => { n['pingRetry'] = v; } },
  { k: 'lag', t: 'range', bound: 'applyLagSeconds', to: (n, v) => { n['standbyLag'] = v; } },
  { k: 'll', t: 'range', bound: 'lagLimitSeconds', to: (n, v) => { n['lagLimit'] = v; } },
  { k: 'rt', t: 'range', bound: 'roleTransitionSeconds', to: (n, v) => { n['roleTransition'] = v; } },
  { k: 'lat', t: 'range', bound: 'latencyMs', to: (n, v) => { n['latency'] = v; } },
  { k: 'sd', t: 'check', to: (n, v) => { n['pmyShutdown'] = v; } },
  { k: 'lt', t: 'radio', map: { apply: 'apply', transport: 'transport' }, to: (n, v) => { n['lagType'] = v; } },
  { k: 'tla', t: 'range', bound: 'transportLagSeconds', to: (n, v) => { n['transportLag'] = v; } },
  { k: 'lgt', t: 'range', bound: 'lagGraceTimeSeconds', to: (n, v) => { n['lagGraceTime'] = v; } },
  { k: 'lp', t: 'radio', map: { zero: 'zero', bounded: 'bounded' }, to: (n, v) => { n['lagPolicy'] = v; } },
  { k: 'xpt', t: 'radio', map: { sync: 'sync', fastsync: 'fastsync', async: 'async' }, to: (n, v) => { n['logXptMode'] = v; } },
  { k: 'lw', t: 'range', bound: 'localWriteMs', to: (n, v) => { n['localWrite'] = v; } },
  { k: 'sbw', t: 'range', bound: 'standbyWriteMs', to: (n, v) => { n['sbWrite'] = v; } },
  { k: 'rs', t: 'range', bound: 'reopenSeconds', to: (n, v) => { n['reopen'] = v; } },
  { k: 'mf', t: 'range', bound: 'maxFailure', to: (n, v) => { n['maxFailure'] = v; } },
  { k: 'og', t: 'range', bound: 'outageSeconds', to: (n, v) => { n['outage'] = v; } },
  { k: 'rr', t: 'range', bound: 'redoRateMBs', to: (n, v) => { n['rate'] = v; } },
  { k: 'tct', t: 'range', bound: 'transportConnectTimeoutSeconds', to: (n, v) => { n['tct'] = v; } },
  { k: 'ct', t: 'range', bound: 'connectTimeoutSeconds', to: (n, v) => { n['ct'] = v; } },
  { k: 'rc', t: 'range', bound: 'retryCount', to: (n, v) => { n['rc'] = v; } },
  { k: 'rd', t: 'range', bound: 'retryDelaySeconds', to: (n, v) => { n['rd'] = v; } },
  { k: 'da', t: 'radio', map: { drop: 'drop', rst: 'rst' }, to: (n, v) => { n['dead'] = v; } },
];

/** Split a query string without touching any host global. */
export function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = query.startsWith('?') ? query.slice(1) : query;
  for (const part of q.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawVal = eq < 0 ? '' : part.slice(eq + 1);
    const key = safeDecode(rawKey);
    if (key === '') continue;
    out[key] = safeDecode(rawVal.replace(/\+/g, ' '));
  }
  return out;
}

const safeDecode = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; }
};

/** A legacy share link (the `?sc=...&ol=...` form) as classic knobs. */
export function legacyQueryToKnobs(query: string | Record<string, string>): ClassicKnobs {
  const vals = typeof query === 'string' ? parseQuery(query) : query;
  const knobs: MutableKnobs = { ...CLASSIC_DEFAULTS };
  for (const f of LEGACY_URL_FIELDS) {
    const raw = vals[f.k];
    if (raw === undefined) continue;
    if (f.t === 'range') {
      const n = Number(raw);
      if (!isFinite(n)) continue;         /* garbage is ignored, never guessed at */
      f.to(knobs, clamp(f.bound, n));
    } else if (f.t === 'check') {
      if (raw !== '0' && raw !== '1') continue;
      f.to(knobs, raw === '1');
    } else {
      const token = f.map[raw];
      if (token === undefined) continue;
      f.to(knobs, token);
    }
  }
  const k = knobs as ClassicKnobs;
  k.scenario = effectiveScenario(
    k.scenario ?? CLASSIC_DEFAULTS.scenario,
    k.observerLoc ?? CLASSIC_DEFAULTS.observerLoc,
  );
  return k;
}

export function migrateLegacyQuery(query: string | Record<string, string>): TopologyDoc {
  return classicTopology(legacyQueryToKnobs(query));
}

/** Write classic knobs back out as a legacy share query -- non-defaults only. */
export function knobsToLegacyQuery(knobs: ClassicKnobs): string {
  const k = { ...CLASSIC_DEFAULTS, ...knobs } as unknown as MutableKnobs;
  const d = CLASSIC_DEFAULTS as unknown as MutableKnobs;
  const parts: string[] = [];
  for (const f of LEGACY_URL_FIELDS) {
    const probe: MutableKnobs = {};
    if (f.t === 'range') {
      f.to(probe, 0);
      const key = Object.keys(probe)[0] as string;
      if (k[key] === d[key]) continue;
      parts.push(`${f.k}=${String(k[key])}`);
    } else if (f.t === 'check') {
      f.to(probe, true);
      const key = Object.keys(probe)[0] as string;
      if (k[key] === d[key]) continue;
      parts.push(`${f.k}=${k[key] ? '1' : '0'}`);
    } else {
      const first = Object.values(f.map)[0];
      f.to(probe, String(first));
      const key = Object.keys(probe)[0] as string;
      if (k[key] === d[key]) continue;
      const token = Object.keys(f.map).find((t) => f.map[t] === k[key]);
      if (token === undefined) continue;
      parts.push(`${f.k}=${token}`);
    }
  }
  return parts.join('&');
}

/* ---------------- the chain ---------------- */

export type MigrationSource = 'schema-2' | 'legacy-v1' | 'legacy-query' | 'unknown';

export interface MigrationResult extends ParseResult {
  from: MigrationSource;
}

/**
 * The ordered chain: a schema-2 document validates as it stands, a `{ v: 1 }`
 * object migrates through `migrateV1`, and anything else fails with issues
 * rather than a guess.
 */
export function migrate(raw: unknown): MigrationResult {
  if (isObj(raw) && raw['app'] === 'dg-topology' && raw['schema'] === 2) {
    return { ...parseTopologyDoc(raw), from: 'schema-2' };
  }
  if (isLegacyV1(raw)) {
    const doc = migrateV1(raw);
    return { ...parseTopologyDoc(doc), from: 'legacy-v1' };
  }
  if (typeof raw === 'string') {
    const doc = migrateLegacyQuery(raw);
    return { ...parseTopologyDoc(doc), from: 'legacy-query' };
  }
  return {
    ok: false, doc: null, from: 'unknown',
    issues: [{ path: '', message: 'unrecognised configuration shape', severity: 'error' }],
  };
}
