/**
 * Lesson 4 -- Configuration.
 *
 * Legacy chapter 4: the same settings, as you would type them. The generated
 * blocks live in the Configure panels; this lesson is the prose that says which
 * property is configuration-wide, which is per database, and which of the
 * numbers on the page are not configuration at all.
 */

import { Fact, M } from '../facts-ui';
import { Caption, Code, Dim, P } from '../prose';
import type { Lesson } from '../types';

export const configuration: Lesson = {
  id: 'configuration',
  title: 'Configuration',
  presetId: 'classic',
  steps: [
    {
      title: 'The same settings, as you would type them',
      prose: (
        <>
          <P>
            The Config panels print the topology as DGMGRL commands, as the{' '}
            <M>LOG_ARCHIVE_DEST_n</M> parameters the broker owns, as a <M>tnsnames.ora</M> entry and a
            JDBC thin URL, and as the <M>SHOW</M> output the broker would give back. Values that
            differ from their documented defaults are highlighted; the grey parenthetical lines are
            this page commenting, not DGMGRL syntax.
          </P>
          <Caption>
            Command syntax per the 19c broker commands reference. Nothing in those blocks is a
            simulation condition: scenario, apply lag, role-transition time and RTT never appear there
            — they are conditions of the environment, not configuration.
          </Caption>
        </>
      ),
    },
    {
      title: 'Which property sits where',
      prose: (
        <P>
          The clock properties — <M>FastStartFailoverThreshold</M>, the two <M>ObserverPing*</M>{' '}
          properties, <M>FastStartFailoverLagLimit</M>, <M>FastStartFailoverPmyShutdown</M> — are
          configuration-wide, while <M>LogXptMode</M> is set per database, on the member that{' '}
          <em>receives</em> the redo. <M>NetTimeout</M> is a transport property: it lands in the{' '}
          <M>LOG_ARCHIVE_DEST_n</M> attribute <M>NET_TIMEOUT</M> on the primary and never decides a
          failover.
        </P>
      ),
    },
    {
      title: 'Redo routes are pre-declared, in both directions',
      prose: (
        <>
          <P>
            A <M>RedoRoutes</M> rule is active when its source field names the current primary, so the
            reverse routes are written once, at build time, and simply activate when the roles swap.{' '}
            <Fact id="FS.ROUTES_BOTH_DIRECTIONS">Nothing rewrites them on a role change.</Fact>
          </P>
          <Code label="DGMGRL — both directions, declared once">
            <Dim>{'-- while prm01 is primary\n'}</Dim>
            {"EDIT DATABASE 'prm01' SET PROPERTY 'RedoRoutes' = '(LOCAL : sby01 SYNC)';\n"}
            <Dim>{'-- inactive until sby01 becomes primary\n'}</Dim>
            {"EDIT DATABASE 'sby01' SET PROPERTY 'RedoRoutes' = '(LOCAL : prm01 SYNC)';\n"}
          </Code>
        </>
      ),
    },
    {
      title: 'Starting the observer',
      prose: (
        <>
          <P>
            <M>START OBSERVER IN BACKGROUND</M> is the form the documentation calls preferred, and it
            requires <M>CONNECT IDENTIFIER IS</M>. The file arguments are spelled <M>FILE IS</M> and{' '}
            <M>LOGFILE IS</M> — a keyword pair, not an assignment — and the DGMGRL <M>-logfile</M>{' '}
            option has been deprecated since 12.2 in favour of <M>LOGFILE IS</M>.{' '}
            <Fact id="OBS.START_FILE_IS">
              <M>START OBSERVER [observer-name] IN BACKGROUND CONNECT IDENTIFIER IS connect-identifier
              [FILE IS observer-file] [LOGFILE IS log-file]</M>
            </Fact>
          </P>
          <Code label="DGMGRL — on the observer host">
            {'START OBSERVER obs01 IN BACKGROUND CONNECT IDENTIFIER IS dg_cfg\n'}
            {'  FILE IS /u01/dg/obs01.dat LOGFILE IS /u01/dg/obs01.log;\n'}
          </Code>
        </>
      ),
    },
    {
      title: 'Save, share, reuse',
      prose: (
        <P>
          The exported file carries the topology, the parameters and the injected events; a share link
          packs the same document into the URL fragment. The file can be edited by hand: unknown keys
          are ignored and out-of-range values are clamped against the engine&rsquo;s bounds table, and
          the import reports what it dropped rather than silently accepting it.
        </P>
      ),
    },
  ],
};
