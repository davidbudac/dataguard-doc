/**
 * Mock DGMGRL SHOW output -- engine design SS7.
 *
 * These are drawings, not transcripts: every block opens with a generated
 * header saying it is rendered from this page's model, and every spelling that
 * the verified documentation does not carry -- the far sync line, the
 * observe-only wording, the per-target valid column -- wears a `(model)`
 * marker and a `model` basis next to it.
 *
 * What IS documented, and is reproduced faithfully: the cascade shown by
 * indentation with `(receiving current redo)` (Example 4-2), `(alternate of X)`
 * in VERBOSE output (Example 4-3), `SHOW CONFIGURATION WHEN PRIMARY IS name`,
 * and the Active Target / Potential Targets fields of SHOW FAST_START FAILOVER.
 */

import { assertCitesAllowed } from '../citations';
import type { CitationId } from '../citations';
import type { MemberId } from '../ids';
import { isParenthesised } from '../redo/parse';
import { defaultDestPriority, resolveRedoGraph } from '../redo/resolve';
import { lagLimitOf } from '../defaults';
import { isMultiInstanceApply } from '../sim/rac';
import { lagGated, pingPropertiesSet } from '../sim/fsfo';
import { docLater, documented, inferred, model } from '../types/claims';
import type { Member, TopologyDoc } from '../types/topology';
import { declaredPrimary, isDatabase, isFarSync, isRac } from '../types/topology';
import type { GeneratedFile, Line } from './lines';
import { blank, cmd, note } from './lines';

const LAG_LIMIT_MODE_CITES: CitationId[] = ['FSFO.LAGLIMIT_MAXAVAIL_26AI', 'MAXAVAIL.AT_LEAST_ONE'];
assertCitesAllowed('LAG_LIMIT_MODE', LAG_LIMIT_MODE_CITES);

/** The marker an unverified spelling wears, in the text as well as the basis. */
export const MODEL_MARK = '   (model)';

const HEADER =
  "rendered from this page's model of DGMGRL output -- not a transcript of a real broker configuration";
const HEADER_WHY =
  'The fields below are drawn from the document, and the layout follows the documented examples; the exact column widths and any line marked (model) were not verified against Oracle documentation.';

const headerLines = (): Line[] => [
  note(HEADER, model(HEADER, HEADER_WHY, ['DGMGRL.BROKER_COMMANDS'])),
  note('lines marked (model) use spellings the verified documentation does not carry',
    model('markers', HEADER_WHY, ['DGMGRL.BROKER_COMMANDS'])),
  blank(),
];

const nDoc = (text: string, cite: CitationId[]): Line => note(text, documented(text, cite));
const nModel = (text: string, why: string, cite: CitationId[] = []): Line =>
  note(text, model(text, why, cite));
const nInferred = (text: string, why: string, cite: CitationId[] = []): Line =>
  note(text, inferred(text, cite, why));

const MODE_WORD = {
  MAXPROTECTION: 'MaxProtection',
  MAXAVAILABILITY: 'MaxAvailability',
  MAXPERFORMANCE: 'MaxPerformance',
} as const;

/**
 * The broker default failover health conditions, in the order and with the
 * defaults SHOW FAST_START FAILOVER Example 2 prints them
 * (DGMGRL.SHOW_FSFO_CONDITIONS). The engine does not model
 * ENABLE/DISABLE FAST_START FAILOVER CONDITION, so the mock always shows
 * these defaults rather than a per-document configuration.
 */
const HEALTH_CONDITIONS: ReadonlyArray<readonly [string, boolean]> = [
  ['Corrupted Controlfile', true],
  ['Corrupted Dictionary', true],
  ['Inaccessible Logfile', false],
  ['Stuck Archiver', false],
  ['Datafile Write Errors', true],
];

/**
 * The `Fast-Start Failover:` status word -- GEN-09. Four documented
 * spellings (FSFO.STATUS_WORDS): `DISABLED`, `Enabled in Observe-Only Mode`,
 * and, once enabled, `Enabled in Zero Data Loss Mode` or `Enabled in
 * Potential Data Loss Mode` depending on whether the lag limit actually
 * gates the failover -- MaxProtection and MaxAvailability with no usable lag
 * limit are zero data loss; MaxPerformance, and 26ai MaxAvailability with a
 * non-zero lag limit, are potential data loss (`lagGated`, sim/fsfo.ts).
 */
function fsfoStatusWord(doc: TopologyDoc): { word: string; cite: CitationId[] } {
  const f = doc.config.fsfo;
  if (f.state === 'disabled') return { word: 'DISABLED', cite: ['FSFO.STATUS_WORDS'] };
  if (f.state === 'observe-only') {
    return { word: 'Enabled in Observe-Only Mode', cite: ['FSFO.STATUS_WORDS', 'FSFO.STATUS_OBSERVE_ONLY'] };
  }
  return lagGated(doc)
    ? { word: 'Enabled in Potential Data Loss Mode', cite: ['FSFO.STATUS_WORDS'] }
    : { word: 'Enabled in Zero Data Loss Mode', cite: ['FSFO.STATUS_WORDS'] };
}

/**
 * ED-06: the FS_FAILOVER_* columns of V$DATABASE are deprecated under 26ai in
 * favour of V$FAST_START_FAILOVER_CONFIG; 19c keeps the V$DATABASE name.
 */
function fsFailoverStatusView(doc: TopologyDoc): { view: string; cite: CitationId } {
  return doc.config.edition === '26ai'
    ? { view: 'V$FAST_START_FAILOVER_CONFIG', cite: 'FSFO.FS_FAILOVER_CONFIG_26AI' }
    : { view: 'V$DATABASE.FS_FAILOVER_STATUS', cite: 'FSFO.STATUS_DISABLED' };
}

/* ---------------- SHOW CONFIGURATION ---------------- */

/**
 * Where the run stands at the playhead (GEN-30): the blocks then print what
 * the broker would print at that moment -- the new primary as primary, the
 * former primary disabled and awaiting reinstatement after a failover, the
 * old target gone -- instead of the document's steady state.
 */
export interface ShowRun {
  /** The primary at the playhead (`epoch.primary`). */
  primary: MemberId;
  /** How the primary came to differ from the declared one, from the run's outcome. */
  roleChange: 'switchover' | 'failover' | null;
  /** Every member's state at the playhead, by member id. */
  states: Readonly<Record<string, string>>;
  /** Every observer's state at the playhead, by observer id (`stopped` is no longer observing). */
  observers?: Readonly<Record<string, string>>;
}

export interface ShowConfigurationOptions {
  verbose?: boolean;
  /**
   * `SHOW CONFIGURATION WHEN PRIMARY IS 'name'` -- the redo transport that
   * would be in effect with another primary. Members only: "it does not
   * provide status or any other configuration information" (GEN-18).
   */
  whenPrimaryIs?: MemberId;
  /** The run at the playhead; see `ShowRun`. */
  run?: ShowRun;
  /** SHOW DATABASE, read at a frame: the instance running apply per RAC standby. */
  applyInstances?: Readonly<Record<string, string>>;
  /** SHOW DATABASE, read at a frame: stopped instances as `member/instance`. */
  downInstances?: readonly string[];
  /**
   * SHOW CONFIGURATION, read at a frame: members the run draws open
   * read-write as a primary although `whenPrimaryIs` is another -- the old
   * primary a manual failover found still open.
   */
  openAsPrimary?: readonly string[];
}

/** What the blocks print the document through: who is primary and who is disabled. */
interface RunView {
  declared: MemberId | null;
  primary: MemberId | null;
  /** The run has moved the primary away from the declared one. */
  moved: boolean;
  /** Members printed `(disabled)` with ORA-16661: bystanders, and a failed primary awaiting reinstatement. */
  disabled: ReadonlySet<string>;
}

function runView(doc: TopologyDoc, opts: ShowConfigurationOptions): RunView {
  const declared = declaredPrimary(doc);
  const run = opts.run;
  const primary = run?.primary ?? opts.whenPrimaryIs ?? declared;
  const moved = run !== undefined && declared !== null && run.primary !== declared;
  const disabled = new Set<string>();
  if (run !== undefined) {
    for (const [id, state] of Object.entries(run.states)) {
      const m = doc.members.find((x) => (x.id as string) === id);
      if (state === 'disabled' && m !== undefined && isDatabase(m) && id !== (primary as string | null)) disabled.add(id);
    }
    /* "the former (failed) primary database was disabled by the broker as a
       consequence of the failover. It must be reinstated" -- until the run
       reinstates it (it then applies redo as a standby). */
    if (moved && run.roleChange === 'failover' && declared !== null) {
      const st = run.states[declared as string];
      if (st !== 'reinstating' && st !== 'mounted-apply' && st !== 'open-ro') disabled.add(declared as string);
    }
  }
  return { declared, primary, moved, disabled };
}

/**
 * The fast-start failover targets of `primary`, in order. The document holds
 * the declared primary's list. Once the run has moved the primary, its target
 * is the former primary: the property is set reciprocally when fast-start
 * failover is enabled, "the current primary ... as the target standby's future
 * target standby should it ever take over as a primary".
 */
function targetIdsOf(doc: TopologyDoc, v: RunView): MemberId[] {
  const t = doc.config.fsfo.target;
  if (v.moved && v.declared !== null) return doc.config.fsfo.state === 'disabled' ? [] : [v.declared];
  return t.kind === 'list'
    ? [...t.members]
    : doc.members.filter((m) => isDatabase(m) && m.id !== v.primary).map((m) => m.id);
}

function roleWord(m: Member, primary: MemberId): string {
  if (isFarSync(m)) return 'Far sync instance';
  if (m.id === primary) return 'Primary database';
  switch (m.role) {
    case 'logical': return 'Logical standby database';
    case 'snapshot': return 'Snapshot standby database';
    default: return 'Physical standby database';
  }
}

/**
 * Which members DGMGRL marks `(alternate of X)` in VERBOSE output.
 *
 * Two spellings reach the same place: the 12.1 `ALT=(...)` form names its
 * alternate outright, and in the PRIORITY form of 19c Example 4-3 --
 * `( Local_Sales ASYNC PRIORITY=1, Remote_Sales ASYNC PRIORITY=2 )` -- every
 * destination of a parenthesised group with a higher PRIORITY number than the
 * group's best is the alternate of the first destination at that best
 * priority, which is how that example's output reads. Destinations sharing the
 * best priority are not marked: what VERBOSE prints for them is not shown in
 * any example.
 */
function alternateOf(doc: TopologyDoc): Map<string, string> {
  const out = new Map<string, string>();
  const byId = new Map(doc.members.map((m) => [m.id as string, m] as const));
  const nameOfId = (id: MemberId): string => byId.get(id as string)?.name ?? String(id);
  for (const m of doc.members) {
    for (const r of m.redoRoutes) {
      for (const g of r.groups) {
        for (const d of g.dests) {
          if (d.alt && d.target !== 'ALL') out.set(d.alt.target as string, nameOfId(d.target));
        }
        if (!isParenthesised(g)) continue;
        const named = g.dests.flatMap((d) => {
          if (d.target === 'ALL') return [];
          const to = byId.get(d.target as string);
          return to ? [{ id: d.target, p: d.priority ?? defaultDestPriority(to) }] : [];
        });
        if (named.length < 2) continue;
        const best = Math.min(...named.map((x) => x.p));
        const first = named.find((x) => x.p === best) as { id: MemberId; p: number };
        for (const x of named) {
          if (x.p > best && !out.has(x.id as string)) out.set(x.id as string, nameOfId(first.id));
        }
      }
    }
  }
  return out;
}

export function showConfiguration(
  doc: TopologyDoc, opts: ShowConfigurationOptions = {},
): GeneratedFile {
  /* WHEN PRIMARY IS prints the members and nothing else, and takes no VERBOSE. */
  const hypothetical = opts.whenPrimaryIs !== undefined;
  const verbose = opts.verbose === true && !hypothetical;
  const v = runView(doc, opts);
  const primary = v.primary;
  const lines: Line[] = [...headerLines()];
  const nameById = (id: MemberId): string => doc.members.find((m) => m.id === id)?.name ?? String(id);

  const command = hypothetical
    ? `SHOW CONFIGURATION WHEN PRIMARY IS '${nameById(opts.whenPrimaryIs as MemberId)}';`
    : `SHOW CONFIGURATION${verbose ? ' VERBOSE' : ''};`;
  lines.push(cmd(`DGMGRL> ${command}`, {
    basis: 'documented',
    cite: hypothetical ? ['DGMGRL.FAR_SYNC_COMMANDS', 'DGMGRL.SHOW_WHEN_PRIMARY_IS'] : ['DGMGRL.BROKER_COMMANDS'],
  }));
  lines.push(blank());

  const file = (ls: Line[]): GeneratedFile => ({
    id: verbose ? 'show.configuration.verbose' : 'show.configuration',
    title: `SHOW CONFIGURATION${verbose ? ' VERBOSE' : ''}`,
    syntax: 'show',
    lines: ls,
    findings: [],
  });

  if (primary === null) {
    lines.push(nDoc('no primary database is declared, so there is no configuration to show',
      ['DGMGRL.BROKER_COMMANDS']));
    return file(lines);
  }

  const graph = resolveRedoGraph(doc, { primary });
  const alt = alternateOf(doc);
  const armed = doc.config.fsfo.state !== 'disabled';
  /* The current fast-start failover target is marked "name- (*) role" whenever
     fast-start failover is enabled (GEN-19: the plain example prints it too);
     VERBOSE alone adds the "(*) Fast-Start Failover target" legend under it
     (DGMGRL.SHOW_CONFIG_TARGET_ASTERISK, DGMGRL.VERBOSE_TARGET_MARKER). Only
     the active target -- the first of the list -- is marked. */
  const targets = targetIdsOf(doc, v);
  const activeTargetId = armed && !hypothetical ? targets[0] : undefined;
  /* Enabled with no observer started is legal and warns: "the ORA-16819
     warning is displayed for the primary and target standby databases". */
  const unobserved = armed && doc.observers.length === 0 && !hypothetical;
  const warned = new Set<string>(unobserved
    ? [primary as string, ...targets.map((t) => t as string)] : []);
  /* Every observer the document registers has stopped by the playhead while
     fast-start failover is enabled: the broker's ORA-16820, on the primary.
     Not the no-observer-deployed case above, which is ORA-16819. */
  const observerStates = Object.values(opts.run?.observers ?? {});
  const observerLost = armed && !hypothetical && doc.observers.length > 0
    && observerStates.length > 0 && observerStates.every((s) => s === 'stopped');

  lines.push(cmd(hypothetical
    ? `Configuration when ${nameById(primary)} is primary - ${doc.config.name}`
    : `Configuration - ${doc.config.name}`, { basis: 'documented', cite: hypothetical ? ['DGMGRL.SHOW_WHEN_PRIMARY_IS'] : ['DGMGRL.BROKER_COMMANDS'] }));
  lines.push(blank());
  if (!hypothetical) {
    lines.push(cmd(`Protection Mode: ${MODE_WORD[doc.config.protectionMode]}`, {
      indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_CONFIG_SUMMARY'],
    }));
  }
  lines.push(cmd('Members:', { indent: 2 }));

  /* Order: the primary, then everything it feeds, deepest last -- the
     indentation IS the cascade, exactly as Example 4-2 draws it. A member no
     active route reaches is not drawn here at all: it goes under "Members
     Not Receiving Redo:" instead (GEN-12, DGMGRL.MEMBERS_NOT_RECEIVING_REDO). */
  const reached = doc.members.filter((m) => {
    const d = graph.members[m.id]?.depth;
    return d !== undefined && d >= 0;
  });
  const unreached = doc.members.filter((m) => !reached.includes(m));
  const byDepth = [...reached].sort((a, b) => {
    const da = graph.members[a.id]?.depth ?? 0;
    const db = graph.members[b.id]?.depth ?? 0;
    if (da !== db) return da - db;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  const memberLine = (m: Member, depth: number): void => {
    const rm = graph.members[m.id];
    const markers: string[] = [];
    /* Example 4-2's terminal standby: a real-time cascade needs the ASYNC
       attribute spelled out, and DGMGRL says so on the member's own line. */
    if (depth >= 2 && rm?.effectiveXpt === 'ASYNC') markers.push('(receiving current redo)');
    if (verbose) {
      const of = alt.get(m.id as string);
      if (of !== undefined) markers.push(`(alternate of ${of})`);
    }
    const off = v.disabled.has(m.id as string) && m.id !== primary;
    /* A disabled bystander is not the current target. A former primary that
       fast-start failover left disabled and awaiting reinstatement is: the
       live 19.27 configuration kept the marker on it (`v.moved` is the only
       way a disabled member is the active target, see `targetIdsOf`). */
    const marked = m.id === activeTargetId && (!off || v.moved);
    const markedWhileOff = marked && off;
    const dash = marked ? '- (*)' : '-';
    if (off) markers.push('(disabled)');
    const text = `${m.name} ${dash} ${roleWord(m, primary)}${markers.length > 0 ? ` ${markers.join(' ')}` : ''}`;
    const indent = 2 + depth * 2;
    if (isFarSync(m)) {
      lines.push(cmd(text, {
        indent, basis: 'documented', cite: ['DGMGRL.FARSYNC_LINE_DOCUMENTED'],
      }));
    } else {
      const cite: CitationId[] = off
        ? ['FAILOVER.SHOW_CONFIGURATION_AFTER']
        : markers.some((x) => x.startsWith('(receiving'))
          ? ['CASCADE.EXAMPLE_4_2', 'ROUTES.CASCADE_ASYNC_EXPLICIT']
          : markers.length > 0 ? ['DGMGRL.VERBOSE_ALTERNATE', 'ROUTES.PRIORITY_19C_EX_4_3'] : ['DGMGRL.BROKER_COMMANDS'];
      if (marked) cite.push('DGMGRL.SHOW_CONFIG_TARGET_ASTERISK');
      lines.push(markedWhileOff
        ? cmd(text, {
          indent, basis: 'inferred', cite,
          note: 'Oracle\'s FAILOVER example prints the disabled former primary without the (*) marker, but fast-start failover was disabled there. With fast-start failover still enabled, the former primary is the target the broker sets reciprocally, and a live 19.27 configuration printed "cdb1 - (*) Physical standby database (disabled)" with ORA-16661 under it after both a manual failover and an observer-initiated failover (fact check 2026-10-01, D9). Observed on a live 19.27 configuration, not documentation.',
        })
        : cmd(text, { indent, basis: 'documented', cite }));
    }
    if (off) {
      lines.push(cmd('ORA-16661: the standby database needs to be reinstated', {
        indent: indent + 2, basis: 'documented', cite: ['FAILOVER.SHOW_CONFIGURATION_AFTER', 'ORA.16661'],
      }));
    }
    if (observerLost && m.id === primary) {
      lines.push(cmd('Error: ORA-16820: fast-start failover observer is no longer observing this database', {
        indent: indent + 2, basis: 'inferred', cite: ['ORA.16820', 'FAILOVER.SHOW_CONFIGURATION_AFTER'],
        note: 'ORA-16820\'s cause text is documented ("A previously started observer was no longer actively observing this database"). The "Error:" form under the primary, and the ERROR configuration status, are what a live 19.27 configuration printed after its only observer was stopped and stayed away about three minutes (fact check 2026-10-01, D9); an observation, not documentation. The page prints it from the moment the last observer has stopped, without the wait the live system needed.',
      }));
    }
    if (warned.has(m.id as string)) {
      lines.push(cmd('Warning: ORA-16819: fast-start failover observer not started', {
        indent: indent + 2, basis: 'inferred', cite: ['OBS.NOT_STARTED_16819', 'FAILOVER.SHOW_CONFIGURATION_AFTER'],
        note: "SHOW DATABASE prints ORA-16819 under 'Database Warning(s):' (OBS.NOT_STARTED_16819), for the primary and the target standby databases. SHOW CONFIGURATION prints a member's warning as 'Warning: ORA-nnnnn: ...' under its line, as its ORA-16629 example does; applying that form to ORA-16819 is this page's reading.",
      }));
    }
    if (opts.openAsPrimary?.includes(m.id as string) === true && m.id !== primary) {
      lines.push(nModel(
        `${m.name} is still open read-write as a primary in this run, so the line above is the configuration's view, not what the run draws`,
        'FAILOVER.FORMER_PRIMARY_OPEN: a manual failover found this database still open, Oracle puts its shutdown on the operator, and no page says the broker closes or mounts it, so this page draws it open beside the new primary. What SHOW CONFIGURATION prints for a primary in that state is not documented, so the line above is drawn from the configuration and this one says where the drawing differs.',
        ['FAILOVER.PRIMARY_SHUT_DOWN', 'FSFO.MANUAL_FAILOVER_CONDITIONS'],
      ));
    }
    if (marked && verbose) {
      lines.push(cmd('(*) Fast-Start Failover target', {
        indent, basis: 'documented', cite: ['DGMGRL.VERBOSE_TARGET_MARKER'],
      }));
    }
  };

  for (const m of byDepth) {
    const depth = graph.members[m.id]?.depth ?? 1;
    memberLine(m, depth);
  }
  if (unreached.length > 0) {
    lines.push(cmd('Members Not Receiving Redo:', {
      indent: 2, basis: 'documented', cite: ['DGMGRL.MEMBERS_NOT_RECEIVING_REDO'],
    }));
    for (const m of unreached) memberLine(m, 1);
  }

  if (hypothetical) {
    lines.push(blank());
    lines.push(nDoc(
      'the display lists all members but, unlike SHOW CONFIGURATION, no status or any other configuration information: the redo transport that would be in effect if this member were the primary',
      ['DGMGRL.SHOW_WHEN_PRIMARY_IS'],
    ));
    return file(lines);
  }

  lines.push(blank());
  const status = fsfoStatusWord(doc);
  lines.push(cmd(`Fast-Start Failover: ${status.word}`, { basis: 'documented', cite: status.cite }));
  if (unobserved) {
    lines.push(blank());
    lines.push(nDoc(
      'no observer is deployed although fast-start failover is enabled: that is legal -- the broker displays the ORA-16819 warning for the primary and the target standby databases, and fast-start failover cannot happen until an observer is started. It is enabled and unobserved, not DISABLED',
      ['OBS.NOT_STARTED_16819', 'OBS.CANNOT_OCCUR_LIST'],
    ));
  }
  if (v.moved && armed) {
    /* The words after a role change are the document's. Fast-start failover
       stays enabled after an observer-initiated failover (REINSTATE REQUIRED
       exists only after one has occurred); Oracle's FAILOVER example, which
       prints DISABLED, ran with fast-start failover disabled. */
    lines.push(blank());
    lines.push(opts.run?.roleChange === 'failover'
      ? nInferred(
        `the role has moved: the Fast-Start Failover line above is the document's setting, kept after the failover -- Oracle's FAILOVER example prints DISABLED because fast-start failover was disabled there`,
        'REINSTATE REQUIRED is documented as present only after fast-start failover has occurred, which implies it stays enabled. A live 19.27 configuration confirmed it (fact check 2026-10-01, D9): after both a manual failover with fast-start failover enabled and an observer-initiated failover, SHOW CONFIGURATION printed "Fast-Start Failover: Enabled in Zero Data Loss Mode" and the former primary as "- (*) Physical standby database (disabled)" with ORA-16661 under it. That is an observation, not documentation; Oracle\'s own FAILOVER example printed DISABLED and no marker because fast-start failover was disabled there. The cause of ORA-16661, a role change operation that made the database require reinstatement, is not specific to a manual failover.',
        ['FSFO.REINSTATE_REQUIRED_STATUS', 'FAILOVER.SHOW_CONFIGURATION_AFTER', 'ORA.16661'],
      )
      : nInferred(
        'the role has moved: the Fast-Start Failover line above is the document\'s setting; a switchover leaves fast-start failover armed, and the former primary, restarted as a standby, is the target',
        'No documented example shows SHOW CONFIGURATION after a switchover with fast-start failover enabled; the gate for a switchover is documented only by implication. A live 19.27 configuration (fact check 2026-10-01, D9) printed "Fast-Start Failover: Enabled in Zero Data Loss Mode" after a switchover and the former primary as "cdb1_stby - (*) Physical standby database". An observation, not documentation.',
        ['SWITCHOVER.FSFO_GATE'],
      ));
  }
  lines.push(blank());
  lines.push(cmd('Configuration Status:'));
  const reinstates = [...v.disabled].filter((id) => id !== (primary as string));
  if (observerLost) {
    lines.push(cmd('ERROR', {
      basis: 'inferred', cite: ['ORA.16820'],
      note: 'A live 19.27 configuration printed Configuration Status ERROR with ORA-16820 under the primary after its only observer was stopped, once the former primary had been reinstated (fact check 2026-10-01, D9). Observed, not documented. Whether ERROR outranks the reinstatement WARNING when both stand was not observed; the page lets the observer error take precedence.',
    }));
  } else if (reinstates.length > 0) {
    lines.push(cmd('WARNING', { basis: 'documented', cite: ['FAILOVER.SHOW_CONFIGURATION_AFTER'] }));
  } else if (unobserved) {
    lines.push(cmd('WARNING', {
      basis: 'inferred', cite: ['OBS.NOT_STARTED_16819', 'FAILOVER.SHOW_CONFIGURATION_AFTER'],
      note: "The ORA-16819 example shows Database Status WARNING for the primary; that the configuration status follows a member's warning is this page's reading of Oracle's FAILOVER example, where a disabled member makes the configuration WARNING.",
    }));
  } else {
    lines.push(cmd('SUCCESS'));
  }
  if (verbose) {
    lines.push(blank());
    lines.push(nModel(
      'VERBOSE also prints every member\'s properties; this mock draws only the members, the alternates and the status',
      'The property dump is real DGMGRL output that this page does not reproduce, so nothing here should be read as its layout.',
      ['DGMGRL.BROKER_COMMANDS'],
    ));
  }
  return file(lines);
}

/* ---------------- SHOW FAST_START FAILOVER ---------------- */

/**
 * A live 19.27 system (MaxAvailability, one target, one observer) prints
 * this, and the mock follows its spelling, order and lines under 19c:
 *
 *   Fast-Start Failover: Enabled in Zero Data Loss Mode
 *
 *     Protection Mode:    MaxAvailability
 *     Lag Limit:          30 seconds (not in use)
 *     Lag Type:           APPLY
 *
 *     Threshold:          30 seconds
 *     Active Target:      cdb1_stby
 *     Potential Targets:  "cdb1_stby"
 *       cdb1_stby  valid
 *     Observer:           dg_observer
 *     Shutdown Primary:   TRUE
 *     Auto-reinstate:     TRUE
 *     Observer Reconnect: (none)
 *     Observer Override:  FALSE
 *     Lag Grace Time:     0 seconds
 *
 *   Configurable Failover Conditions
 *     Health Conditions:
 *       Corrupted Controlfile          YES
 *       Corrupted Dictionary           YES
 *       Inaccessible Logfile            NO
 *       Stuck Archiver                  NO
 *       Datafile Write Errors          YES
 *
 *     Oracle Error Conditions:
 *       (none)
 *
 * Lag Type and Lag Grace Time are what the 19.27 system prints although the
 * 19c documentation's own example (DGMGRL.SHOW_FSFO_FIELDS) does not show
 * them -- marked doc-later, citing the 26ai property pages that do carry
 * them (FSFO.LAGTYPE, FSFO.LAGGRACETIME). 26ai follows its own chapter's
 * example instead (DGMGRL.SHOW_FSFO_FIELDS_26AI), which adds Ping Interval /
 * Ping Retry after Threshold and does not carry Lag Type or Lag Grace Time.
 */
export function showFastStartFailover(
  doc: TopologyDoc, opts: ShowConfigurationOptions = {},
): GeneratedFile {
  const lines: Line[] = [...headerLines()];
  const f = doc.config.fsfo;
  const v = runView(doc, opts);
  const v26 = doc.config.edition === '26ai';
  const fieldsCite: CitationId = v26 ? 'DGMGRL.SHOW_FSFO_FIELDS_26AI' : 'DGMGRL.SHOW_FSFO_FIELDS';
  lines.push(cmd('DGMGRL> SHOW FAST_START FAILOVER;', { basis: 'documented', cite: [fieldsCite] }));
  lines.push(blank());

  const status = fsfoStatusWord(doc);
  lines.push(cmd(`Fast-Start Failover: ${status.word}`, { basis: 'documented', cite: status.cite }));
  lines.push(blank());

  const pad = (label: string): string => `${label}:`.padEnd(22, ' ');
  lines.push(cmd(`${pad('Protection Mode')}${MODE_WORD[doc.config.protectionMode]}`, {
    indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_CONFIG_SUMMARY', fieldsCite],
  }));
  /* The limit in force -- the broker default for the edition and mode
     until the property is set. In use in maximum performance, and under
     26ai in maximum availability too, where 0 prints bare, as in the 26ai
     chapter's own example; everywhere else the live 19.27 spelling. */
  const limit = lagLimitOf(doc);
  const inUse = doc.config.protectionMode === 'MAXPERFORMANCE'
    || (v26 && doc.config.protectionMode === 'MAXAVAILABILITY');
  lines.push(cmd(`${pad('Lag Limit')}${limit} seconds${inUse ? '' : ' (not in use)'}`, {
    indent: 2, basis: 'documented', cite: [...LAG_LIMIT_MODE_CITES, fieldsCite],
  }));
  if (v26 && doc.config.protectionMode === 'MAXAVAILABILITY') {
    lines.push(nDoc(
      limit === 0
        ? 'zero means the standby must have received everything and the failover is zero data loss'
        : 'a non-zero limit makes maximum availability bounded-loss: failover is permitted while the lag is at or below the limit',
      LAG_LIMIT_MODE_CITES,
    ));
  }
  if (!v26) {
    lines.push(cmd(`${pad('Lag Type')}${f.lagType}`, {
      indent: 2, basis: 'doc-later', cite: ['FSFO.LAGTYPE'],
      note: 'Observed on a live 19.27 system; the 19c documentation\'s own SHOW FAST_START FAILOVER example does not carry this line, and the 19c properties reference does not list FastStartFailoverLagType at all -- documented only from 26ai.',
    }));
  }
  lines.push(blank());

  lines.push(cmd(`${pad('Threshold')}${f.thresholdSeconds} seconds`, {
    indent: 2, basis: 'documented', cite: ['FSFO.THRESHOLD'],
  }));
  if (v26 && pingPropertiesSet(doc)) {
    lines.push(cmd(`${pad('Ping Interval')}${f.pingIntervalMs} milliseconds`, {
      indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_FIELDS_26AI'],
    }));
    lines.push(cmd(`${pad('Ping Retry')}${f.pingRetry}`, {
      indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_FIELDS_26AI'],
    }));
  }

  const targets = targetIdsOf(doc, v);
  const nameOf = (id: MemberId): string => doc.members.find((m) => m.id === id)?.name ?? (id as string);
  const active = targets[0];
  lines.push(cmd(`${pad('Active Target')}${active === undefined ? '(none)' : nameOf(active)}`, {
    indent: 2, basis: 'documented', cite: [fieldsCite, 'FSFO.TARGET_ORDER'],
  }));
  if (targets.length > 0) {
    /* Potential Targets and the per-target valid flag print for a single
       target too (GEN-11) -- Example 2's own configuration has just one. */
    lines.push(cmd(`${pad('Potential Targets')}"${targets.map(nameOf).join(', ')}"`, {
      indent: 2, basis: 'documented', cite: [fieldsCite],
    }));
    /* The per-target valid flag is documented; the column heading is not. */
    for (const t of targets) {
      const m = doc.members.find((x) => x.id === t);
      const valid = m !== undefined && isDatabase(m) && (m.role === 'physical' || m.role === 'logical'
        || (v.moved && m.id === v.declared)) && !v.disabled.has(t as string);
      const awaiting = v.disabled.has(t as string);
      lines.push(cmd(`${`${nameOf(t)}:`.padEnd(20, ' ')}${valid ? 'valid' : 'invalid'}${awaiting ? ' - member is disabled' : ''}${MODEL_MARK}`, {
        indent: 4, basis: 'model', cite: [fieldsCite, 'FSFO.TARGET_KIND'],
        note: "A per-target valid flag is documented; the column heading and its spacing are this page's model, and the flag here reports only whether the member could be a target at all -- a physical or logical standby."
          + (awaiting ? ' The reason after \'invalid\' is what a live 19.27 configuration printed for the former primary after a failover ("invalid - member is disabled", fact check 2026-10-01, D9): an observation, not documentation.' : ''),
      }));
    }
    if (targets.length > 1) {
      lines.push(nDoc(
        'the broker selects a target based on the order in which they are specified',
        ['FSFO.TARGET_ORDER'],
      ));
    }
    if (v.moved) {
      lines.push(nDoc(
        `${v.primary === null ? 'the new primary' : nameOf(v.primary)} is the primary at this point in the run, so its target is the former primary ${v.declared === null ? '' : nameOf(v.declared)}: FastStartFailoverTarget was set reciprocally when fast-start failover was enabled, and the reinstated database acts as the fast-start failover target for the new primary`,
        ['FSFO.TARGET_RECIPROCAL_SHOWN', 'FSFO.REINSTATED_IS_TARGET'],
      ));
    }
  } else if (v.moved) {
    lines.push(nModel(
      `${v.primary === null ? 'the new primary' : nameOf(v.primary)} is the primary at this point in the run and fast-start failover is disabled, so no target is listed: the document's target is now the primary itself`,
      'With fast-start failover disabled the reciprocal FastStartFailoverTarget was never set, and the page lists no target rather than the old one.',
    ));
  }

  /* "If there is more than one registered observer running, then the output of
     this command shows all registered observers and indicates, with an
     asterisk, which one is the master observer." The page's two examples print
     one Observer: line and no asterisk, so the multi-observer layout is this
     page's (GEN-23). */
  if (doc.observers.length > 1) {
    const ordered = [...doc.observers].sort((a, b) => (a.role === b.role ? 0 : a.role === 'master' ? -1 : 1));
    ordered.forEach((o, i) => {
      const star = f.state !== 'disabled' && o.role === 'master' ? ' (*)' : '';
      lines.push(cmd(`${i === 0 ? pad('Observer') : ' '.repeat(22)}${o.name}${star}${i === 0 ? MODEL_MARK : ''}`, {
        indent: 2, basis: 'model', cite: ['DGMGRL.SHOW_FSFO_ALL_OBSERVERS', 'OBS.SHOW_OBSERVER_FIELDS'],
        note: "The documentation says the output shows all registered observers and marks the master with an asterisk; its examples show one 'Observer:' line and no asterisk, so one observer per line with '(*)' after the master is this page's layout.",
      }));
    });
  } else {
    const master = doc.observers.find((o) => o.role === 'master') ?? doc.observers[0];
    lines.push(cmd(`${pad('Observer')}${master === undefined ? '(none)' : master.name}`, {
      indent: 2, basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
    }));
  }
  lines.push(cmd(`${pad('Shutdown Primary')}${f.pmyShutdown ? 'TRUE' : 'FALSE'}`, {
    indent: 2, basis: 'documented', cite: ['FSFO.PMY_SHUTDOWN'],
  }));
  lines.push(cmd(`${pad('Auto-reinstate')}${f.autoReinstate ? 'TRUE' : 'FALSE'}`, {
    indent: 2, basis: 'documented', cite: ['FSFO.AUTO_REINSTATE'],
  }));
  /* Observer Reconnect prints for every configuration (GEN-11), not only
     when the document sets it away from its 0 / "(none)" default. */
  const reconnect = f.observerReconnectSeconds;
  lines.push(cmd(`${pad('Observer Reconnect')}${reconnect === undefined || reconnect === 0 ? '(none)' : `${reconnect} seconds`}`, {
    indent: 2, basis: 'documented', cite: [fieldsCite, 'OBS.OBSERVER_RECONNECT'],
  }));
  lines.push(cmd(`${pad('Observer Override')}FALSE`, {
    indent: 2, basis: 'documented', cite: ['FSFO.OBSERVER_OVERRIDE_FALSE'],
  }));
  lines.push(nDoc(
    'ObserverOverride is FALSE, the broker default, and this page models the default only: a failover needs both the observer and the target standby to have lost the primary',
    ['FSFO.OBSERVER_OVERRIDE_FALSE', 'FSFO.BOTH_MUST_HAVE_LOST'],
  ));
  if (!v26) {
    lines.push(cmd(`${pad('Lag Grace Time')}${f.lagGraceTimeSeconds} seconds`, {
      indent: 2, basis: 'doc-later', cite: ['FSFO.LAGGRACETIME'],
      note: 'Observed on a live 19.27 system; documented only from 26ai, where FastStartFailoverLagGraceTime applies in maximum performance mode.',
    }));
  }

  lines.push(blank());
  lines.push(cmd('Configurable Failover Conditions', { basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_CONDITIONS'] }));
  lines.push(cmd('Health Conditions:', { indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_CONDITIONS'] }));
  for (const [label, on] of HEALTH_CONDITIONS) {
    lines.push(cmd(`${label.padEnd(24, ' ')}${on ? 'YES' : 'NO'}`, {
      indent: 4, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_CONDITIONS'],
    }));
  }
  lines.push(blank());
  lines.push(cmd('Oracle Error Conditions:', { indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_CONDITIONS'] }));
  lines.push(cmd('(none)', { indent: 4, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_CONDITIONS'] }));
  lines.push(nModel(
    'these are the broker default failover health conditions; ENABLE/DISABLE FAST_START FAILOVER CONDITION is not modelled, so the mock always shows the defaults',
    'The document carries no per-condition data.',
    ['DGMGRL.SHOW_FSFO_CONDITIONS'],
  ));

  return {
    id: 'show.fast_start_failover',
    title: 'SHOW FAST_START FAILOVER',
    syntax: 'show',
    lines,
    findings: [],
  };
}

/* ---------------- SHOW OBSERVER ---------------- */

export function showObserver(doc: TopologyDoc, opts: ShowConfigurationOptions = {}): GeneratedFile {
  const lines: Line[] = [...headerLines()];
  const v = runView(doc, opts);
  lines.push(cmd('DGMGRL> SHOW OBSERVER;', {
    basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
  }));
  lines.push(blank());

  if (doc.observers.length === 0) {
    const view = fsFailoverStatusView(doc);
    lines.push(nDoc(
      doc.config.fsfo.state === 'disabled'
        ? `no observer is deployed: that is not the same as unobserved -- with fast-start failover never enabled ${view.view} reads DISABLED, and a manual FAILOVER TO is the only thing that promotes a standby`
        : 'no observer is deployed although fast-start failover is enabled: the broker displays the ORA-16819 warning for the primary and the target standby databases, and fast-start failover cannot happen until an observer is started',
      doc.config.fsfo.state === 'disabled'
        ? [view.cite, 'FSFO.MANUAL_FAILOVER_CONDITIONS']
        : ['OBS.NOT_STARTED_16819', 'OBS.CANNOT_OCCUR_LIST'],
    ));
    return { id: 'show.observer', title: 'SHOW OBSERVER', syntax: 'show', lines, findings: [] };
  }

  const armed = doc.config.fsfo.state !== 'disabled';
  const ordered = [...doc.observers].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'master' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  /* The example output in the 19c broker commands reference opens with a
     three-line header before the per-observer list -- "Configuration - ...",
     "Primary: ...", "Active Target Standby: ..." -- which OBS.SHOW_OBSERVER_FIELDS'
     own prose sentence never mentions, and this mock dropped along with it. */
  const primaryId = v.primary;
  const primaryMember = doc.members.find((m) => m.id === primaryId);
  const activeTargetId = armed ? targetIdsOf(doc, v)[0] : undefined;
  const targetMember = doc.members.find((m) => m.id === activeTargetId)
    ?? doc.members.find((m) => isDatabase(m) && (m.role === 'physical' || m.role === 'logical'));
  lines.push(cmd(`Configuration - ${doc.config.name}`, {
    basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
    note: 'The 19c broker commands reference’s own SHOW OBSERVER example opens with this header, ahead of the per-observer list.',
  }));
  lines.push(cmd(`Primary: ${primaryMember?.name ?? '(none)'}`, {
    basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
  }));
  lines.push(cmd(`Active Target Standby: ${targetMember?.name ?? '(none)'}`, {
    basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
  }));
  lines.push(blank());

  for (const o of ordered) {
    const roleSuffix = armed ? ` - ${o.role === 'master' ? 'Master' : 'Backup'}` : '';
    lines.push(cmd(`Observer "${o.name}"${roleSuffix}`, {
      basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'], note: 'Observers are named and marked master or backup, as in the 19c broker commands reference example.',
    }));
    const host = doc.hosts.find((h) => h.id === o.host);
    lines.push(cmd(`Host Name:            ${host?.name ?? (o.host as string)}`, {
      indent: 2, basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
    }));
    for (const label of ['Last Ping to Primary', 'Last Ping to Target']) {
      lines.push(cmd(`${`${label}:`.padEnd(22, ' ')}(not modelled)${MODEL_MARK}`, {
        indent: 2, basis: 'model', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
        note: 'The engine reads no clock, so no ping age is drawn; the field itself is documented in the 19c broker commands reference.',
      }));
    }
    if (!o.running) {
      lines.push(nDoc(
        `${o.name} is stopped in this document; while the master observer is not running fast-start failover cannot occur`,
        ['OBS.CANNOT_OCCUR_LIST'],
      ));
    }
    lines.push(blank());
  }

  if (!armed) {
    lines.push(note(
      'when fast-start failover is disabled, no observer is called the master observer; all observers have the same functionality',
      docLater(
        'no master while disabled',
        ['OBS.NO_MASTER_WHEN_DISABLED'],
        'Stated in an edition later than 19c.',
      ),
    ));
  } else {
    lines.push(nDoc(
      'only the master observer can coordinate fast-start failover',
      ['OBS.MASTER_ONLY_COORDINATES'],
    ));
  }

  /* Named the same way the 26ai conflict just below is: 19c disagrees with
     itself too, and this page must not paper over either one by picking a
     single citation. The fast-start failover chapter and ORA-16647's own 19c
     tab both say three; the command reference's own START OBSERVER usage
     notes say four. */
  const limit = doc.config.edition === '19c'
    ? 'the 19c fast-start failover chapter and ORA-16647 say up to three observers, while the 19c command reference’s START OBSERVER usage notes say four'
    : 'the 26ai fast-start failover chapter says four observers, while the 26ai SHOW OBSERVER page still says three';
  lines.push(note(limit, doc.config.edition === '19c'
    ? {
      value: limit,
      basis: 'conflict',
      cite: ['OBS.THREE_19C', 'OBS.FOUR_CMD19', 'ORA.16647'],
      note: '19c disagrees with itself, the same way 26ai does below: the switchover/failover chapter and ORA-16647’s 19c tab both say three, the command reference’s own START OBSERVER page says four.',
    }
    : {
      value: limit,
      basis: 'conflict',
      cite: ['OBS.FOUR_26AI', 'OBS.THREE_26AI_SHOW'],
      note: '26ai disagrees with itself; the "three" is 19c-specific and must not be carried across editions.',
    }));

  return { id: 'show.observer', title: 'SHOW OBSERVER', syntax: 'show', lines, findings: [] };
}

/* ---------------- SHOW DATABASE, for a RAC member ---------------- */

const DB_ROLE_WORD = {
  primary: 'PRIMARY', physical: 'PHYSICAL STANDBY', logical: 'LOGICAL STANDBY', snapshot: 'SNAPSHOT STANDBY',
} as const;

/**
 * `SHOW DATABASE` for a database with more than one instance: the field that
 * matters here is `Instance(s):`, which marks the one running apply on a RAC
 * standby `(apply instance)` -- the documented example (facts.md F9).
 */
export function showDatabase(
  doc: TopologyDoc, member: MemberId, opts: ShowConfigurationOptions = {},
): GeneratedFile | null {
  const m = doc.members.find((x) => x.id === member);
  if (!m || !isDatabase(m) || !isRac(m)) return null;
  const v = runView(doc, opts);
  const primary = v.primary;
  const role = m.id === primary ? 'primary' : m.role === 'primary' ? 'physical' : m.role;
  const off = v.disabled.has(m.id as string) && m.id !== primary;
  const lines: Line[] = [...headerLines()];
  const show: CitationId[] = ['RAC.SHOW_DATABASE_INSTANCES'];
  lines.push(cmd(`DGMGRL> SHOW DATABASE '${m.name}';`, { basis: 'documented', cite: ['DGMGRL.SHOW_DATABASE'] }));
  lines.push(blank());
  lines.push(cmd(`Database - ${m.name}`, { basis: 'documented', cite: show }));
  lines.push(blank());
  lines.push(cmd(`Role:               ${DB_ROLE_WORD[role]}`, { indent: 2, basis: 'documented', cite: show }));
  const state = role === 'primary' ? 'TRANSPORT-ON'
    : role === 'snapshot' ? 'APPLY-OFF'
      : m.applyRunning ? 'APPLY-ON' : 'APPLY-OFF';
  lines.push(cmd(`Intended State:     ${state}`, {
    indent: 2, basis: 'documented',
    cite: role === 'primary' ? ['RAC.TRANSPORT_ALL_INSTANCES'] : ['RAC.APPLY_INSTANCE'],
  }));
  /* A standby prints its lags between Intended State and Instance(s)
     (GEN-24, SHOW DATABASE Example 1); a primary prints none. */
  if (role !== 'primary') {
    const lag = (n: number): string => (off ? '(unknown)' : `${n} seconds`);
    lines.push(cmd(`Transport Lag:      ${lag(m.transportLagSeconds)}`, {
      indent: 2, basis: 'documented', cite: off ? ['FAILOVER.FORMER_PRIMARY_DISABLED'] : ['DGMGRL.SHOW_DATABASE_ABBREVIATED'],
    }));
    lines.push(cmd(`Apply Lag:          ${lag(m.applyLagSeconds)}`, {
      indent: 2, basis: 'documented', cite: off ? ['FAILOVER.FORMER_PRIMARY_DISABLED'] : ['DGMGRL.SHOW_DATABASE_ABBREVIATED'],
    }));
  }
  lines.push(cmd('Instance(s):', { indent: 2, basis: 'documented', cite: show }));
  const apply = opts.applyInstances?.[m.id as string];
  const stopped = new Set(opts.downInstances ?? []);
  for (const i of m.instances) {
    const isApply = role !== 'primary' && role !== 'snapshot' && apply === i.name;
    const down = stopped.has(`${m.id as string}/${i.name}`);
    lines.push(cmd(`${i.name.padEnd(14, ' ')}${isApply ? ' (apply instance)' : ''}${down ? `  (not running)${MODEL_MARK}` : ''}`, down
      ? {
        indent: 4, basis: 'model', cite: show,
        note: 'How SHOW DATABASE spells an instance that has stopped was not found in the documentation that was verified; this marker is the page\'s own.',
      }
      : { indent: 4, basis: 'documented', cite: show }));
  }
  lines.push(cmd('Database Status:', { basis: 'documented', cite: ['DGMGRL.SHOW_DATABASE_ABBREVIATED'] }));
  if (off) {
    lines.push(cmd('ORA-16661: the standby database needs to be reinstated', {
      basis: 'documented', cite: ['FAILOVER.FORMER_PRIMARY_DISABLED', 'ORA.16661'],
    }));
  } else if (stopped.size > 0 && [...stopped].some((k) => k.startsWith(`${m.id as string}/`))) {
    lines.push(cmd('WARNING', {
      basis: 'model', cite: show,
      note: 'A stopped instance makes the database status a warning in this mock; which ORA- error the broker lists for it was not verified.',
    }));
  } else {
    lines.push(cmd('SUCCESS', { basis: 'documented', cite: ['DGMGRL.SHOW_DATABASE_ABBREVIATED'] }));
  }
  lines.push(nModel(
    'the broker also prints Apply Rate and Real Time Query between the lags and Instance(s): this mock draws neither, and the "(computed n seconds ago)" after each lag is left off because the page reads no clock',
    'Those fields are real SHOW DATABASE output that the document has no data for.',
    ['DGMGRL.SHOW_DATABASE_ABBREVIATED'],
  ));
  lines.push(blank());
  if (role === 'primary') {
    lines.push(nDoc(
      'every instance open read-write runs redo transport, and the primary stays available while at least one of them still ships redo',
      ['RAC.TRANSPORT_ALL_INSTANCES', 'RAC.PRIMARY_AVAILABLE'],
    ));
  } else if (role !== 'snapshot') {
    const several = isMultiInstanceApply(m);
    lines.push(nDoc(
      apply === undefined
        ? 'no instance is applying at this point: the apply instance failed and the broker has not moved apply yet, or none is running'
        : several
          ? 'with ApplyInstances above 1 Redo Apply can run on all instances at the same time, but only one of them is the apply coordinator, and that is the instance the broker considers the apply instance; if it fails the broker restarts the coordinator on another running instance'
          : 'apply runs on one instance, the apply instance; if it fails the broker restarts apply on another running instance',
      several ? ['RAC.MULTI_INSTANCE_APPLY', 'RAC.APPLY_INSTANCE_FAILOVER'] : ['RAC.APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_FAILOVER'],
    ));
  }
  return {
    id: `show.database.${m.id as string}`, title: `SHOW DATABASE ${m.name}`, syntax: 'show', lines, findings: [],
  };
}

/* ---------------- all of them ---------------- */

/**
 * The three configuration-wide blocks, then one SHOW DATABASE per RAC
 * database -- appended, so a configuration without RAC reads as it always did.
 */
export function generateShowMocks(
  doc: TopologyDoc, opts: ShowConfigurationOptions = {},
): GeneratedFile[] {
  const rac = doc.members
    .map((m) => showDatabase(doc, m.id, opts))
    .filter((f): f is GeneratedFile => f !== null);
  return [showConfiguration(doc, opts), showFastStartFailover(doc, opts), showObserver(doc, opts), ...rac];
}
