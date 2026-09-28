/**
 * One bounds table and the broker defaults per edition.
 *
 * BOUNDS is the single source of numeric truth: the serializer clamps against
 * it, the migration clamps against it, and the DOM reads its min/max/step off
 * it rather than carrying ranges of its own (engine design SS1.7).
 *
 * Every range mirrors the published simulator's control, except where a range
 * is deliberately wider in the new app; those two are marked.
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
  thresholdSeconds: { min: 6, max: 120, step: 1, default: 30, unit: 's', label: 'FastStartFailoverThreshold' },
  lagLimitSeconds: { min: 5, max: 90, step: 1, default: 30, unit: 's', label: 'FastStartFailoverLagLimit' },
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
  netTimeoutSeconds: { min: 1, max: 120, step: 1, default: 30, unit: 's', label: 'NetTimeout' },
  /* Wider than the published simulator's 30-900: the new app lets a destination
     sit out a full hour. The 30 s floor is unchanged and deliberate -- the
     meaning of REOPEN = 0 is not documented, so the slider never offers it. */
  reopenSeconds: { min: 30, max: 3600, step: 15, default: 300, unit: 's', label: 'ReopenSecs' },
  /* Wider than the published simulator's 0-10. 0 stays "unlimited". */
  maxFailure: { min: 0, max: 20, step: 1, default: 0, unit: 'count', label: 'MaxFailure' },

  /* ---- RAC standby ---- */
  /* The broker default is 0, "immediate apply instance failover"; the ceiling
     is this page's, not Oracle's -- the property takes any value >= 0. */
  applyInstanceTimeoutSeconds: { min: 0, max: 600, step: 5, default: 0, unit: 's', label: 'ApplyInstanceTimeout' },

  /* ---- commit anatomy ---- */
  localWriteMs: { min: 0, max: 25, step: 1, default: 2, unit: 'ms', label: 'local redo write' },
  standbyWriteMs: { min: 0, max: 25, step: 1, default: 2, unit: 'ms', label: 'standby redo log write' },

  /* ---- client connect descriptor ---- */
  transportConnectTimeoutSeconds: { min: 1, max: 60, step: 1, default: 60, unit: 's', label: 'TRANSPORT_CONNECT_TIMEOUT' },
  connectTimeoutSeconds: { min: 0, max: 120, step: 1, default: 0, unit: 's', label: 'CONNECT_TIMEOUT' },
  retryCount: { min: 0, max: 100, step: 1, default: 0, unit: 'count', label: 'RETRY_COUNT' },
  retryDelaySeconds: { min: 0, max: 30, step: 1, default: 0, unit: 's', label: 'RETRY_DELAY' },

  /* ---- identity ---- */
  listenerPort: { min: 1, max: 65535, step: 1, default: 1521, unit: 'port', label: 'listener port' },
} as const satisfies Record<string, Bound>;

export type BoundKey = Extract<keyof typeof BOUNDS, string>;

export const boundOf = (key: BoundKey): Bound => BOUNDS[key];

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
