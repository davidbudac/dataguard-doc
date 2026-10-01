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
 * These parameters affect only NEW connections; none of them touches an
 * established session. Sessions are lost when the database carrying them stops
 * serving or, on a RAC database, when the instance they sit on does (SIM-30:
 * "Any sessions active when the instance or service stops are terminated and
 * the application user is immediately notified"). Which instance carries them
 * is this page's model (`APP.SESSION_SPREAD`).
 */

import { NOMINAL } from '../defaults';
import type { ApplicationId, HostId, MemberId, Seconds, SiteId } from '../ids';
import { buildReachability, hostUp, initialNetState, instanceKey, netFromSummary } from '../net/graph';
import type { Reachability } from '../net/graph';
import type { Claim } from '../types/claims';
import { documented, model } from '../types/claims';
import type { AnyState } from '../types/events';
import type {
  Application, ClientAddress, ClientDescriptor, Host, Site, TopologyDoc,
} from '../types/topology';
import { applicationClient, applicationsOf, declaredPrimary } from '../types/topology';
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

export type NoEventKind =
  | 'observer-lost' | 'switchover-refused' | 'continues' | 'stalled'
  /** The application's own host went down and never came back: nobody is dialling. */
  | 'app-down';

/**
 * One stretch of the run over which the application's picture does not change:
 * whether it is running, which member publishes the service where it can
 * reach it, and which member publishes it at all.
 */
export interface AppSpan {
  t0: Seconds;
  /** null on the last span: it runs to the horizon. */
  t1: Seconds | null;
  appUp: boolean;
  /** The member publishing the service at an address the application reaches. */
  serving: MemberId | null;
  /** That member's state -- a STALLED primary still publishes. */
  servingState: AnyState | null;
  /** A member publishing the service at a listed address, reachable or not. */
  published: MemberId | null;
  /**
   * Every member publishing the service at a listed address whose host is up,
   * once each, in the ADDRESS_LIST order of its first such address. Normally
   * one. Two while a manual failover's old primary stays open beside the new
   * one (FAILOVER.FORMER_PRIMARY_OPEN, this page's reading). `reached` says
   * whether the application can reach it. `serving` is the first reached
   * address's member and `published` the first address's member, unchanged.
   */
  publishers: AppPublisher[];
}

export interface AppPublisher {
  member: MemberId;
  /** That member's state -- a STALLED primary still publishes. */
  state: AnyState | null;
  /** The application is up and reaches an address of this member that publishes. */
  reached: boolean;
}

export interface AppClaims {
  /** Where the descriptor is dialled from: the application's host, or outside every site. */
  vantage: Claim<string>;
  /** The three nominal costs. */
  nominal: Claim<string>;
  timeouts: Claim<string>;
  retry: Claim<string>;
  refusal: Claim<string>;
  singleIp: Claim<string>;
  /** Only when LOAD_BALANCE is on: the dial order stops being the list order. */
  loadBalance?: Claim<string>;
  /** Only when FAILOVER is off: the ladder tries one address. */
  failoverOff?: Claim<string>;
  /** Only for a switchover: the old primary's sessions end at the conversion, with no draining drawn. */
  drain?: Claim<string>;
  /** Only when some stretch of the run has two publishers of the service at once. */
  overlap?: Claim<string>;
  /** Only when the sessions lost one instance of a database that kept serving. */
  instanceLoss?: Claim<string>;
  /** Only with `instanceLoss`: how the sessions were spread over the instances. */
  sessionSpread?: Claim<string>;
  /** Only when a primary is STALLED while the service is published: that it still accepts logons. */
  stalledLogons?: Claim<string>;
}

/**
 * The sessions lost one instance of a database that went on serving: the
 * connect string dials on to a surviving instance.
 */
export interface InstanceLoss {
  member: MemberId;
  /** The instance (SID) the sessions were on and that stopped serving. */
  instance: string;
  /** The instance the connect string reached; null when it never connected. */
  to: string | null;
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
  /** Which application this is the view of; null for the descriptor dialled from outside every site. */
  application: { id: ApplicationId; name: string } | null;
  /** Where the application stands; null when it has no application. */
  placed: { host: HostId; site: SiteId } | null;
  /** When the application's own host first went down; null when it never did. */
  appDownAt: Seconds | null;
  /** The run as the application sees it, stretch by stretch. */
  spans: AppSpan[];
  /**
   * When the established sessions lose their database; null when they never do.
   * That is the loss the ladder starts from, and it is not always the service
   * going away: with two databases publishing, the sessions' own can go down
   * while the other keeps the service published.
   */
  lostAt: Seconds | null;
  /** Set when the loss is one instance of a RAC database that kept serving; null otherwise. */
  instanceLoss: InstanceLoss | null;
  /**
   * The member the established sessions are on before the loss (or throughout,
   * when there is none); null when nothing served at the start.
   */
  sessionsOn: MemberId | null;
  /**
   * Another member already publishing the service within the application's
   * reach at the instant the sessions lost theirs; null in every run where the
   * loss is the service going away.
   */
  servedAtLoss: MemberId | null;
  /**
   * The configuration as declared, before anything was injected: what the
   * pre-roll of a drawing shows. A trace opens on its first event, so its
   * first span is already the failure.
   */
  steady: Omit<AppSpan, 't0' | 't1'>;
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

/**
 * With the application drawn on a host of its own, the question is asked of
 * the same network the databases and the observers live on: an address answers
 * when the application's host can reach that host.
 */
const placedVantage = (host: string, site: string): Claim<string> => model<string>(
  `the application dials from ${host} in ${site}`,
  "APP.CLIENT_PLACED: an address is dialable when its host is up and the application's host reaches it -- inside one data centre always, across two only over a link between them that is up, because no host here forwards traffic for another. An address the application cannot reach at all drops the packets and costs a TRANSPORT_CONNECT_TIMEOUT, whatever the dead-address toggle says. While the application's own host is down nothing is dialled.",
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
  'a listener that does not offer the role-based service answers at once that it is not there (ORA-12514), and the client tries the next address',
  ['ORA.12514', 'CLIENT.LISTENER_ANSWERS_IMMEDIATELY'],
);

const SINGLE_IP = model<string>(
  'one IP address per host, one address per node',
  'TRANSPORT_CONNECT_TIMEOUT applies per ADDRESS and per IP address a host name resolves to. The engine draws single-IP hosts, so one address costs one timeout. It also dials one address per node, where the HA guide\'s string for a cluster names one SCAN: \"each IP in the SCAN address is expanded internally into a separate ADDRESS string\", so a SCAN of three IPs is three dials, as three nodes are here. The tnsnames card writes the SCAN form.',
  ['CLIENT.SCAN_EXPANDED'],
);

/**
 * A RAC database lost one instance and went on serving. What Oracle says is
 * about the instance's own sessions; where the sessions were is this page's.
 */
const INSTANCE_LOSS = documented<string>(
  'the sessions on the stopped instance are terminated and the application is notified; with TAF off only a client of that instance receives an error, and the connect string uses the next address at once',
  ['RAC.SESSIONS_TERMINATED', 'RAC.FAN_IN_FLIGHT', 'RAC.TAF_ERROR_ONLY', 'CLIENT.VIP_NEXT_ADDRESS'],
  'Application Continuity, if enabled, could protect incomplete transactions; this page draws none, and no TAF.',
);

const sessionSpread = (loadBalance: boolean): Claim<string> => model<string>(
  loadBalance
    ? 'the pooled sessions are spread over every instance the descriptor lists'
    : 'the pooled sessions sit on the first listed instance that publishes the service',
  loadBalance
    ? 'APP.SESSION_SPREAD: Oracle documents what happens to the sessions of an instance that stops, not how an application\'s sessions are spread over a cluster\'s instances. LOAD_BALANCE is on, so this page puts sessions on every listed instance of the database, and the first instance that stops takes its share with it; the drawing shows that loss as the application\'s pool emptying and being rebuilt. One loss is drawn: a later loss that takes the whole database is the outage the ladder starts from instead.'
    : 'APP.SESSION_SPREAD: Oracle documents what happens to the sessions of an instance that stops, not how an application\'s sessions are spread over a cluster\'s instances. With LOAD_BALANCE off the connect string tries the addresses in list order, so this page puts every session on the first listed instance that publishes, and its loss takes the pool with it; an instance further down the list stopping touches no session. One loss is drawn: a later loss that takes the whole database is the outage the ladder starts from instead.',
);

const STALLED_LOGONS = model<string>(
  'a STALLED primary still accepts new connections',
  'APP.STALLED_LOGONS: Oracle says the primary "stalls (no new transactions are able to commit)"; it says nothing about logons. This page keeps the listener answering and the service published while the primary is STALLED, so a connect succeeds and the commits behind it hang. A real stalled primary may behave differently at the logon.',
  ['OBS.LOSS_ALONE_STALLS_NOTHING'],
);

const FAILOVER_OFF = model<string>(
  'FAILOVER is off, so each traversal tries one address: the first in the list',
  'CLIENT.FAILOVER_OFF: with FAILOVER off "Oracle Net tries one protocol address". Which one is not stated; this page dials the first address of the list on every traversal, so a client whose first address is the failed primary never reaches the new one. RETRY_COUNT and RETRY_DELAY still repeat that one dial.',
  ['CLIENT.FAILOVER_OFF'],
);

const NO_DRAINING = model<string>(
  'a switchover ends the old primary\'s sessions as it converts; draining them first is not drawn',
  'SWITCHOVER.WAIT_DRAIN: Oracle\'s SWITCHOVER ... WAIT \"specifies that you want to wait for sessions to drain before proceeding with the switchover\" (19c, valid only for services configured for Application Continuity in Oracle Clusterware), and under 26ai the DrainTimeout property replaces it. This page draws no draining and no wait: the sessions end at the conversion, at once.',
  ['SWITCHOVER.SESSIONS_END', 'SWITCHOVER.WAIT_DRAIN', 'SWITCHOVER.DRAIN_TIMEOUT_26AI'],
);

const TWO_PUBLISHERS = model<string>(
  'two databases publish the role-based service at once',
  "APP.TWO_PUBLISHERS: the role-based service is taken as published wherever a database is open read-write (the page's NOMINAL_COSTS assumption), so while a manual failover's old primary stays open (FAILOVER.FORMER_PRIMARY_OPEN, this page's reading) both it and the new primary publish it. Established sessions stay on the database they are on. A new connection lands on the first address in ADDRESS_LIST order that publishes -- in a random order with LOAD_BALANCE on -- which may be either. When the database the sessions are on goes down they are lost, and the connect string reconnects to the next address that publishes. Oracle documents none of this for two open primaries; it is this page's model.",
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
  private readonly reach = new Map<string, Reachability>();
  /** The application's card, when it stands on a host that is still in the document. */
  readonly app: Application | null;

  constructor(private readonly doc: TopologyDoc, private readonly trace: Trace, a: Application | null) {
    this.app = a && doc.hosts.some((h) => h.id === a.host) ? a : null;
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

  /** The instance (SID) that runs on this host, when a member's does. */
  instanceOn(host: HostId): string | null {
    return this.instanceByHost.get(host as string) ?? null;
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

  /** Is the application itself running? Always, when it is not in the topology. */
  appUp(t: Seconds): boolean {
    return this.app === null || !this.hostDown(this.app.host, t);
  }

  /**
   * Is this address dialable at all? Up, and either reached by the
   * application's host or -- with no application drawn -- in a site that
   * still has a way out. See VANTAGE and `placedVantage`.
   */
  dialable(host: HostId, t: Seconds): boolean {
    if (this.hostDown(host, t)) return false;
    const h = this.hostById.get(host as string);
    if (!h) return false;
    if (this.app !== null) {
      return this.appUp(t) && this.reachAt(t, null).reachable(this.app.host, host);
    }
    return this.siteHasWayOut(h.site as string, this.netAt(t));
  }

  /**
   * Would the application's packets arrive were this host up? A dead host
   * behind a severed link cannot refuse anything: there is nobody on the far
   * side of the cut to answer. With no application drawn the answer is yes,
   * which leaves the dead-address toggle deciding, as it always has.
   */
  pathTo(host: HostId, t: Seconds): boolean {
    if (this.app === null) return true;
    if (!this.appUp(t)) return false;
    return this.reachAt(t, host).reachable(this.app.host, host);
  }

  /** Reachability in the epoch at `t`, optionally with one host brought back. */
  private reachAt(t: Seconds, revive: HostId | null): Reachability {
    const e = this.epochAt(t);
    const key = `${e ? e.t0 : 'none'}|${revive === null ? '' : revive as string}`;
    const hit = this.reach.get(key);
    if (hit) return hit;
    const net = netFromSummary(e?.net ?? { downHosts: [], downSites: [], downLinks: [], partitioned: false, downInstances: [] });
    if (revive !== null) {
      (net.downHosts as Set<HostId>).delete(revive);
      const site = this.hostById.get(revive as string)?.site;
      if (site !== undefined) (net.downSites as Set<SiteId>).delete(site);
    }
    const r = buildReachability(this.doc, net);
    this.reach.set(key, r);
    return r;
  }

  /** The state a member's lane is in at `t`. */
  stateOf(member: MemberId, t: Seconds): AnyState | null {
    const lane = this.laneByMember.get(member as string);
    return lane ? this.segmentAt(lane, t)?.state ?? null : null;
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
  /**
   * The application whose view this is: the descriptor is dialled from the host
   * it stands on. Absent, the descriptor is dialled from outside every data
   * centre. There is no default to a document's first application -- a caller
   * with several asks for each (`computeApps`).
   */
  application?: Application | null;
}

/**
 * Every application's view of the same run, one model each, in the order the
 * document lists them; empty when it draws none. Each dials the descriptor it
 * has (`applicationClient`), from the host it stands on.
 */
export function computeApps(trace: Trace, doc: TopologyDoc): AppModel[] {
  return applicationsOf(doc).map((application) =>
    computeApp(applicationClient(doc, application), trace, doc, { application }));
}

export function computeApp(
  client: ClientDescriptor, trace: Trace, doc: TopologyDoc, opts: AppOptions = {},
): AppModel {
  const REFUSE = NOMINAL.refuseSeconds;
  const ESTAB = NOMINAL.establishSeconds;
  const RST = NOMINAL.osRefuseSeconds;

  const reader = new TraceReader(doc, trace, opts.application ?? null);
  const addresses = opts.addresses ?? client.addresses;
  const rc = Math.max(0, client.retryCount);
  const rd = Math.max(0, client.retryDelaySeconds);
  const cap = client.connectTimeoutSeconds !== null && client.connectTimeoutSeconds > 0
    ? client.connectTimeoutSeconds
    : Infinity;
  const facts = trace.facts;

  const appHost = reader.app === null
    ? undefined : doc.hosts.find((h) => h.id === reader.app?.host);
  const placed = reader.app !== null && appHost !== undefined
    ? { host: appHost.id, site: appHost.site } : null;
  const claims: AppClaims = {
    vantage: placed !== null && appHost !== undefined
      ? placedVantage(appHost.name, doc.sites.find((x) => x.id === appHost.site)?.name ?? (appHost.site as string))
      : VANTAGE,
    nominal: NOMINAL_COSTS, timeouts: TIMEOUTS, retry: RETRY,
    refusal: REFUSAL, singleIp: SINGLE_IP,
    ...(client.loadBalance ? { loadBalance: LOAD_BALANCE } : {}),
    ...(client.failover ? {} : { failoverOff: FAILOVER_OFF }),
  };
  /* FAILOVER on walks the whole list; off, Oracle Net tries one address. */
  const dialed = client.failover ? addresses : addresses.slice(0, 1);

  /* How one address answers at one instant. A host that went down answers per
     the descriptor's dead-address behaviour; a host that is up but cut off can
     only drop, because there is nobody on the far side of the cut to refuse --
     which is why an isolated primary costs a full transport timeout even with
     the toggle set to RST. */
  const classify = (a: ClientAddress, t: Seconds): DialKind => {
    if (reader.hostDown(a.host, t)) {
      if (!reader.pathTo(a.host, t)) return 'timeout';
      return client.deadBehaviour === 'drop' ? 'timeout' : 'rst';
    }
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

  /* Whether some address of one member answers the role-based service in reach. */
  const memberServes = (m: MemberId, t: Seconds): boolean => reader.appUp(t)
    && addresses.some((a) => reader.memberOn(a.host) === m
      && reader.dialable(a.host, t) && reader.publishing(a.host, t));
  const serving = (t: Seconds): boolean => reader.appUp(t)
    && dialed.some((a) => reader.dialable(a.host, t) && reader.publishing(a.host, t));
  /* Every member publishing at a listed address on a host that is up, once
     each, in the order of the member's first such address. */
  const publishersAt = (t: Seconds): AppPublisher[] => {
    const out: AppPublisher[] = [];
    for (const a of addresses) {
      if (reader.hostDown(a.host, t) || !reader.publishing(a.host, t)) continue;
      const member = reader.memberOn(a.host);
      if (member === null || out.some((p) => p.member === member)) continue;
      out.push({ member, state: reader.stateOf(member, t), reached: memberServes(member, t) });
    }
    return out;
  };

  /* The steady state, read off the document: the declared primary publishes,
     and the application reaches it over the links as they are declared. */
  const primaryId = declaredPrimary(doc);
  const net0 = initialNetState(doc);
  const reach0 = buildReachability(doc, net0);
  const listed = (h: HostId): boolean => addresses.some((a) => a.host === h);
  const primaryHosts = (doc.members.find((m) => m.id === primaryId)?.instances ?? [])
    .map((i) => i.host).filter((h) => listed(h) && hostUp(doc, net0, h));
  const reached0 = reader.app === null
    ? primaryHosts.length > 0
    : primaryHosts.some((h) => reach0.reachable(reader.app?.host ?? h, h));
  const steady = {
    appUp: true,
    serving: reached0 ? primaryId : null,
    servingState: reached0 ? 'open-rw' as const : null,
    published: primaryHosts.length > 0 ? primaryId : null,
    publishers: primaryId !== null && primaryHosts.length > 0
      ? [{ member: primaryId, state: 'open-rw' as const, reached: reached0 }]
      : [],
  };

  /* When the established sessions lose their database; null = they never do.
     The sessions are on the member that serves them, and they are lost when
     that member stops serving -- not when the service stops being published
     anywhere, because another database may already be publishing it. Where no
     second member publishes the two readings are the same instant. */
  const bounds = reader.boundaries();
  /* The addresses the established sessions sit on (APP.SESSION_SPREAD, this
     page's model): the first listed address that publishes, or every listed
     address of the member with LOAD_BALANCE on. For a database of one instance
     that is the member itself, so the two readings of "lost" below coincide. */
  const carriersOf = (m: MemberId, t: Seconds | null): ClientAddress[] => {
    const live = addresses.filter((a) => reader.memberOn(a.host) === m
      && (t === null
        ? hostUp(doc, net0, a.host) && (reader.app === null || reach0.reachable(reader.app.host, a.host))
        : reader.dialable(a.host, t) && reader.publishing(a.host, t)));
    return client.loadBalance ? live : live.slice(0, 1);
  };
  let lost: Seconds | null = null;
  let instLost: { at: Seconds; host: HostId } | null = null;
  let cur: MemberId | null = steady.serving;
  let carriers: ClientAddress[] = cur === null ? [] : carriersOf(cur, null);
  for (const t of bounds) {
    if (cur !== null) {
      if (!memberServes(cur, t)) { lost = t; break; }
      /* The member still serves, but an instance the sessions were on may not. */
      if (instLost === null) {
        const gone = carriers.find((a) => !(reader.dialable(a.host, t) && reader.publishing(a.host, t)));
        if (gone !== undefined) instLost = { at: t, host: gone.host };
      }
      continue;
    }
    cur = publishersAt(t).find((p) => p.reached)?.member ?? null;
    if (cur === null) { lost = t; break; }
    carriers = carriersOf(cur, t);
  }
  /* A loss that takes the whole database is the outage the ladder starts from,
     as it always was; only where the database goes on serving is the loss of
     one instance the loss drawn. */
  const instanceLossAt: Seconds | null = lost === null && instLost !== null ? instLost.at : null;
  if (instanceLossAt !== null) lost = instanceLossAt;
  const sessionsOn = cur;
  const servedAtLoss = lost === null || sessionsOn === null ? null
    : publishersAt(lost).find((p) => p.reached && p.member !== sessionsOn)?.member ?? null;

  let appDownAt: Seconds | null = null;
  for (const t of bounds) { if (!reader.appUp(t)) { appDownAt = t; break; } }

  /* The run stretch by stretch, merged where nothing the application can see
     changed between two instants. */
  const spans: AppSpan[] = [];
  bounds.forEach((t, i) => {
    const up = reader.appUp(t);
    const reached = up
      ? addresses.find((a) => reader.dialable(a.host, t) && reader.publishing(a.host, t))
      : undefined;
    const anywhere = addresses.find((a) => !reader.hostDown(a.host, t) && reader.publishing(a.host, t));
    const servingId = reached ? reader.memberOn(reached.host) : null;
    const span: AppSpan = {
      t0: t, t1: bounds[i + 1] ?? null, appUp: up,
      serving: servingId,
      servingState: servingId === null ? null : reader.stateOf(servingId, t),
      published: anywhere ? reader.memberOn(anywhere.host) : null,
      publishers: publishersAt(t),
    };
    const prev = spans[spans.length - 1];
    if (prev && prev.appUp === span.appUp && prev.serving === span.serving
      && prev.servingState === span.servingState && prev.published === span.published
      && samePublishers(prev.publishers, span.publishers)) {
      prev.t1 = span.t1;
    } else {
      spans.push(span);
    }
  });
  if (spans.some((x) => x.publishers.length > 1)) claims.overlap = TWO_PUBLISHERS;
  if (facts.outcome === 'switchover' && !facts.blocked) claims.drain = NO_DRAINING;
  if (facts.outcome === 'stall-noone' || spans.some((x) => x.servingState === 'stalled')) {
    claims.stalledLogons = STALLED_LOGONS;
  }
  const instanceBase: Omit<InstanceLoss, 'to'> | null = instanceLossAt !== null && instLost !== null && sessionsOn !== null
    ? { member: sessionsOn, instance: reader.instanceOn(instLost.host) ?? (instLost.host as string) }
    : null;
  if (instanceBase !== null) {
    claims.instanceLoss = INSTANCE_LOSS;
    claims.sessionSpread = sessionSpread(client.loadBalance);
  }
  const shape = {
    application: reader.app === null ? null : { id: reader.app.id, name: reader.app.name },
    placed, appDownAt, spans, steady, sessionsOn, servedAtLoss,
    instanceLoss: instanceBase === null ? null : { ...instanceBase, to: null } as InstanceLoss | null,
  };

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
      startAt: 0, worst: 0, retryCost: 0, clipped: false, lostAt: null,
      ...axisFields(axis), ...shape, claims,
      /* Nothing was lost, so nothing was already serving at the loss. */
      servedAtLoss: null,
    };
  };

  /* With the application on a host of its own the question is what that host
     can see, so the outcome only names the kind of quiet: whenever the service
     stayed in its reach nothing happened to it, and whenever it did not there
     is a ladder to draw, whatever the broker decided. */
  if (placed !== null && lost === null) {
    if (facts.outcome === 'observer-lost') return noEvent('observer-lost');
    if (facts.outcome === 'switchover' && facts.blocked) return noEvent('switchover-refused');
    if (placed === null && facts.outcome === 'stall-noone') return noEvent('stalled');
    return noEvent('continues');
  }

  /* Observer lost: nothing fails over, so there is no connection story at all.
     The descriptor never has to move, address 1 answers as always, and no
     established session is touched. Same shape, every field neutral. */
  if (placed === null && facts.outcome === 'observer-lost') return noEvent('observer-lost');

  /* The broker refused the command, so nothing ever moved. */
  if (placed === null && facts.outcome === 'switchover' && facts.blocked) return noEvent('switchover-refused');

  /* A STALLED primary still runs its listener and still publishes the
     service in this drawing, so a new connection is accepted exactly as
     before (`STALLED_LOGONS`, a model: Oracle says only that no new
     transactions can commit). The outage is at commit level, one layer below
     anything this ladder can see. */
  if (facts.outcome === 'stall-noone') return noEvent('stalled');

  /* No role change, and the primary is still answering: the descriptor's
     first address keeps working and no client ever notices. This is the
     shape of every cell where the configuration simply carries on. */
  if (lost === null) return noEvent('continues');

  /* An application that is down dials nothing: the worst-case request is the
     first one it makes once its host is back, and there is none if it never is. */
  let startAt: Seconds | null = null;
  for (const t of bounds) { if (t >= lost && reader.appUp(t)) { startAt = t; break; } }
  if (startAt === null) return { ...noEvent('app-down'), startAt: lost, lostAt: lost };

  /* The worst-case traversal: every address answers, none of them connects.
     An address that would establish right now is charged a refusal, because
     the request this ladder draws is the one that dialled too early. */
  const plans: AddressPlan[] = dialed.map((a, index) => {
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
    for (let i = 0; i < dialed.length; i++) {
      const a = dialed[i] as ClientAddress;
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
  const winner = winningIndex(attempts, dialed, reader, bounds, serving);
  const retryCost = plans.slice(0, winner).reduce((s, p) => s + p.cost, 0) + ESTAB;
  const end = tConn !== null ? tConn : (gaveUp ?? startAt);

  /* Horizon: show the story, but never let a huge retry budget blow up the
     axis. Anything past the cap is clipped and annotated instead. */
  const capT = Math.max(160, (tService ?? 0) + 100);
  const initiateMark = facts.outcome === 'switchover' ? 0 : (facts.initiateAt ?? 0);
  const need = Math.max(Math.min(end, capT), initiateMark, tService ?? 0);
  const axis = secondsAxis(need);

  /* Where the connect string landed after the instance went. */
  const landed = attempts.find((x) => x.ok)?.dials.find((d) => d.kind === 'establish')?.host;
  const instanceLoss: InstanceLoss | null = instanceBase === null ? null
    : { ...instanceBase, to: landed === undefined ? null : reader.instanceOn(landed) };

  return {
    noEvent: false, noEventKind: null,
    switchover: facts.outcome === 'switchover', switchoverRefused: false,
    addresses: plans, d1, drop, refuse: REFUSE, estab: ESTAB, rst: RST,
    passCost, tService, attempts, tConn, gaveUp, startAt, worst, retryCost,
    clipped: end > axis.horizon, lostAt: lost,
    ...axisFields(axis), ...shape, instanceLoss, claims,
  };
}

const samePublishers = (a: readonly AppPublisher[], b: readonly AppPublisher[]): boolean =>
  a.length === b.length
  && a.every((p, i) => p.member === b[i]?.member && p.state === b[i]?.state && p.reached === b[i]?.reached);

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
