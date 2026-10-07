/** Main navigation: numbered workflow, reference tools and document controls.
 * Step descriptions and next/back actions live in WorkflowBar. */

import type { ComponentChildren } from 'preact';
import { canUndo, canRedo, redo, redoLabel, undo, undoLabel } from '@/state/history';
import {
  applyPalette, applyTheme, commandOpen, edition, inspectorRailWanted, introOpen, introPage, mode, MODE_LABEL, MODE_SUB, nextTheme,
  palette, railOnDemand, theme,
} from '@/state/view';
import type { PalettePref, ThemePref } from '@/state/view';
import { saveEdition, savePalette, saveTheme, toggleRail } from '@/state/persist';
import { Segmented } from './common/Segmented';
import { INTRO_HREF, openIntro } from './intro/route';
import { goToStep, WORKFLOW } from './workflow';
import { PanelIcon } from './RailFrame';

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
        <nav class="workflow-steps" aria-label="Workflow steps">
          {WORKFLOW.map((x, i) => <button type="button" key={x}
            class={`workflow-step${m === x ? ' is-active' : ''}`}
            aria-current={m === x ? 'step' : undefined} aria-label={`Step ${i + 1}: ${MODE_LABEL[x]}`} title={MODE_SUB[x]}
            onClick={() => goToStep(x)}>
            <span class="step-number">{i + 1}</span><span>{MODE_LABEL[x]}</span>
          </button>)}
        </nav>
        <nav class="workflow-extras" aria-label="Reference and output">
          {(['configure', 'learn'] as const).map(x => <button type="button" class={`btn is-quiet${m === x ? ' is-active' : ''}`}
            aria-pressed={m === x} title={MODE_SUB[x]} onClick={() => goToStep(x)}>{MODE_LABEL[x]}</button>)}
        </nav>
      </div>

      <div class="topbar-group">
        <Segmented<'19c' | '26ai'>
          label="Oracle release"
          value={edition.value}
          options={[
            { value: '19c', label: '19c', title: 'Oracle Database 19c' },
            { value: '26ai', label: '26ai', title: 'Oracle AI Database 26ai' },
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

        <button type="button" class="btn is-icon command-toggle" aria-label="Command palette"
          aria-haspopup="dialog" aria-expanded={commandOpen.value} title="Search commands (⌘/Ctrl K)"
          onClick={() => { commandOpen.value = !commandOpen.value; }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
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

        {/* Topology's and Config's inspector is not on screen until something
            is selected, so the way to it with nothing selected is here (and
            `]`). Only where that rail is a column: below 1280 the drawer has
            its button in the document row, and Break's Events rail its strip.
            Pressed while the rail is up, it puts it away. */}
        {railOnDemand(m) && !introPage.value ? (
          <button
            type="button"
            class="btn is-icon inspector-tog"
            aria-label="Inspector"
            title="Show or hide the Inspector panel (])"
            aria-expanded={inspectorRailWanted()}
            onClick={() => toggleRail()}
          >
            <PanelIcon open={inspectorRailWanted()} />
          </button>
        ) : null}

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
