/**
 * A gray control says why it is gray, on itself (ui.md SS8, invariant one).
 *
 * The prop is deliberately a union rather than a boolean: `{ state: 'off' }`
 * does not type-check without a reason, so a disabled control that explains
 * nothing cannot be written by accident.
 */

export type WhyState = { state: 'on' } | { state: 'off'; why: string };

export const isOff = (w: WhyState): w is { state: 'off'; why: string } => w.state === 'off';

export function WhyPill({ why }: { why: WhyState }) {
  if (why.state === 'on') return null;
  return <span class="why">{why.why}</span>;
}
