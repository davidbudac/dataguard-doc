#!/usr/bin/env bash
#
# Publish the Data Guard workbench to https://dataguard.davidbudac.cz/
#
# What goes out: the application (app/, built by Vite) at the root, and the
# page it replaced at /dataguard/legacy/ -- links published before the
# workbench existed point at that one.
#
# Publishing is this explicit push, never a side effect of `git push`. Nothing
# here reads git -- it ships the working tree, so you can preview an edit
# before committing it.
#
# Where it goes is not in the repository: DG_HOST and DG_DEST come from
# site/publish.env (gitignored; see site/publish.env.example) or from the
# environment, which wins. --dry-run needs neither.
#
# Usage:
#   site/publish.sh            build, deploy, verify
#   site/publish.sh --dry-run  build and verify locally, touch nothing remote
#
# The server side is one ssh session that unpacks into dataguard.new and then
# renames it into place, so a half-uploaded tree is never the live one.
#
# Requires: node, tar, ssh (key auth to $DG_HOST), curl. No rsync -- macOS
# ships openrsync, which rejects --chown/--chmod.

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

dry_run=0
[[ "${1:-}" == "--dry-run" ]] && dry_run=1

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. where to. The environment wins over site/publish.env; the file is
# gitignored because it names a host.
env_host="${DG_HOST:-}"; env_dest="${DG_DEST:-}"; env_owner="${DG_OWNER:-}"; env_url="${DG_URL:-}"
if [[ -f site/publish.env ]]; then
  # shellcheck disable=SC1091
  source site/publish.env
fi
DG_HOST="${env_host:-${DG_HOST:-}}"
DG_DEST="${env_dest:-${DG_DEST:-}}"
DG_OWNER="${env_owner:-${DG_OWNER:-}}"
DG_URL="${env_url:-${DG_URL:-https://dataguard.davidbudac.cz/}}"
if (( ! dry_run )); then
  [[ -n "$DG_HOST" && -n "$DG_DEST" ]] \
    || die "DG_HOST and DG_DEST are not set; copy site/publish.env.example to site/publish.env (or use --dry-run)"
fi

# --- 1. build. site/build.mjs builds the app, then the legacy page (whose
# builder still enforces the ASCII-only rule; see CLAUDE.md), then refuses to
# hand over an index.html carrying anything the content security policy forbids.
say "Building _site/"
command -v node >/dev/null || die "node not found"
rm -rf _site
node site/build.mjs

[[ -s _site/index.html ]] || die "_site/index.html missing or empty after build"
[[ -s _site/legacy/index.html ]] || die "_site/legacy/index.html missing or empty after build"

# --- 1b. three gates, in the order that fails fastest.
#
# The application's own suite is the engine's invariants and the interface's
# contracts; site/test.mjs is the same kind of assertion against the legacy
# fragment, which still ships; site/smoke.mjs is the built bundle in a real
# browser, which is the only one of the three that can catch a page that builds
# and does not run. A red assertion in any of them means something on this page
# contradicts a documented Oracle fact or does not work -- never deploy that.
say "Testing the application"
npm --prefix app run test

say "Testing the legacy models"
node --test site/test.mjs

say "Smoke-testing the built page in a browser"
node site/smoke.mjs

# --- 2. say out loud which version is going out.
# The working tree is what ships, so an uncommitted edit publishes silently
# unless we mention it. Warn, do not block: previewing uncommitted work on the
# real URL is a legitimate reason to run this.
rev="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
if ! git diff --quiet HEAD -- app site simulator diagrams 2>/dev/null; then
  printf '\033[1;33mNOTE:\033[0m app/, site/, simulator/ or diagrams/ has uncommitted changes; publishing the working-tree version, not %s.\n' "$rev"
  rev="${rev}+dirty"
fi
say "Publishing $(wc -c < _site/index.html | tr -d ' ') bytes from ${rev}"

if (( dry_run )); then
  say "--dry-run: built and tested, nothing deployed"
  say "Preview locally: python3 -m http.server -d _site 8000"
  exit 0
fi

# --- 3. ship it. One ssh session: unpack beside the live tree, then rename in.
say "Deploying to ${DG_HOST}:${DG_DEST}"
COPYFILE_DISABLE=1 tar -C _site --no-xattrs --exclude '.DS_Store' -czf - . \
  | ssh -o BatchMode=yes "$DG_HOST" "set -eu
      dest='${DG_DEST}'
      rm -rf \"\${dest}.new\"
      mkdir -p \"\${dest}.new\"
      tar -C \"\${dest}.new\" -xzf -
      test -s \"\${dest}.new/index.html\"
      if [ -n '${DG_OWNER}' ]; then chown -R '${DG_OWNER}' \"\${dest}.new\"; fi
      find \"\${dest}.new\" -type d -exec chmod 755 {} +
      find \"\${dest}.new\" -type f -exec chmod 644 {} +
      rm -rf \"\${dest}.old\"
      if [ -d \"\${dest}\" ]; then mv \"\${dest}\" \"\${dest}.old\"; fi
      mv \"\${dest}.new\" \"\${dest}\"
      rm -rf \"\${dest}.old\"
    "

# --- 4. verify the public URL, not just the upload.
#
# What is compared is the bundle, not the page. The HTML is a few hundred bytes
# of head that Cloudflare may minify, gzip or serve with an injected header,
# and a byte-for-byte comparison of it fails for reasons that have nothing to
# do with what shipped. The hashed asset is the deploy: its name changes with
# every byte of source, the served HTML names the one it wants, and if that
# file comes back byte-equal to the local build then the code that is live is
# the code that was built here.
#
# Cache-bust: Cloudflare fronts the origin and will happily serve the old page.
say "Verifying ${DG_URL}"
probe="$(curl -sS -o /tmp/dg-verify.html -w '%{http_code}' \
  -H 'Cache-Control: no-cache' "${DG_URL}?cb=$$" || echo '000')"
[[ "$probe" == "200" ]] || die "expected HTTP 200 from ${DG_URL}, got ${probe}"

# The legacy page still ships, and every published link points at it.
legacy_code="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Cache-Control: no-cache' "${DG_URL}legacy/?cb=$$" || echo '000')"
[[ "$legacy_code" == "200" ]] || die "expected HTTP 200 from ${DG_URL}legacy/, got ${legacy_code}"

bundle="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /tmp/dg-verify.html | head -1)"
[[ -n "$bundle" ]] || die "the served page references no hashed assets/index-*.js"
[[ -f "_site/${bundle}" ]] || die "the served page asks for ${bundle}, which this build did not produce"

# No Accept-Encoding is sent, so what comes back is the file itself and `cmp`
# is comparing like with like. Keep it that way if you touch this.
asset_code="$(curl -sS -o /tmp/dg-verify.js -w '%{http_code}' \
  -H 'Cache-Control: no-cache' "${DG_URL}${bundle}?cb=$$" || echo '000')"
[[ "$asset_code" == "200" ]] || die "expected HTTP 200 for ${bundle}, got ${asset_code}"
cmp -s /tmp/dg-verify.js "_site/${bundle}" \
  || die "the served ${bundle} is not the one built here"

served_bytes="$(wc -c < /tmp/dg-verify.js | tr -d ' ')"
rm -f /tmp/dg-verify.html /tmp/dg-verify.js

say "Published: ${DG_URL} (HTTP 200, ${bundle}, ${served_bytes} bytes, byte-equal to the build)"
