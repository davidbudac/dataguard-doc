/**
 * Simulate's two timelines, and the switch between them.
 *
 * **Configuration** is the timeline as it always was: the members, links and
 * observer on one clock. **Application** is the application's detail view --
 * the connect string's retry ladder, the sessions and the outage, the drawing
 * the Config panel's Application view also makes (`AppDetail`) -- with the
 * connect-string parameters in a strip above it, so a value can be tuned and
 * its effect read on the same screen. The strip's controls are the rail's own
 * (`ClientTimingControls`, `ClientPresets`), and they write the connect
 * descriptor the chosen application dials (its own, else the shared one)
 * through the same undoable edits; the figure derives from the `topology` and
 * `trace` signals, so it redraws as the value changes.
 *
 * With two or more applications a labelled picker in the strip chooses which
 * one's timeline is drawn (the selected card's application wins while one is
 * selected, and choosing here moves that selection along).
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

import { applicationClient, applicationsOf } from '@/engine';
import type { Application } from '@/engine';
import { topology } from '@/state/derived';
import { setBreakTimeline } from '@/state/persist';
import {
  BREAK_TIMELINE_LABEL, BREAK_TIMELINE_SUB, BREAK_TIMELINES, breakApp, breakTimeline, mode, selection, select,
} from '@/state/view';
import type { BreakTimeline } from '@/state/view';
import { Segmented } from '../common/Segmented';
import { ClientPresets, ClientTimingControls } from '../inspector/ApplicationForm';
import { AppDetail } from '../panels/AppView';

/** Whether the switch is offered: in Simulate, and only for a drawing with an application. */
export function timelineSwitchShown(): boolean {
  return mode.value === 'break' && applicationsOf(topology.value).length > 0;
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

/**
 * The application the Application timeline draws: the one the canvas selection
 * names when it is an application's card, else the one the picker chose, else
 * the first. Null only for a drawing with no application.
 */
export function timelineApplication(): Application | null {
  const apps = applicationsOf(topology.value);
  const sel = apps.find((a) => selection.value.includes(a.id as string));
  if (sel) return sel;
  return apps.find((a) => (a.id as string) === breakApp.value) ?? apps[0] ?? null;
}

/** Choose the application; a card already selected on the canvas follows, so the two never disagree. */
function pickApplication(id: string): void {
  breakApp.value = id;
  if (applicationsOf(topology.value).some((a) => selection.value.includes(a.id as string))) select(id);
}

/** Which application's timeline this is, as a labelled select; only where there are two or more. */
function ApplicationPicker({ apps, current }: { apps: readonly Application[]; current: Application }) {
  return (
    <label class="app-tl-pick">
      <span class="eyebrow">Application</span>
      <select
        class="field-in"
        value={current.id as string}
        aria-label="Application"
        onChange={(e) => pickApplication((e.currentTarget as HTMLSelectElement).value)}
      >
        {apps.map((a) => <option key={a.id as string} value={a.id as string}>{a.name}</option>)}
      </select>
    </label>
  );
}

/** The application's timeline: the connect-string strip, then the detail figure. */
export function AppTimeline() {
  const doc = topology.value;
  const apps = applicationsOf(doc);
  const app = timelineApplication();
  const client = app ? applicationClient(doc, app) : doc.client;
  const appId = app ? (app.id as string) : undefined;
  return (
    <div class="app-tl">
      <div class="app-tl-strip" role="group" aria-label="Connect string">
        {app && apps.length > 1 ? <ApplicationPicker apps={apps} current={app} /> : null}
        <ClientPresets client={client} appId={appId} />
        <div class="app-tl-fields">
          <ClientTimingControls client={client} appId={appId} />
        </div>
      </div>
      <AppDetail where="simulate" class="app-tl-fig" appId={appId} />
    </div>
  );
}
