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

import { useEffect, useRef, useState } from 'preact/hooks';
import { topology, trace } from '@/state/derived';
import {
  canEdit, floating, gridOn, inspectorOpen, introOpen, introPage, mode, playing, selection, speed, tNow,
  toast, viewport,
} from '@/state/view';
import type { Mode } from '@/state/view';
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
import { EventMenu } from './canvas/EventMenu';
import { Inspector } from './inspector/Inspector';
import { setEventTime } from './break/events';
import { BreakRail, ScenarioPalette } from './break/BreakRail';
import { Panels } from './panels/Panels';
import { LearnShell, LearnWorkbenchHeader } from './learn/LearnShell';
import { IntroPage } from './intro/IntroPage';
import { Timeline } from './timeline/Timeline';

/** Which modes keep a rail beside the canvas. Learn's right half is the workbench. */
const HAS_RAIL: Record<Mode, boolean> = {
  build: true, break: true, configure: true, learn: true,
};

const RAIL_TITLE: Record<Mode, string> = {
  build: 'Inspector', break: 'Events', configure: 'Inspector', learn: 'Workbench',
};

/** Measure an element without ever writing a style attribute. */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(880);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const ref = (el: HTMLElement | null): void => {
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    observer.current = ro;
  };
  return [ref, width];
}

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

const MIN_TIMELINE_W = 640;

function TimelineSlot() {
  const [ref, width] = useWidth();
  const t = trace.value;
  const learn = mode.value === 'learn';
  return (
    <div class="tl-slot" ref={ref}>
      {t === null ? (
        <div class="empty">
          <span class="empty-k">Timeline</span>
          <p>
            {learn
              ? 'Steady state -- this step injects no event. A step whose "Show me" breaks something draws its clocks here.'
              : 'Steady state -- no events injected. Click a card on the canvas to inject one.'}
          </p>
        </div>
      ) : (
        <Timeline
          trace={t}
          doc={topology.value}
          /* Never narrower than the plot needs to stay legible: below that the
             timeline scrolls sideways inside its own box (ui.md SS1). */
          width={Math.max(width, MIN_TIMELINE_W)}
          tNow={tNow.value}
          playing={playing.value}
          speed={speed.value}
          onSeek={(t2) => { tNow.value = t2; }}
          {...(mode.value === 'break' && canEdit(viewport.value) ? { onMoveEvent: setEventTime } : {})}
          onPlayToggle={() => { playing.value = !playing.value; }}
          onSpeed={(s) => { speed.value = s; }}
          selection={selection.value[0] ?? null}
          onSelect={(id) => { selection.value = id === null ? [] : [id]; }}
          showTransport
        />
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
      <CanvasSlot />
      <Readout />
      <TimelineSlot />
    </>
  );
}

/* The event menu has one home per layout: at the head of the Break rail when
   the rail is beside the canvas (the drawing keeps its whole stage), under the
   drawing when the rail has become a drawer (a menu inside a closed drawer is
   a menu nobody finds). It is never both. */
function Rail({ m, wide, float = false }: { m: Mode; wide: boolean; float?: boolean }) {
  switch (m) {
    case 'build': return <Inspector />;
    /* Floating, the scenarios are on the palette and the findings behind the
       status chips, so the rail is the reader's own events and nothing else. */
    case 'break': return (
      <>
        {wide ? <EventMenu /> : null}
        <BreakRail scenarios={!float} validation={!float} />
      </>
    );
    case 'configure': return <Inspector />;
    case 'learn': return <Workbench />;
  }
}

function Stage({ m, wide }: { m: Mode; wide: boolean }) {
  if (m === 'learn') return <LearnShell />;
  return (
    <>
      <CanvasSlot />
      {m === 'break' && !wide ? <EventMenu /> : null}
    </>
  );
}

/* The floating dock: the readings and the finding chips on one row -- the
   whole of it in Build, the head of the timeline panel in Break. */
function FloatDock({ m }: { m: Mode }) {
  return (
    <>
      <div class="dock-status">
        <Readout />
        <FindingsChips />
      </div>
      {m === 'break' ? <TimelineSlot /> : null}
    </>
  );
}

function Dock({ m, railInDock }: { m: Mode; railInDock: boolean }) {
  if (m === 'learn') return railInDock ? <Workbench /> : null;
  return (
    <>
      {m === 'configure' ? null : <Readout />}
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
  /* Build and Break draw the canvas full-bleed with everything else floating
     over it; Configure and Learn keep the docked grid (state/view.ts). */
  const float = !intro && floating(m, viewport.value);
  const t = toast.value;
  const barRef = useBarAnchor();
  const dockRef = useDockAnchor();
  /* Installed by the shell, not by a mode: `beforeprint` fires once on the
     window, and both the Configure panels and Build's folded notes expand off
     the same signal (ui/print.ts). */
  usePrintExpand();
  /* Undo, redo and select-all, for the whole page (ui/shortcuts.ts). */
  useEffect(() => installShortcuts(), []);

  return (
    <div class={intro ? 'app m-intro' : `app m-${m}${float ? ' is-float' : ''}${float && !gridOn.value ? ' no-grid' : ''}`}>
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
          <main class="app-stage">
            {/* Said once, here, and nowhere else: the rail, the drawing and
                the event menu below all report that they are read-only
                without repeating the reason (ui.md SS3). */}
            {canEdit(viewport.value) ? null : (
              <div class="empty">
                <span class="empty-k">Viewer</span>
                <p>
                  Editing needs a wider screen. Everything below is the configuration this link
                  carries, drawn and simulated -- only the controls that change it are absent.
                </p>
              </div>
            )}
            <Stage m={m} wide={wide} />
          </main>

          {float && m === 'break' && canEdit(viewport.value) ? <ScenarioPalette /> : null}

          {railInGrid
            ? (
              <aside class={float ? 'app-rail float-card' : 'app-rail'} aria-label={RAIL_TITLE[m]}>
                <Rail m={m} wide float={float} />
              </aside>
            )
            : null}

          {float ? (
            <>
              <FindingToast />
              <FindingsPopover />
              <div class="app-dock float-card" ref={dockRef}><FloatDock m={m} /></div>
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
          <Rail m={m} wide={false} float={float} />
        </Sheet>
      ) : null}
    </div>
  );
}
