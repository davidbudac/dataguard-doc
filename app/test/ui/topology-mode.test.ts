/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { hostId } from '@/engine';
import { classicDoc, doc, withEvents } from '@/state/doc';
import { topology, readout, runShown, trace } from '@/state/derived';
import { resetHistory, undo, redo, undoStack } from '@/state/history';
import { parseUrlQuery, serializeUrlQuery, URL_DEFAULTS } from '@/state/url';
import { breakTimeline, healthyRun, inspectorOpen, introPage, mode, playing, railCollapsed, selection, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { goToStep } from '@/ui/workflow';
import { applyTemplate, templates } from '@/ui/break/events';
import { allSettings } from '@/ui/break/SettingChips';

let root: HTMLDivElement;
const tick = () => new Promise<void>(r => setTimeout(r, 30));
const button = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === name)!;
const crash = () => applyTemplate(templates(topology.value).find(t => t.id === 'crash')!);
const mount = () => act(() => render(h(App, {}), root));
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const change = (label: string, value: string) => act(() => {
  const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
});
beforeEach(() => {
  root = document.createElement('div'); document.body.append(root);
  resetHistory(classicDoc()); mode.value = 'build'; viewport.value = 'wide';
  selection.value = []; inspectorOpen.value = false; railCollapsed.value = false;
  healthyRun.value = false; playing.value = false; introPage.value = false; breakTimeline.value = 'config'; tNow.value = 0;
  for (const n of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) Object.defineProperty(SVGElement.prototype, `on${n}`, { configurable: true, value: null });
});
afterEach(() => { act(() => render(null, root)); root.remove(); });

describe('three steps, one document', () => {
  it('numbers the primary navigation and keeps Generated settings and Learn separate', () => {
    mount();
    expect([...root.querySelectorAll('.workflow-step')].map(e => e.textContent)).toEqual(['1Topology', '2Scenario', '3Simulate']);
    expect(root.querySelector('[aria-current="step"]')?.textContent).toBe('1Topology');
    expect(root.querySelector('.workflow-extras')?.textContent).toBe('Generated settingsLearn');
    expect(root.textContent).toContain('Step 1 of 3');
  });
  it('moves freely between steps without changing the topology, events or undo history', () => {
    crash(); mount(); const before = doc.value; const history = undoStack.value;
    click(button('Define scenario →')); expect(mode.value).toBe('scenario');
    expect(tNow.value).toBe(0); expect(root.textContent).toContain('Step 2 of 3');
    click(button('Simulate →')); expect(mode.value).toBe('break'); expect(tNow.value).toBeGreaterThan(0);
    click(button('← Edit scenario')); click(button('← Topology'));
    expect(doc.value).toBe(before); expect(undoStack.value).toBe(history);
  });
  it('shows starting state in Topology and no event controls, even with a failure scheduled', () => {
    crash(); mount();
    expect(runShown()).toBe(false); expect(readout.value.some(c => c.id === 'outcome')).toBe(false);
    expect(root.querySelector('.dock-scn,.mtl,.scenario-editor,.tp-tools')).toBeNull();
    expect(root.querySelector('.topo-svg')).not.toBeNull();
  });
  it('writes new URLs and keeps every earlier timeline spelling', () => {
    for (const name of ['outcome', 'timeline', 'simulate', 'break']) expect(parseUrlQuery(`?mode=${name}`).state.mode).toBe('break');
    expect(parseUrlQuery('?mode=scenario').state.mode).toBe('scenario');
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'break' })).toContain('mode=simulate');
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'scenario' })).toContain('mode=scenario');
  });
  it('can inspect the no-event outcome without inventing scheduled events', () => {
    mount(); act(() => goToStep('break'));
    expect(trace.value?.facts.outcome).toBe('continues'); expect(doc.value.topology.events).toEqual([]);
    expect(root.querySelector('.ln-view')).not.toBeNull();
  });
});

describe('Scenario is the input timeline', () => {
  beforeEach(() => { mode.value = 'scenario'; });
  it('shows only scheduled events and no calculated clocks, result or settings', () => {
    crash(); mount();
    expect(root.querySelectorAll('.scenario-marker')).toHaveLength(1);
    expect(root.querySelector('.tl-brace,.tl-tune,.ln-view,.run-explain,.sc-row,.mtl')).toBeNull();
    expect(root.querySelector('.scenario-timeline')?.textContent).toContain('Crash');
    expect(runShown()).toBe(false);
  });
  it('draws the scheduled failure on the cards without the response', () => {
    crash(); mount();
    const prm = root.querySelector('.tp-node[data-node="member:prm01"], [data-node$="prm01"].tp-node');
    expect(prm, 'the primary card').not.toBeNull();
    expect(prm!.querySelector('.tp-card')?.classList.contains('is-down')).toBe(true);
    expect(prm!.querySelector('.tp-cross')).not.toBeNull();
    /* The standby stays a standby: the failover is step 3's to show. */
    const sby = root.querySelector('[data-node$="sby01"].tp-node')!;
    expect(sby.querySelector('.tp-card')?.classList.contains('is-down')).toBe(false);
    expect(root.querySelector('.ln-view,.run-explain')).toBeNull(); expect(runShown()).toBe(false);
    expect(root.querySelector('.scenario-playhead')?.textContent).toContain('drawing at 0 s');
  });
  it('isolating the primary site cuts the observer ping along with the redo', () => {
    act(() => applyTemplate(templates(topology.value).find(t => t.id === 'isolated')!)); mount();
    const cutLines = [...root.querySelectorAll('.tp-link.is-x')];
    expect(cutLines.length).toBeGreaterThanOrEqual(2);
    expect(root.textContent).toContain('pings the primary prm01, but the network between them is severed');
    expect(root.textContent).toContain('checks whether sby01 is ready to take over');
    expect(root.querySelector('[data-node$="prm01"].tp-node .tp-card')?.classList.contains('is-down')).toBe(false);
  });
  it('shows only the failures scheduled by the At time', () => {
    resetHistory(withEvents(classicDoc(), [{ kind: 'host.down', host: hostId('dc1-prm01'), at: 20 }])); mount();
    const down = () => root.querySelector('[data-node$="prm01"].tp-node .tp-card')?.classList.contains('is-down');
    expect(tNow.value).toBe(0); expect(down()).toBe(false);
    change('New event time in seconds', '20'); expect(tNow.value).toBe(20); expect(down()).toBe(true);
  });
  it('schedules a failure and recovery from a selected target, with undo and redo', () => {
    mount(); change('Event target', 'prm01'); change('Event action', 'host.down');
    click(button('Schedule event'));
    expect(doc.value.topology.events).toHaveLength(1); expect(doc.value.topology.events[0]?.at).toBe(0);
    change('New event time in seconds', '60'); change('Event action', 'host.up'); click(button('Schedule event'));
    expect(doc.value.topology.events).toHaveLength(2); expect(doc.value.topology.events[1]?.at).toBe(60);
    const last = doc.value; act(() => undo()); expect(doc.value.topology.events).toHaveLength(1);
    act(() => redo()); expect(doc.value).toEqual(last);
  });
  it('moves an event with the keyboard while keeping its related recovery after it', () => {
    resetHistory(withEvents(classicDoc(), [
      { kind: 'host.down', host: hostId('dc1-prm01'), at: 0 },
      { kind: 'host.up', host: hostId('dc1-prm01'), at: 10 },
    ])); mount();
    const marker = root.querySelector('.scenario-marker')!;
    act(() => { marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
    expect(doc.value.topology.events.map(e => e.at)).toEqual([9.9, 10]);
    expect(undoStack.value).toHaveLength(1);
    act(() => undo()); expect(doc.value.topology.events[0]?.at).toBe(0);
  });
  it('drags a marker as one edit, and cancellation changes nothing', () => {
    crash(); mount(); const original = doc.value; const count = undoStack.value.length;
    const svg = root.querySelector<SVGSVGElement>('.scenario-plot svg')!;
    svg.getBoundingClientRect = () => ({ width: 880, left: 0 } as DOMRect);
    const pointer = (el: Element, type: string, x: number) => act(() => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 }); el.dispatchEvent(e);
    });
    pointer(root.querySelector('.scenario-marker')!, 'pointerdown', 265);
    pointer(svg, 'pointermove', 375); expect(doc.value).toBe(original);
    pointer(svg, 'pointercancel', 375); expect(doc.value).toBe(original);
    pointer(root.querySelector('.scenario-marker')!, 'pointerdown', 265);
    pointer(svg, 'pointerup', 375);
    expect(doc.value.topology.events[0]?.at).toBe(12); expect(undoStack.value.length).toBe(count + 1);
  });
  it('keeps the input timeline read-only on a narrow screen', () => {
    crash(); viewport.value = 'narrow'; mount();
    expect(root.querySelector('.scenario-marker')?.getAttribute('role')).toBe('img');
    expect(root.querySelector<HTMLInputElement>('[aria-label="New event time in seconds"]')?.disabled).toBe(true);
    expect(root.querySelectorAll('.app-stage>.empty')).toHaveLength(1);
  });
});

describe('Outcome edits settings beside the response', () => {
  beforeEach(() => { crash(); mode.value = 'break'; });
  it('opens a member inspector in place and recalculates the same events', async () => {
    mount(); const events = doc.value.topology.events;
    click(root.querySelector('.ln-node[data-node="sby01"]')!); await tick();
    expect(selection.value).toEqual(['sby01']); expect(mode.value).toBe('break');
    expect(root.querySelector('.app-rail .insp')).not.toBeNull(); expect(root.querySelector('.ln-view')).not.toBeNull();
    const before = trace.value;
    act(() => {
      const lag = root.querySelector<HTMLInputElement>('input[aria-label="Apply lag"]')!;
      lag.value = '5'; lag.dispatchEvent(new Event('input', { bubbles: true }));
    }); await tick();
    expect(trace.value).not.toBe(before); expect(doc.value.topology.events).toBe(events);
    expect(root.querySelector('.outcome-change')?.textContent).toContain('Since the last edit');
    expect(root.textContent).toContain('from the beginning');
    expect(root.querySelector('.scenario-editor,.ln-ev,.tl-event-drag')).toBeNull();
  });
  it('opens global settings without leaving the outcome', () => {
    mount(); act(() => allSettings());
    expect(mode.value).toBe('break'); expect(inspectorOpen.value).toBe(true);
    expect(root.querySelector('.ln-view')).not.toBeNull();
    expect(root.querySelector('.app-rail .insp')).not.toBeNull();
  });
  it('opens item settings in the drawer at medium width', async () => {
    viewport.value = 'medium'; mount(); click(root.querySelector('.ln-node[data-node="obs01"]')!); await tick();
    expect(inspectorOpen.value).toBe(true); expect(root.querySelector('[role="dialog"] .insp')).not.toBeNull();
    expect(mode.value).toBe('break');
  });
});
