/**
 * The type glyphs of the topology: a database, a far sync instance, a snapshot
 * standby, a host, a data centre, an application and an observer. One set of
 * shapes, drawn once into a `<defs>` and referenced with
 * `<use href="#{prefix}-ico-{name}">`, so the canvas's cards and the timeline's
 * gutter show the same drawing for the same kind of thing. The shapes carry no
 * colour: the `<use>` that places one sets `stroke` from a class.
 *
 * `prefix` namespaces the ids, so two drawings can share a page (the canvas
 * uses `tp`, the timeline `tl`).
 */

import type { JSX } from 'preact';

export type GlyphName = 'db' | 'farsync' | 'snapshot' | 'host' | 'dc' | 'app' | 'observer' | 'link';

/* Each shape's stroke width and joins, and its drawing. */
const SHAPES: Record<GlyphName, { width: number; joins: boolean; body: JSX.Element }> = {
  db: { width: 1.8, joins: false, body: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3.2" />
      <path d="M4,6 V18 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2 V6" />
      <path d="M4,12 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2" />
    </>
  ) },
  farsync: { width: 1.8, joins: true, body: (
    <>
      <ellipse cx="10" cy="6" rx="7" ry="2.8" />
      <path d="M3,6 V15" />
      <path d="M17,6 V15" />
      <path d="M14,11 L19,15.5 L14,20" />
    </>
  ) },
  snapshot: { width: 1.8, joins: true, body: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3.2" />
      <path d="M4,6 V18 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2 V6" />
      <path d="M7.5,13.5 L10.8,16.8 L16.5,11" />
    </>
  ) },
  host: { width: 2, joins: true, body: (
    <>
      <rect x="3" y="3.5" width="18" height="7.5" rx="1.8" />
      <rect x="3" y="13" width="18" height="7.5" rx="1.8" />
      <path d="M7,7.25 h.01 M7,16.75 h.01" />
    </>
  ) },
  dc: { width: 2, joins: true, body: (
    <>
      <path d="M2,21 H22 M4,21 V4.5 L13,2 V21 M13,8 H20 V21" />
      <path d="M7,8 H10 M7,12 H10 M7,16 H10 M16,12 H17 M16,16 H17" />
    </>
  ) },
  app: { width: 1.8, joins: true, body: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3,9 H21" />
      <path d="M9.5,12.5 L7,14.75 L9.5,17 M14.5,12.5 L17,14.75 L14.5,17" />
    </>
  ) },
  observer: { width: 1.8, joins: true, body: (
    <>
      <path d="M2.5,12 C5.5,6.8 8.6,4.6 12,4.6 s6.5,2.2 9.5,7.4 C18.5,17.2 15.4,19.4 12,19.4 s-6.5,-2.2 -9.5,-7.4 Z" />
      <circle cx="12" cy="12" r="3.1" />
    </>
  ) },
  /* Two ends and the line between them: a network link. */
  link: { width: 1.8, joins: true, body: (
    <>
      <circle cx="5" cy="12" r="2.8" />
      <circle cx="19" cy="12" r="2.8" />
      <path d="M7.8,12 H16.2" />
    </>
  ) },
};

export function GlyphDefs({ prefix }: { prefix: string }): JSX.Element {
  return (
    <>
      {(Object.keys(SHAPES) as GlyphName[]).map((name) => {
        const { width, joins, body } = SHAPES[name];
        return (
          <g key={name} id={`${prefix}-ico-${name}`} fill="none" stroke-width={width} stroke-linecap="round"
            stroke-linejoin={joins ? 'round' : undefined}>
            {body}
          </g>
        );
      })}
    </>
  );
}

/**
 * One glyph drawn in place, for a page that has no `<defs>` to point into: an
 * HTML row, or an SVG whose own glyphs are not defined. Stroked in
 * `currentColor`, so the caller's text colour paints it.
 */
export function GlyphIcon({ name, class: cls, x, y, size = 16 }: {
  name: GlyphName; class?: string; x?: number; y?: number; size?: number;
}): JSX.Element {
  const { width, joins, body } = SHAPES[name];
  return (
    <svg class={cls} x={x} y={y} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width={width} stroke-linecap="round"
      stroke-linejoin={joins ? 'round' : undefined}>
      {body}
    </svg>
  );
}
