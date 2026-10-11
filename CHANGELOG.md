# Changelog

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
