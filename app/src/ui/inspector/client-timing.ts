/**
 * The four connect-string timing parameters, said once.
 *
 * The inspector's application form, the Application timeline's strip and the
 * small timeline's retry-window grip all offer these settings, as
 * different controls (a slider, a number box, a grip). What does not differ -- the
 * name, the bound, the sentence under it, how a value reads and the edit a
 * value makes, with its undo label and its coalesce key -- is here, so a note
 * or a label changed once is changed in every place.
 */

import type { BoundKey, ClientDescriptor, TopologyDoc } from '@/engine';
import { BOUNDS } from '@/engine';
import { patchClient } from './edits';

export interface ClientTimingField {
  /** The Oracle parameter, and the control's accessible name. */
  name: string;
  bound: BoundKey;
  /** A count reads better as a number box than as a slider. */
  kind: 'range' | 'number';
  /** The sentence the inspector prints under the control, for the edition being drawn. */
  note: (edition: TopologyDoc['config']['edition']) => string;
  /** Folds a burst of edits into one undo entry. */
  coalesce: string;
  /** The setting as it stands; an unset CONNECT_TIMEOUT reads 0. */
  value: (c: ClientDescriptor) => number;
  /** The unit as the inspector prints it where it differs from the bound's own. */
  unit?: (c: ClientDescriptor) => string;
  /** The edit a value makes: 0 is "not set" for CONNECT_TIMEOUT. */
  edit: (v: number) => { label: string; fn: (c: ClientDescriptor) => ClientDescriptor };
}

export const CLIENT_TIMING_FIELDS: readonly ClientTimingField[] = [
  {
    name: 'TRANSPORT_CONNECT_TIMEOUT',
    bound: 'transportConnectTimeoutSeconds',
    kind: 'range',
    note: (ed) => 'Default 60 s in tnsnames.ora, for each ADDRESS and each IP address a host name is mapped to. This page draws one IP address per host. '
      + (ed === '26ai'
        ? 'The JDBC thin driver has a default of its own from 26ai: 20 seconds.'
        : 'The 19c JDBC pages print no default for the thin driver, so the generated URL always spells the value out.'),
    coalesce: 'client:tct',
    value: (c) => c.transportConnectTimeoutSeconds,
    edit: (v) => ({
      label: `Set TRANSPORT_CONNECT_TIMEOUT to ${v} s`,
      fn: (x) => ({ ...x, transportConnectTimeoutSeconds: v }),
    }),
  },
  {
    name: 'CONNECT_TIMEOUT',
    bound: 'connectTimeoutSeconds',
    kind: 'range',
    note: () => 'Per ADDRESS, and no default is documented: at 0 it is left out of the string. Set, the wait on one address is the smaller of the two timeouts.',
    coalesce: 'client:ct',
    value: (c) => c.connectTimeoutSeconds ?? 0,
    unit: (c) => (c.connectTimeoutSeconds === null || c.connectTimeoutSeconds === 0 ? 's — not set' : 's'),
    edit: (v) => ({
      label: v > 0 ? `Set CONNECT_TIMEOUT to ${v} s` : 'Leave CONNECT_TIMEOUT unset',
      fn: (x) => ({ ...x, connectTimeoutSeconds: v > 0 ? v : null }),
    }),
  },
  {
    name: 'RETRY_COUNT',
    bound: 'retryCount',
    kind: 'number',
    note: () => 'Extra traversals of the whole address list after the first one fails across all of it. The reference prints no default; one traversal when unset is this page\'s reading.',
    coalesce: 'client:rc',
    value: (c) => c.retryCount,
    edit: (v) => ({
      label: `Set RETRY_COUNT to ${v}`,
      fn: (x) => ({ ...x, retryCount: v }),
    }),
  },
  {
    name: 'RETRY_DELAY',
    bound: 'retryDelaySeconds',
    kind: 'range',
    note: (ed) => (ed === '26ai'
      ? 'Seconds between traversals. No default in tnsnames.ora is documented, and at 0 the next traversal starts at once; the JDBC thin driver defaults to 1 second from 26ai, so its URL spells 0 out.'
      : 'Seconds between traversals. No default is documented; at 0 the next traversal starts at once.'),
    coalesce: 'client:rd',
    value: (c) => c.retryDelaySeconds,
    edit: (v) => ({
      label: `Set RETRY_DELAY to ${v} s`,
      fn: (x) => ({ ...x, retryDelaySeconds: v }),
    }),
  },
];

/** The unit beside a value, as the inspector's value chip prints it ('' for a count). */
export function clientTimingUnit(f: ClientTimingField, c: ClientDescriptor): string {
  if (f.unit !== undefined) return f.unit(c);
  const u = BOUNDS[f.bound].unit;
  return u === 'count' || u === 'port' ? '' : u;
}

/** Make one field's edit, on the descriptor `appId` dials (the shared one when none is named). */
export function editClientTiming(f: ClientTimingField, v: number, appId?: string): void {
  const { label, fn } = f.edit(v);
  patchClient(label, fn, f.coalesce, appId);
}
