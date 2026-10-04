/**
 * The shared drawing kit for the three figures in Configure mode -- the
 * application's view, one commit, and the reopen ladder.
 *
 * All three are ports of the published fragment's builders (lines 5303-5850,
 * 6327-6648, 6649-7045), and all three drew the same furniture: a pre-event
 * band, a tick ladder, lanes with a fixed left gutter, bars carrying the
 * `fitLabel` ladder, and braces packed into rows under the axis. That
 * furniture lives here once; each panel keeps only what makes it itself.
 *
 * Two things are deliberately imported from the timeline rather than copied:
 * `approxW`/`fitLabel`/`fmt` (the fragment's own label ladder) and
 * `packBraces` (the fragment's row packing), so a brace under the commit
 * figure and a brace under the failover timeline are placed by the same code.
 *
 * Nothing here writes a style attribute: every position is an SVG presentation
 * attribute and every colour is a class defined in `panels.css`.
 */

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { approxW, fitLabel, packBraces, signed } from '@/ui/timeline/build';
import type { BraceInput, TimelineScale } from '@/ui/timeline/build';
import { Brace } from '@/ui/timeline/Brace';

export { approxW, fitLabel, fmt, signed } from '@/ui/timeline/build';

const r1 = (n: number): number => Math.round(n * 10) / 10;

/* ---------------- geometry ---------------- */

export interface FigGeom {
  padL: number;
  padR: number;
  /** Caption baseline above the drawing. */
  topY: number;
  /** The brace above the lanes. */
  braceY: number;
  /** Event-marker labels. */
  markY: number;
  laneH: number;
  laneTop: number;
  lane: number[];
  lanesBottom: number;
  axisY: number;
  braceTop: number;
}

function geom(
  padL: number, laneTop: number, laneH: number, offsets: number[],
  axisGap: number, topY: number, markY: number, braceY: number,
): FigGeom {
  const lane = offsets.map((o) => laneTop + o);
  const lanesBottom = (lane[lane.length - 1] ?? laneTop) + laneH;
  const axisY = lanesBottom + axisGap;
  return {
    padL, padR: 30, topY, braceY, markY, laneH, laneTop, lane, lanesBottom,
    axisY, braceTop: axisY + 34,
  };
}

/** Three lanes on a second (or minute) scale -- the fragment's `G`. */
export const G3: FigGeom = geom(138, 80, 46, [0, 92, 190], 24, 16, 72, 42);

/** Four lanes on the millisecond scale -- the fragment's `GC`. */
export const G4: FigGeom = geom(138, 58, 40, [0, 52, 104, 156], 30, 18, 46, 26);

/** Where a brace row lands. `packBraces` uses the timeline's 50 px row. */
export const BRACE_ROW = 50;

export const figHeight = (g: FigGeom, rowCount: number): number =>
  g.braceTop + Math.max(1, rowCount) * BRACE_ROW + 6;

/* ---------------- scale ---------------- */

/** A linear scale over `[t0, t1]`, shaped like the timeline's own. */
export function makeScale(t0: number, t1: number, g: FigGeom, width: number): TimelineScale {
  const plotL = g.padL;
  const plotR = Math.max(plotL + 40, width - g.padR);
  const plotW = plotR - plotL;
  const span = t1 - t0 || 1;
  const pxPerSecond = plotW / span;
  return {
    t0, t1, plotL, plotR, plotW, pxPerSecond,
    x: (t: number) => plotL + ((t - t0) / span) * plotW,
    tAt: (x: number) => t0 + ((x - plotL) / plotW) * span,
    clampT: (t: number) => Math.max(t0, Math.min(t1, t)),
  };
}

/** Ticks from the first multiple of `step` at or after `t0`. */
export function ticksOf(scale: TimelineScale, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0)) return out;
  for (let t = Math.ceil(scale.t0 / step) * step; t <= scale.t1 + 1e-9; t += step) {
    out.push(Math.abs(t) < 1e-9 ? 0 : t);
    if (out.length > 400) break;
  }
  return out;
}

/* ---------------- lanes ---------------- */

export interface FigSeg {
  a: number;
  b: number;
  /** Bar class: `b-tl`, `b-bl`, `b-am`, `b-sl`, `b-vi`, `b-hatch`. */
  cls: string;
  /** Label ink: `f-tl`, `f-bl`, `f-am`, `f-sl`, `f-vi`, `f-rd`. */
  ink: string;
  /** Longest form first; the first that fits is drawn, the first is the title. */
  labs: string[];
}

export interface FigLane {
  name: string;
  sub: string;
  /** The gutter name is Oracle vocabulary and set mono when this is true. */
  mono?: boolean;
  segs: FigSeg[];
}

export function Lanes({ lanes, g, scale }: {
  lanes: readonly FigLane[]; g: FigGeom; scale: TimelineScale;
}) {
  return (
    <>
      {lanes.map((lane, i) => {
        const y = g.lane[i] ?? g.laneTop;
        return (
          <g class="fig-lane" key={lane.name}>
            <rect
              class="lane-bg" x={r1(scale.plotL)} y={y}
              width={r1(Math.max(0, scale.plotW))} height={g.laneH} rx={2}
            />
            <text
              class={lane.mono ? 't-lane t-mono' : 't-lane'}
              x={g.padL - 14} y={y + 20} text-anchor="end"
            >
              {lane.name}
            </text>
            <text class="t-sub" x={g.padL - 14} y={y + 34} text-anchor="end">{lane.sub}</text>
            {lane.segs.map((sg, k) => {
              const x0 = Math.max(scale.plotL, scale.x(sg.a));
              const x1 = Math.min(scale.plotR, scale.x(sg.b));
              const w = x1 - x0;
              if (!(w > 0.5)) return null;
              const lab = fitLabel(sg.labs, w);
              return (
                <g key={`${lane.name}-${k}`} class="fig-seg">
                  <rect
                    class={`bar ${sg.cls}`} x={r1(x0)} y={y + 6}
                    width={r1(w)} height={g.laneH - 12}
                  >
                    <title>{sg.labs[0]}</title>
                  </rect>
                  {lab === null ? null : (
                    <text class={`t-bar ${sg.ink}`} x={r1((x0 + x1) / 2)} y={y + 28} text-anchor="middle">
                      {lab}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </>
  );
}

/* ---------------- furniture ---------------- */

/** The pre-event band, its label, the tick ladder and the axis line. */
export function Frame({ g, scale, step, unit, preLabel, tickLabel }: {
  g: FigGeom;
  scale: TimelineScale;
  step: number;
  /** What the axis counts, spelled the way the fragment spells it. */
  unit: string;
  preLabel: string;
  tickLabel?: (t: number) => string;
}) {
  const zoneW = scale.x(0) - scale.plotL;
  const label = tickLabel ?? signed;
  return (
    <>
      <rect
        class="prezone" x={r1(scale.plotL)} y={g.laneTop}
        width={r1(Math.max(0, zoneW))} height={g.lanesBottom - g.laneTop}
      />
      {zoneW >= approxW(preLabel, 10.5) + 12 ? (
        <text class="t-tick" x={scale.plotL + 6} y={g.markY}>{preLabel}</text>
      ) : null}
      {ticksOf(scale, step).map((t) => (
        <g key={`tk${t}`}>
          <line class="gridline" x1={r1(scale.x(t))} y1={g.laneTop} x2={r1(scale.x(t))} y2={g.axisY} />
          <text class="t-tick t-mono" x={r1(scale.x(t))} y={g.axisY + 16} text-anchor="middle">
            {label(t)}
          </text>
        </g>
      ))}
      <line class="ax" x1={r1(scale.plotL)} y1={g.axisY} x2={r1(scale.plotR)} y2={g.axisY} />
      <text class="t-tick t-mono" x={r1(scale.plotR)} y={g.axisY + 30} text-anchor="end">{unit}</text>
    </>
  );
}

/** The packed brace rows. Returns nothing when there is nothing to measure. */
export function Braces({ braces, scale, width, g }: {
  braces: readonly BraceInput[]; scale: TimelineScale; width: number; g: FigGeom;
}) {
  const packed = packBraces(braces, scale, width, g.braceTop);
  return <>{packed.braces.map((b) => <Brace key={b.key} brace={b} />)}</>;
}

/** How many rows the braces will take -- the caller needs it for the height. */
export const braceRows = (
  braces: readonly BraceInput[], scale: TimelineScale, width: number, g: FigGeom,
): number => packBraces(braces, scale, width, g.braceTop).rowCount;

/**
 * A label placed to the right of a mark, flipped to the left when it would
 * run past the plot -- the fragment's own placement rule, in one place.
 */
export function markLabel(
  x: number, scale: TimelineScale, text: string, size = 11.5,
): { x: number; anchor: 'start' | 'end' } {
  return x + 9 + approxW(text, size) <= scale.plotR
    ? { x: x + 9, anchor: 'start' }
    : { x: x - 9, anchor: 'end' };
}

/** The first candidate that fits to the right of `x`; the last one otherwise. */
export function fitMark(x: number, scale: TimelineScale, cands: readonly string[]): string {
  for (const c of cands) if (x + 9 + approxW(c, 11.5) <= scale.plotR) return c;
  return cands[cands.length - 1] ?? '';
}

/* ---------------- the shared defs ---------------- */

/**
 * The hatch pattern and the two arrow markers, defined once for the whole
 * Configure row. Inline SVG shares one document, so every figure below can
 * reference `url(#figHatch)` -- and the page still makes no external request.
 */
export function FigDefs() {
  return (
    <svg class="fig-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <pattern
          id="figHatch" width="8" height="8"
          patternUnits="userSpaceOnUse" patternTransform="rotate(45)"
        >
          <rect width="8" height="8" class="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="8" class="hatch-ln" />
        </pattern>
        <marker
          id="figAs" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"
        >
          <path d="M0,1 L10,5 L0,9 z" class="f-bl" />
        </marker>
        <marker
          id="figAa" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"
        >
          <path d="M0,1 L10,5 L0,9 z" class="f-vi" />
        </marker>
      </defs>
    </svg>
  );
}

/** One figure: the caption above it, the drawing, and its own scroll box. */
export function Figure({ title, eyebrow, width, height, summaryId, summary, children }: {
  title?: string;
  eyebrow?: string;
  width: number;
  height: number;
  summaryId: string;
  /** The sentence a screen reader gets instead of the drawing. */
  summary: string;
  children: ComponentChildren;
}) {
  return (
    <figure class="fig">
      {title === undefined && eyebrow === undefined ? null : (
        <div class="fig-hd">
          {title === undefined ? null : <span class="title">{title}</span>}
          {eyebrow === undefined ? null : <span class="eyebrow">{eyebrow}</span>}
        </div>
      )}
      <div class="fig-plot">
        <svg
          class="tl-svg fig-svg" width={width} height={height}
          viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={summaryId}
        >
          {children}
        </svg>
      </div>
      <figcaption class="sr" id={summaryId}>{summary}</figcaption>
    </figure>
  );
}

/* ---------------- measuring ---------------- */

/**
 * The measured width of an element, without ever writing a style attribute or
 * reading a layout the browser has not settled. Falls back to the published
 * fragment's own 880 px default where there is no `ResizeObserver` -- a test
 * environment, or a print.
 */
export function useFigWidth(min = 620): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(880);
  const observer = useRef<ResizeObserver | null>(null);
  const queued = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { observer.current?.disconnect(); if (queued.current !== null) clearTimeout(queued.current); }, []);
  const ref = useCallback((el: HTMLElement | null): void => {
    observer.current?.disconnect();
    if (queued.current !== null) clearTimeout(queued.current);
    queued.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    /* The content box, not the padding box: the ref sits on the padded
       panel body, and a figure as wide as the padding box runs 16 px past
       the right edge of its scroll container. */
    const read = (): void => {
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      const pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
      setWidth(Math.max(min, (el.clientWidth || 880) - pad));
    };
    read();
    const ro = new ResizeObserver(() => {
      if (queued.current !== null) return;
      queued.current = setTimeout(() => { queued.current = null; read(); }, 0);
    });
    ro.observe(el);
    observer.current = ro;
  }, [min]);
  return [ref, Math.max(min, width)];
}
