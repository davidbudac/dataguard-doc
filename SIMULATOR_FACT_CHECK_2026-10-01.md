# Workbench fact check — 2026-10-01

Scope: `app/` (engine, validation, generators, presets, lessons, UI strings), both editions
(19c, 26ai). Report only — no engine, content, rule, preset or test was changed; the probes for
the findings below were added to `app/test/fact-check/probes.probe.ts` in their own section. The
frozen legacy fragment in `simulator/` was not reviewed.

Reviewed state: `main` at `6f2ccdb` (2026-09-30), in a pinned worktree. Since the 2026-09-28
review, `main` gained ~2 000 lines of engine change: RAC members (`sim/rac.ts`), the split-brain
reading (`sim/split-brain.ts`), the application's sessions and two publishers (`models/app.ts`),
a manual failover that leaves a running old primary open, and the Topology / Detailed timeline
UI. Those are where most of the new findings are. The fixes followed the same day; see
*Resolution*. The same day, after the fixes, the 19c test pair was checked live (D9); see
*Live check*.

To repeat the review: `docs/agents/fact-check.md` (procedure), `app/test/fact-check/probes.probe.ts`
(the scenarios below, runnable), `app/test/fact-check/fetch-docs.sh` (the Oracle pages, as
greppable text).

```bash
cd app && npx vitest run --config vitest.factcheck.config.ts
```

## Resolution (same day)

Everything below this section is the report as it was written, before any fix. This section
is what was done about it. After the fixes: 3254 tests green across 119 files (2883 across
112 before), the legacy fragment's 63 tests unmodified and green, all fourteen 2026-10-01 probes
`CHANGED` (43 of 53 rows in all; the ten still `OPEN` are SBR-01 to -05, -07, -08, HEALTHY-01,
APP-01 and APP-02, the feature rows section F found correct), and 324 checked citation quotes
found word for word on their pages, 17 paraphrases unchecked by design, one miss — still
`XPT.TABLE_4_2`, the footnote marker, not a wrong quote. The regression tests are in
`app/test/factcheck-1001-*.test.ts`, one file per area, one `describe` per finding.

After the live check's corrections: 3258 tests across 119 files, 326 quotes verbatim
(`ORA.16830` and `ORA.16878` added), the same one miss, and no probe changed status.

### Decisions taken

| # | Question | Decision |
|---|---|---|
| D5 | The old primary after a manual failover with fast-start failover enabled | **Stall, then the PmyShutdown abort, labelled `model`** (`FAILOVER.FORMER_PRIMARY_STALLS`). Stalled from the instant the target converts; aborted one `FastStartFailoverThreshold` later with `FastStartFailoverPmyShutdown` TRUE, stalled for good with FALSE. With fast-start failover disabled it stays open, as before (`FAILOVER.FORMER_PRIMARY_OPEN`), and only then does Split brain read yes |
| D6 | What the run evaluates after a role change | **(a), re-evaluate against the new primary's own target.** The new primary has no synchronized fast-start failover target within the run (the former primary's reinstatement or restart is an open-ended band), so losing the observer or its standbys stalls and aborts nothing; the run says why once (`FSFO.NO_TARGET_AFTER_ROLE_CHANGE`, `inferred`). A switchover's former primary is a standby, never an acting primary. After a switchover, STOP OBSERVER and DISABLE FAST_START FAILOVER read the connection to the former primary, which is the new target: refused (ORA-16636; no FORCE) while it is down or cut off. After a failover neither command is refused on account of the former primary. This half was first written as a refusal too, and the live check corrected it: 19.27 accepted both (`inferred`, see *Live check*) |
| D7 | 26ai: a restarted former primary with fast-start failover disabled | **Mounted is `documented` under 26ai** (`FAILOVER.FORMER_PRIMARY_MOUNTED_26AI`, Scenario 11). Under 19c it stays `model`; "cannot reach the new primary, so it opens" stays `model` under both |
| D8 | A SYNC target in MaxPerformance with fast-start failover | **A warning while fast-start failover is enabled** (observe-only included, as the other rules treat it), citing "Maximum performance — ASYNC" and Task 3; an info while disabled. No preset trips it |
| D9 | A live check | **Taken the same day, after the fixes.** Read-only `SHOW` commands, both drills and two more, on the 19.27 pair. D5 and D6's no-stall were confirmed. Four things the page drew were corrected, among them D6's refusals after a failover; see *Live check* |

### Per finding

| Finding | Status | What the page does now |
|---|---|---|
| SIM-15 | fixed (D6), confirmed live | No stall or abort on the new primary after either role change; the switched-over former primary is not aborted. The SIM-15a probe stops the observer after a crash failover. That stop is accepted, as on 19.27, and nothing stalls, so it prints `CHANGED`. Before the live check the stop was refused with ORA-16636, and the probe read `CHANGED` for that reason instead |
| SIM-16 | fixed | Automatic reinstatement is pending at the open and starts only once the former primary is running, the master observer reaches it and it reaches the new primary. `REINSTATE.WAITING` says why not: aborted ("must be manually restarted"), down, or cut off |
| SIM-17 | fixed | Refused in the engine, in `validate()` (`ROLE.SWITCHOVER_SNAPSHOT`) and greyed in the menu, before any other gate |
| SIM-18 | fixed | Any SYNC destination that was acknowledging and goes silent hangs commits for NET_TIMEOUT, whether or not another still answers |
| SIM-19 | fixed | Without FORCE, refused unless the connections hold. With FORCE on an isolated primary, that primary carries on, the observer still fails over, and the run ends with two primaries (`FSFO.DISABLE_FORCE_TWO_PRIMARIES`) |
| SIM-20 | fixed | A stalled former primary that reconnects without restarting is drawn as before, labelled `model`; a restarted one stays `documented` |
| SIM-21 | fixed | Physical and snapshot standbys (and, after a failover, the old primary) are disabled and must be re-created; `REINSTATE` is refused for them (`REINSTATE.MUST_RECREATE`). A down old primary still draws `down` on its lane; the disablement shows as a finding |
| VAL-07 | fixed | Refused in the engine, `ROLE.SWITCHOVER_LOGICAL_MAXPROT`, greyed in the menu. Closes the 09-28 item 4 too |
| SIM-22 | fixed in the engine | Both refusals, as a finding and a decision. The menu row is **not** greyed: it cannot know who is master or whether the links are up at that instant |
| SIM-23 | fixed | Not offered on a snapshot standby, never drawn applying; a logical standby's row says SQL Apply. No `validate()` finding for a snapshot document with apply set on |
| SIM-24 | fixed (D7) | |
| SIM-25 | fixed | `ROUTES.NO_RULE_FOR_NEW_PRIMARY` (info, `model`) where a member with a non-null RedoRoutes has no rule for the new primary |
| SIM-26 | fixed | With apply stopped, the failover waits for the redo the primary generated before it was lost (`FAILOVER.APPLY_WAIT`; the wait is documented, its size `model`). It overcounts a manual failover with fast-start failover disabled whose primary crashed well before the command |
| SIM-27 | fixed | The readiness gate takes the label of the SYNCHRONIZED state it reads; the far-sync-only level cites `MAXAVAIL.AT_LEAST_ONE_FARSYNC` |
| SIM-28 | fixed | A nominal convert (`model`) plus the accumulated redo inside the converting band; the documented sentence as a decision; "allowed" labelled `conflict` (Concepts vs. CONVERT DATABASE) |
| SIM-30 | fixed | Sessions on a stopped instance are lost and reconnect to a survivor; which instance carries them is `model` (`APP.SESSION_SPREAD`) |
| SIM-31 | fixed | "No clock starts" is `model`; the clock from the last instance is `inferred` (`RAC.CLOCK_FROM_LAST_INSTANCE`); the three RAC sentences are in the catalogue |
| SIM-32 … 35 | fixed | `FAILOVER=off` dials one address; 33 and 34 disclosed as not drawn (`model`); a STALLED primary accepting logons is labelled |
| ED-08 … 11 | fixed | Placeholder `<primary database name>_CFG`; 26ai MaxAvailability lag limit returns to 0, Oracle's own default-below-minimum shown as `conflict`; the service name validated (`CFG.SERVICE_NAME_FORMAT`); PreferredObserverHosts' one list disclosed |
| ED-12 | fixed, one part not | Floors are Oracle's; ceilings are the page's own (3600 s, RETRY_COUNT 1000, TRANSPORT_CONNECT_TIMEOUT 600); `ApplyInstanceTimeout` steps by 1; threshold, lag limit and NetTimeout are number boxes now. A sub-second TRANSPORT_CONNECT_TIMEOUT cannot be stored |
| ED-13, ED-14 | fixed | ApplyInstances capped at 16, physical standbys only, clamped on instance removal; the 26ai thin defaults (20 s, 1 s) split by edition |
| VAL-09 | fixed (D8) | |
| VAL-10 | fixed, one part not | The exception, the disable-target rule and FORCE's use are in the message. The RedoRoutes restriction is not: the report quotes no sentence for it |
| VAL-11 … 20 | fixed | VAL-14: `ROUTES.LOGICAL_LOCAL_ONLY` is an error like its neighbour, and `ROUTES.SNAPSHOT_CONVERT_NONNULL` names the CONVERT DATABASE conflict. VAL-17: `MEMBER.STATIC_SERVICE` (info, `inferred`) for any single-instance database; Oracle Restart still cannot be expressed. VAL-18: `MEMBER.PRIMARY_COUNT`, `MEMBER.NAME_DUPLICATE`. VAL-19: `FSFO.TARGET_DISABLED` |
| No-rule list | partly | Added `DEST.SYNC_ABOVE_10`, `EVENT.*` checks for `cmd.reinstate`, `cmd.setApplyInstance` and `cmd.setMasterObserver`, and the parser refuses `ALL` mixed with groups. ORA-16668 has no rule (no quoted sentence; `FSFO.TARGET_KIND` covers a named snapshot target); the rest of the list is untouched |
| GEN-14 … 29 | fixed | GEN-21 in both halves (the generator's note, and `DEST.DEPRECATED_19C` compares MaxFailure with the default for its position). The far sync presets gain South_Sales' route to FS1 (Scenario 5, GEN-17), so a role change reaches a far sync; TXT-92 follows |
| GEN-30 | fixed | The SHOW panel reads the run at the playhead: plain SHOW CONFIGURATION for the new primary, the former primary `(disabled)` with ORA-16661 and WARNING after a failover. The fast-start failover line stays the document's, with an `inferred` note: the FAILOVER example's DISABLED came from a run with it disabled. Since the live check, the disabled former primary also keeps `(*)` while fast-start failover stays enabled. With every observer stopped, the panel prints `Error: ORA-16820` and ERROR |
| TXT-14 … 60, 80 … 92 | fixed | TXT-45 by a label (the 19c page does carry the stall sentence, so the report's "unverified" hedge did not hold). TXT-50's id walk now covers every step of every lesson |
| TXT-71 | partly | The catalogue entries and the 19c licence sentence are in the ApplyInstances note; `RAC.APPLY_INSTANCES_UNUSED` does not mention the licence |

Five generator goldens moved (generated text, not geometry); no canvas golden moved. Two probe
predicates were adjusted to keep asking their question: TXT-52 (the preset now has two hangs, and
the probe reads the one before the shutdown) and SIM-15a (see above).

### Still open

- Not checked live: anything 26ai (the test pair is 19c), D7, D8, and SIM-16's unreachable
  former primary (it needs firewall rules, and root on the hosts was not used).
- SIM-22's menu row; VAL-10's RedoRoutes restriction; TXT-71's licence in the rule; a snapshot
  document with apply set on; a sub-second TRANSPORT_CONNECT_TIMEOUT.
- The documented restrictions with no rule (section C), bar the four added.
- From 09-28: `XPT.PRIMARY_LOGXPTMODE` and a primary fed through a cascader after the role
  change; the 12.1 alternate on unreachability rather than the `MaxFailure` count; old documents
  with several parenthesised groups and no priority.

## Live check (D9, same day)

Run after the fixes were merged, with the owner's go-ahead, on the 19c test pair:
- Oracle 19.27: `cdb1` is the primary, with Flashback Database on; `cdb1_stby` is the
  fast-start failover target, with it off. One observer runs on a third host.
- MaxAvailability, threshold 30 s, `FastStartFailoverPmyShutdown` and auto-reinstate
  TRUE.
- A commit probe and a once-a-second read of `V$DATABASE` ran on both databases
  throughout.
- The pair ended in its starting roles, with `SUCCESS`.

The drills are written up as runbook drill 13 and as notes on drills 1 and 3 in
`testing/README.md`.

| What was run | What 19.27 did | The page |
|---|---|---|
| Read-only `SHOW` | `ConfigurationWideServiceName` was `cdb1_CFG`, while the configuration is named `my_dg_config`. The lag limit printed `30 seconds (not in use)` in MaxAvailability. The five health conditions were at their defaults | Agrees: ED-08's placeholder, the lag-limit note and the SHOW FAST_START FAILOVER mock |
| **D5:** manual `FAILOVER TO cdb1_stby` with `cdb1` open | The command took 16 s. `cdb1` read `STALLED` 7 s in, as its target began converting, and its commits hung from then. It read `REINSTATE REQUIRED` while still open read-write. 31 s after the stall began it stopped: "Primary has heard from neither observer nor target standby within FastStartFailoverThreshold seconds. It is likely an automatic failover has already occurred. Primary is shutting down." (ORA-16830). It acknowledged no commit after the stall, and RPO was 0 | **Agrees with D5.** The `model` note now gives the observation, and the abort carries ORA-16830 (new citation) |
| DISABLE FAST_START FAILOVER without FORCE, right after that failover, former primary down | Accepted | **Disagreed:** the D6 fix had refused it with ORA-16636. Corrected: after a failover neither DISABLE nor STOP OBSERVER is refused on account of the former primary. An `inferred` decision gives the observation |
| Crash: `SHUTDOWN ABORT` of `cdb1` | "Attempting Fast-Start Failover because the threshold of 30 seconds has elapsed" appeared 32.6 s after the abort. Terminal recovery took 3.6 s, with no data loss. The new primary was open read-write 37 s after the abort | Agrees. The conversion band is `model`, and this small database converted much faster than the band draws |
| STOP OBSERVER right after that failover, former primary down | Accepted; `SHOW OBSERVER` printed "No observers." | **Disagreed**, as for DISABLE, and corrected with it |
| The new primary, unobserved, before the reinstatement | 3 min 23 s with no observer and no valid target (`REINSTATE REQUIRED`). It never stalled or aborted, and every commit was acknowledged | **Agrees with D6** |
| SHOW CONFIGURATION after either failover | `cdb1 - (*) Physical standby database (disabled)` with ORA-16661 under it, and `Fast-Start Failover: Enabled in Zero Data Loss Mode`. After the manual failover the primary also carried `Warning: ORA-16824` and the status was WARNING | The fast-start failover line agrees with GEN-30's reading. **The `(*)` was missing; corrected** (`inferred`). SHOW FAST_START FAILOVER's target line now reads `invalid - member is disabled` |
| SHOW CONFIGURATION with the observer stopped for minutes | `Error: ORA-16820: fast-start failover observer is no longer observing this database` under the primary; status ERROR | **The page printed nothing** (ORA-16819 only for no observer configured). Corrected: printed once every observer has stopped (`inferred`). The page prints it at once, and the live system took minutes |
| Switchover back to `cdb1` | Fast-start failover stayed `Enabled in Zero Data Loss Mode`. The former primary showed as `(*) Physical standby database` | The switchover note no longer says "documented only by implication": `model` became `inferred`, with the observation |
| `STOP OBSERVER dg_observer` with two observers registered | `Error: ORA-16878: master observer cannot be stopped` | Agrees (`OBS.STOP_MASTER_REFUSED`). The finding now names ORA-16878 (new citation) |
| `STOP OBSERVER ALL` after the switchover | Accepted. The primary stayed `SYNCHRONIZED` with observer-present `NO` and kept committing. The target standby read `PRIMARY UNOBSERVED` about 20 s later | **Agrees with the SIM-15 fix:** nothing stalled when the observer was lost, where the old engine stalled at once. The primary/standby split agrees with the page and **corrects runbook drill 3**, which expected `PRIMARY UNOBSERVED` on the primary |

How much the switchover case settles is limited. Something on the observer host restarts the
observer about 20 s after each stop. Five unobserved stretches after the switchover, each under
the threshold, showed no stall and 111 of 111 commits acknowledged. The stretch of over three
minutes was after the failover.

Snags from the test database, not from Oracle's behaviour:
- **The first reinstatement failed** with ORA-16653. A datafile in PDB1 had been taken
  offline by an earlier experiment, and its flashback images were missing (ORA-38795,
  ORA-10069; then ORA-16461 on the conversion). It went through after `OFFLINE FOR DROP`,
  and the file was restored from the new primary with `RESTORE DATAFILE … FROM SERVICE`.
- **`VALIDATE DATABASE` reports a broken restart address.** `cdb1`'s static connect
  identifier is not served by its listener (ORA-12514). Even so, the broker restarted the
  other database itself after each switchover.
- **DGMGRL needs a password login.** Connected with `/` it cannot reach the other member
  (ORA-01017). A SYSDBA drill account was created for the run and dropped afterwards.

## The short answer

**For the scenarios a reader opens first, yes.** A primary crash, an isolated primary, a
partition, a lost standby site, a lost observer, a switchover, a manual failover, the far sync
shapes, multi-target, MaxProtection and the loss of one RAC instance all play out as Oracle's
19c and 26ai pages say, in both editions. All 27 fixes from 2026-09-28 still hold (27/27 probes
`CHANGED`). All twelve presets are configurations Oracle would accept, and their own scenarios
behave as documented. 223 of 224 checked citation quotes are word for word on their pages.

**It goes wrong in four places:**

1. **After the first role change** (SIM-15, P1). Losing the observer after any failover or
   switchover makes the new primary STALL and shut down one threshold later. After a switchover
   it also "shuts down" the new standby. Oracle says an unobserved primary keeps processing
   transactions. One `observer.stop` after the switchover scenario reproduces it.
2. **Role changes to the wrong kind of standby.** A switchover to a snapshot standby is offered
   and carried out (SIM-17, P1). A role change to a logical standby leaves the physical and
   snapshot standbys running, where Oracle disables them (SIM-21). In MaxProtection, a switchover
   to a logical standby is still accepted (VAL-07, open since 09-28).
3. **Commands Oracle refuses are accepted.** STOP OBSERVER on the master while backups run
   (SIM-22). DISABLE FAST_START FAILOVER from an isolated primary, which also hides the
   two-primaries risk Oracle warns about (SIM-19).
4. **The reinstatement path when `FastStartFailoverPmyShutdown` is FALSE** (SIM-16, P1;
   SIM-20). Reinstatement starts while the former primary is still cut off, and a stalled
   primary that reconnects is redrawn as "started and mounted", labelled `documented`.

Smaller: a commit does not hang when one of several SYNC standbys goes silent (SIM-18). On a RAC
primary, losing one instance leaves the application's sessions on it untouched (SIM-30), and "no
failover clock starts" is labelled `documented` where Oracle's sentences talk about false
failovers (SIM-31). The generated scripts miss a far sync prerequisite and two configuration
properties, and the SHOW panel goes stale after a role change (GEN-14–17, GEN-30). Two lessons'
"Show me" steps name members their preset does not have (TXT-50, TXT-51). Ninety-five P3 label,
wording and citation findings follow.

| | P1 | P2 | P3 |
|---|---|---|---|
| Simulated outcomes (SIM, VAL-07) | 3 | 9 | 9 |
| Edition and defaults (ED) | — | 2 | 5 |
| Rules (VAL) | — | — | 12 |
| Generated text (GEN) | — | 5 | 12 |
| Prose, labels, citations (TXT) | — | 4 | 57 |

## How this was checked

| Source | What it is |
|---|---|
| Oracle docs | 61 pages pulled whole with `fetch-docs.sh` (19c, 21c, 26ai broker guide, sbydb, refrn, netrf, haovw, error help), plus ~120 more fetched by the slices (RAC admin, 26ai one-page-per-property and per-command pages, 19c/26ai Scenarios, jjdbc, jajdb, netag). Quotes matched by grep; no summariser in the loop. The 19c property page (114 937 chars) and command page (202 905 chars) were fetched whole, so absence findings stand. |
| Engine runs | ~250 event scenarios through `simulate()` and `validate()` across eight slices and the engine review. The ones that decide a finding are kept as probes (section *2026-10-01 review* of `probes.probe.ts`). |
| Citation probe | `FACT_CHECK_ONLINE=1`: 223 verbatim quotes found, 17 paraphrases (read by hand, below), 1 miss — `XPT.TABLE_4_2`, a footnote marker ("YesFoot 1"), not a wrong quote. |
| Live system | **None this time.** A read-only query against the owner's 19c test host was refused by the session's permission classifier and was not retried. The only live evidence is what the 2026-09-28 report recorded from 19.27.0.0.250415. Every 26ai finding rests on documentation only. |

URL prefixes: `B19` = `https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr`,
`B26` = same with `/26/`, `S19`/`S26` = `.../19/sbydb`, `.../26/sbydb`, `HA19` = `.../19/haovw`.
`FSFO19` = `B19/using-data-guard-broker-to-manage-switchovers-failovers.html`,
`FSFO26` = `B26/fast-start-failover2.html`, `PROP19` = `B19/oracle-data-guard-broker-properties.html`,
`CMD19` = `B19/oracle-data-guard-broker-commands.html`,
`MEM19` = `B19/managing-oracle-data-guard-broker-configuration-members.html`,
`HAOBS19` = `HA19/optimizing-automatic-failover-common-scenarios-minimize-downtime1.html`.

Severity, as before: **P1** the page shows an outcome Oracle documents as impossible, or offers
something that does not exist · **P2** wrong under one edition, a wrong rule, generated text that
would fail · **P3** label, wording, citation.

Paths are relative to `app/src/` unless they start with `app/`. Ids continue the 09-28 series;
`VAL-07` is re-used because it is still open. Where two slices found the same thing, one id is
kept: the snapshot switchover is SIM-17 (also reported as VAL-08 and SIM-50); the thin-driver
millisecond reason is TXT-30 (also TXT-81). Gaps in the numbering are ids no slice used.

Probes: the section *2026-10-01 review* of `probes.probe.ts` holds SIM-15a/b, SIM-16, SIM-17,
SIM-18, SIM-19, SIM-20, SIM-21, VAL-07, SIM-22, SIM-30, SIM-31, TXT-50 and TXT-52. All print `OPEN`
at `6f2ccdb`. The 38 rows before them are unchanged (27 `CHANGED`, 11 `OPEN`, the SBR, HEALTHY
and APP rows that came with the features and are reviewed in section F).

## Decisions needed before fixing

| # | Question | Evidence | Options |
|---|---|---|---|
| D5 | **The old primary after a manual failover with fast-start failover ENABLED** (SBR-06, the 2026-09-29 decision). It is drawn open read-write to the end of the run. | Nothing documented says what it does. The surrounding sentences lean the other way. The observe-only list in FSFO19 ("The primary database can enter UNSYNC or LAGGING state without an acknowledgement from the observer or target standby") implies that in enabled mode it cannot, and once the target converts, the old primary has lost its target. The STALLED row ends "It shuts down or stalls because it is likely a failover has occurred." HA19 configure-and-deploy: "Data Guard fast-start failover always guarantees that only one primary database exists". | Keep it open (`model`, as now), or draw it stalling once its target converts, then the PmyShutdown abort, labelled `model`. With fast-start failover disabled, "stays open" is the right reading and nothing contradicts it. |
| D6 | **What the run evaluates after a role change** (SIM-15). D2 said "one role change, disclosed", but the stall and abort are still evaluated after it, against the old target's state. | See SIM-15. | (a) Evaluate no stall or abort on the new primary until a target is synchronized with it, and never treat a switched-over former primary as an acting primary. Or (b) stop drawing the primary's FSFO state after a role change and say so, as `SIM.ONE_ROLE_CHANGE` does for role changes. |
| D7 | **26ai: a restarted former primary with fast-start failover disabled.** It is drawn mounted (`model`), or open where it cannot reach the new primary. | 26ai Scenario 11 (`B26/scenario-11-reinstating-failed-primary-database.html`) shows "ORA-16649: Data Guard prevented this database from opening." and says "Because a role transition occurred while the old primary was offline, Data Guard prevents the database from reopening and leaves it in a mounted state to ensure there is only one database open in the primary role." The 19c and 21c Scenario 11 pages say none of this. How the database learns of the role change when it cannot reach the new primary is not documented. | Under 26ai, label mounted `documented` with that sentence. Then either keep the "unreachable, so open" exception as `model`, or drop it under 26ai. |
| D8 | **A SYNC target in MaxPerformance with fast-start failover** (VAL-09). Today it is an `info`. | FSFO19 and FSFO26 list "Maximum performance — ASYNC" as the target's LogXptMode, Task 3 says set both to ASYNC, and the 19c members page says "An ASYNC destination is only a valid fast-start failover target in a configuration operating in maximum performance mode." No sentence says the broker refuses. | Keep `info` and say why, or make it a `warning` while fast-start failover is enabled. |
| D9 | **A live check.** | The procedure ranks a live database above a page. This review had none. | Allow read-only `SHOW` commands against the 19c test pair. Two drills would settle SIM-15 and D5 directly: stop the observer after a switchover, and run a manual failover with the primary up under fast-start failover. Both need the owner's say-so (`testing/README.md`). |

---

## A. Simulated outcomes (`engine/sim/*`)

### SIM-15 · P1 · both — After a role change, losing the observer stalls and aborts the new primary

| Repro (classic, FSFO enabled, MaxAvailability) | Page shows |
|---|---|
| `host.down dc1-prm01` @0 (FSFO failover, sby01 open @55), `observer.stop obs01` @200 | sby01 `200:stalled` → `230:aborted`; `PRIMARY.STALL` / `PRIMARY.ABORT` labelled `documented`. Then `SIM.ONE_ROLE_CHANGE` @230: "The new primary sby01 is down at 230 s" — blaming the abort the engine itself drew on an unsimulated role change |
| `cmd.switchover sby01` @0 (open @28), `observer.stop` @100 | sby01 stalled @100, aborted @130 — **and prm01, now the physical standby, `aborted` @130** (`PRIMARY.ABORT` twice) |
| crash @0, failover, `link.cut dc2-dc3` @200 (the new primary loses only the observer) | sby01 stalled @200, aborted @230 |
| `host.down prm01` @0, `cmd.failover sby01` @1 (a clean manual failover), `observer.stop` @200 | sby01 stalled @200, aborted @230 |
| manual failover with the old primary open (SBR-06), `observer.stop` @300 | **both** stall @300 and abort @330: no primary at all |

- **Oracle:** "While the configuration is in the unobserved state, fast-start failover cannot
  happen. Therefore, the primary database can continue processing transactions, even if the
  target standby database fails." (FSFO19 line 1207; FSFO26 line 1275, identical). "This is how
  we ensure that an observer or standby outage, or the outage of both at different times, does
  not impact the availability of the primary database" (HAOBS19). The `PRIMARY.STALL` decision's
  own text reads "Losing the observer alone would stall nothing."
- **Where:** `sim/simulate.ts:1134-1139` — `trackObserved`, `retarget` and `trackReadiness` run
  only in phase `normal`, so after a role change `unobserved` is never recorded.
  `sim/simulate.ts:2093-2124` — `possible = !state.unobserved && ready` reads the pre-role-change
  `activeTarget` and readiness. `actorIds` keeps the former primary as an acting primary after a
  switchover too, and `former` forces `stalledNow` for it.
- **Not D2:** no second role change is involved. This is a stall and an abort, drawn and labelled
  `documented`.

### SIM-16 · P1 · both — Reinstatement of a former primary nobody can reach

- **Repro:** classic, `FastStartFailoverPmyShutdown` FALSE, Flashback and static services on both
  databases; `link.cut dc1-dc2` and `dc1-dc3` @0, never healed.
- **Page shows:** prm01 `0:stalled | 55:reinstating`, decision `REINSTATE.OPEN_BAND` "prm01 is
  reinstated as the new standby". It is still cut off from the observer and the new primary for
  the whole run.
- **Oracle** (FSFO19, FSFO26, *Restrictions on Reinstatement*, identical), conditions in which the
  broker cannot reinstate: "The master observer cannot connect to the former primary database" ·
  "The former primary database cannot connect to the new primary database". And "the master
  observer will attempt to reinstate the former primary database as a new standby database when
  a connection to the former primary database is reestablished" (FSFO19:676).
- **P3 part:** with PmyShutdown TRUE (prm01 aborted @30), or a crashed primary that is still
  down, `REINSTATE.OPEN_BAND` is still decided at the new primary's open. The lane correctly stays
  `aborted` or `down`. Oracle: "If the FastStartFailoverPmyShutdown configuration property is set
  to TRUE, then the former primary database will have been automatically shut down and must be
  manually restarted before the master observer can attempt to reinstate it." (FSFO19:676)
- **Where:** `sim/simulate.ts:703-716` (reinstatement decided at the open, with no liveness or
  reachability test); `sim/simulate.ts:2244` returns `reinstating` before the stalled check.

### SIM-17 · P1 · both — Switchover to a snapshot standby is offered and carried out

- **Repro:** `bystanders`, fast-start failover disabled, `SWITCHOVER TO snp01`. Or
  `multiTargetDoc()` with a snapshot standby.
- **Page shows:** the menu offers it enabled (`ui/break/events.ts:391-397`). "The broker permits
  the SWITCHOVER"; snp01 opens as primary at 18 s with zero loss, labelled `documented`. With
  fast-start failover on it is refused, but only because snp01 is not the target. `validate()`
  has no finding for the command.
- **Oracle:** "A snapshot standby database cannot be the target of a switchover or a fast-start
  failover." (CMD19:618, CONVERT DATABASE; 26ai `B26/convert-database.html`). "You cannot perform
  a switchover to a snapshot standby database unless you first convert it back to a physical
  standby database." (FSFO19). Concepts says more: "A snapshot standby cannot be the target of a
  role transition." (S19 role transitions:83). That conflict with the broker's "can be the target
  of a manual failover if fast-start failover is disabled" (CMD19:620) is not named anywhere.
- **Sibling (P3):** a manual failover to a snapshot standby is legal, but "the broker first
  converts the database back to a physical standby and then starts Redo Apply to apply all the
  accumulated redo" (FSFO19; B26 manual-failover1). The run opens snp01 at 20 s like a physical
  standby, with no convert or apply band.
- **Where:** `sim/roles.ts:69-109` (no member-kind test); `validate/rules/members.ts:34-41` (the
  only command check is far sync). The rule's own message (`members.ts:123`) states the
  restriction and never applies it. Found independently by the rules and presets slices (their
  VAL-08 and SIM-50).

### SIM-18 · P2 · both — One SYNC destination lost among several: no commit hang

- **Repro:** `max-protection` (prm01, sby01 SYNC, sby02 SYNC); `host.down` sby01 @0.
- **Page shows:** prm01 `open-rw` throughout; no `commit-hang`. Losing the only SYNC standby
  (classic) hangs for NET_TIMEOUT.
- **Oracle:** "The default value is 0, which means that the LGWR will wait up to the number of
  seconds specified by the NET_TIMEOUT attribute of the LOG_ARCHIVE_DEST_n parameter for each SYNC
  standby destination." (`.../19/refrn/DATA_GUARD_SYNC_LATENCY.html`; 26ai identical.)
- **Where:** `sim/simulate.ts:1124-1133` — `ackLostSince` only when `view.syncAcks.length === 0`.
  The Commit panel already uses the documented "wait for each" default (`models/commit.ts:130-141`),
  so the run and the panel disagree.

### SIM-19 · P2 · both — DISABLE FAST_START FAILOVER ignores connectivity and FORCE

- **Repro:** classic, PmyShutdown FALSE; isolate the primary @0; `cmd.disableFsfo` @10, with or
  without `force`.
- **Page shows:** prm01 `0:stalled | 10:commit-hang | 30:open-rw`; the observer never fails over;
  no two-primaries outcome.
- **Oracle:** "Disabling fast-start failover without the FORCE option can succeed only if the
  database on which the command is issued has a network connection with the primary database and
  if the primary database and target standby database have a network connection." (FSFO19,
  FSFO26). "Disabling fast-start failover with the FORCE option on a primary database that is
  disconnected from the observer and the target standby database does not prevent the observer
  from initiating a fast-start failover to the target standby database." (CMD19;
  `B26/disable-fast_start-failover.html`). "This action may result in two databases in the
  configuration simultaneously assuming the primary database role." (FSFO19)
- **Where:** `sim/simulate.ts:1956` (`state.fsfoState = 'disabled'`, unconditionally); `force` is
  parsed (`serialize/schema.ts:949-952`) and shown (`ui/break/events.ts:1109`), never read.

### SIM-20 · P2 · both — A stalled primary that reconnects is redrawn "started and mounted"

- **Repro:** classic, PmyShutdown FALSE, Flashback off; isolate @0, heal both links @100.
- **Page shows:** prm01 `0:stalled | 100:mounted-noapply`, finding
  `FSFO.FORMER_PRIMARY_NOT_OPEN` (`documented`): "it is running again: it is started and mounted
  and requires reinstatement".
- **Oracle** documents only a former primary that is *restarted*: "To allow the master observer to
  automatically reinstate the former primary database, the database must be started and mounted.
  It will not be allowed to open in any event if fast-start failover is enabled." Nothing says a
  stalled, still-open primary is closed when contact returns. FSFO19, FSFO26, PROP19, the 26ai
  PmyShutdown page and HAOBS19 were grepped for stalled together with reconnect, regain and resume.
  The label should be `model`.
- **Where:** `sim/simulate.ts:1821-1826`, `2262-2268`.

### SIM-21 · P2 · both — A role change to a logical standby leaves the physical and snapshot standbys following

- **Repro:** `bystanders`, FSFO off: `SWITCHOVER TO lsby01` @0, or crash then `FAILOVER TO lsby01`.
- **Page shows:** sby01 ends `mounted-apply` and snp01 is still a standby of the new primary;
  nothing is disabled; `BYSTANDERS.FOLLOW` reads "ALL".
- **Oracle:** "All physical and snapshot standby databases will be disabled and must be re-created
  from a copy of the new primary database after a switchover to a logical standby database."
  (FSFO19; `B26/switchover.html`). "If the failover target is a logical standby database, the
  original primary database and all physical and snapshot standby databases in the configuration
  will be disabled." (FSFO19; `B26/manual-failover1.html`)
- **Where:** nothing under `sim/` handles a logical role (`grep -i logical` on `roles.ts` and
  `simulate.ts` finds nothing).

### VAL-07 · P2 · both — Switchover to a logical standby in MaxProtection (still open from 09-28)

- **Repro:** `bystanders` with MAXPROTECTION, `SWITCHOVER TO lsby01`: accepted, opens at 38 s; the
  menu offers it.
- **Oracle:** "Switchover to a logical standby database is disallowed when the configuration is
  operating in maximum protection mode." (FSFO19:98; `B26/switchover.html`:26)
- **Where:** no rule; `sim/roles.ts:69` has no case for it.

### SIM-22 · P2 · both — STOP OBSERVER accepted where Oracle refuses it

| Repro | Oracle |
|---|---|
| `multi-target-three-observers`, stop the master (backups running): accepted, obs02 nominated (`NOMINATION.NEW_MASTER`); menu row enabled (`ui/break/events.ts:467-474`) | "The STOP OBSERVER command fails if there are two or more registered observers and you attempt to stop only the master." (CMD19; `B26/stop-observer.html`) |
| classic, `link.cut dc1-dc2` @0, stop the observer @5: accepted; the primary stalls and aborts @35 | "If fast-start failover is enabled when you issue the STOP OBSERVER command, then the primary and standby databases must be connected and communicating with each other. Otherwise the following error is returned: … ORA-16636 fast-start failover target standby in error state, cannot stop observer" (same pages) |

- `observer.stop` is labelled as the command ("Stop the observer obs01"). A crashed observer host
  (the "Kill the master observer" scenario) is the event that matches these runs.
- **Where:** `sim/simulate.ts:1943`. The multi-observer lesson builds its nomination step on it
  (TXT-55).

### SIM-23 · P2 · both — "Start / stop redo apply" offered on a snapshot standby

- **Repro:** `bystanders`, snp01's member menu: "Start redo apply on snp01" is enabled
  (`ui/break/events.ts:416-436`). Setting it draws snp01 `mounted-apply`, "Applying redo". On the
  logical standby the row says "redo apply" where Oracle says SQL Apply.
- **Oracle:** "unlike a physical or logical standby database, a snapshot standby database does not
  apply the redo data that it receives" and "Snapshot standby databases are not listed in this
  table because they do not have states; they only receive redo data." (MEM19)

### SIM-30 · P2 · both — A RAC primary loses an instance, and the application's sessions on it are drawn as untouched

- **Repro:** `rac-primary` with an application; `instance.down prm01/prm011` @0.
- **Page shows:** no session loss, no reconnect ladder; AppView "Nothing to draw -- no role change
  happens, so the service never leaves the primary"; the lane "nothing for the connect string to
  survive".
- **Oracle:** "Any sessions active when the instance or service stops are terminated and the
  application user is immediately notified." and "With FAN, in-flight transactions are immediately
  terminated and the client notified when the instance fails." (`.../19/racad/ensuring-application-continuity.html`;
  26ai same). "If TAF is not configured, then the client only receives an error if the instance it
  is connected to fails." (`.../19/racad/workload-management-with-dynamic-database-services.html`).
  For the redial: "if a node or network is down, the VIP sends an instant reply, so that when
  connecting, the next address is used immediately if the service is not offered at the VIP
  address." (`HA19/oracle-net-tns-string-parameters.html`)
- **Where:** `models/app.ts:556-575` (sessions are lost only when the whole member stops serving),
  `633-657`; `ui/panels/AppView.tsx:518`; `ui/timeline/app-lanes.ts:322`.

### SIM-31 · P2 · both — "No fast-start failover clock starts" on a RAC instance loss, labelled documented

- **Repro:** `rac-primary`, own events (one instance down). Spaced: `prm011` down @0, `prm012`
  @100 → initiate @130, so the clock counts from the last instance lost.
- **Page shows:** `primaryDegradedClaim` (`documented`, citing `RAC.PRIMARY_AVAILABLE`,
  `RAC.LAST_INSTANCE_FSFO`): "…so the primary stays available and no fast-start failover clock
  starts." The preset says "no clock ever starts" and the lesson "no clock starts".
- **Oracle:** neither cited sentence mentions a clock. The sentences that do point the other way:
  "Fast-start failover will not occur unless all instances comprising the Oracle RAC primary
  database are perceived to have failed." and "If you have an Oracle RAC primary database, consider
  specifying a higher value to minimize the possibility of a false failover in the event of an
  instance failure." (FSFO19, FSFO26); "Oracle RAC miscount + reconfiguration time + 30"
  (`HA19/configure-and-deploy-oracle-data-guard.html`). Neither of the first two is in the
  catalogue. Drawing no clock is a fair model, but it is a model; the staggered rule (clock from
  the last instance) is an unlabelled inference. Overlaps TXT-21 and TXT-85.
- **Where:** `sim/rac.ts:167-176`, `presets/multi.ts:130-141`, `content/lessons/rac.tsx:60`.

### SIM-32 to SIM-35 · P3 — RAC and the application

| # | Finding | Where | Oracle |
|---|---|---|---|
| 32 | `FAILOVER=off` is offered on the descriptor, but the ladder still dials every address (disclosed in the control's note) | `models/app.ts:694-701`, `ui/inspector/ApplicationForm.tsx:171-177` | "When you set the parameter to off, no, or false, Oracle Net tries one protocol address." (netrf, 19c and 26ai) |
| 33 | One primary instance cut off from the standby while the others reach it: nothing happens, in MaxProtection too. Not drawn, not disclosed (a real cluster would likely evict the node first, hence P3) | `net/graph.ts:272-279, 322-329`, `sim/rac.ts:167-176` | "If any instance of an Oracle RAC primary database loses connectivity with a standby database, all other primary database instances stop sending redo to the standby database for the number of seconds specified on the LOG_ARCHIVE_DEST_n REOPEN attribute…"; "If a lost destination is the last participating SYNC destination, then the instance loses connectivity and is shut down." (sbydb appendix D.2.2, 19c and 26ai) |
| 34 | Switchover ends the old primary's sessions as it converts; session draining is not drawn. `SWITCHOVER … WAIT` is in 19c too (CMD19:3183); 26ai deprecates it for `DrainTimeout` | `types/events.ts`, `citations.ts:977` | "The WAIT option specifies that you want to wait for sessions to drain before proceeding with the switchover." (CMD19); "This property replaces the value specified for the WAIT option of SWITCHOVER because that option has been deprecated in 26ai." (`B26/draintimeout.html`) |
| 35 | A STALLED primary accepts new connections, with no label — the engine half of TXT-38 | `models/app.ts:266-267, 648-651`, `AppView.tsx:516-517` | "the primary stalls (no new transactions are able to commit)" (HAOBS19) — nothing about logons |

### SIM-24 · P3 · 26ai — The FSFO-disabled restart is documented under 26ai

`FAILOVER.FORMER_PRIMARY_MOUNTED` (`model`) says the state "is not spelled out". 26ai Scenario 11
spells it out (D7). The citation catalogue has no entry for it (no hit for `scenario-11`,
`DGM-17290` or "only one database open" in `app/src`, `docs` or `AGENTS.md`).

### SIM-25 to SIM-28 · P3 — smaller outcomes

| # | Edition | Finding | Where | Oracle |
|---|---|---|---|---|
| 25 | both | `cascade-terminal`: `BYSTANDERS.FOLLOW` is `documented` at 45 s while Remote_Sales stays `unreachable` ("Lagging — no redo is arriving") to the end. What a member with a non-null RedoRoutes and no rule for the new primary does is undocumented (RedoRoutes page grepped whole); neither reading carries a label | presets/cascade.ts, `ROUTES.RULE_ACTIVE` | `B26/bystandersfollowrolechange.html`: "If the bystander standbys are behind, then the broker simply sets up the redo transport configuration from the soon-to-be-new-primary to these standbys and completes the failover process." |
| 26 | both | Apply stopped on the target for the whole run: the failover opens at the same instant as with apply running | open-time model | FSFO19: the complete failover "Waits for the target standby database to finish applying any unapplied redo data before stopping Redo Apply" |
| 27 | both | Far-sync-fed target: `FSFO.READINESS_GATE` "passes" is `documented` while SYNCHRONIZED-across-the-hop is this page's model (`redo/resolve.ts:484`); one run shows the `documented` pass beside "Data loss: unknown". Under 19c the far-sync-only MAXAVAILABILITY level cites `MAXAVAIL.AT_LEAST_ONE`, while the per-member claim is `inferred` (`resolve.ts:521`, ~555) | `redo/resolve.ts` | Better sentence (MEM19): "at least one standby database that receives redo via the SYNC transport, either directly or through a far sync instance" |
| 28 | both | Manual failover to a snapshot standby: no convert-and-apply band (SIM-17 sibling) | `sim/simulate.ts` | see SIM-17 |

---

## B. Edition gating and defaults

| ID | Sev | Edition | Finding | Where | Oracle |
|---|---|---|---|---|---|
| ED-08 | P2 | both | `ConfigurationWideServiceName` placeholder says `<configuration name>_CFG`. `c.name` is the CREATE CONFIGURATION name. The 09-28 fix (TXT-07) was incomplete | `ui/inspector/ConfigForm.tsx:125` | "The default service name of this configuration-wide service is primarydbname_CFG, where the primary database name is appended with a suffix of _CFG." (PROP19; `B26/configurationwideservicename.html`) |
| ED-09 | P2 | 26ai | MaxAvailability lag limit: the unset default reads 0, but any edit clamps to a minimum of 5 and nothing returns to 0 or "not set" (read from code, not run) | `defaults.ts:36`, `ConfigForm.tsx:296-301`, `ui/inspector/edits.ts:1338`, `ui/break/TuneStrip.tsx:193` | "If the value is zero, the standby must have received all the redo data the primary has generated in order for automatic failover to occur." (FSFO26); default "Maximum availability mode: 0 seconds" (`B26/faststartfailoverlaglimit.html`). Oracle also says "Must be greater than, or equal to, 5" — its own conflict, see TXT-46 |
| ED-10 | P3 | both | `ConfigurationWideServiceName` accepts any 128 characters | `serialize/schema.ts:763-765` | "The first character must be an alphanumeric character. There is a 30–character maximum." (PROP19, 26ai page) |
| ED-11 | P3 | both | `PreferredObserverHosts` is Database scope; the form has one list, copied to every database. A simplification | `generate/dgmgrl.ts:650-671` | "Scope Database" (PROP19:693) |
| ED-12 | P3 | both | Page-imposed ranges that forbid documented values: threshold max 120, lag limit max 90, `ApplyInstanceTimeout` 0–600 in steps of 5 (a typed 7 stores 5), `RETRY_COUNT` max 100, `TRANSPORT_CONNECT_TIMEOUT` max 60 (= its default; sub-second unreachable) | `defaults.ts:62-64, 116-127` | "If you need more time to complete a Data Guard switchover, then change RETRY_COUNT greater than 100." (`HA19/connection-time-estimates-data-guard-switchover-or-failover.html`); Oracle gives only ">=0" / ">= 6" for the others |
| ED-13 | P3 | both | `ApplyInstances` offers 2..N (no cap at 16, dropped on load); offered on a primary; removing instances does not clamp | `ui/inspector/MemberForm.tsx:302, 310-312`, `edits.ts:522, 552`, `schema.ts:593-597` | "Valid values 0 to 16, ALL"; Role "Standby", Standby type "Physical standby" (PROP19; `B26/applyinstances.html`) |
| ED-14 | P3 | 26ai | JDBC thin defaults: TRANSPORT_CONNECT_TIMEOUT "Default 60 s" and RETRY_DELAY "No default is documented" with no edition split; the 20 s / 0 cited is the `oracle.net.CONNECT_TIMEOUT` property, not the descriptor keyword | `ui/inspector/client-timing.ts:39, 76`, `content/reference/client-parameters.tsx:21, 64`, `generate/jdbc.ts:31-33` | "Starting from Oracle AI Database Release 26ai, the default value of the TRANSPORT_CONNECT_TIMEOUT parameter is 20 seconds." / "…the default value of this parameter is 1 second." (RETRY_DELAY; `.../26/jjdbc/data-sources-and-URLs.html`) |

---

## C. Rules and routing (`validate/**`, `redo/*`)

Nothing from 09-28 has regressed. All twelve presets validate with no error or warning under
both editions.

| ID | Sev | Finding | Where | Oracle |
|---|---|---|---|---|
| VAL-09 | P3 | FSFO target transport enforced for MaxProtection and MaxAvailability (error), only `info` for MaxPerformance; the primary's row is skipped there (D8) | `validate/rules/modes.ts:110-180, 190, 257-272`; catalogue states "never 'SYNC is illegal there'" as fact | "Maximum performance — ASYNC" (FSFO19:401, FSFO26:260); Task 3: "…ensure that the LogXptMode database property for both the primary and target standby database is set to ASYNC." |
| VAL-10 | P3 | `EDIT.FSFO_ENABLED_BLOCKS` omits the MaxProtection→MaxAvailability exception, says FORCE is for "unobserved", and misses the RedoRoutes and disable-target restrictions | `validate/rules/dests.ts:127-136` | "An exception to this is that a downgrade to maximum availability mode is allowed when fast-start failover has been enabled in maximum protection mode." (MEM19:740; `B26/managing-data-protection-modes.html`:145). "Use DISABLE FAST_START FAILOVER with the FORCE option when the network between the primary and target standby databases is disconnected or when the database upon which the command is received does not have a connection with the primary database." (CMD19:751) |
| VAL-11 | P3 | `OBS.NAME_RESERVED` checks NONAME only | `validate/rules/observers.ts:120-146` | "The strings "NONAME" and "ALL" cannot be used as an observer name." (CMD19:2865; `B26/start-observer.html`) |
| VAL-12 | P3 | `OBS.MASTER_UNIQUE` (error) and `REINSTATE.PRECONDITIONS` fire with fast-start failover disabled — the VAL-04 trap, two more rules | `observers.ts:148-157, 181-208` | "When fast-start failover is disabled, no observer is called the master observer; all observers have the same functionality." (FSFO19:1069) |
| VAL-13 | P3 | `OBS.NONE_DEPLOYED` with FSFO enabled prepends the disabled text ("FS_FAILOVER_STATUS reads DISABLED … the switchover refusal … cannot fire") to the enabled one. The engine is right (the switchover is refused); the text is wrong. Same root as GEN-15 | `observers.ts:101-103` | status is PRIMARY UNOBSERVED (`.../19/refrn/V-DATABASE.html`:439); the lag-limit switchover restriction carries no observer condition (FSFO19:709) |
| VAL-14 | P3 | `ROUTES.LOGICAL_LOCAL_ONLY` is a warning, `ROUTES.SNAPSHOT_FORBIDDEN` an error, from adjacent bullets; and CONVERT DATABASE is stricter than the property page — an unnamed conflict | `validate/rules/routes.ts:76, 93` | "A physical standby database cannot be converted to a snapshot standby database if its RedoRoutes configurable property is set to non-NULL value." (CMD19:614; `B26/convert-database.html`) |
| VAL-15 | P3 | `DEST.NETTIMEOUT_LOW` fires on ASYNC destinations | `validate/rules/dests.ts:38-57` | NET_TIMEOUT "Requires attributes: SYNC"; "Conflicts with attributes: ASYNC (If you specify the ASYNC attribute, redo transport services ignores it; no error is returned.)" (`S19/LOG_ARCHIVE_DEST_n-parameter-attributes.html`) |
| VAL-16 | P3 | 26ai: the RedoRoutes alternative to the primary's LogXptMode is counted in MaxProtection; the 26ai MaxAvailability ASYNC-target warning is `documented` while 26ai Task 3 says SYNC or FASTSYNC (a conflict) | `modes.ts:127-134, 196-208` | FSFO26:261-264 names the alternative for MaxAvailability and MaxPerformance only; FSFO26:315 "In maximum availability mode, set the LogXptMode database property for both the primary and target standby databases to SYNC or FASTSYNC." |
| VAL-17 | P3 | Static service checked only for automatic reinstatement; Oracle Restart cannot be expressed | `observers.ts:187-188` | "A single-instance database on which Oracle Restart is not configured must have a static service registered with the listener so that the DGMGRL CLI can automatically start the instance when necessary (for example, for the new standby after a switchover)." (MEM19:1063) |
| VAL-18 | P3 | No primary, two primaries, duplicate member or instance names validate silently (`declaredPrimary` takes the first) | `types/topology.ts:355`, `validate/catalogue.ts` | "…up to 253 members, including one primary database…" (`B19/managing-oracle-data-guard-broker-configurations.html`:23) |
| VAL-19 | P3 | FSFO enabled with every named target disabled: no finding | `validate/context.ts:176-178` | "…the broker allows the disable operation to proceed only if the standby database is not the target standby database for fast-start failovers." (MEM19:761) |
| VAL-20 | P3 | 26ai documents get `DEST.DEPRECATED_19C`, a 19c note | `validate/rules/dests.ts:102` | — |

**Documented restrictions with no rule** (no finding exists for any of these): standby redo logs
at all — "Both the primary database and the target standby databases must have: Standby redo logs
configured" (CMD19:1342) — and per thread for a RAC primary; SRLs on storage all standby instances
reach; shared `DG_BROKER_CONFIG_FILEn`; role-based services need RAC or Oracle Restart;
multi-instance apply limits (Active Data Guard licence, `ApplyInstances` above the instance count
passes); the RAC connect identifier rules ("Allow all instances of an Oracle RAC database to be
reached", "The service should NOT be one that is defined and managed by Oracle Clusterware");
`SERVICE_NAME` required in the client descriptor; srvctl options identical on every database;
FAN needs Oracle Restart on a single instance; Application Continuity modes and licence; far sync
needs a dedicated server and an Active Data Guard licence; destinations 11–31 do not support SYNC
(`S19` destination attributes:836); ORA-16668, a fast-start failover target cannot become a
snapshot standby; `cmd.reinstate`, `cmd.setApplyInstance` and `cmd.setMasterObserver` are not
validated at all; the parser accepts `ALL` mixed with groups.

**Still open from 09-28:** VAL-07 item 4 (above, now VAL-07 P2). `XPT.PRIMARY_LOGXPTMODE` with a
primary fed through a cascader after the role change (`modes.ts:204` skips paths longer than one
hop). The 12.1 alternate taking over on unreachability rather than the `MaxFailure` count
(`redo/resolve.ts:372`, honestly `model`). Old documents with several parenthesised groups and no
priority (`serialize/schema.ts:452`).

---

## D. Generated text (`engine/generate/*`)

| ID | Sev | Emitted | Oracle | Where |
|---|---|---|---|---|
| GEN-14 | P2 | far sync presets: `FastStartFailoverTarget` set on the primary only, a note says the reciprocal is automatic, then `ENABLE FAST_START FAILOVER`. The script's own closing validation (`FSFO.FARSYNC_TARGET_BOTH_SIDES`) says the opposite | "the FastStartFailoverTarget property must first be set on both the primary and target standby database" (19c Scenario 7, `B19/examples-using-data-guard-broker-DGMGRL-utility.html`:441; 26ai Scenario 7) | `generate/dgmgrl.ts:697-703` |
| GEN-15 | P2 | FSFO enabled with no observer: the script drops `ENABLE FAST_START FAILOVER`, the target and every threshold/shutdown/reinstate property (a typed threshold is lost); SHOW prints "Enabled in Zero Data Loss Mode" and SUCCESS while the notes say FS_FAILOVER_STATUS "reads DISABLED" | "If you do not start the observer after you have enabled fast-start failover, the ORA-16819 warning is displayed" (CMD19:1328) — legal, status WARNING | `dgmgrl.ts:395-424`, `show.ts:283-298, 497-509` |
| GEN-16 | P2 | `BystandersFollowRoleChange` and `ConfigurationWideServiceName` are offered in the UI and simulated (`NONE`, `sim/simulate.ts:683`) but never written to the script | PROP19:70, :225 | `ConfigForm.tsx:115-129`, `dgmgrl.ts` |
| GEN-17 | P2 | "the routes are pre-declared for both directions" (`documented`) printed when only one direction exists — every preset but `far-sync-role-change`. The far sync presets have no South_Sales route, so after a role change the new primary reaches no far sync | "configure redo transport for the current standby database South_Sales so that when it is in the primary role it sends redo data to the far sync instance FS1." (26ai Scenario 5; 19c Scenario 5); without it SHOW CONFIGURATION WHEN PRIMARY IS shows "Members Not Receiving Redo" and ORA-16685 | `dgmgrl.ts:254` |
| GEN-30 | P2 | After a role change the SHOW panel is stale: "Active Target: sby01" while sby01 is the primary, SHOW OBSERVER "Primary: prm01", prm01 a plain physical standby, FSFO "Enabled in Zero Data Loss Mode", status SUCCESS | FAILOVER example (CMD19; 19c Scenario 10; `B26/failover2.html`): "North_Sales - Physical standby database (disabled) / ORA-16661: the standby database needs to be reinstated / Fast-Start Failover: DISABLED / Configuration Status: WARNING" | `show.ts:293` (SUCCESS hard-coded), `:526`, `:675`; `ui/panels/Show.tsx:48-53` |
| GEN-18 | P3 | SHOW CONFIGURATION WHEN PRIMARY IS prints a full SHOW CONFIGURATION, name unquoted | "The display lists all members, but unlike SHOW CONFIGURATION, it does not provide status or any other configuration information." (CMD19:2289; 26ai page) | `show.ts:173-300` |
| GEN-19 | P3 | `(*)` target marker only under VERBOSE (part of 09-28 GEN-12) | "The display highlights the current fast-start failover target with an asterisk (*) when fast-start failover is enabled" (CMD19:2193); plain example at CMD19:1827-1832 | `show.ts:242` |
| GEN-20 | P3 | `EDIT FAR_SYNC … SET PROPERTY 'MaxFailure'` (inspector-reachable) | MaxFailure Role "Standby, Recovery Appliance" — no far sync (PROP19; 26ai) | `dgmgrl.ts:318` |
| GEN-21 | P3 | MaxFailure kept per sender–receiver pair in init.ora, one value on the receiver in the script; the closing validation calls the in-group default 1 "non-default" | footnote: "The broker propagates the setting you specify on the standby database or far sync instance to the corresponding attributes of the LOG_ARCHIVE_DEST_n value of the database or far sync instance that is sending redo data." (PROP19) | `dgmgrl.ts:278-330`, `initora.ts` blockLines |
| GEN-22 | P3 | 19c: `PrimaryDatabaseCandidates` emitted as a `documented` line; only the closing block warns | absent from the whole 19c and 21c property pages | `dgmgrl.ts:379-393` |
| GEN-23 | P3 | SHOW FAST_START FAILOVER lists only the master observer; "sby01,sby02" without the space | "…the output of this command shows all registered observers and indicates, with an asterisk, which one is the master observer." (CMD19:2530); `Potential Targets: "East_Sales, West_Sales"` | `show.ts:412, ~419` |
| GEN-24 | P3 | RAC SHOW DATABASE stops after `Instance(s):` (no lags, no Database Status); says "apply runs on exactly one instance" with ApplyInstances above 1 | MEM19:529 "Redo Apply can run on all instances of an Oracle RAC database at the same time, but only one of the instances is the apply coordinator…"; examples at CMD19:2358-2373 | `show.ts:~615-660, 654` |
| GEN-25 | P3 | Script prerequisites never stated: the `prm01` alias used by CONNECT and CONNECT IDENTIFIER is not defined; standby redo logs, clearing remote destinations, DG_BROKER_START | 26ai Scenario 1 ("north_sales is a tns alias…"; "You must clear any remote redo transport destinations…"), 26ai Scenario 6 ("…unless the databases are configured with standby redo log files"), `B19/managing-oracle-data-guard-broker-configurations.html`:139 | `dgmgrl.ts` header, `tnsnames.ts` |
| GEN-26 | P3 | tnsnames card: "RETRY_COUNT (0 -- no retries) - RETRY_DELAY (immediate)", "CONNECT_TIMEOUT (no cap)" under a `documented` claim; under 26ai the JDBC card says RETRY_DELAY defaults to 1 s | Net pages print a default only for TRANSPORT_CONNECT_TIMEOUT | `tnsnames.ts:112-117`, `jdbc.ts:~70` |
| GEN-27 | P3 | JDBC URL writes `60sec`; the JDBC page shows bare numbers and lists units only for RETRY_DELAY. See TXT-30 | j26-urls:847-871 | `jdbc.ts:64, 72, 92` |
| GEN-28 | P3 | `initora.rac` card puts `ALTER DATABASE ADD STANDBY LOGFILE` in a file typed init.ora; SRLs only for receivers of a RAC primary (none on the primary; none for a single-instance primary with a RAC standby) | "Ensure standby redo logs are configured on the primary and target standby databases." (26ai Scenario 6) | `initora.ts:268-300` |
| GEN-29 | P3 | The role-based service the client cards dial (`app_svc`) is never created (no `srvctl add service -role PRIMARY`) | FSFO19:1478 | `presets/build.ts:221` |

---

## E. Prose, labels, citations (P3 unless noted)

### Citations

| ID | Finding | Where |
|---|---|---|
| TXT-14 | **P2, 26ai.** The SRL count rule is 19c's: "at least one more redo log group … for each redo thread" (19c and 21c). 26ai: "The standby redo log must have at least the same number of groups as the online redo log at the redo source database, for each redo thread at the redo source database." (`S26/oracle-data-guard-redo-transport-services.html`). The generated config still satisfies 26ai; the stated rule does not | `generate/initora.ts:273-275` |
| TXT-15 | 26ai: "only if Oracle Clusterware or Oracle Restart is not being used" is 19c wording; 26ai reads "For configurations where Oracle Clusterware or Oracle Restart are not being used, a static service must be registered…" (no "only") | `content/lessons/rac.tsx:29-37`, `dgmgrl.ts:229-237` |
| TXT-16 | `RAC.SCAN_ALIASES` (aliases in the database homes for members) applied to the application's descriptor; sbydb appendix D.1.3.2 says "that address list should contain connection data for each standby database instance" — `initora.ts` follows that, `tnsnames.ts` follows SCAN; unlabelled | `tnsnames.ts:69-77, 177-193`, `initora.ts:262-264` |
| TXT-17 | `RAC.SET_APPLY_INSTANCE` quote is the EDIT command; the lesson shows the "disregards" sentence under it | `rac.tsx:158` |
| TXT-18 | Oracle: "The SET STATE command will update the PreferredApplyInstance property to the new apply instance value". The engine leaves it, then later calls the moved-to instance "the running PreferredApplyInstance" (needs 3+ instances) | `sim/simulate.ts:1393-1409`, `sim/rac.ts:113` |
| TXT-19 | `RAC.APPLY_INSTANCE_SELECTION` carries the failover-rule sentence but is cited for three other sentences (switchover preparation, "randomly picks", snapshot not applicable) | `dgmgrl.ts:183-192`, `validate/rules/members.ts:87`, `sim/rac.ts:151-154` |
| TXT-20 | Generated SHOW DATABASE note says apply runs on exactly one instance with `ApplyInstances` above 1 (= GEN-24) | `show.ts:652-655` |
| TXT-21 | `RAC.PRIMARY_AVAILABLE` / `RAC.LAST_INSTANCE_FSFO` used for "no fast-start failover clock starts" (`documented`), "Only when the last instance … fails … does the broker fail over" ("only" is not in it; the sentence says "can continue to provide … by automatically failing over"), and the shared-host finding | `sim/rac.ts:169-175`, `rac.tsx:55-66`, `members.ts:141` |
| TXT-22 | The primary's LogXptMode note is inverted ("ships redo with it once a role swap makes it the standby") and cites a RedoRoutes example; LogXptMode governs redo shipped *to* the member (PROP19 footnote) | `dgmgrl.ts:151-161` |
| TXT-23 | `ROUTES.GRAMMAR_121` cited for every 19c/26ai RedoRoutes line, including PRIORITY groups 12.1 lacks; its note "stated most completely in 12.1" is wrong (19c has groups and PRIORITY, 12.1 has ALT) | `dgmgrl.ts:246-251` |
| TXT-24 | `ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX` ("GROUP is a LOG_ARCHIVE_DEST_n attribute, not RedoRoutes syntax.") is on no page; an inference used as `documented` | `dgmgrl.ts:259-262`, `initora.ts:190`, presets |
| TXT-25 | `FSFO.STATUS_WORDS`: "Enabled in Observe-Only Mode" is on the 19c Scenarios page, not the cited command page (which has "Observe-Only mode") | `show.ts:84` |
| TXT-26 | The alternate's generated block lacks the `ALTERNATE=<main>` back-reference the cited example has | `initora.ts:383-388, 424-427` |
| TXT-27 | `XPT.TABLE_4_2` cited for "ASYNC is never synchronized", "only SYNC acknowledges", "MaxPerformance never waits" and the output spelling — none is in the table; the quote drops its FASTSYNC footnote | `redo/resolve.ts:466, 508, 538`, `show.ts:211-213` |
| TXT-28 | `DGMGRL.BROKER_COMMANDS` digest cited for CONNECT and SHOW DATABASE, which it does not list (both are on the page) | `dgmgrl.ts:96`, `show.ts:619` |
| TXT-29 | Paraphrase slips: `(alternate of Local_Sales)` is VERBOSE-only (the generator is right); "a RAC primary lists its instances too" is extrapolated from one-instance examples | `citations.ts` |

### Engine wording

| ID | Finding | Where |
|---|---|---|
| TXT-52 | **P2.** MaxProtection: `PROT.COMMIT_HANG` (`documented`) says "…and the primary then drops the destination and carries on." ten seconds before the same run shuts the primary down. MEM19: "To ensure that data loss cannot occur, the primary database will shut down, rather than continue processing transactions, if it cannot write its redo stream to at least one synchronized standby database." | `sim/simulate.ts:1597-1600`, `sim/protection.ts:186-191` |
| TXT-53 | `FSFO.NOT_READY` "fast-start failover cannot happen" shown after the target has moved to sby02 (a later crash fails over to sby02) | `sim/simulate.ts:1267`, `sim/fsfo.ts:228-244` |
| TXT-87 | Split-brain note: "Oracle does not use the term". HAOBS19: "The term 'split brain' describes a scenario where there are two copies of the same database open read-write, each operating independently of the other." — the page's own definition, so the reading could cite it. It also omits stale reads: under PmyShutdown FALSE a stalled old primary still publishes the service (`models/app.ts:267`) while the reading says "no"; PROP19: "A value of TRUE helps to ensure that an isolated primary database cannot satisfy user queries." | `sim/split-brain.ts:1-8, 74-75` |
| TXT-89 | `SIM.ONE_ROLE_CHANGE` states as Oracle's that "fast-start failover stays enabled across a role change". Documented only for a failover plus reinstatement ("The reinstated database acts as the fast-start failover target for the new primary database…"); after a switchover only by implication | `sim/simulate.ts:727` |
| TXT-90 | `abortClaim` (`documented`) includes "The ping properties never move this clock" — no sentence. Stall onset is model too: the run stalls an isolated primary at 0 with no NET_TIMEOUT hang first, so SBR-01's `documented` abort at 30 rests on a modelled onset | `sim/protection.ts:175-177` |

### Lessons A (clocks, transport, SYNC, application, configuration, reference, RAC)

`rac.tsx` was read in full: every `<Fact>` quote is on its 19c page and, where checked, the
26ai page; its three `model` chips are right.

| ID | Finding | Where |
|---|---|---|
| TXT-30 | "older thin releases read a bare value as milliseconds": 19c "This value is in seconds."; 26ai "assumed in seconds if set in the URL with no explicit units and in milliseconds if set in the connection's properties". The suffix is harmless, the reason wrong (also found as TXT-81 and in GEN-27) | `ui/panels/Tns.tsx:40-41`, `generate/jdbc.ts:14, 92` |
| TXT-31 | "Oracle's HA guidance: a generous CONNECT_TIMEOUT" — the HA guide calls 90 s "very generous" and the broker guide says "Set the CONNECT_TIMEOUT parameter to a small value"; no conflict chip | `content/lessons/application-view.tsx:85-87` |
| TXT-32 | "a startup trigger on DATABASE_ROLE" — the only trigger Oracle documents is DB_ROLE_CHANGE | `application-view.tsx:44` |
| TXT-33 | Linux buffer defaults and the shared-server SDU: the Net Reference and Net Admin guide disagree; one side printed, no chip | `sync-transport.tsx:75, 125-126` |
| TXT-34 | listener.ora sample sets GLOBAL_DBNAME in SID_LIST: "Do not set the GLOBAL_DBNAME parameter in the SID_LIST_listener_name section of the listener.ora. A statically configured global database name disables connect-time failover." (netrf, both editions) | `sync-transport.tsx:108-110` |
| TXT-35 | "The documentation is explicit that the new primary … does not wait for the old one" — the sentence says only "Note that the new primary database does not need to be restarted." | `failover-clocks.tsx:163-168` |
| TXT-36 | Commit = max(local, remote) is `documented` in the Commit panel and `inferred` in the lesson; Oracle orders the steps, never says "max" | `models/commit.ts:115-118`, `Commit.tsx:296`, `transport-layer.tsx:38-45` |
| TXT-37 | "once the local write outlasts the round trip, the saving reads zero" contradicts the page's own formula (zero only when local ≥ RTT + standby write; 12/10/5 gives 3 ms) | `transport-layer.tsx:70-72`, `Commit.tsx:~314` |
| TXT-38 | "The listener still answers -- connections are accepted throughout" on a STALLED primary, stated as fact; Oracle says only "no new transactions are able to commit" | `ui/panels/AppView.tsx:84-88`, `models/app.ts` |
| TXT-39 | "Nothing rewrites them on a role change." `documented` on a spliced paraphrase; should be `inferred` | `configuration.tsx:58` |
| TXT-40 | 19c captions list ObserverPing* as clock properties | `configuration.tsx:42-44`, `ui/panels/Dgmgrl.tsx:30-33` |
| TXT-41 | Ping step omits "Setting the ObserverPingInterval and ObserverPingRetry properties must be used only in low latency environments." (FSFO26:1311, 21c) | `failover-clocks.tsx:76-96` |
| TXT-42 | Observer-count conflict chip misses that 19c contradicts itself: CMD19:2879 "You can register up to four observers…" vs FSFO19:573 "up to three" (also TXT-59 for the preset) | `failover-clocks.tsx:188-195` |
| TXT-43 | The AWR "worked example" is Oracle's red-flag run (Table 17-3: "This is an immediate red flag given that the primary and standby were using the same hardware"), not the tuned one | `sync-transport.tsx:232-236` |
| TXT-44 | "LOG_ARCHIVE_DEST_1 is the local online redo log destination" — a convention stated as Oracle's rule | `ui/panels/Dests.tsx:27-28` |
| TXT-45 | Reopen panel draws no stall at the UNSYNCHRONIZED / LAGGING transition under 19c, where FSFO19 says "…redo generation on the primary database will be stalled. … either the observer or target standby database may allow the primary database to continue redo generation after first recording that a fast-start failover cannot happen." (19c page may carry later text; unverified) | `models/reopen.ts:277-286`, `Reopen.tsx:452-460, 482-486` |
| TXT-46 | 26ai lag-limit caption contradicts itself and hides Oracle's own (default 0 below minimum 5) | `reference.tsx:40-42` |
| TXT-47 | "Where 26ai reports it" includes VALIDATE FAST_START FAILOVER, which is in 19c (CMD19:3628) | `reference.tsx:91-98` |
| TXT-48 | "Since 12.1, maximum availability mode only." has no `<Fact>` | `transport-layer.tsx:67-70` |

### Lessons B, presets, the run's text

| ID | Finding | Where |
|---|---|---|
| TXT-50 | **P2.** Far sync lesson, step "When the far sync fails", injects `member.down` on `fs1`; the preset's member is `FS1`. The unknown id is ignored, so the run shows nothing happening while the note says "the redo path breaks, the protection level drops" | `content/lessons/far-sync.tsx:265`, `ui/learn/apply.ts:35` |
| TXT-51 | **P2.** Cascading lesson: step "The rule pair" patches routes to `prm01`/`sby02`, ids absent from `cascade-terminal`, and removes the forwarding the note describes; step "Manual failover to a terminal standby" fails over to `sby02` and reports `FSFO.TARGET_KIND` about a far sync that does not exist. A scan of every step of all ten lessons found only these three | `cascading.tsx:129, 172` |
| TXT-54 | `cascade-terminal` says "A manual FAILOVER to it is documented and legal", but the preset has FSFO enabled and the engine (rightly) refuses with ORA-16655; needs "with fast-start failover disabled" | `presets/cascade.ts`, `cascading.tsx` |
| TXT-55 | Multi-observer lesson builds "the documented nomination case" on STOP OBSERVER of the master, which Oracle refuses with backups running (SIM-22); a crashed observer host matches the sentence | `multi-observer.tsx:~105` |
| TXT-56 | Captions that do not match the run: "Crash the primary host" crashes `instances[0].host` only, so on the RAC presets nothing fails over while the caption says observer and standby lose the primary; "Kill the master observer" kills `observers[0]`; the `manual` caption "No fast-start failover is armed" shows when FSFO is armed but cannot occur; `stall-noone` "the observer died with the standby" shows for a stopped observer; the healthy caption says every standby applies | `ui/break/events.ts:965, ~1040`, `engine/compat/classic.ts:338, 342`, `ui/timeline/build.ts:1180, 1197` |
| TXT-57 | Lane labels: "Observer stopped — nobody is watching" while another observer is master; "Lagging — no redo is arriving" on an idle far sync and a stood-down alternate; "Mounted — redo apply is stopped" on a snapshot standby (open read-write by design) and on the former primary after a switchover, where Oracle says "Redo Apply begins applying redo data from the new primary database" | `ui/timeline/build.ts:~820-885` |
| TXT-58 | "Data loss: unknown … The far sync instance went down with the primary" also shown when the far sync is up but isolated with the primary; Oracle: "Any unsent redo data residing on the far sync instance is transmitted to the target physical standby prior to converting the physical standby into a primary database." The far sync lesson says the direct link serves "role transitions"; Oracle says "health checks and switchover processing tasks" | `state/derived.ts:428`, `far-sync.tsx` |
| TXT-59 | "Three observers are registered, the 19c maximum" stated flat in the preset (conflict labelled only in the lesson); "PreferredObserverHosts … defaulting to Null — which restricts nothing" and the primary-site placement reasoning carry no chip | `presets/multi.ts`, `multi-observer.tsx` |
| TXT-60 | The timeline's event text drops IMMEDIATE and FORCE | `ui/timeline/build.ts:935, ~938` |
| TXT-92 | Far sync presets say the new primary ships "straight to North_Sales … with no far sync instance in front of it", while the run draws FS1 receiving from the new primary (`(LOCAL : ALL)` and a far sync with no active rule is undocumented either way) | `presets/farsync.ts` |

### Reference tables and inspector notes

| ID | Finding | Where |
|---|---|---|
| TXT-80 | Lag limit greyed under MAXPROTECTION with the wrong reason; Oracle: "The FastStartFailoverLagLimit property is not used in maximum protection mode." | `ui/inspector/why.ts:150-156, 41, 51` |
| TXT-82 | What `FastStartFailoverLagType=TRANSPORT` does is stated as fact from a blog; the 26ai page says only "specifies the type of lag (apply lag or transport lag) the user wishes to use to specify their data loss threshold." | `content/reference/broker-properties.tsx`, `changes-26ai.tsx:68-72`, `ConfigForm.tsx:314` |
| TXT-83 | "What changed in 26ai": the ASYNC MaxAvailability target is 21c ("Maximum availability — SYNC or FASTSYNC or ASYNC", 21c FSFO chapter:641); transition speed and ASYNC connections rest on a blog only; PrimaryDatabaseCandidates is not on 26ai's "New Broker properties" list | `content/reference/changes-26ai.tsx` |
| TXT-84 | PreferredApplyInstance note omits "Once the apply instance is selected and, as long as the apply instance is still running, the broker disregards the value of the PreferredApplyInstance property even if you change it." | `ui/inspector/MemberForm.tsx:288` |
| TXT-85 | Threshold note drops "If you have an Oracle RAC primary database, consider specifying a higher value to minimize the possibility of a false failover in the event of an instance failure." (FSFO19:463, FSFO26:326) — the page now draws RAC primaries | `ui/inspector/notes.ts:21` |
| TXT-86 | PrimaryDatabaseCandidates default "—" (Oracle: "an empty string that means no restriction"); ConfigurationWideServiceName "as an alternative to listing every address" is on no page | `broker-properties.tsx`, `ConfigForm.tsx:132` |

### RAC and client-model labels

| ID | Finding | Where |
|---|---|---|
| TXT-70 | 26ai JDBC thin: "No default is documented" for RETRY_DELAY and the note "earlier drivers default RETRY_DELAY to no delay" (no sentence). Oracle 26ai: "…the default value of this parameter is 1 second." Same family as ED-14 | `ui/inspector/client-timing.ts:39, 76`, `content/reference/client-parameters.tsx:64`, `citations.ts:1297` |
| TXT-71 | The RAC claims' own sentences are missing from the catalogue: the "perceived to have failed" rule, the threshold advice, the miscount row. 19c only: multi-instance Redo Apply "(This feature requires the standby database to have a license for the Oracle Active Data Guard option.)" — the 26ai page drops it; the ApplyInstances control and rule never mention it | `citations.ts:542-640`, `MemberForm.tsx:306-325`, `validate/rules/members.ts:95-107` |
| TXT-72 | `REFUSAL` (`documented`, ORA-12514) says the refusal is instant; the ORA-12514 text says nothing about timing, the sentence that does is uncited: "the listener on the standby will answer immediately that the service is not there, prompting the client to connect to the other ADDRESS_LIST." (`HA19/connection-time-estimates-data-guard-switchover-or-failover.html`). The ladder dials one address per node where Oracle's string uses one SCAN per cluster ("each IP in the SCAN address is expanded internally into a separate ADDRESS string"); the generator discloses it, the app model does not | `models/app.ts:238-241` |
| TXT-73 | `SET STATE … WITH APPLY INSTANCE` on a primary is reported as "not a running instance of a RAC standby"; Oracle: "If the target state is not APPLY-ON or if the database is currently in the primary role, the WITH APPLY INSTANCE clause is ignored even if it is specified." (CMD19). See also TXT-18 | `sim/simulate.ts:1406-1411` |
| TXT-75 | The RAC apply gap lengthens a manual failover and a switchover with no decision; only the FSFO path records `RAC.APPLY_GAP_IN_FAILOVER` (ApplyInstanceTimeout 30, apply instance down, manual failover: open at 25 instead of 20) | `sim/simulate.ts:548-552, 828, 968` |

---

## F. Checked and found correct

- **The 09-28 fixes.** 27 of 27 probes `CHANGED`. Readiness as state (SIM-01), the stall only
  while a state change is left to confirm (SIM-02), the former primary mounted (SIM-03), commands
  against down members refused (SIM-04), the multi-target restriction (SIM-05), manual failover
  gates (SIM-07/08), the far sync switchover (SIM-09), ED-01 (ping properties under 19c), VAL-01
  (PRIORITY), VAL-02, VAL-04, GEN-01, GEN-03.
- **Core outcomes, both editions** (~250 runs): primary crash → failover one threshold later,
  zero loss when synchronized; isolated primary → stall, abort after the threshold, failover,
  no split brain; partition or standby site lost → NET_TIMEOUT hang, then UNSYNCHRONIZED and a
  later crash is blocked; observer lost first then target → no stall (HAOBS19: "the outage of
  both at different times"); target lost first then observer → stall; observer–primary link only
  → unobserved, primary continues; MaxPerformance lag grows while cut off and blocks a failover
  past the limit; 26ai ping properties ("The FastStartFailoverThreshold property is ignored when
  the ObserverPingRetry and ObserverPingInterval properties are set."); MaxProtection shuts the
  primary down when the last SYNC standby goes, and an FSFO failover from MaxProtection opens in
  MaxAvailability; `member.down` is labelled SHUTDOWN ABORT, so FSFO firing on it is right
  ("Fast-start failover will not be attempted for the other types of database shutdown").
- **Split-brain probes SBR-01 to SBR-08 and HEALTHY-01.** SBR-01/05: the abort one threshold after
  the stall matches PROP19 ("STALLED for longer than FastStartFailoverThreshold seconds"); an
  aborted primary stays aborted when links heal. SBR-02: indefinite stall under PmyShutdown FALSE
  ("must be FALSE for the primary to stall indefinitely"). SBR-03/04/07 and SIM-07: nothing
  documented closes a running old primary after a manual failover with FSFO disabled; Oracle puts
  the shutdown on the operator ("ensure that the primary database is shut down"), so drawing it
  open is a fair `model` (SBR-06, FSFO enabled, is D5). SBR-08 and SIM-03: a restarted former
  primary under FSFO is mounted, REINSTATE REQUIRED, "It will not be allowed to open in any event
  if fast-start failover is enabled." HEALTHY-01: nothing in Oracle starts a failover without a
  failure; health conditions and `DBMS_DG.INITIATE_FS_FAILOVER` are disclosed as not drawn.
- **Presets.** All twelve are configurations Oracle accepts as drawn, both editions: SYNC on
  primary and target in MaxAvailability; far sync SYNC with the target ASYNC; RedoRoutes shapes of
  Examples 1–5 and 4-2/4-3 with ASYNC spelled out for real-time cascading; observers off the
  cluster; MaxProtection with two SYNC standbys. Their own events, the seven shelf scenarios and
  "Everything is working" behave as documented; the healthy run's chips are all `model`.
- **RAC.** One instance down: no failover; all instances down, at once or spaced: failover one
  threshold after the last; one instance back before the threshold cancels it; the observer or
  standby cut from one instance but reaching another still sees the primary ("Fast-start failover
  will not occur unless all instances comprising the Oracle RAC primary database are perceived to
  have failed.", FSFO19:643, FSFO26). A RAC standby lost entirely in MaxAvailability: NET_TIMEOUT
  hang, then the primary continues ("When every instance in an Oracle RAC configuration loses
  connectivity to the standby destination, the primary database continues operation in maximum
  performance mode.", sbydb D.2.2). Apply instance failover after `ApplyInstanceTimeout` (default
  0, "immediate apply instance failover"); back before the timeout resumes on the same instance;
  PreferredApplyInstance if running, else another running instance (labelled as the page's
  deterministic pick of Oracle's "random"); `SET STATE … WITH APPLY INSTANCE` to a down instance
  leaves apply where it was ("Otherwise, the apply instance remains the same."); multi-instance
  apply with a participant lost is labelled `model`. Switchover from a RAC primary with an instance
  down proceeds ("it is not necessary to shut down all but one primary database instance").
  `instance.down` is labelled SHUTDOWN ABORT. All 21 new `RAC.*` citations are on their 19c pages
  and, except TXT-14/15, on the 26ai pages.
- **The client model (APP-01, APP-02).** (RETRY_COUNT+1) traversals plus RETRY_COUNT delays has the shape of the HA
  guide's failover-time formula; min(TRANSPORT_CONNECT_TIMEOUT, CONNECT_TIMEOUT) per address
  matches "TRANSPORT_CONNECT_TIMEOUT is effectively capped by CONNECT_TIMEOUT"; RETRY_COUNT as
  extra traversals matches "additional attempts to connect beginning with the first ADDRESS_LIST
  will be made RETRY_COUNT times"; two open primaries publishing is labelled `model`, which is all
  Oracle allows (it documents only the avoidance of split brain).
- **Far sync.** FS1 lost reduces the level ("This does reduce the protection level because redo
  transmission is then in ASYNC mode instead of SYNC mode."); the HA pair drops to ASYNC only when
  both are gone ("If both far sync instances fail, then redo ships in ASYNC mode directly to
  boston").
- **Defaults, both editions.** Threshold 30/≥6; lag limit 30/≥5 (26ai MaxAvailability 0); 26ai
  ping defaults; PmyShutdown TRUE, AutoReinstate TRUE, ObserverOverride FALSE, Bystanders ALL,
  TransportDisconnectedThreshold 30, LogXptMode ASYNC; NetTimeout 30 (0–1200 property, 1–1200
  attribute); ReopenSecs 300; MaxFailure 1 inside a RedoRoutes group, else 0;
  PreferredApplyInstance, ApplyInstanceTimeout, ApplyInstances (0–16, ALL); TRANSPORT_CONNECT_TIMEOUT
  60 s per ADDRESS and IP; no Net default for CONNECT_TIMEOUT, RETRY_COUNT or RETRY_DELAY;
  FAILOVER and LOAD_BALANCE defaults; the HA failover-time formula. Edition gating follows D1.
- **Generated text.** DGMGRL formats (CREATE CONFIGURATION, ADD DATABASE / FAR_SYNC, protection
  mode via MAXAVAILABILITY, ENABLE FAST_START FAILOVER [OBSERVE ONLY], START OBSERVER … IN
  BACKGROUND CONNECT IDENTIFIER IS, SET MASTEROBSERVER), property levels, ping properties only
  under 26ai and before ENABLE, LagType/GraceTime only under 26ai MaxPerformance, the LogXptMode →
  attribute mapping, `SET STATE='APPLY-ON' WITH APPLY INSTANCE`, SID-prefixed SPFILE lines,
  distinct INSTANCE_NUMBER, `%t`, tnsnames layout, JDBC keywords, the SHOW mocks against the
  19.27 capture, collector SQL columns on both editions.
- **Paraphrases.** 13 of the 17 `paraphrase: true` citations are faithful to the sentences they
  rest on; the other four are TXT-24, TXT-25 and TXT-29.

## G. Not verified

- **No live database.** Everything here is documentation plus engine runs. The read-only query
  against the 19c test host was blocked (D9).
- What a still-open old primary does after a manual failover with FSFO enabled (D5), or on reaching
  the new primary with FSFO disabled; how a restarted former primary learns of a role change it
  cannot see (D7); whether services stop on a former primary; whether a switchover leaves FSFO
  armed (only implied).
- Stall onset relative to NET_TIMEOUT (TXT-90); whether the PmyShutdown shutdown is an abort (HA
  guide) or a shutdown (broker pages); whether in-flight commits error or hang.
- The release where the SRL count rule changed (21c still says "one more").
- Whether DGMGRL accepts comment lines containing quotes, a multi-line value in a pfile, or `sec`
  suffixes in a thin URL.
- 26ai homes of the 19c connect-string, FAN, ONS and Application Continuity sections (not in FSFO26).
- RAC per-instance transport: "If any instance of an Oracle RAC primary database loses
  connectivity with a standby database, all other primary database instances stop sending redo
  to the standby database for the number of seconds specified on the LOG_ARCHIVE_DEST_n REOPEN
  attribute" (sbydb appendix D.2.2) cannot be drawn, because the page has no partition inside a
  cluster.
- `(LOCAL : ALL)` at a new primary and a far sync with no active rule; a non-null RedoRoutes with
  no rule for the new primary (SIM-25, TXT-92).

## H. What a fix touches beyond the code

- `AGENTS.md` / `app/design/facts.md`: the split-brain "Oracle does not use the term" line
  (TXT-87); "fast-start failover stays enabled across a role change" (TXT-89); the SRL rule per
  edition (TXT-14); the static-service sentence per edition (TXT-15).
- Tests that pin today's behaviour: the SBR probes, and any goldens with the "pre-declared for
  both directions" note (GEN-17) or the stale SHOW panel (GEN-30).
- Each fix should turn its probe from `OPEN` to `CHANGED` and add its own regression test to the
  ordinary suite. The probe stays, so the next review can see the finding was looked at again.
