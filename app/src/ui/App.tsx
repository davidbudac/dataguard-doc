/**
 * The shell (ui.md SS3): two bars, one persistent canvas, a right rail and a
 * bottom dock, arranged by the mode.
 *
 * The canvas never blinks -- switching modes changes what is around it, not
 * what it is. Nothing here is hidden with CSS: a rail that does not fit is not
 * rendered into the grid at all, it is rendered into a drawer, and a mode that
 * is not open is not in the document.
 *
 * Slots other agents own are imported by path and rendered with the props they
 * declare. `TimelineSlot` below is the one adapter the shell keeps: the
 * timeline wants a `Trace` and a measured width, and both are the shell's to
 * supply.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { geometry, trace } from '@/state/derived';
import {
  breakLayout, canEdit, floating, gridOn, inspectorOpen, introOpen, introPage, mode, modeGuide, railCollapsed,
  timelineDefaultH, timelineFull, timelineH, toast, viewport,
} from '@/state/view';
import type { Mode } from '@/state/view';
import { CollectDialog, CollectionNotice } from './import/CollectDialog';
import { TopBar } from './TopBar';
import { DocActions, DocCount, DocPicker } from './StatusBar';
import { FindingsChips, FindingsPopover, FindingToast } from './Findings';
import { Guidance, IntroCard } from './Guidance';
import { usePrintExpand } from './print';
import { installShortcuts } from './shortcuts';
import { Readout } from './Readout';
import { IssuePanel } from './IssuePanel';
import { Sheet } from './common/Sheet';
import { CanvasSlot } from './canvas/CanvasSlot';
import { Inspector } from './inspector/Inspector';
import { BreakRail, ScenarioPalette } from './break/BreakRail';
import { Panels } from './panels/Panels';
import { LearnShell, LearnWorkbenchHeader } from './learn/LearnShell';
import { IntroPage } from './intro/IntroPage';
import { Timeline } from './timeline/Timeline';
import { MiniTimeline } from './timeline/MiniTimeline';
import { shellTimelineProps } from './timeline/shell-props';
import { WorkspacesDialog } from './workspaces/Workspaces';
import { ClassicWalkthrough } from './intro/Walkthrough';
import { ReviewDialog } from './review/ReviewPanel';
import { Popout, PopoutButton, PoppedAway, popped } from './common/popout';
import { RAIL_ID, RailBar, RailStrip } from './RailFrame';
import { useWidth } from './common/use-width';
import { LanesView } from './break/LanesView';
import { SplitDock } from './break/SplitDock';
import { AppTimeline, appTimelineOn, TimelineSwitchRow } from './break/TimelineView';
import { railSnap, useFoldRailWhile } from './break/split-rail';

/** Which modes keep a rail beside the canvas. Learn's right half is the workbench. */
const HAS_RAIL: Record<Mode, boolean> = {
  build: true, break: true, configure: true, learn: true,
};

/* The rail's own name, which is not always the mode's: Topology's is the
   inspector and the Detailed timeline's is its events. */
const RAIL_TITLE: Record<Mode, string> = {
  build: 'Inspector', break: 'Events', configure: 'Inspector', learn: 'Workbench',
};

/**
 * Anchor the toast to the measured bottom of the header.
 *
 * The header is three bands -- modes, document row, guidance -- and every one
 * of them wraps on a narrow window, so their nominal heights are a guess and a
 * toast pinned to that guess paints over the header. This writes the measured
 * value into `--bar-bottom` through `el.style.setProperty` -- the one escape
 * hatch `style-src 'self'` leaves open (ui.md SS1) -- rather than through a
 * style attribute, which the policy would drop. The whole header is one
 * element now, so observing it is enough: the intro card opening inside it
 * moves the bottom without any sibling changing size.
 */
function useBarAnchor(): (el: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (el: HTMLElement | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const write = (): void => {
      const bottom = Math.round(el.getBoundingClientRect().bottom);
      if (bottom > 0) {
        el.ownerDocument.documentElement.style.setProperty('--bar-bottom', `${bottom}px`);
      }
    };
    write();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(write);
    ro.observe(el);
    observer.current = ro;
  };
}

/**
 * Write the floating dock's measured height into `--dock-h`, so the drawing's
 * inset, the zoom pill and the warning card above the dock follow it as it
 * grows -- a Break run with twelve lanes is a much taller panel than Build's
 * one row of readings. Same escape hatch as `--bar-bottom`.
 */
function useDockAnchor(): (el: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (el: HTMLElement | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const write = (): void => {
      /* Full screen is a moment over the drawing, not a new room for it: the
         drawing keeps the fit it had, and has it back on the way out. */
      if (timelineFull.peek()) return;
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) el.ownerDocument.documentElement.style.setProperty('--dock-h', `${h}px`);
    };
    write();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(write);
    ro.observe(el);
    observer.current = ro;
  };
}

/**
 * Measure the chrome floating at the canvas's left side and hand the number to
 * float.css, so the drawing's fit leaves room for what is actually there
 * rather than for a width somebody once read off a screenshot:
 *
 *   `--pal-r`  the right edge of the palettes at the left (Topology's tools
 *              and scenarios, the Detailed timeline's scenarios), from the
 *              window's left edge -- the widest of them
 *
 * Unset when there is no palette, and float.css falls back. The elements
 * belong to other components, so they are found after each render of the
 * shell and observed while they live; same `style.setProperty` escape hatch
 * as `--bar-bottom`, on the root.
 */
function useChromeInsets(): (el: HTMLElement | null) => void {
  const host = useRef<HTMLElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const seen = useRef<readonly Element[]>([]);
  const write = useCallback((): void => {
    const app = host.current;
    if (!app) return;
    const root = app.ownerDocument.documentElement.style;
    let right = 0;
    for (const el of app.querySelectorAll('.palette')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) right = Math.max(right, r.right);
    }
    if (right > 0) root.setProperty('--pal-r', `${Math.round(right)}px`);
    else root.removeProperty('--pal-r');
  }, []);
  /* Re-find the palettes and re-observe them when they have been swapped for
     others (Topology's tools and scenarios and the Detailed timeline's
     scenarios are different elements). */
  const rescan = useCallback((): void => {
    const app = host.current;
    if (!app) return;
    const now = [...app.querySelectorAll('.palette')];
    const same = now.length === seen.current.length && now.every((el, i) => el === seen.current[i]);
    if (!same) {
      seen.current = now;
      observer.current?.disconnect();
      observer.current = null;
      if (now.length > 0 && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(write);
        for (const el of now) ro.observe(el);
        observer.current = ro;
      }
    }
    write();
  }, [write]);
  /* After every render of the shell -- and, since the palettes re-render on
     their own signals without the shell, whenever the stage's children or
     the shell's change (a frame later, once per frame). */
  useLayoutEffect(rescan);
  const mutations = useRef<MutationObserver | null>(null);
  useEffect(() => () => {
    observer.current?.disconnect();
    mutations.current?.disconnect();
  }, []);
  return useCallback((el: HTMLElement | null): void => {
    host.current = el;
    mutations.current?.disconnect();
    mutations.current = null;
    if (!el || typeof MutationObserver === 'undefined') return;
    let queued = false;
    const mo = new MutationObserver((records) => {
      if (queued) return;
      /* Only a child of the shell, of the stage or of the palettes' stack
         coming or going: the drawing's own churn (playback repaints it every
         frame) is not it. */
      const near = records.some((r) => r.target === el
        || (r.target instanceof Element
          && (r.target.classList.contains('app-stage') || r.target.classList.contains('pal-stack'))));
      if (!near) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; rescan(); });
    });
    mo.observe(el, { childList: true, subtree: true });
    mutations.current = mo;
  }, [rescan]);
}

function TimelineSlot({ popup = false }: { popup?: boolean }) {
  const [ref, width] = useWidth();
  const t = trace.value;
  const learn = mode.value === 'learn';
  /* Popped out, the timeline is drawn in its own window and this is only
     the note that says where it went. */
  if (!popup && popped.value.timeline !== undefined) {
    return <div class="tl-slot"><PoppedAway kind="timeline" label="Timeline" /></div>;
  }
  return (
    <div class="tl-slot" ref={ref}>
      <TimelineSwitchRow />
      {appTimelineOn() ? <AppTimeline /> : t === null ? (
        <div class="empty">
          <span class="empty-k">Timeline</span>
          <p>
            {learn
              ? 'No events in this step. A step whose "Show me" breaks something draws its timeline here.'
              : 'No events yet. Select a card to add an event, or pick a scenario.'}
          </p>
        </div>
      ) : <Timeline {...shellTimelineProps(t, width)} />}
    </div>
  );
}

/* Learn's right half: the drawing, the readout and the clocks, so a step
   that breaks something shows its timeline beside the prose that explains it.
   The header above them names the step the drawing is set up for and carries
   the two ways out of Learn with it (learn/LearnShell.tsx). */
function Workbench() {
  return (
    <>
      <LearnWorkbenchHeader />
      <HomeCanvas />
      <Readout />
      <TimelineSlot />
    </>
  );
}

/* Break's rail is its own events and nothing else: the list of what has been
   added, and (docked) the scenarios and the findings. What can be added lives
   on the drawing -- the bar a click opens, the icons on a card -- and on the
   lanes' own buttons, never here. */
function Rail({ m, float = false }: { m: Mode; float?: boolean }) {
  switch (m) {
    case 'build': return <Inspector />;
    /* Floating, the scenarios are on the palette and the findings behind the
       status chips, so the rail is the reader's own events and nothing else. */
    case 'break': return <BreakRail scenarios={!float} validation={!float} />;
    case 'configure': return <Inspector />;
    case 'learn': return <Workbench />;
  }
}

/** The drawing, unless it has been popped out into a window of its own. */
function HomeCanvas() {
  return popped.value.canvas === undefined ? <CanvasSlot /> : <PoppedAway kind="canvas" label="Drawing" />;
}

function Stage({ m, lanes = false }: { m: Mode; lanes?: boolean }) {
  if (m === 'learn') return <LearnShell />;
  /* Break's Lanes layout: the drawing and the timeline are one view. Its cards, data-centre
     headers and link pills carry the events. */
  if (lanes) return <LanesView />;
  return <HomeCanvas />;
}

/**
 * The reader's height for Break's lower region, as `--tl-h` on the root -- the
 * same escape hatch as `--dock-h`, and on the root for the same reason:
 * nothing inside the application ever carries a style attribute. Unset, the
 * region takes split.css's default. The drawing follows through `--dock-h`,
 * which the dock's own observer writes as the region changes size.
 */
function useTimelineHeight(): void {
  const h = timelineH.value;
  const drawing = geometry.value?.viewBox.h;
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (h === null) root.style.removeProperty('--tl-h');
    else root.style.setProperty('--tl-h', `${h}px`);
  }, [h]);
  /* The region's default height, `--tl-fit`: what leaves the whole drawing on
     show at 1:1 (`timelineDefaultH`). It depends on the window and on where
     the header's bottom is, so it is measured now and again on every resize;
     split.css's `--tl-default` reads it. */
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const root = document.documentElement;
    const write = (): void => {
      const bottom = document.querySelector('.app-head')?.getBoundingClientRect().bottom ?? 0;
      root.style.setProperty(
        '--tl-fit', `${timelineDefaultH(window.innerHeight, bottom > 0 ? bottom : 80, drawing)}px`,
      );
    };
    write();
    window.addEventListener('resize', write);
    return () => { window.removeEventListener('resize', write); root.style.removeProperty('--tl-fit'); };
  }, [drawing]);
}

/* The floating dock. Topology's is the readings and the finding chips on one
   row, and, while there is a run to glance at, the small timeline under them.
   Break's Split layout is the bar and the timeline under it
   (break/SplitDock.tsx), which carry the same things and the transport. */
function FloatDock({ m }: { m: Mode }) {
  if (m === 'break') return <SplitDock />;
  return (
    <>
      <div class="dock-status">
        <Readout />
        <FindingsChips />
      </div>
      {m === 'build' ? <MiniTimeline /> : null}
    </>
  );
}

/* The two parts that can be popped out into a window of their own
   (common/popout.tsx). Each is the floating layout's part on its own, filling
   the popup: the timeline panel with its header row, the stage with the
   drawing and its zoom pill. */
function TimelinePop() {
  return (
    <div class="app is-float m-break po po-tl">
      <div class="app-dock has-tl">
        <div class="dock-status">
          <Readout />
          <PopoutButton kind="timeline" />
        </div>
        <TimelineSlot popup />
      </div>
    </div>
  );
}

function CanvasPop() {
  return (
    <div class={`app is-float m-${mode.value} po po-cv${gridOn.value ? '' : ' no-grid'}`}>
      <main class="app-stage"><CanvasSlot /></main>
    </div>
  );
}

function Dock({ m, railInDock }: { m: Mode; railInDock: boolean }) {
  if (m === 'learn') return railInDock ? <Workbench /> : null;
  return (
    <>
      {m === 'configure' ? null : <Readout />}
      {m === 'build' ? <MiniTimeline /> : null}
      {m === 'build' ? <IssuePanel /> : null}
      {m === 'break' ? <TimelineSlot /> : null}
      {m === 'configure' ? <Panels /> : null}
    </>
  );
}

export function App() {
  const m = mode.value;
  /* The Introduction takes the stage, the rail and the dock; the header stays,
     with the modes live, because the way out of an introduction has to be the
     same control as the way around the application (ui.md SS3e). */
  const intro = introPage.value;
  const wide = viewport.value === 'wide';
  const railInGrid = wide && HAS_RAIL[m];
  /* Folded to its strip: a column that is there, in every mode but Learn,
     whose right half is the workbench rather than a rail. */
  const railShut = railInGrid && m !== 'learn' && railCollapsed.value;
  /* Build and Break draw the canvas full-bleed with everything else floating
     over it; Configure and Learn keep the docked grid (state/view.ts). */
  const float = !intro && floating(m, viewport.value);
  const t = toast.value;
  /* Break's two layouts, where Break floats: Lanes joins the drawing and the
     timeline into one view; Split (the default) stacks them. */
  const lanes = float && m === 'break' && breakLayout.value === 'lanes';
  const split = float && m === 'break' && !lanes;
  /* Both layouts fold the rail to its strip on the way in, so the drawing (Split) or
     the lanes keep the width they want; the reader can open it (break/split-rail.ts).
     One flag for both: a switch between them never touches the rail. */
  useFoldRailWhile(split || lanes);
  const barRef = useBarAnchor();
  const dockRef = useDockAnchor();
  const appRef = useChromeInsets();
  useTimelineHeight();
  /* Split's lower region is sized by the reader once there is a run to show;
     the steady state's one sentence keeps its own height, and so does the
     note left behind when the timeline is popped out. */
  const sized = split && trace.value !== null && popped.value.timeline === undefined;
  const full = sized && timelineFull.value;
  /* Full screen belongs to the run on screen: leaving Break, or clearing the
     events, puts the drawing back. */
  useEffect(() => { if (!sized) timelineFull.value = false; }, [sized]);
  /* Installed by the shell, not by a mode: `beforeprint` fires once on the
     window, and both the Configure panels and Build's folded notes expand off
     the same signal (ui/print.ts). */
  usePrintExpand();
  /* Undo, redo and select-all, for the whole page (ui/shortcuts.ts). */
  useEffect(() => installShortcuts(), []);

  return (
    <div ref={appRef} class={intro ? 'app m-intro' : `app m-${m}${float ? ' is-float' : ''}${float && !gridOn.value ? ' no-grid' : ''}${full ? ' tl-full' : ''}${railShut ? ' rail-shut' : ''}${railSnap.value ? ' rail-snap' : ''}${lanes ? ' bl-lanes' : split ? ' bl-split' : ''}`}>
      {/* One header, three bands: the modes and the small controls, then the
          quieter document row, then the line that says what to do in the mode
          that is open. It is one element so the toast can be anchored to the
          bottom of all three (ui.md SS3, "as built"). */}
      <header class="app-head" ref={barRef}>
        {/* One floating bar: the brand and the configuration on screen, the
            modes, the small controls, then Share and the overflow. Over the
            Introduction the document controls are absent: they would be a
            preset picker for a drawing that is a picture. */}
        {intro ? <TopBar /> : (
          <TopBar
            doc={<>{<DocPicker />}{float ? null : <DocCount />}</>}
            actions={<div class="statusbar app-status"><DocActions /></div>}
          />
        )}
        {intro ? null : <Guidance />}
        {intro ? null : <CollectionNotice />}
        {/* The classic walkthrough, when one is running: in the header's
            flow, so the drawing moves down for it (intro/Walkthrough.tsx). */}
        {intro ? null : <ClassicWalkthrough />}
        {/* The `?` is in the header on every page, so it opens the same card
            on every page -- the Introduction has no guidance line to hang it
            under, and a control that silently does nothing is worse than one
            that is not there. */}
        {intro && introOpen.value ? <IntroCard /> : null}
      </header>

      {t === null ? null : (
        <p class={`strip toast ${t.kind === 'info' ? '' : `is-${t.kind}`}`} role="status">
          <span>{t.text}</span>
          <span class="strip-spacer" />
          {t.action ? (
            <button type="button" class="btn" onClick={() => { t.action?.run(); toast.value = null; }}>
              {t.action.label}
            </button>
          ) : null}
          <button type="button" class="btn" onClick={() => { toast.value = null; }}>Dismiss</button>
        </p>
      )}

      {intro ? <main class="app-stage"><IntroPage /></main> : null}

      {intro ? null : (
        <>
          {/* Build and Break have no guidance line under the bar (Guidance.tsx),
              so how to edit, or to add and move an event, is the stage's
              description instead. */}
          <main class="app-stage" aria-description={m === 'build' || m === 'break' ? modeGuide(m, viewport.value) : undefined}>
            {/* Said once, here, and nowhere else: the rail, the drawing and
                the action bar over it all report that they are read-only
                without repeating the reason (ui.md SS3). */}
            {canEdit(viewport.value) ? null : (
              <div class="empty">
                <span class="empty-k">Viewer</span>
                <p>
                  Editing needs a wider screen. You can view the configuration this link carries
                  and play its simulation here.
                </p>
              </div>
            )}
            <Stage m={m} lanes={lanes} />
          </main>

          {split && canEdit(viewport.value) ? <ScenarioPalette /> : null}

          {railInGrid
            ? (
              <aside
                id={RAIL_ID}
                class={`app-rail${float ? ' float-card' : ''}${railShut ? ' is-shut' : ''}${m === 'learn' ? '' : ' has-bar'}`}
                aria-label={RAIL_TITLE[m]}
              >
                {m === 'learn' ? <Rail m={m} float={float && !lanes} /> : railShut ? <RailStrip title={RAIL_TITLE[m]} /> : (
                  <>
                    <RailBar title={RAIL_TITLE[m]} />
                    {/* The rail's own scroll port, under the bar that stays
                        put: the contents' sticky headers stick to its top. */}
                    <div class="rail-body">
                      <Rail m={m} float={float && !lanes} />
                    </div>
                  </>
                )}
              </aside>
            )
            : null}

          {float && !lanes ? (
            <>
              {/* Break's findings are the count on the Split bar and the rows
                  that open from it; Build has no bar to carry them. */}
              {m === 'build' ? <FindingToast /> : null}
              {m === 'build' ? <FindingsPopover /> : null}
              <div class={sized ? `app-dock float-card has-tl${timelineH.value === null ? '' : ' is-set'}` : 'app-dock float-card'} ref={dockRef}>
                <FloatDock m={m} />
              </div>
            </>
          ) : null}

          {float || (m === 'learn' && wide) ? null : (
            <div class="app-dock"><Dock m={m} railInDock={!wide} /></div>
          )}
        </>
      )}

      {!intro && !wide && HAS_RAIL[m] && m !== 'learn' ? (
        <Sheet
          open={inspectorOpen.value}
          title={RAIL_TITLE[m]}
          position={viewport.value === 'compact' || viewport.value === 'narrow' ? 'bottom' : 'right'}
          onClose={() => { inspectorOpen.value = false; }}
        >
          <Rail m={m} float={float && !lanes} />
        </Sheet>
      ) : null}

      {/* The dialogs the ⋯ menu opens live here, not in the menu: it is a
          <details> that shuts on a press, taking its contents with it. */}
      {intro ? null : <WorkspacesDialog />}
      {intro ? null : <ReviewDialog />}
      {intro ? null : <CollectDialog />}

      <Popout kind="timeline"><TimelinePop /></Popout>
      <Popout kind="canvas"><CanvasPop /></Popout>
    </div>
  );
}
