#!/usr/bin/env bash
#
# Publish the FSFO simulator to https://davidbudac.cz/dataguard/
#
# Replaces the old GitHub Pages deploy (.github/workflows/pages.yml, removed):
# the repo is private now, so publishing is this explicit push instead of a
# side effect of `git push`. Nothing here reads git -- it ships the working
# tree, so you can preview an edit before committing it.
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

DG_HOST="${DG_HOST:-root@dbhetz-ubu26}"
DG_DEST="${DG_DEST:-/var/www/dataguard}"
DG_OWNER="${DG_OWNER:-db:db}"
DG_URL="${DG_URL:-https://davidbudac.cz/dataguard/}"

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

dry_run=0
[[ "${1:-}" == "--dry-run" ]] && dry_run=1

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. build (site/build.mjs also enforces the ASCII-only rule; see CLAUDE.md)
say "Building _site/"
command -v node >/dev/null || die "node not found"
rm -rf _site
node site/build.mjs

[[ -s _site/index.html ]] || die "_site/index.html missing or empty after build"

# --- 2. say out loud which version is going out.
# The working tree is what ships, so an uncommitted edit publishes silently
# unless we mention it. Warn, do not block: previewing uncommitted work on the
# real URL is a legitimate reason to run this.
rev="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
if ! git diff --quiet HEAD -- simulator/fsfo-simulator.html 2>/dev/null; then
  printf '\033[1;33mNOTE:\033[0m simulator/fsfo-simulator.html has uncommitted changes; publishing the working-tree version, not %s.\n' "$rev"
  rev="${rev}+dirty"
fi
say "Publishing $(wc -c < _site/index.html | tr -d ' ') bytes from ${rev}"

if (( dry_run )); then
  say "--dry-run: built only, nothing deployed"
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
      chown -R '${DG_OWNER}' \"\${dest}.new\"
      find \"\${dest}.new\" -type d -exec chmod 755 {} +
      find \"\${dest}.new\" -type f -exec chmod 644 {} +
      rm -rf \"\${dest}.old\"
      if [ -d \"\${dest}\" ]; then mv \"\${dest}\" \"\${dest}.old\"; fi
      mv \"\${dest}.new\" \"\${dest}\"
      rm -rf \"\${dest}.old\"
    "

# --- 4. verify the public URL, not just the upload.
# Cache-bust: Cloudflare fronts the origin and will happily serve the old page.
say "Verifying ${DG_URL}"
local_bytes="$(wc -c < _site/index.html | tr -d ' ')"
# No Accept-Encoding is sent, so size_download is the real byte count and can be
# compared against the build. Keep it that way if you touch this.
probe="$(curl -sS -o /tmp/dg-verify.html \
  -w '%{http_code} %{size_download}' \
  -H 'Cache-Control: no-cache' "${DG_URL}?cb=$$" || echo '000 0')"
code="${probe%% *}"
live_bytes="${probe##* }"

[[ "$code" == "200" ]] || die "expected HTTP 200 from ${DG_URL}, got ${code}"
if [[ "$live_bytes" != "$local_bytes" ]]; then
  die "size mismatch: served ${live_bytes} bytes, built ${local_bytes}"
fi
grep -q '<script' /tmp/dg-verify.html || die "served page has no <script> block"
rm -f /tmp/dg-verify.html

say "Published: ${DG_URL} (${live_bytes} bytes, HTTP ${code})"
