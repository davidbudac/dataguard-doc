# Implementation handoff — Data Guard topology simulator

Written 2026-08-17 for the next agent taking over `app/`. It is a *situation report*
and a *work order*; the durable rules live in [AGENTS.md](AGENTS.md) (accuracy rules,
what exists, publishing, conventions), [CLAUDE.md](CLAUDE.md) (per-tree rules), and the
three design documents in `app/design/` — read those before touching anything, this
file second. Anything here that contradicts AGENTS.md is stale; AGENTS.md wins.

## 1. Where things stand

**What exists.** `app/` is a TypeScript + Vite + Preact + `@preact/signals` application
— the "Data Guard topology simulator" — that replaces the single-file FSFO explainer
(`simulator/fsfo-simulator.html`, now frozen and shipped at `/legacy/`). You draw a
Data Guard configuration (N standbys — physical / logical / snapshot —, far sync
instances, cascading standbys, RAC members, up to 3 (19c) / 4 (26ai) observers,
multi-target `FastStartFailoverTarget`), inject failures on a timeline, scrub it, and
read the generated DGMGRL / `LOG_ARCHIVE_DEST_n` / tnsnames+JDBC / `SHOW …` output.
Four modes: **Build · Break · Configure · Learn**. Eleven presets, nine lessons
(the six legacy chapters ported by copy plus far sync, cascading, multi-observer /
multi-target). English only. Zero external requests. No inline script or style
(built for `script-src 'self'; style-src 'self'`).

**Commits so far** (all on `main`, pushed):

| commit | what |
|---|---|
| `69ac437` | the whole app + engine + docs; legacy frozen at `/legacy/`; site build reworked |
| `557b9b8` | `site/smoke.mjs` probes HTTP and falls back to an inlined `file://` copy; URL/permalink write path moved off `requestAnimationFrame`; canonical/verify URLs → `https://dataguard.davidbudac.cz/` |
| (this commit) | the UI polish pass described in §3, plus this file |

**Gates** at the last green run: `cd app && npm run typecheck && npx vitest run &&
npm run build` → 51 files / 1274 tests; `node site/build.mjs` → `_site/`;
`node --test site/test.mjs` → 68 (legacy fragment's model blocks);
`./site/publish.sh --dry-run` → build + all three test gates incl. smoke.

**Not published.** The live host `dataguard.davidbudac.cz` still serves the *old*
legacy page. `davidbudac.cz/dataguard/…` 301-redirects to it (path + query kept), so
every link the handover documents handed out still lands. Deploying is
`./site/publish.sh` — only when the owner asks. `DG_DEST` defaults to
`/var/www/dataguard`; verify the vhost's document root before the first publish.

## 2. Map of the code (read in this order)

```
app/design/facts.md    verified Oracle fact sheet — the ONLY source of "documented" claims
app/design/engine.md   engine spec + §10 "Deviations from the design as built"
app/design/ui.md       app spec + as-built notes (header, readout, event menu, drawer, print)
app/README.md          commands, structure, tests, deploy pointer
app/src/engine/        pure, DOM-free (a purity test enforces it)
  types/               TopologyDoc, events, Trace, Claim/Finding (basis + citation ids)
  citations.ts         ~130 entries: URL + verbatim sentence + edition + verified flag;
                       FORBIDDEN_FACTS + assertCitesAllowed() encode AGENTS.md's fenced sources
  defaults.ts          BOUNDS (single numeric-range table) + broker defaults per edition
  serialize/           schema validation, migrateV1 (legacy #cfg=/query keys), url codec
  net/graph.ts         hosts/links → reachability (non-transitive by default; see engine.md §10)
  redo/                RedoRoutes parse (12.1 ALT/FALLBACK + PRIORITY grammars) and resolve
  sim/                 epoch-loop simulator: kernel, fsfo, protection, roles, dests, simulate
  validate/            47 rules, each with severity + basis + cite
  models/              axis ladders, computeApp (N addresses), computeCommit (per SYNC leg,
                       far-sync hop terminates the commit), computeReopen (per destination)
  generate/            dgmgrl, initora, tnsnames/jdbc, show mocks; structured Lines
  compat/classic.ts    classicTopology + scenarioEvents + legacyComputeFsfo (the 24-cell gate)
app/src/state/         doc/view/derived signals, history (undo), url (#t= + query keys),
                       legacy-url upgrade, persist (dg-doc-v1, dg-theme, dg-ed), codec
app/src/ui/            App shell, TopBar/StatusBar/Guidance, canvas/, timeline/, inspector/,
                       break/, panels/, learn/, common/ (Field, WhyPill, Chip, …)
app/src/presets/       11 TopologyDoc presets — they ARE the scenario tests
app/src/content/       lessons/*.tsx, reference/*.tsx, footnotes, facts-ui (<Fact> chip)
app/test/              vitest: legacy-matrix (24-cell gate, verbatim from site/test.mjs),
                       sim-*, presets, generate + __golden__/, ui/*, state/*, content/*
site/build.mjs         orchestrator: app build → _site/, then build-legacy.mjs → _site/legacy/,
                       diagrams copy, assertNoInline guard
site/build-legacy.mjs  the old build (ASCII guard, Czech catalog inlined)
site/smoke.mjs         headless-Chrome check; HTTP probe → file:// fallback
site/publish.sh        build, three test gates, tar-over-ssh deploy, bundle-byte-equal verify
```

Load-bearing contracts (details in AGENTS.md → "The topology simulator (app/)"):

- **Accuracy is typed.** Every non-arithmetic quantity is a `Claim` with a `basis`
  (`documented` needs a citation; `model` / `inferred` need a note; the UI renders
  "this page's model"). Wording traps are listed in AGENTS.md's accuracy rules and
  `facts.md`'s top-five (e.g. `FILE IS` not `FILE=`; `GROUP` is not RedoRoutes syntax;
  targets are chosen "in the order specified", never "first viable"; MaxAvailability has
  the explicit "at least one synchronized standby" sentence, MaxProtection does not).
- **The 24-cell legacy matrix must stay green** through `compat/classic.ts`
  (`app/test/legacy-matrix.test.ts`) — it is the regression suite of the engine.
- **No inline style/script**; no `style` props anywhere; `site/build.mjs` fails on any.
- **Engine purity** and the import boundary are tests, not conventions.
- **URL/persist keys are public contract**: `#t=` (deflate-raw base64url document,
  `#t0=` plain fallback), query `ed mode panel sel t preset lesson step theme`;
  localStorage `dg-doc-v1`, `dg-theme`, `dg-ed`, `dg-intro-v1`; legacy `?sc=…&ol=…`
  and `#cfg=` are upgraded on load.

## 3. The in-flight UI polish (the owner's request)

Owner's verdict on the first build: *"too wide, not really clear, I was confused how
to use it; doesn't need a big redesign, needs polish."* Agreed. The polish brief, and
what landed in this commit:

| # | brief | status |
|---|---|---|
| 1 | Cap the shell at ~1360 px, centred, page gutters; canvas centred and never upscaled; text columns ≤ ~80ch; check 1440/1280/1100/900 | landed (`--w-app`, `.app` centred; grid rows `auto / fit-content(46vh) / 1fr`, rail spans stage+dock) |
| 2 | One calm header: brand · four modes as steps with a one-line subtitle for the active mode · compact right controls (edition, theme, Undo/Redo with the label in the tooltip — no "NOTHING TO UNDO YET" chips); quieter second row: preset · issue summary · Share (one button) · Export/Import/Reset small; ≤ 2 rows at 900 px | landed (`TopBar`, `StatusBar`, `App` — one `<header class="app-head">` with three bands; Share copies and shows the address inline, `data-permalink` always present) |
| 3 | Guidance line under the header per mode; one-time dismissible "How this page works" card (`dg-intro-v1`) + "?" to reopen; "Start here" list in the empty Build inspector | landed (`ui/Guidance.tsx`, `state/view.ts` MODE_GUIDE/introOpen, `persist.ts` dg-intro-v1) |
| 4 | Replace the four huge stat tiles with one compact chip strip (Build: protection level · members · FSFO · findings; Break: outcome · new primary open · data loss · observer · findings) | landed (`state/derived.ts`, `ui/common/Chip.tsx`; chip sentences moved into `title`) |
| 5 | Validation noise: errors/warnings expanded, INFO collapsed behind "n notes ▸"; header says "0 issues · 6 notes"; INFO never in warning colours | landed (`ui/IssuePanel.tsx`; unfolded on paper by `ui/print.ts`) |
| 6 | Break rail wording: "Inject at t = 40 s"; "One-click scenarios" | landed |
| 7 | Quieter eyebrows (10.5 px / .08em / `--ik3`), only as section labels; canvas site labels 11 px; stage fits content (min 260 px) | landed |
| 8 | Both themes × four modes × classic / far-sync-zero-loss / multi-target-three-observers × 900 px, before/after screenshots | done once by the polish agent (screenshots lived in its scratchpad, not kept); redo before publishing |

**How to look at the page from an agent sandbox.** Headless Chrome on the dev box
cannot fetch from a loopback HTTP server (it opens the socket and never sends the
request; `example.com` fails the same way headlessly). Build, then inline the hashed
JS + CSS from `_site/index.html` into one HTML file in the scratchpad and load it via
`file://` with `google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars
--user-data-dir=<fresh tmp> --virtual-time-budget=6000 --screenshot=<png>
--window-size=1440,1000 "file://…/one.html?preset=classic&mode=build"`. Query keys
stand in for clicks (`mode`, `preset`, `sel=<member id>`, `t`, `panel`, `lesson`,
`step`, `theme=dark`). `site/smoke.mjs` does the same fallback automatically.
`requestAnimationFrame` never fires in that dump — that is why the URL/permalink
write path is a timer, and anything else that must exist in a dump must not wait on rAF.

## 4. Known gaps and judgement calls (documented, not hidden)

- **Polish leftovers worth a second look** (my own read of the after-shots): in Break
  the drawing scales down noticeably to fit the shorter stage (`fit-content(46vh)`) —
  a wider preset such as `far-sync-zero-loss` renders at roughly 60 %; consider letting
  the stage grow to the drawing's natural height before the dock takes the rest, or
  capping the dock lower on tall windows. In Build a healthy preset still leaves an
  empty band under the folded notes. At 900 px the header is three bands (top bar
  wraps to two rows + guidance line).

- After a role change the canvas keeps the *declared* redo layout (drawing the reversed
  path on that layout ran lines through cards); the timeline, readout, `SHOW` mocks and
  the resolver all follow the new primary.
- No `cmd.enableDest` event yet: a destination disabled at `MaxFailure` stays disabled
  for the run (documented behaviour is a manual re-enable).
- `ObserverOverride` is fixed at FALSE (literal type); TRUE would change several
  matrix cells and needs its own table.
- Retry scheduling only for destinations with non-zero `MaxFailure` (engine.md §10).
- Dense presets: a caption may sit *inside* a site rectangle between two stacked cards
  (legal by the routing rules, tests assert no card/pill/label overlap at three frames).
- The bundle is one ~630 kB chunk (190 kB gzip); code-splitting is the obvious next
  perf lever, not needed for correctness.
- nginx: the vhost still sends `'unsafe-inline'`; the exact CSP to apply is in
  AGENTS.md → Publishing → nginx (`/legacy/` keeps the old header in a nested location).

## 5. Suggested next steps, in order

1. **Finish/verify the polish** (§3): screenshot the eight states before and after,
   fix what still reads wrong; keep every test green; update `ui.md` as-built notes.
2. **Publish** when the owner asks: `./site/publish.sh` (it runs the three gates and
   verifies the served bundle byte-for-byte). Then apply the CSP change on the server.
3. **Fact-check anything you reword** against docs.oracle.com before it ships;
   `curl` the page whole (WebFetch truncates the big broker chapters), grep for the
   verbatim sentence, and add/repoint the citation in `citations.ts`. The citations
   test pins verified quotes.
4. Nice-to-haves that were scoped out: `cmd.enableDest`; role-change-aware canvas
   layout; code splitting; a real e2e (Playwright) suite once a browser can fetch
   over HTTP in the sandbox used.

## 6. Working agreements (from AGENTS.md → Conventions)

- Commit only when the owner asks; commit messages end with the `Co-Authored-By:` and
  session trailers the harness prescribes.
- Never run `site/publish.sh` without an explicit ask.
- Changing a documented default or a formula = change the citation and the test in
  the same commit. `site/test.mjs` (legacy) and `app/test/legacy-matrix.test.ts` (app)
  assert the same 24 cells — change one, change both, and `diagrams/README.md`.
- `app/` is UTF-8 and English only; the ASCII-only rule is the legacy fragment's alone.
- The three design docs and this file are the record; when the code deliberately
  departs from a design, write it into the design's "as built" section.
