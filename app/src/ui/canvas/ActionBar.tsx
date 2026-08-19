/**
 * What can be done to the thing on the drawing, on the drawing.
 *
 * The rail on the right and the event menu below both answer "what can I do to
 * this?", and both answer it somewhere the reader is not looking: they had
 * clicked a card. This is the same answer at the card -- the same `BuildAction`
 * and `EventAction` tables, mapped into one neutral `BarAction` shape, so a
 * label or a *refusal* is the table's and cannot drift from the surface beside
 * it.
 *
 * Three things about how it is drawn are load-bearing:
 *
 *  - **It is HTML inside the SVG.** A `<foreignObject>` last in the drawing
 *    paints above everything and holds real `<button>`s, which is what buys
 *    the refusal pills, the focus order and the keyboard for free. Preact
 *    switches namespace for it on its own; an `xmlns` is neither needed nor
 *    typed.
 *  - **It compensates for the drawing's scale.** The canvas renders below 1:1
 *    whenever the stage is narrower than the viewBox -- 0.8 at 1280, 0.61 for
 *    the widest preset -- and 12 px text at 0.61 is not text. The bar rides a
 *    `scale(1/k)` group so it lands at its CSS size on screen; the cost is
 *    that its footprint in *user* units grows as k falls, which is what
 *    `anchor.ts` places against.
 *  - **The box is declared honestly.** Firefox clips a `foreignObject` to its
 *    declared width and height whatever `overflow` says, so the height here is
 *    an estimate that must be generous rather than tight: a refusal that wraps
 *    to two lines and is cut off at one is the invariant this page exists to
 *    keep.
 */

import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { WhyPill } from '../common/WhyPill';
import type { WhyState } from '../common/WhyPill';
import { Action } from '../inspector/controls';

/**
 * One row. Both action tables map into this: Build's `BuildAction` keeps its
 * `pressed` segment, Break's `EventAction` arrives with its events already
 * folded into `run`.
 */
export interface BarAction {
  id: string;
  label: string;
  enabled: WhyState;
  /** For a property with a current value: is this row that value? */
  pressed?: boolean;
  run: () => void;
}

/** Six rows, and the rest is the rail's business. */
export const MAX_ROWS = 6;
/** Break's bar is shorter still: its stage is the short one, and its rail carries the whole list. */
export const MAX_ROWS_BREAK = 4;

/** The bar's CSS width; `canvas.css` caps `.cv-bar` at the same number. */
export const BAR_W = 240;

/* Measured in a browser rather than guessed: 6 px of padding either side plus
   the border, a 17 px header row, and a 23 px button (`.cv-bar .btn` is
   denser than the rail's) with the 2 px flex gap under it. Guessing them left
   the declared box 15 px short of the content. */
const PAD = 14;
const HEAD = 19;
const ROW = 25;
const MORE = 21;

/* A refusal is a sentence in a pill, and the pill wraps: ~30 uppercase mono
   characters to the line at 10 px inside 226 px of content box. Rounded
   generously in both directions -- the cost of over-declaring is a little
   empty space under the last row, and the cost of under-declaring is a
   refusal with its second line cut off in Firefox. */
const whyHeight = (why: string): number => 8 + 17 * Math.max(1, Math.ceil(why.length / 30));
const quietHeight = (line: string): number => 4 + 17 * Math.max(1, Math.ceil(line.length / 38));

/**
 * How much room the bar needs, in CSS pixels.
 *
 * Exported because the placement runs before the render: `TopoCanvas` divides
 * this by the drawing's scale to get the user-unit footprint `placeBar` keeps
 * inside the view.
 */
export function barFootprint(
  actions: readonly BarAction[], quiet: string | null = null, maxRows: number = MAX_ROWS,
): { w: number; h: number } {
  const shown = actions.slice(0, maxRows);
  let h = PAD + HEAD;
  for (const a of shown) {
    h += ROW;
    if (a.enabled.state === 'off') h += whyHeight(a.enabled.why);
  }
  if (actions.length > maxRows) h += MORE;
  if (quiet !== null) h += quietHeight(quiet);
  return { w: BAR_W, h };
}

export interface ActionBarProps {
  /** Top left corner, in the drawing's user units. */
  x: number;
  y: number;
  /** The drawing's own scale, so the bar can undo it. */
  scale: number;
  /** The key the bar is about; the header prints it. */
  subject: string;
  actions: readonly BarAction[];
  /** The one line that stands in for the restores that were dropped. */
  quiet?: string | null;
  /** Opened by a keyboard-shaped gesture: move the focus into it. */
  focusOnOpen?: boolean;
  /** Where the rows past the cap live -- `railWhere()`, which knows the viewport. */
  moreWhere?: string;
  /** The cap on rows; `MAX_ROWS` unless the caller's stage is short. */
  maxRows?: number;
  onClose: () => void;
}

/**
 * A row that is also a value.
 *
 * `Action` is the shared control and every row that is only a verb uses it, so
 * the refusal pill is the one every other surface renders. A row that is one
 * value of a property needs `aria-pressed`, which the shared control does not
 * carry -- this is its markup with that attribute and nothing else added.
 */
function Row({ action }: { action: BarAction }): JSX.Element {
  const off = action.enabled.state === 'off';
  if (action.pressed === undefined) {
    return <Action label={action.label} enabled={action.enabled} onClick={action.run} />;
  }
  return (
    <span class="ctl-off">
      <button
        type="button"
        class={`btn${action.pressed ? ' is-primary' : ''}${off ? ' is-faded' : ''}`}
        disabled={off}
        aria-pressed={action.pressed}
        onClick={action.run}
      >
        {action.label}
      </button>
      <WhyPill why={action.enabled} />
    </span>
  );
}

export function ActionBar(props: ActionBarProps): JSX.Element {
  const quiet = props.quiet ?? null;
  const maxRows = props.maxRows ?? MAX_ROWS;
  const shown = props.actions.slice(0, maxRows);
  const more = props.actions.length > maxRows;
  const size = barFootprint(props.actions, quiet, maxRows);
  const box = useRef<HTMLDivElement | null>(null);

  /* The focus moves only when the gesture asked for it. A plain click leaves
     it where the reader put it -- taking the focus off the drawing on every
     click would make the arrow keys stop walking the cards. */
  useEffect(() => {
    if (props.focusOnOpen !== true) return;
    const el = box.current;
    if (!el) return;
    const first = el.querySelector('.cv-bar-row button:not(:disabled)')
      ?? el.querySelector('.cv-bar-x');
    if (first instanceof HTMLElement) first.focus();
  }, [props.subject, props.focusOnOpen]);

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (ev.key !== 'Escape') return;
    /* Stopped here on purpose: the same key on the drawing clears the
       selection, and closing a menu and forgetting what it was about are two
       presses, not one. */
    ev.preventDefault();
    ev.stopPropagation();
    props.onClose();
  };

  return (
    <g class="tp-actions">
      <g transform={`translate(${props.x},${props.y}) scale(${1 / props.scale})`}>
        <foreignObject width={size.w} height={size.h}>
          <div
            class="cv-bar"
            role="group"
            aria-label={`Actions for ${props.subject}`}
            ref={box}
            onKeyDown={onKeyDown}
          >
            <div class="cv-bar-hd">
              <span class="mono">{props.subject}</span>
              <button
                type="button"
                class="cv-bar-x"
                aria-label={`Close the actions for ${props.subject}`}
                onClick={props.onClose}
              >
                &times;
              </button>
            </div>
            {shown.map((a) => (
              <div class="cv-bar-row" key={a.id}>
                <Row action={a} />
              </div>
            ))}
            {more ? (
              <p class="cv-bar-quiet">More in {props.moreWhere ?? 'the panel on the right'}.</p>
            ) : null}
            {quiet === null ? null : <p class="cv-bar-quiet">{quiet}</p>}
          </div>
        </foreignObject>
      </g>
    </g>
  );
}
