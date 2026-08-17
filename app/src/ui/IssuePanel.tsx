/**
 * Validation issues (ui.md SS3, Build mode's bottom row and the foot of the
 * Break rail).
 *
 * Every row here comes from the engine's `validate()` -- the same function the
 * generated DGMGRL script takes its notes from, so the rail and the script can
 * never disagree about what is wrong with a configuration.
 *
 * Severity and basis are orthogonal (engine.md SS0.2): an error can be this
 * page's model and a piece of information can be documented, so the row shows
 * both -- the colour band is the severity, the chip is where the claim comes
 * from. Clicking a row selects what it is about, so the finding and the
 * drawing are the same object seen twice. An empty list says something true
 * rather than nothing at all.
 *
 * **Errors and warnings are open; information is folded.** A healthy preset
 * raises half a dozen INFO rows -- true, worth reading once, and read as six
 * alarms when they are stacked open under a heading that counted them as
 * issues. They keep their own toggle, they are one click away, and they are
 * never drawn in a warning colour. Nothing is hidden by CSS: a folded note is
 * not in the document until the toggle puts it there.
 */

import type { Finding } from '@/engine';
import { errors, issues, warnings } from '@/state/derived';
import { inspectorOpen, notesOpen, selection, viewport } from '@/state/view';
import { Fact } from './common/Chip';
import { printing } from './print';
import '@/styles/inspector.css';

const TONE = { error: 'rd', warning: 'am', info: 'sl' } as const;

function Row({ f }: { f: Finding }) {
  return (
    <button
      type="button"
      class={`issue sv-${f.severity}`}
      aria-label={`${f.severity}: ${f.message}`}
      onClick={() => {
        if (f.subject.id === undefined) { selection.value = []; } else { selection.value = [f.subject.id]; }
        if (viewport.value !== 'wide') inspectorOpen.value = true;
      }}
    >
      <span class={`tag t-${TONE[f.severity]}`}>{f.severity}</span>
      <p class="issue-b">
        {f.message}
        {f.ora ? <span class="mono"> {f.ora}</span> : null}
        <Fact basis={f.basis} id={f.id} />
      </p>
      <span class="issue-id">
        {f.id}
        {f.subject.id === undefined ? '' : ` · ${f.subject.id}`}
      </span>
    </button>
  );
}

export function IssuePanel() {
  const list = issues.value;
  const loud = list.filter((f) => f.severity !== 'info');
  const notes = list.filter((f) => f.severity === 'info');
  /* On paper nothing is folded: a printed page has no toggle to press. */
  const open = notesOpen.value || printing.value;

  const counts = [
    errors.value.length === 0 ? null : `${errors.value.length} error${errors.value.length === 1 ? '' : 's'}`,
    warnings.value.length === 0 ? null : `${warnings.value.length} warning${warnings.value.length === 1 ? '' : 's'}`,
  ].filter((x) => x !== null);

  return (
    <div class="issues">
      <div class="issues-hd">
        <span class="eyebrow">Validation</span>
        <span class="caption">
          {counts.length === 0 ? 'No errors and no warnings' : counts.join(' · ')}
        </span>
      </div>

      {/* An empty list says something true rather than nothing at all -- and
          says it once: the count above is the tally, this is the sentence. */}
      {loud.length === 0 ? (
        <div class="empty">
          <span class="empty-k">Nothing to fix</span>
          <p>No issues in this configuration, as modelled here.</p>
        </div>
      ) : null}

      {loud.map((f) => (
        <Row key={`${f.id}:${f.subject.kind}:${f.subject.id ?? ''}`} f={f} />
      ))}

      {notes.length === 0 ? null : (
        <button
          type="button"
          class="notes-tog"
          aria-expanded={open}
          onClick={() => { notesOpen.value = !open; }}
        >
          <span class="notes-caret">{open ? '▾' : '▸'}</span>
          {`${notes.length} note${notes.length === 1 ? '' : 's'}`}
          <span class="notes-hint">
            {open ? 'documented behaviour worth knowing' : 'documented behaviour worth knowing, folded away'}
          </span>
        </button>
      )}

      {open
        ? notes.map((f) => (
          <Row key={`${f.id}:${f.subject.kind}:${f.subject.id ?? ''}`} f={f} />
        ))
        : null}
    </div>
  );
}
