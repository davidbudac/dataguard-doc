/**
 * One data centre: the hosts standing in it, and its links. Its label is the
 * rail's header, not a row.
 *
 * `+ Host` and `+ Link` used to be pickers on the empty rail, asking which data
 * centre before the button meant anything. Selecting the data centre *is*
 * naming it, so both live here now. The removal is in the rail's header, like
 * every other subject's (`Inspector.tsx`); the links fold, because a pointer
 * draws one from the port beside the name on the drawing.
 */

import type { Site, TopologyDoc } from '@/engine';
import { Action, Fold, Group, Note } from './controls';
import { addHost, addLink, hostsInUse, removeHost } from './edits';
import { SITE_LINKS_ID } from './sections';
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
      <Fold
        id={SITE_LINKS_ID}
        title="Links"
        hint={others.length === 0 ? 'none possible' : `${others.filter(linked).length} of ${others.length} linked`}
      >
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
      </Fold>
    </>
  );
}
