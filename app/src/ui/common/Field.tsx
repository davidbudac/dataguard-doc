/**
 * One labelled control in a rail: the name (mono, spelled exactly as Oracle
 * spells it), the value, the control itself, its note, and -- when it is off --
 * the pill that says why.
 */

import type { ComponentChildren } from 'preact';
import { WhyPill } from './WhyPill';
import type { WhyState } from './WhyPill';

export interface FieldProps {
  /** The property name. Oracle vocabulary is mono; prose labels set `prose`. */
  name: string;
  prose?: boolean;
  value?: string;
  note?: string;
  /** Amber note: state the reader is looking at, not documentation. */
  warn?: boolean;
  enabled?: WhyState;
  children?: ComponentChildren;
}

export function Field(
  { name, prose = false, value, note, warn = false, enabled = { state: 'on' }, children }: FieldProps,
) {
  const off = enabled.state === 'off';
  return (
    <div class={off ? 'field is-off' : 'field'}>
      <div class="field-hd">
        <span class={prose ? 'field-name is-prose' : 'field-name'}>{name}</span>
        {value === undefined ? null : <span class="field-val">{value}</span>}
      </div>
      {children}
      {note === undefined ? null : (
        <p class={warn ? 'field-note is-warn' : 'field-note'}>{note}</p>
      )}
      <WhyPill why={enabled} />
    </div>
  );
}
