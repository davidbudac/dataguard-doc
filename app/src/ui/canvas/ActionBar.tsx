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
 *
 * Break draws it as a context menu rather than a bar (`sections`): every
 * offered row, grouped under small labels (Fail, Restore, Role change,
 * Broker, and the settings last), each row a full-width item led by the
 * event's glyph, the refused ones dimmed with their reason as a quiet line
 * under them. Nothing is capped and nothing is sent to the rail; a list taller
 * than the room it is given (`maxHeight`) scrolls inside its own box, and that
 * box -- not the list's natural height -- is what the `foreignObject`
 * declares, so Firefox shows exactly what is there to scroll.
 */

import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { WhyPill } from '../common/WhyPill';
import { isHTMLElement } from '../common/dom';
import { GLYPH } from '../common/eventIcons';
import type { EventIconName } from '../common/eventIcons';
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
  /** The event's glyph, at the start of a menu row. */
  icon?: EventIconName;
  run: () => void;
}

/** A labelled group of menu rows, and the quiet sentence that closes it. */
export interface BarSection {
  id: string;
  label: string;
  actions: readonly BarAction[];
  /** One line under the rows: what stands in for the restores that were dropped. */
  quiet?: string | null;
}

/**
 * Seven rows, and the rest is the rail's business. A database card fills all
 * seven -- Edit, three transports, the primary role, `+ Instance`, Remove --
 * and Remove, the way out, is never the row that falls off.
 */
export const MAX_ROWS = 7;

/** The bar's CSS width; `canvas.css` caps `.cv-bar` at the same number. */
export const BAR_W = 240;

/* Measured in a browser rather than guessed: 6 px of padding either side plus
   the border, a 17 px header row, and a 23 px button (`.cv-bar .btn` is
   denser than the rail's) with the 2 px flex gap under it. Guessing them left
   the declared box 15 px short of the content. */
const PAD = 14;
const HEAD = 20;
const ROW = 25;
const MORE = 21;

/* A refusal is a sentence in a pill, and the pill wraps: ~30 uppercase mono
   characters to the line at 10 px inside 226 px of content box. Rounded
   generously in both directions -- the cost of over-declaring is a little
   empty space under the last row, and the cost of under-declaring is a
   refusal with its second line cut off in Firefox. */
const whyHeight = (why: string): number => 8 + 17 * Math.max(1, Math.ceil(why.length / 30));
const quietHeight = (line: string): number => 4 + 17 * Math.max(1, Math.ceil(line.length / 38));

/* The menu's rows, measured off `canvas.css` the same way: a 12 px label at
   line-height 1.3 in 3 px of padding either side, a 10 px section label with
   its 6 px of air above, and an 11 px refusal line at 1.35. The label wraps
   at ~30 characters beside its glyph, the refusal at ~34 under it. */
export const MENU_W = 264;
const MENU_HEAD = 24;
const MENU_SEC = 20;
const MENU_ROW_LINE = 16;
const MENU_ROW_PAD = 7;
const menuLines = (text: string, per: number): number => Math.max(1, Math.ceil(text.length / per));
const menuRowHeight = (a: BarAction): number =>
  MENU_ROW_PAD + MENU_ROW_LINE * menuLines(a.label, 30)
  + (a.enabled.state === 'off' ? 3 + 15 * menuLines(a.enabled.why, 34) : 0);

/**
 * The menu's natural height, in CSS pixels: every row, every label, every
 * refusal and quiet line, before any `maxHeight` cuts it down to a scroll.
 */
export function menuFootprint(sections: readonly BarSection[]): { w: number; h: number } {
  let h = PAD + MENU_HEAD;
  for (const s of sections) {
    h += MENU_SEC;
    for (const a of s.actions) h += menuRowHeight(a);
    if (s.quiet !== undefined && s.quiet !== null) h += 4 + 16 * menuLines(s.quiet, 40);
  }
  return { w: MENU_W, h };
}

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
  /**
   * Draw it as Break's context menu: these groups, every row, no cap. When
   * present, `actions` and `quiet` are ignored.
   */
  sections?: readonly BarSection[];
  /** The moment the menu's events land, for its header (`at t = 12.3 s`). */
  when?: string;
  /** The tallest the menu may be, in CSS pixels; past it the list scrolls. */
  maxHeight?: number;
  /**
   * The box to declare, when the caller knows better than the estimate --
   * which it does once `onMeasure` has told it what was painted. Never
   * smaller than `barFootprint`'s estimate.
   */
  box?: { w: number; h: number };
  /** What the bar actually measures once painted, in CSS pixels. */
  onMeasure?: (size: { w: number; h: number }) => void;
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

/**
 * One menu row: the glyph, the label, and -- refused -- the reason under it
 * as a quiet line. The reason is the `WhyPill`, the same element every other
 * refusal on the page is, restyled flat by `.cv-menu` so a column of them
 * reads as a list rather than as a row of pills.
 */
function MenuRow({ action }: { action: BarAction }): JSX.Element {
  const off = action.enabled.state === 'off';
  return (
    <div class={`cv-bar-row cv-mi${off ? ' is-off' : ''}`}>
      <button
        type="button"
        class="cv-mi-btn"
        disabled={off}
        aria-pressed={action.pressed}
        onClick={action.run}
      >
        {action.icon === undefined
          ? <span class="cv-mi-ico" aria-hidden="true" />
          : (
            <svg class="cv-mi-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              {GLYPH[action.icon]}
            </svg>
          )}
        <span class="cv-mi-lbl">{action.label}</span>
      </button>
      <WhyPill why={action.enabled} />
    </div>
  );
}

/** The menu's enabled items, in the order they are drawn: what the arrows walk. */
const menuItems = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll('.cv-mi-btn:not(:disabled)')].filter(isHTMLElement);

export function ActionBar(props: ActionBarProps): JSX.Element {
  const sections = props.sections ?? null;
  const menu = sections !== null;
  const quiet = props.quiet ?? null;
  const maxRows = props.maxRows ?? MAX_ROWS;
  const shown = props.actions.slice(0, maxRows);
  const more = props.actions.length > maxRows;
  const cap = menu && props.maxHeight !== undefined ? Math.max(0, props.maxHeight) : null;
  const natural = sections !== null ? menuFootprint(sections) : barFootprint(props.actions, quiet, maxRows);
  /* A menu that scrolls declares the box it scrolls in, never the list's
     natural height: Firefox clips to the declaration, and a box taller than
     the room is exactly the menu under the chrome this cap exists to stop. */
  const estimate = cap === null ? natural : { w: natural.w, h: Math.min(natural.h, cap) };
  const size = props.box === undefined
    ? estimate
    : { w: Math.max(estimate.w, props.box.w), h: Math.max(estimate.h, props.box.h) };
  const box = useRef<HTMLDivElement | null>(null);

  /* The cap is geometry decided at run time, and the page's CSP forbids a
     `style` attribute: the one escape hatch is `style.setProperty` through a
     ref. Before the measurement below, so what is measured is the capped box.
     -2 for the shadow pixel and rounding the measurement adds back. */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (cap === null) el.style.removeProperty('max-height');
    else el.style.setProperty('max-height', `${Math.max(0, cap - 2)}px`);
  }, [cap]);

  /* The estimate is arithmetic over constants that have drifted before
     (ui.md SS3d: "15 px short of the content"); the painted height is the
     truth. Measured before the paint, so a box declared too short is never
     shown short, and reported up so the placement can re-run against the
     real footprint. `offsetHeight` is in CSS pixels whatever the group's
     transform, which is the unit the declaration is in. +2 for the shadow's
     first pixel and the rounding. */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !props.onMeasure) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    if (h > 0 && w > 0) props.onMeasure({ w: w + 2, h: h + 2 });
  });

  /* The focus moves only when the gesture asked for it. A plain click leaves
     it where the reader put it -- taking the focus off the drawing on every
     click would make the arrow keys stop walking the cards. */
  useEffect(() => {
    if (props.focusOnOpen !== true) return;
    const el = box.current;
    if (!el) return;
    const first = el.querySelector('.cv-bar-row button:not(:disabled)')
      ?? el.querySelector('.cv-bar-x');
    if (isHTMLElement(first)) first.focus();
  }, [props.subject, props.focusOnOpen]);

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    /* A menu is walked with the arrows, the way every menu is: Up and Down
       step through the rows that can be pressed (a refused row cannot take
       the focus, and its reason is on screen under it), Home and End jump.
       Stopped here, because the same keys on the drawing walk the cards. */
    if (menu && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End')) {
      const el = box.current;
      if (!el) return;
      const items = menuItems(el);
      if (items.length === 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const at = items.findIndex((b) => b === el.ownerDocument.activeElement);
      const next = ev.key === 'Home' ? 0
        : ev.key === 'End' ? items.length - 1
          : at === -1 ? (ev.key === 'ArrowDown' ? 0 : items.length - 1)
            : (at + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
      return;
    }
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
            class={menu ? 'cv-bar cv-menu' : 'cv-bar'}
            role="group"
            aria-label={`Actions for ${props.subject}`}
            ref={box}
            onKeyDown={onKeyDown}
          >
            <div class="cv-bar-hd">
              {menu && props.when !== undefined ? (
                <span class="cv-bar-subj">
                  <span class="mono">{props.subject}</span>
                  <span class="cv-bar-when"> · {props.when}</span>
                </span>
              ) : <span class="mono">{props.subject}</span>}
              <button
                type="button"
                class="cv-bar-x"
                aria-label={`Close the actions for ${props.subject}`}
                onClick={props.onClose}
              >
                &times;
              </button>
            </div>
            {sections !== null ? (
              <div class="cv-menu-list">
                {sections.map((s) => (
                  <section class="cv-menu-sec" key={s.id} aria-label={s.label}>
                    <p class="cv-menu-lbl">{s.label}</p>
                    {s.actions.map((a) => <MenuRow key={a.id} action={a} />)}
                    {s.quiet === undefined || s.quiet === null ? null : <p class="cv-bar-quiet">{s.quiet}</p>}
                  </section>
                ))}
              </div>
            ) : (
              <>
                {shown.map((a) => (
                  <div class="cv-bar-row" key={a.id}>
                    <Row action={a} />
                  </div>
                ))}
                {more ? (
                  <p class="cv-bar-quiet">More in {props.moreWhere ?? 'the panel on the right'}.</p>
                ) : null}
                {quiet === null ? null : <p class="cv-bar-quiet">{quiet}</p>}
              </>
            )}
          </div>
        </foreignObject>
      </g>
    </g>
  );
}
