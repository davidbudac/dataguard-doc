# Why a gray control is gray — 2026-08-02

The simulator grays controls that the current state has taken away from you: pick
"Observer lost" and the failover clocks go inert, pick MaxAvailability and the lag
limit stops being evaluated. Each of those controls already had a note underneath
saying why — but the notes collapse with the rail (the Notes button), and a reader
with them shut sees a dead control and no reason.

So every gray control now carries a small pill naming the reason, and the pill does
not collapse.

The pill is a hint, not an explanation: one or two words naming the *state* that took
the control away, in the state's own vocabulary. `OBSERVER LOST` is the scenario
radio's own label; `MAXPERFORMANCE ONLY` is what the lag properties say of themselves.
The note underneath is still where the reason is spelled out.

## What shows up where

| State | Controls | Pill |
|---|---|---|
| Observer lost | threshold, `ObserverPing*`, lag limit, role transition, `FastStartFailoverPmyShutdown`; in chapter 3, the four connect-string timeouts and the dead-address toggle | `OBSERVER LOST` |
| Switchover | threshold, `ObserverPing*`, `FastStartFailoverPmyShutdown`; in chapter 3, the dead-address toggle | `SWITCHOVER` |
| Observer location = none | the same chapter-1 set, plus the lag limit | `NO OBSERVER` |
| 19c edition | `FastStartFailoverLagType`, `FastStartFailoverLagGraceTime` | `26AI ONLY` |
| MaxAvailability | lag limit and the two 26ai lag properties, on the rail and on the configuration card alike | `MAXPERFORMANCE ONLY` |
| Ping properties set | threshold | `PING PROPERTIES SET` |
| Ping properties set, primary stalls | threshold (still adjustable) | `STALL CLOCK ONLY` |
| Nothing being promoted | lag limit | `NO PROMOTION` |
| Primary never stalls | `FastStartFailoverPmyShutdown` | `NO STALL` |
| Configuration card | `ObserverPingInterval` / `ObserverPingRetry` | `NOT SET EXPLICITLY` |

Two pills name a single gray **radio** rather than a whole gray control, so they say
which option they mean: `BOTH SITES: 26AI ONLY` (the placement 19c cannot offer) and
`OBSERVER LOST: NO OBSERVER` (the scenario that needs an observer to lose).

One state, one pill, wherever it reaches — the chapter-3 rail and the configuration
card use the same twelve strings as chapter 1 rather than a wording of their own.

## How it works

- `ctlPill(ctl, why)` creates the chip on demand and puts it at the top of the
  control, ahead of the property name — it is the first thing to read about a
  control you cannot touch. `depPill(input, why)` does the same under a field on the
  configuration card, which has no notes at all to fall back on. It appends after
  the input rather than inside the label, because the label's `innerHTML` is in the
  i18n snapshot and anything living there would be clobbered on `setLang`.
- The wording lives in one `WHY` table of twelve entries. The same state grays several
  controls at once, and the reader should recognize it as the same state; each entry
  is a phrase lifted from the control's own note, never a new claim.
- Pills are set from state on every render pass, exactly like the `is-off` class, so
  a `null` reason clears one and leaving a state cannot strand a pill. Every branch
  of `renderControls` that grays a control also sets or clears its pill — including
  the three early-return branches (observer lost, switchover, none).
- `.ctl.is-off` now fades its **children** instead of itself, so the pill stays
  legible on a 46 %-faded control. Opacity on the parent would take the pill down
  with everything else.

## Checks

- Every scenario / placement / mode / edition / ping-properties transition driven in a
  headless Chromium, listing the visible pills in each state: all twelve appear where
  they should, nothing stranded on the way back out, no console errors.
- Czech strings in `simulator/i18n/cs.json`; verified the pills translate on a language
  switch and translate back. `switchover` is the same word in both, so it carries no
  catalog entry &mdash; `t()` falls through to the key, which is what the catalog test
  requires.
- `node site/build.mjs` (ASCII guard) and the 65 model tests in `site/test.mjs` pass.
  The fragment stays pure ASCII.

Not published — `./site/publish.sh` still has to be run to put this on
davidbudac.cz/dataguard.
