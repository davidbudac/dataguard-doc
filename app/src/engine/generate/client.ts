/**
 * The connect strings a document dials with, as the cards that write them out.
 *
 * The shared descriptor's tnsnames.ora and JDBC URL first, always: they are
 * what a document with no application (or one whose applications all share it)
 * dials. Then, for every application that has a descriptor of its own, its
 * two cards, titled with its name -- so an application is never shown the
 * shared string it does not dial.
 */

import { applicationsOf } from '../types/topology';
import type { TopologyDoc } from '../types/topology';
import type { GeneratedFile } from './lines';
import { buildJdbc } from './jdbc';
import { buildTns } from './tnsnames';

export function buildClientFiles(doc: TopologyDoc, opts: { lead?: boolean } = {}): GeneratedFile[] {
  const out: GeneratedFile[] = [buildTns(doc), buildJdbc(doc, opts)];
  for (const a of applicationsOf(doc)) {
    if (a.client === undefined) continue;
    out.push(buildTns(doc, { client: a.client, label: a.name }));
    out.push(buildJdbc(doc, { ...opts, client: a.client, label: a.name }));
  }
  return out;
}
