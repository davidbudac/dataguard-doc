import { useLayoutEffect } from 'preact/hooks';
import { railCollapsed } from '@/state/view';

/**
 * Fold the rail to its strip while the Split layout is on screen, so the
 * drawing has the room the timeline took.
 *
 * In memory only -- a plain signal write, not `setRailCollapsed`, so the
 * reader's remembered choice (`dg-rail`) is untouched by a layout they chose
 * for another reason. Opening or folding the rail by hand while in Split is the
 * reader's own choice and is stored as it is anywhere; it is then left alone on
 * the way out. Otherwise, leaving Split puts the rail back as it was.
 */
export function useFoldRailWhile(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const before = railCollapsed.peek();
    if (before) return undefined;
    railCollapsed.value = true;
    let touched = false;
    /* `subscribe` calls back at once with the value just written. */
    const stop = railCollapsed.subscribe((shut) => { if (!shut) touched = true; });
    return () => {
      stop();
      if (!touched && railCollapsed.peek()) railCollapsed.value = before;
    };
  }, [active]);
}
