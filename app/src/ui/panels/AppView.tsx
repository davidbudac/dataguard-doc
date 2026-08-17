/**
 * Configure -> Application view: the failure as the connect string sees it.
 *
 * Ported from the published fragment's three application builders (lines
 * 5303-5850) and generalised from two addresses to the descriptor's whole
 * ADDRESS_LIST: `computeApp` classifies every address from the trace at the
 * moment the client dials it, and the drawing below is that model, unchanged.
 *
 * Three things this panel keeps saying, because they are the point of it:
 * these parameters affect only NEW connections -- no established session is
 * touched by anything drawn here; the costs 0.2 s / 0.15 s / 0.3 s are nominal
 * drawing constants, never documented figures; and the drawing branches on the
 * outcome of the run, never on the name of the event that caused it.
 */

import type { AppModel, EngineTrace, TopologyDoc } from '@/engine';
import { computeApp } from '@/engine';
import type { BraceInput, TimelineScale } from '@/ui/timeline/build';
import { topology, trace } from '@/state/derived';
import {
  Braces, braceRows, Figure, Frame, G3, Lanes, approxW, figHeight, fmt, makeScale, markLabel,
  useFigWidth,
} from './figure';
import type { FigLane } from './figure';

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The service lane's gutter subtitle; a long name is shortened to fit. */
function svcSub(service: string): string {
  const s = service.length > 12 ? `${service.slice(0, 10)}...` : service;
  return `${s} · role-based`;
}

/* ---------------- lanes ---------------- */

const LANES = (service: string): FigLane[] => [
  { name: 'Service', sub: svcSub(service), segs: [] },
  { name: 'Existing sessions', sub: 'the connection pool', segs: [] },
  { name: 'New connections', sub: 'the string at work', segs: [] },
];

/**
 * The four states in which the application never learns anything happened: the
 * observer died, the switchover was refused, the configuration simply carried
 * on, or the primary is STALLED. The last one is the odd one out and says so:
 * the listener answers and the service is published, but nothing commits.
 */
function noEventLanes(ap: AppModel, service: string, t0: number, t1: number): FigLane[] {
  const lanes = LANES(service);
  const stalled = ap.noEventKind === 'stalled';
  if (stalled) {
    lanes[0]?.segs.push({
      a: t0, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ['Still published -- on a STALLED primary', 'Still published', 'Published'],
    });
    lanes[1]?.segs.push(
      { a: t0, b: 0, cls: 'b-tl', ink: 'f-tl', labs: ['Committing normally', 'Committing', 'Working'] },
      {
        a: 0, b: t1, cls: 'b-am', ink: 'f-am',
        labs: ['Commits hang -- the primary cannot write redo anywhere', 'Commits hang', 'Hanging'],
      },
    );
    lanes[2]?.segs.push({
      a: t0, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: [
        'The listener still answers -- connections are accepted throughout',
        'The listener still answers', 'Connects',
      ],
    });
    return lanes;
  }
  lanes[0]?.segs.push({
    a: t0, b: t1, cls: 'b-tl', ink: 'f-tl',
    labs: ["Published by the primary's listener -- it never moves", 'On the primary throughout', 'On the primary'],
  });
  lanes[1]?.segs.push({
    a: t0, b: t1, cls: 'b-tl', ink: 'f-tl',
    labs: ['Pooled sessions keep working -- nothing interrupts them', 'Sessions keep working', 'Working'],
  });
  lanes[2]?.segs.push({
    a: t0, b: t1, cls: 'b-tl', ink: 'f-tl',
    labs: ['Address 1 answers as always -- no timeout, no ORA-12514', 'Address 1 answers as always', 'Connects'],
  });
  return lanes;
}

interface Ladder {
  lanes: FigLane[];
  /** ORA-12514 refusal ticks on the ladder. */
  ticks: number[];
  aggregate: boolean;
}

function failureLanes(
  ap: AppModel, service: string, stalled: boolean, blocked: boolean, tOpen: number | null,
  rd: number, t0: number, t1: number, pps: number,
): Ladder {
  const lanes = LANES(service);
  const att = ap.attempts;
  const last = att[att.length - 1];
  const aggregate = att.length > 1 && ((ap.passCost + rd) * pps < 22 || att.length > 48);
  const ticks: number[] = [];

  /* lane 0 -- where the service is published */
  lanes[0]?.segs.push({
    a: t0, b: 0, cls: 'b-tl', ink: 'f-tl',
    labs: ["Published by the old primary's listener", 'On the old primary', 'Old primary'],
  });
  const svcBack = blocked || tOpen === null ? t1 : tOpen;
  lanes[0]?.segs.push({
    a: 0, b: svcBack, cls: 'b-hatch', ink: 'f-rd',
    labs: stalled
      ? ['Old primary stalled -- unreachable, service unpublished', 'Unreachable -- unpublished', 'Unpublished']
      : [`Nowhere -- nothing publishes ${service}`, 'Nowhere', '--'],
  });
  if (!blocked && tOpen !== null) {
    lanes[0]?.segs.push({
      a: tOpen, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ['Published by the new primary -- started at role change', 'On the new primary', 'New primary'],
    });
  }

  /* lane 1 -- sessions that were already connected */
  lanes[1]?.segs.push({
    a: t0, b: 0, cls: 'b-tl', ink: 'f-tl',
    labs: ['Pooled sessions working on the primary', 'Working', 'OK'],
  });
  const poolEnd = ap.tConn !== null ? ap.tConn : t1;
  if (stalled) {
    lanes[1]?.segs.push({
      a: 0, b: poolEnd, cls: 'b-am', ink: 'f-am',
      labs: ['In-flight calls hang -- a partition returns no errors', 'Calls hang -- pool unusable', 'Hanging'],
    });
  } else {
    const bk = Math.min(1.5, poolEnd);
    lanes[1]?.segs.push(
      { a: 0, b: bk, cls: 'b-hatch', ink: 'f-rd', labs: ['In-flight calls error -- ORA-3113', 'Errors'] },
      {
        a: bk, b: poolEnd, cls: 'b-am', ink: 'f-am',
        labs: ['Pool empty -- requests wait or fail', 'Pool empty', 'Empty'],
      },
    );
  }
  if (ap.tConn !== null) {
    lanes[1]?.segs.push({
      a: ap.tConn, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ['Pool rebuilt on the new primary', 'Pool rebuilt', 'OK'],
    });
  }

  /* lane 2 -- the retry ladder */
  lanes[2]?.segs.push({
    a: t0, b: 0, cls: 'b-sl', ink: 'f-sl',
    labs: ['Any request connects at once', 'Connects at once', '--'],
  });
  if (aggregate) {
    const failN = ap.tConn !== null ? att.length - 1 : att.length;
    const failEnd = ap.tConn !== null
      ? (last?.start ?? 0)
      : Math.min(ap.gaveUp ?? t1, t1);
    if (failN > 0) {
      lanes[2]?.segs.push({
        a: 0, b: failEnd, cls: 'b-am', ink: 'f-am',
        labs: [
          `${failN} failed ${failN === 1 ? 'traversal' : 'traversals'} -- the dead address waits, the rest refuse (ORA-12514)`,
          `${failN} failed ${failN === 1 ? 'traversal' : 'traversals'}`,
          'Retrying',
        ],
      });
    }
    if (ap.tConn !== null && last) {
      lanes[2]?.segs.push({
        a: last.start, b: last.a1End, cls: 'b-am', ink: 'f-am', labs: [`${fmt(ap.d1)} s`],
      });
    }
  } else {
    for (const at of att) {
      lanes[2]?.segs.push({
        a: at.start, b: at.a1End, cls: 'b-am', ink: 'f-am',
        labs: [`Address 1 -- dead, ${fmt(ap.d1)} s`, `${fmt(ap.d1)} s`],
      });
      if (!at.ok && at.end < t1) ticks.push(at.end);
    }
  }
  if (ap.tConn !== null) {
    lanes[2]?.segs.push({
      a: ap.tConn, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ap.drop
        ? [
          'Connected -- each later connect still pays the dead address first',
          'Connected -- still paying the timeout', 'Connected',
        ]
        : ['Connected -- the refused address costs almost nothing', 'Connected', 'OK'],
    });
  } else if (ap.gaveUp !== null && ap.gaveUp < t1) {
    lanes[2]?.segs.push({
      a: ap.gaveUp, b: t1, cls: 'b-sl', ink: 'f-sl',
      labs: ['No more attempts -- the string is exhausted', 'String exhausted', '--'],
    });
  }
  return { lanes, ticks, aggregate };
}

/**
 * Planned switchover, from the connection pool's side. Both hosts answer the
 * whole way through, so there is no timeout to wait out: every traversal is
 * two instant refusals, and what decides the outcome is whether RETRY_COUNT ×
 * RETRY_DELAY reaches past the new primary's open. Its own builder, because
 * the ladder starts at the conversion rather than at t = 0 and no address is
 * ever dead.
 */
function switchoverLanes(
  ap: AppModel, service: string, tOpen: number | null, rd: number,
  t0: number, t1: number, pps: number,
): Ladder {
  const lanes = LANES(service);
  const att = ap.attempts;
  const last = att[att.length - 1];
  const aggregate = att.length > 1 && ((ap.passCost + rd) * pps < 22 || att.length > 48);
  const ticks: number[] = [];
  const down = ap.startAt;
  const open = tOpen ?? t1;

  lanes[0]?.segs.push(
    {
      a: t0, b: down, cls: 'b-tl', ink: 'f-tl',
      labs: ['Published by the primary -- the command has not stopped it yet', 'On the old primary', 'Old primary'],
    },
    {
      a: down, b: open, cls: 'b-hatch', ink: 'f-rd',
      labs: [`Nowhere -- neither database publishes ${service} yet`, 'Nowhere', '--'],
    },
    {
      a: open, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ['Published by the new primary -- started at role change', 'On the new primary', 'New primary'],
    },
  );

  const poolEnd = ap.tConn !== null ? ap.tConn : t1;
  const bk = Math.min(down + 1.5, poolEnd);
  lanes[1]?.segs.push(
    {
      a: t0, b: down, cls: 'b-tl', ink: 'f-tl',
      labs: ['Pooled sessions working on the primary', 'Working', 'OK'],
    },
    { a: down, b: bk, cls: 'b-hatch', ink: 'f-rd', labs: ['Terminated as the primary converts', 'Terminated'] },
    {
      a: bk, b: poolEnd, cls: 'b-am', ink: 'f-am',
      labs: ['Pool empty -- requests wait or fail', 'Pool empty', 'Empty'],
    },
  );
  if (ap.tConn !== null) {
    lanes[1]?.segs.push({
      a: ap.tConn, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ['Pool rebuilt on the new primary', 'Pool rebuilt', 'OK'],
    });
  }

  lanes[2]?.segs.push({
    a: t0, b: down, cls: 'b-sl', ink: 'f-sl',
    labs: ['Any request connects at once', 'Connects at once', '--'],
  });
  if (aggregate) {
    const failN = ap.tConn !== null ? att.length - 1 : att.length;
    const failEnd = ap.tConn !== null ? (last?.start ?? down) : Math.min(ap.gaveUp ?? t1, t1);
    if (failN > 0) {
      lanes[2]?.segs.push({
        a: down, b: failEnd, cls: 'b-am', ink: 'f-am',
        labs: [
          `${failN} failed ${failN === 1 ? 'traversal' : 'traversals'} -- every address refuses instantly (ORA-12514)`,
          `${failN} failed ${failN === 1 ? 'traversal' : 'traversals'}`,
          'Retrying',
        ],
      });
    }
  } else {
    for (const at of att) {
      lanes[2]?.segs.push({
        a: at.start, b: at.end, cls: 'b-am', ink: 'f-am',
        labs: [`One traversal -- every address refuses, ${fmt(ap.passCost)} s`, `${fmt(ap.passCost)} s`],
      });
      if (!at.ok && at.end < t1) ticks.push(at.end);
    }
  }
  if (ap.tConn !== null) {
    lanes[2]?.segs.push({
      a: ap.tConn, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ['Connected -- every address answers, so nothing pays a timeout', 'Connected', 'OK'],
    });
  } else if (ap.gaveUp !== null && ap.gaveUp < t1) {
    lanes[2]?.segs.push({
      a: ap.gaveUp, b: t1, cls: 'b-sl', ink: 'f-sl',
      labs: ['No more attempts -- the string is exhausted', 'String exhausted', '--'],
    });
  }
  return { lanes, ticks, aggregate };
}

/* ---------------- braces ---------------- */

function ladderBraces(
  ap: AppModel, aggregate: boolean, from: number, tOpen: number | null, rc: number, rd: number,
): BraceInput[] {
  const braces: BraceInput[] = [];
  const att = ap.attempts;
  const first = att[0];
  const second = att[1];
  if (att.length > 1 && !aggregate && first && second) {
    braces.push({
      key: 'pass', a: first.start, b: second.start, tone: 'br-am', mono: false,
      name: 'One traversal + RETRY_DELAY',
      val: `${fmt(ap.d1)} + ${fmt(ap.refuse)} + ${fmt(rd)} = ${fmt(ap.passCost + rd)} s`,
    });
  } else if (first) {
    braces.push(ap.drop
      ? {
        key: 'pass', a: 0, b: first.a1End, tone: 'br-am', mono: true,
        name: 'min(TRANSPORT_CONNECT_TIMEOUT, CONNECT_TIMEOUT)',
        val: `${fmt(ap.d1)} s on the dead address, every traversal`,
      }
      : {
        key: 'pass', a: first.start, b: first.end, tone: 'br-am', mono: false,
        name: 'One traversal, every address refused',
        val: `${fmt(ap.passCost)} s -- no timeout is involved anywhere here`,
      });
  }
  if (ap.tConn !== null && tOpen !== null && ap.tConn - tOpen > 1.5) {
    braces.push({
      key: 'client', a: tOpen, b: ap.tConn, tone: 'br-sl', mono: false,
      name: 'Client-side overhead',
      val: `${fmt(ap.tConn - tOpen)} s after the database is back`,
    });
  }
  if (ap.gaveUp !== null && !ap.clipped) {
    braces.push({
      key: 'budget', a: from, b: ap.gaveUp, tone: 'br-rd', mono: false,
      name: 'Retry budget -- exhausted',
      val: `${rc + 1} × ${fmt(ap.passCost)} + ${rc} × ${fmt(rd)} = ${fmt(ap.gaveUp - from)} s`,
    });
  }
  return braces;
}

/* ---------------- markers ---------------- */

function Ticks({ ticks, scale, y0, y1 }: {
  ticks: readonly number[]; scale: TimelineScale; y0: number; y1: number;
}) {
  return (
    <>
      {ticks.map((tt) => {
        const x = scale.x(tt);
        if (x > scale.plotR - 1) return null;
        return <line key={`tk${tt}`} class="m-rd" x1={r1(x)} y1={y0} x2={r1(x)} y2={y1} stroke-width="1.5" />;
      })}
    </>
  );
}

function Reconnect({ ap, scale, g, y }: {
  ap: AppModel; scale: TimelineScale; g: typeof G3; y: number;
}) {
  if (ap.tConn !== null) {
    const xc = scale.x(ap.tConn);
    const lab = `Application reconnected at t = ${fmt(ap.tConn)} s`;
    const pos = markLabel(xc, scale, lab);
    return (
      <>
        <line class="m-vi" x1={r1(xc)} y1={(g.lane[2] ?? 0) - 6} x2={r1(xc)} y2={(g.lane[2] ?? 0) + g.laneH + 4} stroke-width="2" />
        <path class="f-vi" d={`M${r1(xc)},${(g.lane[2] ?? 0) + 11} l6,6 l-6,6 l-6,-6 z`} />
        <text class="t-mark f-vi" x={r1(pos.x)} y={y} text-anchor={pos.anchor}>{lab}</text>
      </>
    );
  }
  if (ap.clipped && ap.gaveUp !== null) {
    return (
      <text class="t-mark f-rd" x={r1(scale.plotR)} y={y} text-anchor="end">
        keeps retrying → gives up at t = {fmt(ap.gaveUp)} s
      </text>
    );
  }
  if (ap.gaveUp === null) return null;
  const xg = scale.x(ap.gaveUp);
  const cy = (g.lane[2] ?? 0) + g.laneH / 2;
  const lab = `ORA-12514 to the application at t = ${fmt(ap.gaveUp)} s`;
  const pos = markLabel(xg, scale, lab);
  return (
    <>
      <line class="m-rd" x1={r1(xg - 7)} y1={cy - 7} x2={r1(xg + 7)} y2={cy + 7} stroke-width="2.5" />
      <line class="m-rd" x1={r1(xg + 7)} y1={cy - 7} x2={r1(xg - 7)} y2={cy + 7} stroke-width="2.5" />
      <text class="t-mark f-rd" x={r1(pos.x)} y={y} text-anchor={pos.anchor}>{lab}</text>
    </>
  );
}

/* ---------------- the figure ---------------- */

function AppFigure({ ap, tr, doc, width }: {
  ap: AppModel; tr: EngineTrace; doc: TopologyDoc; width: number;
}) {
  const g = G3;
  const t0 = -ap.preRoll;
  const t1 = ap.horizon;
  const scale = makeScale(t0, t1, g, width);
  const service = doc.client.serviceName;
  const facts = tr.facts;
  const stalled = facts.conditions.stalled;
  const tOpen = ap.tService ?? facts.tOpen;
  const rd = doc.client.retryDelaySeconds;
  const rc = doc.client.retryCount;

  const kind: 'none' | 'failure' | 'switchover' = ap.noEvent
    ? 'none' : ap.switchover ? 'switchover' : 'failure';

  const ladder: Ladder = kind === 'none'
    ? { lanes: noEventLanes(ap, service, t0, t1), ticks: [], aggregate: false }
    : kind === 'switchover'
      ? switchoverLanes(ap, service, tOpen, rd, t0, t1, scale.pxPerSecond)
      : failureLanes(ap, service, stalled, facts.blocked, tOpen, rd, t0, t1, scale.pxPerSecond);

  const braces = kind === 'none'
    ? []
    : ladderBraces(ap, ladder.aggregate, kind === 'switchover' ? ap.startAt : 0, tOpen, rc, rd);
  const height = figHeight(g, braceRows(braces, scale, width, g));

  const unit = kind === 'switchover'
    ? 'seconds from the SWITCHOVER command'
    : ap.switchoverRefused
      ? 'seconds from the SWITCHOVER command'
      : ap.noEventKind === 'observer-lost'
        ? 'seconds from the observer host failure'
        : 'seconds from the failure event';

  const xz = scale.x(0);
  const gapA = (g.lane[0] ?? 0) + g.laneH;
  const gapB = (g.lane[1] ?? 0) + g.laneH;

  /* the top annotation, which branches on the outcome and never on the event */
  const outageLab = ap.tConn !== null && tOpen !== null
    ? `Application outage = ${fmt(ap.tConn - (kind === 'switchover' ? ap.startAt : 0))} s -- ${fmt(ap.tConn - tOpen)} s of it client-side`
    : null;
  const outageW = outageLab === null ? 0 : approxW(outageLab, 12);

  const noEventTop = ap.switchoverRefused
    ? 'Nothing to draw -- the broker refused the switchover, so the service never left the primary'
    : ap.noEventKind === 'observer-lost'
      ? "Nothing to draw -- the observer is not in the application's path, and no failover moves the service"
      : ap.noEventKind === 'stalled'
        ? 'Nothing moves here -- but every commit on the primary is hanging, one layer below anything this string can see'
        : 'Nothing to draw -- no role change happens, so the service never leaves the primary';

  const summary = kind === 'none'
    ? `The application's view: ${noEventTop}`
    : ap.tConn !== null
      ? `The application's view: the service was gone from t = ${fmt(kind === 'switchover' ? ap.startAt : 0)} s and a new connection succeeded at ${fmt(ap.tConn)} s, ${fmt(ap.tConn - (tOpen ?? 0))} seconds of that spent inside the connect string.`
      : `The application's view: the connect string exhausted its retry budget${ap.gaveUp === null ? '' : ` at ${fmt(ap.gaveUp)} s`} and the application stayed down.`;

  const serviceBack = tOpen !== null && !facts.blocked;
  const openCands = [
    `New primary opens -- ${service} published at t = ${fmt(tOpen ?? 0)} s`,
    `${service} published at t = ${fmt(tOpen ?? 0)} s`,
    'service back',
  ];
  const openLab = openCands.find(
    (c) => scale.x(tOpen ?? 0) + 8 + approxW(c, 11.5) <= scale.plotR,
  ) ?? openCands[2] ?? 'service back';
  const openPos = markLabel(scale.x(tOpen ?? 0), scale, openLab);

  return (
    <Figure
      width={width} height={height}
      eyebrow={kind === 'none'
        ? 'Nothing the connect string can see'
        : `t = 0 is ${kind === 'switchover' ? 'the SWITCHOVER command' : 'the failure event'} · horizon ${fmt(ap.horizon)} s`}
      summaryId="ap-summary" summary={summary}
    >
      <Frame g={g} scale={scale} step={ap.tickStep} unit={unit} preLabel="Steady state" />
      <Lanes lanes={ladder.lanes} g={g} scale={scale} />
      <Ticks ticks={ladder.ticks} scale={scale} y0={(g.lane[2] ?? 0) + 10} y1={(g.lane[2] ?? 0) + g.laneH - 10} />

      {kind === 'none' ? (
        <text class={ap.noEventKind === 'stalled' ? 't-top f-am' : 't-top f-sl'} x={r1(scale.plotL)} y={g.topY}>
          {noEventTop}
        </text>
      ) : null}

      {kind === 'failure' ? (
        <>
          <line class="partition" x1={r1(xz)} y1={g.laneTop - 4} x2={r1(xz)} y2={g.lanesBottom + 4} />
          <text class="t-mark f-rd" x={r1(xz + 8)} y={g.markY}>
            {stalled
              ? 'The primary becomes unreachable -- requests start failing'
              : 'The primary is gone -- requests start failing'}
          </text>
        </>
      ) : null}

      {kind === 'switchover' ? (
        <>
          <line class="m-vi" x1={r1(xz)} y1={g.laneTop - 4} x2={r1(xz)} y2={g.lanesBottom + 4} stroke-width="2" />
          <text class="t-mark f-vi" x={r1(xz + 8)} y={g.markY}>
            SWITCHOVER issued -- the primary still answers
          </text>
          <line
            class="m-rd" x1={r1(scale.x(ap.startAt))} y1={g.laneTop - 4}
            x2={r1(scale.x(ap.startAt))} y2={g.lanesBottom + 4}
            stroke-width="1.5" stroke-dasharray="5 4"
          />
          <text class="t-mark f-rd" x={r1(scale.x(ap.startAt) + 8)} y={gapA + 16}>
            sessions terminated at t = {fmt(ap.startAt)} s -- the worst-case request starts connecting here
          </text>
        </>
      ) : null}

      {kind !== 'none' && serviceBack && tOpen !== null ? (
        <>
          <line
            class="m-tl" x1={r1(scale.x(tOpen))} y1={(g.lane[0] ?? 0) - 6}
            x2={r1(scale.x(tOpen))} y2={g.lanesBottom + 4}
            stroke-width="1.5" stroke-dasharray="5 4"
          />
          <text
            class="t-mark f-tl" x={r1(openPos.x)} y={gapA + (kind === 'switchover' ? 32 : 16)}
            text-anchor={openPos.anchor}
          >
            {openLab}
          </text>
        </>
      ) : null}

      {kind === 'none' ? null : <Reconnect ap={ap} scale={scale} g={g} y={gapB + 16} />}

      {kind === 'none' ? null : outageLab !== null ? (
        <text
          class="t-top"
          x={r1(Math.min(Math.max((scale.x(kind === 'switchover' ? ap.startAt : 0) + scale.x(ap.tConn ?? 0)) / 2, outageW / 2 + 6), width - outageW / 2 - 6))}
          y={g.topY} text-anchor="middle"
        >
          {outageLab}
        </text>
      ) : (
        <text class="t-top f-rd" x={r1(scale.plotL)} y={g.topY}>
          {facts.blocked
            ? 'No failover is coming -- every traversal is refused, the application stays down'
            : 'The connect string gives up before the role change finishes -- the application stays down'}
        </text>
      )}

      <Braces braces={braces} scale={scale} width={width} g={g} />
    </Figure>
  );
}

/* ---------------- the panel ---------------- */

export function AppView() {
  const doc = topology.value;
  const [ref, width] = useFigWidth();
  const tr = trace.value;
  const client = doc.client;

  return (
    <div class="panel" role="region" aria-label="Application view">
      <div class="panel-hd">
        <span class="eyebrow">The application's view</span>
        <p class="caption">
          What the connect string does while the role moves, and what it costs the
          application. Every address is classified from the run at the moment the client
          dials it: a host whose packets go nowhere costs
          <span class="mono"> min(TRANSPORT_CONNECT_TIMEOUT, CONNECT_TIMEOUT)</span>, a
          listener that answers without the service refuses instantly with
          <span class="mono"> ORA-12514</span>. The refusal, OS-refusal and establish costs
          are nominal drawing constants, not documented figures, and the role-based service
          is assumed published the instant the new primary opens. These parameters affect
          only new connections -- no established session is touched by anything drawn here.
        </p>
      </div>
      <div class="panel-body" ref={ref}>
        {tr === null ? (
          <div class="empty">
            <span class="empty-k">Steady state</span>
            <p>
              Nothing has happened yet, so the connect string has nothing to survive: every
              address answers and the first one connects. Inject an event in Break mode --
              crash the primary's host, cut a link, issue a switchover -- and the
              application's view of it is drawn here.
            </p>
          </div>
        ) : (
          <AppFigure ap={computeApp(client, tr, doc)} tr={tr} doc={doc} width={width} />
        )}
      </div>
    </div>
  );
}
