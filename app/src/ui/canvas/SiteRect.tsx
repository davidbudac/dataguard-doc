/**
 * The ground panel of one data centre.
 *
 * Only a lost site is filled with the hatch: a severed link leaves both data
 * centres perfectly healthy, and the drawing has to keep saying so.
 *
 * It is also a control, and the same one a card is. A data centre is a subject
 * the inspector has a form for, the Break table has events for and `Delete`
 * removes -- so it takes focus, answers the keys a card answers, and carries a
 * name a screen reader can read (`aria.ts`). It was selectable by mouse alone
 * for one release, which is a control that exists only for the half of the
 * audience that uses a pointer.
 */

import type { JSX } from 'preact';
import type { SiteBox } from './layout';

export interface SiteRectProps {
  site: SiteBox;
  down: boolean;
  selected: boolean;
  hovered: boolean;
  /** A card is being dragged over it: it is about to take that card. */
  drop?: boolean;
  interactive: boolean;
  /** Said out loud: the name, what stands in it, and whether it is gone. */
  label: string;
  tabIndex: number;
  prefix: string;
  onSelect?: (key: string, additive: boolean) => void;
  onHover?: (key: string | null) => void;
  onKeyDown?: (key: string, ev: JSX.TargetedKeyboardEvent<SVGGElement>) => void;
  nodeRef?: (key: string, el: SVGGElement | null) => void;
}

/** Sites are selected by their own id, the way members and observers are. */
export const siteKey = (id: string): string => id;

export function SiteRect(props: SiteRectProps): JSX.Element {
  const { site } = props;
  const cls = [
    'tp-site',
    props.down ? 'is-down' : '',
    props.selected ? 'is-sel' : '',
    props.hovered ? 'is-hov' : '',
    props.drop ? 'is-drop' : '',
    site.empty ? 'is-empty' : '',
  ].filter(Boolean).join(' ');
  const key = siteKey(site.id as string);
  return (
    <g
      class={`tp-sitewrap${props.interactive ? ' is-live' : ''}`}
      role="button"
      aria-label={props.label}
      aria-pressed={props.selected}
      /* `tabindex`, lower case: attribute names are folded to lower case only
         for HTML elements, so the camel-cased spelling lands on an SVG `<g>`
         as a literal attribute SVG2 has never heard of and the panel never
         takes focus. `NodeCard` carries the same note and the same bug. */
      tabindex={props.interactive ? props.tabIndex : -1}
      data-node={key}
      ref={(el) => props.nodeRef?.(key, el)}
      onClick={props.interactive
        ? (ev) => props.onSelect?.(key, ev.shiftKey || ev.metaKey || ev.ctrlKey)
        : undefined}
      onPointerEnter={props.interactive ? () => props.onHover?.(key) : undefined}
      onPointerLeave={props.interactive ? () => props.onHover?.(null) : undefined}
      onKeyDown={props.interactive ? (ev) => props.onKeyDown?.(key, ev) : undefined}
    >
      {props.down ? (
        <rect
          class="tp-hatchfill" x={site.x} y={site.y} width={site.w} height={site.h} rx={6}
          fill={`url(#${props.prefix}-hatch)`}
        />
      ) : null}
      <rect class={cls} x={site.x} y={site.y} width={site.w} height={site.h} rx={6} />
      <text class="tp-sitelab" x={site.labelX} y={site.labelY} text-anchor="middle">
        {site.label}
      </text>
      {site.empty ? (
        <text
          class="tp-siteempty" x={site.x + site.w / 2} y={site.y + site.h / 2 - 4}
          text-anchor="middle"
        >
          {props.drop ? 'Drop it here' : 'Nothing here yet'}
        </text>
      ) : null}
    </g>
  );
}
