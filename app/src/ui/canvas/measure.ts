/**
 * Text and card measurement for the topology canvas.
 *
 * Everything here is arithmetic over character counts -- the same `approxW`
 * ladder the published simulator draws with. Measuring real glyphs would mean
 * `getComputedTextLength`, which forces layout on every frame and is not
 * available to a test running in node; an approximation that both the layout
 * and the renderer agree on is what keeps the drawing deterministic.
 */

/** Legacy `approxW`: character count times size times a per-face factor. */
export const approxW = (s: string, size: number, mono = false): number =>
  s.length * size * (mono ? 0.6 : 0.53);

/** Legacy `r1`: one decimal, so two runs of the layout emit identical paths. */
export const r1 = (n: number): number => Math.round(n * 10) / 10;

/** The first candidate label that fits the given pixel width, else null. */
export function fitLabel(cands: readonly string[], w: number): string | null {
  for (const c of cands) {
    if (approxW(c, 11) + 14 <= w) return c;
  }
  return null;
}

/**
 * A host name has no shorter form to degrade to the way a subtitle does, so an
 * over-long one elides. The full value stays in the aria sentence and in the
 * structural table.
 */
export function elide(s: string, max = 19): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const CARD = {
  /** width clamp(184, measured, 260) */
  minW: 184,
  maxW: 260,
  /** three text lines (role, host, name) */
  dbH: 72,
  /** RAC instance rows below the shared database header. */
  instanceRowH: 44,
  instanceBottomPad: 8,
  /** two text lines (role, host) */
  obsH: 52,
  badgeDb: 32,
  badgeObs: 28,
  /** badge left inset */
  badgeX: 12,
  /** text column starts here: 12 + badge + 12 */
  textXDb: 56,
  textXObs: 52,
  padRight: 14,
  nameSize: 13,
  hostSize: 10,
  subSize: 10,
} as const;

export interface CardLines {
  /** The role word: Primary, Physical standby, Far sync, Observer. */
  name: string;
  /** Host line, mono, elided at 19 characters. */
  host?: string;
  /** Third line: the db_unique_name, or the observer's own name. */
  sub?: string;
}

/** Card width: the text block plus the badge column, clamped to the card range. */
export function measureCardWidth(lines: CardLines, isObserver: boolean): number {
  const textX = isObserver ? CARD.textXObs : CARD.textXDb;
  const widest = Math.max(
    approxW(lines.name, CARD.nameSize),
    lines.host === undefined ? 0 : approxW(lines.host, CARD.hostSize, true),
    lines.sub === undefined ? 0 : approxW(lines.sub, CARD.subSize, true),
  );
  const want = Math.ceil(textX + widest + CARD.padRight);
  return Math.min(CARD.maxW, Math.max(CARD.minW, want));
}

/** Pill width: the legacy `pillW`, caption in sans and the value in mono. */
export function pillWidth(caption: string, value?: string): number {
  return Math.round(
    20 + approxW(caption, 10.5) + (value ? 8 + approxW(value, 10.5, true) : 0),
  );
}

export const PILL_H = 20;

/** Drag overrides snap to an 8 px grid, so a dragged card lands on the raster. */
export const snap8 = (n: number): number => Math.round(n / 8) * 8;

export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

export const rectRight = (r: Rect): number => r.x + r.w;
export const rectBottom = (r: Rect): number => r.y + r.h;

/** Rectangles overlap only when they overlap on both axes; touching is not overlap. */
export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap
    && b.x < a.x + a.w + gap
    && a.y < b.y + b.h + gap
    && b.y < a.y + a.h + gap;
}

export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Does an axis-aligned segment touch a rectangle? Endpoints on the edge do not. */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect, inset = 0.5): boolean {
  const rx0 = r.x + inset; const rx1 = r.x + r.w - inset;
  const ry0 = r.y + inset; const ry1 = r.y + r.h - inset;
  const x0 = Math.min(a.x, b.x); const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
  return x0 < rx1 && x1 > rx0 && y0 < ry1 && y1 > ry0;
}

/**
 * Channel offsets: the corridor centre first, then alternating sides at 12 px
 * -- 0, +12, -12, +24, -24 ... The sequence is a pure function of the index so
 * two runs of the router allocate the same channels.
 */
export function channelOffset(index: number, step = 12): number {
  const ring = Math.ceil(index / 2);
  return index % 2 === 1 ? ring * step : -ring * step;
}
