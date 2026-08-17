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
import { Field } from '../common/Field';
import { Segmented } from '../common/Segmented';
import type { SegmentedOption } from '../common/Segmented';
import { WhyPill } from '../common/WhyPill';
import type { WhyState } from '../common/WhyPill';
import { ON } from './why';

/* ---------------- structure ---------------- */

export function Group(
  { title, children, action }:
  { title: string; children: ComponentChildren; action?: ComponentChildren },
) {
  return (
    <section class="grp">
      <header class="grp-hd">
        <span class="eyebrow">{title}</span>
        {action === undefined ? null : <span class="grp-act">{action}</span>}
      </header>
      {children}
    </section>
  );
}

/** A line of prose inside a rail -- an empty state, a caveat, a scope note. */
export function Note({ children, warn = false }: { children: ComponentChildren; warn?: boolean }) {
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
}

export function Num(
  { name, bound, value, onChange, kind = 'range', note, warn, enabled = ON, unit }: NumProps,
) {
  const b = BOUNDS[bound];
  const off = enabled.state === 'off';
  const shown = unit ?? (b.unit === 'count' || b.unit === 'port' ? '' : b.unit);
  return (
    <Field
      name={name}
      value={`${value}${shown === '' ? '' : ` ${shown}`}`}
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
}

/**
 * Committed on change, not on every keystroke: a rename rewrites every
 * reference in the document, and half a name is not a document.
 */
export function Text({ name, value, onCommit, placeholder, note, enabled = ON }: TextProps) {
  const off = enabled.state === 'off';
  return (
    <Field name={name} note={note} enabled={enabled}>
      <input
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
}

export function Check({ name, label, checked, onChange, note, warn, enabled = ON }: CheckProps) {
  const off = enabled.state === 'off';
  return (
    <Field name={name} value={checked ? 'TRUE' : 'FALSE'} note={note} warn={warn} enabled={enabled}>
      <label class="opt">
        <input
          type="checkbox"
          checked={checked}
          disabled={off}
          onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>{label}</span>
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
}

/** A segmented control with a property name over it. */
export function Choice<T extends string>(
  { name, value, options, onChange, note, warn, enabled = ON }: ChoiceProps<T>,
) {
  /* A field that is off as a whole says why once, on the field. Only a
     per-option restriction -- FASTSYNC outside maximum availability -- gets a
     pill of its own, which is what `Segmented` draws. */
  if (enabled.state === 'off') {
    return (
      <Field name={name} note={note} warn={warn} enabled={enabled}>
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
    <Field name={name} note={note} warn={warn} enabled={enabled}>
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
  return (
    <Field name={name} prose={prose} note={note} enabled={enabled}>
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
