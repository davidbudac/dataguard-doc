/**
 * The Document on the wire: the share link's fragment and the `.dgtopo.json`
 * file (ui.md SS2, engine.md SS1.7).
 *
 * One shape serves both. It is the engine's `TopologyDoc` -- so a file written
 * here parses with `parseTopologyDoc` and a file written by anything else
 * loads here -- plus one `ui` object carrying the three things the engine has
 * no opinion about: the document's name and notes, the simulation parameters
 * and the canvas drag overrides. Unknown keys are dropped on the way in and
 * reported, never silently kept.
 *
 * Fragment keys, in the order the decoder accepts them:
 *
 *   `#t=`     base64url(deflate-raw(JSON))  -- the compact form, the default
 *   `#t0=`    base64url(JSON)               -- the fallback where the host has
 *                                              no CompressionStream
 *   `#cfg2=`  base64url(JSON)               -- the engine's spelling of the
 *                                              same fallback; read, never written
 *   `#cfg=`   the published page's v1 payload, handed to the migration chain
 *
 * A link is capped at 8000 characters. Past that the answer is honest -- the
 * configuration is too large for a link -- and the export file is the way out.
 */

import {
  base64UrlDecode, base64UrlEncode, deflateRaw, inflateRaw, migrate,
  utf8Decode, utf8Encode,
} from '@/engine';
import type { MigrationSource, SchemaIssue, SimParams, TopologyDoc } from '@/engine';
import type { Doc, LayoutOverride } from './doc';
import { makeDoc, snapToGrid } from './doc';

/** WebKit and every server in between: 8000 characters is the working ceiling. */
export const URL_MAX_CHARS = 8000;

export const TOO_LARGE_MESSAGE =
  'This configuration is too large for a link -- export the file instead.';

export interface DecodeResult {
  doc: Doc | null;
  /** Where the payload came from, so the UI can say "upgraded from a v1 link". */
  source: MigrationSource;
  issues: SchemaIssue[];
  /** `ui` keys that were not understood, reported rather than swallowed. */
  dropped: string[];
}

export interface EncodeResult {
  /** The fragment WITHOUT its leading '#', so the caller composes the URL. */
  fragment: string;
  tooLarge: boolean;
  /** Length of `#` + fragment, which is what the cap is about. */
  length: number;
}

/* ---------------- the wire object ---------------- */

interface WireUi {
  name?: string;
  notes?: string;
  params?: SimParams;
  layout?: Record<string, LayoutOverride>;
}

export function toWire(d: Doc): TopologyDoc & { ui: WireUi } {
  const ui: WireUi = { name: d.meta.name, notes: d.meta.notes, params: d.params, layout: d.layout };
  return { ...d.topology, ui };
}

export const toJsonText = (d: Doc): string => JSON.stringify(toWire(d), null, 2);

/** Whitelist + clamp for the one object the engine does not validate. */
function parseUi(raw: unknown, dropped: string[]): WireUi {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: WireUi = {};
  for (const key of Object.keys(src)) {
    if (!['name', 'notes', 'params', 'layout'].includes(key)) dropped.push(`ui.${key}`);
  }
  if (typeof src['name'] === 'string') out.name = src['name'].slice(0, 128);
  if (typeof src['notes'] === 'string') out.notes = src['notes'].slice(0, 4000);

  const p = src['params'];
  if (typeof p === 'object' && p !== null) {
    const pr = p as Record<string, unknown>;
    const params: SimParams = {};
    if (pr['targetPolicy'] === 'skip-to-next' || pr['targetPolicy'] === 'active-target-only') {
      params.targetPolicy = pr['targetPolicy'];
    }
    if (pr['commitWaitPolicy'] === 'all' || pr['commitWaitPolicy'] === 'first-ack') {
      params.commitWaitPolicy = pr['commitWaitPolicy'];
    }
    if (typeof pr['maxEpochs'] === 'number' && isFinite(pr['maxEpochs'])) {
      params.maxEpochs = Math.max(1, Math.min(4096, Math.round(pr['maxEpochs'])));
    }
    if (typeof pr['horizon'] === 'number' && isFinite(pr['horizon'])) {
      /* The adaptive axis clamps the horizon to 30-900 s itself; this only
         keeps a hand-edited file from asking for something absurd. */
      params.horizon = Math.max(1, Math.min(3600, pr['horizon']));
    }
    for (const key of Object.keys(pr)) {
      if (!['targetPolicy', 'commitWaitPolicy', 'maxEpochs', 'horizon'].includes(key)) {
        dropped.push(`ui.params.${key}`);
      }
    }
    out.params = params;
  }

  const l = src['layout'];
  if (typeof l === 'object' && l !== null && !Array.isArray(l)) {
    const layout: Record<string, LayoutOverride> = {};
    for (const [id, v] of Object.entries(l as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) { dropped.push(`ui.layout.${id}`); continue; }
      const o = v as Record<string, unknown>;
      const dx = typeof o['dx'] === 'number' && isFinite(o['dx']) ? o['dx'] : null;
      const dy = typeof o['dy'] === 'number' && isFinite(o['dy']) ? o['dy'] : null;
      if (dx === null || dy === null) { dropped.push(`ui.layout.${id}`); continue; }
      const w = typeof o['w'] === 'number' && isFinite(o['w']) ? o['w'] : null;
      const h = typeof o['h'] === 'number' && isFinite(o['h']) ? o['h'] : null;
      const clamp = (v: number): number => Math.max(-4000, Math.min(4000, v));
      /* A data centre's own box (doc.ts `LayoutOverride`): kept to the pixel,
         because it is measured off a rectangle that is not on the grid. An
         entry with only one of the two sizes is read as a plain offset --
         an older page wrote neither, so an older link reads exactly as it did. */
      /* A data centre's place in the column order (doc.ts `LayoutOverride`). */
      const order = typeof o['order'] === 'number' && Number.isInteger(o['order'])
        && o['order'] >= 0 && o['order'] < 1000 ? o['order'] : null;
      const kept = order === null ? {} : { order };
      layout[id] = w !== null && h !== null
        ? {
          dx: Math.round(clamp(dx)), dy: Math.round(clamp(dy)),
          w: Math.round(Math.max(16, Math.min(8000, w))), h: Math.round(Math.max(16, Math.min(8000, h))),
          ...kept,
        }
        : { dx: snapToGrid(clamp(dx)), dy: snapToGrid(clamp(dy)), ...kept };
    }
    out.layout = layout;
  }
  return out;
}

export function fromWire(raw: unknown): DecodeResult {
  const dropped: string[] = [];
  const result = migrate(raw);
  if (!result.doc) {
    return { doc: null, source: result.from, issues: result.issues, dropped };
  }
  const ui = parseUi((raw as Record<string, unknown> | null)?.['ui'], dropped);
  const d = makeDoc(result.doc, {
    meta: { name: ui.name ?? result.doc.label ?? 'Data Guard configuration', notes: ui.notes ?? '' },
    ...(ui.params ? { params: ui.params } : {}),
    ...(ui.layout ? { layout: ui.layout } : {}),
  });
  return { doc: d, source: result.from, issues: result.issues, dropped };
}

export function parseJsonText(text: string): DecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      doc: null, source: 'unknown', dropped: [],
      issues: [{ path: '', message: 'not valid JSON', severity: 'error' }],
    };
  }
  return fromWire(raw);
}

/* ---------------- fragment ---------------- */

/** Encode a Document for the address bar. `#` is not included. */
export async function encodeDoc(d: Doc): Promise<EncodeResult> {
  const json = JSON.stringify(toWire(d));
  const bytes = utf8Encode(json);
  const deflated = await deflateRaw(bytes);
  const fragment = deflated && deflated.length < bytes.length
    ? `t=${base64UrlEncode(deflated)}`
    : `t0=${base64UrlEncode(bytes)}`;
  const length = fragment.length + 1;
  return { fragment, tooLarge: length > URL_MAX_CHARS, length };
}

/** The uncompressed spelling, for hosts without CompressionStream and tests. */
export function encodeDocPlain(d: Doc): EncodeResult {
  const fragment = `t0=${base64UrlEncode(utf8Encode(JSON.stringify(toWire(d))))}`;
  const length = fragment.length + 1;
  return { fragment, tooLarge: length > URL_MAX_CHARS, length };
}

export type FragmentKind = 't' | 't0' | 'cfg2' | 'cfg';

const FRAGMENT_KEYS: readonly FragmentKind[] = ['t', 't0', 'cfg2', 'cfg'];

/** Which payload a fragment carries, without decoding it. */
export function fragmentKind(fragment: string): FragmentKind | null {
  for (const [key] of fragmentPairs(fragment)) {
    if ((FRAGMENT_KEYS as readonly string[]).includes(key)) return key as FragmentKind;
  }
  return null;
}

function* fragmentPairs(fragment: string): Generator<[string, string]> {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    yield [part.slice(0, eq), part.slice(eq + 1)];
  }
}

/**
 * Decode a fragment. Returns null when it carries no payload at all -- that is
 * a normal URL, not an error.
 */
export async function decodeFragment(fragment: string): Promise<DecodeResult | null> {
  for (const [key, value] of fragmentPairs(fragment)) {
    if (!(FRAGMENT_KEYS as readonly string[]).includes(key)) continue;
    const bytes = base64UrlDecode(value);
    if (!bytes) return badPayload('the link is damaged: it is not valid base64url');
    let json: string;
    if (key === 't') {
      const inflated = await inflateRaw(bytes);
      if (!inflated) return badPayload('the link is damaged: it does not decompress');
      json = utf8Decode(inflated);
    } else {
      json = utf8Decode(bytes);
    }
    return parseJsonText(json);
  }
  return null;
}

const badPayload = (message: string): DecodeResult => ({
  doc: null, source: 'unknown', dropped: [],
  issues: [{ path: '', message, severity: 'error' }],
});
