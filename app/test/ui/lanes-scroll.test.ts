/**
 * The lanes scroll inside the Simulate dock.
 *
 * Simulate's lanes are a `.tl-plot` like the docked Timeline's plot, and once
 * the lanes moved into the resizable dock (`has-tl`) float.css's rule for that
 * plot -- `height:100%; overflow-y:hidden` -- reached them too: 680 px of
 * lanes in a 250 px box, no scrollbar, and nothing the wheel could do. What is
 * pinned here is the separation: no rule in the three sheets that sets a
 * hidden vertical overflow may match the lanes' plot where it stands in the
 * dock, and the box that holds it (`.ln-body`) is a scroll port.
 *
 * jsdom lays nothing out, so the stylesheets are read and their selectors
 * are matched against the real tree the shell renders.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { clearSelection, inspectorOpen, mode, outcomeDrawing, viewport } from '@/state/view';
import { applyTemplate, templates } from '@/ui/break/events';

const readCss = (rel: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

/** Every innermost `selector{declarations}` block, with its declarations squashed. */
function rules(css: string): { selector: string; decl: string }[] {
  const out: { selector: string; decl: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m !== null; m = re.exec(css)) {
    const selector = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (selector.startsWith('@')) continue;
    out.push({ selector, decl: m[2]!.replace(/\s+/g, '') });
  }
  return out;
}

/** What a declaration block says about the vertical overflow, if anything. */
function overflowY(decl: string): string | null {
  let y: string | null = null;
  for (const d of decl.split(';')) {
    const [k, v] = d.split(':');
    if (k === 'overflow' && v) y = v.trim().split(/\s+/).at(-1) ?? null;
    if (k === 'overflow-y' && v) y = v.trim();
  }
  return y;
}

/** (ids, classes/attributes/pseudo-classes, elements), the CSS cascade's own order. */
function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/::?[\w-]+(\([^)]*\))?/g, (m) => (m.startsWith('::') ? ' e ' : ' .p '));
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length;
  const elements = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g, ' ').match(/\b[a-z][\w-]*/g) ?? []).length;
  return [ids, classes, elements];
}

const matches = (el: Element, selector: string): boolean => {
  try { return el.matches(selector); } catch { return false; }
};

/**
 * The vertical overflow the sheets resolve to for `el`: the matching rules in
 * cascade order (specificity, then the sheets' order and the rules' order
 * within them), the last word winning.
 */
function cascadedOverflowY(el: Element, sheets: readonly string[]): { value: string | null; by: string | null } {
  const hits: { spec: [number, number, number]; order: number; selector: string; y: string }[] = [];
  let order = 0;
  for (const sheet of sheets) {
    for (const { selector, decl } of rules(sheet)) {
      order += 1;
      const y = overflowY(decl);
      if (y === null) continue;
      for (const one of selector.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (matches(el, one)) hits.push({ spec: specificity(one), order, selector: one, y });
      }
    }
  }
  hits.sort((a, b) => a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.spec[2] - b.spec[2] || a.order - b.order);
  const last = hits.at(-1);
  return last ? { value: last.y, by: `${last.selector} { overflow-y: ${last.y} }` } : { value: null, by: null };
}

const mounted: HTMLElement[] = [];
const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  return root;
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const crash = (): void => { applyTemplate(templates(topology.value, 0).find((t) => t.id === 'crash')!); };

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  clearSelection();
  inspectorOpen.value = false;
  outcomeDrawing.value = true;
  viewport.value = 'wide';
  mode.value = 'break';
});
afterEach(() => { for (const r of mounted.splice(0)) render(null, r); });

describe('the lanes in the Simulate dock', () => {
  /* In the order main.tsx loads them. */
  const sheets = ['shell', 'float', 'timeline-bar', 'lanes', 'timeline'].map((n) => readCss(`../../src/styles/${n}.css`));

  it('stand in a scroll port of their own, and nothing clips them vertically', async () => {
    crash();
    const root = mount();
    await tick();
    const plot = root.querySelector('.app-dock.has-tl .ln-body > .tl-plot.ln-plot');
    expect(plot, 'the lanes plot is the body\'s child inside the resizable dock').not.toBeNull();
    const body = plot!.parentElement!;
    const plotY = cascadedOverflowY(plot!, sheets);
    expect(plotY.value, `the lanes plot's vertical overflow, by ${plotY.by}`).toBe('visible');
    const bodyY = cascadedOverflowY(body, sheets);
    expect(bodyY.value, `the body's vertical overflow, by ${bodyY.by}`).toBe('auto');
  });

  it('keep the docked Timeline\'s own plot fitted, as before', () => {
    const float = readCss('../../src/styles/float.css');
    /* The rule still exists for the Timeline, scoped to the Timeline. */
    expect(float).toMatch(/\.app \.has-tl \.tl>\.tl-plot\{[^}]*overflow-y:hidden/);
    expect(float).not.toMatch(/\.app \.has-tl \.tl-plot\{/);
  });
});
