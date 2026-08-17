import { describe, expect, it } from 'vitest';
import {
  assertCitesAllowed, CITATIONS, CITATION_IDS, citation, FORBIDDEN_FACTS, isCitationId,
} from '../citations';
import type { CitationId, ForbiddenFact } from '../citations';
import { BROKER_DEFAULTS } from '../defaults';
import type { Claim, Finding } from '../types/claims';
import { claimWellFormed } from '../types/claims';
import { resolveRedoGraph } from '../redo/resolve';
import { classicTopology } from '../compat/classic';
import { parseRedoRoutesOrThrow } from '../redo/parse';
import { memberId } from '../ids';
import { applyNetEvent, initialNetState } from '../net/graph';
import type { TopologyDoc } from '../types/topology';

describe('the catalogue', () => {
  it('is not empty and every id resolves', () => {
    expect(CITATION_IDS.length).toBeGreaterThan(50);
    for (const id of CITATION_IDS) {
      expect(citation(id)).toBeTruthy();
      expect(isCitationId(id)).toBe(true);
    }
    expect(isCitationId('NOPE.NOT_HERE')).toBe(false);
    expect(() => citation('NOPE.NOT_HERE' as CitationId)).toThrow(/unknown citation id/);
  });

  it('every entry carries a URL and a quoted sentence', () => {
    for (const id of CITATION_IDS) {
      const c = citation(id);
      expect(c.url, id).toMatch(/^https:\/\/(docs|www)\.oracle\.com\//);
      expect(c.quote.trim().length, id).toBeGreaterThan(10);
      expect(['12.1', '12.2', '19c', '21c', '26ai']).toContain(c.edition);
      expect(['primary', 'cross-edition']).toContain(c.verified);
    }
  });

  it('a cross-edition citation is one whose fact is stated best outside 19c', () => {
    /* The precedent AGENTS.md sets: the 21c ObserverPing* pages, the 12.1
       HABPT observer-placement hierarchy, the 12.1 FASTSYNC notice. */
    for (const id of ['FSFO.PING_PROPS_21C', 'OBS.PLACEMENT_STANDBY_DC', 'XPT.FASTSYNC_12_1'] as CitationId[]) {
      expect(citation(id).verified, id).toBe('cross-edition');
    }
  });

  it('pins the traps the fact sheet lists', () => {
    expect(citation('OBS.START_FILE_IS').quote).toContain('FILE IS');
    expect(citation('OBS.START_FILE_IS').quote).not.toContain('FILE=');
    expect(citation('ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX').quote)
      .toBe('GROUP is a LOG_ARCHIVE_DEST_n attribute, not RedoRoutes syntax.');
    expect(citation('FSFO.TARGET_ORDER').quote).toContain('order in which they are specified');
    expect(citation('FSFO.TARGET_ORDER').note).toMatch(/never as "first viable in list order"/);
    expect(citation('MAXAVAIL.AT_LEAST_ONE').quote).toContain('at least one synchronized standby');
    expect(citation('CASCADE.THIRTY_TERMINAL').quote).toBe('up to 30 terminal destinations');
    expect(citation('CASCADE.THIRTY_TERMINAL').note).toMatch(/Never write "30 remote destinations"/);
  });

  it('pins the 2026-08-17 re-verification against the full 19c pages', () => {
    /* The 19c properties and commands pages fetched truncated on 2026-08-16;
       fetched whole a day later they document what had been cited to later
       editions, and two earlier readings turned out to be wrong. */
    expect(citation('OBS.CANNOT_OCCUR_LIST').note).not.toMatch(/^First entry/);
    expect(citation('OBS.CANNOT_OCCUR_LIST').note).toMatch(/fourth of ten/);
    expect(citation('OBS.PREFERRED_HOSTS').edition).toBe('19c');
    expect(citation('OBS.SHOW_OBSERVER_FIELDS').edition).toBe('19c');
    expect(citation('OBS.NO_MASTER_WHEN_DISABLED').edition).toBe('19c');
    expect(citation('CFG.WIDE_SERVICE_NAME').edition).toBe('19c');
    expect(citation('ROUTES.PRIORITY_26AI').edition).toBe('19c');
    expect(citation('ROUTES.GROUP_MAXFAILURE_ZERO').url).toMatch(/\/26\/dgbkr\/redoroutes\.html$/);
    expect(citation('ROUTES.CANONICAL_PAIR').url).toMatch(/\/19\/dgbkr\//);
    expect(citation('OBS.OBSERVE_ONLY').url).toMatch(/examples-using-data-guard-broker-DGMGRL-utility/);
    /* Neither ReopenSecs nor MaxFailure is on the 19c deprecation list. */
    const dep = citation('DEST.DEPRECATED_19C');
    expect(dep.url).toMatch(/\/19\/dgbkr\/release-changes\.html$/);
    expect(dep.quote).toContain('ArchiveLagTarget');
    expect(dep.quote).not.toContain('MaxFailure');
    expect(dep.quote).not.toContain('ReopenSecs');
    expect(citation('DEST.MAXFAILURE_BROKER_PAGE_STALE').quote).not.toBe('Corresponds to: VALID_FOR');
    /* MaxProtection's "at least one" lives on the broker chapter 4 page. */
    expect(citation('MAXAVAIL.AT_LEAST_ONE').note).toMatch(/broker chapter 4/);
  });

  it('carries both sides of every documented contradiction', () => {
    expect(citation('OBS.THREE_19C').edition).toBe('19c');
    expect(citation('OBS.FOUR_26AI').edition).toBe('26ai');
    expect(citation('OBS.THREE_26AI_SHOW').note).toMatch(/cite both sides/);
    expect(citation('FSFO.PING_DEFAULTS_26AI_ZERO').edition).toBe('26ai');
    expect(citation('FSFO.PING_DEFAULTS_26AI_TABLE').note).toMatch(/contradiction/);
  });
});

describe('the sources AGENTS.md rules out', () => {
  const stale: Array<[CitationId, ForbiddenFact]> = [
    ['FSFO.LAGLIMIT_STALE_TASK3', 'LAG_LIMIT_MODE'],
    ['FSFO.LAGLIMIT_STALE_TASK3', 'MAXAVAIL_TRANSPORTS'],
    ['FSFO.LAGLIMIT_STALE_PROPERTY_CLOSING_LINE', 'LAG_LIMIT_MODE'],
    ['DEST.MAXFAILURE_BROKER_PAGE_STALE', 'MAX_FAILURE_SEMANTICS'],
    ['COMMIT.LOG_FILE_PARALLEL_WRITE_STALE', 'COMMIT_MAX_NOT_SUM'],
  ];

  it('are in the catalogue only so the engine can refuse them', () => {
    for (const [id, fact] of stale) {
      expect(citation(id).forbiddenFor, id).toContain(fact);
      expect(() => assertCitesAllowed(fact, [id])).toThrow(/forbidden/);
    }
  });

  it('every forbidden fact key is documented in FORBIDDEN_FACTS', () => {
    for (const [, fact] of stale) expect(FORBIDDEN_FACTS[fact]).toBeTruthy();
    for (const id of CITATION_IDS) {
      for (const f of citation(id).forbiddenFor ?? []) {
        expect(Object.keys(FORBIDDEN_FACTS), `${id} -> ${f}`).toContain(f);
      }
    }
  });

  it('let the allowed source through for the same fact', () => {
    expect(() => assertCitesAllowed('LAG_LIMIT_MODE', ['FSFO.LAGLIMIT_MAXAVAIL_26AI'])).not.toThrow();
    expect(() => assertCitesAllowed('MAX_FAILURE_SEMANTICS', ['DEST.MAX_FAILURE'])).not.toThrow();
    expect(() => assertCitesAllowed('COMMIT_MAX_NOT_SUM', ['COMMIT.THIRTEEN_STEPS'])).not.toThrow();
  });

  it('the lag-limit ranges page is usable for ranges but fenced off from the mode question', () => {
    expect(citation('FSFO.LAGLIMIT_RANGES').forbiddenFor).toContain('LAG_LIMIT_MODE');
    expect(citation('FSFO.LAGLIMIT_RECOMMENDATION').forbiddenFor).toBeUndefined();
  });
});

/* ---------------- what the engine actually emits ---------------- */

function sampleDocs(): TopologyDoc[] {
  const base = classicTopology({});
  const farSync = classicTopology({});
  const fs1 = {
    ...base.members[0]!,
    id: memberId('FS1'), name: 'FS1', kind: 'farsync' as const,
    instances: [{ name: 'FS1', host: base.hosts[0]!.id }],
    redoRoutes: parseRedoRoutesOrThrow('(prm01 : sby01 ASYNC)'),
    logXptMode: 'SYNC' as const, transportLagSeconds: 0,
  };
  delete (fs1 as Record<string, unknown>)['role'];
  farSync.members = [
    { ...base.members[0]!, redoRoutes: parseRedoRoutesOrThrow('(LOCAL : FS1 SYNC)') },
    base.members[1]!,
    fs1 as unknown as TopologyDoc['members'][number],
  ];
  const maxprot = classicTopology({});
  maxprot.config.protectionMode = 'MAXPROTECTION';
  const maxperf = classicTopology({ mode: 'maxperf' });
  return [base, farSync, maxprot, maxperf];
}

function collect(): Array<Claim<unknown> | Finding> {
  const out: Array<Claim<unknown> | Finding> = [];
  for (const d of Object.values(BROKER_DEFAULTS)) {
    out.push(d.pingIntervalMs, d.pingRetry, d.observerCount);
  }
  for (const doc of sampleDocs()) {
    for (const primary of doc.members.map((m) => m.id)) {
      for (const net of [initialNetState(doc), applyNetEvent(initialNetState(doc), { kind: 'host.down', host: doc.hosts[0]!.id })]) {
        const g = resolveRedoGraph(doc, { primary, net });
        out.push(g.protectionLevel, ...g.findings);
        for (const m of Object.values(g.members)) {
          out.push(m.synchronized, m.countsTowardProtectionAck);
        }
      }
    }
  }
  return out;
}

describe('every claim and finding the engine emits', () => {
  const emitted = collect();

  it('produces a sizeable sample to check', () => {
    expect(emitted.length).toBeGreaterThan(50);
  });

  it('cites only ids that resolve', () => {
    for (const c of emitted) {
      for (const id of c.cite) {
        expect(isCitationId(id), `${id} in ${JSON.stringify(c).slice(0, 120)}`).toBe(true);
      }
    }
  });

  it('is documented with a citation, or labelled with a note', () => {
    for (const c of emitted) {
      expect(claimWellFormed(c), JSON.stringify(c).slice(0, 200)).toBe(true);
      if (c.basis !== 'documented') expect(c.note, JSON.stringify(c).slice(0, 200)).toBeTruthy();
    }
  });

  it('never leans on a source AGENTS.md ruled out', () => {
    const forbidden = new Set(CITATION_IDS.filter((id) => citation(id).forbiddenFor));
    for (const c of emitted) {
      for (const id of c.cite) {
        expect(forbidden.has(id), `${id} is a stale source`).toBe(false);
      }
    }
  });
});
