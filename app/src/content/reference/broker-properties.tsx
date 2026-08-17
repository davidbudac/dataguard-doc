/**
 * The broker properties table, ported from the legacy Reference chapter.
 *
 * NET_TIMEOUT is deliberately absent: it is a transport attribute, not a
 * failover clock, and it lives in the transport table next door.
 */

import { M } from '../facts-ui';
import { byEdition, type RefTableData } from './RefTable';

export const brokerProperties: RefTableData = {
  id: 'ref-broker-properties',
  title: 'The broker properties',
  columns: [
    { key: 'property', label: 'Property' },
    { key: 'default', label: 'Default', numeric: true },
    { key: 'minimum', label: 'Minimum', numeric: true },
    { key: 'governs', label: 'What it governs' },
  ],
  rows: [
    {
      key: 'threshold',
      cells: [
        <M>FastStartFailoverThreshold</M>,
        '30 s',
        '6 s',
        <>
          Seconds the master observer attempts to reconnect to the primary before initiating
          fast-start failover. The interval starts when the observer first loses its connection to
          the primary.
        </>,
      ],
    },
    {
      key: 'ping-interval',
      cells: [
        <M>ObserverPingInterval</M>,
        byEdition('100 ms', '0 — not set'),
        '100 ms',
        <>How frequently the observer pings the primary.</>,
      ],
    },
    {
      key: 'ping-retry',
      cells: [
        <M>ObserverPingRetry</M>,
        byEdition('10', '0 — not set'),
        '10',
        <>
          Number of times the observer retries a failed ping before initiating failover. A ping
          counts as failed when there is no answer within <M>ObserverPingInterval</M>.
        </>,
      ],
    },
    {
      key: 'lag-limit',
      cells: [
        <M>FastStartFailoverLagLimit</M>,
        byEdition('30 s', '30 s MaxPerf · 0 MaxAvail'),
        byEdition('5 s', '0, or 5 s'),
        <>
          MaxPerformance only under 19c. Maximum seconds the standby&rsquo;s apply point may lag the
          primary&rsquo;s redo generation point for fast-start failover to be permitted. Bounds the
          data loss. Under 26ai it applies in MaxAvailability as well, where the default 0 is the 19c
          zero-loss rule written as a number.
        </>,
      ],
    },
    {
      key: 'lag-type',
      onlyIn: '26ai',
      cells: [
        <M>FastStartFailoverLagType</M>,
        'APPLY',
        '—',
        <>
          Which lag <M>FastStartFailoverLagLimit</M> is measured against: <M>APPLY</M>, the
          standby&rsquo;s apply point, or <M>TRANSPORT</M>, the redo it has received. Under{' '}
          <M>TRANSPORT</M> the limit bounds redo that never arrived; redo already received is still
          applied during terminal recovery. Documented as maximum-performance-mode behavior.
        </>,
      ],
    },
    {
      key: 'lag-grace',
      onlyIn: '26ai',
      cells: [
        <M>FastStartFailoverLagGraceTime</M>,
        '0 — off',
        '5 s',
        <>
          Seconds before the lag limit at which the primary asks permission &mdash; of the observer
          or of the target standby, either may grant it &mdash; to enter the <M>LAGGING</M> state.
          With the answer already granted the crossing costs it nothing; left at 0 it asks at the
          crossing and waits there for the answer.
        </>,
      ],
    },
    {
      key: 'primary-candidates',
      onlyIn: '26ai',
      cells: [
        <M>PrimaryDatabaseCandidates</M>,
        '—',
        '—',
        <>
          Lists the members the broker may make primary. While fast-start failover is disabled it
          restricts switchover and failover to that list, and an excluded target is refused with{' '}
          <M>ORA-16529</M>; once fast-start failover is enabled it adds nothing, because{' '}
          <M>FastStartFailoverTarget</M> already governs the target. Reported as backported to 19.26
          by the product manager&rsquo;s blog, not by Oracle&rsquo;s release-update notes.
        </>,
      ],
    },
    {
      key: 'pmy-shutdown',
      cells: [
        <M>FastStartFailoverPmyShutdown</M>,
        'TRUE',
        '—',
        <>
          When TRUE, a primary whose <M>V$DATABASE.FS_FAILOVER_STATUS</M> has been <M>STALLED</M> for
          longer than <M>FastStartFailoverThreshold</M> seconds, and that cannot reach the observer or
          the target standby, shuts itself down with an abort.
        </>,
      ],
    },
    {
      key: 'observer-override',
      cells: [
        <M>ObserverOverride</M>,
        'FALSE',
        '—',
        <>
          When TRUE, an automatic failover may occur once the observer has lost connectivity to the
          primary &mdash; the documentation says this holds even if the standby has a healthy
          connection to the primary. At the default FALSE, a target standby that still reaches the
          primary is what prevents the attempt. Everything on this page assumes the default.
        </>,
      ],
    },
    {
      key: 'auto-reinstate',
      cells: [
        <M>FastStartFailoverAutoReinstate</M>,
        'TRUE',
        '—',
        <>
          Reinstates the old primary as a standby, but only after a failover the observer initiated
          because the primary crashed or was isolated &mdash; never after a user-configurable health
          condition or a <M>DBMS_DG.INITIATE_FS_FAILOVER</M> call. It needs Flashback Database enabled
          on both databases and the former primary started and mounted, which is a manual restart when{' '}
          <M>FastStartFailoverPmyShutdown</M> aborted it, with the master observer able to connect to
          it. Without Oracle Clusterware or Oracle Restart, static service names are required.
        </>,
      ],
    },
  ],
};
