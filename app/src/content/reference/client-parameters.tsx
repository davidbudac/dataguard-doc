/**
 * Connect-descriptor parameters -- the application's view, chapter 3.
 *
 * Defaults per the Oracle 19c Net Services Reference (connect-descriptor
 * timeout parameters); tuning guidance per the 19c High Availability Overview,
 * "Oracle Net TNS String Parameters".
 */

import { M } from '../facts-ui';
import type { RefTableData } from './RefTable';

export const clientParameters: RefTableData = {
  id: 'ref-client-parameters',
  title: 'Connect-string parameters',
  columns: [
    { key: 'parameter', label: 'Parameter' },
    { key: 'placed', label: 'Placed at' },
    { key: 'default', label: 'Default', numeric: true },
    { key: 'governs', label: 'What it governs' },
  ],
  rows: [
    {
      key: 'tct',
      cells: [
        <M>TRANSPORT_CONNECT_TIMEOUT</M>,
        'DESCRIPTION',
        '60 s',
        <>
          Establishing the TCP connection to one ADDRESS, charged per IP address the host name
          resolves to. The clock that runs while a host is silently unreachable.
        </>,
      ],
    },
    {
      key: 'ct',
      cells: [
        <M>CONNECT_TIMEOUT</M>,
        'DESCRIPTION',
        'not set',
        <>
          One complete connection attempt to one ADDRESS &mdash; transport plus listener handshake.
          Applied per address.
        </>,
      ],
    },
    {
      key: 'rc',
      cells: [
        <M>RETRY_COUNT</M>,
        'DESCRIPTION',
        'not set (drawn as 0)',
        <>
          Additional traversals of the full address list after the first attempt fails across all of
          it. The reference prints no default; one traversal when unset is this page&rsquo;s reading.
        </>,
      ],
    },
    {
      key: 'rd',
      cells: [
        <M>RETRY_DELAY</M>,
        'DESCRIPTION',
        'not set',
        <>Seconds between traversals. Unset means the next traversal starts immediately.</>,
      ],
    },
    {
      key: 'failover',
      cells: [
        <M>FAILOVER</M>,
        'ADDRESS_LIST / DESCRIPTION',
        'on',
        <>
          Connect-time failover: try the next address when one fails. Already the default &mdash;
          spelled out in the generated string for clarity.
        </>,
      ],
    },
    {
      key: 'load-balance',
      cells: [
        <M>LOAD_BALANCE</M>,
        'ADDRESS_LIST',
        'off',
        <>
          Randomize address order instead of walking the list top-down. Default on only under a
          DESCRIPTION_LIST.
        </>,
      ],
    },
  ],
};
