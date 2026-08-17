/**
 * The curly braces under the axis, whose tips sit exactly on the interval they
 * measure. The path arithmetic is the published fragment's `brace()` (lines
 * 4454-4467), unchanged: below 22 px of span it degrades to a square bracket
 * with a stem, because a curl that small reads as a smudge.
 */

import type { TimelineBrace } from './build';

/** `dir` is +1 for a brace under the axis, -1 for one above the lanes. */
export function bracePath(x0: number, x1: number, y: number, dir: 1 | -1): string {
  const h = 5 * dir;
  const mid = (x0 + x1) / 2;
  const a = Math.abs(h);
  const r = (n: number): number => Math.round(n * 10) / 10;
  if (x1 - x0 < 22) {
    return `M${r(x0)},${y} V${y + h} H${r(x1)} V${y} M${r(mid)},${y + h} V${y + h + 5 * dir}`;
  }
  return `M${r(x0)},${y} q0,${h} ${a},${h}` +
    ` H${r(mid - a)} q${a},0 ${a},${h}` +
    ` q0,${-h} ${a},${-h}` +
    ` H${r(x1 - a)} q${a},0 ${a},${-h}`;
}

export interface BraceProps {
  brace: TimelineBrace;
}

/** One packed brace: the curl, the parameter name, and what it measures. */
export function Brace({ brace }: BraceProps) {
  return (
    <g class="tl-brace" data-tip={`${brace.name} — ${brace.val}`}>
      <path class={`brace ${brace.tone}`} d={bracePath(brace.x0, brace.x1, brace.y, 1)} />
      <text
        class={brace.mono ? 't-brace-n t-mono' : 't-brace-n'}
        x={brace.lx}
        y={brace.y + 26}
        text-anchor="middle"
      >
        {brace.name}
      </text>
      <text class="t-brace-v t-mono" x={brace.lx} y={brace.y + 41} text-anchor="middle">
        {brace.val}
      </text>
    </g>
  );
}

export interface TopBraceProps {
  x0: number;
  x1: number;
  y: number;
  tone: 'br-sl' | 'br-rd';
}

/** The outage brace above the lanes: same geometry, opening downwards. */
export function TopBrace({ x0, x1, y, tone }: TopBraceProps) {
  return <path class={`brace ${tone}`} d={bracePath(x0, x1, y, -1)} />;
}
