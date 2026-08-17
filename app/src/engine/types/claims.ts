/**
 * Accuracy labelling as a data type (engine design SS0.2) and the Finding type
 * the validation engine returns (SS2).
 *
 * The rule the whole app rests on: every derived quantity that is not plain
 * arithmetic over user inputs is either `documented` with a citation, or it
 * carries a `model` / `inferred` label with a note that gets rendered.
 */

import type { CitationId } from '../citations';

export type Basis =
  /** A documentation sentence says exactly this; `cite` must be present. */
  | 'documented'
  /** 19c is silent, a later edition states it. */
  | 'doc-later'
  /** Two Oracle pages disagree; both citations present. */
  | 'conflict'
  /** A deduction from two documented sentences. */
  | 'inferred'
  /** This page's model; must be rendered as such. */
  | 'model';

export interface Claim<T> {
  value: T;
  basis: Basis;
  /** Ids into the citation catalogue (URL + quoted sentence). */
  cite: CitationId[];
  /** Rendered next to the value when basis !== 'documented'. */
  note?: string;
}

/** A basis that must never appear without a note. */
export const NEEDS_NOTE: readonly Basis[] = ['model', 'inferred', 'doc-later', 'conflict'];

/**
 * Structural check used by tests and by the runtime constructors: a documented
 * claim needs a citation, and everything else needs a note as well.
 */
export function claimWellFormed(c: Claim<unknown> | Finding): boolean {
  if (c.basis === 'documented') return c.cite.length > 0;
  if (c.basis === 'conflict') return c.cite.length >= 2 && !!c.note;
  return !!c.note;
}

export function documented<T>(value: T, cite: CitationId[], note?: string): Claim<T> {
  if (cite.length === 0) throw new Error('a documented claim needs at least one citation');
  return note === undefined ? { value, basis: 'documented', cite } : { value, basis: 'documented', cite, note };
}

export function docLater<T>(value: T, cite: CitationId[], note: string): Claim<T> {
  return { value, basis: 'doc-later', cite, note };
}

export function conflict<T>(value: T, cite: CitationId[], note: string): Claim<T> {
  if (cite.length < 2) throw new Error('a conflict claim must cite both sides');
  return { value, basis: 'conflict', cite, note };
}

export function inferred<T>(value: T, cite: CitationId[], note: string): Claim<T> {
  return { value, basis: 'inferred', cite, note };
}

export function model<T>(value: T, note: string, cite: CitationId[] = []): Claim<T> {
  return { value, basis: 'model', cite, note };
}

/** Map a claim's value while keeping its labelling intact. */
export function mapClaim<A, B>(c: Claim<A>, f: (a: A) => B): Claim<B> {
  return c.note === undefined
    ? { value: f(c.value), basis: c.basis, cite: [...c.cite] }
    : { value: f(c.value), basis: c.basis, cite: [...c.cite], note: c.note };
}

/* ---------------- Findings (SS2) ---------------- */

export type Severity = 'error' | 'warning' | 'info';

export type SubjectKind = 'member' | 'observer' | 'link' | 'config' | 'route';

export interface FindingSubject {
  kind: SubjectKind;
  id?: string;
}

/** A minimal RFC-6902-shaped patch; the UI applies it to the document. */
export interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}
export type JsonPatch = JsonPatchOp[];

export interface FindingFix {
  label: string;
  patch: JsonPatch;
}

export interface Finding {
  /** Stable rule id, e.g. 'FSFO.TARGET_DIRECT_REDO'. */
  id: string;
  severity: Severity;
  /** Orthogonal to severity: a warning can be documented, an error a model. */
  basis: Basis;
  cite: CitationId[];
  subject: FindingSubject;
  message: string;
  /** ORA- number when the broker has one for this refusal. */
  ora?: string;
  fix?: FindingFix;
  note?: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Deterministic ordering: severity, then subject, then rule id. */
export function compareFindings(a: Finding, b: Finding): number {
  const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (s !== 0) return s;
  const ka = `${a.subject.kind}:${a.subject.id ?? ''}`;
  const kb = `${b.subject.kind}:${b.subject.id ?? ''}`;
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}
