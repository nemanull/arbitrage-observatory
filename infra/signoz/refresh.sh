#!/usr/bin/env bash
# Re-fetch the vendored SigNoz manifests.
#
# SigNoz stopped shipping Compose files in its own repository at v0.130.0 and moved to a
# generator called Foundry. The generated single node Docker output is published in the
# SigNoz/foundry repository, so this script copies it rather than installing foundryctl.
#
# The fetched compose.yaml is upstream output with no local edits, so review the diff and
# re-apply the three blocks marked "Local edit" in compose.yaml before committing.

set -euo pipefail

REPO="${SIGNOZ_FOUNDRY_REPO:-SigNoz/foundry}"
REF="${SIGNOZ_FOUNDRY_REF:-main}"
BASE="https://raw.githubusercontent.com/${REPO}/${REF}/docs/examples/docker"

cd "$(dirname "$0")"

fetch() {
  local remote="$1" local_path="$2"
  mkdir -p "$(dirname "$local_path")"
  echo "  ${local_path}"
  curl -fsS -m 30 "${BASE}/${remote}" -o "$local_path"
}

echo "Fetching SigNoz manifests from ${REPO}@${REF}"
fetch "compose/casting.yaml" "casting.yaml"
fetch "compose/pours/deployment/compose.yaml" "compose.yaml"
fetch "compose/pours/deployment/ingester/ingester.yaml" "ingester/ingester.yaml"
fetch "compose/pours/deployment/ingester/opamp.yaml" "ingester/opamp.yaml"
fetch "compose/pours/deployment/telemetrykeeper/clickhousekeeper/keeper-0.yaml" "telemetrykeeper/clickhousekeeper/keeper-0.yaml"
fetch "compose/pours/deployment/telemetrystore/clickhouse/config-0-0.yaml" "telemetrystore/clickhouse/config-0-0.yaml"
fetch "compose/pours/deployment/telemetrystore/clickhouse/functions.yaml" "telemetrystore/clickhouse/functions.yaml"

echo
echo "Done. compose.yaml is now raw upstream output."
echo "Run 'git diff infra/signoz/compose.yaml' and restore the three 'Local edit' blocks:"
echo "  1. loopback and shifted ports on 'ingester' and 'signoz-signoz-0'"
echo "  2. mem_limit on 'signoz-telemetrystore-clickhouse-0-0'"
echo "  3. depends_on for 'ingester' and 'signoz-signoz-0'"
