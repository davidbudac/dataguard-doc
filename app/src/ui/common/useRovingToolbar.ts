/**
 * The keyboard contract `role="toolbar"` announces, written once.
 *
 * A real toolbar is **one tab stop** for the whole strip, with
 * ArrowLeft/ArrowRight, Home and End moving between the controls inside it
 * (WAI-ARIA APG). Telling a screen reader "toolbar" and then handing it four
 * tab stops and dead arrow keys is the same class of lie as a grey button with
 * no reason -- and a strip that sits early in the stage's tab order costs one
 * press per control on every visit through it.
 *
 * The hook exists because there are now two such strips over the drawing --
 * Build's additions and the zoom ladder -- and a contract kept by one of them
 * and not the other is worse than no contract: the reader learns the arrows
 * work here and finds them dead one strip along.
 *
 * A **disabled control cannot hold the focus**, so the tab stop is parked on a
 * live one and the arrows walk only the live ones; a strip whose controls are
 * all refused has no tab stop at all, which is honest -- there is nothing in
 * it to press.
 */

import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

/** A control the strip can hold: an HTML button, or an SVG group standing in for one. */
type Control = HTMLElement | SVGElement;

export interface RovingToolbar {
  /** `0` for the strip's single tab stop, `-1` for everything else. */
  tabIndex: (i: number) => 0 | -1;
  /** Ref for control `i`, so the arrows have something to focus. */
  itemRef: (i: number) => (el: Control | null) => void;
  /** The focus moving by any other route -- a click, Tab -- moves the stop. */
  onFocus: (i: number) => void;
  /** Put this on the element carrying `role="toolbar"`. */
  onKeyDown: (ev: JSX.TargetedKeyboardEvent<Control>) => void;
}

/**
 * @param live One entry per control, in DOM order: true when it can be focused
 *   (i.e. it is not disabled).
 */
export function useRovingToolbar(live: readonly boolean[]): RovingToolbar {
  const usable = live.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
  const [want, setWant] = useState(0);
  const stop = usable.includes(want) ? want : (usable[0] ?? -1);
  const refs = useRef<(Control | null)[]>([]);

  const moveTo = (i: number | undefined): void => {
    if (i === undefined) return;
    setWant(i);
    refs.current[i]?.focus();
  };

  return {
    tabIndex: (i: number) => (i === stop ? 0 : -1),
    itemRef: (i: number) => (el: Control | null): void => { refs.current[i] = el; },
    onFocus: (i: number) => setWant(i),
    onKeyDown: (ev: JSX.TargetedKeyboardEvent<Control>): void => {
      if (usable.length === 0) return;
      const at = usable.indexOf(stop);
      switch (ev.key) {
        case 'ArrowRight':
          ev.preventDefault(); moveTo(usable[(at + 1) % usable.length]); return;
        case 'ArrowLeft':
          ev.preventDefault(); moveTo(usable[(at - 1 + usable.length) % usable.length]); return;
        case 'Home': ev.preventDefault(); moveTo(usable[0]); return;
        case 'End': ev.preventDefault(); moveTo(usable[usable.length - 1]); return;
        default:
      }
    },
  };
}
