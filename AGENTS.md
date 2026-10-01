# Agent handoff — dataguard_doc

This repo documents Oracle 19c Data Guard. It carries **two** pages and the
assets around them. The one being worked on is the workbench in `app/` — a
topology simulator you draw a Data Guard configuration in, break, and watch the
clocks of — a TypeScript/Vite/Preact application with a pure domain engine,
served at **https://dataguard.davidbudac.cz/**. Beside it, frozen, sits the page
it grew out of: the single-file fast-start failover (FSFO) explainer in
`simulator/`, still served at **/dataguard/legacy/** because every link the
handover document and the Confluence page ever handed out points there. This file tells a future agent what exists, how it was
produced, and how to extend it without breaking consistency or accuracy.

## What exists

| Path | What it is |
|---|---|
| `diagrams/fsfo-timeline-crash.svg` (+`.png`) | Swimlane timeline, primary host crash: detection → threshold → failover execution |
| `diagrams/fsfo-timeline-isolated.svg` (+`.png`) | Swimlane timeline, network partition: two independent threshold clocks, primary self-abort (split-brain protection) |
| `diagrams/fsfo-sequence.svg` (+`.png`) | Sequence diagram of the crash case with an elapsed-time gutter |
| `diagrams/fsfo-net-timeout.svg` (+`.png`) | Two panels separating NET_TIMEOUT (redo transport) from the broker failover clocks |
| `diagrams/README.md` | Figure embeds, broker-property and redo-transport-property tables with verified defaults, the ping-properties quirk, the verified-facts sections behind the commit/reopen/observer/placement/side-topics views (including the 24-cell observer-placement outcome matrix) and behind the 26ai edition switch (the MaxAvailability lag-limit semantics and Oracle's self-contradiction on them, `PrimaryDatabaseCandidates`, `V$FS_FAILOVER_OBSERVERS`), the drawing idealizations, Oracle doc links. Its *Topology features* section points at `app/design/facts.md` for far sync, cascading, RedoRoutes, multi-target and multi-observer sources |
| `app/` | The workbench: TypeScript + Vite + Preact + signals. A pure, DOM-free engine in `app/src/engine` (types, citation catalogue, validation rules, redo-graph resolver, epoch-loop simulator, generators, the legacy adapter), the interface in `app/src/ui` (including the on-canvas action bar, the Introduction page and the `Hints` toggle — see `app/design/ui.md` §3c–§3i; §3h is how the drawing is driven: click selects, `⋯` for the bar, drag-to-place, inline rename, marquee, shortcuts; §3i is the lean pass: the toolbar is the one add surface, Remove sits in the rail header; "Simulate's two layouts", at the end, is the Split and Lanes layouts of the Simulate screen and the switch between them), state in `app/src/state`, twelve presets in `app/src/presets`, ten lessons and the reference tables in `app/src/content`, 2883 vitest tests across 112 files in `app/src/**/__tests__` and `app/test`. Built to `_site/` and served at `/dataguard/`. Zero external requests, no inline script and no inline style — the page is meant to run under `script-src 'self'; style-src 'self'` |
| `app/public/collectors/` | Read-only SQL collector, optional Bash/SQL*Plus wrapper and run instructions for existing setups. The ⋯ menu's **Import existing setup** sheet previews pasted/file output before drawing it. `engine/collect.ts` maps current routes; imported `routesObserved` prevents invented NULL-default routes. Missing broker settings and placement assumptions remain in document notes. Validated live on a 19c primary + mounted standby (SYSDBA, local OS auth); wallet, least-privilege, RAC and far sync remain unverified. DGMGRL transcripts are not parsed. |
| `app/design/facts.md` | The verified Oracle fact sheet for the topology features (far sync, cascading, multiple standbys and FSFO targets, multiple observers, RedoRoutes, member types, destination counts), researched 2026-08-16 against docs.oracle.com and re-verified 2026-08-17, marked `[D]` / `[D-later]` / `[UNDOC]` / `[CONFLICT]` per claim. **The only permitted source of a "documented" claim in the application.** Its top-five traps are restated in the accuracy rules below |
| `app/design/engine.md` | The engine design: `Claim`/`Basis` labelling, the topology data model, the validation catalogue, the redo-graph resolver, the epoch-loop failure engine, the compat adapter and the 24-cell matrix gate, the generators, the module layout — plus §10, *Deviations from the design as built*, which is where the code and the specification differ |
| `app/design/ui.md` | The application architecture: premises carried over from the legacy page, project structure and the CSP goal, Document-vs-View state, the four modes, canvas layout/routing, timeline, the migration table from the six legacy chapters, and the taste notes. Its as-built notes (the mode-aware readout, the drawer's focus contract, the print pass) are the record of what the code does where it went past the design |
| `HANDOFF.md` | Situation report + work order for the next agent (state of the app, the in-flight UI polish brief, how to screenshot from a sandbox, known gaps, next steps). A snapshot — this file wins where they disagree |
| `app/README.md` | The short version of the three above: what it is, dev commands, structure, testing, deploy pointer |
| `simulator/fsfo-simulator.html` | **Frozen.** Source fragment of the page that used to be published at `/dataguard/`; now served at `/dataguard/legacy/`. English only, pure ASCII (see [CLAUDE.md](CLAUDE.md)). Bug-fix territory only — new work goes into `app/` |
| `testing/README.md` | Test runbook: step-by-step drills verifying each documented situation against a real 19c configuration (crash, isolation, observer loss, NET_TIMEOUT, blocked failover, reopen/MaxFailure, client view, commit measurement, plus four topology drills for far sync, cascading, multi-target and multiple observers), with an RTO/RPO probe harness and reinstate cleanup. Repo-only markdown — not part of the published site |
| `docs/agents/fact-check.md` | How to review the workbench against Oracle: the evidence rules (only docs.oracle.com, quotes matched by grep, both editions, a live system where there is one), the eight slices, the report format, and the traps the first review fell into. With it: `app/test/fact-check/probes.probe.ts` (one runnable scenario per finding, printing `OPEN` or `CHANGED`; run with `cd app && npx vitest run --config vitest.factcheck.config.ts`, never part of `npm test`), `citations.probe.ts` (every quote in the citation catalogue looked for on the page it cites; network, so only with `FACT_CHECK_ONLINE=1`), `fetch-docs.sh` and `totext.py` (the Oracle pages as greppable text, written outside the repo) |
| `SIMULATOR_FACT_CHECK_2026-10-01.md` | The second review, after RAC, the split-brain reading and the application's sessions landed: no live system, documentation and ~250 engine runs only. Its findings are open; its *Decisions needed* section (D5–D9) comes before any fix. It re-uses the 09-28 ids where a finding is still open, and its probes are the *2026-10-01 review* section of `probes.probe.ts` |
| `SIMULATOR_FACT_CHECK_2026-09-28.md` | The report of the first full review of `app/` against 19c and 26ai, with a read-only look at a live 19.27 configuration, **and what was done about each finding** (its *Resolution* section). The findings are fixed except where that section says a decision was taken instead — one role change per run, resynchronization drawn as immediate, the 19c edition meaning 19c as documented — and the accuracy rules below were corrected with them. A later review re-uses its finding ids |
| `site/build.mjs` | The site build, in three steps: `npm run build` in `app/` (which empties `_site/` and writes the hashed bundle), then `site/build-legacy.mjs`, then `assertNoInline(_site/index.html)` — a built page carrying a `<script>` with a body, an `on*=` handler or a `style=` attribute fails the build rather than the browser's content security policy. The guard proves it can fail (three fixtures it must reject, one it must accept) before it is trusted to pass |
| `site/build-legacy.mjs` | What `site/build.mjs` used to be: wraps the fragment into a full page (doctype, charset, title, favicon, canonical + social meta) and enforces the ASCII-only guard — it exits non-zero on any byte above U+007E, naming the offending lines. Writes `_site/legacy/index.html` and copies `diagrams/` to `_site/diagrams`, which both pages share |
| `site/smoke.mjs` | Dependency-free browser check of the built tree: serves `_site/` over `node:http`, loads it in headless Chrome (`--dump-dom`, console messages captured through `--enable-logging=stderr`), takes the page's own `data-permalink` for the `classic` and `far-sync-zero-loss` presets and reloads it cold — an untouched preset now carries no `#t=` at all, so the check accepts either a `#t=` document or a short link naming the preset (and asserts the latter is under 200 characters) — asserts the node cards, the timeline lanes and the outcome chip, opens each of the four modes by name, and checks that a published-page link (`?sc=iso&lat=2&lang=cs#ch-clocks`) upgrades into Simulate mode like any other old link, following *that* permalink cold to keep one real-browser `CompressionStream` → `DecompressionStream` round trip (an upgraded legacy link names no preset, so it must carry `#t=`). Probes HTTP first and falls back to an inlined single-file copy over `file://` where the machine's headless Chrome cannot fetch over HTTP. Exits non-zero on any failed check, any console message, or any file the page asked for and did not get |
| `site/test.mjs` | Standalone node test for the **legacy** fragment: extracts its four model marker blocks and asserts the documented domain invariants — including the scenario × observer-location outcome matrix as literal tables (24 cells, plus the 19c-invariance loops over the version axis). No dependencies; `node --test site/test.mjs`, 63 tests. The application reproduces the same 24 cells through its compat adapter (`app/test/legacy-matrix.test.ts`) |
| `desktop/` | The Tauri v2 desktop shell (macOS, Windows) around the workbench -- see *The desktop app* below. Not part of the published site; `.github/workflows/desktop.yml` builds it |
| `site/publish.sh` | Builds, runs the three test gates (`npm --prefix app run test`, `node --test site/test.mjs`, `node site/smoke.mjs`), deploys to the VPS, then verifies the public URL |

`_site/` is generated — never edit it, never commit it — and its shape is a
contract the deploy and the nginx configuration both depend on:

```
_site/
  index.html            the workbench; references one hashed bundle
  assets/index-*.js     the bundle, and style-*.css beside it (cssCodeSplit off)
  legacy/index.html     the frozen fragment, wrapped
  diagrams/             the four figures (SVG + PNG) and diagrams/README.md,
                        shared by both pages -- the og:image lives here
```

## Publishing

Both pages are served from the user's own VPS. To publish:

```bash
./site/publish.sh
```

It builds `_site/` (application first, because the Vite build empties the
directory; then the legacy page into the tree it leaves behind), runs three
gates in the order that fails fastest, tars the result over ssh to
`root@dbhetz-ubu26:/var/www/dataguard` (unpacking beside the live tree and
renaming it in, so a half-uploaded tree is never live), and then verifies the
public URL.

The three gates, and what each one can catch that the others cannot:

1. `npm --prefix app run test` — the application's own suite (**2883 tests
   across 112 files**): the engine's invariants, the 24-cell matrix through the
   compat adapter, the validation catalogue, the generator goldens, the canvas
   and timeline geometry, the URL and file round trips.
2. `node --test site/test.mjs` — the same kind of assertion against the legacy
   fragment's four model blocks, which still ship (63 tests).
3. `node site/smoke.mjs` — the built bundle in a real browser. The only gate
   that can catch a page that builds, passes every unit test and does not run.
   It serves `_site/` over loopback and probes first whether the headless
   Chrome on the machine can fetch over HTTP at all; where it cannot (seen with
   Chrome 151 on the dev box: the socket opens and the request never goes out,
   for a one-line page and for example.com alike), it says so and checks the
   same bundle inlined into one file over `file://`, verifying asset serving
   statically instead. Either way it exits non-zero on a failed check.

Verification after the upload compares **the bundle, not the page**: the script
re-fetches the public URL, requires HTTP 200 from `/` *and* from
`/legacy/`, reads the hashed `assets/index-*.js` the served page asks
for, and fails unless that file comes back byte-equal to the one just built.
The HTML itself is a few hundred bytes of head that a CDN may minify or
re-encode, while the hashed asset changes with every byte of source — so the
asset is the honest witness that what is live is what was built. `--dry-run`
builds and tests without deploying. Overridable via `DG_HOST`, `DG_DEST`,
`DG_URL`.

Old links keep working, two different ways. Anything pointing at
`/dataguard/legacy/` lands on the frozen page. A link to `/dataguard/` itself is
upgraded by the application on load: the legacy query keys become a topology and
the six chapter anchors become modes and panels. A `?lang=cs` left over from the
Czech reading the site used to have is ignored.

Two things to know:

- **Publishing is explicit.** It is not a side effect of `git push`.
  Committing changes nothing about what is live until you run the script.
- **The script ships the working tree, not `HEAD`** — deliberately, so you can
  preview an edit on the real URL before committing. It prints a warning when
  `app/`, `site/`, `simulator/` or `diagrams/` has uncommitted changes; read
  that warning.

### nginx, and the one change the server still needs

Both pages are served by their own virtual host, **`dataguard.davidbudac.cz`**,
on the VPS; the old path `https://davidbudac.cz/dataguard/…` answers with a 301
to the same path on that host (query string included), which is what keeps
every link the handover documents ever handed out alive. The vhost sets its own
security headers rather than including `snippets/dbudac-headers.conf`, because
two CSP headers are enforced as their intersection and the shared snippet would
silently break whichever page needs more.

**TODO for the operator — not something an agent can do from this repo.** The
vhost's CSP still carries `'unsafe-inline'` for scripts and styles, inherited
from the days when the single-file page *was* the site. The application needs
none of it: it has no inline `<script>`, no `on*=` handler and no `style=`
attribute, and `site/build.mjs` fails the build if one ever appears. Once the
header below is in place the policy is the one `app/design/ui.md` §1 specifies,
and the guard in the build is what keeps it true:

```nginx
# /  -- the workbench. No inline anything; site/build.mjs enforces it.
add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'" always;
```

The legacy page is one inline `<script>` and cannot live under that policy, so
it keeps its own **nested** location with the old header:

```nginx
# /legacy/  -- the frozen fragment. One inline <script>, by design.
location ^~ /legacy/ {
    add_header Content-Security-Policy "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'" always;
}
```

A nested `location` replaces the parent's `add_header` set entirely rather than
adding to it, so the nested block must repeat every header the parent sets, not
just the CSP. Note that on that box the enabled config under
`sites-enabled/` is a **regular file, not a symlink** — the `sites-available/`
copy is stale, so edit the enabled one. Until the header is changed the
application still works; it is simply running under a policy laxer than the one
it was built for.

Two earlier publishing routes are retired — do not resurrect either:

- A Claude artifact, retired 2026-07-29 (do not republish as an artifact).
- GitHub Pages (`.github/workflows/pages.yml`), removed 2026-07-30 when the repo
  went private. The ASCII guard that lived in that workflow now lives in
  `site/build-legacy.mjs`, which `site/build.mjs` runs, so it still runs on
  every publish.

### Pre-publish checklist

`./site/publish.sh --dry-run` is the automated half. The rest is looking at the page, because
none of the three gates can see a drawing that is wrong. Walk it in **both
themes** and **both editions** — the theme toggle and the 19c/26ai toggle are in
the top bar, and both are reading preferences that survive a reload:

- **All four modes on the classic preset.** Topology: select a member, edit a
  property, undo it, watch the issue list and the steady-state readout follow;
  then press a scenario in the dock, watch the cards take their state, scrub the
  small timeline and press *Detailed timeline*. Detailed timeline: the lanes, the
  settings column, a grip dragged, the outcome on the bar. Config: all seven tabs render, Copy works, hovering a
  generated line highlights the member it belongs to. Learn: the lesson list,
  a "Show me" step, and the workbench beside the prose reacting to it.
- **Every preset opens.** Twelve of them (`classic`, `observe-only`,
  `far-sync-zero-loss`, `far-sync-ha-pair`, `far-sync-role-change`,
  `cascade-terminal`, `priority-alternates`, `multi-target-three-observers`,
  `rac-primary`, `rac-standby`, `bystanders`, `max-protection`). Each one draws without a
  crossing link or a caption over a card, opens at the protection level it was
  configured in, and raises only issues that are true of it.
- **The share link round-trips.** Copy it, open it in a fresh tab, and get the
  same document — including injected events and canvas drags. Then check the
  honest refusal: a document too large for a link says so and points at Export.
- **Legacy links.** `?sc=iso&lat=2#ch-clocks`, `?pm=perf&lag=45#ch-app` and a
  `#cfg=` payload each land on the right mode and panel with the knobs applied,
  and the address bar is rewritten to the canonical URL. `?lang=cs` upgrades like
  any other old link, and `/dataguard/legacy/` itself still serves the frozen
  page.
- **Both themes, both editions, and the narrow shell.** Nothing hidden by CSS
  alone; every gray control still carries the pill saying why; the drawer and
  the sheet still close on `Escape` and hand focus back; below 768 px the
  read-only card says editing needs a wider screen, once, not four times.
- **Print.** `Ctrl+P` on Config: all seven panels stack, the citation chips
  wrap rather than pushing the page sideways.
- **After the deploy**, `curl -s https://dataguard.davidbudac.cz/ | grep -E
  'og:image|canonical|theme-color|rel="icon"'` finds all four, and
  `curl -sI https://dataguard.davidbudac.cz/legacy/` still returns 200.

## The desktop app (desktop/)

`desktop/` wraps the workbench in a **Tauri v2** shell for macOS and Windows. It
adds no page of its own: `frontendDist` is `_site/` as `node site/build.mjs`
builds it (the whole site, so the `legacy/` and `diagrams/` links resolve), and
`devUrl` is the Vite dev server on port 5179.

- **Toolchain.** Install Rust with [`rustup`](https://rustup.rs) (stable; the
  dialog plugin needs 1.90+). On Windows also the WebView2 runtime (already on
  Windows 11) and the MSVC build tools.
- **Run and build.** `cd desktop && npm install && npm run dev` (hot reload
  against Vite) or `npm run build`. Installers land in
  `desktop/src-tauri/target/release/bundle/` (`macos/*.app`, `dmg/*.dmg`,
  `nsis/*.exe`, `msi/*.msi`); `npx tauri build --debug` writes under `target/debug/`.
  `npm run icon` regenerates `src-tauri/icons/` from `desktop/app-icon.png`
  (rendered from the favicon in `app/index.html`; `app-icon.svg` beside it).
- **Version.** `tauri.conf.json` reads it from `app/package.json`. To release:
  bump that, commit, tag `v<version>` and push the tag; `.github/workflows/desktop.yml`
  then builds the universal macOS and the Windows installers and opens a draft
  release. Without a tag (`workflow_dispatch`) the installers are workflow artifacts only.
- **Unsigned.** No Apple or Windows signing is configured (placeholders are
  commented in the workflow), so the installers trigger Gatekeeper (right-click,
  Open) and SmartScreen ("More info", "Run anyway") warnings.
- **The shims.** The page detects the shell through `window.__TAURI__`
  (`withGlobalTauri`), read in exactly one place, `app/src/ui/common/desktop.ts`.
  **Desktop-only code goes through that module and nowhere else, never under
  `app/src/engine`, and adds no npm dependency to `app/`**; with the global
  absent every path is the browser's own. What it covers: downloads (`downloadBlob`,
  `exportDoc`, the collector links) go through a native save dialog (Rust
  command `save_file`) because `<a download>` does nothing in a webview; Share
  builds the link against `PUBLIC_URL` (`https://dataguard.davidbudac.cz/`)
  because the page's own origin is `tauri://localhost`; the report prints through
  `print_page` (WKWebView ignores `window.print()`); `<a target=_blank>` and
  citations open in the system browser (`on_new_window`, `on_navigation` in
  `lib.rs`); pop-outs work because `on_new_window` returns
  `NewWindowResponse::Create`, which keeps the opener that `popout.tsx` renders
  through (needs Tauri 2.8+, pinned `=2.12.0`).
- **CSP.** The web page's policy is an nginx header; the shell sets the same one
  in `app.security.csp`, plus `connect-src 'self' ipc: http://ipc.localhost`
  (Tauri's IPC, and the collector fetch). Change one, change the other. The
  webview gets only the `save_file` and `print_page` commands (`build.rs`, autogenerated into `permissions/`, which is git-ignored;
  `capabilities/default.json`); the dialog and opener plugins are used from Rust
  only, so they need no JS permission.

## Accuracy rules (non-negotiable)

All domain claims were verified against the Oracle 19c/21c Data Guard Broker
documentation (links in `diagrams/README.md`). Key facts, which every asset must
agree on:

- `FastStartFailoverThreshold` default 30 s, min 6 s. The clock starts when the
  observer FIRST loses its connection to the primary. Failover requires BOTH the
  observer and the target standby to have lost the primary for the threshold,
  plus the standby's readiness check (synchronized in MaxAvailability/
  MaxProtection; apply lag ≤ `FastStartFailoverLagLimit` in MaxPerformance).
  **Readiness is state, not a snapshot of the sliders.** Oracle: "either the
  observer or target standby database may allow the primary database to continue
  redo generation after first recording that a fast-start failover cannot
  happen", and fast-start failover cannot occur if "the target standby database
  was not synchronized with the primary database at the time the primary
  database failed". So a standby that was cut off while the primary kept
  committing is `UNSYNCHRONIZED` (or `TARGET OVER LAG LIMIT`: the lag grows
  while it receives nothing), and a later primary failure gives **no**
  fast-start failover. Never draw a zero-loss failover to a standby the primary
  had been running without.
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
  (The 21c and 26ai chapters also say "Set both these properties to achieve a
  primary failure detection time of 1 second", which is 100 ms × 10: quote it
  beside the model.)
  **The two properties do not exist in 19c.** They are absent from the 12.2, 18c
  and 19c property pages, chapters and command references, and from a live 19.27
  system (neither name is in the `dgmgrl` or `oracle` binary, nor in
  `SHOW CONFIGURATION VERBOSE`); they are first documented in 21c. An earlier
  revision of these rules said they "exist since 12.2" — that was wrong. Under
  the 19c edition the workbench greys them, raises
  `FSFO.PING_PROPS_NOT_IN_19C` on a document that carries them, never emits
  them, and detects on the threshold. The frozen legacy page still offers them
  under 19c; the compat adapter reproduces that through `SimParams.legacyPingUnder19c`,
  which nothing else may set.
  **26ai defaults contradiction:** the 26ai property pages give the broker
  defaults as 0 — not set, detection governed by the threshold — while the
  26ai FSFO chapter's table still shows 100 ms / 10. The simulator's 26ai
  defaults column shows "0 — not set" and its caption names the
  disagreement; never write "defaults identical in 26ai" unqualified. The
  explicitly-set minimums stay 100 ms / 10 in every edition.
- `FastStartFailoverLagLimit` default 30 s, min 5 s, MaxPerformance only **under
  19c — and the 19c documentation contradicts itself on it**: the 19c property
  page says so, while the 19c fast-start failover chapter says "For zero data
  loss in maximum availability mode, the FastStartFailoverLagLimit property must
  be set to zero" and prints `Lag Limit: 0 seconds` in a MaxAvailability example.
  A live 19.27 system in MaxAvailability prints `Lag Limit: 30 seconds (not in
  use)`, which is what the 19c edition draws — as a `conflict`, with both
  citations, and with Oracle's spelling `(not in use)`. The MaxAvailability role
  **arrived in 21c** (21c change list and chapter), not in 26ai; only the
  per-mode default of 0 is 26ai. A document that never set the property follows
  the edition's broker default (`lagLimitOf(doc)`), so a MaxAvailability preset
  is `ZERO DATA LOSS` under both editions.
  **Under 26ai it also applies in MaxAvailability, where the broker default
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
  `FastStartFailoverLagType`, `FastStartFailoverLagGraceTime` and
  `PrimaryDatabaseCandidates` are documented as new in 26ai and are absent from
  the 19c and 21c property pages — but all three are in the property list of a
  live 19.27 system. The 19c edition is **19c as documented**: it greys them,
  and says "documented from 26ai; observed in the property list of a 19.27
  system, which Oracle's 19c documentation does not mention". Never write that
  observation as documentation.
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
  documented. (The property is present on a live 19.27 system; that is an
  observation, and is labelled as one.)
- **`PRIMARY UNOBSERVED` is a target-standby status** (broker Table 5-1, and the
  chapter's worked example): the primary shows `FS_FAILOVER_STATUS` =
  `SYNCHRONIZED` with `FS_FAILOVER_OBSERVER_PRESENT` = `NO`, and the target
  standby is where `FS_FAILOVER_STATUS` reads `PRIMARY UNOBSERVED`. Never put
  `PRIMARY UNOBSERVED` on the primary. The status needs the standby to still
  have "connectivity to the observer", so it belongs to a lost *link* between
  primary and observer, not to a dead observer. Fast-start failover **disabled**
  reads `DISABLED` — a third state, not "unobserved".
- **A manual failover with FSFO enabled is conditional, not free.** "You can
  perform a manual failover even if fast-start failover is enabled" holds only
  where the target is the `FastStartFailoverTarget` standby, that standby is
  synchronized (MaxAvailability/MaxProtection) or within the lag limit
  (MaxPerformance), and "the observer is started and communicating with the
  target standby database", with the primary shut down first ("You must ensure
  that the primary database is shut down prior to performing a manual
  failover"), only to the **current** target ("The failover can only be
  performed to the current target standby database" — the same holds for a
  switchover, `ORA-16655`), and never `IMMEDIATE` ("You cannot perform an
  immediate manual failover when fast-start failover is enabled"). So an *unobserved*
  configuration fails the third condition — `DISABLE FAST_START FAILOVER FORCE`
  first. Observe-only mode lifts these conditions (see below). Word the no-observer case as a manual failover needing no observer
  *while FSFO is disabled*, never as unconditionally available.
- **`FastStartFailoverAutoReinstate` is narrower than "the old primary returns".**
  It reinstates only after an observer-initiated failover caused by a primary
  crash or isolation — never after a user-configurable health condition or a
  `DBMS_DG.INITIATE_FS_FAILOVER` call — and needs Flashback Database on both
  databases, the former primary started and mounted (a manual restart when
  `FastStartFailoverPmyShutdown` aborted it), the master observer able to reach
  it, and static service names without Clusterware/Oracle Restart. The page draws
  the `reinstating` band (`REINSTATE.OPEN_BAND`) only from the first instant the
  former primary is running, the master observer reaches it **and** it reaches the
  new primary — "The master observer cannot connect to the former primary
  database" and "The former primary database cannot connect to the new primary
  database" are the broker's own restrictions — which may be never; until then
  `REINSTATE.WAITING` says why, once (an aborted one waits for a manual restart,
  nothing in a run restarts it). Reinstate
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
  Data Guard REST endpoints are documented from ORDS 21.1 onwards (an ORDS
  version, not a database release), so the row names both; the table caption's "including what arrived in 21c and 23ai" is what
  it leans on.
- `FastStartFailoverPmyShutdown` default TRUE: a primary STALLED
  (`V$DATABASE.FS_FAILOVER_STATUS`) longer than the threshold, unable to reach
  observer or target standby, **shuts down**. That is the broker guide's verb
  ("the primary database will shut down after FastStartFailoverThreshold seconds
  has elapsed if redo generation has been stalled…"); the HA guide says the same
  thing as "causing it to abort". Both are Oracle's; what the reader sees uses
  the broker guide's, and never "aborts itself" as if the broker pages said it.
- **A former primary that restarts never opens after a role change while fast-start
  failover is enabled.** "To allow the master observer to automatically reinstate the
  former primary database, the database must be started and mounted. It will
  not be allowed to open in any event if fast-start failover is enabled."
  (`ORA-16649`). That sentence is about a former primary that *restarts*: draw it
  mounted and needing reinstatement; never draw two databases open read-write
  because a host came back. With fast-start failover disabled the 19c pages do not
  spell out what state a restarted former primary is left in, so mounted is this
  page's reading under 19c (`FAILOVER.FORMER_PRIMARY_MOUNTED`, `model`); the 26ai
  Scenario 11 does spell it out ("Because a role transition occurred while the old
  primary was offline, Data Guard prevents the database from reopening and leaves it
  in a mounted state…", `FAILOVER.FORMER_PRIMARY_MOUNTED_26AI`), so under 26ai it is
  `documented`. Either way it is drawn open where it cannot reach the new primary,
  because nothing tells it — a `model` under both editions. **A stalled primary that
  is reached again without ever restarting** is drawn mounted as well, but as a
  `model` (`FSFO.FORMER_PRIMARY_NOT_OPEN` carries that basis then): the sentence is
  about a database that is *restarted*, and no page says a stalled, still-open primary
  is closed when contact returns.
- **A manual failover does not close a primary that is still open.** Oracle puts
  the shutdown on the operator ("ensure that the primary database is shut down",
  `FAILOVER.PRIMARY_SHUT_DOWN`; "shut down prior to performing a manual failover",
  `FSFO.MANUAL_FAILOVER_CONDITIONS`), and the engine raises
  `FAILOVER.PRIMARY_STILL_OPEN` (documented) at the command when it is still running. No page says the broker closes or mounts an old primary that
  is still open when a manual failover completes, and ORA-16649 is not about one that
  stayed open. So with **fast-start failover disabled** the old primary is drawn **open
  read-write, as primary, beside the new one** — whether or not the new primary can
  reach it — until something takes it down: a crash, a shutdown or abort event, or the
  end of the run. That is this page's reading of an undocumented gap
  (`FAILOVER.FORMER_PRIMARY_OPEN`, `model`, citing the two sentences as the reason);
  never write it as "the broker leaves it open", and never word the *former primary that
  restarts* above as this case. With **fast-start failover enabled** the target it was
  running with has just become the primary, so it has lost its target: it is drawn
  **stalled** from the completion instant and then follows
  `FastStartFailoverPmyShutdown` — aborted one `FastStartFailoverThreshold` later, or
  stalled for good (`FAILOVER.FORMER_PRIMARY_STALLS`, `model`, owner decision D5,
  2026-10-01, citing "Data Guard fast-start failover always guarantees that only one
  primary database exists" and the STALLED row's "It shuts down or stalls because it is
  likely a failover has occurred."). Nothing documented says it; never present it as
  Oracle's outcome. A fast-start-failover-initiated failover and a switchover are
  untouched: their old primary is the documented stall / abort /
  `FastStartFailoverPmyShutdown` path, and the converted one.
- **"Split brain" is this page's reading, never Oracle's word.** No Oracle page uses
  the term or gives an interval for it, so the Break readout's *Split brain* chip
  (`splitBrainOf`, `engine/sim/split-brain.ts`) is `model`, note `SPLIT_BRAIN.READING`, and
  asks one question of the drawing: were two members `open-rw` at the same moment. A
  STALLED primary is not counted (Oracle: its redo generation is stalled), and the old
  primary is drawn open where a manual failover found it still open with fast-start
  failover disabled (the rule above: reachable or not), so that reads *yes* with the
  window named, closed where the old primary crashes or shuts down; with fast-start
  failover enabled it is stalled, then aborted, and reads *no*. The chip is
  asked only where a new primary opens by failover or manual failover, so a switchover
  has none. Never write a
  *no* that says the old primary "cannot" be open: say what the drawing shows (aborted
  at N s, down, stalled, mounted), and never draw "at most one database ends up open" as
  unconditional (see the `FastStartFailoverLagLimit` rule above).
- **One role change per run.** The engine evaluates one failover or switchover
  and says so (`SIM.ONE_ROLE_CHANGE`) when later events would need a second.
  Oracle documents that fast-start failover stays enabled and the reinstated
  database becomes the new target; the page does not draw that. So after the
  role change the new primary has **no synchronized fast-start failover target
  yet** (owner decision D6, 2026-10-01): losing the observer and/or its standbys
  stalls and aborts nothing, it keeps processing transactions, and the run says
  why once (`FSFO.NO_TARGET_AFTER_ROLE_CHANGE`, `inferred` from "The reinstated
  database acts as the fast-start failover target for the new primary database…"
  and "While the configuration is in the unobserved state, fast-start failover
  cannot happen. Therefore, the primary database can continue processing
  transactions…"). A switchover's former primary is a standby from then on — never
  stalled or aborted as a primary.
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
- **Where the connect string is dialled from is this page's model, never a
  documented fact.** The published page dials from outside every data centre;
  the workbench dials from each application's card when the document has any (a
  configuration holds several, each with the connect string it has: its own, else
  the shared one). An
  address the application cannot reach gives no answer (a timeout), whatever the
  dead-address switch says. The application decides nothing about a failover —
  no clock or decision reads it — and the three costs below stay nominal drawing
  constants. `test/app-placement.test.ts` pins the placement outcomes; the
  published numbers stay pinned by `legacy-models.test.ts` on a document with no
  application, so neither may be "fixed" to match the other.
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
  illegal there. **The table is met by "at least one standby database"**, not by
  every destination: "the broker verifies that there is at least one standby
  database in the configuration that can support the desired grade of
  protection", so an ASYNC bystander beside a SYNC standby is legal in every
  edition. The per-member list in the fast-start failover prerequisites binds
  the target **and the primary** ("The current primary database must have its
  LogXptMode property set accordingly") — a primary left at ASYNC in
  MaxAvailability is what Oracle's own example refuses to switch over. FSFO cannot be initiated when FASTSYNC is in use and the
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
  to 1 — and so does the broker property for a member written inside a
  parenthesised RedoRoutes group, in 19c and 26ai alike). **26ai rewrote the
  semantics**: "If MAX_FAILURE is set to 1, no attempts are made to reactivate
  this archive destination when it fails. If MAX_FAILURE > 1, reactivation
  attempts are made until the number of consecutive failures is equal to the
  value of MAX_FAILURE" — the initial failure counts, the "manually reenabled"
  wording is gone, and every destination of a group must carry a non-zero
  value. What follows is the 19c wording; the engine, the reopen panel and the
  generated comments are edition-aware. At the limit the destination is disabled with no further access until
  it is MANUALLY reenabled — the network healing does not bring it back, and the
  destination is then treated as if `REOPEN` had not been specified. Whether a
  successful reopen resets the counter is NOT documented ("consecutive" implies
  it; do not state it as fact). Exception: 12.2+ GROUP/PRIORITY destinations
  re-enter service when found accessible. **Neither `ReopenSecs` nor `MaxFailure`
  is deprecated in 19c** — the 19c broker release-changes deprecation list names
  nine initialization-parameter-backed properties (`ArchiveLagTarget`,
  `DataGuardSyncLatency`, `LogArchiveMaxProcesses`, `LogArchiveMinSucceedDest`,
  `LogArchiveTrace`, `StandbyFileManagement`, `DbFileNameConvert`,
  `LogArchiveFormat`, `LogFileNameConvert`) and their 19c property rows carry no
  deprecation note (re-verified 2026-08-17); an earlier revision of these rules
  called them deprecated, and the legacy simulator fragment still does — do not
  copy that. The broker writes `LOG_ARCHIVE_DEST_n` itself from `MaxFailure`,
  `NetTimeout` and `ReopenSecs`, so the generated script sets them with
  `EDIT DATABASE … SET PROPERTY` on the receiving member; do not present
  `SET PARAMETER` as a route to `REOPEN` / `MAX_FAILURE` — nothing documents it
  as one. The 19c broker row for
  `MaxFailure` states only "the maximum number of contiguous archiving failures"
  and its default — always cite the sbydb `LOG_ARCHIVE_DEST_n` attributes page for
  `MAX_FAILURE` semantics, never the broker page. (The "Corresponds to: VALID_FOR"
  defect an earlier revision recorded for that row was not reproducible on
  2026-08-17 in the 12.2, 18c, 19c, 21c or 26ai pages, which all read
  "MAX_FAILURE attribute for the LOG_ARCHIVE_DEST_n initialization parameter".)
- **SDU** (chapter 5): the HA guide recommends 65535 **for synchronous
  transport only** — a best practice, never a requirement, and the guide says
  nothing about ASYNC, so neither do these assets. `DEFAULT_SDU_SIZE` defaults
  to 8192 under 19c (26ai: 8192 for clients, **65536 for servers**) with a
  documented range of 512 – 2097152 bytes. The HA guide's "its maximum value of
  65535" and the reference's range contradict each other: show both as a
  conflict, never call 65535 the parameter's maximum as fact, and never present
  2 MB as the recommendation. SDU is negotiated per
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
  NEITHER the observer NOR the target standby — **and only while a state change
  is left to confirm**. `STALLED` is shown when "the change to the
  UNSYNCHRONIZED state … or to the TARGET OVER LAG LIMIT state … cannot be
  confirmed by either the target standby database or the observer". Lost at the
  same instant, that is a stall; lost at different times it is not: "While the
  configuration is in the unobserved state, fast-start failover cannot happen.
  Therefore, the primary database can continue processing transactions, even if
  the target standby database fails", and the HA guide: "an observer or standby
  outage, or the outage of both at different times, does not impact the
  availability of the primary database". A primary that is already
  unsynchronized, already over the lag limit or already unobserved does not
  stall. While unobserved,
  `V$DATABASE.FS_FAILOVER_STATUS` = `PRIMARY UNOBSERVED` and
  `FS_FAILOVER_OBSERVER_PRESENT` = NO. `ORA-16820` (observer no longer observing
  this database) is the standing health condition; `ORA-16658` (unobserved
  fast-start failover configuration) is raised only when a failover is ATTEMPTED
  while unobserved — never use the two interchangeably; `ORA-16819` is the third:
  fast-start failover enabled and no observer started. 19c registers up to
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
  one of whose entries is "The master observer is not running" (the fourth; the list opens with "Fast-start failover is no longer enabled"). **Oracle
  allows fast-start failover to be enabled with no observer started** ("If you do
  not start the observer after you have enabled fast-start failover, the
  ORA-16819 warning is displayed for the primary and target standby
  databases"): that configuration is enabled and unobserved, and no failover can
  happen in it. The legacy page's "none" placement and the classic adapter draw
  fast-start failover as *disabled* there — a choice of that page, never to be
  worded as Oracle's rule — and then the
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

The topology features the workbench added — far sync, cascading, multiple
standbys, multiple FSFO targets, multiple observers — rest on a second verified
fact sheet, `app/design/facts.md`, researched 2026-08-16 against docs.oracle.com
and re-verified 2026-08-17. That file is the **only** permitted source of a
"documented" claim in the application, and every citation it carries is an entry
in `app/src/engine/citations.ts` (URL + the quoted sentence). The rules
condensed out of it:

- **A far sync instance is not a database and never becomes one.** Documented:
  it "manages a control file, receives redo into standby redo logs (SRLs), and
  archives those SRLs to local archived redo logs", and it "does not have user
  data files, cannot be opened for access, cannot run redo apply, and can never
  function in the primary role or be converted to any type of standby database"
  (19c C&A, *Creating a Far Sync Instance*). It has no broker *state*, no apply
  lag and no open mode, and its SRLs "cannot be shared with other databases".
  It needs an Active Data Guard licence. **Never draw a far sync edge as
  replacing the primary↔standby link**: the same chapter requires "a direct
  network connection between the primary database and the remote standby
  database … used to perform health checks and switchover processing tasks".
  Transport: primary→far sync SYNC (all committed redo on disk at the far sync)
  or ASYNC in MaxPerformance; far sync→terminal is documented as ASYNC — SYNC
  onward is undocumented, so word it "documented as ASYNC", **never
  "forbidden"**. Under FSFO the broker requires far sync SYNC or FASTSYNC and
  the target standby ASYNC. When the far sync dies, the documented remedy is an
  additional destination shipping straight to the terminal standby, and Oracle
  says plainly that "this does reduce the protection level because redo
  transmission is then in ASYNC mode instead of SYNC mode" — the *timing* of
  MaxAvailability's drop is a composition of that sentence with `NET_TIMEOUT`
  and is this page's model. How SYNCHRONIZED is computed across the far-sync hop
  is undocumented: label it a model. Protection modes are a **[CONFLICT]** — the
  C&A far sync chapter says "maximum performance or maximum availability", the
  19c broker FSFO prerequisites say a far sync instance "cannot be used in
  maximum protection mode or maximum performance mode", and 26ai drops only
  MaxProtection. Cite both sides and say which edition you are drawing.
- **Cascading has documented limits and one documented silence.** A terminal
  destination "receives primary database redo indirectly from a standby
  database"; only physical standbys cascade; real-time cascading needs Active
  Data Guard; a cascading standby feeds **up to 30 terminal destinations**.
  Transport out of the cascader is its own `LOG_ARCHIVE_DEST_n`: ASYNC on
  destinations 1–10 ships in real time, no mode or SYNC on 1–10 ships
  non-real-time, and 11–31 "operate only in ASYNC (real-time) transport mode".
  The **cascade depth limit is undocumented** — say so rather than inventing
  one, and whether protection mode counts cascaded destinations is likewise
  undocumented (the engine's "no" is an inference and is labelled).
- **A terminal standby is a legal manual failover target and an illegal
  fast-start failover one.** Documented, for the manual case, with its own
  warning: "no attempt is made to transmit any unsent redo from the cascader to
  the terminal standby" — draw that warning, never a silent success. The FSFO
  refusal is an **inference from two documented sentences**, not a literal
  prohibition: the target "must receive redo directly from the primary
  database", and the far sync feed is the one sanctioned exception. Never write
  it as a quoted rule; never drop the unsent-redo warning from the manual path.
  Switchover to a terminal standby is undocumented.
- **`FastStartFailoverTarget` takes a list, and the broker "selects a target
  based on the order in which they are specified".** Multi-target arrived in
  12.2. **Never write "the first viable target"** — order is what Oracle
  documents, and which candidate a given failure ends on is this page's model
  (`FSFO.TARGET_SELECTION`). The target changes **while the primary is alive**
  ("If the designated fast-start failover target develops a problem … the broker
  automatically changes the fast-start failover target to one of the other
  candidate targets"); once the primary is gone it cannot. 26ai says so
  outright: "Data Guard Broker cannot failover to second fast-start failover
  target if both the primary and first fast-start failover targets are down."
  19c is silent, so the 19c edition carries it as `doc-later`. Never draw a
  failover to a second candidate after the primary and the first were lost
  together. Also documented: the property takes member names or
  `ANY`; with more than one standby it must be set explicitly; "targets are
  verified when fast-start failover is enabled"; the reciprocal value is set on
  the target automatically; and it "can only be set to the name of physical or
  logical standbys. It cannot be set to the name of a snapshot standby database,
  far sync instance, or Zero Data Loss Recovery Appliance." `SHOW FAST_START
  FAILOVER` prints Active Target and Potential Targets with a per-target valid
  flag; `SET FAST_START FAILOVER TARGET TO name [NOWAIT]` retargets live.
  Bystanders follow `BystandersFollowRoleChange` (default ALL). How the observer
  treats a non-target standby is undocumented — it is documented as pinging the
  primary and the target only.
- **The "at least one synchronized standby" sentence belongs to two different
  pages, and only one of them is the C&A protection-modes page.** For
  **MaxAvailability** it is explicit there: "If the primary does not receive
  acknowledgement from at least one synchronized standby, then it operates as if
  it were in maximum performance mode." For **MaxProtection** that page does not
  spell it out; the wording lives on the 19c broker guide's configuration-members
  page — "the primary database will shut down, rather than continue processing
  transactions, if it cannot write its redo stream to at least one synchronized
  standby database" — so **cite the broker page for the MaxProtection case,
  never the C&A one**. Same page: "If only one standby database is supporting
  maximum protection mode, Oracle Data Guard broker will disallow the shutdown
  of the apply instance", and Oracle recommends a minimum of two standbys "to
  prevent a single standby database failure from causing the primary database to
  shut down". MaxProtection cannot be used when the only member receiving SYNC
  redo is a far sync instance, nor when the only standby is a snapshot standby;
  logical standbys are not supported in MaxProtection under FSFO.
- **RedoRoutes grammar, spelled the way the broker spells it.** `(redo source :
  redo destination)`; source `LOCAL | ANY | name[,name]`; destination
  `ALL [attr] | group[, group]`, a group being `name [attr]` or
  `( name [attr] [PRIORITY=n] [, name [attr] [PRIORITY=n]] )`; attribute
  `ASYNC | SYNC | FASTSYNC`. **`PRIORITY` belongs to a destination inside a
  parenthesised group, never to the group**: "there is one active redo path for
  each group", the usable destination with the lowest number; equal priorities
  are sticky ("Even after FS1 becomes active again, the primary continues
  shipping to FS2 because FS1 and FS2 have the same priority"); groups are
  independent and ship concurrently; the default is 1 for a far sync
  *destination* and 8 otherwise. All of that is documented (Examples 1–4), so
  only the instant the primary moves is this page's model. `ALL` "is an alias
  for all possible destinations" — snapshot standbys included, which receive
  and archive redo like any standby — and `ANY` "is an alias for any database in
  the configuration", the local one included.
  A source may appear in only one rule per member ("either explicitly or
  implicitly through use of the LOCAL keyword"); an unspecified attribute
  falls back to the destination's `LogXptMode`; the NULL default at a primary
  means `(LOCAL : ALL)`; "a redo routing rule is active if its redo source field
  specifies the current primary database"; "LOCAL … cannot be used at a far sync
  instance"; "the ASYNC redo transport attribute must be explicitly specified for
  a cascaded destination to enable real-time cascading". What is forbidden at a
  snapshot standby is *forwarding* ("cannot be configured such that … the
  snapshot standby would send redo data to another member"), not the property. **`PRIORITY=n` (n = 1…8, default 1 for far sync
  members and 8 otherwise) is a 19c fact** — it is on the 19c broker properties
  page word for word, together with "if a primary ships redo to a destination
  with PRIORITY=8, then it must ship to every PRIORITY=8 destination"; 12.1's
  `ALT=(name [xpt] [FALLBACK])` is the older spelling and is **12.1 only** —
  absent from the 12.2, 19c and 26ai grammar, so the page parses it for old
  documents, warns under both editions (`ROUTES.ALT_12_1_ONLY`) and never
  generates it. What `FALLBACK` does is documented on that 12.1 page.
  **`GROUP` is a `LOG_ARCHIVE_DEST_n` attribute, not RedoRoutes syntax** — it
  belongs in the generated `LOG_ARCHIVE_DEST_n` block and nowhere else. Which
  group a destination is in decides more than routing: a destination inside a
  parenthesised PRIORITY group re-enters service when it is found accessible
  (documented, 12.2+), while an ordinary one disabled at `MaxFailure` stays
  disabled until it is manually reenabled. 26ai adds "a member whose MaxFailure
  property is set to zero cannot be part of a RedoRoutes group"; that sentence
  is not on the 19c page, so it is a later-edition claim. Routes are
  **pre-declared in both directions and nothing rewrites them on a role change**
  — that is what the documented far-sync examples do, and it is why a standby's
  `(prm : x ASYNC)` rule is active *now* while its `(LOCAL : …)` rule waits for
  the role to change.
- **Member types, as a table, because the differences are the point.** Physical
  standby: cascades, may be an FSFO target, may be primary. Logical standby: does
  not cascade, may be an FSFO target, may be primary (and a RedoRoutes rule on
  one is documented only with a LOCAL **source**: "only if the redo source field
  is set to LOCAL", in 19c and 26ai alike). Snapshot standby: neither
  cascades nor may be a target. Far sync: forwards redo, never a target, never
  primary. Zero Data Loss Recovery Appliance: never a target.
- **Destination counts.** `LOG_ARCHIVE_DEST_n` runs n = 1…31; destinations 1–10
  take `LOCATION` or `SERVICE`, 11–31 `SERVICE` only. The cascading fan-out limit
  is **30 terminal destinations** — **never write "30 remote destinations"**,
  which is a different and wrong claim. The 253-members-per-configuration figure
  is documented in 19c and 26ai (*Managing Oracle Data Guard Broker
  Configurations*: "a broker configuration consisting of up to 253 members"); an
  earlier revision of these rules called it 12.1-only, which was wrong.
- **Multiple observers: three in 19c, four from 21c, and both 19c and 26ai
  contradict themselves.** The `ORA-16647` help page settles the numbers ("For
  Oracle Database releases 12.2 through 19c, a maximum of three observers can be
  started. For Oracle Database release 21c and later, a maximum of 4"); the 19c
  command reference's `START OBSERVER` entry nevertheless says "up to four
  observers". Name that conflict where 19c is on screen, as the 26ai one is. 19c: "There can be up to three observers for a single Data Guard
  configuration. One is the master observer and the others are backup
  observers." 21c and the 26ai FSFO chapter say four, and 26ai's `START OBSERVER`
  page says "you can register up to four observers" with `ORA-16647` for the
  refusal — while the 26ai `SHOW OBSERVER` page still says "up to 3", as does
  the 26ai `V$FS_FAILOVER_OBSERVERS` page ("returns three rows"). Draw the
  edition's number, name the conflict where 26ai is on screen, and never write
  "three observers" as an edition-independent fact. Also documented: "only the
  master observer can coordinate fast-start failover with Data Guard broker",
  and "when fast-start failover is disabled, no observer is called the master
  observer; all observers have the same functionality" — so a `MASTER` badge
  while FSFO is disabled is wrong. `SET MASTEROBSERVER TO name` exists, and its
  preconditions are documented: "the actual switch does not happen until the
  next time the primary contacts the target standby, usually within three
  seconds if fast-start failover is enabled", with the target enabled and not
  needing reinstatement and no role change, reinstatement or target switch in
  progress. `PreferredObserverHosts` (12.2+, **database scope**: `EDIT DATABASE`,
  never `EDIT CONFIGURATION`) ranks hosts 1–8, lower wins, default 8, broker
  default Null; under 19c "the change does not affect the location of the master
  observer until the next role change", under 26ai "The master observer will be
  changed automatically to an observer running on a higher priority host".
  `ObserverPingInterval`/`ObserverPingRetry`, `ObserverReconnect` and
  `ObserverConnectIdentifier` are the knobs; there is no `SET OBSERVER`
  heartbeat command.
- **`START OBSERVER` spells its file arguments `FILE IS`, never `FILE=`.** The
  foreground form is `START OBSERVER [name] [FILE IS f] [LOGFILE IS l]
  [TRACE_LEVEL IS …];`; the background form, which the documentation prefers,
  is `START OBSERVER [name] IN BACKGROUND CONNECT IDENTIFIER IS ci [FILE IS f]
  [LOGFILE IS l] [TRACE_LEVEL IS …];` — `IN BACKGROUND` directly after the name,
  the connect identifier **not optional**, and a wallet required. Each observer
  is started from a DGMGRL session on its own host. DGMGRL scripts have comment
  syntax (`-- text;`, `REM text;`, terminated by a semicolon), and the generated
  script uses it. `-logfile` deprecated since 12.2. `SHOW OBSERVER` "displays the observer name,
  the host name where the observer is running, whether the observer is the master
  observer, and the last time the observer pinged the primary and standby", and
  reports correct last-ping information only while FSFO is enabled.
- **Observe-only mode is documented and does not fail anything over.**
  `ENABLE FAST_START FAILOVER OBSERVE ONLY;` — "the primary database can be
  opened even if there is no acknowledgement from the observer or target
  standby", "you can switch over or manual failover to a bystander database",
  the observer log says "Unable to failover since this observer is in
  observe-only mode", and `V$DATABASE.FS_FAILOVER_MODE` reads `OBSERVE-ONLY`.
  It also lifts the manual-failover conditions: "Manual failover can be
  performed even if the pre-condition checks are not met", including an
  unsynchronized, lagging or unobserved configuration.
- **Under 26ai the `FS_FAILOVER_*` columns of `V$DATABASE` are deprecated** in
  favour of `V$FAST_START_FAILOVER_CONFIG`; name the view of the edition on
  screen. `SWITCHOVER … WAIT` is deprecated in 26ai in favour of `DrainTimeout`.
- **Three more spellings worth pinning.** `ConfigurationWideServiceName`
  defaults to `primarydbname_CFG` and "the service name does not change after a
  role transition" (19c, introduced 12.2). `TransportDisconnectedThreshold`
  (19c, broker default 30 s, 0 = no warnings) generates a **warning status**
  when the last communication from the primary exceeds it — it is never a
  failover clock. The 19c list headed "Fast-start failover cannot occur if:"
  opens with "Fast-start failover is no longer enabled"; "The master observer is
  not running" is its **fourth** of ten entries — never call it the first.

The traps that have caught this repo before, in one line each — `facts.md`
carries them as its top-five list: `FILE IS`, not `FILE=` · `GROUP` is a
`LOG_ARCHIVE_DEST_n` attribute, not RedoRoutes syntax · "selects a target based
on the order in which they are specified", never "first viable" ·
MaxAvailability's "at least one synchronized standby" sentence is on the C&A
protection-modes page and MaxProtection's is on the 19c broker members page, so
cite the right one · a terminal standby is a valid **manual** failover target
(with the unsent-redo warning) and fails the FSFO direct-redo prerequisite ·
and the observer count, which 26ai gives as four in its FSFO chapter and three
on its `SHOW OBSERVER` page.

When adding new claims, verify against docs.oracle.com first and note the
source in `diagrams/README.md`.

## Shared visual language

Lanes top to bottom: Primary, Observer, Standby. t = 0 is the failure event.
Phase colors (light-mode hexes; both pages map them to theme tokens):
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

## The topology simulator (app/)

`app/` is the current page: draw a Data Guard configuration, break it, watch the
clocks. It is TypeScript + Vite + Preact + `@preact/signals`, English only, with
zero external requests at runtime. The three design documents in `app/design/`
are the specification — `engine.md` for the domain engine (including §10,
*Deviations from the design as built*), `ui.md` for the application (including
its as-built notes), `facts.md` for the Oracle facts — and this section is the
map, not a replacement for them.

Commands, all from `app/`: `npm run dev` (Vite dev server), `npm run build`
(`tsc --noEmit` then `vite build`, straight into `../_site/`), `npm test`
(vitest, one pass), `npm run test:watch`, `npm run typecheck`.

### The engine (`app/src/engine`, pure and DOM-free)

Everything the page asserts is computed here, and nothing here touches the DOM,
does I/O, reads a clock or calls `Math.random`. `app/src/engine/__tests__/purity.test.ts`
walks the import graph and fails if `preact`, `@preact/signals` or a browser
global appears in it; `app/test/import-boundary.test.ts` keeps the layering
(the UI imports from `engine/index.ts`, never from a module deeper in).

- **Types** (`types/topology.ts`, `types/events.ts`, `types/trace.ts`,
  `types/claims.ts`). The authored document is `TopologyDoc`: sites, hosts,
  links, members (`DatabaseMember` | `FarSyncMember`), observers, one
  `Configuration` with its `FsfoConfig`, a shared `ClientDescriptor`, any number
  of `Application`s (a card each, dialled from; optionally with a descriptor of
  its own, read through `applicationClient`), environment
  params and the event list. Derived output — `RedoEdge`, `ResolvedMember`,
  `RedoGraph`, `Epoch`, `Lane`, `Segment`, `Trace`, `DerivedFacts` — lives in
  `types/trace.ts`, because it is output rather than something anyone authors.
- **Accuracy labelling is a data type.** `Claim<T> = { value, basis, cite[],
  note? }` with `basis` one of `documented` · `doc-later` · `conflict` ·
  `inferred` · `model`, and `Finding` (a validation or run-time issue) carries
  the same three fields beside its severity. A claim that is not `documented`
  must carry a note; a `documented` claim must carry a citation. `severity` and
  `basis` are orthogonal — an `error` can rest on a model, and often does.
  **This is the mechanism the accuracy rules run on**: an unlabelled model is a
  type error, not a review finding.
- **The citation catalogue** (`citations.ts`) is 220 entries of URL + the
  quoted sentence + which edition's page it is + `verified: 'primary' |
  'cross-edition'`. Some entries also carry `forbiddenFor`: a source the
  accuracy rules rule *out* for a named fact (`FORBIDDEN_FACTS` — the 26ai
  `FastStartFailoverLagLimit` property page for the mode question, the broker
  page for `MAX_FAILURE` semantics, `log file parallel write` for the
  max-not-sum rule, Task 3 for the MaxAvailability transports).
  `assertCitesAllowed(fact, cites)` throws when one is used there, and
  `app/src/engine/__tests__/citations.test.ts` walks every entry. Adding a
  documented claim means adding its citation here first.
- **The redo resolver** (`redo/parse.ts`, `redo/resolve.ts`). A
  recursive-descent parser round-trips the DGMGRL spelling of `RedoRoutes` in
  both dialects (12.1 `ALT=(… FALLBACK)`, 19c/26ai `PRIORITY=n`).
  `resolveRedoGraph` activates the rules whose source names the current primary,
  expands `ALL`, resolves each destination's transport (`dest.xpt ??
  receiver.logXptMode`), picks the priority group, walks BFS from the primary
  and returns edges with their role (`primary-direct`, `primary-to-farsync`,
  `farsync-onward`, `cascade`), each member's synchronized/counts-toward-ack
  `Claim`, and the configuration's protection level.
- **The failure engine** (`sim/*`) is an epoch loop over a closed-form kernel: the
  timeline is cut into epochs by external events and internal deadlines, the
  network and redo graph are constant inside an epoch, and each pending clock
  contributes one closed-form deadline. `simulate(doc, events, params)` returns
  a `Trace` — epochs, lanes, `Decision`s (one per branch, each carrying its
  `Claim`, which is what the prose is generated from), `DerivedFacts` and
  findings. `stateAt(trace, t)` is a binary search over the epochs, which is why
  scrubbing is free. `sim/dests.ts` is where the destination bookkeeping lives:
  REOPEN attempts counted per destination, `MaxFailure` disabling one for good,
  an alternate latching, a PRIORITY-group destination re-entering service.
- **The compat adapter** (`compat/classic.ts`) rebuilds the published 1+1+1
  deployment out of the general model — `classicTopology(knobs)`,
  `scenarioEvents`, `legacyComputeFsfo`, `toLegacyModel` — and
  **`app/test/legacy-matrix.test.ts` runs the legacy fragment's 24-cell
  scenario × observer-location outcome matrix against it, cell for cell, plus
  the stall table, the clock invariants and the 19c-invariance loops.** That
  test is the gate: the general engine may not "improve" on the verified
  outcomes. Change a cell there and you are changing `site/test.mjs`,
  `diagrams/README.md` and the fragment in the same commit, or you are wrong.
- **Validation** (`validate/*`) is 55 rules in one catalogue (`RULE_CATALOGUE`,
  one of them 26ai-only), each with an id, a severity, a permitted set of bases
  and its citations: far sync never primary, FSFO target kind and direct-redo,
  multi-target explicitness, the protection-mode/transport table, the RedoRoutes
  grammar rules, cascading restrictions, observer count and placement,
  destination ranges, the ORA-numbered edit refusals. `validate(doc)` returns a
  sorted `Finding[]`; the UI's issue list, the generated scripts' notes and the
  inspector's refusals all read that one list, so a rule is worded once.
- **The other three models** (`models/*`) are the ported legacy views:
  `computeApp` (the client's retry ladder over N addresses — dialled from an
  application's host when the document draws one, `computeApps` for every one of
  them, and from outside every site, as the published page dials it, when it does not), `computeCommit`
  (one commit under SYNC/FASTSYNC/ASYNC, `max(local write, remote ack path)`,
  the far sync hop terminating the commit) and `computeReopen` (the
  `ReopenSecs`/`MaxFailure` aftermath), plus `models/axis.ts`, which is the
  legacy tick-step and horizon arithmetic unchanged.
- **The generators** (`generate/*`) emit structured `Line`s rather than text —
  `cmd`/`note`/`comment`/`blank`, a tone, a highlight flag and `data-member`
  spans — which is what makes the Config panels able to cross-highlight
  against the canvas. Files: DGMGRL script, `LOG_ARCHIVE_DEST_n`,
  `tnsnames.ora` + JDBC, and the `SHOW CONFIGURATION` / `SHOW FAST_START
  FAILOVER` / `SHOW OBSERVER` mocks. Every mock block carries a generated header
  saying it is rendered from this page's model, and the undocumented spellings
  inside it are marked. Goldens in `app/test/__golden__/` pin five topologies.

### State (`app/src/state`)

**Document versus View.** The Document is what a share link, an export file and
undo contain: the topology, the events, the params and the canvas drag
overrides. The View is what a reload may forget: mode, selection, hover,
playhead, panel tab, lesson, theme, edition, drawer state, toast. `doc.ts` holds
the one `doc` signal, `view.ts` the view signals, `derived.ts` every computed
value in one file and one direction (`primaryId` → `issues` → `redoGraph` →
`geometry` → `trace` → `frame` → `readout` → the generated scripts). **No
component computes domain state locally.**

- **Undo/redo** (`history.ts`): immutable Document snapshots through
  `edit(label, fn, coalesceKey?)`, 700 ms coalescing per gesture, cap 100, and
  user-facing labels ("Undo: set LogXptMode to FASTSYNC on stby01"). Layout
  drags and event injection are edits; view state never enters history.
- **URL** (`url.ts`, `codec.ts`): the document rides the fragment as
  `#t=<base64url(deflate-raw(JSON))>`, with `#t0=` as the uncompressed fallback
  and `#cfg2=`/`#cfg=` read for older payloads. There is an 8000-character cap
  and an honest refusal when it is exceeded — the page says the document is too
  large for a link and points at Export, rather than handing out a truncated
  one. Query keys are human-readable and defined exactly once, in the
  `URL_FIELDS` table: `ed`, `mode`, `panel`, `sel`, `t`, `preset`, `lesson`,
  `step`, `theme`. Values are clamped on read and unknown tokens are ignored and
  then dropped from the address bar. The fragment is written **only when the
  Document differs from the preset it names** — compared by value on the codec's
  wire form (`isPristinePreset`), so `?preset=classic` alone is the whole address
  until the first edit and again after undoing back to it; `?preset=` stays on
  after an edit, as provenance. `canonicalTail()` is the one place that composes
  `?query#fragment`, so the address bar and the Share button cannot disagree.
  Writes go through a one-frame timer plus
  a 300 ms trailing debounce — WebKit rate-limits `replaceState` to roughly 100
  calls per 30 s and a scrub would trip it. A timer, deliberately not
  `requestAnimationFrame`: rAF stops in a background tab and never fires in a
  headless dump, and the permalink is a reading of the state that has to exist
  in both.
- **Saved configurations** (`workspaces.ts`, ⋯ menu): named copies under
  `dg-workspaces-v1` and the last 30 drafts that opening a preset, lesson,
  file or saved copy replaced under `dg-recovery-v1`, both validated through
  the import codec on read. Every "open" goes through
  `replaceWorkingDocument` → `history.replaceDoc`: one undoable step that
  carries the preset id, the saved copy (`activeWorkspaceId`) and -- only when
  it changed -- the edition; an ordinary edit never records the edition.
- **Compare alternatives** (`review.ts`, `ui/review/`, ⋯ menu): a baseline under
  `dg-review-baseline-v1`, compared with the document under one scenario, and
  the six scenarios run one by one; every value is labelled as this page's
  model. It prints through `?report=1` (`comparisonSection` → `report-model.ts`),
  never through a report generator of its own.
- **Persistence** (`persist.ts`): `dg-doc-v1` (the Document, debounced),
  `dg-theme` and `dg-ed` (the two reading preferences, same keys the legacy page
  uses, so a reader who set them there keeps them here). `dg-fsfo-cfg-v1`, the
  legacy page's key, is read once and migrated, never deleted. Every access is
  wrapped, because private-mode Safari throws on `localStorage`.
- **Legacy URL upgrade** (`legacy-url.ts`): the old query keys (`sc`, `ol`,
  `pm`, `th`, `ps`, `pi`, `pr`, `lag`, `ll`, `lt`, `tla`, `lgt`, `lp`, `rt`,
  `lat`, `xpt`, `rs`, `mf`, `tct`, `ct`, `rc`, `rd`, …, plus `ver` for the
  edition) become a topology
  through `migrateLegacyQuery`, and the six chapter anchors become a mode and a
  panel — `ch-clocks` → Detailed timeline, `ch-transport` → Config/Commit, `ch-app` →
  Config/Application view, `ch-config` → Config/DGMGRL, `ch-side` →
  Learn/SYNC transport, `ch-reference` → Learn/Reference. `#cfg=` payloads go
  through `migrateV1`. The canonical URL is then written with `replaceState`.
  `lang` is a recognised key and is ignored: there is no Czech reading any more.
  `app/test/ui/legacy-url.test.ts` and `legacy-anchors.test.ts` pin the mapping,
  and `site/smoke.mjs` checks one real published link end to end.

### The interface (`app/src/ui`)

Four modes — **Topology** (internal id `build`: the editable drawing with its
inspector, validation issues and steady-state readout, and, once something is
injected, the run on it: scenarios in the dock, break icons on the cards, the
cards tinted at the playhead and a small timeline underneath), **Detailed
timeline** (internal id `break`: no drawing, the lanes with a card at the head
of each, the settings column, the event list, the transport and the outcome),
**Config** (seven generated panels: DGMGRL ·
`LOG_ARCHIVE_DEST_n` · tnsnames/JDBC · SHOW · Application view · Commit ·
Reopen) and **Learn** (ten lessons: the six ported chapters plus Far sync,
Cascading, Multiple observers and targets, and RAC primary and standby). The ids
`build` and `break` are internal and stay (as do `BreakRail`, `ui/break/`, the
`m-build` / `m-break` classes); the address writes `mode=timeline`, leaves
Topology as the absence of the key, and reads `topology`, `build`, `timeline`,
`simulate` and `break`. `app/design/ui.md`, "Topology and the Detailed
timeline", is the as-built record of the re-cut, and says which earlier
sections it supersedes.

- **Canvas** (`ui/canvas/`): `layout.ts` ranks members by BFS over the resolved
  redo graph, columns them by site, packs rows and draws the site rectangles —
  pure and deterministic, so it has goldens. `routing.ts` routes the links with
  at most two bends, allocates channels per corridor, and places each link's
  caption on a four-rung ladder that keeps it out of cards, other captions, site
  rectangles and other links' lines. With three or more observers their lines
  run as trunks (task 5.2): the gap between the observer band and the member
  band opens to one lane per trunk (`Geometry.trunks`, pings plus one per
  readiness target), lines of one kind to one card share one channel per
  corridor (`bundleOf`), each caption prefers its line's own stretch, and a
  shared line is drawn from its card end so the dashes coincide.
  Routing and drawing both run in two passes
  (every route, then every caption; every line, then every card, then every
  caption) so a caption is never painted over by a line routed after it.
  `app/test/ui/canvas-presets.test.ts` holds all twelve presets to the collision
  rules and to a geometry golden. A data centre's box is the bounding box of
  its cards unless it has a size of its own: `layout[siteId]` may carry `w`/`h`
  (a handle resize, or a card drop that would otherwise shrink it), measured
  from the box's natural anchor and never smaller than its cards; Tidy resets it.
  A card the layout placed slides down out of the way of one moved by hand
  (`makeWay`, step 7b); a data centre grown by a hand move or a resize pushes
  the columns beside it so every corridor keeps its width (`columnPush`, step
  7c: growth to the right pushes right, to the left pushes left); and where a new standby, far sync or observer goes when
  no data centre is named is `ui/build/placement.ts`. The box is drawn with
  `LAYOUT.colPad` (24) round its cards and may be resized down to
  `LAYOUT.fitPad` (14). **The application** is a card of its own under the
  member band, in the primary's data centre to start with (several stand side
  by side): one dash-dot
  `connect` line to every database on its ADDRESS_LIST, coming up onto the
  card's bottom edge, and a lane between the member band and the application
  (`Geometry.midLaneY`) for the redo routes that would otherwise run through
  it. A document without an application draws none of this
  (`app/design/ui.md`, "The application on the drawing").
- **Timeline** (`ui/timeline/`): `build.ts` is a pure
  `buildTimeline(trace, topology, view) → TimelineModel`; the component maps it
  to VNodes. Lane order is primary, observers (master first, and no master at
  all while FSFO is disabled), far syncs, then standbys in BFS order with
  cascaded ones indented. Under them, when the document draws applications,
  each one's point of view: `Service`, `Sessions` and `New connections`
  (`timeline/app-lanes.ts`, pure, from `computeApps`), on the same axis — which
  stretches to the application's reconnect — and labelled as this page's model.
  The playhead is its own component subscribing to `tNow` alone.
- **Panels** (`ui/panels/`): the generated files, rendered from the engine's
  structured lines, with copy buttons and line ⇄ canvas cross-highlighting. On
  paper all seven stack: `Panels` listens for `beforeprint` and for a
  `matchMedia('print')` change, because a tab that is not open is not in the
  document and no CSS rule can bring it back.
- **Lessons** (`ui/learn/`, `src/content/`): prose in TSX, ported by copy rather
  than rewritten (the accuracy rules travel with the sentences), steps that
  apply a document patch so "Show me" is reproducible, and the reference tables
  and footnotes as data. `app/test/content/*` renders every lesson and every
  reference table.
- **The WhyPill contract.** `WhyState = { state: 'on' } | { state: 'off'; why: string }`.
  `{ state: 'off' }` does not type-check without a reason, so a disabled control
  that explains nothing cannot be written by accident — the legacy page's "every
  gray control carries a pill saying why" rule, enforced by the compiler instead
  of by review.
- **No inline style, no inline script.** `style-src 'self'` means **no `style`
  props anywhere**: dynamic geometry goes through SVG presentation attributes
  (`x`/`y`/`width`/`transform`), dynamic theming through classes. The one escape
  hatch is `el.style.setProperty` through a ref, used in exactly one place —
  `App.tsx` writing the measured bottom of the status bar into `--bar-bottom`,
  because both bars wrap on a narrow window and a toast pinned to their nominal
  height paints over them. `site/build.mjs` fails the build on an inline
  `<script>`, an `on*=` handler or a `style=` attribute in the built page.
- **Events are added where the reader is looking.** In Topology a click selects
  (the inspector), a card's hover icons are the short list, the dock's scenario
  row is the shelf (`break/ScenarioRow.tsx`), and right-click, `Shift+F10` or `E`
  open the grouped list under a header that says *at t = [n] s*; the `⋯` handle
  and `A` open Build's own action table. In the Detailed timeline the cards and
  pills at the head of the lanes carry their own buttons. `runShown()`
  (`state/derived.ts`) is the one predicate for "the drawing and the readout
  show a run": a trace exists and the mode is not Config. The playhead is the
  one clock (the transport's *t* field), and the small timeline
  (`timeline/MiniTimeline.tsx`) is one thin bar per database, far sync and
  observer, a playhead to scrub, the transport, *Clear*, *Detailed timeline* and
  the pop-out of the full timeline into a window of its own.
- **Settings are tuned where the run is drawn** (`app/design/ui.md`,
  "Tuning a run in Simulate"). A column of settings beside the Detailed
  timeline's lanes, a row above them under 1180 px (`break/TuneStrip.tsx`, the
  `Settings` toggle, `dg-tune`), with the application's connect string in it
  (`inspector/client-timing.ts`); a grip on the end of every clock
  that *is* one setting, on its brace and on the lane band that is the clock
  (`timeline/tune.ts`, `tune-handles.ts`, `TuneDrag.tsx`); and a `+` beside the
  playhead on each lane of the full timeline drawing (`TimelineBody`: the
  popped-out window, the docked narrow layout), which opens the grouped event
  menu there (`timeline/LaneAdd.tsx`). Every edit goes through the inspector's
  named setters in `inspector/edits.ts` -- one undo sentence, one coalesce key,
  one set of refusals -- and is marked as tuned, so the axis holds while the
  run still fits it and the bar that changed is seen changing (`timeline/run.ts`).
  Nothing here adds a claim: the strip's tooltips are the inspector's own notes
  (`inspector/notes.ts`). Nothing stands above the lanes: the headline, which
  was an equation with editable terms for a day, and the strip under it were
  taken out on request, and the outcome is the bar's.
- **The readout follows the run**: Config reads the steady state even when the
  Document carries events, and so does Topology while nothing is injected; with
  a run (`runShown()`) Topology, the Detailed timeline and Learn read the
  outcome at `tNow` -- Topology's floating dock as the one terse line the
  Detailed timeline's bar carries (`break/RunBar.tsx`). The card strip leads with a `Drawing at t = <n> s` chip and file the rest
  behind a `Run` label, because there are **two clocks on the strip** — the
  moment the drawing is frozen at, and the run as a whole — and unlabelled they
  read as one reading taken at one instant.
- **Keyboard and aria**: the canvas is a `role="group"` with a generated
  sentence set and a visually hidden structural table; one card per site is the
  tab stop (a roving `tabindex`, spelled lower case — the camel-cased JSX
  spelling lands on an SVG `<g>` as an attribute SVG has never heard of, and the
  card silently takes no focus). `E` opens the grouped events and `A` Build's action table in
  Topology, `Delete` removes there with the same refusals the inspector's button gives. The
  drawer and the sheet are modal dialogs and keep a dialog's promises: `Escape`
  closes, opening moves focus in, closing hands it back.

### Tests

`npm --prefix app run test` is **2883 tests across 112 files**. What is where:

- `app/src/engine/__tests__/` — the engine's own unit tests (purity, citations,
  claims, schema, migrate, URL codec, parse, resolve, graph, axis, classic).
- `app/src/engine/validate/__tests__/` — the rule catalogue and the rules.
- `app/test/legacy-matrix.test.ts` — **the 24-cell gate** described above.
- `app/test/legacy-models.test.ts`, `legacy-fragment-parity.test.ts` — the three
  ported models and the fragment's numbers.
- `app/test/sim-*.test.ts`, `models-general.test.ts`, `presets.test.ts` —
  scenario, property and invariant tests over the general engine and all twelve
  presets. `sim-split-brain.test.ts` is the *Split brain* reading off a trace
  (`splitBrainOf`) and the old primary a manual failover leaves open, with the
  application's view of it: both primaries publishing the service at once, the
  sessions staying on the old one, and the reconnect when it goes down while the
  new one is already publishing (`lostAt`, `sessionsOn`, `servedAtLoss`);
  `ui/app-overlap.test.ts` draws that on the Simulate lanes, the reconnect chip
  and the Config figure; `ui/summary-band.test.ts` is its chip and the run-summary band
  in Break's Split and Lanes layouts; `ui/show-open-former.test.ts` is the SHOW
  CONFIGURATION note for it.
- `app/test/app-placement.test.ts`, `applications.test.ts`,
  `ui/application.test.ts`, `ui/applications-many.test.ts` — the application
  card: its vantage, several of them each with the connect string they dial, the
  reader for a document written with one, the share-link round trip, and the
  edits, lanes and readout per application.
- `app/test/generate.test.ts` + `app/test/__golden__/` — the generated DGMGRL,
  `LOG_ARCHIVE_DEST_n`, tnsnames/JDBC and SHOW output for five topologies.
- `app/test/ui/` + `app/test/ui/__golden__/` — canvas layout and routing
  goldens for all twelve presets, keyboard and aria, the timeline model, the
  panels, the inspector, the shell, history, the share-link round trip, Simulate's
  Configuration | Application timeline switch (`timeline-switch.test.ts`), tuning in
  the Detailed timeline (`tune.test.ts`, `tune-drag.test.ts`, `lane-add.test.ts`,
  `detailed-timeline.test.ts`), Topology with a run (`topology-mode.test.ts`), the
  legacy-URL upgrade.
- `app/test/content/` — every lesson and reference table renders.
- `site/smoke.mjs` — the built bundle in a browser (see Publishing).

A golden is a record of geometry or of generated text, not of a domain fact.
When a golden changes, say in the commit message which of the two it was.

### The edition switch (19c / 26ai), as it works now

The top bar carries a 19c/26ai toggle. It is a **reading preference, not part of
the Document**: it lives in its own `edition` signal, is persisted under
`dg-ed`, rides the URL as `?ed=26ai`, and is deliberately absent from the
exported file and the share payload — so "Reset", an import and a shared link
all leave the reader's edition alone. `TopologyDoc.config.edition` is what the
engine reads, and the boot path writes the preference into it.

What the edition actually changes: the `RULES_26AI_ONLY` validation rule
(`ROUTES.GROUP_NEEDS_MAXFAILURE`) and the three that fire under 19c only
(`FSFO.PING_PROPS_NOT_IN_19C`, `FSFO.LAGTYPE_GRACETIME_19C`,
`CFG.PRIMARY_CANDIDATES_19C`); whether `ObserverPingInterval` /
`ObserverPingRetry` exist at all (not under 19c: the controls grey, the engine
detects on the threshold, the script does not emit them); the far-sync-with-FSFO
protection-mode conflict (19c excludes MaxProtection and MaxPerformance, 26ai
only MaxProtection); `FastStartFailoverLagLimit`'s broker default and its
MaxAvailability role, and with them the readiness gate (`lagLimitOf(doc)`: a
document that never set the property follows the edition); the transport a
fast-start failover target may use in MaxAvailability (ASYNC is listed under
26ai only); the observer count ceiling; how `MAX_FAILURE` counts (26ai counts
the initial failure); what `PreferredObserverHosts` does when it changes; which
view the generated text names (`V$DATABASE.FS_FAILOVER_*` under 19c,
`V$FAST_START_FAILOVER_CONFIG` under 26ai); the `SHOW FAST_START FAILOVER` mock
(19c follows a live 19.27 system, 26ai the 26ai example with its ping lines);
and the notes the generators and the reopen model attach. Where Oracle
contradicts itself — the observer count in both editions, the `ObserverPing*`
defaults in 26ai, the lag-limit mode question in both — the page shows the
conflict rather than picking a side. **The 19c edition is 19c as documented**:
what a live 19.27 system shows beyond the documentation is recorded as an
observation and labelled as one.

## The legacy fragment (simulator/)

`simulator/fsfo-simulator.html` is the page the workbench grew out of: one
self-contained fragment (no doctype/html/head/body; `<title>` first), vanilla JS,
zero external requests. It is **frozen** — bug fixes only, new work goes into
`app/` — but it still ships, at `/dataguard/legacy/`, because every link the
handover document and the Confluence page handed out points there.
`site/build-legacy.mjs` is what wraps it into a page.

**It must stay pure ASCII.** With no `<head>` it carries no `<meta charset>`, so
a raw em dash or `×` renders as mojibake (`Timeline â€” primary crash`). Escape
by region: named entities in markup, `\uXXXX` in JS strings, plain ASCII in
comments — entities do not decode inside `<script>` or `<style>`. The guard now
lives in `site/build-legacy.mjs` (which `site/build.mjs` runs, so it still runs
on every publish) and exits non-zero naming the offending lines. Full rule and
the by-hand check are in [CLAUDE.md](CLAUDE.md).

Other constraints that still bind anyone touching the file:

- **Token-based theming**: the palette custom properties on `:root`, redefined
  under `@media (prefers-color-scheme: dark)` **and** under
  `:root[data-theme="dark"]` / `:root[data-theme="light"]`, so the toggle wins
  both ways. `app/src/styles/tokens.css` carries the same palette.
- **Four model marker blocks.** Every section is driven by a pure function
  inside a marker pair — `computeFsfo(c)` in `/* MODEL:START */`…`/* MODEL:END */`,
  plus `APPMODEL`, `COMMITMODEL` and `REOPENMODEL`. The blocks are DOM-free and
  closure-free, so a standalone node test is their concatenation, extracted
  between the markers (concatenate `MODEL` first — `computeApp` shares its
  `pickTickStep`). **`site/test.mjs` does exactly that**, asserts the documented
  invariants including the 24-cell scenario × observer-location outcome matrix
  as literal tables and the 19c-invariance loops
  (`node --test site/test.mjs`, 63 tests). `site/publish.sh` runs it on every
  publish. The application reproduces the same 24 cells through its compat
  adapter, so **that matrix now has three homes — `site/test.mjs`,
  `app/test/legacy-matrix.test.ts` and `diagrams/README.md` — and a change to
  one is a change to all three.**
- **Every return path carries `m.outcome`** — `failover` · `continues` ·
  `stall-noone` · `manual` · `observer-lost` · `switchover` — and the renderers
  branch on the outcome, never on the scenario name, because the same failure
  tells a different story per observer placement. Five reachability facts
  (`stalled`, `standbyGone`, `redoFlowing`, `pmyReachable`, plus the effective
  `scenario`) sit between the two and the drawings read them straight off the
  model.
- **Six chapters, six IIFEs, one rule.** The page is `#ch-clocks`,
  `#ch-transport`, `#ch-app`, `#ch-config`, `#ch-side`, `#ch-reference`, turned
  into tabs by a self-contained IIFE; the "Explain more" prose toggles, the URL
  state (`FIELDS`), the demo links (`DEMOS`) and the page chrome (Notes buttons,
  config pill) are four more. **Nothing is hidden by markup or CSS alone** — the
  script adds the class the hiding rules key on, so a page with no script is the
  whole document, and printing takes the same route back. **New chrome is a
  self-contained IIFE that injects its own DOM, degrades to nothing without JS,
  and never reaches into another IIFE's closure** — push state by setting a
  control's `.value`/`.checked` and dispatching its own `input`/`change` event,
  never by calling into the models.
- **Every gray control carries a pill saying why** (`.ctl-pill` / `WHY` table),
  set from state on every pass so a null reason clears it. The application
  enforces the same rule with the `WhyPill` prop type.
- **The edition switch inside the fragment** is `DG.setEd` / `DG.ed()`,
  resolution `?ver=` → `localStorage['dg-ed']` → 19c, with prose handled by the
  `V26` source-string substitution table inside `DG.t()` and structure by the
  `.fsfo.is-v26` / `data-ver` split. Editing a sentence that has a variant
  means editing the markup and the `V26` key in one commit. A stale
  variant fails silently — the page shows the 19c sentence.
- The **fifth, 26ai-only observer placement** (`dc1dc2`, an observer beside each
  database) was removed deliberately, because two of its six cells were
  inferences rather than quoted outcomes. Do not reintroduce it; a stale
  `?ol=both` degrades to the third site through the existing unknown-value
  fallbacks.

The detail behind each of those — what each chapter contains, which controls
gray out in which cell, how the topology strip decides which links are down, the
per-chapter pre-publish walk — is in the git history of this file (the section
was written out in full while the fragment was the published page). It is not
repeated here because the fragment is frozen: read the file, and `site/test.mjs`
beside it, before changing anything in it.

## Language: English only

Both pages are English only. The legacy page used to ship a Czech reading (an
`EN` / `CZ` toggle and a catalog in `simulator/i18n/cs.json`); both were removed
in September 2026, and a `?lang=` left in an old link is normalized away by
either page. Do not reintroduce a translation layer.

What is left of that machinery in the fragment serves the 19c / 26ai switch:

- `window.DG` (first `<script>` on the page, before the markup): `t(source, …)`
  applies the `V26` release variant and substitutes `{0}`, `{1}`, …;
  `tp(forms, n, …)` picks the singular or plural of a `|`-separated string;
  `setEd`, `ed()`, `onRefresh(cb)`.
- **Sentences are keyed whole and take placeholders** — never concatenated from
  fragments, so a 26ai variant can say the same thing with the numbers elsewhere.
- **Static markup** is re-rendered by the block sitting between the markup and
  the models. It snapshots the 19c English out of the DOM *once*, by CSS
  selector, and every later pass renders from that snapshot. It runs before the
  `onRefresh` subscribers, because the models own a dozen control notes and
  headings that also exist in the markup — the models have to win.
- **Script-injected chrome** (the Notes buttons, the config pill, the demo
  buttons) is invisible to that snapshot, so each of those blocks re-applies its
  own labels from an `onRefresh` callback.
- Where a label is built through **`fitLabel`**, the source offers a ladder of
  candidates from longest to shortest; lane labels live in a fixed 124 px gutter,
  so keep the short rungs genuinely short or the ladder falls through to the
  bare value.

## Process that produced this (worth repeating)

1. Verified every parameter default and semantic against Oracle docs before
   designing anything.
2. Wrote one shared spec (domain facts + visual language + per-deliverable
   requirements), then ran two opus-tier subagents in parallel from it — one for
   the static SVGs, one for the simulator.
3. Review pass on top: rendered everything (headless Chrome / both themes /
   edge states), checked domain claims sentence by sentence, fixed wording, and
   only then published and delivered.

Keep that order: facts → spec → build → adversarial review → publish. The
workbench in `app/` was produced the same way one layer up: a second verified
fact sheet (`app/design/facts.md`) first, then the two design documents beside
it, then the code, with the 24-cell matrix carried forward as the regression
gate so the new engine had to reproduce the old page's verified outcomes before
it was allowed to add anything.

## Conventions

- Nothing is committed without the user asking. Commit messages end with
  `Co-Authored-By:` per the harness rules.
- **Nothing is published without the user asking either.** `./site/publish.sh`
  is a deliberate act; running it is never part of "finish this change".
- **Changing a documented default or a model formula means changing its
  citation and its test in the same commit.** In `app/` that is the entry in
  `app/src/engine/citations.ts` plus the vitest that pins the number; for the
  legacy fragment it is `site/test.mjs`. The test gates exist to make the
  accuracy rules executable, not to be worked around. If a change makes a golden
  move, say in the commit message whether the golden recorded geometry or a
  domain fact — only the second kind is allowed to move for a reason other than
  layout.
- **`app/` is ordinary UTF-8.** The ASCII-only rule is the legacy fragment's
  alone (see CLAUDE.md): `app/index.html` declares its charset, so em dashes,
  `×` and `≤` are written as themselves. Do not carry `\uXXXX` escapes or
  `&mdash;` into TSX or CSS.
- **Everything is English only**, both pages. The Czech handover documents in
  `handover/` are the one exception, and they are repo-only.
- Presets are the scenario tests: a new topology worth drawing is a preset in
  `app/src/presets` with a canvas golden and a `presets.test.ts` entry, not a
  one-off fixture inside a test.
- Scenarios covered so far, in the legacy 1+1+1 deployment: primary crash,
  isolated primary, severed link between the two database sites (`partition`),
  whole standby site lost (`dc2down`), observer lost and planned switchover —
  each crossed with the four observer locations, 24 states in all, and that
  matrix is pinned in three places (see the legacy section). The workbench adds
  the topologies the presets name: far sync (zero-loss, HA pair, role-change
  readiness), cascading (terminal standby, PRIORITY alternates), multiple
  targets with three observers, a RAC primary, bystanders and maximum
  protection. **The static figures in `diagrams/` still draw only the classic
  1+1+1 with the observer at a third site** — they were not regenerated for the
  new topologies, and they say what they show.
- Reinstate stays out of scope for the figures and for both pages; if the user
  asks for it, add it as a new figure/preset rather than crowding the existing
  ones. Exception: the test runbook (`testing/README.md`) uses
  `REINSTATE DATABASE` / auto-reinstate as drill *cleanup* so drills are
  repeatable — that does not document the mechanism and does not lift the
  out-of-scope rule.
