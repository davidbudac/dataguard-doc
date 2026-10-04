/**
 * The shell renders, and it renders under the content security policy the page
 * ships with: no style attribute anywhere in the tree.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { mode, viewport } from '@/state/view';

/* Read beside this file, not from the working directory. `fileURLToPath` is
   given the string rather than a `new URL(...)`: under the jsdom environment
   `URL` is jsdom's, and Node refuses to take a path from one of those. */
const readCss = (rel: string): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

/** Signals re-render on a microtask; let it run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
});

describe('shell', () => {
  it('renders the two bars, the canvas and the dock -- and a visible folded inspector', () => {
    const root = mount();
    expect(root.querySelector('.topbar')).not.toBeNull();
    expect(root.querySelector('.statusbar')).not.toBeNull();
    expect(root.querySelector('.app-stage')).not.toBeNull();
    expect(root.querySelector('.app-dock')).not.toBeNull();
    /* Topology's inspector keeps its collapsed strip (test/ui/rail.test.ts). */
    expect(root.querySelector('.app-rail')).not.toBeNull();
    expect(root.querySelector('.rail-strip')).not.toBeNull();
    expect(root.querySelector('.app')?.classList.contains('rail-shut')).toBe(true);
  });

  it('carries no inline style, anywhere -- style-src is \'self\'', () => {
    const root = mount();
    for (const el of root.querySelectorAll('*')) {
      expect(el.getAttribute('style')).toBeNull();
    }
  });

  /* The chrome above the drawing was a top bar, a mode subtitle, a status
     bar, a guidance line and a five-row card -- ~250 px, over a 260 px stage.
     One line under the bars now carries the mode word and the guidance both. */
  it('says what the mode is for once, on one line', async () => {
    const root = mount();
    expect(root.querySelector('.topbar-sub')).toBeNull();
    /* Build has no line (its text is the mode button's title); Configure does. */
    expect(root.querySelectorAll('.guide-line').length).toBe(0);
    mode.value = 'configure';
    await tick();
    const lines = root.querySelectorAll('.guide-line');
    expect(lines.length).toBe(1);
    expect(lines[0]?.textContent?.startsWith('Config · ')).toBe(true);
  });

  it('changes what surrounds the canvas, not the canvas', async () => {
    const root = mount();
    expect(root.querySelector('.app')?.className).toContain('m-build');
    mode.value = 'configure';
    await tick();
    expect(root.querySelector('.app')?.className).toContain('m-configure');
  });

  it('does not render the rail into the grid when it does not fit', () => {
    viewport.value = 'medium';
    const root = mount();
    expect(root.querySelector('.app-rail')).toBeNull();
  });

  it('says what a viewer-width screen is missing, in words', () => {
    viewport.value = 'narrow';
    const root = mount();
    expect(root.textContent).toContain('Editing needs a wider screen');
  });

  it('puts Learn\'s workbench in the dock once the rail leaves the grid', () => {
    mode.value = 'learn';
    viewport.value = 'medium';
    const root = mount();
    expect(root.querySelector('.app-rail')).toBeNull();
    const dock = root.querySelector('.app-dock');
    expect(dock).not.toBeNull();
    /* Which is why the grid below 1280 has to name a `dock` area for Learn --
       see the stylesheet assertions below. */
    expect(dock?.querySelector('.lwh')).not.toBeNull();
  });
});

/**
 * The grid is the one part of the shell a rendered tree says nothing about,
 * and getting it wrong is silent: an element whose `grid-area` names a line
 * the template does not declare is auto-placed into an implicit track, which
 * takes the width and leaves its siblings at zero. Asserted against the
 * stylesheet, the way the print rules are.
 */
describe('the grid below 1280', () => {
  const shell = readCss('../../src/styles/shell.css');
  const narrow = /@media \(max-width:1279px\)\{\n([\s\S]*?)\n\}/.exec(shell)?.[1] ?? '';

  it('is one column, with a row for the dock -- in Learn as well', () => {
    expect(narrow).not.toBe('');
    expect(narrow).toContain('grid-template-areas:"head" "stage" "dock"');
    /* No `.app.m-learn` areas override: Learn renders the workbench into the
       dock at this width (App.tsx), so `dock` has to be a named area there. */
    expect(narrow).not.toMatch(/\.app\.m-learn\{grid-template-areas/);
  });

  it('gives Learn back the third row its wide two-row template drops', () => {
    expect(narrow)
      .toMatch(/\.app\.m-learn\{grid-template-rows:auto fit-content\(46vh\) minmax\(0,1fr\)\}/);
  });

  it('lets the Build stage take the room and caps the dock', () => {
    /* The HANDOFF SS4 leftover: a healthy preset drew at 60 % over an empty
       band. Build's stage is the flexible row; the dock sizes to content. */
    expect(shell).toMatch(/\.app\.m-build\{grid-template-rows:auto minmax\(260px,1fr\) minmax\(0,auto\)\}/);
    expect(shell).toMatch(/\.app\.m-build \.app-dock\{max-height:46vh\}/);
    /* ...and the 1279 block still resets every mode to one column. */
    expect(narrow).toContain('grid-template-areas:"head" "stage" "dock"');
  });

  it('leaves the wide Learn template two rows and two columns', () => {
    const wide = /\n\.app\.m-learn\{([\s\S]*?)\n\}/.exec(shell)?.[1] ?? '';
    expect(wide).toContain('grid-template-rows:auto minmax(0,1fr)');
    expect(wide).toContain('grid-template-columns:minmax(0,60ch) minmax(360px,1fr)');
  });
});
