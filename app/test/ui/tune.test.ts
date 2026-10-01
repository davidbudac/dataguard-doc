/**
 * Tuning a run from the Detailed timeline itself: the mapping from a clock on the timeline
 * to the setting that is that clock (`tune.ts`), the axis held while a setting
 * is tuned (`run.ts`), and the strip of settings beside the timeline
 * (`break/TuneStrip.tsx`) in both layouts.
 *
 * jsdom lays nothing out: how the strip sits is the browser pass.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  applicationClient, applicationsOf, BOUNDS, CLIENT_TIMING_TUNED, hostId, simulate, sortEvents,
} from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { classic } from '@/presets';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory, undo, undoLabel, undoStack } from '@/state/history';
import { topology, trace } from '@/state/derived';
import { loadTune, setTune, TUNE_KEY } from '@/state/persist';
import {
  appLanesShown, breakTimeline, mode, railCollapsed, selection, tuneOn, viewport,
} from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { SETTINGS_COLUMN_MIN_W, TuneStrip, tuneLayoutFor } from '@/ui/break/TuneStrip';
import { addApplication, patchFsfo, setOwnClient, setRoleTransition } from '@/ui/inspector/edits';
import { WHY } from '@/ui/inspector/why';
import { isSectionOpen, resetSections } from '@/ui/inspector/sections';
import { buildTimeline } from '@/ui/timeline/build';
import { markTuned, tunedScenario, tuneDragging, useRunTimeline } from '@/ui/timeline/run';
import type { RunTimeline } from '@/ui/timeline/run';
import { applyTune, tuneForBrace, tunedStandby } from '@/ui/timeline/tune';

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
const strip = (r: ParentNode): HTMLElement | null => r.querySelector('.tune-strip');
const num = (r: ParentNode, label: string): HTMLInputElement =>
  r.querySelector(`.tune-strip input[aria-label="${label}"]`) as HTMLInputElement;
const sel = (r: ParentNode, label: string): HTMLSelectElement =>
  r.querySelector(`.tune-strip select[aria-label="${label}"]`) as HTMLSelectElement;
const toggle = (r: ParentNode): HTMLButtonElement =>
  [...r.querySelectorAll<HTMLButtonElement>('.sb-bar .sb-tune')][0] as HTMLButtonElement;

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
  tuneOn.value = true;
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
    applyTune(threshold(), 500000);
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
  it('typing in the strip changes the setting and keeps the axis until Fit lets go of it', async () => {
    crash();
    const r = mount();
    await tick();
    /* Without the application's lanes the axis follows the failover, which is what tuning moves. */
    appLanesShown.value = false;
    await tick();
    const axis = (): string => [...r.querySelectorAll('.tl-svg .t-tick')].map((t) => t.textContent).join(',');
    const before = axis();
    typeInto(num(r, 'FastStartFailoverThreshold'), '25');
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

  it('has no strip in a read-only view', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.tune-strip')).not.toBeNull();
    viewport.value = 'narrow';
    await tick();
    expect(r.querySelector('.tune-strip')).toBeNull();
  });
});

/* ---------------- the strip ---------------- */

describe('the tune strip', () => {
  it('is drawn in Lanes as a column beside the rows, and its role transition box edits the document', async () => {
    crash();
    const r = mount();
    await tick();
    const s = strip(r)!;
    expect(s.classList.contains('tune-col')).toBe(true);
    expect(s.nextElementSibling?.classList.contains('ln-body')).toBe(true);
    expect(s.parentElement?.classList.contains('ln-main')).toBe(true);
    typeInto(num(r, 'Role transition'), '20');
    await tick();
    expect(topology.value.environment.roleTransitionSeconds).toBe(20);
  });

  it('carries the threshold\'s box, which edits the document', async () => {
    crash();
    const r = mount();
    await tick();
    const box = num(r, 'FastStartFailoverThreshold');
    expect(box.value).toBe('30');
    expect(box).toMatchObject({ min: '6', max: '3600', step: '1' });
    typeInto(box, '25');
    await tick();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(25);
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 25 s');
    expect(num(r, 'FastStartFailoverThreshold').value).toBe('25');
  });

  it('is drawn with no run to draw', async () => {
    const r = mount();
    await tick();
    expect(trace.value).toBeNull();
    expect(strip(r)).not.toBeNull();
  });

  it('carries the controls in order, named as the inspector names them (the row, under 1180 px)', async () => {
    crash();
    root = document.createElement('div');
    document.body.appendChild(root);
    act(() => render(h(TuneStrip, { layout: 'row' }), root!));
    const r = root;
    await tick();
    const names = [...strip(r)!.querySelectorAll('.tune-k')].map((k) => k.textContent);
    expect(names).toEqual([
      'Protection mode', 'FAST_START FAILOVER', 'FastStartFailoverThreshold', 'FastStartFailoverLagLimit',
      'LogXptMode · sby01', 'Apply lag · sby01', 'Role transition',
    ]);
    expect(strip(r)!.querySelector('.tune-k.mono')!.textContent).toBe('FAST_START FAILOVER');
    expect(strip(r)!.querySelectorAll('.tune-k:not(.mono)')).toHaveLength(3);
    for (const f of strip(r)!.querySelectorAll('.tune-f')) expect(f.getAttribute('title')!.length).toBeGreaterThan(40);
    expect(strip(r)!.querySelector('.tune-all')!.textContent).toBe('All settings');
  });

  it('edits the selects and the other boxes through the inspector\'s setters', async () => {
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
    typeInto(num(r, 'Apply lag · sby01'), '12');
    await tick();
    const sby = topology.value.members.find((m) => m.id === 'sby01');
    expect(sby?.kind === 'database' && sby.applyLagSeconds).toBe(12);
    expect(undoLabel.value).toBe('Set the apply lag on sby01');
    choose(sel(r, 'LogXptMode · sby01'), 'ASYNC');
    await tick();
    expect(topology.value.members.find((m) => m.id === 'sby01')?.logXptMode).toBe('ASYNC');
    expect(undoLabel.value).toBe('Set LogXptMode to ASYNC on sby01');
  });

  it('greys the lag limit under 19c with maximum availability, and says why', async () => {
    crash();
    const r = mount();
    await tick();
    expect(topology.value.config.edition).toBe('19c');
    expect(topology.value.config.protectionMode).toBe('MAXAVAILABILITY');
    const box = num(r, 'FastStartFailoverLagLimit');
    expect(box.disabled).toBe(true);
    const why = box.closest('.tune-g')!.querySelector('.tune-why')!;
    expect(why.textContent).toMatch(/^Under 19c FastStartFailoverLagLimit is a maximum performance property/);
    expect(why.getAttribute('title')).toBe(why.textContent);
    choose(sel(r, 'Protection mode'), 'MAXPERFORMANCE');
    await tick();
    expect(num(r, 'FastStartFailoverLagLimit').disabled).toBe(false);
    expect(strip(r)!.querySelector('.tune-g .tune-why')?.textContent ?? '').not.toMatch(/^Under 19c FastStartFailoverLagLimit/);
    typeInto(num(r, 'FastStartFailoverLagLimit'), '20');
    await tick();
    expect(topology.value.config.fsfo).toMatchObject({ lagLimitSeconds: 20, lagLimitSet: true });
    expect(undoLabel.value).toBe('Set FastStartFailoverLagLimit to 20 s');
  });

  it('refuses FASTSYNC outside maximum availability, with the same reason as the inspector', async () => {
    crash();
    const r = mount();
    await tick();
    choose(sel(r, 'Protection mode'), 'MAXPERFORMANCE');
    await tick();
    const fast = [...sel(r, 'LogXptMode · sby01').options].find((o) => o.value === 'FASTSYNC')!;
    expect(fast.disabled).toBe(true);
    expect(strip(r)!.querySelector('.tune-why')!.textContent).toBe('FASTSYNC is maximum availability only (12.1+).');
  });

  it('is away with the Settings toggle, and the choice is remembered', async () => {
    crash();
    const r = mount();
    await tick();
    expect(toggle(r).getAttribute('aria-pressed')).toBe('true');
    toggle(r).click();
    await tick();
    expect(strip(r)).toBeNull();
    expect(r.querySelector('.tune-f')).toBeNull();
    expect(toggle(r).getAttribute('aria-pressed')).toBe('false');
    expect(memory.get(TUNE_KEY)).toBe('0');
    tuneOn.value = true;
    loadTune();
    expect(tuneOn.value).toBe(false);
    toggle(r).click();
    await tick();
    expect(strip(r)).not.toBeNull();
    expect(memory.get(TUNE_KEY)).toBe('1');
    setTune(true);
    memory.delete(TUNE_KEY);
    loadTune();
    expect(tuneOn.value).toBe(true);
  });

  it('has the same toggle in Lanes\' bar', async () => {
    crash();
    const r = mount();
    await tick();
    toggle(r).click();
    await tick();
    expect(strip(r)).toBeNull();
    expect(memory.get(TUNE_KEY)).toBe('0');
  });

  it('is not in Build, Configure or Learn', async () => {
    crash();
    const r = mount();
    await tick();
    expect(strip(r)).not.toBeNull();
    for (const m of ['build', 'configure', 'learn'] as const) {
      mode.value = m;
      await tick();
      expect(strip(r)).toBeNull();
    }
  });

  it('is not there while the Application timeline is, and neither is the toggle', async () => {
    crash();
    const r = mount();
    await tick();
    breakTimeline.value = 'app';
    await tick();
    expect(strip(r)).toBeNull();
    expect(r.querySelector('.app-tl-strip')).not.toBeNull();
    expect(toggle(r)).toBeUndefined();
    await tick();
    expect(strip(r)).toBeNull();
    expect(toggle(r)).toBeUndefined();
  });

  it('opens Build on the fast-start failover section, with nothing selected', async () => {
    crash();
    selection.value = ['sby01'];
    const r = mount();
    await tick();
    expect(isSectionOpen('Fast-start failover')).toBe(false);
    (strip(r)!.querySelector('.tune-all') as HTMLButtonElement).click();
    await tick();
    expect(mode.value).toBe('build');
    expect(selection.value).toEqual([]);
    expect(isSectionOpen('Fast-start failover')).toBe(true);
  });

  it('is disabled with a reason where the view is read-only', () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    viewport.value = 'narrow';
    act(() => render(h(TuneStrip, { layout: 'row' }), root!));
    const controls = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.tune-strip input, .tune-strip select')];
    expect(controls.length).toBeGreaterThanOrEqual(6);
    expect(controls.every((c) => c.disabled)).toBe(true);
    expect(root.querySelector(':scope .tune-strip > .tune-why')?.textContent).toBe('This is a read-only view here.');
  });

  it('leaves out LogXptMode and the apply lag when there is no standby', () => {
    const d = classic.doc();
    resetHistory(makeDoc({ ...d, members: d.members.filter((m) => m.id === 'prm01') }));
    root = document.createElement('div');
    document.body.appendChild(root);
    act(() => render(h(TuneStrip, { layout: 'row' }), root!));
    const names = [...root.querySelectorAll('.tune-k')].map((k) => k.textContent);
    expect(names.some((n) => n?.startsWith('LogXptMode') || n?.startsWith('Apply lag'))).toBe(false);
    expect(names).toContain('Role transition');
  });
});

/* ---------------- the column ---------------- */

/** The settings column of Lanes (break/TuneStrip.tsx, `layout="column"`). */
describe('the settings column', () => {
  const col = (r: ParentNode): HTMLElement | null => r.querySelector('.tune-col');
  const cnum = (r: ParentNode, label: string): HTMLInputElement =>
    r.querySelector(`.tune-col input[aria-label="${label}"]`) as HTMLInputElement;
  const heads = (r: ParentNode): (string | null)[] =>
    [...col(r)!.querySelectorAll('.grp-hd .eyebrow')].map((e) => e.textContent);
  const lanes = async (): Promise<HTMLElement> => {
    crash();
    const r = mount();
    await tick();
    return r;
  };
  const app = () => applicationsOf(topology.value)[0]!;
  const client = () => applicationClient(topology.value, app());

  it('is the settings at a wide section, under the rail\'s headings, one control to a line', async () => {
    const r = await lanes();
    expect(col(r)).not.toBeNull();
    expect(r.querySelector('.ln-view > .tune-strip')).toBeNull();
    expect(heads(r)).toEqual(['Protection', 'Fast-start failover', 'Standby sby01', 'Environment', 'Application app01']);
    const names = [...col(r)!.querySelectorAll('.tune-k')].map((k) => k.textContent);
    expect(names).toEqual([
      'Protection mode', 'FAST_START FAILOVER', 'FastStartFailoverThreshold', 'FastStartFailoverLagLimit',
      'LogXptMode', 'Apply lag', 'Role transition',
      'TRANSPORT_CONNECT_TIMEOUT', 'CONNECT_TIMEOUT', 'RETRY_COUNT', 'RETRY_DELAY',
    ]);
    /* The accessible names are the row's, so the two cannot be told apart by a screen reader. */
    expect(cnum(r, 'Apply lag · sby01')).not.toBeNull();
    expect(col(r)!.querySelector('.tune-all')!.textContent).toBe('All settings');
    expect(col(r)!.lastElementChild).toBe(col(r)!.querySelector('.tune-all'));
  });

  it('has the Application group\'s four timings and presets, and only when the document has an application', async () => {
    const r = await lanes();
    const group = [...col(r)!.querySelectorAll('.grp')].at(-1) as HTMLElement;
    expect(group.querySelector('.eyebrow')!.textContent).toBe('Application app01');
    expect([...group.querySelectorAll('.tune-k')].map((k) => k.textContent)).toEqual([
      'TRANSPORT_CONNECT_TIMEOUT', 'CONNECT_TIMEOUT', 'RETRY_COUNT', 'RETRY_DELAY',
    ]);
    expect([...group.querySelectorAll('.client-presets .btn')].map((b) => b.textContent)).toEqual(['Defaults', 'Tuned']);
    expect(group.querySelector('.tune-f')!.getAttribute('title')).toMatch(/^Default 60 s in tnsnames\.ora, for each ADDRESS/);
    /* The application is the one `timelineApplication()` names: a new one is selected, and the column follows it. */
    addApplication();
    await tick();
    expect(heads(r).at(-1)).toBe('Application app02');
    /* No application, no group. */
    render(null, r);
    const d = classic.doc();
    resetHistory(makeDoc({ ...d, applications: [] }));
    root = document.createElement('div');
    document.body.appendChild(root);
    act(() => render(h(TuneStrip, { layout: 'column' }), root!));
    expect([...root.querySelectorAll('.grp-hd .eyebrow')].map((e) => e.textContent)).toEqual([
      'Protection', 'Fast-start failover', 'Standby sby01', 'Environment',
    ]);
    expect(root.querySelector('input[aria-label="RETRY_COUNT"]')).toBeNull();
  });

  it('has no Standby group when there is no standby, and none of its controls', () => {
    const d = classic.doc();
    resetHistory(makeDoc({ ...d, members: d.members.filter((m) => m.id === 'prm01') }));
    root = document.createElement('div');
    document.body.appendChild(root);
    act(() => render(h(TuneStrip, { layout: 'column' }), root!));
    expect([...root.querySelectorAll('.grp-hd .eyebrow')].map((e) => e.textContent)).toEqual([
      'Protection', 'Fast-start failover', 'Environment', 'Application app01',
    ]);
    expect(root.querySelector('input[aria-label^="Apply lag"]')).toBeNull();
  });

  it('edits the application\'s connect string with the inspector\'s label, in one undo entry, and marks the run tuned', async () => {
    const r = await lanes();
    setOwnClient('app01', true);
    await tick();
    const before = undoStack.value.length;
    tunedScenario.value = null;
    typeInto(cnum(r, 'TRANSPORT_CONNECT_TIMEOUT'), '20');
    typeInto(cnum(r, 'TRANSPORT_CONNECT_TIMEOUT'), '25');
    await tick();
    expect(app().client?.transportConnectTimeoutSeconds).toBe(25);
    expect(topology.value.client.transportConnectTimeoutSeconds).not.toBe(25);
    expect(undoLabel.value).toBe('Set TRANSPORT_CONNECT_TIMEOUT to 25 s');
    expect(undoStack.value).toHaveLength(before + 1);
    expect(tunedScenario.value).toBe(JSON.stringify(topology.value));
    expect(cnum(r, 'TRANSPORT_CONNECT_TIMEOUT').value).toBe('25');
    undo();
    expect(app().client?.transportConnectTimeoutSeconds).not.toBe(25);
  });

  it('writes the others as the inspector does: an unset CONNECT_TIMEOUT is 0, and 0 puts it back', async () => {
    const r = await lanes();
    /* No connect string of its own: the edit is to the shared one, which the application dials. */
    expect(cnum(r, 'CONNECT_TIMEOUT').value).toBe('0');
    expect(col(r)!.textContent).toContain('s — not set');
    typeInto(cnum(r, 'CONNECT_TIMEOUT'), '45');
    await tick();
    expect(topology.value.client.connectTimeoutSeconds).toBe(45);
    expect(undoLabel.value).toBe('Set CONNECT_TIMEOUT to 45 s');
    typeInto(cnum(r, 'CONNECT_TIMEOUT'), '0');
    await tick();
    expect(topology.value.client.connectTimeoutSeconds).toBeNull();
    expect(undoLabel.value).toBe('Leave CONNECT_TIMEOUT unset');
    typeInto(cnum(r, 'RETRY_COUNT'), '7');
    await tick();
    expect(client().retryCount).toBe(7);
    expect(undoLabel.value).toBe('Set RETRY_COUNT to 7');
    typeInto(cnum(r, 'RETRY_DELAY'), '4');
    await tick();
    expect(client().retryDelaySeconds).toBe(4);
    expect(undoLabel.value).toBe('Set RETRY_DELAY to 4 s');
  });

  it('applies a preset in one undo entry and marks the run tuned', async () => {
    const r = await lanes();
    const before = undoStack.value.length;
    tunedScenario.value = null;
    const tunedBtn = [...col(r)!.querySelectorAll<HTMLButtonElement>('.client-presets .btn')].find((b) => b.textContent === 'Tuned')!;
    tunedBtn.click();
    await tick();
    expect(client().retryCount).toBe(CLIENT_TIMING_TUNED.retryCount);
    expect(undoStack.value).toHaveLength(before + 1);
    expect(tunedScenario.value).toBe(JSON.stringify(topology.value));
  });

  it('draws a greyed control\'s reason in full under it, with the tooltip as before', async () => {
    const r = await lanes();
    expect(topology.value.config.edition).toBe('19c');
    expect(topology.value.config.protectionMode).toBe('MAXAVAILABILITY');
    const box = cnum(r, 'FastStartFailoverLagLimit');
    expect(box.disabled).toBe(true);
    const g = box.closest('.tune-g')!;
    const why = g.querySelector('.tune-why')!;
    expect(why.textContent).toBe(WHY.lagLimitMaxAvail19c);
    expect(why.getAttribute('title')).toBe(WHY.lagLimitMaxAvail19c);
    /* Under the control, in the same group, not beside it. */
    expect(g.firstElementChild?.classList.contains('tune-f')).toBe(true);
    expect(why.previousElementSibling).toBe(g.firstElementChild);
  });

  it('is gone with the Settings toggle, and the lanes stay', async () => {
    const r = await lanes();
    expect(col(r)).not.toBeNull();
    toggle(r).click();
    await tick();
    expect(col(r)).toBeNull();
    expect(strip(r)).toBeNull();
    expect(r.querySelector('.ln-main > .ln-body')).not.toBeNull();
    toggle(r).click();
    await tick();
    expect(col(r)).not.toBeNull();
  });

  it('is not there while the Application timeline is', async () => {
    const r = await lanes();
    breakTimeline.value = 'app';
    await tick();
    expect(col(r)).toBeNull();
    expect(r.querySelector('.ln-main')).toBeNull();
  });

  it('is disabled with the reason in full where the view is read-only', () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    viewport.value = 'narrow';
    act(() => render(h(TuneStrip, { layout: 'column' }), root!));
    const controls = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.tune-col input, .tune-col select')];
    expect(controls.length).toBeGreaterThanOrEqual(6);
    expect(controls.every((c) => c.disabled)).toBe(true);
    expect(root.querySelector('.tune-col > .tune-why')?.textContent).toBe('This is a read-only view here.');
  });

  it('decides column or row from the section\'s width: the column from 1180 px', () => {
    expect(SETTINGS_COLUMN_MIN_W).toBe(1180);
    expect(tuneLayoutFor(1180)).toBe('column');
    expect(tuneLayoutFor(1600)).toBe('column');
    expect(tuneLayoutFor(1179)).toBe('row');
    expect(tuneLayoutFor(1024)).toBe('row');
    expect(tuneLayoutFor(0)).toBe('row');
  });

  it('falls back to the row above the lanes when the measured section is narrow', async () => {
    class FakeRO {
      constructor(private cb: () => void) {}
      observe(): void { this.cb(); }
      disconnect(): void {}
      unobserve(): void {}
    }
    const RO = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
    const CW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: FakeRO });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('ln-view') ? 1100 : 900; },
    });
    try {
      const r = await lanes();
      expect(col(r)).toBeNull();
      const s = strip(r)!;
      expect(s.parentElement?.classList.contains('ln-view')).toBe(true);
      expect(s.nextElementSibling?.classList.contains('ln-main')).toBe(true);
      expect(r.querySelector('.ln-main > .ln-body')).not.toBeNull();
    } finally {
      if (RO) Object.defineProperty(window, 'ResizeObserver', RO); else delete (window as unknown as Record<string, unknown>).ResizeObserver;
      if (CW) Object.defineProperty(HTMLElement.prototype, 'clientWidth', CW);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });
});
