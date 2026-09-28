/**
 * Which data centre a new standby, far sync instance or observer goes into
 * when the reader did not name one (task 1.6).
 *
 * The rule of thumb is the deployment anyone drawing Data Guard means, and
 * the one that moves the least of what is already drawn:
 *
 *  - a **standby** goes to an empty data centre when there is one (so a
 *    second database lands opposite the first, and "+ Data centre" then
 *    "+ Standby" fills the new one), otherwise beside the standbys already
 *    there -- the standby data centre with the fewest members -- and only
 *    after that anywhere else. It never goes into the observer's data centre
 *    while another will do: the observer belongs at a third site, apart from
 *    both databases, and a database arriving there would also re-order the
 *    drawing's columns under the reader.
 *  - a **far sync instance** goes beside the primary, the way every far sync
 *    preset draws it.
 *  - an **observer** joins the observers' own data centre, or takes an empty
 *    one, and lands beside a database only when there is nowhere else.
 *
 * Pure: a document in, a site id out.
 */

import type { SiteId, TopologyDoc } from '@/engine';

interface SiteLoad {
  id: SiteId;
  databases: number;
  farsyncs: number;
  observers: number;
  primary: boolean;
}

function loads(t: TopologyDoc): SiteLoad[] {
  const siteOf = new Map<string, SiteId>();
  for (const h of t.hosts) siteOf.set(h.id as string, h.site);
  const out = new Map<string, SiteLoad>(t.sites.map((s) => [s.id as string, {
    id: s.id, databases: 0, farsyncs: 0, observers: 0, primary: false,
  }]));
  for (const m of t.members) {
    const sites = new Set(m.instances.map((i) => siteOf.get(i.host as string) as string | undefined));
    for (const s of sites) {
      const l = s === undefined ? undefined : out.get(s);
      if (!l) continue;
      if (m.kind === 'farsync') l.farsyncs++;
      else l.databases++;
      if (m.kind === 'database' && m.role === 'primary') l.primary = true;
    }
  }
  for (const o of t.observers) {
    const l = out.get(siteOf.get(o.host as string) as string);
    if (l) l.observers++;
  }
  return [...out.values()];
}

const empty = (l: SiteLoad): boolean => l.databases + l.farsyncs + l.observers === 0;
const members = (l: SiteLoad): number => l.databases + l.farsyncs;
/** The first of the least loaded, in document order. */
const leastLoaded = (list: readonly SiteLoad[]): SiteLoad | undefined =>
  list.reduce<SiteLoad | undefined>((best, l) => (best === undefined || members(l) < members(best) ? l : best), undefined);

export function siteForNewStandby(t: TopologyDoc): SiteId | null {
  const all = loads(t);
  const pick = all.find(empty)
    ?? leastLoaded(all.filter((l) => !l.primary && l.databases > 0 && l.observers === 0))
    ?? leastLoaded(all.filter((l) => !l.primary && l.databases > 0))
    ?? all.find((l) => l.databases === 0 && l.observers === 0)
    ?? all.find((l) => l.databases === 0)
    ?? all.at(-1);
  return pick?.id ?? null;
}

export function siteForNewFarSync(t: TopologyDoc): SiteId | null {
  const all = loads(t);
  return (all.find((l) => l.primary) ?? all.find((l) => l.databases > 0) ?? all.at(-1))?.id ?? null;
}

export function siteForNewObserver(t: TopologyDoc): SiteId | null {
  const all = loads(t);
  const pick = all.find((l) => l.observers > 0 && members(l) === 0)
    ?? all.find(empty)
    ?? all.find((l) => l.databases === 0)
    ?? all.at(-1);
  return pick?.id ?? null;
}
