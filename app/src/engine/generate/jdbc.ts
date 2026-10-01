/**
 * The same descriptor as a thin-driver URL -- engine design SS7, ported from
 * the published fragment's `buildJdbc`.
 *
 * Oracle's JDBC guide documents exactly this form -- the connect descriptor
 * inline after jdbc:oracle:thin:@ -- so the two cards are one configuration
 * written twice, never two configurations that can drift apart.
 *
 * One deliberate difference in spelling, not in configuration: the transport
 * timeout is always written out here. Under 26ai the thin driver has a default
 * of its own for the descriptor keyword -- "Starting from Oracle AI Database
 * Release 26ai, the default value of the TRANSPORT_CONNECT_TIMEOUT parameter
 * is 20 seconds" (CLIENT.JDBC_TCT_26AI) -- where Oracle Net's is 60 s, so an
 * omitted value would not model the same wait. The 19c JDBC pages print no
 * default for it, and the card says so (a model). Never "simplify" the thin URL
 * back to the TNS omission rule. Values are bare numbers, seconds, the way the
 * JDBC page's own example writes them (CLIENT.JDBC_URL_BARE); it lists units
 * only for RETRY_DELAY, so no `sec` suffix is invented. The 20 s / 0 that
 * CLIENT.JDBC_CURRENT and CLIENT.JDBC_19C carry belong to the
 * oracle.net.CONNECT_TIMEOUT connection property, not to this keyword.
 */

import type { Claim } from '../types/claims';
import { documented, model } from '../types/claims';
import type { ClientDescriptor, TopologyDoc } from '../types/topology';
import type { GeneratedFile, Line, Span } from './lines';
import { cmd, comment, hl, span, svc } from './lines';
import { serviceAddresses } from './tnsnames';

/* 26ai: the thin driver's own default for the descriptor keyword. */
const TCT_THIN_26AI = documented<string>(
  'starting from 26ai, the default value of TRANSPORT_CONNECT_TIMEOUT in a thin descriptor is 20 seconds',
  ['CLIENT.JDBC_TCT_26AI'],
  'Oracle Net\'s default in tnsnames.ora stays 60 s.',
);

/* 19c: nothing is printed for the keyword. */
const TCT_THIN_19C = model<string>(
  'the 19c JDBC pages print no default for TRANSPORT_CONNECT_TIMEOUT in a thin descriptor',
  'The 19c OracleConnection page documents the oracle.net.CONNECT_TIMEOUT connection property (default 0, no timeout), which is not this keyword, and Oracle Net\'s 60 s belongs to tnsnames.ora. Writing the value out removes the question; that it needs removing is this page\'s caution, not a documented difference.',
  ['CLIENT.TIMEOUTS', 'CLIENT.JDBC_19C'],
);

const BARE_SECONDS = documented<string>(
  'the timeouts are written as bare numbers, which are seconds, as the JDBC page\'s own example writes them',
  ['CLIENT.JDBC_URL_BARE', 'CLIENT.TIMEOUTS'],
  'The JDBC page lists units only for RETRY_DELAY (ms, s, m, from 21c); for the others it shows bare numbers, and the Oracle Net page says the default unit is seconds. The oracle.net.CONNECT_TIMEOUT connection property is a different thing: 26ai reads a bare value there in milliseconds, and the 19c page says seconds.',
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
    set.push(`(CONNECT_TIMEOUT=${c.connectTimeoutSeconds})`);
  }
  if (c.retryCount > 0) set.push(`(RETRY_COUNT=${c.retryCount})`);
  /* "Starting from Oracle AI Database Release 26ai, the default value of
     this parameter is 1 second" -- so under 26ai an explicit 0 is not the
     driver default and is worth spelling out, not just omitting. */
  if (c.retryDelaySeconds > 0 || v26) set.push(`(RETRY_DELAY=${c.retryDelaySeconds})`);

  const tct = `(TRANSPORT_CONNECT_TIMEOUT=${c.transportConnectTimeoutSeconds})`;
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
  const tctClaim = v26 ? TCT_THIN_26AI : TCT_THIN_19C;
  lines.push(comment(
    v26
      ? 'TRANSPORT_CONNECT_TIMEOUT written out on purpose: from 26ai the thin driver\'s own default is 20 seconds, where Oracle Net\'s is 60 s'
      : 'TRANSPORT_CONNECT_TIMEOUT written out on purpose: the 19c JDBC pages print no thin default for it, and Oracle Net\'s is 60 s',
    { indent: 2, basis: tctClaim.basis, cite: [...tctClaim.cite], ...(tctClaim.note === undefined ? {} : { note: tctClaim.note }) },
  ));
  lines.push(comment(
    'bare numbers, as the JDBC page\'s own example writes them: a timeout is in seconds',
    { indent: 2, basis: BARE_SECONDS.basis, cite: [...BARE_SECONDS.cite], ...(BARE_SECONDS.note === undefined ? {} : { note: BARE_SECONDS.note }) },
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

  const claims: Claim<string>[] = [INLINE_DESCRIPTOR, tctClaim, BARE_SECONDS];
  if (v26 && c.retryDelaySeconds === 0) claims.push(RETRY_DELAY_26AI);
  return {
    id: opts.label === undefined ? 'jdbc' : `jdbc:${opts.label}`,
    title: opts.label === undefined ? 'JDBC thin URL' : `JDBC thin URL — ${opts.label}`,
    syntax: 'jdbc', lines, claims,
  };
}
