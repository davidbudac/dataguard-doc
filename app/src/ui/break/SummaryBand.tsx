/**
 * The run's summary, at reading size: a band of cards under the Detailed
 * timeline's bar, between the bar and the rows.
 *
 * The bar's terse line (`TerseReadout`) is the summary a reader already has,
 * one line of it, with whatever does not fit left out. The band is the same
 * readings -- `readout` without the findings chip, the same list the line
 * draws -- each on a card with its sentence showing, so nothing has to be
 * hovered to be read. It is folded to start with; two things unfold it, the
 * "Summary" button beside the line and a click on the line itself, and the
 * button (`aria-expanded`) is the keyboard's way in.
 *
 * `ReadoutFold` is what stands where the terse line used to stand in a bar:
 * folded, the line and the button; unfolded, a spacer (so the controls to the
 * right keep their places) and the button. `SummaryBand` is the band. Both
 * are only there with a run: with none there is nothing to summarise, and the
 * bar is exactly what it was.
 *
 * The open/folded state is `summaryOpen`, remembered under `dg-summary`.
 */

import type { ComponentChildren } from 'preact';
import { readout, trace } from '@/state/derived';
import type { ReadoutChip } from '@/state/derived';
import { setSummaryOpen } from '@/state/persist';
import { summaryOpen } from '@/state/view';
import { Fact } from '../common/Chip';
import { showExplanation } from './RunExplanation';

/** The band's id: what the button's `aria-controls` names. */
export const SUMMARY_ID = 'run-summary';

/** What TerseReadout shows: the readout without the findings chip. */
const chipsNow = (): ReadoutChip[] => readout.value.filter((c) => c.id !== 'findings');

function Card({ c }: { c: ReadoutChip }) {
  const model = c.basis !== undefined && c.basis !== 'documented';
  const why = c.id === 'outcome';
  return (
    <div class={`rs-card t-${c.tone}`} data-chip={c.id}>
      <div class="rs-k">{c.k}</div>
      <div class="rs-vrow">
        <span class="rs-v">{c.v}</span>
        {c.unit ? <span class="rs-u">{c.unit}</span> : null}
        {c.v2 ? <span class="rs-v2">{c.v2}</span> : null}
      </div>
      <p class="rs-sub">{c.sub}</p>
      {model || why ? (
        <div class="rs-foot">
          {model ? <Fact basis={c.basis as NonNullable<ReadoutChip['basis']>} id={c.id} /> : null}
          {why ? (
            <button
              type="button" class="rs-why"
              title="Why this result? The run's decisions, step by step" onClick={showExplanation}
            >
              Why?
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The cards; they wrap to the width they have. */
export function SummaryCards() {
  const chips = chipsNow();
  if (chips.length === 0) return null;
  return (
    <div class="rs-cards">
      {chips.map((c) => <Card key={c.id} c={c} />)}
    </div>
  );
}

/**
 * The band, right under a bar. Nothing unless there is a run and the reader
 * has unfolded it.
 */
export function SummaryBand() {
  if (trace.value === null || !summaryOpen.value) return null;
  return (
    <section class="rs-band" id={SUMMARY_ID} aria-label="Run summary">
      <SummaryCards />
    </section>
  );
}

/**
 * Stands where the terse line stands in the Detailed timeline's bar. Given the
 * line, it decides what the bar shows: with no run, the line as it was;
 * folded, the line -- a click on it unfolds the band -- and the button;
 * unfolded, a spacer and the button.
 */
export function ReadoutFold({ children }: { children: ComponentChildren }) {
  if (trace.value === null) return <>{children}</>;
  const open = summaryOpen.value;
  const button = (
    <button
      type="button" class="rs-tog" aria-expanded={open} aria-controls={SUMMARY_ID}
      title={open ? 'Fold the summary cards away' : 'Unfold the summary cards'}
      onClick={() => setSummaryOpen(!open)}
    >
      {open
        ? <><span aria-hidden="true">▴</span> Summary</>
        : <>Summary <span aria-hidden="true">▾</span></>}
    </button>
  );
  if (open) {
    return <><span class="rs-fill" />{button}</>;
  }
  return (
    <div class="rs-host">
      {/* A press on the line is a click on the line; a button inside it, like
          "Why?", keeps its own click. */}
      <div
        class="rs-hit" title="Show the summary cards"
        onClick={(e) => {
          if ((e.target as Element).closest('button')) return;
          setSummaryOpen(true);
        }}
      >
        {children}
      </div>
      {button}
    </div>
  );
}
