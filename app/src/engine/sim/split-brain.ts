/**
 * Split brain, read off a finished trace: were two members open read-write at
 * the same moment?
 *
 * Oracle's broker documentation never uses the term and states no interval for
 * it, so this is not a documented figure -- it is a question put to this
 * page's own drawing. The drawing's lanes say, for every member and every
 * instant, whether it is `open-rw`; two lanes in that state over a stretch of
 * time with a length is a split brain, and nothing else is.
 *
 * What the reading leaves out on purpose:
 *
 *  - A STALLED primary. It is up and it is running, but Oracle's own sentence
 *    is that "redo generation on the primary database will be stalled", so it
 *    commits nothing the new primary will not have. A stall that outlives the
 *    new primary's open is reported as such (`FormerAtOpen`), not as a split.
 *  - A switchover. The old primary is converted before the new one opens, by
 *    construction; the reading is asked only of a failover, which is where the
 *    old primary is not told anything.
 *
 * The lanes' `open-rw` for a former primary is itself this page's reading
 * (`FAILOVER.FORMER_PRIMARY_MOUNTED` in simulate.ts): one that fast-start
 * failover armed, or that the new primary can reach, is drawn mounted, and one
 * that nothing can tell is drawn open. That is why the claim is a `model`.
 */

import type { MemberId, Seconds } from '../ids';
import type { Claim } from '../types/claims';
import { model } from '../types/claims';
import type { Lane, Trace } from '../types/trace';
import { EPS } from './kernel';

/** A stretch in which two members were open read-write together. */
export interface SplitBrainWindow {
  from: Seconds;
  /** null: the stretch runs to the end of the run, which nothing in it closes. */
  to: Seconds | null;
  /** The two that were open, the new primary first. */
  members: [MemberId, MemberId];
}

/**
 * What the primary the failover left behind was doing the instant the new one
 * opened. Only read where the answer is no -- where it is yes, the window
 * says it.
 */
export type FormerAtOpen =
  /** Its host or its data centre is down. */
  | { kind: 'down' }
  /** It shut itself down before the new primary opened, at `at`. */
  | { kind: 'aborted'; at: Seconds }
  /** Up and STALLED when the new primary opened; `abortsAt` is when it shuts itself down, null if nothing does. */
  | { kind: 'stalled'; abortsAt: Seconds | null }
  /** Running, but mounted or otherwise not open read-write: it needs reinstating. */
  | { kind: 'closed'; state: string };

export interface SplitBrain {
  /** yes or no, and what the answer rests on. */
  split: Claim<boolean>;
  /** The database the failover opened, and the instant it opened. */
  newPrimary: MemberId;
  openAt: Seconds;
  /** The primary the run started with, the one the failover left behind. */
  former: MemberId;
  /** Where the answer is yes: the stretches, in time order. Empty otherwise. */
  windows: SplitBrainWindow[];
  /** Where the answer is no: the former primary at the instant the new one opened. */
  formerAtOpen: FormerAtOpen | null;
}

const NOTE =
  'SPLIT_BRAIN.READING: Oracle does not use the term and gives no interval for it, so this is read off the drawing: two databases open read-write at the same moment. A former primary that is running and that the new primary cannot reach is drawn open (FAILOVER.FORMER_PRIMARY_MOUNTED is this page\'s reading of what such a database is told); one that fast-start failover armed, or that the new primary can reach, is drawn mounted. A STALLED primary is not counted as open: Oracle says its redo generation is stalled. The abort one FastStartFailoverThreshold after a stall began is documented; when a manual failover opens the new primary is this page\'s model.';

const segmentsOf = (lanes: readonly Lane[], id: MemberId): Lane['segments'] =>
  lanes.find((l) => l.subject.kind === 'member' && l.subject.id === id)?.segments ?? [];

/** The stretches of `id`'s lane in `state`, as [from, to) with null for the end of the run. */
function stretches(lanes: readonly Lane[], id: MemberId, state: string): [Seconds, Seconds | null][] {
  return segmentsOf(lanes, id)
    .filter((s) => s.state === state)
    .map((s) => [s.t0, s.t1] as [Seconds, Seconds | null]);
}

/** A segment's end as a number: the end of the run is infinitely far. */
const ends = (t1: Seconds | null): number => (t1 === null ? Infinity : t1);

/**
 * The reading for a trace, or null where the question does not arise: a run in
 * which no new primary opens (nothing moved, the failover was refused, or an
 * operator is left to act), and a switchover.
 */
export function splitBrainOf(trace: Trace): SplitBrain | null {
  const f = trace.facts;
  if (f.blocked || f.newPrimary === null || f.tOpen === null) return null;
  if (f.outcome !== 'failover' && f.outcome !== 'manual') return null;
  const first = trace.epochs[0];
  if (!first) return null;
  const newPrimary = f.newPrimary;
  const former = first.primary;
  if (former === newPrimary) return null;

  /* Every other member's open stretches against the new primary's, in order. */
  const mine = stretches(trace.lanes, newPrimary, 'open-rw');
  const windows: SplitBrainWindow[] = [];
  for (const lane of trace.lanes) {
    if (lane.subject.kind !== 'member' || lane.subject.id === newPrimary) continue;
    const other = lane.subject.id as MemberId;
    for (const [a0, a1] of mine) {
      for (const [b0, b1] of stretches(trace.lanes, other, 'open-rw')) {
        const from = Math.max(a0, b0);
        const to = Math.min(ends(a1), ends(b1));
        if (to - from <= EPS) continue;
        windows.push({ from, to: Number.isFinite(to) ? to : null, members: [newPrimary, other] });
      }
    }
  }
  windows.sort((x, y) => x.from - y.from);

  const split = model(windows.length > 0, NOTE,
    ['FSFO.GUARANTEE_STALL', 'FSFO.PMY_SHUTDOWN', 'FAILOVER.PRIMARY_SHUT_DOWN']);
  if (windows.length > 0) {
    return { split, newPrimary, openAt: f.tOpen, former, windows, formerAtOpen: null };
  }
  return { split, newPrimary, openAt: f.tOpen, former, windows, formerAtOpen: formerAt(trace, former, f.tOpen) };
}

function formerAt(trace: Trace, former: MemberId, at: Seconds): FormerAtOpen {
  const segs = segmentsOf(trace.lanes, former);
  const i = segs.findIndex((s) => s.t0 <= at + EPS && at < ends(s.t1) - EPS);
  const seg = segs[i];
  if (!seg) return { kind: 'down' };
  switch (seg.state) {
    case 'down':
    case 'unreachable':
      return { kind: 'down' };
    case 'aborted':
      /* The instant it first went, which can be well before the new primary opened. */
      return { kind: 'aborted', at: segs.find((s) => s.state === 'aborted')?.t0 ?? seg.t0 };
    case 'stalled':
      return { kind: 'stalled', abortsAt: segs.slice(i).find((s) => s.state === 'aborted')?.t0 ?? null };
    default:
      return { kind: 'closed', state: seg.state };
  }
}
