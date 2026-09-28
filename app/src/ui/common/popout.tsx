/**
 * Pop a part of the page out into a window of its own -- Break's timeline, or
 * the drawing -- so it can be dragged onto another screen.
 *
 * The new window is an `about:blank` popup of this same origin, and nothing
 * runs in it: the part is rendered by this page's own Preact, as a second root
 * in the popup's body, so it reads and writes the same signals as everything
 * else and there is nothing to keep in sync. (A second root rather than
 * `preact/compat`'s portal: importing compat rewires `onChange` to `onInput`
 * on every field of the page.) The popup
 * gets copies of this page's stylesheets (links, so `style-src 'self'` is
 * satisfied; Vite's dev server injects `<style>` elements, which are copied as
 * they are) and follows the theme and palette attributes on the root.
 *
 * The window is opened in the click handler rather than in an effect: a popup
 * outside a user gesture is a popup the browser blocks.
 *
 * Code that the popped part runs must not assume the main window (common/dom.ts).
 */

import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { toast } from '@/state/view';
import { onGlobalKey } from '../shortcuts';
import { HostWindow } from './dom';

export { isElement, isHTMLElement, useHostWindow } from './dom';

export type PopKind = 'timeline' | 'canvas';

/** The window each part lives in while it is popped out; absent when it is home. */
export const popped = signal<Partial<Record<PopKind, Window>>>({});

const TITLE: Record<PopKind, string> = {
  timeline: 'Timeline — Data Guard topology simulator',
  canvas: 'Drawing — Data Guard topology simulator',
};

const NAME: Record<PopKind, string> = { timeline: 'dg-pop-timeline', canvas: 'dg-pop-canvas' };

/** The root attributes the stylesheets key on (view.ts `applyTheme`, `applyPalette`). */
const MIRRORED = ['data-theme', 'data-palette'] as const;

function geometry(kind: PopKind): string {
  const sw = typeof screen === 'undefined' ? 1280 : screen.availWidth;
  const sh = typeof screen === 'undefined' ? 800 : screen.availHeight;
  const w = kind === 'timeline' ? Math.min(sw, Math.max(900, window.outerWidth)) : Math.min(sw, 1100);
  const h = kind === 'timeline' ? Math.min(sh, 520) : Math.min(sh, 760);
  return `popup,width=${w},height=${h}`;
}

/** Give a blank popup this page's styles and root attributes; returns the portal's host. */
function dress(win: Window, kind: PopKind): { host: HTMLElement; undress: () => void } {
  const d = win.document;
  d.title = TITLE[kind];
  d.documentElement.lang = 'en';
  /* A window of the same name left over from before is reused, not duplicated. */
  d.head.replaceChildren();
  d.body.replaceChildren();
  const charset = d.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  d.head.append(charset);
  for (const n of document.head.querySelectorAll('link[rel~="stylesheet"], link[rel~="icon"], style')) {
    const copy = d.importNode(n, true) as Element;
    /* Absolute, so the copy does not depend on what base URL about:blank inherits. */
    if (n.tagName === 'LINK') copy.setAttribute('href', (n as HTMLLinkElement).href);
    d.head.append(copy);
  }
  const root = document.documentElement;
  const mirror = (): void => {
    for (const a of MIRRORED) {
      const v = root.getAttribute(a);
      if (v === null) d.documentElement.removeAttribute(a);
      else d.documentElement.setAttribute(a, v);
    }
  };
  mirror();
  const mo = new MutationObserver(mirror);
  mo.observe(root, { attributes: true, attributeFilter: [...MIRRORED] });
  const host = d.createElement('div');
  host.className = 'po-host';
  d.body.append(host);
  /* Undo and redo work from the popup too (ui/shortcuts.ts). */
  d.addEventListener('keydown', onGlobalKey);
  return {
    host,
    undress: () => {
      mo.disconnect();
      d.removeEventListener('keydown', onGlobalKey);
    },
  };
}

const hosts = new Map<PopKind, HTMLElement>();

function forget(kind: PopKind): void {
  hosts.delete(kind);
  if (popped.value[kind] === undefined) return;
  const next = { ...popped.value };
  delete next[kind];
  popped.value = next;
}

/** Open `kind` in a window of its own, or bring that window forward. */
export function popOut(kind: PopKind): void {
  const open = popped.value[kind];
  if (open && !open.closed) { open.focus(); return; }
  let win: Window | null = null;
  try { win = window.open('', NAME[kind], geometry(kind)); } catch { win = null; }
  if (!win?.document) {
    toast.value = {
      kind: 'info',
      text: 'The browser blocked the new window. Allow pop-ups for this page and try again.',
    };
    return;
  }
  const { host, undress } = dress(win, kind);
  hosts.set(kind, host);
  /* Closed by the reader, or reloaded -- a reloaded popup is blank, since
     nothing in it runs, so it goes the same way. */
  win.addEventListener('pagehide', () => {
    undress();
    if (popped.value[kind] === win) forget(kind);
    setTimeout(() => { if (!win.closed) win.close(); }, 0);
  });
  popped.value = { ...popped.value, [kind]: win };
}

/** Close `kind`'s window; the part goes back where it was. */
export function popIn(kind: PopKind): void {
  const win = popped.value[kind];
  forget(kind);
  if (win === undefined) return;
  win.close();
  window.focus();
}

/**
 * Renders `children` into `kind`'s popup while it is open, and closes the
 * popup when this page goes away or stops rendering it -- a popup nothing
 * renders into any more is an empty window left on somebody's second screen.
 */
export function Popout({ kind, children }: { kind: PopKind; children: ComponentChildren }) {
  const win = popped.value[kind];
  const host = win === undefined ? undefined : hosts.get(kind);
  useEffect(() => {
    const bye = (): void => { popped.peek()[kind]?.close(); };
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      if (popped.peek()[kind] !== undefined) popIn(kind);
    };
  }, [kind]);
  /* Every render of the owner re-renders the popup's root; unmounting it
     empties the host before the window closes. */
  useLayoutEffect(() => {
    if (win === undefined || host === undefined) return;
    render(<HostWindow.Provider value={win}>{children}</HostWindow.Provider>, host);
  });
  useLayoutEffect(() => {
    if (win === undefined || host === undefined) return undefined;
    return () => render(null, host);
  }, [win, host]);
  return null;
}

const POP_OUT = 'M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3';
const POP_IN = 'M8 8 13.5 2.5M8 8V4.5M8 8h3.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3';

/** The pop-out icon; the arrow points back in once the part is out. */
export function PopIcon({ out }: { out: boolean }) {
  return (
    <svg class="po-ico" viewBox="0 0 16 16" aria-hidden="true">
      <path d={out ? POP_IN : POP_OUT} />
    </svg>
  );
}

const WHAT: Record<PopKind, string> = { timeline: 'timeline', canvas: 'drawing' };

/** The toggle: out into a new window, and back. `class` is the host strip's button class. */
export function PopoutButton({ kind, class: cls = 'btn is-icon' }: { kind: PopKind; class?: string }) {
  const out = popped.value[kind] !== undefined;
  return (
    <button
      type="button"
      class={`${cls} po-btn`}
      aria-pressed={out}
      aria-label={`Open the ${WHAT[kind]} in a new window`}
      title={out
        ? `Bring the ${WHAT[kind]} back into this window`
        : `Open the ${WHAT[kind]} in a new window you can drag to another screen`}
      onClick={() => { if (out) popIn(kind); else popOut(kind); }}
    >
      <PopIcon out={out} />
    </button>
  );
}

/** What stands in the part's place while it is out. */
export function PoppedAway({ kind, label }: { kind: PopKind; label: string }) {
  return (
    <div class="empty po-away">
      <span class="empty-k">{label}</span>
      <p>
        The {WHAT[kind]} is open in its own window.{' '}
        <button type="button" class="btn" onClick={() => popped.peek()[kind]?.focus()}>Show it</button>{' '}
        <button type="button" class="btn" onClick={() => popIn(kind)}>Bring it back</button>
      </p>
    </div>
  );
}
