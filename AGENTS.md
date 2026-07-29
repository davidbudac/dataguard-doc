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

The simulator was previously published as a Claude artifact. As of 2026-07-29
the artifact is retired and no longer maintained — do not republish it. The
HTML fragment stays in the repo purely as source; treat it like any other
committed file.

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
- Client connect-string facts (simulator "application's view" section; sources
  in `diagrams/README.md`): `TRANSPORT_CONNECT_TIMEOUT` default 60 s per
  ADDRESS; `CONNECT_TIMEOUT` per ADDRESS, no default (HA guide example 90 s);
  `RETRY_COUNT` default 0 (extra traversals of the whole list), `RETRY_DELAY`
  no default; `FAILOVER` default on; `LOAD_BALANCE` default off inside an
  ADDRESS_LIST. Role-based services make the standby refuse instantly with
  ORA-12514. These parameters affect only NEW connections, never established
  sessions. Nominal drawing constants (footnote 3): refusal 0.2 s, OS refusal
  0.15 s, establish 0.3 s; service assumed published the instant the new
  primary opens.

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
head/body; `<title>` first). **It must stay pure ASCII** — because it has no
`<head>`, it carries no `<meta charset>`, so any raw em dash or `×` renders as
mojibake (`Timeline â€” primary crash`). Escape by region: named entities in
markup, `\uXXXX` in JS strings, plain ASCII in comments. Full rule and the
verification command are in [CLAUDE.md](CLAUDE.md). Other constraints: zero
external requests (artifact CSP),
vanilla JS, token-based theming — palette custom properties on `:root`,
redefined under `@media (prefers-color-scheme: dark)` AND under
`:root[data-theme="dark"]` / `:root[data-theme="light"]` so the host toggle wins
both ways. One pure function `computeFsfo(c)` (between `/* MODEL:START */` and
`/* MODEL:END */` markers) derives everything rendered; test it standalone in
node by extracting between the markers. Timing model: initiate = threshold, or
pingInterval × (pingRetry + 1) when the ping properties are set; blocked when
MaxPerformance and lag > lag limit; the isolated primary's abort always uses the
threshold.

The "application's view" section (`#appview`) has its own pure function
`computeApp(a, m, scenario)` between `/* APPMODEL:START */` and
`/* APPMODEL:END */` — it consumes computeFsfo's output and simulates one
worst-case connection request walking the two-address descriptor's retry
ladder (per-pass toll min(TCT, CT) on the dead address, instant ORA-12514 from
the standby, RETRY_DELAY between traversals, success once a traversal reaches
address 2 at/after tOpen). Attempts collapse into an aggregated band when they
would be subpixel; horizons past ~160 s clip with a "gives up at" annotation.
The isolated scenario forces drop (partition = no refusals). Its state object
is `A`; presets: Defaults (parameter defaults) and Tuned (3/90/30×3, HA-guide
shape).

The artifact is retired (see above) — no republish step applies anymore. If the
simulator is ever republished again in the future, verify both themes and the
key states first: defaults, isolated scenario, MaxPerformance with lag > limit
(blocked banner), ping properties set (threshold grayed out, ~1.1 s detection)
— and in the app view: defaults (lucky 60 s hang), defaults + threshold 90
(ORA-12514 banner), Tuned preset (discrete retry ladder), Refused +
RETRY_COUNT 100 (aggregated band), blocked (budget exhausted, "never" chip).

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
