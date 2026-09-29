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
import {
  findingsOpen, floating, inspectorOpen, issuesOpen, lessonId, mode, notesOpen, selection,
  toast, viewport,
} from '@/state/view';
import { revealRail, setIssuesOpen, toggleIssues } from '@/state/persist';
import { Fact } from './common/Chip';
import { revealSections, sectionOfRule } from './inspector/sections';
import { printing } from './print';
import '@/styles/inspector.css';

const TONE = { error: 'rd', warning: 'am', info: 'sl' } as const;

/**
 * Take the reader to the findings, wherever this mode keeps them.
 *
 * The count in the status bar was a piece of text: it said "1 issue · 3 notes"
 * about a panel the reader had to go and find, and in Configure and Learn
 * about a panel that is not on screen at all. This is what the count does when
 * it is pressed -- Build docks the panel under the drawing, Break keeps it at
 * the foot of its rail (a drawer below 1280), and the two modes that host no
 * panel hand over to Build, which does.
 *
 * A healthy configuration raises only notes, and notes are folded: sending
 * somebody to a panel whose whole content is behind a toggle is sending them
 * to an empty panel, so the toggle is opened for them.
 *
 * Leaving Learn is the one hand-over that costs the reader something: the
 * lesson they were reading goes off screen. It is not lost -- `lessonId` and
 * `lessonStep` are session state, so Learn comes back on the step it was left
 * on -- so this says exactly that, and offers the way back, rather than
 * swapping the page out from under them without a word.
 */
export function revealFindings(): void {
  const loud = errors.value.length + warnings.value.length;
  const notes = issues.value.length - loud;
  if (loud === 0 && notes > 0) notesOpen.value = true;
  /* Sending somebody to a folded panel is sending them to a heading. */
  setIssuesOpen(true);
  if (mode.value === 'learn') {
    const open = lessonId.value !== null;
    mode.value = 'build';
    toast.value = {
      kind: 'info',
      text: open
        ? 'The findings are in Build. Your lesson is where you left it.'
        : 'The findings are in Build.',
      ...(open ? { action: { label: 'Back to the lesson', run: () => { mode.value = 'learn'; } } } : {}),
    };
  } else if (mode.value === 'configure') mode.value = 'build';
  /* Over a full-bleed canvas the findings are a popover -- the status card's
     chips open it in Build, the count on the bar in Break, in Split and in
     Lanes alike. */
  if (floating(mode.value, viewport.value)) {
    findingsOpen.value = true;
    return;
  }
  if (mode.value === 'break' && viewport.value !== 'wide') inspectorOpen.value = true;
  scrollFindingsIntoView();
}

/* After the render the mode change above schedules, not before it. */
function scrollFindingsIntoView(): void {
  if (typeof document === 'undefined') return;
  setTimeout(() => {
    const el = document.querySelector('.issues');
    /* jsdom has no layout and no `scrollIntoView`; the reveal is still real
       there, it just has nothing to scroll. */
    if (el instanceof HTMLElement && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, 0);
}

function Row({ f }: { f: Finding }) {
  return (
    <button
      type="button"
      class={`issue sv-${f.severity}`}
      aria-label={`${f.severity}: ${f.message}`}
      onClick={() => {
        if (f.subject.id === undefined) { selection.value = []; } else { selection.value = [f.subject.id]; }
        /* A finding about a configuration property has to open the fold that
           property lives in, or the row lands the reader on a rail the
           property is genuinely absent from. Every severity, not only errors:
           `ConfigForm` opens an errored section by itself, and nothing played
           that part for a warning or a note. Purely additive, so it never
           fights that effect and is a no-op on an open section. */
        const section = sectionOfRule(f.id as string);
        if (section !== null) revealSections([section]);
        revealRail();
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

export interface IssuePanelProps {
  children?: unknown;
  /**
   * Rows only, unfolded, with no heading of its own: the popover that hosts
   * it carries the heading and the counts, and a fold inside a popover is a
   * second door to the same room.
   */
  bare?: boolean;
}

export function IssuePanel({ bare = false }: IssuePanelProps = {}) {
  const list = issues.value;
  const loud = list.filter((f) => f.severity !== 'info');
  const notes = list.filter((f) => f.severity === 'info');
  /* On paper nothing is folded: a printed page has no toggle to press. */
  const open = notesOpen.value || printing.value;
  const unfolded = issuesOpen.value || printing.value;

  const counts = [
    errors.value.length === 0 ? null : `${errors.value.length} error${errors.value.length === 1 ? '' : 's'}`,
    warnings.value.length === 0 ? null : `${warnings.value.length} warning${warnings.value.length === 1 ? '' : 's'}`,
  ].filter((x) => x !== null);

  /* The heading is the fold's handle. The counts stay on it either way, so a
     folded panel still says "2 errors" -- what the fold hides is the rows, not
     the fact of them. `aria-controls` names the list it folds. */
  const summary = counts.length === 0 ? 'No issues' : counts.join(' · ');
  const noteWord = notes.length === 0 ? null : `${notes.length} note${notes.length === 1 ? '' : 's'}`;

  if (bare) {
    return (
      <div class="issues is-bare">
        <div class="issues-body" id="issues-body">
          {loud.length === 0 && notes.length === 0 ? (
            <p class="issues-none">No issues, as modelled here.</p>
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
              {noteWord}
              <span class="notes-hint">Details and sources</span>
            </button>
          )}
          {open
            ? notes.map((f) => (
              <Row key={`${f.id}:${f.subject.kind}:${f.subject.id ?? ''}`} f={f} />
            ))
            : null}
        </div>
      </div>
    );
  }

  /* A healthy configuration is one line. The panel used to open on "No
     errors and no warnings", then "No issues in this configuration" under
     it, then the notes toggle under that -- three rows under the drawing to
     say one thing. With nothing loud, the heading *is* the notes toggle. */
  if (loud.length === 0) {
    return (
      <div class={`issues${open ? '' : ' is-folded'}`}>
        <button
          type="button"
          class="issues-hd"
          aria-expanded={notes.length === 0 ? undefined : open}
          aria-controls={notes.length === 0 ? undefined : 'issues-body'}
          disabled={notes.length === 0}
          title={notes.length === 0 ? undefined : 'The notes: documented behaviour worth knowing'}
          onClick={() => { notesOpen.value = !open; }}
        >
          <span class="notes-caret">{notes.length === 0 ? '' : open ? '▾' : '▸'}</span>
          <span class="eyebrow">Validation</span>
          <span class="caption">
            {`${summary}, as modelled here`}
            {noteWord === null ? '' : ` · ${noteWord}`}
          </span>
        </button>
        {open && notes.length > 0 ? (
          <div class="issues-body" id="issues-body">
            {notes.map((f) => (
              <Row key={`${f.id}:${f.subject.kind}:${f.subject.id ?? ''}`} f={f} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div class={`issues${unfolded ? '' : ' is-folded'}`}>
      <button
        type="button"
        class="issues-hd"
        aria-expanded={unfolded}
        aria-controls="issues-body"
        title={unfolded ? 'Fold the validation panel to its heading' : 'Unfold the validation panel'}
        onClick={toggleIssues}
      >
        <span class="notes-caret">{unfolded ? '▾' : '▸'}</span>
        <span class="eyebrow">Validation</span>
        <span class="caption">
          {summary}
          {!unfolded && noteWord !== null ? ` · ${noteWord}` : ''}
        </span>
      </button>
      {unfolded ? (
        <div class="issues-body" id="issues-body">

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
            {/* One phrase in both states: the caret and `aria-expanded` say
                which way the fold is pointing, and ", folded away" wrapped
                the row to two lines in a 360 px rail to say it a third time. */}
            Details and sources
          </span>
        </button>
      )}

      {open
        ? notes.map((f) => (
          <Row key={`${f.id}:${f.subject.kind}:${f.subject.id ?? ''}`} f={f} />
        ))
        : null}
        </div>
      ) : null}
    </div>
  );
}
