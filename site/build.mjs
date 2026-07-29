// Wrap the head-less simulator fragment into a standalone HTML page.
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
const out = join(root, '_site');

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
const title = titleMatch ? titleMatch[1].trim() : 'Fast-start failover simulator';
const body = titleMatch ? fragment.replace(titleMatch[0], '') : fragment;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Interactive second-by-second simulator of Oracle Data Guard fast-start failover.">
<title>${title}</title>
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
await cp(join(root, 'diagrams'), join(out, 'diagrams'), { recursive: true });

console.log(`built _site/index.html (${page.length} bytes), title: ${title}`);
