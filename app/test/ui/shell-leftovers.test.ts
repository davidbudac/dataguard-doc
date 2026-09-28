/**
 * The shell's round-1 leftovers (docs/tasks/ui-followups.md 6.2): one Escape
 * undoes one thing, the floating insets are measured rather than assumed, the
 * top bar keeps its modes on one row down to 1024, and the Configure tabs and
 * Learn's lesson list are set in sentence-case sans like the rest.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App, evmenuInsets } from '@/ui/App';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { findingsOpen, mode, selection, viewport } from '@/state/view';

const css = (name: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), `../../src/styles/${name}`), 'utf8');

/* Past Preact's after-paint, where the key listeners are installed. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  findingsOpen.value = false;
  selection.value = [];
});

describe('Escape, one thing at a time', () => {
  it('closes the findings popover and keeps the selection on the drawing', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(App, {}), root);
    selection.value = ['prm01'];
    findingsOpen.value = true;
    await settle();
    expect(root.querySelector('.fnd-pop')).not.toBeNull();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(findingsOpen.value).toBe(false);
    expect(selection.value).toEqual(['prm01']);
    /* The next press is the page's: now it forgets the selection. */
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(selection.value).toEqual([]);
    render(null, root);
  });
});

describe('the drawing clears the event menu (1024-1279)', () => {
  const wrap = { left: 0, top: 0, right: 1100, bottom: 768 };
  const menu = { left: 786, top: 108, right: 1086, bottom: 240 };
  const pad = { l: 236, b: 330 };

  it('goes under the menu when the drawing is a wide row', () => {
    const at = evmenuInsets(wrap, menu, pad, { w: 1066, h: 224 });
    expect(at.t).toBe(252);
    expect(at.r).toBe(32);
  });

  it('stops left of it when the drawing is tall', () => {
    const at = evmenuInsets(wrap, menu, pad, { w: 400, h: 600 });
    expect(at.t).toBe(114);
    expect(at.r).toBe(322);
  });
});

describe('the stylesheets', () => {
  const float = css('float.css');

  it('insets the floating drawing by the measured palette, not by fixed widths', () => {
    expect(float).not.toMatch(/\b104px\b/);
    expect(float).not.toMatch(/\b236px\b/);
    expect(float).toContain('--pal-space:calc(var(--pal-r,96px) + 16px)');
    expect(float).toMatch(/\.tp-wrap\{[^}]*var\(--pal-space\)\}/);
  });

  it('wraps the modes to a second row only below 1024', () => {
    expect(float).not.toContain('@media (max-width:1100px)');
    const narrow = /@media \(max-width:1023px\)\{([\s\S]*?)\n\}/.exec(float)?.[1] ?? '';
    expect(narrow).toContain('.topbar{flex-wrap:wrap}');
    const medium = /@media \(max-width:1279px\)\{\n {2}\.topbar\{([\s\S]*?)\n\}/.exec(float)?.[0] ?? '';
    expect(medium).toContain('.topbar-modes{margin-inline:auto}');
    expect(medium).not.toContain('flex-wrap:wrap');
  });

  it('sets the Configure tabs as sans, sentence case, untracked', () => {
    const rule = /\.panel-tab\{([\s\S]*?)\}/.exec(css('panels.css'))?.[1] ?? '';
    expect(rule).toContain('font-family:var(--sans)');
    expect(rule).not.toContain('text-transform');
    expect(rule).not.toContain('var(--mono)');
    expect(rule).toContain('letter-spacing:0');
  });

  it('sets the lesson list, the step anchor and Explain the same way', () => {
    const learn = css('learn.css');
    for (const sel of ['learn-n', 'learn-steps', 'ls-anchor']) {
      const rule = new RegExp(`\\.${sel}\\{([^}]*)\\}`).exec(learn)?.[1] ?? '';
      expect(rule, sel).not.toBe('');
      expect(rule, sel).not.toContain('text-transform');
      expect(rule, sel).not.toContain('var(--mono)');
      expect(rule, sel).not.toMatch(/letter-spacing:\.\d/);
    }
    const explain = /\n\.explain\{([^}]*)\}/.exec(learn)?.[1] ?? '';
    expect(explain).toContain('font-family:var(--sans)');
    expect(explain).not.toContain('text-transform');
  });
});
