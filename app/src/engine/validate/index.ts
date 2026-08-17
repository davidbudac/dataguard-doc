/**
 * The validation engine -- engine design SS2.
 *
 * `validate(doc)` resolves the document once and runs a flat list of rule
 * functions over the result, returning findings sorted by severity, then
 * subject, then rule id. Every rule is one entry in `RULE_CATALOGUE`, which is
 * where its severity and its accuracy basis live: severity says how much the
 * finding matters, basis says how well Oracle documents it, and the two are
 * orthogonal -- an error can rest on this page's model, a warning on a quoted
 * sentence.
 *
 * The generators and the UI both read their validation notes from here, so
 * that a claim is worded once.
 */

import type { Finding } from '../types/claims';
import { sortFindings } from '../types/claims';
import type { TopologyDoc } from '../types/topology';
import { buildContext } from './context';
import type { Rule, ValidateContext } from './context';
import { destRules } from './rules/dests';
import { fsfoRules } from './rules/fsfo';
import { memberRules } from './rules/members';
import { modeRules } from './rules/modes';
import { networkRules } from './rules/network';
import { observerRules } from './rules/observers';
import { routeRules } from './rules/routes';

/** Every rule the engine runs, in catalogue order. */
export const RULES: Rule[] = [
  ...memberRules,
  ...fsfoRules,
  ...modeRules,
  ...routeRules,
  ...networkRules,
  ...observerRules,
  ...destRules,
];

/**
 * Run the catalogue. Findings are deduplicated on (id, subject, message) so
 * that two rules reaching the same conclusion about the same member report it
 * once, and sorted so the output is stable between runs.
 */
export function validate(doc: TopologyDoc): Finding[] {
  const ctx = buildContext(doc);
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const rule of RULES) {
    for (const f of rule(ctx)) {
      const key = `${f.id}|${f.subject.kind}|${f.subject.id ?? ''}|${f.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return sortFindings(out);
}

/** The same run, with the context the rules saw -- for tests and the UI's why-panel. */
export function validateWithContext(doc: TopologyDoc): { findings: Finding[]; ctx: ValidateContext } {
  return { findings: validate(doc), ctx: buildContext(doc) };
}

export type { DeclaredDest, Rule, ValidateContext } from './context';
export { buildContext, mk } from './context';
export type { RuleId, RuleSpec } from './catalogue';
export {
  allowedBases, allowedSeverities, RULE_CATALOGUE, RULE_IDS, RULES_26AI_ONLY, ruleSpec,
} from './catalogue';
