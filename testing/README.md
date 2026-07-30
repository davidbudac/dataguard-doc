# FSFO test runbook — verifying the documented behavior in a test environment

The figures and the simulator make claims about what a fast-start failover configuration
does — when the threshold clock runs, what `NET_TIMEOUT` does and does not bound, why an
unobserved primary keeps serving. This runbook turns each claim into a drill you can run
against a real Oracle 19c configuration: induce the failure, watch the documented behavior
happen, put the configuration back together, repeat.

It assumes a **working** broker configuration — primary, target standby, one observer,
fast-start failover already enabled. It uses the same fixture as every other asset in this
repo: primary `prm01` on host `dc1-prm01`, standby `sby01` on host `dc2-sby01`, role-based
service `app_svc`. The observer host, which the other assets never need to name, is
`dc3-obs01` here. Substitute your own names throughout.

**Run this only in a test environment.** The drills abort instances, cut networks with
firewall rules, and deliberately trip failure limits. Nothing here is safe on a system
anyone else depends on.

| Drill | Situation | Maps to |
|---|---|---|
| 1 | Primary host crash | Figure 1, Figure 3, simulator scenario 1 |
| 2 | Isolated primary / split brain | Figure 2, simulator scenario 2 |
| 3 | Observer lost | Simulator scenario 3 |
| 4 | Standby link loss, observer reachable | Figure 4 panel A |
| 5 | Blocked failover (lag over the limit) | The simulator's "Blocked" banner |
| 6 | ReopenSecs and the MaxFailure tripwire | The simulator's reopen view |
| 7 | The application's view | Simulator chapter 3 |
| 8 | Commit anatomy (measurement, not a drill) | The simulator's commit view |

Baseline for every drill unless it says otherwise: **MaxAvailability, `LogXptMode=SYNC`,
all broker properties at their defaults** — the same configuration the figures draw.
Drills that need MaxPerformance/ASYNC say so, and their cleanup restores the baseline.
Finish each drill's cleanup before starting the next; several drills end with the roles
swapped, and the cleanup switches them back.

## 0. Prerequisites and baseline health check

What you need:

- Three hosts: `dc1-prm01`, `dc2-sby01`, `dc3-obs01`. The partition drills (2, 4, 5, 6)
  need root or sudo on `dc1-prm01` for firewall rules.
- **Flashback Database enabled on both databases** — reinstating the old primary after
  each failover drill depends on it (`SELECT flashback_on FROM v$database;` must say
  `YES` on both). Without it, every failover drill ends in re-creating the old primary
  from backup instead of a one-command reinstate.
- A client host (your workstation is fine) with `sqlplus` and a `tnsnames.ora` entry for
  the two-address descriptor (drill 7 builds it).
- The observer started with a log file you can tail — the drills watch it constantly:

  ```
  DGMGRL> CONNECT sys@prm01 AS SYSDBA
  DGMGRL> START OBSERVER IN BACKGROUND LOGFILE IS '/home/oracle/observer.log';
  ```

Baseline check, from DGMGRL connected to the primary — everything below must come back
healthy before the first drill:

```
DGMGRL> SHOW CONFIGURATION VERBOSE;
DGMGRL> SHOW FAST_START FAILOVER;
DGMGRL> SHOW OBSERVER;
DGMGRL> VALIDATE DATABASE 'prm01';
DGMGRL> VALIDATE DATABASE 'sby01';
```

`SHOW CONFIGURATION` must report `SUCCESS`; `SHOW FAST_START FAILOVER` must show
`Enabled in Zero Data Loss Mode`, the target `sby01`, threshold 30, `Shutdown Primary:
TRUE`, `Auto-reinstate: TRUE`; `VALIDATE DATABASE 'sby01'` must say it is ready for
failover. And in SQL*Plus on the primary:

```sql
SELECT fs_failover_status, fs_failover_observer_present, fs_failover_observer_host
FROM   v$database;
```

Expected at rest: `SYNCHRONIZED` / `YES` / `dc3-obs01`. This one query is the
instrument panel for the whole runbook — most drills are "do something, watch
`FS_FAILOVER_STATUS` change".

### The probe: measuring RTO and RPO instead of guessing

Every failover drill uses the same harness, so "what did this failover cost" is a query.
Once, on the primary, as an application user:

```sql
CREATE TABLE fsfo_probe (seq NUMBER PRIMARY KEY, ts TIMESTAMP);
```

On the client host, a loop that commits one row per second **through the two-address
descriptor** and records every acknowledged commit locally:

```bash
i=0
while true; do
  i=$((i+1))
  echo "INSERT INTO fsfo_probe VALUES ($i, systimestamp); COMMIT;" \
    | sqlplus -s app/password@APP >/dev/null 2>&1 \
    && echo "acked $i $(date +%H:%M:%S)" >> probe.log
  sleep 1
done
```

Each iteration is a fresh connection, so the loop doubles as a connect-string probe
(drill 7 exploits that). After a drill:

- **RTO** = the gap in `probe.log` timestamps — how long no new work could commit.
- **RPO** = compare the last `acked` seq in `probe.log` with
  `SELECT MAX(seq) FROM fsfo_probe;` on the new primary. If the table's max is lower
  than the last acknowledged seq, an acknowledged commit was lost. In MaxAvailability
  this difference **must be zero** — that is the zero-data-loss promise, and the probe
  is how you hold the configuration to it.

For the drills where the interesting behavior is a *hanging* commit (2 and 4), also keep
one persistent SQL*Plus session open on the primary and run the insert+commit by hand —
a fresh-connection loop can't show you a commit stuck mid-flight.

Scope notes: this runbook, like the simulator, models the **single-observer**
configuration. 19c can register up to three observers with automatic master promotion;
drilling that is a worthwhile extension but not covered here. Reinstate appears below
only as drill cleanup — the mechanism itself (Flashback Database flashback, conversion
to standby) stays out of scope, as everywhere else in this repo.

One fact that shapes every drill: the broker treats a **clean** shutdown (normal,
immediate, transactional) as an administrative act, not a failure — fast-start failover
is triggered only by `SHUTDOWN ABORT`, instance/host death, or a network loss. So when a
drill says abort, abort; `SHUTDOWN IMMEDIATE` will just sit there and nothing will
happen, which is its own useful mini-drill.

## Drill 1 — primary host crash

**Claim under test:** the observer initiates failover `FastStartFailoverThreshold`
seconds after it first loses the primary; the standby then finishes applying redo,
changes role and opens — a span no broker parameter governs; in MaxAvailability, RPO
is zero.

Preconditions: baseline healthy, probe loop running, three terminals watching:

```bash
# terminal 1 — the observer's view
tail -f /home/oracle/observer.log
# terminal 2 — the standby's role, once per second
while true; do
  echo "select database_role, open_mode from v\$database;" \
    | sqlplus -s / as sysdba | grep -E 'PRIMARY|STANDBY'
  sleep 1
done   # on dc2-sby01
```

Steps:

1. Note the wall-clock time, then kill the primary the honest way:

   ```sql
   -- on dc1-prm01
   SHUTDOWN ABORT
   ```

   (Variants that look identical to the observer: `kill -9` on pmon, or powering off
   the VM. The observer only knows its pings stopped being answered.)
2. Watch terminal 1. The observer reports the lost connection immediately, then counts
   the threshold down. **Expected: failover initiated ~30 s after the abort** — the
   clock started when the observer *first* lost the connection, not after some grace
   period.
3. Watch terminal 2. After initiation, the standby finishes terminal recovery, becomes
   `PRIMARY`, and opens `READ WRITE`. Time this span separately: it is the part that
   varies with your environment (apply lag at failure time, instance count, SGA size),
   and no property you set in drill 0 changes it.
4. Verify the cost with the probe: RTO from `probe.log` (expect roughly threshold +
   role-transition span), RPO by the seq comparison — **must be 0**.

Variant — the ping-properties quirk: restore the config (cleanup below), then set both
ping properties and repeat:

```
DGMGRL> EDIT CONFIGURATION SET PROPERTY ObserverPingInterval = 100;
DGMGRL> EDIT CONFIGURATION SET PROPERTY ObserverPingRetry = 10;
```

**Expected: detection collapses from 30 s to roughly one second** — interval × (retries
+ 1) ≈ 1.1 s at these values — because once both properties are explicitly set, the
threshold is ignored for the observer's detection. Remove both properties afterwards.

Cleanup (this is the reinstate pattern every failover drill reuses):

1. Restart the old primary to mount: `STARTUP MOUNT` on `dc1-prm01`.
2. With `FastStartFailoverAutoReinstate=TRUE` (the default), the observer reinstates it
   as the new standby on its own once it can reconnect — watch the observer log. Until
   then `SHOW CONFIGURATION` flags the database with `ORA-16661: the standby database
   needs to be reinstated`, and its `FS_FAILOVER_STATUS` reads `REINSTATE REQUIRED`.
   If auto-reinstate doesn't fire (or you disabled it), do it by hand from DGMGRL
   connected to the new primary: `REINSTATE DATABASE 'prm01';`
3. Wait for `SHOW CONFIGURATION` to report `SUCCESS`, then put the roles back:
   `SWITCHOVER TO 'prm01';` — with fast-start failover enabled, a switchover is only
   permitted to the fast-start failover target, which after the reinstate is exactly
   `prm01`, so this works without disabling anything.
4. Re-run the drill-0 baseline check.

## Drill 2 — isolated primary / split brain

**Claim under test:** a partition starts two independent threshold clocks — the
observer+standby side ends in failover, the primary's own stall clock ends in self-abort
(`FastStartFailoverPmyShutdown=TRUE`); in-flight commits hang for the *whole* stall,
which `NET_TIMEOUT` never shortens; with `PmyShutdown=FALSE` the primary stalls forever
and that stall *is* the split-brain protection.

Preconditions: baseline healthy, probe loop running, **plus one persistent SQL*Plus
session on the primary** ready to run an insert+commit by hand. Root on `dc1-prm01`.

Steps (sub-drill a, `PmyShutdown=TRUE`, the default):

1. Partition the primary from *both* other hosts — insert DROP rules at the top of the
   chain (DROP, not REJECT: a real partition gives no answer at all). Your ssh session
   comes from your workstation, so it survives:

   ```bash
   # on dc1-prm01, as root
   iptables -I INPUT  1 -s dc2-sby01 -j DROP
   iptables -I OUTPUT 1 -d dc2-sby01 -j DROP
   iptables -I INPUT  1 -s dc3-obs01 -j DROP
   iptables -I OUTPUT 1 -d dc3-obs01 -j DROP
   ```

   Note the wall-clock time.
2. Immediately run the insert+commit in the persistent session. **Expected: it hangs**
   — LGWR is waiting for a SYNC acknowledgment that cannot come, and because
   fast-start failover is enabled the primary may not drop the destination and carry
   on.
3. From a second local session on `dc1-prm01`: `SELECT fs_failover_status FROM
   v$database;` — **expected: `STALLED`**.
4. Watch the hung commit against the clock. At the defaults, `NET_TIMEOUT` (30 s) and
   the threshold (30 s) expire together — the point of the drill is that the hang is
   **not** released at `NET_TIMEOUT`: it lasts until the stall resolves. To pull the
   two clocks apart, re-run the drill with `EDIT DATABASE 'prm01' SET PROPERTY
   'NetTimeout' = 10;` — **expected: the commit stays hung past the 10 s mark** and the
   session never gets its ack; the stall's length is set by the threshold.
5. **Expected at ~threshold:** on the other side of the partition, the observer+standby
   run drill 1 without you — `sby01` becomes primary. On the isolated side, the old
   primary, stalled longer than the threshold and unable to reach observer or target
   standby, **aborts itself** — the alert log records the shutdown, the hung session
   gets an error, and there is at no point a second open primary.
6. Probe check: RTO as in drill 1; RPO **must be 0** — the stall held every
   unacknowledged commit hostage precisely so none could be acknowledged and lost.

Sub-drill b (`PmyShutdown=FALSE`):

1. Cleanup sub-drill a fully first. Then `EDIT CONFIGURATION SET PROPERTY
   FastStartFailoverPmyShutdown = FALSE;` and repeat steps 1–5.
2. **Expected difference:** the standby side still fails over at the threshold, but the
   old primary does *not* abort — it stays open and `STALLED` indefinitely, commits
   still hung. Confirm from the standby side that `sby01` is primary, and on
   `dc1-prm01` that the stalled instance still cannot acknowledge a commit: stalled,
   not serving, is what keeps split brain impossible.

Cleanup:

1. Drop the rules (they were inserted at position 1):

   ```bash
   iptables -D INPUT  -s dc2-sby01 -j DROP; iptables -D OUTPUT -d dc2-sby01 -j DROP
   iptables -D INPUT  -s dc3-obs01 -j DROP; iptables -D OUTPUT -d dc3-obs01 -j DROP
   ```

2. Once contact resumes the broker discovers the completed failover; get the former
   primary mounted (sub-drill a left it down; in sub-drill b restart it with
   `SHUTDOWN ABORT` + `STARTUP MOUNT`) and follow the drill-1 reinstate pattern, then
   switch back.
3. Restore `FastStartFailoverPmyShutdown = TRUE` and any `NetTimeout` you changed.

## Drill 3 — observer lost

**Claim under test:** losing the only observer fails nothing over, and that is the
point. The primary keeps serving because it still reaches the target standby; the cost
is a blind window in which a primary crash would mean no automatic failover.

Steps:

1. With the probe loop running, kill the observer *un*cleanly — the scenario models a
   crashed observer host, not the administrative `STOP OBSERVER` (either way the
   configuration ends up unobserved, but a crash is what you are drilling):

   ```bash
   # on dc3-obs01
   pkill -9 -f "dgmgrl.*observer" || kill -9 <observer-pid>
   ```

2. **Expected: the probe never misses a beat.** Commits keep flowing; the standby keeps
   applying.
3. On the primary:

   ```sql
   SELECT fs_failover_status, fs_failover_observer_present FROM v$database;
   ```

   **Expected: `PRIMARY UNOBSERVED` / `NO`.** `SHOW CONFIGURATION` degrades to a
   warning carrying `ORA-16820` ("fast-start failover observer is no longer observing
   this database") — the *standing* condition. You should **not** see `ORA-16658`;
   that one is raised only when a failover is actually attempted while unobserved,
   which is the next step.
4. Optional sub-step — the `ifDiedNow` cost. While still unobserved, `SHUTDOWN ABORT`
   the primary. **Expected: nothing.** No observer, no fast-start failover; the
   standby keeps waiting. Recover by hand from DGMGRL connected to `sby01`:
   `FAILOVER TO 'sby01';` — and this is where `ORA-16658` finally has its moment: a
   failover *attempted* while unobserved is the one situation that raises it. If you
   get it, issue `DISABLE FAST_START FAILOVER FORCE;` on `sby01` and fail over again
   (re-enable fast-start failover once the configuration is whole). Then reinstate
   and switch back per drill 1. This is the one drill where you feel the difference
   between "FSFO enabled" and "FSFO able to act".

Cleanup: restart the observer with its log file
(`START OBSERVER IN BACKGROUND LOGFILE IS '/home/oracle/observer.log';`), confirm
`SYNCHRONIZED` / `YES` and a `SUCCESS` configuration.

## Drill 4 — standby link loss with the observer reachable (NET_TIMEOUT's actual job)

**Claim under test:** when only the standby link dies, committing sessions hang **up to
`NET_TIMEOUT`**, then the destination is dropped and the primary carries on open but
unsynchronized — no failover, and fast-start failover is disarmed until
resynchronization. Under ASYNC, commits never wait and `NET_TIMEOUT` never appears.

Steps:

1. Persistent session ready as in drill 2. Block **only** the standby:

   ```bash
   # on dc1-prm01, as root
   iptables -I INPUT  1 -s dc2-sby01 -j DROP
   iptables -I OUTPUT 1 -d dc2-sby01 -j DROP
   ```

2. Run the insert+commit. **Expected: it hangs for up to `NET_TIMEOUT` (30 s at the
   default) and then returns successfully** — the primary logged the transport error,
   terminated the redo transport session to `sby01`, and moved on. Contrast with
   drill 2: same hung commit at first, opposite resolution, and the *only* difference
   is that the observer is still reachable.
3. Confirm the state: `FS_FAILOVER_STATUS` on the primary reads **`UNSYNCHRONIZED`**;
   `SHOW CONFIGURATION` reports the transport problem; the observer log shows no
   countdown — **no failover clock is running**, because the observer never lost the
   primary. Fast-start failover is disarmed exactly as long as the standby is behind.
4. Re-run with `NetTimeout` lowered to 10 (`EDIT DATABASE 'prm01' SET PROPERTY
   'NetTimeout' = 10;`): the hang shortens to ~10 s. This is the knob doing its real
   job — bounding the commit-latency cost of a dead standby link, not deciding any
   failover.
5. Counter-check under ASYNC: cleanup, then
   `EDIT CONFIGURATION SET PROTECTION MODE AS MAXPERFORMANCE;` and
   `EDIT DATABASE 'sby01' SET PROPERTY 'LogXptMode' = 'ASYNC';` (order matters:
   downgrade the mode first). Block the standby again. **Expected: the insert+commit
   returns instantly** — no session ever waits for the standby under ASYNC, so
   `NET_TIMEOUT` has nothing to bound on the commit path.

Cleanup: drop the firewall rules; watch `SHOW DATABASE 'sby01';` until transport and
apply catch up and the primary reads `SYNCHRONIZED` again (fast-start failover rearms
by itself — verify with `SHOW FAST_START FAILOVER;`). Restore `NetTimeout = 30`, and
after the ASYNC counter-check restore `LogXptMode = 'SYNC'` then
`EDIT CONFIGURATION SET PROTECTION MODE AS MAXAVAILABILITY;` (upgrade the transport
first, then the mode).

## Drill 5 — blocked failover: the readiness check says no

**Claim under test:** in MaxPerformance, fast-start failover is permitted only while
the standby's lag is at or under `FastStartFailoverLagLimit`. Past it, the observer
refuses to fail over — the primary's death then leaves the standby standing but
untouched, and continuing is a human decision.

Setup: MaxPerformance/ASYNC (as in drill 4 step 5), and the lag limit at its minimum so
the drill is quick: `EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagLimit = 5;`

Steps:

1. Probe loop running. Block the standby link (drill 4 rules) and let the probe keep
   committing — under ASYNC it happily will, and every commit now widens the gap
   between what the primary acknowledged and what the standby has.
2. After comfortably more than 5 seconds of blocked, committed work, check the primary:
   `FS_FAILOVER_STATUS` — **expected: `TARGET OVER LAG LIMIT`**. The configuration is
   telling you, before anything has failed, that a fast-start failover is currently
   not permitted.
3. Now kill the primary: `SHUTDOWN ABORT` on `dc1-prm01` (leave the firewall rules up —
   the redo that didn't ship must stay unshipped, or the standby will catch up and
   spoil the drill).
4. **Expected: no failover.** The observer sees the primary gone, checks the target,
   finds the lag over the limit, and keeps monitoring — watch its log say so. The
   standby keeps applying what it has and stays a standby. This is the simulator's
   "Blocked" banner in real life.
5. The fork in the road, and the RPO query that informs it — on the standby, compare
   `SELECT MAX(seq) FROM fsfo_probe;` with the last `acked` seq in `probe.log`; the
   difference is exactly the acknowledged work a forced failover would lose:
   - **Take the loss:** from DGMGRL on `sby01`, `FAILOVER TO 'sby01' IMMEDIATE;` —
     `IMMEDIATE` skips waiting for unapplied redo and accepts the gap you just
     measured. Then reinstate/switch back per drill 1.
   - **Refuse the loss:** drop the firewall rules, restart the old primary
     (`STARTUP`), let the standby resynchronize, and nothing was lost — at the price
     of the outage lasting until the primary could be revived.

Cleanup: whichever path you took, restore `FastStartFailoverLagLimit = 30`, SYNC, and
MaxAvailability (transport first, then mode), and re-run the baseline check.

## Drill 6 — transport outage aftermath: ReopenSecs and the MaxFailure tripwire

**Claim under test:** a failed destination is retried only at **log switch** time, and
only once `REOPEN` seconds have passed since the last error; `MAX_FAILURE` counts
consecutive failed reestablish attempts, and at the limit the destination is disabled
with **no further access until it is manually reenabled** — the network healing does
not bring it back.

Setup: stay in MaxPerformance/ASYNC (continue from drill 5's cleanup fork, or redo
drill 4 step 5) so the primary never blocks on the dead destination. Shrink the two
knobs so the drill fits in minutes — both are deprecated *as broker properties* in 19c
but still functional, which is the shortest route in a broker-managed config:

```
DGMGRL> EDIT DATABASE 'prm01' SET PROPERTY 'ReopenSecs' = 60;
DGMGRL> EDIT DATABASE 'prm01' SET PROPERTY 'MaxFailure' = 3;
```

The instrument for this drill, on the primary:

```sql
SELECT status, error, failure_count, max_failure, reopen_secs
FROM   v$archive_dest WHERE dest_id = 2;
```

Steps:

1. Block the standby link (drill 4 rules). Force a log switch (`ALTER SYSTEM SWITCH
   LOGFILE;`) to make the primary notice: **expected: `STATUS` goes to `ERROR`,
   `FAILURE_COUNT` starts counting, `ERROR` shows the transport failure.**
2. Probe the retry gate. Switch logfiles again *within* 60 s of the last error —
   **expected: no reconnect attempt** (the interval gates eligibility). Wait past
   60 s **without** switching — **expected: still no attempt** (the log switch is the
   trigger). Then switch after the 60 s have passed — **expected: now it tries**, and
   with the link still blocked, fails, incrementing `FAILURE_COUNT`. The retry needs
   both: interval elapsed *and* a log switch.
3. Keep the link blocked and switch logfiles (spaced past `REOPEN`) until
   `FAILURE_COUNT` reaches 3. **Expected: the destination is disabled** — `STATUS`
   `DISABLED` in `V$ARCHIVE_DEST`.
4. The tripwire, part two: **now heal the network** (drop the firewall rules) and
   switch logfiles a few more times. **Expected: nothing.** The destination stays
   disabled; a reachable standby does not re-enter service on its own. Meanwhile note
   what the outage cost in armament: fast-start failover has been disarmed since the
   lag crossed the limit (or since t = 0 had this been MaxAvailability).
5. Reenable it manually — toggling the transport state through the broker is the
   cleanest reset in a broker-managed configuration:

   ```
   DGMGRL> EDIT DATABASE 'prm01' SET STATE = 'TRANSPORT-OFF';
   DGMGRL> EDIT DATABASE 'prm01' SET STATE = 'TRANSPORT-ON';
   ```

   **Expected: transport resumes**, the standby starts catching up, and the unshipped
   redo drains at whatever headroom your link and apply actually have (the simulator
   idealizes this as 5×; here you get to measure the real number).

Cleanup: `ReopenSecs = 300`, `MaxFailure = 0`, then SYNC and MaxAvailability as in
drill 4's cleanup, and the baseline check.

## Drill 7 — the application's view

**Claim under test:** the connect-descriptor timeouts decide how long a *new*
connection gropes at a dead host (`TRANSPORT_CONNECT_TIMEOUT`, default 60 s per
address), how often it retries the whole list (`RETRY_COUNT`, default 0 — never), and
none of it helps an *established* session. A standby without the role-based service
refuses instantly with `ORA-12514`.

Setup, on the client host — two descriptors for the same service, the repo's Defaults
and Tuned shapes:

```
APP =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = dc1-prm01)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = dc2-sby01)(PORT = 1521)))
    (CONNECT_DATA = (SERVICE_NAME = app_svc)))

APP_TUNED =
  (DESCRIPTION =
    (TRANSPORT_CONNECT_TIMEOUT = 3) (CONNECT_TIMEOUT = 90)
    (RETRY_COUNT = 30) (RETRY_DELAY = 3)
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = dc1-prm01)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = dc2-sby01)(PORT = 1521)))
    (CONNECT_DATA = (SERVICE_NAME = app_svc)))
```

Steps:

1. First, the refusal that makes role-based services work. With everything healthy,
   point sqlplus straight at the standby host:

   ```bash
   time sqlplus app/password@'(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=dc2-sby01)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=app_svc)))'
   ```

   **Expected: `ORA-12514`, in well under a second.** The listener is up but does not
   know `app_svc` — the service runs only where the database is primary. This instant
   refusal is what lets a client walk past a standby for free.
2. Now re-run drill 1 (primary host crash), but instead of the probe loop, time
   connection attempts through each descriptor during the outage window. If the host
   is down such that connections are **refused** (instance dead, host up), both
   descriptors skip to address 2 quickly. The interesting case is the host being
   **silently unreachable** (power off the VM, or on `dc1-prm01` drop inbound 1521
   from the client) — then:
   - `time sqlplus app/password@APP` — **expected: ~60 s hang** on the dead address
     (`TRANSPORT_CONNECT_TIMEOUT` default) before address 2 is tried; and if the
     failover hasn't completed by then, the attempt ends with `ORA-12514` from the
     standby and **does not retry** — `RETRY_COUNT` defaults to 0, so the descriptor
     retries exactly never. The application sees an error even though a failover is
     seconds from finishing.
   - `time sqlplus app/password@APP_TUNED` — **expected: 3 s toll** per pass on the
     dead address, then up to 30 retries at 3 s spacing quietly riding out the
     failover, connecting within a few seconds of `app_svc` publishing on `sby01`.
3. The established-session contrast: before the crash, leave one session connected and
   idle. Crash the primary. **Expected: the session learns nothing** from any
   descriptor parameter — it hangs on its dead TCP connection until the OS gives up,
   unless `SQLNET.RECV_TIMEOUT` (client side) or TCP keepalives are configured to kill
   it sooner. Reconnect logic — or TAF / Application Continuity to also resume work —
   lives outside the connect string's timeout parameters entirely.
4. Cleanup: drill 1's reinstate-and-switchover pattern.

## 8. Commit anatomy — a measurement recipe, not a drill

**Claim under test:** a SYNC commit costs `max(local write, remote ack path)` — not the
sum — because LGWR starts the remote write before issuing the local one; FASTSYNC
(`SYNC NOAFFIRM`) shaves the standby's redo-log write out of the ack path; ASYNC
returns commit latency to local-only.

The measurement, run three times — once per `LogXptMode` (change it between runs with
`EDIT DATABASE 'sby01' SET PROPERTY 'LogXptMode' = 'SYNC' | 'FASTSYNC' | 'ASYNC';`,
staying in MaxAvailability for SYNC/FASTSYNC and dropping to MaxPerformance for the
ASYNC run):

```sql
-- snapshot before
SELECT time_waited_micro, total_waits FROM v$system_event
WHERE  event = 'log file sync';

DECLARE
  t0 NUMBER := dbms_utility.get_time;
BEGIN
  FOR i IN 1..2000 LOOP
    INSERT INTO fsfo_probe VALUES (1000000 + i, systimestamp);
    COMMIT WRITE WAIT IMMEDIATE;   -- force a real, synchronous commit each time;
                                   -- PL/SQL otherwise batches commit waits
  END LOOP;
  dbms_output.put_line('cs elapsed: ' || (dbms_utility.get_time - t0));
END;
/

-- snapshot after; (delta time_waited_micro / delta total_waits) = avg log file sync
SELECT time_waited_micro, total_waits FROM v$system_event
WHERE  event = 'log file sync';

DELETE FROM fsfo_probe WHERE seq > 1000000; COMMIT;
```

Expected relationships (the absolute numbers are your hardware's):

- **SYNC vs. ASYNC:** the difference is the remote ack path. On a low-latency link
  where the network round trip plus the standby's SRL write is *shorter* than your
  local redo write, SYNC costs barely more than ASYNC — that is `max()`, not sum,
  showing up in your numbers. If commit latency were `local + remote`, SYNC could
  never sit that close to ASYNC.
- **FASTSYNC vs. SYNC:** FASTSYNC's average sits lower by roughly the standby's
  redo-log write time, because `NOAFFIRM` acknowledges *before* that write and
  `AFFIRM` *after* it. That single word is the whole difference.
- **ASYNC:** `log file sync` collapses to the local write; no session ever waited on
  the standby.

Two cautions carried over from the repo's accuracy rules: Oracle never describes the
local and remote writes as running "in parallel" — the documented 13-step ordering is
the entire evidence for `max()` — and the `log file parallel write` wait event is
**not** evidence for any of this; it concerns multiplexed online-redo members.

## Sources

The drills' expected observations rest on the same verified facts as the figures and
the simulator (see [diagrams/README.md](../diagrams/README.md) for the full list).
Referenced directly by this runbook:

- [Switchover and Failover Operations (19c broker, chapter 5)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html)
  — the fast-start failover conditions (including the clean-shutdown exemption and the
  lag-limit readiness check), automatic reinstatement and its Flashback Database
  prerequisite, `SHOW FAST_START FAILOVER` output.
- [Oracle Data Guard Broker Commands (19c)](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/oracle-data-guard-broker-commands.html)
  — `START OBSERVER IN BACKGROUND ... LOGFILE IS`, `VALIDATE DATABASE`,
  `REINSTATE DATABASE`, `FAILOVER ... IMMEDIATE`, `SWITCHOVER TO`,
  `DISABLE FAST_START FAILOVER [FORCE]`.
- [V$DATABASE (19c Database Reference)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-DATABASE.html)
  — the `FS_FAILOVER_STATUS` value set used throughout (`SYNCHRONIZED`,
  `UNSYNCHRONIZED`, `STALLED`, `PRIMARY UNOBSERVED`, `REINSTATE REQUIRED`,
  `TARGET OVER LAG LIMIT`, ...), `FS_FAILOVER_OBSERVER_PRESENT`,
  `FS_FAILOVER_OBSERVER_HOST`.
- [V$ARCHIVE_DEST (19c Database Reference)](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-ARCHIVE_DEST.html)
  — `STATUS` (`VALID` / `ERROR` / `DISABLED` ...), `FAILURE_COUNT`, `MAX_FAILURE`,
  `REOPEN_SECS`, `ERROR`, drill 6's instrument.
- [ORA-16661 — the standby database needs to be reinstated](https://docs.oracle.com/en/error-help/db/ora-16661/)
  — the status every failover drill's cleanup starts from.
- [ORA-16820](https://docs.oracle.com/en/error-help/db/ora-16820/) /
  [ORA-16658](https://docs.oracle.com/en/error-help/db/ora-16658/) — the
  standing-condition vs. attempted-failover distinction in drill 3.
