# Application architecture & UI design — Data Guard Topology Simulator

Companion to `engine.md` (pure engine) and `facts.md` (verified Oracle facts). Stack:
TypeScript + Vite + Preact + @preact/signals. English only. Zero external requests at
runtime. Light/dark theming and the 19c/26ai edition toggle carry over.

## 0. Premises carried over from the legacy simulator (load-bearing)

1. **Token-based theming.** The `:root` palette (`--bg/--sf/--sf2/--sf3/--ln/--ln2/--ik/--ik2/--ik3/--tl/--bl/--am/--rd/--vi/--sl/--fc/--gd/--sh` and the `*f` fills), redefined under `@media (prefers-color-scheme: dark)` AND `:root[data-theme="dark"|"light"]`. Copy the blocks from `simulator/fsfo-simulator.html` lines 11–38 into `app/src/styles/tokens.css`.
2. **Shared visual language.** teal = serving/open, blue = applying, amber = waiting/countdown, red = down (hatch fill, never flat), violet = observer decisions, slate = neutral/monitoring. Oracle vocabulary always mono.
3. **The page explains itself.** Every gray control carries a pill saying why (one `WHY` table); captions branch on the *outcome*, never on the event name; nothing is hidden by CSS alone.
4. **URL state is a public contract**: short keys, clamped on read, written behind a one-frame timer + 300 ms debounce (as built: a timer, not rAF — rAF never fires in a headless dump) (WebKit caps `replaceState` ~100/30 s).
5. **Undocumented is labelled in place** — `[UNDOC]`/`[CONFLICT]` claims render as "this page's model" next to the number.

## 1. Project structure, build, deploy, tests

```
app/
  index.html                 # the only HTML; NO inline <script>, NO inline style
  src/
    main.tsx                 # boot order §2.6
    engine/                  # pure, DOM-free (owned by the engine work)
    state/  doc.ts view.ts history.ts url.ts legacy-url.ts persist.ts derived.ts codec.ts
    ui/     App.tsx TopBar.tsx StatusBar.tsx IssuePanel.tsx Readout.tsx
            canvas/ TopoCanvas.tsx layout.ts routing.ts NodeCard.tsx LinkPath.tsx SiteRect.tsx EventMenu.tsx aria.ts measure.ts
            inspector/ Inspector.tsx MemberForm.tsx RedoRoutesEditor.tsx ObserverForm.tsx LinkForm.tsx ConfigForm.tsx
            timeline/ Timeline.tsx build.ts Brace.tsx Playhead.tsx Transport.tsx Tooltip.tsx
            panels/ Dgmgrl.tsx Dests.tsx Tns.tsx Show.tsx AppView.tsx Commit.tsx Reopen.tsx CodeBlock.tsx
            learn/ LearnShell.tsx Lesson.tsx LessonStep.tsx Explain.tsx
            common/ Field.tsx WhyPill.tsx Chip.tsx Segmented.tsx Sheet.tsx
    presets/  content/lessons/*.tsx  content/reference/*.tsx  content/footnotes.tsx
    styles/   tokens.css base.css shell.css canvas.css timeline.css panels.css print.css
  test/     engine/  ui/  (vitest; jsdom for components)
site/
  build.mjs        # orchestrator: app build -> _site/, legacy -> _site/legacy/, diagrams copy, assertNoInline guard
  build-legacy.mjs # today's build.mjs unchanged incl. the ASCII guard (writes _site/legacy/index.html)
  smoke.mjs        # dependency-free headless-Chrome check that publish.sh runs
  publish.sh       # same shape; test step = app tests (+ legacy test.mjs while legacy ships); verify = HTML 200 + hashed bundle byte-equal
```

- Engine boundary enforced by a purity test (import engine in node env; nothing may touch `document`/`window`).
- Vite: `modulePreload.polyfill:false` (no inline script), `cssCodeSplit:false`, `assetsInlineLimit:4096` (icons as data: URIs), no web fonts/CDN.
- **CSP goal**: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`. Therefore **no `style` props anywhere** — dynamic geometry via SVG presentation attributes (`x/y/width/transform`), dynamic theming via classes; `el.style.setProperty` through a ref is the only escape hatch. `assertNoInline('_site/index.html')` on the build path (no `<script>` with body, no `on*=`, no `style=`). nginx keeps the dedicated `location ^~ /dataguard/` block (two CSP headers intersect); `/dataguard/legacy/` gets its own nested location with the old `'unsafe-inline'` while the legacy page is served. Hash routing (`#/configure/commit`) so nginx needs no rewrite.
- Tests: engine invariants (ported 24-cell matrix), layout goldens with non-overlap assertions, component tests (WhyPill contract, fitLabel ladder, codec round trip), smoke (`site/smoke.mjs`: canvas rendered N cards, timeline N lanes, readout has outcome chip; perf budget).

## 2. State architecture

**Document vs View**: the Document is what a share link, a file and undo contain; the View is what a reload may forget.

```ts
interface Doc { meta: {name, notes}; topology: TopologyDoc-ish (engine types); events: TimedEvent[]; params: SimParams;
  layout: Record<id, {dx, dy}> /* drag overrides snapped to 8px */ }
doc = signal<Doc>(PRESETS.classic); edition = signal<'19c'|'26ai'>('19c')  // NOT in Doc (reading preference); theme likewise
```
View signals: `mode: 'build'|'break'|'configure'|'learn'`, `selection`, `hovered`, `tNow`, `playing`, `speed`, `panelTab`, `lessonId`, `lessonStep`, `proseOpen`, `theme`, `inspectorOpen`, `toast`.
Derived (one file, one direction): `primaryId`, `issues = validate(...)`, `errors`, `redoGraph`, `geometry = layoutTopology(...)`, `trace = simulate(...)`, `frame = stateAt(trace, tNow)`, `outcome`, `readout`, `scripts = {dgmgrl, dests, tns, show(frame)}` — `SHOW CONFIGURATION` takes `frame` so scrubbing walks it through states. No component computes domain state locally. `trace` budget ~8 ms; if slow, compute in an idle effect and mark `.is-stale` (never a spinner).

**URL**: fragment `#t=<base64url(deflate-raw(JSON(compact doc)))>` (fallback `#t0=` plain), 8000-char cap with an honest refusal ("too large for a link — export the file"); query keys human-readable: `ed`, `mode`, `panel`, `sel`, `t`, `preset`, `lesson`/`step`, `theme`; one exported FIELDS-style table with parse/serialize/default/clamp; unknown tokens ignored then dropped. Write path: effect → 16 ms timer → 300 ms debounce → `replaceState`; `tNow` excluded while playing/scrubbing. Undo never uses `pushState`.

**Undo/redo**: immutable Doc snapshots (`edit(label, fn, coalesceKey?)`, 700 ms coalescing per gesture, cap 100, user-facing labels "Undo: set LogXptMode to FASTSYNC on stby01"). View state never in history; layout drags and event injection are edits.

**Boot order**: theme ← `?theme=`|localStorage|auto; edition ← `?ed=`|localStorage|19c; doc ← `#t=`/`#t0=` → `?lesson=`/`?preset=` → legacy query/`#cfg=` upgrade (§6.4) → localStorage `dg-doc-v1` → classic; view globals from query; render; then start URL/autosave effects. Presets/lessons replace the whole Doc (reproducibility).

**Persistence/files**: `dg-doc-v1` debounced 500 ms with an 8 s "Restored your last configuration · Start fresh" strip; `dg-theme`, `dg-ed`; export `<name>.dgtopo.json` verbose; import through the same whitelist+clamp path, reporting dropped keys; `upgradeConfigV1()` reads the old `{v:1, deployment, params, sim}` shape.

## 3. Screen layout / IA

Four modes, one persistent canvas (the canvas never blinks):

| Mode | Right rail | Bottom row | Canvas |
|---|---|---|---|
| Build | Inspector | Validation issues + steady-state readout | select, drag, `+` palette |
| Break | Event menu, then the event list + palette (six legacy scenarios as one-click templates) | Timeline + transport + readout | click or `E` → event menu; cards tinted by `frame` |
| Configure | Inspector narrowed | Tabs: DGMGRL · LOG_ARCHIVE_DEST_n · tnsnames/JDBC · SHOW · Application view · Commit · Reopen | 180 px live strip |
| Learn | — | — | prose-left (60ch) / live workbench-right (drawing + readout + timeline) |

As built, three things in that table are worth spelling out:

- **The event menu has one home per layout, never two.** On a wide screen it is the
  first group at the head of the Break rail, so the drawing keeps its whole stage;
  once the rail has become a drawer it moves under the drawing, because a menu inside
  a closed drawer is a menu nobody finds. It is a panel with a fixed place, not a
  popup at the pointer — `style-src 'self'` forbids positioning anything from script,
  and a panel that stays put is one the reader can find again.
- **Learn's workbench is the drawing, the readout *and* the timeline**, so a step whose
  "Show me" breaks something draws its clocks beside the prose that explains them.
- **The readout is mode-aware.** Build and Configure are about the configuration, so
  they read the steady state even when the Document carries events; Break and Learn
  read the outcome at `tNow`. The outcome belongs to the modes that draw the run.

Desktop shell (≥1280): top bar 48 (brand, mode segmented control, 19c/26ai, theme, undo/redo with labels) · status bar 36 (preset picker, issue count, Share/Export/Import/Reset) · canvas (min 320) + inspector 360 · readout 62 (chips: outcome, RTO, per-member RPO, loss kind, observer state, issues) · timeline `clamp(220px, lanes*48+120, 46vh)`. Grid on `100dvh`, `overflow: clip` (not hidden).

**The polish pass (as built) changed six things in that paragraph.** The verdict
it answers was one sentence — *"too wide, not really clear, I was confused how to
use it"* — and every item below is one reading of it:

- **The shell is capped and centred.** `--w-app: 1360px`, `margin-inline: auto`, a
  hairline down each side and the page ground (`--bg`) showing in the gutters, the
  way the published page capped `.fsfo` at 1240. Edge to edge at 1440 there was no
  line for the eye to come back to. The toast is centred on the same cap
  (`left: 50%` + `translateX(-50%)`, `width: min(var(--w-app), 100%)`) rather than
  pinned to the viewport, or it would hang past the shell it belongs to. Prose
  columns are capped where they are read, not globally: findings 80ch, rail notes
  80ch, the guidance line 104ch, lesson prose 60ch.
- **The stage fits the drawing; the dock takes the rest.** Rows are
  `auto / fit-content(46vh) / minmax(0,1fr)` with `min-height: 260px` on the stage,
  and the rail spans **both** the stage and the dock rows (`"stage rail" / "dock rail"`)
  — otherwise shrinking the stage would shrink the inspector with it. A 1+1+1
  topology is 210 px tall, and it used to float in a 550 px stage while the timeline
  underneath ran out of room. The drawing is centred in what is left
  (`justify-content: center` on `.tp-wrap`) and is never scaled up past its own
  viewBox. In Build the leftover height belongs to the validation panel
  (`.app-dock > .issues { flex: 1 1 auto }`), because empty surface has to be part
  of a panel with a heading rather than a nameless band.
- **One header, three bands, one element.** `<header class="app-head">` holds the
  top bar, the quieter document row and the guidance line, and the toast measures
  *it* — not the status bar plus a sibling. Modes carry a one-line subtitle
  (`MODE_SUB`), undo/redo are small buttons whose `title` carries the edit they
  would reverse, and the two `WhyPill` chips beside them are gone: NOTHING TO UNDO
  YET, shouted at a reader who had not yet done anything, was the loudest text on
  the page. Share and Permalink are one control — Share copies, then leaves the
  address in the bar as a real anchor for a few seconds, so copying still does not
  depend on `navigator.clipboard`. The canonical address rides on the button as
  `data-permalink` at all times, which is what `site/smoke.mjs` follows and what a
  machine can read without pressing anything.
- **The page says what to do.** A guidance line under the header, per mode
  (`MODE_GUIDE` in `state/view.ts`); a "How this page works" card with one bullet
  per working mode and a link to Learn, shown on the first visit, dismissed into
  `localStorage` under `dg-intro-v1` (`loadIntro()` at boot, never read during a
  render) and brought back by the `?` in the header; and a numbered "Start here"
  group at the head of the empty Build inspector, above the configuration summary.
- **The readout is a strip of chips, not four billboards.** Label (sans, sentence
  case) + value (mono, 14 px, semantic colour) + an optional quieter second value,
  separated by hairlines, with the sentence behind each number in the chip's
  `title`. Build and Configure read Protection level · Members · Fast-start
  failover · Findings; Break adds Outcome, New primary open, **Data loss** (the new
  primary's RPO — zero is the whole promise of SYNC and of a far sync) and Observer.
  Four 26 px numerals were the loudest thing on a page where nothing had happened
  yet.
- **Errors and warnings are open; information is folded.** `IssuePanel` (Build's
  dock and now also the foot of the Break rail) shows errors and warnings expanded
  and puts INFO behind a `6 notes ▸` toggle whose rows are genuinely absent until
  it is pressed. The count everywhere reads `0 issues · 6 notes`, never `6 issues`:
  errors and warnings are issues, information is a note, and a healthy preset
  raising six notes was being reported as six things wrong.
Configure: generated blocks mono, scrollable, Copy button (reuse `.cfg` styling), **line ⇄ canvas cross-highlighting** via `data-member` on emitted lines (generators emit structured lines).
Learn: lesson list + prose column, steps drive the workbench beside it (descendant of `DEMOS`).
Degradation: 1024–1279 inspector as overlay drawer; 768–1023 single column with bottom-sheet inspector; <768 read-only viewer with an explicit "Editing needs a wider screen" card (nothing silently missing); print expands everything (`print.css` first-class).

- **The drawer and the sheet are modal dialogs and keep a dialog's keyboard promises**: `Escape` closes from anywhere (the listener is on the document, not on the panel), opening moves focus into the panel, closing returns it to the control that opened it. The effect hangs on `open` alone — the `onClose` callback is a new arrow on every render of the shell, and an effect that depended on it would hand the focus back while the reader was still typing.
- **The reason is said once.** On a phone the stage card spells it out ("Editing needs a wider screen…"); the drawing, the inspector, the event menu and the Break rail's grey controls say only that they are read-only. Three copies of one sentence on one screen is noise, not honesty.
- **Every rail is its own scroll region, and it says so.** Two shading bands, `local`-attached so each is present only while content is hidden behind it and gone at the end of the scroll, plus `scrollbar-gutter: stable`. Configure gives the rail a 180–260 px strip, which is where a row cut by the bottom edge with nothing to mark it reads as a drawing error rather than as "there is more".
- **The toast is anchored to the measured bottom of the status bar**, through a `--bar-bottom` custom property written by a `ResizeObserver` in `App.tsx` (`el.style.setProperty` through a ref — the one escape hatch the policy leaves), with `calc(var(--h-top) + var(--h-status))` as the fallback. Both bars wrap on a narrow window, so their nominal heights are a guess and a toast pinned to that guess paints over the bar.
- **On paper the panels stack.** `Panels` listens for `beforeprint` and for a `matchMedia('print')` change and renders all seven tabs while either is on; no CSS rule can do it, because the tab that is not open is not in the document. Two print traps are pinned by that verification: the citation chips' `white-space: nowrap` row plus the appended `a[href]::after` URL push the page ~90 px sideways unless the row is allowed to wrap on paper, and headless `--print-to-pdf` fires neither event, so print has to be checked with the media emulated (`Emulation.setEmulatedMedia`), not with a PDF.
Chrome rules: collapsibles leave their button in place; panels are real links; `:focus-within`, never `:hover`, for notes.

## 4. Topology canvas

**Node card** (generalised `nodeCard`): flat `--sf` rect, hairline, rx 5, badge rx 7 centred; role word / host mono (19-char elision, full value in aria) / subtitle; width clamp(184, measured, 260); height 72 (3-line DB) / 52 (observer). Glyphs: db cylinder, observer eye, far sync = cylinder + chevron (no base), snapshot = cylinder + shutter tick. RAC `⌗2` chip top-right (absent = single instance, legend says so once). Master observer `MASTER` violet chip only while FSFO is enabled ("all observers have the same functionality" when disabled); observe-only slate chip. Break-mode state: phase tint fill/border; down = hatch + red border; crashed host = two-stroke red cross on the name line; stalled primary = red border, no cross.

**Auto-layout** (`canvas/layout.ts`, pure, deterministic): rank by BFS over the resolved redo graph (primary 0, far sync/standby = source+1, observers band −1, unreachable = max+1 dashed); columns = sites ordered by min rank (primary site leftmost, third site between); rows within a site: observers band, then members by (rank, roleOrder primary/farsync/physical/logical/snapshot); cascaded standby in the row below its cascader (indented 24 px if same site); pack (col width = max card + 28; row = max height + 18); site rect = union + 14 pad + 18 bottom label band; centre columns so the classic 1+1+1 redo edge is horizontal; apply drag overrides (snap 8 px) then recompute site rects; viewBox = union + 10 top / 16 bottom.

**Link routing** (`canvas/routing.ts`): ports (redo right→left mid-height; observer ping bottom→top; backwards edges via a lane under the site rects); ≤2 bends; channel allocation per corridor (offsets 0, ±12, ±24…; ±24 in a site-to-site corridor, which is 200 px wide). Two additions the dense presets forced, both deterministic:

- **A corridor route.** When the straight run is blocked — three observers in four columns put a card in the way of nearly everything — the link leaves sideways, drops down the free space between the destination's column and its neighbour, and comes at the destination from the side. Without it a route that could only take the lane above everything dropped onto its target's top edge straight through whatever that column stacked above it.
- **Corridor-aware pill placement.** A caption belongs in the corridor or on the vertical run inside it, never over a card and never inside a site rectangle it says nothing about. The sweep is a four-rung ladder, each rung a fixed enumeration: clear of cards, captions, site rectangles and every other link's line; then the same without the lines; then cards and captions only (which is where a hop between two cards stacked in one data centre ends up, since that is where its line is); then a clearance computed from the obstacle. The slide ladder runs to half the segment, not a flat 40 px — a corridor is 200 px from the middle of a run that spans the drawing.

Routing runs in two phases for that reason: every route first, so channels are still handed out in id order, then every caption, so a caption can be placed against lines that were not yet routed when it was. The canvas draws in the same two passes — all lines, then all cards, then all captions — so a caption is never painted over by a line routed after it; both halves carry the same `data-node` and the same handlers, so either one hovers and selects the whole link. `test/ui/canvas-presets.test.ts` holds all eleven presets to the collision rules and to a golden of the geometry. Styles: SYNC solid + filled arrow; FASTSYNC solid + hollow arrow; ASYNC dashed 6-3; observer ping dotted violet, no arrow; readiness check dashed slate; inactive PRIORITY alternate 55% opacity `ALT · PRIORITY 8`; cut link dashed red + two slashes, RTT → `cut`/`down`. Arrows = redo flow only.

**Event affordances**: click node → menu (Crash the host · SHUTDOWN ABORT the instance (RAC: pick) · Stop redo apply · Take the whole site down · Restore); click link → Cut · Add latency… · Restore; multi-select shows the intersection of valid actions. Each action = `edit('Crash dc1-prm01', …addEvent at tNow)`; events ride the share link, appear as numbered markers on the axis and in the Break rail (editable `at`, remove).

**Keyboard/aria**: svg `role="group" aria-describedby` with generated sentence set + a visually hidden structural table (site/member/role/host/receives from/transport/RTT); every card is `role="button"`, and **one card per site is the tab stop** (a roving `tabindex` that follows the arrows, so tabbing away from a site and back returns to the card the reader left) — arrows within a site, Tab between them, Enter or Space selects (Shift adds), `E` opens the event menu, `Delete`/`Backspace` removes in Build, `Esc` clears. Sentences composed per function (testable), collapse to counts above 8 members.

Two things that spelling depends on:

- **`tabindex`, lower case.** Attribute names are folded to lower case only for HTML elements, so the camel-cased JSX spelling lands on an SVG `<g>` as a literal `tabIndex` attribute that SVG2 has never heard of: the cards render, look focusable and take no focus at all. Same for the timeline's `<g role="slider">`. `test/ui/canvas-keyboard.test.ts` pins it.
- **The shell has to pass the handlers.** `E` and `Delete` are the canvas's to detect and the shell's to mean: `CanvasSlot` wires `onEventMenu` only in Break (it opens the menu; it does not position it) and `onDelete` only in Build, where it removes exactly what the inspector's Remove button removes, refusals included — a shortcut that could delete the primary while the button beside it says why it cannot is two answers to one question, and the refusal is said out loud.

## 5. Timeline

Pure `buildTimeline(trace, topology, view) → TimelineModel`; component maps to VNodes. Lane order: primary; observers (master first; alphabetical/no master when FSFO disabled); far syncs; standbys in BFS order (cascaded indented 10 px). Gutter 132 px, `fitLabel` ladder, lane 38 + 10 gap. Scale: `t0 = -snapNice(0.15*horizon)`, `horizon = clamp(1.15*lastInterestingT, 30, 900)`, `pickTickStep` ported; `pinnedScale` export mode reproduces `x(t) = 280 + 10·t` for the static figures. Segments with phase classes (`b-tl/b-bl/b-am/b-sl/b-vi/b-hatch`), labels via `fitLabel` (drop below ~28 px → tooltip); brace row-packing ported verbatim; numbered event markers on the axis ("t = 0 is the first injected event"); legend wording unchanged. Scrubber: separate `Playhead` subscribing to `tNow` only; drag with pointer capture; `←/→` 1 s, Shift 0.1 s, Home/End, Space play/pause, `.`/`,` next/previous state change; transport bar with speeds and click-to-type `t`. Hover: one delegated pointermove, tooltip as positioned div. Perf: memoised build, stable keys, `approxW` table (never `getComputedTextLength`); budget rebuild <12 ms, playhead <2 ms at 12 lanes.

## 6. Migrating the six chapters

| Legacy | New home |
|---|---|
| topology strip / `renderTopo` | Canvas (auto-layout, ported card/pill/site/hatch/cross look) |
| scenario radios | Break palette templates: Crash the primary host · Isolate the primary site · Cut DC1↔DC2 · Lose the standby site · Kill the master observer · Switch over |
| observer-location radio | gone as a control — placement is where the observer card sits; lessons move the observer |
| threshold/ObserverPing*/lag limit/type/grace/PmyShutdown/protection mode | Inspector → Configuration/FSFO |
| role transition, latency, apply lag | params.roleTransition, per-link RTT, per-member apply lag |
| timeline + banner + callout | Timeline + `Alert`s (blocked, split brain) |
| "What the timeline shows" | Lesson 1 prose + timeline Explain block |
| commit view | Configure → Commit, one figure per SYNC/FASTSYNC destination sharing one ms scale |
| reopen view | Configure → Reopen, scoped to the selected destination |
| app view | Configure → Application view over N addresses |
| deployment identity | per-member fields in Inspector; deployment-level in ConfigForm |
| export/import/share | status bar |
| config cards | Configure → DGMGRL / LOG_ARCHIVE_DEST_n / tnsnames-JDBC / SHOW |
| side topics (SDU, impact, NET_TIMEOUT) | Learn → "SYNC transport" lesson (static TSX + inline SVG figure) |
| reference tables + footnotes | Learn → Reference (`RefTable` data, `Footnotes`) |
| DEMOS | `lesson.steps[].apply` |
| Explain more IIFE | `<Explain>` |
| tabs/pager/cfgpill IIFEs, i18n, ASCII rule | dropped (ASCII rule stays for `simulator/` until deleted) |

Lessons: 1 Failover clocks · 2 The transport layer · 3 The application's view · 4 Configuration · 5 SYNC transport · 6 Reference · plus new: Far sync · Cascading · Multiple observers and targets. Prose ported by copy, not rewritten (accuracy rules).

**Deep-link compatibility** (`state/legacy-url.ts`): map legacy query keys (`sc`, `ol`, `pm`, `th`, `ps`, `pi`, `pr`, `lag`, `ll`, `rt`, `lat`, `sd`, `lt`, `tla`, `lgt`, `lp`, `xpt`, `lw`, `sbw`, `rs`, `mf`, `og`, `rr`, `tct`, `ct`, `rc`, `rd`, `da`, `lang` (drop + notice), `ver`) and anchors (`ch-clocks`→break, `ch-transport`→configure/commit, `ch-app`→configure/app, `ch-config`→configure/dgmgrl, `ch-side`→learn/sync-transport, `ch-reference`→learn/reference) onto the classic preset, then `replaceState` the canonical URL. `#cfg=` → `upgradeConfigV1()`. Legacy page kept at `/dataguard/legacy/` (Czech handover links carry `?lang=cs`; those go to legacy).

## 7. Milestones
M1 shell + canvas drawing the classic 1+1+1 from the engine · M2 Build mode (inspector, validation, undo, persistence, share) · M3 Break mode (events, timeline, scrubber, readout; six templates reproduce the six legacy outcomes) · M4 Configure (generators, panels, cross-highlight, goldens) · M5 Learn (nine lessons, reference, legacy URLs, print; deploy flip; drop 'unsafe-inline') · M6 polish/a11y/perf.

## 8. Taste notes
Two faces only: system sans for prose, mono for everything Oracle/terminal (property names, modes, statuses, ORA numbers, DGMGRL, names, hosts, numerals with units). Prose 15/1.55, captions 11.5, eyebrows 11 mono uppercase .16em, chips 10.5 mono uppercase .12em, readout numbers 26/620 tabular. **As built the eyebrow is quieter and rarer** — 10.5 mono uppercase .08em, and only for a *section* label. It is not a chip label (the readout's are sans, sentence case), and it is not a title that reads as a sentence: the event menu says `Inject at t = 40 s` in mono sentence case, because AT T = 40 S was a shout. Readout values are 14/620 tabular mono, and the site label under a data centre rectangle is 11 px, not 10 — it names a column of the drawing, not a footnote to it. Canvas airy, rails dense; elevation only on rail/sheet/drawer. Colour semantic never decorative; cards monochrome in Build, tinted only in Break at a t; red = down only; violet = app's voice + observer semantics. Empty states say something true (inspector → configuration summary; Break → "Nothing has happened yet…"; timeline → "steady state — no events injected"; validation → "No issues … as modelled here"). Five invariants: WhyPill on every disabled control (`{state:'on'} | {state:'off', why}` prop); captions branch on outcome; nothing hidden by CSS alone; every demonstrable claim has "Show me"; undocumented labelled in place (`<Fact id>` chip). New principle: the drawing and the text are the same object seen twice (hover a generated line → highlight the member; select a member → scroll to its lines).
