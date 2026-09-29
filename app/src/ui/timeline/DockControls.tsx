/**
 * The controls that size Break's Split layout: the drag on the bar between the
 * drawing and the timeline (`useDockDrag`), the keyboard handle that sits at
 * the top edge of that bar (`DockGrip`), and the full-screen button.
 *
 * The handle is a `role="separator"` with a value, so it is one tab stop that
 * the arrow keys move -- the WAI-ARIA window-splitter pattern. Its pointer
 * half is the whole bar's: the bar is the thing to drag, so the drag is the
 * bar's own (`SplitBar`), and the handle is what a keyboard or a screen reader
 * finds. The height lives in `timelineH` (view.ts), remembered under
 * `dg-tl-h`; the shell writes it into `--tl-h` through `style.setProperty`, so
 * nothing here carries a style attribute (`style-src 'self'`).
 *
 * The bounds are measured, not assumed: the header's foot is wherever the top
 * bar and the guidance line put it at this width, and the region stops short
 * of it, leaving the drawing its minimum (`timelineMaxH`).
 */

import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { setTimelineH } from '@/state/persist';
import {
  clampTimelineH, findingsOpen, timelineDefaultH, timelineFull, timelineH, timelineMaxH, TL_MIN_H,
  TL_STEP,
} from '@/state/view';

const viewH = (): number => (typeof window === 'undefined' ? 900 : window.innerHeight);

const headBottom = (from: Element | null): number => {
  const head = from?.ownerDocument.querySelector('.app-head') ?? null;
  const b = head?.getBoundingClientRect().bottom ?? 0;
  return b > 0 ? b : 80;
};

/** The height the region is painted at now: measured, since CSS clamps the wish. */
const paintedH = (el: Element): number => {
  const dock = el.closest('.app-dock');
  const h = dock?.getBoundingClientRect().height ?? 0;
  return h > 0 ? Math.round(h) : (timelineH.value ?? timelineDefaultH(viewH(), headBottom(el)));
};

/** Press further than this before a press on the bar becomes a drag, so a click stays a click. */
const DRAG_SLOP = 4;

/**
 * Drag the bar to size the region under the drawing: dragging up makes it
 * taller. Written to `timelineH` as it moves and to storage once, at the end.
 * `ignore` names what inside the bar keeps its own presses (its buttons).
 * Pointer capture is taken only once the press is a drag -- capturing at once
 * would send the `click` of a button in the bar to the bar itself.
 */
export function useDockDrag(ignore: string): {
  onPointerDown: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onDblClick: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
} {
  const drag = useRef<{ y: number; h: number; id: number; live: boolean; next: number } | null>(null);
  const clampFor = (el: Element, h: number): number => clampTimelineH(h, viewH(), headBottom(el));
  return {
    onPointerDown(e) {
      if (e.button !== 0 || (e.target as Element).closest(ignore)) return;
      drag.current = { y: e.clientY, h: paintedH(e.currentTarget), id: e.pointerId, live: false, next: 0 };
    },
    onPointerMove(e) {
      const d = drag.current;
      if (d === null || d.id !== e.pointerId) return;
      if (!d.live) {
        if (Math.abs(e.clientY - d.y) < DRAG_SLOP) return;
        d.live = true;
        /* A synthetic pointer has nothing to capture. */
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
        e.currentTarget.classList.add('is-dragging');
      }
      e.preventDefault();
      d.next = clampFor(e.currentTarget, d.h + (d.y - e.clientY));
      setTimelineH(d.next, false);
    },
    onPointerUp(e) {
      const d = drag.current;
      if (d === null || d.id !== e.pointerId) return;
      drag.current = null;
      e.currentTarget.classList.remove('is-dragging');
      if (!d.live) return;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
      /* Written once, at the end of the gesture. */
      setTimelineH(d.next);
    },
    onDblClick(e) {
      if (!(e.target as Element).closest(ignore)) setTimelineH(null);
    },
  };
}

export const GRIP_TITLE = 'Drag the bar to resize the timeline, or use the arrow keys on the handle; double-click or Enter resets it';

export function DockGrip() {
  const vh = viewH();
  const now = timelineH.value ?? timelineDefaultH(vh, typeof document === 'undefined' ? 80 : headBottom(document.body));

  const move = (el: Element, h: number, remember: boolean): void => {
    setTimelineH(clampTimelineH(h, viewH(), headBottom(el)), remember);
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    const step = e.shiftKey ? TL_STEP * 4 : TL_STEP;
    const h = paintedH(el);
    switch (e.key) {
      case 'ArrowUp': move(el, h + step, true); break;
      case 'ArrowDown': move(el, h - step, true); break;
      case 'PageUp': move(el, h + step * 4, true); break;
      case 'PageDown': move(el, h - step * 4, true); break;
      case 'Home': move(el, TL_MIN_H, true); break;
      case 'End': move(el, timelineMaxH(viewH(), headBottom(el)), true); break;
      case 'Enter': setTimelineH(null); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div
      class="dock-grip"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Timeline height"
      aria-valuemin={TL_MIN_H}
      aria-valuemax={timelineMaxH(vh, typeof document === 'undefined' ? 80 : headBottom(document.body))}
      aria-valuenow={Math.round(now)}
      aria-valuetext={`${Math.round(now)} pixels${timelineH.value === null ? ' (default)' : ''}`}
      tabIndex={0}
      title={GRIP_TITLE}
      onKeyDown={onKeyDown}
    >
      <span class="dock-grip-bar" aria-hidden="true" />
    </div>
  );
}

/**
 * Escape leaves full screen -- unless the findings popover is open over it,
 * which is the nearer thing and closes first (Findings.tsx). Capture phase, so
 * a focused card on the drawing underneath never also reads the key as
 * "forget the selection".
 */
export function onFullKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || !timelineFull.value || findingsOpen.value) return;
  timelineFull.value = false;
  e.preventDefault();
  e.stopPropagation();
}

export function FullToggle() {
  const full = timelineFull.value;
  useEffect(() => {
    if (!full) return undefined;
    window.addEventListener('keydown', onFullKey, true);
    return () => window.removeEventListener('keydown', onFullKey, true);
  }, [full]);
  return (
    <button
      type="button"
      class="btn is-icon tl-full-btn"
      aria-pressed={full}
      aria-label="Full-screen timeline"
      title={full ? 'Back to the drawing (Esc)' : 'Fill the window with the timeline'}
      onClick={() => { timelineFull.value = !full; }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {full
          ? <path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" />
          : <path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" />}
      </svg>
    </button>
  );
}
