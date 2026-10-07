/**
 * The floating layout's findings: chips on the status card, and the rows in a
 * popover the chips open. There is no card that surfaces the most serious
 * finding by itself.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { memberId } from '@/engine';
import { App } from '@/ui/App';
import { classicDoc, doc } from '@/state/doc';
import { errors, warnings } from '@/state/derived';
import { resetHistory } from '@/state/history';
import { findingsOpen, mode, notesOpen, viewport } from '@/state/view';

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

  it('has no card above the dock for the top finding, whatever is wrong', async () => {
    const root = mount();
    await tick();
    /* A warning is present, and the chips count it -- and the popover opens on
       it, which is where the finding is read. */
    expect(warnings.value.length).toBeGreaterThan(0);
    expect(root.querySelector('.fnd-toast')).toBeNull();
    expect(root.querySelector('.app-dock .fnd-chips button.fnd-chip.t-am')?.textContent).toMatch(/warning/i);
    /* An error as well: a far sync instance named as the failover target. */
    const cur = doc.value;
    resetHistory({
      ...cur,
      topology: {
        ...cur.topology,
        config: {
          ...cur.topology.config,
          fsfo: { ...cur.topology.config.fsfo, target: { kind: 'list', members: [memberId('fs01')] } },
        },
      },
    });
    await tick();
    expect(errors.value.length).toBeGreaterThan(0);
    expect(root.querySelector('.fnd-toast')).toBeNull();
    expect(root.querySelector('button.fnd-chip.t-rd')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('button.fnd-chip.t-rd')!.click();
    await tick();
    expect(root.querySelector('.fnd-pop .issue.sv-error')).not.toBeNull();
    expect(root.querySelector('.fnd-toast')).toBeNull();
  });

  it('keeps the preferences and then Export, Import and Reset behind the overflow, in the document', () => {
    const root = mount();
    const menu = root.querySelector('details.ovf .ovf-menu');
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll('.btn')].map((b) => b.textContent?.trim()))
      .toEqual(['Themesystem', 'Palettestandard', 'How this page works', 'Saved configurations', 'Compare alternatives', 'Export', 'Diagram as PNG', 'Report as PDF', 'Import existing setup', 'Import', 'Reset']);
  });
});
