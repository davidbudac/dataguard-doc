/**
 * The canvas as the shell mounts it.
 *
 * `TopoCanvas` is a pure drawing: it takes a document, a resolved redo graph
 * and (in Break mode) one frame of the trace, and it emits gestures. This
 * adapter is where those two halves meet -- it reads the derived signals and
 * turns a gesture back into a labelled edit, so one drag is one undo.
 *
 * Written by the shell workflow so `App.tsx` has something to mount; the
 * canvas workflow owns this file from here.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { TopologyDoc } from '@/engine';
import { frame, geometry, redoGraph, topology } from '@/state/derived';
import { doc, withLayout } from '@/state/doc';
import { breakCoalescing, edit } from '@/state/history';
import {
  canEdit, clearSelection, focusField, hovered, mode, railWhere, select, selection, tNow, toast,
  viewport,
} from '@/state/view';
import { buildActionsFor, openInspectorFor, removeAction } from '../build/actions';
import {
  actionsFor, nothingToRestore, restoreQuietLine, runAction,
} from '../break/events';
import { AddToolbar } from '../inspector/adds';
import type { WhyState } from '../common/WhyPill';
import { useRovingToolbar } from '../common/useRovingToolbar';
import { ON } from '../inspector/why';
import type { BarAction } from './ActionBar';
import { MAX_ROWS_BREAK } from './ActionBar';
import { barFocus, barOpen, closeBar, openBar } from './bar';
import { menuOpen, snapT } from './EventMenu';
import { TopoCanvas } from './TopoCanvas';
import {
  canZoom, fitZoom, WHY_MAX, WHY_MIN, zoom, zoomBy, zoomLabel,
} from './zoom';

/**
 * `Delete` on a focused card, a line or a data centre, in Build mode
 * (ui.md SS4).
 *
 * It removes exactly what the inspector's Remove button removes -- literally
 * the same `BuildAction`, out of `build/actions` -- refusals included: a
 * keyboard shortcut that could delete the primary, the last database or a data
 * centre with hosts still in it, while the button beside it says why it cannot,
 * is two answers to one question. A refusal is said out loud rather than
 * swallowed, because a key that silently does nothing is the one thing this
 * page may not do.
 */
export function deleteFromCanvas(key: string): void {
  const action = removeAction(topology.value, key);
  if (action === null) return;
  if (action.enabled.state === 'off') {
    toast.value = { kind: 'warn', text: `${key} stays: ${action.enabled.why}` };
    return;
  }
  action.run();
  clearSelection();
}

/**
 * Build's table as bar rows.
 *
 * The order is the table's own -- `Edit` first, the properties between,
 * `Remove` last -- and it is load-bearing rather than cosmetic: the bar shows
 * the first six rows and says the rest are in the rail, so what gets dropped
 * has to be the least destructive thing on the list, never the way out.
 */
function buildBar(d: TopologyDoc, keys: readonly string[]): BarAction[] {
  return buildActionsFor(d, keys).map((a) => ({
    id: a.id,
    label: a.label,
    enabled: a.enabled,
    run: a.run,
    ...(a.pressed === undefined ? {} : { pressed: a.pressed }),
  }));
}

/**
 * Break's table as bar rows, dropped restores and all.
 *
 * Exactly what `EventMenu` renders for the same selection at the same moment,
 * because it is the same three calls in the same order: the restores with
 * nothing to restore come out, the one sentence that stands in for them is
 * `restoreQuietLine`'s rather than this surface's, and a property rides at the
 * end where the menu puts it.
 */
function breakBar(
  d: TopologyDoc, keys: readonly string[], at: number,
): { actions: BarAction[]; quiet: string | null } {
  const all = actionsFor(d, keys, at);
  const events = all.filter((a) => a.property !== true);
  const properties = all.filter((a) => a.property === true);
  const offered = events.filter((a) => !nothingToRestore(a));
  return {
    actions: [...offered, ...properties].map((a) => ({
      id: a.id, label: a.label, enabled: a.enabled, run: () => runAction(a),
    })),
    quiet: restoreQuietLine(d, keys, at, events),
  };
}

/**
 * How far below 1:1 the drawing is rendering.
 *
 * The canvas is capped at its own viewBox size and scaled down to fit
 * whatever the stage leaves it -- 0.8 at 1280 px, 0.61 for the widest preset
 * -- and the action bar has to undo that or its 12 px text lands at 7. The
 * measurement is here rather than in `TopoCanvas` because the canvas is a pure
 * drawing: it reads no clock, no signal and no layout of its own.
 *
 * Rounded to a hundredth and clamped to [0.5, 1]: an unrounded ratio changes
 * on every resize frame and would re-place the bar on each one. Absent
 * `ResizeObserver` -- jsdom -- it stays 1, which is what a test renders at.
 */
function useCanvasScale(zoomFactor: number): [(el: HTMLElement | null) => void, number] {
  const [scale, setScale] = useState(1);
  const observer = useRef<ResizeObserver | null>(null);
  const host = useRef<HTMLElement | null>(null);
  const read = useCallback((): void => {
    const svg = host.current?.querySelector('.topo-svg') ?? null;
    if (svg === null) return;
    /* Against the *viewBox*, not the width attribute: those two were the same
       number until zoom, which multiplies the attribute and leaves the viewBox
       alone. The bar compensates for user units per CSS pixel, and that is
       what the viewBox measures. */
    const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/);
    const declared = Number(box?.[2] ?? svg.getAttribute('width'));
    const painted = svg.getBoundingClientRect().width;
    if (!(declared > 0) || !(painted > 0)) return;
    const k = Math.min(1, Math.max(0.5, Math.round((painted / declared) * 100) / 100));
    setScale((prev) => (prev === k ? prev : k));
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  /* A zoom does not resize the wrap -- the wrap is the scroll port and keeps
     the room the stage gave it, the drawing inside it grows -- so the observer
     never fires on one and the measurement would be a rung out of date. This
     is that missing edge. */
  useEffect(() => { read(); }, [zoomFactor, read]);
  const ref = useCallback((el: HTMLElement | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    host.current = el;
    if (!el) return;
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    observer.current = ro;
  }, [read]);
  return [ref, scale];
}

/**
 * The zoom ladder, beside Build's additions and alone in Break.
 *
 * Three buttons and the rung they are on. It carries the `role="toolbar"`
 * contract the strip beside it carries -- one tab stop, arrows inside -- out
 * of the same hook, because a reader who learns the arrows work in one strip
 * over the drawing and finds them dead in the next has been lied to twice.
 *
 * `-` and `+` go grey at the ends of the ladder and say so -- in the button's
 * own title, not in a pill beside it: a `WhyPill` under a one-glyph button
 * doubled the height of the strip and pushed the drawing down every time a
 * reader reached 140 %, which made the refusal louder than the act. The
 * reason is still attached to the control (`title`, so the hover and the
 * screen reader both get it); it is the one grey control on the page that
 * explains itself in a tooltip rather than in a sentence beside it, and
 * ui.md SS3d says so.
 */
function ZoomStrip() {
  const at = zoom.value;
  const out = canZoom(-1);
  const inn = canZoom(1);
  const states: WhyState[] = [
    out ? ON : { state: 'off', why: WHY_MIN },
    inn ? ON : { state: 'off', why: WHY_MAX },
    { state: 'on' },
  ];
  const roving = useRovingToolbar(states.map((w) => w.state !== 'off'));
  const rows: { label: string; name: string; title: string; run: () => void }[] = [
    {
      label: '−',
      name: 'Zoom out',
      title: 'Draw the configuration one rung smaller.',
      run: () => zoomBy(-1),
    },
    {
      label: '+',
      name: 'Zoom in',
      title: 'Draw the configuration one rung larger; the drawing scrolls to the rest of it.',
      run: () => zoomBy(1),
    },
    {
      label: 'Fit',
      name: 'Fit to page',
      title: 'Back to the drawing at its own size.',
      run: () => fitZoom(),
    },
  ];

  return (
    <div class="cv-zoom" role="toolbar" aria-label="Zoom the drawing" onKeyDown={roving.onKeyDown}>
      {rows.map((r, i) => {
        const why = states[i] as WhyState;
        const isOff = why.state === 'off';
        return (
          <button
            key={r.name}
            type="button"
            class={`btn${isOff ? ' is-faded' : ''}`}
            disabled={isOff}
            aria-label={r.name}
            title={why.state === 'off' ? why.why : r.title}
            tabIndex={roving.tabIndex(i)}
            ref={roving.itemRef(i)}
            onFocus={() => roving.onFocus(i)}
            onClick={r.run}
          >
            {r.label}
          </button>
        );
      })}
      <span class="cv-zoom-pct">{zoomLabel(at)}</span>
    </div>
  );
}

export interface CanvasSlotProps {
  /** False draws a static picture: no focus stops, no pointer handlers. */
  interactive?: boolean;
}

export function CanvasSlot({ interactive = true }: CanvasSlotProps) {
  const graph = redoGraph.value;
  const geo = geometry.value;
  const editable = interactive && canEdit(viewport.value);
  const keys = selection.value;
  const m = mode.value;
  /* The zoom ladder is offered in Build and Break only: Configure's stage is a
     180 px strip with no room to scroll into, and Learn's drawing lives in the
     rail. Where it is not offered the drawing is drawn at its own size, so a
     rung left over from Build cannot strand a drawing with no control to undo
     it. It does not ask `canEdit` -- looking closer at a read-only drawing is
     still looking. */
  const zooming = interactive && (m === 'build' || m === 'break');
  const zoomFactor = zooming ? zoom.value : 1;
  const [wrapRef, scale] = useCanvasScale(zoomFactor);
  const anchored = barOpen.value;

  /* The bar closes rather than moves. A selection that no longer holds the key
     it hangs under, or a change of mode, makes every row on it an answer to a
     question nobody asked -- and a menu that re-anchors itself under whatever
     was clicked next is a menu the reader has to re-read every time. */
  useEffect(() => {
    const key = barOpen.peek();
    /* Read live, not out of the closure: preact flushes a pending effect at
       the start of the next commit, so the effect queued by the render
       *before* the click can run after it -- with the selection the click has
       already replaced. Closing the bar off that stale list shut it on the
       way in, which is a menu that opens and vanishes. */
    if (key !== null && !selection.peek().includes(key)) closeBar();
  }, [keys.join('\u0000')]);
  /* On a *change* of mode, not on the mount: preact flushes effects after the
     paint, so a mount effect that closes the bar can land after the click that
     opened it and shut a bar the reader had just asked for. */
  const wasMode = useRef(m);
  useEffect(() => {
    if (wasMode.current === m) return;
    wasMode.current = m;
    closeBar();
  }, [m]);

  const built = !editable || anchored === null || keys.length === 0
    ? null
    : m === 'break'
      ? breakBar(topology.value, keys, snapT(tNow.value))
      : m === 'build'
        ? { actions: buildBar(topology.value, keys), quiet: null }
        : null;
  const bar = built === null || anchored === null
    || (built.actions.length === 0 && built.quiet === null)
    ? null
    : {
      key: anchored,
      actions: built.actions,
      quiet: built.quiet,
      focus: barFocus.value,
      moreWhere: railWhere(viewport.value),
      /* Break's stage is the short one (fit-content, the timeline takes the
         rest), and its rail already carries the whole list at the head. */
      ...(m === 'break' ? { maxRows: MAX_ROWS_BREAK } : {}),
    };
  /* Build's additions, in the corner of the stage: the reader looking at the
     drawing should not have to find the rail -- or clear a selection -- to add
     a standby. It is the inspector's own table of actions (inspector/adds), so
     a label and a refusal are the same on both surfaces. Absent where the page
     is read-only, and absent in Break, Configure and Learn, which do not add.
     It is drawn before the drawing so the tab order reaches it first and so
     canvas.css can give the drawing room for it without a `:has()`. */
  const adds = editable && m === 'build'
    ? <AddToolbar doc={topology.value} />
    : null;
  /* The zoom ladder rides in the same row as Build's additions. */
  const toolbar = adds === null && !zooming ? null : (
    <div class="cv-tools">
      {adds}
      {zooming ? <ZoomStrip /> : null}
    </div>
  );
  if (graph === null) {
    return (
      <>
        {toolbar}
        <div class="empty">
          <span class="empty-k">Canvas</span>
          <p>
            No member carries the primary role, so there is no redo to draw. Give one
            database <span class="mono">role: primary</span> and the drawing comes back.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      {toolbar}
      <TopoCanvas
        doc={topology.value}
        graph={graph}
        {...(geo ? { geometry: geo } : {})}
        frame={mode.value === 'break' ? frame.value : null}
        overrides={doc.value.layout}
        selection={selection.value}
        hovered={hovered.value}
        interactive={editable}
        /* Why it is read-only is said once, on the stage card above (App.tsx);
           the drawing says only that it is. */
        readOnlyWhy={interactive
          ? 'This drawing is a read-only view here.'
          : 'This drawing is a live view of the configuration; the workbench beside it is where it is edited.'}
        wrapRef={wrapRef}
        scale={scale}
        zoomFactor={zoomFactor}
        {...(zooming ? { onZoomStep: (dir: 1 | -1): void => zoomBy(dir) } : {})}
        {...(bar === null ? {} : { bar })}
        /* A plain click selects *and* offers: the reader who clicked a card
           has already said which object they mean, and making them find the
           rail to act on it is the trip this bar exists to save. It does not
           take the focus -- the arrows have to keep walking the drawing. */
        onSelect={(key: string, additive: boolean) => {
          select(key, additive);
          if (editable && !additive) openBar(key);
        }}
        onHover={(key: string | null) => { hovered.value = key; }}
        onClear={() => { closeBar(); clearSelection(); }}
        onCloseBar={() => closeBar()}
        /* The context menu is a keyboard-shaped request -- `Shift+F10` is
           literally one -- so this one does move the focus into the bar. */
        {...(editable
          ? {
            onContextMenu: (key: string): void => { select(key); openBar(key, true); },
          }
          : {})}
        {...(editable && mode.value === 'build'
          ? {
            /* A double-click means "rename it": the rail opens on the subject
               and its name field takes the caret (a one-shot request the
               `Text` control reads and clears). */
            onOpen: (key: string): void => {
              openInspectorFor(key);
              focusField.value = `name:${key}`;
            },
          }
          : {})}
        /* Break: a click on a card, and `E` on a focused one, open the menu of
           what can be done to it. The menu has a fixed home (rail head on a wide
           screen, under the drawing otherwise), so this opens it rather than
           positioning it -- `style-src 'self'` forbids positioning anything from
           script anyway. */
        {...(editable && mode.value === 'break'
          ? { onEventMenu: (): void => { menuOpen.value = true; } }
          : {})}
        {...(editable && mode.value === 'build'
          ? { onDelete: (key: string): void => deleteFromCanvas(key) }
          : {})}
        onDrag={(key: string, offset: { dx: number; dy: number }) => {
          edit(`Move the ${key} card`, (d) => withLayout(d, key, offset), `drag:${key}`);
        }}
        onDragEnd={() => breakCoalescing()}
      />
    </>
  );
}
