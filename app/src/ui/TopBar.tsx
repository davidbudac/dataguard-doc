/**
 * The top bar (ui.md SS3): brand, the four modes, the edition, the theme, and
 * undo/redo carrying the label of the edit they would reverse.
 */

import { canUndo, canRedo, redo, redoLabel, undo, undoLabel } from '@/state/history';
import { edition, mode, MODE_LABEL, MODES, theme } from '@/state/view';
import type { Mode, ThemePref } from '@/state/view';
import { saveEdition, saveTheme } from '@/state/persist';
import { applyTheme } from '@/state/view';
import { Segmented } from './common/Segmented';
import { WhyPill } from './common/WhyPill';

const MODE_TITLE: Record<Mode, string> = {
  build: 'Draw the configuration: sites, members, redo routes, observers',
  break: 'Inject failures and watch the clocks run',
  configure: 'The same deployment as DGMGRL commands, init parameters and connect strings',
  learn: 'Nine lessons, and the reference tables behind them',
};

export function TopBar() {
  return (
    <header class="topbar app-top">
      <div class="topbar-brand">
        <b>Data Guard topology</b>
        <span>simulator</span>
      </div>

      <Segmented<Mode>
        label="Mode"
        value={mode.value}
        options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m], title: MODE_TITLE[m] }))}
        onChange={(m) => { mode.value = m; }}
      />

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
            { value: 'auto', label: 'AUTO', title: 'Follow the system setting' },
            { value: 'light', label: 'LIGHT' },
            { value: 'dark', label: 'DARK' },
          ]}
          onChange={(v) => { theme.value = v; saveTheme(v); applyTheme(v); }}
        />

        {/* The button names the edit it would reverse: the label rides beside
            the verb (elided by CSS, complete in the title), so "Undo" is never
            a mystery button. */}
        <button
          type="button"
          class="btn"
          disabled={!canUndo.value}
          title={undoLabel.value ? `Undo: ${undoLabel.value}` : 'Nothing to undo'}
          onClick={() => undo()}
        >
          Undo
          {undoLabel.value ? <span class="undo-label">{undoLabel.value}</span> : null}
        </button>
        {canUndo.value ? null : <WhyPill why={{ state: 'off', why: 'nothing to undo yet' }} />}

        <button
          type="button"
          class="btn"
          disabled={!canRedo.value}
          title={redoLabel.value ? `Redo: ${redoLabel.value}` : 'Nothing to redo'}
          onClick={() => redo()}
        >
          Redo
          {redoLabel.value ? <span class="undo-label">{redoLabel.value}</span> : null}
        </button>
        {canRedo.value ? null : <WhyPill why={{ state: 'off', why: 'nothing undone yet' }} />}
      </div>
    </header>
  );
}
