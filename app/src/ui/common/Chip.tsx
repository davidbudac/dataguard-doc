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

export function Chip({ chip }: { chip: ReadoutChip }) {
  return (
    <div class={`chip t-${chip.tone}`}>
      <span class="chip-k">{chip.k}</span>
      <span class="chip-v">
        {chip.v}
        {chip.unit ? <small> {chip.unit}</small> : null}
        {chip.basis ? <Fact basis={chip.basis} id={chip.id} /> : null}
      </span>
      <span class="chip-s">{chip.sub}</span>
    </div>
  );
}
