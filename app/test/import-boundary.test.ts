/**
 * The engine is a layer, and this is the wall around it.
 *
 * `src/engine/__tests__/purity.test.ts` asserts the engine is *pure* -- no
 * clock, no dice, no I/O. This file asserts something narrower and structural:
 * that nothing under `src/engine` can see the application built on top of it.
 * The two failures look the same from the outside (a green test suite and a
 * broken build) and have different causes, so they are checked separately.
 *
 * The wall matters because the engine is the thing under test. Every number
 * this workbench shows is derived here and asserted here; the moment a rule or
 * a model can read a signal, a DOM node or the current viewport, the assertion
 * stops being about Data Guard and starts being about the browser it happens
 * to be running in.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const ENGINE = join(SRC, 'engine');

/** Every source file under a directory, tests included: the wall has no gate. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, out);
      continue;
    }
    if (['.ts', '.tsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const ENGINE_FILES = sources(ENGINE);

/* What actually ships. The engine's own test files live inside the tree and
   are held to the import rules that matter -- no framework, no DOM, nothing
   from a layer above -- but they are allowed to reach the shared topology
   builders in `test/`, which is where the fixtures for the whole app live. */
const isTest = (f: string): boolean => f.includes('/__tests__/') || f.endsWith('.test.ts');
const SHIPPED = ENGINE_FILES.filter((f) => !isTest(f));
const rel = (f: string): string => relative(SRC, f);

/** Every module specifier the file imports, re-exports or `import()`s. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g)) {
    out.push(m[1] as string);
  }
  for (const m of text.matchAll(/(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push(m[1] as string);
  }
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1] as string);
  return out;
}

/* Comments carry the citations and the reasoning, and a quoted Oracle sentence
   may legitimately contain the word "document". The ban is on what the code
   does, so comments come out before the global scan. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Where a relative specifier lands, as a path under `src/`. */
const resolvedFrom = (file: string, spec: string): string =>
  relative(SRC, join(file, '..', spec));

describe('the engine imports no UI framework', () => {
  it('scans a directory that is actually there', () => {
    expect(ENGINE_FILES.length).toBeGreaterThan(30);
    expect(ENGINE_FILES.some((f) => f.endsWith('index.ts'))).toBe(true);
  });

  it('never names preact, @preact/* or react in an import', () => {
    for (const f of ENGINE_FILES) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        expect(
          /^(preact|@preact(\/.*)?|react|react-dom(\/.*)?|preact\/.*)$/.test(spec),
          `${rel(f)} imports ${spec}`,
        ).toBe(false);
      }
    }
  });

  it('never names a signal, a hook or a component file', () => {
    for (const f of ENGINE_FILES) {
      const text = code(readFileSync(f, 'utf8'));
      for (const bad of [/\bcomputed\s*\(/, /\bsignal\s*\(/, /\buseState\s*\(/, /\buseEffect\s*\(/, /\bh\s*\(\s*['"]/]) {
        expect(bad.test(text), `${rel(f)} matches ${bad}`).toBe(false);
      }
    }
  });
});

describe('the engine references no browser global', () => {
  /* Member access, not the bare word: a property named `document` on a
     generated-file record is not a DOM reference, and the rules quote Oracle
     sentences that contain "location" and "history" as ordinary English. */
  const GLOBALS: readonly [string, RegExp][] = [
    ['document', /\bdocument\s*[.[]/],
    ['window', /\bwindow\s*[.[]/],
    ['globalThis.document', /\bglobalThis\s*\.\s*document\b/],
    ['globalThis.window', /\bglobalThis\s*\.\s*window\b/],
    ['navigator', /\bnavigator\s*[.[]/],
    ['location', /\blocation\s*\.\s*(href|search|hash|pathname|origin|assign|replace|reload)\b/],
    ['history', /\bhistory\s*\.\s*(pushState|replaceState|go|back|forward)\b/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['alert', /\balert\s*\(/],
    ['requestAnimationFrame', /\brequestAnimationFrame\b/],
    ['setTimeout', /\bsetTimeout\s*\(/],
    ['HTMLElement', /\bHTMLElement\b/],
    ['Element', /\bdocument\.createElement\b/],
  ];

  it.each(GLOBALS)('no file mentions %s', (_name, pattern) => {
    for (const f of ENGINE_FILES) {
      const text = code(readFileSync(f, 'utf8'));
      expect(pattern.test(text), `${rel(f)} matches ${pattern}`).toBe(false);
    }
  });

  it('reaches the one optional platform API through globalThis, guarded', () => {
    /* Compression is the single exception, and it is written so the engine
       still runs where the API does not exist -- so it is a feature test on
       globalThis, never a bare identifier the bundler would have to provide. */
    const url = code(readFileSync(join(ENGINE, 'serialize', 'url.ts'), 'utf8'));
    expect(url).toMatch(/globalThis/);
    expect(/(^|[^.])\bnew\s+CompressionStream\b/.test(url)).toBe(false);
    expect(/(^|[^.])\bnew\s+DecompressionStream\b/.test(url)).toBe(false);
  });
});

describe('the engine sits under everything and imports nothing above it', () => {
  const ABOVE = ['ui', 'state', 'presets', 'content', 'styles', 'main'];

  it('imports no module from the layers built on it', () => {
    for (const f of ENGINE_FILES) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        for (const layer of ABOVE) {
          expect(spec.startsWith(`@/${layer}`), `${rel(f)} imports ${spec}`).toBe(false);
          if (spec.startsWith('.')) {
            const landed = resolvedFrom(f, spec);
            expect(
              landed === layer || landed.startsWith(`${layer}/`),
              `${rel(f)} imports ${spec}, which lands in src/${layer}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('never escapes src/engine by a relative path', () => {
    expect(SHIPPED.length).toBeGreaterThan(30);
    for (const f of SHIPPED) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const landed = relative(ENGINE, join(f, '..', spec));
        expect(landed.startsWith('..'), `${rel(f)} imports ${spec}`).toBe(false);
      }
    }
  });

  it('lets the engine\'s own fixtures reach the shared test helpers, and nothing else', () => {
    for (const f of ENGINE_FILES.filter(isTest)) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        if (!relative(ENGINE, join(f, '..', spec)).startsWith('..')) continue;
        const landed = relative(fileURLToPath(new URL('..', import.meta.url)), join(f, '..', spec));
        expect(landed, `${rel(f)} escapes to ${spec}`).toMatch(/^test\//);
      }
    }
  });

  it('uses relative specifiers only -- the @ alias is the application\'s', () => {
    for (const f of ENGINE_FILES) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        expect(spec.startsWith('@/'), `${rel(f)} imports ${spec}`).toBe(false);
      }
    }
  });

  it('is reached from above through its index, or through a named module', () => {
    /* Not a ban on deep imports -- tests take them deliberately -- but the
       application code goes through `@/engine`, so the public surface stays
       the thing that is maintained. */
    for (const f of sources(SRC)) {
      if (f.startsWith(`${ENGINE}/`)) continue;
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        if (!/(^|\/)engine\//.test(spec)) continue;
        expect(spec, `${rel(f)} deep-imports ${spec}`).toMatch(/engine\/(?!.*\/)[a-z-]+$/);
      }
    }
  });
});

describe('the wall is load-bearing: the scanner catches what it claims to', () => {
  /* A test that can never fail is not a test. These run the same predicates
     over text that does violate them. */
  it('finds a preact import, a DOM reference and an upward import', () => {
    expect(specifiers("import { h } from 'preact';\n")).toEqual(['preact']);
    expect(specifiers("export { x } from '@/state/doc';\n")).toEqual(['@/state/doc']);
    expect(specifiers("const m = await import('./ui/App');\n")).toEqual(['./ui/App']);
    expect(/\bdocument\s*[.[]/.test('const n = document.body;')).toBe(true);
    expect(/\bwindow\s*[.[]/.test('window.addEventListener();')).toBe(true);
    /* And does not fire on the words as ordinary English in a comment. */
    expect(code('/* the document the user built */ const a = 1;')).not.toMatch(/document/);
  });
});
