/**
 * Tuning a run from the Detailed timeline itself: the mapping from a clock on the timeline
 * to the setting that is that clock (`tune.ts`), the axis held while a setting
 * is tuned (`run.ts`), the three chips on the bar (`break/SettingChips.tsx`) and the
 * number a brace's popover edits (`timeline/BracePopover.tsx`).
 *
 * jsdom lays nothing out: how the chips and the popover sit is the browser pass.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  applicationClient, applicationsOf, BOUNDS, hostId, simulate, sortEvents,
} from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { classic } from '@/presets';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory, undo, undoLabel, undoStack } from '@/state/history';
import { topology, trace } from '@/state/derived';
import {
  appLanesShown, breakTimeline, mode, railCollapsed, selection, viewport,
} from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { SettingChips } from '@/ui/break/SettingChips';
import { CLIENT_TIMING_FIELDS, editClientTiming } from '@/ui/inspector/client-timing';
import { patchFsfo, setOwnClient, setRoleTransition } from '@/ui/inspector/edits';
import { WHY } from '@/ui/inspector/why';
import { isSectionOpen, resetSections } from '@/ui/inspector/sections';
import { buildTimeline } from '@/ui/timeline/build';
import { markTuned, tunedScenario, tuneDragging, useRunTimeline } from '@/ui/timeline/run';
import type { RunTimeline } from '@/ui/timeline/run';
import { applyTune, tuneForBrace, tuned, tunedStandby } from '@/ui/timeline/tune';

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

/* ---------------- fixtures ---------------- */

const crashAt = (at: number): TimedEvent => ({ at, kind: 'host.down', host: hostId('dc1-prm01') });
const scenario = (id: string, base: TopologyDoc = classic.doc(), at = 0): TopologyDoc => {
  const t = templates(base, at).find((x) => x.id === id);
  if (!t) throw new Error(`no ${id} template`);
  return { ...base, events: sortEvents(t.events) };
};
/** The classic deployment with a standby that holds redo it has not applied, so recovery is a clock. */
const lagged = (seconds: number): TopologyDoc => {
  const d = classic.doc();
  return { ...d, members: d.members.map((m) => (m.id === 'sby01' && m.kind === 'database' ? { ...m, applyLagSeconds: seconds } : m)) };
};
const modelOf = (d: TopologyDoc) => {
  const tr = simulate(d, d.events);
  return { tr, model: buildTimeline(tr, d, { width: 900 }) };
};
const brace = (d: TopologyDoc, key: string) => {
  const { tr, model } = modelOf(d);
  const b = model.braces.find((x) => x.key === key);
  if (!b) throw new Error(`no ${key} brace`);
  return { tr, b };
};

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

const typeInto = (el: HTMLInputElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = (el: HTMLSelectElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const chips = (r: ParentNode): HTMLElement | null => r.querySelector('.ln-bar .sc-row');
const sel = (r: ParentNode, label: string): HTMLSelectElement =>
  r.querySelector(`.ln-bar select[aria-label="${label}"]`) as HTMLSelectElement;
const click = (el: Element | null): void => {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
/** The label of the brace that is the setting `name` (its aria-label starts with the brace's name), as a button. */
const braceLabel = (r: ParentNode, name: string): Element | undefined =>
  [...r.querySelectorAll('.ln-bl')].find((g) => g.getAttribute('aria-label')?.startsWith(name));
/** Open that brace's popover and hand back its number box. */
const openBox = async (r: ParentNode, name: string, field: string): Promise<HTMLInputElement> => {
  const label = braceLabel(r, name);
  if (!label) throw new Error(`no ${name} brace`);
  click(label);
  await tick();
  const box = r.querySelector<HTMLInputElement>(`.ln-pop input[aria-label="${field}"]`);
  if (!box) throw new Error(`no ${field} box`);
  return box;
};

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
  resetSections();
  viewport.value = 'wide';
  mode.value = 'break';
  breakTimeline.value = 'config';
  railCollapsed.value = false;
  selection.value = [];
  tunedScenario.value = null;
  tuneDragging.value = false;
  appLanesShown.value = true;
});

afterEach(() => {
  if (root) render(null, root);
  root = null;
  tuneDragging.value = false;
});

/* ---------------- the mapping ---------------- */

describe('tuneForBrace', () => {
  it('maps the threshold brace to FastStartFailoverThreshold and the role brace to the role transition', () => {
    const d = scenario('crash');
    const { tr, b } = brace(d, 'threshold');
    expect(tuneForBrace(d, tr, b)).toEqual({
      id: 'threshold', bound: 'thresholdSeconds', value: 30, name: 'FastStartFailoverThreshold', mono: true,
    });
    const role = brace(d, 'role');
    expect(tuneForBrace(d, role.tr, role.b)).toEqual({
      id: 'roleTransition', bound: 'roleTransitionSeconds', value: 15, name: 'Role transition', mono: false,
    });
  });

  it('maps the terminal recovery and catch-up braces to the promoted standby\'s apply lag', () => {
    const rec = brace(scenario('crash', lagged(10)), 'recovery');
    expect(tuneForBrace(scenario('crash', lagged(10)), rec.tr, rec.b))
      .toMatchObject({ id: 'applyLag', bound: 'applyLagSeconds', value: 10, member: 'sby01', name: 'Apply lag', mono: false });
    const cu = brace(scenario('switchover', lagged(10)), 'sw-catchup');
    expect(tuneForBrace(scenario('switchover', lagged(10)), cu.tr, cu.b)?.id).toBe('applyLag');
  });

  it('maps the switchover role brace and the isolated primary\'s stall clock', () => {
    const sw = scenario('switchover');
    const r = brace(sw, 'sw-role');
    expect(tuneForBrace(sw, r.tr, r.b)?.id).toBe('roleTransition');
    const iso = scenario('isolated');
    const a = brace(iso, 'abort');
    expect(tuneForBrace(iso, a.tr, a.b)?.id).toBe('threshold');
  });

  it('is null where the brace\'s span is not the setting\'s value', () => {
    const d = scenario('crash');
    const { tr, b } = brace(d, 'threshold');
    expect(tuneForBrace(d, tr, { ...b, b: b.b - 4 })).toBeNull();
    expect(tuneForBrace(d, tr, { ...b, b: b.b + 0.04 })).not.toBeNull();
    expect(tuneForBrace(d, tr, { ...b, b: b.b + 0.2 })).toBeNull();
  });

  it('is null for a brace that is not one setting, and for an unknown key', () => {
    const sw = scenario('switchover');
    const v = brace(sw, 'sw-verify');
    expect(tuneForBrace(sw, v.tr, v.b)).toBeNull();
    const cv = brace(sw, 'sw-convert');
    expect(tuneForBrace(sw, cv.tr, cv.b)).toBeNull();
    const { tr, b } = brace(scenario('crash'), 'threshold');
    expect(tuneForBrace(scenario('crash'), tr, { ...b, key: 'nonsense' })).toBeNull();
    expect(tuneForBrace(scenario('crash'), tr, { ...b, key: 'detect' })).toBeNull();
  });

  it('is null for the apply lag when the run promoted nobody', () => {
    const d = scenario('crash', lagged(10));
    const { tr, b } = brace(d, 'recovery');
    expect(tuneForBrace(d, { ...tr, facts: { ...tr.facts, newPrimary: null } }, b)).toBeNull();
  });
});

describe('tunedStandby', () => {
  it('is the promoted standby, else the first target, else the first standby', () => {
    const d = scenario('crash');
    expect(tunedStandby(d, simulate(d, d.events))?.id).toBe('sby01');
    expect(tunedStandby(classic.doc(), null)?.id).toBe('sby01');
    const anyTarget: TopologyDoc = {
      ...classic.doc(), config: { ...classic.doc().config, fsfo: { ...classic.doc().config.fsfo, target: { kind: 'ANY' } } },
    };
    expect(tunedStandby(anyTarget, null)?.id).toBe('sby01');
    expect(tunedStandby({ ...classic.doc(), members: classic.doc().members.filter((m) => m.id === 'prm01') }, null)).toBeNull();
  });
});

/* ---------------- applyTune ---------------- */

describe('applyTune', () => {
  const threshold = () => {
    const d = topology.value;
    const { tr, b } = brace(d, 'threshold');
    return tuneForBrace(d, tr, b)!;
  };
  beforeEach(() => resetHistory(makeDoc(scenario('crash'))));

  it('edits the document with the label the inspector writes, and undo restores it', () => {
    applyTune(threshold(), 25);
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(25);
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 25 s');
    expect(undoStack.value).toHaveLength(1);
    undo();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(30);
  });

  it('clamps to the bound', () => {
    applyTune(threshold(), 500);
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(BOUNDS.thresholdSeconds.max);
    applyTune(threshold(), 2);
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(BOUNDS.thresholdSeconds.min);
  });

  it('folds a burst with one coalesce key into one undo entry', () => {
    const t = threshold();
    for (const v of [28, 27, 26, 25]) applyTune(t, v);
    expect(undoStack.value).toHaveLength(1);
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 25 s');
    undo();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(30);
  });

  it('sets the role transition and the apply lag, the latter keeping the transport lag at or under it', () => {
    resetHistory(makeDoc(scenario('crash', lagged(10))));
    const d = topology.value;
    const role = brace(d, 'role');
    applyTune(tuneForBrace(d, role.tr, role.b)!, 20);
    expect(topology.value.environment.roleTransitionSeconds).toBe(20);
    expect(undoLabel.value).toBe('Set the role transition to 20 s');
    const rec = brace(topology.value, 'recovery');
    applyTune(tuneForBrace(topology.value, rec.tr, rec.b)!, 1);
    const sby = topology.value.members.find((m) => m.id === 'sby01');
    expect(sby?.kind === 'database' && sby.applyLagSeconds).toBe(1);
    expect(sby?.kind === 'database' && sby.transportLagSeconds).toBeLessThanOrEqual(1);
    expect(undoLabel.value).toBe('Set the apply lag on sby01');
  });

  it('marks the document it produced as tuned', () => {
    applyTune(threshold(), 25);
    expect(tunedScenario.value).toBe(JSON.stringify(topology.value));
  });
});

/* ---------------- the held axis ---------------- */

describe('the axis while a setting is tuned', () => {
  let last: RunTimeline | null = null;
  const Live = () => {
    const d = topology.value;
    /* Without the application's lanes the axis follows the failover, which is what tuning moves. */
    last = useRunTimeline({ trace: simulate(d, d.events), doc: d, width: 900, appView: false });
    return null;
  };
  const run = (): RunTimeline => last!;
  const threshold = () => {
    const d = topology.value;
    const b = run().model.braces.find((x) => x.key === 'threshold')!;
    return tuneForBrace(d, simulate(d, d.events), b)!;
  };
  beforeEach(() => {
    last = null;
    resetHistory(makeDoc(scenario('crash')));
    root = document.createElement('div');
    document.body.appendChild(root);
    act(() => render(h(Live, {}), root!));
  });

  it('keeps the axis where it was while the tuned run still fits it', () => {
    const t1 = run().model.scale.t1;
    const before = (() => { const x = run().model.braces.find((y) => y.key === 'threshold')!; return x.x1 - x.x0; })();
    expect(run().held).toBe(false);
    act(() => applyTune(threshold(), 25));
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(25);
    expect(run().model.scale.t1).toBe(t1);
    expect(run().held).toBe(true);
    /* The bar really is shorter: the same axis, a different brace. */
    const b = run().model.braces.find((x) => x.key === 'threshold')!;
    expect(b.x1 - b.x0).toBeCloseTo(before * (25 / 30), 0);
    act(() => applyTune(threshold(), 20));
    expect(run().model.scale.t1).toBe(t1);
  });

  it('refits when the run no longer fits, and holds the new axis from there', () => {
    const t1 = run().model.scale.t1;
    act(() => applyTune(threshold(), 90));
    expect(run().model.scale.t1).toBeGreaterThan(t1);
    expect(run().held).toBe(false);
    const wide = run().model.scale.t1;
    act(() => applyTune(threshold(), 60));
    expect(run().model.scale.t1).toBe(wide);
    expect(run().held).toBe(true);
  });

  it('holds whatever the run does while a value is being dragged', () => {
    const t1 = run().model.scale.t1;
    act(() => { tuneDragging.value = true; });
    act(() => applyTune(threshold(), 90));
    expect(run().model.scale.t1).toBe(t1);
    expect(run().held).toBe(true);
    /* Let go: the run does not fit, so the axis fits it. */
    act(() => { tuneDragging.value = false; });
    expect(run().model.scale.t1).toBeGreaterThan(t1);
    expect(run().held).toBe(false);
  });

  it('is let go by fit()', () => {
    const auto = run().model.scale.t1;
    act(() => applyTune(threshold(), 25));
    expect(run().held).toBe(true);
    act(() => run().fit());
    expect(run().held).toBe(false);
    expect(tunedScenario.value).toBeNull();
    expect(run().model.scale.t1).toBeLessThan(auto);
  });

  it('refits after an ordinary edit, an undo, and a different scenario', () => {
    const auto = run().model.scale.t1;
    act(() => applyTune(threshold(), 25));
    expect(run().held).toBe(true);
    /* An edit made anywhere else is another document. */
    act(() => setRoleTransition(30));
    expect(run().held).toBe(false);
    expect(run().model.scale.t1).toBeGreaterThan(auto * 0.5);
    act(() => applyTune(threshold(), 20));
    expect(run().held).toBe(true);
    act(() => undo());
    expect(run().held).toBe(false);
    act(() => applyTune(threshold(), 20));
    act(() => resetHistory(makeDoc(scenario('crash', classic.doc(), 40))));
    expect(run().held).toBe(false);
  });

  it('never holds the export scale, and marks nothing unless asked', () => {
    expect(tunedScenario.value).toBeNull();
    act(() => { patchFsfo('x', (f) => ({ ...f, thresholdSeconds: 25 })); });
    expect(run().held).toBe(false);
    act(() => markTuned());
    expect(tunedScenario.value).toBe(JSON.stringify(topology.value));
  });
});

/* ---------------- the Detailed timeline, end to end ---------------- */

describe('tuning from the Detailed timeline', () => {
  it('typing in a brace\'s popover changes the setting and keeps the axis until Fit lets go of it', async () => {
    crash();
    const r = mount();
    await tick();
    /* Without the application's lanes the axis follows the failover, which is what tuning moves. */
    appLanesShown.value = false;
    await tick();
    const axis = (): string => [...r.querySelectorAll('.tl-svg .t-tick')].map((t) => t.textContent).join(',');
    const before = axis();
    typeInto(await openBox(r, 'FastStartFailoverThreshold', 'FastStartFailoverThreshold'), '25');
    await tick();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(25);
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 25 s');
    /* The axis stayed where it was, so the bar is seen to shrink; the bar's Fit lets go of it. */
    expect(axis()).toBe(before);
    const fit = r.querySelector<HTMLButtonElement>('.sb-fit');
    expect(fit).not.toBeNull();
    fit!.click();
    await tick();
    expect(axis()).not.toBe(before);
    expect(r.querySelector('.sb-fit')).toBeNull();
  });

  it('carries the threshold\'s box in its popover, with the bound the inspector has', async () => {
    crash();
    const r = mount();
    await tick();
    const box = await openBox(r, 'FastStartFailoverThreshold', 'FastStartFailoverThreshold');
    expect(box.value).toBe('30');
    expect(box).toMatchObject({ min: '6', max: '120', step: '1' });
    typeInto(box, '25');
    await tick();
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 25 s');
    expect(r.querySelector<HTMLInputElement>('.ln-pop input[aria-label="FastStartFailoverThreshold"]')!.value).toBe('25');
  });

  it('edits the role transition from its brace, through the inspector\'s setter', async () => {
    crash();
    const r = mount();
    await tick();
    typeInto(await openBox(r, 'Role change', 'Role transition'), '20');
    await tick();
    expect(topology.value.environment.roleTransitionSeconds).toBe(20);
    expect(undoLabel.value).toBe('Set the role transition to 20 s');
  });

  it('greys the lag limit in the threshold\'s popover under 19c with maximum availability, and says why', async () => {
    crash();
    const r = mount();
    await tick();
    expect(topology.value.config.edition).toBe('19c');
    expect(topology.value.config.protectionMode).toBe('MAXAVAILABILITY');
    await openBox(r, 'FastStartFailoverThreshold', 'FastStartFailoverThreshold');
    const limit = () => r.querySelector<HTMLInputElement>('.ln-pop input[aria-label="FastStartFailoverLagLimit"]')!;
    expect(limit().disabled).toBe(true);
    expect(r.querySelector('.ln-pop .ln-pop-f2 .why')?.textContent).toBe(WHY.lagLimitMaxAvail19c);
    choose(sel(r, 'Protection mode'), 'MAXPERFORMANCE');
    await tick();
    expect(limit().disabled).toBe(false);
    typeInto(limit(), '20');
    await tick();
    expect(topology.value.config.fsfo).toMatchObject({ lagLimitSeconds: 20, lagLimitSet: true });
    expect(undoLabel.value).toBe('Set FastStartFailoverLagLimit to 20 s');
  });

  it('has no chip and no button brace in a read-only view', async () => {
    crash();
    const r = mount();
    await tick();
    expect(chips(r)).not.toBeNull();
    expect(braceLabel(r, 'FastStartFailoverThreshold')).toBeDefined();
    viewport.value = 'narrow';
    await tick();
    expect(chips(r)).toBeNull();
    expect(r.querySelector('.ln-bl')).toBeNull();
  });
});

/* ---------------- the chips ---------------- */

describe('the setting chips', () => {
  it('are the three choices, named as the inspector names them, with the inspector\'s sentence as the tooltip', async () => {
    crash();
    const r = mount();
    await tick();
    const names = [...chips(r)!.querySelectorAll('.sc-k')].map((k) => k.textContent);
    expect(names).toEqual(['Protection mode', 'FAST_START FAILOVER', 'LogXptMode']);
    expect(chips(r)!.querySelector('.sc-k.mono')!.textContent).toBe('FAST_START FAILOVER');
    expect(chips(r)!.querySelectorAll('.sc-k:not(.mono)')).toHaveLength(1);
    for (const c of chips(r)!.querySelectorAll('.sc')) expect(c.getAttribute('title')!.length).toBeGreaterThan(40);
    expect(sel(r, 'LogXptMode · sby01')).not.toBeNull();
    expect(chips(r)!.querySelector('.sc-all')!.textContent).toBe('All settings →');
  });

  it('edit the selects through the inspector\'s setters', async () => {
    crash();
    const r = mount();
    await tick();
    choose(sel(r, 'FAST_START FAILOVER'), 'observe-only');
    await tick();
    expect(topology.value.config.fsfo.state).toBe('observe-only');
    expect(undoLabel.value).toBe('Set fast-start failover to observe-only');
    choose(sel(r, 'Protection mode'), 'MAXPERFORMANCE');
    await tick();
    expect(topology.value.config.protectionMode).toBe('MAXPERFORMANCE');
    expect(undoLabel.value).toBe('Set the protection mode to MAXPERFORMANCE');
    choose(sel(r, 'LogXptMode · sby01'), 'ASYNC');
    await tick();
    expect(topology.value.members.find((m) => m.id === 'sby01')?.logXptMode).toBe('ASYNC');
    expect(undoLabel.value).toBe('Set LogXptMode to ASYNC on sby01');
  });

  it('refuse FASTSYNC outside maximum availability, with the same reason as the inspector in the chip\'s title', async () => {
    crash();
    const r = mount();
    await tick();
    choose(sel(r, 'Protection mode'), 'MAXPERFORMANCE');
    await tick();
    const fast = [...sel(r, 'LogXptMode · sby01').options].find((o) => o.value === 'FASTSYNC')!;
    expect(fast.disabled).toBe(true);
    expect(sel(r, 'LogXptMode · sby01').closest('.sc')!.getAttribute('title')).toContain('FASTSYNC is maximum availability only (12.1+).');
  });

  it('are on the Detailed timeline\'s bar and Topology\'s dock, and nowhere in Configure or Learn', async () => {
    crash();
    const r = mount();
    await tick();
    expect(chips(r)).not.toBeNull();
    mode.value = 'build';
    await tick();
    expect(r.querySelector('.ln-view')).toBeNull();
    expect(r.querySelector('.dock-break .sc-row')).not.toBeNull();
    for (const m of ['configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(r.querySelector('.sc-row')).toBeNull();
    }
  });

  it('are not on the bar while the Application timeline is', async () => {
    crash();
    const r = mount();
    await tick();
    breakTimeline.value = 'app';
    await tick();
    expect(chips(r)).toBeNull();
    expect(r.querySelector('.app-tl-strip')).not.toBeNull();
  });

  it('open Topology on the fast-start failover section, with nothing selected', async () => {
    crash();
    selection.value = ['sby01'];
    const r = mount();
    await tick();
    expect(isSectionOpen('Fast-start failover')).toBe(false);
    click(chips(r)!.querySelector('.sc-all'));
    await tick();
    expect(mode.value).toBe('build');
    expect(selection.value).toEqual([]);
    expect(isSectionOpen('Fast-start failover')).toBe(true);
  });

  it('are disabled where the view is read-only', () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    viewport.value = 'narrow';
    act(() => render(h(SettingChips, { logXpt: true }), root!));
    const controls = [...root.querySelectorAll<HTMLSelectElement>('.sc-row select')];
    expect(controls.length).toBe(3);
    expect(controls.every((c) => c.disabled)).toBe(true);
  });

  it('leave out LogXptMode when there is no standby, or when the layout draws it elsewhere', () => {
    const d = classic.doc();
    resetHistory(makeDoc({ ...d, members: d.members.filter((m) => m.id === 'prm01') }));
    root = document.createElement('div');
    document.body.appendChild(root);
    act(() => render(h(SettingChips, { logXpt: true }), root!));
    expect([...root.querySelectorAll('.sc-k')].map((k) => k.textContent)).toEqual(['Protection mode', 'FAST_START FAILOVER']);
    resetHistory(classicDoc());
    act(() => render(h(SettingChips, { logXpt: false }), root!));
    expect([...root.querySelectorAll('.sc-k')].map((k) => k.textContent)).toEqual(['Protection mode', 'FAST_START FAILOVER']);
  });
});

/* ---------------- the connect string's timings ---------------- */

describe('the connect string\'s timings, written as a tuning edit', () => {
  const app = () => applicationsOf(topology.value)[0]!;
  const client = () => applicationClient(topology.value, app());
  const field = (name: string) => CLIENT_TIMING_FIELDS.find((f) => f.name === name)!;

  it('are one undo entry with the inspector\'s label, and mark the run tuned', () => {
    setOwnClient('app01', true);
    const before = undoStack.value.length;
    tunedScenario.value = null;
    tuned(() => editClientTiming(field('TRANSPORT_CONNECT_TIMEOUT'), 20, 'app01'));
    tuned(() => editClientTiming(field('TRANSPORT_CONNECT_TIMEOUT'), 25, 'app01'));
    expect(app().client?.transportConnectTimeoutSeconds).toBe(25);
    expect(topology.value.client.transportConnectTimeoutSeconds).not.toBe(25);
    expect(undoLabel.value).toBe('Set TRANSPORT_CONNECT_TIMEOUT to 25 s');
    expect(undoStack.value).toHaveLength(before + 1);
    expect(tunedScenario.value).toBe(JSON.stringify(topology.value));
    undo();
    expect(app().client?.transportConnectTimeoutSeconds).not.toBe(25);
  });

  it('are written as the inspector does: an unset CONNECT_TIMEOUT is 0, and 0 puts it back', () => {
    tuned(() => editClientTiming(field('CONNECT_TIMEOUT'), 45, 'app01'));
    expect(topology.value.client.connectTimeoutSeconds).toBe(45);
    expect(undoLabel.value).toBe('Set CONNECT_TIMEOUT to 45 s');
    tuned(() => editClientTiming(field('CONNECT_TIMEOUT'), 0, 'app01'));
    expect(topology.value.client.connectTimeoutSeconds).toBeNull();
    expect(undoLabel.value).toBe('Leave CONNECT_TIMEOUT unset');
    tuned(() => editClientTiming(field('RETRY_COUNT'), 7, 'app01'));
    expect(client().retryCount).toBe(7);
    expect(undoLabel.value).toBe('Set RETRY_COUNT to 7');
    tuned(() => editClientTiming(field('RETRY_DELAY'), 4, 'app01'));
    expect(client().retryDelaySeconds).toBe(4);
    expect(undoLabel.value).toBe('Set RETRY_DELAY to 4 s');
  });
});
