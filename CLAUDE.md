# dataguard_doc — agent instructions

See [AGENTS.md](AGENTS.md) for the file inventory, accuracy rules, visual language,
PNG regeneration, and the artifact republish flow.

## Keep `simulator/fsfo-simulator.html` pure ASCII

**Never write a raw non-ASCII character into that file.** No em dashes, middle dots,
`×`, curly quotes, `≤`, `≈`, arrows — nothing above U+007E.

**Why:** the file is a head-less fragment (it starts at `<title>`, with no `<!doctype>`,
`<html>`, or `<head>`, because the Artifact publisher supplies the wrapper). With no
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

`site/build.mjs` enforces this: it exits non-zero, naming the offending lines, on
any byte above U+007E. Since `site/publish.sh` builds before it deploys, a
non-ASCII fragment cannot reach davidbudac.cz/dataguard. To check by hand before
committing:

```bash
LC_ALL=C grep -nP '[^\x00-\x7F]' simulator/fsfo-simulator.html && echo "NON-ASCII FOUND" || echo "ASCII clean"
```

Note `grep -P` is unavailable on a stock macOS grep (it works here only because
`grep` is ugrep) — `node site/build.mjs` is the portable check.

This rule is specific to the simulator fragment. Markdown files (`AGENTS.md`,
`diagrams/README.md`) and SVG figures declare their own encoding and may use real
Unicode characters normally.
