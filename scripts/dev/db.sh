#!/bin/bash
# Runs a .sql file on the LIVE BD Audit database (Supabase project
# spnvsjmmeddwompkeerh) through the Management API, and prints the result.
#   ./scripts/dev/db.sh supabase/pending/some-change.sql
# The API token is read from secrets.txt (gitignored) at run time, never
# printed or written anywhere. Test a change first with its .test.sql
# (begin … rollback) before applying the real file.
set -euo pipefail
cd "$(dirname "$0")/../.."
FILE="${1:?usage: ./scripts/dev/db.sh path/to/file.sql}"
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }
TOKEN="$(grep -o 'sbp_[A-Za-z0-9]*' secrets.txt | head -1)"
[ -n "$TOKEN" ] || { echo "no Supabase token in secrets.txt" >&2; exit 1; }
jq -Rs '{query: .}' "$FILE" \
  | curl -sS -X POST "https://api.supabase.com/v1/projects/spnvsjmmeddwompkeerh/database/query" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @-
echo
