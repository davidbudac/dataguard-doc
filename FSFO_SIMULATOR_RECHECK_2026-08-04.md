# FSFO simulator fact recheck - 2026-08-04

## Scope and method

I rechecked the English source in **simulator/fsfo-simulator.html** at commit
**53d1368**, including visible prose, edition variants, generated configuration,
the four executable model blocks, and their tests. I used the 2026-08-01 report
as the regression checklist and treated Oracle documentation as normative. Where
Oracle's own 26ai pages disagree, this report identifies the contradiction.

**Test result:** node --test site/test.mjs passes: **66 passed, 0 failed**.
That establishes internal consistency only; one passing test currently asserts a
stale 19c rule.

## Bottom line

The earlier critical comments were largely addressed. I found **three remaining
executable-model defects**, several factual/generated-output problems, and a
small set of precision issues.

Highest priority:

1. 26ai **MaxAvailability + ASYNC** is described as valid in the reference
   section but rejected by the commit model and generated configuration.
2. **FastStartFailoverLagType = TRANSPORT** does not change the lag used by the
   readiness model.
3. The reopen model draws a **FastStartFailoverLagGraceTime** stall even when no
   observer is deployed and FSFO is disabled.

## Previous report: resolution status

The following 2026-08-01 findings are now addressed:

- 26ai bounded-loss MaxAvailability and the LagLimit edition switch.
- PrimaryDatabaseCandidates as an FSFO-disabled role-transition fence.
- Removal of the unsupported "both database sites" observer topology.
- Primary-versus-target PRIMARY UNOBSERVED status and no-observer DISABLED.
- The ObserverOverride = FALSE assumption.
- Conditional manual failover while FSFO is enabled.
- The narrower FastStartFailoverAutoReinstate conditions.
- Observer-ping arithmetic labeled as the simulator's model.
- TAF versus Application Continuity.
- NET_TIMEOUT and VALIDATE FAST_START FAILOVER wording.
- The primary-only caveat for V$FS_FAILOVER_OBSERVERS.

The old lower-severity MaxFailure default qualification remains (finding 14).

## Remaining and new findings

### 1. P0 - 26ai MaxAvailability with ASYNC is rejected by executable output

The 26ai reference correctly says Oracle permits ASYNC for a MaxAvailability
FSFO target (**html:2156-2158**, 26ai variant near **:2346-2347**). The
executable parts disagree:

- computeCommit() sets modeConflict for every ASYNC + MaxAvailability, with no
  edition or lag-policy input (**:3175**).
- Generated DGMGRL output calls the pairing a mismatch (**:5870-5873**).
- The UI calls it "drawn, not configurable" (**:6465-6468, :6508-6516**).
- **site/test.mjs:697-702** locks in the stale 19c rule.

Oracle 26ai's prerequisite table lists SYNC, FASTSYNC, or ASYNC for
MaxAvailability. The same chapter's later Task 3 still contains older wording,
an Oracle documentation contradiction already acknowledged by the simulator.
Under the simulator's documented choice to follow the prerequisite/protection
mode sections, the model, generator, and tests must become edition-aware.

Source: [Oracle 26ai FSFO protection modes and prerequisites](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html).

### 2. P0 - LagType = TRANSPORT is a label-only control

The page correctly explains that FastStartFailoverLagType selects apply lag or
transport lag (**:2159-2161, :2217-2218**). The model explicitly only echoes the
choice because it has no second lag quantity (**:2669-2672**) and always gates on
the apply-lag slider (**:973-980, :2892-2896**). The blocked banner also always
reports apply lag (**:4856-4860**). The test at **site/test.mjs:494-510** checks
only the echoed string.

This gives a wrong readiness decision when transport lag is within the limit but
apply lag is not. Add transport lag as a modeled quantity, or make TRANSPORT
non-interactive and explicitly say its behavior is not modeled.

Source: [Oracle 26ai FastStartFailoverLagType](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlagtype.html).

### 3. P0 - LagGraceTime stall is drawn with no observer / FSFO disabled

computeReopen() has no observer or FSFO-enabled input; its caller passes no such
state (**:7329-7332**). It therefore computes FSFO disarm/rearm state even for a
topology in which FSFO was never enabled. The readout masks the main disarm chip
with a separate global-state check (**:6862-6875**), but in 26ai MaxPerformance
the model still creates lagStallAt or lagGraceArmed only from edition, mode, and
grace value (**:3248-3266**). The renderer draws the wait/permission brace and chips
(**:6611-6627, :6877-6884**) even with "no observer". The prose can first say
FSFO is disabled and then append the stall claim (**:6900-6908**). No test
combines no-observer with LagGraceTime.

Oracle defines this property only when FSFO is enabled in maximum performance
mode. Pass effective FSFO-enabled state into the reopen model and make the two
LagGrace outputs inert when no observer is deployed.

Source: [Oracle 26ai FastStartFailoverLagGraceTime](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlaggracetime.html).

### 4. P1 - LagLimit/Threshold split-brain risk is omitted

The controls allow LagLimit to exceed Threshold (**:940, :988**) without a
warning. The isolation copy nevertheless says "at most one database ends up
open" (**:4877-4878**).

Oracle recommends LagLimit <= Threshold. It warns that with a greater LagLimit,
the old primary can keep committing after FSFO starts, risking two primaries for
a short period. The currently possible 6-second Threshold / 90-second LagLimit
state invalidates the unconditional claim.

Source: [Oracle 26ai FastStartFailoverLagLimit](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlaglimit.html).

### 5. P1 - generated JDBC Thin URL does not preserve the modeled timeout

The TNS generator omits TRANSPORT_CONNECT_TIMEOUT at 60 seconds because that is
the Oracle Net default (**:5764-5788**). The JDBC Thin generator reuses the same
omission rule (**:5798-5803**) and calls its output the same descriptor. At the
UI default, the model/test assumes a 60-second wait
(**site/test.mjs:551-555**), but the generated JDBC URL has no timeout.

Oracle JDBC 19c documents the Thin default as 0 (no timeout); current JDBC docs
say the default changed in 23.6 to 20 seconds. Emit the selected timeout
explicitly in the JDBC form, preferably with "sec". The comment at **:5820** is
also misleading: a bare URL value is seconds; 18.1 added optional suffixes.

Sources: [Oracle JDBC 19c OracleConnection](https://docs.oracle.com/en/database/oracle/oracle-database/19/jajdb/oracle/jdbc/OracleConnection.html),
[current Oracle JDBC OracleConnection](https://docs.oracle.com/cd/G47991_01/jajdb/oracle/jdbc/OracleConnection.html).

### 6. P1 - 26ai ObserverPing defaults are stated despite an Oracle contradiction

The edition caption says the ping defaults are unchanged (**:2192**), and the
table always shows 100 ms / 10 (**:2209-2212**). The dedicated 26ai property
pages instead give broker defaults of **0 ms / 0**, while retaining minimum
explicitly-set values of 100 ms / 10.

Oracle's 26ai FSFO chapter still contains the old 100/10 defaults. This is an
upstream documentation contradiction, not a settled product fact. The simulator
should not say "identical" without qualification. Displaying 0/0 for 26ai with a
footnote about the stale chapter table is the safer reading. The UI's explicit
"not set" switch and 100/10 input minimums remain sensible.

Sources: [ObserverPingInterval](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/observerpinginterval.html),
[ObserverPingRetry](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/observerpingretry.html),
[26ai FSFO chapter](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html).

### 7. P1 - V$FAST_START_FAILOVER_CONFIG is not queryable on any member

The page says "queryable on any member" (**:2168-2170**). Oracle's Data Guard
view applicability table marks it **Primary** and says to query it on the
primary.

Source: [Oracle 26ai Data Guard views](https://docs.oracle.com/en/database/oracle/oracle-database/26/sbydb/oracle-data-guard-in-oracle-database-views.html).

### 8. P1 - one ASYNC commit's wire window is not the failover loss bound

The commit caption says the interval until that commit reaches the standby
"bounds the data loss of a MaxPerformance failover" (**:6521-6523**). It only
illustrates that one commit's immediate exposure. Under sustained ASYNC load,
redo can backlog beyond one round trip. The configuration-wide FSFO guarantee is
governed by FastStartFailoverLagLimit/readiness.

Sources: [Oracle 19c redo transport tuning](https://docs.oracle.com/en/database/oracle/oracle-database/19/haovw/redo-transport-troubleshooting-and-tuning.html),
[Oracle 19c broker role transitions](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html).

### 9. P1 - sequence diagram reverses Oracle's documented decision order

The sequence draws the observer-to-standby readiness exchange at
**:1213-1217**, then threshold expiry at **:1219-1220**. Oracle's described FSFO
flow is: try to reconnect for the threshold, verify the target is ready, then
initiate failover.

Reorder those messages, or explicitly label the early readiness exchange as
continuous/background monitoring rather than the documented failover decision
sequence.

Sources: [Oracle 19c broker role transitions](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html),
[Oracle 26ai FSFO](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html).

### 10. P1 - observer-lost "manual failover" is underqualified

The observer-lost caption says "the failover would be manual" (**:4736,
:4742-4743**). Here FSFO is still enabled but unobserved. Oracle's manual
failover conditions require the observer to be started and communicating with
the target. In this state the operator must first use DISABLE FAST_START
FAILOVER FORCE.

Sources: [Oracle ORA-16658](https://docs.oracle.com/en/error-help/db/ora-16658/),
[Oracle 19c broker role transitions](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html).

### 11. P2 - LagGraceTime names only the observer as permission giver

The 26ai change table says the primary asks "the observer's permission"
(**:2162-2164**). Oracle says the request may be granted by the observer **or
the target standby**.

Source: [Oracle 26ai FastStartFailoverLagGraceTime](https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/faststartfailoverlaggracetime.html).

### 12. P2 - 19c backup-observer wording is too deterministic

The 19c copy says the broker "promotes a backup on its own" (**:1147, :2317,
:2379, :4735**). Oracle says it **tries to nominate** a backup when the primary
and target remain connected. Nomination can fail; FSFO stays unavailable until
a new master observes.

Source: [Oracle 19c observer behavior](https://docs.oracle.com/en/database/oracle/oracle-database/19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html).

### 13. P2 - connect-time model assumes one IP per HOST

The prose/model charge one timeout per ADDRESS/host (**:1492, :1585-1590,
:1616-1619, :3062-3065**). Oracle applies these timeouts to each ADDRESS and each
IP address to which its host resolves. State the single-IP assumption or model
DNS-address multiplicity.

Source: [current Oracle JDBC timeout semantics](https://docs.oracle.com/cd/G47991_01/jajdb/oracle/jdbc/OracleConnection.html).

### 14. P2 - MaxFailure default still needs its group qualification

The page says "default 0 means unlimited" (**:1457-1459, :2252-2253**). Oracle
documents 0 for destinations in the default log-archive destination group, but 1
for non-default groups. The ordinary LOG_ARCHIVE_DEST_2 example can keep 0 if
that scope is made explicit.

Source: [Oracle 19c LOG_ARCHIVE_DEST_n attributes](https://docs.oracle.com/en/database/oracle/oracle-database/19/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html).

### 15. P2 - two visibility/tooling descriptions overstate their APIs

- V$DG_BROKER_PROPERTY is said to list "every broker property and value"
  (**:2174-2175**). For monitorable properties, VALUE contains the literal
  "(monitorable)", not the runtime value.
- "SQLcl speaks the broker commands" (**:2180-2182**) sounds like full DGMGRL
  parity. Oracle documents a supported subset. Safer: "SQLcl supports a
  documented subset of broker commands; ORDS exposes Data Guard management
  endpoints."

Sources: [V$DG_BROKER_PROPERTY](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/V-DG-BROKER-PROPERTY.html),
[SQLcl Data Guard commands](https://docs.oracle.com/en/database/oracle/sql-developer-command-line/25.3/sqcug/dg-data-guard.html),
[ORDS Data Guard API](https://docs.oracle.com/en/database/oracle/oracle-rest-data-services/23.3/orrst/api-data-guard.html).

## Attribution-only claims

The 26ai claims about generally faster role transitions, multiple ASYNC
connections, and DGMGRL JSON output are supported mainly by linked Data Guard
product-manager/practitioner posts (**:2179-2188, :2373-2376**). I did not find
primary Oracle manual text establishing every detail. They are not disproved and
are attributed, but should not be presented as independently documented Oracle
guarantees.

## Recommended repair order

1. Fix the three executable model defects and add edition/no-observer/lag-type
   regression tests.
2. Add the LagLimit/Threshold safety warning and correct the JDBC generator.
3. Correct the sequence/manual-failover and 26ai defaults/view claims.
4. Apply the remaining qualification edits.

## Resolution — 2026-08-04

All findings were independently re-verified against the cited code locations
and the live Oracle documentation pages before any fix was applied. Every code
citation was accurate; the doc claims were confirmed with the exceptions noted
under finding 5 and finding 15 below. Fixes landed in the same-day commit that
carries this section; `node --test site/test.mjs` passes (68 tests, up from
66), `site/build.mjs` passes the ASCII guard, and the changed states were
verified in the rendered page in both editions.

| # | Status | How it was resolved |
|---|---|---|
| 1 | **Fixed** | `computeCommit` takes `version`; ASYNC + MaxAvailability is `modeConflict` under 19c and a new informational `modeAllowed26` under 26ai (warn note, chip and DGMGRL note per edition). Tests are edition-parameterized. |
| 2 | **Fixed** | TRANSPORT is now a modeled quantity: a transport-lag slider (26ai + MaxPerformance + TRANSPORT only, URL key `tla`, clamped to the apply lag, falling back to it when absent) is what the readiness gate, loss bound, `ifDiedNow` and every blocked/refused banner follow; the TRANSPORT echo also requires MaxPerformance now. |
| 3 | **Fixed** | `computeReopen` takes `fsfoEnabled` (false when no observer is deployed); `lagStallAt`/`lagGraceArmed` stay null then, so the brace, the chips and the appended prose sentence all go inert. Regression test added. One correction to this finding: `site/test.mjs:504` already covered the no-observer case for the FSFO timeline model — the gap was specific to the reopen model. |
| 4 | **Fixed** | The lag-limit note warns (is-warn) when the limit exceeds the threshold, quoting Oracle's recommendation; the split-brain callout's "at most one database ends up open" is now conditional on limit &le; threshold. |
| 5 | **Fixed, with a correction to the report** | The JDBC URL now always emits `TRANSPORT_CONNECT_TIMEOUT` with an explicit `sec` suffix. The report's side-claims were not adopted: the "18.1 added suffixes" and "changed in 23.6" version attributions could not be verified on Oracle's pages (the 0 vs 20 000 ms default difference between the 19c and current `OracleConnection` pages could), and the comment the report called misleading is defensible — older thin releases did read a bare value as milliseconds — so it was reworded, not deleted. |
| 6 | **Fixed** | The 26ai defaults column shows "0 — not set" for both ping properties and the caption names the property-page/chapter contradiction instead of claiming identical defaults. |
| 7 | **Fixed** | "Queryable on any member" replaced with the views reference's Primary scoping ("query it there"). |
| 8 | **Fixed** | The ASYNC commit caption now calls the window one commit's exposure and names `FastStartFailoverLagLimit` as the configuration-wide bound. |
| 9 | **Fixed** | Both sequence diagrams (the simulator's inline SVG and `diagrams/fsfo-sequence.svg` + PNG) now draw: quorum check during the threshold window, threshold expiry, readiness verification, then FAILOVER — matching the documented order, which was confirmed from the chapter text. |
| 10 | **Fixed** | The observer-lost caption, summary and chips now say a failover needs `DISABLE FAST_START FAILOVER FORCE` first (unobserved fails the documented manual-failover conditions; bare attempt raises ORA-16658). |
| 11 | **Fixed** | The change-table row says the observer *or the target standby* may grant the `LAGGING` permission. |
| 12 | **Fixed** | All four spots (including both V26 keys) now say the broker *tries to nominate* a backup, with the connected-pair precondition. |
| 13 | **Fixed** | The per-ADDRESS-and-per-IP semantics are stated in the control note, the parameter table and the traversal note; the single-IP drawing assumption is explicit. |
| 14 | **Fixed** | MaxFailure's 0 default is scoped to the default log-archive destination group (non-default groups default to 1) in both the note and the transport table. |
| 15 | **Deliberately not fixed** | Skipped per instruction. Additional verification note: the SQLcl `DG` page neither claims full DGMGRL parity nor documents a subset — it scopes itself to "Oracle Database release 21c only" and defers to the broker command reference — so the report's proposed "documented subset" wording is itself unsupported; if this is ever revisited, use a neutral phrasing. The `V$DG_BROKER_PROPERTY` "(monitorable)" half of the finding was confirmed and remains open. |

Documentation updated in the same pass: `AGENTS.md` accuracy rules (26ai
ObserverPing defaults contradiction, MaxAvailability-ASYNC edition split,
LagLimit-vs-threshold recommendation, LAGGING permission grantors,
`fsfoEnabled`/`version`/transport-lag model inputs, JDBC thin defaults,
per-IP timeout scope, nomination wording) and `diagrams/README.md` (sequence
order, MaxFailure table cell, ping-defaults sourcing note, LagLimit
recommendation, 26ai section, client-view facts, new sources).
