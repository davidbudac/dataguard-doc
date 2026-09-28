/**
 * The second, quieter header row (ui.md SS3): where the Document came from,
 * what is wrong with it, and the four things you can do to it as a whole.
 *
 * Share is one control, not two. It copies the link and then puts the link
 * itself in the bar for a few seconds — a real anchor, so a reader whose
 * browser refuses the clipboard (an insecure origin, a headless run) still has
 * an address to middle-click. Past 8000 characters a configuration does not
 * fit in a link at all, and the answer is the file, not a truncated URL.
 */

import { signal } from '@preact/signals';
import type { Doc } from '@/state/doc';
import { classicDoc, doc, makeDoc } from '@/state/doc';
import { edit } from '@/state/history';
import { errors, issues, warnings } from '@/state/derived';
import { exportDoc, importFile, restored, startFresh } from '@/state/persist';
import { buildShareUrl, isPristinePreset, presetId, shareHref, shareTooLarge } from '@/state/url';
import type { Preset } from '@/presets';
import { findPreset, GROUPED_PRESETS, PRESETS } from '@/presets';
import { edition, inspectorOpen, mode, toast, viewport } from '@/state/view';
import { TOO_LARGE_MESSAGE } from '@/state/codec';
import { revealFindings } from './IssuePanel';
import { WhyPill } from './common/WhyPill';
import { activeWorkspaceId, replaceWorkingDocument, workspacesOpen } from '@/state/workspaces';
import { openWorkspaces } from './workspaces/Workspaces';
import { exportPng } from './export/diagram';
import { openReport } from './export/Report';

const busy = signal(false);

/** The link the last Share produced, shown in the bar while it is fresh. */
export const sharedUrl = signal<string | null>(null);
export const SHARED_MS = 12000;

let sharedTimer: ReturnType<typeof setTimeout> | null = null;

function showShared(url: string): void {
  sharedUrl.value = url;
  if (sharedTimer !== null) clearTimeout(sharedTimer);
  sharedTimer = setTimeout(() => { sharedTimer = null; sharedUrl.value = null; }, SHARED_MS);
}

export async function share(): Promise<void> {
  busy.value = true;
  try {
    const { url, tooLarge } = await buildShareUrl();
    if (tooLarge) {
      toast.value = { kind: 'warn', text: TOO_LARGE_MESSAGE };
      return;
    }
    /* The link is shown either way; the clipboard is the convenience, not the
       contract. A browser that refuses it leaves the reader an anchor. */
    showShared(url);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }
  } catch {
    toast.value = { kind: 'error', text: 'The link could not be copied. It is in the address bar.' };
  } finally {
    busy.value = false;
  }
}

async function onImport(file: File | null): Promise<void> {
  if (!file) return;
  const report = await importFile(file);
  if (!report.doc) {
    toast.value = { kind: 'error', text: report.message };
    return;
  }
  /* One undoable step, and the draft it replaces is kept (workspaces.ts). A
     recovery copy that could not be written says so itself. */
  if (replaceWorkingDocument('Import configuration', report.doc, null)) {
    toast.value = { kind: 'info', text: report.message };
  }
}

/**
 * "0 issues · 6 notes", never "6 issues".
 *
 * Six INFO rows are six things worth knowing about a healthy configuration,
 * and counting them as issues told the reader their deployment was broken in
 * six ways. Errors and warnings are issues; information is a note.
 */
export function findingCount(errs: number, warns: number, notes: number): string {
  const loud = errs + warns;
  const head = loud === 0 && notes === 0
    ? 'No issues'
    : `${loud} issue${loud === 1 ? '' : 's'}`;
  return notes === 0 ? head : `${head} · ${notes} note${notes === 1 ? '' : 's'}`;
}

/* ---------------- which document is on screen ---------------- */

/**
 * What the picker is looking at: the preset this document *is*, or the preset
 * it started from and has since been changed away from, or neither.
 *
 * `?preset=` says where the document came from and keeps saying it after an
 * edit, which is right for the address bar and wrong for a picker: a reader
 * who has moved a card and changed a transport is no longer looking at the
 * preset the option names. So the picker compares.
 *
 * It compares with `isPristinePreset` (`state/url.ts`) rather than with a
 * comparator of its own, because that is the same question the write path
 * asks about the same document, and two answers to one question is how the
 * picker and the address bar come to disagree. What is left here is the
 * lookup, which is the picker's alone: an id no build of this page knows is
 * not an edited preset, it is no preset at all.
 */
export interface PresetState {
  preset: Preset | null;
  edited: boolean;
}

export function presetState(d: Doc, id: string | null): PresetState {
  const preset = id === null ? null : findPreset(id) ?? null;
  if (preset === null) return { preset: null, edited: false };
  return { preset, edited: !isPristinePreset(d, preset.id) };
}

export interface StatusBarProps {
  /**
   * The shell measures the header to anchor the toast under it. A ref, not a
   * layout constant: the bar wraps on a narrow window and a toast pinned to
   * the nominal height would paint over it.
   */
  hostRef?: (el: HTMLElement | null) => void;
  /**
   * Whether the finding tally rides in this cluster. The floating layout
   * carries it on the status card over the canvas instead (Findings.tsx).
   */
  count?: boolean;
}

/**
 * Which configuration is on screen: the picker, and -- once, after a reload --
 * the note that it was restored, with the way back to a fresh one.
 */
export function DocPicker() {
  const { preset, edited } = presetState(doc.value, presetId.value);
  const showing = preset !== null && !edited;
  return (
    <>
      {/* The word "Preset" is gone from the bar: the picker's first option
          names what is on screen ("1+1+1 with observer", "Current
          configuration (edited)"), the control's own title says what it is,
          and a label that repeats the control beside it is one more word in a
          bar the reader reads sideways. The name stays in the accessibility
          tree, where the control genuinely needs one. */}
      <label class="sr" for="preset-picker">Preset</label>
      <select
        id="preset-picker"
        class="btn doc-picker"
        title="Load one of the eleven configurations this page ships with"
        /* The preset's own option while the document still is that preset;
           the first option, which then says so, once it is not. */
        value={showing ? (preset as Preset).id : ''}
        onChange={(e) => {
          const id = (e.currentTarget as HTMLSelectElement).value;
          const chosen = PRESETS.find((p) => p.id === id);
          if (!chosen) return;
          /* A preset replaces the whole Document, events included:
             reproducibility is the point, and the events are part of the story
             the preset tells (presets/types.ts). One undoable step, and the
             draft it replaces is kept in Saved configurations. */
          replaceWorkingDocument(`Open ${chosen.short}`, makeDoc(chosen.doc()), chosen.id);
        }}
      >
        <option value="">
          {edited ? 'Current configuration (edited)' : 'Current configuration'}
        </option>
        {/* Short titles under headings: eleven sentences in a dropdown is
            eleven lines of prose to read before choosing one. The sentence is
            still there, as the option's title. */}
        {GROUPED_PRESETS.map(({ group, presets }) => (
          <optgroup key={group} label={group}>
            {presets.map((p) => (
              <option key={p.id} value={p.id} title={p.title}>{p.short}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {restored.value ? (
        <span class="doc-restored">
          Restored your last configuration
          {' '}
          <button
            type="button"
            class="btn is-quiet"
            /* Not `classic`: the starting document is the classic 1+1+1
               deployment in its steady state, and the preset of that name
               carries the crash at t = 0 as well. Naming it would make the
               picker say "edited" about a document nobody has edited. */
            onClick={() => { replaceWorkingDocument('Start fresh', startFresh(edition.value), null); }}
          >
            Start fresh
          </button>
        </span>
      ) : null}
    </>
  );
}

/**
 * The tally is the way in, not a label: it takes the reader to the findings
 * it counts, in whichever mode they are (IssuePanel.tsx).
 */
export function DocCount() {
  const errs = errors.value.length;
  const warns = warnings.value.length;
  const notes = issues.value.length - errs - warns;
  const tone = errs > 0 ? 'is-error' : warns > 0 ? 'is-warn' : 'is-clean';
  return (
    <button
      type="button"
      class={`count ${tone}`}
      title={mode.value === 'build' || mode.value === 'break'
        ? 'Show the validation findings'
        : 'Show the validation findings, in Build'}
      onClick={() => { revealFindings(); }}
    >
      {findingCount(errs, warns, notes)}
    </button>
  );
}

/**
 * What can be done to the configuration as a whole: the drawer toggle below
 * `wide`, Share, and -- behind the overflow -- Export, Import and Reset.
 *
 * The overflow is a native `<details>`: a real disclosure with no script of
 * its own, and its three items stay in the document while it is shut, so a
 * keyboard, a test and a screen reader all find the same three buttons.
 */
export function DocActions() {
  const link = sharedUrl.value;
  return (
    <>
      {viewport.value === 'wide' || mode.value === 'learn' ? null : (
        <button
          type="button"
          class="btn"
          aria-expanded={inspectorOpen.value}
          onClick={() => { inspectorOpen.value = !inspectorOpen.value; }}
        >
          {mode.value === 'break' ? 'Events' : 'Inspector'}
        </button>
      )}

      {/* `data-permalink` is the canonical address of what is on screen,
          carried on the control that copies it. It is there before the click
          because a machine -- the smoke check, a scraper, a bookmarklet --
          cannot press a button, and because the address the page is at should
          never be a secret only the clipboard knows. */}
      <button
        type="button"
        class="btn is-solid"
        disabled={busy.value}
        title="Copy a link that carries the whole configuration"
        data-permalink={shareHref.value}
        onClick={() => void share()}
      >
        Share
      </button>
      {shareTooLarge.value ? (
        <WhyPill why={{ state: 'off', why: 'too large for a link -- export instead' }} />
      ) : null}
      {link === null || shareTooLarge.value ? null : (
        /* A real link, not a receipt: the address the reader can copy without
           a clipboard permission, and the one this page is at. */
        <a class="sharelink" id="permalink" rel="bookmark" href={link}>
          Link copied
        </a>
      )}

      <details
        class="ovf"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          const el = e.currentTarget as HTMLDetailsElement;
          if (!el.open) return;
          el.open = false;
          el.querySelector('summary')?.focus();
        }}
        /* A press on one of its items is the end of the errand: shut it. */
        onClick={(e) => {
          const t = e.target as Element;
          if (t.closest('.ovf-menu button') !== null) {
            (e.currentTarget as HTMLDetailsElement).open = false;
          }
        }}
      >
        <summary class="btn is-icon" aria-label="More" title="Saved configurations, export, import, reset">
          <span aria-hidden="true">⋯</span>
        </summary>
        <div class="ovf-menu float-card">
          <button
            type="button"
            class="btn"
            aria-haspopup="dialog"
            aria-expanded={workspacesOpen.value}
            title="Named copies in this browser, and drafts replaced by opening something else"
            onClick={() => openWorkspaces()}
          >
            Saved configurations
          </button>
          <button type="button" class="btn" onClick={() => exportDoc(doc.value)}>Export</button>
          <button
            type="button"
            class="btn"
            title="Save the drawing as a PNG picture, in the current theme"
            onClick={() => { void exportPng(); }}
          >
            Diagram as PNG
          </button>
          <button
            type="button"
            class="btn"
            title="Open the whole configuration as a printable report and save it as PDF"
            onClick={() => { void openReport(); }}
          >
            Report as PDF
          </button>

          <label class="btn">
            Import
            <input
              type="file"
              class="sr"
              accept=".json,.dgtopo.json,application/json"
              onChange={(e) => {
                const input = e.currentTarget as HTMLInputElement;
                void onImport(input.files?.[0] ?? null).finally(() => { input.value = ''; });
                const host = input.closest('details');
                if (host) host.open = false;
              }}
            />
          </label>

          <button
            type="button"
            class="btn"
            title="Back to the classic 1+1+1 configuration"
            onClick={() => {
              edit('Reset to the classic configuration', () => classicDoc(edition.value));
              /* Same reason as Start fresh: this is the classic deployment, not
                 the `classic` preset, which brings its own event. */
              presetId.value = null;
              activeWorkspaceId.value = null;
            }}
          >
            Reset
          </button>
        </div>
      </details>
    </>
  );
}

/**
 * The document's controls in one cluster -- picker, tally, Share and the
 * overflow. The shell splits it across the header (the picker beside the
 * brand, the actions at the right end); this whole form is what a narrow
 * header, and a test, gets.
 */
export function StatusBar({ hostRef, count = true }: StatusBarProps) {
  return (
    <div class="statusbar app-status" ref={hostRef}>
      <DocPicker />
      {count ? <DocCount /> : null}
      <span class="statusbar-spacer" />
      <DocActions />
    </div>
  );
}
