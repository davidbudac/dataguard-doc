/**
 * The effective redo graph -- engine design SS3.
 *
 * Given a document and which member is primary, work out which routing rules
 * are active, which destinations they feed, what transport each hop uses, who
 * is reachable from the primary and what the resulting protection level is.
 *
 * Which destination of a parenthesised group carries the redo is documented
 * (Examples 1-4 of the Redo Routing Rules: one active path per group, lowest
 * PRIORITY number first, sticky among equals, every PRIORITY=8 destination at
 * once). Everything the docs do not state outright comes back as a Claim or a
 * Finding with a model label: the instant the primary moves within a group,
 * what SYNCHRONIZED means across a far sync hop, and what a far sync with a
 * NULL property forwards.
 */

import type { Edition, MemberId } from '../ids';
import { lagLimitOf } from '../defaults';
import type { Claim, Finding } from '../types/claims';
import { documented, inferred, model } from '../types/claims';
import type {
  DestGroup, Member, ProtectionMode, RedoRouteRule, RouteDest, TopologyDoc, XptMode,
} from '../types/topology';
import { isParenthesised } from './parse';
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
  /**
   * The destination each parenthesised group (keyed by `groupKey`) was
   * shipping to in the previous epoch. Among destinations of equal priority
   * the primary stays where it is: "Even after FS1 becomes active again, the
   * primary continues shipping to FS2 because FS1 and FS2 have the same
   * priority." The simulation carries it between epochs, as it does
   * `altLatched`; without it the first listed destination is the choice.
   */
  groupChoice?: Readonly<Record<string, MemberId>>;
}

/** PRIORITY=n default, from the kind of the DESTINATION: 1 for a far sync member, 8 otherwise. */
export const defaultDestPriority = (receiver: Member): number => (isFarSync(receiver) ? 1 : 8);

/** One parenthesised group of one rule at one member. */
export const groupKey = (from: MemberId, ruleIndex: number, groupIndex: number): string =>
  `${from as string}|${ruleIndex}|${groupIndex}`;

/** The rule whose source names the current primary, or undefined. */
export function activeRule(
  m: Member, primary: MemberId,
): { rule: RedoRouteRule; index: number } | undefined {
  const rules = m.redoRoutes.length > 0 || m.routesObserved ? m.redoRoutes : defaultRules(m);
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] as RedoRouteRule;
    if (ruleIsActive(r, m, primary)) return { rule: r, index: i };
  }
  return undefined;
}

/**
 * "A redo routing rule is active if its redo source field specifies the
 * current primary database." LOCAL is the local database; "The ANY keyword is
 * an alias for any database in the configuration", so an ANY rule is active
 * whoever is primary -- this member included.
 */
function ruleIsActive(r: RedoRouteRule, m: Member, primary: MemberId): boolean {
  if (r.source === 'LOCAL') return m.id === primary;
  if (r.source === 'ANY') return true;
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
 * "The ALL keyword is an alias for all possible destinations in the
 * configuration": every other enabled member, snapshot standbys included --
 * "Like a physical or logical standby database, a snapshot standby database
 * receives and archives redo data from a primary database." The current
 * primary is left out: redo travelling back to its own source is not a
 * destination, which is an inference from the grammar rather than a sentence.
 */
export function expandAll(doc: TopologyDoc, from: MemberId, primary: MemberId): MemberId[] {
  return enabledMembers(doc)
    .filter((m) => m.id !== from && m.id !== primary)
    .map((m) => m.id);
}

interface CandidateDest {
  to: MemberId;
  xpt: XptMode;
  xptSource: 'rule-attribute' | 'dest-logxptmode';
  /** PRIORITY=n as written, else the destination-kind default. */
  priority: number;
  viaAlternate: boolean;
  /** The named destination an active alternate is standing in for. */
  supersededByAlternate?: boolean;
  /** Came from ALL, which is never inside a group: always its own path. */
  fromAll?: boolean;
  /** Disabled at MaxFailure and not brought back by FALLBACK. */
  disabled: boolean;
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
  const groupChoice: Record<string, MemberId> = {};

  for (const sender of enabledMembers(doc)) {
    if (isFarSync(sender) && sender.redoRoutes.length === 0 && !sender.routesObserved) {
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
        id: 'ROUTES.ANY_SEMANTICS', severity: 'info', basis: 'documented',
        cite: ['ROUTES.ANY_ALIAS', 'ROUTES.RULE_ACTIVE'],
        subject: { kind: 'route', id: sender.id as string },
        message: `The ANY source on ${sender.name} names any database in the configuration, so the rule is active whichever database is primary -- ${sender.name} included.`,
      });
    }

    const groups = act.rule.groups;
    groups.forEach((g, gi) => {
      const cands = candidatesFor(doc, net, primary, sender, g, byId, opts, addFinding);
      const receiverOf = (c: CandidateDest): Member | undefined => byId.get(c.to as string);
      const usable = (c: CandidateDest): boolean => {
        const r = receiverOf(c);
        return !!r && !c.disabled && linkUp(sender, r);
      };

      /* Which candidates carry redo. Unparenthesised destinations, ALL and
         the alternate pairs are each a path of their own; a parenthesised
         group has one active path, chosen by PRIORITY. */
      const chosen = new Set<CandidateDest>();
      const slots = cands.filter((c) => !c.supersededByAlternate && !c.fromAll);
      if (!isParenthesised(g)) {
        for (const c of slots) chosen.add(c);
      } else if (slots.length > 0) {
        const key = groupKey(sender.id, act.index, gi);
        const live = slots.filter(usable);
        const pool = live.length > 0 ? live : slots.filter((c) => !c.disabled);
        const from = pool.length > 0 ? pool : slots;
        const best = Math.min(...from.map((c) => c.priority));
        if (best === 8) {
          /* "If a primary ships redo to a destination with PRIORITY=8, then
             it must ship to every PRIORITY=8 destination." */
          for (const c of slots) if (c.priority === 8 && !c.disabled) chosen.add(c);
          if (chosen.size === 0) for (const c of from) if (c.priority === 8) chosen.add(c);
        } else {
          const top = from.filter((c) => c.priority === best);
          const prev = opts.groupChoice?.[key];
          const pick = top.find((c) => c.to === prev) ?? top[0] as CandidateDest;
          chosen.add(pick);
          if (usable(pick)) groupChoice[key] = pick.to;
        }
        if (slots.length > 1) {
          addFinding({
            id: 'ROUTES.GROUP_SELECTION', severity: 'info', basis: 'documented',
            cite: ['ROUTES.ONE_PATH_PER_GROUP', 'ROUTES.PRIORITY_EX1', 'ROUTES.PRIORITY_EX2_STICKY', 'ROUTES.PRIORITY_8', 'ROUTES.PRIORITY_26AI'],
            subject: { kind: 'route', id: sender.id as string },
            message: `Each parenthesised group on ${sender.name} has one active redo path: the usable destination with the lowest PRIORITY number (1 for a far sync destination and 8 otherwise when none is written); among equal priorities the primary stays where it is, and when 8 is the best on offer every PRIORITY=8 destination is shipped to.`,
          });
          addFinding({
            id: 'ROUTES.GROUP_SWITCH_INSTANT', severity: 'info', basis: 'model',
            cite: ['ROUTES.PRIORITY_EX1', 'DEST.GROUP_PRIORITY_REENTER'],
            subject: { kind: 'route', id: sender.id as string },
            message: `${sender.name} moves to the next destination of a group in the same epoch the active one becomes unreachable, and back as soon as a better one is usable again.`,
            note: 'Which destination of a group is shipped to is documented; the instant the primary moves -- after how many failed attempts, and how soon it notices a higher priority destination is back -- is not stated in the RedoRoutes examples, so the switching point here is this page\'s model.',
          });
        }
      }

      for (const c of cands) {
        const receiver = receiverOf(c);
        if (!receiver) continue;
        const up = linkUp(sender, receiver);
        const active = c.fromAll || chosen.has(c);
        /* MaxFailure comes first, because it is the reason that outlives the
           others: a disabled destination is not standing by and is not merely
           down -- there is no further access to it until it is manually
           reenabled, which is also why the alternate beside it stays in. */
        let inactiveReason: EdgeInactiveReason | undefined;
        if (c.disabled) inactiveReason = 'max-failure-disabled';
        else if (c.supersededByAlternate) inactiveReason = 'alternate-standby';
        else if (!active) inactiveReason = 'group-standby';
        else if (!up) inactiveReason = 'destination-down';
        const edge: RedoEdge = {
          from: sender.id,
          to: c.to,
          xpt: c.xpt,
          xptSource: c.xptSource,
          ruleIndex: act.index,
          groupIndex: gi,
          priority: c.priority,
          role: edgeRole(sender, receiver, primary),
          active: active && !c.disabled && !c.supersededByAlternate,
          up,
        };
        if (inactiveReason) edge.inactiveReason = inactiveReason;
        edges.push(edge);
      }
    });
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
      countsTowardProtectionAck: ackClaim(m, primary, mode, directEdge, doc.config.edition),
    };
    members[m.id] = rm;
  }

  const protectionLevel = levelClaim(doc, members, mode);

  const out: RedoGraph = { primary, edges, members, protectionLevel, findings };
  if (Object.keys(groupChoice).length > 0) out.groupChoice = groupChoice;
  return out;
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
    target: MemberId, d: RouteDest, viaAlternate: boolean,
    extra: { superseded?: boolean; fromAll?: boolean; disabled?: boolean; priorityOf?: Member } = {},
  ): void => {
    const receiver = byId.get(target as string);
    if (!receiver || !receiver.enabled) return;
    const xptFromRule = viaAlternate ? d.alt?.xpt : d.xpt;
    const c: CandidateDest = {
      to: target,
      xpt: xptFromRule ?? receiver.logXptMode,
      xptSource: xptFromRule ? 'rule-attribute' : 'dest-logxptmode',
      priority: d.priority ?? defaultDestPriority(extra.priorityOf ?? receiver),
      viaAlternate,
      disabled: extra.disabled ?? false,
    };
    if (extra.superseded) c.supersededByAlternate = true;
    if (extra.fromAll) c.fromAll = true;
    out.push(c);
  };

  for (const d of g.dests) {
    if (d.target === 'ALL') {
      for (const t of expandAll(doc, sender.id, primary)) {
        push(t, d, false, { fromAll: true, disabled: opts.disabledDests?.has(destKey(sender.id, t)) ?? false });
      }
      continue;
    }
    const target = d.target;
    const receiver = byId.get(target as string);
    const disabled = opts.disabledDests?.has(destKey(sender.id, target)) ?? false;
    const latched = opts.altLatched?.has(destKey(sender.id, target)) ?? false;
    const alive = receiver ? memberAlive(doc, net, receiver) : false;
    /* 12.1: "The optional FALLBACK keyword is used to specify that redo
       transport to the non-alternate member should be resumed if it becomes
       available" -- so with FALLBACK the named destination comes back once it
       is up again, even from MaxFailure; without it the alternate latches. */
    const fallsBack = !!d.alt && d.alt.fallback === true && disabled && alive && !latched;
    const useAlt = !!d.alt && (latched || !alive || (disabled && !fallsBack));
    if (useAlt && d.alt) {
      push(d.alt.target, d, true, {
        disabled: opts.disabledDests?.has(destKey(sender.id, d.alt.target)) ?? false,
        ...(receiver ? { priorityOf: receiver } : {}),
      });
      addFinding({
        id: 'ROUTES.ALT_ACTIVATION', severity: 'info', basis: 'model',
        cite: ['ROUTES.GRAMMAR_121', 'ROUTES.ALT_MAXFAILURE', 'ROUTES.FALLBACK_121', 'FS.FAILURE_ADD_DEST'],
        subject: { kind: 'route', id: sender.id as string },
        message: `${sender.name} is shipping to the alternate ${d.alt.target} instead of ${target}.`,
        note: 'The ALT form, its MaxFailure precondition and FALLBACK are documented in the 12.1 broker guide only; the 12.2, 19c and 26ai grammar no longer carries them. 12.1 says the alternate takes the redo once the MaxFailure count is reached for the named member; this page swaps in the epoch the named member becomes unreachable, so the switch-over point is this page\'s model. Where the alternate is ASYNC the documented consequence applies: the protection level is reduced.',
      });
      /* The named destination still gets an edge, marked as stood down. */
      push(target, d, false, { superseded: true, disabled });
      continue;
    }
    push(target, d, false, { disabled: disabled && !fallsBack });
  }
  return out;
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
    && lagLimitOf(doc) > 0;
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
    const limit = lagLimitOf(doc);
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
  edition: Edition,
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
    /* ED-06: 26ai writes the far sync instance into maximum availability's
       own sentence; 19c's does not name it, so there it stays inferred. */
    if (mode === 'MAXAVAILABILITY' && edition === '26ai') {
      return documented(true, ['MAXAVAIL.FARSYNC_ACK_26AI', 'FS.SYNC_TO_FARSYNC'],
        'In maximum availability a transaction commits once its redo is on the standby redo log of at least one synchronized standby database or far sync instance, so the far sync acknowledgement counts.');
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
