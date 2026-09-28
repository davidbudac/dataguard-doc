/**
 * The diagram export's style inlining: which computed properties travel onto
 * the clone, and which must not (ui/export/svg-style.ts).
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import {
  DROP_SELECTOR, INHERITED_PROPS, inlineComputedStyles, padBox, parseViewBox,
  styleDeclarations, svgDataUrl,
} from '@/ui/export/svg-style';
import type { StyleLookup } from '@/ui/export/svg-style';
import { exportFileName, exportStem, makeDoc, classicDoc, withMeta } from '@/state/doc';

const lookup = (o: Record<string, string>): StyleLookup => (p) => o[p] ?? '';

describe('styleDeclarations', () => {
  it('gives the root every inherited property it has, since nothing is above it', () => {
    const d = styleDeclarations(lookup({ fill: 'rgb(0, 0, 0)', 'font-size': '12px' }), null);
    expect(d).toEqual([['fill', 'rgb(0, 0, 0)'], ['font-size', '12px']]);
  });

  it('writes an inherited property only where it differs from the parent', () => {
    const parent = lookup({ fill: 'rgb(0, 0, 0)', stroke: 'none', 'font-size': '12px' });
    const own = lookup({ fill: 'rgb(14, 124, 107)', stroke: 'none', 'font-size': '12px' });
    expect(styleDeclarations(own, parent)).toEqual([['fill', 'rgb(14, 124, 107)']]);
  });

  it('leaves an icon in <defs> free to inherit its stroke from the <use>', () => {
    /* The regression this rule exists for: `stroke: none` copied onto the
       icon's <g> would beat the stroke the <use> hands down. */
    const svgRoot = lookup({ stroke: 'none', fill: 'rgb(0, 0, 0)' });
    const iconG = lookup({ stroke: 'none', fill: 'none', 'stroke-width': '1.8px' });
    const d = styleDeclarations(iconG, svgRoot);
    expect(d.map(([p]) => p)).not.toContain('stroke');
    expect(d).toContainEqual(['fill', 'none']);
  });

  it('writes a non-inherited property only when it is not its initial value', () => {
    const parent = lookup({});
    expect(styleDeclarations(lookup({ opacity: '1', filter: 'none' }), parent)).toEqual([]);
    expect(styleDeclarations(lookup({ opacity: '0.4' }), parent)).toEqual([['opacity', '0.4']]);
  });

  it('keeps display only when it hides', () => {
    const parent = lookup({});
    expect(styleDeclarations(lookup({ display: 'block' }), parent)).toEqual([]);
    expect(styleDeclarations(lookup({ display: 'none' }), parent)).toEqual([['display', 'none']]);
  });

  it('covers what the drawing actually styles', () => {
    for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family',
      'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'text-transform']) {
      expect(INHERITED_PROPS).toContain(p);
    }
  });
});

describe('inlineComputedStyles', () => {
  it('walks the live tree and its clone in step, writing through the CSSOM', () => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const g = document.createElementNS(NS, 'g');
    const rect = document.createElementNS(NS, 'rect');
    g.appendChild(rect);
    svg.appendChild(g);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const styles = new Map<Element, Record<string, string>>([
      [svg, { fill: 'rgb(0, 0, 0)' }],
      [g, { fill: 'rgb(0, 0, 0)' }],
      [rect, { fill: 'rgb(214, 69, 69)', opacity: '0.5' }],
    ]);
    inlineComputedStyles(svg, clone, (el) => lookup(styles.get(el) ?? {}));
    const r = clone.querySelector('rect') as SVGRectElement;
    expect(r.style.getPropertyValue('fill')).toBe('rgb(214, 69, 69)');
    expect(r.style.getPropertyValue('opacity')).toBe('0.5');
    expect((clone.querySelector('g') as SVGGElement).getAttribute('style')).toBeNull();
    expect(clone.style.getPropertyValue('fill')).toBe('rgb(0, 0, 0)');
    /* The live tree is untouched. */
    expect(rect.getAttribute('style')).toBeNull();
  });

  it('drops the HTML that rides in the drawing', () => {
    expect(DROP_SELECTOR).toContain('foreignObject');
    expect(DROP_SELECTOR).toContain('.tp-actions');
  });
});

describe('the file around it', () => {
  it('parses and pads a viewBox', () => {
    expect(parseViewBox('0 -10 200 100')).toEqual({ x: 0, y: -10, w: 200, h: 100 });
    expect(parseViewBox('0,0,10,nope')).toBeNull();
    expect(parseViewBox('0 0 0 10')).toBeNull();
    expect(parseViewBox(null)).toBeNull();
    expect(padBox({ x: 0, y: 0, w: 10, h: 20 }, 5)).toEqual({ x: -5, y: -5, w: 20, h: 30 });
  });

  it('encodes the SVG as a data: URL, the one image scheme the policy admits', () => {
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><text>#1 & 2</text></svg>');
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(url).not.toContain('#');
    expect(decodeURIComponent(url.split(',')[1] as string)).toContain('#1 & 2');
  });

  it('names the picture after the configuration, like the JSON export', () => {
    const d = withMeta(makeDoc(classicDoc().topology), { name: 'Prod / DC1 + DC2' });
    expect(exportStem(d)).toBe('Prod-DC1-DC2');
    expect(exportFileName(d)).toBe('Prod-DC1-DC2.dgtopo.json');
    expect(exportStem(withMeta(d, { name: '  ' }))).toBe('topology');
  });
});
