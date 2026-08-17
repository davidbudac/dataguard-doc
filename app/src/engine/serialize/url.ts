/**
 * URL payload helpers -- engine design SS1.7.
 *
 * The address bar carries `#t=<base64url(deflate-raw(JSON))>` when the host
 * has CompressionStream, and `#cfg2=<base64url(JSON)>` when it does not;
 * `#cfg=` is the legacy payload, handed to the migration chain.
 *
 * This module never touches `window`, `location` or `document`: it takes and
 * returns strings, so the DOM layer owns the address bar and the engine stays
 * testable in Node. UTF-8 and base64 are hand rolled for the same reason --
 * no `btoa`, no `TextEncoder`, nothing host-specific.
 */

export type PayloadKind = 't' | 'cfg2' | 'cfg';

export interface DecodedPayload {
  kind: PayloadKind;
  /** The JSON text; parse it with the migration chain, never blindly. */
  json: string;
}

/* ---------------- UTF-8 ---------------- */

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i++] as number;
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if ((b0 & 0xe0) === 0xc0) cp = ((b0 & 0x1f) << 6) | ((bytes[i++] as number) & 0x3f);
    else if ((b0 & 0xf0) === 0xe0) {
      cp = ((b0 & 0x0f) << 12) | (((bytes[i++] as number) & 0x3f) << 6) | ((bytes[i++] as number) & 0x3f);
    } else {
      cp = ((b0 & 0x07) << 18) | (((bytes[i++] as number) & 0x3f) << 12)
        | (((bytes[i++] as number) & 0x3f) << 6) | ((bytes[i++] as number) & 0x3f);
    }
    if (cp > 0xffff) {
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      s += String.fromCharCode(cp);
    }
  }
  return s;
}

/* ---------------- base64url ---------------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i] as string] = i;
/* Accept the padded, non-url alphabet on the way in as well. */
B64_INDEX['+'] = 62;
B64_INDEX['/'] = 63;

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : undefined;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : undefined;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 === undefined) break;
    out += B64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 === undefined) break;
    out += B64[b2 & 63];
  }
  return out;
}

export function base64UrlDecode(text: string): Uint8Array | null {
  const s = text.replace(/=+$/, '');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64_INDEX[ch];
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/* ---------------- deflate-raw ---------------- */

interface StreamLike {
  writable: { getWriter(): { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> } };
  readable: {
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> };
  };
}
type StreamCtor = new (format: string) => StreamLike;

const ctor = (name: 'CompressionStream' | 'DecompressionStream'): StreamCtor | null => {
  const g = globalThis as unknown as Record<string, unknown>;
  const c = g[name];
  return typeof c === 'function' ? (c as StreamCtor) : null;
};

/** True when this host can produce the compact `#t=` payload. */
export const hasCompression = (): boolean =>
  ctor('CompressionStream') !== null && ctor('DecompressionStream') !== null;

async function pump(stream: StreamLike, bytes: Uint8Array): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  /* The write side is caught here on purpose: when the stream rejects a bad
     payload both sides fail, the read below is what reports it, and an
     uncaught write rejection would surface as an unhandled rejection instead. */
  const written = writer.write(bytes).then(() => writer.close()).catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.length; }
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  const C = ctor('CompressionStream');
  if (!C) return null;
  try { return await pump(new C('deflate-raw'), bytes); } catch { return null; }
}

export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  const D = ctor('DecompressionStream');
  if (!D) return null;
  try { return await pump(new D('deflate-raw'), bytes); } catch { return null; }
}

/* ---------------- payloads ---------------- */

/**
 * Encode a JSON document for the address bar. Returns the fragment WITHOUT the
 * leading '#', so the caller decides how to compose it with a chapter anchor.
 */
export async function encodePayload(json: string): Promise<string> {
  const bytes = utf8Encode(json);
  const deflated = await deflateRaw(bytes);
  if (deflated && deflated.length < bytes.length) {
    return `t=${base64UrlEncode(deflated)}`;
  }
  return `cfg2=${base64UrlEncode(bytes)}`;
}

/** The uncompressed form, for hosts without CompressionStream and for tests. */
export function encodePayloadPlain(json: string): string {
  return `cfg2=${base64UrlEncode(utf8Encode(json))}`;
}

/**
 * Decode a fragment (with or without its leading '#') or a bare `key=value`
 * pair. Returns null when the fragment carries no payload this engine knows.
 */
export async function decodePayload(fragment: string): Promise<DecodedPayload | null> {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key !== 't' && key !== 'cfg2' && key !== 'cfg') continue;
    const bytes = base64UrlDecode(value);
    if (!bytes) return null;
    if (key === 't') {
      const inflated = await inflateRaw(bytes);
      if (!inflated) return null;
      return { kind: 't', json: utf8Decode(inflated) };
    }
    return { kind: key, json: utf8Decode(bytes) };
  }
  return null;
}

/** Which payload key a fragment carries, without decoding it. */
export function payloadKind(fragment: string): PayloadKind | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  for (const part of raw.split('&')) {
    const key = part.slice(0, Math.max(0, part.indexOf('=')));
    if (key === 't' || key === 'cfg2' || key === 'cfg') return key;
  }
  return null;
}
