import { describe, expect, it } from 'vitest';
import { formatRedoRoutes, parseRedoRoutes, parseRedoRoutesOrThrow } from '../redo/parse';
import { memberId } from '../ids';

const roundTrip = (text: string): string => formatRedoRoutes(parseRedoRoutesOrThrow(text));

describe('RedoRoutes: the documented spellings round-trip', () => {
  it('the canonical far sync pair', () => {
    /* EDIT DATABASE 'North_Sales' SET PROPERTY 'RedoRoutes' = '(LOCAL : FS1 SYNC)';
       EDIT FAR_SYNC 'FS1' SET PROPERTY 'RedoRoutes' = '(North_Sales : South_Sales ASYNC)'; */
    expect(roundTrip('(LOCAL : FS1 SYNC)')).toBe('(LOCAL : FS1 SYNC)');
    expect(roundTrip('(North_Sales : South_Sales ASYNC)')).toBe('(North_Sales : South_Sales ASYNC)');
  });

  it('the cascade pair from broker Example 4-2', () => {
    expect(roundTrip('(LOCAL : Local_Sales SYNC)')).toBe('(LOCAL : Local_Sales SYNC)');
    expect(roundTrip('(North_Sales : Remote_Sales ASYNC)')).toBe('(North_Sales : Remote_Sales ASYNC)');
  });

  it('PRIORITY groups', () => {
    const text = '(LOCAL : (Local_Sales1 SYNC, Local_Sales2 SYNC PRIORITY=1), (Remote_Sales ASYNC PRIORITY=2))';
    expect(roundTrip(text)).toBe(text);
  });

  it('the 12.1 ALT form, with and without FALLBACK', () => {
    expect(roundTrip('(LOCAL : Boston SYNC ALT=(Chicago ASYNC FALLBACK))'))
      .toBe('(LOCAL : Boston SYNC ALT=(Chicago ASYNC FALLBACK))');
    expect(roundTrip('(LOCAL : Boston SYNC ALT=(Chicago))'))
      .toBe('(LOCAL : Boston SYNC ALT=(Chicago))');
  });

  it('ALL, ANY and a multi-name source', () => {
    expect(roundTrip('(LOCAL : ALL)')).toBe('(LOCAL : ALL)');
    expect(roundTrip('(ANY : ALL ASYNC)')).toBe('(ANY : ALL ASYNC)');
    expect(roundTrip('(North_Sales, South_Sales : Remote_Sales ASYNC)'))
      .toBe('(North_Sales, South_Sales : Remote_Sales ASYNC)');
  });

  it('several rules on one member stay adjacent, the way DGMGRL spells them', () => {
    const text = '(LOCAL : FS1 SYNC)(South_Sales : North_Sales ASYNC)';
    expect(roundTrip(text)).toBe(text);
  });
});

describe('RedoRoutes: structure', () => {
  it('a source is LOCAL, ANY or a list of member names', () => {
    expect(parseRedoRoutesOrThrow('(LOCAL : ALL)')[0]?.source).toBe('LOCAL');
    expect(parseRedoRoutesOrThrow('(ANY : ALL)')[0]?.source).toBe('ANY');
    expect(parseRedoRoutesOrThrow('(a, b : ALL)')[0]?.source)
      .toEqual([memberId('a'), memberId('b')]);
  });

  it('an unspecified attribute stays unspecified: it falls back to LogXptMode later', () => {
    const dest = parseRedoRoutesOrThrow('(LOCAL : sby01)')[0]?.groups[0]?.dests[0];
    expect(dest?.target).toBe('sby01');
    expect(dest?.xpt).toBeUndefined();
  });

  it('a parenthesised group keeps its priority and its member list', () => {
    const rule = parseRedoRoutesOrThrow('(LOCAL : (a, b PRIORITY=3))')[0];
    expect(rule?.groups).toHaveLength(1);
    expect(rule?.groups[0]?.priority).toBe(3);
    expect(rule?.groups[0]?.dests.map((d) => d.target)).toEqual(['a', 'b']);
  });

  it('a bare destination carrying a priority becomes a group of its own', () => {
    const rule = parseRedoRoutesOrThrow('(LOCAL : a PRIORITY=1, b PRIORITY=2)')[0];
    expect(rule?.groups.map((g) => g.priority)).toEqual([1, 2]);
  });

  it('quoted names are accepted and stored unquoted', () => {
    expect(parseRedoRoutesOrThrow("(LOCAL : 'North Sales')")[0]?.groups[0]?.dests[0]?.target)
      .toBe('North Sales');
  });

  it('ALL is recognised case-insensitively and normalised', () => {
    expect(parseRedoRoutesOrThrow('(local : all sync)')[0]?.groups[0]?.dests[0]?.target).toBe('ALL');
  });
});

describe('RedoRoutes: rejections', () => {
  it('PRIORITY outside 1..8 is an error', () => {
    const r = parseRedoRoutes('(LOCAL : (a PRIORITY=9))');
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toMatch(/1\.\.8/);
  });

  it('an unbalanced rule is an error, not a silent empty list', () => {
    expect(parseRedoRoutes('(LOCAL : a').ok).toBe(false);
    expect(parseRedoRoutes('LOCAL : a)').ok).toBe(false);
  });

  it('GROUP is not RedoRoutes syntax: it parses as a destination name, never as a keyword', () => {
    const rule = parseRedoRoutesOrThrow('(LOCAL : GROUP)')[0];
    expect(rule?.groups[0]?.dests[0]?.target).toBe('GROUP');
    expect(formatRedoRoutes([rule!])).toBe('(LOCAL : GROUP)');
  });

  it('an empty property is an empty rule list, which is the NULL default', () => {
    const r = parseRedoRoutes('');
    expect(r.ok).toBe(true);
    expect(r.rules).toEqual([]);
  });
});

describe('RedoRoutes: dialects', () => {
  const rules = parseRedoRoutesOrThrow('(LOCAL : (a, b PRIORITY=1), (c PRIORITY=2))');

  it('the PRIORITY dialect parenthesises every group', () => {
    expect(formatRedoRoutes(rules, { dialect: 'priority' }))
      .toBe('(LOCAL : (a, b PRIORITY=1), (c PRIORITY=2))');
  });

  it('the 12.1 dialect drops the group parentheses, since 12.1 has no PRIORITY', () => {
    expect(formatRedoRoutes(rules, { dialect: '12.1' })).toBe('(LOCAL : a, b, c)');
  });
});
