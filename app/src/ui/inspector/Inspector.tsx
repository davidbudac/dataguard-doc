/**
 * The inspector: whatever is selected, and the configuration when nothing is.
 *
 * The empty state is not empty. A rail with nothing in it teaches nothing, so
 * with no selection this is a summary of the configuration -- what it is, what
 * mode it runs in, what the observer arrangement is -- followed by the
 * configuration's own properties and the palette that adds to it. Selecting a
 * card swaps the properties in; clearing the selection brings the summary
 * back.
 *
 * Ids are one namespace here, exactly as they are on the canvas: a member, an
 * observer, a link and a site cannot share a name, so a selection key resolves
 * to precisely one subject.
 */

import { useState } from 'preact/hooks';
import type { Link, Member, Observer, Site, TopologyDoc } from '@/engine';
import { siteId as toSiteId } from '@/engine';
import { errors, issues, redoGraph, topology, warnings } from '@/state/derived';
import { canEdit, clearSelection, mode, selection, viewport } from '@/state/view';
import { Action, Group, Note, Text } from './controls';
import { Pick } from './controls';
import { ConfigForm } from './ConfigForm';
import { LinkForm } from './LinkForm';
import { MemberForm } from './MemberForm';
import { ObserverForm } from './ObserverForm';
import {
  addDatabase, addFarSync, addHost, addLink, addObserver, addSite, mutate, removeHost, removeSite,
} from './edits';
import { off, ON, WHY } from './why';
import '@/styles/inspector.css';

type Subject =
  | { kind: 'member'; member: Member }
  | { kind: 'observer'; observer: Observer }
  | { kind: 'link'; link: Link }
  | { kind: 'site'; site: Site }
  | null;

export function resolveSubject(doc: TopologyDoc, key: string | undefined): Subject {
  if (key === undefined) return null;
  const member = doc.members.find((m) => (m.id as string) === key);
  if (member) return { kind: 'member', member };
  const observer = doc.observers.find((o) => (o.id as string) === key);
  if (observer) return { kind: 'observer', observer };
  const link = doc.links.find((l) => (l.id as string) === key);
  if (link) return { kind: 'link', link };
  const site = doc.sites.find((s) => (s.id as string) === key);
  if (site) return { kind: 'site', site };
  return null;
}

const SUBJECT_WORD: Record<Exclude<Subject, null>['kind'], string> = {
  member: 'Member', observer: 'Observer', link: 'Link', site: 'Site',
};

/* ---------------- the sections ---------------- */

function Summary({ doc }: { doc: TopologyDoc }) {
  const primary = doc.members.find((m) => m.kind === 'database' && m.role === 'primary');
  const standbys = doc.members.filter((m) => m.kind === 'database' && m.role !== 'primary');
  const farsyncs = doc.members.filter((m) => m.kind === 'farsync');
  const running = doc.observers.filter((o) => o.running);
  const target = doc.config.fsfo.target;
  const rows: [string, string][] = [
    ['Configuration', doc.config.name],
    ['Release', doc.config.edition],
    ['Protection mode', doc.config.protectionMode],
    ['Primary', primary ? (primary.id as string) : 'none declared'],
    ['Standbys', standbys.length === 0 ? 'none' : standbys.map((m) => m.id as string).join(', ')],
    ['Far sync', farsyncs.length === 0 ? 'none' : farsyncs.map((m) => m.id as string).join(', ')],
    ['Fast-start failover', doc.config.fsfo.state],
    ['Target', target.kind === 'ANY' ? 'ANY' : (target.members.join(', ') || 'not set')],
    [
      'Observers',
      doc.observers.length === 0
        ? 'none deployed'
        : `${doc.observers.length} deployed, ${running.length} running`,
    ],
    ['Data centres', doc.sites.map((s) => s.name).join(', ') || 'none'],
    [
      'Findings',
      issues.value.length === 0
        ? 'none, as modelled here'
        : `${errors.value.length} error${errors.value.length === 1 ? '' : 's'}, ${warnings.value.length} warning${warnings.value.length === 1 ? '' : 's'}, ${issues.value.length} in all`,
    ],
  ];
  return (
    <Group title="This configuration">
      <dl class="sum">
        {rows.map(([k, v]) => (
          <div class="sum-row" key={k}>
            <dt>{k}</dt>
            <dd class="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <Note>
        Select a card, a site or a line on the drawing to edit it. Nothing here is hidden:
        what a control cannot do, it says.
      </Note>
    </Group>
  );
}

/**
 * What to do first, in the one place a reader looks when nothing is selected.
 *
 * The empty rail used to open with a table of what the configuration already
 * is -- true, and no help at all to somebody who has just arrived and wants to
 * know where to click. Three numbered steps go above it; the summary keeps its
 * place underneath.
 */
function StartHere() {
  return (
    <Group title="Start here">
      <ol class="steps">
        <li>Click a card, a data centre or a line on the drawing to edit it.</li>
        <li>Add a standby, a far sync or an observer with the buttons below.</li>
        <li>Switch to Break to fail something and watch the clocks.</li>
      </ol>
    </Group>
  );
}

function Palette({ doc }: { doc: TopologyDoc }) {
  const [site, setSite] = useState<string>(doc.sites[0]?.id as string ?? '');
  const [from, setFrom] = useState<string>(doc.sites[0]?.id as string ?? '');
  const [to, setTo] = useState<string>(doc.sites[1]?.id as string ?? '');
  const siteOptions = doc.sites.map((s) => ({ value: s.id as string, label: s.name }));
  const linked = doc.links.some((l) => l.scope === 'site'
    && (l.ends as [string, string]).includes(from) && (l.ends as [string, string]).includes(to));

  return (
    <Group title="Add">
      <div class="pal">
        <Action label="+ Standby database" onClick={() => addDatabase()} />
        <Action label="+ Far sync instance" onClick={() => addFarSync()} />
        <Action label="+ Observer" onClick={() => addObserver()} />
        <Action label="+ Data centre" onClick={() => addSite()} />
      </div>
      <div class="pal">
        <Pick
          name="Host in"
          prose
          value={site}
          options={siteOptions}
          onChange={setSite}
        />
        <Action
          label="+ Host"
          enabled={site === '' ? off('There is no data centre to put it in yet.') : ON}
          onClick={() => addHost(toSiteId(site))}
        />
      </div>
      <div class="pal">
        <Pick name="Link from" prose value={from} options={siteOptions} onChange={setFrom} />
        <Pick name="to" prose value={to} options={siteOptions} onChange={setTo} />
        <Action
          label="+ Link"
          enabled={from === to
            ? off('A link runs between two different data centres.')
            : linked ? off('These two data centres are linked already.') : ON}
          onClick={() => addLink(toSiteId(from), toSiteId(to))}
        />
      </div>
      <Note>
        A new database lands in a data centre that has none, on a host of its own, and
        the primary is given destination properties for it. A new observer gets a host of
        its own too: an observer is never deployed on a database server or cluster.
      </Note>
    </Group>
  );
}

function SiteForm({ site, doc }: { site: Site; doc: TopologyDoc }) {
  const hosts = doc.hosts.filter((h) => h.site === site.id);
  const used = new Set<string>();
  for (const m of doc.members) for (const i of m.instances) used.add(i.host as string);
  for (const o of doc.observers) used.add(o.host as string);
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
        {hosts.length === 0 ? <Note>No hosts in this data centre yet.</Note> : null}
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
          <Action
            label={`Remove ${site.id as string}`}
            enabled={hosts.length > 0 ? off(WHY.siteHasHosts) : ON}
            onClick={() => removeSite(site.id)}
          />
        </div>
      </Group>
    </>
  );
}

/* ---------------- the rail ---------------- */

export function Inspector() {
  const doc = topology.value;
  const sel = selection.value;
  const subject = resolveSubject(doc, sel[0]);
  const graph = redoGraph.value;
  const narrowed = mode.value === 'configure';

  if (!canEdit(viewport.value)) {
    return (
      <div class="insp">
        <Summary doc={doc} />
        <Note warn>{WHY.readOnlyView}</Note>
      </div>
    );
  }

  return (
    <div class="insp">
      {subject === null ? null : (
        <header class="insp-hd">
          <span class="eyebrow">{SUBJECT_WORD[subject.kind]}</span>
          <span class="title mono">{sel[0]}</span>
          <span class="rr-spacer" />
          <button type="button" class="btn" onClick={() => clearSelection()}>Clear</button>
        </header>
      )}

      {sel.length > 1 ? (
        <Note>
          {sel.length} objects are selected. The properties below are the first one&rsquo;s;
          an action that applies to all of them is on the canvas menu.
        </Note>
      ) : null}

      {subject === null ? (
        <>
          {narrowed ? null : <StartHere />}
          <Summary doc={doc} />
          {narrowed ? null : <Palette doc={doc} />}
          <ConfigForm doc={doc} />
        </>
      ) : null}

      {subject?.kind === 'member'
        ? <MemberForm member={subject.member} doc={doc} graph={graph} />
        : null}
      {subject?.kind === 'observer'
        ? <ObserverForm observer={subject.observer} doc={doc} />
        : null}
      {subject?.kind === 'link' ? <LinkForm link={subject.link} doc={doc} /> : null}
      {subject?.kind === 'site' ? <SiteForm site={subject.site} doc={doc} /> : null}
    </div>
  );
}
