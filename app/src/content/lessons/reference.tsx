/**
 * Lesson 6 -- Reference.
 *
 * The tables and the footnotes. Everything here is data (`src/content/reference`),
 * so the same rows feed the print stylesheet and the tests.
 */

import { Fact, M } from '../facts-ui';
import { Footnotes } from '../footnotes';
import {
  RefTable, brokerProperties, changes26ai, transportProperties,
} from '../reference';
import { Caption, P } from '../prose';
import type { Lesson } from '../types';

export const reference: Lesson = {
  id: 'reference',
  title: 'Reference',
  presetId: 'classic',
  steps: [
    {
      title: 'What changed in 26ai',
      prose: (
        <>
          <P>
            Everything Oracle AI Database 26ai changes about the machinery on this page, against the
            19c baseline — including what arrived in 21c and 23ai, which a straight 19c-to-26ai upgrade
            picks up in the same step. The first three rows change behavior this page draws; the rest
            change what you type and what you can query, never when a failover happens.
          </P>
          <RefTable data={changes26ai} />
          <Caption>
            Deliberately unchanged in 26ai — most of the numbers this page draws:{' '}
            <M>FastStartFailoverThreshold</M> keeps its default 30 s and minimum 6 s, and the{' '}
            <M>ObserverPingInterval</M> / <M>ObserverPingRetry</M> mechanics are identical. Their{' '}
            <em>defaults</em> are murkier: the 26ai property pages give broker defaults of 0, meaning
            not set, while the fast-start failover chapter&rsquo;s table still shows 100 ms / 10, an
            upstream Oracle contradiction; the minimums when explicitly set stay 100 ms and 10.{' '}
            <M>FastStartFailoverPmyShutdown</M> is identical too.{' '}
            <M>FastStartFailoverLagLimit</M> is the one that moved: 30 s default and 5 s minimum still,
            but only in MaxPerformance — in MaxAvailability it now applies as well, with a broker
            default of 0. A 19c timeline read on this page is still correct under 26ai as long as
            MaxAvailability is left at that 0.
          </Caption>
          <Caption>
            The practitioner&rsquo;s walkthrough of all of it is{' '}
            <a
              class="ct-ext"
              href="https://www.ludovicocaldara.net/blog/dg-26ai-series/"
              target="_blank"
              rel="noreferrer"
            >
              Ludovico Caldara&rsquo;s Data Guard 26ai mini-series
            </a>{' '}
            (he is the Data Guard product manager; the numbered links above are its posts). The
            normative text is the{' '}
            <a
              class="ct-ext"
              href="https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/fast-start-failover2.html"
              target="_blank"
              rel="noreferrer"
            >
              26ai broker guide&rsquo;s fast-start failover chapter
            </a>{' '}
            and the{' '}
            <a
              class="ct-ext"
              href="https://docs.oracle.com/en/database/oracle/oracle-database/26/dgbkr/oracle-data-guard-broker-properties.html"
              target="_blank"
              rel="noreferrer"
            >
              26ai broker properties reference
            </a>
            .
          </Caption>
        </>
      ),
    },
    {
      title: 'The broker properties',
      prose: (
        <>
          <RefTable data={brokerProperties} />
          <Caption>
            Documented quirk: the <M>FastStartFailoverThreshold</M> property is ignored when the{' '}
            <M>ObserverPingRetry</M> and <M>ObserverPingInterval</M> properties are set. The ignore is
            documented; the exact arithmetic drawn here, interval × (retries + 1), is this page&rsquo;s
            model of the documentation&rsquo;s &ldquo;nearly 1 second.&rdquo;
          </Caption>
          <Caption>
            Where 26ai reports it: <M>V$FAST_START_FAILOVER_CONFIG</M> is the view for the fast-start
            failover configuration, replacing the deprecated <M>V$DATABASE.FS_FAILOVER_*</M> columns;{' '}
            <M>V$FS_LAG_HISTOGRAM</M> samples the lag per minute into buckets and is the tuning aid for{' '}
            <M>FastStartFailoverLagLimit</M>; <M>V$DG_BROKER_PROPERTY</M> lists the broker properties;
            and <M>V$DG_BROKER_CONFIG</M> gains <M>SWITCHOVER_READY</M> and <M>FAILOVER_READY</M>.
          </Caption>
          <Caption>
            Not new in 26ai:{' '}
            <Fact id="DGMGRL.VALIDATE_FSFO_19C">
              The VALIDATE FAST_START FAILOVER command enables you to validate a fast-start failover
              configuration
            </Fact>
            , and it is on the 19c command reference too.
          </Caption>
        </>
      ),
    },
    {
      title: 'Redo transport properties',
      prose: (
        <>
          <P>
            Transport plumbing, kept apart from the failover clocks above: none of these decides whether
            or when a failover happens. Each is a broker property whose value lands in a{' '}
            <M>LOG_ARCHIVE_DEST_n</M> attribute on the primary.
          </P>
          <RefTable data={transportProperties} />
          <Caption>
            Neither <M>ReopenSecs</M> nor <M>MaxFailure</M> is on 19c&apos;s list of deprecated broker
            properties (that list names nine initialization-parameter-backed properties such as{' '}
            <M>ArchiveLagTarget</M>); both stay documented properties whose values the broker writes
            into <M>REOPEN</M> and <M>MAX_FAILURE</M>, and <M>EDIT DATABASE ... SET PARAMETER</M> is a
            second route to the same attributes. Attribute semantics here follow the{' '}
            <M>LOG_ARCHIVE_DEST_n</M> reference rather than the broker properties page, whose rows state
            only the interval and the count.
          </Caption>
        </>
      ),
    },
    {
      title: 'Footnotes',
      prose: (
        <>
          <P>
            Which numbers on this page are drawing constants rather than documented figures, and which
            claims are this page&rsquo;s model of a sentence that stops short of one.
          </P>
          <Footnotes />
        </>
      ),
    },
  ],
};
