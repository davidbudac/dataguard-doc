# Data Guard topology simulator

A workbench for Oracle Data Guard configurations: **draw** a topology, **break**
it, and watch the clocks. It is the page served at
[dataguard.davidbudac.cz](https://dataguard.davidbudac.cz/), and it replaces the
single-file fast-start failover explainer that used to live there (still served,
frozen, at `/dataguard/legacy/`).

TypeScript + Vite + Preact + `@preact/signals`. English only. Zero external
requests at runtime — no CDN, no web fonts, no network calls — and no inline
`<script>` or `style=` anywhere, so the page runs under
`script-src 'self'; style-src 'self'`.

A first visit opens on the **Topology** workbench. The **Introduction**
(`?intro=1`, `src/ui/intro/`) — what the tool is, what the drawing shows, what the
three workflow steps are for and how to do things — opens only from the "Data Guard" link
in the header's top-left corner (or its own address), and every button on it loads
a real configuration and lands in the mode it names; see `design/ui.md` §3e.

The numbered workflow has three freely revisitable steps:

1. **Topology** — draw members and connections and set the starting configuration.
2. **Scenario** — schedule failures and recoveries on an event-only timeline. Drag
   markers or use exact times in the Events panel; scenario templates provide a start.
3. **Simulate** — inspect each item's response and the final outcome. Select an item
   to edit its settings beside the lanes; the same scenario recomputes immediately
   and reports how its outcome and timings changed since the last edit.

**Config** and **Learn** remain separate tools. Steps share the same document,
undo history and share link. Legacy `mode=timeline`, `outcome` and `break` URLs
open Simulate; new links use `mode=scenario` or `mode=simulate`.

Everything the page asserts about Oracle is either arithmetic over what you
typed, a documented fact with a citation you can open, or labelled on screen as
this page's model. That is enforced by types, not by review: see
[`design/facts.md`](design/facts.md) and the accuracy rules in
[`../AGENTS.md`](../AGENTS.md).

## Commands

```bash
npm install          # first time only
npm run dev          # Vite dev server
npm run build        # tsc --noEmit, then vite build -> ../_site/
npm test             # vitest, one pass
npm run test:watch
npm run typecheck
```

The whole site — this application plus the legacy page plus the figures — is
built by `node ../site/build.mjs` from the repository root. `../site/check.sh`
is the local CI (typecheck, tests, legacy tests, build, browser smoke;
`--quick` stops after the tests), and `.githooks/pre-push` runs its quick form
once `git config core.hooksPath .githooks` is set.

## What is where

```
src/
  engine/      pure, DOM-free domain engine (no DOM, no I/O, no clock, no random)
    types/       TopologyDoc and the derived Trace/RedoGraph types; Claim/Finding
    citations.ts the citation catalogue: URL + the quoted sentence, per fact
    redo/        RedoRoutes parser and the effective redo-graph resolver
    sim/         the epoch-loop simulator (kernel, fsfo, protection, roles, dests)
    validate/    the rule catalogue and the rules
    models/      the ported legacy models: app view, commit, reopen, axis
    generate/    DGMGRL, LOG_ARCHIVE_DEST_n, tnsnames/JDBC, SHOW mocks
    compat/      the 1+1+1 adapter the legacy 24-cell matrix runs against
  state/       Document vs View signals, undo, URL, persistence, legacy URLs
  ui/          shell, canvas, timeline, inspector, panels, learn, intro
  content/     the ten lessons, the reference tables, the footnotes
  presets/     twelve worked topologies
  styles/      tokens.css and the per-area stylesheets
test/          vitest suites and goldens (see below)
design/        engine.md, ui.md, facts.md
```

**Document versus View**: the Document is what a share link, an export file and
undo carry (topology, events, params, canvas drags); the View is what a reload
may forget (mode, selection, playhead, panel, theme, edition). The document
rides the URL fragment as `#t=` (deflate-raw + base64url, 8000-char cap with an
honest refusal), the view rides readable query keys (`ed`, `mode`, `intro`,
`panel`, `sel`, `t`, `preset`, `lesson`, `step`, `theme`), and `dg-doc-v1` /
`dg-theme` / `dg-ed` are the localStorage keys. An untouched preset needs no fragment at
all: while the document is still, value for value, the preset it names,
`?preset=<id>` is the whole address. Old links to the legacy page are upgraded on
load by `src/state/legacy-url.ts`.

**Saved configurations** (⋯ menu → Saved configurations) are named copies in
this browser. Save updates the open named copy; Duplicate creates another.
Each copy holds the document and its 19c/26ai edition. Opening an example,
lesson, imported file or saved copy is one undoable step, and the outgoing
draft is also kept in a browser-local list of the 30 most recent ones
(`dg-recovery-v1`) -- an untouched preset is not kept, the picker has it.
Named copies use `dg-workspaces-v1`. Both stores are read back through the
normal import codec and a record that does not decode cleanly is refused; a
storage error is shown in the dialog, and a failed recovery write leaves
Undo available for the current visit. Export a JSON file to move a
configuration to another browser or device.

**Compare alternatives** (⋯ menu) saves a baseline in this browser
(`dg-review-baseline-v1`) and reads it beside the configuration on screen
under one named scenario, or runs the six common scenarios one by one against
the configuration, each with its scenario at t = 0 in place of the authored
events. Optional expected outcomes, opening deadlines and loss limits are
checked against the model -- they are not measured recovery objectives. A
run made against other settings is marked stale; opening a result restores
the tested configuration, with Undo available. The ⋯ → Report as PDF page
prints the comparison and an up-to-date scenario run as its own section; the
branch's standalone HTML review download was not ported (one report system).

In Simulate, **Why this result?** (a fold on the rail under the events, and the
"Why?" beside the outcome in the readout) lists the run's recorded decisions
with the basis and sources of each; selecting a step moves the playhead there
and selects what it is about. The Introduction's **Walk through it step by
step** runs a three-step classic walkthrough (crash, advance to the failover,
change `FastStartFailoverThreshold`) in a card under the guidance line.

## Testing

`npm test` runs everything. Three suites are load-bearing:

- **`test/legacy-matrix.test.ts`** — the legacy page's verified 24-cell
  scenario × observer-location outcome matrix, run against this engine through
  `engine/compat/classic.ts`. The general engine may not "improve" on those
  outcomes; the same matrix is pinned in `site/test.mjs` and worded in
  `diagrams/README.md`, so a change is a change to all three.
- **`src/engine/__tests__/purity.test.ts`** and **`test/import-boundary.test.ts`**
  — the engine stays DOM-free and the UI stays on the far side of
  `engine/index.ts`.
- **`src/engine/__tests__/citations.test.ts`** — every citation id resolves, and
  no source is cited for a fact the accuracy rules forbid it for.

Goldens live in `test/__golden__/` (generated configuration files) and
`test/ui/__golden__/` (canvas geometry for all twelve presets). When one moves,
say in the commit message whether it recorded geometry or a domain fact.

`node ../site/smoke.mjs` is the browser check of the built tree — it needs
Chrome and a local port, so it does not run in an agent sandbox; run it on a
desktop before publishing.

## Design documents

- [`design/facts.md`](design/facts.md) — the verified Oracle fact sheet for the
  topology features (far sync, cascading, multi-target FSFO, multiple observers,
  RedoRoutes, member types, destination counts), marked `[D]` / `[D-later]` /
  `[UNDOC]` / `[CONFLICT]` per claim. **The only permitted source of a
  "documented" claim.**
- [`design/engine.md`](design/engine.md) — the engine design, including §10,
  *Deviations from the design as built*.
- [`design/ui.md`](design/ui.md) — the application architecture, the CSP rule,
  the four modes, canvas layout and routing, the timeline, and the as-built
  notes.

## Deploying

From the repository root, `./site/publish.sh` builds, runs the three gates and
deploys — and only ever when the user asks for it. The target host lives in
`site/publish.env` (gitignored; copy `site/publish.env.example`). The nginx and CSP details,
the pre-publish checklist and the rest are in
[`../AGENTS.md`](../AGENTS.md#publishing).

## Importing an existing setup

1. On each database / far sync, from CDB$ROOT, as SYSDBA:
   ```bash
   sqlplus -s / as sysdba @dataguard-topology.sql </dev/null > <member>.txt
   # or: bash collect-dataguard.sh > <member>.txt
   ```
2. Combine: `cat primary.txt standby.txt > topology.txt`
3. In the workbench: **⋯ → Import existing setup** → load or paste
   `topology.txt` → **Preview import** → **Draw imported topology**.

Each file holds one `DGTOPO_BEGIN_V1` … `DGTOPO_END_V1` block of JSON lines.
Undo restores the previous drawing.

The read-only [SQL collector](public/collectors/dataguard-topology.sql) and the
optional [Bash wrapper](public/collectors/collect-dataguard.sh) (which also takes
wallet aliases) are downloadable from the dialog. [Instructions and limitations](public/collectors/README.txt)
explain privileges, mounted members and which broker settings need manual review.
Import previews assumptions before replacing the drawing; replacement is undoable.
This reconstructs current topology, not all broker configuration.
