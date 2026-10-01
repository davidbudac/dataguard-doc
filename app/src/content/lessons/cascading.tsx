/**
 * Lesson 8 -- Cascading. New material, written from `design/facts.md` section B.
 *
 * The restriction list is complete as documented; the three places the fact
 * sheet marks UNDOC (depth limit, SYNC cascade, whether the protection mode
 * counts a cascaded destination) are labelled where they are asserted.
 */

import { hostId, memberId } from '@/engine';
import { Fact, M } from '../facts-ui';
import { Caption, Code, Dim, P } from '../prose';
import type { Lesson } from '../types';

export const cascading: Lesson = {
  id: 'cascading',
  title: 'Cascading',
  presetId: 'cascade',
  steps: [
    {
      title: 'A terminal standby gets its redo second-hand',
      prose: (
        <>
          <P>
            A cascading standby applies the redo it receives and forwards it onward; the member at the
            far end is the terminal destination, and it{' '}
            <Fact id="CASCADE.TERMINAL_INDIRECT">
              receives primary database redo indirectly from a standby database
            </Fact>
            . What the primary buys is transport it no longer pays for: one shipment leaves the primary
            site however many standbys sit behind the cascader.
          </P>
          <Caption>
            On the canvas a cascaded member sits in the row below its cascader, one rank further from
            the primary, and the redo arrow points from the cascader, not from the primary.
          </Caption>
        </>
      ),
    },
    {
      title: 'The restrictions, in full',
      prose: (
        <P>
          <Fact id="CASCADE.PHYSICAL_ONLY">
            Only physical standby databases cascade redo; real-time cascade requires Active Data Guard,
            and non-real-time cascading is limited to destinations 1 through 10
          </Fact>
          . A cascader may feed{' '}
          <Fact id="CASCADE.THIRTY_TERMINAL">up to 30 terminal destinations</Fact>, and the destination
          numbers themselves run{' '}
          <Fact id="DEST.RANGE_1_31">
            <M>LOG_ARCHIVE_DEST_1</M> through <M>LOG_ARCHIVE_DEST_31</M>, with 1 to 10 accepting
            LOCATION or SERVICE and 11 to 31 SERVICE only
          </Fact>
          .{' '}
          <Fact
            id="CASCADE.TERMINAL_INDIRECT"
            basis="model"
            note="No documented limit on how many times redo may be cascaded onward was found, so this page imposes none and says so rather than inventing a number."
          >
            How deep a cascade may go is not documented
          </Fact>
          .
        </P>
      ),
    },
    {
      title: 'Real-time cascade is an explicit ASYNC',
      prose: (
        <P>
          Redo either leaves the cascader from its standby redo logs as it arrives, or waits for the
          archived SRL.{' '}
          <Fact id="ROUTES.CASCADE_ASYNC_EXPLICIT">
            The ASYNC redo transport attribute must be explicitly specified for a cascaded destination
            to enable real-time cascading
          </Fact>{' '}
          — leaving the attribute off is not a shortcut to the same thing.{' '}
          <Fact id="CASCADE.SYNC_NON_REALTIME">
            If you do not specify a transport mode or you specify SYNC on destinations 1 through 10,
            then redo is shipped in non-real-time; destinations 11 through 31 operate only in ASYNC
          </Fact>
          . So a <M>SYNC</M> cascade is documented, as the non-real-time kind: the terminal standby
          waits for the archived standby redo log.{' '}
          <Fact
            id="CASCADE.SYNC_NON_REALTIME"
            basis="model"
            note="Non-real-time cascading is documented, but what the cascader's own SYNC wait costs and how far the terminal destination trails are not; this page warns and models neither."
          >
            What that costs is not modelled here
          </Fact>
          .
        </P>
      ),
    },
    {
      title: 'The rule pair',
      prose: (
        <>
          <P>
            Cascading is two <M>RedoRoutes</M> rules, and only one of them mentions the primary. The
            primary ships to the cascader; the cascader carries a rule whose source is the primary, so{' '}
            <Fact id="ROUTES.RULE_ACTIVE">
              it is active now, because a rule is active if its redo source field specifies the current
              primary database
            </Fact>
            . Its own <M>(LOCAL : ...)</M> rule, if it has one, waits for the day it becomes primary.
          </P>
          <Code label="DGMGRL — broker example 4-2">
            {"EDIT DATABASE 'North_Sales' SET PROPERTY 'RedoRoutes' = '(LOCAL : Local_Sales SYNC)';\n"}
            {"EDIT DATABASE 'Local_Sales' SET PROPERTY 'RedoRoutes' = '(North_Sales : Remote_Sales ASYNC)';\n"}
            <Dim>
              {'-- SHOW CONFIGURATION indents the terminal standby under its cascader\n'}
              {'-- and marks the terminal standby "(receiving current redo)"\n'}
            </Dim>
          </Code>
          <Caption>
            <Fact id="CASCADE.EXAMPLE_4_2">
              The broker shows the cascade by indentation and by the marker{' '}
              <M>(receiving current redo)</M>
            </Fact>
            , which is why the generated <M>SHOW</M> mock indents it the same way.
          </Caption>
        </>
      ),
      apply: {
        patches: [
          {
            op: 'replace',
            path: '/members/1/redoRoutes',
            value: [{
              source: [memberId('North_Sales')],
              groups: [{ dests: [{ target: memberId('Remote_Sales'), xpt: 'ASYNC' }] }],
            }],
          },
        ],
      },
      note: 'The cascader forwards to the terminal standby with an explicit ASYNC — the attribute real-time cascading needs.',
    },
    {
      title: 'A terminal standby cannot be the fast-start failover target',
      prose: (
        <P>
          <Fact
            id={['FSFO.TARGET_DIRECT_REDO', 'CASCADE.TERMINAL_INDIRECT']}
            basis="inferred"
            note="Two documented sentences: the target must receive redo directly from the primary, and a terminal destination receives it indirectly. There is no literal prohibition; the deduction is this page's."
          >
            A cascaded terminal standby fails the direct-redo prerequisite
          </Fact>
          . The validation panel reports it as an error against{' '}
          <M>FastStartFailoverTarget</M> and offers the fix, rather than quietly promoting a member
          that the broker would refuse when fast-start failover is enabled.
        </P>
      ),
    },
    {
      title: 'Manual failover to a terminal standby is documented',
      prose: (
        <P>
          A terminal standby is a legal manual failover target, with one documented consequence:{' '}
          <Fact id="CASCADE.MANUAL_FAILOVER_UNSENT">
            no attempt is made to transmit any unsent redo from the cascader to the terminal standby
          </Fact>
          . Whatever the cascader was still holding does not follow. With fast-start failover enabled
          the broker would refuse this command, because{' '}
          <Fact id="FAILOVER.CURRENT_TARGET_ONLY">
            the failover can only be performed to the current target standby database
          </Fact>
          , and the terminal standby cannot be that target (the previous step), so the step switches
          fast-start failover off and takes the primary down first.{' '}
          <Fact
            id="CASCADE.MANUAL_FAILOVER_UNSENT"
            basis="model"
            note="Switchover to a terminal standby is not documented either way, so this page warns instead of drawing an outcome as if it were certain."
          >
            Switchover to a terminal standby is undocumented
          </Fact>
          .
        </P>
      ),
      apply: {
        patches: [{ op: 'replace', path: '/config/fsfo/state', value: 'disabled' }],
        events: [
          { at: 0, kind: 'host.down', host: hostId('dc1-north') },
          { at: 5, kind: 'cmd.failover', to: memberId('Remote_Sales') },
        ],
      },
      note: 'Fast-start failover is switched off, the primary host goes down, and a manual FAILOVER goes to the terminal standby: the validation panel warns that no unsent redo follows it from the cascader.',
    },
    {
      title: 'The protection mode looks at the primary’s own destinations',
      prose: (
        <P>
          <Fact
            id={['MAXAVAIL.AT_LEAST_ONE', 'CASCADE.TERMINAL_INDIRECT']}
            basis="inferred"
            note="A cascaded destination does not acknowledge to the primary, so this page does not count it toward the protection-mode acknowledgement. Oracle states neither the inclusion nor the exclusion."
          >
            Whether the protection mode considers cascaded destinations is not documented; this page
            counts only the members that acknowledge to the primary itself
          </Fact>
          . So a cascade behind a synchronous standby changes what the configuration survives, never
          what a commit waits for.
        </P>
      ),
    },
  ],
};
