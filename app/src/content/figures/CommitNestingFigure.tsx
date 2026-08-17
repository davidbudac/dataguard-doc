/**
 * One commit under SYNC -- which event contains which. Ported from the legacy
 * fragment (chapter 5, #impactview).
 *
 * The nesting is the point: log file sync contains redo write time, which
 * contains the two legs. LGWR starts the remote write before the local one and
 * waits for it afterwards, so the commit pays the longer leg, never the sum --
 * and `log file parallel write` is never the evidence for that (it is about
 * multiplexed online redo members).
 */

import type { VNode } from 'preact';

const LABEL =
  'Nested bars showing what contains what during one commit under SYNC transport. The outermost ' +
  "bar is the log file sync wait event, the whole cycle the committing session sees. Inside it is " +
  "the redo write time statistic, LGWR's write operation. Inside that are two legs that run " +
  'together: the SYNC remote write wait event, longer, and the log file parallel write wait event, ' +
  "the local redo write. Inside the remote leg sits the standby's own RFS random i/o write to its " +
  'standby redo log. The commit pays the longer of the two legs, never their sum.';

export function CommitNestingFigure(): VNode {
  return (
    <svg class="ct-svg" viewBox="0 0 960 376" role="img" aria-label={LABEL}>
      <text class="t-top" x="40" y="22">
        One commit under SYNC — which event contains which. Widths are illustrative, not measured.
      </text>

      <text class="t-lane" x="160" y="58" text-anchor="end">Foreground</text>
      <text class="t-sub" x="160" y="72" text-anchor="end">the session’s wait</text>
      <rect class="bar b-am" x="170" y="40" width="760" height="42" />
      <text class="t-bar t-mono f-am" x="550" y="66" text-anchor="middle">log file sync</text>

      <text class="t-lane" x="160" y="114" text-anchor="end">LGWR</text>
      <text class="t-sub" x="160" y="128" text-anchor="end">the write operation</text>
      <rect class="bar b-sl" x="206" y="96" width="688" height="42" />
      <text class="t-bar t-mono f-sl" x="550" y="122" text-anchor="middle">redo write time</text>
      <text class="t-sub" x="550" y="154" text-anchor="middle">
        a V$SYSSTAT statistic in centiseconds — not a wait event
      </text>

      <line class="gridline" stroke-dasharray="4 4" x1="238" y1="162" x2="238" y2="304" />
      <line class="gridline" stroke-dasharray="4 4" x1="838" y1="162" x2="838" y2="304" />

      <text class="t-sub" x="160" y="192" text-anchor="end">remote leg</text>
      <rect class="bar b-vi" x="238" y="168" width="600" height="38" />
      <text class="t-bar t-mono f-vi" x="538" y="192" text-anchor="middle">SYNC remote write</text>

      <text class="t-sub" x="160" y="240" text-anchor="end">local leg</text>
      <rect class="bar b-bl" x="250" y="216" width="200" height="38" />
      <text class="t-bar t-mono f-bl" x="350" y="240" text-anchor="middle">log file parallel write</text>

      <text class="t-lane" x="160" y="284" text-anchor="end">Standby</text>
      <text class="t-sub" x="160" y="298" text-anchor="end">inside the remote leg</text>
      <rect class="bar b-bl" x="470" y="264" width="250" height="34" />
      <text class="t-bar t-mono f-bl" x="595" y="286" text-anchor="middle">RFS random i/o</text>

      <text class="t-bar f-sl" x="40" y="332">
        LGWR starts the remote write before the local one and waits for it afterwards: the commit pays
        the longer leg, never the sum.
      </text>
      <text class="t-bar f-sl" x="40" y="350">
        RFS random i/o is the standby writing what it received to its standby redo log, inside SYNC
        remote write.
      </text>
      <text class="t-bar f-sl" x="40" y="368">
        Not drawn: the CPU waits, the on-disk SCN update and the Oracle RAC broadcast that log file
        sync also covers.
      </text>
    </svg>
  );
}
