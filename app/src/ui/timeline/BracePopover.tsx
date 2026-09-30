/**
 * The setting behind a brace on the Detailed timeline: its label as a button,
 * and the card that button opens.
 *
 * A brace under the axis that IS one setting (`tuneForBrace`, listed by
 * `useTuneHandles`) keeps its name and value where the drawing puts them, and
 * gains a control laid over them: `BraceLabel` makes that label a button with a
 * hover and focus ring and a caret on the value line. Pressing it opens
 * `BracePopover`, an HTML card anchored over the label: the setting's name, its
 * number box and unit, the inspector's one sentence for it and -- for the
 * threshold, which is the one clock with a second setting bound to it -- the lag
 * limit beside it with its reason when it is greyed. It closes on Escape, on a
 * press outside it and on the cross, and gives focus back to the label. It is
 * placed from the label's own box, in the body's coordinates, by custom
 * properties written through a ref (`style-src 'self'` has no other way).
 *
 * The grips on the braces are the other way to the same setting (drag one and
 * the run follows); a brace that is not one setting keeps its plain label. The
 * edits are the inspector's own setters wrapped in `tuned(...)`: `applyTune` for
 * the clock, `setFsfoLagLimit` for the lag limit.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { lagLimitOf } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { WhyPill } from '../common/WhyPill';
import { setFsfoLagLimit } from '../inspector/edits';
import { APPLY_LAG_NOTE, lagLimitNote, ROLE_TRANSITION_NOTE, THRESHOLD_NOTE } from '../inspector/notes';
import { lagLimitGate } from '../inspector/why';
import { approxW } from '../canvas/measure';
import { useDismiss } from '../break/RunBar';
import type { TimelineBrace } from './build';
import { TuneNumber } from './TuneNumber';
import { applyTune, tuned } from './tune';
import type { Tune, TuneId } from './tune';
import type { TuneHandle } from './tune-handles';

/** The popover's width, and the margin it keeps from the view's edge. */
const POP_W = 300;
const EDGE = 8;

/* `clientTiming` is the small timeline's own tune (the connect string's retry window) and never a brace under this axis. */
const NOTE: Partial<Record<TuneId, string>> = {
  threshold: THRESHOLD_NOTE,
  roleTransition: ROLE_TRANSITION_NOTE,
  applyLag: APPLY_LAG_NOTE,
};

/** The number box's accessible name: an apply lag names its standby, as the strip's does. */
const fieldLabel = (t: Tune): string => (t.member === undefined ? t.name : `${t.name} · ${t.member as string}`);

/** The control laid over a tunable brace's label: a hit area with a ring, and the caret. */
export function BraceLabel({ brace, open, onOpen }: {
  brace: TimelineBrace; open: boolean; onOpen: (trigger: SVGGElement) => void;
}) {
  const nameW = approxW(brace.name, 11, brace.mono);
  const valW = approxW(brace.val, 10.5, true);
  const w = Math.round(Math.max(nameW, valW + 18) + 12);
  return (
    <g
      class={open ? 'ln-bl is-open' : 'ln-bl'}
      role="button"
      tabindex={0}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${brace.name}, ${brace.val}: change`}
      data-tip={`${brace.name} — ${brace.val}. Press to change it.`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onOpen(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e.currentTarget); }
      }}
    >
      <rect class="ln-bl-hit" x={brace.lx - w / 2} y={brace.y + 13} width={w} height={37} rx={5} />
      <text class="ln-bl-hint" x={brace.lx + valW / 2 + 7} y={brace.y + 41} aria-hidden="true">▾</text>
    </g>
  );
}

/** The card over the label: the setting, its note and (for the threshold) the lag limit beside it. */
export function BracePopover({ handle, doc, anchor, body, disabled, onClose }: {
  handle: TuneHandle; doc: TopologyDoc; anchor: Element; body: HTMLElement | null; disabled: boolean;
  onClose: () => void;
}) {
  const { tune } = handle;
  const host = useRef<HTMLDivElement>(null);

  /* The label is part of "inside": pressing it while the card is open is the label's own toggle. */
  const inside = useMemo(() => ({
    current: { contains: (n: Node | null) => host.current?.contains(n) === true || anchor.contains(n) } as unknown as HTMLElement,
  }), [anchor]);
  const close = (): void => {
    const at = document.activeElement;
    if (host.current?.contains(at) || at === document.body) (anchor as HTMLElement).focus?.();
    onClose();
  };
  useDismiss(true, inside, close);

  /* Placed over the label, in the body's own coordinates: above it, or below where there is no room above. */
  useLayoutEffect(() => {
    const el = host.current;
    if (el === null || body === null) return;
    const a = anchor.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    const cx = a.left + a.width / 2 - b.left + body.scrollLeft;
    const x = Math.max(EDGE + body.scrollLeft, Math.min(cx - POP_W / 2, body.scrollLeft + b.width - POP_W - EDGE));
    const above = a.top - b.top + body.scrollTop - 8;
    const flip = above - el.offsetHeight < body.scrollTop;
    el.classList.toggle('is-below', flip);
    el.style.setProperty('--x', `${Math.round(x)}px`);
    el.style.setProperty('--y', `${Math.round(flip ? a.bottom - b.top + body.scrollTop + 8 : above)}px`);
  }, [anchor, body, tune.value]);
  useEffect(() => { host.current?.querySelector('input')?.focus(); }, []);

  const gate = lagLimitGate(doc);
  return (
    <div class="ln-pop float-card" ref={host} role="dialog" aria-label={tune.name}>
      <header class="ln-pop-hd">
        <span class={tune.mono ? 'ln-pop-t mono' : 'ln-pop-t'}>{tune.name}</span>
        <button type="button" class="ln-pop-x" aria-label="Close" title="Close" onClick={close}>✕</button>
      </header>
      <label class="ln-pop-f">
        <TuneNumber
          bound={tune.bound} value={tune.value} label={fieldLabel(tune)} disabled={disabled}
          onValue={(v) => applyTune(tune, v)}
        />
        <span class="tune-u">s</span>
      </label>
      <p class="ln-pop-note">{NOTE[tune.id]}</p>
      {tune.id === 'threshold' ? (
        <div class={gate.state === 'off' ? 'ln-pop-f2 is-off' : 'ln-pop-f2'}>
          <label class="ln-pop-f" title={lagLimitNote(doc)}>
            <span class="ln-pop-t mono">FastStartFailoverLagLimit</span>
            <TuneNumber
              bound="lagLimitSeconds" value={lagLimitOf(doc)} label="FastStartFailoverLagLimit"
              disabled={disabled || gate.state === 'off'} onValue={(v) => tuned(() => setFsfoLagLimit(v))}
            />
            <span class="tune-u">s</span>
          </label>
          <WhyPill why={gate} />
        </div>
      ) : null}
    </div>
  );
}
