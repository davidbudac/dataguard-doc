/**
 * Where NET_TIMEOUT fits, and where it does not -- two panels on one 30 s
 * window, ported from the legacy fragment (chapter 5, #nettimeoutview).
 *
 * Panel B deliberately shortens NET_TIMEOUT to 10 s, and says so, to pull the
 * two clocks apart: at the defaults both run 30 s from t = 0 and expire
 * together, which is exactly why they get confused.
 *
 * Scale, both panels: x = 246 + 16t, so 0 s = 246 and 30 s = 726.
 * Colours come from the tokens through the classes -- no inline styles.
 */

import type { VNode } from 'preact';

const LABEL =
  "Two mini-timelines from the primary's point of view, both spanning the same thirty seconds. " +
  'Panel A: the standby link fails while the observer is still reachable in MaxAvailability; LGWR ' +
  'blocks for NET_TIMEOUT, then the destination is dropped and the primary carries on open but ' +
  'unsynchronized, so no failover happens. Panel B: the primary is fully isolated and NET_TIMEOUT ' +
  'is deliberately shortened to ten seconds; in-flight commits wait on the acknowledgement until ' +
  'NET_TIMEOUT expires, but the primary is not allowed to continue without reaching the observer ' +
  'or the target standby, so it stalls, and FastStartFailoverThreshold decides the outcome. No ' +
  'acknowledged commit is lost.';

export function NetTimeoutFigure(): VNode {
  return (
    <svg class="ct-svg" viewBox="0 0 960 484" role="img" aria-label={LABEL}>
      <defs>
        <pattern
          id="ctTxHatch" width="8" height="8"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)"
        >
          <rect width="8" height="8" class="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="8" class="hatch-ln" />
        </pattern>
      </defs>

      {/* Panel A -- standby link fails, observer still reachable. */}
      <text class="t-top" x="40" y="18">
        A — Standby link fails, observer still reachable · MaxAvailability (SYNC)
      </text>
      <text class="t-mark f-rd" x="254" y="44">Standby stops acknowledging</text>
      <text class="t-mark f-rd" x="718" y="44" text-anchor="end">
        Error logged — transport session terminated
      </text>
      <line class="gridline" stroke-dasharray="4 4" x1="246" y1="50" x2="246" y2="128" />
      <line class="gridline" stroke-dasharray="4 4" x1="726" y1="50" x2="726" y2="128" />
      <line class="m-rd" stroke-width="2" x1="246" y1="46" x2="246" y2="54" />
      <line class="m-rd" stroke-width="2" x1="726" y1="46" x2="726" y2="54" />
      <text class="t-lane" x="136" y="72" text-anchor="end">Primary</text>
      <text class="t-sub" x="136" y="86" text-anchor="end">SYNC transport</text>
      <rect class="bar b-tl" x="150" y="54" width="96" height="42" />
      <text class="t-bar f-tl" x="198" y="80" text-anchor="middle">Committing</text>
      <rect class="bar b-am" x="246" y="54" width="480" height="42" />
      <text class="t-bar f-am" x="486" y="80" text-anchor="middle">
        LGWR blocks — committing sessions wait on the SYNC acknowledgement
      </text>
      <rect class="bar b-tl" x="726" y="54" width="192" height="42" />
      <text class="t-bar f-tl" x="822" y="80" text-anchor="middle">Open, UNSYNCHRONIZED</text>
      <path class="brace br-am" d="M246,114 q0,5 5,5 H481 q5,0 5,5 q0,-5 5,-5 H721 q5,0 5,-5" />
      <text class="t-brace-n t-mono" x="486" y="140" text-anchor="middle">NET_TIMEOUT</text>
      <text class="t-brace-v t-mono" x="486" y="155" text-anchor="middle">
        30 s default · minimum 1 s · Oracle recommends at least 8–10 s
      </text>
      <text class="t-bar f-sl" x="40" y="178">
        Primary stays open and nothing fails over — but it is now
        <tspan class="t-mono"> UNSYNCHRONIZED</tspan>, so fast-start failover is impossible until the
        standby resynchronizes.
      </text>

      <line class="ax" x1="40" y1="198" x2="920" y2="198" />

      {/* Panel B -- primary fully isolated, NET_TIMEOUT deliberately 10 s. */}
      <text class="t-top" x="40" y="224">
        B — Primary fully isolated from observer and standby · NET_TIMEOUT shortened to 10 s to pull
        the clocks apart
      </text>
      <text class="t-mark f-rd" x="254" y="248">Primary loses observer and standby</text>
      <text class="t-mark f-rd" x="718" y="248" text-anchor="end">Outcome decided</text>
      <line class="gridline" stroke-dasharray="4 4" x1="246" y1="254" x2="246" y2="383" />
      <line class="gridline" stroke-dasharray="4 4" x1="726" y1="254" x2="726" y2="383" />
      <line class="m-rd" stroke-width="2" x1="246" y1="250" x2="246" y2="258" />
      <line class="m-rd" stroke-width="2" x1="726" y1="250" x2="726" y2="258" />
      <text class="t-lane" x="136" y="276" text-anchor="end">Primary</text>
      <text class="t-sub" x="136" y="290" text-anchor="end">isolated</text>
      <rect class="bar b-tl" x="150" y="258" width="96" height="42" />
      <text class="t-bar f-tl" x="198" y="284" text-anchor="middle">Committing</text>
      <rect class="bar b-am" x="246" y="258" width="160" height="42" />
      <text class="t-bar f-am" x="326" y="284" text-anchor="middle">Commits wait on ack</text>
      <rect class="bar b-hatch" x="406" y="258" width="512" height="42" fill="url(#ctTxHatch)" />
      <text class="t-bar f-rd" x="662" y="284" text-anchor="middle">
        STALLED — not allowed to continue alone
      </text>
      <path class="brace br-am" d="M246,314 q0,5 5,5 H321 q5,0 5,5 q0,-5 5,-5 H401 q5,0 5,-5" />
      <text class="t-brace-n t-mono" x="326" y="340" text-anchor="middle">NET_TIMEOUT</text>
      <text class="t-brace-v t-mono" x="326" y="355" text-anchor="middle">
        10 s here — moves only the STALLED boundary, never the outcome
      </text>
      <path class="brace br-rd" d="M246,369 q0,5 5,5 H481 q5,0 5,5 q0,-5 5,-5 H721 q5,0 5,-5" />
      <text class="t-brace-n t-mono" x="486" y="395" text-anchor="middle">
        FastStartFailoverThreshold
      </text>
      <text class="t-brace-v t-mono" x="486" y="410" text-anchor="middle">
        30 s — the clock that actually decides the outcome
      </text>
      <text class="t-bar f-am" x="40" y="432">
        At NET_TIMEOUT the transport gives up and would normally drop the destination and carry on
        alone, but with
      </text>
      <text class="t-bar f-am" x="40" y="447">
        fast-start failover enabled that requires reaching the observer or the target standby. Neither
        answers, so the stall holds.
      </text>
      <text class="t-bar f-sl" x="40" y="469">
        No acknowledged commit is lost: everything acknowledged before t = 0 is already on the standby,
        and nothing after t = 0 is acknowledged at all.
      </text>
    </svg>
  );
}
