/**
 * The printable report (ui/export/report-model.ts, ui/export/Report.tsx):
 * which sections exist, that every claim keeps its accuracy label, that the
 * sources are exactly the citations the pages rest on, and that the page
 * prints light whatever theme the reader has on.
 *
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { applyTheme, edition, reportPage, theme } from '@/state/view';
import {
  A4_LANDSCAPE_ROOM, A4_PORTRAIT_ROOM, buildReport, diagramLandscape, fsfoWord, printScale,
} from '@/ui/export/report-model';
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

  /* Oracle titles the 26ai documentation set "Oracle AI Database" (the TOC's
     "Changes in Oracle AI Database Release 26ai"); the short edition label
     stays "26ai". */
  it('spells out the 26ai release as "Oracle AI Database 26ai"', () => {
    load('classic');
    edition.value = '26ai';
    try {
      const k = Object.fromEntries(model().summary.map((r) => [r.k, r.v]));
      expect(k['Oracle release']).toBe('Oracle AI Database 26ai');
    } finally {
      edition.value = '19c';
    }
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
      'Generated configuration', 'Simulate: injected events and outcome', 'Sources',
    ]);
    expect(root.querySelector('.rp .topo-svg')).not.toBeNull();
    /* A model claim wears its label on paper too. */
    expect(root.querySelector('.rp .fact.b-model')).not.toBeNull();
    /* No inline style anywhere in the report. */
    expect(root.querySelector('[style]')).toBeNull();
    render(null, root);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('prints the Split brain reading like any other outcome row: labelled as the model, with its sources numbered', () => {
    load('classic');
    const m = model();
    const chip = m.run?.outcome.find((c) => c.id === 'split');
    expect(chip).toMatchObject({ k: 'Split brain', v: 'no', basis: 'model' });
    for (const id of chip?.cite ?? []) expect(m.refs[id]).toBeGreaterThan(0);
    const root = document.createElement('div');
    document.body.appendChild(root);
    render(h(Report, {}), root);
    const row = [...root.querySelectorAll('.rp-sum-row')].find((r) => r.querySelector('dt')?.textContent === 'Split brain');
    expect(row).toBeDefined();
    expect(row?.querySelector('dd .mono')?.textContent).toBe('no');
    expect(row?.querySelector('.fact.b-model')).not.toBeNull();
    expect(row?.querySelector('.rp-sub')?.textContent).toMatch(/^prm01 is down when sby01 opens at/);
    render(null, root);
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
    expect([...root.querySelectorAll('.rp h2')].some((e) => e.textContent?.includes('Simulate'))).toBe(false);
    closeReport();
    render(h(Root, {}), root);
    expect(root.querySelector('.report')).toBeNull();
    render(null, root);
  });
});

/**
 * A wide diagram gets a landscape page of its own (ui-followups 6.4). The
 * choice is made from the drawing's viewBox; the page itself is report.css's
 * named `@page diagram`, which only a stylesheet read can see.
 */
describe('the diagram page', () => {
  it('turns the page for four data centres in a row, not for three', () => {
    /* classic: three columns, 1066 x 224 -- 64 % on portrait, kept there. */
    expect(printScale(1066, 224, A4_PORTRAIT_ROOM)).toBeGreaterThan(0.6);
    expect(diagramLandscape(1066, 224)).toBe(false);
    /* multi-target / cascade: four columns, ~1480 wide -- 46 % -> 68 %. */
    expect(printScale(1498, 232, A4_PORTRAIT_ROOM)).toBeLessThan(0.5);
    expect(printScale(1498, 232, A4_LANDSCAPE_ROOM)).toBeGreaterThan(0.65);
    expect(diagramLandscape(1498, 232)).toBe(true);
  });

  it('keeps a tall drawing portrait, where turning the page buys nothing', () => {
    expect(diagramLandscape(1200, 1400)).toBe(false);
    expect(diagramLandscape(0, 0)).toBe(false);
  });

  it('marks the section from the drawing it rendered', async () => {
    for (const [id, wide] of [['classic', false], ['multi-target-three-observers', true]] as const) {
      load(id);
      const root = document.createElement('div');
      document.body.appendChild(root);
      render(h(Report, {}), root);
      /* The class follows a measurement of the rendered viewBox: one more render. */
      await new Promise((r) => setTimeout(r, 0));
      expect(root.querySelector('.rp-diagram')?.classList.contains('is-landscape'), id).toBe(wide);
      expect(root.querySelector('.rp-diagram .rp-screen') !== null, id).toBe(wide);
      render(null, root);
    }
  });

  it('prints it on a named landscape page, the screen note left off paper', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/report.css'), 'utf8',
    );
    expect(css).toContain('@page diagram{size:A4 landscape;');
    expect(css).toMatch(/\.rp-diagram\.is-landscape\{page:diagram;/);
    expect(css).toMatch(/@media print\{[\s\S]*\.rp-screen\{display:none\}/);
  });
});
