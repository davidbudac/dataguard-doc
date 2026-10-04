/**
 * Removing a drawn line removes what draws it.
 *
 * The canvas derives four kinds of line -- redo, the application's addresses,
 * the observer's ping and its readiness checks -- and a click on one selects
 * the network link it rides. Remove on that link only severs the lines (they
 * stay drawn, cut); these tests hold the table to the promise that the line
 * itself can be taken away, from the link it rides and from its own key once
 * the link is gone, that a line that cannot be removed says why, and that the
 * `...` handle never hangs over a selection with nothing to offer.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { resolveRedoGraph } from '@/engine';
import type { MemberId, TopologyDoc } from '@/engine';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { clearSelection, inspectorOpen, mode, selection, toast, tNow, viewport } from '@/state/view';
import { App } from '@/ui/App';
import { barOpen, closeBar } from '@/ui/canvas/bar';
import { MAX_ROWS, shownRows } from '@/ui/canvas/ActionBar';
import { Inspector } from '@/ui/inspector/Inspector';
import { addDatabase, removeLink, routesWithout } from '@/ui/inspector/edits';
import { WHY } from '@/ui/inspector/why';
import { buildActionsForKey, removeAction } from '@/ui/build/actions';
import { allRoutes } from '@/ui/build/routes';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const topo = (): TopologyDoc => doc.value.topology;
const mid = (s: string): MemberId => s as MemberId;

const redoPairs = (): string[] =>
  resolveRedoGraph(topo(), { primary: mid('prm01') }).edges.map((e) => `${e.from as string}>${e.to as string}`);
const routeKeys = (): string[] => allRoutes(topo()).map((r) => r.key);

const mounted: HTMLElement[] = [];
const mount = (component: unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(component as never, {}), root);
  return root;
};

beforeEach(() => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  inspectorOpen.value = false;
  toast.value = null;
  clearSelection();
});

describe('a redo line', () => {
  it('is removed from a default (LOCAL : ALL) by naming the rest, and undone in one step', () => {
    const sby02 = addDatabase() as MemberId;
    expect(redoPairs()).toContain(`prm01>${sby02 as string}`);
    const a = removeAction(topo(), `redo:prm01:${sby02 as string}`);
    expect(a?.label).toBe(`Remove redo prm01 → ${sby02 as string}`);
    expect(a?.enabled).toEqual({ state: 'on' });
    a!.run();
    expect(redoPairs()).toEqual(['prm01>sby01']);
    const prm = topo().members.find((m) => m.id === mid('prm01'))!;
    expect(prm.redoRoutes).toEqual([{ source: 'LOCAL', groups: [{ dests: [{ target: 'sby01' }] }] }]);
    expect(routeKeys()).not.toContain(`redo:prm01:${sby02 as string}`);
    undo();
    expect(redoPairs()).toContain(`prm01>${sby02 as string}`);
    expect(topo().members.find((m) => m.id === mid('prm01'))!.redoRoutes).toEqual([]);
  });

  it('takes one destination out of an explicit rule and leaves the others', () => {
    const sby02 = addDatabase() as MemberId;
    const t = topo();
    const routes = [{ source: 'LOCAL' as const, groups: [{ dests: [{ target: mid('sby01') }, { target: sby02, xpt: 'ASYNC' as const }] }] }];
    const edited: TopologyDoc = {
      ...t, members: t.members.map((m) => (m.id === mid('prm01') ? { ...m, redoRoutes: routes } : m)),
    };
    expect(routesWithout(edited, mid('prm01'), mid('sby01')))
      .toEqual([{ source: 'LOCAL', groups: [{ dests: [{ target: sby02, xpt: 'ASYNC' }] }] }]);
  });

  it('refuses to remove the only destination, and says what does remove it', () => {
    const a = removeAction(topo(), 'redo:prm01:sby01');
    expect(a?.enabled).toEqual({ state: 'off', why: WHY.onlyRedoDest });
    expect(routesWithout(topo(), mid('prm01'), mid('sby01'))).toBeNull();
  });
});

describe('the other lines', () => {
  it('an application line takes the member off the ADDRESS_LIST', () => {
    const a = removeAction(topo(), 'connect:app01:sby01');
    expect(a?.label).toBe('Remove sby01 from the ADDRESS_LIST');
    a!.run();
    expect(topo().client.addresses.map((x) => x.host as string)).toEqual(['dc1-prm01']);
    expect(routeKeys()).not.toContain('connect:app01:sby01');
    undo();
    expect(routeKeys()).toContain('connect:app01:sby01');
  });

  it('a readiness check takes the member out of FastStartFailoverTarget', () => {
    const a = removeAction(topo(), 'check:obs01:sby01');
    expect(a?.label).toBe('Remove sby01 from FastStartFailoverTarget');
    a!.run();
    expect(topo().config.fsfo.target).toEqual({ kind: 'list', members: [] });
    expect(routeKeys()).not.toContain('check:obs01:sby01');
  });

  it('an observer’s ping is not configured anywhere, and says so', () => {
    const a = removeAction(topo(), 'ping:obs01:prm01');
    expect(a?.enabled).toEqual({ state: 'off', why: WHY.pingFollowsObserver });
  });

  it('a key for a line that is not drawn offers nothing', () => {
    expect(buildActionsForKey(topo(), 'redo:prm01:nobody')).toEqual([]);
    expect(buildActionsForKey(topo(), 'redo:sby01:prm01')).toEqual([]);
  });
});

describe('the link a line rides', () => {
  it('offers the removal of each line on it, before its own Remove, which stays last', () => {
    const rows = buildActionsForKey(topo(), 'dc1-dc2');
    expect(rows.map((r) => r.label).slice(-3)).toEqual([
      'Remove redo prm01 → sby01', 'Remove sby01 from the ADDRESS_LIST', 'Remove dc1-dc2',
    ]);
    expect(rows.at(-1)?.id).toBe('remove');
    expect(rows.length).toBeLessThanOrEqual(7);
    /* The Delete key and the rail's header mean the link. */
    expect(removeAction(topo(), 'dc1-dc2')?.label).toBe('Remove dc1-dc2');
  });

  it('lists the lines in the rail with the same rows', async () => {
    selection.value = ['dc1-dc2'];
    const root = mount(Inspector);
    await tick();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.grp button.btn')];
    const connect = buttons.find((b) => b.textContent === 'Remove sby01 from the ADDRESS_LIST');
    const redo = buttons.find((b) => b.textContent === 'Remove redo prm01 → sby01');
    expect(redo?.disabled).toBe(true);
    connect!.click();
    await tick();
    expect(routeKeys()).not.toContain('connect:app01:sby01');
  });
});

describe('a line selected by its own key', () => {
  it('has a rail: what it is, and the removal in the header', async () => {
    removeLink('dc1-dc2' as never);
    selection.value = ['connect:app01:sby01'];
    const root = mount(Inspector);
    await tick();
    expect(root.querySelector('.insp-kind')?.textContent).toBe('Application address');
    const remove = [...root.querySelectorAll<HTMLButtonElement>('.insp-hd button.btn')]
      .find((b) => b.textContent === 'Remove');
    expect(remove?.title).toBe('Remove sby01 from the ADDRESS_LIST');
    remove!.click();
    await tick();
    expect(routeKeys()).not.toContain('connect:app01:sby01');
  });
});

describe('the handle', () => {
  beforeEach(() => {
    tNow.value = 0;
    mode.value = 'build';
    closeBar();
  });

  const handle = (root: HTMLElement): Element | null => root.querySelector('.tp-more');

  it('opens the line’s rows once the link under it is gone', async () => {
    removeLink('dc1-dc2' as never);
    const root = mount(App);
    await tick();
    selection.value = ['redo:prm01:sby01'];
    await tick();
    expect(handle(root)?.getAttribute('data-more')).toBe('redo:prm01:sby01');
    handle(root)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    expect(barOpen.value).toBe('redo:prm01:sby01');
    const rows = [...root.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent);
    expect(rows).toEqual(['Edit prm01', 'Remove redo prm01 → sby01']);
    /* The header names the line, not its key. */
    expect(root.querySelector('.cv-bar-hd .mono')?.textContent).toBe('Redo route prm01 → sby01');
    expect(root.querySelector('.cv-bar')?.getAttribute('aria-label')).toBe('Actions for Redo route prm01 → sby01');
  });

  it('keeps the link\u2019s own Remove on the bar when more lines ride it than fit', async () => {
    addDatabase();
    addDatabase();
    expect(buildActionsForKey(topo(), 'dc1-dc2').length).toBeGreaterThan(MAX_ROWS);
    const root = mount(App);
    await tick();
    selection.value = ['dc1-dc2'];
    await tick();
    handle(root)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    const rows = [...root.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent);
    expect(rows).toHaveLength(MAX_ROWS);
    expect(rows.at(-1)).toBe('Remove dc1-dc2');
    expect(rows[0]).toBe('Edit dc1-dc2');
    expect(root.querySelector('.cv-bar-quiet')?.textContent).toMatch(/^More in /);
  });

  it('is not drawn over a selection with nothing to offer', async () => {
    /* Configure offers no bar at all: a handle there would open nothing. */
    mode.value = 'configure';
    const root = mount(App);
    await tick();
    selection.value = ['sby01'];
    await tick();
    expect(root.querySelector('[data-node="sby01"]')).not.toBeNull();
    expect(handle(root)).toBeNull();
  });
});

describe('the cap on the bar', () => {
  it('keeps the last row when asked, and drops the ones before it', () => {
    const xs = [1, 2, 3, 4, 5];
    expect(shownRows(xs, 3)).toEqual([1, 2, 3]);
    expect(shownRows(xs, 3, true)).toEqual([1, 2, 5]);
    expect(shownRows(xs, 9, true)).toEqual(xs);
  });
});
