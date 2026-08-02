# Why a gray control is gray — 2026-08-02

The simulator grays controls that the current state has taken away from you: pick
"Observer lost" and the failover clocks go inert, pick MaxAvailability and the lag
limit stops being evaluated. Each of those controls already had a note underneath
saying why — but the notes collapse with the rail (the Notes button), and a reader
with them shut sees a dead control and no reason.

So every gray control now carries a small pill naming the reason, and the pill does
not collapse.

## What shows up where

| State | Controls | Pill |
|---|---|---|
| Observer lost | threshold, `ObserverPing*`, lag limit, role transition, `FastStartFailoverPmyShutdown` | `THE OBSERVER DIED` |
| Switchover | threshold, `ObserverPing*`, `FastStartFailoverPmyShutdown` | `PLANNED SWITCHOVER` |
| Observer location = none | the same set, plus the lag limit | `NO OBSERVER DEPLOYED` |
| 19c edition | `FastStartFailoverLagType`, `FastStartFailoverLagGraceTime` | `A 26AI PROPERTY` |
| MaxAvailability | lag limit, and the two 26ai lag properties | `NOT USED IN MAXAVAILABILITY` |
| Ping properties set | threshold | `THE PING LOOP DETECTS INSTEAD` |
| Ping properties set, primary stalls | threshold (still adjustable) | `STALL CLOCK ONLY` |
| Nothing being promoted | lag limit | `NOTHING IS PROMOTED HERE` |
| Primary never stalls | `FastStartFailoverPmyShutdown` | `THE PRIMARY IS NOT STALLED` |
| Observer lost, chapter 3 | the four connect-string timeouts, dead-address toggle | `NO CONNECTION IS DISTURBED` |
| Switchover, chapter 3 | dead-address toggle | `BOTH LISTENERS ANSWER` |
| Configuration card | `ObserverPingInterval` / `ObserverPingRetry` | `SET THE PROPERTIES FIRST` |
| Configuration card | `FastStartFailoverLagLimit` | `MAXPERFORMANCE ONLY` |

Two pills name a single gray **radio** rather than a whole gray control, so they say
which option they mean: `BOTH SITES: A 26AI PLACEMENT` (the placement 19c cannot
offer) and `OBSERVER LOST: NEEDS AN OBSERVER` (the scenario that needs an observer to
lose).

## How it works

- `ctlPill(ctl, why)` creates the chip on demand and puts it at the top of the
  control, ahead of the property name — it is the first thing to read about a
  control you cannot touch. `depPill(input, why)` does the same under a field on the
  configuration card, which has no notes at all to fall back on. It appends after
  the input rather than inside the label, because the label's `innerHTML` is in the
  i18n snapshot and anything living there would be clobbered on `setLang`.
- The wording lives in one `WHY` table. The same reason grays several controls at
  once, and the reader should recognize it as the same reason; each entry is the
  control's own note compressed to its clause, never a new claim.
- Pills are set from state on every render pass, exactly like the `is-off` class, so
  a `null` reason clears one and leaving a state cannot strand a pill. Every branch
  of `renderControls` that grays a control also sets or clears its pill — including
  the three early-return branches (observer lost, switchover, none).
- `.ctl.is-off` now fades its **children** instead of itself, so the pill stays
  legible on a 46 %-faded control. Opacity on the parent would take the pill down
  with everything else.

## Checks

- Every scenario / placement / mode / ping-properties transition driven in a headless
  Chromium, listing the visible pills in each state: correct set every time, nothing
  stranded on the way back out, no console errors.
- Czech strings added to `simulator/i18n/cs.json`; verified the pills translate on a
  language switch and translate back.
- `node site/build.mjs` (ASCII guard) and the 65 model tests in `site/test.mjs` pass.
  The fragment stays pure ASCII.

Not published — `./site/publish.sh` still has to be run to put this on
davidbudac.cz/dataguard.
