/**
 * Failure and command events, and the member/observer state vocabulary --
 * engine design SS4.
 *
 * Events are data: a scenario is a list of them, the URL carries them, and the
 * epoch loop consumes them in a deterministic order.
 */

import type { HostId, LinkId, MemberId, ObserverId, Seconds, SiteId } from '../ids';

export type EventBody =
  | { kind: 'host.down'; host: HostId }
  | { kind: 'host.up'; host: HostId }
  | { kind: 'site.down'; site: SiteId }
  | { kind: 'site.up'; site: SiteId }
  | { kind: 'link.cut'; link: LinkId }
  | { kind: 'link.heal'; link: LinkId }
  | { kind: 'partition'; groups: HostId[][] }
  | { kind: 'instance.down'; member: MemberId; instance: string }
  | { kind: 'instance.up'; member: MemberId; instance: string }
  | { kind: 'member.down'; member: MemberId }
  | { kind: 'member.up'; member: MemberId }
  | { kind: 'observer.stop'; observer: ObserverId }
  | { kind: 'observer.start'; observer: ObserverId }
  | { kind: 'cmd.switchover'; to: MemberId }
  | { kind: 'cmd.failover'; to: MemberId; immediate?: boolean }
  | { kind: 'cmd.reinstate'; member: MemberId }
  | { kind: 'cmd.setMasterObserver'; observer: ObserverId }
  /** EDIT DATABASE ... SET STATE='APPLY-ON' WITH APPLY INSTANCE=... on a RAC standby. */
  | { kind: 'cmd.setApplyInstance'; member: MemberId; instance: string }
  | { kind: 'cmd.disableFsfo'; force?: boolean }
  | { kind: 'lag.set'; member: MemberId; applyLag?: Seconds; transportLag?: Seconds };

export type EventKind = EventBody['kind'];

export type TimedEvent = { at: Seconds } & EventBody;

/* ---------------- states ---------------- */

export type MemberState =
  | 'open-rw'
  | 'open-ro'
  | 'mounted-apply'
  | 'mounted-noapply'
  | 'stalled'
  | 'commit-hang'
  | 'aborted'
  | 'converting'
  | 'reinstating'
  | 'disabled'
  | 'unreachable'
  | 'down';

/** A far sync instance has no broker state; these are transport states only. */
export type FarSyncState = 'receiving' | 'forwarding-stalled' | 'unreachable' | 'down';

export type ObserverState =
  | 'master'
  | 'backup'
  | 'stopped'
  | 'lost-primary'
  | 'lost-target'
  | 'nominating'
  | 'observe-only';

export type AnyState = MemberState | FarSyncState | ObserverState | 'up' | 'down';

/**
 * Event priority inside one instant: topology changes land before commands,
 * so a command issued at the same time as a failure sees the failure.
 */
const PRIORITY: Record<EventKind, number> = {
  'site.down': 0, 'site.up': 0, 'host.down': 0, 'host.up': 0,
  'link.cut': 1, 'link.heal': 1, partition: 1,
  'instance.down': 2, 'instance.up': 2, 'member.down': 2, 'member.up': 2,
  'observer.stop': 3, 'observer.start': 3,
  'lag.set': 4,
  'cmd.disableFsfo': 5, 'cmd.setMasterObserver': 5, 'cmd.setApplyInstance': 5,
  'cmd.switchover': 6, 'cmd.failover': 6, 'cmd.reinstate': 6,
};

export const eventPriority = (e: EventBody): number => PRIORITY[e.kind];

/** Stable order: time, then priority, then the order the caller wrote them in. */
export function sortEvents(events: readonly TimedEvent[]): TimedEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) =>
      a.e.at - b.e.at ||
      eventPriority(a.e) - eventPriority(b.e) ||
      a.i - b.i)
    .map((x) => x.e);
}
