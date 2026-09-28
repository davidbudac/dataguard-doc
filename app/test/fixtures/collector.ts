export const block = (name: string, role: string, destinations: object[] = [], extras: object[] = []) => [
  'DGTOPO_BEGIN_V1',
  ...[
    { type: 'database', name, role, protection: 'MAXIMUM AVAILABILITY', openMode: role === 'PRIMARY' ? 'READ WRITE' : 'MOUNTED', flashback: 'YES', fsfo: 'DISABLED', cdb: 'YES', container: 'CDB$ROOT', collectedAt: '2026-09-28T10:00:00+00:00' },
    { type: 'instance', name: `${name}1`, host: `${name}.example`, version: '19.0.0.0.0' },
    { type: 'member', name: 'P' }, { type: 'member', name: 'S' },
    ...destinations, ...extras,
  ].map(r => JSON.stringify(r)), 'DGTOPO_END_V1',
].join('\n');
export const dest = (target = 'S') => ({ type: 'destination', instance: 1, destId: 2, target, service: target, status: 'VALID', validNow: 'YES', validRole: 'ALL_ROLES', transmit: 'SYNCHRONOUS', affirm: 'YES', netTimeout: 30, reopen: 300, maxFailure: 0, alternate: null, error: null });
export const sample = () => `${block('P', 'PRIMARY', [dest()])}\n${block('S', 'PHYSICAL STANDBY')}`;
