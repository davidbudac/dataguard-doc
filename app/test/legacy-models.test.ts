/**
 * M5: `site/test.mjs`'s APPMODEL, COMMITMODEL and REOPENMODEL groups, ported
 * onto the general engine.
 *
 * Every test name and every comment below is verbatim from that file -- the
 * numbers restate a fact documented in AGENTS.md's accuracy rules (or a
 * drawing constant from the page's footnotes), and if one fails, decide which
 * side is wrong against docs.oracle.com before touching either.
 *
 * The three models are no longer special-cased for one deployment:
 * `computeApp` classifies N addresses from the trace, `computeCommit` takes
 * the primary's legs, and `computeReopen` takes one destination's attributes.
 * The published two-address, single-destination numbers are what these tests
 * pin.
 */

import { describe, expect, it } from 'vitest';
import { classicTopology } from '../src/engine/compat/classic';
import type { ClassicKnobs } from '../src/engine/compat/classic';
import { simulate } from '../src/engine/sim/simulate';
import { computeApp } from '../src/engine/models/app';
import type { AppModel } from '../src/engine/models/app';
import { computeCommit } from '../src/engine/models/commit';
import type { CommitModel } from '../src/engine/models/commit';
import { computeReopen } from '../src/engine/models/reopen';
import type { ReopenInput, ReopenModel } from '../src/engine/models/reopen';
import { memberId } from '../src/engine/ids';
import type { Edition } from '../src/engine/ids';
import type { ProtectionMode, XptMode } from '../src/engine/types/topology';

const near = (got: number | null, want: number, label?: string): void => {
  expect(Math.abs((got ?? NaN) - want) < 1e-9, `${label ?? 'value'}: ${got} != ${want}`).toBe(true);
};

// Baselines mirror the page's control defaults. The transport lag is pinned to
// zero for the same reason `legacyComputeFsfo` zeroes it: the published
// workbench's "standby lag" is an apply lag and says nothing about redo the
// standby has not received, so its deployment is one where the standby holds
// everything it was sent -- which is what makes it SYNCHRONIZED, and what every
// maximum availability cell of the matrix assumes.
const CDEF = { scenario: 'crash', observerLoc: 'dc3', mode: 'maxavail', threshold: 30,
  pingSet: false, pingInterval: 100, pingRetry: 10, standbyLag: 10, transportLag: 0,
  lagLimit: 30, roleTransition: 15, pmyShutdown: true, latency: 0 } as ClassicKnobs;
const ADEF = { tct: 60, ct: 0, rc: 0, rd: 0, dead: 'drop' } as ClassicKnobs;

const app = (
  aOver: Partial<ClassicKnobs> = {}, cOver: Partial<ClassicKnobs> = {},
): AppModel => {
  const doc = classicTopology({ ...CDEF, ...ADEF, ...cOver, ...aOver } as ClassicKnobs);
  const trace = simulate(doc, doc.events);
  return computeApp(doc.client, trace, doc);
};

// ---------- APPMODEL: the connect string ----------

describe('APPMODEL: the connect string', () => {
  it('default string, default clocks: the lucky 60 s hang connects', () => {
    const a = app({});
    expect(a.attempts.length).toBe(1);
    expect(a.d1).toBe(60);
    near(a.tConn, 60.3, 'tConn');
    expect(a.gaveUp).toBe(null);
  });

  it('threshold 90: the one traversal dies before the service exists', () => {
    const a = app({}, { threshold: 90 });
    expect(a.tService).toBe(115);
    expect(a.tConn).toBe(null);
    near(a.gaveUp, 60.2, 'gaveUp');
  });

  it('Tuned preset walks a discrete ladder to the reopened service', () => {
    const a = app({ tct: 3, ct: 90, rc: 30, rd: 3 });
    expect(a.attempts.length).toBe(10);
    near(a.tConn, 59.1, 'tConn');
    near(a.worst, 189.2, 'worst');
    const many = app({ dead: 'rst', rc: 100 });
    expect(many.attempts.length).toBe(101);
  });

  it('a partition drops packets: no refusal even from a live-host string', () => {
    const a = app({ dead: 'rst' }, { scenario: 'isolated' });
    expect(a.drop).toBe(true);
    expect(a.d1).toBe(60);
    const quiet = app({}, { scenario: 'observer-lost' });
    expect(quiet.noEvent).toBe(true);
    expect(quiet.noEventKind).toBe('observer-lost');
    expect(quiet.attempts.length).toBe(0);
  });

  it('app: with no observer the crash strands the connect string', () => {
    const a = app({}, { scenario: 'crash', observerLoc: 'none' });
    expect(a.noEvent).toBe(false);
    expect(a.noEventKind).toBe(null);
    expect(a.tService).toBe(null);            // nothing ever opens read-write
    expect(a.tConn).toBe(null);
    expect(a.attempts.length).toBe(1);
    near(a.gaveUp, 60.2, 'gaveUp');           // and it does give up, not hang forever
  });

  it('app: an isolated primary with a DC1 observer strands the string too', () => {
    const a = app({ dead: 'rst' }, { scenario: 'isolated', observerLoc: 'dc1' });
    expect(a.noEvent).toBe(false);
    expect(a.drop).toBe(true);                // a partition drops, whatever the toggle says
    expect(a.d1).toBe(60);
    expect(a.tService).toBe(null);
    expect(a.tConn).toBe(null);
    near(a.gaveUp, 60.2, 'gaveUp');
  });

  it('app: a configuration that carries on is a no-event for every client', () => {
    for (const [scenario, observerLoc] of [['partition', 'dc3'], ['partition', 'dc1'],
      ['partition', 'none'], ['dc2down', 'dc3'], ['dc2down', 'none']] as const) {
      const a = app({}, { scenario, observerLoc });
      const at = `${scenario}/${observerLoc}`;
      expect(a.noEvent, at).toBe(true);
      expect(a.noEventKind, at).toBe('continues');
      expect(a.attempts.length, at).toBe(0);
      expect(a.tConn, at).toBe(null);
      expect(a.gaveUp, at).toBe(null);
    }
  });

  it('app: a STALLED primary still answers the listener', () => {
    // The outage is at commit level: the service is still published, so a new
    // connection is accepted exactly as it was before.
    const a = app({}, { scenario: 'dc2down', observerLoc: 'dc2' });
    expect(a.noEvent).toBe(true);
    expect(a.noEventKind).toBe('stalled');
    expect(a.attempts.length).toBe(0);
    expect(a.tConn).toBe(null);
    expect(a.gaveUp).toBe(null);
  });

  it('switchover app: two instant refusals per traversal, no timeout anywhere', () => {
    const a = app({}, { scenario: 'switchover' });
    expect(a.switchover).toBe(true);
    expect(a.drop).toBe(false);
    near(a.d1, 0.2, 'd1');
    near(a.passCost, 0.4, 'passCost');
    expect(a.startAt).toBe(1);                 // dialing starts as the primary converts
    // Neither the transport budget nor the dead-address behaviour can move it.
    const other = app({ tct: 3, dead: 'rst' }, { scenario: 'switchover' });
    expect(other.attempts).toEqual(a.attempts);
    near(other.gaveUp, a.gaveUp ?? NaN, 'gaveUp');
  });

  it('switchover app: the default string gives up long before the new primary opens', () => {
    const a = app({}, { scenario: 'switchover' });
    expect(a.attempts.length).toBe(1);
    expect(a.tConn).toBe(null);
    near(a.gaveUp, 1.4, 'gaveUp');
    expect((a.gaveUp ?? 0) < (a.tService ?? 0), 'gives up before the service comes back').toBe(true);
  });

  it('switchover app: enough retries always connect, never before the open', () => {
    const tuned = app({ tct: 3, ct: 90, rc: 30, rd: 3 }, { scenario: 'switchover' });
    expect(tuned.attempts.length).toBe(9);
    near(tuned.tConn, 28.7, 'tConn');
    expect((tuned.tConn ?? 0) >= (tuned.tService ?? 0), 'connects at or after the open').toBe(true);
    const long = app({ rc: 100, rd: 1 }, { scenario: 'switchover', standbyLag: 60 });
    expect(long.tConn !== null && long.tConn >= (long.tService ?? 0)).toBe(true);
  });

  it('switchover app: a refused command is a no-event', () => {
    const a = app({}, { scenario: 'switchover', mode: 'maxperf', standbyLag: 45, lagLimit: 30 });
    expect(a.noEvent).toBe(true);
    expect(a.noEventKind).toBe('switchover-refused');
    expect(a.switchoverRefused).toBe(true);
    expect(a.attempts.length).toBe(0);
    expect(a.tConn).toBe(null);
    expect(a.gaveUp).toBe(null);
  });
});

// ---------- COMMITMODEL: one commit ----------

const XPT: Record<'sync' | 'fastsync' | 'async', XptMode> = {
  sync: 'SYNC', fastsync: 'FASTSYNC', async: 'ASYNC',
};
const MODE: Record<'maxavail' | 'maxperf', ProtectionMode> = {
  maxavail: 'MAXAVAILABILITY', maxperf: 'MAXPERFORMANCE',
};

/** One database leg, which is what the published single-destination card drew. */
const commit = (k: {
  xpt: 'sync' | 'fastsync' | 'async'; rttMs: number; localWriteMs: number;
  sbWriteMs: number; mode: 'maxavail' | 'maxperf'; version?: Edition;
}): CommitModel => computeCommit({
  ...(k.version === undefined ? {} : { edition: k.version }),
  mode: MODE[k.mode],
  localWriteMs: k.localWriteMs,
  legs: [{
    to: memberId('sby01'), kind: 'database', xpt: XPT[k.xpt],
    rttMs: k.rttMs, destWriteMs: k.sbWriteMs,
  }],
});

describe('COMMITMODEL: one commit', () => {
  it('commit cost is max(local write, ack path), never the sum', () => {
    const cm = commit({ xpt: 'sync', rttMs: 0, localWriteMs: 25, sbWriteMs: 25, mode: 'maxavail' });
    expect(cm.ackPathMs).toBe(25);
    expect(cm.commitMs).toBe(25);
    expect(cm.standbyWaitMs).toBe(0);
  });

  it('SYNC vs FASTSYNC: the delta is the standby write only while the trip is the bottleneck', () => {
    const sync = commit({ xpt: 'sync', rttMs: 20, localWriteMs: 2, sbWriteMs: 10, mode: 'maxavail' });
    const fast = commit({ xpt: 'fastsync', rttMs: 20, localWriteMs: 2, sbWriteMs: 10, mode: 'maxavail' });
    expect(sync.commitMs).toBe(30);
    expect(fast.commitMs).toBe(20);
    expect(sync.syncFastsyncDeltaMs).toBe(10);
    const local = commit({ xpt: 'sync', rttMs: 4, localWriteMs: 20, sbWriteMs: 5, mode: 'maxavail' });
    expect(local.syncFastsyncDeltaMs).toBe(0);
  });

  it('ASYNC never waits: local write is the whole commit, exposure begins', () => {
    const cm = commit({ xpt: 'async', rttMs: 20, localWriteMs: 2, sbWriteMs: 10, mode: 'maxperf' });
    expect(cm.commitMs).toBe(2);
    expect(cm.ackPathMs).toBe(null);
    expect(cm.standbyWaitMs).toBe(0);
    expect(cm.exposed).toBe(true);
    expect(cm.legs[0]?.srlDoneMs).toBe(2 + 10 + 10);
  });

  it('mode conflict flags exactly ASYNC under MaxAvailability, and only before 26ai', () => {
    const mk = (xpt: 'sync' | 'fastsync' | 'async', mode: 'maxavail' | 'maxperf', version?: Edition) =>
      commit({ xpt, rttMs: 0, localWriteMs: 2, sbWriteMs: 2, mode, ...(version === undefined ? {} : { version }) });
    // 19c (and version absent): broker Table 4-2 lists SYNC/FASTSYNC for
    // MaxAvailability, so ASYNC there is a conflict.
    expect(mk('async', 'maxavail').modeConflict).toBe(true);
    expect(mk('async', 'maxavail', '19c').modeConflict).toBe(true);
    expect(mk('async', 'maxperf').modeConflict).toBe(false);
    expect(mk('sync', 'maxavail').modeConflict).toBe(false);
    expect(mk('fastsync', 'maxavail').modeConflict).toBe(false);
    expect(mk('async', 'maxavail').modeAllowed26).toBe(false);
    // 26ai: the prerequisites list ASYNC for a MaxAvailability target as well,
    // so the pairing is allowed -- flagged as a caveat, never as a conflict.
    expect(mk('async', 'maxavail', '26ai').modeConflict).toBe(false);
    expect(mk('async', 'maxavail', '26ai').modeAllowed26).toBe(true);
    expect(mk('async', 'maxperf', '26ai').modeAllowed26).toBe(false);
    expect(mk('sync', 'maxavail', '26ai').modeAllowed26).toBe(false);
    // Version absent and explicit 19c agree field for field.
    expect(mk('async', 'maxavail')).toEqual(mk('async', 'maxavail', '19c'));
  });
});

// ---------- REOPENMODEL: after the drop ----------

const RDEF = {
  reopenSeconds: 300, maxFailure: 0, outageSeconds: 600, redoRateMBs: 5,
  mode: 'MAXAVAILABILITY' as ProtectionMode, lagLimitSeconds: 30,
};
const reopen = (over: Partial<ReopenInput> = {}): ReopenModel =>
  computeReopen({ ...RDEF, ...over });

describe('REOPENMODEL: after the drop', () => {
  it('retries at ReopenSecs multiples; reconnect on the first eligible switch', () => {
    const rp = reopen({});
    expect(rp.attempts.map((a) => a.t)).toEqual([0, 300, 600]);
    expect(rp.reconnectAt).toBe(600);
    expect(rp.disabledAt).toBe(null);
    expect(rp.catchupSecs).toBe(150);
    expect(rp.resyncAt).toBe(750);
    expect(rp.peakExposureMB).toBe(3000);
  });

  it('MaxFailure trips permanently; a short outage still waits one interval', () => {
    const trip = reopen({ maxFailure: 1, outageSeconds: 1800 });
    expect(trip.disabledAt).toBe(300);
    expect(trip.reconnectAt).toBe(null);
    expect(trip.fsfoBackAt).toBe(null);
    const short = reopen({ outageSeconds: 60 });
    expect(short.reconnectAt).toBe(300);
  });

  it('FSFO disarms at t = 0 in MaxAvailability, at the lag limit in MaxPerformance', () => {
    const mk = (mode: ProtectionMode, lagLimitSeconds: number) => reopen({ mode, lagLimitSeconds });
    expect(mk('MAXAVAILABILITY', 30).fsfoLostAt).toBe(0);
    expect(mk('MAXPERFORMANCE', 30).fsfoLostAt).toBe(30);
    expect(mk('MAXPERFORMANCE', 5).fsfoLostAt).toBe(5);
  });

  it('26ai reopen: bounded MaxAvailability disarms at the lag limit, not at t = 0', () => {
    // The published knob was a lagPolicy of 'zero' or 'bounded'; in the general
    // engine the policy IS the property -- 0 is the 26ai MaxAvailability broker
    // default and means zero data loss, any non-zero value is bounded loss.
    const mk = (over: Partial<ReopenInput> = {}) =>
      reopen({ mode: 'MAXAVAILABILITY', edition: '26ai', lagLimitSeconds: 30, ...over });
    // Zero data loss is the default and the 19c drawing: unsynchronized at once.
    expect(mk({ lagLimitSeconds: 0 }).fsfoLostAt).toBe(0);
    expect(mk({ lagLimitSeconds: 0 }).lagGated).toBe(false);
    // Bounded: the apply lag is what disarms it, exactly as in MaxPerformance.
    expect(mk({}).fsfoLostAt).toBe(30);
    expect(mk({}).lagGated).toBe(true);
    expect(mk({ lagLimitSeconds: 5 }).fsfoLostAt).toBe(5);
    // FastStartFailoverLagGraceTime stays MaxPerformance-only, so no stall band
    // is drawn here whatever the policy and grace time say.
    expect(mk({ lagGraceTimeSeconds: 10, thresholdSeconds: 30 }).lagStallAt).toBe(null);
    expect(mk({ lagGraceTimeSeconds: 10, thresholdSeconds: 30 }).lagGraceArmed).toBe(false);
    // And under 19c the policy is not a thing: t = 0, as it always was.
    const c19 = reopen({ mode: 'MAXAVAILABILITY', lagLimitSeconds: 30 });
    expect(c19.fsfoLostAt).toBe(0);
    expect(c19.lagGated).toBe(false);
  });

  it('26ai reopen: grace 0 pauses the primary at the crossing, one threshold at most', () => {
    // FastStartFailoverLagGraceTime = 0: the primary asks permission to enter
    // LAGGING at the moment the lag crosses the limit, and the band sits at the
    // crossing -- fsfoLostAt -- one FastStartFailoverThreshold wide. The
    // threshold is the bound the broker gives, never a measured duration.
    const rp = reopen({ mode: 'MAXPERFORMANCE', lagLimitSeconds: 30, edition: '26ai',
      lagGraceTimeSeconds: 0, thresholdSeconds: 30 });
    expect(rp.lagGraceArmed).toBe(false);
    expect(rp.lagStallAt).toBe(rp.fsfoLostAt);
    expect(rp.lagStallAt).toBe(30);
    expect(rp.lagStallMax).toBe(30);
    // The band follows the limit and the threshold independently.
    const other = reopen({ mode: 'MAXPERFORMANCE', lagLimitSeconds: 5, edition: '26ai',
      lagGraceTimeSeconds: 0, thresholdSeconds: 45 });
    expect(other.lagStallAt).toBe(5);
    expect(other.lagStallMax).toBe(45);
  });

  it('26ai reopen: a grace time of 5 s or more is armed, and no stall band is drawn', () => {
    for (const grace of [5, 60]) {
      const rp = reopen({ mode: 'MAXPERFORMANCE', lagLimitSeconds: 30, edition: '26ai',
        lagGraceTimeSeconds: grace, thresholdSeconds: 30 });
      expect(rp.lagGraceArmed, `grace ${grace}`).toBe(true);
      expect(rp.lagStallAt, `grace ${grace}`).toBe(null);
      expect(rp.lagStallMax, `grace ${grace}`).toBe(null);
      expect(rp.lagGraceTime, `grace ${grace}`).toBe(grace);
    }
    // MaxAvailability has no LAGGING state to ask permission for: neither the
    // band nor the armed flag, whatever the grace time says.
    const avail = reopen({ mode: 'MAXAVAILABILITY', lagLimitSeconds: 30, edition: '26ai',
      lagGraceTimeSeconds: 10, thresholdSeconds: 30 });
    expect(avail.lagGraceArmed).toBe(false);
    expect(avail.lagStallAt).toBe(null);
  });

  it('26ai reopen: no observer means nothing is armed, so no LAGGING stall or grace band', () => {
    // Oracle defines FastStartFailoverLagGraceTime only while fast-start
    // failover is enabled in maximum performance mode. With no observer
    // deployed nothing is enabled, so the crossing costs the primary nothing
    // and neither output may fire -- whatever the grace time says.
    const mk = (over: Partial<ReopenInput> = {}) => reopen({ mode: 'MAXPERFORMANCE',
      lagLimitSeconds: 30, edition: '26ai', thresholdSeconds: 30, fsfoEnabled: false, ...over });
    expect(mk({ lagGraceTimeSeconds: 0 }).lagStallAt).toBe(null);
    expect(mk({ lagGraceTimeSeconds: 0 }).lagStallMax).toBe(null);
    expect(mk({ lagGraceTimeSeconds: 10 }).lagGraceArmed).toBe(false);
    // Absent, the flag defaults to enabled -- the pre-existing behavior every
    // old caller (and the tests above) relies on.
    expect(mk({ lagGraceTimeSeconds: 0, fsfoEnabled: undefined }).lagStallAt).toBe(30);
    expect(mk({ lagGraceTimeSeconds: 10, fsfoEnabled: true }).lagGraceArmed).toBe(true);
  });

  it('19c reopen: neither the stall band nor the armed flag, and no drift', () => {
    const bare = reopen({ mode: 'MAXPERFORMANCE', lagLimitSeconds: 30 });
    expect(bare.lagGraceArmed).toBe(false);
    expect(bare.lagStallAt).toBe(null);
    expect(bare.lagStallMax).toBe(null);
    // Explicit '19c' with the 26ai keys along for the ride returns the same
    // shape an old caller gets -- the grace time is echoed, nothing else moves.
    const explicit = reopen({ mode: 'MAXPERFORMANCE', lagLimitSeconds: 30, edition: '19c',
      lagGraceTimeSeconds: 30, thresholdSeconds: 30 });
    expect(explicit.lagGraceArmed).toBe(false);
    expect(explicit.lagStallAt).toBe(null);
    expect({ ...explicit, lagGraceTime: 0 }).toEqual(bare);
  });
});
