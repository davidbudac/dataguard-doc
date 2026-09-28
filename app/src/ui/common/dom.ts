/**
 * The few DOM helpers a part needs to work in a window other than this one --
 * a popup it has been popped out into (common/popout.tsx).
 *
 * Listeners go on the host window or on `el.ownerDocument`, never on the
 * `window` and `document` globals; element tests go through `isElement`, since
 * `instanceof Element` is false for a node another window owns (Firefox moves
 * an adopted node's wrapper into the popup's realm).
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

/** The window the part being rendered lives in: the popup inside one, else none. */
export const HostWindow = createContext<Window | null>(null);

/** The window this component is drawn in. */
export function useHostWindow(): Window | null {
  const w = useContext(HostWindow);
  return w ?? (typeof window === 'undefined' ? null : window);
}

/** `instanceof Element`, for a node that may belong to another window. */
export function isElement(x: unknown): x is Element {
  return typeof x === 'object' && x !== null && (x as Node).nodeType === 1;
}

/** `instanceof HTMLElement`, likewise. */
export function isHTMLElement(x: unknown): x is HTMLElement {
  return isElement(x) && x.namespaceURI === 'http://www.w3.org/1999/xhtml';
}
