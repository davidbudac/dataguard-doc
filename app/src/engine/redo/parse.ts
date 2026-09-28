/**
 * RedoRoutes text <-> rules -- engine design SS1.4.
 *
 * Grammar (19c broker properties page, "Redo Routing Rules"; the 26ai
 * redo-routing-rules page repeats it word for word):
 *
 *   routes   := rule*
 *   rule     := '(' source ':' destlist ')'
 *   source   := 'LOCAL' | 'ANY' | name [',' name]*
 *   destlist := 'ALL' [xpt] | group [',' group]*
 *   group    := dest                                          -- a group of one
 *             | '(' dest ['PRIORITY' '=' n] [',' dest ['PRIORITY' '=' n]]* ')'
 *   dest     := name [xpt] [alt]
 *   alt      := 'ALT' '=' '(' name [xpt] ['FALLBACK'] ')'      -- 12.1 only
 *   xpt      := 'SYNC' | 'FASTSYNC' | 'ASYNC'
 *
 * PRIORITY belongs to the destination it follows, never to the parenthesis
 * around it. Consecutive unparenthesised destinations are kept together in one
 * `DestGroup` without `explicitGroup`, which the resolver reads as one group
 * per destination -- the text round-trips either way. Two leniencies, so that
 * older text still loads: a bare destination carrying PRIORITY=n is read as a
 * parenthesised group of one, and the 12.1 `ALT=( ... )` form is still parsed
 * although 12.2, 19c and 26ai no longer carry it. `GROUP` is deliberately not
 * in this grammar: it is a LOG_ARCHIVE_DEST_n attribute, never RedoRoutes
 * syntax.
 */

import { memberId } from '../ids';
import type { MemberId } from '../ids';
import type {
  DestGroup, RedoRouteRule, RoutePriority, RouteAlternate, RouteDest, XptMode,
} from '../types/topology';

const XPTS = new Set(['SYNC', 'FASTSYNC', 'ASYNC']);

export interface RedoRoutesParseError {
  message: string;
  /** Character offset in the source text. */
  at: number;
}

export interface RedoRoutesParseResult {
  ok: boolean;
  rules: RedoRouteRule[];
  errors: RedoRoutesParseError[];
}

interface Token {
  /** 'word' or one of the punctuation characters. */
  type: 'word' | '(' | ')' | ':' | ',' | '=';
  text: string;
  at: number;
}

function tokenize(text: string): { tokens: Token[]; errors: RedoRoutesParseError[] } {
  const tokens: Token[] = [];
  const errors: RedoRoutesParseError[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')' || ch === ':' || ch === ',' || ch === '=') {
      tokens.push({ type: ch, text: ch, at: i });
      i++;
      continue;
    }
    /* Quoted names are legal in DGMGRL; keep them, unquoted. */
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) {
        errors.push({ message: 'unterminated quoted name', at: i });
        break;
      }
      tokens.push({ type: 'word', text: text.slice(i + 1, end), at: i });
      i = end + 1;
      continue;
    }
    const m = /^[A-Za-z0-9_$#.\-]+/.exec(text.slice(i));
    if (!m) {
      errors.push({ message: `unexpected character ${JSON.stringify(ch)}`, at: i });
      i++;
      continue;
    }
    tokens.push({ type: 'word', text: m[0], at: i });
    i += m[0].length;
  }
  return { tokens, errors };
}

export function parseRedoRoutes(text: string): RedoRoutesParseResult {
  const { tokens, errors } = tokenize(text);
  const rules: RedoRouteRule[] = [];
  let p = 0;

  const peek = (): Token | undefined => tokens[p];
  const next = (): Token | undefined => tokens[p++];
  const fail = (message: string, at?: number): void => {
    errors.push({ message, at: at ?? peek()?.at ?? text.length });
  };
  const expect = (type: Token['type']): Token | undefined => {
    const t = peek();
    if (!t || t.type !== type) {
      fail(`expected ${type === 'word' ? 'a name' : `'${type}'`}`);
      return undefined;
    }
    p++;
    return t;
  };
  const isXpt = (t: Token | undefined): boolean =>
    !!t && t.type === 'word' && XPTS.has(t.text.toUpperCase());
  const isKeyword = (t: Token | undefined, kw: string): boolean =>
    !!t && t.type === 'word' && t.text.toUpperCase() === kw;

  const parseXpt = (): XptMode | undefined => {
    const t = peek();
    if (!isXpt(t)) return undefined;
    p++;
    return (t as Token).text.toUpperCase() as XptMode;
  };

  const parseAlt = (): RouteAlternate | undefined => {
    if (!isKeyword(peek(), 'ALT')) return undefined;
    p++;
    if (!expect('=')) return undefined;
    if (!expect('(')) return undefined;
    const name = expect('word');
    if (!name) return undefined;
    const alt: RouteAlternate = { target: memberId(name.text) };
    const xpt = parseXpt();
    if (xpt) alt.xpt = xpt;
    if (isKeyword(peek(), 'FALLBACK')) { p++; alt.fallback = true; }
    expect(')');
    return alt;
  };

  const parseDest = (): RouteDest | undefined => {
    const name = expect('word');
    if (!name) return undefined;
    const raw = name.text;
    const dest: RouteDest = {
      target: raw.toUpperCase() === 'ALL' ? 'ALL' : (memberId(raw) as MemberId),
    };
    const xpt = parseXpt();
    if (xpt) dest.xpt = xpt;
    const alt = parseAlt();
    if (alt) dest.alt = alt;
    return dest;
  };

  const parsePriority = (): RoutePriority | undefined => {
    if (!isKeyword(peek(), 'PRIORITY')) return undefined;
    const at = (peek() as Token).at;
    p++;
    if (!expect('=')) return undefined;
    const n = expect('word');
    if (!n) return undefined;
    const v = Number(n.text);
    if (!Number.isInteger(v) || v < 1 || v > 8) {
      fail(`PRIORITY must be an integer 1..8, got ${n.text}`, at);
      return undefined;
    }
    return v as RoutePriority;
  };

  /* PRIORITY=n belongs to the destination it follows. */
  const parseDestWithPriority = (): RouteDest | undefined => {
    const d = parseDest();
    if (!d) return undefined;
    const prio = parsePriority();
    if (prio !== undefined) d.priority = prio;
    return d;
  };

  const parseGroupParen = (): DestGroup | undefined => {
    if (!expect('(')) return undefined;
    const dests: RouteDest[] = [];
    for (;;) {
      const d = parseDestWithPriority();
      if (!d) return undefined;
      dests.push(d);
      const t = peek();
      if (t && t.type === ',') { p++; continue; }
      break;
    }
    if (!expect(')')) return undefined;
    return { dests, explicitGroup: true };
  };

  const parseRule = (): RedoRouteRule | undefined => {
    if (!expect('(')) return undefined;

    /* source */
    let source: RedoRouteRule['source'];
    const first = expect('word');
    if (!first) return undefined;
    const up = first.text.toUpperCase();
    if (up === 'LOCAL' || up === 'ANY') {
      source = up;
    } else {
      const names: MemberId[] = [memberId(first.text)];
      while (peek()?.type === ',') {
        p++;
        const n = expect('word');
        if (!n) return undefined;
        names.push(memberId(n.text));
      }
      source = names;
    }
    if (!expect(':')) return undefined;

    /* destinations */
    const groups: DestGroup[] = [];
    let flat: RouteDest[] = [];
    const flushFlat = (): void => {
      if (flat.length === 0) return;
      groups.push({ dests: flat });
      flat = [];
    };

    for (;;) {
      const t = peek();
      if (!t) { fail("expected a destination or ')'"); return undefined; }
      if (t.type === ')') break;
      if (t.type === '(') {
        flushFlat();
        const g = parseGroupParen();
        if (!g) return undefined;
        groups.push(g);
      } else {
        const d = parseDestWithPriority();
        if (!d) return undefined;
        if (d.priority !== undefined) {
          /* Not the documented spelling -- PRIORITY is written inside the
             parentheses -- so it is read as the group of one it must mean. */
          flushFlat();
          groups.push({ dests: [d], explicitGroup: true });
        } else {
          flat.push(d);
        }
      }
      const sep = peek();
      if (sep && sep.type === ',') { p++; continue; }
      break;
    }
    flushFlat();
    if (!expect(')')) return undefined;
    if (groups.length === 0) { fail('a rule needs at least one destination'); return undefined; }
    return { source, groups };
  };

  while (p < tokens.length) {
    const before = p;
    const t = peek();
    if (t && t.type === ',') { p++; continue; }   /* rules may be comma separated */
    const r = parseRule();
    if (r) rules.push(r);
    if (p === before) { p++; }                    /* never spin on a bad token */
  }

  if (tokens.length === 0 && text.trim() !== '') {
    errors.push({ message: 'no routing rule found', at: 0 });
  }

  return { ok: errors.length === 0, rules, errors };
}

export function parseRedoRoutesOrThrow(text: string): RedoRouteRule[] {
  const r = parseRedoRoutes(text);
  if (!r.ok) {
    const e = r.errors[0] as RedoRoutesParseError;
    throw new Error(`RedoRoutes parse error at ${e.at}: ${e.message}`);
  }
  return r.rules;
}

/* ---------------- formatting ---------------- */

export type RedoRoutesDialect = 'auto' | '12.1' | 'priority';

export interface FormatOptions {
  /**
   * 'auto' writes parentheses only where the rules have them (or where a
   * destination carries a PRIORITY, which needs them), so a plain
   * `(LOCAL : FS1 SYNC)` round-trips unchanged. 'priority' parenthesises every
   * group, each unparenthesised destination on its own; '12.1' drops the
   * parentheses and every PRIORITY, since 12.1 has neither.
   */
  dialect?: RedoRoutesDialect;
}

const formatDest = (d: RouteDest, withPriority: boolean): string => {
  let s = d.target === 'ALL' ? 'ALL' : String(d.target);
  if (d.xpt) s += ` ${d.xpt}`;
  if (d.alt) {
    let a = String(d.alt.target);
    if (d.alt.xpt) a += ` ${d.alt.xpt}`;
    if (d.alt.fallback) a += ' FALLBACK';
    s += ` ALT=(${a})`;
  }
  if (withPriority && d.priority !== undefined) s += ` PRIORITY=${d.priority}`;
  return s;
};

const formatSource = (s: RedoRouteRule['source']): string =>
  s === 'LOCAL' || s === 'ANY' ? s : s.map(String).join(', ');

/** Written in parentheses: explicitly, or because a destination carries PRIORITY. */
export const isParenthesised = (g: DestGroup): boolean =>
  g.explicitGroup === true || g.dests.some((d) => d.priority !== undefined);

export function formatRedoRule(rule: RedoRouteRule, opts: FormatOptions = {}): string {
  const dialect = opts.dialect ?? 'auto';
  const parts = rule.groups.map((g) => {
    if (dialect === '12.1') return g.dests.map((d) => formatDest(d, false)).join(', ');
    const inner = g.dests.map((d) => formatDest(d, true));
    if (isParenthesised(g)) return `(${inner.join(', ')})`;
    if (dialect === 'priority') return inner.map((x) => `(${x})`).join(', ');
    return inner.join(', ');
  });
  return `(${formatSource(rule.source)} : ${parts.join(', ')})`;
}

export function formatRedoRoutes(
  rules: readonly RedoRouteRule[], opts: FormatOptions = {},
): string {
  return rules.map((r) => formatRedoRule(r, opts)).join('');
}
