/**
 * The share link, end to end: what `Share` / the permalink hand out is what a
 * cold load reads back -- the query through `parseUrlQuery`, the fragment
 * through `decodeFragment` -- for every preset, with a drag override, an
 * injected event and a view state riding along.
 *
 * Then the other half of the same contract: while the Document is still the
 * preset it came from, `?preset=` is the whole address and there is no
 * fragment at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { classic, PRESETS } from '@/presets';
import { classicDoc, doc, makeDoc, withEvent, withLayout, withParams } from '@/state/doc';
import { resetHistory, edit, undo } from '@/state/history';
import { decodeFragment, encodeDoc } from '@/state/codec';
import { buildShareUrl, parseUrlQuery, presetId } from '@/state/url';
import { edition, mode, panelTab, selection, tNow } from '@/state/view';
import { hostId } from '@/engine';

describe('share link round trip', () => {
  for (const p of PRESETS) {
    it(`preset ${p.id}: the URL the page hands out reloads to the same document`, async () => {
      let d = makeDoc(p.doc());
      const first = d.topology.members[0];
      const host = d.topology.hosts[0];
      if (first) d = withLayout(d, first.id as string, { dx: 40, dy: -8 });
      if (host) d = withEvent(d, { at: 7, kind: 'host.down', host: hostId(host.id as string) });
      doc.value = d;
      presetId.value = p.id;
      mode.value = 'break';
      panelTab.value = 'commit';
      selection.value = first ? [first.id as string] : [];
      tNow.value = 12.5;
      edition.value = '26ai';

      const { url, tooLarge } = await buildShareUrl();
      expect(tooLarge).toBe(false);
      expect(url.length).toBeLessThan(8000);

      const q = url.indexOf('?'); const h = url.indexOf('#');
      const query = url.slice(q, h);
      const fragment = url.slice(h);
      const { state, unknown } = parseUrlQuery(query);
      expect(unknown).toEqual([]);
      expect(state.mode).toBe('break');
      expect(state.panel).toBe('commit');
      expect(state.t).toBe(12.5);
      expect(state.preset).toBe(p.id);
      expect(state.ed).toBe('26ai');
      expect(state.sel).toEqual(first ? [first.id as string] : []);

      const back = await decodeFragment(fragment);
      expect(back?.doc).toBeTruthy();
      const got = back!.doc!;
      expect(got.topology.members.map((m) => m.id)).toEqual(d.topology.members.map((m) => m.id));
      expect(got.topology.observers.map((o) => o.id)).toEqual(d.topology.observers.map((o) => o.id));
      expect(got.topology.links.map((l) => [l.id, l.rttMs, l.up]))
        .toEqual(d.topology.links.map((l) => [l.id, l.rttMs, l.up]));
      expect(got.topology.config).toEqual(d.topology.config);
      expect(got.topology.events).toEqual(d.topology.events);
      expect(got.layout).toEqual(d.layout);
      expect(got.params).toEqual(d.params);
      expect(got.meta).toEqual(d.meta);
    });
  }
});

describe('an untouched preset is its own address', () => {
  /** The `?query#fragment` the page would put in the address bar. */
  const tail = async (): Promise<{ tail: string; tooLarge: boolean }> => {
    const { url, tooLarge } = await buildShareUrl();
    const cut = url.search(/[?#]/);
    return { tail: cut < 0 ? '' : url.slice(cut), tooLarge };
  };

  beforeEach(() => {
    resetHistory(makeDoc(classic.doc()));
    presetId.value = 'classic';
    mode.value = 'build';
    panelTab.value = 'dgmgrl';
    selection.value = [];
    tNow.value = 0;
    edition.value = '19c';
  });

  for (const p of PRESETS) {
    it(`preset ${p.id}: names the preset and writes no fragment`, async () => {
      resetHistory(makeDoc(p.doc()));
      presetId.value = p.id;
      expect(await tail()).toEqual({ tail: `?preset=${p.id}`, tooLarge: false });
    });
  }

  it('keeps the view keys, and only drops the fragment', async () => {
    mode.value = 'break';
    selection.value = ['prm01'];
    const { state } = parseUrlQuery((await tail()).tail);
    expect(state.mode).toBe('break');
    expect(state.sel).toEqual(['prm01']);
    expect(state.preset).toBe('classic');
    expect((await tail()).tail).not.toContain('#');
  });

  it('brings the fragment back on a layout drag, and keeps the provenance', async () => {
    edit('Move a card', (d) => withLayout(d, 'prm01', { dx: 40, dy: -8 }));
    const { tail: t } = await tail();
    expect(t).toContain('#t');
    expect(t).toContain('preset=classic');
    const back = await decodeFragment(t.slice(t.indexOf('#')));
    expect(back?.doc?.layout).toEqual({ prm01: { dx: 40, dy: -8 } });
  });

  it('brings the fragment back on an injected event', async () => {
    edit('Break a host', (d) => withEvent(d, { at: 42, kind: 'host.down', host: hostId('dc2-sby01') }));
    expect((await tail()).tail).toContain('#t');
  });

  it('brings the fragment back on a simulation parameter', async () => {
    edit('Change the commit wait policy', (d) => withParams(d, { commitWaitPolicy: 'first-ack' }));
    expect((await tail()).tail).toContain('#t');
  });

  it('drops the fragment again when undo puts the preset back', async () => {
    edit('Move a card', (d) => withLayout(d, 'prm01', { dx: 40, dy: -8 }));
    expect((await tail()).tail).toContain('#t');
    undo();
    expect(await tail()).toEqual({ tail: '?preset=classic', tooLarge: false });
  });

  it('drops the fragment again when undo puts a Reset back, provenance and all', async () => {
    /* Reset changes the Document and where it came from in one gesture: the
       bytes through `edit()`, the id beside it. Undo has to give both back --
       restoring only the bytes leaves the address bar carrying a full `#t=`
       for a document that is, value for value, the preset it names. */
    edit('Reset to the classic configuration', () => classicDoc(edition.value));
    presetId.value = null;
    expect((await tail()).tail).toContain('#t');
    undo();
    expect(presetId.value).toBe('classic');
    expect(await tail()).toEqual({ tail: '?preset=classic', tooLarge: false });
  });

  it('is a comparison by value, not a dirty flag', async () => {
    /* Edited away and back by hand: the same Document, a different object. */
    edit('Move a card', (d) => withLayout(d, 'prm01', { dx: 40, dy: -8 }));
    edit('Move it back', (d) => withLayout(d, 'prm01', null));
    expect(await tail()).toEqual({ tail: '?preset=classic', tooLarge: false });
  });

  it('collapses a link carrying the preset’s own document back to ?preset=', async () => {
    /* An older link, or one written before this rule: the document arrives
       through the codec and the migration chain rather than from `doc()`, and
       it still has to compare equal, or the address would never shorten. */
    const encoded = await encodeDoc(makeDoc(classic.doc()));
    const back = await decodeFragment(`#${encoded.fragment}`);
    expect(back?.doc).toBeTruthy();
    resetHistory(back!.doc!);
    presetId.value = 'classic';
    expect(await tail()).toEqual({ tail: '?preset=classic', tooLarge: false });
  });

  it('writes the fragment when the Document names no preset', async () => {
    presetId.value = null;
    expect((await tail()).tail).toContain('#t');
  });

  it('writes the fragment when the named preset is not one this build carries', async () => {
    presetId.value = 'from-the-future';
    const { tail: t } = await tail();
    expect(t).toContain('preset=from-the-future');
    expect(t).toContain('#t');
  });
});
