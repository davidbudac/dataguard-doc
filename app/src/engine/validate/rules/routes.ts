/**
 * RedoRoutes rules -- the grammar's own restrictions (A5), the cascading
 * restrictions (B2) and the two places where the transport of a forwarded hop
 * is undocumented rather than forbidden.
 *
 * GROUP never appears here: it is a LOG_ARCHIVE_DEST_n attribute, not
 * RedoRoutes syntax. The parenthesised destination groups the 19c and 26ai
 * grammar carries give each destination its own PRIORITY=n.
 */

import type { Finding, FindingFix } from '../../types/claims';
import type { Member, RedoRouteRule } from '../../types/topology';
import type { MemberId } from '../../ids';
import { isParenthesised } from '../../redo/parse';
import { defaultDestProps } from '../../serialize/schema';
import { isDatabase, isFarSync } from '../../types/topology';
import type { Rule, ValidateContext } from '../context';
import { mk, q, routeSubject } from '../context';

/**
 * The databases a rule names as its redo source. LOCAL is "an alias for the
 * local database name", so it names this member -- "either explicitly or
 * implicitly through use of the LOCAL keyword".
 */
const sourceKeys = (r: RedoRouteRule, m: Member): string[] =>
  r.source === 'LOCAL' ? [m.id as string]
    : r.source === 'ANY' ? ['ANY'] : r.source.map((s) => s as string);

/** A source may appear in only one rule per member. */
export const sourceUnique: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    const seen = new Map<string, number>();
    const reported = new Set<string>();
    const viaLocal = new Set<string>();
    m.redoRoutes.forEach((rule) => {
      for (const key of sourceKeys(rule, m)) {
        if (rule.source === 'LOCAL') viaLocal.add(key);
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (n < 2 || reported.has(key)) continue;
        reported.add(key);
        const name = key === (m.id as string) ? m.name : key;
        out.push(mk('ROUTES.SOURCE_UNIQUE', {
          subject: routeSubject(m),
          message: `RedoRoutes on ${q(m.name)} names the redo source ${name} in more than one rule${viaLocal.has(key) ? ` (LOCAL is ${m.name} itself)` : ''}. A database cannot be specified as a redo source in more than one redo routing rule defined at a given database, either explicitly or implicitly through use of the LOCAL keyword.`,
          cite: ['ROUTES.SOURCE_ONCE'],
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

/**
 * A snapshot standby may not forward: "The RedoRoutes property cannot be
 * configured such that when a physical standby database is converted to a
 * snapshot standby, the snapshot standby would send redo data to another
 * member." Receiving is not restricted, and a LOCAL rule sends nothing while
 * the member is a standby.
 */
export const snapshotForbidden: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.databases) {
    if (m.role !== 'snapshot') continue;
    const forwards = ctx.forwardedDests(m);
    if (forwards.length === 0) continue;
    const to = [...new Set(forwards.map((d) => d.to.name))];
    out.push(mk('ROUTES.SNAPSHOT_FORBIDDEN', {
      subject: routeSubject(m),
      message: `RedoRoutes on ${q(m.name)}, a snapshot standby database, forwards redo to ${to.map(q).join(', ')}. The property cannot be configured so that a snapshot standby would send redo data to another member; a snapshot standby still receives and archives redo from the primary.`,
      cite: ['ROUTES.SNAPSHOT_FORBIDDEN', 'ROUTES.SNAPSHOT_RECEIVES_REDO'],
    }));
  }
  return out;
};

/** "The RedoRoutes property can be set for a logical standby database only if the redo source field is set to LOCAL." */
export const logicalLocalOnly: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.databases) {
    if (m.role !== 'logical') continue;
    if (!m.redoRoutes.some((r) => r.source !== 'LOCAL')) continue;
    out.push(mk('ROUTES.LOGICAL_LOCAL_ONLY', {
      subject: routeSubject(m),
      message: `RedoRoutes on the logical standby ${q(m.name)} carries a rule whose redo source field is not LOCAL. The RedoRoutes property can be set for a logical standby database only if the redo source field is set to LOCAL.`,
      cite: ['ROUTES.LOGICAL_LOCAL_ONLY'],
    }));
  }
  return out;
};

/** A fix that sets MaxFailure to 1 for the destination `to` on `from`. */
const maxFailureFix = (ctx: ValidateContext, from: Member, to: MemberId, toName: string): FindingFix | undefined => {
  const i = ctx.indexOf(from.id);
  if (i < 0) return undefined;
  const path = `/members/${i}/dests/${to as string}`;
  return {
    label: `Set MaxFailure for ${toName} to 1`,
    patch: from.dests[to] !== undefined
      ? [{ op: 'replace', path: `${path}/maxFailure`, value: 1 }]
      : [{ op: 'add', path, value: { ...defaultDestProps(), maxFailure: 1 } }],
  };
};

const editOf = (m: Member): string => (isFarSync(m) ? 'EDIT FAR_SYNC' : 'EDIT DATABASE');

/** 12.1: an alternate requires a non-zero MaxFailure on the non-alternate member. */
export const alternateNeedsMaxFailure: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  for (const m of ctx.doc.members) {
    for (const d of ctx.declaredDests(m)) {
      const alt = d.dest.alt;
      if (!alt || d.fromAll) continue;
      const props = ctx.destPropsFor(m, d.to.id);
      if (props.maxFailure !== 0) continue;
      const fix = maxFailureFix(ctx, m, d.to.id, d.to.name);
      out.push(mk('ROUTES.ALT_NEEDS_MAXFAILURE', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} gives ${q(alt.target as string)} as the alternate of ${q(d.to.name)}, but the MaxFailure property of ${q(d.to.name)} is 0. The non-alternate member must have a non-zero value for its MaxFailure configurable property in order for an alternate to be specified: ${editOf(d.to)} ${q(d.to.name)} SET PROPERTY 'MaxFailure' = 1;`,
        cite: ['ROUTES.ALT_MAXFAILURE', 'ROUTES.GRAMMAR_121'],
        note: 'The sentence is in the 12.1 broker guide, the only edition that documents the ALT form at all; the 12.2, 19c and 26ai grammar no longer carries ALT, so the precondition is carried over to this configuration rather than stated for it.',
        ...(fix ? { fix } : {}),
      }));
    }
  }
  return out;
};

/** 26ai: a member whose MaxFailure property is zero cannot be part of a RedoRoutes group. */
export const groupNeedsMaxFailure: Rule = (ctx): Finding[] => {
  if (ctx.doc.config.edition !== '26ai') return [];
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of ctx.doc.members) {
    for (const d of ctx.declaredDests(m)) {
      if (!isParenthesised(d.group) || d.fromAll) continue;
      /* Untouched, a member in a group has MaxFailure 1: "If the standby
         database is part of a group as specified with the broker RedoRoutes
         property, then the default value 1." */
      if (ctx.destPropsFor(m, d.to.id, true).maxFailure !== 0) continue;
      const key = `${m.id as string}>${d.to.id as string}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fix = maxFailureFix(ctx, m, d.to.id, d.to.name);
      out.push(mk('ROUTES.GROUP_NEEDS_MAXFAILURE', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} puts ${q(d.to.name)} in a parenthesised group while its MaxFailure property is set to 0. A member whose MaxFailure property is set to zero cannot be part of a RedoRoutes group; inside a group the property defaults to 1.`,
        cite: ['ROUTES.GROUP_MAXFAILURE_ZERO', 'ROUTES.MAXFAILURE_GROUP_DEFAULT'],
        ...(fix ? { fix } : {}),
      }));
    }
  }
  return out;
};

/** `ALT=( ... [FALLBACK])` is 12.1 grammar: the 12.2, 19c and 26ai grammar carries PRIORITY instead. */
export const alternate121Only: Rule = (ctx): Finding[] => {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const m of ctx.doc.members) {
    for (const d of ctx.declaredDests(m)) {
      if (!d.dest.alt || seen.has(m.id as string)) continue;
      seen.add(m.id as string);
      const alt = d.dest.alt;
      out.push(mk('ROUTES.ALT_12_1_ONLY', {
        subject: routeSubject(m),
        message: `RedoRoutes on ${q(m.name)} uses the 12.1 ALT form. The ${ctx.doc.config.edition} grammar has no ALT or FALLBACK: it writes a remote alternate as one parenthesised group with a PRIORITY per destination, as in (LOCAL : (${d.to.name}${d.explicitXpt ? ` ${d.explicitXpt}` : ''} PRIORITY=1, ${alt.target as string}${alt.xpt ? ` ${alt.xpt}` : ''} PRIORITY=2)).`,
        cite: ['ROUTES.PRIORITY_26AI', 'ROUTES.PRIORITY_19C_EX_4_3', 'ROUTES.GRAMMAR_121', 'ROUTES.INTRODUCED_121'],
        note: 'ALT and FALLBACK are documented in the 12.1 broker guide only (from 12.1.0.2); the 12.2, 19c and 26ai grammar does not carry them, and 19c Example 4-3 writes the same remote alternate with PRIORITY. No page says whether a later broker still accepts the old spelling, so this is a warning about a form that has left the grammar rather than a refusal.',
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
  alternateNeedsMaxFailure, groupNeedsMaxFailure, alternate121Only,
  cascadePhysicalOnly, cascadeRealTimeAsync, cascadeFanout, cascadeSyncUndocumented,
  farSyncOnwardSync, routeCycle,
];
