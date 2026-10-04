import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/**
 * Measure an element's width without ever writing a style attribute.
 *
 * The observer is the one of the window the element is in: the timeline may be
 * rendered into a popup (common/popout.tsx). `initial` is what the first
 * render draws with, before there is anything to measure.
 */
export function useWidth(initial = 880): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(initial);
  const observer = useRef<ResizeObserver | null>(null);
  const queued = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { observer.current?.disconnect(); if (queued.current !== null) clearTimeout(queued.current); }, []);
  const ref = useCallback((el: HTMLElement | null): void => {
    observer.current?.disconnect();
    if (queued.current !== null) clearTimeout(queued.current);
    queued.current = null;
    const RO = el?.ownerDocument.defaultView?.ResizeObserver
      ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
    if (!el || RO === undefined) return;
    setWidth(el.clientWidth);
    const ro = new RO(() => {
      if (queued.current !== null) return;
      queued.current = setTimeout(() => { queued.current = null; setWidth(el.clientWidth); }, 0);
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, width];
}
