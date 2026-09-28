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
Status: todo
Today only the name text or the icon starts a drag; the card's empty surface
does not. The whole card rectangle must be the grab target (ports and the `⋯`
button keep their own behaviour).

### 1.2 Dragging a card must not resize its data centre
Status: todo
While a card is dragged inside/out of a data centre, the DC rectangle grows /
shrinks with it. The DC box must keep its size during the drag; it may only
re-fit on drop if the card lands outside the current box (or not at all, once 1.3
exists).

### 1.3 User-resizable data centre box
Status: todo
Resize handles on a selected DC (at least the corners, ideally edges too); the
size persists in the document/URL like positions do, undoable, and never smaller
than the cards it contains. Tidy may reset it.

### 1.4 No text selection while dragging
Status: todo
Dragging a card highlights text on the page (browser text selection). Stop it
(e.g. `user-select:none` on the drawing during a drag, `preventDefault` on the
pointerdown that starts a drag) without breaking inline rename / copy of text
elsewhere. If the proper fix turns out to be large, write a handoff note here
instead of the fix.

### 1.5 Show where a dragged card can go
Status: todo
While dragging: light up valid drop targets (data centres it may move into,
hosts/stacks it may merge into) and dim/deny invalid ones; show the snap
position (ghost outline) where it will land.

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
