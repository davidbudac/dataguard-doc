/**
 * Structured output for the configuration generators -- engine design SS7.
 *
 * Every generator is a pure `(doc) => GeneratedFile[]`. A file is a list of
 * `Line`s rather than a string, so the DOM layer decides how a highlight, a
 * service name or a validation note is drawn, and so a golden test can compare
 * structure instead of markup. Nothing in here knows about HTML.
 *
 * A line is one of four kinds:
 *   `cmd`      the thing you would actually type or paste
 *   `note`     generated commentary that carries a Claim -- basis, cites, note
 *   `comment`  commentary in the file's own comment syntax (`#` where there is
 *              one; DGMGRL has none, so a renderer draws it parenthetically)
 *   `blank`    a spacer
 *
 * Tones and the highlight flag are the two presentation hints the published
 * page needs: `highlight` marks a value the operator changed away from the
 * broker default, and `service`/`value`/`dim` are the three colours the
 * connect-string cards already use.
 */

import type { CitationId } from '../citations';
import type { Basis, Claim, Finding } from '../types/claims';

export type LineKind = 'cmd' | 'note' | 'comment' | 'blank';

export type LineTone =
  /** Ordinary text. */
  | 'default'
  /** A value the operator set: the published cards draw these highlighted. */
  | 'value'
  /** A service name, drawn in its own colour on both connect-string cards. */
  | 'service'
  /** Commentary, drawn grey. */
  | 'dim'
  /** Something the reader must not skip: a refusal, a stale spelling. */
  | 'warn';

/** A run of text inside a line, with its own tone and highlight flag. */
export interface Span {
  text: string;
  tone?: LineTone;
  /** Drawn highlighted: a value that is not the broker/Oracle Net default. */
  highlight?: boolean;
}

export interface Line {
  kind: LineKind;
  spans: Span[];
  /** Leading indent in spaces; the renderer applies it, not the spans. */
  indent?: number;
  /** Accuracy labelling, on the lines that assert something. */
  basis?: Basis;
  cite?: CitationId[];
  /** Rendered next to the line whenever `basis` is not 'documented'. */
  note?: string;
}

export type FileSyntax = 'dgmgrl' | 'tnsnames' | 'initora' | 'jdbc' | 'show' | 'text' | 'sql';

export interface GeneratedFile {
  /** Stable id: the UI keys its cards off this. */
  id: string;
  /** Card heading. */
  title: string;
  /** Where the content belongs on disk, where that is meaningful. */
  filename?: string;
  syntax: FileSyntax;
  lines: Line[];
  /** Validation output rendered with the file; one source of truth is `validate`. */
  findings?: Finding[];
  /** Claims the file as a whole rests on -- rendered as its footnotes. */
  claims?: Claim<string>[];
}

/* ---------------- span builders ---------------- */

export const span = (text: string, tone?: LineTone): Span =>
  (tone === undefined ? { text } : { text, tone });

/** A value the operator set away from its default. */
export const hl = (text: string): Span => ({ text, tone: 'value', highlight: true });

/** A service name. */
export const svc = (text: string): Span => ({ text, tone: 'service' });

export const dim = (text: string): Span => ({ text, tone: 'dim' });

const toSpans = (content: string | Span | Span[]): Span[] =>
  typeof content === 'string' ? [{ text: content }] : Array.isArray(content) ? content : [content];

/* ---------------- line builders ---------------- */

export interface LineOptions {
  indent?: number;
  basis?: Basis;
  cite?: CitationId[];
  note?: string;
}

const build = (kind: LineKind, content: string | Span | Span[], o: LineOptions = {}): Line => {
  const l: Line = { kind, spans: toSpans(content) };
  if (o.indent !== undefined) l.indent = o.indent;
  if (o.basis !== undefined) l.basis = o.basis;
  if (o.cite !== undefined) l.cite = o.cite;
  if (o.note !== undefined) l.note = o.note;
  return l;
};

export const cmd = (content: string | Span | Span[], o?: LineOptions): Line =>
  build('cmd', content, o);

export const comment = (content: string | Span | Span[], o?: LineOptions): Line =>
  build('comment', content, o);

export const blank = (): Line => ({ kind: 'blank', spans: [] });

/** A generated remark that carries its own accuracy label. */
export function note(content: string | Span | Span[], claim: Claim<string>): Line {
  const l = build('note', content, { basis: claim.basis, cite: [...claim.cite] });
  if (claim.note !== undefined) l.note = claim.note;
  return l;
}

/* ---------------- rendering ---------------- */

/**
 * The comment marker each syntax uses. DGMGRL's own comment syntax (`--` or
 * `REM`, each terminated with a semicolon -- DGMGRL.COMMENT_SYNTAX) is not a
 * single-character prefix like the others, so it is not returned here; the UI
 * gutter draws a dot for it instead (`CodeBlock.tsx`'s `gutterFor`). `show`
 * output is a drawing, not a script, so it borrows the same parenthetical
 * treatment as a marker-less syntax would.
 */
export const commentMarker = (syntax: FileSyntax): string =>
  syntax === 'dgmgrl' || syntax === 'show' ? '' : syntax === 'sql' ? '--' : '#';

export const lineText = (line: Line): string =>
  ' '.repeat(line.indent ?? 0) + line.spans.map((s) => s.text).join('');

/**
 * Render one note/comment line's text as its syntax spells a comment.
 *
 * DGMGRL's documented form is `-- text;` (a space after the double dash, a
 * terminating semicolon -- DGMGRL.COMMENT_SYNTAX). A comment's own text must
 * not contain a `;` before that terminator, so an inner semicolon is written
 * as a comma. `show` output has no comment syntax to borrow -- it is a
 * drawing -- so its commentary stays parenthetical.
 */
export function commentText(syntax: FileSyntax, text: string): string {
  if (syntax === 'dgmgrl') return `-- ${text.trim().replace(/;/g, ',')};`;
  const marker = commentMarker(syntax);
  return marker === '' ? `(${text.trim()})` : `${marker} ${text}`;
}

/**
 * Flatten a file to plain text -- what a golden test compares and what a
 * "copy" button hands over. Comments get their syntax's marker; DGMGRL gets
 * its own documented comment syntax (`commentText`).
 */
export function renderPlain(file: GeneratedFile): string {
  return file.lines.map((l) => {
    if (l.kind === 'blank') return '';
    const text = lineText(l);
    if (l.kind === 'cmd') return text;
    return commentText(file.syntax, text);
  }).join('\n');
}
