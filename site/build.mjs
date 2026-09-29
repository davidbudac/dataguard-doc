// Build the whole site into _site/.
//
//   _site/index.html          the application (app/, Vite + Preact)
//   _site/assets/index-*.js   its one hashed bundle, and one hashed stylesheet
//   _site/legacy/index.html   the published fragment, wrapped (build-legacy.mjs)
//   _site/diagrams/           the figures, shared by both
//
// Order is load-bearing: the app's build empties _site/, so it runs first and
// the legacy page is written into the tree it leaves behind.
//
// The last step is a guard rather than a convenience. The page is served under
//
//   default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:
//
// and a content security policy that strict turns an inline <script>, an
// onclick= attribute or a style= attribute into a control that silently does
// nothing in the browser while it works perfectly in the test runner. So the
// built HTML is read back and checked for all three: a build that would ship a
// page the policy breaks fails here instead.
//
// Run: node site/build.mjs   (site/publish.sh runs it before it deploys.)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
const out = join(root, '_site');

function run(cmd, args, cwd) {
  console.log(`==> ${cmd} ${args.join(' ')}`);
  // On Windows `npm` is `npm.cmd`, and Node spawns a .cmd only through a shell
  // (the desktop CI builds there). The arguments are this file's own literals.
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) fail(`${cmd} could not be run: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

/* ---------------- 1. the application ---------------- */

// `npm ci` only when the tree is not there: it deletes node_modules and
// reinstalls from the lockfile, which is right on a fresh checkout and a waste
// of a minute on every other run.
if (!existsSync(join(app, 'node_modules'))) {
  console.log('==> app/node_modules missing -- installing from the lockfile');
  run('npm', ['ci'], app);
}
run('npm', ['run', 'build'], app);

const indexPath = join(out, 'index.html');
if (!existsSync(indexPath)) fail('_site/index.html missing after the app build');

/* ---------------- 2. the published page, and the figures ---------------- */

run(process.execPath, [join(root, 'site', 'build-legacy.mjs')], root);

/* ---------------- 3. the policy guard ---------------- */

/**
 * Assert that a built page carries nothing the content security policy
 * forbids.
 *
 * Three findings, each one a thing that works in a test runner and fails in
 * the browser:
 *
 *   - a `<script>` with a body   -- script-src 'self' allows files, not text
 *   - an `on*=` attribute        -- an inline handler is inline script
 *   - a `style=` attribute       -- style-src 'self' allows files, not text
 *
 * The `<script>` check reads the tag's contents rather than trusting that a
 * `src` attribute means the tag is empty, because a tag with both is still an
 * inline script.
 */
function assertNoInline(html, label = 'the built page') {
  const problems = [];

  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(scriptRe)) {
    const attrs = m[1];
    const body = m[2];
    if (body.trim() !== '') {
      const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? '';
      /* A data block is not script: the browser never executes
         `type="application/json"`, and CSP does not stop it. */
      if (!/^(application|text)\/(json|ld\+json)$/i.test(type)) {
        problems.push(`inline <script>${type ? ` (type=${type})` : ''}: ${preview(body)}`);
      }
    }
  }

  for (const m of html.matchAll(/\son([a-z]+)\s*=/gi)) {
    problems.push(`inline handler: on${m[1]}=`);
  }

  for (const m of html.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    problems.push(`inline style: style="${preview(m[2])}"`);
  }

  if (problems.length > 0) {
    const seen = [...new Set(problems)];
    throw new Error(
      `${label} carries ${problems.length} thing(s) the content security policy forbids:\n`
      + seen.map((p) => `  ${p}`).join('\n'),
    );
  }
}

const preview = (s) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 72 ? `${one.slice(0, 72)}...` : one;
};

/* The guard is load-bearing, so prove it can fail before trusting it to pass:
   a page that would break under the policy has to be rejected, and an ordinary
   built page -- external script, JSON data block, no handlers -- must not be. */
for (const bad of [
  '<script>alert(1)</script>',
  '<button onclick="go()">go</button>',
  '<div style="color:red"></div>',
]) {
  let threw = false;
  try { assertNoInline(bad, 'the self-check'); } catch { threw = true; }
  if (!threw) fail(`the inline guard does not catch ${bad}`);
}
try {
  assertNoInline(
    '<script type="module" src="./a.js"></script>'
    + '<script type="application/json" id="d">{"a":1}</script>'
    + '<a data-style="x" href="#">x</a>',
    'the self-check',
  );
} catch (err) {
  fail(`the inline guard rejects a page it should accept: ${err.message}`);
}

const html = await readFile(indexPath, 'utf8');
try {
  assertNoInline(html, '_site/index.html');
} catch (err) {
  fail(err.message);
}

const bundle = /<script[^>]+src="([^"]*assets\/index-[^"]+\.js)"/i.exec(html)?.[1];
if (!bundle) fail('_site/index.html does not reference a hashed assets/index-*.js bundle');

console.log(`built _site/ -- app (${html.length} bytes of HTML, ${bundle}),`
  + ' legacy page at legacy/, figures at diagrams/');
