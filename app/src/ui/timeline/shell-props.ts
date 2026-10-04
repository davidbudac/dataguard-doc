/**
 * What the shell hands the timeline: the run, the playhead and the ways to move
 * it, wired to the page's signals. Read where the timeline is drawn, so the
 * component that calls it re-renders when the playhead does.
 *
 * One place, because the shell's own slot (`TimelineSlot` in App.tsx: the
 * docked Detailed timeline, Learn and the timeline popped out of Topology or
 * of the Detailed timeline) draws the full timeline from this state. Moving an
 * event, tuning a setting and adding an event from a lane are offered in
 * Topology and the Detailed timeline on a screen that edits -- and not in
 * Learn, whose drawing is a lesson's.
 */

import type { Trace } from '@/engine';
import { topology } from '@/state/derived';
import {
  appLanesShown, canEdit, mode, playing, selection, speed, tNow, viewport,
} from '@/state/view';
import { setEventTime } from '../break/events';
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
    ...((mode.value === 'build' || mode.value === 'break') && canEdit(viewport.value)
      ? { onMoveEvent: setEventTime, onTune: applyTune, laneEvents: true } : {}),
    onPlayToggle: () => { playing.value = !playing.value; },
    onSpeed: (s) => { speed.value = s; },
    selection: selection.value[0] ?? null,
    onSelect: (id) => { selection.value = id === null ? [] : [id]; },
    appView: appLanesShown.value,
    onAppView: (shown) => { appLanesShown.value = shown; },
  };
}
