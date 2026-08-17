/**
 * Lesson 9 -- Multiple observers and targets. New material, written from
 * `design/facts.md` sections C and D.
 *
 * Two traps have their own steps because they are the ones people get wrong:
 * the nomination rule only holds under its precondition, and the target list is
 * an order, never a race to whichever standby happens to be usable.
 */

import { observerId } from '@/engine';
import { Fact, M } from '../facts-ui';
import { Caption, Code, Dim, P } from '../prose';
import type { Lesson } from '../types';

export const multiObserver: Lesson = {
  id: 'multi-observer',
  title: 'Multiple observers and targets',
  presetId: 'multi-observer',
  steps: [
    {
      title: 'How many observers, and what the extra ones do',
      prose: (
        <>
          <P>
            <Fact id="OBS.THREE_19C">
              19c registers up to three observers: one is the master observer and the others are backup
              observers
            </Fact>
            .{' '}
            <Fact
              id={['OBS.FOUR_26AI', 'OBS.THREE_26AI_SHOW']}
              basis="conflict"
              note="26ai's fast-start failover chapter says four while its own SHOW OBSERVER page still says three. The move from three to four is documented from 21c (the 21c broker chapter already says four); the SHOW OBSERVER wording was never updated."
            >
              26ai says four in one place and three in another
            </Fact>
            , so this page draws four under 26ai and three under 19c, and labels the number rather than
            carrying one edition&rsquo;s figure into the other.
          </P>
          <Caption>
            <Fact id="OBS.MASTER_ONLY_COORDINATES">
              Only the master observer can coordinate fast-start failover
            </Fact>
            , and{' '}
            <Fact id="OBS.NO_MASTER_WHEN_DISABLED">
              when fast-start failover is disabled no observer is called the master observer; all
              observers have the same functionality
            </Fact>{' '}
            — which is why the <M>MASTER</M> chip on the canvas appears only while fast-start failover
            is enabled.
          </Caption>
        </>
      ),
    },
    {
      title: 'Nomination has a precondition — quote it with one',
      prose: (
        <P>
          <Fact id="OBS.NOMINATION_PRECONDITION">
            If the primary and target standby databases stay connected but the connection to the master
            observer is lost, then the broker tries to nominate a backup observer as the new master
            observer
          </Fact>
          . Both halves matter: it is an attempt, not a guarantee, and it is documented only for the
          case where the two databases still see each other.{' '}
          <Fact
            id={['OBS.NOMINATION_12_2', 'OBS.NOMINATION_PRECONDITION']}
            basis="conflict"
            note="The 12.2 release note claims the configuration is never in an unobserved state; the chapter's own wording carries the precondition. The precondition wording wins."
          >
            The release note that promises more than this is the weaker source
          </Fact>
          . A failure that separates the primary from its target is not the documented case, and this
          page does not nominate there.
        </P>
      ),
      apply: { events: [{ at: 0, kind: 'observer.stop', observer: observerId('obs01') }] },
      note: 'The master observer stops while both databases stay connected: the documented nomination case, and the only one drawn.',
    },
    {
      title: 'Starting them, naming them, moving the master',
      prose: (
        <>
          <P>
            <Fact id="OBS.START_FILE_IS">
              <M>START OBSERVER [observer-name] IN BACKGROUND CONNECT IDENTIFIER IS connect-identifier
              [FILE IS observer-file] [LOGFILE IS log-file]</M>
            </Fact>{' '}
            — the file arguments are keyword pairs, <M>FILE IS</M>, never <M>FILE</M> with an equals
            sign; the background form is the one the documentation calls preferred and it requires
            the connect identifier; the foreground form <M>START OBSERVER [name] [FILE IS f] [LOGFILE
            IS l]</M> takes none; and the DGMGRL <M>-logfile</M> option was deprecated in 12.2.{' '}
            <Fact
              id="OBS.SET_MASTEROBSERVER"
              note="Documented preconditions: the switch happens at the next primary-to-target contact, usually within three seconds while fast-start failover is enabled, and only if the target standby is enabled, needs no reinstatement, and no role change, reinstate or target switch is in progress."
            >
              <M>SET MASTEROBSERVER TO</M> moves the role by hand
            </Fact>
            .
          </P>
          <Code label="DGMGRL — three observers, one configuration">
            {'START OBSERVER obs_dc3 IN BACKGROUND CONNECT IDENTIFIER IS dg_cfg\n'}
            {'  FILE IS /u01/dg/obs_dc3.dat LOGFILE IS /u01/dg/obs_dc3.log;\n'}
            {'START OBSERVER obs_dc2 IN BACKGROUND CONNECT IDENTIFIER IS dg_cfg\n'}
            {'  FILE IS /u01/dg/obs_dc2.dat LOGFILE IS /u01/dg/obs_dc2.log;\n'}
            {'SET MASTEROBSERVER TO obs_dc3;\n'}
            <Dim>
              {'-- observer.ora under $DG_ADMIN carries the same set for\n'}
              {'-- START OBSERVING / STOP OBSERVING and configuration groups\n'}
            </Dim>
          </Code>
          <Caption>
            <Fact id="OBS.SHOW_OBSERVER_FIELDS">
              <M>SHOW OBSERVER</M> names each observer and gives its host, its master or backup role,
              and the last ping to the primary and to the target
            </Fact>
            .
          </Caption>
        </>
      ),
    },
    {
      title: 'Where they run',
      prose: (
        <P>
          Oracle&rsquo;s hierarchy has three rungs.{' '}
          <Fact id="OBS.PLACEMENT_THIRD_SITE">
            Ideally at a third site or third data center, so that the primary, observer and standby have
            isolated power, server, storage and network infrastructure
          </Fact>
          ; failing that,{' '}
          <Fact id="OBS.PLACEMENT_APP_PATH">
            have the observer use the same path to connect to the production database as is used by the
            application tier
          </Fact>{' '}
          — with the guide&rsquo;s own caveat that when the application tier is local to the production
          database the observer belongs at the standby location or a third data center instead; failing
          that,{' '}
          <Fact id="OBS.PLACEMENT_STANDBY_DC">
            in the standby data center, on a separate host, isolated as much as possible from failures
            affecting the standby database
          </Fact>
          . And in every case{' '}
          <Fact id="OBS.PLACEMENT_NEVER_ON_DB_HOST">
            the observer should never be deployed at the primary database server or cluster, or on the
            standby database server or cluster
          </Fact>
          . The primary&rsquo;s own site is not on that hierarchy at all: a site failure takes the
          observer with the primary, and an observer on one side of a cut cannot arbitrate it.
        </P>
      ),
    },
    {
      title: 'PreferredObserverHosts',
      prose: (
        <P>
          <Fact id="OBS.PREFERRED_HOSTS">
            Only observers running on hosts named in <M>PreferredObserverHosts</M> will observe
            databases and become the master observer
          </Fact>
          . The value is <M>host:priority</M> with priorities 1 to 8, lower winning, 8 the default, and
          the property itself defaulting to Null — which restricts nothing.
        </P>
      ),
    },
    {
      title: 'More than one target: an order, not a race',
      prose: (
        <P>
          <Fact id="FSFO.MULTI_TARGET_12_2">
            <M>FastStartFailoverTarget</M> has taken a list since 12.2
          </Fact>
          . The 19c property page calls them{' '}
          <Fact id="FSFO.TARGET_ORDER">
            candidate targets, and says the broker selects a target based on the order in which they
            are specified
          </Fact>
          . Say &ldquo;order&rdquo;, never a race down the list to whichever standby happens to be
          usable — the documentation describes no such walk.{' '}
          <Fact id="FSFO.TARGET_AUTO_CHANGE">
            If the designated target develops a problem, the broker automatically changes the
            fast-start failover target to one of the other candidate targets
          </Fact>
          , and{' '}
          <Fact id="FSFO.TARGET_VERIFIED_ON_ENABLE">
            targets are verified when fast-start failover is enabled
          </Fact>
          .{' '}
          <Fact id="FSFO.TARGET_MUST_BE_EXPLICIT">
            With more than one standby database the property must be set explicitly
          </Fact>
          , and{' '}
          <Fact id="FSFO.TARGET_KIND">
            it can only name physical or logical standbys
          </Fact>
          .
        </P>
      ),
      apply: {
        patches: [
          {
            op: 'replace',
            path: '/config/fsfo/target',
            value: { kind: 'list', members: ['sby01', 'sby02'] },
          },
        ],
      },
      note: 'Two candidate targets. Take the first one down and watch which member the broker moves to — and how this page labels that choice.',
    },
    {
      title: 'What happens to the standbys that are not the target',
      prose: (
        <P>
          <Fact id="BYSTANDERS.DEFAULT_ALL">
            <M>BystandersFollowRoleChange</M> defaults to ALL
          </Fact>
          , so the other standbys are expected to follow the new primary after a complete failover.{' '}
          <Fact
            id="BYSTANDERS.DEFAULT_ALL"
            basis="model"
            note="Observer connectivity is documented to the primary and the target standby only; nothing states how the observer treats a non-target standby."
          >
            How the observer treats a standby that is not a target is not documented
          </Fact>
          , so the canvas draws its ping to the primary and the target only.
        </P>
      ),
    },
    {
      title: 'Two standbys are also a protection-mode recommendation',
      prose: (
        <P>
          In MaxProtection the primary{' '}
          <Fact id="MAXPROT.SHUTS_PRIMARY">
            shuts down rather than allowing it to continue
          </Fact>{' '}
          <Fact id="MAXPROT.AT_LEAST_ONE_BROKER">
            if it cannot write its redo stream to at least one synchronized standby database
          </Fact>
          , which is why{' '}
          <Fact id="MAXPROT.TWO_STANDBYS">
            Oracle recommends a minimum of two standby databases, to prevent a single standby database
            failure from causing the primary database to shut down
          </Fact>
          . MaxAvailability has the explicit escape instead:{' '}
          <Fact id="MAXAVAIL.AT_LEAST_ONE">
            if the primary does not receive acknowledgement from at least one synchronized standby, it
            operates as if it were in maximum performance mode
          </Fact>
          .
        </P>
      ),
    },
    {
      title: 'Observe-only: everything watched, nothing promoted',
      prose: (
        <P>
          <Fact id="OBS.OBSERVE_ONLY">
            <M>ENABLE FAST_START FAILOVER OBSERVE ONLY</M> arms the observers for reporting only; an
            attempt is answered with &ldquo;Unable to failover since this observer is in observe-only
            mode&rdquo;
          </Fact>
          . The primary may open without acknowledgement, and switchover or failover to a bystander
          stays allowed. It is a third state, distinct both from fast-start failover being enabled and
          from{' '}
          <Fact id="FSFO.STATUS_DISABLED">
            <M>FS_FAILOVER_STATUS</M> reading <M>DISABLED</M> because it was never enabled
          </Fact>
          .
        </P>
      ),
      apply: {
        patches: [{ op: 'replace', path: '/config/fsfo/state', value: 'observe-only' }],
      },
      note: 'Observe-only: the clocks still run on the timeline, and the outcome is still nothing promoted.',
    },
  ],
};
