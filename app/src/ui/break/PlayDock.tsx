/**
 * Topology's floating dock: where a reader breaks the drawing and watches what
 * it does, with the timeline as the control.
 *
 * Three rows. The first is `Break`, the one-click scenarios with the three
 * settings that are a choice and not a length -- protection mode, fast-start
 * failover, the transport of the standby the run is about -- as chips at its
 * right, and `All settings →` on to the rest in the inspector
 * (break/SettingChips.tsx). The second is the status: the readings and the
 * finding chips -- with a run, the one terse line the Detailed timeline's bar
 * carries (break/RunBar.tsx) less the two times the small timeline draws as
 * badges on its own bars ("New primary open", and each application's
 * reconnect), and without one the readout as it stands. The third, while there
 * is a run to glance at, is the small timeline (timeline/MiniTimeline.tsx),
 * whose braces are the time-valued settings: drag a grip or type a number on a
 * label and the run moves under it.
 *
 * The Detailed timeline has no dock: its lanes are the whole stage
 * (break/LanesView.tsx).
 */

import { readout, runShown } from '@/state/derived';
import { Readout } from '../Readout';
import { FindingsChips } from '../Findings';
import { MiniTimeline } from '../timeline/MiniTimeline';
import { TerseReadout } from './RunBar';
import { ScenarioRow } from './ScenarioRow';
import { SettingChips } from './SettingChips';

/** The reading the small timeline carries as a badge, so the line leaves it out. */
const OPEN = 'New primary open';

export function PlayDock() {
  const run = runShown();
  /* Each application's reconnect reading is worded by the readout itself, so the
     labels to drop are read off it rather than spelled here. */
  const omit = [OPEN, ...readout.value.filter((c) => c.group === 'app' && c.k.endsWith('reconnects')).map((c) => c.k)];
  return (
    <>
      <div class="dock-break">
        <ScenarioRow label="Break" />
        <SettingChips />
      </div>
      <div class={run ? 'dock-status is-run' : 'dock-status'}>
        {run ? <TerseReadout run omit={omit} /> : <Readout />}
        <FindingsChips />
      </div>
      <MiniTimeline />
    </>
  );
}
