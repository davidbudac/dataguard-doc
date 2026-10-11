> **Retired.** Moved to `docs/history/` on 2026-10-11 and kept for the record only; `AGENTS.md` is current and wins where they disagree. Relative links below are as written at the time.

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
radio's own label; `ZERO DATA LOSS` is the data-loss policy's; `MAXPERFORMANCE ONLY`
is what the lag grace time says of itself. The note underneath is still where the
reason is spelled out.

## What shows up where

| State | Controls | Pill |
|---|---|---|
| Observer lost | threshold, `ObserverPing*`, lag limit, role transition, `FastStartFailoverPmyShutdown`; in chapter 3, the four connect-string timeouts and the dead-address toggle | `OBSERVER LOST` |
| Switchover | threshold, `ObserverPing*`, `FastStartFailoverPmyShutdown`; in chapter 3, the dead-address toggle | `SWITCHOVER` |
| Observer location = none | the same chapter-1 set, plus the lag limit | `NO OBSERVER` |
| 19c edition | `FastStartFailoverLagType`, `FastStartFailoverLagGraceTime`, the MaxAvailability data-loss policy | `26AI ONLY` |
| MaxAvailability | `FastStartFailoverLagType`, `FastStartFailoverLagGraceTime` | `MAXPERFORMANCE ONLY` |
| MaxPerformance | the MaxAvailability data-loss policy | `MAXAVAILABILITY ONLY` |
| Zero-data-loss readiness | lag limit, on the rail and on the configuration card | `ZERO DATA LOSS` |
| Ping properties set | threshold | `PING PROPERTIES SET` |
| Ping properties set, primary stalls | threshold (still adjustable) | `STALL CLOCK ONLY` |
| Nothing being promoted | lag limit | `NO PROMOTION` |
| Primary never stalls | `FastStartFailoverPmyShutdown` | `NO STALL` |
| Configuration card | `ObserverPingInterval` / `ObserverPingRetry` | `NOT SET EXPLICITLY` |

One pill names a single gray **radio** rather than a whole gray control, so it says
which option it means: `OBSERVER LOST: NO OBSERVER`, the scenario that needs an
observer to lose.

`ZERO DATA LOSS` rather than `MAXPERFORMANCE ONLY` on the lag limit is the one place
the pill had to disagree with the property's old reputation. Since the 26ai fact-check
the limit *is* evaluated in MaxAvailability — at 0 by broker default, which is the
zero-loss rule written as a number, and the control is live the moment the policy goes
to bounded. So what grays it is the policy, not the mode, and the pill says so in both
editions: under 19c, MaxAvailability is zero-loss by definition.

The one exception is the switchover branch, which still gates on the mode alone and so
keeps `MAXPERFORMANCE ONLY` — `SW_NOTES.lagLimitAvail` says the switchover readiness
check is not run in MaxAvailability at all, whatever 26ai does with the limit on a
failover. The pill says what the note says; if that note is stale, both move together.

One state, one pill, wherever it reaches — the chapter-3 rail and the configuration
card use the same strings as chapter 1 rather than a wording of their own.

## How it works

- `ctlPill(ctl, why)` creates the chip on demand and puts it at the top of the
  control, ahead of the property name — it is the first thing to read about a
  control you cannot touch. `depPill(input, why)` does the same under a field on the
  configuration card, which has no notes at all to fall back on. It appends after
  the input rather than inside the label, because the label's `innerHTML` is in the
  i18n snapshot and anything living there would be clobbered on `setLang`.
- The wording lives in one `WHY` table of thirteen entries. The same state grays
  several controls at once, and the reader should recognize it as the same state; each
  entry is a phrase lifted from the control's own note, never a new claim.
- Pills are set from state on every render pass, exactly like the `is-off` class, so
  a `null` reason clears one and leaving a state cannot strand a pill. Every branch
  of `renderControls` that grays a control also sets or clears its pill — including
  the three early-return branches (observer lost, switchover, none).
- `.ctl.is-off` now fades its **children** instead of itself, so the pill stays
  legible on a 46 %-faded control. Opacity on the parent would take the pill down
  with everything else.

## Checks

- Every scenario / placement / mode / policy / edition / ping-properties transition
  driven in a headless Chromium, listing the visible pills in each state: all thirteen
  appear where they should, nothing stranded on the way back out, no console errors.
  The case that matters most passes: 26ai MaxAvailability on the bounded policy leaves
  the lag limit live and pill-free, on the rail and on the configuration card alike.
- Czech strings in `simulator/i18n/cs.json`; verified the pills translate on a language
  switch and translate back. `switchover` is the same word in both, so it carries no
  catalog entry &mdash; `t()` falls through to the key, which is what the catalog test
  requires.
- `node site/build.mjs` (ASCII guard) and the 65 model tests in `site/test.mjs` pass.
  The fragment stays pure ASCII.

Not published — `./site/publish.sh` still has to be run to put this on
davidbudac.cz/dataguard.
