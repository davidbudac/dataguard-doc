/**
 * The connect descriptor, written out -- engine design SS7, ported from the
 * published fragment's `buildTns` and generalised to an ADDRESS_LIST over
 * every service-publishing host.
 *
 * Two rules the published card already followed and this one keeps:
 *  - a parameter at its Oracle Net default is NOT written into the string; it
 *    is listed underneath instead, so the card never implies that spelling a
 *    default out changes anything;
 *  - FAILOVER is spelled even though it is on by default, because it is the
 *    whole point of the list, and LOAD_BALANCE is omitted unless it is on.
 */

import type { Claim } from '../types/claims';
import { documented, model } from '../types/claims';
import type { ClientAddress, ClientDescriptor, TopologyDoc } from '../types/topology';
import { isDatabase, isRac } from '../types/topology';
import type { GeneratedFile, Line, Span } from './lines';
import { blank, cmd, comment, hl, note, span, svc } from './lines';

/* ---------------- addresses ---------------- */

/**
 * Every host the role-based service can be published on: the descriptor's own
 * list when it has one, and otherwise every host of every member that can hold
 * the primary role. Far sync instances can never be opened, and a snapshot
 * standby cannot be a failover target, so neither ever appears.
 */
export function serviceAddresses(doc: TopologyDoc, client: ClientDescriptor = doc.client): ClientAddress[] {
  if (client.addresses.length > 0) return client.addresses;
  const out: ClientAddress[] = [];
  for (const m of doc.members) {
    if (!isDatabase(m) || !m.enabled) continue;
    if (m.role === 'snapshot') continue;
    for (const i of m.instances) {
      const host = doc.hosts.find((h) => h.id === i.host);
      out.push({ host: i.host, port: host?.listenerPort ?? 1521 });
    }
  }
  return out;
}

const hostName = (doc: TopologyDoc, address: ClientAddress): string =>
  doc.hosts.find((h) => h.id === address.host)?.name ?? (address.host as string);

/* ---------------- claims ---------------- */

const DEFAULTS_OMITTED = documented<string>(
  'a parameter left out of the string takes its Oracle Net default',
  ['CLIENT.TIMEOUTS', 'CLIENT.RETRY_AND_FAILOVER'],
);

const FAILOVER_SPELLED = documented<string>(
  'FAILOVER is on by default inside an ADDRESS_LIST; LOAD_BALANCE is off',
  ['CLIENT.RETRY_AND_FAILOVER'],
);

const SINGLE_IP = model<string>(
  'one IP address per host',
  'TRANSPORT_CONNECT_TIMEOUT applies per ADDRESS and per IP address a host name resolves to. This card draws single-IP hosts, so one ADDRESS is one timeout.',
);

const WIDE_SERVICE = documented<string>(
  'ConfigurationWideServiceName is the alternative to a role-based service',
  ['CFG.WIDE_SERVICE_NAME'],
  'Introduced in 12.2 and documented on the 19c broker properties page: the default is primarydbname_CFG and it does not change after a role transition.',
);

const SCAN_ALIASES = documented<string>(
  'for Oracle RAC the aliases connect using the SCAN name',
  ['RAC.SCAN_ALIASES'],
  'The MAA example writes one ADDRESS_LIST per site, HOST=clu_site1-scan and HOST=clu_site2-scan.',
);

const SCAN_NAME_MODEL = model<string>(
  'the SCAN host names are placeholders',
  'The drawing has no SCAN names, so each cluster is written <cluster>-scan. The connection ladder in the client panel still dials one address per node: that is the list above, not this one.',
);

/* ---------------- the file ---------------- */

const tnsToken = (name: string, value: string | number): Span[] =>
  [hl(`(${name} = ${value})`)];

export interface TnsOptions {
  /** The descriptor to write out; the document's shared one when left out. */
  client?: ClientDescriptor;
  /** Whose descriptor it is, when it is one application's own: added to the card's title. */
  label?: string;
}

export function buildTns(doc: TopologyDoc, opts: TnsOptions = {}): GeneratedFile {
  const c: ClientDescriptor = opts.client ?? doc.client;
  const addresses = serviceAddresses(doc, c);
  const service = c.serviceName;

  const set: Span[][] = [];
  const absent: string[] = [];
  if (c.transportConnectTimeoutSeconds !== 60) {
    set.push(tnsToken('TRANSPORT_CONNECT_TIMEOUT', c.transportConnectTimeoutSeconds));
  } else {
    absent.push('TRANSPORT_CONNECT_TIMEOUT (60 s default)');
  }
  if (c.connectTimeoutSeconds !== null && c.connectTimeoutSeconds > 0) {
    set.push(tnsToken('CONNECT_TIMEOUT', c.connectTimeoutSeconds));
  } else {
    absent.push('CONNECT_TIMEOUT (no cap)');
  }
  if (c.retryCount > 0) {
    set.push(tnsToken('RETRY_COUNT', c.retryCount));
  } else {
    absent.push('RETRY_COUNT (0 -- no retries)');
  }
  if (c.retryDelaySeconds > 0) {
    set.push(tnsToken('RETRY_DELAY', c.retryDelaySeconds));
  } else {
    absent.push('RETRY_DELAY (immediate)');
  }

  const lines: Line[] = [];
  lines.push(cmd([svc(service), span(' =')]));
  lines.push(cmd('(DESCRIPTION =', { indent: 1 }));
  /* Two tokens to a line, exactly as the published card lays them out. */
  for (let i = 0; i < set.length; i += 2) {
    const pair = set.slice(i, i + 2).flat();
    lines.push(cmd(pair, { indent: 3 }));
  }

  const listHead = c.loadBalance
    ? `(ADDRESS_LIST = (FAILOVER = ${c.failover ? 'on' : 'off'})(LOAD_BALANCE = on)`
    : `(ADDRESS_LIST = (FAILOVER = ${c.failover ? 'on' : 'off'})`;
  lines.push(cmd(listHead, { indent: 3 }));
  addresses.forEach((a, i) => {
    const last = i === addresses.length - 1;
    lines.push(cmd(
      `(ADDRESS = (PROTOCOL = tcp)(HOST = ${hostName(doc, a)})(PORT = ${a.port}))${last ? ')' : ''}`,
      { indent: 5 },
    ));
  });
  lines.push(cmd([
    span('(CONNECT_DATA = (SERVICE_NAME = '), svc(service), span(')))'),
  ], { indent: 3 }));

  if (absent.length > 0) {
    lines.push(blank());
    lines.push(comment('not in the string, defaults apply:'));
    for (let i = 0; i < absent.length; i += 2) {
      lines.push(comment(absent.slice(i, i + 2).join(' - '), { indent: 2 }));
    }
  }

  const claims: Claim<string>[] = [DEFAULTS_OMITTED, FAILOVER_SPELLED, SINGLE_IP];

  /* Oracle RAC: MAA writes the alias with the cluster's SCAN name rather than
     a node per address. Shown commented out, as the alternative spelling of
     the same alias with the same tokens -- a second live definition of one
     alias in one file would leave which one a client reads to chance. The
     connection ladder this page draws keeps the node-per-address list. */
  const racs = doc.members.filter(
    (m) => isDatabase(m) && m.enabled && m.role !== 'snapshot' && isRac(m),
  );
  if (racs.length > 0) {
    const scanAddrs: string[] = [];
    const seen = new Set<string>();
    for (const m of doc.members) {
      if (!isDatabase(m) || !m.enabled || m.role === 'snapshot') continue;
      for (const i of m.instances) {
        const h = doc.hosts.find((x) => x.id === i.host);
        const name = isRac(m) ? `${h?.cluster ?? m.name}-scan` : (h?.name ?? (i.host as string));
        if (seen.has(name)) continue;
        seen.add(name);
        scanAddrs.push(`(ADDRESS = (PROTOCOL = tcp)(HOST = ${name})(PORT = ${h?.listenerPort ?? 1521}))`);
      }
    }
    const tokenText = (sp: Span[]): string => sp.map((x) => x.text).join('');
    lines.push(blank());
    lines.push(note('for Oracle RAC configurations the aliases should connect using the SCAN name', SCAN_ALIASES));
    lines.push(comment('the same alias written with SCAN names -- use it instead of the one above:'));
    lines.push(comment(`${service} =`));
    lines.push(comment('  (DESCRIPTION ='));
    for (let i = 0; i < set.length; i += 2) {
      lines.push(comment(`    ${set.slice(i, i + 2).map(tokenText).join('')}`));
    }
    lines.push(comment(`    ${listHead}`));
    scanAddrs.forEach((a, i) => {
      lines.push(comment(`      ${a}${i === scanAddrs.length - 1 ? ')' : ''}`));
    });
    lines.push(comment(`    (CONNECT_DATA = (SERVICE_NAME = ${service})))`));
    lines.push(note('<cluster>-scan is a placeholder for the cluster\'s SCAN name', SCAN_NAME_MODEL));
    if (c.addresses.length > 0) {
      lines.push(comment('the address list above is the one set on the client; the SCAN form is drawn from the members'));
    }
    claims.push(SCAN_ALIASES, SCAN_NAME_MODEL);
  }
  if (doc.config.configurationWideServiceName) {
    lines.push(blank());
    lines.push(note(
      `or the configuration-wide service ${doc.config.configurationWideServiceName}, which does not change after a role transition`,
      WIDE_SERVICE,
    ));
    claims.push(WIDE_SERVICE);
  }

  return {
    id: opts.label === undefined ? 'tnsnames' : `tnsnames:${opts.label}`,
    title: opts.label === undefined ? 'tnsnames.ora' : `tnsnames.ora — ${opts.label}`,
    filename: 'tnsnames.ora',
    syntax: 'tnsnames', lines, claims,
  };
}
