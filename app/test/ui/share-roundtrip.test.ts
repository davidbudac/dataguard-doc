/**
 * The share link, end to end: what `Share` / the permalink hand out is what a
 * cold load reads back -- the query through `parseUrlQuery`, the fragment
 * through `decodeFragment` -- for every preset, with a drag override, an
 * injected event and a view state riding along.
 */

import { describe, expect, it } from 'vitest';
import { PRESETS } from '@/presets';
import { doc, makeDoc, withEvent, withLayout } from '@/state/doc';
import { decodeFragment } from '@/state/codec';
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
