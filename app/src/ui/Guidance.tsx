/**
 * The one line that tells a newcomer what to touch first, and the two forms of
 * the "How this page works" explanation behind it.
 *
 * The verdict this answers was "I was confused how to use it": the page had a
 * drawing, a rail, a timeline and eleven controls, and nothing at all that
 * said where to start. What the first pass built was three bands of chrome for
 * that one idea -- a mode subtitle, a guidance line saying nearly the same
 * thing, and a card the height of five rows -- and the drawing was 260 px tall
 * underneath them. So:
 *
 *  - **One line, with the mode word as its lead-in.** "Build · Click a card,
 *    a data centre or a link to edit it ...". The subtitle moved into the mode
 *    button's `title` (`MODE_SUB`).
 *  - **The first visit gets a strip, not a card**: the three mode clauses on
 *    one line, the link to Learn, and "Got it".
 *  - **The `?` in the header still opens the whole explanation**, which is
 *    where the keyboard map lives -- shortcuts nothing else on the page
 *    announces. It is a toggle, and it says so through `aria-expanded`: a
 *    second press closes the card. Closing it that way writes nothing --
 *    "Got it" is the only control that claims the reader has read the thing.
 *  - **The strip dismisses itself at the first real interaction** -- an edit,
 *    an injected event, a change of mode -- because a reader who is already
 *    working has read it or does not need it. Either way it is remembered in
 *    `localStorage` under `dg-intro-v1` (persist.ts), the same contract the
 *    "Got it" button writes.
 */

import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { doc } from '@/state/doc';
import { dismissIntro, introDismissed } from '@/state/persist';
import { introOpen, mode, modeGuide, MODE_LABEL, viewport } from '@/state/view';

/** The three working modes, one clause each; Learn is the link at the foot. */
const BULLETS: [string, string][] = [
  ['Build', 'draws the deployment — data centres, databases, far syncs, observers and the redo between them.'],
  ['Break', 'injects a failure into that deployment and runs the clocks: detection, threshold, role change, open.'],
  ['Configure', 'prints the same deployment as DGMGRL commands, init parameters and connect strings.'],
];

/** The same three, shortened until they fit on one line together. */
const CLAUSES: [string, string][] = [
  ['Build', 'draws the deployment'],
  ['Break', 'runs the clocks on it'],
  ['Configure', 'prints it as DGMGRL, init parameters, connect strings'],
];

/**
 * The keyboard map, and only the keys this build actually binds.
 *
 * Verified against the handlers, not against the design: the card keys are
 * `onCardKey` in `canvas/TopoCanvas.tsx`, the playhead keys are `onKeyDown` in
 * `timeline/Playhead.tsx`, and Escape on a drawer is the document listener in
 * `common/Sheet.tsx`. Anything not in one of those three is not listed.
 */
const KEYS: { where: string; rows: [string, string][] }[] = [
  {
    where: 'On the drawing, with a card focused',
    rows: [
      ['↑ ↓ ← →', 'move to the next card in the same data centre'],
      ['Enter · Space', 'select it — in Break, that offers its events'],
      /* `onEventMenu` is spread onto the canvas only in Break
         (`canvas/CanvasSlot.tsx`), exactly as `onDelete` is only in Build:
         a key that is bound in one mode says which one. */
      ['E', 'open the event menu for it (Break)'],
      ['Delete', 'remove it (Build)'],
      ['Esc', 'clear the selection'],
    ],
  },
  {
    where: 'On the timeline, with the playhead focused',
    rows: [
      ['Space', 'play or pause'],
      ['← →', 'step one second — with Shift, 0.1 s'],
      ['. ,', 'jump to the next / previous state change'],
      ['Home End', 'jump to the ends of the axis'],
    ],
  },
  {
    where: 'In a drawer or a sheet',
    rows: [['Esc', 'close it and hand the focus back']],
  },
];

/** A real link: it survives a middle click and it can be copied. */
function LearnLink() {
  return (
    <a
      href="?mode=learn"
      onClick={(e) => { e.preventDefault(); mode.value = 'learn'; }}
    >
      Learn
    </a>
  );
}

function GotIt({ quiet }: { quiet?: boolean }) {
  return (
    <button
      type="button"
      class={quiet === true ? 'btn is-quiet' : 'btn'}
      onClick={() => { dismissIntro(); introOpen.value = false; }}
    >
      Got it
    </button>
  );
}

/** The whole explanation, opened from the ? in the header. */
function IntroCard() {
  return (
    <aside class="intro" aria-label="How this page works">
      <div class="intro-hd">
        <span class="eyebrow">How this page works</span>
        <span class="strip-spacer" />
        <GotIt />
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
        <LearnLink />
        {' '}
        walks through it in nine lessons.
      </p>

      <div class="intro-keys">
        <span class="eyebrow">Keyboard</span>
        {KEYS.map((group) => (
          <div class="keys" key={group.where}>
            <p class="keys-where caption">{group.where}</p>
            <dl class="keys-dl">
              {group.rows.map(([k, v]) => (
                <div class="keys-row" key={k}>
                  <dt class="mono">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** The first visit: one row, the same three clauses, and a way out. */
function IntroStrip() {
  return (
    <aside class="intro-strip" aria-label="How this page works">
      <p class="intro-strip-b">
        {CLAUSES.map(([k, v], i) => (
          <span key={k}>
            {i === 0 ? null : ' · '}
            <b>{k}</b>
            {' '}
            {v}
          </span>
        ))}
        {'. '}
        <LearnLink />
        {' '}
        walks through it.
      </p>
      <span class="strip-spacer" />
      <GotIt quiet />
    </aside>
  );
}

/**
 * The first meaningful interaction takes the strip away.
 *
 * An edit, an injected event and a preset load all replace `doc`; a change of
 * mode replaces `mode`. The baseline is read when the strip mounts rather than
 * at import time, so the boot path -- which restores a document and applies
 * the URL's mode before the first render -- is not mistaken for a gesture.
 */
function useDismissOnFirstUse(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const doc0 = doc.value;
    const mode0 = mode.value;
    return effect(() => {
      if (doc.value !== doc0 || mode.value !== mode0) dismissIntro();
    });
  }, [active]);
}

export function Guidance() {
  const m = mode.value;
  /* Read in the component body, so the line re-renders when the window
     crosses a breakpoint: below `wide` the inspector is a drawer, and the
     line says so (`modeGuide`). */
  const v = viewport.value;
  const full = introOpen.value;
  const strip = !full && !introDismissed.value;
  useDismissOnFirstUse(strip);
  return (
    <div class="guide">
      <p class="guide-line">
        <b class="guide-mode">{MODE_LABEL[m]}</b>
        {' · '}
        {modeGuide(m, v)}
      </p>
      {full ? <IntroCard /> : null}
      {strip ? <IntroStrip /> : null}
    </div>
  );
}
