import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/** Measure the plot in its own window, including a popped-out timeline. */
export function usePlotSize(fitHeight: boolean) {
  const [size, setSize] = useState({ width: 880, height: 0 });
  const cleanup = useRef<(() => void) | null>(null);
  const element = useRef<HTMLDivElement | null>(null);
  const observe = useCallback((): void => {
    const el = element.current;
    cleanup.current?.(); cleanup.current = null;
    if (!el) return;
    const host = el.ownerDocument.defaultView;
    const measure = (): void => {
      const width = el.clientWidth || 880;
      const height = fitHeight ? Math.max(0, el.getBoundingClientRect().height - (el.offsetHeight - el.clientHeight)) : 0;
      setSize(before => before.width === width && before.height === height ? before : { width, height });
    };
    measure();
    if (!host?.ResizeObserver) return;
    let queued: number | null = null;
    const observer = new host.ResizeObserver(() => {
      if (queued !== null) return;
      queued = host.setTimeout(() => { queued = null; measure(); }, 0);
    });
    observer.observe(el);
    cleanup.current = () => { observer.disconnect(); if (queued !== null) host.clearTimeout(queued); };
  }, [fitHeight]);
  const ref = useCallback((el: HTMLDivElement | null): void => { element.current = el; observe(); }, [observe]);
  useEffect(() => { observe(); return () => cleanup.current?.(); }, [observe]);
  return [ref, size] as const;
}
