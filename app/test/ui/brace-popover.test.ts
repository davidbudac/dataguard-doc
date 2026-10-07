/**
 * The brace is the setting (timeline/BracePopover.tsx, break/LanesView.tsx): on
 * the Detailed timeline the settings are not a column or a row but chips on the
 * bar and the braces themselves -- a tunable brace's label is a button that
 * opens a card with the number, the inspector's sentence and, for the threshold,
 * the lag limit beside it. Each edits the document through the same setters as
 * the inspector.
 *
 * jsdom lays nothing out: where the popover sits is the browser pass.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { settingsOpen } from '@/ui/break/RunBar';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { topology } from '@/state/derived';
import { breakTimeline, mode, railCollapsed, selection, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { tunedScenario, tuneDragging } from '@/ui/timeline/run';

const memory = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, String(v)); },
  removeItem: (k: string) => { memory.delete(k); },
  clear: () => { memory.clear(); },
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
} as unknown as Storage;
Object.defineProperty(window, 'localStorage', { configurable: true, value: fakeStorage });

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

let root: HTMLElement | null = null;
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
const click = (el: Element | null): void => {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const key = (el: Element, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};
const typeInto = (el: HTMLInputElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const lanes = (r: ParentNode): Element => r.querySelector('.ln-view') as Element;
const input = (r: ParentNode, label: string): HTMLInputElement | null =>
  r.querySelector(`input[aria-label="${label}"]`);

beforeEach(() => {
  /* jsdom lacks pointer events on the elements the scrub handles; let Preact use the native names. */
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
    for (const proto of [SVGElement.prototype, HTMLElement.prototype]) {
      Object.defineProperty(proto, `on${name}`, { value: null, configurable: true });
    }
  }
  document.body.innerHTML = '';
  memory.clear();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  breakTimeline.value = 'config';
  railCollapsed.value = false;
  /* The three chips sit behind the bar's Settings chip: open it, as a reader would. */
  settingsOpen.value = true;
  selection.value = [];
  tunedScenario.value = null;
  tuneDragging.value = false;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
  tuneDragging.value = false;
});

describe('the Detailed timeline: the brace is the setting', () => {
  it('has no settings strip, toggle or knobs, and the three chips on the bar', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.tune-strip')).toBeNull();
    expect(r.querySelector('.sb-tune')).toBeNull();
    expect(lanes(r).querySelector('foreignObject')).toBeNull();
    const bar = r.querySelector('.ln-bar') as Element;
    expect(bar.querySelector('select[aria-label="Protection mode"]')).not.toBeNull();
    expect(bar.querySelector('select[aria-label="FAST_START FAILOVER"]')).not.toBeNull();
    expect(bar.querySelector('select[aria-label^="LogXptMode"]')).not.toBeNull();
  });

  it('makes a tunable brace\'s label a button that opens the setting, and Escape closes it', async () => {
    crash();
    const r = mount();
    await tick();
    const label = r.querySelector('.ln-bl') as SVGGElement | null;
    expect(label).not.toBeNull();
    expect(label!.getAttribute('role')).toBe('button');
    expect(r.querySelector('.ln-pop')).toBeNull();
    click(label);
    await tick();
    const pop = r.querySelector('.ln-pop') as HTMLElement | null;
    expect(pop).not.toBeNull();
    expect(pop!.getAttribute('role')).toBe('dialog');
    const box = input(pop!, 'FastStartFailoverThreshold');
    expect(box).not.toBeNull();
    expect(input(pop!, 'FastStartFailoverLagLimit')).not.toBeNull();
    typeInto(box!, '10');
    await tick();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(10);
    key(pop!, 'Escape');
    await tick();
    expect(r.querySelector('.ln-pop')).toBeNull();
  });

  it('opens and closes from the keyboard and the cross', async () => {
    crash();
    const r = mount();
    await tick();
    key(r.querySelector('.ln-bl') as Element, 'Enter');
    await tick();
    expect(r.querySelector('.ln-pop')).not.toBeNull();
    click(r.querySelector('.ln-pop .ln-pop-x'));
    await tick();
    expect(r.querySelector('.ln-pop')).toBeNull();
  });

  it('closes on the label\'s second press', async () => {
    crash();
    const r = mount();
    await tick();
    const label = r.querySelector('.ln-bl') as Element;
    click(label);
    await tick();
    expect(r.querySelector('.ln-pop')).not.toBeNull();
    click(label);
    await tick();
    expect(r.querySelector('.ln-pop')).toBeNull();
  });

  it('keeps the grips: a brace is still dragged, and the label is only the other way to the setting', async () => {
    crash();
    const r = mount();
    await tick();
    expect(lanes(r).querySelectorAll('[role="slider"].tl-tune').length).toBeGreaterThan(0);
  });

  it('draws no control where the view is read-only', async () => {
    crash();
    viewport.value = 'narrow';
    const r = mount();
    await tick();
    expect(r.querySelector('.ln-bl')).toBeNull();
  });
});
