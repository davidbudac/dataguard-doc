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

import { signal } from '@preact/signals';
import { useLayoutEffect } from 'preact/hooks';
import type { Link, Member, Observer, Site, TopologyDoc } from '@/engine';
import { errors, issues, redoGraph, topology, warnings } from '@/state/derived';
import { canEdit, clearSelection, mode, selection, viewport } from '@/state/view';
import { Action, Group, Note, Text } from './controls';
import { AddPalette } from './adds';
import { ConfigForm } from './ConfigForm';
import { LinkForm } from './LinkForm';
import { MemberForm } from './MemberForm';
import { ObserverForm } from './ObserverForm';
import { addHost, mutate, removeHost, removeSite } from './edits';
import { off, ON, WHY } from './why';
import '@/styles/inspector.css';

/**
 * Whether the header's `Add` disclosure is open, for this session.
 *
 * Selecting a card used to replace the whole rail, palette included, so the
 * only way back to `+ Standby database` was to find `Clear` first. The
 * disclosure sits beside `Clear` and opens the same palette in flow -- never a
 * popup: `style-src 'self'` forbids positioning anything from script, and a
 * panel with a fixed place is one the reader can find again (ui.md SS3).
 */
export const addOpen = signal(false);

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

  /* The disclosure belongs to the card it was opened over: its header says
     which subject it sits under, and selecting another one is a new question.
     A palette left hanging open above the next card's properties is a panel
     the reader did not ask for -- and it pushes those properties down the
     rail. Before the read-only return, because a hook is not conditional. */
  useLayoutEffect(() => { addOpen.value = false; }, [sel[0] ?? '']);

  if (!canEdit(viewport.value)) {
    return (
      <div class="insp">
        <Summary doc={doc} />
        <Note warn>{WHY.readOnlyView}</Note>
      </div>
    );
  }

  /* The palette is Build's; Configure narrows the rail to the properties. */
  const canAdd = !narrowed;
  const menuOpen = canAdd && subject !== null && addOpen.value;

  return (
    <div class="insp">
      {subject === null ? null : (
        <header class="insp-hd">
          <span class="eyebrow">{SUBJECT_WORD[subject.kind]}</span>
          <span class="title mono">{sel[0]}</span>
          <span class="rr-spacer" />
          {canAdd ? (
            <button
              type="button"
              class="btn"
              /* `aria-expanded` alone, exactly as `Fold` does it: the palette
                 is genuinely absent while this is shut, and an `aria-controls`
                 naming an element that is not in the document is a reference
                 to nothing rather than a collapsed disclosure. */
              aria-expanded={addOpen.value}
              title="The same additions the empty rail offers, without clearing the selection first"
              onClick={() => { addOpen.value = !addOpen.value; }}
            >
              {`Add ${addOpen.value ? '▾' : '▸'}`}
            </button>
          ) : null}
          <button type="button" class="btn" onClick={() => clearSelection()}>Clear</button>
        </header>
      )}

      {menuOpen ? (
        <Group id="insp-add" title="Add">
          <AddPalette doc={doc} onAdded={() => { addOpen.value = false; }} />
        </Group>
      ) : null}

      {sel.length > 1 ? (
        <Note>
          {sel.length} objects are selected. The properties below are the first one&rsquo;s;
          an action that applies to all of them is on the canvas menu.
        </Note>
      ) : null}

      {subject === null ? (
        <>
          {narrowed ? null : <StartHere />}
          {/* Adding is what a reader arrives to do, so it is above the summary
              of what is already there rather than four screens below it. */}
          {canAdd ? (
            <Group title="Add">
              <AddPalette doc={doc} />
            </Group>
          ) : null}
          <Summary doc={doc} />
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
