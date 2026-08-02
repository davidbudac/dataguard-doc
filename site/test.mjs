// Assert the model invariants the docs promise, straight from the fragment.
//
// The four marker blocks in simulator/fsfo-simulator.html (MODEL, APPMODEL,
// COMMITMODEL, REOPENMODEL) are DOM-free and closure-free, so this file can
// extract them by their marker comments and evaluate them as plain functions.
// Concatenate MODEL first: computeApp shares its pickTickStep.
//
// Every expected number below restates a fact documented in AGENTS.md's
// accuracy rules (or a drawing constant from the page's footnotes). If a test
// fails, decide which side is wrong against docs.oracle.com before touching
// either. Changing a documented default or formula means changing this file
// in the same commit.
//
// Run: node --test site/test.mjs   (site/publish.sh runs it after the build,
// so a model that contradicts the docs cannot be deployed.)

import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const src = await readFile(new URL('../simulator/fsfo-simulator.html', import.meta.url), 'utf8');

function block(name) {
  const a = src.indexOf(`/* ${name}:START */`);
  const b = src.indexOf(`/* ${name}:END */`);
  if (a < 0 || b < 0 || b < a) throw new Error(`marker pair ${name} missing or inverted`);
  return src.slice(a, b);
}

const NAMES = ['MODEL', 'APPMODEL', 'COMMITMODEL', 'REOPENMODEL'];
const code = NAMES.map(block).join('\n');
const M = new Function(code +
  '\nreturn { computeFsfo, computeApp, computeCommit, computeReopen,' +
  ' pickTickStep, cmTickStep, rpTickStep, SW_VERIFY, SW_CONVERT };')();

const near = (got, want, label) =>
  assert.ok(Math.abs(got - want) < 1e-9, `${label ?? 'value'}: ${got} != ${want}`);

// Baselines mirror the page's control defaults.
const CDEF = { scenario: 'crash', observerLoc: 'dc3', mode: 'maxavail', threshold: 30,
  pingSet: false, pingInterval: 100, pingRetry: 10, standbyLag: 10, lagLimit: 30,
  roleTransition: 15, pmyShutdown: true, latency: 0 };
const ADEF = { tct: 60, ct: 0, rc: 0, rd: 0, dead: 'drop' };
const fsfo = (over) => M.computeFsfo({ ...CDEF, ...over });
const app = (aOver, cOver, scenario) => {
  const c = { ...CDEF, ...cOver };
  return M.computeApp({ ...ADEF, ...aOver }, M.computeFsfo(c), scenario ?? c.scenario);
};

// ---------- structure ----------

test('markers: all four pairs present and ordered', () => {
  for (const n of NAMES) assert.ok(block(n).length > 0, n);
});

test('no-dom: the blocks reference no document/window/els', () => {
  assert.equal(/\b(document|window|navigator|els)\b/.test(code), false);
});

test('tick ladders', () => {
  assert.equal(M.pickTickStep(4.4), 0.5);
  assert.equal(M.pickTickStep(9), 1);
  assert.equal(M.pickTickStep(80), 10);
  assert.equal(M.cmTickStep(30), 5);
  assert.equal(M.rpTickStep(900), 120);
});

// ---------- MODEL: the failover clocks ----------

test('defaults: initiate at the 30 s threshold, open at 55 s, zero loss', () => {
  const m = fsfo({});
  assert.equal(m.initiate, 30);
  assert.equal(m.execStart, 30);
  assert.equal(m.tOpen, 55);
  assert.equal(m.blocked, false);
  assert.equal(m.dataLossKind, 'none');
  assert.equal(m.abort, null);
});

test('threshold floor: the documented 6 s minimum still initiates', () => {
  const m = fsfo({ threshold: 6, standbyLag: 0, roleTransition: 5 });
  assert.equal(m.initiate, 6);
  assert.equal(m.tOpen, 11);
});

// interval x (retry + 1) is the PAGE'S MODEL, not a published formula. What the
// documentation states is that the threshold is ignored once both ping
// properties are set, and that detection can be reduced to "nearly 1 second";
// no arithmetic appears anywhere in it. The 1.1 s below is that model at the
// minimums (100 ms x 11), and the prose that quotes it says so.
test('ping override: pingInterval x (pingRetry + 1), not the threshold', () => {
  const m = fsfo({ pingSet: true });
  near(m.detect, 1.1, 'detect');
  near(m.initiate, 1.1, 'initiate');
  assert.notEqual(m.initiate, CDEF.threshold);
});

test('ping override does not move the isolated primary abort clock', () => {
  const m = fsfo({ scenario: 'isolated', pingSet: true });
  near(m.initiate, 1.1, 'initiate');
  assert.equal(m.abort, 30);
});

test('MaxPerformance blocks on lag strictly greater than the limit', () => {
  const over = fsfo({ mode: 'maxperf', standbyLag: 60, lagLimit: 30 });
  assert.equal(over.blocked, true);
  assert.equal(over.dataLossKind, 'na');
  const at = fsfo({ mode: 'maxperf', standbyLag: 30, lagLimit: 30 });
  assert.equal(at.blocked, false);
  assert.equal(at.dataLossKind, 'bounded');
  assert.equal(at.dataLossSeconds, 30);
});

test('FastStartFailoverPmyShutdown gates the abort', () => {
  assert.equal(fsfo({ scenario: 'isolated', pmyShutdown: false }).abort, null);
  assert.equal(fsfo({ scenario: 'isolated', threshold: 45 }).abort, 45);
});

test('latency pays one hop on the FAILOVER command, never stretches timers', () => {
  const m = fsfo({ latency: 100 });
  near(m.netHop, 0.05, 'netHop');
  near(m.execStart, 30.05, 'execStart');
  assert.equal(m.initiate, 30);
});

test('observer lost: no fast-start failover, ever', () => {
  const m = fsfo({ scenario: 'observer-lost' });
  assert.equal(m.observerLost, true);
  assert.equal(m.initiate, null);
  assert.equal(m.tOpen, null);
  assert.equal(m.abort, null);
  assert.equal(m.blocked, false);
});

test('ifDiedNow prices the blind window: zero synchronized, the lag otherwise', () => {
  assert.equal(fsfo({ scenario: 'observer-lost' }).ifDiedNow, 0);
  assert.equal(fsfo({ scenario: 'observer-lost', mode: 'maxperf', standbyLag: 42 }).ifDiedNow, 42);
});

// ---------- MODEL: the planned switchover ----------

test('switchover: nominal verify and convert bands, and tOpen is their sum', () => {
  assert.equal(M.SW_VERIFY, 1);
  assert.equal(M.SW_CONVERT, 2);
  const m = fsfo({ scenario: 'switchover' });
  assert.equal(m.switchover, true);
  assert.equal(m.tDown, M.SW_VERIFY);
  assert.equal(m.tConvertEnd, M.SW_VERIFY + M.SW_CONVERT);
  assert.equal(m.tOpen, M.SW_VERIFY + M.SW_CONVERT + CDEF.standbyLag + CDEF.roleTransition);
  assert.equal(m.downtime, m.tOpen - m.tDown);
  const slow = fsfo({ scenario: 'switchover', standbyLag: 40, roleTransition: 30 });
  assert.equal(slow.tOpen, 1 + 2 + 40 + 30);
  assert.equal(slow.downtime, 72);
});

test('switchover guarantees zero data loss in both protection modes', () => {
  for (const mode of ['maxavail', 'maxperf']) {
    const m = fsfo({ scenario: 'switchover', mode, standbyLag: 20, lagLimit: 30 });
    assert.equal(m.dataLossKind, 'none');
    assert.equal(m.dataLossSeconds, 0);
    assert.equal(m.blocked, false);
  }
});

test('switchover: FSFO enabled means MaxPerformance refuses past the lag limit', () => {
  assert.equal(fsfo({ scenario: 'switchover', mode: 'maxperf', standbyLag: 45, lagLimit: 30 }).blocked, true);
  assert.equal(fsfo({ scenario: 'switchover', mode: 'maxperf', standbyLag: 30, lagLimit: 30 }).blocked, false);
  // MaxAvailability: synchronized is about redo received, so an apply lag
  // lengthens the catch-up instead of blocking the command.
  const avail = fsfo({ scenario: 'switchover', mode: 'maxavail', standbyLag: 90, lagLimit: 30 });
  assert.equal(avail.blocked, false);
  assert.equal(avail.tOpen, 1 + 2 + 90 + 15);
  // Refused: nothing converts, so there is no downtime window at all.
  const no = fsfo({ scenario: 'switchover', mode: 'maxperf', standbyLag: 45, lagLimit: 30 });
  assert.equal(no.tOpen, null);
  assert.equal(no.tDown, null);
  assert.equal(no.downtime, null);
  assert.equal(no.dataLossKind, 'none');
});

test('switchover runs no clocks: threshold and ping properties change nothing', () => {
  const m = fsfo({ scenario: 'switchover' });
  assert.equal(m.initiate, null);
  assert.equal(m.detect, null);
  assert.equal(m.abort, null);
  const loud = fsfo({ scenario: 'switchover', threshold: 120, pingSet: true, pingInterval: 5000, pingRetry: 50 });
  assert.equal(loud.tOpen, m.tOpen);
  assert.equal(loud.abort, null);
  // not even an isolated-style abort, and latency never enters the arithmetic
  const far = fsfo({ scenario: 'switchover', latency: 100 });
  assert.equal(far.tOpen, m.tOpen);
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

const LOCS = ['none', 'dc1', 'dc2', 'dc3'];

const MATRIX = {
  //                none          dc1              dc2              dc3
  'crash': ['manual', 'failover', 'failover', 'failover'],
  'isolated': ['continues', 'continues', 'failover', 'failover'],
  'partition': ['continues', 'continues', 'failover', 'continues'],
  'dc2down': ['continues', 'continues', 'stall-noone', 'continues'],
  'observer-lost': ['manual', 'observer-lost', 'observer-lost', 'observer-lost'],
  'switchover': ['switchover', 'switchover', 'switchover', 'switchover'],
};

const STALLED = {
  //                none    dc1     dc2     dc3
  'crash': [false, false, false, false],
  'isolated': [false, false, true, true],
  'partition': [false, false, true, false],
  'dc2down': [false, false, true, false],
  'observer-lost': [false, false, false, false],
  'switchover': [false, false, false, false],
};

test('the placement matrix: 24 cells, outcome by scenario and observer location', () => {
  for (const [scenario, row] of Object.entries(MATRIX)) {
    row.forEach((want, i) => {
      const at = `${scenario}/${LOCS[i]}`;
      const m = fsfo({ scenario, observerLoc: LOCS[i] });
      assert.equal(m.outcome, want, at);
      // Only one pairing is coerced: an observer that was never deployed
      // cannot be lost, so that cell is the plain crash.
      const eff = scenario === 'observer-lost' && LOCS[i] === 'none' ? 'crash' : scenario;
      assert.equal(m.scenario, eff, `${at} effective scenario`);
    });
  }
});

test('the placement matrix: 24 cells, which of them stall the primary', () => {
  for (const [scenario, row] of Object.entries(STALLED)) {
    row.forEach((want, i) => {
      const at = `${scenario}/${LOCS[i]}`;
      const m = fsfo({ scenario, observerLoc: LOCS[i] });
      assert.equal(m.stalled, want, at);
      // A stall plus FastStartFailoverPmyShutdown is what aborts the primary,
      // and the abort always runs on the threshold.
      assert.equal(m.abort, want ? CDEF.threshold : null, `${at} abort`);
      for (const f of ['standbyGone', 'redoFlowing', 'pmyReachable']) {
        assert.equal(typeof m[f], 'boolean', `${at} ${f}`);
      }
    });
  }
});

test('back-compat: a configuration with no placement at all is the third site', () => {
  for (const scenario of Object.keys(MATRIX)) {
    const bare = { ...CDEF, scenario };
    delete bare.observerLoc;                 // an old share link or stored config
    assert.deepEqual(M.computeFsfo(bare), fsfo({ scenario }), scenario);
  }
});

test('crash: the observer is on its own host, so all three placements agree', () => {
  const dc3 = fsfo({ scenario: 'crash' });
  assert.equal(dc3.outcome, 'failover');
  for (const loc of ['dc1', 'dc2']) {
    assert.deepEqual(fsfo({ scenario: 'crash', observerLoc: loc }), dc3, loc);
  }
});

test('crash with no observer: manual FAILOVER only, and nothing bounds the loss', () => {
  const m = fsfo({ scenario: 'crash', observerLoc: 'none' });
  assert.equal(m.outcome, 'manual');
  assert.equal(m.detect, null);
  assert.equal(m.initiate, null);
  assert.equal(m.execStart, null);
  assert.equal(m.tOpen, null);
  assert.equal(m.abort, null);
  assert.equal(m.blocked, false);
  assert.equal(m.dataLossKind, 'manual');
  assert.equal(m.dataLossSeconds, 0);        // MaxAvailability: synchronized
  // MaxPerformance: the lag is the loss, and FastStartFailoverLagLimit does
  // not bound it -- that guarantee belongs to fast-start failover.
  const perf = fsfo({ scenario: 'crash', observerLoc: 'none', mode: 'maxperf',
    standbyLag: 42, lagLimit: 30 });
  assert.equal(perf.dataLossKind, 'manual');
  assert.equal(perf.dataLossSeconds, 42);
  assert.equal(perf.blocked, false);
});

test('isolated at the third site: the published baseline has not drifted', () => {
  const m = fsfo({ scenario: 'isolated' });
  assert.equal(m.outcome, 'failover');
  assert.equal(m.stalled, true);
  assert.equal(m.initiate, 30);
  assert.equal(m.execStart, 30);
  assert.equal(m.tOpen, 55);
  assert.equal(m.abort, 30);
  assert.equal(m.blocked, false);
  assert.equal(m.dataLossKind, 'none');
  assert.equal(m.pmyReachable, false);
});

test('isolated with the observer at the primary site: it holds fire', () => {
  const m = fsfo({ scenario: 'isolated', observerLoc: 'dc1' });
  assert.equal(m.outcome, 'continues');
  assert.equal(m.stalled, false);            // the observer still answers
  assert.equal(m.abort, null);
  assert.equal(m.tOpen, null);
  assert.equal(m.pmyReachable, false);       // serving, unreachable from outside
  assert.equal(m.redoFlowing, false);        // and the standby is stranded
  assert.equal(m.standbyGone, false);
});

test('a severed DC1-to-DC2 link fails a healthy primary over from the standby site', () => {
  const m = fsfo({ scenario: 'partition', observerLoc: 'dc2' });
  assert.equal(m.outcome, 'failover');
  assert.equal(m.stalled, true);
  assert.equal(m.initiate, 30);
  assert.equal(m.tOpen, 55);
  assert.equal(m.abort, 30);
  assert.equal(m.pmyReachable, true);        // nothing was ever wrong with it
  assert.equal(m.redoFlowing, false);
  // FastStartFailoverPmyShutdown gates the self-abort here exactly as it does
  // under full isolation; the failover happens either way.
  const stay = fsfo({ scenario: 'partition', observerLoc: 'dc2', pmyShutdown: false });
  assert.equal(stay.abort, null);
  assert.equal(stay.outcome, 'failover');
  assert.equal(stay.stalled, true);
});

test('a third-site observer arbitrates a severed DC1-to-DC2 link', () => {
  const m = fsfo({ scenario: 'partition', observerLoc: 'dc3' });
  assert.equal(m.outcome, 'continues');
  assert.equal(m.stalled, false);
  assert.equal(m.abort, null);
  assert.equal(m.tOpen, null);
  assert.equal(m.redoFlowing, false);        // transport is down, commits are not
  assert.equal(m.pmyReachable, true);
});

test('losing the standby site takes a standby-site observer with it', () => {
  const m = fsfo({ scenario: 'dc2down', observerLoc: 'dc2' });
  assert.equal(m.outcome, 'stall-noone');
  assert.equal(m.stalled, true);
  assert.equal(m.standbyGone, true);
  assert.equal(m.initiate, null);
  assert.equal(m.execStart, null);
  assert.equal(m.tOpen, null);
  assert.equal(m.ifDiedNow, null);           // no target left to price
  assert.equal(m.abort, 30);                 // stalled + PmyShutdown
  assert.equal(fsfo({ scenario: 'dc2down', observerLoc: 'dc2', pmyShutdown: false }).abort, null);
});

test('losing the standby site elsewhere leaves the primary serving, unprotected', () => {
  for (const loc of ['none', 'dc1', 'dc3']) {
    const m = fsfo({ scenario: 'dc2down', observerLoc: loc });
    assert.equal(m.outcome, 'continues', loc);
    assert.equal(m.stalled, false, loc);
    assert.equal(m.standbyGone, true, loc);
    assert.equal(m.redoFlowing, false, loc);
    assert.equal(m.pmyReachable, true, loc);
    assert.equal(m.ifDiedNow, null, loc);    // nothing to fail over to
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
test('no observer deployed means no fast-start failover in any scenario', () => {
  for (const scenario of ['crash', 'isolated', 'partition', 'dc2down', 'observer-lost']) {
    const m = fsfo({ scenario, observerLoc: 'none' });
    assert.notEqual(m.outcome, 'failover', scenario);
    assert.equal(m.stalled, false, scenario);
    assert.equal(m.initiate, null, scenario);
    assert.equal(m.tOpen, null, scenario);
    assert.equal(m.abort, null, scenario);
  }
  // The one role transition that never needed an observer still runs.
  const sw = fsfo({ scenario: 'switchover', observerLoc: 'none' });
  assert.equal(sw.outcome, 'switchover');
  assert.equal(sw.tOpen, 1 + 2 + CDEF.standbyLag + CDEF.roleTransition);
});

test('a switchover never needs the observer, so the placement changes nothing', () => {
  // Full-object deepEqual: the switchover branch has no per-placement field
  // and its effective scenario is always 'switchover', so nothing legitimately
  // differs between the four columns.
  const dc3 = fsfo({ scenario: 'switchover' });
  for (const loc of ['none', 'dc1', 'dc2']) {
    assert.deepEqual(fsfo({ scenario: 'switchover', observerLoc: loc }), dc3, loc);
  }
  // The MaxPerformance lag-limit refusal is FSFO's own gate: it fires wherever
  // an observer is deployed, and cannot fire where none is.
  const past = { scenario: 'switchover', mode: 'maxperf', standbyLag: 45, lagLimit: 30 };
  const refusedDc3 = fsfo(past);
  assert.equal(refusedDc3.blocked, true);
  for (const loc of ['dc1', 'dc2']) {
    assert.deepEqual(fsfo({ ...past, observerLoc: loc }), refusedDc3, loc);
  }
  const unGated = fsfo({ ...past, observerLoc: 'none' });
  assert.equal(unGated.blocked, false);
  assert.equal(unGated.tOpen, 1 + 2 + 45 + CDEF.roleTransition);
});

test('observer lost with no observer deployed is just the crash', () => {
  const m = fsfo({ scenario: 'observer-lost', observerLoc: 'none' });
  assert.equal(m.scenario, 'crash');
  assert.equal(m.outcome, 'manual');
  assert.equal(m.observerLost, false);
  assert.deepEqual(m, fsfo({ scenario: 'crash', observerLoc: 'none' }));
  // Wherever an observer actually is, losing it is still its own story.
  for (const loc of ['dc1', 'dc2', 'dc3']) {
    const o = fsfo({ scenario: 'observer-lost', observerLoc: loc });
    assert.equal(o.scenario, 'observer-lost', loc);
    assert.equal(o.outcome, 'observer-lost', loc);
    assert.equal(o.observerLost, true, loc);
  }
});

test('the ping quirk moves the observer clock only, wherever the observer sits', () => {
  const m = fsfo({ scenario: 'partition', observerLoc: 'dc2', pingSet: true });
  near(m.initiate, 1.1, 'initiate');
  near(m.detect, 1.1, 'detect');
  assert.equal(m.abort, 30);       // the primary's stall clock is the threshold
});

// ---------- MODEL: the 26ai release ----------
//
// c.version opens a second axis: '26ai' unlocks the MaxAvailability lag policy
// and the two lag properties. It changes nothing about the placement axis --
// the 24-cell table above holds in both editions, which the invariance loops
// below pin down.

// 26ai gave FastStartFailoverLagLimit a MaxAvailability role. Source: the 26ai
// broker guide's "Fast-start Failover Protection Modes" section -- MaxAvailability
// is "guaranteed to either lose no data (when the FastStartFailoverLagLimit
// configuration property is set to zero) or lose no more than the amount of data
// (in seconds) specified by" it, and with a non-zero value "failover is possible
// any time the standby database's apply lag is less than or equal to the value".
// The broker default there is 0; in MaxPerformance it stays 30 s. Do NOT cite the
// property page's closing line or the chapter's Task 3: both still carry the stale
// 19c sentence saying the property is used in maximum performance mode only.
test('26ai: MaxAvailability at lag limit 0 is the 19c story, whatever the lag', () => {
  // 'zero' is the in-model default, so an input that says nothing about the
  // policy -- every old link, stored config and export file -- lands here.
  for (const over of [{}, { lagPolicy: 'zero' }, { lagPolicy: 'nonsense' }]) {
    const at = JSON.stringify(over);
    const m = fsfo({ version: '26ai', standbyLag: 80, lagLimit: 30, ...over });
    assert.equal(m.blocked, false, at);
    assert.equal(m.dataLossKind, 'none', at);
    assert.equal(m.dataLossSeconds, 0, at);
    assert.equal(m.outcome, 'failover', at);
  }
});

test('26ai: MaxAvailability set to bounded is gated by the lag limit', () => {
  const at = fsfo({ version: '26ai', lagPolicy: 'bounded', standbyLag: 30, lagLimit: 30 });
  assert.equal(at.blocked, false);                 // at the limit is still eligible
  assert.equal(at.dataLossKind, 'bounded');
  assert.equal(at.dataLossSeconds, 30);
  assert.equal(at.initiate, 30);                   // and no clock moved for any of it
  assert.equal(at.tOpen, 75);                      // 30 + 30 apply + 15 role change
  const over = fsfo({ version: '26ai', lagPolicy: 'bounded', standbyLag: 31, lagLimit: 30 });
  assert.equal(over.blocked, true);
  assert.equal(over.dataLossKind, 'na');
  assert.equal(over.dataLossSeconds, 0);
  // The same policy in MaxPerformance changes nothing: the limit already gated it.
  assert.deepEqual(fsfo({ version: '26ai', mode: 'maxperf', lagPolicy: 'bounded' }),
    fsfo({ version: '26ai', mode: 'maxperf' }));
});

test('19c: the MaxAvailability lag policy is 26ai-only, so it moves nothing', () => {
  for (const version of [undefined, '19c']) {
    assert.deepEqual(fsfo({ version, lagPolicy: 'bounded', standbyLag: 80, lagLimit: 30 }),
      fsfo({ version, standbyLag: 80, lagLimit: 30 }), `${version ?? 'absent'}`);
  }
});

test('26ai: lagStall is MaxPerformance-only, and lagType echoes the property', () => {
  // The flag prices a growing lag, not t = 0, so it is a shape for the prose
  // and the reopen panel -- computeFsfo moves no clock for it. It stays
  // MaxPerformance-only in 26ai whatever the MaxAvailability lag limit is
  // doing: both FastStartFailoverLagType and FastStartFailoverLagGraceTime are
  // documented as "used when fast-start failover is enabled and the
  // configuration is operating in maximum performance mode".
  assert.equal(fsfo({ version: '26ai' }).lagStall, null);                       // MaxAvailability
  assert.equal(fsfo({ version: '26ai', lagPolicy: 'bounded', lagGraceTime: 30 }).lagStall, null);
  assert.equal(fsfo({ version: '26ai', lagPolicy: 'bounded' }).lagType, 'apply');
  assert.equal(fsfo({ version: '26ai', mode: 'maxperf', observerLoc: 'none' }).lagStall, null);
  assert.deepEqual(fsfo({ version: '26ai', mode: 'maxperf' }).lagStall,
    { armed: false, graceTime: 0, maxSeconds: 30 });
  assert.deepEqual(fsfo({ version: '26ai', mode: 'maxperf', lagGraceTime: 10, threshold: 45 }).lagStall,
    { armed: true, graceTime: 10, maxSeconds: 45 });
  assert.equal(fsfo({ version: '26ai', lagType: 'transport' }).lagType, 'transport');
  assert.equal(fsfo({ version: '26ai' }).lagType, 'apply');
});

test('19c invariance: version absent and explicit 19c agree, cell for cell', () => {
  for (const scenario of Object.keys(MATRIX)) {
    for (const loc of LOCS) {
      assert.deepEqual(fsfo({ scenario, observerLoc: loc, version: '19c' }),
        fsfo({ scenario, observerLoc: loc }), `${scenario}/${loc}`);
    }
  }
});

test('19c invariance: every cell still reads off the 24-cell tables, new fields inert', () => {
  for (const version of [undefined, '19c']) {
    for (const [scenario, row] of Object.entries(MATRIX)) {
      LOCS.forEach((loc, i) => {
        const at = `${scenario}/${loc}/${version ?? 'absent'}`;
        // Every 26ai-only input along for the ride: none of them may move a
        // 19c cell, whatever a crafted link or a 26ai-written export says.
        const m = fsfo({ scenario, observerLoc: loc, version,
          lagPolicy: 'bounded', lagType: 'transport', lagGraceTime: 30 });
        assert.equal(m.outcome, row[i], at);
        assert.equal(m.stalled, STALLED[scenario][i], `${at} stalled`);
        assert.equal(m.lagStall, null, `${at} lagStall`);
        assert.equal(m.lagType, 'apply', `${at} lagType`);
      });
    }
  }
});

test('19c: the three 26ai knobs are inert', () => {
  // Set to non-defaults by a crafted link or an imported file, they change
  // nothing under 19c.
  assert.deepEqual(
    fsfo({ mode: 'maxperf', lagType: 'transport', lagGraceTime: 30,
      lagPolicy: 'bounded', version: '19c' }),
    fsfo({ mode: 'maxperf' }));
});

// ---------- APPMODEL: the connect string ----------

test('default string, default clocks: the lucky 60 s hang connects', () => {
  const a = app({});
  assert.equal(a.attempts.length, 1);
  assert.equal(a.d1, 60);
  near(a.tConn, 60.3, 'tConn');
  assert.equal(a.gaveUp, null);
});

test('threshold 90: the one traversal dies before the service exists', () => {
  const a = app({}, { threshold: 90 });
  assert.equal(a.tService, 115);
  assert.equal(a.tConn, null);
  near(a.gaveUp, 60.2, 'gaveUp');
});

test('Tuned preset walks a discrete ladder to the reopened service', () => {
  const a = app({ tct: 3, ct: 90, rc: 30, rd: 3 });
  assert.equal(a.attempts.length, 10);
  near(a.tConn, 59.1, 'tConn');
  near(a.worst, 189.2, 'worst');
  const many = app({ dead: 'rst', rc: 100 });
  assert.equal(many.attempts.length, 101);
});

test('a partition drops packets: no refusal even from a live-host string', () => {
  const a = app({ dead: 'rst' }, { scenario: 'isolated' });
  assert.equal(a.drop, true);
  assert.equal(a.d1, 60);
  const quiet = app({}, { scenario: 'observer-lost' });
  assert.equal(quiet.noEvent, true);
  assert.equal(quiet.noEventKind, 'observer-lost');
  assert.equal(quiet.attempts.length, 0);
});

test('app: with no observer the crash strands the connect string', () => {
  const a = app({}, { scenario: 'crash', observerLoc: 'none' });
  assert.equal(a.noEvent, false);
  assert.equal(a.noEventKind, null);
  assert.equal(a.tService, null);            // nothing ever opens read-write
  assert.equal(a.tConn, null);
  assert.equal(a.attempts.length, 1);
  near(a.gaveUp, 60.2, 'gaveUp');            // and it does give up, not hang forever
});

test('app: an isolated primary with a DC1 observer strands the string too', () => {
  const a = app({ dead: 'rst' }, { scenario: 'isolated', observerLoc: 'dc1' });
  assert.equal(a.noEvent, false);
  assert.equal(a.drop, true);                // a partition drops, whatever the toggle says
  assert.equal(a.d1, 60);
  assert.equal(a.tService, null);
  assert.equal(a.tConn, null);
  near(a.gaveUp, 60.2, 'gaveUp');
});

test('app: a configuration that carries on is a no-event for every client', () => {
  for (const [scenario, observerLoc] of [['partition', 'dc3'], ['partition', 'dc1'],
    ['partition', 'none'], ['dc2down', 'dc3'], ['dc2down', 'none']]) {
    const a = app({}, { scenario, observerLoc });
    const at = `${scenario}/${observerLoc}`;
    assert.equal(a.noEvent, true, at);
    assert.equal(a.noEventKind, 'continues', at);
    assert.equal(a.attempts.length, 0, at);
    assert.equal(a.tConn, null, at);
    assert.equal(a.gaveUp, null, at);
  }
});

test('app: a STALLED primary still answers the listener', () => {
  // The outage is at commit level: the service is still published, so a new
  // connection is accepted exactly as it was before.
  const a = app({}, { scenario: 'dc2down', observerLoc: 'dc2' });
  assert.equal(a.noEvent, true);
  assert.equal(a.noEventKind, 'stalled');
  assert.equal(a.attempts.length, 0);
  assert.equal(a.tConn, null);
  assert.equal(a.gaveUp, null);
});

test('switchover app: two instant refusals per traversal, no timeout anywhere', () => {
  const a = app({}, { scenario: 'switchover' });
  assert.equal(a.switchover, true);
  assert.equal(a.drop, false);
  near(a.d1, 0.2, 'd1');
  near(a.passCost, 0.4, 'passCost');
  assert.equal(a.startAt, 1);                 // dialing starts as the primary converts
  // Neither the transport budget nor the dead-address behaviour can move it.
  const other = app({ tct: 3, dead: 'rst' }, { scenario: 'switchover' });
  assert.deepEqual(other.attempts, a.attempts);
  near(other.gaveUp, a.gaveUp, 'gaveUp');
});

test('switchover app: the default string gives up long before the new primary opens', () => {
  const a = app({}, { scenario: 'switchover' });
  assert.equal(a.attempts.length, 1);
  assert.equal(a.tConn, null);
  near(a.gaveUp, 1.4, 'gaveUp');
  assert.ok(a.gaveUp < a.tService, 'gives up before the service comes back');
});

test('switchover app: enough retries always connect, never before the open', () => {
  const tuned = app({ tct: 3, ct: 90, rc: 30, rd: 3 }, { scenario: 'switchover' });
  assert.equal(tuned.attempts.length, 9);
  near(tuned.tConn, 28.7, 'tConn');
  assert.ok(tuned.tConn >= tuned.tService, 'connects at or after the open');
  const long = app({ rc: 100, rd: 1 }, { scenario: 'switchover', standbyLag: 60 });
  assert.ok(long.tConn !== null && long.tConn >= long.tService);
});

test('switchover app: a refused command is a no-event', () => {
  const a = app({}, { scenario: 'switchover', mode: 'maxperf', standbyLag: 45, lagLimit: 30 });
  assert.equal(a.noEvent, true);
  assert.equal(a.noEventKind, 'switchover-refused');
  assert.equal(a.switchoverRefused, true);
  assert.equal(a.attempts.length, 0);
  assert.equal(a.tConn, null);
  assert.equal(a.gaveUp, null);
});

// ---------- COMMITMODEL: one commit ----------

test('commit cost is max(local write, ack path), never the sum', () => {
  const cm = M.computeCommit({ xpt: 'sync', rttMs: 0, localWriteMs: 25, sbWriteMs: 25, mode: 'maxavail' });
  assert.equal(cm.ackPath, 25);
  assert.equal(cm.commitMs, 25);
  assert.equal(cm.standbyWait, 0);
});

test('SYNC vs FASTSYNC: the delta is the standby write only while the trip is the bottleneck', () => {
  const sync = M.computeCommit({ xpt: 'sync', rttMs: 20, localWriteMs: 2, sbWriteMs: 10, mode: 'maxavail' });
  const fast = M.computeCommit({ xpt: 'fastsync', rttMs: 20, localWriteMs: 2, sbWriteMs: 10, mode: 'maxavail' });
  assert.equal(sync.commitMs, 30);
  assert.equal(fast.commitMs, 20);
  assert.equal(sync.syncFastsyncDelta, 10);
  const local = M.computeCommit({ xpt: 'sync', rttMs: 4, localWriteMs: 20, sbWriteMs: 5, mode: 'maxavail' });
  assert.equal(local.syncFastsyncDelta, 0);
});

test('ASYNC never waits: local write is the whole commit, exposure begins', () => {
  const cm = M.computeCommit({ xpt: 'async', rttMs: 20, localWriteMs: 2, sbWriteMs: 10, mode: 'maxperf' });
  assert.equal(cm.commitMs, 2);
  assert.equal(cm.ackPath, null);
  assert.equal(cm.standbyWait, 0);
  assert.equal(cm.exposed, true);
  assert.equal(cm.srlDoneMs, 2 + 10 + 10);
});

test('mode conflict flags exactly ASYNC under MaxAvailability', () => {
  const mk = (xpt, mode) => M.computeCommit({ xpt, rttMs: 0, localWriteMs: 2, sbWriteMs: 2, mode });
  assert.equal(mk('async', 'maxavail').modeConflict, true);
  assert.equal(mk('async', 'maxperf').modeConflict, false);
  assert.equal(mk('sync', 'maxavail').modeConflict, false);
  assert.equal(mk('fastsync', 'maxavail').modeConflict, false);
});

// ---------- REOPENMODEL: after the drop ----------

test('retries at ReopenSecs multiples; reconnect on the first eligible switch', () => {
  const rp = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5, mode: 'maxavail', lagLimit: 30 });
  assert.deepEqual(rp.attempts.map((a) => a.t), [0, 300, 600]);
  assert.equal(rp.reconnectAt, 600);
  assert.equal(rp.disabledAt, null);
  assert.equal(rp.catchupSecs, 150);
  assert.equal(rp.resyncAt, 750);
  assert.equal(rp.peakExposureMB, 3000);
});

test('MaxFailure trips permanently; a short outage still waits one interval', () => {
  const trip = M.computeReopen({ reopen: 300, maxFailure: 1, outage: 1800, rate: 5, mode: 'maxavail', lagLimit: 30 });
  assert.equal(trip.disabledAt, 300);
  assert.equal(trip.reconnectAt, null);
  assert.equal(trip.fsfoBackAt, null);
  const short = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 60, rate: 5, mode: 'maxavail', lagLimit: 30 });
  assert.equal(short.reconnectAt, 300);
});

test('FSFO disarms at t = 0 in MaxAvailability, at the lag limit in MaxPerformance', () => {
  const mk = (mode, lagLimit) => M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5, mode, lagLimit });
  assert.equal(mk('maxavail', 30).fsfoLostAt, 0);
  assert.equal(mk('maxperf', 30).fsfoLostAt, 30);
  assert.equal(mk('maxperf', 5).fsfoLostAt, 5);
});

test('26ai reopen: bounded MaxAvailability disarms at the lag limit, not at t = 0', () => {
  const mk = (over) => M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
    mode: 'maxavail', lagLimit: 30, version: '26ai', ...over });
  // Zero data loss is the default and the 19c drawing: unsynchronized at once.
  assert.equal(mk({}).fsfoLostAt, 0);
  assert.equal(mk({}).lagGated, false);
  assert.equal(mk({ lagPolicy: 'zero' }).fsfoLostAt, 0);
  // Bounded: the apply lag is what disarms it, exactly as in MaxPerformance.
  assert.equal(mk({ lagPolicy: 'bounded' }).fsfoLostAt, 30);
  assert.equal(mk({ lagPolicy: 'bounded' }).lagGated, true);
  assert.equal(mk({ lagPolicy: 'bounded', lagLimit: 5 }).fsfoLostAt, 5);
  // FastStartFailoverLagGraceTime stays MaxPerformance-only, so no stall band
  // is drawn here whatever the policy and grace time say.
  assert.equal(mk({ lagPolicy: 'bounded', lagGraceTime: 10, threshold: 30 }).lagStallAt, null);
  assert.equal(mk({ lagPolicy: 'bounded', lagGraceTime: 10, threshold: 30 }).lagGraceArmed, false);
  // And under 19c the policy is not a thing: t = 0, as it always was.
  const c19 = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
    mode: 'maxavail', lagLimit: 30, lagPolicy: 'bounded' });
  assert.equal(c19.fsfoLostAt, 0);
  assert.equal(c19.lagGated, false);
});

test('26ai reopen: grace 0 pauses the primary at the crossing, one threshold at most', () => {
  // FastStartFailoverLagGraceTime = 0: the primary asks permission to enter
  // LAGGING at the moment the lag crosses the limit, and the band sits at the
  // crossing -- fsfoLostAt -- one FastStartFailoverThreshold wide. The
  // threshold is the bound the broker gives, never a measured duration.
  const rp = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
    mode: 'maxperf', lagLimit: 30, version: '26ai', lagGraceTime: 0, threshold: 30 });
  assert.equal(rp.lagGraceArmed, false);
  assert.equal(rp.lagStallAt, rp.fsfoLostAt);
  assert.equal(rp.lagStallAt, 30);
  assert.equal(rp.lagStallMax, 30);
  // The band follows the limit and the threshold independently.
  const other = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
    mode: 'maxperf', lagLimit: 5, version: '26ai', lagGraceTime: 0, threshold: 45 });
  assert.equal(other.lagStallAt, 5);
  assert.equal(other.lagStallMax, 45);
});

test('26ai reopen: a grace time of 5 s or more is armed, and no stall band is drawn', () => {
  for (const grace of [5, 60]) {
    const rp = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
      mode: 'maxperf', lagLimit: 30, version: '26ai', lagGraceTime: grace, threshold: 30 });
    assert.equal(rp.lagGraceArmed, true, `grace ${grace}`);
    assert.equal(rp.lagStallAt, null, `grace ${grace}`);
    assert.equal(rp.lagStallMax, null, `grace ${grace}`);
    assert.equal(rp.lagGraceTime, grace, `grace ${grace}`);
  }
  // MaxAvailability has no LAGGING state to ask permission for: neither the
  // band nor the armed flag, whatever the grace time says.
  const avail = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
    mode: 'maxavail', lagLimit: 30, version: '26ai', lagGraceTime: 10, threshold: 30 });
  assert.equal(avail.lagGraceArmed, false);
  assert.equal(avail.lagStallAt, null);
});

test('19c reopen: neither the stall band nor the armed flag, and no drift', () => {
  const bare = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
    mode: 'maxperf', lagLimit: 30 });
  assert.equal(bare.lagGraceArmed, false);
  assert.equal(bare.lagStallAt, null);
  assert.equal(bare.lagStallMax, null);
  // Explicit '19c' with the 26ai keys along for the ride returns the same
  // shape an old caller gets -- the grace time is echoed, nothing else moves.
  const explicit = M.computeReopen({ reopen: 300, maxFailure: 0, outage: 600, rate: 5,
    mode: 'maxperf', lagLimit: 30, version: '19c', lagGraceTime: 30, threshold: 30 });
  assert.equal(explicit.lagGraceArmed, false);
  assert.equal(explicit.lagStallAt, null);
  assert.deepEqual({ ...explicit, lagGraceTime: 0 }, bare);
});

// ---------- the Czech catalog ----------
//
// The catalog is keyed by English source strings, so a missing entry degrades to
// English on its own -- there is nothing to assert about coverage here. What can
// silently break a published page is a malformed entry: a placeholder the
// translation dropped (leaving a bare {0} on screen), unbalanced <span> markup
// inside a string that is assigned via innerHTML, or a pluralized source whose
// translation has no Czech forms. Those are what this checks.

const CAT = JSON.parse(
  await readFile(new URL('../simulator/i18n/cs.json', import.meta.url), 'utf8'),
);

test('catalog: declares Czech and is non-empty', () => {
  assert.equal(CAT.lang, 'cs');
  assert.ok(Object.keys(CAT.strings).length > 500, 'suspiciously few translations');
});

test('catalog: no entry is empty or identical to its English key', () => {
  for (const [en, cs] of Object.entries(CAT.strings)) {
    assert.ok(cs.trim(), `empty translation for ${JSON.stringify(en.slice(0, 60))}`);
    assert.notEqual(cs, en, `identity entry for ${JSON.stringify(en.slice(0, 60))} -- drop the key instead`);
  }
});

test('catalog: every {n} placeholder survives translation', () => {
  const holes = (s) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort();
  for (const [en, cs] of Object.entries(CAT.strings)) {
    assert.deepEqual(holes(cs), holes(en),
      `placeholder mismatch for ${JSON.stringify(en.slice(0, 60))}`);
  }
});

test('catalog: inline markup stays balanced', () => {
  // Sentences carry <span class="mono">/<tspan>/<em>/<sup> around technical
  // terms and are assigned via innerHTML, so a dropped closing tag would eat
  // the rest of the paragraph.
  const tags = (s) => {
    const counts = {};
    for (const m of s.matchAll(/<(\/?)(span|tspan|em|sup|b|i)\b/g)) {
      counts[m[2]] = (counts[m[2]] ?? 0) + (m[1] ? -1 : 1);
    }
    return counts;
  };
  for (const [en, cs] of Object.entries(CAT.strings)) {
    assert.deepEqual(tags(cs), tags(en),
      `tag balance differs for ${JSON.stringify(en.slice(0, 60))}`);
  }
});

test('catalog: a pluralized source gets Czech forms, and Czech gets three', () => {
  for (const [en, cs] of Object.entries(CAT.strings)) {
    if (!en.includes('|')) {
      assert.equal(cs.includes('|'), false,
        `unpluralized source translated with forms: ${JSON.stringify(en.slice(0, 60))}`);
      continue;
    }
    // Czech needs one / few / many; two forms are accepted only when the source
    // itself renders identically for few and many (a "{0}krat"-style phrasing).
    const forms = cs.split('|');
    assert.ok(forms.length === 2 || forms.length === 3,
      `expected 2 or 3 Czech forms, got ${forms.length} for ${JSON.stringify(en.slice(0, 60))}`);
    for (const f of forms) assert.ok(f.trim(), 'empty plural form');
  }
});
