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
import { CodeBlock, scriptsOf } from './CodeBlock';

export function Dests() {
  const doc = topology.value;
  const primary = primaryId.value;
  const files = primary === null ? [] : generateInitOraFiles(doc, { primary });

  return (
    <div class="panel" role="region" aria-label="LOG_ARCHIVE_DEST_n">
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
        ) : files.flatMap(scriptsOf).map((f) => <CodeBlock key={f.id} file={f} doc={doc} />)}
      </div>
    </div>
  );
}
