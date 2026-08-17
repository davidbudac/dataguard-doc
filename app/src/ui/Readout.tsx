/**
 * The readout strip (ui.md SS3): outcome, clocks, observer state, issue count.
 *
 * Every chip's sentence branches on the outcome, never on the name of the
 * event that produced it -- the same failure ends in a role change under one
 * observer placement and in nothing at all under another, and the readout has
 * to say which of the two the reader is looking at.
 */

import { readout } from '@/state/derived';
import { Chip } from './common/Chip';

export function Readout() {
  const chips = readout.value;
  return (
    <section class="readout" aria-label="Readout">
      <div class="chips">
        {chips.map((c) => <Chip key={c.id} chip={c} />)}
      </div>
    </section>
  );
}
