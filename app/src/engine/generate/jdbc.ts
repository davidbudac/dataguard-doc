/**
 * The same descriptor as a thin-driver URL -- engine design SS7, ported from
 * the published fragment's `buildJdbc`.
 *
 * Oracle's JDBC guide documents exactly this form -- the connect descriptor
 * inline after jdbc:oracle:thin:@ -- so the two cards are one configuration
 * written twice, never two configurations that can drift apart.
 *
 * One deliberate difference in spelling, not in configuration: the transport
 * timeout is always written out here, because the thin driver does not inherit
 * Oracle Net's 60 s default -- its own connect-timeout default is 0 (no
 * timeout) in the 19c driver and 20 s in current ones, so an omitted value
 * would not model the same wait. The `sec` suffix pins the unit, since older
 * thin releases read a bare value as milliseconds. Never "simplify" the thin
 * URL back to the TNS omission rule. The 26ai OracleConnection page now states
 * when the thin default changed ("Starting in 23.6, the default value was
 * changed from "0" (no timeout) to "20000" (20 seconds)"); the 19c page does
 * not, so the generated comment names no release and CLIENT.JDBC_CURRENT
 * carries the sentence.
 */

import type { Claim } from '../types/claims';
import { documented } from '../types/claims';
import type { ClientDescriptor, TopologyDoc } from '../types/topology';
import type { GeneratedFile, Line, Span } from './lines';
import { cmd, comment, hl, span, svc } from './lines';
import { serviceAddresses } from './tnsnames';

const SEC_SUFFIX = documented<string>(
  'the thin driver has its own connect-timeout default -- 0 in 19c, 20 s in current drivers',
  ['CLIENT.JDBC_19C', 'CLIENT.JDBC_CURRENT'],
);

const INLINE_DESCRIPTOR = documented<string>(
  'the thin driver takes the connect descriptor inline after jdbc:oracle:thin:@',
  ['CLIENT.JDBC_19C'],
);

const RETRY_DELAY_26AI = documented<string>(
  'starting from 26ai, the default value of RETRY_DELAY is 1 second',
  ['CLIENT.JDBC_RETRY_DELAY_26AI'],
);

export interface JdbcOptions {
  /**
   * Draw the lead comment. Chapter 3 sits the two cards unlabelled under one
   * another and passes true; chapter 4's card carries its own header.
   */
  lead?: boolean;
  /** The descriptor to write out; the document's shared one when left out. */
  client?: ClientDescriptor;
  /** Whose descriptor it is, when it is one application's own: added to the card's title. */
  label?: string;
}

export function buildJdbc(doc: TopologyDoc, opts: JdbcOptions = {}): GeneratedFile {
  const c: ClientDescriptor = opts.client ?? doc.client;
  const addresses = serviceAddresses(doc, c);
  const service = c.serviceName;

  const v26 = doc.config.edition === '26ai';
  const set: string[] = [];
  if (c.connectTimeoutSeconds !== null && c.connectTimeoutSeconds > 0) {
    set.push(`(CONNECT_TIMEOUT=${c.connectTimeoutSeconds}sec)`);
  }
  if (c.retryCount > 0) set.push(`(RETRY_COUNT=${c.retryCount})`);
  /* "Starting from Oracle AI Database Release 26ai, the default value of
     this parameter is 1 second" -- so under 26ai an explicit 0 is not the
     driver default and is worth spelling out, not just omitting. */
  if (c.retryDelaySeconds > 0 || v26) set.push(`(RETRY_DELAY=${c.retryDelaySeconds})`);

  const tct = `(TRANSPORT_CONNECT_TIMEOUT=${c.transportConnectTimeoutSeconds}sec)`;
  const url: Span[] = [span('jdbc:oracle:thin:@(DESCRIPTION=')];
  /* Always written out, but only highlighted when it is not the Oracle Net
     default the tnsnames card would have omitted. */
  url.push(c.transportConnectTimeoutSeconds !== 60 ? hl(tct) : span(tct));
  if (set.length > 0) url.push(hl(set.join('')));
  url.push(span(`(ADDRESS_LIST=(FAILOVER=${c.failover ? 'on' : 'off'})`));
  if (c.loadBalance) url.push(span('(LOAD_BALANCE=on)'));
  for (const a of addresses) {
    const name = doc.hosts.find((h) => h.id === a.host)?.name ?? (a.host as string);
    url.push(span(`(ADDRESS=(PROTOCOL=tcp)(HOST=${name})(PORT=${a.port}))`));
  }
  url.push(span(')(CONNECT_DATA=(SERVICE_NAME='), svc(service), span(')))'));

  const lines: Line[] = [];
  if (opts.lead) {
    lines.push(comment('the same descriptor as a JDBC thin URL -- nothing on the client to resolve'));
  }
  lines.push(cmd(url));
  lines.push(comment(
    'sec written out on purpose: a bare timeout is not read as seconds by every thin release, and the thin driver does not inherit the 60 s Oracle Net default',
    { indent: 2, basis: SEC_SUFFIX.basis, cite: [...SEC_SUFFIX.cite] },
  ));
  lines.push(comment(
    `or keep the alias: jdbc:oracle:thin:@${service}, with oracle.net.tns_admin pointing at the tnsnames.ora directory`,
    { indent: 2 },
  ));
  if (v26 && c.retryDelaySeconds === 0) {
    lines.push(comment(
      'RETRY_DELAY=0 written out on purpose: starting in 26ai the driver default is 1 second, so an omitted value would not mean the same thing it did in earlier drivers',
      { indent: 2, basis: RETRY_DELAY_26AI.basis, cite: [...RETRY_DELAY_26AI.cite] },
    ));
  }

  const claims: Claim<string>[] = [INLINE_DESCRIPTOR, SEC_SUFFIX];
  if (v26 && c.retryDelaySeconds === 0) claims.push(RETRY_DELAY_26AI);
  return {
    id: opts.label === undefined ? 'jdbc' : `jdbc:${opts.label}`,
    title: opts.label === undefined ? 'JDBC thin URL' : `JDBC thin URL — ${opts.label}`,
    syntax: 'jdbc', lines, claims,
  };
}
