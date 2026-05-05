#!/usr/bin/env bash
# Apply bootstrap SQL files in order to a target Supabase project.
# Usage: bash e2e/sql/apply.sh "postgresql://postgres.<REF>:<PWD>@<HOST>:5432/postgres"

set -euo pipefail

DB_URL="${1:-}"
if [[ -z "$DB_URL" ]]; then
  echo "Usage: $0 <postgres-connection-uri>" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

for f in "$DIR"/0*.sql; do
  echo "=== applying $(basename "$f") ==="
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "=== bootstrap complete ==="
