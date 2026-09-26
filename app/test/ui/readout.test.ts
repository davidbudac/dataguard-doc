/**
 * The readout strip's two clocks.
 *
 * At the default playhead the strip read "Outcome failover · New primary open
 * 45 s" -- the whole run -- while the drawing above it held the state at
 * t = 0. Two readings, taken at two different moments, presented as one row of
 * chips. The strip now leads with the moment the drawing is at and gives the
 * run's own numbers a group of their own, so neither number can be read as the
 * other one.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import { mode, tNow } from '@/state/view';
import { applyTemplate, templates } from '@/ui/break/events';
import { Readout } from '@/ui/Readout';
import { doc } from '@/state/doc';

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(Readout, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const crash = (): void => {
  const t = templates(doc.value.topology, 0).find((x) => x.id === 'crash')!;
  applyTemplate(t);
};

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  mode.value = 'break';
  tNow.value = 0;
});

describe('the readout in Break', () => {
  it('says nothing about a playhead while the deployment has no run', async () => {
    const root = mount();
    await tick();
    expect(root.textContent).not.toContain('Drawing at');
    expect(root.querySelector('.ro-run')).toBeNull();
  });

  it('leads with the moment the drawing is frozen at, in mono', async () => {
    crash();
    tNow.value = 12.5;
    const root = mount();
    await tick();
    const first = root.querySelector('.chips > .chip');
    expect(first?.querySelector('.chip-k')?.textContent).toBe('Drawing at');
    expect(first?.querySelector('.chip-v')?.textContent).toBe('t = 12.5 s');
  });

  it('follows the playhead', async () => {
    crash();
    tNow.value = 0;
    const root = mount();
    await tick();
    expect(root.textContent).toContain('t = 0');
    tNow.value = 30;
    await tick();
    expect(root.querySelector('.chip-v')?.textContent).toBe('t = 30 s');
  });

  it('labels the run-level chips as a group', async () => {
    crash();
    const root = mount();
    await tick();
    const grp = root.querySelector('.ro-run');
    expect(grp).not.toBeNull();
    expect(grp?.getAttribute('role')).toBe('group');
    expect(grp?.getAttribute('aria-label')).toBe('Run');
    expect(grp?.querySelector('.ro-run-k')?.textContent).toBe('Run');
    expect(grp?.textContent).toContain('Outcome');
  });

  /**
   * Findings are the validator's answer about the *configuration*: derived.ts
   * keeps the run's own findings out of `issues` on purpose, so filing the
   * count under "Run" can say "Run - Findings no issues" at the very moment
   * the run raised the warning that blocked the failover.
   */
  it('leaves configuration findings to the header and validation panel', async () => {
    crash();
    const root = mount();
    await tick();
    expect(root.textContent).not.toContain('Findings');
    expect(root.querySelector('.ro-run')?.textContent).not.toContain('Findings');
  });

  /**
   * The three places that print the playhead share a formatter; they have to
   * share the horizon too. `?t=200` on an axis that ends at ~63 s used to
   * print "t = 200 s" here while the playhead badge said "t = 63.25".
   */
  it('clamps the reading to the axis the drawing actually has', async () => {
    crash();
    const root = mount();
    await tick();
    const { axisSpan, fmt } = await import('@/ui/timeline/build');
    const { topology, trace } = await import('@/state/derived');
    const span = axisSpan(trace.value!, topology.value.events);
    tNow.value = 500;
    await tick();
    const hi = root.querySelector('.chip-v')?.textContent;
    expect(hi).not.toContain('500');
    expect(hi).toBe(`t = ${fmt(span.t1)} s`);
    /* Both ends, and the low one is the pre-roll, not zero: the playhead badge
       clamps to `scale.t0` and the strip has to agree with it. */
    tNow.value = -60;
    await tick();
    expect(root.querySelector('.chip-v')?.textContent).toBe(`t = ${fmt(span.t0)} s`);
    expect(span.t0).toBeLessThan(0);
  });

  it('keeps the steady-state reading unlabelled in Build', async () => {
    crash();
    mode.value = 'build';
    const root = mount();
    await tick();
    expect(root.textContent).not.toContain('Drawing at');
    expect(root.textContent).toContain('Protection level');
  });

  it('writes no inline style', async () => {
    crash();
    const root = mount();
    await tick();
    for (const el of root.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
  });
});
