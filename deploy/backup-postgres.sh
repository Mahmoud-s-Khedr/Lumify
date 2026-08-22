#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${BACKUP_DIR:?BACKUP_DIR must be an explicit backup directory}"
environment_file="${ENV_FILE:-$project_dir/.env.production}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$backup_dir"
umask 077

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/lumify-$timestamp.sql.gz"
temporary="$target.partial"

docker compose \
  --env-file "$environment_file" \
  -f "$project_dir/docker-compose.production.yml" \
  exec -T db \
  sh -c 'pg_dump --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip -9 >"$temporary"

mv "$temporary" "$target"
find "$backup_dir" -type f -name 'lumify-*.sql.gz' -mtime "+$retention_days" -delete

echo "$target"
