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

export type Mode = 'build' | 'scenario' | 'break' | 'configure' | 'learn';

/** The Configure row's tabs, in the order ui.md SS3 lists them. */
export type PanelTab = 'dgmgrl' | 'dests' | 'tns' | 'show' | 'app' | 'commit' | 'reopen';

export const MODES: readonly Mode[] = ['build', 'scenario', 'break', 'configure', 'learn'];
export const PANEL_TABS: readonly PanelTab[] = [
  'dgmgrl', 'dests', 'tns', 'show', 'app', 'commit', 'reopen',
];

/**
 * Which timeline the Outcome draws: `config` is the configuration's lanes (the
 * timeline as it always was), `app` is the application's detail view -- the
 * connect string's retry ladder, the sessions and the outage, the drawing the
 * Config panel's Application view also makes. `app` exists only while the
 * drawing has an application card; without one the configuration timeline is
 * what shows whatever this says (`appTimelineOn` in ui/break/TimelineView.tsx).
 * A reading preference, remembered under `dg-break-timeline` (persist.ts), and
 * not in the address.
 */
export type BreakTimeline = 'config' | 'app';

export const BREAK_TIMELINES: readonly BreakTimeline[] = ['config', 'app'];

export const BREAK_TIMELINE_LABEL: Record<BreakTimeline, string> = { config: 'Configuration', app: 'Application' };

export const BREAK_TIMELINE_SUB: Record<BreakTimeline, string> = {
  config: 'Configuration — the members, links and observer on one clock',
  app: 'Application — what the connect string does while the role moves, and what it costs the application',
};

/**
 * The words on the mode buttons. The ids stay what they were -- `build` is
 * Topology and `break` is the Outcome, as `configure` kept its id when it
 * became Config and then Generated settings (the word "Config" read as a
 * place to change settings, and the mode is the output of them) -- so a
 * class, a test or an old link that says `m-break` or `?mode=build` still
 * means the same mode.
 */
export const MODE_LABEL: Record<Mode, string> = {
  build: 'Topology', scenario: 'Scenario', break: 'Simulate', configure: 'Generated settings', learn: 'Learn',
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
  build: 'Step 1 — draw the topology and set its initial configuration',
  scenario: 'Step 2 — schedule failures, recoveries and planned actions on an event timeline',
  break: 'Step 3 — inspect the response and tune settings to see the outcome change',
  configure:
    'Generated settings — DGMGRL, init parameters and connect strings, generated from the drawing; '
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
/**
 * The reader asked for the inspector: the top bar's Inspector button, `]`, or
 * something that sent them to a property (`revealRail`).
 *
 * Below `wide` it is the drawer's open state. At `wide`, in Build and
 * Configure, it is "the reader opened the inspector on purpose": the rail is
 * not in the document at all until something is selected or this is set
 * (`inspectorRailWanted`), so with nothing selected the rail would only be the
 * configuration's own properties, and the drawing is what the reader came for.
 * Its close button clears both the selection and this.
 */
export const inspectorOpen = signal<boolean>(false);
/** Searchable page commands; transient view state. */
export const commandOpen = signal<boolean>(false);
/** Which timeline the Outcome draws (`BreakTimeline`). Configuration to start with; written by `setBreakTimeline`. */
export const breakTimeline = signal<BreakTimeline>('config');
/**
 * Which application the Application timeline draws when the canvas selection
 * names none: the id the picker chose, else the first application. Not
 * persisted -- the drawing's applications are the document's.
 */
export const breakApp = signal<string | null>(null);
/**
 * Whether the Outcome's run summary -- the band of cards under the
 * bar -- is unfolded. Folded to start with: the bar's terse line is the
 * summary a reader already has, and the band is the same readings at reading
 * size. Only meaningful with a run on screen. Remembered under `dg-summary`
 * (persist.ts), read once at boot like `hintsOn`.
 */
export const summaryOpen = signal<boolean>(false);
/**
 * Whether the rail beside the canvas is folded to its slim strip.
 *
 * Scenario's Events rail can fold to a named strip. The inspectors in
 * Topology, Outcome and Config open on demand; Learn keeps its workbench.
 * Below 1280 the rail is a drawer. A folded rail unmounts its contents and
 * keeps the named strip as the way back. Remembered
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
 * `?intro=1` so it can be linked to and reloaded. Boot opens it only when the
 * address asks for it -- the header's "Data Guard" link is that address; a
 * first visit lands on Topology -- and any mode button leaves it
 * (`ui/intro/route.ts`).
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
/** Whether the docked Outcome/Learn timeline is expanded; persisted as dg-timeline. */
export const timelineOpen = signal<boolean>(true);
/**
 * Whether the Outcome, where it floats, keeps the drawing of the topology
 * above its lanes. On to start with: steps 1 and 2 teach through the drawing,
 * and a step 3 that swapped it for rows of bands reset the reader's picture
 * of what is where. Off, the lanes take the whole stage, as they did.
 * Remembered under `dg-outcome-drawing` (persist.ts).
 */
export const outcomeDrawing = signal<boolean>(true);
/** Requested panel height; null follows the default. */
export const timelineH = signal<number | null>(null);
/** The panel never gets shorter than its header row (readings and chips). */
export const TL_MIN_H = 300;
/** The panel never gets taller than this by default; the grip may take it further. */
export const TL_DEFAULT_MAX_H = 500;
/** One arrow-key step on the resize handle; `Shift` takes four. */
export const TL_STEP = 16;
/**
 * The drawing above the lanes is worth keeping only at a size that reads: a
 * classic 1+1+1 is 388 user units tall, so 260 px is two thirds of it, and
 * under that its 11 px labels are 7 px. Below this the shell does not split
 * (`splitFits`) and the lanes take the stage.
 */
export const DRAWING_MIN_H = 260;
/**
 * The air around the drawing in the floating layout, top and bottom: the
 * 18 px under the header, and under the drawing the dock's margin and the
 * 36 px over it (float.css, `.app.is-float .app-stage>.tp-wrap` padding).
 */
export const DRAWING_AIR = 18 + 14 + 36;
/** The two numbers float.css carries as `- 328px`, so the sheet and this file agree. */
export const TL_RESERVE = DRAWING_MIN_H + DRAWING_AIR;

/**
 * The window's height, kept current by `startViewportWatch`; the shell's
 * vertical budget is read from it (`splitFits`, `timelineDefaultH`).
 */
export const viewportH = signal<number>(900);
/**
 * The measured foot of the header, written by the shell's ResizeObserver
 * (App.tsx `useBarAnchor`) beside the `--bar-bottom` it writes for the
 * stylesheet. 80 until measured: float.css's own fallback.
 */
export const headBottom = signal<number>(80);

/** The room the drawing has above a panel `dockH` tall. */
export const drawingRoom = (viewH: number, head: number, dockH: number): number =>
  viewH - head - dockH - DRAWING_AIR;

/**
 * Whether the window is tall enough to keep the drawing above the lanes at
 * all: with the panel at its smallest, the drawing still gets `DRAWING_MIN_H`.
 * At 800 px with a 132 px header it does (300 px); at 700 px with a 174 px
 * header it does not (158 px), and the lanes take the stage.
 */
export const splitFits = (viewH: number, head: number): boolean =>
  drawingRoom(viewH, head, TL_MIN_H) >= DRAWING_MIN_H;

/**
 * The panel's height before the reader has touched it: whatever the window
 * has beyond the header and a drawing of `DRAWING_MIN_H`, between 300 and
 * 500 px. Mirrored in float.css as
 * `clamp(300px, calc(100dvh - var(--bar-bottom) - 328px), 500px)`.
 */
export function timelineDefaultH(viewH: number, head: number = 80): number {
  return Math.round(Math.min(TL_DEFAULT_MAX_H, Math.max(TL_MIN_H, viewH - head - TL_RESERVE)));
}

/**
 * The tallest the panel may be: it leaves the drawing `DRAWING_MIN_H`. (It
 * used to leave 140 px, which is a 284 x 98 px stamp with 3 px text: a
 * drawing nobody can read is not a drawing worth keeping on the stage.)
 */
export function timelineMaxH(viewH: number, head: number): number {
  return Math.max(TL_MIN_H, Math.round(viewH - head - TL_RESERVE));
}

export function clampTimelineH(h: number, viewH: number, head: number): number {
  return Math.min(timelineMaxH(viewH, head), Math.max(TL_MIN_H, Math.round(h)));
}

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
 * Whether the timeline draws the application's three lanes under the
 * configuration's. On to start with; a moment's view, not remembered.
 */
export const appLanesShown = signal<boolean>(true);
/**
 * Whether the run is the healthy one: the configuration as it stands, with
 * nothing injected, run rather than left as the steady-state reading.
 *
 * Without an event the engine has nothing to say about time, so `trace` is
 * null and every surface reads "steady state" -- no clock, no timeline. The
 * "Everything is working" scenario is a reader asking to see that steady state
 * as a run: the same simulation, over an empty event list, so the timeline,
 * the readout and the explanation all draw from the engine's own answer
 * (outcome `continues`, no data loss) rather than from a copy of it here.
 * A moment's view, not remembered and not in the Document: an event of any
 * kind, a new document, or Clear puts it away.
 */
export const healthyRun = signal<boolean>(false);

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
 * Whether the workbench draws its canvas full-bleed with the chrome floating
 * over it. Build and Break do, while there is room for a canvas beside the
 * panels; Configure and Learn are reading surfaces and keep the docked grid,
 * and so does anything narrower than `medium`.
 */
export function floating(m: Mode, v: Viewport): boolean {
  return (m === 'build' || m === 'scenario' || m === 'break') && (v === 'wide' || v === 'medium');
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

/* ---------------- the inspector rail, on demand ---------------- */

/**
 * Whether the rail in this mode and viewport is the on-demand kind: a column at
 * `wide` that is in the document only while the reader wants it. Build's and
 * Config's inspector is; Break's events and Learn's workbench are the mode
 * itself and stay, and below `wide` the rail is a drawer with its own switch.
 */
export const railOnDemand = (m: Mode, v: Viewport = viewport.value): boolean =>
  v === 'wide' && (m === 'build' || m === 'break' || m === 'configure');

/**
 * Held for a moment after a click on the drawing selects something while
 * nothing was selected, so the rail does not arrive between the two clicks of a
 * double-click.
 *
 * The rail takes its column from the drawing -- the floating layout insets the
 * drawing by the rail's width, the docked grid narrows the stage -- and the
 * drawing is centred in what is left, so the cards move under the pointer the
 * instant the rail appears; the second click of "double-click to rename" then
 * lands on the ground. A press never selects (the card's `click` does, after
 * the pointer has gone up, and a drag that captures the pointer never reaches
 * it), so a single click or a drag is already safe -- this is the one gesture
 * that is not. See `holdRail`.
 */
export const railHeld = signal<boolean>(false);

/** A little longer than the double-click interval of every platform this runs on. */
export const RAIL_HOLD_MS = 450;
let railTimer: ReturnType<typeof setTimeout> | null = null;

export function holdRail(): void {
  if (railTimer !== null) clearTimeout(railTimer);
  railHeld.value = true;
  railTimer = setTimeout(() => { railTimer = null; railHeld.value = false; }, RAIL_HOLD_MS);
}

/** Drop the hold now: for a rail the reader asked for outright, and for tests. */
export function releaseRail(): void {
  if (railTimer !== null) { clearTimeout(railTimer); railTimer = null; }
  railHeld.value = false;
}

/**
 * Whether the on-demand rail is on screen: something is selected (once it has
 * settled, `railHeld`) or the reader opened it (`inspectorOpen`).
 *
 * Read by the shell, the top bar's toggle and `]`; the mode and the viewport
 * are theirs to check (`railOnDemand`).
 */
export const inspectorRailWanted = (): boolean =>
  inspectorOpen.value || (selection.value.length > 0 && !railHeld.value);

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
  const read = (): void => {
    viewport.value = viewportFor(window.innerWidth);
    viewportH.value = window.innerHeight;
  };
  read();
  window.addEventListener('resize', read, { passive: true });
  return () => window.removeEventListener('resize', read);
}

/** Editing needs a wider screen; below `compact` the app is a viewer. */
export const canEdit = (v: Viewport = viewport.value): boolean => v !== 'narrow';

/* ---------------- the guidance line ---------------- */

/**
 * The mode's rail, named for where it actually is, once it is open.
 *
 * It is a column beside the drawing only while the viewport is `wide`
 * (`App.tsx`, `railInGrid`). Below 1280 it is a `Sheet` -- off the right edge
 * at `medium`, up from the bottom at `compact` and `narrow` -- and either way
 * the way in is the status bar's Inspector button. A line that says "the panel
 * on the right" at every width points two of the four viewport classes at the
 * wrong edge, which is the one thing this page's chrome is not allowed to do.
 *
 * This names the rail where something is selected, which is where it is when
 * it is already open -- the action bar's "More in ...". `railOpens` is the one
 * for a line read with nothing selected.
 */
export function railWhere(v: Viewport = viewport.value): string {
  return v === 'wide'
    ? 'the panel on the right'
    : 'the Inspector drawer, from the Inspector button above';
}

/**
 * The same rail, named for a reader who has nothing selected.
 *
 * At `wide` the Build and Configure rail is not on screen until something is
 * selected (`App.tsx`, `railInGrid`), so "the panel on the right" would point at
 * an empty edge: this says what opens it. Below `wide` the drawer was never
 * there to begin with and `railWhere` already names its button.
 *
 * One helper, because two guidance lines name the same rail and they must not
 * drift apart.
 */
export function railOpens(v: Viewport = viewport.value): string {
  return v === 'wide'
    ? 'the panel on the right, which opens when you select something or from the Inspector button above'
    : railWhere(v);
}

/**
 * The guidance line directly under the header: the first gesture, per mode,
 * read after the mode word that leads it in ("Build · Click a card ...").
 * A newcomer's complaint about this page was never that it lacked controls --
 * it was that nothing said which one to touch first.
 *
 * The generated settings' line says what the mode *is* before it says what
 * to do in it: the panels are generated output, not a place to set anything.
 * The settings are in the inspector, which is what the second half points at --
 * wherever the inspector currently is, and however it is opened (`railOpens`).
 */
export function modeGuide(m: Mode, v: Viewport = viewport.value): string {
  switch (m) {
    case 'build':
      return 'Click to edit · drag to move · + to add; '
        + 'Drag a + button onto a data centre to add, or a card’s ⊕ onto another to connect. '
        + `Double-click to rename; ⋯ (or A on a focused card) opens actions, and the full properties are in ${railOpens(v)}. `
        + 'Continue to Scenario to schedule failures and recoveries.';
    case 'scenario':
      return 'Choose a starting scenario, then select a card to schedule an event; drag its marker or enter its time. The drawing shows what has failed by the time in At; the response waits for step 3.';
    case 'break':
      return 'Follow the calculated response; select an item to edit its settings beside the result. Changes rerun the scenario from the beginning.';
    case 'configure':
      return 'DGMGRL, init parameters and connect strings, each produced from the drawing; '
        + `Settings are in ${railOpens(v)}.`;
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
 * sentence end otherwise: the generated settings' line names its own output
 * before it says where the settings are.
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
