# Agent handoff — dataguard_doc

This repo documents Oracle 19c Data Guard, starting with fast-start failover
(FSFO). This file tells a future agent what exists, how it was produced, and how
to extend it without breaking consistency or accuracy.

## What exists

| Path | What it is |
|---|---|
| `diagrams/fsfo-timeline-crash.svg` (+`.png`) | Swimlane timeline, primary host crash: detection → threshold → failover execution |
| `diagrams/fsfo-timeline-isolated.svg` (+`.png`) | Swimlane timeline, network partition: two independent threshold clocks, primary self-abort (split-brain protection) |
| `diagrams/fsfo-sequence.svg` (+`.png`) | Sequence diagram of the crash case with an elapsed-time gutter |
| `diagrams/fsfo-net-timeout.svg` (+`.png`) | Two panels separating NET_TIMEOUT (redo transport) from the broker failover clocks |
| `diagrams/README.md` | Figure embeds, broker-property table with verified defaults, the ping-properties quirk, Oracle doc links |
| `simulator/fsfo-simulator.html` | Source of the interactive simulator artifact (self-contained HTML fragment) |

The simulator is published as a Claude artifact:
**https://claude.ai/code/artifact/da90b968-3a7e-4cbc-8a32-ec0180d30b51**

## Accuracy rules (non-negotiable)

All domain claims were verified against the Oracle 19c/21c Data Guard Broker
documentation (links in `diagrams/README.md`). Key facts, which every asset must
agree on:

- `FastStartFailoverThreshold` default 30 s, min 6 s. The clock starts when the
  observer FIRST loses its connection to the primary. Failover requires BOTH the
  observer and the target standby to have lost the primary for the threshold,
  plus the standby's readiness check (synchronized in MaxAvailability/
  MaxProtection; apply lag ≤ `FastStartFailoverLagLimit` in MaxPerformance).
- `ObserverPingInterval` default 100 ms; `ObserverPingRetry` default 10.
  Documented quirk: when BOTH are explicitly set, the threshold is ignored for
  the observer's detection. The isolated primary's own stall clock still uses
  the threshold. Detection is stated in every asset as
  pingInterval × (pingRetry + 1) — the first failed ping plus its retries,
  ≈ 1.1 s at the minimums (the docs say only "nearly 1 second"). Docs gap: the 19c properties reference does not list these two
  properties (they exist since 12.2); cite the 21c+ edition for them.
- `FastStartFailoverLagLimit` default 30 s, min 5 s, MaxPerformance only.
- `FastStartFailoverPmyShutdown` default TRUE: a primary STALLED
  (`V$DATABASE.FS_FAILOVER_STATUS`) longer than the threshold, unable to reach
  observer or target standby, aborts itself.
- `NET_TIMEOUT` is a `LOG_ARCHIVE_DEST_n` transport attribute (broker property
  `NetTimeout`), default 30 s, min 1 s, ≥ 8–10 s recommended. It bounds how long
  LGWR waits for the standby's SYNC ack; it is NEVER a failover clock, never
  affects sessions under ASYNC, and must not appear in the broker-properties
  table. In full isolation the FSFO stall overrides its drop-and-continue
  behavior. At the defaults it and the threshold both run 30 s from t = 0 and
  expire together — never draw NET_TIMEOUT as bounding only the first seconds
  of an isolated stall; the commit hang spans the whole stall. The simulator's
  panel B deliberately shortens it to 10 s (and says so) to pull the two
  clocks apart; the threshold/abort still runs 0 → 30 s.
- Failover execution (terminal recovery + role change + open) is
  environment-dependent, not parameter-driven — always label it that way.
- Reinstate (`FastStartFailoverAutoReinstate`, Flashback Database) is
  deliberately out of scope; at most a footnote.

When adding new claims, verify against docs.oracle.com first and note the
source in `diagrams/README.md`.

## Shared visual language

Lanes top to bottom: Primary, Observer, Standby. t = 0 is the failure event.
Phase colors (light-mode hexes; the simulator maps them to theme tokens):
teal `#0E7C6B` serving/open · blue `#2563EB` standby applying · amber `#D97706`
waiting/countdown · red `#D64545` down/stalled (hatched fills) · violet
`#6D5AE6` observer decisions · slate `#475569` neutral. Parameter names always
in a monospace stack, spelled exactly. Braces sit under the axis, tied
pixel-exact to the interval they govern.

All timeline SVGs share one scale so they overlay: **x(t) = 280 + 10·t**
(10 px/s, domain −14 s … +80 s, x = 140…1080); each file records its scale in
an XML comment above the root element. SVGs are standalone: explicit white
background rect (GitHub dark mode), no external references, real `<text>`.

Regenerate a PNG after editing an SVG:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --screenshot=diagrams/NAME.png --window-size=WxH \
  --default-background-color=FFFFFFFF "file://$PWD/diagrams/NAME.svg"
```

(W×H = the SVG's viewBox size.)

## The simulator

`simulator/fsfo-simulator.html` is a self-contained fragment (no doctype/html/
head/body; `<title>` first). Constraints: zero external requests (artifact CSP),
vanilla JS, token-based theming — palette custom properties on `:root`,
redefined under `@media (prefers-color-scheme: dark)` AND under
`:root[data-theme="dark"]` / `:root[data-theme="light"]` so the host toggle wins
both ways. One pure function `computeFsfo(c)` (between `/* MODEL:START */` and
`/* MODEL:END */` markers) derives everything rendered; test it standalone in
node by extracting between the markers. Timing model: initiate = threshold, or
pingInterval × (pingRetry + 1) when the ping properties are set; blocked when
MaxPerformance and lag > lag limit; the isolated primary's abort always uses the
threshold.

To republish after editing: use the Artifact tool with the existing URL above so
the link stays stable (`url:` parameter from a session that didn't originally
publish it). Verify both themes and the four key states before republishing:
defaults, isolated scenario, MaxPerformance with lag > limit (blocked banner),
ping properties set (threshold grayed out, ~1.1 s detection).

## Process that produced this (worth repeating)

1. Verified every parameter default and semantic against Oracle docs before
   designing anything.
2. Wrote one shared spec (domain facts + visual language + per-deliverable
   requirements), then ran two opus-tier subagents in parallel from it — one for
   the static SVGs, one for the simulator.
3. Review pass on top: rendered everything (headless Chrome / both themes /
   edge states), checked domain claims sentence by sentence, fixed wording, and
   only then published and delivered.

Keep that order: facts → spec → build → adversarial review → publish.

## Conventions

- Nothing is committed without the user asking. Commit messages end with
  `Co-Authored-By:` per the harness rules.
- Scenarios covered so far: primary crash and isolated primary. If the user
  asks for reinstate, add it as a new figure/scenario rather than crowding the
  existing ones.
