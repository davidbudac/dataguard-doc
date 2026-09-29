/**
 * The query vocabulary is a public contract: keys parse, clamp, serialize and
 * round trip, and anything the page does not know is ignored, then dropped.
 */

import { describe, expect, it } from 'vitest';
import {
  clampStep, clampT, isPristinePreset, parseUrlQuery, serializeUrlQuery, splitQuery, stableJson,
  URL_DEFAULTS, URL_FIELDS,
} from '@/state/url';
import { makeDoc, withMeta } from '@/state/doc';
import { classic, PRESETS } from '@/presets';

describe('url table', () => {
  it('has one entry per key, and no duplicates', () => {
    const keys = URL_FIELDS.map((f) => f.k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'ed', 'mode', 'intro', 'report', 'panel', 'sel', 't', 'preset', 'lesson', 'step', 'theme',
    ]);
  });

  it('parses every key', () => {
    const { state, unknown } = parseUrlQuery(
      '?ed=26ai&mode=break&intro=1&report=1&panel=commit&sel=prm01,sby01&t=12.5&preset=classic'
      + '&lesson=clocks&step=3&theme=dark',
    );
    expect(unknown).toEqual([]);
    expect(state).toEqual({
      ed: '26ai', mode: 'break', intro: true, report: true, panel: 'commit', sel: ['prm01', 'sby01'], t: 12.5,
      preset: 'classic', lesson: 'clocks', step: 3, theme: 'dark',
    });
  });

  it('serializes non-defaults only, in table order', () => {
    expect(serializeUrlQuery(URL_DEFAULTS)).toBe('');
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'configure', ed: '26ai' }))
      .toBe('ed=26ai&mode=config');
  });

  it('writes the words on the buttons and reads both spellings', () => {
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'break' })).toBe('mode=simulate');
    expect(serializeUrlQuery({ ...URL_DEFAULTS, mode: 'configure' })).toBe('mode=config');
    for (const [raw, id] of [
      ['simulate', 'break'], ['break', 'break'], ['config', 'configure'], ['configure', 'configure'],
    ] as const) {
      expect(parseUrlQuery(`?mode=${raw}`).state.mode).toBe(id);
    }
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
    expect(serializeUrlQuery(state)).toBe('mode=simulate');
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

describe('the document the preset key stands for', () => {
  it('serializes objects by key order and arrays by position', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
    expect(stableJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableJson({ a: null, b: [1, { y: 1, x: 2 }] })).toBe('{"a":null,"b":[1,{"x":2,"y":1}]}');
  });

  for (const p of PRESETS) {
    it(`${p.id}: a fresh copy of it matches the preset it names`, () => {
      expect(isPristinePreset(makeDoc(p.doc()), p.id)).toBe(true);
    });
  }

  it('is false for another preset, for no preset and for an id this build has not got', () => {
    const d = makeDoc(classic.doc());
    expect(isPristinePreset(d, 'far-sync-zero-loss')).toBe(false);
    expect(isPristinePreset(d, null)).toBe(false);
    expect(isPristinePreset(d, 'from-the-future')).toBe(false);
  });

  it('counts everything the Document carries, down to a renamed configuration', () => {
    expect(isPristinePreset(withMeta(makeDoc(classic.doc()), { name: 'Mine' }), 'classic')).toBe(false);
    expect(isPristinePreset(withMeta(makeDoc(classic.doc()), { notes: 'why' }), 'classic')).toBe(false);
  });
});
