/**
 * Icons on the thing under the pointer, in Break: crash a data centre, shut a
 * database down, cut a line -- one click each, without opening a menu.
 *
 * They are the action bar's shortest rows, not a second vocabulary: every icon
 * is a row of `actionsForKey` (`hoverTools`), so its title is the row's label
 * and a grey icon's title is the row's refusal.
 *
 * The strip carries its subject's `data-node`, so moving the pointer from the
 * card onto the icons keeps the card "under the pointer", and a press on them
 * is a press on the subject rather than on the ground (which clears the
 * selection). Like the bar, it undoes the drawing's scale, so a 24 px icon is
 * 24 px on screen whatever the stage width.
 */

import type { JSX } from 'preact';
import type { WhyState } from '../common/WhyPill';
import { GLYPH } from '../common/eventIcons';
import type { EventIconName } from '../common/eventIcons';

/** The glyphs a hover tool can draw: every event icon is one. */
export type ToolIconName = EventIconName;

export interface CanvasTool {
  id: string;
  icon: ToolIconName;
  label: string;
  enabled: WhyState;
  run: () => void;
}

/** One button, in CSS pixels. */
export const TOOL = 26;
const GAP = 2;
const PAD = 3;

/** The strip's size in CSS pixels, for placing it before it is drawn. */
export const toolsSize = (n: number): { w: number; h: number } =>
  ({ w: PAD * 2 + n * TOOL + Math.max(0, n - 1) * GAP, h: PAD * 2 + TOOL });

/** The icons whose action takes something away: drawn in the alarm colour on hover. */
const HARMFUL: ReadonlySet<ToolIconName> = new Set(['crash', 'isolate', 'shutdown', 'cut', 'stop']);

export interface HoverToolsProps {
  /** Top left corner, in the drawing's user units. */
  x: number;
  y: number;
  /** The drawing's own scale, so the strip can undo it. */
  scale: number;
  subject: string;
  tools: readonly CanvasTool[];
  /** When an icon acts ("at t = 20 s"), said once on the strip and on each icon. */
  when?: string;
}

export function HoverTools(props: HoverToolsProps): JSX.Element {
  const size = toolsSize(props.tools.length);
  return (
    <g
      class="tp-tools"
      data-node={props.subject}
      data-tools={props.subject}
      role="toolbar"
      aria-label={`Quick events for ${props.subject}${props.when === undefined ? '' : ` ${props.when}`}`}
      transform={`translate(${props.x},${props.y}) scale(${1 / props.scale})`}
      onPointerDown={(ev) => ev.stopPropagation()}
      onDblClick={(ev) => ev.stopPropagation()}
    >
      <rect class="tp-tools-bg" width={size.w} height={size.h} rx={size.h / 2} />
      {props.tools.map((t, i) => {
        const off = t.enabled.state === 'off';
        const title = t.enabled.state === 'off'
          ? `${t.label} — ${t.enabled.why}`
          : props.when === undefined ? t.label : `${t.label} · ${props.when}`;
        return (
          <g
            key={t.id}
            class={`tp-tool${off ? ' is-off' : ''}${HARMFUL.has(t.icon) ? ' is-harm' : ''}`}
            role="button"
            aria-label={title}
            aria-disabled={off}
            transform={`translate(${PAD + i * (TOOL + GAP)},${PAD})`}
            onClick={(ev) => {
              ev.stopPropagation();
              if (!off) t.run();
            }}
          >
            <title>{title}</title>
            <rect class="tp-tool-hit" width={TOOL} height={TOOL} rx={TOOL / 2} />
            <g class="tp-tool-ico" transform={`translate(${(TOOL - 16) / 2},${(TOOL - 16) / 2}) scale(${16 / 24})`}>
              {GLYPH[t.icon]}
            </g>
          </g>
        );
      })}
    </g>
  );
}
