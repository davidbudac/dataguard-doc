/**
 * Configure -> SHOW at a frame where a manual failover has left the old primary
 * open (`FAILOVER.FORMER_PRIMARY_OPEN`): the SHOW CONFIGURATION mock resolves
 * for the new primary, and says where the drawing differs for the old one.
 * Where the old primary is mounted, or the run moved nothing, it says nothing.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { CLASSIC_IDS, classicTopology, hostId } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { makeDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { trace } from '@/state/derived';
import { tNow } from '@/state/view';
import { Show } from '@/ui/panels/Show';

const SBY = CLASSIC_IDS.standby;
const CLASSIC = classicTopology({ observerLoc: 'dc3' });
const fsfoOff = (): TopologyDoc => ({ ...CLASSIC, config: { ...CLASSIC.config, fsfo: { ...CLASSIC.config.fsfo, state: 'disabled' } } });

let root: HTMLElement | null = null;
const show = (d: TopologyDoc, events: TimedEvent[], at: number): string => {
  resetHistory(makeDoc({ ...d, events }));
  tNow.value = at;
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(Show, {}), root);
  return root.textContent ?? '';
};

afterEach(() => {
  if (root) render(null, root);
  root = null;
});

describe('SHOW CONFIGURATION where the old primary stayed open', () => {
  it('names the old primary as still open, with fast-start failover disabled or enabled', () => {
    for (const d of [fsfoOff(), CLASSIC]) {
      const text = show(d, [{ at: 0, kind: 'cmd.failover', to: SBY }], 100);
      expect(trace.value?.facts.newPrimary).toBe(SBY);
      /* After a real role change the panel prints plain SHOW CONFIGURATION for
         the new primary (GEN-30), not the WHEN PRIMARY IS question. */
      expect(text).toContain('DGMGRL> SHOW CONFIGURATION;');
      expect(text).not.toContain('WHEN PRIMARY IS');
      expect(text).toContain('sby01 - Primary database');
      expect(text).toContain('prm01 is still open read-write as a primary in this run');
    }
  });

  it('says nothing once the old primary is down, or before the new primary opens', () => {
    const crashed = show(fsfoOff(), [
      { at: 0, kind: 'cmd.failover', to: SBY },
      { at: 60, kind: 'host.down', host: hostId('dc1-prm01') },
    ], 100);
    expect(crashed).not.toContain('still open read-write');
    render(null, root as HTMLElement);
    const before = show(fsfoOff(), [{ at: 0, kind: 'cmd.failover', to: SBY }], 5);
    expect(before).not.toContain('still open read-write');
  });

  it('says nothing after a switchover, whose old primary is mounted', () => {
    const text = show(fsfoOff(), [{ at: 0, kind: 'cmd.switchover', to: SBY }], 100);
    expect(text).not.toContain('still open read-write');
  });
});
