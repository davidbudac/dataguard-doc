/**
 * Parity with the published fragment, cell by cell.
 *
 * `simulator/fsfo-simulator.html`'s MODEL block is DOM-free and closure-free,
 * so it can be extracted by its marker comments and evaluated as a plain
 * function -- exactly the way `site/test.mjs` does it. This walks a few hundred
 * knob combinations through both the published `computeFsfo` and the general
 * engine's adapter and compares every field of every return object.
 *
 * The ported matrix in `legacy-matrix.test.ts` is the gate; this is the wider
 * net under it, and it is what catches a field the matrix never asserts.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { legacyComputeFsfo } from '../src/engine/compat/classic';

const src = readFileSync(new URL('../../simulator/fsfo-simulator.html', import.meta.url), 'utf8');
function block(name: string): string {
  const a = src.indexOf(`/* ${name}:START */`);
  const b = src.indexOf(`/* ${name}:END */`);
  return src.slice(a, b);
}
const M = new Function(block('MODEL') + '\nreturn { computeFsfo };')() as {
  computeFsfo: (c: Record<string, unknown>) => Record<string, unknown>;
};

const CDEF = { scenario: 'crash', observerLoc: 'dc3', mode: 'maxavail', threshold: 30,
  pingSet: false, pingInterval: 100, pingRetry: 10, standbyLag: 10, lagLimit: 30,
  roleTransition: 15, pmyShutdown: true, latency: 0 };

const cases: Record<string, unknown>[] = [];
for (const scenario of ['crash', 'isolated', 'partition', 'dc2down', 'observer-lost', 'switchover']) {
  for (const observerLoc of ['none', 'dc1', 'dc2', 'dc3']) {
    cases.push({ scenario, observerLoc });
    cases.push({ scenario, observerLoc, pingSet: true });
    cases.push({ scenario, observerLoc, mode: 'maxperf', standbyLag: 60, lagLimit: 30 });
    cases.push({ scenario, observerLoc, pmyShutdown: false });
    cases.push({ scenario, observerLoc, version: '26ai', mode: 'maxperf', lagType: 'transport', standbyLag: 80, lagLimit: 30, transportLag: 5 });
    cases.push({ scenario, observerLoc, version: '26ai', lagPolicy: 'bounded', standbyLag: 31, lagLimit: 30 });
    cases.push({ scenario, observerLoc, latency: 100 });
    cases.push({ scenario, observerLoc, threshold: 6, standbyLag: 0, roleTransition: 5 });
    cases.push({ scenario, observerLoc, threshold: 90, standbyLag: 45, roleTransition: 30, latency: 40 });
    cases.push({ scenario, observerLoc, version: '26ai' });
    cases.push({ scenario, observerLoc, version: '26ai', standbyLag: 80, lagLimit: 30 });
    cases.push({ scenario, observerLoc, version: '26ai', mode: 'maxperf', lagGraceTime: 10, threshold: 45 });
    cases.push({ scenario, observerLoc, version: '26ai', mode: 'maxperf', lagType: 'transport', standbyLag: 80, lagLimit: 30 });
    cases.push({ scenario, observerLoc, version: '26ai', mode: 'maxperf', lagType: 'transport', standbyLag: 10, lagLimit: 30, transportLag: 40 });
    cases.push({ scenario, observerLoc, version: '26ai', lagPolicy: 'bounded', standbyLag: 30, lagLimit: 30 });
    cases.push({ scenario, observerLoc, mode: 'maxperf', standbyLag: 30, lagLimit: 30 });
    cases.push({ scenario, observerLoc, mode: 'maxperf', standbyLag: 42, lagLimit: 30, pmyShutdown: false, latency: 100 });
    cases.push({ scenario, observerLoc, pingSet: true, pingInterval: 5000, pingRetry: 50, threshold: 120 });
    cases.push({ scenario, observerLoc, version: '19c', lagPolicy: 'bounded', lagType: 'transport', lagGraceTime: 30, transportLag: 3 });
  }
}

describe('parity with the published computeFsfo', () => {
  it('matches it field for field across every knob combination', () => {
    const bad: string[] = [];
    for (const over of cases) {
      const c = { ...CDEF, ...over };
      const want = M.computeFsfo(c) as Record<string, unknown>;
      const got = legacyComputeFsfo(c as never) as unknown as Record<string, unknown>;
      const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
      for (const k of keys) {
        const a = JSON.stringify(want[k]);
        const b = JSON.stringify(got[k]);
        if (a !== b) bad.push(`${JSON.stringify(over)} :: ${k}: want ${a} got ${b}`);
      }
    }
    expect(bad.slice(0, 40).join('\n')).toBe('');
  });
});
