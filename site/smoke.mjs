// Load the built page in a real browser and check that it drew the thing.
//
// The vitest suite renders components into jsdom, which has no layout, no CSP
// and no module loader; this is the other half -- the built bundle, fetched
// over HTTP by Chrome, booting from a link, drawing a topology and a timeline.
// Every failure it can report is one the unit tests cannot see: a bundle that
// does not parse, a boot order that throws, a share link the page cannot read
// back, an asset the page asks for and does not get.
//
// Dependency-free on purpose: node's own http server and one Chrome process.
// It builds nothing -- run `node site/build.mjs` first.
//
//   node site/smoke.mjs           check _site/
//
// Exit status is the result: 0 when every check passed, 1 otherwise.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, '_site');
const CHROME = process.env['CHROME'] ?? '/usr/bin/google-chrome';
/** One page load's ceiling. Past this the browser is not slow, it is stuck. */
const TIMEOUT_MS = 90_000;

/* The two links this checks. `#t=` is the share link's own spelling -- the
   compressed document in the fragment -- and it is produced by the page
   itself in phase one rather than hand-written here, so the check is a round
   trip through the real encoder and the real decoder rather than a fixture
   that can drift away from both.
   The counts are what these two configurations are: the classic 1+1+1 is a
   primary, a standby and an observer; Example 5-2 adds a far sync instance in
   front of the standby. Every member and every observer is a card on the
   canvas and a lane on the timeline. */
const CASES = [
  { preset: 'classic', cards: 3, lanes: 3 },
  { preset: 'far-sync-zero-loss', cards: 4, lanes: 4 },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const failures = [];
const fail = (what) => { failures.push(what); console.error(`  FAIL  ${what}`); };
const pass = (what) => console.log(`  ok    ${what}`);

/* ---------------- a static server, so the page loads the way it ships ---------------- */

// Not file://: an ES module served from a file URL is blocked by the module
// loader's origin check, and the page is one <script type="module">. Serving it
// over HTTP is also what the deploy does.
function serve(dir) {
  const requested = [];
  const missing = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const path = normalize(join(dir, rel));
    requested.push(rel);
    if (!path.startsWith(dir) || !existsSync(path) || !statSync(path).isFile()) {
      missing.push(rel);
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, requested, missing, close: () => server.close() });
    });
  });
}

/* ---------------- one Chrome run ---------------- */

/**
 * Load `url`, let the page run, and hand back the DOM it ended with plus every
 * line it wrote to the console.
 *
 * `--virtual-time-budget` is what makes this deterministic: Chrome runs the
 * page's timers as fast as it can and dumps the DOM when the budget is spent,
 * so the 300 ms debounce behind the address bar has fired by then without this
 * script sleeping for a real 300 ms.
 */
function load(url) {
  const profile = mkdtempSync(join(tmpdir(), 'dg-smoke-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    /* Wide enough that the shell lays out as the desktop it is designed for:
       a rail beside the canvas and the timeline in the dock. */
    '--window-size=1600,1000',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    /* Console messages go to stderr, tagged `:CONSOLE:`. Without
       --enable-logging they are dropped and a page that throws looks healthy. */
    '--enable-logging=stderr',
    '--log-level=0',
    '--virtual-time-budget=10000',
    '--dump-dom',
    url,
  ];
  /* Chrome's sandbox needs a non-root user; as root it refuses to start at all,
     and a smoke check that cannot run is a failed check. */
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');

  /* Asynchronous, and this is not a detail: the page is served by this very
     process, so a blocking spawn would deadlock -- Chrome waiting for a file
     the server cannot send while node waits for Chrome. */
  return new Promise((resolve) => {
    const child = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });

    /* A browser that never finishes is a failure with a name, not a hang. */
    const killer = setTimeout(() => { child.kill('SIGKILL'); }, TIMEOUT_MS);

    const done = (result) => {
      clearTimeout(killer);
      rmSync(profile, { recursive: true, force: true });
      resolve(result);
    };

    child.on('error', (e) => done({ ok: false, dom: '', console: [], why: `chrome could not run: ${e.message}` }));
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL') {
        done({ ok: false, dom: out, console: [], why: `chrome did not finish within ${TIMEOUT_MS / 1000} s` });
        return;
      }
      if (code !== 0) {
        done({ ok: false, dom: out, console: [], why: `chrome exited ${code}` });
        return;
      }
      const messages = err
        .split('\n')
        .filter((l) => /:CONSOLE[:(]/.test(l))
        .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim());
      done({ ok: true, dom: out, console: messages, why: null });
    });
  });
}

/* The canvas card and the timeline lane, counted by the class and the
   attribute the components actually carry. `data-node` is not the card's own
   mark -- site rects and link paths carry it too -- so the card is counted by
   `class="tp-node"`, and the lookahead is what keeps `tp-nodes`, the group
   that holds them, out of the count. */
const countCards = (dom) => [...dom.matchAll(/class="tp-node(?=["\s])/g)].length;
const countLanes = (dom) => [...dom.matchAll(/\sdata-lane="/g)].length;

/* ---------------- the checks ---------------- */

if (!existsSync(join(site, 'index.html'))) {
  console.error('ERROR: _site/index.html is missing -- run `node site/build.mjs` first');
  process.exit(1);
}
if (!existsSync(CHROME)) {
  console.error(`ERROR: ${CHROME} not found -- set CHROME=/path/to/chrome`);
  process.exit(1);
}

const server = await serve(site);
const base = `http://127.0.0.1:${server.port}/`;
console.log(`serving _site/ at ${base}`);

for (const { preset, cards, lanes } of CASES) {
  console.log(`\n${preset}`);

  /* Phase one: open the preset by name, and take the page's own share link.
     `mode=break` is where the timeline lives, and the preset carries the events
     its story needs, so there is a run to draw. */
  const first = await load(`${base}?preset=${preset}&mode=break`);
  if (!first.ok) { fail(`${preset}: ${first.why}`); continue; }
  for (const line of first.console) fail(`${preset}: console said ${line}`);

  const href = /<a\b[^>]*\bid="permalink"[^>]*\bhref="([^"]*)"/i.exec(first.dom)?.[1];
  if (!href) {
    fail(`${preset}: the page published no permalink to follow`);
    continue;
  }
  if (!href.includes('#t=')) {
    fail(`${preset}: the permalink carries no #t= document: ${href}`);
    continue;
  }
  pass(`${preset}: permalink carries a #t= document (${href.length} chars)`);

  /* Phase two: throw the preset away and load that link cold. Everything below
     is drawn from the document the fragment carries. */
  const link = base + href.replace(/&amp;/g, '&').replace(/^\.?\//, '');
  const run = await load(link);
  if (!run.ok) { fail(`${preset}: ${run.why}`); continue; }
  for (const line of run.console) fail(`${preset}: console said ${line}`);
  if (run.console.length === 0) pass(`${preset}: the page wrote nothing to the console`);

  const drawn = countCards(run.dom);
  if (drawn === cards) pass(`${preset}: ${cards} node cards on the canvas`);
  else fail(`${preset}: expected ${cards} node cards, the page drew ${drawn}`);

  const drawnLanes = countLanes(run.dom);
  if (drawnLanes === lanes) pass(`${preset}: ${lanes} timeline lanes`);
  else fail(`${preset}: expected ${lanes} timeline lanes, the page drew ${drawnLanes}`);

  if (/<span class="chip-k">Outcome<\/span>/.test(run.dom)) {
    const word = /<span class="chip-k">Outcome<\/span><span class="chip-v">([^<]*)/.exec(run.dom)?.[1] ?? '?';
    pass(`${preset}: the readout names an outcome (${word.trim()})`);
  } else {
    fail(`${preset}: the readout carries no outcome chip`);
  }
}

/* ---------------- every mode renders ---------------- */

/* One canvas, four modes, and the thing that goes wrong in a browser and not
   in jsdom is a mode whose rail or panel throws on the way in. Each one is
   asked for by name and has to draw the canvas and say nothing. */
console.log('\nmodes');
for (const [query, mark, what] of [
  ['mode=build', 'class="app m-build', 'Build'],
  ['mode=break', 'class="app m-break', 'Break'],
  ['mode=configure&panel=dgmgrl', 'class="app m-configure', 'Configure'],
  ['mode=learn&lesson=failover-clocks', 'class="app m-learn', 'Learn'],
]) {
  const page = await load(`${base}?preset=classic&${query}`);
  if (!page.ok) { fail(`${what}: ${page.why}`); continue; }
  for (const line of page.console) fail(`${what}: console said ${line}`);
  if (!page.dom.includes(mark)) { fail(`${what} mode did not open`); continue; }
  const cards = countCards(page.dom);
  if (cards === 3) pass(`${what}: opens, draws the canvas, says nothing`);
  else fail(`${what}: expected 3 node cards, the page drew ${cards}`);
}

/* ---------------- the links the published page handed out ---------------- */

/* Every link in the handover document, the wiki page and the reading list is
   of this shape, and `?lang=cs` is the Czech reading of it. The application is
   English only, so that one has to say so and offer the page that is not --
   which is the legacy page, still shipped beside this one. */
console.log('\nlegacy links');
const legacy = await load(`${base}?sc=iso&lat=2&lang=cs#ch-clocks`);
if (!legacy.ok) {
  fail(`legacy link: ${legacy.why}`);
} else {
  for (const line of legacy.console) fail(`legacy link: console said ${line}`);

  const cards = countCards(legacy.dom);
  if (cards === 3) pass('legacy link: the classic 1+1+1 is drawn from the old query keys');
  else fail(`legacy link: expected 3 node cards from the old query keys, the page drew ${cards}`);

  if (/class="app m-break/.test(legacy.dom)) pass('legacy link: #ch-clocks opens Break mode');
  else fail('legacy link: #ch-clocks did not open Break mode');

  const href = /<a\b[^>]*class="strip-link"[^>]*\bhref="([^"]*)"/i.exec(legacy.dom)?.[1];
  if (href && href.startsWith('legacy/')) pass(`legacy link: ?lang=cs offers the Czech page (${href})`);
  else fail(`legacy link: ?lang=cs offered no link to legacy/ (got ${href ?? 'nothing'})`);
}

/* An asset the page asked for and did not get is a broken deploy, whatever the
   DOM looked like afterwards. */
const missing = [...new Set(server.missing)].filter((p) => p !== '/favicon.ico');
if (missing.length > 0) fail(`the page requested files the build does not have: ${missing.join(', ')}`);
else pass('every file the page requested was served');

server.close();

console.log('');
if (failures.length > 0) {
  console.error(`smoke FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('smoke passed');
