/**
 * Configure -> LOG_ARCHIVE_DEST_n: where the transport properties land.
 *
 * One parameter file per member that ships redo under the declared primary --
 * a far sync instance forwards, so it gets one of its own. The destination
 * numbering, the 1-10 / 11-31 ranges, the `ALTERNATE=` / `GROUP=` /
 * `PRIORITY=` spellings and the rule that NET_TIMEOUT is omitted under ASYNC
 * all live in the generator, which is where they can be golden-tested.
 */

import { generateInitOraFiles } from '@/engine';
import { primaryId, topology } from '@/state/derived';
import { CodeBlock } from './CodeBlock';

export function Dests() {
  const doc = topology.value;
  const primary = primaryId.value;
  const files = primary === null ? [] : generateInitOraFiles(doc, { primary });

  return (
    <div class="panel" role="region" aria-label="LOG_ARCHIVE_DEST_n">
      <div class="panel-hd">
        <span class="eyebrow">Configuration files</span>
        <p class="prose">The broker-owned destination parameters.</p>
        <p class="caption">
          The broker writes these; they are shown so the properties above have somewhere
          recognisable to land. This page leaves <span class="mono">LOG_ARCHIVE_DEST_1</span> for
          a local destination and numbers the remote ones from 2 -- its own convention, not an
          Oracle rule.
          <span class="mono"> NET_TIMEOUT</span> bounds how long LGWR waits for a synchronous
          destination's acknowledgement -- it is never a failover clock, and it is omitted
          under <span class="mono">ASYNC</span>, where nothing waits for the destination at all.
        </p>
      </div>
      <div class="panel-body">
        {files.length === 0 ? (
          <div class="empty">
            <span class="empty-k">No destinations</span>
            <p>
              {primary === null
                ? 'No primary database is declared in this configuration, so no member ships redo anywhere.'
                : 'The primary’s routing rules name no destination, so there is no remote LOG_ARCHIVE_DEST_n to write. Add a standby or a far sync instance in the Inspector and its block appears here.'}
            </p>
          </div>
        ) : files.map((f) => <CodeBlock key={f.id} file={f} doc={doc} />)}
      </div>
    </div>
  );
}
