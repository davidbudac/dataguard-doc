/**
 * Which readings of the Break bar's terse line fit, decided from measured
 * widths and never by clipping: a value cut to "failov…" is worse than no chip.
 *
 * Pure -- the component measures, this decides. The order of give-up is the
 * `rank` of each item: the least important goes first. While something
 * non-essential is still on the line the labels stay whole; only when just the
 * essentials (`core`) are left do the labels shorten ("Application reconnects"
 * becomes "App reconnects"), and only when even that does not fit does an
 * essential go, the least important first. The most important item is never
 * dropped. A value is never shortened.
 */

export interface FitItem {
  id: string;
  /** Kept to the end: the reading the line is for. */
  core: boolean;
  /** 0 is the most important; the highest rank is dropped first. */
  rank: number;
  /** Its width with the whole label, separator excluded. */
  long: number;
  /** Its width with the short label; equal to `long` when it has none. */
  short: number;
}

export interface Fit {
  /** The items to draw, in the order they were given. */
  ids: string[];
  /** Draw the short labels. */
  short: boolean;
}

/**
 * `available` is the room for the line, `sep` what one separator costs with
 * the gaps around it. No room measured (zero or less: a bar that has not been
 * laid out) constrains nothing.
 */
export function chipsThatFit(items: readonly FitItem[], available: number, sep: number): Fit {
  const all = items.map((i) => i.id);
  if (!(available > 0) || items.length === 0) return { ids: all, short: false };
  const byKeep = [...items].sort((a, b) => a.rank - b.rank);
  const cores = byKeep.filter((i) => i.core).length;
  const width = (k: number, short: boolean): number => {
    let w = 0;
    for (let i = 0; i < k; i += 1) w += short ? byKeep[i]!.short : byKeep[i]!.long;
    return w + Math.max(0, k - 1) * sep;
  };
  const pick = (k: number, short: boolean): Fit => {
    const keep = new Set(byKeep.slice(0, k).map((i) => i.id));
    return { ids: all.filter((id) => keep.has(id)), short };
  };
  for (let k = items.length; k >= 1; k -= 1) {
    if (width(k, false) <= available) return pick(k, false);
    if (k <= cores && width(k, true) <= available) return pick(k, true);
  }
  return pick(1, true);
}
