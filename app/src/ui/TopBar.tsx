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
 * Undo and redo are small buttons that say only "Undo" and "Redo": the edit
 * they would reverse rides in the `title`, and a disabled one carries its
 * reason there too. The two chips that used to sit beside them, shouting
 * NOTHING TO UNDO YET at a reader who had not yet done anything, said the same
 * thing three times over and were the loudest text in the bar.
 */

import { canUndo, canRedo, redo, redoLabel, undo, undoLabel } from '@/state/history';
import { edition, introOpen, mode, MODE_LABEL, MODE_SUB, MODES, theme } from '@/state/view';
import type { Mode, ThemePref } from '@/state/view';
import { saveEdition, saveTheme } from '@/state/persist';
import { applyTheme } from '@/state/view';
import { Segmented } from './common/Segmented';
import { INTRO_HREF, leaveIntro, openIntro } from './intro/route';

export function TopBar() {
  const m = mode.value;
  return (
    <header class="topbar app-top">
      <div class="topbar-brand">
        <b>Data Guard topology</b>
        {/* A real `<a href>` and not a button, so it can be middle-clicked,
            bookmarked and copied: `?intro=1` is the page's own address, and
            the click handler only saves the reload. */}
        <span>
          simulator
          {' · '}
          <a
            href={INTRO_HREF}
            title="What this is, and what to do with it"
            onClick={(e) => { e.preventDefault(); openIntro(); }}
          >
            Introduction
          </a>
        </span>
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

      <div class="topbar-spacer" />

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

        <Segmented<ThemePref>
          label="Theme"
          value={theme.value}
          options={[
            { value: 'auto', label: 'Auto', title: 'Follow the system setting' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) => { theme.value = v; saveTheme(v); applyTheme(v); }}
        />

        <button
          type="button"
          class="btn is-quiet"
          disabled={!canUndo.value}
          title={undoLabel.value ? `Undo: ${undoLabel.value}` : 'Nothing to undo yet'}
          onClick={() => undo()}
        >
          Undo
        </button>

        <button
          type="button"
          class="btn is-quiet"
          disabled={!canRedo.value}
          title={redoLabel.value ? `Redo: ${redoLabel.value}` : 'Nothing undone yet'}
          onClick={() => redo()}
        >
          Redo
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
      </div>
    </header>
  );
}
