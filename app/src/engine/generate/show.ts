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
import { resolveRedoGraph } from '../redo/resolve';
import { lagGated } from '../sim/fsfo';
import { docLater, documented, model } from '../types/claims';
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

const MODE_WORD = {
  MAXPROTECTION: 'MaxProtection',
  MAXAVAILABILITY: 'MaxAvailability',
  MAXPERFORMANCE: 'MaxPerformance',
} as const;

/* ---------------- SHOW CONFIGURATION ---------------- */

export interface ShowConfigurationOptions {
  verbose?: boolean;
  /** `SHOW CONFIGURATION WHEN PRIMARY IS name` -- resolve with another primary. */
  whenPrimaryIs?: MemberId;
  /** SHOW DATABASE, read at a frame: the instance running apply per RAC standby. */
  applyInstances?: Readonly<Record<string, string>>;
  /** SHOW DATABASE, read at a frame: stopped instances as `member/instance`. */
  downInstances?: readonly string[];
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
 * alternate outright, and the PRIORITY form of Example 4-3 makes every
 * destination in a higher-numbered priority group the alternate of the group
 * the broker is using -- which is how that example's output reads.
 */
function alternateOf(doc: TopologyDoc): Map<string, string> {
  const out = new Map<string, string>();
  const nameOfId = (id: MemberId): string => doc.members.find((m) => m.id === id)?.name ?? String(id);
  for (const m of doc.members) {
    for (const r of m.redoRoutes) {
      for (const g of r.groups) {
        for (const d of g.dests) {
          if (d.alt && d.target !== 'ALL') out.set(d.alt.target as string, nameOfId(d.target));
        }
      }
      if (r.groups.length < 2) continue;
      const priorities = r.groups.map((g, i) => ({ i, p: g.priority ?? 8 }));
      const best = priorities.reduce((a, b) => (b.p < a.p ? b : a));
      const primaryGroup = r.groups[best.i];
      const first = primaryGroup?.dests.find((d) => d.target !== 'ALL')?.target;
      if (first === undefined || first === 'ALL') continue;
      for (const { i } of priorities) {
        if (i === best.i) continue;
        for (const d of r.groups[i]?.dests ?? []) {
          if (d.target !== 'ALL' && !out.has(d.target as string)) {
            out.set(d.target as string, nameOfId(first));
          }
        }
      }
    }
  }
  return out;
}

export function showConfiguration(
  doc: TopologyDoc, opts: ShowConfigurationOptions = {},
): GeneratedFile {
  const verbose = opts.verbose === true;
  const declared = declaredPrimary(doc);
  const primary = opts.whenPrimaryIs ?? declared;
  const lines: Line[] = [...headerLines()];

  const command = `SHOW CONFIGURATION${verbose ? ' VERBOSE' : ''}${
    opts.whenPrimaryIs !== undefined
      ? ` WHEN PRIMARY IS ${doc.members.find((m) => m.id === opts.whenPrimaryIs)?.name ?? String(opts.whenPrimaryIs)}`
      : ''};`;
  lines.push(cmd(`DGMGRL> ${command}`, {
    basis: 'documented',
    cite: opts.whenPrimaryIs !== undefined ? ['DGMGRL.FAR_SYNC_COMMANDS'] : ['DGMGRL.BROKER_COMMANDS'],
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

  lines.push(cmd(`Configuration - ${doc.config.name}`, { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'] }));
  lines.push(blank());
  lines.push(cmd(`Protection Mode: ${MODE_WORD[doc.config.protectionMode]}`, {
    indent: 2, basis: 'documented', cite: ['XPT.TABLE_4_2'],
  }));
  lines.push(cmd('Members:', { indent: 2 }));

  /* Order: the primary, then everything it feeds, deepest last -- the
     indentation IS the cascade, exactly as Example 4-2 draws it. */
  const sortDepth = (id: MemberId): number => {
    const d = graph.members[id]?.depth;
    /* A member no active route reaches is drawn under the primary, after the
       ones that are: the broker lists it, the cascade drawing just cannot
       place it. */
    return d === undefined || d < 0 ? 99 : d;
  };
  const ordered = [...doc.members].sort((a, b) => {
    const da = sortDepth(a.id);
    const db = sortDepth(b.id);
    if (da !== db) return da - db;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  for (const m of ordered) {
    const rm = graph.members[m.id];
    const depth = rm && rm.depth >= 0 ? rm.depth : 1;
    const markers: string[] = [];
    /* Example 4-2's terminal standby: a real-time cascade needs the ASYNC
       attribute spelled out, and DGMGRL says so on the member's own line. */
    if (depth >= 2 && rm?.effectiveXpt === 'ASYNC') markers.push('(receiving current redo)');
    if (verbose) {
      const of = alt.get(m.id as string);
      if (of !== undefined) markers.push(`(alternate of ${of})`);
    }
    const text = `${m.name} - ${roleWord(m, primary)}${markers.length > 0 ? ` ${markers.join(' ')}` : ''}`;
    if (isFarSync(m)) {
      lines.push(cmd(`${text}${MODEL_MARK}`, {
        indent: 2 + depth * 2,
        basis: 'model',
        cite: ['FS.NO_BROKER_STATE', 'DGMGRL.FAR_SYNC_COMMANDS'],
        note: "How SHOW CONFIGURATION spells a far sync instance line was not found in the documentation that was verified: the wording here, and the absence of a state column, are this page's model.",
      }));
    } else {
      const cite: CitationId[] = markers.some((x) => x.startsWith('(receiving'))
        ? ['CASCADE.EXAMPLE_4_2', 'ROUTES.CASCADE_ASYNC_EXPLICIT']
        : markers.length > 0 ? ['DGMGRL.VERBOSE_ALTERNATE', 'ROUTES.PRIORITY_19C_EX_4_3'] : ['DGMGRL.BROKER_COMMANDS'];
      lines.push(cmd(text, { indent: 2 + depth * 2, basis: 'documented', cite }));
    }
  }

  lines.push(blank());
  const fsfoWord = doc.config.fsfo.state === 'enabled'
    ? 'Enabled'
    : doc.config.fsfo.state === 'observe-only' ? 'Enabled in Observe-Only Mode' : 'Disabled';
  if (doc.config.fsfo.state === 'observe-only') {
    lines.push(cmd(`Fast-Start Failover:  ${fsfoWord}${MODEL_MARK}`, {
      basis: 'model', cite: ['OBS.OBSERVE_ONLY'],
      note: "ENABLE FAST_START FAILOVER OBSERVE ONLY is documented; how SHOW CONFIGURATION spells the resulting state was not verified, so this wording is this page's model.",
    }));
  } else {
    lines.push(cmd(`Fast-Start Failover:  ${fsfoWord}`, {
      basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'],
    }));
  }
  if (doc.config.fsfo.state !== 'disabled' && doc.observers.length === 0) {
    lines.push(blank());
    lines.push(nDoc(
      'no observer is deployed in this document although fast-start failover is marked enabled: this page reads that as fast-start failover never armed -- V$DATABASE.FS_FAILOVER_STATUS reads DISABLED -- which is not the same as unobserved. Unobserved is an enabled configuration whose master observer is missing: ORA-16820 is the standing health condition and the target standby is where FS_FAILOVER_STATUS reads PRIMARY UNOBSERVED',
      ['FSFO.STATUS_DISABLED', 'ORA.16820', 'FSFO.PRIMARY_UNOBSERVED'],
    ));
  }
  lines.push(blank());
  lines.push(cmd('Configuration Status:'));
  lines.push(cmd('SUCCESS'));
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

export function showFastStartFailover(doc: TopologyDoc): GeneratedFile {
  const lines: Line[] = [...headerLines()];
  const f = doc.config.fsfo;
  const primary = declaredPrimary(doc);
  lines.push(cmd('DGMGRL> SHOW FAST_START FAILOVER;', {
    basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_FIELDS'],
  }));
  lines.push(blank());

  const state = f.state === 'enabled' ? 'ENABLED' : f.state === 'observe-only' ? 'ENABLED IN OBSERVE-ONLY MODE' : 'DISABLED';
  if (f.state === 'observe-only') {
    lines.push(cmd(`Fast-Start Failover: ${state}${MODEL_MARK}`, {
      basis: 'model', cite: ['OBS.OBSERVE_ONLY'],
      note: 'The observe-only spelling of this line was not verified; the mode itself is documented.',
    }));
  } else {
    lines.push(cmd(`Fast-Start Failover: ${state}`, {
      basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_FIELDS'],
    }));
  }
  lines.push(blank());

  const pad = (label: string): string => `${label}:`.padEnd(22, ' ');
  lines.push(cmd(`${pad('Threshold')}${f.thresholdSeconds} seconds`, {
    indent: 2, basis: 'documented', cite: ['FSFO.THRESHOLD'],
  }));

  const targets = f.target.kind === 'list'
    ? f.target.members
    : doc.members.filter((m) => isDatabase(m) && m.id !== primary).map((m) => m.id);
  const nameOf = (id: MemberId): string => doc.members.find((m) => m.id === id)?.name ?? (id as string);
  const active = targets[0];
  lines.push(cmd(`${pad('Active Target')}${active === undefined ? '(none)' : nameOf(active)}`, {
    indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_FIELDS', 'FSFO.TARGET_ORDER'],
  }));
  if (targets.length > 1) {
    lines.push(cmd(`${pad('Potential Targets')}"${targets.map(nameOf).join(',')}"`, {
      indent: 2, basis: 'documented', cite: ['DGMGRL.SHOW_FSFO_FIELDS'],
    }));
    /* The per-target valid flag is documented; the column heading is not. */
    for (const t of targets) {
      const m = doc.members.find((x) => x.id === t);
      const valid = m !== undefined && isDatabase(m) && (m.role === 'physical' || m.role === 'logical');
      lines.push(cmd(`${`${nameOf(t)}:`.padEnd(20, ' ')}${valid ? 'valid' : 'invalid'}${MODEL_MARK}`, {
        indent: 4, basis: 'model', cite: ['DGMGRL.SHOW_FSFO_FIELDS', 'FSFO.TARGET_KIND'],
        note: "A per-target valid flag is documented; the column heading and its spacing are this page's model, and the flag here reports only whether the member could be a target at all -- a physical or logical standby.",
      }));
    }
    lines.push(nDoc(
      'the broker selects a target based on the order in which they are specified',
      ['FSFO.TARGET_ORDER'],
    ));
  }

  const master = doc.observers.find((o) => o.role === 'master') ?? doc.observers[0];
  lines.push(cmd(`${pad('Observer')}${master === undefined ? '(none)' : master.name}`, {
    indent: 2, basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
  }));

  const gated = lagGated(doc);
  lines.push(cmd(`${pad('Lag Limit')}${f.lagLimitSeconds} seconds${gated ? '' : ' (not evaluated in this mode)'}`, {
    indent: 2, basis: 'documented', cite: LAG_LIMIT_MODE_CITES,
  }));
  if (doc.config.edition === '26ai' && doc.config.protectionMode === 'MAXAVAILABILITY') {
    lines.push(nDoc(
      f.lagLimitSeconds === 0
        ? 'zero means the standby must have received everything and the failover is zero data loss'
        : 'a non-zero limit makes maximum availability bounded-loss: failover is permitted while the lag is at or below the limit',
      LAG_LIMIT_MODE_CITES,
    ));
  }
  lines.push(cmd(`${pad('Shutdown Primary')}${f.pmyShutdown ? 'TRUE' : 'FALSE'}`, {
    indent: 2, basis: 'documented', cite: ['FSFO.PMY_SHUTDOWN'],
  }));
  lines.push(cmd(`${pad('Auto-reinstate')}${f.autoReinstate ? 'TRUE' : 'FALSE'}`, {
    indent: 2, basis: 'documented', cite: ['FSFO.AUTO_REINSTATE'],
  }));
  lines.push(cmd(`${pad('Observer Override')}FALSE`, {
    indent: 2, basis: 'documented', cite: ['FSFO.OBSERVER_OVERRIDE_FALSE'],
  }));
  lines.push(nDoc(
    'ObserverOverride is FALSE, the broker default, and this page models the default only: a failover needs both the observer and the target standby to have lost the primary',
    ['FSFO.OBSERVER_OVERRIDE_FALSE', 'FSFO.BOTH_MUST_HAVE_LOST'],
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

export function showObserver(doc: TopologyDoc): GeneratedFile {
  const lines: Line[] = [...headerLines()];
  lines.push(cmd('DGMGRL> SHOW OBSERVER;', {
    basis: 'documented', cite: ['OBS.SHOW_OBSERVER_FIELDS'],
  }));
  lines.push(blank());

  if (doc.observers.length === 0) {
    lines.push(nDoc(
      'no observer is deployed: that is not the same as unobserved -- with fast-start failover never enabled V$DATABASE.FS_FAILOVER_STATUS reads DISABLED, and a manual FAILOVER TO is the only thing that promotes a standby',
      ['FSFO.STATUS_DISABLED', 'FSFO.MANUAL_FAILOVER_CONDITIONS'],
    ));
    return { id: 'show.observer', title: 'SHOW OBSERVER', syntax: 'show', lines, findings: [] };
  }

  const armed = doc.config.fsfo.state !== 'disabled';
  const ordered = [...doc.observers].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'master' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

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

  const limit = doc.config.edition === '19c'
    ? '19c registers up to three observers, one of them master'
    : 'the 26ai fast-start failover chapter says four observers, while the 26ai SHOW OBSERVER page still says three';
  lines.push(note(limit, doc.config.edition === '19c'
    ? documented(limit, ['OBS.THREE_19C'])
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
  const primary = opts.whenPrimaryIs ?? declaredPrimary(doc);
  const role = m.id === primary ? 'primary' : m.role === 'primary' ? 'physical' : m.role;
  const lines: Line[] = [...headerLines()];
  const show: CitationId[] = ['RAC.SHOW_DATABASE_INSTANCES'];
  lines.push(cmd(`DGMGRL> SHOW DATABASE '${m.name}';`, { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'] }));
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
  lines.push(blank());
  if (role === 'primary') {
    lines.push(nDoc(
      'every instance open read-write runs redo transport, and the primary stays available while at least one of them still ships redo',
      ['RAC.TRANSPORT_ALL_INSTANCES', 'RAC.PRIMARY_AVAILABLE'],
    ));
  } else if (role !== 'snapshot') {
    lines.push(nDoc(
      apply === undefined
        ? 'no instance is applying at this point: the apply instance failed and the broker has not moved apply yet, or none is running'
        : 'apply runs on exactly one instance, the apply instance; if it fails the broker restarts apply on another running instance',
      ['RAC.APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_FAILOVER'],
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
  return [showConfiguration(doc, opts), showFastStartFailover(doc), showObserver(doc), ...rac];
}
