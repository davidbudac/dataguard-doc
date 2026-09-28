/**
 * Citation probe -- is every quoted sentence still on the page it cites?
 *
 * Fetches each URL in the citation catalogue with curl, turns the page into
 * text (`totext.py`) and looks for the quote, word for word. Quotes marked
 * `paraphrase` are counted, not checked. Like the other probes it prints and
 * never fails -- a quote that spans a table or a list can miss on layout alone,
 * so every MISSING row is read by a person before it is believed.
 *
 * It goes to the network, so it runs only when asked:
 *
 *   FACT_CHECK_ONLINE=1 npx vitest run --config vitest.factcheck.config.ts
 *
 * Pages are cached under the system temp directory for the length of the run
 * and are never written into the repository.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

import { CITATIONS } from '../../src/engine/citations';
import type { Citation } from '../../src/engine/citations';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(tmpdir(), 'dg-fact-check-citations');

/* Words only: a quote must not miss on a curly quote, a dash, a table bar or
   the whitespace the page was laid out with. */
const words = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9$_]+/g, ' ').replace(/\s+/g, ' ').trim();

function pageText(url: string): string {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 12);
  const html = join(CACHE, `${key}.html`);
  const txt = join(CACHE, `${key}.txt`);
  if (!existsSync(txt)) {
    try {
      execFileSync('curl', ['-sS', '-m', '90', '-L', '-A', 'Mozilla/5.0', '-o', html, url]);
    } catch {
      writeFileSync(html, '');
    }
    execFileSync('python3', [join(HERE, 'totext.py'), html], { stdio: 'ignore' });
  }
  return words(readFileSync(txt, 'utf8'));
}

it.runIf(process.env.FACT_CHECK_ONLINE === '1')('every citation quote is on its page', () => {
  mkdirSync(CACHE, { recursive: true });
  const missing: string[] = [];
  let verbatim = 0;
  let paraphrase = 0;
  for (const [id, c] of Object.entries(CITATIONS) as [string, Citation][]) {
    if (c.paraphrase === true) { paraphrase++; continue; }
    const text = pageText(c.url);
    /* A quote may elide with "..." or an ellipsis: each part is looked for. */
    const parts = c.quote.split(/\s*(?:\.\.\.|…)\s*/).map(words).filter((p) => p.length > 3);
    const gone = parts.filter((p) => !text.includes(p));
    if (gone.length === 0) verbatim++;
    else missing.push(`MISSING  ${id} [${c.edition}]  ${c.url}\n         ${gone.join(' || ').slice(0, 240)}`);
  }
  console.log([
    '',
    `citations: ${verbatim} verbatim, ${paraphrase} paraphrase (not checked), ${missing.length} missing`,
    ...missing,
    '',
  ].join('\n'));
}, 1_800_000);
