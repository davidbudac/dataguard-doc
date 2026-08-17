/**
 * The header (ui.md SS3): brand, the four modes as steps with one line saying
 * what the active one is for, and — pushed to the right, where nothing
 * competes with the modes — the release, the theme, undo/redo and the ? that
 * brings the "How this page works" card back.
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

const MODE_TITLE: Record<Mode, string> = {
  build: 'Draw the configuration: sites, members, redo routes, observers',
  break: 'Inject failures and watch the clocks run',
  configure: 'The same deployment as DGMGRL commands, init parameters and connect strings',
  learn: 'Nine lessons, and the reference tables behind them',
};

export function TopBar() {
  const m = mode.value;
  return (
    <header class="topbar app-top">
      <div class="topbar-brand">
        <b>Data Guard topology</b>
        <span>simulator</span>
      </div>

      <div class="topbar-modes">
        <Segmented<Mode>
          label="Mode"
          value={m}
          options={MODES.map((x) => ({ value: x, label: MODE_LABEL[x], title: MODE_TITLE[x] }))}
          onChange={(x) => { mode.value = x; }}
        />
        <p class="topbar-sub">{MODE_SUB[m]}</p>
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

        <button
          type="button"
          class="btn is-icon"
          title="How this page works"
          aria-label="How this page works"
          onClick={() => { introOpen.value = true; }}
        >
          ?
        </button>
      </div>
    </header>
  );
}
