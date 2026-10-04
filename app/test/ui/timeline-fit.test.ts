import { describe, expect, it } from 'vitest';
import { classicTopology, scenarioEvents, simulate } from '@/engine';
import { fitTimeline } from '@/ui/timeline/fit';
import { buildTimeline } from '@/ui/timeline/build';

const doc = classicTopology({ observerLoc: 'dc3' });
const broken = { ...doc, events: scenarioEvents('crash', doc) };
const trace = simulate(broken);

describe('resizing scales every SVG component uniformly', () => {
  it('fills the requested height and enlarges fonts, lanes, markers and braces together', () => {
    const small = fitTimeline(trace, broken, { width: 900 }, 180);
    const large = fitTimeline(trace, broken, { width: 900 }, 420);
    expect(small.model.height * small.scale).toBeCloseTo(180);
    expect(large.model.height * large.scale).toBeCloseTo(420);
    expect(large.scale).toBeGreaterThan(small.scale);
    expect(large.model.lanes.map(l => [l.id, l.height])).toEqual(small.model.lanes.map(l => [l.id, l.height]));
    expect(large.model.scale.t0).toBe(small.model.scale.t0);
    expect(large.model.scale.t1).toBe(small.model.scale.t1);
    expect(large.model.markers.map(m => [m.kind, m.label])).toEqual(small.model.markers.map(m => [m.kind, m.label]));
  });
  it('preserves static exports and the unmeasured fallback', () => {
    const view = { width: 900, pinnedScale: true };
    const result = fitTimeline(trace, broken, view, 400);
    expect(result.scale).toBe(1);
    expect(JSON.stringify(result.model)).toBe(JSON.stringify(buildTimeline(trace, broken, view)));
    expect(result.model.scale.x(30)).toBe(buildTimeline(trace, broken, view).scale.x(30));
    expect(fitTimeline(trace, broken, { width: 900 }, 0).scale).toBe(1);
  });
  it('allows a narrow panel to scroll instead of distorting letters at a large scale', () => {
    const result = fitTimeline(trace, broken, { width: 640 }, 1000);
    expect(result.model.width * result.scale).toBeGreaterThan(640);
    expect(result.model.height * result.scale).toBeCloseTo(1000);
  });
});
