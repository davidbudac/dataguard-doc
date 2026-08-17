/**
 * Whether the page is being printed, and the listener that keeps it current.
 *
 * On paper this application expands everything: the panel that is not open,
 * the note that is folded away. No CSS rule can do it, because what is not
 * rendered is not in the document at all -- so the components make the call,
 * and this is the one signal they all read.
 *
 * The listener lives in the shell rather than in whichever component happens
 * to want it: `beforeprint` fires once, on the window, and a collapsible in
 * Build cannot depend on a hook that only Configure mounts. Headless Chrome's
 * `--print-to-pdf` fires neither event, which is why the `matchMedia('print')`
 * change is watched as well -- that is what emulating the print media raises.
 */

import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';

export const printing = signal<boolean>(false);

export function usePrintExpand(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const on = (): void => { printing.value = true; };
    const off = (): void => { printing.value = false; };
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const onChange = (e: MediaQueryListEvent): void => { printing.value = e.matches; };
    mq?.addEventListener?.('change', onChange);
    return () => {
      window.removeEventListener('beforeprint', on);
      window.removeEventListener('afterprint', off);
      mq?.removeEventListener?.('change', onChange);
    };
  }, []);
}
