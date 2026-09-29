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
  break: 'Break — add failures and follow the simulation timeline',
  configure:
    'Configure — generated from the drawing: DGMGRL, init parameters and connect strings; '
    + 'hover a line to see which member it configures.',
  learn: 'Learn — ten guided lessons and the reference tables behind them',
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

/** The hue set, orthogonal to light and dark. 'cvd' is colour-blind safe. */
export type PalettePref = 'standard' | 'cvd';

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
export const palette = signal<PalettePref>('standard');
export const edition = signal<Edition>('19c');
export const inspectorOpen = signal<boolean>(false);
/**
 * Whether the rail beside the canvas is folded to its slim strip.
 *
 * Only where the rail is a column (`wide`, and not in Learn, whose right half
 * is the workbench itself): below 1280 the rail is a drawer, which is already
 * shut until asked for. Folded, the rail's contents are not rendered -- the
 * strip that stays is the way back, and says what is behind it. Remembered
 * under `dg-rail` (persist.ts) and read once at boot, like `hintsOn`.
 */
export const railCollapsed = signal<boolean>(false);
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
/**
 * The printable report, in place of the whole shell (ui/export/Report.tsx).
 * Addressable as `?report=1`, so a report can be reloaded, linked to and
 * printed by a headless browser without a click.
 */
export const reportPage = signal<boolean>(false);
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
 * Whether the floating canvas shows its dotted ground. On by default; the
 * dots button on the zoom pill turns it off, remembered under `dg-grid`
 * (persist.ts) and read once at boot like `hintsOn`.
 */
export const gridOn = signal<boolean>(true);
/**
 * The height of Break's floating timeline panel, in CSS pixels, as the reader
 * dragged it by its top edge -- or null for the default (`timelineDefaultH`).
 * Remembered under `dg-tl-h` (persist.ts), read once at boot like `hintsOn`.
 * It is a wish, not a measurement: the panel is clamped to the window it is
 * shown in (`clampTimelineH`), so a height chosen on a tall screen does not
 * push the top bar off a short one.
 */
export const timelineH = signal<number | null>(null);
/**
 * Whether Break's timeline fills the window below the top bar. A moment's
 * view, not a preference: not remembered, and Escape leaves it.
 */
export const timelineFull = signal<boolean>(false);
/**
 * Whether Break's timeline draws the application's three lanes under the
 * configuration's. On to start with; a moment's view, not remembered.
 */
export const appLanesShown = signal<boolean>(true);

/** The panel never gets shorter than its header row (readings and chips). */
export const TL_MIN_H = 64;
/** One arrow-key step on the resize handle; `Shift` takes four. */
export const TL_STEP = 16;
/* The gaps the floating layout keeps: the card margin at the window's foot
   and the room under the header. Same numbers as float.css's `--float-m` and
   the `+ 12px` under `--bar-bottom`. */
const TL_FOOT = 14;
const TL_HEAD_GAP = 12;

/**
 * The panel's height before the reader has touched it: a bit over a third of
 * the window, so the drawing keeps the larger share. Mirrored in float.css as
 * `clamp(220px, 36dvh, 400px)`.
 */
export function timelineDefaultH(viewH: number): number {
  return Math.round(Math.min(400, Math.max(220, viewH * 0.36)));
}

/** The tallest the panel may be: it stops short of the header's foot. */
export function timelineMaxH(viewH: number, headBottom: number): number {
  return Math.max(TL_MIN_H, Math.round(viewH - TL_FOOT - headBottom - TL_HEAD_GAP));
}

export function clampTimelineH(h: number, viewH: number, headBottom: number): number {
  return Math.min(timelineMaxH(viewH, headBottom), Math.max(TL_MIN_H, Math.round(h)));
}
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
/**
 * Whether the validation details are open over the canvas.
 *
 * In the floating layout the findings are a pair of chips on the status card,
 * and the rows themselves are a popover the chips open -- not a block that is
 * always there under the drawing. View state: not remembered, not undoable.
 */
export const findingsOpen = signal<boolean>(false);
/**
 * The finding the reader waved away from the small warning card above the
 * status bar, by its key. A different finding brings the card back.
 */
export const findingWaved = signal<string | null>(null);

/**
 * Whether the workbench draws its canvas full-bleed with the chrome floating
 * over it. Build and Break do, while there is room for a canvas beside the
 * panels; Configure and Learn are reading surfaces and keep the docked grid,
 * and so does anything narrower than `medium`.
 */
export function floating(m: Mode, v: Viewport): boolean {
  return (m === 'build' || m === 'break') && (v === 'wide' || v === 'medium');
}

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

/**
 * The palette is a second attribute beside [data-theme]: tokens.css redefines
 * only the hues under [data-palette="cvd"], for both schemes, so it composes
 * with whichever theme is in force. 'standard' removes the attribute.
 */
export function applyPalette(pref: PalettePref = palette.value): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'standard') root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', pref);
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
      return 'Click to edit · drag to move · + to add; '
        + 'Drag a + button onto a data centre to add, or a card’s ⊕ onto another to connect. '
        + `Double-click to rename; ⋯ opens actions, and the full properties are in ${railWhere(v)}.`;
    case 'break':
      return 'Click a card to add an event, drag a numbered timeline marker to change its time; '
        + 'Earlier / Later in Events swaps adjacent times, or pick a scenario.';
    case 'configure':
      return 'Generated from the drawing — DGMGRL, init parameters, connect strings. '
        + `Settings are in ${railWhere(v)}.`;
    case 'learn':
      return 'Choose a lesson, then press Show me to set the workbench up for a step.';
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
