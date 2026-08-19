/**
 * One data centre: its label, the hosts standing in it, and the removal.
 *
 * A site is the one subject whose removal is refused by what is *inside* it
 * rather than by what it is -- so the Remove button here is the Build table's
 * own entry (`build/actions`), the same object the Delete key presses on the
 * drawing, and the two cannot come to disagree about `WHY.siteHasHosts`.
 */

import type { Site, TopologyDoc } from '@/engine';
import { removeAction } from '../build/actions';
import { Action, Group, Note, Text } from './controls';
import { addHost, mutate, removeHost } from './edits';
import { off, ON, WHY } from './why';

export interface SiteFormProps {
  site: Site;
  doc: TopologyDoc;
}

export function SiteForm({ site, doc }: SiteFormProps) {
  const hosts = doc.hosts.filter((h) => h.site === site.id);
  const used = new Set<string>();
  for (const m of doc.members) for (const i of m.instances) used.add(i.host as string);
  for (const o of doc.observers) used.add(o.host as string);
  const remove = removeAction(doc, site.id as string);
  return (
    <>
      <Group title="Data centre">
        <Text
          name="Name"
          value={site.name}
          onCommit={(v) => mutate(`Rename ${site.id as string}`, (t) => ({
            ...t,
            sites: t.sites.map((s) => (s.id === site.id ? { ...s, name: v.trim() || s.name } : s)),
          }))}
          note="The label under the site rectangle. The site's identity does not change with it."
        />
      </Group>
      <Group
        title={`Hosts (${hosts.length})`}
        action={<Action label="+ Host" onClick={() => addHost(site.id)} />}
      >
        {hosts.length === 0 ? <Note always>No hosts in this data centre yet.</Note> : null}
        {hosts.map((h) => (
          <div class="rr-dest" key={h.id as string}>
            <span class="mono">{h.name}</span>
            <span class="tag t-sl">{used.has(h.id as string) ? 'in use' : 'free'}</span>
            <Action
              label="Remove"
              enabled={used.has(h.id as string) ? off(WHY.hostInUse) : ON}
              onClick={() => removeHost(h.id)}
            />
          </div>
        ))}
      </Group>
      <Group title="This data centre">
        <div class="rr-line">
          {remove === null ? null : (
            <Action label={remove.label} enabled={remove.enabled} onClick={remove.run} />
          )}
        </div>
      </Group>
    </>
  );
}
