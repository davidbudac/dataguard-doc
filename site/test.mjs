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
const CDEF = { scenario: 'crash', mode: 'maxavail', threshold: 30, pingSet: false,
  pingInterval: 100, pingRetry: 10, standbyLag: 10, lagLimit: 30,
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
  assert.equal(quiet.attempts.length, 0);
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
