/**
 * The switch between Break's two layouts: Split (the drawing above the
 * timeline) and Lanes (each member's card continuing as its lane).
 *
 * It sits in the top bar, immediately left of the `19c | 26ai` switch and
 * built the same way (a bare `Segmented`, so `.topbar-group > .seg` styles it):
 * the header is the one place both layouts leave alone, so it is in the same
 * spot whichever is on screen. The layout is a reading preference, remembered
 * under `dg-break-layout` (state/persist.ts); the run, the playhead and the
 * selection are not touched by switching. Where it does not apply (any mode
 * but Break, and the docked fallback below 1024 px) `TopBar` does not render
 * it, and the slot is empty.
 */

import { setBreakLayout } from '@/state/persist';
import { BREAK_LAYOUT_LABEL, BREAK_LAYOUT_SUB, BREAK_LAYOUTS, breakLayout } from '@/state/view';
import type { BreakLayout } from '@/state/view';
import { Segmented } from '../common/Segmented';

export function LayoutSwitch() {
  return (
    <Segmented<BreakLayout>
      label="Layout"
      value={breakLayout.value}
      options={BREAK_LAYOUTS.map((v) => ({ value: v, label: BREAK_LAYOUT_LABEL[v], title: BREAK_LAYOUT_SUB[v] }))}
      onChange={setBreakLayout}
    />
  );
}
