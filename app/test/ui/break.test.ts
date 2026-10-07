/**
 * Break mode: the six templates, the event list and the canvas menu.
 *
 * The templates are the load-bearing part. Each one produces exactly the
 * events the engine's own compatibility layer produces for the published
 * workbench's scenario of the same name, so a reader who clicks "Crash the
 * primary host" here is looking at the case the 24-cell regression matrix
 * asserts -- not an approximation of it.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { classicTopology, scenarioEvents, stateAt } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { classicDoc, doc, withEvents } from '@/state/doc';
import { readoutFor, trace } from '@/state/derived';
import { edit, resetHistory, undo } from '@/state/history';
import { clearSelection, healthyRun, hintsOn, mode, tNow, viewport } from '@/state/view';
import { BreakRail } from '@/ui/break/BreakRail';
import { breakBar } from '@/ui/break/menu';
import {
  actionsFor, anythingDownUnder, applyTemplate, clearEvents, describeEvent, healthyScenario, hoverTools, isDownAt, NO_RESTART_AFTER_ABORT,
  removeEventAt, restoreQuietLine, runAction, setEventTime, shelf, snapT, templates,
} from '@/ui/break/events';
import { buildExplanation } from '@/ui/break/explain';
import { WHY } from '@/ui/inspector/why';
import { DEFAULT_OPEN, openSections } from '@/ui/inspector/sections';
import { printing } from '@/ui/print';

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const kinds = (list: readonly TimedEvent[]): string[] => list.map((e) => e.kind);
const byId = (t: TopologyDoc, id: string) => templates(t, 0).find((x) => x.id === id);

/**
 * What Break's action bar lists for a selection at the playhead -- the list a
 * click on a card opens, and the only list there is now that the rail carries
 * no menu of its own. Rows are the bar's, in its group order; a refused row
 * carries its reason in `enabled`.
 */
const barOf = (keys: string[]) => breakBar(doc.value.topology, keys, snapT(tNow.value));
const rowsOf = (keys: string[]) => barOf(keys).actions;
const labelsOf = (keys: string[]): string[] => rowsOf(keys).map((a) => a.label);
const rowNamed = (keys: string[], start: string) => rowsOf(keys).find((a) => a.label.startsWith(start));
/** The refusal text under every grey row of a selection, for "does not print X". */
const refusals = (keys: string[]): string[] => rowsOf(keys)
  .map((a) => (a.enabled.state === 'off' ? a.enabled.why : ''))
  .filter((w) => w !== '');
const quietOf = (keys: string[]): string | null => barOf(keys).quiet;

/**
 * Put a hand-written event list on the document. The ids are branded in the
 * engine's types and plain strings in a test, so the cast is here once rather
 * than at every host and site named below.
 */
const inject = (events: readonly unknown[]): void => {
  edit('inject', (d) => withEvents(d, events as TimedEvent[]));
};

/** The member states the drawing is coloured from, keyed by a plain string. */
const membersAt = (t: number): Record<string, string> =>
  stateAt(trace.value!, t).members as Record<string, string>;

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  tNow.value = 0;
  openSections.value = new Set<string>([DEFAULT_OPEN]);
  hintsOn.value = false;
  clearSelection();
});

/** Unfold the scenarios, which start folded. */

describe('the six templates', () => {
  const t = classicTopology({});

  it('produces the crash the engine produces', () => {
    expect(byId(t, 'crash')?.events).toEqual([{ at: 0, kind: 'host.down', host: 'dc1-prm01' }]);
  });

  it('isolates the primary site by cutting every link that touches it', () => {
    const evts = byId(t, 'isolated')?.events ?? [];
    expect(kinds(evts)).toEqual(['link.cut', 'link.cut']);
    expect(evts.map((e) => ('link' in e ? (e.link as string) : ''))).toEqual(['dc1-dc2', 'dc1-dc3']);
  });

  it('partitions only the link between the two database sites', () => {
    expect(byId(t, 'partition')?.events).toEqual([{ at: 0, kind: 'link.cut', link: 'dc1-dc2' }]);
  });

  it('loses the standby site whole', () => {
    expect(byId(t, 'dc2down')?.events).toEqual([{ at: 0, kind: 'site.down', site: 'dc2' }]);
  });

  it('kills the observer by crashing its host', () => {
    const evts = byId(t, 'observer-lost')?.events ?? [];
    expect(kinds(evts)).toEqual(['host.down']);
    const host = 'host' in (evts[0] as TimedEvent) ? (evts[0] as { host: string }).host : '';
    expect(host).toBe(t.observers[0]?.host);
  });

  it('switches over to the fast-start failover target', () => {
    expect(byId(t, 'switchover')?.events).toEqual([{ at: 0, kind: 'cmd.switchover', to: 'sby01' }]);
  });

  it('agrees with the engine scenario table, template for template', () => {
    for (const id of ['crash', 'isolated', 'partition', 'dc2down', 'observer-lost', 'switchover'] as const) {
      expect(byId(t, id)?.events).toEqual(scenarioEvents(id, t));
    }
  });

  it('greys the observer template when no observer is deployed, and says why', () => {
    const none: TopologyDoc = { ...t, observers: [] };
    const tpl = byId(none, 'observer-lost');
    expect(tpl?.enabled).toEqual({ state: 'off', why: WHY.noObserverDeployed });
    expect(tpl?.caption).toContain('only observer host dies');
  });

  it('words the multi-observer case with the precondition the nomination rule carries', () => {
    const two: TopologyDoc = {
      ...t,
      observers: [
        ...t.observers,
        { ...t.observers[0]!, id: 'obs02' as typeof t.observers[0]['id'], name: 'obs02', role: 'backup' },
      ],
    };
    const caption = byId(two, 'observer-lost')?.caption ?? '';
    expect(caption).toContain('tries to nominate');
    expect(caption).toContain('still connected');
  });

  it('replaces the event list rather than adding to it', () => {
    const t0 = doc.value.topology;
    const crash = byId(t0, 'crash');
    const sw = byId(t0, 'switchover');
    applyTemplate(crash!);
    expect(kinds(doc.value.topology.events)).toEqual(['host.down']);
    applyTemplate(sw!);
    expect(kinds(doc.value.topology.events)).toEqual(['cmd.switchover']);
    undo();
    expect(kinds(doc.value.topology.events)).toEqual(['host.down']);
  });
});

describe('"Everything is working"', () => {
  const t0 = (): TopologyDoc => doc.value.topology;

  it('is first on the shelf, is not one of the six failures, and injects nothing', () => {
    const list = shelf(t0(), 0);
    expect(list.map((x) => x.id)).toEqual(['healthy', 'crash', 'isolated', 'partition', 'dc2down', 'observer-lost', 'switchover']);
    expect(list[0]?.label).toBe('Everything is working');
    expect(list[0]?.events).toEqual([]);
    expect(list[0]?.enabled.state).not.toBe('off');
    expect(templates(t0(), 0).some((x) => (x.id as string) === 'healthy')).toBe(false);
  });

  it('is greyed, with its reason, when no member holds the primary role', () => {
    const none: TopologyDoc = { ...t0(), members: t0().members.map((m) => ({ ...m, role: 'physical' as never })) };
    expect(healthyScenario(none).enabled).toEqual({ state: 'off', why: 'No member holds the primary role.' });
  });

  it('runs the configuration with no event at all: no trace before, the engine\'s own after', () => {
    expect(trace.value).toBeNull();
    applyTemplate(healthyScenario(t0()));
    expect(t0().events).toEqual([]);
    expect(healthyRun.value).toBe(true);
    const run = trace.value;
    expect(run).not.toBeNull();
    expect(run?.facts.outcome).toBe('continues');
    expect(run?.facts.dataLossKind).toBe('none');
    expect(run?.facts.newPrimary).toBeNull();
    expect(run?.facts.abortAt).toBeNull();
    expect(run?.facts.blocked).toBe(false);
    /* every member holds its steady state from the first instant to the last */
    const end = run?.facts.perMember as unknown as Record<string, { endState: string }>;
    expect(end['prm01']?.endState).toBe('open-rw');
    expect(end['sby01']?.endState).toBe('mounted-apply');
    expect(run?.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('says plainly that nothing failed, and labels each statement as this page\'s model', () => {
    applyTemplate(healthyScenario(t0()));
    const chips = readoutFor(false);
    const by = (id: string) => chips.find((c) => c.id === id);
    expect(by('outcome')).toMatchObject({ v: 'no failure', basis: 'model' });
    expect(by('loss')).toMatchObject({ v: 'none', basis: 'model' });
    expect(by('split')).toMatchObject({ v: 'no', basis: 'model' });
    expect(chips.map((c) => c.v)).not.toContain('nothing moved');
    expect(by('open')).toBeUndefined();
  });

  it('explains itself without inventing a failover prerequisite', () => {
    applyTemplate(healthyScenario(t0()));
    const steps = buildExplanation(t0(), trace.value!);
    expect(steps.map((x) => x.key)).not.toContain('no-initiation');
    const result = steps.find((x) => x.key === 'result');
    expect(result?.detail).toContain('Nothing was injected, so nothing failed');
    expect(result?.claim?.basis).toBe('model');
  });

  it('clears the events a crash left, and a failure scenario after it takes the run back', () => {
    applyTemplate(byId(t0(), 'crash')!);
    expect(kinds(t0().events)).toEqual(['host.down']);
    applyTemplate(healthyScenario(t0()));
    expect(t0().events).toEqual([]);
    expect(trace.value?.facts.outcome).toBe('continues');
    applyTemplate(byId(t0(), 'switchover')!);
    expect(healthyRun.value).toBe(false);
    expect(trace.value?.facts.outcome).toBe('switchover');
    /* and undoing back to the healthy run is the healthy run, not a crash */
    undo();
    expect(t0().events).toEqual([]);
  });

  it('is put away by Clear, by removing the last event, and by a new document', () => {
    applyTemplate(healthyScenario(t0()));
    clearEvents();
    expect(healthyRun.value).toBe(false);
    expect(trace.value).toBeNull();
    applyTemplate(healthyScenario(t0()));
    resetHistory(classicDoc());
    expect(healthyRun.value).toBe(false);
    expect(trace.value).toBeNull();
  });

  it('shows on the rail as an empty list that says everything is working', async () => {
    applyTemplate(healthyScenario(t0()));
    const root = mount(BreakRail);
    await tick();
    expect(root.textContent).toContain('No events — everything is working');
  });
});

describe('the event list', () => {
  it('is empty, and says something true, until something is injected', async () => {
    const root = mount(BreakRail);
    await tick();
    expect(root.textContent).toContain('No events yet');
    /* The scenarios sit under the list now, so the empty state points down. */
    expect(root.textContent).toContain('Choose a starting scenario');
    expect(root.textContent).not.toContain('Pick a scenario above');
  });

  it('names every event in the vocabulary of the menu', () => {
    const t = doc.value.topology;
    applyTemplate(byId(t, 'crash')!);
    const e = doc.value.topology.events[0]!;
    expect(describeEvent(t, e)).toBe('Crash dc1-prm01');
  });

  it('moves an event on the clock and takes one out', () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    setEventTime(0, 12.5);
    expect(doc.value.topology.events[0]?.at).toBe(12.5);
    removeEventAt(0);
    expect(doc.value.topology.events).toHaveLength(0);
  });

  it('renders one editable time per event', async () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    const root = mount(BreakRail);
    await tick();
    const inputs = root.querySelectorAll<HTMLInputElement>('.evt-at input');
    expect(inputs).toHaveLength(1);
    inputs[0]!.value = '7';
    inputs[0]!.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(doc.value.topology.events[0]?.at).toBe(7);
  });

  it('clears in one undo step', () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    clearEvents();
    expect(doc.value.topology.events).toHaveLength(0);
    undo();
    expect(doc.value.topology.events).toHaveLength(1);
  });

  it('writes no inline style', async () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    const root = mount(BreakRail);
    await tick();
    for (const el of root.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
  });
});

describe('the order of the rail', () => {
  const eyebrows = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('.eyebrow')].map((e) => e.textContent ?? '');

  it('puts scheduled events before validation', async () => {
    const root = mount(BreakRail);
    await tick();
    expect(eyebrows(root)).toEqual(['Events', 'Validation']);
  });

  it('counts the scheduled events without repeating the template shelf', async () => {
    applyTemplate(byId(doc.value.topology, 'isolated')!);
    const root = mount(BreakRail);
    await tick();
    expect(eyebrows(root)).toEqual(['Events (2)', 'Validation']);
    expect(root.querySelectorAll('.evt')).toHaveLength(2);
    expect(root.querySelector('.tmpl')).toBeNull();
  });
});

describe('the canvas menu', () => {
  it('offers a card the actions its own kind has', () => {
    const t = doc.value.topology;
    const ids = actionsFor(t, ['prm01'], 0).map((a) => a.id);
    expect(ids).toContain('host.down');
    expect(ids).toContain('site.down');
    expect(ids).toContain('member.down');
    /* The primary is not a failover target of itself. */
    expect(ids).not.toContain('cmd.switchover');
    expect(actionsFor(t, ['sby01'], 0).map((a) => a.id)).toContain('cmd.switchover');
  });

  it('greys a restore nothing has taken down, with the reason on it', () => {
    const t = doc.value.topology;
    const restore = actionsFor(t, ['prm01'], 0).find((a) => a.id === 'host.up');
    expect(restore?.enabled).toEqual({ state: 'off', why: WHY.nothingDown });
  });

  it('offers the restore once the host is down, and not the crash', () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    const t = doc.value.topology;
    expect(isDownAt(t, { kind: 'host', id: 'dc1-prm01' }, 1)).toBe(true);
    const acts = actionsFor(t, ['prm01'], 5);
    expect(acts.find((a) => a.id === 'host.up')?.enabled).toEqual({ state: 'on' });
    expect(acts.find((a) => a.id === 'host.down')?.enabled).toEqual({
      state: 'off', why: WHY.alreadyDown,
    });
  });

  it('injects at the playhead, in one undo step', () => {
    const act = actionsFor(doc.value.topology, ['prm01'], 12)
      .find((a) => a.id === 'host.down');
    runAction(act!);
    expect(doc.value.topology.events).toEqual([{ at: 12, kind: 'host.down', host: 'dc1-prm01' }]);
    undo();
    expect(doc.value.topology.events).toHaveLength(0);
  });

  it('takes the intersection of a multiple selection', () => {
    const t = doc.value.topology;
    const both = actionsFor(t, ['prm01', 'sby01'], 0);
    const ids = both.map((a) => a.id);
    expect(ids).toContain('host.down');
    expect(ids).not.toContain('cmd.switchover');
    const crash = both.find((a) => a.id === 'host.down');
    expect(crash?.events).toHaveLength(2);
    expect(crash?.label).toContain('(2)');
  });

  it('keeps a property change out of the timed list, and labels it', () => {
    const acts = actionsFor(doc.value.topology, ['sby01'], 0);
    const apply = acts.find((a) => a.id === 'apply.toggle');
    expect(apply?.property).toBe(true);
    runAction(apply!);
    expect(doc.value.topology.events).toHaveLength(0);
    const sby = doc.value.topology.members.find((m) => (m.id as string) === 'sby01');
    expect(sby && 'applyRunning' in sby ? sby.applyRunning : true).toBe(false);
  });

  it('offers nothing for nothing selected', () => {
    expect(barOf([])).toEqual({ actions: [], quiet: null, sections: [] });
  });

  it('lists the selected card actions, grouped', () => {
    const labels = labelsOf(['sby01']);
    expect(labels.some((l) => l.startsWith('Crash'))).toBe(true);
    expect(labels.some((l) => l.includes('SWITCHOVER TO sby01'))).toBe(true);
    expect(barOf(['sby01']).sections.length).toBeGreaterThan(1);
  });
});

/**
 * The engine now refuses a SWITCHOVER TO a down target or with the primary
 * down, refuses a FAILOVER TO a down target, and draws no reinstatement where
 * its preconditions fail. The menu used to offer all three unconditionally;
 * each now carries the same reading the run itself acts on.
 */
describe('SWITCHOVER, FAILOVER and REINSTATE say why they are off', () => {
  it('SWITCHOVER is off while the target is down, and on again once it is restored', () => {
    inject([{ at: 0, kind: 'host.down', host: 'dc2-sby01' }]);
    expect(actionsFor(doc.value.topology, ['sby01'], 0).find((a) => a.id === 'cmd.switchover')?.enabled)
      .toEqual({ state: 'off', why: WHY.switchoverTargetDown });
    inject([]);
    expect(actionsFor(doc.value.topology, ['sby01'], 0).find((a) => a.id === 'cmd.switchover')?.enabled)
      .toEqual({ state: 'on' });
  });

  it('SWITCHOVER is off while the primary is down', () => {
    inject([{ at: 0, kind: 'host.down', host: 'dc1-prm01' }]);
    expect(actionsFor(doc.value.topology, ['sby01'], 0).find((a) => a.id === 'cmd.switchover')?.enabled)
      .toEqual({ state: 'off', why: WHY.switchoverPrimaryDown });
  });

  it('FAILOVER is off while the target is down, but not while the primary is', () => {
    inject([{ at: 0, kind: 'host.down', host: 'dc2-sby01' }]);
    expect(actionsFor(doc.value.topology, ['sby01'], 0).find((a) => a.id === 'cmd.failover')?.enabled)
      .toEqual({ state: 'off', why: WHY.failoverTargetDown });
    inject([{ at: 0, kind: 'host.down', host: 'dc1-prm01' }]);
    expect(actionsFor(doc.value.topology, ['sby01'], 0).find((a) => a.id === 'cmd.failover')?.enabled)
      .toEqual({ state: 'on' });
  });

  it('REINSTATE DATABASE is off for the current primary and for a standby that never held the role', () => {
    const t = doc.value.topology;
    expect(actionsFor(t, ['prm01'], 0).find((a) => a.id === 'cmd.reinstate')?.enabled)
      .toEqual({ state: 'off', why: WHY.notFormerPrimary });
    expect(actionsFor(t, ['sby01'], 0).find((a) => a.id === 'cmd.reinstate')?.enabled)
      .toEqual({ state: 'off', why: WHY.notFormerPrimary });
  });

  it('REINSTATE DATABASE turns on for the primary a failover left behind, and stays off for the new primary', () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    /* The published scenario's failover is open by t = 55 (see
       sim-fact-check.test.ts's ED-01/SIM-03 readings of the same threshold). */
    const acts = actionsFor(doc.value.topology, ['prm01'], 60);
    expect(acts.find((a) => a.id === 'cmd.reinstate')?.enabled).toEqual({ state: 'on' });
    expect(actionsFor(doc.value.topology, ['sby01'], 60).find((a) => a.id === 'cmd.reinstate')?.enabled)
      .toEqual({ state: 'off', why: WHY.notFormerPrimary });
  });
});

/**
 * Events land at the playhead, and the bar's header says so: `at t = 12 s`,
 * the same tenth of a second the rail's transport reads. There is no field of
 * its own to set it -- the transport's time box is the one clock.
 */
describe('an event lands at the playhead', () => {
  it('injects at the time the playhead was showing, then rests it on the result', () => {
    tNow.value = 12;
    rowNamed(['prm01'], 'Crash')!.run();
    /* The event kept the time the header was showing... */
    expect(doc.value.topology.events).toEqual([{ at: 12, kind: 'host.down', host: 'dc1-prm01' }]);
    /* ...and the playhead moved past it, to where there is something to see. */
    expect(tNow.value).toBeGreaterThan(12);
  });

  it('snaps the time to a tenth of a second', () => {
    tNow.value = 12.34;
    rowNamed(['prm01'], 'Crash')!.run();
    expect(doc.value.topology.events).toEqual([{ at: 12.3, kind: 'host.down', host: 'dc1-prm01' }]);
  });
});

/**
 * Three copies of NOTHING HAS TAKEN IT DOWN, SO THERE IS NOTHING TO RESTORE
 * was the loudest text on the drawing. The reason is said once, and the
 * entries it would have been pinned to are absent from the document -- not
 * hidden by a rule.
 */
describe('restores nothing has taken down', () => {
  it('are not listed, and one quiet line says why', () => {
    const labels = labelsOf(['prm01']);
    expect(labels.some((l) => l.startsWith('Restore'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Bring '))).toBe(false);
    expect(labels.some((l) => l === 'Start prm01')).toBe(false);
    expect(quietOf(['prm01'])).toBe('Nothing to restore — nothing here is down.');
    expect(refusals(['prm01'])).not.toContain(WHY.nothingDown);
  });

  it('come back, live, once something is down', () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    tNow.value = 5;
    const restore = rowNamed(['prm01'], 'Restore the host');
    expect(restore).not.toBeUndefined();
    expect(restore!.enabled.state).toBe('on');
    /* The host is back on the list, the site is not -- and the line under it
       says the second thing rather than repeating the first one's refusal. */
    expect(quietOf(['prm01'])).toBe('The other restores are not listed — nothing else here is down.');
    expect(refusals(['prm01'])).not.toContain(WHY.nothingDown);
  });

  /* The observer's restore refused in its own register -- "It is running
     already." -- so it escaped the group the reason is said once for, and a
     grey restore was drawn directly above the line that stands in for it. */
  it('include the observer, which said the same thing in different words', () => {
    const labels = labelsOf(['obs01']);
    expect(labels.some((l) => l.startsWith('Start the observer'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Restore dc3-obs01'))).toBe(false);
    expect(refusals(['obs01']).join(' ')).not.toContain('running already');
    expect(quietOf(['obs01'])).toBe('Nothing to restore — nothing here is down.');
  });

  it('come back for the observer once its host is gone', () => {
    inject([{ at: 0, kind: 'host.down', host: 'dc3-obs01' }]);
    tNow.value = 5;
    expect(rowNamed(['obs01'], 'Restore dc3-obs01')?.enabled.state).toBe('on');
    /* Starting the observer on a host that is not there draws nothing, so it
       is grey with the host named -- not dropped, because it *is* down. */
    const start = rowNamed(['obs01'], 'Start the observer');
    expect(start?.enabled.state).toBe('off');
    expect(refusals(['obs01'])).toContain('dc3-obs01 is down: restore the host first.');
    expect(quietOf(['obs01'])).toBeNull();
  });
});

/**
 * The quiet line is the table's, not a surface's.
 *
 * Two surfaces offer the same actions and drop the same restores -- the bar on
 * the drawing and Lanes' More menu -- and a sentence written twice is a
 * sentence that can come to differ. `restoreQuietLine` is what both print, so
 * this asserts exactly that: for the same selection at the same moment, the
 * string the bar carries is the table's.
 */
describe('restoreQuietLine is what the bar prints', () => {
  const line = (keys: string[]): string | null => {
    const t = doc.value.topology;
    return restoreQuietLine(t, keys, tNow.value, actionsFor(t, keys, tNow.value));
  };

  it('agrees on every branch of the sentence', () => {
    /* Nothing down; one host down inside a data centre that is up; a whole
       site down, where no restore is dropped at all; and a pair of links of
       which only one is cut. */
    expect(quietOf(['prm01'])).toBe(line(['prm01']));

    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    tNow.value = 12;
    expect(quietOf(['prm01'])).toBe(line(['prm01']));
    expect(quietOf(['dc1'])).toBe(line(['dc1']));

    inject([{ at: 5, kind: 'site.down', site: 'dc1' }]);
    expect(quietOf(['prm01'])).toBe(line(['prm01']));
    /* Nothing was dropped there, so both say nothing rather than nothing much. */
    expect(line(['prm01'])).toBeNull();

    inject([{ at: 0, kind: 'link.cut', link: 'dc1-dc2' }]);
    tNow.value = 10;
    expect(quietOf(['dc1-dc2', 'dc1-dc3'])).toBe(line(['dc1-dc2', 'dc1-dc3']));
    expect(line(['dc1-dc2', 'dc1-dc3'])).toContain('only part of this selection is down');
  });
});

/**
 * The one sentence in this application that must never be able to be wrong.
 *
 * "Nothing here is down" stands in a place where a column of refusals used to
 * be, one line under a drawing that says what is down. It was read off the
 * event *kinds* -- so crashing a host left the database it runs looking up --
 * and off the *intersected* list -- so one cut link beside a whole one made
 * the pair's restore say "nothing has taken it down". Both printed the
 * sentence over a drawing that contradicted it.
 */
describe('the quiet line and the drawing say the same thing', () => {
  /* The classic deployment: prm01 on dc1-prm01 in dc1, sby01 in dc2, obs01 in dc3. */
  const quiet = (keys: string[]): string => quietOf(keys) ?? '';

  it('reads a crashed host as the database on it being down, like the canvas does', () => {
    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    const t = doc.value.topology;
    expect(isDownAt(t, { kind: 'member', id: 'prm01' }, 12)).toBe(true);
    /* Which is what the simulator the card is drawn from says too. */
    expect(membersAt(12)['prm01']).toBe('down');
    /* The data centre is not down, though: crashing one host is not losing dc1. */
    expect(isDownAt(t, { kind: 'site', id: 'dc1' }, 12)).toBe(false);
  });

  it('keeps "Start prm01" on the list while the host it runs on is down', () => {
    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    tNow.value = 12;
    const start = rowsOf(['prm01']).find((a) => a.label === 'Start prm01');
    /* It is down, so it is not in the "nothing has taken it down" group; it is
       grey because restoring it first would inject an event that draws
       nothing, and it names what to bring back instead. */
    expect(start).not.toBeUndefined();
    expect(start!.enabled.state).toBe('off');
    expect(refusals(['prm01'])).toContain('dc1-prm01 is down: restore the host first.');
    expect(refusals(['prm01'])).not.toContain(WHY.nothingDown);
    /* Only the site restore was dropped, and the site really is up. */
    expect(quiet(['prm01'])).toBe('The other restores are not listed — nothing else here is down.');
  });

  it('offers no crash and no lie inside a data centre that is down', () => {
    inject([{ at: 5, kind: 'site.down', site: 'dc1' }]);
    tNow.value = 12;
    expect(rowNamed(['prm01'], 'Crash dc1-prm01')?.enabled.state).toBe('off');
    expect(rowsOf(['prm01']).find((a) => a.label === 'Bring dc1 back')?.enabled.state).toBe('on');
    expect(refusals(['prm01'])).toContain('DC 1 is down: bring the whole data centre back first.');
    /* Everything here is down, so no restore was dropped and there is no line. */
    expect(quiet(['prm01'])).toBe('');
  });

  it('does not claim a data centre is clear when a host inside it is down', () => {
    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    tNow.value = 12;
    expect(anythingDownUnder(doc.value.topology, 'dc1', 12)).toBe(true);
    expect(quiet(['dc1'])).not.toContain('nothing here is down');
    expect(quiet(['dc1'])).toContain('what is down sits inside it');
  });

  it('does not claim nothing is down when only part of the selection is', () => {
    inject([{ at: 0, kind: 'link.cut', link: 'dc1-dc2' }]);
    tNow.value = 10;
    /* The intersection collapsed the pair's restore to "nothing has taken it
       down" -- true of the pair, false of dc1-dc2, which is drawn cut. */
    const heal = actionsFor(doc.value.topology, ['dc1-dc2', 'dc1-dc3'], 10)
      .find((a) => a.id === 'link.heal');
    expect(heal?.enabled).toEqual({ state: 'off', why: WHY.nothingDown });
    expect(quiet(['dc1-dc2', 'dc1-dc3'])).not.toContain('nothing here is down');
    expect(quiet(['dc1-dc2', 'dc1-dc3'])).toContain('only part of this selection is down');
  });

  /**
   * The sweep: whatever is selected, the absolute claim is never printed while
   * the simulator the drawing is made from has something under that selection
   * down.
   */
  const keys = ['prm01', 'sby01', 'dc1', 'dc2', 'dc3', 'obs01', 'dc1-dc2'];
  const membersUnder = (t: TopologyDoc, key: string): string[] => t.members
    .filter((m) => (m.id as string) === key
      || m.instances.some((i) => (t.hosts.find((h) => h.id === i.host)?.site as string) === key))
    .map((m) => m.id as string);

  for (const [name, evt] of [
    ['a crashed host', { at: 5, kind: 'host.down', host: 'dc1-prm01' }],
    ['a lost data centre', { at: 5, kind: 'site.down', site: 'dc1' }],
  ] as [string, unknown][]) {
    it(`never says "nothing here is down" after ${name}`, () => {
      const checked: string[] = [];
      for (const key of keys) {
        inject([evt]);
        tNow.value = 12;
        const down = membersUnder(doc.value.topology, key).some((m) => membersAt(12)[m] === 'down');
        if (!down) continue;
        checked.push(key);
        expect(`${key}: ${quiet([key])}`).not.toContain('Nothing to restore');
        expect(`${key}: ${quiet([key])}`).not.toContain('nothing here is down');
      }
      /* The sweep is worthless if it never reached the branch: the database and
         the data centre holding it are both down under this event. */
      expect(checked).toEqual(['prm01', 'dc1']);
    });
  }
});

/**
 * At t = 0 the drawing shows the instant before anything happened while the
 * readout beside it reports the whole run. Injecting now moves the playhead to
 * the end of what there is to see, so the drawing shows the result and
 * scrubbing back is the exploration.
 */
describe('the playhead after an injection', () => {
  it('rests at the end of the run a template sets up', () => {
    tNow.value = 0;
    applyTemplate(byId(doc.value.topology, 'crash')!);
    /* The classic crash opens the new primary at 45 s (engine matrix). */
    expect(tNow.value).toBeGreaterThan(40);
  });

  it('goes back to the start when the events are cleared', () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    expect(tNow.value).toBeGreaterThan(0);
    clearEvents();
    expect(tNow.value).toBe(0);
  });

  it('stays put for a property change, which lands nowhere on the clock', () => {
    tNow.value = 7;
    const apply = actionsFor(doc.value.topology, ['sby01'], 7).find((a) => a.id === 'apply.toggle');
    runAction(apply!);
    expect(tNow.value).toBe(7);
  });
});

const icons = (key: string, at = 0): string[] =>
  hoverTools(doc.value.topology, key, at).map((t) => `${t.icon}:${t.enabled.state}`);

describe('the hover icons', () => {
  it('offers crash and isolate on a data centre, shutdown on a database, cut on a line', () => {
    expect(icons('dc1')).toEqual(['crash:on', 'isolate:on']);
    expect(icons('prm01')).toEqual(['shutdown:on', 'crash:on']);
    expect(icons('obs01')).toEqual(['stop:on', 'crash:on']);
    expect(icons('dc1-dc2')).toEqual(['cut:on']);
  });

  it('isolating cuts every link of the data centre, and the icon turns into reconnect', () => {
    hoverTools(doc.value.topology, 'dc1', 0).find((t) => t.icon === 'isolate')!.run();
    const cuts = doc.value.topology.events.filter((e) => e.kind === 'link.cut');
    expect(cuts.map((e) => (e as { link: string }).link).sort()).toEqual(['dc1-dc2', 'dc1-dc3']);
    expect(icons('dc1')).toEqual(['crash:on', 'reconnect:on']);
    expect(icons('dc1-dc2')).toEqual(['heal:on']);
  });

  it('turns a shut-down database into a start, one undo', () => {
    hoverTools(doc.value.topology, 'prm01', 0).find((t) => t.icon === 'shutdown')!.run();
    expect(kinds(doc.value.topology.events)).toEqual(['member.down']);
    expect(icons('prm01')).toEqual(['startup:on', 'crash:on']);
    undo();
    expect(doc.value.topology.events).toHaveLength(0);
  });

  it('draws a refused icon grey rather than dropping it', () => {
    inject([{ at: 0, kind: 'site.down', site: 'dc1' }]);
    /* The host is held down by its data centre: its restore says so. */
    expect(icons('prm01')).toContain('startup:off');
  });
});

describe('the hover icons follow the run, not only the events', () => {
  it('turns a primary the broker aborted into a grey start, with the reason', () => {
    applyTemplate(byId(doc.value.topology, 'isolated')!);
    const abortAt = [...Array(1200).keys()].map((i) => i / 10)
      .find((t) => membersAt(t)['prm01'] === 'aborted');
    expect(abortAt).toBeDefined();
    expect(icons('prm01', 0)).toEqual(['shutdown:on', 'crash:on']);
    const late = hoverTools(doc.value.topology, 'prm01', abortAt! + 1);
    expect(late.map((t) => `${t.icon}:${t.enabled.state}`)).toEqual(['startup:off', 'crash:on']);
    const why = late[0]!.enabled;
    expect(why.state === 'off' && why.why).toBe(NO_RESTART_AFTER_ABORT);
  });
});
