/**
 * Regression tests for the role-change findings of the 2026-10-01 fact check
 * (docs/fact-checks/SIMULATOR_FACT_CHECK_2026-10-01.md): SIM-17, SIM-28, SIM-21, VAL-07, SIM-23
 * and SIM-26 -- a role change to the wrong kind of standby.
 *
 * One block per finding id, each holding the run to the Oracle sentence the
 * report quotes. The citation is asked for by id so the sentence and the test
 * cannot drift apart.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { citation } from '../src/engine/citations';
import type { CitationId } from '../src/engine/citations';
import { memberId } from '../src/engine/ids';
import type { MemberId } from '../src/engine/ids';
import { SNAPSHOT_CONVERT } from '../src/engine/sim/roles';
import { simulate } from '../src/engine/sim/simulate';
import type { EngineTrace } from '../src/engine/sim/simulate';
import type { TimedEvent } from '../src/engine/types/events';
import type { DatabaseMember, TopologyDoc } from '../src/engine/types/topology';
import { validate } from '../src/engine/validate';
import { preset } from '../src/presets';
import { actionsForKey } from '@/ui/break/events';
import { classicTopology } from '../src/engine/compat/classic';

/* ---------------- helpers ---------------- */

const withFsfoOff = (d: TopologyDoc): TopologyDoc =>
  ({ ...d, config: { ...d.config, fsfo: { ...d.config.fsfo, state: 'disabled' } } });

const bystandersOff = (): TopologyDoc => withFsfoOff(preset('bystanders').doc());

const withMode = (d: TopologyDoc, protectionMode: TopologyDoc['config']['protectionMode']): TopologyDoc =>
  ({ ...d, config: { ...d.config, protectionMode } });

const patch = (d: TopologyDoc, id: string, over: Partial<DatabaseMember>): TopologyDoc => ({
  ...d,
  members: d.members.map((m) => (m.kind === 'database' && (m.id as string) === id ? { ...m, ...over } : m)),
});

const idOf = (d: TopologyDoc, role: DatabaseMember['role']): MemberId =>
  (d.members.find((m) => m.kind === 'database' && m.role === role) as DatabaseMember).id;

const states = (t: EngineTrace, id: string): string[] =>
  (t.lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [])
    .map((s) => s.state as string);
const endState = (t: EngineTrace, id: string): string | undefined => states(t, id).at(-1);
const decision = (t: EngineTrace, id: string) => t.decisions.find((d) => d.id === id);
const finding = (t: EngineTrace, id: string) => t.findings.find((f) => f.id === id);
const quote = (id: CitationId): string => citation(id).quote;

const switchover = (to: MemberId, at = 0): TimedEvent => ({ at, kind: 'cmd.switchover', to });
const failover = (to: MemberId, at = 0): TimedEvent => ({ at, kind: 'cmd.failover', to });

/** The bystanders preset with the primary's host down at 0: the failover is what is left. */
const crashed = (d: TopologyDoc): TimedEvent => {
  const prm = d.members.find((m) => m.kind === 'database' && m.role === 'primary') as DatabaseMember;
  return { at: 0, kind: 'host.down', host: prm.instances[0]!.host };
};

/* ---------------- SIM-17 ---------------- */

describe('SIM-17: a switchover to a snapshot standby is refused', () => {
  /* "A snapshot standby database cannot be the target of a switchover or a
     fast-start failover." (CONVERT DATABASE)
     "You cannot perform a switchover to a snapshot standby database unless
     you first convert it back to a physical standby database." (FSFO19) */
  const doc = bystandersOff();
  const snp = idOf(doc, 'snapshot');

  it('cites the two sentences by id', () => {
    expect(quote('SWITCHOVER.SNAPSHOT_NOT_TARGET')).toBe(
      'A snapshot standby database cannot be the target of a switchover or a fast-start failover.');
    expect(quote('SWITCHOVER.SNAPSHOT_CONVERT_FIRST')).toBe(
      'You cannot perform a switchover to a snapshot standby database unless you first convert it back to a physical standby database.');
  });

  it('draws no role change, with a documented refusal', () => {
    const t = simulate(doc, [switchover(snp)]);
    expect(t.facts.blocked).toBe(true);
    expect(t.facts.newPrimary).toBeNull();
    expect(t.facts.switchover?.refusal).toBe('snapshot-target');
    const gate = decision(t, 'SWITCHOVER.GATE');
    expect(gate?.taken).toBe(false);
    expect(gate?.claim.basis).toBe('documented');
    expect(gate?.claim.cite).toContain('SWITCHOVER.SNAPSHOT_NOT_TARGET');
    const refused = finding(t, 'SWITCHOVER.REFUSED');
    expect(refused?.severity).toBe('error');
    expect(refused?.cite).toContain('SWITCHOVER.SNAPSHOT_CONVERT_FIRST');
    expect(endState(t, 'prm01')).toBe('open-rw');
  });

  it('refuses it with fast-start failover enabled as well', () => {
    const t = simulate(preset('bystanders').doc(), [switchover(snp)]);
    expect(t.facts.blocked).toBe(true);
    expect(t.facts.switchover?.refusal).toBe('snapshot-target');
  });

  it('validate() names the command', () => {
    const f = validate({ ...doc, events: [switchover(snp)] }).filter((x) => x.id === 'ROLE.SWITCHOVER_SNAPSHOT');
    expect(f).toHaveLength(1);
    expect(f[0]?.basis).toBe('documented');
    expect(f[0]?.subject).toEqual({ kind: 'member', id: snp as string });
  });

  it('shows the menu row disabled, with the reason', () => {
    const row = actionsForKey(doc, snp as string, 0).find((a) => a.id === 'cmd.switchover');
    expect(row?.enabled.state).toBe('off');
    expect(row?.enabled.state === 'off' ? row.enabled.why : '').toContain('snapshot standby');
    const failoverRow = actionsForKey(doc, snp as string, 0).find((a) => a.id === 'cmd.failover');
    expect(failoverRow?.enabled.state).toBe('on');
  });

  it('still switches over to a physical standby', () => {
    const t = simulate(doc, [switchover(idOf(doc, 'physical'))]);
    expect(t.facts.blocked).toBe(false);
    expect(t.facts.outcome).toBe('switchover');
  });
});

/* ---------------- SIM-28 ---------------- */

describe('SIM-28: a manual failover to a snapshot standby converts and applies first', () => {
  /* "the broker first converts the database back to a physical standby and
     then starts Redo Apply to apply all the accumulated redo" (FSFO19). The
     role-transitions concepts page says "A snapshot standby cannot be the
     target of a role transition." and the broker commands page that it "can
     be the target of a manual failover if fast-start failover is disabled":
     a conflict the page now names. */
  const doc = bystandersOff();
  const snp = idOf(doc, 'snapshot');
  const asPhysical = patch(doc, snp as string, { role: 'physical' });

  it('opens later than the same standby would as a physical one, by the convert band', () => {
    const events = [crashed(doc), failover(snp, 0)];
    const t = simulate(doc, events);
    const p = simulate(asPhysical, events);
    expect(t.facts.newPrimary).toBe(snp);
    expect(t.facts.blocked).toBe(false);
    expect(t.facts.tOpen).toBe((p.facts.tOpen as number) + SNAPSHOT_CONVERT);
  });

  it('applies the accumulated redo: a later command waits longer', () => {
    const early = simulate(doc, [crashed(doc), failover(snp, 0)]);
    const late = simulate(doc, [crashed(doc), failover(snp, 20)]);
    expect((late.facts.tOpen as number) - 20).toBeGreaterThan(early.facts.tOpen as number);
  });

  it('records the documented sentence, the conflict and the model duration', () => {
    const t = simulate(doc, [crashed(doc), failover(snp, 0)]);
    const sentence = decision(t, 'FAILOVER.SNAPSHOT_CONVERT_APPLY');
    expect(sentence?.claim.basis).toBe('documented');
    expect(sentence?.claim.cite).toContain('FAILOVER.SNAPSHOT_CONVERT_APPLY');
    expect(quote('FAILOVER.SNAPSHOT_CONVERT_APPLY')).toContain('first converts the database back to a physical standby');
    const allowed = decision(t, 'FAILOVER.SNAPSHOT_ALLOWED');
    expect(allowed?.claim.basis).toBe('conflict');
    expect(allowed?.claim.cite).toEqual(expect.arrayContaining(['FAILOVER.SNAPSHOT_MANUAL_ALLOWED', 'ROLES.SNAPSHOT_NO_ROLE_TRANSITION']));
    expect(allowed?.claim.note).toBeTruthy();
    const band = decision(t, 'FAILOVER.SNAPSHOT_BAND');
    expect(band?.claim.basis).toBe('model');
    expect(band?.claim.note).toContain('durations are not');
    const f = finding(t, 'FAILOVER.SNAPSHOT_CONVERTS');
    expect(f?.basis).toBe('conflict');
    expect(f?.severity).toBe('info');
  });

  it('does not touch a failover to a physical standby', () => {
    const t = simulate(asPhysical, [crashed(doc), failover(snp, 0)]);
    expect(decision(t, 'FAILOVER.SNAPSHOT_CONVERT_APPLY')).toBeUndefined();
    expect(finding(t, 'FAILOVER.SNAPSHOT_CONVERTS')).toBeUndefined();
  });
});

/* ---------------- SIM-21 ---------------- */

describe('SIM-21: a role change to a logical standby disables the physical and snapshot standbys', () => {
  /* "All physical and snapshot standby databases will be disabled and must be
     re-created from a copy of the new primary database after a switchover to
     a logical standby database." / "If the failover target is a logical
     standby database, the original primary database and all physical and
     snapshot standby databases in the configuration will be disabled." */
  const doc = bystandersOff();
  const lsby = idOf(doc, 'logical');
  const sby = idOf(doc, 'physical');
  const snp = idOf(doc, 'snapshot');

  it('cites both sentences by id', () => {
    expect(quote('SWITCHOVER.LOGICAL_DISABLES_OTHERS')).toContain('will be disabled and must be re-created from a copy of the new primary database');
    expect(quote('FAILOVER.LOGICAL_DISABLES_OTHERS')).toContain('the original primary database and all physical and snapshot standby databases');
  });

  it('a switchover disables the physical and snapshot standbys and keeps the former primary', () => {
    const t = simulate(doc, [switchover(lsby)]);
    expect(t.facts.outcome).toBe('switchover');
    expect(t.facts.newPrimary).toBe(lsby);
    expect(endState(t, sby as string)).toBe('disabled');
    expect(endState(t, snp as string)).toBe('disabled');
    expect(endState(t, 'prm01')).not.toBe('disabled');
    const d = decision(t, 'ROLE.LOGICAL_DISABLES');
    expect(d?.claim.basis).toBe('documented');
    expect(d?.claim.cite).toContain('SWITCHOVER.LOGICAL_DISABLES_OTHERS');
    const fs = t.findings.filter((f) => f.id === 'ROLE.LOGICAL_DISABLES');
    expect(fs.map((f) => (f.subject as { id: string }).id).sort()).toEqual([sby as string, snp as string].sort());
  });

  it('a failover disables the original primary too, and the bystanders do not follow', () => {
    const t = simulate(doc, [crashed(doc), failover(lsby, 0)]);
    expect(t.facts.newPrimary).toBe(lsby);
    for (const id of [sby as string, snp as string]) {
      expect(endState(t, id), id).toBe('disabled');
    }
    /* The crashed host stays 'down' on its lane; the broker still lists it as disabled. */
    const who = t.findings.filter((f) => f.id === 'ROLE.LOGICAL_DISABLES')
      .map((f) => (f.subject as { id: string }).id).sort();
    expect(who).toEqual(['prm01', sby as string, snp as string].sort());
    const follow = decision(t, 'BYSTANDERS.FOLLOW');
    expect(follow?.taken).toBe(false);
    expect(follow?.claim.cite).toContain('FAILOVER.LOGICAL_DISABLES_OTHERS');
    expect(follow?.claim.value).not.toMatch(/^BystandersFollowRoleChange is ALL/);
    expect(decision(t, 'BYSTANDERS.AHEAD')).toBeUndefined();
  });

  it('REINSTATE does not bring a disabled member back: it must be re-created', () => {
    const t = simulate(doc, [switchover(lsby), { at: 60, kind: 'cmd.reinstate', member: sby }]);
    expect(finding(t, 'REINSTATE.MUST_RECREATE')).toBeTruthy();
    expect(endState(t, sby as string)).toBe('disabled');
  });

  it('a switchover to a physical standby leaves the bystanders alone', () => {
    const t = simulate(doc, [switchover(sby)]);
    expect(t.findings.some((f) => f.id === 'ROLE.LOGICAL_DISABLES')).toBe(false);
    expect(endState(t, snp as string)).not.toBe('disabled');
  });
});

/* ---------------- VAL-07 ---------------- */

describe('VAL-07: a switchover to a logical standby is disallowed in maximum protection', () => {
  /* "Switchover to a logical standby database is disallowed when the
     configuration is operating in maximum protection mode." */
  const doc = withMode(bystandersOff(), 'MAXPROTECTION');
  const lsby = idOf(doc, 'logical');

  it('cites the sentence by id', () => {
    expect(quote('SWITCHOVER.LOGICAL_MAXPROT')).toBe(
      'Switchover to a logical standby database is disallowed when the configuration is operating in maximum protection mode.');
  });

  it('refuses it in the engine', () => {
    const t = simulate(doc, [switchover(lsby)]);
    expect(t.facts.blocked).toBe(true);
    expect(t.facts.newPrimary).toBeNull();
    expect(t.facts.switchover?.refusal).toBe('logical-maxprotection');
    expect(decision(t, 'SWITCHOVER.GATE')?.claim.cite).toContain('SWITCHOVER.LOGICAL_MAXPROT');
  });

  it('validate() names the command', () => {
    const f = validate({ ...doc, events: [switchover(lsby)] }).filter((x) => x.id === 'ROLE.SWITCHOVER_LOGICAL_MAXPROT');
    expect(f).toHaveLength(1);
  });

  it('disables the menu row with the reason', () => {
    const row = actionsForKey(doc, lsby as string, 0).find((a) => a.id === 'cmd.switchover');
    expect(row?.enabled.state).toBe('off');
    expect(row?.enabled.state === 'off' ? row.enabled.why : '').toContain('maximum protection');
  });

  it('is allowed in maximum availability', () => {
    const t = simulate(withMode(bystandersOff(), 'MAXAVAILABILITY'), [switchover(lsby)]);
    expect(t.facts.blocked).toBe(false);
  });
});

/* ---------------- SIM-23 ---------------- */

describe('SIM-23: a snapshot standby has no apply to start or stop', () => {
  /* "unlike a physical or logical standby database, a snapshot standby
     database does not apply the redo data that it receives" and "Snapshot
     standby databases are not listed in this table because they do not have
     states; they only receive redo data." (MEM19) */
  const doc = bystandersOff();
  const snp = idOf(doc, 'snapshot');
  const lsby = idOf(doc, 'logical');

  it('cites both sentences by id', () => {
    expect(quote('MEMBER.SNAPSHOT_NO_APPLY')).toContain('a snapshot standby database does not apply the redo data that it receives');
    expect(quote('MEMBER.SNAPSHOT_NO_STATES')).toContain('they only receive redo data');
  });

  it('disables the row on a snapshot standby, with the reason', () => {
    const row = actionsForKey(doc, snp as string, 0).find((a) => a.id === 'apply.toggle');
    expect(row?.enabled.state).toBe('off');
    expect(row?.enabled.state === 'off' ? row.enabled.why : '').toContain('does not apply the redo');
  });

  it('never draws a snapshot standby applying, whatever the property says', () => {
    const t = simulate(patch(doc, snp as string, { applyRunning: true }), []);
    expect(states(t, snp as string).every((s) => s !== 'mounted-apply')).toBe(true);
  });

  it('calls it SQL Apply on a logical standby, redo apply on a physical one', () => {
    const logical = actionsForKey(doc, lsby as string, 0).find((a) => a.id === 'apply.toggle');
    expect(logical?.label).toContain('SQL Apply');
    expect(logical?.label).not.toContain('redo apply');
    const physical = actionsForKey(doc, idOf(doc, 'physical') as string, 0).find((a) => a.id === 'apply.toggle');
    expect(physical?.label).toContain('redo apply');
    expect(physical?.enabled.state).toBe('on');
  });
});

/* ---------------- SIM-26 ---------------- */

describe('SIM-26: a failover waits for the redo a stopped apply left behind', () => {
  /* FSFO19: the complete failover "Waits for the target standby database to
     finish applying any unapplied redo data before stopping Redo Apply". The
     wait is documented; its size is this page's model. */
  const classic = (stopped: boolean): TopologyDoc =>
    patch(classicTopology({ observerLoc: 'dc3' }), 'sby01', { applyRunning: !stopped });

  const crash = (d: TopologyDoc): TimedEvent[] => [
    { at: 20, kind: 'host.down', host: (d.members[0] as DatabaseMember).instances[0]!.host },
  ];

  it('cites the sentence by id', () => {
    expect(quote('FAILOVER.WAITS_FOR_APPLY')).toBe(
      'Waits for the target standby database to finish applying any unapplied redo data before stopping Redo Apply');
  });

  it('opens later when apply was stopped for the run, by the redo the primary generated', () => {
    const running = simulate(classic(false), crash(classic(false)));
    const stopped = simulate(classic(true), crash(classic(true)));
    expect(running.facts.newPrimary).toBe(memberId('sby01'));
    expect(stopped.facts.newPrimary).toBe(memberId('sby01'));
    expect(stopped.facts.tOpen as number).toBeGreaterThan(running.facts.tOpen as number);
    const wait = decision(stopped, 'FAILOVER.APPLY_WAIT');
    expect(wait?.claim.basis).toBe('model');
    expect(wait?.claim.cite).toContain('FAILOVER.WAITS_FOR_APPLY');
    expect(decision(running, 'FAILOVER.APPLY_WAIT')).toBeUndefined();
  });

  it('opens later the longer the primary ran before it was lost', () => {
    const at = (x: number): number => {
      const d = classic(true);
      const t = simulate(d, [{ at: x, kind: 'host.down', host: (d.members[0] as DatabaseMember).instances[0]!.host }]);
      return (t.facts.tOpen as number) - (t.facts.initiateAt as number);
    };
    expect(at(40)).toBeGreaterThan(at(10));
  });

  it('a manual failover waits as well', () => {
    const d = classic(true);
    const events: TimedEvent[] = [...crash(d), { at: 30, kind: 'cmd.failover', to: memberId('sby01') }];
    const run = simulate(withFsfoOff(d), events);
    const ok = simulate(withFsfoOff(classic(false)), events);
    expect(run.facts.tOpen as number).toBeGreaterThan(ok.facts.tOpen as number);
  });
});
