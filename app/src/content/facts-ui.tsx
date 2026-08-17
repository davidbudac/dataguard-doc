/**
 * `<Fact>` -- a claim with its basis and its citation, labelled in place.
 *
 * The fifth invariant of the page (ui.md SS8): an undocumented number is never
 * printed bare. Every claim that is not a documentation sentence carries a chip
 * saying what it is -- this page's model, an inference, a later edition, or two
 * Oracle pages disagreeing -- and every chip carries the citation it rests on,
 * with the quoted sentence in its tooltip.
 *
 * The `id` is an engine citation id, so a claim can never point at a source the
 * catalogue does not hold: a test walks every `<Fact>` in the content tree and
 * resolves it.
 */

import type { ComponentChildren, VNode } from 'preact';
import { citation, type Basis, type CitationId } from '@/engine';

type Documented = { basis?: 'documented'; note?: string };
type Labelled = { basis: Exclude<Basis, 'documented'>; note: string };

export type FactProps = {
  /** One citation id, or several when the claim rests on more than one page. */
  id: CitationId | CitationId[];
  children: ComponentChildren;
  /** Render inline (default) or as its own block. */
  block?: boolean;
} & (Documented | Labelled);

const CHIP: Record<Basis, { label: string; long: string }> = {
  documented: { label: 'documented', long: 'A documentation sentence says this.' },
  'doc-later': { label: 'doc-later', long: '19c is silent; a later edition states it.' },
  conflict: { label: 'conflict', long: 'Two Oracle pages disagree; both are cited.' },
  inferred: { label: 'inferred', long: 'A deduction from two documented sentences.' },
  model: { label: 'model', long: "This page's model, not a documented figure." },
};

const ids = (id: CitationId | CitationId[]): CitationId[] => (Array.isArray(id) ? id : [id]);

export function Fact(props: FactProps): VNode {
  const basis: Basis = props.basis ?? 'documented';
  const chip = CHIP[basis];
  const note = props.note;
  const Tag = props.block === true ? 'div' : 'span';
  return (
    <Tag class={props.block === true ? 'ct-fact ct-fact-block' : 'ct-fact'}>
      <span class="ct-fact-claim">{props.children}</span>{' '}
      <span class="ct-fact-marks">
        <span
          class={`ct-chip ct-chip-${basis}`}
          title={note === undefined ? chip.long : `${chip.long} ${note}`}
          aria-label={`${chip.label}: ${note ?? chip.long}`}
        >
          {chip.label}
        </span>
        {ids(props.id).map((cid) => (
          <span key={cid}>
            {' '}
            <Cite id={cid} />
          </span>
        ))}
      </span>
    </Tag>
  );
}

/** The citation on its own -- an external link whose tooltip is the sentence. */
export function Cite({ id }: { id: CitationId }): VNode {
  const c = citation(id);
  const quote = c.paraphrase === true ? `${c.quote} (the fact sheet's words)` : `"${c.quote}"`;
  return (
    <a
      class="ct-cite"
      href={c.url}
      target="_blank"
      rel="noreferrer"
      title={`${id} - ${c.edition} - ${quote}`}
    >
      {c.edition}
      {c.verified === 'cross-edition' ? ' ↗' : ''}
    </a>
  );
}

/** Oracle vocabulary is always mono -- property names, modes, statuses, ORA numbers. */
export function M({ children }: { children: ComponentChildren }): VNode {
  return <span class="mono">{children}</span>;
}
