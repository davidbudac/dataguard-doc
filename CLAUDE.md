# dataguard_doc — agent instructions

See [AGENTS.md](AGENTS.md) for the file inventory, accuracy rules, visual language,
PNG regeneration, and the publishing flow.

Two pages live here. The one being worked on is the workbench in `app/`
(TypeScript + Vite + Preact), served at `/dataguard/`. Frozen beside it is the
single-file legacy fragment in `simulator/`, served at `/dataguard/legacy/`. The
rules below are split accordingly: the ASCII rule is the **legacy fragment's
alone**.

## Keep `simulator/fsfo-simulator.html` pure ASCII

**Never write a raw non-ASCII character into that file.** No em dashes, middle dots,
`×`, curly quotes, `≤`, `≈`, arrows — nothing above U+007E.

**Why:** the file is a head-less fragment (it starts at `<title>`, with no `<!doctype>`,
`<html>`, or `<head>`, because `site/build-legacy.mjs` supplies the wrapper). With no
`<meta charset="utf-8">` in the first bytes, any renderer that does not declare UTF-8
out of band falls back to windows-1252 and each UTF-8 byte pair shows as mojibake —
`Timeline — primary crash` renders as `Timeline â€” primary crash`. Adding a `<meta>`
tag is not the fix: head tags do not belong in the fragment. This has been fixed twice
and reintroduced twice by later edits that typed a plain em dash.

**How to apply** — escape by context, because the right escape differs per region:

| Region | Escape | Example |
|---|---|---|
| HTML markup | named entity | `&mdash;` `&middot;` `&times;` `&rsquo;` `&le;` `&asymp;` `&ndash;` `&minus;` `&rarr;` |
| JS string literals in `<script>` | `\uXXXX` | `'Timeline — primary crash'` |
| CSS and JS **comments** | plain ASCII | `--`, `-`, `x`, `'`, `<=`, `~` |

Entities do **not** decode inside `<script>` or `<style>` — `&mdash;` there renders as
the literal seven characters. That is why JS gets `\uXXXX` and comments get ASCII.

**`site/build-legacy.mjs` enforces this** — it exits non-zero, naming the offending
lines, on any byte above U+007E. `site/build.mjs` runs it, and `site/publish.sh`
builds before it deploys, so a non-ASCII fragment cannot reach
dataguard.davidbudac.cz/legacy/. To check by hand before committing:

```bash
LC_ALL=C grep -nP '[^\x00-\x7F]' simulator/fsfo-simulator.html && echo "NON-ASCII FOUND" || echo "ASCII clean"
```

Note `grep -P` is unavailable on a stock macOS grep (it works here only because
`grep` is ugrep) — `node site/build.mjs` is the portable check.

This rule is specific to the legacy fragment. `app/`, the Markdown files
(`AGENTS.md`, `diagrams/README.md`) and the SVG figures declare their own encoding
and use real Unicode characters normally.

**The Czech translation is why this rule did not have to bend.** `simulator/i18n/cs.json`
is normal UTF-8 with real accented characters, and `site/build-legacy.mjs` inlines it
into the built page's `<head>`, where the charset *is* declared. The fragment carries
only English. So: never add a Czech string to the fragment, in any escaping —
translations belong in the catalog. See AGENTS.md for the mechanism.

## The application in `app/`

Commands, from `app/`: `npm run dev` · `npm run build` (typecheck then Vite, output
straight into `../_site/`) · `npm test` (vitest) · `npm run typecheck`. The whole
site is `node site/build.mjs`; publishing is `./site/publish.sh`, and **only when
the user asks**.

- **The engine is pure.** Nothing under `app/src/engine` may touch the DOM, do I/O,
  read a clock or call `Math.random`; the UI imports from `engine/index.ts` and never
  from a module deeper in. Two tests enforce both halves, so a stray import fails the
  suite rather than the browser.
- **Accuracy is labelled in the type system.** Every derived quantity that is not
  arithmetic over user input is a `Claim` with a `basis` — `documented` (and then a
  citation from `app/src/engine/citations.ts` is mandatory), `doc-later`, `conflict`,
  `inferred` or `model` (and then a note is mandatory, and the UI renders it as this
  page's model). Add the citation before the claim. The accuracy rules in AGENTS.md
  are what the catalogue encodes, including which sources are *forbidden* for which
  fact.
- **No inline style, no inline script.** The page is built for
  `script-src 'self'; style-src 'self'`, so there are no `style` props anywhere —
  dynamic geometry goes through SVG presentation attributes, dynamic theming through
  classes, and `el.style.setProperty` through a ref is the single escape hatch.
  `site/build.mjs` fails the build on an inline `<script>`, an `on*=` handler or a
  `style=` attribute in the built HTML.
- **English only.** Czech belongs to the legacy page and the handover documents.
- `app/` is ordinary UTF-8: write `—` and `×` as themselves, never as entities or
  `\uXXXX` escapes.
