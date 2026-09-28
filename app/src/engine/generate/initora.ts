/**
 * The LOG_ARCHIVE_DEST_n blocks -- engine design SS7.
 *
 * The broker owns these parameters: LogXptMode, NetTimeout, ReopenSecs and
 * MaxFailure all land in the attributes below, and this card is what they
 * would read if they were written by hand. It is also the only place in the
 * app where `ALTERNATE=`, `GROUP=` and `PRIORITY=` may appear -- `GROUP` is a
 * LOG_ARCHIVE_DEST_n attribute, never RedoRoutes syntax.
 *
 * Two rules the tests pin:
 *  - destinations are numbered from 2 upward, and the ranges are stated:
 *    n = 1..31, with 1-10 taking LOCATION or SERVICE and 11-31 SERVICE only,
 *  - `NET_TIMEOUT` is omitted under ASYNC, because it bounds the wait for a
 *    SYNC acknowledgement and never affects sessions under ASYNC.
 */

import { BROKER_DEFAULTS } from '../defaults';
import type { MemberId } from '../ids';
import { isParenthesised } from '../redo/parse';
import { activeRule, defaultDestPriority, expandAll as expandAllOf } from '../redo/resolve';
import { defaultDestProps } from '../serialize/schema';
import type { CitationId } from '../citations';
import { documented, model } from '../types/claims';
import type { DestProps, Member, RouteDest, TopologyDoc, XptMode } from '../types/topology';
import { declaredPrimary, isDatabase, isFarSync } from '../types/topology';
import type { GeneratedFile, Line, Span } from './lines';
import { blank, cmd, comment, hl, note, span } from './lines';

export interface InitOraOptions {
  /** Which member is primary; the routing rules are read for that primary. */
  primary?: MemberId;
  /** Whose parameter file to write. Defaults to the primary. */
  member?: MemberId;
  /** The first destination number to use. LOG_ARCHIVE_DEST_1 is the local one. */
  startAt?: number;
}

const nDoc = (text: string, cite: CitationId[]): Line => note(text, documented(text, cite));
const nModel = (text: string, why: string, cite: CitationId[] = []): Line =>
  note(text, model(text, why, cite));

/** SYNC maps to SYNC AFFIRM, FASTSYNC to SYNC NOAFFIRM, ASYNC to ASYNC NOAFFIRM. */
const transportAttrs = (xpt: XptMode): string =>
  (xpt === 'ASYNC' ? 'ASYNC NOAFFIRM' : xpt === 'FASTSYNC' ? 'SYNC NOAFFIRM' : 'SYNC AFFIRM');

interface Slot {
  n: number;
  to: Member;
  xpt: XptMode;
  props: DestProps;
  /** Set when this destination stands in for another one. */
  alternateFor?: number;
  /** The destination number of this one's alternate, when it has one. */
  alternate?: number;
  fallback?: boolean;
  /** GROUP=k: the k-th parenthesised group of the active rule. */
  group?: number;
  /** Written with `group`: the destination's PRIORITY, as written or its default. */
  priority?: number;
}

export function generateInitOra(doc: TopologyDoc, opts: InitOraOptions = {}): GeneratedFile {
  const primaryId = opts.primary ?? declaredPrimary(doc);
  const senderId = opts.member ?? primaryId;
  const sender = doc.members.find((m) => m.id === senderId);
  const defaults = BROKER_DEFAULTS[doc.config.edition];
  const lines: Line[] = [];
  if (doc.members.some(m => m.routesObserved)) {
    lines.push(nModel('Imported SQL snapshot: this is not a recovered broker configuration. Review all generated commands before use.',
      'Only current collected routes are known. Empty observed routes suppress simulator defaults, but cannot express an empty broker RedoRoutes policy; future-role routes and uncollected settings need manual review.'));
  }

  const file = (ls: Line[], title: string): GeneratedFile => ({
    id: sender ? `initora.${sender.id as string}` : 'initora',
    title,
    filename: 'init.ora',
    syntax: 'initora',
    lines: ls,
    findings: [],
  });

  if (!sender || primaryId === null) {
    return file([nDoc(
      'no primary database is declared in this document, so no destination is resolved',
      ['DEST.RANGE_1_31'],
    )], 'LOG_ARCHIVE_DEST_n -- where the transport properties land');
  }

  const slots = slotsFor(doc, sender, primaryId, opts.startAt ?? 2);
  const isPrimary = sender.id === primaryId;

  lines.push(comment(`broker-owned on ${sender.name}: LogXptMode, NetTimeout, ReopenSecs`,
    { basis: 'documented', cite: ['XPT.LOGXPTMODE_VALUES', 'DEST.NET_TIMEOUT'] }));
  lines.push(comment('and MaxFailure all land in these attributes. By hand it'));
  lines.push(comment('would read:'));
  lines.push(blank());

  if (slots.length === 0) {
    lines.push(comment(`${sender.name} has no active redo destination under this primary.`));
    return file(lines, `LOG_ARCHIVE_DEST_n on ${sender.name}`);
  }

  for (const s of slots) {
    lines.push(...blockLines(s, isPrimary, defaults));
    lines.push(blank());
  }

  /* ---- the commentary the numbers need ---- */
  const anyAsync = slots.some((s) => s.xpt === 'ASYNC');
  const anySync = slots.some((s) => s.xpt !== 'ASYNC');
  if (anyAsync) {
    lines.push(comment('NET_TIMEOUT left out under ASYNC: it bounds the SYNC acknowledgement',
      { basis: 'documented', cite: ['DEST.NET_TIMEOUT'] }));
    lines.push(comment('wait, and never affects sessions under ASYNC'));
  }
  if (anySync) {
    const first = slots.find((s) => s.xpt !== 'ASYNC') as Slot;
    lines.push(comment(
      first.props.netTimeoutSeconds === defaults.netTimeoutSeconds
        ? `NET_TIMEOUT=${first.props.netTimeoutSeconds} is the default, spelled out -- seconds LGWR waits`
        : `NET_TIMEOUT=${first.props.netTimeoutSeconds}: seconds LGWR waits (the default is ${defaults.netTimeoutSeconds})`,
      { basis: 'documented', cite: ['DEST.NET_TIMEOUT'] },
    ));
    lines.push(comment("for the standby's acknowledgement; it is never a failover clock"));
  }
  const maxFailures = [...new Set(slots.map((s) => s.props.maxFailure))];
  for (const mf of maxFailures) {
    if (mf === 0) {
      lines.push(comment('MAX_FAILURE=0: retried at every log switch, without limit',
        { basis: 'documented', cite: ['DEST.MAX_FAILURE'] }));
    } else {
      lines.push(comment(`MAX_FAILURE=${mf}: after ${mf} consecutive failed reopens the destination is`,
        { basis: 'documented', cite: ['DEST.MAX_FAILURE'] }));
      lines.push(comment('disabled with no further access until it is manually reenabled, and'));
      lines.push(comment('REOPEN is then treated as unspecified'));
    }
  }
  lines.push(comment('whether a successful reopen resets that counter is not documented',
    { basis: 'documented', cite: ['DEST.MAX_FAILURE'] }));
  lines.push(comment('REOPEN only gates eligibility: transport retries a failed destination at',
    { basis: 'documented', cite: ['DEST.REOPEN'] }));
  lines.push(comment('log switch time, once the last error plus REOPEN is in the past'));
  lines.push(blank());
  lines.push(comment('LOG_ARCHIVE_DEST_n takes n = 1..31; 1-10 accept LOCATION or SERVICE,',
    { basis: 'documented', cite: ['DEST.RANGE_1_31'] }));
  lines.push(comment('11-31 SERVICE only'));
  const highest = Math.max(...slots.map((s) => s.n));
  if (highest > 31) {
    lines.push(comment(`this configuration needs LOG_ARCHIVE_DEST_${highest}, past the documented range`,
      { basis: 'documented', cite: ['DEST.RANGE_1_31'] }));
  }
  if (!isPrimary && isFarSync(sender)) {
    lines.push(comment('a far sync instance uses ASYNC transport to ship the incoming redo to',
      { basis: 'documented', cite: ['FS.ONWARD_ASYNC'] }));
    lines.push(comment('terminal standbys'));
  } else if (!isPrimary) {
    lines.push(comment('a cascading standby forwards from destinations 1-10 when the cascade is',
      { basis: 'documented', cite: ['CASCADE.PHYSICAL_ONLY', 'CASCADE.THIRTY_TERMINAL'] }));
    lines.push(comment('not real-time; only physical standbys cascade, to up to 30 terminal'));
    lines.push(comment('destinations'));
  }
  lines.push(blank());
  lines.push(comment('ReopenSecs / MaxFailure are the broker properties behind REOPEN / MAX_FAILURE --',
    { basis: 'documented', cite: ['DEST.DEPRECATED_19C'] }));
  lines.push(comment('not deprecated in 19c; EDIT DATABASE ... SET PARAMETER reaches the same attributes'));
  if (slots.some((s) => s.priority !== undefined)) {
    lines.push(nModel(
      "GROUP= and PRIORITY= are LOG_ARCHIVE_DEST_n attributes, never RedoRoutes syntax; writing each parenthesised RedoRoutes group as a GROUP of its own, with each destination's PRIORITY, is this page's reading of the same intent",
      'The RedoRoutes PRIORITY grammar and the LOG_ARCHIVE_DEST_n GROUP/PRIORITY attributes are both documented; that the broker writes the one as the other is not, so the mapping is this page\'s model.',
      ['ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX', 'DEST.ATTRIBUTE_SPELLINGS', 'DEST.GROUP_PRIORITY_REENTER'],
    ));
    lines.push(nDoc(
      'destinations carrying GROUP and PRIORITY re-enter service when they are found accessible -- the one documented exception to the manual-reenable rule',
      ['DEST.GROUP_PRIORITY_REENTER'],
    ));
  }
  if (!isPrimary) {
    lines.push(nModel(
      `VALID_FOR on ${sender.name} is written for the standby role`,
      'Which VALID_FOR pair the broker writes at a cascading standby or a far sync instance was not verified, so the keywords here are this page\'s model.',
      ['DEST.ATTRIBUTE_SPELLINGS'],
    ));
  }

  return file(lines, `LOG_ARCHIVE_DEST_n on ${sender.name} -- where the transport properties land`);
}

/** One parameter file per member that ships redo under this primary. */
export function generateInitOraFiles(doc: TopologyDoc, opts: InitOraOptions = {}): GeneratedFile[] {
  const primaryId = opts.primary ?? declaredPrimary(doc);
  if (primaryId === null) return [generateInitOra(doc, opts)];
  const out: GeneratedFile[] = [];
  for (const m of doc.members) {
    if (!m.enabled) continue;
    const slots = slotsFor(doc, m, primaryId, opts.startAt ?? 2);
    if (slots.length === 0) continue;
    out.push(generateInitOra(doc, { ...opts, primary: primaryId, member: m.id }));
  }
  return out;
}

/* ---------------- resolving the destinations ---------------- */

function slotsFor(doc: TopologyDoc, sender: Member, primary: MemberId, startAt: number): Slot[] {
  const act = activeRule(sender, primary);
  if (!act) return [];
  const slots: Slot[] = [];
  let n = startAt;

  const receiver = (id: MemberId): Member | undefined => doc.members.find((m) => m.id === id);
  /* `ALL` is every other enabled member except the primary itself -- the
     same reading the redo graph resolver uses. */
  const expandAll = (): MemberId[] => expandAllOf(doc, sender.id, primary);

  const push = (
    to: Member, d: RouteDest, viaAlt: boolean, grouped?: { group: number; priority: number },
  ): Slot => {
    const xptFromRule = viaAlt ? d.alt?.xpt : d.xpt;
    const slot: Slot = {
      n: n++,
      to,
      xpt: xptFromRule ?? to.logXptMode,
      props: sender.dests[to.id] ?? defaultDestProps({ inGroup: grouped !== undefined }),
    };
    if (grouped !== undefined) {
      slot.group = grouped.group;
      slot.priority = grouped.priority;
    }
    slots.push(slot);
    return slot;
  };

  /* Each parenthesised RedoRoutes group is one LOG_ARCHIVE_DEST_n GROUP, its
     destinations carrying their own PRIORITY. */
  let groupNo = 0;
  for (const g of act.rule.groups) {
    const grouped = isParenthesised(g);
    if (grouped) groupNo++;
    for (const d of g.dests) {
      if (d.target === 'ALL') {
        for (const id of expandAll()) {
          const to = receiver(id);
          if (to) push(to, d, false);
        }
        continue;
      }
      const to = receiver(d.target);
      if (!to || !to.enabled) continue;
      const main = push(to, d, false, grouped
        ? { group: groupNo, priority: d.priority ?? defaultDestPriority(to) }
        : undefined);
      if (d.alt) {
        const altTo = receiver(d.alt.target);
        if (altTo) {
          const alt = push(altTo, d, true);
          alt.alternateFor = main.n;
          if (d.alt.fallback === true) alt.fallback = true;
          main.alternate = alt.n;
        }
      }
    }
  }
  return slots;
}

/* ---------------- one block ---------------- */

function blockLines(
  s: Slot, isPrimary: boolean, defaults: (typeof BROKER_DEFAULTS)['19c'],
): Line[] {
  const out: Line[] = [];
  const p = s.props;
  const asyncHere = s.xpt === 'ASYNC';
  const dest = `log_archive_dest_${s.n}`;

  if (s.alternateFor !== undefined) {
    out.push(comment(
      `the alternate for log_archive_dest_${s.alternateFor}${s.fallback === true ? ', with FALLBACK' : ''}`,
      { basis: 'documented', cite: ['ROUTES.GRAMMAR_121', 'DEST.ATTRIBUTE_SPELLINGS'] },
    ));
  }
  out.push(cmd(`${dest} =`, { basis: 'documented', cite: ['DEST.ATTRIBUTE_SPELLINGS'] }));

  const head: Span[] = [
    span(`   'SERVICE=${s.to.connectIdentifier} `),
    (s.xpt === defaults.logXptMode ? span(transportAttrs(s.xpt)) : hl(transportAttrs(s.xpt))),
  ];
  if (!asyncHere) {
    head.push(span(' NET_TIMEOUT='));
    head.push(p.netTimeoutSeconds === defaults.netTimeoutSeconds
      ? span(String(p.netTimeoutSeconds)) : hl(String(p.netTimeoutSeconds)));
  }
  out.push(cmd(head, { basis: 'documented', cite: ['XPT.AFFIRM_SEMANTICS', 'DEST.NET_TIMEOUT'] }));

  out.push(cmd([
    span('    REOPEN='),
    p.reopenSeconds === defaults.reopenSeconds ? span(String(p.reopenSeconds)) : hl(String(p.reopenSeconds)),
    span(' MAX_FAILURE='),
    p.maxFailure === defaults.maxFailure ? span(String(p.maxFailure)) : hl(String(p.maxFailure)),
  ], { basis: 'documented', cite: ['DEST.REOPEN', 'DEST.MAX_FAILURE'] }));

  if (s.alternate !== undefined) {
    out.push(cmd([span('    ALTERNATE='), hl(`LOG_ARCHIVE_DEST_${s.alternate}`)],
      { basis: 'documented', cite: ['DEST.ATTRIBUTE_SPELLINGS'] }));
  }
  if (s.group !== undefined && s.priority !== undefined) {
    out.push(cmd([span('    GROUP='), hl(String(s.group)), span(' PRIORITY='), hl(String(s.priority))],
      { basis: 'documented', cite: ['DEST.ATTRIBUTE_SPELLINGS'] }));
  }
  out.push(cmd(
    `    VALID_FOR=(${isPrimary ? 'ONLINE_LOGFILES,PRIMARY_ROLE' : 'STANDBY_LOGFILES,STANDBY_ROLE'})`,
    { basis: 'documented', cite: ['DEST.ATTRIBUTE_SPELLINGS'] },
  ));
  out.push(cmd(`    DB_UNIQUE_NAME=${s.to.name}'`,
    { basis: 'documented', cite: ['DEST.ATTRIBUTE_SPELLINGS'] }));
  return out;
}
