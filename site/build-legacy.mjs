// Wrap the head-less simulator fragment into a standalone HTML page.
//
// This is the PUBLISHED page -- the one every link in the handover document
// and the wiki page points at. It is no longer the application at /dataguard/:
// the Vite app is, and this one keeps serving from /dataguard/legacy/ so those
// links keep working. Nothing in
// the wrapping logic changed with the move; only where it is written did (and
// diagrams/, which both pages share, is copied to _site/diagrams so the
// og:image and the figures resolve for either of them).
//
// Run through site/build.mjs, which builds the app first: the app's build
// empties _site/, so building this one before it would throw the page away.
//
// simulator/fsfo-simulator.html is a fragment: it starts at <title> with no
// doctype/html/head, because the Artifact publisher used to supply the wrapper.
// That constraint is why the fragment must stay pure ASCII (see CLAUDE.md).
// Here we supply the wrapper ourselves: doctype, <meta charset>, viewport, and
// the <title> lifted out of the fragment into <head> where it belongs.

import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site', 'legacy');
const diagrams = join(root, '_site', 'diagrams');

const fragment = await readFile(join(root, 'simulator/fsfo-simulator.html'), 'utf8');

// Enforce the ASCII-only rule here rather than in CI, so it is impossible to
// publish a fragment that would render as mojibake. This guard used to live in
// the GitHub Pages workflow; that workflow is gone (we deploy to the VPS now),
// and the rule has been broken twice before, so it belongs on the build path
// every publish goes through. Deliberately not `grep -P`: that is unavailable on
// a stock macOS grep, and a guard that silently errors out is worse than none.
const offenders = [...fragment].reduce((acc, ch, i) => {
  if (ch.codePointAt(0) > 0x7e) {
    const line = fragment.slice(0, i).split('\n').length;
    if (!acc.some((o) => o.line === line)) acc.push({ line, ch });
  }
  return acc;
}, []);
if (offenders.length) {
  const detail = offenders
    .slice(0, 10)
    .map(({ line, ch }) => {
      const hex = ch.codePointAt(0).toString(16).padStart(4, '0').toUpperCase();
      return `  line ${line}: ${JSON.stringify(ch)} (U+${hex})`;
    })
    .join('\n');
  console.error(
    `simulator/fsfo-simulator.html contains ${offenders.length} line(s) with ` +
      `non-ASCII characters. See CLAUDE.md: escape by context (HTML entity, ` +
      `\\uXXXX in <script>, plain ASCII in comments).\n${detail}`,
  );
  process.exit(1);
}

const titleMatch = fragment.match(/<title>([\s\S]*?)<\/title>/i);
const title = titleMatch ? titleMatch[1].trim() : 'Data Guard configuration';
const body = titleMatch ? fragment.replace(titleMatch[0], '') : fragment;

// One description constant so <meta name="description"> and og:description
// cannot drift apart. SITE is the canonical URL; og:image must be absolute,
// and diagrams/ is copied into _site below, so the figure serves from the
// same tree the page does.
// The application at /dataguard/ is the canonical reading of this document now,
// so the canonical link keeps pointing there; SITE stays the site root because
// og:image and the figures live beside it in diagrams/.
const SITE = 'https://dataguard.davidbudac.cz/';
const HERE = `${SITE}legacy/`;
const DESC =
  'Interactive Oracle Data Guard configuration tool: broker properties, failover clocks, ' +
  'commit cost under SYNC/FASTSYNC/ASYNC, ReopenSecs and MaxFailure, the connect string, ' +
  'and the DGMGRL commands that set it all, redrawn live.';
// Inline SVG favicon: violet (--vi) rounded square with a white axis-and-tick
// mark. Data URI keeps the page free of extra requests; '#' must be %23 and
// angle brackets %3C/%3E or the URI is cut short. Safari <17 ignores SVG
// favicons and 404s on /favicon.ico outside the nginx block -- accepted.
const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E" +
  "%3Crect width='16' height='16' rx='3' fill='%236D5AE6'/%3E" +
  "%3Cpath d='M2.5 11.5h11M6 3.5v10' stroke='%23fff' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E";

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${DESC}">
<title>${title}</title>
<link rel="canonical" href="${SITE}">
<link rel="icon" href="${ICON}">
<meta name="theme-color" content="#F4F6F8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0A0E13" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="article">
<meta property="og:site_name" content="davidbudac.cz">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${HERE}">
<meta property="og:image" content="${SITE}diagrams/fsfo-timeline-crash.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="560">
<meta property="og:image:alt" content="Swimlane timeline of a Data Guard fast-start failover after a primary host crash: observer detection, the FastStartFailoverThreshold countdown, and the standby opening read-write.">
<meta name="twitter:card" content="summary_large_image">
<style>
/* The fragment paints --bg on .fsfo only, which is capped at 1240px and centred,
   so the page gutters fall back to the browser default. As the host page we own
   html/body: pick up the same token (the fragment defines it on :root, including
   its dark and [data-theme] redefinitions) so the gutters follow the theme.
   color-scheme keeps scrollbars and form controls in step. */
html,body{margin:0;background:var(--bg,#F4F6F8);color-scheme:light dark}
</style>
</head>
<body>
${body.trim()}
</body>
</html>
`;

await mkdir(out, { recursive: true });
await writeFile(join(out, 'index.html'), page, 'utf8');
/* One copy of the figures, at _site/diagrams, for both pages: the og:image URL
   above is absolute against the site root, and the legacy page's own
   references are relative to it. */
await cp(join(root, 'diagrams'), diagrams, { recursive: true });

console.log(`built _site/legacy/index.html (${page.length} bytes), title: ${title}`);
