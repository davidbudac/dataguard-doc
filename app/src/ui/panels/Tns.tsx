/**
 * Configure -> tnsnames / JDBC: the same connect string twice.
 *
 * Both cards are generated from one `ClientDescriptor`, so the ADDRESS_LIST,
 * the retry parameters and the service name cannot drift apart between them.
 * The one place they legitimately differ is the transport timeout. Only the
 * strings themselves are drawn (`scriptsOf`).
 */

import { buildClientFiles } from '@/engine';
import { topology } from '@/state/derived';
import { CodeBlock, scriptsOf } from './CodeBlock';

export function Tns() {
  const doc = topology.value;
  const files = buildClientFiles(doc, { lead: true });

  return (
    <div class="panel" role="region" aria-label="tnsnames and JDBC">
      <div class="panel-body">
        {files.flatMap(scriptsOf).map((file) => <CodeBlock key={file.id} file={file} doc={doc} />)}
      </div>
    </div>
  );
}
