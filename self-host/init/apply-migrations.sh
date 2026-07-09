#!/bin/sh
# Apply every SQL file under /migrations in filename order.
# Runs as a one-shot sidecar; exits 0 when all files applied.
set -eu

: "${PGPASSWORD:?PGPASSWORD is required}"

echo "[migrate] waiting for db..."
until pg_isready -h db -U postgres -d aegis >/dev/null 2>&1; do
  sleep 1
done

echo "[migrate] applying migrations from /migrations"
for f in $(ls /migrations/*.sql 2>/dev/null | sort); do
  echo "[migrate] -> $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -h db -U postgres -d aegis -f "$f"
done

echo "[migrate] done"
