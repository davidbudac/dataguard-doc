/**
 * Configure -> Commit: the anatomy of one commit, in milliseconds.
 *
 * Ported from the published fragment's commit figure (lines 6327-6648) and
 * generalised from one destination to the primary's direct legs: one figure
 * per leg, all sharing the one millisecond scale `computeCommit` returns, so
 * two destinations are compared by eye without reconciling two axes.
 *
 * The three claims the drawing rests on are the engine's, rendered where they
 * are read rather than in a footnote:
 *   - a commit costs max(local write, remote ack path), never their sum,
 *     because LGWR starts the remote write before it issues the local one;
 *   - AFFIRM acknowledges received redo AFTER the standby redo log write,
 *     NOAFFIRM before it;
 *   - a far sync leg terminates the commit, and the hop onward to the target
 *     standby is ASYNC and outside the transaction.
 */

import { computeCommit, findMember, isFarSync, linkRttMs, memberHosts } from '@/engine';
import type { CommitLeg, CommitLegResult, CommitModel, MemberId, TopologyDoc } from '@/engine';
import type { BraceInput, TimelineScale } from '@/ui/timeline/build';
import { primaryId, redoGraph, topology } from '@/state/derived';
import { edition } from '@/state/view';
import { Chip } from '@/ui/common/Chip';
import type { ReadoutChip } from '@/state/derived';
import {
  Braces, braceRows, Figure, Frame, G4, Lanes, figHeight, fitLabel, fmt, makeScale, markLabel,
  useFigWidth,
} from './figure';
import type { FigLane } from './figure';

const r1 = (n: number): number => Math.round(n * 10) / 10;

/* ---------------- the legs ---------------- */

/** The primary's direct destinations, in the order the resolver found them. */
export function commitLegs(doc: TopologyDoc, primary: MemberId | null): CommitLeg[] {
  if (primary === null) return [];
  const graph = redoGraph.value;
  if (!graph) return [];
  const from = findMember(doc, primary);
  const fromHost = from ? memberHosts(from)[0] : undefined;
  const out: CommitLeg[] = [];
  for (const e of graph.edges) {
    if (e.from !== primary || !e.active) continue;
    const to = findMember(doc, e.to);
    if (!to) continue;
    const toHost = memberHosts(to)[0];
    out.push({
      to: e.to,
      kind: to.kind,
      xpt: e.xpt,
      rttMs: fromHost && toHost ? linkRttMs(doc, fromHost, toHost) : 0,
      destWriteMs: doc.environment.standbyWriteMs,
    });
  }
  return out;
}

/** ` to sby01` -- who a far sync instance forwards to, when it forwards. */
function onwardOf(doc: TopologyDoc, from: MemberId): string {
  const graph = redoGraph.value;
  if (!graph) return '';
  const names = graph.edges
    .filter((e) => e.from === from && e.active)
    .map((e) => findMember(doc, e.to)?.name ?? String(e.to));
  return names.length === 0 ? '' : ` to ${names.join(' and ')}`;
}

/* ---------------- one leg's figure ---------------- */

function legLanes(doc: TopologyDoc, cm: CommitModel, leg: CommitLegResult, t0: number, t1: number): FigLane[] {
  const to = findMember(doc, leg.to);
  const name = to?.name ?? String(leg.to);
  const async = leg.xpt === 'ASYNC';
  const srlStart = leg.shipDoneMs ?? leg.oneWayMs;

  const lanes: FigLane[] = [
    { name: 'User session', sub: 'the committing app', segs: [] },
    { name: 'Primary LGWR', sub: 'online redo log write', segs: [] },
    { name: 'Wire', sub: `to ${name}`, segs: [] },
    { name, mono: true, sub: 'RFS + standby redo log', segs: [] },
  ];

  lanes[0]?.segs.push(
    { a: t0, b: 0, cls: 'b-sl', ink: 'f-sl', labs: ['Inside the transaction', 'Transaction'] },
    {
      a: 0, b: cm.commitMs, cls: 'b-am', ink: 'f-am',
      labs: ['Waiting on the commit -- the session is blocked', 'Waiting on the commit', 'Waiting'],
    },
    {
      a: cm.commitMs, b: t1, cls: 'b-tl', ink: 'f-tl',
      labs: ['Commit returned -- the session carries on', 'Commit returned', 'Returned'],
    },
  );

  if (cm.localWriteMs > 0) {
    lanes[1]?.segs.push({
      a: 0, b: cm.localWriteMs, cls: 'b-bl', ink: 'f-bl',
      labs: ['Writes the redo to the online redo log', 'Local redo write', 'Local write'],
    });
  }
  if (async && leg.shipDoneMs !== null && leg.shipDoneMs > cm.commitMs) {
    lanes[1]?.segs.push({
      a: cm.commitMs, b: leg.shipDoneMs, cls: 'b-sl', ink: 'f-sl',
      labs: ['Ships the redo in the background -- nothing waits for it', 'Ships in the background', 'Background'],
    });
    lanes[2]?.segs.push({
      a: cm.commitMs, b: leg.shipDoneMs, cls: 'b-hatch', ink: 'f-rd',
      labs: ['Committed redo still in flight', 'Redo in flight', 'In flight'],
    });
  }
  if (leg.destWriteMs > 0) {
    lanes[3]?.segs.push({
      a: srlStart, b: srlStart + leg.destWriteMs, cls: 'b-bl', ink: 'f-bl',
      labs: ['Writes it to the standby redo log', 'Standby redo log write', 'SRL write'],
    });
  }
  return lanes;
}

function legBraces(leg: CommitLegResult, cm: CommitModel): BraceInput[] {
  const braces: BraceInput[] = [];
  const sync = leg.xpt === 'SYNC';
  const async = leg.xpt === 'ASYNC';
  const srlStart = leg.shipDoneMs ?? leg.oneWayMs;
  const ackOut = leg.ackAtMs === null ? null : leg.ackAtMs - leg.oneWayMs;

  if (leg.oneWayMs > 0) {
    braces.push({
      key: 'out', a: 0, b: leg.oneWayMs, tone: 'br-sl', mono: false,
      name: 'Network, one way out',
      val: `${fmt(leg.oneWayMs)} ms -- half of the ${fmt(leg.rttMs)} ms round trip`,
    });
    if (ackOut !== null && leg.ackAtMs !== null) {
      braces.push({
        /* The published figure tones this brace violet; the shared brace
           vocabulary has four tones and violet is not one of them, so the
           acknowledgement keeps its violet on the arrow and the diamond and
           the brace under it is neutral. */
        key: 'back', a: ackOut, b: leg.ackAtMs, tone: 'br-sl', mono: false,
        name: 'Acknowledgement, one way back',
        val: `${fmt(leg.oneWayMs)} ms -- the other half`,
      });
    }
  }
  if (leg.destWriteMs > 0) {
    braces.push({
      key: 'srl', a: srlStart, b: srlStart + leg.destWriteMs,
      tone: sync ? 'br-am' : 'br-sl', mono: false,
      name: 'Standby redo log write',
      val: sync
        ? `${fmt(leg.destWriteMs)} ms -- on the commit path (AFFIRM)`
        : `${fmt(leg.destWriteMs)} ms -- off the commit path (NOAFFIRM)`,
    });
  }
  if (cm.localWriteMs > 0) {
    braces.push({
      key: 'local', a: 0, b: cm.localWriteMs, tone: 'br-bl', mono: false,
      name: 'Local online redo log write',
      val: async
        ? `${fmt(cm.localWriteMs)} ms -- the whole commit`
        : `${fmt(cm.localWriteMs)} ms -- overlaps the round trip`,
    });
  }
  /* A brace narrower than 3 px is a label with no bracket; the fragment drops
     it, and so does this. */
  return braces;
}

function LegFigure({ doc, cm, leg, width }: {
  doc: TopologyDoc; cm: CommitModel; leg: CommitLegResult; width: number;
}) {
  const g = G4;
  const t0 = -cm.preRollMs;
  const t1 = cm.horizonMs;
  const scale = makeScale(t0, t1, g, width);
  const to = findMember(doc, leg.to);
  const name = to?.name ?? String(leg.to);
  const farSync = to !== undefined && isFarSync(to);
  const async = leg.xpt === 'ASYNC';
  const sync = leg.xpt === 'SYNC';
  const srlStart = leg.shipDoneMs ?? leg.oneWayMs;
  const ackOut = leg.ackAtMs === null ? null : leg.ackAtMs - leg.oneWayMs;

  const lanes = legLanes(doc, cm, leg, t0, t1);
  const braces = legBraces(leg, cm).filter(
    (b) => scale.x(b.b) - scale.x(b.a) >= 3,
  );
  const height = figHeight(g, braceRows(braces, scale, width, g));

  const wy = (g.lane[2] ?? 0) + g.laneH / 2;
  const wSpan = scale.x(leg.oneWayMs) - scale.x(0);
  const xr = scale.x(srlStart);
  const gapY = g.lanesBottom + 16;
  const xc = scale.x(cm.commitMs);
  const commitLab = `commit returns at ${fmt(cm.commitMs)} ms`;
  const commitPos = markLabel(xc, scale, commitLab);
  const ackLab = sync ? 'ack -- after the disk write' : 'ack -- before the disk write';
  const ackPos = ackOut === null ? null : markLabel(scale.x(ackOut), scale, ackLab);
  const rfsLab = fitLabel(['RFS receives the redo', 'RFS receives', 'RFS'], scale.plotR - xr - 14);

  const top = async
    ? `ASYNC · the commit costs the local write, ${fmt(cm.localWriteMs)} ms -- ${name} is not on the path`
    : `${leg.xpt} · commit = max(local write ${fmt(cm.localWriteMs)} ms, ack path ${fmt(leg.ackPathMs ?? 0)} ms) = ${fmt(cm.commitMs)} ms`;

  const summary = async
    ? `One commit with ${name} as an ASYNC destination: the commit returns after ${fmt(cm.commitMs)} milliseconds, and the redo reaches ${name} around ${fmt(leg.shipDoneMs ?? 0)} milliseconds.`
    : `One commit on the ${leg.xpt} leg to ${name}: the commit returns after ${fmt(cm.commitMs)} milliseconds, of which ${fmt(cm.standbyWaitMs)} is spent waiting on the destination.`;

  return (
    <Figure
      title={name}
      eyebrow={`${leg.xpt} · RTT ${fmt(leg.rttMs)} ms${farSync ? ' · far sync' : ''}`}
      width={width} height={height}
      summaryId={`cm-summary-${String(leg.to)}`} summary={summary}
    >
      <Frame
        g={g} scale={scale} step={cm.tickStepMs} unit="milliseconds from COMMIT"
        preLabel="COMMIT issued"
      />
      <Lanes lanes={lanes} g={g} scale={scale} />

      {/* the wire: redo out, acknowledgement back, opposite arrow directions */}
      {async ? (
        wSpan < 8 ? (
          <text class="t-bar f-sl" x={r1(scale.x(0) + 8)} y={r1(wy + 4)}>
            The redo leaves after the commit has already returned
          </text>
        ) : null
      ) : wSpan >= 8 && leg.ackAtMs !== null && ackOut !== null ? (
        <>
          <line
            class="w-send" x1={r1(scale.x(0))} y1={r1(wy)} x2={r1(scale.x(leg.oneWayMs))} y2={r1(wy)}
            marker-end="url(#figAs)"
          />
          {fitLabel(['redo to the destination →', 'redo →', '→'], wSpan) === null ? null : (
            <text class="t-bar f-bl" x={r1((scale.x(0) + scale.x(leg.oneWayMs)) / 2)} y={r1(wy - 7)} text-anchor="middle">
              {fitLabel(['redo to the destination →', 'redo →', '→'], wSpan)}
            </text>
          )}
          <line
            class="w-ack" x1={r1(scale.x(leg.ackAtMs))} y1={r1(wy)} x2={r1(scale.x(ackOut))} y2={r1(wy)}
            marker-end="url(#figAa)"
          />
          {fitLabel(['← acknowledgement', '← ack', '←'], wSpan) === null ? null : (
            <text class="t-bar f-vi" x={r1((scale.x(ackOut) + scale.x(leg.ackAtMs)) / 2)} y={r1(wy + 16)} text-anchor="middle">
              {fitLabel(['← acknowledgement', '← ack', '←'], wSpan)}
            </text>
          )}
        </>
      ) : (
        <text class="t-bar f-sl" x={r1(scale.x(0) + 8)} y={r1(wy + 4)}>
          {leg.rttMs === 0
            ? 'At 0 ms RTT the wire costs nothing -- only the disk writes are left'
            : `The ${fmt(leg.rttMs)} ms round trip is too short to draw at this scale`}
        </text>
      )}

      {/* the destination: RFS receive, the SRL write, and where the ack comes from */}
      <line class="m-bl" x1={r1(xr)} y1={(g.lane[3] ?? 0) + 4} x2={r1(xr)} y2={(g.lane[3] ?? 0) + g.laneH - 4} stroke-width="1.5" />
      {ackOut !== null && ackPos !== null ? (
        <>
          <path class="f-vi" d={`M${r1(scale.x(ackOut))},${(g.lane[3] ?? 0) + 6} l7,7 l-7,7 l-7,-7 z`}>
            <title>
              {sync
                ? 'AFFIRM -- the destination acknowledges after writing the redo to the standby redo log'
                : 'NOAFFIRM -- the destination acknowledges on receipt, before writing the redo'}
            </title>
          </path>
          <text class="t-mark f-vi" x={r1(ackPos.x)} y={gapY} text-anchor={ackPos.anchor}>{ackLab}</text>
        </>
      ) : (
        <text
          class="t-mark f-sl"
          x={r1(markLabel(xr, scale, 'redo lands here -- after the commit already returned').x)}
          y={gapY}
          text-anchor={markLabel(xr, scale, 'redo lands here -- after the commit already returned').anchor}
        >
          redo lands here -- after the commit already returned
        </text>
      )}
      {rfsLab === null || ackPos !== null ? null : (
        <text class="t-bar f-bl" x={r1(xr + 8)} y={gapY}>{rfsLab}</text>
      )}

      {/* the moment the commit returns */}
      <line
        class="m-tl" x1={r1(xc)} y1={g.laneTop - 10} x2={r1(xc)} y2={g.lanesBottom + 6}
        stroke-width="1.5" stroke-dasharray="5 4"
      />
      <text class="t-mark f-tl" x={r1(commitPos.x)} y={g.markY} text-anchor={commitPos.anchor}>
        {commitLab}
      </text>

      <text class="t-top" x={r1(scale.plotL)} y={g.topY}>{top}</text>
      <Braces braces={braces} scale={scale} width={width} g={g} />
    </Figure>
  );
}

/* ---------------- the readout ---------------- */

function chipsFor(cm: CommitModel, name: string): ReadoutChip[] {
  const g = cm.governing;
  const delta = cm.syncFastsyncDeltaMs;
  const chips: ReadoutChip[] = [
    {
      id: 'commit', tone: 'ik', k: 'Commit returns after', v: fmt(cm.commitMs), unit: 'ms',
      sub: g === null
        ? 'The local redo log write, and nothing else'
        : `max(local write ${fmt(cm.localWriteMs)} ms, ack path ${fmt(g.ackPathMs ?? 0)} ms) -- the remote write is started before the local one, so they overlap`,
      basis: cm.claims.maxNotSum.basis,
    },
    {
      id: 'wait', tone: 'am', k: 'Waiting on the destination',
      v: cm.standbyWaitMs > 0 ? fmt(cm.standbyWaitMs) : 'none',
      ...(cm.standbyWaitMs > 0 ? { unit: 'ms' } : {}),
      sub: g === null
        ? 'Nothing on the commit path leaves the primary'
        : cm.standbyWaitMs > 0
          ? `What the commit pays on top of its own redo log write, on the ${name} leg`
          : 'The local write already covers the whole acknowledgement path, so the destination costs nothing here',
    },
    {
      id: 'delta', tone: 'vi', k: 'SYNC vs FASTSYNC here',
      v: delta > 0 ? `−${fmt(delta)}` : '0', unit: 'ms',
      sub: delta <= 0
        ? 'No gap at these settings: the local write is at least as long as the round trip, so AFFIRM costs nothing'
        : Math.abs(delta - (g?.destWriteMs ?? 0)) < 1e-9
          ? `FASTSYNC returns ${fmt(delta)} ms sooner at these settings -- exactly the standby redo log write`
          : `FASTSYNC returns ${fmt(delta)} ms sooner at these settings -- less than the full standby redo log write, the local write already covers the rest`,
    },
    cm.exposed
      ? {
        id: 'loss', tone: 'rd', k: 'Loss exposure', v: 'yes',
        sub: 'Redo is still in flight when the commit returns -- what bounds the loss of a failover is the lag limit, not one round trip',
      }
      : {
        id: 'loss', tone: 'ik', k: 'Loss exposure', v: 'none',
        sub: g?.xpt === 'SYNC'
          ? "The redo is on the destination's disk before the commit returns"
          : 'Acknowledged before the commit returns -- from the destination’s memory; the disk write lands afterwards',
      },
  ];
  if (cm.modeConflict) {
    chips.push({
      id: 'mode', tone: 'rd', k: 'Protection mode', v: 'mismatch',
      sub: 'ASYNC against maximum availability -- the broker’s protection-mode table lists SYNC or FASTSYNC there',
    });
  } else if (cm.modeAllowed26) {
    chips.push({
      id: 'mode', tone: 'am', k: 'Protection mode', v: 'allowed',
      sub: 'The 26ai prerequisites list ASYNC for a maximum availability target too; zero data loss still wants SYNC or FASTSYNC',
    });
  }
  return chips;
}

/* ---------------- the panel ---------------- */

export function Commit() {
  const doc = topology.value;
  const [ref, width] = useFigWidth();
  const legs = commitLegs(doc, primaryId.value);
  const cm = computeCommit({
    edition: edition.value,
    mode: doc.config.protectionMode,
    localWriteMs: doc.environment.localWriteMs,
    legs,
  });
  const governingName = cm.governing === null
    ? ''
    : findMember(doc, cm.governing.to)?.name ?? String(cm.governing.to);

  /* One figure per leg, waited-on ones first: the commit's own story is the
     legs it waits for, and an ASYNC leg is drawn after them to show what a
     commit that waits for nothing looks like. */
  const ordered = [...cm.legs].sort((a, b) => Number(b.waits) - Number(a.waits));

  return (
    <div class="panel" role="region" aria-label="Commit">
      <div class="panel-hd">
        <span class="eyebrow">One commit · millisecond scale</span>
        <p class="caption">
          LGWR starts the remote write before it issues the local one and waits for the
          remote write only afterwards, so the two overlap: a commit costs the longer of
          them, never their sum. <span class="mono">SYNC</span> is
          <span class="mono"> SYNC</span>+<span class="mono">AFFIRM</span> and the
          destination acknowledges only once the redo is in its standby redo log;
          <span class="mono"> FASTSYNC</span> is <span class="mono">SYNC</span>+
          <span class="mono">NOAFFIRM</span> and it acknowledges on receipt, before that
          write; <span class="mono">ASYNC</span> never makes the transaction wait at all.
          {cm.claims.farSync === undefined
            ? ''
            : ' A far sync leg terminates the commit -- with SYNC into the far sync instance all committed redo resides on disk there, and the hop onward to the target standby is ASYNC and outside the transaction.'}
          {cm.claims.multiSync === undefined
            ? ''
            : ' More than one synchronous destination is waited on here, and what a commit with more than one waits for is not documented: this draws the pessimistic reading.'}
        </p>
      </div>
      <div class="panel-body" ref={ref}>
        {legs.length === 0 ? (
          <div class="empty">
            <span class="empty-k">No destination</span>
            <p>
              The primary ships redo nowhere in this configuration, so a commit costs its own
              online redo log write and nothing else. Add a destination in the Inspector and
              its leg is drawn here.
            </p>
          </div>
        ) : (
          <>
            <div class="chips">
              {chipsFor(cm, governingName).map((c) => <Chip key={c.id} chip={c} />)}
            </div>
            <div class="fig-stack">
              {ordered.map((leg) => (
                <div key={String(leg.to)}>
                  <LegFigure doc={doc} cm={cm} leg={leg} width={width} />
                  {!leg.terminatesCommit ? null : (
                    <p class="caption">
                      The commit ends here. With <span class="mono">SYNC</span> into the far sync
                      instance all committed redo resides on disk at
                      {' '}<span class="mono">{findMember(doc, leg.to)?.name ?? String(leg.to)}</span>,
                      and the hop onward{onwardOf(doc, leg.to)} is
                      {' '}<span class="mono">ASYNC</span> -- outside the transaction, so it is not
                      a leg of this commit and nothing below the axis measures it.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
