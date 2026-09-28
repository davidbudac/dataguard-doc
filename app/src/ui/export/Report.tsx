/**
 * The whole project as one printable document (docs/tasks/ui-followups.md 2.2).
 *
 * A page, not a PDF generator: ⋯ → "Report as PDF" opens it in place of the
 * workbench and asks the browser to print, and the browser's "Save as PDF" is
 * the PDF. That keeps it inside the page's policy (no script, no worker, no
 * font or library fetched), keeps the text selectable and the diagram vector,
 * and costs no dependency. It is addressable as `?report=1`, so it survives a
 * reload and a headless browser can print it without a click.
 *
 * What it says comes from `report-model.ts`, which reads the same generators
 * and validator as the workbench. The report always prints light: while it is
 * open the root is pinned to the light theme, and the reader's own choice is
 * put back when it closes -- a dark A4 page is ink, not a report.
 */

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { commentMarker, lineText } from '@/engine';
import type { Basis, GeneratedFile, Line } from '@/engine';
import { doc } from '@/state/doc';
import {
  geometry, issues, readoutFor, redoGraph, runFindings, topology, trace,
} from '@/state/derived';
import { applyTheme, reportPage, theme } from '@/state/view';
import { Fact } from '../common/Chip';
import { TopoCanvas } from '../canvas/TopoCanvas';
import { Timeline } from '../timeline/Timeline';
import { buildReport, diagramLandscape } from './report-model';
import type { FindingRow, ReportModel } from './report-model';
import '@/styles/report.css';

/* ---------------- opening and closing ---------------- */

const nextFrame = (): Promise<void> =>
  new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r());
    else setTimeout(r, 0);
  });

/** Ask the browser to print -- its dialog is where "Save as PDF" lives. */
export function printReport(): void {
  if (typeof window !== 'undefined' && typeof window.print === 'function') window.print();
}

/** ⋯ → Report as PDF: show the report, let it lay out, then print it. */
export async function openReport(): Promise<void> {
  reportPage.value = true;
  await nextFrame();
  await nextFrame();
  printReport();
}

export function closeReport(): void {
  reportPage.value = false;
}

/** Light while the report is open; the reader's theme and the title come back after. */
function useReportChrome(title: string): void {
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.setAttribute('data-theme', 'light');
    root.classList.add('is-report');
    const was = document.title;
    /* The title is the file name "Save as PDF" proposes. */
    document.title = `${title} — Data Guard configuration report`;
    return () => {
      root.classList.remove('is-report');
      applyTheme(theme.value);
      document.title = was;
    };
  }, [title]);
}

/* ---------------- small pieces ---------------- */

function Refs({ refs }: { refs: readonly number[] | undefined }) {
  if (refs === undefined || refs.length === 0) return null;
  return <sup class="rp-ref">[{refs.join(', ')}]</sup>;
}

/** The label an undocumented value wears, and on paper its note beside it. */
function Basis({ basis, note }: { basis: Basis; note?: string | undefined }) {
  if (basis === 'documented') return null;
  return (
    <>
      <Fact basis={basis} />
      {note === undefined ? null : <span class="rp-note"> {note}</span>}
    </>
  );
}

const SEVERITY_WORD = { error: 'Error', warning: 'Warning', info: 'Note' } as const;

function Findings({ rows, empty }: { rows: readonly FindingRow[]; empty: string }) {
  if (rows.length === 0) return <p class="rp-empty">{empty}</p>;
  return (
    <ul class="rp-findings">
      {rows.map((f, i) => (
        <li key={`${f.id}-${i}`} class={`rp-finding sv-${f.severity}`}>
          <p class="rp-finding-hd">
            <span class={`rp-sev sv-${f.severity}`}>{SEVERITY_WORD[f.severity]}</span>
            <span class="mono">{f.id}</span>
            <span class="rp-subj">{f.subject}</span>
            {f.ora === undefined ? null : <span class="mono rp-ora">{f.ora}</span>}
          </p>
          <p class="rp-finding-msg">
            {f.message}
            <Refs refs={f.refs} />
            <Basis basis={f.basis} note={f.note} />
          </p>
        </li>
      ))}
    </ul>
  );
}

function CodeLine({ line, syntax, refs }: {
  line: Line;
  syntax: GeneratedFile['syntax'];
  refs: Readonly<Record<string, number>>;
}) {
  if (line.kind === 'blank') return <div class="rp-ln is-blank"> </div>;
  const marker = commentMarker(syntax);
  const text = lineText(line);
  const shown = line.kind === 'cmd'
    ? text
    : marker === '' ? `(${text.trim()})` : `${marker} ${text}`;
  const nums = (line.cite ?? []).map((id) => refs[id]).filter((n): n is number => n !== undefined);
  return (
    <div class={`rp-ln k-${line.kind}`}>
      <code>{shown}</code>
      <Refs refs={nums} />
      {line.basis === undefined ? null : <Basis basis={line.basis} note={line.note} />}
    </div>
  );
}

function FileBlock({ file, model }: { file: GeneratedFile; model: ReportModel }) {
  return (
    <div class="rp-file">
      <p class="rp-file-hd">
        <span class="rp-file-t">{file.title}</span>
        {file.filename === undefined ? null : <span class="mono rp-file-n">{file.filename}</span>}
      </p>
      <div class="rp-code">
        {file.lines.map((l, i) => <CodeLine key={i} line={l} syntax={file.syntax} refs={model.refs} />)}
      </div>
      {(file.claims ?? []).length === 0 ? null : (
        <ul class="rp-claims">
          {(file.claims ?? []).map((c, i) => (
            <li key={i}>
              {c.value}
              <Refs refs={c.cite.map((id) => model.refs[id]).filter((n): n is number => n !== undefined)} />
              <Basis basis={c.basis} note={c.note} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Whether the diagram prints on a landscape page (report.css, `@page
 * diagram`), read off the drawing actually rendered: its viewBox is the
 * layout's box united with the routed links, which only the canvas knows.
 * A layout effect, so the class is in place before the first paint -- and so
 * before a headless browser prints.
 */
function useWideDiagram(): { ref: (el: HTMLElement | null) => void; landscape: boolean } {
  const host = useRef<HTMLElement | null>(null);
  const [landscape, setLandscape] = useState(false);
  useLayoutEffect(() => {
    const box = host.current?.querySelector('.topo-svg')?.getAttribute('viewBox')
      ?.trim().split(/[\s,]+/).map(Number);
    const next = diagramLandscape(box?.[2] ?? 0, box?.[3] ?? 0);
    if (next !== landscape) setLandscape(next);
  });
  return { ref: (el) => { host.current = el; }, landscape };
}

/* ---------------- the report ---------------- */

export function Report() {
  const t = topology.value;
  const tr = trace.value;
  const model = buildReport({
    name: doc.value.meta.name,
    topology: t,
    findings: issues.value,
    /* The level at rest, from the redo graph -- not the run's last epoch,
       which after a crash is the level the survivors are left at. */
    protectionLevel: redoGraph.value?.protectionLevel ?? null,
    trace: tr,
    runFindings: runFindings.value,
    outcome: tr === null ? null : readoutFor(false),
  });
  useReportChrome(model.title);
  const wide = useWideDiagram();
  const graph = redoGraph.value;
  const geo = geometry.value;
  const date = new Date().toISOString().slice(0, 10);
  let n = 0;
  const num = (): number => { n += 1; return n; };

  return (
    <div class="report">
      <nav class="rp-bar" aria-label="Report">
        <button type="button" class="btn" onClick={() => closeReport()}>
          <span aria-hidden="true">←</span> Back to the workbench
        </button>
        <span class="rp-bar-t">Report preview · A4</span>
        <button type="button" class="btn is-solid" onClick={() => printReport()}>
          Print or save as PDF
        </button>
      </nav>

      <article class="rp" aria-label="Configuration report">
        <header class="rp-head">
          <p class="rp-kicker">Oracle Data Guard configuration report</p>
          <h1 class="rp-title">{model.title}</h1>
          <p class="rp-meta">
            {model.edition} · broker configuration <span class="mono">{model.configName}</span>
            {' '}· generated {date}
          </p>
          <p class="rp-lede">
            Generated by the Data Guard topology simulator from the configuration below. A value
            marked <Fact basis="model" /> is this page’s model rather than a documented Oracle
            behaviour; bracketed numbers point to the sources at the end.
          </p>
        </header>

        <section class="rp-sec" aria-labelledby="rp-s-summary">
          <h2 id="rp-s-summary"><span class="rp-n">{num()}</span> Summary</h2>
          <dl class="rp-sum">
            {model.summary.map((r) => (
              <div key={r.k} class="rp-sum-row">
                <dt>{r.k}</dt>
                <dd>
                  <span class="mono">{r.v}</span>
                  <Refs refs={r.refs} />
                  {r.basis === undefined ? null : <Basis basis={r.basis} note={r.note} />}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          class={wide.landscape ? 'rp-sec rp-diagram is-landscape' : 'rp-sec rp-diagram'}
          aria-labelledby="rp-s-diagram"
          ref={wide.ref}
        >
          <h2 id="rp-s-diagram"><span class="rp-n">{num()}</span> Diagram</h2>
          {wide.landscape ? (
            <p class="rp-note rp-screen">
              Printed on a landscape page of its own: the drawing is too wide to read on a
              portrait one.
            </p>
          ) : null}
          {graph === null ? (
            <p class="rp-empty">No primary database is declared, so there is no redo graph to draw.</p>
          ) : (
            <TopoCanvas
              doc={t}
              graph={graph}
              {...(geo === null ? {} : { geometry: geo })}
              frame={null}
              overrides={doc.value.layout}
              interactive={false}
              prefix="rp"
              readOnlyWhy="The configuration as drawn in the workbench, at rest."
            />
          )}
        </section>

        <section class="rp-sec is-page" aria-labelledby="rp-s-members">
          <h2 id="rp-s-members"><span class="rp-n">{num()}</span> Members and observers</h2>
          <table class="rp-tab">
            <thead>
              <tr>
                <th>Member</th><th>Kind</th><th>Data centre</th><th>Instances</th>
                <th>LogXptMode</th><th>Open mode</th><th>FSFO target</th>
              </tr>
            </thead>
            <tbody>
              {model.members.map((m) => (
                <tr key={m.id}>
                  <td class="mono">{m.name}</td><td>{m.kind}</td><td class="mono">{m.site}</td>
                  <td class="mono">{m.instances}</td><td class="mono">{m.transport}</td>
                  <td>{m.open}</td><td>{m.fsfoTarget ? 'yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {model.observers.length === 0 ? (
            <p class="rp-empty">No observer is deployed.</p>
          ) : (
            <table class="rp-tab">
              <thead>
                <tr><th>Observer</th><th>Host</th><th>Data centre</th><th>Role</th><th>Running</th></tr>
              </thead>
              <tbody>
                {model.observers.map((o) => (
                  <tr key={o.id}>
                    <td class="mono">{o.name}</td><td class="mono">{o.host}</td>
                    <td class="mono">{o.site}</td><td>{o.role}</td><td>{o.running ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section class="rp-sec" aria-labelledby="rp-s-findings">
          <h2 id="rp-s-findings"><span class="rp-n">{num()}</span> Validation findings</h2>
          <Findings rows={model.findings} empty="The validator raised nothing for this configuration." />
        </section>

        <section class="rp-sec is-page" aria-labelledby="rp-s-files">
          <h2 id="rp-s-files"><span class="rp-n">{num()}</span> Generated configuration</h2>
          <p class="rp-lead">
            The same files the Configure mode generates. Grey lines are this page commenting,
            not part of the syntax.
          </p>
          {model.files.map((g) => (
            <div key={g.id} class="rp-group">
              <h3>{g.title}</h3>
              <p class="rp-lead">{g.lead}</p>
              {g.files.length === 0
                ? <p class="rp-empty">No primary database is declared, so no member ships redo.</p>
                : g.files.map((f) => <FileBlock key={f.id} file={f} model={model} />)}
            </div>
          ))}
        </section>

        {model.run === null || tr === null ? null : (
          <section class="rp-sec is-page" aria-labelledby="rp-s-run">
            <h2 id="rp-s-run"><span class="rp-n">{num()}</span> Break: injected events and outcome</h2>
            <table class="rp-tab rp-events">
              <thead><tr><th>t (s)</th><th>Event</th></tr></thead>
              <tbody>
                {model.run.events.map((e, i) => (
                  <tr key={i}><td class="mono num">{e.at}</td><td>{e.text}</td></tr>
                ))}
              </tbody>
            </table>
            <h3>Outcome</h3>
            <dl class="rp-sum">
              {model.run.outcome.map((c) => (
                <div key={c.id} class="rp-sum-row">
                  <dt>{c.k}</dt>
                  <dd>
                    <span class="mono">{c.v}{c.unit ? ` ${c.unit}` : ''}</span>
                    {c.v2 ? <span class="rp-v2"> · {c.v2}</span> : null}
                    <Refs refs={(c.cite ?? []).map((id) => model.refs[id]).filter((x): x is number => x !== undefined)} />
                    {c.basis === undefined ? null : <Basis basis={c.basis} />}
                    <span class="rp-sub">{c.sub}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <h3>Timeline</h3>
            <div class="rp-timeline">
              <Timeline
                trace={tr}
                doc={t}
                width={680}
                tNow={tr.axis.horizon}
                pinnedScale
                showTransport={false}
              />
            </div>
            <h3>What the run reported</h3>
            <Findings rows={model.run.findings} empty="The run raised no findings of its own." />
          </section>
        )}

        <section class="rp-sec is-page rp-sources" aria-labelledby="rp-s-sources">
          <h2 id="rp-s-sources"><span class="rp-n">{num()}</span> Sources</h2>
          {model.sources.length === 0 ? <p class="rp-empty">No source is cited above.</p> : (
            <ol class="rp-src">
              {model.sources.map((s) => (
                <li key={s.id} value={s.n}>
                  <p class="rp-src-q">
                    {s.paraphrase ? s.quote : <>“{s.quote}”</>}
                    {s.paraphrase ? <span class="rp-note"> (paraphrased)</span> : null}
                  </p>
                  <p class="rp-src-u">
                    <span class="mono">{s.id}</span> · Oracle {s.edition}
                    {s.crossEdition ? ' (cross-edition)' : ''} · <a class="rp-url" href={s.url}>{s.url}</a>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>
    </div>
  );
}
