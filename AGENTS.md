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
| `diagrams/README.md` | Figure embeds, broker-property and redo-transport-property tables with verified defaults, the ping-properties quirk, the verified-facts sections behind the simulator's commit/reopen/observer/side-topics views, the drawing idealizations, Oracle doc links |
| `simulator/fsfo-simulator.html` | Source fragment of the interactive simulator, published at davidbudac.cz/dataguard. English only |
| `simulator/i18n/cs.json` | Czech translation catalog, keyed by the English source strings. Real UTF-8 — deliberately outside the ASCII-only fragment |
| `testing/README.md` | Test runbook: step-by-step drills verifying each documented situation against a real 19c configuration (crash, isolation, observer loss, NET_TIMEOUT, blocked failover, reopen/MaxFailure, client view, commit measurement), with an RTO/RPO probe harness and reinstate cleanup. Repo-only markdown — not part of the published site |
| `site/build.mjs` | Wraps the fragment into a full page (doctype, charset, title, favicon, canonical + social meta), inlines `simulator/i18n/cs.json` as a JSON `<script>`, and enforces the ASCII-only guard — it exits non-zero on any byte above U+007E |
| `site/test.mjs` | Standalone node test: extracts the four model marker blocks from the fragment and asserts the documented domain invariants, then checks the Czech catalog for dropped placeholders, unbalanced inline markup and bad plural forms. No dependencies; `node --test site/test.mjs`. `site/publish.sh` runs it after the build, so a model that contradicts the docs cannot be deployed |
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
- `ObserverPingInterval` default 100 ms; `ObserverPingRetry` default 10.
  Documented quirk: when BOTH are explicitly set, the threshold is ignored for
  the observer's detection. The isolated primary's own stall clock still uses
  the threshold. Detection is stated in every asset as
  pingInterval × (pingRetry + 1) — the first failed ping plus its retries,
  ≈ 1.1 s at the minimums (the docs say only "nearly 1 second"). Docs gap: the 19c properties reference does not list these two
  properties (they exist since 12.2); cite the 21c+ edition for them.
- `FastStartFailoverLagLimit` default 30 s, min 5 s, MaxPerformance only.
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
- **Switchover** (the planned role reversal, simulator scenario four): zero data loss in
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
  ADDRESS; `CONNECT_TIMEOUT` per ADDRESS, no default (HA guide example 90 s);
  `RETRY_COUNT` default 0 (extra traversals of the whole list), `RETRY_DELAY`
  no default; `FAILOVER` default on; `LOAD_BALANCE` default off inside an
  ADDRESS_LIST. Role-based services make the standby refuse instantly with
  ORA-12514. These parameters affect only NEW connections, never established
  sessions. Nominal drawing constants (footnote 3): refusal 0.2 s, OS refusal
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
  promotes a backup observer automatically (12.2+), with `SET MASTEROBSERVER TO`
  as the manual override. The "three" is 19c-specific — later releases allow
  more, so do not carry the number across editions.

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
blocked when MaxPerformance and lag > lag limit; the isolated primary's abort
always uses the threshold. `computeFsfo` also has an `observer-lost` branch
(below) returning `observerLost` and `ifDiedNow`, and a `switchover` branch
returning `switchover`, `tDown`, `tConvertEnd`, `downtime` and `tRestartDraw`.

The page is split into six chapters — `#ch-clocks`, `#ch-transport`, `#ch-app`,
`#ch-config`, `#ch-side`, `#ch-reference` — each a `<section class="chapter">` wrapper that opens with a
screen-reader-only `h2` (class `chdiv-t sr`, the `aria-labelledby` target and
the translation hook; the old visible divider bands are gone) and is listed
in the sticky `<nav class="chapnav">` sitting between the hero and chapter 1.

**Prose is opt-in.** In the visual sections the `.sec-hd` header and intro
caption sit *below* the workbench/drawing (chapter 4's card sections keep
theirs on top — moved below, a header reads as the next block's label), and an
"Explanations" toggle next to the language switch (`#prose-toggle`, state in
`localStorage['dg-prose']`, off by default) hides every `.sec > .sec-hd`,
`.sec > .notes` grid and static `.sec > .caption` (those without an `id`;
dynamic state captions all have ids). Exempt: the Reference chapter (its
headers caption tables) and print (a printout always carries everything).
The hide rules key on `.prose-managed`, added only by the toggle's script, so
without JS nothing is hidden — the same contract as the tabs.

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
wrappers. Prose that points at another chapter uses an `<a class="xref">`; a
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

The workbench carries four scenarios. The third, **observer lost**, kills the
only observer host at t = 0: the primary keeps serving because it still reaches
the target standby, the standby keeps applying, and no fast-start failover is
possible at all — so every control that governs a failover clock grays out, the
lanes stay flat, and the "What the timeline shows" grid explains why
nothing happens. Its `ifDiedNow`
value is what the primary's death during the blind window would cost.

The fourth, **switchover**, is the only planned event on the page: t = 0 is the DBA issuing
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
the outcome.

The "application's view" section (`#appview`) has its own pure function
`computeApp(a, m, scenario)` between `/* APPMODEL:START */` and
`/* APPMODEL:END */` — it consumes computeFsfo's output and simulates one
worst-case connection request walking the two-address descriptor's retry
ladder (per-pass toll min(TCT, CT) on the dead address, instant ORA-12514 from
the standby, RETRY_DELAY between traversals, success once a traversal reaches
address 2 at/after tOpen). Attempts collapse into an aggregated band when they
would be subpixel; horizons past ~160 s clip with a "gives up at" annotation.
The isolated scenario forces drop (partition = no refusals); the observer-lost
scenario returns `noEvent`, since nothing ever moves for a client to notice. Its
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
  `FastStartFailoverLagLimit` in MaxPerformance. Controls: reopen interval, max
  failures, outage length, redo rate. Footnote 4 on the page lists the
  idealizations; `diagrams/README.md` repeats them.

Chapter 4, upper half (`#ch-config`, section `#deployview`) makes the whole page
configurable per deployment. Three static cards (never innerHTML-rendered, so
typing keeps focus): **Deployment identity** — a fifth state object
`ID`/`ID_DEFAULTS` (deployment name, DB unique names, hosts, observer host,
service, port, site labels, subtitles); every renderer reads it through
`idv(key)`, which trims and falls back to the fixture default on blank, and
every value is `esc()`-escaped on innerHTML/SVG paths (or set via
`textContent` into the `[data-name]` prose spans by `applyNames()`).
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
broker composes.

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
grayed) and switching back out of it (no control left stuck disabled); switchover
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
wait bar disappears, plus the conflict warning under MaxAvailability) — and in
the reopen view: defaults, a tripped `MaxFailure` (disabled banner, no
reconnect), a short reopen interval against a long outage (dense ticks
aggregate), and MaxAvailability vs. MaxPerformance (disarm marker at t = 0 vs.
at the lag limit) — and in the config chapter: defaults (every `(default)`
marker present, no highlights), MaxPerformance (the `FastStartFailoverLagLimit`
line replaces the not-evaluated note), ping properties on (the two
`ObserverPing*` lines plus the threshold-ignored math), ASYNC under
MaxAvailability (red mismatch note), FASTSYNC under MaxPerformance (red
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

URL state and chrome, same pre-publish pass: move three controls and
`location.search` shows exactly those keys; reload restores the identical
state; Reset defaults leaves a bare URL with no `?`. Hostile params behave
(`?th=999` clamps to 120; `?th=abc`, `?sc=bogus`, `?ps=7` are ignored);
`?pm=perf&lag=45#ch-app` lands on chapter 3 in a blocked MaxPerformance.
Drag a slider for 20 s and the console shows no `replaceState` rate warning.
Click at least one demo button per chapter: the controls take the demo's
values, the URL becomes its permalink, and the jump lands the workbench just
under the chapter bar. Focus a slider in a collapsed rail (note appears,
disappears on blur) with an `.is-warn` note visible elsewhere, in both themes.
After a publish, `curl -s https://davidbudac.cz/dataguard/ | grep -E
'og:image|canonical|theme-color|rel="icon"'` finds all four.

## Languages (English + Czech)

The page ships in English and Czech, chosen with an `EN` / `CS` toggle in the
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
  key.
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
from the never-translated list above.

Two things that only a rendered page catches, both worth re-checking after
translating: **lane labels live in a fixed 124 px gutter** (13 px for the name,
10 px for the sub-line) and a longer Czech string silently clips off the left
edge — `Primary transport` had to become `Transport primary`, not
`Transport na primary`. And **rail headers wrap** when the eyebrow plus the
buttons exceed 270 px, which is why `Reset defaults` is `Výchozí` and not
`Zpět na výchozí`. Verify a `cs` → `en` round trip too: dump the DOM after
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
- Scenarios covered so far: primary crash, isolated primary, observer lost and
  planned switchover (the last two are simulator only — there is no static figure
  for either). Reinstate stays out of
  scope for the figures and the simulator; if the user asks for it, add it as a
  new figure/scenario rather than crowding the existing ones. Exception: the
  test runbook (`testing/README.md`) uses `REINSTATE DATABASE` / auto-reinstate
  as drill *cleanup* so drills are repeatable — that does not document the
  mechanism and does not lift the out-of-scope rule.
