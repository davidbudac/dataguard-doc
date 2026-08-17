/**
 * The status bar (ui.md SS3): where the Document came from, what is wrong with
 * it, and the four things you can do to it as a whole.
 *
 * Share is honest about its one limit: past 8000 characters a configuration
 * does not fit in a link, and the answer is the file, not a silently truncated
 * URL.
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

async function share(): Promise<void> {
  busy.value = true;
  try {
    const { url, tooLarge } = await buildShareUrl();
    if (tooLarge) {
      toast.value = { kind: 'warn', text: TOO_LARGE_MESSAGE };
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast.value = { kind: 'info', text: 'Link copied. It carries the whole configuration.' };
    } else {
      toast.value = { kind: 'info', text: url };
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

export interface StatusBarProps {
  /**
   * The shell measures this bar to anchor the toast under it. A ref, not a
   * layout constant: the bar wraps on a narrow window and a toast pinned to
   * the nominal height would paint over it.
   */
  hostRef?: (el: HTMLElement | null) => void;
}

export function StatusBar({ hostRef }: StatusBarProps) {
  const n = issues.value.length;
  const tone = errors.value.length > 0 ? 'is-error' : warnings.value.length > 0 ? 'is-warn' : 'is-clean';
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

      <span class={`count ${tone}`}>
        {n === 0 ? 'No issues' : `${n} issue${n === 1 ? '' : 's'}`}
      </span>

      {restored.value ? (
        <span class="mono">
          Restored your last configuration
          {' '}
          <button
            type="button"
            class="btn"
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

      <button type="button" class="btn" disabled={busy.value} onClick={() => void share()}>
        Share
      </button>
      {shareTooLarge.value || shareHref.value === ''
        ? (
          <WhyPill
            why={{
              state: 'off',
              why: shareTooLarge.value
                ? 'too large for a link -- export instead'
                : 'the link is still being written',
            }}
          />
        )
        : (
          /* A real link, not a button: the address the reader can copy without
             a clipboard permission, and the one this page is at. */
          <a class="btn" id="permalink" rel="bookmark" href={shareHref.value}>Permalink</a>
        )}

      <button type="button" class="btn" onClick={() => exportDoc(doc.value)}>Export</button>

      <label class="btn">
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
        class="btn"
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
