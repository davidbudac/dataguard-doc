/**
 * The chassis behind a group of cards that share a host.
 *
 * Two or more cards sharing a host snap into one stack: a single header band
 * naming the host once, the blades touching under it, a thin divider standing
 * in for the row gap between them. `NodeCard` still draws each blade's own
 * icon, name and selection feedback (`.tp-card.is-blade` in canvas.css keeps
 * a blade's own fill and border quiet at rest) -- this draws the one
 * continuous outline underneath them, the header, and the dividers, from the
 * blades' own rects, so it can never draw a seam the blades disagree with.
 *
 * The header is decoration, not a control: the host it names is already in
 * every blade's aria sentence (`aria.ts` reads the document, not the card),
 * so the header itself carries no role and takes no tab stop -- a screen
 * reader passes over it the way it passes over the site rect's fill.
 */

import type { JSX } from 'preact';
import type { NodeBox, StackBox } from './layout';

export interface StackChassisProps {
  stack: StackBox;
  /** Every blade's own box, keyed the same way `Geometry.byKey` is. */
  byKey: Record<string, NodeBox>;
  interactive: boolean;
  /** A press on the header: the same "move the whole stack" gesture a press
      on any one of its blades already starts. */
  onHeaderPointerDown?: (topKey: string, ev: JSX.TargetedPointerEvent<SVGGElement>) => void;
  /** A single card is being dragged over this stack's host: it says so the
      way an empty data centre panel does (`SiteRect`'s `is-drop`). */
  dropTarget?: boolean;
  /** A lone card is in the air: `maybe` where this host would take it, `dim`
      where it cannot, `no` where the pointer is on it and it refuses. */
  hint?: 'maybe' | 'no' | 'dim' | null;
}

export function StackChassis(props: StackChassisProps): JSX.Element | null {
  const { stack, byKey } = props;
  const blades = stack.memberKeys.map((k) => byKey[k]).filter((n): n is NodeBox => n !== undefined);
  if (blades.length === 0) return null;
  const topKey = stack.memberKeys[0] as string;
  const headerBottom = stack.y + stack.headerH;
  /* One divider per boundary between two blades -- never after the last one,
     and never between the header and the first blade: the header's own tint
     already marks that seam. */
  const dividers: number[] = [];
  for (let i = 0; i < blades.length - 1; i++) {
    const b = blades[i];
    if (b) dividers.push(b.y + b.h);
  }
  const r = 6;
  return (
    <g
      class={`tp-stack${props.hint === 'dim' ? ' is-dim' : ''}`}
      aria-hidden="true"
      onPointerDown={props.interactive
        ? (ev) => props.onHeaderPointerDown?.(topKey, ev)
        : undefined}
    >
      <rect
        class={`tp-stack-frame${props.dropTarget ? ' is-drop'
          : props.hint === 'no' ? ' is-drop-no' : props.hint === 'maybe' ? ' is-can-drop' : ''}`}
        x={stack.x} y={stack.y} width={stack.w} height={stack.h} rx={r}
      />
      <path
        class={`tp-stack-hd${props.interactive ? ' is-live' : ''}`}
        d={`M${stack.x},${headerBottom} v-${stack.headerH - r} a${r},${r} 0 0 1 ${r},-${r} `
          + `h${stack.w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${stack.headerH - r} z`}
      />
      <text
        class="tp-stack-hd-tx"
        x={stack.x + stack.w / 2}
        y={stack.y + stack.headerH / 2 + 3.5}
        text-anchor="middle"
      >
        {stack.label}
      </text>
      {dividers.map((y) => (
        <line key={y} class="tp-stack-div" x1={stack.x} y1={y} x2={stack.x + stack.w} y2={y} />
      ))}
    </g>
  );
}
