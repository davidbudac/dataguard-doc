# Application architecture & UI design — Data Guard Topology Simulator

Companion to `engine.md` (pure engine) and `facts.md` (verified Oracle facts). Stack:
TypeScript + Vite + Preact + @preact/signals. English only. Zero external requests at
runtime. Light/dark theming and the 19c/26ai edition toggle carry over.

## 0. Premises carried over from the legacy simulator (load-bearing)

1. **Token-based theming.** The `:root` palette (`--bg/--sf/--sf2/--sf3/--ln/--ln2/--ik/--ik2/--ik3/--tl/--bl/--am/--rd/--vi/--sl/--fc/--gd/--sh` and the `*f` fills), redefined under `@media (prefers-color-scheme: dark)` AND `:root[data-theme="dark"|"light"]`. Copy the blocks from `simulator/fsfo-simulator.html` lines 11–38 into `app/src/styles/tokens.css`.
2. **Shared visual language.** teal = serving/open, blue = applying, amber = waiting/countdown, red = down (hatch fill, never flat), violet = observer decisions, slate = neutral/monitoring. Oracle vocabulary always mono. A band's *label* is set in the hue's `*-ink` token (`--tl-ink` … `--vi-ink`, `tokens.css`), not in the hue: in the light palettes (standard and colour-blind) the ink is the hue darkened to at least 4.5:1 on the band's own fill, in the dark ones it is the hue itself; strokes, dots and braces keep the plain hue so the bands stay pale. A red label sits on a ground of its own fill so the hatch never crosses it. `test/ui/contrast.test.ts` reads `tokens.css` and pins every tone in all four palettes.
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
            canvas/ TopoCanvas.tsx layout.ts routing.ts NodeCard.tsx LinkPath.tsx SiteRect.tsx aria.ts measure.ts
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

**Mode names.** The modes are labelled Build / Simulate / Config / Learn. The internal ids stay `'break'` and `'configure'` (as do `BreakRail`, `ui/break/`, the `m-break` classes); only the labels and the address changed. The `mode` URL key writes `simulate` and `config`, and reads either those or the old `break` / `configure`, so older links keep working.
Derived (one file, one direction): `primaryId`, `issues = validate(...)`, `errors`, `redoGraph` (null when no database holds the primary role, which the panels and generators read as "nothing to say"), `drawnGraph` / `drawnGeometry = layoutTopology(...)` (never null: the drawing falls back to the same document with no edges, `edgelessGraph`) and `geometry` (the drawn one, or null with no redo graph, for the surfaces that draw the redo), `trace = simulate(...)`, `frame = stateAt(trace, tNow)`, `outcome`, `readout`, `scripts = {dgmgrl, dests, tns, show(frame)}` — `SHOW CONFIGURATION` takes `frame` so scrubbing walks it through states. No component computes domain state locally. `trace` budget ~8 ms; if slow, compute in an idle effect and mark `.is-stale` (never a spinner).

**No primary stays on the drawing.** When no database holds the primary role the canvas does not blank out (that left no card to click, and so no way to repair the configuration from where it is drawn). `CanvasSlot` draws every card where the layout puts it, with no redo lines, over `drawnGraph`; the stand-in graph keeps each member's place (its depth and feed path under the first database) so the cards do not reshuffle the moment the role goes. A compact error-toned card with `role="alert"` (`.cv-invalid`) says `Not a valid Data Guard configuration` / `No database has the primary role.` In the floating layout and in the popped-out canvas it is positioned at the top of the stage, between the palette and the inspector, and the drawing is given the row it needs; docked (Configure, Learn's workbench, the narrow viewer) it is a row in the stage's own flow. Where the viewport can edit it offers `Make <name> the primary` for each of the first three databases (the same `setPrimary`, one undo step; more than three adds a line that any database can be given the role from its card or the inspector; no database says one is needed); a read-only view gets the message alone. It is the canvas's own chrome, not the toast and not a finding: `MEMBER.PRIMARY_COUNT` and the chips are unchanged. The Detailed timeline, the diagram figure and the report keep their own "nothing to draw" notes (`redoGraph` and `geometry` are still null).

**URL**: fragment `#t=<base64url(deflate-raw(JSON(compact doc)))>` (fallback `#t0=` plain), 8000-char cap with an honest refusal ("too large for a link — export the file"); query keys human-readable: `ed`, `mode`, `panel`, `sel`, `t`, `preset`, `lesson`/`step`, `theme`; one exported FIELDS-style table with parse/serialize/default/clamp; unknown tokens ignored then dropped. The fragment is written **only when the Doc differs from the preset it names** — compared by value on the codec's wire form, so `?preset=classic` alone is the whole address until the first edit and again after undoing back to it; `?preset=` stays on as provenance once it does differ. Write path: effect → 16 ms timer → 300 ms debounce → `replaceState`; `tNow` excluded while playing/scrubbing. Undo never uses `pushState`.

**Undo/redo**: immutable Doc snapshots (`edit(label, fn, coalesceKey?)`, 700 ms coalescing per gesture, cap 100, user-facing labels "Undo: set LogXptMode to FASTSYNC on stby01"). View state never in history; layout drags and event injection are edits.

**Boot order**: theme ← `?theme=`|localStorage|auto; edition ← `?ed=`|localStorage|19c; doc ← `#t=`/`#t0=` → `?lesson=`/`?preset=` → legacy query/`#cfg=` upgrade (§6.4) → localStorage `dg-doc-v1` → classic; view globals from query; render; then start URL/autosave effects. Presets/lessons replace the whole Doc (reproducibility).

**Persistence/files**: `dg-doc-v1` debounced 500 ms with an 8 s "Restored your last configuration · Start fresh" strip; `dg-theme`, `dg-ed`; export `<name>.dgtopo.json` verbose; import through the same whitelist+clamp path, reporting dropped keys; `upgradeConfigV1()` reads the old `{v:1, deployment, params, sim}` shape.

## 3. Screen layout / IA

Four modes, one persistent canvas (the canvas never blinks):

| Mode | Right rail | Bottom row | Canvas |
|---|---|---|---|
| Build | Inspector: `Add` group, then the summary and the config form (folded sections) | Validation issues + steady-state readout | select, drag, `Add` toolbar in the corner |
| Simulate | The event list, then the scenarios (six legacy ones as one-click templates), then validation | Timeline + sticky transport + readout | click or `E` → the action bar's grouped events; cards tinted by `frame` |
| Config | Inspector narrowed | Tabs under two headings — **Files**: DGMGRL · LOG_ARCHIVE_DEST_n · tnsnames/JDBC · SHOW; **Behaviour**: Application view · Commit · Reopen | 180 px live strip |
| Learn | — | — | prose-left (60ch) / live workbench-right (step header + drawing + readout + timeline) |

As built, three things in that table are worth spelling out:

- **Where Simulate's events come from.** The rail is the reader's events and nothing
  else. What can be added to a selection is the action
  bar a click opens (§3d), the quick icons on a card, and in Lanes the card, data-centre
  and link buttons with their ⋯ menus. Every one of them says when the event lands:
  the bar's header (*sby01 · at t = 12 s*), each icon's title, Lanes' *Events at t = …*
  line. The moment is the playhead and there is one clock for it: the transport's *t*
  field, in both layouts.
- **Learn's workbench is the drawing, the readout *and* the timeline**, so a step whose
  "Show me" breaks something draws its clocks beside the prose that explains them.
- **The readout is mode-aware.** Build and Config are about the configuration, so
  they read the steady state even when the Document carries events; Simulate and Learn
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
  80ch, the guidance line 112ch, lesson prose 60ch.
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
  *it* — not the status bar plus a sibling. The mode sentence (`MODE_SUB`) is the
  mode button's `title`, not a fourth band: printed under the buttons it said what
  the guidance line said one band lower, and the two of them plus the first-visit
  card put ~250 px of chrome over a 260 px stage. Undo/redo are small buttons whose `title` carries the edit they
  would reverse, and the two `WhyPill` chips beside them are gone: NOTHING TO UNDO
  YET, shouted at a reader who had not yet done anything, was the loudest text on
  the page. Share and Permalink are one control — Share copies, then leaves the
  address in the bar as a real anchor for a few seconds, so copying still does not
  depend on `navigator.clipboard`. The canonical address rides on the button as
  `data-permalink` at all times, which is what `site/smoke.mjs` follows and what a
  machine can read without pressing anything.
- **The page says what to do, on one line — in Config and Learn.** The guidance
  line under the header leads with the mode word and then says the first gesture
  (`modeGuide` in `state/view.ts`, rendered by `Guidance.tsx`). **Build and Simulate
  draw no line** (2026-09-29): their gestures are the mode button's `title`
  (`MODE_SUB`) and the stage's `aria-description`, and the band's height is the
  drawing's (the header is measured into `--bar-bottom`, so the toast and the
  floating chrome follow). Config's line says what the mode *is* before it says what
  to do in it — the word reads as "settings" and the panels are generated output,
  so the line names the settings' actual home, the inspector. The first visit gets
  a one-row **strip** of the same three clauses with a link to Learn and "Got it";
  the `?` in the header opens the whole explanation, which is also the only place
  the **keyboard map** is written down (the card keys from `TopoCanvas`, the
  playhead keys from `Playhead`, Escape from `Sheet` — nothing that is not bound).
  Dismissal is `localStorage` under `dg-intro-v1` (`loadIntro()` at boot, never
  read during a render), written by "Got it" *and* by the reader's first real
  gesture — an edit, an injected event, a change of mode — because a reader who is
  already working has either read the strip or does not need it. And a numbered
  "Start here" group at the head of the empty Build inspector, above the
  configuration summary.
- **The status bar names what it is showing and goes where it points.** The preset
  picker files the twelve under six headings (`GROUPED_PRESETS`) with a title of
  five words at most (`Preset.short`; the sentence is the option's own `title`),
  and it compares rather than trusting `?preset=`: the picker names the preset
  while the document still *is* that preset and says "Current configuration
  (edited)" once it is not. The finding count is a button — it takes the reader to
  the panel it counts, which means Build's dock, the foot of the Simulate rail (its
  drawer below 1280) or, from Config and Learn, a hand-over to Build; when
  notes are all there is, it unfolds them, because a folded note is a panel with
  nothing in it.
- **The readout is a strip of chips, not four billboards.** Label (sans, sentence
  case) + value (mono, 14 px, semantic colour) + an optional quieter second value,
  separated by hairlines, with the sentence behind each number in the chip's
  `title`. Build and Config read Protection level · Members · Fast-start
  failover · Findings; Simulate adds Outcome, New primary open, **Data loss** (the new
  primary's RPO — zero is the whole promise of SYNC and of a far sync) and Observer.
  Four 26 px numerals were the loudest thing on a page where nothing had happened
  yet.
- **Errors and warnings are open; information is folded.** `IssuePanel` (Build's
  dock and now also the foot of the Simulate rail) shows errors and warnings expanded
  and puts INFO behind a `6 notes ▸` toggle whose rows are genuinely absent until
  it is pressed. The count everywhere reads `0 issues · 6 notes`, never `6 issues`:
  errors and warnings are issues, information is a note, and a healthy preset
  raising six notes was being reported as six things wrong.
Config: generated blocks mono, scrollable, Copy button (reuse `.cfg` styling), **line ⇄ canvas cross-highlighting** via `data-member` on emitted lines (generators emit structured lines).
Learn: lesson list + prose column, steps drive the workbench beside it (descendant of `DEMOS`).
Degradation: 1024–1279 inspector as overlay drawer; 768–1023 single column with bottom-sheet inspector; <768 read-only viewer with an explicit "Editing needs a wider screen" card (nothing silently missing); print expands everything (`print.css` first-class).

- **The drawer and the sheet are modal dialogs and keep a dialog's keyboard promises**: `Escape` closes from anywhere (the listener is on the document, not on the panel), opening moves focus into the panel, closing returns it to the control that opened it. The effect hangs on `open` alone — the `onClose` callback is a new arrow on every render of the shell, and an effect that depended on it would hand the focus back while the reader was still typing.
- **The reason is said once.** On a phone the stage card spells it out ("Editing needs a wider screen…"); the drawing, the inspector, the action bar and the Simulate rail's grey controls say only that they are read-only. Three copies of one sentence on one screen is noise, not honesty.
- **Every rail is its own scroll region, and it says so.** Two shading bands, `local`-attached so each is present only while content is hidden behind it and gone at the end of the scroll, plus `scrollbar-gutter: stable`. Config gives the rail a 180–260 px strip, which is where a row cut by the bottom edge with nothing to mark it reads as a drawing error rather than as "there is more".
- **The toast is anchored to the measured bottom of the status bar**, through a `--bar-bottom` custom property written by a `ResizeObserver` in `App.tsx` (`el.style.setProperty` through a ref — the one escape hatch the policy leaves), with `calc(var(--h-top) + var(--h-status))` as the fallback. Both bars wrap on a narrow window, so their nominal heights are a guess and a toast pinned to that guess paints over the bar.
- **On paper the panels stack.** `Panels` listens for `beforeprint` and for a `matchMedia('print')` change and renders all seven tabs while either is on; no CSS rule can do it, because the tab that is not open is not in the document. Two print traps are pinned by that verification: the citation chips' `white-space: nowrap` row plus the appended `a[href]::after` URL push the page ~90 px sideways unless the row is allowed to wrap on paper, and headless `--print-to-pdf` fires neither event, so print has to be checked with the media emulated (`Emulation.setEmulatedMedia`), not with a PDF.
Chrome rules: collapsibles leave their button in place; panels are real links; `:focus-within`, never `:hover`, for notes.

## 3b. Second usability pass (as built, 2026-08-17)

Fifteen findings from reading the page as a newcomer would, fixed in one batch.
The theme running through them: *the reader must be able to see the thing they
just did, and the control that does it must sit where they are looking.*

1. **The transport is never scrolled away — and it now drives something.**
   `.tl-foot` carries the transport and nothing else, and `timeline.css` makes it
   `position: sticky; bottom: 0` on an opaque `--sf` ground with a top hairline.
   `.tl` is the sticky containing block and the scrollport is `.app-dock` in Simulate
   (`.app-rail` in wide Learn), so the foot stays pinned for the whole scroll and
   releases only at the end. Below 768 px the *page* scrolls, so the foot goes
   `position: static`, and `@media print` takes the band out beside `print.css`'s
   `.tl-transport { display: none }`. The band does not draw at all when there is
   no transport to put in it. Play was under the fold at 1280×720 and a reader
   with no visible play button reads a static picture as the whole answer.
   **The colour key is not in the band.** It shared it at first and wrapped to a
   second row at every dock width the shell uses, spending 67 px of a 226 px
   scrollport to keep permanently on screen a thing that is read once; `.tl-legend`
   is a flow child *above* the band now and scrolls with the drawing it explains.
   The hairline is what says the band is not part of that drawing.
   **And the pin only works because `.sr` moved off the `<table>`.** A table's used
   width can never fall below its min-content width, so `.sr` on the timeline's
   screen-reader table laid out ~1084 px inside a 903 px dock, gave the dock a
   horizontal scrollbar at 1280×720 and — `position: sticky` pins on one axis only
   — carried the foot sideways out of view. The clip is a block wrapper now, the
   shape `TopoCanvas` already used, and `table.sr` is gone from `base.css`.
   Measured after: dock `scrollWidth === clientWidth` (903), no horizontal
   scrollbar, the foot's first button stays put.
   **`timeline/playback.ts` is the half that was missing.** The transport had drawn
   a ▶ since the timeline landed, `playing` had always flipped its glyph and Space
   had always been bound to it, but nothing ever advanced `tNow`: the button
   changed its own label and the drawing stayed exactly where it was, so the band
   this item pins was pinning the proof of its own justification. `usePlayback` is
   a UI-layer frame loop — the engine is pure and has no clock — and it leaves
   through the same `onSeek` a drag uses, so playback is not a second way to move
   the playhead. Two behaviours are choices, not consequences: the end **stops**
   (the playhead lands on `t1` and `playing` goes false, because a button that
   stayed "Pause" at the end is the same lie in a smaller form), and ▶ *at* the end
   rewinds to the start of the axis, because doing nothing there is
   indistinguishable from the bug. While it runs it owns the playhead and writes
   its own position out every frame rather than reading `tNow` back in — `tNow` is
   a render behind the frame that wrote it — so reaching for the playhead (a drag,
   an arrow key, a step button, the time field) **pauses** rather than being
   overwritten a frame later. `prefers-reduced-motion` is deliberately not a gate:
   this motion starts because the reader pressed a button and is pausable,
   stoppable and scrubbable (WCAG 2.2.2).
2. **Adding something is offered where the reader is looking, three ways from one
   table.** `inspector/adds.tsx` holds `ADD_ACTIONS`, `AddPalette` and
   `AddToolbar`, so a label and a refusal cannot drift between surfaces. What the
   buttons *write* has to be true too: `+ Data centre` minted an id the document
   already held, because `nextName` returns the two-digit `dc01` beside
   `dc1,dc2,dc3` and stripping the zero handed back the taken `dc1` — a second
   card answering to one id, a `dc1-dc1` self-link, and a `removeSite('dc1')` that
   took both. It scans the whole id namespace for a free name now, and `addLink`
   refuses an end no data centre answers to. (a) The
   empty Build inspector renders `Start here` → **Add** → `This configuration` →
   `ConfigForm`; "…with the buttons below" is now true, and the empty rail's
   scroll height fell 4 177 → 1 692 px. (b) `ConfigForm`'s five groups are `Fold`s
   (`controls.tsx`) — a real `<button class="grp-tog" aria-expanded>` filling the
   header row, a caret, and a right-aligned mono hint while shut
   (`ENABLED → sby01`, `MAXAVAILABILITY`). Children are `{open ? children : null}`,
   genuinely absent, never hidden by CSS; state is the module-level `openSections`
   in `inspector/sections.ts`, never in the Document, the undo stack or the URL.
   `sectionOfRule()` maps rule-id prefixes to sections and a `useLayoutEffect`
   unions the flagged ones open (layout, not ordinary: preact defers `useEffect`
   past paint), union-only so the reader can fold them shut again; every fold
   opens under `printing`. `revealForFlagged()` keys that on the last flagged set
   in module state, because `ConfigForm` unmounts on every card selection and a
   remount is not a new error — without it a fold the reader closed re-opened the
   next time they cleared the selection. Clicking a row in `IssuePanel` opens its
   section too, at *every* severity: errors get it as a side effect of that
   effect, and a warning or a note that lands the reader on a rail the property
   is genuinely absent from is a button that does not go where it points.
   (c) `AddToolbar` is a `role="toolbar"` at the top right of the stage
   (`.cv-add`, Build only, pure CSS), drawn *before* the drawing so tab order
   reaches it first. It is in `.app-stage`'s own column flow, not floating over
   it: the strip wraps to a second row and stacks a refusal of up to 30ch under
   any button it greys, so it has no fixed height and any constant of clearance
   handed to the drawing is wrong in some state. `flex:1 1 0` on `.tp-wrap` scales
   the drawing down instead, at any strip height, and the `graph === null` card
   is clear for free. It carries the keyboard contract its role announces (APG):
   one tab stop, roving `tabindex`, ArrowLeft/Right and Home/End, with the stop
   parked on the first *enabled* action so a disabled button cannot swallow it.
3. **`Add ▾` sits beside `Clear` in the inspector header** (`addOpen` in
   `Inspector.tsx`), and opens `AddPalette` as a `Group` in flow directly under the
   sticky header — a disclosure, not a popup. Selection survives it; adding from it
   closes it, and so does selecting another card: the disclosure belongs to the
   subject its header names. `aria-expanded` alone carries the contract, no
   `aria-controls`, exactly as `Fold` does it — the palette is genuinely absent
   while the disclosure is shut, so the reference would name nothing. Before this,
   a reader with a card selected had no way to add anything without first clearing
   the selection. `AddPalette`'s three pickers hold the reader's last choice as a
   *preference* and take their value from the document every render, because the
   document moves under an open palette (undo, a removal) and a `<select>` naming
   something gone renders blank while the button beside it stays live; `+ Link`
   refuses in four rungs — no data centre, only one, the same one twice, already
   linked — so the blank is never the live half of that pair.
4. **The Simulate rail leads with the reader's own work.** Order is now
   **Events → One-click scenarios → Validation** (`BreakRail.tsx`). Injecting an
   event and finding no record of it — six scenario blurbs had pushed the list a
   thousand pixels down — reads as "nothing happened". The event numerals match
   the timeline's markers (`--rd`, 19 px, 10 px/600 mono). Each scenario is one
   row: the button, and its description on one clipped line with the full sentence
   as the row's `title`, unclipping on `:focus-within` (never on `:hover` alone —
   a hover rule reflows the rows below and moves the button out from under the
   cursor), with one `Show descriptions` toggle (`scenarioNotesOpen`) opening all
   six and print opening them too. Six rows: ~700 → 458 px.
5. **Two clocks on the readout strip, each named** (`Readout.tsx`,
   `styles/readout.css`). Simulate and Learn lead with a `Drawing at t = <n> s` chip
   and move the run's chips into `<div class="ro-run">` behind a sans `Run` label.
   Unlabelled, "Outcome failover / New primary open 45 s" beside a drawing frozen
   at t = 0 read as one reading taken at one instant. `fmt` **and `clampToAxis`**
   are imported from `timeline/build`, so the readout, the playhead badge and the
   transport's time field cannot print the playhead differently. Sharing only the
   formatter was not enough: the strip printed `tNow` raw while the other two
   clamped, so `?t=200` on a 63 s axis read "Drawing at t = 200 s" over a badge
   saying 63.25. `axisSpan`/`clampToAxis` are one formula for the axis, exported
   beside `fmt`. **Findings sits outside the `Run` group**, beside the playhead
   reading: it is the validator's answer about the *configuration* — `derived.ts`
   keeps the run's own findings deliberately out of `issues` — and under the label
   it would say "Run · Findings no issues" at the very moment the run raised the
   warning that blocked the failover. The partition is by chip id, which is
   stable, not by position. And the playhead now **lands on the
   result**: `lastInterestingT` is exported from `timeline/build`, and
   `restPlayhead()` (`break/events.ts`) sets `tNow` to it at the end of `runAction`
   (timed events only — a property holds from the first frame), `applyTemplate` and
   `clearEvents` (which sends it back to 0). Injecting a crash and being left
   staring at the pre-crash frame was the single most common way to misread the page.
6. **One clock for where an event lands.** The transport's *t* field is the playhead, the bar and the icons aim at its snapped value
   (`snapT`, `break/events.ts`) and say so: the bar's header reads
   `<selection> · at t = [n] s` and each quick icon's title ends `· at t = [n] s`.
7. **Less chrome over the stage.** The mode subtitle band is gone — `MODE_SUB` is
   the mode button's `title` now, because printed under the buttons it said what
   the guidance line one band lower already said. `Guidance.tsx` renders one line,
   `<b class="guide-mode">Build</b> · Click a card, …`. The first visit gets a
   one-row `IntroStrip`, not a card; the whole explanation is what the header's `?`
   opens. `useDismissOnFirstUse` installs a signals effect after the first paint
   (so boot's document restore cannot trip it) and the first edit, injected event,
   preset load or mode change writes the same `dg-intro-v1` "Got it" writes — a
   reader already working has either read the strip or does not need it. Header on
   a first visit: 250 → 147 px, and 113 px once the strip goes. The header's `?` is
   a **toggle** and says so through `aria-expanded` — a second press closes the
   card — and closing it that way writes nothing to `dg-intro-v1`: opening an
   explanation and shutting it again is not the same as having read it, and "Got
   it" stays the only control that claims otherwise.
8. **Config says what it is before it says what to do in it — and the line
   names the rail where the rail actually is.** `modeGuide(m, v)` and `railWhere(v)`
   (`state/view.ts`) replaced the constant `MODE_GUIDE`. Config reads "Generated
   from the drawing — DGMGRL, init parameters, connect strings. Settings are in
   *<railWhere>*": the mode name reads as "settings" while the panels are generated
   *output*, so the line names the settings' actual home. That home moves. The rail
   is a column beside the drawing only at `wide`; below 1280 it is a `Sheet` reached
   from the status bar's Inspector button, so a fixed "the panel on the right"
   pointed two of the four viewport classes at the wrong edge. `railWhere` is one
   helper because Build's "+ buttons at the top of …" names the same rail and the
   two must not drift. `Guidance.tsx` reads `viewport.value` in the component body,
   so the line re-renders when the window crosses a breakpoint. `MODE_SUB` — a
   `title`, one string for every width — no longer names an edge at all. Mode name
   and URL value unchanged.
9. **The preset picker names a preset only while the document is one.**
   `presetState()` (`StatusBar.tsx`) delegates to `isPristinePreset()`
   (`state/url.ts`) and keeps only the lookup, which is the picker's alone: an id
   no build of this page knows is not an edited preset, it is no preset at all. The
   first option reads "Current configuration (edited)" the moment the document
   differs. It had its own key-sorted canonicaliser and its own per-id cache beside
   the write path's — two answers to the one question "is this still the preset it
   names?", which is exactly how the picker and the address bar come to disagree
   about one document (see item 11). The twelve are filed under six `<optgroup>`s
   (`PRESET_GROUPS` / `GROUPED_PRESETS`) with `Preset.short` (≤ 6 words, which is
   what the data and `test/ui/statusbar.test.ts` both hold every one of them to) as
   the label and the old sentence as the option's `title`; ids unchanged. Reset and "Start fresh" set `presetId` to `null` rather than
   `'classic'` — both build the classic *deployment* in its steady state, while the
   `classic` preset carries a crash at t = 0, so claiming the id made the picker say
   "edited" about a document nobody had edited.
10. **A refusal that would be said three times is said once, quietly.** With
    nothing down, every restore refuses for the same reason and
    three copies of the shout were the loudest thing on the drawing. `isRestore()`
    (`break/events.ts`) and a filter on `WHY.nothingDown` drop those *entries* and
    put one `.cv-bar-quiet` line (the action bar's, `breakBar`) in their place — the reason stated, not hidden.
    The action table is unchanged, so `actionsFor` still reports them.
    **The sentence is read off the subjects, never off the list it stands in for**,
    because the list is an intersection that keeps the first *blocked* subject's
    reason — one cut link selected beside a whole one collapsed both restores to
    `WHY.nothingDown` and printed "nothing here is down" over a drawing showing a
    cut line. `anythingDownUnder()` (`break/events.ts`) answers that question about
    the selection, and the line branches four ways: "The other restores are not
    listed — nothing else here is down." when a restore is live, "Restoring is not
    offered for all of these at once…" when only part of a multiple selection is
    down, "This one is up — what is down sits inside it…" for a single subject that
    is up but contains something down, and "Nothing to restore — nothing here is
    down." only when nothing is.
    **`isDownAt()` folds containment**, because it read event *kinds* alone: a
    `host.down` left the database on that host looking up while the canvas drew it
    hatched red and dropped "Start prm01" into the silent group. A data centre holds
    its hosts, a host holds the instances and the observer on it, a member is down
    once every instance is; sites and links have nothing above them. A restore whose
    *container* is still down is not in the silent group at all — the simulator keeps
    down hosts, sites and members in separate sets, so `member.up` under a dead host
    would draw nothing — it stays listed, grey, naming what to bring back first
    ("dc1-prm01 is down: restore the host first."). And `observer.start` refuses with
    `WHY.nothingDown` like the other five restores rather than its own "It is running
    already.", which had kept a grey restore drawn directly above the line that
    replaces it.
11. **An untouched preset is its own address.** `state/url.ts` writes `#t=` only
    when the Doc differs, by value, from the preset it names: `stableJson()` sorts
    keys recursively (arrays keep their order — in a Doc, order *is* meaning),
    `presetFingerprint()` caches exactly what boot builds from `?preset=<id>`, and
    `canonicalTail()` is the one place that composes `?query#fragment`, so the
    address bar and the Share button can no longer disagree. `isPristinePreset()`
    is **the only comparator** — the picker asks the same question of the same
    document and asks it here (item 9) — and it memoises the Document's fingerprint
    on object identity, so the status bar no longer serializes the whole
    configuration on every render. `?preset=` **stays on** after an edit — the
    field's contract is provenance, and both the picker and the learn route read it
    that way. Undoing back to the preset drops the fragment again, and that is only
    true because **provenance travels with the undo snapshot**: `HistoryEntry`
    carries the `presetId` the edit started from and undo/redo restore it
    (`state/history.ts`), read before the mutator runs. Two edits move the document
    and its id at once — Reset lands on the classic deployment and drops the id, a
    live lesson-step open lands on the step's topology and takes the lesson's — and
    restoring half of that is a document that *is* a preset while the picker and the
    address bar say it is not. `site/smoke.mjs` follows `data-permalink`; it now unescapes before
    matching, accepts either a `#t=` document or a short preset link, and takes the
    legacy-link phase's permalink to keep the real-browser CompressionStream
    round trip.
12. **The finding count is a button that goes where it points.** `revealFindings()`
    (`IssuePanel.tsx`) unfolds the notes when notes are all there is (sending
    somebody to a panel whose whole content is behind a toggle is sending them to an
    empty panel), hands over to Build from Config and Learn, opens the drawer in
    Simulate below 1280, then scrolls `.issues` into view on the next task. It was a
    piece of text about a panel the reader had to go and find — and in two modes
    about a panel that is not on screen at all. **Leaving Learn is the one hand-over
    that costs the reader something** — the lesson they were reading goes off
    screen — so it says exactly that in a toast and offers "Back to the lesson"
    rather than swapping the page out from under them in silence. Nothing is lost:
    `lessonId`/`lessonStep` are session state, so Learn comes back on the step it
    was left on. And **clicking a finding row opens the fold its property lives in
    at every severity** (`sectionOfRule` → `revealSections`), not only for errors:
    `ConfigForm` opens an errored section by itself and nothing played that part for
    a warning or a note, which left those rows landing the reader on a rail the
    property is genuinely absent from. Purely additive, so it never fights that
    effect and is a no-op on an open section.
13. **The seven Config tabs are filed under two headings.** `PANEL_GROUPS` —
    **Files** (DGMGRL · `LOG_ARCHIVE_DEST_n` · tnsnames/JDBC · SHOW) and
    **Behaviour** (Application view · Commit · Reopen) — inside the one existing
    `<nav class="panel-tabs">`, each an `role="group"` opened by a real visible
    `<span class="panel-group-lbl">`, so nothing is grouped by styling alone.
    **Case does the separating, not the face.** "Files"/"Behaviour" are this page's
    words about the tabs rather than Oracle vocabulary, so they are set the way this
    page sets prose — sans, sentence case, 11 px, no tracking — against a row of
    mono uppercase tabs. The face alone could not carry it: three of the seven tab
    labels ("Application view", "Commit", "Reopen") are this page's words too, and
    system-ui against ui-monospace is not legible as a distinction at label size.
    No opacity either — in this application a faded thing is a *switched-off* thing
    (`shell.css`), and it costs contrast a 3.6:1 ink token has none to spare. Tab
    ids, `panelHref()`, the `panel=` key, the dgmgrl badge and print are untouched.
14. **Learn's workbench names the step it is set up for.** `LearnWorkbenchHeader`
    (`learn/LearnShell.tsx`) is a sticky `.lwh` above the drawing: `Step 3/14` plus
    the step's title on the left, `Open in Simulate` / `Open in Build` on the right.
    Both go through `openStepInMode()` (`learn/route.ts`), which is exactly what
    `LessonStep`'s own button already did, so the prose button and the header button
    are one function. With no lesson open it says "No lesson open — the current
    document" and the buttons only switch mode. The header's buttons used to refuse
    on the narrow read-only viewer with `WHY.readOnlyHere` while `LessonStep`'s did
    not, so on a phone one was grey and one was live; **the gate is gone, and the
    ungated pair is the one that was right.** `canEdit` is about the controls that
    *change* a configuration — the inspector, the canvas, the action bar — which a
    phone has no room for. Following a lesson step is not one of them: the step's
    own "Show me" and "Open in Simulate" in the prose column are ungated at every
    width, and so is arriving on `#/learn/<lesson>/<step>` from a link, so greying
    these two refused the reader an address they reach by scrolling down the same
    page. A refusal that restricts nothing is not a refusal. Two layout facts the
    header depends on: `.lwh` goes `position: static` at ≤ 767 px, where the page
    and not the dock is the scroll box, matching `.tl-foot` (item 1) and `.cv-add`;
    and Learn's ≤ 1279 override in `shell.css` had dropped the `dock` grid area, so
    `.app-dock` was auto-placed into an implicit third column and head and stage
    laid out at zero width — Learn inherits the one-column head/stage/dock areas and
    the base three-row template now.
15. **The keyboard map is written down where the page explains itself.** The `?`
    card carries a `Keyboard` section — three two-column definition lists, keys in
    mono — read out of the handlers first: `TopoCanvas`'s `onCardKey` (arrows,
    Enter/Space, `E`, Delete/Backspace, Escape), `Playhead`'s `onKeyDown` (Space,
    ←/→ with the Shift 0.1 s step, Home/End, `.` and `,`) and `Sheet`'s document
    Escape. Nothing is listed that is not bound, and no handler was changed to
    match the list. A key bound in one mode says which one: `E` reads "open the
    events it offers, at the playhead, and move the focus into them (Simulate)", the way
    the `Delete` row beside it already named Build, because `onEvents` reaches the
    canvas in Simulate alone (`canvas/CanvasSlot.tsx`); it opens the same bar `Shift+F10`
    does.

A new stylesheet came out of this, on purpose: `styles/readout.css` (imported by
`Readout.tsx`). It contains only new class names and overrides nothing in `shell.css`
or `inspector.css`, so cascade order against it does not matter.

One new module came out of it too, and it is the only one that is not chrome:
`timeline/playback.ts` (item 1). It is a hook, not an engine addition — the
engine has no clock and is not allowed one — so nothing under `engine/` changed
to make the page move.

## 3c. Pruning the prose (as built, 2026-08-19)

**One switch for every sentence that explains a control.** The verdict was
"prune the visible text a lot more -- it should still be there optionally
visible": the rail carried a line of documentation
under every field, all of it true and all of it on screen at once, so a reader
who came to move three sliders read four screens to reach them.
`hintsOn` (`state/view.ts`, default **false**, remembered under `dg-hints`
and read once at boot by `loadHints()`, never during a render) gates
`Note`, `Field`'s note, `FieldNote` and the second clause of the guidance
line (`splitGuide`). A hidden hint is **not rendered at all** — there is no
rule anywhere that paints one out of view — and `hintsShown()` is
`hintsOn || printing`, so paper gets every word, exactly as every `Fold`
opens there. Three kinds of line are not hints and never leave: a caution
(`warn`, which reports the state the reader is looking at), an empty state
or a count (`always`), and a refusal — `WhyPill` is untouched by the
toggle. The switch itself is a quiet `aria-pressed` button in the inspector
header, beside `Add ▾` / `Clear` and present on the empty rail too, which
is where a reader who wants the prose back is looking; the `?` card
explains it and offers a second copy of the same button. With hints off the
button is the only thing that says the explanations still exist, so its
`title` is "Show the explanation under each control".

## 3d. The drawing as the workbench (as built, 2026-08-19)

The verdict this round: *"the topology diagram should be the main centre point
… a user could click on each component and modify its properties or remove
it."* Five things landed, and one rule bent:

- **An action bar opens on the drawing itself.** Clicking a card, a data
  centre's name band or a link's caption selects it *and* opens a small menu
  anchored to it — Build offers the Build table's entries (Edit · the
  transport as three pressed/unpressed chips · Make it the primary · the RTT
  nudges · Remove, each with its `WhyPill` refusal), Simulate offers the
  grouped list of events for that subject, quiet restore line included
  (`breakBar` over `actionsFor` and `restoreQuietLine`; Lanes' ⋯ menu calls the same
  function), under a header that says *at t = [n] s*. In Simulate a plain click opens it;
  in Build a click only selects. `Edit` puts the
  rail on the subject — and below 1280 it also opens the drawer
  (`openInspectorFor`), which a bare selection deliberately does not.
  The bar caps at seven rows (six until `+ Instance` joined a database card) and hands the rest to the panel; it closes on
  Escape (before the selection clears), on a background click, on a mode
  change, or by selecting something else. `Shift+F10`, the ContextMenu key
  and the right button open it with focus inside; a plain click opens it
  without stealing focus from the card.
- **The "never a popup" rule bent, inside its own justification.** §3's ban
  was argued from `style-src 'self'`: nothing can be *positioned from
  script*. The bar is not: it is a `<foreignObject>` inside the SVG, placed
  by `x`/`y` presentation attributes in the drawing's own coordinates
  (`canvas/anchor.ts` — below the anchor, flipped above, stepped beside when
  neither fits, always clamped into the viewBox because the stage clips ink
  silently), wrapped in a `scale(1/k)` group so its text stays ~12 px however
  far the drawing is scaled down (`fittedScale` caps the magnification at
  what still fits the view; `k` is measured by a `ResizeObserver` in
  `CanvasSlot`, 1 in jsdom). The inspector keeps the full forms
  and Lanes keeps its own buttons — the bar is a second surface over the same
  tables (`build/actions.ts`, `break/events.ts`), and in Build never the only place
  an action lives. (Simulate's rail no longer lists events to add, so there the bar and
  the quick icons are how a selection is asked for its events.)
- **One Build action table.** `ui/build/actions.ts` is the sibling of
  `break/events.ts`: label, refusal and act written once, consumed by the
  rail's Remove buttons, the bar, the context menu and the Delete key
  (`deleteFromCanvas` shrank to a lookup — and gained sites and links, which
  used to swallow Delete silently).
- **Drawn lines are removable.** A click on a line selects the link it rides,
  and removing that link only severs the line (drawn cut, plus a finding). So
  the link's rows also carry one removal per line riding it (`build/routes.ts`
  enumerates them), after its properties and before its own `Remove`, which
  stays last and stays what Delete and the rail header mean (`removeAction`
  looks up the id `remove`). A line with no link under it is selected by its
  own key (`redo:A:B`, `connect:APP:M`, `ping:O:P`, `check:O:T`) and gets a
  rail and a bar of its own. Remove on redo edits the sender's RedoRoutes
  (`routesWithout`, the mirror of `shipRedo`; refused when it is the sender's
  only destination, since NULL is `(LOCAL : ALL)` again); on an address it
  takes the member off the ADDRESS_LIST; on a readiness check it takes the
  member out of an explicit FastStartFailoverTarget (grey under ANY); the
  observer's ping is grey — it goes with the observer. The `…` handle is drawn
  only over a selection whose bar would offer something.
- **Sites and links are controls now.** The site rect and the link's caption
  pill carry `role="button"`, a lower-case `tabindex`, an `aria-label`
  (`siteLabel`/`linkLabel` in `canvas/aria.ts`), hover/focus styles and the
  same key handler as the cards. Tab bands: one stop per site rect, one per
  site's cards (roving, as before), one for the whole link set (the arrows
  walk the captions in routed order).
- **A real mouse click never selected anything — fixed.** Pointer capture on
  `pointerdown` retargets the pointerup *and the derived click* to the svg,
  so the card's own `onClick` never fired for a genuine mouse; every test
  passed because tests dispatch `click` directly. Capture now waits for the
  drag threshold (`onPointerMove`), which is the only moment the pointer can
  leave the drawing mid-gesture. If a drag ever feels lost on a fast flick,
  this is the line to look at.
- **The drawing zooms and pans.** (Simulate's Split sizes the drawing by its region until the
  reader zooms: `zoomAuto`, `autoFactor`, see "Simulate's two layouts".) `canvas/zoom.ts` holds a six-rung ladder
  (50–140 %) as view state — not in the Document, the undo stack or the URL.
  Zoom multiplies the svg's `width`/`height` *attributes* and leaves the
  viewBox alone, so routing, goldens and the bar's arithmetic see the same
  drawing; at 1:1 nothing changes and the crispness rule holds. Past 1:1 the
  `.tp-wrap.is-zoomed` becomes the scroll port (not the stage, so the `+`
  toolbar and the zoom strip stay put in both axes), a background drag pans
  it (lazy pointer capture, same threshold as a card drag), and the wheel
  steps the ladder (summed, `WHEEL_NOTCH` per rung, so a trackpad or pinch
  does not fly through it) keeping the point under the pointer fixed. The
  `−`/`+` buttons go grey at the ends with the reason in their `title`, the
  one grey control that explains itself in a tooltip rather than a `WhyPill`
  beside it: a sentence under a one-glyph button doubled the strip's height
  on every reach for 140 %. In Config and Learn the factor is forced to 1
  and the strip is absent.
- **Double-click a card to rename it**: the rail opens on the member and the
  name field takes the caret (`focusField`, a one-shot signal the `Text`
  control reads and clears). A rename to a name already taken is refused out
  loud now (`WHY.nameTaken` in a toast) instead of silently snapping back.
- **Build's stage takes the room** (`.app.m-build` rows
  `auto minmax(260px,1fr) minmax(0,auto)`, dock capped at 46vh): the drawing
  renders at 1:1 in Build instead of the ~60 % the fit-content row forced.
  Simulate keeps the fit-content stage — the timeline is that mode's point.

## 3e. The Introduction (as built, 2026-08-19)

The verdict: *"make an Introduction website which would kinda explain what's
going on and explain more in detail what to do"*, and of the first draft,
*"it's again a lot of text still — make it a little bit more useful, usable and
nicer"*. So it is a **page**, not another band of chrome over the workbench,
and it is read by scanning.

- **What it is.** `ui/intro/IntroPage.tsx` — six bands: a hero with the one
  sentence and three buttons; *What you are looking at* (the classic preset drawn
  by `TopoCanvas` with `interactive={false}`, and five numbered callouts under
  it); *The four modes* (four cards, each with a concrete "Try it"); *How to do
  things* (eight one-line gestures as a `<dl>`); *Five words* (the glossary);
  and a foot pointing at the frozen page. Prose is capped at 64ch (`--ip-col`),
  bands are 44 px apart, and the band number sits in a left gutter beside the
  heading rather than on a line of its own. `styles/intro.css`, tokens only, no
  new colour, both themes, single column under 900 px.
- **It takes the whole workbench area.** `App.tsx` renders `<IntroPage/>` inside
  `.app-stage` and renders no rail, no dock and no drawer while it is open;
  the grid becomes `.app.m-intro` (one column, `head` / `stage`, rule in
  `intro.css` — `shell.css` is untouched). The header stays, with the modes
  live, because the way out of an introduction should be the way around the
  application. The document row and the guidance line do not: over a page whose
  drawing is a picture they would be a preset picker and a "click a card" for
  nothing. The `?` still works — `IntroCard` is exported from `Guidance.tsx`
  and rendered in the header here, because a control that silently does nothing
  on one page is worse than one that is not there.
- **It has an address: `?intro=1`.** A key in the `URL_FIELDS` table like any
  other (`intro`, parsed only as `1`, written only when true), carried by
  `introPage` in `state/view.ts`, round-tripping through
  `currentUrlState`/`applyUrlState`. It is a page rather than a fifth `mode`
  because the mode buttons stay live underneath it.
- **Three ways in, and none of them is boot's own idea.** A first visit lands on
  the Topology workbench (the default `mode`, `build`); the Introduction opens
  only when it is asked for (2026-10-03 — it used to open itself on a first
  visit). (a) its address, `?intro=1` — the only thing `introOnBoot` in
  `ui/intro/route.ts` looks at. (b) the header's brand link, "Data Guard" — a
  real `<a href="?intro=1">`, so a middle click opens it in a tab and a reload
  keeps it, and a plain click calls `openIntro()`. (c) the same link in the `?`
  card. A share link, a preset or a lesson link is therefore never in danger of
  being hijacked, and there is no longer a rule to keep in step with the keys
  the address can carry (`ADDRESSED` is deleted).
- **`dg-intro-v1` changed meaning, and the strip is gone.** The key used to say
  "the first-visit strip has been dismissed"; it now says "this reader has been
  shown the Introduction". It is written by leaving the page — every mode
  button (`TopBar`), the hero buttons and every "Try it" go through
  `leaveIntro()` — and, for a reader who went straight to work, by their first
  real gesture (the effect in `Guidance.tsx`). Since 2026-10-03 it is a record
  only: boot does not read it, because nothing opens the page on a first visit.
  Closing the `?` card writes nothing, as before: its button says **Close**
  now, not "Got it", because reading a keyboard map is not being shown the
  Introduction. The one-row `.intro-strip` and its `CLAUSES` are deleted;
  `header.test.ts`'s "first-visit strip" suite is now "what writes
  dg-intro-v1", and `test/ui/intro.test.ts` pins the rest.
- **Every button loads before it switches.** `route.ts` owns the jumps: preset
  first (`replaceWorkingDocument`, one undoable step that keeps the reader's draft), then the Simulate
  template if the button named one (`templates`/`applyTemplate`, so the
  scenario is the engine's own `scenarioEvents` and the playhead rests on the
  outcome), then the panel tab, then the mode — the same order
  `learn/route.ts` uses, for the same reason. *Start with the classic 1+1+1* →
  classic in Build; *Watch a failover* → classic + `crash` in Simulate; Build →
  classic; Simulate → far sync zero-loss + `isolated`; Config → classic on the
  DGMGRL tab; Learn → lesson 1, step 1.
- **The claims are labelled here too.** Two `<Fact>` chips carry the only two
  Oracle sentences the page quotes (observer placement, and what fast-start
  failover waits for); everything else on the page describes the *tool*, which
  needs no citation. The foot says it in one line: everything here is a model,
  documented facts carry their source.

## 3f. Density pass (as built, 2026-08-19)

The verdict: *"please space it out a little bit more. It looks kinda cramped.
It's again a lot of text still. Make it a little bit more useful, usable and
nicer."* Two readings of one sentence — a rhythm that never chose a number
twice, and text that a `Hints` toggle had made optional without making it
fewer. One bullet per change.

- **One ladder, in `tokens.css`.** `--s1..--s7` (4–28) and `--gut: 20px`, and
  every gutter in the shell and the rails is now that one property rather than
  a 16 typed in forty places. The three header metrics grew with it:
  `--h-top` 48 → **56**, `--h-status` 34 → **40**, `--h-readout` 38 → **44**.
  A 48 px band around a 24 px control is 12 px of air; at that ratio a band
  reads as a rule, not as a row.
- **The button is the unit.** `.btn` 4/10 at 11 px → **6/12 at 11.5 px**, and
  `.seg button` with it, so a button, a segment and a field box are the same
  height wherever they sit. Two places contradict it on purpose and say so in
  the stylesheet: the rail header (`Hints · Add ▸ · Clear` beside a name in
  360 px) and the strips over the drawing, which are chrome over the
  workbench. `.field` 11/16 → **12/20**, `.grp-hd` → **18/20/10**, `.grp`
  gains 10 px of foot: **28 px between two groups**, where the label of the
  next one used to sit closer to the last row of the previous.
- **Prose went up, not down.** `body` and `.prose` 15/1.55 → **15/1.6**,
  `.caption` 11.5 → 12/1.5, `.field-note` → 12/1.5, `.issue-b` 13 → 13.5/1.55,
  `.empty` 13 → 13.5. The eyebrow keeps 10.5/.08em and gains its air from the
  group header, not from a margin of its own.
- **The readout is a strip with room in it.** 9/16 → **12/20** padding,
  chips 16 → **22 px apart**, row gap 4 → 8. Label and value stay on one line;
  the second value keeps its quieter mono.
- **Hierarchy in the header, in three sizes.** The mode tabs are the largest
  control on the page (12.5 px, 8/16) and the current one carries a **solid
  `--vi` fill with `--sf` text** — both tokens invert with the theme, so the
  pair is legible in light and dark without a new colour. The preset picker is
  second (12 px on `--sf`, the one control in that bar that changes the
  drawing). The release, theme, undo/redo and `?` are third: 10.5 px and
  `--ik3`.
- **A refusal is set as a sentence.** `.why` was mono uppercase 10 px:
  A PRIMARY APPLIES NO REDO OF ITS OWN. three times down one rail, in the
  loudest voice on the page, for a remark read once. Same pill, same place,
  same words, sans 11.5 sentence case. No `WhyPill` was removed — the
  invariant is untouched.
- **The empty Build rail opens on the palette.** `Start here` — three numbered
  sentences saying what the guidance line says in one and the Introduction
  page says at length — is gone, `.steps` with it. The four one-press
  additions are a **2×2 of full-width buttons** (`.pal-adds`); `+ Host` and
  `+ Link` are a quieter second rank under a hairline (`.pal-more`), because
  both need a data centre named before the button means anything.
- **The configuration summary is a fold.** *(Gone since 2026-10-04: the empty rail
  opens on the configuration's properties, with its name as the header's field --
  "The inspector comes when asked", below.)* `Configuration summary ▸`
  (`SUMMARY_ID` in `sections.ts`), shut when the rail opens, with the
  configuration's name as the closed fold's hint — the readout strip already
  reads the protection level, the member count and the findings. Turning
  `Hints` on *opens* it (an additive `revealSections`, exactly like the reveal
  a finding does), so the switch that asks the page to say more about itself
  opens the rail's own statement of what is drawn — and the fold stays a real
  toggle the reader can shut again.
- **A RAC standby wears an `APPLY` tag.** The instance row running apply carries a blue
  `APPLY` chip (blue = applying): in Build the instance the configuration starts on, under a
  frame the one `Snapshot.applyInstances` names -- so in Simulate the chip jumps when the
  apply instance fails, and is absent while `ApplyInstanceTimeout` runs. The timeline
  splits a standby lane per apply instance ("Applying redo — apply instance sby012"). The
  `Instances (RAC, n)` fold carries `PreferredApplyInstance` (empty = the broker chooses)
  and `ApplyInstanceTimeout`; renaming an instance carries the preference with it and
  removing one drops it. `+ Instance` puts every node of the member in one cluster
  (`<member>-crs` when it had none), which is what `RAC.OBSERVER_ON_CLUSTER` reads.
- **RAC, second pass.** A database card's bar carries `+ Instance` (seven rows, Remove
  still on it). Simulate's menu on a RAC standby offers "Move apply to <instance>" — the
  documented `SET STATE='APPLY-ON' WITH APPLY INSTANCE` as the `cmd.setApplyInstance`
  event. Under `ApplyInstances` (multi-instance Redo Apply) the coordinator's row reads
  `COORDINATOR` and the other instances applying `APPLY`. Config gains a mock
  `SHOW DATABASE` per RAC database (`Instance(s):` with `(apply instance)`, walked by the
  playhead), a `RAC -- per-instance parameters` card (`<sid>.` /
  `*.` entries, INSTANCE_NUMBER, `%t`) and a `standby-redo-logs.sql` card (standby redo
  logs per thread, on every member that receives redo), the SCAN form of
  the connect string, and static-service notes in the DGMGRL script. A tenth lesson,
  *RAC primary and standby*, walks the `rac-standby` preset. A former primary on its way
  back as a standby names, in its timeline band, the instance its apply will start on.
- **A member's tail folds.** `Instance`/`Instances (RAC, n)` and
  `Destinations` are `Fold`s now, keyed in the same open set as the
  configuration's five, so which drawers are open is a habit rather than a
  property of a card. Identity, role/apply and transport stay open: they are
  what the reader clicked the card for. `RedoRoutes` is still a plain group —
  it is `RedoRoutesEditor`'s own, and this pass did not open that file.
- **A RAC member's Instances fold opens by itself.** `Fold` takes `defaultOpen`
  (`MemberForm` passes `instances.length > 1`); a single-instance member stays folded.
  A reader's own toggle is remembered for the session in the same open set -- and a
  shut default-open fold in `shutSections`, since "absent from the open set" would
  otherwise mean "never asked" and "shut" at once.
- **An instance is selectable on the drawing.** In Build, each instance row of a RAC
  card is a `role="button"`, `tabindex="0"` control with its own `data-node`, whose
  selection key is `<member>~<n>` (`state/instanceKey.ts`; `n` is the 1-based place, so a
  rename keeps the selection). `~` is not in an Oracle name; `resolveSubject` tries every
  exact id first, so the key can only be a fallback; `?sel=` accepts it (`SEL_RE`). A click
  on a row selects the row (never additive) and stops there; a press still bubbles to the
  card, so a drag from a row moves the card. The rail shows `InstanceForm` (name, host,
  `Remove` grey with `WHY.lastInstance` on the last one, `Select <member>`); the bar and
  the Delete key offer `Edit` and `Remove` only -- nothing about the whole database.
  Simulate draws the rows as before, unselectable. A single-instance card has no rows.
- **The rail's buttons have a box at rest.** `.insp .btn` (not icon, quiet, primary,
  solid or danger) takes `--ik` text on `--sf3` with a `--ln2` edge, over float.css's
  ghost; hover darkens the fill and takes the `--ik3` edge.
- **The scenarios are a shelf.** Two columns of names, and nothing else
  (`.tmpls` grid; `is-open` drops it to one column). Six clipped one-line
  captions under six buttons were twelve rows of text for a shelf a reader
  takes one thing off. The sentence is the button's `title` at every setting,
  `Show descriptions` renders all six, and print renders them regardless —
  what is folded is **absent**, never clipped by CSS.
- **Three words dropped, and only three.** The status bar's `Preset` label is
  now `.sr` (the picker's first option names what is on screen, and the select
  carries a `title`); the validation panel's `NOTHING TO FIX` eyebrow is gone
  over a heading that already says "No errors and no warnings", leaving the
  one true sentence; the notes toggle says "documented behaviour worth
  knowing" in both states, because the caret and `aria-expanded` say which way
  it points and ", folded away" wrapped the row to two lines to say it a
  third time.
- **Two fits the 360 px rail forced.** A segmented control inside a `.field`
  goes a size down (11 px, 6/9) and may wrap, because
  `MAXPROTECTION | MAXAVAILABILITY | MAXPERFORMANCE` is 40 characters of mono
  and the control clips its own corners — a segment past the edge is one
  nobody can press. And `.insp-hd .title` ellipses on one line instead of
  `overflow-wrap: anywhere`, which broke `prm01` into `prm0` / `1` once the
  header carried three buttons; the whole name is the span's `title`.
- **Verified** at 1440×900 and 1280×720, light and dark, on classic,
  far-sync-zero-loss and multi-target-three-observers, in Build, Simulate and
  Config, through the §3b inline-bundle recipe. Nothing overflows: the
  Simulate dock still ends in its transport bar at 1280×720, and the rail is
  still in the grid there.

## 3g. Drops and lines on the drawing (as built, 2026-08-19)

Phase C of §3d, plus two defects the bar had grown.

- **The bar declares the box it paints.** `barFootprint` stayed the estimate
  the placement runs on, but `.btn` had drifted to 28 px a row against the
  25 the constants said, and the sixth row was cut off at the bottom of the
  `foreignObject`. `ActionBar` now measures its own `div` in a layout effect
  and reports up (`onMeasure`); `TopoCanvas` declares `max(estimate,
  measured)` and re-places against it. `.cv-bar .btn` carries an explicit
  `line-height: 1.3` so the estimate is near the truth again (`HEAD` 20,
  `ROW` 25), and the measurement is the guarantee.
- **A press anywhere else closes the bar.** `CanvasSlot` registers one
  `pointerdown` listener on the document, capture phase, while a bar is open:
  a press that is not inside `.tp-actions` and not on a `[data-node]` closes
  it (the rail, the header, the ground outside the drawing, the panels
  below). A press on an entity is left to that entity's click, which
  re-offers the bar there. The selection is kept — "never mind the menu" is
  not "forget what I picked"; the click on the ground between cards still
  clears both.
- **Empty data centres are drawn.** `layoutTopology` appends sites with no
  hosts-with-anything-on-them as empty columns after the last occupied one
  (`LAYOUT.emptyGap` 40 before them, not the 200 px corridor no link rides),
  one column wide and the member band tall, flagged `SiteBox.empty` and
  dashed (`.tp-site.is-empty`) with “Nothing here yet” in the middle. "Add a
  data centre" now puts something on the drawing, and that something is a
  drop target.
- **Drag a card into another data centre to move it.** A card drag keeps its
  meaning; while the pointer is over *another* site's panel (geometry
  hit-test against `geo.sites`, pointer in user units through
  `getScreenCTM`, proportional fallback in jsdom) that panel goes `is-drop`
  and says “Drop it here”, and the drop calls `onMoveToSite`. `moveToSite`
  (`inspector/edits.ts`) gives the mover a host of its own in the new site
  (`<site>-<name>`, the old host's port and cluster carried), remaps every
  instance of a RAC member together, removes the host left behind when
  nothing else stands on it (with its host links, addresses and events, as
  Remove does) and leaves it when something does, and drops the drag
  override so the card lands where the new column puts it. It coalesces under
  `drag:<key>`, so the drag and the move are one undo. Build only; in Simulate a
  drag is a drag.
- **Drag from a card's port to another card to connect them.** Every card
  in Build carries a port (`.tp-port`, right edge, visible on hover/selection/
  focus) whose press starts a `link` drag instead of a `card` drag: a dashed
  rubber band follows the pointer, the card under it goes `is-target`, and
  the drop calls `onConnect(from, to)`. `connectFromCanvas` decides the
  meaning: member → member is `shipRedo` — the target added to the sender's
  RedoRoutes rule that is active for the current primary, or a new rule
  (`LOCAL` at the primary, `ANY` elsewhere, the cascading form), with the
  receiver's `LogXptMode` named on a cascaded destination so
  `ROUTES.CASCADE_RT_ASYNC` does not fire on the very thing the reader just
  asked for; a primary on the default `(LOCAL : ALL)` already ships there,
  and that is a toast, not an edit. Member ↔ observer is `addFsfoTarget`:
  the member joins `FastStartFailoverTarget`, refused for a far sync, a
  snapshot standby or the primary in `WHY`'s words. Observer → observer is a
  sentence. The destination's `dests` row is minted at defaults so the rail
  has a row to show. `routesWith` is the one pure helper behind both, and
  `addDatabase` now runs the new standby through it on the primary: under a
  primary with explicit RedoRoutes a "+ Standby" used to arrive reached by
  nothing, which was the "why is it not connected?" of every far sync preset.
- **The line says what it will do before it lands.** `connectVerdict`
  (`inspector/edits.ts`) is the one table for the three meanings of a drawn
  line; `TopoCanvas` asks it (`connectWhat`) while the line hovers a card or
  another data centre's panel and prints the label beside the pointer
  (`.tp-rubber-tip`), or the refusal in red with the target card dashed red
  (`.is-target-no`); the drop runs the same verdict, so the toast and the tip
  never disagree. Dropped on another data centre's panel, the line adds a
  standby there and ships to it (two named undos). The panel the line started
  in is never a target — the port sits inside it.
- **A cut link has a way back whatever the clock says.** Simulate's link rows
  name what is holding it down: an injected cut at the playhead's own instant
  makes `Restore` take the cut back (no heal stacked on a cut in the same
  instant); a cut earlier gets the heal here *and* `Take back the cut at t =
  5 s`; scrubbed back before one's own cut the take-back is still offered; a
  link marked down in Build (`up: false`) gets `Mark dc1-dc2 up in the
  configuration` as a property row, and a stopped observer (`running: false`)
  the same. `runAction` runs a row with no events as an edit of the event list.
- New data centres are named `DC 4` (id `dc4`), like the presets' own.
- **The validation panel folds to its heading.** `.issues-hd` is a button
  (`aria-expanded`, `aria-controls="issues-body"`); folded, the panel stops
  stretching to fill the dock and the drawing takes the room. The counts stay
  on the heading — "1 error · 6 notes" — so the fold hides the rows, never
  the fact of them. `issuesOpen` (view.ts) is remembered under `dg-issues`
  (persist.ts; unset means open); the status bar's count (`revealFindings`)
  unfolds it, because sending somebody to a heading is sending them nowhere.
- Tests: `test/ui/canvas-gestures.test.ts` (edits on the document; the drop,
  the line and the click-away through the mounted app). The layout test for
  `classic('none')` now expects the empty third site as a panel.

## 3h. Driving the drawing (as built, 2026-09-20)

§3d and §3g made the drawing editable; this pass changed how it is *driven*, because
the gestures were all there and the page was still clumsy to use. Where §3d or §3g say
"a click opens the bar", this section supersedes them for Build. Simulate is unchanged.

- **A click selects, and nothing else.** The rail shows the form. The action bar is
  asked for: the `⋯` handle `TopoCanvas` draws on the corner of the last selected
  thing (`anchorFor`, so one implementation covers cards, name bands and caption
  pills), the right button, `Shift+F10`. The handle carries its subject's `data-node`,
  so a press on it is neither a press on the ground (which clears) nor a press outside
  the bar (which closes it before the click could toggle it). A bar that popped under
  every click sat on top of the drag or the line that usually follows one. A
  multi-selection now reaches its intersection bar through the same handle.
- **Additions are dragged to where they belong.** A toolbar chip pressed adds with the
  automatic placement, as before; *dragged*, it lands in the data centre it is dropped
  on (`add*(where)` already took the site). The chip is HTML and the panels are SVG, so
  they meet in `canvas/place.ts`: which chip is in the air, which site it is over, and
  the drawing's own hit test (`siteAtRef`, pure geometry like every other drop). The
  ghost is one `position: fixed` box moved with `el.style.setProperty` through a ref —
  the page's single escape hatch, used for the second time. Dropped on nothing it says
  where to drop it (`WHY_DROP_ON_SITE`).
- **Names are edited where they are drawn.** Double-click or `F2` opens `InlineName`:
  an `<input>` in a `<foreignObject>` over the name, placed in drawing units like the
  bar. `Enter` commits, `Esc` gives up, blur commits what it can. A refused name is
  said *under the open field* (`renameVerdict`, the rail's sentence), not in a toast
  after it closed. Every addition from the toolbar opens its own name, so add → type →
  `Enter` is one flow. A data centre renames its label; its id stays.
- **Selections act as one.** A `Shift`/`Ctrl`/`⌘`-drag over the ground is a selection
  rectangle in Build (cards only, added to the selection); the plain drag, the middle
  button and `Space`+drag pan, and the wheel zooms. Dragging a selected card carries the selection, as one edit under the
  pressed card's coalesce key (so `moveToSite` still folds into it). `Alt`+arrow nudges
  8 px (`Shift`: 32) — passed as a *delta*, so two presses inside one render add up.
  `Delete` asks `removeAction` for each selected thing against the document as it then
  is; what may go goes, the rest is named with its reason, and a clean removal's toast
  carries `Undo`.
- **`Tidy`**, in the zoom strip: drops the hand-placed offsets of the selection, or of
  everything. Grey with its reason while nothing has been moved.
- **Site links are drawn.** A port beside a data centre's name; a line to another
  data centre is `addLink`, through the same `connectVerdict` table. Cards carry a port
  on both side edges and the rubber band leaves from the side facing the pointer.
- **Page-wide keys** (`ui/shortcuts.ts`, installed once by `App`): `Ctrl/⌘+Z`,
  `Ctrl/⌘+Shift+Z`, `Ctrl+Y`, `Ctrl/⌘+A`. A key typed in a field is the field's.

Tests: `test/ui/canvas-controls.test.ts`.

## 3i. A leaner Build (as built, 2026-09-24)

The owner's ask: *"improve how the user works with the diagram when building …
simplify it a little bit, but not too much, just make it lean."* Nothing the drawing
does was taken away; what went was the second and third copy of it around the edges.

- **One place adds.** The toolbar over the drawing. The empty rail's palette (the same
  four buttons, 2×2) and the `Add ▸` disclosure in a selected subject's header are
  gone, and so is `addOpen`. `+ Host` was already on a data centre's form; `+ Link`
  moved there too, one row per other data centre (`linked`, or `+ Link`), which is the
  keyboard's way to a site link beside the port a pointer drags. The two pickers it
  replaces asked "which data centre?" of a reader who could simply select one.
- **Remove lives in the rail's header**, beside the name it would remove and `Clear`,
  reading `Remove` with the table's full label (`Remove sby01`) as its `title`. It is
  still `removeAction` — the same object the Delete key and the action bar press. A
  refusal is set on its own row under the header (`.insp-why`), because a sentence in
  the header's button row pushed `Clear` off a 360 px rail. The four footer groups
  that used to carry it (*This member / observer / link / data centre*) are gone; the
  observer's and the link's notes moved up into their forms' main group.
- **A healthy configuration's validation panel is one line**: "No errors and no
  warnings, as modelled here · 3 notes", and that line is the notes' toggle. The
  empty-state sentence under it and the separate notes toggle said the same thing
  twice more. With an error or a warning the panel is what it was (§3g).
- **The guidance line leads with the gestures that were hardest to find**: drag a
  `+` button onto a data centre, drag a card's ⊕ onto another, click to edit. Rename,
  `⋯` and where the properties live ride with `Hints`.

- **The action bar keeps off the rest of the drawing.** It was clamped to the viewBox,
  and a small configuration's viewBox is barely taller than its cards, so the bar
  usually stepped beside its card and sat on the neighbour. The svg paints its
  overflow and the wrap centres a small drawing in empty stage, so `CanvasSlot` now
  measures that free ground (wrap rect minus svg rect, in user units, 8 px inset;
  none while zoomed, where the wrap scrolls) and `barRoom` grows the view by it.
  `placeBar` then tries below, above (each left- and right-aligned with the anchor),
  right and left, and takes the first that covers no other card or caption, else the
  one that covers least. Measured on every render, because an edit resizes the
  drawing inside a wrap of the same size. Where the stage is exactly the drawing's
  height (Simulate at 1280×720) there is no ground to use and the bar may still cover a
  card.
- **A new standby arrives with the transport its protection mode wants.** `addDatabase`
  wrote `LogXptMode` ASYNC unconditionally, so in MAXAVAILABILITY (and MAXPROTECTION)
  every `+ Standby` raised `XPT.TABLE_4_2` the moment it landed. `transportForMode`
  (`inspector/edits.ts`) gives SYNC for maximum protection and availability and ASYNC
  for maximum performance — broker Table 4-2's row. And `shipRedo` now names ASYNC on
  every cascaded leg instead of copying the receiver's LogXptMode: real-time cascading
  needs the attribute explicit (facts A5, B2), every worked example writes it
  (`(North_Sales : South_Sales ASYNC)`), and a SYNC receiver would otherwise turn the
  line into `ROUTES.CASCADE_SYNC_UNDOC` / `FARSYNC_ONWARD_SYNC_UNDOC`. Checked across
  all twelve presets: neither `+ Standby` nor a line from a non-primary onto a data
  centre adds an error or a warning.
- A row set straight into a rail group (`.grp>.rr-line`, `.grp>.rr-dest` — the
  observer's *Make it the master*, a member's instances) now sits inside the gutter.

Tests: `test/ui/inspector.test.ts` (*adding happens in one place*), `build-actions.test.ts`
(the header's Remove against the table), `canvas-actions.test.ts` (*the bar keeps off
the rest of the drawing*), `canvas-gestures.test.ts` (*a new standby does not arrive broken*).

## 4. Topology canvas

**Node card** (generalised `nodeCard`): flat `--sf` rect, hairline, rx 5, badge rx 7 centred; role word / host mono (19-char elision, full value in aria) / subtitle; width clamp(184, measured, 260); height 72 (3-line DB) / 52 (observer). Glyphs: db cylinder, observer eye, far sync = cylinder + chevron (no base), snapshot = cylinder + shutter tick. RAC `⌗2` chip top-right (absent = single instance, legend says so once). Master observer `MASTER` violet chip only while FSFO is enabled ("all observers have the same functionality" when disabled); observe-only slate chip. Simulate-mode state: phase tint fill/border; down = hatch + red border; crashed host = two-stroke red cross on the name line; stalled primary = red border, no cross.

**Auto-layout** (`canvas/layout.ts`, pure, deterministic): rank by BFS over the resolved redo graph (primary 0, far sync/standby = source+1, observers band −1, unreachable = max+1 dashed); columns = sites ordered by min rank (primary site leftmost, third site between); rows within a site: observers band, then members by (rank, roleOrder primary/farsync/physical/logical/snapshot); cascaded standby in the row below its cascader (indented 24 px if same site); pack (col width = max card + 28; row = max height + 18); site rect = union + 14 pad + 18 bottom label band; centre columns so the classic 1+1+1 redo edge is horizontal; apply drag overrides (snap 8 px) then recompute site rects; viewBox = union + 10 top / 16 bottom.

**Link routing** (`canvas/routing.ts`): ports (redo right→left mid-height; observer ping bottom→top; backwards edges via a lane under the site rects); ≤2 bends; channel allocation per corridor (offsets 0, ±12, ±24…; ±24 in a site-to-site corridor, which is 200 px wide). Two additions the dense presets forced, both deterministic:

- **A corridor route.** When the straight run is blocked — three observers in four columns put a card in the way of nearly everything — the link leaves sideways, drops down the free space between the destination's column and its neighbour, and comes at the destination from the side. Without it a route that could only take the lane above everything dropped onto its target's top edge straight through whatever that column stacked above it.
- **Corridor-aware pill placement.** A caption belongs in the corridor or on the vertical run inside it, never over a card and never inside a site rectangle it says nothing about. The sweep is a four-rung ladder, each rung a fixed enumeration: clear of cards, captions, site rectangles and every other link's line; then the same without the lines; then cards and captions only (which is where a hop between two cards stacked in one data centre ends up, since that is where its line is); then a clearance computed from the obstacle. The slide ladder runs to half the segment, not a flat 40 px — a corridor is 200 px from the middle of a run that spans the drawing.

Routing runs in two phases for that reason: every route first, so channels are still handed out in id order, then every caption, so a caption can be placed against lines that were not yet routed when it was. The canvas draws in the same two passes — all lines, then all cards, then all captions — so a caption is never painted over by a line routed after it; both halves carry the same `data-node` and the same handlers, so either one hovers and selects the whole link. `test/ui/canvas-presets.test.ts` holds all eleven presets to the collision rules and to a golden of the geometry. Styles: SYNC solid + filled arrow; FASTSYNC solid + hollow arrow; ASYNC dashed 6-3; observer ping dotted violet, no arrow; readiness check dashed slate; inactive PRIORITY alternate 55% opacity `ALT · PRIORITY 8`; cut link dashed red + two slashes, RTT → `cut`/`down`. Arrows = redo flow only.

**Event affordances**: click node → menu (Crash the host · SHUTDOWN ABORT the instance (RAC: pick) · Stop redo apply · Take the whole site down · Restore); click link → Cut · Add latency… · Restore; multi-select shows the intersection of valid actions. Each action = `edit('Crash dc1-prm01', …addEvent at tNow)`; events ride the share link, appear as numbered markers on the axis and in the Simulate rail (editable `at`, remove).

**Keyboard/aria**: svg `role="group" aria-describedby` with generated sentence set + a visually hidden structural table (site/member/role/host/receives from/transport/RTT); every card is `role="button"`, and **one card per site is the tab stop** (a roving `tabindex` that follows the arrows, so tabbing away from a site and back returns to the card the reader left) — arrows within a site, Tab between them, Enter or Space selects (Shift adds), `E` opens the action bar in Simulate, `Delete`/`Backspace` removes in Build, `Esc` clears. Sentences composed per function (testable), collapse to counts above 8 members.

Two things that spelling depends on:

- **`tabindex`, lower case.** Attribute names are folded to lower case only for HTML elements, so the camel-cased JSX spelling lands on an SVG `<g>` as a literal `tabIndex` attribute that SVG2 has never heard of: the cards render, look focusable and take no focus at all. Same for the timeline's `<g role="slider">`. `test/ui/canvas-keyboard.test.ts` pins it.
- **The shell has to pass the handlers.** `E` and `Delete` are the canvas's to detect and the shell's to mean: `CanvasSlot` wires `onEvents` only in Simulate (it opens the action bar, with the focus in it) and `onDelete` only in Build, where it removes exactly what the inspector's Remove button removes, refusals included — a shortcut that could delete the primary while the button beside it says why it cannot is two answers to one question, and the refusal is said out loud.

## 5. Timeline

Pure `buildTimeline(trace, topology, view) → TimelineModel`; component maps to VNodes. Lane order: primary; observers (master first; alphabetical/no master when FSFO disabled); far syncs; standbys in BFS order (cascaded indented 10 px). Gutter 132 px, `fitLabel` ladder, lane 38 + 10 gap. Scale: `t0 = -snapNice(0.15*horizon)`, `horizon = clamp(1.15*lastInterestingT, 30, 900)`, `pickTickStep` ported; `pinnedScale` export mode reproduces `x(t) = 280 + 10·t` for the static figures. Segments with phase classes (`b-tl/b-bl/b-am/b-sl/b-vi/b-hatch`), labels via `fitLabel` (drop below ~28 px → tooltip); brace row-packing ported verbatim; numbered event markers on the axis ("t = 0 is the first injected event"); legend wording unchanged. Scrubber: separate `Playhead` subscribing to `tNow` only; drag with pointer capture; `←/→` 1 s, Shift 0.1 s, Home/End, Space play/pause, `.`/`,` next/previous state change; transport bar with speeds and click-to-type `t`. Hover: one delegated pointermove, tooltip as positioned div. Perf: memoised build, stable keys, `approxW` table (never `getComputedTextLength`); budget rebuild <12 ms, playhead <2 ms at 12 lanes.

## 6. Migrating the six chapters

| Legacy | New home |
|---|---|
| topology strip / `renderTopo` | Canvas (auto-layout, ported card/pill/site/hatch/cross look) |
| scenario radios | Simulate palette templates: Crash the primary host · Isolate the primary site · Cut DC1↔DC2 · Lose the standby site · Kill the master observer · Switch over |
| observer-location radio | gone as a control — placement is where the observer card sits; lessons move the observer |
| threshold/ObserverPing*/lag limit/type/grace/PmyShutdown/protection mode | Inspector → Configuration/FSFO |
| role transition, latency, apply lag | params.roleTransition, per-link RTT, per-member apply lag |
| timeline + banner + callout | Timeline + `Alert`s (blocked, split brain) |
| "What the timeline shows" | Lesson 1 prose + timeline Explain block |
| commit view | Config → Commit, one figure per SYNC/FASTSYNC destination sharing one ms scale |
| reopen view | Config → Reopen, scoped to the selected destination |
| app view | Config → Application view over N addresses |
| deployment identity | per-member fields in Inspector; deployment-level in ConfigForm |
| export/import/share | status bar |
| config cards | Config → DGMGRL / LOG_ARCHIVE_DEST_n / tnsnames-JDBC / SHOW |
| side topics (SDU, impact, NET_TIMEOUT) | Learn → "SYNC transport" lesson (static TSX + inline SVG figure) |
| reference tables + footnotes | Learn → Reference (`RefTable` data, `Footnotes`) |
| DEMOS | `lesson.steps[].apply` |
| Explain more IIFE | `<Explain>` |
| tabs/pager/cfgpill IIFEs, i18n, ASCII rule | dropped (ASCII rule stays for `simulator/` until deleted) |

Lessons: 1 Failover clocks · 2 The transport layer · 3 The application's view · 4 Configuration · 5 SYNC transport · 6 Reference · plus new: Far sync · Cascading · Multiple observers and targets. Prose ported by copy, not rewritten (accuracy rules).

**Deep-link compatibility** (`state/legacy-url.ts`): map legacy query keys (`sc`, `ol`, `pm`, `th`, `ps`, `pi`, `pr`, `lag`, `ll`, `rt`, `lat`, `sd`, `lt`, `tla`, `lgt`, `lp`, `xpt`, `lw`, `sbw`, `rs`, `mf`, `og`, `rr`, `tct`, `ct`, `rc`, `rd`, `da`, `lang` (drop + notice), `ver`) and anchors (`ch-clocks`→break, `ch-transport`→configure/commit, `ch-app`→configure/app, `ch-config`→configure/dgmgrl, `ch-side`→learn/sync-transport, `ch-reference`→learn/reference) onto the classic preset, then `replaceState` the canonical URL. `#cfg=` → `upgradeConfigV1()`. Legacy page kept at `/dataguard/legacy/` (Czech handover links carry `?lang=cs`; those go to legacy).

## 7. Milestones
M1 shell + canvas drawing the classic 1+1+1 from the engine · M2 Build mode (inspector, validation, undo, persistence, share) · M3 Simulate mode (events, timeline, scrubber, readout; six templates reproduce the six legacy outcomes) · M4 Config (generators, panels, cross-highlight, goldens) · M5 Learn (nine lessons, reference, legacy URLs, print; deploy flip; drop 'unsafe-inline') · M6 polish/a11y/perf.

## 8. Taste notes
Two faces only: system sans for prose, mono for everything Oracle/terminal (property names, modes, statuses, ORA numbers, DGMGRL, names, hosts, numerals with units). Prose 15/1.55, captions 11.5, eyebrows 11 mono uppercase .16em, chips 10.5 mono uppercase .12em, readout numbers 26/620 tabular. **As built the eyebrow is quieter and rarer** — 10.5 mono uppercase .08em, and only for a *section* label. It is not a chip label (the readout's are sans, sentence case), and it is not a title that reads as a sentence: the action bar's header says `at t = 40 s` in mono sentence case, because AT T = 40 S was a shout. Readout values are 14/620 tabular mono, and the site label under a data centre rectangle is 11 px, not 10 — it names a column of the drawing, not a footnote to it. Canvas airy, rails dense; elevation only on rail/sheet/drawer. Colour semantic never decorative; cards monochrome in Build, tinted only in Simulate at a t; red = down only; violet = app's voice + observer semantics. Empty states say something true (inspector → configuration summary; Simulate → "No events yet…"; timeline → "No events yet. Select a card…"; validation → "No issues … as modelled here"). Five invariants: WhyPill on every disabled control (`{state:'on'} | {state:'off', why}` prop); captions branch on outcome; nothing hidden by CSS alone; every demonstrable claim has "Show me"; undocumented labelled in place (`<Fact id>` chip). New principle: the drawing and the text are the same object seen twice (hover a generated line → highlight the member; select a member → scroll to its lines).


RAC cards now retain one database identity and one set of redo links, with a
separate inset row for each instance, naming its host and site. The card grows
with the instance count; Simulate mode marks failed instance rows individually.
A RAC card never joins a chassis stack on its first host. Adding an instance
creates a separate host in the same site in the same undoable edit.

## Small declutter pass (2026-09-26)

The header uses one native Theme picker (System / Light / Dark) and compact
Undo/Redo arrows with accessible names and action tooltips. Build guidance led
with “Click to edit · drag to move · + to add” (since moved to the Build button's
title and the stage's `aria-description`; no line is drawn in Build). Canvas tools keep their existing actions, with flat
zoom controls and no extra bordered, shadowed containers around each group.

Validation counts remain in the header and validation panel; the readout no longer
repeats them. Its protection, failover, playhead and run results are unchanged.
The healthy validation heading and Simulate empty state use shorter copy. Warnings,
refusal reasons, model labels and citations retain their existing visibility.

Simulate also gives unused vertical space to the topology. Its timeline dock sizes
to its content, capped at 56vh with scrolling for dense runs; the topology takes
the remaining height (minimum 260px). Below 768px both return to natural page
flow, so the mobile viewer does not inherit the dock cap.

Database icon badges distinguish primary (teal, P) from standby (blue, S),
including snapshot and logical standbys. Down-state red overrides the role color
but preserves the letter. The role marker and card role label follow the current
primary at the timeline playhead; far sync and observer glyphs stay distinct.
The former primary uses F after a failover, rather than implying it has been reinstated as a standby.

The workbench width cap is now 1920px (previously 1360px). Additional width goes
to the topology and timeline; the inspector retains its 360px width and prose
retains its local reading widths. The toast shares the same shell cap.

## Editing the event sequence (2026-09-26)

In Simulate, injected timeline markers are draggable and keyboard focusable. Dragging
previews against the original axis and commits once on release. That axis stays
fixed after a successful drop so automatic rescaling cannot visually undo the
move; “Fit timeline” restores the automatic fit. Other document edits and undo
refit automatically, as do keyboard moves outside the visible range. Escape, pointer
cancellation or lost capture discards the preview. Arrow keys move by 1 s (Shift:
0.1 s), Home/End use the allowed time bounds. Playback pauses while editing. The
selected event keeps keyboard focus after its new time changes the list order.
Only injected events can move: computed failover/open/abort markers are read-only,
as are Learn, print/export and the narrow viewer.

The Events rail offers Earlier/Later when a neighbor exists. These swap adjacent
time slots in one undoable edit. Events at the same time cannot swap slots; their
engine priority stays intact, and editing a time separates them. The same bounds
apply to dragging, keyboard nudges and numeric time inputs (0–900 s).

`ui/break/event-order.ts` defines conservative editing constraints, not Oracle
claims: retain the authored sequence for the same subject, overlapping host/site/
instance/member/observer state changes, partition/link changes, and role commands.
Distinct related events keep a 0.1 s gap; existing simultaneous events retain their
order. Independent events can pass each other. Disabled reorder actions explain
why; a refused numeric edit restores the input and reports its allowed range.
The domain engine still determines the outcome, including command refusals.

The playhead is dragged by its dashed line, grip or time badge; clicking a lane
or empty plot area does not seek. Grabbing the badge preserves its offset from
the line. Keyboard seeking and the transport controls remain available.

## Saved work, comparison, explanations and the walkthrough (Track 7, as built)

Ported feature by feature from `feat/usability-workflows` onto the canvas-first
shell (docs/tasks/ui-followups.md, Track 7). Its competing restyle of the old
docked layout (`calm.css`, the mockups) was not ported.

- **Saved configurations** (⋯ menu, `ui/workspaces/`, `state/workspaces.ts`):
  named browser-local copies (`dg-workspaces-v1`) and the 30 most recent drafts
  that opening something else replaced (`dg-recovery-v1`). Copies hold the
  document and its edition; stored records are refused unless they decode
  cleanly. Opening a preset, lesson, file or saved copy is one undoable step
  (`history.replaceDoc`) that keeps the outgoing draft; an untouched preset is
  not kept. Undo restores the edition only when the step changed it. These
  copies are separate from Share and from the JSON export.
- **Compare alternatives** (⋯ menu, `ui/review/`, `state/review.ts`): a
  baseline (`dg-review-baseline-v1`, with its edition) against the document
  under one named scenario, each run from its declared topology with the
  scenario at t = 0 in place of its events; then the setting and command-block
  changes. *Common failures* runs the six templates one by one, with optional
  session-only expectations (outcome, opening deadline, loss limit) checked
  against the model -- a missing promotion, a missing loss bound or a truncated
  run never passes. A run made against other settings is marked stale; opening
  a result restores its tested inputs undoably. Every value is this page's
  model and says so; ObserverOverride stays FALSE. It prints as a section of
  the `?report=1` report; there is no second report generator.
- The Commit panel and the comparison share `panels/commit-model.ts`
  (`directCommitLegs`) and honour the document's `commitWaitPolicy`.
- **Why this result?** is a fold on the Simulate rail under the event list, and
  the quiet "Why?" beside the Outcome chip opens it. Steps come from the events
  and the trace (`break/explain.ts`) and keep their claims' basis and
  citations; selecting one pauses playback, seeks and selects its subjects.
- **The classic walkthrough** (`intro/Walkthrough.tsx`) starts from the third
  hero button. It is a card under the guidance line, in the header's flow, so
  the measured bar bottom grows with it; three steps (crash, advance, change
  the threshold), and it ends when another document replaces the example.
- The ⋯ menu's dialogs are `Sheet variant="card"`: a floating card under the
  bar, mounted by the shell (the menu is a `<details>` that shuts on a press).
  `Sheet` keeps Tab inside a dialog and returns focus to the menu when its
  opener was folded away.

### Existing setup import

The ⋯ menu opens a sheet for SQL collector output, separate from native document
Import. SQL and optional Bash downloads are static same-origin assets. Paste or
file input is capped at 2 MB of UTF-8. A newer paste or file selection invalidates
an earlier pending file read and its preview. Preview does not mutate the current document;
Draw imported topology uses `replaceWorkingDocument` with recovery and undo.
Assumptions are retained in document notes (the codec's 4000-character limit,
with explicit truncation notice), and a persistent disclosure above the drawing
keeps them visible across export, share and reload. DGMGRL text is not accepted.

## The applications on the drawing (as built, 2026-09-28; several since 2026-09-29)

A configuration holds any number of applications (`TopologyDoc.applications`), each
its own card on a host of its own and each dialling the connect descriptor it has:
its own (`Application.client`) or, when it has none, the document's shared
`doc.client`. Everything below is per application; where a surface is genuinely
single-application it says which one it shows.

- **A card of its own** (`NodeKind 'application'`, glyph `app`, an `APP` chip): two
  lines, the width of a database card, on a host of its own in the primary's data
  centre to start with. It is dragged into another data centre like any card
  (`moveToSite`), renamed in place, removed from the rail's header, and added from
  the toolbar — `+ Application` is always on offer (it needs a data centre, like the
  other additions), names are the next free `app01`, `app02`, … in the one id
  namespace, and each new card stands on a host of its own. It shares no host
  (`mergeVerdict`, `WHY_APPLICATION_OWN_HOST` — the page's own rule, not Oracle's,
  and worded that way). Several in one data centre stand side by side
  (`LAYOUT.appSideGap`), so a line rising from one never crosses another.
- **Its band is under the member band** (`LAYOUT.appGap`), the observers' is over
  it, so an observer's line comes down onto a card's top edge and the application's
  comes up onto its bottom one. In its own column the line is a straight hop, left
  of the card's middle; to another column it leaves the card sideways, runs under
  every database and rises beside the data centre's name (`clearOfName`), never
  through it. `LinkKind 'connect'`: dash-dot, colour `--cn`, one line per database
  on *that application's* ADDRESS_LIST (`applicationTargets(doc, app)`, id
  `connect:<app>:<member>`), captioned `sessions` to the database publishing the
  service and `address` (faded) to the others; `cut` and `down` as every line says
  them, asked of that application's host.
- **The lane between the bands** (`Geometry.midLaneY`, `LAYOUT.midLane`): with an
  application under the primary, a redo route that used to leave by the card's
  bottom edge for the lane under everything would run through the application's
  card. It takes the lane between the member band and the application instead
  (`corridor 'mid'`), tried before `under`; null — and nothing changes — when no
  application is drawn.
- **A data centre has room in it.** `LAYOUT.colPad` is 24 (was 14): the box the
  layout draws. `LAYOUT.fitPad` stays 14: `SiteBox.fit`, what a resize may not cut
  into, so a box with a size of its own can still be drawn tighter than the
  layout's. The observers' trunk gap grew by the difference, so the top trunk still
  passes under an observer-only data centre's name. All eleven canvas goldens moved;
  they record geometry.
- **The rail** (`ApplicationForm`): name, data centre, then *Connect string* — a
  choice between **Use the shared connect string** and **Own connect string**.
  Choosing *own* copies the shared descriptor (addresses included) onto the
  application; choosing *shared* again discards it. Below the choice, the parameters
  as the descriptor spells them — `SERVICE_NAME`, `TRANSPORT_CONNECT_TIMEOUT`,
  `CONNECT_TIMEOUT` (0 is "not set": no default is documented), `RETRY_COUNT`,
  `RETRY_DELAY`, `FAILOVER`, `LOAD_BALANCE` — the ADDRESS_LIST as a tick per
  database (a far sync instance grey, with its reason), and the dead-address answer
  under *This page's model*. **Every edit is to the descriptor this application
  dials.** For an application on the shared one that is the shared descriptor, so the
  change reaches every application that dials it — the hint under the choice names
  them, and the undo entry says "the shared ADDRESS_LIST". A line drawn between an
  application and a database lists that database on *that* application's list; a
  route's Remove takes it off that list. A new standby joins the **shared** list
  only: an application with a connect string of its own keeps the list its owner
  wrote. A standby moved to another data centre stays on every list that names it
  (shared and own); a host that goes takes its addresses from all of them.
- **Simulate: each application's view.** Three lanes per application under the
  configuration's, on the same axis and under the same playhead
  (`timeline/app-lanes.ts`, pure, one `AppModel` each from `computeApps`): `Service`,
  `Sessions`, `New connections`, headed by one line that says what they add up to
  ("outage 60.3 s — 15.3 s of it inside the connect string") and that it is this
  page's model. With one application the heading is "The application's view"; with
  several, "app02's view" for each (`TimelineModel.appSections`, lane keys
  `application:<app>:<lane>`, marks `app-reconnect:<app>`). The ladder is drawn
  address by address; the reconnect and the exhausted string are marks. The axis
  stretches to the *last* application's end (`axisSpan(trace, events, doc)`, capped as
  the Config panel caps it), because a reconnect is usually past the role change.
  `Application's view` / `Applications' views` in the legend row folds every
  application's lanes away together (`appLanesShown`, a moment's view); the pinned
  export scale never draws them. In the Lanes layout each application is a row with
  its own host's up and down, and its three lanes sit under their own heading. The
  events on an application are per application: Crash / Restore act on *its* host.
  **Two databases publishing at once** (a manual failover's old primary left open,
  `FAILOVER.FORMER_PRIMARY_OPEN`; `AppSpan.publishers`, `AppModel.claims.overlap`): the
  Service lane draws one teal band over the overlap, `Published by prm01 and sby01 at
  once` / `On prm01 and sby01` / `prm01 + sby01` (a publisher that is STALLED is named
  `a STALLED prm01`), and a publisher the application cannot reach is added to the
  normal label as ` — sby01 publishes too, out of reach`. The Sessions lane reads
  `Pooled sessions working on prm01` — they stay on the database they are on — and the
  New connections lane `New connections land on prm01 — the first address that
  publishes`, or `… land on either — LOAD_BALANCE picks the order` when the descriptor
  has `LOAD_BALANCE` on. With the old primary open to the end nothing is lost, and the
  heading says so in amber: *prm01 and sby01 both publish the service — the sessions stay
  on prm01*. When the old primary then goes down the loss is the model's `lostAt`, not the
  first stretch with no service: the sessions read *In-flight calls error — ORA-3113*
  (never *hang*: hanging is for a sessions' database that is up and publishing but out of
  reach), the ladder starts at the crash, dials address 1 (the dead old primary) and
  connects to the new primary, and the reconnect mark and `outage 60.3 s` heading are
  drawn as for any other loss. The heading's tooltip carries `APP.TWO_PUBLISHERS`.
- **The readout, one reading per application.** With one application the readings
  are `Application reconnects` / `Application stays down`; with several, each reads
  under its own name (`app02 reconnects`, `app02 stays down`) with `group: 'app'` so the
  bar ranks and keeps them as it kept the one (`ReadoutChip.group`; the first keeps
  the id `app`, the rest are `app~1`, `app~2`). An application nothing happened to has
  no reading, as before. Where the sessions' database went down while another was
  already publishing the service (`AppModel.servedAtLoss`), the reading's line says so:
  *app01 gets a new connection at this instant: prm01 went down with its sessions while
  sby01 was already publishing the service, so the outage is the connect string's own.*
- **Config.** *Application view* draws one figure per application, each captioned
  with the application and whether it dials its own connect string or the shared one;
  with none, the one figure dialled from outside every data centre. The figure assumes
  the loss is the failure event at t = 0; for the one case where it is not — a
  manual failover's old primary went down later with the new one already publishing —
  it puts the loss at `lostAt` (the service lane reads old primary, then *Published by
  both primaries at once*, then the new primary; the pool works *on the old primary* until the crash; the
  outage, the *Client-side overhead* brace and the summary count from it, and the eyebrow and
  axis say t = 0 is *the first event of the run*, not a failure), and every other figure
  is drawn as before.
  *tnsnames / JDBC*
  shows the shared pair and then a pair of its own for every application that has
  one (`buildClientFiles`), and says who dials which. The review dialog and the
  printable report take the same pairs.
- **What a document without one does.** Nothing new: no card, no lanes, no lane
  between the bands, the published vantage. A link or a file written before the
  card existed, and every published-page link, opens that way; `+ Application` adds
  it. The presets, the first-visit document and Reset carry one. A document written
  when a configuration held one application (`application: {…}`) is read as a
  one-element `applications` list.
- **Found on the way, and fixed:** a published-page link opened the Introduction
  over itself on a first visit (its query keys are not in `ADDRESSED`), so
  `site/smoke.mjs` failed its two legacy-link checks. Boot now counts an upgraded
  link as a document. (Moot since 2026-10-03: boot opens the Introduction only
  for `?intro=1`, and the `ADDRESSED` set is gone.)


## Simulate's context menu on the drawing (as built, 2026-09-29)

The report: *"on the break screen, the context menu of the items is not rendering
properly — not usable at all."* At 1440×900, a click on the right-hand standby put the
bar beside the card at x ≈ 1031–1274 while the event rail floats over the window from
x = 1087: most of the bar was painted under the rail, its buttons cut to "Crash /
SHUTD / Take th". Two fixes and a redesign.

- **The bar's room is the ground nothing floats over.** In the floating layout the
  wrap is the whole window and the top bar, palette, rail, zoom pill and dock float
  over it; its padding is what keeps the drawing clear of them. `useCanvasScale`
  measured the free ground from the wrap's *border* box, so `barRoom` handed
  `placeBar` ground under the rail. It now starts from the wrap's content box
  (`freeGround` in `CanvasSlot`: border box less computed padding, `clientWidth`/
  `clientHeight` so a zoomed wrap's scrollbars are out), carves out any chrome that
  still reaches into it (`anchor.ts` `unobscured`, the side that keeps the most area —
  the zoom pill's few pixels), clips to the window, and converts per side to user
  units (`marginAround`, 8 px inset on positive ground). A side may now be
  **negative**: zoomed, the visible ground stops inside the drawing and the room
  shrinks to what can be seen (re-read on the wrap's scroll while a bar is open);
  no ground at all falls back to the viewBox. The docked layout has no chrome over
  the wrap and measures as it did. `placeBar` slides each candidate back inside the
  room for an anchor partly outside it.
- **The quick icons step aside.** `HoverTools` are not drawn on the key whose bar is
  open: they sat over the card's top edge, on the bar's header.
- **Simulate's bar is a context menu** (`ActionBar` with `sections`; Build's bar is
  unchanged). Header: the subject and the moment it lands, `sby01 · at t = 12.3 s`
  (the snapped playhead the rail reads), and ×. Every offered row — no row cap, no
  "More in the panel" — grouped under small mono labels read off the kind of event
  each row injects (`break/events.ts` `actionGroup`: Fail · Restore · Role change ·
  Broker · Setting · the whole run), each a full-width left-aligned item led by the
  timeline's glyph for the same event (`actionIcon` → `eventIcon`, or the action's
  own `icon` where the kind does not picture it: isolate, reconnect, the
  properties). Inside a group the rows that can be pressed come first; groups with
  something to press come before those with nothing; the setting group is always
  last. A refused row is dimmed, with its reason as visible text under it — the
  `WhyPill` element, flattened by `.cv-menu .why`. `restoreQuietLine`'s sentence
  closes the Restore group, where the dropped rows would have been. Labels,
  refusals and the drop are still `actionsFor` / `nothingToRestore` /
  `restoreQuietLine` / `runAction`, so the rail and the menu cannot drift.
- **Taller than its room, it scrolls.** `anchor.ts` `menuCap` cuts it to the taller
  of the ground under and over the card when that leaves at least `MENU_MIN_H`
  (150 px), else to the room's whole height (it then goes beside). The cap is set
  as `max-height` through a ref (the CSP's one escape hatch), the list scrolls
  under a fixed header, and the `foreignObject` declares the capped box — Firefox
  clips to the declaration. `menuFootprint` estimates the natural height;
  `onMeasure` corrects it after the paint, as for Build's bar. Arrow keys walk the
  pressable rows (Home/End jump, refused rows are skipped — their reasons stay on
  screen), Escape closes, focus-on-open lands on the first pressable row.
- **Whole beside beats scrolled below** (browser pass, same day). `menuCap` is also
  told the menu's width and the subject's body: when neither under nor over the
  card holds the whole list but the ground left or right of it does, it is not cut
  and `placeBar` puts it beside (sby01 on the default configuration: 600 px of
  empty ground to its left, where it had opened as a 300 px scroll under the card).
  Only when no side holds it whole does it scroll, on the side with the most room —
  beside at the room's full height if the ground beside is wide enough, else the
  taller of under and over. The list's scrollbar is thin (`scrollbar-width: thin`,
  `--ln2` thumb).
- **A data centre's menu stands beside the box, not the band.** A data centre
  anchors on its name band, and "beside the band" was still inside the box, over
  its own cards (dc1 after *Take DC 1 down*, with the dock open, landed on
  prm01/app01). `placeBar` takes the subject's body (`bodyFor`: the site's box, else
  the anchor) for its beside candidates; every card and caption, the site's own
  included, stays an obstacle, and the first zero-overlap candidate wins. This holds
  for Build's bar too.

Tests: `canvas-actions.test.ts` (*the bar keeps out from under the floating chrome*,
*a menu taller than its room scrolls*, *a data centre's menu keeps off the cards
inside it*, *Simulate draws the bar as a grouped menu*, the
whole Simulate table on the bar, the header's clock, the quick icons stepping aside),
`canvas-presets.test.ts` (*the Simulate menu stays inside a room the rail has cut short*,
every preset, every scale).

## The side rail folds (as built, 2026-09-29)

*Since 2026-10-04 this is Break's Events rail alone. Topology's and Config's inspector
has no strip: it is in the document or it is not, and the bar's button closes it -- "The
inspector comes when asked", at the end.*

The owner's ask: *"make the right-hand side panel collapsible and redesign it to be
much more user-friendly and nicer"*.

- **A frame around the rail** (`ui/RailFrame.tsx`, `styles/rail.css`): a 44 px title
  bar naming the rail (`Inspector` / `Events`) with the fold button, and a scroll port
  under it (`.rail-body`) that carries the scroll shading the aside used to. The
  contents keep their own headers; the bar is the shell's, so folding works the same
  in Build, Simulate and Config. Learn has no bar: its right half is the workbench.
- **Folded, the rail is a 44 px strip** that is one button, its full height: the panel
  glyph, the rail's name and what is behind it (the selection, or Simulate's event count)
  set vertically. Nothing of the contents is rendered. Both buttons carry
  `aria-expanded` and `aria-controls="app-rail"` (the aside, present in both states).
  `]` toggles from anywhere outside a text field (AltGr let through, for layouts where
  `]` is a chord); below 1280 the same key opens or shuts the drawer. Remembered under
  `dg-rail`, read once at boot.
- **Everything that clears the rail follows it**: `--w-float-rail` and `--w-inspector`
  are registered with `@property` and transitioned (0.22 s, off under
  `prefers-reduced-motion`), so the drawing's inset, the dock, the zoom pill and the
  docked grid's column move with the width. `--rail-space` is restated on `.app`
  (≥1280) because the `:root` declaration resolved against the open width. The port
  keeps the open width while the column grows, so the fields lay out once.
- **"Show me this in the inspector" unfolds it**: Edit (`openInspectorFor`), a
  finding's row, the walkthrough's threshold step and the run explanation's settings
  links call `revealRail()` (persist.ts), which unfolds the column on a wide screen
  and opens the drawer below it.
- **The header names its subject with the card's own glyph and tone** (a tile: teal
  primary, blue standby, violet observer, the link colour for far sync, links and
  routes, the connection colour for the application, slate for data centres and the
  configuration), the kind word in plain words (`Physical standby`, `Master
  observer`), and `Remove` / `Clear` as icon buttons whose words ride in `.sr` and
  `title`, so the header's three buttons fit beside the name on a 340 px card. Remove
  goes red on hover.
- Folds turn an SVG chevron (the shared `Caret`), an open section's heading is ink and
  a shut one steps back, the summary's rows are ruled, and an empty state (Simulate's *No
  events yet*) is a dashed box rather than a stray
  sentence.

Tests: `test/ui/rail-collapse.test.ts`.


## Simulate's two layouts (as built, 2026-09-29)

Two prototypes of a Simulate redesign (`prototype/break-layout`: B, a split with the bar as
the handle, and A, cards that continue as lanes) were both kept, as **Split** (the
default) and **Lanes**, with a switch. The floating dock that used to carry Simulate's
timeline is gone: Split is the same content, not overlapping the drawing, so the choice
is Split or Lanes. This section supersedes the Simulate parts of §3b/§3f that describe that
dock (its head row of readings and finding chips, the floating warning card, the grab
handle on its top edge). Build's dock, chips and warning card are as they were.

- **The switch** (`ui/break/LayoutSwitch.tsx`): a two-option segmented control, *Split |
  Lanes* (group label *Layout*, spoken, not drawn), in the top bar immediately left of the
  `19c | 26ai` switch and built the same way (a bare `Segmented` in `.topbar-group`, so it
  is styled by the same rule) — the one place both layouts leave alone, so it is in the
  same spot whichever is on screen. Only in Simulate and only where Simulate floats (≥ 1024 px);
  elsewhere `TopBar` does not render it and the release switch does not move (the group is
  right-aligned). The docked fallback below 1024 px is a single layout and has no
  switch. **Simulate has no guidance line** (`Guidance.tsx` renders nothing for it, apart
  from the card the `?` opens): the band's height is the drawing's, and what it said —
  click a card to add an event, drag a numbered marker to change its time — is the Simulate
  mode button's `title` (`MODE_SUB`) and the stage's `aria-description` (`modeGuide`).
  `aria-pressed` buttons (the shared `Segmented`), so it is reachable and pressed
  by keyboard; the titles say what each is for: *Split — see the diagram and the timeline
  together*, *Lanes — read each member's story row by row*. Switching is live (one
  signal), keeps the run, the playhead and the selection, and needs no reload.
- **The preference** is `breakLayout` (`state/view.ts`), remembered under
  `dg-break-layout` (`persist.ts`, `loadBreakLayout` at boot, try/catch like the rest);
  anything but `lanes` reads as Split. It is **not in the address**: hints, the rail's
  fold, the grid and the timeline height are all reading preferences kept in
  localStorage only, and the URL carries what changes what is shown or computed (mode,
  edition, theme, the document). A link that opened in someone else's layout would be a
  link that overrode their choice.
- **Split** (`ui/break/SplitDock.tsx`, `SplitBar.tsx`, `styles/split.css`, root class
  `bl-split`): the drawing fills the window above; the dock becomes a full-width lower
  region, flush with the window's foot, made of **the bar** and **the timeline**.
  - *The bar* is 40 px: the transport, the run's readings on one line (`Outcome failover ·
    Why? · New primary open … · Application reconnects … · Observer …`; **a value is never
    clipped**, see *The terse line* below), a **Fit timeline** button while an event drop has held the axis, the findings
    as one chip (`⚠ 2`, the notes count, or ✓) with a dropdown, the colour key and the
    **Application's view** toggle behind an (i), the pop-out and the full-screen buttons. With
    a run, a **Summary ▾** button stands beside the line (*The run summary*, below).
    The whole bar is the drag handle (a press must move 4 px before it is a drag, so a
    button's click stays a click; double-click resets), and its top edge carries the
    keyboard separator (`DockGrip`, the window-splitter pattern, arrow keys, Home/End,
    Enter to reset). Dropdowns open upward over the drawing, where the warning card used
    to float, and share `FindingsSheet` with Build's popover.
  - *The terse line* (`TerseReadout`, shared with Lanes, deciding in `readout-fit.ts`)
    fits by leaving **whole readings out**, from the line's own measured width (the
    `.sb-ro` element, `flex: 1 1 0` so the readings do not size it, watched by
    `useWidth`; each reading's width comes from a hidden copy of the line, `.sb-rm`,
    measured before paint). Give-up order, first to go first: Split brain, Data loss, New
    primary open, the primary's shutdown, Fast-start failover and Members (steady readings),
    then the essentials Observer, Application, and never Outcome (with *Why?*). Split brain is
    last in `KEEP` and outside `CORE`: it is a reading about the run, the band has it whole,
    and the others keep their order. While anything
    non-essential is on the line the eyebrows stay whole; only when just the essentials are
    left do they shorten (*Application reconnects* to *App reconnects*, *Application* to
    *App*); a value is never shortened. The line's `title` lists every reading whenever one
    was left out, and each reading keeps its own sentence as a title. It no longer depends on
    the 1100 px `TIGHT_W`, which now only folds the transport's speeds into a select.
  - *The bar reads the drawing's model.* `SplitDock` calls `useRunTimeline` once
    (`timeline/run.ts`: the model, and the held axis that used to be `Timeline`'s own
    state) and hands the result to the bar and to `TimelineBody`. The transport's steps
    and time field and the key come from the model the lanes are drawn from, so a held
    axis or a new width cannot leave them on different scales. `Timeline` itself is the
    same hook plus the body, for the docked Simulate, Learn and the popped-out window.
  - *The timeline under it* is drawn with `density="compact"` (36 px lanes with 10 px
    gaps, 13 px text on the bars and sentences, 13.5 px mono lane names and an 18 px type
    icon, the name on the bar's own line, `TL_COMPACT`; it was 22 px / 4 px, then 26 px / 10
    px at 11 px text, which read as calm and as too small. The type sizes are the `--fs-*`
    properties of `.tl-svg.is-big` in `timeline.css`, and `TL_COMPACT.fs*` are what the
    drawing measures its labels with (`timeline-type.test.ts` holds the two together): a
    milestone sentence has a 26 px row of its own, an event is its number badge and its
    sentence on one line with no icon chip, the scrubber's time badge and "Steady state" sit
    on a row above the events, the application's heading has a hairline and 56 px, the total-outage
    brace is left to the headline, and a bar's sentence moves off any marker line that crosses
    its bar; the gutter is two left-aligned columns, the canvas card's own icon glyph
    (`common/glyphs.tsx`, tinted as the card tints it, with its P / S / M letter) and then the
    name, and the application's three lanes are sans rows that wear the application's own icon
    in the same column (their tooltips name the application), under a heading that carries it too), `headline` (the run's sentence as a line of its own
    above the lanes, truncated with the whole text as its title, sticky while the lanes
    scroll, not the drawing's first text row) and no legend row (`legend={false}`; the bar
    carries the key and the buttons). The region under the bar is the one scroll box.
  - *A floating card, like the header and the rail.* The region is inset by `--float-m`
    (14 px) on the left, right and bottom, so its outer edges are the header card's and the
    rail's; `--r-card` corners, a `--ln` hairline and `--sh-card`. It does not clip (the bar's
    dropdowns open upward out of it): the bar at its head takes the top corners and carries
    the grip on the card's top edge, and the timeline scrolls in its own slot inside the card.
    The rail ends above it with a 10 px gap, as before, so the two right edges line up. The
    drawing measures the slot, so its width is the card's inner width. Full screen is the same
    card taken to the window under the header; the pop-out is its own window and stays flush.
  - *Height*: derived from the drawing, not a share. `timelineDefaultH(viewH, headBottom,
    drawingH)` is what leaves the whole drawing on show at a true 100% between the header and
    the card -- the room under the header, less the drawing's viewBox height and its air
    (`DRAWING_AIR`: 18 px under the header, the card's 14 px margin, 10 px over it, 8 spare) --
    never under 220 px, and never over 720 or three quarters of the room. App.tsx measures it
    (window, header bottom, the drawing) and writes `--tl-fit`, which split.css's
    `--tl-default` reads; without a drawing it falls back to 62 % of the room. The timeline
    scrolls inside the card for whatever does not fit (at 1440×900 the classic crash's dock is
    about 390 px: the transport bar, the headline and the first three lanes and the application's
    heading on show, the rest one scroll away), at its full lane height. Once the reader drags
    it (`is-set`) it is that height (`timelineH`, `dg-tl-h`, written as `--tl-h`), never taller
    than leaves the drawing 140 px and the card its margin (`CANVAS_MIN_H`, `DOCK_MARGIN`) and
    never shorter than the bar and a few lanes (`TL_MIN_H`, 120).
  - *"Everything is working"* is the first scenario on the shelf and the only one that injects
    nothing. With no event the engine has no clock, so `trace` is null and every surface reads
    "steady state"; the scenario sets `healthyRun` (view state, not in the Document) and `trace`
    then runs `simulate` over the empty list -- outcome `continues`, `dataLossKind: none`, no
    promotion -- so the timeline (axis 0-30 s, no "before"), the readout (`healthyChips`: Outcome
    no failure, Data loss none, Split brain no, Application served, each `model`) and "Why?" all
    read the engine's own answer. It lives beside the six failure templates (`shelf` =
    `healthyScenario` + `templates`), not among them, so the review suite and the walkthrough
    never see it. Any event, Clear, or a new document puts it away.
  - *The drawing fills its region until the reader zooms.* Split's `CanvasSlot` sets
    `fit` on `useCanvasScale`: the factor `autoFactor` gives (the wrap's content box over
    the viewBox, never below 1:1, never above the top rung, 140 %) is written to `zoom`
    on entering Split, whenever the wrap's content box changes (window resize; the divider,
    which moves the wrap's bottom padding through `--dock-h`) and whenever the drawing
    changes size. The first `+`, `−` or ctrl-wheel step clears `zoomAuto` and the room
    stops deciding; `Fit` (and re-entering Split) sets it again. While the room decides the
    wrap is `.is-fitted` (centred, no scroll port); a room smaller than the drawing is
    still the CSS cap's job. Leaving Split with `zoomAuto` still true puts the drawing back
    at 1:1.
  - *The bar is grabbed anywhere that is not a control*, with the `ns-resize` cursor. The
    pointer is captured at the press (a control never starts a drag), so a release far
    from the press with no move between — a fast flick, or automation — still resizes to
    where it came up if the press had crossed the 4 px slop; a cancel keeps what was
    dragged to. The separator answers ↑/↓ (16 px, ×4 with Shift), Page keys, Home, End
    and Enter.
  - *The rail folds to its strip on the way in* (`split-rail.ts`, `useFoldRailWhile`), so
    the drawing keeps its width. It is a plain signal write: `dg-rail` is not touched by a layout. If the reader
    unfolds or folds the rail themselves inside Split that is their choice, stored as
    usual, and is left alone on the way out; otherwise leaving Simulate (to Build, say) puts
    the rail back as it was. Lanes folds it the same way, and a switch between the two
    layouts leaves it folded (see *The rail folds in both layouts*). A fold the reader chose beforehand is kept.
  - *Narrow*: the bar measures itself (`useWidth`, not a media query — this page removes
    from the document what it hides). Under 1100 px the five speed buttons become one
    select (`Transport`'s `speedControl`) and the readout keeps outcome, application and
    observer; anything narrower ellipsises.
  - *Full screen* (`tl-full`) and the *pop-out* still work: full screen takes the window
    under the header, over the drawing and the rail; the popped-out window is the
    ordinary timeline with its own transport, and while it is out the bar keeps the
    readout and the findings and the region says where the timeline went.
- **Lanes** (`ui/break/LanesView.tsx`, `lanes-events.tsx`, `lanes-layout.ts`,
  `styles/lanes.css`, root class `bl-lanes`) is the prototype's fused view: a column of
  cards grouped by data centre, each row continuing as that member's lane, the
  application's rows under them; the rail folds to its strip as in Split, its scenarios and
  validation one press away. It always draws at full density (`TL_FULL.laneH` rows). It is also **where a run
  is started**: the buttons a reader needs to add an event are on the things they act on.
  - *Event buttons on the cards.* Every card, every data centre header and every link
    pill carries its events, drawn all the time and not only under the pointer. A card
    shows the canvas's hover icons (`hoverTools`, one slot per pair of opposites) as 18 px
    buttons on the card's **name line**, right-aligned, plus a **⋯** for the rest: a
    database is *Shut down / Start* and *Crash host / Restore host*, an observer *Stop /
    Start* and *Crash*, the application *Crash*, a data centre's header *Crash / Restore*
    and *Isolate / Reconnect*. The name of each is its label (`aria-label` and `<title>`),
    and a refused one is dashed and grey with the reason after a dash in its title,
    exactly as on the canvas. The way back (`restore`, `startup`, `heal`, `reconnect`,
    `start`) is drawn in the healthy colour whenever it is on offer, so the slot that has
    just turned from "Crash" into "Restore" is the one that catches the eye; the way down
    goes red on hover only. Icons past three would overflow into the ⋯ menu (`MAX_TOOLS`);
    the table offers two today, so the strip is at most two icons and the ⋯. The
    isolate icon has a 12 px variant (`GLYPH_SMALL`: a node inside a dashed ring) because
    the canvas's two half-links and four ticks are a smudge at button size.
  - *A card is two lines.* Line one is the badge, the name (and its chip — MASTER,
    APP — when the name leaves room before the buttons) and the buttons; line two is the
    whole card width for **role · state at the playhead** (`cardSub`, pure and tested).
    The state is what changes and what a reader looks for, so it is never what is cut:
    the role gives way first (the observer's host name, then the role's words), and the
    state falls back to its shorter forms only when even that does not fit, so the state
    word is on the card at 1280 as at 1440. The state is read from the band that
    *begins* at the playhead (`segmentAt`: a band owns its start, not its end), the frame
    from the snapshot at the same `t`, so at an event's own tick the words, the colour and
    hatch, the accessible name (*prm01, Primary, Down*) and the cross agree with the lane —
    at t = 0 with a crash at 0 the card says *Down*, at 20 with a restore at 20 it says
    *Open*. A crashed host is a red **cross in the badge**, in place of the role's letter;
    over the hatch, name and role get a ground of the card's colour so they stay legible.
  - *They are aimed at the playhead.* The buttons are computed at `snapT(tNow)` — the
    same tenth of a second the transport's *t* field shows, and that field *is*
    `tNow`, so the two cannot disagree — so they change as the reader scrubs or plays:
    with a crash at 10 s the host's slot is *Crash* at 5 s and *Restore* at 40 s,
    SWITCHOVER is refused at 40 s "at this point on the clock", a data centre that is
    down at t offers its way back. A caption over the card column, on the same band as the
    axis ticks, says which moment they act at (*Events at t = 40 s · the buttons act at
    the playhead*). The
    strips are keyed by slot, not by action, so the element a keyboard reader pressed is
    the one that is now the way back, with the focus still on it.
  - *A press injects at the playhead and leaves it there* (`runAction(…, { keepPlayhead })`).
    Every other surface moves the playhead to the end of the run so the drawing shows the
    result; Lanes shows the whole run at once, so the playhead is the reader's composing
    cursor and must not jump from 10 s to 70 s under them. The event is a marker in the
    lanes at once (the trace is recomputed on the document).
  - *The ⋯ menu* is `breakBar`'s list — the canvas's context menu, moved to
    `break/menu.ts` so both call one function: Fail, Restore, Role change, Broker, and the
    settings last, each row led by its glyph, the refused ones with their reason under
    them, the dropped restores as one quiet line — as an HTML popover beside the card that
    opened it (`MoreMenu`; a `foreignObject` would have been clipped by the scrolling
    drawing). It takes the focus on a row that can be pressed, walks with the arrows
    (`walkMenu`), closes on **Esc** (the focus returns to its ⋯; the key is stopped, so
    the selection is not cleared), on a press outside, on a second press on its opener,
    on scrolling the rows away from it and on a row being pressed. Its header reads
    *sby01 · at t = 7 s*. It is kept inside the view and scrolls in its own box when the
    list is taller than the room.
  - *Link pills* are the pill of the connector: 10.5 px text in a 15 px pill, sitting in the
    gap between two cards (the gaps are one pill tall, and hold a marker's sentence too),
    never over a card's border. Colours are the canvas's link states and no others: **red**
    for a link that is down or cut, muted for one standing down, plain for the rest — Lanes
    mirrors the canvas's link palette for *state* and adds none of its own: the canvas has no
    degraded or lagging state for a link (`LinkPath` has `is-x` and `is-inactive` and nothing
    between; lag is a member's band and a pill's *ASYNC* or round-trip text), so Lanes draws no
    amber or green link, and the canvas's hues by *kind* (blue redo, violet ping, orchid check,
    green connection) are not reproduced because Lanes' connectors are grey whatever the kind
    and the pill's text names it; the connector is the quiet
    half — thin, half opacity, dashed red only for a link that is down — and the pill says
    what it is. One with a document link (`CanvasLink.docLink`) is a button that opens the
    same menu for that link (*Cut dc1-dc3*, *Restore*…); the others are still text. **Every
    connector and pill has the link's name and state at the playhead as its tooltip**
    (*redo prm01 → sby01, SYNC, down at t = 20 s*, then the canvas's own sentence), and the
    pill menu's header is the link's name (*redo prm01 → sby01, SYNC · at t = 20 s*), not the
    pill's text.
  - *Pills do not crowd* (`planPills`, pure and tested). A pill goes to the emptiest gap
    its connector spans, so links between the same two cards fan out over the gaps
    between them; a gap that is full folds what does not fit into one **+N** at its end,
    whose tooltip and menu carry all of them. Between two data centres the gap is a
    pill row of its own above the header. The rail reserves only the connector lanes the
    links need (`assignLanes` on the rows, capped at five), not half the link count.
  - *The rows.* Data centres are in **declared order** (`doc.sites`, the order Build's
    rail and the configuration read in), not the drawing's column order, which follows
    redo depth and puts an observer-only data centre between the two it connects — right
    for a picture of who ships to whom, wrong for a list a finger runs down. Members and
    observers inside one are in the timeline's lane order. The application's card is the
    last row of the data centre its host is in, as on the canvas, and **has a lane**: its
    host's own up and down (*Host up*, *Down — host has crashed*, *Down — the whole data
    centre is down*), read off the epochs' network summary (`hostBands`, pure) — the injected
    events applied in order, nothing modelled, so unlike the three application lanes it is
    not labelled *this page's model*. *Application's view* is its own band under all of
    them, with those three lanes. A hand-set column
    order on the canvas (Build's drag) is not followed. The order is read off a throwaway
    model so the rail's width is known before the plot's; a model's lane order does not
    depend on its width.
  - *Timing and the axis* are the Timeline's own (`useRunTimeline`, so an event drag holds
    the axis and *Fit timeline* in the bar lets go), laid out for a view whose height is
    the scarce thing. Above the rows, in flow order: the run's **headline** as a one-line
    strip (the caption, as Split shows it: `.tl-headline`, ellipsis with the whole text as its
    title); the **clock**, a 26 px strip with the tick labels, the outage brace under them
    and *Events at t = N s* over the card column; then the **event pins** (icon over
    number, the playhead's grip under them, the sentence beside) in a band as thin as the
    stack allows (`PIN_L`, the markers and the drag read the tighter `iconDy`/`badgeDy` off
    the model's layout). The headline and the clock are one sticky block (`.ln-head`) that
    holds still while the rows scroll. The time readout of a pin being dragged
    (`EventDrag`, `readout="beside"` here) goes right of the icon chip, or left of it near the
    plot's right edge (`besideReadout`), because the place Split uses — centred over the pin —
    is the top edge of the plot, under that block; Split and the Timeline keep it above. The bottom axis, its labels, `t = 0 is the first
    injected event` and the parameter braces are as before, mapped by however far the axis
    moved. At 1440×900 the classic crash run shows every row, the axis and the
    FastStartFailoverThreshold brace with no scrolling; at 1280×800, every row and the
    axis (the braces are one short scroll away, the sticky block staying put).
  - *The empty run* is the cards with their buttons, a faint track per row, the headline
    *Steady state. Nothing has been injected yet. Pick an event on a card to start.* — the
    buttons are exactly how you start now — and **a default 0–60 s axis with the
    playhead on it**, so the reader sees where the buttons will act (`steadyScale`; pressing
    the plot moves the playhead, nothing plays). With the first event the axis becomes the
    run's own.
  - *The bar* is Split's parts on the view's top edge (`sb-bar ln-bar`): transport (the
    speeds fold into a select under 1100 px), the terse readout with *Why?* and the
    *Summary* button beside it (unfolded, the band of cards sits between the bar and the
    rows — *The run summary*), *Fit timeline* while held, the findings count with the dropdown listing every finding
    (`FindingsSheet`), and the key with the Application's view toggle behind an (i).
    Dropdowns open downward. `revealFindings` opens that dropdown in Lanes as in Split
    and leaves the rail as it was.
- **The run summary** (`ui/break/SummaryBand.tsx`, `styles/summary.css`; both layouts, one
  preference). The terse line is the summary a reader already has, one line of it with what
  does not fit left out; the band is the same readings at reading size, one card each, the
  sentence showing.
  - *Folded is where a new reader starts*: the bar is exactly what it was, and a **Summary ▾**
    button (`aria-expanded`, `aria-controls` the band's id, `run-summary`) stands beside the
    line, which is wrapped in `.rs-hit`. A click anywhere on the line unfolds it too, except
    on a button inside it (*Why?* keeps its own click). A press on the line must not start
    Split's resize drag, so `.rs-hit` is in `KEEPS_PRESS` (SplitBar.tsx) with the buttons — the
    line is no longer a place to grab the bar, which the rest of the bar still is.
  - *Unfolded*: the line gives way to a spacer (`.rs-fill`, so the findings chip, the key and
    the buttons keep their places), and the button reads **▴ Summary**. The band sits directly
    under the bar and above the timeline — in Split between `SplitBar` and `.tl-slot`
    (`SplitDock`), in Lanes between the bar and `.ln-body` — flush, on `--sf2`, 260 px at
    most and then its own scroll box, so a tall band cannot take the timeline's room.
  - *A card* is the eyebrow (`k`), the value in the tone colour with its unit and quieter
    second value, and the sentence (`sub`) — visible, not a tooltip. A reading that is not
    documented (`basis` set and not `documented`) wears `Fact`, the marker the rest of the
    page uses (*this page's model*, *inferred*, …). The outcome card carries **Why?**
    (`showExplanation`). The cards are `readout` without the findings chip — the very list the
    terse line draws — and wrap on their own (`auto-fit`, 190 px minimum); no `style`
    anywhere.
  - *Only with a run* (`trace.value !== null`). With none there is neither the button nor the
    band, even if the preference says unfolded: the bar shows the line, as before. The
    preference comes back when a run does.
  - *Remembered*: `summaryOpen` (`state/view.ts`), `dg-summary` (`persist.ts`, `'1'` =
    unfolded, anything else folded), read once at boot (`loadSummaryOpen`, try/catch like the
    rest), written by `setSummaryOpen`. A reading preference like the layout: not in the address.
- **Split brain, the reading** (`readoutFor`'s run branch, chip `id: 'split'`, `k: 'Split
  brain'`; `engine/sim/split-brain.ts`, exported as `splitBrainOf`). *Were two members open
  read-write as primary at the same moment?* The engine answers it off the trace's lanes: two
  members in `open-rw` over a stretch that has a length (two states that only touch — the old
  primary closing as the new one opens — are not one). **Asked only where a new primary
  opens by failover or manual failover**: nothing moved, a refused failover, an operator left
  to act and a switchover (whose old primary is converted before the new one opens, by
  construction) have no chip. The chip sits after the primary's shutdown and before the
  application's readings.
  - *Tone and value*: `no` in `tl`, `yes` in `rd`. The sentence branches on what the drawing
    shows at the instant the new primary opens, never on the event: *prm01 aborts at 30 s,
    before sby01 opens at 55 s* (the old app's sentence); *prm01 is down when …*; *prm01 is
    STALLED when … and nothing shuts it down* (or *… it shuts itself down at N s*); *prm01 is
    mounted, not open, when …* (a fast-start failover's old primary that is back and told);
    and, for a yes, *prm01 and sby01 are both open read-write from 30 s to the end of the run:
    prm01 is still open when sby01 opens at 30 s* — the window, closed at its end where
    something closes it (*… from 25 s to 60 s: …* where the old primary crashes at 60 s).
  - *Basis*: `model`, note `SPLIT_BRAIN.READING`. The HA guide defines the term
    (`SPLIT_BRAIN.DEFINITION`) and gives no interval, so no citation documents the reading; the ones it
    carries (`SPLIT_BRAIN.DEFINITION`, `FSFO.GUARANTEE_STALL`, `FSFO.PMY_SHUTDOWN`,
    `FSFO.PMY_SHUTDOWN_NO_STALE_QUERIES`, `FAILOVER.PRIMARY_SHUT_DOWN`,
    `FSFO.MANUAL_FAILOVER_CONDITIONS`) support the
    pieces, and it renders as this page's model wherever a chip does. **What the reading
    counts as open** is the engine's own drawing: a STALLED primary is not counted (Oracle:
    its redo generation is stalled, so it commits nothing the new primary will not have),
    which is how the old page read it too; and a former primary is drawn open where a manual
    failover found it still running and open with fast-start failover disabled — Oracle puts
    its shutdown on the operator (`FAILOVER.PRIMARY_SHUT_DOWN`,
    `FSFO.MANUAL_FAILOVER_CONDITIONS`) and no page says the broker closes or mounts it —
    whether or not the new primary can reach it (`FAILOVER.FORMER_PRIMARY_OPEN`'s note). With
    fast-start failover enabled the old primary has lost its target and is drawn stalled, then
    aborted (`FAILOVER.FORMER_PRIMARY_STALLS`, `model`, owner decision D5), so it reads `no`.
    **A manual failover with the old primary still running and fast-start failover disabled
    reads `yes`** from the instant the new primary opens, and the run also raises
    `FAILOVER.PRIMARY_STILL_OPEN` (Oracle's instruction, at the command) beside it; probe
    SBR-04 (and SBR-06, -07, -08) hold the reading in view. A former primary that went down and restarts is not that one: it is
    mounted, so a run that crashes the old primary before the failover reads `no`. A
    switchover, whose old primary is converted before the new one opens, has no chip at all.
    Where the run also draws the application, the old primary keeps publishing the service
    while it is open, and the new primary publishes it too from the instant it opens: the
    application's lanes draw the two at once (*Simulate: each application's view*), and when
    the old primary goes down the sessions on it are lost while the new one is already
    publishing.
  - *The print report* takes the chip with the others (`readoutFor(false)`): a row *Split
    brain — no*, the model label, the citations numbered into its sources.
- **The playhead's time badge keeps clear** of every event sentence, icon chip and number
  circle in the model (`badgePlacement`, `markerBoxes` in `Playhead.tsx`): right of the
  line, else left, else the nearest clear place further out, read from the model's own
  markers so Lanes' shifted ones are avoided where they are. `spoken()` (build.ts)
  rounds the axis ends for `aria-valuemin/max/now` and the timeline's description, so the
  far end of the axis is read as 69.34 and not 69.34499999999998.
- **The restore note** (*Restored your last configuration · Start fresh*) is a flex pair:
  the text ellipsises (whole sentence as its title) and the button stays. The brand and
  the count keep their size, the picker shrinks to 7 ch, the right-hand group is never
  narrower than its content (`min-width: max-content`), and below 1440 px the note drops
  under the bar as a small card for the eight seconds it is up instead of squeezing in.
- **The rail folds in both layouts.** `useFoldRailWhile` (`split-rail.ts`) is called with
  *either layout on screen*, so a switch between Split and Lanes never touches the rail;
  the cards carry the events, and the rail (the events, the scenarios, validation)
  is one press on its strip away. Same rules as before: a plain signal write, never
  the shared `dg-rail` key; the reader's own fold or unfold inside a layout is theirs, stored
  as usual and left alone on the way out; leaving Simulate gives the rail back as it was.
  The automatic fold and its undo raise `railSnap` for ~300 ms and the shell drops the
  width transition meanwhile (`.rail-snap`, rail.css): the rail's contents swap to the strip
  at once while its width took .22 s to follow, which was one frame of a wide, empty rail
  — a CSS artefact, not a stuck state (Lanes → Split → Lanes now never changes the width).
  Below 1280 the top bar's *Events* button opens the drawer with the rail's contents,
  closable like any drawer: the *Close* button, Esc and a press on the scrim, the Lanes bar
  untouched behind it and reachable at once when it is shut. It opens on the events list
  with its *Remove* buttons; there is no menu of events to add at its head — the cards,
  data-centre headers and link pills carry those.
- **Density belongs to the model.** The prototype switched a module-level `TL` while
  rendering; it is now `TimelineView.density` → `TimelineModel.layout`, and `Lane`,
  `Marker`, `EventDrag` and `playheadSpan` read it from the model (`Marker` takes a
  `layout` prop). Two timelines of different density — Split's, Lanes', the popped-out
  window's, the static figures' (always `full`) — cannot disagree, and a switch cannot
  leave the wrong one behind. `TL` (the old export) is `TL_FULL`.
- **What went**: the Simulate branch of `FloatDock` (readout + finding chips + grip + two
  buttons on the dock's head row), `FindingToast`/`FindingsPopover` in Simulate (Build
  kept both -- `FindingToast`, the card above the dock, went on 2026-10-04), the drag half of `DockGrip` (now `useDockDrag`, on the bar), the
  prototype's pill, `?variant=`, `import.meta.env.DEV` gating and `state/url.ts`'s
  carrying of the key.
- **Findings when there is nowhere floating to put them**: `revealFindings` opens the
  bar's dropdown in both layouts (Split's and Lanes'); the rows at the foot of Lanes' rail
  stay, and the rail is no longer unfolded for it.

Tests: `test/ui/summary-band.test.ts` (both layouts: folded to start with, the button and a click on
the line unfold, *Why?* inside the line does not, the spacer, the band directly under the bar and above
the timeline, the cards against the readout, the model marker, *Why?* on the outcome card, no band and no
button without a run, the preference and its storage, and the Split brain chip: yes, no, absent),
`test/sim-split-brain.test.ts` (the reading off the trace: every no, the yes and its window — a manual
failover with fast-start failover disabled and the old primary still open (enabled, it is drawn stalled and not counted), closed where it crashes or is shut
down, a restarted former primary still mounted, a switchover not asked — the application's view of it, the
runs that are not asked, the claim's label), `test/ui/show-open-former.test.ts` (the SHOW CONFIGURATION note
at a frame where the old primary is open), `readout-fit.test.ts` (Split brain is the first reading
the line gives up), `report.test.ts` (the chip in the print report),
`test/ui/polish-split.test.ts` (the badge against every label, chip and number; the
spoken axis; the restore note's title; auto-fit, manual zoom and Fit; the divider's
press-release, cancel and keyboard), `test/ui/break-layouts.test.ts` (the preference, the switch, Split's bar, the rail
fold for both layouts, in memory and never `dg-rail`, round trips between them, the snap, the
density, Build and Config unchanged), `lanes-events.test.ts` (the buttons per card and
header, changing with the playhead, refusals with their reason, a press landing at the
playhead, the ⋯ menu and Esc, the state on a card at an event's own tick — down at the crash
and open at the restore — the two-line card and its state word, the application host's lane,
the link names on pill, connector and menu, the empty run and its axis, the held axis, the
braces, the data centres' order, the application in its data centre), `lanes-layout.test.ts`
(rail lanes, pill planning and folding, `segmentAt`, `cardSub`, `hostBands`), `timeline-dock.test.ts` (the height and its clamp, the
separator, full screen, `--tl-h`), `rail-collapse.test.ts` (with the Lanes Events drawer at 1024: open, Remove, close by button, Esc and scrim), `contrast.test.ts` (every band label token over its fill, four palettes, >= 4.5:1), and in `lanes-events.test.ts` the drag readout beside the pin. Browser pass (Lanes polish, 2026-09-29: dark, light, the colour-blind palette, 1440×900 and
1280×800, a restore at 20 s with the playhead at 20 s, the empty run, Lanes↔Split↔Lanes and
Build↔Simulate rail widths sampled frame by frame): Split and Lanes at
1440×900 and 1280×800, Split at 1024×768, the findings dropdown, the key popover and full
screen, Build unchanged; Lanes empty, with a crash at 10 s at the playhead at 5 s and at 40 s,
the ⋯ menu and a link pill's menu.

## Simulate's two timelines: Configuration and Application (as built, 2026-09-30)

Simulate draws one of two timelines, chosen with a switch. **Configuration** is the timeline as
it always was (lanes for the members, links and observer, with the optional stacked
*Application's view* lanes under them — that toggle is unchanged). **Application** is the
detail view of the application: the connect string's retry ladder, *Service / Existing
sessions / New connections*, the braces and the outage label — the drawing the Config panel's
*Application view* makes, from the same component (`AppDetail` in `panels/AppView.tsx`; the
panel keeps its caption and wraps it, nothing is drawn twice). Above the figure is a strip of
the connect-string parameters.

- **The switch** (`ui/break/TimelineView.tsx`, `TimelineSwitch`): a `Segmented` (aria-pressed
  buttons, group label *Timeline*), *Configuration | Application*. It exists only in Simulate and
  only while the drawing has an application card (`doc.application`); with none it is not drawn
  and the configuration timeline shows whatever is stored (`appTimelineOn()`). Switching keeps the
  run, the playhead and the selection.
- **Where it sits.** Where the timeline region has a bar, on the bar: **Split**, in `SplitBar`
  right after the terse readout, before the *Fit timeline* button, the findings menu and the key;
  **Lanes**, in `LanesBar` in the same place. Where there is no bar — the docked timeline
  (`TimelineSlot` in `App.tsx`: the docked layout below 1024 px, and the popped-out window) —
  on a slim row of its own at the top of the slot (`.tl-view-row`). With *Application*
  selected, the bar drops what belongs to the configuration's clock (the transport, *Fit
  timeline*, the colour key, the *Application's view* toggle); Split and the docked slot swap the
  timeline for `AppTimeline`, and Lanes swaps its rows for it in the stage (`LanesApp`).
- **The preference** is `breakTimeline` (`state/view.ts`), kept like `breakLayout`:
  localStorage under `dg-break-timeline` (`loadBreakTimeline` at boot, anything but `app` reads
  as Configuration), and not in the address.
- **The strip** (`AppTimeline`): *Defaults* and *Tuned*, then TRANSPORT_CONNECT_TIMEOUT,
  CONNECT_TIMEOUT, RETRY_COUNT and RETRY_DELAY. They are the rail's own controls
  (`ClientTimingControls`, `ClientPresets` in `inspector/ApplicationForm.tsx`, which also puts
  the two buttons at the head of its *Connect string* group), writing `doc.client` through
  `patchClient`, so every edit is undoable and redraws the figure through the `topology`/`trace`
  signals. Greyed out where `canEdit` is false.
- **Defaults / Tuned** write the four parameters as **one** undoable edit (`applyClientTiming`
  in `inspector/edits.ts`); a click that would change nothing leaves no undo step. The sets are
  engine data next to the bounds (`CLIENT_TIMING_DEFAULTS`, `CLIENT_TIMING_TUNED` in
  `engine/defaults.ts`). Defaults are the parameters' own (60 s, unset, 0, 0 s). Tuned — 3 s,
  90 s, 30 retries, 3 s — is **this page's suggested shape**, carried over from the published
  fragment's `APP_TUNED`: only CONNECT_TIMEOUT=90 in the HA overview's example connect string is
  documented (`CLIENT.TIMEOUTS`), and the retry budget as RETRY_COUNT × RETRY_DELAY is priced
  there as 100 × 3 s (`CLIENT.SWITCHOVER_BUDGET_100X3`). The tooltip says so; the buttons are
  pressed while the descriptor holds exactly that set.
- **Tests**: `test/ui/timeline-switch.test.ts`.

## Tuning a run in Simulate (as built, 2026-09-30)

*Superseded 2026-10-01 by "The timeline is the control", below: the settings row and its `Settings` toggle (`TuneStrip`, `tuneOn`, `dg-tune`) are gone; the mapping, the held axis and the grips stand.*

Simulate used to offer no way to change a setting: the reader went to Build, edited the
inspector and came back. Four things put the settings a run answers to on the timeline's own
chrome. All four are offered under one gate -- Simulate, and `canEdit` -- so Learn, the printed
report, the pinned-scale figures and the narrow read-only viewer draw exactly what they drew.

- **One mapping** (`ui/timeline/tune.ts`). `tuneForBrace(doc, trace, brace)` answers which
  setting a brace measures: `threshold` / `abort` / `stall-threshold` are
  FastStartFailoverThreshold, `role` / `sw-role` the role transition constant, `recovery` /
  `sw-catchup` the promoted standby's apply lag. Every other brace has none. **A clock is
  tunable only where its length is the setting's value** (within 0.05 s): where the run
  shortened the interval, a one-for-one edit would move the brace by something else, so there
  is no tune. `applyTune` clamps to `BOUNDS` and calls the inspector's named setter
  (`setFsfoThreshold`, `setRoleTransition`, `setApplyLag`, beside `setProtectionMode`,
  `setFsfoState`, `setFsfoLagLimit` in `inspector/edits.ts`; the forms call the same
  functions), so the undo sentence and the coalesce key are the rail's.
- **The axis holds while a setting is tuned** (`ui/timeline/run.ts`). The axis fits the run,
  so after a settings change every bar used to be redrawn at nearly its old width. A tuning
  edit marks the document it produced (`markTuned` → `tunedScenario`); `useRunTimeline`
  keeps the previous render's axis for that document while the run still fits it
  (`lastInterestingT <= t1`) and unconditionally while a drag or scrub is in progress
  (`tuneDragging`). `held` is true and *Fit timeline* lets go, as after an event drop. Undo, a
  scenario and edits made elsewhere refit as before.
- **The settings row** (superseded 2026-10-01; `ui/break/TuneStrip.tsx` is deleted, its three choices are `SettingChips` and its numbers are braces): Protection mode, FAST_START FAILOVER,
  FastStartFailoverThreshold, FastStartFailoverLagLimit, then LogXptMode and Apply lag for the
  standby the run is about (`tunedStandby`: the one promoted, else the first failover target,
  else the first standby), Role transition, and *All settings* (Build, nothing selected, the
  Fast-start failover fold open). Native selects and number boxes (`TuneNumber`: a value at or
  above the minimum commits as it is typed, one below it on blur or Enter, so 25 can be typed
  past a minimum of 6). Greyed by the inspector's own functions (`lagLimitGate`,
  `logXptOptions` in `inspector/why.ts`) with the reason in a `WhyPill` beside the control,
  cut to the room the row has and whole in its title; each control's title is the note the
  inspector prints under that field (`inspector/notes.ts`). One row at 1100 px and up. It sits
  between the summary band and the timeline in Split and in Lanes, is absent while the
  Application timeline is drawn (that one has its own strip) and while the `Settings` button on
  the bar is off (`tuneOn`, `dg-tune`, on by default).
- **The headline is an equation** where the outcome is a sum (`ui/timeline/equation.ts`,
  `RunHeadline.tsx`): `New primary open read-write at t = 45 s — 30 s
  FastStartFailoverThreshold + 15 s role change and open`, and for a switchover the read-write
  downtime as conversion + catch-up + role change. The terms are the braces' lengths; a term
  that has a tune is a number box, and its label scrubs the value when dragged sideways. **It
  never shows a sum that does not add up**: a clock that starts after t = 0 is a leading
  `t = N s` term, a positive remainder is an `other` term, and anything else falls back to the
  sentence. Every other outcome keeps its sentence.
- **Grips on the clocks** (`ui/timeline/tune-handles.ts`, `TuneDrag.tsx`): one on the end of
  each tunable brace and, where a lane's band is that same interval, one on the band's end.
  `role="slider"`; a drag edits live in one undo entry, arrows step by the bound's step
  (Shift: five), Home and End go to the bounds. A lane grip keeps its lane for the length of a
  drag (`useTuneHandles`): the held axis can cut the band mid-drag, and a grip that unmounted
  would drop the pointer.
- **Events from a lane** (`ui/timeline/LaneAdd.tsx`, Split and the docked timeline): a `+`
  beside the playhead on each member, observer and link lane that offers an action, shown for
  the lane under the pointer and on focus, and a double-click on a lane. Both open Lanes'
  grouped menu (`MoreMenu`, now with a `fixed` variant rendered into `body` so the dock cannot
  clip it) at the playhead's time, and inject with `keepPlayhead`. Lanes has its buttons on
  the cards and gets nothing new.
- **Tests**: `test/ui/tune.test.ts`, `tune-drag.test.ts`, `lane-add.test.ts`. Browser pass
  2026-09-30: Split and Lanes at 1440×900 and 1100×760, dark and light; typing, a lane-grip
  drag and a brace-grip drag, the lane menu and Escape.
- **Not built**: a ghost of the previous run with the delta beside it.

## Topology and the Detailed timeline (as built, 2026-09-30)

*Superseded 2026-10-01 by "The timeline is the control", below: the dock's rows, the small timeline's caption and its bars, and the Detailed timeline's settings column and row; the names, the ids, the lanes and what went with Split stand.*

Two of the four modes were re-cut. The ids did not move (`build`, `break`); what a reader
calls them and what each holds did. **This section supersedes, for these two modes**: §3's
table rows for Build and Simulate, "Simulate's two layouts" (there is one now; everything
it says about Lanes still holds, everything about Split, the layout switch, the resizable
dock, its full screen and the drawing's auto-fit is gone), "Where Simulate's events come
from" (a click no longer opens the list), and the places in "Tuning a run in Simulate" that
say *Split* or *in both layouts*.

- **Names and addresses.** `MODE_LABEL`: Topology, Detailed timeline, Config, Learn. The
  address writes `mode=timeline` and nothing for Topology, and reads `topology`, `build`,
  `timeline`, `simulate` and `break`. Every sentence a reader sees follows; a test scans the
  shell's text, titles and aria labels for the old names.
- **Topology is Build plus the run.** With nothing injected it is Build as it was:
  monochrome cards, the steady-state readout, the add palette at the left, the inspector at
  the right. `runShown()` (`state/derived.ts`: a trace exists and the mode is not Config) is
  the one switch for the rest: the cards and links take their state at the playhead, the
  readout reads the run, and the dock grows the small timeline. Editing stays possible
  throughout; the run recomputes.
- **What a card does in Topology.** Click selects and nothing else. The `⋯` handle, and `A`
  on a focused card, line or data centre, open Build's action table. Right-click,
  `Shift+F10` and `E` open the grouped events at the playhead (`barKind` in `canvas/bar.ts`
  says which table the bar is showing). The hover icons are the break icons, aimed at the
  playhead; a press on one does not start a drag. After a scenario or an event the playhead
  rests at the end of the run, as it did in Simulate.
- **The dock** (superseded 2026-10-01, see `break/PlayDock.tsx`; the docked narrow layout stacks the same parts):
  the status row, the scenario row (`break/ScenarioRow.tsx`: the shelf as one wrapping row of
  buttons, the one whose events are the current list pressed, hidden for read-only viewers),
  then the small timeline while a run exists. With a run the status row is the terse
  one-line readout of the Detailed timeline's bar (`TerseReadout`, `break/RunBar.tsx`) and
  not the cards: three rows of cards over the scenarios and the timeline left the drawing a
  strip at 1024×768. The scenarios were on the left under the add palette in the first cut;
  with a run on screen the two did not fit a 900 px window and the column scrolled in the
  middle of the canvas, so they are in the dock, above the timeline they cause.
- **The small timeline** (superseded 2026-10-01; `timeline/MiniTimeline.tsx`, `styles/mini-timeline.css`): the
  transport, the run's headline as its plain sentence, *Clear*, *Detailed timeline* (the mode,
  playhead kept) and the pop-out; under them one 8 px bar per database, far sync and observer
  lane (no links, no application, no braces, no sentences), the injected events as numbered
  marks on the axis, and a playhead that a press, a drag or the arrow keys move. It is drawn
  from `useRunTimeline`'s model, with the application's lanes counted for the axis (so the
  playhead's resting place is on it) and not drawn.
- **The Detailed timeline is the lanes.** `LanesView` is the mode wherever it floats
  (>= 1024 px); the drawing is not there, and the cards at the head of the lanes are the
  picture of the topology. Its settings *were* (superseded 2026-10-01) a 284 px column at the left (`TuneStrip
  layout="column"`: Protection, Fast-start failover, Standby, Environment, Application with
  the four connect-string timings and *Defaults* / *Tuned*; a greyed control's reason in
  full under it), and the row above the lanes when the section is under 1180 px
  (`tuneLayoutFor`). The rail (Events, *Why this result?*, the scenarios, validation) folds
  on the way in, as it did. Below 1024 px the mode is the read-only viewer it was: the
  drawing and the full timeline.
- **What went with Split**: `LayoutSwitch`, `SplitDock`, `DockControls` (the dock's grip and
  full screen), `breakLayout`, `dg-break-layout`, `dg-tl-h`, `timelineH` / `timelineFull`,
  the drawing's auto-fit (`zoomAuto`, `autoFactor`; *Fit* is 1:1 again) and
  `ScenarioPalette`. Renamed: `SplitBar.tsx` → `RunBar.tsx` (`TerseReadout`,
  `FindingsMenu`, `KeyMenu`), `split-rail.ts` → `rail-fold.ts`, `split.css` →
  `timeline-bar.css`.
- **What still draws the full timeline** (`TimelineBody`, with the lane `+`, the grips and
  the marker drag): the window the small timeline's pop-out opens, the docked narrow layout,
  and Learn (read-only). `shellTimelineProps` offers the editing in `build` and `break`
  alike. One playback loop runs at a time: with the timeline popped out the popup drives,
  and the small timeline and the lanes stand down.
- **Introduction, walkthrough, Learn.** *Watch a failover* lands in Topology with the crash
  applied; the walkthrough stays in Topology for all three steps (the threshold step opens
  the inspector's field, and the small timeline follows); Learn's buttons read *Open in
  Topology* and *Open in the detailed timeline*.
- **Tests**: `test/ui/topology-mode.test.ts`, `detailed-timeline.test.ts` (was
  `break-layouts`), `polish-timeline.test.ts` (was `polish-split`), `popout.test.ts`,
  `tune.test.ts` (the column). Browser pass 2026-09-30: Topology at 1440×900 dark and
  1024×768 light, with no run, the healthy run, a crash and an isolation; hover icons,
  right-click, a seek on the small timeline, *Clear*, *Detailed timeline*; the Detailed
  timeline at 1440×900 and 1100×760. Not exercised in a browser: the popped-out timeline
  window, and the `A` key.
- **Nothing above the lanes** (same day, on request): the sticky strip over the lanes --
  the headline (the sentence, or the equation with editable terms), the *Events at t = N s*
  note, the second row of tick labels and the outage brace -- is gone, and the plot starts
  under the bar. The equation had no other home, so `timeline/equation.ts`,
  `RunHeadline.tsx`, `TimelineBody`'s `headline` prop and the `.tl-headline` / `.tl-eq` rules
  went with it; "The headline is an equation" in "Tuning a run in Simulate" is history. The
  threshold, the role transition and the apply lag are edited in the settings column and by
  the grips on the clocks; the outcome and the time the new primary opens are on the bar.

## The timeline is the control (as built, 2026-10-01)

The loop the page is for is *build, break, turn a knob, see the outcome move*, and the
knobs were in a form: a row, then a column, of number boxes beside a drawing whose bars
moved. Six sketches put the settings on the timeline instead -- in the dock, in a column at
the right, under the cards, on the braces -- and were built side by side in one running page
so they could be tried. The user chose two, and they are the page now: **prototype 3** for
Topology's dock and **prototype 6** for the Detailed timeline. They won because the setting
and the outcome are the same object: the threshold *is* the length of a bracket on the bar,
the new primary's opening *is* a badge on the bar it happens on, and a control that sits
away from them asks the reader to join the two. The other four sketches and the switch that
held them did not come along.

**What it replaced.** The settings row above the timeline and the settings column beside
the lanes of 2026-09-30 (`TuneStrip`, its `Settings` toggle, `tuneOn`, `dg-tune`, the
`.tune-*` rules and `SETTINGS_COLUMN_MIN_W`), and the small timeline's caption sentence and
its bare bars. The mapping (`tuneForBrace`), the held axis (`run.ts`) and the grips
(`tune-handles.ts`, `TuneDrag.tsx`) are untouched; `TuneNumber` stays as the number box the
popover and the small timeline's labels edit in.

- **One component for the three choices** (`ui/break/SettingChips.tsx`). Protection mode,
  FAST_START FAILOVER and the LogXptMode of the standby the run is about
  (`tunedStandby`) are `label value ▾` chips -- native selects -- and `All settings →`
  opens Topology's inspector on the fast-start failover fold with nothing selected. Each
  is the inspector's own setter wrapped in `tuned(...)`, greyed by `logXptOptions` with the
  reason in the chip's title; the title opens with the inspector's own sentence
  (`inspector/notes.ts`). Nothing new is claimed. The dock and the Detailed timeline's bar
  both draw this component (`logXpt={false}` would leave the transport off); the bar leaves
  it out while the Application timeline is the one drawn, which has its own strip.
- **Topology's dock** (`ui/break/PlayDock.tsx`, three rows): **Break** -- the scenarios
  (`ScenarioRow label="Break"`) with the chips right-aligned on the same row, wrapping under
  the scenarios where they do not fit -- then the status row (`TerseReadout run` without
  the two readings the timeline draws as badges, and the finding chips; the readout as it
  stands without a run), then the small timeline.
- **The small timeline is the control** (`timeline/MiniTimeline.tsx`, `mini-timeline.css`).
  Every lane but the links is drawn, the application's too, in rows tall enough to carry
  what governs a bar: a labelled **bracket** over the bar of the lane a setting's clock
  belongs to (the lane whose band is that clock where there is one, else the master
  observer's for the threshold and the promoted standby's for the role transition and the
  apply lag), with its name, its
  number and its unit on the label and a **grip** at its right end. Drag the grip and the
  setting moves live and the run recomputes on the held axis; press the **number** on the
  label and it becomes a box (Escape or leaving closes it). Labels of one lane are packed
  left to right: one that would touch the one before slides right, then drops to its
  number, then is left off (its tooltip and grip say the rest). **Outcome badges** -- white
  on the bar, readings not controls -- sit at "New primary open" and at each application's
  reconnect; the model's decision marks are **pins**. On an application's connect-string
  lane a `retry window` bracket spans the first dial to the last that failed: a sum the
  connect string makes, so its grip drags `RETRY_DELAY` when the string waits between
  traversals (the window moves by the number of gaps for each second), else
  `TRANSPORT_CONNECT_TIMEOUT` (`CONNECT_TIMEOUT` where that is set and smaller), and the
  number on it is a reading, not a box. There is no caption sentence. A reader who cannot
  edit sees the brackets and plays the run but has no grips and no boxes.
- **The Detailed timeline** (`break/LanesView.tsx`): no settings column, row or toggle. The
  bar carries the chips and `All settings →` after the readings. A brace that is one setting
  has its label made a button over the plain one (`timeline/BracePopover.tsx`, `BraceLabel`):
  a hover and focus ring and a caret; pressing it opens a card over the label with the
  setting's name, its number box, the inspector's one sentence and -- for the threshold,
  the one clock with a second setting bound to it -- FastStartFailoverLagLimit beside it,
  greyed by `lagLimitGate` with the reason in a `WhyPill` (under 19c with maximum
  availability, as the inspector). It closes on Escape, on a press outside it, on the cross
  and on the label's second press, and hands focus back to the label. Its position is the
  label's box in the body's coordinates, written as `--x` / `--y` through a ref (the one
  escape hatch, as `App.tsx`'s `--bar-bottom`). The grips on the braces and lane bands are
  unchanged: the label is the other way to the same setting.
- **Files.** New: `break/SettingChips.tsx`, `break/PlayDock.tsx`, `timeline/BracePopover.tsx`,
  `styles/setting-chips.css`. Replaced: `timeline/MiniTimeline.tsx` (its export, and
  `glanceLanes`, now "every lane but the links"). Merged into existing sheets:
  `mini-timeline.css` (brackets, badges, pins, the number box), `lanes.css` (the popover),
  `float.css` (the dock's Break row). Additive changes to shared code: `ScenarioRow`'s
  `label`, `TerseReadout`'s `omit`, `TuneId` gains `'clientTiming'`. Deleted: `break/TuneStrip.tsx`
  and what hung on it (`tuneOn`, `toggleTune`, `setTune`, `loadTune`, `TUNE_KEY`, `.tune-strip`
  / `.tune-col` / `.tune-g` / `.tune-f` / `.tune-k` / `.tune-c` / `.tune-sel` / `.tune-spacer` /
  `.tune-all` / `.tune-why` / `.sb-tune`, `.ln-main`, `TuneLayout`, `tuneLayoutFor`).
- **Tests**: `test/ui/mini-timeline-tune.test.ts` (the dock, badges, brackets, a grip, a
  typed number, the retry window, read-only), `brace-popover.test.ts`, and the cases of
  `tune.test.ts` / `tune-drag.test.ts` / `detailed-timeline.test.ts` /
  `summary-band.test.ts` / `topology-mode.test.ts` that followed. Browser pass: to do
  (popover placement, the chips' wrap in the dock at 1024 px, label packing at 1100 px).


## The timeline panel folds; the inspector comes when asked; the finding card is gone (as built, 2026-10-04)

Three changes to the shell, after a pass on how busy it was.

**The whole timeline panel folds, at a handle on its edge.** `timelineOpen` (`state/view.ts`,
`dg-timeline`, open unless stored `'0'`; `loadTimelineOpen` at boot) is the one signal, and
`ui/timeline/PanelHandle.tsx` the one handle. It is a real `<button aria-expanded
aria-controls>` -- full width, a double hairline running out to a tab that carries the
chevron (`▾` open, `▸` folded) and the word *Timeline* -- the first child of Topology's floating
dock card (`#app-dock`) and of the docked `TimelineSlot` (`#tl-slot`: the Detailed timeline below
1024 px, Learn's workbench). Folded, the card is the handle and **nothing else is rendered**: not the
Break row, the chips, the status line, the small timeline, the plot, the transport or the empty
state. With a run the bar's right side says `N events` (`steady state` for the healthy run). Folding
pauses a run that is playing, as the small timeline's own fold does -- that one
(`miniTimelineOpen`, `dg-topology-timeline-v1`) is untouched and is still the smaller fold
inside the panel. `useDockAnchor` measures the card, so the drawing's inset, the zoom pill, the
findings popover and the palette's height follow it to the handle's height with no new code.
On paper both open (`printing`); the popped-out window (`TimelinePop`) has no handle and is
always open. Tests: `test/ui/timeline-panel.test.ts`.

**The inspector comes when asked.** At `wide`, in Topology and Config only, the rail
(`<aside id="app-rail">`) is rendered iff `selection.length > 0 || inspectorOpen`
(`inspectorRailWanted`, `railOnDemand` in `state/view.ts`); otherwise it is not in the
document -- no strip -- and the room is given back: `.app.no-rail` makes the docked grid one
column (`rail.css`) and restates `--rail-space` as the margin alone in the floating layout, so the
drawing's fit, the dock, the zoom pill and the findings popover all follow. `inspectorOpen` is
"the reader opened it on purpose" (the drawer's open state below `wide`, unchanged). The ways in
with nothing selected: the top bar's Inspector button (the `PanelIcon` glyph, `aria-expanded`,
`wide` in Topology and Config only), `]`, and every gesture that sends the reader to a property
(`revealRail()` in `persist.ts`: Edit, a finding's row, `All settings →`, the walkthrough, the
run explanation's settings links -- with a selection the rail is already there; with none it
opens the configuration). `toggleRail()` toggles; shutting it with a selection also clears the
selection. The rail bar's button is a **close** here (`Close the Inspector panel`, `]` in its
title): it clears the selection and `inspectorOpen`. The strip state (`railCollapsed`, `dg-rail`) is
Break's Events rail's alone, including `break/rail-fold.ts`; Build and Config ignore it. Break,
Learn and the drawers below `wide` are unchanged.

*The gesture the rail must not break.* The floating drawing is centred in a box inset by the
rail's width (`--rail-space`) and the docked grid's stage narrows with its column, so the rail
arriving moves the cards -- and a double-click to rename is two clicks: the first selects, the second
would land on the ground. A press never selects (the card's `click` does, after the pointer is
up), so a drag cannot bring the rail mid-gesture; the one gesture that is not safe is that
double-click, so the first selection from nothing holds the rail for 450 ms (`holdRail`,
`railHeld`, called from `CanvasSlot`'s `onSelect`), and the rail waits out a name being typed
on the drawing (`renaming`) as well, arriving when it is committed. A gesture that asks for the
rail by name (`revealRail`) releases the hold.

**The inspector is decluttered.** The header is the subject: a tile, the kind over the **name, which
is the field that renames it** (`NameField`, `inspector/controls.tsx`) -- the configuration's, a
member's `db_unique_name` (the kind line says so), an observer's, a data centre's, an application's;
a link, a derived line and a RAC instance have none and show plain text. It commits on change through the
rename functions in `edits.ts` (`renameConfig`, `renameMember`, `renameObserver`, `renameSite`,
`renameApplication`); a refused rename edits nothing and the field snaps back to the real name;
`Esc` gives the typed name up; `focusField` still takes the caret into it, text selected. The
`Name` / `db_unique_name` rows are gone from the forms, and with `Hints` the header carries the
sentence that was under them. The `Configuration summary` fold and its Hints reveal are gone (the
Detailed timeline's run summary, `summaryOpen`, is another thing and is untouched). The header's
actions are `Hints` and, where it applies, `Remove`; a refused Remove carries its reason on the
button (`title`, `aria-describedby` to a visually hidden span), not in a box under the header. Each
form opens on its primary section and folds the rest with a one-line hint (a member: role and apply,
and transport, then `Connection`, `Instances`, routes, destinations; an observer: its host, then
`START OBSERVER`; a data centre: its hosts, then `Links`; an application: where it stands and its
connect string, then `ADDRESS_LIST` and *This page's model*); a closed fold is one line, its title
never wrapping and its hint cut with an ellipsis and whole in its `title`. Rows that are disabled
for one identical reason are one line (`Withheld`): a primary's four apply and lag rows, and under
19c the two ObserverPing values with their switch and LagType with LagGraceTime -- a row that is off
for its own reason keeps its pill. `BystandersFollowRoleChange` and `ConfigurationWideServiceName`
still sit open under `Configuration`: main has no `Advanced` fold to move them into. Closed folds
carry no rule under them. Tests: `test/ui/rail.test.ts`, `inspector.test.ts`, `hints.test.ts`.

**The finding card is gone.** `FindingToast` -- the small card above the dock that surfaced the most
serious finding with `Details` and `×` -- and its `findingWaved` signal and `.fnd-toast` rules are
deleted: the chips on the dock's status line (`FindingsChips`) count the findings and open the
popover, and the Detailed timeline's bar carries its count. The generic action toast (`toast`) is
unchanged.

### Workbench controls (ported to current main, 2026-10-04)

The controls first built on the older Build/Break shell are integrated with the
Topology, Detailed timeline, Config and Learn layouts. The data model, tuning
controls, multiple applications, RAC rows and the held timeline axis remain the
current implementation's.

- **Closed Inspector.** At wide widths, Topology and Config keep the existing
  44 px rail strip when the Inspector's contents are not requested. The strip
  names the Inspector and opens it through `revealRail`. Selection, the top-bar
  button, `I`, `]` and Edit still reveal the appropriate subject; closing still
  clears the selection and explicit open. The selection hold protects a
  double-click rename. Below wide, the existing Inspector button opens the
  drawer. Printing expands the Inspector's contents.
- **Panel resizing.** A separator on the top edge resizes Topology's panel while
  its small timeline is open, and the docked timeline below 1024 px. Drag upward
  to grow; arrows resize, Shift increases the step, Home/End reach the bounds,
  and Enter or a double-click restores the default. Height is remembered in
  `dg-tl-h`; cancelled drags restore the previous preference. The panel's existing
  fold button remains separate. Detailed timeline keeps its full-stage lanes.
- **Chart scaling.** The available plot height controls one uniform SVG scale:
  lanes, text, badges, markers, playhead, braces and tuning grips grow together.
  The time axis reflows to the width before scaling. The minimum model width can
  produce horizontal scrolling at larger scales. SVG coordinates still govern
  scrubbing and tuning. The full timeline also fits its popped-out window;
  lessons, static exports and printing keep their natural size. Size observers
  defer layout writes and renders beyond their delivery cycle; reflow leaves a
  pixel of width to avoid fractional rounding toggling scrollbars.
- **Canvas panning.** Empty-ground dragging moves the SVG viewport at every zoom.
  The Hand tool (`H`, `V` returns to selection), Space-drag and middle-button
  drag pan over cards too. Modifier-drag keeps main's marquee selection. Fit
  (`F`) resets both zoom and pan. Pan is view state, outside the document, undo
  history and share URL; printing omits it.
- **Commands.** Cmd/Ctrl+K and the top-bar command button open a searchable
  palette with keyboard navigation, disabled reasons and Escape/focus return.
  One catalogue drives the palette and hotkeys for modes, panels, presets,
  document actions, additions, selection actions, scenarios, selected-object
  events, playback, timeline folds and canvas tools. It includes the current
  application/configuration timeline switch and run summary. Text fields and
  IME composition keep their editing keys; other dialogs keep their focus
  contract. The help card lists the keys using the current mode names.


## As built: three-step workflow (2026-10-04)

This replaces the combined Topology run dock and Detailed timeline navigation
described above. The document and engine are unchanged; the primary navigation
now presents **1 Topology → 2 Scenario → 3 Outcome**, with a purpose sentence,
step count and explicit next/back actions. Steps remain freely revisitable.
Config and Learn are separate tools, outside the numbered workflow.

- **Topology** draws the starting state and exposes topology editing and settings.
  It has steady-state readings and validation, with no event or playback controls.
- **Scenario** draws the starting topology plus an event-only schedule. Templates
  replace the event list as before. The composer chooses time, target and action;
  canvas menus also schedule events. The timeline draws only authored events,
  never response bands, inferred clocks or outcomes. Markers support pointer drag
  and keyboard movement within ordering bounds. One completed drag is one undo
  entry; cancellation changes nothing. The Events panel supplies exact times,
  removal, reordering and validation. Below 768 px it stays read-only.
- **Outcome** shows response lanes, playback, findings, explanations and readings.
  Selecting a member, observer, application, site or connection opens its settings
  alongside the lanes (a drawer on smaller screens). A grouped connection pill
  lets the reader choose the connection. Brace grips, property popovers and
  setting chips remain available. Settings edits rerun the existing scenario from
  its beginning; they do not inject an event at the playhead. A live comparison
  reports changed outcome/timing values since the last edit, or explicitly says
  they are unchanged. Event editing is reached through **Edit scenario**.

Entering Scenario pauses playback and positions event entry at the last scheduled
event. Entering Outcome shows the last meaningful instant, including a healthy
run for an empty scenario. Steps preserve the document, events and undo history.
Only Outcome and Learn paint simulation state; Topology, Scenario and Config
paint the starting configuration. The removed mini timeline has no active stored
preference. The full docked Outcome/Learn timeline retains its fold and sizing.

Canonical URLs use `mode=scenario` and `mode=outcome`; `timeline`, `simulate` and
`break` remain aliases for Outcome, and published legacy URLs keep their upgrade
path. Shortcuts 1–3 select steps; 4 and 5 open Config and Learn. Timed-event
commands are offered in Scenario, playback in Outcome, and topology edits in
Topology. The Introduction and walkthrough follow the same sequence.
