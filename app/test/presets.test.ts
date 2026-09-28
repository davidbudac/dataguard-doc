/**
 * The presets are the scenario tests.
 *
 * Every preset is loaded, parsed as if it had arrived from a URL or a file,
 * resolved into a redo graph and simulated with its own default event set. The
 * paragraph each preset carries says what should happen; these are the
 * assertions behind those paragraphs.
 *
 * "Validates" means three things: the document parses under the schema with no
 * error and nothing repaired -- a preset that needed repairing would not be a
 * document a user could have built -- `validate()` returns no error-severity
 * finding, and the structural invariants hold (far sync never a target, targets
 * are physical or logical databases, observers never on a database host).
 *
 * The whole validation output is pinned, not only the errors. A preset is a
 * document Oracle's own documentation describes, so every warning and every
 * note it draws is a claim about that documented shape: the 19c deprecation
 * notice on a MaxFailure destination, the maximum-availability transport
 * warning against a 26ai bystander, the ORA-16867 note on a database the
 * fast-start failover target names. `EXPECTED_FINDINGS` below is that record.
 * When a rule changes, this table is the thing that says which documented
 * configuration changed with it -- and a preset that starts raising an error
 * is a preset that has stopped being a configuration a reader should copy.
 */

import { describe, expect, it } from 'vitest';
import {
  PRESET_IDS, PRESETS, findPreset, preset, presetDoc, presetEvents,
} from '../src/presets';
import type { Preset, PresetId } from '../src/presets';
import { citation, isCitationId } from '../src/engine/citations';
import { parseTopologyDoc } from '../src/engine/serialize/schema';
import { allowedBases, allowedSeverities, RULE_IDS, validate } from '../src/engine/validate';
import type { RuleId } from '../src/engine/validate';
import { resolveRedoGraph } from '../src/engine/redo/resolve';
import { simulate, stateAt } from '../src/engine/sim/simulate';
import { declaredPrimary, findMember, isDatabase, isFarSync } from '../src/engine/types/topology';
import type { Finding, RedoGraph, TopologyDoc } from '../src/engine';
import { memberId } from '../src/engine/ids';
import type { MemberId } from '../src/engine/ids';
import { formatRedoRoutes } from '../src/engine/redo/parse';

const M = (s: string): MemberId => memberId(s);

const member = (doc: TopologyDoc, id: string) => {
  const m = findMember(doc, M(id));
  expect(m).toBeDefined();
  return m as NonNullable<typeof m>;
};

const graphOf = (doc: TopologyDoc): RedoGraph => {
  const primary = declaredPrimary(doc);
  expect(primary).not.toBe(null);
  return resolveRedoGraph(doc, { primary: primary as MemberId });
};

/** The redo graph the run ended with -- after any role change. */
const finalGraph = (doc: TopologyDoc, p: Preset): RedoGraph => {
  const trace = simulate(doc, p.events());
  const last = trace.epochs[trace.epochs.length - 1];
  expect(last).toBeDefined();
  return (last as { redo: RedoGraph }).redo;
};

const activeEdge = (g: RedoGraph, from: string, to: string): boolean =>
  g.edges.some((e) => e.from === M(from) && e.to === M(to) && e.active && e.up);

const edge = (g: RedoGraph, from: string, to: string) =>
  g.edges.find((e) => e.from === M(from) && e.to === M(to));

/* ---------------- the registry ---------------- */

describe('the preset registry', () => {
  it('carries the eleven documents the workbench offers', () => {
    expect(PRESETS).toHaveLength(11);
    expect(PRESET_IDS).toEqual([
      'classic', 'observe-only', 'far-sync-zero-loss', 'far-sync-ha-pair',
      'far-sync-role-change', 'cascade-terminal', 'priority-alternates',
      'multi-target-three-observers', 'rac-primary', 'bystanders', 'max-protection',
    ]);
  });

  it('ids are unique and every lookup path agrees', () => {
    expect(new Set(PRESET_IDS).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(preset(p.id)).toBe(p);
      expect(findPreset(p.id as string)).toBe(p);
      expect(presetDoc(p.id).config.name).toBe(p.doc().config.name);
      expect(presetEvents(p.id)).toEqual(p.events());
    }
    expect(findPreset('no-such-preset')).toBeUndefined();
    expect(() => preset('no-such-preset' as Preset['id'])).toThrow(/unknown preset/);
  });

  it('hands out a fresh document every time: two callers never share one', () => {
    for (const p of PRESETS) {
      const a = p.doc();
      const b = p.doc();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
      a.members.length = 0;
      expect(p.doc().members.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------- the recorded validation output ---------------- */

/**
 * One finding as a line: severity, basis, rule id, subject.
 *
 * The message is deliberately not in the fingerprint. Messages are prose and
 * get reworded; what has to stay put is which rule fired, against what, at
 * what severity, and on whose authority -- a rule that quietly drops from
 * `documented` to `model` against a documented configuration is exactly the
 * regression this table exists to catch.
 */
const fingerprint = (f: Finding): string =>
  `${f.severity} ${f.basis} ${f.id}${f.subject.id ? ` ${f.subject.id as string}` : ''}`;

/** Sorted, so the record is about the set rather than about rule order. */
const fingerprints = (fs: readonly Finding[]): string[] => fs.map(fingerprint).sort();

/**
 * What every preset is expected to raise.
 *
 * Two notes are on all eleven, because both are true of every fast-start
 * failover configuration this workbench draws: the broker refuses the edits
 * ORA-16654 covers while fast-start failover is enabled, and ObserverOverride
 * is at its default of FALSE, which is a property of the model and says so.
 * Everything else is specific and is commented where it is not obvious.
 */
const EXPECTED_FINDINGS: Record<PresetId, string[]> = {
  classic: [
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET sby01',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'observe-only': [
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET sby01',
    /* The whole point of the preset: an observer that watches and does not act. */
    'info documented FSFO.OBSERVE_ONLY',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'far-sync-zero-loss': [
    /* One MaxFailure destination on the primary, so one deprecation notice and
       one note on what reaching the limit does. */
    'info documented DEST.DEPRECATED_19C North_Sales',
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET South_Sales',
    'info model DEST.MAXFAILURE_RESET_UNDOC North_Sales',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'far-sync-ha-pair': [
    /* Two far syncs, so both notes twice -- once per destination. The subject
       is the sending database, which is why the two lines look alike. */
    'info documented DEST.DEPRECATED_19C North_Sales',
    'info documented DEST.DEPRECATED_19C North_Sales',
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET South_Sales',
    'info model DEST.MAXFAILURE_RESET_UNDOC North_Sales',
    'info model DEST.MAXFAILURE_RESET_UNDOC North_Sales',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'far-sync-role-change': [
    /* Both directions are pre-declared and neither carries MaxFailure. */
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET South_Sales',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'cascade-terminal': [
    /* The terminal standby is two hops out and receives no redo directly, so
       it is not a candidate target and draws no note of its own. */
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET Local_Sales',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'priority-alternates': [
    /* Both destinations of the priority list carry MaxFailure. */
    'info documented DEST.DEPRECATED_19C North_Sales',
    'info documented DEST.DEPRECATED_19C North_Sales',
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET Local_Sales',
    'info model DEST.MAXFAILURE_RESET_UNDOC North_Sales',
    'info model DEST.MAXFAILURE_RESET_UNDOC North_Sales',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'multi-target-three-observers': [
    /* Two candidate targets, so ORA-16867 stands over both of them. */
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET sby01',
    'info documented EDIT.REMOVE_TARGET sby02',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  'rac-primary': [
    /* A second instance changes the failure, not the configuration. */
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET sby01',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),

  bystanders: [
    /* The two warnings are the preset's subject: under 26ai a logical and a
       snapshot standby may sit in a maximum availability configuration on
       ASYNC, which Table 4-2 flags without forbidding. */
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET sby01',
    'info model MODEL.OBSERVER_OVERRIDE',
    'warning documented XPT.TABLE_4_2 lsby01',
    'warning documented XPT.TABLE_4_2 snp01',
  ].sort(),

  'max-protection': [
    /* Two synchronous standbys, both named by the target property. */
    'info documented EDIT.FSFO_ENABLED_BLOCKS',
    'info documented EDIT.REMOVE_TARGET sby01',
    'info documented EDIT.REMOVE_TARGET sby02',
    'info model MODEL.OBSERVER_OVERRIDE',
  ].sort(),
};

describe('the recorded validation output', () => {
  it('records every preset, and only presets', () => {
    expect(Object.keys(EXPECTED_FINDINGS).sort()).toEqual([...PRESET_IDS].sort());
  });

  it('records no error against any preset', () => {
    for (const [id, lines] of Object.entries(EXPECTED_FINDINGS)) {
      for (const line of lines) expect(line.startsWith('error '), `${id}: ${line}`).toBe(false);
    }
  });

  it('names only rules the catalogue defines, at the severity it allows', () => {
    for (const [id, lines] of Object.entries(EXPECTED_FINDINGS)) {
      for (const line of lines) {
        const parts = line.split(' ');
        const severity = parts[0] as string;
        const basis = parts[1] as string;
        const rule = parts[2] as string;
        expect(RULE_IDS as readonly string[], `${id}: ${rule}`).toContain(rule);
        expect(allowedSeverities(rule as RuleId) as readonly string[], `${id}: ${rule}`)
          .toContain(severity);
        expect(allowedBases(rule as RuleId) as readonly string[], `${id}: ${rule}`)
          .toContain(basis);
      }
    }
  });

  it('leaves no rule of the catalogue unexercised without somewhere else to exercise it', () => {
    /* Not a coverage gate -- most rules only fire against a broken document,
       which is `validate/__tests__`' job. This asserts the opposite direction:
       the rules the presets do reach are the small documented set above. */
    const reached = new Set(
      Object.values(EXPECTED_FINDINGS).flat().map((l) => l.split(' ')[2] as string),
    );
    expect([...reached].sort()).toEqual([
      'DEST.DEPRECATED_19C', 'DEST.MAXFAILURE_RESET_UNDOC', 'EDIT.FSFO_ENABLED_BLOCKS',
      'EDIT.REMOVE_TARGET', 'FSFO.OBSERVE_ONLY', 'MODEL.OBSERVER_OVERRIDE', 'XPT.TABLE_4_2',
    ]);
  });
});

/* ---------------- what every preset must satisfy ---------------- */

describe.each(PRESETS.map((p) => [p.id, p] as const))('preset %s', (_id, p) => {
  const doc = p.doc();

  it('parses under the schema with nothing repaired', () => {
    const parsed = parseTopologyDoc(JSON.parse(JSON.stringify(doc)) as unknown);
    expect(parsed.issues).toEqual([]);
    expect(parsed.ok).toBe(true);
    /* A preset must survive the round trip a URL or a file puts it through. */
    expect(parsed.doc).toEqual(doc);
  });

  it('validates: no rule of the catalogue reports an error against it', () => {
    const findings = validate(doc);
    const errors = findings.filter((f) => f.severity === 'error');
    /* No preset demonstrates an error. A configuration a reader is invited to
       load and copy has to be one the broker would accept; the rules that do
       report errors are demonstrated in `validate/__tests__` against documents
       built to break, and on the mutated copies further down this file. */
    expect(errors.map((f) => `${f.id} ${f.subject.id ?? ''}: ${f.message}`)).toEqual([]);
    /* Every finding a preset does raise is well formed: a note wherever the
       basis is not documented, and citation ids that resolve. */
    for (const f of findings) {
      if (f.basis !== 'documented') expect(f.note ?? '', f.id).not.toBe('');
      for (const c of f.cite) expect(isCitationId(c), `${f.id} cites ${c}`).toBe(true);
    }
  });

  it('raises exactly the findings recorded for it, and nothing more', () => {
    expect(fingerprints(validate(doc))).toEqual(EXPECTED_FINDINGS[p.id]);
  });

  it('says the same thing about the document a URL round trip produced', () => {
    /* The preset the UI loads has been through the codec; the findings must
       not depend on which of the two objects the rules were handed. */
    const parsed = parseTopologyDoc(JSON.parse(JSON.stringify(doc)) as unknown);
    expect(parsed.doc).not.toBe(null);
    expect(fingerprints(validate(parsed.doc as TopologyDoc)))
      .toEqual(EXPECTED_FINDINGS[p.id]);
  });

  it('carries its default event set in the document', () => {
    expect(doc.events).toEqual(p.events());
  });

  it('has a title, a paragraph and citation ids that resolve', () => {
    expect(p.title.length).toBeGreaterThan(10);
    expect(p.summary.length).toBeGreaterThan(200);
    expect(p.cite.length).toBeGreaterThan(0);
    for (const id of p.cite) {
      expect(isCitationId(id)).toBe(true);
      const c = citation(id);
      expect(c.url).toMatch(/^https:\/\/docs\.oracle\.com\//);
      expect(c.quote.length).toBeGreaterThan(0);
    }
  });

  it('never repeats a wording the accuracy rules forbid', () => {
    /* "order", never "the first viable one in the list"; FILE IS, never FILE=. */
    expect(p.summary).not.toMatch(/FILE=/);
    expect(p.summary).not.toMatch(/GROUP=/);
    const viable = p.summary.indexOf('first viable');
    if (viable >= 0) expect(p.summary.slice(0, viable)).toMatch(/never /);
    /* The explicit "at least one synchronized standby" sentence is maximum
       availability's; any preset quoting it either is in that mode or names it. */
    if (/at least one synchronized/.test(p.summary)) {
      const inMode = doc.config.protectionMode === 'MAXAVAILABILITY';
      expect(inMode || /maximum availability/.test(p.summary)).toBe(true);
    }
  });

  it('has exactly one declared primary, and no far sync in a role it cannot hold', () => {
    const primary = declaredPrimary(doc);
    expect(primary).not.toBe(null);
    const primaries = doc.members.filter((m) => isDatabase(m) && m.role === 'primary');
    expect(primaries).toHaveLength(1);
    for (const t of doc.config.fsfo.target.kind === 'list' ? doc.config.fsfo.target.members : []) {
      const m = findMember(doc, t);
      expect(m, `target ${t as string} is a member`).toBeDefined();
      expect(isFarSync(m!)).toBe(false);
      expect(isDatabase(m!) && (m.role === 'physical' || m.role === 'logical')).toBe(true);
    }
  });

  it('keeps every observer off the database servers and clusters', () => {
    const dbHosts = new Set<string>();
    const dbClusters = new Set<string>();
    for (const m of doc.members) {
      for (const i of m.instances) {
        dbHosts.add(i.host as string);
        const h = doc.hosts.find((x) => x.id === i.host);
        if (h?.cluster) dbClusters.add(h.cluster);
      }
    }
    for (const o of doc.observers) {
      expect(dbHosts.has(o.host as string)).toBe(false);
      const h = doc.hosts.find((x) => x.id === o.host);
      expect(h, `observer host ${o.host as string} exists`).toBeDefined();
      if (h?.cluster) expect(dbClusters.has(h.cluster)).toBe(false);
      /* START OBSERVER ... FILE IS -- never FILE=. */
      expect(o.fileIs ?? '').not.toMatch(/FILE=/);
    }
  });

  it('resolves a redo graph in which every enabled member is accounted for', () => {
    const g = graphOf(doc);
    const ids = new Set(doc.members.map((m) => m.id as string));
    for (const e of g.edges) {
      expect(ids.has(e.from as string)).toBe(true);
      expect(ids.has(e.to as string)).toBe(true);
      expect(e.from).not.toBe(e.to);
    }
    for (const m of doc.members) expect(g.members[m.id]).toBeDefined();
    /* Every claim and finding that is not documented explains itself. */
    for (const f of [...g.findings, ...simulate(doc, p.events()).findings]) {
      if (f.basis !== 'documented') expect(f.note ?? '').not.toBe('');
      for (const c of f.cite) expect(isCitationId(c)).toBe(true);
    }
  });

  it('simulates deterministically', () => {
    const a = simulate(p.doc(), p.events());
    const b = simulate(p.doc(), p.events());
    expect(JSON.stringify(b.facts)).toBe(JSON.stringify(a.facts));
    expect(b.epochs.length).toBe(a.epochs.length);
  });
});

/* ---------------- steady-state protection level ---------------- */

/**
 * What the broker reports for each preset with nothing broken yet.
 *
 * The rule this table exists to hold: a configuration whose destinations are
 * all up reports the mode it was configured in. Under SYNC or FASTSYNC the
 * commit waits for the destination's acknowledgement, so a transport-lag input
 * -- the maximum performance TRANSPORT what-if -- never leaves a synchronous
 * destination unsynchronized, and maximum availability never opens the page
 * already degraded to maximum performance. A preset that deliberately shows a
 * degraded steady state would carry its own value here with the reason; none
 * does today, which is itself the assertion.
 */
const STEADY_LEVEL: Record<PresetId, string> = {
  classic: 'MAXAVAILABILITY',
  'observe-only': 'MAXAVAILABILITY',
  'far-sync-zero-loss': 'MAXAVAILABILITY',
  'far-sync-ha-pair': 'MAXAVAILABILITY',
  'far-sync-role-change': 'MAXAVAILABILITY',
  'cascade-terminal': 'MAXAVAILABILITY',
  'priority-alternates': 'MAXAVAILABILITY',
  'multi-target-three-observers': 'MAXAVAILABILITY',
  'rac-primary': 'MAXAVAILABILITY',
  bystanders: 'MAXAVAILABILITY',
  'max-protection': 'MAXPROTECTION',
};

describe('every preset opens at the protection level it was configured in', () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))('%s', (id, p) => {
    const doc = p.doc();
    const level = graphOf(doc).protectionLevel;
    expect(level.value).toBe(STEADY_LEVEL[id]);
    expect(level.value).toBe(doc.config.protectionMode);
    expect(level.basis).toBe('documented');
  });
});

/* ---------------- what each preset shows ---------------- */

describe('classic: primary, standby, observer at a third site', () => {
  const p = preset('classic');
  const doc = p.doc();
  const g = graphOf(doc);

  it('ships SYNC to the one standby, which is synchronized and acknowledges', () => {
    expect(g.edges).toHaveLength(1);
    expect(activeEdge(g, 'prm01', 'sby01')).toBe(true);
    expect(edge(g, 'prm01', 'sby01')?.xpt).toBe('SYNC');
    expect(g.members[M('sby01')]?.synchronized.value).toBe(true);
    expect(g.members[M('sby01')]?.countsTowardProtectionAck.value).toBe(true);
    expect(g.protectionLevel.value).toBe('MAXAVAILABILITY');
  });

  it('fails over one threshold after the primary host dies', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('failover');
    expect(t.facts.initiateAt).toBe(30);
    expect(t.facts.target).toBe(M('sby01'));
    expect(t.facts.newPrimary).toBe(M('sby01'));
    expect(t.facts.dataLossKind).toBe('none');
    const both = t.decisions.find((d) => d.id === 'FSFO.BOTH_MUST_HAVE_LOST');
    expect(both?.taken).toBe(true);
    /* Execution is environment-dependent, and the engine says so. */
    expect(t.decisions.some((d) => d.id === 'EXEC.ENV_DEPENDENT')).toBe(true);
  });
});

describe('observe-only: the observer that never fails over', () => {
  const p = preset('observe-only');
  const t = simulate(p.doc(), p.events());

  it('watches the primary die and promotes nobody', () => {
    expect(t.facts.outcome).toBe('manual');
    expect(t.facts.newPrimary).toBe(null);
    expect(t.facts.initiateAt).toBe(null);
    const d = t.decisions.find((x) => x.id === 'FSFO.OBSERVE_ONLY');
    expect(d?.taken).toBe(false);
    expect(d?.claim.basis).toBe('documented');
    expect(d?.claim.note ?? '').toContain('open without acknowledgement');
  });

  it('labels how far the documentation goes, and where the model takes over', () => {
    /* D7 documents the refusal, the primary opening without acknowledgement
       and the bystander allowance -- not what the rest of the machinery does.
       Reading observe-only as "arms nothing at all" is the engine's, so it is
       drawn as the engine's. */
    const d = t.decisions.find((x) => x.id === 'FSFO.OBSERVE_ONLY_SCOPE');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.note ?? '').toMatch(/no primary stall/);
    expect(d?.claim.note ?? '').toMatch(/no readiness gate/);
    expect(d?.claim.cite).toContain('OBS.OBSERVE_ONLY');
  });

  it('runs no stall clock and aborts nothing, whatever PmyShutdown says', () => {
    /* The primary is isolated from everything: with fast-start failover armed
       this is the stall that ends in SHUTDOWN ABORT at the threshold. In
       observe-only nothing arms, so nothing counts down. */
    const doc = p.doc();
    expect(doc.config.fsfo.pmyShutdown).toBe(true);
    const iso = simulate(doc, [
      { at: 0, kind: 'link.cut', link: 'dc1-dc2' as never },
      { at: 0, kind: 'link.cut', link: 'dc1-dc3' as never },
    ]);
    expect(iso.facts.abortAt).toBe(null);
    expect(iso.facts.conditions.stalled).toBe(false);
    expect(iso.facts.outcome).toBe('continues');
  });
});

describe('far sync, zero data loss over distance (Example 5-2)', () => {
  const p = preset('far-sync-zero-loss');
  const doc = p.doc();
  const g = graphOf(doc);

  it('is SYNC to the far sync and ASYNC onward to the target', () => {
    expect(edge(g, 'North_Sales', 'FS1')?.xpt).toBe('SYNC');
    expect(edge(g, 'FS1', 'South_Sales')?.xpt).toBe('ASYNC');
    expect(edge(g, 'North_Sales', 'FS1')?.role).toBe('primary-to-farsync');
    expect(edge(g, 'FS1', 'South_Sales')?.role).toBe('farsync-onward');
    expect(g.members[M('South_Sales')]?.depth).toBe(2);
    /* The far sync acknowledges; the terminal standby is not a direct SYNC ack. */
    expect(g.members[M('FS1')]?.countsTowardProtectionAck.value).toBe(true);
  });

  it('falls back to the alternate direct destination when the far sync dies', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('continues');
    const alt = t.findings.find((f) => f.id === 'ROUTES.ALT_ACTIVATION');
    expect(alt?.basis).toBe('model');
    expect(alt?.note).toMatch(/protection level is reduced/);
    const g2 = finalGraph(doc, p);
    expect(activeEdge(g2, 'North_Sales', 'South_Sales')).toBe(true);
    expect(edge(g2, 'North_Sales', 'South_Sales')?.xpt).toBe('ASYNC');
    /* Maximum availability without an acknowledgement from at least one
       synchronized standby operates as if it were in maximum performance. */
    expect(t.facts.protectionLevel.value).toBe('MAXPERFORMANCE');
  });
});

describe('a high-availability far sync pair (Example 5-4)', () => {
  const p = preset('far-sync-ha-pair');
  const doc = p.doc();
  const g = graphOf(doc);

  it('is one group, as Example 5-4 writes it, so the drawing is what the broker would do', () => {
    expect(formatRedoRoutes(member(doc, 'North_Sales').redoRoutes))
      .toBe('(LOCAL : (FS1 SYNC PRIORITY=1, FS2 SYNC PRIORITY=1, South_Sales ASYNC PRIORITY=2))');
  });

  it('ships to one far sync instance and stands the rest of the group down', () => {
    expect(activeEdge(g, 'North_Sales', 'FS1')).toBe(true);
    expect(edge(g, 'North_Sales', 'FS1')?.priority).toBe(1);
    expect(edge(g, 'North_Sales', 'FS2')?.active).toBe(false);
    expect(edge(g, 'North_Sales', 'FS2')?.inactiveReason).toBe('group-standby');
    expect(edge(g, 'North_Sales', 'South_Sales')?.inactiveReason).toBe('group-standby');
    /* Which destination ships is documented; the instant it moves is not. */
    expect(g.findings.find((x) => x.id === 'ROUTES.GROUP_SELECTION')?.basis).toBe('documented');
    const f = g.findings.find((x) => x.id === 'ROUTES.GROUP_SWITCH_INSTANT');
    expect(f?.basis).toBe('model');
    expect(f?.note ?? '').not.toBe('');
    expect(g.findings.some((x) => x.id === 'ROUTES.PRIORITY_ACTIVATION')).toBe(false);
  });

  it('keeps zero data loss when the first far sync host dies', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('continues');
    /* Still SYNC into a far sync instance, so the level does not degrade. */
    expect(t.facts.protectionLevel.value).toBe('MAXAVAILABILITY');
    const g2 = finalGraph(doc, p);
    expect(activeEdge(g2, 'North_Sales', 'FS2')).toBe(true);
    expect(edge(g2, 'North_Sales', 'FS2')?.xpt).toBe('SYNC');
  });
});

describe('a second far sync near the standby (Example 5-5)', () => {
  const p = preset('far-sync-role-change');
  const doc = p.doc();

  it('pre-declares both directions, and only the current one is active', () => {
    const g = graphOf(doc);
    expect(activeEdge(g, 'North_Sales', 'FS1')).toBe(true);
    expect(g.members[M('FS2')]?.reachableFromPrimary).toBe(false);
    /* SHOW CONFIGURATION WHEN PRIMARY IS South_Sales: the reverse rules. */
    const rev = resolveRedoGraph(doc, { primary: M('South_Sales') });
    expect(activeEdge(rev, 'South_Sales', 'FS2')).toBe(true);
    expect(edge(rev, 'South_Sales', 'FS2')?.xpt).toBe('SYNC');
    expect(activeEdge(rev, 'FS2', 'North_Sales')).toBe(true);
    expect(edge(rev, 'FS2', 'North_Sales')?.xpt).toBe('ASYNC');
  });

  it('switches over with zero data loss and no failover clock', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('switchover');
    expect(t.facts.newPrimary).toBe(M('South_Sales'));
    expect(t.facts.dataLossSeconds).toBe(0);
    expect(t.facts.initiateAt).toBe(null);
    expect(t.facts.abortAt).toBe(null);
    expect(t.facts.switchover?.blocked).toBe(false);
    /* The former primary is the database that restarts, as the new standby. */
    expect(t.facts.perMember[M('North_Sales')]?.endState).toBe('mounted-noapply');
    const g2 = finalGraph(doc, p);
    expect(g2.primary).toBe(M('South_Sales'));
    expect(activeEdge(g2, 'South_Sales', 'FS2')).toBe(true);
  });
});

describe('cascading to a remote terminal standby (Example 4-2)', () => {
  const p = preset('cascade-terminal');
  const doc = p.doc();
  const g = graphOf(doc);

  it('puts the terminal standby two hops out, ASYNC and unsynchronized', () => {
    expect(edge(g, 'North_Sales', 'Local_Sales')?.xpt).toBe('SYNC');
    expect(edge(g, 'Local_Sales', 'Remote_Sales')?.xpt).toBe('ASYNC');
    expect(edge(g, 'Local_Sales', 'Remote_Sales')?.role).toBe('cascade');
    expect(g.members[M('Remote_Sales')]?.depth).toBe(2);
    expect(g.members[M('Remote_Sales')]?.synchronized.value).toBe(false);
    expect(g.members[M('Remote_Sales')]?.countsTowardProtectionAck.value).toBe(false);
  });

  it('fails over to the member that receives redo directly', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('failover');
    expect(t.facts.target).toBe(M('Local_Sales'));
    expect(t.facts.initiateAt).toBe(30);
  });

  it('stops cascading after the role change, because nothing rewrites the rules', () => {
    const g2 = finalGraph(doc, p);
    expect(g2.primary).toBe(M('Local_Sales'));
    expect(activeEdge(g2, 'Local_Sales', 'Remote_Sales')).toBe(false);
    expect(g2.members[M('Remote_Sales')]?.reachableFromPrimary).toBe(false);
  });
});

describe('PRIORITY groups and the stood-down destination (Example 4-3)', () => {
  const p = preset('priority-alternates');
  const doc = p.doc();

  it('names only the destination that is receiving redo as a candidate target', () => {
    const target = doc.config.fsfo.target;
    expect(target.kind).toBe('list');
    expect(target.kind === 'list' && target.members).toEqual([M('Local_Sales')]);
    /* Naming the stood-down destination would fail the direct-redo
       prerequisite while its group is inactive -- the rule says so. */
    const doubled = p.doc();
    doubled.config.fsfo.target = {
      kind: 'list', members: [M('Local_Sales'), M('Alternate_Sales')],
    };
    const f = validate(doubled).find((x) => x.id === 'FSFO.TARGET_DIRECT_REDO');
    expect(f?.severity).toBe('error');
    expect(f?.basis).toBe('inferred');
  });

  it('is one group with a PRIORITY per destination, as 19c Example 4-3 writes it', () => {
    expect(formatRedoRoutes(member(doc, 'North_Sales').redoRoutes))
      .toBe('(LOCAL : (Local_Sales SYNC PRIORITY=1, Alternate_Sales SYNC PRIORITY=2))');
  });

  it('moves to the PRIORITY=2 destination when the first destination host dies', () => {
    const g = graphOf(doc);
    expect(edge(g, 'North_Sales', 'Alternate_Sales')?.inactiveReason)
      .toBe('group-standby');
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('continues');
    expect(t.facts.abortAt).toBe(null);
    const g2 = finalGraph(doc, p);
    expect(activeEdge(g2, 'North_Sales', 'Alternate_Sales')).toBe(true);
    /* A synchronized standby is still acknowledging, so the level holds. */
    expect(t.facts.protectionLevel.value).toBe('MAXAVAILABILITY');
  });
});

describe('two candidate targets, three observers', () => {
  const p = preset('multi-target-three-observers');
  const doc = p.doc();

  it('registers three observers, one of them master', () => {
    expect(doc.observers).toHaveLength(3);
    expect(doc.observers.filter((o) => o.role === 'master')).toHaveLength(1);
  });

  it('walks the candidate list in order and lands on the second one', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('failover');
    expect(t.facts.target).toBe(M('sby02'));
    expect(t.facts.initiateAt).toBe(30);
    /* execStart + the apply lag it still has to replay + the role change. */
    expect(t.facts.tOpen).toBeCloseTo(30.005 + 10 + 15, 6);
  });

  it('says the order is the model, and refuses the forbidden wording', () => {
    const t = simulate(doc, p.events());
    const d = t.decisions.find((x) => x.id === 'FSFO.TARGET_SELECTION');
    expect(d?.claim.basis).toBe('model');
    expect(d?.claim.note).toContain('order');
    expect(d?.claim.note).toContain('never "the first viable one in the list"');
  });

  it('stops at the first candidate under the active-target-only policy', () => {
    const only = simulate(doc, p.events(), { targetPolicy: 'active-target-only' });
    expect(only.facts.newPrimary).toBe(null);
  });
});

describe('a RAC primary losing one instance', () => {
  const p = preset('rac-primary');
  const doc = p.doc();

  it('is degraded, not down: no clock starts', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('continues');
    expect(t.facts.initiateAt).toBe(null);
    expect(t.facts.abortAt).toBe(null);
    expect(stateAt(t, 30).members[M('prm01')]).toBe('open-rw');
  });

  it('becomes the ordinary primary crash once both instances are gone', () => {
    const both = simulate(doc, [
      ...p.events(),
      { at: 5, kind: 'instance.down', member: M('prm01'), instance: 'prm012' },
    ]);
    expect(both.facts.outcome).toBe('failover');
    expect(both.facts.initiateAt).toBe(35);
  });
});

describe('snapshot and logical standbys as bystanders', () => {
  const p = preset('bystanders');
  const doc = p.doc();

  it('is drawn under 26ai, where an ASYNC maximum availability member is allowed', () => {
    expect(doc.config.edition).toBe('26ai');
    expect(doc.config.protectionMode).toBe('MAXAVAILABILITY');
    const warn = validate(doc).filter((f) => f.id === 'XPT.TABLE_4_2');
    expect(warn.every((f) => f.severity === 'warning')).toBe(true);
    expect(warn.map((f) => f.subject.id)).toEqual(['lsby01', 'snp01']);
  });

  it('leaves the snapshot standby out of the candidate list', () => {
    const target = doc.config.fsfo.target;
    expect(target.kind === 'list' && target.members).toEqual([M('sby01')]);
    const snap = findMember(doc, M('snp01'));
    expect(snap && isDatabase(snap) && snap.role).toBe('snapshot');
  });

  it('promotes the target and lets the bystanders follow', () => {
    const t = simulate(doc, p.events());
    expect(t.facts.outcome).toBe('failover');
    expect(t.facts.newPrimary).toBe(M('sby01'));
    expect(t.decisions.some((d) => d.id === 'BYSTANDERS.FOLLOW' && d.taken)).toBe(true);
    const g2 = finalGraph(doc, p);
    /* (LOCAL : ALL) at the new primary, and ALL excludes snapshot standbys. */
    expect(g2.members[M('lsby01')]?.reachableFromPrimary).toBe(true);
    expect(g2.members[M('snp01')]?.reachableFromPrimary).toBe(false);
  });
});

describe('maximum protection with two synchronous standbys', () => {
  const p = preset('max-protection');
  const doc = p.doc();

  it('takes SYNC from both standbys and runs at maximum protection', () => {
    const g = graphOf(doc);
    expect(g.protectionLevel.value).toBe('MAXPROTECTION');
    expect(edge(g, 'prm01', 'sby01')?.xpt).toBe('SYNC');
    expect(edge(g, 'prm01', 'sby02')?.xpt).toBe('SYNC');
    expect(g.members[M('sby01')]?.countsTowardProtectionAck.value).toBe(true);
    expect(g.members[M('sby02')]?.countsTowardProtectionAck.value).toBe(true);
  });

  it('survives the first standby and shuts down when the second one goes', () => {
    const t = simulate(doc, p.events());
    expect(stateAt(t, 30).members[M('prm01')]).toBe('open-rw');
    /* Last acknowledgement plus NET_TIMEOUT -- the instant is the model. */
    expect(t.facts.abortAt).toBe(70);
    expect(t.facts.abortReason).toBe('maxprotection');
    /* Its own outcome: nothing was unobserved, no threshold ran, and the
       instant is NET_TIMEOUT-derived, so this is never a stall. */
    expect(t.facts.outcome).toBe('maxprot-shutdown');
    expect(t.facts.netTimeoutSeconds).toBe(10);
    expect(t.facts.conditions.stalled).toBe(false);
    expect(t.facts.perMember[M('prm01')]?.endState).toBe('aborted');
    const f = t.findings.find((x) => x.id === 'PROT.MAXPROT_SHUTDOWN');
    expect(f?.basis).toBe('model');
    expect(f?.note ?? '').not.toBe('');
  });
});
