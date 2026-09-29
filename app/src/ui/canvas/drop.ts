/**
 * What a card being dragged may be dropped on, and where it would land.
 *
 * Two pure questions the drawing asks while a card is in the air (task 1.5):
 *
 *  - `mergeVerdict`: may this card share that host? The one refusal is the
 *    placement rule the validator already states (`OBS.ON_DB_HOST`): an
 *    observer is never deployed on a database's host, so neither a drop of an
 *    observer onto a database's host nor of a database onto an observer's is
 *    offered. The application is the page's own second refusal: it is drawn
 *    on a host of its own. Everything else the merge does today it still does.
 *  - `landingFor`: the rectangle the card would occupy after the drop, in the
 *    coordinates of the drawing as it is now -- laid out on a copy of the
 *    document with the move already made, then carried across by a card the
 *    two drawings share, so a column that the move would re-order does not
 *    throw the outline off into the wrong data centre.
 *
 * Nothing here reads a signal or the DOM.
 */

import { applicationsOf, findApplication } from '@/engine';
import type { HostId, RedoGraph, TopologyDoc } from '@/engine';
import type { WhyState } from '../common/WhyPill';
import type { Geometry, LayoutOffset, SiteBox } from './layout';
import { layoutTopology, LAYOUT } from './layout';
import type { Rect } from './measure';

const ON: WhyState = { state: 'on' };

export const WHY_OBSERVER_ON_DB_HOST = 'An observer never shares a host with a database.';

/** The hosts a card stands on: every instance's for a member, the one for an observer. */
function hostsOf(t: TopologyDoc, key: string): HostId[] {
  const m = t.members.find((x) => (x.id as string) === key);
  if (m) return [...new Set(m.instances.map((i) => i.host))];
  const o = t.observers.find((x) => (x.id as string) === key);
  if (o) return [o.host];
  const app = findApplication(t, key);
  return app !== undefined ? [app.host] : [];
}

const hasDatabase = (t: TopologyDoc, host: string): boolean =>
  t.members.some((m) => m.kind === 'database' && m.instances.some((i) => (i.host as string) === host));
const hasObserver = (t: TopologyDoc, host: string): boolean =>
  t.observers.some((o) => (o.host as string) === host);

/** This page's own rule, not Oracle's: each application is drawn on a host of its own. */
export const WHY_APPLICATION_OWN_HOST = 'This page draws each application on a host of its own.';

/** May the card `key` be dropped onto `host`'s card or stack, to share it? */
export function mergeVerdict(t: TopologyDoc, key: string, host: string): WhyState {
  if (findApplication(t, key) !== undefined || applicationsOf(t).some((a) => (a.host as string) === host)) {
    return { state: 'off', why: WHY_APPLICATION_OWN_HOST };
  }
  const isObserver = t.observers.some((o) => (o.id as string) === key);
  const member = t.members.find((m) => (m.id as string) === key);
  if (isObserver && hasDatabase(t, host)) return { state: 'off', why: WHY_OBSERVER_ON_DB_HOST };
  if (member?.kind === 'database' && hasObserver(t, host)) return { state: 'off', why: WHY_OBSERVER_ON_DB_HOST };
  return ON;
}

/** The document with `key` standing where the drop would put it. */
function movedDoc(t: TopologyDoc, key: string, to: { site?: string; host?: string }): TopologyDoc | null {
  const own = hostsOf(t, key);
  if (own.length === 0) return null;
  if (to.host !== undefined) {
    const host = t.hosts.find((h) => (h.id as string) === to.host);
    if (!host) return null;
    return {
      ...t,
      members: t.members.map((m) => ((m.id as string) === key
        ? { ...m, instances: m.instances.map((i) => ({ ...i, host: host.id })) }
        : m)),
      observers: t.observers.map((o) => ((o.id as string) === key ? { ...o, host: host.id } : o)),
    };
  }
  if (to.site === undefined || !t.sites.some((s) => (s.id as string) === to.site)) return null;
  const site = t.sites.find((s) => (s.id as string) === to.site)!.id;
  /* `moveToSite` gives the card a new host of its own there; moving the host
     it stands on is the same drawing for everything but a shared host, and a
     shared host only changes what else the outline would be drawn beside. */
  return { ...t, hosts: t.hosts.map((h) => (own.includes(h.id) ? { ...h, site } : h)) };
}

/**
 * Where `key` would land if dropped on `to`, in `geo`'s coordinates, or null
 * when the drop means nothing. `drawn` is the target data centre's box as the
 * reader sees it (frozen for the drag), used when there is nothing in it yet
 * to line the two drawings up by.
 */
export function landingFor(
  t: TopologyDoc, graph: RedoGraph, overrides: Readonly<Record<string, LayoutOffset>>,
  geo: Geometry, drawn: readonly SiteBox[], key: string, to: { site?: string; host?: string },
): Rect | null {
  const next = movedDoc(t, key, to);
  if (next === null) return null;
  /* The drop drops the card's own offset (`moveToSite`, `mergeIntoHost`). */
  const rest: Record<string, LayoutOffset> = { ...overrides };
  delete rest[key];
  const after = layoutTopology(next, graph, { overrides: rest });
  const card = after.byKey[key];
  if (!card) return null;
  /* Any other card standing in the same data centre in both drawings says how
     far the one moved against the other. */
  const mate = after.nodes.find((n) => n.key !== key && (n.site as string) === (card.site as string)
    && geo.byKey[n.key] !== undefined);
  if (mate) {
    const now = geo.byKey[mate.key]!;
    return { x: card.x + now.x - mate.x, y: card.y + now.y - mate.y, w: card.w, h: card.h };
  }
  /* Nothing there yet: centred in the panel it is aimed at, above the name. */
  const panel = drawn.find((s) => (s.id as string) === (card.site as string));
  if (!panel) return null;
  const inner = panel.h - LAYOUT.labelBand;
  return {
    x: Math.round(panel.x + (panel.w - card.w) / 2),
    y: Math.round(panel.y + Math.max(LAYOUT.colPad, (inner - card.h) / 2)),
    w: card.w,
    h: card.h,
  };
}
