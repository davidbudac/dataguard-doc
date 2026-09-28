/**
 * What every rule gets handed -- engine design SS2.
 *
 * `validate` resolves the document once (the redo graph for the declared
 * primary, the network graph, the candidate target list, the declared
 * destinations per member) and passes the result to a flat list of rule
 * functions. Nothing in here decides anything: the context is lookup only, so
 * that a rule reads as the documentation sentence it enforces.
 */

import type { HostId, MemberId, SiteId } from '../ids';
import type { Basis, Finding, FindingFix, FindingSubject, Severity } from '../types/claims';
import type { CitationId } from '../citations';
import type {
  DatabaseMember, DestGroup, DestProps, FarSyncMember, Member, RedoRouteRule, RouteDest,
  TopologyDoc, XptMode,
} from '../types/topology';
import { declaredPrimary, isDatabase, isFarSync } from '../types/topology';
import type { RedoEdge, RedoGraph } from '../types/trace';
import type { NetState, Reachability } from '../net/graph';
import { buildReachability, initialNetState, membersReachable } from '../net/graph';
import { resolveRedoGraph } from '../redo/resolve';
import { defaultDestProps } from '../serialize/schema';
import { allowedBases, allowedSeverities } from './catalogue';
import type { RuleId } from './catalogue';

/** One authored destination, with the rule and group it came from. */
export interface DeclaredDest {
  from: Member;
  to: Member;
  ruleIndex: number;
  rule: RedoRouteRule;
  groupIndex: number;
  group: DestGroup;
  dest: RouteDest;
  /** The transport spelled on the rule itself, if any. */
  explicitXpt?: XptMode;
  /** Rule attribute where there is one, otherwise the receiver's LogXptMode. */
  xpt: XptMode;
  /** True when the destination came from ALL rather than from a name. */
  fromAll: boolean;
  sourceKind: 'LOCAL' | 'ANY' | 'named';
}

export interface ValidateContext {
  doc: TopologyDoc;
  net: NetState;
  reach: Reachability;
  /** The declared primary, or null when the document has none. */
  primary: DatabaseMember | null;
  /** Resolved for the declared primary; null when there is no primary. */
  graph: RedoGraph | null;
  member(id: MemberId | string): Member | undefined;
  /** Position in doc.members, for a JSON patch path. */
  indexOf(id: MemberId | string): number;
  databases: DatabaseMember[];
  farSyncs: FarSyncMember[];
  /** Enabled database members that are not the declared primary. */
  standbys: DatabaseMember[];
  /** The FastStartFailoverTarget property as authored; empty when it is ANY. */
  rawTargets: MemberId[];
  targetIsAny: boolean;
  /** The candidate targets the property resolves to, in the order it lists them. */
  candidates: MemberId[];
  /** Fast-start failover is enabled, in either the full or the observe-only mode. */
  fsfoOn: boolean;
  /** Every destination authored on a member's RedoRoutes property. */
  declaredDests(m: Member): DeclaredDest[];
  /** Destinations a member forwards while it is NOT the primary. */
  forwardedDests(m: Member): DeclaredDest[];
  /** Active, up edges leaving the declared primary. */
  primaryEdges(): RedoEdge[];
  /**
   * The destination's properties, or the broker defaults where it has none --
   * MaxFailure defaults to 1 for a destination written inside a parenthesised
   * RedoRoutes group (`inGroup`), 0 otherwise.
   */
  destPropsFor(from: Member, to: MemberId, inGroup?: boolean): DestProps;
  siteOf(host: HostId): SiteId | undefined;
  /** Hosts that run a database instance. */
  dbHosts: Set<HostId>;
  /** Clusters that run a database instance. */
  dbClusters: Set<string>;
  reachableMembers(a: Member, b: Member): boolean;
}

export type Rule = (ctx: ValidateContext) => Finding[];

/* ---------------- building a finding ---------------- */

export interface FindingInput {
  subject: FindingSubject;
  message: string;
  cite: CitationId[];
  /** Only where the rule emits more than the catalogue's default. */
  severity?: Severity;
  basis?: Basis;
  note?: string;
  ora?: string;
  fix?: FindingFix;
}

/**
 * Stamp a finding with the severity and basis the catalogue gives the rule,
 * and refuse the shapes the accuracy rules forbid: a documented finding with
 * no citation, a conflict citing one side, a model or an inference with no
 * note to render next to it.
 */
export function mk(id: RuleId, f: FindingInput): Finding {
  const severity = f.severity ?? allowedSeverities(id)[0] as Severity;
  const basis = f.basis ?? allowedBases(id)[0] as Basis;
  if (!allowedSeverities(id).includes(severity)) {
    throw new Error(`${id} may not emit severity ${severity}`);
  }
  if (!allowedBases(id).includes(basis)) {
    throw new Error(`${id} may not emit basis ${basis}`);
  }
  if (basis === 'documented' && f.cite.length === 0) {
    throw new Error(`${id} is documented and must carry a citation`);
  }
  if (basis === 'conflict' && (f.cite.length < 2 || !f.note)) {
    throw new Error(`${id} is a conflict and must cite both sides with a note`);
  }
  if (basis !== 'documented' && !f.note) {
    throw new Error(`${id} has basis ${basis} and must carry a note`);
  }
  const out: Finding = { id, severity, basis, cite: f.cite, subject: f.subject, message: f.message };
  if (f.note !== undefined) out.note = f.note;
  if (f.ora !== undefined) out.ora = f.ora;
  if (f.fix !== undefined) out.fix = f.fix;
  return out;
}

export const memberSubject = (m: Member | MemberId | string): FindingSubject => ({
  kind: 'member',
  id: typeof m === 'string' ? m : (m.id as string),
});

export const routeSubject = (m: Member): FindingSubject => ({ kind: 'route', id: m.id as string });
export const configSubject = (): FindingSubject => ({ kind: 'config' });

/** DGMGRL spells a member name in single quotes; so do the messages. */
export const q = (s: string): string => `'${s}'`;

/* ---------------- the context itself ---------------- */

export function buildContext(doc: TopologyDoc): ValidateContext {
  const net = initialNetState(doc);
  const reach = buildReachability(doc, net);
  const byId = new Map<string, Member>();
  const index = new Map<string, number>();
  doc.members.forEach((m, i) => {
    byId.set(m.id as string, m);
    index.set(m.id as string, i);
  });

  const primaryId = declaredPrimary(doc);
  const primaryMember = primaryId ? byId.get(primaryId as string) : undefined;
  const primary = primaryMember && isDatabase(primaryMember) ? primaryMember : null;
  const graph = primaryId ? resolveRedoGraph(doc, { primary: primaryId, net }) : null;

  const databases = doc.members.filter(isDatabase);
  const farSyncs = doc.members.filter(isFarSync);
  const standbys = databases.filter((m) => m.enabled && m.id !== primaryId);

  const target = doc.config.fsfo.target;
  const rawTargets = target.kind === 'list' ? [...target.members] : [];
  const targetIsAny = target.kind === 'ANY';

  /* Physical or logical standbys only, in the order the property lists them:
     "The broker selects a target based on the order in which they are
     specified" -- never "the first viable one in the list". */
  const legalTarget = (m: Member | undefined): m is DatabaseMember =>
    !!m && isDatabase(m) && m.enabled && (m.role === 'physical' || m.role === 'logical');
  const candidates: MemberId[] = targetIsAny
    ? doc.members.filter((m) => legalTarget(m)).map((m) => m.id)
    : rawTargets.filter((id) => legalTarget(byId.get(id as string)));

  const siteByHost = new Map<HostId, SiteId>();
  for (const h of doc.hosts) siteByHost.set(h.id, h.site);
  const clusterByHost = new Map<HostId, string>();
  for (const h of doc.hosts) if (h.cluster !== undefined) clusterByHost.set(h.id, h.cluster);

  const dbHosts = new Set<HostId>();
  const dbClusters = new Set<string>();
  for (const m of databases) {
    for (const i of m.instances) {
      dbHosts.add(i.host);
      const c = clusterByHost.get(i.host);
      if (c !== undefined) dbClusters.add(c);
    }
  }

  const declaredCache = new Map<string, DeclaredDest[]>();

  const declaredDests = (m: Member): DeclaredDest[] => {
    const cached = declaredCache.get(m.id as string);
    if (cached) return cached;
    const out: DeclaredDest[] = [];
    m.redoRoutes.forEach((rule, ruleIndex) => {
      const sourceKind: DeclaredDest['sourceKind'] =
        rule.source === 'LOCAL' ? 'LOCAL' : rule.source === 'ANY' ? 'ANY' : 'named';
      rule.groups.forEach((group, groupIndex) => {
        for (const dest of group.dests) {
          /* ALL is every other member, snapshot standbys included: they
             receive and archive redo like any standby. */
          const targets: Array<{ id: MemberId; fromAll: boolean }> = dest.target === 'ALL'
            ? doc.members
              .filter((x) => x.enabled && x.id !== m.id)
              .map((x) => ({ id: x.id, fromAll: true }))
            : [{ id: dest.target, fromAll: false }];
          for (const t of targets) {
            const to = byId.get(t.id as string);
            if (!to) continue;
            const entry: DeclaredDest = {
              from: m, to, ruleIndex, rule, groupIndex, group, dest,
              xpt: dest.xpt ?? to.logXptMode,
              fromAll: t.fromAll,
              sourceKind,
            };
            if (dest.xpt !== undefined) entry.explicitXpt = dest.xpt;
            out.push(entry);
          }
        }
      });
    });
    declaredCache.set(m.id as string, out);
    return out;
  };

  /* A rule whose source is not LOCAL ships redo while this member is a standby:
     a standby's (prm : x ASYNC) is active now, its (LOCAL : ...) only once it
     becomes the primary. */
  const forwardedDests = (m: Member): DeclaredDest[] =>
    declaredDests(m).filter((d) => d.sourceKind !== 'LOCAL');

  const primaryEdges = (): RedoEdge[] => {
    if (!graph) return [];
    return graph.edges.filter((e) => e.from === graph.primary && e.active && e.up);
  };

  return {
    doc, net, reach, primary, graph,
    member: (id) => byId.get(id as string),
    indexOf: (id) => index.get(id as string) ?? -1,
    databases, farSyncs, standbys,
    rawTargets, targetIsAny, candidates,
    fsfoOn: doc.config.fsfo.state !== 'disabled',
    declaredDests, forwardedDests, primaryEdges,
    destPropsFor: (from, to, inGroup) => from.dests[to] ?? defaultDestProps({ inGroup: inGroup === true }),
    siteOf: (host) => siteByHost.get(host),
    dbHosts, dbClusters,
    reachableMembers: (a, b) => membersReachable(doc, net, a, b, reach),
  };
}
