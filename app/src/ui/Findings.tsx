/**
 * The findings, as the floating layout carries them.
 *
 * Over a full-bleed canvas there is no dock for a validation block to sit in,
 * and an always-open block of prose under the drawing was the loudest thing on
 * the page for a configuration with one warning in it. So the status card
 * carries the counts as chips -- "1 warning", "3 notes" -- and a chip opens
 * the rows in a popover over the canvas. The most serious finding may also
 * surface once as a small card above the status card, which the reader can
 * open or wave away.
 *
 * The rows are `IssuePanel`'s own (`bare`), so a finding reads, selects and
 * reveals exactly as it does anywhere else in the application.
 */

import { useEffect } from 'preact/hooks';
import type { Finding } from '@/engine';
import { errors, issues, warnings } from '@/state/derived';
import { commandOpen, findingsOpen, findingWaved, notesOpen } from '@/state/view';
import { IssuePanel, revealFindings } from './IssuePanel';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const keyOf = (f: Finding): string => `${f.id}:${f.subject.kind}:${f.subject.id ?? ''}`;

/** The chips on the status card. Each one is the way into the rows it counts. */
export function FindingsChips() {
  const errs = errors.value.length;
  const warns = warnings.value.length;
  const notes = issues.value.length - errs - warns;
  const open = findingsOpen.value;
  const toggle = (): void => {
    if (open) { findingsOpen.value = false; return; }
    revealFindings();
  };
  return (
    <div class="fnd-chips" role="group" aria-label="Validation">
      {errs + warns + notes === 0 ? (
        <span class="fnd-chip t-tl">No issues</span>
      ) : null}
      {errs === 0 ? null : (
        <button
          type="button" class="fnd-chip t-rd" aria-expanded={open} aria-controls="fnd-pop"
          title="Show the validation findings" onClick={toggle}
        >
          {plural(errs, 'error')}
        </button>
      )}
      {warns === 0 ? null : (
        <button
          type="button" class="fnd-chip t-am" aria-expanded={open} aria-controls="fnd-pop"
          title="Show the validation findings" onClick={toggle}
        >
          {plural(warns, 'warning')}
        </button>
      )}
      {notes === 0 ? null : (
        <button
          type="button" class="fnd-chip t-sl" aria-expanded={open && notesOpen.value}
          aria-controls="fnd-pop"
          title="The notes: documented behaviour worth knowing"
          onClick={() => {
            if (open && notesOpen.value) { findingsOpen.value = false; return; }
            notesOpen.value = true;
            findingsOpen.value = true;
          }}
        >
          {plural(notes, 'note')}
        </button>
      )}
    </div>
  );
}

/**
 * Escape closes the popover, and that is all it does. Taken on the way down
 * (capture, on the window) and stopped there: a card focused on the drawing,
 * or the page's own Escape on the body (shortcuts.ts), would otherwise read
 * the same press as "forget the selection" -- one key, two things undone.
 */
export function onFindingsKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !findingsOpen.value || commandOpen.value) return;
  findingsOpen.value = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}

/** The rows, over the canvas, until the reader closes them. */
export function FindingsPopover() {
  const open = findingsOpen.value;
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('keydown', onFindingsKey, true);
    return () => window.removeEventListener('keydown', onFindingsKey, true);
  }, [open]);
  if (!open) return null;
  const errs = errors.value.length;
  const warns = warnings.value.length;
  const notes = issues.value.length - errs - warns;
  const counts = [
    errs === 0 ? null : plural(errs, 'error'),
    warns === 0 ? null : plural(warns, 'warning'),
    notes === 0 ? null : plural(notes, 'note'),
  ].filter((x) => x !== null).join(' · ');
  return (
    <section class="fnd-pop float-card" id="fnd-pop" aria-label="Validation findings">
      <header class="fnd-pop-hd">
        <span class="fnd-pop-t">Validation</span>
        <span class="fnd-pop-n">{counts === '' ? 'No issues' : counts}</span>
        <span class="strip-spacer" />
        <button
          type="button" class="btn is-icon" aria-label="Close the validation findings"
          title="Close" onClick={() => { findingsOpen.value = false; }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div class="fnd-pop-body">
        <IssuePanel bare />
      </div>
    </section>
  );
}

/**
 * The most serious finding, once, as a small card above the status card.
 *
 * Gone while the popover is open (the row is right there), and gone once
 * waved away -- until a different finding takes the top spot.
 */
export function FindingToast() {
  const top = errors.value[0] ?? warnings.value[0];
  if (top === undefined || findingsOpen.value) return null;
  const key = keyOf(top);
  if (findingWaved.value === key) return null;
  const tone = top.severity === 'error' ? 'rd' : 'am';
  return (
    <div class={`fnd-toast float-card t-${tone}`} role="status">
      <span class={`fnd-chip t-${tone}`}>{top.severity === 'error' ? 'Error' : 'Warning'}</span>
      <span class="fnd-toast-m" title={top.message}>{top.message}</span>
      <button type="button" class="btn" onClick={() => revealFindings()}>Details</button>
      <button
        type="button" class="btn is-icon" aria-label="Dismiss this finding" title="Dismiss"
        onClick={() => { findingWaved.value = key; }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
