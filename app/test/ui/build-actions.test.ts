/**
 * The Build action table: one label, one refusal, one edit per act.
 *
 * The table exists so that the drawing, the rail and the Delete key cannot
 * come to say two different things about the same restriction, and that is
 * exactly what this file asserts: the rail's Remove button carries the very
 * `enabled` the table hands the keyboard, the transport segments write the
 * document the inspector's own control writes, and a selection offers the
 * intersection rather than the first subject's list.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { BOUNDS } from '@/engine';
import type { DatabaseMember, TopologyDoc } from '@/engine';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { clearSelection, inspectorOpen, selection, viewport } from '@/state/view';
import { Inspector } from '@/ui/inspector/Inspector';
import { addHost, addSite } from '@/ui/inspector/edits';
import { WHY } from '@/ui/inspector/why';
import {
  buildActionsFor, buildActionsForKey, openInspectorFor, removeAction,
} from '@/ui/build/actions';

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const topo = (): TopologyDoc => doc.value.topology;

const linkRtt = (id: string): number =>
  topo().links.find((l) => (l.id as string) === id)!.rttMs;

/** A button in the rail, found by the words on it, with its reason beside it. */
/* The rail's Remove sits in its header and reads "Remove"; the table's full
   label ("Remove sby01") is its title, followed -- when it is refused -- by the
   reason. */
const byLabel = (root: HTMLElement, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll<HTMLButtonElement>('.insp-hd button.btn')]
    .find((b) => (b.title === label || b.title.startsWith(`${label}: `)) && b.textContent === 'Remove');

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  inspectorOpen.value = false;
  clearSelection();
});

describe('the rail and the table state one removal', () => {
  /* Every subject kind the table resolves, and both answers: a removal that is
     offered and one that is refused. */
  const subjects: [string, string][] = [
    ['member, refused', 'prm01'],
    ['member, offered', 'sby01'],
    ['observer', 'obs01'],
    ['link', 'dc1-dc2'],
    ['site, refused', 'dc1'],
  ];

  for (const [what, key] of subjects) {
    it(`says the same thing on both surfaces for a ${what}`, async () => {
      const action = removeAction(topo(), key);
      expect(action).not.toBeNull();
      selection.value = [key];
      const root = mount(Inspector);
      await tick();
      const button = byLabel(root, action!.label);
      expect(button, `no Remove button labelled ${action!.label}`).not.toBeUndefined();
      /* A refusal is the button's own: its title, and the visually hidden text
         its `aria-describedby` names. No box under the header. */
      expect(root.querySelector('.insp-why')).toBeNull();
      const described = button!.getAttribute('aria-describedby');
      const why = described === null ? null : root.querySelector(`#${described}`)?.textContent ?? null;
      const rendered = button!.disabled
        ? { state: 'off', why: why ?? '' }
        : { state: 'on' };
      expect(rendered).toEqual(action!.enabled);
      if (button!.disabled) expect(button!.title).toBe(`${action!.label}: ${why}`);
      else expect(button!.hasAttribute('aria-describedby')).toBe(false);
    });
  }

  it('offers the removal of a data centre with nothing in it', async () => {
    const id = addSite() as unknown as string;
    const action = removeAction(topo(), id);
    expect(action?.enabled).toEqual({ state: 'on' });
    selection.value = [id];
    const root = mount(Inspector);
    await tick();
    expect(byLabel(root, `Remove ${id}`)?.disabled).toBe(false);
  });

  it('offers Remove for a site holding only a bare host, and removes the site with the host', () => {
    const site = addSite()!;
    const host = addHost(site)!;
    expect(topo().hosts.some((x) => x.id === host)).toBe(true);
    const action = removeAction(topo(), site as unknown as string);
    expect(action?.enabled).toEqual({ state: 'on' });
    action!.run();
    expect(topo().sites.some((s) => s.id === site)).toBe(false);
    expect(topo().hosts.some((x) => x.id === host)).toBe(false);
    undo();
    expect(topo().sites.some((s) => s.id === site)).toBe(true);
    expect(topo().hosts.some((x) => x.id === host)).toBe(true);
  });

  it('refuses Remove for a site a database still stands in', () => {
    expect(removeAction(topo(), 'dc1')?.enabled).toEqual({ state: 'off', why: WHY.siteInUse });
  });

  it('refuses the last database with the last-database reason, not the primary one', () => {
    const base = classicDoc();
    const only = base.topology.members.find((m) => (m.id as string) === 'sby01') as DatabaseMember;
    resetHistory({
      ...base,
      topology: { ...base.topology, members: [{ ...only, role: 'physical' }] },
      layout: {},
    });
    expect(removeAction(topo(), 'sby01')?.enabled).toEqual({ state: 'off', why: WHY.lastMember });
  });

  it('has nothing to say about a key that names nothing', () => {
    expect(removeAction(topo(), 'nothing-here')).toBeNull();
    expect(buildActionsForKey(topo(), 'nothing-here')).toEqual([]);
  });

  it('takes the removal, when it runs, out of the document', () => {
    removeAction(topo(), 'sby01')!.run();
    expect(topo().members.map((m) => m.id as string)).not.toContain('sby01');
  });
});

describe('a selection offers what all of it can do', () => {
  it('drops the ids that are not shared', () => {
    const both = buildActionsFor(topo(), ['prm01', 'obs01']).map((a) => a.id);
    /* A database and an observer share the two acts every subject has, and
       nothing else: a transport belongs to a member, a master to an observer. */
    expect(both).toEqual(['edit', 'remove']);
    const pair = buildActionsFor(topo(), ['prm01', 'sby01']).map((a) => a.id);
    expect(pair).toContain('xpt:SYNC');
    expect(pair).toContain('primary');
  });

  it('keeps the first blocked subject’s reason for the group', () => {
    const remove = buildActionsFor(topo(), ['prm01', 'sby01']).find((a) => a.id === 'remove');
    expect(remove?.enabled).toEqual({ state: 'off', why: WHY.primaryMember });
    expect(remove?.label).toBe('Remove (2)');
  });

  it('presses a segment only when every subject is on it', () => {
    const sync = buildActionsFor(topo(), ['prm01', 'sby01']).find((a) => a.id === 'xpt:SYNC');
    const all = ['prm01', 'sby01']
      .every((k) => topo().members.find((m) => (m.id as string) === k)?.logXptMode === 'SYNC');
    expect(sync?.pressed).toBe(all);
  });

  it('offers one subject its own list, unwrapped', () => {
    /* The runs are closures, so the comparison is of everything a surface
       renders: the id, both labels and the refusal. */
    const shape = (list: readonly { id: string; label: string; plural: string }[]) =>
      list.map(({ id, label, plural }) => ({ id, label, plural }));
    expect(shape(buildActionsFor(topo(), ['sby01'])))
      .toEqual(shape(buildActionsForKey(topo(), 'sby01')));
    expect(buildActionsFor(topo(), [])).toEqual([]);
  });
});

describe('the properties write what the rail writes', () => {
  const xptOf = (id: string): string =>
    topo().members.find((m) => (m.id as string) === id)!.logXptMode;

  it('sets LogXptMode to the same document the transport control does', async () => {
    selection.value = ['sby01'];
    const root = mount(Inspector);
    await tick();
    const seg = root.querySelector('.seg[aria-label="LogXptMode"]');
    const button = [...seg!.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'FASTSYNC');
    expect(button?.disabled).toBe(false);
    button!.click();
    await tick();
    const viaTheRail = topo();
    expect(xptOf('sby01')).toBe('FASTSYNC');

    undo();
    expect(xptOf('sby01')).not.toBe('FASTSYNC');
    buildActionsForKey(topo(), 'sby01').find((a) => a.id === 'xpt:FASTSYNC')!.run();
    expect(topo()).toEqual(viaTheRail);
  });

  it('refuses FASTSYNC outside maximum availability, in the rail’s words', () => {
    const base = classicDoc();
    resetHistory({
      ...base,
      topology: {
        ...base.topology,
        config: { ...base.topology.config, protectionMode: 'MAXPERFORMANCE' },
      },
    });
    const fastsync = buildActionsForKey(topo(), 'sby01').find((a) => a.id === 'xpt:FASTSYNC');
    expect(fastsync?.enabled).toEqual({ state: 'off', why: WHY.fastsyncMode });
    /* The other two are untouched: the restriction is FASTSYNC's alone. */
    for (const id of ['xpt:SYNC', 'xpt:ASYNC']) {
      expect(buildActionsForKey(topo(), 'sby01').find((a) => a.id === id)?.enabled)
        .toEqual({ state: 'on' });
    }
  });

  it('refuses the primary role to the one that holds it, and to a far sync', () => {
    expect(buildActionsForKey(topo(), 'prm01').find((a) => a.id === 'primary')?.enabled)
      .toEqual({ state: 'off', why: WHY.alreadyPrimary });
    expect(buildActionsForKey(topo(), 'sby01').find((a) => a.id === 'primary')?.enabled)
      .toEqual({ state: 'on' });
    buildActionsForKey(topo(), 'sby01').find((a) => a.id === 'primary')!.run();
    const roleOf = (id: string): string =>
      (topo().members.find((m) => (m.id as string) === id) as DatabaseMember).role;
    expect(roleOf('sby01')).toBe('primary');
    expect(roleOf('prm01')).toBe('physical');
  });

  it('refuses the master role to the observer that already has it', () => {
    expect(buildActionsForKey(topo(), 'obs01').find((a) => a.id === 'master')?.enabled)
      .toEqual({ state: 'off', why: WHY.alreadyMaster });
  });

  it('moves the round trip by the engine’s own step, and coalesces into one undo', () => {
    const before = linkRtt('dc1-dc2');
    const step = BOUNDS.latencyMs.step;
    buildActionsForKey(topo(), 'dc1-dc2').find((a) => a.id === 'rtt:+')!.run();
    buildActionsForKey(topo(), 'dc1-dc2').find((a) => a.id === 'rtt:+')!.run();
    expect(linkRtt('dc1-dc2')).toBe(before + 2 * step);
    /* One gesture, one undo: the presses share the slider's coalescing key. */
    undo();
    expect(linkRtt('dc1-dc2')).toBe(before);
  });

  it('refuses at the ends of the range rather than pressing into nothing', () => {
    const base = classicDoc();
    const at = (rttMs: number): void => resetHistory({
      ...base,
      topology: {
        ...base.topology,
        links: base.topology.links.map((l) => ((l.id as string) === 'dc1-dc2' ? { ...l, rttMs } : l)),
      },
    });
    at(BOUNDS.latencyMs.min);
    expect(buildActionsForKey(topo(), 'dc1-dc2').find((a) => a.id === 'rtt:-')?.enabled)
      .toEqual({ state: 'off', why: WHY.rttAtFloor });
    at(BOUNDS.latencyMs.max);
    expect(buildActionsForKey(topo(), 'dc1-dc2').find((a) => a.id === 'rtt:+')?.enabled)
      .toEqual({ state: 'off', why: WHY.rttAtCeiling });
  });

  it('marks a link down and up again, as the steady state rather than an event', () => {
    const up = (): boolean => topo().links.find((l) => (l.id as string) === 'dc1-dc2')!.up;
    const action = buildActionsForKey(topo(), 'dc1-dc2').find((a) => a.id === 'up');
    expect(action?.label).toBe('Mark it down');
    action!.run();
    expect(up()).toBe(false);
    expect(topo().events).toEqual([]);
    expect(buildActionsForKey(topo(), 'dc1-dc2').find((a) => a.id === 'up')?.label)
      .toBe('Mark it up');
  });
});

describe('adding into the data centre the reader named', () => {
  const siteOfNewest = (): string => {
    const member = topo().members.at(-1)!;
    const host = topo().hosts.find((h) => h.id === member.instances[0]!.host);
    return host?.site as string;
  };

  it('puts a standby’s host in that site, not in the automatic one', () => {
    /* dc1 already holds the primary, so the automatic placement would never
       choose it -- which is what makes this assertion mean anything. */
    buildActionsForKey(topo(), 'dc1').find((a) => a.id === 'add:standby')!.run();
    expect(siteOfNewest()).toBe('dc1');
    expect(selection.value).toEqual([topo().members.at(-1)!.id as string]);
  });

  it('puts an observer’s host there too', () => {
    const before = topo().observers.length;
    buildActionsForKey(topo(), 'dc1').find((a) => a.id === 'add:observer')!.run();
    const observer = topo().observers.at(-1)!;
    expect(topo().observers).toHaveLength(before + 1);
    expect(topo().hosts.find((h) => h.id === observer.host)?.site as string).toBe('dc1');
  });

  it('adds a bare host to it', () => {
    const before = topo().hosts.filter((h) => (h.site as string) === 'dc2').length;
    buildActionsForKey(topo(), 'dc2').find((a) => a.id === 'add:host')!.run();
    expect(topo().hosts.filter((h) => (h.site as string) === 'dc2')).toHaveLength(before + 1);
  });
});

describe('Edit puts the rail on the subject', () => {
  it('selects it, and leaves the drawer alone on a wide screen', () => {
    buildActionsForKey(topo(), 'sby01').find((a) => a.id === 'edit')!.run();
    expect(selection.value).toEqual(['sby01']);
    expect(inspectorOpen.value).toBe(false);
  });

  it('opens the drawer where the rail is not a column', () => {
    viewport.value = 'medium';
    openInspectorFor('dc1-dc2');
    expect(selection.value).toEqual(['dc1-dc2']);
    expect(inspectorOpen.value).toBe(true);
  });

  it('lands on the first of a selection rather than opening three rails', () => {
    buildActionsFor(topo(), ['sby01', 'prm01']).find((a) => a.id === 'edit')!.run();
    expect(selection.value).toEqual(['sby01']);
  });
});
