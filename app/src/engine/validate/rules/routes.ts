/**
 * RedoRoutes rules -- the grammar's own restrictions (A5), the cascading
 * restrictions (B2) and the two places where the transport of a forwarded hop
 * is undocumented rather than forbidden.
 *
 * GROUP never appears here: it is a LOG_ARCHIVE_DEST_n attribute, not
 * RedoRoutes syntax. The parenthesised destination groups the 26ai grammar
 * carries are spelled PRIORITY=n.
 */

import type { Finding } from '../../types/claims';
import type { Member, RedoRouteRule } from '../../types/topology';
import { isDatabase, isFarSync } from '../../types/topology';
import type { DeclaredDest, Rule, ValidateContext } from '../context';
import { mk, q, routeSubject } from '../context';

const sourceKeys = (r: RedoRouteRule): string[] =>
  r.source === 'LOCAL' || r.source === 'ANY' ? [r.source] : r.source.map((s) => s as string);

/** A source may appear in only one rule per member. */
export const sourceUnique: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    const seen = new Map<string, number>();
    const reported = new Set<string>();
    m.redoRoutes.forEach((rule) => {
      for (const key of sourceKeys(rule)) {
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (n < 2 || reported.has(key)) continue;
        reported.add(key);
        out.push(mk('ROUTES.SOURCE_UNIQUE', {
          subject: routeSubject(m),
          message: `RedoRoutes on ${q(m.name)} names the redo source ${key} in more than one rule. A source may appear in only one rule per member.`,
          cite: ['ROUTES.SOURCE_ONCE', 'ROUTES.GRAMMAR_121'],
        }));
      }
    });
  }
  return out;
};

/** LOCAL cannot be used at a far sync instance. */
export const localAtFarSync: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.farSyncs) {
    if (!m.redoRoutes.some((r) => r.source === 'LOCAL')) continue;
    out.push(mk('ROUTES.LOCAL_AT_FARSYNC', {
      subject: routeSubject(m),
      message: `RedoRoutes on the far sync instance ${q(m.name)} uses the redo source LOCAL. LOCAL cannot be used at a far sync instance: name the primary instead, as in EDIT FAR_SYNC ${q(m.name)} SET PROPERTY 'RedoRoutes' = '(North_Sales : South_Sales ASYNC)';`,
      cite: ['ROUTES.LOCAL_NOT_AT_FARSYNC', 'ROUTES.CANONICAL_PAIR'],
    }));
  }
  return out;
};

/** RedoRoutes cannot be set on a snapshot standby database. */
export const snapshotForbidden: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.databases) {
    if (m.role !== 'snapshot' || m.redoRoutes.length === 0) continue;
    out.push(mk('ROUTES.SNAPSHOT_FORBIDDEN', {
      subject: routeSubject(m),
      message: `RedoRoutes is set on ${q(m.name)}, a snapshot standby database. The property cannot be set on a snapshot standby.`,
      cite: ['ROUTES.SNAPSHOT_FORBIDDEN'],
    }));
  }
  return out;
};

/** A logical standby is documented with LOCAL only -- on a page that argues with itself. */
export const logicalLocalOnly: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.databases) {
    if (m.role !== 'logical') continue;
    if (!m.redoRoutes.some((r) => r.source !== 'LOCAL')) continue;
    out.push(mk('ROUTES.LOGICAL_LOCAL_ONLY', {
      subject: routeSubject(m),
      message: `RedoRoutes on the logical standby ${q(m.name)} carries a rule whose redo source is not LOCAL. A logical standby is documented as taking RedoRoutes only with LOCAL.`,
      cite: ['ROUTES.LOGICAL_LOCAL_ONLY', 'ROUTES.GRAMMAR_121'],
      note: 'The 12.1 broker property page contradicts itself here: the restriction is stated, and the grammar it gives alongside allows a named source at any member. Both readings are carried rather than resolved, which is why this is a warning and not a refusal.',
    }));
  }
  return out;
};

/** An alternate requires a non-zero MaxFailure on the non-alternate member. */
export const alternateNeedsMaxFailure: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    for (const d of ctx.declaredDests(m)) {
      const alt = d.dest.alt;
      if (!alt || d.fromAll) continue;
      const props = ctx.destPropsFor(m, d.to.id);
      if (props.maxFailure !== 0) continue;
      out.push(mk('ROUTES.ALT_NEEDS_MAXFAILURE', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} gives ${q(alt.target as string)} as the alternate of ${q(d.to.name)}, but MaxFailure for ${q(d.to.name)} is 0 (unlimited). An alternate requires a non-zero MaxFailure on the non-alternate member: EDIT DATABASE ${q(m.name)} SET PARAMETER 'LOG_ARCHIVE_DEST_n' MAX_FAILURE.`,
        cite: ['ROUTES.ALT_MAXFAILURE', 'ROUTES.GRAMMAR_121'],
      }));
    }
  }
  return out;
};

const inExplicitGroup = (d: DeclaredDest): boolean =>
  d.group.explicitGroup === true || d.group.priority !== undefined;

/** 26ai: a member whose MaxFailure property is zero cannot be part of a RedoRoutes group. */
export const groupNeedsMaxFailure: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.edition !== '26ai') return [];
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of ctx.doc.members) {
    for (const d of ctx.declaredDests(m)) {
      if (!inExplicitGroup(d)) continue;
      if (ctx.destPropsFor(m, d.to.id).maxFailure !== 0) continue;
      const key = `${m.id as string}>${d.to.id as string}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mk('ROUTES.GROUP_NEEDS_MAXFAILURE', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} puts ${q(d.to.name)} in a PRIORITY group while its MaxFailure is 0. A member whose MaxFailure property is set to zero cannot be part of a RedoRoutes group.`,
        cite: ['ROUTES.GROUP_MAXFAILURE_ZERO', 'ROUTES.PRIORITY_26AI'],
        note: 'The sentence appears on the 26ai RedoRoutes page; 19c is silent about it, so the rule is applied to 26ai configurations only.',
      }));
    }
  }
  return out;
};

/** The 26ai grammar carries PRIORITY groups and no ALT/FALLBACK form. */
export const alternateNotIn26ai: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.edition !== '26ai') return [];
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of ctx.doc.members) {
    for (const d of ctx.declaredDests(m)) {
      if (!d.dest.alt || seen.has(m.id as string)) continue;
      seen.add(m.id as string);
      out.push(mk('ROUTES.ALT_NOT_IN_26AI', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} uses the ALT form. The 26ai grammar gives parenthesised destination groups with PRIORITY=n, n from 1 to 8, and carries no ALT or FALLBACK form.`,
        cite: ['ROUTES.PRIORITY_26AI', 'ROUTES.GRAMMAR_121', 'ROUTES.INTRODUCED_121'],
        note: 'ALT is documented from 12.1.0.2 and the PRIORITY spelling already appears in 19c Example 4-3. Whether 26ai still accepts ALT is not stated on the 26ai page, so this is a warning about a spelling that has disappeared from the grammar rather than a refusal.',
      }));
    }
  }
  return out;
};

const cascaders = (ctx: ValidateContext): Member[] =>
  ctx.doc.members.filter((m) => !isFarSync(m) && m.id !== ctx.primary?.id
    && ctx.forwardedDests(m).length > 0);

/** Only physical standby databases cascade redo. */
export const cascadePhysicalOnly: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of cascaders(ctx)) {
    if (!isDatabase(m) || m.role === 'physical' || m.role === 'primary') continue;
    out.push(mk('ROUTES.CASCADE_PHYSICAL_ONLY', {
      subject: routeSubject(m),
      message: `${q(m.name)} is a ${m.role} standby and its RedoRoutes forwards redo onward. Only physical standby databases cascade redo.`,
      cite: ['CASCADE.PHYSICAL_ONLY', 'CASCADE.TERMINAL_INDIRECT'],
    }));
  }
  return out;
};

/** The ASYNC attribute must be explicitly specified to enable real-time cascading. */
export const cascadeRealTimeAsync: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of cascaders(ctx)) {
    for (const d of ctx.forwardedDests(m)) {
      if (d.explicitXpt !== undefined) continue;
      out.push(mk('ROUTES.CASCADE_RT_ASYNC', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} cascades to ${q(d.to.name)} with no transport attribute, so the destination falls back to its LogXptMode (${d.xpt}). The ASYNC redo transport attribute must be explicitly specified for a cascaded destination to enable real-time cascading, which also needs Active Data Guard; without it the terminal standby receives archived standby redo logs instead.`,
        cite: ['ROUTES.CASCADE_ASYNC_EXPLICIT', 'CASCADE.PHYSICAL_ONLY'],
      }));
    }
  }
  return out;
};

/** A cascading standby database supports up to 30 terminal destinations. */
export const cascadeFanout: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of cascaders(ctx)) {
    const n = new Set(ctx.forwardedDests(m).map((d) => d.to.id as string)).size;
    if (n <= 30) continue;
    out.push(mk('ROUTES.CASCADE_FANOUT_30', {
      subject: routeSubject(m),
      message: `${q(m.name)} cascades to ${n} terminal destinations. A cascading standby database supports up to 30 terminal destinations.`,
      cite: ['CASCADE.THIRTY_TERMINAL', 'CASCADE.TERMINAL_INDIRECT'],
    }));
  }
  return out;
};

/** SYNC from a cascader to its terminal standby is documented as non-real-time cascading; not modelled. */
export const cascadeSyncUndocumented: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of cascaders(ctx)) {
    for (const d of ctx.forwardedDests(m)) {
      if (d.xpt === 'ASYNC') continue;
      out.push(mk('ROUTES.CASCADE_SYNC_UNDOC', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} cascades to ${q(d.to.name)} over ${d.xpt}. Real-time cascading needs ASYNC spelled out; SYNC (or no attribute) on destinations 1 through 10 is documented as non-real-time cascading, shipped as the cascader archives its standby redo logs.`,
        cite: ['ROUTES.CASCADE_ASYNC_EXPLICIT', 'CASCADE.SYNC_NON_REALTIME'],
        note: 'Non-real-time cascading is documented; what the cascader waits for under SYNC and how far the terminal destination then trails are not, so this engine flags it as unmodelled rather than illegal and models nothing about it.',
      }));
    }
  }
  return out;
};

/** The far sync onward hop is documented as ASYNC; SYNC onward is undocumented. */
export const farSyncOnwardSync: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.farSyncs) {
    for (const d of ctx.declaredDests(m)) {
      if (d.xpt === 'ASYNC') continue;
      out.push(mk('ROUTES.FARSYNC_ONWARD_SYNC_UNDOC', {
        subject: routeSubject(m),
        message: `The far sync instance ${q(m.name)} forwards to ${q(d.to.name)} over ${d.xpt}. A far sync instance is documented as using ASYNC transport to ship the incoming redo to terminal standbys, and fast-start failover requires the target standby transport mode to be ASYNC.`,
        cite: ['FS.ONWARD_ASYNC', 'FSFO.FARSYNC_XPT'],
        note: 'SYNC on the onward hop is not documented -- word it as "documented as ASYNC", never as forbidden. This engine keeps the hop but models nothing about a synchronous acknowledgement travelling back through the far sync instance.',
      }));
    }
  }
  return out;
};

/**
 * A cycle in the active routing rules. Oracle documents no cycle rule, so this
 * comes straight from the resolver, which is the one place the active edge set
 * is computed.
 */
export const routeCycle: Rule = (ctx): Finding[] =>
  (ctx.graph?.findings ?? []).filter((f) => f.id === 'ROUTES.CYCLE');

export const routeRules: Rule[] = [
  sourceUnique, localAtFarSync, snapshotForbidden, logicalLocalOnly,
  alternateNeedsMaxFailure, groupNeedsMaxFailure, alternateNotIn26ai,
  cascadePhysicalOnly, cascadeRealTimeAsync, cascadeFanout, cascadeSyncUndocumented,
  farSyncOnwardSync, routeCycle,
];
