/**
 * Several applications on one drawing, each with the connect string it dials.
 *
 * The engine's half (the model, the reader, the share link) is
 * `test/applications.test.ts`; the single application every preset carries is
 * `test/ui/application.test.ts`. Here: adding the second and the third from
 * the toolbar, removing one and leaving the others, an application's own
 * connect string and the edits that reach it, and each application's lanes,
 * readout and events on Break.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import {
  applicationClient, applicationsOf, declaredPrimary, findApplication, resolveRedoGraph, scenarioEvents,
  simulate, siteId,
} from '@/engine';
import type { TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import { doc as docSignal, makeDoc } from '@/state/doc';
import { redo, resetHistory, undo } from '@/state/history';
import { readoutFor } from '@/state/derived';
import { hoverTools, actionsForKey } from '@/ui/break/events';
import { buildActionsForKey } from '@/ui/build/actions';
import { layoutTopology } from '@/ui/canvas/layout';
import { routeTopology } from '@/ui/canvas/routing';
import { Inspector } from '@/ui/inspector/Inspector';
import { AddToolbar } from '@/ui/inspector/adds';
import {
  addApplication, moveToSite, patchClient, removeApplication, renameApplication, setAddressListed,
  setOwnClient,
} from '@/ui/inspector/edits';
import { hintsOn, selection } from '@/state/view';
import { buildTimeline } from '@/ui/timeline/build';

/** jsdom hands back a bare object for localStorage here; persistence needs something to write to. */
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, String(v)); },
    removeItem: (k: string) => { memory.delete(k); },
    clear: () => { memory.clear(); },
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() { return memory.size; },
  } as unknown as Storage,
});

const preset = (id: string): TopologyDoc => PRESETS.find((p) => p.id === id)!.doc();
const topo = (): TopologyDoc => docSignal.value.topology;
const load = (events: TopologyDoc['events'] = []): void => {
  resetHistory(makeDoc({ ...preset('classic'), events }));
};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const mountWith = (component: unknown, props: Record<string, unknown>): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(component as never, props), root);
  return root;
};
const names = (t: TopologyDoc = topo()): string[] => applicationsOf(t).map((a) => a.id as string);
const draw = (t: TopologyDoc) => {
  const graph = resolveRedoGraph(t, { primary: declaredPrimary(t)! });
  const geo = layoutTopology(t, graph);
  return { geo, links: routeTopology(t, graph, geo, null).links };
};

beforeEach(() => {
  document.body.innerHTML = '';
  selection.value = [];
  hintsOn.value = false;
  load();
});

describe('adding applications from the toolbar', () => {
  it('offers + Application while one is drawn, and adds the second and the third', async () => {
    const bar = mountWith(AddToolbar, { doc: topo() });
    await tick();
    const button = (): HTMLButtonElement => [...bar.querySelectorAll<HTMLButtonElement>('.cv-add .btn')]
      .find((b) => b.textContent?.includes('+ Application'))!;
    expect(names()).toEqual(['app01']);
    expect(button().disabled).toBe(false);
    button().click();
    await tick();
    expect(names()).toEqual(['app01', 'app02']);
    expect(button().disabled).toBe(false);
    button().click();
    await tick();
    expect(names()).toEqual(['app01', 'app02', 'app03']);
    /* Each stands on a host of its own, in the primary's data centre to start with. */
    const hosts = applicationsOf(topo()).map((a) => a.host as string);
    expect(new Set(hosts).size).toBe(3);
    const sites = hosts.map((hid) => topo().hosts.find((x) => (x.id as string) === hid)?.site as string);
    expect(sites).toEqual(['dc1', 'dc1', 'dc1']);
    /* The new one is selected, and each add is one undo. */
    expect(selection.value).toEqual(['app03']);
    undo();
    expect(names()).toEqual(['app01', 'app02']);
    redo();
    expect(names()).toEqual(['app01', 'app02', 'app03']);
  });

  it('draws them side by side under the databases, each with its own lines', () => {
    addApplication();
    addApplication(siteId('dc2'));
    const { geo, links } = draw(topo());
    const a1 = geo.byKey['app01']!; const a2 = geo.byKey['app02']!; const a3 = geo.byKey['app03']!;
    expect(a1.site).toBe(a2.site);
    expect(a1.y).toBe(a2.y);
    /* No two cards overlap. */
    expect(a2.x).toBeGreaterThanOrEqual(a1.x + a1.w);
    expect(a3.site).not.toBe(a1.site);
    const lines = links.filter((l) => l.kind === 'connect').map((l) => l.id);
    expect(lines).toEqual([
      'connect:app01:prm01', 'connect:app01:sby01',
      'connect:app02:prm01', 'connect:app02:sby01',
      'connect:app03:prm01', 'connect:app03:sby01',
    ].sort((a, b) => lines.indexOf(a) - lines.indexOf(b)));
    expect(lines).toHaveLength(6);
    /* Every line ends on the edge of the database card it names. */
    for (const l of links.filter((x) => x.kind === 'connect')) {
      const to = geo.byKey[l.to]!;
      const end = l.points.at(-1)!;
      const onX = Math.abs(end.x - to.x) < 0.5 || Math.abs(end.x - (to.x + to.w)) < 0.5;
      const onY = Math.abs(end.y - to.y) < 0.5 || Math.abs(end.y - (to.y + to.h)) < 0.5;
      const within = end.x >= to.x - 0.5 && end.x <= to.x + to.w + 0.5 && end.y >= to.y - 0.5 && end.y <= to.y + to.h + 0.5;
      expect(within && (onX || onY), l.id).toBe(true);
    }
  });
});

describe('removing one application', () => {
  it('leaves the other with its host, its lines and its own connect string', () => {
    addApplication();
    setOwnClient('app02', true);
    patchClient('Set RETRY_COUNT', (c) => ({ ...c, retryCount: 3 }), undefined, 'app02');
    const keptHost = findApplication(topo(), 'app02')!.host;
    removeApplication('app01');
    expect(names()).toEqual(['app02']);
    expect(topo().hosts.some((x) => (x.id as string) === 'dc1-app01')).toBe(false);
    expect(topo().hosts.some((x) => x.id === keptHost)).toBe(true);
    expect(findApplication(topo(), 'app02')?.client?.retryCount).toBe(3);
    expect(draw(topo()).links.filter((l) => l.kind === 'connect').every((l) => l.id.startsWith('connect:app02:'))).toBe(true);
    /* Removing the last leaves a document with none, and the shared string as it was. */
    removeApplication('app02');
    expect(topo().applications).toBeUndefined();
    expect(topo().client.addresses).toHaveLength(2);
    undo();
    undo();
    expect(names()).toEqual(['app01', 'app02']);
  });

  it('is what the action on the card runs: this application, not the first', () => {
    addApplication();
    const remove = buildActionsForKey(topo(), 'app02').find((a) => a.id === 'remove')!;
    remove.run();
    expect(names()).toEqual(['app01']);
  });

  it('renames one application and leaves the others', () => {
    addApplication();
    renameApplication('app02', 'billing');
    expect(names()).toEqual(['app01', 'billing']);
    renameApplication('billing', 'app01');
    expect(names()).toEqual(['app01', 'billing']);
  });
});

describe('an application\'s own connect string', () => {
  it('starts as a copy of the shared one and is edited on its own', () => {
    addApplication();
    expect(applicationClient(topo(), findApplication(topo(), 'app02')!)).toBe(topo().client);
    setOwnClient('app02', true);
    const own = findApplication(topo(), 'app02')!.client!;
    expect(own).toEqual(topo().client);
    expect(own).not.toBe(topo().client);
    expect(own.addresses).not.toBe(topo().client.addresses);
    /* An edit made through app02 reaches app02's descriptor only. */
    patchClient('Set SERVICE_NAME', (c) => ({ ...c, serviceName: 'billing_svc' }), 'client:sn', 'app02');
    expect(findApplication(topo(), 'app02')!.client!.serviceName).toBe('billing_svc');
    expect(topo().client.serviceName).toBe('app_svc');
    /* And an edit through app01, which shares, reaches the shared one, not app02's. */
    patchClient('Set RETRY_COUNT', (c) => ({ ...c, retryCount: 2 }), 'client:rc', 'app01');
    expect(topo().client.retryCount).toBe(2);
    expect(findApplication(topo(), 'app02')!.client!.retryCount).toBe(0);
    /* Back to the shared string: the own one is gone. */
    setOwnClient('app02', false);
    expect(findApplication(topo(), 'app02')!.client).toBeUndefined();
    expect(applicationClient(topo(), findApplication(topo(), 'app02')!).retryCount).toBe(2);
  });

  it('edits the ADDRESS_LIST of the application it was made for, and draws the lines of each list', () => {
    addApplication();
    setOwnClient('app02', true);
    setAddressListed('app02', 'sby01' as never, false);
    expect(findApplication(topo(), 'app02')!.client!.addresses.map((a) => a.host as string)).toEqual(['dc1-prm01']);
    expect(topo().client.addresses).toHaveLength(2);
    const ids = draw(topo()).links.filter((l) => l.kind === 'connect').map((l) => l.id);
    expect(ids).toContain('connect:app01:sby01');
    expect(ids).not.toContain('connect:app02:sby01');
    expect(ids).toContain('connect:app02:prm01');
    /* Its own list follows a database that moves data centre. */
    setOwnClient('app02', false);
    setOwnClient('app02', true);
    moveToSite('sby01', siteId('dc3'));
    const moved = topo().members.find((m) => (m.id as string) === 'sby01')!.instances[0]!.host;
    expect(findApplication(topo(), 'app02')!.client!.addresses.map((a) => a.host)).toContain(moved);
    expect(topo().client.addresses.map((a) => a.host)).toContain(moved);
  });

  it('is chosen in the rail: the shared string is the default, and Own connect string copies it', async () => {
    addApplication();
    selection.value = ['app02'];
    hintsOn.value = true;
    const rail = mountWith(Inspector, {});
    await tick();
    const seg = (label: string): HTMLButtonElement => [...rail.querySelectorAll<HTMLButtonElement>('.seg button')]
      .find((b) => b.textContent === label)!;
    expect(seg('Use the shared connect string').getAttribute('aria-pressed')).toBe('true');
    expect(seg('Own connect string').getAttribute('aria-pressed')).toBe('false');
    expect(rail.innerHTML).toContain('dialled by app01');
    seg('Own connect string').click();
    await tick();
    expect(findApplication(topo(), 'app02')!.client).toBeDefined();
    expect(seg('Own connect string').getAttribute('aria-pressed')).toBe('true');
    seg('Use the shared connect string').click();
    await tick();
    expect(findApplication(topo(), 'app02')!.client).toBeUndefined();
    hintsOn.value = false;
  });
});

describe('Break: each application on its own', () => {
  const crashed = (): void => {
    addApplication();
    setOwnClient('app02', true);
    patchClient('Retry', (c) => ({ ...c, retryCount: 2 }), undefined, 'app02');
    const t = topo();
    docSignal.value = { ...docSignal.value, topology: { ...t, events: scenarioEvents('crash', t) } };
  };

  it('draws the three lanes of every application, under its own heading, on one axis', () => {
    crashed();
    const t = topo();
    const m = buildTimeline(simulate(t, t.events), t, { width: 1200 });
    expect(m.appSections.map((s) => [s.id, s.title])).toEqual([
      ['app01', "app01's view"], ['app02', "app02's view"],
    ]);
    const app = m.lanes.filter((l) => l.group === 'app');
    expect(app.map((l) => `${l.id}:${l.name}`)).toEqual([
      'app01:Service', 'app01:Sessions', 'app01:New connections',
      'app02:Service', 'app02:Sessions', 'app02:New connections',
    ]);
    expect(new Set(app.map((l) => l.key)).size).toBe(6);
    /* The headings sit above their own lanes, one after the other. */
    const [h1, h2] = m.appSections as [typeof m.appSections[0], typeof m.appSections[0]];
    expect(h1.y).toBeLessThan(app[0]!.y);
    expect(h2.y).toBeGreaterThan(app[2]!.y);
    expect(h2.y).toBeLessThan(app[3]!.y);
    expect(m.lanesBottom).toBe(app[5]!.y + app[5]!.height);
    /* One reconnect mark each, on its own connect lane. */
    const marks = m.markers.filter((x) => x.kind === 'app');
    expect(marks.map((x) => x.key)).toEqual(['app-reconnect:app01', 'app-reconnect:app02']);
    expect(marks.map((x) => x.laneKey)).toEqual(['application:app01:connect', 'application:app02:connect']);
  });

  it('keeps the plain heading while there is one application', () => {
    const t = { ...topo(), events: scenarioEvents('crash', topo()) };
    const m = buildTimeline(simulate(t, t.events), t, { width: 1200 });
    expect(m.appSections.map((s) => s.title)).toEqual(["The application's view"]);
  });

  it('reads out each application: its own name, its own result', () => {
    addApplication();
    const t = topo();
    /* app02 in the standby's data centre, on the far side of a cut. */
    moveToSite('app02', siteId('dc2'));
    const doc2 = topo();
    docSignal.value = { ...docSignal.value, topology: { ...doc2, events: scenarioEvents('partition', doc2) } };
    const chips = readoutFor(false);
    const apps = chips.filter((c) => c.group === 'app');
    /* app01 is unaffected and has nothing to say; app02 is cut off and says so by name. */
    expect(apps.map((c) => [c.k, c.v])).toEqual([['app02', 'stays down']]);
    expect(apps[0]!.sub).toContain('app02');
    void t;
  });

  it('gives every application its own chip when several are affected, with distinct ids', () => {
    addApplication();
    const t = topo();
    docSignal.value = { ...docSignal.value, topology: { ...t, events: scenarioEvents('crash', t) } };
    const apps = readoutFor(false).filter((c) => c.group === 'app');
    expect(apps.map((c) => c.k)).toEqual(['app01 reconnects', 'app02 reconnects']);
    expect(new Set(apps.map((c) => c.id)).size).toBe(2);
    expect(apps[0]!.id).toBe('app');
  });

  it('crashes the host of the application it is asked about', () => {
    addApplication();
    const t = topo();
    const down = (key: string) => actionsForKey(t, key, 0).find((a) => a.id === 'host.down')!;
    const host = (key: string) => findApplication(t, key)!.host;
    expect(down('app01').events).toEqual([{ at: 0, kind: 'host.down', host: host('app01') }]);
    expect(down('app02').events).toEqual([{ at: 0, kind: 'host.down', host: host('app02') }]);
    expect(host('app01')).not.toBe(host('app02'));
    /* With app02's host down at t = 0, app02 is down and app01 is not. */
    const withDown = { ...t, events: down('app02').events };
    expect(actionsForKey(withDown, 'app02', 5).find((a) => a.id === 'host.down')!.enabled.state).toBe('off');
    expect(actionsForKey(withDown, 'app01', 5).find((a) => a.id === 'host.down')!.enabled.state).toBe('on');
    expect(hoverTools(withDown, 'app02', 5)[0]).toMatchObject({ id: 'host.up' });
    expect(hoverTools(withDown, 'app01', 5)[0]).toMatchObject({ id: 'host.down' });
  });
});
