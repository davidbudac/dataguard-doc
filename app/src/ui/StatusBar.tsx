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
import { classicDoc, doc, makeDoc } from '@/state/doc';
import { edit, resetHistory } from '@/state/history';
import { errors, issues, warnings } from '@/state/derived';
import { exportDoc, importFile, restored, startFresh } from '@/state/persist';
import { buildShareUrl, presetId, shareHref, shareTooLarge } from '@/state/url';
import { PRESETS } from '@/presets';
import { edition, inspectorOpen, mode, toast, viewport } from '@/state/view';
import { TOO_LARGE_MESSAGE } from '@/state/codec';
import { WhyPill } from './common/WhyPill';

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
  const restoredDoc = report.doc;
  resetHistory(restoredDoc);
  presetId.value = null;
  toast.value = { kind: 'info', text: report.message };
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

export interface StatusBarProps {
  /**
   * The shell measures the header to anchor the toast under it. A ref, not a
   * layout constant: the bar wraps on a narrow window and a toast pinned to
   * the nominal height would paint over it.
   */
  hostRef?: (el: HTMLElement | null) => void;
}

export function StatusBar({ hostRef }: StatusBarProps) {
  const errs = errors.value.length;
  const warns = warnings.value.length;
  const notes = issues.value.length - errs - warns;
  const tone = errs > 0 ? 'is-error' : warns > 0 ? 'is-warn' : 'is-clean';
  const link = sharedUrl.value;
  return (
    <div class="statusbar app-status" ref={hostRef}>
      <label class="mono" for="preset-picker">Preset</label>
      <select
        id="preset-picker"
        class="btn"
        value={presetId.value ?? ''}
        onChange={(e) => {
          const id = (e.currentTarget as HTMLSelectElement).value;
          const chosen = PRESETS.find((p) => p.id === id);
          if (!chosen) return;
          /* A preset replaces the whole Document, events included:
             reproducibility is the point, and the events are part of the story
             the preset tells (presets/types.ts). */
          resetHistory(makeDoc(chosen.doc()));
          presetId.value = chosen.id;
        }}
      >
        <option value="">Current configuration</option>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>

      <span class={`count ${tone}`}>{findingCount(errs, warns, notes)}</span>

      {restored.value ? (
        <span class="mono">
          Restored your last configuration
          {' '}
          <button
            type="button"
            class="btn is-quiet"
            onClick={() => { resetHistory(startFresh(edition.value)); presetId.value = 'classic'; }}
          >
            Start fresh
          </button>
        </span>
      ) : null}

      <span class="statusbar-spacer" />

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
        class="btn"
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
        <a class="sharelink mono" id="permalink" rel="bookmark" href={link}>
          Link copied
        </a>
      )}

      <button type="button" class="btn is-quiet" onClick={() => exportDoc(doc.value)}>Export</button>

      <label class="btn is-quiet">
        Import
        <input
          type="file"
          class="sr"
          accept=".json,.dgtopo.json,application/json"
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            void onImport(input.files?.[0] ?? null).finally(() => { input.value = ''; });
          }}
        />
      </label>

      <button
        type="button"
        class="btn is-quiet"
        title="Back to the classic 1+1+1 configuration"
        onClick={() => {
          edit('Reset to the classic configuration', () => classicDoc(edition.value));
          presetId.value = 'classic';
        }}
      >
        Reset
      </button>
    </div>
  );
}
