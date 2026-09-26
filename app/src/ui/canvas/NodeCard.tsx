/**
 * One node of the topology canvas -- the generalised `nodeCard` of the
 * published strip.
 *
 * Database badges use teal for primary, blue for standby, and a P/S marker.
 * Failure red overrides role color; the letter still identifies the role.
 * Far sync and observer glyphs keep their own distinct shapes.
 *
 * No inline styles: geometry rides on SVG presentation attributes and every
 * appearance is a class, because the page ships under a CSP with no
 * 'unsafe-inline'.
 */

import type { JSX } from 'preact';
import type { NodeBox } from './layout';
import { approxW, CARD, elide } from './measure';
import type { CardChip, CardFrame, Phase } from './routing';

export type { CardChip, CardFrame, ChipTone, Phase } from './routing';
export { NEUTRAL_FRAME } from './routing';

export interface NodeCardProps {
  node: NodeBox;
  frame: CardFrame;
  databaseRole?: 'primary' | 'standby' | 'former-primary' | null;
  chips: readonly CardChip[];
  label: string;
  prefix: string;
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
  /** A line from another card is over it: about to be connected, or refused. */
  target?: 'yes' | 'no' | null;
  /** Draw the port a line can be dragged from. */
  port?: boolean;
  interactive: boolean;
  tabIndex: number;
  onSelect?: (key: string, additive: boolean) => void;
  onHover?: (key: string | null) => void;
  onPointerDown?: (key: string, ev: JSX.TargetedPointerEvent<SVGGElement>) => void;
  onPortPointerDown?: (key: string, ev: JSX.TargetedPointerEvent<SVGGElement>) => void;
  onKeyDown?: (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>) => void;
  cardRef?: (key: string, el: SVGGElement | null) => void;
}

const PHASE_CLASS: Record<Phase, string> = {
  neutral: '',
  serving: 'is-tl',
  applying: 'is-bl',
  waiting: 'is-am',
  observer: 'is-vi',
  idle: 'is-sl',
};

const CHIP_H = 14;
const chipWidth = (text: string): number => Math.round(approxW(text, 9, true) + 12);

export function NodeCard(props: NodeCardProps): JSX.Element {
  const { node, frame, chips, prefix } = props;
  const role = props.databaseRole;
  const roleClass = role ? ` is-${role}` : '';
  const roleText = role === 'primary' ? 'Primary'
    : role === 'former-primary' ? 'Former primary'
    : role === 'standby' && node.lines.sub === 'Primary' ? 'Standby' : node.lines.sub;
  const isObs = node.kind === 'observer';
  /* A blade in a chassis stack: its own border and fill go quiet (the
     chassis behind it draws the one continuous outline and the divider
     between blades) until something -- selection, hover, a drag, a down
     frame -- needs to say *which* blade, at which point `.tp-card.is-blade`
     is beaten by the more specific `.is-sel`/`.is-hov`/... rule that follows
     it in canvas.css. */
  const stacked = node.stackKey !== undefined;
  const badge = isObs ? CARD.badgeObs : CARD.badgeDb;
  const bx = node.x + CARD.badgeX;
  const by = node.y + Math.round(((node.instanceHosts ? CARD.dbH : node.h) - badge) / 2);
  const pad = Math.round((badge - 24) / 2);
  const tx = node.x + (isObs ? CARD.textXObs : CARD.textXDb);
  const nameY = node.y + (isObs ? 22 : 24);

  const cardClass = [
    'tp-card',
    stacked ? 'is-blade' : '',
    frame.down ? 'is-down' : PHASE_CLASS[frame.phase],
    frame.stalled && !frame.down ? 'is-stalled' : '',
    frame.unreachable ? 'is-unreached' : '',
    frame.degraded ? 'is-degraded' : '',
    props.selected ? 'is-sel' : '',
    props.hovered ? 'is-hov' : '',
    props.dragging ? 'is-drag' : '',
    props.target === 'yes' ? 'is-target' : props.target === 'no' ? 'is-target-no' : '',
  ].filter(Boolean).join(' ');
  const portX = node.x + node.w;
  const portY = node.y + Math.round(node.h / 2);

  const crossX = node.x + node.w - 30;
  const crossY = nameY - 14;
  let chipRight = node.x + node.w - 8 - (frame.crashed ? 22 : 0);

  const chipNodes = chips.map((chip) => {
    const w = chipWidth(chip.text);
    chipRight -= w + 4;
    const x = chipRight + 4;
    return (
      <g class={`tp-chip is-${chip.tone}`} key={chip.text}>
        <title>{chip.title}</title>
        <rect class="tp-chip-bg" x={x} y={node.y + 6} width={w} height={CHIP_H} rx={3} />
        <text class="tp-chip-tx" x={x + w / 2} y={node.y + 6 + 10} text-anchor="middle">{chip.text}</text>
      </g>
    );
  });

  return (
    <g
      class={`tp-node${props.interactive ? ' is-live' : ''}`}
      role="button"
      aria-label={props.label}
      aria-pressed={props.selected}
      /* `tabindex`, lower case, because this is an SVG element: attribute
         names are only folded to lower case for HTML elements, so the
         camel-cased spelling lands as a literal `tabIndex` attribute that
         SVG2 knows nothing about and the card never takes focus. */
      tabindex={props.interactive ? props.tabIndex : -1}
      data-node={node.key}
      ref={(el) => props.cardRef?.(node.key, el)}
      onClick={props.interactive
        ? (ev) => props.onSelect?.(node.key, ev.shiftKey || ev.metaKey || ev.ctrlKey)
        : undefined}
      onPointerDown={props.interactive ? (ev) => props.onPointerDown?.(node.key, ev) : undefined}
      onPointerEnter={props.interactive ? () => props.onHover?.(node.key) : undefined}
      onPointerLeave={props.interactive ? () => props.onHover?.(null) : undefined}
      onKeyDown={props.interactive ? (ev) => props.onKeyDown?.(node.key, ev) : undefined}
    >
      {frame.down ? (
        <rect
          class="tp-hatchfill" x={node.x} y={node.y} width={node.w} height={node.h} rx={stacked ? 0 : 5}
          fill={`url(#${prefix}-hatch)`}
        />
      ) : null}
      <rect class={cardClass} x={node.x} y={node.y} width={node.w} height={node.h} rx={stacked ? 0 : 5} />
      <rect
        class={`tp-bdg${roleClass}${frame.down ? ' is-down' : ''}`}
        x={bx} y={by} width={badge} height={badge} rx={7}
      />
      <use
        href={`#${prefix}-ico-${node.glyph}`}
        class={`tp-ico${roleClass}${frame.down ? ' is-down' : ''}`}
        transform={`translate(${bx + pad},${by + pad})`}
      />
      {role ? (
        <g class={`tp-role-mark${roleClass}${frame.down ? ' is-down' : ''}`}>
          <title>{role === 'primary' ? 'Primary database' : role === 'former-primary' ? 'Former primary — not reinstated' : 'Standby database'}</title>
          <rect x={bx + badge - 12} y={by + badge - 12} width={14} height={14} rx={4} />
          <text x={bx + badge - 5} y={by + badge - 1.5} text-anchor="middle">
            {role === 'primary' ? 'P' : role === 'former-primary' ? 'F' : 'S'}
          </text>
        </g>
      ) : null}
      <text class="tp-name" x={tx} y={nameY}>{node.lines.name}</text>
      {node.lines.host === undefined ? null : (
        <text class="tp-host" x={tx} y={nameY + 16}>{node.lines.host}</text>
      )}
      {node.lines.sub === undefined ? null : (
        <text class="tp-sub" x={tx} y={nameY + 30}>{roleText}</text>
      )}
      {node.instanceHosts?.map((inst, index) => {
        const y = node.y + CARD.dbH + index * CARD.instanceRowH;
        const host = `${inst.host} · ${inst.site}`;
        const down = frame.downInstances?.includes(inst.name) ?? false;
        return <g key={inst.name} class="tp-instance">
          <title>{inst.name} on host {inst.host} in {inst.site}{down ? ' — down' : ''}</title>
          <rect class={`tp-card${down ? ' is-down' : ''}`} x={node.x + 8} y={y} width={node.w - 16} height={CARD.instanceRowH - 6} rx={3} />
          <text class="tp-host" x={node.x + 16} y={y + 14}>{elide(inst.name, 27)}{down ? ' ×' : ''}</text>
          <text class="tp-sub" x={node.x + 16} y={y + 29}>{elide(host, 34)}</text>
        </g>;
      })}
      {chipNodes}
      {props.port ? (
        /* The ports: a handle on each side edge a line is dragged from, so the
           line starts on the side it is heading for. Part of the card's own
           group, so the focus, the hover and the selection they live under are
           the card's; only their pointer press is their own. */
        [node.x, portX].map((px) => (
          <g
            class="tp-port" key={px} data-port={node.key}
            onPointerDown={(ev) => props.onPortPointerDown?.(node.key, ev)}
          >
            <title>Drag to another card to connect them</title>
            <circle class="tp-port-hit" cx={px} cy={portY} r={11} />
            <circle class="tp-port-dot" cx={px} cy={portY} r={5} />
            <line class="tp-port-x" x1={px - 2.5} y1={portY} x2={px + 2.5} y2={portY} />
            <line class="tp-port-x" x1={px} y1={portY - 2.5} x2={px} y2={portY + 2.5} />
          </g>
        ))
      ) : null}
      {frame.crashed ? (
        <g class="tp-cross" aria-hidden="true">
          <line class="tp-x" x1={crossX} y1={crossY} x2={crossX + 14} y2={crossY + 14} />
          <line class="tp-x" x1={crossX + 14} y1={crossY} x2={crossX} y2={crossY + 14} />
        </g>
      ) : null}
    </g>
  );
}
