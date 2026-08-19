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
 * only what the reader is looking at -- with one shorthand: while the Document
 * is still, value for value, the preset it was opened from, `?preset=<id>` is
 * already a complete address for it and the fragment is not written at all.
 * See `isPristinePreset` below.
 */

import { effect, signal } from '@preact/signals';
import type { Edition } from '@/engine';
import { findPreset } from '@/presets';
import { doc, makeDoc } from './doc';
import type { Doc } from './doc';
import { encodeDoc, toWire } from './codec';
import type { Mode, PanelTab, ThemePref } from './view';
import {
  MODES, PANEL_TABS, edition, introPage, lessonId, lessonStep, mode, panelTab, playing,
  scrubbing, selection, theme, tNow,
} from './view';

export interface UrlState {
  ed: Edition;
  mode: Mode;
  /** The Introduction, instead of the workbench. */
  intro: boolean;
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
  intro: false,
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
    /* A page rather than a mode: the workbench is still behind it, with the
       mode buttons live in the header, so this is a key of its own instead of
       a fifth value of `mode`. `1` and nothing else -- an address that means
       "show the Introduction" has exactly one spelling. */
    k: 'intro', what: 'the Introduction page',
    parse: (raw, out) => { if (raw === '1') out.intro = true; },
    write: (s) => (s.intro ? '1' : null),
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
    intro: introPage.value,
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
  introPage.value = s.intro;
  panelTab.value = s.panel;
  selection.value = [...s.sel];
  tNow.value = s.t;
  presetId.value = s.preset;
  lessonId.value = s.lesson;
  lessonStep.value = s.step;
  theme.value = s.theme;
}

/* ---------------- when a preset is already the whole address ---------------- */

/**
 * `JSON.stringify` with the object keys sorted, all the way down.
 *
 * The comparison below is between two Documents that mean the same thing but
 * were not built the same way -- one straight from `preset.doc()`, one carried
 * here through the codec, the migration chain or a dozen `{ ...d, x }` spreads
 * -- and plain `JSON.stringify` would call those different because a key came
 * back in another order. Arrays keep their order, because in a Document order
 * *is* meaning: members, links and events are sequences, not sets.
 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const src = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(src).sort()) {
    const v = src[key];
    /* What `JSON.stringify` itself drops from an object. */
    if (v === undefined || typeof v === 'function') continue;
    parts.push(`${JSON.stringify(key)}:${stableJson(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * One fingerprint per Document *object*, so asking the question is cheap.
 *
 * Two callers ask it -- the write path below, on every flush, and the preset
 * picker (`ui/StatusBar.tsx`), on every render of the status bar -- and
 * serializing the whole configuration for each of them is work nobody asked
 * for. Keyed on identity, which is sound here because a `Doc` is immutable:
 * every edit produces a new object, so a hit is a document that has not
 * changed. A `WeakMap`, so an undone snapshot is not kept alive by its
 * fingerprint.
 */
const docWire = new WeakMap<Doc, string>();

function docFingerprint(d: Doc): string {
  const hit = docWire.get(d);
  if (hit !== undefined) return hit;
  const wire = stableJson(toWire(d));
  docWire.set(d, wire);
  return wire;
}

/** One fingerprint per preset, built once: `preset.doc()` is a fresh object every call. */
const presetWire = new Map<string, string | null>();

function presetFingerprint(id: string): string | null {
  const cached = presetWire.get(id);
  if (cached !== undefined) return cached;
  const p = findPreset(id);
  /* Exactly what boot builds from `?preset=<id>` -- the comparison is only
     worth anything if the two sides are the same construction. */
  const wire = p ? stableJson(toWire(makeDoc(p.doc()))) : null;
  presetWire.set(id, wire);
  return wire;
}

/**
 * True when the Document is still, value for value, the preset it names.
 *
 * `?preset=classic` loads the whole preset -- events, parameters and all -- so
 * while nothing has been changed it is already a complete address, and a
 * 700-character `#t=` beside it says the same thing twice. The moment anything
 * differs, and a layout drag, an injected event or a parameter *is* a
 * difference because all three live in the Document, the fragment comes back:
 * it is the only thing that can carry an edit.
 *
 * Compared by value, not by a dirty flag, so undoing back to the preset drops
 * the fragment again. A document that came back through a link or a file has
 * been round-tripped by the codec, and the codec does not promise the key
 * order the preset factory happened to write -- which is what `stableJson`
 * above is for. Without it a shared preset would read as edited the moment it
 * was reopened.
 *
 * **The only comparator.** The preset picker asks the same question of the
 * same document ("is this still the preset it names?"), and it asks it here:
 * a second implementation beside this one is how the address bar and the
 * picker come to disagree about one document.
 */
export function isPristinePreset(d: Doc, id: string | null): boolean {
  if (id === null) return false;
  const wire = presetFingerprint(id);
  return wire !== null && wire === docFingerprint(d);
}

/* ---------------- the write path ---------------- */

let rafHandle = 0;
let timerHandle: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

/**
 * The `?query#fragment` half of the canonical address, for the state as it
 * stands. The one place that decides whether the fragment is written, so the
 * address bar and the Share button can never disagree about it.
 */
async function canonicalTail(): Promise<{ tail: string; tooLarge: boolean }> {
  const state = currentUrlState();
  const query = serializeUrlQuery(state);
  const head = query ? `?${query}` : '';
  /* An untouched preset needs no fragment: `?preset=` already loads it, and a
     link that carries the configuration twice is a link nobody can read. */
  if (isPristinePreset(doc.value, state.preset)) return { tail: head, tooLarge: false };
  const encoded = await encodeDoc(doc.value);
  return { tail: head + (encoded.tooLarge ? '' : `#${encoded.fragment}`), tooLarge: encoded.tooLarge };
}

/** Build the canonical URL for the state as it stands. */
export async function buildShareUrl(): Promise<{ url: string; tooLarge: boolean }> {
  const { tail, tooLarge } = await canonicalTail();
  const base = typeof location === 'undefined' ? '' : location.origin + location.pathname;
  return { url: `${base}${tail}`, tooLarge };
}

async function flush(): Promise<void> {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const mine = ++generation;
  const { tail, tooLarge } = await canonicalTail();
  /* A newer flush started while this one was compressing: that one wins. */
  if (mine !== generation) return;
  shareTooLarge.value = tooLarge;
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
