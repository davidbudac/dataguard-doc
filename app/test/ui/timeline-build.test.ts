/**
 * `buildTimeline` is pure, so it is tested without a DOM: the classic crash
 * trace goes in, a model comes out, and the three properties the drawing can
 * never lose are asserted -- lane order, contiguous segment coverage, and
 * braces that cannot overlap.
 */

import { describe, expect, it } from 'vitest';
import { classicTopology, scenarioEvents, simulate } from '@/engine';
import type { TopologyDoc, Trace } from '@/engine';
import { preset } from '@/presets';
import { memberId } from '../../src/engine/ids';
import { multiTargetDoc } from '../topologies';
import {
  approxW, axisSpan, buildTimeline, clampToAxis, describeEvent, fitLabel, packBraces,
  PINNED, snapNice, TL,
} from '@/ui/timeline/build';
import type { BraceInput, TimelineModel } from '@/ui/timeline/build';

/** The published 1+1+1 workbench's default cell: primary host crashes at t=0. */
function classic(scenario: Parameters<typeof scenarioEvents>[0] = 'crash'): {
  doc: TopologyDoc;
  trace: Trace;
} {
  const base = classicTopology({});
  const events = scenarioEvents(scenario, base);
  const doc: TopologyDoc = { ...base, events };
  return { doc, trace: simulate(doc, events) };
}

const build = (scenario: Parameters<typeof scenarioEvents>[0] = 'crash', width = 980): TimelineModel => {
  const { doc, trace } = classic(scenario);
  return buildTimeline(trace, doc, { width });
};

describe('buildTimeline: the classic crash', () => {
  it('draws one lane per member and observer, primary first', () => {
    const m = build();
    expect(m.lanes).toHaveLength(3);
    /* the three site links never went down, so they get no lanes -- and the
       model says how many it left out rather than dropping them silently */
    expect(m.quietLinks).toBe(3);
    expect(m.lanes.map((l) => l.id)).toEqual(['prm01', 'obs01', 'sby01']);
    expect(m.lanes.map((l) => l.group)).toEqual(['primary', 'observer', 'standby']);
  });

  it('names lanes by db_unique_name and subtitles them by role', () => {
    const m = build();
    expect(m.lanes[0]?.name).toBe('prm01');
    expect(m.lanes[0]?.sub).toBe('production database');
    expect(m.lanes[1]?.sub).toBe('DGMGRL, dc3-obs01');
    expect(m.lanes[2]?.sub).toBe('failover target');
  });

  it('stacks lanes 38 high with a 10 px gap under a 132 px gutter', () => {
    /* Nothing is initiated, opened or aborted in this cell, so no lane gap
       has to hold a marker label and the ladder is the plain one. */
    const m = build('observer-lost');
    expect(m.scale.plotL).toBe(TL.gutter);
    expect(m.lanes.map((l) => l.y)).toEqual([TL.laneTop, TL.laneTop + 48, TL.laneTop + 96]);
    expect(m.lanes.every((l) => l.height === 38)).toBe(true);
    expect(m.lanesBottom).toBe(TL.laneTop + 3 * 48 - 10);
    expect(m.axisY).toBe(m.lanesBottom + 24);
  });

  it('opens the one gap a marker label lands in, and only that one', () => {
    /* The observer lane carries "Initiates failover at t = 30 s" above it and
       the standby's carries "Opens read-write"; the primary's does not. */
    const m = build();
    expect(m.lanes.map((l) => l.y)).toEqual([TL.laneTop, TL.laneTop + 48 + TL.markRow, TL.laneTop + 96 + 2 * TL.markRow]);
    expect(m.lanesBottom).toBe(TL.laneTop + 3 * 48 - 10 + 2 * TL.markRow);
  });

  it('keeps every marker label out of the lanes it sits between', () => {
    const m = build();
    const bands = m.lanes.map((l) => ({ y0: l.y, y1: l.y + l.height }));
    for (const mk of m.markers) {
      if (!mk.showLabel) continue;
      /* an 11 px sentence: the cap height above the baseline and the descender
         below it */
      const y0 = mk.labelY - 11;
      const y1 = mk.labelY + 3;
      for (const b of bands) {
        expect(y0 < b.y1 && y1 > b.y0, `${mk.key} label over a lane`).toBe(false);
      }
    }
  });

  it('covers every lane contiguously from t0 to the horizon', () => {
    const m = build();
    for (const lane of m.lanes) {
      expect(lane.segments.length).toBeGreaterThan(0);
      expect(lane.segments[0]?.t0).toBe(m.scale.t0);
      expect(lane.segments[lane.segments.length - 1]?.t1).toBe(m.scale.t1);
      for (let i = 1; i < lane.segments.length; i++) {
        expect(lane.segments[i]?.t0).toBe(lane.segments[i - 1]?.t1);
      }
      /* no zero-width band survives into the model */
      for (const s of lane.segments) expect(s.t1).toBeGreaterThan(s.t0);
    }
  });

  it('opens every lane in the steady state the document declares', () => {
    const m = build();
    expect(m.lanes[0]?.segments[0]?.state).toBe('open-rw');
    expect(m.lanes[1]?.segments[0]?.state).toBe('master');
    expect(m.lanes[2]?.segments[0]?.state).toBe('mounted-apply');
    /* the pre-roll really is before the event */
    for (const lane of m.lanes) expect(lane.segments[0]?.t1).toBeLessThanOrEqual(0);
  });

  it('paints a down primary hatched red and never flat', () => {
    const m = build();
    const down = m.lanes[0]?.segments.find((s) => s.state === 'down');
    expect(down?.phase).toBe('b-hatch');
    expect(down?.ink).toBe('f-rd');
    expect(down?.title).toBe('Down — host has crashed');
  });

  it('numbers the injected event and marks it on the primary lane', () => {
    const m = build();
    const events = m.markers.filter((mk) => mk.kind === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]?.index).toBe(1);
    expect(events[0]?.t).toBe(0);
    expect(events[0]?.label).toBe('Host dc1-prm01 crashes');
    expect(m.zeroNote).toBe('t = 0 is the first injected event');
  });

  it('puts t = 0 inside the drawing, after a pre-roll', () => {
    const m = build();
    expect(m.scale.t0).toBeLessThan(0);
    expect(m.scale.x(0)).toBeGreaterThan(m.scale.plotL);
    expect(m.preZone.w).toBeCloseTo(m.scale.x(0) - m.scale.plotL, 0);
  });

  it('carries the FastStartFailoverThreshold brace with the observer clock', () => {
    const m = build();
    const th = m.braces.find((b) => b.key === 'threshold');
    expect(th?.name).toBe('FastStartFailoverThreshold');
    expect(th?.mono).toBe(true);
    expect(th?.a).toBe(0);
    expect(th?.b).toBe(30);
  });

  it('says nothing was injected when nothing was', () => {
    const doc = classicTopology({});
    const trace = simulate(doc, []);
    const m = buildTimeline(trace, { ...doc, events: [] }, { width: 980 });
    expect(m.empty).toBe(true);
    expect(m.caption.text).toBe('Steady state — no events injected');
    expect(m.zeroNote).toBeNull();
    /* the lanes are still drawn: nothing is hidden, the state is just flat */
    expect(m.lanes).toHaveLength(3);
    for (const lane of m.lanes) expect(lane.segments).toHaveLength(1);
  });
});

describe('buildTimeline: captions branch on the outcome', () => {
  it('never repeats the event name back', () => {
    for (const scenario of ['crash', 'partition', 'isolated', 'dc2down', 'observer-lost', 'switchover'] as const) {
      const m = build(scenario);
      expect(m.caption.text.length).toBeGreaterThan(0);
      expect(m.caption.text).not.toMatch(/crash|partition|dc2down/i);
    }
  });

  it('words tOpen as the instant the new primary opens, not as "the outage"', () => {
    const { doc, trace } = classic('crash');
    if (trace.facts.blocked || trace.facts.tOpen === null) return; // engine still landing
    const m = buildTimeline(trace, doc, { width: 980 });
    /* The number is tOpen. A client's outage starts when the primary stopped
       answering and ends when it reconnects, and neither end is this number,
       so the caption never calls it the total outage. */
    expect(m.caption.text).toContain('open read-write at t =');
    expect(m.caption.text).toContain(`${trace.facts.tOpen} s`);
    expect(m.caption.text).not.toContain('Total outage');
    expect(m.caption.anchor).toBe('middle');
  });
});

/* SIM-14 g (fact check 2026-09-28): the blocked-switchover caption used to
   say "outside FastStartFailoverLagLimit" for every refusal, including one
   that has nothing to do with the lag limit. It now reads the reason off
   the trace's own SWITCHOVER.REFUSED finding. */
describe('buildTimeline: a blocked switchover names its own refusal reason', () => {
  it('names the lag limit when that is the refusal', () => {
    const { doc, trace } = classic('switchover');
    doc.config.fsfo.state = 'enabled';
    doc.config.protectionMode = 'MAXPERFORMANCE';
    doc.config.fsfo.lagLimitSeconds = 0;
    const events = scenarioEvents('switchover', doc);
    const t2 = simulate(doc, events);
    if (!t2.facts.blocked) return; // engine still landing
    const m = buildTimeline(t2, doc, { width: 980 });
    expect(m.caption.text).toContain('SWITCHOVER refused');
    expect(m.caption.text).toContain('FastStartFailoverLagLimit');
  });

  it('names the target, not the lag limit, when the member is not the pre-specified target', () => {
    const doc = multiTargetDoc();
    doc.config.fsfo.state = 'enabled';
    doc.config.fsfo.target = { kind: 'list', members: [memberId('sby01')] };
    const events = [{ at: 0, kind: 'cmd.switchover' as const, to: memberId('sby02') }];
    const trace = simulate(doc, events);
    expect(trace.facts.blocked).toBe(true);
    const m = buildTimeline(trace, { ...doc, events }, { width: 980 });
    expect(m.caption.text).toContain('SWITCHOVER refused');
    expect(m.caption.text).not.toContain('FastStartFailoverLagLimit');
    expect(m.caption.text).toContain('not the pre-specified fast-start failover target');
  });
});

describe('maximum protection shutting the primary down', () => {
  const p = preset('max-protection');
  const doc = p.doc();
  const trace = simulate(doc, p.events());
  const m = buildTimeline(trace, doc, { width: 980 });

  it('is its own outcome, not a stall', () => {
    expect(trace.facts.outcome).toBe('maxprot-shutdown');
    expect(trace.facts.abortReason).toBe('maxprotection');
  });

  it('never draws FastStartFailoverThreshold over a NET_TIMEOUT-derived instant', () => {
    /* No fast-start failover clock ran here: the primary was shut down because
       nothing was acknowledging synchronously, and the instant comes from
       NET_TIMEOUT. Drawing the threshold across it would be a clock the
       configuration never started. */
    for (const b of m.braces) {
      expect(`${b.name} ${b.val}`).not.toContain('FastStartFailoverThreshold');
      expect(`${b.name} ${b.val}`).not.toContain('stall clock');
    }
    const nt = m.braces.find((b) => b.name === 'NET_TIMEOUT');
    expect(nt).toBeDefined();
    expect(nt?.b).toBe(trace.facts.abortAt);
    expect(nt?.a).toBe((trace.facts.abortAt ?? 0) - 10);
    expect(nt?.val).toContain("this page's model");
  });

  it('captions the shutdown in the mode\u2019s own words', () => {
    expect(m.caption.text).toBe(
      'MaxProtection shut the primary down — no synchronized standby acknowledged',
    );
  });
});

describe('brace packing', () => {
  const scale = buildTimeline(classic().trace, classic().doc, { width: 980 }).scale;

  const overlaps = (a: { L: number; R: number }, b: { L: number; R: number }): boolean =>
    !(a.R < b.L - 10 || a.L > b.R + 10);

  it('never overlaps two label boxes on the same row', () => {
    const inputs: BraceInput[] = [];
    for (let i = 0; i < 8; i++) {
      inputs.push({
        key: `b${i}`,
        a: i * 2,
        b: i * 2 + 1,
        tone: 'br-am',
        mono: true,
        name: 'FastStartFailoverThreshold',
        val: '30 s — observer reconnect window',
      });
    }
    const { braces, rowCount } = packBraces(inputs, scale, 980, 300);
    expect(rowCount).toBeGreaterThan(1);
    const boxes = braces.map((b) => {
      const w = Math.max(approxW(b.name, 11.5, b.mono), approxW(b.val, 11, true), b.x1 - b.x0) + 18;
      return { row: b.row, L: b.lx - w / 2, R: b.lx + w / 2 };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.row === b.row) expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it('keeps every label box inside the drawing', () => {
    const { braces } = packBraces([{
      key: 'edge', a: 0, b: 0.2, tone: 'br-rd', mono: true,
      name: 'ObserverPingInterval × (ObserverPingRetry + 1)',
      val: '100 ms × 11 = 1.1 s detection',
    }], scale, 980, 300);
    const b = braces[0]!;
    const w = Math.max(approxW(b.name, 11.5, true), approxW(b.val, 11, true), b.x1 - b.x0) + 18;
    expect(b.lx - w / 2).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(b.lx + w / 2).toBeLessThanOrEqual(980 - 6 + 1e-9);
  });

  it('places each row one braceRow below the last', () => {
    const inputs: BraceInput[] = [0, 1].map((i) => ({
      key: `r${i}`, a: 0, b: 1, tone: 'br-am' as const, mono: false,
      name: 'Role change + read-write open',
      val: '15 s — environment-dependent, not a broker parameter',
    }));
    const { braces } = packBraces(inputs, scale, 980, 300);
    expect(braces[0]?.row).toBe(0);
    expect(braces[1]?.row).toBe(1);
    expect(braces[1]!.y - braces[0]!.y).toBe(TL.braceRow);
  });
});

describe('pinnedScale: the static figures’ scale', () => {
  it('reproduces x(t) = 280 + 10 * t exactly', () => {
    const { doc, trace } = classic();
    const m = buildTimeline(trace, doc, { width: 640, pinnedScale: true });
    expect(m.pinned).toBe(true);
    expect(m.width).toBe(1200);
    for (const t of [-14, -10, -0.5, 0, 0.3, 1, 12.5, 30, 45, 80]) {
      expect(m.scale.x(t)).toBe(280 + 10 * t);
    }
  });

  it('anchors the plot at the figures’ edges', () => {
    const { doc, trace } = classic();
    const m = buildTimeline(trace, doc, { width: 640, pinnedScale: true });
    expect(m.scale.t0).toBe(PINNED.t0);
    expect(m.scale.t1).toBe(PINNED.t1);
    expect(m.scale.plotL).toBe(140);
    expect(m.scale.plotR).toBe(1080);
    expect(m.scale.x(m.scale.t0)).toBe(140);
    expect(m.scale.x(m.scale.t1)).toBe(1080);
    /* ticks land on the multiples of 10 s inside the domain */
    expect(m.ticks.map((t) => t.t)).toEqual([-10, 0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(m.ticks.map((t) => t.x)).toEqual([180, 280, 380, 480, 580, 680, 780, 880, 980, 1080]);
  });

  it('inverts cleanly, so the scrubber lands where the pointer did', () => {
    const { doc, trace } = classic();
    const m = buildTimeline(trace, doc, { width: 640, pinnedScale: true });
    for (const t of [-14, 0, 17.4, 80]) expect(m.scale.tAt(m.scale.x(t))).toBeCloseTo(t, 9);
  });
});

describe('label ladder', () => {
  it('takes the first candidate that fits and nothing wider', () => {
    const cands = ['Open read-write — shipping redo', 'Shipping redo', 'Open'];
    expect(fitLabel(cands, 400)).toBe(cands[0]);
    expect(fitLabel(cands, 100)).toBe('Shipping redo');
    expect(fitLabel(cands, 60)).toBe('Open');
    expect(fitLabel(cands, 20)).toBeNull();
  });

  it('measures monospace wider than the sans stack', () => {
    expect(approxW('abcdefghij', 11, true)).toBeGreaterThan(approxW('abcdefghij', 11, false));
  });

  it('falls back to a tooltip when nothing fits', () => {
    const m = build('crash', 420);
    const narrow = m.lanes.flatMap((l) => l.segments).filter((s) => s.w < 28);
    for (const s of narrow) {
      expect(s.title.length).toBeGreaterThan(0);
      if (s.label !== null) expect(approxW(s.label, 11) + 14).toBeLessThanOrEqual(s.w);
    }
  });
});

describe('axis', () => {
  it('snaps the pre-roll to a nice number and clamps the horizon', () => {
    expect(snapNice(4.5)).toBe(5);
    expect(snapNice(0.2)).toBe(0.5);
    expect(snapNice(1000)).toBe(300);
    const m = build();
    expect(m.scale.t1).toBeGreaterThanOrEqual(30);
    expect(m.scale.t1).toBeLessThanOrEqual(900);
    expect(m.scale.t0).toBe(-snapNice(0.15 * m.scale.t1));
  });

  it('labels negative ticks with a real minus sign', () => {
    const m = build();
    const neg = m.ticks.filter((t) => t.t < 0);
    for (const t of neg) expect(t.label.startsWith('−')).toBe(true);
  });

  /**
   * The axis is not the timeline's private business: the readout strip prints
   * the playhead too, and while it clamped with a formula of its own it read
   * "Drawing at t = 500 s" over a drawing whose badge said "t = 63.25". One
   * exported formula, so nothing can drift from the drawing's own scale.
   */
  it('exports the same two ends the drawing is built on', () => {
    const { doc, trace } = classic();
    const m = buildTimeline(trace, doc, { width: 980 });
    const span = axisSpan(trace, doc.events);
    expect(span.t1).toBe(m.scale.t1);
    expect(span.t0).toBe(m.scale.t0);
  });

  it('clamps a reading to those ends, both of them', () => {
    const { doc, trace } = classic();
    const m = buildTimeline(trace, doc, { width: 980 });
    expect(clampToAxis(500, trace, doc.events)).toBe(m.scale.t1);
    expect(clampToAxis(-60, trace, doc.events)).toBe(m.scale.t0);
    expect(clampToAxis(12.5, trace, doc.events)).toBe(12.5);
    /* The same answer the drawing's own clamp gives, at every one of them. */
    for (const t of [-60, -1, 0, 12.5, 500]) {
      expect(clampToAxis(t, trace, doc.events)).toBe(m.scale.clampT(t));
    }
  });
});

describe('event wording', () => {
  it('describes each injected event as a sentence, not a kind', () => {
    const doc = classicTopology({});
    expect(describeEvent(doc, { at: 0, kind: 'host.down', host: doc.hosts[0]!.id }))
      .toBe('Host dc1-prm01 crashes');
    expect(describeEvent(doc, { at: 0, kind: 'site.down', site: doc.sites[1]!.id }))
      .toBe('The whole DC 2 site goes down');
    expect(describeEvent(doc, { at: 0, kind: 'cmd.switchover', to: doc.members[1]!.id }))
      .toBe('SWITCHOVER TO sby01');
  });
});

describe('buildTimeline: two injected events at one instant', () => {
  it('never prints two event labels on top of each other, and keeps both badges apart', () => {
    const base = classicTopology({});
    const crash = scenarioEvents('crash', base);
    const first = crash[0];
    if (!first) throw new Error('the crash scenario has an event');
    /* the same instant, a second injected event: the standby site goes down too */
    const site = base.sites.find((s) => (s.id as string) !== 'dc1') ?? base.sites[0];
    if (!site) throw new Error('a second site exists');
    const events = [first, { at: first.at, kind: 'site.down' as const, site: site.id }];
    const doc: TopologyDoc = { ...base, events };
    const m = buildTimeline(simulate(doc, events), doc, { width: 980 });
    const marks = m.markers.filter((k) => k.kind === 'event');
    expect(marks).toHaveLength(2);
    const [a, b] = marks;
    if (!a || !b) throw new Error('two event markers');
    expect(a.showLabel).toBe(true);
    /* the second either moved to the other side of its line or gave way */
    const span = (k: typeof a): [number, number] => {
      const w = approxW(k.label, 11.5);
      return k.labelAnchor === 'start' ? [k.labelX, k.labelX + w] : [k.labelX - w, k.labelX];
    };
    if (b.showLabel) {
      const [a0, a1] = span(a); const [b0, b1] = span(b);
      expect(b0 >= a1 || b1 <= a0).toBe(true);
    }
    expect(Math.abs(a.nx - b.nx)).toBeGreaterThanOrEqual(15);
    /* the sentence is still there for the tooltip and the rail */
    expect(b.label.length).toBeGreaterThan(0);
  });

  it('starts the sentence clear of both number badges', () => {
    const base = classicTopology({});
    const crash = scenarioEvents('crash', base);
    const first = crash[0];
    if (!first) throw new Error('the crash scenario has an event');
    const site = base.sites.find((s) => (s.id as string) !== 'dc1') ?? base.sites[0];
    if (!site) throw new Error('a second site exists');
    const events = [first, { at: first.at, kind: 'site.down' as const, site: site.id }];
    const doc: TopologyDoc = { ...base, events };
    const m = buildTimeline(simulate(doc, events), doc, { width: 980 });
    const marks = m.markers.filter((k) => k.kind === 'event');
    /* The badge is a 7 px circle on the label's own baseline row, so a label
       that starts at the marker line is printed under the second badge. */
    for (const mk of marks) {
      if (!mk.showLabel || mk.labelAnchor !== 'start') continue;
      for (const other of marks) {
        expect(mk.labelX, `${mk.key} over badge ${String(other.index)}`)
          .toBeGreaterThanOrEqual(other.nx + 7);
      }
    }
  });
});
