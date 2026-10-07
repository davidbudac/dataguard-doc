/**
 * A configuration with no primary stays on the drawing.
 *
 * The drawing used to be replaced by a text note, which left no card to click
 * and so no way to repair the configuration from where it is drawn. Now every
 * card stays, no redo is drawn, and a notice over the stage says the
 * configuration is not valid and offers the quickest way out. The generators
 * and panels still read `redoGraph === null` as "nothing to say".
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { declaredPrimary, edgelessGraph } from '@/engine';
import type { DatabaseMember, TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import {
  drawnGeometry, drawnGraph, geometry, primaryId, redoGraph,
} from '@/state/derived';
import { classicDoc, doc as docSignal, makeDoc, withLayout } from '@/state/doc';
import { redoStack, resetHistory, undo, undoStack } from '@/state/history';
import { mode, releaseRail, selection, toast, viewport } from '@/state/view';
import type { Viewport } from '@/state/view';
import { App } from '@/ui/App';
import { closeBar } from '@/ui/canvas/bar';
import { cardLabel, describeTopology } from '@/ui/canvas/aria';
import { CanvasSlot } from '@/ui/canvas/CanvasSlot';
import { addDatabase, setPrimary } from '@/ui/inspector/edits';

const painted = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
const topo = (): TopologyDoc => docSignal.value.topology;

const mounted: HTMLElement[] = [];
const unmountAll = (): void => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
};
const mountApp = async (): Promise<HTMLElement> => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  await painted();
  return root;
};

/** Every database made a standby: the configuration that has no primary. */
const withoutPrimary = (t: TopologyDoc): TopologyDoc => ({
  ...t,
  members: t.members.map((m) => (m.kind === 'database' ? { ...m, role: 'physical' as const } : m)),
});
const loseThePrimary = (): void => {
  resetHistory({ ...docSignal.value, topology: withoutPrimary(topo()) });
};

beforeEach(() => {
  unmountAll();
  selection.value = [];
  toast.value = null;
  mode.value = 'build';
  viewport.value = 'wide';
  closeBar();
  resetHistory(classicDoc());
});

const notice = (root: ParentNode): HTMLElement | null => root.querySelector('.cv-invalid');
const noticeButtons = (root: ParentNode): string[] =>
  [...root.querySelectorAll('.cv-invalid button')].map((b) => b.textContent ?? '');
const noticeText = (root: ParentNode): string => notice(root)?.textContent ?? '';
const cards = (root: ParentNode): string[] =>
  [...root.querySelectorAll('.tp-node[data-node]')].map((e) => e.getAttribute('data-node') ?? '').sort();
const redoLines = (root: ParentNode): number =>
  root.querySelectorAll('.tp-link.is-sync, .tp-link.is-async').length;
const pressed = (root: ParentNode, group: string): string | undefined =>
  [...root.querySelectorAll(`.seg[aria-label="${group}"] button`)]
    .find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent ?? undefined;
const roleButton = (root: ParentNode, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('.seg[aria-label="Role"] button')]
    .find((b) => b.textContent === label);
const click = (el: Element | null | undefined): void => {
  if (!el) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};

describe('the drawing with no primary', () => {
  it('keeps every card, draws no redo, and says the configuration is not valid', async () => {
    const root = await mountApp();
    const before = cards(root);
    expect(before.length).toBeGreaterThan(3);
    expect(redoLines(root)).toBeGreaterThan(0);
    expect(notice(root)).toBeNull();

    loseThePrimary();
    await painted();

    expect(cards(root)).toEqual(before);
    expect(redoLines(root)).toBe(0);
    expect(root.querySelector('.topo-svg')).not.toBeNull();
    /* The old note is gone with the blank canvas it came with. */
    expect(root.querySelector('.app-stage > .empty')).toBeNull();
    const n = notice(root);
    expect(n).not.toBeNull();
    expect(n?.querySelector('[role="alert"]')).not.toBeNull();
    expect(noticeText(root)).toContain('Not a valid Data Guard configuration');
    expect(noticeText(root)).toContain('No database has the primary role.');
    /* It is the canvas's own chrome: the toast is not used. */
    expect(toast.value).toBeNull();
  });

  it('is what the user does from the inspector: Role -> physical on the primary', async () => {
    const root = await mountApp();
    selection.value = ['prm01'];
    await painted();
    expect(pressed(root, 'Role')).toBe('primary');
    click(roleButton(root, 'physical'));
    await painted();
    expect(declaredPrimary(topo())).toBeNull();
    /* The drawing, the card and the inspector on it are all still there. */
    expect(cards(root)).toContain('prm01');
    expect(notice(root)).not.toBeNull();
    expect(selection.value).toEqual(['prm01']);
    expect(pressed(root, 'Role')).toBe('physical');
  });

  it('leaves redoGraph and geometry null for the panels and generators', () => {
    loseThePrimary();
    expect(primaryId.value).toBeNull();
    expect(redoGraph.value).toBeNull();
    expect(geometry.value).toBeNull();
    /* ...and gives the drawing graphs of its own. */
    expect(drawnGraph.value.edges).toEqual([]);
    expect(drawnGraph.value.findings).toEqual([]);
    expect(drawnGeometry.value.nodes.length).toBeGreaterThan(0);
  });

  it('names no member as the primary: its id is one nobody holds', () => {
    const t = withoutPrimary(topo());
    const g = edgelessGraph(t);
    expect(t.members.some((m) => m.id === g.primary)).toBe(false);
    expect(g.edges).toEqual([]);
    expect(Object.values(g.members).every((m) => !m.reachableFromPrimary && m.effectiveXpt === null)).toBe(true);
    expect(g.protectionLevel.basis).toBe('model');
    expect(g.protectionLevel.note).toBeTruthy();
    /* A document with no database has no stand-in to take places from. */
    const bare = edgelessGraph({ ...t, members: [] });
    expect(bare.members).toEqual({});
  });

  it('describes the drawing in words that do not invent a primary', () => {
    const t = withoutPrimary(topo());
    const g = edgelessGraph(t);
    const model = describeTopology(t, g);
    const said = model.sentences.join(' ');
    expect(said).toContain('no member is the primary');
    expect(said).not.toContain('receives redo');
    expect(said).not.toContain('No active redo route reaches');
    const dbRows = model.rows.filter((r) => r.role !== 'Observer' && r.role !== 'Application');
    expect(dbRows.length).toBeGreaterThan(1);
    expect(dbRows.every((r) => r.receivesFrom === 'nothing' && r.rtt === '')).toBe(true);
    resetHistory({ ...docSignal.value, topology: t });
    const node = drawnGeometry.value.nodes.find((x) => x.id === 'sby01')!;
    expect(cardLabel(t, g, node)).toContain('No member is the primary.');
  });

  it('keeps a card selectable, and the Role choice lets a standby become the primary', async () => {
    loseThePrimary();
    const root = await mountApp();
    const sby = root.querySelector('.tp-node[data-node="sby01"]')!;
    click(sby);
    /* The first selection holds the rail back past a double-click. */
    releaseRail();
    await painted();
    expect(selection.value).toEqual(['sby01']);
    expect(pressed(root, 'Role')).toBe('physical');
    const primary = roleButton(root, 'primary');
    expect(primary).toBeDefined();
    expect(primary?.disabled).toBe(false);
    click(primary);
    await painted();
    expect(declaredPrimary(topo())).toBe('sby01');
    expect(notice(root)).toBeNull();
  });

  it('keeps the add tools', async () => {
    loseThePrimary();
    const root = await mountApp();
    const before = topo().members.length;
    expect(root.querySelector('.palette')).not.toBeNull();
    click([...root.querySelectorAll<HTMLButtonElement>('.palette button')]
      .find((b) => b.textContent?.includes('Standby')));
    await painted();
    expect(topo().members.length).toBe(before + 1);
  });
});

describe('the buttons on the notice', () => {
  const withDatabases = (n: number): void => {
    resetHistory(classicDoc());
    for (let i = topo().members.filter((m) => m.kind === 'database').length; i < n; i++) addDatabase();
    loseThePrimary();
  };
  const names = (): string[] => topo().members.filter((m) => m.kind === 'database').map((m) => m.name);

  it('offers none, and says a database is needed, when there is no database', async () => {
    resetHistory(classicDoc());
    resetHistory({ ...docSignal.value, topology: { ...topo(), members: [] } });
    const root = await mountApp();
    expect(notice(root)).not.toBeNull();
    expect(noticeButtons(root)).toEqual([]);
    expect(noticeText(root)).toContain('A database is needed');
  });

  it('offers one button for the only database', async () => {
    resetHistory(classicDoc());
    resetHistory({
      ...docSignal.value,
      topology: withoutPrimary({ ...topo(), members: topo().members.slice(0, 1) }),
    });
    const root = await mountApp();
    expect(noticeButtons(root)).toEqual([`Make ${names()[0]} the primary`]);
    expect(noticeText(root)).not.toContain('from its card');
  });

  it.each([2, 3])('offers one button per database for %i databases', async (n) => {
    withDatabases(n);
    const root = await mountApp();
    expect(names()).toHaveLength(n);
    expect(noticeButtons(root)).toEqual(names().map((x) => `Make ${x} the primary`));
    expect(noticeText(root)).not.toContain('from its card');
  });

  it('offers the first three and points at the card and the inspector beyond that', async () => {
    withDatabases(5);
    const root = await mountApp();
    expect(names()).toHaveLength(5);
    expect(noticeButtons(root)).toEqual(names().slice(0, 3).map((x) => `Make ${x} the primary`));
    expect(noticeText(root)).toContain('Any database can be given the role from its card or the inspector.');
  });

  it('offers no far sync instance and no observer', async () => {
    resetHistory(makeDoc(PRESETS.find((p) => p.id === 'far-sync-zero-loss')!.doc()));
    loseThePrimary();
    const root = await mountApp();
    const dbs = topo().members.filter((m) => m.kind === 'database');
    expect(topo().members.length).toBeGreaterThan(dbs.length);
    expect(noticeButtons(root)).toEqual(dbs.map((m) => `Make ${m.name} the primary`));
  });

  it('says it and offers nothing to a viewer who cannot edit', async () => {
    loseThePrimary();
    viewport.value = 'narrow' as Viewport;
    const root = await mountApp();
    expect(noticeText(root)).toContain('No database has the primary role.');
    expect(noticeButtons(root)).toEqual([]);
    expect(notice(root)?.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('says it and offers nothing on a static drawing', async () => {
    loseThePrimary();
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(root);
    render(h(CanvasSlot, { interactive: false }), root);
    await painted();
    expect(noticeText(root)).toContain('Not a valid Data Guard configuration');
    expect(noticeButtons(root)).toEqual([]);
    expect(cards(root).length).toBeGreaterThan(0);
  });

  it('Make X the primary restores the primary, the notice goes, the redo returns, in one undo step', async () => {
    loseThePrimary();
    const root = await mountApp();
    const undos = undoStack.value.length;
    expect(redoLines(root)).toBe(0);
    click([...root.querySelectorAll('.cv-invalid button')].find((b) => b.textContent === 'Make sby01 the primary'));
    await painted();
    expect(declaredPrimary(topo())).toBe('sby01');
    expect(notice(root)).toBeNull();
    expect(root.querySelector('.cv-invalid [role="alert"]')).toBeNull();
    expect(redoLines(root)).toBeGreaterThan(0);
    expect(undoStack.value.length).toBe(undos + 1);
    /* One undo gives the lost primary back, notice and all. */
    undo();
    await painted();
    expect(declaredPrimary(topo())).toBeNull();
    expect(notice(root)).not.toBeNull();
    expect(undoStack.value.length).toBe(undos);
    expect(redoStack.value.length).toBe(1);
  });

  it('never renders when a primary exists', async () => {
    for (const m of ['build', 'break', 'configure'] as const) {
      unmountAll();
      mode.value = m;
      resetHistory(classicDoc());
      const root = await mountApp();
      expect(notice(root), m).toBeNull();
      expect(root.querySelector('.cv-invalid-card')).toBeNull();
    }
    expect(redoGraph.value).not.toBeNull();
  });
});

describe('where the cards stand', () => {
  const places = (): Record<string, [number, number]> => Object.fromEntries(
    drawnGeometry.value.nodes.map((n) => [n.key, [n.x, n.y]]),
  );

  it.each(PRESETS.map((p) => p.id))('%s: losing and regaining the primary moves no card', (id) => {
    const preset = PRESETS.find((p) => p.id === id)!;
    resetHistory(makeDoc(preset.doc()));
    const primary = declaredPrimary(topo())!;
    const was = places();
    expect(Object.keys(was).length).toBeGreaterThan(2);
    loseThePrimary();
    expect(redoGraph.value).toBeNull();
    expect(places()).toEqual(was);
    setPrimary(primary);
    expect(redoGraph.value).not.toBeNull();
    expect(places()).toEqual(was);
  });

  it('keeps the layout the reader gave the cards, and the column order they set', () => {
    resetHistory(classicDoc());
    let d = docSignal.value;
    d = withLayout(d, 'sby01', { dx: 24, dy: -16 });
    d = withLayout(d, 'prm01', { dx: 8, dy: 40 });
    d = withLayout(d, 'dc3', { dx: 0, dy: 0, order: 0 });
    resetHistory(d);
    const was = places();
    expect(was['sby01']).toBeDefined();
    loseThePrimary();
    expect(places()).toEqual(was);
    expect(docSignal.value.layout['sby01']).toEqual({ dx: 24, dy: -16 });
    setPrimary(topo().members.find((m) => m.kind === 'database')!.id);
    expect(places()).toEqual(was);
  });
});

describe('the surfaces that draw the redo, not the configuration', () => {
  it('the Detailed timeline says it has nothing to draw, as before', async () => {
    mode.value = 'break';
    loseThePrimary();
    const root = await mountApp();
    expect(root.querySelector('.ln-note')?.textContent).toBe(
      'Nothing to draw: the configuration has no valid redo graph.',
    );
    /* The drawing is above the lanes, and the way out -- a database to give the role to -- is on it. */
    expect(notice(root)).not.toBeNull();
  });

  it('keeps a database role a database role: no primary is invented in the document', () => {
    loseThePrimary();
    const roles = topo().members.filter((m) => m.kind === 'database')
      .map((m) => (m as DatabaseMember).role);
    expect(roles).not.toContain('primary');
    expect(declaredPrimary(topo())).toBeNull();
  });
});
