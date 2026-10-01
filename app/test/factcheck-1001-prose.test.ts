/**
 * Regression tests for the prose, label and lesson findings of
 * SIMULATOR_FACT_CHECK_2026-10-01.md (section E and SIM-25), one `describe`
 * per finding id where a test says something. A pure wording fix with no
 * behaviour behind it has no test here; the commit that made it says so.
 */

import { describe, expect, it } from 'vitest';
import { parseTopologyDoc, simulate } from '@/engine';
import type { TopologyDoc } from '@/engine';
import { LESSONS } from '@/content';
import { stepTopology } from '@/ui/learn/apply';
import { findPreset, PRESETS } from '@/presets';

/** Every id a document defines, by the namespace an event or a route names it in. */
function namesOf(doc: TopologyDoc) {
  return {
    host: new Set(doc.hosts.map((h) => h.id as string)),
    site: new Set(doc.sites.map((s) => s.id as string)),
    link: new Set(doc.links.map((l) => l.id as string)),
    member: new Set(doc.members.map((m) => m.id as string)),
    observer: new Set(doc.observers.map((o) => o.id as string)),
  };
}

/** The ids a step's events and routes name that its document does not have. */
function unknownIds(doc: TopologyDoc): string[] {
  const names = namesOf(doc);
  const out: string[] = [];
  const need = (ns: keyof typeof names, id: unknown, where: string): void => {
    if (typeof id === 'string' && !names[ns].has(id)) out.push(`${where}: ${ns} "${id}"`);
  };
  for (const e of doc.events) {
    const at = `${e.kind}@${e.at}`;
    if ('host' in e) need('host', e.host, at);
    if ('site' in e) need('site', e.site, at);
    if ('link' in e) need('link', e.link, at);
    if ('member' in e) need('member', e.member, at);
    if ('observer' in e) need('observer', e.observer, at);
    if ('to' in e) need('member', e.to, at);
    if (e.kind === 'partition') for (const g of e.groups) for (const h of g) need('host', h, at);
  }
  for (const m of doc.members) {
    for (const rule of m.redoRoutes) {
      if (rule.source !== 'LOCAL') for (const s of rule.source) need('member', s, `${m.id} redoRoutes source`);
      for (const g of rule.groups) for (const d of g.dests) need('member', d.target, `${m.id} redoRoutes target`);
    }
  }
  return out;
}

describe('TXT-50 / TXT-51: a lesson step names only what its preset has', () => {
  for (const lesson of LESSONS) {
    lesson.steps.forEach((step, i) => {
      it(`${lesson.id}/${i} "${step.title}"`, () => {
        const doc = stepTopology(lesson, i);
        expect(doc).not.toBeNull();
        if (doc === null) return;
        expect(unknownIds(doc)).toEqual([]);
      });
    });
  }

  it('the walk itself catches an unknown member id', () => {
    const doc = stepTopology(LESSONS[0]!, 0) as TopologyDoc;
    const bad = { ...doc, events: [{ at: 0, kind: 'member.down', member: 'nope' }] } as unknown as TopologyDoc;
    expect(unknownIds(bad)).toEqual(['member.down@0: member "nope"']);
  });
});

describe('SIM-25: a member with RedoRoutes and no rule for the new primary is labelled as this page\'s reading', () => {
  it('cascade-terminal: the new primary ships nothing, and the finding says that is a model', () => {
    const p = findPreset('cascade-terminal')!;
    const t = simulate(p.doc(), p.events());
    const f = t.findings.filter((x) => x.id === 'ROUTES.NO_RULE_FOR_NEW_PRIMARY');
    expect(f.map((x) => x.subject.id)).toEqual(['Local_Sales']);
    expect(f[0]?.basis).toBe('model');
    expect(f[0]?.note).toMatch(/not documented/);
  });

  it('no other preset raises it: it is not a noise finding', () => {
    for (const p of PRESETS) {
      if (p.id === 'cascade-terminal') continue;
      const t = simulate(p.doc(), p.events());
      expect(t.findings.map((x) => x.id), p.id).not.toContain('ROUTES.NO_RULE_FOR_NEW_PRIMARY');
    }
  });
});
