/**
 * The wire format: a Document survives the round trip through a share link and
 * through a file, and the 8000-character refusal is honest.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeFragment, encodeDoc, encodeDocPlain, fragmentKind, parseJsonText, toJsonText,
  URL_MAX_CHARS,
} from '@/state/codec';
import { classicDoc, withEvents, withLayout, withMeta, withParams } from '@/state/doc';
import type { Doc } from '@/state/doc';
import { base64UrlEncode, formatRedoRoutes, hostId, utf8Encode } from '@/engine';

const sample = (): Doc => {
  let d = classicDoc('26ai');
  d = withMeta(d, { name: 'Prague pair', notes: 'two data centres and a far sync' });
  d = withParams(d, { targetPolicy: 'active-target-only', commitWaitPolicy: 'first-ack' });
  d = withLayout(d, 'prm01', { dx: 23, dy: -17 });
  d = withEvents(d, [{ at: 12, kind: 'host.down', host: hostId('dc1-prm01') }]);
  return d;
};

describe('codec', () => {
  it('round trips a document through the plain fragment', async () => {
    const d = sample();
    const { fragment } = encodeDocPlain(d);
    expect(fragment.startsWith('t0=')).toBe(true);
    const back = await decodeFragment(`#${fragment}`);
    expect(back?.doc).not.toBeNull();
    expect(back?.doc?.meta).toEqual(d.meta);
    expect(back?.doc?.params).toEqual(d.params);
    /* The drag override snapped to the 8 px grid on the way in and stays there. */
    expect(back?.doc?.layout).toEqual({ prm01: { dx: 24, dy: -16 } });
    expect(back?.doc?.topology.events).toEqual(d.topology.events);
    expect(back?.doc?.topology.config.edition).toBe('26ai');
  });

  it('round trips through the compressed fragment when the host can deflate', async () => {
    const d = sample();
    const { fragment, tooLarge } = await encodeDoc(d);
    expect(tooLarge).toBe(false);
    expect(fragmentKind(`#${fragment}`)).toBe(fragment.startsWith('t=') ? 't' : 't0');
    const back = await decodeFragment(fragment);
    expect(back?.doc?.meta.name).toBe('Prague pair');
    expect(back?.doc?.topology.members.map((m) => m.id)).toEqual(
      d.topology.members.map((m) => m.id),
    );
  });

  it('is smaller compressed than plain for a real document', async () => {
    const d = sample();
    const plain = encodeDocPlain(d);
    const packed = await encodeDoc(d);
    if (packed.fragment.startsWith('t=')) {
      expect(packed.length).toBeLessThan(plain.length);
    }
  });

  it('round trips a data centre\'s own size, to the pixel, beside the snapped card offsets', async () => {
    const d = withLayout(sample(), 'dc2', { dx: -13, dy: 7, w: 257, h: 141 });
    const back = await decodeFragment(`#${encodeDocPlain(d).fragment}`);
    expect(back?.doc?.layout).toEqual({
      prm01: { dx: 24, dy: -16 },
      dc2: { dx: -13, dy: 7, w: 257, h: 141 },
    });
    expect(back?.dropped).toEqual([]);
  });

  it('reads a link written before sizes existed exactly as it did', async () => {
    /* The wire object an older page wrote: offsets only, one of them on an
       empty site's own key. */
    const wire = JSON.parse(toJsonText(classicDoc())) as Record<string, unknown>;
    wire['ui'] = { ...(wire['ui'] as object), layout: { prm01: { dx: 23, dy: -17 }, dc3: { dx: 9, dy: 0 } } };
    const back = await decodeFragment(`#t0=${base64UrlEncode(utf8Encode(JSON.stringify(wire)))}`);
    expect(back?.doc?.layout).toEqual({ prm01: { dx: 24, dy: -16 }, dc3: { dx: 8, dy: 0 } });
  });

  it('reads a link written with PRIORITY on the group as the one group it was drawn as', async () => {
    /* Before 2026-09-28 the far sync HA pair travelled as two groups, one
       active at a time. The link opens as Oracle's spelling of that drawing,
       and a second trip through the address bar leaves it as it is. */
    const wire = JSON.parse(toJsonText(classicDoc())) as Record<string, unknown>;
    const members = wire['members'] as Array<Record<string, unknown>>;
    members[0]!['redoRoutes'] = [{
      source: 'LOCAL',
      groups: [
        { priority: 1, explicitGroup: true, dests: [{ target: 'sby01', xpt: 'SYNC' }] },
        { priority: 2, explicitGroup: true, dests: [{ target: 'prm01', xpt: 'ASYNC' }] },
      ],
    }];
    const back = await decodeFragment(`#t0=${base64UrlEncode(utf8Encode(JSON.stringify(wire)))}`);
    const routes = back?.doc?.topology.members[0]?.redoRoutes ?? [];
    expect(formatRedoRoutes(routes)).toBe('(LOCAL : (sby01 SYNC PRIORITY=1, prm01 ASYNC PRIORITY=2))');
    expect(back?.issues.some((i) => i.severity === 'repaired' && i.path.includes('redoRoutes'))).toBe(true);
    const again = await decodeFragment(`#${encodeDocPlain(back!.doc!).fragment}`);
    expect(again?.doc?.topology.members[0]?.redoRoutes).toEqual(routes);
    expect(again?.issues.some((i) => i.path.includes('redoRoutes'))).toBe(false);
  });

  it('treats a size with one half missing as a plain offset, and clamps a silly one', () => {
    const wire = JSON.parse(toJsonText(classicDoc())) as Record<string, unknown>;
    wire['ui'] = {
      ...(wire['ui'] as object),
      layout: { dc1: { dx: 5, dy: 5, w: 300 }, dc2: { dx: 0, dy: 0, w: 1e9, h: -4 } },
    };
    const back = parseJsonText(JSON.stringify(wire));
    expect(back.doc?.layout).toEqual({ dc1: { dx: 8, dy: 8 }, dc2: { dx: 0, dy: 0, w: 8000, h: 16 } });
  });

  it('round trips through the file text', () => {
    const d = sample();
    const back = parseJsonText(toJsonText(d));
    expect(back.doc?.meta).toEqual(d.meta);
    expect(back.source).toBe('schema-2');
    expect(back.dropped).toEqual([]);
  });

  it('refuses a document that does not fit in a link, and says so', async () => {
    /* Incompressible on purpose: a run of one character would deflate to
       nothing and prove only that deflate works. */
    let seed = 1;
    const noise = Array.from({ length: 40000 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return String.fromCharCode(33 + (seed % 90));
    }).join('');
    const d = withMeta(classicDoc(), { name: 'huge', notes: noise });
    const { tooLarge, length } = await encodeDoc(d);
    expect(length).toBeGreaterThan(URL_MAX_CHARS);
    expect(tooLarge).toBe(true);
  });

  it('drops keys it does not know rather than keeping them', () => {
    const raw = JSON.parse(toJsonText(sample())) as Record<string, unknown>;
    (raw['ui'] as Record<string, unknown>)['zoom'] = 3;
    (raw['ui'] as Record<string, unknown>)['params'] = { horizon: 99999, nonsense: true };
    const back = parseJsonText(JSON.stringify(raw));
    expect(back.dropped).toContain('ui.zoom');
    expect(back.dropped).toContain('ui.params.nonsense');
    expect(back.doc?.params.horizon).toBe(3600);
  });

  it('reports a damaged link instead of guessing at it', async () => {
    const back = await decodeFragment('#t0=????');
    expect(back?.doc).toBeNull();
    expect(back?.issues[0]?.severity).toBe('error');
  });

  it('returns null for a fragment carrying no payload', async () => {
    expect(await decodeFragment('#ch-clocks')).toBeNull();
    expect(fragmentKind('#ch-clocks')).toBeNull();
  });
});

/**
 * The published page's own storage and share format. Every configuration a
 * reader saved or sent before this application existed is a `{v:1, deployment,
 * params, sim}` object, and `#cfg=` is how it travelled. It has to open here,
 * as itself -- not as an error, and not as the classic default pretending to
 * be it.
 */
describe('the published page\'s v1 payload', () => {
  const v1 = {
    v: 1,
    deployment: { dbPrimary: 'prg01', dbStandby: 'brn01', hostObserver: 'obs01' },
    /* The published page's own spelling of these: lowercase radio values, not
       the Oracle property values the document stores. */
    params: { mode: 'maxavail', threshold: 45, logXptMode: 'fastsync', pmyShutdown: false },
    sim: { scenario: 'isolated', observerLoc: 'dc3', latency: 4 },
  };
  const fragment = `cfg=${base64UrlEncode(utf8Encode(JSON.stringify(v1)))}`;

  it('is recognised without being decoded', () => {
    expect(fragmentKind(`#${fragment}`)).toBe('cfg');
  });

  it('opens as the configuration it describes, and says where it came from', async () => {
    const back = await decodeFragment(`#${fragment}`);
    expect(back?.doc).not.toBeNull();
    expect(back?.source).toBe('legacy-v1');
    const topo = back?.doc?.topology;
    /* The knobs the payload carries, read back off the document. */
    expect(topo?.config.protectionMode).toBe('MAXAVAILABILITY');
    expect(topo?.config.fsfo.thresholdSeconds).toBe(45);
    expect(topo?.config.fsfo.pmyShutdown).toBe(false);
    expect(topo?.members.some((m) => m.kind === 'database' && m.logXptMode === 'FASTSYNC')).toBe(true);
  });
});
