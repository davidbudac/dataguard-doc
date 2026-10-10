/** Editing constraints, not Oracle rules: preserve related event sequences. */
import { eventPriority } from '@/engine';
import type { TimedEvent, TopologyDoc } from '@/engine';

export const MAX_EVENT_TIME = 900;
export const snapEventTime = (at: number): number => Math.round(at * 10) / 10;

/** Include containment so a host recovery cannot cross its site's recovery. */
function subjects(doc: TopologyDoc, e: TimedEvent): string[] {
  const host = (id: string): string[] => [`host:${id}`];
  const member = (id: string): string[] => [
    `member:${id}`, ...doc.members.find((m) => m.id === id)?.instances.flatMap((i) => host(i.host)) ?? [],
  ];
  switch (e.kind) {
    case 'host.down': case 'host.up': return host(e.host);
    case 'site.down': case 'site.up': return [
      `site:${e.site}`, ...doc.hosts.filter((h) => h.site === e.site).flatMap((h) => host(h.id)),
    ];
    case 'member.down': case 'member.up': return member(e.member);
    case 'instance.down': case 'instance.up': {
      const instance = doc.members.find((m) => m.id === e.member)?.instances.find((i) => i.name === e.instance);
      return [`instance:${e.member}:${e.instance}`, ...(instance ? host(instance.host) : [])];
    }
    case 'observer.stop': case 'observer.start': {
      const observer = doc.observers.find((o) => o.id === e.observer);
      return [`observer:${e.observer}`, ...(observer ? host(observer.host) : [])];
    }
    case 'link.cut': case 'link.heal': return [`link:${e.link}`];
    case 'partition': return ['partition', ...doc.links.map((l) => `link:${l.id}`)];
    case 'cmd.switchover': case 'cmd.failover': case 'cmd.reinstate': case 'cmd.disableFsfo':
      return ['role-command'];
    case 'cmd.setMasterObserver': return ['master-command'];
    /* Moving apply is ordered against the instance it names starting and stopping. */
    case 'cmd.setApplyInstance': return [`apply:${e.member}`, `instance:${e.member}:${e.instance}`];
    case 'lag.set': return [`lag:${e.member}`];
  }
}

export interface EventTimeBounds { min: number; max: number }

export function eventTimeBounds(doc: TopologyDoc, index: number): EventTimeBounds {
  const event = doc.events[index];
  if (!event) return { min: 0, max: 0 };
  const keys = new Set(subjects(doc, event));
  let min = 0;
  let max = MAX_EVENT_TIME;
  doc.events.forEach((other, i) => {
    if (i === index || !subjects(doc, other).some((key) => keys.has(key))) return;
    // Existing ties remain valid; distinct related events retain a 0.1 s gap.
    const gap = other.at === event.at ? 0 : 0.1;
    if (i < index) min = Math.max(min, snapEventTime(other.at + gap));
    else max = Math.min(max, snapEventTime(other.at - gap));
  });
  return { min, max };
}

/**
 * Where a drag may take an event: inside its related-event bounds, and no
 * further than its neighbours in the schedule, so a drag never reorders the
 * list -- it stops at the event before or after rather than passing it. A tie
 * with a neighbour is allowed only where the sort keeps the two in order.
 */
export function eventDragBounds(doc: TopologyDoc, index: number): EventTimeBounds {
  const event = doc.events[index];
  if (!event) return { min: 0, max: 0 };
  let { min, max } = eventTimeBounds(doc, index);
  const prev = doc.events[index - 1];
  const next = doc.events[index + 1];
  if (prev) min = Math.max(min, snapEventTime(prev.at + (eventPriority(prev) <= eventPriority(event) ? 0 : 0.1)));
  if (next) max = Math.min(max, snapEventTime(next.at - (eventPriority(event) <= eventPriority(next) ? 0 : 0.1)));
  return { min, max: Math.max(min, max) };
}

export function eventTimeRefusal(doc: TopologyDoc, index: number, at: number): string | null {
  if (!doc.events[index]) return 'This event is no longer in the sequence.';
  if (!Number.isFinite(at) || at < 0 || at > MAX_EVENT_TIME) return 'Choose a time from 0 to 900 s.';
  const { min, max } = eventTimeBounds(doc, index);
  if (at < min || at > max) return `Keep related events in order; allowed time: ${min}–${max} s.`;
  return null;
}

/** Swap adjacent time slots; equal times have no meaningful earlier/later slot. */
export function reorderRefusal(doc: TopologyDoc, index: number, direction: -1 | 1): string | null {
  const event = doc.events[index];
  const neighbor = doc.events[index + direction];
  if (!event || !neighbor) return direction === -1 ? 'Already first.' : 'Already last.';
  if (event.at === neighbor.at) return 'Same time: change a time to separate these events.';
  return eventTimeRefusal(doc, index, neighbor.at)
    ?? eventTimeRefusal(doc, index + direction, event.at);
}
