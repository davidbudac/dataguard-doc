/**
 * The Detailed timeline's rail: what is actually injected into this
 * configuration, and (docked) the six scenarios as one-click templates.
 *
 * **The reader's own work comes first.** The event list is the head of the
 * rail, because injecting an event and then finding no
 * record of it on screen -- six scenario blurbs pushed the list a thousand
 * pixels down -- reads as "nothing happened". The scenarios are the shelf you
 * take something off once; the list is where the thing you took stays.
 *
 * A template replaces the event list rather than adding to it. That is
 * deliberate: a scenario is a claim about what a deployment does, and a claim
 * is only worth anything if the reader can reproduce it -- so picking one
 * always lands on exactly the events the engine's own regression matrix runs.
 * Anything hand-injected from the canvas sits in the list above, where its
 * time can be moved and it can be taken out again.
 *
 * The **empty state stays** whatever the `Hints` switch says -- a panel with
 * nothing in it has to say something true (ui.md SS8) -- and so does every
 * refusal. What rides with the switch is the prose that explains: the note
 * under the event list, and the one-line rule over the scenarios. The six
 * scenario descriptions keep their own mechanism ("Show descriptions"); they
 * are not gated twice.
 *
 * The scenarios are a shelf: six names in two columns, and nothing else. The
 * descriptions are behind the group head's own `Show descriptions` toggle --
 * six clipped one-line captions under six buttons were twelve rows of text
 * for a shelf a reader takes one thing off (ui.md SS3f). What is folded is
 * genuinely absent rather than clipped by CSS, the sentence is the button's
 * `title` at every setting, the toggle that brings it back is the row above
 * it, and print renders every description.
 */

import { signal } from '@preact/signals';
import { events, topology, trace } from '@/state/derived';
import { canEdit, healthyRun, tNow, viewport } from '@/state/view';
import { IssuePanel } from '../IssuePanel';
import { Action, Fold, Group, Note } from '../inspector/controls';
import { SCENARIOS_ID } from '../inspector/sections';
import { hintsShown, HintsToggle } from '../hints';
import { printing } from '../print';
import { WHY } from '../inspector/why';
import { useRailRow } from '../common/Field';
import {
  applyTemplate, clearEvents, describeEvent, removeEventAt, reorderEvent, setEventTime, shelf,
} from './events';
import { eventTimeBounds, reorderRefusal } from './event-order';
import { RunExplanation } from './RunExplanation';
import '@/styles/inspector.css';

/** Open the six scenario descriptions. View state, so it is not undoable. */
export const scenarioNotesOpen = signal(false);

export interface BreakRailProps {
  children?: unknown;
  /**
   * Whether the scenarios ride on the rail. Where the Detailed timeline
   * floats they are Topology's dock row instead (`ScenarioRow`).
   */
  scenarios?: boolean;
  /** Whether the validation panel closes the rail. The floating layout has
      the status chips and their popover for that (Findings.tsx). */
  validation?: boolean;
}

export function BreakRail({ scenarios = true, validation = true }: BreakRailProps = {}) {
  const railRef = useRailRow();
  const doc = topology.value;
  const list = events.value;
  const editable = canEdit(viewport.value);
  const at = Math.round(tNow.value * 10) / 10;
  const open = scenarioNotesOpen.value;
  /* On paper there is no toggle to press, exactly as every `Fold` opens. */
  const shown = open || printing.value;

  return (
    <div class="insp" ref={railRef}>
      <Group
        title={list.length === 0 ? 'Events' : `Events (${list.length})`}
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
              {scenarios
                ? 'Pick a scenario below, or select a card to add an event.'
                : 'Add an event from a card or a lane, or pick a scenario in Topology.'}
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
            swap adjacent times while keeping related events in order. The playhead is at t = {at} s.
          </Note>
        )}
      </Group>

      {/* What the run decided, and why: under the events that caused it. */}
      {trace.value ? <RunExplanation doc={doc} trace={trace.value} /> : null}

      {scenarios ? (
      <Fold
        id={SCENARIOS_ID}
        title="One-click scenarios"
        hint={`${shelf(doc, 0).length} scenarios`}
        action={(
          <button
            type="button"
            class="btn is-quiet tmpl-tog"
            aria-expanded={open}
            onClick={() => { scenarioNotesOpen.value = !open; }}
          >
            <span class="tmpl-car">{open ? '▾' : '▸'}</span>
            Show descriptions
          </button>
        )}
      >
        {/* The rule the six buttons obey, which is explanation and not state:
            it rides with the `Hints` switch like every other sentence of prose
            on a rail. Replacing the list is undoable, and the button that does
            it names itself. */}
        {hintsShown() ? (
          <p class="caption tmpl-lede">
            A scenario replaces the current events. The topology stays the same.
          </p>
        ) : null}

        <div class={shown ? 'tmpls is-open' : 'tmpls'}>
          {shelf(doc, 0).map((t) => (
            <div class="tmpl" key={t.id}>
              <Action
                label={t.label}
                title={t.caption}
                enabled={editable ? t.enabled : { state: 'off', why: WHY.readOnlyHere }}
                onClick={() => applyTemplate(t)}
              />
              {shown ? <p class="tmpl-cap" title={t.caption}>{t.caption}</p> : null}
            </div>
          ))}
        </div>
      </Fold>
      ) : null}

      {/* The same validation the Build dock shows, worded and folded the same
          way: what is wrong with a configuration does not stop being true
          because the reader switched to breaking it. */}
      {validation ? <IssuePanel /> : null}
    </div>
  );
}
