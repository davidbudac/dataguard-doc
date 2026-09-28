/**
 * The timeline still draws every run the 2026-09-28 fact check changed: no
 * lane state it does not know, no NaN in the geometry, lanes that cover the
 * axis. The engine introduced no new lane state for any of them -- a former
 * primary that needs reinstating is `mounted-noapply` -- and this is what
 * keeps it that way.
 */

import { describe, expect, it } from 'vitest';
import { classicTopology, simulate } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { preset } from '@/presets';
import { buildExplanation } from '@/ui/break/explain';
import { buildTimeline } from '@/ui/timeline/build';

const KNOWN = new Set([
  'open-rw', 'open-ro', 'mounted-apply', 'mounted-noapply', 'stalled', 'commit-hang', 'aborted',
  'converting', 'reinstating', 'disabled', 'unreachable', 'down',
  'receiving', 'forwarding-stalled',
  'master', 'backup', 'stopped', 'lost-primary', 'lost-target', 'nominating', 'observe-only',
  'up',
]);

const h = (id: string) => id as never;
const classic = (): TopologyDoc => classicTopology({ observerLoc: 'dc3' });
const multi = (): TopologyDoc => preset('multi-target-three-observers').doc();
const farSync = (): TopologyDoc => preset('far-sync-zero-loss').doc();
const noObserver = (): TopologyDoc => ({ ...classic(), observers: [] });

const RUNS: [string, () => TopologyDoc, TimedEvent[]][] = [
  ['SIM-01 cut off, then crash', classic, [
    { at: 0, kind: 'link.cut', link: h('dc1-dc2') }, { at: 100, kind: 'host.down', host: h('dc1-prm01') }]],
  ['SIM-02a observer first', classic, [
    { at: 0, kind: 'observer.stop', observer: h('obs01') }, { at: 50, kind: 'link.cut', link: h('dc1-dc2') }]],
  ['SIM-02b standby first', classic, [
    { at: 0, kind: 'link.cut', link: h('dc1-dc2') }, { at: 100, kind: 'link.cut', link: h('dc1-dc3') }]],
  ['SIM-03 former primary returns', classic, [
    { at: 0, kind: 'host.down', host: h('dc1-prm01') }, { at: 100, kind: 'host.up', host: h('dc1-prm01') }]],
  ['SIM-04 switchover to a dead standby', classic, [
    { at: 0, kind: 'host.down', host: h('dc2-sby01') }, { at: 5, kind: 'cmd.switchover', to: h('sby01') }]],
  ['SIM-04 failover to a dead standby', classic, [
    { at: 0, kind: 'host.down', host: h('dc1-prm01') }, { at: 0, kind: 'host.down', host: h('dc2-sby01') },
    { at: 5, kind: 'cmd.failover', to: h('sby01') }]],
  ['SIM-05 lost together', multi, [
    { at: 0, kind: 'site.down', site: h('dc2') }, { at: 0, kind: 'host.down', host: h('dc1-prm01') }]],
  ['SIM-05 the preset', multi, preset('multi-target-three-observers').events()],
  ['SIM-07 primary still open', classic, [{ at: 5, kind: 'cmd.failover', to: h('sby01') }]],
  ['SIM-10 second failure', classic, [
    { at: 0, kind: 'cmd.switchover', to: h('sby01') }, { at: 100, kind: 'host.down', host: h('dc2-sby01') }]],
  ['SIM-11 standby back', classic, [
    { at: 0, kind: 'host.down', host: h('dc2-sby01') }, { at: 50, kind: 'host.up', host: h('dc2-sby01') },
    { at: 60, kind: 'host.down', host: h('dc1-prm01') }]],
  ['SIM-13 far sync lost with the primary', farSync, [{ at: 0, kind: 'site.down', site: h('dc1') }]],
  ['SIM-14b set master observer', multi, [{ at: 5, kind: 'cmd.setMasterObserver', observer: h('obs03') }]],
  ['SIM-14e reinstate', classic, [
    { at: 0, kind: 'host.down', host: h('dc1-prm01') }, { at: 100, kind: 'host.up', host: h('dc1-prm01') },
    { at: 110, kind: 'cmd.reinstate', member: h('prm01') }]],
  ['VAL-04 enabled, no observer', noObserver, [{ at: 0, kind: 'host.down', host: h('dc2-sby01') }]],
];

describe('the timeline draws the runs the fact check changed', () => {
  for (const [name, make, events] of RUNS) {
    it(name, () => {
      const doc: TopologyDoc = { ...make(), events };
      const trace = simulate(doc, events);
      for (const lane of trace.lanes) {
        for (const seg of lane.segments) expect(KNOWN.has(seg.state as string), `${lane.subject.id}: ${seg.state}`).toBe(true);
      }
      const model = buildTimeline(trace, doc, { width: 980 });
      expect(model.lanes.length).toBeGreaterThan(0);
      expect(JSON.stringify(model)).not.toContain('NaN');
      expect(JSON.stringify(model)).not.toContain('null,null');
      for (const lane of model.lanes) expect(lane.segments.length, lane.key).toBeGreaterThan(0);

      const steps = buildExplanation(doc, trace);
      const result = steps.find((st) => st.key === 'result');
      expect(result).toBeDefined();
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.at).toBeGreaterThanOrEqual(steps[i - 1]!.at);
      if (trace.facts.blocked) expect(result?.title).toBe('Transition blocked');
    });
  }
});
