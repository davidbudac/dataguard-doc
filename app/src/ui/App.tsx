/**
 * The shell (ui.md SS3): two bars, one persistent canvas, a right rail and a
 * bottom dock, arranged by the mode.
 *
 * The canvas never blinks -- switching modes changes what is around it, not
 * what it is. Nothing here is hidden with CSS: a rail that does not fit is not
 * rendered into the grid at all, it is rendered into a drawer; a rail nobody
 * has asked for (Topology's and Config's inspector, until something is
 * selected or it is opened) is not rendered at all and the drawing takes its
 * column; a timeline panel that is folded keeps only its handle; and a mode
 * that is not open is not in the document.
 *
 * Slots other agents own are imported by path and rendered with the props they
 * declare. `TimelineSlot` below is the one adapter the shell keeps: the
 * timeline wants a `Trace` and a measured width, and both are the shell's to
 * supply.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { runShown, topology, trace } from '@/state/derived';
import {
  canEdit, floating, gridOn, inspectorOpen, inspectorRailWanted, introOpen, introPage, mode, modeGuide, railCollapsed,
  railOnDemand, timelineOpen, toast, viewport,
} from '@/state/view';
import type { Mode } from '@/state/view';
import { CollectDialog, CollectionNotice } from './import/CollectDialog';
import { TopBar } from './TopBar';
import { DocActions, DocCount, DocPicker } from './StatusBar';
import { FindingsPopover } from './Findings';
import { Guidance, IntroCard } from './Guidance';
import { usePrintExpand } from './print';
import { installShortcuts } from './shortcuts';
import { Readout } from './Readout';
import { IssuePanel } from './IssuePanel';
import { Sheet } from './common/Sheet';
import { CanvasSlot } from './canvas/CanvasSlot';
import { Inspector } from './inspector/Inspector';
import { BreakRail } from './break/BreakRail';
import { PlayDock } from './break/PlayDock';
import { ScenarioRow } from './break/ScenarioRow';
import { Panels } from './panels/Panels';
import { LearnShell, LearnWorkbenchHeader } from './learn/LearnShell';
import { IntroPage } from './intro/IntroPage';
import { Timeline } from './timeline/Timeline';
import { MiniTimeline } from './timeline/MiniTimeline';
import { TimelineHandle, timelineShown } from './timeline/PanelHandle';
import { shellTimelineProps } from './timeline/shell-props';
import { WorkspacesDialog } from './workspaces/Workspaces';
import { ClassicWalkthrough } from './intro/Walkthrough';
import { ReviewDialog } from './review/ReviewPanel';
import { Popout, PopoutButton, PoppedAway, popped } from './common/popout';
import { renaming } from './canvas/place';
import { RAIL_ID, RailBar, RailStrip } from './RailFrame';
import { useWidth } from './common/use-width';
import { LanesView } from './break/LanesView';
import { AppTimeline, appTimelineOn, TimelineSwitchRow } from './break/TimelineView';
import { railSnap, useFoldRailWhile } from './break/rail-fold';

/** The floating dock's id: what its handle's `aria-controls` names. */
const DOCK_ID = 'app-dock';

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
 * inset, the zoom pill, the findings popover and the palette's height follow it
 * as it grows or folds -- Topology's dock is a row of readings, a row of
 * scenarios and, with a run, the small timeline; folded at its handle it is the
 * handle alone, and the drawing gets the rest. Same escape hatch as `--bar-bottom`.
 */
function useDockAnchor(): (el: HTMLElement | null) => void {
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  return (el: HTMLElement | null): void => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const write = (): void => {
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
 *   `--pal-r`  the right edge of the palette at the left (Topology's tools),
 *              from the window's left edge
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
     others (Topology's tools come and go with the mode). */
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
      /* Only a child of the shell or of the stage coming or going: the
         drawing's own churn (playback repaints it every frame) is not it. */
      const near = records.some((r) => r.target === el
        || (r.target instanceof Element && r.target.classList.contains('app-stage')));
      if (!near) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; rescan(); });
    });
    mo.observe(el, { childList: true, subtree: true });
    mutations.current = mo;
  }, [rescan]);
}

/** What a folded timeline panel can say in one line without drawing anything. */
function foldedSummary(): string | null {
  if (!runShown()) return null;
  const n = topology.value.events.length;
  return n === 0 ? 'steady state' : `${n} event${n === 1 ? '' : 's'}`;
}

/**
 * The docked timeline: the Detailed timeline below the floating breakpoint and
 * Learn's workbench. It wears the handle on its top edge that folds the whole
 * slot (`timelineOpen`, ui/timeline/PanelHandle.tsx), the same one Topology's
 * floating dock carries; folded, nothing else of the slot is rendered. Popped
 * out, the timeline is the whole of its own window, where a fold would leave
 * an empty window: it is always open there and wears no handle.
 */
function TimelineSlot({ popup = false }: { popup?: boolean }) {
  const [ref, width] = useWidth();
  const t = trace.value;
  const learn = mode.value === 'learn';
  const open = popup || timelineShown(timelineOpen.value);
  /* Popped out, the timeline is drawn in its own window and this is only
     the note that says where it went. */
  if (!popup && popped.value.timeline !== undefined) {
    return <div class="tl-slot"><PoppedAway kind="timeline" label="Timeline" /></div>;
  }
  return (
    <div class="tl-slot" id="tl-slot" ref={ref}>
      {popup ? null : (
        <TimelineHandle open={open} controls="tl-slot" summary={open ? null : foldedSummary()} />
      )}
      {!open ? null : (
        <>
          <TimelineSwitchRow />
          {appTimelineOn() ? <AppTimeline /> : t === null ? (
            <div class="empty">
              <span class="empty-k">Timeline</span>
              <p>
                {learn
                  ? 'No events in this step. A step whose "Show me" breaks something draws its timeline here.'
                  : 'No events yet. Pick a scenario, or add an event from a card on the drawing.'}
              </p>
            </div>
          ) : <Timeline {...shellTimelineProps(t, width)} />}
        </>
      )}
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

/* The Detailed timeline's rail is its own events, the scenarios and the
   findings. What can be added lives on the drawing -- the bar a click opens,
   the icons on a card -- and on the lanes' own buttons, never here. */
function Rail({ m }: { m: Mode }) {
  switch (m) {
    case 'build': return <Inspector />;
    case 'break': return <BreakRail />;
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
  /* The Detailed timeline's lanes: the cards and the timeline are one view. Its cards,
     data-centre headers and link pills carry the events. */
  if (lanes) return <LanesView />;
  return <HomeCanvas />;
}

/* Topology's floating dock: the handle on its top edge, then the scenarios with
   the discrete settings, the readings and the small timeline that is the
   control (break/PlayDock.tsx). Folded at the handle, the card is the handle
   alone and `useDockAnchor` hands the drawing the room. The Detailed timeline
   has no dock: its lanes are the whole stage (break/LanesView.tsx). */
function FloatDock() {
  const open = timelineShown(timelineOpen.value);
  return (
    <>
      <TimelineHandle open={open} controls={DOCK_ID} summary={open ? null : foldedSummary()} />
      {open ? <PlayDock /> : null}
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
      {m === 'build' ? <ScenarioRow /> : null}
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
  /* Topology's and Config's inspector is on demand: in the document while
     something is selected or the reader opened it, and not there at all
     otherwise -- no strip, and the drawing takes its column (`no-rail`). Break's
     Events rail and Learn's workbench are the mode, and stay. */
  const onDemand = railOnDemand(m, viewport.value);
  /* Not while a name is being typed on the drawing: a double-click selects
     and starts the rename, and a rail arriving under the field would move the
     card it is typed on (view.ts, `railHeld`, is the same care for the 450 ms
     between the two clicks). It arrives when the name is committed. */
  const railWanted = !onDemand || inspectorOpen.value || (inspectorRailWanted() && renaming.value === null);
  const railInGrid = wide && HAS_RAIL[m] && railWanted;
  const noRail = wide && HAS_RAIL[m] && !railWanted;
  /* Folded to its strip: Break's Events rail alone. The inspector has no
     folded state (it is in the document or it is not), and Learn's right half
     is the workbench rather than a rail. */
  const railShut = railInGrid && m === 'break' && railCollapsed.value;
  /* Topology draws the canvas full-bleed with everything else floating over
     it, and the Detailed timeline floats its lanes; Config and Learn keep the
     docked grid (state/view.ts). */
  const float = !intro && floating(m, viewport.value);
  const t = toast.value;
  /* The Detailed timeline, where it floats, is the lanes: the members' cards
     and their timelines are one view, and there is no drawing of the topology
     (the docked layout below 1024 px keeps the drawing and the timeline
     stacked, as a viewer). */
  const lanes = float && m === 'break';
  /* The lanes want the width, so the rail folds to its strip on the way in;
     the reader can open it (break/rail-fold.ts). */
  useFoldRailWhile(lanes);
  const barRef = useBarAnchor();
  const dockRef = useDockAnchor();
  const appRef = useChromeInsets();
  /* Installed by the shell, not by a mode: `beforeprint` fires once on the
     window, and both the Configure panels and Build's folded notes expand off
     the same signal (ui/print.ts). */
  usePrintExpand();
  /* Undo, redo and select-all, for the whole page (ui/shortcuts.ts). */
  useEffect(() => installShortcuts(), []);

  return (
    <div ref={appRef} class={intro ? 'app m-intro' : `app m-${m}${float ? ' is-float' : ''}${float && !gridOn.value ? ' no-grid' : ''}${railShut ? ' rail-shut' : ''}${noRail ? ' no-rail' : ''}${railSnap.value ? ' rail-snap' : ''}${lanes ? ' bl-lanes' : ''}`}>
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

          {railInGrid
            ? (
              <aside
                id={RAIL_ID}
                class={`app-rail${float ? ' float-card' : ''}${railShut ? ' is-shut' : ''}${m === 'learn' ? '' : ' has-bar'}`}
                aria-label={RAIL_TITLE[m]}
              >
                {m === 'learn' ? <Rail m={m} /> : railShut ? <RailStrip title={RAIL_TITLE[m]} /> : (
                  <>
                    <RailBar title={RAIL_TITLE[m]} />
                    {/* The rail's own scroll port, under the bar that stays
                        put: the contents' sticky headers stick to its top. */}
                    <div class="rail-body">
                      <Rail m={m} />
                    </div>
                  </>
                )}
              </aside>
            )
            : null}

          {float && !lanes ? (
            <>
              {/* The Detailed timeline's findings are the count on its bar and
                  the rows that open from it; Topology has no bar to carry
                  them, so the chips on the dock's status line are theirs. */}
              <FindingsPopover />
              <div class="app-dock float-card" id={DOCK_ID} ref={dockRef}>
                <FloatDock />
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
          <Rail m={m} />
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
