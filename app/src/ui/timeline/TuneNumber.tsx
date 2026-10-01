/**
 * A number box for a tuned setting: it edits on every keystroke, the way the
 * timeline should follow as you type or arrow, without fighting the typist.
 *
 * What is shown is the setting as it stands, never clamped: the lag limit's
 * 26ai default is 0, below its own floor of 5, and a box that printed 5 would
 * misread it. A setting is clamped to its bound (`clamp` in the engine) when it
 * is committed, and a clamp on
 * every keystroke makes a number that starts below its floor impossible to
 * type -- "25" for a threshold whose minimum is 6 would become "6" at the "2".
 * So what is typed is a draft: a value at or above the floor is committed as it
 * stands (clamped above, snapped to the step), one below it waits, and the
 * change event -- Enter, or leaving the box -- commits whatever is there,
 * clamped, and drops the draft so the box shows the setting again. The arrow
 * keys and the mouse wheel step by the bound's own step.
 */

import { useState } from 'preact/hooks';
import { BOUNDS, clamp } from '@/engine';
import type { BoundKey } from '@/engine';

export interface TuneNumberProps {
  bound: BoundKey;
  value: number;
  onValue: (v: number) => void;
  /** The accessible name: the setting as the inspector spells it. */
  label: string;
  title?: string;
  class?: string;
  disabled?: boolean;
  /** A floor and a clamp of this box's own; see `NumProps` in the inspector's controls. */
  min?: number;
  clampTo?: (raw: unknown) => number;
}

export function TuneNumber(
  { bound, value, onValue, label, title, class: cls, disabled, min, clampTo }: TuneNumberProps,
) {
  const b = BOUNDS[bound];
  const floor = min ?? b.min;
  const clampIt = clampTo ?? ((raw: unknown): number => clamp(bound, raw));
  const [draft, setDraft] = useState<string | null>(null);
  const parse = (raw: string): number => parseFloat(raw);
  return (
    <input
      class={cls ?? 'tune-num'}
      type="number"
      min={floor}
      max={b.max}
      step={b.step}
      value={draft ?? String(value)}
      disabled={disabled}
      aria-label={label}
      title={title}
      onInput={(e) => {
        const raw = (e.currentTarget as HTMLInputElement).value;
        setDraft(raw);
        const n = parse(raw);
        if (Number.isFinite(n) && n >= floor) onValue(clampIt(n));
      }}
      onChange={(e) => {
        const n = parse((e.currentTarget as HTMLInputElement).value);
        setDraft(null);
        if (Number.isFinite(n)) onValue(clampIt(n));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
