/**
 * Band labels stay readable in every palette: the label token over the band's
 * own fill, both read from `styles/tokens.css` (the file the browser reads), in
 * the light and dark schemes and in the standard and colour-blind palettes.
 * The pairs are what `timeline.css` paints: `.t-bar.f-*` text over `.b-*` fill.
 * WCAG AA for text is 4.5:1.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const timelineCss = readFileSync(new URL('../../src/styles/timeline.css', import.meta.url), 'utf8');

type Tokens = Record<string, string>;

/** The custom properties of the rule whose selector starts with `head`, ignoring what is inside @media. */
function rule(head: string): Tokens {
  const i = css.indexOf(head);
  if (i < 0) throw new Error(`no rule ${head}`);
  const open = css.indexOf('{', i);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const out: Tokens = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = rule(':root[data-theme="light"]');
const dark = rule(':root[data-theme="dark"]');
const palettes: Record<string, Tokens> = {
  'standard light': light,
  'standard dark': dark,
  'colour-blind light': { ...light, ...rule(':root[data-palette="cvd"],') },
  'colour-blind dark': { ...dark, ...rule(':root[data-palette="cvd"][data-theme="dark"]') },
};

const channels = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string): number => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** Band tone: label token, fill token (timeline.css: `.t-bar.f-*` over `.b-*`). */
const TONES: Array<[string, string, string]> = [
  ['green (open)', 'tl-ink', 'tlf'],
  ['blue (applying)', 'bl-ink', 'blf'],
  ['amber (waiting)', 'am-ink', 'amf'],
  ['red (down, hatched)', 'rd-ink', 'rdf'],
  ['grey (monitoring)', 'ik2', 'sf3'],
  ['violet (observer)', 'vi-ink', 'vif'],
];

describe('band labels over their fills', () => {
  for (const [palette, t] of Object.entries(palettes)) {
    for (const [tone, fg, bg] of TONES) {
      it(`${palette}: ${tone} is at least 4.5:1`, () => {
        expect(t[fg], fg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(t[bg], bg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('the hatch label sits on a ground of its own fill, so the lines never cross it', () => {
    expect(timelineCss).toMatch(/\.t-bar\.f-rd\s*{[^}]*stroke:\s*var\(--rdf\)/);
    expect(timelineCss).toMatch(/\.t-bar\.f-rd\s*{[^}]*paint-order:\s*stroke/);
  });

  it('every label class in timeline.css reads its -ink token', () => {
    for (const k of ['tl', 'bl', 'am', 'vi', 'rd']) {
      expect(timelineCss).toContain(`.tl-svg .t-bar.f-${k}`);
      expect(timelineCss).toMatch(new RegExp(`\\.t-bar\\.f-${k}\\s*{[^}]*fill:\\s*var\\(--${k}-ink\\)`));
    }
  });

  it('the strokes keep the plain hue: the ink is for text, not for the band edge', () => {
    expect(light['am']).toBe('#D97706');
    expect(light['am-ink']).not.toBe(light['am']);
    expect(dark['am-ink']).toBe(dark['am']);
  });
});
