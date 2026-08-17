/**
 * @vitest-environment jsdom
 *
 * The prose is markup, so it has to survive being rendered: every step, every
 * table and both figures, into a real document. This is also where the CSP
 * rules are enforced -- a `style` attribute or an inline handler anywhere in
 * the content would break the published page's Content-Security-Policy, and
 * neither can be spotted by reading the tree.
 */

import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { LESSONS } from '@/content/lessons';
import { RefTable, REF_TABLES } from '@/content/reference';
import { Footnotes } from '@/content/footnotes';
import { CommitNestingFigure } from '@/content/figures/CommitNestingFigure';
import { NetTimeoutFigure } from '@/content/figures/NetTimeoutFigure';

function html(node: preact.ComponentChild): string {
  const host = document.createElement('div');
  render(node as never, host);
  const out = host.innerHTML;
  render(null, host);
  return out;
}

describe('content renders', () => {
  it('renders every lesson step', () => {
    for (const l of LESSONS) {
      for (const s of l.steps) {
        const out = html(s.prose);
        expect(out.length, `${l.id}/${s.title}`).toBeGreaterThan(20);
      }
    }
  });

  it('renders every reference table with one header row', () => {
    for (const t of REF_TABLES) {
      const out = html(h(RefTable, { data: t }));
      expect(out).toContain('<table');
      expect((out.match(/<th /g) ?? []).length).toBe(t.columns.length);
      expect((out.match(/<tr>/g) ?? []).length).toBe(t.rows.length + 1);
    }
  });

  it('renders the footnotes and both figures', () => {
    expect(html(h(Footnotes, {}))).toContain('DBMS_DG.INITIATE_FS_FAILOVER');
    expect(html(h(CommitNestingFigure, {}))).toContain('log file sync');
    const net = html(h(NetTimeoutFigure, {}));
    expect(net).toContain('NET_TIMEOUT');
    expect(net).toContain('FastStartFailoverThreshold');
  });

  it('emits no inline style and no inline event handler', () => {
    const everything = [
      ...LESSONS.flatMap((l) => l.steps.map((s) => html(s.prose))),
      ...REF_TABLES.map((t) => html(h(RefTable, { data: t }))),
      html(h(Footnotes, {})),
      html(h(CommitNestingFigure, {})),
      html(h(NetTimeoutFigure, {})),
    ].join('\n');
    expect(/\sstyle="/.test(everything)).toBe(false);
    expect(/\son[a-z]+="/.test(everything)).toBe(false);
    /* Zero external requests: no <img>, no <iframe>, no @import, no url(). */
    expect(/<img|<iframe|<script/.test(everything)).toBe(false);
  });

  it('keeps every external link an anchor to docs, opened safely', () => {
    const out = LESSONS.flatMap((l) => l.steps.map((s) => html(s.prose))).join('\n')
      + REF_TABLES.map((t) => html(h(RefTable, { data: t }))).join('\n');
    const hosts = [...out.matchAll(/href="https?:\/\/([^/"]+)/g)].map((m) => m[1]);
    expect(hosts.length).toBeGreaterThan(10);
    for (const h of hosts) {
      expect(['docs.oracle.com', 'www.ludovicocaldara.net']).toContain(h);
    }
    expect(out).not.toContain('rel="noreferrer" target');
    expect((out.match(/target="_blank"/g) ?? []).length)
      .toBe((out.match(/rel="noreferrer"/g) ?? []).length);
  });
});
