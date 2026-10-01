/**
 * Lesson 10 -- RAC. New material, written from `design/facts.md` section F.
 *
 * Two clustered databases, and the one question each role asks of a cluster:
 * how much of the primary has to go before Data Guard notices, and what a
 * standby does when the one instance applying redo goes. Where the broker's
 * documentation stops -- detection time, "random" instance selection, an
 * instance other than the coordinator failing -- the chip says so.
 */

import { memberId } from '@/engine';
import { Fact, M } from '../facts-ui';
import { Caption, P } from '../prose';
import type { Lesson } from '../types';

export const rac: Lesson = {
  id: 'rac',
  title: 'RAC primary and standby',
  presetId: 'rac-standby',
  steps: [
    {
      title: 'A cluster is one member',
      prose: (
        <>
          <P>
            Each database here runs two instances on two nodes, and each is still one member of the
            broker configuration: one card with a row per instance. A cluster needs its own software
            underneath —{' '}
            <Fact id="RAC.CLUSTERWARE_REQUIRED">
              Oracle Clusterware is a required component for using Oracle RAC
            </Fact>
            {' '}— and that is why neither database needs the static service a single instance would. The
            19c guide words it{' '}
            <Fact id="RAC.STATIC_ONLY_WITHOUT_CLUSTERWARE">
              a static service needs to be defined and registered only if Oracle Clusterware or Oracle
              Restart is not being used
            </Fact>
            , the 26ai guide{' '}
            <Fact id="RAC.STATIC_SERVICE_26AI">
              for configurations where Oracle Clusterware or Oracle Restart are not being used, a static
              service must be registered with the local listener associated with each instance
            </Fact>
            .
          </P>
          <Caption>
            The observer runs on a host of its own at the third site, because it{' '}
            <Fact id="OBS.PLACEMENT_NEVER_ON_DB_HOST">
              should never be deployed at the primary database server or cluster, or on the standby
              database server or cluster
            </Fact>
            .
          </Caption>
        </>
      ),
    },
    {
      title: 'Losing one primary instance',
      prose: (
        <P>
          Stop <M>prm011</M>.{' '}
          <Fact id="RAC.PRIMARY_AVAILABLE">
            From an Oracle Data Guard perspective, the primary database remains available as long as at
            least one instance of the clustered database continues to transport redo data to the standby
            databases
          </Fact>
          , so the observer and the standby still reach <M>prm012</M> and no clock starts. Only when{' '}
          <Fact id="RAC.LAST_INSTANCE_FSFO">
            the last instance of the primary database fails, and fast-start failover is enabled
          </Fact>{' '}
          does the broker fail over.{' '}
          <Fact
            id="RAC.PRIMARY_AVAILABLE"
            basis="model"
            note="Which instance ships which redo thread, and how the survivor covers the failed instance's thread, are not modelled."
          >
            The drawing treats the member as reachable while any instance is
          </Fact>
          .
        </P>
      ),
      apply: {
        events: [{ at: 0, kind: 'instance.down', member: memberId('prm01'), instance: 'prm011' }],
      },
      note: 'One of two primary instances stops at t = 0: the card goes degraded, not down, and the timeline says nothing moved.',
    },
    {
      title: 'The standby applies on one instance',
      prose: (
        <>
          <P>
            <Fact id="RAC.APPLY_INSTANCE">
              If the standby database is an Oracle RAC database, the broker starts Redo Apply on exactly
              one standby instance, called the apply instance
            </Fact>
            . Here that is <M>sby011</M>, the instance <M>PreferredApplyInstance</M> names; the card
            marks it <M>APPLY</M>. Stop it, and{' '}
            <Fact id="RAC.APPLY_INSTANCE_FAILOVER">
              the broker automatically restarts SQL Apply, or the Redo Apply coordinator, as appropriate,
              on a different instance
            </Fact>
            {' '}— after <M>ApplyInstanceTimeout</M>, whose{' '}
            <Fact id="RAC.APPLY_INSTANCE_TIMEOUT">broker default is 0, immediate apply instance failover</Fact>
            .
          </P>
          <Caption>
            <Fact
              id="RAC.APPLY_INSTANCE_TIMEOUT"
              basis="model"
              note="How long the broker takes to detect the failure is not documented; this page draws it as instantaneous."
            >
              The move is drawn at the instant the instance stops
            </Fact>
            .
          </Caption>
        </>
      ),
      apply: {
        events: [{ at: 0, kind: 'instance.down', member: memberId('sby01'), instance: 'sby011' }],
      },
      note: 'The standby’s apply instance stops at t = 0 and the APPLY tag moves to sby012; the timeline lane names the instance applying before and after.',
    },
    {
      title: 'Waiting out ApplyInstanceTimeout',
      prose: (
        <P>
          With <M>ApplyInstanceTimeout</M> at 30 s, the broker{' '}
          <Fact id="RAC.APPLY_INSTANCE_TIMEOUT">
            waits after detecting the current apply instance failed before initiating the apply instance
            failover
          </Fact>
          . For those 30 s nothing applies, and{' '}
          <Fact
            id="RAC.APPLY_INSTANCE"
            basis="model"
            note="The apply lag grows one second per second while no instance applies; once apply resumes this page draws the backlog as cleared at once, because the catch-up rate is environment-dependent."
          >
            the apply lag grows
          </Fact>
          . Then apply moves: to the preferred instance if it is running,{' '}
          <Fact id="RAC.APPLY_INSTANCE_SELECTION">
            otherwise pick a random instance that is currently running
          </Fact>
          .{' '}
          <Fact
            id="RAC.APPLY_INSTANCE_SELECTION"
            basis="model"
            note="This engine is deterministic and takes the first running instance in declared order."
          >
            The drawing picks the first running one
          </Fact>
          .
        </P>
      ),
      apply: {
        patches: [{ op: 'add', path: '/members/1/applyInstanceTimeoutSeconds', value: 30 }],
        events: [{ at: 0, kind: 'instance.down', member: memberId('sby01'), instance: 'sby011' }],
      },
      note: 'ApplyInstanceTimeout is 30 s on sby01: its lane reads “apply stopped” from 0 to 30 s, then applying on sby012.',
    },
    {
      title: 'Moving apply by hand',
      prose: (
        <P>
          <Fact id="RAC.SET_APPLY_INSTANCE">
            Once the apply instance is selected and, as long as it is still running, the broker
            disregards the value of the PreferredApplyInstance property even if you change it
          </Fact>
          . To move it, give the state again with an instance:{' '}
          <Fact id="RAC.SET_APPLY_INSTANCE">
            EDIT DATABASE 'South_Sales' SET STATE='APPLY-ON' WITH APPLY INSTANCE='south_sales2';
          </Fact>
          . In Topology, right-click the standby and its events menu offers it as “Move apply to”.
        </P>
      ),
      apply: {
        events: [{ at: 5, kind: 'cmd.setApplyInstance', member: memberId('sby01'), instance: 'sby012' }],
      },
      note: 'At t = 5 s apply moves to sby012 by command; nothing has failed.',
    },
  ],
};
