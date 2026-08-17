/**
 * The Break rail: what is actually injected into this configuration, and the
 * six scenarios as one-click templates.
 *
 * **The reader's own work comes first.** The event list is the head of the
 * rail, under the event menu, because injecting an event and then finding no
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
 * Each scenario is one row: the button, and its description on one line,
 * clipped. The full sentence is in the DOM either way -- it is the row's
 * `title`, it unclips while anything in the row has focus, one toggle at the
 * group head opens all six, and print opens them too. Nothing here is hidden
 * by CSS with no way back.
 */

import { signal } from '@preact/signals';
import { events, topology } from '@/state/derived';
import { canEdit, tNow, viewport } from '@/state/view';
import { IssuePanel } from '../IssuePanel';
import { Action, Group, Note } from '../inspector/controls';
import { WHY } from '../inspector/why';
import {
  applyTemplate, clearEvents, describeEvent, removeEventAt, setEventTime, templates,
} from './events';
import '@/styles/inspector.css';

/** Open the six scenario descriptions. View state, so it is not undoable. */
export const scenarioNotesOpen = signal(false);

export function BreakRail() {
  const doc = topology.value;
  const list = events.value;
  const editable = canEdit(viewport.value);
  const at = Math.round(tNow.value * 10) / 10;
  const open = scenarioNotesOpen.value;

  return (
    <div class="insp">
      <Group
        title={list.length === 0 ? 'Events' : `Events (${list.length})`}
        action={list.length === 0
          ? undefined
          : <Action label="Clear" onClick={() => clearEvents()} />}
      >
        {list.length === 0 ? (
          <div class="empty">
            <span class="empty-k">Nothing has happened yet</span>
            <p>
              The configuration is in its steady state. Pick a scenario below, or select a
              card on the drawing and use the Actions menu that opens with it.
            </p>
          </div>
        ) : null}

        {list.map((e, i) => (
          <div class="evt" key={`${i}-${e.kind}-${e.at}`}>
            <span class="evt-n">{i + 1}</span>
            <span class="evt-b">{describeEvent(doc, e)}</span>
            <label class="evt-at">
              <span class="sr">Time of event {i + 1}, in seconds</span>
              <input
                class="field-in"
                type="number"
                min={0}
                max={900}
                step={0.1}
                value={String(e.at)}
                disabled={!editable}
                onChange={(ev) => {
                  const v = Number((ev.currentTarget as HTMLInputElement).value);
                  if (!isFinite(v)) return;
                  setEventTime(i, Math.max(0, Math.round(v * 10) / 10));
                }}
              />
              <span class="evt-u">s</span>
            </label>
            <Action
              label="Remove"
              enabled={editable ? { state: 'on' } : { state: 'off', why: WHY.readOnlyHere }}
              onClick={() => removeEventAt(i)}
            />
          </div>
        ))}

        {list.length === 0 ? null : (
          <Note>
            t = 0 is the first injected event, and the numbers here are the numbers on the
            axis. The playhead is at t = {at} s; a card clicked on the drawing injects its
            event there.
          </Note>
        )}
      </Group>

      <Group
        title="One-click scenarios"
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
        <p class="caption tmpl-lede">
          Each one replaces whatever is injected now — the observer stays wherever its
          card sits.
        </p>

        <div class={open ? 'tmpls is-open' : 'tmpls'}>
          {templates(doc, 0).map((t) => (
            <div class="tmpl" key={t.id}>
              <Action
                label={t.label}
                enabled={editable ? t.enabled : { state: 'off', why: WHY.readOnlyHere }}
                onClick={() => applyTemplate(t)}
              />
              <p class="tmpl-cap" title={t.caption}>{t.caption}</p>
            </div>
          ))}
        </div>
      </Group>

      {/* The same validation the Build dock shows, worded and folded the same
          way: what is wrong with a configuration does not stop being true
          because the reader switched to breaking it. */}
      <IssuePanel />
    </div>
  );
}
