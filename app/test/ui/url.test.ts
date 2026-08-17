/**
 * The query vocabulary is a public contract: keys parse, clamp, serialize and
 * round trip, and anything the page does not know is ignored, then dropped.
 */

import { describe, expect, it } from 'vitest';
import {
  clampStep, clampT, parseUrlQuery, serializeUrlQuery, splitQuery, URL_DEFAULTS, URL_FIELDS,
} from '@/state/url';

describe('url table', () => {
  it('has one entry per key, and no duplicates', () => {
    const keys = URL_FIELDS.map((f) => f.k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['ed', 'mode', 'panel', 'sel', 't', 'preset', 'lesson', 'step', 'theme']);
  });

  it('parses every key', () => {
    const { state, unknown } = parseUrlQuery(
      '?ed=26ai&mode=break&panel=commit&sel=prm01,sby01&t=12.5&preset=classic&lesson=clocks&step=3&theme=dark',
    );
    expect(unknown).toEqual([]);
    expect(state).toEqual({
      ed: '26ai', mode: 'break', panel: 'commit', sel: ['prm01', 'sby01'], t: 12.5,
      preset: 'classic', lesson: 'clocks', step: 3, theme: 'dark',
    });
  });

  it('serializes non-defaults only, in table order', () => {
    expect(serializeUrlQuery(URL_DEFAULTS)).toBe('');
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'configure', ed: '26ai' }))
      .toBe('ed=26ai&mode=configure');
  });

  it('round trips', () => {
    const state = {
      ...URL_DEFAULTS, ed: '26ai' as const, mode: 'learn' as const, sel: ['sby01'],
      t: 4.2, lesson: 'sync-transport', step: 2, theme: 'light' as const,
    };
    expect(parseUrlQuery(`?${serializeUrlQuery(state)}`).state).toEqual(state);
  });

  it('ignores values outside the vocabulary rather than guessing', () => {
    const { state } = parseUrlQuery('?mode=teleport&panel=nowhere&ed=12c&theme=neon');
    expect(state.mode).toBe(URL_DEFAULTS.mode);
    expect(state.panel).toBe(URL_DEFAULTS.panel);
    expect(state.ed).toBe(URL_DEFAULTS.ed);
    expect(state.theme).toBe(URL_DEFAULTS.theme);
  });

  it('reports keys it does not know, and drops them from the link', () => {
    const { state, unknown } = parseUrlQuery('?mode=break&utm_source=wiki&zoom=3');
    expect(unknown).toEqual(['utm_source', 'zoom']);
    expect(serializeUrlQuery(state)).toBe('mode=break');
  });

  it('clamps the playhead and the lesson step', () => {
    expect(clampT(99999)).toBe(3600);
    expect(clampT(-9999)).toBe(-60);
    expect(clampT(1.2345)).toBe(1.2);
    expect(clampStep(-4)).toBe(0);
    expect(clampStep(9999)).toBe(99);
    expect(parseUrlQuery('?t=abc').state.t).toBe(URL_DEFAULTS.t);
    expect(parseUrlQuery('?t=1e9').state.t).toBe(3600);
  });

  it('filters a selection to real identifiers and caps its length', () => {
    const { state } = parseUrlQuery(`?sel=${['a<script>', 'prm01', ...Array.from({ length: 40 }, (_, i) => `m${i}`)].join(',')}`);
    expect(state.sel).not.toContain('a<script>');
    expect(state.sel[0]).toBe('prm01');
    expect(state.sel.length).toBe(20);
  });

  it('splits a query without a host global', () => {
    expect(splitQuery('?a=1&b=two+words&c&=x')).toEqual([['a', '1'], ['b', 'two words'], ['c', '']]);
  });
});
