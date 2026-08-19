/**
 * The hints: one switch for every sentence on this page that explains a
 * control rather than reporting one.
 *
 * The rail used to carry a line of prose under every field -- what LogXptMode
 * maps to, what ReopenSecs gates, what a rename rewrites. All of it true, and
 * all of it on screen at once, so the reader who had come to move three
 * sliders read four screens of documentation to find them. The prose is not
 * cut and it is not painted out of view: with hints off it is **not rendered
 * at all** (ui.md SS8, "nothing hidden by CSS alone"), and the `Hints` button
 * in the rail header is the affordance that says it is still there.
 *
 * Two things stay on screen whatever the toggle says, because they are not
 * explanation:
 *
 *  - **A caution** -- `<Note warn>` and a `warn` note under a field. It reports
 *    the state the reader is looking at (a lag limit above the threshold, a
 *    read-only viewport), and a caution nobody asked to see is a caution.
 *  - **An empty state, a count, a refusal.** `WhyPill` is untouched: a grey
 *    control says why it is grey at every setting of this toggle.
 *
 * On paper everything renders, exactly as every `Fold` opens: a printout with
 * the explanations switched off is a page that quietly lost half its text.
 */

import { hintsOn } from '@/state/view';
import { toggleHints } from '@/state/persist';
import { printing } from './print';

/** Whether an optional sentence renders now. Print always says yes. */
export const hintsShown = (): boolean => hintsOn.value || printing.value;

/**
 * The same words in both places the toggle appears, so the button and the
 * card that mentions it cannot drift apart.
 */
export const HINTS_LABEL = 'Hints';
export const HINTS_TITLE = 'Show the explanation under each control';

/** A quiet toggle: `aria-pressed`, because it turns something on, not open. */
export function HintsToggle() {
  const on = hintsOn.value;
  return (
    <button
      type="button"
      class={on ? 'btn is-quiet hint-tog is-on' : 'btn is-quiet hint-tog'}
      aria-pressed={on}
      title={HINTS_TITLE}
      onClick={() => toggleHints()}
    >
      {HINTS_LABEL}
    </button>
  );
}
