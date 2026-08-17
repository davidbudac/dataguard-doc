/**
 * The effective redo graph -- engine design SS3.
 *
 * Given a document and which member is primary, work out which routing rules
 * are active, which destinations they feed, what transport each hop uses, who
 * is reachable from the primary and what the resulting protection level is.
 *
 * Everything the docs do not state outright comes back as a Claim or a Finding
 * with a model label: the priority-group activation rule, what SYNCHRONIZED
 * means across a far sync hop, and the semantics of an ANY source.
 */

import type { MemberId } from '../ids';
import type { Claim, Finding } from '../types/claims';
import { documented, inferred, model } from '../types/claims';
import type {
  DestGroup, Member, ProtectionMode, RedoRouteRule, RouteDest, TopologyDoc, XptMode,
} from '../types/topology';
import { isDatabase, isFarSync } from '../types/topology';
import type {
  EdgeInactiveReason, EdgeRole, ProtectionLevel, RedoEdge, RedoGraph, ResolvedMember,
} from '../types/trace';
import type { NetState } from '../net/graph';
import { buildReachability, initialNetState, memberAlive, membersReachable } from '../net/graph';

export const destKey = (from: MemberId, to: MemberId): string => `${from}>${to}`;

export interface ResolveOptions {
  /** Which member is primary. `SHOW CONFIGURATION WHEN PRIMARY IS x` is this argument. */
  primary: MemberId;
  net?: NetState;
  /** Destination keys disabled by MaxFailure; they stay disabled until reenabled. */
  disabledDests?: ReadonlySet<string>;
  /** Destination keys already latched onto their alternate in an earlier epoch. */
  altLatched?: ReadonlySet<string>;
}

/** Group priority default: 1 for far sync members, 8 otherwise. */
export const defaultGroupPriority = (m: Member): number => (isFarSync(m) ? 1 : 8);

/** The rule whose source names the current primary, or undefined. */
export function activeRule(
  m: Member, primary: MemberId,
): { rule: RedoRouteRule; index: number } | undefined {
  const rules = m.redoRoutes.length > 0 ? m.redoRoutes : defaultRules(m);
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] as RedoRouteRule;
    if (ruleIsActive(r, m, primary)) return { rule: r, index: i };
  }
  return undefined;
}

function ruleIsActive(r: RedoRouteRule, m: Member, primary: MemberId): boolean {
  if (r.source === 'LOCAL') return m.id === primary;
  if (r.source === 'ANY') return m.id !== primary;
  return r.source.includes(primary);
}

/**
 * The NULL property. At a database it is `(LOCAL : ALL)`; at a far sync
 * instance nothing is documented, and this engine forwards nothing.
 */
function defaultRules(m: Member): RedoRouteRule[] {
  if (isFarSync(m)) return [];
  return [{ source: 'LOCAL', groups: [{ dests: [{ target: 'ALL' }] }] }];
}

const enabledMembers = (doc: TopologyDoc): Member[] => doc.members.filter((m) => m.enabled);

/**
 * ALL is every other enabled member except snapshot standbys, and except the
 * current primary: RedoRoutes cannot be set on a snapshot standby, and redo
 * travelling back to its own source is not a destination. Both are inferences
 * from the grammar rather than sentences of their own.
 */
function expandAll(doc: TopologyDoc, from: MemberId, primary: MemberId): MemberId[] {
  return enabledMembers(doc)
    .filter((m) => m.id !== from && m.id !== primary)
    .filter((m) => !(isDatabase(m) && m.role === 'snapshot'))
    .map((m) => m.id);
}

interface CandidateDest {
  to: MemberId;
  xpt: XptMode;
  xptSource: 'rule-attribute' | 'dest-logxptmode';
  viaAlternate: boolean;
  /** The named destination an active alternate is standing in for. */
  supersededByAlternate?: boolean;
}

export function resolveRedoGraph(doc: TopologyDoc, opts: ResolveOptions): RedoGraph {
  const net = opts.net ?? initialNetState(doc);
  const primary = opts.primary;
  const reach = buildReachability(doc, net);
  const byId = new Map<string, Member>();
  for (const m of doc.members) byId.set(m.id as string, m);
  const findings: Finding[] = [];
  const seenFinding = new Set<string>();
  const addFinding = (f: Finding): void => {
    const k = `${f.id}|${f.subject.kind}|${f.subject.id ?? ''}`;
    if (seenFinding.has(k)) return;
    seenFinding.add(k);
    findings.push(f);
  };

  const linkUp = (a: Member, b: Member): boolean =>
    memberAlive(doc, net, a) && memberAlive(doc, net, b) && membersReachable(doc, net, a, b, reach);

  const edges: RedoEdge[] = [];

  for (const sender of enabledMembers(doc)) {
    if (isFarSync(sender) && sender.redoRoutes.length === 0) {
      addFinding({
        id: 'ROUTES.FARSYNC_NULL_DEFAULT', severity: 'info', basis: 'model',
        cite: ['ROUTES.DEFAULT_NULL', 'ROUTES.LOCAL_NOT_AT_FARSYNC'],
        subject: { kind: 'member', id: sender.id as string },
        message: `${sender.name} has no RedoRoutes, so it forwards nothing.`,
        note: 'The NULL default is documented as (LOCAL : ALL) at a primary, and LOCAL cannot be used at a far sync instance; what a far sync with a NULL property forwards is not documented. This engine forwards nothing.',
      });
    }
    const act = activeRule(sender, primary);
    if (!act) continue;
    if (act.rule.source === 'ANY') {
      addFinding({
        id: 'ROUTES.ANY_SEMANTICS', severity: 'info', basis: 'model', cite: ['ROUTES.RULE_ACTIVE'],
        subject: { kind: 'route', id: sender.id as string },
        message: `The ANY source on ${sender.name} is read as "active whenever this member is not the primary".`,
        note: "The documentation says a rule is active when its source names the current primary; how ANY behaves at the member that IS primary is not stated, so this reading is this page's model.",
      });
    }

    /* Candidate destinations per group, with the alternate resolved. */
    const groups = act.rule.groups;
    const groupCandidates: CandidateDest[][] = groups.map((g) =>
      candidatesFor(doc, net, primary, sender, g, byId, opts, addFinding));

    const chosen = chooseGroup(groups, groupCandidates, sender, byId, doc, net, reach);

    groups.forEach((g, gi) => {
      const priority = g.priority ?? defaultGroupPriority(sender);
      const cands = groupCandidates[gi] ?? [];
      for (const c of cands) {
        const receiver = byId.get(c.to as string);
        if (!receiver) continue;
        const up = linkUp(sender, receiver);
        const active = gi === chosen && !c.supersededByAlternate;
        /* MaxFailure comes first, because it is the reason that outlives the
           others: a disabled destination is not standing by and is not merely
           down -- there is no further access to it until it is manually
           reenabled, which is also why the alternate beside it stays in. */
        let inactiveReason: EdgeInactiveReason | undefined;
        if (opts.disabledDests?.has(destKey(sender.id, c.to))) inactiveReason = 'max-failure-disabled';
        else if (c.supersededByAlternate) inactiveReason = 'alternate-standby';
        else if (gi !== chosen) inactiveReason = 'lower-priority-group';
        else if (!up) inactiveReason = 'destination-down';
        const edge: RedoEdge = {
          from: sender.id,
          to: c.to,
          xpt: c.xpt,
          xptSource: c.xptSource,
          ruleIndex: act.index,
          groupPriority: priority,
          role: edgeRole(sender, receiver, primary),
          active: active && inactiveReason !== 'max-failure-disabled',
          up,
        };
        if (inactiveReason) edge.inactiveReason = inactiveReason;
        edges.push(edge);
      }
    });

    if (groups.length > 1) {
      addFinding({
        id: 'ROUTES.PRIORITY_ACTIVATION', severity: 'info', basis: 'model',
        cite: ['ROUTES.PRIORITY_26AI', 'ROUTES.PRIORITY_19C_EX_4_3'],
        subject: { kind: 'route', id: sender.id as string },
        message: `Group selection on ${sender.name}: the lowest priority number whose destinations are all up, otherwise the lowest with at least one up.`,
        note: 'The grammar and the priority range are documented; which group the broker activates when a group is partly up is not, so this rule is the page\'s model.',
      });
    }
  }

  /* ---- BFS from the primary over active, up edges ---- */
  const members: Record<MemberId, ResolvedMember> = {};
  const depth = new Map<string, number>();
  const path = new Map<string, MemberId[]>();
  const inXpt = new Map<string, XptMode>();

  depth.set(primary as string, 0);
  path.set(primary as string, [primary]);

  const queue: MemberId[] = [primary];
  const visiting = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift() as MemberId;
    visiting.add(cur as string);
    const out = edges.filter((e) => e.from === cur && e.active && e.up);
    for (const e of out) {
      if (depth.has(e.to as string)) {
        const feed = path.get(cur as string) ?? [];
        if (feed.includes(e.to)) {
          addFinding({
            id: 'ROUTES.CYCLE', severity: 'error', basis: 'model', cite: ['ROUTES.RULE_ACTIVE'],
            subject: { kind: 'route', id: e.to as string },
            message: `The routing rules feed ${e.to} from itself (${[...feed, e.to].join(' -> ')}).`,
            note: 'Oracle documents no cycle rule for RedoRoutes; treating a cycle as an error is this page\'s model.',
          });
        }
        continue;
      }
      depth.set(e.to as string, (depth.get(cur as string) ?? 0) + 1);
      path.set(e.to as string, [...(path.get(cur as string) ?? [primary]), e.to]);
      inXpt.set(e.to as string, e.xpt);
      queue.push(e.to);
    }
  }

  const maxDepth = Math.max(0, ...[...depth.values()]);
  if (maxDepth >= 2) {
    addFinding({
      id: 'ROUTES.CASCADE_DEPTH_UNDOC', severity: 'info', basis: 'model',
      cite: ['CASCADE.TERMINAL_INDIRECT', 'CASCADE.THIRTY_TERMINAL'],
      subject: { kind: 'config' },
      message: 'Redo reaches at least one member through another member; Oracle documents no limit on how deep cascading may go.',
      note: 'The 30-terminal-destination fan-out is documented; a depth limit is not, so this engine imposes none and says so.',
    });
  }

  const mode = doc.config.protectionMode;
  for (const m of doc.members) {
    const d = depth.get(m.id as string);
    const feed = path.get(m.id as string) ?? [];
    const xpt = inXpt.get(m.id as string) ?? null;
    const directEdge = edges.find(
      (e) => e.from === primary && e.to === m.id && e.active && e.up,
    );
    const rm: ResolvedMember = {
      id: m.id,
      reachableFromPrimary: d !== undefined,
      depth: d === undefined ? -1 : d,
      feedPath: feed,
      effectiveXpt: m.id === primary ? null : xpt,
      synchronized: synchronizedClaim(doc, m, primary, d, feed, directEdge, edges),
      countsTowardProtectionAck: ackClaim(m, primary, mode, directEdge),
    };
    members[m.id] = rm;
  }

  const protectionLevel = levelClaim(doc, members, mode);

  return { primary, edges, members, protectionLevel, findings };
}

/* ---------------- destination candidates ---------------- */

function candidatesFor(
  doc: TopologyDoc,
  net: NetState,
  primary: MemberId,
  sender: Member,
  g: DestGroup,
  byId: Map<string, Member>,
  opts: ResolveOptions,
  addFinding: (f: Finding) => void,
): CandidateDest[] {
  const out: CandidateDest[] = [];
  const push = (
    target: MemberId, d: RouteDest, viaAlternate: boolean, superseded = false,
  ): void => {
    const receiver = byId.get(target as string);
    if (!receiver || !receiver.enabled) return;
    const xptFromRule = viaAlternate ? d.alt?.xpt : d.xpt;
    const c: CandidateDest = {
      to: target,
      xpt: xptFromRule ?? receiver.logXptMode,
      xptSource: xptFromRule ? 'rule-attribute' : 'dest-logxptmode',
      viaAlternate,
    };
    if (superseded) c.supersededByAlternate = true;
    out.push(c);
  };

  for (const d of g.dests) {
    if (d.target === 'ALL') {
      for (const t of expandAll(doc, sender.id, primary)) push(t, d, false);
      continue;
    }
    const target = d.target;
    const disabled = opts.disabledDests?.has(destKey(sender.id, target)) ?? false;
    const latched = opts.altLatched?.has(destKey(sender.id, target)) ?? false;
    const receiver = byId.get(target as string);
    const unreachable = receiver ? !memberAlive(doc, net, receiver) : true;
    const useAlt = !!d.alt && (disabled || unreachable || latched);
    if (useAlt && d.alt) {
      push(d.alt.target, d, true);
      addFinding({
        id: 'ROUTES.ALT_ACTIVATION', severity: 'info', basis: 'model',
        cite: ['ROUTES.GRAMMAR_121', 'ROUTES.ALT_MAXFAILURE', 'FS.FAILURE_ADD_DEST'],
        subject: { kind: 'route', id: sender.id as string },
        message: `${sender.name} is shipping to the alternate ${d.alt.target} instead of ${target}.`,
        note: 'The alternate form and its MaxFailure precondition are documented; the exact instant the broker swaps over, and when FALLBACK reverts, are not, so the switch-over point here is this page\'s model. Where the alternate is ASYNC the documented consequence applies: the protection level is reduced.',
      });
      /* The named destination still gets an edge, marked as stood down. */
      push(target, d, false, true);
      continue;
    }
    push(target, d, false);
  }
  return out;
}

/**
 * Group selection (model): the lowest priority number whose destinations are
 * all up, else the lowest with at least one up, else the lowest declared.
 */
function chooseGroup(
  groups: readonly DestGroup[],
  candidates: readonly CandidateDest[][],
  sender: Member,
  byId: Map<string, Member>,
  doc: TopologyDoc,
  net: NetState,
  reach: ReturnType<typeof buildReachability>,
): number {
  const order = groups
    .map((g, i) => ({ i, p: g.priority ?? defaultGroupPriority(sender) }))
    .sort((a, b) => a.p - b.p || a.i - b.i);

  const upCount = (gi: number): { up: number; total: number } => {
    const cands = (candidates[gi] ?? []).filter((c) => !c.supersededByAlternate);
    let up = 0;
    for (const c of cands) {
      const receiver = byId.get(c.to as string);
      if (!receiver) continue;
      if (memberAlive(doc, net, receiver) && membersReachable(doc, net, sender, receiver, reach)) up++;
    }
    return { up, total: cands.length };
  };

  for (const { i } of order) {
    const { up, total } = upCount(i);
    if (total > 0 && up === total) return i;
  }
  for (const { i } of order) {
    if (upCount(i).up > 0) return i;
  }
  return order[0]?.i ?? 0;
}

function edgeRole(sender: Member, receiver: Member, primary: MemberId): EdgeRole {
  if (sender.id === primary) return isFarSync(receiver) ? 'primary-to-farsync' : 'primary-direct';
  if (isFarSync(sender)) return 'farsync-onward';
  return 'cascade';
}

/* ---------------- claims ---------------- */

const lagGated = (doc: TopologyDoc): boolean => {
  const mode = doc.config.protectionMode;
  if (mode === 'MAXPERFORMANCE') return true;
  return doc.config.edition === '26ai'
    && mode === 'MAXAVAILABILITY'
    && doc.config.fsfo.lagLimitSeconds > 0;
};

/**
 * FastStartFailoverLagType is documented as maximum-performance-mode
 * behaviour and did not follow the lag limit into maximum availability under
 * 26ai, so TRANSPORT is honoured there only; anything else reads APPLY.
 */
function effectiveLagTypeOf(doc: TopologyDoc): 'APPLY' | 'TRANSPORT' {
  const is26 = doc.config.edition === '26ai';
  const maxperf = doc.config.protectionMode === 'MAXPERFORMANCE';
  return is26 && maxperf && doc.config.fsfo.lagType === 'TRANSPORT' ? 'TRANSPORT' : 'APPLY';
}

function gateLagOf(doc: TopologyDoc, m: Member): number {
  const apply = isDatabase(m) ? m.applyLagSeconds : m.transportLagSeconds;
  if (effectiveLagTypeOf(doc) !== 'TRANSPORT') return apply;
  return Math.max(0, Math.min(m.transportLagSeconds, apply));
}

function synchronizedClaim(
  doc: TopologyDoc,
  m: Member,
  primary: MemberId,
  depth: number | undefined,
  feedPath: readonly MemberId[],
  directEdge: RedoEdge | undefined,
  edges: readonly RedoEdge[],
): Claim<boolean> {
  if (m.id === primary) {
    return documented(true, ['MAXAVAIL.AT_LEAST_ONE'], 'The primary is the source of the redo.');
  }
  if (depth === undefined) {
    return documented(false, ['MAXAVAIL.AT_LEAST_ONE'],
      'No active, up redo path reaches this member from the primary.');
  }

  if (lagGated(doc)) {
    const gate = gateLagOf(doc, m);
    const limit = doc.config.fsfo.lagLimitSeconds;
    return inferred(gate <= limit,
      ['FSFO.LAGLIMIT_MAXAVAIL_26AI', 'FSFO.LAGTYPE'],
      `This configuration gates on FastStartFailoverLagLimit rather than on a synchronized state: ${effectiveLagTypeOf(doc)} lag ${gate} s against a ${limit} s limit. Maximum performance mode has no SYNCHRONIZED state to report, so the readiness gate is what this flag carries.`);
  }

  /* Direct SYNC or FASTSYNC over a live link: the documented case.
     The transport lag is deliberately not consulted here. Under SYNC or
     FASTSYNC the commit waits for the destination's acknowledgement, so redo
     the standby has not received is not a state this transport can be in; the
     transport-lag input is the maximum performance TRANSPORT what-if, and it
     is read above, where FastStartFailoverLagLimit is the gate and
     FastStartFailoverLagType is TRANSPORT. */
  if (directEdge && directEdge.up) {
    const sync = directEdge.xpt === 'SYNC' || directEdge.xpt === 'FASTSYNC';
    if (sync) {
      return documented(true, ['XPT.TABLE_4_2', 'MAXAVAIL.AT_LEAST_ONE'],
        `${directEdge.xpt} transport direct from the primary: the commit waits for this destination's acknowledgement, so there is no redo it has not received.`);
    }
    return documented(false, ['XPT.TABLE_4_2'],
      'ASYNC transport: the primary never waits for this destination, so it is not synchronized.');
  }

  /* Across a far sync hop. */
  const via = feedPath.length >= 3 ? feedPath[feedPath.length - 2] : undefined;
  const viaMember = via ? doc.members.find((x) => x.id === via) : undefined;
  if (viaMember && isFarSync(viaMember)) {
    /* The primary-to-far-sync leg carries the guarantee; the onward leg only
       has to be up, because it is documented as ASYNC. */
    const firstHop = edges.find(
      (e) => e.from === feedPath[0] && e.to === feedPath[1] && e.active && e.up,
    );
    const legSync = !!firstHop && (firstHop.xpt === 'SYNC' || firstHop.xpt === 'FASTSYNC');
    const restUp = feedPath.slice(1).every((to, i) => edges.some(
      (e) => e.from === feedPath[i] && e.to === to && e.active && e.up,
    ));
    return model(
      legSync && restUp,
      'SYNC.ACROSS_FARSYNC: how SYNCHRONIZED is computed across a far sync hop is not documented. This engine reads the target as synchronized when the primary-to-far-sync leg is SYNC or FASTSYNC and up, and the far sync reaches the target -- the far sync holding all committed redo on disk is the documented half of that.',
      ['FS.SYNC_TO_FARSYNC', 'FSFO.FARSYNC_XPT'],
    );
  }

  /* Cascaded terminal standby. */
  return inferred(false, ['CASCADE.TERMINAL_INDIRECT', 'FSFO.TARGET_DIRECT_REDO'],
    'PROT.CASCADE_NOT_COUNTED: a terminal standby receives redo indirectly, and the fast-start failover prerequisite asks for redo received directly from the primary. Whether the protection mode considers cascaded destinations at all is not documented; this engine reads it as no.');
}

function ackClaim(
  m: Member,
  primary: MemberId,
  mode: ProtectionMode,
  directEdge: RedoEdge | undefined,
): Claim<boolean> {
  if (m.id === primary) {
    return documented(false, ['MAXAVAIL.AT_LEAST_ONE'], 'The primary does not acknowledge to itself.');
  }
  const acks = !!directEdge && directEdge.up
    && (directEdge.xpt === 'SYNC' || directEdge.xpt === 'FASTSYNC');
  if (!acks) {
    return documented(false, ['XPT.TABLE_4_2'],
      'Only a destination the primary ships to synchronously acknowledges a commit.');
  }
  if (isFarSync(m)) {
    if (mode === 'MAXPROTECTION') {
      return inferred(false, ['FS.MAXPROT_BROKER_19C'],
        'Maximum protection cannot be used if a far sync instance is the only member receiving redo synchronously, so a far sync acknowledgement alone does not hold the mode up. Whether it counts alongside a database is not stated; this engine counts only databases here.');
    }
    return inferred(true, ['FS.SYNC_TO_FARSYNC', 'FS.MAXPROT_BROKER_19C'],
      'A far sync instance holds all committed redo on disk, and maximum availability is the mode Oracle documents far sync for, so its acknowledgement is counted here.');
  }
  return documented(true, ['MAXAVAIL.AT_LEAST_ONE', 'XPT.TABLE_4_2'],
    'A synchronized standby acknowledging the primary is what the mode requires.');
}

function levelClaim(
  doc: TopologyDoc,
  members: Record<MemberId, ResolvedMember>,
  mode: ProtectionMode,
): Claim<ProtectionLevel> {
  const acks = Object.values(members).filter(
    (r) => r.countsTowardProtectionAck.value && r.synchronized.value,
  );
  if (mode === 'MAXPERFORMANCE') {
    return documented<ProtectionLevel>('MAXPERFORMANCE', ['XPT.TABLE_4_2'],
      'Maximum performance never waits for a destination.');
  }
  if (mode === 'MAXPROTECTION') {
    if (acks.length > 0) {
      return documented<ProtectionLevel>('MAXPROTECTION', ['MAXPROT.SHUTS_PRIMARY']);
    }
    return documented<ProtectionLevel>('MAXPROTECTION', ['MAXPROT.SHUTS_PRIMARY', 'MAXPROT.TWO_STANDBYS'],
      'No synchronized acknowledgement is left: maximum protection shuts the primary database down rather than allowing it to continue. Oracle recommends a minimum of two standby databases so that one failure cannot do this.');
  }
  if (acks.length > 0) {
    return documented<ProtectionLevel>('MAXAVAILABILITY', ['MAXAVAIL.AT_LEAST_ONE']);
  }
  return documented<ProtectionLevel>('MAXPERFORMANCE',
    ['MAXAVAIL.AT_LEAST_ONE', 'FS.FAILURE_ADD_DEST'],
    'Without an acknowledgement from at least one synchronized standby, maximum availability operates as if it were in maximum performance mode. When that acknowledgement went away with a far sync instance, the documented remedy is an additional destination straight to the terminal standby, which reduces the protection level because the redo then travels ASYNC.');
}
