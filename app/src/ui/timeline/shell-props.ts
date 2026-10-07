/**
 * What the shell hands the timeline: the run, the playhead and the ways to move
 * it, wired to the page's signals. Read where the timeline is drawn, so the
 * component that calls it re-renders when the playhead does.
 *
 * Shared by docked Outcome, Learn and the popped-out timeline. Outcome enables
 * setting tuning and opens the selected item's inspector. Scheduled event
 * edits belong exclusively to Scenario; lessons keep their own state.
 */

import type { Trace } from '@/engine';
import { topology } from '@/state/derived';
import {
  appLanesShown, canEdit, mode, playing, selection, speed, tNow, viewport,
} from '@/state/view';
import { openInspectorFor } from '../build/actions';
import type { TimelineProps } from './Timeline';
import { applyTune } from './tune';

/**
 * Never narrower than the plot needs to stay legible: below that the timeline
 * scrolls sideways inside its own box (ui.md SS1).
 */
export const MIN_TIMELINE_W = 640;

export function shellTimelineProps(trace: Trace, measured: number): TimelineProps {
  return {
    trace,
    doc: topology.value,
    width: Math.max(measured, MIN_TIMELINE_W),
    tNow: tNow.value,
    playing: playing.value,
    speed: speed.value,
    onSeek: (t2) => { tNow.value = t2; },
    ...(mode.value === 'break' && canEdit(viewport.value)
      ? { onTune: applyTune } : {}),
    onPlayToggle: () => { playing.value = !playing.value; },
    onSpeed: (s) => { speed.value = s; },
    selection: selection.value[0] ?? null,
    onSelect: (id) => {
      if (id !== null && mode.value === 'break') openInspectorFor(id);
      else selection.value = id === null ? [] : [id];
    },
    appView: appLanesShown.value,
    onAppView: (shown) => { appLanesShown.value = shown; },
  };
}
