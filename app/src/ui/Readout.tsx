/**
 * The readout strip (ui.md SS3): outcome, clocks, observer state, issue count.
 *
 * Every chip's sentence branches on the outcome, never on the name of the
 * event that produced it -- the same failure ends in a role change under one
 * observer placement and in nothing at all under another, and the readout has
 * to say which of the two the reader is looking at.
 *
 * In the two modes that draw a run there are **two clocks on this strip**, and
 * the strip says so. "Outcome failover / New primary open 45 s" is the whole
 * run; the drawing above it is frozen at the playhead. Unlabelled, the two
 * read as one reading taken at the same instant -- which is how a reader ends
 * up believing the drawing at t = 0 already shows the failover. So the strip
 * leads with the moment the drawing is at, and the run's own numbers carry a
 * group label of their own.
 *
 * The `Run` group holds the run's own chips and nothing else. Findings are the
 * validator's answer about the *configuration* -- `derived.ts` keeps the run's
 * own findings (a readiness gate that forbade a failover, an alternate that
 * activated) deliberately out of `issues` so the two are never conflated --
 * so the Findings chip sits outside the group, beside the playhead reading.
 * Under the label it would say "Run - Findings no issues" at the very moment
 * the run raised the warning that blocked the failover.
 */

import { readout, topology, trace } from '@/state/derived';
import type { ReadoutChip } from '@/state/derived';
import { mode, tNow } from '@/state/view';
/* The same formatter *and the same horizon* the playhead badge and the
   transport's time field use, so the three places that print the playhead can
   never print it differently. Sharing only the formatter was not enough:
   `?t=200` on an axis that ends at 63 s used to print 200 here and 63.25 on
   the badge. */
import { clampToAxis, fmt } from './timeline/build';
import { Chip } from './common/Chip';
import '@/styles/readout.css';

export function Readout() {
  const chips = readout.value;
  /* A run exists when events have been injected, and it is drawn in the two
     modes that read the outcome at `tNow` (ui.md SS3). Build and Configure
     read the steady state, which has no playhead to speak of. */
  const t = trace.value;
  const run = t !== null && (mode.value === 'break' || mode.value === 'learn');

  if (!run) {
    return (
      <section class="readout" aria-label="Readout">
        <div class="chips">
          {chips.map((c) => <Chip key={c.id} chip={c} />)}
        </div>
      </section>
    );
  }

  const at: ReadoutChip = {
    id: 'at',
    tone: 'ik',
    k: 'Drawing at',
    v: `t = ${fmt(clampToAxis(tNow.value, t, topology.value.events))}`,
    unit: 's',
    sub: 'The drawing above holds the state at this moment on the timeline. The chips under Run are the run as a whole. Scrub the playhead to move this one.',
  };

  /* Chip ids are stable, so the partition is by id rather than by position. */
  const runChips = chips.filter((c) => c.id !== 'findings');
  const docChips = chips.filter((c) => c.id === 'findings');

  return (
    <section class="readout" aria-label="Readout">
      <div class="chips">
        <Chip chip={at} />
        <div class="ro-run" role="group" aria-label="Run">
          <span class="ro-run-k">Run</span>
          {runChips.map((c) => <Chip key={c.id} chip={c} />)}
        </div>
        {docChips.map((c) => <Chip key={c.id} chip={c} />)}
      </div>
    </section>
  );
}
