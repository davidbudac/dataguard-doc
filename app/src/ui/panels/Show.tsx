/**
 * Configure -> SHOW: mock DGMGRL output, walked by the playhead.
 *
 * Two honesty rules govern this panel, and both come from the generator rather
 * than from here: every block opens with a line saying it is rendered from
 * this page's model of DGMGRL output rather than a transcript, and every
 * spelling the verified documentation does not carry wears `(model)`.
 *
 * The playhead is what makes it a panel rather than a picture. `frame` is
 * `stateAt(trace, tNow)`, so scrubbing walks the mock through the states the
 * simulation went through: once the role has moved, the configuration is
 * resolved for the primary at that moment -- which is exactly what
 * `SHOW CONFIGURATION WHEN PRIMARY IS name` asks for -- and the member states
 * beside the heading are the ones the model holds at t.
 */

import { signal } from '@preact/signals';
import {
  declaredPrimary, generateShowMocks, hasApplyInstance, initialApplyInstance, stoppedInstances,
} from '@/engine';
import { frame, topology, trace } from '@/state/derived';
import { tNow } from '@/state/view';
import { fmt } from '@/ui/timeline/build';
import { Tag } from '@/ui/common/Chip';
import { CodeBlock } from './CodeBlock';

/** Panel-local view state: which of the two forms of SHOW CONFIGURATION. */
export const showVerbose = signal<boolean>(false);

export function Show() {
  const doc = topology.value;
  const t = trace.value;
  const f = frame.value;
  const declared = declaredPrimary(doc);
  const at = f?.epoch.primary ?? null;
  const moved = at !== null && declared !== null && at !== declared;

  /* Before any event the steady state: each RAC standby on the instance it
     starts with. */
  const steadyApply: Record<string, string> = {};
  for (const m of doc.members) {
    const first = hasApplyInstance(m) ? initialApplyInstance(m) : null;
    if (first !== null) steadyApply[m.id as string] = first;
  }
  const files = generateShowMocks(doc, {
    verbose: showVerbose.value,
    ...(moved ? { whenPrimaryIs: at } : {}),
    applyInstances: f === null ? steadyApply : f.applyInstances ?? {},
    downInstances: f === null ? [] : stoppedInstances(doc, f.epoch.net),
    /* The old primary a manual failover found still open, drawn open beside
       the new one: the configuration's line for it says the drawing differs. */
    openAsPrimary: f === null || at === null ? []
      : Object.entries(f.members).filter(([id, state]) => state === 'open-rw' && id !== at).map(([id]) => id),
  });

  const nameOf = (id: string): string => doc.members.find((m) => m.id === id)?.name ?? id;

  return (
    <div class="panel" role="region" aria-label="SHOW">
      <div class="panel-hd">
        <div class="row">
          <span class="eyebrow grow">
            {t === null
              ? 'Steady state -- no events injected'
              : `The model at t = ${fmt(tNow.value)} s`}
          </span>
          <button
            type="button"
            class={showVerbose.value ? 'btn is-primary' : 'btn'}
            aria-pressed={showVerbose.value}
            onClick={() => { showVerbose.value = !showVerbose.value; }}
          >
            VERBOSE
          </button>
        </div>
        <p class="caption">
          Drawn from this page's model, not captured from a broker: the fields are the
          documented ones and the layout follows the documented examples, but the column
          widths and every line marked <span class="mono">(model)</span> were not verified
          against Oracle documentation.
          {moved
            ? ' The role has moved at this point in the run, so the configuration below is'
              + ` resolved with ${nameOf(at)} as primary -- the question DGMGRL's`
              + ' WHEN PRIMARY IS form asks.'
            : ' Scrub the timeline in Simulate mode and this walks with it.'}
        </p>
        {f === null ? null : (
          <p class="row">
            {Object.entries(f.members).map(([id, state]) => (
              <Tag key={id} tone={state === 'open-rw' ? 'tl' : state === 'down' || state === 'aborted' ? 'rd' : 'sl'}>
                {nameOf(id)} {state}
              </Tag>
            ))}
            {Object.entries(f.observers).map(([id, state]) => (
              <Tag key={id} tone="vi">{id} {state}</Tag>
            ))}
          </p>
        )}
      </div>
      <div class="panel-body">
        {files.map((file) => <CodeBlock key={file.id} file={file} doc={doc} />)}
      </div>
    </div>
  );
}
