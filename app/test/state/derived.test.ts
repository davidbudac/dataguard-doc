/**
 * The engine is actually connected (ui.md SS2).
 *
 * `derived.ts` was written against a shim while the engine landed in a
 * concurrent workflow: three functions that returned "nothing computed yet"
 * so the readout would say it had no numbers rather than invent plausible
 * ones. The shim is gone and the real `validate`, `simulate` and `stateAt` are
 * in its place. This file is what stops it coming back -- every assertion here
 * fails against a stub that answers null, and the failure names which of the
 * three went quiet.
 *
 * It is also the only test that exercises the derivation chain end to end:
 * document in, redo graph, findings, trace, playhead frame, readout chips out,
 * one direction, no component computing anything of its own.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  errors, events, frame, issues, outcome, primaryId, protectionLevel, readout, redoGraph,
  runFindings, topology, trace,
} from '@/state/derived';
import { classicDoc, doc, makeDoc, withEvents, withParams } from '@/state/doc';
import { edition, mode, tNow } from '@/state/view';
import { classicTopology, memberId } from '@/engine';
import type { MemberId, TimedEvent } from '@/engine';
import { preset } from '@/presets';

const PRM = memberId('prm01') as MemberId;
const SBY = memberId('sby01') as MemberId;

/** The published page's default scenario: the primary's host dies at zero. */
const crash: TimedEvent[] = [{ at: 0, kind: 'host.down', host: 'dc1-prm01' as never }];

beforeEach(() => {
  doc.value = classicDoc();
  edition.value = '19c';
  tNow.value = 0;
  mode.value = 'build';
});

describe('the steady state, with nothing injected', () => {
  it('has a redo graph and a protection level but no run', () => {
    expect(events.value).toEqual([]);
    expect(primaryId.value).toBe(PRM);
    expect(redoGraph.value).not.toBe(null);
    expect(redoGraph.value?.edges.length).toBeGreaterThan(0);
    /* Null is the reading, not a failure: nothing has happened to this
       deployment, so it has no outcome and no clock. */
    expect(trace.value).toBe(null);
    expect(frame.value).toBe(null);
    expect(outcome.value).toBe(null);
    expect(runFindings.value).toEqual([]);
    /* MAXAVAILABILITY is the configured mode, and it is also the level the
       broker reports here: the published deployment ships SYNC over a live
       link, so the standby is synchronized and acknowledging. The transport
       lag the published controls carry is the maximum performance TRANSPORT
       what-if and says nothing about a destination the commit waits for. */
    expect(topology.value.config.protectionMode).toBe('MAXAVAILABILITY');
    expect(protectionLevel.value?.value).toBe('MAXAVAILABILITY');
    expect(protectionLevel.value?.basis).toBe('documented');
  });

  it('runs the validator, and the findings are real ones', () => {
    /* The shim returned []; so does a clean configuration, which is why this
       asserts on the notes the classic deployment does draw. */
    expect(issues.value.length).toBeGreaterThan(0);
    expect(issues.value.map((f) => f.id)).toContain('EDIT.FSFO_ENABLED_BLOCKS');
    expect(errors.value).toEqual([]);
    for (const f of issues.value) {
      if (f.basis !== 'documented') expect(f.note ?? '', f.id).not.toBe('');
    }
  });

  it('sorts the findings the way the engine sorts them', () => {
    const order = ['error', 'warning', 'info'];
    const ranks = issues.value.map((f) => order.indexOf(f.severity));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('reads out the steady state: level, members, issues -- and no clock', () => {
    const ids = readout.value.map((c) => c.id);
    expect(ids).toEqual(['protection', 'members', 'issues']);
    expect(readout.value.find((c) => c.id === 'protection')?.v).toBe('MAXAVAILABILITY');
    expect(readout.value.find((c) => c.id === 'issues')?.v).toBe(String(issues.value.length));
  });
});

describe('with a failure injected, the engine runs', () => {
  beforeEach(() => {
    doc.value = withEvents(doc.value, crash);
    /* The outcome chips belong to the modes that draw the run; Build and
       Configure keep the steady-state readout whatever the Document carries. */
    mode.value = 'break';
  });

  it('keeps the steady-state readout in Build mode even with events in the Document', () => {
    mode.value = 'build';
    expect(readout.value.map((c) => c.id)).toEqual(['protection', 'members', 'issues']);
    mode.value = 'configure';
    expect(readout.value.map((c) => c.id)).toEqual(['protection', 'members', 'issues']);
    mode.value = 'learn';
    expect(readout.value.map((c) => c.id)).toContain('outcome');
  });

  it('simulates, and orders the failover one threshold after the crash', () => {
    const t = trace.value;
    expect(t, 'simulate returned nothing -- is the engine wired?').not.toBe(null);
    expect(t?.facts.outcome).toBe('failover');
    expect(t?.facts.target).toBe(SBY);
    /* One FastStartFailoverThreshold at the broker default. */
    expect(t?.facts.initiateAt).toBe(30);
    expect((t?.epochs.length ?? 0)).toBeGreaterThan(1);
  });

  it('promotes the target: SYNC transport means the readiness check passes', () => {
    /* The published deployment ships SYNC, so the standby holds every commit
       the primary acknowledged and the readiness check passes. The apply lag
       lengthens the catch-up rather than forbidding anything. */
    const t = trace.value;
    expect(t?.facts.blocked).toBe(false);
    expect(t?.facts.newPrimary).toBe(SBY);
    expect(t?.facts.tOpen).toBe(55);
    expect(t?.facts.dataLossKind).toBe('none');
    expect(t?.decisions.find((d) => d.id === 'FSFO.READINESS_GATE')?.taken).toBe(true);
    expect(readout.value.map((c) => c.id)).toContain('open');
  });

  it('reports the readiness check that forbids the promotion, and promotes nobody', () => {
    /* ASYNC under maximum availability: the primary never waits for the
       destination, so the target is not synchronized and fast-start failover
       is forbidden. The engine still reports the instant the new primary would
       have opened -- the readout below is what must not read that back as a
       role change. */
    doc.value = makeDoc({ ...classicTopology({ logXptMode: 'async' }), events: crash });
    const t = trace.value;
    expect(t?.facts.blocked).toBe(true);
    expect(t?.facts.newPrimary).toBe(null);
    expect(t?.facts.tOpen).toBe(55);
    const gate = t?.decisions.find((d) => d.id === 'FSFO.READINESS_GATE');
    expect(gate?.taken).toBe(false);
    /* The run's findings are Break mode's, not the validator's: the issue
       panel keeps answering about the configuration. */
    expect(issues.value.map((x) => x.id)).not.toContain('FSFO.READINESS_GATE');
    const f = runFindings.value.find((x) => x.id === 'FSFO.READINESS_GATE');
    expect(f?.severity).toBe('warning');
    expect(f?.basis).toBe('documented');
    expect(f?.message).toMatch(/forbidden while the target standby is not synchronized/);
  });

  it('walks the playhead without re-simulating', () => {
    const before = trace.value;
    tNow.value = 12;
    expect(frame.value, 'stateAt returned nothing').not.toBe(null);
    expect(frame.value?.t).toBe(12);
    /* Scrubbing must not rebuild the run: the trace is the same object. */
    expect(trace.value).toBe(before);
    tNow.value = 45;
    expect(frame.value?.t).toBe(45);
    expect(trace.value).toBe(before);
  });

  it('crosses the epoch boundary as the clock moves past the threshold', () => {
    tNow.value = 5;
    const before = frame.value?.epoch;
    expect(frame.value?.members[PRM]).toBe('down');
    tNow.value = 40;
    /* Two epochs: the crash, then the threshold expiring at 30 s. */
    expect(frame.value?.epoch).not.toBe(before);
    expect(frame.value?.epoch.t0).toBe(30);
  });

  it('never reads a forbidden failover back as a role change', () => {
    doc.value = makeDoc({ ...classicTopology({ logXptMode: 'async' }), events: crash });
    const ids = readout.value.map((c) => c.id);
    expect(ids).toContain('outcome');
    /* No "New primary open" chip: nobody was promoted. */
    expect(ids).not.toContain('open');
    const out = readout.value.find((c) => c.id === 'outcome');
    expect(out?.v).toBe('blocked');
    expect(out?.sub).toMatch(/nothing changed role/);
  });

  it('names the outcome, never the event that produced it', () => {
    for (const c of readout.value) {
      expect(c.sub, c.id).not.toMatch(/host\.down|instance\.down|link\.down/);
      expect(c.k, c.id).not.toMatch(/host\.down|instance\.down|link\.down/);
    }
  });
});

describe('maximum protection shutting the primary down reads as its own outcome', () => {
  beforeEach(() => {
    doc.value = makeDoc(preset('max-protection').doc());
    mode.value = 'break';
  });

  it('names the mode, not a stall, and labels the instant as the model', () => {
    expect(outcome.value).toBe('maxprot-shutdown');
    const out = readout.value.find((c) => c.id === 'outcome');
    expect(out?.v).toBe('primary shut down');
    const abort = readout.value.find((c) => c.id === 'abort');
    expect(abort?.k).toBe('Primary shut down');
    expect(abort?.v).toBe('70');
    expect(abort?.sub).toContain(
      'MaxProtection shut the primary down — no synchronized standby acknowledged',
    );
    /* The shutdown is documented; the instant it happens is not. */
    expect(abort?.basis).toBe('model');
    expect(abort?.cite).toContain('MAXPROT.SHUTS_PRIMARY');
    expect(abort?.sub).toContain('NET_TIMEOUT');
    expect(abort?.sub).not.toContain('FastStartFailoverThreshold');
  });
});

describe('the reading preferences reach the engine', () => {
  it('stamps the edition onto the document the engine sees, without editing it', () => {
    edition.value = '26ai';
    expect(topology.value.config.edition).toBe('26ai');
    /* The Document itself is untouched: the edition is a reading preference,
       so undo and the share link never carry it. */
    expect(doc.value.topology.config.edition).toBe('19c');
  });

  it('passes the simulation parameters through', () => {
    doc.value = withParams(withEvents(doc.value, crash), { targetPolicy: 'active-target-only' });
    expect(trace.value).not.toBe(null);
    expect(trace.value?.facts.outcome).toBe('failover');
    doc.value = withParams(doc.value, { maxEpochs: 1 });
    /* A cap this low cannot finish the run, and the engine reports that as a
       finding rather than throwing or looping. */
    expect(trace.value?.findings.length ?? 0).toBeGreaterThan(0);
  });
});

describe('every preset flows through the same chain', () => {
  it('derives a graph, findings and a run for each of them', () => {
    for (const id of ['classic', 'far-sync-zero-loss', 'cascade-terminal', 'max-protection'] as const) {
      const p = preset(id);
      doc.value = makeDoc(p.doc());
      expect(redoGraph.value, id).not.toBe(null);
      expect(errors.value.map((f) => f.id), id).toEqual([]);
      expect(trace.value, id).not.toBe(null);
      tNow.value = 1;
      expect(frame.value?.t, id).toBe(1);
      expect(readout.value.length, id).toBeGreaterThan(1);
    }
  });
});
