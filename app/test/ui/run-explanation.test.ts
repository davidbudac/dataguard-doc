/** @vitest-environment jsdom */

import { afterEach, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { classicTopology, hostId, memberId, simulate } from '../../src/engine';
import { RunExplanation, explanationOpen } from '../../src/ui/break/RunExplanation';
import { openSections, resetSections } from '../../src/ui/inspector/sections';
import { inspectorOpen, mode, panelTab, playing, selection, tNow, viewport } from '../../src/state/view';

const root = document.createElement('div');
document.body.append(root);

afterEach(() => {
  act(() => render(null, root));
  explanationOpen.value = false;
  tNow.value = 0;
  playing.value = false;
  selection.value = [];
  mode.value = 'break';
  viewport.value = 'wide';
  inspectorOpen.value = false;
  resetSections();
});

it('reveals recorded steps, seeks to their time, and highlights affected members', () => {
  const doc = { ...classicTopology(), events: [{ at: 0, kind: 'host.down' as const, host: hostId('dc1-prm01') }] };
  const trace = simulate(doc);
  act(() => render(h(RunExplanation, { doc, trace }), root));
  const toggle = root.querySelector<HTMLButtonElement>('.run-explain-toggle')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const open = [...root.querySelectorAll<HTMLButtonElement>('.run-explain-seek')]
    .find((button) => button.textContent?.includes('New primary open'))!;
  playing.value = true;
  act(() => open.click());
  expect(tNow.value).toBe(trace.facts.tOpen);
  expect(playing.value).toBe(false);
  expect(selection.value).toEqual([memberId('sby01')]);
  expect(root.querySelector('.run-explain-source a')).not.toBeNull();
});

it('opens the failover settings from a blocked readiness check and navigates to related views', () => {
  const doc = { ...classicTopology({ logXptMode: 'async' }),
    events: [{ at: 0, kind: 'host.down' as const, host: hostId('dc1-prm01') }] };
  const trace = simulate(doc);
  explanationOpen.value = true;
  mode.value = 'break';
  viewport.value = 'medium';
  act(() => render(h(RunExplanation, { doc, trace }), root));
  expect(root.textContent).toContain('Fast-start failover is forbidden');
  const settings = root.querySelector<HTMLButtonElement>('.run-explain-settings')!;
  act(() => settings.click());
  expect(mode.value).toBe('build');
  expect(selection.value).toEqual([]);
  expect(openSections.value.has('Fast-start failover')).toBe(true);
  expect(inspectorOpen.value).toBe(true);
  const related = [...root.querySelectorAll<HTMLButtonElement>('.run-explain-related button')]
    .find((button) => button.textContent?.includes('Transport retries'))!;
  act(() => related.click());
  expect(mode.value).toBe('configure');
  expect(panelTab.value).toBe('reopen');
});
