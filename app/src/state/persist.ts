/**
 * Persistence and files (ui.md SS2).
 *
 *   `dg-doc-v1`      the Document, debounced 500 ms
 *   `dg-theme`       light / dark / auto -- same key the published page uses
 *   `dg-palette`     standard / cvd -- this page only; the published page
 *                    has one palette
 *   `dg-ed`          19c / 26ai -- likewise, so a reader who set the release
 *                    on the old page finds it set here
 *   `dg-intro-v1`    set once the reader has been shown the Introduction
 *                    (ui.md SS3e) -- by leaving that page, or by their first
 *                    real gesture if they arrived through a link and never saw
 *                    it. It used to mean "the first-visit strip was dismissed";
 *                    the strip is gone and the page replaced it.
 *   `dg-hints`       whether the sentence under each control is shown
 *   `dg-issues`      whether Build's validation panel is unfolded ('0' = folded)
 *   `dg-tl-h`        the height (px) Break's timeline panel was dragged to
 *   `dg-rail`        whether the side rail is folded to its strip ('1' = folded)
 *   `dg-break-layout` Break's layout, `split` or `lanes` -- anything else reads as split
 *   `dg-fsfo-cfg-v1` the published page's stored configuration. Read once when
 *                    there is nothing newer, and never deleted: the old page
 *                    is still serving from /legacy/ and still owns that key.
 *
 * A restored session announces itself for 8 seconds with a way out ("Start
 * fresh"), because a page that silently reopens yesterday's edit is a page
 * that lies about what it is showing.
 *
 * Every access is wrapped: private-mode Safari throws on `localStorage`, and
 * losing autosave is not a reason to lose the page.
 */

import { effect, signal } from '@preact/signals';
import type { SchemaIssue } from '@/engine';
import type { Doc } from './doc';
import { classicDoc, doc, exportFileName } from './doc';
import { fromWire, parseJsonText, toJsonText } from './codec';
import type { DecodeResult } from './codec';
import {
  BREAK_LAYOUTS, breakLayout, gridOn, hintsOn, inspectorOpen, issuesOpen, railCollapsed, timelineH,
  TL_MIN_H, viewport,
} from './view';
import type { BreakLayout, PalettePref, ThemePref } from './view';

export const DOC_KEY = 'dg-doc-v1';
export const THEME_KEY = 'dg-theme';
export const PALETTE_KEY = 'dg-palette';
export const EDITION_KEY = 'dg-ed';
export const LEGACY_DOC_KEY = 'dg-fsfo-cfg-v1';
export const INTRO_KEY = 'dg-intro-v1';
export const HINTS_KEY = 'dg-hints';
export const GRID_KEY = 'dg-grid';
export const ISSUES_KEY = 'dg-issues';
export const TIMELINE_H_KEY = 'dg-tl-h';
export const RAIL_KEY = 'dg-rail';
export const BREAK_LAYOUT_KEY = 'dg-break-layout';

export const AUTOSAVE_MS = 500;
export const RESTORE_NOTICE_MS = 8000;

/** Set while the "Restored your last configuration" strip is up. */
export const restored = signal<boolean>(false);

const store = (): Storage | null => {
  try {
    /* Every browser and jsdom hang storage off `window`; Node has a global of
       the same name that throws unless the process was started with a backing
       file, so the window's is the one to ask for first. */
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const read = (key: string): string | null => {
  try { return store()?.getItem(key) ?? null; } catch { return null; }
};

const write = (key: string, value: string): void => {
  try { store()?.setItem(key, value); } catch { /* private mode: not fatal */ }
};

/* ---------------- reading preferences ---------------- */

export function loadTheme(): ThemePref | null {
  const v = read(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'auto' ? v : null;
}

export const saveTheme = (v: ThemePref): void => write(THEME_KEY, v);

export function loadPalette(): PalettePref | null {
  const v = read(PALETTE_KEY);
  return v === 'standard' || v === 'cvd' ? v : null;
}

export const savePalette = (v: PalettePref): void => write(PALETTE_KEY, v);

export function loadEdition(): '19c' | '26ai' | null {
  const v = read(EDITION_KEY);
  return v === '19c' || v === '26ai' ? v : null;
}

export const saveEdition = (v: '19c' | '26ai'): void => write(EDITION_KEY, v);

/* ---------------- the intro card ---------------- */

/**
 * Whether the reader has already been shown the Introduction (ui.md SS3e).
 *
 * A signal rather than a read at render time: the page is opened on the first
 * visit and never again on its own, and a component that reached into
 * `localStorage` while rendering would be reading storage on every keystroke.
 * Boot calls `loadIntro()` once; the tests call it to stand in for a reload.
 */
export const introDismissed = signal<boolean>(false);

export function loadIntro(): void {
  introDismissed.value = read(INTRO_KEY) === '1';
}

export function dismissIntro(): void {
  introDismissed.value = true;
  write(INTRO_KEY, '1');
}

/* ---------------- the hints ---------------- */

/**
 * The explanation under each control, on or off -- `hintsOn` in `view.ts`,
 * remembered here.
 *
 * Read once at boot, exactly as the intro card is: a component that asked
 * `localStorage` while it rendered would be asking it on every keystroke, and
 * the answer is a reading preference that changes at most once a session.
 */
export function loadHints(): void {
  hintsOn.value = read(HINTS_KEY) === '1';
}

export function setHints(on: boolean): void {
  hintsOn.value = on;
  write(HINTS_KEY, on ? '1' : '0');
}

export const toggleHints = (): void => setHints(!hintsOn.value);

/* ---------------- the dotted ground ---------------- */

/** The canvas's dots, on or off -- `gridOn` in `view.ts`; unset means on. */
export function loadGrid(): void {
  gridOn.value = read(GRID_KEY) !== '0';
}

export function toggleGrid(): void {
  gridOn.value = !gridOn.value;
  write(GRID_KEY, gridOn.value ? '1' : '0');
}

/* ---------------- Break's layout ---------------- */

/** Split or Lanes -- `breakLayout` in `view.ts`; unset, or anything else, means Split. */
export function loadBreakLayout(): void {
  const v = read(BREAK_LAYOUT_KEY);
  breakLayout.value = (BREAK_LAYOUTS as readonly (string | null)[]).includes(v) ? (v as BreakLayout) : 'split';
}

export function setBreakLayout(v: BreakLayout): void {
  breakLayout.value = v;
  write(BREAK_LAYOUT_KEY, v);
}

/* ---------------- Break's timeline region ---------------- */

/**
 * The height the reader dragged the split to -- `timelineH` in
 * `view.ts`. Read once at boot; anything that is not a whole number of pixels
 * at least `TL_MIN_H` tall reads as "never set".
 */
export function loadTimelineH(): void {
  const raw = read(TIMELINE_H_KEY);
  const n = raw === null ? NaN : Number(raw);
  timelineH.value = Number.isFinite(n) && n >= TL_MIN_H ? Math.round(n) : null;
}

/**
 * Set the height; `remember` is false while a drag is still moving, so a
 * gesture writes storage once, at its end. `null` goes back to the default
 * and forgets the stored value.
 */
export function setTimelineH(h: number | null, remember = true): void {
  timelineH.value = h === null ? null : Math.round(h);
  if (!remember) return;
  if (h === null) {
    try { store()?.removeItem(TIMELINE_H_KEY); } catch { /* private mode */ }
  } else {
    write(TIMELINE_H_KEY, String(Math.round(h)));
  }
}

/* ---------------- the validation panel ---------------- */

/** Folded or not -- `issuesOpen` in `view.ts`, remembered here; unset means open. */
export function loadIssuesOpen(): void {
  issuesOpen.value = read(ISSUES_KEY) !== '0';
}

export function setIssuesOpen(on: boolean): void {
  issuesOpen.value = on;
  write(ISSUES_KEY, on ? '1' : '0');
}

export const toggleIssues = (): void => setIssuesOpen(!issuesOpen.value);

/* ---------------- the side rail ---------------- */

/** Folded or not -- `railCollapsed` in `view.ts`, remembered here; unset means open. */
export function loadRailCollapsed(): void {
  railCollapsed.value = read(RAIL_KEY) === '1';
}

export function setRailCollapsed(shut: boolean): void {
  railCollapsed.value = shut;
  write(RAIL_KEY, shut ? '1' : '0');
}

/**
 * The one `]` does, and the rail's own toggle: fold or unfold the column
 * where the rail is one, open or shut the drawer where it is a drawer.
 */
export function toggleRail(): void {
  if (viewport.value === 'wide') setRailCollapsed(!railCollapsed.value);
  else inspectorOpen.value = !inspectorOpen.value;
}

/**
 * Put the rail in front of the reader, wherever it is: unfold the column on a
 * wide screen, open the drawer below 1280. For the gestures that mean "show me
 * this in the inspector" (Edit, a finding's row, a step of the walkthrough) --
 * a button that selects something behind a folded rail appears to do nothing.
 */
export function revealRail(): void {
  if (viewport.value !== 'wide') { inspectorOpen.value = true; return; }
  if (railCollapsed.value) setRailCollapsed(false);
}

/* ---------------- the Document ---------------- */

/**
 * The last autosave, or the published page's stored configuration when there
 * is no autosave yet. Returns null when there is nothing to restore.
 */
export function loadDoc(): DecodeResult | null {
  const own = read(DOC_KEY);
  if (own !== null) return parseJsonText(own);
  const legacy = read(LEGACY_DOC_KEY);
  if (legacy === null) return null;
  /* The v1 shape goes through the same migration chain a `#cfg=` link takes. */
  const upgraded = parseJsonText(legacy);
  return upgraded.doc ? upgraded : null;
}

export const saveDoc = (d: Doc): void => write(DOC_KEY, toJsonText(d));

export function clearSavedDoc(): void {
  try { store()?.removeItem(DOC_KEY); } catch { /* private mode */ }
}

/** Autosave, debounced. Returns a teardown. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = effect(() => {
    const current = doc.value;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; saveDoc(current); }, AUTOSAVE_MS);
  });
  return () => {
    stop();
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };
}

/** Show the restore strip, then take it down on its own. */
export function announceRestore(): () => void {
  restored.value = true;
  const timer = setTimeout(() => { restored.value = false; }, RESTORE_NOTICE_MS);
  return () => { clearTimeout(timer); restored.value = false; };
}

/** "Start fresh": the classic preset, and the autosave gone with it. */
export function startFresh(edition: '19c' | '26ai' = '19c'): Doc {
  clearSavedDoc();
  restored.value = false;
  return classicDoc(edition);
}

/* ---------------- files ---------------- */

/**
 * Download the Document as `<name>.dgtopo.json`. Verbose JSON on purpose: the
 * file is meant to be read, diffed and pasted into a ticket.
 */
export function exportDoc(d: Doc = doc.value): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([toJsonText(d)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = exportFileName(d);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoking immediately races the download in Safari; one frame is enough. */
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export interface ImportReport extends DecodeResult {
  /** Everything worth telling the reader, already worded. */
  message: string;
}

export async function importFile(file: File): Promise<ImportReport> {
  const text = await file.text();
  return describeImport(parseJsonText(text));
}

/** Import from an object already in memory (drag and drop, paste, tests). */
export const importRaw = (raw: unknown): ImportReport => describeImport(fromWire(raw));

function describeImport(result: DecodeResult): ImportReport {
  if (!result.doc) {
    const first = result.issues.find((i: SchemaIssue) => i.severity === 'error');
    return {
      ...result,
      message: first
        ? `This file is not a topology document: ${first.path === '' ? '' : `${first.path}: `}${first.message}`
        : 'This file is not a topology document.',
    };
  }
  const repaired = result.issues.filter((i) => i.severity === 'repaired').length;
  const parts: string[] = [];
  if (result.source === 'legacy-v1' || result.source === 'legacy-query') {
    parts.push('Upgraded a configuration written by the published page.');
  }
  if (repaired > 0) {
    parts.push(`${repaired} value${repaired === 1 ? ' was' : 's were'} out of range and clamped.`);
  }
  if (result.dropped.length > 0) {
    parts.push(`Dropped ${result.dropped.length} key${result.dropped.length === 1 ? '' : 's'} this page does not know: ${result.dropped.join(', ')}.`);
  }
  return { ...result, message: parts.length === 0 ? 'Imported.' : parts.join(' ') };
}
