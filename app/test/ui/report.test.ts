/**
 * The printable report (ui/export/report-model.ts, ui/export/Report.tsx):
 * which sections exist, that every claim keeps its accuracy label, that the
 * sources are exactly the citations the pages rest on, and that the page
 * prints light whatever theme the reader has on.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { CITATIONS } from '@/engine';
import { findPreset } from '@/presets';
import { classicDoc, doc, makeDoc } from '@/state/doc';
import { resetHistory } from '@/state/history';
import {
  issues, readoutFor, redoGraph, runFindings, topology, trace,
} from '@/state/derived';
import { parseUrlQuery, serializeUrlQuery, URL_DEFAULTS } from '@/state/url';
import { applyTheme, reportPage, theme } from '@/state/view';
import { buildReport, fsfoWord } from '@/ui/export/report-model';
import type { ReportModel } from '@/ui/export/report-model';
import { closeReport, Report } from '@/ui/export/Report';
import { Root } from '@/ui/Root';

function load(id: string): void {
  const p = findPreset(id);
  if (!p) throw new Error(`no preset ${id}`);
  resetHistory(makeDoc(p.doc()));
}

const model = (): ReportModel => buildReport({
  name: doc.value.meta.name,
  topology: topology.value,
  findings: issues.value,
  protectionLevel: redoGraph.value?.protectionLevel ?? null,
  trace: trace.value,
  runFindings: runFindings.value,
  outcome: trace.value === null ? null : readoutFor(false),
});

beforeEach(() => {
  document.body.innerHTML = '';
  reportPage.value = false;
  theme.value = 'dark';
  applyTheme('dark');
});

afterEach(() => {
  render(null, document.body);
});

describe('report model', () => {
  it('summarises the configuration: name, release, protection mode, FSFO', () => {
    load('classic');
    const m = model();
    const k = Object.fromEntries(m.summary.map((r) => [r.k, r.v]));
    expect(k['Configuration']).toBe(topology.value.config.name);
    expect(k['Oracle release']).toBe('Oracle Database 19c');
    expect(k['Protection mode']).toBe(topology.value.config.protectionMode);
    expect(k['Fast-start failover']).toBe(fsfoWord(topology.value));
    expect(k['Fast-start failover']).toMatch(/^enabled, threshold \d+ s/);
  });

  it('reports the protection level at rest, with its basis', () => {
    load('classic');
    const row = model().summary.find((r) => r.k === 'Protection level reported');
    expect(row?.v).toBe(redoGraph.value?.protectionLevel.value);
    expect(row?.basis).toBe(redoGraph.value?.protectionLevel.basis);
  });

  it('lists every member and every observer', () => {
    load('far-sync-ha-pair');
    const m = model();
    expect(m.members.map((r) => r.id)).toEqual(topology.value.members.map((x) => x.id));
    expect(m.observers.map((r) => r.id)).toEqual(topology.value.observers.map((x) => x.id));
    expect(m.members.some((r) => r.kind === 'Far sync instance')).toBe(true);
    expect(m.members.find((r) => r.kind === 'Primary database')?.fsfoTarget).toBe(false);
  });

  it('carries the three generated file groups, from the Configure generators', () => {
    load('classic');
    const m = model();
    expect(m.files.map((g) => g.id)).toEqual(['dgmgrl', 'initora', 'clients']);
    for (const g of m.files) expect(g.files.length).toBeGreaterThan(0);
    expect(m.files[2]?.files.map((f) => f.syntax)).toEqual(['tnsnames', 'jdbc']);
  });

  it('keeps every finding’s basis and note', () => {
    load('classic');
    const m = model();
    expect(m.findings.length).toBe(issues.value.length);
    m.findings.forEach((row, i) => {
      const f = issues.value[i]!;
      expect(row.basis).toBe(f.basis);
      expect(row.note).toBe(f.note);
    });
  });

  it('has a Break section exactly when the document carries events', () => {
    load('classic');
    expect(topology.value.events.length).toBeGreaterThan(0);
    const run = model().run;
    expect(run).not.toBeNull();
    expect(run?.events.length).toBe(topology.value.events.length);
    expect(run?.outcome.some((c) => c.id === 'outcome')).toBe(true);

    resetHistory(classicDoc());
    expect(topology.value.events.length).toBe(0);
    expect(model().run).toBeNull();
  });

  it('numbers the sources in order of first use, each one in the catalogue', () => {
    load('far-sync-ha-pair');
    const m = model();
    expect(m.sources.length).toBeGreaterThan(0);
    m.sources.forEach((s, i) => {
      expect(s.n).toBe(i + 1);
      expect(Object.prototype.hasOwnProperty.call(CITATIONS, s.id)).toBe(true);
      expect(m.refs[s.id]).toBe(s.n);
    });
    /* Every citation a finding or a generated line carries is in the list. */
    const cited = new Set<string>();
    for (const f of issues.value) f.cite.forEach((c) => cited.add(c));
    for (const g of m.files) {
      for (const file of g.files) for (const l of file.lines) (l.cite ?? []).forEach((c) => cited.add(c));
    }
    for (const id of cited) expect(m.refs[id]).toBeGreaterThan(0);
  });
});

describe('report page', () => {
  it('is addressable as ?report=1', () => {
    expect(parseUrlQuery('?report=1').state.report).toBe(true);
    expect(serializeUrlQuery({ ...URL_DEFAULTS, report: true })).toBe('report=1');
    expect(serializeUrlQuery({ ...URL_DEFAULTS, report: false })).toBe('');
  });

  it('renders every section, and prints light while it is open', () => {
    load('classic');
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Report, {}), root);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    const heads = [...root.querySelectorAll('.rp h2')].map((e) => e.textContent?.replace(/^\d+\s*/, ''));
    expect(heads).toEqual([
      'Summary', 'Diagram', 'Members and observers', 'Validation findings',
      'Generated configuration', 'Break: injected events and outcome', 'Sources',
    ]);
    expect(root.querySelector('.rp .topo-svg')).not.toBeNull();
    /* A model claim wears its label on paper too. */
    expect(root.querySelector('.rp .fact.b-model')).not.toBeNull();
    /* No inline style anywhere in the report. */
    expect(root.querySelector('[style]')).toBeNull();
    render(null, root);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('takes the place of the workbench, and gives it back', () => {
    resetHistory(classicDoc());
    const root = document.createElement('div');
    document.body.appendChild(root);
    reportPage.value = true;
    render(h(Root, {}), root);
    expect(root.querySelector('.report')).not.toBeNull();
    expect(root.querySelector('.app')).toBeNull();
    /* No events, no Break section. */
    expect([...root.querySelectorAll('.rp h2')].some((e) => e.textContent?.includes('Break'))).toBe(false);
    closeReport();
    render(h(Root, {}), root);
    expect(root.querySelector('.report')).toBeNull();
    render(null, root);
  });
});
