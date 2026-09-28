/**
 * Lesson 2 -- The transport layer.
 *
 * Legacy chapter 2: what one commit costs (SYNC / FASTSYNC / ASYNC), and what
 * happens after the destination is dropped (ReopenSecs, MaxFailure).
 */

import { Fact, M } from '../facts-ui';
import { Fn } from '../footnotes';
import { Caption, P } from '../prose';
import type { Lesson } from '../types';

const PRIMARY = '/members/0';
const STANDBY_DEST = `${PRIMARY}/dests/sby01`;

export const transportLayer: Lesson = {
  id: 'transport-layer',
  title: 'The transport layer',
  presetId: 'classic',
  steps: [
    {
      title: 'What one commit costs — SYNC, FASTSYNC, ASYNC',
      prose: (
        <>
          <P>
            Transport cost is paid on every commit, for as long as the configuration runs. The broker
            property is <M>LogXptMode</M> (<M>SYNC</M>, <M>FASTSYNC</M> or <M>ASYNC</M>); the three
            differ by one disk write on the standby and one round trip on the wire.
          </P>
          <Caption>
            The commit view draws one figure per SYNC or FASTSYNC destination on one millisecond
            scale. Measuring the cost from an AWR report is the SYNC transport lesson.
          </Caption>
        </>
      ),
      apply: { patches: [{ op: 'replace', path: `${STANDBY_DEST}/affirm`, value: 'AFFIRM' }] },
    },
    {
      title: 'AFFIRM means the redo is on disk',
      prose: (
        <P>
          <M>SYNC</M> sets <M>SYNC</M> + <M>AFFIRM</M>: the destination acknowledges redo only after
          writing it to the standby redo log. <M>FASTSYNC</M> sets <M>SYNC</M> + <M>NOAFFIRM</M>: it
          acknowledges before that write. Under both, a commit waits for the acknowledgement; all
          three values require standby redo logs.{' '}
          <Fact
            id="COMMIT.THIRTEEN_STEPS"
            basis="inferred"
            note="The documented thirteen-step path starts the remote write at step 5, issues the local write at step 6 and waits for the remote one at step 7. Oracle never calls this parallel."
          >
            A commit costs max(local write, remote acknowledgement path), never the sum
          </Fact>
          .
        </P>
      ),
      apply: {
        patches: [
          { op: 'replace', path: `${STANDBY_DEST}/affirm`, value: 'AFFIRM' },
          { op: 'replace', path: '/members/1/logXptMode', value: 'SYNC' },
          { op: 'replace', path: '/links/0/rttMs', value: 20 },
          { op: 'replace', path: '/environment/standbyWriteMs', value: 10 },
        ],
      },
      note: 'A 20 ms round trip and a 10 ms standby write: the acknowledgement path is what the session waits on.',
    },
    {
      title: 'FASTSYNC drops the standby disk wait',
      prose: (
        <P>
          Since 12.1, maximum availability mode only. It saves the standby redo log write, but only
          while the network is the bottleneck: once the local write outlasts the round trip, the saving
          reads zero. The broker documents that fast-start failover cannot be initiated while{' '}
          <M>FASTSYNC</M> is in use and the standby is missing redo data.
        </P>
      ),
      apply: {
        patches: [
          { op: 'replace', path: '/members/1/logXptMode', value: 'FASTSYNC' },
          { op: 'replace', path: '/links/0/rttMs', value: 20 },
          { op: 'replace', path: '/environment/standbyWriteMs', value: 10 },
        ],
      },
    },
    {
      title: 'ASYNC never waits for the standby',
      prose: (
        <P>
          Under <M>ASYNC</M> + <M>NOAFFIRM</M>, the broker default, a commit never waits for the
          destination: it costs the local write alone. Redo still on the wire is the exposure, which
          is why MaxPerformance gates fast-start failover on <M>FastStartFailoverLagLimit</M>. The
          broker lists <M>ASYNC</M> for MaxPerformance and <M>SYNC</M>/<M>FASTSYNC</M> for
          MaxAvailability; <M>ASYNC</M> is the only mode listed under MaxPerformance, which is not the
          same as SYNC being illegal there.
        </P>
      ),
      apply: {
        patches: [
          { op: 'replace', path: '/members/1/logXptMode', value: 'ASYNC' },
          { op: 'replace', path: '/links/0/rttMs', value: 20 },
        ],
      },
    },
    {
      title: 'The destination is dropped — ReopenSecs and MaxFailure decide when redo flows again',
      prose: (
        <>
          <P>
            This panel starts after the failure: <M>NET_TIMEOUT</M> expired, the error was logged, the
            transport session was terminated, and <M>LOG_ARCHIVE_DEST_2</M> is closed — panel A of the
            NET_TIMEOUT figure in the SYNC transport lesson. The primary stays open read-write.{' '}
            <M>ReopenSecs</M> sets how soon transport may retry the destination, <M>MaxFailure</M>{' '}
            whether it ever stops trying; the protection mode changes what the outage costs fast-start
            failover, never when the destination reopens.
          </P>
          <Caption>Drawn in minutes.<Fn n={4} /></Caption>
        </>
      ),
    },
    {
      title: 'The gap is at least ReopenSecs',
      prose: (
        <P>
          Nothing reopens a failed destination sooner than one <M>ReopenSecs</M>. The property decides
          eligibility; the retry itself fires at the first log switch after the interval expires, so a
          busy database recovers faster than a quiet one. <M>REOPEN</M> applies to every error, not
          only connection failures.
        </P>
      ),
      apply: {
        patches: [{ op: 'replace', path: `${STANDBY_DEST}/reopenSeconds`, value: 900 }],
      },
      note: 'ReopenSecs at 900 s against a two-minute outage: the destination stays closed long after the network is back.',
    },
    {
      title: 'MaxFailure disables the destination',
      prose: (
        <P>
          <M>MaxFailure</M> counts consecutive reestablish attempts at log switches under 19c; the
          default for a destination in the default log-archive group — <M>LOG_ARCHIVE_DEST_2</M> here
          — is 0, no limit, while a RedoRoutes group defaults to 1. Reaching the limit disables the
          destination — no further access until it is manually reenabled, and <M>REOPEN</M> is then
          treated as unspecified.{' '}
          <Fact
            id="DEST.MAX_FAILURE_26AI"
            basis="documented"
          >
            26ai counts the initial failure too: MaxFailure = 1 makes no reactivation attempt at all,
            and above 1 attempts continue until the count is reached, then stop
          </Fact>
          . One documented exception, in both editions: destinations with the 12.2 <M>GROUP</M> and
          {' '}<M>PRIORITY</M> attributes re-enter service on their own.{' '}
          <Fact
            id="DEST.MAX_FAILURE"
            basis="model"
            note="'Consecutive' implies a reset, but the documentation never states one, so this page does not either."
          >
            Whether a successful reopen resets the counter is not documented
          </Fact>
          .
        </P>
      ),
      apply: {
        patches: [{ op: 'replace', path: `${STANDBY_DEST}/maxFailure`, value: 2 }],
      },
      note: 'Two attempts, then the destination is disabled — the network healing does not bring it back.',
    },
    {
      title: 'The lag limit expires during the outage',
      prose: (
        <P>
          With nothing arriving the standby falls behind in real time: <M>UNSYNCHRONIZED</M> from the
          first second in MaxAvailability, past <M>FastStartFailoverLagLimit</M> (default 30 s) in
          MaxPerformance. Either way, no failover is permitted until the destination ships again and
          the standby resynchronizes.
        </P>
      ),
      apply: {
        patches: [
          { op: 'replace', path: '/config/protectionMode', value: 'MAXPERFORMANCE' },
          { op: 'replace', path: '/config/fsfo/lagLimitSeconds', value: 30 },
        ],
      },
    },
  ],
};
