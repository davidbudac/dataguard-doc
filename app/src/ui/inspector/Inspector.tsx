/**
 * The inspector: whatever is selected, and the configuration when nothing is.
 *
 * At `wide`, in Topology and Config, the rail is not on screen until something
 * is selected or the reader opened it (`App.tsx`), so this is never a summary of
 * what the drawing already shows. With nothing selected it is the
 * configuration's own properties; selecting a card swaps the subject's in.
 * Adding is not here: the toolbar over the drawing is the one place that adds
 * (ui.md SS3i).
 *
 * The header is the subject: a tile with the card's glyph, the kind of thing
 * over its name, and the name is the field that renames it -- the
 * configuration's, a member's `db_unique_name`, an observer's, a data centre's,
 * an application's. A link and a derived line have no name of their own, so
 * their title is plain text. The header carries `Hints` and `Remove` where
 * there is something to remove; what closes the rail is the rail bar's button
 * above it (`RailFrame.tsx`), not a second one here.
 *
 * Ids are one namespace here, exactly as they are on the canvas: a member, an
 * observer, a link and a site cannot share a name, so a selection key resolves
 * to precisely one subject.
 */

import type { ComponentChildren } from 'preact';
import { findApplication } from '@/engine';
import type { Application, Instance, Link, Member, Observer, Site, TopologyDoc } from '@/engine';
import { redoGraph, topology } from '@/state/derived';
import { parseInstanceKey } from '@/state/instanceKey';
import { canEdit, mode, selection, viewport } from '@/state/view';
import { NameField, Note } from './controls';
import { isOff } from '../common/WhyPill';
import { removeAction } from '../build/actions';
import { resolveRoute, routesOn, routeWord } from '../build/routes';
import type { RouteRef } from '../build/routes';
import { RouteSection } from './RouteSection';
import { hintsShown, HintsToggle } from '../hints';
import { ApplicationForm } from './ApplicationForm';
import { ConfigForm } from './ConfigForm';
import { InstanceForm } from './InstanceForm';
import { LinkForm } from './LinkForm';
import { MemberForm } from './MemberForm';
import { ObserverForm } from './ObserverForm';
import { SiteForm } from './SiteForm';
import { renameApplication, renameConfig, renameMember, renameObserver, renameSite } from './edits';
import { WHY } from './why';
import { useRailRow } from '../common/Field';
import '@/styles/inspector.css';

type Subject =
  | { kind: 'member'; member: Member }
  | { kind: 'instance'; member: Member; index: number; instance: Instance }
  | { kind: 'observer'; observer: Observer }
  | { kind: 'application'; application: Application }
  | { kind: 'link'; link: Link }
  | { kind: 'site'; site: Site }
  | { kind: 'route'; route: RouteRef }
  | null;

export function resolveSubject(doc: TopologyDoc, key: string | undefined): Subject {
  if (key === undefined) return null;
  const member = doc.members.find((m) => (m.id as string) === key);
  if (member) return { kind: 'member', member };
  const observer = doc.observers.find((o) => (o.id as string) === key);
  if (observer) return { kind: 'observer', observer };
  const application = findApplication(doc, key);
  if (application !== undefined) return { kind: 'application', application };
  const link = doc.links.find((l) => (l.id as string) === key);
  if (link) return { kind: 'link', link };
  const site = doc.sites.find((s) => (s.id as string) === key);
  if (site) return { kind: 'site', site };
  /* A derived line, selected by its own key when it rides no link. */
  const route = resolveRoute(doc, key);
  if (route) return { kind: 'route', route };
  /* An instance of a RAC database (`sby01~2`): last, so a name typed into the
     document can never be shadowed by it -- every exact id above wins. */
  const at = parseInstanceKey(key);
  const owner = at === null ? undefined : doc.members.find((m) => (m.id as string) === at.member);
  const instance = at === null ? undefined : owner?.instances[at.index];
  if (at !== null && owner !== undefined && instance !== undefined) {
    return { kind: 'instance', member: owner, index: at.index, instance };
  }
  return null;
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** What the header calls the selected object, in the words the drawing uses. */
function subjectWord(s: Exclude<Subject, null>): string {
  switch (s.kind) {
    case 'member':
      if (s.member.kind === 'farsync') return 'Far sync instance';
      return s.member.role === 'primary' ? 'Primary database' : `${cap(s.member.role)} standby`;
    case 'instance': return `RAC instance of ${s.member.id as string}`;
    case 'observer': return `${cap(s.observer.role)} observer`;
    case 'application': return 'Application';
    case 'link': return s.link.scope === 'site' ? 'Site link' : 'Host link';
    case 'site': return 'Data centre';
    case 'route': return routeWord(s.route);
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
    case 'instance': return s.instance.name;
    case 'observer': return s.observer.id as string;
    case 'application': return s.application.id as string;
    case 'site': return s.site.name;
    case 'route': return `${s.route.from} → ${s.route.to}`;
    case 'link': {
      const [a, b] = s.link.ends as [string, string];
      const name = s.link.scope === 'site' ? siteName : hostName;
      return `${name(a)} – ${name(b)}`;
    }
  }
}

/** The subject's tone: the drawing's colour for that kind of object. */
type Tone = 'tl' | 'bl' | 'lk' | 'vi' | 'cn' | 'sl';
type Glyph = 'db' | 'farsync' | 'observer' | 'app' | 'link' | 'dc' | 'config';

function subjectLook(s: Subject): { tone: Tone; glyph: Glyph } {
  if (s === null) return { tone: 'sl', glyph: 'config' };
  switch (s.kind) {
    case 'member':
      if (s.member.kind === 'farsync') return { tone: 'lk', glyph: 'farsync' };
      return { tone: s.member.role === 'primary' ? 'tl' : 'bl', glyph: 'db' };
    case 'instance': return subjectLook({ kind: 'member', member: s.member });
    case 'observer': return { tone: 'vi', glyph: 'observer' };
    case 'application': return { tone: 'cn', glyph: 'app' };
    case 'link': return { tone: 'lk', glyph: 'link' };
    case 'route': return { tone: 'lk', glyph: 'link' };
    case 'site': return { tone: 'sl', glyph: 'dc' };
  }
}

/**
 * The tile at the head of the rail: the same glyph the card on the drawing
 * carries (TopoCanvas's `<defs>`), in the same tone, so the rail and the card
 * read as one object. Decorative -- the kind word beside it says it in words.
 */
function KindTile({ tone, glyph }: { tone: Tone; glyph: Glyph }) {
  return (
    <span class={`insp-tile t-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {glyph === 'db' ? (
          <>
            <ellipse cx="12" cy="6" rx="8" ry="3.2" />
            <path d="M4,6 V18 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2 V6" />
            <path d="M4,12 c0,1.77 3.58,3.2 8,3.2 s8,-1.43 8,-3.2" />
          </>
        ) : null}
        {glyph === 'farsync' ? (
          <>
            <ellipse cx="10" cy="6" rx="7" ry="2.8" />
            <path d="M3,6 V15 M17,6 V15 M14,11 L19,15.5 L14,20" />
          </>
        ) : null}
        {glyph === 'observer' ? (
          <>
            <path d="M2.5,12 C5.5,6.8 8.6,4.6 12,4.6 s6.5,2.2 9.5,7.4 C18.5,17.2 15.4,19.4 12,19.4 s-6.5,-2.2 -9.5,-7.4 Z" />
            <circle cx="12" cy="12" r="3.1" />
          </>
        ) : null}
        {glyph === 'app' ? (
          <>
            <rect x="3" y="4.5" width="18" height="15" rx="2" />
            <path d="M3,9 H21 M9.5,12.5 L7,14.75 L9.5,17 M14.5,12.5 L17,14.75 L14.5,17" />
          </>
        ) : null}
        {glyph === 'link' ? (
          <>
            <circle cx="5" cy="17" r="2.4" />
            <circle cx="19" cy="7" r="2.4" />
            <path d="M7,15.6 L17,8.4" />
          </>
        ) : null}
        {glyph === 'dc' ? (
          <path d="M2,21 H22 M4,21 V4.5 L13,2 V21 M13,8 H20 V21 M7,8 H10 M7,12 H10 M7,16 H10 M16,12 H17 M16,16 H17" />
        ) : null}
        {glyph === 'config' ? (
          <path d="M4,7 H20 M4,12 H20 M4,17 H20 M8,5 V9 M15,10 V14 M10,15 V19" />
        ) : null}
      </svg>
    </span>
  );
}

/**
 * The header's subject: the tile, the kind word over the name. The name is
 * whatever the caller puts in: the field that renames it, or plain text.
 */
function SubjectHead(
  { look, kind, children }: { look: { tone: Tone; glyph: Glyph }; kind: string; children: ComponentChildren },
) {
  return (
    <span class="insp-subj">
      <KindTile tone={look.tone} glyph={look.glyph} />
      <span class="insp-subj-t">
        <span class="insp-kind" title={kind}>{kind}</span>
        {children}
      </span>
    </span>
  );
}

/** A name the reader did not choose: a link's ends, a derived line, an instance of a RAC database. */
function PlainName({ name }: { name: string }) {
  /* Ellipsed rather than wrapped mid-word (inspector.css), so the whole name
     rides in the tooltip. */
  return <span class="insp-title mono" title={name}>{name}</span>;
}

/**
 * The header's title where the subject has a name of its own: the field that
 * renames it, and -- with `Hints` on, and only then -- the sentence that says
 * what a rename does.
 */
function HeaderName(
  { label, value, onCommit, focusKey, note }:
  { label: string; value: string; onCommit: (v: string) => void; focusKey?: string; note: string },
) {
  return (
    <>
      <NameField label={label} value={value} onCommit={onCommit} {...(focusKey === undefined ? {} : { focusKey })} />
      {hintsShown() ? <span class="insp-note">{note}</span> : null}
    </>
  );
}

/**
 * What the header says about the subject: the kind, the name (a field where it
 * can be renamed) and the sentence that rides with `Hints`.
 *
 * Keyed on the subject by the caller, so a rename that follows the card (the id
 * changes with it) and a selection that moves to another card each get a field
 * of their own, never one holding the last card's half-typed name.
 */
function Heading({ subject, doc }: { subject: Subject; doc: TopologyDoc }) {
  const look = subjectLook(subject);
  if (subject === null) {
    return (
      <SubjectHead look={look} kind="Configuration">
        <HeaderName
          label="Configuration name"
          value={doc.config.name}
          onCommit={renameConfig}
          note="The name of the broker configuration. It is a label: nothing else refers to it."
        />
      </SubjectHead>
    );
  }
  const kind = subjectWord(subject);
  switch (subject.kind) {
    case 'member':
      /* The eyebrow says which name this is: the member's identity, as Oracle
         spells it. */
      return (
        <SubjectHead look={look} kind={`${kind} · db_unique_name`}>
          <HeaderName
            label="db_unique_name"
            value={subject.member.id as string}
            onCommit={(v) => renameMember(subject.member.id, v)}
            focusKey={`name:${subject.member.id as string}`}
            note="The member's identity, and its name. Renaming it rewrites every reference in this configuration in the same edit."
          />
        </SubjectHead>
      );
    case 'observer':
      return (
        <SubjectHead look={look} kind={kind}>
          <HeaderName
            label="Observer name"
            value={subject.observer.id as string}
            onCommit={(v) => renameObserver(subject.observer.id, v)}
            focusKey={`name:${subject.observer.id as string}`}
            note="The name START OBSERVER gives it, and how SET MASTEROBSERVER TO names it."
          />
        </SubjectHead>
      );
    case 'application':
      return (
        <SubjectHead look={look} kind={kind}>
          <HeaderName
            label="Application name"
            value={subject.application.id as string}
            onCommit={(v) => renameApplication(subject.application.id as string, v)}
            focusKey={`name:${subject.application.id as string}`}
            note="A label for the card. Nothing in the generated configuration carries it."
          />
        </SubjectHead>
      );
    case 'site':
      return (
        <SubjectHead look={look} kind={kind}>
          <HeaderName
            label="Data centre name"
            value={subject.site.name}
            onCommit={(v) => renameSite(subject.site.id, v)}
            focusKey={`name:${subject.site.id as string}`}
            note="The label under the site rectangle. The data centre's identity does not change with it."
          />
        </SubjectHead>
      );
    case 'instance':
    case 'link':
    case 'route':
      return (
        <SubjectHead look={look} kind={kind}>
          <PlainName name={subjectName(doc, subject)} />
        </SubjectHead>
      );
  }
}

/* ---------------- the rail ---------------- */

export function Inspector() {
  /* The row-or-stack choice of every field below is made against this
     rail's measured width (common/Field.tsx), not the floating card's. */
  const railRef = useRailRow();
  const doc = topology.value;
  const sel = selection.value;
  const subject = resolveSubject(doc, sel[0]);
  const graph = redoGraph.value;
  const narrowed = mode.value === 'configure';

  if (!canEdit(viewport.value)) {
    return (
      <div class="insp" ref={railRef}>
        <header class="insp-hd">
          <SubjectHead look={subjectLook(null)} kind="Configuration">
            <PlainName name={doc.config.name} />
          </SubjectHead>
          <span class="insp-acts"><HintsToggle /></span>
        </header>
        <Note warn>{WHY.readOnlyView}</Note>
      </div>
    );
  }

  /* The removal is the Build table's own entry -- the one the Delete key and
     the action bar press -- so it sits in the header, beside the name it
     would remove, rather than at the foot of a form four screens down.
     Configure narrows the rail to the properties. */
  const remove = subject === null || narrowed ? null : removeAction(doc, sel[0] as string);
  const refused = remove !== null && isOff(remove.enabled) ? remove.enabled.why : null;

  return (
    <div class="insp" ref={railRef}>
      {/* The header is the rail's one fixed row, so it is where the `Hints`
          switch lives -- including on the configuration, which is exactly
          where a reader who wants the prose back is looking. `Remove` is
          there for a subject that can go. What shuts the rail is the bar
          above (`RailFrame.tsx`). */}
      <header class="insp-hd">
        {/* What the rail is about, always: the selected object, or the
            configuration itself when nothing is selected. The kind word is
            not an `.eyebrow` -- the eyebrows are the section headings below. */}
        <Heading key={subject === null ? '' : sel[0]} subject={subject} doc={doc} />
        <span class="insp-acts">
          <HintsToggle />
          {remove === null ? null : (
            <>
              {/* A refusal is the button's own to carry: its tooltip and the
                  text a screen reader reads with it. No box on the rail for
                  something the reader has not asked about. */}
              <button
                type="button"
                class={`btn is-icon insp-remove${refused === null ? '' : ' is-faded'}`}
                disabled={refused !== null}
                title={refused === null ? remove.label : `${remove.label}: ${refused}`}
                {...(refused === null ? {} : { 'aria-describedby': 'insp-remove-why' })}
                onClick={remove.run}
              >
                <svg class="insp-ico" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M2.75,4.25 H13.25 M6.25,4.25 V2.75 H9.75 V4.25 M4,4.25 L4.75,13.25 H11.25 L12,4.25 M6.75,7 V10.75 M9.25,7 V10.75" />
                </svg>
                <span class="sr">Remove</span>
              </button>
              {refused === null ? null : <span class="sr" id="insp-remove-why">{refused}</span>}
            </>
          )}
        </span>
      </header>

      {sel.length > 1 ? (
        /* A count, not an explanation: it stays whatever the Hints toggle
           says, because nothing else on the rail says the properties below
           belong to only one of the selected cards. */
        <Note always>
          {sel.length} objects are selected. The properties below are the first one&rsquo;s;
          an action that applies to all of them is on the canvas menu.
        </Note>
      ) : null}

      {subject === null ? <ConfigForm doc={doc} /> : null}

      {subject?.kind === 'member'
        ? <MemberForm member={subject.member} doc={doc} graph={graph} />
        : null}
      {subject?.kind === 'instance'
        ? <InstanceForm member={subject.member} index={subject.index} doc={doc} />
        : null}
      {subject?.kind === 'observer'
        ? <ObserverForm observer={subject.observer} doc={doc} />
        : null}
      {subject?.kind === 'application'
        ? <ApplicationForm application={subject.application} doc={doc} />
        : null}
      {subject?.kind === 'link' ? <LinkForm link={subject.link} doc={doc} /> : null}
      {subject?.kind === 'link' || subject?.kind === 'route'
        ? <RouteSection doc={doc} routeKeys={subject.kind === 'route'
          ? [subject.route.key]
          : routesOn(doc, subject.link.id as string).map((r) => r.key)}
          offer={subject.kind === 'link'} />
        : null}
      {subject?.kind === 'site' ? <SiteForm site={subject.site} doc={doc} /> : null}
    </div>
  );
}
