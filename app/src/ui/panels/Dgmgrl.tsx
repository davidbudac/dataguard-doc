/**
 * Configure -> DGMGRL: the broker configuration as one session you could paste.
 *
 * The script is `generateDgmgrl(doc)`, and its closing block is `validate(doc)`
 * verbatim -- one source of truth for what is wrong with a configuration, so
 * the script and the issue panel can never disagree.
 */

import { generateDgmgrl } from '@/engine';
import { issues, primaryId, topology } from '@/state/derived';
import { CodeBlock } from './CodeBlock';

export function Dgmgrl() {
  const doc = topology.value;
  const primary = primaryId.value;
  const file = generateDgmgrl(doc, {
    findings: issues.value,
    ...(primary === null ? {} : { primary }),
  });

  return (
    <div class="panel" role="region" aria-label="DGMGRL">
      <div class="panel-hd">
        <span class="eyebrow">Configuration files</span>
        <p class="prose">The same deployment, as you would type it.</p>
        <p class="caption">
          Values that differ from their documented defaults are highlighted; the grey lines
          are this page commenting, not DGMGRL syntax. Command syntax per the 19c broker
          commands reference; the clock properties (<span class="mono">FastStartFailoverThreshold</span>,
          the two <span class="mono">ObserverPing*</span> properties,
          <span class="mono"> FastStartFailoverLagLimit</span>,
          <span class="mono"> FastStartFailoverPmyShutdown</span>) are configuration-wide, while
          <span class="mono"> LogXptMode</span> is set per database.
          <span class="mono"> START OBSERVER IN BACKGROUND</span> is the form the documentation
          prefers. Nothing here describes the incident: a scenario, an apply lag, a
          role-transition time and an RTT are conditions of the environment, not configuration.
        </p>
      </div>
      <div class="panel-body">
        <CodeBlock file={file} doc={doc} />
      </div>
    </div>
  );
}
