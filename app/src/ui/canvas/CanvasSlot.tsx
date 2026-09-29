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

import type { JSX } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { TopologyDoc } from '@/engine';
import { hostId, siteId } from '@/engine';
import { frame, geometry, redoGraph, topology } from '@/state/derived';
import { doc, withLayout, withSiteOrder } from '@/state/doc';
import { breakCoalescing, edit, undo, undoLabel } from '@/state/history';
import { toggleGrid } from '@/state/persist';
import {
  breakLayout, canEdit, clearSelection, floating, focusField, gridOn, hovered, mode, railWhere, select, selection, tNow,
  toast, viewport,
} from '@/state/view';
import { buildActionsFor, openInspectorFor, removeAction } from '../build/actions';
import { resolveRoute, routeWord } from '../build/routes';
import {
  addDatabase, addFsfoTarget, addLink, connectVerdict, mergeIntoHost, moveToSite,
  renameApplication, renameMember, renameObserver, renameSite, renameVerdict, setAddressListed,
  shipRedo, tidyLayout,
} from '../inspector/edits';
import { inFlight, inFlightFrom, placeOver, renaming, setSiteAt } from './place';
import { mergeVerdict } from './drop';
import { hoverTools, snapT } from '../break/events';
import { breakBar } from '../break/menu';
import { AddToolbar } from '../inspector/adds';
import type { WhyState } from '../common/WhyPill';
import { useRovingToolbar } from '../common/useRovingToolbar';
import { ON } from '../inspector/why';
import type { BarAction, BarSection } from './ActionBar';
import { barFocus, barOpen, closeBar, openBar } from './bar';
import { marginAround, unobscured } from './anchor';
import type { Rect } from './measure';
import { resizedBox, TopoCanvas } from './TopoCanvas';
import { isElement, PopIcon, popIn, popOut, popped, useHostWindow } from '../common/popout';
import {
  autoFactor, canZoom, FIT_ZOOM, fitZoom, WHY_MAX, WHY_MIN, zoom, zoomAuto, zoomBy, zoomLabel,
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
  /* The application and a database: the database joins its ADDRESS_LIST. */
  const app = t.application?.id as string | undefined;
  if (app !== undefined && (from === app || to === app)) {
    const m = from === app ? b : a;
    if (m) setAddressListed(m.id, true);
    return;
  }
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

/** What can be renamed on the drawing: a member, an observer, the application, a data centre. */
const canRename = (t: TopologyDoc, key: string): boolean =>
  t.members.some((m) => (m.id as string) === key)
  || t.observers.some((o) => (o.id as string) === key)
  || (t.application?.id as string | undefined) === key
  || t.sites.some((x) => (x.id as string) === key);

function commitRename(key: string, raw: string, where: Document = document): void {
  const t = topology.value;
  const m = t.members.find((x) => (x.id as string) === key);
  const o = t.observers.find((x) => (x.id as string) === key);
  renaming.value = null;
  const isApp = (t.application?.id as string | undefined) === key;
  if (m) renameMember(m.id, raw);
  else if (o) renameObserver(o.id, raw);
  else if (isApp) renameApplication(raw);
  else renameSite(siteId(key), raw);
  /* The field took the focus and is gone: hand it to the thing it named, under
     the name it now has, once that has been drawn. */
  const now = m || o || isApp ? raw.trim() : key;
  setTimeout(() => {
    for (const el of where.querySelectorAll<SVGGElement>('.topo-svg [data-node]')) {
      if (el.getAttribute('data-node') === now && !el.hasAttribute('data-more') && !el.hasAttribute('data-tools')) {
        el.focus();
        return;
      }
    }
  }, 0);
}

/**
 * Build's table as bar rows.
 *
 * The order is the table's own -- `Edit` first, the properties between,
 * `Remove` last -- and it is load-bearing rather than cosmetic: the bar shows
 * the first seven rows and says the rest are in the rail, so what gets dropped
 * has to be the least destructive thing on the list, never the way out.
 * A link's rows include the removal of each drawn line riding it
 * (`removeRouteAction`), between its properties and its own Remove.
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
type Margin = { t: number; r: number; b: number; l: number };
const NO_MARGIN: Margin = { t: 0, r: 0, b: 0, l: 0 };

const rectOf = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });

/**
 * What floats over the stage: the top bar, the palette, the rail, the zoom
 * pill and the timeline dock. In the docked layout they sit beside the
 * drawing rather than over it and none of them overlaps the wrap, so asking
 * costs nothing there.
 */
const CHROME = '.app-head, .app-rail, .app-dock, .palette, .zoom-pill';

/**
 * The ground the action bar may use, in CSS pixels: the wrap's *content*
 * box, less whatever chrome still reaches into it, inside the window.
 *
 * Not the wrap's border box. In the floating layout the wrap is the whole
 * window and its padding is exactly what keeps the drawing clear of the
 * chrome over it (float.css, `--pal-r`, `--dock-h`);
 * measuring from the border box handed the bar the ground *under* the rail,
 * and a bar placed beside a standby at the right edge was painted beneath it.
 * `clientWidth`/`clientHeight` leave a zoomed wrap's scrollbars out.
 */
function freeGround(wrap: HTMLElement): Rect {
  const view = wrap.ownerDocument.defaultView;
  const cs = view?.getComputedStyle(wrap);
  const px = (v: string | undefined): number => Number.parseFloat(v ?? '') || 0;
  const outer = wrap.getBoundingClientRect();
  const x = outer.left + wrap.clientLeft + px(cs?.paddingLeft);
  const y = outer.top + wrap.clientTop + px(cs?.paddingTop);
  /* jsdom lays nothing out: no client box, so the border box stands in. */
  const cw = wrap.clientWidth > 0 ? wrap.clientWidth : outer.width;
  const ch = wrap.clientHeight > 0 ? wrap.clientHeight : outer.height;
  const content: Rect = {
    x, y,
    w: Math.max(0, cw - px(cs?.paddingLeft) - px(cs?.paddingRight)),
    h: Math.max(0, ch - px(cs?.paddingTop) - px(cs?.paddingBottom)),
  };
  const win = view === null || view === undefined ? content : unobscured(content, [
    /* The window's own edges, as four slabs: nothing outside it is seen. */
    { x: -1e5, y: -1e5, w: 2e5, h: 1e5 },
    { x: -1e5, y: view.innerHeight, w: 2e5, h: 1e5 },
    { x: -1e5, y: -1e5, w: 1e5, h: 2e5 },
    { x: view.innerWidth, y: -1e5, w: 1e5, h: 2e5 },
  ]);
  const app = wrap.closest('.app') ?? wrap.ownerDocument;
  const chrome = [...app.querySelectorAll(CHROME)]
    .filter((el) => !el.contains(wrap) && view?.getComputedStyle(el).visibility !== 'hidden')
    .map((el) => rectOf(el.getBoundingClientRect()))
    .filter((r) => r.w > 0 && r.h > 0);
  return unobscured(win, chrome);
}

/**
 * The room the drawing has, as the wrap's content box: the wrap is the whole
 * window in the floating layout and its padding is what keeps the drawing
 * clear of the chrome over it, so the padding is not room. Zero where nothing
 * is laid out (jsdom), which `autoFactor` reads as "no room to fit".
 */
function wrapRoom(wrap: HTMLElement): { w: number; h: number } {
  const cs = wrap.ownerDocument.defaultView?.getComputedStyle(wrap);
  const px = (v: string | undefined): number => Number.parseFloat(v ?? '') || 0;
  return {
    w: wrap.clientWidth - px(cs?.paddingLeft) - px(cs?.paddingRight),
    h: wrap.clientHeight - px(cs?.paddingTop) - px(cs?.paddingBottom),
  };
}

/**
 * `fit` is true where the layout sizes the drawing by its region (Break's
 * Split): the factor the room allows is written to `zoom` on entering, on every
 * resize of the room -- the window's, and the divider's, which moves the wrap's
 * bottom padding -- and whenever the drawing itself changes size, until the
 * reader zooms (`zoomAuto`). Leaving the layout with the room still in charge
 * gives the drawing back at its own size.
 */
function useCanvasScale(
  zoomFactor: number,
  fit: boolean,
): [(el: HTMLElement | null) => void, number, Margin] {
  const [scale, setScale] = useState(1);
  const fitting = useRef(fit);
  fitting.current = fit;
  /* The free ground around the drawing, in user units: where the bar may hang
     (anchor.ts `barRoom`). Negative where the visible ground stops inside the
     drawing -- a zoomed drawing scrolled under the chrome. */
  const [margin, setMargin] = useState<Margin>(NO_MARGIN);
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
    const wrap = host.current as HTMLElement;
    /* The room decides the size while the reader has not: the natural size is
       the viewBox, whatever it is drawn at now. */
    if (fitting.current && zoomAuto.peek() && declared > 0 && wrap.clientWidth > 0) {
      const f = autoFactor({ w: declared, h: Number(box?.[3]) }, wrapRoom(wrap));
      if (zoom.peek() !== f) zoom.value = f;
    }
    if (!(declared > 0) || !(painted > 0)) return;
    const k = Math.min(1, Math.max(0.5, Math.round((painted / declared) * 100) / 100));
    setScale((prev) => (prev === k ? prev : k));
    /* User units per CSS pixel, unclamped: this converts, it does not compensate. */
    const u = declared / painted;
    const next = marginAround(rectOf(svg.getBoundingClientRect()), freeGround(wrap), u);
    setMargin((prev) => (prev.t === next.t && prev.r === next.r && prev.b === next.b && prev.l === next.l
      ? prev : next));
  }, []);
  const unlisten = useRef<(() => void) | null>(null);
  useEffect(() => () => { observer.current?.disconnect(); unlisten.current?.(); }, []);
  /* A zoom does not resize the wrap -- the wrap is the scroll port and keeps
     the room the stage gave it, the drawing inside it grows -- so the observer
     never fires on one and the measurement would be a rung out of date. This
     is that missing edge. */
  useEffect(() => { read(); }, [zoomFactor, read]);
  /* Entering a layout that sizes the drawing by its room hands the size back
     to the room, whatever the reader did before; leaving it returns the
     drawing to its own size if the room was still deciding. */
  const wasFit = useRef(false);
  useLayoutEffect(() => {
    if (fit && !wasFit.current) zoomAuto.value = true;
    if (!fit && wasFit.current && zoomAuto.peek() && zoom.peek() !== FIT_ZOOM) zoom.value = FIT_ZOOM;
    wasFit.current = fit;
    read();
  }, [fit, read]);
  /* Nor does an edit: a new data centre widens the drawing inside a wrap of
     the same size, and the ground around it shrinks. Every render, then --
     both setters bail out when nothing moved. */
  useLayoutEffect(() => { read(); });
  const ref = useCallback((el: HTMLElement | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    unlisten.current?.();
    unlisten.current = null;
    host.current = el;
    if (!el) return;
    read();
    /* A zoomed drawing scrolls inside the wrap, and what of it is visible --
       the ground the bar may use -- moves with it. Read only while a bar is
       open: nothing else uses the margin, and a re-render per scrolled pixel
       for nobody is waste. */
    const onScroll = (): void => { if (barOpen.peek() !== null) read(); };
    el.addEventListener('scroll', onScroll, { passive: true });
    unlisten.current = () => el.removeEventListener('scroll', onScroll);
    /* The observer of the window the drawing is in: it may be a popup
       (common/popout.tsx). */
    const RO = el.ownerDocument.defaultView?.ResizeObserver
      ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
    if (RO === undefined) return;
    const ro = new RO(read);
    ro.observe(el);
    observer.current = ro;
  }, [read]);
  return [ref, scale, margin];
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
export const WHY_TIDY = 'No card has been moved and no data centre resized by hand, so there is nothing to tidy.';

function ZoomStrip({ tidy, grid = false, pop = false }: { tidy: boolean; grid?: boolean; pop?: boolean }) {
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
    ...(grid ? [ON] : []),
    ...(pop ? [ON] : []),
  ];
  const roving = useRovingToolbar(states.map((w) => w.state !== 'off'));
  const rows: {
    label: string | JSX.Element; name: string; title: string; run: () => void; pressed?: boolean;
    cls?: string;
  }[] = [
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
      title: 'Back to the drawing at its own size, or at the size its room allows.',
      run: () => fitZoom(),
    },
    ...(tidy
      ? [{
        label: 'Tidy',
        name: 'Tidy the drawing',
        title: picked.length > 0
          ? 'Put the selected cards back where the layout draws them.'
          : 'Put every card moved by hand back where the layout draws it, and every resized data centre back to its own size.',
        run: () => tidyLayout(picked),
      }]
      : []),
    ...(grid
      ? [{
        label: <DotsIcon />,
        name: 'Dotted background',
        title: gridOn.value ? 'Hide the dotted background.' : 'Show the dotted background.',
        run: toggleGrid,
        pressed: gridOn.value,
      }]
      : []),
    ...(pop
      ? [{
        label: <PopIcon out={popped.value.canvas !== undefined} />,
        name: 'Open the drawing in a new window',
        title: popped.value.canvas !== undefined
          ? 'Bring the drawing back into the main window.'
          : 'Open the drawing in a new window you can drag to another screen.',
        run: () => { if (popped.value.canvas !== undefined) popIn('canvas'); else popOut('canvas'); },
        pressed: popped.value.canvas !== undefined,
        cls: 'po-btn',
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
            class={`btn${isOff ? ' is-faded' : ''}${r.cls === undefined ? '' : ` ${r.cls}`}`}
            disabled={isOff}
            aria-label={r.name}
            aria-pressed={r.pressed}
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

/** Nine dots: the toggle for the canvas's dotted ground. */
function DotsIcon() {
  return (
    <svg class="cv-dots-ico" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {[2, 6, 10].flatMap((y) => [2, 6, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />))}
    </svg>
  );
}

/**
 * Tidy, on its own, for the floating palette: the same act, the same refusal
 * in its title, as the zoom strip's `Tidy` in the docked layout.
 */
function TidyButton() {
  const moved = Object.keys(doc.value.layout);
  const picked = selection.value.filter((k) => moved.includes(k));
  const off = moved.length === 0;
  return (
    <div class="pal-tidy">
      <button
        type="button"
        class={`btn pal-btn${off ? ' is-faded' : ''}`}
        disabled={off}
        aria-label="Tidy the drawing"
        title={off
          ? WHY_TIDY
          : picked.length > 0
            ? 'Put the selected cards back where the layout draws them.'
            : 'Put every card moved by hand back where the layout draws it, and every resized data centre back to its own size.'}
        onClick={() => tidyLayout(picked)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 5.5V2.5h3M13.5 5.5V2.5h-3M2.5 10.5v3h3M13.5 10.5v3h-3" />
          <rect x="5.5" y="5.5" width="5" height="5" rx="1" />
        </svg>
        <span class="pal-lbl">Tidy</span>
      </button>
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
  /* Break's Split draws the drawing in a region of its own, and fills it. */
  const fits = zooming && m === 'break' && floating(m, viewport.value) && breakLayout.value === 'split';
  const [wrapRef, scale, barMargin] = useCanvasScale(zoomFactor, fits);
  const host = useHostWindow();
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
      if (!isElement(t)) return;
      if (t.closest('.tp-actions') !== null || t.closest('[data-node]') !== null) return;
      closeBar();
    };
    /* The drawing's own document: it may be in a popup (common/popout.tsx). */
    const where = host?.document ?? document;
    where.addEventListener('pointerdown', onPress, true);
    return () => where.removeEventListener('pointerdown', onPress, true);
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

  const at = snapT(tNow.value);
  /* What the bar would offer for the selection, open or not: the handle is
     drawn only over a selection that has something to offer, so it is never
     a button that opens nothing. */
  const offered: { actions: BarAction[]; quiet: string | null; sections?: BarSection[] } | null
    = !editable || keys.length === 0
      ? null
      : m === 'break'
        ? breakBar(topology.value, keys, at)
        : m === 'build'
          ? { actions: buildBar(topology.value, keys), quiet: null }
          : null;
  const offers = offered !== null && (offered.actions.length > 0 || offered.quiet !== null);
  const built = anchored === null ? null : offered;
  const bar = built === null || anchored === null || !offers
    ? null
    : {
      key: anchored,
      actions: built.actions,
      quiet: built.quiet,
      focus: barFocus.value,
      moreWhere: railWhere(viewport.value),
      /* Break: the whole list, grouped, under a header that says when it
         lands -- the same snapped playhead the rail's clock reading shows. */
      ...(built.sections === undefined ? {} : { sections: built.sections, when: `at t = ${at} s` }),
      /* A drawn line's key is plumbing: the header says what the line is. */
      ...(() => {
        const r = resolveRoute(topology.value, anchored);
        return r === null ? {} : { title: `${routeWord(r)} ${r.from} → ${r.to}` };
      })(),
      /* Build's table ends in Remove: the cap drops rows before it, never it. */
      ...(m === 'build' ? { keepLast: true } : {}),
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
  /* Over a full-bleed canvas (App.tsx, `floating`) the additions and Tidy
     are a palette at the left edge and the zoom ladder a pill at the bottom
     right; both float over the drawing rather than taking a row above it.
     Docked, the zoom ladder rides in the same row as Build's additions. */
  const float = interactive && floating(m, viewport.value);
  const toolbar = float
    ? (
      <>
        {adds === null ? null : (
          <nav class="palette pal-add float-card" aria-label="Tools">
            {adds}
            <TidyButton />
          </nav>
        )}
        {zooming ? <div class="zoom-pill float-card"><ZoomStrip tidy={false} grid pop /></div> : null}
      </>
    )
    : adds === null && !zooming ? null : (
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
            No database has the primary role, so there is no redo to draw. Give one
            database <span class="mono">role: primary</span> to show the redo routes.
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
        barMargin={barMargin}
        zoomFactor={zoomFactor}
        fitted={fits && zoomAuto.value}
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
          ? { handle: !offers ? null : keys[keys.length - 1] as string }
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
                commit: (raw: string) => commitRename(renameKey, raw, host?.document),
                cancel: () => { renaming.value = null; },
              }
              : null,
          }
          : {})}
        onHover={(key: string | null) => { hovered.value = key; }}
        {...(editable && m === 'break'
          ? {
            tools: (key: string) => hoverTools(topology.value, key, snapT(tNow.value)),
            toolsWhen: `at t = ${at} s`,
          }
          : {})}
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
        /* Break: `E` on a focused card opens the bar of what can be done to it,
           and takes the focus into it -- the same bar `Shift+F10` opens, and the
           one a click already opened (`onSelect`, above). */
        {...(editable && mode.value === 'break'
          ? { onEvents: (key: string): void => { select(key); openBar(key, true); } }
          : {})}
        {...(editable && mode.value === 'build'
          ? {
            onDelete: (key: string): void => deleteFromCanvas(key),
            /* A card dropped in another data centre moves there -- hosts and
               all, one undo with the drag that carried it. */
            onMoveToSite: (key: string, site: string): void => moveToSite(key, siteId(site)),
            /* A card dropped on another host's card or stack merges into it --
               same host, hosts and all, one undo with the drag. */
            onMergeIntoHost: (key: string, host: string): void => mergeIntoHost(key, hostId(host)),
            /* ...unless the placement rule refuses it: an observer never
               shares a host with a database. */
            mergeWhat: (key: string, host: string) => mergeVerdict(topology.value, key, host),
            onConnect: connectFromCanvas,
            connectWhat: (from: string, to: string) => connectVerdict(topology.value, from, to),
            /* A data centre's handles: its box, a sized override under its
               own key -- one undo for the whole gesture. */
            onResizeSite: (site: string, box: { dx: number; dy: number; w?: number; h?: number }): void => {
              const name = topology.value.sites.find((s) => (s.id as string) === site)?.name ?? site;
              edit(`Resize the ${name} data centre`, (d) => withLayout(d, site, box), `resize:${site}`);
            },
            onResizeEnd: () => breakCoalescing(),
            onResizeBy: (site: string, dx: number, dy: number): void => {
              /* Read live, not from the render: a second press before the
                 repaint must grow from where the first one left the box. */
              const st = geometry.value?.sites.find((s) => (s.id as string) === site);
              if (!st) return;
              const box = resizedBox(
                { start: st, fit: st.fit, anchor: st.anchor, empty: st.empty },
                { l: false, r: true, t: false, b: true }, dx, dy,
              );
              edit(`Resize the ${st.name} data centre`, (d) => withLayout(d, site, box), `resize:${site}`);
            },
          }
          : {})}
        /* A card let go inside its own data centre: the boxes it would have
           shrunk keep their size, in the drag's own edit (`drag:${key}`), so
           the move and the kept size undo as one. */
        onHoldSites={(key: string, boxes: Readonly<Record<string, { dx: number; dy: number; w?: number; h?: number }>>) => {
          /* The drag's own label: the kept boxes are part of that move, not a
             second thing the reader did. */
          edit(
            undoLabel.peek() ?? `Move the ${key} card`,
            (d) => Object.entries(boxes).reduce((acc, [id, box]) => withLayout(acc, id, box), d),
            `drag:${key}`,
          );
        }}
        /* A data centre dragged past a neighbour: the new column order and the
           carried cards settled into it, in the drag's own edit. */
        onReorderSites={(
          key: string, order: readonly string[],
          offsets: Readonly<Record<string, { dx: number; dy: number; w?: number; h?: number }>>,
        ) => {
          edit(
            undoLabel.peek() ?? `Move the ${key} data centre`,
            (d) => withSiteOrder(
              Object.entries(offsets).reduce((acc, [k, o]) => withLayout(acc, k, o), d), order,
            ),
            `drag:${key}`,
          );
        }}
        onDrag={(
          key: string, _offset: { dx: number; dy: number },
          all: Readonly<Record<string, { dx: number; dy: number }>>,
        ) => {
          /* Every card the drag carries, in one edit under the pressed card's
             key -- which is the key `moveToSite` coalesces into. A data
             centre's own key is in the same namespace (`carried()` in
             `TopoCanvas` reaches for it the same way it reaches for a
             selection), and dragging one carries its own members and
             observers along, so the label says "data centre" rather than
             "card" when that is what moved. */
          const ids = Object.keys(all);
          if (inFlight.peek().join('\u0000') !== ids.join('\u0000')) {
            /* Read before this move's own edit: where they stood when picked up. */
            const was = doc.peek().layout;
            inFlightFrom.value = Object.fromEntries(ids.map((k) => [k, was[k] ?? { dx: 0, dy: 0 }]));
            inFlight.value = ids;
          }
          const site = topology.value.sites.find((s) => (s.id as string) === key);
          const label = site
            ? `Move the ${site.name} data centre`
            : ids.length === 1 ? `Move the ${key} card` : `Move ${ids.length} cards`;
          edit(
            label,
            (d) => ids.reduce((acc, k) => withLayout(acc, k, all[k] as { dx: number; dy: number }), d),
            `drag:${key}`,
          );
        }}
        onDragEnd={() => {
          /* Landed: from here on, what it overlaps makes way for it. */
          inFlight.value = [];
          inFlightFrom.value = {};
          breakCoalescing();
        }}
      />
    </>
  );
}
