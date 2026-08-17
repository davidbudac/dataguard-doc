/**
 * Validation issues (ui.md SS3, Build mode's bottom row).
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
 */

import { errors, issues, warnings } from '@/state/derived';
import { inspectorOpen, selection, viewport } from '@/state/view';
import { Fact } from './common/Chip';
import '@/styles/inspector.css';

const TONE = { error: 'rd', warning: 'am', info: 'sl' } as const;

export function IssuePanel() {
  const list = issues.value;
  if (list.length === 0) {
    return (
      <div class="issues">
        <div class="empty">
          <span class="empty-k">Validation</span>
          <p>No issues in this configuration, as modelled here.</p>
        </div>
      </div>
    );
  }

  const counts = [
    errors.value.length === 0 ? null : `${errors.value.length} error${errors.value.length === 1 ? '' : 's'}`,
    warnings.value.length === 0 ? null : `${warnings.value.length} warning${warnings.value.length === 1 ? '' : 's'}`,
    list.length - errors.value.length - warnings.value.length === 0
      ? null
      : `${list.length - errors.value.length - warnings.value.length} for information`,
  ].filter((x) => x !== null);

  return (
    <div class="issues">
      <div class="issues-hd">
        <span class="eyebrow">Validation</span>
        <span class="caption">{counts.join(' \u00b7 ')}</span>
      </div>
      {list.map((f) => (
        <button
          type="button"
          key={`${f.id}:${f.subject.kind}:${f.subject.id ?? ''}`}
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
      ))}
    </div>
  );
}
