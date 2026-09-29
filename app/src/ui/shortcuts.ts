/**
 * The keys that belong to the page rather than to a control on it.
 *
 * Undo and redo were two buttons in the header and nothing else, which made
 * every slip on the drawing a trip to the top of the page. These are the
 * bindings every editor has taught: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` and
 * `Ctrl+Y`, and `Ctrl/Cmd+A` for every card on the drawing.
 *
 * A key typed into a field is the field's: the browser's own undo inside a
 * text input is not this page's to take.
 */

import { topology } from '@/state/derived';
import { redo, undo } from '@/state/history';
import { toggleRail } from '@/state/persist';
import { canEdit, clearSelection, introPage, mode, selection, viewport } from '@/state/view';
import { isHTMLElement } from './common/dom';

const typing = (t: EventTarget | null): boolean =>
  isHTMLElement(t)
  && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

export function onGlobalKey(ev: KeyboardEvent): void {
  if (ev.defaultPrevented || typing(ev.target) || !canEdit(viewport.value)) return;
  const mod = ev.ctrlKey || ev.metaKey;
  const key = ev.key.toLowerCase();
  if (mod && !ev.altKey && key === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) redo(); else undo();
    return;
  }
  if (mod && !ev.altKey && !ev.shiftKey && key === 'y') {
    ev.preventDefault();
    redo();
    return;
  }
  const drawing = mode.value === 'build' || mode.value === 'break';
  if (mod && !ev.altKey && !ev.shiftKey && key === 'a' && drawing) {
    ev.preventDefault();
    const t = topology.value;
    selection.value = [
      ...t.members.map((m) => m.id as string), ...t.observers.map((o) => o.id as string),
      ...(t.application ? [t.application.id as string] : []),
    ];
    return;
  }
  /* `]` folds or unfolds the side rail (a drawer below 1280). Checked on the
     character, not the key position, and AltGr (Ctrl+Alt on Windows) is let
     through: on a Czech or German layout `]` is an AltGr chord. Not in
     Learn, whose right half is the workbench rather than a rail. */
  if (ev.key === ']' && !ev.metaKey && (!ev.ctrlKey || ev.altKey) && mode.value !== 'learn' && !introPage.value) {
    ev.preventDefault();
    toggleRail();
    return;
  }
  /* `Escape` with the focus nowhere: the cards handle their own, this is the
     press after a click on the ground or in the margin. */
  if (ev.key === 'Escape' && isHTMLElement(ev.target) && ev.target === ev.target.ownerDocument.body && selection.value.length > 0) {
    clearSelection();
  }
}

/** Installed once by the shell; returns the uninstall. */
export function installShortcuts(): () => void {
  document.addEventListener('keydown', onGlobalKey);
  return () => document.removeEventListener('keydown', onGlobalKey);
}
