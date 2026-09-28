/**
 * The event glyphs: one small stroked picture per kind of thing Break can do.
 *
 * The canvas's hover tools and the timeline's event markers draw from this one
 * table, so the icon a reader clicked on a card is the icon the timeline puts
 * over that event's number.
 */

import type { JSX } from 'preact';
import type { TimedEvent } from '@/engine';

export type EventIconName = 'crash' | 'restore' | 'isolate' | 'reconnect' | 'shutdown' | 'startup'
  | 'cut' | 'heal' | 'stop' | 'start'
  | 'switchover' | 'failover' | 'reinstate' | 'master' | 'disable' | 'lag';

/* 24-unit glyphs, stroked, in the canvas's own icon style. */
export const GLYPH: Record<EventIconName, JSX.Element> = {
  crash: <path d="M13,2 L4.5,13.5 H11 L10,22 L19.5,10 H13 Z" />,
  restore: <path d="M3.5,12 A8.5,8.5 0 1,0 6,6 M3.5,3.5 V8.5 H8.5" />,
  isolate: (
    <>
      <path d="M9.5,14.5 L7,17 A3.2,3.2 0 0,1 2.5,12.5 L5,10" />
      <path d="M14.5,9.5 L17,7 A3.2,3.2 0 0,1 21.5,11.5 L19,14" />
      <path d="M8.5,2.5 V5.5 M2.5,8.5 H5.5 M15.5,21.5 V18.5 M21.5,15.5 H18.5" />
    </>
  ),
  reconnect: (
    <>
      <path d="M10.5,13.5 A4.5,4.5 0 0,0 17,13.8 L20,10.8 A4.5,4.5 0 0,0 13.6,4.4 L12,6" />
      <path d="M13.5,10.5 A4.5,4.5 0 0,0 7,10.2 L4,13.2 A4.5,4.5 0 0,0 10.4,19.6 L12,18" />
    </>
  ),
  shutdown: <path d="M12,2.5 V11.5 M17.8,6.2 A8.2,8.2 0 1,1 6.2,6.2" />,
  startup: <path d="M7.5,4.5 L19,12 L7.5,19.5 Z" />,
  cut: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20,4 L8.2,15.8 M14.5,14.5 L20,20 M8.2,8.2 L12,12" />
    </>
  ),
  heal: (
    <>
      <path d="M10.5,13.5 A4.5,4.5 0 0,0 17,13.8 L20,10.8 A4.5,4.5 0 0,0 13.6,4.4 L12,6" />
      <path d="M13.5,10.5 A4.5,4.5 0 0,0 7,10.2 L4,13.2 A4.5,4.5 0 0,0 10.4,19.6 L12,18" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  start: <path d="M7.5,4.5 L19,12 L7.5,19.5 Z" />,
  switchover: <path d="M4,8 H18 M14,4 L18,8 L14,12 M20,16 H6 M10,12 L6,16 L10,20" />,
  failover: <path d="M3,12 H17 M12,6 L18,12 L12,18 M21,4 V20" />,
  reinstate: <path d="M20.5,12 A8.5,8.5 0 1,1 18,6 M20.5,3.5 V8.5 H15.5 M9,12 L11.2,14.2 L15.5,9.8" />,
  master: (
    <>
      <path d="M2.5,12 C5.5,6.8 8.6,4.6 12,4.6 s6.5,2.2 9.5,7.4 C18.5,17.2 15.4,19.4 12,19.4 s-6.5,-2.2 -9.5,-7.4 Z" />
      <circle cx="12" cy="12" r="3.1" />
    </>
  ),
  disable: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6,6 L18,18" />
    </>
  ),
  lag: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12,7 V12 L15.5,14" />
    </>
  ),
};


/** The icon that pictures an injected event on the timeline. */
export function eventIcon(kind: TimedEvent['kind']): EventIconName {
  switch (kind) {
    case 'host.down': case 'site.down': return 'crash';
    case 'host.up': case 'site.up': return 'restore';
    case 'link.cut': case 'partition': return 'cut';
    case 'link.heal': return 'heal';
    case 'member.down': case 'instance.down': return 'shutdown';
    case 'member.up': case 'instance.up': return 'startup';
    case 'observer.stop': return 'stop';
    case 'observer.start': return 'start';
    case 'cmd.switchover': return 'switchover';
    case 'cmd.failover': return 'failover';
    case 'cmd.reinstate': return 'reinstate';
    case 'cmd.setMasterObserver': return 'master';
    /* Apply starts on the instance named: the start-up glyph. */
    case 'cmd.setApplyInstance': return 'startup';
    case 'cmd.disableFsfo': return 'disable';
    case 'lag.set': return 'lag';
  }
}
