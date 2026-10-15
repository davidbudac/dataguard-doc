/**
 * The overlay drawer (1024-1279) and the bottom sheet (768-1023).
 *
 * A closed sheet is not in the document at all -- it is not painted out of
 * view with CSS -- which is the same contract the modes keep: what you cannot
 * see is not there, rather than there and hidden.
 *
 * It is a modal dialog, so it keeps a modal dialog's three promises, and each
 * of them is a keyboard promise before it is a mouse one:
 *
 *  - **Escape closes it**, wherever the focus is. The listener is on the
 *    document, not on the panel: focus can legitimately sit on the scrim, and
 *    a key that works only when the pointer put the focus in the right place
 *    is not a keyboard affordance.
 *  - **Opening moves the focus in**, to the panel itself, so the next Tab
 *    lands on the first control inside rather than back in the page behind.
 *  - **Closing gives the focus back** to whatever opened it -- the status
 *    bar's Inspector button -- because a reader who pressed Escape has not
 *    asked to be sent to the top of the document. An opener that has since
 *    been folded away (an item of the ⋯ menu, which shuts on a press) hands
 *    it to the menu's own button instead.
 *  - **Tab stays inside** while it is open: it is `aria-modal`, and a Tab
 *    that walks out into the page behind it is a Tab into controls the scrim
 *    says are not there.
 *
 * `variant="card"` is the same dialog as a floating card under the top bar
 * (float.css) -- the look of the page's other floating panels -- for the
 * dialogs the ⋯ menu opens, rather than the drawer's full-height edge.
 *
 * `modal={false}` is the Inspector beside the lanes at 1024-1279: no scrim,
 * no `aria-modal`, no Tab fence -- the page behind it is what the reader is
 * meant to watch while a setting changes -- and Escape closes it only from
 * inside the panel, so the lanes' own Escape (a popover, the action bar) is
 * not also the panel's. Opening still moves the focus in and closing still
 * gives it back.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface SheetProps {
  open: boolean;
  title: string;
  position?: 'right' | 'bottom';
  variant?: 'edge' | 'card';
  /** A modal dialog (the default), or a panel the page stays live beside. */
  modal?: boolean;
  /** Extra classes on the panel, for a dialog that needs its own width. */
  class?: string;
  initialFocus?: string;
  onClose: () => void;
  children: ComponentChildren;
}

/** What Tab may land on inside the panel, in document order. */
function tabbable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), '
    + 'textarea:not(:disabled), summary, [tabindex="0"]',
  )].filter((el) => {
    if (el.closest('[hidden]')) return false;
    for (let up: HTMLElement | null = el; up && up !== panel; up = up.parentElement) {
      if (up.matches('details:not([open])') && el !== up.querySelector('summary')) return false;
      const cs = getComputedStyle(up);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  });
}

export function Sheet({
  open, title, initialFocus, position = 'right', variant = 'edge', modal = true, class: extra, onClose, children,
}: SheetProps) {
  const panel = useRef<HTMLElement | null>(null);
  const opener = useRef<Element | null>(null);
  /* `onClose` is an inline arrow at every call site, so it is a new function
     on every render of the shell. The effect below hangs on `open` alone --
     re-running it would hand the focus back to the opener while the reader is
     still typing inside the panel -- and reads the current callback here. */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    opener.current = document.activeElement;
    panel.current?.focus();
    if (initialFocus) panel.current?.querySelector<HTMLElement>(initialFocus)?.focus();
    const onKey = (ev: KeyboardEvent): void => {
      const box = panel.current;
      if (ev.key === 'Tab' && box && modal) {
        const stops = tabbable(box);
        const first = stops[0];
        const last = stops.at(-1);
        const at = document.activeElement;
        if (!first || !last) { ev.preventDefault(); box.focus(); } else if (ev.shiftKey && (at === first || at === box)) {
          ev.preventDefault(); last.focus();
        } else if (!ev.shiftKey && (at === last || !box.contains(at))) {
          ev.preventDefault(); first.focus();
        }
        return;
      }
      if (ev.key !== 'Escape') return;
      if (!modal && !(box && box.contains(document.activeElement))) return;
      ev.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const back = opener.current;
      opener.current = null;
      const shut = back instanceof HTMLElement ? back.closest('details:not([open])') : null;
      if (shut) shut.querySelector<HTMLElement>('summary')?.focus();
      else if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [open, modal]);

  if (!open) return null;
  return (
    <>
      {modal ? <div class={variant === 'card' ? 'scrim is-light' : 'scrim'} onClick={onClose} /> : null}
      <aside
        class={`sheet p-${position}${variant === 'card' ? ' is-card' : ''}${extra ? ` ${extra}` : ''}`}
        ref={panel}
        role="dialog"
        aria-modal={modal ? 'true' : undefined}
        aria-label={title}
        tabIndex={-1}
      >
        <header class="sheet-hd">
          <span class="title">{title}</span>
          <button type="button" class="btn" onClick={onClose}>Close</button>
        </header>
        <div class="sheet-body">{children}</div>
      </aside>
    </>
  );
}
