/**
 * Lesson 5 -- SYNC transport.
 *
 * Legacy chapter 5, the three side topics: what to set and measure before the
 * first SYNC commit (SDU, socket buffers, oratcptest), what a commit waits for
 * once SYNC is on (the nested wait events), and where NET_TIMEOUT fits.
 */

import { CommitNestingFigure } from '../figures/CommitNestingFigure';
import { NetTimeoutFigure } from '../figures/NetTimeoutFigure';
import { Fact, M } from '../facts-ui';
import { RefTable, awrCapture } from '../reference';
import { Caption, Code, Dim, Figure, Hl, P } from '../prose';
import type { Lesson } from '../types';

export const syncTransport: Lesson = {
  id: 'sync-transport',
  title: 'SYNC transport',
  presetId: 'classic',
  steps: [
    {
      title: 'SDU, socket buffers, and measuring the network before Data Guard uses it',
      prose: (
        <>
          <P>
            Two Oracle Net settings and one measurement, worth doing before the first <M>SYNC</M>{' '}
            commit: the session data unit (the buffer Oracle Net fills before sending), the socket
            buffers underneath it (how much can be in flight at once), and <M>oratcptest</M>, which
            makes the same round trip redo transport will make.
          </P>
          <Caption>None of this moves a failover clock.</Caption>
        </>
      ),
    },
    {
      title: 'SDU is the unit Oracle Net ships',
      prose: (
        <P>
          SDU is how much data Oracle Net buffers before sending; default 8192 bytes, range 512 bytes
          to 2 MB. It is negotiated per connection and the smaller end wins, so set it on the
          primary&rsquo;s transport alias and on the standby&rsquo;s listener.
        </P>
      ),
    },
    {
      title: '65535 is a recommendation for SYNC, not a requirement',
      prose: (
        <P>
          Oracle&rsquo;s HA best practices: <M>SDU</M> = 65535 improved synchronous transport in their
          testing, and the recommendation is scoped to SYNC only. It is neither a prerequisite (
          <M>SYNC</M> runs at the default) nor the ceiling (<M>DEFAULT_SDU_SIZE</M> goes to 2 MB).
        </P>
      ),
    },
    {
      title: 'SEND_BUF_SIZE and RECV_BUF_SIZE are the socket buffers',
      prose: (
        <P>
          These two parameters set the TCP socket buffer space Oracle Net requests, on both ends of the
          link. Defaults are OS-specific (Linux 2.6: 16 KB send, 87380 bytes receive). They go in{' '}
          <M>sqlnet.ora</M>, or per descriptor in <M>tnsnames.ora</M> / <M>listener.ora</M> at{' '}
          <M>DESCRIPTION</M> or <M>ADDRESS</M> level. The value is a request; the OS may grant less.
        </P>
      ),
    },
    {
      title: 'How big: the bandwidth-delay product',
      prose: (
        <>
          <P>
            BDP = link capacity × round-trip latency. Net Services asks for buffers of at least one BDP
            (its worked example: 100 Mbit/s at 5 ms ≈ 64 KB, or up to the largest redo message); the HA
            guide raises that to 3 × BDP for a high-latency, high-bandwidth network. Buffer space is
            charged per connection — check the total across concurrent connections.
          </P>
          <Code label="tnsnames.ora + listener.ora — SDU and socket buffers, both ends">
            <Dim>
              {'# Primary: the alias redo transport resolves. SDU and the socket\n'}
              {'# buffers sit in DESCRIPTION; the buffers may also go in an ADDRESS.\n'}
            </Dim>
            {'<standby_alias> =\n  (DESCRIPTION =\n    ('}
            <Hl>SDU = 65535</Hl>
            {')\n    ('}
            <Hl>{'SEND_BUF_SIZE = <3 x BDP>'}</Hl>
            {')\n    ('}
            <Hl>{'RECV_BUF_SIZE = <3 x BDP>'}</Hl>
            {')\n    (ADDRESS = (PROTOCOL = TCP)(HOST = <standby-host>)(PORT = 1521))\n'}
            {'    (CONNECT_DATA = (SERVICE_NAME = <standby_db>))\n  )\n\n'}
            <Dim>
              {'# Standby: listener.ora, the other end of the same connection. SDU is\n'}
              {'# a property of the service, the buffers of the endpoint.\n'}
            </Dim>
            {'SID_LIST_LISTENER =\n  (SID_LIST =\n    (SID_DESC =\n      ('}
            <Hl>SDU = 65535</Hl>
            {')\n      (GLOBAL_DBNAME = <standby_db>)\n      (SID_NAME = <standby_db>)\n    )\n  )\n'}
            {'LISTENER =\n  (DESCRIPTION =\n    ('}
            <Hl>{'SEND_BUF_SIZE = <3 x BDP>'}</Hl>
            {')\n    ('}
            <Hl>{'RECV_BUF_SIZE = <3 x BDP>'}</Hl>
            {')\n    (ADDRESS = (PROTOCOL = TCP)(HOST = <standby-host>)(PORT = 1521))\n  )\n\n'}
            <Dim>
              {'# BDP = link capacity x round-trip latency. Net Services asks for at\n'}
              {'# least one BDP, the HA guide for at least 3 x BDP on a high-latency,\n'}
              {'# high-bandwidth link. The Net Services worked example:\n'}
              {'#   100 Mbit/s x 5 ms / 8 bits = 62500 bytes, about 64 KB\n#\n'}
              {'# Or once for every Oracle Net connection on the host, in sqlnet.ora:\n'}
              {'#   DEFAULT_SDU_SIZE = 65535        (default 8192, range 512 - 2097152)\n'}
              {'#   SEND_BUF_SIZE    = <3 x BDP>    (defaults are OS-specific; Linux 2.6\n'}
              {'#   RECV_BUF_SIZE    = <3 x BDP>     is 16 KB send, 87380 bytes receive)\n#\n'}
              {'# The HA guide gets there the other way: leave each socket to the TCP\n'}
              {'# stack and raise the kernel maximum instead. Its own Linux example,\n'}
              {'# as root, sets a 16 MB ceiling and leaves the other two values alone:\n'}
              {"#   sysctl -w net.ipv4.tcp_rmem='4096 87380 16777216'\n"}
              {"#   sysctl -w net.ipv4.tcp_wmem='4096 16384 16777216'\n"}
            </Dim>
          </Code>
        </>
      ),
    },
    {
      title: 'oratcptest makes the round trip for you',
      prose: (
        <>
          <P>
            <M>oratcptest.jar</M> is MOS note 2064368.1: JRE 6+, any OS user, no database — one process
            listens on the standby host, another sends from the primary. SYNC mode waits for each
            acknowledgement, the shape of a <M>SYNC</M> commit; ASYNC mode never waits.
          </P>
          <Code label="oratcptest — the same round trip, before Data Guard makes it">
            <Dim>
              {'# Standby host: the receiving side. -file gives it somewhere to write\n'}
              {'# each message, which -write on the client then asks it to do.\n'}
            </Dim>
            {'java -jar oratcptest.jar -server <standby-host> -port=<free port> -file=/u01/tmp/oratcp.tmp\n\n'}
            <Dim>
              {'# Primary host: SYNC, so every message waits for its acknowledgement,\n'}
              {'# the way LGWR waits under SYNC AFFIRM. -length is your average redo\n'}
              {'# write size: "redo size" / "redo writes", from AWR or V$SYSSTAT.\n'}
            </Dim>
            {'java -jar oratcptest.jar <standby-host> -port=<free port> '}
            <Hl>-mode=sync</Hl>
            {' -length=20480 -write -duration=120s -interval=20s\n\n'}
            <Dim>
              {'# The same run without -write drops the standby disk write -- which is\n'}
              {'# the write FASTSYNC does not wait for. -mode=async, -num_conn=<n> and\n'}
              {'# -output=<file> cover the ASYNC shape.\n#\n'}
              {'# Each run also reports the socket buffer size it used -- half of the\n'}
              {'# real one, per the guide, so double it. Do NOT reach for -sockbuf: the\n'}
              {'# guide says an explicit request answers to different kernel parameters\n'}
              {'# than the ones the test is measuring.\n#\n'}
              {'# The Oracle HA guide documents -server, -port, -mode, -duration, -interval,\n'}
              {'# -num_conn, -output and -freq; -length, -write and -file come from the\n'}
              {'# MOS note. Run "java -jar oratcptest.jar -help" for what your copy takes.\n'}
            </Dim>
          </Code>
          <Caption>
            The client prints throughput, per-message latency, and the socket buffer size used. In SYNC
            mode that latency is the floor under the commit timeline. Double the buffer figures and
            compare against the BDP; a buffer smaller than the data in flight throttles either mode.
          </Caption>
        </>
      ),
    },
    {
      title: 'What a commit waits for — log file sync and the events inside it',
      prose: (
        <>
          <Figure
            caption={
              <>
                Turn <M>SYNC</M> on and the <M>log file sync</M> average moves first — the number
                Oracle warns not to judge <M>SYNC</M> by. The events nest; reading an AWR report means
                knowing which contains which.
              </>
            }
          >
            <CommitNestingFigure />
          </Figure>
          <P>
            <M>log file sync</M> is the whole cycle the committing session sees. Inside it,{' '}
            <M>redo write time</M> covers LGWR&rsquo;s write; inside that run the two legs,{' '}
            <M>log file parallel write</M> (local) and <M>SYNC remote write</M>. LGWR starts the remote
            write first and waits for it after the local one, so a commit pays the longer leg, not
            both.
          </P>
        </>
      ),
    },
    {
      title: 'One of the five is not a wait event',
      prose: (
        <P>
          <M>redo write time</M> is a <M>V$SYSSTAT</M> statistic in centiseconds, not a wait event.
          Multiply a per-write average from it by ten before comparing it with a wait event&rsquo;s
          millisecond average.
        </P>
      ),
    },
    {
      title: 'The average misleads',
      prose: (
        <P>
          Oracle does not recommend judging SYNC by <M>log file sync</M> wait times: commits are
          batched, one slow write makes many sessions wait, and the average follows the outliers. Watch
          the transaction rate and redo rate from AWR for OLTP, elapsed time for batch; read the event
          as a histogram.
        </P>
      ),
    },
    {
      title: 'Measure before and after on the same workload',
      prose: (
        <>
          <P>
            Capture the same AWR metrics on the same workload before and after enabling SYNC.
            Oracle&rsquo;s worked example: redo rate unchanged, <M>log file sync</M> average 0.68 ms to
            4.60 ms, transactions per second down 20.3%, redo writes down 61% with the average write up
            94% (commit batching). Their numbers, on their test system — never a prediction for yours.
          </P>
          <RefTable data={awrCapture} />
          <Caption>
            <M>V$DATAGUARD_STATS</M> carries the transport and apply lag afterwards; read{' '}
            <M>DATUM_TIME</M> beside them — on a quiet configuration a lag can be older than it looks.{' '}
            <M>V$STANDBY_EVENT_HISTOGRAM</M> keeps the history.
          </Caption>
        </>
      ),
    },
    {
      title: 'Where NET_TIMEOUT fits, and where it does not',
      prose: (
        <>
          <Figure
            caption={
              <>
                <M>NET_TIMEOUT</M> (broker property <M>NetTimeout</M>) is a <M>LOG_ARCHIVE_DEST_n</M>{' '}
                attribute on the primary, not a failover clock: it caps how long LGWR waits for a SYNC
                acknowledgement before the error is logged, the transport session terminated, and the
                destination dropped. Both it and <M>FastStartFailoverThreshold</M> default to 30 s,
                which is why the two get confused; the panels span the same window, and panel B
                shortens <M>NET_TIMEOUT</M> to 10 s to show why data still is not lost.
              </>
            }
          >
            <NetTimeoutFigure />
          </Figure>
          <P>
            &ldquo;<M>NET_TIMEOUT</M> 10 s, threshold 30 s — do I lose 20 s of redo?&rdquo; No.{' '}
            <M>NET_TIMEOUT</M> expiring only brings the primary to a decision point; whether it may
            continue without its standby is a separate check, and an isolated primary fails it.
          </P>
        </>
      ),
      apply: {
        patches: [{ op: 'replace', path: '/members/0/dests/sby01/netTimeoutSeconds', value: 10 }],
      },
      note: 'NET_TIMEOUT at 10 s against the default 30 s threshold — the figure’s panel B, in the workbench.',
    },
    {
      title: 'Continuing alone requires the observer or the standby',
      prose: (
        <P>
          With fast-start failover enabled, a MaxAvailability primary may drop to <M>UNSYNCHRONIZED</M>{' '}
          and keep committing only while it can reach the observer or the target standby. In panel A
          the observer is reachable, so it carries on; in panel B nobody answers, so redo generation
          stalls (<M>FS_FAILOVER_STATUS</M> = <M>STALLED</M>).
        </P>
      ),
    },
    {
      title: 'Why the failover still loses nothing',
      prose: (
        <>
          <P>
            Under SYNC a commit is not acknowledged until the standby holds its redo, so every
            acknowledged transaction is on the standby when it opens. Commits issued during the stall
            hang until the old primary aborts, then get errors — nothing is lost silently. The
            acknowledgement wait begins the moment the acknowledgements stop, so{' '}
            <Fact
              id="DEST.NET_TIMEOUT"
              basis="inferred"
              note="The two documented pieces are the NET_TIMEOUT bound and the rule that a fast-start failover primary may not continue alone; the composition is this page's."
            >
              a shorter <M>NET_TIMEOUT</M> only moves the transport-error / <M>STALLED</M> boundary
              inside the stall, never the outcome
            </Fact>
            .
          </P>
          <Caption>
            In MaxPerformance (ASYNC) commits never wait for the standby, so <M>NET_TIMEOUT</M> never
            touches user sessions and never appears on the failover timeline; eligibility and data loss
            are bounded by <M>FastStartFailoverLagLimit</M> instead.
          </Caption>
        </>
      ),
    },
  ],
};
