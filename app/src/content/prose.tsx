/**
 * Prose primitives shared by the lessons.
 *
 * No inline styles anywhere (CSP `style-src 'self'`): everything here is a
 * class, and `content.css` is the only stylesheet this module owns.
 */

import type { ComponentChildren, VNode } from 'preact';

export function P({ children }: { children: ComponentChildren }): VNode {
  return <p class="ct-p">{children}</p>;
}

/** The legacy `.caption` -- a small line under a drawing or a table. */
export function Caption({ children }: { children: ComponentChildren }): VNode {
  return <p class="ct-caption">{children}</p>;
}

export function Eyebrow({ children }: { children: ComponentChildren }): VNode {
  return <p class="ct-eyebrow">{children}</p>;
}

/**
 * A coloured note card, the legacy `.note.k-*`. The colour is semantic, never
 * decorative: teal serving, blue applying, amber waiting, red down, violet the
 * observer's or the application's voice, slate neutral.
 */
export function Note({
  kind, title, children,
}: {
  kind: 'tl' | 'bl' | 'am' | 'rd' | 'vi' | 'sl';
  title?: string;
  children: ComponentChildren;
}): VNode {
  return (
    <div class={`ct-note ct-k-${kind}`}>
      {title === undefined ? null : <h4 class="ct-note-h">{title}</h4>}
      {children}
    </div>
  );
}

/** A generated or quoted file, monospaced and scrollable on its own. */
export function Code({ label, children }: { label?: string; children: ComponentChildren }): VNode {
  return (
    <div class="ct-code-wrap">
      {label === undefined ? null : <p class="ct-code-label">{label}</p>}
      <pre class="ct-code">{children}</pre>
    </div>
  );
}

/** A comment line inside a `Code` block -- this page talking, not syntax. */
export function Dim({ children }: { children: ComponentChildren }): VNode {
  return <span class="ct-dim">{children}</span>;
}

/** A value that differs from its documented default. */
export function Hl({ children }: { children: ComponentChildren }): VNode {
  return <span class="ct-hl">{children}</span>;
}

/**
 * A figure. The SVG scrolls inside its own box so the prose column never
 * scrolls sideways, and the caption is always present -- a drawing whose
 * explanation is hidden is a drawing that lies.
 */
export function Figure({
  caption, children,
}: {
  caption?: ComponentChildren;
  children: ComponentChildren;
}): VNode {
  return (
    <figure class="ct-figure">
      <div class="ct-figure-scroll">{children}</div>
      {caption === undefined ? null : <figcaption class="ct-caption">{caption}</figcaption>}
    </figure>
  );
}
