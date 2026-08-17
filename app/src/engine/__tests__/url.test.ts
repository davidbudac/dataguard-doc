import { describe, expect, it } from 'vitest';
import {
  base64UrlDecode, base64UrlEncode, decodePayload, deflateRaw, encodePayload,
  encodePayloadPlain, hasCompression, inflateRaw, payloadKind, utf8Decode, utf8Encode,
} from '../serialize/url';
import { classicTopology } from '../compat/classic';
import { migrate } from '../serialize/migrate';

describe('UTF-8', () => {
  for (const s of ['', 'plain ascii', 'Praha, Brno a Ostrava', 'far sync -- SYNC', '\u{1F5A5}\u{1F4BE}']) {
    it(`round-trips ${JSON.stringify(s)}`, () => {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    });
  }
});

describe('base64url', () => {
  it('round-trips every byte length modulo 3', () => {
    for (let n = 0; n < 12; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 0xff);
      const text = base64UrlEncode(bytes);
      expect(text).not.toMatch(/[+/=]/);
      expect(base64UrlDecode(text)).toEqual(bytes);
    }
  });

  it('accepts the padded, non-url alphabet on the way in', () => {
    expect(utf8Decode(base64UrlDecode('c3ViPz8/')!)).toBe('sub???');
    expect(base64UrlDecode('a2E=')).toEqual(base64UrlDecode('a2E'));
  });

  it('returns null on a character that is not base64 at all', () => {
    expect(base64UrlDecode('not base64!')).toBeNull();
  });
});

describe('deflate-raw', () => {
  it('round-trips when the host has CompressionStream', async () => {
    if (!hasCompression()) return;
    const bytes = utf8Encode('(LOCAL : FS1 SYNC)'.repeat(40));
    const packed = await deflateRaw(bytes);
    expect(packed).not.toBeNull();
    expect(packed!.length).toBeLessThan(bytes.length);
    expect(await inflateRaw(packed!)).toEqual(bytes);
  });

  it('inflating rubbish fails softly rather than throwing', async () => {
    if (!hasCompression()) return;
    expect(await inflateRaw(Uint8Array.from([1, 2, 3, 4, 5]))).toBeNull();
  });
});

describe('payloads', () => {
  const json = JSON.stringify(classicTopology({ scenario: 'isolated', observerLoc: 'dc2' }));

  it('a compressible document takes the compact t= form where it can', async () => {
    const payload = await encodePayload(json);
    expect(payload.startsWith(hasCompression() ? 't=' : 'cfg2=')).toBe(true);
    expect(payloadKind(`#${payload}`)).toBe(hasCompression() ? 't' : 'cfg2');
    const back = await decodePayload(`#${payload}`);
    expect(back?.json).toBe(json);
  });

  it('the plain form round-trips without any compression at all', async () => {
    const payload = encodePayloadPlain(json);
    expect(payload.startsWith('cfg2=')).toBe(true);
    expect((await decodePayload(payload))?.json).toBe(json);
  });

  it('the legacy cfg= key is recognised and handed on for migration', async () => {
    const legacy = JSON.stringify({ v: 1, sim: { scenario: 'dc2down' } });
    const fragment = `#cfg=${base64UrlEncode(utf8Encode(legacy))}`;
    const decoded = await decodePayload(fragment);
    expect(decoded?.kind).toBe('cfg');
    const r = migrate(JSON.parse(decoded!.json) as unknown);
    expect(r.from).toBe('legacy-v1');
    expect(r.doc?.events).toEqual([{ at: 0, kind: 'site.down', site: 'dc2' }]);
  });

  it('a fragment with a chapter anchor and no payload decodes to null', async () => {
    expect(await decodePayload('#ch-observer')).toBeNull();
    expect(payloadKind('#ch-observer')).toBeNull();
  });

  it('a payload sitting beside other fragment keys is still found', async () => {
    const payload = encodePayloadPlain('{"a":1}');
    expect((await decodePayload(`#lang=cs&${payload}`))?.json).toBe('{"a":1}');
  });

  it('a corrupt payload decodes to null rather than throwing', async () => {
    expect(await decodePayload('#cfg2=!!!!')).toBeNull();
  });

  it('a document survives encode, decode and the migration chain', async () => {
    const doc = classicTopology({ scenario: 'switchover', observerLoc: 'dc1' });
    const decoded = await decodePayload(`#${await encodePayload(JSON.stringify(doc))}`);
    const r = migrate(JSON.parse(decoded!.json) as unknown);
    expect(r.ok).toBe(true);
    expect(r.doc).toEqual(doc);
  });
});
