# Agent handoff — dataguard_doc

This repo documents Oracle 19c Data Guard. The simulator started as a
fast-start failover (FSFO) explainer and is now a general Data Guard
configuration + visualization tool, published as "Data Guard configuration".
This file tells a future agent what exists, how it was produced, and how to
extend it without breaking consistency or accuracy.

## What exists

| Path | What it is |
|---|---|
| `diagrams/fsfo-timeline-crash.svg` (+`.png`) | Swimlane timeline, primary host crash: detection → threshold → failover execution |
| `diagrams/fsfo-timeline-isolated.svg` (+`.png`) | Swimlane timeline, network partition: two independent threshold clocks, primary self-abort (split-brain protection) |
| `diagrams/fsfo-sequence.svg` (+`.png`) | Sequence diagram of the crash case with an elapsed-time gutter |
| `diagrams/fsfo-net-timeout.svg` (+`.png`) | Two panels separating NET_TIMEOUT (redo transport) from the broker failover clocks |
| `diagrams/README.md` | Figure embeds, broker-property and redo-transport-property tables with verified defaults, the ping-properties quirk, the verified-facts sections behind the simulator's commit/reopen/observer/placement/side-topics views (including the 24-cell observer-placement outcome matrix) and behind the 26ai edition switch (the MaxAvailability lag-limit semantics and Oracle's self-contradiction on them, `PrimaryDatabaseCandidates`, `V$FS_FAILOVER_OBSERVERS`), the drawing idealizations, Oracle doc links |
| `simulator/fsfo-simulator.html` | Source fragment of the interactive simulator, published at davidbudac.cz/dataguard. English only |
| `simulator/i18n/cs.json` | Czech translation catalog, keyed by the English source strings. Real UTF-8 — deliberately outside the ASCII-only fragment |
| `testing/README.md` | Test runbook: step-by-step drills verifying each documented situation against a real 19c configuration (crash, isolation, observer loss, NET_TIMEOUT, blocked failover, reopen/MaxFailure, client view, commit measurement), with an RTO/RPO probe harness and reinstate cleanup. Repo-only markdown — not part of the published site |
| `site/build.mjs` | Wraps the fragment into a full page (doctype, charset, title, favicon, canonical + social meta), inlines `simulator/i18n/cs.json` as a JSON `<script>`, and enforces the ASCII-only guard — it exits non-zero on any byte above U+007E |
| `site/test.mjs` | Standalone node test: extracts the four model marker blocks from the fragment and asserts the documented domain invariants — including the scenario × observer-location outcome matrix as literal tables (24 cells, plus the 19c-invariance loops over the version axis) — then checks the Czech catalog for dropped placeholders, unbalanced inline markup and bad plural forms. No dependencies; `node --test site/test.mjs`. `site/publish.sh` runs it after the build, so a model that contradicts the docs cannot be deployed |
| `site/publish.sh` | Builds, tests the models, and deploys to the VPS, then verifies the public URL |

## Publishing

The simulator is served at **https://davidbudac.cz/dataguard/** from the user's
own VPS. To publish:

```bash
./site/publish.sh
```

It builds `_site/`, tars it over ssh to `root@dbhetz-ubu26:/var/www/dataguard`
(unpacking beside the live tree and renaming it in, so a half-uploaded tree is
never live), then re-fetches the public URL and fails unless it gets HTTP 200
with exactly the byte count it just built. `--dry-run` builds without deploying.
Overridable via `DG_HOST`, `DG_DEST`, `DG_URL`.

Two things to know:

- **Publishing is explicit now.** It is no longer a side effect of `git push`.
  Committing changes nothing about what is live until you run the script.
- **The script ships the working tree, not `HEAD`** — deliberately, so you can
  preview an edit on the real URL before committing. It prints a warning when
  the fragment has uncommitted changes; read that warning.

nginx serves it from a dedicated `location ^~ /dataguard/` block in
`/etc/nginx/sites-enabled/dbudac.conf` on the VPS. That block sets its own
security headers instead of including `snippets/dbudac-headers.conf`, because
the shared snippet's CSP is `script-src 'self'` and the page needs
`'unsafe-inline'` for its single inline `<script>`; two CSP headers are enforced
as their intersection, so including the snippet would silently break the page.
The block's comments say so on the server too. Note that on that box
`sites-enabled/dbudac.conf` is a **regular file, not a symlink** — the
`sites-available/` copy is stale, so edit the enabled one.

Two earlier publishing routes are retired — do not resurrect either:

- A Claude artifact, retired 2026-07-29 (do not republish as an artifact).
- GitHub Pages (`.github/workflows/pages.yml`), removed 2026-07-30 when the repo
  went private. The ASCII guard that lived in that workflow now lives in
  `site/build.mjs`, so it still runs on every publish.

## Accuracy rules (non-negotiable)

All domain claims were verified against the Oracle 19c/21c Data Guard Broker
documentation (links in `diagrams/README.md`). Key facts, which every asset must
agree on:

- `FastStartFailoverThreshold` default 30 s, min 6 s. The clock starts when the
  observer FIRST loses its connection to the primary. Failover requires BOTH the
  observer and the target standby to have lost the primary for the threshold,
  plus the standby's readiness check (synchronized in MaxAvailability/
  MaxProtection; apply lag ≤ `FastStartFailoverLagLimit` in MaxPerformance).
- **`ObserverOverride` default FALSE, and the whole page assumes the default.**
  The "both the observer and the standby must have lost the primary" rule above
  is that default's behavior: with TRUE, "an automatic failover [may] occur when
  the observer has lost connectivity to the primary … even if the standby has a
  healthy connection to the primary", and several **continues** cells in the
  outcome matrix would become failovers. State the assumption wherever a cell
  outcome is asserted; never present the standby's veto as unconditional.
- `ObserverPingInterval` default 100 ms; `ObserverPingRetry` default 10.
  Documented quirk: when BOTH are explicitly set, the threshold is ignored for
  the observer's detection. The isolated primary's own stall clock still uses
  the threshold. **The ignore is documented; the arithmetic is not.** The docs say
  only that detection "can be reduced to nearly 1 second", so
  pingInterval × (pingRetry + 1) — the first failed ping plus its retries,
  ≈ 1.1 s at the minimums — is **this page's model** of that sentence and every
  asset that draws the number must label it as a model, never as a quoted figure.
  Docs gap: the 19c properties reference does not list these two
  properties (they exist since 12.2); cite the 21c+ edition for them.
  **26ai defaults contradiction:** the 26ai property pages give the broker
  defaults as 0 — not set, detection governed by the threshold — while the
  26ai FSFO chapter's table still shows 100 ms / 10. The simulator's 26ai
  defaults column shows "0 — not set" and its caption names the
  disagreement; never write "defaults identical in 26ai" unqualified. The
  explicitly-set minimums stay 100 ms / 10 in every edition.
- `FastStartFailoverLagLimit` default 30 s, min 5 s, MaxPerformance only **under
  19c**. **Under 26ai it also applies in MaxAvailability, where the broker default
  is 0**: zero means the standby must have received everything and the failover
  is zero-loss (the 19c rule written as a number), any non-zero value (min 5 s)
  makes MaxAvailability bounded-loss, permitted while the apply lag is at or
  below the limit. `V$FAST_START_FAILOVER_CONFIG` names the two `ZERO DATA LOSS`
  and `POTENTIAL DATA LOSS`. **Cite the 26ai fast-start failover chapter's
  *Fast-start Failover Protection Modes* section for this — never that chapter's
  *Task 3* and never the closing line of the `FastStartFailoverLagLimit` property
  page, both of which still carry the stale "maximum performance mode only"
  sentence.** The property page is a valid citation for the value ranges only;
  the page states the contradiction in footnote 5 rather than hiding it.
  Task 3 is stale on the transports too: it still says MaxAvailability takes
  SYNC or FASTSYNC, against the prerequisites list's "SYNC or FASTSYNC or
  ASYNC" — so **ASYNC under MaxAvailability is a mode conflict only under
  19c**; under 26ai the commit view draws an informational "allowed" note
  instead (`computeCommit` takes `version`, and zero data loss still wants
  SYNC/FASTSYNC). **Oracle recommends `FastStartFailoverLagLimit` at or below
  `FastStartFailoverThreshold`**: past it the old primary can keep committing
  after fast-start failover is initiated, briefly risking two primaries — the
  rail warns when the sliders cross, and no asset may present "at most one
  database ends up open" as unconditional.
  `FastStartFailoverLagType` and `FastStartFailoverLagGraceTime` did **not**
  follow it: both stay documented as maximum-performance-mode behavior whatever
  the lag limit is doing in MaxAvailability, and both gray out there. The
  `LAGGING` permission is granted **by the observer or the target standby** —
  never word it as the observer's alone — and `FastStartFailoverLagGraceTime`
  is defined only **while fast-start failover is enabled**, so with no
  observer deployed the reopen panel draws no stall and no grace band
  (`computeReopen` takes `fsfoEnabled`). Under TRANSPORT the gated quantity is
  the **transport-lag slider** (clamped to the apply lag; absent in an old
  link it falls back to the apply lag), which the readiness gate, loss bound
  and refusal banners follow, while terminal recovery still pays the apply lag.
- **`PrimaryDatabaseCandidates` is a fast-start-failover-*disabled* fence.** It
  lists the members the broker may make primary; while FSFO is disabled it
  restricts `SWITCHOVER` and `FAILOVER` to that list and refuses anything else
  with `ORA-16529`; once FSFO is enabled it adds nothing new, because
  `FastStartFailoverTarget` already governs the target. Default is an empty
  string (restricts nothing) and the broker adds the current primary itself if
  the list omits it. Never word it as "a fence around fast-start failover". The
  19.26 backport is reported by the Data Guard PM's blog series only — not in
  Oracle's release-update documentation, so write it as reported, never as
  documented.
- **`PRIMARY UNOBSERVED` is a target-standby status** (broker Table 5-1, and the
  chapter's worked example): the primary shows `FS_FAILOVER_STATUS` =
  `SYNCHRONIZED` with `FS_FAILOVER_OBSERVER_PRESENT` = `NO`, and the target
  standby is where `FS_FAILOVER_STATUS` reads `PRIMARY UNOBSERVED`. Never put
  `PRIMARY UNOBSERVED` on the primary. With **no observer deployed at all**,
  `FS_FAILOVER_STATUS` reads `DISABLED` — a third state, not "unobserved".
- **A manual failover with FSFO enabled is conditional, not free.** "You can
  perform a manual failover even if fast-start failover is enabled" holds only
  where the target is the `FastStartFailoverTarget` standby, that standby is
  synchronized (MaxAvailability/MaxProtection) or within the lag limit
  (MaxPerformance), and "the observer is started and communicating with the
  target standby database", with the primary shut down first. So an *unobserved*
  configuration fails the third condition — `DISABLE FAST_START FAILOVER FORCE`
  first. Word the no-observer case as a manual failover needing no observer
  *while FSFO is disabled*, never as unconditionally available.
- **`FastStartFailoverAutoReinstate` is narrower than "the old primary returns".**
  It reinstates only after an observer-initiated failover caused by a primary
  crash or isolation — never after a user-configurable health condition or a
  `DBMS_DG.INITIATE_FS_FAILOVER` call — and needs Flashback Database on both
  databases, the former primary started and mounted (a manual restart when
  `FastStartFailoverPmyShutdown` aborted it), the master observer able to reach
  it, and static service names without Clusterware/Oracle Restart. Reinstate
  stays out of scope; this is the wording for the one reference row and the
  sequence-diagram footer that mention it.
- **`V$FS_FAILOVER_OBSERVERS`** (26ai diagnostics): `CURRENT_TIME` is the time the
  query was run, not an observer heartbeat, and the view's behavior is defined
  only when it is queried **on the primary**. Never present its output as
  queryable anywhere in the configuration.
- **TAF and Application Continuity are different promises.** TAF reconnects and,
  with `SELECT` failover, continues an open fetch, but cannot replay a
  transaction — active transactions are rolled back and the application must
  handle the error. Application Continuity is the conditional-replay mechanism:
  replay-eligible requests only, and a replay it cannot verify is rejected. Never
  collapse the two into "TAF or Application Continuity resumes their work".
- **The nomination rule carries a precondition — quote it with one.** Oracle's
  wording is "if the primary and target standby databases stay connected but the
  connection to the master observer is lost, then the broker tries to nominate a
  backup observer as the new master observer", and, the other way, if either
  database loses its connections to all backup observers the broker does *not*
  nominate and reports the configuration unobserved. Never state the rule
  unconditionally, and never extend it to a failure that separates the primary
  from the target standby — that is not the documented case.
- **The scripting surfaces in the 26ai change table predate 26ai.** The official
  SQLcl `DG` page is scoped "Oracle Database release 21c only" and the ORDS
  Data Guard REST endpoints are documented in ORDS 23.3, so the row names both
  releases; the table caption's "including what arrived in 21c and 23ai" is what
  it leans on.
- `FastStartFailoverPmyShutdown` default TRUE: a primary STALLED
  (`V$DATABASE.FS_FAILOVER_STATUS`) longer than the threshold, unable to reach
  observer or target standby, aborts itself.
- `NET_TIMEOUT` is a `LOG_ARCHIVE_DEST_n` transport attribute (broker property
  `NetTimeout`), default 30 s, min 1 s, ≥ 8–10 s recommended. It bounds how long
  LGWR waits for the standby's SYNC ack; it is NEVER a failover clock, never
  affects sessions under ASYNC, and must not appear in the broker-properties
  table. In full isolation the FSFO stall overrides its drop-and-continue
  behavior. At the defaults it and the threshold both run 30 s from t = 0 and
  expire together — never draw NET_TIMEOUT as bounding only the first seconds
  of an isolated stall; the commit hang spans the whole stall. The simulator's
  panel B deliberately shortens it to 10 s (and says so) to pull the two
  clocks apart; the threshold/abort still runs 0 → 30 s.
- Failover execution (terminal recovery + role change + open) is
  environment-dependent, not parameter-driven — always label it that way.
- **Switchover** (the planned role reversal, the workbench's only planned scenario): zero data loss in
  **every** protection mode — never qualify it by mode. With FSFO enabled the broker permits a
  switchover only to the pre-specified target standby, and only while that standby is synchronized
  (MaxAvailability) or inside `FastStartFailoverLagLimit` (MaxPerformance); past the limit in
  MaxPerformance it **refuses the command** — word it as a refused `SWITCHOVER`, never as a
  forbidden failover. An apply lag does *not* block MaxAvailability, because synchronized is about
  redo **received**; it only lengthens the catch-up. The **former primary** is the database that
  restarts (as the new standby); "the new primary database does not need to be restarted", and it
  does not wait for the old one. Sessions on the primary are terminated as it converts. No failover
  clock runs at all — threshold, `ObserverPing*` and `FastStartFailoverPmyShutdown` are spectators,
  and FSFO stays enabled across the swap. Duration is environment-dependent (unapplied redo, update
  activity at the moment of the command, online redo logs to clear), so label it that way; the 1 s
  verify and 2 s convert bands are nominal drawing constants (footnote 3), not documented numbers.
- Reinstate (`FastStartFailoverAutoReinstate`, Flashback Database) is
  deliberately out of scope; at most a footnote.
- Client connect-string facts (simulator "application's view" section; sources
  in `diagrams/README.md`): `TRANSPORT_CONNECT_TIMEOUT` default 60 s per
  ADDRESS — and per IP address a host name resolves to; the page draws
  single-IP hosts and says so; `CONNECT_TIMEOUT` per ADDRESS, no default (HA guide example 90 s);
  `RETRY_COUNT` default 0 (extra traversals of the whole list), `RETRY_DELAY`
  no default; `FAILOVER` default on; `LOAD_BALANCE` default off inside an
  ADDRESS_LIST. Role-based services make the standby refuse instantly with
  ORA-12514. These parameters affect only NEW connections, never established
  sessions. **The JDBC thin driver does not inherit Oracle Net's 60 s
  transport default** — its own connect-timeout default is 0 in the 19c
  driver and 20 s in current ones — so `buildJdbc()` always spells
  `TRANSPORT_CONNECT_TIMEOUT` out with an explicit `sec` suffix (older thin
  releases read a bare value as milliseconds). Never "simplify" the thin URL
  back to the TNS omission rule, and never name the release that changed the
  thin default — it is not stated on the API reference pages. Nominal drawing constants (footnote 3): refusal 0.2 s, OS refusal
  0.15 s, establish 0.3 s; service assumed published the instant the new
  primary opens.
- `LogXptMode` takes SYNC | FASTSYNC | ASYNC, broker default ASYNC, mapping to
  `SYNC`+`AFFIRM`, `SYNC`+`NOAFFIRM`, `ASYNC`+`NOAFFIRM`. `AFFIRM` acknowledges
  received redo AFTER writing it to the standby redo log, `NOAFFIRM` BEFORE that
  write — spell it exactly that way round. Two documented defaults coexist:
  parameter-level `NOAFFIRM` (Database Reference) and the contextual default
  (`AFFIRM` with SYNC, `NOAFFIRM` with ASYNC, Concepts and Administration);
  `AFFIRM` without `SYNC` is deprecated. FASTSYNC is 12.1+ and MaxAvailability
  only — cite the 12.1 broker release-changes page, the only edition carrying
  the notice (same precedent as the 21c ObserverPing* citation). Legality per
  broker Table 4-2: MaxProtection SYNC; MaxAvailability SYNC or FASTSYNC;
  MaxPerformance ASYNC is the only mode listed — never write that SYNC is
  illegal there. FSFO cannot be initiated when FASTSYNC is in use and the
  standby is missing redo data.
- Commit cost is **max(local write, remote ack path)**, never the sum, because
  the documented 13-step SYNC path has LGWR start the remote write (step 5)
  before it issues the local write (step 6) and wait for the remote write only
  afterwards (step 7). Two things never to do: never claim Oracle calls this
  "parallel" (it does not — the step ordering is the whole evidence), and never
  cite the `log file parallel write` wait event as support, since that event is
  about multiplexed online-redo members.
- `ReopenSecs`/`REOPEN` default 300 s, valid values ≥ 0; the meaning of 0 is
  NOT documented, so the simulator floors its slider at 30 s instead of
  guessing. The interval only gates eligibility — redo transport retries failed
  destinations at log switch time, once last error + `REOPEN` < now — and it
  applies to all errors, not just connection failures.
- `MaxFailure`/`MAX_FAILURE` counts CONSECUTIVE attempts to reestablish the
  destination at log switches; 0 = unlimited and is the default for
  default-group destinations (non-default log-archive-destination groups default
  to 1). At the limit the destination is disabled with no further access until
  it is MANUALLY reenabled — the network healing does not bring it back, and the
  destination is then treated as if `REOPEN` had not been specified. Whether a
  successful reopen resets the counter is NOT documented ("consecutive" implies
  it; do not state it as fact). Exception: 12.2+ GROUP/PRIORITY destinations
  re-enter service when found accessible. Both are deprecated as broker
  properties in 19c (`EDIT DATABASE ... SET PARAMETER` instead). Documentation
  defect: the 19c broker-properties page lists `MaxFailure` as "Corresponds to:
  VALID_FOR" — always cite the sbydb `LOG_ARCHIVE_DEST_n` attributes page for
  `MAX_FAILURE` semantics, never the broker page.
- **SDU** (chapter 5): the HA guide recommends 65535 **for synchronous
  transport only** — a best practice, never a requirement, and the guide says
  nothing about ASYNC, so neither do these assets. `DEFAULT_SDU_SIZE` defaults
  to 8192 with a documented range of 512 – 2097152 bytes, so never call 65535
  the parameter's maximum (the guide's own "its maximum value" wording is
  stale) and never present 2 MB as the recommendation. SDU is negotiated per
  connection and the lower end wins — hence both ends.
- **Socket buffers** (chapter 5): `SEND_BUF_SIZE` / `RECV_BUF_SIZE` are Oracle
  Net parameters, not `LOG_ARCHIVE_DEST_n` attributes — settable in
  `sqlnet.ora`, or per connect descriptor in `tnsnames.ora` and `listener.ora`,
  at `DESCRIPTION` level or inside one `ADDRESS`. Defaults are OS-specific (the
  Net Services reference gives Linux 2.6: 16 KB send, 87380 bytes receive), and
  the value is a limit the OS may not grant in full. Sizing: Net Services says
  at least one bandwidth-delay product (its worked example, 100 Mbit/s × 5 ms ≈
  64 KB, and its own redo note that a 1 MB largest redo message would justify
  1 MB); the HA guide says a minimum of 3 × BDP on a high-latency,
  high-bandwidth link and gets there by raising the kernel maxima
  (`tcp_rmem`/`tcp_wmem`) so the TCP stack sizes each socket itself. Do not
  reconcile the HA guide's Linux example against its own text — it says "set the
  maximum ... to 3*BDP. In this example BDP is 16MB" while setting 16777216, so
  quote the command, never a derived BDP.
- **oratcptest**: from MOS note 2064368.1, JRE 6+, any OS user. SYNC mode waits
  for each message's ACK, ASYNC does not. `-length` is the average redo write
  size (`redo size` / `redo writes`); `-write` on the client asks the server to
  write each message to disk, mimicking the SRL write an AFFIRM standby pays,
  and the server needs `-file` for it. Its output reports **half** the socket
  buffer actually allocated ("should be doubled to find the actual size used"),
  and the guide says explicitly **not** to use its `-sockbuf` parameter, because
  an explicit request answers to different kernel parameters than the test. Only `-server`, `-port`, `-mode`,
  `-duration`, `-interval`, `-num_conn`, `-output` and `-freq` are documented on
  the public 19c page — the other three come from the login-gated MOS note, and
  the card on the page says exactly that. Keep that provenance line.
- **The SYNC wait events** (chapter 5): `log file sync` ⊃ `redo write time` ⊃
  { `SYNC remote write`, `log file parallel write` }, with `RFS random i/o` on
  the standby. Four of those are wait events; `redo write time` is a `V$SYSSTAT`
  **statistic in centiseconds** ("10s of milliseconds") — never call it a wait
  event and never drop the unit. The max()-not-sum rule above applies here too:
  never draw the two legs as sequential, never call the overlap "parallel", and
  never cite `log file parallel write` as evidence for it. Oracle's own guidance
  is that `log file sync` averages are misleading (commit batching), so the page
  points at transactions per second, the redo rate and histograms instead. The
  before/after numbers on the page (0.68 → 4.60 ms, TPS −20.3%, redo writes
  −61%, write size +94%) are **Oracle's worked example on Oracle's test system**
  and must never be presented as what SYNC typically costs.
- Observer loss alone stalls nothing: the primary stalls only when it can reach
  NEITHER the observer NOR the target standby. While unobserved,
  `V$DATABASE.FS_FAILOVER_STATUS` = `PRIMARY UNOBSERVED` and
  `FS_FAILOVER_OBSERVER_PRESENT` = NO. `ORA-16820` (observer no longer observing
  this database) is the standing health condition; `ORA-16658` (unobserved
  fast-start failover configuration) is raised only when a failover is ATTEMPTED
  while unobserved — never use the two interchangeably. 19c registers up to
  three observers, one of them master, and only the master coordinates FSFO; if
  the master dies while primary and standby still see each other, the broker
  **tries to nominate** a backup observer as the new master (12.2+; an attempt
  under that precondition, never a guarantee — see the nomination rule above),
  with `SET MASTEROBSERVER TO` as the manual override. The "three" is 19c-specific — later releases allow
  more, so do not carry the number across editions.
- **Observer placement** (the workbench's observer-location control). Oracle
  documents a hierarchy, and it has exactly three rungs: **a third site or third
  data center**, first, "so that the primary, observer, and standby have isolated
  power, server, storage, and network infrastructure"; failing that, wherever the
  observer uses "the same path to connect to the production database as is used
  by the application tier" — with the guide's own caveat that when the app tier
  is local to the production database, the observer belongs "at either the
  standby location or a third data center" instead, because beside the app tier
  "it could experience the same issues as the database"; failing that, the
  **standby's data centre, on a separate host**, to "isolate the observer as much
  as possible from failures affecting the standby database". The observer must
  "never be deployed at the primary database server or cluster, or on the standby
  database server or cluster", which is why all four simulator locations put it on
  a host of its own and only the *site* varies. **The primary's site is not on
  that hierarchy at all**: word it as a caution — a site failure takes the
  observer with the primary, and an observer on one side of a cut cannot
  arbitrate it — never as a recommendation, and only ever as defensible when the
  application tier is local to the primary.
  **Deploying no observer is not the same as being unobserved.** Unobserved
  means FSFO is enabled and the master observer is missing:
  `FS_FAILOVER_STATUS` = `PRIMARY UNOBSERVED`, `ORA-16820`, the observer-lost
  scenario, and the broker's list headed "Fast-start failover cannot occur if:",
  whose first entry is "The master observer is not running". No observer
  deployed means FSFO was never enabled — the
  `FastStartFailover*` properties can be set and nothing arms them, and a manual
  `FAILOVER TO` is the only thing that promotes the standby. One corollary to
  keep straight: the MaxPerformance switchover refusal past
  `FastStartFailoverLagLimit` is FSFO's **own** gate, so it cannot fire with no
  observer deployed. Sources: the 19c HA guide's *Optimizing Automatic Failover
  in Common Scenarios* (rungs one and two, and the never-on-a-database-server
  rule), 12.1 HABPT §8.5.2.3 *Fast-Start Failover Best Practices* (the third rung
  and the isolate-quote — a cross-edition citation, same precedent as the 21c
  `ObserverPing*` pages) and the 19c broker guide's switchover/failover chapter
  (the master-observer condition).
- **Three placement cells worth knowing by heart** — they are what the control
  exists to show, and `site/test.mjs` asserts all 24 of them. (1) A partition of
  only the primary-to-standby site link, watched by an observer in the
  **standby's** site, is a **false failover**: both halves of the quorum have
  lost a primary that never stopped serving, so the standby is promoted — and
  the same cut leaves that healthy primary reaching neither observer nor
  standby, so it stalls and, under `FastStartFailoverPmyShutdown`, aborts at the
  threshold. (2) Losing the whole **standby site** with the observer in it stalls
  the primary from t = 0 with nobody left to fail over to: it self-aborts one
  threshold later and no failover is ever possible — losing the *standby* site
  is what takes production down. (3) A fully isolated primary watched from its
  **own** site is the mirror image: the observer still sees the primary and
  holds fire, so nothing is promoted, the standby is stranded, and the primary
  serves a world that cannot reach it.

When adding new claims, verify against docs.oracle.com first and note the
source in `diagrams/README.md`.

## Shared visual language

Lanes top to bottom: Primary, Observer, Standby. t = 0 is the failure event.
Phase colors (light-mode hexes; the simulator maps them to theme tokens):
teal `#0E7C6B` serving/open · blue `#2563EB` standby applying · amber `#D97706`
waiting/countdown · red `#D64545` down/stalled (hatched fills) · violet
`#6D5AE6` observer decisions · slate `#475569` neutral. Parameter names always
in a monospace stack, spelled exactly. Braces sit under the axis, tied
pixel-exact to the interval they govern.

All timeline SVGs share one scale so they overlay: **x(t) = 280 + 10·t**
(10 px/s, domain −14 s … +80 s, x = 140…1080); each file records its scale in
an XML comment above the root element. SVGs are standalone: explicit white
background rect (GitHub dark mode), no external references, real `<text>`.

Regenerate a PNG after editing an SVG:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --screenshot=diagrams/NAME.png --window-size=WxH \
  --default-background-color=FFFFFFFF "file://$PWD/diagrams/NAME.svg"
```

(W×H = the SVG's viewBox size.)

## The simulator

`simulator/fsfo-simulator.html` is a self-contained fragment (no doctype/html/
head/body; `<title>` first). **It must stay pure ASCII** — because it has no
`<head>`, it carries no `<meta charset>`, so any raw em dash or `×` renders as
mojibake (`Timeline â€” primary crash`). Escape by region: named entities in
markup, `\uXXXX` in JS strings, plain ASCII in comments. Full rule and the
verification command are in [CLAUDE.md](CLAUDE.md). Other constraints: zero
external requests (artifact CSP),
vanilla JS, token-based theming — palette custom properties on `:root`,
redefined under `@media (prefers-color-scheme: dark)` AND under
`:root[data-theme="dark"]` / `:root[data-theme="light"]` so the host toggle wins
both ways. Every section is driven by a pure function inside a marker pair —
`computeFsfo(c)` in `/* MODEL:START */`…`/* MODEL:END */`, plus `APPMODEL`,
`COMMITMODEL` and `REOPENMODEL` below. The four blocks are DOM-free and
closure-free, so a standalone node test is their concatenation, extracted
between the markers — concatenate `MODEL` first: `computeApp` shares its
`pickTickStep` (the millisecond- and minutes-scale blocks carry their own
tick helpers because their ladders genuinely differ). `site/test.mjs` does
exactly this and asserts the documented invariants; `site/publish.sh` runs it
after every build. Timing model: initiate =
threshold, or pingInterval × (pingRetry + 1) when the ping properties are set;
blocked when MaxPerformance and lag > lag limit; a stalled primary's abort
always uses the threshold. `computeFsfo` also has an `observer-lost` branch
(below) returning `observerLost` and `ifDiedNow`, and a `switchover` branch
returning `switchover`, `tDown`, `tConvertEnd`, `downtime` and `tRestartDraw`.

**Every return path carries `m.outcome`** — `failover` · `continues` ·
`stall-noone` · `manual` · `observer-lost` · `switchover` — and the renderers
branch on it, never on the scenario name, because the same failure tells a
different story per observer placement. Between the scenario and the outcome sit
five reachability facts the model derives once and the drawings read straight
off it: `stalled`, `standbyGone`, `redoFlowing`, `pmyReachable`, plus the
effective `scenario` echoed back (an `observer-lost` scenario with no observer
deployed is a plain crash, and the model says so rather than letting the rail and
the drawing disagree). `c.observerLoc` is defaulted to `dc3` **inside** the
model: that one line is the whole back-compatibility story for shared links,
stored configurations and export files written before the control existed.

The page is split into six chapters — `#ch-clocks`, `#ch-transport`, `#ch-app`,
`#ch-config`, `#ch-side`, `#ch-reference` — each a `<section class="chapter">` wrapper that opens with a
screen-reader-only `h2` (class `chdiv-t sr`, the `aria-labelledby` target and
the translation hook; the old visible divider bands are gone) and is listed
in the sticky `<nav class="chapnav">` sitting between the hero and chapter 1.

**Prose is opt-in, per section.** In the visual sections the `.sec-hd` header
and intro caption sit *below* the workbench/drawing (chapter 4's card sections
keep theirs on top — moved below, a header reads as the next block's label), and
each section's `.sec-hd`, `.notes` grid and static `.caption` (those without an
`id`; dynamic state captions all have ids) hide behind one **"Explain more"**
button. A small IIFE injects that button at the position of the first hidden
block, so the control *is* the explanation's place on the page — no global
switch to find, and nothing silently missing. It adds `.prose-managed` to the
section (the hide rules key on it, so without JS nothing is hidden — the same
contract as the tabs), `.prose-only` where the section is nothing but prose
(chapter 1's note grid, which then collapses to the button alone), and toggles
`.prose-on` on click, relabelling the button `Hide` and flipping its arrow.
Exempt: the Reference chapter, skipped in the script because its headers caption
tables, and print (a printout always carries everything, and the buttons do not
print). State is deliberately not persisted: the affordance is visible at every
spot, so re-opening costs one click.

**The chapters are tabs.** A second, self-contained IIFE at the end of the file
turns the bar into a tablist: one chapter is in the document at a time, the
others carry `hidden`. Four things follow from that, and each is load-bearing:

- **Nothing is hidden by markup or by CSS alone.** The script adds `is-tabbed`
  to `.fsfo`, and only then does `.chapter[hidden]` become `display:none`. With
  no script the six chapters read top to bottom exactly as they did before
  tabs, and the bar is a list of in-page anchors. The print rule takes the same
  route back — it un-hides all six, so a printout, and a find-in-page over it,
  still carries the whole document.
- **Opening a chapter repaints its drawings.** A sketch built while its wrapper
  measured zero fell back to 880 px, so `show()` dispatches a `resize` event
  and lets the model block's own width comparison repaint what moved. The
  `ResizeObserver` there fires on *some* of these visibility flips but not all
  of them — verified — so the event is what makes it certain.
- **Anything that jumps to an element measures a rect, so the chapter has to be
  open first.** `window.DGTabs.reveal(node)` opens the chapter containing a
  node; `jump()` in the URL IIFE calls it, and the config pill skips
  workbenches whose `offsetParent` is null (a closed chapter has no box, and an
  all-zero rect otherwise reads as "scrolled past").
- **Never measure the bar's own position with `getBoundingClientRect`.** It is
  sticky, so once pinned its rect top reads 0 and "how far down the document is
  it" always comes back as the current scroll position. `show()` measures the
  panel instead.

It also measures the bar into `--navh` (the chapters' `scroll-margin-top` and
the control rails' sticky offset both derive from it), and appends the prev/next
pager at the foot of each panel, reading its titles off the nav links so a
language switch just rebuilds it. New sections belong **inside** one of the six
wrappers. The one deliberate exception is the page footer (`.pgfoot`, the byline
and the link to davidbudac.cz), which sits after the last chapter but inside
`.fsfo` precisely so it is not a chapter's content and shows on all six tabs —
note that the `.foot` footnote block is *not* the same thing: it lives in
`#ch-reference` and is visible only there. Only the byline span is in the i18n
snapshot; the domain beside it is not prose and carries no catalog entry. Prose that points at another chapter uses an `<a class="xref">`; a
delegated handler in the same IIFE opens the target's chapter before scrolling,
because the browser cannot scroll to an element that is still `hidden` — the
`hashchange` path alone opens the chapter but leaves the reader where they were. Related: `.fsfo` uses `overflow-x:clip`, not `hidden`, because `hidden`
forces `overflow-y` to `auto`, which makes `.fsfo` a scroll container and
silently kills every `position:sticky` inside it (the control rails included).

**URL state.** A fourth self-contained IIFE at the end of the file keeps the
address bar holding a shareable link to the current configuration: every
non-default control value rides as a short query parameter (`?pm=perf&lag=45`,
composing with the `#chapter` anchors), restored on load. Its `FIELDS` table is
the single source of truth for the key vocabulary — hand-assigned short keys
decoupled from element ids, radio maps doubling as the validation whitelist.
Values from the URL are clamped to the control's live min/max, snapped to its
step, and anything else is ignored; nothing from the URL reaches `innerHTML` or
state unclamped. Serialization is rAF-collapsed **plus a ~300 ms trailing
debounce — mandatory, not polish: WebKit rate-limits `history.replaceState` to
about 100 calls per 30 s and a slider drag alone would trip it.** Listeners sit
on `document` in the capture phase so they also catch non-bubbling programmatic
dispatches (the click-to-type commit was one until it gained `bubbles:true`).
The load-bearing architectural rule: `C`/`K`/`R`/`A` live inside the first
IIFE's closure and are unreachable — anything outside pushes state by setting
`.value`/`.checked` and dispatching the control's own `input`/`change` event,
never by calling into the models. There is no URL key for `#cm-rtt`; it is a
second face of `#c-latency` (`lat`), reconciled on every draw.

**Demo links.** Prose cards that assert something the workbench can demonstrate
carry a `data-demo` attribute; the fourth IIFE's `DEMOS` table maps each slug to
the parameters that prove the claim plus the workbench to jump to, and injects a
"Show me ..." button. A demo applies **over the defaults baseline**, resetting
every unlisted control — reproducibility is the point — and the URL serializer
then makes the address bar that demo's permalink by itself. The jump waits two
rAFs (the redraw queued in the first can change page height above the target).

**Page chrome (the third IIFE).** Two injected pieces, no markup of their own:
the **Notes toggles** — every `.rail` containing a `.ctl-note` gets
`notes-managed` plus a Notes button toggling `notes-open`; collapsed rails hide
notes and tighten `.ctl` padding so the rail fits the viewport, but `.is-warn`
notes always punch through (they are state, not documentation, and several
appear only mid-interaction), and a focused control reveals its own note
(`:focus-within`, deliberately never `:hover`) — and the **config pill**
(`.cfgpill`), a fixed chip shown while no workbench is on screen and one has
been passed, restating the last workbench's headline settings and first readout
chip from the rendered DOM (so it can never contradict the controls) and
jumping back on click. Standing rule for anything similar: new chrome is a
self-contained IIFE that injects its own DOM, degrades to nothing without JS,
and never reaches into another IIFE's closure — push state via controls plus
dispatched events only.

The workbench carries **six scenarios**, in rail order: primary **crash**,
**isolated** primary (every link out of the primary's site fails), **partition**
(only the link between the two database sites fails), **standby site down**
(`dc2down` — the whole standby data centre, and anything else in it), **observer
lost** and planned **switchover**. Crossed with them is the **observer-location**
control that sits directly beneath: **none** / **primary site** / **standby
site** / **third site** (the default, and what the page always assumed). That is
24 states, and the outcome of every one of
them is a literal table in `site/test.mjs` and a prose table in
`diagrams/README.md` — change one and change all three. The radio labels are deliberately role-relative and static, never the
configured site names: `.seg-row label` is in the i18n snapshot, so a
runtime-rewritten label would be clobbered on `setLang`; the configured names
arrive in the `ctl-note` through `t()` placeholders instead.

**Every gray control carries a pill saying why.** `.ctl-pill` is a small
uppercase chip at the top of the control (`ctlPill(ctl, why)`, created on
demand), and `depPill(input, why)` puts the same chip under a field on the
configuration card, where there are no notes to fall back on. It exists because
the notes collapse with the rail and the pill does not — a shut rail still
answers the question the gray raises. Three rules:

- The wording lives in one table, `WHY`, because the same reason grays several
  controls at once and the reader should recognize it as the same reason. Each
  entry is the control's note compressed to its clause — never a new claim.
- It is set from state on *every* pass, exactly like the `is-off` class, so a
  null reason clears it. Every branch of `renderControls` that grays a control
  must also set (or clear) its pill, including the three early-return branches.
- `.ctl.is-off` fades its *children*, not itself, so the pill stays legible on a
  faded control. Do not put the opacity back on the parent.

Two pills name a single gray *radio* rather than a gray control — the
observer-lost scenario under **none**, the both-sites placement under 19c — and
so name the option they are talking about.

**None means fast-start failover is not enabled at all** — not "enabled but
unobserved" (see the accuracy rules). Every control that only a failover gives
meaning to goes inert through the same borrow-and-restore pattern as the two sets
below, with its own note table (`NOFSFO_NOTES`): the threshold, the
`ObserverPing*` switch and sliders, `FastStartFailoverLagLimit`,
`FastStartFailoverPmyShutdown`, the role-transition time — and the observer-lost
radio itself, which is `disabled`, because there is no observer to lose. Two
gates now key on the *model* rather than the scenario name, and must stay that
way: the threshold is disabled when the ping properties are set **and the primary
is not stalled** (a stalled primary still runs its stall clock off the
threshold), and `FastStartFailoverPmyShutdown` is live exactly when
`m.stalled` — which is true in the partition and standby-site-down cells too,
not just under full isolation.

**Observer lost** kills the only observer host at t = 0: the primary keeps
serving because it still reaches the target standby, the standby keeps applying,
and no fast-start failover is possible at all — so every control that governs a
failover clock grays out, the lanes stay flat, and the "What the timeline shows"
grid explains why nothing happens. Its `ifDiedNow` value is what the primary's
death during the blind window would cost.

**Switchover** is the only planned event on the page: t = 0 is the DBA issuing
`SWITCHOVER TO` the target standby, not a failure. It has its own `computeFsfo` branch
(`switchover: true`, returning `tDown`, `tConvertEnd`, `downtime`, `tRestartDraw` and the two
nominal constants `SW_VERIFY`/`SW_CONVERT`), its own timeline builder and its own `computeApp`
branch — the ladder there starts at `tDown` and every address refuses instantly, because both
hosts stay up. `blocked` means the broker **refused** the command (MaxPerformance, lag beyond the
limit) and then nothing else happens: no conversion, no downtime, and the app view is a no-event
with its own wording (`switchoverRefused`). Four controls gray out through the same
borrow-and-restore pattern as observer lost (`SW_NOTES`): the threshold, both `ObserverPing*`
sliders and their switch, `FastStartFailoverPmyShutdown`, and — in chapter 3 — the dead-address
behaviour toggle, which has nothing to describe when neither host is dead. The apply lag, the lag
limit, the role-transition time and the protection mode all stay live, because each still changes
the outcome. The swap itself is identical at all four observer locations — the observer is a
spectator here — so the placement contributes exactly one appended, role-relative sentence per
location to the prose, and nothing else. With **none**, the lag limit joins the grayed set: the
MaxPerformance refusal is FSFO's own gate, so with nothing armed the command is simply accepted.

The four cells where no role is transferred get **two shared timeline builders**, one per shape, as
the file's one-builder-per-shape convention requires. `buildFlatTimeline` draws `continues` and
`manual`: three flat lanes, one event marker, no braces and no countdown, with the lane content
coming from `flatLanes(m)`, which reads `standbyGone` / `redoFlowing` / `pmyReachable` off the model
rather than the scenario name. `buildStallTimeline` draws `stall-noone`: the primary teal →
`STALLED` → aborted, observer and standby lanes hatched, and a single brace over a stall clock that
is counting down to nothing. Three constraints carried over: the **three lanes stay, always** — the
observer lane sitting empty under `none`, labelled "not deployed", *is* the lesson; `NET_TIMEOUT` in
the `continues` cells is **caption-only**, never a band and never a model field, because the
accuracy rules forbid drawing it as a failover clock; and the stall visuals key on `m.stalled`, not
on `scenario === 'isolated'`, which is what makes the partition cell draw its stall correctly.

The **topology strip** carries the placement visually: `renderTopo` picks node positions out of a
`LAYOUT[observerLoc]` table and wraps each data centre in a dashed `.tp-site` rectangle, so which
failures are *site* failures and which are only *link* failures is legible at a glance — the third
site's rectangle is drawn only when there is one, the standby site's is hatched `.tp-site-down` when
it is gone, and under `none` the observer box is replaced by a caption saying fast-start failover is
not enabled. Which links go down is one `linkState(link)` helper reading the scenario (crash: the
links touching the primary; isolated: exactly one endpoint in the primary's site; partition: one
endpoint in each database site; standby site down: the links touching it), so a new scenario is one
clause there rather than a rewrite. Its aria sentence gains a per-location and a per-scenario
clause, each a whole i18n key.

The "application's view" section (`#appview`) has its own pure function
`computeApp(a, m, scenario)` between `/* APPMODEL:START */` and
`/* APPMODEL:END */` — it consumes computeFsfo's output and simulates one
worst-case connection request walking the two-address descriptor's retry
ladder (per-pass toll min(TCT, CT) on the dead address, instant ORA-12514 from
the standby, RETRY_DELAY between traversals, success once a traversal reaches
address 2 at/after tOpen). Attempts collapse into an aggregated band when they
would be subpixel; horizons past ~160 s clip with a "gives up at" annotation.
The isolated scenario forces drop (a partition drops packets, so no refusal ever
comes back). It branches on `m.outcome`, and every no-event return says
which nothing it is describing in `noEventKind`, so the caption can explain the
right one: `observer-lost` and `switchover-refused` as before, plus `continues`
(no role change and the primary still answering — nobody dials anything unusual)
and `stalled` (a `STALLED` primary still runs its listener and still publishes
the service, so a new connection is accepted exactly as before; the outage is at
commit level, one layer below anything this ladder can see — say so). Its
state object is `A`; presets: Defaults (parameter defaults) and Tuned (3/90/30×3,
HA-guide shape).

Two more sections sit on their own time scales, each with its own pure function:

- **`#commitview`** — the millisecond-scale anatomy of one commit under SYNC /
  FASTSYNC / ASYNC. `computeCommit(k)` (`COMMITMODEL` markers) takes the transport
  mode, the local redo write (0–25 ms), the standby SRL write (0–25 ms) and the
  network RTT, and returns commit latency as max(local write, remote ack path) —
  the overlap rule above, not a sum. Chips: commit latency, standby wait,
  SYNC-vs-FASTSYNC delta, loss exposure. Picking ASYNC while the workbench is in
  MaxAvailability raises a conflict warning. Its RTT slider is two-way bound to
  the topology strip's RTT (`C.latency`) — moving either moves both.
- **`#reopenview`** — the minutes-scale aftermath, starting after the destination
  is already closed. `computeReopen(r)` (`REOPENMODEL` markers) draws the
  `ReopenSecs` retries at exact multiples, the `MaxFailure` tripwire that disables
  the destination for good, the unshipped-redo area with an MB readout off the
  redo-rate slider, catch-up at 5× the generation rate, and the FSFO disarm
  marker — t = 0 in MaxAvailability (unsynchronized immediately), t =
  `FastStartFailoverLagLimit` in MaxPerformance. With **no observer deployed**
  there is nothing to disarm, and the marker, its chip and the caption all say
  so — "not enabled in this topology", never "disarmed at". Controls: reopen
  interval, max failures, outage length, redo rate. Footnote 4 on the page lists
  the idealizations; `diagrams/README.md` repeats them.

Chapter 4, upper half (`#ch-config`, section `#deployview`) makes the whole page
configurable per deployment. Three static cards (never innerHTML-rendered, so
typing keeps focus): **Deployment identity** — a fifth state object
`ID`/`ID_DEFAULTS` (deployment name, DB unique names, hosts, observer host,
service, port, the three site labels `dc1`/`dc2`/`dc3`, subtitles); every
renderer reads it through
`idv(key)`, which trims and falls back to the fixture default on blank, and
every value is `esc()`-escaped on innerHTML/SVG paths (or set via
`textContent` into the `[data-name]` prose spans by `applyNames()`). Two rows on
that card are newer than the rest: **`#dep-obsloc`**, a `<select>` mirroring the
chapter-1 observer-location radio in both directions — the one field on the card
that changes what the page *draws*, rather than what it is called — and
**`#dep-dc3`**, the third site's label, which carries `data-i18n-skip` like every
other field whose placeholder is a fixture default. `#dep-host-o`'s placeholder is
translated prose and is deliberately worded location-neutrally: it is never
rewritten at runtime to name the current site, because the i18n attribute sweep
would clobber the write on the next `setLang`. Where the observer runs rides in
the config file's `sim` block, not `params` — the broker has no property that
records it.
**Data Guard parameters** — the same `C`/`A`/`K`/`R` state the chapter 1–3
rails edit, synced both ways: field listeners write state and mirror the rail
control; `syncDeployForm()` at the end of `draw()` refreshes every field that
is not `document.activeElement`, and mirrors the gates (ping fields need the
checkbox, lag limit is MaxPerformance-only). `K.netTimeout` (default 30,
bounds 1–120) is edited only here and is **presentation-only**: it lands in
the dest card's `NET_TIMEOUT` and must never enter `computeCommit`, a
failover clock, or the broker-properties table. **Save, share, reuse** —
versioned JSON (`{v:1, deployment:{...}, params:{...}, sim:{...}}`; `sim`
holds the chapter 1–3 what-if knobs) with file export/import
(Blob / FileReader, inline `#dep-msg` errors, never `alert()`) and a share
link that packs the JSON base64url-encoded into `#cfg=`. `applyConfig()`
starts from the defaults, whitelists keys, clamps numbers against the
canonical control's min/max/step and ignores unknown keys. Persistence:
debounced save to localStorage `dg-fsfo-cfg-v1` at the end of every `draw()`;
boot precedence is `#cfg=` hash > localStorage > defaults, and an applied
hash is stripped via `history.replaceState` (it is read once at load only, so
`#ch-*` anchor navigation is unaffected). "Reset everything" restores all
five state objects, clears the stored key and strips the hash. The config
pill registers `.dep-cards` as a workbench, which hides the pill while the
chapter 4 cards are on screen.

Chapter 4, lower half (section `#configview`) is the configuration written
out: four live code cards — the DGMGRL broker session, the observer start, the
hand-set `LOG_ARCHIVE_DEST_2` equivalent, and chapter 3's `tnsnames.ora` — all
regenerated by `renderConfig()` at the end of every `draw()` from C, K, R and
the shared `buildTns()` builder (no model function of its own; pure
presentation). Fixture names: primary `prm01` on `dc1-prm01`, standby `sby01`
on `dc2-sby01`, service `app_svc` — these are **defaults, not literals**: every
name-bearing renderer reads them through `idv()` (see chapter 4 above), so a
configured deployment substitutes its own names everywhere at once. Values
differing from documented defaults
are highlighted; the DGMGRL cards are transcripts, so their grey commentary is
parenthetical and unprefixed (DGMGRL has no comment syntax to imitate), while
the init.ora/tnsnames cards use real `#` comments. Verified command facts
behind it (sources in `diagrams/README.md`): the FSFO clock properties and
both `ObserverPing*` are configuration-wide (`EDIT CONFIGURATION SET
PROPERTY`), `LogXptMode`/`NetTimeout` are per-database (`EDIT DATABASE ... SET
PROPERTY`), protection mode is `EDIT CONFIGURATION SET PROTECTION MODE AS
MAXAVAILABILITY|MAXPERFORMANCE`, and `START OBSERVER IN BACKGROUND` is the
documented preferred observer start. The dest card omits `NET_TIMEOUT` under
ASYNC (it bounds the SYNC ack wait and never affects sessions under ASYNC) and
is framed as the hand-set equivalent — never claim it is the literal string the
broker composes. **The observer card carries the placement**, because the broker
has no property that records it: the third site is annotated as the HA guide's
first recommendation, the standby's site as the documented last resort ("on its
own host, as isolated from the standby as possible"), and the primary's site in
the `bad` tone as a placement Oracle does not list — arguable only where the
application tier is local too, and even then the guide prefers the standby's site
or a third one. With **no observer deployed** there is no session to write down
at all: the card is the manual `FAILOVER TO` and the note that it is always
available, observer or not, and the broker card drops the four
`FastStartFailover*` property commands and `ENABLE FAST_START FAILOVER` while
keeping `LogXptMode` and the protection mode — the properties exist, nothing arms
them.

Chapter 5 (`#ch-side`, "Side topics") holds the three things that sit beside the
mainline story, in the order *prepare · measure · what happens when it breaks*.
`#sduview` is static: SDU sizing for SYNC, the `SEND_BUF_SIZE`/`RECV_BUF_SIZE`
socket buffers and the BDP arithmetic behind them, and Oracle's `oratcptest`
network probe (whose output is where the buffer sizes are read back), with two
config cards (`cfg-sdu`, `cfg-oratcp`) that get their Copy
buttons from the config-card wiring for free, because it runs document-wide over
`.cfg-copy`. Their panes are hand-written and deliberately use `<standby-host>`
placeholders rather than the `idv()` fixture names — a static pane cannot follow
a configured deployment identity, so it does not pretend to. `#impactview` is
static too: a hand-authored containment drawing (reusing `tl-svg tx-svg`, plus
one added fill token `.b-vi`), the wait-event cards and a table of the AWR
metrics to capture before and after enabling SYNC. `#nettimeoutview` is the
NET_TIMEOUT explainer, moved here from chapter 2 unchanged apart from its
eyebrow and its new id. The facts and the phrasing constraints behind all of it
are in `diagrams/README.md`; the load-bearing ones are in the accuracy rules
above.

The simulator is live at davidbudac.cz/dataguard; run `./site/publish.sh` to push
changes (see Publishing above). Before publishing simulator changes, verify both
themes and the key states first — and, when the change touches prose, both
languages (see Languages below): defaults, isolated scenario, MaxPerformance with lag > limit
(blocked banner), ping properties set (threshold grayed out, ~1.1 s detection);
observer-lost defaults (flat lanes, Unobserved callout, failover-clock controls
grayed, each with a pill naming the reason) and switching back out of it (no
control left stuck disabled and no pill left behind); switchover
defaults (verify/convert/catch-up/role-change bands, the downtime brace, the
Role reversal callout, the four grayed controls), switchover in MaxPerformance
with lag > limit (the refusal banner, flat lanes, no downtime), and switching
back out of switchover (again, nothing left disabled and every note restored) — in the
app view: defaults (lucky 60 s hang), defaults + threshold 90 (ORA-12514
banner), Tuned preset (discrete retry ladder), Refused + RETRY_COUNT 100
(aggregated band), blocked (budget exhausted, "never" chip), observer-lost
(no-event state), switchover at the defaults (the give-up banner about half a
second in) and switchover with the Tuned preset (it rides through, with the
wasted tail between the open and the connecting pass), switchover refused
(no-event state with its own wording) — in the commit view: SYNC at RTT 0 (local write is the whole
commit), FASTSYNC (ack lands before the standby's write finishes), ASYNC (the
wait bar disappears, plus the conflict warning under MaxAvailability in 19c and
the "allowed" caveat chip under 26ai) — and in
the reopen view: defaults, a tripped `MaxFailure` (disabled banner, no
reconnect), a short reopen interval against a long outage (dense ticks
aggregate), and MaxAvailability vs. MaxPerformance (disarm marker at t = 0 vs.
at the lag limit) — and in the config chapter: defaults (every `(default)`
marker present, no highlights), MaxPerformance (the `FastStartFailoverLagLimit`
line replaces the not-evaluated note), ping properties on (the two
`ObserverPing*` lines plus the threshold-ignored math), ASYNC under
MaxAvailability (red mismatch note under 19c; the allowed-since-26ai note under
26ai), FASTSYNC under MaxPerformance (red
MaxAvailability-only note), observer lost (red note in the observer card), and
non-default reopen/max-failure values flowing into `REOPEN`/`MAX_FAILURE` —
and in the deployment chapter: a storage-free load renders identically to the
defaults, typing in a chapter 4 field keeps focus while everything redraws,
identity values flow into the topology strip / tnsnames / DGMGRL cards / dest
card / app view with hostile markup neutralized (`<b>x&y</b>` as a DB name
renders as literal text), a cleared field falls back to its placeholder
default, NetTimeout 45 highlights in the dest card under SYNC and disappears
under ASYNC, export → reset → import round-trips, a `#cfg=` link applies on a
fresh load and strips itself from the address bar, reload restores the last
state, "Reset everything" clears it, and a garbage import shows the inline
error without touching state — and in the side-topics chapter: the two new Copy
buttons put their pane's text on the clipboard, the containment drawing and the
AWR table render in both themes and both languages, keys `6` and `7` open Side
topics and Reference, and the two cross-links (chapter 2's commit caption to
`#impactview`, the reopen caption to `#nettimeoutview`) open the other chapter
*and* land on the section.

**Observer placement, its own pass** — the axis is 24 states, so walk the cells
that carry the lessons rather than all of them. Crash at each of the three
deployed locations draws **identically** (a separate-host observer survives the
database's death), so read the three timelines against each other and confirm the
only difference is the primary-site placement warning in the readout. Partition
with the observer at the standby's site is the false failover: the standby is
promoted *and* the primary stalls and aborts, both on one drawing — against the
same partition at the third site, where nothing happens at all and the primary
keeps serving. Standby site down at the standby's site is the catastrophic cell:
`STALLED` from t = 0, the self-abort at the threshold, no failover ever, and the
standby lane hatched — against the same scenario anywhere else, where the primary
simply carries on unprotected. With **none**, check the whole gray-out set at
once, the observer-lost radio included (it is `disabled`, not just ignored), the
empty "not deployed" observer lane, the manual-failover chips — and then **switch
back to a deployed location and confirm nothing is left disabled and every note
is restored**, the same borrow-and-restore trap the observer-lost and switchover
scenarios already have. Switchover at all four locations: the bands, the clocks
and the app ladder must be byte-identical, with exactly one appended sentence
differing per location. Finally the topology strip in every cell: the dashed site
rectangles, the hatched site under standby-site-down, the third site's rectangle
appearing and disappearing with the placement, and no orphaned observer box under
`none`.

URL state and chrome, same pre-publish pass: move three controls and
`location.search` shows exactly those keys; reload restores the identical
state; Reset defaults leaves a bare URL with no `?`. The placement keys are
public contract like the rest: `ol=none|dc1|dc2|dc3` and the two new scenario
tokens `sc=part` / `sc=dc2d`. Hostile params behave
(`?th=999` clamps to 120; `?th=abc`, `?sc=bogus`, `?ol=bogus`, `?ps=7` are
ignored; `?sc=obs&ol=none` lands on the coercion the rail performs, a plain
crash); an old link or `#cfg=` file carrying no `ol` at all restores exactly as
it did before the control existed, at the third site;
`?pm=perf&lag=45#ch-app` lands on chapter 3 in a blocked MaxPerformance.
Drag a slider for 20 s and the console shows no `replaceState` rate warning.
Click at least one demo button per chapter: the controls take the demo's
values, the URL becomes its permalink, and the jump lands the workbench just
under the chapter bar. Focus a slider in a collapsed rail (note appears,
disappears on blur) with an `.is-warn` note visible elsewhere, in both themes.
After a publish, `curl -s https://davidbudac.cz/dataguard/ | grep -E
'og:image|canonical|theme-color|rel="icon"'` finds all four.

## The edition switch (19c / 26ai)

The header carries a second toggle beside the language switch: **19c / 26ai**. 19c is the
default and the page's source reading; 26ai is a second dimension layered over it, built
from three mechanisms — one for state, one for prose, one for structure.

**State: DG owns the edition, exactly the way it owns the language.** `DG.setEd` /
`DG.ed()`, resolution order `?ver=` → `localStorage['dg-ed']` → 19c, unknown tokens
normalized out of the URL on load, and `ver` deleted from the query while the edition is
19c — a link carrying no `ver=` is the page exactly as it was before the switch existed.
The edition is a **reading preference, not a control**: there is no `ver` key in the URL
IIFE's `FIELDS` table, no entry in the workbench `DEFAULTS`, and saved/shared
configurations do not carry it. The single bridge to the models is one line at the top of
`draw()` — `C.version = window.DG.ed()` — which is what keeps "Reset defaults" and an
imported file from flipping the reader's edition. `computeFsfo` and `computeReopen`
default `c.version` to 19c internally (the same pattern as `observerLoc`), which is the
whole back-compatibility story for old links, stored configurations and export files.
An edition flip takes the language's own refresh path (`setStatic` first, then every
`onLang` subscriber), so `draw()` repaints from one subscription — but unlike a language
flip it *is* a state change, and `C.version` sits in the redraw signatures so the fade-in
fires.

**Prose: the `V26` source-string substitution table inside `DG.t()`.** Registered via
`DG.addVariants(map)` from the static-translation IIFE, beside the markup the keys are
copied out of. Under 26ai, `t()` first replaces the 19c English source string with its
V26 value and only then consults the Czech catalog. Three consequences: the 26ai English
variant is **itself a catalog key**, so Czech translates the 26ai sentence in its own
right; a missing variant degrades to the 19c text; a missing translation degrades to
26ai English. **V26 keys must byte-match the decoded snapshot strings.** For anything the
static pass reaches through its CSS selectors the key is the *decoded* innerHTML — an
`&mdash;` in the markup is a real U+2014 in the key, spelled `\u2014` in the ASCII-only
fragment (entities do not decode inside a script). Editing an English sentence that has a
variant therefore means editing three places in the same commit: the markup (or `t()`
call), the V26 key, and the matching keys in `simulator/i18n/cs.json`. A stale V26 key
fails silently — the page just shows the 19c sentence under 26ai, which is what the
headless coverage probe (Languages below) surfaces.

**Structure: the `.fsfo.is-v26` / `data-ver` split.** Whole blocks that exist in only one
edition — reference-table rows, captions — carry `data-ver="19"` or `data-ver="26"` in the
markup, and the static pass toggles
`is-v26` on `.fsfo` *before* it renders strings, so one pass never leaves the two halves
disagreeing. The CSS is keyed with `:not()` (`.fsfo:not(.is-v26) [data-ver="26"]
{display:none}` and the inverse) so a page with no script is a complete 19c document —
the same contract as the tabs. Print carries whichever edition is on screen, because here
the class selects content, not navigation.

**What 26ai adds behaviorally.** The MaxAvailability lag policy (radios `lp-zero` /
`lp-bounded`, URL key `lp`), which is what gives `FastStartFailoverLagLimit` a
MaxAvailability role — `lagPolicy` in, `availBounded` / `lagGated` out of `computeFsfo`,
and the one 26ai change that moves a number on the page. The `FastStartFailoverLagType`
radio and `FastStartFailoverLagGraceTime` slider (URL keys `lt` / `lgt`) — broker
properties, so unlike the edition they **do** ride in the `params` block of saved
configurations. The **transport-lag slider** (`#c-translag`, URL key `tla`, state
`C.transportLag`, `sim` block of saved configurations — a what-if, not a broker property):
visible only under 26ai MaxPerformance with TRANSPORT selected (hidden like the ping
sliders, never grayed); `computeFsfo` gates readiness, the loss bound and `ifDiedNow` on
it there (`gateLagSeconds` in every return), clamps it to the apply lag, and falls back to
the apply lag when the input is absent — the whole back-compatibility story for pre-slider
links and exports. `computeCommit` takes `version`: ASYNC + MaxAvailability is
`modeConflict` under 19c and `modeAllowed26` under 26ai (the prerequisites list ASYNC
there; Task 3 is stale). The reopen panel's LAGGING bands
(`lagStallAt`/`lagStallMax`/`lagGraceArmed` from `computeReopen`, which now also takes
`version`, `lagGraceTime`, `threshold` and `fsfoEnabled` — passed false when no observer
is deployed, and both LAGGING outputs stay null then). Under 19c these controls gray out
through `V19_NOTES` (borrow-and-restore, like observer-lost) — the transport-lag slider
hides instead — and `computeFsfo` pins
`lagStall:null` / `lagType:'apply'` / the zero-loss policy whatever a crafted link or a
26ai-written export asks for; the TRANSPORT echo additionally requires MaxPerformance,
per the property's documented scope.

**The outcome matrix stays 24 cells in both editions.** `site/test.mjs` pins that with
19c-invariance loops (`version` absent/`'19c'` must reproduce the 24-cell table with
`lagStall:null` and `lagType:'apply'`, with every 26ai-only input passed in), and
`diagrams/README.md` words it. Change one and change all three.

There was once a fifth, 26ai-only observer placement — an observer beside each database,
`dc1dc2`, ranked by `PreferredObserverHosts`, with a `nomination` flag on the model. It was
removed deliberately (two of its six cells were inferences rather than quoted outcomes):
do not reintroduce it. A stale `?ol=both` or a saved `observerLoc:'dc1dc2'` degrades
silently to the third site through the existing unknown-value fallbacks — the `FIELDS`
radio map ignores tokens it does not know and `serialize()` then drops the stale param,
and the `applyConfig` whitelist drops values it does not list.

## Languages (English + Czech)

The page ships in English and Czech, chosen with an `EN` / `CZ` toggle in the
header. **English is the source language and the only one in the fragment.**
Czech lives in `simulator/i18n/cs.json`, which `site/build.mjs` inlines into the
built page's `<head>` as `<script type="application/json" id="dg-i18n-cs">`. That
split exists because the fragment must stay pure ASCII (CLAUDE.md) and a Czech
catalog spelled in `\uXXXX` escapes would be unmaintainable; the wrapper declares
the charset, so the JSON block can hold real accented characters. Consequence:
opening the raw fragment on its own gives English and hides the toggle.

**Catalog keys are the English source strings**, not invented ids. A string with
no entry falls through untranslated — which is exactly what keeps the technical
vocabulary English, and it means adding English prose never breaks the Czech
page, it just leaves that sentence English until someone translates it.

### What is translated and what is not

Translated: prose, headings, captions, control labels, chip labels and
sub-lines, bar and brace labels in the drawings, screen-reader summaries, the
grey commentary inside the config cards, `title`/`aria-label` text.

**Never translated** — a Czech reader must be able to match every term against
the Oracle documentation: property names (`FastStartFailoverThreshold`,
`ReopenSecs`, …), `LOG_ARCHIVE_DEST_n` attributes, protection modes
(`MaxAvailability`), transport modes (`SYNC`/`FASTSYNC`/`ASYNC`/`AFFIRM`/
`NOAFFIRM`), Oracle statuses (`STALLED`, `UNSYNCHRONIZED`, `PRIMARY UNOBSERVED`),
`ORA-` numbers, view and column names, DGMGRL and SQL, the fixture names
(`prm01`, `app_svc`, `dc1-prm01`), and the role words *primary*, *standby* and
*observer*, which Czech DBAs use in English anyway. Also untranslated on purpose:
the numeric slider-scale labels, and parameter values like `on`/`off`/`TRUE`.

### The mechanism

- `window.DG` (first `<script>` on the page, before the markup): `t(source, …)`
  translates and substitutes `{0}`, `{1}`, …; `tp(forms, n, …)` picks a plural
  form; `dec()` is the decimal separator; `setLang`, `lang()`, `onLang(cb)`.
  Resolution order is `?lang=` → `localStorage['dg-lang']` → English, and an
  unknown token is normalized out of the URL on load.
- **Sentences are keyed whole and take placeholders** — never concatenated from
  fragments, because Czech puts the numbers elsewhere than English does. When you
  add a sentence built from a condition, give each branch its own full key rather
  than gluing a translated tail onto a translated head.
- **Plurals**: Czech has three cardinal forms (1 / 2–4 / 5+) to English's two.
  A countable string carries its forms `|`-separated on both sides of the
  catalog: `tp('{0} retry|{0} retries', n, n)`. `site/test.mjs` checks this.
- **Numbers**: `fmt()` swaps `.` for `,` under Czech. The config cards do not go
  through it — their values are integers, so no Oracle syntax is ever touched.
- **Static markup** is translated by the block sitting between the markup and the
  models. It snapshots the English out of the DOM *once*, by CSS selector, and
  every later pass renders from that snapshot, so a translated string can never
  become the source for the next translation. It is placed there, and
  `DG.setLang` runs it before the `onLang` subscribers, because the models own a
  dozen control notes and headings that also exist in the markup — the models
  have to win.
- **Script-injected chrome** (the Notes buttons, the config pill, the demo
  buttons) is invisible to that snapshot, so each of those blocks re-applies its
  own labels from an `onLang` callback.
- **The editable identity is not translated.** `ID_DEFAULTS` (`prm01`, `app_svc`,
  `DC 1`, `production`, `failover target`) round-trips through the export file
  and the share link, so a Czech value there would be wrong. Chapter 4's inputs
  whose `placeholder` *is* that fixture default therefore carry
  `data-i18n-skip`, which excludes only their placeholder from the attribute
  sweep — the two prose placeholders ("unnamed &mdash; …") still translate. Where
  a sentence names one of these values, the value arrives as a `{n}` placeholder
  (`t('Nowhere — nothing publishes {0}', idv('service'))`), never baked into the
  key. The identity card's `<select>` **option texts do** go through the sweep
  (`.dep-row select option` is in the selector list): the observer-placement
  names are prose, while the Oracle vocabulary in the other selects
  (`MaxAvailability`, `SYNC`) is simply absent from the catalog and falls through
  unchanged — which is the whole reason that selector is safe.
- Adding a section: put its prose in the markup and its JS strings in `t()`, then
  re-run the extraction below and translate the new keys.

### Extracting and verifying

There is no extraction script in the repo — the reliable way is to ask the page,
because it knows which strings a given state actually asks for. `DG.missing()`
returns every key looked up with no translation. Build, then load
`_site/index.html` in headless Chrome with a probe appended that stubs
`requestAnimationFrame` (the render loop wedges otherwise), calls
`DG.setLang('cs')`, walks the key states, and dumps `JSON.stringify(DG.missing())`
into the DOM for `--dump-dom` to pick up. Everything it reports must be a term
from the never-translated list above. "The key states" is now a **loop over all
24 scenario × observer-location cells** (dispatch real `input` *and* `change`
events on the radios — nothing outside the first IIFE may call into the models),
plus both protection modes on the cells where the mode changes the story, the
ping properties, `FastStartFailoverPmyShutdown` off where the primary stalls, and
chapter 4 open at each of the four locations, whose config cards and identity
rows carry strings no other state asks for. Since the edition switch, the walk
runs in **both editions** (`DG.setEd('26ai')`, then back): the lag-policy radios
in MaxAvailability, the two lag controls (`FastStartFailoverLagGraceTime` at 0
and ≥ 5, `FastStartFailoverLagType` both ways, in MaxPerformance) and the 26ai
config cards all ask for strings 19c never does — and the V26 substitution means the
26ai English variants are catalog keys of their own.

Three things that only a rendered page catches, all worth re-checking after
translating: **lane labels live in a fixed 124 px gutter** (13 px for the name,
10 px for the sub-line) and a longer Czech string silently clips off the left
edge — `Primary transport` had to become `Transport primary`, not
`Transport na primary`. **Rail headers wrap** when the eyebrow plus the
buttons exceed 270 px, which is why `Reset defaults` is `Výchozí` and not
`Zpět na výchozí`. And where a label is built through **`fitLabel`**, the source
offers a ladder of candidates from longest to shortest and **every rung is its
own catalog key**: translate them all, and keep the short rungs genuinely short
(`not deployed` → `nenasazen`), or the ladder falls through to the bare value.
Verify a `cs` → `en` round trip too: dump the DOM after
`setLang('cs'); setLang('en')` and diff it against a plain English load. They
must match except for the `is-new` fade-in class, which the language switch
deliberately does not re-add.

## Process that produced this (worth repeating)

1. Verified every parameter default and semantic against Oracle docs before
   designing anything.
2. Wrote one shared spec (domain facts + visual language + per-deliverable
   requirements), then ran two opus-tier subagents in parallel from it — one for
   the static SVGs, one for the simulator.
3. Review pass on top: rendered everything (headless Chrome / both themes /
   edge states), checked domain claims sentence by sentence, fixed wording, and
   only then published and delivered.

Keep that order: facts → spec → build → adversarial review → publish.

## Conventions

- Nothing is committed without the user asking. Commit messages end with
  `Co-Authored-By:` per the harness rules.
- Changing a documented default or a model formula means changing
  `site/test.mjs` in the same commit — the test gate exists to make the
  accuracy rules executable, not to be worked around.
- Scenarios covered so far: primary crash, isolated primary, severed link
  between the two database sites (`partition`), whole standby site lost
  (`dc2down`), observer lost and planned switchover — each crossed with the four
  observer locations, 24 states in all. Only the first two have static figures;
  the other four are simulator-only, and the figures show the third-site
  placement throughout. Reinstate stays out of
  scope for the figures and the simulator; if the user asks for it, add it as a
  new figure/scenario rather than crowding the existing ones. Exception: the
  test runbook (`testing/README.md`) uses `REINSTATE DATABASE` / auto-reinstate
  as drill *cleanup* so drills are repeatable — that does not document the
  mechanism and does not lift the out-of-scope rule.
