/**
 * Backward compatibility with the published 1+1+1 workbench -- engine design
 * SS5.1 and SS5.2.
 *
 * `classicTopology` builds the exact deployment the published simulator draws
 * (three sites, a primary, a target standby, an observer on a host of its own)
 * out of the flat knob object that simulator carries, and `scenarioEvents`
 * turns its six scenario names into engine events. The M3 adapter composes
 * them with `simulate` so `site/test.mjs`'s 24-cell matrix runs against the
 * general engine unmodified.
 *
 * Nothing else in the engine imports this module.
 */

import { BOUNDS } from '../defaults';
import { hostId, linkId, memberId, observerId, siteId } from '../ids';
import type { Edition, HostId, MemberId, SiteId } from '../ids';
import type { TimedEvent } from '../types/events';
import type {
  DatabaseMember, Host, Link, Observer, ProtectionMode, Site, TopologyDoc, XptMode,
} from '../types/topology';
import { isDatabase } from '../types/topology';
import { defaultClient, defaultConfiguration, defaultEnvironment } from '../serialize/schema';
import type { Outcome, SimParams } from '../types/trace';
import { simulate } from '../sim/simulate';
import type { DataLossKind, EngineTrace, LagStall } from '../sim/simulate';
import { SW_CONVERT, SW_VERIFY } from '../sim/roles';

export type ClassicScenario =
  | 'crash' | 'isolated' | 'partition' | 'dc2down' | 'observer-lost' | 'switchover';

export type ClassicObserverLoc = 'none' | 'dc1' | 'dc2' | 'dc3';
export type ClassicMode = 'maxavail' | 'maxperf';

/** The published simulator's flat state, as one object. */
export interface ClassicKnobs {
  scenario?: ClassicScenario;
  observerLoc?: ClassicObserverLoc;
  version?: Edition;
  mode?: ClassicMode;
  threshold?: number;
  pingSet?: boolean;
  pingInterval?: number;
  pingRetry?: number;
  standbyLag?: number;
  transportLag?: number;
  lagLimit?: number;
  lagType?: 'apply' | 'transport';
  lagGraceTime?: number;
  lagPolicy?: 'zero' | 'bounded';
  roleTransition?: number;
  latency?: number;
  pmyShutdown?: boolean;
  /* deployment-side properties */
  logXptMode?: 'sync' | 'fastsync' | 'async';
  netTimeout?: number;
  reopen?: number;
  maxFailure?: number;
  localWrite?: number;
  sbWrite?: number;
  outage?: number;
  rate?: number;
  /* client connect descriptor */
  tct?: number;
  ct?: number;
  rc?: number;
  rd?: number;
  dead?: 'drop' | 'rst';
  /* identity (the chapter 4 deployment editor) */
  name?: string;
  dbPrimary?: string;
  dbStandby?: string;
  hostPrimary?: string;
  hostStandby?: string;
  hostObserver?: string;
  service?: string;
  port?: number;
  dc1?: string;
  dc2?: string;
  dc3?: string;
}

/** The published simulator's control defaults. */
export const CLASSIC_DEFAULTS = {
  scenario: 'crash',
  observerLoc: 'dc3',
  version: '19c',
  mode: 'maxavail',
  threshold: 30,
  pingSet: false,
  pingInterval: 100,
  pingRetry: 10,
  standbyLag: 10,
  transportLag: 2,
  lagLimit: 30,
  lagType: 'apply',
  lagGraceTime: 0,
  lagPolicy: 'zero',
  roleTransition: 15,
  latency: 0,
  pmyShutdown: true,
  logXptMode: 'sync',
  netTimeout: 30,
  reopen: 300,
  maxFailure: 0,
  localWrite: 2,
  sbWrite: 2,
  outage: 600,
  rate: 5,
  tct: 60,
  ct: 0,
  rc: 0,
  rd: 0,
  dead: 'drop',
  name: '',
  dbPrimary: 'prm01',
  dbStandby: 'sby01',
  hostPrimary: 'dc1-prm01',
  hostStandby: 'dc2-sby01',
  hostObserver: '',
  service: 'app_svc',
  port: 1521,
  dc1: 'DC 1',
  dc2: 'DC 2',
  dc3: 'DC 3',
} as const satisfies Required<Omit<ClassicKnobs, never>>;

/** Stable ids the adapter and the tests both reach for. */
export const CLASSIC_IDS = {
  siteDc1: siteId('dc1'),
  siteDc2: siteId('dc2'),
  siteDc3: siteId('dc3'),
  linkDc1Dc2: linkId('dc1-dc2'),
  linkDc1Dc3: linkId('dc1-dc3'),
  linkDc2Dc3: linkId('dc2-dc3'),
  primary: memberId('prm01'),
  standby: memberId('sby01'),
  observer: observerId('obs01'),
} as const;

const XPT: Record<'sync' | 'fastsync' | 'async', XptMode> = {
  sync: 'SYNC', fastsync: 'FASTSYNC', async: 'ASYNC',
};

const MODE: Record<ClassicMode, ProtectionMode> = {
  maxavail: 'MAXAVAILABILITY', maxperf: 'MAXPERFORMANCE',
};

/**
 * "Observer lost" is an armed configuration whose observer died. With no
 * observer deployed there is nothing to lose and fast-start failover was never
 * armed, so that one pairing is a plain crash -- the same coercion the
 * published rail performs.
 */
export function effectiveScenario(
  scenario: ClassicScenario, observerLoc: ClassicObserverLoc,
): ClassicScenario {
  return scenario === 'observer-lost' && observerLoc === 'none' ? 'crash' : scenario;
}

const clampTo = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export function classicTopology(o: ClassicKnobs = {}): TopologyDoc {
  const k = { ...CLASSIC_DEFAULTS, ...stripUndefined(o) };
  const edition = k.version;
  const loc = k.observerLoc;

  const sites: Site[] = [
    { id: CLASSIC_IDS.siteDc1, name: k.dc1 },
    { id: CLASSIC_IDS.siteDc2, name: k.dc2 },
    { id: CLASSIC_IDS.siteDc3, name: k.dc3 },
  ];

  const primaryHost = hostId(k.hostPrimary);
  const standbyHost = hostId(k.hostStandby);
  const observerHostId: HostId | null = loc === 'none'
    ? null
    : hostId(k.hostObserver.trim() !== '' ? k.hostObserver.trim() : `${loc}-obs01`);

  const hosts: Host[] = [
    { id: primaryHost, name: k.hostPrimary, site: CLASSIC_IDS.siteDc1, listenerPort: k.port },
    { id: standbyHost, name: k.hostStandby, site: CLASSIC_IDS.siteDc2, listenerPort: k.port },
  ];
  if (observerHostId) {
    /* Oracle's rule is that the observer never runs on a database server or
       cluster, which is why all four placements give it a host of its own and
       only the site varies. */
    hosts.push({
      id: observerHostId,
      name: observerHostId as string,
      site: siteId(loc === 'none' ? 'dc3' : loc),
      listenerPort: k.port,
    });
  }

  const rtt = clampTo(k.latency, BOUNDS.latencyMs.min, BOUNDS.latencyMs.max);
  const links: Link[] = [
    { id: CLASSIC_IDS.linkDc1Dc2, scope: 'site', ends: [CLASSIC_IDS.siteDc1, CLASSIC_IDS.siteDc2], rttMs: rtt, up: true },
    { id: CLASSIC_IDS.linkDc1Dc3, scope: 'site', ends: [CLASSIC_IDS.siteDc1, CLASSIC_IDS.siteDc3], rttMs: rtt, up: true },
    { id: CLASSIC_IDS.linkDc2Dc3, scope: 'site', ends: [CLASSIC_IDS.siteDc2, CLASSIC_IDS.siteDc3], rttMs: rtt, up: true },
  ];
  /* The published control is "the round trip between any two of the three
     hosts", so an observer sharing a data centre with a database still pays it
     on the hop the FAILOVER command crosses. That is a host-scope link, and no
     scenario cuts one -- the six of them cut sites and site links only. */
  if (observerHostId && (loc === 'dc1' || loc === 'dc2')) {
    const peer = loc === 'dc1' ? primaryHost : standbyHost;
    links.push({
      id: linkId(`${loc}-lan`), scope: 'host', ends: [observerHostId, peer], rttMs: rtt, up: true,
    });
  }

  const applyLag = clampTo(k.standbyLag, 0, BOUNDS.applyLagSeconds.max);
  /* Authored data, kept as authored. The published model gates on the
     transport lag in one place only -- the 26ai TRANSPORT readiness check in
     maximum performance mode -- and so does the engine: under SYNC or FASTSYNC
     the commit waits for the standby's acknowledgement, so a transport gap is
     not a state that transport can be in and the slider changes nothing. */
  const transportLag = clampTo(Math.min(k.transportLag, applyLag), 0, applyLag);

  const primary: DatabaseMember = {
    id: memberId(k.dbPrimary), kind: 'database', name: k.dbPrimary,
    instances: [{ name: k.dbPrimary, host: primaryHost }],
    connectIdentifier: k.dbPrimary, enabled: true,
    dests: {
      [memberId(k.dbStandby)]: {
        netTimeoutSeconds: k.netTimeout,
        reopenSeconds: k.reopen,
        maxFailure: k.maxFailure,
      },
    },
    /* The published deployment has no RedoRoutes at all: the NULL property,
       which is (LOCAL : ALL) at a primary. */
    redoRoutes: [],
    logXptMode: XPT[k.logXptMode],
    role: 'primary', flashbackOn: false,
    applyLagSeconds: 0, transportLagSeconds: 0,
    applyRunning: false, realTimeApply: false,
    openMode: 'read-write', staticServices: false,
  };

  const standby: DatabaseMember = {
    id: memberId(k.dbStandby), kind: 'database', name: k.dbStandby,
    instances: [{ name: k.dbStandby, host: standbyHost }],
    connectIdentifier: k.dbStandby, enabled: true,
    dests: {},
    redoRoutes: [],
    logXptMode: XPT[k.logXptMode],
    role: 'physical', flashbackOn: false,
    applyLagSeconds: applyLag, transportLagSeconds: transportLag,
    applyRunning: true, realTimeApply: true,
    openMode: 'mount', staticServices: false,
  };

  const observers: Observer[] = observerHostId
    ? [{
        id: CLASSIC_IDS.observer, name: 'obs01', host: observerHostId,
        role: 'master', running: true,
      }]
    : [];

  const config = defaultConfiguration(edition);
  config.name = k.name.trim() !== '' ? k.name.trim() : 'dg_config';
  config.protectionMode = MODE[k.mode];
  config.fsfo = {
    ...config.fsfo,
    /* No observer deployed means fast-start failover was never enabled -- a
       different state from unobserved, whose status is PRIMARY UNOBSERVED. */
    state: loc === 'none' ? 'disabled' : 'enabled',
    target: { kind: 'list', members: [standby.id] },
    thresholdSeconds: k.threshold,
    lagLimitSeconds: lagLimitFor(edition, k.mode, k.lagPolicy, k.lagLimit),
    /* The published page always carries an explicit lag limit -- its 26ai
       policy is already folded in by lagLimitFor -- so a migrated document
       says it was set, and never follows the reading edition's default. */
    lagLimitSet: true,
    lagType: k.lagType === 'transport' ? 'TRANSPORT' : 'APPLY',
    lagGraceTimeSeconds: k.lagGraceTime,
    pingIntervalMs: k.pingSet ? k.pingInterval : null,
    pingRetry: k.pingSet ? k.pingRetry : null,
    pmyShutdown: k.pmyShutdown,
  };

  const client = defaultClient();
  client.serviceName = k.service;
  client.addresses = [
    { host: primaryHost, port: k.port },
    { host: standbyHost, port: k.port },
  ];
  client.transportConnectTimeoutSeconds = k.tct;
  client.connectTimeoutSeconds = k.ct > 0 ? k.ct : null;
  client.retryCount = k.rc;
  client.retryDelaySeconds = k.rd;
  client.deadBehaviour = k.dead;

  const environment = defaultEnvironment();
  environment.roleTransitionSeconds = k.roleTransition;
  environment.localWriteMs = k.localWrite;
  environment.standbyWriteMs = k.sbWrite;
  environment.redoRateMBs = k.rate;

  const doc: TopologyDoc = {
    app: 'dg-topology', schema: 2,
    sites, hosts, links,
    members: [primary, standby],
    observers,
    config, client, environment,
    events: [],
  };
  doc.events = scenarioEvents(effectiveScenario(k.scenario, loc), doc);
  return doc;
}

/**
 * 26ai gave FastStartFailoverLagLimit a maximum availability role: 0 is the
 * broker default there and means zero data loss, a non-zero value makes the
 * mode bounded-loss. Under 19c the limit is a maximum performance property, so
 * the knob is carried through untouched.
 */
function lagLimitFor(
  edition: Edition, mode: ClassicMode, policy: 'zero' | 'bounded', lagLimit: number,
): number {
  if (mode !== 'maxavail') return lagLimit;
  if (edition !== '26ai') return lagLimit;
  return policy === 'bounded' ? lagLimit : 0;
}

/* ---------------- scenarios ---------------- */

export function scenarioEvents(scenario: ClassicScenario, doc: TopologyDoc): TimedEvent[] {
  const primary = doc.members.find((m) => isDatabase(m) && m.role === 'primary');
  const primaryHost = primary?.instances[0]?.host;
  const primarySite = siteOf(doc, primaryHost);
  const target = firstTarget(doc);
  const targetHost = target ? doc.members.find((m) => m.id === target)?.instances[0]?.host : undefined;
  const targetSite = siteOf(doc, targetHost);
  const observerHost = doc.observers[0]?.host;

  switch (scenario) {
    case 'crash':
      return primaryHost ? [{ at: 0, kind: 'host.down', host: primaryHost }] : [];
    case 'isolated': {
      /* Every link that touches the primary's site goes. */
      if (!primarySite) return [];
      return doc.links
        .filter((l) => l.scope === 'site' && (l.ends as [SiteId, SiteId]).includes(primarySite))
        .map((l) => ({ at: 0, kind: 'link.cut', link: l.id }) as TimedEvent);
    }
    case 'partition': {
      if (!primarySite || !targetSite) return [];
      const l = doc.links.find(
        (x) => x.scope === 'site'
          && (x.ends as [SiteId, SiteId]).includes(primarySite)
          && (x.ends as [SiteId, SiteId]).includes(targetSite),
      );
      return l ? [{ at: 0, kind: 'link.cut', link: l.id }] : [];
    }
    case 'dc2down':
      return targetSite ? [{ at: 0, kind: 'site.down', site: targetSite }] : [];
    case 'observer-lost':
      return observerHost ? [{ at: 0, kind: 'host.down', host: observerHost }] : [];
    case 'switchover':
      return target ? [{ at: 0, kind: 'cmd.switchover', to: target }] : [];
  }
}

function siteOf(doc: TopologyDoc, host: HostId | undefined): SiteId | undefined {
  if (!host) return undefined;
  return doc.hosts.find((h) => h.id === host)?.site;
}

/**
 * The candidate target the broker would walk to first: the order the property
 * lists them in. Never "the first viable one" -- that is not what the
 * documentation says.
 */
function firstTarget(doc: TopologyDoc): MemberId | undefined {
  const t = doc.config.fsfo.target;
  if (t.kind === 'list' && t.members.length > 0) return t.members[0];
  const standby = doc.members.find(
    (m) => isDatabase(m) && (m.role === 'physical' || m.role === 'logical'),
  );
  return standby?.id;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o) as [keyof T, T[keyof T]][]) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/* ==================================================================
   The M3 adapter: the published `computeFsfo` return object, produced
   by the general engine.
   ================================================================== */

/**
 * The published simulator's model object, field for field.
 *
 * Every branch of `computeFsfo` returns its own key set -- the switchover
 * branch carries the verify/convert bands, the no-failover branches carry no
 * gate lag -- and this reproduces that, so `site/test.mjs`'s deep comparisons
 * run against the general engine unmodified.
 */
export interface LegacyModel {
  outcome: Outcome;
  scenario: ClassicScenario;
  stalled: boolean;
  standbyGone: boolean;
  redoFlowing: boolean;
  pmyReachable: boolean;
  switchover: boolean;
  lagStall: LagStall | null;
  lagType: 'apply' | 'transport';
  observerLost: boolean;
  pingSet: boolean;
  detect: number | null;
  initiate: number | null;
  netHop: number;
  execStart: number | null;
  applyRemaining: number;
  tOpen: number | null;
  blocked: boolean;
  abort: number | null;
  dataLossKind: DataLossKind;
  dataLossSeconds: number;
  ifDiedNow: number | null;
  horizon: number;
  preRoll: number;
  tickStep: number;
  /* present only where the published branch carries them */
  gateLagSeconds?: number;
  verify?: number;
  convert?: number;
  tDown?: number | null;
  tConvertEnd?: number | null;
  downtime?: number | null;
  tRestartDraw?: number | null;
}

/**
 * Project a trace onto the published model object.
 *
 * `scenario` is the effective scenario the simulation was built from -- the
 * one coercion the published rail performs, an observer that was never
 * deployed cannot be lost -- and it is passed in because a trace has no idea
 * what the six scenario buttons were called.
 */
export function toLegacyModel(
  trace: EngineTrace, doc: TopologyDoc, opts: { scenario?: ClassicScenario } = {},
): LegacyModel {
  const f = trace.facts;
  const axis = trace.axis;
  const base = {
    outcome: f.outcome,
    scenario: opts.scenario ?? (f.outcome as ClassicScenario),
    stalled: f.conditions.stalled,
    standbyGone: f.conditions.standbyGone,
    redoFlowing: f.conditions.redoFlowing,
    pmyReachable: f.conditions.pmyReachable,
    lagStall: f.lagStall,
    lagType: (f.lagType === 'TRANSPORT' ? 'transport' : 'apply') as 'apply' | 'transport',
    switchover: f.outcome === 'switchover',
    observerLost: f.observerLost,
    pingSet: f.pingSet,
    horizon: axis.horizon,
    preRoll: axis.preRoll,
    tickStep: axis.tickStep,
  };
  /* The document is part of the published signature; every value in the object
     below already lives on the trace. */
  void doc;

  if (f.outcome === 'switchover') {
    const sw = f.switchover;
    return {
      ...base,
      detect: null, initiate: null, abort: null, execStart: null,
      /* The DGMGRL command's own network hop is left out on purpose: it is a
         fraction of the nominal verify band and would change no claim. */
      netHop: 0,
      verify: SW_VERIFY, convert: SW_CONVERT,
      tDown: sw?.tDown ?? null,
      tConvertEnd: sw?.tConvertEnd ?? null,
      tOpen: sw?.tOpen ?? null,
      downtime: sw?.downtime ?? null,
      tRestartDraw: sw?.tRestartDraw ?? null,
      applyRemaining: f.applyRemainingSeconds,
      blocked: f.blocked,
      gateLagSeconds: f.gateLagSeconds ?? 0,
      dataLossKind: f.dataLossKind, dataLossSeconds: f.dataLossSeconds,
      ifDiedNow: null,
    };
  }

  if (f.outcome === 'observer-lost') {
    return {
      ...base,
      detect: null, initiate: null, netHop: f.netHopSeconds, execStart: null,
      applyRemaining: 0, tOpen: null, blocked: false, abort: null,
      dataLossKind: f.dataLossKind, dataLossSeconds: f.dataLossSeconds,
      gateLagSeconds: f.gateLagSeconds ?? 0,
      ifDiedNow: f.ifDiedNow,
    };
  }

  if (f.outcome === 'failover') {
    return {
      ...base,
      detect: f.detectSeconds, initiate: f.initiateAt, netHop: f.netHopSeconds,
      execStart: f.execStartAt, applyRemaining: f.applyRemainingSeconds,
      tOpen: f.tOpen, blocked: f.blocked, abort: f.abortAt,
      dataLossKind: f.dataLossKind, dataLossSeconds: f.dataLossSeconds,
      gateLagSeconds: f.gateLagSeconds ?? 0,
      ifDiedNow: null,
    };
  }

  /* manual, stall-noone, maxprot-shutdown and continues share the failover
     shape with the clocks nulled out, because nothing is counting down to
     anything. (The published 1+1+1 deployment is never in maximum protection
     mode, so maxprot-shutdown cannot reach this adapter; it is listed here
     because the outcome union is shared, not because a cell produces it.) */
  return {
    ...base,
    detect: null, initiate: null, netHop: f.netHopSeconds, execStart: null,
    applyRemaining: 0, tOpen: null, blocked: false, abort: f.abortAt,
    dataLossKind: f.dataLossKind, dataLossSeconds: f.dataLossSeconds,
    ifDiedNow: f.ifDiedNow,
  };
}

/**
 * The three readings the published page keeps and the workbench no longer
 * shares (fact check 2026-09-28). `simulator/fsfo-simulator.html` is frozen,
 * and this adapter's job is to reproduce its `computeFsfo` number for number
 * -- `legacy-matrix.test.ts` and `legacy-fragment-parity.test.ts` hold it to
 * that -- so it asks the engine for that page's arithmetic by name:
 *
 *  - the ping properties take effect under 19c, where they do not exist
 *    (ED-01);
 *  - a primary that reaches neither the observer nor the target stalls even
 *    when the target was already past the lag limit, where Oracle has nothing
 *    left to confirm and lets it run (SIM-02);
 *  - what a manual failover loses in maximum performance mode is drawn as the
 *    apply lag (SIM-06).
 *
 * Nothing else passes these. A document built with `classicTopology` and run
 * through `simulate` directly gets the workbench's readings.
 */
export const PUBLISHED_PAGE: SimParams = {
  legacyPingUnder19c: true,
  legacyStallWhenNotReady: true,
  legacyManualLossIsApplyLag: true,
};

/**
 * `computeFsfo(c)` on the general engine: build the 1+1+1 deployment, turn the
 * scenario into events, simulate, and project the trace back onto the
 * published object.
 */
export function legacyComputeFsfo(c: ClassicKnobs = {}): LegacyModel {
  const knobs: ClassicKnobs = { ...stripUndefined(c) };
  const standbyLag = knobs.standbyLag ?? CLASSIC_DEFAULTS.standbyLag;

  /* `computeFsfo`'s own defaulting: a configuration written before the
     transport-lag slider existed carries no transport lag at all, and falls
     back to the apply lag -- which is exactly what the page gated on until
     then. */
  if (knobs.transportLag === undefined) knobs.transportLag = standbyLag;

  const loc = knobs.observerLoc ?? CLASSIC_DEFAULTS.observerLoc;
  const scenario = effectiveScenario(knobs.scenario ?? CLASSIC_DEFAULTS.scenario, loc);
  const doc = classicTopology({ ...knobs, scenario });

  /* The published workbench's transport-lag slider feeds exactly one gate: the
     26ai TRANSPORT readiness check in maximum performance mode. The engine
     reads it in the same one place -- a SYNC or FASTSYNC destination is
     synchronized because the commit waited for its acknowledgement, whatever
     the slider says -- so the document goes to the simulator as authored. */

  const trace = simulate(doc, doc.events, PUBLISHED_PAGE);
  return toLegacyModel(trace, doc, { scenario });
}
