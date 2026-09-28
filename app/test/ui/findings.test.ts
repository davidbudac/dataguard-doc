/**
 * The floating layout's findings: chips on the status card, the rows in a
 * popover the chips open, and one small card for the most serious finding.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { findingsOpen, findingWaved, mode, notesOpen, viewport } from '@/state/view';

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(App, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  findingsOpen.value = false;
  findingWaved.value = null;
  notesOpen.value = false;
});

describe('the floating findings', () => {
  it('floats Build and Break, and docks Configure and Learn', async () => {
    const root = mount();
    expect(root.querySelector('.app')?.classList.contains('is-float')).toBe(true);
    for (const m of ['break', 'configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(root.querySelector('.app')?.classList.contains('is-float'), m)
        .toBe(m === 'break');
    }
  });

  it('counts on the status card and opens the rows only when asked', async () => {
    const root = mount();
    expect(root.querySelector('.app-dock .fnd-chips')).not.toBeNull();
    expect(root.querySelector('.fnd-pop')).toBeNull();
    /* No always-open validation block under the drawing. */
    expect(root.querySelector('.app-dock .issues')).toBeNull();
    root.querySelector<HTMLButtonElement>('button.fnd-chip.t-am')!.click();
    await tick();
    expect(root.querySelector('.fnd-pop .issue')).not.toBeNull();
    /* The Escape listener is an effect, installed after the paint. */
    await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();
    expect(root.querySelector('.fnd-pop')).toBeNull();
  });

  it('opens the notes from the notes chip', async () => {
    const root = mount();
    root.querySelector<HTMLButtonElement>('button.fnd-chip.t-sl')!.click();
    await tick();
    expect(notesOpen.value).toBe(true);
    expect(root.querySelectorAll('.fnd-pop .issue.sv-info').length).toBeGreaterThan(0);
  });

  it('surfaces the top finding once, and lets it be waved away', async () => {
    const root = mount();
    expect(root.querySelector('.fnd-toast')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.fnd-toast button[aria-label="Dismiss this finding"]')!.click();
    await tick();
    expect(root.querySelector('.fnd-toast')).toBeNull();
  });

  it('keeps Export, Import and Reset behind the overflow, in the document', () => {
    const root = mount();
    const menu = root.querySelector('details.ovf .ovf-menu');
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll('.btn')].map((b) => b.textContent?.trim()))
      .toEqual(['Saved configurations', 'Compare alternatives', 'Export', 'Diagram as PNG', 'Report as PDF', 'Import existing setup', 'Import', 'Reset']);
  });
});
