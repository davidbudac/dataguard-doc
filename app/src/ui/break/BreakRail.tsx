/**
 * The Break rail: the six scenarios as one-click templates, and the events
 * that are actually in this configuration.
 *
 * A template replaces the event list rather than adding to it. That is
 * deliberate: a scenario is a claim about what a deployment does, and a claim
 * is only worth anything if the reader can reproduce it -- so picking one
 * always lands on exactly the events the engine's own regression matrix runs.
 * Anything hand-injected from the canvas sits in the list below, where its
 * time can be moved and it can be taken out again.
 */

import { events, topology } from '@/state/derived';
import { canEdit, tNow, viewport } from '@/state/view';
import { IssuePanel } from '../IssuePanel';
import { Action, Group, Note } from '../inspector/controls';
import { WHY } from '../inspector/why';
import {
  applyTemplate, clearEvents, describeEvent, removeEventAt, setEventTime, templates,
} from './events';
import '@/styles/inspector.css';

export function BreakRail() {
  const doc = topology.value;
  const list = events.value;
  const editable = canEdit(viewport.value);
  const at = Math.round(tNow.value * 10) / 10;

  return (
    <div class="insp">
      <Group title="One-click scenarios">
        {templates(doc, 0).map((t) => (
          <div class="tmpl" key={t.id}>
            <Action
              label={t.label}
              enabled={editable ? t.enabled : { state: 'off', why: WHY.readOnlyHere }}
              onClick={() => applyTemplate(t)}
            />
            <p class="caption">{t.caption}</p>
          </div>
        ))}
        <Note>
          Each one replaces whatever is injected now, so the same scenario always draws
          the same thing. The observer placement is not a control here: it is wherever the
          observer card sits.
        </Note>
      </Group>

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
              The configuration is in its steady state. Pick a scenario above, or select a
              card on the drawing and use the menu over the canvas.
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

      {/* The same validation the Build dock shows, worded and folded the same
          way: what is wrong with a configuration does not stop being true
          because the reader switched to breaking it. */}
      <IssuePanel />
    </div>
  );
}
