import { describe, expect, it } from 'vitest';
import {
  claimWellFormed, compareFindings, conflict, docLater, documented, inferred, mapClaim,
  model, NEEDS_NOTE, sortFindings,
} from '../types/claims';
import type { Basis, Claim, Finding } from '../types/claims';
import { hostId, idString, isEdition, linkId, memberId, observerId, siteId } from '../ids';
import type { HostId, MemberId } from '../ids';
import { eventPriority, sortEvents } from '../types/events';
import type { TimedEvent } from '../types/events';

describe('branded ids', () => {
  it('are plain strings at runtime, so JSON and === still work', () => {
    const m = memberId('prm01');
    expect(m).toBe('prm01');
    expect(JSON.parse(JSON.stringify({ m })).m).toBe('prm01');
    expect(idString(m)).toBe('prm01');
  });

  it('do not interchange at compile time', () => {
    const h: HostId = hostId('dc1-prm01');
    const takesMember = (id: MemberId): string => id;
    // @ts-expect-error a HostId is not a MemberId
    takesMember(h);
    // @ts-expect-error a bare string is not a MemberId either
    takesMember('prm01');
    expect(takesMember(memberId('prm01'))).toBe('prm01');
    expect([siteId('dc1'), observerId('obs01'), linkId('dc1-dc2')].join()).toBe('dc1,obs01,dc1-dc2');
  });

  it('knows the two editions this engine models', () => {
    expect(isEdition('19c')).toBe(true);
    expect(isEdition('26ai')).toBe(true);
    expect(isEdition('21c')).toBe(false);
  });
});

describe('claims', () => {
  it('a documented claim needs a citation', () => {
    const c = documented(30, ['FSFO.THRESHOLD']);
    expect(c.basis).toBe('documented');
    expect(claimWellFormed(c)).toBe(true);
    expect(() => documented(30, [])).toThrow(/needs at least one citation/);
  });

  it('every other basis needs a note that gets rendered', () => {
    expect(NEEDS_NOTE).toEqual(['model', 'inferred', 'doc-later', 'conflict']);
    const claims: Claim<unknown>[] = [
      model(1.1, 'pingInterval x (pingRetry + 1) is this page model of "nearly 1 second".', ['FSFO.PING_NEARLY_ONE_SECOND']),
      inferred(false, ['FSFO.TARGET_DIRECT_REDO'], 'A terminal standby fails the direct-redo prerequisite.'),
      docLater(4, ['OBS.FOUR_26AI'], '19c documents three.'),
      conflict(null, ['FSFO.PING_DEFAULTS_26AI_ZERO', 'FSFO.PING_DEFAULTS_26AI_TABLE'], '26ai disagrees with itself.'),
    ];
    for (const c of claims) {
      expect(claimWellFormed(c)).toBe(true);
      expect(c.note).toBeTruthy();
    }
    expect(claimWellFormed({ value: 1, basis: 'model' as Basis, cite: [] })).toBe(false);
  });

  it('a conflict must cite both sides', () => {
    expect(() => conflict(1, ['OBS.FOUR_26AI'], 'only one side')).toThrow(/both sides/);
  });

  it('mapping a value keeps the labelling intact', () => {
    const c = model(30, 'a note', ['FSFO.THRESHOLD']);
    const mapped = mapClaim(c, (n) => `${n} s`);
    expect(mapped).toEqual({ value: '30 s', basis: 'model', cite: ['FSFO.THRESHOLD'], note: 'a note' });
  });

  it('a model claim may stand with no citation at all, but never without a note', () => {
    const c = model('order', 'FSFO.TARGET_SELECTION: the walk is this page model.');
    expect(c.cite).toEqual([]);
    expect(claimWellFormed(c)).toBe(true);
  });
});

describe('findings', () => {
  const f = (id: string, severity: Finding['severity'], subject: Finding['subject']): Finding => ({
    id, severity, basis: 'documented', cite: ['FSFO.TARGET_KIND'], subject, message: id,
  });

  it('sort by severity, then subject, then rule id', () => {
    const list = [
      f('B', 'info', { kind: 'config' }),
      f('A', 'error', { kind: 'member', id: 'sby01' }),
      f('C', 'error', { kind: 'member', id: 'prm01' }),
      f('D', 'warning', { kind: 'config' }),
    ];
    expect(sortFindings(list).map((x) => x.id)).toEqual(['C', 'A', 'D', 'B']);
    expect(compareFindings(list[1]!, list[1]!)).toBe(0);
  });

  it('severity and basis are orthogonal', () => {
    const e: Finding = { ...f('X', 'error', { kind: 'route' }), basis: 'model', note: 'a model' };
    expect(claimWellFormed(e)).toBe(true);
  });
});

describe('events', () => {
  it('order deterministically: time, then priority, then declaration order', () => {
    const events: TimedEvent[] = [
      { at: 0, kind: 'cmd.switchover', to: memberId('sby01') },
      { at: 0, kind: 'host.down', host: hostId('dc1-prm01') },
      { at: 0, kind: 'link.cut', link: linkId('dc1-dc2') },
      { at: 5, kind: 'host.up', host: hostId('dc1-prm01') },
    ];
    expect(sortEvents(events).map((e) => e.kind))
      .toEqual(['host.down', 'link.cut', 'cmd.switchover', 'host.up']);
    expect(eventPriority({ kind: 'site.down', site: siteId('dc2') }))
      .toBeLessThan(eventPriority({ kind: 'cmd.failover', to: memberId('sby01') }));
  });

  it('sorting never mutates the caller list', () => {
    const events: TimedEvent[] = [
      { at: 9, kind: 'host.down', host: hostId('a') },
      { at: 1, kind: 'host.down', host: hostId('b') },
    ];
    sortEvents(events);
    expect(events[0]?.at).toBe(9);
  });
});
