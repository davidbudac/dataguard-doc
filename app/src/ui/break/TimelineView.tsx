/**
 * Simulate's two timelines, and the switch between them.
 *
 * **Configuration** is the timeline as it always was: the members, links and
 * observer on one clock. **Application** is the application's detail view --
 * the connect string's retry ladder, the sessions and the outage, the drawing
 * the Config panel's Application view also makes (`AppDetail`) -- with the
 * connect-string parameters in a strip above it, so a value can be tuned and
 * its effect read on the same screen. The strip's controls are the rail's own
 * (`ClientTimingControls`, `ClientPresets`), and they write `doc.client`
 * through the same undoable edits; the figure derives from the `topology` and
 * `trace` signals, so it redraws as the value changes.
 *
 * The Application choice exists only while the drawing has an application card
 * and only in Simulate: with none the switch is not drawn and the
 * configuration's timeline is what shows, whatever `breakTimeline` holds.
 *
 * Where the switch sits: in the bar of the Split and Lanes layouts
 * (`break/SplitBar.tsx`, `LanesView.tsx`), which is the timeline region's
 * header there, and on a slim row at the top of the timeline slot where there
 * is no bar (the docked timeline and the popped-out window, `TimelineSlot` in
 * App.tsx). The choice is a reading preference remembered under
 * `dg-break-timeline` (state/persist.ts); the run, the playhead and the
 * selection are not touched by switching.
 */

import { topology } from '@/state/derived';
import { setBreakTimeline } from '@/state/persist';
import {
  BREAK_TIMELINE_LABEL, BREAK_TIMELINE_SUB, BREAK_TIMELINES, breakTimeline, mode,
} from '@/state/view';
import type { BreakTimeline } from '@/state/view';
import { Segmented } from '../common/Segmented';
import { ClientPresets, ClientTimingControls } from '../inspector/ApplicationForm';
import { AppDetail } from '../panels/AppView';

/** Whether the switch is offered: in Simulate, and only for a drawing with an application. */
export function timelineSwitchShown(): boolean {
  return mode.value === 'break' && topology.value.application !== undefined;
}

/** Whether the application's timeline is what Simulate draws now. */
export function appTimelineOn(): boolean {
  return timelineSwitchShown() && breakTimeline.value === 'app';
}

/** `Configuration | Application`. Nothing at all where it does not apply. */
export function TimelineSwitch() {
  if (!timelineSwitchShown()) return null;
  return (
    <Segmented<BreakTimeline>
      label="Timeline"
      value={appTimelineOn() ? 'app' : 'config'}
      options={BREAK_TIMELINES.map((v) => ({ value: v, label: BREAK_TIMELINE_LABEL[v], title: BREAK_TIMELINE_SUB[v] }))}
      onChange={setBreakTimeline}
    />
  );
}

/** The switch on a row of its own, for the places that have no bar. */
export function TimelineSwitchRow() {
  if (!timelineSwitchShown()) return null;
  return (
    <div class="tl-view-row">
      <TimelineSwitch />
    </div>
  );
}

/** The application's timeline: the connect-string strip, then the detail figure. */
export function AppTimeline() {
  const client = topology.value.client;
  return (
    <div class="app-tl">
      <div class="app-tl-strip" role="group" aria-label="Connect string">
        <ClientPresets client={client} />
        <div class="app-tl-fields">
          <ClientTimingControls client={client} />
        </div>
      </div>
      <AppDetail where="simulate" class="app-tl-fig" />
    </div>
  );
}
