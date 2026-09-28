import { describe, expect, it } from 'vitest';
import { memberId } from '../src/engine/ids';
import { authoredDests, carryGroupChoice, disableAt, retryLimit } from '../src/engine/sim/dests';
import { preset } from '../src/presets';
import type { RedoGraph } from '../src/engine/types/trace';

const props = (maxFailure: number) => ({ netTimeoutSeconds: 30, reopenSeconds: 300, maxFailure });

describe('MaxFailure counting, per edition', () => {
  it('19c counts attempts to reestablish, so the initial error is not one of them', () => {
    expect(retryLimit(props(1), '19c')).toBe(1);
    expect(disableAt(0, props(1), '19c')).toBe(300);
    expect(disableAt(0, props(3), '19c')).toBe(900);
  });

  it('26ai counts the initial failure: 1 is no retry, 2 is one retry', () => {
    /* "If MAX_FAILURE is set to 1, no attempts are made to reactivate this
       archive destination when it fails." */
    expect(retryLimit(props(1), '26ai')).toBe(0);
    expect(disableAt(0, props(1), '26ai')).toBe(0);
    expect(disableAt(0, props(2), '26ai')).toBe(300);
  });

  it('0 is unlimited in both', () => {
    expect(retryLimit(props(0), '19c')).toBeNull();
    expect(retryLimit(props(0), '26ai')).toBeNull();
    expect(disableAt(0, props(0), '26ai')).toBeNull();
  });
});

describe('authored destinations', () => {
  it('a destination in a parenthesised group with no properties of its own has MaxFailure 1', () => {
    const doc = preset('far-sync-zero-loss').doc();
    const south = authoredDests(doc, memberId('North_Sales'))
      .find((d) => d.from === memberId('North_Sales') && d.to === memberId('South_Sales'));
    expect(south?.inPriorityGroup).toBe(true);
    expect(south?.props.maxFailure).toBe(1);
    expect(south?.retryLimit).toBe(1);
  });

  it('carries the edition, so the disabled finding can speak it', () => {
    const doc = preset('far-sync-zero-loss').doc();
    doc.config.edition = '26ai';
    expect(authoredDests(doc, memberId('North_Sales')).every((d) => d.edition === '26ai')).toBe(true);
  });
});

describe('the choice inside a group, across epochs', () => {
  it('a group that chose overrides; one that could not keeps what it had', () => {
    const g = { groupChoice: { 'a|0|0': memberId('FS2') } } as unknown as RedoGraph;
    expect(carryGroupChoice({ 'a|0|0': memberId('FS1'), 'b|0|0': memberId('x') }, g))
      .toEqual({ 'a|0|0': memberId('FS2'), 'b|0|0': memberId('x') });
  });
});
