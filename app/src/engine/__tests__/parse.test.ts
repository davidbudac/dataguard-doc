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

describe('RedoRoutes: Oracle Examples 1-4 (19c properties page, 26ai redo routing rules)', () => {
  /* The pages write them with spaces inside the parentheses and a lower-case
     `local`; the formatter's spelling is the only difference. */
  it('Example 1: different priorities within a group keep both priorities', () => {
    const rules = parseRedoRoutesOrThrow('(local : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ) )');
    expect(rules[0]?.groups).toHaveLength(1);
    expect(rules[0]?.groups[0]?.dests.map((d) => [d.target, d.priority]))
      .toEqual([['FS1', 1], ['SB1', 2]]);
    expect(formatRedoRoutes(rules)).toBe('(LOCAL : (FS1 PRIORITY=1, SB1 PRIORITY=2))');
    expect(roundTrip('(LOCAL : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ))'))
      .toBe('(LOCAL : (FS1 PRIORITY=1, SB1 PRIORITY=2))');
    expect(roundTrip('( PRI : SB1 )')).toBe('(PRI : SB1)');
  });

  it('Example 2: the same priorities within a group', () => {
    expect(roundTrip('(local : ( FS1 PRIORITY=1, FS2 PRIORITY=1 ) )'))
      .toBe('(LOCAL : (FS1 PRIORITY=1, FS2 PRIORITY=1))');
  });

  it('Example 3: two groups, each with its own priorities', () => {
    const text = '(local : ( FS1 PRIORITY=1, SB1 PRIORITY=2 ), ( FS2 PRIORITY=1, SB2 PRIORITY=2 ) )';
    const rules = parseRedoRoutesOrThrow(text);
    expect(rules[0]?.groups).toHaveLength(2);
    expect(rules[0]?.groups.map((g) => g.dests.map((d) => `${d.target as string}=${d.priority}`)))
      .toEqual([['FS1=1', 'SB1=2'], ['FS2=1', 'SB2=2']]);
    expect(formatRedoRoutes(rules))
      .toBe('(LOCAL : (FS1 PRIORITY=1, SB1 PRIORITY=2), (FS2 PRIORITY=1, SB2 PRIORITY=2))');
  });

  it('Example 4: PRIORITY=8, and the far sync forwarding to two standbys', () => {
    expect(roundTrip('(local : ( FS1 PRIORITY=1, SB1 PRIORITY=8, SB2 PRIORITY=8 ) )'))
      .toBe('(LOCAL : (FS1 PRIORITY=1, SB1 PRIORITY=8, SB2 PRIORITY=8))');
    expect(roundTrip('( PRI : SB1, SB2 )')).toBe('(PRI : SB1, SB2)');
  });

  it('broker Example 4-3 (19c): the PRIORITY form of a remote alternate', () => {
    const text = '(LOCAL : (Local_Sales ASYNC PRIORITY=1, Remote_Sales ASYNC PRIORITY=2))';
    expect(roundTrip('(LOCAL : ( Local_Sales ASYNC PRIORITY=1, Remote_Sales ASYNC PRIORITY=2 ))')).toBe(text);
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

  it('PRIORITY belongs to the destination it follows, not to the parenthesis', () => {
    /* ( db_unique_name_1 [xpt_mode] [PRIORITY=n] [,db_unique_name_n [xpt_mode] [PRIORITY=n]] ) */
    const rule = parseRedoRoutesOrThrow('(LOCAL : (a, b PRIORITY=3))')[0];
    expect(rule?.groups).toHaveLength(1);
    expect(rule?.groups[0]?.explicitGroup).toBe(true);
    expect(rule?.groups[0]?.dests.map((d) => [d.target, d.priority])).toEqual([['a', undefined], ['b', 3]]);
  });

  it('a bare destination carrying a priority is read as a parenthesised group of one', () => {
    const rules = parseRedoRoutesOrThrow('(LOCAL : a PRIORITY=1, b PRIORITY=2)');
    const rule = rules[0];
    expect(rule?.groups.map((g) => g.explicitGroup)).toEqual([true, true]);
    expect(rule?.groups.map((g) => g.dests[0]?.priority)).toEqual([1, 2]);
    expect(formatRedoRoutes(rules)).toBe('(LOCAL : (a PRIORITY=1), (b PRIORITY=2))');
  });

  it('unparenthesised destinations stay together and are not a parenthesised group', () => {
    const rule = parseRedoRoutesOrThrow('(LOCAL : a SYNC, b ASYNC)')[0];
    expect(rule?.groups).toHaveLength(1);
    expect(rule?.groups[0]?.explicitGroup).toBeUndefined();
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
