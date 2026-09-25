#!/bin/bash
# Refreshes the harness's copy of the live data (read-only query).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .dev-session
./scripts/dev/db.sh scripts/harness/snapshot.sql | jq '.[0].r' > .dev-session/harness-snapshot.json
jq 'map_values(length)' .dev-session/harness-snapshot.json
