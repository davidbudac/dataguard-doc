/**
 * The top-edge handle that sizes Topology's floating panel and the docked
 * Detailed timeline.
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

import { useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { setTimelineH } from '@/state/persist';
import {
  clampTimelineH, timelineDefaultH, timelineH, timelineMaxH, TL_MIN_H,
  TL_STEP,
} from '@/state/view';

const viewH = (): number => (typeof window === 'undefined' ? 900 : window.innerHeight);

const headBottom = (from: Element | null): number => {
  const head = from?.ownerDocument.querySelector('.app-head') ?? null;
  const b = head?.getBoundingClientRect().bottom ?? 0;
  return b > 0 ? b : 80;
};

/** The height the panel is painted at now: measured, since CSS clamps the wish. */
const maxH = (from: Element | null): number => {
  const app = from?.closest('.app') ?? from?.ownerDocument.querySelector('.app');
  const max = timelineMaxH(viewH(), headBottom(from));
  // The docked tablet shell retains its 260px topology row above the panel.
  return app && !app.classList.contains('is-float')
    ? Math.max(TL_MIN_H, Math.min(max, Math.floor(viewH() - headBottom(from) - 260))) : max;
};

const paintedH = (el: Element): number => {
  const dock = el.closest('.app-dock');
  const h = dock?.getBoundingClientRect().height ?? 0;
  return h > 0 ? Math.round(h) : (timelineH.value ?? timelineDefaultH(viewH()));
};

export const GRIP_TITLE = 'Drag to resize the timeline, or use the arrow keys; double-click or Enter resets it';

export function PanelResize() {
  const drag = useRef<{ y: number; h: number; id: number; before: number | null } | null>(null);
  const vh = viewH();
  const limit = typeof document === 'undefined' ? timelineMaxH(vh, 80) : maxH(document.body);
  const now = Math.max(TL_MIN_H, Math.min(limit, timelineH.value ?? timelineDefaultH(vh)));

  const move = (el: Element, h: number, remember: boolean): void => {
    setTimelineH(Math.min(maxH(el), clampTimelineH(h, viewH(), headBottom(el))), remember);
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    drag.current = { y: e.clientY, h: paintedH(el), id: e.pointerId, before: timelineH.value };
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
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    /* Written once, at the end of the gesture; a press that never moved
       leaves the stored value (and the default) alone. */
    if (e.clientY !== d.y) move(e.currentTarget, d.h + (d.y - e.clientY), true);
  };
  const cancel = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.classList.remove('is-dragging');
    setTimelineH(d.before, false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
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
      case 'End': move(el, maxH(el), true); break;
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
      aria-valuemax={limit}
      aria-valuenow={Math.round(now)}
      aria-valuetext={`${Math.round(now)} pixels${timelineH.value === null ? ' (default)' : ''}`}
      tabIndex={0}
      title={GRIP_TITLE}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onDblClick={() => setTimelineH(null)}
      onKeyDown={onKeyDown}
    >
      <span class="dock-grip-bar" aria-hidden="true" />
    </div>
  );
}
