/**
 * The M3 gate: `site/test.mjs`'s model tests, ported onto the general engine.
 *
 * Every test name and every comment below is verbatim from that file -- the
 * numbers restate a fact documented in AGENTS.md's accuracy rules (or a
 * drawing constant from the page's footnotes), and if one fails, decide which
 * side is wrong against docs.oracle.com before touching either.
 *
 * The adapter under test is `legacyComputeFsfo`, which builds the published
 * 1+1+1 deployment, turns the scenario into engine events, simulates, and
 * projects the trace back onto `computeFsfo`'s return object. No cell here is
 * special-cased anywhere in the engine.
 *
 * The APPMODEL, COMMITMODEL and REOPENMODEL groups and the Czech catalog tests
 * are not ported here: those three models arrive with M5.
 */

import { describe, expect, it } from 'vitest';
import { cmTickStep, pickTickStep, rpTickStep } from '../src/engine/models/axis';
import { legacyComputeFsfo } from '../src/engine/compat/classic';
import type { ClassicKnobs, ClassicObserverLoc, ClassicScenario } from '../src/engine/compat/classic';
import { NOMINAL } from '../src/engine/defaults';

const SW_VERIFY = NOMINAL.switchoverVerifySeconds;
const SW_CONVERT = NOMINAL.switchoverConvertSeconds;

const near = (got: number | null, want: number, label?: string): void => {
  expect(Math.abs((got ?? NaN) - want) < 1e-9, `${label ?? 'value'}: ${got} != ${want}`).toBe(true);
};

// Baselines mirror the page's control defaults.
const CDEF = { scenario: 'crash', observerLoc: 'dc3', mode: 'maxavail', threshold: 30,
  pingSet: false, pingInterval: 100, pingRetry: 10, standbyLag: 10, lagLimit: 30,
  roleTransition: 15, pmyShutdown: true, latency: 0 } as ClassicKnobs;
const fsfo = (over: Partial<ClassicKnobs> & Record<string, unknown> = {}) =>
  legacyComputeFsfo({ ...CDEF, ...over } as ClassicKnobs);

describe('tick ladders', () => {
  it('tick ladders', () => {
    expect(pickTickStep(4.4)).toBe(0.5);
    expect(pickTickStep(9)).toBe(1);
    expect(pickTickStep(80)).toBe(10);
    expect(cmTickStep(30)).toBe(5);
    expect(rpTickStep(900)).toBe(120);
  });
});

// ---------- MODEL: the failover clocks ----------

describe('MODEL: the failover clocks', () => {
  it('defaults: initiate at the 30 s threshold, open at 55 s, zero loss', () => {
    const m = fsfo({});
    expect(m.initiate).toBe(30);
    expect(m.execStart).toBe(30);
    expect(m.tOpen).toBe(55);
    expect(m.blocked).toBe(false);
    expect(m.dataLossKind).toBe('none');
    expect(m.abort).toBe(null);
  });

  it('threshold floor: the documented 6 s minimum still initiates', () => {
    const m = fsfo({ threshold: 6, standbyLag: 0, roleTransition: 5 });
    expect(m.initiate).toBe(6);
    expect(m.tOpen).toBe(11);
  });

  // interval x (retry + 1) is the PAGE'S MODEL, not a published formula. What the
  // documentation states is that the threshold is ignored once both ping
  // properties are set, and that detection can be reduced to "nearly 1 second";
  // no arithmetic appears anywhere in it. The 1.1 s below is that model at the
  // minimums (100 ms x 11), and the prose that quotes it says so.
  it('ping override: pingInterval x (pingRetry + 1), not the threshold', () => {
    const m = fsfo({ pingSet: true });
    near(m.detect, 1.1, 'detect');
    near(m.initiate, 1.1, 'initiate');
    expect(m.initiate).not.toBe(CDEF.threshold);
  });

  it('ping override does not move the isolated primary abort clock', () => {
    const m = fsfo({ scenario: 'isolated', pingSet: true });
    near(m.initiate, 1.1, 'initiate');
    expect(m.abort).toBe(30);
  });

  it('MaxPerformance blocks on lag strictly greater than the limit', () => {
    const over = fsfo({ mode: 'maxperf', standbyLag: 60, lagLimit: 30 });
    expect(over.blocked).toBe(true);
    expect(over.dataLossKind).toBe('na');
    const at = fsfo({ mode: 'maxperf', standbyLag: 30, lagLimit: 30 });
    expect(at.blocked).toBe(false);
    expect(at.dataLossKind).toBe('bounded');
    expect(at.dataLossSeconds).toBe(30);
  });

  it('FastStartFailoverPmyShutdown gates the abort', () => {
    expect(fsfo({ scenario: 'isolated', pmyShutdown: false }).abort).toBe(null);
    expect(fsfo({ scenario: 'isolated', threshold: 45 }).abort).toBe(45);
  });

  it('latency pays one hop on the FAILOVER command, never stretches timers', () => {
    const m = fsfo({ latency: 100 });
    near(m.netHop, 0.05, 'netHop');
    near(m.execStart, 30.05, 'execStart');
    expect(m.initiate).toBe(30);
  });

  it('observer lost: no fast-start failover, ever', () => {
    const m = fsfo({ scenario: 'observer-lost' });
    expect(m.observerLost).toBe(true);
    expect(m.initiate).toBe(null);
    expect(m.tOpen).toBe(null);
    expect(m.abort).toBe(null);
    expect(m.blocked).toBe(false);
  });

  it('ifDiedNow prices the blind window: zero synchronized, the lag otherwise', () => {
    expect(fsfo({ scenario: 'observer-lost' }).ifDiedNow).toBe(0);
    expect(fsfo({ scenario: 'observer-lost', mode: 'maxperf', standbyLag: 42 }).ifDiedNow).toBe(42);
  });
});

// ---------- MODEL: the planned switchover ----------

describe('MODEL: the planned switchover', () => {
  it('switchover: nominal verify and convert bands, and tOpen is their sum', () => {
    expect(SW_VERIFY).toBe(1);
    expect(SW_CONVERT).toBe(2);
    const m = fsfo({ scenario: 'switchover' });
    expect(m.switchover).toBe(true);
    expect(m.tDown).toBe(SW_VERIFY);
    expect(m.tConvertEnd).toBe(SW_VERIFY + SW_CONVERT);
    expect(m.tOpen).toBe(SW_VERIFY + SW_CONVERT + (CDEF.standbyLag as number) + (CDEF.roleTransition as number));
    expect(m.downtime).toBe((m.tOpen as number) - (m.tDown as number));
    const slow = fsfo({ scenario: 'switchover', standbyLag: 40, roleTransition: 30 });
    expect(slow.tOpen).toBe(1 + 2 + 40 + 30);
    expect(slow.downtime).toBe(72);
  });

  it('switchover guarantees zero data loss in both protection modes', () => {
    for (const mode of ['maxavail', 'maxperf'] as const) {
      const m = fsfo({ scenario: 'switchover', mode, standbyLag: 20, lagLimit: 30 });
      expect(m.dataLossKind).toBe('none');
      expect(m.dataLossSeconds).toBe(0);
      expect(m.blocked).toBe(false);
    }
  });

  it('switchover: FSFO enabled means MaxPerformance refuses past the lag limit', () => {
    expect(fsfo({ scenario: 'switchover', mode: 'maxperf', standbyLag: 45, lagLimit: 30 }).blocked).toBe(true);
    expect(fsfo({ scenario: 'switchover', mode: 'maxperf', standbyLag: 30, lagLimit: 30 }).blocked).toBe(false);
    // MaxAvailability: synchronized is about redo received, so an apply lag
    // lengthens the catch-up instead of blocking the command.
    const avail = fsfo({ scenario: 'switchover', mode: 'maxavail', standbyLag: 90, lagLimit: 30 });
    expect(avail.blocked).toBe(false);
    expect(avail.tOpen).toBe(1 + 2 + 90 + 15);
    // Refused: nothing converts, so there is no downtime window at all.
    const no = fsfo({ scenario: 'switchover', mode: 'maxperf', standbyLag: 45, lagLimit: 30 });
    expect(no.tOpen).toBe(null);
    expect(no.tDown).toBe(null);
    expect(no.downtime).toBe(null);
    expect(no.dataLossKind).toBe('none');
  });

  it('switchover runs no clocks: threshold and ping properties change nothing', () => {
    const m = fsfo({ scenario: 'switchover' });
    expect(m.initiate).toBe(null);
    expect(m.detect).toBe(null);
    expect(m.abort).toBe(null);
    const loud = fsfo({ scenario: 'switchover', threshold: 120, pingSet: true, pingInterval: 5000, pingRetry: 50 });
    expect(loud.tOpen).toBe(m.tOpen);
    expect(loud.abort).toBe(null);
    // not even an isolated-style abort, and latency never enters the arithmetic
    const far = fsfo({ scenario: 'switchover', latency: 100 });
    expect(far.tOpen).toBe(m.tOpen);
  });
});

// ---------- MODEL: where the observer runs ----------
//
// The observer's placement decides which half of a failure it lands on, and
// therefore what the configuration does. These two tables are the executable
// form of the placement matrix in diagrams/README.md: six scenarios by four
// placements, outcome and stall state spelled out cell by cell. They restate
// the same verified rules the accuracy notes do -- failover needs BOTH the
// observer and a reachable target standby to have lost the primary, the
// primary stalls only when it can reach NEITHER, and no observer at all means
// fast-start failover was never armed. If a cell here has to change, check it
// against docs.oracle.com first.
//
// Every cell assumes ObserverOverride = FALSE, the broker default. Set TRUE,
// the property lets the observer initiate a failover once IT has lost the
// primary "even if the standby has a healthy connection to the primary" --
// which would turn several 'continues' cells into failovers. The page models
// the default only, and says so where it states the both-must-have-lost rule.

const LOCS: ClassicObserverLoc[] = ['none', 'dc1', 'dc2', 'dc3'];

const MATRIX: Record<string, string[]> = {
  //                none          dc1              dc2              dc3
  crash: ['manual', 'failover', 'failover', 'failover'],
  isolated: ['continues', 'continues', 'failover', 'failover'],
  partition: ['continues', 'continues', 'failover', 'continues'],
  dc2down: ['continues', 'continues', 'stall-noone', 'continues'],
  'observer-lost': ['manual', 'observer-lost', 'observer-lost', 'observer-lost'],
  switchover: ['switchover', 'switchover', 'switchover', 'switchover'],
};

const STALLED: Record<string, boolean[]> = {
  //                none    dc1     dc2     dc3
  crash: [false, false, false, false],
  isolated: [false, false, true, true],
  partition: [false, false, true, false],
  dc2down: [false, false, true, false],
  'observer-lost': [false, false, false, false],
  switchover: [false, false, false, false],
};

describe('MODEL: where the observer runs', () => {
  it('the placement matrix: 24 cells, outcome by scenario and observer location', () => {
    for (const [scenario, row] of Object.entries(MATRIX)) {
      row.forEach((want, i) => {
        const at = `${scenario}/${LOCS[i]}`;
        const m = fsfo({ scenario: scenario as ClassicScenario, observerLoc: LOCS[i] });
        expect(m.outcome, at).toBe(want);
        // Only one pairing is coerced: an observer that was never deployed
        // cannot be lost, so that cell is the plain crash.
        const eff = scenario === 'observer-lost' && LOCS[i] === 'none' ? 'crash' : scenario;
        expect(m.scenario, `${at} effective scenario`).toBe(eff);
      });
    }
  });

  it('the placement matrix: 24 cells, which of them stall the primary', () => {
    for (const [scenario, row] of Object.entries(STALLED)) {
      row.forEach((want, i) => {
        const at = `${scenario}/${LOCS[i]}`;
        const m = fsfo({ scenario: scenario as ClassicScenario, observerLoc: LOCS[i] });
        expect(m.stalled, at).toBe(want);
        // A stall plus FastStartFailoverPmyShutdown is what aborts the primary,
        // and the abort always runs on the threshold.
        expect(m.abort, `${at} abort`).toBe(want ? CDEF.threshold : null);
        for (const f of ['standbyGone', 'redoFlowing', 'pmyReachable'] as const) {
          expect(typeof m[f], `${at} ${f}`).toBe('boolean');
        }
      });
    }
  });

  it('back-compat: a configuration with no placement at all is the third site', () => {
    for (const scenario of Object.keys(MATRIX)) {
      const bare: Record<string, unknown> = { ...CDEF, scenario };
      delete bare.observerLoc;                 // an old share link or stored config
      expect(legacyComputeFsfo(bare as ClassicKnobs), scenario)
        .toEqual(fsfo({ scenario: scenario as ClassicScenario }));
    }
  });

  it('crash: the observer is on its own host, so all three placements agree', () => {
    const dc3 = fsfo({ scenario: 'crash' });
    expect(dc3.outcome).toBe('failover');
    for (const loc of ['dc1', 'dc2'] as const) {
      expect(fsfo({ scenario: 'crash', observerLoc: loc }), loc).toEqual(dc3);
    }
  });

  it('crash with no observer: manual FAILOVER only, and nothing bounds the loss', () => {
    const m = fsfo({ scenario: 'crash', observerLoc: 'none' });
    expect(m.outcome).toBe('manual');
    expect(m.detect).toBe(null);
    expect(m.initiate).toBe(null);
    expect(m.execStart).toBe(null);
    expect(m.tOpen).toBe(null);
    expect(m.abort).toBe(null);
    expect(m.blocked).toBe(false);
    expect(m.dataLossKind).toBe('manual');
    expect(m.dataLossSeconds).toBe(0);        // MaxAvailability: synchronized
    // MaxPerformance: the lag is the loss, and FastStartFailoverLagLimit does
    // not bound it -- that guarantee belongs to fast-start failover.
    const perf = fsfo({ scenario: 'crash', observerLoc: 'none', mode: 'maxperf',
      standbyLag: 42, lagLimit: 30 });
    expect(perf.dataLossKind).toBe('manual');
    expect(perf.dataLossSeconds).toBe(42);
    expect(perf.blocked).toBe(false);
  });

  it('isolated at the third site: the published baseline has not drifted', () => {
    const m = fsfo({ scenario: 'isolated' });
    expect(m.outcome).toBe('failover');
    expect(m.stalled).toBe(true);
    expect(m.initiate).toBe(30);
    expect(m.execStart).toBe(30);
    expect(m.tOpen).toBe(55);
    expect(m.abort).toBe(30);
    expect(m.blocked).toBe(false);
    expect(m.dataLossKind).toBe('none');
    expect(m.pmyReachable).toBe(false);
  });

  it('isolated with the observer at the primary site: it holds fire', () => {
    const m = fsfo({ scenario: 'isolated', observerLoc: 'dc1' });
    expect(m.outcome).toBe('continues');
    expect(m.stalled).toBe(false);            // the observer still answers
    expect(m.abort).toBe(null);
    expect(m.tOpen).toBe(null);
    expect(m.pmyReachable).toBe(false);       // serving, unreachable from outside
    expect(m.redoFlowing).toBe(false);        // and the standby is stranded
    expect(m.standbyGone).toBe(false);
  });

  it('a severed DC1-to-DC2 link fails a healthy primary over from the standby site', () => {
    const m = fsfo({ scenario: 'partition', observerLoc: 'dc2' });
    expect(m.outcome).toBe('failover');
    expect(m.stalled).toBe(true);
    expect(m.initiate).toBe(30);
    expect(m.tOpen).toBe(55);
    expect(m.abort).toBe(30);
    expect(m.pmyReachable).toBe(true);        // nothing was ever wrong with it
    expect(m.redoFlowing).toBe(false);
    // FastStartFailoverPmyShutdown gates the self-abort here exactly as it does
    // under full isolation; the failover happens either way.
    const stay = fsfo({ scenario: 'partition', observerLoc: 'dc2', pmyShutdown: false });
    expect(stay.abort).toBe(null);
    expect(stay.outcome).toBe('failover');
    expect(stay.stalled).toBe(true);
  });

  it('a third-site observer arbitrates a severed DC1-to-DC2 link', () => {
    const m = fsfo({ scenario: 'partition', observerLoc: 'dc3' });
    expect(m.outcome).toBe('continues');
    expect(m.stalled).toBe(false);
    expect(m.abort).toBe(null);
    expect(m.tOpen).toBe(null);
    expect(m.redoFlowing).toBe(false);        // transport is down, commits are not
    expect(m.pmyReachable).toBe(true);
  });

  it('losing the standby site takes a standby-site observer with it', () => {
    const m = fsfo({ scenario: 'dc2down', observerLoc: 'dc2' });
    expect(m.outcome).toBe('stall-noone');
    expect(m.stalled).toBe(true);
    expect(m.standbyGone).toBe(true);
    expect(m.initiate).toBe(null);
    expect(m.execStart).toBe(null);
    expect(m.tOpen).toBe(null);
    expect(m.ifDiedNow).toBe(null);           // no target left to price
    expect(m.abort).toBe(30);                 // stalled + PmyShutdown
    expect(fsfo({ scenario: 'dc2down', observerLoc: 'dc2', pmyShutdown: false }).abort).toBe(null);
  });

  it('losing the standby site elsewhere leaves the primary serving, unprotected', () => {
    for (const loc of ['none', 'dc1', 'dc3'] as const) {
      const m = fsfo({ scenario: 'dc2down', observerLoc: loc });
      expect(m.outcome, loc).toBe('continues');
      expect(m.stalled, loc).toBe(false);
      expect(m.standbyGone, loc).toBe(true);
      expect(m.redoFlowing, loc).toBe(false);
      expect(m.pmyReachable, loc).toBe(true);
      expect(m.ifDiedNow, loc).toBe(null);    // nothing to fail over to
    }
  });

  // observerLoc 'none' means fast-start failover was never ENABLED, which is an
  // explicit simulator convention -- and a documented state, not an invention:
  // Table 5-1 gives FS_FAILOVER_STATUS = DISABLED for a configuration with
  // fast-start failover disabled. It is deliberately NOT the unobserved state,
  // whose status is PRIMARY UNOBSERVED -- and that one is a TARGET STANDBY-side
  // reading: the primary in an unobserved configuration still reports
  // SYNCHRONIZED, with FS_FAILOVER_OBSERVER_PRESENT = NO. The observer-lost
  // scenario is where the model puts unobserved; 'none' never reaches it.
  it('no observer deployed means no fast-start failover in any scenario', () => {
    for (const scenario of ['crash', 'isolated', 'partition', 'dc2down', 'observer-lost'] as const) {
      const m = fsfo({ scenario, observerLoc: 'none' });
      expect(m.outcome, scenario).not.toBe('failover');
      expect(m.stalled, scenario).toBe(false);
      expect(m.initiate, scenario).toBe(null);
      expect(m.tOpen, scenario).toBe(null);
      expect(m.abort, scenario).toBe(null);
    }
    // The one role transition that never needed an observer still runs.
    const sw = fsfo({ scenario: 'switchover', observerLoc: 'none' });
    expect(sw.outcome).toBe('switchover');
    expect(sw.tOpen).toBe(1 + 2 + (CDEF.standbyLag as number) + (CDEF.roleTransition as number));
  });

  it('a switchover never needs the observer, so the placement changes nothing', () => {
    // Full-object deepEqual: the switchover branch has no per-placement field
    // and its effective scenario is always 'switchover', so nothing legitimately
    // differs between the four columns.
    const dc3 = fsfo({ scenario: 'switchover' });
    for (const loc of ['none', 'dc1', 'dc2'] as const) {
      expect(fsfo({ scenario: 'switchover', observerLoc: loc }), loc).toEqual(dc3);
    }
    // The MaxPerformance lag-limit refusal is FSFO's own gate: it fires wherever
    // an observer is deployed, and cannot fire where none is.
    const past = { scenario: 'switchover' as const, mode: 'maxperf' as const, standbyLag: 45, lagLimit: 30 };
    const refusedDc3 = fsfo(past);
    expect(refusedDc3.blocked).toBe(true);
    for (const loc of ['dc1', 'dc2'] as const) {
      expect(fsfo({ ...past, observerLoc: loc }), loc).toEqual(refusedDc3);
    }
    const unGated = fsfo({ ...past, observerLoc: 'none' });
    expect(unGated.blocked).toBe(false);
    expect(unGated.tOpen).toBe(1 + 2 + 45 + (CDEF.roleTransition as number));
  });

  it('observer lost with no observer deployed is just the crash', () => {
    const m = fsfo({ scenario: 'observer-lost', observerLoc: 'none' });
    expect(m.scenario).toBe('crash');
    expect(m.outcome).toBe('manual');
    expect(m.observerLost).toBe(false);
    expect(m).toEqual(fsfo({ scenario: 'crash', observerLoc: 'none' }));
    // Wherever an observer actually is, losing it is still its own story.
    for (const loc of ['dc1', 'dc2', 'dc3'] as const) {
      const o = fsfo({ scenario: 'observer-lost', observerLoc: loc });
      expect(o.scenario, loc).toBe('observer-lost');
      expect(o.outcome, loc).toBe('observer-lost');
      expect(o.observerLost, loc).toBe(true);
    }
  });

  it('the ping quirk moves the observer clock only, wherever the observer sits', () => {
    const m = fsfo({ scenario: 'partition', observerLoc: 'dc2', pingSet: true });
    near(m.initiate, 1.1, 'initiate');
    near(m.detect, 1.1, 'detect');
    expect(m.abort).toBe(30);       // the primary's stall clock is the threshold
  });
});

// ---------- MODEL: the 26ai release ----------
//
// c.version opens a second axis: '26ai' unlocks the MaxAvailability lag policy
// and the two lag properties. It changes nothing about the placement axis --
// the 24-cell table above holds in both editions, which the invariance loops
// below pin down.

describe('MODEL: the 26ai release', () => {
  // 26ai gave FastStartFailoverLagLimit a MaxAvailability role. Source: the 26ai
  // broker guide's "Fast-start Failover Protection Modes" section -- MaxAvailability
  // is "guaranteed to either lose no data (when the FastStartFailoverLagLimit
  // configuration property is set to zero) or lose no more than the amount of data
  // (in seconds) specified by" it, and with a non-zero value "failover is possible
  // any time the standby database's apply lag is less than or equal to the value".
  // The broker default there is 0; in MaxPerformance it stays 30 s. Do NOT cite the
  // property page's closing line or the chapter's Task 3: both still carry the stale
  // 19c sentence saying the property is used in maximum performance mode only.
  it('26ai: MaxAvailability at lag limit 0 is the 19c story, whatever the lag', () => {
    // 'zero' is the in-model default, so an input that says nothing about the
    // policy -- every old link, stored config and export file -- lands here.
    for (const over of [{}, { lagPolicy: 'zero' }, { lagPolicy: 'nonsense' }]) {
      const at = JSON.stringify(over);
      const m = fsfo({ version: '26ai', standbyLag: 80, lagLimit: 30, ...over } as never);
      expect(m.blocked, at).toBe(false);
      expect(m.dataLossKind, at).toBe('none');
      expect(m.dataLossSeconds, at).toBe(0);
      expect(m.outcome, at).toBe('failover');
    }
  });

  it('26ai: MaxAvailability set to bounded is gated by the lag limit', () => {
    const at = fsfo({ version: '26ai', lagPolicy: 'bounded', standbyLag: 30, lagLimit: 30 });
    expect(at.blocked).toBe(false);                 // at the limit is still eligible
    expect(at.dataLossKind).toBe('bounded');
    expect(at.dataLossSeconds).toBe(30);
    expect(at.initiate).toBe(30);                   // and no clock moved for any of it
    expect(at.tOpen).toBe(75);                      // 30 + 30 apply + 15 role change
    const over = fsfo({ version: '26ai', lagPolicy: 'bounded', standbyLag: 31, lagLimit: 30 });
    expect(over.blocked).toBe(true);
    expect(over.dataLossKind).toBe('na');
    expect(over.dataLossSeconds).toBe(0);
    // The same policy in MaxPerformance changes nothing: the limit already gated it.
    expect(fsfo({ version: '26ai', mode: 'maxperf', lagPolicy: 'bounded' }))
      .toEqual(fsfo({ version: '26ai', mode: 'maxperf' }));
  });

  it('19c: the MaxAvailability lag policy is 26ai-only, so it moves nothing', () => {
    for (const version of [undefined, '19c'] as const) {
      expect(fsfo({ version, lagPolicy: 'bounded', standbyLag: 80, lagLimit: 30 }),
        `${version ?? 'absent'}`).toEqual(fsfo({ version, standbyLag: 80, lagLimit: 30 }));
    }
  });

  it('26ai: lagStall is MaxPerformance-only, and lagType echoes the property', () => {
    // The flag prices a growing lag, not t = 0, so it is a shape for the prose
    // and the reopen panel -- computeFsfo moves no clock for it. It stays
    // MaxPerformance-only in 26ai whatever the MaxAvailability lag limit is
    // doing: both FastStartFailoverLagType and FastStartFailoverLagGraceTime are
    // documented as "used when fast-start failover is enabled and the
    // configuration is operating in maximum performance mode".
    expect(fsfo({ version: '26ai' }).lagStall).toBe(null);                       // MaxAvailability
    expect(fsfo({ version: '26ai', lagPolicy: 'bounded', lagGraceTime: 30 }).lagStall).toBe(null);
    expect(fsfo({ version: '26ai', lagPolicy: 'bounded' }).lagType).toBe('apply');
    expect(fsfo({ version: '26ai', mode: 'maxperf', observerLoc: 'none' }).lagStall).toBe(null);
    expect(fsfo({ version: '26ai', mode: 'maxperf' }).lagStall)
      .toEqual({ armed: false, graceTime: 0, maxSeconds: 30 });
    expect(fsfo({ version: '26ai', mode: 'maxperf', lagGraceTime: 10, threshold: 45 }).lagStall)
      .toEqual({ armed: true, graceTime: 10, maxSeconds: 45 });
    // TRANSPORT is documented for maximum performance mode only, so the echo
    // reads APPLY everywhere else -- including 26ai MaxAvailability.
    expect(fsfo({ version: '26ai', mode: 'maxperf', lagType: 'transport' }).lagType).toBe('transport');
    expect(fsfo({ version: '26ai', lagType: 'transport' }).lagType).toBe('apply');
    expect(fsfo({ version: '26ai' }).lagType).toBe('apply');
  });

  it('26ai TRANSPORT: the readiness gate follows the transport lag, not the apply lag', () => {
    const base = { version: '26ai' as const, mode: 'maxperf' as const, lagType: 'transport' as const,
      standbyLag: 80, lagLimit: 30 };
    // Transport lag within the limit: failover permitted despite the deep apply
    // queue -- redo already received is applied during terminal recovery.
    const ok = fsfo({ ...base, transportLag: 5 });
    expect(ok.blocked).toBe(false);
    expect(ok.gateLagSeconds).toBe(5);
    expect(ok.dataLossSeconds).toBe(5);           // the loss bound is the gated lag
    expect(ok.applyRemaining).toBe(80);           // terminal recovery still pays the apply lag
    // Transport lag beyond the limit blocks, exactly like apply lag under APPLY.
    expect(fsfo({ ...base, transportLag: 40 }).blocked).toBe(true);
    // Clamped: transport lag can never exceed the apply lag.
    expect(fsfo({ ...base, standbyLag: 10, transportLag: 40 }).gateLagSeconds).toBe(10);
    // Absent (an older link or export): falls back to the apply lag, which is
    // exactly the pre-slider behavior.
    expect(fsfo(base).blocked).toBe(true);
    // The switchover gate follows the same selected lag.
    expect(fsfo({ ...base, scenario: 'switchover', transportLag: 5 }).blocked).toBe(false);
    expect(fsfo({ ...base, scenario: 'switchover', transportLag: 40 }).blocked).toBe(true);
    // Under APPLY the transport lag input moves nothing.
    expect(fsfo({ version: '26ai', mode: 'maxperf', standbyLag: 80, lagLimit: 30, transportLag: 5 }))
      .toEqual(fsfo({ version: '26ai', mode: 'maxperf', standbyLag: 80, lagLimit: 30 }));
  });

  it('19c invariance: version absent and explicit 19c agree, cell for cell', () => {
    for (const scenario of Object.keys(MATRIX)) {
      for (const loc of LOCS) {
        expect(fsfo({ scenario: scenario as ClassicScenario, observerLoc: loc, version: '19c' }),
          `${scenario}/${loc}`)
          .toEqual(fsfo({ scenario: scenario as ClassicScenario, observerLoc: loc }));
      }
    }
  });

  it('19c invariance: every cell still reads off the 24-cell tables, new fields inert', () => {
    for (const version of [undefined, '19c'] as const) {
      for (const [scenario, row] of Object.entries(MATRIX)) {
        LOCS.forEach((loc, i) => {
          const at = `${scenario}/${loc}/${version ?? 'absent'}`;
          // Every 26ai-only input along for the ride: none of them may move a
          // 19c cell, whatever a crafted link or a 26ai-written export says.
          const m = fsfo({ scenario: scenario as ClassicScenario, observerLoc: loc, version,
            lagPolicy: 'bounded', lagType: 'transport', lagGraceTime: 30, transportLag: 3 });
          expect(m.outcome, at).toBe(row[i]);
          expect(m.stalled, `${at} stalled`).toBe(STALLED[scenario]?.[i]);
          expect(m.lagStall, `${at} lagStall`).toBe(null);
          expect(m.lagType, `${at} lagType`).toBe('apply');
        });
      }
    }
  });

  it('19c: the four 26ai knobs are inert', () => {
    // Set to non-defaults by a crafted link or an imported file, they change
    // nothing under 19c.
    expect(fsfo({ mode: 'maxperf', lagType: 'transport', lagGraceTime: 30,
      lagPolicy: 'bounded', transportLag: 3, version: '19c' }))
      .toEqual(fsfo({ mode: 'maxperf' }));
  });
});
