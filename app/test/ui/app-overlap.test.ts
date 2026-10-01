/**
 * The application's view of a manual failover whose old primary stayed open
 * (engine: `test/sim-split-brain.test.ts`, "the application's view of an old
 * primary that stayed open"). Two databases publish the role-based service at
 * once; the sessions stay where they are; when the old primary goes down they
 * are lost while the service is still published, and the outage is the connect
 * string's own. What is pinned here is how the three places that draw the
 * application say it: the Simulate timeline's lanes, the readout's reconnect
 * chip, and the Config figure.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { hostId, simulate } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';
import { PRESETS } from '@/presets';
import { doc as docSignal, makeDoc } from '@/state/doc';
import { readoutFor } from '@/state/derived';
import { resetHistory } from '@/state/history';
import { AppDetail } from '@/ui/panels/AppView';
import { buildTimeline } from '@/ui/timeline/build';

const classic = (): TopologyDoc => PRESETS.find((p) => p.id === 'classic')!.doc();
/* Fast-start failover disabled: only then does a manual failover leave the old
   primary open to the end. With it enabled the old primary has lost its target
   and is drawn stalled, then aborted (owner decision D5, 2026-10-01). */
const fsfoOff = (d: TopologyDoc): TopologyDoc =>
  ({ ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } });
const manual: TimedEvent = { at: 0, kind: 'cmd.failover', to: 'sby01' as never };
const crash = (at: number): TimedEvent => ({ at, kind: 'host.down', host: hostId('dc1-prm01') });

const load = (events: TimedEvent[], patch: (d: TopologyDoc) => TopologyDoc = (d) => d): TopologyDoc => {
  const base = events.includes(manual) ? fsfoOff(classic()) : classic();
  const d = patch({ ...base, events });
  resetHistory(makeDoc(d));
  return d;
};
const section = (d: TopologyDoc) => {
  const m = buildTimeline(simulate(d, d.events), d, { width: 1200 });
  const titles = (name: string): string[] => m.lanes.find((l) => l.name === name)!.segments.map((s) => s.title);
  return { m, titles, svc: titles('Service'), pool: titles('Sessions'), conn: titles('New connections') };
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('the lanes, with the old primary open to the end', () => {
  it('draws one band naming both publishers, and the sessions staying where they are', () => {
    const { m, svc, pool, conn } = section(load([manual]));
    expect(svc).toEqual(["Published by prm01's listener", 'Published by prm01 and sby01 at once']);
    expect(m.lanes.find((l) => l.name === 'Service')!.segments.every((s) => s.phase === 'b-tl')).toBe(true);
    expect(pool).toEqual(['Pooled sessions working', 'Pooled sessions working on prm01']);
    expect(conn).toContain('New connections land on prm01 — the first address that publishes');
    expect(m.appSections[0]).toMatchObject({
      note: 'prm01 and sby01 both publish the service — the sessions stay on prm01', tone: 'f-am',
    });
    expect(m.appSections[0]?.basis).toContain('APP.TWO_PUBLISHERS');
    expect(m.markers.some((x) => x.kind === 'app')).toBe(false);
  });

  it('says either address when LOAD_BALANCE picks the order', () => {
    const { conn } = section(load([manual], (d) => ({ ...d, client: { ...d.client, loadBalance: true } })));
    expect(conn).toContain('New connections land on either — LOAD_BALANCE picks the order');
  });
});

describe('the lanes, when the old primary then goes down', () => {
  const d = (): TopologyDoc => load([manual, crash(60)]);

  it('reads as errors, not a hang, and rebuilds the pool on the new primary', () => {
    const { pool, svc } = section(d());
    expect(svc).toEqual([
      "Published by prm01's listener", 'Published by prm01 and sby01 at once', 'Published by sby01 — started at role change',
    ]);
    expect(pool).toContain('In-flight calls error — ORA-3113');
    expect(pool).not.toContain('In-flight calls hang — a partition returns no errors');
    expect(pool.at(-1)).toBe('Pool rebuilt on sby01');
    expect(pool.indexOf('Pooled sessions working on prm01')).toBeLessThan(pool.indexOf('In-flight calls error — ORA-3113'));
  });

  it('starts the ladder at the loss, dials the dead old primary, and marks the reconnect', () => {
    const { m, conn } = section(d());
    expect(conn).toContain('Address 1 (dc1-prm01) — no answer, 60 s');
    expect(conn).toContain('Address 2 connects');
    expect(m.appSections[0]?.note).toBe('outage 60.3 s — 60.3 s of it inside the connect string');
    expect(m.markers.find((x) => x.kind === 'app')).toMatchObject({
      key: 'app-reconnect:app01', label: 'Application reconnected at t = 120.3 s',
    });
    expect(m.appSections[0]?.basis).toContain('APP.TWO_PUBLISHERS');
  });
});

describe('the readout', () => {
  it('names the database that went down and the one already publishing', () => {
    load([manual, crash(60)]);
    const chip = readoutFor(false).find((c) => c.group === 'app')!;
    expect(chip.k).toBe('Application reconnects');
    expect(chip.v).toBe('120.3');
    expect(chip.basis).toBe('model');
    expect(chip.sub).toBe(
      "app01 gets a new connection at this instant: prm01 went down with its sessions while sby01 was already publishing the service, so the outage is the connect string's own.",
    );
  });

  it('keeps the plain sentence where the loss is the service going away', () => {
    load([crash(60)]);
    const chip = readoutFor(false).find((c) => c.group === 'app')!;
    expect(chip.sub).toBe("app01 gets a new connection at this instant: the connect string's own waits, on top of the role change.");
  });

  it('has no reconnect chip while the old primary stays open', () => {
    load([manual]);
    expect(readoutFor(false).filter((c) => c.group === 'app')).toEqual([]);
  });
});

describe('the Config figure', () => {
  const draw = (events: TimedEvent[]): string => {
    load(events);
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(AppDetail, { where: 'config' }), root);
    return root.textContent ?? '';
  };

  it('puts the loss at the old primary\'s crash, not at t = 0', () => {
    const events = [manual, crash(60)];
    const tOpen = simulate(load(events), events).facts.tOpen;
    const text = draw(events);
    expect(text).toContain('Application outage = 60.3 s -- 60.3 s of it client-side');
    expect(text).toContain('its sessions were lost at t = 60 s with the old primary');
    expect(text).toContain(`New primary opens -- app_svc published at t = ${tOpen} s`);
    expect(text).not.toContain('the service was gone from t = 0 s');
    /* t = 0 is not a failure here, and the client-side share is counted from the crash. */
    expect(text).toContain('t = 0 is the first event of the run');
    expect(text).toContain('Pooled sessions working on the old primary');
    expect(text).toContain("60.3 s after the sessions' database went down");
    expect(text).not.toContain('t = 0 is the failure event');
  });

  it('draws the other failure exactly as before', () => {
    const text = draw([crash(0)]);
    expect(text).toContain('the service was gone from t = 0 s');
    expect(text).not.toContain('its sessions were lost');
    expect(text).toContain('t = 0 is the failure event');
  });
});
