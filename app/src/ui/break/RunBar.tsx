/**
 * The parts of the Detailed timeline's bar that are their own components: the
 * run's readings as one terse line, the findings as a count with a dropdown,
 * and the colour key and the Application's view behind an (i). `LanesBar`
 * (LanesView.tsx) puts them on its one line with the transport.
 *
 * The transport and the key read `run.model`, the model the lanes below are
 * drawn from, so a held axis or a new width can never leave the bar and the
 * drawing on different scales.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, RefObject } from 'preact';
import { signal } from '@preact/signals';
import { Fragment } from 'preact';
import { readout, topology, trace } from '@/state/derived';
import type { ReadoutChip } from '@/state/derived';
import { setSummaryOpen, toggleOutcomeDrawing } from '@/state/persist';
import { appLanesShown, findingsOpen, outcomeDrawing, summaryOpen } from '@/state/view';
import { SettingChips } from './SettingChips';
import { SUMMARY_ID } from './SummaryBand';
import { APP_VIEW_TIP } from '../timeline/Timeline';
import type { RunTimeline } from '../timeline/run';
import { useWidth } from '../common/use-width';
import { showExplanation } from './RunExplanation';
import { findingCounts, FindingsSheet, onFindingsKey, plural } from '../Findings';
import { revealFindings } from '../IssuePanel';
import { chipsThatFit } from './readout-fit';
import type { FitItem } from './readout-fit';

/** Below this the bar has no room for a row of speeds and the run's minor readings both. */
export const TIGHT_W = 1100;

/**
 * The readings in the order they are given up when the line is short: the
 * first is kept longest. Outcome, Application and Observer are the essentials;
 * Split brain goes first of all -- the band of cards has it whole -- then Data
 * loss, then New primary open, then the primary's shutdown.
 * (The steady-state readings, which have no outcome, rank the same way.)
 */
const KEEP = ['outcome', 'protection', 'app', 'observer', 'fsfo', 'abort', 'open', 'members', 'loss', 'split'];
const CORE = new Set(['outcome', 'protection', 'app', 'observer']);

/** Shorter eyebrows for when even the essentials do not fit; the values are never shortened. */
const SHORT_K: Record<string, string> = {
  'Application reconnects': 'App reconnects',
  Application: 'App',
  'Protection level': 'Protection',
  'Fast-start failover': 'FSFO',
  'New primary open': 'Opens',
  'Primary shut down': 'Shut down',
  'Primary shuts down': 'Shuts down',
  'Data loss': 'Loss',
};

/** The gap between the line's parts (timeline-bar.css `.sb-ro`), and its left padding. */
const RO_GAP = 6;
const RO_PAD = 12;
/** Rounding slack: widths are read as whole pixels. */
const SLACK = 4;

/** Close a popover on a press outside it, and on Escape. */
export function useDismiss(open: boolean, host: RefObject<HTMLElement>, close: () => void, escape = true): void {
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

const valueOf = (c: ReadoutChip): string => `${c.v}${c.unit ? ` ${c.unit}` : ''}`;

function Chip({ c, label, measure = false }: { c: ReadoutChip; label: string; measure?: boolean }) {
  return (
    <span class={`${measure ? 'sb-rm-i' : 'sb-ro-i'} t-${c.tone}`} title={measure ? undefined : `${c.k}: ${c.sub}`}>
      <span class="sb-ro-k">{label}</span>{' '}
      <span class="sb-ro-v">{valueOf(c)}</span>
      {c.v2 ? <span class="sb-ro-v2"> {c.v2}</span> : null}
    </span>
  );
}

function WhyButton() {
  return (
    <button type="button" class="sb-why" title="Why this result? The run's decisions, step by step" onClick={showExplanation}>
      Why?
    </button>
  );
}

type Sizes = { sep: number; items: Record<string, { long: number; short: number }> };

/**
 * The run's readings as one line: `Outcome blocked · Application stays down · ...`.
 *
 * It draws what fits and no more (readout-fit.ts): the room is the line's own
 * measured width, each reading's width is measured in a hidden copy of the
 * line, and a reading that does not fit is left out whole, never clipped.
 * The line's title carries every reading, so the ones left out are a hover away.
 */
export function TerseReadout({ run, omit }: { run: boolean; omit?: readonly string[] }) {
  /* `omit` names readings (by their eyebrow) to leave off the line: a layout that
     draws them somewhere else, on the small timeline, says so and the line forgets them. */
  const chips = readout.value.filter((c) => c.id !== 'findings' && !(omit?.includes(c.k) ?? false));
  const [ref, width] = useWidth(1e6);
  const meter = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Sizes>({ sep: 0, items: {} });
  /* Measured before paint, and again whenever the readings change: a copy of
     every reading, in both labels, sits invisibly in the line. */
  useLayoutEffect(() => {
    const m = meter.current;
    if (!m) return;
    const next: Sizes = { sep: 0, items: {} };
    m.querySelectorAll<HTMLElement>('[data-m]').forEach((el) => {
      const [id = '', kind] = (el.dataset.m ?? '').split(':');
      if (id === 'sep') { next.sep = el.offsetWidth; return; }
      const cur = next.items[id] ?? { long: 0, short: 0 };
      cur[kind === 'short' ? 'short' : 'long'] = el.offsetWidth;
      next.items[id] = cur;
    });
    if (JSON.stringify(next) !== JSON.stringify(sizes)) setSizes(next);
  });
  const items: FitItem[] = chips.map((c) => {
    const w = sizes.items[c.id] ?? { long: 0, short: 0 };
    const kind = c.group ?? c.id;
    const rank = KEEP.indexOf(kind);
    return { id: c.id, core: CORE.has(kind), rank: rank < 0 ? KEEP.length : rank, long: w.long, short: w.short };
  });
  const fit = chipsThatFit(items, width > 0 ? width - RO_PAD - SLACK : 0, sizes.sep + 2 * RO_GAP);
  const shown = chips.filter((c) => fit.ids.includes(c.id));
  const cut = shown.length < chips.length;
  const label = (c: ReadoutChip): string => (fit.short ? SHORT_K[c.k] ?? c.k : c.k);
  return (
    <div
      class="sb-ro" role="group" aria-label="Readout" ref={ref}
      title={cut ? chips.map((c) => `${c.k}: ${valueOf(c)}${c.v2 ? ` ${c.v2}` : ''}`).join(' · ') : undefined}
    >
      {shown.map((c, i) => (
        <Fragment key={c.id}>
          {i === 0 ? null : <span class="sb-sep" aria-hidden="true">·</span>}
          <Chip c={c} label={label(c)} />
          {run && c.id === 'outcome' ? <WhyButton /> : null}
        </Fragment>
      ))}
      <div class="sb-rm" aria-hidden="true" ref={meter}>
        <span class="sb-sep" data-m="sep">·</span>
        {chips.flatMap((c) => (['long', 'short'] as const).map((kind) => (
          <span class="sb-rm-w" key={`${c.id}:${kind}`} data-m={`${c.id}:${kind}`}>
            <Chip c={c} label={kind === 'short' ? SHORT_K[c.k] ?? c.k : c.k} measure />
            {run && c.id === 'outcome' ? <span class="sb-why">Why?</span> : null}
          </span>
        )))}
      </div>
    </div>
  );
}

/**
 * The verdict, as the bar's headline: the outcome large, Why? beside it, and
 * the rest of the readings on one fitted line under it (`TerseReadout`, which
 * leaves out whole what does not fit; the Summary band has them all). With no
 * run there is no verdict, and the line stands alone as the steady state's
 * readings.
 */
export function Verdict({ run }: { run: boolean }) {
  const chips = readout.value.filter((c) => c.id !== 'findings');
  const outcome = chips.find((c) => c.id === 'outcome') ?? null;
  return (
    <div class="ln-verdict">
      {outcome === null ? (
        <div class="ln-vd t-sl" title="Nothing is scheduled: these are the configuration's readings as drawn.">
          <span class="ln-vd-k">Steady state</span>
        </div>
      ) : (
        <div class={`ln-vd t-${outcome.tone}`} title={`${outcome.k}: ${outcome.sub}`}>
          <span class="ln-vd-k">{outcome.k}</span>
          <span class="ln-vd-v">{valueOf(outcome)}</span>
          {outcome.v2 ? <span class="ln-vd-v2">{outcome.v2}</span> : null}
          {run ? <WhyButton /> : null}
        </div>
      )}
      <div class="ln-vd-line">
        <FoldLine run={run}>
          <TerseReadout run={run} omit={outcome === null ? undefined : [outcome.k]} />
        </FoldLine>
      </div>
    </div>
  );
}

/**
 * The line under the verdict, and what becomes of it when the Summary band is
 * unfolded: the band is the same readings at reading size, so the line gives
 * way to a spacer rather than saying everything twice. Folded, a press on the
 * line unfolds the band (a button inside it, like Why?, keeps its own click).
 * With no run there is no band, and the line is simply the line.
 */
function FoldLine({ run, children }: { run: boolean; children: ComponentChildren }) {
  if (!run) return <>{children}</>;
  if (summaryOpen.value) return <span class="rs-fill" />;
  return (
    <div class="rs-host">
      <div
        class="rs-hit" title="Show the summary cards"
        onClick={(e) => {
          if ((e.target as Element).closest('button')) return;
          setSummaryOpen(true);
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The Summary band's toggle on its own, for a bar whose line is folded away. */
export function SummaryToggle() {
  if (trace.value === null) return null;
  const open = summaryOpen.value;
  return (
    <button
      type="button" class="rs-tog" aria-expanded={open} aria-controls={SUMMARY_ID}
      title={open ? 'Fold the summary cards away' : 'Unfold the summary cards'}
      onClick={() => setSummaryOpen(!open)}
    >
      {open ? <><span aria-hidden="true">▴</span> Summary</> : <>Summary <span aria-hidden="true">▾</span></>}
    </button>
  );
}

/**
 * The discrete settings behind one chip: protection mode, fast-start failover
 * and the standby's LogXptMode as the inspector's own selects, with `All
 * settings` under them. Three dropdowns across the bar were three controls
 * nobody had asked for yet, over a result they had.
 */
export const settingsOpen = signal(false);

export function SettingsMenu() {
  const host = useRef<HTMLDivElement>(null);
  const open = settingsOpen.value;
  useDismiss(open, host, () => { settingsOpen.value = false; });
  return (
    <div class="sb-anchor" ref={host}>
      <button
        type="button" class="sb-tool sb-settings" aria-expanded={open} aria-controls="sb-settings"
        title="Protection mode, fast-start failover and the standby's transport; changing one reruns the scenario"
        onClick={() => { settingsOpen.value = !open; }}
      >
        Settings
        <span class="sb-caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div class="sb-pop sb-pop-settings" id="sb-settings" role="dialog" aria-label="Settings">
          <SettingChips />
        </div>
      ) : null}
    </div>
  );
}

/** Whether the drawing of the topology stays above the lanes. Pressed while it does. */
export function DrawingToggle() {
  const on = outcomeDrawing.value;
  return (
    <button
      type="button" class="sb-tool sb-draw" aria-pressed={on}
      title={on
        ? 'Hide the drawing: the lanes take the whole stage'
        : 'Show the drawing of the topology above the lanes, as it is at the playhead'}
      onClick={toggleOutcomeDrawing}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="5" rx="1.2" /><rect x="2" y="9.5" width="12" height="4" rx="1.2" /></svg>
      Drawing
    </button>
  );
}

/** The count chip, and the dropdown that carries what used to float over the canvas. */
export function FindingsMenu() {
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
        title={text === '' ? 'No issues (J)' : `${text} — show the validation findings (J)`}
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
export function KeyMenu({ run }: { run: RunTimeline }) {
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
          {(topology.value.applications?.length ?? 0) === 0 ? null : (
            <button
              type="button" class="btn sb-app-btn" aria-pressed={app} title={APP_VIEW_TIP}
              onClick={() => { appLanesShown.value = !app; }}
            >
              {(topology.value.applications?.length ?? 0) > 1 ? 'Applications’ views' : 'Application’s view'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
