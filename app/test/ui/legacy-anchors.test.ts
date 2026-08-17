/**
 * The six chapter anchors resolve to places that exist.
 *
 * `state/legacy-url.ts` maps `#ch-clocks` and its five siblings onto a mode, a
 * Configure tab or a lesson. A mapping that named a lesson this build does not
 * carry, or a tab the shell does not have, would send every link in the
 * handover document and the wiki page to an empty room -- so the mapping is
 * checked against the actual lesson list and the actual tab vocabulary, not
 * against a copy of them.
 */

import { describe, expect, it } from 'vitest';
import { LESSONS, lessonById } from '@/content';
import { LEGACY_ANCHORS, LEGACY_PATH, upgradeLegacyUrl } from '@/state/legacy-url';
import { MODES, PANEL_TABS } from '@/state/view';

describe('legacy chapter anchors', () => {
  it('covers the six chapters the published document has', () => {
    expect(Object.keys(LEGACY_ANCHORS).sort()).toEqual([
      'ch-app', 'ch-clocks', 'ch-config', 'ch-reference', 'ch-side', 'ch-transport',
    ]);
  });

  it('names a real mode, a real tab and a real lesson', () => {
    for (const [anchor, target] of Object.entries(LEGACY_ANCHORS)) {
      expect(MODES, anchor).toContain(target.mode);
      if (target.panel !== undefined) expect(PANEL_TABS, anchor).toContain(target.panel);
      if (target.lesson !== undefined) {
        expect(lessonById(target.lesson), anchor).toBeDefined();
        expect(LESSONS.map((l) => l.id), anchor).toContain(target.lesson);
      }
      /* A lesson target only makes sense in Learn, and a tab only in Configure. */
      if (target.lesson !== undefined) expect(target.mode, anchor).toBe('learn');
      if (target.panel !== undefined) expect(target.mode, anchor).toBe('configure');
    }
  });

  it('lands every anchor somewhere, through the upgrade path', () => {
    for (const anchor of Object.keys(LEGACY_ANCHORS)) {
      const up = upgradeLegacyUrl('', `#${anchor}`);
      expect(up, anchor).not.toBeNull();
      expect(up?.view.mode, anchor).toBe(LEGACY_ANCHORS[anchor]?.mode);
      expect(up?.view.lesson, anchor).toBe(LEGACY_ANCHORS[anchor]?.lesson);
      expect(up?.view.panel, anchor).toBe(LEGACY_ANCHORS[anchor]?.panel);
      /* The classic 1+1+1 comes with it: a chapter link is still a document. */
      expect(up?.topology.members.length, anchor).toBeGreaterThan(1);
    }
  });

  it('sends a Czech reading to the page that has one, once, with a link', () => {
    const up = upgradeLegacyUrl('?lang=cs&sc=crash', '#ch-clocks');
    expect(up?.notice).toContain('English only');
    expect(up?.legacyHref).toBe(`${LEGACY_PATH}?lang=cs&sc=crash#ch-clocks`);
    /* Every other link keeps its language: no notice link where there is nothing
       to link to. */
    expect(upgradeLegacyUrl('?sc=crash', '#ch-clocks')?.legacyHref).toBeNull();
    expect(upgradeLegacyUrl('?lang=en&sc=crash')?.legacyHref).toBeNull();
  });
});
