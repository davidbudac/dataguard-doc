/**
 * The DGMGRL script -- engine design SS7.
 *
 * One broker session that builds the configuration the document describes, in
 * the order the documentation builds one: create, add the members, set the
 * per-member transport and routing properties, enable, choose the protection
 * mode, set the fast-start failover properties, arm it, start the observers.
 *
 * The card is a transcript, so its commentary is parenthetical and unprefixed:
 * DGMGRL has no comment syntax to borrow. Three traps the golden tests pin:
 *
 *  - `FILE IS`, never `FILE=`,
 *  - `GROUP` never appears inside a RedoRoutes string -- it is a
 *    LOG_ARCHIVE_DEST_n attribute and lands in the init.ora block instead,
 *  - the fast-start failover target list is an *order*, never "the first
 *    viable one in the list".
 *
 * Validation notes are not re-derived here: whatever `validate(doc)` returned
 * is passed in and appended, so there is one source of truth for them.
 */

import { assertCitesAllowed } from '../citations';
import type { CitationId } from '../citations';
import { BROKER_DEFAULTS, defaultLagLimit } from '../defaults';
import type { MemberId } from '../ids';
import { formatRedoRoutes } from '../redo/parse';
import { resolveRedoGraph } from '../redo/resolve';
import { detectClaim, lagGated, pingPropertiesSet } from '../sim/fsfo';
import type { Claim, Finding } from '../types/claims';
import { docLater, documented, model } from '../types/claims';
import type { DestProps, Member, TopologyDoc } from '../types/topology';
import { declaredPrimary, isDatabase, isFarSync } from '../types/topology';
import type { GeneratedFile, Line, Span } from './lines';
import { blank, cmd, hl, note, span } from './lines';

/* The lag limit's protection-mode story is one of the fenced facts: the 26ai
   maximum-availability role may be cited only to the fast-start failover
   chapter's "Fast-start Failover Protection Modes" section -- never to that
   chapter's Task 3, and never to the closing line of the property page. */
const LAG_LIMIT_MODE_CITES: CitationId[] = ['FSFO.LAGLIMIT_MAXAVAIL_26AI', 'MAXAVAIL.AT_LEAST_ONE'];
assertCitesAllowed('LAG_LIMIT_MODE', LAG_LIMIT_MODE_CITES);

export interface DgmgrlOptions {
  /** Whatever `validate(doc)` said; appended verbatim as the closing block. */
  findings?: readonly Finding[];
  /** Which member the script builds the configuration around. */
  primary?: MemberId;
}

/* ---------------- small helpers ---------------- */

const kw = (m: Member): string => (isFarSync(m) ? 'FAR_SYNC' : 'DATABASE');
const q = (s: string): string => `'${s}'`;
/** `EDIT DATABASE 'x'` / `EDIT FAR_SYNC 'x'` -- both spellings are documented. */
const editOf = (m: Member): string => `EDIT ${kw(m)} ${q(m.name)}`;

/** A value span: highlighted whenever it is not the broker default. */
const val = (v: string | number, isDefault: boolean): Span =>
  (isDefault ? span(String(v)) : hl(String(v)));

const nDoc = (text: string, cite: CitationId[]): Line => note(text, documented(text, cite));
const nModel = (text: string, why: string, cite: CitationId[] = []): Line =>
  note(text, model(text, why, cite));
const nLater = (text: string, cite: CitationId[], why: string): Line =>
  note(text, docLater(text, cite, why));

export function generateDgmgrl(doc: TopologyDoc, opts: DgmgrlOptions = {}): GeneratedFile {
  const lines: Line[] = [];
  const findings = [...(opts.findings ?? [])];
  const cfg = doc.config;
  const fsfo = cfg.fsfo;
  const defaults = BROKER_DEFAULTS[cfg.edition];
  const members = doc.members;
  const primaryId = opts.primary ?? declaredPrimary(doc);
  const primary = members.find((m) => m.id === primaryId);

  const file = (ls: Line[]): GeneratedFile => ({
    id: 'dgmgrl',
    title: 'DGMGRL -- the broker configuration',
    filename: 'configure.dgmgrl',
    syntax: 'dgmgrl',
    lines: ls,
    findings,
  });

  if (!primary) {
    return file([nDoc(
      'no primary database is declared in this document, so there is nothing to create',
      ['DGMGRL.BROKER_COMMANDS'],
    )]);
  }

  const graph = resolveRedoGraph(doc, { primary: primary.id });
  const databases = members.filter(isDatabase);
  const farSyncs = members.filter(isFarSync);

  /* ---- the session ---- */
  lines.push(cmd(`CONNECT sys@${primary.connectIdentifier} AS SYSDBA;`,
    { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'] }));
  lines.push(blank());

  /* ---- CREATE CONFIGURATION, ADD DATABASE, ADD FAR_SYNC ---- */
  lines.push(cmd(
    `CREATE CONFIGURATION ${q(cfg.name)} AS PRIMARY DATABASE IS ${q(primary.name)} CONNECT IDENTIFIER IS ${primary.connectIdentifier};`,
    { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'] },
  ));
  for (const m of databases) {
    if (m.id === primary.id) continue;
    lines.push(cmd(`ADD DATABASE ${q(m.name)} AS CONNECT IDENTIFIER IS ${m.connectIdentifier};`,
      { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'] }));
  }
  /* The far sync spelling is Oracle's own, and unquoted in every example it
     gives: ADD FAR_SYNC FS2 AS CONNECT IDENTIFIER IS FS2.example.com; */
  for (const m of farSyncs) {
    lines.push(cmd(`ADD FAR_SYNC ${m.name} AS CONNECT IDENTIFIER IS ${m.connectIdentifier};`,
      { basis: 'documented', cite: ['DGMGRL.FAR_SYNC_COMMANDS'] }));
  }
  if (farSyncs.length > 0) {
    lines.push(nDoc(
      'a far sync instance has no role, no apply and no broker state: it receives redo into standby redo logs and forwards it, and can never function in the primary role',
      ['FS.MANAGES_CONTROLFILE', 'FS.NO_DATAFILES', 'FS.NO_BROKER_STATE'],
    ));
    lines.push(nDoc(
      'a far sync edge does not replace the primary-to-standby link: there must still be a direct network connection between the primary database and the remote standby database, used for health checks and switchover processing',
      ['FS.DIRECT_LINK_REQUIRED'],
    ));
  }
  lines.push(blank());

  /* ---- LogXptMode, on each receiving member ---- */
  for (const m of members) {
    if (m.id === primary.id) continue;
    const isDefault = m.logXptMode === defaults.logXptMode;
    lines.push(cmd(
      [span(`${editOf(m)} SET PROPERTY 'LogXptMode' = '`), val(m.logXptMode, isDefault), span("';")],
      { basis: 'documented', cite: ['XPT.LOGXPTMODE_VALUES'] },
    ));
    if (isDefault) lines.push(nDoc('default', ['XPT.LOGXPTMODE_VALUES']));
  }
  /* The primary carries one too: it ships redo with it once a role swap makes
     it the standby. */
  lines.push(cmd(
    [span(`${editOf(primary)} SET PROPERTY 'LogXptMode' = '`),
      val(primary.logXptMode, primary.logXptMode === defaults.logXptMode), span("';")],
    { basis: 'documented', cite: ['XPT.LOGXPTMODE_VALUES'] },
  ));
  lines.push(nDoc(
    `${primary.name} ships redo with it once a role swap makes it the standby`,
    ['FS.ROUTES_BOTH_DIRECTIONS'],
  ));
  if (farSyncs.length > 0 && fsfo.state !== 'disabled') {
    lines.push(nDoc(
      'to use a far sync instance with fast-start failover the far sync transport mode must be SYNC or FASTSYNC and the target standby transport mode must be ASYNC',
      ['FSFO.FARSYNC_XPT'],
    ));
  }
  lines.push(blank());

  /* ---- RedoRoutes, pre-declared in both directions ---- */
  const routed = members.filter((m) => m.redoRoutes.length > 0);
  if (routed.length > 0) {
    for (const m of routed) {
      lines.push(cmd(
        [span(`${editOf(m)} SET PROPERTY 'RedoRoutes' = '`),
          hl(formatRedoRoutes(m.redoRoutes)), span("';")],
        { basis: 'documented', cite: ['ROUTES.GRAMMAR_121', 'ROUTES.CANONICAL_PAIR'] },
      ));
    }
    lines.push(nDoc(
      'the routes are pre-declared for both directions: a rule is active when its redo source names the current primary, and nothing rewrites on a role change',
      ['FS.ROUTES_BOTH_DIRECTIONS', 'ROUTES.RULE_ACTIVE'],
    ));
    if (routed.some((m) => m.redoRoutes.some((r) => r.groups.length > 1))) {
      lines.push(nDoc(
        'PRIORITY is RedoRoutes syntax; GROUP is not -- GROUP is a LOG_ARCHIVE_DEST_n attribute and appears in the init.ora block instead',
        ['ROUTES.GROUP_IS_NOT_ROUTES_SYNTAX', 'ROUTES.PRIORITY_26AI'],
      ));
    }
    if (routed.some((m) => m.redoRoutes.some((r) => r.groups.some((g) => g.dests.some((d) => d.alt))))) {
      lines.push(nDoc(
        'an alternate requires a non-zero MaxFailure on the non-alternate member',
        ['ROUTES.ALT_MAXFAILURE'],
      ));
    }
    lines.push(blank());
  }

  /* ---- NetTimeout, a property of the receiving member ---- */
  const netTimeouts: Array<{ m: Member; d: DestProps }> = [];
  for (const m of members) {
    for (const sender of members) {
      const d = sender.dests[m.id];
      if (d !== undefined) { netTimeouts.push({ m, d }); break; }
    }
  }
  if (netTimeouts.length > 0) {
    for (const { m, d } of netTimeouts) {
      const isDefault = d.netTimeoutSeconds === defaults.netTimeoutSeconds;
      lines.push(cmd(
        [span(`${editOf(m)} SET PROPERTY 'NetTimeout' = `), val(d.netTimeoutSeconds, isDefault), span(';')],
        { basis: 'documented', cite: ['DEST.NET_TIMEOUT'] },
      ));
      if (isDefault) lines.push(nDoc('default', ['DEST.NET_TIMEOUT']));
      const xpt = graph.members[m.id]?.effectiveXpt;
      if (xpt === 'ASYNC') {
        lines.push(nDoc(
          `${m.name} receives ASYNC here: NetTimeout bounds how long LGWR waits for a SYNC acknowledgement, it never affects sessions under ASYNC, and it is never a failover clock`,
          ['DEST.NET_TIMEOUT'],
        ));
      } else if (d.netTimeoutSeconds < 8) {
        lines.push(nDoc(
          'the documented minimum is 1 s, and 8 to 10 s or more is recommended',
          ['DEST.NET_TIMEOUT'],
        ));
      }
    }
    lines.push(nDoc(
      'ReopenSecs and MaxFailure stay documented broker properties in 19c (neither is on the 19c deprecation list); their values are the REOPEN and MAX_FAILURE attributes, so this script sets them once, in the LOG_ARCHIVE_DEST_n block',
      ['DEST.DEPRECATED_19C'],
    ));
    lines.push(blank());
  }

  /* ---- enable the far sync instances, then the configuration ---- */
  for (const m of farSyncs) {
    lines.push(cmd(`ENABLE FAR_SYNC ${m.name};`,
      { basis: 'documented', cite: ['DGMGRL.FAR_SYNC_COMMANDS'] }));
  }
  lines.push(cmd('ENABLE CONFIGURATION;', { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'] }));
  lines.push(blank());

  /* ---- protection mode ---- */
  lines.push(cmd(
    [span('EDIT CONFIGURATION SET PROTECTION MODE AS '),
      val(cfg.protectionMode, cfg.protectionMode === defaults.protectionMode), span(';')],
    { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS', 'XPT.TABLE_4_2'] },
  ));
  if (cfg.protectionMode === 'MAXAVAILABILITY') {
    lines.push(nDoc(
      'if the primary does not receive acknowledgement from at least one synchronized standby, then it operates as if it were in maximum performance mode',
      ['MAXAVAIL.AT_LEAST_ONE'],
    ));
  }
  if (cfg.protectionMode === 'MAXPROTECTION') {
    lines.push(nDoc(
      'maximum protection shuts the primary database down rather than allowing it to continue; Oracle recommends a minimum of two standby databases so that one standby failure cannot do that',
      ['MAXPROT.SHUTS_PRIMARY', 'MAXPROT.TWO_STANDBYS'],
    ));
  }
  lines.push(blank());

  /* ---- PrimaryDatabaseCandidates: a fast-start-failover-DISABLED fence ---- */
  const candidates = cfg.primaryDatabaseCandidates ?? [];
  if (candidates.length > 0) {
    const names = candidates.map((id) => nameOf(doc, id)).join(',');
    lines.push(cmd(
      [span("EDIT CONFIGURATION SET PROPERTY 'PrimaryDatabaseCandidates' = '"), hl(names), span("';")],
      { basis: 'documented', cite: ['FSFO.PRIMARY_DB_CANDIDATES'] },
    ));
    lines.push(nDoc(
      'while fast-start failover is disabled this list restricts SWITCHOVER and FAILOVER to its members and refuses anything else with ORA-16529; once fast-start failover is enabled it adds nothing new, because FastStartFailoverTarget already governs the target',
      ['FSFO.PRIMARY_DB_CANDIDATES', 'ORA.16529'],
    ));
    lines.push(blank());
  }

  /* ---- fast-start failover ---- */
  if (doc.observers.length === 0) {
    /* The clock properties are configuration-wide whether an observer exists
       or not. What is missing is the thing that turns them into a failover. */
    lines.push(nDoc(
      'the FastStartFailover* properties are configuration-wide and can be set, but nothing arms them without ENABLE FAST_START FAILOVER and a running observer',
      ['OBS.CANNOT_OCCUR_LIST'],
    ));
    lines.push(nDoc(
      'with no observer deployed V$DATABASE.FS_FAILOVER_STATUS simply reads DISABLED -- deploying no observer is not the same as being unobserved',
      ['FSFO.STATUS_DISABLED', 'FSFO.PRIMARY_UNOBSERVED'],
    ));
    const target = firstTargetName(doc, primary.id);
    if (target !== null) {
      lines.push(blank());
      lines.push(cmd(`FAILOVER TO ${q(target)};`,
        { basis: 'documented', cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS'] }));
      lines.push(nDoc(
        'a manual failover needs no observer while fast-start failover is disabled',
        ['FSFO.MANUAL_FAILOVER_CONDITIONS'],
      ));
    }
  } else {
    lines.push(...fsfoPropertyLines(doc, defaults));
    lines.push(...targetLines(doc, primary));
    lines.push(blank());
    lines.push(...enableAndObserverLines(doc));
  }

  /* ---- what validate had to say, verbatim ---- */
  if (findings.length > 0) {
    lines.push(blank());
    lines.push(nDoc('validation, from the same rules the issue list draws:', ['DGMGRL.BROKER_COMMANDS']));
    for (const f of findings) {
      const text = `${f.severity}: ${f.id} -- ${f.message}`;
      const claim: Claim<string> = f.note === undefined
        ? { value: text, basis: f.basis, cite: [...f.cite] }
        : { value: text, basis: f.basis, cite: [...f.cite], note: f.note };
      lines.push(note(text, claim));
    }
  }

  return file(lines);
}

const nameOf = (doc: TopologyDoc, id: MemberId): string =>
  doc.members.find((m) => m.id === id)?.name ?? (id as string);

/* ---------------- the fast-start failover properties ---------------- */

function fsfoPropertyLines(doc: TopologyDoc, defaults: (typeof BROKER_DEFAULTS)['19c']): Line[] {
  const out: Line[] = [];
  const cfg = doc.config;
  const f = cfg.fsfo;
  const v26 = cfg.edition === '26ai';

  const thresholdDefault = f.thresholdSeconds === defaults.thresholdSeconds;
  out.push(cmd(
    [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverThreshold = '),
      val(f.thresholdSeconds, thresholdDefault), span(';')],
    { basis: 'documented', cite: ['FSFO.THRESHOLD'] },
  ));
  if (thresholdDefault) out.push(nDoc('default', ['FSFO.THRESHOLD']));
  out.push(nDoc(
    'the clock starts when the observer first loses its connection to the primary, and a failover needs BOTH the observer and the target standby to have lost the primary for that long -- ObserverOverride is FALSE, the broker default, and this page models the default only',
    ['FSFO.THRESHOLD', 'FSFO.BOTH_MUST_HAVE_LOST', 'FSFO.OBSERVER_OVERRIDE_FALSE'],
  ));

  if (pingPropertiesSet(doc)) {
    out.push(cmd(
      [span('EDIT CONFIGURATION SET PROPERTY ObserverPingInterval = '), hl(String(f.pingIntervalMs)), span(';')],
      { basis: 'doc-later', cite: ['FSFO.PING_PROPS_21C'], note: 'The 19c properties reference does not list the ObserverPing* properties; they exist since 12.2, so the citation is the 21c page.' },
    ));
    out.push(cmd(
      [span('EDIT CONFIGURATION SET PROPERTY ObserverPingRetry = '), hl(String(f.pingRetry)), span(';')],
      { basis: 'doc-later', cite: ['FSFO.PING_PROPS_21C'], note: 'Same page as ObserverPingInterval.' },
    ));
    out.push(nDoc(
      'with both properties explicitly set, the threshold above is ignored for the observer\'s detection',
      ['FSFO.PING_PROPS_21C', 'FSFO.PING_NEARLY_ONE_SECOND'],
    ));
    const d = detectClaim(doc);
    out.push(note(
      `this page models the detection time as ${f.pingIntervalMs} ms x (${f.pingRetry} + 1) = ${d.value} s -- the documentation says only that detection can be reduced to nearly 1 second`,
      d.note === undefined
        ? { value: 'detection', basis: d.basis, cite: [...d.cite] }
        : { value: 'detection', basis: d.basis, cite: [...d.cite], note: d.note },
    ));
    out.push(nDoc(
      'the isolated primary\'s own stall clock still runs on the threshold',
      ['FSFO.PMY_SHUTDOWN'],
    ));
    if (v26) {
      out.push(nLater(
        'the 26ai property pages give both broker defaults as 0 -- not set -- while the 26ai fast-start failover chapter\'s table still shows 100 ms and 10; the explicitly-set minimums stay 100 ms and 10 in every edition',
        ['FSFO.PING_DEFAULTS_26AI_ZERO', 'FSFO.PING_DEFAULTS_26AI_TABLE'],
        '26ai disagrees with itself about the defaults; never write "defaults identical in 26ai" unqualified.',
      ));
    }
  } else {
    out.push(nDoc(
      'ObserverPingInterval and ObserverPingRetry stay unset -- detection runs on the threshold',
      ['FSFO.PING_PROPS_21C'],
    ));
  }

  /* The lag limit, whose protection-mode story changed in 26ai. */
  const mode = cfg.protectionMode;
  if (mode === 'MAXAVAILABILITY' && !v26) {
    out.push(nDoc(
      'FastStartFailoverLagLimit is not evaluated in maximum availability under 19c -- the standby must be synchronized instead, which is about redo received, so an apply lag does not block it',
      LAG_LIMIT_MODE_CITES,
    ));
  } else if (mode === 'MAXAVAILABILITY') {
    const dflt = defaultLagLimit('26ai', 'MAXAVAILABILITY');
    out.push(cmd(
      [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagLimit = '),
        val(f.lagLimitSeconds, f.lagLimitSeconds === dflt), span(';')],
      { basis: 'documented', cite: LAG_LIMIT_MODE_CITES },
    ));
    out.push(nDoc(
      f.lagLimitSeconds === 0
        ? '0 is the maximum availability default in 26ai: the standby must have received every change, so the failover loses nothing -- V$FAST_START_FAILOVER_CONFIG names that ZERO DATA LOSS'
        : 'non-zero in maximum availability: fast-start failover is permitted while the lag is at or below the limit and loses at most that much -- POTENTIAL DATA LOSS',
      LAG_LIMIT_MODE_CITES,
    ));
  } else if (mode === 'MAXPERFORMANCE') {
    const isDefault = f.lagLimitSeconds === defaults.lagLimitSeconds;
    out.push(cmd(
      [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagLimit = '),
        val(f.lagLimitSeconds, isDefault), span(';')],
      { basis: 'documented', cite: ['FSFO.LAGLIMIT_RANGES'] },
    ));
    if (isDefault) out.push(nDoc('default', ['FSFO.LAGLIMIT_RANGES']));
    if (f.lagLimitSeconds > f.thresholdSeconds) {
      out.push(nDoc(
        'Oracle recommends FastStartFailoverLagLimit at or below FastStartFailoverThreshold: past it the old primary can keep committing after a fast-start failover is initiated, briefly risking two primaries',
        ['FSFO.LAGLIMIT_RECOMMENDATION'],
      ));
    }
    if (v26) {
      const typeDefault = f.lagType === defaults.lagType;
      out.push(cmd(
        [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagType = '),
          val(f.lagType, typeDefault), span(';')],
        { basis: 'documented', cite: ['FSFO.LAGTYPE'] },
      ));
      out.push(cmd(
        [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagGraceTime = '),
          val(f.lagGraceTimeSeconds, f.lagGraceTimeSeconds === defaults.lagGraceTimeSeconds), span(';')],
        { basis: 'documented', cite: ['FSFO.LAGGRACETIME'] },
      ));
      out.push(nDoc(
        f.lagGraceTimeSeconds > 0
          ? 'permission is asked that many seconds before the limit, so the primary already holds it when the lag crosses; the LAGGING permission is granted by the observer or the target standby'
          : 'FastStartFailoverLagGraceTime stays 0 -- the primary asks permission at the crossing and waits for the answer; the LAGGING permission is granted by the observer or the target standby',
        ['FSFO.LAGGRACETIME'],
      ));
      out.push(nDoc(
        'FastStartFailoverLagType and FastStartFailoverLagGraceTime stay documented as maximum-performance-mode behaviour whatever the lag limit is doing in maximum availability',
        ['FSFO.LAGTYPE', 'FSFO.LAGGRACETIME'],
      ));
    }
  } else if (!lagGated(doc)) {
    out.push(nDoc(
      'the readiness check in maximum protection is that the standby is synchronized, so the lag limit is not evaluated',
      LAG_LIMIT_MODE_CITES,
    ));
  }

  out.push(cmd(
    [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverPmyShutdown = '),
      val(f.pmyShutdown ? 'TRUE' : 'FALSE', f.pmyShutdown === defaults.pmyShutdown), span(';')],
    { basis: 'documented', cite: ['FSFO.PMY_SHUTDOWN'] },
  ));
  if (f.pmyShutdown === defaults.pmyShutdown) out.push(nDoc('default', ['FSFO.PMY_SHUTDOWN']));
  if (f.pmyShutdown) {
    out.push(nDoc(
      'TRUE is the default: a primary stalled longer than the threshold, able to reach neither the observer nor the target standby, aborts itself',
      ['FSFO.PMY_SHUTDOWN', 'OBS.LOSS_ALONE_STALLS_NOTHING'],
    ));
  }

  out.push(cmd(
    [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverAutoReinstate = '),
      val(f.autoReinstate ? 'TRUE' : 'FALSE', f.autoReinstate === defaults.autoReinstate), span(';')],
    { basis: 'documented', cite: ['FSFO.AUTO_REINSTATE'] },
  ));
  if (f.autoReinstate) {
    out.push(nDoc(
      'it reinstates only after an observer-initiated failover caused by a primary crash or isolation -- never after a user-configurable health condition or a DBMS_DG.INITIATE_FS_FAILOVER call -- and it needs Flashback Database on both databases, the former primary started and mounted, and the master observer able to reach it',
      ['FSFO.AUTO_REINSTATE'],
    ));
  }

  if (f.observerReconnectSeconds !== undefined) {
    out.push(cmd(
      [span('EDIT CONFIGURATION SET PROPERTY ObserverReconnect = '), hl(String(f.observerReconnectSeconds)), span(';')],
      { basis: 'documented', cite: ['OBS.OBSERVER_ORA'] },
    ));
  }

  const preferred = f.preferredObserverHosts ?? [];
  if (preferred.length > 0) {
    const value = preferred.map((p) => `${p.host as string}:${p.priority}`).join(',');
    out.push(cmd(
      [span("EDIT CONFIGURATION SET PROPERTY PreferredObserverHosts = '"), hl(value), span("';")],
      { basis: 'documented', cite: ['OBS.PREFERRED_HOSTS'] },
    ));
    out.push(nDoc(
      'only observers running on the hosts specified will observe databases and become the master observer; priority runs 1 to 8, lower wins, and the default is 8',
      ['OBS.PREFERRED_HOSTS'],
    ));
  }

  return out;
}

/* ---------------- FastStartFailoverTarget ---------------- */

function firstTargetName(doc: TopologyDoc, primary: MemberId): string | null {
  const t = doc.config.fsfo.target;
  const ids = t.kind === 'list'
    ? t.members
    : doc.members.filter((m) => m.id !== primary && isDatabase(m)).map((m) => m.id);
  const first = ids[0];
  return first === undefined ? null : nameOf(doc, first);
}

function targetLines(doc: TopologyDoc, primary: Member): Line[] {
  const out: Line[] = [];
  const t = doc.config.fsfo.target;
  const standbys = doc.members.filter((m) => isDatabase(m) && m.id !== primary.id);

  if (t.kind === 'ANY') {
    out.push(cmd(
      [span(`EDIT DATABASE ${q(primary.name)} SET PROPERTY 'FastStartFailoverTarget' = '`), hl('ANY'), span("';")],
      { basis: 'documented', cite: ['FSFO.TARGET_ORDER', 'FSFO.TARGET_KIND'] },
    ));
  } else {
    const names = t.members.map((id) => nameOf(doc, id)).join(',');
    out.push(cmd(
      [span(`EDIT DATABASE ${q(primary.name)} SET PROPERTY 'FastStartFailoverTarget' = '`), hl(names), span("';")],
      { basis: 'documented', cite: ['FSFO.TARGET_ORDER', 'FSFO.TARGET_KIND'] },
    ));
    if (t.members.length > 1) {
      out.push(nDoc(
        'candidate targets: the broker selects a target based on the order in which they are specified, and if the designated fast-start failover target develops a problem the broker automatically changes the target to one of the other candidate targets',
        ['FSFO.TARGET_ORDER', 'FSFO.TARGET_AUTO_CHANGE'],
      ));
      out.push(nLater(
        'more than one fast-start failover target is a 12.2 feature',
        ['FSFO.MULTI_TARGET_12_2'],
        'Documented in the 12.2 release changes rather than in 19c.',
      ));
    }
    if (standbys.length > 1) {
      out.push(nDoc(
        'with more than one standby database the property must be set explicitly',
        ['FSFO.TARGET_MUST_BE_EXPLICIT'],
      ));
    }
  }
  out.push(nDoc(
    'the target can only be the name of a physical or logical standby -- never a snapshot standby, a far sync instance or a Zero Data Loss Recovery Appliance -- and it must receive redo directly from the primary database; receiving it from a far sync instance is the sanctioned exception',
    ['FSFO.TARGET_KIND', 'FSFO.TARGET_DIRECT_REDO', 'FSFO.TARGET_NOT_FARSYNC'],
  ));
  out.push(nDoc(
    'targets are verified when fast-start failover is enabled, and the reciprocal value is set on the target automatically',
    ['FSFO.TARGET_VERIFIED_ON_ENABLE'],
  ));
  return out;
}

/* ---------------- ENABLE and the observers ---------------- */

function enableAndObserverLines(doc: TopologyDoc): Line[] {
  const out: Line[] = [];
  const f = doc.config.fsfo;

  if (f.state === 'observe-only') {
    out.push(cmd('ENABLE FAST_START FAILOVER OBSERVE ONLY;',
      { basis: 'documented', cite: ['OBS.OBSERVE_ONLY'] }));
    out.push(nDoc(
      'an observer in observe-only mode never fails over -- "Unable to failover since this observer is in observe-only mode"; the primary may open without an acknowledgement, and switchover or failover to a bystander stays allowed',
      ['OBS.OBSERVE_ONLY'],
    ));
  } else if (f.state === 'enabled') {
    out.push(cmd('ENABLE FAST_START FAILOVER;',
      { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS'] }));
  } else {
    out.push(nDoc(
      'fast-start failover is disabled in this document, so ENABLE FAST_START FAILOVER is not issued: the properties above are set and nothing arms them',
      ['OBS.CANNOT_OCCUR_LIST'],
    ));
  }
  out.push(blank());

  /* Each observer is a DGMGRL session of its own, on a host of its own. */
  for (const o of doc.observers) {
    const parts = [`START OBSERVER ${o.name}`];
    if (o.fileIs !== undefined) parts.push(`FILE IS ${o.fileIs}`);
    if (o.logfileIs !== undefined) parts.push(`LOGFILE IS ${o.logfileIs}`);
    if (o.connectIdentifier !== undefined) parts.push(`CONNECT IDENTIFIER IS ${o.connectIdentifier}`);
    parts.push('IN BACKGROUND');
    out.push(cmd(`${parts.join(' ')};`, { basis: 'documented', cite: ['OBS.START_FILE_IS'] }));
    if (o.fileIs === undefined) {
      out.push(nDoc(
        'FILE IS and LOGFILE IS name the observer\'s files -- the syntax is FILE IS, never FILE=',
        ['OBS.START_FILE_IS'],
      ));
    }
  }
  if (doc.observers.length > 0) {
    out.push(nDoc(
      'IN BACKGROUND is the form the documentation prefers: the prompt returns and the observer process keeps running',
      ['OBS.START_FILE_IS'],
    ));
    out.push(nDoc(
      'the observer belongs on a host of its own, ideally at a third site or third data center -- it should never be deployed at the primary database server or cluster, or on the standby database server or cluster',
      ['OBS.PLACEMENT_NEVER_ON_DB_HOST', 'OBS.PLACEMENT_THIRD_SITE'],
    ));
  }

  const master = doc.observers.find((o) => o.role === 'master');
  if (master && doc.observers.length > 1) {
    out.push(blank());
    out.push(cmd(`SET MASTEROBSERVER TO ${master.name};`,
      { basis: 'documented', cite: ['OBS.SET_MASTEROBSERVER'] }));
    out.push(nDoc(
      'only the master observer can coordinate fast-start failover; if the primary and target standby databases stay connected but the connection to the master observer is lost, then the broker tries to nominate a backup observer as the new master observer',
      ['OBS.MASTER_ONLY_COORDINATES', 'OBS.NOMINATION_PRECONDITION'],
    ));
    out.push(nModel(
      'the command is documented; what has to be true for it to succeed is not',
      'SET MASTEROBSERVER TO is documented as a command, but its preconditions are not, so this page states none.',
      ['OBS.SET_MASTEROBSERVER'],
    ));
  } else if (doc.observers.length > 1) {
    out.push(nLater(
      'no observer is named master here; when fast-start failover is disabled no observer is called the master observer and all observers have the same functionality',
      ['OBS.NO_MASTER_WHEN_DISABLED'],
      'Stated in an edition later than 19c.',
    ));
  }
  return out;
}
