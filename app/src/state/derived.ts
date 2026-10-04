/**
 * Everything derived, in one file, flowing one way (ui.md SS2).
 *
 * No component computes domain state locally. A component reads a signal from
 * here or it renders nothing -- which is what keeps the drawing, the timeline,
 * the generated configuration and the readout from ever disagreeing about the
 * same deployment.
 *
 * Slots other agents own are marked TODO where they belong:
 *   - `geometry`  canvas/layout.ts -- `layoutTopology(topology, layout)`
 *   - `scripts`   generate/* -- `{ dgmgrl, dests, tns, show(frame) }`
 */

import { computed } from '@preact/signals';
import { layoutTopology } from '@/ui/canvas/layout';
import { inFlight, inFlightFrom } from '@/ui/canvas/place';
import { appModelsFor } from '@/ui/timeline/build';
import type { Geometry } from '@/ui/canvas/layout';
import {
  declaredPrimary, edgelessGraph, honestLevel, resolveRedoGraph, simulate, sortFindings, splitBrainOf, stateAt, validate,
} from '@/engine';
import type {
  CitationId, Claim, EngineTrace, Finding, MemberId, Outcome, ProtectionLevel, RedoGraph, SplitBrain,
  Snapshot, TopologyDoc,
} from '@/engine';
import { doc } from './doc';
import { edition, healthyRun, mode, tNow } from './view';
import type { Mode } from './view';

/**
 * The document the engine sees. The edition is a reading preference rather
 * than a property of the deployment (ui.md SS2), so it is stamped on here --
 * once, in one place -- instead of being written into the Document where undo
 * and the share link would carry it.
 */
export const topology = computed<TopologyDoc>(() => {
  const t = doc.value.topology;
  if (t.config.edition === edition.value) return t;
  return { ...t, config: { ...t.config, edition: edition.value } };
});

export const events = computed(() => topology.value.events);

export const primaryId = computed(() => declaredPrimary(topology.value));

/** The effective redo graph for the declared primary, in the steady state. */
export const redoGraph = computed(() => {
  const primary = primaryId.value;
  if (!primary) return null;
  return resolveRedoGraph(topology.value, { primary });
});

/**
 * The graph the drawing is laid out and drawn over: never null.
 *
 * `redoGraph` is null when no database holds the primary role, and the
 * generators and panels read that null as "nothing to say". The canvas cannot:
 * a drawing that blanks out leaves no card to click, so a configuration that
 * has lost its primary could not be repaired from the drawing. It falls back
 * to the same document with no edges (`edgelessGraph`) -- every card where
 * the layout puts it, no redo drawn -- and CanvasSlot says it is invalid.
 */
export const drawnGraph = computed<RedoGraph>(
  () => redoGraph.value ?? edgelessGraph(topology.value),
);

/**
 * Where every card sits, for the drawing: never null, with or without a primary.
 *
 * The layout is pure and deterministic, so it belongs to the state rather than
 * to whoever is drawing at the moment: the canvas, the Configure strip and the
 * Learn workbench are three views of one drawing, and computing it here is
 * what stops them from being three drawings that agree by coincidence.
 */
export const drawnGeometry = computed<Geometry>(() => layoutTopology(topology.value, drawnGraph.value, {
  overrides: doc.value.layout, transient: inFlight.value, transientFrom: inFlightFrom.value,
}));

/**
 * `drawnGeometry`, or null when there is no redo graph: the answer for the
 * surfaces that draw *the redo* (the Detailed timeline's rail, the diagram
 * figure, the report) and say so in a note of their own when there is none.
 * Only the canvas draws a configuration that has no primary.
 */
export const geometry = computed<Geometry | null>(
  () => (redoGraph.value === null ? null : drawnGeometry.value),
);

/** Validation findings, sorted by (severity, subject, id) the way the engine sorts. */
export const issues = computed<Finding[]>(() => {
  const graph = redoGraph.value;
  return sortFindings([...validate(topology.value), ...(graph ? graph.findings : [])]);
});

export const errors = computed(() => issues.value.filter((f) => f.severity === 'error'));
export const warnings = computed(() => issues.value.filter((f) => f.severity === 'warning'));

/**
 * The run, or null when there is nothing to run.
 *
 * Null is the steady-state reading, not a failure: a deployment with no
 * injected event has a protection level and a redo graph but no outcome, and
 * the readout below says so rather than inventing a clock. Everything
 * downstream branches on that null.
 */
export const trace = computed<EngineTrace | null>(() => {
  const evts = events.value;
  if (evts.length === 0 && !healthyRun.value) return null;
  return simulate(topology.value, evts, doc.value.params);
});

/** The state at the playhead. Scrubbing walks this, nothing re-simulates. */
export const frame = computed<Snapshot | null>(
  () => (trace.value ? stateAt(trace.value, tNow.value) : null),
);

/**
 * What the run itself reported, kept apart from `issues`.
 *
 * `issues` is the validator's answer about the configuration, which is what
 * Build mode's panel shows (ui.md SS3). A run raises findings of a different
 * kind -- the readiness check that forbade a failover, the alternate that
 * activated, the instant a stalled primary aborted -- and they are about this
 * failure rather than about the deployment. They belong to Break mode, so they
 * are a signal of their own instead of being folded into the issue count.
 */
export const runFindings = computed<Finding[]>(
  () => (trace.value ? sortFindings([...trace.value.findings]) : []),
);

/**
 * Whether the drawing, the readout and the aria sentences are reading the run.
 *
 * One answer, asked by everyone. A run exists while `trace` is not null --
 * events are injected, or the healthy "Everything is working" run was asked
 * for -- and it is shown in every mode that draws it: Topology (`build`) and
 * the Detailed timeline (`break`), and Learn's workbench. Configure is about
 * the configuration, so it reads the steady state even when the Document
 * carries events (ui.md SS3). Topology without a run is Build as it always
 * was: monochrome cards, the steady-state readings.
 *
 * Reads signals, so a component that calls it re-renders when the run appears
 * or goes; pass a mode to ask about one the reader is not in.
 */
export function runShown(m: Mode = mode.value): boolean {
  return trace.value !== null && m !== 'configure';
}

export const outcome = computed(() => trace.value?.facts.outcome ?? null);

/**
 * The level at rest, with the label it has earned: a degraded maximum
 * availability configuration "operates as if it were in maximum performance
 * mode", and which value the broker reports meanwhile is not documented.
 */
const steadyLevel = computed<Claim<ProtectionLevel> | null>(() => {
  const level = redoGraph.value?.protectionLevel;
  return level ? honestLevel(level, topology.value.config.protectionMode) : null;
});

export const protectionLevel = computed<Claim<ProtectionLevel> | null>(
  () => trace.value?.epochs.at(-1)?.protectionLevel ?? steadyLevel.value,
);

/* ---------------- the readout ---------------- */

export type Tone = 'ik' | 'tl' | 'bl' | 'am' | 'rd' | 'vi' | 'sl';

export interface ReadoutChip {
  /** Unique on the line. */
  id: string;
  /**
   * The kind of reading, when several chips are of one kind (one per
   * application): what the bar ranks and keeps by. Absent, the id is the kind.
   */
  group?: string;
  tone: Tone;
  /** The eyebrow. */
  k: string;
  /** The number or the word. */
  v: string;
  unit?: string;
  /** A quieter second value on the same line ("6 notes" beside "0 issues"). */
  v2?: string;
  /**
   * One sentence, branching on the outcome and never on the event name. The
   * strip reads at a glance, so the sentence rides in the chip's `title`
   * rather than under it -- it is in the document, not hidden by CSS.
   */
  sub: string;
  /** Present when the value is this page's model rather than documented. */
  basis?: Claim<unknown>['basis'];
  /** What the sentence rests on, where the chip states a domain fact. */
  cite?: CitationId[];
}

const OUTCOME_WORD: Record<Outcome, string> = {
  failover: 'failover',
  continues: 'nothing moved',
  'stall-noone': 'primary stalled',
  'maxprot-shutdown': 'primary shut down',
  manual: 'manual failover',
  'observer-lost': 'no observer',
  switchover: 'switchover',
};

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * One chip for the validator's answer, worded the way the header words it:
 * errors and warnings are issues, information is a note, and a healthy
 * configuration with six notes reads "0 issues", not "6 issues".
 */
function findingsChip(): ReadoutChip {
  const errs = errors.value.length;
  const warns = warnings.value.length;
  const notes = issues.value.length - errs - warns;
  const loud = errs + warns;
  return {
    id: 'findings', tone: errs > 0 ? 'rd' : warns > 0 ? 'am' : 'tl', k: 'Findings',
    v: loud === 0 ? 'no issues' : `${loud} issue${loud === 1 ? '' : 's'}`,
    ...(notes > 0 ? { v2: `${notes} note${notes === 1 ? '' : 's'}` } : {}),
    sub: loud === 0
      ? 'No errors and no warnings in this configuration, as modelled here.'
      : `${errs} error${errs === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}.`,
  };
}

/**
 * The chips under the canvas. Two readings, and the code says which one it is
 * in: with no events injected the deployment has a steady state and no
 * outcome; with events it has an outcome, and every chip branches on that
 * outcome rather than on the name of the event that caused it.
 */
export const readout = computed<ReadoutChip[]>(
  /* Configure is about the configuration, so its readout is the steady state
     even when the Document carries events (ui.md SS3); Topology reads the
     steady state until there is a run, then the run (`runShown`). */
  () => readoutFor(!runShown()),
);

/**
 * The Split brain chip's sentence. It branches on what the drawing shows --
 * who is open, stalled, aborted or down at the instant the new primary opens --
 * and never on the name of the event that led there.
 */
function splitBrainSentence(sb: SplitBrain, topo: TopologyDoc): string {
  const name = (id: MemberId): string => topo.members.find((m) => m.id === id)?.name ?? (id as string);
  const oldP = name(sb.former);
  const newP = name(sb.newPrimary);
  const open = `${newP} opens at ${fmt(sb.openAt)} s`;
  const first = sb.windows[0];
  if (first !== undefined) {
    const more = sb.windows.length > 1
      ? ` (and ${sb.windows.length - 1} more stretch${sb.windows.length === 2 ? '' : 'es'})` : '';
    return first.to === null
      ? `${oldP} and ${newP} are both open read-write from ${fmt(first.from)} s to the end of the run: ${oldP} is still open when ${open}, and nothing in this run closes it${more}.`
      : `${oldP} and ${newP} are both open read-write from ${fmt(first.from)} s to ${fmt(first.to)} s: ${oldP} is still open when ${open}${more}.`;
  }
  const at = sb.formerAtOpen;
  switch (at?.kind) {
    case 'aborted':
      return `${oldP} aborts at ${fmt(at.at)} s, before ${open}.`;
    case 'stalled':
      return at.abortsAt === null
        ? `${oldP} is STALLED when ${open}, and nothing shuts it down; a stalled primary commits nothing, but this drawing keeps it publishing the service, so a client that connects to it reads data ${newP} has moved past (stale reads, not counted as a second open database).`
        : `${oldP} is STALLED when ${open} and cannot commit; it shuts itself down at ${fmt(at.abortsAt)} s.`;
    case 'closed':
      return at.state.startsWith('mounted')
        ? `${oldP} is mounted, not open, when ${open}: it needs reinstating before it can be a standby.`
        : `${oldP} is not open read-write when ${open}.`;
    default:
      return `${oldP} is down when ${open}, so only one database is ever open read-write.`;
  }
}

/**
 * The chips of a run in which nothing is injected -- "Everything is working".
 *
 * Every chip says what the run says and no more: the engine's outcome for an
 * empty event list is `continues`, its data-loss kind `none`, and no member is
 * ever promoted, so there is no split brain to speak of. None of it is an
 * Oracle statement -- it is what this page's model does with a configuration
 * that nothing disturbs -- so each carries the `model` basis, and the strip
 * says "nothing fails" rather than reproducing the words of a failover
 * outcome ("nothing moved") that belong to runs where something did.
 */
function healthyChips(t: EngineTrace, topo: TopologyDoc): ReadoutChip[] {
  const primary = topo.members.find((m) => m.id === t.epochs[0]?.primary);
  const primaryName = primary?.name ?? 'The primary';
  const chips: ReadoutChip[] = [
    {
      id: 'outcome', tone: 'tl', k: 'Outcome', v: 'no failure',
      sub: 'Nothing is injected, so nothing fails: no failover is needed and none is initiated. The run is this page\'s model of the configuration, not a measurement.',
      basis: 'model',
    },
    {
      id: 'loss', tone: 'tl', k: 'Data loss', v: 'none',
      sub: `No role change happens in this run, so nothing ${primaryName} acknowledged is at risk.`,
      basis: 'model',
    },
    {
      id: 'split', tone: 'tl', k: 'Split brain', v: 'no',
      sub: `${primaryName} is the only member ever open read-write: no standby is promoted in this run.`,
      basis: 'model',
    },
  ];
  const models = appModelsFor(t, topo);
  const many = models.length > 1;
  models.forEach((ap, i) => {
    /* Said only of an application that is up and can reach a publisher of its
       service for the whole run; one that cannot gets no reassurance here. */
    if (!ap.spans.every((sp) => sp.appUp && sp.serving !== null)) return;
    const name = ap.application?.name ?? 'the application';
    chips.push({
      id: i === 0 ? 'app' : `app~${i}`, group: 'app', tone: 'tl',
      k: many ? name : 'Application', v: 'served',
      sub: `${name} is served throughout: its service is published, its sessions work and a new connection connects at once, as this page models it.`,
      basis: 'model',
    });
  });
  const observerStates = Object.values(t.facts.observers).map((o) => o.endState);
  const master = observerStates.find((st) => st !== 'backup' && st !== 'stopped');
  if (observerStates.length > 0) {
    chips.push({
      id: 'observer', tone: 'vi', k: 'Observer', v: master ?? (observerStates[0] as string),
      sub: observerStates.length === 1 ? 'The state the observer ends in.'
        : `${observerStates.length} observers deployed; ${master === undefined ? 'none is the master' : "the master's state is shown"}.`,
    });
  }
  chips.push(findingsChip());
  return chips;
}

/**
 * The chips for one of the two readings, whichever mode is open: `steady`
 * asks for the configuration at rest, otherwise the run's outcome (which
 * falls back to the steady reading when there is no run). The printable
 * report asks for both, from any mode.
 */
export function readoutFor(steady: boolean): ReadoutChip[] {
  const t = trace.value;
  const topo = topology.value;
  const graph = redoGraph.value;

  if (!t || steady) {
    const level = graph ? steadyLevel.value : null;
    const modeWord = topo.config.protectionMode;
    const members = topo.members.length;
    const standbys = topo.members.filter((m) => m.kind === 'database' && m.role !== 'primary').length;
    const farSyncs = topo.members.filter((m) => m.kind === 'farsync').length;
    const parts = [
      `${standbys} standby${standbys === 1 ? '' : 's'}`,
      ...(farSyncs > 0 ? [`${farSyncs} far sync`] : []),
      '1 primary',
    ];
    const fsfo = topo.config.fsfo;
    const observersRunning = topo.observers.filter((o) => o.running).length;
    const chips: ReadoutChip[] = [
      {
        id: 'protection', tone: level && level.value !== modeWord ? 'am' : 'tl',
        k: 'Protection level',
        v: level ? level.value : 'unknown',
        /* The mode is what was configured; the level is how the primary is
           operating. When the two differ the chip says so, because the reader
           who set MAXAVAILABILITY and reads MAXPERFORMANCE has been told
           something, not shown a typo. What it must not say is that the
           broker REPORTS this value: Oracle's sentence is "operates as if it
           were in maximum performance mode", and PROTECTION_LEVEL lists
           RESYNCHRONIZATION as a value of its own without saying when. */
        sub: level && level.value !== modeWord
          ? `Configured ${modeWord}, but no synchronized standby is acknowledging, so the primary operates as if it were in maximum performance mode. Which value PROTECTION_LEVEL reports meanwhile is not documented.`
          : level && level.basis !== 'documented'
            ? 'The level the broker would report for this configuration.'
            : 'The level the broker reports while every destination is up.',
        ...(level ? { basis: level.basis } : {}),
      },
      {
        id: 'members', tone: 'ik', k: 'Members', v: String(members),
        sub: `${parts.join(', ')}, as configured.`,
      },
      {
        /* The one property a reader looks for before anything else: whether
           this configuration fails over on its own, and whether an observer
           is there to make it. */
        id: 'fsfo', tone: fsfo.state === 'enabled' ? 'vi' : 'sl',
        k: 'Fast-start failover', v: fsfo.state,
        ...(observersRunning > 0
          ? { v2: `${observersRunning} observer${observersRunning === 1 ? '' : 's'} running` }
          : {}),
        sub: fsfo.state === 'enabled'
          ? 'With ObserverOverride FALSE, automatic failover requires both the observer and the target to lose the primary, and the target to pass its readiness check.'
          : fsfo.state === 'observe-only'
            ? 'The observer reports what it would do but does not initiate failover.'
            : 'Fast-start failover is disabled. A failover here is one an operator types.',
      },
      findingsChip(),
    ];
    return chips;
  }

  const f = t.facts;
  if (topo.events.length === 0) return healthyChips(t, topo);
  /* A transition can be ordered and then forbidden -- the readiness check
     stands between the two, and the engine reports the instant the new primary
     WOULD have opened either way. The readout must not read that instant back
     as a role change that happened, so every chip below branches on `blocked`
     before it branches on the outcome. */
  const moved = !f.blocked && f.newPrimary !== null;
  const chips: ReadoutChip[] = [
    {
      id: 'outcome',
      tone: f.blocked ? 'am' : (f.outcome === 'failover' || f.outcome === 'switchover' ? 'vi' : 'ik'),
      k: 'Outcome',
      /* With nobody promoted, "manual failover" would name a failover that
         did not happen: what is left is an action for an operator. */
      v: f.blocked ? 'blocked'
        : f.outcome === 'manual' && f.newPrimary === null ? 'manual action needed'
          : OUTCOME_WORD[f.outcome],
      sub: f.blocked
        ? 'The transition was ordered and then refused; nothing changed role.'
        : 'The outcome of the whole simulation, not of the moment on screen.',
    },
  ];
  if (moved && f.tOpen !== null) {
    chips.push({
      id: 'open', tone: 'tl', k: 'New primary open', v: fmt(f.tOpen), unit: 's',
      sub: 'Modelled time from the first injected event. How long it takes in practice depends on the environment.',
    });
  }
  /* What the failover cost, in seconds of redo. Zero is the whole promise of
     SYNC and of a far sync, so the strip says it out loud rather than leaving
     the reader to infer it from a transport mode. */
  if (moved && f.newPrimary !== null) {
    const rpo = f.perMember[f.newPrimary]?.rpoSeconds ?? null;
    if (rpo !== null) {
      /* Three readings, and zero is only one of them. A far sync instance
         lost with the primary leaves a loss nobody can put a number on, and
         a manual failover is never "none" by right: it is whatever the
         standby was missing. */
      const unknown = f.dataLossKind === 'unknown';
      const zero = !unknown && rpo.value === 0;
      chips.push({
        id: 'loss', tone: zero ? 'tl' : 'am', k: 'Data loss',
        v: unknown ? 'unknown' : zero ? 'none' : fmt(rpo.value),
        ...(unknown || zero ? {} : { unit: 's' }),
        sub: unknown
          ? 'The far sync instance was down or cut off from the standby when the primary failed, so redo it had not yet forwarded could not be sent on to the standby. This run cannot say how much.'
          : zero
            ? (f.dataLossKind === 'manual'
              ? 'The standby held everything the primary had generated when it was promoted. A manual failover guarantees nothing of the kind.'
              : rpo.basis === 'documented'
                ? 'The new primary opened with every acknowledged commit.'
                : 'The new primary opened with every acknowledged commit, as this page models it.')
            : f.dataLossKind === 'manual'
              ? 'Redo the primary generated that the new primary never received, in seconds. Nothing bounds it.'
              : 'Redo the new primary never received, in seconds.',
        basis: rpo.basis,
        cite: [...rpo.cite],
      });
    }
  }
  if (f.abortAt !== null) {
    /* Two different shutdowns, and the chip never confuses them. A stalled
       primary shuts itself down under FastStartFailoverPmyShutdown one
       threshold after the stall began; a maximum protection primary is shut
       down because no synchronized standby is acknowledging, and the instant
       it happens -- the last acknowledgement plus NET_TIMEOUT -- is this
       page's model, not a documented interval and never a failover clock. */
    const maxprot = f.outcome === 'maxprot-shutdown';
    chips.push({
      id: 'abort', tone: 'rd',
      k: maxprot ? 'Primary shut down' : 'Primary shuts down',
      v: fmt(f.abortAt), unit: 's',
      sub: maxprot
        ? `MaxProtection shut the primary down — no synchronized standby acknowledged. Drawn one NET_TIMEOUT (${fmt(f.netTimeoutSeconds)} s) after the last acknowledgement.`
        : 'The stalled primary shuts itself down.',
      ...(maxprot
        ? {
          basis: 'model' as const,
          cite: ['MAXPROT.SHUTS_PRIMARY', 'MAXPROT.TWO_STANDBYS', 'DEST.NET_TIMEOUT'] as CitationId[],
        }
        : {}),
    });
  }
  /* Whether two members were ever open read-write together. Asked only where
     a new primary opens by failover, and this page's model: Oracle has no
     interval for it, so the answer is read off the drawing (splitBrainOf). */
  const sb = splitBrainOf(t);
  if (sb !== null) {
    chips.push({
      id: 'split', tone: sb.split.value ? 'rd' : 'tl', k: 'Split brain',
      v: sb.split.value ? 'yes' : 'no',
      sub: splitBrainSentence(sb, topo),
      basis: sb.split.basis,
      cite: [...sb.split.cite],
    });
  }
  /* What the run cost each application: when its connect string got through,
     or that it never did. This page's model, from where each card stands. One
     reading per application, each naming its own; with a single application
     the reading keeps the plain "Application" eyebrow. */
  const models = appModelsFor(t, topo);
  const many = models.length > 1;
  const memberName = (id: string | null): string =>
    topo.members.find((m) => (m.id as string) === id)?.name ?? (id ?? '');
  models.forEach((ap, i) => {
    if (ap.noEvent && ap.noEventKind !== 'app-down') return;
    const name = ap.application?.name ?? 'the application';
    const eyebrow = many ? name : 'Application';
    const base = {
      /* The first keeps the plain id; the rest are told apart by their place. */
      id: i === 0 ? 'app' : `app~${i}`,
      group: 'app',
    };
    chips.push(ap.tConn !== null
      ? {
        ...base, tone: 'tl', k: many ? `${name} reconnects` : 'Application reconnects', v: fmt(ap.tConn), unit: 's',
        sub: ap.instanceLoss !== null
          ? `${name} gets a new connection at this instant: its sessions on ${ap.instanceLoss.instance} were terminated with the instance while ${memberName(ap.sessionsOn)} went on serving, so the outage is the connect string's own.`
          : ap.servedAtLoss !== null
            ? `${name} gets a new connection at this instant: ${memberName(ap.sessionsOn)} went down with its sessions while ${memberName(ap.servedAtLoss)} was already publishing the service, so the outage is the connect string's own.`
            : `${name} gets a new connection at this instant: the connect string's own waits, on top of the role change.`,
        basis: 'model',
      }
      : {
        ...base, tone: 'rd', k: eyebrow,
        v: ap.noEventKind === 'app-down' ? 'down' : 'stays down',
        sub: ap.noEventKind === 'app-down'
          ? `${name} is down with its host, so nothing is dialled.`
          : `${name} exhausts its connect string${ap.gaveUp === null ? '' : ` at t = ${fmt(ap.gaveUp)} s`} without reaching the service.`,
        basis: 'model',
      });
  });
  const observerStates = Object.values(f.observers).map((o) => o.endState);
  if (observerStates.length > 0) {
    /* The master's, where there is one: every other running observer ends
       `backup` and a stopped one `stopped`, so the master is the one that
       ends in neither. */
    const master = observerStates.find((st) => st !== 'backup' && st !== 'stopped');
    chips.push({
      id: 'observer', tone: 'vi', k: 'Observer', v: master ?? (observerStates[0] as string),
      sub: observerStates.length === 1 ? 'The state the observer ends in.'
        : master !== undefined
          ? `${observerStates.length} observers deployed; the master's state is shown.`
          : `${observerStates.length} observers deployed, none of them the master at the end of the run.`,
    });
  }
  chips.push(findingsChip());
  return chips;
}
