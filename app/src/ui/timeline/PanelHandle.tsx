/**
 * The handle on the top edge of the timeline panel: the one control that folds
 * the whole panel (`timelineOpen`, remembered by persist.ts).
 *
 * Topology's floating dock and the docked `TimelineSlot` (the Detailed
 * timeline below the floating breakpoint, Learn's workbench) wear the same
 * bar, so "this is where it folds" is learnt once. It is a real
 * `<button aria-expanded>` with the chevron `Fold` and the small timeline's own
 * fold use, and the word, so the control says what it folds before anyone has
 * hovered it. Folded, it is all that is left of the panel: whoever renders it
 * does not render the rest, and the room goes to the drawing.
 *
 * `MiniTimeline` keeps its own, smaller fold inside the panel (`miniTimelineOpen`):
 * that one hides only the lanes, this one hides the panel.
 */

import { playing } from '@/state/view';
import { toggleTimeline } from '@/state/persist';
import { printing } from '../print';

/** Whether the panel is unfolded: as the reader left it, and always on paper. */
export const timelineShown = (open: boolean): boolean => open || printing.value;

export function TimelineHandle(
  { open, controls, summary = null }:
  {
    open: boolean;
    /** The id of the panel this folds: it is there in both states. */
    controls: string;
    /** What a folded panel can still say in a few words; absent while open. */
    summary?: string | null;
  },
) {
  return (
    <button
      type="button"
      class="tlp-handle"
      aria-expanded={open}
      aria-controls={controls}
      title={open ? 'Fold the timeline panel away to give the room back' : 'Show the timeline panel'}
      onClick={() => {
        /* The playback clock lives in what folding unmounts: a "playing" flag
           with nothing driving it would be a lie. */
        if (open) playing.value = false;
        toggleTimeline();
      }}
    >
      <span class="tlp-tab">
        <span class="tlp-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span class="tlp-word">Timeline</span>
      </span>
      {summary === null ? null : <span class="tlp-sum mono">{summary}</span>}
    </button>
  );
}
