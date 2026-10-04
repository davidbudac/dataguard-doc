/** Page shortcuts share the command catalogue. Text fields retain their own
 * editing keys, and modal dialogs retain all keys except palette toggle. */
import { canEdit, clearSelection, commandOpen, selection, viewport } from '@/state/view';
import { redo } from '@/state/history';
import { commands, matchesShortcut, runCommand } from './commands';
import { isElement } from './common/dom';

const typing = (target: EventTarget | null): boolean => isElement(target)
  && (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null);

export function onGlobalKey(ev: KeyboardEvent): void {
  if (ev.defaultPrevented || ev.isComposing) return;
  const mod = ev.ctrlKey || ev.metaKey;
  const key = ev.key.toLowerCase();
  const dialog = isElement(ev.target) ? ev.target.closest('[role="dialog"]') : null;
  if (mod && !ev.altKey && !ev.shiftKey && key === 'k') {
    // A second modal would break the current dialog's focus contract.
    if (dialog && !commandOpen.value) return;
    ev.preventDefault();
    if (!ev.repeat) commandOpen.value = !commandOpen.value;
    return;
  }
  if (typing(ev.target) || dialog || commandOpen.value) return;
  if (mod && !ev.altKey && !ev.shiftKey && key === 'y' && canEdit(viewport.value)) {
    ev.preventDefault(); redo(); return;
  }
  const action = commands().find(c => c.shortcut && matchesShortcut(ev, c.shortcut));
  if (action) {
    ev.preventDefault();
    if (!ev.repeat || ['undo', 'redo', 'zoom-in', 'zoom-out', 'previous', 'next'].includes(action.id)) runCommand(action.id);
    return;
  }
  if (ev.key === 'Escape' && ev.target === document.body && selection.value.length) clearSelection();
}
export function installShortcuts(): () => void {
  document.addEventListener('keydown', onGlobalKey);
  return () => document.removeEventListener('keydown', onGlobalKey);
}
