/**
 * The timeline measures its text with `TL_FULL.fs*` and `TL_COMPACT.fs*`
 * (build.ts) and paints it with the `--fs-*` custom properties in
 * timeline.css. Two sets of numbers for one size can drift, and a label
 * fitted at 11 px and painted at 13 runs off its bar -- so this reads the
 * stylesheet and holds them together.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TL_COMPACT, TL_FULL } from '@/ui/timeline/build';
import type { Layout } from '@/ui/timeline/build';

const css = readFileSync(new URL('../../src/styles/timeline.css', `file://${process.cwd()}/test/ui/`), 'utf8');

/** The custom properties a rule with this exact selector declares. */
const block = (selector: string): Record<string, number> => {
  const out: Record<string, number> = {};
  const rules = css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g);
  for (const [, , sel, body] of rules) {
    if (sel!.trim() !== selector) continue;
    for (const m of body!.matchAll(/--(fs-[a-z-]+):\s*([\d.]+)px/g)) out[m[1]!] = Number(m[2]);
  }
  return out;
};

/** Custom property -> the layout field that measures the same text. */
const PAIRS: [string, keyof Layout][] = [
  ['fs-bar', 'fsBar'], ['fs-mark', 'fsMark'], ['fs-lane', 'fsName'], ['fs-sub', 'fsSub'],
  ['fs-tick', 'fsTick'], ['fs-top', 'fsTop'], ['fs-note', 'fsNote'], ['fs-app', 'fsApp'],
];

describe('the drawing\'s type sizes', () => {
  it('are painted at the sizes the full layout measures', () => {
    const vars = block('.tl-svg');
    for (const [name, field] of PAIRS) expect(vars[name], name).toBe(TL_FULL[field]);
  });

  it('are painted at the sizes the packed layout measures', () => {
    const vars = { ...block('.tl-svg'), ...block('.tl-svg.is-big') };
    for (const [name, field] of PAIRS) expect(vars[name], name).toBe(TL_COMPACT[field]);
  });

  it('are larger in the packed layout than they were: 13 px on the bars and sentences', () => {
    expect(TL_COMPACT.fsBar).toBeGreaterThanOrEqual(12.5);
    expect(TL_COMPACT.fsMark).toBeGreaterThanOrEqual(12.5);
    expect(TL_COMPACT.fsName).toBeGreaterThanOrEqual(13);
    expect(TL_COMPACT.iconSize).toBeGreaterThanOrEqual(16);
    expect(TL_COMPACT.laneH).toBeGreaterThanOrEqual(36);
    expect(TL_COMPACT.big).toBe(1);
    expect(TL_FULL.big).toBe(0);
  });
});
