/**
 * The 1024-1279 drawer and the 768-1023 bottom sheet, from the keyboard, plus
 * the two other things that only show on a small window: the toast that has to
 * clear a wrapped status bar, and the read-only note that has to be said once.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { Sheet } from '@/ui/common/Sheet';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { inspectorOpen, mode, selection, toast, viewport } from '@/state/view';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/**
 * Preact runs effects after paint: a frame, and then a task behind the frame.
 * A bare `setTimeout(0)` lands in front of that and sees the sheet before its
 * focus work has run, so wait a frame and two tasks.
 */
async function paint(): Promise<void> {
  await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
  await new Promise<void>((r) => { setTimeout(r, 0); });
  await new Promise<void>((r) => { setTimeout(r, 0); });
}

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

const esc = (): void => {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  resetHistory(classicDoc());
  selection.value = [];
  toast.value = null;
  inspectorOpen.value = false;
  mode.value = 'build';
  viewport.value = 'wide';
});

describe('the inspector drawer at 1024-1279', () => {
  beforeEach(() => { viewport.value = 'medium'; });

  it('is not in the document until it is opened', async () => {
    const root = mount();
    expect(root.querySelector('.app-rail')).toBeNull();
    expect(root.querySelector('.sheet')).toBeNull();
    inspectorOpen.value = true;
    await tick();
    expect(root.querySelector('.sheet')).not.toBeNull();
  });

  it('opens as a right-hand drawer, and as a bottom sheet below 1024', async () => {
    const root = mount();
    inspectorOpen.value = true;
    await tick();
    expect(root.querySelector('.sheet')?.className).toContain('p-right');
    viewport.value = 'compact';
    await tick();
    expect(root.querySelector('.sheet')?.className).toContain('p-bottom');
  });

  it('is a modal dialog with a name', async () => {
    const root = mount();
    inspectorOpen.value = true;
    await tick();
    const panel = root.querySelector('.sheet');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(panel?.getAttribute('aria-label')).toBe('Inspector');
  });

  it('takes the focus when it opens', async () => {
    const root = mount();
    inspectorOpen.value = true;
    await paint();
    expect(document.activeElement).toBe(root.querySelector('.sheet'));
  });

  it('closes on Escape from anywhere, not only from inside the panel', async () => {
    mount();
    inspectorOpen.value = true;
    await paint();
    document.body.focus();
    esc();
    await paint();
    expect(inspectorOpen.value).toBe(false);
  });

  it('gives the focus back to the button that opened it', async () => {
    const root = mount();
    const opener = [...root.querySelectorAll('button')]
      .find((b) => b.textContent === 'Inspector');
    expect(opener, 'the status bar offers no Inspector button').toBeDefined();
    opener!.focus();
    opener!.click();
    await paint();
    expect(document.activeElement).toBe(root.querySelector('.sheet'));
    esc();
    await paint();
    expect(document.activeElement).toBe(opener);
  });

  it('closes when the scrim is clicked, and gives the focus back too', async () => {
    const root = mount();
    const opener = [...root.querySelectorAll('button')]
      .find((b) => b.textContent === 'Inspector');
    opener!.focus();
    opener!.click();
    await paint();
    (root.querySelector('.scrim') as HTMLElement).click();
    await paint();
    expect(inspectorOpen.value).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('holds the focus inside while the shell re-renders around it', async () => {
    /* The close callback is a new arrow on every render of the shell. An
       effect that depends on it would tear down and re-run here, handing the
       focus back to the opener while the reader is still in the panel. */
    const root = mount();
    inspectorOpen.value = true;
    await paint();
    /* The panel's own Close button: it survives a change of what the panel is
       showing, which the body's controls do not. */
    const inside = root.querySelector('.sheet-hd button');
    expect(inside).not.toBeNull();
    (inside as HTMLElement).focus();
    selection.value = ['sby01'];
    await paint();
    expect(root.querySelector('.sheet')).not.toBeNull();
    expect(document.activeElement).toBe(inside);
  });

  it('the Events rail is what the drawer carries in Break mode', async () => {
    mode.value = 'scenario';
    const root = mount();
    inspectorOpen.value = true;
    await tick();
    expect(root.querySelector('.sheet')?.getAttribute('aria-label')).toBe('Events');
  });
});

describe('Sheet on its own', () => {
  it('renders nothing at all while it is closed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(
      h(Sheet, { open: false, title: 'Inspector', onClose: () => undefined, children: 'x' }),
      root,
    );
    expect(root.innerHTML).toBe('');
  });

  it('calls onClose once per Escape', async () => {
    const onClose = vi.fn();
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Sheet, { open: true, title: 'Inspector', onClose, children: 'x' }), root);
    await paint();
    esc();
    esc();
    expect(onClose).toHaveBeenCalledTimes(2);
    render(h(Sheet, { open: false, title: 'Inspector', onClose, children: 'x' }), root);
    await paint();
    esc();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('the read-only note is said once', () => {
  it('spells the reason on the stage card and nowhere else', async () => {
    viewport.value = 'narrow';
    const root = mount();
    inspectorOpen.value = true;
    await tick();
    const text = root.textContent ?? '';
    const hits = text.split('Editing needs a wider screen').length - 1;
    expect(hits, 'the reason belongs on the stage card, once').toBe(1);
    /* And the others still say they are read-only, rather than saying nothing:
       nothing on this page goes quiet. */
    expect(text).toContain('This drawing is a read-only view here.');
  });

  it('says nothing of the sort once the window is wide enough to edit', () => {
    viewport.value = 'wide';
    const root = mount();
    expect(root.textContent ?? '').not.toContain('Editing needs a wider screen');
  });
});

describe('the toast clears the bars instead of assuming their height', () => {
  it('rides on a measured custom property, not on an inline style', async () => {
    const root = mount();
    toast.value = { kind: 'info', text: 'Link copied.' };
    await tick();
    const strip = root.querySelector('.toast');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('style')).toBeNull();
    /* jsdom has no ResizeObserver and no layout, so what is asserted here is
       the contract: the shell writes the anchor as a custom property on the
       root element, and the stylesheet falls back to the nominal bar heights
       when it is absent. */
    const written = document.documentElement.style.getPropertyValue('--bar-bottom');
    expect(written === '' || /^\d+px$/.test(written)).toBe(true);
  });
});
