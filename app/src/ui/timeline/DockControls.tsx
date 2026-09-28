/**
 * The two controls that size Break's floating timeline panel: the grab handle
 * on its top edge and the full-screen button in its header row.
 *
 * The handle is a `role="separator"` with a value, so it is one tab stop that
 * the arrow keys move -- the WAI-ARIA window-splitter pattern -- as well as a
 * thing to drag. The height lives in `timelineH` (view.ts), remembered under
 * `dg-tl-h`; the shell writes it into `--tl-h` through `style.setProperty`, so
 * nothing here carries a style attribute (`style-src 'self'`).
 *
 * The bounds are measured, not assumed: the header's foot is wherever the top
 * bar and the guidance line put it at this width, and the panel stops short of
 * it (`timelineMaxH`).
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

/** The height the panel is painted at now: measured, since CSS clamps the wish. */
const paintedH = (el: Element): number => {
  const dock = el.closest('.app-dock');
  const h = dock?.getBoundingClientRect().height ?? 0;
  return h > 0 ? Math.round(h) : (timelineH.value ?? timelineDefaultH(viewH()));
};

export const GRIP_TITLE = 'Drag to resize the timeline, or use the arrow keys; double-click or Enter resets it';

export function DockGrip() {
  const drag = useRef<{ y: number; h: number; id: number } | null>(null);
  const vh = viewH();
  const now = timelineH.value ?? timelineDefaultH(vh);

  const move = (el: Element, h: number, remember: boolean): void => {
    setTimelineH(clampTimelineH(h, viewH(), headBottom(el)), remember);
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    drag.current = { y: e.clientY, h: paintedH(el), id: e.pointerId };
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('is-dragging');
  };
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    move(e.currentTarget, d.h + (d.y - e.clientY), false);
  };
  const end = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.classList.remove('is-dragging');
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    /* Written once, at the end of the gesture; a press that never moved
       leaves the stored value (and the default) alone. */
    if (e.clientY !== d.y) move(e.currentTarget, d.h + (d.y - e.clientY), true);
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDblClick={() => setTimelineH(null)}
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
  if (e.key !== 'Escape' || !timelineFull.value || findingsOpen.value) return;
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
