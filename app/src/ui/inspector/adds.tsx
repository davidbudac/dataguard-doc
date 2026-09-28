/**
 * Adding to the configuration: the toolbar along the top of the drawing.
 *
 * It used to be one table offered in three places -- a palette on the empty
 * rail, an `Add` disclosure in the rail's header, and this toolbar. Three
 * surfaces for four buttons was the clutter, so the toolbar is the one place
 * that adds (ui.md SS3i). `+ Host` lives on a data centre's form and a site
 * link on its form or its port, because both need a data centre named first.
 *
 * Every entry carries the reason it would be grey rather than a boolean, so a
 * dead button is impossible to write here -- the `WhyState` union does not
 * admit an `off` with nothing to say.
 */

import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { SiteId, TopologyDoc } from '@/engine';
import { siteId as toSiteId } from '@/engine';
import { WhyPill } from '../common/WhyPill';
import type { WhyState } from '../common/WhyPill';
import { useRovingToolbar } from '../common/useRovingToolbar';
import { addDatabase, addFarSync, addObserver, addSite } from './edits';
import { off, ON } from './why';
import { toast } from '@/state/view';
import { endPlacing, placeOver, placing, renaming, siteAt } from '../canvas/place';

/**
 * A member, a far sync instance and an observer all land in a data centre, so
 * a configuration with none has nowhere to put them. It cannot happen from
 * the presets; it can happen after the last data centre is removed, and a
 * button that silently does nothing is the one thing this page may not do.
 */
export const WHY_NO_SITE = 'There is no data centre to put it in yet.';
/** A link needs two ends, and a one-data-centre configuration has one to offer. */
export const WHY_ONE_SITE = 'A link needs a second data centre.';

export interface AddAction {
  key: string;
  /** The rail's wording, where there is room for the noun in full. */
  label: string;
  /** The same act in the corner of the drawing, where there is not. */
  short: string;
  /** What it will do, as a tooltip on the toolbar's small buttons. */
  title: string;
  /**
   * Adds it and returns the key it was given. `where` is the data centre a
   * chip was dropped on; without it the placement is automatic.
   */
  run: (where?: SiteId) => string | null;
  /** True when a drop has to land on a data centre to mean anything. */
  needsWhere: boolean;
  enabled: (doc: TopologyDoc) => WhyState;
}

const needsSite = (doc: TopologyDoc): WhyState =>
  (doc.sites.length === 0 ? off(WHY_NO_SITE) : ON);

/**
 * The four additions that need no argument. `+ Host` and `+ Link` are not
 * here because they take a data centre (or two) to be told about first, and a
 * picker does not belong on a four-button toolbar.
 */
export const ADD_ACTIONS: readonly AddAction[] = [
  {
    key: 'database',
    label: '+ Standby database',
    short: '+ Standby',
    title: 'Add a physical standby on a host of its own, in a data centre that has no database yet.',
    run: (where) => addDatabase(where),
    needsWhere: true,
    enabled: needsSite,
  },
  {
    key: 'farsync',
    label: '+ Far sync instance',
    short: '+ Far sync',
    title: 'Add a far sync instance: no role, no apply, no open mode.',
    run: (where) => addFarSync(where),
    needsWhere: true,
    enabled: needsSite,
  },
  {
    key: 'observer',
    label: '+ Observer',
    short: '+ Observer',
    title: 'Add an observer on a host of its own -- an observer is never deployed on a database server or cluster.',
    run: (where) => addObserver(where),
    needsWhere: true,
    enabled: needsSite,
  },
  {
    key: 'site',
    label: '+ Data centre',
    short: '+ Data centre',
    title: 'Add a data centre, and a site link from it to every data centre already drawn.',
    run: () => addSite(),
    needsWhere: false,
    enabled: () => ON,
  },
];

/* ---------------- the toolbar above the drawing ---------------- */

/**
 * The same four additions along the top of the stage, so the reader who is
 * looking at the drawing does not have to find the rail -- and does not have
 * to clear a selection first, which is what the rail used to demand.
 *
 * A real `role="toolbar"` of real buttons, with the keyboard contract that
 * role announces -- one tab stop, arrows between the additions inside it. The
 * contract itself lives in `common/useRovingToolbar`, because the zoom ladder
 * beside this strip has to keep exactly the same one.
 *
 * Every button carries what it will do as a `title`, and a refusal still rides
 * beside the button rather than living only in the tooltip.
 *
 * A press adds it where the page thinks best; a *drag* carries it to the data
 * centre it is dropped on. Either way the new thing is selected with its name
 * open for typing, so adding and naming are one gesture.
 */
const PLACE_THRESHOLD = 4;

/**
 * A small glyph per addition, for the palette over the canvas. Decoration
 * only: the button's text is still its name, so what a screen reader and a
 * test read is the same `+ Standby` the docked strip prints.
 */
const ICON: Record<string, JSX.Element> = {
  database: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </svg>
  ),
  farsync: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M1.5 8h4M10.5 8h4M12 5.5 14.5 8 12 10.5" />
    </svg>
  ),
  observer: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  site: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke-dasharray="2.5 2" />
      <path d="M8 6v4M6 8h4" />
    </svg>
  ),
};
export const WHY_DROP_ON_SITE = 'Drop it on a data centre to put it there.';

export function AddToolbar({ doc }: { doc: TopologyDoc }) {
  const states = ADD_ACTIONS.map((a) => a.enabled(doc));
  /* A disabled button cannot be focused, so parking the tab stop on one would
     make the whole strip unreachable by Tab. `+ Data centre` is never off, so
     there is always somewhere to park it. */
  const roving = useRovingToolbar(states.map((w) => w.state !== 'off'));
  const press = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null);
  /* A drag ends in a click on the button that captured it; that click is the
     tail of the drag, not a press. */
  const swallow = useRef(false);
  const ghost = useRef<HTMLDivElement | null>(null);
  const at = useRef({ x: 0, y: 0 });
  const follow = (x: number, y: number): void => {
    at.current = { x, y };
    ghost.current?.style.setProperty('left', `${x}px`);
    ghost.current?.style.setProperty('top', `${y}px`);
  };
  const added = (key: string | null): void => { if (key !== null) renaming.value = key; };

  const onDown = (a: AddAction, ev: JSX.TargetedPointerEvent<HTMLButtonElement>): void => {
    if (ev.button !== 0) return;
    press.current = { key: a.key, x: ev.clientX, y: ev.clientY, moved: false };
  };
  const onMove = (a: AddAction, ev: JSX.TargetedPointerEvent<HTMLButtonElement>): void => {
    const p = press.current;
    if (p === null || p.key !== a.key) return;
    if (!p.moved && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < PLACE_THRESHOLD) return;
    if (!p.moved) {
      p.moved = true;
      ev.currentTarget.setPointerCapture?.(ev.pointerId);
      placing.value = a.key;
    }
    placeOver.value = a.needsWhere ? siteAt(ev.clientX, ev.clientY) : null;
    follow(ev.clientX, ev.clientY);
  };
  const onUp = (a: AddAction, ev: JSX.TargetedPointerEvent<HTMLButtonElement>): void => {
    const p = press.current;
    press.current = null;
    if (p === null || !p.moved) return;
    swallow.current = true;
    /* Only the click this release produces: one that never comes (a release
       off the button, a synthetic event) must not eat the next real press. */
    setTimeout(() => { swallow.current = false; }, 0);
    ev.currentTarget.releasePointerCapture?.(ev.pointerId);
    const over = a.needsWhere ? siteAt(ev.clientX, ev.clientY) : null;
    endPlacing();
    if (a.needsWhere && over === null) {
      toast.value = { kind: 'info', text: WHY_DROP_ON_SITE };
      return;
    }
    added(a.run(over === null ? undefined : toSiteId(over)));
  };
  const onCancel = (): void => { press.current = null; endPlacing(); };
  const dragged = ADD_ACTIONS.find((a) => a.key === placing.value) ?? null;

  return (
    <div
      class="cv-add"
      role="toolbar"
      aria-label="Add to the configuration"
      onKeyDown={roving.onKeyDown}
    >
      {ADD_ACTIONS.map((a, i) => {
        const why = states[i] as WhyState;
        const isOff = why.state === 'off';
        return (
          <span class="ctl-off" key={a.key}>
            <button
              type="button"
              class={`btn${isOff ? ' is-faded' : ''}${placing.value === a.key ? ' is-placing' : ''}`}
              disabled={isOff}
              title={`${a.title} Press to add it, or drag it onto the drawing.`}
              tabIndex={roving.tabIndex(i)}
              ref={roving.itemRef(i)}
              onFocus={() => roving.onFocus(i)}
              onPointerDown={(ev) => onDown(a, ev)}
              onPointerMove={(ev) => onMove(a, ev)}
              onPointerUp={(ev) => onUp(a, ev)}
              onPointerCancel={onCancel}
              onClick={() => {
                if (swallow.current) { swallow.current = false; return; }
                added(a.run());
              }}
            >
              {ICON[a.key] ?? null}
              <span class="pal-lbl">{a.short}</span>
            </button>
            <WhyPill why={why} />
          </span>
        );
      })}
      {dragged === null ? null : (
        <div
          class="cv-ghost" aria-hidden="true"
          ref={(el) => { ghost.current = el; if (el) follow(at.current.x, at.current.y); }}
        >{dragged.short}</div>
      )}
    </div>
  );
}
