/**
 * Resolving the drawing's stylesheet into the drawing itself.
 *
 * The topology SVG is styled by classes and custom properties (`tokens.css`,
 * `canvas.css`): a `<rect class="tp-card">` carries no colour of its own. An
 * SVG serialised as it stands and loaded as an image has no stylesheet at all,
 * so it would render black on transparent. What makes it render right is to
 * copy each element's *computed* style onto its clone -- after the cascade,
 * after `var(--tl)` has become `rgb(14, 124, 107)`, in whichever theme is on.
 *
 * Copying every property of every element would be megabytes. The rule that
 * keeps it small is the cascade's own:
 *
 *  - an **inherited** property is written only where it differs from the
 *    parent's computed value -- that is, only where a rule actually set it.
 *    Writing it everywhere would also be wrong, not just big: the icon a
 *    `<use>` instantiates inherits its stroke from the `<use>`, and a
 *    `stroke: none` copied onto the icon's own `<g>` in `<defs>` would beat
 *    that inheritance and draw every icon invisible;
 *  - a **non-inherited** property is written only where it differs from its
 *    initial value.
 *
 * The decision is pure (`styleDeclarations`), so it is tested without a
 * browser; `inlineComputedStyles` is the thin walk that feeds it.
 */

/** Properties that are inherited, and that decide how an SVG paints. */
export const INHERITED_PROPS: readonly string[] = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'marker-start', 'marker-mid', 'marker-end',
  'paint-order', 'color', 'visibility',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric',
  'letter-spacing', 'word-spacing', 'text-anchor', 'text-transform', 'dominant-baseline',
  'white-space', 'shape-rendering', 'text-rendering',
];

/**
 * Properties that are not inherited, with the initial value a clone gets for
 * free. `display` is here for `none` only: an element CSS hides must stay
 * hidden in the picture.
 */
export const INITIAL_VALUES: Readonly<Record<string, string>> = {
  opacity: '1',
  display: 'inline',
  'clip-path': 'none',
  mask: 'none',
  filter: 'none',
  'stop-color': 'rgb(0, 0, 0)',
  'stop-opacity': '1',
  'vector-effect': 'none',
  'mix-blend-mode': 'normal',
  'text-decoration-line': 'none',
};

/** A computed style, as far as this module needs one. */
export type StyleLookup = (prop: string) => string;

/**
 * The declarations one element needs so that, with no stylesheet, it paints
 * as it does with one. `parent` is the parent element's computed style, or
 * null for the root -- which gets every inherited property, because in the
 * standalone file there is nothing above it to inherit from.
 */
export function styleDeclarations(
  own: StyleLookup,
  parent: StyleLookup | null,
): [string, string][] {
  const out: [string, string][] = [];
  for (const p of INHERITED_PROPS) {
    const v = own(p);
    if (v === '') continue;
    if (parent !== null && parent(p) === v) continue;
    out.push([p, v]);
  }
  for (const [p, initial] of Object.entries(INITIAL_VALUES)) {
    const v = own(p);
    if (v === '' || v === initial) continue;
    /* `display` matters only when it hides; `block` vs `inline` changes
       nothing about how an SVG element paints. */
    if (p === 'display' && v !== 'none') continue;
    out.push([p, v]);
  }
  return out;
}

/**
 * Copy the computed styles of `live` (and everything under it) onto `clone`,
 * which must be `live.cloneNode(true)` -- the two trees are walked in step.
 *
 * Writes go through `style.setProperty`, the CSSOM, which a `style-src 'self'`
 * policy permits; no `style` attribute is ever parsed in the page. They land
 * in the clone's `style` attribute only when the clone is serialised, and by
 * then it is an image's own document, which no page policy governs.
 */
export function inlineComputedStyles(
  live: Element,
  clone: Element,
  computed: (el: Element) => StyleLookup = domLookup,
): void {
  const walk = (a: Element, b: Element, parent: StyleLookup | null): void => {
    const own = computed(a);
    const style = (b as Element & { style?: CSSStyleDeclaration }).style;
    if (style !== undefined) {
      for (const [p, v] of styleDeclarations(own, parent)) style.setProperty(p, v);
    }
    const ka = a.children;
    const kb = b.children;
    const n = Math.min(ka.length, kb.length);
    for (let i = 0; i < n; i++) walk(ka[i] as Element, kb[i] as Element, own);
  };
  walk(live, clone, null);
}

function domLookup(el: Element): StyleLookup {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  /* Read eagerly: a live CSSStyleDeclaration keeps following the element. */
  const cache = new Map<string, string>();
  return (p: string): string => {
    if (!cache.has(p)) cache.set(p, cs ? cs.getPropertyValue(p).trim() : '');
    return cache.get(p) as string;
  };
}

/* ---------------- the file ---------------- */

export interface Box { x: number; y: number; w: number; h: number }

/** Parse a `viewBox` attribute; null when it is not four finite numbers. */
export function parseViewBox(raw: string | null): Box | null {
  if (raw === null) return null;
  const n = raw.trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return null;
  const [x, y, w, h] = n as [number, number, number, number];
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** The box grown by `pad` on every side. */
export const padBox = (b: Box, pad: number): Box =>
  ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });

/**
 * Elements that must not travel: HTML painted into the drawing (the action
 * bar, the rename field) is a gesture rather than a picture, and a
 * `foreignObject` is also what taints a canvas in some browsers.
 */
export const DROP_SELECTOR = 'foreignObject, .tp-actions, .tp-rename, .tp-port';

/** The serialised file as a `data:` URL -- `img-src 'self' data:` admits it. */
export const svgDataUrl = (text: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
