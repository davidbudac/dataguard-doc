/**
 * Lesson 7 -- Far sync. New material, written from `design/facts.md` section A.
 *
 * Every claim carries its citation; the four places the fact sheet marks UNDOC
 * or CONFLICT carry a chip saying so, because a far sync topology is where the
 * documentation runs out fastest.
 */

import { linkId, memberId } from '@/engine';
import { Fact, M } from '../facts-ui';
import { Caption, Code, Dim, P } from '../prose';
import type { Lesson } from '../types';

export const farSync: Lesson = {
  id: 'far-sync',
  title: 'Far sync',
  presetId: 'far-sync',
  steps: [
    {
      title: 'What a far sync instance is',
      prose: (
        <>
          <P>
            <Fact id="FS.MANAGES_CONTROLFILE">
              A far sync instance manages a control file, receives redo into standby redo logs, and
              archives those SRLs to local archived redo logs
            </Fact>
            . It{' '}
            <Fact id="FS.NO_DATAFILES">
              has no user data files, cannot be opened for access, cannot run redo apply, and can never
              function in the primary role or be converted to any type of standby database
            </Fact>
            . It is a transport hop, not a database: on the canvas it is a cylinder with a chevron and
            no base, and it carries no broker state column, because{' '}
            <Fact id="FS.NO_BROKER_STATE">far sync instances have no broker states</Fact>.
          </P>
          <Caption>
            <Fact id="FS.SRL_NOT_SHARED">
              Standby redo log files used at the far sync instance cannot be shared with other
              databases
            </Fact>
            .{' '}
            <Fact id="FS.ADG_LICENCE">
              Far sync instances are part of the Oracle Active Data Guard Far Sync feature, which
              requires an Oracle Active Data Guard license
            </Fact>
            .
          </Caption>
        </>
      ),
    },
    {
      title: 'The direct link is still required',
      prose: (
        <P>
          A far sync edge does not replace the primary-to-standby link.{' '}
          <Fact id="FS.DIRECT_LINK_REQUIRED">
            There must still be a direct network connection between the primary database and the remote
            standby database, used to perform health checks and switchover processing tasks
          </Fact>
          . Cut that link on the canvas and the redo still flows through the far sync while the
          configuration loses the path its health checks and switchover processing need.
        </P>
      ),
      /* To cut the direct link and leave the redo path alone, the two have to
         be different links: the far sync moves to the third site for this
         step -- Example 5-5's placement, a far sync near the standby -- and
         then DC 1 to DC 2 carries nothing but the health checks. */
      apply: {
        patches: [
          {
            op: 'add',
            /* The preset carries four hosts, so this appends. */
            path: '/hosts/4',
            value: { id: 'dc3-fs1', name: 'dc3-fs1', site: 'dc3', listenerPort: 1521 },
          },
          { op: 'replace', path: '/members/1/instances/0/host', value: 'dc3-fs1' },
        ],
        events: [{ at: 0, kind: 'link.cut', link: linkId('dc1-dc2') }],
      },
      note: 'The far sync sits at the third site here, so cutting the primary-to-standby link leaves the redo path alone: redo keeps flowing through the far sync, and what the configuration has lost is the path its health checks and switchover processing need.',
    },
    {
      title: 'Two hops, two transport modes',
      prose: (
        <>
          <P>
            The first hop is the synchronous one — with <M>SYNC</M>,{' '}
            <Fact id="FS.SYNC_TO_FARSYNC">
              all committed redo resides on disk at the far sync instance
            </Fact>{' '}
            — and the second is not:{' '}
            <Fact id="FS.ONWARD_ASYNC">
              the far sync instance uses ASYNC transport to ship the incoming redo to terminal standbys
            </Fact>
            . Under fast-start failover that pairing is mandatory:{' '}
            <Fact id="FSFO.FARSYNC_XPT">
              the far sync instance transport mode must be set to either SYNC or FASTSYNC and the target
              standby database transport mode must be set to ASYNC
            </Fact>
            .
          </P>
          <P>
            <Fact
              id="FS.ONWARD_ASYNC"
              basis="model"
              note="The documentation describes the onward hop as ASYNC and never forbids SYNC there. This page reports the configuration rather than refusing it."
            >
              A SYNC onward hop is undocumented rather than forbidden
            </Fact>{' '}
            — the validation panel warns, and says which of the two it is.
          </P>
        </>
      ),
    },
    {
      title: 'Which protection modes, and where Oracle disagrees with itself',
      prose: (
        <P>
          <Fact
            id={['FS.MODES_CA_19C', 'FS.MAXPROT_BROKER_19C', 'FSFO.FARSYNC_MODES_19C']}
            basis="conflict"
            note="Concepts and Administration says maximum performance or maximum availability; the broker's members chapter excludes maximum protection only when the far sync is the sole synchronous receiver; the 19c fast-start failover prerequisites exclude maximum protection and maximum performance both."
          >
            Three Oracle pages scope far sync to three different sets of protection modes
          </Fact>
          . The one this page enforces is the fast-start failover prerequisite, because that is the
          rule a configuration trips over:{' '}
          <Fact id="FSFO.FARSYNC_MODES_19C">
            a far-sync instance cannot be used in maximum protection mode or maximum performance mode
          </Fact>{' '}
          under 19c, and{' '}
          <Fact id="FSFO.FARSYNC_MODES_26AI" basis="doc-later" note="26ai drops the maximum performance exclusion.">
            under 26ai only maximum protection is excluded
          </Fact>
          . Outside fast-start failover, maximum protection is refused when{' '}
          <Fact id="FS.MAXPROT_BROKER_19C">
            a far sync instance is the only configuration member receiving redo in synchronous mode
            from the primary database
          </Fact>{' '}
          — a second synchronous database satisfies it.
        </P>
      ),
      apply: { patches: [{ op: 'replace', path: '/config/protectionMode', value: 'MAXPROTECTION' }] },
      note: 'MaxProtection with a far sync as the only synchronous receiver: the validation panel names the rule and the edition.',
    },
    {
      title: 'The target standby is never the far sync',
      prose: (
        <P>
          <Fact id="FSFO.TARGET_NOT_FARSYNC">
            The target standby cannot be a far-sync instance. However the target can receive redo from
            a far sync instance
          </Fact>
          . <M>FastStartFailoverTarget</M>{' '}
          <Fact id="FSFO.TARGET_KIND">
            can only be set to the name of physical or logical standbys, never a snapshot standby, a
            far sync instance or a Zero Data Loss Recovery Appliance
          </Fact>
          . The prerequisite that{' '}
          <Fact id="FSFO.TARGET_DIRECT_REDO">
            the target must receive redo directly from the primary database
          </Fact>{' '}
          has the far sync feed as its sanctioned exception.
        </P>
      ),
    },
    {
      title: 'How synchronized is decided across the hop',
      prose: (
        <P>
          <Fact
            id={['FSFO.TARGET_DIRECT_REDO', 'FS.SYNC_TO_FARSYNC']}
            basis="model"
            note="This page treats the target as synchronized while the primary-to-far-sync hop is SYNC or FASTSYNC and up and the far-sync-to-target hop is up. Oracle documents neither the computation nor its timing."
          >
            How SYNCHRONIZED is computed across a far sync hop is not documented
          </Fact>
          . The readiness gate on the timeline is this page&rsquo;s model of it, and the chip stays
          beside the number wherever it is drawn. Observer connectivity is documented to the primary and
          the target standby only;{' '}
          <Fact
            id="FSFO.TARGET_DIRECT_REDO"
            basis="model"
            note="No documented statement about an observer connection to a far sync instance was found."
          >
            whether the observer talks to a far sync instance at all is undocumented
          </Fact>
          , so the canvas draws no ping to it.
        </P>
      ),
    },
    {
      title: 'The routes, pre-declared in both directions',
      prose: (
        <>
          <P>
            Redo routing is two properties, one per member.{' '}
            <Fact id="ROUTES.CANONICAL_PAIR">
              The primary routes <M>(LOCAL : FS1 SYNC)</M> and the far sync routes{' '}
              <M>(North_Sales : South_Sales ASYNC)</M>
            </Fact>
            .{' '}
            <Fact id="ROUTES.LOCAL_NOT_AT_FARSYNC">
              <M>LOCAL</M> cannot be used at a far sync instance
            </Fact>
            , which is why the far sync&rsquo;s rule names the primary instead. A rule is{' '}
            <Fact id="ROUTES.RULE_ACTIVE">
              active if its redo source field specifies the current primary database
            </Fact>
            , so the reverse routes are written once and simply wake up after a role change:{' '}
            <Fact id="FS.ROUTES_BOTH_DIRECTIONS">nothing rewrites them on a role transition</Fact>.
          </P>
          <Code label="DGMGRL — a far sync in front of a remote standby">
            {"ADD FAR_SYNC FS1 AS CONNECT IDENTIFIER IS FS1.example.com;\n"}
            {"EDIT DATABASE 'North_Sales' SET PROPERTY 'RedoRoutes' = '(LOCAL : FS1 SYNC)';\n"}
            {"EDIT FAR_SYNC 'FS1' SET PROPERTY 'RedoRoutes' = '(North_Sales : South_Sales ASYNC)';\n"}
            {'ENABLE FAR_SYNC FS1;\n\n'}
            <Dim>{'-- the other direction, declared now, active only after the swap\n'}</Dim>
            {"ADD FAR_SYNC FS2 AS CONNECT IDENTIFIER IS FS2.example.com;\n"}
            {"EDIT FAR_SYNC 'FS2' SET PROPERTY 'RedoRoutes' = '(South_Sales : North_Sales ASYNC)';\n"}
            {"EDIT DATABASE 'South_Sales' SET PROPERTY 'RedoRoutes' = '(LOCAL : FS2 SYNC)';\n"}
            {'ENABLE FAR_SYNC FS2;\n'}
          </Code>
        </>
      ),
    },
    {
      title: 'When the far sync fails',
      prose: (
        <>
          <P>
            <Fact id="FS.FAILURE_ADD_DEST">
              If the far sync instance fails, then redo should be shipped directly to the terminal
              standby by adding an additional log archive destination — which reduces the protection
              level, because redo transmission is then in ASYNC mode
            </Fact>
            . Oracle&rsquo;s own examples pre-build that: an alternate destination, a fan-out at
            PRIORITY 8, an HA far sync pair, and a second far sync near the standby so the reverse
            direction is ready before anyone needs it.
          </P>
          <P>
            Meanwhile the primary keeps committing.{' '}
            <Fact id="MAXAVAIL.AT_LEAST_ONE">
              If a MaxAvailability primary does not receive acknowledgement from at least one
              synchronized standby, it operates as if it were in maximum performance mode
            </Fact>
            , and{' '}
            <Fact id="DEST.NET_TIMEOUT">
              <M>NET_TIMEOUT</M> bounds how long LGWR waits for the acknowledgement that stopped coming
            </Fact>
            .{' '}
            <Fact
              id={['MAXAVAIL.AT_LEAST_ONE', 'DEST.NET_TIMEOUT']}
              basis="inferred"
              note="Both sentences are documented; the sequence drawn here — commits hang for one NET_TIMEOUT, then the mode degrades and the configuration continues — is this page's composition of them."
            >
              The order the two happen in is this page&rsquo;s composition
            </Fact>
            . Fast-start failover cannot fire while the target is unsynchronized, so the far sync
            failing is an availability event for the protection level, not for the primary.
          </P>
        </>
      ),
      apply: { events: [{ at: 0, kind: 'member.down', member: memberId('FS1') }] },
      note: 'The far sync goes away at t = 0: the redo path breaks, the protection level drops, and nothing fails over.',
    },
  ],
};
