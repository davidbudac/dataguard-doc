import { signal } from '@preact/signals';
import { useLayoutEffect } from 'preact/hooks';
import { railCollapsed } from '@/state/view';

/**
 * True for a moment after the rail folds or unfolds by itself, so the shell can
 * let its width snap instead of glide (`.rail-snap`, rail.css).
 *
 * The rail's contents swap to the folded strip at once while its width takes
 * .22 s to follow; for a fold the reader did not ask for, that is a wide rail
 * with nothing in it for a dozen frames. A fold the reader asks for keeps its
 * animation: this is set only by `useFoldRailWhile`.
 */
export const railSnap = signal(false);

let snapTimer: ReturnType<typeof setTimeout> | null = null;
function snapNow(): void {
  railSnap.value = true;
  if (snapTimer !== null) clearTimeout(snapTimer);
  snapTimer = setTimeout(() => { railSnap.value = false; snapTimer = null; }, 320);
}

/**
 * Fold the rail to its strip while the Detailed timeline's lanes are on
 * screen, so they keep the width the timeline wants.
 *
 * In memory only -- a plain signal write, not `setRailCollapsed`, so the
 * reader's remembered choice (`dg-rail`) is untouched by a fold they did not
 * ask for. Opening or folding the rail by hand while the lanes are up is the
 * reader's own choice and is stored as it is anywhere; it is then left alone on
 * the way out. Otherwise, leaving the Detailed timeline puts the rail back as
 * it was.
 */
export function useFoldRailWhile(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const before = railCollapsed.peek();
    if (before) return undefined;
    snapNow();
    railCollapsed.value = true;
    let touched = false;
    /* `subscribe` calls back at once with the value just written. */
    const stop = railCollapsed.subscribe((shut) => { if (!shut) touched = true; });
    return () => {
      stop();
      if (!touched && railCollapsed.peek()) {
        snapNow();
        railCollapsed.value = before;
      }
    };
  }, [active]);
}
