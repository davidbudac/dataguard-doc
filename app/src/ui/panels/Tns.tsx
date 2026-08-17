/**
 * Configure -> tnsnames / JDBC: the same connect string twice.
 *
 * Both cards are generated from one `ClientDescriptor`, so the ADDRESS_LIST,
 * the retry parameters and the service name cannot drift apart between them.
 * The one place they legitimately differ is the transport timeout, and the
 * reason is on the card.
 */

import { buildJdbc, buildTns } from '@/engine';
import { topology } from '@/state/derived';
import { CodeBlock } from './CodeBlock';

export function Tns() {
  const doc = topology.value;
  const tns = buildTns(doc);
  const jdbc = buildJdbc(doc, { lead: true });

  return (
    <div class="panel" role="region" aria-label="tnsnames and JDBC">
      <div class="panel-hd">
        <span class="eyebrow">Configuration files</span>
        <p class="prose">The connect string, on every application host.</p>
        <p class="caption">
          One ADDRESS per host that can publish the role-based service, so a client that
          reaches the wrong one is refused instantly with <span class="mono">ORA-12514</span>
          {' '}rather than waiting. These parameters affect only new connections -- no
          established session is touched by anything here. The JDBC thin driver does not
          inherit Oracle Net's 60 s transport default, so
          <span class="mono"> TRANSPORT_CONNECT_TIMEOUT</span> is always spelled out there,
          with an explicit <span class="mono">sec</span> suffix: older thin releases read a
          bare value as milliseconds.
        </p>
      </div>
      <div class="panel-body">
        <CodeBlock file={tns} doc={doc} />
        <CodeBlock file={jdbc} doc={doc} />
      </div>
    </div>
  );
}
