/**
 * The shell renders, and it renders under the content security policy the page
 * ships with: no style attribute anywhere in the tree.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { mode, viewport } from '@/state/view';

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
  it('renders the two bars, the canvas and the dock', () => {
    const root = mount();
    expect(root.querySelector('.topbar')).not.toBeNull();
    expect(root.querySelector('.statusbar')).not.toBeNull();
    expect(root.querySelector('.app-stage')).not.toBeNull();
    expect(root.querySelector('.app-dock')).not.toBeNull();
    expect(root.querySelector('.app-rail')).not.toBeNull();
  });

  it('carries no inline style, anywhere -- style-src is \'self\'', () => {
    const root = mount();
    for (const el of root.querySelectorAll('*')) {
      expect(el.getAttribute('style')).toBeNull();
    }
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
});
