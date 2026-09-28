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
import { trace } from '@/state/derived';
import { edit, resetHistory, undo } from '@/state/history';
import { clearSelection, hintsOn, mode, selection, tNow, viewport } from '@/state/view';
import { BreakRail, scenarioNotesOpen } from '@/ui/break/BreakRail';
import { EventMenu, menuOpen } from '@/ui/canvas/EventMenu';
import {
  actionsFor, anythingDownUnder, applyTemplate, clearEvents, describeEvent, hoverTools, isDownAt, NO_RESTART_AFTER_ABORT,
  removeEventAt, restoreQuietLine, runAction, setEventTime, templates,
} from '@/ui/break/events';
import { WHY } from '@/ui/inspector/why';
import { DEFAULT_OPEN, openSections, SCENARIOS_ID } from '@/ui/inspector/sections';
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
  menuOpen.value = true;
  scenarioNotesOpen.value = false;
  openSections.value = new Set<string>([DEFAULT_OPEN]);
  hintsOn.value = false;
  clearSelection();
});

/** Unfold the scenarios, which start folded. */
const openScenarios = (): void => { openSections.value = new Set<string>([DEFAULT_OPEN, SCENARIOS_ID]); };

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

describe('the event list', () => {
  it('is empty, and says something true, until something is injected', async () => {
    const root = mount(BreakRail);
    await tick();
    expect(root.textContent).toContain('No events yet');
    /* The scenarios sit under the list now, so the empty state points down. */
    expect(root.textContent).toContain('Pick a scenario below');
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

  it('puts the reader own work first: events, then scenarios, then validation', async () => {
    const root = mount(BreakRail);
    await tick();
    expect(eyebrows(root)).toEqual(['Events', 'One-click scenarios', 'Validation']);
  });

  it('counts the injected events in the eyebrow, above the scenarios', async () => {
    openScenarios();
    applyTemplate(byId(doc.value.topology, 'isolated')!);
    const root = mount(BreakRail);
    await tick();
    expect(eyebrows(root)).toEqual(['Events (2)', 'Why this result?', 'One-click scenarios', 'Validation']);
    /* Every event row is drawn before the first scenario row. */
    const nodes = [...root.querySelectorAll('.evt, .tmpl')];
    const firstTmpl = nodes.findIndex((n) => n.classList.contains('tmpl'));
    expect(nodes.slice(0, firstTmpl).every((n) => n.classList.contains('evt'))).toBe(true);
    expect(firstTmpl).toBe(2);
  });
});

describe('the scenario fold', () => {
  it('starts folded: the six names are absent until the toggle is pressed', async () => {
    const root = mount(BreakRail);
    await tick();
    expect(root.querySelectorAll('.tmpl')).toHaveLength(0);
    const tog = [...root.querySelectorAll<HTMLButtonElement>('button.grp-tog')]
      .find((b) => b.textContent?.includes('One-click scenarios'))!;
    expect(tog.getAttribute('aria-expanded')).toBe('false');
    tog.click();
    await tick();
    expect(root.querySelectorAll('.tmpl')).toHaveLength(templates(doc.value.topology, 0).length);
  });
});

describe('the scenario descriptions', () => {
  beforeEach(openScenarios);

  it('is a shelf of names, with every sentence one press away', async () => {
    const root = mount(BreakRail);
    await tick();
    const rows = [...root.querySelectorAll('.tmpl')];
    expect(rows).toHaveLength(templates(doc.value.topology, 0).length);
    for (const [i, row] of rows.entries()) {
      const caption = templates(doc.value.topology, 0)[i]!.caption;
      /* Closed, the description is genuinely absent rather than clipped by a
         CSS rule -- and the sentence still rides on the button it belongs to,
         so a reader who hovers one row does not have to open all six. */
      expect(row.querySelector('.tmpl-cap')).toBeNull();
      expect(row.querySelector('button')?.getAttribute('title')).toBe(caption);
    }

    root.querySelector<HTMLButtonElement>('button.tmpl-tog')!.click();
    await tick();
    for (const [i, row] of [...root.querySelectorAll('.tmpl')].entries()) {
      const caption = templates(doc.value.topology, 0)[i]!.caption;
      const txt = row.querySelector('.tmpl-cap');
      expect(txt?.textContent).toBe(caption);
      expect(txt?.getAttribute('title')).toBe(caption);
    }
  });

  it('renders every description on paper, where there is no toggle to press', async () => {
    printing.value = true;
    try {
      const root = mount(BreakRail);
      await tick();
      const caps = [...root.querySelectorAll('.tmpl-cap')].map((el) => el.textContent);
      expect(caps).toEqual(templates(doc.value.topology, 0).map((t) => t.caption));
    } finally {
      printing.value = false;
    }
  });

  it('opens all six from one real toggle that says whether it is open', async () => {
    const root = mount(BreakRail);
    await tick();
    const tog = root.querySelector<HTMLButtonElement>('button.tmpl-tog');
    expect(tog).not.toBeNull();
    expect(tog!.tagName).toBe('BUTTON');
    expect(tog!.textContent).toContain('Show descriptions');
    expect(tog!.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.tmpls.is-open')).toBeNull();

    tog!.click();
    await tick();
    expect(root.querySelector<HTMLButtonElement>('button.tmpl-tog')!
      .getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.tmpls.is-open')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('button.tmpl-tog')!.click();
    await tick();
    expect(root.querySelector('.tmpls.is-open')).toBeNull();
  });

  it('says the replace rule once, quietly, under the eyebrow -- with hints on', async () => {
    /* Explanation, so it is not on screen by default: the reader asks for it
       with `Hints`, and then it is exactly where it always was. */
    expect(mount(BreakRail).querySelectorAll('.tmpl-lede')).toHaveLength(0);
    hintsOn.value = true;
    const root = mount(BreakRail);
    await tick();
    const lede = root.querySelectorAll('.tmpl-lede');
    expect(lede).toHaveLength(1);
    expect(lede[0]!.textContent).toContain('replaces the current events');
    expect(root.querySelector('.tmpls')!.previousElementSibling).toBe(lede[0]!);
  });

  it('still greys a scenario it cannot run, with the reason beside it', async () => {
    viewport.value = 'narrow';
    const root = mount(BreakRail);
    await tick();
    const row = root.querySelector('.tmpl')!;
    expect(row.querySelector('button')!.disabled).toBe(true);
    expect(row.querySelector('.why')?.textContent).toBe(WHY.readOnlyHere);
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

  it('says what to do when nothing is selected, and keeps its own button when shut', async () => {
    const root = mount(EventMenu);
    await tick();
    expect(root.textContent).toContain('Select a card');
    menuOpen.value = false;
    await tick();
    expect(root.querySelector('.evmenu.is-shut')).not.toBeNull();
    expect(root.textContent).toContain('Actions');
  });

  it('lists the selected card actions, each with a real button', async () => {
    selection.value = ['sby01'];
    const root = mount(EventMenu);
    await tick();
    const labels = [...root.querySelectorAll('.evmenu-row button')].map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.startsWith('Crash'))).toBe(true);
    expect(labels.some((l) => l.includes('SWITCHOVER TO sby01'))).toBe(true);
    for (const el of root.querySelectorAll('*')) expect(el.getAttribute('style')).toBeNull();
  });
});

/**
 * The menu injects at the playhead, and until it said so the header's
 * "Inject at t = 0 s" read as a property of the menu rather than as a reading
 * of where the playhead happened to be.
 */
describe('the menu says where an event will land', () => {
  it('leads with the injection time and the sentence behind it', async () => {
    selection.value = ['prm01'];
    tNow.value = 40;
    const root = mount(EventMenu);
    await tick();
    const title = root.querySelector('.evmenu-title')?.textContent ?? '';
    /* The clock reading is the fact, and it is in the header at every
       setting; the sentence that spells it out is a hint. */
    expect(title).toContain('Inject at t =');
    expect(root.textContent).not.toContain('New events use the playhead time');

    hintsOn.value = true;
    const withHints = mount(EventMenu);
    await tick();
    expect(withHints.textContent).toContain('New events use the playhead time');
  });

  it('makes the clock reading the control, and moving it moves the playhead', async () => {
    selection.value = ['prm01'];
    const root = mount(EventMenu);
    await tick();
    const at = root.querySelector<HTMLInputElement>('.evmenu-at');
    expect(at).not.toBeNull();
    expect(at!.value).toBe('0');
    at!.value = '12.5';
    at!.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(tNow.value).toBe(12.5);
    expect(root.querySelector<HTMLInputElement>('.evmenu-at')?.value).toBe('12.5');
  });

  it('refuses a negative injection time rather than clamping the drawing to it', async () => {
    selection.value = ['prm01'];
    const root = mount(EventMenu);
    await tick();
    const at = root.querySelector<HTMLInputElement>('.evmenu-at')!;
    at.value = '-9';
    at.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(tNow.value).toBe(0);
  });

  it('injects at the time the menu was showing, then rests the playhead on the result', async () => {
    selection.value = ['prm01'];
    tNow.value = 12;
    const root = mount(EventMenu);
    await tick();
    const crash = [...root.querySelectorAll<HTMLButtonElement>('.evmenu-row button')]
      .find((b) => (b.textContent ?? '').startsWith('Crash'))!;
    crash.click();
    await tick();
    /* The event kept the time the header was showing... */
    expect(doc.value.topology.events).toEqual([{ at: 12, kind: 'host.down', host: 'dc1-prm01' }]);
    /* ...and the playhead moved past it, to where there is something to see. */
    expect(tNow.value).toBeGreaterThan(12);
  });
});

/**
 * Three copies of NOTHING HAS TAKEN IT DOWN, SO THERE IS NOTHING TO RESTORE
 * was the loudest text on the drawing. The reason is said once, and the
 * entries it would have been pinned to are absent from the document -- not
 * hidden by a rule.
 */
describe('restores nothing has taken down', () => {
  it('are not rendered, and one quiet line says why', async () => {
    selection.value = ['prm01'];
    const root = mount(EventMenu);
    await tick();
    const labels = [...root.querySelectorAll('.evmenu-row button')].map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.startsWith('Restore'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Bring '))).toBe(false);
    expect(labels.some((l) => l === 'Start prm01')).toBe(false);
    const quiet = root.querySelectorAll('.evmenu-quiet');
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.textContent).toBe('Nothing to restore — nothing here is down.');
    expect(root.textContent).not.toContain(WHY.nothingDown);
  });

  it('come back, live, once something is down', async () => {
    applyTemplate(byId(doc.value.topology, 'crash')!);
    tNow.value = 5;
    selection.value = ['prm01'];
    const root = mount(EventMenu);
    await tick();
    const restore = [...root.querySelectorAll<HTMLButtonElement>('.evmenu-row button')]
      .find((b) => (b.textContent ?? '').startsWith('Restore the host'));
    expect(restore).not.toBeUndefined();
    expect(restore!.disabled).toBe(false);
    /* The host is back on the list, the site is not -- and the line under it
       says the second thing rather than repeating the first one's refusal. */
    const quiet = root.querySelectorAll('.evmenu-quiet');
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.textContent).toBe('The other restores are not listed — nothing else here is down.');
    expect(root.textContent).not.toContain(WHY.nothingDown);
  });

  /* The observer's restore refused in its own register -- "It is running
     already." -- so it escaped the group the reason is said once for, and a
     grey restore was drawn directly above the line that stands in for it. */
  it('include the observer, which said the same thing in different words', async () => {
    selection.value = ['obs01'];
    const root = mount(EventMenu);
    await tick();
    const labels = [...root.querySelectorAll('.evmenu-row button')].map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.startsWith('Start the observer'))).toBe(false);
    expect(labels.some((l) => l.startsWith('Restore dc3-obs01'))).toBe(false);
    expect(root.textContent).not.toContain('running already');
    const quiet = root.querySelectorAll('.evmenu-quiet');
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.textContent).toBe('Nothing to restore — nothing here is down.');
  });

  it('come back for the observer once its host is gone', async () => {
    inject([{ at: 0, kind: 'host.down', host: 'dc3-obs01' }]);
    tNow.value = 5;
    selection.value = ['obs01'];
    const root = mount(EventMenu);
    await tick();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.evmenu-row button')];
    expect(buttons.find((b) => (b.textContent ?? '').startsWith('Restore dc3-obs01'))?.disabled)
      .toBe(false);
    /* Starting the observer on a host that is not there draws nothing, so it
       is grey with the host named -- not dropped, because it *is* down. */
    const start = buttons.find((b) => (b.textContent ?? '').startsWith('Start the observer'));
    expect(start?.disabled).toBe(true);
    expect(root.textContent).toContain('dc3-obs01 is down: restore the host first.');
    expect(root.querySelectorAll('.evmenu-quiet')).toHaveLength(0);
  });
});

/**
 * The quiet line is the table's, not the menu's.
 *
 * A second surface -- the bar on the drawing -- offers the same actions and
 * drops the same restores, and a sentence written twice is a sentence that can
 * come to differ. `restoreQuietLine` is what the menu prints, so this asserts
 * exactly that: for the same selection at the same moment, the string and the
 * paragraph are the same thing.
 */
describe('restoreQuietLine is what the menu prints', () => {
  const printed = async (keys: string[]): Promise<string | null> => {
    selection.value = keys;
    const root = mount(EventMenu);
    await tick();
    const q = root.querySelectorAll('.evmenu-quiet');
    expect(q.length).toBeLessThanOrEqual(1);
    return q[0]?.textContent ?? null;
  };

  const line = (keys: string[]): string | null => {
    const t = doc.value.topology;
    return restoreQuietLine(t, keys, tNow.value, actionsFor(t, keys, tNow.value));
  };

  it('agrees on every branch of the sentence', async () => {
    /* Nothing down; one host down inside a data centre that is up; a whole
       site down, where no restore is dropped at all; and a pair of links of
       which only one is cut. */
    expect(await printed(['prm01'])).toBe(line(['prm01']));

    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    tNow.value = 12;
    expect(await printed(['prm01'])).toBe(line(['prm01']));
    expect(await printed(['dc1'])).toBe(line(['dc1']));

    inject([{ at: 5, kind: 'site.down', site: 'dc1' }]);
    expect(await printed(['prm01'])).toBe(line(['prm01']));
    /* Nothing was dropped there, so both say nothing rather than nothing much. */
    expect(line(['prm01'])).toBeNull();

    inject([{ at: 0, kind: 'link.cut', link: 'dc1-dc2' }]);
    tNow.value = 10;
    expect(await printed(['dc1-dc2', 'dc1-dc3'])).toBe(line(['dc1-dc2', 'dc1-dc3']));
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
  const quietOf = (root: HTMLElement): string => {
    const q = root.querySelectorAll('.evmenu-quiet');
    expect(q.length).toBeLessThanOrEqual(1);
    return q[0]?.textContent ?? '';
  };

  it('reads a crashed host as the database on it being down, like the canvas does', () => {
    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    const t = doc.value.topology;
    expect(isDownAt(t, { kind: 'member', id: 'prm01' }, 12)).toBe(true);
    /* Which is what the simulator the card is drawn from says too. */
    expect(membersAt(12)['prm01']).toBe('down');
    /* The data centre is not down, though: crashing one host is not losing dc1. */
    expect(isDownAt(t, { kind: 'site', id: 'dc1' }, 12)).toBe(false);
  });

  it('keeps "Start prm01" on the list while the host it runs on is down', async () => {
    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    tNow.value = 12;
    selection.value = ['prm01'];
    const root = mount(EventMenu);
    await tick();
    const start = [...root.querySelectorAll<HTMLButtonElement>('.evmenu-row button')]
      .find((b) => (b.textContent ?? '') === 'Start prm01');
    /* It is down, so it is not in the "nothing has taken it down" group; it is
       grey because restoring it first would inject an event that draws
       nothing, and it names what to bring back instead. */
    expect(start).not.toBeUndefined();
    expect(start!.disabled).toBe(true);
    expect(root.textContent).toContain('dc1-prm01 is down: restore the host first.');
    expect(root.textContent).not.toContain(WHY.nothingDown);
    /* Only the site restore was dropped, and the site really is up. */
    expect(quietOf(root)).toBe('The other restores are not listed — nothing else here is down.');
  });

  it('offers no crash and no lie inside a data centre that is down', async () => {
    inject([{ at: 5, kind: 'site.down', site: 'dc1' }]);
    tNow.value = 12;
    selection.value = ['prm01'];
    const root = mount(EventMenu);
    await tick();
    const labels = [...root.querySelectorAll<HTMLButtonElement>('.evmenu-row button')];
    const crash = labels.find((b) => (b.textContent ?? '').startsWith('Crash dc1-prm01'));
    expect(crash?.disabled).toBe(true);
    const back = labels.find((b) => (b.textContent ?? '') === 'Bring dc1 back');
    expect(back?.disabled).toBe(false);
    expect(root.textContent).toContain('DC 1 is down: bring the whole data centre back first.');
    /* Everything here is down, so no restore was dropped and there is no line. */
    expect(quietOf(root)).toBe('');
  });

  it('does not claim a data centre is clear when a host inside it is down', async () => {
    inject([{ at: 5, kind: 'host.down', host: 'dc1-prm01' }]);
    tNow.value = 12;
    selection.value = ['dc1'];
    const root = mount(EventMenu);
    await tick();
    expect(anythingDownUnder(doc.value.topology, 'dc1', 12)).toBe(true);
    expect(quietOf(root)).not.toContain('nothing here is down');
    expect(quietOf(root)).toContain('what is down sits inside it');
  });

  it('does not claim nothing is down when only part of the selection is', async () => {
    inject([{ at: 0, kind: 'link.cut', link: 'dc1-dc2' }]);
    tNow.value = 10;
    selection.value = ['dc1-dc2', 'dc1-dc3'];
    const root = mount(EventMenu);
    await tick();
    /* The intersection collapsed the pair's restore to "nothing has taken it
       down" -- true of the pair, false of dc1-dc2, which is drawn cut. */
    const heal = actionsFor(doc.value.topology, ['dc1-dc2', 'dc1-dc3'], 10)
      .find((a) => a.id === 'link.heal');
    expect(heal?.enabled).toEqual({ state: 'off', why: WHY.nothingDown });
    expect(quietOf(root)).not.toContain('nothing here is down');
    expect(quietOf(root)).toContain('only part of this selection is down');
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
    it(`never says "nothing here is down" after ${name}`, async () => {
      const checked: string[] = [];
      for (const key of keys) {
        inject([evt]);
        tNow.value = 12;
        selection.value = [key];
        const root = mount(EventMenu);
        await tick();
        const down = membersUnder(doc.value.topology, key).some((m) => membersAt(12)[m] === 'down');
        if (!down) continue;
        checked.push(key);
        expect(`${key}: ${quietOf(root)}`).not.toContain('Nothing to restore');
        expect(`${key}: ${quietOf(root)}`).not.toContain('nothing here is down');
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
