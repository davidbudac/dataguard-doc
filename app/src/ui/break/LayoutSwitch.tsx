/**
 * The switch between Break's two layouts: Split (the drawing above the
 * timeline) and Lanes (each member's card continuing as its lane).
 *
 * It lives at the end of the guidance line under the top bar (Guidance.tsx),
 * which is the one place both layouts leave alone -- the bars, the bar between
 * the regions and the fused view all sit under it -- so it is in the same spot
 * whichever is on screen. The layout is a reading preference, remembered under
 * `dg-break-layout` (state/persist.ts); the run, the playhead and the selection
 * are not touched by switching.
 */

import { setBreakLayout } from '@/state/persist';
import { BREAK_LAYOUT_LABEL, BREAK_LAYOUT_SUB, BREAK_LAYOUTS, breakLayout } from '@/state/view';
import type { BreakLayout } from '@/state/view';
import { Segmented } from '../common/Segmented';

export function LayoutSwitch() {
  return (
    <div class="layout-sw">
      <span class="layout-sw-k" aria-hidden="true">Layout</span>
      <Segmented<BreakLayout>
        label="Break layout"
        value={breakLayout.value}
        options={BREAK_LAYOUTS.map((v) => ({ value: v, label: BREAK_LAYOUT_LABEL[v], title: BREAK_LAYOUT_SUB[v] }))}
        onChange={setBreakLayout}
      />
    </div>
  );
}
