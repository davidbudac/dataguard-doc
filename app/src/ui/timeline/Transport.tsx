/**
 * The transport bar under the timeline: step to the previous and next state
 * change, play/pause, a speed picker, and a time field you can type into.
 *
 * Every control that is gray says why it is gray, in place (ui.md SS8). The
 * reason strings live in one table here, the way the published fragment keeps
 * one `WHY` map, so the same condition always graying two controls reads as
 * the same condition.
 */

import type { JSX } from 'preact';
import { WhyPill } from '@/ui/common/WhyPill';
import type { WhyState } from '@/ui/common/WhyPill';
import { fmt } from './build';
import type { TimelineModel } from './build';
import { nextChange, prevChange } from './Playhead';

export const WHY = {
  empty: 'no events injected',
  atStart: 'already at the start',
  atEnd: 'no later state change',
} as const;

/** The one contract, from `ui/common/WhyPill`: off does not type-check without a reason. */
export type Why = WhyState;

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export interface TransportProps {
  model: TimelineModel;
  tNow: number;
  playing: boolean;
  speed: number;
  onSeek: (t: number) => void;
  onPlayToggle: () => void;
  onSpeed: (speed: number) => void;
  /**
   * The five speeds as a row of buttons, or as one select where the row does
   * not fit (the Detailed timeline's bar under 1100 px, `TIGHT_W`). The same values either way.
   */
  speedControl?: 'buttons' | 'select';
}

interface StepProps {
  label: string;
  glyph: string;
  why: Why;
  onClick: () => void;
}

function TransportButton({ label, glyph, why, onClick }: StepProps) {
  const off = why.state === 'off';
  return (
    <span class="tl-tp-slot">
      <button
        type="button"
        class="tl-tp-btn"
        disabled={off}
        aria-label={label}
        title={off ? `${label} — ${why.why}` : label}
        onClick={onClick}
      >
        <span aria-hidden="true">{glyph}</span>
      </button>
      <WhyPill why={why} />
    </span>
  );
}

export function Transport({
  model, tNow, playing, speed, onSeek, onPlayToggle, onSpeed, speedControl = 'buttons',
}: TransportProps) {
  const { scale } = model;
  const t = scale.clampT(tNow);
  const prev = prevChange(model.stateChanges, t);
  const next = nextChange(model.stateChanges, t);

  const emptyWhy: Why = model.empty ? { state: 'off', why: WHY.empty } : { state: 'on' };
  const prevWhy: Why = model.empty
    ? emptyWhy
    : prev === null ? { state: 'off', why: WHY.atStart } : { state: 'on' };
  const nextWhy: Why = model.empty
    ? emptyWhy
    : next === null ? { state: 'off', why: WHY.atEnd } : { state: 'on' };

  /* Every control here except ▶ moves the reader to a moment they chose, and
     playback owns the playhead while it runs (playback.ts), so choosing a
     moment stops the run rather than being overwritten a frame later. */
  const seek = (v: number): void => {
    if (playing) onPlayToggle();
    onSeek(v);
  };

  const onTimeInput = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const raw = e.currentTarget.value.replace(',', '.').trim();
    const v = Number.parseFloat(raw);
    if (Number.isFinite(v)) seek(scale.clampT(v));
    e.currentTarget.value = fmt(scale.clampT(Number.isFinite(v) ? v : t));
  };

  return (
    <div class="tl-transport" role="group" aria-label="Timeline transport">
      <TransportButton
        label="Previous state change"
        glyph="|◀"
        why={prevWhy}
        onClick={() => { if (prev !== null) seek(prev); }}
      />
      <TransportButton
        label={playing ? 'Pause (P)' : 'Play (P)'}
        glyph={playing ? '❚❚' : '▶'}
        why={emptyWhy}
        onClick={onPlayToggle}
      />
      <TransportButton
        label="Next state change"
        glyph="▶|"
        why={nextWhy}
        onClick={() => { if (next !== null) seek(next); }}
      />
      <TransportButton
        label="Back to the start"
        glyph="↺"
        why={emptyWhy}
        onClick={() => seek(scale.t0)}
      />

      <label class="tl-tp-time">
        <span class="tl-tp-k">t</span>
        <input
          class="tl-tp-in t-mono"
          type="text"
          inputMode="decimal"
          size={6}
          value={fmt(t)}
          aria-label="Time in seconds"
          onChange={onTimeInput}
        />
        <span class="tl-tp-u">s</span>
      </label>

      {speedControl === 'select' ? (
        <label class="tl-tp-time">
          <span class="sr">Playback speed</span>
          <select
            class="tl-tp-sel"
            disabled={model.empty}
            value={String(speed)}
            onChange={(e) => onSpeed(Number(e.currentTarget.value))}
          >
            {SPEEDS.map((s) => <option key={s} value={String(s)}>{`${fmt(s)}×`}</option>)}
          </select>
        </label>
      ) : (
        <span class="tl-tp-speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              class={s === speed ? 'tl-tp-speed is-on' : 'tl-tp-speed'}
              aria-pressed={s === speed}
              disabled={model.empty}
              onClick={() => onSpeed(s)}
            >
              {`${fmt(s)}×`}
            </button>
          ))}
          <WhyPill why={emptyWhy} />
        </span>
      )}
    </div>
  );
}
