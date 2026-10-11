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
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, '_site');
const CHROME = process.env['CHROME'] ?? '/usr/bin/google-chrome';
/** One page load's ceiling. Past this the browser is not slow, it is stuck. */
const TIMEOUT_MS = 90_000;
/** The HTTP probe's ceiling: a one-line page over loopback either loads at
    once or the browser cannot fetch over HTTP at all on this machine. */
const PROBE_MS = 20_000;

/* The two links this checks. `#t=` is the share link's own spelling -- the
   compressed document in the fragment -- and it is produced by the page
   itself in phase one rather than hand-written here, so the check is a round
   trip through the real encoder and the real decoder rather than a fixture
   that can drift away from both.
   The counts are what these two configurations are: the classic 1+1+1 is a
   primary, a standby and an observer; Example 5-2 adds a far sync instance in
   front of the standby. Every member and every observer is a card on the
   canvas and a lane on the timeline; the application beside the primary is
   one card more, and its point of view three lanes more. Simulate draws the
   canvas above the lanes, and every lane group carries a card of its own
   (`ln-card`), so the two kinds are counted apart rather than summed. */
const CASES = [
  { preset: 'classic', cards: 4, lanes: 7 },
  { preset: 'far-sync-zero-loss', cards: 5, lanes: 8 },
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
    /* A synthetic page for the probe below: it never touches the disk, so a
       browser that cannot show it cannot fetch over HTTP, full stop. */
    if (rel === '/__probe') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>probe</title><p id="probe">smoke-probe-ok</p>');
      return;
    }
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
function load(url, timeoutMs = TIMEOUT_MS) {
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
    const killer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);

    const done = (result) => {
      clearTimeout(killer);
      rmSync(profile, { recursive: true, force: true });
      resolve(result);
    };

    child.on('error', (e) => done({ ok: false, dom: '', console: [], why: `chrome could not run: ${e.message}` }));
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL') {
        done({ ok: false, dom: out, console: [], why: `chrome did not finish within ${timeoutMs / 1000} s` });
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
   `class="tp-node"` or Detailed timeline's `ln-card`, and the lookahead is what keeps `tp-nodes`, the group
   that holds them, out of the count. */
/* Cards on the canvas (`tp-node`). A view with no canvas on screen -- the
   lanes with the drawing folded away -- is counted by its lane cards instead. */
const countCanvasCards = (dom) => [...dom.matchAll(/class="tp-node(?=["\s])/g)].length;
const countLaneCards = (dom) => [...dom.matchAll(/class="ln-card(?=["\s])/g)].length;
const countCards = (dom) => countCanvasCards(dom) || countLaneCards(dom);
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
let base = `http://127.0.0.1:${server.port}/`;
console.log(`serving _site/ at ${base}`);

/* ---------------- can this browser fetch over HTTP at all? ---------------- */

/* Some machines' headless Chrome opens the TCP connection to a loopback server
   and then never sends the request (seen with Chrome 151: the netlog shows the
   socket closed with "Cert verifier changed" and the navigation stalls until
   the timeout, for a one-line page and for https://example.com alike). That
   is the browser, not the site -- but a smoke check that reports it as the
   site's failure is worse than none. So: probe with a synthetic page first.
   If the probe fails, fall back to the same bundle inlined into one HTML file
   and loaded over file://, which the module loader accepts because there is
   nothing left to import; asset serving is then verified statically instead. */
let inlineDir = null;
const probe = await load(`${base}__probe`, PROBE_MS);
if (probe.ok && probe.dom.includes('smoke-probe-ok')) {
  pass('headless Chrome fetches over HTTP');
} else {
  console.error(`  NOTE  headless Chrome could not load a one-line page over HTTP (${probe.why ?? 'empty DOM'});`);
  console.error('        checking the same bundle inlined into one file over file:// instead.');
  console.error('        (This is the browser on this machine, not the site -- an interactive');
  console.error('        Chrome pointed at the URL above renders it. Asset serving is checked statically.)');
  const html = readFileSync(join(site, 'index.html'), 'utf8');
  const cssRef = /<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/.exec(html);
  const jsRef = /<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/.exec(html);
  if (!cssRef || !jsRef) {
    fail('index.html does not reference one stylesheet and one module bundle');
  } else {
    const css = readFileSync(join(site, cssRef[1]), 'utf8');
    const js = readFileSync(join(site, jsRef[1]), 'utf8').replace(/<\/script>/g, '<\\/script>');
    const one = html
      .replace(cssRef[0], `<style>${css}</style>`)
      .replace(jsRef[0], `<script type="module">${js}</script>`);
    inlineDir = mkdtempSync(join(tmpdir(), 'dg-smoke-inline-'));
    writeFileSync(join(inlineDir, 'index.html'), one);
    base = pathToFileURL(join(inlineDir, 'index.html')).href;
    pass(`inlined ${cssRef[1]} and ${jsRef[1]} into ${base}`);
  }
}

for (const { preset, cards, lanes } of CASES) {
  console.log(`\n${preset}`);

  /* Phase one: open the preset by name, and take the page's own share link.
     `mode=break` is where the timeline lives, and the preset carries the events
     its story needs, so there is a run to draw. */
  const first = await load(`${base}?preset=${preset}&mode=simulate`);
  if (!first.ok) { fail(`${preset}: ${first.why}`); continue; }
  for (const line of first.console) fail(`${preset}: console said ${line}`);

  /* The canonical address of what is on screen. Share is one button now: it
     copies the link and then shows it as an anchor, so before any click the
     address lives on the button as `data-permalink` -- which is what a dumped
     DOM can read and a machine can follow. */
  const raw = /\bdata-permalink="([^"]+)"/i.exec(first.dom)?.[1]
    ?? /<a\b[^>]*\bid="permalink"[^>]*\bhref="([^"]*)"/i.exec(first.dom)?.[1];
  if (!raw) {
    fail(`${preset}: the page published no permalink to follow`);
    continue;
  }
  /* An attribute in a dumped DOM, so `&` arrives as `&amp;`. */
  const href = raw.replace(/&amp;/g, '&');
  /* An untouched preset is its own address: `?preset=` loads the whole
     document, events and all, so the page writes no `#t=` beside it and the
     link stays short enough to read. Either spelling is a permalink; what
     matters is that phase two can load it cold and get the same page.
     The `#t=` round trip through the real encoder and the real decoder is
     checked on the legacy link below, whose document comes from no preset. */
  if (href.includes('#t=')) {
    pass(`${preset}: permalink carries a #t= document (${href.length} chars)`);
  } else if (new RegExp(`[?&]preset=${preset}(?:&|$)`).test(href)) {
    if (href.length < 200) pass(`${preset}: untouched, the permalink is the preset (${href})`);
    else fail(`${preset}: the permalink names the preset and is still ${href.length} chars: ${href}`);
  } else {
    fail(`${preset}: the permalink carries neither a #t= document nor the preset: ${href}`);
    continue;
  }

  /* Phase two: throw the preset away and load that link cold. Everything below
     is drawn from the document the query and the fragment carry. */
  const link = base + href.replace(/^\.?\//, '');
  const run = await load(link);
  if (!run.ok) { fail(`${preset}: ${run.why}`); continue; }
  for (const line of run.console) fail(`${preset}: console said ${line}`);
  if (run.console.length === 0) pass(`${preset}: the page wrote nothing to the console`);

  const drawn = countCards(run.dom);
  if (drawn === cards) pass(`${preset}: ${cards} node cards on the canvas`);
  else fail(`${preset}: expected ${cards} node cards, the page drew ${drawn}`);

  /* The lanes carry one card per member, observer and application host too;
     when both are on screen they must agree. */
  const laneCards = countLaneCards(run.dom);
  if (laneCards === 0 || laneCards === cards) pass(`${preset}: ${laneCards} lane cards beside the lanes`);
  else fail(`${preset}: expected ${cards} lane cards, the page drew ${laneCards}`);

  const drawnLanes = countLanes(run.dom);
  if (drawnLanes === lanes) pass(`${preset}: ${lanes} timeline lanes`);
  else fail(`${preset}: expected ${lanes} timeline lanes, the page drew ${drawnLanes}`);

  const outcome = /<span class="ln-vd-k">Outcome<\/span><span class="ln-vd-v">([^<]*)/.exec(run.dom)
    ?? /<span class="chip-k">Outcome<\/span><span class="chip-v">([^<]*)/.exec(run.dom)
    ?? /<span class="sb-ro-i\b[^"]*"[^>]*><span class="sb-ro-k">Outcome<\/span>\s*<span class="sb-ro-v">([^<]*)/.exec(run.dom);
  if (outcome) pass(`${preset}: the readout names an outcome (${outcome[1].trim()})`);
  else fail(`${preset}: the readout carries no outcome`);

}

/* ---------------- every mode renders ---------------- */

/* One canvas, four modes, and the thing that goes wrong in a browser and not
   in jsdom is a mode whose rail or panel throws on the way in. Each one is
   asked for by name and has to draw its cards and say nothing. */
console.log('\nmodes');
for (const [query, mark, what] of [
  ['mode=topology', 'class="app m-build', 'Topology'],
  ['mode=scenario', 'class="app m-scenario', 'Scenario'],
  ['mode=simulate', 'class="app m-break', 'Simulate'],
  ['mode=outcome', 'class="app m-break', 'Simulate (mode=outcome, the older spelling)'],
  ['mode=config&panel=dgmgrl', 'class="app m-configure', 'Config'],
  ['mode=learn&lesson=failover-clocks', 'class="app m-learn', 'Learn'],
]) {
  const page = await load(`${base}?preset=classic&${query}`);
  if (!page.ok) { fail(`${what}: ${page.why}`); continue; }
  for (const line of page.console) fail(`${what}: console said ${line}`);
  if (!page.dom.includes(mark)) { fail(`${what} mode did not open`); continue; }
  const cards = countCards(page.dom);
  if (cards === 4) pass(`${what}: opens, draws its cards, says nothing`);
  else fail(`${what}: expected 4 node cards, the page drew ${cards}`);
}

/* ---------------- the links the published page handed out ---------------- */

/* Every link in the handover document and the wiki page is of this shape.
   Some still carry `?lang=cs` from when the page had a Czech reading; the
   application is English only and upgrades them like any other. */
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

  if (/Upgraded an older link\./.test(legacy.dom)) pass('legacy link: ?lang=cs upgrades like any other old link');
  else fail('legacy link: ?lang=cs did not upgrade as an old link');

  /* The `#t=` round trip, in a real browser: this document came from the old
     query keys rather than from a preset, so there is no shorter way to say it
     and the permalink has to carry the whole compressed thing. Following it
     cold is the one check that exercises the page's own CompressionStream on
     the way out and DecompressionStream on the way back in. */
  const perma = /\bdata-permalink="([^"]+)"/i.exec(legacy.dom)?.[1]?.replace(/&amp;/g, '&');
  if (!perma || !perma.includes('#t=')) {
    fail(`legacy link: the upgraded document published no #t= permalink (got ${perma ?? 'nothing'})`);
  } else {
    const cold = await load(base + perma.replace(/^\.?\//, ''));
    if (!cold.ok) {
      fail(`legacy link, reloaded: ${cold.why}`);
    } else {
      for (const line of cold.console) fail(`legacy link, reloaded: console said ${line}`);
      const drawn = countCards(cold.dom);
      if (drawn === 3) pass(`legacy link: its #t= permalink reloads to the same 3 cards (${perma.length} chars)`);
      else fail(`legacy link: its #t= permalink drew ${drawn} node cards, expected 3`);
    }
  }
}

/* An asset the page asked for and did not get is a broken deploy, whatever the
   DOM looked like afterwards. Over file:// nothing is requested, so the check
   is static: every asset index.html names must exist in the tree. */
if (inlineDir === null) {
  const missing = [...new Set(server.missing)].filter((p) => p !== '/favicon.ico');
  if (missing.length > 0) fail(`the page requested files the build does not have: ${missing.join(', ')}`);
  else pass('every file the page requested was served');
} else {
  const html = readFileSync(join(site, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
  const absent = refs.filter((r) => !existsSync(join(site, r)));
  if (refs.length === 0) fail('index.html references no assets/ file');
  else if (absent.length > 0) fail(`index.html references files the build does not have: ${absent.join(', ')}`);
  else pass(`every asset index.html references exists (${refs.join(', ')})`);
  if (!existsSync(join(site, 'legacy', 'index.html'))) fail('_site/legacy/index.html is missing');
  rmSync(inlineDir, { recursive: true, force: true });
}

server.close();

console.log('');
if (failures.length > 0) {
  console.error(`smoke FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('smoke passed');
