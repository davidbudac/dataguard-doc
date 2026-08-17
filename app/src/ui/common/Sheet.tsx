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
 *    asked to be sent to the top of the document.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface SheetProps {
  open: boolean;
  title: string;
  position?: 'right' | 'bottom';
  onClose: () => void;
  children: ComponentChildren;
}

export function Sheet({ open, title, position = 'right', onClose, children }: SheetProps) {
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
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const back = opener.current;
      opener.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div class="scrim" onClick={onClose} />
      <aside
        class={`sheet p-${position}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
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
