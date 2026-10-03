# Implementation handoff — Data Guard topology simulator

Written 2026-08-17, updated 2026-08-19 (§3c) for the next agent taking over `app/`. It is a *situation report*
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
Four modes: **Build · Break · Configure · Learn**. Twelve presets, ten lessons
(the six legacy chapters ported by copy plus far sync, cascading, multi-observer /
multi-target). English only. Zero external requests. No inline script or style
(built for `script-src 'self'; style-src 'self'`).

**Commits so far** (all on `main`, pushed):

| commit | what |
|---|---|
| `69ac437` | the whole app + engine + docs; legacy frozen at `/legacy/`; site build reworked |
| `557b9b8` | `site/smoke.mjs` probes HTTP and falls back to an inlined `file://` copy; URL/permalink write path moved off `requestAnimationFrame`; canonical/verify URLs → `https://dataguard.davidbudac.cz/` |
| `9517d7c` | the first UI polish pass described in §3, plus this file |
| `6e01232` | the second usability pass described in §3b — 15 items + 24 review findings |
| (this commit) | the third pass described in §3c — the drawing as the workbench: on-canvas action bar, Build action table, hints toggle, zoom/pan, Introduction page, density pass |

**Gates** at the last green run (2026-08-19): `cd app && npm run typecheck && npx vitest run &&
npm run build` → **58 files / 1578 tests**; `node site/build.mjs` → `_site/` (no-inline guard
passes with the `<foreignObject>` bar); `node --test site/test.mjs` → 68. **`node site/smoke.mjs`
did not complete on the owner's Mac**: it needs `CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`,
and then every check times out at 90 s because that headless Chrome writes its output and never
exits (the same quirk the screenshot recipe in §3b works around by polling for the PNG and killing
the process). Fix `smoke.mjs` the same way — or run it on the dev box where it last passed —
before `publish.sh`, which runs it as the third gate.

**Not published.** The live host `dataguard.davidbudac.cz` still serves the *old*
legacy page. `davidbudac.cz/dataguard/…` 301-redirects to it (path + query kept), so
every link the handover documents handed out still lands. Deploying is
`./site/publish.sh` — only when the owner asks. `DG_DEST` defaults to
`/var/www/dataguard`; verify the vhost's document root before the first publish.

## 2. Map of the code (read in this order)

```
app/design/facts.md    verified Oracle fact sheet — the ONLY source of "documented" claims
app/design/engine.md   engine spec + §10 "Deviations from the design as built"
app/design/ui.md       app spec + as-built notes (header, readout, drawer, print)
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
site/build-legacy.mjs  the old build (ASCII guard)
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
| 6 | Break rail wording: "One-click scenarios" | landed |
| 7 | Quieter eyebrows (10.5 px / .08em / `--ik3`), only as section labels; canvas site labels 11 px; stage fits content (min 260 px) | landed |
| 8 | Both themes × four modes × classic / far-sync-zero-loss / multi-target-three-observers × 900 px, before/after screenshots | done once by the polish agent (screenshots lived in its scratchpad, not kept); redo before publishing |

## 3b. The second usability pass (2026-08-17)

Verdict this time: *"quite confusing to use, not very intuitive."* Read as a newcomer
at 1280×720 and 1440×900, fourteen findings, all landed; the as-built record is
`app/design/ui.md` §3b (one bullet per item — read that, not this table, for the
mechanism). In one line each:

| # | what was wrong | what is there now |
|---|---|---|
| 1 | ▶ / speed / `t =` sat below the fold in Break, even at 900 px tall | `.tl-foot` is a sticky footer of the scrolling dock; the legend scrolls with the lanes |
| 2 | `+ Add` was 4,000 px down the Build rail; "Start here" pointed at buttons off screen | `Add` group first in the empty inspector; config groups are folds (only *Configuration* open, error opens its fold); an in-flow add toolbar on the stage in Build |
| 3 | selecting a card hid every way to add | `Add ▾` disclosure in the rail header, same `ADD_ACTIONS` table for all three surfaces |
| 4 | the injected-events list was under six scenario blurbs | Break rail: Events → one-line scenarios (`Show descriptions`) → validation |
| 5 | drawing at *t* and run-as-a-whole readout with no label | `Drawing at t = n s` chip + `Run` group; playhead rests at the end after an injection (`restPlayhead`) |
| 6 | ~250 px of chrome before the drawing | one guidance line (mode word leads it), compact intro strip auto-dismissed on first real interaction, `?` toggles the full card |
| 7 | "Configure" read as settings | guidance says generated output, and where the settings are (viewport-aware `railWhere`) |
| 8 | picker said "Current configuration" for a pristine preset; eleven long sentences | preset name / `(edited)`; optgroups; `Preset.short` titles |
| 9 | three shouted `NOTHING HAS TAKEN IT DOWN…` pills | restore rows only when something is down; containment-aware `isDownAt`; one quiet three-way sentence that cannot contradict the drawing |
| 10 | `#t=` written for an untouched preset | `isPristinePreset`: `?preset=` alone until the first edit (undo/Reset provenance rides in history) |
| 11 | findings count was text | a button that reveals the validation panel (Learn hands over with a toast) |
| 12 | seven flat tabs | *Files* / *Behaviour* group labels in one tablist |
| 13 | no "Open in Break" above the fold in Learn | workbench header with Open in Break / Open in Build |
| 14 | shortcuts undiscoverable | `?` card lists the real keyboard map |

Found by the review of that batch and fixed with it: **▶ Play had never advanced the
playhead** (`ui/timeline/playback.ts` — a UI-layer rAF loop with a timer fallback;
stops on the axis end, ▶ at the end rewinds); Learn at 1024–1279 px laid the grid out
at zero width; `+ Data centre` minted a duplicate id and a self-link; `+ Link` could
write to a nonexistent site; a hidden 1084 px a11y `<table>` gave the dock a
horizontal scrollbar. One minor leftover, deliberately not done: `ui/panels/Show.tsx`
prints `tNow` unclamped (the readout's fix, `clampToAxis`, is the one to reuse).

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

## 3c. The third pass — the drawing as the workbench (2026-08-19)

Owner's ask: *"click on each component and modify its properties or remove it; the
topology diagram should be the main centre point; much more interactive"*, then
*"prune the visible text a lot more, it should still be there optionally visible"*,
then *"an Introduction website … explain more in detail what to do; space it out, it
looks cramped, still a lot of text"*. The as-built record is `app/design/ui.md`
§3c (hints), §3d (action bar, parity, zoom, the mouse-click bug), §3e
(Introduction), §3f (density) — read those for mechanism; this is the map:

| piece | where | notes |
|---|---|---|
| On-canvas action bar | `ui/canvas/ActionBar.tsx`, `anchor.ts` (pure placement), `bar.ts` (open/focus signals), wired in `CanvasSlot.tsx`, drawn last in `TopoCanvas.tsx` | A `<foreignObject>` inside the SVG, placed by `x`/`y` attributes in drawing units (no CSSOM, CSP intact), `scale(1/k)`-compensated (`k` measured by a `ResizeObserver` in `CanvasSlot`, 1 in jsdom), always kept inside the viewBox because `.app-stage` clips ink silently. Build → `build/actions.ts`; Break → `break/events.ts` (`actionsFor`, `restoreQuietLine`). Caps at 6 rows (4 in Break). Opens on click; right-click / Shift+F10 / ContextMenu open it with focus inside; Esc closes it before clearing the selection |
| One Build action table | `ui/build/actions.ts` | Sibling of `break/events.ts`; feeds the bar, the rail's Remove buttons, the context menu and the Delete key (`deleteFromCanvas` is a lookup now, and covers sites/links). `openInspectorFor(key)` opens the Sheet below 1280 |
| Sites and links are controls | `SiteRect.tsx`, `LinkPath.tsx` (pill half), `aria.ts` (`siteLabel`, `linkLabel`) | Lower-case `tabindex` (the SVG trap), one tab stop per site rect, one roving stop for all link captions |
| Zoom / pan | `ui/canvas/zoom.ts`, `CanvasSlot` `ZoomStrip`, `common/useRovingToolbar.ts` | Ladder 50–140 % as view state; multiplies `width`/`height` attributes only; `.tp-wrap.is-zoomed` is the scroll port; background drag pans; ctrl/⌘-wheel steps. Ladder-end refusals ride in `title` (the one documented WhyPill exception) |
| Hints toggle | `ui/hints.tsx`, `state/view.ts` `hintsOn`, `persist.ts` `dg-hints` | Default off; `Note`/`Field` notes/`FieldNote` and the guidance line's second clause render only when on (or printing). Toggle in the inspector header, the Break rail header and the `?` card |
| Introduction page | `ui/intro/{IntroPage.tsx,route.ts}`, `styles/intro.css`, URL key `intro` | `?intro=1`; opens only when asked for (`introOnBoot` is `?intro=1` alone; a first visit lands on Topology); header brand link and `?` card open it. `dg-intro-v1` now means "has seen the Introduction" (a record; boot does not read it); the old intro strip is gone |
| Density pass | `styles/tokens.css` (`--s1…--s7`, `--gut`, `--h-top` 56, `--h-status` 40), `base/shell/inspector/readout/canvas/timeline.css`, `Inspector.tsx`, `MemberForm.tsx`, `sections.ts`, `StatusBar`, `IssuePanel`, `BreakRail` | Summary folded; Instances/Destinations folds; scenarios as a two-column grid; "Start here" and the `NOTHING TO FIX` eyebrow gone |
| Build stage sizing | `shell.css` `.app.m-build{grid-template-rows:auto minmax(260px,1fr) minmax(0,auto)}` + dock cap 46vh | The HANDOFF §4 leftover; `shell.test.ts` asserts it |
| Bug fixed on the way | `TopoCanvas.tsx` pointer capture | `setPointerCapture` on `pointerdown` retargeted the click to the svg, so a **real mouse click never selected a card** while every jsdom test (which dispatches `click`) passed. Capture is lazy now (on the drag threshold). **Verify mouse gestures in a real browser, not only in jsdom.** |
| Renames refuse out loud | `edits.ts` `renameMember`/`renameObserver` | `WHY.nameTaken` / `WHY.observerNameTaken` in a toast; double-click a card → rail + name field focused (`focusField`) |

Judgement calls worth knowing: the rail stays the home of the full forms, the bar
is the shortcut (a 25-field MemberForm does not fit a popover); Break's stage is still `fit-content(46vh)`,
so on dense presets the drawing (and the bar's text, ~9 px) is small there — raising the
Break stage or auto-fitting the zoom (`zoom.ts` B1b) is the obvious next step.

**Not done (Phase C of the plan, deliberately):** dragging a card onto another data
centre (`moveHost`, refusal `WHY.hostShared`), and drag-to-add-destination (edges come
from `redoRoutes` with the `(LOCAL : ALL)` fallback — the honest first step is a
`+ Destination` bar action that materialises `defaultRules(m)` and appends a `RouteDest`
via `setRedoRoutes`, then hands over to `RedoRoutesEditor`). Both can rewrite a document
the reader did not mean to write; own phase.

## 4. Known gaps and judgement calls (documented, not hidden)

- ~~Polish leftovers~~ **Done 2026-08-19** (the third pass, ui.md §3c/§3d): Build's
  stage now takes the room (`auto minmax(260px,1fr) minmax(0,auto)`, dock capped at
  46vh) so the drawing renders 1:1 there; Break keeps the fit-content stage and the
  on-canvas action bar compensates its own scale. The same pass added the anchored
  action bar over the Build/Break action tables, made sites and links focusable
  controls, fixed the pointer-capture bug that ate every real mouse click on a card,
  pruned the rail prose behind the `Hints` toggle (`dg-hints`), and added zoom/pan.
  At 900 px the header is still three bands (top bar wraps to two rows + guidance
  line).

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

1. **Make `site/smoke.mjs` finish on a Mac** (see Gates above: poll for Chrome's output
   and kill it, and accept `CHROME` pointing at the `.app` binary) — `publish.sh` needs it.
2. **Look again as a newcomer** after §3c: the Introduction (`?intro=1`) first, then
   Build → click a card → the bar; Break on `far-sync-zero-loss`; check the bar's
   text size in Break on `multi-target-three-observers` and decide about the Break
   stage height / auto-fit zoom. Mouse gestures in a real browser (the pointer-capture
   lesson); playback in a visible or headless Chrome, not a screenshot harness.
3. **Phase C** (drag semantics) if the owner still wants it — see §3c.
4. **Publish** when the owner asks: `./site/publish.sh` (it runs the three gates and
   verifies the served bundle byte-for-byte). Then apply the CSP change on the server.
5. **Fact-check anything you reword** against docs.oracle.com before it ships;
   `curl` the page whole (WebFetch truncates the big broker chapters), grep for the
   verbatim sentence, and add/repoint the citation in `citations.ts`. The citations
   test pins verified quotes.
6. Nice-to-haves that were scoped out: `cmd.enableDest`; role-change-aware canvas
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
