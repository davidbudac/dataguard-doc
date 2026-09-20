/**
 * A name, edited where it is drawn.
 *
 * An `<input>` in a `<foreignObject>` laid over the name line of a card or the
 * name band of a data centre -- placed by `x`/`y` in the drawing's own units,
 * the way the action bar is, because `style-src 'self'` leaves no other way to
 * put HTML at a point. It scales with the drawing, so the field is the size of
 * the text it replaces.
 *
 * `Enter` commits, `Escape` gives up, and leaving the field commits what can be
 * committed. A name that cannot be taken is refused *here*, under the field,
 * with the field still open: a toast after the field has closed makes the
 * reader start the rename again to fix one letter.
 */

import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { WhyState } from '../common/WhyPill';

export interface InlineNameProps {
  x: number;
  y: number;
  w: number;
  initial: string;
  /** Whether `raw` may be the name. An unchanged name is `on`: it is a cancel. */
  verdict: (raw: string) => WhyState;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}

const FIELD_H = 24;
const WHY_H = 44;

export function InlineName(props: InlineNameProps): JSX.Element {
  const [value, setValue] = useState(props.initial);
  const [why, setWhy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  /* One end per field: `Enter` unmounts it, and the blur that unmounting
     causes must not commit the same name a second time. */
  const done = useRef(false);

  /* Before the paint: a field that appears and takes the caret a frame later
     drops the first letter of a fast typist. */
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (raw: string, leaving: boolean): void => {
    if (done.current) return;
    const name = raw.trim();
    if (name === '' || name === props.initial) { done.current = true; props.onCancel(); return; }
    const v = props.verdict(name);
    if (v.state === 'off') {
      /* Leaving a field that holds a refused name drops the name, not the
         reader's focus: a field that traps the pointer is worse than a rename
         that did not happen. */
      if (leaving) { done.current = true; props.onCancel(); return; }
      setWhy(v.why);
      return;
    }
    done.current = true;
    props.onCommit(name);
  };

  const onKeyDown = (ev: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    /* Every key stays in the field: `Delete` here deletes a letter, not the card. */
    ev.stopPropagation();
    /* The field's own value, not the state: a key can arrive before the
       render that the last letter asked for. */
    if (ev.key === 'Enter') { ev.preventDefault(); finish(ev.currentTarget.value, false); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); done.current = true; props.onCancel(); }
  };

  return (
    <g class="tp-rename">
      <foreignObject x={props.x} y={props.y} width={Math.max(props.w, why === null ? 0 : 220)} height={FIELD_H + (why === null ? 0 : WHY_H)}>
        <div
          class="cv-rename"
          onPointerDown={(ev) => ev.stopPropagation()}
          onPointerUp={(ev) => ev.stopPropagation()}
          onClick={(ev) => ev.stopPropagation()}
          onDblClick={(ev) => ev.stopPropagation()}
        >
          <input
            ref={input}
            class={`cv-rename-in mono${why === null ? '' : ' is-bad'}`}
            type="text"
            value={value}
            spellcheck={false}
            autocomplete="off"
            aria-label={`Rename ${props.initial}`}
            aria-invalid={why !== null}
            onInput={(ev) => { setValue(ev.currentTarget.value); if (why !== null) setWhy(null); }}
            onKeyDown={onKeyDown}
            onBlur={(ev) => finish(ev.currentTarget.value, true)}
          />
          {why === null ? null : <p class="cv-rename-why" role="alert">{why}</p>}
        </div>
      </foreignObject>
    </g>
  );
}
