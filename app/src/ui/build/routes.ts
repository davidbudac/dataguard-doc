/**
 * The lines the drawing derives, as selectable subjects.
 *
 * The canvas draws four kinds of line that are not document objects of their
 * own: redo between members (`redo:A:B`), the application's addresses
 * (`connect:APP:M`), an observer's connection to the primary (`ping:O:P`) and
 * its readiness check to a failover target (`check:O:T`). A click on one
 * selects the network link it rides when there is one -- that is the object
 * with a round trip and an up flag -- and the line's own key otherwise (the
 * link removed, or two ends on one host). Either way Build has to be able to
 * say what the line is and what taking it away means, so this is the one
 * list of them, in the same terms `routing.ts` draws them in.
 *
 * Pure over the document: the set is the declared configuration's, exactly as
 * the drawing's is outside a run.
 */

import { applicationsOf, declaredPrimary, resolveRedoGraph } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { readinessTargets } from '../canvas/layout';
import { applicationTargets, docLinkBetween } from '../canvas/routing';

export type RouteKind = 'redo' | 'connect' | 'ping' | 'check';

export interface RouteRef {
  /** The canvas key: `<kind>:<from>:<to>`. */
  key: string;
  kind: RouteKind;
  from: string;
  to: string;
  /** The document link the line rides, when there is one. */
  docLink?: string;
}

const KINDS: readonly RouteKind[] = ['redo', 'connect', 'ping', 'check'];

/** Is this a derived line's key at all? Says nothing about whether it is drawn. */
export function isRouteKey(key: string): boolean {
  const i = key.indexOf(':');
  return i > 0 && (KINDS as readonly string[]).includes(key.slice(0, i));
}

/** Every derived line of the declared configuration, in the drawing's order. */
export function allRoutes(doc: TopologyDoc): RouteRef[] {
  const out: RouteRef[] = [];
  const hostOf = (id: string): string | undefined =>
    doc.members.find((m) => (m.id as string) === id)?.instances[0]?.host as string | undefined;
  const push = (kind: RouteKind, from: string, to: string, fromHost: string | undefined, toHost: string | undefined): void => {
    const key = `${kind}:${from}:${to}`;
    if (out.some((r) => r.key === key)) return;
    const dl = docLinkBetween(doc, fromHost, toHost);
    out.push({ key, kind, from, to, ...(dl === undefined ? {} : { docLink: dl }) });
  };

  const primary = declaredPrimary(doc);
  if (primary !== null) {
    const graph = resolveRedoGraph(doc, { primary });
    for (const e of graph.edges) {
      push('redo', e.from as string, e.to as string, hostOf(e.from as string), hostOf(e.to as string));
    }
  }
  const pmy = primary === null ? undefined : (primary as string);
  const fsfoOn = doc.config.fsfo.state !== 'disabled';
  for (const o of doc.observers) {
    const oid = o.id as string;
    if (pmy !== undefined) push('ping', oid, pmy, o.host as string, hostOf(pmy));
    if (!fsfoOn) continue;
    for (const t of readinessTargets(doc)) {
      if (!doc.members.some((m) => (m.id as string) === t)) continue;
      push('check', oid, t, o.host as string, hostOf(t));
    }
  }
  for (const app of applicationsOf(doc)) {
    for (const m of applicationTargets(doc, app)) {
      push('connect', app.id as string, m.id as string, app.host as string, m.instances[0]?.host as string | undefined);
    }
  }
  return out;
}

/** The derived line this key names, if the configuration still draws it. */
export function resolveRoute(doc: TopologyDoc, key: string): RouteRef | null {
  if (!isRouteKey(key)) return null;
  return allRoutes(doc).find((r) => r.key === key) ?? null;
}

/** The derived lines that ride one document link. */
export function routesOn(doc: TopologyDoc, linkId: string): RouteRef[] {
  return allRoutes(doc).filter((r) => r.docLink === linkId);
}

/** What the rail's header calls the line. */
export function routeWord(r: RouteRef): string {
  switch (r.kind) {
    case 'redo': return 'Redo route';
    case 'connect': return 'Application address';
    case 'ping': return 'Observer connection';
    case 'check': return 'Readiness check';
  }
}
