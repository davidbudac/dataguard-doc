#!/usr/bin/env bash
# Optional SQL*Plus wrapper. Supply wallet aliases, or no arguments for local OS auth.
# Keep dataguard-topology.sql beside this script.
# Usage: bash collect-dataguard.sh PRIMARY_WALLET STANDBY_WALLET > topology.txt
# Local: bash collect-dataguard.sh > local-member.txt
# Each connection is limited to DG_COLLECT_TIMEOUT seconds (default 120): with
# the timeout command where there is one, else a watchdog in this shell (macOS
# ships no timeout). An unresolvable alias can otherwise hang.
set -euo pipefail
collector_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
command -v sqlplus >/dev/null || { echo 'SQL*Plus is required.' >&2; exit 1; }
[[ -r "$collector_dir/dataguard-topology.sql" ]] || { echo 'Missing dataguard-topology.sql beside this script.' >&2; exit 1; }
for collector_alias in "$@"; do
  [[ "$collector_alias" =~ ^[a-zA-Z0-9_.-]+$ ]] || { echo 'Use wallet aliases only, without passwords or connect descriptors.' >&2; exit 1; }
done
collector_timeout=${DG_COLLECT_TIMEOUT:-120}
[[ "$collector_timeout" =~ ^[1-9][0-9]*$ ]] || { echo 'DG_COLLECT_TIMEOUT must be a positive number of seconds.' >&2; exit 1; }
collector_runner=()
if command -v timeout >/dev/null; then collector_runner=(timeout "$collector_timeout"); fi

# Run a command under the limit; 124 when it ran out, as timeout(1) reports it.
run_limited() {
  if (( ${#collector_runner[@]} )); then "${collector_runner[@]}" "$@"; return; fi
  "$@" &
  local collector_pid=$! collector_ticks=$(( collector_timeout * 10 ))
  while (( collector_ticks > 0 )) && kill -0 "$collector_pid" 2>/dev/null; do
    sleep 0.1
    collector_ticks=$(( collector_ticks - 1 ))
  done
  if kill -0 "$collector_pid" 2>/dev/null; then
    pkill -TERM -P "$collector_pid" 2>/dev/null || true
    kill -TERM "$collector_pid" 2>/dev/null || true
    wait "$collector_pid" 2>/dev/null || true
    return 124
  fi
  wait "$collector_pid"
}

# Release output only after every connection succeeds. Keep Oracle diagnostics
# on stderr on failure, so redirecting stdout never creates a partial snapshot.
collector_output=$(mktemp)
trap 'rm -f -- "$collector_output"' EXIT
collect_member() {
  local collector_status=0
  run_limited sqlplus -L -s "$1" @"$collector_dir/dataguard-topology.sql" </dev/null >>"$collector_output" || collector_status=$?
  if (( collector_status != 0 )); then
    cat -- "$collector_output" >&2
    if (( collector_status == 124 )); then
      echo "SQL*Plus did not finish within ${collector_timeout} s; check that the alias resolves in tnsnames.ora or raise DG_COLLECT_TIMEOUT." >&2
    fi
    echo 'Collection failed; no import output was written.' >&2
    exit 1
  fi
}
if (( $# == 0 )); then
  collect_member '/ as sysdba'
else
  for collector_alias in "$@"; do collect_member "/@$collector_alias"; done
fi

# WHENEVER SQLERROR does not catch SQL*Plus command errors (SP2-...).
collector_begins=0
collector_ends=0
while IFS= read -r collector_line; do
  if [[ "$collector_line" =~ ^[[:space:]]*(ORA-|SP2-|TNS-|ERROR) ]]; then
    cat -- "$collector_output" >&2
    echo 'The collector reported an error; no import output was written.' >&2
    exit 1
  fi
  case "$collector_line" in
    DGTOPO_BEGIN_V1*) collector_begins=$((collector_begins + 1));;
    DGTOPO_END_V1*) collector_ends=$((collector_ends + 1));;
  esac
done <"$collector_output"
collector_expected=$#
if (( collector_expected == 0 )); then collector_expected=1; fi
if (( collector_begins != collector_expected || collector_ends != collector_expected )); then
  cat -- "$collector_output" >&2
  echo 'Incomplete collector output; no import output was written.' >&2
  exit 1
fi
cat -- "$collector_output"
