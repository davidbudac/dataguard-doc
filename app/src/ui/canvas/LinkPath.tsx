/**
 * One routed link, with the pill that names it.
 *
 * Transport is spelled by the line itself -- SYNC solid with a filled arrow,
 * FASTSYNC solid with a hollow one, ASYNC dashed, the observer's ping dotted
 * and its readiness check dashed slate -- and arrowheads mean redo flow and
 * nothing else. A destination that is declared but not shipping keeps its line
 * at reduced weight and says why in the pill, because a route that is standing
 * down is still part of the configuration.
 *
 * A severed link goes red and dashed and trades its round trip for the failure
 * word: a round-trip time on a severed link is a number about nothing.
 */

import type { JSX } from 'preact';
import type { RoutedLink } from './routing';
import { MODEL_CHIP_W } from './routing';
import { approxW } from './measure';

export interface LinkPathProps {
  link: RoutedLink;
  prefix: string;
  highlighted: boolean;
  /** Selected in the document, which hover is not: it is what `aria-pressed` says. */
  selected?: boolean;
  dimmed: boolean;
  interactive: boolean;
  /**
   * Which half of the link this is. The canvas draws every line first and
   * every caption afterwards, so a caption is never painted over by a line
   * that happens to be routed later; both halves carry the same handlers and
   * the same `data-node`, so either one hovers and selects the whole link.
   */
  part?: 'line' | 'pill';
  /**
   * Said out loud on the pill: the sentence the router already composed for
   * the tooltip, so the line has one description rather than two.
   */
  label?: string;
  tabIndex?: number;
  onSelect?: (key: string, additive: boolean) => void;
  onHover?: (key: string | null) => void;
  onKeyDown?: (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>) => void;
  nodeRef?: (key: string, el: SVGGElement | null) => void;
}

/**
 * What selecting a link means: the document link underneath it, when the
 * drawing rides one -- that is the object an inspector can cut or re-time. A
 * redo edge with no link of its own (two members in one data centre) falls
 * back to the edge's own id.
 */
export const linkKey = (link: { id: string; docLink?: string }): string =>
  link.docLink ?? link.id;

function lineClass(link: RoutedLink): string {
  const parts = ['tp-link'];
  if (link.cut || link.down) parts.push('is-x');
  else if (link.kind === 'ping') parts.push('is-ping');
  else if (link.kind === 'check') parts.push('is-check');
  else if (link.xpt === 'ASYNC') parts.push('is-async');
  else parts.push('is-sync');
  if (!link.active) parts.push('is-inactive');
  return parts.join(' ');
}

function marker(link: RoutedLink, prefix: string): string | undefined {
  if (!link.arrow) return undefined;
  if (link.cut || link.down) return `url(#${prefix}-ar-r)`;
  if (!link.active) return `url(#${prefix}-ar-a)`;
  if (link.xpt === 'FASTSYNC') return `url(#${prefix}-ar-h)`;
  return `url(#${prefix}-ar-s)`;
}

export function LinkPath(props: LinkPathProps): JSX.Element {
  const { link, prefix } = props;
  const bad = link.cut || link.down;
  const capX = link.pill.x + 10;
  const textY = link.pill.y + 13.5;
  const valX = capX + approxW(link.caption, 10.5) + 8;
  const chipX = link.pill.x + link.pill.w - MODEL_CHIP_W + 2;
  const key = linkKey(link);
  const part = props.part ?? 'both';
  /* The caption is the control. Both halves hover and select -- a line is a
     wide, thin hit target and the reader aims at it -- but the focus stop, the
     name and the keys live on the pill: it is the half with an area, and a
     focus ring around a 600 px diagonal is a ring around the whole drawing. */
  const control = part !== 'line' && props.interactive;

  return (
    <g
      class={`tp-linkwrap${props.interactive ? ' is-live' : ''}${props.highlighted ? ' is-hov' : ''}${props.dimmed ? ' is-dim' : ''}`}
      data-node={key}
      {...(control
        ? {
          role: 'button',
          'aria-label': props.label ?? link.title,
          'aria-pressed': props.selected === true,
          /* `tabindex`, lower case: see `NodeCard`. */
          tabindex: props.tabIndex ?? -1,
          ref: (el: SVGGElement | null) => props.nodeRef?.(key, el),
          onKeyDown: (ev: JSX.TargetedKeyboardEvent<SVGGElement>) => props.onKeyDown?.(key, ev),
        }
        : {})}
      onClick={props.interactive
        ? (ev) => props.onSelect?.(key, ev.shiftKey || ev.metaKey || ev.ctrlKey)
        : undefined}
      onPointerEnter={props.interactive ? () => props.onHover?.(key) : undefined}
      onPointerLeave={props.interactive ? () => props.onHover?.(null) : undefined}
    >
      <title>{link.title}</title>
      {part === 'pill' ? null : (
        <>
          <path class={lineClass(link)} d={link.d} marker-end={marker(link, prefix)} />
          {link.slashes.map((s, i) => (
            <line class="tp-x" key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
          ))}
        </>
      )}
      {part === 'line' ? null : (
        <>
          <rect
            class={`tp-pill${bad ? ' is-x' : ''}${link.active ? '' : ' is-inactive'}`}
            x={link.pill.x} y={link.pill.y} width={link.pill.w} height={link.pill.h} rx={3}
          />
          <text class="tp-cap" x={capX} y={textY}>{link.caption}</text>
          {link.value === undefined ? null : (
            <text class={`tp-lat${bad ? ' is-x' : ''}`} x={valX} y={textY}>{link.value}</text>
          )}
          {link.model ? (
            <g class="tp-model">
              <title>
                This page&rsquo;s model: Oracle documents the grammar, not the instant the
                broker moves a destination between priority groups or onto its alternate.
              </title>
              <rect
                class="tp-model-bg"
                x={chipX} y={link.pill.y + 3} width={MODEL_CHIP_W - 6} height={14} rx={3}
              />
              <text
                class="tp-model-tx"
                x={chipX + (MODEL_CHIP_W - 6) / 2} y={link.pill.y + 13} text-anchor="middle"
              >
                model
              </text>
            </g>
          ) : null}
        </>
      )}
    </g>
  );
}
