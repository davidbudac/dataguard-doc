/**
 * The drawn lines a selection stands for: a redo route, an application
 * address, an observer's connection or readiness check.
 *
 * On a link it lists the lines riding it, each with the removal Build's table
 * has for it (the same `BuildAction` the action bar presses), because a click
 * on a line selects the link and the link's own Remove only severs them. On a
 * line selected by its own key the removal is the header's Remove, so the
 * section only says what the line is and where it is configured.
 */

import type { TopologyDoc } from '@/engine';
import { removeRouteAction } from '../build/actions';
import { resolveRoute, routeWord } from '../build/routes';
import type { RouteRef } from '../build/routes';
import { isOff, WhyPill } from '../common/WhyPill';
import { FieldNote } from '../common/Field';
import { Group } from './controls';

function what(r: RouteRef): string {
  switch (r.kind) {
    case 'redo': return `${r.from}'s RedoRoutes ship redo to ${r.to}.`;
    case 'connect': return `${r.to} is on ${r.from}'s ADDRESS_LIST.`;
    case 'ping': return `${r.from} connects to the primary ${r.to}.`;
    case 'check': return `${r.to} is a fast-start failover target, so ${r.from} checks it is ready.`;
  }
}

export function RouteSection(
  { doc, routeKeys, offer }: { doc: TopologyDoc; routeKeys: readonly string[]; offer: boolean },
) {
  const routes = routeKeys.map((k) => resolveRoute(doc, k)).filter((r): r is RouteRef => r !== null);
  if (routes.length === 0) return null;
  return (
    <Group title={offer ? 'Lines on this link' : 'Line'}>
      {routes.map((r) => {
        const a = offer ? removeRouteAction(doc, r, `route:${r.key}`) : null;
        return (
          <div class="field is-row" key={r.key}>
            <div class="field-hd">
              <span class="field-name is-prose">{routeWord(r)}</span>
            </div>
            <div class="field-ctl">
              <span class="field-val mono">{r.from} → {r.to}</span>
            </div>
            <FieldNote always>{what(r)}</FieldNote>
            {a === null ? null : (
              <div class="field-ctl">
                <button
                  type="button"
                  class={`btn${isOff(a.enabled) ? ' is-faded' : ''}`}
                  disabled={isOff(a.enabled)}
                  onClick={a.run}
                >
                  {a.label}
                </button>
                {isOff(a.enabled) ? <WhyPill why={a.enabled} /> : null}
              </div>
            )}
          </div>
        );
      })}
    </Group>
  );
}
