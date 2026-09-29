/**
 * The event buttons of the Lanes layout: what can be done to a card, a data
 * centre or a link *at the moment the playhead is on*, in the column where the
 * things are.
 *
 * Two parts, both built on the action table (`break/events`) and nothing of
 * their own:
 *
 *  - `EventStrip`: the compact icons (`hoverTools`) drawn on the card at all
 *    times, not only under the pointer. Each is one slot -- the way down while
 *    the thing is up, the way back once it is down -- so the strip changes as
 *    the playhead moves: "Crash host" becomes "Restart host" once the host is
 *    down at t, and a grey icon says why in its title, as on the canvas.
 *  - `MoreMenu`: the whole grouped list (`breakBar`, the same rows and the same
 *    refusals as the canvas's context menu) as a popover beside the card that
 *    opened it. HTML rather than the canvas's foreignObject: the drawing here
 *    scrolls, and a popover inside it would be clipped by the row it hangs from.
 *
 * Every press injects at the playhead and leaves the playhead where it is
 * (`keepPlayhead`): the lanes show the whole run, and the buttons are aimed at
 * the playhead, so it may not move under a reader who is composing at t = 10 s.
 */

import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { TopologyDoc } from '@/engine';
import { GLYPH, GLYPH_SMALL } from '../common/eventIcons';
import type { CanvasTool } from '../canvas/HoverTools';
import { MenuList, walkMenu } from '../canvas/ActionBar';
import { isHTMLElement } from '../common/dom';
import { useRovingToolbar } from '../common/useRovingToolbar';
import { breakBar } from './menu';

/** One button, and the gap between two, in the drawing's units (CSS pixels: this SVG is 1:1). */
export const EV = 18;
export const EV_GAP = 2;
/** More icons than this go into the More menu only; the table offers two today. */
export const MAX_TOOLS = 3;

/** The strip's width for `n` icons and the More button. */
export const stripWidth = (n: number): number =>
  (Math.min(n, MAX_TOOLS) + 1) * EV + Math.min(n, MAX_TOOLS) * EV_GAP;

/** Taking something away: the icon is drawn in the alarm colour on hover. */
const HARMFUL: ReadonlySet<string> = new Set(['crash', 'isolate', 'shutdown', 'cut', 'stop']);
/** Bringing it back: drawn in the healthy colour whenever it is on offer, so the way back stands out. */
const MENDING: ReadonlySet<string> = new Set(['restore', 'startup', 'heal', 'reconnect', 'start']);

export interface StripProps {
  /** The strip's right edge and top, in the drawing's units. */
  right: number;
  y: number;
  /** What the buttons are about, for the group's name. */
  name: string;
  tools: readonly CanvasTool[];
  moreOpen: boolean;
  onMore: (trigger: SVGGElement) => void;
}

export function EventStrip({ right, y, name, tools, moreOpen, onMore }: StripProps): JSX.Element {
  /* Keyed by slot, not by action: a press turns "Crash" into "Restore" in the
     same place, and the same element keeps the focus through it. */
  const shown = tools.slice(0, MAX_TOOLS);
  const rove = useRovingToolbar([...shown.map((t) => t.enabled.state === 'on'), true]);
  const x0 = right - stripWidth(tools.length);
  const at = (i: number): number => x0 + i * (EV + EV_GAP);
  return (
    <g
      class="ln-ev"
      role="toolbar"
      aria-label={`Events for ${name}`}
      data-ev-for={name}
      onKeyDown={rove.onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
    >
      {shown.map((t, i) => {
        const off = t.enabled.state === 'off';
        const title = t.enabled.state === 'off' ? `${t.label} — ${t.enabled.why}` : t.label;
        const fire = (): void => { if (!off) t.run(); };
        return (
          <g
            key={i}
            ref={rove.itemRef(i)}
            class={`ln-tool${off ? ' is-off' : ''}${HARMFUL.has(t.icon) ? ' is-harm' : ''}${MENDING.has(t.icon) && !off ? ' is-mend' : ''}`}
            data-tool={t.id}
            role="button"
            aria-label={title}
            aria-disabled={off}
            tabindex={off ? -1 : rove.tabIndex(i)}
            transform={`translate(${at(i)},${y})`}
            onFocus={() => rove.onFocus(i)}
            onClick={(e) => { e.stopPropagation(); fire(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fire(); }
            }}
          >
            <title>{title}</title>
            <rect class="ln-tool-hit" width={EV} height={EV} rx={5} />
            <g class="ln-tool-ico" transform={`translate(${(EV - 12) / 2},${(EV - 12) / 2}) scale(${12 / 24})`}>
              {GLYPH_SMALL[t.icon] ?? GLYPH[t.icon]}
            </g>
          </g>
        );
      })}
      <g
        ref={rove.itemRef(shown.length)}
        class={`ln-tool ln-more${moreOpen ? ' is-open' : ''}`}
        data-tool="more"
        role="button"
        aria-label={`More events for ${name}`}
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        tabindex={rove.tabIndex(shown.length)}
        transform={`translate(${at(shown.length)},${y})`}
        onFocus={() => rove.onFocus(shown.length)}
        onClick={(e) => { e.stopPropagation(); onMore(e.currentTarget); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault(); e.stopPropagation(); onMore(e.currentTarget);
          }
        }}
      >
        <title>More events…</title>
        <rect class="ln-tool-hit" width={EV} height={EV} rx={5} />
        <circle cx={EV / 2 - 4} cy={EV / 2} r={1.2} />
        <circle cx={EV / 2} cy={EV / 2} r={1.2} />
        <circle cx={EV / 2 + 4} cy={EV / 2} r={1.2} />
      </g>
    </g>
  );
}

/* ---------------- the More popover ---------------- */

/** What opened the menu, and what it is about. */
export interface MenuTarget {
  /** The subjects, as `actionsForKey` keys: one for a card, several for a `+N` of links. */
  subjects: readonly { key: string; title: string }[];
  /** The opener's box in client coordinates; the menu hangs beside it. */
  anchor: { left: number; right: number; top: number; bottom: number };
  trigger: Element | null;
}

/** Events land on a tenth of a second: the axis is read to that, not finer. */
const snap = (t: number): number => Math.round(t * 10) / 10;

export interface MoreMenuProps {
  target: MenuTarget;
  doc: TopologyDoc;
  /** The playhead. */
  t: number;
  /** The view the menu lives in, to keep it inside. */
  view: HTMLElement | null;
  /** `restore`: put the focus back on the opener (Escape does, a press elsewhere does not). */
  onClose: (restore: boolean) => void;
}

export function MoreMenu({ target, doc, t, view, onClose }: MoreMenuProps): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const at = snap(t);
  const blocks = target.subjects.map((s) => ({ ...s, ...breakBar(doc, [s.key], at, { keepPlayhead: true }) }));
  const many = blocks.length > 1;
  const first = blocks[0];

  /* Beside the opener, kept inside the view; a list taller than the room
     scrolls in its own box. Geometry decided at run time goes through custom
     properties on a ref -- the page's CSP forbids a `style` attribute. */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || view === null) return;
    const v = view.getBoundingClientRect();
    const room = Math.max(120, v.height - 16);
    el.style.setProperty('max-height', `${room}px`);
    const h = Math.min(el.offsetHeight, room);
    const w = el.offsetWidth;
    const top = Math.max(8, Math.min(target.anchor.top - v.top - 6, v.height - h - 8));
    const left = Math.max(8, Math.min(target.anchor.right - v.left + 8, v.width - w - 8));
    el.style.setProperty('top', `${top}px`);
    el.style.setProperty('left', `${left}px`);
  });

  /* Into the menu when it opens, and out on a press elsewhere or on Escape. The
     opener is left out of "elsewhere": pressing it again is how it closes. */
  useEffect(() => {
    const el = box.current;
    const firstItem = el?.querySelector('.cv-mi-btn:not(:disabled)');
    if (isHTMLElement(firstItem)) firstItem.focus(); else el?.focus();
    const away = (e: PointerEvent): void => {
      const n = e.target as Node;
      if (el?.contains(n) || (target.trigger?.contains(n) ?? false)) return;
      onClose(false);
    };
    /* Captured and stopped: the same key on the drawing clears the selection,
       and closing a menu and forgetting what it was about are two presses. */
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, []);

  /* A row pressed injects and the menu has done its job. */
  const onClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    const b = (e.target as Element).closest('.cv-mi-btn');
    if (b !== null && !(b as HTMLButtonElement).disabled) onClose(true);
  };

  return (
    <div
      class="cv-bar cv-menu ln-menu"
      role="group"
      aria-label={`Events for ${many ? 'these links' : first?.title ?? ''}`}
      tabindex={-1}
      ref={box}
      onKeyDown={(e) => { if (box.current) walkMenu(box.current, e); }}
      onClick={onClick}
    >
      <div class="cv-bar-hd">
        <span class="cv-bar-subj">
          <span class="mono">{many ? `${blocks.length} links` : first?.title}</span>
          <span class="cv-bar-when"> · at t = {at} s</span>
        </span>
        <button type="button" class="cv-bar-x" aria-label="Close the menu" onClick={() => onClose(true)}>
          &times;
        </button>
      </div>
      <div class="ln-menu-body">
        {blocks.map((b) => (
          <div key={b.key} class="ln-menu-blk">
            {many ? <p class="ln-menu-sub mono">{b.title}</p> : null}
            <MenuList sections={b.sections} />
          </div>
        ))}
      </div>
    </div>
  );
}
