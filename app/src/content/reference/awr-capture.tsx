/**
 * What to capture before and after turning SYNC on -- chapter 5.
 *
 * Four of the five names are wait events; `redo write time` is a V$SYSSTAT
 * statistic in centiseconds, and the table says so where it is read.
 */

import { M } from '../facts-ui';
import type { RefTableData } from './RefTable';

export const awrCapture: RefTableData = {
  id: 'ref-awr-capture',
  title: 'Measuring SYNC on the same workload, before and after',
  columns: [
    { key: 'what', label: 'What to capture' },
    { key: 'where', label: 'Where it comes from' },
    { key: 'tells', label: 'What it tells you' },
  ],
  rows: [
    {
      key: 'lfs',
      cells: [
        <M>log file sync</M>,
        'AWR top timed events, primary',
        <>
          The committing session&rsquo;s whole wait. The one to read as a histogram rather than as an
          average.
        </>,
      ],
    },
    {
      key: 'rwt',
      cells: [
        <M>redo write time</M>,
        <>
          <M>V$SYSSTAT</M> or the AWR statistics section
        </>,
        <>
          LGWR&rsquo;s whole write operation, local and remote leg together. A statistic in
          centiseconds, not a wait event.
        </>,
      ],
    },
    {
      key: 'lfpw',
      cells: [
        <M>log file parallel write</M>,
        'AWR wait events, primary',
        <>The local redo write I/O. Unchanged by SYNC unless the storage is also the bottleneck.</>,
      ],
    },
    {
      key: 'srw',
      cells: [
        <M>SYNC remote write</M>,
        'AWR wait events, primary',
        <>The remote leg: the network plus the standby&rsquo;s write. This is the leg SYNC adds.</>,
      ],
    },
    {
      key: 'rfs',
      cells: [
        <M>RFS random i/o</M>,
        'AWR wait events, standby',
        <>How fast the standby writes what it receives into its standby redo log.</>,
      ],
    },
    {
      key: 'tps',
      cells: [
        'Transactions per second, redo rate',
        'AWR load profile, primary',
        <>
          What the application actually got. Oracle&rsquo;s recommended measure of the impact of SYNC
          for OLTP.
        </>,
      ],
    },
    {
      key: 'writes',
      cells: [
        'redo writes, redo size',
        <>
          <M>V$SYSSTAT</M> or AWR
        </>,
        <>
          Their ratio is the average redo write size. Fewer, larger writes after SYNC is commit
          batching &mdash; and the same figure feeds <M>-length</M> in the oratcptest run.
        </>,
      ],
    },
    {
      key: 'lag',
      cells: [
        'Transport lag, apply lag',
        <>
          <M>V$DATAGUARD_STATS</M>, <M>V$STANDBY_EVENT_HISTOGRAM</M>
        </>,
        <>Whether the standby is keeping up, now and historically.</>,
      ],
    },
  ],
};
