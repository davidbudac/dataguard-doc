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
