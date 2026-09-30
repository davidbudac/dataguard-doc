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
 * Validation counts live in the header and validation panel. Keeping them out
 * of this strip also avoids confusing configuration findings with run outcomes.
 */

import { readout, runShown, topology, trace } from '@/state/derived';
import type { ReadoutChip } from '@/state/derived';
import { appLanesShown, tNow } from '@/state/view';
/* The same formatter *and the same horizon* the playhead badge and the
   transport's time field use, so the three places that print the playhead can
   never print it differently. Sharing only the formatter was not enough:
   `?t=200` on an axis that ends at 63 s used to print 200 here and 63.25 on
   the badge. */
import { clampToAxis, fmt } from './timeline/build';
import { Fragment } from 'preact';
import { Chip } from './common/Chip';
import { showExplanation } from './break/RunExplanation';
import '@/styles/readout.css';

export function Readout() {
  const chips = readout.value.filter((c) => c.id !== 'findings');
  /* A run exists when events have been injected (or the healthy run was
     asked for), and it is read wherever the outcome is read at `tNow`
     (`runShown`, ui.md SS3): Topology while there is one, the Detailed
     timeline and Learn. Configure, and Topology with no run, read the steady
     state, which has no playhead to speak of. */
  const t = trace.value;

  if (t === null || !runShown()) {
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
    v: `t = ${fmt(clampToAxis(tNow.value, t, topology.value.events, appLanesShown.value ? topology.value : undefined))}`,
    unit: 's',
    sub: 'The drawing shows this moment on the timeline; the readings under Run describe the whole simulation. Move the playhead to inspect another moment.',
  };

  return (
    <section class="readout" aria-label="Readout">
      <div class="chips">
        <Chip chip={at} />
        <div class="ro-run" role="group" aria-label="Run">
          <span class="ro-run-k">Run</span>
          {chips.map((c) => (
            <Fragment key={c.id}>
              <Chip chip={c} />
              {/* The way from the verdict to its reasons: the rail's
                  "Why this result?" fold, opened and brought into view. */}
              {c.id === 'outcome' ? (
                <button
                  type="button"
                  class="ro-why btn is-quiet"
                  aria-label="Why this result?"
                  title="Why this result? The run's decisions, step by step"
                  onClick={showExplanation}
                >
                  Why?
                </button>
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
