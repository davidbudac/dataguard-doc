/**
 * The DGMGRL script -- engine design SS7.
 *
 * One broker session that builds the configuration the document describes, in
 * the order the documentation builds one: create, add the members, set the
 * per-member transport and routing properties, enable, choose the protection
 * mode, set the fast-start failover properties, arm it, start the observers.
 *
 * The card is a transcript; its commentary renders as DGMGRL's own documented
 * comment syntax (`-- text;`, DGMGRL.COMMENT_SYNTAX) when copied or exported --
 * see `commentText` in `lines.ts`. Three traps the golden tests pin:
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
import { BROKER_DEFAULTS, defaultLagLimit, lagLimitIsSet, lagLimitOf } from '../defaults';
import type { MemberId } from '../ids';
import { formatRedoRoutes, isParenthesised } from '../redo/parse';
import { activeRule, resolveRedoGraph } from '../redo/resolve';
import { defaultDestProps } from '../serialize/schema';
import { detectClaim, pingPropertiesSet } from '../sim/fsfo';
import type { Claim, Finding } from '../types/claims';
import { conflict, docLater, documented, inferred, model } from '../types/claims';
import type { DestProps, Member, TopologyDoc } from '../types/topology';
import type { RedoGraph } from '../types/trace';
import { declaredPrimary, isDatabase, isFarSync, isRac } from '../types/topology';
import { isMultiInstanceApply } from '../sim/rac';
import type { GeneratedFile, Line, Span } from './lines';
import { blank, cmd, comment, hl, note, span } from './lines';

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
const nInferred = (text: string, why: string, cite: CitationId[] = []): Line =>
  note(text, inferred(text, cite, why));

export function generateDgmgrl(doc: TopologyDoc, opts: DgmgrlOptions = {}): GeneratedFile {
  const lines: Line[] = [];
  if (doc.members.some(m => m.routesObserved)) {
    lines.push(nModel('Imported SQL snapshot: this is not a recovered broker configuration. Review all generated commands before use.',
      'Only current collected routes are known. Empty observed routes suppress simulator defaults, but cannot express an empty broker RedoRoutes policy; future-role routes and uncollected settings need manual review.'));
  }
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
  /* Every member named as a destination inside a parenthesised RedoRoutes
     group, from any sender: the broker default for MaxFailure is 1 there,
     0 for a destination outside any group (DEST.MAX_FAILURE). */
  const grouped = groupedDestinationIds(doc);

  /* ---- what the script assumes and does not write (GEN-25) ---- */
  const identifiers = [...new Set(members.map((m) => m.connectIdentifier))].join(', ');
  lines.push(nDoc(
    `before the session: the connect identifiers used below (${identifiers}) are Oracle Net names this script does not define -- each must be a tns alias that resolves to a connect identifier for its member on all systems hosting members of the configuration`,
    ['DGMGRL.TNS_ALIAS_ASSUMED'],
  ));
  lines.push(nDoc(
    'before the session: no remote redo transport destination may be left set on a standby database or far sync instance that is about to be added -- clear any LOG_ARCHIVE_DEST_n that ships redo remotely first',
    ['DGMGRL.CLEAR_REMOTE_DESTS'],
  ));
  lines.push(nDoc(
    'before the transport and protection-mode commands: standby redo logs must be configured on the primary and the target standbys (the broker does not let those commands succeed without them), and DG_BROKER_START must be set to TRUE on each database or the broker does not start',
    ['DGMGRL.SRL_BEFORE_ENABLE', 'DGMGRL.BROKER_START'],
  ));
  lines.push(blank());

  /* ---- the session ---- */
  lines.push(cmd(`CONNECT sys@${primary.connectIdentifier} AS SYSDBA;`,
    { basis: 'documented', cite: ['DGMGRL.CONNECT'] }));
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
  /* The primary carries one too. LogXptMode is a property of the member that
     RECEIVES redo (the broker propagates it to the sender's destination), so
     the primary's value takes effect once a role change makes it a receiver. */
  lines.push(cmd(
    [span(`${editOf(primary)} SET PROPERTY 'LogXptMode' = '`),
      val(primary.logXptMode, primary.logXptMode === defaults.logXptMode), span("';")],
    { basis: 'documented', cite: ['XPT.LOGXPTMODE_VALUES'] },
  ));
  lines.push(nDoc(
    `${primary.name} is the primary now, so its LogXptMode governs nothing yet: it takes effect once a role change makes ${primary.name} a standby, and then applies to the redo the new primary ships to it -- unless a RedoRoutes rule on that sender names a transport mode, which overrides it`,
    ['XPT.LOGXPTMODE_RECEIVER'],
  ));
  if (farSyncs.length > 0 && fsfo.state !== 'disabled') {
    lines.push(nDoc(
      'to use a far sync instance with fast-start failover the far sync transport mode must be SYNC or FASTSYNC and the target standby transport mode must be ASYNC',
      ['FSFO.FARSYNC_XPT'],
    ));
  }
  lines.push(blank());

  /* ---- RAC: the apply instance of a standby (facts.md F2-F4) ---- */
  const racDbs = members.filter((m) => isDatabase(m) && isRac(m)
    && m.role !== 'snapshot'
    && (m.id !== primary.id || m.preferredApplyInstance !== undefined));
  for (const m of racDbs) {
    if (!isDatabase(m)) continue;
    const preferred = m.preferredApplyInstance;
    if (preferred !== undefined) {
      lines.push(cmd(
        [span(`${editOf(m)} SET PROPERTY 'PreferredApplyInstance' = '`), hl(preferred), span("';")],
        { basis: 'documented', cite: ['RAC.PREFERRED_APPLY_INSTANCE'] },
      ));
      if (m.id === primary.id) {
        lines.push(nDoc(
          `${m.name} is the primary: the property is only used while it is a standby, and names its apply instance for after a switchover`,
          ['RAC.PREFERRED_APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_SELECTION'],
        ));
      }
    } else {
      lines.push(nDoc(
        `${m.name} runs ${m.instances.length} instances and PreferredApplyInstance is empty (the default): the broker picks the apply instance`,
        ['RAC.PREFERRED_APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_SELECTION'],
      ));
    }
    /* ApplyInstances is a physical standby property; a primary carries it for
       when it runs as one. */
    if (m.applyInstances !== undefined && (m.role === 'physical' || m.role === 'primary')) {
      lines.push(cmd(
        [span(`${editOf(m)} SET PROPERTY 'ApplyInstances' = `), hl(String(m.applyInstances)), span(';')],
        { basis: 'documented', cite: ['RAC.APPLY_INSTANCES_PROPERTY', 'RAC.MULTI_INSTANCE_APPLY'] },
      ));
    }
    const timeout = m.applyInstanceTimeoutSeconds ?? 0;
    if (timeout > 0) {
      lines.push(cmd(
        [span(`${editOf(m)} SET PROPERTY 'ApplyInstanceTimeout' = `), hl(String(timeout)), span(';')],
        { basis: 'documented', cite: ['RAC.APPLY_INSTANCE_TIMEOUT'] },
      ));
    }
  }
  if (racDbs.length > 0) {
    const mira = racDbs.some((m) => isDatabase(m) && isMultiInstanceApply(m));
    lines.push(nDoc(
      mira
        ? 'with ApplyInstances above 1 Redo Apply runs on several instances, one of them the coordinator, which the broker treats as the apply instance; if the apply instance fails the broker restarts the coordinator on another running instance after ApplyInstanceTimeout (default 0, immediate). To move it by hand: EDIT DATABASE ... SET STATE=\'APPLY-ON\' WITH APPLY INSTANCE=\'name\';'
        : 'apply runs on one instance of a RAC standby, the apply instance; if it fails the broker restarts apply on another running instance after ApplyInstanceTimeout (default 0, immediate). To move it by hand: EDIT DATABASE ... SET STATE=\'APPLY-ON\' WITH APPLY INSTANCE=\'name\';',
      mira
        ? ['RAC.MULTI_INSTANCE_APPLY', 'RAC.APPLY_INSTANCE_TIMEOUT', 'RAC.SET_APPLY_INSTANCE']
        : ['RAC.APPLY_INSTANCE', 'RAC.APPLY_INSTANCE_TIMEOUT', 'RAC.SET_APPLY_INSTANCE'],
    ));
    lines.push(blank());
  }

  /* ---- static services, where a RAC database is in the configuration ---- */
  const anyRac = members.some((m) => isDatabase(m) && isRac(m));
  if (anyRac) {
    /* TXT-15: the 26ai broker guide words the rule for "configurations where
       Oracle Clusterware or Oracle Restart are not being used", with no
       "only"; the 19c sentence says a static service is defined and
       registered only if they are not. */
    const staticRule = cfg.edition === '26ai'
      ? 'for configurations where Oracle Clusterware or Oracle Restart are not being used, a static service must be registered with the local listener associated with each instance'
      : 'one is defined and registered only if Oracle Clusterware or Oracle Restart is not being used';
    const staticCite: CitationId = cfg.edition === '26ai'
      ? 'RAC.STATIC_SERVICE_26AI' : 'RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE';
    for (const m of members) {
      if (!isDatabase(m)) continue;
      if (isRac(m)) {
        lines.push(nDoc(
          `${m.name} is RAC and runs under Oracle Clusterware, so it needs no static service: ${staticRule}`,
          [staticCite, 'RAC.CLUSTERWARE_REQUIRED'],
        ));
      } else if (!m.staticServices) {
        lines.push(nDoc(
          `${m.name} is a single instance: unless Oracle Restart manages it, register the static service ${m.name}_DGMGRL with its listener so DGMGRL and the observer can restart it`,
          [staticCite],
        ));
      }
    }
    lines.push(blank());
  }

  /* ---- RedoRoutes, pre-declared in both directions ---- */
  const routed = members.filter((m) => m.redoRoutes.length > 0);
  if (routed.length > 0) {
    for (const m of routed) {
      /* The 19c / 26ai grammar has groups and PRIORITY; only the 12.1 ALT=(...)
         form is the 12.1 grammar's (TXT-23). */
      const hasAlt = m.redoRoutes.some((r) => r.groups.some((g) => g.dests.some((d) => d.alt !== undefined)));
      lines.push(cmd(
        [span(`${editOf(m)} SET PROPERTY 'RedoRoutes' = '`),
          hl(formatRedoRoutes(m.redoRoutes)), span("';")],
        { basis: 'documented', cite: hasAlt
          ? ['ROUTES.GRAMMAR_19C', 'ROUTES.GRAMMAR_121', 'ROUTES.CANONICAL_PAIR']
          : ['ROUTES.GRAMMAR_19C', 'ROUTES.CANONICAL_PAIR'] },
      ));
    }
    /* "Pre-declared for both directions" is only true when some member holds a
       rule that is not the active one under the current primary (GEN-17): the
       far sync's reverse rule, the standby's LOCAL rule. */
    const reverseDeclared = routed.some((m) => {
      const act = activeRule(m, primary.id);
      return m.redoRoutes.some((r) => r !== act?.rule);
    });
    if (reverseDeclared) {
      lines.push(nDoc(
        'the routes are pre-declared for both directions: a rule is active when its redo source names the current primary, and nothing rewrites on a role change',
        ['FS.ROUTES_BOTH_DIRECTIONS', 'ROUTES.RULE_ACTIVE'],
      ));
    } else {
      lines.push(nDoc(
        `only the routes for ${primary.name} as primary are declared: a rule is active when its redo source names the current primary, and SHOW CONFIGURATION WHEN PRIMARY IS lists any member a role change would leave without redo under Members Not Receiving Redo`,
        ['ROUTES.RULE_ACTIVE', 'DGMGRL.SHOW_WHEN_PRIMARY_IS', 'DGMGRL.MEMBERS_NOT_RECEIVING_REDO'],
      ));
    }
    if (routed.some((m) => m.redoRoutes.some((r) => r.groups.some((g) => g.dests.some((d) => d.priority !== undefined))))) {
      lines.push(nInferred(
        'PRIORITY is RedoRoutes syntax; GROUP is not -- GROUP is a LOG_ARCHIVE_DEST_n attribute and appears in the init.ora block instead',
        'An inference from two pages, not a sentence on either: the LOG_ARCHIVE_DEST_n attributes page documents GROUP and PRIORITY, and the Redo Routing Rules grammar has PRIORITY=n and no GROUP keyword.',
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

  /* ---- NetTimeout, ReopenSecs, MaxFailure: properties of the receiving
     member -- "The properties used are: Binding, MaxFailure, NetTimeout,
     RedoCompression, and ReopenSecs" (DEST.BROKER_OWNED_PROPERTIES). The
     broker writes these into the NET_TIMEOUT / REOPEN / MAX_FAILURE
     attributes of the LOG_ARCHIVE_DEST_n it manages; init.ora shows where
     they land, but this script is what sets them. ---- */
  const netTimeouts: Array<{
    m: Member; d: DestProps; sender: Member; differing: Member[];
  }> = [];
  for (const m of members) {
    const fed = members.flatMap((sender) => {
      const d = sender.dests[m.id];
      return d === undefined ? [] : [{ sender, d }];
    });
    const first = fed[0];
    if (first === undefined) continue;
    /* One receiving member carries one value of each: the broker propagates it
       to the sending side's destination (GEN-21). */
    const differing = fed.slice(1).filter((o) => o.d.netTimeoutSeconds !== first.d.netTimeoutSeconds
      || o.d.reopenSeconds !== first.d.reopenSeconds || o.d.maxFailure !== first.d.maxFailure)
      .map((o) => o.sender);
    netTimeouts.push({ m, d: first.d, sender: first.sender, differing });
  }
  if (netTimeouts.length > 0) {
    for (const { m, d, sender, differing } of netTimeouts) {
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

      /* The broker default for MaxFailure is 1 inside a parenthesised
         RedoRoutes group, 0 otherwise (DEST.MAX_FAILURE); ReopenSecs is 300
         regardless. Only a non-default value is set explicitly. */
      const brokerDefault = defaultDestProps({ inGroup: grouped.has(m.id as string) });
      if (d.reopenSeconds !== brokerDefault.reopenSeconds) {
        lines.push(cmd(
          [span(`${editOf(m)} SET PROPERTY 'ReopenSecs' = `), hl(String(d.reopenSeconds)), span(';')],
          { basis: 'documented', cite: ['DEST.REOPEN', 'DEST.BROKER_OWNED_PROPERTIES'] },
        ));
      }
      if (d.maxFailure !== brokerDefault.maxFailure) {
        if (isFarSync(m)) {
          /* GEN-20: Oracle's own page disagrees about whether a far sync
             instance carries MaxFailure, so no EDIT FAR_SYNC line is written. */
          const text = `MaxFailure = ${d.maxFailure} is set for the destination to ${m.name}, a far sync instance, and no EDIT FAR_SYNC line is written for it: the MaxFailure property's Role row lists a standby database and a Recovery Appliance, not a far sync instance, while its footnote says the property is set for a standby database or far sync instance`;
          lines.push(note(text, conflict(text, ['DEST.MAX_FAILURE', 'DEST.MAXFAILURE_ROLE_FARSYNC'],
            'The 19c MaxFailure row and its own footnote disagree about far sync instances; the other per-receiver properties (ReopenSecs, NetTimeout) do list them. The init.ora block still shows MAX_FAILURE for the destination.')));
        } else {
          lines.push(cmd(
            [span(`${editOf(m)} SET PROPERTY 'MaxFailure' = `), hl(String(d.maxFailure)), span(';')],
            { basis: 'documented', cite: ['DEST.MAX_FAILURE', 'DEST.BROKER_OWNED_PROPERTIES'] },
          ));
          lines.push(nDoc(
            `the broker default is ${brokerDefault.maxFailure} here -- 1 for a member inside a parenthesised RedoRoutes group, 0 otherwise`,
            ['DEST.MAX_FAILURE'],
          ));
        }
      }
      if (differing.length > 0) {
        lines.push(nInferred(
          `${m.name} receives from ${[sender, ...differing].map((x) => x.name).join(' and ')} with different NetTimeout, ReopenSecs or MaxFailure values, but each is a single property of the receiving member: the lines above use ${sender.name}'s, and the init.ora cards show each sender's own`,
          'The footnote says the broker propagates the setting specified on the receiving member to the sending side; that one member therefore cannot hold two values for two senders is this page\'s reading, not a sentence.',
          ['XPT.LOGXPTMODE_RECEIVER'],
        ));
      }
    }
    lines.push(nDoc(
      'ReopenSecs and MaxFailure are broker properties, not deprecated in any edition; the lines above set them where they differ from the broker default, and the init.ora block shows the REOPEN and MAX_FAILURE attributes they write',
      ['DEST.BROKER_OWNED_PROPERTIES', 'DEST.DEPRECATED_19C'],
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
  if (cfg.protectionMode === 'MAXPROTECTION') {
    /* "Upgrading from MAXPERFORMANCE to MAXPROTECTION is not allowed. You
       must first go to MAXAVAILABILITY and then to MAXPROTECTION." A new
       configuration starts at MAXPERFORMANCE, so a document asking for
       MAXPROTECTION always needs both steps. */
    lines.push(cmd('EDIT CONFIGURATION SET PROTECTION MODE AS MAXAVAILABILITY;',
      { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS', 'XPT.TABLE_4_2'] }));
    lines.push(nDoc(
      'a new configuration cannot go straight to maximum protection: it must go to maximum availability first',
      ['DGMGRL.MAXPROT_STAGED'],
    ));
    lines.push(cmd(
      [span('EDIT CONFIGURATION SET PROTECTION MODE AS '), hl('MAXPROTECTION'), span(';')],
      { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS', 'XPT.TABLE_4_2'] },
    ));
  } else {
    lines.push(cmd(
      [span('EDIT CONFIGURATION SET PROTECTION MODE AS '),
        val(cfg.protectionMode, cfg.protectionMode === defaults.protectionMode), span(';')],
      { basis: 'documented', cite: ['DGMGRL.BROKER_COMMANDS', 'XPT.TABLE_4_2'] },
    ));
  }
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

  /* ---- configuration properties the inspector offers (GEN-16): written only
     when they differ from the broker default ---- */
  const cfgProperties: Line[] = [];
  if (cfg.bystandersFollowRoleChange !== defaults.bystandersFollowRoleChange) {
    cfgProperties.push(cmd(
      [span("EDIT CONFIGURATION SET PROPERTY 'BystandersFollowRoleChange' = '"),
        hl(cfg.bystandersFollowRoleChange), span("';")],
      { basis: 'documented', cite: ['BYSTANDERS.DEFAULT_ALL', 'BYSTANDERS.NONE_DISABLED'] },
    ));
    cfgProperties.push(nDoc(
      'NONE: the broker does not evaluate the bystander standbys as part of a failover, it marks them disabled with a status of ORA-16661 so that they can be evaluated later, and they have to be reinstated afterwards',
      ['BYSTANDERS.NONE_DISABLED'],
    ));
  }
  const wideService = cfg.configurationWideServiceName;
  if (wideService !== undefined && wideService !== '') {
    cfgProperties.push(cmd(
      [span("EDIT CONFIGURATION SET PROPERTY 'ConfigurationWideServiceName' = '"), hl(wideService), span("';")],
      { basis: 'documented', cite: ['CFG.WIDE_SERVICE_NAME'] },
    ));
    cfgProperties.push(nDoc(
      'the default service name of the configuration-wide service is primarydbname_CFG, and the service name does not change after a role transition',
      ['CFG.WIDE_SERVICE_NAME'],
    ));
  }
  if (cfgProperties.length > 0) {
    lines.push(...cfgProperties);
    lines.push(blank());
  }

  /* ---- PrimaryDatabaseCandidates: a fast-start-failover-DISABLED fence ---- */
  const candidates = cfg.primaryDatabaseCandidates ?? [];
  if (candidates.length > 0) {
    const names = candidates.map((id) => nameOf(doc, id)).join(',');
    /* GEN-22: absent from the whole 19c and 21c property pages -- documented
       from 26ai, observed on a live 19.27 system. */
    lines.push(cmd(
      [span("EDIT CONFIGURATION SET PROPERTY 'PrimaryDatabaseCandidates' = '"), hl(names), span("';")],
      cfg.edition === '19c'
        ? {
          basis: 'doc-later', cite: ['FSFO.PRIMARY_DB_CANDIDATES'],
          note: 'Documented from 26ai: the 19c and 21c broker properties pages do not list PrimaryDatabaseCandidates. A live 19.27 system carries the property, which is an observation, not documentation.',
        }
        : { basis: 'documented', cite: ['FSFO.PRIMARY_DB_CANDIDATES'] },
    ));
    lines.push(nDoc(
      'while fast-start failover is disabled this list restricts SWITCHOVER and FAILOVER to its members and refuses anything else with ORA-16529; once fast-start failover is enabled it adds nothing new, because FastStartFailoverTarget already governs the target',
      ['FSFO.PRIMARY_DB_CANDIDATES', 'ORA.16529'],
    ));
    lines.push(blank());
  }

  /* ---- fast-start failover ---- */
  /* GEN-15: no observer deployed AND fast-start failover disabled is the only
     case in which nothing is armed. Enabled with no observer started is legal
     ("If you do not start the observer after you have enabled fast-start
     failover, the ORA-16819 warning is displayed"), so the script keeps
     ENABLE FAST_START FAILOVER and every property, and says what follows. */
  if (doc.observers.length === 0 && fsfo.state === 'disabled') {
    /* The clock properties are configuration-wide whether an observer exists
       or not. What is missing is the thing that turns them into a failover. */
    lines.push(nDoc(
      'the FastStartFailover* properties are configuration-wide and can be set, but nothing arms them without ENABLE FAST_START FAILOVER and a running observer',
      ['OBS.CANNOT_OCCUR_LIST'],
    ));
    lines.push(nDoc(
      /* ED-06: 26ai deprecates the V$DATABASE.FS_FAILOVER_* columns in favour
         of V$FAST_START_FAILOVER_CONFIG. */
      cfg.edition === '26ai'
        ? 'with fast-start failover disabled and no observer deployed V$FAST_START_FAILOVER_CONFIG simply reads DISABLED -- deploying no observer is not the same as being unobserved'
        : 'with fast-start failover disabled and no observer deployed V$DATABASE.FS_FAILOVER_STATUS simply reads DISABLED -- deploying no observer is not the same as being unobserved',
      cfg.edition === '26ai'
        ? ['FSFO.FS_FAILOVER_CONFIG_26AI', 'FSFO.PRIMARY_UNOBSERVED']
        : ['FSFO.STATUS_DISABLED', 'FSFO.PRIMARY_UNOBSERVED'],
    ));
    const target = firstTargetName(doc, primary.id);
    if (target !== null) {
      lines.push(blank());
      lines.push(nDoc(
        'a manual failover needs no observer while fast-start failover is disabled -- issue it only once the primary has actually failed, and before issuing it verify that you are connected to the standby database that will become the new primary',
        ['FSFO.MANUAL_FAILOVER_CONDITIONS', 'DGMGRL.FAILOVER_CONNECT_STANDBY'],
      ));
      /* Runbook text, not a line of the build script: FAILOVER is destructive
         and only makes sense once the primary is actually down. */
      lines.push(comment(`FAILOVER TO ${q(target)}`,
        { basis: 'documented', cite: ['FSFO.MANUAL_FAILOVER_CONDITIONS'] }));
    }
  } else {
    lines.push(...fsfoPropertyLines(doc, defaults));
    lines.push(...targetLines(doc, primary, graph));
    lines.push(blank());
    lines.push(...enableAndObserverLines(doc, primary));
    if (doc.observers.length === 0) {
      lines.push(blank());
      lines.push(nDoc(
        'no observer is deployed in this document, so no START OBSERVER line follows: enabling fast-start failover without starting one is legal, the broker then displays the ORA-16819 warning for the primary and the target standby databases (Database Status WARNING), and fast-start failover cannot happen until an observer is started',
        ['OBS.NOT_STARTED_16819', 'ORA.16819', 'OBS.CANNOT_OCCUR_LIST'],
      ));
    }
  }

  /* ---- role-based services (GEN-29) ---- */
  const services = cfg.services.filter((sv) => sv.members.some((id) => {
    const m = members.find((x) => x.id === id);
    return m !== undefined && isDatabase(m);
  }));
  if (services.length > 0) {
    lines.push(blank());
    lines.push(nDoc(
      'role-based services are created outside DGMGRL, with SRVCTL, explicitly on each database where the service must be active -- on Oracle RAC or on a single instance managed by Oracle Restart; the lines below are runbook text for a shell on each database host, and the options after -role are yours',
      ['SERVICE.SRVCTL_PER_DATABASE', 'SERVICE.ROLE_BASED_PLATFORMS'],
    ));
    for (const sv of services) {
      for (const id of sv.members) {
        const m = members.find((x) => x.id === id);
        if (m === undefined || !isDatabase(m)) continue;
        lines.push(comment(`srvctl add service -db ${m.name} -service ${sv.name} -role ${sv.role} ...`,
          { basis: 'documented', cite: ['SERVICE.SRVCTL_PER_DATABASE'] }));
      }
    }
    lines.push(nDoc(
      'all SRVCTL add service options must be identical on all the databases so that the services behave the same way before and after a role change',
      ['SERVICE.SRVCTL_OPTIONS_IDENTICAL'],
    ));
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

/** Every member id named as a destination inside a parenthesised group, from any sender. */
function groupedDestinationIds(doc: TopologyDoc): Set<string> {
  const out = new Set<string>();
  for (const m of doc.members) {
    for (const r of m.redoRoutes) {
      for (const g of r.groups) {
        if (!isParenthesised(g)) continue;
        for (const d of g.dests) {
          if (d.target !== 'ALL') out.add(d.target as string);
        }
      }
    }
  }
  return out;
}

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

  if (pingPropertiesSet(doc) && v26) {
    /* ObserverPingInterval / ObserverPingRetry: zero occurrences on the
       12.2, 18c and 19c properties pages, first documented in 21c, and
       absent from a live 19.27 install -- never emitted under 19c
       (ED-01), only under 26ai, which has its own primary pages for them. */
    out.push(cmd(
      [span('EDIT CONFIGURATION SET PROPERTY ObserverPingInterval = '), hl(String(f.pingIntervalMs)), span(';')],
      { basis: 'documented', cite: ['FSFO.PING_DEFAULTS_26AI_ZERO'] },
    ));
    out.push(cmd(
      [span('EDIT CONFIGURATION SET PROPERTY ObserverPingRetry = '), hl(String(f.pingRetry)), span(';')],
      { basis: 'documented', cite: ['FSFO.PING_RETRY_26AI'] },
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
    out.push(nLater(
      'the 26ai property pages give both broker defaults as 0 -- not set -- while the 26ai fast-start failover chapter\'s table still shows 100 ms and 10; the explicitly-set minimums stay 100 ms and 10 in every edition',
      ['FSFO.PING_DEFAULTS_26AI_ZERO', 'FSFO.PING_DEFAULTS_26AI_TABLE'],
      '26ai disagrees with itself about the defaults; never write "defaults identical in 26ai" unqualified.',
    ));
  } else if (pingPropertiesSet(doc)) {
    /* v19: the document specifies values for both properties, but they do
       not exist in 19c, so this script does not set them. */
    out.push(nLater(
      'the ObserverPing* properties are not documented for 19c -- zero occurrences on the 12.2, 18c or 19c properties pages, and neither name is present in a live 19.27 install -- so this script does not set them here even though the document specifies values for both; detection stays governed by the threshold above',
      ['FSFO.PING_PROPS_21C'],
      'First documented in the 21c broker properties page.',
    ));
  } else {
    out.push(nDoc(
      'ObserverPingInterval and ObserverPingRetry stay unset -- detection runs on the threshold',
      ['FSFO.PING_PROPS_21C'],
    ));
  }

  /* The lag limit, whose protection-mode story changed in 21c and whose
     broker default follows the edition and the mode until someone sets it.
     The command is emitted only for a limit that was set; a limit at its
     broker default is a note saying which default is in force. */
  const mode = cfg.protectionMode;
  const limitSet = lagLimitIsSet(f);
  const limit = lagLimitOf(doc);
  const lagDefault = defaultLagLimit(cfg.edition, mode);
  const setLagLimit = (cite: CitationId[]): Line => cmd(
    [span('EDIT CONFIGURATION SET PROPERTY FastStartFailoverLagLimit = '),
      val(limit, limit === lagDefault), span(';')],
    { basis: 'documented', cite },
  );
  if (mode === 'MAXAVAILABILITY' && !v26) {
    /* ED-03: 19c contradicts itself, and a live 19.27 system prints the limit
       "(not in use)" in maximum availability; the page follows the live
       system and names the conflict rather than resolving it. */
    if (limitSet) out.push(setLagLimit(['FSFO.LAGLIMIT_DEFAULT_19C']));
    const text = `${limitSet ? `FastStartFailoverLagLimit is set to ${limit} seconds` : `FastStartFailoverLagLimit is not set -- the 19c broker default is ${lagDefault} seconds`}, and in maximum availability a live 19.27 system prints it "(not in use)": the standby must be synchronized instead, which is about redo received, so an apply lag does not block it. The 19c documentation contradicts itself here -- its fast-start failover chapter says zero data loss in maximum availability needs the property set to zero, its property page says the property is used in maximum performance mode`;
    out.push(note(text, conflict(text,
      ['FSFO.LAGLIMIT_ZERO_MAXAVAIL_19C', 'FSFO.LAGLIMIT_MAXPERF_ONLY_19C'],
      'The 19c fast-start failover chapter and the 19c FastStartFailoverLagLimit property page disagree about whether the property reaches maximum availability. A live 19.27 system in MaxAvailability prints "Lag Limit: 30 seconds (not in use)" -- an observation, not documentation -- and this page follows it.')));
  } else if (mode === 'MAXAVAILABILITY') {
    if (limitSet) out.push(setLagLimit(LAG_LIMIT_MODE_CITES));
    else {
      out.push(nDoc(
        `FastStartFailoverLagLimit is not set -- the 26ai broker default in maximum availability mode is ${lagDefault} seconds`,
        ['FSFO.LAGLIMIT_RANGES'],
      ));
    }
    out.push(nDoc(
      limit === 0
        ? '0 in maximum availability: the standby must have received every change, so the failover loses nothing -- V$FAST_START_FAILOVER_CONFIG names that ZERO DATA LOSS'
        : 'non-zero in maximum availability: fast-start failover is permitted while the lag is at or below the limit and loses at most that much -- POTENTIAL DATA LOSS',
      LAG_LIMIT_MODE_CITES,
    ));
  } else if (mode === 'MAXPERFORMANCE') {
    const rangeCite: CitationId = v26 ? 'FSFO.LAGLIMIT_RANGES' : 'FSFO.LAGLIMIT_DEFAULT_19C';
    if (limitSet) {
      out.push(setLagLimit([rangeCite]));
      if (limit === lagDefault) out.push(nDoc('default', [rangeCite]));
    } else {
      out.push(nDoc(
        `FastStartFailoverLagLimit is not set -- the broker default in maximum performance mode is ${lagDefault} seconds`,
        [rangeCite],
      ));
    }
    if (limit > f.thresholdSeconds) {
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
  } else {
    if (limitSet) out.push(setLagLimit([v26 ? 'FSFO.LAGLIMIT_RANGES' : 'FSFO.LAGLIMIT_DEFAULT_19C']));
    out.push(nDoc(
      'FastStartFailoverLagLimit is not used in maximum protection mode: the readiness check is that the standby is synchronized',
      ['FSFO.LAGLIMIT_NOT_MAXPROT_26AI'],
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
      'TRUE is the default: a primary stalled longer than the threshold, able to reach neither the observer nor the target standby, will shut down',
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
      { basis: 'documented', cite: ['OBS.OBSERVER_RECONNECT'] },
    ));
  }

  const preferred = f.preferredObserverHosts ?? [];
  if (preferred.length > 0) {
    /* PreferredObserverHosts is database-scope, not configuration-wide: the
       26ai chapter's own example sets it with EDIT DATABASE on both
       North_Sales and South_Sales. When this document pre-declares routes
       in both directions -- the same signal the RedoRoutes block above
       reads -- a future role change needs it on the other database too. */
    const primaryId = declaredPrimary(doc);
    const bothDirections = primaryId !== null
      && doc.members.some((m) => m.id !== primaryId && m.redoRoutes.length > 0);
    const targets = bothDirections
      ? doc.members.filter((m) => isDatabase(m) && (m.id === primaryId || m.redoRoutes.length > 0))
      : doc.members.filter((m) => m.id === primaryId);
    const value = preferred.map((p) => `${p.host as string}:${p.priority}`).join(',');
    for (const m of targets) {
      out.push(cmd(
        [span(`${editOf(m)} SET PROPERTY 'PreferredObserverHosts' = '`), hl(value), span("';")],
        { basis: 'documented', cite: ['OBS.PREFERRED_HOSTS', 'OBS.PREFERRED_HOSTS_EXAMPLE_26AI'] },
      ));
    }
    out.push(nDoc(
      'PreferredObserverHosts has database scope -- EDIT DATABASE, never EDIT CONFIGURATION -- so whichever database is primary needs its own copy; only observers running on the hosts specified will observe databases and become the master observer; priority runs 1 to 8, lower wins, and the default is 8',
      ['OBS.PREFERRED_HOSTS', 'OBS.PREFERRED_HOSTS_EXAMPLE_26AI'],
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

function targetLines(doc: TopologyDoc, primary: Member, graph: RedoGraph): Line[] {
  const out: Line[] = [];
  const t = doc.config.fsfo.target;
  const standbys = doc.members.filter((m) => isDatabase(m) && m.id !== primary.id);
  /* GEN-14: a target that receives its redo through a far sync instance needs
     FastStartFailoverTarget set on BOTH sides before ENABLE (Scenario 7) --
     the reciprocal is not set for it. */
  const viaFarSync = (t.kind === 'list' ? t.members : standbys.map((m) => m.id)).filter((id) => {
    const path = graph.members[id]?.feedPath ?? [];
    return path.slice(1, -1).some((hop) => {
      const h = doc.members.find((m) => m.id === hop);
      return h !== undefined && isFarSync(h);
    });
  });

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
  for (const id of viaFarSync) {
    out.push(cmd(
      [span(`EDIT DATABASE ${q(nameOf(doc, id))} SET PROPERTY 'FastStartFailoverTarget' = '`), hl(primary.name), span("';")],
      { basis: 'documented', cite: ['FSFO.FARSYNC_TARGET_SCENARIO7'] },
    ));
  }
  out.push(nDoc(
    'the target can only be the name of a physical or logical standby -- never a snapshot standby, a far sync instance or a Zero Data Loss Recovery Appliance -- and it must receive redo directly from the primary database; receiving it from a far sync instance is the sanctioned exception',
    ['FSFO.TARGET_KIND', 'FSFO.TARGET_DIRECT_REDO', 'FSFO.TARGET_NOT_FARSYNC'],
  ));
  out.push(nDoc('targets are verified when fast-start failover is enabled', ['FSFO.TARGET_VERIFIED_ON_ENABLE']));
  if (viaFarSync.length > 0) {
    out.push(nDoc(
      `${viaFarSync.map((id) => nameOf(doc, id)).join(' and ')} receive${viaFarSync.length === 1 ? 's' : ''} redo through a far sync instance, so FastStartFailoverTarget is set on both sides before ENABLE FAST_START FAILOVER, as above -- the reciprocal is not left to the broker here`,
      ['FSFO.FARSYNC_TARGET_SCENARIO7'],
    ));
  }
  if (viaFarSync.length < Math.max(t.kind === 'list' ? t.members.length : standbys.length, 1)) {
    out.push(nDoc(
      'for a target that receives redo directly, the broker reciprocally sets the property on the target standby when fast-start failover is actually enabled, to indicate the primary as its future target: there is no need to set it there',
      ['FSFO.TARGET_RECIPROCAL_AUTO'],
    ));
  }
  return out;
}

/* ---------------- ENABLE and the observers ---------------- */

function enableAndObserverLines(doc: TopologyDoc, primary: Member): Line[] {
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

  /* Each observer is a DGMGRL session of its own, on a host of its own --
     "START OBSERVER [observer-name] IN BACKGROUND CONNECT IDENTIFIER IS
     connect-identifier [FILE IS observer-file] [LOGFILE IS log-file]
     [TRACE_LEVEL IS USER | SUPPORT];" (OBS.START_FILE_IS). IN BACKGROUND sits
     right after the name; CONNECT IDENTIFIER IS is mandatory. */
  for (const o of doc.observers) {
    const usesPrimaryIdentifier = o.connectIdentifier === undefined;
    const connectIdentifier = o.connectIdentifier ?? primary.connectIdentifier;
    const parts = [
      `START OBSERVER ${o.name}`, 'IN BACKGROUND', `CONNECT IDENTIFIER IS ${connectIdentifier}`,
    ];
    if (o.fileIs !== undefined) parts.push(`FILE IS ${o.fileIs}`);
    if (o.logfileIs !== undefined) parts.push(`LOGFILE IS ${o.logfileIs}`);
    out.push(cmd(`${parts.join(' ')};`, { basis: 'documented', cite: ['OBS.START_FILE_IS'] }));
    const host = doc.hosts.find((h) => h.id === o.host);
    out.push(nDoc(
      `issued from a DGMGRL session on ${host?.name ?? String(o.host)}, ${o.name}'s own host -- not the session that built the configuration above`,
      ['OBS.START_FILE_IS', 'OBS.PLACEMENT_NEVER_ON_DB_HOST'],
    ));
    if (usesPrimaryIdentifier) {
      out.push(nDoc(
        `${o.name} has no connect identifier of its own in this document; CONNECT IDENTIFIER IS is mandatory, so the command above uses ${primary.name}'s (${connectIdentifier})`,
        ['OBS.START_FILE_IS'],
      ));
    }
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
      'CONNECT IDENTIFIER IS uses the credentials stored in the Oracle wallet; if the wallet is not configured, then the command will fail to start the observer',
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
    out.push(nDoc(
      'the switch does not happen at the instant this command is issued: it takes effect the next time the primary contacts the target standby, usually within three seconds if fast-start failover is enabled, and only if the target standby is enabled and does not require reinstatement, with no role change, reinstating or fast-start failover target switch already in progress',
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
