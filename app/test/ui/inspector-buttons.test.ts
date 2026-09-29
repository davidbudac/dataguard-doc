/**
 * The rail's own buttons (Remove, + Instance, + Rule, ...) have a box at rest.
 *
 * They used to be ghosts -- no border until the pointer was on them -- and read
 * as loose text beside the boxed fields. The rule is in `inspector.css`; this
 * pins it and the contrast of its text, from the same token file the browser
 * reads, in both schemes.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the rail buttons', () => {
  const tokens = readFileSync(new URL('../../src/styles/tokens.css', `file://${process.cwd()}/test/ui/`), 'utf8');
  const css = readFileSync(new URL('../../src/styles/inspector.css', `file://${process.cwd()}/test/ui/`), 'utf8');
  const scheme = (head: string): Record<string, string> => {
    const i = tokens.indexOf(head);
    const body = tokens.slice(tokens.indexOf('{', i) + 1, tokens.indexOf('}', i));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6});/g)) out[m[1]!] = m[2]!;
    return out;
  };
  const lum = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  it('have a box at rest: an edge and a fill, on the buttons that are plain', () => {
    expect(css).toMatch(/\.insp \.btn:not\(\.is-icon\)[^{]*\{\s*color:var\(--ik\);background:var\(--sf3\);border-color:var\(--ln2\)/);
  });

  it('read at 4.5:1 or better in both schemes', () => {
    for (const head of [':root[data-theme="light"]', ':root[data-theme="dark"]']) {
      const t = scheme(head);
      expect(ratio(t['ik']!, t['sf3']!), head).toBeGreaterThanOrEqual(4.5);
    }
  });
});
