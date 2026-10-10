/**
 * Configure -> DGMGRL: the broker configuration as scripts you could paste --
 * creating the configuration, fast-start failover, each observer on its own
 * host, the role-based services. The generator's commentary and its closing
 * `validate(doc)` block are not drawn (`scriptsOf`); the issue panel carries
 * the findings.
 */

import { generateDgmgrl } from '@/engine';
import { issues, primaryId, topology } from '@/state/derived';
import { CodeBlock, scriptsOf } from './CodeBlock';

export function Dgmgrl() {
  const doc = topology.value;
  const primary = primaryId.value;
  const file = generateDgmgrl(doc, {
    findings: issues.value,
    ...(primary === null ? {} : { primary }),
  });

  return (
    <div class="panel" role="region" aria-label="DGMGRL">
      <div class="panel-body">
        {scriptsOf(file).map((f) => <CodeBlock key={f.id} file={f} doc={doc} />)}
      </div>
    </div>
  );
}
