/**
 * The small controls the rails are built from.
 *
 * Every one of them takes its range, its step and its default from the
 * engine's `BOUNDS` table rather than carrying numbers of its own, so a limit
 * is stated once and the slider, the serializer and the migration cannot drift
 * apart. Every one of them also takes a `WhyState`: `{ state: 'off' }` does
 * not type-check without a reason, so a grey control in this application
 * always says what made it grey.
 *
 * No control writes a style attribute. Layout is classes only.
 */

import type { ComponentChildren } from 'preact';
import { BOUNDS, clamp } from '@/engine';
import type { BoundKey } from '@/engine';
import { Field, fitsBeside, textPx } from '../common/Field';
import { Segmented } from '../common/Segmented';
import type { SegmentedOption } from '../common/Segmented';
import { WhyPill } from '../common/WhyPill';
import type { WhyState } from '../common/WhyPill';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { focusField } from '@/state/view';
import { hintsShown } from '../hints';
import { printing } from '../print';
import { isSectionOpen, toggleSection } from './sections';
import { ON } from './why';

/* ---------------- structure ---------------- */

/**
 * The fold's chevron: points right while shut, turns down when open (the turn
 * is CSS, and still under `prefers-reduced-motion`). Decorative -- the button
 * it sits in carries `aria-expanded`.
 */
export function Caret({ open }: { open: boolean }) {
  return (
    <span class={`grp-caret${open ? ' is-open' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 10 10" focusable="false"><polyline points="3.5,1.75 6.75,5 3.5,8.25" /></svg>
    </span>
  );
}

export function Group(
  { title, children, action, id }:
  { title: string; children: ComponentChildren; action?: ComponentChildren; id?: string },
) {
  return (
    <section class="grp" {...(id === undefined ? {} : { id })}>
      <header class="grp-hd">
        <span class="eyebrow">{title}</span>
        {action === undefined ? undefined : <span class="grp-act">{action}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * A group that folds.
 *
 * The eyebrow keeps its look and becomes the label of a real
 * `<button aria-expanded>` that fills the header row, so the whole row is the
 * hit target and a screen reader reads one control rather than a caret beside
 * a heading. A folded section renders no children at all -- the properties are
 * absent from the document, not painted out of view -- and `hint` says in one
 * mono phrase what is inside, so folding never costs the reader the answer to
 * "what is this configuration set to".
 *
 * On paper every fold is open: there is no toggle to press on a printout, and
 * a printed configuration that omits its own properties is not a record of it
 * (ui.md SS3, "on paper the panels stack").
 */
export function Fold(
  { id, title, hint, action, children }:
  {
    id: string; title: string; hint?: string;
    /** Controls for the open group, beside the toggle; absent while it is folded. */
    action?: ComponentChildren;
    children: ComponentChildren;
  },
) {
  const open = isSectionOpen(id) || printing.value;
  return (
    <section class={`grp grp-fold${open ? ' is-open' : ''}`}>
      <header class="grp-hd">
        <button
          type="button"
          class="grp-tog"
          aria-expanded={open}
          onClick={() => toggleSection(id)}
        >
          <Caret open={open} />
          <span class="eyebrow">{title}</span>
          {hint === undefined || open ? null : <span class="grp-sum mono">{hint}</span>}
        </button>
        {action === undefined || !open ? null : <span class="grp-act">{action}</span>}
      </header>
      {open ? children : null}
    </section>
  );
}

/**
 * A line of prose inside a rail -- an empty state, a caveat, a scope note.
 *
 * A note that *explains* rides with the `Hints` toggle and is not rendered at
 * all while that is off (`ui/hints.tsx`); print renders it regardless, the way
 * every `Fold` opens on paper. Two kinds stay on screen at every setting:
 *
 *  - `always` -- a note that reports rather than explains: an empty state, the
 *    count of a multiple selection, what the rail is standing in for. Hiding
 *    it would hide a fact no control on the rail carries.
 *  - `warn` -- a caution about the state the reader is looking at. It is
 *    implicitly `always`: a caution nobody asked to see is a caution.
 *
 * Refusals are not notes. `WhyPill` is untouched by the toggle -- a grey
 * control says why it is grey whatever the reader has chosen to read.
 */
export function Note(
  { children, warn = false, always = false }:
  { children: ComponentChildren; warn?: boolean; always?: boolean },
) {
  if (!(always || warn || hintsShown())) return null;
  return <p class={warn ? 'grp-note is-warn' : 'grp-note'}>{children}</p>;
}

/* ---------------- numbers ---------------- */

export interface NumProps {
  name: string;
  bound: BoundKey;
  value: number;
  onChange: (v: number) => void;
  /** Slider by default; a count reads better as a number box. */
  kind?: 'range' | 'number';
  note?: string;
  warn?: boolean;
  enabled?: WhyState;
  /** Folds a drag into one undo entry. */
  coalesce?: string;
  /** Overrides the bound's own label in the value chip. */
  unit?: string;
  /** The name is this page's words rather than an Oracle property. */
  prose?: boolean;
}

/** The width of a number box, and so of the control on a number row. */
const NUMBER_PX = 88;
/** The width of a text box on a row. */
const TEXT_PX = 150;
/** A checkbox and its TRUE/FALSE reading. */
const CHECK_PX = 64;

export function Num(
  { name, bound, value, onChange, kind = 'range', note, warn, enabled = ON, unit, prose }: NumProps,
) {
  const b = BOUNDS[bound];
  const off = enabled.state === 'off';
  const shown = unit ?? (b.unit === 'count' || b.unit === 'port' ? '' : b.unit);
  /* A slider takes the width under its name, its reading beside the name. A
     number box is its own reading, so it sits beside the name instead. */
  const row = kind === 'number' && fitsBeside(name, prose === true, NUMBER_PX);
  return (
    <Field
      name={name}
      prose={prose}
      layout={row ? 'row' : 'stack'}
      value={kind === 'number' ? undefined : `${value}${shown === '' ? '' : ` ${shown}`}`}
      note={note}
      warn={warn}
      enabled={enabled}
    >
      <input
        class="field-in"
        type={kind}
        min={b.min}
        max={b.max}
        step={b.step}
        value={String(value)}
        disabled={off}
        aria-label={name}
        onInput={kind === 'range'
          ? (e) => onChange(clamp(bound, (e.currentTarget as HTMLInputElement).value))
          : undefined}
        onChange={kind === 'number'
          ? (e) => onChange(clamp(bound, (e.currentTarget as HTMLInputElement).value))
          : undefined}
      />
    </Field>
  );
}

/* ---------------- text ---------------- */

export interface TextProps {
  name: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  note?: string;
  enabled?: WhyState;
  mono?: boolean;
  /** When `focusField` holds this key, the input takes the focus once. */
  focusKey?: string;
  prose?: boolean;
}

/**
 * Committed on change, not on every keystroke: a rename rewrites every
 * reference in the document, and half a name is not a document.
 */
export function Text({
  name, value, onCommit, placeholder, note, enabled = ON, focusKey, prose,
}: TextProps) {
  const off = enabled.state === 'off';
  const ref = useRef<HTMLInputElement | null>(null);
  /* A one-shot focus request from the drawing (a double-click on a card):
     read the signal, act once, clear it -- so the form re-rendering for any
     other reason never pulls the caret back here. */
  const wanted = focusKey !== undefined && focusField.value === focusKey;
  useLayoutEffect(() => {
    if (!wanted || off) return;
    focusField.value = null;
    ref.current?.focus();
    ref.current?.select();
  }, [wanted, off]);
  return (
    <Field
      name={name}
      prose={prose}
      layout={fitsBeside(name, prose === true, TEXT_PX) ? 'row' : 'stack'}
      note={note}
      enabled={enabled}
    >
      <input
        ref={ref}
        class="field-in"
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={off}
        spellcheck={false}
        aria-label={name}
        onChange={(e) => onCommit((e.currentTarget as HTMLInputElement).value)}
      />
    </Field>
  );
}

/* ---------------- flags ---------------- */

export interface CheckProps {
  name: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  note?: string;
  warn?: boolean;
  enabled?: WhyState;
  prose?: boolean;
}

/**
 * A flag: the property name on the left, its reading and the box on the
 * right. The sentence that says what ticking it means is the box's accessible
 * name and its tooltip; the explanation proper is the note under the row.
 */
export function Check(
  { name, label, checked, onChange, note, warn, enabled = ON, prose }: CheckProps,
) {
  const off = enabled.state === 'off';
  return (
    <Field
      name={name}
      prose={prose}
      layout={fitsBeside(name, prose === true, CHECK_PX) ? 'row' : 'stack'}
      note={note}
      warn={warn}
      enabled={enabled}
    >
      <label class="opt is-flag" title={label}>
        <span class="field-val">{checked ? 'TRUE' : 'FALSE'}</span>
        <input
          type="checkbox"
          checked={checked}
          disabled={off}
          aria-label={label}
          onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        />
      </label>
    </Field>
  );
}

/* ---------------- choices ---------------- */

export interface ChoiceProps<T extends string> {
  name: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (v: T) => void;
  note?: string;
  warn?: boolean;
  enabled?: WhyState;
  prose?: boolean;
}

/** The width a segmented control of these labels takes (11 px mono). */
const segPx = (labels: readonly string[]): number =>
  labels.reduce((n, l) => n + textPx(l, 11) + 16, 0) + 2 * (labels.length - 1) + 4;

/**
 * A segmented control. Beside its name when the options are short enough
 * (ALL | NONE), full width under it otherwise (the three protection modes),
 * with every option taking an equal share of the row.
 */
export function Choice<T extends string>(
  { name, value, options, onChange, note, warn, enabled = ON, prose }: ChoiceProps<T>,
) {
  const layout = fitsBeside(name, prose === true, segPx(options.map((o) => o.label)))
    ? 'row' : 'stack';
  /* A field that is off as a whole says why once, on the field. Only a
     per-option restriction -- FASTSYNC outside maximum availability -- gets a
     pill of its own, which is what `Segmented` draws. */
  if (enabled.state === 'off') {
    return (
      <Field name={name} prose={prose} layout={layout} note={note} warn={warn} enabled={enabled}>
        <div class="seg" role="group" aria-label={name}>
          {options.map((o) => (
            <button key={o.value} type="button" aria-pressed={o.value === value} disabled>
              {o.label}
            </button>
          ))}
        </div>
      </Field>
    );
  }
  return (
    <Field name={name} prose={prose} layout={layout} note={note} warn={warn} enabled={enabled}>
      <Segmented label={name} value={value} options={options} onChange={onChange} />
    </Field>
  );
}

export interface PickOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface PickProps {
  name: string;
  value: string;
  options: readonly PickOption[];
  onChange: (v: string) => void;
  note?: string;
  enabled?: WhyState;
  /** Rendered above the list rather than as the property name. */
  prose?: boolean;
}

/** A drop-down, for lists too long to segment: hosts, members, sites. */
export function Pick({ name, value, options, onChange, note, enabled = ON, prose }: PickProps) {
  const off = enabled.state === 'off';
  /* A drop-down is as wide as its longest option, plus the arrow. */
  const widest = options.reduce((n, o) => Math.max(n, textPx(o.label, 12)), 0) + 36;
  return (
    <Field
      name={name}
      prose={prose}
      layout={fitsBeside(name, prose === true, widest) ? 'row' : 'stack'}
      note={note}
      enabled={enabled}
    >
      <select
        class="field-in"
        value={value}
        disabled={off}
        aria-label={name}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

/* ---------------- buttons ---------------- */

export interface ActionProps {
  label: string;
  onClick: () => void;
  enabled?: WhyState;
  primary?: boolean;
  title?: string;
}

/**
 * A button that can be off. The reason rides beside it, never in a tooltip:
 * a tooltip is not readable on a touch screen and does not print.
 */
export function Action({ label, onClick, enabled = ON, primary = false, title }: ActionProps) {
  const off = enabled.state === 'off';
  return (
    <span class="ctl-off">
      <button
        type="button"
        class={`btn${primary ? ' is-primary' : ''}${off ? ' is-faded' : ''}`}
        disabled={off}
        title={title}
        onClick={onClick}
      >
        {label}
      </button>
      <WhyPill why={enabled} />
    </span>
  );
}
