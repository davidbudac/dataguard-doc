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
import type { Geometry } from '@/ui/canvas/layout';
import {
  declaredPrimary, resolveRedoGraph, simulate, sortFindings, stateAt, validate,
} from '@/engine';
import type {
  CitationId, Claim, EngineTrace, Finding, Outcome, ProtectionLevel, Snapshot, TopologyDoc,
} from '@/engine';
import { doc } from './doc';
import { edition, mode, tNow } from './view';

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
 * Where every card sits (ui.md SS2).
 *
 * The layout is pure and deterministic, so it belongs to the state rather than
 * to whoever is drawing at the moment: the canvas, the Configure strip and the
 * Learn workbench are three views of one drawing, and computing it here is
 * what stops them from being three drawings that agree by coincidence.
 */
export const geometry = computed<Geometry | null>(() => {
  const graph = redoGraph.value;
  if (graph === null) return null;
  return layoutTopology(topology.value, graph, { overrides: doc.value.layout });
});

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
  if (evts.length === 0) return null;
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

export const outcome = computed(() => trace.value?.facts.outcome ?? null);

export const protectionLevel = computed<Claim<ProtectionLevel> | null>(
  () => trace.value?.epochs.at(-1)?.protectionLevel ?? redoGraph.value?.protectionLevel ?? null,
);

/* ---------------- the readout ---------------- */

export type Tone = 'ik' | 'tl' | 'bl' | 'am' | 'rd' | 'vi' | 'sl';

export interface ReadoutChip {
  id: string;
  tone: Tone;
  /** The eyebrow. */
  k: string;
  /** The number or the word. */
  v: string;
  unit?: string;
  /** One sentence, branching on the outcome and never on the event name. */
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
 * The chips under the canvas. Two readings, and the code says which one it is
 * in: with no events injected the deployment has a steady state and no
 * outcome; with events it has an outcome, and every chip branches on that
 * outcome rather than on the name of the event that caused it.
 */
export const readout = computed<ReadoutChip[]>(() => {
  const t = trace.value;
  const topo = topology.value;
  const graph = redoGraph.value;

  /* Build and Configure are about the configuration, so their readout is the
     steady state even when the Document carries events (ui.md SS3): the
     outcome belongs to the modes that draw the run. */
  const steady = mode.value === 'build' || mode.value === 'configure';

  if (!t || steady) {
    const level = graph?.protectionLevel;
    const modeWord = topo.config.protectionMode;
    const members = topo.members.length;
    const standbys = topo.members.filter((m) => m.kind === 'database' && m.role !== 'primary').length;
    const farSyncs = topo.members.filter((m) => m.kind === 'farsync').length;
    const parts = [
      `${standbys} standby${standbys === 1 ? '' : 's'}`,
      ...(farSyncs > 0 ? [`${farSyncs} far sync`] : []),
      '1 primary',
    ];
    const chips: ReadoutChip[] = [
      {
        id: 'protection', tone: level && level.value !== modeWord ? 'am' : 'tl',
        k: 'Protection level',
        v: level ? level.value : 'unknown',
        /* The mode is what was configured; the level is what the broker
           reports. When the two differ the chip says so, because the reader
           who set MAXAVAILABILITY and reads MAXPERFORMANCE has been told
           something, not shown a typo. */
        sub: level && level.value !== modeWord
          ? `Configured ${modeWord}, but no synchronized standby is acknowledging, so the broker reports this level.`
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
        id: 'issues', tone: errors.value.length > 0 ? 'rd' : 'ik', k: 'Issues',
        v: String(issues.value.length),
        sub: issues.value.length === 0
          ? 'No issues in this configuration, as modelled here.'
          : `${errors.value.length} error${errors.value.length === 1 ? '' : 's'}, ${warnings.value.length} warning${warnings.value.length === 1 ? '' : 's'}.`,
      },
    ];
    return chips;
  }

  const f = t.facts;
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
      v: f.blocked ? 'blocked' : OUTCOME_WORD[f.outcome],
      sub: f.blocked
        ? 'The transition was ordered and then forbidden; nothing changed role.'
        : 'What the configuration did, not what was done to it.',
    },
  ];
  if (moved && f.tOpen !== null) {
    chips.push({
      id: 'open', tone: 'tl', k: 'New primary open', v: fmt(f.tOpen), unit: 's',
      sub: 'Measured from the first injected event.',
    });
  }
  if (f.abortAt !== null) {
    /* Two different shutdowns, and the chip never confuses them. A stalled
       primary aborts itself under FastStartFailoverPmyShutdown one threshold
       after the stall began; a maximum protection primary is shut down because
       no synchronized standby is acknowledging, and the instant it happens --
       the last acknowledgement plus NET_TIMEOUT -- is this page's model, not a
       documented interval and never a failover clock. */
    const maxprot = f.outcome === 'maxprot-shutdown';
    chips.push({
      id: 'abort', tone: 'rd',
      k: maxprot ? 'Primary shut down' : 'Primary aborts',
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
  const observerStates = Object.values(f.observers).map((o) => o.endState);
  if (observerStates.length > 0) {
    chips.push({
      id: 'observer', tone: 'vi', k: 'Observer', v: observerStates[0] as string,
      sub: observerStates.length > 1
        ? `${observerStates.length} observers deployed; the master's state is shown.`
        : 'The state the observer ends in.',
    });
  }
  chips.push({
    id: 'issues', tone: errors.value.length > 0 ? 'rd' : 'ik', k: 'Issues',
    v: String(issues.value.length),
    sub: issues.value.length === 0
      ? 'No issues in this configuration, as modelled here.'
      : `${errors.value.length} error${errors.value.length === 1 ? '' : 's'}, ${warnings.value.length} warning${warnings.value.length === 1 ? '' : 's'}.`,
  });
  return chips;
});
