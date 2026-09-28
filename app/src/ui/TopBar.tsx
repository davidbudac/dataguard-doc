/**
 * The header (ui.md SS3): brand, the four modes as steps, and — pushed to the
 * right, where nothing competes with the modes — the release, the theme,
 * undo/redo and the ? that brings the "How this page works" card back and,
 * pressed again, takes it away.
 *
 * The mode subtitle that used to sit under the buttons is gone: it said what
 * the guidance line one band below already said, and two lines of chrome for
 * one idea is what pushed the drawing down to 260 px. The sentence itself is
 * not gone — it is each mode button's `title` (`MODE_SUB`), and the mode word
 * now leads the guidance line in.
 *
 * Undo and redo use compact arrows with accessible names: the edit
 * they would reverse rides in the `title`, and a disabled one carries its
 * reason there too. The two chips that used to sit beside them, shouting
 * NOTHING TO UNDO YET at a reader who had not yet done anything, said the same
 * thing three times over and were the loudest text in the bar.
 */

import type { ComponentChildren } from 'preact';
import { canUndo, canRedo, redo, redoLabel, undo, undoLabel } from '@/state/history';
import {
  applyPalette, applyTheme, edition, introOpen, mode, MODE_LABEL, MODE_SUB, MODES, nextTheme, palette, theme,
} from '@/state/view';
import type { Mode, PalettePref, ThemePref } from '@/state/view';
import { saveEdition, savePalette, saveTheme } from '@/state/persist';
import { Segmented } from './common/Segmented';
import { INTRO_HREF, leaveIntro, openIntro } from './intro/route';

const THEME_WORD: Record<ThemePref, string> = { auto: 'system', light: 'light', dark: 'dark' };
const PALETTE_WORD: Record<PalettePref, string> = { standard: 'standard', cvd: 'colour-blind safe' };

export interface TopBarProps {
  children?: unknown;
  /** Beside the brand: which configuration is on screen (StatusBar's picker). */
  doc?: ComponentChildren;
  /** At the right end: what can be done to the configuration as a whole. */
  actions?: ComponentChildren;
}

export function TopBar({ doc, actions }: TopBarProps = {}) {
  const m = mode.value;
  const pref = theme.value;
  const next = nextTheme(pref);
  const pal = palette.value;
  const nextPal: PalettePref = pal === 'standard' ? 'cvd' : 'standard';
  return (
    <header class="topbar app-top">
      <div class="topbar-brand">
        {/* A real `<a href>` and not a button, so it can be middle-clicked,
            bookmarked and copied: `?intro=1` is the page's own address, and
            the click handler only saves the reload. */}
        <a
          class="brand"
          href={INTRO_HREF}
          title="Introduction: what this is, and what to do with it"
          onClick={(e) => { e.preventDefault(); openIntro(); }}
        >
          Data Guard
        </a>
        {doc}
      </div>

      <div class="topbar-modes">
        <Segmented<Mode>
          label="Mode"
          value={m}
          options={MODES.map((x) => ({ value: x, label: MODE_LABEL[x], title: MODE_SUB[x] }))}
          /* A mode button is also the way out of the Introduction, and taking
             it means the reader has seen the page: `dg-intro-v1` is written
             here exactly as "Start building" writes it (intro/route.ts). */
          onChange={(x) => { mode.value = x; leaveIntro(); }}
        />
      </div>

      <div class="topbar-group">
        <Segmented<'19c' | '26ai'>
          label="Oracle release"
          value={edition.value}
          options={[
            { value: '19c', label: '19c', title: 'Oracle Database 19c' },
            { value: '26ai', label: '26ai', title: 'Oracle Database 26ai' },
          ]}
          onChange={(v) => { edition.value = v; saveEdition(v); }}
        />

        <button
          type="button"
          class="btn is-icon"
          aria-label="Undo"
          disabled={!canUndo.value}
          title={undoLabel.value ? `Undo: ${undoLabel.value}` : 'Nothing to undo yet'}
          onClick={() => undo()}
        >
          <span aria-hidden="true">↶</span>
        </button>

        <button
          type="button"
          class="btn is-icon"
          aria-label="Redo"
          disabled={!canRedo.value}
          title={redoLabel.value ? `Redo: ${redoLabel.value}` : 'Nothing undone yet'}
          onClick={() => redo()}
        >
          <span aria-hidden="true">↷</span>
        </button>

        {/* One press flips light and dark; the name says which way it is
            pointing now and which way it will go. */}
        <button
          type="button"
          class="btn is-icon theme-tog"
          aria-label={`Theme: ${THEME_WORD[pref]}. Switch to ${THEME_WORD[next]}`}
          title={`Theme: ${THEME_WORD[pref]} — switch to ${THEME_WORD[next]}`}
          onClick={() => {
            theme.value = next;
            saveTheme(next);
            applyTheme(next);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" class="fill" />
          </svg>
        </button>

        {/* The hue set, beside the theme and independent of it: light or
            dark, either palette. Pressed while the alternative is on. */}
        <button
          type="button"
          class="btn is-icon palette-tog"
          aria-label={`Palette: ${PALETTE_WORD[pal]}. Switch to ${PALETTE_WORD[nextPal]}`}
          aria-pressed={pal !== 'standard'}
          title={`Palette: ${PALETTE_WORD[pal]} — switch to ${PALETTE_WORD[nextPal]}`}
          onClick={() => {
            palette.value = nextPal;
            savePalette(nextPal);
            applyPalette(nextPal);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="5" cy="6" r="2.5" class="pal-a" />
            <circle cx="11" cy="6" r="2.5" class="pal-b" />
            <circle cx="8" cy="11" r="2.5" class="pal-c" />
          </svg>
        </button>

        {/* A toggle, and it says which way it is pointing. Closing the card
            from here writes nothing to `dg-intro-v1`: opening an explanation
            and shutting it again is not the same as having read it, and only
            "Got it" (Guidance.tsx) claims that. */}
        <button
          type="button"
          class="btn is-icon"
          title="How this page works"
          aria-label="How this page works"
          aria-expanded={introOpen.value}
          onClick={() => { introOpen.value = !introOpen.value; }}
        >
          ?
        </button>
        {actions === undefined ? null : <div class="topbar-acts">{actions}</div>}
      </div>

    </header>
  );
}
