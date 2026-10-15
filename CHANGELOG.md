# Changelog

## Unreleased

- Simulate's lanes scroll again in the split layout; the observer's lane and
  the Application's view were out of reach below the dock's edge.
- The drawing above the lanes is kept only where the window has the height
  for a readable one; otherwise the lanes take the stage and the Drawing
  button says why. The panel's default and ceiling leave the drawing 260 px.
- The docked Simulate below 1024 px no longer overflows the window: the
  timeline scrolls inside the dock and the run's readings are one line.
- The Inspector at 1024–1279 px is a panel beside the lanes, not a modal
  drawer over them.
- The Summary band opens over the lanes instead of squeezing them.
- The step band under the top bar is gone; the numbered steps carry its
  tally and its gate. The Oracle release switch is on the bar again.

## 1.0.0 — 2026-10-11

First public release.

- The workbench: three steps (Topology, Scenario, Simulate), the Config and
  Learn tools, twelve presets, ten lessons, share links, saved copies, PDF
  reports, import of an existing setup from a read-only SQL collector.
- A pure engine with every Oracle claim labelled documented, inferred or
  model, and 344 citations into docs.oracle.com tested against their pages.
- Two fact-check reviews against Oracle's 19c and 26ai documentation
  (`docs/fact-checks/`), with the decisions taken on each finding.
- The frozen single-page explainer the workbench grew out of, still served at
  `/legacy/`.
- A Tauri v2 desktop shell for macOS and Windows; installers are unsigned.
- Local CI (`site/check.sh`, `.githooks/pre-push`); MIT license; the client
  handover documents that used to live in the repository are gone.
