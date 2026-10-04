/**
 * A RAC database's instances: an Instances fold that opens by itself, and each
 * instance row of the card selectable on the drawing, with its own form and
 * its own Remove in the rail.
 *
 * The selection key of an instance is `<member>~<n>` (`state/instanceKey.ts`),
 * and the properties worth pinning down are the ones a refactor would break
 * without anybody noticing: the key never shadows a real id, it survives the
 * address bar, a click on a row selects the row and not the card, and a
 * single-instance database grows no controls it has no use for.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import type { DatabaseMember } from '@/engine';
import { memberId } from '@/engine';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { instanceKey, parseInstanceKey } from '@/state/instanceKey';
import { clearSelection, mode, releaseRail, selection, toast, viewport } from '@/state/view';
import { parseUrlQuery, serializeUrlQuery, URL_DEFAULTS } from '@/state/url';
import { App } from '@/ui/App';
import { barOpen, closeBar } from '@/ui/canvas/bar';
import { anchorFor } from '@/ui/canvas/anchor';
import { instanceLabel } from '@/ui/canvas/aria';
import { layoutTopology } from '@/ui/canvas/layout';
import { Inspector, resolveSubject } from '@/ui/inspector/Inspector';
import { addInstance, patchDatabase } from '@/ui/inspector/edits';
import { openSections, resetSections } from '@/ui/inspector/sections';
import { WHY } from '@/ui/inspector/why';
import { buildActionsForKey } from '@/ui/build/actions';
import { graphOf } from './canvas-fixtures';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mounted: HTMLElement[] = [];
const mountApp = async (): Promise<HTMLElement> => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(root);
  render(h(App, {}), root);
  await tick();
  return root;
};
const unmountAll = (): void => {
  for (const root of mounted.splice(0)) render(null, root);
  document.body.innerHTML = '';
};

const topo = () => doc.value.topology;
const sby = (): DatabaseMember => topo().members.find((m) => (m.id as string) === 'sby01') as DatabaseMember;
const fold = (root: HTMLElement): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('.grp-tog')]
    .find((b) => /^Instance/.test(b.textContent ?? ''));
const row = (root: HTMLElement, key: string): SVGGElement | null =>
  root.querySelector<SVGGElement>(`.tp-instance[data-node="${key}"]`);
const click = async (el: Element): Promise<void> => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick();
};
const key = async (el: Element, k: string, init: KeyboardEventInit = {}): Promise<void> => {
  (el as unknown as HTMLElement).focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  await tick();
};
const railText = (root: HTMLElement): string => root.querySelector('.insp')?.textContent ?? '';

beforeEach(() => {
  unmountAll();
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'build';
  toast.value = null;
  closeBar();
  clearSelection();
  releaseRail();
  resetSections();
});

describe('the Instances fold', () => {
  it('opens by itself for a RAC database and stays shut for a single instance', async () => {
    selection.value = ['sby01'];
    const root = await mountApp();
    expect(fold(root)?.textContent).toContain('Instance');
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.is-inst')).toBeNull();

    addInstance(memberId('sby01'));
    await tick();
    expect(sby().instances).toHaveLength(2);
    expect(fold(root)?.textContent).toContain('Instances (RAC, 2)');
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelectorAll('.is-inst')).toHaveLength(2);
    /* It opened by default, not by being toggled: nothing is remembered yet. */
    expect(openSections.value.has('Instances')).toBe(false);
  });

  it('remembers the reader shutting it, for the next RAC database too', async () => {
    addInstance(memberId('sby01'));
    selection.value = ['sby01'];
    const root = await mountApp();
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('true');
    fold(root)!.click();
    await tick();
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.is-inst')).toBeNull();

    /* Another selection and back: still shut. */
    selection.value = ['prm01'];
    await tick();
    selection.value = ['sby01'];
    await tick();
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('false');

    /* And open again on request, which is then the reader's choice too. */
    fold(root)!.click();
    await tick();
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(openSections.value.has('Instances')).toBe(true);
  });

  it('keeps a single-instance database folded even after the reader opened it once', async () => {
    selection.value = ['prm01'];
    const root = await mountApp();
    fold(root)!.click();
    await tick();
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('true');
    fold(root)!.click();
    await tick();
    expect(fold(root)?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the selection key', () => {
  it('is the member and the 1-based place, and nothing else parses as one', () => {
    expect(instanceKey('sby01', 0)).toBe('sby01~1');
    expect(parseInstanceKey('sby01~2')).toEqual({ member: 'sby01', index: 1 });
    expect(parseInstanceKey('sby01')).toBeNull();
    expect(parseInstanceKey('~2')).toBeNull();
    expect(parseInstanceKey('sby01~0')).toBeNull();
    expect(parseInstanceKey('sby01~x')).toBeNull();
    expect(parseInstanceKey('redo:prm01:sby01')).toBeNull();
  });

  it('cannot shadow a real id: the exact id always resolves first', () => {
    addInstance(memberId('sby01'));
    expect(resolveSubject(topo(), 'sby01~2')).toMatchObject({ kind: 'instance', index: 1 });
    const t = { ...topo(), members: topo().members.map((m) => ((m.id as string) === 'prm01' ? { ...m, id: memberId('sby01~2') } : m)) };
    expect(resolveSubject(t, 'sby01~2')).toMatchObject({ kind: 'member' });
  });

  it('resolves to nothing for a place that is not there', () => {
    expect(resolveSubject(topo(), 'sby01~3')).toBeNull();
    expect(resolveSubject(topo(), 'ghost~1')).toBeNull();
  });

  it('round trips through ?sel=', () => {
    const state = { ...URL_DEFAULTS, sel: ['sby01~2', 'prm01'] };
    const q = serializeUrlQuery(state);
    expect(parseUrlQuery(`?${q}`).state.sel).toEqual(['sby01~2', 'prm01']);
    expect(parseUrlQuery('?sel=sby01~2').state.sel).toEqual(['sby01~2']);
    expect(parseUrlQuery('?sel=sby01~<b>').state.sel).toEqual([]);
  });
});

describe('an instance on the drawing', () => {
  it('is a control on a RAC card only, in Build only', async () => {
    addInstance(memberId('sby01'));
    let root = await mountApp();
    expect(root.querySelectorAll('.tp-instance.is-live')).toHaveLength(2);
    expect(row(root, 'sby01~1')?.getAttribute('role')).toBe('button');
    expect(row(root, 'sby01~2')?.getAttribute('tabindex')).toBe('0');
    expect(row(root, 'sby01~2')?.getAttribute('aria-label')).toContain('Instance sby012, 2 of 2, of sby01');
    /* prm01 is one instance: no rows, no chips. */
    expect(root.querySelector('[data-node^="prm01~"]')).toBeNull();
    expect(root.querySelector('[data-node="prm01"] .tp-instance')).toBeNull();

    unmountAll();
    mode.value = 'break';
    /* The drawing is on screen in the Detailed timeline only in the docked layout. */
    viewport.value = 'compact';
    root = await mountApp();
    expect(root.querySelectorAll('.tp-instance')).toHaveLength(2);
    expect(root.querySelector('.tp-instance.is-live')).toBeNull();
    expect(root.querySelector('.tp-instance[data-node]')).toBeNull();
  });

  it('selects the row on a click, not the card, and the rail shows its form', async () => {
    addInstance(memberId('sby01'));
    const root = await mountApp();
    await click(row(root, 'sby01~2')!);
    expect(selection.value).toEqual(['sby01~2']);
    /* The rail arrives a moment after the first click of a selection (view.ts,
       `railHeld`); stand in for the moment. */
    releaseRail();
    await tick();
    expect(row(root, 'sby01~2')!.querySelector('rect.tp-card')!.getAttribute('class')).toContain('is-sel');
    expect(row(root, 'sby01~2')!.getAttribute('aria-pressed')).toBe('true');
    expect(row(root, 'sby01~1')!.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.insp-kind')?.textContent).toBe('RAC instance of sby01');
    expect(root.querySelector('.insp-hd .insp-title')?.textContent).toBe('sby012');
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Instance name"]')?.value).toBe('sby012');
    expect(root.querySelector<HTMLSelectElement>('select[aria-label="Host"]')?.value).toBe(sby().instances[1]!.host);
    /* The database's own form is not on the rail. */
    expect(railText(root)).not.toContain('db_unique_name');
    /* The rest of the card still selects the database. */
    await click(root.querySelector('.tp-node[data-node="sby01"] rect.tp-card')!);
    expect(selection.value).toEqual(['sby01']);
    expect(root.querySelector('.insp-hd input[aria-label="db_unique_name"]')).not.toBeNull();
  });

  it('is reached with the keyboard: Enter selects the row, and the card keeps its own Enter', async () => {
    addInstance(memberId('sby01'));
    const root = await mountApp();
    await key(row(root, 'sby01~1')!, 'Enter');
    expect(selection.value).toEqual(['sby01~1']);
    await key(root.querySelector('.tp-node[data-node="sby01"]')!, 'Enter');
    expect(selection.value).toEqual(['sby01']);
    await key(row(root, 'sby01~2')!, ' ');
    expect(selection.value).toEqual(['sby01~2']);
  });

  it('ignores Shift: a row is never added to a selection of cards', async () => {
    addInstance(memberId('sby01'));
    selection.value = ['prm01'];
    const root = await mountApp();
    row(root, 'sby01~2')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    await tick();
    expect(selection.value).toEqual(['sby01~2']);
  });

  it('offers Edit and Remove on the bar and nothing that is about the whole database', async () => {
    addInstance(memberId('sby01'));
    const ids = buildActionsForKey(topo(), 'sby01~2').map((a) => a.id);
    expect(ids).toEqual(['edit', 'remove']);
    const root = await mountApp();
    await click(row(root, 'sby01~2')!);
    root.querySelector('.tp-more')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    expect(barOpen.value).toBe('sby01~2');
    const rows = [...root.querySelectorAll('.cv-bar-row button')].map((b) => b.textContent);
    expect(rows).toEqual(['Edit instance sby012', 'Remove instance sby012']);
    expect(root.querySelector('.cv-bar-hd .mono')?.textContent).toBe('Instance sby012 of sby01');
  });

  it('removes the instance from the bar, and lands on the database', async () => {
    addInstance(memberId('sby01'));
    const root = await mountApp();
    await click(row(root, 'sby01~2')!);
    root.querySelector('.tp-more')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    const remove = [...root.querySelectorAll<HTMLButtonElement>('.cv-bar-row button')]
      .find((b) => b.textContent === 'Remove instance sby012')!;
    remove.click();
    await tick();
    expect(sby().instances).toHaveLength(1);
    expect(selection.value).toEqual(['sby01']);
    expect(root.querySelector('.tp-instance')).toBeNull();
    undo();
    await tick();
    expect(sby().instances).toHaveLength(2);
  });

  it('removes on Delete, like a card, and only that instance', async () => {
    addInstance(memberId('sby01'));
    const root = await mountApp();
    await key(row(root, 'sby01~2')!, 'Delete');
    expect(sby().instances.map((i) => i.name)).toEqual(['sby01']);
    expect(topo().members.map((m) => m.id as string)).toContain('sby01');
    expect(selection.value).not.toContain('sby01~2');
  });

  it('hangs its bar from its own row', async () => {
    addInstance(memberId('sby01'));
    const g = layoutTopology(topo(), graphOf(topo()));
    const node = g.byKey['sby01']!;
    const a = anchorFor('sby01~2', g, [])!;
    expect(a.x).toBeGreaterThan(node.x);
    expect(a.y).toBeGreaterThan(node.y + 60);
    expect(a.y + a.h).toBeLessThanOrEqual(node.y + node.h);
    const first = anchorFor('sby01~1', g, [])!;
    expect(a.y).toBeGreaterThan(first.y);
    expect(anchorFor('sby01~9', g, [])).toBeNull();
  });

  it('is named in words for a screen reader, with what the frame says of it', () => {
    addInstance(memberId('sby01'));
    const node = layoutTopology(topo(), graphOf(topo())).byKey['sby01']!;
    expect(instanceLabel(node, 0)).toMatch(/^Instance sby01, 1 of 2, of sby01, on host dc2-sby01/);
    expect(instanceLabel(node, 1, { down: true, coordinator: false, apply: false })).toContain('It is down.');
    expect(instanceLabel(node, 0, { down: false, coordinator: true, apply: true })).toContain('the apply instance');
  });
});

describe('the instance form in the rail', () => {
  const mountRail = async (k: string): Promise<HTMLElement> => {
    selection.value = [k];
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(root);
    render(h(Inspector, {}), root);
    await tick();
    return root;
  };
  const change = async (el: HTMLInputElement | HTMLSelectElement, v: string): Promise<void> => {
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  };

  it('renames the instance, keeps PreferredApplyInstance with it and keeps the selection', async () => {
    addInstance(memberId('sby01'));
    patchDatabase(memberId('sby01'), 'prefer', (m) => ({ ...m, preferredApplyInstance: 'sby012' }));
    const root = await mountRail('sby01~2');
    await change(root.querySelector<HTMLInputElement>('input[aria-label="Instance name"]')!, ' sby01b ');
    expect(sby().instances.map((i) => i.name)).toEqual(['sby01', 'sby01b']);
    expect(sby().preferredApplyInstance).toBe('sby01b');
    expect(selection.value).toEqual(['sby01~2']);
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Instance name"]')?.value).toBe('sby01b');
  });

  it('moves it to another host', async () => {
    addInstance(memberId('sby01'));
    const root = await mountRail('sby01~2');
    await change(root.querySelector<HTMLSelectElement>('select[aria-label="Host"]')!, 'dc1-prm01');
    expect(sby().instances[1]!.host as string).toBe('dc1-prm01');
    expect(sby().instances[0]!.host as string).not.toBe('dc1-prm01');
  });

  it('removes it, and selects the database', async () => {
    addInstance(memberId('sby01'));
    const root = await mountRail('sby01~1');
    const remove = [...root.querySelectorAll<HTMLButtonElement>('.insp .btn')].find((b) => b.textContent === 'Remove')!;
    expect(remove.disabled).toBe(false);
    remove.click();
    await tick();
    expect(sby().instances.map((i) => i.name)).toEqual(['sby012']);
    expect(selection.value).toEqual(['sby01']);
  });

  it('refuses to remove the last instance, and says why', async () => {
    const root = await mountRail('sby01~1');
    const remove = [...root.querySelectorAll<HTMLButtonElement>('.insp .btn')].find((b) => b.textContent === 'Remove')!;
    expect(remove.disabled).toBe(true);
    expect(root.querySelector('.insp')?.textContent).toContain(WHY.lastInstance);
    const acts = buildActionsForKey(topo(), 'sby01~1');
    expect(acts.find((a) => a.id === 'remove')?.enabled).toEqual({ state: 'off', why: WHY.lastInstance });
    /* The header's Remove is the same table entry. */
    const head = root.querySelector<HTMLButtonElement>('.insp-remove');
    expect(head?.disabled).toBe(true);
  });

  it('can go back to the database in one press', async () => {
    addInstance(memberId('sby01'));
    const root = await mountRail('sby01~2');
    [...root.querySelectorAll<HTMLButtonElement>('.insp .btn')].find((b) => b.textContent === 'Select sby01')!.click();
    await tick();
    expect(selection.value).toEqual(['sby01']);
  });
});
