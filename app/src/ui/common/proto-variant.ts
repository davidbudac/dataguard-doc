/* PROTOTYPE — Break layout variants (throwaway; shared by the prototype branches). */

/**
 * Which Break layout prototype is on screen. Read once from `?variant=` and
 * only in dev builds: a production bundle always answers `current`.
 *
 * `state/url.ts` rewrites the address bar from the Document, which would drop
 * an unknown key, so it calls `withProtoVariant` on the tail it writes.
 */

import { signal } from '@preact/signals';

export type ProtoVariant = 'current' | 'A' | 'B';

export const PROTO_VARIANTS: readonly ProtoVariant[] = ['current', 'A', 'B'];

export const PROTO_LABEL: Record<ProtoVariant, string> = {
  current: "current — today's layout",
  A: 'A — lanes from cards',
  B: 'B — split + divider',
};

const enabled = (): boolean => import.meta.env.DEV === true;

function readFromUrl(): ProtoVariant {
  if (!enabled() || typeof location === 'undefined') return 'current';
  const m = /[?&]variant=([^&#]*)/.exec(location.search);
  const v = m ? decodeURIComponent(m[1] ?? '') : '';
  return (PROTO_VARIANTS as readonly string[]).includes(v) ? (v as ProtoVariant) : 'current';
}

export const protoVariant = signal<ProtoVariant>(readFromUrl());

/** `?a=b#frag` (or '') with `variant=` carried along while a prototype is on. */
export function withProtoVariant(tail: string): string {
  const v = protoVariant.peek();
  if (!enabled() || v === 'current') return tail;
  const hash = tail.indexOf('#');
  const head = hash < 0 ? tail : tail.slice(0, hash);
  const frag = hash < 0 ? '' : tail.slice(hash);
  return `${head === '' ? '?' : `${head}&`}variant=${v}${frag}`;
}

function stripVariant(search: string): string {
  const parts = search.replace(/^\?/, '').split('&').filter((p) => p !== '' && !p.startsWith('variant='));
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export function setProtoVariant(v: ProtoVariant): void {
  protoVariant.value = v;
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const base = stripVariant(location.search);
  const search = v === 'current' ? base : `${base === '' ? '?' : `${base}&`}variant=${v}`;
  history.replaceState(history.state, '', location.pathname + search + location.hash);
}

export function cycleProtoVariant(dir: 1 | -1): void {
  const i = PROTO_VARIANTS.indexOf(protoVariant.peek());
  const next = PROTO_VARIANTS[(i + dir + PROTO_VARIANTS.length) % PROTO_VARIANTS.length] as ProtoVariant;
  setProtoVariant(next);
}
