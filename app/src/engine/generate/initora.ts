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
import { declaredPrimary, isDatabase, isFarSync, isRac } from '../types/topology';
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
  const v26 = doc.config.edition === '26ai';
  const maxFailures = [...new Set(slots.map((s) => s.props.maxFailure))];
  for (const mf of maxFailures) {
    if (mf === 0) {
      lines.push(comment(
        v26 ? 'MAX_FAILURE=0: reactivation attempts are continuous' : 'MAX_FAILURE=0: retried at every log switch, without limit',
        { basis: 'documented', cite: v26 ? ['DEST.MAX_FAILURE_26AI'] : ['DEST.MAX_FAILURE'] },
      ));
    } else if (v26 && mf === 1) {
      lines.push(comment('MAX_FAILURE=1: no attempts are made to reactivate this destination',
        { basis: 'documented', cite: ['DEST.MAX_FAILURE_26AI'] }));
      lines.push(comment('when it fails'));
    } else if (v26) {
      lines.push(comment(`MAX_FAILURE=${mf}: reactivation is attempted until ${mf} consecutive`,
        { basis: 'documented', cite: ['DEST.MAX_FAILURE_26AI'] }));
      lines.push(comment('failures, after which no further attempts are made to reactivate it'));
    } else {
      lines.push(comment(`MAX_FAILURE=${mf}: after ${mf} consecutive failed reopens the destination is`,
        { basis: 'documented', cite: ['DEST.MAX_FAILURE'] }));
      lines.push(comment('disabled with no further access until it is manually reenabled, and'));
      lines.push(comment('REOPEN is then treated as unspecified'));
    }
  }
  if (!v26) {
    lines.push(comment('whether a successful reopen resets that counter is not documented',
      { basis: 'documented', cite: ['DEST.MAX_FAILURE'] }));
  }
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
    { basis: 'documented', cite: ['DEST.BROKER_OWNED_PROPERTIES', 'DEST.DEPRECATED_19C'] }));
  lines.push(comment('not deprecated in any edition; the DGMGRL script sets them with EDIT DATABASE'));
  lines.push(comment('... SET PROPERTY where they differ from the broker default'));
  if (slots.some((s) => s.alternate !== undefined)) {
    lines.push(nDoc(
      'ALTERNATE for a SERVICE= (remote) destination is maintained only for backwards compatibility -- GROUP and PRIORITY are the preferred, current form; ALTERNATE is still the way to configure a local LOCATION= alternate',
      ['ROUTES.ALT_BACKWARDS_COMPAT'],
    ));
  }
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
  const rac = generateRacParameters(doc, primaryId);
  if (rac !== null) out.push(rac);
  const srl = generateStandbyRedoLogs(doc, primaryId);
  if (srl !== null) out.push(srl);
  return out;
}

/* ---------------- RAC: per-instance parameters and standby redo logs ---------------- */

/**
 * What a RAC database adds to the parameter files (facts.md F6, F7): one
 * SPFILE whose `<sid>.` entries set one instance and `*.` entries every
 * instance, a distinct INSTANCE_NUMBER and THREAD per instance, and `%t` in
 * LOG_ARCHIVE_FORMAT. Only written when some database runs more than one
 * instance, so a configuration without RAC reads as it always did. The
 * standby redo logs are SQL, not parameters: `generateStandbyRedoLogs`
 * writes them (GEN-28).
 */
export function generateRacParameters(doc: TopologyDoc, primaryId: MemberId): GeneratedFile | null {
  const racs = doc.members.filter((m) => isDatabase(m) && m.enabled && isRac(m));
  const primary = doc.members.find((m) => m.id === primaryId);
  if (racs.length === 0 || !primary) return null;
  const lines: Line[] = [];

  lines.push(comment('one SPFILE per RAC database: <sid>.name sets one instance, *.name',
    { basis: 'documented', cite: ['RAC.SPFILE_SID_PREFIX'] }));
  lines.push(comment('every instance that has no value of its own'));
  lines.push(blank());
  for (const m of racs) {
    lines.push(comment(`${m.name}`));
    m.instances.forEach((inst, i) => {
      lines.push(cmd([span(`${inst.name}.instance_number=`), hl(String(i + 1))],
        { basis: 'documented', cite: ['RAC.INSTANCE_NUMBER'] }));
      lines.push(cmd([span(`${inst.name}.thread=`), hl(String(i + 1))], {
        basis: 'model', cite: ['RAC.INSTANCE_NUMBER'],
        note: 'Every instance needs a different INSTANCE_NUMBER, and a THREAD that differs from the others where one is set; numbering both in instance order is this page\'s choice. THREAD is superseded by INSTANCE_NAME and INSTANCE_NUMBER in 19c.',
      }));
    });
    lines.push(cmd([span("*.log_archive_format='"), hl('%t_%s_%r.arc'), span("'")], {
      basis: 'model', cite: ['RAC.SAME_DEST_EVERY_INSTANCE'],
      note: 'The %t (thread) element is mandatory for Oracle RAC, and every instance of a Data Guard database must use the same LOG_ARCHIVE_FORMAT; the rest of the pattern is an example.',
    }));
    lines.push(blank());
  }
  if (isRac(primary)) {
    lines.push(nDoc(
      `set the same LOG_ARCHIVE_DEST_n on every instance of ${primary.name} (*.log_archive_dest_n), with a SERVICE whose address list reaches every instance of the standby`,
      ['RAC.SAME_DEST_EVERY_INSTANCE'],
    ));
    lines.push(blank());
  }

  return {
    id: 'initora.rac', title: 'RAC -- per-instance parameters',
    filename: 'init.ora', syntax: 'initora', lines, findings: [],
  };
}

/* ---------------- RAC: standby redo logs ---------------- */

/**
 * The standby redo logs a RAC configuration needs (GEN-28): SQL, so a file of
 * its own rather than lines in an init.ora. They belong on every member that
 * receives redo -- the standbys and any far sync instance now, and the primary
 * for after a role change ("Ensure standby redo logs are configured on the
 * primary and target standby databases") -- with a group set for each redo
 * thread of the redo source: the primary's instances for a receiver, the
 * largest other database for the primary itself. Written when some database
 * runs more than one instance, which is when the thread count matters.
 */
export function generateStandbyRedoLogs(doc: TopologyDoc, primaryId: MemberId): GeneratedFile | null {
  const primary = doc.members.find((m) => m.id === primaryId);
  const racs = doc.members.filter((m) => isDatabase(m) && m.enabled && isRac(m));
  if (racs.length === 0 || !primary) return null;
  const v26 = doc.config.edition === '26ai';
  const lines: Line[] = [];

  /* TXT-14: the rule is worded differently in 26ai (at least the SAME number
     of groups) than in 19c and 21c (at least ONE MORE). */
  lines.push(comment(`standby redo logs on every member that receives redo: for each redo thread of the redo source,`,
    { basis: 'documented', cite: [v26 ? 'RAC.SRL_PER_THREAD_26AI' : 'RAC.SRL_PER_THREAD'] }));
  lines.push(comment(v26
    ? 'at least the same number of standby redo log groups as the online redo log groups'
    : 'at least one more standby redo log group than the online redo log groups'));
  lines.push(comment('(query V$LOG and V$THREAD at the redo source for the groups and the threads)'));

  const others = doc.members.filter((m) => isDatabase(m) && m.enabled && m.id !== primaryId);
  const receivers = doc.members.filter((m) => (isDatabase(m) || isFarSync(m)) && m.enabled);
  for (const r of receivers) {
    const source = r.id === primaryId
      ? Math.max(1, ...others.map((o) => o.instances.length))
      : primary.instances.length;
    const from = r.id === primaryId
      ? 'the largest other database, which becomes the redo source after a role change'
      : primary.name;
    lines.push(blank());
    lines.push(comment(`on ${r.name}: ${source} redo thread${source === 1 ? '' : 's'} of ${from}`));
    for (let t = 1; t <= source; t++) {
      for (let g = 0; g < 3; g++) {
        lines.push(cmd([span('ALTER DATABASE ADD STANDBY LOGFILE THREAD '), hl(String(t)), span(' SIZE 500M;')],
          { basis: 'documented', cite: [v26 ? 'RAC.SRL_PER_THREAD_26AI' : 'RAC.SRL_PER_THREAD'] }));
      }
    }
    if (isDatabase(r) && isRac(r)) {
      lines.push(nDoc(
        `${r.name} is RAC too: its standby redo logs must sit where all of its instances can reach them, such as Oracle ASM or a cluster file system`,
        ['RAC.SRL_SHARED'],
      ));
    }
  }
  lines.push(blank());
  lines.push(nModel(
    v26
      ? 'three groups per thread and SIZE 500M are examples: three is more than the two online groups each instance must have at least, so it satisfies the 26ai rule (and the 19c one), and each standby redo log must be at least as large as the largest online redo log'
      : 'three groups per thread and SIZE 500M are examples: three is one more than the two online groups each instance must have at least, and each standby redo log must be at least as large as the largest online redo log',
    'The rule is documented; the online log count and size of this drawing are not modelled, so the numbers are placeholders.',
    [v26 ? 'RAC.SRL_PER_THREAD_26AI' : 'RAC.SRL_PER_THREAD', 'RAC.INSTANCE_NUMBER'],
  ));
  return {
    id: 'srl.rac', title: 'RAC -- standby redo logs', filename: 'standby-redo-logs.sql',
    syntax: 'sql', lines, findings: [],
  };
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

  /* An alternate needs its own LOG_ARCHIVE_DEST_STATE_n: 'ALTERNATE' on the
     stand-in, 'ENABLE' on the destination it stands in for -- the worked
     example in "Using the ALTERNATE Attribute" (DEST.ALTERNATE_STATE_EXAMPLE)
     sets both, on lines of their own, ahead of the LOG_ARCHIVE_DEST_n itself. */
  if (s.alternateFor !== undefined) {
    out.push(cmd(`log_archive_dest_state_${s.n} = 'ALTERNATE'`,
      { basis: 'documented', cite: ['DEST.ALTERNATE_STATE_EXAMPLE'] }));
    out.push(comment(
      `the alternate for log_archive_dest_${s.alternateFor}${s.fallback === true ? ', with FALLBACK' : ''}`,
      { basis: 'documented', cite: ['ROUTES.GRAMMAR_121', 'DEST.ATTRIBUTE_SPELLINGS'] },
    ));
  } else if (s.alternate !== undefined) {
    out.push(cmd(`log_archive_dest_state_${s.n} = 'ENABLE'`,
      { basis: 'documented', cite: ['DEST.ALTERNATE_STATE_EXAMPLE'] }));
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
    /* The broker default is 1 inside a parenthesised group, 0 outside (GEN-21). */
    p.maxFailure === defaultDestProps({ inGroup: s.group !== undefined }).maxFailure
      ? span(String(p.maxFailure)) : hl(String(p.maxFailure)),
  ], { basis: 'documented', cite: ['DEST.REOPEN', 'DEST.MAX_FAILURE'] }));

  if (s.alternate !== undefined) {
    out.push(cmd([span('    ALTERNATE='), hl(`LOG_ARCHIVE_DEST_${s.alternate}`)],
      { basis: 'documented', cite: ['DEST.ATTRIBUTE_SPELLINGS'] }));
  }
  /* The worked example writes the back-reference on the alternate too:
     LOG_ARCHIVE_DEST_3='SERVICE=boston ASYNC ALTERNATE=LOG_ARCHIVE_DEST_2 (TXT-26). */
  if (s.alternateFor !== undefined) {
    out.push(cmd([span('    ALTERNATE='), hl(`LOG_ARCHIVE_DEST_${s.alternateFor}`)],
      { basis: 'documented', cite: ['DEST.ALTERNATE_STATE_EXAMPLE'] }));
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
