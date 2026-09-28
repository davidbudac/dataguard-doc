/**
 * Configure -> Reopen: what happens after redo transport has already given up
 * on a destination. Ported from the published fragment's reopen panel (lines
 * 6649-7045) and scoped to one destination at a time, because REOPEN and
 * MAX_FAILURE are per-destination attributes.
 *
 * The primary is open the whole time here; only the destination is closed.
 * `REOPEN` gates eligibility and the log switch supplies the trigger -- redo
 * transport retries a failed destination at log switch time, once the last
 * error plus the interval is in the past -- so the ladder drawn at exact
 * multiples is an idealization, and says so. `MAX_FAILURE` counts consecutive
 * attempts, and the two editions count them differently (ED-04): 19c keeps
 * the 12.1 reading, where the initial error at t = 0 is not one of them, and
 * at the limit the destination is disabled with no further access until it
 * is manually reenabled; 26ai's usage notes count the initial failure too,
 * so MaxFailure = 1 disables it with no retry at all and no further attempt
 * to reactivate it is ever made. Either way the network healing does not
 * bring it back on its own.
 */

import { signal } from '@preact/signals';
import {
  authoredDests, BOUNDS, computeReopen, findMember, outageFromTrace, reopenInputFrom,
} from '@/engine';
import type { MemberId, ReopenModel, TopologyDoc } from '@/engine';
import type { BraceInput } from '@/ui/timeline/build';
import { primaryId, redoGraph, topology, trace } from '@/state/derived';
import { selection } from '@/state/view';
import { Chip } from '@/ui/common/Chip';
import type { ReadoutChip } from '@/state/derived';
import {
  Braces, braceRows, Figure, Frame, G3, Lanes, approxW, figHeight, fmt, makeScale, markLabel,
  signed, useFigWidth,
} from './figure';
import type { FigLane } from './figure';

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Panel-local view state: which destination, and an outage the reader picks. */
export const reopenDest = signal<string | null>(null);
export const reopenOutage = signal<number | null>(null);

/* ---------------- ported label helpers ---------------- */

/** Axis labels switch to minutes once the ticks are a minute apart. */
export const rpTickLabel = (t: number, step: number): string => {
  if (Math.abs(t) < 1e-9) return '0';
  return step >= 60 ? `${signed(t / 60)}m` : `${signed(t)}s`;
};

/** Compact duration for the drawing, where horizontal room is scarce. */
export const rpDur = (sec: number): string =>
  (sec < 60 ? `${fmt(sec)} s` : `${fmt(sec / 60)} min`);

export function rpOrd(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}

/**
 * What Oracle says happens to a disabled destination, per edition (ED-04):
 * 19c keeps the 12.1 wording, "no further access until it is manually
 * reenabled"; 26ai's usage notes say only that "no further attempts are
 * made to reactivate" it. Either way the network healing does not bring it
 * back on its own.
 */
const reactivationText = (rp: ReopenModel): string => (
  rp.edition === '26ai'
    ? 'no further attempts are made to reactivate it'
    : 'no further access until it is manually reenabled'
);

/* ---------------- the figure ---------------- */

function lanesOf(rp: ReopenModel, destName: string, t0: number, t1: number): FigLane[] {
  const disabled = rp.disabledAt !== null;
  const back = rp.reconnectAt;
  const closeEnd = back !== null ? back : t1;

  const lanes: FigLane[] = [
    { name: 'Primary transport', sub: `to ${destName}`, segs: [] },
    { name: 'Unshipped redo', sub: 'the gap on the primary', segs: [] },
    { name: destName, mono: true, sub: 'apply of received redo', segs: [] },
  ];

  lanes[0]?.segs.push({
    a: t0, b: 0, cls: 'b-tl', ink: 'f-tl',
    labs: ['Shipping redo to the destination', 'Shipping redo', 'Shipping'],
  });
  if (disabled && rp.disabledAt !== null) {
    lanes[0]?.segs.push(
      {
        a: 0, b: rp.disabledAt, cls: 'b-hatch', ink: 'f-rd',
        labs: ['Destination closed -- retried once per ReopenSecs', 'Destination closed', 'Closed'],
      },
      {
        a: rp.disabledAt, b: t1, cls: 'b-hatch', ink: 'f-rd',
        labs: [
          `Destination disabled -- ${reactivationText(rp)}`,
          'Destination disabled', 'Disabled',
        ],
      },
    );
  } else {
    lanes[0]?.segs.push({
      a: 0, b: closeEnd, cls: 'b-hatch', ink: 'f-rd',
      labs: ['Destination closed -- retried once per ReopenSecs', 'Destination closed', 'Closed'],
    });
    if (back !== null && rp.resyncAt !== null) {
      lanes[0]?.segs.push(
        {
          a: back, b: rp.resyncAt, cls: 'b-tl', ink: 'f-tl',
          labs: ['Shipping again -- and resolving the gap', 'Shipping + gap resolution', 'Shipping'],
        },
        {
          a: rp.resyncAt, b: t1, cls: 'b-tl', ink: 'f-tl',
          labs: ['Shipping redo -- back in step', 'Back in step', 'Shipping'],
        },
      );
    }
  }

  lanes[2]?.segs.push(
    { a: t0, b: 0, cls: 'b-bl', ink: 'f-bl', labs: ['Applying redo', 'Applying'] },
    {
      a: 0, b: closeEnd, cls: 'b-sl', ink: 'f-sl',
      labs: ['Idle -- nothing is arriving', 'Idle -- nothing arriving', 'Idle'],
    },
  );
  if (back !== null && rp.resyncAt !== null) {
    lanes[2]?.segs.push(
      {
        a: back, b: rp.resyncAt, cls: 'b-am', ink: 'f-am',
        labs: ['Gap resolution -- applying the backlog', 'Gap resolution', 'Catching up'],
      },
      {
        a: rp.resyncAt, b: t1, cls: 'b-bl', ink: 'f-bl',
        labs: ['Applying redo -- in step with the primary again', 'Applying redo', 'Applying'],
      },
    );
  }
  return lanes;
}

function bracesOf(rp: ReopenModel): BraceInput[] {
  const braces: BraceInput[] = [{
    key: 'reopen', a: 0, b: rp.reopen, tone: 'br-am', mono: true, name: 'ReopenSecs',
    val: `${fmt(rp.reopen)} s -- the earliest the destination is eligible again`,
  }];
  if (rp.disabledAt !== null) {
    /* The retries actually drawn before disabling, not the raw MaxFailure
       value: under 26ai the initial failure counts, so MaxFailure = n draws
       n - 1 of them (rp.failedRetries carries the edition-correct count). */
    braces.push({
      key: 'maxfailure', a: 0, b: rp.disabledAt, tone: 'br-rd', mono: true,
      name: rp.edition === '26ai' ? 'retries before MaxFailure × ReopenSecs' : 'MaxFailure × ReopenSecs',
      val: `${rp.failedRetries} × ${fmt(rp.reopen)} s = ${fmt(rp.disabledAt)} s to the last attempt`,
    });
  } else if (rp.reconnectAt !== null && rp.resyncAt !== null && rp.catchupSecs !== null) {
    braces.push({
      key: 'gap', a: rp.reconnectAt, b: rp.resyncAt, tone: 'br-bl', mono: false,
      name: 'Gap resolution',
      val: `${fmt(rp.catchupSecs)} s -- illustrative, drawn at 5× the generation rate`,
    });
  }
  if (rp.lagStallAt !== null && rp.lagStallMax !== null) {
    braces.push({
      key: 'lagstall', a: rp.lagStallAt, b: rp.lagStallAt + rp.lagStallMax, tone: 'br-rd', mono: true,
      name: 'FastStartFailoverThreshold',
      val: `≤ ${fmt(rp.lagStallMax)} s -- the primary waits for permission to enter LAGGING`,
    });
  } else if (rp.lagGraceArmed) {
    braces.push({
      key: 'lagrace', a: Math.max(0, rp.fsfoLostAt - rp.lagGraceTime), b: rp.fsfoLostAt,
      tone: 'br-am', mono: true, name: 'FastStartFailoverLagGraceTime',
      val: `${fmt(rp.lagGraceTime)} s -- permission asked for this early, so the crossing costs nothing`,
    });
  }
  return braces;
}

function ReopenFigure({ rp, destName, fsfoOn, width }: {
  rp: ReopenModel; destName: string; fsfoOn: boolean; width: number;
}) {
  const g = G3;
  const t0 = -rp.preRoll;
  const t1 = rp.horizon;
  const scale = makeScale(t0, t1, g, width);
  const pps = scale.pxPerSecond;
  const disabled = rp.disabledAt !== null;
  const back = rp.reconnectAt;

  const lanes = lanesOf(rp, destName, t0, t1);
  const braces = bracesOf(rp);
  const height = figHeight(g, braceRows(braces, scale, width, g));

  /* the gap area: grows one second per second while the destination is
     closed, drains during gap resolution, and never stops when it is disabled */
  const aTop = (g.lane[1] ?? 0) + 6;
  const aBot = (g.lane[1] ?? 0) + g.laneH - 6;
  const aH = aBot - aTop;
  const peak = rp.peakExposureSecs || 1;
  const AY = (v: number): number => aBot - Math.max(0, Math.min(1, v / peak)) * aH;

  /* failed retries, as ticks on the transport lane or one aggregated run */
  const fails: number[] = [];
  for (let i = 1; i < rp.attempts.length; i++) {
    const a = rp.attempts[i];
    if (a && !a.ok && a.t !== rp.disabledAt) fails.push(a.t);
  }
  const cy0 = (g.lane[0] ?? 0) + g.laneH - 10;
  const aggregate = rp.dense || (fails.length > 1 && rp.reopen * pps < 16);

  const xz = scale.x(0);
  const gapA1 = (g.lane[0] ?? 0) + g.laneH + 14;
  const gapA2 = gapA1 + 15;
  const gapB1 = (g.lane[1] ?? 0) + g.laneH + 14;
  const gapB2 = gapB1 + 15;

  const backLab = back === null ? '' : [
    `Redo flows again at t = ${rpDur(back)} -- the first retry at or after the network healed`,
    `Redo flows again at t = ${rpDur(back)}`,
    'Redo flows again',
  ].find((c) => scale.x(back) + 9 + approxW(c, 11.5) <= scale.plotR) ?? 'Redo flows again';
  const disLab = rp.disabledAt === null ? '' : [
    `MaxFailure reached at t = ${rpDur(rp.disabledAt)} -- destination disabled, ${reactivationText(rp)}`,
    `MaxFailure reached -- disabled, ${reactivationText(rp)}`,
    'MaxFailure reached',
  ].find((c) => scale.x(rp.disabledAt ?? 0) + 9 + approxW(c, 11.5) <= scale.plotR) ?? 'MaxFailure reached';

  const fsfoLab = `Apply lag passes FastStartFailoverLagLimit at t = ${fmt(rp.fsfoLostAt)} s -- fast-start failover no longer permitted`;
  const fsfoPos = markLabel(scale.x(rp.fsfoLostAt), scale, fsfoLab);
  const backPos = markLabel(scale.x(rp.fsfoBackAt ?? 0), scale, 'FSFO re-armed -- once the destination is back in sync');

  const topLab = back !== null && rp.resyncAt !== null
    ? `Redo stops flowing for ${rpDur(back)} -- back in step at ${rpDur(rp.resyncAt)}`
    : `Redo never resumes on its own -- the destination is disabled at ${rpDur(rp.disabledAt ?? 0)} and stays that way, ${reactivationText(rp)}`;
  const topW = approxW(topLab, 12);

  const summary = `Reopen panel: the destination was closed at t = 0 and retried every ${fmt(rp.reopen)} seconds. `
    + (rp.reconnectAt !== null && rp.resyncAt !== null
      ? `Redo flowed again at ${fmt(rp.reconnectAt)} seconds after ${rp.failedRetries} failed retries, and it was back in step at ${fmt(rp.resyncAt)} seconds.`
      : `MaxFailure was reached at ${fmt(rp.disabledAt ?? 0)} seconds and the destination was disabled: ${reactivationText(rp)}; redo never resumes.`)
    + ` Peak unshipped redo ${fmt(rp.peakExposureSecs)} seconds, about ${fmt(rp.peakExposureMB)} megabytes.`;

  return (
    <Figure
      width={width} height={height}
      eyebrow={`t = 0 is the error that closed the destination · horizon ${fmt(rp.horizon / 60)} min`}
      summaryId="rp-summary" summary={summary}
    >
      <Frame
        g={g} scale={scale} step={rp.tickStep}
        unit={rp.tickStep >= 60
          ? 'minutes from the error that closed the destination'
          : 'seconds from the error that closed the destination'}
        preLabel="Shipping normally"
        tickLabel={(t) => rpTickLabel(t, rp.tickStep)}
      />
      <Lanes lanes={lanes} g={g} scale={scale} />

      {/* the gap */}
      {disabled && rp.disabledAt !== null ? (
        <>
          <path
            class="area-am"
            d={`M${r1(xz)},${r1(aBot)} L${r1(scale.x(rp.disabledAt))},${r1(AY(rp.disabledAt))} L${r1(scale.x(rp.disabledAt))},${r1(aBot)} Z`}
          >
            <title>The gap grows one second per second while the destination is closed</title>
          </path>
          <path
            class="area-rd"
            d={`M${r1(scale.x(rp.disabledAt))},${r1(AY(rp.disabledAt))} L${r1(scale.plotR)},${r1(aTop)} L${r1(scale.plotR)},${r1(aBot)} L${r1(scale.x(rp.disabledAt))},${r1(aBot)} Z`}
          >
            <title>
              {`Past the disable nothing stops it: the gap keeps growing -- ${reactivationText(rp)}`}
            </title>
          </path>
        </>
      ) : back !== null && rp.resyncAt !== null ? (
        <path
          class="area-am"
          d={`M${r1(xz)},${r1(aBot)} L${r1(scale.x(back))},${r1(aTop)} L${r1(Math.min(scale.plotR, scale.x(rp.resyncAt)))},${r1(aBot)} Z`}
        >
          <title>The gap grows while the destination is closed, then drains once redo flows again</title>
        </path>
      ) : null}
      <text class="t-bar f-am" x={r1(xz + 8)} y={r1(aTop + 13)}>
        {disabled
          ? `Still growing at ${fmt(rp.peakExposureSecs)} s of redo ≈ ${fmt(rp.peakExposureMB)} MB`
          : `Peak ${fmt(rp.peakExposureSecs)} s of redo ≈ ${fmt(rp.peakExposureMB)} MB`}
      </text>

      {/* failed retries */}
      {aggregate && fails.length > 1 ? (
        <>
          <line class="m-am" x1={r1(scale.x(fails[0] ?? 0))} y1={cy0} x2={r1(Math.min(scale.plotR - 1, scale.x(fails[fails.length - 1] ?? 0)))} y2={cy0} stroke-width="1.5" />
          <line class="m-am" x1={r1(scale.x(fails[0] ?? 0))} y1={cy0 - 4} x2={r1(scale.x(fails[0] ?? 0))} y2={cy0 + 4} stroke-width="1.5" />
          <line class="m-am" x1={r1(Math.min(scale.plotR - 1, scale.x(fails[fails.length - 1] ?? 0)))} y1={cy0 - 4} x2={r1(Math.min(scale.plotR - 1, scale.x(fails[fails.length - 1] ?? 0)))} y2={cy0 + 4} stroke-width="1.5" />
        </>
      ) : fails.map((ft) => {
        const fx = scale.x(ft);
        if (fx > scale.plotR - 2) return null;
        return (
          <g key={`f${ft}`}>
            <line class="m-am" x1={r1(fx - 3.5)} y1={cy0 - 3.5} x2={r1(fx + 3.5)} y2={cy0 + 3.5} stroke-width="1.6" />
            <line class="m-am" x1={r1(fx + 3.5)} y1={cy0 - 3.5} x2={r1(fx - 3.5)} y2={cy0 + 3.5} stroke-width="1.6" />
          </g>
        );
      })}
      <text class="t-mark f-am" x={r1(scale.plotL + 6)} y={gapA1}>
        {rp.failedRetries === 0
          ? 'The first retry already succeeds -- the network healed inside one ReopenSecs'
          : `${rp.failedRetries} failed ${rp.failedRetries === 1 ? 'retry' : 'retries'} -- one every ${fmt(rp.reopen)} s, each at the next log switch`}
      </text>

      {/* t = 0: the error that closed the destination */}
      <line class="m-rd" x1={r1(xz)} y1={g.laneTop - 4} x2={r1(xz)} y2={g.lanesBottom + 4} stroke-width="1.5" stroke-dasharray="5 4" />
      <line class="m-rd" x1={r1(xz - 6)} y1={(g.lane[0] ?? 0) + 11} x2={r1(xz + 6)} y2={(g.lane[0] ?? 0) + 23} stroke-width="2.4" />
      <line class="m-rd" x1={r1(xz + 6)} y1={(g.lane[0] ?? 0) + 11} x2={r1(xz - 6)} y2={(g.lane[0] ?? 0) + 23} stroke-width="2.4" />
      <text class="t-mark f-rd" x={r1(xz + 9)} y={g.markY}>Error logged -- destination closed</text>

      {/* redo flowing again, or the destination disabled for good */}
      {back !== null ? (
        <>
          <line class="m-tl" x1={r1(scale.x(back))} y1={(g.lane[0] ?? 0) + 2} x2={r1(scale.x(back))} y2={g.lanesBottom + 4} stroke-width="1.5" stroke-dasharray="5 4" />
          <text
            class="t-mark f-tl"
            x={r1(markLabel(scale.x(back), scale, backLab).x)} y={gapA2}
            text-anchor={markLabel(scale.x(back), scale, backLab).anchor}
          >
            {backLab}
          </text>
        </>
      ) : rp.disabledAt !== null ? (
        <>
          <line class="m-rd" x1={r1(scale.x(rp.disabledAt))} y1={(g.lane[0] ?? 0) + 2} x2={r1(scale.x(rp.disabledAt))} y2={g.lanesBottom + 4} stroke-width="2" />
          <line class="m-rd" x1={r1(scale.x(rp.disabledAt) - 6)} y1={(g.lane[0] ?? 0) + g.laneH / 2 - 6} x2={r1(scale.x(rp.disabledAt) + 6)} y2={(g.lane[0] ?? 0) + g.laneH / 2 + 6} stroke-width="2.6" />
          <line class="m-rd" x1={r1(scale.x(rp.disabledAt) + 6)} y1={(g.lane[0] ?? 0) + g.laneH / 2 - 6} x2={r1(scale.x(rp.disabledAt) - 6)} y2={(g.lane[0] ?? 0) + g.laneH / 2 + 6} stroke-width="2.6" />
          <text
            class="t-mark f-rd"
            x={r1(markLabel(scale.x(rp.disabledAt), scale, disLab).x)} y={gapA2}
            text-anchor={markLabel(scale.x(rp.disabledAt), scale, disLab).anchor}
          >
            {disLab}
          </text>
        </>
      ) : null}

      {/* fast-start failover, between the redo lane and the destination */}
      {!fsfoOn ? (
        <text class="t-mark f-sl" x={r1(scale.plotL + 8)} y={gapB1}>
          No observer is deployed -- fast-start failover is not enabled, so this outage disarms nothing
        </text>
      ) : rp.lagGated ? (
        <>
          <line class="g-vi" x1={r1(scale.x(rp.fsfoLostAt))} y1={(g.lane[1] ?? 0) - 6} x2={r1(scale.x(rp.fsfoLostAt))} y2={(g.lane[2] ?? 0) + g.laneH + 4} />
          <path class="f-vi" d={`M${r1(scale.x(rp.fsfoLostAt))},${(g.lane[1] ?? 0) + g.laneH + 1} l5,5 l-5,5 l-5,-5 z`} />
          <text class="t-mark f-vi" x={r1(fsfoPos.x)} y={gapB1} text-anchor={fsfoPos.anchor}>{fsfoLab}</text>
        </>
      ) : (
        <>
          <line class="g-rd" x1={r1(xz)} y1={(g.lane[1] ?? 0) - 6} x2={r1(xz)} y2={(g.lane[2] ?? 0) + g.laneH + 4} />
          <text class="t-mark f-rd" x={r1(xz + 9)} y={gapB1}>
            UNSYNCHRONIZED -- fast-start failover disarmed immediately
          </text>
        </>
      )}
      {fsfoOn && rp.fsfoBackAt !== null && scale.x(rp.fsfoBackAt) <= scale.plotR - 2 ? (
        <>
          <path class="f-vi" d={`M${r1(scale.x(rp.fsfoBackAt))},${gapB2 - 9} l5,5 l-5,5 l-5,-5 z`} />
          <text class="t-mark f-vi" x={r1(backPos.x)} y={gapB2} text-anchor={backPos.anchor}>
            FSFO re-armed -- once the destination is back in sync
          </text>
        </>
      ) : null}

      {/* top annotation */}
      {back !== null ? (
        <text
          class="t-top"
          x={r1(Math.min(Math.max((xz + scale.x(back)) / 2, topW / 2 + 6), width - topW / 2 - 6))}
          y={g.topY} text-anchor="middle"
        >
          {topLab}
        </text>
      ) : (
        <text class="t-top f-rd" x={r1(scale.plotL)} y={g.topY}>{topLab}</text>
      )}

      <Braces braces={braces} scale={scale} width={width} g={g} />
    </Figure>
  );
}

/* ---------------- the readout ---------------- */

function chipsFor(rp: ReopenModel, fsfoOn: boolean): ReadoutChip[] {
  const chips: ReadoutChip[] = [
    {
      id: 'first', tone: 'am', k: 'First retry at', v: fmt(rp.reopen), unit: 's',
      sub: 'One ReopenSecs after the error, at the next log switch',
      basis: rp.claims.retries.basis,
    },
    rp.reconnectAt !== null
      ? {
        id: 'back', tone: 'tl', k: 'Redo flows again', v: fmt(rp.reconnectAt), unit: 's',
        sub: `Retry ${rp.attempts.length - 1} -- the first one at or after the network healed at ${fmt(rp.outage)} s`,
      }
      : {
        id: 'back', tone: 'rd', k: 'Redo flows again', v: 'never',
        sub: `The destination was disabled at ${fmt(rp.disabledAt ?? 0)} s -- ${reactivationText(rp)}, and the network healing at ${fmt(rp.outage)} s changes nothing`,
      },
    {
      id: 'fails', tone: rp.disabledAt !== null ? 'rd' : 'ik', k: 'Failed retries',
      v: fmt(rp.failedRetries),
      unit: rp.retryLimit !== null ? `of ${fmt(rp.retryLimit)}` : 'of no limit',
      sub: rp.edition === '26ai'
        ? `Plus the initial error at t = 0 that closed the destination: ${rp.failures} logged ${rp.failures === 1 ? 'error' : 'errors'} in all. Under 26ai MAX_FAILURE counts that initial failure too, so MaxFailure = ${fmt(rp.maxFailure)} allows ${fmt(rp.retryLimit ?? 0)} of these retries.`
        : `Plus the initial error at t = 0 that closed the destination: ${rp.failures} logged ${rp.failures === 1 ? 'error' : 'errors'} in all. MAX_FAILURE counts only the attempts to reestablish.`,
    },
    {
      id: 'peak', tone: 'am', k: 'Peak unshipped redo', v: fmt(rp.peakExposureSecs), unit: 's of redo',
      sub: rp.reconnectAt !== null && rp.resyncAt !== null
        ? `≈ ${fmt(rp.peakExposureMB)} MB at ${fmt(rp.rate)} MB/s, drained by ${fmt(rp.resyncAt)} s`
        : `≈ ${fmt(rp.peakExposureMB)} MB at ${fmt(rp.rate)} MB/s -- and still growing past the right edge`,
      basis: rp.claims.catchup.basis,
    },
    !fsfoOn
      ? {
        id: 'fsfo', tone: 'vi', k: 'Fast-start failover', v: 'not enabled',
        sub: 'No observer is deployed in this topology, so this outage disarms nothing -- only a manual FAILOVER TO could move the role, before it or after it',
      }
      : rp.lagGated
        ? {
          id: 'fsfo', tone: 'vi', k: 'Fast-start failover', v: fmt(rp.fsfoLostAt), unit: 's to disarmed',
          sub: rp.fsfoBackAt !== null
            ? `The apply lag passes FastStartFailoverLagLimit while nothing arrives; re-armed around ${fmt(rp.fsfoBackAt)} s`
            : 'The apply lag passes FastStartFailoverLagLimit while nothing arrives; never re-armed here',
          basis: rp.claims.lagGate.basis,
        }
        : {
          id: 'fsfo', tone: 'vi', k: 'Fast-start failover', v: 'disarmed',
          sub: rp.fsfoBackAt !== null
            ? `The standby is UNSYNCHRONIZED the moment the link breaks -- re-armed around ${fmt(rp.fsfoBackAt)} s, once it is back in sync`
            : 'The standby is UNSYNCHRONIZED the moment the link breaks, and stays that way',
          basis: rp.claims.lagGate.basis,
        },
  ];
  if (rp.lagStallAt !== null && rp.lagStallMax !== null) {
    chips.push({
      id: 'stall', tone: 'rd', k: 'Primary pauses at the crossing', v: `≤ ${fmt(rp.lagStallMax)}`, unit: 's',
      sub: 'FastStartFailoverLagGraceTime is 0, so the primary asks permission to enter LAGGING at the crossing and waits for the answer -- at most one FastStartFailoverThreshold',
    });
  } else if (rp.lagGraceArmed) {
    chips.push({
      id: 'stall', tone: 'tl', k: 'Primary pauses at the crossing', v: '0',
      sub: `FastStartFailoverLagGraceTime = ${fmt(rp.lagGraceTime)} s: permission was asked for that far ahead of the limit and is already granted when the lag crosses it`,
    });
  }
  return chips;
}

/* ---------------- prose ---------------- */

function caption(rp: ReopenModel, fsfoOn: boolean): string {
  const over = rp.reconnectAt === null ? 0 : rp.reconnectAt - rp.outage;
  const body = rp.disabledAt !== null
    ? rp.failedRetries === 0
      /* 26ai, MaxFailure = 1: the initial failure counts, so nothing is
         retried at all before the destination is disabled. */
      ? `The destination failed once at t = 0, and MaxFailure = 1 disabled it immediately -- no retry was ever attempted. The gap never stops growing on this drawing, because nothing on the primary will try that destination again.`
      : `The destination was retried ${rp.failedRetries} ${rp.failedRetries === 1 ? 'time' : 'times'}, every ${fmt(rp.reopen)} s, and the ${rpOrd(rp.failedRetries)} retry at ${fmt(rp.disabledAt)} s disabled it for good. The gap never stops growing on this drawing, because nothing on the primary will try that destination again.`
    : rp.failedRetries === 0
      ? `The network healed at ${fmt(rp.outage)} s, inside the first ReopenSecs, so the very first retry at ${fmt(rp.reopen)} s succeeded and MaxFailure never counted anything. Even so the destination stayed closed for a full ${fmt(rp.reopen)} s, which is the floor ReopenSecs imposes.`
      : over > 0
        ? `The network healed at ${fmt(rp.outage)} s, but the destination is only retried every ${fmt(rp.reopen)} s, so ${rp.failedRetries} of those attempts landed while the link was still down and it stayed closed for another ${fmt(over)} s after the network was already fine. The backlog of ${fmt(rp.peakExposureSecs)} s of redo then takes until ${fmt(rp.resyncAt ?? 0)} s to drain.`
        : `The network healed at ${fmt(rp.outage)} s, but the destination is only retried every ${fmt(rp.reopen)} s, so ${rp.failedRetries} of those attempts landed while the link was still down, and the next one landed exactly as the link came back. The backlog of ${fmt(rp.peakExposureSecs)} s of redo then takes until ${fmt(rp.resyncAt ?? 0)} s to drain.`;

  let fsfoLine = !fsfoOn
    ? 'Fast-start failover is not enabled in this topology, so the outage disarms nothing: no observer is deployed for it to disarm.'
    : rp.lagGated
      ? `Fast-start failover survives until ${fmt(rp.fsfoLostAt)} s, when the apply lag passes FastStartFailoverLagLimit.`
      : 'Fast-start failover is disarmed from the first second: the standby is UNSYNCHRONIZED as soon as the link breaks.';
  if (rp.lagStallAt !== null) {
    fsfoLine += ' The crossing itself costs the primary a pause of up to one FastStartFailoverThreshold, because that is where it asks permission -- of the observer or the target standby -- to enter LAGGING; set FastStartFailoverLagGraceTime and it asks early instead.';
  } else if (rp.lagGraceArmed) {
    fsfoLine += ` The crossing costs the primary nothing: permission to enter LAGGING was granted ${fmt(rp.lagGraceTime)} s before the limit was reached.`;
  }
  return `${body} ${fsfoLine}`;
}

/* ---------------- the panel ---------------- */

/** The primary's direct destinations -- the members REOPEN can be read for. */
function destinations(doc: TopologyDoc, primary: MemberId | null): MemberId[] {
  const graph = redoGraph.value;
  if (primary === null || !graph) return [];
  const out: MemberId[] = [];
  for (const e of graph.edges) if (e.from === primary && !out.includes(e.to)) out.push(e.to);
  return out;
}

export function Reopen() {
  const doc = topology.value;
  const [ref, width] = useFigWidth();
  const primary = primaryId.value;
  const dests = destinations(doc, primary);
  const selected = selection.value.find((s) => dests.includes(s as MemberId));
  const chosen = (dests.find((d) => (d as string) === reopenDest.value)
    ?? (selected as MemberId | undefined) ?? dests[0]) ?? null;
  const t = trace.value;

  if (primary === null || chosen === null) {
    return (
      <div class="panel" role="region" aria-label="Reopen">
        <div class="panel-body">
          <div class="empty">
            <span class="empty-k">No destination</span>
            <p>
              REOPEN and MAX_FAILURE are attributes of a destination, and the primary has none
              in this configuration -- there is nothing for redo transport to give up on.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const fsfoOn = doc.config.fsfo.state !== 'disabled' && doc.observers.length > 0;
  const fromTrace = t === null ? null : outageFromTrace(t, chosen);
  const outage = reopenOutage.value ?? fromTrace ?? BOUNDS.outageSeconds.default;
  /* Whether the destination is written inside a parenthesised RedoRoutes
     group -- read off the engine's own routing resolution (authoredDests),
     never recomputed here. It decides both MaxFailure's broker default (1
     in a group, 0 otherwise) and the documented re-enter-when-accessible
     exception (ED-04). */
  const inPriorityGroup = authoredDests(doc, primary)
    .find((d) => d.to === chosen)?.inPriorityGroup ?? false;
  const input = reopenInputFrom(doc, primary, chosen, {
    ...(t === null ? {} : { trace: t }),
    outageSeconds: outage,
    inPriorityGroup,
  });
  const rp = computeReopen(input);
  const destName = findMember(doc, chosen)?.name ?? String(chosen);
  const bounds = BOUNDS.outageSeconds;

  return (
    <div class="panel" role="region" aria-label="Reopen">
      <div class="panel-hd">
        <div class="row">
          <span class="eyebrow grow">After transport gives up · {destName}</span>
          {dests.length < 2 ? null : (
            <div class="seg" role="group" aria-label="Destination">
              {dests.map((d) => (
                <button
                  key={String(d)} type="button" aria-pressed={d === chosen}
                  onClick={() => { reopenDest.value = d as string; }}
                >
                  {findMember(doc, d)?.name ?? String(d)}
                </button>
              ))}
            </div>
          )}
        </div>
        <p class="caption">{caption(rp, fsfoOn)}</p>
      </div>
      <div class="panel-body" ref={ref}>
        <div class="panel-ctl">
          <label for="rp-outage">
            How long the network stays broken
            <input
              id="rp-outage" type="range"
              min={Math.min(bounds.min, Math.floor(outage))} max={Math.max(bounds.max, Math.ceil(outage))}
              step={bounds.step}
              value={outage}
              onInput={(e) => { reopenOutage.value = Number((e.target as HTMLInputElement).value); }}
            />
            <span class="v">{fmt(outage / 60)} min</span>
          </label>
          {fromTrace === null ? null : (
            <button type="button" class="btn" onClick={() => { reopenOutage.value = null; }}>
              Take it from the run
            </button>
          )}
          <span class="caption">
            {fromTrace === null
              ? 'Not a parameter -- how long the destination is unreachable. ReopenSecs and MaxFailure are properties of the destination and are edited in the Inspector.'
              : `The run has this destination out for ${fmt(fromTrace)} s; the slider draws another outage without changing the document.`}
          </span>
        </div>
        <div class="chips">
          {chipsFor(rp, fsfoOn).map((c) => <Chip key={c.id} chip={c} />)}
        </div>
        <ReopenFigure rp={rp} destName={destName} fsfoOn={fsfoOn} width={width} />
      </div>
    </div>
  );
}
