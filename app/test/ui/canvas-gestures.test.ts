/**
 * The drawing's own gestures, beyond click and move: a card dropped in another
 * data centre, a line drawn from one card to another, and a bar that closes
 * when the reader presses anywhere else.
 *
 * Two halves. The edits (`moveToSite`, `shipRedo`, `addFsfoTarget`) are
 * asserted on the document, because what a drop *means* is a question about
 * hosts and RedoRoutes, not about pixels. The gestures are asserted through
 * the mounted app, because the drawing is where a drop is recognised -- and a
 * pure geometry hit-test is what makes that checkable in jsdom, which has no
 * `elementFromPoint` and no `getScreenCTM`.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { linkId, memberId, siteId, validate } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { App } from '@/ui/App';
import { classicDoc, doc as docSignal, makeDoc } from '@/state/doc';
import { PRESETS } from '@/presets';
import { connectFromCanvas } from '@/ui/canvas/CanvasSlot';
import { edit, resetHistory, undo, undoLabel, undoStack } from '@/state/history';
import { barOpen, closeBar } from '@/ui/canvas/bar';
import { fitZoom } from '@/ui/canvas/zoom';
import { mode, releaseRail, selection, toast, viewport } from '@/state/view';
import {
  addDatabase, addFsfoTarget, addInstance, addObserver, addSite, moveToSite, patchDatabase,
  patchInstance, removeInstance, shipRedo, transportForMode,
} from '@/ui/inspector/edits';
import { actionsForKey, runAction } from '@/ui/break/events';
import { farSyncFixture, priorityFixture } from './canvas-fixtures';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/* Long enough for preact to flush the effects it defers past the paint. */
const painted = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
const topo = (): TopologyDoc => docSignal.value.topology;
const siteOfHost = (h: string): string | undefined =>
  topo().hosts.find((x) => (x.id as string) === h)?.site as string | undefined;
const member = (id: string) => topo().members.find((m) => (m.id as string) === id)!;
const observer = (id: string) => topo().observers.find((o) => (o.id as string) === id)!;

const mounted: HTMLElement[] = [];
const unmountAll = (): void => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
};

beforeEach(() => {
  unmountAll();
  selection.value = [];
  releaseRail();
  toast.value = null;
  mode.value = 'build';
  viewport.value = 'wide';
  closeBar();
  fitZoom();
  resetHistory(classicDoc());
});

/* ---------------- the edits ---------------- */

describe('moveToSite: a card dropped in another data centre', () => {
  it('gives the member a host of its own in the new data centre and removes the one it left', () => {
    addSite();
    moveToSite('sby01', siteId('dc4'));
    const m = member('sby01');
    expect(m.instances.map((i) => i.host as string)).toEqual(['dc4-sby01']);
    expect(siteOfHost('dc4-sby01')).toBe('dc4');
    expect(topo().hosts.some((h) => (h.id as string) === 'dc2-sby01')).toBe(false);
    expect(undoLabel.value).toBe('Move sby01 to DC 4');
  });

  it('leaves a host behind when something else still stands on it', () => {
    /* A second database on sby01's host: the host is shared. */
    const id = addDatabase(siteId('dc2'))!;
    const before = topo();
    const host = member('sby01').instances[0]!.host;
    resetHistory({
      ...docSignal.value,
      topology: {
        ...before,
        members: before.members.map((m) => (m.id === id
          ? { ...m, instances: m.instances.map((i) => ({ ...i, host })) }
          : m)),
      },
    });
    moveToSite('sby01', siteId('dc1'));
    expect(siteOfHost('dc2-sby01')).toBe('dc2');
    expect(member(id as string).instances[0]!.host).toBe(host);
    expect(member('sby01').instances[0]!.host as string).toBe('dc1-sby01');
    expect(siteOfHost('dc1-sby01')).toBe('dc1');
  });

  it('puts every node of a member that becomes RAC in one cluster', () => {
    addInstance(memberId('sby01'));
    const hosts = member('sby01').instances.map((i) => i.host as string);
    const clusters = hosts.map((h) => topo().hosts.find((x) => (x.id as string) === h)?.cluster);
    expect(clusters).toEqual(['sby01-crs', 'sby01-crs']);
    /* The observer runs on a host of its own, outside the new cluster. */
    expect(validate(topo()).some((f) => f.id === 'RAC.OBSERVER_ON_CLUSTER')).toBe(false);
  });

  it('keeps PreferredApplyInstance pointing at the instance through a rename and a removal', () => {
    addInstance(memberId('sby01'));
    patchDatabase(memberId('sby01'), 'prefer', (m) => ({ ...m, preferredApplyInstance: 'sby012' }));
    patchInstance(memberId('sby01'), 1, (i) => ({ ...i, name: 'sby01b' }), 'rename');
    expect((member('sby01') as { preferredApplyInstance?: string }).preferredApplyInstance).toBe('sby01b');
    removeInstance(memberId('sby01'), 1);
    expect('preferredApplyInstance' in member('sby01')).toBe(false);
  });

  it('moves every instance of a RAC member together', () => {
    addInstance(memberId('sby01'));
    const instances = member('sby01').instances;
    expect(new Set(instances.map((i) => i.host)).size).toBe(2);
    expect(new Set(instances.map((i) => siteOfHost(i.host as string)))).toEqual(new Set(['dc2']));
    addSite();
    moveToSite('sby01', siteId('dc4'));
    const hosts = member('sby01').instances.map((i) => i.host as string);
    expect(new Set(hosts.map(siteOfHost))).toEqual(new Set(['dc4']));
  });

  it('moves an observer on its own host', () => {
    moveToSite('obs01', siteId('dc2'));
    expect(siteOfHost(observer('obs01').host as string)).toBe('dc2');
    expect(topo().hosts.some((h) => (h.id as string) === 'dc3-obs01')).toBe(false);
  });

  it('drops the drag offset so the card lands where its new column puts it', () => {
    addSite();
    resetHistory({ ...docSignal.value, layout: { sby01: { dx: 40, dy: 8 } } });
    moveToSite('sby01', siteId('dc4'));
    expect(docSignal.value.layout).not.toHaveProperty('sby01');
  });

  it('is no edit at all when the card is dropped in the data centre it is in', () => {
    const n = undoStack.value.length;
    moveToSite('sby01', siteId('dc2'));
    expect(undoStack.value.length).toBe(n);
  });

  it('undoes in one step, the drag included', () => {
    addSite();
    /* The drag wrote offsets under `drag:sby01`; the move coalesces into it. */
    edit('Move the sby01 card', (d) => ({ ...d, layout: { ...d.layout, sby01: { dx: 400, dy: 0 } } }), 'drag:sby01');
    const n = undoStack.value.length;
    moveToSite('sby01', siteId('dc4'));
    expect(undoStack.value.length).toBe(n);
    undo();
    expect(siteOfHost(member('sby01').instances[0]!.host as string)).toBe('dc2');
    expect(docSignal.value.layout).not.toHaveProperty('sby01');
  });
});

describe('shipRedo: a line from one member to another', () => {
  it('on a primary with the default routes, is a sentence and not an edit', () => {
    const n = undoStack.value.length;
    shipRedo(memberId('prm01'), memberId('sby01'));
    expect(undoStack.value.length).toBe(n);
    expect(toast.value?.text).toContain('already ships');
  });

  it('gives a standby an (ANY : target ASYNC) rule, whatever the target\'s own transport', () => {
    const id = addDatabase()!;
    /* In MAXAVAILABILITY the new standby arrives as SYNC; the cascaded leg is
       still named ASYNC, which is what real-time cascading needs. */
    expect(member(id as string).logXptMode).toBe('SYNC');
    shipRedo(memberId('sby01'), id);
    const m = member('sby01');
    expect(m.redoRoutes).toEqual([
      { source: 'ANY', groups: [{ dests: [{ target: id, xpt: 'ASYNC' }] }] },
    ]);
    expect(m.dests).toHaveProperty(id as string);
    expect(undoLabel.value).toBe(`Ship redo from sby01 to ${id as string}`);
  });

  it('adds the target to the rule that is active for the current primary', () => {
    resetHistory({ ...docSignal.value, topology: farSyncFixture() });
    const id = addDatabase()!;
    shipRedo(memberId('fs1'), id);
    const rules = member('fs1').redoRoutes;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.groups[0]!.dests.map((d) => d.target)).toEqual([memberId('sby01'), id]);
    shipRedo(memberId('fs1'), id);
    expect(toast.value?.text).toContain('already ships');
  });

  it('a line drawn from a member whose active rule is one parenthesised group ships, not stands by', () => {
    /* A group has one active redo path, so joining it would only put the new
       destination on standby: the line becomes an entry of its own. */
    resetHistory({ ...docSignal.value, topology: priorityFixture() });
    const id = addDatabase()!;
    shipRedo(memberId('prm01'), id);
    const groups = member('prm01').redoRoutes[0]!.groups;
    expect(groups[0]!.dests.map((d) => d.target)).toEqual([memberId('sby01'), memberId('sby02')]);
    expect(groups.at(-1)).toEqual({ dests: [{ target: id }] });
  });

  it('"+ Standby" under a primary with RedoRoutes of its own joins the active rule, so it is reached', () => {
    resetHistory({ ...docSignal.value, topology: farSyncFixture() });
    const id = addDatabase()!;
    const prm = member('prm01');
    expect(prm.redoRoutes).toHaveLength(1);
    expect(prm.redoRoutes[0]!.groups[0]!.dests.map((d) => d.target)).toEqual([memberId('fs1'), id]);
  });

  it('refuses the primary as a destination', () => {
    const n = undoStack.value.length;
    shipRedo(memberId('sby01'), memberId('prm01'));
    expect(undoStack.value.length).toBe(n);
    expect(toast.value?.kind).toBe('warn');
  });
});

describe('addFsfoTarget: a line between a member and an observer', () => {
  it('names the standby as a failover target', () => {
    const id = addDatabase()!;
    addFsfoTarget(id);
    const t = topo().config.fsfo.target;
    expect(t.kind === 'list' && t.members.includes(id)).toBe(true);
  });

  it('refuses a far sync instance in the configuration form\'s words', () => {
    resetHistory({ ...docSignal.value, topology: farSyncFixture() });
    const n = undoStack.value.length;
    addFsfoTarget(memberId('fs1'));
    expect(undoStack.value.length).toBe(n);
    expect(toast.value?.text).toContain('far sync instance cannot be one');
  });
});

/* ---------------- the gestures ---------------- */

const mountApp = async (): Promise<HTMLElement> => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  await tick();
  return root;
};

/** A pointer event under the name preact bound in jsdom (see canvas-zoom.test). */
const pointer = (el: Element, kind: 'Down' | 'Move' | 'Up', x: number, y: number): void => {
  const lower = `pointer${kind.toLowerCase()}`;
  const type = `on${lower}` in el ? lower : `Pointer${kind}`;
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
  }));
};

/**
 * Client coordinates for a point in the drawing's units. jsdom gives the svg a
 * zero rect, so the canvas falls back to `view.x + clientX`: the inverse is
 * `clientX = x - view.x`.
 */
const clientOf = (root: HTMLElement, x: number, y: number): [number, number] => {
  const vb = root.querySelector('.topo-svg')!.getAttribute('viewBox')!.split(/\s+/).map(Number);
  return [x - vb[0]!, y - vb[1]!];
};

const rectOf = (root: HTMLElement, key: string, sel: string): { x: number; y: number; w: number; h: number } => {
  const el = root.querySelector(`[data-node="${key}"] ${sel}`)!;
  return {
    x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')),
    w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')),
  };
};

const drag = async (root: HTMLElement, from: Element, path: [number, number][]): Promise<void> => {
  const svg = root.querySelector('.topo-svg')!;
  const [sx, sy] = path[0]!;
  pointer(from, 'Down', sx, sy);
  for (const [x, y] of path.slice(1)) { pointer(svg, 'Move', x, y); await tick(); }
  const [ex, ey] = path[path.length - 1]!;
  pointer(svg, 'Up', ex, ey);
  await tick();
};

describe('a card dragged into another data centre moves there', () => {
  it('highlights the panel under the pointer and moves the card on the drop', async () => {
    addSite();
    const root = await mountApp();
    const card = rectOf(root, 'sby01', 'rect.tp-card');
    const panel = rectOf(root, 'dc4', 'rect.tp-site');
    expect(root.querySelector('.tp-site.is-empty')).not.toBeNull();
    const start = clientOf(root, card.x + 20, card.y + 20);
    const end = clientOf(root, panel.x + panel.w / 2, panel.y + panel.h / 2);
    const svg = root.querySelector('.topo-svg')!;
    pointer(root.querySelector('[data-node="sby01"]')!, 'Down', ...start);
    pointer(svg, 'Move', ...end);
    await tick();
    expect(root.querySelector('.tp-site.is-drop')?.parentElement?.getAttribute('data-node')).toBe('dc4');
    expect(root.querySelector('.tp-siteempty')?.textContent).toBe('Drop it here');
    pointer(svg, 'Up', ...end);
    await tick();
    expect(siteOfHost(member('sby01').instances[0]!.host as string)).toBe('dc4');
    expect(root.querySelector('.tp-site.is-drop')).toBeNull();
    expect(undoLabel.value).toBe('Move sby01 to DC 4');
  });

  it('is only a move when the card is let go in its own data centre', async () => {
    const root = await mountApp();
    const card = rectOf(root, 'sby01', 'rect.tp-card');
    const start = clientOf(root, card.x + 20, card.y + 20);
    await drag(root, root.querySelector('[data-node="sby01"]')!, [start, [start[0] + 16, start[1] + 16]]);
    expect(siteOfHost(member('sby01').instances[0]!.host as string)).toBe('dc2');
    expect(undoLabel.value).toBe('Move the sby01 card');
  });

  it('is not offered in Break mode, where the drawing is not edited', async () => {
    mode.value = 'break';
    /* The drawing is on screen in the Detailed timeline only in the docked layout. */
    viewport.value = 'compact';
    const root = await mountApp();
    const card = rectOf(root, 'sby01', 'rect.tp-card');
    const panel = rectOf(root, 'dc3', 'rect.tp-site');
    const start = clientOf(root, card.x + 20, card.y + 20);
    const end = clientOf(root, panel.x + panel.w / 2, panel.y + panel.h - 4);
    await drag(root, root.querySelector('[data-node="sby01"]')!, [start, end]);
    expect(siteOfHost(member('sby01').instances[0]!.host as string)).toBe('dc2');
  });
});

describe('a line drawn from a card\'s port connects it', () => {
  it('ships redo from the card the line left to the card it landed on', async () => {
    addDatabase();
    const root = await mountApp();
    const from = root.querySelector('[data-node="sby01"] .tp-port')!;
    const dot = from.querySelector('.tp-port-dot')!;
    const start = clientOf(root, Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')));
    const target = rectOf(root, 'sby02', 'rect.tp-card');
    const end = clientOf(root, target.x + target.w / 2, target.y + target.h / 2);
    const svg = root.querySelector('.topo-svg')!;
    pointer(from, 'Down', ...start);
    pointer(svg, 'Move', ...end);
    await tick();
    expect(root.querySelector('.tp-rubber-ln.is-on')).not.toBeNull();
    expect(root.querySelector('.tp-card.is-target')?.parentElement?.getAttribute('data-node')).toBe('sby02');
    pointer(svg, 'Up', ...end);
    await tick();
    expect(root.querySelector('.tp-rubber')).toBeNull();
    expect(member('sby01').redoRoutes[0]?.groups[0]?.dests[0]?.target).toBe(memberId('sby02'));
  });

  it('makes a standby the failover target when the line reaches an observer, either way round', async () => {
    const id = addDatabase()!;
    const root = await mountApp();
    const from = root.querySelector(`[data-node="${id as string}"] .tp-port`)!;
    const dot = from.querySelector('.tp-port-dot')!;
    const start = clientOf(root, Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')));
    const obs = rectOf(root, 'obs01', 'rect.tp-card');
    const end = clientOf(root, obs.x + obs.w / 2, obs.y + obs.h / 2);
    await drag(root, from, [start, end]);
    const t = topo().config.fsfo.target;
    expect(t.kind === 'list' && t.members.includes(id)).toBe(true);
  });

  it('says what the drop would do beside the pointer, and refuses on the card when it may not', async () => {
    const root = await mountApp();
    const from = root.querySelector('[data-node="sby01"] .tp-port')!;
    const dot = from.querySelector('.tp-port-dot')!;
    const start = clientOf(root, Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')));
    const prm = rectOf(root, 'prm01', 'rect.tp-card');
    const end = clientOf(root, prm.x + prm.w / 2, prm.y + prm.h / 2);
    const svg = root.querySelector('.topo-svg')!;
    pointer(from, 'Down', ...start);
    pointer(svg, 'Move', ...end);
    await tick();
    expect(root.querySelector('.tp-card.is-target-no')?.parentElement?.getAttribute('data-node')).toBe('prm01');
    expect(root.querySelector('.tp-rubber-tip.is-no .tp-rubber-tip-tx')?.textContent).toContain('prm01 is the primary');
    pointer(svg, 'Up', ...end);
    await tick();
    expect(member('sby01').redoRoutes).toEqual([]);
    expect(toast.value?.text).toContain('prm01 is the primary');
  });

  it('dropped on another data centre, adds a standby there and ships to it', async () => {
    addSite();
    const root = await mountApp();
    const from = root.querySelector('[data-node="sby01"] .tp-port')!;
    const dot = from.querySelector('.tp-port-dot')!;
    const start = clientOf(root, Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')));
    const panel = rectOf(root, 'dc4', 'rect.tp-site');
    const end = clientOf(root, panel.x + panel.w / 2, panel.y + panel.h / 2);
    const svg = root.querySelector('.topo-svg')!;
    pointer(from, 'Down', ...start);
    pointer(svg, 'Move', ...end);
    await tick();
    expect(root.querySelector('.tp-site.is-drop')?.parentElement?.getAttribute('data-node')).toBe('dc4');
    expect(root.querySelector('.tp-rubber-tip-tx')?.textContent).toContain('Add a standby in DC 4');
    pointer(svg, 'Up', ...end);
    await tick();
    const added = topo().members.find((m) => (m.id as string) === 'sby02')!;
    expect(added).toBeDefined();
    expect(siteOfHost(added.instances[0]!.host as string)).toBe('dc4');
    expect(member('sby01').redoRoutes[0]?.groups[0]?.dests[0]?.target).toBe(memberId('sby02'));
  });

  it('never lands on the panel the line started in', async () => {
    const root = await mountApp();
    const from = root.querySelector('[data-node="sby01"] .tp-port')!;
    const dot = from.querySelector('.tp-port-dot')!;
    const start = clientOf(root, Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy')));
    const n = topo().members.length;
    await drag(root, from, [start, [start[0] + 6, start[1] + 6]]);
    expect(topo().members.length).toBe(n);
  });

  it('draws no port on a drawing nobody may edit', async () => {
    mode.value = 'break';
    /* The drawing is on screen in the Detailed timeline only in the docked layout. */
    viewport.value = 'compact';
    const root = await mountApp();
    expect(root.querySelector('.tp-port')).toBeNull();
  });
});

describe('the bar closes on a press anywhere that is not the bar', () => {
  it('closes on a press in the rail, and keeps the selection', async () => {
    const root = await mountApp();
    root.querySelector('[data-node="sby01"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await painted();
    /* A click selects; the handle on the selected card asks for the bar. */
    root.querySelector('.tp-more')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await painted();
    expect(barOpen.value).toBe('sby01');
    /* The rail comes in a moment after the first click of a selection
       (view.ts, `railHeld`); stand in for the moment. */
    releaseRail();
    await tick();
    const rail = document.querySelector('.app-rail')!;
    rail.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    await tick();
    expect(barOpen.value).toBeNull();
    expect(selection.value).toEqual(['sby01']);
  });

  it('stays open on a press inside itself', async () => {
    const root = await mountApp();
    root.querySelector('[data-node="sby01"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await painted();
    /* A click selects; the handle on the selected card asks for the bar. */
    root.querySelector('.tp-more')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await painted();
    root.querySelector('.cv-bar-row button')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    await tick();
    expect(barOpen.value).toBe('sby01');
  });
});

/* ---------------- Break: a cut link has a way back ---------------- */

describe('Break: restoring a cut link', () => {
  const linkRows = (doc: TopologyDoc, at: number) =>
    actionsForKey(doc, 'dc1-dc2', at).map((a) => [a.id, a.enabled.state, a.events.length] as const);

  it('at the instant of the cut, Restore takes the cut back instead of stacking a heal', () => {
    resetHistory({ ...docSignal.value, topology: { ...topo(), events: [{ at: 5, kind: 'link.cut', link: linkId('dc1-dc2') }] } });
    const rows = actionsForKey(topo(), 'dc1-dc2', 5);
    const restore = rows.find((a) => a.id === 'link.heal')!;
    expect(restore.enabled.state).toBe('on');
    expect(restore.events).toEqual([]);
    runAction(restore);
    expect(topo().events).toEqual([]);
    expect(rows.some((a) => a.id === 'link.uncut')).toBe(false);
  });

  it('later on the clock, offers both a heal here and taking the cut back where it is', () => {
    resetHistory({ ...docSignal.value, topology: { ...topo(), events: [{ at: 5, kind: 'link.cut', link: linkId('dc1-dc2') }] } });
    expect(linkRows(topo(), 20)).toEqual([
      ['link.cut', 'off', 1], ['link.heal', 'on', 1], ['link.uncut', 'on', 0],
    ]);
    const back = actionsForKey(topo(), 'dc1-dc2', 20).find((a) => a.id === 'link.uncut')!;
    expect(back.label).toBe('Take back the cut at t = 5 s');
    runAction(back);
    expect(topo().events).toEqual([]);
  });

  it('before the cut, still offers to take it back -- the reader scrubbed back past their own cut', () => {
    resetHistory({ ...docSignal.value, topology: { ...topo(), events: [{ at: 5, kind: 'link.cut', link: linkId('dc1-dc2') }] } });
    const rows = actionsForKey(topo(), 'dc1-dc2', 0);
    expect(rows.find((a) => a.id === 'link.heal')?.enabled.state).toBe('off');
    expect(rows.find((a) => a.id === 'link.uncut')?.label).toBe('Take back the cut at t = 5 s');
  });

  it('marked down in the configuration, says so and offers to lift the mark', () => {
    resetHistory({
      ...docSignal.value,
      topology: { ...topo(), links: topo().links.map((l) => ((l.id as string) === 'dc1-dc2' ? { ...l, up: false } : l)) },
    });
    const rows = actionsForKey(topo(), 'dc1-dc2', 0);
    const mark = rows.find((a) => a.id === 'link.markUp')!;
    expect(mark.property).toBe(true);
    expect(mark.label).toBe('Mark dc1-dc2 up in the configuration');
    runAction(mark);
    expect(topo().links.find((l) => (l.id as string) === 'dc1-dc2')?.up).toBe(true);
  });

  it('an observer stopped in the configuration gets the same offer', () => {
    resetHistory({
      ...docSignal.value,
      topology: { ...topo(), observers: topo().observers.map((o) => ({ ...o, running: false })) },
    });
    const mark = actionsForKey(topo(), 'obs01', 0).find((a) => a.id === 'observer.markRunning')!;
    expect(mark).toBeDefined();
    runAction(mark);
    expect(observer('obs01').running).toBe(true);
  });
});

describe('a new standby does not arrive broken', () => {
  /* The page used to add every standby as ASYNC, so in maximum availability
     the drawing raised an error the moment a reader pressed "+ Standby". */
  const loud = (): string[] => validate(topo())
    .filter((f) => f.severity !== 'info')
    .map((f) => `${f.id} ${f.subject.id ?? ''}`);

  it('takes the transport broker Table 4-2 gives for the protection mode', () => {
    expect(transportForMode('MAXPROTECTION')).toBe('SYNC');
    expect(transportForMode('MAXAVAILABILITY')).toBe('SYNC');
    expect(transportForMode('MAXPERFORMANCE')).toBe('ASYNC');
  });

  for (const p of PRESETS) {
    it(`adds no error or warning in ${p.id}, by + Standby or by a line onto a data centre`, () => {
      resetHistory(makeDoc({ ...p.doc(), events: [] }));
      const before = loud();
      addDatabase();
      expect(loud().filter((x) => !before.includes(x))).toEqual([]);

      resetHistory(makeDoc({ ...p.doc(), events: [] }));
      const sender = topo().members.find((m) => !(m.kind === 'database' && m.role === 'primary'));
      if (sender === undefined) return;
      connectFromCanvas(sender.id as string, topo().sites.at(-1)!.id as string);
      expect(loud().filter((x) => !before.includes(x))).toEqual([]);
    });
  }
});
