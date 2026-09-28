/**
 * Topology data model -- engine design SS1.
 *
 * Everything here is plain JSON-shaped data: the document is what the URL, the
 * file and localStorage carry, and what every pure function in the engine reads.
 */

import type {
  Edition, HostId, LinkId, MemberId, Millis, ObserverId, Seconds, SiteId,
} from '../ids';
import type { TimedEvent } from './events';

/* ---------------- SS1.2 sites, hosts, links ---------------- */

export interface Site {
  id: SiteId;
  name: string;
}

export interface Host {
  id: HostId;
  name: string;
  site: SiteId;
  /** Cluster name when the host is a RAC node; observers may not share it. */
  cluster?: string;
  listenerPort: number;
}

export type LinkScope = 'site' | 'host';

export interface Link {
  id: LinkId;
  /** Both ends are sites when scope is 'site', hosts when it is 'host'. */
  ends: [SiteId, SiteId] | [HostId, HostId];
  scope: LinkScope;
  rttMs: Millis;
  up: boolean;
  bandwidthMbit?: number;
}

/* ---------------- SS1.3 members ---------------- */

export type MemberKind = 'database' | 'farsync';
export type DbRole = 'primary' | 'physical' | 'logical' | 'snapshot';
export type XptMode = 'SYNC' | 'FASTSYNC' | 'ASYNC';
export type OpenMode = 'mount' | 'read-only-adg' | 'read-write';

export interface Instance {
  name: string;
  host: HostId;
}

export interface DestProps {
  netTimeoutSeconds: Seconds;
  reopenSeconds: Seconds;
  maxFailure: number;
  affirm?: 'AFFIRM' | 'NOAFFIRM';
}

/* ---- SS1.4 RedoRoutes ---- */

export type RoutePriority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface RouteAlternate {
  target: MemberId;
  xpt?: XptMode;
  fallback?: boolean;
}

export interface RouteDest {
  target: 'ALL' | MemberId;
  xpt?: XptMode;
  alt?: RouteAlternate;
}

export interface DestGroup {
  /** Default 1 for far sync members, 8 otherwise. */
  priority?: RoutePriority;
  dests: RouteDest[];
  /** True when the group was written in the parenthesised PRIORITY spelling. */
  explicitGroup?: boolean;
}

export interface RedoRouteRule {
  source: 'LOCAL' | 'ANY' | MemberId[];
  groups: DestGroup[];
}

export interface MemberBase {
  id: MemberId;
  kind: MemberKind;
  name: string;
  /** More than one instance is RAC. */
  instances: Instance[];
  connectIdentifier: string;
  enabled: boolean;
  /** Per receiving member. */
  dests: Record<MemberId, DestProps>;
  /** [] means the property is NULL. */
  redoRoutes: RedoRouteRule[];
  /** Imported current routes: an empty list means no observed route, not broker NULL. */
  routesObserved?: true;
  /** As a receiver; broker default ASYNC. */
  logXptMode: XptMode;
}

export interface DatabaseMember extends MemberBase {
  kind: 'database';
  role: DbRole;
  flashbackOn: boolean;
  applyLagSeconds: Seconds;
  /** Clamped to at most the apply lag. */
  transportLagSeconds: Seconds;
  applyRunning: boolean;
  realTimeApply: boolean;
  openMode: OpenMode;
  staticServices: boolean;
}

/** No role, no apply lag, no open mode, no broker state. */
export interface FarSyncMember extends MemberBase {
  kind: 'farsync';
  transportLagSeconds: Seconds;
}

export type Member = DatabaseMember | FarSyncMember;

export const isDatabase = (m: Member): m is DatabaseMember => m.kind === 'database';
export const isFarSync = (m: Member): m is FarSyncMember => m.kind === 'farsync';

/* ---------------- SS1.5 observers ---------------- */

export interface Observer {
  id: ObserverId;
  name: string;
  host: HostId;
  role: 'master' | 'backup';
  /** START OBSERVER ... FILE IS -- never FILE=. */
  fileIs?: string;
  logfileIs?: string;
  connectIdentifier?: string;
  running: boolean;
}

/* ---------------- SS1.6 configuration ---------------- */

export type ProtectionMode = 'MAXPROTECTION' | 'MAXAVAILABILITY' | 'MAXPERFORMANCE';

export type FsfoState = 'disabled' | 'enabled' | 'observe-only';

export type FsfoTarget =
  | { kind: 'list'; members: MemberId[] }
  | { kind: 'ANY' };

export type LagType = 'APPLY' | 'TRANSPORT';

export interface PreferredObserverHost {
  host: HostId;
  priority: RoutePriority;
}

export interface FsfoConfig {
  state: FsfoState;
  target: FsfoTarget;
  thresholdSeconds: Seconds;
  lagLimitSeconds: Seconds;
  lagType: LagType;
  lagGraceTimeSeconds: Seconds;
  /** Both non-null is the documented "explicitly set" pair. */
  pingIntervalMs: Millis | null;
  pingRetry: number | null;
  observerReconnectSeconds?: Seconds;
  observerConnectIdentifier?: string;
  pmyShutdown: boolean;
  autoReinstate: boolean;
  preferredObserverHosts?: PreferredObserverHost[];
}

export interface ServiceDef {
  name: string;
  role: 'PRIMARY' | 'PHYSICAL_STANDBY' | 'SNAPSHOT_STANDBY';
  members: MemberId[];
}

export interface Configuration {
  name: string;
  edition: Edition;
  protectionMode: ProtectionMode;
  configurationWideServiceName?: string;
  primaryDatabaseCandidates?: MemberId[];
  bystandersFollowRoleChange: 'ALL' | 'NONE';
  fsfo: FsfoConfig;
  services: ServiceDef[];
  /** v1 models the broker default only, and says so wherever a cell is asserted. */
  observerOverride: false;
}

export interface ClientAddress {
  host: HostId;
  port: number;
}

export interface ClientDescriptor {
  serviceName: string;
  addresses: ClientAddress[];
  transportConnectTimeoutSeconds: Seconds;
  /** No default: null is "not set". */
  connectTimeoutSeconds: Seconds | null;
  retryCount: number;
  retryDelaySeconds: Seconds;
  failover: boolean;
  loadBalance: boolean;
  deadBehaviour: 'drop' | 'rst';
}

export interface EnvironmentParams {
  roleTransitionSeconds: Seconds;
  localWriteMs: Millis;
  standbyWriteMs: Millis;
  redoRateMBs: number;
}

/* ---------------- SS1.7 document ---------------- */

export interface TopologyDoc {
  app: 'dg-topology';
  schema: 2;
  savedAt?: string;
  label?: string;
  sites: Site[];
  hosts: Host[];
  links: Link[];
  members: Member[];
  observers: Observer[];
  config: Configuration;
  client: ClientDescriptor;
  environment: EnvironmentParams;
  events: TimedEvent[];
}

/* ---------------- lookups ---------------- */

export const findMember = (doc: TopologyDoc, id: MemberId): Member | undefined =>
  doc.members.find((m) => m.id === id);

export const findHost = (doc: TopologyDoc, id: HostId): Host | undefined =>
  doc.hosts.find((h) => h.id === id);

export const findSite = (doc: TopologyDoc, id: SiteId): Site | undefined =>
  doc.sites.find((s) => s.id === id);

export const findLink = (doc: TopologyDoc, id: LinkId): Link | undefined =>
  doc.links.find((l) => l.id === id);

export const findObserver = (doc: TopologyDoc, id: ObserverId): Observer | undefined =>
  doc.observers.find((o) => o.id === id);

/** The declared primary: the single database member whose role is 'primary'. */
export function declaredPrimary(doc: TopologyDoc): MemberId | null {
  for (const m of doc.members) if (isDatabase(m) && m.role === 'primary') return m.id;
  return null;
}

export const memberHosts = (m: Member): HostId[] => m.instances.map((i) => i.host);

export const destProps = (m: Member, to: MemberId): DestProps | undefined => m.dests[to];
