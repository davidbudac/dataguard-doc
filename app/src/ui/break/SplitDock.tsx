/**
 * The lower region of Break's Split layout: the bar, and the timeline under it.
 *
 * The drawing has the window above; this region is a full-width strip under it
 * that does not overlap it (split.css). The timeline is drawn packed
 * (`density="compact"`), with its headline as a line of its own and no colour
 * key of its own -- the bar carries the transport, the key and the buttons --
 * and the model is built here, once, and handed to both the bar and the
 * drawing (`useRunTimeline`).
 */

import type { Trace } from '@/engine';
import { trace } from '@/state/derived';
import { PoppedAway, popped } from '../common/popout';
import { useWidth } from '../common/use-width';
import { TimelineBody } from '../timeline/Timeline';
import { useRunTimeline } from '../timeline/run';
import { shellTimelineProps } from '../timeline/shell-props';
import { SplitBar } from './SplitBar';
import { SummaryBand } from './SummaryBand';
import { AppTimeline, appTimelineOn } from './TimelineView';

function SplitRun({ t }: { t: Trace }) {
  const [ref, measured] = useWidth();
  const props = shellTimelineProps(t, measured);
  const away = popped.value.timeline !== undefined;
  const run = useRunTimeline({
    trace: t, doc: props.doc, width: props.width,
    selection: props.selection ?? null, appView: props.appView ?? true, density: 'compact',
  });
  return (
    <>
      <SplitBar run={run} sized={!away} />
      <SummaryBand />
      {away ? (
        <div class="tl-slot"><PoppedAway kind="timeline" label="Timeline" /></div>
      ) : (
        <div class="tl-slot" ref={ref}>
          {appTimelineOn() ? <AppTimeline /> : (
            <TimelineBody {...props} density="compact" headline legend={false} showTransport={false} run={run} />
          )}
        </div>
      )}
    </>
  );
}

export function SplitDock() {
  const t = trace.value;
  return t === null ? (
    <>
      <SplitBar run={null} sized={false} />
      <div class="tl-slot">
        {appTimelineOn() ? <AppTimeline /> : (
          <div class="empty">
            <span class="empty-k">Timeline</span>
            <p>No events yet. Select a card to add an event, or pick a scenario.</p>
          </div>
        )}
      </div>
    </>
  ) : <SplitRun t={t} />;
}
