/** Folding handle for the docked Outcome and Learn timelines. */

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
