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
import { siteId } from '@/engine';
import { frame, geometry, redoGraph, topology } from '@/state/derived';
import { doc, withLayout } from '@/state/doc';
import { breakCoalescing, edit, undo } from '@/state/history';
import {
  canEdit, clearSelection, focusField, hovered, mode, railWhere, select, selection, tNow, toast,
  viewport,
} from '@/state/view';
import { buildActionsFor, openInspectorFor, removeAction } from '../build/actions';
import {
  addDatabase, addFsfoTarget, addLink, connectVerdict, moveToSite, renameMember, renameObserver,
  renameSite, renameVerdict, shipRedo, tidyLayout,
} from '../inspector/edits';
import { placeOver, renaming, setSiteAt } from './place';
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
/**
 * A line drawn from one card to another, in Build mode.
 *
 * Member to member is redo: the source ships to the target. Member to
 * observer, in either direction, is fast-start failover: the member becomes
 * a target the observer watches. Two observers have nothing between them
 * that the drawing could draw, and the page says so rather than doing nothing.
 */
export function connectFromCanvas(from: string, to: string): void {
  const t = topology.value;
  const verdict = connectVerdict(t, from, to);
  if (verdict.enabled.state === 'off') {
    toast.value = { kind: 'info', text: verdict.enabled.why };
    return;
  }
  const member = (k: string) => t.members.find((m) => (m.id as string) === k);
  const observer = (k: string) => t.observers.find((o) => (o.id as string) === k);
  const isSite = (k: string): boolean => t.sites.some((x) => (x.id as string) === k);
  /* A line from one data centre's name to another's: the site link between them. */
  if (isSite(from) && isSite(to)) { addLink(siteId(from), siteId(to)); return; }
  const a = member(from); const b = member(to);
  if (a && b) { shipRedo(a.id, b.id); return; }
  if (a && observer(to)) { addFsfoTarget(a.id); return; }
  if (observer(from) && b) { addFsfoTarget(b.id); return; }
  /* A line dropped on a data centre's panel: a new standby there, fed by
     the card the line came from. Two edits, two undos, each named. */
  if (a && t.sites.some((s) => (s.id as string) === to)) {
    const id = addDatabase(siteId(to));
    if (id !== null) shipRedo(a.id, id);
  }
}

export function deleteFromCanvas(key: string): void {
  /* `Delete` on one of several selected things means all of them -- a
     selection that answers a drag as a group and `Delete` as one card is two
     stories about the same highlight. Each is asked separately: what may go
     goes, what may not is named with its reason. */
  const sel = selection.value;
  const keys = sel.includes(key) && sel.length > 1 ? [...sel] : [key];
  const gone: string[] = [];
  const kept: string[] = [];
  for (const k of keys) {
    /* Against the document as it now is: removing one can change whether the
       next may go. */
    const action = removeAction(topology.value, k);
    if (action === null) continue;
    if (action.enabled.state === 'off') { kept.push(`${k} stays: ${action.enabled.why}`); continue; }
    action.run();
    gone.push(k);
  }
  if (gone.length > 0) selection.value = selection.value.filter((k) => !gone.includes(k));
  if (kept.length > 0) {
    toast.value = { kind: 'warn', text: kept.join(' ') };
    return;
  }
  if (gone.length === 0) return;
  const n = gone.length;
  toast.value = {
    kind: 'info',
    text: `Removed ${gone.join(', ')}.`,
    action: { label: 'Undo', run: () => { for (let i = 0; i < n; i++) undo(); } },
  };
}

/** The name as the drawing shows it, for the field that edits it. */
function nameOf(t: TopologyDoc, key: string): string {
  return t.sites.find((x) => (x.id as string) === key)?.name ?? key;
}

/** What can be renamed on the drawing: a member, an observer, a data centre. */
const canRename = (t: TopologyDoc, key: string): boolean =>
  t.members.some((m) => (m.id as string) === key)
  || t.observers.some((o) => (o.id as string) === key)
  || t.sites.some((x) => (x.id as string) === key);

function commitRename(key: string, raw: string): void {
  const t = topology.value;
  const m = t.members.find((x) => (x.id as string) === key);
  const o = t.observers.find((x) => (x.id as string) === key);
  renaming.value = null;
  if (m) renameMember(m.id, raw);
  else if (o) renameObserver(o.id, raw);
  else renameSite(siteId(key), raw);
  /* The field took the focus and is gone: hand it to the thing it named, under
     the name it now has, once that has been drawn. */
  const now = m || o ? raw.trim() : key;
  setTimeout(() => {
    for (const el of document.querySelectorAll<SVGGElement>('.topo-svg [data-node]')) {
      if (el.getAttribute('data-node') === now && !el.hasAttribute('data-more')) { el.focus(); return; }
    }
  }, 0);
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
export const WHY_TIDY = 'No card has been moved by hand, so there is nothing to tidy.';

function ZoomStrip({ tidy }: { tidy: boolean }) {
  const at = zoom.value;
  const moved = Object.keys(doc.value.layout);
  const picked = selection.value.filter((k) => moved.includes(k));
  const out = canZoom(-1);
  const inn = canZoom(1);
  const states: WhyState[] = [
    out ? ON : { state: 'off', why: WHY_MIN },
    inn ? ON : { state: 'off', why: WHY_MAX },
    { state: 'on' },
    ...(tidy ? [moved.length === 0 ? { state: 'off' as const, why: WHY_TIDY } : ON] : []),
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
    ...(tidy
      ? [{
        label: 'Tidy',
        name: 'Tidy the drawing',
        title: picked.length > 0
          ? 'Put the selected cards back where the layout draws them.'
          : 'Put every card moved by hand back where the layout draws it.',
        run: () => tidyLayout(picked),
      }]
      : []),
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
  /* A press anywhere that is not the bar closes it -- the rail, the header,
     the ground outside the drawing, the panels below it. On the drawing a
     press on an entity is left to its own click, which re-offers the bar on
     that entity; anything else is "never mind". Registered on the document
     in the capture phase, so no surface has to know the bar exists. */
  useEffect(() => {
    if (anchored === null) return;
    const onPress = (ev: PointerEvent): void => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.tp-actions') !== null || t.closest('[data-node]') !== null) return;
      closeBar();
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [anchored]);

  const building = editable && m === 'build';
  /* A name field whose subject has gone -- an undo, a removal, a change of
     mode -- has nothing to rename. */
  const renameKey = renaming.value;
  const renameLive = building && renameKey !== null && canRename(topology.value, renameKey);
  useEffect(() => {
    if (renameKey !== null && !renameLive) renaming.value = null;
  }, [renameKey, renameLive]);
  useEffect(() => () => setSiteAt(null), []);

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
      {zooming ? <ZoomStrip tidy={editable && m === 'build'} /> : null}
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
        onSelect={(key: string, additive: boolean) => {
          select(key, additive);
          /* Build: a click selects and nothing else -- the rail shows the form,
             and the bar is asked for (the handle, the right button, Shift+F10).
             A menu that opens under every click is in the way of the drag and
             the line that usually follow one. Break still offers on the click:
             there the list of events *is* what the click is for. */
          if (editable && !additive && m === 'break') openBar(key);
          /* A bar about something else closes now, not when an effect gets
             round to it: it must not outlive the selection it answered. */
          else if (barOpen.peek() !== null && barOpen.peek() !== key) closeBar();
        }}
        {...(editable
          ? { handle: keys.length === 0 ? null : keys[keys.length - 1] as string }
          : {})}
        {...(building
          ? {
            onSelectMany: (hit: readonly string[], additive: boolean): void => {
              closeBar();
              selection.value = additive
                ? [...selection.value, ...hit.filter((k) => !selection.value.includes(k))]
                : [...hit];
            },
            onNudge: (ids: readonly string[], dx: number, dy: number): void => {
              edit(
                ids.length === 1 ? `Move the ${ids[0] as string} card` : `Move ${ids.length} cards`,
                (d) => ids.reduce((acc, k) => {
                  const base = acc.layout[k] ?? { dx: 0, dy: 0 };
                  return withLayout(acc, k, { dx: base.dx + dx, dy: base.dy + dy });
                }, d),
                `nudge:${ids.join(',')}`,
              );
            },
            dropHint: placeOver.value,
            siteAtRef: setSiteAt,
            rename: renameLive && renameKey !== null
              ? {
                key: renameKey,
                initial: nameOf(topology.value, renameKey),
                verdict: (raw: string) => renameVerdict(topology.value, renameKey, raw),
                commit: (raw: string) => commitRename(renameKey, raw),
                cancel: () => { renaming.value = null; },
              }
              : null,
          }
          : {})}
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
              /* A link has no name of its own to edit; its form does. */
              if (canRename(topology.value, key)) { closeBar(); select(key); renaming.value = key; return; }
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
          ? {
            onDelete: (key: string): void => deleteFromCanvas(key),
            /* A card dropped in another data centre moves there -- hosts and
               all, one undo with the drag that carried it. */
            onMoveToSite: (key: string, site: string): void => moveToSite(key, siteId(site)),
            onConnect: connectFromCanvas,
            connectWhat: (from: string, to: string) => connectVerdict(topology.value, from, to),
          }
          : {})}
        onDrag={(
          key: string, _offset: { dx: number; dy: number },
          all: Readonly<Record<string, { dx: number; dy: number }>>,
        ) => {
          /* Every card the drag carries, in one edit under the pressed card's
             key -- which is the key `moveToSite` coalesces into. */
          const ids = Object.keys(all);
          edit(
            ids.length === 1 ? `Move the ${key} card` : `Move ${ids.length} cards`,
            (d) => ids.reduce((acc, k) => withLayout(acc, k, all[k] as { dx: number; dy: number }), d),
            `drag:${key}`,
          );
        }}
        onDragEnd={() => breakCoalescing()}
      />
    </>
  );
}
