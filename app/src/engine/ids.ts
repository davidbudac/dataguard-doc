/**
 * Branded identifiers (engine design SS1.1).
 *
 * The brands exist so a HostId can never be passed where a MemberId is meant --
 * every one of them is a plain string at runtime, so ids stay JSON-round-trippable
 * and comparable with ===.
 */

export type SiteId = string & { readonly __brand: 'SiteId' };
export type HostId = string & { readonly __brand: 'HostId' };
export type MemberId = string & { readonly __brand: 'MemberId' }; // db_unique_name
export type ObserverId = string & { readonly __brand: 'ObserverId' };
export type LinkId = string & { readonly __brand: 'LinkId' };

/** All engine time is seconds relative to t = 0. */
export type Seconds = number;
/** Milliseconds only for ObserverPingInterval and the commit axis. */
export type Millis = number;

/** The two Oracle releases this engine models. */
export type Edition = '19c' | '26ai';

export const siteId = (s: string): SiteId => s as SiteId;
export const hostId = (s: string): HostId => s as HostId;
export const memberId = (s: string): MemberId => s as MemberId;
export const observerId = (s: string): ObserverId => s as ObserverId;
export const linkId = (s: string): LinkId => s as LinkId;

/** Erase a brand for map keys, sorting and messages. */
export const idString = (
  id: SiteId | HostId | MemberId | ObserverId | LinkId,
): string => id as string;

export const isEdition = (v: unknown): v is Edition => v === '19c' || v === '26ai';
