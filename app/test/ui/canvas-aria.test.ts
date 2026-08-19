/**
 * The canvas said out loud, and the way a frame from the trace reads onto it.
 *
 * The sentences and the structural table are the drawing's other face, so they
 * are asserted the way the drawing is: exact wording where the wording is the
 * point (a configuration with no observer is not "unobserved by accident", it
 * simply has fast-start failover disabled), and shape everywhere else.
 */

import { describe, expect, it } from 'vitest';
import { hostId, memberId, simulate, siteId, stateAt } from '@/engine';
import type { Snapshot, TopologyDoc } from '@/engine';
import { layoutTopology } from '@/ui/canvas/layout';
import {
  cardLabel, describeTopology, latencySentence, linkLabel, observerSentences, redoSentences,
  shapeSentence, siteLabel, stateWords, structuralRows,
} from '@/ui/canvas/aria';
import { cardFrameFor, chipsFor, routeTopology, siteIsDown } from '@/ui/canvas/routing';
import {
  cascadeFixture, classic, farSyncFixture, graphOf, threeObserverFixture,
} from './canvas-fixtures';

const nodeOf = (doc: TopologyDoc, key: string) => {
  const geo = layoutTopology(doc, graphOf(doc));
  const n = geo.byKey[key];
  if (!n) throw new Error(`no node ${key}`);
  return n;
};

const crashFrame = (doc: TopologyDoc, at: number): Snapshot => {
  const trace = simulate(doc, [{ at: 0, kind: 'host.down', host: hostId('dc1-prm01') }]);
  return stateAt(trace, at);
};

describe('aria: sentences', () => {
  it('names the primary, the standby and the observer of the classic strip', () => {
    const doc = classic('dc3');
    expect(shapeSentence(doc, graphOf(doc)))
      .toBe('Topology: the primary database prm01 in DC 1, the physical standby sby01 in DC 2.');
    expect(redoSentences(doc, graphOf(doc)))
      .toEqual(['sby01 receives redo from prm01 over SYNC.']);
    expect(observerSentences(doc)).toEqual([
      'Observer obs01 runs on host dc3-obs01 in DC 3.',
      'obs01 is the master observer; only the master observer can coordinate fast-start failover.',
    ]);
  });

  it('says what a configuration with no observer is, not what it is missing', () => {
    const doc = classic('none');
    expect(observerSentences(doc))
      .toEqual(['No observer is deployed, so fast-start failover is not enabled.']);
  });

  it('drops the master observer from the vocabulary when fast-start failover is disabled', () => {
    const doc = classic('dc3');
    const off: TopologyDoc = {
      ...doc, config: { ...doc.config, fsfo: { ...doc.config.fsfo, state: 'disabled' } },
    };
    expect(observerSentences(off).at(-1)).toBe(
      'Fast-start failover is disabled, so no observer is called the master observer; all observers have the same functionality.',
    );
  });

  it('says observe-only in the documented terms', () => {
    const doc = classic('dc3');
    const oo: TopologyDoc = {
      ...doc, config: { ...doc.config, fsfo: { ...doc.config.fsfo, state: 'observe-only' } },
    };
    expect(observerSentences(oo).at(-1)).toBe(
      'Fast-start failover is enabled in observe-only mode: the observer reports what it would have done and never fails over.',
    );
  });

  it('follows the redo through a far sync and a cascade', () => {
    const fs = farSyncFixture();
    expect(redoSentences(fs, graphOf(fs))).toEqual([
      'fs1 receives redo from prm01 over SYNC.',
      'sby01 receives redo from fs1 over ASYNC.',
    ]);
    const cascade = cascadeFixture();
    expect(redoSentences(cascade, graphOf(cascade)).at(-1))
      .toBe('sby02 receives redo from sby01 over ASYNC.');
  });

  it('says so when no route reaches a member', () => {
    const doc = classic('dc3');
    const orphan: TopologyDoc = {
      ...doc,
      members: doc.members.map((m) => ((m.id as string) === 'prm01'
        ? { ...m, redoRoutes: [{ source: 'LOCAL' as const, groups: [{ dests: [] }] }] } : m)),
    };
    expect(redoSentences(orphan, graphOf(orphan)))
      .toEqual(['No active redo route reaches sby01 from the primary.']);
  });

  it('gives one latency sentence while every link agrees', () => {
    expect(latencySentence(classic('dc3', { latency: 12 })))
      .toBe('Every link carries 12 ms of round-trip latency.');
    const doc = classic('dc3', { latency: 12 });
    const mixed: TopologyDoc = {
      ...doc,
      links: doc.links.map((l, i) => (i === 0 ? { ...l, rttMs: 40 } : l)),
    };
    expect(latencySentence(mixed)).toBeNull();
  });

  it('collapses to counts above eight members', () => {
    const doc = classic('dc3');
    const many: TopologyDoc = {
      ...doc,
      members: [
        ...doc.members,
        ...Array.from({ length: 8 }, (_, i) => ({
          ...doc.members[1]!,
          id: `sby${i + 10}` as typeof doc.members[1] extends { id: infer I } ? I : never,
          name: `sby${i + 10}`,
        })),
      ],
    };
    const sentence = shapeSentence(many, graphOf(many));
    expect(sentence).toContain('9 other members');
    expect(redoSentences(many, graphOf(many))).toHaveLength(1);
    expect(redoSentences(many, graphOf(many))[0]).toContain('of 9 members');
  });
});

describe('aria: the structural table', () => {
  it('lists every member and observer with who feeds it', () => {
    const doc = farSyncFixture();
    const rows = structuralRows(doc, graphOf(doc));
    expect(rows.map((r) => r.member)).toEqual(['prm01', 'fs1', 'sby01', 'obs01']);
    expect(rows[0]).toMatchObject({
      site: 'DC1', role: 'Primary', host: 'dc1-prm01', receivesFrom: 'nothing: it is the primary',
    });
    expect(rows[1]).toMatchObject({ role: 'Far sync', receivesFrom: 'prm01', transport: 'SYNC' });
    expect(rows[2]).toMatchObject({ receivesFrom: 'fs1', transport: 'ASYNC' });
    expect(rows[3]).toMatchObject({ role: 'Observer', host: 'dc3-obs01' });
  });

  it('describes the whole drawing in one model', () => {
    const doc = classic('dc3');
    const model = describeTopology(doc, graphOf(doc));
    expect(model.summary).toContain('2 members, 1 observers, 3 sites');
    expect(model.rows).toHaveLength(3);
    expect(model.sentences.length).toBeGreaterThan(2);
  });
});

describe('aria: card labels', () => {
  it('spells a host name the card had to elide', () => {
    const doc = classic('dc3', { hostPrimary: 'an-extremely-long-database-host-name-01' });
    const node = nodeOf(doc, 'prm01');
    expect(node.lines.host).toBe('an-extremely-long-…');
    const label = cardLabel(doc, graphOf(doc), node);
    expect(label).toContain('an-extremely-long-database-host-name-01');
    expect(label).toContain('It is the primary.');
  });

  it('names the observer, its host and what it is', () => {
    const doc = classic('dc3');
    expect(cardLabel(doc, graphOf(doc), nodeOf(doc, 'obs01')))
      .toBe('obs01, master observer on host dc3-obs01 in DC 3.');
  });

  it('counts the instances of a RAC member', () => {
    const doc = threeObserverFixture();
    const rac: TopologyDoc = {
      ...doc,
      hosts: [...doc.hosts, { id: hostId('dc1-prm02'), name: 'dc1-prm02', site: doc.sites[0]!.id, listenerPort: 1521 }],
      members: doc.members.map((m) => ((m.id as string) === 'prm01'
        ? { ...m, instances: [...m.instances, { name: 'prm012', host: hostId('dc1-prm02') }] }
        : m)),
    };
    expect(cardLabel(rac, graphOf(rac), nodeOf(rac, 'prm01'))).toContain('a 2-instance cluster');
    expect(chipsFor(rac, nodeOf(rac, 'prm01'))[0]?.text).toBe('RAC 2');
  });
});

describe('the frame on the cards', () => {
  it('leaves every card monochrome while no frame is passed', () => {
    const doc = classic('dc3');
    for (const key of ['prm01', 'sby01', 'obs01']) {
      const f = cardFrameFor(doc, nodeOf(doc, key));
      expect(f).toMatchObject({ phase: 'neutral', down: false, crashed: false });
    }
  });

  it('hatches and crosses the primary once its host has crashed', () => {
    const doc = classic('dc3');
    const frame = crashFrame(doc, 5);
    const prm = cardFrameFor(doc, nodeOf(doc, 'prm01'), frame);
    expect(prm.down).toBe(true);
    expect(prm.crashed).toBe(true);
    const sby = cardFrameFor(doc, nodeOf(doc, 'sby01'), frame);
    expect(sby.down).toBe(false);
    expect(sby.crashed).toBe(false);
  });

  it('maps each state onto the phase colour it belongs to', () => {
    const doc = classic('dc3');
    const base = crashFrame(doc, 5);
    const at = (state: string) => cardFrameFor(
      doc,
      nodeOf(doc, 'sby01'),
      { ...base, members: { ...base.members, [memberId('sby01')]: state as never } },
    );
    expect(at('open-rw').phase).toBe('serving');
    expect(at('mounted-apply').phase).toBe('applying');
    expect(at('mounted-noapply').phase).toBe('idle');
    expect(at('unreachable').phase).toBe('waiting');
    expect(at('stalled')).toMatchObject({ phase: 'waiting', stalled: true, down: false });
    expect(at('aborted')).toMatchObject({ down: true, crashed: false });
  });

  it('reads the observer that lost the primary as waiting, not as down', () => {
    const doc = classic('dc3');
    const frame = crashFrame(doc, 5);
    expect(cardFrameFor(doc, nodeOf(doc, 'obs01'), frame))
      .toMatchObject({ phase: 'waiting', down: false, crashed: false });
  });

  it('hatches a site only when the site itself is gone', () => {
    const doc = classic('dc3');
    const trace = simulate(doc, [{ at: 0, kind: 'site.down', site: doc.sites[1]!.id }]);
    const frame = stateAt(trace, 10);
    expect(siteIsDown(doc, 'dc2', frame)).toBe(true);
    expect(siteIsDown(doc, 'dc1', frame)).toBe(false);
    expect(siteIsDown(doc, 'dc2', null)).toBe(false);
  });

  it('puts the master chip on the observer only while fast-start failover is enabled', () => {
    const doc = classic('dc3');
    expect(chipsFor(doc, nodeOf(doc, 'obs01')).map((c) => c.text)).toEqual(['MASTER']);
    const off: TopologyDoc = {
      ...doc, config: { ...doc.config, fsfo: { ...doc.config.fsfo, state: 'disabled' } },
    };
    expect(chipsFor(off, nodeOf(off, 'obs01'))).toEqual([]);
    const oo: TopologyDoc = {
      ...doc, config: { ...doc.config, fsfo: { ...doc.config.fsfo, state: 'observe-only' } },
    };
    expect(chipsFor(oo, nodeOf(oo, 'obs01')).map((c) => c.text)).toEqual(['OBSERVE ONLY']);
  });

  it('speaks every engine state', () => {
    expect(stateWords('open-rw')).toBe('open read write');
    expect(stateWords('mounted-apply')).toBe('mounted, applying redo');
    expect(stateWords('forwarding-stalled')).toBe('not forwarding');
    expect(stateWords(undefined)).toBe('unknown');
  });
});

describe('aria: the controls the drawing grew', () => {
  it('names a data centre by what is standing in it', () => {
    const doc = classic('dc3');
    expect(siteLabel(doc, { id: 'dc1', name: 'DC 1' }))
      .toBe('Data centre DC 1: 1 member, 0 observers.');
    expect(siteLabel(doc, { id: 'dc3', name: 'DC 3' }))
      .toBe('Data centre DC 3: 0 members, 1 observer.');
  });

  it('says a data centre is down only when the frame says it is', () => {
    const doc = classic('dc3');
    const trace = simulate(doc, [{ at: 0, kind: 'site.down', site: siteId('dc1') }]);
    const frame = stateAt(trace, 5);
    expect(siteLabel(doc, { id: 'dc1', name: 'DC 1' }, frame)).toContain('It is down.');
    expect(siteLabel(doc, { id: 'dc2', name: 'DC 2' }, frame)).not.toContain('down');
  });

  it('names a link with the sentence the drawing already had for it', () => {
    const doc = classic('dc3');
    const geo = layoutTopology(doc, graphOf(doc));
    const link = routeTopology(doc, graphOf(doc), geo, null).links
      .find((l) => l.kind === 'redo');
    expect(link).toBeDefined();
    expect(linkLabel(doc, link!)).toBe(link!.title);
    expect(linkLabel(doc, link!)).toContain('prm01');
  });
});
