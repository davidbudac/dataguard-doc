/**
 * The findings, as the floating layout carries them.
 *
 * Over a full-bleed canvas there is no dock for a validation block to sit in,
 * and an always-open block of prose under the drawing was the loudest thing on
 * the page for a configuration with one warning in it. So the status card
 * carries the counts as chips -- "1 warning", "3 notes" -- and a chip opens
 * the rows in a popover over the canvas. There is no card that surfaces the
 * most serious finding by itself: the chips on the status card are the one
 * place the counts live, and the reader opens the rows when they want them.
 *
 * The rows are `IssuePanel`'s own (`bare`), so a finding reads, selects and
 * reveals exactly as it does anywhere else in the application.
 */

import { useEffect } from 'preact/hooks';
import { errors, issues, warnings } from '@/state/derived';
import { findingsOpen, notesOpen } from '@/state/view';
import { IssuePanel, revealFindings } from './IssuePanel';

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  if (e.key !== 'Escape' || !findingsOpen.value) return;
  findingsOpen.value = false;
  e.preventDefault();
  e.stopImmediatePropagation();
}

/** How many of each severity there are, and the same as a phrase: "1 warning · 3 notes". */
export function findingCounts(): { errs: number; warns: number; notes: number; text: string } {
  const errs = errors.value.length;
  const warns = warnings.value.length;
  const notes = issues.value.length - errs - warns;
  const text = [
    errs === 0 ? null : plural(errs, 'error'),
    warns === 0 ? null : plural(warns, 'warning'),
    notes === 0 ? null : plural(notes, 'note'),
  ].filter((x) => x !== null).join(' · ');
  return { errs, warns, notes, text };
}

/**
 * The head and the rows of the findings popover: the counts, a close button,
 * and `IssuePanel`'s own rows. The popover over the canvas (`FindingsPopover`)
 * and the dropdown on the Detailed timeline's bar (`break/RunBar.tsx`) both wrap it, so
 * the two read and behave as one.
 */
export function FindingsSheet() {
  const { text: counts } = findingCounts();
  return (
    <>
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
    </>
  );
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
  return (
    <section class="fnd-pop float-card" id="fnd-pop" aria-label="Validation findings">
      <FindingsSheet />
    </section>
  );
}
