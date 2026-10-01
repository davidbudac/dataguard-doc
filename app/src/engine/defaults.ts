/**
 * One bounds table and the broker defaults per edition.
 *
 * BOUNDS is the single source of numeric truth: the serializer clamps against
 * it, the migration clamps against it, and the DOM reads its min/max/step off
 * it rather than carrying ranges of its own (engine design SS1.7).
 *
 * Every range mirrors the published simulator's control, except where a range
 * is deliberately wider in the new app; those are marked. Oracle documents a
 * floor for most of these and almost never a ceiling (ED-12: "Integral number
 * of seconds. Must be greater than, or equal to, 6" for the threshold, ">= 5"
 * for the lag limit, 0 or more for ApplyInstanceTimeout, and RETRY_COUNT
 * "greater than 100" in the HA guide's own advice for a long switchover), so a
 * maximum here is this page's ceiling for the control and never Oracle's. The
 * floors are Oracle's.
 */

import type { Edition, Millis, Seconds } from './ids';
import type { Claim } from './types/claims';
import { conflict, docLater, documented } from './types/claims';
import type { Configuration, FsfoConfig, LagType, ProtectionMode, XptMode } from './types/topology';

export interface Bound {
  min: number;
  max: number;
  step: number;
  /** The value a fresh document starts from. */
  default: number;
  unit: 's' | 'ms' | 'count' | 'MB/s' | 'port';
  label: string;
}

export const BOUNDS = {
  /* ---- fast-start failover ---- */
  /* Wider than the published simulator's 6-120 and 5-90. Oracle gives a floor
     only (>= 6, >= 5); an hour is this page's ceiling, high enough that no
     documented setting is out of reach. */
  thresholdSeconds: { min: 6, max: 3600, step: 1, default: 30, unit: 's', label: 'FastStartFailoverThreshold' },
  lagLimitSeconds: { min: 5, max: 3600, step: 1, default: 30, unit: 's', label: 'FastStartFailoverLagLimit' },
  lagGraceTimeSeconds: { min: 0, max: 60, step: 5, default: 0, unit: 's', label: 'FastStartFailoverLagGraceTime' },
  pingIntervalMs: { min: 100, max: 5000, step: 100, default: 100, unit: 'ms', label: 'ObserverPingInterval' },
  pingRetry: { min: 10, max: 50, step: 1, default: 10, unit: 'count', label: 'ObserverPingRetry' },

  /* ---- simulated conditions ---- */
  applyLagSeconds: { min: 0, max: 90, step: 1, default: 10, unit: 's', label: 'apply lag' },
  transportLagSeconds: { min: 0, max: 90, step: 1, default: 2, unit: 's', label: 'transport lag' },
  roleTransitionSeconds: { min: 5, max: 60, step: 1, default: 15, unit: 's', label: 'role transition' },
  latencyMs: { min: 0, max: 100, step: 1, default: 0, unit: 'ms', label: 'round-trip latency' },
  outageSeconds: { min: 60, max: 1800, step: 30, default: 600, unit: 's', label: 'outage length' },
  redoRateMBs: { min: 1, max: 50, step: 1, default: 5, unit: 'MB/s', label: 'redo rate' },

  /* ---- destination attributes ---- */
  /* Wider than the published simulator's 1-120: the NET_TIMEOUT attribute page
     and the broker property page both print 1200 (or 0) to 1200. The floor
     stays at the attribute page's 1; the property page's 0 is the disagreement
     BROKER.NET_TIMEOUT_PROPERTY names. */
  netTimeoutSeconds: { min: 1, max: 1200, step: 1, default: 30, unit: 's', label: 'NetTimeout' },
  /* Wider than the published simulator's 30-900: the new app lets a destination
     sit out a full hour. The 30 s floor is unchanged and deliberate -- the
     meaning of REOPEN = 0 is not documented, so the slider never offers it. */
  reopenSeconds: { min: 30, max: 3600, step: 15, default: 300, unit: 's', label: 'ReopenSecs' },
  /* Wider than the published simulator's 0-10. 0 stays "unlimited". */
  maxFailure: { min: 0, max: 20, step: 1, default: 0, unit: 'count', label: 'MaxFailure' },

  /* ---- RAC standby ---- */
  /* The broker default is 0, "immediate apply instance failover"; the ceiling
     is this page's, not Oracle's -- the property takes any value >= 0, in whole
     seconds, so the step is 1 (it was 5, and a typed 7 was stored as 5). */
  applyInstanceTimeoutSeconds: { min: 0, max: 3600, step: 1, default: 0, unit: 's', label: 'ApplyInstanceTimeout' },

  /* ---- commit anatomy ---- */
  localWriteMs: { min: 0, max: 25, step: 1, default: 2, unit: 'ms', label: 'local redo write' },
  standbyWriteMs: { min: 0, max: 25, step: 1, default: 2, unit: 'ms', label: 'standby redo log write' },

  /* ---- client connect descriptor ---- */
  /* The default is 60 s, so a ceiling of 60 left nothing above it to set. Whole
     seconds: a value below one second is not drawn. */
  transportConnectTimeoutSeconds: { min: 1, max: 600, step: 1, default: 60, unit: 's', label: 'TRANSPORT_CONNECT_TIMEOUT' },
  connectTimeoutSeconds: { min: 0, max: 120, step: 1, default: 0, unit: 's', label: 'CONNECT_TIMEOUT' },
  /* "If you need more time to complete a Data Guard switchover, then change
     RETRY_COUNT greater than 100." (HA guide, connection time estimates). */
  retryCount: { min: 0, max: 1000, step: 1, default: 0, unit: 'count', label: 'RETRY_COUNT' },
  retryDelaySeconds: { min: 0, max: 30, step: 1, default: 0, unit: 's', label: 'RETRY_DELAY' },

  /* ---- identity ---- */
  listenerPort: { min: 1, max: 65535, step: 1, default: 1521, unit: 'port', label: 'listener port' },
} as const satisfies Record<string, Bound>;

export type BoundKey = Extract<keyof typeof BOUNDS, string>;

export const boundOf = (key: BoundKey): Bound => BOUNDS[key];

/**
 * The four connect-string timing parameters as one set: what the "Defaults" and
 * "Tuned" buttons on the application's controls write in a single edit.
 * `connectTimeoutSeconds` is null for "not set", as on `ClientDescriptor`.
 */
export interface ClientTiming {
  transportConnectTimeoutSeconds: number;
  connectTimeoutSeconds: number | null;
  retryCount: number;
  retryDelaySeconds: number;
}

/** The parameters' own defaults -- CLIENT.TIMEOUTS, CLIENT.RETRY_AND_FAILOVER in citations.ts. */
export const CLIENT_TIMING_DEFAULTS: ClientTiming = {
  transportConnectTimeoutSeconds: BOUNDS.transportConnectTimeoutSeconds.default,
  connectTimeoutSeconds: null,
  retryCount: BOUNDS.retryCount.default,
  retryDelaySeconds: BOUNDS.retryDelaySeconds.default,
};

/**
 * A tuned connect string: a short TRANSPORT_CONNECT_TIMEOUT, a generous
 * CONNECT_TIMEOUT, and short delays times many retries. The shape is the one the
 * published fragment's "Tuned" button applies (`APP_TUNED`), itself a reading of
 * the 19c HA overview's example connect string. What is documented is only part
 * of it: that guide's example uses CONNECT_TIMEOUT=90 and prices a switchover
 * budget as RETRY_COUNT x RETRY_DELAY (CLIENT.TIMEOUTS,
 * CLIENT.SWITCHOVER_BUDGET_100X3 in citations.ts). The other numbers here -- 3 s
 * for the transport timeout, 30 retries at 3 s, a 90 s budget -- are this page's
 * suggested shape, not figures Oracle prints, and the UI says so.
 */
export const CLIENT_TIMING_TUNED: ClientTiming = {
  transportConnectTimeoutSeconds: 3,
  connectTimeoutSeconds: 90,
  retryCount: 30,
  retryDelaySeconds: 3,
};

/**
 * Clamp to a bound the way the published simulator's `clampToEl` does: snap to
 * the step grid first, then clamp to the range, and fall back to `dflt` (the
 * bound's own default unless the caller supplies one) on anything unparseable.
 */
export function clamp(key: BoundKey, value: unknown, dflt?: number): number {
  const b = BOUNDS[key];
  const fallback = dflt === undefined ? b.default : dflt;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!isFinite(n)) return fallback;
  let v = n;
  if (b.step > 0) v = Math.round(v / b.step) * b.step;
  if (v < b.min) v = b.min;
  if (v > b.max) v = b.max;
  /* Steps like 15 on a 30-floor range can round off the grid at the ends. */
  return roundTo(v, 6);
}

const roundTo = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Is the value already legal for its bound? */
export function withinBounds(key: BoundKey, value: number): boolean {
  const b = BOUNDS[key];
  return isFinite(value) && value >= b.min && value <= b.max;
}

/* ---------------- broker defaults ---------------- */

export interface BrokerDefaults {
  /** "The default protection mode for the configuration is MAXPERFORMANCE."
   *  Oracle's own broker default -- never this workbench's starting mode; see
   *  WORKBENCH_DEFAULT_PROTECTION_MODE below for that. */
  protectionMode: ProtectionMode;
  logXptMode: XptMode;
  thresholdSeconds: Seconds;
  /** MaxPerformance value; MaxAvailability differs under 26ai (see lagLimitMaxAvail). */
  lagLimitSeconds: Seconds;
  /** 26ai gives MaxAvailability its own default of 0 -- zero data loss. */
  lagLimitMaxAvailSeconds: Seconds | null;
  lagType: LagType;
  lagGraceTimeSeconds: Seconds;
  /** null = "not set", so the threshold governs the observer's detection. */
  pingIntervalMs: Claim<Millis | null>;
  pingRetry: Claim<number | null>;
  pmyShutdown: boolean;
  autoReinstate: boolean;
  netTimeoutSeconds: Seconds;
  reopenSeconds: Seconds;
  maxFailure: number;
  bystandersFollowRoleChange: 'ALL' | 'NONE';
  transportDisconnectedThresholdSeconds: Seconds;
  observerCount: Claim<number>;
}

/* Absent from the 12.2, 18c and 19c property pages, the fast-start failover
   chapter and the command reference -- and absent from a live 19.27 system
   too: `strings` on the `dgmgrl` and `oracle` binaries finds neither name, and
   SHOW CONFIGURATION VERBOSE lists neither property. First documented in 21c.
   Under 19c these two do not exist; this page carries no 19c default for them
   at all -- `value: null` here means that, not "not set". A 19c document that
   sets one anyway is a validation error, not a doc-later note (see
   FSFO.PING_PROPS_NOT_IN_19C in validate/rules/fsfo.ts). */
const PING_INTERVAL_19C = docLater<Millis | null>(null, ['FSFO.PING_PROPS_21C'],
  'ObserverPingInterval does not exist in 19c: absent from the 12.2, 18c and 19c property pages and from a live 19.27 system (neither `strings dgmgrl`/`strings oracle` nor SHOW CONFIGURATION VERBOSE shows it). First documented in 21c.');
const PING_RETRY_19C = docLater<number | null>(null, ['FSFO.PING_PROPS_21C'],
  'ObserverPingRetry does not exist in 19c: absent from the 12.2, 18c and 19c property pages and from a live 19.27 system. First documented in 21c.');

/* The 26ai contradiction, carried rather than resolved: the property pages give
   the broker defaults as 0 -- not set, detection governed by the threshold --
   while the 26ai fast-start failover chapter's table still shows 100 ms / 10.
   The engine takes "not set" and names the disagreement; the explicitly-set
   minimums stay 100 ms and 10 in every edition. */
const PING_INTERVAL_26AI = conflict<Millis | null>(null,
  ['FSFO.PING_DEFAULTS_26AI_ZERO', 'FSFO.PING_DEFAULTS_26AI_TABLE'],
  '26ai disagrees with itself: the ObserverPingInterval property page gives the broker default as 0 -- not set -- while the fast-start failover chapter table still shows 100 ms. The engine reads it as not set, so the threshold governs detection; never write "defaults identical in 26ai" unqualified.');
const PING_RETRY_26AI = conflict<number | null>(null,
  ['FSFO.PING_RETRY_26AI', 'FSFO.PING_DEFAULTS_26AI_TABLE'],
  'Same disagreement as ObserverPingInterval: the property page gives 0 -- not set -- and the chapter table still shows 10. The explicitly-set minimum stays 10.');

/* The move from three observers to four is settled: 21c (ORA-16647 help:
   "For Oracle Database releases 12.2 through 19c, a maximum of three
   observers can be started. For Oracle Database release 21c and later, a
   maximum of 4 observers can be started."). Two separate documentation
   conflicts survive the move and are carried as conflicts of their own: the
   19c command reference's START OBSERVER section says "up to four observers"
   against the same edition's fast-start failover chapter saying three, and
   the 26ai SHOW OBSERVER page still says three against the 26ai fast-start
   failover chapter's four. */
const OBSERVERS_19C = conflict(3, ['OBS.THREE_19C', 'ORA.16647'],
  'The 19c fast-start failover chapter says three; the 19c command reference\'s START OBSERVER section and ORA-16647 both say four. The move to four is settled at 21c; this engine reads three for 19c, the chapter\'s number, and names the command-reference conflict rather than resolving it.');
const OBSERVERS_26AI = conflict(4, ['OBS.FOUR_26AI', 'OBS.THREE_26AI_SHOW'],
  'The 26ai fast-start failover chapter says four, matching the settled 21c-and-later limit (ORA-16647); the 26ai SHOW OBSERVER page still says three. This engine reads four for 26ai and names the SHOW OBSERVER conflict.');

/**
 * The workbench's own choice of starting protection mode for a fresh
 * document, an imported document with the property missing, and every
 * preset that does not set its own: MAXAVAILABILITY. This is a product
 * choice, not a broker fact -- Oracle's own broker default is MAXPERFORMANCE
 * (BROKER_DEFAULTS[edition].protectionMode, below) -- and it is kept as a
 * separate, clearly named constant precisely so the two are never
 * conflated. Many tests and presets depend on the workbench continuing to
 * start in MAXAVAILABILITY; this constant is what they should read, not
 * BROKER_DEFAULTS[edition].protectionMode.
 */
export const WORKBENCH_DEFAULT_PROTECTION_MODE: ProtectionMode = 'MAXAVAILABILITY';

const COMMON = {
  /* "The default protection mode for the configuration is MAXPERFORMANCE."
     (19c DGMGRL command reference, CREATE CONFIGURATION). Never read this as
     the workbench's own starting mode -- see WORKBENCH_DEFAULT_PROTECTION_MODE. */
  protectionMode: 'MAXPERFORMANCE',
  logXptMode: 'ASYNC',
  thresholdSeconds: 30,
  lagLimitSeconds: 30,
  lagType: 'APPLY',
  lagGraceTimeSeconds: 0,
  pmyShutdown: true,
  autoReinstate: true,
  netTimeoutSeconds: 30,
  reopenSeconds: 300,
  maxFailure: 0,
  bystandersFollowRoleChange: 'ALL',
  transportDisconnectedThresholdSeconds: 30,
} as const;

export const BROKER_DEFAULTS: Record<Edition, BrokerDefaults> = {
  '19c': {
    ...COMMON,
    lagLimitMaxAvailSeconds: null,
    pingIntervalMs: PING_INTERVAL_19C,
    pingRetry: PING_RETRY_19C,
    observerCount: OBSERVERS_19C,
  },
  '26ai': {
    ...COMMON,
    /* FastStartFailoverLagLimit's MaxAvailability role is a 21c feature (21c
       change list and 21c chapter), not a 26ai one; 26ai's own contribution
       is the per-mode broker default, 0 in MaxAvailability -- the standby
       must have received everything and the failover is zero-loss. Source:
       the 26ai fast-start failover chapter's "Fast-start Failover Protection
       Modes" section -- never that chapter's Task 3 and never the property
       page's closing line, both stale (FSFO.LAGLIMIT_STALE_TASK3,
       FSFO.LAGLIMIT_STALE_PROPERTY_CLOSING_LINE). 19c disagrees with itself
       about whether the property reaches MaxAvailability at all
       (FSFO.LAGLIMIT_ZERO_MAXAVAIL_19C, FSFO.LAGLIMIT_MAXPERF_ONLY_19C); this
       engine follows the observed 19.27 behaviour and does not evaluate it
       there. */
    lagLimitMaxAvailSeconds: 0,
    pingIntervalMs: PING_INTERVAL_26AI,
    pingRetry: PING_RETRY_26AI,
    observerCount: OBSERVERS_26AI,
  },
};

/** Are both ping properties explicitly set? That is the documented trigger. */
export const pingSet = (intervalMs: Millis | null, retry: number | null): boolean =>
  intervalMs !== null && retry !== null;

/**
 * The lag limit that applies to a mode in an edition. Under 19c the limit is a
 * maximum-performance property; under 26ai maximum availability has one too,
 * defaulting to 0.
 */
export function defaultLagLimit(edition: Edition, mode: ProtectionMode): Seconds {
  const d = BROKER_DEFAULTS[edition];
  if (mode === 'MAXAVAILABILITY' && d.lagLimitMaxAvailSeconds !== null) {
    return d.lagLimitMaxAvailSeconds;
  }
  return d.lagLimitSeconds;
}

/**
 * Is 0 a FastStartFailoverLagLimit this edition and mode document? Only where
 * it is the broker default: 26ai maximum availability, "the standby must have
 * received all the redo data the primary has generated". Everywhere else the
 * documented floor is 5 (the property page: "Must be greater than, or equal
 * to, 5"). Oracle's 26ai page states both for maximum availability -- a default
 * of 0 and a minimum of 5 -- and does not reconcile them (ED-09, TXT-46).
 */
export const lagLimitAllowsZero = (edition: Edition, mode: ProtectionMode): boolean =>
  mode === 'MAXAVAILABILITY' && BROKER_DEFAULTS[edition].lagLimitMaxAvailSeconds === 0;

/**
 * A typed FastStartFailoverLagLimit, clamped for the edition and mode it is
 * read under: the documented floor of 5, except that 26ai maximum availability
 * also takes 0. A value between 0 and 5 there goes to whichever of the two is
 * nearer, so the control can come back to the default.
 */
export function clampLagLimit(edition: Edition, mode: ProtectionMode, value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (lagLimitAllowsZero(edition, mode) && isFinite(n) && n < BOUNDS.lagLimitSeconds.min / 2) return 0;
  return clamp('lagLimitSeconds', value, defaultLagLimit(edition, mode));
}

/**
 * What a document stores in `lagLimitSeconds` while FastStartFailoverLagLimit
 * is not set: the one universal default every document carried before "not
 * set" existed. The serializer reads a stored 30 with no marker as not set,
 * so a document written before the marker keeps following its edition.
 */
export const LAG_LIMIT_UNSET_STORED: Seconds = 30;

/** Was FastStartFailoverLagLimit set, or is it at the broker default? */
export const lagLimitIsSet = (f: Pick<FsfoConfig, 'lagLimitSet'>): boolean => f.lagLimitSet === true;

/**
 * The FastStartFailoverLagLimit in force: the value as set, or -- until
 * someone sets it -- the broker default for the edition and protection mode
 * being read. The reading edition is a preference applied on top of the
 * document, which is exactly why "not set" cannot be stored as a number:
 * 30 under 19c is 0 under 26ai in maximum availability.
 *
 * Every reader of the lag limit goes through here; a source scan
 * (engine/__tests__/lag-limit.test.ts) fails on a new direct read.
 */
export function lagLimitOf(
  doc: { config: Pick<Configuration, 'edition' | 'protectionMode' | 'fsfo'> },
): Seconds {
  const c = doc.config;
  return lagLimitIsSet(c.fsfo)
    ? c.fsfo.lagLimitSeconds
    : defaultLagLimit(c.edition, c.protectionMode);
}

/**
 * What is wrong with a ConfigurationWideServiceName, or null: "The first
 * character must be an alphanumeric character. There is a 30–character
 * maximum." (ED-10; CFG.WIDE_SERVICE_NAME_FORMAT). Empty is not a name, so it
 * is not wrong: the property is then not set.
 */
export const CONFIG_WIDE_SERVICE_NAME_MAX = 30;

export function configurationWideServiceNameProblem(name: string): string | null {
  if (name === '') return null;
  if (!/^[A-Za-z0-9]/.test(name)) {
    return 'The first character must be an alphanumeric character.';
  }
  if (name.length > CONFIG_WIDE_SERVICE_NAME_MAX) {
    return `There is a ${CONFIG_WIDE_SERVICE_NAME_MAX}-character maximum; this name has ${name.length}.`;
  }
  return null;
}

/** Nominal drawing constants -- footnote 3 of the published page, not documented numbers. */
export const NOMINAL = {
  switchoverVerifySeconds: 1,
  switchoverConvertSeconds: 2,
  refuseSeconds: 0.2,
  osRefuseSeconds: 0.15,
  establishSeconds: 0.3,
  /** The first failed ping with the ping properties unset. */
  firstPingSeconds: 0.3,
} as const;
