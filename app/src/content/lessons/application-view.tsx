/**
 * Lesson 3 -- The application's view.
 *
 * Legacy chapter 3: what the same failover costs a client that has both
 * databases in one connect string. These parameters govern NEW connections
 * only, and the lesson says so twice because it is the thing people carry away
 * wrong.
 */

import { Fact, M } from '../facts-ui';
import { Fn } from '../footnotes';
import { RefTable, clientParameters } from '../reference';
import { Caption, P } from '../prose';
import type { Lesson } from '../types';

const CLIENT = '/client';

export const applicationView: Lesson = {
  id: 'application-view',
  title: "The application's view",
  presetId: 'classic',
  steps: [
    {
      title: 'What the application sees, with both databases in one connect string',
      prose: (
        <>
          <P>
            <M>app_svc</M> runs only where the database is currently primary; the standby&rsquo;s
            listener refuses instantly with <M>ORA-12514</M>. The timeline follows the worst-case
            client: a request that starts connecting the moment the service stops being published.
          </P>
          <Caption>
            Scenario, protection mode and clocks are inherited from the topology and the events on the
            canvas.<Fn n={3} />
          </Caption>
        </>
      ),
    },
    {
      title: 'The service name is the switch',
      prose: (
        <P>
          A role-based service exists only where the database runs as primary (
          <M>srvctl add service -role PRIMARY</M>, or a startup trigger on <M>DATABASE_ROLE</M>).
          Nothing publishes <M>app_svc</M> on the standby, so its listener answers <M>ORA-12514</M>{' '}
          instantly — the refusal is what makes a two-address string safe.
        </P>
      ),
    },
    {
      title: 'Every traversal visits the dead address first',
      prose: (
        <P>
          With <M>LOAD_BALANCE</M> off the client walks the list in order: every traversal first pays{' '}
          <M>min(TRANSPORT_CONNECT_TIMEOUT, CONNECT_TIMEOUT)</M> on the unreachable host, including
          every fresh connection <em>after</em> the failover. <M>LOAD_BALANCE = ON</M> randomizes the
          order and halves the expected cost. One drawing assumption: each host resolves to a single
          IP — Oracle charges the timeouts per ADDRESS <em>and</em> per resolved IP, so a multi-record
          DNS name multiplies the toll.
        </P>
      ),
    },
    {
      title: 'The default string does not retry',
      prose: (
        <P>
          <Fact
            id="CLIENT.RETRY_AND_FAILOVER"
            basis="model"
            note="The Net Services reference prints no default for RETRY_COUNT or RETRY_DELAY; 'one traversal unless set' is this page's reading of the definition, drawn as RETRY_COUNT = 0."
          >
            <M>RETRY_COUNT</M> left unset means one traversal, then the error goes to the application
          </Fact>
          . The budget — (<M>RETRY_COUNT</M> + 1) × traversal + <M>RETRY_COUNT</M> × <M>RETRY_DELAY</M> —
          has to reach past the new primary&rsquo;s open.
        </P>
      ),
      apply: { patches: [{ op: 'replace', path: '/config/fsfo/thresholdSeconds', value: 90 }] },
      note: 'A 90 s threshold pushes the open past the default budget: the client gives up before the service comes back.',
    },
    {
      title: 'Short delays, many retries',
      prose: (
        <P>
          Oracle&rsquo;s HA guidance: a generous <M>CONNECT_TIMEOUT</M> (90 s in the documented
          example), a transport timeout around a second, and a short <M>RETRY_DELAY</M> with a high{' '}
          <M>RETRY_COUNT</M>.{' '}
          <Fact id="CLIENT.SWITCHOVER_BUDGET_100X3">
            Its switchover sizing example budgets <M>RETRY_COUNT</M> × <M>RETRY_DELAY</M> = 100 × 3 s
            = 300 s
          </Fact>
          .
        </P>
      ),
      apply: {
        patches: [
          { op: 'replace', path: `${CLIENT}/transportConnectTimeoutSeconds`, value: 3 },
          { op: 'replace', path: `${CLIENT}/connectTimeoutSeconds`, value: 90 },
          { op: 'replace', path: `${CLIENT}/retryCount`, value: 30 },
          { op: 'replace', path: `${CLIENT}/retryDelaySeconds`, value: 3 },
        ],
      },
    },
    {
      title: 'These parameters govern new connections only',
      prose: (
        <P>
          Already-connected sessions end by TCP rules — instant resets from a reachable host, long
          hangs across a partition — unless keepalives, <M>SQLNET.RECV_TIMEOUT</M> or FAN break them
          faster. TAF reconnects and can carry on a <M>SELECT</M> fetch, but active transactions are
          rolled back; Application Continuity, where it is configured, can replay eligible in-flight
          work, and a replay it cannot verify is rejected. This panel models <em>new</em> connections
          only.
        </P>
      ),
    },
    {
      title: 'In a switchover nothing is unreachable',
      prose: (
        <P>
          Both listeners answer throughout, so a planned swap never pays{' '}
          <M>TRANSPORT_CONNECT_TIMEOUT</M>: each traversal is two instant <M>ORA-12514</M>s, about
          0.4 s.{' '}
          <Fact
            id="CLIENT.RETRY_AND_FAILOVER"
            basis="model"
            note="0.2 s per refusal is a nominal drawing constant, not a documented figure (footnote 3)."
          >
            Only <M>RETRY_COUNT</M> and <M>RETRY_DELAY</M> matter
          </Fact>{' '}
          — the default string is finished half a second into a swap that takes half a minute.
        </P>
      ),
    },
    {
      title: 'When no failover is coming',
      prose: (
        <P>
          If the readiness check refuses the failover, the service is never republished: every
          traversal ends in <M>ORA-12514</M> and the application stays down until someone intervenes.
          Retry parameters only extend how long the client keeps trying.
        </P>
      ),
    },
    {
      title: 'The parameters, and where each one is placed',
      prose: (
        <>
          <RefTable data={clientParameters} />
          <Caption>
            Defaults per the Oracle 19c Net Services Reference (connect-descriptor timeout
            parameters); tuning guidance per the 19c High Availability Overview, &ldquo;Oracle Net TNS
            String Parameters.&rdquo; The JDBC thin driver does not inherit Oracle Net&rsquo;s 60 s
            transport default, so the generated thin URL always spells{' '}
            <M>TRANSPORT_CONNECT_TIMEOUT</M> out with an explicit <M>sec</M> suffix.
          </Caption>
        </>
      ),
    },
  ],
};
