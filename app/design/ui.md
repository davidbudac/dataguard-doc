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

**URL**: fragment `#t=<base64url(deflate-raw(JSON(compact doc)))>` (fallback `#t0=` plain), 8000-char cap with an honest refusal ("too large for a link — export the file"); query keys human-readable: `ed`, `mode`, `panel`, `sel`, `t`, `preset`, `lesson`/`step`, `theme`; one exported FIELDS-style table with parse/serialize/default/clamp; unknown tokens ignored then dropped. The fragment is written **only when the Doc differs from the preset it names** — compared by value on the codec's wire form, so `?preset=classic` alone is the whole address until the first edit and again after undoing back to it; `?preset=` stays on as provenance once it does differ. Write path: effect → 16 ms timer → 300 ms debounce → `replaceState`; `tNow` excluded while playing/scrubbing. Undo never uses `pushState`.

**Undo/redo**: immutable Doc snapshots (`edit(label, fn, coalesceKey?)`, 700 ms coalescing per gesture, cap 100, user-facing labels "Undo: set LogXptMode to FASTSYNC on stby01"). View state never in history; layout drags and event injection are edits.

**Boot order**: theme ← `?theme=`|localStorage|auto; edition ← `?ed=`|localStorage|19c; doc ← `#t=`/`#t0=` → `?lesson=`/`?preset=` → legacy query/`#cfg=` upgrade (§6.4) → localStorage `dg-doc-v1` → classic; view globals from query; render; then start URL/autosave effects. Presets/lessons replace the whole Doc (reproducibility).

**Persistence/files**: `dg-doc-v1` debounced 500 ms with an 8 s "Restored your last configuration · Start fresh" strip; `dg-theme`, `dg-ed`; export `<name>.dgtopo.json` verbose; import through the same whitelist+clamp path, reporting dropped keys; `upgradeConfigV1()` reads the old `{v:1, deployment, params, sim}` shape.

## 3. Screen layout / IA

Four modes, one persistent canvas (the canvas never blinks):

| Mode | Right rail | Bottom row | Canvas |
|---|---|---|---|
| Build | Inspector: `Add` group, then the summary and the config form (folded sections) | Validation issues + steady-state readout | select, drag, `Add` toolbar in the corner |
| Break | Event menu, then the event list, then the scenarios (six legacy ones as one-click templates), then validation | Timeline + sticky transport + readout | click or `E` → event menu; cards tinted by `frame` |
| Configure | Inspector narrowed | Tabs under two headings — **Files**: DGMGRL · LOG_ARCHIVE_DEST_n · tnsnames/JDBC · SHOW; **Behaviour**: Application view · Commit · Reopen | 180 px live strip |
| Learn | — | — | prose-left (60ch) / live workbench-right (step header + drawing + readout + timeline) |

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
- **The page says what to do, on one line.** The guidance line under the header
  leads with the mode word and then says the first gesture: "Build · Click a card,
  a data centre or a link to edit it …" (`MODE_GUIDE` in `state/view.ts`, rendered
  by `Guidance.tsx`). Configure's line says what the mode *is* before it says what
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
  picker files the eleven under six headings (`GROUPED_PRESETS`) with a title of
  five words at most (`Preset.short`; the sentence is the option's own `title`),
  and it compares rather than trusting `?preset=`: the picker names the preset
  while the document still *is* that preset and says "Current configuration
  (edited)" once it is not. The finding count is a button — it takes the reader to
  the panel it counts, which means Build's dock, the foot of the Break rail (its
  drawer below 1280) or, from Configure and Learn, a hand-over to Build; when
  notes are all there is, it unfolds them, because a folded note is a panel with
  nothing in it.
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

## 3b. Second usability pass (as built, 2026-08-17)

Fifteen findings from reading the page as a newcomer would, fixed in one batch.
The theme running through them: *the reader must be able to see the thing they
just did, and the control that does it must sit where they are looking.*

1. **The transport is never scrolled away — and it now drives something.**
   `.tl-foot` carries the transport and nothing else, and `timeline.css` makes it
   `position: sticky; bottom: 0` on an opaque `--sf` ground with a top hairline.
   `.tl` is the sticky containing block and the scrollport is `.app-dock` in Break
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
4. **The Break rail leads with the reader's own work.** Order is now
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
   `styles/readout.css`). Break and Learn lead with a `Drawing at t = <n> s` chip
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
6. **The event menu's clock reading *is* the control.** `EventMenu.tsx`'s title
   still reads `<selection> · Inject at t = [n] s`, but `[n]` is a
   `type="number"` input that snaps to a tenth, floors at 0 and writes `tNow`, so
   the drawing and the number can never disagree; read-only renders the number as
   plain text and drops the input (a disabled box with no reason on it is what the
   WhyPill contract forbids). Under it, one hint: "Events land at the playhead —
   scrub the timeline to inject later." *Deviation from the brief, deliberate:* the
   spec asked for a fixed title **and** a separate `at [ n ] s` field; two
   always-equal numbers for one moment on one line is the disease item 5 cures.
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
8. **Configure says what it is before it says what to do in it — and the line
   names the rail where the rail actually is.** `modeGuide(m, v)` and `railWhere(v)`
   (`state/view.ts`) replaced the constant `MODE_GUIDE`. Configure reads "Generated
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
   about one document (see item 11). The eleven are filed under six `<optgroup>`s
   (`PRESET_GROUPS` / `GROUPED_PRESETS`) with `Preset.short` (≤ 6 words, which is
   what the data and `test/ui/statusbar.test.ts` both hold every one of them to) as
   the label and the old sentence as the option's `title`; ids unchanged. Reset and "Start fresh" set `presetId` to `null` rather than
   `'classic'` — both build the classic *deployment* in its steady state, while the
   `classic` preset carries a crash at t = 0, so claiming the id made the picker say
   "edited" about a document nobody had edited.
10. **A refusal that would be said three times is said once, quietly.** With
    nothing down, every restore in the event menu refuses for the same reason and
    three copies of the shout were the loudest thing on the drawing. `isRestore()`
    (`break/events.ts`) and a filter on `WHY.nothingDown` drop those *entries* and
    put one `.evmenu-quiet` line in their place — the reason stated, not hidden.
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
    empty panel), hands over to Build from Configure and Learn, opens the drawer in
    Break below 1280, then scrolls `.issues` into view on the next task. It was a
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
13. **The seven Configure tabs are filed under two headings.** `PANEL_GROUPS` —
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
    the step's title on the left, `Open in Break` / `Open in Build` on the right.
    Both go through `openStepInMode()` (`learn/route.ts`), which is exactly what
    `LessonStep`'s own button already did, so the prose button and the header button
    are one function. With no lesson open it says "No lesson open — the current
    document" and the buttons only switch mode. The header's buttons used to refuse
    on the narrow read-only viewer with `WHY.readOnlyHere` while `LessonStep`'s did
    not, so on a phone one was grey and one was live; **the gate is gone, and the
    ungated pair is the one that was right.** `canEdit` is about the controls that
    *change* a configuration — the inspector, the canvas, the event menu — which a
    phone has no room for. Following a lesson step is not one of them: the step's
    own "Show me" and "Open in Break" in the prose column are ungated at every
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
    event menu for it (Break)", the way the `Delete` row beside it already named
    Build, because `onEventMenu` reaches the canvas in Break alone
    (`canvas/CanvasSlot.tsx`).

Two new stylesheets came out of this, on purpose: `styles/readout.css` (imported
by `Readout.tsx`) and `styles/evmenu.css` (imported by `EventMenu.tsx`). Each
contains only new class names and overrides nothing in `shell.css` or
`inspector.css`, so cascade order against them does not matter.

One new module came out of it too, and it is the only one that is not chrome:
`timeline/playback.ts` (item 1). It is a hook, not an engine addition — the
engine has no clock and is not allowed one — so nothing under `engine/` changed
to make the page move.

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
