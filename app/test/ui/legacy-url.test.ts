/**
 * Links the handover document hands out keep working.
 *
 * The published page's share links are `?sc=...&lat=...#ch-...`; the six
 * chapter anchors name places this application still has, and the knob
 * vocabulary is the engine's to read.
 */

import { describe, expect, it } from 'vitest';
import { isLegacyUrl, LEGACY_ANCHORS, upgradeLegacyUrl } from '@/state/legacy-url';

describe('legacy urls', () => {
  it('recognises a published-page link', () => {
    expect(isLegacyUrl('?sc=iso&lat=2', '#ch-clocks')).toBe(true);
    expect(isLegacyUrl('', '#ch-reference')).toBe(true);
    expect(isLegacyUrl('?mode=break', '#t=abc')).toBe(false);
    expect(isLegacyUrl('', '')).toBe(false);
  });

  it('maps the handover link ?sc=iso&lat=2#ch-clocks', () => {
    const up = upgradeLegacyUrl('?sc=iso&lat=2', '#ch-clocks');
    expect(up).not.toBeNull();
    expect(up?.view.mode).toBe('break');
    /* The isolated-primary scenario cuts every link out of the primary site. */
    expect(up?.topology.events.map((e) => e.kind)).toEqual(['link.cut', 'link.cut']);
    expect(up?.topology.links.every((l) => l.rttMs === 2)).toBe(true);
  });

  it('maps all six chapter anchors onto a mode', () => {
    for (const anchor of Object.keys(LEGACY_ANCHORS)) {
      const up = upgradeLegacyUrl('', `#${anchor}`);
      expect(up?.view.mode).toBe(LEGACY_ANCHORS[anchor]?.mode);
    }
    expect(upgradeLegacyUrl('', '#ch-transport')?.view.panel).toBe('commit');
    expect(upgradeLegacyUrl('', '#ch-app')?.view.panel).toBe('app');
    expect(upgradeLegacyUrl('', '#ch-config')?.view.panel).toBe('dgmgrl');
    expect(upgradeLegacyUrl('', '#ch-side')?.view.lesson).toBe('sync-transport');
    expect(upgradeLegacyUrl('', '#ch-reference')?.view.lesson).toBe('reference');
  });

  it('carries the knobs through the engine, clamped', () => {
    const up = upgradeLegacyUrl('?pm=perf&th=99999&lag=45&ol=dc1&sd=0');
    expect(up?.topology.config.protectionMode).toBe('MAXPERFORMANCE');
    /* FastStartFailoverThreshold tops out at this page's 3600 s ceiling. */
    expect(up?.topology.config.fsfo.thresholdSeconds).toBe(3600);
    expect(up?.topology.config.fsfo.pmyShutdown).toBe(false);
    expect(up?.topology.observers[0]?.host).toBe('dc1-obs01');
  });

  it('reads the release out of ?ver=', () => {
    expect(upgradeLegacyUrl('?ver=26ai&sc=crash')?.view.ed).toBe('26ai');
    expect(upgradeLegacyUrl('?ver=nonsense&sc=crash')?.view.ed).toBeUndefined();
  });

  it('ignores the language key an older link carries', () => {
    const up = upgradeLegacyUrl('?lang=cs&sc=crash', '#ch-clocks');
    expect(up?.dropped).toEqual([]);
    expect(up?.notice).toBe('Upgraded an older link.');
  });

  it('names the parameters it dropped', () => {
    const up = upgradeLegacyUrl('?sc=crash&utm_campaign=wiki');
    expect(up?.dropped).toEqual(['utm_campaign']);
    expect(up?.notice).toContain('utm_campaign');
  });

  it('returns null for a URL the published page never wrote', () => {
    expect(upgradeLegacyUrl('?mode=build')).toBeNull();
  });
});
