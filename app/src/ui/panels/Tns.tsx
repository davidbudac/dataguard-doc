/**
 * Configure -> tnsnames / JDBC: the same connect string twice.
 *
 * Both cards are generated from one `ClientDescriptor`, so the ADDRESS_LIST,
 * the retry parameters and the service name cannot drift apart between them.
 * The one place they legitimately differ is the transport timeout, and the
 * reason is on the card.
 */

import { applicationsOf, buildClientFiles } from '@/engine';
import { topology } from '@/state/derived';
import { CodeBlock } from './CodeBlock';

export function Tns() {
  const doc = topology.value;
  const files = buildClientFiles(doc, { lead: true });
  const apps = applicationsOf(doc);
  const own = apps.filter((a) => a.client !== undefined);
  const shared = apps.filter((a) => a.client === undefined);
  const names = (list: readonly { name: string }[]): string => list.map((a) => a.name).join(', ');

  return (
    <div class="panel" role="region" aria-label="tnsnames and JDBC">
      <div class="panel-hd">
        <span class="eyebrow">Configuration files</span>
        <p class="prose">
          {apps.length === 0
            ? 'The connect string, on every application host.'
            : own.length === 0
              ? `The connect string, on every application host (${names(apps)}).`
              : `The shared connect string${shared.length > 0 ? `, dialled by ${names(shared)}` : ', which no application dials'}; ${names(own)} ${own.length === 1 ? 'has a connect string of its own' : 'have connect strings of their own'}, below it.`}
        </p>
        <p class="caption">
          One ADDRESS per host that can publish the role-based service, so a client that
          reaches the wrong one is refused instantly with <span class="mono">ORA-12514</span>
          {' '}rather than waiting. These parameters affect only new connections -- no
          established session is touched by anything here. Under 26ai the JDBC thin driver has
          defaults of its own (<span class="mono">TRANSPORT_CONNECT_TIMEOUT</span> 20 s,
          <span class="mono"> RETRY_DELAY</span> 1 s) where Oracle Net's is 60 s, and the 19c
          JDBC pages print none, so <span class="mono"> TRANSPORT_CONNECT_TIMEOUT</span> is always
          spelled out there, as a bare number of seconds the way the JDBC page's own example
          writes it.
        </p>
      </div>
      <div class="panel-body">
        {files.map((file) => <CodeBlock key={file.id} file={file} doc={doc} />)}
      </div>
    </div>
  );
}
