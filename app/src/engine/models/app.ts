/**
 * The application's view of the failure -- engine design SS6, ported from the
 * published fragment's APPMODEL block and generalised from two addresses to an
 * ADDRESS_LIST of N.
 *
 * The published model hard-coded "address 1 is the primary and it is dead,
 * address 2 is the standby and it refuses until the new primary opens". This
 * one classifies every address from the trace at the moment the client dials
 * it, which reproduces those numbers for the 1+1+1 deployment and says
 * something sensible about a list of five.
 *
 * Four classifications, and their costs are the page's nominal drawing
 * constants (footnote 3), never documented figures:
 *   `timeout`    the packets go nowhere: min(TRANSPORT_CONNECT_TIMEOUT, CONNECT_TIMEOUT)
 *   `rst`        the OS refuses on a dead host: 0.15 s
 *   `refuse`     the listener answers and has no such service: ORA-12514, 0.2 s
 *   `establish`  the read-write service is published there: 0.3 s
 *
 * These parameters affect only NEW connections. No established session is
 * touched by anything drawn here.
 */

import { NOMINAL } from '../defaults';
import { instanceKey } from '../net/graph';
import type { HostId, MemberId, Seconds } from '../ids';
import type { Claim } from '../types/claims';
import { documented, model } from '../types/claims';
import type {
  ClientAddress, ClientDescriptor, Host, Site, TopologyDoc,
} from '../types/topology';
import type { Epoch, Lane, Segment, Trace } from '../types/trace';
import type { AxisSpec } from './axis';
import { fixedAxis, secondsAxis } from './axis';

/* ---------------- shape ---------------- */

/** How one address answers a dial. */
export type DialKind = 'timeout' | 'rst' | 'refuse' | 'establish';

export interface AddressPlan {
  index: number;
  host: HostId;
  port: number;
  /** The member whose instance runs there, when the address names one. */
  member: MemberId | null;
  /**
   * The classification the budget is computed from: what this address does on
   * a traversal that does not connect. An address that would establish right
   * now still costs a refusal in the worst case, because the worst-case
   * request is the one that dials before the service is published.
   */
  kind: Exclude<DialKind, 'establish'>;
  cost: Seconds;
}

export interface Dial {
  index: number;
  host: HostId;
  kind: DialKind;
  at: Seconds;
  cost: Seconds;
  end: Seconds;
}

export interface AppAttempt {
  start: Seconds;
  /** The first address's end -- the published drawing's `a1End`. */
  a1End: Seconds;
  dials: Dial[];
  end: Seconds;
  ok: boolean;
}

export type NoEventKind = 'observer-lost' | 'switchover-refused' | 'continues' | 'stalled';

export interface AppClaims {
  /** Where the engine places the application tier, which is not in the topology. */
  vantage: Claim<string>;
  /** The three nominal costs. */
  nominal: Claim<string>;
  timeouts: Claim<string>;
  retry: Claim<string>;
  refusal: Claim<string>;
  singleIp: Claim<string>;
  /** Only when LOAD_BALANCE is on: the dial order stops being the list order. */
  loadBalance?: Claim<string>;
}

export interface AppModel {
  noEvent: boolean;
  noEventKind: NoEventKind | null;
  switchover: boolean;
  switchoverRefused: boolean;
  /** Every address, in the order the descriptor lists them. */
  addresses: AddressPlan[];
  /** The first address's worst-case cost -- the published drawing's `d1`. */
  d1: Seconds;
  /** True when the first address swallows the packets rather than refusing. */
  drop: boolean;
  refuse: Seconds;
  estab: Seconds;
  rst: Seconds;
  /** One whole traversal of the list, refusing everywhere. */
  passCost: Seconds;
  /** When the read-write service is published again; null when it never is. */
  tService: Seconds | null;
  attempts: AppAttempt[];
  tConn: Seconds | null;
  gaveUp: Seconds | null;
  /** When the worst-case request starts dialing: when the service goes away. */
  startAt: Seconds;
  /** The whole budget: (RETRY_COUNT + 1) traversals plus the delays between. */
  worst: Seconds;
  /** What an attempt started after the service returned still costs. */
  retryCost: Seconds;
  clipped: boolean;
  horizon: Seconds;
  preRoll: Seconds;
  tickStep: Seconds;
  claims: AppClaims;
}

/* ---------------- claims ---------------- */

/**
 * The application tier is not a node in the topology, so the engine has to
 * place it. It places it outside every data centre: an address answers when
 * its host is up and its site still has a way out, and a site whose links are
 * all cut is dialled into a black hole however healthy the database on it is.
 * That is the same question `primaryReachableFromOutside` asks in the
 * simulator, asked of every address instead of only the primary.
 */
const VANTAGE = model<string>(
  'the application tier sits outside every site',
  "APP.CLIENT_VANTAGE: clients are not in the topology, so the engine treats an address as dialable when its host is up and its site still has an up link to a live site. A fully isolated site drops the packets -- which is why an isolated primary costs a TRANSPORT_CONNECT_TIMEOUT even when the dead-address toggle says the OS would refuse. Under an explicit partition event the trace records only that the network was partitioned, not which side the application tier is on.",
);

const NOMINAL_COSTS = model<string>(
  'refusal 0.2 s, OS refusal 0.15 s, establish 0.3 s',
  'Nominal drawing constants (footnote 3), never documented figures. The role-based service is assumed published the instant the new primary opens read-write.',
);

const TIMEOUTS = documented<string>(
  'TRANSPORT_CONNECT_TIMEOUT 60 s per ADDRESS; CONNECT_TIMEOUT per ADDRESS with no default',
  ['CLIENT.TIMEOUTS'],
);

const RETRY = documented<string>(
  'RETRY_COUNT counts extra traversals of the whole list; FAILOVER is on by default',
  ['CLIENT.RETRY_AND_FAILOVER'],
);

const REFUSAL = documented<string>(
  'a role-based service that is not published is refused instantly with ORA-12514',
  ['ORA.12514'],
);

const SINGLE_IP = model<string>(
  'one IP address per host',
  'TRANSPORT_CONNECT_TIMEOUT applies per ADDRESS and per IP address a host name resolves to. The engine draws single-IP hosts, so one address costs one timeout.',
);

const LOAD_BALANCE = model<string>(
  'the descriptor is dialled in list order',
  'LOAD_BALANCE is on, so Oracle Net progresses through the addresses in a random order. The engine is deterministic and keeps the list order; the ladder below is one of the orders the client could take, not the only one.',
);

/* ---------------- the trace, read at a point in time ---------------- */

interface NetAt {
  downHosts: ReadonlySet<string>;
  downSites: ReadonlySet<string>;
  downLinks: ReadonlySet<string>;
}

/** The states in which a database still runs its listener and still publishes. */
const PUBLISHING = new Set<string>(['open-rw', 'stalled', 'commit-hang']);

class TraceReader {
  private readonly hostById = new Map<string, Host>();
  private readonly siteById = new Map<string, Site>();
  private readonly memberByHost = new Map<string, MemberId>();
  private readonly instanceByHost = new Map<string, string>();
  private readonly laneByMember = new Map<string, Lane>();

  constructor(private readonly doc: TopologyDoc, private readonly trace: Trace) {
    for (const h of doc.hosts) this.hostById.set(h.id as string, h);
    for (const s of doc.sites) this.siteById.set(s.id as string, s);
    for (const m of doc.members) {
      for (const i of m.instances) {
        if (!this.memberByHost.has(i.host as string)) {
          this.memberByHost.set(i.host as string, m.id);
          this.instanceByHost.set(i.host as string, i.name);
        }
      }
    }
    for (const l of trace.lanes) {
      if (l.subject.kind === 'member') this.laneByMember.set(l.subject.id, l);
    }
  }

  memberOn(host: HostId): MemberId | null {
    return this.memberByHost.get(host as string) ?? null;
  }

  /** Every instant at which an address could change its answer. */
  boundaries(): Seconds[] {
    const ts = new Set<number>([0]);
    for (const e of this.trace.epochs) ts.add(e.t0);
    for (const l of this.trace.lanes) for (const s of l.segments) ts.add(s.t0);
    return [...ts].sort((a, b) => a - b);
  }

  private epochAt(t: Seconds): Epoch | null {
    let best: Epoch | null = null;
    for (const e of this.trace.epochs) {
      if (e.t0 <= t + 1e-9) best = e; else break;
    }
    return best ?? (this.trace.epochs[0] ?? null);
  }

  private netAt(t: Seconds): NetAt {
    const e = this.epochAt(t);
    return {
      downHosts: new Set((e?.net.downHosts ?? []) as unknown as string[]),
      downSites: new Set((e?.net.downSites ?? []) as unknown as string[]),
      downLinks: new Set((e?.net.downLinks ?? []) as unknown as string[]),
    };
  }

  /** Is the host itself gone -- down, or in a site that is down? */
  hostDown(host: HostId, t: Seconds): boolean {
    const net = this.netAt(t);
    const h = this.hostById.get(host as string);
    if (!h) return true;
    return net.downHosts.has(host as string) || net.downSites.has(h.site as string);
  }

  /**
   * Is this address dialable at all? Up, and in a site that still has a way
   * out -- see VANTAGE.
   */
  dialable(host: HostId, t: Seconds): boolean {
    if (this.hostDown(host, t)) return false;
    const h = this.hostById.get(host as string);
    if (!h) return false;
    return this.siteHasWayOut(h.site as string, this.netAt(t));
  }

  private siteHasWayOut(site: string, net: NetAt): boolean {
    let declared = false;
    for (const l of this.doc.links) {
      if (l.scope === 'site') {
        const [a, b] = l.ends as [string, string];
        if (a !== site && b !== site) continue;
        declared = true;
        if (net.downLinks.has(l.id as string)) continue;
        const far = a === site ? b : a;
        if (!net.downSites.has(far)) return true;
        continue;
      }
      const [a, b] = l.ends as [string, string];
      const ha = this.hostById.get(a);
      const hb = this.hostById.get(b);
      if (!ha || !hb || ha.site === hb.site) continue;
      if ((ha.site as string) !== site && (hb.site as string) !== site) continue;
      declared = true;
      if (net.downLinks.has(l.id as string)) continue;
      const far = (ha.site as string) === site ? hb : ha;
      if (!net.downHosts.has(far.id as string) && !net.downSites.has(far.site as string)) return true;
    }
    /* A site with no links at all has nothing to lose. */
    return !declared;
  }

  /**
   * Is the read-write service published at this address right now? Not where
   * the RAC instance on this host is stopped: the listener answers and the
   * service is not registered with it.
   */
  publishing(host: HostId, t: Seconds): boolean {
    const member = this.memberOn(host);
    if (!member) return false;
    const inst = this.instanceByHost.get(host as string);
    const stopped = this.epochAt(t)?.net.downInstances ?? [];
    if (inst !== undefined && stopped.includes(instanceKey(member, inst))) return false;
    const lane = this.laneByMember.get(member as string);
    if (!lane) return false;
    const seg = this.segmentAt(lane, t);
    return seg !== null && PUBLISHING.has(seg.state);
  }

  private segmentAt(lane: Lane, t: Seconds): Segment | null {
    let found: Segment | null = null;
    for (const s of lane.segments) {
      if (s.t0 <= t + 1e-9 && (s.t1 === null || t < s.t1 - 1e-9)) found = s;
    }
    return found ?? lane.segments[lane.segments.length - 1] ?? null;
  }
}

/* ---------------- the model ---------------- */

export interface AppOptions {
  /** Addresses to dial; defaults to the descriptor's own list. */
  addresses?: ClientAddress[];
}

export function computeApp(
  client: ClientDescriptor, trace: Trace, doc: TopologyDoc, opts: AppOptions = {},
): AppModel {
  const REFUSE = NOMINAL.refuseSeconds;
  const ESTAB = NOMINAL.establishSeconds;
  const RST = NOMINAL.osRefuseSeconds;

  const reader = new TraceReader(doc, trace);
  const addresses = opts.addresses ?? client.addresses;
  const rc = Math.max(0, client.retryCount);
  const rd = Math.max(0, client.retryDelaySeconds);
  const cap = client.connectTimeoutSeconds !== null && client.connectTimeoutSeconds > 0
    ? client.connectTimeoutSeconds
    : Infinity;
  const facts = trace.facts;

  const claims: AppClaims = {
    vantage: VANTAGE, nominal: NOMINAL_COSTS, timeouts: TIMEOUTS, retry: RETRY,
    refusal: REFUSAL, singleIp: SINGLE_IP,
    ...(client.loadBalance ? { loadBalance: LOAD_BALANCE } : {}),
  };

  /* How one address answers at one instant. A host that went down answers per
     the descriptor's dead-address behaviour; a host that is up but cut off can
     only drop, because there is nobody on the far side of the cut to refuse --
     which is why an isolated primary costs a full transport timeout even with
     the toggle set to RST. */
  const classify = (a: ClientAddress, t: Seconds): DialKind => {
    if (reader.hostDown(a.host, t)) return client.deadBehaviour === 'drop' ? 'timeout' : 'rst';
    if (!reader.dialable(a.host, t)) return 'timeout';
    return reader.publishing(a.host, t) ? 'establish' : 'refuse';
  };

  const costOf = (kind: DialKind): Seconds => {
    switch (kind) {
      case 'timeout': return Math.min(client.transportConnectTimeoutSeconds, cap);
      case 'rst': return Math.min(RST, cap);
      case 'refuse': return REFUSE;
      case 'establish': return ESTAB;
    }
  };

  /* When the client loses the read-write service; null = it never does. */
  const serving = (t: Seconds): boolean =>
    addresses.some((a) => reader.dialable(a.host, t) && reader.publishing(a.host, t));
  const bounds = reader.boundaries();
  let lost: Seconds | null = null;
  for (const t of bounds) { if (!serving(t)) { lost = t; break; } }

  const noEvent = (kind: NoEventKind): AppModel => {
    const axis = fixedAxis(60);
    return {
      noEvent: true, noEventKind: kind,
      switchover: kind === 'switchover-refused' || facts.outcome === 'switchover',
      switchoverRefused: kind === 'switchover-refused',
      addresses: [], d1: 0,
      drop: kind === 'switchover-refused' ? false : client.deadBehaviour === 'drop',
      refuse: REFUSE, estab: ESTAB, rst: RST,
      passCost: 0, tService: null, attempts: [], tConn: null, gaveUp: null,
      startAt: 0, worst: 0, retryCost: 0, clipped: false,
      ...axisFields(axis), claims,
    };
  };

  /* Observer lost: nothing fails over, so there is no connection story at all.
     The descriptor never has to move, address 1 answers as always, and no
     established session is touched. Same shape, every field neutral. */
  if (facts.outcome === 'observer-lost') return noEvent('observer-lost');

  /* The broker refused the command, so nothing ever moved. */
  if (facts.outcome === 'switchover' && facts.blocked) return noEvent('switchover-refused');

  /* A STALLED primary still runs its listener and still publishes the
     service, so a new connection is accepted exactly as before. The outage
     is at commit level, one layer below anything this ladder can see. */
  if (facts.outcome === 'stall-noone') return noEvent('stalled');

  /* No role change, and the primary is still answering: the descriptor's
     first address keeps working and no client ever notices. This is the
     shape of every cell where the configuration simply carries on. */
  if (lost === null) return noEvent('continues');

  const startAt = lost;

  /* The worst-case traversal: every address answers, none of them connects.
     An address that would establish right now is charged a refusal, because
     the request this ladder draws is the one that dialled too early. */
  const plans: AddressPlan[] = addresses.map((a, index) => {
    const kind = classify(a, startAt);
    const pessimistic: Exclude<DialKind, 'establish'> = kind === 'establish' ? 'refuse' : kind;
    return {
      index, host: a.host, port: a.port, member: reader.memberOn(a.host),
      kind: pessimistic, cost: costOf(pessimistic),
    };
  });
  const passCost = plans.reduce((s, p) => s + p.cost, 0);
  const d1 = plans[0]?.cost ?? 0;
  const drop = plans[0]?.kind === 'timeout';

  /* The role-based service reappears when the new primary opens read-write.
     With no failover coming, it never does: the ladder runs its whole budget
     and gives up, which is the honest picture of an unreachable primary that
     nothing is going to replace. */
  let tService: Seconds | null = null;
  for (const t of bounds) { if (t >= startAt && serving(t)) { tService = t; break; } }

  const attempts: AppAttempt[] = [];
  let tConn: Seconds | null = null;
  let gaveUp: Seconds | null = null;
  let S = startAt;
  for (let k = 0; k <= rc; k++) {
    let t = S;
    const dials: Dial[] = [];
    let ok = false;
    for (let i = 0; i < addresses.length; i++) {
      const a = addresses[i] as ClientAddress;
      const kind = classify(a, t);
      const cost = costOf(kind);
      dials.push({ index: i, host: a.host, kind, at: t, cost, end: t + cost });
      t += cost;
      if (kind === 'establish') { ok = true; break; }
    }
    const first = dials[0];
    attempts.push({ start: S, a1End: first ? first.end : S, dials, end: t, ok });
    if (ok) { tConn = t; break; }
    if (k === rc) { gaveUp = t; break; }
    S = t + rd;
  }

  const worst = (rc + 1) * passCost + rc * rd;
  /* An attempt started after the service came back still pays every address
     ahead of the one that answers. */
  const winner = winningIndex(attempts, addresses, reader, bounds, serving);
  const retryCost = plans.slice(0, winner).reduce((s, p) => s + p.cost, 0) + ESTAB;
  const end = tConn !== null ? tConn : (gaveUp ?? startAt);

  /* Horizon: show the story, but never let a huge retry budget blow up the
     axis. Anything past the cap is clipped and annotated instead. */
  const capT = Math.max(160, (tService ?? 0) + 100);
  const initiateMark = facts.outcome === 'switchover' ? 0 : (facts.initiateAt ?? 0);
  const need = Math.max(Math.min(end, capT), initiateMark, tService ?? 0);
  const axis = secondsAxis(need);

  return {
    noEvent: false, noEventKind: null,
    switchover: facts.outcome === 'switchover', switchoverRefused: false,
    addresses: plans, d1, drop, refuse: REFUSE, estab: ESTAB, rst: RST,
    passCost, tService, attempts, tConn, gaveUp, startAt, worst, retryCost,
    clipped: end > axis.horizon,
    ...axisFields(axis), claims,
  };
}

const axisFields = (a: AxisSpec): Pick<AppModel, 'horizon' | 'preRoll' | 'tickStep'> =>
  ({ horizon: a.horizon, preRoll: a.preRoll, tickStep: a.tickStep });

/** Which address the connection lands on -- for the retry-cost annotation. */
function winningIndex(
  attempts: readonly AppAttempt[], addresses: readonly ClientAddress[],
  reader: TraceReader, bounds: readonly Seconds[], serving: (t: Seconds) => boolean,
): number {
  const last = attempts[attempts.length - 1];
  if (last?.ok) {
    const d = last.dials[last.dials.length - 1];
    if (d) return d.index;
  }
  for (const t of bounds) {
    if (!serving(t)) continue;
    const i = addresses.findIndex((a) => reader.dialable(a.host, t) && reader.publishing(a.host, t));
    if (i >= 0) return i;
  }
  return Math.max(0, addresses.length - 1);
}
