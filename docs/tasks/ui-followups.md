# UI follow-ups after the canvas-first redesign

Living task list. Anyone (human or agent) picking this up: read this file first,
update the status line of the task you touch **in the same commit** as the work,
and add a short note under it when you stop half-way.

Context: on 2026-09-28 the "B / canvas-first, floating panels" redesign became the
default look (`61812a9` on `main`). The canvas fills the viewport in Build and
Break at ≥1024 px; top bar, left palette, right inspector card, bottom status
card and zoom pill float over it (`app/src/styles/float.css`, `app/src/ui/App.tsx`,
`app/src/ui/TopBar.tsx`, `app/src/ui/StatusBar.tsx`, `app/src/ui/Findings.tsx`).
Configure and Learn, and viewports <1024 px, fall back to the docked grid.

Rules that bite here (full list in `CLAUDE.md` / `AGENTS.md`): no inline
`style` anywhere (CSP `style-src 'self'`), no inline script, engine stays pure,
UI imports only from `engine/index.ts`, English only. Before every commit, from
`app/`: `npm run typecheck && npm test && npm run build`, and `node site/build.mjs`
from the repo root.

Status values: `todo` · `in progress (branch)` · `done (sha)` · `handoff` (see note).

## Track 1 — canvas interactions (`app/src/ui/canvas/*`)

### 1.1 Drag a card from anywhere on it
Status: done (on main via merge)
Note: root cause was SVG hit-testing only painted fill -- a chassis blade's rect
and a down card's rect paint `fill: none`, so presses fell through to the chassis
or the ground. `canvas.css` now gives `.tp-node > rect.tp-card` `pointer-events: all`;
draggable cards show a `grab` cursor (`.topo-svg.is-movable`).
Today only the name text or the icon starts a drag; the card's empty surface
does not. The whole card rectangle must be the grab target (ports and the `⋯`
button keep their own behaviour).

### 1.2 Dragging a card must not resize its data centre
Status: done (on main via merge)
Note: `TopoCanvas.tsx` freezes every DC rect and the viewBox from the moment a
card drag starts until the drop (no rescaling under the pointer either). On a
drop inside its own DC, `holdsAfter` writes the pre-drag box as a sized override
for any DC that would otherwise shrink (same undo as the drag); it still grows to
take a card let go past its edge. A move into another DC refits the source.
While a card is dragged inside/out of a data centre, the DC rectangle grows /
shrinks with it. The DC box must keep its size during the drag; it may only
re-fit on drop if the card lands outside the current box (or not at all, once 1.3
exists).

### 1.3 User-resizable data centre box
Status: done (on main via merge)
Note: `layout[siteId]` may now carry `w`/`h` (`state/doc.ts` `LayoutOverride`,
codec reads/writes it; old links without it decode identically). `layout.ts`
draws a sized box at its natural anchor + dx/dy, grown to its cards (`SiteBox.fit`,
`.anchor`, `.sized`). A selected DC gets 8 handles (`resizedBox` clamps to the
cards / `SITE_MIN`), `Alt`+arrow resizes from the keyboard, one undo per gesture;
a DC drag carries its box; Tidy resets it. Tests: `test/ui/canvas-resize.test.ts`.
Resize handles on a selected DC (at least the corners, ideally edges too); the
size persists in the document/URL like positions do, undoable, and never smaller
than the cards it contains. Tidy may reset it.

### 1.4 No text selection while dragging
Status: done (on main via merge)
Note: `.topo-svg` is `user-select: none` (the action bar and the rename field
opt back in), and `takeDrag` in `TopoCanvas.tsx` clears any selection a browser
already began once a press becomes a drag; `.is-dragging` shows the grip cursor.
Dragging a card highlights text on the page (browser text selection). Stop it
(e.g. `user-select:none` on the drawing during a drag, `preventDefault` on the
pointerdown that starts a drag) without breaking inline rename / copy of text
elsewhere. If the proper fix turns out to be large, write a handoff note here
instead of the fix.

### 1.5 Show where a dragged card can go
Status: done (on main via merge)
Note: while a card is in the air (`TopoCanvas.tsx` `air` state) other DCs are
dashed violet (`is-can-drop`), other hosts' cards/stacks `is-target-maybe`, and
what cannot take it fades (`is-dim`: RAC cards, a host that refuses). The card
follows the pointer; a `.tp-ghost` outline shows the snapped spot, or its place
in the target stack/DC (`ui/canvas/drop.ts` `landingFor`, laid out on a copy of
the doc). A note by the pointer says what the drop does. New refusal: an observer
and a database never share a host (`mergeVerdict`, the `OBS.ON_DB_HOST` rule).
While dragging: light up valid drop targets (data centres it may move into,
hosts/stacks it may merge into) and dim/deny invalid ones; show the snap
position (ghost outline) where it will land.

### 1.6 Re-layout when an element is added
Status: done (on main via merge)
Note: three parts. (1) Site choice (`ui/build/placement.ts`, called from
`inspector/edits.ts`): a standby goes to an empty DC, else beside the existing
standbys, never into an observer-only DC while another will do (that used to
re-order the columns); a far sync goes beside the primary; an observer joins the
observers. (2) `layout.ts` step 7b `makeWay`: an auto-placed card/stack that
overlaps a hand-moved card slides down clear of it (not while the card is still
being dragged -- `LayoutOptions.transient`, fed by `place.ts` `inFlight`).
(3) `routing.ts`: two last-resort templates (over/under lane, then into the card
from the side of its column) and a fewest-crossings fallback. Presets route as
before (goldens unchanged); `test/ui/canvas-relayout.test.ts` adds to every
preset and asserts no card overlap and no line through a card.
Left for later: DC boxes can still overlap a neighbouring column when hand-moved
cards or a resize push them into it (columns never push each other); the
observer ping/readiness mesh with 3+ observers is still busy.
Adding a standby / far sync / observer / data centre (palette buttons, drops
from the palette) makes a mess: redo and observer lines run through existing
cards and labels, and new items land on top of or awkwardly next to existing
ones. Wanted: the new item goes into a free, sensible slot (inside the right
data centre, not overlapping anything), existing items only shift when they
have to, and link routing avoids crossing cards and their label pills where
possible. Relevant: `ui/canvas/place.ts`, `layout.ts`, `routing.ts`,
`LinkPath.tsx`, the add actions in `ui/build/actions.ts` / `inspector/adds.tsx`.

## Track 2 — export (`app/src/ui/TopBar.tsx` ⋯ menu, new module)

### 2.1 Export the diagram as PNG
Status: done (7d622ef, on main)
Note: ⋯ → "Diagram as PNG" (`app/src/ui/export/diagram.tsx`). Re-draws the canvas off
screen (no selection/handles), copies computed styles onto a clone (`svg-style.ts`),
rasterises it at 2x from a `data:` URL. No CSP change: `img-src 'self' data:` already admits it.
From the ⋯ menu: rasterise the current topology SVG (fonts, theme colours
resolved, transparent or page-coloured ground) and download `<config>.png`.
No new network access; CSP-safe.

### 2.2 Export the whole project as a PDF report
Status: done (7d622ef, on main)
Note: chose a print-styled report page + `window.print()` ("Save as PDF") over a client-side
PDF library: no dependency, no CSP change, vector diagram, selectable text. ⋯ → "Report as PDF"
opens `?report=1` (`ui/export/Report.tsx`, contents assembled in `report-model.ts`), always light, A4.
From the ⋯ menu: a full report — title/summary, the diagram, member/observer
table, validation findings, the generated Configure outputs (DGMGRL, init
params, TNS/JDBC), Break events + outcome if any, and the citations. Either a
generated PDF or a print-styled report page opened for "Save as PDF"; pick the
approach that stays CSP-safe and document the choice here.

## Track 3 — right side panel (`app/src/ui/inspector/*`, `styles/inspector.css`, `styles/float.css`)

### 3.1 Remove wedge "active item" markers
Status: done (on main via merge)
Note: no thick left borders remain. Findings carry severity in their tag plus a
faint error/warning wash; the toast in its chip; Learn's active step, Explain and
note cards use a soft wash (`color-mix` of the tone token); code-line highlights a
wash plus a coloured gutter number; RedoRoutes groups are sunken boxes.
Any marker drawn as a thick left border on a rounded box (it curves into a
wedge at the corners) goes — e.g. `.issue.sv-*`, `button.issue.sv-*`,
`float.css` warning card, `panels.css`, `learn.css` rules. Replace with
something that does not rely on a left border on a rounded box (a dot/tag, a
background tint, or square corners).

### 3.2 Clean up and polish the right side menu
Status: done (on main via merge)
Note: one system in `styles/inspector.css` (float.css no longer restyles the rails):
header with kind + name, one heading style, `Field` rows are `row` or `stack` by a
content-width estimate (`fitsBeside`), list rows (`.lrow`), sub-blocks (`.sub`).
The inspector card is inconsistent: mixed heading styles, uneven spacing,
controls that wrap unpredictably, varying row heights. Make one consistent
system: section headings, label-left/value-right rows, full-width controls
under the label where they do not fit, consistent spacing and dividers, same
look for Build and Break rails. Check every selection type (nothing selected,
DC, member, RAC member, observer, far sync, link) in light and dark.

## Round 2 (2026-09-28)

### 4.1 Small data centre / host icons beside their names
Status: done (735ef5f)
Building icon before each DC label, server icon before host names on cards,
RAC instance rows and shared-host stack headers (`MiniIcon` in NodeCard.tsx).

### 4.2 Fainter dots, with an on/off toggle
Status: done (3dbb468)
`--dot` tint in float.css; nine-dot button at the end of the floating zoom
pill, `gridOn` in view.ts, remembered under `dg-grid`.

## Track 5 — rough edges left by round 1 (canvas)

### 5.1 Data centre columns push each other
Status: todo
Hand-moved cards or a resized DC can make a DC box overlap the neighbouring
column; columns never push each other. Make a grown/resized column push the
columns to its right (and the corridor stays clear for links/pills).

### 5.2 Busy observer lines with 3+ observers
Status: todo
Ping and readiness-check lines crowd the drawing. Bundle/merge parallel
observer lines where they share a corridor, or route them through one trunk.

### 5.3 Drag polish
Status: todo
Link captions drawn over the card being dragged (the dragged card must be on
top); a line lags the dragged card by up to 4 px (snap remainder); lifting one
card out of a stack stretches the stack's frame.

## Track 6 — rough edges left by round 1 (shell, panel, report) + timeline

### 6.1 Resizable Break timeline, with full screen
Status: done (on ui/track6-shell)
Note: `ui/timeline/DockControls.tsx`: a `role="separator"` grip on the panel's top edge
(drag, arrows/PageUp/Home/End, double-click or Enter resets), `timelineH` → `--tl-h`,
remembered as `dg-tl-h`; default `clamp(220px,36dvh,400px)`. `⤢` button → `timelineFull`
(`.tl-full`), Escape leaves (after the findings popover). Docked layout unchanged.
User request: in Break, the timeline panel at the bottom can be dragged taller
(a grab handle on its top edge; height remembered; min/max sensible, keyboard
accessible), and a full-screen button on the panel toggles it to fill the
window (Escape exits). Also fixes the round-1 note that the panel took ~46 % of
the height by default -- pick a sensible default now that it is resizable.

### 6.2 Shell leftovers
Status: todo
- Escape with the findings popover open also clears the canvas selection.
- Modes wrap to a second row of the top bar below ~1100 px.
- The canvas insets use fixed palette widths (104 px Build, 236 px Break)
  instead of measuring the palette.
- Between 1024 and 1279 px the Break event menu floats over the canvas and the
  drawing's fit doesn't leave room for it.
- Configure's tab strip and Learn's lesson list still use uppercase mono labels.

### 6.3 Right panel in wider rails
Status: todo
The row-or-stack choice assumes the 340 px floating rail; in the wider drawer
(1024-1279 px) and Configure's docked rail some fields stack needlessly. Base
the choice on the rail's actual width (container query or measured width).

### 6.4 Report: wide diagrams
Status: todo
Wide configurations (4 DCs in a row) print the diagram small on A4 portrait.
Give the diagram its own landscape page when its aspect ratio calls for it
(`@page` named pages), or scale it to use the page's full width.
