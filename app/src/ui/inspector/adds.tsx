/**
 * Adding to the configuration, written once and offered in three places.
 *
 * The rail's palette, the toolbar along the top of the drawing and the
 * `Add` disclosure in the inspector's header are three surfaces over one
 * table. That is the point of this module: a label, a tooltip and above all a
 * *refusal* is stated once, so the drawing and the rail can never disagree
 * about whether a standby can be added or about why it cannot.
 *
 * Every entry carries the reason it would be grey rather than a boolean, so a
 * dead button in any of the three surfaces is impossible to write here -- the
 * `WhyState` union does not admit an `off` with nothing to say.
 */

import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { SiteId, TopologyDoc } from '@/engine';
import { siteId as toSiteId } from '@/engine';
import { WhyPill } from '../common/WhyPill';
import type { WhyState } from '../common/WhyPill';
import { useRovingToolbar } from '../common/useRovingToolbar';
import { Action, Note, Pick } from './controls';
import { addDatabase, addFarSync, addHost, addLink, addObserver, addSite } from './edits';
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
export const WHY_SAME_SITE = 'A link runs between two different data centres.';
export const WHY_LINKED = 'These two data centres are linked already.';
/**
 * A link needs two ends, and a one-data-centre configuration has one to offer.
 * `WHY_SAME_SITE` would be a lie here -- the reader has not picked the same
 * data centre twice, there is no second one to pick. `WHY_NO_SITE` covers the
 * rung below it, where there is not even a first.
 */
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

/* ---------------- the rail's palette ---------------- */

export interface AddPaletteProps {
  doc: TopologyDoc;
  /** Called after any addition -- the header's disclosure folds itself away. */
  onAdded?: () => void;
}

/**
 * The palette itself, without a group header: the empty inspector wraps it in
 * one, and the header's `Add` disclosure wraps it in another. Both get the
 * same six controls, the same labels and the same refusals, because both get
 * this component.
 */
export function AddPalette({ doc, onAdded }: AddPaletteProps) {
  /* What the reader last chose is a *preference*, not the value: the document
     moves underneath this palette -- undo, a removal, a step of a lesson --
     and a picker still naming a data centre that has gone renders blank while
     the button beside it stays live and writes a dangling end. So the value is
     derived from the document every render, and the preference is honoured
     only while the document still contains it. */
  const [siteWant, setSite] = useState<string>(doc.sites[0]?.id as string ?? '');
  const [fromWant, setFrom] = useState<string>(doc.sites[0]?.id as string ?? '');
  const [toWant, setTo] = useState<string>(doc.sites[1]?.id as string ?? '');
  const ids = doc.sites.map((s) => s.id as string);
  const has = (v: string): boolean => ids.includes(v);
  const site = has(siteWant) ? siteWant : (ids[0] ?? '');
  const from = has(fromWant) ? fromWant : (ids[0] ?? '');
  /* The fallback prefers a data centre that is not `from`, so the pair starts
     and stays usable. It does *not* forbid the reader from naming `from` here:
     a select that quietly shows something other than what was picked is worse
     than one that takes the pick and says why it will not do -- and that is
     what `WHY_SAME_SITE` is for. Only the *fallback* avoids it. */
  const to = has(toWant) ? toWant : (ids.find((id) => id !== from) ?? '');
  const siteOptions = doc.sites.map((s) => ({ value: s.id as string, label: s.name }));
  const linked = doc.links.some((l) => l.scope === 'site'
    && (l.ends as [string, string]).includes(from) && (l.ends as [string, string]).includes(to));
  const done = (): void => onAdded?.();

  return (
    <>
      {/* The four one-press additions, 2x2 and full width: they are the reason
          the empty rail exists, and a row of four small buttons read as a
          toolbar of the group above them rather than as the group's content
          (ui.md SS3f). What each one does is still the button's `title`. */}
      <div class="pal pal-adds">
        {ADD_ACTIONS.map((a) => (
          <Action
            key={a.key}
            label={a.label}
            title={a.title}
            enabled={a.enabled(doc)}
            onClick={() => { a.run(); done(); }}
          />
        ))}
      </div>
      {/* The second rank, under a hairline: both of these need a data centre
          named before the button means anything. */}
      <div class="pal pal-more">
        <Pick
          name="Host in"
          prose
          value={site}
          options={siteOptions}
          onChange={setSite}
        />
        <Action
          label="+ Host"
          title="Add an empty host to that data centre, ready for a database or an observer."
          enabled={site === '' ? off(WHY_NO_SITE) : ON}
          onClick={() => { addHost(toSiteId(site)); done(); }}
        />
      </div>
      <div class="pal">
        <Pick name="Link from" prose value={from} options={siteOptions} onChange={setFrom} />
        <Pick name="to" prose value={to} options={siteOptions} onChange={setTo} />
        <Action
          label="+ Link"
          title="Add a site link between those two data centres, at zero round trip."
          /* Four rungs, narrowest last. The first two used to be missing, so a
             document with fewer than two data centres left `to` blank against
             options that hold no blank -- and the button beside that blank was
             live, and wrote an end no data centre answers to. */
          enabled={ids.length === 0
            ? off(WHY_NO_SITE)
            : to === ''
              ? off(WHY_ONE_SITE)
              : from === to
                ? off(WHY_SAME_SITE)
                : linked ? off(WHY_LINKED) : ON}
          onClick={() => { addLink(toSiteId(from), toSiteId(to)); done(); }}
        />
      </div>
      <Note>
        A new database lands in a data centre that has none, on a host of its own, and
        the primary is given destination properties for it. A new observer gets a host of
        its own too: an observer is never deployed on a database server or cluster.
      </Note>
    </>
  );
}

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
              {a.short}
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
