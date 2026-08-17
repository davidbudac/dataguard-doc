/**
 * "Explain more" -- the collapsible the published page invented, ported
 * (legacy fragment lines 112-134 and its IIFE at 2544).
 *
 * Three properties of the original are load-bearing and are kept:
 *
 *  1. **The button is the explanation's place on the page.** It sits exactly
 *     where the prose it opens would be, so nothing is silently missing: the
 *     reader can see there is more here and what it belongs to.
 *  2. **The prose is in the document either way.** Collapsing hides it under
 *     `@media screen` only (learn.css), which is what lets a printout carry the
 *     whole document -- ui.md's print rule -- and what keeps the page readable
 *     with no script at all.
 *  3. **The label says what pressing it does**: "Explain more" / "Hide", never
 *     a bare chevron.
 *
 * The open state is per block, seeded from `proseOpen`: a reader who opened the
 * last one probably wants the next one open too, and the preference rides the
 * View, not the Document.
 */

import { useId, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { proseOpen } from '@/state/view';

export interface ExplainProps {
  /** The closed label. The open label is always "Hide". */
  label?: string;
  children: ComponentChildren;
}

export function Explain({ label = 'Explain more', children }: ExplainProps) {
  const id = useId();
  const [open, setOpen] = useState(proseOpen.value);

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    proseOpen.value = next;
  };

  return (
    <div class={`explain-wrap${open ? ' is-open' : ''}`}>
      <button
        type="button"
        class="explain"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={id}
        onClick={toggle}
      >
        {open ? 'Hide' : label}
      </button>
      <div class="explain-body" id={id}>{children}</div>
    </div>
  );
}
