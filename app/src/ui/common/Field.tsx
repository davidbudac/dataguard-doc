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
  /**
   * `row`: the name on the left, the control on the right, one line.
   * `stack` (the default): the name (and its value) on one line, the control
   * full width under it. The caller decides from the control's own width --
   * `fitsBeside` -- so a control is never pushed under its name by an accident
   * of wrapping.
   */
  layout?: 'row' | 'stack';
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

/**
 * Whether a control of about `controlPx` fits on the same line as a name.
 *
 * An estimate from the text, not a measurement: the rail is a fixed width,
 * and deciding the layout from the content rather than from the window is
 * what makes it the same every time. A mono character is 0.6 em wide, a sans
 * one about 0.55 em -- so a field name (11.5 px mono, or 12.5 px sans for
 * this page's own words) is ~6.9 px a character either way.
 */
export const RAIL_ROW_PX = 292;
export const textPx = (text: string, sizePx: number, mono = true): number =>
  Math.ceil(text.length * sizePx * (mono ? 0.6 : 0.55));
const NAME_PX = (name: string, prose: boolean): number =>
  (prose ? textPx(name, 12.5, false) : textPx(name, 11.5));
export const fitsBeside = (name: string, prose: boolean, controlPx: number): boolean =>
  NAME_PX(name, prose) + 12 + controlPx <= RAIL_ROW_PX;

export function Field(
  {
    name, prose = false, layout = 'stack', value, note, warn = false, enabled = { state: 'on' },
    children,
  }: FieldProps,
) {
  const off = enabled.state === 'off';
  return (
    <div class={`field is-${layout}${off ? ' is-off' : ''}`}>
      <div class="field-hd">
        <span class={prose ? 'field-name is-prose' : 'field-name'}>{name}</span>
        {value === undefined ? null : <span class="field-val">{value}</span>}
      </div>
      <div class="field-ctl">{children}</div>
      {note === undefined || !(warn || hintsShown()) ? null : (
        <p class={warn ? 'field-note is-warn' : 'field-note'}>{note}</p>
      )}
      <WhyPill why={enabled} />
    </div>
  );
}
