/**
 * Simulate's vertical budget: the drawing above the lanes is kept only where
 * it can be read, and the panel's default and ceiling leave it that much.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { App } from '@/ui/App';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import {
  clearSelection, DRAWING_AIR, DRAWING_MIN_H, drawingRoom, headBottom, inspectorOpen, mode, outcomeDrawing, splitFits,
  timelineDefaultH, timelineMaxH, TL_MIN_H, TL_RESERVE, viewport, viewportH,
} from '@/state/view';
import { applyTemplate, templates } from '@/ui/break/events';

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
  viewportH.value = 900;
  headBottom.value = 80;
  mode.value = 'break';
});
afterEach(() => {
  for (const r of mounted.splice(0)) render(null, r);
  viewportH.value = 900;
  headBottom.value = 80;
});

describe('the arithmetic', () => {
  it('reserves a readable drawing and its air, and float.css carries the same number', () => {
    expect(TL_RESERVE).toBe(DRAWING_MIN_H + DRAWING_AIR);
    expect(TL_RESERVE).toBe(328);
  });

  it('fits a laptop and refuses a short window', () => {
    /* 1440x800 with the one-band header: the smallest panel leaves 300 px. */
    expect(drawingRoom(800, 132, TL_MIN_H)).toBe(300);
    expect(splitFits(800, 132)).toBe(true);
    /* 1100x700 with a wrapped two-row header: 158 px, a stamp. */
    expect(splitFits(700, 174)).toBe(false);
    expect(splitFits(1080, 132)).toBe(true);
  });

  it('gives the panel what is left beyond the drawing, between 300 and 500', () => {
    expect(timelineDefaultH(1080, 132)).toBe(500);
    expect(timelineDefaultH(800, 132)).toBe(340);
    expect(timelineDefaultH(700, 174)).toBe(300);
    /* The default never pushes the drawing under its floor where the split fits. */
    expect(drawingRoom(800, 132, timelineDefaultH(800, 132))).toBe(DRAWING_MIN_H);
  });

  it('caps the grip where the drawing would stop being readable', () => {
    expect(timelineMaxH(800, 132)).toBe(340);
    expect(drawingRoom(800, 132, timelineMaxH(800, 132))).toBe(DRAWING_MIN_H);
    expect(timelineMaxH(500, 132)).toBe(TL_MIN_H);
  });
});

describe('the shell', () => {
  it('splits where the window is tall enough, and draws the lanes alone where it is not', async () => {
    crash();
    viewportH.value = 800;
    headBottom.value = 132;
    const root = mount();
    await tick();
    const app = root.querySelector('.app')!;
    expect(app.classList.contains('bl-drawn')).toBe(true);
    expect(root.querySelector('.app-dock.ln-dock')).not.toBeNull();
    const tog = root.querySelector<HTMLButtonElement>('.ln-bar .sb-draw')!;
    expect(tog.disabled).toBe(false);
    expect(tog.getAttribute('aria-pressed')).toBe('true');

    viewportH.value = 700;
    headBottom.value = 174;
    await tick();
    expect(app.classList.contains('bl-drawn')).toBe(false);
    expect(root.querySelector('.app-dock')).toBeNull();
    expect(root.querySelector('.ln-view')).not.toBeNull();
    /* The remembered choice is untouched; the button is grey and says why. */
    expect(outcomeDrawing.value).toBe(true);
    const grey = root.querySelector<HTMLButtonElement>('.ln-bar .sb-draw')!;
    expect(grey.disabled).toBe(true);
    expect(grey.getAttribute('aria-pressed')).toBe('false');
    expect(grey.title).toMatch(/too short/);
    expect(grey.title).toMatch(/102 px/);

    viewportH.value = 900;
    headBottom.value = 132;
    await tick();
    expect(app.classList.contains('bl-drawn')).toBe(true);
  });

  it('has no grip and no fixed-height dock in the docked Simulate below 1024', async () => {
    crash();
    viewport.value = 'compact';
    const root = mount();
    await tick();
    expect(root.querySelector('.app-dock.has-tl')).toBeNull();
    expect(root.querySelector('.dock-grip')).toBeNull();
    /* The run on one line, where the strip of chips stood. */
    expect(root.querySelector('.app-dock .dock-status.is-run .sb-ro')).not.toBeNull();
    expect(root.querySelector('.app-dock .readout .chips')).toBeNull();
    /* The timeline is there at its own height, for the dock to scroll. */
    expect(root.querySelector('.app-dock .tl .tl-plot')).not.toBeNull();
  });

  it('keeps the chips, one per line, on a phone', async () => {
    crash();
    viewport.value = 'narrow';
    const root = mount();
    await tick();
    expect(root.querySelector('.app-dock .readout .chips')).not.toBeNull();
    expect(root.querySelector('.app-dock .dock-status.is-run')).toBeNull();
  });
});
