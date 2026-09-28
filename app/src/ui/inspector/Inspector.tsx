/**
 * The inspector: whatever is selected, and the configuration when nothing is.
 *
 * The empty state is not empty. A rail with nothing in it teaches nothing, so
 * with no selection this is a summary of the configuration -- what it is, what
 * mode it runs in, what the observer arrangement is -- followed by the
 * configuration's own properties. Selecting a card swaps the properties in;
 * clearing the selection brings the summary back. Adding is not here: the
 * toolbar over the drawing is the one place that adds (ui.md SS3i).
 *
 * Ids are one namespace here, exactly as they are on the canvas: a member, an
 * observer, a link and a site cannot share a name, so a selection key resolves
 * to precisely one subject.
 */

import { useLayoutEffect } from 'preact/hooks';
import type { Link, Member, Observer, Site, TopologyDoc } from '@/engine';
import { errors, issues, redoGraph, topology, warnings } from '@/state/derived';
import { canEdit, clearSelection, hintsOn, mode, selection, viewport } from '@/state/view';
import { Fold, Note } from './controls';
import { isOff, WhyPill } from '../common/WhyPill';
import { removeAction } from '../build/actions';
import { hintsShown, HintsToggle } from '../hints';
import { revealSections, SUMMARY_ID } from './sections';
import { ConfigForm } from './ConfigForm';
import { LinkForm } from './LinkForm';
import { MemberForm } from './MemberForm';
import { ObserverForm } from './ObserverForm';
import { SiteForm } from './SiteForm';
import { WHY } from './why';
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

/** What the header calls the selected object, in the words the drawing uses. */
function subjectWord(s: Exclude<Subject, null>): string {
  switch (s.kind) {
    case 'member':
      if (s.member.kind === 'farsync') return 'Far sync instance';
      return s.member.role === 'primary' ? 'Primary database' : `Standby database (${s.member.role})`;
    case 'observer': return `Observer (${s.observer.role})`;
    case 'link': return s.link.scope === 'site' ? 'Site link' : 'Host link';
    case 'site': return 'Data centre';
  }
}

/**
 * The name the header shows: the identifier for a member or an observer (it
 * is their `db_unique_name` / observer name), the label for a data centre,
 * and the two ends for a link -- a link's id is plumbing nobody typed.
 */
function subjectName(doc: TopologyDoc, s: Exclude<Subject, null>): string {
  const siteName = (id: string): string =>
    doc.sites.find((x) => (x.id as string) === id)?.name ?? id;
  const hostName = (id: string): string =>
    doc.hosts.find((x) => (x.id as string) === id)?.name ?? id;
  switch (s.kind) {
    case 'member': return s.member.id as string;
    case 'observer': return s.observer.id as string;
    case 'site': return s.site.name;
    case 'link': {
      const [a, b] = s.link.ends as [string, string];
      const name = s.link.scope === 'site' ? siteName : hostName;
      return `${name(a)} – ${name(b)}`;
    }
  }
}

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
  /* Folded, and named for what it is. The empty rail used to open with a
     ten-row table of what the configuration already is -- true, and not what
     somebody who has just arrived is looking for. The hint on the closed fold
     carries the one row that is nowhere else on screen (the readout strip
     already reads the protection level, the member count and the findings). */
  return (
    <Fold id={SUMMARY_ID} title="Configuration summary" hint={doc.config.name}>
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
    </Fold>
  );
}

/* ---------------- the rail ---------------- */

export function Inspector() {
  const doc = topology.value;
  const sel = selection.value;
  const subject = resolveSubject(doc, sel[0]);
  const graph = redoGraph.value;
  const narrowed = mode.value === 'configure';

  /* Asking for the explanations is asking for the page to say more about
     itself, and the summary is the rail's own statement of what is drawn --
     so turning `Hints` on opens it. Additive, exactly like the reveal a
     finding does: the fold stays a real toggle the reader can shut again. */
  useLayoutEffect(() => {
    if (hintsShown()) revealSections([SUMMARY_ID]);
  }, [hintsOn.value]);

  if (!canEdit(viewport.value)) {
    return (
      <div class="insp">
        <header class="insp-hd">
          <span class="insp-subj">
            <span class="insp-kind">Configuration</span>
            <span class="title mono" title={doc.config.name}>{doc.config.name}</span>
          </span>
          <span class="rr-spacer" />
          <span class="insp-acts"><HintsToggle /></span>
        </header>
        <Summary doc={doc} />
        <Note warn>{WHY.readOnlyView}</Note>
      </div>
    );
  }

  /* The removal is the Build table's own entry -- the one the Delete key and
     the action bar press -- so it sits in the header, beside the name it
     would remove, rather than at the foot of a form four screens down.
     Configure narrows the rail to the properties. */
  const remove = subject === null || narrowed ? null : removeAction(doc, sel[0] as string);
  const title = subject === null ? doc.config.name : subjectName(doc, subject);

  return (
    <div class="insp">
      {/* The header is the rail's one fixed row, so it is where the `Hints`
          switch lives -- including on the empty rail, which is exactly where a
          reader who wants the prose back is looking. With nothing selected it
          carries that button and nothing else. */}
      <header class="insp-hd">
        {/* What the rail is about, always: the selected object, or the
            configuration itself when nothing is selected. The kind word is
            not an `.eyebrow` -- the eyebrows are the section headings below. */}
        <span class="insp-subj">
          <span class="insp-kind">{subject === null ? 'Configuration' : subjectWord(subject)}</span>
          {/* Ellipsed rather than wrapped mid-word (inspector.css), so the
              whole name rides in the tooltip. */}
          <span class="title mono" title={title}>{title}</span>
        </span>
        <span class="rr-spacer" />
        <span class="insp-acts">
        <HintsToggle />
        {subject === null ? null : (
          <>
            {remove === null ? null : (
              <button
                type="button"
                class={`btn${isOff(remove.enabled) ? ' is-faded' : ''}`}
                disabled={isOff(remove.enabled)}
                title={remove.label}
                onClick={remove.run}
              >
                Remove
              </button>
            )}
            <button type="button" class="btn" onClick={() => clearSelection()}>Clear</button>
          </>
        )}
        </span>
      </header>

      {/* A refused removal says why under the header, not beside the button:
          a sentence in the header's button row pushed `Clear` off the rail. */}
      {remove !== null && isOff(remove.enabled) ? (
        <p class="insp-why"><WhyPill why={remove.enabled} /></p>
      ) : null}

      {sel.length > 1 ? (
        /* A count, not an explanation: it stays whatever the Hints toggle
           says, because nothing else on the rail says the properties below
           belong to only one of the selected cards. */
        <Note always>
          {sel.length} objects are selected. The properties below are the first one&rsquo;s;
          an action that applies to all of them is on the canvas menu.
        </Note>
      ) : null}

      {subject === null ? (
        <>
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
