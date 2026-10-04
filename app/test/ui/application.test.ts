/**
 * The application on the drawing, in the rail and on the timeline.
 *
 * Geometry, edits and lanes -- the engine's half is `test/app-placement.test.ts`.
 * The presets are the fixtures: every one of them carries the application
 * beside its primary.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { declaredPrimary, resolveRedoGraph, scenarioEvents, simulate, siteId, stateAt } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import { doc as docSignal, makeDoc } from '@/state/doc';
import { resetHistory, undo } from '@/state/history';
import { actionsForKey, hoverTools } from '@/ui/break/events';
import { buildActionsForKey, removeAction } from '@/ui/build/actions';
import { cardLabel, describeTopology, siteLabel } from '@/ui/canvas/aria';
import { mergeVerdict, WHY_APPLICATION_OWN_HOST } from '@/ui/canvas/drop';
import { LAYOUT, layoutTopology } from '@/ui/canvas/layout';
import { cardFrameFor, chipsFor, routeTopology } from '@/ui/canvas/routing';
import {
  addApplication, addDatabase, connectVerdict, moveToSite, removeApplication, renameApplication,
  renameVerdict, setAddressListed,
} from '@/ui/inspector/edits';
import { resolveSubject } from '@/ui/inspector/Inspector';
import { WHY } from '@/ui/inspector/why';
import { appModelsFor, axisSpan, buildTimeline } from '@/ui/timeline/build';

const preset = (id: string): TopologyDoc => PRESETS.find((p) => p.id === id)!.doc();
const topo = (): TopologyDoc => docSignal.value.topology;
const load = (id: string): void => resetHistory(makeDoc({ ...preset(id), events: [] }));
const draw = (t: TopologyDoc, at: number | null = null) => {
  const graph = resolveRedoGraph(t, { primary: declaredPrimary(t)! });
  const geo = layoutTopology(t, graph);
  const frame = at === null ? null : stateAt(simulate(t, t.events), at);
  return { graph, geo, frame, links: routeTopology(t, graph, geo, frame).links };
};

beforeEach(() => load('classic'));

describe('the application on the drawing', () => {
  it('stands under the member band, in the primary\'s data centre', () => {
    const { geo } = draw(topo());
    const app = geo.byKey['app01']!;
    const prm = geo.byKey['prm01']!;
    expect(app.kind).toBe('application');
    expect(app.site).toBe(prm.site);
    expect(app.col).toBe(prm.col);
    expect(app.y).toBe(prm.y + prm.h + LAYOUT.appGap);
    /* Its data centre's box holds both. */
    const dc1 = geo.sites.find((s) => (s.id as string) === 'dc1')!;
    expect(dc1.y + dc1.h).toBeGreaterThan(app.y + app.h);
    expect(geo.midLaneY).toBe(prm.y + prm.h + LAYOUT.midLane);
  });

  it('draws no card, and no lane between the bands, for a document without one', () => {
    const { applications: _none, ...bare } = topo();
    const { geo, links } = draw(bare);
    expect(geo.nodes.some((n) => n.kind === 'application')).toBe(false);
    expect(geo.midLaneY).toBeNull();
    expect(links.some((l) => l.kind === 'connect')).toBe(false);
  });

  it('draws one line to every database on its ADDRESS_LIST, from below', () => {
    const { geo, links } = draw(topo());
    const lines = links.filter((l) => l.kind === 'connect');
    expect(lines.map((l) => l.id)).toEqual(['connect:app01:prm01', 'connect:app01:sby01']);
    for (const l of lines) {
      const to = geo.byKey[l.to]!;
      const end = l.points.at(-1)!;
      expect(end.y, l.id).toBe(to.y + to.h);
      expect(l.arrow).toBe(false);
    }
    /* The one carrying sessions is the one to the database publishing the service. */
    expect(lines.find((l) => l.to === 'prm01')).toMatchObject({ active: true, caption: 'sessions' });
    expect(lines.find((l) => l.to === 'sby01')).toMatchObject({ active: false, caption: 'address' });
  });

  it('follows the run: the line to the new primary carries the sessions', () => {
    resetHistory(makeDoc({ ...preset('classic'), events: scenarioEvents('crash', preset('classic')) }));
    const { links, geo, frame } = draw(topo(), 50);
    expect(links.find((l) => l.id === 'connect:app01:prm01')).toMatchObject({ down: true, value: 'down' });
    expect(links.find((l) => l.id === 'connect:app01:sby01')).toMatchObject({ active: true, caption: 'sessions' });
    expect(cardFrameFor(topo(), geo.byKey['app01']!, frame)).toMatchObject({ phase: 'serving', down: false });
    /* Before the new primary opens the card is up and not getting anywhere. */
    const waiting = draw(topo(), 10);
    expect(cardFrameFor(topo(), waiting.geo.byKey['app01']!, waiting.frame))
      .toMatchObject({ phase: 'waiting', stalled: true, down: false });
  });

  it('says a severed address is cut, and a lost application is down', () => {
    const t = preset('classic');
    resetHistory(makeDoc({ ...t, events: scenarioEvents('partition', t) }));
    expect(draw(topo(), 5).links.find((l) => l.id === 'connect:app01:sby01'))
      .toMatchObject({ cut: true, value: 'cut' });
    resetHistory(makeDoc({ ...t, events: [{ at: 0, kind: 'host.down', host: t.applications![0]!.host }] }));
    const lost = draw(topo(), 5);
    expect(lost.links.filter((l) => l.kind === 'connect').every((l) => l.down)).toBe(true);
    expect(cardFrameFor(topo(), lost.geo.byKey['app01']!, lost.frame)).toMatchObject({ down: true, crashed: true });
  });

  it('wears what it is as a chip, and is named in the drawing\'s own words', () => {
    const { geo, graph } = draw(topo());
    expect(chipsFor(topo(), geo.byKey['app01']!).map((c) => c.text)).toEqual(['APP']);
    expect(cardLabel(topo(), graph, geo.byKey['app01']!)).toBe('app01, the application on host dc1-app01 in DC1.');
    expect(siteLabel(topo(), { id: 'dc1', name: 'DC1' })).toBe('Data centre DC1: 1 member, 0 observers, the application.');
    const model = describeTopology(topo(), graph);
    expect(model.summary).toContain('1 application');
    expect(model.sentences).toContain(
      'The application app01 runs on host dc1-app01 in DC1; its connect string names prm01, sby01.',
    );
    expect(model.rows.at(-1)).toMatchObject({ member: 'app01', role: 'Application', host: 'dc1-app01' });
  });
});

describe('the drawing with room round its cards', () => {
  it('draws a data centre roomier than a resize may make it', () => {
    const { geo } = draw(topo());
    const dc2 = geo.sites.find((s) => (s.id as string) === 'dc2')!;
    const sby = geo.byKey['sby01']!;
    expect(sby.x - dc2.x).toBe(LAYOUT.colPad);
    expect(sby.y - dc2.y).toBe(LAYOUT.colPad);
    expect(sby.x - dc2.fit.x).toBe(LAYOUT.fitPad);
    expect(LAYOUT.colPad).toBeGreaterThan(LAYOUT.fitPad);
  });

  it('still runs the observers\' trunks under an observer-only data centre\'s name', () => {
    load('multi-target-three-observers');
    const { geo, links } = draw(topo());
    const dc4 = geo.sites.find((s) => (s.id as string) === 'dc4')!;
    const runs = links.filter((l) => l.kind === 'ping' || l.kind === 'check')
      .flatMap((l) => l.points.flatMap((p, i) => {
        const q = l.points[i + 1];
        return q && Math.abs(p.y - q.y) < 0.5 && Math.abs(p.x - q.x) > 0.5 ? [p.y] : [];
      }));
    expect(Math.min(...runs)).toBeGreaterThan(dc4.y + dc4.h);
  });

  it('takes a redo route that skips a column between the member band and the application', () => {
    load('multi-target-three-observers');
    const { geo, links } = draw(topo());
    const redo = links.find((l) => l.id === 'redo:prm01:sby02')!;
    expect(redo.points).toHaveLength(4);
    expect(redo.points[1]!.y).toBe(geo.midLaneY);
    const app = geo.byKey['app01']!;
    expect(redo.points[1]!.y).toBeLessThan(app.y);
  });
});

describe('the application in Build', () => {
  it('is a subject of its own, removable and nothing else', () => {
    expect(resolveSubject(topo(), 'app01')?.kind).toBe('application');
    expect(buildActionsForKey(topo(), 'app01').map((a) => a.id)).toEqual(['edit', 'remove']);
    removeAction(topo(), 'app01')?.run();
    expect(topo().applications).toBeUndefined();
    expect(topo().hosts.some((h) => (h.id as string) === 'dc1-app01')).toBe(false);
    /* The descriptor stays: the generated connect string is still the document's. */
    expect(topo().client.addresses).toHaveLength(2);
    undo();
    expect(topo().applications?.[0]?.id).toBe('app01');
  });

  it('is added beside the primary unless a data centre is named, and again as often as asked', () => {
    removeApplication('app01');
    expect(addApplication(siteId('dc3'))).toBe('app01');
    expect(topo().hosts.find((h) => h.id === topo().applications?.[0]?.host)?.site).toBe('dc3');
    removeApplication('app01');
    expect(addApplication()).toBe('app01');
    expect(topo().hosts.find((h) => h.id === topo().applications?.[0]?.host)?.site).toBe('dc1');
    expect(addApplication()).toBe('app02');
    expect(topo().applications?.map((a) => a.id as string)).toEqual(['app01', 'app02']);
  });

  it('moves to another data centre on a host of its own there, as one undo', () => {
    moveToSite('app01', siteId('dc2'));
    const host = topo().hosts.find((h) => h.id === topo().applications?.[0]?.host);
    expect(host).toMatchObject({ site: 'dc2', name: 'dc2-app01' });
    expect(topo().hosts.some((h) => (h.id as string) === 'dc1-app01')).toBe(false);
    expect(draw(topo()).geo.byKey['app01']?.site).toBe('dc2');
    undo();
    expect(topo().applications?.[0]?.host).toBe('dc1-app01');
  });

  it('keeps a moved standby on the ADDRESS_LIST', () => {
    moveToSite('sby01', siteId('dc3'));
    const sby = topo().members.find((m) => (m.id as string) === 'sby01')!;
    expect(topo().client.addresses.map((a) => a.host)).toContain(sby.instances[0]!.host);
    expect(draw(topo()).links.some((l) => l.id === 'connect:app01:sby01')).toBe(true);
  });

  it('sees a new standby: it joins the ADDRESS_LIST', () => {
    const id = addDatabase()!;
    const m = topo().members.find((x) => x.id === id)!;
    expect(topo().client.addresses.at(-1)?.host).toBe(m.instances[0]!.host);
    expect(draw(topo()).links.some((l) => l.id === `connect:app01:${id as string}`)).toBe(true);
  });

  it('takes a database off its list and puts it back, line and all', () => {
    const sby = topo().members.find((m) => (m.id as string) === 'sby01')!;
    setAddressListed('app01', sby.id, false);
    expect(topo().client.addresses.map((a) => a.host as string)).toEqual(['dc1-prm01']);
    expect(draw(topo()).links.some((l) => l.id === 'connect:app01:sby01')).toBe(false);
    expect(connectVerdict(topo(), 'app01', 'sby01')).toEqual({
      label: "List sby01 in app01's ADDRESS_LIST", enabled: { state: 'on' },
    });
    setAddressListed('app01', sby.id, true);
    expect(topo().client.addresses.map((a) => a.host as string)).toEqual(['dc1-prm01', 'dc2-sby01']);
    expect(connectVerdict(topo(), 'sby01', 'app01').enabled)
      .toEqual({ state: 'off', why: "sby01 is on app01's ADDRESS_LIST already." });
  });

  it('never lists a far sync instance, and says why', () => {
    load('far-sync-zero-loss');
    const fs = topo().members.find((m) => m.kind === 'farsync')!;
    expect(connectVerdict(topo(), 'app01', fs.id as string).enabled)
      .toEqual({ state: 'off', why: WHY.farSyncNotAddress });
  });

  it('keeps a host of its own: no card is dropped onto it, and it onto none', () => {
    expect(mergeVerdict(topo(), 'app01', 'dc2-sby01')).toEqual({ state: 'off', why: WHY_APPLICATION_OWN_HOST });
    expect(mergeVerdict(topo(), 'obs01', 'dc1-app01')).toEqual({ state: 'off', why: WHY_APPLICATION_OWN_HOST });
  });

  it('is renamed in one namespace with everything else on the drawing', () => {
    expect(renameVerdict(topo(), 'app01', 'sby01')).toEqual({ state: 'off', why: WHY.idTaken });
    expect(renameVerdict(topo(), 'app01', 'billing')).toEqual({ state: 'on' });
    renameApplication('app01', 'billing');
    expect(topo().applications?.[0]).toMatchObject({ id: 'billing', name: 'billing', host: 'dc1-app01' });
    renameApplication('billing', 'sby01');
    expect(topo().applications?.[0]?.id).toBe('billing');
  });
});

describe('the application in Break', () => {
  it('offers the one thing that happens to it: its host, down and back', () => {
    expect(actionsForKey(topo(), 'app01', 0).map((a) => a.id)).toEqual(['host.down', 'host.up']);
    const [tool] = hoverTools(topo(), 'app01', 0);
    expect(tool).toMatchObject({ id: 'host.down', icon: 'crash' });
    resetHistory(makeDoc({ ...topo(), events: [{ at: 0, kind: 'host.down', host: topo().applications![0]!.host }] }));
    expect(hoverTools(topo(), 'app01', 5)[0]).toMatchObject({ id: 'host.up', icon: 'restore' });
  });

  const crashed = (): TopologyDoc => {
    const t = preset('classic');
    return { ...t, events: scenarioEvents('crash', t) };
  };

  it('draws its three lanes under the configuration\'s, on the same axis', () => {
    const doc = crashed();
    const trace = simulate(doc, doc.events);
    const m = buildTimeline(trace, doc, { width: 1200 });
    expect(m.lanes.map((l) => l.name)).toEqual([
      'prm01', 'obs01', 'sby01', 'Service', 'Sessions', 'New connections',
    ]);
    const app = m.lanes.filter((l) => l.group === 'app');
    expect(app.every((l) => l.kind === 'application' && l.id === 'app01')).toBe(true);
    expect(new Set(app.map((l) => l.key)).size).toBe(3);
    expect(m.appSections).toHaveLength(1);
    expect(m.appSections[0]).toMatchObject({
      id: 'app01',
      title: "The application's view",
      note: 'outage 60.3 s — 15.3 s of it inside the connect string',
    });
    expect(m.appSections[0]?.basis).toContain("This page's model");
    /* The heading sits between the two groups of lanes. */
    const sby = m.lanes.find((l) => l.name === 'sby01')!;
    expect(m.appSections[0]!.y).toBeGreaterThan(sby.y + sby.height);
    expect(m.appSections[0]!.y).toBeLessThan(app[0]!.y);
    expect(m.lanesBottom).toBe(app[2]!.y + app[2]!.height);
  });

  it('stretches the axis to the reconnect, which is past the role change', () => {
    const doc = crashed();
    const trace = simulate(doc, doc.events);
    const ap = appModelsFor(trace, doc)[0]!;
    expect(ap.tConn).toBeCloseTo(60.3, 9);
    expect(axisSpan(trace, doc.events, doc).t1).toBeGreaterThan(60.3);
    expect(axisSpan(trace, doc.events).t1).toBeLessThan(60.3);
    const m = buildTimeline(trace, doc, { width: 1200 });
    const mark = m.markers.find((x) => x.kind === 'app');
    expect(mark).toMatchObject({
      key: 'app-reconnect:app01', label: 'Application reconnected at t = 60.3 s', glyph: 'diamond',
    });
    expect(mark!.x).toBeLessThanOrEqual(m.scale.plotR);
  });

  it('shows the steady state before the first event, not the failure', () => {
    const doc = crashed();
    const m = buildTimeline(simulate(doc, doc.events), doc, { width: 1200 });
    const first = (name: string) => m.lanes.find((l) => l.name === name)!.segments[0]!;
    expect(first('Service')).toMatchObject({ t0: m.scale.t0, t1: 0, title: "Published by prm01's listener" });
    expect(first('Sessions')).toMatchObject({ t1: 0, title: 'Pooled sessions working' });
    expect(first('New connections')).toMatchObject({ t1: 0, title: 'Any request connects at once' });
  });

  it('draws the ladder address by address, and the connection it ends in', () => {
    const doc = crashed();
    const m = buildTimeline(simulate(doc, doc.events), doc, { width: 1200 });
    const titles = m.lanes.find((l) => l.name === 'New connections')!.segments.map((s) => s.title);
    expect(titles).toEqual([
      'Any request connects at once',
      'Address 1 (dc1-prm01) — no answer, 60 s',
      'Address 2 connects',
      'Connected — each later connect still pays 60 s ahead of the address that answers',
    ]);
    const service = m.lanes.find((l) => l.name === 'Service')!.segments.map((s) => s.title);
    expect(service).toEqual([
      "Published by prm01's listener",
      'Nowhere — nothing publishes app_svc',
      'Published by sby01 — started at role change',
    ]);
  });

  it('leaves the lanes out when asked, and for a document with no application', () => {
    const doc = crashed();
    const trace = simulate(doc, doc.events);
    const off = buildTimeline(trace, doc, { width: 1200, app: false });
    expect(off.lanes.some((l) => l.group === 'app')).toBe(false);
    expect(off.appSections).toEqual([]);
    expect(off.scale.t1).toBe(axisSpan(trace, doc.events).t1);
    const { applications: _none, ...bare } = doc;
    const none = buildTimeline(simulate(bare, bare.events), bare, { width: 1200 });
    expect(none.appSections).toEqual([]);
    /* The pinned scale is the static figures': the three lanes they draw. */
    expect(buildTimeline(trace, doc, { width: 1200, pinnedScale: true }).appSections).toEqual([]);
  });

  it('says so when the application is lost with its data centre', () => {
    const t = preset('classic');
    moveToSite('app01', siteId('dc2'));
    const doc = { ...topo(), events: scenarioEvents('dc2down', t) };
    const m = buildTimeline(simulate(doc, doc.events), doc, { width: 1200 });
    expect(m.appSections[0]).toMatchObject({
      note: 'the application is down with its host, so nothing is dialled', tone: 'f-rd',
    });
    const conn = m.lanes.find((l) => l.name === 'New connections')!.segments;
    expect(conn.at(-1)).toMatchObject({ title: 'The application is down with its host', phase: 'b-hatch' });
    /* The service itself never moved. */
    expect(m.lanes.find((l) => l.name === 'Service')!.segments.every((s) => s.phase === 'b-tl')).toBe(true);
  });

  it('beside an isolated primary: sessions hang, then the string is exhausted', () => {
    const t = preset('classic');
    const doc = { ...t, events: scenarioEvents('isolated', t) };
    const m = buildTimeline(simulate(doc, doc.events), doc, { width: 1200 });
    expect(m.appSections[0]?.tone).toBe('f-rd');
    expect(m.appSections[0]?.note).toBe('the connect string is exhausted at t = 90.2 s — the application stays down');
    const pool = m.lanes.find((l) => l.name === 'Sessions')!.segments.map((s) => s.title);
    expect(pool[1]).toBe('Commits hang — the primary cannot write redo anywhere');
    const svc = m.lanes.find((l) => l.name === 'Service')!.segments.map((s) => s.title);
    expect(svc).toContain('Still published — on a STALLED prm01');
    expect(svc.at(-1)).toBe("Published by sby01 — out of the application's reach");
    expect(m.markers.find((x) => x.kind === 'app')).toMatchObject({ key: 'app-exhausted:app01', glyph: 'cross' });
  });
});
