/**
 * The timeline's tooltip.
 *
 * One delegated `pointermove` on the plot wrapper finds the nearest ancestor
 * carrying `data-tip` and shows its text; there is no per-segment listener and
 * no per-segment state. Position is the one place the CSP escape hatch applies
 * (ui.md SS1): custom properties set through a ref, never a `style` prop.
 */

import { useLayoutEffect, useRef } from 'preact/hooks';
import { isElement } from '../common/dom';

export interface TooltipState {
  text: string;
  x: number;
  y: number;
}

export interface TooltipProps {
  tip: TooltipState | null;
}

/** Read the delegated tip out of an event target, or null when there is none. */
export function tipFromEvent(target: EventTarget | null): string | null {
  if (!isElement(target)) return null;
  const host = target.closest('[data-tip]');
  const text = host?.getAttribute('data-tip');
  return text && text.length > 0 ? text : null;
}

export function Tooltip({ tip }: TooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    el.style.setProperty('--tip-x', `${Math.round(tip.x)}px`);
    el.style.setProperty('--tip-y', `${Math.round(tip.y)}px`);
  }, [tip]);

  /* Rendered only when there is something to say: an empty tooltip parked
     off-screen would still be read out by a screen reader. */
  if (!tip) return null;
  return (
    <div class="tl-tip" ref={ref} role="tooltip" aria-hidden="true">
      {tip.text}
    </div>
  );
}
