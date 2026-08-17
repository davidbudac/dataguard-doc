/**
 * The ground panel of one data centre.
 *
 * Only a lost site is filled with the hatch: a severed link leaves both data
 * centres perfectly healthy, and the drawing has to keep saying so.
 */

import type { JSX } from 'preact';
import type { SiteBox } from './layout';

export interface SiteRectProps {
  site: SiteBox;
  down: boolean;
  selected: boolean;
  interactive: boolean;
  prefix: string;
  onSelect?: (key: string, additive: boolean) => void;
}

/** Sites are selected by their own id, the way members and observers are. */
export const siteKey = (id: string): string => id;

export function SiteRect(props: SiteRectProps): JSX.Element {
  const { site } = props;
  const cls = [
    'tp-site',
    props.down ? 'is-down' : '',
    props.selected ? 'is-sel' : '',
  ].filter(Boolean).join(' ');
  const key = siteKey(site.id as string);
  return (
    <g
      class={`tp-sitewrap${props.interactive ? ' is-live' : ''}`}
      data-node={key}
      onClick={props.interactive
        ? (ev) => props.onSelect?.(key, ev.shiftKey || ev.metaKey || ev.ctrlKey)
        : undefined}
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
    </g>
  );
}
