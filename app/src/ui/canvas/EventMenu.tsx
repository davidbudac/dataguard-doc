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
 * Every entry that cannot fire is grey with the reason beside it: restoring
 * something nothing has taken down, aborting an instance that is already
 * gone, switching over with no standby to switch to.
 */

import { signal } from '@preact/signals';
import { topology } from '@/state/derived';
import { canEdit, selection, tNow, viewport } from '@/state/view';
import { Action } from '../inspector/controls';
import { WHY } from '../inspector/why';
import { actionsFor, runAction } from '../break/events';

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

  return (
    <div class="evmenu" role="group" aria-label="Inject an event">
      <header class="evmenu-hd">
        {/* Names what the actions below are for: a menu titled only by the
            clock reads as a list of things to do to nothing in particular. */}
        <span class="eyebrow">
          {keys.length === 0 ? '' : <><span class="mono">{keys.join(', ')}</span> &middot; </>}
          At t = {at} s
        </span>
        <span class="rr-spacer" />
        <button type="button" class="btn" onClick={() => { menuOpen.value = false; }}>
          Hide
        </button>
      </header>

      {!editable ? (
        <p class="evmenu-empty">{WHY.readOnlyView}</p>
      ) : keys.length === 0 ? (
        <p class="evmenu-empty">
          Select a card, a data centre or a line on the drawing, and what can be done to
          it appears here.
        </p>
      ) : events.length === 0 && props.length === 0 ? (
        <p class="evmenu-empty">
          Nothing in this selection can be broken together. Select one card at a time to
          see what it offers.
        </p>
      ) : null}

      {events.map((a) => (
        <div class="evmenu-row" key={a.id}>
          <Action label={a.label} enabled={a.enabled} onClick={() => runAction(a)} />
        </div>
      ))}

      {props.length === 0 ? null : (
        <>
          <p class="evmenu-note">
            A property, not an event: this one holds from the first frame rather than
            landing at t = {at} s.
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
          {keys.length} objects are selected, so this is what all of them can do.
        </p>
      ) : null}
    </div>
  );
}
