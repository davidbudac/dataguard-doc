/**
 * The readout chips after the 2026-09-28 fact check (SIM-06, SIM-12, SIM-13,
 * SIM-14f): what the strip under the drawing says about a run, held to what
 * the run knows.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { protectionLevel, readout, readoutFor } from '@/state/derived';
import { classicDoc, doc, withEvents } from '@/state/doc';
import { edition, mode, tNow } from '@/state/view';
import type { TimedEvent } from '@/engine';
import { preset } from '@/presets';

const chip = (id: string, steady = false) => readoutFor(steady).find((c) => c.id === id);

beforeEach(() => {
  doc.value = classicDoc();
  edition.value = '19c';
  tNow.value = 0;
  mode.value = 'break';
});

const standbyDown: TimedEvent[] = [{ at: 0, kind: 'host.down', host: 'dc2-sby01' as never }];

describe('SIM-12: the protection chip', () => {
  it('does not say the broker reports MAXPERFORMANCE', () => {
    /* ASYNC under maximum availability: nothing acknowledges, at rest. */
    const d = classicDoc();
    for (const m of d.topology.members) m.logXptMode = 'ASYNC';
    doc.value = d;
    const c = chip('protection', true);
    expect(c?.v).toBe('MAXPERFORMANCE');
    expect(c?.basis).toBe('model');
    expect(c?.sub).toContain('operates as if it were in maximum performance mode');
    expect(c?.sub).toContain('is not documented');
    expect(c?.sub).not.toContain('the broker reports this level');
  });

  it('a configuration at the level it was configured in keeps the documented label', () => {
    const c = chip('protection', true);
    expect(c?.v).toBe('MAXAVAILABILITY');
    expect(c?.basis).toBe('documented');
  });

  it('the run\'s level carries the same label', () => {
    doc.value = withEvents(classicDoc(), standbyDown);
    expect(protectionLevel.value?.value).toBe('MAXPERFORMANCE');
    expect(protectionLevel.value?.basis).toBe('model');
  });
});

describe('SIM-06 and SIM-13: the loss chip', () => {
  it('a failover to a synchronized standby reads none, documented', () => {
    doc.value = withEvents(classicDoc(), [{ at: 0, kind: 'host.down', host: 'dc1-prm01' as never }]);
    const c = chip('loss');
    expect(c?.v).toBe('none');
    expect(c?.basis).toBe('documented');
    expect(c?.sub).toBe('The new primary opened with every acknowledged commit.');
  });

  it('a standby the primary ran without is never promoted with "none"', () => {
    doc.value = withEvents(classicDoc(), [
      { at: 0, kind: 'link.cut', link: 'dc1-dc2' as never },
      { at: 100, kind: 'host.down', host: 'dc1-prm01' as never },
    ]);
    expect(chip('outcome')?.v).toBe('blocked');
    expect(chip('loss')).toBeUndefined();
    expect(chip('open')).toBeUndefined();
  });

  it('a manual failover reads the seconds the standby never received', () => {
    const d = classicDoc();
    d.topology.config.fsfo.state = 'disabled';
    doc.value = withEvents(d, [
      { at: 0, kind: 'link.cut', link: 'dc1-dc2' as never },
      { at: 100, kind: 'host.down', host: 'dc1-prm01' as never },
      { at: 120, kind: 'cmd.failover', to: 'sby01' as never },
    ]);
    const c = chip('loss');
    expect(c?.v).toBe('70');
    expect(c?.unit).toBe('s');
    expect(c?.basis).toBe('model');
    expect(c?.sub).toContain('Nothing bounds it');
  });

  it('a far sync instance lost with the primary reads unknown', () => {
    const p = preset('far-sync-zero-loss');
    doc.value = withEvents({ ...classicDoc(), topology: p.doc() },
      [{ at: 0, kind: 'site.down', site: 'dc1' as never }]);
    const c = chip('loss');
    expect(c?.v).toBe('unknown');
    expect(c?.unit).toBeUndefined();
    expect(c?.basis).toBe('model');
    expect(c?.sub).toContain('cannot say how much');
  });

  it('a refused command reads blocked', () => {
    doc.value = withEvents(classicDoc(), [
      ...standbyDown, { at: 5, kind: 'cmd.switchover', to: 'sby01' as never },
    ]);
    expect(readout.value.find((c) => c.id === 'outcome')?.v).toBe('blocked');
  });
});

describe('SIM-14f: the observer chip', () => {
  it('shows the master, not the first observer in the list', () => {
    const p = preset('multi-target-three-observers');
    const topology = p.doc();
    /* The master is listed last. */
    topology.observers.reverse();
    doc.value = withEvents({ ...classicDoc(), topology }, p.events());
    const c = chip('observer');
    expect(c?.v).toBe('master');
    expect(c?.sub).toContain("the master's state is shown");
  });
});
