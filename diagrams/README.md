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
each exchange back to the timeline figures.

![Sequence diagram of fast-start failover: steady-state ping/ack and redo shipping, the primary crash, unanswered pings, the threshold clock, the observer's readiness exchange with the target standby, the failover command, and the standby's terminal recovery, role change and read-write open.](fsfo-sequence.svg)

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
| `FastStartFailoverLagLimit` | 30 s | 5 s | MaxPerformance mode only: maximum seconds the standby's apply point may lag the primary's redo generation point for fast-start failover to be permitted. Bounds data loss. |
| `FastStartFailoverPmyShutdown` | TRUE | — | If TRUE, a primary whose `V$DATABASE.FS_FAILOVER_STATUS` has been STALLED for longer than `FastStartFailoverThreshold` seconds — and that cannot reach the observer or the target standby — shuts itself down (abort). |
| `FastStartFailoverAutoReinstate` | TRUE | — | The old primary is automatically reinstated as a standby (via Flashback Database) when it returns. Reinstate is out of scope for these figures. |

### The ping-properties quirk

> **The `FastStartFailoverThreshold` property is ignored when the `ObserverPingRetry` and
> `ObserverPingInterval` properties are set.**

(Sourcing note: the sentence above, and the defaults in the table, come from the
`ObserverPingInterval` / `ObserverPingRetry` descriptions in the broker properties reference.
Curiously, the 19c edition of that page does not list these two properties at all, even though
they have existed since 12.2 and 19c DGMGRL accepts them — they appear in the 21c and later
editions, linked below.)

In other words: once a DBA explicitly sets both ping properties, detection is governed by
*interval × (retries + 1)* — the first failed ping plus its retries, roughly one second at the
minimum values — instead of by the 30-second threshold.
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
| `ReopenSecs` (deprecated in 19c) | `REOPEN` | 300 s | Minimum seconds before a failed destination is retried — at the first log switch after the interval has elapsed. Valid values 0 or greater; applies to all errors, not only connection failures. |
| `MaxFailure` (deprecated in 19c) | `MAX_FAILURE` | 0 — unlimited | Consecutive attempts to reestablish a failed destination before it is disabled, with no further access until it is manually reenabled. |
| `NetTimeout` | `NET_TIMEOUT` | 30 s (minimum 1 s) | Seconds LGWR blocks waiting for a SYNC acknowledgment. Never a failover clock — see figure 4. |

`ReopenSecs` and `MaxFailure` are deprecated as broker properties in 19c and still functional;
Oracle points to `EDIT DATABASE ... SET PARAMETER` for setting the underlying attributes instead.
Their semantics here follow the `LOG_ARCHIVE_DEST_n` attribute reference rather than the broker
properties page: the 19c broker page describes `MaxFailure` as "Corresponds to: VALID_FOR", which
is a documentation defect.

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
  unreachable.
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
  above (they need keepalives/`SQLNET.RECV_TIMEOUT`/FAN to die fast, and
  TAF/Application Continuity to resume work).

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

## Observer loss and multiple observers (the simulator's third scenario)

The simulator's `observer-lost` scenario kills the only observer host at t = 0 and leaves
everything else intact. Nothing fails over, and that is the point.

- The primary stalls only when it can reach *neither* the observer *nor* the target standby. With
  the standby still reachable it keeps serving; "no new transactions are able to commit" describes
  the double-loss case, not this one.
- While unobserved, `V$DATABASE.FS_FAILOVER_STATUS` reads `PRIMARY UNOBSERVED` and
  `FS_FAILOVER_OBSERVER_PRESENT` reads `NO` — that column reports "whether the master observer is
  currently connected to the local database".
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

## Oracle documentation

- [Oracle Data Guard Broker Properties (19c)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-properties.html)
- [Switchover and Failover Operations (19c, chapter 5)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html)
- [LOG_ARCHIVE_DEST_n parameter attributes (19c Data Guard Concepts and Administration)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html)
- [LOG_ARCHIVE_DEST_n (19c Database Reference)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/LOG_ARCHIVE_DEST_n.html)
- [Oracle Data Guard Broker Properties (21c — documents `ObserverPingInterval` / `ObserverPingRetry`)](https://docs.oracle.com/en/database/oracle/oracle-database/21/dgbkr/oracle-data-guard-broker-properties.html)
- [Local Naming Parameters in the tnsnames.ora File (19c Net Services Reference — connect-descriptor timeout parameters)](https://docs.oracle.com/en/database/oracle/oracle-database/19/netrf/local-naming-parameters-in-tns-ora-file.html)
- [Oracle Net TNS String Parameters (19c High Availability Overview — recommended client failover settings)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/oracle-net-tns-string-parameters.html)
- [Connection Time Estimates During Data Guard Switchover or Failover (19c High Availability Overview)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/connection-time-estimates-data-guard-switchover-or-failover.html)
- [Managing Broker Configuration Members (19c — protection modes vs. redo transport modes, Table 4-2)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/managing-oracle-data-guard-broker-configuration-members.html)
- [Oracle Data Guard Protection Modes (19c Data Guard Concepts and Administration — attribute-level Table 6-1)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/oracle-data-guard-protection-modes.html)
- [Oracle Data Guard Redo Transport Services (19c Data Guard Concepts and Administration)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/oracle-data-guard-redo-transport-services.html)
- [Redo Transport Troubleshooting and Tuning (19c High Availability Overview — the thirteen-step SYNC commit path)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/redo-transport-troubleshooting-and-tuning.html)
- [Optimizing Automatic Failover (19c High Availability Overview — the primary's stall condition)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/optimizing-automatic-failover-common-scenarios-minimize-downtime1.html)
- [Changes in Oracle Data Guard Broker 12c Release 1 (12.1 — the only edition that documents `FASTSYNC` as new)](https://docs.oracle.com/database/121/DGBKR/release_changes.htm)
- [Changes in Oracle Data Guard Broker 12c Release 2 (12.2 — automatic backup-observer promotion)](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/dgbkr/release-changes.html)
- [Scenarios Using the DGMGRL Utility (19c — Scenario 6, registering and managing multiple observers)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/examples-using-data-guard-broker-DGMGRL-utility.html)
- [Oracle Data Guard Broker Commands (19c — `SET MASTEROBSERVER TO`)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-commands.html)
- [V$DATABASE (19c Database Reference — `FS_FAILOVER_STATUS`, `FS_FAILOVER_OBSERVER_PRESENT`)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DATABASE.html)
- [ORA-16820 — fast-start failover observer is no longer observing this database](https://docs.oracle.com/en/error-help/db/ora-16820/)
- [ORA-16658 — unobserved fast-start failover configuration](https://docs.oracle.com/en/error-help/db/ora-16658/)
