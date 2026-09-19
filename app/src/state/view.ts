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
/**
 * The Introduction, in place of the workbench (ui.md SS3e).
 *
 * A page, not a card: it takes the stage, the rail and the dock, the header
 * stays above it with the modes still clickable, and it is addressable as
 * `?intro=1` so it can be linked to and reloaded. Boot opens it on a first
 * visit -- `dg-intro-v1` unset, and nothing in the address naming something
 * else to look at -- and any mode button leaves it (`ui/intro/route.ts`).
 */
export const introPage = signal<boolean>(false);
/** Validation's INFO rows, collapsed until the reader asks for them. */
export const notesOpen = signal<boolean>(false);
/**
 * Whether Build's validation panel is unfolded past its heading.
 *
 * Open by default -- a configuration with an error in it should show the
 * error -- and remembered under `dg-issues` (persist.ts) once the reader
 * folds it, because a reader who folded it to get the room back for the
 * drawing has said so for the session after this one too. The heading, with
 * its counts, is what stays: the fold hides the rows, never the fact that
 * there are rows.
 */
export const issuesOpen = signal<boolean>(true);
/**
 * Whether the sentence under each control is shown.
 *
 * Off by default: the rail explained every control with a line of prose, and
 * a reader who already knows what LogXptMode is was reading four screens of
 * documentation to reach three sliders. The prose is not deleted and it is not
 * painted out of view -- a hidden hint is not rendered at all, and the `Hints`
 * button in the rail header is the affordance that says it still exists.
 *
 * Remembered in localStorage under `dg-hints` (persist.ts), read once at boot
 * exactly as `dg-intro-v1` is, never during a render.
 */
export const hintsOn = signal<boolean>(false);
/**
 * A field the rail should focus on its next render, then forget.
 *
 * Double-clicking a card on the drawing means "rename it": the rail opens on
 * the member and its name field takes the focus, with the text selected.
 * One-shot, so a later re-render of the same form does not steal focus again.
 */
export const focusField = signal<string | null>(null);
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
      return 'Click a card, a data centre or a link — its actions open on the drawing; '
        + `the full properties are in ${railWhere(v)}, and the + buttons add members.`;
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

/**
 * The guidance line in two halves: the gesture, and the sentence behind it.
 *
 * The first clause is what a reader needs to touch something -- "Click a card,
 * a data centre or a link to edit it." -- and it is always on screen. The rest
 * is explanation and rides with `hintsOn`, the same toggle the rail notes use,
 * so there is one switch for the page's prose rather than two.
 *
 * The cut is made at the first `; ` where there is one, and at the first
 * sentence end otherwise: Configure's line names its own output before it says
 * where the settings are, and splitting it at the em dash would leave
 * "Generated from the drawing." standing for the whole mode.
 */
export function splitGuide(m: Mode, v: Viewport = viewport.value): { lead: string; rest: string } {
  const full = modeGuide(m, v);
  const semi = full.indexOf('; ');
  if (semi !== -1) {
    const tail = full.slice(semi + 2);
    return { lead: `${full.slice(0, semi)}.`, rest: tail.charAt(0).toUpperCase() + tail.slice(1) };
  }
  const stop = full.indexOf('. ');
  if (stop === -1) return { lead: full, rest: '' };
  return { lead: full.slice(0, stop + 1), rest: full.slice(stop + 2) };
}
