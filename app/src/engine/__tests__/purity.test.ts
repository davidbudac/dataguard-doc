import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__golden__') continue;
      sources(full, out);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const FILES = sources(ENGINE);

/* Comments are where the rules are explained, so they are stripped before the
   scan: the ban is on what the code does, not on what it talks about. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the engine is pure', () => {
  it('finds its own sources', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('imports no UI framework', () => {
    for (const f of FILES) {
      const text = readFileSync(f, 'utf8');
      expect(/from\s+['"](preact|@preact\/[^'"]+|react)['"]/.test(text), f).toBe(false);
    }
  });

  it('touches no DOM or storage global', () => {
    for (const f of FILES) {
      const text = code(readFileSync(f, 'utf8'));
      /* Matched as member access, so a documentation quote that happens to
         contain the word "location" is not mistaken for a DOM reference. */
      for (const bad of [/\bdocument\s*\./, /\bwindow\s*[.[]/, /\blocalStorage\s*\./, /\bsessionStorage\s*\./, /\bnavigator\s*\./, /\blocation\s*\./, /\bhistory\s*\./, /\bfetch\s*\(/, /\bURLSearchParams\b/]) {
        expect(bad.test(text), `${f} matches ${bad}`).toBe(false);
      }
    }
  });

  it('reads no clock and rolls no dice', () => {
    for (const f of FILES) {
      const text = code(readFileSync(f, 'utf8'));
      for (const bad of [/Math\.random/, /Date\.now/, /new Date\b/, /performance\.now/]) {
        expect(bad.test(text), `${f} matches ${bad}`).toBe(false);
      }
    }
  });

  it('does no I/O', () => {
    for (const f of FILES) {
      const text = readFileSync(f, 'utf8');
      expect(/from\s+['"]node:/.test(text), f).toBe(false);
      expect(/require\s*\(/.test(code(text)), f).toBe(false);
    }
  });

  it('reaches for CompressionStream through globalThis, and survives its absence', () => {
    const url = readFileSync(join(ENGINE, 'serialize', 'url.ts'), 'utf8');
    expect(url).toContain('globalThis');
    expect(/new\s+CompressionStream/.test(code(url))).toBe(false);
  });

  it('keeps the dependency direction: only the migration reaches into compat', () => {
    for (const f of FILES) {
      if (f.includes(`${'compat'}/`)) continue;
      const text = readFileSync(f, 'utf8');
      const importsCompat = /from\s+['"][^'"]*compat\/[^'"]*['"]/.test(text);
      if (importsCompat) {
        expect(f.endsWith('migrate.ts') || f.endsWith('index.ts'), `${f} imports compat`).toBe(true);
      }
    }
  });

  it('has no runtime dependency beyond the standard library', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    for (const f of FILES) {
      const text = readFileSync(f, 'utf8');
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        expect(text.includes(`'${dep}'`), `${f} imports ${dep}`).toBe(false);
      }
    }
  });
});
