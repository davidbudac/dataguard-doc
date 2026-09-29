/**
 * The printable report, as data (docs/tasks/ui-followups.md 2.2).
 *
 * Everything the report says is assembled here, from the same generators and
 * the same validator the workbench uses -- nothing is re-worded, re-derived or
 * re-labelled for paper. `Report.tsx` only lays it out. Kept pure so the
 * contents (which sections exist, which claims keep which basis, how the
 * sources are numbered) are tested without a browser.
 *
 * Citations are numbered in order of first appearance through the report,
 * and every numbered entry resolves to the catalogue (`engine/citations.ts`):
 * the list at the end is exactly the sources the pages above rest on.
 */

import {
  buildClientFiles, citation, CITATIONS, declaredPrimary, generateDgmgrl, generateInitOraFiles,
  isDatabase, lagLimitOf,
} from '@/engine';
import type {
  Basis, CitationId, Claim, DocEdition, EngineTrace, Finding, GeneratedFile, Member,
  ProtectionLevel, Severity, TopologyDoc,
} from '@/engine';
import type { ReadoutChip } from '@/state/derived';
import { describeEvent } from '../break/events';

/* ---------------- the diagram's page ---------------- */

/**
 * The room an A4 page gives the diagram, in CSS pixels (96 per inch): the
 * sheet less report.css's 15 mm side margins, and -- landscape -- less the
 * top and bottom margins and the section heading. Portrait's height is what
 * is left under the title block and the summary, where the diagram sits.
 */
export const A4_PORTRAIT_ROOM = { w: 680, h: 520 } as const;
export const A4_LANDSCAPE_ROOM = { w: 1009, h: 620 } as const;

/** The scale a drawing of `w` x `h` user units prints at in `room`; never above 1:1. */
export const printScale = (w: number, h: number, room: { w: number; h: number }): number =>
  Math.min(1, room.w / w, room.h / h);

/**
 * Whether the diagram gets a landscape page of its own. Only when the
 * portrait page would print it below 60 % -- about where an 11 px card name
 * drops under 5 pt: three data centres in a row stay on the first page, four
 * go landscape -- and only when turning the page actually buys at least a
 * fifth more scale, which a tall drawing's does not.
 */
export function diagramLandscape(w: number, h: number): boolean {
  if (!(w > 0) || !(h > 0)) return false;
  const portrait = printScale(w, h, A4_PORTRAIT_ROOM);
  const landscape = printScale(w, h, A4_LANDSCAPE_ROOM);
  return portrait < 0.6 && landscape >= portrait * 1.2;
}

/* ---------------- shape ---------------- */

export interface SummaryRow {
  k: string;
  v: string;
  /** Present when the value is a claim rather than an input. */
  basis?: Basis;
  note?: string;
  refs?: number[];
}

export interface MemberRow {
  id: string;
  name: string;
  kind: string;
  site: string;
  instances: string;
  transport: string;
  open: string;
  fsfoTarget: boolean;
}

export interface ObserverRow {
  id: string;
  name: string;
  host: string;
  site: string;
  role: string;
  running: boolean;
}

export interface FindingRow {
  id: string;
  severity: Severity;
  subject: string;
  message: string;
  ora?: string;
  basis: Basis;
  note?: string;
  refs: number[];
}

export interface FileGroup {
  id: 'dgmgrl' | 'initora' | 'clients';
  title: string;
  lead: string;
  files: GeneratedFile[];
}

export interface RunEventRow {
  at: number;
  text: string;
}

export interface RunSection {
  events: RunEventRow[];
  outcome: ReadoutChip[];
  findings: FindingRow[];
}

/**
 * Compare alternatives (ui/review/model.ts `comparisonSection`): a baseline
 * and the configuration under one scenario, and the six scenarios run one by
 * one. Every value in it is this page's model; the report says so once, on
 * the section, with the ObserverOverride assumption it rests on.
 */
export interface ComparisonSection {
  compare: {
    baseline: { name: string; edition: string };
    current: { name: string; edition: string };
    scenario: string;
    rows: { k: string; baseline: string; current: string }[];
    settings: { path: string; before: string; after: string }[];
    commands: { title: string; removed: string[]; added: string[] }[];
  } | null;
  suite: {
    label: string; outcome: string; open: string; loss: string; expected: string; check: string;
  }[] | null;
  /** A scenario run existed but was made against other settings. */
  suiteLeftOut: boolean;
}

/** The citations the comparison's assumption rests on. */
export const COMPARISON_CITES: readonly CitationId[] = ['FSFO.OBSERVER_OVERRIDE_FALSE', 'FSFO.BOTH_MUST_HAVE_LOST'];

export interface SourceRow {
  n: number;
  id: CitationId;
  url: string;
  quote: string;
  edition: DocEdition;
  paraphrase: boolean;
  crossEdition: boolean;
}

export interface ReportModel {
  title: string;
  configName: string;
  edition: string;
  summary: SummaryRow[];
  members: MemberRow[];
  observers: ObserverRow[];
  findings: FindingRow[];
  files: FileGroup[];
  run: RunSection | null;
  comparison: ComparisonSection | null;
  /** Source numbers for the comparison's stated assumption. */
  comparisonRefs: number[];
  sources: SourceRow[];
  /** Citation id -> its number in `sources`. */
  refs: Readonly<Record<string, number>>;
}

export interface ReportInput {
  /** The Document's own name (`doc.meta.name`). */
  name: string;
  topology: TopologyDoc;
  /** The validator's findings, as the workbench shows them. */
  findings: readonly Finding[];
  /** The level the broker would report at rest (the redo graph's), with its basis. */
  protectionLevel: Claim<ProtectionLevel> | null;
  trace: EngineTrace | null;
  /** What the run reported, apart from the validator (`runFindings`). */
  runFindings: readonly Finding[];
  /** The run's readout chips, when there is a run. */
  outcome: readonly ReadoutChip[] | null;
  /** Compare alternatives, when a baseline or a current scenario run exists. */
  comparison?: ComparisonSection | null;
}

/* ---------------- words ---------------- */

/* Oracle titles the 26ai documentation set "Oracle AI Database" (the TOC's
   own "Changes in Oracle AI Database Release 26ai" and "Downgrading from
   Oracle AI Database 26ai") -- the short edition label stays "26ai". */
const EDITION_WORD: Record<string, string> = {
  '19c': 'Oracle Database 19c',
  '26ai': 'Oracle AI Database 26ai',
};

const ROLE_WORD: Record<string, string> = {
  primary: 'Primary database',
  physical: 'Physical standby',
  logical: 'Logical standby',
  snapshot: 'Snapshot standby',
};

const OPEN_WORD: Record<string, string> = {
  mount: 'Mounted',
  'read-only-adg': 'Read only (Active Data Guard)',
  'read-write': 'Read write',
};

/* ---------------- the collector ---------------- */

class Refs {
  readonly order: CitationId[] = [];
  readonly map: Record<string, number> = {};
  add(ids: readonly CitationId[] | undefined): number[] {
    const out: number[] = [];
    for (const id of ids ?? []) {
      if (!Object.prototype.hasOwnProperty.call(CITATIONS, id)) continue;
      if (this.map[id] === undefined) {
        this.order.push(id);
        this.map[id] = this.order.length;
      }
      const n = this.map[id] as number;
      if (!out.includes(n)) out.push(n);
    }
    return out;
  }
}

/* ---------------- assembly ---------------- */

function siteOfHost(t: TopologyDoc, hostId: string): string {
  const host = t.hosts.find((h) => (h.id as string) === hostId);
  if (!host) return '';
  return t.sites.find((s) => s.id === host.site)?.name ?? '';
}

function hostName(t: TopologyDoc, hostId: string): string {
  return t.hosts.find((h) => (h.id as string) === hostId)?.name ?? hostId;
}

function isFsfoTarget(t: TopologyDoc, m: Member): boolean {
  const target = t.config.fsfo.target;
  if (!isDatabase(m) || m.role === 'primary') return false;
  return target.kind === 'ANY' ? true : target.members.includes(m.id);
}

export function memberRows(t: TopologyDoc): MemberRow[] {
  return t.members.map((m) => {
    const sites = [...new Set(m.instances.map((i) => siteOfHost(t, i.host as string)))]
      .filter((s) => s !== '');
    return {
      id: m.id as string,
      name: m.name,
      kind: isDatabase(m) ? (ROLE_WORD[m.role] ?? m.role) : 'Far sync instance',
      site: sites.join(', '),
      instances: m.instances.map((i) => `${i.name} @ ${hostName(t, i.host as string)}`).join(', '),
      transport: m.logXptMode,
      open: isDatabase(m) ? (OPEN_WORD[m.openMode] ?? m.openMode) : '—',
      fsfoTarget: isFsfoTarget(t, m),
    };
  });
}

export function observerRows(t: TopologyDoc): ObserverRow[] {
  return t.observers.map((o) => ({
    id: o.id as string,
    name: o.name,
    host: hostName(t, o.host as string),
    site: siteOfHost(t, o.host as string),
    role: o.role,
    running: o.running,
  }));
}

function subjectName(t: TopologyDoc, f: Finding): string {
  const id = f.subject.id;
  if (f.subject.kind === 'config' || id === undefined) return 'Configuration';
  const hit = t.members.find((m) => (m.id as string) === id)?.name
    ?? t.observers.find((o) => (o.id as string) === id)?.name
    ?? t.links.find((l) => (l.id as string) === id)?.id as string | undefined;
  return hit ?? id;
}

function findingRows(t: TopologyDoc, fs: readonly Finding[], refs: Refs): FindingRow[] {
  return fs.map((f) => {
    const row: FindingRow = {
      id: f.id,
      severity: f.severity,
      subject: subjectName(t, f),
      message: f.message,
      basis: f.basis,
      refs: refs.add(f.cite),
    };
    if (f.ora !== undefined) row.ora = f.ora;
    if (f.note !== undefined) row.note = f.note;
    return row;
  });
}

/** Number every citation a generated file carries, in reading order. */
function citeFile(file: GeneratedFile, refs: Refs): void {
  for (const l of file.lines) refs.add(l.cite);
  for (const f of file.findings ?? []) refs.add(f.cite);
  for (const c of file.claims ?? []) refs.add(c.cite);
}

export function fsfoWord(t: TopologyDoc): string {
  const f = t.config.fsfo;
  if (f.state === 'disabled') return 'disabled';
  const target = f.target.kind === 'ANY'
    ? 'any target'
    : `target ${f.target.members.map((id) => t.members.find((m) => m.id === id)?.name ?? id).join(', ') || 'none'}`;
  return `${f.state}, threshold ${f.thresholdSeconds} s, lag limit ${lagLimitOf(t)} s, ${target}`;
}

export function buildReport(input: ReportInput): ReportModel {
  const t = input.topology;
  const refs = new Refs();
  const primary = declaredPrimary(t);

  const errs = input.findings.filter((f) => f.severity === 'error').length;
  const warns = input.findings.filter((f) => f.severity === 'warning').length;
  const notes = input.findings.length - errs - warns;
  const running = t.observers.filter((o) => o.running).length;

  const summary: SummaryRow[] = [
    { k: 'Configuration', v: t.config.name },
    { k: 'Oracle release', v: EDITION_WORD[t.config.edition] ?? t.config.edition },
    { k: 'Protection mode', v: t.config.protectionMode },
  ];
  if (input.protectionLevel !== null) {
    const pl = input.protectionLevel;
    const row: SummaryRow = {
      k: 'Protection level reported', v: pl.value, basis: pl.basis, refs: refs.add(pl.cite),
    };
    if (pl.note !== undefined) row.note = pl.note;
    summary.push(row);
  }
  summary.push(
    { k: 'Fast-start failover', v: fsfoWord(t) },
    {
      k: 'Members',
      v: `${t.members.length} (${t.members.filter((m) => isDatabase(m)).length} database, `
        + `${t.members.filter((m) => !isDatabase(m)).length} far sync)`,
    },
    { k: 'Observers', v: `${t.observers.length} (${running} running)` },
    { k: 'Data centres', v: t.sites.map((s) => s.name).join(', ') || 'none' },
    {
      k: 'Validation',
      v: `${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}, `
        + `${notes} note${notes === 1 ? '' : 's'}`,
    },
  );

  const findings = findingRows(t, input.findings, refs);

  const dgmgrl = generateDgmgrl(t, {
    findings: [...input.findings],
    ...(primary === null ? {} : { primary }),
  });
  const initora = primary === null ? [] : generateInitOraFiles(t, { primary });
  const clients = buildClientFiles(t, { lead: true });
  const files: FileGroup[] = [
    {
      id: 'dgmgrl', title: 'Broker configuration (DGMGRL)',
      lead: 'The broker configuration as one DGMGRL session.',
      files: [dgmgrl],
    },
    {
      id: 'initora', title: 'Redo transport (LOG_ARCHIVE_DEST_n)',
      lead: 'The broker-owned destination parameters, one file per member that ships redo.',
      files: initora,
    },
    {
      id: 'clients', title: 'Client connect strings (tnsnames.ora and JDBC)',
      lead: 'The connect descriptor for Oracle Net and the JDBC thin driver; an application with a connect string of its own has its own pair.',
      files: clients,
    },
  ];
  for (const g of files) for (const f of g.files) citeFile(f, refs);

  let run: RunSection | null = null;
  if (t.events.length > 0) {
    const outcome = [...(input.outcome ?? [])];
    for (const c of outcome) refs.add(c.cite);
    run = {
      events: [...t.events]
        .sort((a, b) => a.at - b.at)
        .map((e) => ({ at: e.at, text: describeEvent(t, e) })),
      outcome,
      findings: findingRows(t, input.runFindings, refs),
    };
  }

  const comparison = input.comparison ?? null;
  const comparisonRefs = comparison === null ? [] : refs.add(COMPARISON_CITES);

  const sources: SourceRow[] = refs.order.map((id, i) => {
    const c = citation(id);
    return {
      n: i + 1,
      id,
      url: c.url,
      quote: c.quote,
      edition: c.edition,
      paraphrase: c.paraphrase === true,
      crossEdition: c.verified === 'cross-edition',
    };
  });

  return {
    title: input.name.trim() === '' ? t.config.name : input.name,
    configName: t.config.name,
    edition: EDITION_WORD[t.config.edition] ?? t.config.edition,
    summary,
    members: memberRows(t),
    observers: observerRows(t),
    findings,
    files,
    run,
    comparison,
    comparisonRefs,
    sources,
    refs: refs.map,
  };
}
