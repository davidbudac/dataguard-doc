/**
 * The line that tells a newcomer what to touch first, and the card that tells
 * them what the four modes are for.
 *
 * The verdict this answers was "I was confused how to use it": the page had a
 * drawing, a rail, a timeline and eleven controls, and nothing at all that
 * said where to start. The line is per mode and always there; the card shows
 * itself once, on the first visit, and afterwards only when the ? in the
 * header asks for it. Dismissal is remembered in `localStorage` under
 * `dg-intro-v1` (persist.ts).
 */

import { dismissIntro, introDismissed } from '@/state/persist';
import { introOpen, mode, MODE_GUIDE } from '@/state/view';

/** The three bullets, one per working mode; Learn is the link at the foot. */
const BULLETS: [string, string][] = [
  ['Build', 'draws the deployment — data centres, databases, far syncs, observers and the redo between them.'],
  ['Break', 'injects a failure into that deployment and runs the clocks: detection, threshold, role change, open.'],
  ['Configure', 'prints the same deployment as DGMGRL commands, init parameters and connect strings.'],
];

function IntroCard() {
  return (
    <aside class="intro" aria-label="How this page works">
      <div class="intro-hd">
        <span class="eyebrow">How this page works</span>
        <span class="rr-spacer" />
        <button
          type="button"
          class="btn"
          onClick={() => { dismissIntro(); introOpen.value = false; }}
        >
          Got it
        </button>
      </div>
      <ul class="intro-list">
        {BULLETS.map(([k, v]) => (
          <li key={k}>
            <b>{k}</b>
            {' '}
            {v}
          </li>
        ))}
      </ul>
      <p class="intro-foot caption">
        Everything is one configuration seen four ways, and every link carries it.
        {' '}
        {/* A real link: it survives a middle click and it can be copied. */}
        <a
          href="?mode=learn"
          onClick={(e) => { e.preventDefault(); mode.value = 'learn'; }}
        >
          Learn
        </a>
        {' '}
        walks through it in nine lessons.
      </p>
    </aside>
  );
}

export function Guidance() {
  const show = introOpen.value || !introDismissed.value;
  return (
    <div class="guide">
      <p class="guide-line">{MODE_GUIDE[mode.value]}</p>
      {show ? <IntroCard /> : null}
    </div>
  );
}
