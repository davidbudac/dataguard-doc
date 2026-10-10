/**
 * One generated file, drawn as a block of lines (engine design SS7).
 *
 * The generators emit structured `Line`s rather than text, so this component
 * decides three things the engine deliberately does not:
 *
 *  - **the gutter marker** -- a number for a line you would type, a dot for
 *    generated commentary, the file's own comment marker for a comment;
 *  - **the accuracy label** -- a `note` whose basis is not `documented` wears
 *    the word next to the line, never in a footnote at the bottom (ui.md SS0.5);
 *  - **the cross-highlight** -- a line that names a member carries
 *    `data-member`, and pointing at it hovers that card on the canvas. The
 *    drawing and the text are the same object seen twice, so selecting a
 *    member on the canvas highlights its lines here and scrolls them into view.
 *
 * Copy hands over `renderPlain(file)` -- the same text a golden test compares,
 * so what the reader pastes is what the engine generated, comment markers and
 * all. Where the browser gives the page no clipboard, the button is disabled
 * and says why rather than failing silently.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { commentMarker, isFarSync, lineText, memberHosts, renderPlain } from '@/engine';
import type { Finding, GeneratedFile, Line, Span, TopologyDoc } from '@/engine';
import { hovered, selection, toast } from '@/state/view';
import { Fact } from '@/ui/common/Chip';
import { WhyPill } from '@/ui/common/WhyPill';
import type { WhyState } from '@/ui/common/WhyPill';

/* ---------------- who a line is about ---------------- */

export interface Mention {
  /** The canvas key: a member id, an observer id or a site id. */
  id: string;
  /** The spelling that appears in the generated text. */
  name: string;
}

/** Characters that keep a name from being a whole token in the generated text. */
const WORDY = /[A-Za-z0-9_.$-]/;

/**
 * Every name the generators can print, longest first, mapped to the key the
 * canvas selects by. Hosts map to the member that runs on them, so
 * `dc1-prm01` in a `tnsnames.ora` ADDRESS highlights `prm01`'s card.
 */
export function mentionIndex(doc: TopologyDoc): Mention[] {
  const out: Mention[] = [];
  for (const m of doc.members) {
    out.push({ id: m.id as string, name: m.name });
    for (const h of memberHosts(m)) {
      const host = doc.hosts.find((x) => x.id === h);
      if (host) out.push({ id: m.id as string, name: host.name });
    }
    if (!isFarSync(m)) {
      for (const inst of m.instances) out.push({ id: m.id as string, name: inst.name });
    }
  }
  for (const o of doc.observers) {
    out.push({ id: o.id as string, name: o.name });
    const host = doc.hosts.find((x) => x.id === o.host);
    if (host) out.push({ id: o.id as string, name: host.name });
  }
  /* Longest first: `dc1-prm01` must win over `prm01` inside it. */
  return out.filter((m) => m.name !== '').sort((a, b) => b.name.length - a.name.length);
}

/** The first name in `text` that is a whole token; null when there is none. */
export function subjectOf(text: string, index: readonly Mention[]): string | null {
  for (const m of index) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(m.name, from);
      if (at < 0) break;
      const before = at === 0 ? '' : text.charAt(at - 1);
      const after = text.charAt(at + m.name.length);
      if (!WORDY.test(before) && !WORDY.test(after)) return m.id;
      from = at + 1;
    }
  }
  return null;
}

/* ---------------- rendering one line ---------------- */

function Spans({ spans }: { spans: readonly Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        const cls = [s.tone && s.tone !== 'default' ? `sp-${s.tone}` : '', s.highlight ? 'is-hl' : '']
          .filter(Boolean).join(' ');
        return cls === '' ? <span key={i}>{s.text}</span> : <span key={i} class={cls}>{s.text}</span>;
      })}
    </>
  );
}

const gutterFor = (line: Line, syntax: GeneratedFile['syntax'], n: number): string => {
  if (line.kind === 'cmd') return String(n);
  if (line.kind === 'blank') return '';
  if (line.kind === 'comment') return commentMarker(syntax) || '·';
  return '·';
};

/* ---------------- the scripts in a file ---------------- */

/** The heading without the explanation after its dash: "DGMGRL -- the broker configuration" is "DGMGRL". */
const shortTitle = (title: string): string => title.split(' -- ')[0] ?? title;

/**
 * A generated file as the scripts a reader pastes: only the lines you would
 * type, one script per section the generator marks (or the whole file when it
 * marks none), each with the session line it needs to run on its own. The
 * commentary stays in the generator and its tests; it is not drawn here.
 */
export function scriptsOf(file: GeneratedFile): GeneratedFile[] {
  const parts = file.sections !== undefined && file.sections.length > 0
    ? file.sections
    : [{ title: shortTitle(file.title), start: 0 }];
  const out: GeneratedFile[] = [];
  parts.forEach((part, i) => {
    const end = parts[i + 1]?.start ?? file.lines.length;
    const kept: Line[] = [];
    for (const l of file.lines.slice(part.start, end)) {
      if (l.kind === 'cmd') kept.push(l);
      else if (l.kind === 'comment' && 'shell' in part && part.shell) kept.push({ ...l, kind: 'cmd' });
      /* A spacer only between two commands, never two in a row. */
      else if (l.kind === 'blank' && kept.length > 0 && kept[kept.length - 1]!.kind !== 'blank') kept.push(l);
    }
    while (kept.length > 0 && kept[kept.length - 1]!.kind === 'blank') kept.pop();
    if (kept.length === 0) return;
    const prelude = 'prelude' in part ? part.prelude ?? [] : [];
    out.push({
      id: `${file.id}.${i}`,
      title: part.title,
      ...(parts.length === 1 && file.filename !== undefined ? { filename: file.filename } : {}),
      syntax: file.syntax,
      lines: prelude.length > 0 ? [...prelude, { kind: 'blank', spans: [] }, ...kept] : kept,
    });
  });
  return out;
}

/* ---------------- the block ---------------- */

export interface CodeBlockProps {
  file: GeneratedFile;
  /** The document the names come from, for the cross-highlight. */
  doc: TopologyDoc;
}

export function CodeBlock({ file, doc }: CodeBlockProps) {
  const index = useMemo(() => mentionIndex(doc), [doc]);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLOListElement | null>(null);
  const sel = selection.value;
  const hot = hovered.value;

  /* Selecting a member on the canvas scrolls its first line into view. The
     drawing and the text are the same object seen twice. */
  useEffect(() => {
    const first = sel[0];
    const el = box.current;
    if (first === undefined || el === null) return;
    const line = el.querySelector(`[data-member="${CSS?.escape ? CSS.escape(first) : first}"]`);
    if (line && typeof (line as HTMLElement).scrollIntoView === 'function') {
      (line as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [sel[0], file.id]);

  const clip = typeof navigator !== 'undefined' && navigator.clipboard !== undefined
    && typeof navigator.clipboard.writeText === 'function';
  const why: WhyState = clip
    ? { state: 'on' }
    : { state: 'off', why: 'This browser gives the page no clipboard -- select the block and copy with the keyboard' };

  const copy = async (): Promise<void> => {
    if (!clip) return;
    try {
      await navigator.clipboard.writeText(renderPlain(file));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      toast.value = { kind: 'info', text: `${file.title} copied to the clipboard.` };
    } catch {
      toast.value = {
        kind: 'warn',
        text: 'The browser refused the clipboard. Select the block and copy with the keyboard.',
      };
    }
  };

  let n = 0;
  return (
    <section class="cb" aria-label={file.title}>
      <div class="cb-hd">
        <span class="eyebrow">{file.title}</span>
        {file.filename === undefined ? null : <span class="cb-file">{file.filename}</span>}
        <span class="grow" />
        <span class="ctl-off">
          <button
            type="button" class={copied ? 'btn is-primary' : 'btn'} disabled={!clip}
            onClick={() => { void copy(); }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <WhyPill why={why} />
        </span>
      </div>

      <ol class="cb-code" ref={box}>
        {file.lines.map((line, i) => {
          if (line.kind === 'cmd') n += 1;
          const text = lineText(line);
          const subject = line.kind === 'blank' ? null : subjectOf(text, index);
          const isHot = subject !== null && subject === hot;
          const isSel = subject !== null && sel.includes(subject);
          const cls = [
            'cb-ln', `k-${line.kind}`,
            line.basis === undefined ? '' : `b-${line.basis}`,
            subject === null ? '' : 'has-subject',
            isHot ? 'is-hot' : '', isSel && !isHot ? 'is-sel' : '',
          ].filter(Boolean).join(' ');
          return (
            <li
              key={i}
              class={cls}
              data-member={subject ?? undefined}
              onPointerEnter={subject === null ? undefined : () => { hovered.value = subject; }}
              onPointerLeave={subject === null ? undefined : () => {
                if (hovered.value === subject) hovered.value = null;
              }}
            >
              <span class="cb-g" aria-hidden="true">{gutterFor(line, file.syntax, n)}</span>
              <code class="cb-t">
                {line.indent === undefined || line.indent === 0 ? null : ' '.repeat(line.indent)}
                <Spans spans={line.spans} />
                {line.basis === undefined || line.basis === 'documented'
                  ? null
                  : <Fact basis={line.basis} id={line.note} />}
              </code>
            </li>
          );
        })}
      </ol>

      {(file.findings ?? []).length === 0 && (file.claims ?? []).length === 0 ? null : (
        <div class="cb-foot">
          {(file.findings ?? []).map((f: Finding) => (
            <p key={f.id + (f.subject.id ?? '')} class="cb-claim">
              <span class="mono">{f.id}</span>{' — '}{f.message}
              {f.basis === 'documented' ? null : <Fact basis={f.basis} id={f.id} />}
            </p>
          ))}
          {(file.claims ?? []).map((c, i) => (
            <p key={`c${i}`} class="cb-claim">
              {c.value}
              {c.basis === 'documented' ? null : <Fact basis={c.basis} />}
              {c.note === undefined ? null : <span class="caption"> {c.note}</span>}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
