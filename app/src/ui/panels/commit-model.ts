import { declaredPrimary, findMember, linkRttMs, memberHosts, resolveRedoGraph } from '@/engine';
import type { CommitLeg, MemberId, RedoGraph, TopologyDoc } from '@/engine';

/**
 * The primary's direct destinations, in the order the resolver found them --
 * the legs `computeCommit` weighs. Shared by the Commit panel (which passes
 * the live redo graph) and the review comparison (which resolves its own
 * snapshot's), so it never reads live state itself.
 */
export function directCommitLegs(
  doc: TopologyDoc, primary: MemberId | null = declaredPrimary(doc),
  graph: RedoGraph | null = primary === null ? null : resolveRedoGraph(doc, { primary }),
): CommitLeg[] {
  if (primary === null || graph === null) return [];
  const from = findMember(doc, primary);
  const fromHost = from ? memberHosts(from)[0] : undefined;
  return graph.edges.filter((e) => e.from === primary && e.active).flatMap((e) => {
    const to = findMember(doc, e.to);
    if (!to) return [];
    const toHost = memberHosts(to)[0];
    return [{
      to: e.to, kind: to.kind, xpt: e.xpt,
      rttMs: fromHost && toHost ? linkRttMs(doc, fromHost, toHost) : 0,
      destWriteMs: doc.environment.standbyWriteMs,
    }];
  });
}
