import { signal } from '@preact/signals';

/** View only: filtering never changes topology, reachability or simulation. */
export type ConnectionLayer = 'all' | 'redo' | 'observer' | 'application';
export const connectionLayer = signal<ConnectionLayer>('all');
export function includesConnection(layer: ConnectionLayer, kind: string): boolean {
  return layer === 'all' || (layer === 'observer' ? kind === 'ping' || kind === 'check'
    : layer === 'application' ? kind === 'connect' : kind === 'redo');
}
