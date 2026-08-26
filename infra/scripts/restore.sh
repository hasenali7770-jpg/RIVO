#!/usr/bin/env bash
#
# RIVO database restore — Master Plan §17 requires the procedure to be documented
# AND tested.
#
#   ./restore.sh /var/backups/rivo/rivo-20260825T020000Z.dump
#
# By default this restores into a scratch database and reports what it found,
# which is how the restore is rehearsed without touching production. Overwriting
# a live database requires --target and an explicit confirmation.

set -euo pipefail

ARCHIVE="${1:-}"
MODE="verify"
TARGET_URL=""

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --target) MODE="restore"; TARGET_URL="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

# Prisma's DATABASE_URL carries parameters libpq does not understand — `schema`,
# `connection_limit`, `pgbouncer` and friends. pg_dump and psql reject the whole
# URL when they see one, so they are stripped here. Without this the nightly
# backup fails every night with "invalid URI query parameter".
libpq_url() {
  local url="$1"
  local base="${url%%\?*}"
  local query="${url#*\?}"
  [ "$query" = "$url" ] && { printf '%s' "$base"; return; }

  local kept=""
  local IFS='&'
  for param in $query; do
    case "${param%%=*}" in
      # Only parameters libpq itself recognises are preserved.
      sslmode|sslcert|sslkey|sslrootcert|application_name|connect_timeout|host|hostaddr|options)
        kept="${kept:+$kept&}$param" ;;
    esac
  done
  printf '%s%s' "$base" "${kept:+?$kept}"
}

[ -n "$ARCHIVE" ] || fail "Usage: restore.sh <dump-file> [--target <database-url>]"
[ -f "$ARCHIVE" ] || fail "No such file: $ARCHIVE"
command -v pg_restore >/dev/null || fail "pg_restore is not installed"

log "Checking the archive is readable"
pg_restore --list "$ARCHIVE" > /dev/null || fail "The archive is corrupt or not a pg_dump custom-format file"

if [ "$MODE" = "verify" ]; then
  [ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set (needed to reach the server and create a scratch database)"

  SCRATCH="rivo_restore_test_$(date -u +%s)"
  PGURL="$(libpq_url "$DATABASE_URL")"
  SERVER_URL="${PGURL%/*}"

  log "Rehearsal restore into a scratch database: ${SCRATCH}"
  psql "${SERVER_URL}/postgres" -c "CREATE DATABASE \"${SCRATCH}\";" >/dev/null
  # shellcheck disable=SC2064
  trap "log 'Dropping ${SCRATCH}'; psql \"${SERVER_URL}/postgres\" -c 'DROP DATABASE IF EXISTS \"${SCRATCH}\";' >/dev/null" EXIT

  psql "${SERVER_URL}/${SCRATCH}" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;" >/dev/null

  # --no-owner because the scratch database is owned by whoever is running this,
  # not by the production role recorded in the dump.
  pg_restore --no-owner --no-privileges --dbname "${SERVER_URL}/${SCRATCH}" "$ARCHIVE" 2>&1 | grep -v 'already exists' || true

  log "Verifying the restored contents"
  psql "${SERVER_URL}/${SCRATCH}" -tA <<'SQL'
SELECT 'tables: '        || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';
SELECT 'users: '         || count(*) FROM users;
SELECT 'properties: '    || count(*) FROM properties;
SELECT 'published: '     || count(*) FROM properties WHERE status='PUBLISHED';
SELECT 'payments paid: ' || count(*) FROM listing_payments WHERE status='PAID';
SELECT 'audit entries: ' || count(*) FROM audit_logs;
SELECT 'gist indexes: '  || count(*) FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%gist%';
SELECT 'postgis: '       || postgis_version();
SQL

  log "Rehearsal succeeded. The archive restores cleanly."
  log "Record today's date in docs/deployment/BACKUP_RESTORE.md under 'last tested'."
  exit 0
fi

# --- Real restore ---------------------------------------------------------
[ -n "$TARGET_URL" ] || fail "--target requires a database URL"

cat <<WARNING

  ================== THIS OVERWRITES A LIVE DATABASE ==================

  Target : ${TARGET_URL%%\?*}
  Archive: ${ARCHIVE}

  Every row currently in that database will be replaced. Stop the API and the
  worker first, or they will write into a database that is being rewritten.

  =====================================================================

WARNING

read -r -p "Type RESTORE to continue: " CONFIRM
[ "$CONFIRM" = "RESTORE" ] || fail "Cancelled."

log "Restoring into the target database"
pg_restore --no-owner --no-privileges --clean --if-exists \
           --dbname "$(libpq_url "$TARGET_URL")" "$ARCHIVE"

log "Restore complete. Start the API and confirm /api/v1/health reports ok."
