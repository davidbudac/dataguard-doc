/**
 * Where Lanes puts what is not a card: the connector rail's lanes, and the
 * link pills in the gaps between the rows.
 *
 * Pure, so the crowding rules are tested rather than looked at. The rows are
 * only an order here (a link joins row `ra` to row `rb`); the view turns a gap
 * index into a height.
 */

import type { CanvasLink } from '../canvas/routing';

export interface Placed {
  link: CanvasLink;
  /** The rail lane its connector runs in, 0 nearest the cards. */
  lane: number;
  /** The rows it joins, `ra` above `rb`. */
  ra: number;
  rb: number;
}

/**
 * Give each link the first rail lane whose links it does not overlap, longest
 * spans first, so short hops do not push long ones outward. `lanes` is what the
 * placement actually needed -- the rail reserves that, not a guess -- and a link
 * beyond `maxLanes` shares the last one rather than widening the rail again.
 */
export function assignLanes(
  links: readonly CanvasLink[], index: ReadonlyMap<string, number>, maxLanes: number,
): { placed: Placed[]; lanes: number } {
  const spans = links.flatMap((link) => {
    const a = index.get(link.from);
    const b = index.get(link.to);
    if (a === undefined || b === undefined || a === b) return [];
    return [{ link, ra: Math.min(a, b), rb: Math.max(a, b) }];
  }).sort((p, q) => p.ra - q.ra || (q.rb - q.ra) - (p.rb - p.ra));
  const taken: { ra: number; rb: number }[][] = [];
  let lanes = 0;
  const placed = spans.map((s) => {
    let lane = taken.findIndex((ivs) => ivs.every((iv) => s.rb < iv.ra || s.ra > iv.rb));
    if (lane < 0) lane = taken.length < maxLanes ? taken.length : maxLanes - 1;
    (taken[lane] ??= []).push({ ra: s.ra, rb: s.rb });
    lanes = Math.max(lanes, lane + 1);
    return { ...s, lane };
  });
  return { placed, lanes };
}

export interface PillPlan {
  key: string;
  /** The gap it sits in: between row `gap` and row `gap + 1`. */
  gap: number;
  /** Distance from the left edge of the pill row. */
  x: number;
  w: number;
  text: string;
  /** The links it stands for: one, or the several a `+N` folds. */
  links: CanvasLink[];
  more: boolean;
}

/** The room a `+N` pill keeps at the end of every gap's row. */
export const MORE_W = 26;
export const PILL_SPACE = 3;

/**
 * Put every link's pill in one of the gaps its connector spans, without two
 * pills over each other.
 *
 * A pill goes to the emptiest gap in its span (nearest the middle of it on a
 * tie), so a run of links between the same two rows fans out over the gaps
 * between them instead of stacking in one. When a gap is full the pills that do
 * not fit fold into one `+N` at its end; the connector's own tooltip and the
 * menu behind the `+N` keep the whole text, so nothing is dropped, only
 * shortened.
 */
export function planPills(
  placed: readonly Placed[], width: number,
  textOf: (l: CanvasLink) => string, widthOf: (text: string) => number,
): PillPlan[] {
  const room = Math.max(0, width - MORE_W - PILL_SPACE);
  const used = new Map<number, number>();
  const regular = new Map<number, { p: Placed; text: string; w: number }[]>();
  const folded = new Map<number, Placed[]>();
  const order = [...placed].sort((a, b) => (a.rb - a.ra) - (b.rb - b.ra) || a.ra - b.ra || a.lane - b.lane);
  for (const p of order) {
    const text = textOf(p.link);
    const w = widthOf(text);
    const gaps: number[] = [];
    for (let k = p.ra; k < p.rb; k++) gaps.push(k);
    const mid = (p.ra + p.rb - 1) / 2;
    const near = (k: number): number => Math.abs(k - mid);
    const fits = gaps.filter((k) => (used.get(k) ?? 0) + w <= room);
    if (fits.length > 0) {
      const k = fits.reduce((best, g) =>
        ((used.get(g) ?? 0) - (used.get(best) ?? 0) || near(g) - near(best)) < 0 ? g : best);
      used.set(k, (used.get(k) ?? 0) + w + PILL_SPACE);
      (regular.get(k) ?? regular.set(k, []).get(k)!).push({ p, text, w });
    } else {
      const k = gaps.reduce((best, g) => (near(g) < near(best) ? g : best));
      (folded.get(k) ?? folded.set(k, []).get(k)!).push(p);
    }
  }
  const out: PillPlan[] = [];
  const gapsUsed = new Set([...regular.keys(), ...folded.keys()]);
  for (const gap of [...gapsUsed].sort((a, b) => a - b)) {
    let x = 0;
    for (const r of (regular.get(gap) ?? []).sort((a, b) => a.p.ra - b.p.ra || a.p.lane - b.p.lane)) {
      out.push({ key: r.p.link.id, gap, x, w: r.w, text: r.text, links: [r.p.link], more: false });
      x += r.w + PILL_SPACE;
    }
    const hidden = folded.get(gap);
    if (hidden !== undefined && hidden.length > 0) {
      out.push({
        key: `more:${gap}`, gap, x, w: MORE_W, text: `+${hidden.length}`,
        links: hidden.map((h) => h.link), more: true,
      });
    }
  }
  return out;
}

/**
 * The data centres in the order they are listed: as the document declares
 * them, the order Build's rail and the configuration read in. The drawing's
 * own left-to-right order follows redo depth, which puts an observer-only data
 * centre between the two it connects -- right for a picture of who ships to
 * whom, surprising in a list of rows a reader runs a finger down.
 *
 * A site with nothing in it has no row and is left out; a member or observer
 * whose site the document does not name is gathered after the named ones so
 * its card is never lost.
 */
export function siteOrder(declared: readonly string[], occupied: ReadonlySet<string>): string[] {
  const named = declared.filter((s) => occupied.has(s));
  const extra = [...occupied].filter((s) => !declared.includes(s)).sort();
  return [...named, ...extra];
}
