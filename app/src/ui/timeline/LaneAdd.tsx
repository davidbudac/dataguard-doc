/**
 * Adding an event from the timeline's own lane.
 *
 * In Split, adding an event meant moving the playhead and then finding the
 * card on the canvas above. Here the lane offers it: a small `+` beside the
 * playhead on each lane whose subject has something to do, and a double-click
 * on the lane for the same list at the pointer. Both open Lanes' grouped menu
 * (`MoreMenu`, the canvas's context menu's own rows, refusals and header) for
 * that lane's subject *at the playhead* -- the playhead stays the one clock,
 * and a press injects there and leaves it where it is (`keepPlayhead`), so a
 * reader composing at t = 10 s is not moved.
 *
 * Three parts, split because the drawing is SVG and the menu is HTML:
 *
 *  - `useLaneAdd`: the state (which lane is hovered, which menu is open) and
 *    which lanes offer anything;
 *  - `LaneAddButtons`: the buttons, drawn last in the SVG so they sit above
 *    the playhead;
 *  - `LaneAddMenu`: the popover, rendered into the window's `body` so the
 *    dock that holds the timeline -- short, and scrolling -- cannot clip it or
 *    paint over it.
 *
 * A lane's `id` is the key `actionsForKey` reads for a member, an observer and
 * a link alike; a lane whose subject offers nothing gets no button, which is
 * also what a key that names nothing does.
 */

import { render } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TopologyDoc } from '@/engine';
import { MoreMenu } from '../break/lanes-events';
import type { MenuTarget } from '../break/lanes-events';
import { breakBar } from '../break/menu';
import { isElement } from '../common/dom';
import { fmt } from './build';
import type { TimelineLane, TimelineModel } from './build';
import '@/styles/timeline.css';

/** The button's radius, and its gap from the playhead's line. */
const R = 8;
const GAP = 5;

/** Events land on a tenth of a second (the same rounding as the menu's). */
const snap = (t: number): number => Math.round(t * 10) / 10;

interface Open {
  /** The lane the menu is about, and what one is keyed by. */
  lane: TimelineLane;
  target: MenuTarget;
  body: HTMLElement;
}

export interface LaneAdd {
  enabled: boolean;
  doc: TopologyDoc;
  /** The playhead, clamped to the axis. */
  t: number;
  model: TimelineModel;
  /** The lanes that offer at least one action at the playhead, by id. */
  offered: ReadonlyMap<string, TimelineLane>;
  hover: string | null;
  open: Open | null;
  /** Feed it the target of every pointer move over the plot (null: left it). */
  track: (target: EventTarget | null) => void;
  /** A double-click on the plot. */
  onDblClick: (e: JSX.TargetedMouseEvent<HTMLDivElement>) => void;
  /** Open (or, on the same trigger again, close) the menu for a lane. */
  openFor: (lane: TimelineLane, trigger: Element) => void;
  close: (restore: boolean) => void;
}

const laneOf = (target: EventTarget | null): string | null =>
  isElement(target) ? target.closest('[data-lane]')?.getAttribute('data-lane') ?? null : null;

export function useLaneAdd(p: {
  enabled: boolean;
  model: TimelineModel;
  doc: TopologyDoc;
  tNow: number;
}): LaneAdd {
  const { model, doc } = p;
  const enabled = p.enabled && model.lanes.length > 0;
  const t = model.scale.clampT(p.tNow);
  const at = snap(t);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);

  /* Every lane, asked once per doc and tenth of a second: the same call the
     menu makes, so a button is there exactly when its menu has a row. */
  const offered = useMemo(() => {
    const out = new Map<string, TimelineLane>();
    if (!enabled) return out;
    for (const lane of model.lanes) {
      if (lane.kind === 'application') continue;
      if (breakBar(doc, [lane.id], at).sections.length > 0) out.set(lane.id, lane);
    }
    return out;
  }, [enabled, doc, model.lanes, at]);

  const track = (target: EventTarget | null): void => {
    if (!enabled) return;
    const id = laneOf(target);
    if (id !== hover) setHover(id);
  };

  const close = (restore: boolean): void => {
    const trigger = open?.target.trigger;
    setOpen(null);
    if (restore && trigger instanceof Element && 'focus' in trigger) (trigger as HTMLElement).focus();
  };

  const openFor = (lane: TimelineLane, trigger: Element): void => {
    if (open?.target.trigger === trigger) { setOpen(null); return; }
    const r = trigger.getBoundingClientRect();
    setOpen({
      lane,
      body: trigger.ownerDocument.body,
      target: {
        subjects: [{ key: lane.id, title: lane.name }],
        anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        trigger,
      },
    });
  };

  const onDblClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (!enabled || !isElement(e.target)) return;
    /* The button is its own way in; a second press on it is not a request. */
    if (e.target.closest('.tl-lane-add') !== null) return;
    const lane = offered.get(laneOf(e.target) ?? '');
    if (lane === undefined) return;
    /* On the plot, not in the gutter with the names. */
    const svg = e.currentTarget.querySelector('svg');
    const box = svg?.getBoundingClientRect();
    if (box !== undefined && box.width > 0) {
      const x = (e.clientX - box.left) * (model.width / box.width);
      if (x < model.scale.plotL - 4 || x > model.scale.plotR + 4) return;
    }
    setOpen({
      lane,
      body: e.target.ownerDocument.body,
      target: {
        subjects: [{ key: lane.id, title: lane.name }],
        anchor: { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY },
        trigger: null,
      },
    });
  };

  /* The menu is placed beside what opened it, in client coordinates: the dock
     scrolling or the window resizing would leave it hanging, so either shuts
     it. The menu's own list scrolling is not the dock scrolling. */
  useEffect(() => {
    if (open === null) return undefined;
    const dom = open.body.ownerDocument;
    const win = dom.defaultView ?? window;
    const shut = (e: Event): void => {
      if (e.type === 'scroll' && isElement(e.target) && e.target.closest('.ln-menu') !== null) return;
      setOpen(null);
    };
    dom.addEventListener('scroll', shut, true);
    win.addEventListener('resize', shut);
    return () => {
      dom.removeEventListener('scroll', shut, true);
      win.removeEventListener('resize', shut);
    };
  }, [open]);

  return {
    enabled, doc, t, model, offered, hover, open: enabled ? open : null,
    track, onDblClick, openFor, close,
  };
}

/* ---------------- the buttons ---------------- */

/** Where the button sits in the lane's row: beside the playhead's line, on the side with room. */
function place(model: TimelineModel, lane: TimelineLane, t: number): { x: number; y: number } {
  const { scale } = model;
  const x = Math.round(scale.x(t) * 10) / 10;
  const right = x + GAP + R;
  return {
    x: right + R <= scale.plotR ? right : x - GAP - R,
    y: lane.y + lane.height / 2,
  };
}

export function LaneAddButtons({ add }: { add: LaneAdd }): JSX.Element | null {
  if (!add.enabled || add.offered.size === 0) return null;
  const { model, t } = add;
  return (
    <g class="tl-lane-adds">
      {model.lanes.map((lane) => {
        if (!add.offered.has(lane.id)) return null;
        const opened = add.open?.lane.id === lane.id;
        const label = `Add an event to ${lane.name} at t = ${fmt(t)} s`;
        const { x, y } = place(model, lane, t);
        const r = Math.min(R, Math.max(4, lane.height / 2 - 2));
        const press = (el: SVGGElement): void => add.openFor(lane, el);
        return (
          <g
            key={lane.key}
            class={`tl-lane-add${add.hover === lane.id || opened ? ' is-shown' : ''}${opened ? ' is-open' : ''}`}
            data-lane={lane.id}
            role="button"
            /* Lower case on an SVG element: see NodeCard. */
            tabindex={0}
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={opened}
            transform={`translate(${x},${y})`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); press(e.currentTarget); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault(); e.stopPropagation(); press(e.currentTarget);
              }
            }}
          >
            <title>{label}</title>
            <circle class="tl-lane-add-bg" r={r} />
            <path class="tl-lane-add-ico" d={`M${-r * 0.45},0 H${r * 0.45} M0,${-r * 0.45} V${r * 0.45}`} />
          </g>
        );
      })}
    </g>
  );
}

/* ---------------- the menu ---------------- */

/**
 * Render `children` into the `body` of the window they belong to. A second
 * Preact root rather than `preact/compat`'s portal: importing compat rewires
 * `onChange` (common/popout.tsx). The popover is `position: fixed`, but the
 * dock it opens from is a stacking context of its own, so only a node outside
 * it can stand above the floating cards.
 */
function BodyPortal({ body, children }: { body: HTMLElement; children: ComponentChildren }): null {
  const host = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = body.ownerDocument.createElement('div');
    el.className = 'tl-add-portal';
    body.appendChild(el);
    host.current = el;
    return () => { render(null, el); el.remove(); host.current = null; };
  }, [body]);
  useLayoutEffect(() => {
    if (host.current !== null) render(<>{children}</>, host.current);
  });
  return null;
}

export function LaneAddMenu({ add }: { add: LaneAdd }): JSX.Element | null {
  const { open } = add;
  if (!add.enabled || open === null) return null;
  return (
    <BodyPortal body={open.body}>
      <MoreMenu
        key={open.lane.key}
        target={open.target}
        doc={add.doc}
        t={add.t}
        view={open.body}
        fixed
        onClose={add.close}
      />
    </BodyPortal>
  );
}
