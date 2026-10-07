/** Scenario step: scheduled events, exact times, ordering and validation. */

import { events, topology } from '@/state/derived';
import { canEdit, healthyRun, tNow, viewport } from '@/state/view';
import { revealFindings } from '../IssuePanel';
import { findingCounts } from '../Findings';
import { Action, Group, Note } from '../inspector/controls';
import { HintsToggle } from '../hints';
import { WHY } from '../inspector/why';
import { useRailRow } from '../common/Field';
import {
  clearEvents, describeEvent, removeEventAt, reorderEvent, setEventTime,
} from './events';
import { eventTimeBounds, reorderRefusal } from './event-order';
import '@/styles/inspector.css';

export function BreakRail() {
  const railRef = useRailRow();
  const doc = topology.value;
  const list = events.value;
  const editable = canEdit(viewport.value);
  const at = Math.round(tNow.value * 10) / 10;

  return (
    <div class="insp" ref={railRef}>
      <Group
        title={list.length === 0 ? 'Nothing scheduled' : `${list.length} scheduled`}
        action={(
          <>
            <HintsToggle />
            {list.length === 0
              ? null
              : <Action label="Clear" onClick={() => clearEvents()} />}
          </>
        )}
      >
        {list.length === 0 ? (
          <div class="empty">
            <span class="empty-k">{healthyRun.value ? 'No events — everything is working' : 'No events yet'}</span>
            <p>
              Choose a starting scenario, or select a card and schedule an event.
            </p>
          </div>
        ) : null}

        {list.map((e, i) => (
          <div class="evt" key={`${i}-${e.kind}-${e.at}`}>
            <span class="evt-n">{i + 1}</span>
            <span class="evt-b">{describeEvent(doc, e)}</span>
            {/* The event's controls on a line of their own under what it is:
                its time, the two swaps, and Remove at the end -- the same
                order on every row, whatever the description's length. */}
            <div class="evt-ctl">
            <label class="evt-at">
              <span class="evt-u">at</span>
              <span class="sr">Time of event {i + 1}, in seconds</span>
              <input
                class="field-in"
                type="number"
                min={eventTimeBounds(doc, i).min}
                max={eventTimeBounds(doc, i).max}
                step={0.1}
                value={String(e.at)}
                disabled={!editable}
                onChange={(ev) => {
                  const v = Number((ev.currentTarget as HTMLInputElement).value);
                  if (!isFinite(v)) return;
                  setEventTime(i, v);
                  (ev.currentTarget as HTMLInputElement).value = String(e.at);
                }}
              />
              <span class="evt-u">s</span>
            </label>
            {list.length > 1 ? (
              <div class="evt-order" aria-label={`Reorder event ${i + 1}`}>
                {([-1, 1] as const).map((direction) => {
                  if (i + direction < 0 || i + direction >= list.length) return null;
                  const why = editable ? reorderRefusal(doc, i, direction) : WHY.readOnlyHere;
                  return <Action
                    key={direction}
                    label={direction === -1 ? '↑ Earlier' : '↓ Later'}
                    title="Swap times with the adjacent event"
                    enabled={why ? { state: 'off', why } : { state: 'on' }}
                    onClick={() => reorderEvent(i, direction)}
                  />;
                })}
              </div>
            ) : null}
            <span class="rr-spacer" />
            <Action
              label="Remove"
              enabled={editable ? { state: 'on' } : { state: 'off', why: WHY.readOnlyHere }}
              onClick={() => removeEventAt(i)}
            />
            </div>
          </div>
        ))}

        {list.length === 0 ? null : (
          <Note>
            Drag numbered events on the timeline to change their time. Earlier and Later
            swap adjacent times while keeping related events in order. New events are scheduled at t = {at} s.
          </Note>
        )}
      </Group>


      {/* What is wrong with the configuration does not stop being true because
          the reader switched to breaking it -- but the rows belong to step 1.
          One line with the counts, and the way to the findings. */}
      <ValidationLine />
    </div>
  );
}

/** The validation counts as one line, and the way to the rows. */
function ValidationLine() {
  const { errs, warns, text } = findingCounts();
  const tone = errs > 0 ? 't-rd' : warns > 0 ? 't-am' : 't-sl';
  return (
    <div class="rail-val">
      <span class="eyebrow">Validation</span>
      <button
        type="button"
        class={`rail-val-btn ${tone}`}
        title="Show the validation findings"
        onClick={() => revealFindings()}
      >
        {text === '' ? 'No issues' : text}
        <span aria-hidden="true"> →</span>
      </button>
    </div>
  );
}
