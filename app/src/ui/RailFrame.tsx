/**
 * The frame around the side rail: its title bar with its one button, and the
 * slim strip a closed rail keeps.
 *
 * The rail's contents (the inspector, the Break rail) own their own headers --
 * what is selected, and the buttons that act on it. This bar is the shell's:
 * it names the rail and carries the one control that is about the rail itself.
 * What that control does depends on the rail. Break's Events rail *folds*: the
 * strip is one button, the whole height of the rail, so the way back is the
 * largest target on that edge, and it says what is behind it (how many events).
 * Topology's and Config's inspector *closes*: it is in the document only while
 * something is selected or the reader opened it, so the button clears the
 * selection and the explicit open, and keeps a named strip to come back by.
 * A click on the drawing, the strip, the top bar's Inspector button or `]` opens it.
 *
 * Folded, nothing of the rail's contents is rendered -- the page does not hide
 * what it can remove (ui.md SS3).
 *
 * Break's strip and its collapse button both point at the same element
 * (`RAIL_ID`, the `<aside>` itself, which is there in both states) through
 * `aria-controls`, and carry `aria-expanded`. `]` does the same from anywhere
 * (ui/shortcuts.ts), as does the top bar's Inspector button.
 */

import type { ComponentChildren } from 'preact';
import { events } from '@/state/derived';
import { revealRail, setRailCollapsed } from '@/state/persist';
import { clearSelection, inspectorOpen, mode, railOnDemand, releaseRail } from '@/state/view';

export const RAIL_ID = 'app-rail';

/** What the strip says is behind it, beside the rail's name: Break's events. */
function railContext(): string {
  const n = events.value.length;
  return n === 0 ? 'no events' : `${n} event${n === 1 ? '' : 's'}`;
}

/** The panel glyph: a frame with its right-hand column, and which way it goes. */
export function PanelIcon({ open }: { open: boolean }) {
  return (
    <svg class="rail-ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
      <line x1="10" y1="2.25" x2="10" y2="13.75" />
      {open
        ? <polyline points="5,6 7,8 5,10" />
        : <polyline points="7,6 5,8 7,10" />}
    </svg>
  );
}

/**
 * The rail's title bar: its name, anything the shell adds, and its one button --
 * `Close` for the inspector, `Collapse` for the Events rail.
 */
export function RailBar({ title, children }: { title: string; children?: ComponentChildren }) {
  const closes = railOnDemand(mode.value);
  return (
    <div class="rail-bar">
      <span class="rail-name">{title}</span>
      {children}
      <button
        type="button"
        class="btn is-icon rail-tog"
        aria-expanded="true" aria-controls={RAIL_ID}
        aria-label={`Collapse the ${title} panel`}
        title={`Collapse the ${title} panel (])`}
        onClick={closes
          /* The selection is what holds the inspector open, so closing it
             drops that too -- and the explicit open, or it would stay. */
          ? () => { releaseRail(); clearSelection(); inspectorOpen.value = false; }
          : () => setRailCollapsed(true)}
      >
        <PanelIcon open />
      </button>
    </div>
  );
}

/**
 * The folded rail: one tab at the top of its edge -- the panel glyph, the
 * count of events where the rail is the Events rail, and the rail's name read
 * downward -- rather than a column the whole height of the window. What is
 * behind it is the tooltip and the accessible name.
 */
export function RailStrip({ title }: { title: string }) {
  const scenario = mode.value === 'scenario';
  const ctx = scenario ? railContext() : 'settings';
  const n = scenario ? events.value.length : null;
  return (
    <button
      type="button"
      class="rail-strip"
      aria-expanded="false"
      aria-controls={RAIL_ID}
      aria-label={`Expand the ${title} panel (${ctx})`}
      title={`Expand the ${title} panel: ${ctx} (])`}
      onClick={revealRail}
    >
      <span class="rail-strip-ico"><PanelIcon open={false} /></span>
      {n === null || n === 0 ? null : <span class="rail-strip-n mono" aria-hidden="true">{n}</span>}
      <span class="rail-strip-t" aria-hidden="true">
        <span class="rail-strip-name">{title}</span>
      </span>
    </button>
  );
}
