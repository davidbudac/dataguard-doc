/**
 * Tuning a run from Simulate itself: the mapping from a clock on the timeline
 * to the setting that is that clock (`tune.ts`), the headline as an equation
 * whose terms are those settings (`equation.ts`, `RunHeadline.tsx`), the axis
 * held while a setting is tuned (`run.ts`), and the strip of settings above the
 * timeline (`break/TuneStrip.tsx`) in both layouts.
 *
 * jsdom lays nothing out: how the strip sits, and that the equation's boxes
 * leave the headline one line tall, are the browser pass.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { BOUNDS, hostId, simulate, sortEvents } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { classic } from '@/presets';
import { classicDoc, makeDoc } from '@/state/doc';
import { resetHistory, undo, undoLabel, undoStack } from '@/state/history';
import { topology, trace } from '@/state/derived';
import { loadTune, setTune, TUNE_KEY } from '@/state/persist';
import {
  appLanesShown, breakLayout, breakTimeline, mode, railCollapsed, selection, timelineFull, timelineH, tuneOn, viewport,
} from '@/state/view';
import { App } from '@/ui/App';
import { applyTemplate, templates } from '@/ui/break/events';
import { TuneStrip } from '@/ui/break/TuneStrip';
import { patchFsfo, setRoleTransition } from '@/ui/inspector/edits';
import { isSectionOpen, resetSections } from '@/ui/inspector/sections';
import { buildTimeline } from '@/ui/timeline/build';
import { equationOf } from '@/ui/timeline/equation';
import { RunHeadline } from '@/ui/timeline/RunHeadline';
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
  breakLayout.value = 'split';
  breakTimeline.value = 'config';
  railCollapsed.value = false;
  timelineH.value = null;
  timelineFull.value = false;
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

/* ---------------- the equation ---------------- */

describe('equationOf', () => {
  const eq = (d: TopologyDoc) => {
    const { tr, model } = modelOf(d);
    return { tr, e: equationOf(d, tr, model.braces) };
  };

  it('adds a failover up to the moment the new primary is open, with 30 and 15 as its terms', () => {
    const d = scenario('crash');
    const { tr, e } = eq(d);
    expect(e?.lead).toBe(`New primary open read-write at t = ${Math.round(tr.facts.tOpen! * 100) / 100} s`.replace(/\.0+ s$/, ' s'));
    expect(e?.terms.map((t) => [t.key, Math.round(t.seconds)])).toEqual([['threshold', 30], ['role', 15]]);
    expect(e?.terms.reduce((n, t) => n + t.seconds, 0)).toBeCloseTo(tr.facts.tOpen!, 1);
    expect(e?.terms.every((t) => t.tune !== null)).toBe(true);
    expect(e?.terms[0]).toMatchObject({ label: 'FastStartFailoverThreshold', mono: true });
    expect(e?.terms[1]).toMatchObject({ label: 'role change + open', mono: false });
    expect(e?.terms[0]?.title).toContain('FastStartFailoverThreshold — 30 s');
  });

  it('starts a clock that began after the first event with a term of its own, so the sum still adds up', () => {
    const d = scenario('crash', classic.doc(), 20);
    const { tr, e } = eq(d);
    expect(e?.terms.map((t) => t.key)).toEqual(['start', 'threshold', 'role']);
    expect(e?.terms[0]).toMatchObject({ seconds: 20, tune: null, label: 'clock starts' });
    expect(e?.terms.reduce((n, t) => n + t.seconds, 0)).toBeCloseTo(tr.facts.tOpen!, 1);
  });

  it('carries the standby\'s apply lag as terminal recovery, editable', () => {
    const { e } = eq(scenario('crash', lagged(10)));
    expect(e?.terms.map((t) => [t.key, Math.round(t.seconds), t.tune?.id])).toEqual([
      ['threshold', 30, 'threshold'], ['recovery', 10, 'applyLag'], ['role', 15, 'roleTransition'],
    ]);
    expect(e?.terms[1]?.label).toBe('terminal recovery');
  });

  it('adds a switchover up to its read-write downtime, from where the conversion begins', () => {
    const d = scenario('switchover', lagged(10));
    const { tr, e } = eq(d);
    const downtime = (tr.facts as { switchover?: { downtime: number } }).switchover!.downtime;
    expect(e?.lead).toBe(`Read-write downtime ≈ ${downtime} s`);
    expect(e?.terms.map((t) => t.key)).toEqual(['sw-convert', 'sw-catchup', 'sw-role']);
    expect(e?.terms.map((t) => t.label)).toEqual(['conversion', 'catch-up', 'role change + open']);
    expect(e?.terms.reduce((n, t) => n + t.seconds, 0)).toBeCloseTo(downtime, 1);
    expect(e?.terms.map((t) => t.tune?.id ?? null)).toEqual([null, 'applyLag', 'roleTransition']);
  });

  it('names what is left over as "other" when the braces do not cover the run, and only then', () => {
    const d = scenario('crash');
    const { tr, model } = modelOf(d);
    const short = model.braces.filter((b) => b.key !== 'role');
    const e = equationOf(d, tr, short);
    expect(e?.terms.at(-1)).toMatchObject({ key: 'other', tune: null });
    expect(e?.terms.reduce((n, t) => n + t.seconds, 0)).toBeCloseTo(tr.facts.tOpen!, 5);
    /* More than the run: the equation is dropped rather than shown wrong. */
    const long = model.braces.map((b) => (b.key === 'role' ? { ...b, b: b.b + 9 } : b));
    expect(equationOf(d, tr, long)).toBeNull();
  });

  it('is null for a blocked failover and for every outcome that is not a sum', () => {
    const base = classic.doc();
    const blocked: TopologyDoc = {
      ...base,
      config: { ...base.config, protectionMode: 'MAXPERFORMANCE', fsfo: { ...base.config.fsfo, lagLimitSeconds: 5, lagLimitSet: true } },
      members: base.members.map((m) => ({
        ...m, logXptMode: 'ASYNC' as const,
        ...(m.id === 'sby01' ? { applyLagSeconds: 60, transportLagSeconds: 60 } : {}),
      })),
    };
    const b = scenario('crash', blocked);
    expect(simulate(b, b.events).facts.blocked).toBe(true);
    expect(eq(b).e).toBeNull();
    for (const id of ['partition', 'dc2down', 'observer-lost']) expect(eq(scenario(id)).e).toBeNull();
    expect(eq({ ...classic.doc(), events: [] }).e).toBeNull();
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

/* ---------------- the headline ---------------- */

describe('RunHeadline', () => {
  const caption = { text: 'A sentence — with a tail', tone: 'f-am' as const, x: null, anchor: 'start' as const };
  const eqOf = (d: TopologyDoc) => { const m = modelOf(d); return equationOf(d, m.tr, m.model.braces); };

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('is the sentence, unchanged, without an equation or without a way to tune', () => {
    act(() => render(h(RunHeadline, { caption, equation: null, onTune: () => undefined }), root!));
    let p = root!.querySelector('p')!;
    expect(p.className).toBe('tl-headline f-am');
    expect(p.getAttribute('title')).toBe(caption.text);
    expect(p.textContent).toBe(caption.text);
    act(() => render(h(RunHeadline, { caption: { ...caption, tone: 'ink' }, equation: eqOf(scenario('crash')) }), root!));
    p = root!.querySelector('p')!;
    expect(p.className).toBe('tl-headline');
    expect(p.textContent).toBe(caption.text);
    expect(root!.querySelector('input')).toBeNull();
  });

  it('is the equation, with a box for every term that is a setting, when it can be tuned', () => {
    const onTune = vi.fn();
    act(() => render(h(RunHeadline, { caption: { ...caption, tone: 'ink' }, equation: eqOf(scenario('crash', lagged(10))), onTune }), root!));
    const p = root!.querySelector('p')!;
    expect(p.className).toBe('tl-headline tl-eq');
    expect(p.getAttribute('title')).toBe(caption.text);
    expect(p.textContent).toContain('New primary open read-write at t = 55 s =');
    const boxes = [...p.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(boxes.map((b) => [b.getAttribute('aria-label'), b.value])).toEqual([
      ['FastStartFailoverThreshold', '30'], ['Apply lag', '10'], ['Role transition', '15'],
    ]);
    expect(boxes[0]).toMatchObject({ min: '6', max: '120', step: '1' });
    expect(boxes[0]!.closest('.tl-eq-t')!.getAttribute('title')).toContain('Allowed: 6–120 s.');
    expect(p.textContent).toMatch(/s FastStartFailoverThreshold \+ .*s terminal recovery \+ .*s role change \+ open$/);
    act(() => typeInto(boxes[0]!, '25'));
    expect(onTune).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'threshold' }), 25);
  });

  it('waits on a value below the floor until the box is left, then clamps it', () => {
    const onTune = vi.fn();
    act(() => render(h(RunHeadline, { caption, equation: eqOf(scenario('crash')), onTune }), root!));
    const box = root!.querySelector<HTMLInputElement>('input')!;
    act(() => typeInto(box, '2'));
    expect(onTune).not.toHaveBeenCalled();
    expect(box.value).toBe('2');
    act(() => typeInto(box, '25'));
    expect(onTune).toHaveBeenLastCalledWith(expect.anything(), 25);
    act(() => typeInto(box, '400'));
    expect(onTune).toHaveBeenLastCalledWith(expect.anything(), 120);
  });

  it('scrubs the value when the label is dragged sideways, one step per 6 px, and lets the axis go after', () => {
    const onTune = vi.fn();
    act(() => render(h(RunHeadline, { caption, equation: eqOf(scenario('crash')), onTune }), root!));
    const grip = root!.querySelector<HTMLElement>('.is-scrub')!;
    grip.setPointerCapture = vi.fn();
    grip.hasPointerCapture = () => true;
    grip.releasePointerCapture = vi.fn();
    const fire = (type: string, x: number): void => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      act(() => { grip.dispatchEvent(e); });
    };
    fire('pointerdown', 100);
    expect(tuneDragging.value).toBe(true);
    fire('pointermove', 118);
    expect(onTune).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'threshold' }), 33);
    fire('pointermove', 64);
    expect(onTune).toHaveBeenLastCalledWith(expect.anything(), 24);
    fire('pointermove', -5000);
    expect(onTune).toHaveBeenLastCalledWith(expect.anything(), 6);
    fire('pointerup', 100);
    expect(tuneDragging.value).toBe(false);
    onTune.mockClear();
    fire('pointermove', 200);
    expect(onTune).not.toHaveBeenCalled();
  });

  it('lets the axis go if the headline goes while a scrub is in progress', () => {
    act(() => render(h(RunHeadline, { caption, equation: eqOf(scenario('crash')), onTune: () => undefined }), root!));
    const grip = root!.querySelector<HTMLElement>('.is-scrub')!;
    grip.setPointerCapture = vi.fn();
    const e = new MouseEvent('pointerdown', { bubbles: true, clientX: 10, button: 0 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    act(() => { grip.dispatchEvent(e); });
    expect(tuneDragging.value).toBe(true);
    act(() => render(null, root!));
    expect(tuneDragging.value).toBe(false);
  });
});

/* ---------------- Simulate, end to end ---------------- */

describe('Simulate\'s headline', () => {
  it('is the equation for a crash, and typing in a term changes the setting and keeps the axis', async () => {
    crash();
    const r = mount();
    await tick();
    const line = r.querySelector('.tl-headline')!;
    expect(line.classList.contains('tl-eq')).toBe(true);
    const boxes = [...line.querySelectorAll<HTMLInputElement>('input')];
    expect(boxes.map((b) => b.value)).toEqual(['30', '10', '15']);
    /* Without the application's lanes the axis follows the failover, which is what tuning moves. */
    appLanesShown.value = false;
    await tick();
    const axis = (): string => [...r.querySelectorAll('.tl-svg .t-tick')].map((t) => t.textContent).join(',');
    const before = axis();
    typeInto(boxes[0]!, '25');
    await tick();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(25);
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 25 s');
    expect(r.querySelector('.tl-headline')!.textContent).toContain('t = 50 s');
    /* The axis stayed where it was, so the bar is seen to shrink; the bar's Fit lets go of it. */
    expect(axis()).toBe(before);
    const fit = r.querySelector<HTMLButtonElement>('.sb-fit');
    expect(fit).not.toBeNull();
    fit!.click();
    await tick();
    expect(axis()).not.toBe(before);
    expect(r.querySelector('.sb-fit')).toBeNull();
  });

  it('is not the equation, and has no strip, in a read-only view', async () => {
    crash();
    const r = mount();
    await tick();
    expect(r.querySelector('.tl-headline.tl-eq')).not.toBeNull();
    viewport.value = 'narrow';
    await tick();
    expect(r.querySelector('.tl-eq')).toBeNull();
    expect(r.querySelector('.tune-strip')).toBeNull();
  });

  it('is the equation in Lanes too', async () => {
    breakLayout.value = 'lanes';
    crash();
    const r = mount();
    await tick();
    const line = r.querySelector('.ln-head .tl-headline')!;
    expect(line.classList.contains('tl-eq')).toBe(true);
    typeInto(line.querySelector<HTMLInputElement>('input[aria-label="Role transition"]')!, '20');
    await tick();
    expect(topology.value.environment.roleTransitionSeconds).toBe(20);
  });
});

/* ---------------- the strip ---------------- */

describe('the tune strip', () => {
  it('is drawn in Split between the bar\'s summary and the timeline, and its threshold box edits the document', async () => {
    crash();
    const r = mount();
    await tick();
    const s = strip(r)!;
    expect(s).not.toBeNull();
    expect(s.nextElementSibling?.classList.contains('tl-slot')).toBe(true);
    expect(s.parentElement?.querySelector('.sb-bar')).not.toBeNull();
    const box = num(r, 'FastStartFailoverThreshold');
    expect(box.value).toBe('30');
    expect(box).toMatchObject({ min: '6', max: '120', step: '1' });
    typeInto(box, '25');
    await tick();
    expect(topology.value.config.fsfo.thresholdSeconds).toBe(25);
    expect(undoLabel.value).toBe('Set FastStartFailoverThreshold to 25 s');
    expect(num(r, 'FastStartFailoverThreshold').value).toBe('25');
    expect((r.querySelector('.tl-headline input[aria-label="FastStartFailoverThreshold"]') as HTMLInputElement).value).toBe('25');
    expect(r.querySelector('.tl-headline')!.textContent).toContain('t = 50 s');
  });

  it('is drawn in Lanes between the bar and the rows', async () => {
    breakLayout.value = 'lanes';
    crash();
    const r = mount();
    await tick();
    const s = strip(r)!;
    expect(s.nextElementSibling?.classList.contains('ln-body')).toBe(true);
    typeInto(num(r, 'Role transition'), '20');
    await tick();
    expect(topology.value.environment.roleTransitionSeconds).toBe(20);
  });

  it('is drawn with no run to draw, in both layouts', async () => {
    let r = mount();
    await tick();
    expect(trace.value).toBeNull();
    expect(strip(r)).not.toBeNull();
    render(null, r);
    breakLayout.value = 'lanes';
    r = mount();
    await tick();
    expect(strip(r)).not.toBeNull();
  });

  it('carries the controls in order, named as the inspector names them', async () => {
    crash();
    const r = mount();
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
    breakLayout.value = 'lanes';
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
    breakLayout.value = 'lanes';
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
    act(() => render(h(TuneStrip, {}), root!));
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
    act(() => render(h(TuneStrip, {}), root!));
    const names = [...root.querySelectorAll('.tune-k')].map((k) => k.textContent);
    expect(names.some((n) => n?.startsWith('LogXptMode') || n?.startsWith('Apply lag'))).toBe(false);
    expect(names).toContain('Role transition');
  });
});
