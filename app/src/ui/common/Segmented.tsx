/**
 * The segmented control -- the mode switch, the edition switch, the tabs.
 *
 * Buttons with `aria-pressed`, not radios: every one of these switches picks a
 * view, and a view is a thing you press, not a value you submit. A disabled
 * option carries its reason through `WhyPill`, so the row never greys out in
 * silence.
 */

import { WhyPill } from './WhyPill';
import type { WhyState } from './WhyPill';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  /** `{state:'off', why}` disables the option and prints the reason beside it. */
  enabled?: WhyState;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>(
  { label, value, options, onChange }: SegmentedProps<T>,
) {
  const offs = options.filter((o) => o.enabled?.state === 'off');
  return (
    <>
      <div class="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={o.value === value}
            disabled={o.enabled?.state === 'off'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {offs.map((o) => (
        <WhyPill key={o.value} why={o.enabled ?? { state: 'on' }} />
      ))}
    </>
  );
}
