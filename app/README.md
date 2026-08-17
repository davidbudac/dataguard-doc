# Data Guard topology simulator

A workbench for Oracle Data Guard configurations: **draw** a topology, **break**
it, and watch the clocks. It is the page served at
[davidbudac.cz/dataguard](https://davidbudac.cz/dataguard/), and it replaces the
single-file fast-start failover explainer that used to live there (still served,
frozen, at `/dataguard/legacy/`).

TypeScript + Vite + Preact + `@preact/signals`. English only. Zero external
requests at runtime — no CDN, no web fonts, no network calls — and no inline
`<script>` or `style=` anywhere, so the page runs under
`script-src 'self'; style-src 'self'`.

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
npm test             # vitest, one pass (1114 tests, 50 files)
npm run test:watch
npm run typecheck
```

The whole site — this application plus the legacy page plus the figures — is
built by `node ../site/build.mjs` from the repository root.

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
  ui/          shell, canvas, timeline, inspector, panels, learn
  content/     the nine lessons, the reference tables, the footnotes
  presets/     eleven worked topologies
  styles/      tokens.css and the per-area stylesheets
test/          vitest suites and goldens (see below)
design/        engine.md, ui.md, facts.md
```

**Document versus View**: the Document is what a share link, an export file and
undo carry (topology, events, params, canvas drags); the View is what a reload
may forget (mode, selection, playhead, panel, theme, edition). The document
rides the URL fragment as `#t=` (deflate-raw + base64url, 8000-char cap with an
honest refusal), the view rides readable query keys (`ed`, `mode`, `panel`,
`sel`, `t`, `preset`, `lesson`, `step`, `theme`), and `dg-doc-v1` / `dg-theme` /
`dg-ed` are the localStorage keys. Old links to the legacy page are upgraded on
load by `src/state/legacy-url.ts`.

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
`test/ui/__golden__/` (canvas geometry for all eleven presets). When one moves,
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
deploys — and only ever when the user asks for it. The nginx and CSP details,
the pre-publish checklist and the rest are in
[`../AGENTS.md`](../AGENTS.md#publishing).
