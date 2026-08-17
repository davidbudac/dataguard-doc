/**
 * The readout tile, the inline tag, and the label an undocumented value wears.
 */

import type { ComponentChildren } from 'preact';
import type { Basis } from '@/engine';
import type { ReadoutChip, Tone } from '@/state/derived';

/**
 * "Undocumented is labelled in place" (ui.md SS0.5): a number this page models
 * rather than reads out of the documentation carries the word next to the
 * number, not in a footnote at the bottom of the page.
 */
const BASIS_WORD: Record<Basis, string | null> = {
  documented: null,
  'doc-later': 'later edition',
  conflict: 'docs disagree',
  inferred: 'inferred',
  model: "this page's model",
};

export function Fact({ basis, id }: { basis: Basis; id?: string }) {
  const word = BASIS_WORD[basis];
  if (word === null) return null;
  return <span class={`fact b-${basis}`} title={id}>{word}</span>;
}

export function Tag(
  { tone = 'sl', children, title }: { tone?: Tone; children: ComponentChildren; title?: string },
) {
  return <span class={`tag t-${tone}`} title={title}>{children}</span>;
}

/**
 * One reading of the configuration, on one line: the label, the value, and --
 * where there is one -- a quieter second value beside it. The sentence behind
 * the number is the chip's `title`, so the strip reads at a glance without
 * shrinking a paragraph into a tile (ui.md SS3, "as built").
 */
export function Chip({ chip }: { chip: ReadoutChip }) {
  return (
    <div class={`chip t-${chip.tone}`} title={chip.sub}>
      <span class="chip-k">{chip.k}</span>
      <span class="chip-v">
        {chip.v}
        {chip.unit ? <small> {chip.unit}</small> : null}
        {chip.basis ? <Fact basis={chip.basis} id={chip.id} /> : null}
      </span>
      {chip.v2 ? <span class="chip-s">{chip.v2}</span> : null}
    </div>
  );
}
