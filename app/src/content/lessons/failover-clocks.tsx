/**
 * Lesson 1 -- Failover clocks.
 *
 * The legacy chapter 1 note grid ("What the timeline shows"), one note per
 * step, with the demo parameters that note carried as the step's `apply`.
 * Prose ported by copy: the accuracy rules govern every sentence here.
 */

import { CLASSIC_IDS, hostId } from '@/engine';
import { Fact, M } from '../facts-ui';
import { Fn } from '../footnotes';
import { P } from '../prose';
import type { Lesson } from '../types';

const PRIMARY_HOST = hostId('dc1-prm01');

/** The classic preset's member order: 0 = prm01, 1 = sby01. */
const STANDBY = '/members/1';

export const failoverClocks: Lesson = {
  id: 'failover-clocks',
  title: 'Failover clocks',
  presetId: 'classic',
  steps: [
    {
      title: 'The threshold is a reconnect window',
      prose: (
        <P>
          <M>FastStartFailoverThreshold</M> is how long the master observer keeps trying to reconnect,
          counted from the moment it first lost the connection, not a timeout on a single ping. That
          moment is t = 0 here.<Fn n={1} />
        </P>
      ),
      apply: { events: [{ at: 0, kind: 'host.down', host: PRIMARY_HOST }] },
      note: 'The primary host crashes at t = 0; everything else is at its default.',
    },
    {
      title: 'Both the observer and the standby must have lost the primary',
      prose: (
        <P>
          Fast-start failover requires the observer <em>and</em> the target standby to have both lost
          the primary for the threshold. If the standby can still reach the primary, there is no
          failover. That is the default <M>ObserverOverride</M> = FALSE behavior; set it TRUE and the
          observer may initiate a failover once it has lost the primary even while the standby still
          reaches it. Everything on this page assumes the default.
        </P>
      ),
    },
    {
      title: 'Readiness depends on the protection mode',
      prose: (
        <P>
          In MaxAvailability and MaxProtection the standby must have been synchronized at failure
          time. In MaxPerformance its apply lag must be at or below <M>FastStartFailoverLagLimit</M> —
          under 26ai, MaxAvailability carries that same lag limit, defaulting to 0.<Fn n={5} /> If the
          check fails, failover is not permitted.
        </P>
      ),
      apply: {
        events: [{ at: 0, kind: 'host.down', host: PRIMARY_HOST }],
        patches: [
          { op: 'replace', path: '/config/protectionMode', value: 'MAXPERFORMANCE' },
          { op: 'replace', path: `${STANDBY}/applyLagSeconds`, value: 45 },
          { op: 'replace', path: '/config/fsfo/lagLimitSeconds', value: 30 },
        ],
      },
      note: 'A 45 s apply lag against a 30 s limit: the check refuses the failover.',
    },
    {
      title: 'No broker property shortens execution',
      prose: (
        <P>
          Once initiated, the standby applies the redo it already holds, converts to the primary role,
          and opens read-write. That span depends on the apply lag at failure time and on the
          environment.<Fn n={2} />
        </P>
      ),
    },
    {
      title: 'The ping properties override the threshold',
      prose: (
        <P>
          <M>ObserverPingInterval</M> and <M>ObserverPingRetry</M> do not exist in 19c — neither
          property is on the 12.2, 18c or 19c pages, or in a live 19.27 system. Documented from 21c:
          per the broker documentation, <M>FastStartFailoverThreshold</M> is ignored once both are
          set. That much is documented; the arithmetic is not. The documentation says only that
          detection can be reduced to nearly one second, and{' '}
          <Fact
            id={['FSFO.PING_NEARLY_ONE_SECOND', 'FSFO.PING_PROPS_21C']}
            basis="model"
            note="The first failed ping plus its retries. The documentation gives no formula, only 'nearly 1 second'."
          >
            interval × (retries + 1)
          </Fact>{' '}
          — the first failed ping plus its retries — is this page&rsquo;s model of it.
        </P>
      ),
      apply: {
        events: [{ at: 0, kind: 'host.down', host: PRIMARY_HOST }],
        patches: [
          { op: 'replace', path: '/config/edition', value: '26ai' },
          { op: 'replace', path: '/config/fsfo/pingIntervalMs', value: 100 },
          { op: 'replace', path: '/config/fsfo/pingRetry', value: 10 },
        ],
      },
      note: 'Read under 26ai: both ping properties set, detection collapses to about a second. Neither property exists in 19c.',
    },
    {
      title: 'An isolated primary runs its own clock',
      prose: (
        <P>
          Cut off from both the observer and the standby, the primary stalls (
          <M>V$DATABASE.FS_FAILOVER_STATUS</M> goes to <M>STALLED</M>) and, if{' '}
          <M>FastStartFailoverPmyShutdown</M> is TRUE, shuts down after one threshold.
        </P>
      ),
      apply: {
        events: [
          { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 },
          { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc3 },
        ],
      },
      note: 'Every link out of the primary site is cut; the primary itself never dies.',
    },
    {
      title: 'In a switchover, t = 0 is a command',
      prose: (
        <P>
          t = 0 is a DBA issuing <M>SWITCHOVER TO</M> in DGMGRL; nothing has to be detected, so no
          clock runs and neither <M>FastStartFailoverThreshold</M> nor the <M>ObserverPing</M>{' '}
          properties are consulted. The observer is a spectator; what fast-start failover
          contributes is a gate —{' '}
          <Fact id="SWITCHOVER.FSFO_GATE">
            with it enabled you may switch over only to the fast-start failover target standby
          </Fact>
          .<Fn n={3} />
        </P>
      ),
      apply: { events: [{ at: 0, kind: 'cmd.switchover', to: CLASSIC_IDS.standby }] },
    },
    {
      title: 'A switchover loses nothing, in any mode',
      prose: (
        <P>
          The roles swap only once the target holds all the redo — the catch-up band on the timeline;
          an apply lag lengthens it but costs no data. With fast-start failover enabled the broker
          allows a switchover only to the target standby, and in MaxPerformance only while the lag is
          inside <M>FastStartFailoverLagLimit</M>; past that, the command is refused.
        </P>
      ),
      apply: {
        events: [{ at: 0, kind: 'cmd.switchover', to: CLASSIC_IDS.standby }],
        patches: [
          { op: 'replace', path: '/config/protectionMode', value: 'MAXPERFORMANCE' },
          { op: 'replace', path: `${STANDBY}/applyLagSeconds`, value: 45 },
          { op: 'replace', path: '/config/fsfo/lagLimitSeconds', value: 30 },
        ],
      },
      note: 'Past the lag limit in MaxPerformance the SWITCHOVER command is refused.',
    },
    {
      title: 'The former primary is the one that restarts',
      prose: (
        <P>
          The broker restarts the old primary as part of the switchover — that restart is what ends
          its sessions — before starting Redo Apply in its new standby role; the downtime window runs
          from there to the new primary&rsquo;s read-write open. The documentation is explicit that
          the <em>new</em> primary does not need to be restarted and does not wait for the old one.
        </P>
      ),
    },
    {
      title: 'An unobserved configuration cannot fail over',
      prose: (
        <P>
          The primary still commits and the standby still applies, and which database you query
          decides what you see: on the primary <M>V$DATABASE.FS_FAILOVER_STATUS</M> stays{' '}
          <M>SYNCHRONIZED</M> while <M>FS_FAILOVER_OBSERVER_PRESENT</M> reads <M>NO</M>; the target
          standby is where <M>FS_FAILOVER_STATUS</M> reads <M>PRIMARY UNOBSERVED</M>. In time the
          broker raises <M>ORA-16820</M>.{' '}
          <Fact
            id={['OBS.THREE_19C', 'OBS.FOUR_26AI']}
            basis="conflict"
            note="19c registers three; the 26ai fast-start failover chapter says four while its own SHOW OBSERVER page still says three."
          >
            19c registers up to three observers
          </Fact>
          ; if the master is lost while primary and standby stay connected, the broker tries to
          nominate a backup as the new master; nomination is an attempt, and only in that connected
          case, not a guarantee.
        </P>
      ),
      apply: {
        events: [
          { at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc3 },
        ],
      },
      note: 'Only the link between the primary and the observer is cut: the standby still reaches both, which is the documented condition below.',
    },
    {
      title: 'A third site is what arbitrates a partition',
      prose: (
        <P>
          When only the link between the two database sites fails, an observer at a third site still
          reaches the primary. No threshold ever starts, nothing is promoted, and a healthy primary
          keeps serving — the case Oracle&rsquo;s first placement recommendation is written for.
        </P>
      ),
      apply: { events: [{ at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 }] },
    },
    {
      title: 'The same partition, an observer beside the standby',
      prose: (
        <P>
          Move the observer into the standby&rsquo;s site and the cut takes it away with the standby.
          Both clocks run out and the standby is promoted; the primary, which never stopped serving,
          stalls and — with <M>FastStartFailoverPmyShutdown</M> TRUE — shuts down at the threshold.
        </P>
      ),
      /* The observer moves by being given a host in DC 2 -- a host of its own,
         because an observer "should never be deployed at the primary database
         server or cluster, or on the standby database server or cluster". */
      apply: {
        patches: [
          {
            op: 'add',
            /* The classic preset carries three hosts, so this appends. */
            path: '/hosts/3',
            value: { id: 'dc2-obs01', name: 'dc2-obs01', site: 'dc2', listenerPort: 1521 },
          },
          { op: 'replace', path: '/observers/0/host', value: 'dc2-obs01' },
        ],
        events: [{ at: 0, kind: 'link.cut', link: CLASSIC_IDS.linkDc1Dc2 }],
      },
      note: 'The observer moves to a host of its own in DC 2, then the DC 1 to DC 2 link is cut: the placement is where the card sits, not a setting.',
    },
    {
      title: 'Losing the standby site can stop the primary',
      prose: (
        <P>
          An observer in the standby&rsquo;s data centre dies with it. The primary then reaches neither
          the observer nor the standby, so it stalls from t = 0 and shuts down one threshold later —
          with no standby left to promote. The spare site takes production down with it.
        </P>
      ),
      apply: { events: [{ at: 0, kind: 'site.down', site: CLASSIC_IDS.siteDc2 }] },
      note: 'With the observer in DC 3 the primary keeps serving; move it to DC 2 and this is what the same event costs.',
    },
    {
      title: 'Deploying no observer is not the same as losing one',
      prose: (
        <P>
          Enabling fast-start failover needs no observer running — Oracle allows it, and raises{' '}
          <M>ORA-16819</M> on the primary and target standby until one starts. This page instead
          disables fast-start failover before the crash: the <M>FastStartFailover*</M> properties can
          be set, but nothing arms them, and <M>V$DATABASE.FS_FAILOVER_STATUS</M> simply reads{' '}
          <M>DISABLED</M>. <M>FAILOVER TO</M> is then the only thing that promotes the standby — it
          needs no observer while fast-start failover is disabled, subject to the broker&rsquo;s
          ordinary failover prerequisites.
        </P>
      ),
      apply: {
        events: [
          { at: 0, kind: 'observer.stop', observer: CLASSIC_IDS.observer },
          { at: 0, kind: 'cmd.disableFsfo' },
          { at: 5, kind: 'host.down', host: PRIMARY_HOST },
        ],
      },
      note: 'Fast-start failover disabled before the crash: nothing is armed, and only a manual FAILOVER TO promotes the standby.',
    },
  ],
};
