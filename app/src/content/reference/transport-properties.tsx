/**
 * Redo transport properties -- the plumbing, kept apart from the failover
 * clocks: none of these decides whether or when a failover happens.
 */

import { M } from '../facts-ui';
import type { RefTableData } from './RefTable';

export const transportProperties: RefTableData = {
  id: 'ref-transport-properties',
  title: 'Redo transport properties',
  columns: [
    { key: 'property', label: 'Broker property' },
    { key: 'attribute', label: 'LOG_ARCHIVE_DEST_n attribute' },
    { key: 'default', label: 'Default', numeric: true },
    { key: 'governs', label: 'What it governs' },
  ],
  rows: [
    {
      key: 'logxptmode',
      cells: [
        <M>LogXptMode</M>,
        <>
          <M>SYNC AFFIRM</M> · <M>SYNC NOAFFIRM</M> (FASTSYNC) · <M>ASYNC NOAFFIRM</M>
        </>,
        'ASYNC',
        <>How the commit waits, or does not wait, for the standby&rsquo;s acknowledgement.</>,
      ],
    },
    {
      key: 'reopensecs',
      cells: [
        <>
          <M>ReopenSecs</M>
        </>,
        <M>REOPEN</M>,
        '300 s',
        <>
          Minimum seconds before a failed destination is retried, at the next log switch after the
          interval has elapsed. Valid values are 0 or greater; applies to all errors, not only
          connection failures.
        </>,
      ],
    },
    {
      key: 'maxfailure',
      cells: [
        <>
          <M>MaxFailure</M>
        </>,
        <M>MAX_FAILURE</M>,
        '0 — no limit',
        <>
          Consecutive failed attempts to reestablish a failed destination before it is disabled, with
          no further access until it is manually reenabled. The 0 default is the default destination
          group&rsquo;s; destinations in a non-default group default to 1.
        </>,
      ],
    },
    {
      key: 'nettimeout',
      cells: [
        <M>NetTimeout</M>,
        <M>NET_TIMEOUT</M>,
        '30 s',
        <>Seconds LGWR waits for a SYNC acknowledgement &mdash; never a failover clock.</>,
      ],
    },
  ],
};
