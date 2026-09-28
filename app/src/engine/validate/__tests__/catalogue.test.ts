/**
 * Catalogue-wide checks: labelling, citations, edition gating and the
 * wordings the accuracy rules pin down.
 *
 * The rule tests next door say when each rule fires. These say that whatever
 * it emits is labelled the way the design declares, rests on a source that
 * resolves, and never reaches for a spelling AGENTS.md rules out.
 */

import { describe, expect, it } from 'vitest';
import { RULE_CATALOGUE, RULE_IDS, RULES_26AI_ONLY, allowedBases, allowedSeverities } from '../catalogue';
import type { RuleId } from '../catalogue';
import { validate } from '..';
import type { Finding } from '../../types/claims';
import { claimWellFormed } from '../../types/claims';
import { CITATION_IDS, citation, isCitationId } from '../../citations';
import type { TopologyDoc } from '../../types/topology';
import { baseDoc, corpus, farSyncDoc, M, twoStandbyDoc } from './fixtures';

const DOCS = corpus();
const ALL: Array<{ doc: TopologyDoc; f: Finding }> = DOCS.flatMap(
  (doc) => validate(doc).map((f) => ({ doc, f })),
);
const FINDINGS = ALL.map((x) => x.f);

describe('the corpus', () => {
  it('is broad enough to be worth walking', () => {
    expect(DOCS.length).toBeGreaterThan(40);
    expect(FINDINGS.length).toBeGreaterThan(200);
    const seen = new Set(FINDINGS.map((f) => f.id));
    /* Not every rule needs a corpus document -- the pair tests cover those --
       but most of the catalogue should show up here. */
    expect(seen.size).toBeGreaterThanOrEqual(Math.floor(RULE_IDS.length * 0.7));
  });
});

describe('every finding is labelled the way the catalogue declares', () => {
  it('carries a known rule id', () => {
    const known = new Set<string>(RULE_IDS);
    for (const f of FINDINGS) expect(known, f.id).toContain(f.id);
  });

  it('emits only a severity and a basis the rule declares', () => {
    for (const f of FINDINGS) {
      const id = f.id as RuleId;
      expect(allowedSeverities(id), `${id} severity`).toContain(f.severity);
      expect(allowedBases(id), `${id} basis`).toContain(f.basis);
    }
  });

  it('is documented with a citation, or labelled with a note', () => {
    for (const f of FINDINGS) {
      expect(claimWellFormed(f), `${f.id}: ${f.message}`).toBe(true);
      if (f.basis !== 'documented') expect(f.note, f.id).toBeTruthy();
    }
  });

  it('cites only ids that resolve to a URL and a quoted sentence', () => {
    for (const f of FINDINGS) {
      expect(f.cite.length, f.id).toBeGreaterThan(0);
      for (const id of f.cite) {
        expect(isCitationId(id), `${f.id} cites ${id}`).toBe(true);
        expect(citation(id).url).toMatch(/^https:\/\//);
      }
    }
  });

  it('never leans on a source AGENTS.md ruled out', () => {
    const stale = new Set(CITATION_IDS.filter((id) => citation(id).forbiddenFor));
    for (const f of FINDINGS) {
      for (const id of f.cite) expect(stale.has(id), `${f.id} cites the stale ${id}`).toBe(false);
    }
  });

  it('carries a message that reads as a sentence', () => {
    for (const f of FINDINGS) {
      expect(f.message.length, f.id).toBeGreaterThan(40);
      expect(f.message.trim(), f.id).toBe(f.message);
    }
  });

  it('keeps severity and basis orthogonal across the catalogue', () => {
    const bySeverity = new Map<string, Set<string>>();
    for (const id of RULE_IDS) {
      const s = RULE_CATALOGUE[id].severity;
      const set = bySeverity.get(s) ?? new Set<string>();
      set.add(RULE_CATALOGUE[id].basis);
      bySeverity.set(s, set);
    }
    /* Errors that rest on a model, warnings that quote a sentence: both exist. */
    expect(bySeverity.get('error')).toContain('model');
    expect(bySeverity.get('warning')).toContain('documented');
  });
});

describe('the edition gate', () => {
  it('never fires a 26ai-only rule under 19c', () => {
    expect(RULES_26AI_ONLY.length).toBeGreaterThan(0);
    for (const doc of DOCS) {
      if (doc.config.edition !== '19c') continue;
      for (const f of validate(doc)) {
        expect(RULES_26AI_ONLY as string[], `${f.id} fired under 19c`).not.toContain(f.id);
      }
    }
  });

  it('runs the whole 19c corpus through a forced 26ai pass without losing a 19c finding', () => {
    /* Everything the 19c pass reports must still be reportable under 26ai,
       except the rules the editions genuinely disagree about -- including the
       three 19c-only doc-later findings (ED-02: LagType/LagGraceTime/
       PrimaryDatabaseCandidates and the ObserverPing* properties are all
       documented from a later edition and vanish once the edition is 26ai,
       by design, since the 26ai pass no longer disagrees with the document). */
    const editionSensitive = new Set([
      'FSFO.FARSYNC_MODE_19C', 'OBS.COUNT', 'XPT.TABLE_4_2',
      'FSFO.PING_PROPS_NOT_IN_19C', 'FSFO.LAGTYPE_GRACETIME_19C', 'CFG.PRIMARY_CANDIDATES_19C',
    ]);
    for (const doc of DOCS) {
      if (doc.config.edition !== '19c') continue;
      const under19 = new Set(validate(doc).map((f) => f.id));
      const as26 = { ...doc, config: { ...doc.config, edition: '26ai' as const } };
      const under26 = new Set(validate(as26).map((f) => f.id));
      for (const id of under19) {
        if (editionSensitive.has(id)) continue;
        expect(under26, `${id} vanished under 26ai`).toContain(id);
      }
    }
  });

  it('gates the far sync mode rule differently in the two editions', () => {
    const fired = (edition: '19c' | '26ai', mode: 'MAXPROTECTION' | 'MAXAVAILABILITY' | 'MAXPERFORMANCE'): boolean =>
      validate(farSyncDoc({ edition, mode })).some((f) => f.id === 'FSFO.FARSYNC_MODE_19C');

    expect(fired('19c', 'MAXPROTECTION')).toBe(true);
    expect(fired('19c', 'MAXPERFORMANCE')).toBe(true);
    expect(fired('19c', 'MAXAVAILABILITY')).toBe(false);
    /* 26ai drops the maximum performance exclusion and keeps the other one. */
    expect(fired('26ai', 'MAXPROTECTION')).toBe(true);
    expect(fired('26ai', 'MAXPERFORMANCE')).toBe(false);
    expect(fired('26ai', 'MAXAVAILABILITY')).toBe(false);
  });

  it('reports the far sync mode rule as a conflict citing all three pages', () => {
    const f = validate(farSyncDoc({ edition: '19c', mode: 'MAXPERFORMANCE' }))
      .find((x) => x.id === 'FSFO.FARSYNC_MODE_19C');
    expect(f).toBeTruthy();
    expect(f?.basis).toBe('conflict');
    expect(f?.cite).toEqual(
      expect.arrayContaining(['FSFO.FARSYNC_MODES_19C', 'FSFO.FARSYNC_MODES_26AI', 'FS.MODES_CA_19C']),
    );
    expect(f?.note).toMatch(/26ai/);
    /* No ORA number is documented for that refusal. */
    expect(f?.ora).toBeUndefined();
  });

  it('counts observers per edition: three under 19c, four under 26ai', () => {
    const hosts: [string, string][] = [['dc1-prm01', 'dc1'], ['dc2-sby01', 'dc2'],
      ['dc3-obs01', 'dc3'], ['dc3-obs02', 'dc3'], ['dc3-obs03', 'dc3'], ['dc3-obs04', 'dc3'],
      ['dc3-obs05', 'dc3']];
    const observersUpTo = (n: number): TopologyDoc['observers'] => Array.from({ length: n }, (_, i) => ({
      id: `obs0${i + 1}` as never, name: `obs0${i + 1}`, host: `dc3-obs0${i + 1}` as never,
      role: (i === 0 ? 'master' : 'backup') as never, running: true,
    }));
    const withObservers = (edition: '19c' | '26ai', n: number): TopologyDoc =>
      baseDoc({ edition, hosts, observers: observersUpTo(n) });

    expect(validate(withObservers('19c', 4)).some((f) => f.id === 'OBS.COUNT')).toBe(true);
    expect(validate(withObservers('26ai', 4)).some((f) => f.id === 'OBS.COUNT')).toBe(false);
    expect(validate(withObservers('26ai', 5)).some((f) => f.id === 'OBS.COUNT')).toBe(true);
    /* The move from three to four is settled at 21c (ORA-16647); the two
       conflicts that survive it are edition-specific and different from each
       other -- 19c's own command reference against its own fast-start
       failover chapter, 26ai's own SHOW OBSERVER page against its own
       fast-start failover chapter -- so the notes name different pages. */
    const f19 = validate(withObservers('19c', 4)).find((x) => x.id === 'OBS.COUNT');
    expect(f19?.basis).toBe('conflict');
    expect(f19?.note).toMatch(/START OBSERVER/);
    expect(f19?.note).toMatch(/settled at 21c/);
    const f26 = validate(withObservers('26ai', 5)).find((x) => x.id === 'OBS.COUNT');
    expect(f26?.basis).toBe('conflict');
    expect(f26?.note).toMatch(/SHOW OBSERVER/);
  });

  it('turns the maximum availability ASYNC finding from an error into a warning under 26ai', () => {
    const doc = (edition: '19c' | '26ai'): TopologyDoc => {
      const d = baseDoc({ edition, mode: 'MAXAVAILABILITY' });
      const sby = d.members.find((m) => (m.id as string) === 'sby01');
      if (sby) sby.logXptMode = 'ASYNC';
      return d;
    };
    const pick = (d: TopologyDoc): Finding | undefined =>
      validate(d).find((f) => f.id === 'XPT.TABLE_4_2');
    expect(pick(doc('19c'))?.severity).toBe('error');
    expect(pick(doc('26ai'))?.severity).toBe('warning');
    expect(pick(doc('26ai'))?.message).toMatch(/zero data loss still wants SYNC or FASTSYNC/);
  });
});

describe('the wordings the accuracy rules pin down', () => {
  const messages = FINDINGS.map((f) => `${f.message} ${f.note ?? ''}`);

  it('never writes "first viable"', () => {
    for (const m of messages) expect(m.toLowerCase()).not.toContain('first viable');
  });

  it('quotes the target order sentence as the documentation words it', () => {
    const f = validate(twoStandbyDoc({ targets: [] })).find((x) => x.id === 'FSFO.MULTI_TARGET_EXPLICIT');
    expect(f?.message).toContain('based on the order in which they are specified');
    expect(f?.cite).toContain('FSFO.TARGET_ORDER');
  });

  it('never writes "30 remote destinations"', () => {
    for (const m of messages) expect(m).not.toContain('30 remote destinations');
    const fanout = validate(corpus().find((d) => validate(d).some((f) => f.id === 'ROUTES.CASCADE_FANOUT_30'))!)
      .find((f) => f.id === 'ROUTES.CASCADE_FANOUT_30');
    expect(fanout?.message).toContain('up to 30 terminal destinations');
  });

  it('never says SYNC is illegal in maximum performance mode', () => {
    const d = baseDoc({ mode: 'MAXPERFORMANCE' });
    const f = validate(d).find((x) => x.id === 'XPT.TABLE_4_2');
    expect(f?.severity).toBe('info');
    expect(f?.message).toContain('the only transport mode broker Table 4-2 lists for maximum performance');
    expect(f?.message).toMatch(/does not say the others cannot be used/);
    for (const m of messages) expect(m).not.toMatch(/SYNC is illegal/i);
  });

  it('keeps "at least one synchronized standby" out of the maximum protection rules', () => {
    for (const { f } of ALL) {
      if (!f.id.startsWith('MODE.MAXPROT')) continue;
      expect(`${f.message} ${f.note ?? ''}`).not.toContain('at least one synchronized');
      expect(f.cite).not.toContain('MAXAVAIL.AT_LEAST_ONE');
    }
  });

  it('never spells GROUP as RedoRoutes syntax', () => {
    for (const { f } of ALL) {
      if (!f.id.startsWith('ROUTES.')) continue;
      expect(`${f.message} ${f.note ?? ''}`, f.id).not.toMatch(/\bGROUP\b/);
    }
  });

  it('keeps "no observer deployed" apart from "unobserved"', () => {
    const f = validate(baseDoc({ observers: [] })).find((x) => x.id === 'OBS.NONE_DEPLOYED');
    expect(f?.message).toContain('not the same as being unobserved');
    expect(f?.message).toContain('DISABLED');
    expect(f?.message).toContain('ORA-16820');
  });

  it('carries the terminal-standby manual failover warning on the direct-redo rule', () => {
    const f = validate(baseDoc({ observers: [] }));
    expect(f).toBeTruthy();
    const direct = ALL.map((x) => x.f).find((x) => x.id === 'FSFO.TARGET_DIRECT_REDO');
    expect(direct?.basis).toBe('inferred');
    expect(direct?.note).toContain('no attempt is made to transmit any unsent redo');
  });

  it('words the far sync onward hop as documented as ASYNC, never as forbidden', () => {
    const f = validate(farSyncDoc({ onward: 'SYNC' }))
      .find((x) => x.id === 'ROUTES.FARSYNC_ONWARD_SYNC_UNDOC');
    expect(f?.basis).toBe('model');
    expect(f?.message).toContain('documented as using ASYNC transport');
    expect(f?.note).toContain('never as forbidden');
    expect(`${f?.message} ${f?.note}`).not.toMatch(/forbids|is forbidden|illegal/i);
  });

  it('reads MaxFailure off the LOG_ARCHIVE_DEST_n page, never off the broker properties page', () => {
    const f = ALL.map((x) => x.f).find((x) => x.id === 'DEST.MAXFAILURE_RESET_UNDOC');
    expect(f?.cite).toContain('DEST.MAX_FAILURE');
    expect(f?.cite).not.toContain('DEST.MAXFAILURE_BROKER_PAGE_STALE');
    expect(f?.note).toMatch(/not documented/);
  });

  it('names the observer placement hierarchy in full and only as a caution', () => {
    const f = validate(baseDoc({
      hosts: [['dc1-prm01', 'dc1'], ['dc1-obs01', 'dc1'], ['dc2-sby01', 'dc2'], ['dc3-obs01', 'dc3']],
      observers: [{ id: 'obs01' as never, name: 'obs01', host: 'dc1-obs01' as never, role: 'master', running: true }],
    })).find((x) => x.id === 'OBS.PRIMARY_SITE');
    expect(f?.severity).toBe('warning');
    /* VAL-05: the old message had this backward -- "defensible only where
       the application tier is local to the primary" is the reverse of the
       HA guide's own caveat, which sends the observer away from the primary
       even then. */
    expect(f?.basis).toBe('inferred');
    expect(f?.message).toContain('third site or third data center');
    expect(f?.message).toContain('same path to connect to the production database');
    expect(f?.message).toContain("standby's data center on a separate host");
    expect(f?.message).toContain(
      'when the application tier is local to the production database, the observer belongs at either the standby location or a third data center instead',
    );
    expect(f?.message).not.toMatch(/defensible only where the application tier is local to the primary/);
    expect(f?.message).not.toMatch(/recommend/i);
  });
});

describe('ORA numbers', () => {
  it('are carried only where the broker documents one', () => {
    const withOra = FINDINGS.filter((f) => f.ora !== undefined);
    expect(withOra.length).toBeGreaterThan(0);
    for (const f of withOra) {
      expect(f.ora, f.id).toMatch(/^ORA-\d{5}$/);
      expect(['EDIT.FSFO_ENABLED_BLOCKS', 'EDIT.REMOVE_TARGET', 'OBS.NONE_DEPLOYED', 'FSFO.FLASHBACK_REQUIRED'])
        .toContain(f.id);
    }
  });

  it('gives ORA-16654 to the blocked edits and ORA-16867 to the target removal', () => {
    const fs = validate(baseDoc());
    expect(fs.find((f) => f.id === 'EDIT.FSFO_ENABLED_BLOCKS')?.ora).toBe('ORA-16654');
    expect(fs.find((f) => f.id === 'EDIT.REMOVE_TARGET')?.ora).toBe('ORA-16867');
  });

  it('never puts ORA-16658 on a standing condition: it belongs to an attempted failover', () => {
    for (const f of FINDINGS) expect(f.ora).not.toBe('ORA-16658');
  });
});

describe('the offered fixes', () => {
  const pointsAt = (doc: unknown, path: string): unknown => {
    let cur: unknown = doc;
    for (const seg of path.split('/').slice(1)) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
  };

  it('point at a value that exists in the document they came from', () => {
    let n = 0;
    for (const { doc, f } of ALL) {
      if (!f.fix) continue;
      n++;
      for (const op of f.fix.patch) {
        expect(op.op).toBe('replace');
        expect(pointsAt(doc, op.path), `${f.id} -> ${op.path}`).not.toBeUndefined();
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('raise NetTimeout into the recommended band', () => {
    const d = baseDoc();
    const prm = d.members.find((m) => (m.id as string) === 'prm01');
    if (prm) prm.dests[M('sby01')] = { netTimeoutSeconds: 2, reopenSeconds: 300, maxFailure: 0 };
    const f = validate(d).find((x) => x.id === 'DEST.NETTIMEOUT_LOW');
    expect(f?.fix?.patch[0]?.value).toBe(10);
    expect(f?.message).toContain('8 to 10 seconds');
  });
});
