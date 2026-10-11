#!/usr/bin/env bash
#
# Local CI -- the only CI this repository has.
#
#   site/check.sh            typecheck, the application suite, the legacy tests,
#                            the site build with its two guards, the browser smoke test
#   site/check.sh --quick    stop after the tests (what .githooks/pre-push runs)
#
# Exits non-zero at the first failing gate. The smoke test needs headless
# Chrome (CHROME=/path/to/chrome; default /usr/bin/google-chrome) and is
# skipped, loudly, where there is none.

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

quick=0
[[ "${1:-}" == "--quick" ]] && quick=1

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

command -v node >/dev/null || { echo "ERROR: node not found" >&2; exit 1; }
if [[ ! -d app/node_modules ]]; then
  say "Installing app/ (node_modules missing)"
  npm --prefix app ci
fi

say "Typecheck"
npm --prefix app run --silent typecheck

say "Application suite"
npm --prefix app test --silent

say "Legacy models"
node --test site/test.mjs

if (( quick )); then
  say "OK (quick: build and browser smoke skipped)"
  exit 0
fi

say "Site build (ASCII guard, inline-script/style guard)"
node site/build.mjs

chrome="${CHROME:-/usr/bin/google-chrome}"
if [[ -x "$chrome" ]]; then
  say "Browser smoke test"
  CHROME="$chrome" node site/smoke.mjs
else
  say "SKIPPED browser smoke test: no Chrome at $chrome (set CHROME=/path/to/chrome)"
fi

say "OK"
