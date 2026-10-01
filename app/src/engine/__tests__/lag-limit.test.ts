/**
 * FastStartFailoverLagLimit: "not set" is a state of its own (ED-03, VAL-06).
 *
 * The reading edition is a preference laid over the document, so a stored
 * number cannot stand for "the broker default": 30 under 19c is 0 under 26ai
 * in maximum availability. A document says whether the property was set
 * (`lagLimitSet`), and `lagLimitOf` is the limit in force. These tests pin the
 * helper, the serialization rule for documents written before the marker, and
 * -- by scanning the source -- that nothing reads the stored number directly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LAG_LIMIT_UNSET_STORED, lagLimitIsSet, lagLimitOf } from '../defaults';
import { emptyDoc, parseTopologyDoc } from '../serialize/schema';
import { migrateLegacyQuery, migrateV1 } from '../serialize/migrate';
import { classicTopology } from '../compat/classic';
import type { Edition } from '../ids';
import type { ProtectionMode, TopologyDoc } from '../types/topology';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const read = (doc: TopologyDoc, edition: Edition, mode: ProtectionMode): number =>
  lagLimitOf({ config: { ...doc.config, edition, protectionMode: mode } });

describe('lagLimitOf', () => {
  it('follows the edition and the mode while the property is not set', () => {
    const doc = emptyDoc('19c');
    expect(lagLimitIsSet(doc.config.fsfo)).toBe(false);
    expect(read(doc, '19c', 'MAXPERFORMANCE')).toBe(30);
    expect(read(doc, '19c', 'MAXAVAILABILITY')).toBe(30);
    expect(read(doc, '26ai', 'MAXPERFORMANCE')).toBe(30);
    /* "Broker default Maximum performance mode: 30 seconds Maximum
       availability mode: 0 seconds" */
    expect(read(doc, '26ai', 'MAXAVAILABILITY')).toBe(0);
  });

  it('is the value as set, whatever the edition, once the property is set', () => {
    const doc = emptyDoc('19c');
    doc.config.fsfo.lagLimitSeconds = 30;
    doc.config.fsfo.lagLimitSet = true;
    expect(read(doc, '26ai', 'MAXAVAILABILITY')).toBe(30);
    doc.config.fsfo.lagLimitSeconds = 0;
    expect(read(doc, '19c', 'MAXPERFORMANCE')).toBe(0);
  });

  it('ignores the stored number while the property is not set', () => {
    const doc = emptyDoc('26ai');
    doc.config.fsfo.lagLimitSeconds = 45;
    expect(read(doc, '26ai', 'MAXAVAILABILITY')).toBe(0);
  });
});

describe('serialization', () => {
  const parse = (raw: unknown): TopologyDoc => {
    const r = parseTopologyDoc(raw);
    expect(r.ok).toBe(true);
    return r.doc as TopologyDoc;
  };

  it('round-trips a document whose lag limit is not set, with no marker written', () => {
    const doc = emptyDoc('19c');
    const back = parse(clone(doc));
    expect(back.config.fsfo).toEqual(doc.config.fsfo);
    expect('lagLimitSet' in back.config.fsfo).toBe(false);
    expect(parseTopologyDoc(clone(doc)).issues).toEqual([]);
  });

  it('round-trips a set lag limit, 30 included', () => {
    for (const v of [0, 5, 30, 45]) {
      const doc = emptyDoc('26ai');
      doc.config.fsfo.lagLimitSeconds = v;
      doc.config.fsfo.lagLimitSet = true;
      const back = parse(clone(doc));
      expect(back.config.fsfo.lagLimitSet, `${v}`).toBe(true);
      expect(back.config.fsfo.lagLimitSeconds, `${v}`).toBe(v);
      expect(back).toEqual(doc);
    }
  });

  it('reads a document written before the marker: 30 was the universal default, so it is not set', () => {
    const raw = clone(emptyDoc('19c')) as unknown as { config: { fsfo: Record<string, unknown> } };
    delete raw.config.fsfo['lagLimitSet'];
    raw.config.fsfo['lagLimitSeconds'] = 30;
    const doc = parse(raw);
    expect(lagLimitIsSet(doc.config.fsfo)).toBe(false);
    /* The consequence the finding was about: under 26ai maximum availability
       the old file is zero data loss again. */
    expect(read(doc, '26ai', 'MAXAVAILABILITY')).toBe(0);
  });

  it('reads any other number without a marker as somebody\'s setting', () => {
    for (const v of [0, 10, 45]) {
      const raw = clone(emptyDoc('19c')) as unknown as { config: { fsfo: Record<string, unknown> } };
      raw.config.fsfo['lagLimitSeconds'] = v;
      const doc = parse(raw);
      expect(doc.config.fsfo.lagLimitSet, `${v}`).toBe(true);
      expect(read(doc, '26ai', 'MAXAVAILABILITY'), `${v}`).toBe(v);
    }
  });

  it('a missing lag limit is not set', () => {
    const raw = clone(emptyDoc('19c')) as unknown as { config: { fsfo: Record<string, unknown> } };
    delete raw.config.fsfo['lagLimitSeconds'];
    const doc = parse(raw);
    expect(lagLimitIsSet(doc.config.fsfo)).toBe(false);
    expect(doc.config.fsfo.lagLimitSeconds).toBe(LAG_LIMIT_UNSET_STORED);
  });

  it('keeps a marker as written, over the old-default rule', () => {
    const raw = clone(emptyDoc('19c')) as unknown as { config: { fsfo: Record<string, unknown> } };
    raw.config.fsfo['lagLimitSeconds'] = 30;
    raw.config.fsfo['lagLimitSet'] = true;
    expect(parse(raw).config.fsfo.lagLimitSet).toBe(true);
  });

  it('a legacy migration always carries an explicit limit, so it sets the marker', () => {
    expect(classicTopology({}).config.fsfo.lagLimitSet).toBe(true);
    expect(migrateV1({}).config.fsfo.lagLimitSet).toBe(true);
    expect(migrateLegacyQuery('').config.fsfo.lagLimitSet).toBe(true);
    /* ... and the published page's 26ai zero-loss policy survives a round trip. */
    const zero = classicTopology({ version: '26ai', mode: 'maxavail', lagPolicy: 'zero' });
    const back = parse(clone(zero));
    expect(back.config.fsfo.lagLimitSet).toBe(true);
    expect(lagLimitOf(back)).toBe(0);
  });
});

/* ---------------- every reader goes through lagLimitOf ---------------- */

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__golden__') continue;
      sources(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Where a direct `.lagLimitSeconds` is allowed, and which spellings: the
 * helper itself, the serializer, the inspector's edit, and the legacy
 * adapter (which writes it as an object key, so it needs no entry). The
 * Reopen model's `r.lagLimitSeconds` is its own input record, filled from
 * lagLimitOf.
 */
const ALLOWED: Record<string, RegExp[]> = {
  'engine/defaults.ts': [
    /\bc\.fsfo\.lagLimitSeconds\b/g, /\bd\.lagLimitSeconds\b/g,
    /* The bound's own floor, read by clampLagLimit (ED-09). */
    /\bBOUNDS\.lagLimitSeconds\b/g,
  ],
  'engine/serialize/schema.ts': [
    /\bd\.lagLimitSeconds\b/g, /\bout\.lagLimitSeconds\b/g, /\bBOUNDS\.lagLimitSeconds\b/g,
    /'config\.fsfo\.lagLimitSeconds'/g,
  ],
  'ui/inspector/ConfigForm.tsx': [],
  'engine/models/reopen.ts': [/\br\.lagLimitSeconds\b/g],
};

describe('nothing reads the stored lag limit directly', () => {
  const files = sources(SRC);

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('every .lagLimitSeconds outside the allow-list is a helper call instead', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f).split('\\').join('/');
      let text = code(readFileSync(f, 'utf8'));
      const allowed = ALLOWED[rel];
      if (allowed !== undefined) {
        for (const re of allowed) text = text.replace(re, '');
      }
      /* The inspector's edit writes the field inside its patch and reads
         nothing: its object-literal write is allowed, a read is not. */
      const hits = text.match(/\.lagLimitSeconds\b|\[\s*['"]lagLimitSeconds['"]\s*\]/g) ?? [];
      /* The serializer reads the raw JSON by key; that is its job. */
      const reads = rel === 'engine/serialize/schema.ts'
        ? hits.filter((h) => !h.startsWith('['))
        : hits;
      if (reads.length > 0) offenders.push(`${rel}: ${reads.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the helper is what the readers call', () => {
    for (const rel of [
      'engine/sim/fsfo.ts', 'engine/sim/simulate.ts', 'engine/redo/resolve.ts',
      'engine/validate/rules/fsfo.ts', 'engine/generate/dgmgrl.ts', 'engine/generate/show.ts',
      'engine/models/reopen.ts', 'ui/inspector/ConfigForm.tsx',
    ]) {
      expect(readFileSync(join(SRC, rel), 'utf8'), rel).toMatch(/\blagLimitOf\(/);
    }
  });
});
