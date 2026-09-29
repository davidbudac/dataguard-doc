/**
 * The event menu: what can be done to whatever is selected, at the moment the
 * playhead is on.
 *
 * It sits over the canvas rather than at the pointer, for a reason that is
 * not cosmetic: the page ships under a content security policy with
 * `style-src 'self'`, so nothing here can be positioned with an inline style.
 * A panel with a fixed place is also a panel the reader can find again, and
 * its collapse button stays where it is when it is closed -- a collapsible
 * never takes its own control away with it.
 *
 * Two things the header has to say out loud, because the menu was a trap
 * without them:
 *
 *  - **Events land at the playhead**, and the title alone never said so. A
 *    reader who had scrubbed to 40 s and one who had not both read "Inject at
 *    t = 0 s" as a fact about the menu rather than as a fact about where the
 *    playhead was. The clock reading in the title is now the control that sets
 *    it -- one number, editable, and moving it moves the playhead, so the
 *    drawing and the number can never disagree.
 *  - **A refusal is said once.** An entry that cannot fire is grey with its
 *    reason beside it -- aborting an instance that is already gone, switching
 *    over with no standby to switch to. But the restores are different: with
 *    nothing down, *every* restore in the list is refused for the same reason,
 *    and three copies of NOTHING HAS TAKEN IT DOWN, SO THERE IS NOTHING TO
 *    RESTORE was the loudest thing on the drawing. Those entries are not
 *    rendered at all, and one quiet line in their place says why -- which is
 *    the reason stated, not the reason hidden. That line is read off the
 *    *subjects* (`anythingDownUnder`), never off the list it stands in for:
 *    the list is an intersection that keeps the first blocked subject's
 *    reason, and reading it made the sentence contradict the drawing beside
 *    it. A restore whose container is still down is not in this group at all:
 *    it stays on the list, grey, naming the thing to bring back first.
 */

import { signal } from '@preact/signals';
import type { JSX } from 'preact';
import { topology } from '@/state/derived';
import { canEdit, selection, tNow, viewport } from '@/state/view';
import { Action } from '../inspector/controls';
import { hintsShown } from '../hints';
import { WHY } from '../inspector/why';
import { actionsFor, nothingToRestore, restoreQuietLine, runAction } from '../break/events';
import '@/styles/evmenu.css';

/** Open by default; the button that closes it stays in place when it is shut. */
export const menuOpen = signal(true);

/** Events land on a tenth of a second: the axis is read to that, not finer. */
export const snapT = (t: number): number => Math.round(t * 10) / 10;

export function EventMenu() {
  const doc = topology.value;
  const keys = selection.value;
  const at = snapT(tNow.value);
  const editable = canEdit(viewport.value);

  if (!menuOpen.value) {
    return (
      <div class="evmenu is-shut">
        <button type="button" class="btn" onClick={() => { menuOpen.value = true; }}>
          Actions
        </button>
      </div>
    );
  }

  const actions = editable ? actionsFor(doc, keys, at) : [];
  const events = actions.filter((a) => a.property !== true);
  const props = actions.filter((a) => a.property === true);
  const offered = events.filter((a) => !nothingToRestore(a));
  /* The four readings of the line that stands in for the dropped restores are
     the table's own (`break/events`), so the bar on the canvas prints the same
     sentence for the same selection rather than a second opinion of it. */
  const quiet = restoreQuietLine(doc, keys, at, events);

  /* The injection time is the playhead: setting one sets the other, so the
     drawing under the menu always shows the moment the menu is aimed at. */
  const onAt = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const raw = e.currentTarget.value.replace(',', '.').trim();
    const v = Number.parseFloat(raw);
    const next = Number.isFinite(v) ? Math.max(0, snapT(v)) : at;
    tNow.value = next;
    e.currentTarget.value = String(next);
  };

  return (
    <div class="evmenu" role="group" aria-label="Inject an event">
      <header class="evmenu-hd">
        {/* Names what the actions below are for: a menu titled only by the
            clock reads as a list of things to do to nothing in particular. */}
        {/* Not an eyebrow: this names an action at a clock reading, and the
            all-caps mono form turned "Inject at t = 40 s" into a shout. */}
        <span class="evmenu-title mono">
          {keys.length === 0 ? '' : <>{keys.join(', ')} &middot; </>}
          <span class="evmenu-inject">
            Inject at t ={' '}
            {/* The reading is the control. A second field beside a fixed title
                would put two numbers for one moment on one line, which is the
                habit the readout strip above has just been cured of. Read-only
                keeps the number and drops the control: a disabled box with no
                reason on it is exactly what the WhyPill contract forbids. */}
            {editable ? (
              <input
                class="evmenu-at"
                type="number"
                min={0}
                step={0.1}
                inputMode="decimal"
                value={String(at)}
                aria-label="Injection time in seconds"
                onChange={onAt}
              />
            ) : at}
            {' '}s
          </span>
        </span>
        <span class="rr-spacer" />
        <button type="button" class="btn" onClick={() => { menuOpen.value = false; }}>
          Hide
        </button>
      </header>

      {/* Explanation, not state: it rides with the `Hints` switch, while the
          quiet restore line and every refusal below stay whatever that says.
          The header's clock reading is the fact this sentence spells out, and
          that reading is on screen either way. */}
      {editable && hintsShown() ? (
        <p class="evmenu-hint">
          New events use the playhead time. Move it to add an event later.
        </p>
      ) : null}

      {!editable ? (
        <p class="evmenu-empty">{WHY.readOnlyView}</p>
      ) : keys.length === 0 ? (
        <p class="evmenu-empty">
          Select a card, a data centre or a link to see the events it offers.
        </p>
      ) : events.length === 0 && props.length === 0 ? (
        <p class="evmenu-empty">
          No event applies to this whole selection. Select one card to see its events.
        </p>
      ) : null}

      {offered.map((a) => (
        <div class="evmenu-row" key={a.id}>
          <Action label={a.label} enabled={a.enabled} onClick={() => runAction(a)} />
        </div>
      ))}

      {quiet === null ? null : <p class="evmenu-quiet">{quiet}</p>}

      {props.length === 0 ? null : (
        <>
          <p class="evmenu-note">
            A setting, not an event: it holds for the whole simulation, not from t = {at} s.
          </p>
          {props.map((a) => (
            <div class="evmenu-row" key={a.id}>
              <Action label={a.label} enabled={a.enabled} onClick={() => runAction(a)} />
            </div>
          ))}
        </>
      )}

      {keys.length > 1 ? (
        <p class="evmenu-note">
          Showing the events all {keys.length} selected objects share.
        </p>
      ) : null}
    </div>
  );
}
