#!/usr/bin/env bash
# Drops the observatory database, creates it empty and applies every migration, so a run starts on a clean database.
# The old database is saved under logs/db/ first, because a run's rows exist nowhere else until they are imported.
# Only Postgres is touched, so the SigNoz logs of earlier runs stay.

set -euo pipefail

cd "$(dirname "$0")/.."

user="${POSTGRES_USER:-observatory}"
db="${POSTGRES_DB:-observatory}"

sql() {
  docker compose exec -T -e PGOPTIONS='-c client_min_messages=warning' postgres \
    psql -U "$user" -v ON_ERROR_STOP=1 -q "$@"
}

docker compose up -d --wait postgres

if [[ -n "$(sql -d postgres -tAc "select 1 from pg_database where datname = '${db}'")" ]]; then
  mkdir -p logs/db
  dump="logs/db/${db}-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
  docker compose exec -T postgres pg_dump -U "$user" -d "$db" --format=custom > "$dump"
  echo "Saved the old database to ${dump}"
fi

# No FORCE, so the drop fails while a server is still connected instead of pulling the database out from under it.
sql -d postgres -c "drop database if exists \"${db}\""
sql -d postgres -c "create database \"${db}\""

for file in server/migrations/*.sql; do
  echo "Applying ${file}"
  sql -d "$db" < "$file"
done

echo "Database ${db} is empty and migrated."
