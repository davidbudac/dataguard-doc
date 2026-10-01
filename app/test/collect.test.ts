import { describe, expect, it } from 'vitest';
import { importCollectedTopology, lagLimitIsSet, lagLimitOf, memberId, parseTopologyDoc, resolveRedoGraph } from '@/engine';
import { makeDoc } from '@/state/doc';
import { parseJsonText, toJsonText } from '@/state/codec';

import { block, dest, sample } from './fixtures/collector';

describe('collector import', () => {
  it('draws only observed current routes and retains the empty-route distinction through export', () => {
    const { topology, notes } = importCollectedTopology(sample());
    expect(topology.members.map(m => m.name)).toEqual(['P', 'S']);
    expect(topology.observers).toEqual([]);
    const roundTrip = parseJsonText(toJsonText(makeDoc(topology))).doc!.topology;
    expect(parseTopologyDoc(topology).issues).toEqual([]);
    const graph = resolveRedoGraph(roundTrip, { primary: memberId('P') });
    expect(graph.edges.map(e => [e.from, e.to, e.xpt])).toEqual([['P', 'S', 'SYNC']]);
    expect(resolveRedoGraph(roundTrip, { primary: memberId('S') }).edges).toEqual([]);
    expect(notes.join(' ')).toContain('not discovered data centres');
  });
  it('requires every discovered member, without inventing hosts', () => {
    expect(() => importCollectedTopology(block('P', 'PRIMARY', [dest()]))).toThrow(/Also run.*S/);
  });
  it.each([
    [() => sample().replace(/DGTOPO_END_V1$/, ''), /end marker/],
    [() => sample() + '\nORA-00942: table or view does not exist', /Oracle\/client error/],
    [() => sample().replace('"name":"P"', '"name":'), /Invalid collector JSON/],
    [() => sample().replace('DGTOPO_BEGIN_V1', 'DGTOPO_BEGIN_V2'), /unsupported collector version/],
    [() => sample() + '\n' + block('P', 'PRIMARY'), /Duplicate/],
    [() => sample().replace('PHYSICAL STANDBY', 'PRIMARY'), /multiple primaries/],
    [() => sample().replaceAll('CDB$ROOT', 'PDB1'), /not a PDB/],
    [() => 'x'.repeat(2_000_001), /2 MB/],
  ] as const)('rejects invalid/partial/conflicting input', (input, error) => {
    expect(() => importCollectedTopology(input())).toThrow(error);
  });
  it('deduplicates matching RAC destination rows and rejects mismatched transport', () => {
    const input = block('P', 'PRIMARY', [dest(), { ...dest(), instance: 2 }], [{ type: 'instance', name: 'P2', host: 'p2.example', version: '19.27.0.0.0' }]) + '\n' + block('S', 'PHYSICAL STANDBY');
    expect(importCollectedTopology(input).topology.members[0]!.instances).toHaveLength(2);
    expect(() => importCollectedTopology(block('P', 'PRIMARY', [dest(), { ...dest(), instance: 2, affirm: 'NO' }]) + '\n' + block('S', 'PHYSICAL STANDBY'))).toThrow(/differing destinations/);
  });
  it('does not draw deferred destinations as working routes', () => {
    const input = block('P', 'PRIMARY', [{ ...dest(), status: 'DEFERRED' }]) + '\n' + block('S', 'PHYSICAL STANDBY');
    const result = importCollectedTopology(input);
    expect(resolveRedoGraph(result.topology, { primary: memberId('P') }).edges).toEqual([]);
    expect(result.notes.join(' ')).toContain('DEFERRED');
  });
  it('records simulator numeric repairs instead of silently clamping live data', () => {
    const input = block('P', 'PRIMARY', [{ ...dest(), netTimeout: 5000 }]) + '\n' + block('S', 'PHYSICAL STANDBY');
    expect(importCollectedTopology(input).notes.join(' ')).toMatch(/Simulator adjustment.*netTimeout/);
  });
  it('imports far sync and cascading as their own hops', () => {
    const extra = { type: 'member', name: 'F' };
    const input = block('P', 'PRIMARY', [dest('F')], [extra]) + '\n' + block('F', 'FAR SYNC', [{ ...dest(), transmit: 'ASYNCHRONOUS', affirm: 'NO' }], [extra]) + '\n' + block('S', 'PHYSICAL STANDBY', [], [extra]);
    const result = importCollectedTopology(input);
    expect(result.topology.members[1]!.kind).toBe('farsync');
    expect(resolveRedoGraph(result.topology, { primary: memberId('P') }).edges.map(e => [e.from, e.to])).toEqual([['P', 'F'], ['F', 'S']]);
  });
});

it('uses primary FSFO values only when FSFO is enabled, and never creates backup observers', () => {
  const input = sample().replace('"fsfo":"DISABLED"', '"fsfo":"OBSERVE-ONLY","threshold":42,"target":"S","observerHost":"obs.example","observerPresent":"YES"');
  const result = importCollectedTopology(input);
  expect(result.topology.config.fsfo.state).toBe('observe-only');
  expect(result.topology.config.fsfo.thresholdSeconds).toBe(42);
  expect(result.topology.config.fsfo.target).toEqual({ kind: 'list', members: ['S'] });
  expect(result.topology.observers).toHaveLength(1);
  expect(result.topology.observers[0]!.role).toBe('master');
  expect(result.topology.observers[0]!.running).toBe(true);
  const disabled = importCollectedTopology(input.replace('OBSERVE-ONLY', 'DISABLED'));
  expect(disabled.topology.observers).toEqual([]);
  expect(disabled.topology.config.fsfo.target).toEqual({ kind: 'list', members: [] });
});

it('maps FASTSYNC, accepts non-CDB names different from DB_UNIQUE_NAME and retains real lag samples', () => {
  const input = (block('P', 'PRIMARY', [{ ...dest(), affirm: 'NO' }]) + '\n' + block('S', 'PHYSICAL STANDBY', [], [
    { type: 'lag', name: 'apply lag', value: '+00 00:00:20' },
    { type: 'lag', name: 'transport lag', value: '+00 00:00:05' },
  ])).replaceAll('"cdb":"YES","container":"CDB$ROOT"', '"cdb":"NO","container":"PROD"');
  const { topology } = importCollectedTopology(input);
  expect(resolveRedoGraph(topology, { primary: memberId('P') }).edges[0]!.xpt).toBe('FASTSYNC');
  const standby = topology.members[1]!;
  expect(standby.kind === 'database' && standby.applyLagSeconds).toBe(20);
  expect(standby.transportLagSeconds).toBe(5);
});

it('uses the selected edition and protection mode for uncollected lag-limit defaults', () => {
  const input = sample().replaceAll('MAXIMUM AVAILABILITY', 'MAXIMUM PERFORMANCE');
  /* The collector does not read the property, so it is left not set and the
     limit in force follows the edition and the collected mode. */
  const perf = importCollectedTopology(input, '26ai').topology;
  const avail = importCollectedTopology(sample(), '26ai').topology;
  expect(lagLimitIsSet(perf.config.fsfo)).toBe(false);
  expect(lagLimitOf(perf)).toBe(30);
  expect(lagLimitOf(avail)).toBe(0);
  expect(lagLimitOf({ config: { ...avail.config, edition: '19c' } })).toBe(30);
});

it('retains a valid route with a configured alternate without inventing the fallback', () => {
  const input = block('P', 'PRIMARY', [{ ...dest(), alternate: 'LOG_ARCHIVE_DEST_3' }])
    + '\n' + block('S', 'PHYSICAL STANDBY');
  const result = importCollectedTopology(input);
  expect(resolveRedoGraph(result.topology, { primary: memberId('P') }).edges).toHaveLength(1);
  expect(result.notes.join(' ')).toContain('alternate LOG_ARCHIVE_DEST_3 is not reconstructed');
});

it('reads Oracle\'s ALTERNATE value NONE as no alternate', () => {
  const result = importCollectedTopology(sample());
  expect(resolveRedoGraph(result.topology, { primary: memberId('P') }).edges).toHaveLength(1);
  expect(result.notes.join(' ')).not.toMatch(/alternate \S+ is not reconstructed/);
});

it('enforces the same UTF-8 byte limit for paste and file contents', () => {
  expect(() => importCollectedTopology('é'.repeat(1_000_001))).toThrow(/2 MB/);
});

it('does not turn a malformed lag interval into a measured value', () => {
  const input = block('P', 'PRIMARY', [dest()]) + '\n' + block('S', 'PHYSICAL STANDBY', [], [
    { type: 'lag', name: 'apply lag', value: '+00 00:99:00' },
  ]);
  expect(importCollectedTopology(input).notes.join(' ')).toContain('S: apply lag unavailable');
});
