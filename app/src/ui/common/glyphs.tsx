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

export type GlyphName = 'db' | 'farsync' | 'snapshot' | 'host' | 'dc' | 'app' | 'observer';

export function GlyphDefs({ prefix }: { prefix: string }): JSX.Element {
  return (
    <>
      <g id={`${prefix}-ico-db`} fill="none" stroke-width="1.8" stroke-linecap="round">
        <ellipse cx="12" cy="6" rx="8" ry="3.2" />
        <path d="M4,6 V18 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2 V6" />
        <path d="M4,12 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2" />
      </g>
      <g id={`${prefix}-ico-farsync`} fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="10" cy="6" rx="7" ry="2.8" />
        <path d="M3,6 V15" />
        <path d="M17,6 V15" />
        <path d="M14,11 L19,15.5 L14,20" />
      </g>
      <g id={`${prefix}-ico-snapshot`} fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="6" rx="8" ry="3.2" />
        <path d="M4,6 V18 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2 V6" />
        <path d="M7.5,13.5 L10.8,16.8 L16.5,11" />
      </g>
      <g id={`${prefix}-ico-host`} fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3.5" width="18" height="7.5" rx="1.8" />
        <rect x="3" y="13" width="18" height="7.5" rx="1.8" />
        <path d="M7,7.25 h.01 M7,16.75 h.01" />
      </g>
      <g id={`${prefix}-ico-dc`} fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2,21 H22 M4,21 V4.5 L13,2 V21 M13,8 H20 V21" />
        <path d="M7,8 H10 M7,12 H10 M7,16 H10 M16,12 H17 M16,16 H17" />
      </g>
      <g id={`${prefix}-ico-app`} fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4.5" width="18" height="15" rx="2" />
        <path d="M3,9 H21" />
        <path d="M9.5,12.5 L7,14.75 L9.5,17 M14.5,12.5 L17,14.75 L14.5,17" />
      </g>
      <g id={`${prefix}-ico-observer`} fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5,12 C5.5,6.8 8.6,4.6 12,4.6 s6.5,2.2 9.5,7.4 C18.5,17.2 15.4,19.4 12,19.4 s-6.5,-2.2 -9.5,-7.4 Z" />
        <circle cx="12" cy="12" r="3.1" />
      </g>
    </>
  );
}
