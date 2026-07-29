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

## Oracle documentation

- [Oracle Data Guard Broker Properties (19c)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-properties.html)
- [Switchover and Failover Operations (19c, chapter 5)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html)
- [LOG_ARCHIVE_DEST_n parameter attributes (19c Data Guard Concepts and Administration)](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html)
- [LOG_ARCHIVE_DEST_n (19c Database Reference)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/LOG_ARCHIVE_DEST_n.html)
- [Oracle Data Guard Broker Properties (21c — documents `ObserverPingInterval` / `ObserverPingRetry`)](https://docs.oracle.com/en/database/oracle/oracle-database/21/dgbkr/oracle-data-guard-broker-properties.html)
- [Local Naming Parameters in the tnsnames.ora File (19c Net Services Reference — connect-descriptor timeout parameters)](https://docs.oracle.com/en/database/oracle/oracle-database/19/netrf/local-naming-parameters-in-tns-ora-file.html)
- [Oracle Net TNS String Parameters (19c High Availability Overview — recommended client failover settings)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/oracle-net-tns-string-parameters.html)
- [Connection Time Estimates During Data Guard Switchover or Failover (19c High Availability Overview)](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/connection-time-estimates-data-guard-switchover-or-failover.html)
