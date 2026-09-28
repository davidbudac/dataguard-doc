/**
 * Popping the timeline and the drawing out into windows of their own
 * (ui/common/popout.tsx).
 *
 * jsdom has no `window.open`, so the popup here is a second jsdom document
 * behind a stub window: enough to pin that the part is rendered there and not
 * here, that the main window keeps a note with the way back, and that closing
 * the popup -- from either side -- puts the part back.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { mode, timelineFull, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { popIn, popped } from '@/ui/common/popout';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

interface FakePopup {
  win: Window;
  doc: Document;
  hide: () => void;
}

/** A window whose document is a fresh jsdom document; `hide` plays the reader closing it. */
function fakePopup(): FakePopup {
  const doc = document.implementation.createHTMLDocument('');
  const listeners = new Map<string, (() => void)[]>();
  const win = {
    document: doc,
    closed: false,
    focus: vi.fn(),
    close: vi.fn(() => {
      if (win.closed) return;
      win.closed = true;
      for (const f of listeners.get('pagehide') ?? []) f();
    }),
    addEventListener: (type: string, f: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), f]);
    },
    removeEventListener: () => undefined,
  };
  return { win: win as unknown as Window, doc, hide: () => win.close() };
}

let root: HTMLElement | null = null;
let popup: FakePopup;

const mount = (): HTMLElement => {
  root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

const crash = (): void => {
  const t = templates(topology.value, 0).find((x) => x.id === 'crash');
  if (!t) throw new Error('no crash template');
  applyTemplate(t);
};

const popBtn = (r: ParentNode, name: RegExp): HTMLButtonElement | undefined =>
  [...r.querySelectorAll<HTMLButtonElement>('button.po-btn')]
    .find((b) => name.test(b.getAttribute('aria-label') ?? ''));

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  timelineFull.value = false;
  popup = fakePopup();
  vi.spyOn(window, 'open').mockImplementation(() => popup.win);
  vi.spyOn(window, 'focus').mockImplementation(() => undefined);
});

afterEach(() => {
  popIn('timeline');
  popIn('canvas');
  if (root) render(null, root);
  root = null;
  vi.restoreAllMocks();
});

describe('the timeline, popped out', () => {
  it('sits beside the full-screen button, and moves the timeline into the new window', async () => {
    crash();
    const r = mount();
    await tick();
    const btn = popBtn(r, /timeline/);
    expect(btn).toBeDefined();
    expect(btn?.nextElementSibling?.classList.contains('tl-full-btn')).toBe(true);

    btn?.click();
    await tick();
    expect(popped.value.timeline).toBe(popup.win);
    expect(popup.doc.querySelector('.po-tl .tl')).not.toBeNull();
    expect(r.querySelector('.tl')).toBeNull();
    expect(r.querySelector('.po-away')?.textContent).toContain('open in its own window');
    /* The panel no longer asks for its dragged height in the main window. */
    expect(r.querySelector('.app-dock.has-tl')).toBeNull();
  });

  it('carries the stylesheets and the theme across', async () => {
    const style = document.createElement('style');
    style.textContent = '.x{}';
    document.head.append(style);
    document.documentElement.setAttribute('data-theme', 'dark');
    crash();
    const r = mount();
    await tick();
    popBtn(r, /timeline/)?.click();
    await tick();
    expect(popup.doc.head.querySelector('style')?.textContent).toBe('.x{}');
    expect(popup.doc.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    await tick();
    expect(popup.doc.documentElement.getAttribute('data-theme')).toBe('light');
    style.remove();
    document.documentElement.removeAttribute('data-theme');
  });

  it('comes back when the reader closes the window', async () => {
    crash();
    const r = mount();
    await tick();
    popBtn(r, /timeline/)?.click();
    await tick();
    popup.hide();
    await tick();
    expect(popped.value.timeline).toBeUndefined();
    expect(r.querySelector('.tl')).not.toBeNull();
    expect(r.querySelector('.po-away')).toBeNull();
  });

  it('comes back from the note left behind, and the window closes', async () => {
    crash();
    const r = mount();
    await tick();
    popBtn(r, /timeline/)?.click();
    await tick();
    const back = [...r.querySelectorAll<HTMLButtonElement>('.po-away button')]
      .find((b) => b.textContent === 'Bring it back');
    back?.click();
    await tick();
    expect(popup.win.closed).toBe(true);
    expect(r.querySelector('.tl')).not.toBeNull();
    expect(popup.doc.querySelector('.tl')).toBeNull();
  });

  it('says so when the browser blocks the window', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    crash();
    const r = mount();
    await tick();
    popBtn(r, /timeline/)?.click();
    await tick();
    expect(popped.value.timeline).toBeUndefined();
    expect(r.querySelector('.toast')?.textContent).toContain('blocked');
  });
});

describe('the drawing, popped out', () => {
  it('is offered on the zoom pill and draws in the new window', async () => {
    const r = mount();
    await tick();
    const btn = popBtn(r, /drawing/);
    expect(btn?.closest('.zoom-pill')).not.toBeNull();
    btn?.click();
    await tick();
    expect(popup.doc.querySelector('.po-cv .topo-svg')).not.toBeNull();
    expect(r.querySelector('.topo-svg')).toBeNull();
    /* The popup's own zoom pill carries the way back. */
    expect(popBtn(popup.doc, /drawing/)?.getAttribute('aria-pressed')).toBe('true');
  });
});
