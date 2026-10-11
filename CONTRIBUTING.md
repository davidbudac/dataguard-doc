# Contributing

Thanks for looking. This is a one-person project with an unusually strict
accuracy rule, so a few things up front.

## The rule

Every statement the workbench makes about Oracle is one of three kinds:
arithmetic over user input, a **documented** fact carrying a citation from
`app/src/engine/citations.ts` (docs.oracle.com only), or a **model** labelled
as such on screen. A pull request that adds an Oracle claim adds the citation
first. The full rules, including which sources are forbidden for which fact,
are in [`AGENTS.md`](AGENTS.md) under *Accuracy rules*; the verified fact sheet
is [`app/design/facts.md`](app/design/facts.md).

## Before you open a pull request

```bash
./site/check.sh          # the whole local CI
./site/check.sh --quick  # typecheck and tests only
```

Enable the pre-push hook once with `git config core.hooksPath .githooks` and
the quick form runs by itself.

Other conventions, enforced by tests where they can be:

- `app/src/engine` stays pure: no DOM, no I/O, no clock, no `Math.random`.
- No inline `<script>`, `on*=` handler or `style=` attribute anywhere; the
  page runs under `script-src 'self'; style-src 'self'`.
- `simulator/fsfo-simulator.html` is frozen and pure ASCII (see
  [`CLAUDE.md`](CLAUDE.md) for why and how to escape). New work goes in `app/`.
- English only, both pages.
- A golden that moves says in the commit message whether it recorded geometry
  or a domain fact.

## Reporting a wrong fact

Open an issue with the Oracle page that contradicts the workbench and the
sentence on it. That is the shape every finding in `docs/fact-checks/` has,
and it is what makes a fix reviewable.
