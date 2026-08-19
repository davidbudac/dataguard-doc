/**
 * One labelled control in a rail: the name (mono, spelled exactly as Oracle
 * spells it), the value, the control itself, its note, and -- when it is off --
 * the pill that says why.
 *
 * The note is the sentence that *explains* the control, so it rides with the
 * `Hints` toggle (`ui/hints.tsx`) and is genuinely absent while that is off --
 * never `display:none`. Two exceptions render at every setting: a `warn` note,
 * which reports the state the reader is looking at rather than documenting the
 * property, and the `WhyPill`, which is the reason a control is grey and is
 * not a hint at all.
 */

import type { ComponentChildren } from 'preact';
import { hintsShown } from '../hints';
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

/**
 * The same sentence, where the control is drawn by hand rather than by
 * `Field` -- the RedoRoutes editor, the failover-target list, a link's scope.
 * One contract for both: explanation waits for `Hints`, a `warn` reports and
 * stays, and `always` is for the line that carries a fact no control on the
 * rail carries by itself.
 */
export function FieldNote(
  { children, warn = false, always = false }:
  { children: ComponentChildren; warn?: boolean; always?: boolean },
) {
  if (!(always || warn || hintsShown())) return null;
  return <p class={warn ? 'field-note is-warn' : 'field-note'}>{children}</p>;
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
      {note === undefined || !(warn || hintsShown()) ? null : (
        <p class={warn ? 'field-note is-warn' : 'field-note'}>{note}</p>
      )}
      <WhyPill why={enabled} />
    </div>
  );
}
