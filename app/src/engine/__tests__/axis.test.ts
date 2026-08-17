import { describe, expect, it } from 'vitest';
import {
  cmTickStep, commitAxis, failoverAxis, fixedAxis, pickTickStep, preRollFor, reopenAxis,
  rpTickStep, secondsAxis,
} from '../models/axis';

/* The four assertions in site/test.mjs's "tick ladders" test, verbatim. */
describe('tick ladders', () => {
  it('matches site/test.mjs', () => {
    expect(pickTickStep(4.4)).toBe(0.5);
    expect(pickTickStep(9)).toBe(1);
    expect(pickTickStep(80)).toBe(10);
    expect(cmTickStep(30)).toBe(5);
    expect(rpTickStep(900)).toBe(120);
  });

  it('never returns a step finer than the first rung or coarser than the last', () => {
    expect(pickTickStep(0)).toBe(0.5);
    expect(pickTickStep(1e9)).toBe(600);
    expect(cmTickStep(1e9)).toBe(1000);
    expect(rpTickStep(1e9)).toBe(600);
  });

  it('keeps at most nine ticks on the axis', () => {
    for (const span of [1, 4.4, 9, 12, 47, 80, 121, 599, 1200]) {
      expect(span / pickTickStep(span)).toBeLessThanOrEqual(9);
    }
  });
});

describe('horizons', () => {
  it('the fixed 60 s axis is the one every no-event branch draws', () => {
    const a = fixedAxis(60);
    expect(a.tickStep).toBe(10);
    expect(a.horizon).toBe(60);
    expect(a.preRoll).toBe(10);
  });

  it('the default failover cell lands on the published horizon', () => {
    /* initiate 30, tOpen 55, threshold 30, no abort: raw = 55*1.12 + max(2,3.3) */
    const a = failoverAxis({ initiate: 30, tOpen: 55, blocked: false, threshold: 30, pingSet: false, abort: null });
    expect(a.tickStep).toBe(10);
    expect(a.horizon).toBe(70);
    expect(a.preRoll).toBe(10);
  });

  it('a blocked cell draws a stub rather than an open', () => {
    const a = failoverAxis({ initiate: 30, tOpen: null, blocked: true, threshold: 30, pingSet: false, abort: null });
    expect(a.horizon).toBeGreaterThan(0);
    expect(a.tickStep).toBeGreaterThan(0);
  });

  it('pre-roll is bounded to 2..10 seconds', () => {
    expect(preRollFor(5)).toBe(2);
    expect(preRollFor(600)).toBe(10);
  });

  it('the commit axis guards the all-zero case', () => {
    const a = commitAxis(0);
    expect(a.horizonMs).toBeGreaterThan(0);
    expect(a.tickStepMs).toBeGreaterThan(0);
    expect(a.preRollMs).toBeGreaterThanOrEqual(1);
  });

  it('the reopen axis snaps its pre-roll to a 15 s grid, capped at 180', () => {
    const a = reopenAxis(600);
    expect(a.preRoll % 15).toBe(0);
    expect(a.preRoll).toBeLessThanOrEqual(180);
    expect(a.horizon % a.tickStep).toBe(0);
  });

  it('secondsAxis rounds the horizon up to a whole number of ticks', () => {
    for (const end of [1, 11, 55, 130, 900]) {
      const a = secondsAxis(end);
      expect(a.horizon).toBeGreaterThanOrEqual(end);
      expect(Math.abs(a.horizon / a.tickStep - Math.round(a.horizon / a.tickStep))).toBeLessThan(1e-9);
    }
  });
});
