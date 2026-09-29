/* PROTOTYPE — Break layout variant B (throwaway, see branch prototype/break-layout-b) */

/**
 * The bar between Break's drawing and its timeline: the drag handle of the
 * split AND the compressed chrome -- transport, the run's readings as one terse
 * line, the findings as a count with a dropdown, the colour key behind an (i),
 * and the pop-out / full-screen icons.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { readout, topology, trace } from '@/state/derived';
import { errors, issues, warnings } from '@/state/derived';
import {
  appLanesShown, findingsOpen, mode, playing, speed, tNow,
} from '@/state/view';
import { Fragment } from 'preact';
import { buildTimeline } from '../timeline/build';
import { Transport } from '../timeline/Transport';
import { FullToggle } from '../timeline/DockControls';
import { PopoutButton } from '../common/popout';
import { showExplanation } from '../break/RunExplanation';
import { IssuePanel, revealFindings } from '../IssuePanel';
import { onFindingsKey } from '../Findings';
import { protoLegendOpen, protoSplitH } from './ProtoVariantB';

const MIN_H = 120;
const NO_DRAG = 'button, input, select, a, label, .pb-pop, [role="dialog"]';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Drag the bar to size the timeline region; capture only once it is a drag, so a click stays a click. */
function useSplitDrag(): {
  onPointerDown: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: JSX.TargetedPointerEvent<HTMLElement>) => void;
} {
  const st = useRef<{ y: number; h: number; id: number; live: boolean } | null>(null);
  const maxH = (el: Element): number => {
    const head = el.ownerDocument.querySelector('.app-head')?.getBoundingClientRect().bottom ?? 80;
    return Math.max(MIN_H, Math.round(el.ownerDocument.defaultView!.innerHeight - head - 140));
  };
  return {
    onPointerDown(e) {
      if (e.button !== 0 || (e.target as Element).closest(NO_DRAG)) return;
      const dock = e.currentTarget.closest('.app-dock');
      if (!dock) return;
      st.current = { y: e.clientY, h: dock.getBoundingClientRect().height, id: e.pointerId, live: false };
    },
    onPointerMove(e) {
      const d = st.current;
      if (!d || d.id !== e.pointerId) return;
      if (!d.live) {
        if (Math.abs(e.clientY - d.y) < 4) return;
        d.live = true;
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
        e.currentTarget.classList.add('is-dragging');
      }
      e.preventDefault();
      protoSplitH.value = Math.min(maxH(e.currentTarget), Math.max(MIN_H, Math.round(d.h + (d.y - e.clientY))));
    },
    onPointerUp(e) {
      const d = st.current;
      if (!d || d.id !== e.pointerId) return;
      st.current = null;
      e.currentTarget.classList.remove('is-dragging');
      if (d.live) { try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ } }
    },
  };
}

/** The run's readings as one line: `Outcome blocked · Application stays down · ...`. */
function TerseReadout({ hasRun }: { hasRun: boolean }) {
  const chips = readout.value.filter((c) => c.id !== 'findings');
  return (
    <div class="pb-ro" aria-label="Readout">
      {chips.map((c, i) => (
        <Fragment key={c.id}>
          {i === 0 ? null : <span class="pb-sep" aria-hidden="true">·</span>}
          <span class={`pb-ro-i t-${c.tone}`} title={`${c.k}: ${c.sub}`}>
            <span class="pb-ro-k">{c.k}</span>{' '}
            <span class="pb-ro-v">{c.v}{c.unit ? ` ${c.unit}` : ''}</span>
            {c.v2 ? <span class="pb-ro-v2"> {c.v2}</span> : null}
          </span>
          {hasRun && c.id === 'outcome' ? (
            <button type="button" class="pb-why" title="Why this result? The run's decisions, step by step" onClick={showExplanation}>
              Why?
            </button>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/** The count chip and the dropdown that carries what used to float over the canvas. */
function FindingsMenu() {
  const errs = errors.value.length;
  const warns = warnings.value.length;
  const notes = issues.value.length - errs - warns;
  const open = findingsOpen.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) findingsOpen.value = false;
    };
    window.addEventListener('keydown', onFindingsKey, true);
    document.addEventListener('pointerdown', away, true);
    return () => {
      window.removeEventListener('keydown', onFindingsKey, true);
      document.removeEventListener('pointerdown', away, true);
    };
  }, [open]);
  const loud = errs + warns;
  const tone = errs > 0 ? 't-rd' : warns > 0 ? 't-am' : notes > 0 ? 't-sl' : 't-tl';
  const label = String(loud);
  const counts = [
    errs === 0 ? null : plural(errs, 'error'),
    warns === 0 ? null : plural(warns, 'warning'),
    notes === 0 ? null : plural(notes, 'note'),
  ].filter((x) => x !== null).join(' · ');
  return (
    <div class="pb-anchor" ref={ref}>
      <button
        type="button"
        class={`pb-chip ${tone}`}
        aria-expanded={open}
        aria-controls="pb-findings"
        title={counts === '' ? 'No issues' : `${counts} -- show the validation findings`}
        onClick={() => { if (open) findingsOpen.value = false; else revealFindings(); }}
      >
        {loud > 0 ? <><span aria-hidden="true">⚠</span> {label}</> : notes > 0 ? plural(notes, 'note') : <span aria-hidden="true">✓</span>}
        <span class="pb-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <section class="pb-pop pb-pop-findings" id="pb-findings" aria-label="Validation findings">
          <header class="pb-pop-hd">
            <span class="pb-pop-t">Validation</span>
            <span class="pb-pop-n">{counts === '' ? 'No issues' : counts}</span>
            <span class="strip-spacer" />
            <button type="button" class="btn is-icon" aria-label="Close the validation findings" onClick={() => { findingsOpen.value = false; }}>
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div class="pb-pop-body"><IssuePanel bare /></div>
        </section>
      ) : null}
    </div>
  );
}

function LegendMenu({ legend }: { legend: readonly { swatch: string; label: string }[] }) {
  const open = protoLegendOpen.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) protoLegendOpen.value = false;
    };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') protoLegendOpen.value = false; };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div class="pb-anchor" ref={ref}>
      <button
        type="button" class="pb-ico" aria-expanded={open} aria-controls="pb-legend"
        aria-label="Colour key" title="What the colours mean"
        onClick={() => { protoLegendOpen.value = !open; }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /><line x1="8" y1="7.2" x2="8" y2="11.2" /><circle cx="8" cy="4.9" r=".5" /></svg>
      </button>
      {open ? (
        <div class="pb-pop pb-pop-legend legend tl-legend" id="pb-legend" role="dialog" aria-label="Colour key">
          {legend.map((l) => <span key={l.swatch}><i class={l.swatch} />{l.label}</span>)}
          <button
            type="button" class="btn pb-app-btn" aria-pressed={appLanesShown.value}
            title="The same run as the application sees it: where the service is, what the sessions see, and the connect string at work."
            onClick={() => { appLanesShown.value = !appLanesShown.value; }}
          >
            Application&rsquo;s view
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ProtoSplitBar({ sized }: { sized: boolean }) {
  const t = trace.value;
  const run = t !== null && mode.value === 'break';
  const doc = topology.value;
  const app = appLanesShown.value;
  /* The transport and the legend want the model the timeline draws from; the
     timeline keeps its own (it owns the held axis and the width). */
  const model = useMemo(
    () => (t === null ? null : buildTimeline(t, doc, { width: 900, selection: null, app })),
    [t, doc, app],
  );
  const drag = useSplitDrag();

  /* The height the reader dragged to, as `--pb-h` on the root: the same
     escape hatch as `--dock-h`. Unset, proto-b.css's ~50/50 default. */
  const h = protoSplitH.value;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (h === null) root.style.removeProperty('--pb-h');
    else root.style.setProperty('--pb-h', `${h}px`);
  }, [h]);
  useEffect(() => () => { document.documentElement.style.removeProperty('--pb-h'); }, []);

  return (
    <div
      class="pb-bar"
      title="Drag the bar to resize the timeline"
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerUp}
    >
      <span class="pb-grip" aria-hidden="true" />
      {model === null ? null : (
        <Transport
          model={model}
          tNow={tNow.value}
          playing={playing.value}
          speed={speed.value}
          onSeek={(v) => { tNow.value = v; }}
          onPlayToggle={() => { playing.value = !playing.value; }}
          onSpeed={(s) => { speed.value = s; }}
        />
      )}
      <TerseReadout hasRun={run} />
      <FindingsMenu />
      {model === null ? null : <LegendMenu legend={model.legend} />}
      {sized ? <PopoutButton kind="timeline" /> : null}
      {sized ? <FullToggle /> : null}
    </div>
  );
}
