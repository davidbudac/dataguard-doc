/**
 * What changed in 26ai, against the 19c baseline -- including what arrived in
 * 21c and 23ai, which a straight 19c-to-26ai upgrade picks up in the same step.
 */

import type { VNode } from 'preact';
import { M } from '../facts-ui';
import type { RefTableData } from './RefTable';

function Ext({ href, children }: { href: string; children: VNode | string }): VNode {
  return (
    <a class="ct-ext" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

const D26 = 'https://docs.oracle.com/en/database/oracle/oracle-database/26';
const CAL = 'https://www.ludovicocaldara.net/blog';

export const changes26ai: RefTableData = {
  id: 'ref-changes-26ai',
  title: 'What changed in 26ai',
  columns: [
    { key: 'change', label: 'Change' },
    { key: 'does', label: 'What it does' },
    { key: 'sources', label: 'Sources' },
  ],
  rows: [
    {
      key: 'laglimit',
      cells: [
        <>
          <M>FastStartFailoverLagLimit</M> in MaxAvailability
        </>,
        <>
          The property is no longer MaxPerformance-only. In MaxAvailability its broker default becomes{' '}
          <M>0</M>, which is the 19c rule spelled as a number: the standby must have received all the
          redo the primary generated, and a fast-start failover loses nothing. Set it non-zero
          (minimum 5 s) and MaxAvailability becomes bounded-loss instead &mdash; failover is permitted
          whenever the standby&rsquo;s apply lag is at or below the limit, and the loss is bounded by
          it. <M>V$FAST_START_FAILOVER_CONFIG</M> reports the two as <M>ZERO DATA LOSS</M> and{' '}
          <M>POTENTIAL DATA LOSS</M>. The 26ai prerequisites table also lists <M>ASYNC</M> among the
          transports allowed for a MaxAvailability target, where 19c listed only <M>SYNC</M> and{' '}
          <M>FASTSYNC</M>.
        </>,
        <>
          <Ext href={`${D26}/dgbkr/fast-start-failover2.html`}>
            26ai docs, &ldquo;Fast-start Failover Protection Modes&rdquo;
          </Ext>{' '}
          · <Ext href={`${D26}/dgbkr/faststartfailoverlaglimit.html`}>property</Ext>
        </>,
      ],
    },
    {
      key: 'lagtype',
      cells: [
        <M>FastStartFailoverLagType</M>,
        <>
          New property, <M>APPLY</M> (the default, and the only 19c behavior) or <M>TRANSPORT</M>;
          MaxPerformance only. Chooses which lag <M>FastStartFailoverLagLimit</M> is measured against:
          the standby&rsquo;s apply point, or the redo it has received. Under <M>TRANSPORT</M> the
          limit bounds only redo that never arrived &mdash; redo already received is still applied
          during terminal recovery &mdash; so the same limit tolerates a deep apply queue without
          refusing the failover.
        </>,
        <>
          <Ext href={`${D26}/dgbkr/faststartfailoverlagtype.html`}>26ai docs</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-lag-type/`}>Caldara #3</Ext>
        </>,
      ],
    },
    {
      key: 'laggrace',
      cells: [
        <M>FastStartFailoverLagGraceTime</M>,
        <>
          New property, default 0 (off), minimum 5 s when set. That many seconds before the lag limit,
          the primary asks the observer &mdash; or the target standby, either may grant it &mdash; for
          permission to enter the <M>LAGGING</M> state; with the answer pre-granted, crossing the limit
          costs it nothing. Left at 0, it asks at the crossing and stalls there waiting for the answer
          &mdash; up to one <M>FastStartFailoverThreshold</M>.
        </>,
        <>
          <Ext href={`${D26}/dgbkr/faststartfailoverlaggracetime.html`}>26ai docs</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-minimized-stall/`}>Caldara #2</Ext>
        </>,
      ],
    },
    {
      key: 'validate',
      cells: [
        <M>VALIDATE FAST_START FAILOVER</M>,
        <>
          One DGMGRL command running the documented readiness checklist: fast-start failover properties
          that are set incorrectly, anything preventing fast-start failover from being enabled or
          initiated, anything affecting what happens once it is initiated, anything impacting the
          configuration&rsquo;s stability, and the syntax of <M>fsfocallout.ora</M> together with the
          accessibility of the callout scripts. The documented example output also flags an observer
          that has not been started and flashback logging that is off &mdash; the checks that 19c
          leaves spread across <M>SHOW</M> commands and views.
        </>,
        <>
          <Ext href={`${D26}/dgbkr/validate-fast_start-failover.html`}>26ai docs</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-validate-fsfo/`}>Caldara #28</Ext>
        </>,
      ],
    },
    {
      key: 'fsfo-config-view',
      cells: [
        <M>V$FAST_START_FAILOVER_CONFIG</M>,
        <>
          New view carrying the fast-start failover configuration &mdash; state, targets, limits,
          observer presence. The Data Guard views reference scopes it to the <em>primary</em>: query it
          there. The <M>V$DATABASE.FS_FAILOVER_*</M> columns this page&rsquo;s 19c edition cites are
          deprecated in its favor.
        </>,
        <>
          <Ext href={`${D26}/refrn/V-FAST_START_FAILOVER_CONFIG.html`}>26ai docs</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-fsfo-config-view/`}>Caldara #25</Ext>
        </>,
      ],
    },
    {
      key: 'lag-histogram',
      cells: [
        <M>V$FS_LAG_HISTOGRAM</M>,
        <>
          Per-minute samples of the lag that gates fast-start failover, bucketed into a histogram
          &mdash; the documented way to pick a <M>FastStartFailoverLagLimit</M> from measured behavior
          instead of guesswork.
        </>,
        <>
          <Ext href={`${D26}/refrn/V-FS_LAG_HISTOGRAM.html`}>26ai docs</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-fsfo-lag-histogram/`}>Caldara #26</Ext>
        </>,
      ],
    },
    {
      key: 'sql-visibility',
      cells: [
        'SQL-side broker visibility',
        <>
          New view <M>V$DG_BROKER_PROPERTY</M> lists every broker property and value from SQL;{' '}
          <M>V$DG_BROKER_CONFIG</M> gains <M>SWITCHOVER_READY</M> and <M>FAILOVER_READY</M>,
          role-transition readiness as two columns; <M>V$FS_FAILOVER_OBSERVERS</M> gains per-observer
          diagnostics &mdash; seconds since the observer last pinged the primary and the target, and
          the full paths of its log and state files &mdash; with the caveat that the view&rsquo;s
          behavior is defined only when it is queried on the primary.
        </>,
        <>
          <Ext href={`${D26}/refrn/V-DG_BROKER_PROPERTY.html`}>26ai docs</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-v-dg-broker-property/`}>Caldara #23</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-switchover-readiness/`}>#21</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-enhanced-observer-diagnostics/`}>#27</Ext>
        </>,
      ],
    },
    {
      key: 'primary-candidates',
      cells: [
        <M>PrimaryDatabaseCandidates</M>,
        <>
          New property listing the members the broker is allowed to make primary. It bites only while
          fast-start failover is <em>disabled</em>: there it restricts both <M>SWITCHOVER</M> and{' '}
          <M>FAILOVER</M> to the listed databases, and a transition to a member that is not listed is
          refused with <M>ORA-16529</M>. With fast-start failover enabled it adds no new restriction,
          because <M>FastStartFailoverTarget</M> already governs which member can become primary. The
          broker adds the current primary itself if the list omits it, and the default &mdash; an empty
          string &mdash; restricts nothing. Reported as backported to 19.26 by the Data Guard product
          manager&rsquo;s blog series; not reflected in Oracle&rsquo;s release-update documentation.
        </>,
        <>
          <Ext href={`${D26}/dgbkr/primarydatabasecandidates.html`}>26ai docs</Ext> ·{' '}
          <Ext href="https://docs.oracle.com/en/error-help/db/ora-16529/">ORA-16529</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-primarydatabasecandidates/`}>Caldara #15</Ext>
        </>,
      ],
    },
    {
      key: 'scripting',
      cells: [
        'Scripting surfaces',
        <>
          DGMGRL grows JSON output for its <M>SHOW</M> commands; the <M>DBMS_DG</M> package becomes a
          full PL/SQL configuration API rather than the single 19c failover-initiation call; SQLcl
          speaks the broker commands; ORDS exposes them over REST. Those last two arrived before 26ai
          &mdash; the SQLcl <M>DG</M> command is documented for 21c and the ORDS endpoints ship in 23.3
          &mdash; so a 19c site picks them up in the same upgrade. Automation stops screen-scraping
          DGMGRL.
        </>,
        <>
          <Ext href={`${D26}/arpls/DBMS_DG.html`}>26ai docs</Ext> ·{' '}
          <Ext href={`${D26}/dgbkr/starting-data-guard-command-line-interface.html`}>DGMGRL -json</Ext> ·{' '}
          <Ext href="https://docs.oracle.com/en/database/oracle/sql-developer-command-line/25.3/sqcug/dg-data-guard.html">
            SQLcl DG
          </Ext>{' '}
          ·{' '}
          <Ext href="https://docs.oracle.com/en/database/oracle/oracle-rest-data-services/23.3/orrst/api-data-guard.html">
            ORDS Data Guard REST
          </Ext>{' '}
          · <Ext href={`${CAL}/dg26ai-json-output/`}>Caldara #14</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-pl-sql-api/`}>#10</Ext> ·{' '}
          <Ext href={`${CAL}/dg26ai-sqlcl/`}>#11</Ext> · <Ext href={`${CAL}/dg26ai-ords/`}>#12</Ext>
        </>,
      ],
    },
    {
      key: 'role-transitions',
      cells: [
        'Faster role transitions',
        <>
          Switchover and failover internals are reworked; Oracle claims transitions up to several times
          faster than 19c, with nothing to configure. The role-transition time stays yours to set
          &mdash; measure your own transition and enter it.
        </>,
        <>
          <Ext href={`${CAL}/dg-26ai-faster-role-transitions/`}>Caldara #1</Ext>
        </>,
      ],
    },
    {
      key: 'async-connections',
      cells: [
        'Multiple ASYNC connections',
        <>
          A lagging ASYNC standby is caught up over several automatic network connections instead of
          one, with no configuration &mdash; the same gap-resolution story, only faster on wide links.
        </>,
        <>
          <Ext href={`${CAL}/dg26ai-multiple-async-connections/`}>Caldara #8</Ext>
        </>,
      ],
    },
  ],
};
