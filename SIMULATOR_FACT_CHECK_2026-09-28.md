# Workbench fact check — 2026-09-28

Scope: `app/` (engine, validation, generators, presets, lessons, UI strings), both editions
(19c, 26ai). Report only — no engine, content, rule, preset or test was changed. The frozen
legacy fragment in `simulator/` was not reviewed, but it shares the model behind ED-01 and
SIM-01/02.

Reviewed state: `main` on 2026-09-28, between `9e4494e` and `3191048`. The probes were re-run
against `3191048`: 27 of 27 showed what is recorded here. The fixes followed the same day; see
*Resolution*.

To repeat the review: `docs/agents/fact-check.md` (procedure),
`app/test/fact-check/probes.probe.ts` (the scenarios below, runnable),
`app/test/fact-check/fetch-docs.sh` (the Oracle pages, as greppable text).

```bash
cd app && npx vitest run --config vitest.factcheck.config.ts
```

## Resolution (same day)

Everything below this section is the report as it was written, before any fix. This section
is what was done about it. After the fixes: 2280 tests green (1962 before), the legacy gate
tests unmodified and green, 27 of 27 probes `CHANGED`, 203 of 204 checked citation quotes
found word for word on their pages (the miss is a table, `XPT.TABLE_4_2`, not a wrong quote).

### Decisions taken

| # | Question | Decision |
|---|---|---|
| D1 | What "19c" means | **19c as documented.** What a live 19.27 system shows beyond the documentation (`FastStartFailoverLagType`, `FastStartFailoverLagGraceTime`, `PrimaryDatabaseCandidates` in its property list) is recorded as an observation and labelled as one; the controls grey under 19c. `ObserverPing*` are in neither the 19c documentation nor the 19.27 binaries, and are gone from the 19c edition |
| D2 | Role changes per run | **One, disclosed.** `SIM.ONE_ROLE_CHANGE` says so when later events would need a second |
| D3 | Resynchronization | Still drawn as immediate, now labelled as this page's model (`FSFO.RESYNC_INSTANT`), and the zero after it is `model`, not `documented` |
| D4 | The frozen legacy page | Untouched. Where the corrected engine disagrees with it (ping under 19c, the stall when not ready, manual loss in MaxPerformance), the compat adapter alone sets three `SimParams` switches so the parity tests keep passing unmodified. **The legacy page still shows the old behaviour for ED-01 and SIM-02c** |

### Per finding

| Finding | Status | What the page does now |
|---|---|---|
| SIM-01 | fixed | Readiness is state. A standby the primary ran without is not ready; a later primary failure is a blocked failover citing "was not synchronized at the time the primary database failed". Lag grows while the target receives nothing |
| SIM-02 | fixed | Stall only while a state change is left to confirm. Observer lost first, already unsynchronized, already over the limit: the primary runs on |
| SIM-03 | fixed | Former primary is mounted and needs reinstatement (`ORA-16649`); never open, never a redo destination |
| SIM-04 | fixed | Commands against a down or unreachable member are refused by the engine and greyed, with the reason, wherever events are offered |
| SIM-05 | fixed | The target changes only while the primary is alive. Primary and first target lost together: no failover (`documented` 26ai, `doc-later` 19c). The preset now loses the first target at 0 and the primary at 20 |
| SIM-06 | fixed | Manual loss is the time the primary ran without the standby, basis `model` |
| SIM-07 | fixed | `FAILOVER.PRIMARY_STILL_OPEN` error; `IMMEDIATE` refused while fast-start failover is enabled |
| SIM-08 | fixed | Current target only; switchover refusal cites `ORA-16655` |
| SIM-09 | fixed | A far sync hop is not a cascade; no warning under 19c, no refusal under 26ai |
| SIM-10 | decision D2 | Disclosed, not modelled |
| SIM-11 | decision D3 | Labelled |
| SIM-12 | fixed | Degraded level is `model`; the chip says "operates as if", not "the broker reports". No sentence was found stating when `RESYNCHRONIZATION` shows |
| SIM-13 | fixed | Zero across a far sync is `model`; far sync lost with the primary gives an unknown loss |
| SIM-14 a–g | fixed | Nomination on a lost link to a live master; `SET MASTEROBSERVER` conditions; bystander wording and the ahead-of-target case; protection mode after a role change; reinstate preconditions; the master's chip; the refusal caption reads a typed reason from the trace |
| ED-01 | fixed in `app/` | Greyed, validated (`FSFO.PING_PROPS_NOT_IN_19C`), not emitted, not simulated under 19c. Legacy page: see D4 |
| ED-02 | decision D1 | UI, engine and generator now agree |
| ED-03 | fixed | 19c rule carried as `conflict` with both citations and `(not in use)`; attribution is 21c. A document that never set the limit follows the edition's default (`lagLimitOf`), so every MaxAvailability preset is Zero Data Loss under both editions |
| ED-04 | fixed | Edition-aware counting and wording in the engine, the reopen panel, the inspector and the generated comments; `MaxFailure` defaults to 1 inside a group |
| ED-05 | fixed | Available under 19c, `EDIT DATABASE`, edition-specific note |
| ED-06 | fixed | View names, SHOW ping lines, SDU default, JDBC `RETRY_DELAY`, far sync acknowledgement, observe-only sentences. `SWITCHOVER … WAIT` deprecation is stated in the lesson |
| ED-07 | fixed | All six attributions |
| VAL-01 | fixed | `PRIORITY` on the destination; one path per group, sticky among equals, the `PRIORITY=8` rule; old documents migrate to what their author saw drawn |
| VAL-02 | fixed | "At least one" at configuration level; the per-member list binds the target and the primary while fast-start failover is on |
| VAL-03 | fixed | `ROUTES.ALT_12_1_ONLY` under both editions; `FALLBACK` follows the 12.1 sentence; no preset generates `ALT=` |
| VAL-04 | fixed | All eight rows |
| VAL-05 | fixed | All six rows |
| VAL-06 | fixed | Primary's `LogXptMode` in ten presets; new rule `XPT.PRIMARY_LOGXPTMODE`; every preset validates without an error under both editions |
| VAL-07 | fixed, two skipped | Added 1, 2, 3, 5, 7. Item 6 is the generator's staged upgrade (GEN-03). Item 4 (no switchover to a logical standby in MaxProtection) is **not** added |
| GEN-01 … GEN-13 | fixed | Script and mocks follow the documented forms; the 19c `SHOW FAST_START FAILOVER` mock follows the live 19.27 output |
| TXT-01 | fixed, and **the finding was too strong** | The reader-facing text now uses the broker guide's "shut down". But the HA guide does say the primary "aborts" ("causing it to abort so that existing connections…"), so "aborts" was never unsupported — only absent from the broker pages. Two occurrences that rest on the HA guide remain |
| TXT-02 … TXT-13 | fixed | |

### Still open

- The legacy page (D4).
- VAL-07 item 4.
- `XPT.PRIMARY_LOGXPTMODE` does not look at a primary that would be fed through a cascading
  standby after the role change.
- The 12.1 alternate takes over when the named member is unreachable, not when its `MaxFailure`
  count is reached (labelled `model`).
- An old document with several parenthesised groups and no priority at all cannot be told from
  the new shape, and loads as the new reading.
- Nothing here was run against a 26ai database.

## How this was checked

| Source | What it is |
|---|---|
| Oracle docs | Raw HTML pulled with `curl` from docs.oracle.com, converted to text, quotes matched by grep. No summarising model in the loop. 19c, 21c and 26ai broker guide, sbydb, refrn, netrf, haovw, error help. |
| Engine runs | ~60 event scenarios run through `simulate()`. Each `Repro` below is an event list that reproduces the finding; the ones that decide a finding are kept as probes in `app/test/fact-check/probes.probe.ts`. |
| Live 19c | Read-only look at a real fast-start failover pair, **19.27.0.0.250415**: `SHOW CONFIGURATION VERBOSE`, `SHOW FAST_START FAILOVER`, `strings` on the `dgmgrl` and `oracle` binaries. No 26ai database was available — every 26ai finding rests on documentation only. |

URL prefixes: `B19` = `https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr`,
`B26` = same with `/26/`, `S19`/`S26` = `.../19/sbydb`, `.../26/sbydb`,
`HA19` = `.../19/haovw`. `FSFO19` = `B19/using-data-guard-broker-to-manage-switchovers-failovers.html`,
`FSFO26` = `B26/fast-start-failover2.html`, `PROP19` = `B19/oracle-data-guard-broker-properties.html`,
`CMD19` = `B19/oracle-data-guard-broker-commands.html`,
`MEM19` = `B19/managing-oracle-data-guard-broker-configuration-members.html`.

Severity: **P1** the page shows an outcome Oracle documents as impossible, or offers something
that does not exist · **P2** wrong under one edition, wrong rule, generated text that would fail ·
**P3** label, wording, citation.

Paths are relative to `app/src/` unless they start with `app/`.

## Two decisions needed before fixing

1. **What "19c" means.** Oracle's 19c *documentation* and a current 19c *release update* disagree
   (ED-02, ED-03). The fix differs depending on whether the 19c edition draws "19c as documented"
   or "19c at a named RU".
2. **How many role changes a run models.** The engine stops evaluating fast-start failover after
   the first transition (SIM-10). Either model the second one or say on the page that it is not
   modelled.

---

## A. Simulated outcomes (`engine/sim/*`)

### SIM-01 · P1 · both — Zero-loss failover after the standby stopped receiving redo

- **Repro:** classic 1+1+1, MaxAvailability, observer in DC3. `link.cut dc1-dc2` at 0,
  `host.down dc1-prm01` at 100.
- **Page shows:** primary commit-hang 0–30 s, open read-write 30–100 s, fast-start failover
  initiated at 130 s, new primary open at 155 s, readout "Data loss: none — The new primary opened
  with every acknowledged commit", basis `documented`.
- **Oracle:** "either the observer or target standby database may allow the primary database to
  continue redo generation after first recording that a fast-start failover cannot happen."
  Fast-start failover cannot occur "If the protection mode is maximum availability or maximum
  protection and the target standby database was not synchronized with the primary database at
  the time the primary database failed". `UNSYNCHRONIZED` → "Is not possible". (FSFO19, FSFO26,
  identical.)
- **Same defect, other shapes:**
  - far sync host down at 0, primary crash at 100 → zero-loss failover;
  - far sync preset, `dc1-dc2` cut at 0, crash at 100 → zero-loss failover;
  - MaxPerformance (both editions) and 26ai bounded MaxAvailability: same events → failover
    "≤ 10 s loss", because the lag is the static slider value and never grows while the standby is
    cut off. Oracle: `TARGET OVER LAG LIMIT` → "Is not possible".
- **Where:** `sim/simulate.ts:177-184, 662-668` (`lastKnownSync` latch, only updated while redo
  reaches the member), `sim/fsfo.ts:146-168` (`readinessGate`), `sim/fsfo.ts:114-130` (static lag),
  `state/derived.ts:280-291` (readout text).
- **Note:** the latch is right while the primary is dead, stalled or hanging. It is wrong from the
  instant the primary resumes commits without that standby.

### SIM-02 · P1 · both — Primary stalls and aborts where Oracle says it keeps running

The engine stalls whenever the primary reaches neither the master observer nor a target
(`sim/simulate.ts:1099-1104`). Oracle stalls only when a state change cannot be confirmed:
`STALLED` "Displays on the primary database after loss of connectivity to the target standby
database and the change to the UNSYNCHRONIZED state (maximum availability mode) or to the TARGET
OVER LAG LIMIT state (maximum performance mode) cannot be confirmed by either the target standby
database or the observer." (FSFO19 Table 5-1, FSFO26 Table 6-2.)

| Case | Repro | Page shows | Oracle |
|---|---|---|---|
| a. Observer lost first | `observer.stop` at 0, `link.cut dc1-dc2` at 50 | stalled at 50, aborted at 80 | "While the configuration is in the unobserved state, fast-start failover cannot happen. Therefore, the primary database can continue processing transactions, even if the target standby database fails." (FSFO19, FSFO26) |
| b. Already unsynchronized | `link.cut dc1-dc2` at 0, `link.cut dc1-dc3` at 100 | stalled at 100, aborted at 130, **and** failover at 130 with zero loss | "This is how we ensure that an observer or standby outage, or the outage of both at different times, does not impact the availability of the primary database" (`HA19/optimizing-automatic-failover-common-scenarios-minimize-downtime1.html`) |
| c. Already over the lag limit | MaxPerformance, apply lag 45, limit 30, isolate the primary | stalled at 0, aborted at 30 | `STALLED` definition above: no state change is pending |

The 24-cell matrix is not affected: every cell there loses the observer and the standby at the
same instant, which is the documented stall.

### SIM-03 · P1 · both — Former primary opens read-write after a failover

- **Repro:** `host.down dc1-prm01` at 0, `host.up dc1-prm01` at 100. Also: isolate the primary
  with `FastStartFailoverPmyShutdown` FALSE, heal at 100.
- **Page shows:** former primary lane `open-rw` from 100 s beside the new primary; protection
  level returns to MAXAVAILABILITY as if the new primary were shipping to it.
- **Oracle:** "To allow the master observer to automatically reinstate the former primary
  database, the database must be started and mounted. It will not be allowed to open in any event
  if fast-start failover is enabled." "ORA-16649: possible failover to another database prevents
  this database from being opened". (FSFO19, FSFO26.)
- **Where:** `sim/simulate.ts:1196-1207` (`memberStateOf`), `redo/resolve.ts` (edges to a member
  that needs reinstating).

### SIM-04 · P1 · both — Role changes succeed against members that are down or unreachable

| Repro | Page shows |
|---|---|
| standby host down at 0, `SWITCHOVER TO sby01` at 5 | switchover completes, `newPrimary = sby01`, zero loss; the sby01 lane stays `down` |
| `link.cut dc1-dc2` at 0, `SWITCHOVER TO sby01` at 5 | switchover completes |
| primary host down at 0, `SWITCHOVER TO sby01` at 5 | switchover completes |
| primary and standby hosts down, `FAILOVER TO sby01` at 5 | manual failover completes, loss 0 |

- **Where:** `sim/simulate.ts:456-534` (`runSwitchover`), `578-623` (`runManualFailover`) — no
  liveness or reachability check; `ui/break/events.ts:341-356` offers both commands whenever a
  primary exists.

### SIM-05 · P1 · 26ai (19c silent) — Failover to the second candidate when primary and first target die together

- **Repro:** the `multi-target-three-observers` preset's own events (`site.down dc2` +
  `host.down dc1-prm01` at 0); also `app/test/sim-scenarios.test.ts` "multi-target with a dead
  first candidate".
- **Page shows:** failover to `sby02` at 30 s.
- **Oracle 26ai:** "Data Guard Broker cannot failover to second fast-start failover target if both
  the primary and first fast-start failover targets are down." (FSFO26, *Restrictions When
  Fast-Start Failover is Enabled*.) Not on the 19c page.
- **Where:** `sim/fsfo.ts:279-303` (`selectTarget`), `presets/multi.ts:49-70`,
  `app/design/engine.md` §4 worked example. Labelled `model`, but under 26ai the model is
  contradicted.
- **Related:** first target down at 0, primary crash at 5 → failover to `sby02`. The target change
  while the primary is still alive is documented; how long it takes is not.

### SIM-06 · P2 · both — Manual failover always reports no data loss outside MaxPerformance

- **Repro:** no observer, `link.cut dc1-dc2` at 0, primary crash at 100, `FAILOVER TO sby01` at 120.
- **Page shows:** "Data loss: none".
- **Oracle:** "There may or may not be data loss depending upon whether your primary and target
  standby databases were synchronized at the time of the primary database failure." (FSFO19.)
- **Where:** `sim/simulate.ts:1373-1381`, `1417-1421`. In MaxPerformance the number is the apply
  lag, which is redo already received, not redo lost.

### SIM-07 · P2 · both — Manual failover with the primary still open raises nothing

- **Repro:** `FAILOVER TO sby01` at 5, nothing else (with and without an observer).
- **Page shows:** two members `open-rw` to the end of the run, no finding.
- **Oracle:** "Before beginning a failover, first determine that there is no possibility of
  recovering the primary database in a timely manner, and ensure that the primary database is shut
  down." With fast-start failover enabled: "You must ensure that the primary database is shut down
  prior to performing a manual failover." and "You cannot perform an immediate manual failover
  when fast-start failover is enabled." (FSFO19, CMD19.)
- **Where:** `sim/roles.ts:144-186` — three of the four documented conditions are checked, this
  one is not; `immediate` on `cmd.failover` is never read.

### SIM-08 · P2 · both — Any candidate accepted as the role-change target while fast-start failover is enabled

- **Repro:** multi-target document, `SWITCHOVER TO sby02` at 0 (active target is `sby01`).
- **Page shows:** switchover permitted.
- **Oracle:** "If fast-start failover is enabled, you may switch over only to the fast-start
  failover target standby database." "The failover can only be performed to the current target
  standby database." "Attempting to switch over to a standby that is not the fast-start failover
  target results in ORA-16655." (CMD19, FSFO19, HA19.)
- **Where:** `sim/simulate.ts:478, 596` (`view.candidates.includes(to)`).

### SIM-09 · P2 · both — Switchover across a far sync is refused (26ai) or called undocumented (19c)

- **Repro:** the `far-sync-role-change` preset's own switchover, under each edition.
- **Page shows:** 19c — `SWITCHOVER.TO_TERMINAL_UNDOC` "receives redo indirectly, through another
  standby"; 26ai — `SWITCHOVER.REFUSED`.
- **Oracle:** "If there is a far sync instance ... connecting the primary and standby databases,
  then the procedure to switchover to the standby is the same as described in this topic. Whether
  the far sync instances are available or unavailable does not affect switchover."
  (`S19/managing-oracle-data-guard-role-transitions.html`, same in 26.)
- **Where:** `sim/simulate.ts:487-489` (`directSyncFromPrimary` when the lag limit is the gate),
  `514-523` (depth ≥ 2 treats a far sync hop as a cascade).

### SIM-10 · P2 · both — Nothing is evaluated after the first role change

- **Repro:** `SWITCHOVER TO sby01` at 0, `host.down dc2-sby01` at 100. Or: crash, failover, new
  primary crash at 200, with Flashback on and a second candidate available.
- **Page shows:** the new primary goes `down` and stays there; outcome still reads `switchover` /
  `failover`.
- **Oracle:** "The reinstated database acts as the fast-start failover target for the new primary
  database, making a subsequent fast-start failover possible." (FSFO19.)
- **Where:** `sim/simulate.ts:823` (`state.phase === 'normal'`); the reinstate band never ends.
  Not stated anywhere on the page.

### SIM-11 · P2 · both — Instant resynchronization

- **Repro:** standby host down at 0, up at 50, primary crash at 60.
- **Page shows:** MAXAVAILABILITY again at 50 s, zero-loss failover at 90 s.
- **Oracle 19c:** "In maximum availability mode, the ability to automatically failover is restored
  once the target standby database has received all missing redo data."
- **Where:** `redo/resolve.ts:416-424`. Unlabelled.

### SIM-12 · P2 · both — Degraded MaxAvailability reported as MAXPERFORMANCE, labelled documented

- **Page shows:** level `MAXPERFORMANCE`, chip "so the broker reports this level"
  (`state/derived.ts:218-219`, `redo/resolve.ts:497-502`).
- **Oracle:** the sentence is "operates as if it were in maximum performance mode";
  `V$DATABASE.PROTECTION_LEVEL` lists `RESYNCHRONIZATION` as its own value
  (`.../19/refrn/V-DATABASE.html`). The type already has `RESYNCHRONIZATION`
  (`types/trace.ts:53`); nothing returns it.
- **Confidence:** medium — the reference lists the value without stating when it shows.

### SIM-13 · P2 · both — Far sync lost with the primary still gives documented zero loss

- **Repro:** far sync document, `site.down dc1` (primary and far sync share the site).
- **Page shows:** failover, loss 0, basis `documented`, cite `MAXAVAIL.AT_LEAST_ONE`.
- **Issue:** synchronized-across-a-far-sync is this page's model (`SYNC.ACROSS_FARSYNC`), and the
  onward leg is ASYNC. The zero carries a `documented` label it has not earned
  (`sim/simulate.ts:1422-1423`).

### SIM-14 · P3 — Smaller items

| # | Edition | Finding | Where | Oracle |
|---|---|---|---|---|
| a | both | Master nomination happens only when the master's host is down or stopped, never when the primary merely loses its connection to a live master | `sim/simulate.ts:998-1021` | "if the primary and target standby databases stay connected but the connection to the master observer is lost, then the broker tries to nominate a backup observer" |
| b | both | `SET MASTEROBSERVER` preconditions called undocumented; role moves at the instant of the command | `sim/simulate.ts:733`, `generate/dgmgrl.ts:604-608` | "the actual switch does not happen until the next time the primary contacts the target standby, usually within three seconds" + two listed conditions (CMD19). The citation note at `citations.ts:405` already says so |
| c | both | `BystandersFollowRoleChange`: ALL never disables a bystander that is ahead; NONE worded "left out of the new configuration" | `sim/roles.ts:127-131` | ALL: "If the bystander standbys are ahead, they will be disabled with a status of ORA-16661". NONE: "marked as disabled ... so that they can be evaluated later" |
| d | both | MaxProtection after a role change stays MAXPROTECTION | `sim/simulate.ts:419-431` | fast-start failover: "the new primary database is set to maximum availability to allow the instance to open"; manual: "If the protection mode was at maximum protection, it is reset to maximum performance" (26ai: maximum availability) |
| e | both | Crashed primary is `open-rw` the instant its host returns; `REINSTATE` draws a reinstating band with Flashback off and is offered for every database | `sim/simulate.ts:975`, `ui/break/events.ts:357-365` | reinstatement "requires Flashback Database to be enabled on both" |
| f | both | Observer chip shows the first observer in the list, captioned "the master's state is shown" | `state/derived.ts:312-320` | — |
| g | both | Timeline caption for every blocked switchover reads "outside FastStartFailoverLagLimit", including MaxAvailability | `ui/timeline/build.ts:822` | — |

---

## B. Edition gating

### ED-01 · P1 · 19c — `ObserverPingInterval` / `ObserverPingRetry` do not exist in 19c

- **Page:** offers both under 19c, simulates 1.1 s detection, emits
  `EDIT CONFIGURATION SET PROPERTY ObserverPingInterval`, and states "they exist since 12.2".
- **Docs:** zero occurrences in the 12.2, 18c and 19c property pages, fast-start failover chapter
  and command reference. First documented in 21c.
- **Live 19.27:** `strings` on `dgmgrl` and `oracle` finds neither name;
  `SHOW CONFIGURATION VERBOSE` lists no such property.
- **Where:** `engine/defaults.ts:124-130`, `engine/generate/dgmgrl.ts:339-347`,
  `ui/inspector/ConfigForm.tsx:329-360`, `content/reference/broker-properties.tsx:38,47`,
  `engine/sim/fsfo.ts:65-105`, plus the rule in `AGENTS.md`.

### ED-02 · P2 · 19c — Three "26ai-only" properties exist in 19.27

- **Live 19.27 `SHOW CONFIGURATION VERBOSE`:** `FastStartFailoverLagGraceTime = '0'`,
  `FastStartFailoverLagType = 'APPLY'`, `PrimaryDatabaseCandidates = ''`.
  `SHOW FAST_START FAILOVER` prints `Lag Type:` and `Lag Grace Time:`.
- **Docs:** absent from the 19c and 21c property pages; listed as new in the 26ai change list.
- **Page is inconsistent with itself:** the UI lets `LagType` / `LagGraceTime` be set under 19c
  (`ConfigForm.tsx:302-326`), the engine ignores them (`sim/fsfo.ts:35-39`,
  `sim/simulate.ts:1447-1455`) and the script omits them; `PrimaryDatabaseCandidates` is enforced
  and emitted under 19c as `documented` (`sim/simulate.ts:544-561`, `generate/dgmgrl.ts:257-269`).
- Depends on decision 1.

### ED-03 · P2 · 19c — Lag limit in MaxAvailability: the 19c documentation contradicts itself

- **19c chapter:** "For zero data loss in maximum availability mode, the
  FastStartFailoverLagLimit property must be set to zero." Example output
  `Protection Mode: MaxAvailability / Lag Limit: 0 seconds`.
- **19c property page:** default 30, minimum 5, "operating in maximum performance mode".
- **Live 19.27, MaxAvailability:** `Lag Limit: 30 seconds (not in use)`.
- **Page:** behaviour matches the live system, but states the 19c rule as `documented` with no
  conflict label, and the mock prints `(not evaluated in this mode)` where Oracle prints
  `(not in use)` (`generate/show.ts:292`, `generate/dgmgrl.ts:379-383`).
- **Attribution:** the MaxAvailability role arrived in **21c**, not 26ai (21c change list and 21c
  chapter carry it); only the per-mode default of 0 is 26ai. Same for far sync with fast-start
  failover in MaxPerformance (21c new feature). `defaults.ts:174`, `citations.ts:93`,
  `content/reference/changes-26ai.tsx:31-53`.

### ED-04 · P2 · 26ai — `MAX_FAILURE` was rewritten in 26ai

- **26ai:** "If MAX_FAILURE is set to 1, no attempts are made to reactivate this archive
  destination when it fails. If MAX_FAILURE > 1, reactivation attempts are made until the number
  of consecutive failures is equal to the value of MAX_FAILURE. ... If MAX_FAILURE is 0,
  reactivation attempts are continuous." Also new: "All archive destinations in the group must
  have MAX_FAILURE attribute set to a non-zero value." and higher-priority alternates "are checked
  for reactivation at regular intervals" regardless of `REOPEN`.
  (`S26/LOG_ARCHIVE_DEST_n-parameter-attributes.html`.)
- **Page:** uses the 19c reading in both editions — the initial failure is not counted, disable at
  `MaxFailure × ReopenSecs`, "until it is manually reenabled".
- **Where:** `sim/dests.ts:87-107`, `models/reopen.ts:12-14, 182-204`,
  `ui/panels/Reopen.tsx:138, 401`, `ui/inspector/MemberForm.tsx:340`,
  `generate/initora.ts:128-131`, `content/lessons/transport-layer.tsx:157`.
- **Both editions:** the broker default for `MaxFailure` is 1 for a member inside a RedoRoutes
  group, 0 otherwise (PROP19, `B26/maxfailure.html`). The page uses 0 everywhere, so
  `ROUTES.GROUP_NEEDS_MAXFAILURE` fires on an untouched group (`validate/rules/routes.ts:110-130`).

### ED-05 · P2 — `PreferredObserverHosts`

| Finding | Where | Oracle |
|---|---|---|
| Greyed under 19c as "a later edition" | `ui/inspector/ConfigForm.tsx:408-453`, `ui/inspector/why.ts:37-38` | on the 12.2, 18c and 19c property pages; present in 19.27 binaries |
| Emitted with `EDIT CONFIGURATION` | `generate/dgmgrl.ts:473-484` | "Scope: Database"; 26ai example uses `EDIT DATABASE North_Sales SET PROPERTY PreferredObserverHosts=...` |
| "until the next role change" applied to 26ai | `validate/rules/observers.ts:131`, `citations.ts:420` | 26ai: "The master observer will be changed automatically to an observer running on a higher priority host." |

### ED-06 · P3 · 26ai — Differences the page does not carry

| Item | Oracle 26ai | Where on the page |
|---|---|---|
| `V$DATABASE.FS_FAILOVER_*` | "deprecated. Instead, use the corresponding columns in V$FAST_START_FAILOVER_CONFIG" | `generate/show.ts:212,336`, `generate/dgmgrl.ts:280`, lessons, `app/public/collectors/dataguard-topology.sql:20-23` |
| `SWITCHOVER ... WAIT` | "deprecated in 26ai. Use the DrainTimeout configuration property" | — |
| `SHOW FAST_START FAILOVER` | adds `Ping Interval:` and `Ping Retry:` lines | `generate/show.ts:254-311` |
| `DEFAULT_SDU_SIZE` | "For clients: 8192 bytes ... For servers: 65536 bytes" | `content/lessons/sync-transport.tsx:39,51,107` |
| JDBC thin `RETRY_DELAY` | "Starting from ... 26ai, the default value of this parameter is 1 second" | `generate/jdbc.ts:57` omits it when 0 |
| Far sync acknowledgement in MaxAvailability | "at least one synchronized standby database or far sync instance" | `redo/resolve.ts:466-473` labels it `inferred` |
| Observe-only | three extra sentences on manual failover without acknowledgement | `presets/classic.ts:82-87` applies the enabled-mode conditions instead |

### ED-07 · P3 — Release attributions

| Claim on the page | Oracle |
|---|---|
| Observer count: "which release moved three to four is unsettled" (`defaults.ts:147`, `validate/rules/observers.ts:25-36`) | ORA-16647 help: "For Oracle Database releases 12.2 through 19c, a maximum of three ... 21c and later, a maximum of 4". 19c also contradicts itself — `START OBSERVER` in CMD19 says "up to four" — and that conflict is not labelled |
| `VALIDATE FAST_START FAILOVER` new in 26ai (`changes-26ai.tsx:91-107`) | documented in the 19c command reference; a 21c feature |
| `V$DG_BROKER_PROPERTY`, observer `LOG_FILE`/`STATE_FILE` new in 26ai (`changes-26ai.tsx:143-151`) | "available starting with Oracle Database 21c" |
| ORDS endpoints "ship in 23.3" (`changes-26ai.tsx:188-190`) | same page exists from ORDS 21.1 |
| 253 members "documented in 12.1 only" (`validate/rules/members.ts:48-59`, `citations.ts:728`) | sentence is on the 19c and 26ai *Managing Broker Configurations* pages |
| Broker default protection mode MAXAVAILABILITY (`engine/defaults.ts:150`) | "The default protection mode for the configuration is MAXPERFORMANCE." |

---

## C. RedoRoutes and validation

### VAL-01 · P1 · both — `PRIORITY` is modelled the wrong way round

- **Oracle grammar:** `( db_unique_name_1 [xpt_mode] [PRIORITY=n] [,db_unique_name_n [xpt_mode] [PRIORITY=n]] )`
  — priority belongs to a destination inside one group. "The general rule is that there is one
  active redo path for each group." "If both FS1 and FS2 are available, then the primary ships to
  FS1 and FS2." "If a primary ships redo to a destination with PRIORITY=8, then it must ship to
  every PRIORITY=8 destination." Same priority is sticky: "Even after FS1 becomes active again,
  the primary continues shipping to FS2". (PROP19 *Redo Routing Rules*, Examples 1–4;
  `B26/redo-routing-rules.html`, identical.)
- **Page:** priority belongs to a group, exactly one group is active, every destination in it
  ships. The parser keeps only the last `PRIORITY=n` inside a parenthesis, so
  `(local : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ))` re-formats as `(LOCAL : (FS1, SB1 PRIORITY=2))`.
  The default priority is taken from the **sender**, not the destination. The activation rule is
  labelled `model` — "not documented" — while Examples 1–4 document it.
- **Consequence:** the strings generated for `far-sync-ha-pair` and `priority-alternates` —
  `(LOCAL : (FS1 SYNC PRIORITY=1), (FS2 SYNC PRIORITY=2))` — are two groups, so a real broker
  ships to both at once. The drawing, the SHOW mock's `(alternate of ...)` and the init.ora block
  all say otherwise.
- **Where:** `redo/resolve.ts:39, 138-181, 317-349`, `redo/parse.ts:10-11, 156-181, 306-310`,
  `types/topology.ts:76-82`, `presets/farsync.ts`, `presets/cascade.ts:126-145`,
  `app/test/__golden__/priority-4-3.txt`.

### VAL-02 · P2 · 19c — `XPT.TABLE_4_2` fires per destination

- **Page:** an error for every ASYNC destination in MaxAvailability (19c) and every non-SYNC one
  in MaxProtection. One SYNC and one ASYNC standby → error on the ASYNC bystander. The
  `bystanders` preset text calls this "a mode conflict under 19c". The commit panel's
  `modeConflict` has the same logic (`models/commit.ts:207-212`).
- **Oracle:** "the broker verifies that there is at least one standby database in the
  configuration that can support the desired grade of protection." (MEM19.) The per-member list in
  the fast-start failover prerequisites covers the target and the primary only.
- **Also:** `validate/catalogue.ts:83` says 26ai Table 4-2 lists ASYNC. It does not; ASYNC is in
  the 26ai prerequisites only. 26ai Table 4-2 and the 26ai `LogXptMode` page still say
  SYNC/FASTSYNC — a conflict the page does not name.
- **Where:** `validate/rules/modes.ts:74-129`, `presets/multi.ts:144-183`.

### VAL-03 · P2 · 19c and 26ai — `ALT=( ... FALLBACK)` is 12.1 grammar only

- Absent from the 12.2, 19c and 26ai pages. The page warns under 26ai only
  (`validate/rules/routes.ts:133-150`); the `far-sync-zero-loss` preset generates
  `(LOCAL : FS1 SYNC ALT=(South_Sales ASYNC FALLBACK))` under both editions.
- `sim/dests.ts:143` says what FALLBACK does "is not stated on any page". The 12.1 page the
  citation points at states it: "The optional FALLBACK keyword is used to specify that redo
  transport to the non-alternate member should be resumed if it becomes available. ... If you omit
  it and the ALTERNATE redo destination subsequently fails, no redo will be shipped to the
  terminal standby databases serviced by the alternate destination."

### VAL-04 · P2 · both — Rules with the wrong condition

| Rule | Page | Oracle | Where |
|---|---|---|---|
| `ALL` expansion | excludes snapshot standbys; a primary with only a snapshot standby has no edges | "Like a physical or logical standby database, a snapshot standby database receives and archives redo data from a primary database." | `redo/resolve.ts:76-81`, `validate/context.ts:200-203` |
| `ROUTES.SNAPSHOT_FORBIDDEN` | any RedoRoutes on a snapshot standby is an error | only forwarding is restricted: "cannot be configured such that ... the snapshot standby would send redo data to another member" | `validate/rules/routes.ts:58-69` |
| `FSFO.MULTI_TARGET_EXPLICIT`, `FSFO.TARGET_DIRECT_REDO`, `FSFO.LOGICAL_MAXPROT` | fire with fast-start failover disabled | all three are conditions of *enabling* it | `validate/rules/fsfo.ts:83, 107-115, 178` |
| `OBS.NONE_DEPLOYED` | enabled with no observer "cannot both be true"; status read as DISABLED | "If you do not start the observer after you have enabled fast-start failover, the ORA-16819 warning is displayed" | `validate/rules/observers.ts:96-107`, `sim/simulate.ts:1045`, `content/lessons/failover-clocks.tsx:252-254` |
| `ROUTES.SOURCE_UNIQUE` | `(LOCAL : ...)(PRI : ...)` at PRI passes | "either explicitly or implicitly through use of the LOCAL keyword" | `validate/rules/routes.ts:17-41` |
| `FSFO.FARSYNC_MODE_19C` | any far sync in the configuration triggers it, even one feeding a bystander | scoped to a far sync used "to send redo data to the target standby" | `validate/rules/fsfo.ts:155-175` |
| `EDIT.FSFO_ENABLED_BLOCKS` | any change to `FastStartFailoverTarget` refused | "unless the new property value contains the current fast-start failover target" | `validate/rules/dests.ts:127-135` |
| `ANY` source | inactive at the primary, labelled undocumented | "The ANY keyword is an alias for any database in the configuration." | `redo/resolve.ts:53-57` |

### VAL-05 · P3 · both — Severity and basis

| Rule | Issue |
|---|---|
| `OBS.ON_DB_HOST`, `RAC.OBSERVER_ON_CLUSTER` | `error`; Oracle's sentence opens "As a best practice" and documents no refusal |
| `OBS.PRIMARY_SITE` | message "defensible only where the application tier is local to the primary" is the reverse of the guide's caveat |
| `ROUTES.LOGICAL_LOCAL_ONLY` | `conflict`; the sentence is plain in 19c and 26ai, and the restriction is on the **source** field (the `bystanders` preset says "destination") |
| `ROUTES.GROUP_NEEDS_MAXFAILURE` | `doc-later` while drawing 26ai, where the sentence is primary |
| `ROUTES.ALT_NEEDS_MAXFAILURE` | `documented` in both editions, resting on 12.1 only; the suggested fix names a parameter on the sender, Oracle names the `MaxFailure` property of the non-alternate member |
| `FSFO.LAGLIMIT_VS_THRESHOLD` | fires under 19c; the recommendation exists on the 26ai pages only |

### VAL-06 · P2 — Presets that Oracle would not accept as drawn

| Preset | 19c | 26ai | Why |
|---|---|---|---|
| classic, observe-only, cascade-terminal, priority-alternates, multi-target-three-observers, rac-primary, bystanders | no | yes | primary's own `LogXptMode` is ASYNC (`presets/build.ts:78`) with no reverse route. 19c Task 3: "set the LogXptMode database property for both the primary and target standby databases to SYNC or FASTSYNC". Oracle's own example of this shape ends "Switchover to this standby is not possible since there are no other standbys that can support the protection mode". The page's "Switch over" scenario succeeds |
| max-protection | no | no | same, and "Maximum protection — SYNC" holds in both; the script also jumps straight to MAXPROTECTION (GEN-03) |
| far-sync-zero-loss, far-sync-ha-pair, far-sync-role-change, every MaxAvailability preset | — | labelled wrong | `FastStartFailoverLagLimit` is 30, so under 26ai these are `POTENTIAL DATA LOSS`, not zero loss (26ai default for the mode is 0) |
| far-sync-zero-loss | grammar | grammar | VAL-03 |
| far-sync-ha-pair, priority-alternates | behaviour | behaviour | VAL-01 |

### VAL-07 — Rules Oracle documents that the page does not check

1. Fast-start failover enabled with Flashback Database off → ORA-16827 warning (independent of auto-reinstate).
2. Fast-start failover enabled, no observer running → ORA-16819.
3. A snapshot standby needs Flashback Database; it "cannot be the target of a switchover or fast-start failover operation" (manual failover is allowed).
4. "Switchover to a logical standby database is disallowed when the configuration is operating in maximum protection mode."
5. Observer names unique; `NONAME` reserved.
6. "Upgrading from MAXPERFORMANCE to MAXPROTECTION is not allowed."
7. Far sync with fast-start failover: `FastStartFailoverTarget` "must first be set on both the primary and target standby database" (Scenario 7).

---

## D. Generated text (`engine/generate/*`)

### Would fail or mislead if run

| ID | Sev | Emitted | Oracle | Where |
|---|---|---|---|---|
| GEN-01 | P2 | `START OBSERVER obs01 FILE IS ... LOGFILE IS ... IN BACKGROUND;` with no connect identifier (every preset) | `START OBSERVER [observer-name] IN BACKGROUND CONNECT IDENTIFIER IS connect-identifier [FILE IS ...]` — the identifier is not optional, and a wallet is required | `generate/dgmgrl.ts:570-576`, `presets/build.ts:111-123` |
| GEN-02 | P3 | `IN BACKGROUND` placed last | documented directly after the name; only the *optional* clauses are interchangeable | `generate/dgmgrl.ts:575`, all five goldens |
| GEN-03 | P2 | `EDIT CONFIGURATION SET PROTECTION MODE AS MAXPROTECTION;` on a new configuration | "You must first go to MAXAVAILABILITY and then to MAXPROTECTION." | `generate/dgmgrl.ts:237-241` |
| GEN-04 | P2 | parenthesised commentary lines inside `configure.dgmgrl`; code says "DGMGRL has no comment syntax" | "Comment lines are permitted in the script, but they must be terminated with a semi-colon ... REM Hello World; -- Hello Again!;" | `generate/lines.ts:127-147`, `generate/dgmgrl.ts:9-10` |
| GEN-05 | P2 | `FAILOVER TO 'sby01';` at the end of the build script when no observer is deployed | destructive, and must be issued connected to the standby | `generate/dgmgrl.ts:283-291` |
| GEN-06 | P2 | `ReopenSecs` / `MaxFailure` never set as broker properties; non-default values appear only in the hand-written init.ora block | the broker owns `LOG_ARCHIVE_DEST_n`: "The properties used are: Binding, MaxFailure, NetTimeout, RedoCompression, and ReopenSecs." | `generate/dgmgrl.ts:221-224`, `generate/initora.ts:159-161` |
| GEN-07 | P2 | `ALTERNATE=LOG_ARCHIVE_DEST_3` on the main destination only | needs `LOG_ARCHIVE_DEST_STATE_n=ALTERNATE`; and for `SERVICE=` destinations `ALTERNATE` "is maintained only for backwards compatibility" | `generate/initora.ts:265-294` |
| GEN-08 | P2 | see ED-01 (ping properties under 19c), ED-05 (`PreferredObserverHosts` scope), VAL-01, VAL-03 | | |

### SHOW mocks compared with a live 19.27 configuration

Live output, MaxAvailability, one target, one observer:

```
Fast-Start Failover: Enabled in Zero Data Loss Mode
  Lag Limit:          30 seconds (not in use)
  Lag Type:           APPLY
  Threshold:          30 seconds
  Active Target:      cdb1_stby
  Potential Targets:  "cdb1_stby"
    cdb1_stby  valid
  Observer:           dg_observer
  Shutdown Primary:   TRUE
  Auto-reinstate:     TRUE
  Observer Reconnect: (none)
  Observer Override:  FALSE
  Lag Grace Time:     0 seconds
```

`SHOW CONFIGURATION VERBOSE` marks the target `cdb1_stby - (*) Physical standby database` with the
legend `(*) Fast-Start Failover target`.

| ID | Mock prints | Should read | Where |
|---|---|---|---|
| GEN-09 | `Fast-Start Failover:  Enabled` / `ENABLED` | `Enabled in Zero Data Loss Mode` / `Enabled in Potential Data Loss Mode` / `Enabled in Observe-Only Mode` | `generate/show.ts:196-207, 241-250` |
| GEN-10 | `(not evaluated in this mode)` | `(not in use)` | `generate/show.ts:292` |
| GEN-11 | no `Potential Targets` for a single target; no `Observer Reconnect`; no `Configurable Failover Conditions` block; lines reordered | as above | `generate/show.ts:254-311` |
| GEN-12 | no `(*)` target marker; unreached members drawn under the primary | `(*) Fast-Start Failover target`; section `Members Not Receiving Redo:` | `generate/show.ts:154-193` |
| GEN-13 | far sync line and observe-only status labelled `(model)` | both are documented: `FS - Far sync instance`, `Enabled in Observe-Only Mode` | `generate/show.ts:180-186, 241` |

---

## E. Prose, citations, labels (P3 unless noted)

| ID | Finding | Where |
|---|---|---|
| TXT-01 | "aborts itself" / "SHUTDOWN ABORT" for the stalled primary and for MaxProtection. Oracle says only "will shut down" | `content/lessons/failover-clocks.tsx:112,216,241`, `content/reference/broker-properties.tsx:124`, `ui/break/events.ts:232-233` |
| TXT-02 | `PRIMARY UNOBSERVED` attached to a step whose event kills the observer host. The status needs the standby to still have "connectivity to the observer" | `content/lessons/failover-clocks.tsx:174-178` |
| TXT-03 | "What a commit with more than one SYNC destination waits for is not documented". `DATA_GUARD_SYNC_LATENCY`: default 0 "means that the LGWR will wait up to ... NET_TIMEOUT ... for each SYNC standby destination" | `models/commit.ts:130-138`, `ui/panels/Commit.tsx:385` |
| TXT-04 | "65535 is ... nor the ceiling" against the HA guide's "its maximum value of 65535"; Oracle contradicts itself, the page states one side | `content/lessons/sync-transport.tsx:49-51` |
| TXT-05 | "Sessions on the primary are terminated when it converts" and "the documentation is explicit that the new primary ... does not wait for the old one" — neither sentence found; Oracle's step list restarts the former primary *before* opening the new one | `content/lessons/failover-clocks.tsx:163-166`, `ui/panels/AppView.tsx:246,510` |
| TXT-06 | Ping arithmetic `interval × (retry + 1)` = 1.1 s. 21c/26ai: "Set both these properties to achieve a primary failure detection time of 1 second", i.e. 100 ms × 10. The timeline brace carries no model label | `content/footnotes.tsx:31`, `ui/timeline/build.ts:745-746` |
| TXT-07 | `ConfigurationWideServiceName` shown "not set", "a later edition documents it". Default is `primarydbname_CFG` in 12.2, 18c, 19c, 26ai (live 19.27: `cdb1_CFG`) | `ui/inspector/ConfigForm.tsx:115-126` |
| TXT-08 | `NetTimeout` "minimum 1 s" under the broker property's name; the property is "0 to 1200", the attribute "1 to 1200" | `ui/inspector/MemberForm.tsx:318` |
| TXT-09 | `REINSTATE <name>`; Oracle: `REINSTATE DATABASE database-name;` | `ui/break/events.ts:358` |
| TXT-10 | Citations labelled 19c whose text is the 26ai tab of the error page | `citations.ts` `ORA.12514`, `ORA.16654`, `ORA.16658` |
| TXT-11 | 26ai-page citations used for 19c behaviour | `sim/fsfo.ts:153-157`, `sim/simulate.ts:1414,1474`, `generate/dgmgrl.ts:402` |
| TXT-12 | `OBS.OBSERVER_ORA` cited for `ObserverReconnect` | `generate/dgmgrl.ts:468-469` |
| TXT-13 | Quotes spliced from code blocks without elision or `paraphrase` | `citations.ts` `FS.ROUTES_BOTH_DIRECTIONS`, `ROUTES.CANONICAL_PAIR` |

---

## F. Checked and found correct

- **Defaults and ranges, both editions:** `FastStartFailoverThreshold` 30/6,
  `FastStartFailoverLagLimit` 30/5 (and 26ai's 0 in MaxAvailability), `PmyShutdown` TRUE,
  `AutoReinstate` TRUE, `ObserverOverride` FALSE, `ObserverReconnect` 0,
  `BystandersFollowRoleChange` ALL, `LogXptMode` ASYNC, `NET_TIMEOUT` 30 / 1–1200 / 8–10 s advice,
  `REOPEN` 300, `TransportDisconnectedThreshold` 30.
- **Threshold semantics.** `max(observer lost, target lost) + threshold` matches "if the standby
  has had contact from the primary within the period of time specified by the
  FastStartFailoverThreshold property, the standby prevents the failover attempt."
- **The 24-cell matrix.** All cells agree with the documented stall and failover conditions.
- **Observer loss alone stalls nothing; observe-only never fails over; `ObserverOverride` FALSE
  is stated wherever a cell depends on it.**
- **Far sync, cascading and multi-observer lessons:** 69 claims, 67 verbatim in both editions.
- **Commit path** (thirteen steps, max not sum), AFFIRM/NOAFFIRM, wait events, the AWR example.
- **Client parameters:** `TRANSPORT_CONNECT_TIMEOUT` 60 s in both editions, no default for
  `CONNECT_TIMEOUT`, JDBC thin 0 (19c) and 20 s from 23.6.
- **DGMGRL:** `CREATE CONFIGURATION`, `ADD DATABASE`, `ADD FAR_SYNC`, `EDIT ... SET PROPERTY`,
  `ENABLE FAST_START FAILOVER [OBSERVE ONLY]`, `SET MASTEROBSERVER TO`; property levels other
  than `PreferredObserverHosts`.
- **`LOG_ARCHIVE_DEST_n`** spellings, SYNC/AFFIRM mapping, `VALID_FOR`, 1–31 range.
- **Collector SQL:** every view and column exists in 19c and 26ai.
- **Citations:** 130 entries checked; every URL returns 200 and every non-paraphrase quote is on
  its page apart from TXT-13.

## G. Not verified

- No 26ai database: 26ai runtime behaviour is documentation only.
- Whether DGMGRL rejects GEN-02, the `ALT=` form, or `EDIT CONFIGURATION` for
  `PreferredObserverHosts` — the documentation gives the form, not the error.
- SIM-12's condition for `RESYNCHRONIZATION`.
- The `PrimaryDatabaseCandidates` 19.26 backport is not in any Oracle document; the property is
  present in 19.27.
- `changes-26ai.tsx` rows sourced from blogs (multiple ASYNC connections, role-transition speed).
- oratcptest `-length`, `-write`, `-file` (MOS note, behind login).

## H. What a fix touches beyond the code

`AGENTS.md` and `app/design/facts.md` state several of the facts above as verified rules
(ping properties "since 12.2", 253 members "12.1 only", lag limit "MaxPerformance only under 19c",
the PRIORITY reading, "first viable target"). `app/test/sim-scenarios.test.ts`,
`app/test/presets.test.ts`, `app/src/engine/__tests__/resolve.test.ts:174` and the five goldens in
`app/test/__golden__/` pin the current behaviour for SIM-05, VAL-01, VAL-04 and GEN-01/02.

Each fix should turn its probe from `OPEN` to `CHANGED` and add its own regression test to the
ordinary suite; the probe stays, so the next review can see the finding was looked at again.
