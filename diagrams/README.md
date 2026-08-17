# Fast-start failover (FSFO) — Oracle 19c Data Guard broker

Fast-start failover lets the broker fail over to a previously chosen standby database without
human intervention. Three actors are involved: the **primary database**, the **target standby
database**, and the **observer** — a DGMGRL client process that runs on a third host and monitors
both. In steady state the primary is open and ships redo to the standby (SYNC/FASTSYNC in
MaxAvailability, ASYNC in MaxPerformance), the standby continuously applies that redo, and the
observer pings the primary. Fast-start failover occurs when **both** the observer **and** the
target standby have lost their connection to the primary for `FastStartFailoverThreshold` seconds,
and the standby passes its readiness check. The figures below break that sequence apart second by
second: what the broker parameters actually govern, what they do not, and how the same threshold
protects against split brain when the primary is merely isolated rather than dead.

To verify these behaviors against a real 19c configuration, see the
[test runbook](../testing/README.md) — step-by-step drills for each situation below,
with the expected observations and the reinstate/cleanup steps that make them repeatable.

## Figures

### 1. Primary host crash

The common case: the primary host is gone. The observer's ping fails almost immediately, the
threshold window opens, and the failover is initiated when it expires. Note that the last span —
applying the remaining redo and changing role — is **not** governed by any broker parameter.

![Timeline of a fast-start failover after a primary host crash: the primary lane goes down at t = 0, the observer spends the 30 s FastStartFailoverThreshold window on reconnect attempts while confirming readiness with the standby, and the standby applies its remaining redo and opens read-write at about t = 45 s.](fsfo-timeline-crash.svg)

### 2. Isolated primary (network partition)

A network partition cuts the primary off from both the observer and the target standby while the
primary itself keeps running. Two independent `FastStartFailoverThreshold` clocks now tick on
opposite sides of the partition — one ending in the standby's activation, the other in the old
primary's self-abort. That is the split-brain protection.

From its first second the stall looks like `NET_TIMEOUT` territory — in-flight SYNC commits
hanging while LGWR waits for an acknowledgment that cannot come — but with fast-start failover
enabled the primary may not drop the destination and resume redo generation when `NET_TIMEOUT`
expires, so the commits stay hung for the whole stall, and the stall's *length* is set by
`FastStartFailoverThreshold`, not by `NET_TIMEOUT`. At the defaults both clocks are 30 s and
expire together (figure 4, panel B, walks through this distinction).

![Timeline of a fast-start failover with an isolated primary: a dashed divider at t = 0 marks the network partition, the primary lane stalls — in-flight commits stay hung for the entire stall, which NET_TIMEOUT never shortens — and then self-aborts at t = 30 s under FastStartFailoverPmyShutdown = TRUE, while the observer and standby run the same 30 s threshold on the other side of the partition. The stall's length is set by the threshold, not by NET_TIMEOUT.](fsfo-timeline-isolated.svg)

### 3. Message sequence

The same crash scenario as a sequence diagram, with an elapsed-time gutter on the left that maps
each exchange back to the timeline figures. The message order follows the documented flow: during
the threshold window the observer only confirms that the standby has also lost the primary (the
quorum the `ObserverOverride = FALSE` default requires); the readiness check — synchronized, or
apply lag within `FastStartFailoverLagLimit` — is verified by the observer **when it initiates the
failover**, after the threshold expires, which is why the FAILOVER arrow carries that label.

![Sequence diagram of fast-start failover: steady-state ping/ack and redo shipping, the primary crash, unanswered pings, the threshold clock, the observer confirming the standby also lost the primary, threshold expiry, the readiness verification, the failover command, and the standby's terminal recovery, role change and read-write open.](fsfo-sequence.svg)

### 4. Where NET_TIMEOUT fits (and where it doesn't)

`NET_TIMEOUT` is a redo-transport attribute of `LOG_ARCHIVE_DEST_n` on the primary (broker property
`NetTimeout`; default 30 s, minimum 1 s, with at least 8–10 s recommended so that transient network
errors do not drop the destination) — it is not a broker failover clock. It is the number of seconds
LGWR blocks waiting for the standby to acknowledge redo sent **synchronously** through the NSS*n*
sync network process; on expiry an error is logged and the redo transport session to that
destination is terminated. On a primary that survives the link failure (panel A) that is the whole
story: committing sessions hang for up to `NET_TIMEOUT`, the destination is dropped, and the primary
carries on open but UNSYNCHRONIZED — which is itself why fast-start failover is temporarily
impossible until the standby resynchronizes. In MaxPerformance (ASYNC) commits never wait for the
standby, so `NET_TIMEOUT` never appears on the failover timeline at all, and eligibility and data
loss are governed by `FastStartFailoverLagLimit` instead. When the primary is fully isolated
(panel B) the fast-start failover stall overrides all of this — the primary may not simply drop the
destination and keep running, committing sessions stay hung for the whole stall, and
`FastStartFailoverThreshold` decides the outcome (at the defaults both clocks are 30 s and expire
together); neither the observer nor the target standby ever consults `NET_TIMEOUT` for the
failover decision.

![Two stacked timelines from the primary's point of view. Panel A: the standby link fails while the observer stays reachable, committing sessions hang for the 30 s NET_TIMEOUT, then the destination is dropped and the primary is open but unsynchronized — no failover. Panel B: the primary is fully isolated, in-flight commits stay hung for the entire stall, and the 30 s FastStartFailoverThreshold stall clock decides the outcome, ending in self-abort.](fsfo-net-timeout.svg)

## Broker properties

| Property | Default | Minimum | Governs |
|---|---|---|---|
| `FastStartFailoverThreshold` | 30 s | 6 s | Seconds the master observer attempts to reconnect to the primary before initiating fast-start failover. The interval starts when the observer **first** loses its connection to the primary. |
| `ObserverPingInterval` | 100 ms | 100 ms | How frequently the observer pings the primary. |
| `ObserverPingRetry` | 10 | 10 | Number of times the observer retries a failed ping (failed = no answer within `ObserverPingInterval`) before initiating failover. |
| `FastStartFailoverLagLimit` | 30 s | 5 s | MaxPerformance mode only: maximum seconds the standby's apply point may lag the primary's redo generation point for fast-start failover to be permitted. Bounds data loss. Oracle recommends keeping it at or below `FastStartFailoverThreshold` (see below). |
| `FastStartFailoverPmyShutdown` | TRUE | — | If TRUE, a primary whose `V$DATABASE.FS_FAILOVER_STATUS` has been STALLED for longer than `FastStartFailoverThreshold` seconds — and that cannot reach the observer or the target standby — shuts itself down (abort). |
| `ObserverOverride` | FALSE | — | When TRUE, "allows an automatic failover to occur when the observer has lost connectivity to the primary. This is the behavior even if the standby has a healthy connection to the primary." At the default FALSE, a target standby that still reaches the primary is what prevents the attempt. |
| `FastStartFailoverAutoReinstate` | TRUE | — | Reinstates the old primary as a standby (via Flashback Database) when it returns. Reinstate is out of scope for these figures. |

**`ObserverOverride` = FALSE is a page-wide assumption**, not a derived result. Every figure here and
every simulator cell reads the standby's own view as a veto on the failover, which is only the
default behaviour; with TRUE, several **continues** cells in the outcome matrix would become
failovers. Never present a cell outcome as unconditional without naming that assumption.

**`FastStartFailoverLagLimit` should stay at or below `FastStartFailoverThreshold`.** The property
page recommends exactly that, and warns that with a larger limit "the primary will keep committing
after the Fast-Start Failover is initiated, exposing the configuration to the risk of having two
primary databases for a short period of time". The simulator warns on the slider when the limit
exceeds the threshold, and its split-brain callout carries the same proviso — never present "at
most one database ends up open" as unconditional.

**`FastStartFailoverAutoReinstate` is narrower than "the old primary comes back".** The broker
reinstates only after a fast-start failover the observer initiated because the primary crashed or
was isolated — never after a user-configurable health condition and never after a
`DBMS_DG.INITIATE_FS_FAILOVER` call, which explicitly does not reinstate. It also needs Flashback
Database on both databases, the former primary started and mounted (a manual restart when
`FastStartFailoverPmyShutdown` aborted it), the master observer able to connect to it, and static
service names where there is no Oracle Clusterware or Oracle Restart. Still out of scope for the
figures; the simulator states it only in the reference table and the sequence-diagram footer.

### The ping-properties quirk

> **The `FastStartFailoverThreshold` property is ignored when the `ObserverPingRetry` and
> `ObserverPingInterval` properties are set.**

(Sourcing note: the sentence above, and the defaults in the table, come from the
`ObserverPingInterval` / `ObserverPingRetry` descriptions in the broker properties reference.
Curiously, the 19c edition of that page does not list these two properties at all, even though
they have existed since 12.2 and 19c DGMGRL accepts them — they appear in the 21c and later
editions, linked below. **26ai muddies the defaults**: the 26ai property pages give the *broker
defaults* as 0 — the properties not set, detection governed by the threshold — while the 26ai
FSFO chapter's table still shows 100 ms / 10, an upstream contradiction. The simulator's 26ai
edition shows 0 (not set) in its defaults column and the caption names the disagreement; the
minimums when the properties are explicitly set stay 100 ms and 10 in every edition.)

In other words: once a DBA explicitly sets both ping properties, detection is governed by the ping
loop instead of by the 30-second threshold. **The arithmetic is not documented.** The properties
page states the ignore and says only that "the detection time can be reduced to nearly 1 second";
*interval × (retries + 1)* — the first failed ping plus its retries, roughly one second at the
minimum values — is this page's (and the simulator's) reading of that sentence, and every asset that
draws the number labels it as a model rather than a quoted figure.
The figures here show the default configuration, where the threshold is what you are waiting for.
If you set the ping properties, the amber threshold window in figures 1 and 2 collapses to
`ObserverPingInterval` × (`ObserverPingRetry` + 1). In the isolated-primary scenario the primary's own
stall clock still uses `FastStartFailoverThreshold`; the quirk affects the observer's detection,
not the primary's stall.

### Redo transport properties

The four below are transport plumbing, deliberately kept out of the table above: none of them
decides whether or when a fast-start failover happens. Each is a broker property whose value lands
in a `LOG_ARCHIVE_DEST_n` attribute on the primary — `NetTimeout` included, which is exactly why it
belongs here and not among the failover clocks (figure 4 exists to make that point).

| Broker property | `LOG_ARCHIVE_DEST_n` attribute | Default | Governs |
|---|---|---|---|
| `LogXptMode` | `SYNC AFFIRM` · `SYNC NOAFFIRM` (FASTSYNC) · `ASYNC NOAFFIRM` | `ASYNC` | How the commit waits, or does not wait, for the standby's acknowledgment. Legal per protection mode: MaxProtection `SYNC`; MaxAvailability `SYNC` or `FASTSYNC`; MaxPerformance `ASYNC`. |
| `ReopenSecs` | `REOPEN` | 300 s | Minimum seconds before a failed destination is retried — at the first log switch after the interval has elapsed. Valid values 0 or greater; applies to all errors, not only connection failures. |
| `MaxFailure` | `MAX_FAILURE` | 0 — unlimited | Consecutive attempts to reestablish a failed destination before it is disabled, with no further access until it is manually reenabled. |
| `NetTimeout` | `NET_TIMEOUT` | 30 s (minimum 1 s) | Seconds LGWR blocks waiting for a SYNC acknowledgment. Never a failover clock — see figure 4. |

Neither `ReopenSecs` nor `MaxFailure` is on 19c's list of deprecated broker properties (the 19c
broker release-changes page names nine initialization-parameter-backed properties, `ArchiveLagTarget`
through `LogFileNameConvert`, and their own property rows carry no deprecation note — re-verified
2026-08-17; earlier revisions of this file, and the legacy simulator, called them deprecated). Both
are documented properties the broker writes into `REOPEN` and `MAX_FAILURE`; `EDIT DATABASE ... SET
PARAMETER` is a second route to the same attributes. Their semantics here follow the
`LOG_ARCHIVE_DEST_n` attribute reference rather than the broker properties page, whose rows state only
the interval and the count.

## Reading the figures

- **Failover conditions.** During the threshold window the observer keeps trying to reconnect and
  confirms with the target standby that it too has lost contact and is ready. In
  MaxAvailability/MaxProtection the standby must have been synchronized at failure time; in
  MaxPerformance its apply lag must be at or below `FastStartFailoverLagLimit`. If the readiness
  check fails, fast-start failover is **not** allowed. If the standby still has contact with the
  primary, there is no failover.
- **What the threshold does not cover.** After initiation the standby finishes applying the redo it
  has already received (terminal recovery — this grows with the apply lag at failure time),
  converts to the primary role, and opens read-write. That whole span depends on the environment,
  not on a broker parameter. The figures illustrate it at roughly 10–20 s.
- **Data loss.** MaxAvailability (SYNC): zero. MaxPerformance (ASYNC): bounded by
  `FastStartFailoverLagLimit` — whatever redo had not reached the standby is lost.
- **The threshold is skipped entirely** for user-configurable health conditions and for
  application-initiated `DBMS_DG.INITIATE_FS_FAILOVER`.
- **Shared visual language.** The figures use the same lane order (Primary, Observer, Standby —
  figure 4 shows the primary lane alone) and the same phase colors: teal for serving/open
  read-write, blue for a standby applying redo, amber for waiting and countdown windows, red
  hatching for down or stalled spans, and violet for observer decisions and commands. All three
  timeline figures (1, 2 and 4) are drawn from one linear time-to-x scale — 10 px per second,
  t = 0 at x = 280 — noted in an XML comment at the top of each file, so bars, markers, axis ticks
  and braces line up exactly and the figures can be laid over one another. Parameter names are set
  in a monospace stack everywhere.

Each `.svg` is a standalone file with no external references and an explicit white background rect,
so it renders correctly in GitHub's dark mode. The text is real `<text>`, so it stays selectable
and searchable.

## Client connect string (the simulator's application view)

The simulator's "application's view" section models a client using one connect
descriptor listing both hosts plus a role-based service (started only where the
database runs as primary, via `srvctl add service -role PRIMARY` or a startup
trigger). Verified facts it relies on:

- `TRANSPORT_CONNECT_TIMEOUT` — TCP connect budget **per ADDRESS**, default
  60 s (19c connect descriptor). The clock that runs while a host is silently
  unreachable. Oracle applies it (and `CONNECT_TIMEOUT`) per ADDRESS **and per
  IP address a host name resolves to** — the simulator draws single-IP hosts
  and says so; a multi-record DNS name multiplies the toll.
- **The JDBC thin driver does not inherit Oracle Net's 60 s default.** Its own
  connect-timeout default is 0 (no timeout) in the 19c driver and 20 s
  (20 000 ms) in current releases, which is why the simulator's generated thin
  URL always spells `TRANSPORT_CONNECT_TIMEOUT` out — with an explicit `sec`
  suffix, because older thin releases read a bare value as milliseconds.
  (The "changed in 23.6" attribution circulating for the new 20 s default is
  not verifiable on the API reference pages; the 0 → 20 000 ms change between
  the 19c and current pages is.)
- `CONNECT_TIMEOUT` — caps one complete attempt to one ADDRESS (transport +
  listener handshake), applied per address; no default in the descriptor. The
  HA guide's example uses 90 s.
- `RETRY_COUNT` — additional traversals of the full address list after the
  first fails across all of it; default 0. `RETRY_DELAY` — seconds between
  traversals; no default (retries immediately). HA guidance: short delays ×
  many retries (its switchover sizing example is 100 × 3 s).
- `FAILOVER` default `on` (DESCRIPTION_LIST / DESCRIPTION / ADDRESS_LIST);
  `LOAD_BALANCE` default `off` inside an ADDRESS_LIST, `on` only under a
  DESCRIPTION_LIST.
- A standby whose listener does not publish the role-based service refuses
  instantly with `ORA-12514`; established sessions are untouched by all of the
  above (they need keepalives/`SQLNET.RECV_TIMEOUT`/FAN to die fast).
- **TAF and Application Continuity are not the same promise, and neither "resumes the work".**
  Transparent Application Failover reconnects the session and, with `SELECT` failover, can carry on
  fetching from an open cursor — but **active transactions are rolled back**: the documentation is
  explicit that TAF cannot replay a transaction and that the application must be prepared for an
  error and its own re-submission. Application Continuity, where it is configured, is the one that
  can replay in-flight work, and only conditionally: the request must be replay-eligible, and a
  replay whose result it cannot verify against the original is **rejected** rather than committed
  twice. The simulator's chapter-3 note words it exactly that way; never collapse the two into
  "TAF or Application Continuity resumes their work".

## Commit anatomy (the simulator's commit view)

The simulator's `#commitview` section takes one commit apart on a millisecond axis under each
`LogXptMode`. Verified facts it relies on:

- `LogXptMode` takes `SYNC`, `FASTSYNC` or `ASYNC`; the broker default is `ASYNC`. Each maps to a
  pair of `LOG_ARCHIVE_DEST_n` attributes: `SYNC AFFIRM`, `SYNC NOAFFIRM`, `ASYNC NOAFFIRM`.
- `AFFIRM` "acknowledges received redo data after writing it to the standby redo log"; `NOAFFIRM`
  acknowledges it *before* that write. That one word is the whole difference between SYNC and
  FASTSYNC. Two documented defaults coexist: the Database Reference gives `NOAFFIRM` as the
  attribute's own default, while the Data Guard usage note gives the contextual default — `AFFIRM`
  with `SYNC`, `NOAFFIRM` with `ASYNC`. `AFFIRM` without `SYNC` is deprecated.
- `FASTSYNC` arrived in 12.1 as "a new high performance redo transport mode", and is available in
  maximum availability only. (Same citation quirk as the ping properties: the notice exists only in
  the 12.1 edition of the broker release-changes page, linked below.)
- SYNC blocks the commit until the redo has been sent and acknowledged; ASYNC commits without
  waiting for the standby at all.
- **Why the model uses max() and not a sum.** The 19c HA guide walks the SYNC commit path in
  thirteen steps: LGWR *starts the remote write* (step 5) **before** it *issues the local write*
  (step 6), and only afterwards *waits for the remote write to complete* (step 7). The local
  online-redo write and the network round trip therefore overlap, and a commit costs the longer of
  the two — `max(local write, remote ack path)`. Oracle never calls this "parallel", so neither do
  these assets; the step ordering is the evidence. The `log file parallel write` wait event is *not*
  evidence for it — that event is about multiplexed redo log members.
- Protection-mode legality (broker Table 4-2): MaxProtection requires `SYNC`; MaxAvailability
  allows `SYNC` or `FASTSYNC`; MaxPerformance is listed with `ASYNC` only — the docs do not say
  SYNC is illegal there, and neither do these assets. The table's footnote adds that fast-start
  failover "cannot be initiated when FASTSYNC is used and the standby is missing redo data".

## Transport outage and retry (the simulator's reopen view)

The `#reopenview` section runs on a minutes axis and starts where figure 4 panel A ends: the
destination is already closed, and the primary is open, unsynchronized, and generating redo nobody
is receiving.

- `ReopenSecs` / `REOPEN` — broker default 300 s, valid values 0 or greater. What 0 means is not
  documented, so the simulator's slider floors at 30 s rather than guess. Deprecated as a broker
  property in 19c.
- Retry semantics: "redo transport services attempt to reopen failed destinations at log switch
  time", once the time of the last error plus the `REOPEN` interval is less than the current time.
  The interval gates eligibility; the log switch is the trigger. `REOPEN` applies to all errors,
  not only connection failures.
- `MaxFailure` / `MAX_FAILURE` — counts *consecutive* attempts to reestablish a failed destination
  at log switches. The default is an unlimited number of archival attempts (`MAX_FAILURE = 0`);
  that 0 is the default for destinations in the default group, while destinations in a non-default
  log-archive-destination group default to 1.
- On reaching the limit the destination is disabled, and "there is no further access until the
  destination is manually reenabled" — the network healing does not bring it back, and the
  destination is thereafter treated as if `REOPEN` had not been specified. Whether a successful
  reopen resets the counter is not documented; the word "consecutive" implies it, which is as far
  as these assets go. Exception: since 12.2, GROUP/PRIORITY destinations re-enter service when
  they are found accessible.
- Sourcing note: every `MAX_FAILURE` semantic above comes from the `LOG_ARCHIVE_DEST_n` attribute
  reference, not the broker properties page, whose 19c edition mislabels `MaxFailure` as
  corresponding to `VALID_FOR`.

## Observer loss and multiple observers (the simulator's observer-lost scenario)

The simulator's `observer-lost` scenario kills the only observer host at t = 0 and leaves
everything else intact. Nothing fails over, and that is the point.

- The primary stalls only when it can reach *neither* the observer *nor* the target standby. With
  the standby still reachable it keeps serving; "no new transactions are able to commit" describes
  the double-loss case, not this one.
- **`PRIMARY UNOBSERVED` is a standby-side status, and which database you query decides what you
  see.** `FS_FAILOVER_STATUS` is documented per role in the broker guide's Table 5-1: on a primary
  it takes the values a primary can be in, and the status a *target standby* reports when the
  observer is gone is `PRIMARY UNOBSERVED`. The chapter's own worked example prints the pair —
  primary `SYNCHRONIZED` with `FS_FAILOVER_OBSERVER_PRESENT` = `NO`, target standby
  `PRIMARY UNOBSERVED` with `FS_FAILOVER_OBSERVER_PRESENT` = `YES` (the standby still has the
  observer; it is the primary that lost it). So on the primary it is `FS_FAILOVER_OBSERVER_PRESENT`
  that flips, not `FS_FAILOVER_STATUS` — that column reports "whether the master observer is
  currently connected to the local database". The simulator's timeline marker under the primary lane
  therefore names `FS_FAILOVER_OBSERVER_PRESENT`, and the callout beside it spells both sides out.
- **With no observer deployed at all**, `FS_FAILOVER_STATUS` reads `DISABLED` — fast-start failover
  was never enabled, which is a different state from unobserved.
- Two errors that are not interchangeable: `ORA-16820` ("fast-start failover observer is no longer
  observing this database") is a standing health condition on the configuration; `ORA-16658`
  ("unobserved fast-start failover configuration") is raised when a failover is *attempted* while
  unobserved.
- 19c registers up to three observers for one broker configuration; exactly one is the master, and
  "only the master observer can coordinate fast-start failover". If the master is lost while the
  primary and standby can still reach each other, the broker nominates a backup observer as the new
  master by itself (automatic since 12.2); `SET MASTEROBSERVER TO` is the manual override. The
  count of three is 19c-specific — later releases allow more, so do not carry the number across
  editions.
- The simulator deliberately models the single-observer configuration, where none of that
  redundancy exists: no backup to promote, no failover possible, and `FastStartFailoverThreshold`
  counting nothing.

## Where the observer runs (the simulator's observer-location control)

The simulator's second rail control crosses every scenario with four observer placements — **none**,
the **primary's site**, the **standby's site**, and a **third site** (the default, and what the rest
of this page assumes). The placement is not a broker property; the broker has nothing that records
it, which is exactly why it belongs in the deployment identity rather than the parameter set.

- **Oracle's hierarchy has three rungs.** First choice: "the observer should ideally be located at a
  third site or third data center so that the primary, observer, and standby have isolated power,
  server, storage, and network infrastructure" (19c HA guide; the 12.1 guide words the same rung as
  a host "not located in the same data center as the primary or standby database", ideally "equally
  distant" from both). Second: "have the observer use the same path to connect to the production
  database as is used by the application tier" — with the guide's own caveat that when the
  application tier is local to the production database, deploying the observer beside it is unwise,
  because "it could experience the same issues as the database"; put it "at either the standby
  location or a third data center" instead. Third and last: "locate the observer in the standby data
  center on a separate host and isolate the observer as much as possible from failures affecting the
  standby database" (12.1 HA Best Practices, §8.5.2.3 *Fast-Start Failover Best Practices* — a
  cross-edition citation on the same precedent as the 21c `ObserverPing*` pages, because that
  edition states the hierarchy most completely).
- **Never on a database server.** Achieving the same isolation with two sites is possible, "however,
  when Data Guard is used for disaster recovery, the observer should never be deployed at the
  primary database server or cluster, or on the standby database server or cluster". All four of the
  simulator's placements therefore put it on a separate host; only the *site* changes.
- **The primary's site is not on the hierarchy at all.** The simulator offers it because it is what
  people actually do, and words it as a caution: a site failure takes the observer with the primary,
  and an observer on one side of a cut cannot arbitrate that cut. It is arguable only where the
  application tier is local to the primary too — and even there the guide prefers the standby's site
  or a third one. Never present it as a recommendation.
- **Deploying no observer is not the same as being unobserved.** *Unobserved* is an armed
  configuration whose master observer is missing: the target standby reports `FS_FAILOVER_STATUS` =
  `PRIMARY UNOBSERVED` while the primary reports `FS_FAILOVER_OBSERVER_PRESENT` = `NO`,
  `ORA-16820`, and the broker's own list headed "Fast-start failover cannot occur if:" opening with
  "The master observer is not running" — the observer-lost scenario above.
  **A manual failover is still possible with fast-start failover enabled, but not unconditionally.**
  "You can perform a manual failover even if fast-start failover is enabled" — *as long as certain
  conditions are met*, and the broker lists three: the role change is directed to the same standby
  named in `FastStartFailoverTarget`; that standby is synchronized (maximum availability or maximum
  protection) or within the lag limit (maximum performance); and, for a manual failover, "the
  observer is started and communicating with the target standby database", with the primary shut
  down first. So an *unobserved* configuration does not satisfy the third condition — the way out is
  `DISABLE FAST_START FAILOVER FORCE` and then the manual failover, which is what the simulator's
  stall caption already says. That is also why the page words the no-observer case as a manual
  failover needing no observer *while fast-start failover is disabled*, rather than as one that is
  unconditionally available.
  *No observer deployed* means fast-start failover was never enabled:
  the `FastStartFailover*` properties can be set and nothing arms them, and a manual `FAILOVER TO` —
  which never needed an observer — is the only thing that can promote the standby. One consequence
  the simulator has to keep straight: the MaxPerformance switchover refusal past
  `FastStartFailoverLagLimit` is fast-start failover's **own** gate, so it cannot fire when no
  observer is deployed.

### The outcome matrix

Every cell below follows from the derivation rules already on this page — failover needs *both* the
observer and the target standby to have lost the primary for the threshold, the primary stalls only
when it can reach *neither*, a stalled primary self-aborts at the threshold under
`FastStartFailoverPmyShutdown`, and a switchover never involves the observer at all. The placement
is simply what decides which of those a given failure cuts.

**Every cell assumes `ObserverOverride` = FALSE, the broker default.** The property, when set to
TRUE, "allows an automatic failover to occur when the observer has lost connectivity to the primary.
This is the behavior even if the standby has a healthy connection to the primary" — so with TRUE the
standby's own view stops being a veto and several **continues** cells below would become failovers.
Neither the simulator nor these figures model that; they model the default, where a target standby
that still reaches the primary is what prevents the attempt.

| scenario | none | primary's site | standby's site | third site |
|---|---|---|---|---|
| **crash** — the primary host dies | manual | failover | failover | failover |
| **isolated** — every link out of the primary's site fails | continues | continues | failover (stall) | failover (stall) |
| **partition** — only the link between the two database sites fails | continues | continues | **failover (stall)** | continues |
| **dc2down** — the whole standby site is lost | continues | continues | **stall-noone** | continues |
| **observer-lost** — the observer host dies | (a plain crash) | observer-lost | observer-lost | observer-lost |
| **switchover** — a planned role reversal | switchover | switchover | switchover | switchover |

Legend: **failover** — the standby is promoted; *(stall)* marks the cells where the primary is
simultaneously cut off from both and self-aborts at the threshold. **continues** — nothing is
promoted and the primary keeps committing. **stall-noone** — the primary stalls from t = 0 with no
reachable standby to promote, and self-aborts one threshold later under
`FastStartFailoverPmyShutdown`; no failover is ever possible. **manual** — nothing is armed and the
primary is gone; only a DBA running `FAILOVER TO` moves the role, and no
`FastStartFailoverLagLimit` bounds the loss, because that guarantee is fast-start failover's.
**observer-lost** — the configuration is unobserved and nothing moves. **switchover** — the planned
swap, identical at every placement. The one coerced pairing is observer-lost with no observer
deployed: there is nothing to lose, so it is the plain crash cell.

Three cells are worth reading twice:

- **partition · standby's site** is a **false failover**. Only the link between the two database
  sites is down, so the primary never stopped serving — but the observer is on the far side of that
  cut with the standby, both halves of the quorum have lost the primary, and the standby is
  promoted. The same cut leaves that healthy primary reaching neither, so it stalls and aborts at
  the threshold. Compare the same row at the third site, where the observer still sees the primary,
  holds fire, and nothing happens at all: this is what the third-site recommendation buys.
- **dc2down · standby's site** takes production down by losing the *spare*. The observer dies with
  the standby site, the primary reaches neither, and it stalls from t = 0 — with nothing left to
  fail over to. Under `FastStartFailoverPmyShutdown` it aborts one threshold later.
- **isolated · primary's site** is the mirror image: the observer is inside the isolated site and is
  the only thing still talking to the primary, so it holds fire. Nothing is promoted, the standby is
  stranded with no redo arriving, and the primary serves an outside world that cannot reach it.

`site/test.mjs` carries this same table as executable assertions — the 24 outcomes and the 24
stall flags looped literally, plus the 19c-invariance loops that pin the version axis (no version,
or `'19c'`, must reproduce the 24-cell table exactly, with `lagStall:null` and `lagType:'apply'`
everywhere, with every 26ai-only input along for the ride) — so a model change that contradicts the
matrix fails the build before it can be published. Change one and change all three: the model, the
test tables, and this section.

## Planned switchover (the simulator's switchover scenario)

The `switchover` scenario is the only planned event on the page: `DGMGRL> SWITCHOVER TO 'sby01'`
at t = 0, both hosts up throughout, and the two databases trading roles.

- A switchover is a planned role reversal that "guarantees no data loss and is typically done for
  planned maintenance of the primary system". Zero data loss holds in **every** protection mode —
  that is the headline contrast with a failover, and why MaxPerformance costs nothing here.
- Prerequisites the broker checks before it starts: the primary enabled and in TRANSPORT-ON state,
  the target standby enabled and in APPLY-ON state, no apply delay on the target (`DelayMins` must
  be 0), and a configuration that still supports the current protection mode after the swap.
- With fast-start failover **enabled** — the standing fixture of this page — "a switchover can be
  performed only to the pre-specified target standby database and only if the standby database is
  synchronized with the primary database or is within the configured lag limit, for the max
  availability and max performance modes respectively". Two consequences the simulator models:
  MaxPerformance with an apply lag beyond `FastStartFailoverLagLimit` makes the broker **refuse**
  the command (the blocked banner, worded as a refusal rather than a forbidden failover); and
  MaxAvailability is *not* blocked by an apply lag, because synchronized is about redo **received**
  — the lag only lengthens the catch-up. Do not write it the other way round.
- Fast-start failover stays enabled across the switchover; the roles simply swap, and no reinstate
  is involved (reinstate remains out of scope page-wide).
- The broker's documented step sequence: verify the states → convert the original primary to the
  standby role → update the broker configuration file → restart the former primary as the new
  standby (physical standby case) and start Redo Apply on it → open the new primary read/write and
  start redo transport. "Note that the new primary database does not need to be restarted." **Only
  the former primary restarts.**
- Duration is environment-dependent, not parameter-driven — the same labeling rule as failover
  execution. The documented factors: unapplied redo on the target ("By choosing the standby
  database with the least amount of unapplied redo, you can minimize the overall time"), update
  activity on the primary ("ensure the primary database is in a quiet state"), and dirty online
  redo logs on the target ("It takes time to clear online redo logfiles. This may slow down
  switchover").
- User sessions on the primary do not survive its conversion to a standby — the SQL-level path is
  `COMMIT TO SWITCHOVER ... WITH SESSION SHUTDOWN`, and `SWITCHOVER TO` handles it from 12.1 on.
  Phrase it as "terminated as the primary converts". (`STANDBY_DB_PRESERVE_STATES` covers sessions
  on the *standby* and is deliberately out of scope.)
- Both hosts stay up, so both listeners answer the whole time: a client dialing mid-switchover gets
  an instant `ORA-12514` from whichever address has no read-write service, never a TCP timeout.
  That is why the application panel grays out the dead-address behaviour toggle and why
  `TRANSPORT_CONNECT_TIMEOUT` / `CONNECT_TIMEOUT` cannot move its ladder.

Drawing idealizations specific to this scenario (footnote 3 on the page):

- `SW_VERIFY` = 1 s and `SW_CONVERT` = 2 s are **nominal drawing constants**, not documented
  durations — the broker's step list carries no timings at all. `tDown` (the moment the primary
  stops taking work) is the end of the verify band, and `tOpen = SW_VERIFY + SW_CONVERT +
  apply lag + role transition`.
- The former primary's restart is drawn as one band running from `tDown` past the new primary's
  open, ending without a marker or a number. The doc's step list puts that restart *before* the
  open, but the open is what ends the application's outage and does not wait for the restart, so
  the band is drawn in parallel and makes no claim about where it ends.
- The worst-case client is taken to start dialing at `tDown`, not at t = 0: before the conversion
  the primary answers normally.

Sources: the broker's [switchover chapter](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html)
(prerequisites, step list, the FSFO-enabled restriction, the former-primary restart, "the new
primary database does not need to be restarted", the zero-data-loss sentence) and
[Managing Oracle Data Guard Role Transitions](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/managing-oracle-data-guard-role-transitions.html)
(the two-phase transition, `SWITCHOVER ... VERIFY`, the duration factors, and the
`WITH SESSION SHUTDOWN` heritage).

## Configuration files (the simulator's chapter 4)

Chapter 5 renders the workbench state as the commands and files that would set
it. Verified facts it relies on:

- Property scope, per the broker properties reference: `FastStartFailoverThreshold`,
  `FastStartFailoverLagLimit`, `FastStartFailoverPmyShutdown`,
  `FastStartFailoverAutoReinstate`, `ObserverPingInterval` and `ObserverPingRetry`
  are **configuration properties** (`EDIT CONFIGURATION SET PROPERTY name = value;`),
  while `LogXptMode` and `NetTimeout` are **per-member properties**
  (`EDIT DATABASE 'name' SET PROPERTY 'name' = 'value';` — scope "database, far
  sync instance, Recovery Appliance"). The scope wording for the ping properties
  comes from the 21c edition, the same cross-edition citation as their defaults.
- Command syntax, per the 19c broker commands reference:
  `EDIT CONFIGURATION SET PROTECTION MODE AS MAXPROTECTION|MAXAVAILABILITY|MAXPERFORMANCE;`,
  `ENABLE FAST_START FAILOVER;`, and `CONNECT sys@alias AS SYSDBA` (the docs'
  own examples include `EDIT DATABASE 'South_Sales' SET PROPERTY 'LogXptMode'='SYNC';`).
- `START OBSERVER;` runs the observer in the foreground and holds the prompt;
  `START OBSERVER IN BACKGROUND;` returns the prompt and "is the preferred
  method for starting an observer" (19c broker, fast-start failover chapter).
  The same chapter's prerequisite list has the observer host running DGMGRL
  with a configured `tnsnames.ora`.
- The `LOG_ARCHIVE_DEST_2` card is the **hand-set equivalent** of what the four
  transport properties mean, built from the property→attribute mapping above —
  it is deliberately not presented as the literal string the broker composes.
  `NET_TIMEOUT` is omitted from the ASYNC variant on the strength of the
  figure-4 facts (it bounds the SYNC ack wait and never affects sessions under
  ASYNC).
- Fixture names, not facts: `prm01`/`sby01` (DB_UNIQUE_NAME and connect
  aliases), hosts `dc1-prm01`/`dc2-sby01`, service `app_svc` — shared with the
  application view.

## Side topics (the simulator's chapter 5)

Chapter 6 collects what sits beside the mainline story: SDU and `oratcptest` before SYNC is
switched on, measuring what SYNC costs once it is, and the NET_TIMEOUT panels (figure 4), which
moved here out of chapter 2. Verified facts behind the two new sections:

**SDU.** The HA guide's "Set SDU Size to 65535 for Synchronous Transport Only" says Oracle testing
has shown that setting SDU to 65535 improves the performance of synchronous transport, and it is
set per connection through `SDU` in `tnsnames.ora` and `listener.ora`, or for every Oracle Net
connection through `DEFAULT_SDU_SIZE` in `sqlnet.ora`. Three constraints on how these assets phrase
it:

- The recommendation is scoped to **synchronous transport only** — that scoping is the section's
  own title. The guide does not say ASYNC gets no benefit, so neither does the page.
- The guide calls 65535 "its maximum value". That wording is stale: the Net Services reference
  gives `DEFAULT_SDU_SIZE` a default of **8192** and a range of **512 – 2097152** (2 MB). Say "the
  recommended 65535" and never "the parameter's maximum"; do not offer 2 MB as a recommendation
  either.
- SDU is negotiated per connection and the lower of the two ends wins, which is why both ends are
  set. It is a best practice, never a requirement — do not write that SYNC needs it.

**Socket buffers (`SEND_BUF_SIZE`, `RECV_BUF_SIZE`).** These are Oracle Net parameters, *not*
`LOG_ARCHIVE_DEST_n` attributes, and the two guides approach them from opposite ends — the page
carries both because they answer different questions.

- Net Services Reference: each specifies the buffer space limit for session send / receive
  operations, supported by TCP/IP, TCP/IP with TLS and SDP; the default "is operating system
  specific", with Linux 2.6 given as **16 KB** for `SEND_BUF_SIZE` and **87380 bytes** for
  `RECV_BUF_SIZE`. Either can be overridden per client connection in the connect descriptor.
- Net Services Administrator's Guide, "Configuring I/O Buffer Space": buffers "should be set to at
  least the bandwidth-delay product", worked as 100 Mbps × 5 ms = 62,500 bytes ≈ 64 KB, and it
  raises the redo case itself — a 1 MB largest redo message would justify 1 MB, while 64 KB
  suffices when the average message is smaller. Same page: the actual value "may be less than the
  value specified because of limitations in the host operating system or due to memory
  constraints", and total memory scales with concurrent connections. Its examples put the two
  parameters inside an `ADDRESS` *or* at `DESCRIPTION` level, in `listener.ora`, `tnsnames.ora` and
  `sqlnet.ora` — which is why the config card shows both placements.
- HA guide, "Set Send and Receive Buffer Sizes": the minimum recommended socket buffer size is
  **3 × BDP**, "especially for a high-latency, high-bandwidth network", and its route is to let the
  TCP stack size sockets dynamically while raising the kernel maxima `tcp_rmem` / `tcp_wmem`,
  tuned with oratcptest. **Do not derive a BDP from its Linux example**: the text says to set the
  maximum to 3\*BDP and that "in this example BDP is 16MB", while the command sets 16777216 (16 MB).
  The page quotes the command and never a derived BDP; keep it that way.

**oratcptest.** Downloaded from **MOS note 2064368.1** (login required), needs JRE 6 or later, runs
as any OS user, verified with `java -jar oratcptest.jar -help`. The utility "simulat[es] Data Guard
SYNC transport by waiting for acknowledgment (ACK) of a packet or ASYNC transport by not waiting
for the ACK". Average redo write size = `redo size` / `redo writes` (`V$SYSSTAT` or AWR), which the
guide says to use in the experiments and the page uses as `-length`. Flag provenance matters here:

- The public 19c page documents only `-server`, `-port`, `-mode`, `-duration`, `-interval`,
  `-num_conn`, `-output` and `-freq`, with the host given positionally on the client side.
- `-length`, `-write` and `-file` come from MOS 2064368.1, which cannot be fetched without a login;
  their shape is corroborated by independent public write-ups (`-file` on the server, `-write` on
  the client asking the server to write each message to disk, mimicking the SRL write an AFFIRM
  standby pays). The config card says so and points at `-help` — keep that provenance line if the
  card is ever edited.
- Its output reports the socket buffer size each connection used, and the guide warns that "that
  value is half of the actual socket buffer size and should be doubled to find the actual size
  used". The same page says **not** to use the tool's `sockbuf` parameter, "because the kernel
  parameters which govern explicit requests for socket buffer size are different than those set
  for this test". Both warnings are on the page and in the config card.

**Measuring the impact of SYNC.** From "Tuning and Troubleshooting Synchronous Redo Transport" on
the redo-transport troubleshooting page (the same page as the thirteen-step commit path):

- Containment, straight off those thirteen steps: `log file sync` (step 1 → 13, the foreground's
  whole cycle) contains `redo write time` (step 3 → 8, LGWR's write operation), which contains both
  `SYNC remote write` (step 5 → 8, the remote leg) and `log file parallel write` (step 6, the local
  redo write I/O). `RFS random i/o` is the standby-side event for its standby redo log write.
- **Terminology.** `log file sync`, `log file parallel write`, `SYNC remote write` and
  `RFS random i/o` are wait events. `redo write time` is **not** — it is a `V$SYSSTAT` statistic
  whose Database Reference description is "Total elapsed time of the write from the redo log buffer
  to the current redo log file in 10s of milliseconds", i.e. centiseconds. Never call it a wait
  event, and always carry the unit: it is the trap when it is compared against millisecond averages.
- The max()-not-sum rule from the commit view applies unchanged, and for the same reason. The
  drawing must never show the local and remote legs as sequential, Oracle never calls the overlap
  "parallel", and `log file parallel write` is never cited as evidence of it (listing it as the
  local write's I/O event is fine).
- **Averages are misleading, on the record**: "Oracle does not recommend using log file sync wait
  times to measure the impact of SYNC because the averages can be very deceiving". Commit batching
  makes many sessions wait on one slow write. For OLTP the guide says to watch transactions per
  second and the redo rate; for batch loads, elapsed time.
- The worked example (Table 17-3, Oracle's own test system): redo rate unchanged, `log file sync`
  0.68 ms → 4.60 ms, TPS −20.3%, redo writes −61% while the average redo write size grew +94%.
  **These are Oracle's numbers on Oracle's system** — the page says so, and any edit must keep that
  framing. They are never "what SYNC costs".
- Lag views: `V$DATAGUARD_STATS` for transport and apply lag (read `DATUM_TIME` beside them — it is
  when the value was computed), `V$STANDBY_EVENT_HISTOGRAM` for the history of those lag values.

## What 26ai changes (the simulator's edition switch)

The simulator's Reference chapter carries the full change list; the facts below are the ones the
26ai edition actually *draws*, plus the two whose sourcing needs a caveat.

### `FastStartFailoverLagLimit` in MaxAvailability

**26ai gives the property a MaxAvailability role, and its broker default there is 0.** Zero is the
19c rule written as a number — the standby must hold every change the primary generated, and the
fast-start failover loses nothing. Any non-zero value (minimum 5 s, as in MaxPerformance) makes
MaxAvailability a bounded-loss mode instead: failover is permitted while the standby's apply lag is
at or below the limit, and the loss is bounded by it. `V$FAST_START_FAILOVER_CONFIG` names the two
states `ZERO DATA LOSS` and `POTENTIAL DATA LOSS`. MaxPerformance is unchanged: default 30 s,
minimum 5 s. The 26ai prerequisites table also lists `ASYNC` among the transports allowed for a
MaxAvailability fast-start failover target, where 19c listed only `SYNC` and `FASTSYNC` — zero data
loss there still wants one of those two.

**Oracle's own 26ai pages contradict each other on this, so cite the right one.** The operative text
is the fast-start failover chapter's *Fast-start Failover Protection Modes* section, together with
the per-mode defaults and the `V$FAST_START_FAILOVER_CONFIG` mode values. The **stale** text — still
carrying the 19c "used only in maximum performance mode" sentence — is that same chapter's *Task 3*
and the **closing line of the `FastStartFailoverLagLimit` property page**. Never cite either of those
two for this behaviour, and never quote the property page's last sentence as if it were current; the
property page is a valid citation for the value ranges only. Task 3 is stale on the transports too —
it still says MaxAvailability takes `SYNC` or `FASTSYNC`, against the prerequisites list's
`SYNC or FASTSYNC or ASYNC`. The simulator states the contradiction in footnote 5 rather than
hiding it, and its commit view flags `ASYNC` under MaxAvailability as a mode **conflict only under
19c**; under 26ai the same pairing draws an informational "allowed" note that zero data loss still
wants `SYNC` or `FASTSYNC`.

Two neighbouring properties did **not** move: `FastStartFailoverLagType` and
`FastStartFailoverLagGraceTime` are both documented as maximum-performance-mode behaviour, whatever
the lag limit is doing in MaxAvailability. The simulator grays both out in MaxAvailability and says
so. Two of their finer points, verified on the 26ai property pages: the `LAGGING` permission may be
granted **by the observer or by the target standby** — never word it as the observer's alone — and
`FastStartFailoverLagGraceTime` is defined only **while fast-start failover is enabled** in maximum
performance mode, so with no observer deployed the simulator's reopen panel draws no stall and no
grace band (`computeReopen` takes `fsfoEnabled` for exactly this). Under `TRANSPORT` the simulator
models the selected lag honestly: a transport-lag slider (clamped to the apply lag, since applied
redo must have arrived) is what the readiness gate, the loss bound and the refusal banners follow,
while terminal recovery still pays the apply lag.

### `PrimaryDatabaseCandidates`

**It is a fence for the fast-start-failover-*disabled* case, not an extra gate on FSFO.** The
property lists the members the broker is allowed to make primary. While fast-start failover is
disabled it restricts both `SWITCHOVER` and `FAILOVER` to that list, and a transition to a member
that is not listed is refused with
[`ORA-16529`](https://docs.oracle.com/en/error-help/db/ora-16529/). Once fast-start failover is
enabled it adds no new restriction, because `FastStartFailoverTarget` already governs which member
can become primary. The broker adds the current primary to the list itself if the list omits it, and
the default — an empty string — restricts nothing. Never word it as "a fence around fast-start
failover".

**The 19.26 backport is unofficial.** It is reported by the Data Guard product manager's blog series
and is not reflected in Oracle's release-update documentation, so state it as reported, never as
documented.

### `V$FS_FAILOVER_OBSERVERS`

26ai adds per-observer diagnostics: seconds since the observer last pinged the primary and the
target, and the full paths of the observer's log and state files. Two things to keep straight:
`CURRENT_TIME` is **the time the query was run**, not an observer heartbeat, and the view's behaviour
is defined only when it is queried **on the primary** — the reference page says so, so never present
its output as queryable anywhere in the configuration. The same scoping applies to
**`V$FAST_START_FAILOVER_CONFIG`**: the Data Guard views applicability table marks it *Primary*
("query this view on the primary database"), so never describe it as queryable on any member.

### Scripting surfaces predate 26ai

The change table's *Scripting surfaces* row is the one place where "what 26ai changes" overstates
novelty if left unqualified: the official SQLcl `DG` command page is scoped to "Oracle Database
release 21c only" and the ORDS Data Guard REST endpoints are documented in ORDS 23.3. Both therefore
arrived before 26ai, which the table's caption already frames ("including what arrived in 21c and
23ai"); the row itself names the two releases so the caption does not have to carry it alone.

## Drawing idealizations (the simulator's footnote 4)

Where the simulator draws something it cannot know, it is listed on the page itself and here:

- Commit latency is `max(local write, remote ack path)` on the strength of the documented step
  ordering above — not on any Oracle statement that the two run in parallel.
- RFS processing on the standby is drawn as 0 ms; the standby redo log write is the only
  standby-side cost modelled.
- The `ASYNC` ship-done marker is illustrative — the redo is assumed to leave as soon as the local
  write finishes.
- Reopen retries are drawn at exact `ReopenSecs` multiples. The real trigger is the first log
  switch after the interval has elapsed, so a real retry lands at or after each mark.
- The unshipped-redo gap drains at five times the generation rate (a net four times), a stand-in
  for whatever headroom the link and the standby's apply really have.
- The standby's apply lag is taken as ~0 at the moment the destination closes, growing one second
  per second while nothing arrives — which is what puts the MaxPerformance disarm marker exactly
  one `FastStartFailoverLagLimit` after the break, against t = 0 in MaxAvailability, where the
  standby is unsynchronized immediately.
- Client-side constants in the application view are nominal (footnote 3): 0.2 s for an `ORA-12514`
  refusal, 0.15 s for an OS-level refusal, 0.3 s to establish a session.
- The chapter-6 containment drawing has no scale at all: the bar widths show which span contains
  which, nothing else, and the drawing says so on its face. The one relationship it does assert is
  that the remote leg is drawn longer than the local one, which is the case the picture is about.

## Topology features (the workbench's far sync, cascading, multi-target and multi-observer views)

Everything above this section is the 1+1+1 deployment the four figures draw: one primary, one
standby, one observer. The workbench in [`app/`](../app/README.md) generalizes it, and the facts
behind that generalization live in a second verified fact sheet —
**[`app/design/facts.md`](../app/design/facts.md)**, researched 2026-08-16 against docs.oracle.com
and re-verified 2026-08-17, marking every claim `[D]` documented / `[D-later]` documented in a
later edition / `[UNDOC]` not found / `[CONFLICT]` two Oracle pages disagree. That file, not this
one, is the source of record for far sync, cascading, `RedoRoutes`, multiple standbys, multiple
fast-start failover targets and multiple observers; every citation in it is an entry in
`app/src/engine/citations.ts` (URL plus the quoted sentence), and the application's accuracy
labelling resolves through it. The condensed rules — including what must never be written — are in
[AGENTS.md](../AGENTS.md), in the accuracy-rules section.

**The static figures in this directory still draw only the classic 1+1+1 with the observer at a
third site.** They were not regenerated for the new topologies and they do not claim to cover
them; when a figure and the workbench disagree about scope, the figure is the narrower statement,
not the wrong one.

What the new fact sheet pins, in one line each:

- **Far sync** — an instance that receives redo into SRLs and archives them, has no user data
  files, cannot be opened, cannot apply redo, and can never be primary or become a standby. It has
  no broker state. A far sync edge does **not** replace the primary↔standby link: Oracle requires a
  direct connection between them for health checks and switchover. Primary→far sync is SYNC (or
  ASYNC in maximum performance); far sync→terminal is documented as ASYNC. Under fast-start failover
  the far sync must be SYNC or FASTSYNC and the target standby ASYNC, and the target itself can
  never be a far sync instance. Protection-mode support is a documented **conflict** between the
  Concepts and Administration far-sync chapter and the broker guide's fast-start failover
  prerequisites.
- **Cascading** — a terminal standby receives redo indirectly from a cascading standby; only
  physical standbys cascade; real-time cascading needs Active Data Guard; the fan-out limit is 30
  terminal destinations. On the cascader's own destinations 1–10, ASYNC ships in real time while
  SYNC or an unspecified mode ships non-real-time; 11–31 are ASYNC only. Cascade *depth* is
  undocumented. A terminal standby is a documented **manual** failover target — with the documented
  warning that no attempt is made to transmit unsent redo from the cascader — and fails the
  fast-start failover prerequisite that the target receive redo directly from the primary.
- **Multiple standbys and multiple targets** — `FastStartFailoverTarget` takes a list of physical or
  logical standbys (never a snapshot standby, far sync instance or Zero Data Loss Recovery
  Appliance) or `ANY`; the broker "selects a target based on the order in which they are specified"
  (never "the first viable one"); with more than one standby the property must be set explicitly;
  targets are verified when fast-start failover is enabled. `BystandersFollowRoleChange` defaults to
  ALL. For maximum protection, the "at least one synchronized standby" sentence is on the broker
  guide's configuration-members page — the protection-modes page spells it out only for maximum
  availability.
- **`RedoRoutes`** — `(source : destination)` with `LOCAL | ANY | name[,name]` sources,
  `ALL | name` destinations, `SYNC | FASTSYNC | ASYNC` attributes, `PRIORITY=n` groups (1–8, default
  1 for far sync members and 8 otherwise, and 19c documents this, not just 26ai), and 12.1's
  `ALT=(… FALLBACK)` as the older spelling. `GROUP` is a `LOG_ARCHIVE_DEST_n` attribute, **not**
  `RedoRoutes` syntax. Routes are pre-declared in both directions and nothing rewrites them on a
  role change.
- **Multiple observers** — three in 19c, four from 21c, and 26ai contradicts itself (four in the
  fast-start failover chapter and on `START OBSERVER`, three on `SHOW OBSERVER` and on the
  `V$FS_FAILOVER_OBSERVERS` reference page). Only the master observer coordinates fast-start
  failover, and while fast-start failover is disabled "all observers have the same functionality" —
  so no master badge then. The nomination of a backup observer carries its documented precondition
  (primary and target standby still connected). `START OBSERVER … FILE IS …`, never `FILE=`.
- **Member types and destination counts** — physical standbys cascade and may be targets; logical
  standbys may be targets but do not cascade; snapshot standbys do neither; far sync instances
  forward redo and are never targets. `LOG_ARCHIVE_DEST_n` runs 1–31, with `LOCATION` or `SERVICE`
  on 1–10 and `SERVICE` only on 11–31; the cascading limit is 30 **terminal destinations**, which is
  not the same claim as "30 remote destinations".

### Oracle pages the application cites for these

Beyond the links in the section below, `app/src/engine/citations.ts` cites:

- [Creating a Far Sync Instance (19c Data Guard Concepts and Administration)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/creating-oracle-data-guard-far-sync-instance.html)
- [Managing Broker Configuration Members (19c broker, chapter 4 — far sync management, the cascading and PRIORITY examples, and the maximum-protection "at least one synchronized standby database" wording)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/managing-oracle-data-guard-broker-configuration-members.html)
- [Oracle Data Guard Broker Properties (19c — `RedoRoutes` including the `PRIORITY=n` grammar, `PreferredObserverHosts`, `TransportDisconnectedThreshold`, `ConfigurationWideServiceName`)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-properties.html)
- [Oracle Data Guard Broker Commands (19c — `ADD FAR_SYNC`, `ENABLE FAR_SYNC`, `VALIDATE FAR_SYNC`, `START OBSERVER … FILE IS … IN BACKGROUND`, `SHOW OBSERVER`, `SHOW CONFIGURATION WHEN PRIMARY IS`)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-commands.html)
- [Using the Broker to Manage Switchovers and Failovers (19c, chapter 5 — the far-sync transport prerequisite, the direct-redo prerequisite, multiple observers and the master-observer rules)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html)
- [Scenarios Using the DGMGRL Utility (19c — Scenario 6, the nomination precondition; Scenario 16, observe-only mode)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/examples-using-data-guard-broker-DGMGRL-utility.html)
- [Redo Transport Services (19c Data Guard Concepts and Administration, §7.3 — cascading, the 30 terminal destinations, real-time vs. non-real-time by destination number)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/oracle-data-guard-redo-transport-services.html)
- [Redo Routing Rules (12.1 broker, chapter 4 — the original `RedoRoutes` grammar and `ALT=(… FALLBACK)`)](https://docs.oracle.com/database/121/DGBKR/dbresource.htm)
- [Changes in Oracle Data Guard Broker 12c Release 2 (12.2 — multiple fast-start failover targets, observer configuration groups, `ConfigurationWideServiceName`)](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/dgbkr/release-changes.html)
- [Using the Broker to Manage Switchovers and Failovers (21c — "There can be up to four observers for a single Data Guard configuration")](https://docs.oracle.com/en/database/oracle/oracle-database/21/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html)
- [Redo Routing Rules (26ai — the parenthesised `PRIORITY` groups, with no `ALT`/`FALLBACK`)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/redo-routing-rules.html) and [the 26ai `RedoRoutes` property page ("a member whose MaxFailure property is set to zero cannot be part of a RedoRoutes group")](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/redoroutes.html)
- [Fast-Start Failover (26ai broker — four observers)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html) against [SHOW OBSERVER (26ai — still "up to 3")](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/show-observer.html) and [V$FS_FAILOVER_OBSERVERS (26ai — "returns three rows")](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-FS_FAILOVER_OBSERVERS.html) — the conflict the page shows rather than resolves
- [LOG_ARCHIVE_DEST_n parameter attributes (19c — `GROUP`, `PRIORITY`, `ALTERNATE`, `MAX_FAILURE`, the 1–31 range)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html)
- Error-help pages for the refusals the application names: [ORA-16529](https://docs.oracle.com/en/error-help/db/ora-16529/), [ORA-16654](https://docs.oracle.com/en/error-help/db/ora-16654/), [ORA-16658](https://docs.oracle.com/en/error-help/db/ora-16658/), [ORA-16820](https://docs.oracle.com/en/error-help/db/ora-16820/), [ORA-16867](https://docs.oracle.com/en/error-help/db/ora-16867/)

## Oracle documentation

- [Oracle Data Guard Broker Properties (19c)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-properties.html)
- [Switchover and Failover Operations (19c, chapter 5 — the switchover prerequisites and step list, and the list headed "Fast-start failover cannot occur if:", one of whose ten entries is "The master observer is not running" (the fourth; the list opens with "Fast-start failover is no longer enabled"). **Table 5-1** lists `FS_FAILOVER_STATUS` per role and is the source for `PRIMARY UNOBSERVED` being a **target-standby** status; the chapter's worked example prints the pair — primary `SYNCHRONIZED` with `FS_FAILOVER_OBSERVER_PRESENT` `NO`, target standby `PRIMARY UNOBSERVED` with `YES`. *Performing Manual Role Changes When Fast-Start Failover Is Enabled* qualifies "You can perform a manual failover even if fast-start failover is enabled" with three conditions: the target is the `FastStartFailoverTarget` standby; it is synchronized (maximum availability/protection) or within the lag limit (maximum performance); and, for a manual failover, "the observer is started and communicating with the target standby database", with the primary shut down first)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html)
- [ObserverOverride (19c Data Guard Broker Properties — default FALSE; TRUE allows an automatic failover once the observer has lost the primary, "even if the standby has a healthy connection to the primary". Every figure and every simulator cell here assumes the default)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-properties.html)
- [Managing Oracle Data Guard Role Transitions (19c Data Guard Concepts and Administration — the two-phase switchover, `SWITCHOVER ... VERIFY`, duration factors, `COMMIT TO SWITCHOVER ... WITH SESSION SHUTDOWN`)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/managing-oracle-data-guard-role-transitions.html)
- [LOG_ARCHIVE_DEST_n parameter attributes (19c Data Guard Concepts and Administration)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html)
- [LOG_ARCHIVE_DEST_n (19c Database Reference)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/LOG_ARCHIVE_DEST_n.html)
- [Oracle Data Guard Broker Properties (21c — documents `ObserverPingInterval` / `ObserverPingRetry`)](https://docs.oracle.com/en/database/oracle/oracle-database/21/dgbkr/oracle-data-guard-broker-properties.html)
- [Local Naming Parameters in the tnsnames.ora File (19c Net Services Reference — connect-descriptor timeout parameters. The current edition of this page is also the source for the per-IP scope: the timeout "is applicable for each ADDRESS in an ADDRESS_LIST description, and each IP address that a host name is mapped to", with a bare value read as seconds and `ms`/`sec`/`min` suffixes accepted)](https://docs.oracle.com/en/database/oracle/oracle-database/19/netrf/local-naming-parameters-in-tns-ora-file.html)
- JDBC thin driver connect-timeout defaults, behind the generated thin URL always spelling `TRANSPORT_CONNECT_TIMEOUT` with a `sec` suffix: [OracleConnection (19c JDBC API Reference — `oracle.net.CONNECT_TIMEOUT` default 0, no timeout)](https://docs.oracle.com/en/database/oracle/oracle-database/19/jajdb/oracle/jdbc/OracleConnection.html) versus [OracleConnection (current JDBC API Reference — the same property's default is now 20000 ms)](https://docs.oracle.com/en/database/oracle/oracle-database/26/jajdb/oracle/jdbc/OracleConnection.html). The exact release that changed the default is not stated on either page, so these assets do not name one.
- [Oracle Net TNS String Parameters (19c High Availability Overview — recommended client failover settings)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/oracle-net-tns-string-parameters.html)
- [Connection Time Estimates During Data Guard Switchover or Failover (19c High Availability Overview)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/connection-time-estimates-data-guard-switchover-or-failover.html)
- [Managing Broker Configuration Members (19c — protection modes vs. redo transport modes, Table 4-2)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/managing-oracle-data-guard-broker-configuration-members.html)
- [Oracle Data Guard Protection Modes (19c Data Guard Concepts and Administration — attribute-level Table 6-1)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/oracle-data-guard-protection-modes.html)
- [Oracle Data Guard Redo Transport Services (19c Data Guard Concepts and Administration)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/oracle-data-guard-redo-transport-services.html)
- [Redo Transport Troubleshooting and Tuning (19c High Availability Overview — the thirteen-step SYNC commit path; "Tuning and Troubleshooting Synchronous Redo Transport" for the wait-event containment chain, the `redo write time` statistic, the averages-are-misleading warning, the worked before/after example and the lag views)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/redo-transport-troubleshooting-and-tuning.html)
- [Plan an Oracle Data Guard Deployment (19c High Availability Overview — `oratcptest`, its documented flags, and average redo write size = redo size / redo writes)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/plan-oracle-data-guard-deployment.html)
- [Configure and Deploy Oracle Data Guard (19c High Availability Overview — "Set SDU Size to 65535 for Synchronous Transport Only")](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/configure-and-deploy-oracle-data-guard.html)
- [Parameters for the sqlnet.ora File (19c Net Services Reference — `DEFAULT_SDU_SIZE` default 8192, range 512 – 2097152; `SEND_BUF_SIZE` / `RECV_BUF_SIZE` purpose and OS-specific defaults)](https://docs.oracle.com/en/database/oracle/oracle-database/19/netrf/parameters-for-the-sqlnet.ora.html)
- [Optimizing Performance (19c Net Services Administrator's Guide — "Configuring I/O Buffer Space": the bandwidth-delay product worked example and where the buffer parameters go in `sqlnet.ora`, `tnsnames.ora` and `listener.ora`)](https://docs.oracle.com/en/database/oracle/oracle-database/19/netag/optimizing-performance.html)
- [Statistics Descriptions (19c Database Reference — `redo write time` "in 10s of milliseconds", `redo size`, `redo writes`)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/statistics-descriptions-2.html)
- MOS note 2064368.1, "Assessing and Tuning Network Performance for Data Guard and RMAN" — the `oratcptest.jar` download and its `-length` / `-write` / `-file` options. **My Oracle Support, login required**, so it cannot be re-verified from a browser without an account; treat its flag spellings as unconfirmed against the vendor and check `-help` instead.
- [Optimizing Automatic Failover (19c High Availability Overview — the primary's stall condition, and where the observer belongs: "ideally … at a third site or third data center so that the primary, observer, and standby have isolated power, server, storage, and network infrastructure"; "have the observer use the same path to connect to the production database as is used by the application tier"; and, whatever else, "the observer should never be deployed at the primary database server or cluster, or on the standby database server or cluster". Where the application tier is local to the production database it says to deploy the observer "at either the standby location or a third data center" instead)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/optimizing-automatic-failover-common-scenarios-minimize-downtime1.html)
- [Configuring Data Guard (12.1 High Availability Best Practices, §8.5.2.3 "Fast-Start Failover Best Practices" — the observer-placement hierarchy: a host outside both data centres first, ideally "equally distant" from them, then "the same network as the application", then "locate the observer in the standby data center on a separate host and isolate the observer as much as possible from failures affecting the standby database". A cross-edition citation, the same precedent as the 21c `ObserverPing*` pages: the hierarchy is stated most completely in this edition)](https://docs.oracle.com/database/121/HABPT/config_dg.htm)
- [Changes in Oracle Data Guard Broker 12c Release 1 (12.1 — the only edition that documents `FASTSYNC` as new)](https://docs.oracle.com/database/121/DGBKR/release_changes.htm)
- [Changes in Oracle Data Guard Broker 12c Release 2 (12.2 — automatic backup-observer promotion)](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/dgbkr/release-changes.html)
- [Scenarios Using the DGMGRL Utility (19c — Scenario 6, registering and managing multiple observers)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/examples-using-data-guard-broker-DGMGRL-utility.html)
- [Oracle Data Guard Broker Commands (19c — `SET MASTEROBSERVER TO`; the `EDIT`/`ENABLE`/`CONNECT` syntax behind the chapter-5 config cards)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-commands.html)
- [V$DATABASE (19c Database Reference — `FS_FAILOVER_STATUS`, `FS_FAILOVER_OBSERVER_PRESENT` "whether the master observer is currently connected to the local database"; `DISABLED` is what `FS_FAILOVER_STATUS` reads when fast-start failover was never enabled)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DATABASE.html)
- Transparent Application Failover and Application Continuity: the 26ai Net Services Administrator's
  Guide TAF pages and the 19c *Real Application Clusters Administration and Deployment Guide*. TAF
  reconnects and, with `SELECT` failover, continues an open fetch, but **cannot replay a
  transaction** — an active transaction is rolled back and the application has to handle the error
  and re-submit. Application Continuity is the conditional-replay mechanism beside it: replay-eligible
  requests only, and a replay whose result cannot be verified against the original is rejected. Cited
  by title rather than by URL because these pages move between editions; look them up in the edition
  you are writing for.
- [ORA-16820 — fast-start failover observer is no longer observing this database](https://docs.oracle.com/en/error-help/db/ora-16820/)
- [ORA-16658 — unobserved fast-start failover configuration](https://docs.oracle.com/en/error-help/db/ora-16658/)
- [ORA-16529 — invalid database for the operation (the refusal a `SWITCHOVER`/`FAILOVER` to a member outside `PrimaryDatabaseCandidates` gets while fast-start failover is disabled)](https://docs.oracle.com/en/error-help/db/ora-16529/)

### 26ai (the simulator's edition switch)

- [Fast-Start Failover (26ai broker guide — the section **"Fast-start Failover Protection Modes"**, the operative text for `FastStartFailoverLagLimit` in MaxAvailability: 0 as the broker default there, zero data loss at 0 and bounded loss above it, the per-mode defaults, and the prerequisites table that lists `ASYNC` for a MaxAvailability target. Cite **this section**, never the same chapter's *Task 3*, which still carries the stale 19c "maximum performance mode only" sentence)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html)
- [FastStartFailoverLagLimit (26ai Data Guard Broker Properties — the value ranges: 30 s default and 5 s minimum in MaxPerformance, 0 the default in MaxAvailability. Also the source for the **keep-it-at-or-below-the-threshold recommendation**: "It is recommended to set the FastStartFailoverLagLimit lower than or equal to FastStartFailoverThreshold", with the warning that a larger limit lets the primary "keep committing after the Fast-Start Failover is initiated, exposing the configuration to the risk of having two primary databases for a short period of time". **Its closing line still says the property is used only in maximum performance mode**, which the protection-modes section above contradicts; quote this page for ranges and the recommendation only, never for the mode question)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlaglimit.html)
- [FastStartFailoverLagType (26ai Data Guard Broker Properties — `APPLY` default / `TRANSPORT`; which lag `FastStartFailoverLagLimit` is measured against; documented as maximum-performance-mode behaviour, and it did **not** follow the lag limit into MaxAvailability)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlagtype.html)
- [FastStartFailoverLagGraceTime (26ai Data Guard Broker Properties — default 0 = off, minimum 5 s when set; how many seconds before the lag limit the primary asks permission to enter the `LAGGING` state, and the up-to-one-threshold wait at the crossing when it is 0. The permission is granted "by the observer or target standby" — either one — and the page scopes the property to "when fast-start failover is enabled and the configuration is operating in maximum performance mode", which is why no observer means no stall)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlaggracetime.html)
- [ObserverPingInterval](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/observerpinginterval.html) and [ObserverPingRetry (26ai Data Guard Broker Properties — the pages giving the **broker defaults as 0** — not set — while retaining the explicitly-set minimums of 100 ms and 10; the 26ai FSFO chapter's table still shows 100 ms / 10, an upstream contradiction the simulator's 26ai defaults column notes)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/observerpingretry.html)
- [Oracle Data Guard views applicability table (26ai Concepts and Administration — marks `V$FAST_START_FAILOVER_CONFIG` as **Primary**: "query this view on the primary database", the source for the simulator's query-it-on-the-primary wording)](https://docs.oracle.com/en/database/oracle/oracle-database/26/sbydb/oracle-data-guard-in-oracle-database-views.html)
- [Fast-Start Failover (26ai broker guide — the normative 26ai text the Reference chapter cites, including the section "What Happens if the Master Observer Fails?": with the primary and target standby still connected, the broker nominates a backup observer as the new master, and no fast-start failover can occur until it is observing. That is the 26ai half of the observer-lost prose in chapter 1)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html)
- [PreferredObserverHosts (26ai Data Guard Broker Properties — a per-database property ranking which registered observer host should be master for that database; the source for the 26ai observer-lost prose naming it)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/preferredobserverhosts.html)
- [PrimaryDatabaseCandidates (26ai Data Guard Broker Properties — the list of members the broker may make primary. It restricts `SWITCHOVER` and `FAILOVER` **while fast-start failover is disabled**, adds nothing once it is enabled because `FastStartFailoverTarget` already governs the target, defaults to an empty string that restricts nothing, and the broker adds the current primary itself if the list omits it. The 19.26 backport is **reported by the product manager's blog series only** — not in Oracle's release-update documentation)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/primarydatabasecandidates.html)
- [VALIDATE FAST_START FAILOVER (26ai broker commands — the consolidated FSFO readiness checklist behind the simulator's 26ai config cards; note the underscore in the URL slug)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/validate-fast_start-failover.html)
- [Oracle Data Guard Broker Properties (26ai — the property index the Reference chapter's change list links as normative)](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/oracle-data-guard-broker-properties.html)
- 26ai Database Reference pages for the new/extended views cited in the change list: [V$FAST_START_FAILOVER_CONFIG](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-FAST_START_FAILOVER_CONFIG.html), [V$FS_LAG_HISTOGRAM](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-FS_LAG_HISTOGRAM.html), [V$DG_BROKER_PROPERTY](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-DG_BROKER_PROPERTY.html), [V$DG_BROKER_CONFIG](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-DG_BROKER_CONFIG.html), [V$FS_FAILOVER_OBSERVERS](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-FS_FAILOVER_OBSERVERS.html) (note two things on that page: `CURRENT_TIME` is **the time the query was run**, not an observer heartbeat, and the view's behaviour is defined only when it is queried **on the primary**); plus [DBMS_DG (26ai PL/SQL Packages Reference)](https://docs.oracle.com/en/database/oracle/oracle-database/26/arpls/DBMS_DG.html)
- Scripting surfaces that **predate 26ai**, both linked from the change table's *Scripting surfaces* row: [SQLcl `DG` (SQL Developer Command Line 25.3 — the command's own scope note is "Oracle Database release 21c only")](https://docs.oracle.com/en/database/oracle/sql-developer-command-line/25.3/sqcug/dg-data-guard.html) and [ORDS Data Guard REST endpoints (Oracle REST Data Services 23.3)](https://docs.oracle.com/en/database/oracle/oracle-rest-data-services/23.3/orrst/api-data-guard.html). Listing them under "what 26ai changes" without a date qualifier overstates the novelty — the row and the table caption both say when they arrived.
- [Ludovico Caldara's Data Guard 26ai blog series (ludovicocaldara.net — the practitioner walk-throughs of the 26ai broker changes behind the edition switch: the lag properties, multiple observers / `PreferredObserverHosts`, `VALIDATE FAST_START FAILOVER` and the new views. The simulator's Reference chapter "What changed in 26ai" table links the individual posts — #1 faster role transitions, #2 minimized stall, #3 lag type, #8 multiple ASYNC connections, #10–#12/#14 scripting surfaces, #15 PrimaryDatabaseCandidates, #21/#23/#27 SQL-side visibility, #25 V$FAST_START_FAILOVER_CONFIG, #26 the lag histogram, #28 VALIDATE — from the series index)](https://www.ludovicocaldara.net/blog/dg-26ai-series/)
