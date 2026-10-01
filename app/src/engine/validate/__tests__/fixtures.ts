/**
 * Documents for the rule tests: one that trips a rule and one near miss.
 *
 * They are built from the same helpers the simulation tests use, so every
 * fixture is a document a user could author in the editor rather than a
 * hand-made object graph.
 */

import { build, db, dest, farSync, observer } from '../../../../test/topologies';
import { memberId } from '../../ids';
import type { Edition, MemberId } from '../../ids';
import type {
  DatabaseMember, DestProps, Member, ProtectionMode, RedoRouteRule, RouteDest, TopologyDoc,
} from '../../types/topology';

type Fsfo = 'enabled' | 'disabled' | 'observe-only';

export interface BaseOpts {
  edition?: Edition;
  mode?: ProtectionMode;
  fsfo?: Fsfo;
  /** Extra members beyond prm01 and sby01. */
  extra?: Member[];
  targets?: MemberId[];
  observers?: TopologyDoc['observers'];
  sites?: string[];
  hosts?: [string, string, string?][];
}

export const M = (s: string): MemberId => memberId(s);

/** A database with the reinstate preconditions met, so that rule stays quiet. */
export const database = (
  id: string, hosts: string[], role: DatabaseMember['role'], over: Partial<DatabaseMember> = {},
): DatabaseMember => db(id, hosts, role, { flashbackOn: true, staticServices: true, ...over });

/**
 * The clean configuration: a primary in DC1, a physical standby in DC2 taking
 * SYNC, one observer on a host of its own in DC3, maximum availability, 19c,
 * fast-start failover enabled with the standby as its target.
 */
export function baseDoc(o: BaseOpts = {}): TopologyDoc {
  const prm = database('prm01', ['dc1-prm01'], 'primary');
  const sby = database('sby01', ['dc2-sby01'], 'physical');
  dest(prm, sby.id);
  const members = [prm, sby, ...(o.extra ?? [])];
  const doc = build({
    ...(o.edition ? { edition: o.edition } : {}),
    ...(o.mode ? { mode: o.mode } : {}),
    sites: o.sites ?? ['dc1', 'dc2', 'dc3'],
    hosts: o.hosts ?? [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
    members,
    observers: o.observers ?? [observer('obs01', 'dc3-obs01')],
    targets: o.targets ?? [sby.id],
    ...(o.fsfo ? { fsfo: o.fsfo } : {}),
  });
  return doc;
}

export const memberOf = (doc: TopologyDoc, id: string): Member => {
  const m = doc.members.find((x) => (x.id as string) === id);
  if (!m) throw new Error(`fixture has no member ${id}`);
  return m;
};

export const dbOf = (doc: TopologyDoc, id: string): DatabaseMember => {
  const m = memberOf(doc, id);
  if (m.kind !== 'database') throw new Error(`${id} is not a database`);
  return m;
};

export const setDest = (doc: TopologyDoc, from: string, to: string, over: Partial<DestProps>): void => {
  const m = memberOf(doc, from);
  const cur = m.dests[memberId(to)];
  if (!cur) throw new Error(`${from} has no destination ${to}`);
  m.dests[memberId(to)] = { ...cur, ...over };
};

export const cutLink = (doc: TopologyDoc, id: string): void => {
  const l = doc.links.find((x) => (x.id as string) === id);
  if (!l) throw new Error(`fixture has no link ${id}`);
  l.up = false;
};

/** With `priority`, one parenthesised group whose destinations all carry it. */
export const rule = (source: RedoRouteRule['source'], dests: RouteDest[], priority?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): RedoRouteRule =>
  priority === undefined
    ? { source, groups: [{ dests }] }
    : { source, groups: [{ dests: dests.map((d) => ({ ...d, priority })), explicitGroup: true }] };

/* ---------------- far sync ---------------- */

/**
 * Example 5-5 in shape: the far sync instance sits in its own data centre,
 * SYNC from the primary and ASYNC onward to the terminal standby.
 */
export function farSyncDoc(o: {
  edition?: Edition; mode?: ProtectionMode; toFarSync?: 'SYNC' | 'FASTSYNC' | 'ASYNC';
  onward?: 'SYNC' | 'FASTSYNC' | 'ASYNC'; cutDirect?: boolean; fsfo?: Fsfo;
} = {}): TopologyDoc {
  const prm = database('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [rule('LOCAL', [{ target: M('fs1'), xpt: o.toFarSync ?? 'SYNC' }])],
  });
  const fs1 = farSync('fs1', 'dc4-fs01', {
    redoRoutes: [rule([M('prm01')], [{ target: M('sby01'), xpt: o.onward ?? 'ASYNC' }])],
  });
  const sby = database('sby01', ['dc2-sby01'], 'physical', { logXptMode: 'ASYNC' });
  dest(prm, fs1.id);
  dest(fs1, sby.id);
  const doc = build({
    ...(o.edition ? { edition: o.edition } : {}),
    ...(o.mode ? { mode: o.mode } : {}),
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3'], ['dc4-fs01', 'dc4']],
    members: [prm, fs1, sby],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: [sby.id],
    ...(o.fsfo ? { fsfo: o.fsfo } : {}),
  });
  if (o.cutDirect) cutLink(doc, 'dc1-dc2');
  return doc;
}

/* ---------------- cascade ---------------- */

/** Example 4-2 in shape: primary to a cascading standby, then onward. */
export function cascadeDoc(o: {
  cascaderRole?: DatabaseMember['role'];
  onward?: 'SYNC' | 'FASTSYNC' | 'ASYNC' | 'none';
  terminals?: number;
  targets?: MemberId[];
} = {}): TopologyDoc {
  const n = o.terminals ?? 1;
  const terminals = Array.from({ length: n }, (_, i) => database(`term${i + 1}`, ['dc3-term'], 'physical', { logXptMode: 'ASYNC' }));
  const onward: RouteDest[] = terminals.map((t) => (
    o.onward === 'none' ? { target: t.id } : { target: t.id, xpt: o.onward ?? 'ASYNC' }
  ));
  const prm = database('prm01', ['dc1-prm01'], 'primary', {
    redoRoutes: [rule('LOCAL', [{ target: M('sby01'), xpt: 'SYNC' }])],
  });
  const sby = database('sby01', ['dc2-sby01'], o.cascaderRole ?? 'physical', {
    redoRoutes: [rule([M('prm01')], onward)],
  });
  dest(prm, sby.id);
  for (const t of terminals) dest(sby, t.id);
  return build({
    sites: ['dc1', 'dc2', 'dc3'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-term', 'dc3'], ['dc3-obs01', 'dc3']],
    members: [prm, sby, ...terminals],
    observers: [observer('obs01', 'dc3-obs01')],
    targets: o.targets ?? [sby.id],
  });
}

/* ---------------- two standbys ---------------- */

export function twoStandbyDoc(o: { targets?: MemberId[]; mode?: ProtectionMode; secondRole?: DatabaseMember['role'] } = {}): TopologyDoc {
  const sby02 = database('sby02', ['dc3-sby02'], o.secondRole ?? 'physical');
  const doc = baseDoc({
    ...(o.mode ? { mode: o.mode } : {}),
    extra: [sby02],
    targets: o.targets ?? [M('sby01'), M('sby02')],
    sites: ['dc1', 'dc2', 'dc3', 'dc4'],
    hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-sby02', 'dc3'], ['dc4-obs01', 'dc4']],
    observers: [observer('obs01', 'dc4-obs01')],
  });
  dest(dbOf(doc, 'prm01'), sby02.id);
  return doc;
}

/** A member per index, all standing behind the primary on one host. */
export function manyMembersDoc(count: number): TopologyDoc {
  const extra = Array.from({ length: count }, (_, i) => database(`sby${i + 2}`, ['dc2-sby01'], 'physical'));
  return baseDoc({ extra });
}

/** The primary naming `count` destinations explicitly. */
export function manyDestinationsDoc(count: number): TopologyDoc {
  const extra = Array.from({ length: count - 1 }, (_, i) => database(`sby${i + 2}`, ['dc2-sby01'], 'physical'));
  const doc = baseDoc({ extra, fsfo: 'disabled' });
  const prm = dbOf(doc, 'prm01');
  const dests: RouteDest[] = [M('sby01'), ...extra.map((m) => m.id)].map((id) => ({ target: id, xpt: 'SYNC' as const }));
  prm.redoRoutes = [rule('LOCAL', dests)];
  return doc;
}

/* ---------------- a corpus for the catalogue-wide checks ---------------- */

/**
 * Documents that between them trip most of the catalogue, in both editions --
 * the sample the conformance, wording and 19c-invariance tests walk.
 */
export function corpus(): TopologyDoc[] {
  const out: TopologyDoc[] = [];
  const editions: Edition[] = ['19c', '26ai'];
  const modes: ProtectionMode[] = ['MAXPROTECTION', 'MAXAVAILABILITY', 'MAXPERFORMANCE'];

  for (const edition of editions) {
    for (const mode of modes) {
      out.push(baseDoc({ edition, mode }));
      out.push(farSyncDoc({ edition, mode }));
      out.push(farSyncDoc({ edition, mode, toFarSync: 'ASYNC', onward: 'SYNC' }));
      out.push(farSyncDoc({ edition, mode, cutDirect: true }));

      const cascade = cascadeDoc({ targets: [M('term1')] });
      cascade.config.edition = edition;
      cascade.config.protectionMode = mode;
      out.push(cascade);

      const two = twoStandbyDoc({ mode, targets: [] });
      two.config.edition = edition;
      out.push(two);

      const logical = twoStandbyDoc({ mode, secondRole: 'logical', targets: [M('sby02')] });
      logical.config.edition = edition;
      dbOf(logical, 'sby02').redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
      out.push(logical);

      const knobs = baseDoc({ edition, mode });
      knobs.config.fsfo.lagLimitSeconds = 45;
      knobs.config.fsfo.lagType = 'TRANSPORT';
      knobs.config.fsfo.lagGraceTimeSeconds = 10;
      knobs.config.fsfo.autoReinstate = true;
      dbOf(knobs, 'sby01').flashbackOn = false;
      dbOf(knobs, 'sby01').staticServices = false;
      dbOf(knobs, 'sby01').logXptMode = 'FASTSYNC';
      setDest(knobs, 'prm01', 'sby01', { netTimeoutSeconds: 2, reopenSeconds: 0, maxFailure: 4 });
      out.push(knobs);

      const alt = twoStandbyDoc({ mode });
      alt.config.edition = edition;
      memberOf(alt, 'prm01').redoRoutes = [{
        source: 'LOCAL',
        groups: [{
          explicitGroup: true,
          dests: [{
            target: M('sby01'), xpt: 'SYNC', priority: 1,
            alt: { target: M('sby02'), xpt: 'ASYNC', fallback: true },
          }],
        }],
      }];
      out.push(alt);

      const snapshot = baseDoc({ edition, mode, fsfo: 'disabled' });
      dbOf(snapshot, 'sby01').role = 'snapshot';
      dbOf(snapshot, 'sby01').redoRoutes = [rule('LOCAL', [{ target: 'ALL' }])];
      out.push(snapshot);
    }

    const observe = baseDoc({ edition, fsfo: 'observe-only' });
    out.push(observe);

    const noObs = baseDoc({ edition, observers: [] });
    out.push(noObs);

    const crowded = baseDoc({
      edition,
      hosts: [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'],
        ['dc3-obs01', 'dc3'], ['dc3-obs02', 'dc3'], ['dc3-obs03', 'dc3'], ['dc3-obs04', 'dc3'],
        ['dc3-obs05', 'dc3']],
      observers: [
        observer('obs01', 'dc3-obs01', 'master'), observer('obs02', 'dc3-obs02', 'master'),
        observer('obs03', 'dc3-obs03'), observer('obs04', 'dc3-obs04'),
        observer('obs05', 'dc3-obs05'),
      ],
    });
    crowded.config.fsfo.preferredObserverHosts = [{ host: crowded.hosts[2]!.id, priority: 1 }];
    out.push(crowded);

    const onDb = baseDoc({ edition, observers: [observer('obs01', 'dc2-sby01')] });
    out.push(onDb);

    const cycle = twoStandbyDoc();
    cycle.config.edition = edition;
    memberOf(cycle, 'prm01').redoRoutes = [rule('LOCAL', [{ target: M('sby01'), xpt: 'SYNC' }])];
    memberOf(cycle, 'sby01').redoRoutes = [rule([M('prm01')], [{ target: M('sby02'), xpt: 'ASYNC' }])];
    memberOf(cycle, 'sby02').redoRoutes = [rule([M('prm01')], [{ target: M('sby01'), xpt: 'ASYNC' }])];
    out.push(cycle);

    const fanout = cascadeDoc({ terminals: 31, onward: 'none' });
    fanout.config.edition = edition;
    out.push(fanout);

    const dupe = baseDoc({ edition });
    memberOf(dupe, 'prm01').redoRoutes = [
      rule('LOCAL', [{ target: M('sby01'), xpt: 'SYNC' }]),
      rule('LOCAL', [{ target: M('sby01'), xpt: 'ASYNC' }]),
    ];
    out.push(dupe);

    const farSyncLocal = farSyncDoc({ edition });
    memberOf(farSyncLocal, 'fs1').redoRoutes = [rule('LOCAL', [{ target: M('sby01'), xpt: 'ASYNC' }])];
    farSyncLocal.config.primaryDatabaseCandidates = [M('prm01'), M('fs1')];
    farSyncLocal.config.fsfo.target = { kind: 'list', members: [M('fs1')] };
    out.push(farSyncLocal);

    out.push(manyMembersDoc(253));
    out.push(manyDestinationsDoc(31));

    /* The rules of the 2026-10-01 fact check. */
    out.push(manyDestinationsDoc(10));                                  /* DEST.SYNC_ABOVE_10 */

    const twoPrimaries = baseDoc({ edition });
    dbOf(twoPrimaries, 'sby01').role = 'primary';                       /* MEMBER.PRIMARY_COUNT */
    out.push(twoPrimaries);

    const dupName = baseDoc({
      edition, extra: [database('sby02', ['dc2-sby01'], 'physical', { name: 'SBY01' })],
    });                                                                 /* MEMBER.NAME_DUPLICATE */
    out.push(dupName);

    const off = baseDoc({ edition });
    dbOf(off, 'sby01').enabled = false;                                 /* FSFO.TARGET_DISABLED */
    out.push(off);

    const noStatic = baseDoc({ edition, fsfo: 'disabled' });
    dbOf(noStatic, 'sby01').staticServices = false;                     /* MEMBER.STATIC_SERVICE */
    out.push(noStatic);

    const badName = baseDoc({ edition });
    badName.config.configurationWideServiceName = '_cfg';               /* CFG.SERVICE_NAME_FORMAT */
    out.push(badName);

    const reservedName = baseDoc({ edition });
    reservedName.observers = [{ ...observer('obs01', 'dc3-obs01'), name: 'ALL' }];  /* OBS.NAME_RESERVED */
    out.push(reservedName);

    const commands = baseDoc({ edition, fsfo: 'disabled' });
    dbOf(commands, 'sby01').flashbackOn = false;
    commands.events = [
      { at: 5, kind: 'cmd.reinstate', member: M('sby01') },             /* EVENT.REINSTATE */
      { at: 6, kind: 'cmd.setApplyInstance', member: M('sby01'), instance: 'nope' },  /* EVENT.SET_APPLY_INSTANCE */
      { at: 7, kind: 'cmd.setMasterObserver', observer: commands.observers[0]!.id },  /* EVENT.SET_MASTER_OBSERVER */
    ];
    out.push(commands);

    const snapRoutes = baseDoc({ edition, fsfo: 'disabled' });
    dbOf(snapRoutes, 'sby01').role = 'snapshot';
    dbOf(snapRoutes, 'sby01').redoRoutes = [rule('LOCAL', [{ target: 'ALL' }])];  /* ROUTES.SNAPSHOT_CONVERT_NONNULL */
    out.push(snapRoutes);

    const perfSync = baseDoc({ edition, mode: 'MAXPERFORMANCE' });      /* VAL-09 warnings */
    out.push(perfSync);
  }
  return out;
}
