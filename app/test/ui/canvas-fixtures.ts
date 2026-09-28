/**
 * Deployments the canvas tests draw.
 *
 * The classic 1+1+1 comes straight from the engine's compatibility module, so
 * the goldens below are goldens of the published drawing; the rest are the
 * shapes the auto-layout exists for -- a far sync hop, a cascade, several
 * observers, and a destination standing behind a priority group.
 */

import { classicTopology, declaredPrimary, memberId, resolveRedoGraph } from '@/engine';
import type { ClassicObserverLoc, RedoGraph, TopologyDoc } from '@/engine';
import { build, db, dest, farSync, observer } from '../topologies';

export const graphOf = (doc: TopologyDoc): RedoGraph => {
  const primary = declaredPrimary(doc);
  if (primary === null) throw new Error('fixture has no primary');
  return resolveRedoGraph(doc, { primary });
};

export const classic = (
  observerLoc: ClassicObserverLoc = 'dc3', over: Parameters<typeof classicTopology>[0] = {},
): TopologyDoc => classicTopology({ observerLoc, ...over });

/** Example 5-2's shape: the primary ships SYNC to a far sync beside it. */
export function farSyncFixture(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [{ source: 'LOCAL', groups: [{ dests: [{ target: memberId('fs1'), xpt: 'SYNC' }] }] }],
  });
  const fs1 = farSync('fs1', 'dc1-fs01', {
    redoRoutes: [{
      source: [memberId('prm01')],
      groups: [{ dests: [{ target: memberId('sby01'), xpt: 'ASYNC' }] }],
    }],
  });
  const sby = db('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'ASYNC' });
  dest(prm, fs1.id);
  dest(fs1, sby.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc1-fs01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
    members: [prm, fs1, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby.id],
  });
}

/** A terminal standby fed by the standby, not by the primary. */
export function cascadeFixture(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [{ source: 'LOCAL', groups: [{ dests: [{ target: memberId('sby01'), xpt: 'SYNC' }] }] }],
  });
  const sby = db('sby01', ['dc2-sby01'], 'physical', {
    redoRoutes: [{
      source: [memberId('prm01')],
      groups: [{ dests: [{ target: memberId('sby02'), xpt: 'ASYNC' }] }],
    }],
  });
  const term = db('sby02', ['dc3-sby02'], 'physical', { logXptMode: 'ASYNC' });
  dest(prm, sby.id);
  dest(sby, term.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc1-obs01', 'dc1']],
    members: [prm, sby, term],
    observers: [observer('obs01', 'dc1-obs01')],
    targets: [sby.id],
  });
}

/** A cascade whose terminal standby sits in the data centre that feeds it. */
export function cascadeSameSiteFixture(): TopologyDoc {
  const doc = cascadeFixture();
  return {
    ...doc,
    hosts: doc.hosts.map((h) => ((h.id as string) === 'dc3-sby02'
      ? { ...h, site: doc.hosts.find((x) => (x.id as string) === 'dc2-sby01')?.site ?? h.site }
      : h)),
  };
}

/** An observer standing on the primary's own host: one chassis stack. */
export function coHostedObserverFixture(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary');
  const sby = db('sby01', ['dc2-sby01'], 'physical');
  dest(prm, sby.id);
  return build({
    sites: ['dc1', 'dc2'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2']],
    members: [prm, sby],
    observers: [observer('obs01', 'dc1-prm01')],
    targets: [sby.id],
  });
}

/** Two standbys sharing one host: a member-only chassis stack. */
export function coHostedMembersFixture(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [{
      source: 'LOCAL',
      groups: [{
        dests: [
          { target: memberId('sby01'), priority: 1 },
          { target: memberId('sby02'), priority: 2 },
        ],
        explicitGroup: true,
      }],
    }],
  });
  const sby01 = db('sby01', ['dc2-sby01'], 'physical');
  const sby02 = db('sby02', ['dc2-sby01'], 'physical');
  dest(prm, sby01.id);
  dest(prm, sby02.id);
  return build({
    sites: ['dc1', 'dc2'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2']],
    members: [prm, sby01, sby02],
    targets: [sby01.id],
  });
}

/** Two observers sharing one host, with no member on it: an observer-only
    chassis stack, standing in the observer band on its own. */
export function coHostedObserversFixture(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary');
  const sby = db('sby01', ['dc2-sby01'], 'physical');
  dest(prm, sby.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
    members: [prm, sby],
    observers: [
      observer('obs01', 'dc3-obs01', 'master'),
      observer('obs02', 'dc3-obs01', 'backup'),
    ],
    targets: [sby.id],
  });
}

/** Three observers, two of them in one data centre. */
export function threeObserverFixture(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary');
  const sby = db('sby01', ['dc2-sby01'], 'physical');
  dest(prm, sby.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [
      ['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'],
      ['dc3-obs01', 'dc3'], ['dc3-obs02', 'dc3'], ['dc4-obs03', 'dc4'],
    ],
    members: [prm, sby],
    observers: [
      observer('obs01', 'dc3-obs01', 'master'),
      observer('obs02', 'dc3-obs02', 'backup'),
      observer('obs03', 'dc4-obs03', 'backup'),
    ],
    targets: [sby.id],
  });
}

/** One group, two priorities: the PRIORITY=2 destination is declared and standing down. */
export function priorityFixture(): TopologyDoc {
  const prm = db('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [{
      source: 'LOCAL',
      groups: [{
        dests: [
          { target: memberId('sby01'), priority: 1 },
          { target: memberId('sby02'), priority: 2 },
        ],
        explicitGroup: true,
      }],
    }],
  });
  const sby01 = db('sby01', ['dc2-sby01'], 'physical');
  const sby02 = db('sby02', ['dc3-sby02'], 'physical');
  dest(prm, sby01.id);
  dest(prm, sby02.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc1-obs01', 'dc1']],
    members: [prm, sby01, sby02],
    observers: [observer('obs01', 'dc1-obs01')],
    targets: [sby01.id],
  });
}

/** Every fixture, for the invariants that hold across all of them. */
export function allFixtures(): { name: string; doc: TopologyDoc }[] {
  return [
    { name: 'classic none', doc: classic('none') },
    { name: 'classic dc1', doc: classic('dc1') },
    { name: 'classic dc2', doc: classic('dc2') },
    { name: 'classic dc3', doc: classic('dc3') },
    { name: 'far sync', doc: farSyncFixture() },
    { name: 'cascade', doc: cascadeFixture() },
    { name: 'three observers', doc: threeObserverFixture() },
    { name: 'priority groups', doc: priorityFixture() },
    { name: 'co-hosted observer', doc: coHostedObserverFixture() },
    { name: 'co-hosted members', doc: coHostedMembersFixture() },
    { name: 'co-hosted observers', doc: coHostedObserversFixture() },
  ];
}
