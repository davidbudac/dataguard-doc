# Domain engine design — Oracle Data Guard Topology Simulator

Pure TypeScript, DOM-free. Companion documents: `facts.md` (verified Oracle facts, the
only permitted source of "documented" claims) and `ui.md` (application architecture).
The accuracy rules in the repo's `AGENTS.md`, under **Accuracy rules
(non-negotiable)**, apply in full.

## 0. Ground rules

**0.1 Pure and DOM-free.** The engine imports nothing from the DOM, does no I/O, reads no
clock, never calls `Math.random`. A test asserts the engine's import graph touches no
`preact`, `@preact/signals` or browser global.

**0.2 Accuracy labelling is a data type.**

```ts
export type Basis =
  | 'documented'   // a doc sentence says exactly this; cite must be present
  | 'doc-later'    // 19c silent, a later edition states it
  | 'conflict'     // two Oracle pages disagree; both cites present
  | 'inferred'     // deduction from two documented sentences
  | 'model';       // this page's model; must be rendered as such

export interface Claim<T> {
  value: T;
  basis: Basis;
  cite: CitationId[];   // ids into the citation catalogue (URL + quoted sentence)
  note?: string;        // rendered next to the value when basis !== 'documented'
}
```

Rule: every derived quantity that is not arithmetic over user inputs is either
`documented` with a cite or carries a `model`/`inferred` label. Precedent:
`pingInterval × (pingRetry + 1)` — documented ignore, undocumented arithmetic.

**0.3 The 24-cell matrix is the regression suite.** The general engine must reproduce
`site/test.mjs` lines 194–441 exactly through a thin adapter (§5). No special-casing of
1+1+1 inside the engine.

## 1. Topology data model

### 1.1 Identity and units
```ts
type SiteId = string & { __brand: 'SiteId' };
type HostId = string & { __brand: 'HostId' };
type MemberId = string & { __brand: 'MemberId' };   // db_unique_name
type ObserverId = string & { __brand: 'ObserverId' };
type LinkId = string & { __brand: 'LinkId' };
type Seconds = number; type Millis = number;
type Edition = '19c' | '26ai';
```
All engine time is seconds relative to t = 0. Milliseconds only for `ObserverPingInterval`
and `computeCommit`'s axis (separate tick ladders, as today).

### 1.2 Sites, hosts, links
```ts
interface Site { id: SiteId; name: string; }
interface Host { id: HostId; name: string; site: SiteId; cluster?: string; listenerPort: number; }
interface Link {
  id: LinkId;
  ends: [SiteId, SiteId] | [HostId, HostId];
  scope: 'site' | 'host';
  rttMs: Millis; up: boolean; bandwidthMbit?: number;
}
```
Reachability is a graph problem: hosts are nodes; intra-site hosts are mutually reachable
unless a host-scope link between them is cut; site links expand to every host pair across
the two sites. `reachable(hostA, hostB, netState)` = union-find over up-edges among up-hosts.
This replaces the six hand-written booleans in `computeFsfo`.

### 1.3 Members
```ts
type MemberKind = 'database' | 'farsync';
type DbRole = 'primary' | 'physical' | 'logical' | 'snapshot';
interface Instance { name: string; host: HostId; }
interface MemberBase {
  id: MemberId; kind: MemberKind; name: string;
  instances: Instance[];              // >1 = RAC
  connectIdentifier: string; enabled: boolean;
  dests: Record<MemberId, DestProps>; // per receiving member
  redoRoutes: RedoRouteRule[];        // [] = property NULL
  logXptMode: XptMode;                // as receiver; broker default ASYNC
}
interface DatabaseMember extends MemberBase {
  kind: 'database'; role: DbRole; flashbackOn: boolean;
  applyLagSeconds: Seconds; transportLagSeconds: Seconds; // clamped <= apply
  applyRunning: boolean; realTimeApply: boolean;
  openMode: 'mount' | 'read-only-adg' | 'read-write'; staticServices: boolean;
}
interface FarSyncMember extends MemberBase {
  kind: 'farsync';           // NO role, NO apply lag, NO open mode, NO broker state [D]
  transportLagSeconds: Seconds;
}
type Member = DatabaseMember | FarSyncMember;
type XptMode = 'SYNC' | 'FASTSYNC' | 'ASYNC';
interface DestProps { netTimeoutSeconds: Seconds; reopenSeconds: Seconds; maxFailure: number; affirm?: 'AFFIRM' | 'NOAFFIRM'; }
```
RAC: a member is reachable if any instance host is up and reachable; degraded, not down,
when some instances are gone. Instance-level LGWR/NSS ownership is out of scope (labelled).

### 1.4 RedoRoutes
```ts
interface RedoRouteRule { source: 'LOCAL' | 'ANY' | MemberId[]; groups: DestGroup[]; }
interface DestGroup { priority?: 1|2|3|4|5|6|7|8; dests: RouteDest[]; }  // default 1 for far sync members, 8 otherwise
interface RouteDest { target: 'ALL' | MemberId; xpt?: XptMode; alt?: { target: MemberId; xpt?: XptMode; fallback?: boolean }; }
```
Both grammars round-trip (12.1 `ALT=(… FALLBACK)`, 19c/26ai `PRIORITY=n`). A
`parseRedoRoutes(text)` recursive-descent parser round-trips the DGMGRL spelling.

### 1.5 Observers
```ts
interface Observer { id: ObserverId; name: string; host: HostId; role: 'master' | 'backup';
  fileIs?: string; logfileIs?: string; connectIdentifier?: string; running: boolean; }
```
`PreferredObserverHosts` lives on the FSFO config (host:priority 1–8, default 8, lower wins).

### 1.6 Configuration
```ts
interface Configuration {
  name: string; edition: Edition;
  protectionMode: 'MAXPROTECTION' | 'MAXAVAILABILITY' | 'MAXPERFORMANCE';
  configurationWideServiceName?: string; primaryDatabaseCandidates?: MemberId[];
  bystandersFollowRoleChange: 'ALL' | 'NONE'; fsfo: FsfoConfig; services: ServiceDef[];
  observerOverride: false;   // v1 models the default only
}
interface FsfoConfig {
  state: 'disabled' | 'enabled' | 'observe-only';
  target: { kind: 'list'; members: MemberId[] } | { kind: 'ANY' };
  thresholdSeconds: Seconds; lagLimitSeconds: Seconds;
  lagType: 'APPLY' | 'TRANSPORT'; lagGraceTimeSeconds: Seconds;
  pingIntervalMs: Millis | null; pingRetry: number | null;   // pingSet = both non-null
  observerReconnectSeconds?: Seconds; observerConnectIdentifier?: string;
  pmyShutdown: boolean; autoReinstate: boolean;
  preferredObserverHosts?: { host: HostId; priority: 1|2|3|4|5|6|7|8 }[];
}
interface ServiceDef { name: string; role: 'PRIMARY' | 'PHYSICAL_STANDBY' | 'SNAPSHOT_STANDBY'; members: MemberId[]; }
interface ClientDescriptor { serviceName: string; addresses: { host: HostId; port: number }[];
  transportConnectTimeoutSeconds: Seconds; connectTimeoutSeconds: Seconds | null;
  retryCount: number; retryDelaySeconds: Seconds; failover: boolean; loadBalance: boolean;
  deadBehaviour: 'drop' | 'rst'; }
```

### 1.7 Document and serialization
```ts
export interface TopologyDoc {
  app: 'dg-topology'; schema: 2; savedAt?: string; label?: string;
  sites: Site[]; hosts: Host[]; links: Link[]; members: Member[]; observers: Observer[];
  config: Configuration; client: ClientDescriptor;
  environment: { roleTransitionSeconds: Seconds; localWriteMs: Millis; standbyWriteMs: Millis; redoRateMBs: number };
  events: TimedEvent[];
}
```
- localStorage key `dg-doc-v1` (`state/persist.ts`); the published page's own
  `dg-fsfo-cfg-v1` is read once and migrated, never deleted.
- URL `#t=<base64url(deflate-raw(JSON))>` via `CompressionStream`, fallback `#cfg2=<base64url(JSON)>`; legacy `#cfg=` parsed through `migrateV1`.
- File `.dgtopo.json`, pretty JSON.
- `migrate(raw)` ordered chain; unknown keys dropped, numerics clamped against one `BOUNDS` table in the engine (the DOM reads from it).
- `migrateV1`: sites dc1/dc2/dc3, hosts from ID_DEFAULTS, members prm01/sby01, one observer per `observerLoc`, three links, `redoRoutes: []`, six-scenario `sim.scenario` → events per §5.2. Round-trip is a test.

## 2. Validation engine
```ts
export type Severity = 'error' | 'warning' | 'info';
export interface Finding { id: string; severity: Severity; basis: Basis; cite: CitationId[];
  subject: { kind: 'member'|'observer'|'link'|'config'|'route'; id?: string };
  message: string; ora?: string; fix?: { label: string; patch: JsonPatch }; }
export function validate(doc: TopologyDoc): Finding[];
```
Flat list of rule functions `(doc, ctx) => Finding[]`, ctx carrying the resolved redo graph
for the declared primary; output sorted by (severity, subject, id).

Rule catalogue (id · severity · basis · rule):
- MEMBER.FARSYNC_NOT_PRIMARY · error · documented · far sync never primary / never converted (A1)
- FSFO.TARGET_KIND · error · documented · target physical or logical only; not snapshot/far sync/ZDLRA (A6/C1)
- FSFO.TARGET_DIRECT_REDO · error · inferred · target must receive redo directly; far sync feed is the exception; cascaded terminal fails (B3)
- FSFO.MULTI_TARGET_EXPLICIT · error · documented · >1 standby → property must be set explicitly (C1)
- FSFO.FARSYNC_XPT · error · documented · far sync SYNC|FASTSYNC and target ASYNC (A2)
- FSFO.FARSYNC_MODE_19C · error · conflict · 19c: not MaxProtection or MaxPerformance with FSFO; 26ai drops MaxPerformance (A4)
- FSFO.LOGICAL_MAXPROT · error · documented · logical standbys unsupported in MaxProtection for FSFO (E1)
- FSFO.LAGLIMIT_VS_THRESHOLD · warning · documented · lag limit ≤ threshold recommended
- FSFO.LAGTYPE_MODE · info · documented · LagType/LagGraceTime MaxPerformance only
- FSFO.OBSERVE_ONLY · info · documented · observe-only never fails over
- MODE.MAXPROT_NEEDS_SYNC_DB · error · documented · far sync alone insufficient (A4)
- MODE.MAXPROT_SNAPSHOT_ONLY · error · documented
- MODE.MAXPROT_ONE_STANDBY · warning · documented · ≥2 standbys recommended (C3)
- XPT.TABLE_4_2 · error/warn/info · documented · MaxProt SYNC; MaxAvail SYNC|FASTSYNC (26ai ASYNC → warning); MaxPerf ASYNC only mode *listed* → info, never "SYNC illegal"
- XPT.FASTSYNC_MAXAVAIL_ONLY · error · documented
- XPT.FASTSYNC_FSFO_GAP · info · documented
- ROUTES.SOURCE_UNIQUE · error · documented (A5)
- ROUTES.LOCAL_AT_FARSYNC · error · documented (A5)
- ROUTES.SNAPSHOT_FORBIDDEN · error · documented (A5)
- ROUTES.LOGICAL_LOCAL_ONLY · warning · conflict (A5)
- ROUTES.ALT_NEEDS_MAXFAILURE · error · documented (A5)
- ROUTES.GROUP_NEEDS_MAXFAILURE · error · doc-later (26ai)
- ROUTES.ALT_NOT_IN_26AI · warning · doc-later
- ROUTES.CASCADE_PHYSICAL_ONLY · error · documented (B2)
- ROUTES.CASCADE_RT_ASYNC · warning · documented (A5/B2)
- ROUTES.CASCADE_FANOUT_30 · error · documented (B2); never "30 remote destinations" (E2)
- ROUTES.CASCADE_SYNC_UNDOC · warning · model
- ROUTES.FARSYNC_ONWARD_SYNC_UNDOC · warning · model (A3)
- ROUTES.CYCLE · error · model
- NET.DIRECT_LINK_REQUIRED · warning · documented (A1)
- OBS.COUNT · error · conflict · 19c three; 26ai four (FSFO chapter) vs three (SHOW OBSERVER page) (D1)
- OBS.ON_DB_HOST · error · documented
- OBS.PRIMARY_SITE · warning · documented
- OBS.NONE_DEPLOYED · info · documented · no observer ≠ unobserved; FS_FAILOVER_STATUS = DISABLED
- OBS.MASTER_UNIQUE · error · documented
- OBS.PREFERRED_HOSTS · warning · doc-later
- RAC.OBSERVER_ON_CLUSTER · error · documented
- REINSTATE.PRECONDITIONS · warning · documented
- DEST.NETTIMEOUT_LOW · warning · documented (min 1 s, 8–10 s recommended)
- DEST.REOPEN_ZERO · warning · model
- DEST.MAXFAILURE_RESET_UNDOC · info · model
- DEST.DEPRECATED_19C · info · documented
- DEST.RANGE · warning · documented (1–31; non-real-time cascading 1–10)
- EDIT.FSFO_ENABLED_BLOCKS · info · documented (ORA-16654)
- EDIT.REMOVE_TARGET · info · documented (ORA-16867)
- LIMIT.MEMBERS_253 · info · doc-later (12.1 only)
- MODEL.OBSERVER_OVERRIDE · info · model

`severity` and `basis` are orthogonal. A finding with basis `model`/`inferred` must carry a note.

## 3. Effective redo graph resolver
```ts
export interface RedoEdge { from: MemberId; to: MemberId; xpt: XptMode; xptSource: 'rule-attribute' | 'dest-logxptmode';
  ruleIndex: number; groupPriority: number; role: 'primary-direct' | 'primary-to-farsync' | 'farsync-onward' | 'cascade';
  active: boolean; inactiveReason?: 'lower-priority-group' | 'alternate-standby' | 'destination-down' | 'max-failure-disabled'; up: boolean; }
export interface ResolvedMember { id: MemberId; reachableFromPrimary: boolean; depth: number; feedPath: MemberId[];
  effectiveXpt: XptMode | null; synchronized: Claim<boolean>; countsTowardProtectionAck: Claim<boolean>; }
export interface RedoGraph { primary: MemberId; edges: RedoEdge[]; members: Record<MemberId, ResolvedMember>;
  protectionLevel: Claim<'MAXPROTECTION'|'MAXAVAILABILITY'|'MAXPERFORMANCE'|'RESYNCHRONIZATION'>; findings: Finding[]; }
export function resolveRedoGraph(doc: TopologyDoc, opts: { primary: MemberId; net?: NetState }): RedoGraph;
```
Algorithm:
1. Rule activation: active iff source names the current primary. `LOCAL` iff `m.id === primary`. `ANY` iff `primary !== m.id` (model: ROUTES.ANY_SEMANTICS). Standby `(prm : x ASYNC)` is active now (cascading); `(LOCAL : …)` waits for role change. Nothing rewrites on role change (A7); `SHOW CONFIGURATION WHEN PRIMARY IS x` = resolve with another primary.
2. Defaults: `[]` at a database = `(LOCAL : ALL)` [D]; at a far sync = forwards nothing (model ROUTES.FARSYNC_NULL_DEFAULT).
3. `ALL` = every other enabled member except snapshot standbys (inferred).
4. `xpt = dest.xpt ?? receiver.logXptMode` [D].
5. Groups: lowest priority number whose destinations are all up, else lowest with ≥1 up (model ROUTES.PRIORITY_ACTIVATION).
6. ALT/FALLBACK: alt active when primary dest MaxFailure-disabled or unreachable; FALLBACK reverts. `(alternate of X)` in VERBOSE [D].
7. BFS from primary over active+up edges: depth, feedPath, role; cycles → ROUTES.CYCLE. No cascade depth limit (UNDOC, stated).
8. Synchronized: direct SYNC/FASTSYNC up & transport gap 0 → true (documented). MaxPerformance / 26ai bounded MaxAvail → lag-limit gate (existing `lagGated`). Across a far sync hop: synchronized iff primary→FS edge SYNC/FASTSYNC & up and FS→target up — **model SYNC.ACROSS_FARSYNC**. Cascaded terminal: false (inferred PROT.CASCADE_NOT_COUNTED).
9. Protection ack set: members with an up SYNC/FASTSYNC edge from the primary; MaxProtection restricted to databases [D]; MaxAvail counts far sync. Level degrades to MAXPERFORMANCE when MaxAvail has no synchronized ack [D C4]; RESYNCHRONIZATION timing is model.

Worked examples: far sync (`prm01 (LOCAL : FS1 SYNC)`, `FS1 (prm01 : sby01 ASYNC)`, reverse routes pre-declared on sby01/FS2 — inactive until sby01 is primary); FS1 host down → MaxAvail drops to MaxPerformance after NetTimeout (composition = model), FSFO cannot fire, primary keeps committing; alternate direct dest activates with the documented "protection level reduced" note. Cascade: `remote_sby` depth 2 → FSFO.TARGET_DIRECT_REDO; manual FAILOVER TO remote_sby legal with the documented "no attempt is made to transmit any unsent redo" warning; switchover to terminal UNDOC → model warning.

## 4. Failure/event engine

**Hybrid: epoch loop over a closed-form kernel.** Timeline partitioned into epochs by external
events and internal deadlines; within an epoch the network, redo graph and memberships are
constant, so §3 facts are computed once per epoch; each pending clock contributes one
closed-form deadline; loop advances to min(next external event, next deadline). Typical 3–8
epochs, cap 512 (Finding if hit). Deterministic queue ordered by (time, priority, sequence);
epsilon 1e-9. `stateAt(t)` = binary search over epochs.

```ts
export type TimedEvent = { at: Seconds } & EventBody;
export type EventBody =
  | { kind: 'host.down'; host: HostId } | { kind: 'host.up'; host: HostId }
  | { kind: 'site.down'; site: SiteId } | { kind: 'site.up'; site: SiteId }
  | { kind: 'link.cut'; link: LinkId }  | { kind: 'link.heal'; link: LinkId }
  | { kind: 'partition'; groups: HostId[][] }
  | { kind: 'instance.down'; member: MemberId; instance: string } | { kind: 'instance.up'; member: MemberId; instance: string }
  | { kind: 'member.down'; member: MemberId } | { kind: 'member.up'; member: MemberId }
  | { kind: 'observer.stop'; observer: ObserverId } | { kind: 'observer.start'; observer: ObserverId }
  | { kind: 'cmd.switchover'; to: MemberId } | { kind: 'cmd.failover'; to: MemberId; immediate?: boolean }
  | { kind: 'cmd.reinstate'; member: MemberId } | { kind: 'cmd.setMasterObserver'; observer: ObserverId }
  | { kind: 'cmd.disableFsfo'; force?: boolean }
  | { kind: 'lag.set'; member: MemberId; applyLag?: Seconds; transportLag?: Seconds };

type MemberState = 'open-rw' | 'open-ro' | 'mounted-apply' | 'mounted-noapply' | 'stalled' | 'commit-hang'
  | 'aborted' | 'converting' | 'reinstating' | 'disabled' | 'unreachable' | 'down';
type FarSyncState = 'receiving' | 'forwarding-stalled' | 'unreachable' | 'down';
type ObserverState = 'master' | 'backup' | 'stopped' | 'lost-primary' | 'lost-target' | 'nominating' | 'observe-only';
```

Decision kernel per epoch:
```
fsfoArmed := fsfo.state === 'enabled' && observers.some(running)
master := running observer with role 'master' (filtered by PreferredObserverHosts)
obsSeesPrimary := reachable(master.host, anyLiveInstanceHost(primary))
obsSeesTarget(t), targetSeesPrimary(t) := redoGraph.members[t].reachableFromPrimary
stalled := fsfoArmed && primaryAlive && !obsSeesPrimary && !targets.some(targetSeesPrimary); abort at stallStart+threshold iff pmyShutdown
```
Failover at `initiateAt` iff master lost the primary for threshold (or ping window when both ping props set) AND chosen target lost the primary (ObserverOverride FALSE) AND master reaches target AND readiness gate passes. `detect = pingSet ? pingIntervalMs*(pingRetry+1)/1000 : 0.3` (model FSFO.PING_ARITHMETIC); `initiate = pingSet ? detect : threshold`; primary stall clock always uses threshold.
Target selection: walk candidate list in order, skip unreachable/gate-failing → **model FSFO.TARGET_SELECTION** ("order", never "first viable"); toggle `targetPolicy: 'skip-to-next' | 'active-target-only'`, default skip-to-next.
Readiness gate: MaxAvail/MaxProt (19c; 26ai with limit 0) synchronized; MaxPerf and 26ai bounded MaxAvail: gateLag ≤ lagLimit (transport lag under TRANSPORT, clamped to apply lag); terminal recovery pays the apply lag.
MaxAvail at-least-one-synchronized [D]; MaxProt shutdown when no SYNC-acking database → aborted at lastAck+netTimeout (model PROT.MAXPROT_SHUTDOWN_TIMING). Bystanders per BystandersFollowRoleChange (default ALL). Reinstate: open band with no end (environment-dependent), preconditions as Findings.

Output:
```ts
export interface Trace { epochs: Epoch[]; lanes: Lane[]; decisions: Decision[]; facts: DerivedFacts; findings: Finding[];
  axis: { horizon: Seconds; preRoll: Seconds; tickStep: Seconds }; }
export interface Epoch { t0: Seconds; t1: Seconds | null; cause: TimedEvent | InternalDeadline; net: NetStateSummary; redo: RedoGraph; primary: MemberId; protectionLevel: Claim<ProtectionLevel>; }
export interface Lane { subject: { kind: 'member'|'observer'|'link'; id: string }; segments: Segment[]; }
export interface Segment { t0: Seconds; t1: Seconds | null; state: MemberState | FarSyncState | ObserverState | 'up' | 'down'; label?: string; open?: boolean; }
export interface DerivedFacts { outcome: Outcome; newPrimary: MemberId | null; initiateAt: Seconds | null; execStartAt: Seconds | null;
  tOpen: Seconds | null; abortAt: Seconds | null; blocked: boolean;
  perMember: Record<MemberId, { rpoSeconds: Claim<number> | null; rtoSeconds: Claim<number> | null; endState: MemberState | FarSyncState; ifDiedNow: Seconds | null }>;
  observers: Record<ObserverId, { endState: ObserverState; becameMasterAt?: Seconds }>; }
export function simulate(doc: TopologyDoc, events: TimedEvent[], params?: SimParams): Trace;
export function stateAt(trace: Trace, t: Seconds): Snapshot;
```
`Decision` = audit trail, one per branch, each with its Claim; UI prose is generated from decisions.
Axis: `pickTickStep`, horizon/preRoll move to `axis.ts` unchanged.

Worked examples: multi-target with dead first candidate (targets [sby01,sby02], site dc2 down + primary host down: at 30 s sby01 skipped (model), sby02 chosen, tOpen = execStart+applyRemaining+roleTransition, sby02's LOCAL rules activate); RAC instance failure (one of two instances down → continues).

Model labels from §4: FSFO.PING_ARITHMETIC, FSFO.TARGET_SELECTION, PROT.MAXPROT_SHUTDOWN_TIMING, FSFO.OBSERVER_NON_TARGET_UNDOC, SWITCHOVER.TO_TERMINAL_UNDOC, REINSTATE.DURATION_ENV, NOMINATION.PRECONDITION (timing is model), EXEC.ENV_DEPENDENT.

## 5. Backward compatibility with the verified matrix
`classicTopology({observerLoc, edition, …CDEF knobs})`: sites dc1/dc2/dc3; hosts dc1-prm01, dc2-sby01, observer host of its own in the chosen site; members prm01/sby01 with `redoRoutes: []`; three site links at `latency`; FSFO enabled unless `none`; target [sby01].
Scenario → events: crash = host.down dc1-prm01; isolated = link.cut dc1↔dc2 + dc1↔dc3; partition = link.cut dc1↔dc2; dc2down = site.down dc2; observer-lost = host.down observer host; switchover = cmd.switchover to sby01.
`legacyComputeFsfo(c) = classicTopology + scenarioEvents + simulate + toLegacyModel`; `site/test.mjs`'s matrix, stall table, clock invariants, 26ai tests and back-compat deepEquals run against it unmodified — the M3 gate.
Surviving quantities (same name/value/formula): initiate, detect, execStart (= initiate + netHop, netHop = observer→target rtt/2000), tOpen, applyRemaining, abort, blocked, gateLagSeconds, dataLossKind/Seconds, ifDiedNow, stalled/standbyGone/redoFlowing/pmyReachable (derived from graph), tDown/tConvertEnd/downtime/tRestartDraw (SW_VERIFY=1, SW_CONVERT=2 nominal), horizon/preRoll/tickStep, outcome (six values + additive new ones), lagStall/lagType, observerLost/pingSet/switchover/scenario (derived label preserving observer-lost+none → crash).

## 6. Porting the other three models
- `computeApp(client, trace, doc)`: each address classified from the trace at dial time (down+drop → min(TCT, CT); up but service not published → REFUSE 0.2; OS refusing → RST 0.15; published → ESTAB 0.3); passCost = Σ address costs; worst = (rc+1)*passCost + rc*rd. Two-address case reproduces today's numbers. no-event kinds derived from outcome. `buildJdbc` `sec` suffix rule verbatim.
- `computeCommit({edition, localWriteMs, legs: CommitLeg[], mode})`: per leg ackPath (SYNC oneWay+destWrite+oneWay; FASTSYNC oneWay+oneWay); **the far sync hop terminates the commit** [D A2]; `commitMs = max(local, max legs)` (max-not-sum verbatim); multi-SYNC "all legs" is model COMMIT.MULTI_SYNC_WAIT with toggle 'all'|'first-ack'; modeConflict/modeAllowed26 unchanged.
- `computeReopen(r & {dest})`: body unchanged; inputs from `member.dests[dest]`; outage from trace with slider override; `inPriorityGroup` → not permanently disabled at MaxFailure (documented 12.2+ exception).

## 7. Config generators
Pure `(doc) => GeneratedFile[]` with structured `Line`s (`cmd`/`note`/`comment`/`blank`, tone, highlight flag).
- DGMGRL script order: CREATE CONFIGURATION; ADD DATABASE ×N; ADD FAR_SYNC ×N; LogXptMode; RedoRoutes per member (both directions pre-declared, comment says nothing rewrites on role change); NetTimeout; ENABLE FAR_SYNC; ENABLE CONFIGURATION; protection mode; FastStartFailover* properties; FastStartFailoverTarget = 'a,b'; ENABLE FAST_START FAILOVER [OBSERVE ONLY]; `START OBSERVER name FILE IS … LOGFILE IS … CONNECT IDENTIFIER IS … IN BACKGROUND` ×N; SET MASTEROBSERVER TO. Traps pinned by tests: `FILE IS` never `FILE=`; `GROUP` never in RedoRoutes; validation notes come from `validate` (one source of truth).
- LOG_ARCHIVE_DEST_n: one block per primary destination from 2 upward, ranges 1–10 / 11–31; NET_TIMEOUT omitted under ASYNC; ALTERNATE=/GROUP=/PRIORITY= only here.
- tnsnames/JDBC: ADDRESS_LIST over all service-publishing hosts, FAILOVER=on spelled, LOAD_BALANCE omitted unless on; ConfigurationWideServiceName alternative labelled doc-later.
- SHOW mocks (CONFIGURATION [VERBOSE] [WHEN PRIMARY IS x], FAST_START FAILOVER, OBSERVER): indentation for cascade, `(receiving current redo)`, `(alternate of X)`, Active/Potential targets with valid flag, observer Master/Backup with Host Name and Last Ping lines. UNDOC spellings (far-sync line → `(far sync instance)` with no state column; observe-only spelling; valid column header) carry model markers; every mock block carries a generated header saying it is rendered from the model.

## 8. Testing
1. Ported matrix gate (`legacy-matrix.test.ts` = site/test.mjs against the adapter, verbatim names/comments).
2. Property tests (fast-check optional; hand-rolled generators acceptable): no failover without running master; far sync never open/primary/target; MaxAvail with ≥1 sync ack never shuts primary; MaxProt with none → aborted; stall only when primary reaches neither master nor any target; stateAt agrees with segments; lanes contiguous; determinism; every non-documented Claim/Finding has note + existing cite; migration round-trip.
3. Scenario tests per fact-sheet example (Ex 5-2, 5-3, 5-4, 5-5, 4-2, 4-3).
4. Golden files per generator.
5. Citation catalogue test (every id resolves; URL + quote; forbidden stale citations never used for forbidden facts).

## 9. Module layout
```
app/src/engine/
  index.ts  ids.ts
  types/{topology,claims,events,trace}.ts
  citations.ts  defaults.ts
  serialize/{schema,migrate,url}.ts
  net/graph.ts
  redo/{parse,resolve}.ts
  validate/{index,rules/*}.ts
  sim/{kernel,fsfo,protection,roles,simulate}.ts
  models/{axis,app,commit,reopen}.ts
  compat/classic.ts
  generate/{dgmgrl,initora,tnsnames,jdbc,show,lines}.ts
  __tests__/  __golden__/
```
Dependencies strictly downward; nothing imports `compat` except tests/migration; `models/*` import only `types` and `axis`.

Milestones: M0 scaffold · M1 types/defaults/citations/serialize+migrateV1 · M2 net graph + redo resolve/parse · **M3 sim + compat: 24-cell matrix passes (gate)** · M4 validate · M5 models ported · M6 generators + goldens · M7 multi-observer/nomination/PreferredObserverHosts/SET MASTEROBSERVER · M8 reinstate, snapshot/logical, RAC lanes.

Risks: model creep (Claim types make unlabelled models a type error); regression vs 24 cells (M3 gate); fact-sheet research caveats (per-citation `verified: 'primary' | 'cross-edition'` flag); authoring-surface blowup (presets are the scenario tests); re-simulation cost (bounded; debounce URL writes 300 ms, WebKit replaceState limit); ObserverOverride kept literal false; edition-gated far-sync FSFO rule with 19c-invariance tests.

## 10. Deviations from the design as built

The design above is what was specified; this section is what the code does where
the two differ. Everything here is a decision the implementation had to make and
the design did not state, so it is recorded rather than left to be rediscovered.

- **Reachability is non-transitive by default.** §1.2 says "union-find over up-edges",
  which is a transitive closure. `buildReachability` takes `{ transit?: boolean }` and
  defaults it to **false**: databases, far sync instances and observers are not routers
  and a site link is a point-to-point circuit, so a severed DC1↔DC2 link stays severed
  even while both sites still reach DC3. Hosts inside one site remain mutually reachable
  (a LAN, not a transit path). This is what makes the verified 24-cell placement matrix
  come out right — a partition is arbitrable from the third site rather than invisible.
  The transitive reading is available to callers that ask for it.
- **The §3 redo-graph types live in `types/trace.ts`**, not in a module of their own:
  `RedoEdge`, `ResolvedMember`, `RedoGraph`, `EdgeRole`, `EdgeInactiveReason`,
  `ProtectionLevel`. They are derived output like the trace, nothing authored refers to
  them, and `redo/resolve.ts` imports them from there.
- **`ALL` excludes the current primary as well as snapshot standbys.** §3.3 names only
  the snapshot exclusion. Redo travelling back to its own source is not a destination,
  so `expandAll` drops the primary too — an inference from the grammar, stated as one.
- **`disabledDests` and `altLatched` are carried by the simulation, in `sim/dests.ts`.**
  §3.6 describes the resolver's inputs but not who fills them. The epoch loop counts
  REOPEN attempts per destination (drawn at exact `ReopenSecs` multiples — a model of
  "the log switch supplies the trigger", labelled `DEST.REOPEN_SCHEDULE_MODEL`), disables
  a destination that reaches `MaxFailure` and never re-enables it (documented: no further
  access until it is manually reenabled; the network healing does not bring it back),
  except for a destination written in a parenthesised PRIORITY group, which re-enters
  service when it is found accessible (documented, 12.2+). An alternate declared **without**
  `FALLBACK` latches once it takes over and stays in service after the named destination
  heals; **with** `FALLBACK` the named destination returns as soon as it is usable again —
  unless it was disabled at `MaxFailure`, which outlives the heal. Only the grammar is
  documented there, so the latch emits `ROUTES.ALT_LATCHED` (model). Resetting the
  consecutive-failure counter on a successful reopen is likewise a reading, not a rule
  (`DEST.MAXFAILURE_RESET_UNDOC`), and `max-failure-disabled` outranks the other
  `inactiveReason`s because it is the reason that outlives them.
- **`Outcome` has a seventh value, `maxprot-shutdown`.** Maximum protection shutting the
  primary down is not a stall: nothing was unobserved, no `FastStartFailoverThreshold`
  ran, and the instant is `NET_TIMEOUT`-derived. Folding it into `stall-noone` made the
  timeline draw the threshold across a `NET_TIMEOUT` interval, which the accuracy rules
  forbid. The timeline draws a `NET_TIMEOUT` brace there instead and labels the instant as
  this page's model; the readout says "MaxProtection shut the primary down — no
  synchronized standby acknowledged". The published 1+1+1 adapter can never produce it
  (that deployment is never in maximum protection mode).
- **Synchronized does not consult the transport lag.** §3.8 said "direct SYNC/FASTSYNC up
  & transport gap 0". Under SYNC or FASTSYNC the commit waits for the destination's
  acknowledgement, so redo the standby has not received is not a state that transport can
  be in: a direct SYNC/FASTSYNC edge that is up is synchronized, whatever
  `transportLagSeconds` says. The transport-lag input is the 26ai maximum performance
  TRANSPORT what-if and is read in exactly one place — where `FastStartFailoverLagLimit`
  is the readiness gate and `FastStartFailoverLagType` is `TRANSPORT`. The same rule holds
  across a far sync hop (`SYNC.ACROSS_FARSYNC` no longer asks the far sync's gap), and the
  switchover gate asks the transport directly rather than a lag-gated readiness flag. Every
  preset therefore opens at the level it was configured in, and the classic 1+1+1 steady
  state is `MAXAVAILABILITY` with zero data loss.

### Collected current routes

The v1 SQL collector importer (`engine/collect.ts`) accepts framed JSON records,
requires all advertised members and a single primary, and rejects conflicting
RAC destinations. `MemberBase.routesObserved?: true` distinguishes a collected
empty route list from the broker NULL default; `activeRule` must not synthesize
LOCAL:ALL for that list. This optional schema-2 field survives normalization,
export and reload; older documents retain their existing semantics. Collected
edges apply only under the captured primary. The importer returns assumptions
and any schema repairs beside the document. No live database verification was
available; the collector and mapping need a real Oracle test-environment drill.

### The application as a card (2026-09-28)

`TopologyDoc.application?: { id, name, host }` draws the application tier on a host
of its own; `doc.client` stays the connect descriptor and is what the card's form
edits. The field is optional schema-2: a document without it parses, exports and
reloads without it, and `parseApplication` drops (and reports) one whose host is
gone. `engine/application.ts` (`withApplication`, `primarySite`) is the one place
that puts it on a document: in the primary's data centre, filling an empty
ADDRESS_LIST with the primary and then every standby database, never a far sync
instance.

- **`computeApp` has two vantages, and the document picks.** With no application the
  published reading stands, word for word and number for number (`APP.CLIENT_VANTAGE`:
  outside every site, an address answers when its site still has a way out) — that is
  what `classicTopology`, a legacy link and `legacy-models.test.ts` run. With one, an
  address is dialable when its host is up and the application's host reaches it
  (`APP.CLIENT_PLACED`, model), asked of `buildReachability` with the engine's
  no-transit default. A dead host behind a severed link is a `timeout` whatever
  `deadBehaviour` says (`pathTo`: reachability with that host brought back).
- **`NetStateSummary.groups`** carries an explicit partition's host groups, and
  `netFromSummary` turns an epoch's summary back into a `NetState`, so reachability
  can be asked of a recorded epoch. `partitioned` is unchanged.
- **The outcome no longer short-circuits a placed application.** The published model
  returns `noEvent` on `observer-lost`, a refused switchover and `stall-noone` before
  looking at the addresses. Placed, the order is the other way round: while the
  service stays in reach nothing happened (the outcome only names the kind of quiet),
  and once it does not there is a ladder, whatever the broker decided — so a stalled
  primary that aborts at the threshold is a ladder from the abort.
- **New on `AppModel`:** `placed`, `appDownAt`, `spans` (stretches over which the
  application's picture is constant: `appUp`, `serving`, `servingState`, `published`)
  and `steady` (the same for the configuration as declared — a trace opens on its
  first event, so its first span is already the failure). `NoEventKind` gains
  `app-down`: the application's host went down and never came back, so nothing is
  dialled; when it does come back the ladder starts there.
- **The application decides nothing.** No rule, clock or decision in `sim/*` reads it;
  `test/app-placement.test.ts` pins that the run's facts are the same with and
  without it, beside the placement outcomes on the classic 1 + 1 + 1.

