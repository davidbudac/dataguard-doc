/**
 * The canvas said out loud -- ui design SS4.
 *
 * A drawing that only exists as geometry is unreadable to half its audience,
 * so the same facts leave here twice: a set of generated sentences describing
 * the configuration, and a structural table (site, member, role, host, who
 * feeds it, over what transport, at what round trip) that a screen reader can
 * walk cell by cell. Both are composed per function so they can be tested.
 *
 * Every sentence is either arithmetic over the document or a fact the resolver
 * already labelled; nothing here asserts anything the engine did not.
 */

import type { AnyState, Member, RedoGraph, Snapshot, TopologyDoc } from '@/engine';
import { isFarSync, linkRttMs } from '@/engine';
import type { NodeBox } from './layout';
import { roleWord } from './layout';
import { siteIsDown } from './routing';

export interface AriaRow {
  site: string;
  member: string;
  role: string;
  host: string;
  receivesFrom: string;
  transport: string;
  rtt: string;
}

export interface AriaModel {
  /** One line naming what the drawing is. */
  summary: string;
  sentences: string[];
  rows: AriaRow[];
}

/** Above this many members the sentences collapse to counts. */
export const SENTENCE_LIMIT = 8;

const siteNameOfHost = (doc: TopologyDoc, host: string): string => {
  const h = doc.hosts.find((x) => (x.id as string) === host);
  if (!h) return '';
  return doc.sites.find((s) => (s.id as string) === (h.site as string))?.name ?? (h.site as string);
};

const hostNameOf = (doc: TopologyDoc, host: string): string =>
  doc.hosts.find((x) => (x.id as string) === host)?.name ?? host;

const siteNameOfMember = (doc: TopologyDoc, m: Member): string => {
  const first = m.instances[0];
  return first ? siteNameOfHost(doc, first.host as string) : '';
};

const hostOfMember = (doc: TopologyDoc, m: Member): string => {
  return [...new Set(m.instances.map((i) => hostNameOf(doc, i.host as string)))].join(', ');
};

const memberById = (doc: TopologyDoc, id: string): Member | undefined =>
  doc.members.find((m) => (m.id as string) === id);

/** The member that feeds this one, straight off the resolver's feed path. */
export function feederName(doc: TopologyDoc, graph: RedoGraph, m: Member): string | null {
  const rm = graph.members[m.id];
  if (!rm || rm.feedPath.length < 2) return null;
  const prev = rm.feedPath[rm.feedPath.length - 2];
  if (prev === undefined) return null;
  return memberById(doc, prev as string)?.name ?? (prev as string);
}

/** A member state in words. The vocabulary is the engine's, spelled out. */
export function stateWords(state: AnyState | undefined): string {
  switch (state) {
    case 'open-rw': return 'open read write';
    case 'open-ro': return 'open read only';
    case 'mounted-apply': return 'mounted, applying redo';
    case 'mounted-noapply': return 'mounted, apply stopped';
    case 'stalled': return 'stalled';
    case 'commit-hang': return 'holding commits';
    case 'aborted': return 'aborted';
    case 'converting': return 'converting';
    case 'reinstating': return 'being reinstated';
    case 'disabled': return 'disabled';
    case 'unreachable': return 'unreachable';
    case 'down': return 'down';
    case 'receiving': return 'receiving redo';
    case 'forwarding-stalled': return 'not forwarding';
    case 'master': return 'the master observer';
    case 'backup': return 'a backup observer';
    case 'stopped': return 'stopped';
    case 'lost-primary': return 'no longer reaching the primary';
    case 'lost-target': return 'no longer reaching the target';
    case 'nominating': return 'nominating a new master';
    case 'observe-only': return 'observing only';
    case 'up': return 'up';
    default: return 'unknown';
  }
}

export function transportOf(graph: RedoGraph, m: Member): string {
  const rm = graph.members[m.id];
  return rm?.effectiveXpt ?? '';
}

/** Round trip between a member and whatever feeds it, in the document's links. */
function feedRtt(doc: TopologyDoc, graph: RedoGraph, m: Member): string {
  const rm = graph.members[m.id];
  if (!rm || rm.feedPath.length < 2) return '';
  const prev = rm.feedPath[rm.feedPath.length - 2];
  const from = prev === undefined ? undefined : memberById(doc, prev as string);
  const ha = from?.instances[0]?.host;
  const hb = m.instances[0]?.host;
  if (!ha || !hb) return '';
  return `${linkRttMs(doc, ha, hb)} ms`;
}

export function structuralRows(doc: TopologyDoc, graph: RedoGraph): AriaRow[] {
  const rows: AriaRow[] = [];
  for (const m of doc.members) {
    const feeder = feederName(doc, graph, m);
    rows.push({
      site: siteNameOfMember(doc, m),
      member: m.name,
      role: roleWord(m),
      host: hostOfMember(doc, m),
      receivesFrom: (m.id as string) === (graph.primary as string)
        ? 'nothing: it is the primary'
        : feeder ?? 'nothing',
      transport: transportOf(graph, m),
      rtt: feedRtt(doc, graph, m),
    });
  }
  for (const o of doc.observers) {
    rows.push({
      site: siteNameOfHost(doc, o.host as string),
      member: o.name,
      role: 'Observer',
      host: hostNameOf(doc, o.host as string),
      receivesFrom: '',
      transport: '',
      rtt: '',
    });
  }
  return rows;
}

/** Where the members are: one sentence, or a count when there are many. */
export function shapeSentence(doc: TopologyDoc, graph: RedoGraph): string {
  const primary = memberById(doc, graph.primary as string);
  const others = doc.members.filter((m) => (m.id as string) !== (graph.primary as string));
  const siteCount = new Set(doc.members.map((m) => siteNameOfMember(doc, m))).size;
  if (!primary) {
    return `Topology: ${doc.members.length} members across ${siteCount} sites; no member is the primary.`;
  }
  const head = `Topology: the primary database ${primary.name} in ${siteNameOfMember(doc, primary)}`;
  if (doc.members.length > SENTENCE_LIMIT) {
    return `${head}, and ${others.length} other members across ${siteCount} sites.`;
  }
  const parts = others.map((m) => {
    const kind = isFarSync(m) ? 'the far sync instance' : `the ${roleWord(m).toLowerCase()}`;
    return `${kind} ${m.name} in ${siteNameOfMember(doc, m)}`;
  });
  return parts.length === 0 ? `${head}.` : `${head}, ${parts.join(', ')}.`;
}

/** Who feeds whom, in the resolver's own terms. */
export function redoSentences(doc: TopologyDoc, graph: RedoGraph): string[] {
  const others = doc.members.filter((m) => (m.id as string) !== (graph.primary as string));
  if (others.length > SENTENCE_LIMIT) {
    const reached = others.filter((m) => graph.members[m.id]?.reachableFromPrimary === true).length;
    return [`${reached} of ${others.length} members receive redo from the primary along the routes as configured.`];
  }
  const out: string[] = [];
  for (const m of others) {
    const rm = graph.members[m.id];
    const feeder = feederName(doc, graph, m);
    if (!rm || !rm.reachableFromPrimary || feeder === null) {
      out.push(`No active redo route reaches ${m.name} from the primary.`);
      continue;
    }
    const xpt = rm.effectiveXpt ?? '';
    out.push(`${m.name} receives redo from ${feeder}${xpt ? ` over ${xpt}` : ''}.`);
  }
  return out;
}

/** The observers, and what the fast-start failover state makes of them. */
export function observerSentences(doc: TopologyDoc, frame?: Snapshot | null): string[] {
  const fsfo = doc.config.fsfo.state;
  if (doc.observers.length === 0) {
    return ['No observer is deployed, so fast-start failover is not enabled.'];
  }
  const out: string[] = [];
  if (doc.observers.length > SENTENCE_LIMIT) {
    out.push(`${doc.observers.length} observers are deployed.`);
  } else {
    for (const o of doc.observers) {
      const host = hostNameOf(doc, o.host as string);
      const site = siteNameOfHost(doc, o.host as string);
      const state = frame ? frame.observers[o.id] : undefined;
      const tail = state ? `, ${stateWords(state)}` : '';
      out.push(`Observer ${o.name} runs on host ${host} in ${site}${tail}.`);
    }
  }
  if (fsfo === 'disabled') {
    out.push('Fast-start failover is disabled, so no observer is called the master observer; all observers have the same functionality.');
  } else if (fsfo === 'observe-only') {
    out.push('Fast-start failover is enabled in observe-only mode: the observer reports what it would have done and never fails over.');
  } else {
    const master = doc.observers.find((o) => o.role === 'master');
    if (master) out.push(`${master.name} is the master observer; only the master observer can coordinate fast-start failover.`);
  }
  return out;
}

/** One latency sentence while every drawn link agrees; otherwise the table says it. */
export function latencySentence(doc: TopologyDoc): string | null {
  const rtts = new Set(doc.links.map((l) => l.rttMs));
  if (rtts.size !== 1) return null;
  const only = [...rtts][0];
  if (only === undefined) return null;
  return `Every link carries ${only} ms of round-trip latency.`;
}

/** What the drawing is showing at this instant of the trace. */
export function frameSentence(doc: TopologyDoc, frame: Snapshot): string {
  const parts: string[] = [];
  for (const m of doc.members) {
    const st = frame.members[m.id];
    if (st === undefined) continue;
    parts.push(`${m.name} is ${stateWords(st)}`);
  }
  const t = Math.round(frame.t * 10) / 10;
  if (parts.length === 0) return `At t = ${t} s.`;
  if (parts.length > SENTENCE_LIMIT) return `At t = ${t} s: ${parts.length} members, listed in the table below.`;
  return `At t = ${t} s: ${parts.join(', ')}.`;
}

export function describeTopology(
  doc: TopologyDoc, graph: RedoGraph, frame?: Snapshot | null,
): AriaModel {
  const sentences: string[] = [shapeSentence(doc, graph)];
  sentences.push(...redoSentences(doc, graph));
  sentences.push(...observerSentences(doc, frame));
  const lat = latencySentence(doc);
  if (lat) sentences.push(lat);
  if (frame) sentences.push(frameSentence(doc, frame));
  const summary = `Topology of the Data Guard configuration ${doc.config.name}: `
    + `${doc.members.length} members, ${doc.observers.length} observers, `
    + `${doc.sites.length} sites.`;
  return { summary, sentences, rows: structuralRows(doc, graph) };
}

/** The label a single card carries, host name spelled in full. */
export function cardLabel(
  doc: TopologyDoc, graph: RedoGraph, node: NodeBox, frame?: Snapshot | null,
): string {
  if (node.kind === 'observer') {
    const o = doc.observers.find((x) => (x.id as string) === node.id);
    if (!o) return 'Observer';
    const host = hostNameOf(doc, o.host as string);
    const site = siteNameOfHost(doc, o.host as string);
    const st = frame ? frame.observers[o.id] : undefined;
    const role = doc.config.fsfo.state === 'disabled'
      ? 'observer'
      : o.role === 'master' ? 'master observer' : 'backup observer';
    return `${o.name}, ${role} on host ${host} in ${site}${st ? `, ${stateWords(st)}` : ''}.`;
  }
  const m = memberById(doc, node.id);
  if (!m) return node.id;
  const host = hostOfMember(doc, m);
  const site = siteNameOfMember(doc, m);
  const rac = m.instances.length > 1
    ? `, a ${m.instances.length}-instance cluster` : '';
  const rm = graph.members[m.id];
  const feeder = feederName(doc, graph, m);
  const feed = (m.id as string) === (graph.primary as string)
    ? 'It is the primary.'
    : rm && rm.reachableFromPrimary && feeder
      ? `It receives redo from ${feeder}${rm.effectiveXpt ? ` over ${rm.effectiveXpt}` : ''}.`
      : 'No active redo route reaches it from the primary.';
  const st = frame ? frame.members[m.id] : undefined;
  const kind = isFarSync(m) ? 'Far sync instance' : roleWord(m);
  return `${kind} ${m.name} on ${m.instances.length > 1 ? 'hosts' : 'host'} ${host} in ${site}${rac}. ${feed}${st ? ` It is ${stateWords(st)}.` : ''}`;
}

/**
 * The label a data centre's rectangle carries.
 *
 * A site rect became a control in the same pass that gave the drawing its
 * action bar, and a control with no name is a control a screen reader reads as
 * "button". What it says is what the drawing shows about it: the name, what is
 * standing in it, and -- only when a frame says so -- that it is gone. The
 * count is of members and observers rather than of hosts, because those are
 * the things drawn inside the rectangle.
 */
export function siteLabel(
  doc: TopologyDoc, site: { id: string; name: string }, frame?: Snapshot | null,
): string {
  const hosts = new Set(
    doc.hosts.filter((h) => (h.site as string) === site.id).map((h) => h.id as string),
  );
  const members = doc.members.filter(
    (m) => m.instances.some((i) => hosts.has(i.host as string)),
  ).length;
  const observers = doc.observers.filter((o) => hosts.has(o.host as string)).length;
  const count = [
    `${members} ${members === 1 ? 'member' : 'members'}`,
    `${observers} ${observers === 1 ? 'observer' : 'observers'}`,
  ].join(', ');
  const down = siteIsDown(doc, site.id, frame) ? ' It is down.' : '';
  return `Data centre ${site.name}: ${count}.${down}`;
}

/**
 * The label a link's caption pill carries.
 *
 * The pill already has a `<title>` -- the sentence the router composed for the
 * tooltip -- and this is that sentence and not a second one: two descriptions
 * of one line is exactly the drift the action tables are shaped to prevent.
 */
export function linkLabel(_doc: TopologyDoc, link: { title: string }): string {
  return link.title;
}
