/**
 * Row or stack, against the rail that is actually on screen (ui-followups
 * 6.3): the floating 340 px card, the 360 px drawer, Configure's docked
 * column and the full-width bottom sheet each give a field a different line
 * to share with its name.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { mode, selection, viewport } from '@/state/view';
import { fitsBeside, RAIL_ROW_PX, railRow, rowFor } from '@/ui/common/Field';
import { Inspector } from '@/ui/inspector/Inspector';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let root: HTMLElement | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  selection.value = [];
  railRow.value = RAIL_ROW_PX;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
  railRow.value = RAIL_ROW_PX;
});

describe('the row a field has', () => {
  it('is the rail content less its padding, floored to 4 px, never under the card', () => {
    /* The 340 px floating card, with or without a thin scrollbar. */
    expect(rowFor(338, 16)).toBe(RAIL_ROW_PX);
    expect(rowFor(328, 16)).toBe(RAIL_ROW_PX);
    /* Configure's docked column and the 1024-1279 drawer. */
    expect(rowFor(344, 16)).toBe(300);
    expect(rowFor(359, 16)).toBe(312);
    /* The bottom sheet at 900 px. */
    expect(rowFor(898, 16)).toBe(852);
  });

  it('decides against the measured row, not a constant', () => {
    /* "Role" beside primary | physical | logical | snapshot needs ~312 px. */
    const seg = 272;
    expect(fitsBeside('Role', true, seg, 292)).toBe(false);
    expect(fitsBeside('Role', true, seg, 312)).toBe(true);
    railRow.value = 312;
    expect(fitsBeside('Role', true, seg)).toBe(true);
  });
});

describe('the inspector follows the rail it is in', () => {
  const layoutOf = (r: HTMLElement, name: string): string | undefined =>
    [...r.querySelectorAll('.field')]
      .find((f) => f.querySelector('.field-name')?.textContent === name)?.className;

  it('stacks a wide control in the card and puts it beside its name in a wider rail', async () => {
    selection.value = ['prm01'];
    root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Inspector, {}), root);
    await tick();
    expect(layoutOf(root, 'Role')).toContain('is-stack');
    railRow.value = 852;
    await tick();
    expect(layoutOf(root, 'Role')).toContain('is-row');
    expect(layoutOf(root, 'Open mode')).toContain('is-row');
  });
});
