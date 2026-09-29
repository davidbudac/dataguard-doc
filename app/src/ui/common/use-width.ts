import { useEffect, useRef, useState } from 'preact/hooks';

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
  useEffect(() => () => observer.current?.disconnect(), []);
  const ref = (el: HTMLElement | null): void => {
    observer.current?.disconnect();
    const RO = el?.ownerDocument.defaultView?.ResizeObserver
      ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
    if (!el || RO === undefined) return;
    setWidth(el.clientWidth);
    const ro = new RO(() => setWidth(el.clientWidth));
    ro.observe(el);
    observer.current = ro;
  };
  return [ref, width];
}
