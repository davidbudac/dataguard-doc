/**
 * The address bar (ui.md SS2).
 *
 * URL state is a public contract, so this file is the single source of truth
 * for the key vocabulary -- short, hand-assigned keys, decoupled from every
 * identifier in the code, the way the published page's FIELDS table was. Two
 * halves:
 *
 *  - a **pure** table with parse / serialize / default / clamp, which is what
 *    the tests exercise. Values are clamped on read, unknown keys are ignored
 *    and then dropped from the address bar, and nothing from a URL reaches
 *    state unclamped.
 *  - a **write path** behind a one-frame timer plus a 300 ms trailing
 *    debounce. That debounce is mandatory, not polish: WebKit rate-limits
 *    `history.replaceState` to roughly 100 calls per 30 s, and one slider drag
 *    would trip it. `replaceState` only -- undo must never become the Back
 *    button.
 *
 * The Document itself rides the fragment (`#t=`, codec.ts); the query carries
 * only what the reader is looking at.
 */

import { effect, signal } from '@preact/signals';
import type { Edition } from '@/engine';
import { doc } from './doc';
import { encodeDoc } from './codec';
import type { Mode, PanelTab, ThemePref } from './view';
import {
  MODES, PANEL_TABS, edition, lessonId, lessonStep, mode, panelTab, playing, scrubbing,
  selection, theme, tNow,
} from './view';

export interface UrlState {
  ed: Edition;
  mode: Mode;
  panel: PanelTab;
  sel: readonly string[];
  t: number;
  preset: string | null;
  lesson: string | null;
  step: number;
  theme: ThemePref;
}

export const URL_DEFAULTS: UrlState = {
  ed: '19c',
  mode: 'build',
  panel: 'dgmgrl',
  sel: [],
  t: 0,
  preset: null,
  lesson: null,
  step: 0,
  theme: 'auto',
};

/* ---------------- clamps ---------------- */

/** Ids are ours, so the alphabet is ours: anything else is not an id. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SEL_MAX = 20;

/** The axis never runs past 900 s and pre-roll never below -60 s. */
export const clampT = (n: number): number =>
  Math.round(Math.max(-60, Math.min(3600, n)) * 10) / 10;

export const clampStep = (n: number): number => Math.max(0, Math.min(99, Math.round(n)));

/* ---------------- the table ---------------- */

type Mutable = { -readonly [K in keyof UrlState]: UrlState[K] };

export interface UrlField {
  /** The public key. */
  k: string;
  /** What it addresses -- the vocabulary is documented exactly once, here. */
  what: string;
  /** Read one raw value into the state. Garbage is ignored, never guessed at. */
  parse(raw: string, out: Mutable): void;
  /** Serialize, or null when the value is the default and the key can go. */
  write(s: UrlState): string | null;
}

export const URL_FIELDS: readonly UrlField[] = [
  {
    k: 'ed', what: 'edition (19c / 26ai)',
    parse: (raw, out) => { if (raw === '19c' || raw === '26ai') out.ed = raw; },
    write: (s) => (s.ed === URL_DEFAULTS.ed ? null : s.ed),
  },
  {
    k: 'mode', what: 'Build / Break / Configure / Learn',
    parse: (raw, out) => { if ((MODES as readonly string[]).includes(raw)) out.mode = raw as Mode; },
    write: (s) => (s.mode === URL_DEFAULTS.mode ? null : s.mode),
  },
  {
    k: 'panel', what: 'the Configure tab',
    parse: (raw, out) => {
      if ((PANEL_TABS as readonly string[]).includes(raw)) out.panel = raw as PanelTab;
    },
    write: (s) => (s.panel === URL_DEFAULTS.panel ? null : s.panel),
  },
  {
    k: 'sel', what: 'selected members, comma separated',
    parse: (raw, out) => {
      const ids = raw.split(',').map((x) => x.trim()).filter((x) => ID_RE.test(x));
      out.sel = ids.slice(0, SEL_MAX);
    },
    write: (s) => (s.sel.length === 0 ? null : s.sel.join(',')),
  },
  {
    k: 't', what: 'the playhead, in seconds',
    parse: (raw, out) => { const n = Number(raw); if (isFinite(n)) out.t = clampT(n); },
    write: (s) => (s.t === URL_DEFAULTS.t ? null : String(s.t)),
  },
  {
    k: 'preset', what: 'the preset the Document started from',
    parse: (raw, out) => { if (ID_RE.test(raw)) out.preset = raw; },
    write: (s) => s.preset,
  },
  {
    k: 'lesson', what: 'the open lesson',
    parse: (raw, out) => { if (ID_RE.test(raw)) out.lesson = raw; },
    write: (s) => s.lesson,
  },
  {
    k: 'step', what: 'the lesson step',
    parse: (raw, out) => { const n = Number(raw); if (isFinite(n)) out.step = clampStep(n); },
    write: (s) => (s.step === URL_DEFAULTS.step ? null : String(s.step)),
  },
  {
    k: 'theme', what: 'light / dark / auto',
    parse: (raw, out) => {
      if (raw === 'light' || raw === 'dark' || raw === 'auto') out.theme = raw;
    },
    write: (s) => (s.theme === URL_DEFAULTS.theme ? null : s.theme),
  },
];

const FIELD_BY_KEY = new Map(URL_FIELDS.map((f) => [f.k, f]));

export interface ParsedQuery {
  state: UrlState;
  /** Keys this application does not know. They are ignored, then dropped. */
  unknown: string[];
}

/** Split a query string without touching a host global. */
export function splitQuery(query: string): [string, string][] {
  const q = query.startsWith('?') ? query.slice(1) : query;
  const out: [string, string][] = [];
  for (const part of q.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const key = decodeSafe(eq < 0 ? part : part.slice(0, eq));
    const val = eq < 0 ? '' : decodeSafe(part.slice(eq + 1).replace(/\+/g, ' '));
    if (key !== '') out.push([key, val]);
  }
  return out;
}

const decodeSafe = (s: string): string => {
  try { return decodeURIComponent(s); } catch { return s; }
};

export function parseUrlQuery(query: string, base: UrlState = URL_DEFAULTS): ParsedQuery {
  const state: Mutable = { ...base, sel: [...base.sel] };
  const unknown: string[] = [];
  for (const [key, raw] of splitQuery(query)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) { unknown.push(key); continue; }
    field.parse(raw, state);
  }
  return { state, unknown };
}

/** Non-default keys only, in table order, so a link is stable and diffable. */
export function serializeUrlQuery(state: UrlState): string {
  const parts: string[] = [];
  for (const field of URL_FIELDS) {
    const v = field.write(state);
    if (v === null || v === '') continue;
    parts.push(`${field.k}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

/* ---------------- binding to the signals ---------------- */

/** The preset a Document came from, when it came from one. View state, not Doc. */
export const presetId = signal<string | null>(null);

/** True when the Document no longer fits in a link; the Share button says so. */
export const shareTooLarge = signal<boolean>(false);

/**
 * The canonical address as a relative href -- `?query#t=...` -- kept in step
 * with the address bar by the flush below.
 *
 * The status bar renders it as a real anchor. Copying the link must not depend
 * on `navigator.clipboard`, which is absent on an insecure origin and in a
 * headless browser, and "panels are real links" (ui.md SS3) applies to the
 * share link most of all: a permalink you can middle-click, bookmark and
 * right-click-copy is the one that always works. Empty until the first flush.
 */
export const shareHref = signal<string>('');

export function currentUrlState(): UrlState {
  return {
    ed: edition.value,
    mode: mode.value,
    panel: panelTab.value,
    sel: selection.value,
    /* The playhead is deliberately absent while it is moving: one drag would
       otherwise be a hundred history writes. */
    t: playing.value || scrubbing.value ? URL_DEFAULTS.t : clampT(tNow.value),
    preset: presetId.value,
    lesson: lessonId.value,
    step: lessonStep.value,
    theme: theme.value,
  };
}

export function applyUrlState(s: UrlState): void {
  edition.value = s.ed;
  mode.value = s.mode;
  panelTab.value = s.panel;
  selection.value = [...s.sel];
  tNow.value = s.t;
  presetId.value = s.preset;
  lessonId.value = s.lesson;
  lessonStep.value = s.step;
  theme.value = s.theme;
}

/* ---------------- the write path ---------------- */

let rafHandle = 0;
let timerHandle: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

/** Build the canonical URL for the state as it stands. */
export async function buildShareUrl(): Promise<{ url: string; tooLarge: boolean }> {
  const query = serializeUrlQuery(currentUrlState());
  const encoded = await encodeDoc(doc.value);
  const base = typeof location === 'undefined' ? '' : location.origin + location.pathname;
  const url = `${base}${query ? `?${query}` : ''}${encoded.tooLarge ? '' : `#${encoded.fragment}`}`;
  return { url, tooLarge: encoded.tooLarge };
}

async function flush(): Promise<void> {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const mine = ++generation;
  const query = serializeUrlQuery(currentUrlState());
  const encoded = await encodeDoc(doc.value);
  /* A newer flush started while this one was compressing: that one wins. */
  if (mine !== generation) return;
  shareTooLarge.value = encoded.tooLarge;
  const tail = (query ? `?${query}` : '') + (encoded.tooLarge ? '' : `#${encoded.fragment}`);
  /* The permalink is published even when the address bar needs no rewrite --
     it is a reading of the state, not a record of the last write. */
  shareHref.value = tail === '' ? '.' : tail;
  const next = location.pathname + tail;
  if (next === location.pathname + location.search + location.hash) return;
  history.replaceState(null, '', next);
}

function schedule(): void {
  if (typeof window === 'undefined') return;
  if (rafHandle !== 0) return;
  /* A one-frame collapse of synchronous bursts, then the 300 ms trailing
     debounce (WebKit rate-limits replaceState to about 100 calls per 30 s).
     Deliberately a timer and not requestAnimationFrame: rAF stops firing in a
     background tab and never fires in a headless dump, and the permalink is a
     reading of the state that must exist in both -- a share link that only
     appears once the tab is painted is a link the smoke test cannot see. */
  rafHandle = setTimeout(() => {
    rafHandle = 0;
    if (timerHandle !== null) clearTimeout(timerHandle);
    timerHandle = setTimeout(() => { timerHandle = null; void flush(); }, 300);
  }, 16) as unknown as number;
}

/**
 * Start mirroring state into the address bar. Call this AFTER the first
 * render, so boot never writes back what it just read.
 */
export function startUrlSync(): () => void {
  const stop = effect(() => {
    /* Touch every signal the URL carries so the effect subscribes to them. */
    currentUrlState();
    doc.value;
    schedule();
  });
  return () => {
    stop();
    if (timerHandle !== null) { clearTimeout(timerHandle); timerHandle = null; }
    if (rafHandle !== 0) { clearTimeout(rafHandle as unknown as ReturnType<typeof setTimeout>); rafHandle = 0; }
  };
}
