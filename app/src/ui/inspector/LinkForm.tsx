/**
 * One network link: the object a round trip and an up flag belong to.
 *
 * Reachability in this model is a graph problem rather than a set of
 * hand-written booleans -- hosts are the nodes, an intra-site pair is
 * reachable unless a host-scope link between them is cut, and a site link
 * expands to every host pair across the two data centres. Editing a link
 * here is editing the configuration; cutting one at a moment on the clock is
 * an event, and that lives in Break mode.
 */

import type { Link, TopologyDoc } from '@/engine';
import { Check, Group, Note, Num } from './controls';
import { FieldNote } from '../common/Field';
import { patchLink } from './edits';

export interface LinkFormProps {
  link: Link;
  doc: TopologyDoc;
}

function endName(doc: TopologyDoc, link: Link, i: 0 | 1): string {
  const id = link.ends[i];
  if (link.scope === 'site') {
    return doc.sites.find((s) => (s.id as string) === (id as string))?.name ?? (id as string);
  }
  return doc.hosts.find((h) => (h.id as string) === (id as string))?.name ?? (id as string);
}

export function LinkForm({ link, doc }: LinkFormProps) {
  const id = link.id;
  const a = endName(doc, link, 0);
  const b = endName(doc, link, 1);
  return (
    <>
      {/* The header says which kind of link this is; the first row says
          what it joins. */}
      <Group title="General">
        <div class="field is-row">
          <div class="field-hd">
            <span class="field-name is-prose">Between</span>
          </div>
          <div class="field-ctl">
            <span class="field-val mono">{a} – {b}</span>
          </div>
          <FieldNote>
            {link.scope === 'site'
              ? 'A site link stands for every host pair across the two data centres.'
              : 'A host link stands for the path between exactly these two hosts.'}
          </FieldNote>
        </div>
        <Num
          name="Round trip" prose
          bound="latencyMs"
          value={link.rttMs}
          coalesce={`rtt:${id as string}`}
          onChange={(v) => patchLink(
            id, `Set the round trip on ${id as string} to ${v} ms`,
            (l) => ({ ...l, rttMs: v }), `rtt:${id as string}`,
          )}
          note="What a SYNC commit pays twice, and what the FAILOVER command crosses on its way to the target."
        />
        <Check
          name="Up" prose
          label="The link is up"
          checked={link.up}
          onChange={(v) => patchLink(
            id, `${v ? 'Restore' : 'Cut'} ${id as string}`, (l) => ({ ...l, up: v }),
          )}
          note="This is the configuration's steady state. To cut the link at a moment on the clock, inject the event in Simulate mode."
        />
        <div class="field is-row">
          <div class="field-hd">
            <span class="field-name is-prose">Bandwidth</span>
          </div>
          <div class="field-ctl">
          <input
            class="field-in"
            type="number"
            min={0}
            step={10}
            aria-label="Bandwidth, Mbit/s"
            placeholder="not set"
            value={link.bandwidthMbit === undefined ? '' : String(link.bandwidthMbit)}
            onChange={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value.trim();
              const n = Number(raw);
              patchLink(id, `Set the bandwidth on ${id as string}`, (l) => {
                const next = { ...l };
                if (raw === '' || !isFinite(n) || n <= 0) delete next.bandwidthMbit;
                else next.bandwidthMbit = n;
                return next;
              });
            }}
          />
          <span class="field-unit">Mbit/s</span>
          </div>
          {/* Always: an input that changes nothing in the run is a lie
              without this line, and the control itself cannot say it. */}
          <FieldNote always>
            Recorded for the socket-buffer arithmetic; nothing in the failure model reads it.
          </FieldNote>
        </div>
        <Note>
          Removing a link removes the path: two data centres with no link between them
          are unreachable from each other, which is not the same as a link that is down.
        </Note>
      </Group>
    </>
  );
}
