/**
 * One data centre: its label, the hosts standing in it, and its links.
 *
 * `+ Host` and `+ Link` used to be pickers on the empty rail, asking which data
 * centre before the button meant anything. Selecting the data centre *is*
 * naming it, so both live here now. The removal is in the rail's header, like
 * every other subject's (`Inspector.tsx`).
 */

import type { Site, TopologyDoc } from '@/engine';
import { Action, Group, Note, Text } from './controls';
import { addHost, addLink, hostsInUse, mutate, removeHost } from './edits';
import { WHY_ONE_SITE } from './adds';
import { off, ON, WHY } from './why';

export interface SiteFormProps {
  site: Site;
  doc: TopologyDoc;
}

export function SiteForm({ site, doc }: SiteFormProps) {
  const hosts = doc.hosts.filter((h) => h.site === site.id);
  const used = hostsInUse(doc);
  const others = doc.sites.filter((s) => s.id !== site.id);
  const linked = (o: Site): boolean => doc.links.some((l) => l.scope === 'site'
    && (l.ends as [string, string]).includes(site.id as string)
    && (l.ends as [string, string]).includes(o.id as string));
  return (
    <>
      <Group title="General">
        <Text
          name="Name" prose
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
        <div class="site-rows">
        {hosts.map((h) => (
          <div class="rr-dest lrow" key={h.id as string}>
            <span class="lrow-k mono">{h.name}</span>
            <span class="tag t-sl">{used.has(h.id as string) ? 'in use' : 'free'}</span>
            <Action
              label="Remove"
              enabled={used.has(h.id as string) ? off(WHY.hostInUse) : ON}
              onClick={() => removeHost(h.id)}
            />
          </div>
        ))}
        </div>
      </Group>
      {/* The keyboard's way to a site link; a pointer can also draw one from
          the port beside the name on the drawing. */}
      <Group title="Links">
        {others.length === 0 ? <Note always>{WHY_ONE_SITE}</Note> : null}
        <div class="site-rows">
        {others.map((o) => (
          <div class="rr-dest lrow" key={o.id as string}>
            <span class="lrow-k mono">{o.name}</span>
            {linked(o) ? (
              <span class="tag t-sl">linked</span>
            ) : (
              <Action
                label="+ Link"
                title={`Add a site link from ${site.name} to ${o.name}, at zero round trip.`}
                onClick={() => addLink(site.id, o.id)}
              />
            )}
          </div>
        ))}
        </div>
      </Group>
    </>
  );
}
