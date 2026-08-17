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
import { classicTopology, scenarioEvents } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { classicDoc, doc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { clearSelection, mode, selection, tNow, viewport } from '@/state/view';
import { BreakRail } from '@/ui/break/BreakRail';
import { EventMenu, menuOpen } from '@/ui/canvas/EventMenu';
import {
  actionsFor, applyTemplate, clearEvents, describeEvent, isDownAt, removeEventAt, runAction,
  setEventTime, templates,
} from '@/ui/break/events';
import { WHY } from '@/ui/inspector/why';

const mount = (component: () => unknown): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, {}), root);
  return root;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const kinds = (list: readonly TimedEvent[]): string[] => list.map((e) => e.kind);
const byId = (t: TopologyDoc, id: string) => templates(t, 0).find((x) => x.id === id);

beforeEach(() => {
  document.body.innerHTML = '';
  resetHistory(classicDoc());
  viewport.value = 'wide';
  mode.value = 'break';
  tNow.value = 0;
  menuOpen.value = true;
  clearSelection();
});

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
    expect(root.textContent).toContain('Nothing has happened yet');
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
