/**
 * The one network rule: a far sync edge does not replace the direct
 * primary-to-standby connection.
 */

import type { Finding } from '../../types/claims';
import { isFarSync } from '../../types/topology';
import type { Rule } from '../context';
import { memberSubject, mk, q } from '../context';

/**
 * "there must still be a direct network connection between the primary
 * database and the remote standby database ... used to perform health checks
 * and switchover processing tasks."
 */
export const directLinkRequired: Rule = (ctx): Finding[] => {
  const g = ctx.graph;
  const primary = ctx.primary;
  if (!g || !primary) return [];
  const out: Finding[] = [];
  for (const m of ctx.standbys) {
    const rm = g.members[m.id];
    if (!rm || !rm.reachableFromPrimary) continue;
    const viaFarSync = rm.feedPath.slice(1, -1).some((id) => {
      const hop = ctx.member(id);
      return !!hop && isFarSync(hop);
    });
    if (!viaFarSync) continue;
    if (ctx.reachableMembers(primary, m)) continue;
    out.push(mk('NET.DIRECT_LINK_REQUIRED', {
      subject: memberSubject(m),
      message: `${q(m.name)} receives its redo through a far sync instance and no network path connects it to ${q(primary.name)}. There must still be a direct network connection between the primary database and the remote standby database: it is used to perform health checks and switchover processing tasks.`,
      cite: ['FS.DIRECT_LINK_REQUIRED', 'FS.MANAGES_CONTROLFILE'],
    }));
  }
  return out;
};

export const networkRules: Rule[] = [directLinkRequired];
