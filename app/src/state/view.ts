/**
 * The View -- what a reload may forget (ui.md SS2).
 *
 * Nothing here belongs in undo, and nothing here changes what the engine
 * computes, with two exceptions that are reading preferences rather than
 * document state: the edition (19c / 26ai), which gates a handful of
 * documented rules, and the theme. Both are remembered in localStorage and
 * both are addressable in the query string.
 */

import { signal } from '@preact/signals';
import type { Edition } from '@/engine';

export type Mode = 'build' | 'break' | 'configure' | 'learn';

/** The Configure row's tabs, in the order ui.md SS3 lists them. */
export type PanelTab = 'dgmgrl' | 'dests' | 'tns' | 'show' | 'app' | 'commit' | 'reopen';

export const MODES: readonly Mode[] = ['build', 'break', 'configure', 'learn'];
export const PANEL_TABS: readonly PanelTab[] = [
  'dgmgrl', 'dests', 'tns', 'show', 'app', 'commit', 'reopen',
];

export const MODE_LABEL: Record<Mode, string> = {
  build: 'Build', break: 'Break', configure: 'Configure', learn: 'Learn',
};

/**
 * What each mode is for, in one sentence -- the `title` of its button in the
 * header.
 *
 * It used to be printed under the mode buttons as well, one line above a
 * guidance line that said nearly the same thing ("Build — draw the
 * configuration" over "Click a card ... to edit it"). Two lines of chrome for
 * one idea: the sentence stayed, as the tooltip, and the mode word became the
 * lead-in of the guidance line instead (`modeGuide`, and `Guidance.tsx`).
 *
 * A `title` is one string for every viewport, so nothing here may name a screen
 * edge: where the inspector is depends on how much fits, and that sentence
 * belongs to `modeGuide`, which knows.
 */
export const MODE_SUB: Record<Mode, string> = {
  build: 'Build — draw the configuration: sites, members, redo routes, observers',
  break: 'Break — inject failures and watch the clocks run',
  configure:
    'Configure — generated from the drawing: DGMGRL, init parameters and connect strings; '
    + 'hover a line to see which member it configures.',
  learn: 'Learn — nine lessons, and the reference tables behind them',
};

export const PANEL_LABEL: Record<PanelTab, string> = {
  dgmgrl: 'DGMGRL',
  dests: 'LOG_ARCHIVE_DEST_n',
  tns: 'tnsnames / JDBC',
  show: 'SHOW',
  app: 'Application view',
  commit: 'Commit',
  reopen: 'Reopen',
};

/** 'auto' follows the host; the two explicit values stamp [data-theme]. */
export type ThemePref = 'auto' | 'light' | 'dark';

/**
 * How much of the shell fits. Measured in JS rather than keyed in CSS alone,
 * because below 1280 the inspector genuinely leaves the grid (it becomes a
 * drawer) and below 768 editing is genuinely gone -- and this page never hides
 * anything with a media query it has not also removed from the document.
 */
export type Viewport = 'wide' | 'medium' | 'compact' | 'narrow';

export interface Toast {
  kind: 'info' | 'warn' | 'error';
  text: string;
  /** An optional in-place undo of whatever just happened. */
  action?: { label: string; run: () => void };
  /**
   * A real link, when the honest answer is somewhere else -- a `?lang=cs` deep
   * link into the Czech reading, which lives on the published page. A link,
   * not a button: it survives a middle click and it can be copied.
   */
  link?: { label: string; href: string };
}

export const mode = signal<Mode>('build');
export const selection = signal<readonly string[]>([]);
export const hovered = signal<string | null>(null);
export const tNow = signal<number>(0);
export const playing = signal<boolean>(false);
export const scrubbing = signal<boolean>(false);
export const speed = signal<number>(1);
export const panelTab = signal<PanelTab>('dgmgrl');
export const lessonId = signal<string | null>(null);
export const lessonStep = signal<number>(0);
export const proseOpen = signal<boolean>(false);
export const theme = signal<ThemePref>('auto');
export const edition = signal<Edition>('19c');
export const inspectorOpen = signal<boolean>(false);
/** The "How this page works" card, opened again from the header's ? button. */
export const introOpen = signal<boolean>(false);
/** Validation's INFO rows, collapsed until the reader asks for them. */
export const notesOpen = signal<boolean>(false);
export const toast = signal<Toast | null>(null);
export const viewport = signal<Viewport>('wide');

/* ---------------- selection helpers ---------------- */

export const isSelected = (id: string): boolean => selection.value.includes(id);

export function select(id: string, additive = false): void {
  if (!additive) { selection.value = [id]; return; }
  selection.value = selection.value.includes(id)
    ? selection.value.filter((s) => s !== id)
    : [...selection.value, id];
}

export const clearSelection = (): void => { selection.value = []; };

/* ---------------- theme ---------------- */

/**
 * The palette is redefined under `@media (prefers-color-scheme: dark)` AND
 * under `:root[data-theme=...]`, so writing the attribute is the whole of the
 * toggle: 'auto' removes it and the media query takes over again.
 */
export function applyTheme(pref: ThemePref = theme.value): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

/** What the toggle would move to, given the host preference. */
export function nextTheme(pref: ThemePref): ThemePref {
  if (pref === 'auto') return prefersDark() ? 'light' : 'dark';
  return pref === 'dark' ? 'light' : 'dark';
}

export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/* ---------------- viewport ---------------- */

export function viewportFor(width: number): Viewport {
  if (width >= 1280) return 'wide';
  if (width >= 1024) return 'medium';
  if (width >= 768) return 'compact';
  return 'narrow';
}

/** Keeps `viewport` current. Returns a teardown, for tests and for hot reload. */
export function startViewportWatch(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const read = (): void => { viewport.value = viewportFor(window.innerWidth); };
  read();
  window.addEventListener('resize', read, { passive: true });
  return () => window.removeEventListener('resize', read);
}

/** Editing needs a wider screen; below `compact` the app is a viewer. */
export const canEdit = (v: Viewport = viewport.value): boolean => v !== 'narrow';

/* ---------------- the guidance line ---------------- */

/**
 * The mode's rail, named for where it actually is.
 *
 * It is a column beside the drawing only while the viewport is `wide`
 * (`App.tsx`, `railInGrid`). Below 1280 it is a `Sheet` -- off the right edge
 * at `medium`, up from the bottom at `compact` and `narrow` -- and either way
 * the way in is the status bar's Inspector button. A line that says "the panel
 * on the right" at every width points two of the four viewport classes at the
 * wrong edge, which is the one thing this page's chrome is not allowed to do.
 *
 * One helper, because two guidance lines name the same rail and they must not
 * drift apart.
 */
export function railWhere(v: Viewport = viewport.value): string {
  return v === 'wide'
    ? 'the panel on the right'
    : 'the Inspector drawer, from the Inspector button above';
}

/**
 * The guidance line directly under the header: the first gesture, per mode,
 * read after the mode word that leads it in ("Build · Click a card ...").
 * A newcomer's complaint about this page was never that it lacked controls --
 * it was that nothing said which one to touch first.
 *
 * Configure's line says what the mode *is* before it says what to do in it:
 * the word reads as "settings", and the panels are generated output. The
 * settings are in the inspector, which is what the second half points at --
 * wherever the inspector currently is (`railWhere`).
 */
export function modeGuide(m: Mode, v: Viewport = viewport.value): string {
  switch (m) {
    case 'build':
      return 'Click a card, a data centre or a link to edit it; add members with the + '
        + `buttons on the drawing and at the top of ${railWhere(v)}.`;
    case 'break':
      return 'Click a host to crash it or a link to cut it, or pick a scenario in the panel; '
        + 'the timeline below runs the clocks.';
    case 'configure':
      return 'Generated from the drawing — DGMGRL, init parameters, connect strings. '
        + `Settings are in ${railWhere(v)}.`;
    case 'learn':
      return 'Each step sets up the workbench beside it.';
  }
}
