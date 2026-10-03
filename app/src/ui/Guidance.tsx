/**
 * The one line that tells a newcomer what to touch first, and the "How this
 * page works" card behind the `?`.
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
 *  - **The first visit no longer gets a strip here.** The three clauses on one
 *    row, with "Got it" at the end, were the previous answer; a whole
 *    Introduction page is the current one (`ui/intro/`, ui.md SS3e). It does
 *    not open on a first visit -- the header's "Data Guard" link opens it,
 *    instead of the workbench rather than on top of it. `dg-intro-v1` now
 *    records that the reader has been shown that page.
 *  - **The `?` in the header still opens the whole explanation**, which is
 *    where the keyboard map lives -- shortcuts nothing else on the page
 *    announces -- and it is where the Introduction is offered a second time.
 *    It is a toggle, and it says so through `aria-expanded`: a second press
 *    closes the card. Closing it writes nothing: opening an explanation and
 *    shutting it again is not the same as having read the Introduction.
 *  - **A reader who is already working has been shown enough.** An edit or
 *    a change of mode writes `dg-intro-v1` (the mode buttons do it in
 *    `TopBar.tsx`, an edit in the effect below), because somebody who started
 *    editing has answered the question the Introduction exists to answer.
 *  - **The line itself is two halves.** The gesture -- "Click a card, a data
 *    centre or a link to edit it." -- is always on screen; the clause behind
 *    it is explanation and rides with `Hints` (`ui/hints.tsx`), the one switch
 *    that governs the page's prose. `splitGuide` in `state/view.ts` makes the
 *    cut, so the line and the mode button's `title` cannot drift.
 */

import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { doc } from '@/state/doc';
import { dismissIntro, introDismissed } from '@/state/persist';
import { introOpen, mode, MODE_LABEL, splitGuide, viewport } from '@/state/view';
import { HINTS_LABEL, HintsToggle, hintsShown } from './hints';
import { INTRO_HREF, openIntro } from './intro/route';

/** The three working modes, one clause each; Learn is the link at the foot. */
const BULLETS: [string, string][] = [
  ['Topology', 'draw a configuration: data centres, databases, far syncs, observers and the redo between them; then break it with a scenario or a card’s icons and read the small timeline under it.'],
  ['Detailed timeline', 'the run in full: follow a failure through detection, threshold, role change and open, and tune its settings.'],
  ['Config', 'generate DGMGRL commands, init parameters and connect strings from the drawing.'],
];

/**
 * The keyboard map, and only the keys this build actually binds.
 *
 * Verified against the handlers, not against the design: the card keys are
 * `onCardKey` in `canvas/TopoCanvas.tsx`, the playhead keys are `onKeyDown` in
 * `timeline/Playhead.tsx`, and Escape on a drawer is the document listener in
 * `common/Sheet.tsx`, and the page-wide ones are `ui/shortcuts.ts`. Anything
 * not in one of those four is not listed.
 */
const KEYS: { where: string; rows: [string, string][] }[] = [
  {
    where: 'On the drawing, with a card, a data centre or a link caption focused',
    rows: [
      ['↑ ↓ ← →', 'move to the next card in the same data centre — on a link caption, the next link'],
      ['Enter · Space', 'select it — with Shift, add it to the selection'],
      ['F2', 'rename it where it is drawn — a double click does too (Topology)'],
      ['Alt+↑ ↓ ← →', 'move the card 8 px, or the whole selection — with Shift, 32 px (Topology)'],
      ['Shift+F10 · ☰', 'open the events it offers, at the playhead, and move the focus into them — the right button does too'],
      /* `onEvents` is spread onto the canvas only in Topology and the Detailed
         timeline (`canvas/CanvasSlot.tsx`), exactly as `onDelete` is only in
         Topology: a key that is bound in one mode says which one. */
      ['E', 'the same list of events (Topology)'],
      ['A', 'open the ⋯ actions — edit, properties, remove — and move the focus into them (Topology)'],
      ['Delete', 'remove it, or everything selected (Topology)'],
      ['Esc', 'close the actions first, then clear the selection'],
    ],
  },
  {
    where: 'Anywhere on the page, outside a text field',
    rows: [
      ['Ctrl+Z · ⌘Z', 'undo'],
      ['Ctrl+Shift+Z · Ctrl+Y', 'redo'],
      ['Ctrl+A · ⌘A', 'select every card on the drawing'],
      [']', 'collapse or expand the side panel (Topology, Detailed timeline, Config)'],
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

/**
 * The card's own way out. It closes and writes nothing: `dg-intro-v1` says
 * the reader has been shown the Introduction, and reading the keyboard map is
 * not that.
 */
function CloseCard() {
  return (
    <button type="button" class="btn is-quiet" onClick={() => { introOpen.value = false; }}>
      Close
    </button>
  );
}

/** The way to the whole thing, from the short explanation. */
function IntroLink() {
  return (
    <a href={INTRO_HREF} onClick={(e) => { e.preventDefault(); openIntro(); }}>
      Open the introduction
    </a>
  );
}

/**
 * The whole explanation, opened from the ? in the header.
 *
 * Exported because the Introduction has no guidance line under its header and
 * the `?` has to keep working there: a control that does nothing on one page
 * is the one thing the header may not carry (`App.tsx`).
 */
export function IntroCard() {
  return (
    <aside class="intro" aria-label="How this page works">
      <div class="intro-hd">
        <span class="eyebrow">How this page works</span>
        <span class="strip-spacer" />
        <CloseCard />
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
        The four modes show the same configuration, and a shared link carries it.{' '}
        <IntroLink />
        {' explains the drawing and the controls. '}
        <LearnLink />
        {' has ten guided lessons.'}
      </p>

      {/* The one place the toggle is explained rather than merely offered. The
          rail header carries the same button; this is where a reader who never
          noticed it finds out what it does -- and can press it here. */}
      <p class="intro-foot caption">
        <b>{HINTS_LABEL}</b>
        {', in the inspector header, shows help under each control and, in Config, the '}
        {'rest of the line above. It is off by default, and the setting is remembered.'}
        {' '}
        <HintsToggle />
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

/**
 * The first meaningful interaction settles the debt.
 *
 * A reader who goes straight to work never opened the Introduction; once they
 * do something the question it answers has been answered, and the key records
 * that. An edit, an injected event and a
 * preset load all replace `doc`; a change of mode replaces `mode` (and
 * `TopBar` writes the key for that one directly). The baseline is read when
 * this mounts rather than at import time, so the boot path -- which restores a
 * document and applies the URL's mode before the first render -- is not
 * mistaken for a gesture.
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
  useDismissOnFirstUse(!introDismissed.value);
  /* Build and Break have no line: their gestures are in the mode button's
     title (`MODE_SUB`) and the stage's description (`modeGuide`, in
     `App.tsx`), and the band's height is the drawing's. The card the `?` opens
     still hangs from here. */
  if (m === 'break' || m === 'build') return full ? <div class="guide"><IntroCard /></div> : null;
  const { lead, rest } = splitGuide(m, v);
  return (
    <div class="guide">
      <p class="guide-line">
        <b class="guide-mode">{MODE_LABEL[m]}</b>
        {' · '}
        {lead}
        {/* The rest of the sentence is explanation, and it rides with the same
            `Hints` switch the rail notes do -- one toggle for the page's prose,
            not a second mechanism for this line. */}
        {rest === '' || !hintsShown() ? null : ` ${rest}`}
      </p>
      {full ? <IntroCard /> : null}
    </div>
  );
}
