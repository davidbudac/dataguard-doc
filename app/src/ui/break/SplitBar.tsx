/**
 * The bar between Break's drawing and its timeline in the Split layout: the
 * drag handle of the split and the whole of the chrome the timeline needs --
 * the transport, the run's readings as one terse line, the findings as a count
 * with a dropdown, the colour key and the Application's view behind an (i), and
 * the pop-out and full-screen buttons.
 *
 * It is what the floating dock's head row was (readout, finding chips, grab
 * handle, two buttons), packed onto one 40 px line so the timeline under it
 * has the rest of the region. The floating warning banner is gone with the
 * dock: the findings are the count on this bar, and the rows open from it.
 *
 * The transport and the key read `run.model`, the model the timeline below is
 * drawn from, so a held axis or a new width can never leave the bar and the
 * drawing on different scales.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { Fragment } from 'preact';
import { readout, topology, trace } from '@/state/derived';
import {
  appLanesShown, findingsOpen, playing, speed, timelineFull, tNow,
} from '@/state/view';
import { Transport } from '../timeline/Transport';
import { DockGrip, FullToggle, useDockDrag } from '../timeline/DockControls';
import { APP_VIEW_TIP } from '../timeline/Timeline';
import type { RunTimeline } from '../timeline/run';
import { PopoutButton } from '../common/popout';
import { useWidth } from '../common/use-width';
import { showExplanation } from './RunExplanation';
import { findingCounts, FindingsSheet, onFindingsKey, plural } from '../Findings';
import { revealFindings } from '../IssuePanel';

/** What inside the bar keeps its own presses; anything else on it drags the split. */
const KEEPS_PRESS = 'button, input, select, a, label, .sb-pop';

/** Below this the bar has no room for a row of speeds and the run's minor readings both. */
const TIGHT_W = 1100;

/** The readings that make up the terse line even when the bar is tight. */
const CORE = new Set(['outcome', 'app', 'observer']);

/** Close a popover on a press outside it, and on Escape. */
function useDismiss(open: boolean, host: RefObject<HTMLElement>, close: () => void, escape = true): void {
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent): void => {
      if (host.current && !host.current.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', away, true);
    if (escape) window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      if (escape) window.removeEventListener('keydown', esc);
    };
  }, [open]);
}

/** The run's readings as one line: `Outcome blocked · Application stays down · ...`. */
function TerseReadout({ run, tight }: { run: boolean; tight: boolean }) {
  const chips = readout.value.filter((c) => c.id !== 'findings' && (!tight || CORE.has(c.id)));
  return (
    <div class="sb-ro" role="group" aria-label="Readout">
      {chips.map((c, i) => (
        <Fragment key={c.id}>
          {i === 0 ? null : <span class="sb-sep" aria-hidden="true">·</span>}
          <span class={`sb-ro-i t-${c.tone}`} title={`${c.k}: ${c.sub}`}>
            <span class="sb-ro-k">{c.k}</span>{' '}
            <span class="sb-ro-v">{c.v}{c.unit ? ` ${c.unit}` : ''}</span>
            {c.v2 ? <span class="sb-ro-v2"> {c.v2}</span> : null}
          </span>
          {run && c.id === 'outcome' ? (
            <button type="button" class="sb-why" title="Why this result? The run's decisions, step by step" onClick={showExplanation}>
              Why?
            </button>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/** The count chip, and the dropdown that carries what used to float over the canvas. */
function FindingsMenu() {
  const { errs, warns, notes, text } = findingCounts();
  const open = findingsOpen.value;
  const host = useRef<HTMLDivElement>(null);
  /* Escape is the findings' own key handler (Findings.tsx), which runs first
     and leaves full screen alone while the rows are open. */
  useDismiss(open, host, () => { findingsOpen.value = false; }, false);
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener('keydown', onFindingsKey, true);
    return () => window.removeEventListener('keydown', onFindingsKey, true);
  }, [open]);
  const loud = errs + warns;
  const tone = errs > 0 ? 't-rd' : warns > 0 ? 't-am' : notes > 0 ? 't-sl' : 't-tl';
  return (
    <div class="sb-anchor" ref={host}>
      <button
        type="button"
        class={`sb-chip ${tone}`}
        aria-expanded={open}
        aria-controls="sb-findings"
        aria-label={text === '' ? 'Validation: no issues' : `Validation: ${text}`}
        title={text === '' ? 'No issues' : `${text} — show the validation findings`}
        onClick={() => { if (open) findingsOpen.value = false; else revealFindings(); }}
      >
        {loud > 0
          ? <><span aria-hidden="true">⚠</span> {loud}</>
          : notes > 0 ? plural(notes, 'note') : <span aria-hidden="true">✓</span>}
        <span class="sb-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <section class="sb-pop sb-pop-findings" id="sb-findings" aria-label="Validation findings">
          <FindingsSheet />
        </section>
      ) : null}
    </div>
  );
}

/** The colour key and the Application's view, behind an (i): read once, then out of the way. */
function KeyMenu({ run }: { run: RunTimeline }) {
  const host = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useDismiss(open, host, () => setOpen(false));
  const app = appLanesShown.value;
  return (
    <div class="sb-anchor" ref={host}>
      <button
        type="button" class="sb-ico" aria-expanded={open} aria-controls="sb-key"
        aria-label="Colour key and view" title="What the colours mean, and the Application's view"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /><line x1="8" y1="7.2" x2="8" y2="11.2" /><circle cx="8" cy="4.9" r=".5" /></svg>
      </button>
      {open ? (
        <div class="sb-pop sb-pop-key legend tl-legend" id="sb-key" role="dialog" aria-label="Colour key and view">
          {run.model.legend.map((l) => <span key={l.swatch}><i class={l.swatch} />{l.label}</span>)}
          {topology.value.application === undefined ? null : (
            <button
              type="button" class="btn sb-app-btn" aria-pressed={app} title={APP_VIEW_TIP}
              onClick={() => { appLanesShown.value = !app; }}
            >
              Application&rsquo;s view
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SplitBar({ run, sized }: {
  /** The timeline's model and axis; null while there is no run to draw. */
  run: RunTimeline | null;
  /** The timeline is here and can be resized, popped out and filled to the window. */
  sized: boolean;
}) {
  const [ref, width] = useWidth(1200);
  const tight = width < TIGHT_W;
  const drag = useDockDrag(KEEPS_PRESS);
  const full = timelineFull.value;
  return (
    <div
      class="sb-bar"
      ref={ref}
      role="group"
      aria-label="Timeline controls"
      title={sized && !full ? 'Drag the bar to resize the timeline' : undefined}
      {...(sized && !full ? drag : {})}
    >
      {sized && !full ? <DockGrip /> : null}
      {run === null || !sized ? null : (
        <Transport
          model={run.model}
          tNow={tNow.value}
          playing={playing.value}
          speed={speed.value}
          speedControl={tight ? 'select' : 'buttons'}
          onSeek={(v) => { tNow.value = v; }}
          onPlayToggle={() => { playing.value = !playing.value; }}
          onSpeed={(s) => { speed.value = s; }}
        />
      )}
      <TerseReadout run={trace.value !== null} tight={tight} />
      {run?.held && sized ? (
        <button
          type="button" class="btn sb-fit" title="An event was moved and the axis stayed where it was: fit it to the run again"
          onClick={run.fit}
        >
          Fit timeline
        </button>
      ) : null}
      <FindingsMenu />
      {run === null || !sized ? null : <KeyMenu run={run} />}
      {sized ? <PopoutButton kind="timeline" /> : null}
      {sized ? <FullToggle /> : null}
    </div>
  );
}
