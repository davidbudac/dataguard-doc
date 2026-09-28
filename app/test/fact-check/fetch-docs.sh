#!/usr/bin/env bash
# Pull the Oracle pages a fact check reads and turn them into greppable text.
#
#   app/test/fact-check/fetch-docs.sh [dir]      (default: a fresh temp dir)
#
# Nothing is written inside the repository. The point of the text copies is
# that a quoted sentence is then checked with grep, never with a model that
# summarises the page: a summariser paraphrases, and a paraphrase is what a
# fact check exists to catch.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$(mktemp -d /tmp/dg-fact-check.XXXXXX)}"
mkdir -p "$out"

base="https://docs.oracle.com/en/database/oracle/oracle-database"

# name <space> path under $base
pages=(
  "b19-fsfo        19/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html"
  "b19-props       19/dgbkr/oracle-data-guard-broker-properties.html"
  "b19-cmds        19/dgbkr/oracle-data-guard-broker-commands.html"
  "b19-members     19/dgbkr/managing-oracle-data-guard-broker-configuration-members.html"
  "b19-configs     19/dgbkr/managing-oracle-data-guard-broker-configurations.html"
  "b19-scenarios   19/dgbkr/examples-using-data-guard-broker-DGMGRL-utility.html"
  "b19-changes     19/dgbkr/release-changes.html"
  "b21-fsfo        21/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html"
  "b21-props       21/dgbkr/oracle-data-guard-broker-properties.html"
  "b26-fsfo        26/dgbkr/fast-start-failover2.html"
  "b26-modes       26/dgbkr/managing-data-protection-modes.html"
  "b26-routes      26/dgbkr/redo-routing-rules.html"
  "b26-redoroutes  26/dgbkr/redoroutes.html"
  "b26-laglimit    26/dgbkr/faststartfailoverlaglimit.html"
  "b26-lagtype     26/dgbkr/faststartfailoverlagtype.html"
  "b26-laggrace    26/dgbkr/faststartfailoverlaggracetime.html"
  "b26-pinginterval 26/dgbkr/observerpinginterval.html"
  "b26-pingretry   26/dgbkr/observerpingretry.html"
  "b26-preferred   26/dgbkr/preferredobserverhosts.html"
  "b26-candidates  26/dgbkr/primarydatabasecandidates.html"
  "b26-maxfailure  26/dgbkr/maxfailure.html"
  "b26-toc         26/dgbkr/toc.htm"
  "b26-switchover  26/dgbkr/switchover.html"
  "b26-manual      26/dgbkr/manual-failover1.html"
  "b26-failover    26/dgbkr/failover2.html"
  "b26-bystanders  26/dgbkr/bystandersfollowrolechange.html"
  "b26-showfsfo    26/dgbkr/show-fast_start-failover.html"
  "b26-startobs    26/dgbkr/start-observer.html"
  "b26-configs     26/dgbkr/managing-oracle-data-guard-broker-configurations.html"
  "s26-roles       26/sbydb/managing-oracle-data-guard-role-transitions.html"
  "r19-synclatency 19/refrn/DATA_GUARD_SYNC_LATENCY.html"
  "s19-alternate   19/sbydb/using-ALTERNATE-attribute-to-configure-alternate-destinations.html"
  "j26-urls        26/jjdbc/data-sources-and-URLs.html"
  "s19-modes       19/sbydb/oracle-data-guard-protection-modes.html"
  "s19-transport   19/sbydb/oracle-data-guard-redo-transport-services.html"
  "s19-roles       19/sbydb/managing-oracle-data-guard-role-transitions.html"
  "s19-farsync     19/sbydb/creating-oracle-data-guard-far-sync-instance.html"
  "s19-destattrs   19/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html"
  "s26-destattrs   26/sbydb/LOG_ARCHIVE_DEST_n-parameter-attributes.html"
  "r19-vdatabase   19/refrn/V-DATABASE.html"
  "r26-vdatabase   26/refrn/V-DATABASE.html"
  "n19-tnsnames    19/netrf/local-naming-parameters-in-tns-ora-file.html"
  "n26-tnsnames    26/netrf/local-naming-parameters-in-tns-ora-file.html"
  "n26-sqlnet      26/netrf/parameters-for-the-sqlnet.ora.html"
  "h19-observer    19/haovw/optimizing-automatic-failover-common-scenarios-minimize-downtime1.html"
  "h19-dg          19/haovw/configure-and-deploy-oracle-data-guard.html"
  "nf21-ha         21/nfcon/performance-and-high-availability.html"
)

fail=0
for entry in "${pages[@]}"; do
  read -r name path <<<"$entry"
  code="$(curl -sS -m 90 -L -A 'Mozilla/5.0' -o "$out/$name.html" -w '%{http_code}' "$base/$path" || echo 000)"
  if [[ "$code" != "200" ]]; then
    echo "FAILED $code  $base/$path" >&2
    rm -f "$out/$name.html"
    fail=1
  fi
done

# The error-help pages carry one tab per release (26ai, 21c, 19c): read the
# tab for the edition being drawn, never the first one on the page.
for n in 12514 16529 16647 16649 16654 16655 16658 16661 16819 16820 16827 16829 16830 16867; do
  code="$(curl -sS -m 60 -L -A 'Mozilla/5.0' -o "$out/ora-$n.html" -w '%{http_code}' \
    "https://docs.oracle.com/en/error-help/db/ora-$n/" || echo 000)"
  [[ "$code" == "200" ]] || { echo "FAILED $code  ora-$n" >&2; rm -f "$out/ora-$n.html"; fail=1; }
done

python3 "$here/totext.py" "$out"/*.html >/dev/null
echo "$out"
exit "$fail"
